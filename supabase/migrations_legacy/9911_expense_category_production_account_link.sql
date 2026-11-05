-- Allows finance managers to map custom expense categories to a real posting
-- account. Production cost eligibility requires an active, postable expense
-- account; categories created from the UI must be able to satisfy that rule.
BEGIN;

DROP FUNCTION IF EXISTS public.expense_category_management();
DROP FUNCTION IF EXISTS public.expense_category_postable_accounts();

-- Archived categories must not continue to expose expense lines as new
-- production cost sources.
CREATE OR REPLACE FUNCTION public.production_cost_sources()
RETURNS TABLE (
  expense_line_id uuid,
  expense_entry_id uuid,
  reference text,
  expense_date date,
  description text,
  category_name text,
  cost_center_id uuid,
  account_code text,
  net_amount numeric,
  allocated_amount numeric,
  available_amount numeric
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT public.can_read_finance(auth.uid()) THEN
    RAISE EXCEPTION 'لا تتوفر صلاحية قراءة مصروفات الإنتاج';
  END IF;
  RETURN QUERY
  SELECT l.id,e.id,e.reference,e.expense_date,coalesce(l.description,e.description,'مصروف'),
         coalesce(c.name_ar,c.name,'مصروف'),coalesce(l.cost_center_id,e.cost_center_id),
         a.code::text,l.net_amount,
         coalesce(sum(pa.amount),0)::numeric,
         greatest(l.net_amount-coalesce(sum(pa.amount),0),0)::numeric
    FROM public.expense_lines l
    JOIN public.expense_entries e ON e.id=l.entry_id
    JOIN public.expense_categories c
      ON c.id=l.category_id AND c.production_cost_eligible AND c.is_active
    JOIN public.accounts a ON a.id=c.account_id AND a.account_type::text='EXPENSE'
      AND a.is_active AND a.is_postable
    LEFT JOIN public.production_order_cost_allocations pa ON pa.expense_line_id=l.id
   WHERE e.status::text IN ('POSTED','PARTIALLY_PAID','PAID','CLOSED')
     AND l.net_amount > 0
   GROUP BY l.id,e.id,e.reference,e.expense_date,l.description,e.description,c.name_ar,c.name,
            l.cost_center_id,e.cost_center_id,a.code,l.net_amount
  HAVING l.net_amount-coalesce(sum(pa.amount),0) > 0
   ORDER BY e.expense_date DESC,e.reference,l.line_no;
END;
$function$;

CREATE OR REPLACE FUNCTION public.expense_category_management()
RETURNS TABLE (
  id uuid,
  name text,
  name_ar text,
  notes text,
  is_active boolean,
  production_cost_eligible boolean,
  account_id uuid,
  account_code text,
  account_name_ar text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  PERFORM public.expense_assert_capability(auth.uid(), 'expense.category.manage');
  RETURN QUERY
  SELECT c.id,c.name,c.name_ar,c.notes,c.is_active,c.production_cost_eligible,
         c.account_id,a.code::text,a.name_ar
    FROM public.expense_categories c
    LEFT JOIN public.accounts a ON a.id=c.account_id
   ORDER BY c.sort_order,c.name;
END;
$function$;

CREATE OR REPLACE FUNCTION public.expense_category_postable_accounts()
RETURNS TABLE (id uuid, code text, name_ar text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  PERFORM public.expense_assert_capability(auth.uid(), 'expense.category.manage');
  RETURN QUERY
  SELECT a.id,a.code::text,a.name_ar
    FROM public.accounts a
   WHERE a.account_type::text='EXPENSE' AND a.is_active AND a.is_postable
   ORDER BY a.code;
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_expense_category_account(
  p_category_id uuid,
  p_account_id uuid
)
RETURNS public.expense_categories
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_user uuid := public.expense_actor();
  v_account public.accounts%ROWTYPE;
  v_category public.expense_categories%ROWTYPE;
BEGIN
  PERFORM public.expense_assert_capability(v_user, 'expense.category.manage');

  IF p_category_id IS NULL THEN
    RAISE EXCEPTION 'اختر تصنيف المصروف' USING ERRCODE = '22023';
  END IF;

  IF p_account_id IS NOT NULL THEN
    SELECT * INTO v_account
      FROM public.accounts
     WHERE id = p_account_id
     FOR SHARE;
    IF NOT FOUND OR v_account.account_type::text <> 'EXPENSE'
       OR v_account.is_active IS NOT TRUE OR v_account.is_postable IS NOT TRUE THEN
      RAISE EXCEPTION 'يجب اختيار حساب مصروف نشط وقابل للترحيل' USING ERRCODE = '22023';
    END IF;
  END IF;

  UPDATE public.expense_categories
     SET account_id = p_account_id,
         production_cost_eligible = CASE WHEN p_account_id IS NULL THEN false
                                         ELSE production_cost_eligible END
   WHERE id = p_category_id
  RETURNING * INTO v_category;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'تصنيف المصروف غير موجود' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.audit_logs(actor_id, action, entity_type, entity_id, payload)
  VALUES (v_user, 'expense.category.account_changed', 'expense_category', p_category_id,
          jsonb_build_object('account_id', p_account_id,
                             'account_code', v_account.code,
                             'production_cost_eligible', v_category.production_cost_eligible));

  RETURN v_category;
END;
$function$;

REVOKE ALL ON FUNCTION public.set_expense_category_account(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_expense_category_account(uuid, uuid)
  TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.expense_category_management()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.expense_category_management()
  TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.expense_category_postable_accounts()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.expense_category_postable_accounts()
  TO authenticated, service_role;

DO $allowlist$
DECLARE
  v_current text[];
  v_name text;
  v_additions text[] := ARRAY[
    'set_expense_category_account',
    'expense_category_management',
    'expense_category_postable_accounts'
  ]::text[];
BEGIN
  EXECUTE 'SELECT public.rpc_allowlist()' INTO v_current;
  v_current := coalesce(v_current, ARRAY[]::text[]);
  FOREACH v_name IN ARRAY v_additions LOOP
    IF NOT (v_name = ANY(v_current)) THEN
      v_current := array_append(v_current, v_name);
    END IF;
  END LOOP;
  EXECUTE format($fn$
    CREATE OR REPLACE FUNCTION public.rpc_allowlist() RETURNS text[]
    LANGUAGE sql IMMUTABLE SET search_path = public
    AS $body$ SELECT %L::text[] $body$
  $fn$, v_current);
END;
$allowlist$;
REVOKE ALL ON FUNCTION public.rpc_allowlist() FROM PUBLIC, anon, authenticated, service_role;

COMMIT;

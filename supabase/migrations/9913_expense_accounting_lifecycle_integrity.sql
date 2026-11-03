-- Expense lifecycle integrity: explicit ledger mappings, supplier invoice
-- deduplication, idempotent creation, and tax recoverability.
-- This migration is additive. Existing expense documents and their journal
-- history remain intact; unmapped drafts can still be completed in setup.
BEGIN;

ALTER TABLE public.expense_entries
  ADD COLUMN IF NOT EXISTS supplier_invoice_number text,
  ADD COLUMN IF NOT EXISTS create_idempotency_key text,
  ADD COLUMN IF NOT EXISTS tax_recoverable boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS approval_required_rank integer NOT NULL DEFAULT 40;

DO $constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'expense_entries_approval_rank_check'
       AND conrelid = 'public.expense_entries'::regclass
  ) THEN
    ALTER TABLE public.expense_entries
      ADD CONSTRAINT expense_entries_approval_rank_check
      CHECK (approval_required_rank IN (40, 50));
  END IF;
END;
$constraint$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_expense_supplier_invoice_number
  ON public.expense_entries (supplier_id, lower(btrim(supplier_invoice_number)))
  WHERE supplier_id IS NOT NULL
    AND supplier_invoice_number IS NOT NULL
    AND btrim(supplier_invoice_number) <> ''
    AND status <> 'CANCELLED';

CREATE UNIQUE INDEX IF NOT EXISTS uq_expense_create_idempotency
  ON public.expense_entries (created_by, create_idempotency_key)
  WHERE created_by IS NOT NULL AND create_idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.expense_ledger_account_mappings (
  role text PRIMARY KEY CHECK (role IN (
    'INPUT_TAX', 'SUPPLIER_PAYABLE', 'EMPLOYEE_PAYABLE', 'OTHER_PAYABLE'
  )),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE RESTRICT,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.expense_approval_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  min_amount numeric(18,2) NOT NULL UNIQUE CHECK (min_amount >= 0),
  required_role_rank integer NOT NULL CHECK (required_role_rank IN (40, 50)),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON public.expense_approval_rules FROM PUBLIC, anon, authenticated;
INSERT INTO public.expense_approval_rules(min_amount, required_role_rank)
VALUES (0, 40) ON CONFLICT (min_amount) DO NOTHING;

CREATE OR REPLACE FUNCTION public.expense_required_approval_rank(p_amount numeric)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT coalesce((
    SELECT r.required_role_rank
      FROM public.expense_approval_rules r
     WHERE r.min_amount <= greatest(coalesce(p_amount, 0), 0)
     ORDER BY r.min_amount DESC
     LIMIT 1
  ), 40)
$function$;

CREATE OR REPLACE FUNCTION public.tg_expense_capture_approval_rank()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF NEW.status = 'SUBMITTED' THEN
    NEW.approval_required_rank := public.expense_required_approval_rank(NEW.total_amount);
  END IF;
  RETURN NEW;
END;
$function$;
DROP TRIGGER IF EXISTS expense_entries_capture_approval_rank ON public.expense_entries;
CREATE TRIGGER expense_entries_capture_approval_rank
  BEFORE INSERT OR UPDATE OF status, total_amount ON public.expense_entries
  FOR EACH ROW EXECUTE FUNCTION public.tg_expense_capture_approval_rank();

REVOKE ALL ON public.expense_ledger_account_mappings FROM PUBLIC, anon, authenticated;

-- Seed only accounts whose current code and type match the established ledger
-- roles. Missing accounts remain explicitly unmapped and block affected posts.
INSERT INTO public.expense_ledger_account_mappings(role, account_id)
SELECT seed.role, a.id
FROM (VALUES
  ('INPUT_TAX', '1316', 'ASSET'),
  ('SUPPLIER_PAYABLE', '2111', 'LIABILITY'),
  ('EMPLOYEE_PAYABLE', '2221', 'LIABILITY'),
  ('OTHER_PAYABLE', '2221', 'LIABILITY')
) AS seed(role, code, account_type)
JOIN public.accounts a
  ON a.code = seed.code
 AND a.account_type::text = seed.account_type
 AND a.is_active
 AND a.is_postable
ON CONFLICT (role) DO NOTHING;

CREATE OR REPLACE FUNCTION public.expense_posting_account_code(p_role text)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_code text;
  v_expected_type text;
BEGIN
  v_expected_type := CASE p_role
    WHEN 'INPUT_TAX' THEN 'ASSET'
    WHEN 'SUPPLIER_PAYABLE' THEN 'LIABILITY'
    WHEN 'EMPLOYEE_PAYABLE' THEN 'LIABILITY'
    WHEN 'OTHER_PAYABLE' THEN 'LIABILITY'
    ELSE NULL
  END;
  IF v_expected_type IS NULL THEN
    RAISE EXCEPTION 'Unknown expense ledger role: %', p_role USING ERRCODE = '22023';
  END IF;

  SELECT a.code::text INTO v_code
    FROM public.expense_ledger_account_mappings m
    JOIN public.accounts a ON a.id = m.account_id
   WHERE m.role = p_role
     AND a.account_type::text = v_expected_type
     AND a.is_active
     AND a.is_postable;
  IF v_code IS NULL THEN
    RAISE EXCEPTION 'Configure an active, postable % account in Expense Setup before posting', p_role
      USING ERRCODE = '55000';
  END IF;
  RETURN v_code;
END;
$function$;

CREATE OR REPLACE FUNCTION public.expense_ledger_account_management()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  PERFORM public.expense_assert_capability(auth.uid(), 'expense.category.manage');
  RETURN jsonb_build_object(
    'roles', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'role', r.role,
        'account_id', r.account_id,
        'account_code', a.code,
        'account_name_ar', a.name_ar,
        'account_type', a.account_type::text
      ) ORDER BY r.role)
      FROM (VALUES
        ('INPUT_TAX'), ('SUPPLIER_PAYABLE'), ('EMPLOYEE_PAYABLE'), ('OTHER_PAYABLE')
      ) r(role)
      LEFT JOIN public.expense_ledger_account_mappings m ON m.role = r.role
      LEFT JOIN public.accounts a ON a.id = m.account_id
    ), '[]'::jsonb),
    'accounts', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', a.id, 'code', a.code, 'name_ar', a.name_ar,
        'account_type', a.account_type::text
      ) ORDER BY a.code)
      FROM public.accounts a
      WHERE a.is_active AND a.is_postable
        AND a.account_type::text IN ('ASSET', 'LIABILITY')
    ), '[]'::jsonb)
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_expense_ledger_account(
  p_role text,
  p_account_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_expected_type text;
  v_account public.accounts%ROWTYPE;
  v_user uuid := public.expense_actor();
BEGIN
  PERFORM public.expense_assert_capability(v_user, 'expense.category.manage');
  v_expected_type := CASE p_role
    WHEN 'INPUT_TAX' THEN 'ASSET'
    WHEN 'SUPPLIER_PAYABLE' THEN 'LIABILITY'
    WHEN 'EMPLOYEE_PAYABLE' THEN 'LIABILITY'
    WHEN 'OTHER_PAYABLE' THEN 'LIABILITY'
    ELSE NULL
  END;
  IF v_expected_type IS NULL OR p_account_id IS NULL THEN
    RAISE EXCEPTION 'Choose a supported expense ledger role and account' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_account FROM public.accounts WHERE id = p_account_id FOR SHARE;
  IF NOT FOUND OR v_account.account_type::text <> v_expected_type
     OR NOT v_account.is_active OR NOT v_account.is_postable THEN
    RAISE EXCEPTION 'The selected account must be active, postable, and of type %', v_expected_type
      USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.expense_ledger_account_mappings(role, account_id, updated_by, updated_at)
  VALUES (p_role, p_account_id, v_user, now())
  ON CONFLICT (role) DO UPDATE
    SET account_id = EXCLUDED.account_id,
        updated_by = EXCLUDED.updated_by,
        updated_at = EXCLUDED.updated_at;
  INSERT INTO public.audit_logs(actor_id, action, entity_type, payload)
  VALUES (v_user, 'expense.ledger_account.changed', 'expense_ledger_account',
          jsonb_build_object('role', p_role, 'account_id', p_account_id,
                             'account_code', v_account.code));
END;
$function$;

CREATE OR REPLACE FUNCTION public.expense_approval_rule_management()
RETURNS TABLE(id uuid, min_amount numeric, required_role_rank integer)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  PERFORM public.expense_assert_capability(auth.uid(), 'expense.category.manage');
  RETURN QUERY
    SELECT r.id, r.min_amount, r.required_role_rank
      FROM public.expense_approval_rules r
     ORDER BY r.min_amount;
END;
$function$;

CREATE OR REPLACE FUNCTION public.save_expense_approval_rule(
  p_min_amount numeric,
  p_required_role_rank integer
)
RETURNS public.expense_approval_rules
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_user uuid := public.expense_actor();
  v_rule public.expense_approval_rules%ROWTYPE;
BEGIN
  PERFORM public.expense_assert_capability(v_user, 'expense.category.manage');
  IF p_min_amount IS NULL OR p_min_amount < 0
     OR p_required_role_rank NOT IN (40, 50) THEN
    RAISE EXCEPTION 'Use a non-negative amount and choose manager or owner approval' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.expense_approval_rules(min_amount, required_role_rank, created_by, updated_at)
  VALUES (public.expense_round(p_min_amount), p_required_role_rank, v_user, now())
  ON CONFLICT (min_amount) DO UPDATE
    SET required_role_rank = EXCLUDED.required_role_rank,
        updated_at = now()
  RETURNING * INTO v_rule;
  INSERT INTO public.audit_logs(actor_id, action, entity_type, entity_id, payload)
  VALUES (v_user, 'expense.approval_rule.saved', 'expense_approval_rule', v_rule.id,
          jsonb_build_object('minimum_amount', v_rule.min_amount,
                             'required_role_rank', v_rule.required_role_rank));
  RETURN v_rule;
END;
$function$;

CREATE OR REPLACE FUNCTION public.delete_expense_approval_rule(p_rule_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_user uuid := public.expense_actor();
  v_rule public.expense_approval_rules%ROWTYPE;
BEGIN
  PERFORM public.expense_assert_capability(v_user, 'expense.category.manage');
  SELECT * INTO v_rule FROM public.expense_approval_rules WHERE id = p_rule_id FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  IF v_rule.min_amount = 0 THEN
    RAISE EXCEPTION 'The base manager approval rule cannot be removed' USING ERRCODE = '55000';
  END IF;
  DELETE FROM public.expense_approval_rules WHERE id = p_rule_id;
  INSERT INTO public.audit_logs(actor_id, action, entity_type, entity_id, payload)
  VALUES (v_user, 'expense.approval_rule.deleted', 'expense_approval_rule', p_rule_id,
          jsonb_build_object('minimum_amount', v_rule.min_amount));
END;
$function$;

-- Correct tax arithmetic at the database boundary. For EXCLUSIVE tax the
-- typed amount is net and tax is added; for INCLUSIVE it is already gross.
CREATE OR REPLACE FUNCTION public.expense_write_lines(
  p_entry_id uuid,
  p_lines jsonb,
  p_tax_mode public.expense_tax_mode,
  OUT o_total numeric,
  OUT o_count integer
)
RETURNS record
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_line jsonb;
  v_index integer := 0;
  v_qty numeric;
  v_price numeric;
  v_rate numeric;
  v_input_amount numeric;
  v_gross numeric;
  v_net numeric;
  v_tax numeric;
BEGIN
  o_total := 0;
  o_count := 0;
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'At least one expense line is required' USING ERRCODE = '22023';
  END IF;

  DELETE FROM public.expense_lines WHERE entry_id = p_entry_id;
  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    v_index := v_index + 1;
    v_qty := coalesce((v_line ->> 'quantity')::numeric, 1);
    v_price := coalesce((v_line ->> 'unit_price')::numeric, 0);
    v_rate := coalesce((v_line ->> 'tax_rate')::numeric, 0);
    IF v_qty <= 0 OR v_price < 0 OR v_rate < 0 OR v_rate > 100 THEN
      RAISE EXCEPTION 'Line % has an invalid quantity, amount, or tax rate', v_index USING ERRCODE = '22023';
    END IF;
    IF v_rate > 0 AND p_tax_mode = 'NONE' THEN
      RAISE EXCEPTION 'Choose inclusive or exclusive tax treatment for a taxed line' USING ERRCODE = '22023';
    END IF;

    v_input_amount := public.expense_round(v_qty * v_price);
    IF p_tax_mode = 'EXCLUSIVE' AND v_rate > 0 THEN
      v_net := v_input_amount;
      v_tax := public.expense_round(v_net * v_rate / 100);
      v_gross := v_net + v_tax;
    ELSIF p_tax_mode = 'INCLUSIVE' AND v_rate > 0 THEN
      v_gross := v_input_amount;
      v_net := public.expense_round(v_gross / (1 + v_rate / 100));
      v_tax := v_gross - v_net;
    ELSE
      v_net := v_input_amount;
      v_tax := 0;
      v_gross := v_input_amount;
    END IF;

    INSERT INTO public.expense_lines (
      entry_id, line_no, description, category_id, quantity, unit_price,
      net_amount, tax_rate, tax_amount, gross_amount,
      cost_center_id, project_id, note
    ) VALUES (
      p_entry_id, v_index,
      nullif(btrim(coalesce(v_line ->> 'description', '')), ''),
      nullif(btrim(coalesce(v_line ->> 'category_id', '')), '')::uuid,
      v_qty, v_price, v_net, v_rate, v_tax, v_gross,
      nullif(btrim(coalesce(v_line ->> 'cost_center_id', '')), '')::uuid,
      nullif(btrim(coalesce(v_line ->> 'project_id', '')), '')::uuid,
      nullif(btrim(coalesce(v_line ->> 'note', '')), '')
    );
    o_total := o_total + v_gross;
    o_count := o_count + 1;
  END LOOP;

  o_total := public.expense_round(o_total);
  IF o_total <= 0 THEN RAISE EXCEPTION 'Expense total must be greater than zero' USING ERRCODE = '22023'; END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.expense_line_net(
  p_gross numeric,
  p_tax_rate numeric,
  p_mode public.expense_tax_mode
)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $function$
  SELECT CASE
    WHEN p_gross IS NULL THEN NULL
    WHEN coalesce(p_tax_rate, 0) <= 0 OR p_mode IN ('NONE', 'EXCLUSIVE') THEN public.expense_round(p_gross)
    ELSE public.expense_round(p_gross / (1 + p_tax_rate / 100))
  END
$function$;

CREATE OR REPLACE FUNCTION public.expense_line_tax(
  p_gross numeric,
  p_tax_rate numeric,
  p_mode public.expense_tax_mode
)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $function$
  SELECT CASE
    WHEN p_gross IS NULL OR coalesce(p_tax_rate, 0) <= 0 OR p_mode = 'NONE' THEN 0::numeric
    WHEN p_mode = 'EXCLUSIVE' THEN public.expense_round(p_gross * p_tax_rate / 100)
    ELSE public.expense_round(p_gross - public.expense_line_net(p_gross, p_tax_rate, p_mode))
  END
$function$;

REVOKE ALL ON FUNCTION public.expense_posting_account_code(text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.expense_posting_account_code(text) TO service_role;
REVOKE ALL ON FUNCTION public.expense_required_approval_rank(numeric)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.expense_required_approval_rank(numeric) TO service_role;
REVOKE ALL ON FUNCTION public.tg_expense_capture_approval_rank()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.tg_expense_capture_approval_rank() TO service_role;
REVOKE ALL ON FUNCTION public.expense_ledger_account_management()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.expense_ledger_account_management()
  TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.set_expense_ledger_account(text, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_expense_ledger_account(text, uuid)
  TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.expense_approval_rule_management()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.expense_approval_rule_management()
  TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.save_expense_approval_rule(numeric, integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.save_expense_approval_rule(numeric, integer)
  TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.delete_expense_approval_rule(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.delete_expense_approval_rule(uuid)
  TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.expense_write_lines(uuid,jsonb,public.expense_tax_mode)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.expense_write_lines(uuid,jsonb,public.expense_tax_mode)
  TO authenticated, service_role;

-- New RPC adds invoice identity, recoverability choice, and an idempotency key
-- without changing the established create_expense RPC used by older clients.
CREATE OR REPLACE FUNCTION public.create_expense_v2(
  p_lines jsonb,
  p_expense_date date DEFAULT CURRENT_DATE,
  p_due_date date DEFAULT NULL,
  p_entry_type public.expense_entry_type DEFAULT 'DIRECT',
  p_payee_type public.expense_payee_type DEFAULT 'NONE',
  p_payee_name text DEFAULT NULL,
  p_supplier_id uuid DEFAULT NULL,
  p_employee_id uuid DEFAULT NULL,
  p_warehouse_id uuid DEFAULT NULL,
  p_cost_center_id uuid DEFAULT NULL,
  p_project_id uuid DEFAULT NULL,
  p_description text DEFAULT NULL,
  p_note text DEFAULT NULL,
  p_tax_mode public.expense_tax_mode DEFAULT 'NONE',
  p_reference text DEFAULT NULL,
  p_submit boolean DEFAULT false,
  p_supplier_invoice_number text DEFAULT NULL,
  p_tax_recoverable boolean DEFAULT false,
  p_idempotency_key text DEFAULT NULL
)
RETURNS public.expense_entries
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_user uuid := public.expense_actor();
  v_entry public.expense_entries;
  v_total numeric;
  v_count integer;
  v_ref text;
  v_status public.expense_status;
  v_currency text;
  v_symbol text;
  v_invoice_number text := nullif(btrim(coalesce(p_supplier_invoice_number, '')), '');
  v_idempotency_key text := nullif(btrim(coalesce(p_idempotency_key, '')), '');
BEGIN
  PERFORM public.expense_assert_capability(v_user, 'expense.create');
  IF p_expense_date IS NULL THEN
    RAISE EXCEPTION 'Expense date is required' USING ERRCODE = '22023';
  END IF;
  IF p_due_date IS NOT NULL AND p_due_date < p_expense_date THEN
    RAISE EXCEPTION 'Due date cannot precede the expense date' USING ERRCODE = '22023';
  END IF;
  IF p_payee_type = 'SUPPLIER' AND p_supplier_id IS NULL THEN
    RAISE EXCEPTION 'A supplier payee requires a supplier' USING ERRCODE = '22023';
  END IF;
  IF p_payee_type = 'EMPLOYEE' AND p_employee_id IS NULL THEN
    RAISE EXCEPTION 'An employee payee requires a staff member' USING ERRCODE = '22023';
  END IF;
  IF v_invoice_number IS NOT NULL AND (p_payee_type <> 'SUPPLIER' OR p_supplier_id IS NULL) THEN
    RAISE EXCEPTION 'A supplier invoice number requires a selected supplier' USING ERRCODE = '22023';
  END IF;
  IF length(v_invoice_number) > 120 OR length(v_idempotency_key) > 128 THEN
    RAISE EXCEPTION 'Invoice number or request key is too long' USING ERRCODE = '22023';
  END IF;

  IF v_idempotency_key IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(v_user::text || ':' || v_idempotency_key, 0));
    SELECT * INTO v_entry FROM public.expense_entries
     WHERE created_by = v_user AND create_idempotency_key = v_idempotency_key;
    IF FOUND THEN RETURN v_entry; END IF;
  END IF;

  IF v_invoice_number IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.expense_entries e
     WHERE e.supplier_id = p_supplier_id
       AND lower(btrim(e.supplier_invoice_number)) = lower(v_invoice_number)
       AND e.status <> 'CANCELLED'
  ) THEN
    RAISE EXCEPTION 'This supplier invoice number is already recorded for this supplier' USING ERRCODE = '23505';
  END IF;

  SELECT COALESCE(NULLIF(btrim(currency), ''), 'YER'),
         COALESCE(NULLIF(btrim(currency_symbol), ''), '﷼')
    INTO v_currency, v_symbol
    FROM public.company_settings ORDER BY id LIMIT 1;
  v_currency := COALESCE(v_currency, 'YER');
  v_symbol := COALESCE(v_symbol, '﷼');
  v_status := CASE WHEN p_submit THEN 'SUBMITTED'::public.expense_status
                   ELSE 'DRAFT'::public.expense_status END;
  v_ref := COALESCE(NULLIF(btrim(COALESCE(p_reference, '')), ''), public.next_expense_reference());

  BEGIN
    INSERT INTO public.expense_entries (
      reference, entry_type, status, source_kind, payee_type, payee_name,
      supplier_id, employee_id, warehouse_id, cost_center_id, project_id,
      expense_date, due_date, description, note, tax_mode, tax_recoverable,
      supplier_invoice_number, create_idempotency_key, currency, currency_symbol,
      created_by, submitted_by, submitted_at
    ) VALUES (
      v_ref, p_entry_type, v_status, 'MANUAL', p_payee_type,
      nullif(btrim(coalesce(p_payee_name, '')), ''),
      CASE WHEN p_payee_type = 'SUPPLIER' THEN p_supplier_id END,
      CASE WHEN p_payee_type = 'EMPLOYEE' THEN p_employee_id END,
      p_warehouse_id, p_cost_center_id, p_project_id, p_expense_date, p_due_date,
      nullif(btrim(coalesce(p_description, '')), ''),
      nullif(btrim(coalesce(p_note, '')), ''), p_tax_mode,
      coalesce(p_tax_recoverable, false), v_invoice_number, v_idempotency_key,
      v_currency, v_symbol, v_user,
      CASE WHEN p_submit THEN v_user END,
      CASE WHEN p_submit THEN now() END
    ) RETURNING * INTO v_entry;
  EXCEPTION WHEN unique_violation THEN
    IF v_idempotency_key IS NOT NULL THEN
      SELECT * INTO v_entry FROM public.expense_entries
       WHERE created_by = v_user AND create_idempotency_key = v_idempotency_key;
      IF FOUND THEN RETURN v_entry; END IF;
    END IF;
    RAISE EXCEPTION 'This supplier invoice number is already recorded for this supplier'
      USING ERRCODE = '23505';
  END;

  SELECT o_total, o_count INTO v_total, v_count
    FROM public.expense_write_lines(v_entry.id, p_lines, p_tax_mode);
  UPDATE public.expense_entries
     SET total_amount = v_total, line_count = v_count
   WHERE id = v_entry.id
  RETURNING * INTO v_entry;
  PERFORM public.expense_log_action(
    v_entry.id, 'created', NULL, v_status,
    CASE WHEN p_submit THEN 'Created and submitted' ELSE 'Created as draft' END, v_user
  );
  RETURN v_entry;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_expense_v2(
  p_entry_id uuid,
  p_expected_version integer,
  p_lines jsonb,
  p_expense_date date DEFAULT NULL,
  p_due_date date DEFAULT NULL,
  p_entry_type public.expense_entry_type DEFAULT NULL,
  p_payee_type public.expense_payee_type DEFAULT NULL,
  p_payee_name text DEFAULT NULL,
  p_supplier_id uuid DEFAULT NULL,
  p_employee_id uuid DEFAULT NULL,
  p_warehouse_id uuid DEFAULT NULL,
  p_cost_center_id uuid DEFAULT NULL,
  p_project_id uuid DEFAULT NULL,
  p_description text DEFAULT NULL,
  p_note text DEFAULT NULL,
  p_tax_mode public.expense_tax_mode DEFAULT NULL,
  p_tax_recoverable boolean DEFAULT false,
  p_supplier_invoice_number text DEFAULT NULL
)
RETURNS public.expense_entries
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_entry public.expense_entries;
  v_invoice_number text := nullif(btrim(coalesce(p_supplier_invoice_number, '')), '');
BEGIN
  v_entry := public.update_expense(
    p_entry_id, p_expected_version, p_lines, p_expense_date, p_due_date,
    p_entry_type, p_payee_type, p_payee_name, p_supplier_id, p_employee_id,
    p_warehouse_id, p_cost_center_id, p_project_id, p_description, p_note, p_tax_mode
  );
  IF v_invoice_number IS NOT NULL AND (v_entry.payee_type <> 'SUPPLIER' OR v_entry.supplier_id IS NULL) THEN
    RAISE EXCEPTION 'A supplier invoice number requires a selected supplier' USING ERRCODE = '22023';
  END IF;
  IF length(v_invoice_number) > 120 OR EXISTS (
    SELECT 1 FROM public.expense_entries other
     WHERE other.id <> p_entry_id
       AND other.supplier_id = v_entry.supplier_id
       AND lower(btrim(other.supplier_invoice_number)) = lower(v_invoice_number)
       AND other.status <> 'CANCELLED'
  ) THEN
    RAISE EXCEPTION 'This supplier invoice number is already recorded for this supplier' USING ERRCODE = '23505';
  END IF;
  UPDATE public.expense_entries
     SET tax_recoverable = coalesce(p_tax_recoverable, false),
         supplier_invoice_number = v_invoice_number
   WHERE id = p_entry_id AND status IN ('DRAFT', 'REJECTED')
  RETURNING * INTO v_entry;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Only a draft or returned expense can change its tax treatment' USING ERRCODE = '55000';
  END IF;
  RETURN v_entry;
END;
$function$;

CREATE OR REPLACE FUNCTION public.decide_expense(
  p_entry_id uuid,
  p_approve boolean,
  p_reason text DEFAULT NULL,
  p_expected_version integer DEFAULT NULL
)
RETURNS public.expense_entries
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_user uuid := public.expense_actor();
  v_entry public.expense_entries;
  v_action text := CASE WHEN p_approve THEN 'approve' ELSE 'reject' END;
  v_target public.expense_status;
  v_user_rank integer;
BEGIN
  IF p_approve IS NULL THEN
    RAISE EXCEPTION 'Choose whether to approve or reject this expense' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_entry FROM public.expense_entries WHERE id = p_entry_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Expense not found' USING ERRCODE = 'P0002'; END IF;
  IF v_entry.status <> 'SUBMITTED' THEN
    RAISE EXCEPTION 'This expense is not awaiting approval (current: %)', v_entry.status USING ERRCODE = '55000';
  END IF;
  PERFORM public.expense_assert_capability(v_user, 'expense.' || v_action);
  IF p_expected_version IS NOT NULL AND p_expected_version <> v_entry.version THEN
    RAISE EXCEPTION 'This expense was changed by someone else. Reload it and try again.' USING ERRCODE = '40001';
  END IF;
  v_user_rank := public.expense_role_rank(v_user);
  IF v_user_rank < v_entry.approval_required_rank THEN
    RAISE EXCEPTION 'This expense requires approval from a higher role based on its amount' USING ERRCODE = '42501';
  END IF;
  IF v_entry.created_by = v_user AND NOT public.has_role(v_user, 'owner') THEN
    RAISE EXCEPTION 'You cannot approve an expense you created yourself' USING ERRCODE = '42501';
  END IF;
  IF v_entry.created_by = v_user AND public.has_role(v_user, 'owner') THEN
    p_reason := coalesce(nullif(btrim(coalesce(p_reason, '')), ''),
                         'Self-approved by owner (no other approver available)');
  END IF;
  IF NOT p_approve AND nullif(btrim(coalesce(p_reason, '')), '') IS NULL THEN
    RAISE EXCEPTION 'A reason is required when rejecting an expense' USING ERRCODE = '22023';
  END IF;
  v_target := CASE WHEN p_approve THEN 'APPROVED'::public.expense_status
                   ELSE 'REJECTED'::public.expense_status END;
  UPDATE public.expense_entries
     SET status = v_target,
         version = version + 1,
         approved_by = CASE WHEN p_approve THEN v_user END,
         approved_at = CASE WHEN p_approve THEN now() END,
         rejected_by = CASE WHEN NOT p_approve THEN v_user END,
         rejected_at = CASE WHEN NOT p_approve THEN now() END,
         rejection_reason = CASE WHEN NOT p_approve THEN nullif(btrim(coalesce(p_reason, '')), '') END
   WHERE id = p_entry_id
  RETURNING * INTO v_entry;
  PERFORM public.expense_log_action(p_entry_id, v_action, 'SUBMITTED', v_target, p_reason, v_user);
  RETURN v_entry;
END;
$function$;

-- Separate accrued expense recognition from payment while resolving every
-- ledger destination from a validated account mapping. No fallback account is
-- used when a category or role is not configured.
CREATE OR REPLACE FUNCTION public.post_expense(
  p_entry_id uuid,
  p_expected_version integer DEFAULT NULL,
  p_pay_now boolean DEFAULT false,
  p_payment_method public.payment_method DEFAULT 'cash',
  p_account_label text DEFAULT NULL,
  p_payment_date date DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL,
  p_account_id uuid DEFAULT NULL,
  p_cashbox_id uuid DEFAULT NULL,
  p_bank_account_id uuid DEFAULT NULL,
  p_payment_method_id text DEFAULT NULL
)
RETURNS public.expense_entries
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_user uuid := public.expense_actor();
  v_entry public.expense_entries;
  v_from public.expense_status;
  v_lines jsonb := '[]'::jsonb;
  v_tax numeric(18,2) := 0;
  v_tax_account text;
  v_payable_role text;
  v_journal uuid;
  r record;
BEGIN
  SELECT * INTO v_entry FROM public.expense_entries WHERE id = p_entry_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Expense not found' USING ERRCODE = 'P0002'; END IF;
  v_from := v_entry.status;
  IF v_from IN ('POSTED', 'PARTIALLY_PAID', 'PAID', 'CLOSED') THEN RETURN v_entry; END IF;
  IF v_from NOT IN ('APPROVED', 'DRAFT') THEN
    RAISE EXCEPTION 'This expense cannot be posted from status %', v_from USING ERRCODE = '55000';
  END IF;
  PERFORM public.expense_assert_capability(v_user, 'expense.post');
  IF p_expected_version IS NOT NULL AND p_expected_version <> v_entry.version THEN
    RAISE EXCEPTION 'This expense was changed by someone else. Reload it and try again.' USING ERRCODE = '40001';
  END IF;
  IF v_entry.entry_type = 'ADVANCE' THEN
    RAISE EXCEPTION 'Employee advances need a separate issue and settlement document; this expense entry cannot post them' USING ERRCODE = '55000';
  END IF;
  IF v_entry.total_amount <= 0 OR v_entry.line_count = 0 THEN
    RAISE EXCEPTION 'Cannot post an expense with no lines' USING ERRCODE = '22023';
  END IF;
  IF v_from = 'DRAFT' AND NOT public.expense_can(v_user, 'expense.approve') THEN
    RAISE EXCEPTION 'Submit this expense for approval before posting it' USING ERRCODE = '55000';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.expense_lines l
      LEFT JOIN public.expense_categories c ON c.id = l.category_id
      LEFT JOIN public.accounts a ON a.id = c.account_id
     WHERE l.entry_id = p_entry_id
       AND (c.id IS NULL OR c.account_id IS NULL OR a.id IS NULL
            OR a.account_type::text <> 'EXPENSE' OR NOT a.is_active OR NOT a.is_postable)
  ) THEN
    RAISE EXCEPTION 'Every expense line needs an active, postable expense account mapping' USING ERRCODE = '55000';
  END IF;

  v_payable_role := CASE
    WHEN v_entry.payee_type = 'SUPPLIER' AND v_entry.supplier_id IS NOT NULL THEN 'SUPPLIER_PAYABLE'
    WHEN v_entry.payee_type = 'EMPLOYEE' AND v_entry.employee_id IS NOT NULL THEN 'EMPLOYEE_PAYABLE'
    ELSE 'OTHER_PAYABLE'
  END;
  -- Resolve before changing status so a missing role never leaves a document
  -- apparently posted without its journal.
  PERFORM public.expense_posting_account_code(v_payable_role);
  IF v_entry.tax_recoverable AND EXISTS (
    SELECT 1 FROM public.expense_lines WHERE entry_id = p_entry_id AND tax_amount > 0
  ) THEN
    v_tax_account := public.expense_posting_account_code('INPUT_TAX');
  END IF;

  UPDATE public.expense_entries
     SET status = 'POSTED', posting_date = coalesce(posting_date, CURRENT_DATE),
         posted_by = v_user, posted_at = now(), version = version + 1
   WHERE id = p_entry_id
  RETURNING * INTO v_entry;
  PERFORM public.expense_log_action(p_entry_id, 'posted', v_from, 'POSTED', NULL, v_user);

  FOR r IN (
    SELECT a.code::text AS account_code,
           coalesce(c.name_ar, c.name, 'مصروف') AS label,
           round(sum(l.net_amount + CASE WHEN v_entry.tax_recoverable THEN 0 ELSE l.tax_amount END), 2) AS debit_amount,
           round(sum(l.tax_amount), 2) AS tax_amount
      FROM public.expense_lines l
      JOIN public.expense_categories c ON c.id = l.category_id
      JOIN public.accounts a ON a.id = c.account_id
     WHERE l.entry_id = p_entry_id
     GROUP BY a.code, coalesce(c.name_ar, c.name, 'مصروف')
  ) LOOP
    IF r.debit_amount > 0 THEN
      v_lines := v_lines || jsonb_build_object(
        'account_code', r.account_code, 'debit', r.debit_amount,
        'memo', 'مصروف ' || v_entry.reference || ' — ' || r.label
      );
    END IF;
    v_tax := v_tax + r.tax_amount;
  END LOOP;
  IF v_tax > 0 AND v_entry.tax_recoverable THEN
    v_lines := v_lines || jsonb_build_object(
      'account_code', v_tax_account, 'debit', round(v_tax, 2),
      'memo', 'ضريبة قابلة للاسترداد على مصروف ' || v_entry.reference
    );
  END IF;
  v_lines := v_lines || jsonb_build_object(
    'account_code', public.expense_posting_account_code(v_payable_role),
    'credit', round(v_entry.total_amount, 2),
    'memo', 'التزام مصروف ' || v_entry.reference
  );
  v_journal := public.create_journal_entry(
    'إثبات استحقاق مصروف ' || v_entry.reference,
    coalesce(v_entry.expense_date, CURRENT_DATE), 'expense', p_entry_id, true, v_lines
  );
  IF p_pay_now THEN
    SELECT * INTO v_entry FROM public.record_expense_payment(
      p_entry_id, v_entry.total_amount, coalesce(p_payment_date, CURRENT_DATE),
      p_payment_method, p_account_label, NULL, 'Settled at posting',
      coalesce(p_idempotency_key, 'post:' || p_entry_id::text), p_account_id,
      p_cashbox_id, p_bank_account_id, p_payment_method_id
    );
  END IF;
  RETURN v_entry;
END;
$function$;

CREATE OR REPLACE FUNCTION public.record_expense_payment(
  p_entry_id uuid,
  p_amount numeric,
  p_payment_date date DEFAULT CURRENT_DATE,
  p_payment_method public.payment_method DEFAULT 'cash',
  p_account_label text DEFAULT NULL,
  p_reference_no text DEFAULT NULL,
  p_note text DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL,
  p_account_id uuid DEFAULT NULL,
  p_cashbox_id uuid DEFAULT NULL,
  p_bank_account_id uuid DEFAULT NULL,
  p_payment_method_id text DEFAULT NULL
)
RETURNS public.expense_entries
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_user uuid := public.expense_actor();
  v_entry public.expense_entries;
  v_amount numeric(18,2);
  v_existing public.expense_payments;
  v_label text := nullif(btrim(coalesce(p_account_label, '')), '');
  v_cash_acct text;
  v_credit_acct text;
  v_payable_role text;
  v_lines jsonb := '[]'::jsonb;
  v_journal uuid;
  v_payment_id uuid;
BEGIN
  SELECT * INTO v_entry FROM public.expense_entries WHERE id = p_entry_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Expense not found' USING ERRCODE = 'P0002'; END IF;
  PERFORM public.expense_assert_capability(v_user, 'expense.pay');
  IF v_entry.status NOT IN ('POSTED', 'PARTIALLY_PAID') THEN
    RAISE EXCEPTION 'Payments can only be recorded against posted expenses (current: %)', v_entry.status USING ERRCODE = '55000';
  END IF;
  v_amount := public.expense_round(p_amount);
  IF v_amount <= 0 OR v_amount > v_entry.remaining_amount + 0.005 THEN
    RAISE EXCEPTION 'Payment amount is invalid or exceeds remaining amount' USING ERRCODE = '22023';
  END IF;
  IF p_idempotency_key IS NOT NULL THEN
    SELECT * INTO v_existing FROM public.expense_payments
     WHERE idempotency_key = btrim(p_idempotency_key);
    IF FOUND THEN
      IF v_existing.entry_id <> p_entry_id OR v_existing.amount <> v_amount THEN
        RAISE EXCEPTION 'Payment request key was already used for a different payment' USING ERRCODE = '23505';
      END IF;
      RETURN v_entry;
    END IF;
  END IF;

  IF p_cashbox_id IS NOT NULL THEN
    SELECT c.name_ar, a.code INTO v_label, v_cash_acct
      FROM public.cashboxes c JOIN public.accounts a ON a.id = c.account_id
     WHERE c.id = p_cashbox_id AND c.is_active AND a.account_type::text = 'ASSET'
       AND a.is_active AND a.is_postable;
    IF NOT FOUND THEN RAISE EXCEPTION 'Cashbox is unavailable' USING ERRCODE = '22023'; END IF;
  ELSIF p_bank_account_id IS NOT NULL THEN
    SELECT b.name_ar, a.code INTO v_label, v_cash_acct
      FROM public.company_bank_accounts b JOIN public.accounts a ON a.id = b.account_id
     WHERE b.id = p_bank_account_id AND b.is_active AND a.account_type::text = 'ASSET'
       AND a.is_active AND a.is_postable;
    IF NOT FOUND THEN RAISE EXCEPTION 'Bank account is unavailable' USING ERRCODE = '22023'; END IF;
  ELSIF p_account_id IS NOT NULL THEN
    SELECT a.name_ar, a.code INTO v_label, v_cash_acct FROM public.accounts a
     WHERE a.id = p_account_id AND a.account_type::text = 'ASSET' AND a.is_active AND a.is_postable;
    IF NOT FOUND THEN RAISE EXCEPTION 'The selected settlement account is unavailable' USING ERRCODE = '22023'; END IF;
  END IF;
  IF v_cash_acct IS NULL THEN
    v_cash_acct := public.payment_method_ledger_account(coalesce(p_payment_method::text, 'cash'));
  END IF;
  IF v_cash_acct IS NULL THEN
    RAISE EXCEPTION 'No active ledger account is configured for this payment method' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.accounts a
     WHERE a.code = v_cash_acct AND a.account_type::text = 'ASSET'
       AND a.is_active AND a.is_postable
  ) THEN
    RAISE EXCEPTION 'The payment method is not linked to an active, postable cash or bank account' USING ERRCODE = '22023';
  END IF;
  v_payable_role := CASE
    WHEN v_entry.payee_type = 'SUPPLIER' AND v_entry.supplier_id IS NOT NULL THEN 'SUPPLIER_PAYABLE'
    WHEN v_entry.payee_type = 'EMPLOYEE' AND v_entry.employee_id IS NOT NULL THEN 'EMPLOYEE_PAYABLE'
    ELSE 'OTHER_PAYABLE'
  END;
  v_credit_acct := public.expense_posting_account_code(v_payable_role);

  INSERT INTO public.expense_payments (
    entry_id, amount, payment_date, payment_method, account_label, reference_no,
    note, idempotency_key, created_by, account_id, cashbox_id, bank_account_id, payment_method_id
  ) VALUES (
    p_entry_id, v_amount, coalesce(p_payment_date, CURRENT_DATE), coalesce(p_payment_method, 'cash'),
    v_label, nullif(btrim(coalesce(p_reference_no, '')), ''), nullif(btrim(coalesce(p_note, '')), ''),
    nullif(btrim(coalesce(p_idempotency_key, '')), ''), v_user, p_account_id,
    p_cashbox_id, p_bank_account_id, p_payment_method_id
  ) RETURNING id INTO v_payment_id;

  v_lines := v_lines
    || jsonb_build_object('account_code', v_credit_acct, 'debit', v_amount, 'memo', 'تسوية التزام مصروف ' || v_entry.reference)
    || jsonb_build_object('account_code', v_cash_acct, 'credit', v_amount, 'memo', 'صرف دفعة مصروف ' || v_entry.reference);
  v_journal := public.create_journal_entry(
    'سداد مصروف ' || v_entry.reference, coalesce(p_payment_date, CURRENT_DATE),
    'expense_payment', v_payment_id, true, v_lines
  );
  SELECT * INTO v_entry FROM public.expense_entries WHERE id = p_entry_id;
  PERFORM public.expense_log_action(p_entry_id, 'payment', v_entry.status, v_entry.status,
    'Payment of ' || v_amount::text || ' ' || v_entry.currency_symbol || ' recorded', v_user);
  RETURN v_entry;
END;
$function$;

REVOKE ALL ON FUNCTION public.create_expense_v2(jsonb,date,date,public.expense_entry_type,public.expense_payee_type,text,uuid,uuid,uuid,uuid,uuid,text,text,public.expense_tax_mode,text,boolean,text,boolean,text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_expense_v2(jsonb,date,date,public.expense_entry_type,public.expense_payee_type,text,uuid,uuid,uuid,uuid,uuid,text,text,public.expense_tax_mode,text,boolean,text,boolean,text)
  TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.update_expense_v2(uuid,integer,jsonb,date,date,public.expense_entry_type,public.expense_payee_type,text,uuid,uuid,uuid,uuid,uuid,text,text,public.expense_tax_mode,boolean,text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.update_expense_v2(uuid,integer,jsonb,date,date,public.expense_entry_type,public.expense_payee_type,text,uuid,uuid,uuid,uuid,uuid,text,text,public.expense_tax_mode,boolean,text)
  TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.post_expense(uuid,integer,boolean,public.payment_method,text,date,text,uuid,uuid,uuid,text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.post_expense(uuid,integer,boolean,public.payment_method,text,date,text,uuid,uuid,uuid,text)
  TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.record_expense_payment(uuid,numeric,date,public.payment_method,text,text,text,text,uuid,uuid,uuid,text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_expense_payment(uuid,numeric,date,public.payment_method,text,text,text,text,uuid,uuid,uuid,text)
  TO authenticated, service_role;

DO $allowlist$
DECLARE
  v_current text[];
  v_name text;
  v_additions text[] := ARRAY[
    'expense_ledger_account_management', 'set_expense_ledger_account',
    'expense_approval_rule_management', 'save_expense_approval_rule',
    'delete_expense_approval_rule', 'create_expense_v2', 'update_expense_v2'
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

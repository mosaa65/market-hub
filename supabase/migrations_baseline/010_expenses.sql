-- ============================================================================
-- الترحيل 010_expenses.sql — مجال: expenses
-- جزء من خط الأساس الجديد: تعريف نهائي واحد لكل كائن، مبني من مخطط مرجعي
-- مستخرج من الترحيلات التاريخية الكاملة (راجع supabase/migrations/README.md).
-- ============================================================================

--
-- Name: expense_entries; Type: TABLE; Schema: public; Owner: supabase_admin
--

CREATE TABLE public.expense_entries (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    reference text NOT NULL,
    entry_type public.expense_entry_type DEFAULT 'DIRECT'::public.expense_entry_type NOT NULL,
    status public.expense_status DEFAULT 'DRAFT'::public.expense_status NOT NULL,
    source_kind public.expense_source_kind DEFAULT 'MANUAL'::public.expense_source_kind NOT NULL,
    payee_type public.expense_payee_type DEFAULT 'NONE'::public.expense_payee_type NOT NULL,
    payee_name text,
    supplier_id uuid,
    employee_id uuid,
    warehouse_id uuid,
    cost_center_id uuid,
    project_id uuid,
    expense_date date DEFAULT CURRENT_DATE NOT NULL,
    due_date date,
    posting_date date,
    description text,
    note text,
    total_amount numeric(18,2) DEFAULT 0 NOT NULL,
    paid_amount numeric(18,2) DEFAULT 0 NOT NULL,
    remaining_amount numeric(18,2) GENERATED ALWAYS AS ((total_amount - paid_amount)) STORED,
    tax_mode public.expense_tax_mode DEFAULT 'NONE'::public.expense_tax_mode NOT NULL,
    currency text DEFAULT 'YER'::text NOT NULL,
    currency_symbol text DEFAULT '﷼'::text NOT NULL,
    line_count integer DEFAULT 0 NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    created_by uuid,
    submitted_by uuid,
    submitted_at timestamp with time zone,
    approved_by uuid,
    approved_at timestamp with time zone,
    rejected_by uuid,
    rejected_at timestamp with time zone,
    rejection_reason text,
    posted_by uuid,
    posted_at timestamp with time zone,
    cancelled_by uuid,
    cancelled_at timestamp with time zone,
    cancel_reason text,
    reversal_of uuid,
    reversed_by_id uuid,
    legacy_expense_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    supplier_invoice_number text,
    create_idempotency_key text,
    tax_recoverable boolean DEFAULT false NOT NULL,
    approval_required_rank integer DEFAULT 40 NOT NULL,
    allow_draft_post boolean DEFAULT false NOT NULL,
    draft_post_reason text,
    CONSTRAINT expense_entries_approval_rank_check CHECK ((approval_required_rank = ANY (ARRAY[40, 50]))),
    CONSTRAINT expense_entries_dates_ordered CHECK (((posting_date IS NULL) OR (posting_date >= (expense_date - 366)))),
    CONSTRAINT expense_entries_due_after_expense CHECK (((due_date IS NULL) OR (due_date >= expense_date))),
    CONSTRAINT expense_entries_paid_non_negative CHECK ((paid_amount >= (0)::numeric)),
    CONSTRAINT expense_entries_paid_requires_post CHECK (((paid_amount = (0)::numeric) OR (status = ANY (ARRAY['POSTED'::public.expense_status, 'PARTIALLY_PAID'::public.expense_status, 'PAID'::public.expense_status, 'CLOSED'::public.expense_status, 'REVERSED'::public.expense_status])))),
    CONSTRAINT expense_entries_paid_within_total CHECK ((paid_amount <= (total_amount + 0.005))),
    CONSTRAINT expense_entries_payee_consistent CHECK ((((payee_type = 'SUPPLIER'::public.expense_payee_type) AND (supplier_id IS NOT NULL) AND (employee_id IS NULL)) OR ((payee_type = 'EMPLOYEE'::public.expense_payee_type) AND (employee_id IS NOT NULL) AND (supplier_id IS NULL)) OR ((payee_type = ANY (ARRAY['NONE'::public.expense_payee_type, 'OTHER'::public.expense_payee_type])) AND (supplier_id IS NULL) AND (employee_id IS NULL)))),
    CONSTRAINT expense_entries_reference_not_blank CHECK ((btrim(reference) <> ''::text)),
    CONSTRAINT expense_entries_total_non_negative CHECK ((total_amount >= (0)::numeric)),
    CONSTRAINT expense_entries_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES auth.users(id) ON DELETE SET NULL,
    CONSTRAINT expense_entries_cancelled_by_fkey FOREIGN KEY (cancelled_by) REFERENCES auth.users(id) ON DELETE SET NULL,
    CONSTRAINT expense_entries_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL,
    CONSTRAINT expense_entries_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES auth.users(id) ON DELETE SET NULL,
    CONSTRAINT expense_entries_posted_by_fkey FOREIGN KEY (posted_by) REFERENCES auth.users(id) ON DELETE SET NULL,
    CONSTRAINT expense_entries_rejected_by_fkey FOREIGN KEY (rejected_by) REFERENCES auth.users(id) ON DELETE SET NULL,
    CONSTRAINT expense_entries_submitted_by_fkey FOREIGN KEY (submitted_by) REFERENCES auth.users(id) ON DELETE SET NULL
);

--
-- Name: expense_categories; Type: TABLE; Schema: public; Owner: supabase_admin
--

CREATE TABLE public.expense_categories (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    name_ar text,
    account_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    sort_order integer DEFAULT 100 NOT NULL,
    notes text,
    created_by uuid,
    production_cost_eligible boolean DEFAULT false NOT NULL,
    CONSTRAINT expense_categories_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL
);

--
-- Name: expense_actor(); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.expense_actor() RETURNS uuid
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_user uuid := auth.uid();
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
  RETURN v_user;
END $$;

--
-- Name: expense_approval_rule_management(); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.expense_approval_rule_management() RETURNS TABLE(id uuid, min_amount numeric, required_role_rank integer)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  PERFORM public.expense_assert_capability(auth.uid(), 'expense.category.manage');
  RETURN QUERY
    SELECT r.id, r.min_amount, r.required_role_rank
      FROM public.expense_approval_rules r
     ORDER BY r.min_amount;
END;
$$;

--
-- Name: expense_assert_capability(uuid, text); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.expense_assert_capability(p_user uuid, p_capability text) RETURNS void
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF NOT public.expense_can(p_user, p_capability) THEN
    RAISE EXCEPTION 'Forbidden: % requires a higher role', p_capability
      USING ERRCODE = '42501';
  END IF;
END $$;

--
-- Name: expense_can(uuid, text); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.expense_can(p_user uuid, p_capability text) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT
    -- Every capability requires an active staff account. `is_staff` fails
    -- closed on a missing profile row, which is the behaviour we want here.
    public.is_staff(p_user)
    AND CASE p_capability
      -- Reading the register is the baseline every operational role needs.
      WHEN 'expense.view'            THEN public.expense_role_rank(p_user)            >= 10
      -- Typing a draft is a cashier/warehouse action: it commits nothing.
      WHEN 'expense.create'          THEN public.expense_role_rank(p_user)            >= 10
      WHEN 'expense.edit'            THEN public.expense_role_rank(p_user)            >= 10
      WHEN 'expense.submit'          THEN public.expense_role_rank(p_user)            >= 10
      -- Approval is a control, not a data-entry step.
      WHEN 'expense.approve'         THEN public.expense_role_rank(p_user)            >= 40
      WHEN 'expense.reject'          THEN public.expense_role_rank(p_user)            >= 40
      WHEN 'expense.post'            THEN public.expense_role_rank(p_user)            >= 30
      -- Money leaving the drawer needs the same bar as posting.
      WHEN 'expense.pay'             THEN public.expense_role_rank(p_user)            >= 20
      WHEN 'expense.reverse'         THEN public.expense_role_rank(p_user)            >= 30
      WHEN 'expense.cancel'          THEN public.expense_role_rank(p_user)            >= 40
      WHEN 'expense.category.manage' THEN public.expense_role_rank(p_user)            >= 40
      WHEN 'expense.dimension.manage' THEN public.expense_role_rank(p_user)           >= 40
      WHEN 'expense.report'          THEN public.expense_role_rank(p_user)            >= 30
      WHEN 'expense.payment.reverse' THEN public.expense_role_rank(p_user)            >= 30
      ELSE false
    END
$$;

--
-- Name: expense_category_management(); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.expense_category_management() RETURNS TABLE(id uuid, name text, name_ar text, notes text, is_active boolean, production_cost_eligible boolean, account_id uuid, account_code text, account_name_ar text)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  PERFORM public.expense_assert_capability(auth.uid(), 'expense.category.manage');
  RETURN QUERY
  SELECT c.id,c.name,c.name_ar,c.notes,c.is_active,c.production_cost_eligible,
         c.account_id,a.code::text,a.name_ar
    FROM public.expense_categories c
    LEFT JOIN public.accounts a ON a.id=c.account_id
   ORDER BY c.sort_order,c.name;
END;
$$;

--
-- Name: expense_category_postable_accounts(); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.expense_category_postable_accounts() RETURNS TABLE(id uuid, code text, name_ar text)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  PERFORM public.expense_assert_capability(auth.uid(), 'expense.category.manage');
  RETURN QUERY
  SELECT a.id,a.code::text,a.name_ar
    FROM public.accounts a
   WHERE a.account_type::text='EXPENSE' AND a.is_active AND a.is_postable
   ORDER BY a.code;
END;
$$;

--
-- Name: expense_ledger_account_management(); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.expense_ledger_account_management() RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
$$;

--
-- Name: expense_log_action(uuid, text, public.expense_status, public.expense_status, text, uuid); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.expense_log_action(p_entry_id uuid, p_action text, p_from public.expense_status, p_to public.expense_status, p_reason text DEFAULT NULL::text, p_actor uuid DEFAULT NULL::uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_actor    uuid := COALESCE(p_actor, auth.uid());
  v_sequence integer;
BEGIN
  SELECT COALESCE(max(sequence), 0) + 1
    INTO v_sequence
  FROM public.expense_approvals
  WHERE entry_id = p_entry_id;

  INSERT INTO public.expense_approvals (
    entry_id, sequence, action, from_status, to_status, actor_id, reason
  )
  VALUES (p_entry_id, v_sequence, p_action, p_from, p_to, v_actor,
          nullif(btrim(coalesce(p_reason, '')), ''));

  -- The generic audit log keeps the expense trail discoverable from the same
  -- screen an owner already uses for every other module.
  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, payload)
  VALUES (v_actor, 'expense.' || p_action, 'expense_entry', p_entry_id,
          jsonb_build_object('from', p_from, 'to', p_to, 'reason', p_reason));
END $$;

--
-- Name: expense_posting_account_code(text); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.expense_posting_account_code(p_role text) RETURNS text
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
$$;

--
-- Name: expense_report(text, date, date, public.expense_status[], uuid, uuid, uuid, integer); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.expense_report(p_group_by text DEFAULT 'category'::text, p_date_from date DEFAULT NULL::date, p_date_to date DEFAULT NULL::date, p_status public.expense_status[] DEFAULT NULL::public.expense_status[], p_warehouse_id uuid DEFAULT NULL::uuid, p_cost_center_id uuid DEFAULT NULL::uuid, p_project_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 100) RETURNS TABLE(group_key text, label text, label_ar text, entry_count bigint, total_amount numeric, paid_amount numeric, outstanding numeric)
    LANGUAGE plpgsql STABLE
    SET search_path TO 'public'
    AS $$
DECLARE
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 100), 1), 500);
BEGIN
  -- Status default: only documents that actually affect the books. A report
  -- that silently included drafts would disagree with the ledger.
  IF p_status IS NULL THEN
    p_status := ARRAY['POSTED', 'PARTIALLY_PAID', 'PAID', 'CLOSED']::public.expense_status[];
  END IF;

  IF p_group_by = 'category' THEN
    RETURN QUERY
    SELECT
      COALESCE(l.category_id::text, 'none'),
      COALESCE(c.name, 'Uncategorised'),
      COALESCE(c.name_ar, c.name, 'غير مصنّف'),
      count(DISTINCT e.id),
      COALESCE(sum(l.gross_amount), 0),
      -- Paid is allocated pro-rata by line share, because a payment settles the
      -- document, not a line. Allocating it any other way (e.g. by category
      -- order) would make the report disagree with the header totals.
      COALESCE(sum(l.gross_amount * CASE
        WHEN e.total_amount > 0 THEN e.paid_amount / e.total_amount ELSE 0 END), 0),
      COALESCE(sum(l.gross_amount * CASE
        WHEN e.total_amount > 0 THEN e.remaining_amount / e.total_amount ELSE 0 END), 0)
    FROM public.expense_lines l
    JOIN public.expense_entries e ON e.id = l.entry_id
    LEFT JOIN public.expense_categories c ON c.id = l.category_id
    WHERE e.status = ANY (p_status)
      AND (p_date_from IS NULL OR e.expense_date >= p_date_from)
      AND (p_date_to   IS NULL OR e.expense_date <= p_date_to)
      AND (p_warehouse_id   IS NULL OR e.warehouse_id   = p_warehouse_id)
      AND (p_cost_center_id IS NULL OR e.cost_center_id = p_cost_center_id)
      AND (p_project_id     IS NULL OR e.project_id     = p_project_id)
    GROUP BY l.category_id, c.name, c.name_ar
    ORDER BY 5 DESC
    LIMIT v_limit;

  ELSIF p_group_by = 'month' THEN
    RETURN QUERY
    SELECT
      to_char(date_trunc('month', e.expense_date), 'YYYY-MM'),
      to_char(date_trunc('month', e.expense_date), 'YYYY-MM'),
      to_char(date_trunc('month', e.expense_date), 'YYYY-MM'),
      count(*),
      COALESCE(sum(e.total_amount), 0),
      COALESCE(sum(e.paid_amount), 0),
      COALESCE(sum(e.remaining_amount), 0)
    FROM public.expense_entries e
    WHERE e.status = ANY (p_status)
      AND (p_date_from IS NULL OR e.expense_date >= p_date_from)
      AND (p_date_to   IS NULL OR e.expense_date <= p_date_to)
      AND (p_warehouse_id   IS NULL OR e.warehouse_id   = p_warehouse_id)
      AND (p_cost_center_id IS NULL OR e.cost_center_id = p_cost_center_id)
      AND (p_project_id     IS NULL OR e.project_id     = p_project_id)
    GROUP BY date_trunc('month', e.expense_date)
    -- Oldest first: a trend chart reads left to right, unlike a ranking table.
    ORDER BY 1 ASC
    LIMIT v_limit;

  ELSIF p_group_by = 'warehouse' THEN
    RETURN QUERY
    SELECT
      COALESCE(e.warehouse_id::text, 'none'),
      COALESCE(w.name, 'Unassigned'),
      COALESCE(w.name_ar, w.name, 'غير محدد'),
      count(*), COALESCE(sum(e.total_amount), 0),
      COALESCE(sum(e.paid_amount), 0), COALESCE(sum(e.remaining_amount), 0)
    FROM public.expense_entries e
    LEFT JOIN public.warehouses w ON w.id = e.warehouse_id
    WHERE e.status = ANY (p_status)
      AND (p_date_from IS NULL OR e.expense_date >= p_date_from)
      AND (p_date_to   IS NULL OR e.expense_date <= p_date_to)
      AND (p_warehouse_id   IS NULL OR e.warehouse_id   = p_warehouse_id)
      AND (p_cost_center_id IS NULL OR e.cost_center_id = p_cost_center_id)
      AND (p_project_id     IS NULL OR e.project_id     = p_project_id)
    GROUP BY e.warehouse_id, w.name, w.name_ar
    ORDER BY 5 DESC
    LIMIT v_limit;

  ELSIF p_group_by = 'cost_center' THEN
    RETURN QUERY
    SELECT
      COALESCE(e.cost_center_id::text, 'none'),
      COALESCE(cc.name, 'Unassigned'),
      COALESCE(cc.name_ar, cc.name, 'غير محدد'),
      count(*), COALESCE(sum(e.total_amount), 0),
      COALESCE(sum(e.paid_amount), 0), COALESCE(sum(e.remaining_amount), 0)
    FROM public.expense_entries e
    LEFT JOIN public.expense_cost_centers cc ON cc.id = e.cost_center_id
    WHERE e.status = ANY (p_status)
      AND (p_date_from IS NULL OR e.expense_date >= p_date_from)
      AND (p_date_to   IS NULL OR e.expense_date <= p_date_to)
      AND (p_warehouse_id   IS NULL OR e.warehouse_id   = p_warehouse_id)
      AND (p_cost_center_id IS NULL OR e.cost_center_id = p_cost_center_id)
      AND (p_project_id     IS NULL OR e.project_id     = p_project_id)
    GROUP BY e.cost_center_id, cc.name, cc.name_ar
    ORDER BY 5 DESC
    LIMIT v_limit;

  ELSIF p_group_by = 'project' THEN
    RETURN QUERY
    SELECT
      COALESCE(e.project_id::text, 'none'),
      COALESCE(pj.name, 'Unassigned'),
      COALESCE(pj.name_ar, pj.name, 'غير محدد'),
      count(*), COALESCE(sum(e.total_amount), 0),
      COALESCE(sum(e.paid_amount), 0), COALESCE(sum(e.remaining_amount), 0)
    FROM public.expense_entries e
    LEFT JOIN public.expense_projects pj ON pj.id = e.project_id
    WHERE e.status = ANY (p_status)
      AND (p_date_from IS NULL OR e.expense_date >= p_date_from)
      AND (p_date_to   IS NULL OR e.expense_date <= p_date_to)
      AND (p_warehouse_id   IS NULL OR e.warehouse_id   = p_warehouse_id)
      AND (p_cost_center_id IS NULL OR e.cost_center_id = p_cost_center_id)
      AND (p_project_id     IS NULL OR e.project_id     = p_project_id)
    GROUP BY e.project_id, pj.name, pj.name_ar
    ORDER BY 5 DESC
    LIMIT v_limit;

  ELSIF p_group_by = 'payee' THEN
    RETURN QUERY
    SELECT
      COALESCE(e.supplier_id::text, e.employee_id::text, e.payee_name, 'none'),
      COALESCE(s.name, pr.full_name, e.payee_name, 'Unnamed payee'),
      COALESCE(s.name, pr.full_name, e.payee_name, 'بدون جهة'),
      count(*), COALESCE(sum(e.total_amount), 0),
      COALESCE(sum(e.paid_amount), 0), COALESCE(sum(e.remaining_amount), 0)
    FROM public.expense_entries e
    LEFT JOIN public.suppliers s ON s.id = e.supplier_id
    LEFT JOIN public.profiles  pr ON pr.id = e.employee_id
    WHERE e.status = ANY (p_status)
      AND (p_date_from IS NULL OR e.expense_date >= p_date_from)
      AND (p_date_to   IS NULL OR e.expense_date <= p_date_to)
      AND (p_warehouse_id   IS NULL OR e.warehouse_id   = p_warehouse_id)
      AND (p_cost_center_id IS NULL OR e.cost_center_id = p_cost_center_id)
      AND (p_project_id     IS NULL OR e.project_id     = p_project_id)
    GROUP BY e.supplier_id, s.name, e.employee_id, pr.full_name, e.payee_name
    ORDER BY 5 DESC
    LIMIT v_limit;

  ELSIF p_group_by = 'status' THEN
    RETURN QUERY
    SELECT
      e.status::text, e.status::text, e.status::text,
      count(*), COALESCE(sum(e.total_amount), 0),
      COALESCE(sum(e.paid_amount), 0), COALESCE(sum(e.remaining_amount), 0)
    FROM public.expense_entries e
    WHERE (p_date_from IS NULL OR e.expense_date >= p_date_from)
      AND (p_date_to   IS NULL OR e.expense_date <= p_date_to)
      AND (p_warehouse_id   IS NULL OR e.warehouse_id   = p_warehouse_id)
      AND (p_cost_center_id IS NULL OR e.cost_center_id = p_cost_center_id)
      AND (p_project_id     IS NULL OR e.project_id     = p_project_id)
      AND (p_status IS NULL OR e.status = ANY (p_status))
    GROUP BY e.status
    ORDER BY 5 DESC
    LIMIT v_limit;

  ELSE
    RAISE EXCEPTION
      'Unsupported group_by: %. Allowed: category, month, warehouse, cost_center, project, payee, status',
      p_group_by
      USING ERRCODE = '22023';
  END IF;
END $$;

--
-- Name: expense_require_override_reason(text); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.expense_require_override_reason(p_reason text) RETURNS text
    LANGUAGE plpgsql IMMUTABLE
    SET search_path TO 'public'
    AS $$
DECLARE
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
BEGIN
  IF v_reason IS NULL THEN
    RAISE EXCEPTION 'A written reason is required to post a draft expense without prior approval'
      USING ERRCODE = '22023';
  END IF;
  IF length(v_reason) < 10 THEN
    RAISE EXCEPTION 'The override reason is too short to be auditable (minimum 10 characters)'
      USING ERRCODE = '22023';
  END IF;
  RETURN v_reason;
END
$$;

--
-- Name: expense_reverse_supplier_ledger(uuid, text, text, uuid, text, text, uuid); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.expense_reverse_supplier_ledger(p_supplier_id uuid, p_source_key text, p_reference_type text, p_reference_id uuid, p_reversal_key text, p_note text DEFAULT NULL::text, p_actor uuid DEFAULT NULL::uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_original public.supplier_ledger;
BEGIN
  IF p_supplier_id IS NULL OR p_source_key IS NULL THEN
    RETURN;
  END IF;
  SELECT * INTO v_original
    FROM public.supplier_ledger
   WHERE source_key = p_source_key;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF v_original.credit > 0 THEN
    PERFORM public.expense_write_supplier_ledger(
      p_supplier_id, 'ADJUSTMENT', 'DEBIT', v_original.credit,
      p_reference_type, p_reference_id, p_reversal_key, NULL, now(),
      coalesce(p_note, 'عكس استحقاق مصروف'), p_actor);
  ELSIF v_original.debit > 0 THEN
    PERFORM public.expense_write_supplier_ledger(
      p_supplier_id, 'ADJUSTMENT', 'CREDIT', v_original.debit,
      p_reference_type, p_reference_id, p_reversal_key, NULL, now(),
      coalesce(p_note, 'عكس سداد مصروف'), p_actor);
  END IF;
END
$$;

--
-- Name: expense_round(numeric); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.expense_round(p_value numeric) RETURNS numeric
    LANGUAGE sql IMMUTABLE
    SET search_path TO 'public'
    AS $$
  -- numeric لا float: الـ 0.005 يجب أن تُدوَّر كما يتوقّع المحاسب، ومجموع مليون
  -- صف لا يجب أن يراكم انزلاق الفاصلة العائمة.
  SELECT round(coalesce(p_value, 0)::numeric, 2)
$$;

--
-- Name: expense_settlement_status(public.expense_status, numeric, numeric); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.expense_settlement_status(p_current public.expense_status, p_paid numeric, p_total numeric) RETURNS public.expense_status
    LANGUAGE sql IMMUTABLE
    SET search_path TO 'public'
    AS $$
  SELECT CASE
    WHEN p_current NOT IN ('POSTED', 'PARTIALLY_PAID', 'PAID') THEN p_current
    WHEN coalesce(p_total, 0) <= 0 THEN p_current
    WHEN coalesce(p_paid, 0) <= 0 THEN 'POSTED'::public.expense_status
    -- Deliberately `>=` on the paid side and `>` on the zero side: a rounding
    -- remainder of less than half a unit must settle as fully paid rather than
    -- leaving a document permanently "partially paid".
    WHEN coalesce(p_paid, 0) >= coalesce(p_total, 0) - 0.005 THEN 'PAID'::public.expense_status
    ELSE 'PARTIALLY_PAID'::public.expense_status
  END
$$;

--
-- Name: expense_write_lines(uuid, jsonb, public.expense_tax_mode); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.expense_write_lines(p_entry_id uuid, p_lines jsonb, p_tax_mode public.expense_tax_mode, OUT o_total numeric, OUT o_count integer) RETURNS record
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
$$;

--
-- Name: expense_write_supplier_ledger(uuid, text, text, numeric, text, uuid, text, date, timestamp with time zone, text, uuid); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.expense_write_supplier_ledger(p_supplier_id uuid, p_entry_type text, p_side text, p_amount numeric, p_reference_type text, p_reference_id uuid, p_source_key text, p_due_date date DEFAULT NULL::date, p_occurred_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_note text DEFAULT NULL::text, p_actor uuid DEFAULT NULL::uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_amount numeric(18,2) := public.expense_round(p_amount);
  v_balance numeric;
BEGIN
  IF p_supplier_id IS NULL OR p_source_key IS NULL THEN
    RETURN;
  END IF;
  IF v_amount <= 0 THEN
    RETURN;
  END IF;
  IF p_side NOT IN ('CREDIT', 'DEBIT') THEN
    RAISE EXCEPTION 'Supplier ledger side must be CREDIT or DEBIT' USING ERRCODE = '22023';
  END IF;

  -- الحجز على ترتيب الرصيد التراكمي: دفتر المورد يُقرأ تسلسلياً في الكشف.
  PERFORM pg_advisory_xact_lock(hashtextextended('supplier_ledger:' || p_supplier_id::text, 0));

  IF p_side = 'CREDIT' THEN
    UPDATE public.suppliers
       SET balance = public.expense_round(coalesce(balance, 0) + v_amount),
           updated_at = now()
     WHERE id = p_supplier_id
    RETURNING balance INTO v_balance;
    IF v_balance IS NULL THEN
      RAISE EXCEPTION 'Supplier % not found', p_supplier_id USING ERRCODE = 'P0002';
    END IF;
  ELSE
    UPDATE public.suppliers
       SET balance = public.expense_round(coalesce(balance, 0) - v_amount),
           updated_at = now()
     WHERE id = p_supplier_id
    RETURNING balance INTO v_balance;
    IF v_balance IS NULL THEN
      RAISE EXCEPTION 'Supplier % not found', p_supplier_id USING ERRCODE = 'P0002';
    END IF;
  END IF;

  INSERT INTO public.supplier_ledger (
    supplier_id, entry_type, debit, credit, balance_after,
    reference_type, reference_id, due_date, occurred_at, created_by, source_key, note
  ) VALUES (
    p_supplier_id, p_entry_type,
    CASE WHEN p_side = 'DEBIT' THEN v_amount ELSE 0 END,
    CASE WHEN p_side = 'CREDIT' THEN v_amount ELSE 0 END,
    v_balance, p_reference_type, p_reference_id, p_due_date,
    coalesce(p_occurred_at, now()), p_actor, p_source_key, p_note
  )
  ON CONFLICT (source_key) DO NOTHING;
END
$$;

--
-- Name: guard_expense_draft_post_reason(); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.guard_expense_draft_post_reason() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF OLD.draft_post_reason IS NOT NULL
     AND NEW.draft_post_reason IS DISTINCT FROM OLD.draft_post_reason THEN
    RAISE EXCEPTION 'A recorded draft-posting override reason cannot be altered'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;

--
-- Name: migrate_legacy_expenses(text, date, date, integer, boolean); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.migrate_legacy_expenses(p_mode text DEFAULT 'draft'::text, p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date, p_batch_size integer DEFAULT 500, p_dry_run boolean DEFAULT true) RETURNS TABLE(processed integer, created integer, skipped integer, failed integer)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_user       uuid := public.expense_actor();
  v_row        record;
  v_entry_id   uuid;
  v_processed  integer := 0;
  v_created    integer := 0;
  v_skipped    integer := 0;
  v_failed     integer := 0;
  v_status     public.expense_status;
  v_payment    public.payment_method;
  v_batch      integer := LEAST(GREATEST(COALESCE(p_batch_size, 500), 1), 5000);
BEGIN
  -- A data migration is an owner/manager action. `expense.post` is the closest
  -- existing capability in weight: it decides whether a number reaches the books.
  PERFORM public.expense_assert_capability(v_user, 'expense.post');

  IF p_mode NOT IN ('draft', 'unpaid', 'paid') THEN
    RAISE EXCEPTION 'mode must be draft, unpaid or paid (got %)', p_mode
      USING ERRCODE = '22023';
  END IF;

  v_status := CASE p_mode
                WHEN 'draft'  THEN 'DRAFT'::public.expense_status
                ELSE 'POSTED'::public.expense_status
              END;

  FOR v_row IN
    SELECT x.*
    FROM public.expenses x
    -- The NOT EXISTS is the idempotency guard and it is the reason a re-run is
    -- free: an already-bridged row is never revisited, so its document is never
    -- duplicated and its approval history is never rewritten.
    WHERE NOT EXISTS (
      SELECT 1 FROM public.expense_entries e WHERE e.legacy_expense_id = x.id
    )
      AND (p_from IS NULL OR x.expense_date >= p_from)
      AND (p_to   IS NULL OR x.expense_date <= p_to)
    ORDER BY x.expense_date, x.created_at
    LIMIT v_batch
  LOOP
    v_processed := v_processed + 1;

    BEGIN
      -- A zero-amount legacy row cannot become a valid document (the foundation
      -- requires a positive total) and carries no information. Counted rather
      -- than silently dropped, so the operator sees the number and can decide.
      IF COALESCE(v_row.amount, 0) <= 0 THEN
        v_skipped := v_skipped + 1;
        CONTINUE;
      END IF;

      INSERT INTO public.expense_entries (
        reference, entry_type, status, source_kind,
        payee_type, expense_date,
        description, note,
        total_amount, tax_mode, currency, currency_symbol,
        created_by, legacy_expense_id,
        posting_date, posted_by, posted_at
      )
      VALUES (
        -- The legacy row keeps its own id in the reference, so an operator can
        -- still find a document in the new register using the number they have
        -- always quoted: EXP-LEG-<first 8 of the legacy uuid>.
        'EXP-LEG-' || upper(left(replace(v_row.id::text, '-', ''), 8)),
        'DIRECT',
        v_status,
        'LEGACY',
        'NONE',
        v_row.expense_date,
        COALESCE(
          NULLIF(btrim(COALESCE(v_row.note, '')), ''),
          (SELECT COALESCE(c.name_ar, c.name) FROM public.expense_categories c
            WHERE c.id = v_row.category_id),
          'Migrated expense'
        ),
        v_row.note,
        public.expense_round(v_row.amount),
        'NONE',
        COALESCE((SELECT NULLIF(btrim(currency), '') FROM public.company_settings ORDER BY id LIMIT 1), 'YER'),
        COALESCE((SELECT NULLIF(btrim(currency_symbol), '') FROM public.company_settings ORDER BY id LIMIT 1), '﷼'),
        -- `created_by` is deliberately NOT taken from the legacy row: the
        -- original author may have been deleted, and a null creator is honest.
        -- The actor performing the migration is recorded in the audit trail
        -- instead, which is where attribution for a migration belongs.
        NULL,
        v_row.id,
        CASE WHEN v_status = 'POSTED' THEN v_row.expense_date END,
        CASE WHEN v_status = 'POSTED' THEN v_user END,
        CASE WHEN v_status = 'POSTED' THEN now() END
      )
      RETURNING id INTO v_entry_id;

      -- One line per legacy row: the old model could only express one amount,
      -- so inventing a split would be fabricating structure that was never
      -- there. What it DID record — the amount, the category and the note — is
      -- preserved exactly.
      INSERT INTO public.expense_lines (
        entry_id, line_no, description, category_id, quantity, unit_price,
        net_amount, tax_rate, tax_amount, gross_amount
      )
      VALUES (
        v_entry_id, 1,
        NULLIF(btrim(COALESCE(v_row.note, '')), ''),
        v_row.category_id, 1, public.expense_round(v_row.amount),
        public.expense_round(v_row.amount), 0, 0,
        public.expense_round(v_row.amount)
      );

      -- `credit` is the one legacy value that unambiguously means "not settled",
      -- so it overrides the 'paid' mode rather than being overruled by it.
      IF p_mode = 'paid' AND v_row.payment_method IS DISTINCT FROM 'credit' THEN
        v_payment := COALESCE(v_row.payment_method, 'cash');

        INSERT INTO public.expense_payments (
          entry_id, amount, payment_date, payment_method, note,
          idempotency_key, created_by
        )
        VALUES (
          v_entry_id, public.expense_round(v_row.amount),
          -- The legacy table records when the row was typed, not when it was
          -- paid; used as the closest available evidence and labelled as such.
          v_row.expense_date,
          v_payment,
          'Migrated from legacy expense ' || v_row.id::text,
          'legacy:' || v_row.id::text,
          v_user
        )
        ON CONFLICT DO NOTHING;
      END IF;

      INSERT INTO public.expense_approvals (
        entry_id, sequence, action, from_status, to_status, actor_id, reason
      )
      VALUES (
        v_entry_id, 1,
        CASE WHEN v_status = 'POSTED' THEN 'posted' ELSE 'created' END,
        NULL, v_status, v_user,
        'Migrated from legacy expense ' || v_row.id::text || ' (mode: ' || p_mode || ')'
      );

      v_created := v_created + 1;
    EXCEPTION WHEN OTHERS THEN
      -- One bad row must not abort the batch. The failure is counted and the
      -- message is raised as a notice so it reaches the operator's log without
      -- rolling back the rows that succeeded.
      v_failed := v_failed + 1;
      RAISE WARNING 'legacy expense % could not be migrated: %', v_row.id, SQLERRM;
    END;
  END LOOP;

  -- A dry run performs identical work and then throws it away. That is the
  -- point: the validation, the reference generation and the line arithmetic are
  -- exercised exactly as they would be for real, so a dry run actually proves
  -- something. The exception below is caught by the caller, not an error path.
  IF p_dry_run THEN
    RAISE EXCEPTION 'DRY RUN: % processed, % would be created, % skipped, % failed — nothing was written',
      v_processed, v_created, v_skipped, v_failed
      USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.audit_logs (actor_id, action, entity_type, payload)
  VALUES (v_user, 'expense.legacy.migrated', 'expense_entry',
          jsonb_build_object(
            'mode', p_mode, 'processed', v_processed, 'created', v_created,
            'skipped', v_skipped, 'failed', v_failed,
            'from', p_from, 'to', p_to));

  RETURN QUERY SELECT v_processed, v_created, v_skipped, v_failed;
END $$;

--
-- Name: expense_approval_rules; Type: TABLE; Schema: public; Owner: supabase_admin
--

CREATE TABLE public.expense_approval_rules (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    min_amount numeric(18,2) NOT NULL,
    required_role_rank integer NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT expense_approval_rules_min_amount_check CHECK ((min_amount >= (0)::numeric)),
    CONSTRAINT expense_approval_rules_required_role_rank_check CHECK ((required_role_rank = ANY (ARRAY[40, 50])))
);

--
-- Name: save_expense_dimension(text, uuid, text, text, text, boolean); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.save_expense_dimension(p_kind text, p_id uuid DEFAULT NULL::uuid, p_code text DEFAULT NULL::text, p_name text DEFAULT NULL::text, p_name_ar text DEFAULT NULL::text, p_is_active boolean DEFAULT NULL::boolean) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_user uuid := public.expense_actor();
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
  v_code text := nullif(btrim(coalesce(p_code, '')), '');
  v_row  jsonb;
BEGIN
  PERFORM public.expense_assert_capability(v_user, 'expense.dimension.manage');

  IF p_kind NOT IN ('cost_center', 'project') THEN
    RAISE EXCEPTION 'Unknown dimension kind: %', p_kind USING ERRCODE = '22023';
  END IF;
  IF p_id IS NULL AND v_name IS NULL THEN
    RAISE EXCEPTION 'A name is required' USING ERRCODE = '22023';
  END IF;

  IF p_kind = 'cost_center' THEN
    IF p_id IS NULL THEN
      INSERT INTO public.expense_cost_centers (code, name, name_ar, is_active, created_by)
      VALUES (v_code, v_name, nullif(btrim(coalesce(p_name_ar, '')), ''),
              COALESCE(p_is_active, true), v_user)
      RETURNING to_jsonb(expense_cost_centers.*) INTO v_row;
    ELSE
      UPDATE public.expense_cost_centers
         SET code      = CASE WHEN p_code IS NULL THEN code ELSE v_code END,
             name      = COALESCE(v_name, name),
             name_ar   = CASE WHEN p_name_ar IS NULL THEN name_ar
                              ELSE nullif(btrim(p_name_ar), '') END,
             is_active = COALESCE(p_is_active, is_active)
       WHERE id = p_id
      RETURNING to_jsonb(expense_cost_centers.*) INTO v_row;

      IF v_row IS NULL THEN
        RAISE EXCEPTION 'Cost centre not found' USING ERRCODE = 'P0002';
      END IF;
    END IF;
  ELSE
    IF p_id IS NULL THEN
      INSERT INTO public.expense_projects (code, name, name_ar, is_active, created_by)
      VALUES (v_code, v_name, nullif(btrim(coalesce(p_name_ar, '')), ''),
              COALESCE(p_is_active, true), v_user)
      RETURNING to_jsonb(expense_projects.*) INTO v_row;
    ELSE
      UPDATE public.expense_projects
         SET code      = CASE WHEN p_code IS NULL THEN code ELSE v_code END,
             name      = COALESCE(v_name, name),
             name_ar   = CASE WHEN p_name_ar IS NULL THEN name_ar
                              ELSE nullif(btrim(p_name_ar), '') END,
             is_active = COALESCE(p_is_active, is_active)
       WHERE id = p_id
      RETURNING to_jsonb(expense_projects.*) INTO v_row;

      IF v_row IS NULL THEN
        RAISE EXCEPTION 'Project not found' USING ERRCODE = 'P0002';
      END IF;
    END IF;
  END IF;

  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, payload)
  VALUES (v_user, 'expense.' || p_kind || '.' || CASE WHEN p_id IS NULL THEN 'created' ELSE 'updated' END,
          'expense_' || p_kind, (v_row ->> 'id')::uuid, v_row);

  RETURN v_row;
END $$;

--
-- Name: set_expense_ledger_account(text, uuid); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.set_expense_ledger_account(p_role text, p_account_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
$$;

--
-- Name: set_production_expense_category_eligibility(uuid, boolean); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.set_production_expense_category_eligibility(p_category_id uuid, p_eligible boolean) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_user uuid := public.expense_actor();
  v_name text;
  v_account_type text;
  v_account_active boolean;
  v_account_postable boolean;
BEGIN
  PERFORM public.expense_assert_capability(v_user,'expense.category.manage');
  IF p_category_id IS NULL OR p_eligible IS NULL THEN
    RAISE EXCEPTION 'اختر تصنيف المصروف وحالة الأهلية' USING ERRCODE='22023';
  END IF;
  SELECT coalesce(c.name_ar,c.name),a.account_type::text,a.is_active,a.is_postable
    INTO v_name,v_account_type,v_account_active,v_account_postable
    FROM public.expense_categories c LEFT JOIN public.accounts a ON a.id=c.account_id
   WHERE c.id=p_category_id FOR UPDATE OF c;
  IF NOT FOUND THEN RAISE EXCEPTION 'تصنيف المصروف غير موجود' USING ERRCODE='P0002'; END IF;
  IF p_eligible AND (v_account_type IS DISTINCT FROM 'EXPENSE'
     OR v_account_active IS NOT TRUE OR v_account_postable IS NOT TRUE) THEN
    RAISE EXCEPTION 'اربط التصنيف بحساب مصروف نشط وقابل للترحيل قبل تأهيله للإنتاج';
  END IF;
  UPDATE public.expense_categories SET production_cost_eligible=p_eligible WHERE id=p_category_id;
  INSERT INTO public.audit_logs(actor_id,action,entity_type,entity_id,payload)
  VALUES(v_user,'expense.category.production_eligibility_changed','expense_category',p_category_id,
    jsonb_build_object('name',v_name,'production_cost_eligible',p_eligible));
  RETURN p_eligible;
END;
$$;

--
-- Name: tg_expense_capture_approval_rank(); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.tg_expense_capture_approval_rank() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF NEW.status = 'SUBMITTED' THEN
    NEW.approval_required_rank := public.expense_required_approval_rank(NEW.total_amount);
  END IF;
  RETURN NEW;
END;
$$;

--
-- Name: tg_expense_entries_guard(); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.tg_expense_entries_guard() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  -- Only guard documents that have actually been recognized. A draft is meant
  -- to be edited; a posted document is evidence.
  IF OLD.status NOT IN ('POSTED', 'PARTIALLY_PAID', 'PAID', 'CLOSED', 'REVERSED')
     AND NEW.status NOT IN ('POSTED', 'PARTIALLY_PAID', 'PAID', 'CLOSED', 'REVERSED') THEN
    RETURN NEW;
  END IF;

  -- The exception is the reversal flow, which legitimately links a posted row
  -- to its compensating document; everything else about it stays frozen.
  IF NEW.total_amount  IS DISTINCT FROM OLD.total_amount
     OR NEW.expense_date IS DISTINCT FROM OLD.expense_date
     OR NEW.entry_type   IS DISTINCT FROM OLD.entry_type
     OR NEW.supplier_id  IS DISTINCT FROM OLD.supplier_id
     OR NEW.employee_id  IS DISTINCT FROM OLD.employee_id
     OR NEW.payee_type   IS DISTINCT FROM OLD.payee_type
     OR NEW.currency     IS DISTINCT FROM OLD.currency THEN
    RAISE EXCEPTION
      'Expense % is posted: its financial fields are immutable. Reverse it instead.',
      OLD.reference
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END $$;

--
-- Name: tg_expense_lines_sync_total(); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.tg_expense_lines_sync_total() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_entry_id uuid := COALESCE(NEW.entry_id, OLD.entry_id);
  v_status   public.expense_status;
  v_total    numeric(18,2);
  v_lines    integer;
BEGIN
  SELECT status INTO v_status FROM public.expense_entries WHERE id = v_entry_id;

  -- A posted document's lines are frozen evidence; leave its header alone.
  IF v_status IN ('POSTED', 'PARTIALLY_PAID', 'PAID', 'CLOSED', 'REVERSED') THEN
    RETURN NULL;
  END IF;

  SELECT COALESCE(sum(gross_amount), 0)::numeric(18,2), count(*)
    INTO v_total, v_lines
  FROM public.expense_lines
  WHERE entry_id = v_entry_id;

  UPDATE public.expense_entries
     SET total_amount = v_total,
         line_count   = v_lines
   WHERE id = v_entry_id
     AND status NOT IN ('POSTED', 'PARTIALLY_PAID', 'PAID', 'CLOSED', 'REVERSED');

  RETURN NULL;
END $$;

--
-- Name: expense_approvals; Type: TABLE; Schema: public; Owner: supabase_admin
--

CREATE TABLE public.expense_approvals (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    entry_id uuid NOT NULL,
    sequence integer NOT NULL,
    action text NOT NULL,
    from_status public.expense_status,
    to_status public.expense_status NOT NULL,
    actor_id uuid,
    reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT expense_approvals_action_known CHECK ((action = ANY (ARRAY['created'::text, 'updated'::text, 'submitted'::text, 'approved'::text, 'rejected'::text, 'posted'::text, 'payment'::text, 'cancelled'::text, 'reversed'::text, 'closed'::text, 'reopened'::text]))),
    CONSTRAINT expense_approvals_sequence_positive CHECK ((sequence > 0)),
    CONSTRAINT expense_approvals_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES auth.users(id) ON DELETE SET NULL
);

--
-- Name: expense_attachments; Type: TABLE; Schema: public; Owner: supabase_admin
--

CREATE TABLE public.expense_attachments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    entry_id uuid NOT NULL,
    line_id uuid,
    bucket_id text DEFAULT 'expense-attachments'::text NOT NULL,
    storage_path text NOT NULL,
    file_name text NOT NULL,
    mime_type text,
    file_size bigint,
    checksum text,
    uploaded_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT expense_attachments_size_positive CHECK (((file_size IS NULL) OR (file_size > 0))),
    CONSTRAINT expense_attachments_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES auth.users(id) ON DELETE SET NULL
);

--
-- Name: expense_cost_centers; Type: TABLE; Schema: public; Owner: supabase_admin
--

CREATE TABLE public.expense_cost_centers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    code text,
    name text NOT NULL,
    name_ar text,
    is_active boolean DEFAULT true NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT expense_cost_centers_name_not_blank CHECK ((btrim(name) <> ''::text)),
    CONSTRAINT expense_cost_centers_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL
);

--
-- Name: expense_ledger_account_mappings; Type: TABLE; Schema: public; Owner: supabase_admin
--

CREATE TABLE public.expense_ledger_account_mappings (
    role text NOT NULL,
    account_id uuid NOT NULL,
    updated_by uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT expense_ledger_account_mappings_role_check CHECK ((role = ANY (ARRAY['INPUT_TAX'::text, 'SUPPLIER_PAYABLE'::text, 'EMPLOYEE_PAYABLE'::text, 'OTHER_PAYABLE'::text])))
);

--
-- Name: expense_lines; Type: TABLE; Schema: public; Owner: supabase_admin
--

CREATE TABLE public.expense_lines (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    entry_id uuid NOT NULL,
    line_no integer NOT NULL,
    description text,
    category_id uuid,
    quantity numeric(18,3) DEFAULT 1 NOT NULL,
    unit_price numeric(18,2) DEFAULT 0 NOT NULL,
    net_amount numeric(18,2) DEFAULT 0 NOT NULL,
    tax_rate numeric(5,2) DEFAULT 0 NOT NULL,
    tax_amount numeric(18,2) DEFAULT 0 NOT NULL,
    gross_amount numeric(18,2) DEFAULT 0 NOT NULL,
    cost_center_id uuid,
    project_id uuid,
    note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT expense_lines_amounts_add_up CHECK ((abs(((net_amount + tax_amount) - gross_amount)) <= 0.01)),
    CONSTRAINT expense_lines_amounts_non_negative CHECK (((net_amount >= (0)::numeric) AND (tax_amount >= (0)::numeric) AND (gross_amount >= (0)::numeric))),
    CONSTRAINT expense_lines_line_no_positive CHECK ((line_no > 0)),
    CONSTRAINT expense_lines_quantity_positive CHECK ((quantity > (0)::numeric)),
    CONSTRAINT expense_lines_tax_rate_range CHECK (((tax_rate >= (0)::numeric) AND (tax_rate <= (100)::numeric))),
    CONSTRAINT expense_lines_unit_price_non_negative CHECK ((unit_price >= (0)::numeric))
);

--
-- Name: expenses; Type: TABLE; Schema: public; Owner: supabase_admin
--

CREATE TABLE public.expenses (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    category_id uuid,
    amount numeric NOT NULL,
    payment_method public.payment_method DEFAULT 'cash'::public.payment_method NOT NULL,
    expense_date date DEFAULT CURRENT_DATE NOT NULL,
    note text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT expenses_amount_check CHECK ((amount >= (0)::numeric)),
    CONSTRAINT expenses_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL
);

--
-- Name: expense_payments; Type: TABLE; Schema: public; Owner: supabase_admin
--

CREATE TABLE public.expense_payments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    entry_id uuid NOT NULL,
    amount numeric(18,2) NOT NULL,
    payment_date date DEFAULT CURRENT_DATE NOT NULL,
    payment_method public.payment_method DEFAULT 'cash'::public.payment_method NOT NULL,
    account_label text,
    reference_no text,
    note text,
    idempotency_key text,
    reversed_by uuid,
    reversal_of uuid,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    account_id uuid,
    cashbox_id uuid,
    bank_account_id uuid,
    payment_method_id text,
    CONSTRAINT expense_payments_amount_positive CHECK ((amount > (0)::numeric)),
    CONSTRAINT expense_payments_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL
);

--
-- Name: expense_projects; Type: TABLE; Schema: public; Owner: supabase_admin
--

CREATE TABLE public.expense_projects (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    code text,
    name text NOT NULL,
    name_ar text,
    is_active boolean DEFAULT true NOT NULL,
    started_on date,
    closed_on date,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT expense_projects_name_not_blank CHECK ((btrim(name) <> ''::text)),
    CONSTRAINT expense_projects_window_valid CHECK (((closed_on IS NULL) OR (started_on IS NULL) OR (closed_on >= started_on))),
    CONSTRAINT expense_projects_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL
);

--
-- Name: expense_reference_seq; Type: SEQUENCE; Schema: public; Owner: supabase_admin
--

CREATE SEQUENCE public.expense_reference_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: can_read_expense_entry(uuid, uuid); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.can_read_expense_entry(p_entry_id uuid, p_user uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT public.can_read_finance(p_user)
      OR (public.is_staff(p_user) AND EXISTS (
            SELECT 1 FROM public.expense_entries e
            WHERE e.id = p_entry_id AND e.created_by = p_user))
$$;


--
-- Name: COLUMN expense_entries.allow_draft_post; Type: COMMENT; Schema: public; Owner: supabase_admin
--

COMMENT ON COLUMN public.expense_entries.allow_draft_post IS 'يُفعَّل حصراً داخل decide_expense عند اعتماد مسودة مباشرة؛ post_expense يرفض DRAFT إن لم يكن مفعّلاً.';

--
-- Name: COLUMN expense_entries.draft_post_reason; Type: COMMENT; Schema: public; Owner: supabase_admin
--

COMMENT ON COLUMN public.expense_entries.draft_post_reason IS 'سبب تجاوز maker-checker المسجّل لحظة الاعتماد المباشر للمسودة، للتدقيق.';

--
-- Name: cancel_expense(uuid, text, integer); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.cancel_expense(p_entry_id uuid, p_reason text, p_expected_version integer DEFAULT NULL::integer) RETURNS public.expense_entries
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_user  uuid := public.expense_actor();
  v_entry public.expense_entries;
  v_from  public.expense_status;
BEGIN
  SELECT * INTO v_entry FROM public.expense_entries WHERE id = p_entry_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Expense not found' USING ERRCODE = 'P0002';
  END IF;

  v_from := v_entry.status;

  IF NULLIF(btrim(COALESCE(p_reason, '')), '') IS NULL THEN
    RAISE EXCEPTION 'A reason is required when cancelling an expense' USING ERRCODE = '22023';
  END IF;

  IF v_from IN ('POSTED', 'PARTIALLY_PAID', 'PAID', 'CLOSED', 'REVERSED') THEN
    RAISE EXCEPTION 'A posted expense cannot be cancelled — reverse it instead'
      USING ERRCODE = '55000';
  END IF;

  IF v_from = 'CANCELLED' THEN
    RETURN v_entry;   -- idempotent
  END IF;

  IF v_from NOT IN ('DRAFT', 'REJECTED', 'SUBMITTED', 'APPROVED') THEN
    RAISE EXCEPTION 'This expense cannot be cancelled from status %', v_from
      USING ERRCODE = '55000';
  END IF;

  -- Cancelling someone else's submitted document is a management decision, not
  -- a data-entry correction.
  IF NOT (v_entry.created_by = v_user AND v_from IN ('DRAFT', 'REJECTED')) THEN
    PERFORM public.expense_assert_capability(v_user, 'expense.cancel');
  ELSE
    PERFORM public.expense_assert_capability(v_user, 'expense.edit');
  END IF;

  IF p_expected_version IS NOT NULL AND p_expected_version <> v_entry.version THEN
    RAISE EXCEPTION 'This expense was changed by someone else. Reload it and try again.'
      USING ERRCODE = '40001';
  END IF;

  UPDATE public.expense_entries
     SET status        = 'CANCELLED',
         cancelled_by  = v_user,
         cancelled_at  = now(),
         cancel_reason = nullif(btrim(p_reason), ''),
         version       = version + 1
   WHERE id = p_entry_id
  RETURNING * INTO v_entry;

  PERFORM public.expense_log_action(p_entry_id, 'cancelled', v_from, 'CANCELLED', p_reason, v_user);

  RETURN v_entry;
END $$;

--
-- Name: close_expense(uuid); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.close_expense(p_entry_id uuid) RETURNS public.expense_entries
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_user  uuid := public.expense_actor();
  v_entry public.expense_entries;
BEGIN
  SELECT * INTO v_entry FROM public.expense_entries WHERE id = p_entry_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Expense not found' USING ERRCODE = 'P0002';
  END IF;

  PERFORM public.expense_assert_capability(v_user, 'expense.post');

  IF v_entry.status = 'CLOSED' THEN
    RETURN v_entry;
  END IF;
  IF v_entry.status NOT IN ('POSTED', 'PARTIALLY_PAID', 'PAID') THEN
    RAISE EXCEPTION 'Only a posted expense can be closed (current: %)', v_entry.status
      USING ERRCODE = '55000';
  END IF;
  IF v_entry.remaining_amount > 0.005 THEN
    RAISE EXCEPTION 'This expense still has % outstanding', v_entry.remaining_amount
      USING ERRCODE = '55000';
  END IF;

  UPDATE public.expense_entries
     SET status = 'CLOSED', version = version + 1
   WHERE id = p_entry_id
  RETURNING * INTO v_entry;

  PERFORM public.expense_log_action(p_entry_id, 'closed', 'PAID', 'CLOSED', NULL, v_user);

  RETURN v_entry;
END $$;

--
-- Name: decide_expense(uuid, boolean, text, integer); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.decide_expense(p_entry_id uuid, p_approve boolean, p_reason text DEFAULT NULL::text, p_expected_version integer DEFAULT NULL::integer) RETURNS public.expense_entries
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_user uuid := public.expense_actor();
  v_entry public.expense_entries;
  v_action text := CASE WHEN p_approve THEN 'approve' ELSE 'reject' END;
  v_target public.expense_status;
  v_from public.expense_status;
  v_user_rank integer;
  v_reason text;
BEGIN
  IF p_approve IS NULL THEN
    RAISE EXCEPTION 'Choose whether to approve or reject this expense' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_entry FROM public.expense_entries WHERE id = p_entry_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Expense not found' USING ERRCODE = 'P0002'; END IF;
  IF v_entry.status NOT IN ('SUBMITTED', 'DRAFT') THEN
    RAISE EXCEPTION 'This expense is not awaiting approval (current: %)', v_entry.status
      USING ERRCODE = '55000';
  END IF;
  PERFORM public.expense_assert_capability(v_user, 'expense.' || v_action);
  IF p_expected_version IS NOT NULL AND p_expected_version <> v_entry.version THEN
    RAISE EXCEPTION 'This expense was changed by someone else. Reload it and try again.'
      USING ERRCODE = '40001';
  END IF;
  v_user_rank := public.expense_role_rank(v_user);
  IF v_user_rank < v_entry.approval_required_rank THEN
    RAISE EXCEPTION 'This expense requires approval from a higher role based on its amount'
      USING ERRCODE = '42501';
  END IF;
  -- المسار المباشر (DRAFT): لا يعتمد المنشئ مصروفه بنفسه إلا إذا كان مالكاً
  -- ويكتب سبباً موثقاً؛ المحاسب/المدير لا يمرران maker-checker على مستنديهما.
  IF v_entry.created_by = v_user
     AND NOT (public.has_role(v_user, 'owner') AND v_entry.status = 'DRAFT') THEN
    RAISE EXCEPTION 'You cannot approve an expense you created yourself' USING ERRCODE = '42501';
  END IF;

  IF p_approve THEN
    v_reason := nullif(btrim(coalesce(p_reason, '')), '');
    IF v_reason IS NULL AND v_entry.status = 'DRAFT' THEN
      RAISE EXCEPTION 'A written reason is required to approve a draft expense directly'
        USING ERRCODE = '22023';
    END IF;
    IF v_entry.created_by = v_user AND public.has_role(v_user, 'owner') THEN
      v_reason := coalesce(v_reason, 'Self-approved by owner (no other approver available)');
    END IF;
  ELSE
    v_reason := nullif(btrim(coalesce(p_reason, '')), '');
    IF v_reason IS NULL THEN
      RAISE EXCEPTION 'A reason is required when rejecting an expense' USING ERRCODE = '22023';
    END IF;
  END IF;

  v_target := CASE WHEN p_approve THEN 'APPROVED'::public.expense_status
                   ELSE 'REJECTED'::public.expense_status END;
  v_from := v_entry.status;
  UPDATE public.expense_entries
     SET status = v_target,
         version = version + 1,
         allow_draft_post = CASE WHEN p_approve AND v_entry.status = 'DRAFT' THEN true ELSE allow_draft_post END,
         draft_post_reason = CASE WHEN p_approve AND v_entry.status = 'DRAFT' THEN v_reason ELSE draft_post_reason END,
         approved_by = CASE WHEN p_approve THEN v_user END,
         approved_at = CASE WHEN p_approve THEN now() END,
         submitted_by = CASE WHEN p_approve AND v_entry.status = 'DRAFT' THEN v_user ELSE submitted_by END,
         submitted_at = CASE WHEN p_approve AND v_entry.status = 'DRAFT' THEN now() ELSE submitted_at END,
         rejected_by = CASE WHEN NOT p_approve THEN v_user END,
         rejected_at = CASE WHEN NOT p_approve THEN now() END,
         rejection_reason = CASE WHEN NOT p_approve THEN v_reason END,
         cancelled_by = NULL,
         cancelled_at = NULL,
         cancel_reason = NULL
   WHERE id = p_entry_id
  RETURNING * INTO v_entry;

  PERFORM public.expense_log_action(p_entry_id, v_action, v_from, v_target, v_reason, v_user);
  RETURN v_entry;
END;
$$;

--
-- Name: expense_can_write_document(uuid, uuid); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.expense_can_write_document(p_entry_id uuid, p_user uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.expense_entries e
    WHERE e.id = p_entry_id
      AND (
        -- An approver or accountant can act on any document.
        public.expense_role_rank(p_user) >= 30
        -- Everyone else can act only on a document they own, and only while it
        -- is still theirs to change. Posted documents are frozen for all.
        OR (e.created_by = p_user AND e.status IN ('DRAFT', 'REJECTED'))
      )
  )
$$;

--
-- Name: expense_summary(date, date, uuid); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.expense_summary(p_date_from date DEFAULT NULL::date, p_date_to date DEFAULT NULL::date, p_warehouse_id uuid DEFAULT NULL::uuid) RETURNS jsonb
    LANGUAGE sql STABLE
    SET search_path TO 'public'
    AS $$
  WITH scoped AS (
    SELECT e.*
    FROM public.expense_entries e
    WHERE (p_date_from IS NULL OR e.expense_date >= p_date_from)
      AND (p_date_to   IS NULL OR e.expense_date <= p_date_to)
      AND (p_warehouse_id IS NULL OR e.warehouse_id = p_warehouse_id)
      AND e.status NOT IN ('CANCELLED', 'REVERSED')
  )
  SELECT jsonb_build_object(
    'period_total',      COALESCE(sum(total_amount), 0),
    'posted_total',      COALESCE(sum(total_amount) FILTER (
                           WHERE status IN ('POSTED', 'PARTIALLY_PAID', 'PAID', 'CLOSED')), 0),
    'paid_total',        COALESCE(sum(paid_amount), 0),
    'outstanding_total', COALESCE(sum(remaining_amount) FILTER (
                           WHERE status IN ('POSTED', 'PARTIALLY_PAID') AND remaining_amount > 0.005), 0),
    'pending_total',     COALESCE(sum(total_amount) FILTER (WHERE status = 'SUBMITTED'), 0),
    'draft_total',       COALESCE(sum(total_amount) FILTER (WHERE status IN ('DRAFT', 'REJECTED')), 0),
    'total_count',       count(*),
    'pending_count',     count(*) FILTER (WHERE status = 'SUBMITTED'),
    'unpaid_count',      count(*) FILTER (WHERE status = 'POSTED'),
    'partial_count',     count(*) FILTER (WHERE status = 'PARTIALLY_PAID'),
    'paid_count',        count(*) FILTER (WHERE status IN ('PAID', 'CLOSED')),
    'draft_count',       count(*) FILTER (WHERE status IN ('DRAFT', 'REJECTED')),
    'overdue_count',     count(*) FILTER (
                           WHERE status IN ('POSTED', 'PARTIALLY_PAID')
                             AND due_date IS NOT NULL
                             AND due_date < CURRENT_DATE
                             AND remaining_amount > 0.005),
    'overdue_total',     COALESCE(sum(remaining_amount) FILTER (
                           WHERE status IN ('POSTED', 'PARTIALLY_PAID')
                             AND due_date IS NOT NULL
                             AND due_date < CURRENT_DATE
                             AND remaining_amount > 0.005), 0)
  )
  FROM scoped$$;

--
-- Name: reverse_expense(uuid, text); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.reverse_expense(p_entry_id uuid, p_reason text DEFAULT NULL::text) RETURNS public.expense_entries
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_user     uuid := public.expense_actor();
  v_entry    public.expense_entries;
  v_reversal public.expense_entries;
  v_original uuid;
BEGIN
  SELECT * INTO v_entry FROM public.expense_entries WHERE id = p_entry_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Expense not found' USING ERRCODE = 'P0002';
  END IF;

  PERFORM public.expense_assert_capability(v_user, 'expense.reverse');

  IF v_entry.status = 'REVERSED' THEN
    RETURN v_entry;   -- idempotent: reversing twice is a no-op, not an error
  END IF;
  IF v_entry.status NOT IN ('POSTED', 'PARTIALLY_PAID', 'PAID') THEN
    RAISE EXCEPTION 'Only a posted expense can be reversed (current: %)', v_entry.status
      USING ERRCODE = '55000';
  END IF;
  IF v_entry.paid_amount > 0 THEN
    RAISE EXCEPTION 'Reverse the recorded payments first (paid: %)', v_entry.paid_amount
      USING ERRCODE = '55000';
  END IF;

  SELECT je.id INTO v_original
    FROM public.journal_entries je
   WHERE je.source_type = 'expense' AND je.source_id = p_entry_id
     AND je.status <> 'REVERSED';
  IF v_original IS NOT NULL THEN
    PERFORM public.reverse_journal_entry(v_original,
      COALESCE(NULLIF(btrim(COALESCE(p_reason, '')), ''), 'عكس المصروف'));
  END IF;

  INSERT INTO public.expense_entries (
    reference, entry_type, status, source_kind,
    payee_type, payee_name, supplier_id, employee_id,
    warehouse_id, cost_center_id, project_id,
    expense_date, posting_date, description, note,
    tax_mode, tax_recoverable, currency, currency_symbol,
    reversal_of, created_by, posted_by, posted_at
  )
  VALUES (
    v_entry.reference || '-R',
    v_entry.entry_type,
    'POSTED',
    v_entry.source_kind,
    v_entry.payee_type, v_entry.payee_name, v_entry.supplier_id, v_entry.employee_id,
    v_entry.warehouse_id, v_entry.cost_center_id, v_entry.project_id,
    CURRENT_DATE, CURRENT_DATE,
    'Reversal of ' || v_entry.reference,
    nullif(btrim(coalesce(p_reason, '')), ''),
    v_entry.tax_mode, v_entry.tax_recoverable, v_entry.currency, v_entry.currency_symbol,
    v_entry.id, v_user, v_user, now()
  )
  RETURNING * INTO v_reversal;

  INSERT INTO public.expense_lines (
    entry_id, line_no, description, category_id, quantity, unit_price,
    net_amount, tax_rate, tax_amount, gross_amount,
    cost_center_id, project_id, note
  )
  SELECT
    v_reversal.id, line_no, description, category_id, quantity, unit_price,
    net_amount, tax_rate, tax_amount, gross_amount,
    cost_center_id, project_id, note
  FROM public.expense_lines
  WHERE entry_id = p_entry_id
  ORDER BY line_no;

  UPDATE public.expense_entries
     SET total_amount = v_entry.total_amount,
         line_count   = v_entry.line_count
   WHERE id = v_reversal.id
  RETURNING * INTO v_reversal;

  UPDATE public.expense_entries
     SET status         = 'REVERSED',
         reversed_by_id = v_reversal.id,
         version        = version + 1
   WHERE id = p_entry_id
  RETURNING * INTO v_entry;

  IF v_entry.payee_type = 'SUPPLIER' AND v_entry.supplier_id IS NOT NULL THEN
    PERFORM public.expense_reverse_supplier_ledger(
      v_entry.supplier_id, 'EXP-' || p_entry_id::text, 'expense', p_entry_id,
      'EXP-REV-' || p_entry_id::text, 'عكس مصروف ' || v_entry.reference, v_user);
  END IF;

  PERFORM public.expense_log_action(
    p_entry_id, 'reversed', 'POSTED', 'REVERSED',
    COALESCE(NULLIF(btrim(COALESCE(p_reason, '')), ''), 'Reversed'), v_user);

  RETURN v_entry;
END $$;

--
-- Name: submit_expense(uuid, integer); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.submit_expense(p_entry_id uuid, p_expected_version integer DEFAULT NULL::integer) RETURNS public.expense_entries
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_user  uuid := public.expense_actor();
  v_entry public.expense_entries;
  v_from  public.expense_status;
BEGIN
  SELECT * INTO v_entry FROM public.expense_entries WHERE id = p_entry_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Expense not found' USING ERRCODE = 'P0002';
  END IF;

  v_from := v_entry.status;
  IF v_from NOT IN ('DRAFT', 'REJECTED') THEN
    RAISE EXCEPTION 'Only a draft or a returned expense can be submitted (current: %)', v_from
      USING ERRCODE = '55000';
  END IF;

  IF NOT (v_entry.created_by = v_user OR public.expense_role_rank(v_user) >= 30) THEN
    RAISE EXCEPTION 'Forbidden: you can only submit your own drafts' USING ERRCODE = '42501';
  END IF;
  PERFORM public.expense_assert_capability(v_user, 'expense.submit');

  IF p_expected_version IS NOT NULL AND p_expected_version <> v_entry.version THEN
    RAISE EXCEPTION 'This expense was changed by someone else. Reload it and try again.'
      USING ERRCODE = '40001';
  END IF;

  -- Completeness, in the order an operator would fix it.
  IF v_entry.total_amount <= 0 OR v_entry.line_count = 0 THEN
    RAISE EXCEPTION 'Add at least one line with an amount before submitting'
      USING ERRCODE = '22023';
  END IF;
  IF v_entry.payee_type = 'SUPPLIER' AND v_entry.supplier_id IS NULL THEN
    RAISE EXCEPTION 'Choose the supplier before submitting' USING ERRCODE = '22023';
  END IF;
  IF v_entry.payee_type = 'EMPLOYEE' AND v_entry.employee_id IS NULL THEN
    RAISE EXCEPTION 'Choose the staff member before submitting' USING ERRCODE = '22023';
  END IF;

  UPDATE public.expense_entries
     SET status             = 'SUBMITTED',
         submitted_by       = v_user,
         submitted_at       = now(),
         rejection_reason   = NULL,
         version            = version + 1
   WHERE id = p_entry_id
  RETURNING * INTO v_entry;

  PERFORM public.expense_log_action(p_entry_id, 'submitted', v_from, 'SUBMITTED', NULL, v_user);

  RETURN v_entry;
END $$;

--
-- Name: tg_expense_payments_sync_entry(); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.tg_expense_payments_sync_entry() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_entry_id uuid := COALESCE(NEW.entry_id, OLD.entry_id);
  v_paid     numeric(18,2);
  v_entry    public.expense_entries;
BEGIN
  SELECT COALESCE(sum(amount), 0)::numeric(18,2)
    INTO v_paid
  FROM public.expense_payments
  -- A reversed payment keeps its row but stops counting toward settlement; the
  -- reversal row itself is subtracted because it carries a positive amount and
  -- a `reversal_of` link, which is expressed on the matching row's `reversed_by`.
  WHERE entry_id = v_entry_id
    AND reversed_by IS NULL
    AND reversal_of IS NULL;

  SELECT * INTO v_entry FROM public.expense_entries WHERE id = v_entry_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  UPDATE public.expense_entries
     SET paid_amount = v_paid,
         status = public.expense_settlement_status(
           CASE WHEN v_entry.status IN ('CLOSED', 'REVERSED') THEN v_entry.status
                ELSE 'POSTED'::public.expense_status END,
           v_paid,
           v_entry.total_amount
         )
   WHERE id = v_entry_id;

  RETURN NULL;
END $$;

--
-- Name: update_expense(uuid, integer, jsonb, date, date, public.expense_entry_type, public.expense_payee_type, text, uuid, uuid, uuid, uuid, uuid, text, text, public.expense_tax_mode); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.update_expense(p_entry_id uuid, p_expected_version integer, p_lines jsonb, p_expense_date date DEFAULT NULL::date, p_due_date date DEFAULT NULL::date, p_entry_type public.expense_entry_type DEFAULT NULL::public.expense_entry_type, p_payee_type public.expense_payee_type DEFAULT NULL::public.expense_payee_type, p_payee_name text DEFAULT NULL::text, p_supplier_id uuid DEFAULT NULL::uuid, p_employee_id uuid DEFAULT NULL::uuid, p_warehouse_id uuid DEFAULT NULL::uuid, p_cost_center_id uuid DEFAULT NULL::uuid, p_project_id uuid DEFAULT NULL::uuid, p_description text DEFAULT NULL::text, p_note text DEFAULT NULL::text, p_tax_mode public.expense_tax_mode DEFAULT NULL::public.expense_tax_mode) RETURNS public.expense_entries
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_user      uuid := public.expense_actor();
  v_entry     public.expense_entries;
  v_total     numeric;
  v_count     integer;
  v_tax_mode  public.expense_tax_mode;
  v_payee     public.expense_payee_type;
  v_from      public.expense_status;
BEGIN
  -- `FOR UPDATE` is what makes the version check meaningful: without the row
  -- lock, two concurrent updates could both read version 3, both pass the
  -- check, and the second would silently overwrite the first.
  SELECT * INTO v_entry FROM public.expense_entries WHERE id = p_entry_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Expense not found' USING ERRCODE = 'P0002';
  END IF;

  v_from := v_entry.status;

  IF v_from NOT IN ('DRAFT', 'REJECTED') THEN
    RAISE EXCEPTION 'Only a draft or a returned expense can be edited (current: %)', v_from
      USING ERRCODE = '55000';
  END IF;

  -- Ownership or an accounting-and-above role. A cashier must not be able to
  -- rewrite a colleague's draft.
  IF NOT (v_entry.created_by = v_user OR public.expense_role_rank(v_user) >= 30) THEN
    RAISE EXCEPTION 'Forbidden: you can only edit your own drafts' USING ERRCODE = '42501';
  END IF;
  PERFORM public.expense_assert_capability(v_user, 'expense.edit');

  IF p_expected_version IS NOT NULL AND p_expected_version <> v_entry.version THEN
    RAISE EXCEPTION 'This expense was changed by someone else. Reload it and try again.'
      USING ERRCODE = '40001';
  END IF;

  v_tax_mode := COALESCE(p_tax_mode, v_entry.tax_mode);
  v_payee    := COALESCE(p_payee_type, v_entry.payee_type);

  IF v_payee = 'SUPPLIER' AND COALESCE(p_supplier_id, v_entry.supplier_id) IS NULL THEN
    RAISE EXCEPTION 'A supplier payee requires a supplier' USING ERRCODE = '22023';
  END IF;
  IF v_payee = 'EMPLOYEE' AND COALESCE(p_employee_id, v_entry.employee_id) IS NULL THEN
    RAISE EXCEPTION 'An employee payee requires a staff member' USING ERRCODE = '22023';
  END IF;

  UPDATE public.expense_entries
     SET expense_date   = COALESCE(p_expense_date, expense_date),
         due_date       = p_due_date,
         entry_type     = COALESCE(p_entry_type, entry_type),
         payee_type     = v_payee,
         payee_name     = nullif(btrim(coalesce(p_payee_name, '')), ''),
         supplier_id    = CASE WHEN v_payee = 'SUPPLIER' THEN p_supplier_id END,
         employee_id    = CASE WHEN v_payee = 'EMPLOYEE' THEN p_employee_id END,
         warehouse_id   = p_warehouse_id,
         cost_center_id = p_cost_center_id,
         project_id     = p_project_id,
         description    = nullif(btrim(coalesce(p_description, '')), ''),
         note           = nullif(btrim(coalesce(p_note, '')), ''),
         tax_mode       = v_tax_mode,
         -- A rejected document that is edited becomes a draft again: it must
         -- re-earn its approval rather than inheriting the old decision.
         status         = 'DRAFT'::public.expense_status,
         rejection_reason = NULL,
         version        = version + 1
   WHERE id = p_entry_id
  RETURNING * INTO v_entry;

  SELECT o_total, o_count INTO v_total, v_count
  FROM public.expense_write_lines(p_entry_id, p_lines, v_tax_mode);

  UPDATE public.expense_entries
     SET total_amount = v_total,
         line_count   = v_count
   WHERE id = p_entry_id
  RETURNING * INTO v_entry;

  PERFORM public.expense_log_action(
    p_entry_id, 'updated', v_from, 'DRAFT', 'Draft edited', v_user);

  RETURN v_entry;
END $$;

--
-- Name: update_expense_v2(uuid, integer, jsonb, date, date, public.expense_entry_type, public.expense_payee_type, text, uuid, uuid, uuid, uuid, uuid, text, text, public.expense_tax_mode, boolean, text); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.update_expense_v2(p_entry_id uuid, p_expected_version integer, p_lines jsonb, p_expense_date date DEFAULT NULL::date, p_due_date date DEFAULT NULL::date, p_entry_type public.expense_entry_type DEFAULT NULL::public.expense_entry_type, p_payee_type public.expense_payee_type DEFAULT NULL::public.expense_payee_type, p_payee_name text DEFAULT NULL::text, p_supplier_id uuid DEFAULT NULL::uuid, p_employee_id uuid DEFAULT NULL::uuid, p_warehouse_id uuid DEFAULT NULL::uuid, p_cost_center_id uuid DEFAULT NULL::uuid, p_project_id uuid DEFAULT NULL::uuid, p_description text DEFAULT NULL::text, p_note text DEFAULT NULL::text, p_tax_mode public.expense_tax_mode DEFAULT NULL::public.expense_tax_mode, p_tax_recoverable boolean DEFAULT false, p_supplier_invoice_number text DEFAULT NULL::text) RETURNS public.expense_entries
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
$$;

--
-- Name: expense_entries expense_entries_pkey; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.expense_entries
    ADD CONSTRAINT expense_entries_pkey PRIMARY KEY (id);

--
-- Name: expense_entries_cost_center_idx; Type: INDEX; Schema: public; Owner: supabase_admin
--

CREATE INDEX expense_entries_cost_center_idx ON public.expense_entries USING btree (cost_center_id, expense_date DESC) WHERE (cost_center_id IS NOT NULL);

--
-- Name: expense_entries_created_by_idx; Type: INDEX; Schema: public; Owner: supabase_admin
--

CREATE INDEX expense_entries_created_by_idx ON public.expense_entries USING btree (created_by, expense_date DESC) WHERE (created_by IS NOT NULL);

--
-- Name: expense_entries_created_idx; Type: INDEX; Schema: public; Owner: supabase_admin
--

CREATE INDEX expense_entries_created_idx ON public.expense_entries USING btree (created_at DESC, id DESC);

--
-- Name: expense_entries_date_idx; Type: INDEX; Schema: public; Owner: supabase_admin
--

CREATE INDEX expense_entries_date_idx ON public.expense_entries USING btree (expense_date DESC, id DESC);

--
-- Name: expense_entries_employee_idx; Type: INDEX; Schema: public; Owner: supabase_admin
--

CREATE INDEX expense_entries_employee_idx ON public.expense_entries USING btree (employee_id, expense_date DESC) WHERE (employee_id IS NOT NULL);

--
-- Name: expense_entries_legacy_key; Type: INDEX; Schema: public; Owner: supabase_admin
--

CREATE UNIQUE INDEX expense_entries_legacy_key ON public.expense_entries USING btree (legacy_expense_id) WHERE (legacy_expense_id IS NOT NULL);

--
-- Name: expense_entries_open_idx; Type: INDEX; Schema: public; Owner: supabase_admin
--

CREATE INDEX expense_entries_open_idx ON public.expense_entries USING btree (due_date, expense_date) WHERE (status = ANY (ARRAY['POSTED'::public.expense_status, 'PARTIALLY_PAID'::public.expense_status]));

--
-- Name: expense_entries_pending_idx; Type: INDEX; Schema: public; Owner: supabase_admin
--

CREATE INDEX expense_entries_pending_idx ON public.expense_entries USING btree (submitted_at) WHERE (status = 'SUBMITTED'::public.expense_status);

--
-- Name: expense_entries_project_idx; Type: INDEX; Schema: public; Owner: supabase_admin
--

CREATE INDEX expense_entries_project_idx ON public.expense_entries USING btree (project_id, expense_date DESC) WHERE (project_id IS NOT NULL);

--
-- Name: expense_entries_reference_key; Type: INDEX; Schema: public; Owner: supabase_admin
--

CREATE UNIQUE INDEX expense_entries_reference_key ON public.expense_entries USING btree (upper(btrim(reference)));

--
-- Name: expense_entries_status_date_idx; Type: INDEX; Schema: public; Owner: supabase_admin
--

CREATE INDEX expense_entries_status_date_idx ON public.expense_entries USING btree (status, expense_date DESC, id DESC);

--
-- Name: expense_entries_supplier_idx; Type: INDEX; Schema: public; Owner: supabase_admin
--

CREATE INDEX expense_entries_supplier_idx ON public.expense_entries USING btree (supplier_id, expense_date DESC) WHERE (supplier_id IS NOT NULL);

--
-- Name: expense_entries_warehouse_idx; Type: INDEX; Schema: public; Owner: supabase_admin
--

CREATE INDEX expense_entries_warehouse_idx ON public.expense_entries USING btree (warehouse_id, expense_date DESC) WHERE (warehouse_id IS NOT NULL);

--
-- Name: uq_expense_create_idempotency; Type: INDEX; Schema: public; Owner: supabase_admin
--

CREATE UNIQUE INDEX uq_expense_create_idempotency ON public.expense_entries USING btree (created_by, create_idempotency_key) WHERE ((created_by IS NOT NULL) AND (create_idempotency_key IS NOT NULL));

--
-- Name: uq_expense_supplier_invoice_number; Type: INDEX; Schema: public; Owner: supabase_admin
--

CREATE UNIQUE INDEX uq_expense_supplier_invoice_number ON public.expense_entries USING btree (supplier_id, lower(btrim(supplier_invoice_number))) WHERE ((supplier_id IS NOT NULL) AND (supplier_invoice_number IS NOT NULL) AND (btrim(supplier_invoice_number) <> ''::text) AND (status <> 'CANCELLED'::public.expense_status));

--
-- Name: expense_entries tg_expense_entries_updated; Type: TRIGGER; Schema: public; Owner: supabase_admin
--

CREATE TRIGGER tg_expense_entries_updated BEFORE UPDATE ON public.expense_entries FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

--
-- Name: expense_entries; Type: ROW SECURITY; Schema: public; Owner: supabase_admin
--

ALTER TABLE public.expense_entries ENABLE ROW LEVEL SECURITY;

--
-- Name: expense_entries expense_entries_read; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY expense_entries_read ON public.expense_entries FOR SELECT TO authenticated USING ((public.can_read_finance(auth.uid()) OR (public.is_staff(auth.uid()) AND (created_by = auth.uid()))));

--
-- Name: TABLE expense_entries; Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.expense_entries TO service_role;


--
-- Name: delete_expense_category(uuid); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.delete_expense_category(p_id uuid) RETURNS public.expense_categories
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_user  uuid := public.expense_actor();
  v_used  bigint;
  v_row   public.expense_categories;
BEGIN
  PERFORM public.expense_assert_capability(v_user, 'expense.category.manage');

  SELECT count(*) INTO v_used FROM public.expense_lines WHERE category_id = p_id;

  IF v_used > 0 THEN
    UPDATE public.expense_categories SET is_active = false WHERE id = p_id
    RETURNING * INTO v_row;

    INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, payload)
    VALUES (v_user, 'expense.category.archived', 'expense_category', p_id,
            jsonb_build_object('reason', 'in_use', 'usage_count', v_used));
  ELSE
    DELETE FROM public.expense_categories WHERE id = p_id
    RETURNING * INTO v_row;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Category not found' USING ERRCODE = 'P0002';
    END IF;

    INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, payload)
    VALUES (v_user, 'expense.category.deleted', 'expense_category', p_id,
            jsonb_build_object('name', v_row.name));
  END IF;

  RETURN v_row;
END $$;

--
-- Name: save_expense_category(uuid, text, text, integer, text, boolean); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.save_expense_category(p_id uuid DEFAULT NULL::uuid, p_name text DEFAULT NULL::text, p_name_ar text DEFAULT NULL::text, p_sort_order integer DEFAULT NULL::integer, p_notes text DEFAULT NULL::text, p_is_active boolean DEFAULT NULL::boolean) RETURNS public.expense_categories
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_user     uuid := public.expense_actor();
  v_category public.expense_categories;
  v_name     text := nullif(btrim(coalesce(p_name, '')), '');
BEGIN
  PERFORM public.expense_assert_capability(v_user, 'expense.category.manage');

  IF p_id IS NULL THEN
    IF v_name IS NULL THEN
      RAISE EXCEPTION 'A category needs a name' USING ERRCODE = '22023';
    END IF;

    INSERT INTO public.expense_categories (name, name_ar, sort_order, notes, created_by, is_active)
    VALUES (
      v_name,
      nullif(btrim(coalesce(p_name_ar, '')), ''),
      COALESCE(p_sort_order, 100),
      nullif(btrim(coalesce(p_notes, '')), ''),
      v_user,
      COALESCE(p_is_active, true)
    )
    RETURNING * INTO v_category;

    INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, payload)
    VALUES (v_user, 'expense.category.created', 'expense_category', v_category.id,
            jsonb_build_object('name', v_category.name));
  ELSE
    -- The UNIQUE(name) constraint from the original migration would raise a raw
    -- 23505 the operator cannot read; checked explicitly so the message is
    -- usable and names the clash.
    IF v_name IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.expense_categories c
      WHERE upper(btrim(c.name)) = upper(v_name) AND c.id <> p_id
    ) THEN
      RAISE EXCEPTION 'A category named "%" already exists', v_name USING ERRCODE = '23505';
    END IF;

    UPDATE public.expense_categories
       SET name       = COALESCE(v_name, name),
           name_ar    = CASE WHEN p_name_ar IS NULL THEN name_ar
                             ELSE nullif(btrim(p_name_ar), '') END,
           sort_order = COALESCE(p_sort_order, sort_order),
           notes      = CASE WHEN p_notes IS NULL THEN notes
                             ELSE nullif(btrim(p_notes), '') END,
           is_active  = COALESCE(p_is_active, is_active)
     WHERE id = p_id
    RETURNING * INTO v_category;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Category not found' USING ERRCODE = 'P0002';
    END IF;

    INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, payload)
    VALUES (v_user, 'expense.category.updated', 'expense_category', v_category.id,
            jsonb_build_object('name', v_category.name, 'is_active', v_category.is_active));
  END IF;

  RETURN v_category;
END $$;

--
-- Name: set_expense_category_account(uuid, uuid); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.set_expense_category_account(p_category_id uuid, p_account_id uuid) RETURNS public.expense_categories
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
$$;

--
-- Name: expense_categories expense_categories_name_key; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.expense_categories
    ADD CONSTRAINT expense_categories_name_key UNIQUE (name);

--
-- Name: expense_categories expense_categories_pkey; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.expense_categories
    ADD CONSTRAINT expense_categories_pkey PRIMARY KEY (id);

--
-- Name: expense_categories_active_order_idx; Type: INDEX; Schema: public; Owner: supabase_admin
--

CREATE INDEX expense_categories_active_order_idx ON public.expense_categories USING btree (is_active, sort_order, name);

--
-- Name: expense_categories; Type: ROW SECURITY; Schema: public; Owner: supabase_admin
--

ALTER TABLE public.expense_categories ENABLE ROW LEVEL SECURITY;

--
-- Name: expense_categories staff read expense cats; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY "staff read expense cats" ON public.expense_categories FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));

--
-- Name: expense_categories staff write expense cats; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY "staff write expense cats" ON public.expense_categories TO authenticated USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

--
-- Name: TABLE expense_categories; Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.expense_categories TO service_role;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.expense_categories TO authenticated;


--
-- Name: FUNCTION expense_actor(); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.expense_actor() FROM PUBLIC;

GRANT ALL ON FUNCTION public.expense_actor() TO service_role;


--
-- Name: FUNCTION expense_approval_rule_management(); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.expense_approval_rule_management() FROM PUBLIC;

GRANT ALL ON FUNCTION public.expense_approval_rule_management() TO authenticated;

GRANT ALL ON FUNCTION public.expense_approval_rule_management() TO service_role;


--
-- Name: FUNCTION expense_assert_capability(p_user uuid, p_capability text); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.expense_assert_capability(p_user uuid, p_capability text) FROM PUBLIC;

GRANT ALL ON FUNCTION public.expense_assert_capability(p_user uuid, p_capability text) TO service_role;


--
-- Name: FUNCTION expense_can(p_user uuid, p_capability text); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.expense_can(p_user uuid, p_capability text) FROM PUBLIC;

GRANT ALL ON FUNCTION public.expense_can(p_user uuid, p_capability text) TO service_role;


--
-- Name: FUNCTION expense_category_management(); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.expense_category_management() FROM PUBLIC;

GRANT ALL ON FUNCTION public.expense_category_management() TO authenticated;

GRANT ALL ON FUNCTION public.expense_category_management() TO service_role;


--
-- Name: FUNCTION expense_category_postable_accounts(); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.expense_category_postable_accounts() FROM PUBLIC;

GRANT ALL ON FUNCTION public.expense_category_postable_accounts() TO authenticated;

GRANT ALL ON FUNCTION public.expense_category_postable_accounts() TO service_role;


--
-- Name: FUNCTION expense_ledger_account_management(); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.expense_ledger_account_management() FROM PUBLIC;

GRANT ALL ON FUNCTION public.expense_ledger_account_management() TO authenticated;

GRANT ALL ON FUNCTION public.expense_ledger_account_management() TO service_role;


--
-- Name: FUNCTION expense_log_action(p_entry_id uuid, p_action text, p_from public.expense_status, p_to public.expense_status, p_reason text, p_actor uuid); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.expense_log_action(p_entry_id uuid, p_action text, p_from public.expense_status, p_to public.expense_status, p_reason text, p_actor uuid) FROM PUBLIC;

GRANT ALL ON FUNCTION public.expense_log_action(p_entry_id uuid, p_action text, p_from public.expense_status, p_to public.expense_status, p_reason text, p_actor uuid) TO service_role;


--
-- Name: FUNCTION expense_posting_account_code(p_role text); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.expense_posting_account_code(p_role text) FROM PUBLIC;

GRANT ALL ON FUNCTION public.expense_posting_account_code(p_role text) TO service_role;


--
-- Name: FUNCTION expense_report(p_group_by text, p_date_from date, p_date_to date, p_status public.expense_status[], p_warehouse_id uuid, p_cost_center_id uuid, p_project_id uuid, p_limit integer); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.expense_report(p_group_by text, p_date_from date, p_date_to date, p_status public.expense_status[], p_warehouse_id uuid, p_cost_center_id uuid, p_project_id uuid, p_limit integer) FROM PUBLIC;

GRANT ALL ON FUNCTION public.expense_report(p_group_by text, p_date_from date, p_date_to date, p_status public.expense_status[], p_warehouse_id uuid, p_cost_center_id uuid, p_project_id uuid, p_limit integer) TO service_role;

GRANT ALL ON FUNCTION public.expense_report(p_group_by text, p_date_from date, p_date_to date, p_status public.expense_status[], p_warehouse_id uuid, p_cost_center_id uuid, p_project_id uuid, p_limit integer) TO authenticated;


--
-- Name: FUNCTION expense_require_override_reason(p_reason text); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.expense_require_override_reason(p_reason text) FROM PUBLIC;

GRANT ALL ON FUNCTION public.expense_require_override_reason(p_reason text) TO service_role;


--
-- Name: FUNCTION expense_reverse_supplier_ledger(p_supplier_id uuid, p_source_key text, p_reference_type text, p_reference_id uuid, p_reversal_key text, p_note text, p_actor uuid); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.expense_reverse_supplier_ledger(p_supplier_id uuid, p_source_key text, p_reference_type text, p_reference_id uuid, p_reversal_key text, p_note text, p_actor uuid) FROM PUBLIC;

GRANT ALL ON FUNCTION public.expense_reverse_supplier_ledger(p_supplier_id uuid, p_source_key text, p_reference_type text, p_reference_id uuid, p_reversal_key text, p_note text, p_actor uuid) TO service_role;

--
-- Name: expense_line_net(numeric, numeric, public.expense_tax_mode); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.expense_line_net(p_gross numeric, p_tax_rate numeric, p_mode public.expense_tax_mode) RETURNS numeric
    LANGUAGE sql IMMUTABLE
    SET search_path TO 'public'
    AS $$
  SELECT CASE
    WHEN p_gross IS NULL THEN NULL
    WHEN coalesce(p_tax_rate, 0) <= 0 OR p_mode IN ('NONE', 'EXCLUSIVE') THEN public.expense_round(p_gross)
    ELSE public.expense_round(p_gross / (1 + p_tax_rate / 100))
  END
$$;

--
-- Name: expense_line_production_base_amount(numeric, numeric, boolean); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.expense_line_production_base_amount(p_net_amount numeric, p_tax_amount numeric, p_tax_recoverable boolean) RETURNS numeric
    LANGUAGE sql IMMUTABLE
    SET search_path TO 'public'
    AS $$
  SELECT public.expense_round(
    coalesce(p_net_amount, 0)
    + CASE WHEN coalesce(p_tax_recoverable, false) THEN 0 ELSE coalesce(p_tax_amount, 0) END
  )
$$;


--
-- Name: FUNCTION expense_round(p_value numeric); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.expense_round(p_value numeric) FROM PUBLIC;

GRANT ALL ON FUNCTION public.expense_round(p_value numeric) TO service_role;


--
-- Name: FUNCTION expense_settlement_status(p_current public.expense_status, p_paid numeric, p_total numeric); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.expense_settlement_status(p_current public.expense_status, p_paid numeric, p_total numeric) FROM PUBLIC;

GRANT ALL ON FUNCTION public.expense_settlement_status(p_current public.expense_status, p_paid numeric, p_total numeric) TO service_role;


--
-- Name: FUNCTION expense_write_lines(p_entry_id uuid, p_lines jsonb, p_tax_mode public.expense_tax_mode, OUT o_total numeric, OUT o_count integer); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.expense_write_lines(p_entry_id uuid, p_lines jsonb, p_tax_mode public.expense_tax_mode, OUT o_total numeric, OUT o_count integer) FROM PUBLIC;

GRANT ALL ON FUNCTION public.expense_write_lines(p_entry_id uuid, p_lines jsonb, p_tax_mode public.expense_tax_mode, OUT o_total numeric, OUT o_count integer) TO authenticated;

GRANT ALL ON FUNCTION public.expense_write_lines(p_entry_id uuid, p_lines jsonb, p_tax_mode public.expense_tax_mode, OUT o_total numeric, OUT o_count integer) TO service_role;


--
-- Name: FUNCTION expense_write_supplier_ledger(p_supplier_id uuid, p_entry_type text, p_side text, p_amount numeric, p_reference_type text, p_reference_id uuid, p_source_key text, p_due_date date, p_occurred_at timestamp with time zone, p_note text, p_actor uuid); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.expense_write_supplier_ledger(p_supplier_id uuid, p_entry_type text, p_side text, p_amount numeric, p_reference_type text, p_reference_id uuid, p_source_key text, p_due_date date, p_occurred_at timestamp with time zone, p_note text, p_actor uuid) FROM PUBLIC;

GRANT ALL ON FUNCTION public.expense_write_supplier_ledger(p_supplier_id uuid, p_entry_type text, p_side text, p_amount numeric, p_reference_type text, p_reference_id uuid, p_source_key text, p_due_date date, p_occurred_at timestamp with time zone, p_note text, p_actor uuid) TO service_role;


--
-- Name: expense_entries expense_entries_guard_draft_post_reason; Type: TRIGGER; Schema: public; Owner: supabase_admin
--

CREATE TRIGGER expense_entries_guard_draft_post_reason BEFORE UPDATE OF draft_post_reason ON public.expense_entries FOR EACH ROW EXECUTE FUNCTION public.guard_expense_draft_post_reason();

--
-- Name: FUNCTION guard_expense_draft_post_reason(); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.guard_expense_draft_post_reason() FROM PUBLIC;


--
-- Name: FUNCTION migrate_legacy_expenses(p_mode text, p_from date, p_to date, p_batch_size integer, p_dry_run boolean); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.migrate_legacy_expenses(p_mode text, p_from date, p_to date, p_batch_size integer, p_dry_run boolean) FROM PUBLIC;

GRANT ALL ON FUNCTION public.migrate_legacy_expenses(p_mode text, p_from date, p_to date, p_batch_size integer, p_dry_run boolean) TO service_role;

--
-- Name: delete_expense_approval_rule(uuid); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.delete_expense_approval_rule(p_rule_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
$$;

--
-- Name: expense_required_approval_rank(numeric); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.expense_required_approval_rank(p_amount numeric) RETURNS integer
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT coalesce((
    SELECT r.required_role_rank
      FROM public.expense_approval_rules r
     WHERE r.min_amount <= greatest(coalesce(p_amount, 0), 0)
     ORDER BY r.min_amount DESC
     LIMIT 1
  ), 40)
$$;


--
-- Name: save_expense_approval_rule(numeric, integer); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.save_expense_approval_rule(p_min_amount numeric, p_required_role_rank integer) RETURNS public.expense_approval_rules
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
$$;

--
-- Name: expense_approval_rules expense_approval_rules_min_amount_key; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.expense_approval_rules
    ADD CONSTRAINT expense_approval_rules_min_amount_key UNIQUE (min_amount);

--
-- Name: expense_approval_rules expense_approval_rules_pkey; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.expense_approval_rules
    ADD CONSTRAINT expense_approval_rules_pkey PRIMARY KEY (id);


--
-- Name: FUNCTION save_expense_dimension(p_kind text, p_id uuid, p_code text, p_name text, p_name_ar text, p_is_active boolean); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.save_expense_dimension(p_kind text, p_id uuid, p_code text, p_name text, p_name_ar text, p_is_active boolean) FROM PUBLIC;

GRANT ALL ON FUNCTION public.save_expense_dimension(p_kind text, p_id uuid, p_code text, p_name text, p_name_ar text, p_is_active boolean) TO service_role;


--
-- Name: FUNCTION set_expense_ledger_account(p_role text, p_account_id uuid); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.set_expense_ledger_account(p_role text, p_account_id uuid) FROM PUBLIC;

GRANT ALL ON FUNCTION public.set_expense_ledger_account(p_role text, p_account_id uuid) TO authenticated;

GRANT ALL ON FUNCTION public.set_expense_ledger_account(p_role text, p_account_id uuid) TO service_role;


--
-- Name: FUNCTION set_production_expense_category_eligibility(p_category_id uuid, p_eligible boolean); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.set_production_expense_category_eligibility(p_category_id uuid, p_eligible boolean) FROM PUBLIC;

GRANT ALL ON FUNCTION public.set_production_expense_category_eligibility(p_category_id uuid, p_eligible boolean) TO authenticated;

GRANT ALL ON FUNCTION public.set_production_expense_category_eligibility(p_category_id uuid, p_eligible boolean) TO service_role;


--
-- Name: expense_entries expense_entries_capture_approval_rank; Type: TRIGGER; Schema: public; Owner: supabase_admin
--

CREATE TRIGGER expense_entries_capture_approval_rank BEFORE INSERT OR UPDATE OF status, total_amount ON public.expense_entries FOR EACH ROW EXECUTE FUNCTION public.tg_expense_capture_approval_rank();

--
-- Name: FUNCTION tg_expense_capture_approval_rank(); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.tg_expense_capture_approval_rank() FROM PUBLIC;

GRANT ALL ON FUNCTION public.tg_expense_capture_approval_rank() TO service_role;

--
-- Name: expense_entries tg_expense_entries_guard; Type: TRIGGER; Schema: public; Owner: supabase_admin
--

CREATE TRIGGER tg_expense_entries_guard BEFORE UPDATE ON public.expense_entries FOR EACH ROW EXECUTE FUNCTION public.tg_expense_entries_guard();


--
-- Name: expense_approvals expense_approvals_pkey; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.expense_approvals
    ADD CONSTRAINT expense_approvals_pkey PRIMARY KEY (id);

--
-- Name: expense_approvals_entry_idx; Type: INDEX; Schema: public; Owner: supabase_admin
--

CREATE INDEX expense_approvals_entry_idx ON public.expense_approvals USING btree (entry_id, created_at);

--
-- Name: expense_approvals_entry_sequence_key; Type: INDEX; Schema: public; Owner: supabase_admin
--

CREATE UNIQUE INDEX expense_approvals_entry_sequence_key ON public.expense_approvals USING btree (entry_id, sequence);

--
-- Name: expense_approvals; Type: ROW SECURITY; Schema: public; Owner: supabase_admin
--

ALTER TABLE public.expense_approvals ENABLE ROW LEVEL SECURITY;

--
-- Name: TABLE expense_approvals; Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.expense_approvals TO service_role;


--
-- Name: expense_attachments expense_attachments_pkey; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.expense_attachments
    ADD CONSTRAINT expense_attachments_pkey PRIMARY KEY (id);

--
-- Name: expense_attachments_entry_idx; Type: INDEX; Schema: public; Owner: supabase_admin
--

CREATE INDEX expense_attachments_entry_idx ON public.expense_attachments USING btree (entry_id, created_at);

--
-- Name: expense_attachments_path_key; Type: INDEX; Schema: public; Owner: supabase_admin
--

CREATE UNIQUE INDEX expense_attachments_path_key ON public.expense_attachments USING btree (bucket_id, storage_path);

--
-- Name: expense_attachments; Type: ROW SECURITY; Schema: public; Owner: supabase_admin
--

ALTER TABLE public.expense_attachments ENABLE ROW LEVEL SECURITY;

--
-- Name: expense_attachments expense_attachments_delete; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY expense_attachments_delete ON public.expense_attachments FOR DELETE TO authenticated USING (((public.expense_role_rank(auth.uid()) >= 30) AND (EXISTS ( SELECT 1
   FROM public.expense_entries e
  WHERE ((e.id = expense_attachments.entry_id) AND (e.status = ANY (ARRAY['DRAFT'::public.expense_status, 'REJECTED'::public.expense_status])))))));

--
-- Name: expense_attachments expense_attachments_insert; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY expense_attachments_insert ON public.expense_attachments FOR INSERT TO authenticated WITH CHECK ((public.is_staff(auth.uid()) AND (uploaded_by = auth.uid()) AND (EXISTS ( SELECT 1
   FROM public.expense_entries e
  WHERE ((e.id = expense_attachments.entry_id) AND (e.status = ANY (ARRAY['DRAFT'::public.expense_status, 'REJECTED'::public.expense_status])))))));

--
-- Name: TABLE expense_attachments; Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.expense_attachments TO service_role;


--
-- Name: expense_cost_centers expense_cost_centers_pkey; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.expense_cost_centers
    ADD CONSTRAINT expense_cost_centers_pkey PRIMARY KEY (id);

--
-- Name: expense_cost_centers_active_idx; Type: INDEX; Schema: public; Owner: supabase_admin
--

CREATE INDEX expense_cost_centers_active_idx ON public.expense_cost_centers USING btree (is_active, name);

--
-- Name: expense_cost_centers_code_key; Type: INDEX; Schema: public; Owner: supabase_admin
--

CREATE UNIQUE INDEX expense_cost_centers_code_key ON public.expense_cost_centers USING btree (lower(btrim(code))) WHERE ((code IS NOT NULL) AND (btrim(code) <> ''::text));

--
-- Name: expense_cost_centers tg_expense_cost_centers_updated; Type: TRIGGER; Schema: public; Owner: supabase_admin
--

CREATE TRIGGER tg_expense_cost_centers_updated BEFORE UPDATE ON public.expense_cost_centers FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

--
-- Name: expense_cost_centers; Type: ROW SECURITY; Schema: public; Owner: supabase_admin
--

ALTER TABLE public.expense_cost_centers ENABLE ROW LEVEL SECURITY;

--
-- Name: expense_cost_centers expense_cost_centers_manage; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY expense_cost_centers_manage ON public.expense_cost_centers TO authenticated USING ((public.has_role(auth.uid(), 'owner'::public.app_role) OR public.has_role(auth.uid(), 'manager'::public.app_role))) WITH CHECK ((public.has_role(auth.uid(), 'owner'::public.app_role) OR public.has_role(auth.uid(), 'manager'::public.app_role)));

--
-- Name: expense_cost_centers expense_cost_centers_read; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY expense_cost_centers_read ON public.expense_cost_centers FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));

--
-- Name: TABLE expense_cost_centers; Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.expense_cost_centers TO service_role;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.expense_cost_centers TO authenticated;


--
-- Name: expense_ledger_account_mappings expense_ledger_account_mappings_pkey; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.expense_ledger_account_mappings
    ADD CONSTRAINT expense_ledger_account_mappings_pkey PRIMARY KEY (role);

--
-- Name: expense_ledger_summary(uuid); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.expense_ledger_summary(p_entry_id uuid, OUT o_net numeric, OUT o_tax numeric, OUT o_account_code text) RETURNS record
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT
    round(COALESCE(sum(l.net_amount), 0), 2) AS o_net,
    round(COALESCE(sum(l.tax_amount), 0), 2) AS o_tax,
    COALESCE((SELECT a.code
                FROM public.expense_categories c
                JOIN public.accounts a ON a.id = c.account_id
               WHERE c.id = (SELECT category_id
                               FROM public.expense_lines
                              WHERE entry_id = p_entry_id
                              ORDER BY line_no LIMIT 1)
                 AND c.account_id IS NOT NULL), '5911') AS o_account_code
  FROM public.expense_lines l
  WHERE l.entry_id = p_entry_id;
$$;


--
-- Name: expense_lines expense_lines_pkey; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.expense_lines
    ADD CONSTRAINT expense_lines_pkey PRIMARY KEY (id);

--
-- Name: expense_lines_category_idx; Type: INDEX; Schema: public; Owner: supabase_admin
--

CREATE INDEX expense_lines_category_idx ON public.expense_lines USING btree (category_id, entry_id);

--
-- Name: expense_lines_cost_center_idx; Type: INDEX; Schema: public; Owner: supabase_admin
--

CREATE INDEX expense_lines_cost_center_idx ON public.expense_lines USING btree (cost_center_id, entry_id) WHERE (cost_center_id IS NOT NULL);

--
-- Name: expense_lines_entry_idx; Type: INDEX; Schema: public; Owner: supabase_admin
--

CREATE INDEX expense_lines_entry_idx ON public.expense_lines USING btree (entry_id);

--
-- Name: expense_lines_entry_line_key; Type: INDEX; Schema: public; Owner: supabase_admin
--

CREATE UNIQUE INDEX expense_lines_entry_line_key ON public.expense_lines USING btree (entry_id, line_no);

--
-- Name: expense_lines_project_idx; Type: INDEX; Schema: public; Owner: supabase_admin
--

CREATE INDEX expense_lines_project_idx ON public.expense_lines USING btree (project_id, entry_id) WHERE (project_id IS NOT NULL);

--
-- Name: expense_lines tg_expense_lines_sync_total; Type: TRIGGER; Schema: public; Owner: supabase_admin
--

CREATE TRIGGER tg_expense_lines_sync_total AFTER INSERT OR DELETE OR UPDATE ON public.expense_lines FOR EACH ROW EXECUTE FUNCTION public.tg_expense_lines_sync_total();

--
-- Name: expense_lines tg_expense_lines_updated; Type: TRIGGER; Schema: public; Owner: supabase_admin
--

CREATE TRIGGER tg_expense_lines_updated BEFORE UPDATE ON public.expense_lines FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

--
-- Name: expense_lines; Type: ROW SECURITY; Schema: public; Owner: supabase_admin
--

ALTER TABLE public.expense_lines ENABLE ROW LEVEL SECURITY;

--
-- Name: TABLE expense_lines; Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.expense_lines TO service_role;


--
-- Name: expense_legacy_reconciliation; Type: VIEW; Schema: public; Owner: supabase_admin
--

CREATE VIEW public.expense_legacy_reconciliation WITH (security_invoker='true') AS
 SELECT count(*) AS legacy_rows,
    count(*) FILTER (WHERE (l.id IS NULL)) AS not_yet_migrated,
    count(*) FILTER (WHERE (l.id IS NOT NULL)) AS already_migrated,
    COALESCE(sum(x.amount), (0)::numeric) AS legacy_total,
    COALESCE(sum(b.gross_amount), (0)::numeric) AS migrated_total,
    COALESCE(min(x.expense_date), CURRENT_DATE) AS first_date,
    COALESCE(max(x.expense_date), CURRENT_DATE) AS last_date,
    count(*) FILTER (WHERE (x.category_id IS NULL)) AS uncategorised_rows,
    count(*) FILTER (WHERE (x.payment_method = 'credit'::public.payment_method)) AS credit_method_rows
   FROM ((public.expenses x
     LEFT JOIN public.expense_entries l ON ((l.legacy_expense_id = x.id)))
     LEFT JOIN public.expense_lines b ON ((b.entry_id = l.id)))
  GROUP BY ();

--
-- Name: expenses expenses_pkey; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.expenses
    ADD CONSTRAINT expenses_pkey PRIMARY KEY (id);

--
-- Name: expenses tg_expenses_updated; Type: TRIGGER; Schema: public; Owner: supabase_admin
--

CREATE TRIGGER tg_expenses_updated BEFORE UPDATE ON public.expenses FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

--
-- Name: expenses; Type: ROW SECURITY; Schema: public; Owner: supabase_admin
--

ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;

--
-- Name: expenses finance read expenses; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY "finance read expenses" ON public.expenses FOR SELECT TO authenticated USING (public.can_read_finance(auth.uid()));

--
-- Name: expenses finance write expenses; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY "finance write expenses" ON public.expenses TO authenticated USING (public.can_read_finance(auth.uid())) WITH CHECK (public.can_read_finance(auth.uid()));

--
-- Name: TABLE expenses; Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.expenses TO service_role;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.expenses TO authenticated;

--
-- Name: reverse_expense_payment(uuid, text); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.reverse_expense_payment(p_payment_id uuid, p_reason text DEFAULT NULL::text) RETURNS public.expense_entries
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_user uuid := public.expense_actor();
  v_payment public.expense_payments;
  v_entry public.expense_entries;
  v_reversal_id uuid;
  v_journal_id uuid;
BEGIN
  SELECT * INTO v_payment FROM public.expense_payments WHERE id=p_payment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payment not found' USING ERRCODE='P0002'; END IF;
  PERFORM public.expense_assert_capability(v_user,'expense.payment.reverse');
  IF v_payment.reversed_by IS NOT NULL THEN SELECT * INTO v_entry FROM public.expense_entries WHERE id=v_payment.entry_id; RETURN v_entry; END IF;
  IF v_payment.reversal_of IS NOT NULL THEN RAISE EXCEPTION 'A reversal row cannot itself be reversed' USING ERRCODE='55000'; END IF;
  SELECT * INTO v_entry FROM public.expense_entries WHERE id=v_payment.entry_id FOR UPDATE;
  SELECT id INTO v_journal_id FROM public.journal_entries
    WHERE source_type='expense_payment' AND source_id=p_payment_id AND status='POSTED' FOR UPDATE;
  IF v_journal_id IS NOT NULL THEN
    PERFORM public.reverse_journal_entry(v_journal_id,COALESCE(NULLIF(btrim(p_reason),''),'عكس دفعة المصروف'));
  END IF;
  INSERT INTO public.expense_payments(entry_id,amount,payment_date,payment_method,account_label,reference_no,note,
    reversal_of,created_by,account_id,cashbox_id,bank_account_id,payment_method_id)
  VALUES(v_payment.entry_id,v_payment.amount,CURRENT_DATE,v_payment.payment_method,v_payment.account_label,
    v_payment.reference_no,COALESCE(NULLIF(btrim(p_reason),''),'Reversal of payment'),v_payment.id,v_user,
    v_payment.account_id,v_payment.cashbox_id,v_payment.bank_account_id,v_payment.payment_method_id)
  RETURNING id INTO v_reversal_id;
  UPDATE public.expense_payments SET reversed_by=v_reversal_id WHERE id=p_payment_id;
  SELECT * INTO v_entry FROM public.expense_entries WHERE id=v_payment.entry_id;
  PERFORM public.expense_log_action(v_payment.entry_id,'payment',v_entry.status,v_entry.status,'Payment reversed',v_user);
  RETURN v_entry;
END $$;


--
-- Name: expense_payments expense_payments_pkey; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.expense_payments
    ADD CONSTRAINT expense_payments_pkey PRIMARY KEY (id);

--
-- Name: expense_payments_account_id_idx; Type: INDEX; Schema: public; Owner: supabase_admin
--

CREATE INDEX expense_payments_account_id_idx ON public.expense_payments USING btree (account_id) WHERE (account_id IS NOT NULL);

--
-- Name: expense_payments_date_idx; Type: INDEX; Schema: public; Owner: supabase_admin
--

CREATE INDEX expense_payments_date_idx ON public.expense_payments USING btree (payment_date DESC, id DESC);

--
-- Name: expense_payments_entry_idx; Type: INDEX; Schema: public; Owner: supabase_admin
--

CREATE INDEX expense_payments_entry_idx ON public.expense_payments USING btree (entry_id, payment_date, id);

--
-- Name: expense_payments_idempotency_key; Type: INDEX; Schema: public; Owner: supabase_admin
--

CREATE UNIQUE INDEX expense_payments_idempotency_key ON public.expense_payments USING btree (idempotency_key) WHERE (idempotency_key IS NOT NULL);

--
-- Name: expense_payments_method_idx; Type: INDEX; Schema: public; Owner: supabase_admin
--

CREATE INDEX expense_payments_method_idx ON public.expense_payments USING btree (payment_method, payment_date DESC);

--
-- Name: expense_payments tg_expense_payments_updated; Type: TRIGGER; Schema: public; Owner: supabase_admin
--

CREATE TRIGGER tg_expense_payments_updated BEFORE UPDATE ON public.expense_payments FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

--
-- Name: expense_payments; Type: ROW SECURITY; Schema: public; Owner: supabase_admin
--

ALTER TABLE public.expense_payments ENABLE ROW LEVEL SECURITY;

--
-- Name: TABLE expense_payments; Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.expense_payments TO service_role;

--
-- Name: expense_detail(uuid); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.expense_detail(p_entry_id uuid) RETURNS jsonb
    LANGUAGE sql STABLE
    SET search_path TO 'public'
    AS $$
  SELECT jsonb_build_object(
    'entry', to_jsonb(e) || jsonb_build_object(
      'supplier_name',    s.name,
      'employee_name',    pr.full_name,
      'warehouse_name',   w.name,
      'cost_center_name', cc.name,
      'project_name',     pj.name,
      'created_by_name',  cb.full_name,
      'approved_by_name', ab.full_name,
      'posted_by_name',   pb.full_name,
      -- The capability set is computed server-side so the UI does not have to
      -- re-derive the role matrix in JavaScript and drift from the database.
      'can_edit',    (e.status IN ('DRAFT', 'REJECTED'))
                     AND (e.created_by = auth.uid() OR public.expense_role_rank(auth.uid()) >= 30),
      'can_submit',  (e.status IN ('DRAFT', 'REJECTED'))
                     AND (e.created_by = auth.uid() OR public.expense_role_rank(auth.uid()) >= 30),
      'can_approve', (e.status = 'SUBMITTED') AND public.expense_can(auth.uid(), 'expense.approve'),
      'can_post',    (e.status IN ('APPROVED', 'DRAFT')) AND public.expense_can(auth.uid(), 'expense.post'),
      'can_pay',     (e.status IN ('POSTED', 'PARTIALLY_PAID')) AND public.expense_can(auth.uid(), 'expense.pay'),
      'can_cancel',  (e.status IN ('DRAFT', 'REJECTED', 'SUBMITTED', 'APPROVED'))
                     AND public.expense_can(auth.uid(), 'expense.cancel'),
      'can_reverse', (e.status IN ('POSTED', 'PARTIALLY_PAID', 'PAID'))
                     AND public.expense_can(auth.uid(), 'expense.reverse')
    ),
    'lines', COALESCE((
      SELECT jsonb_agg(
        to_jsonb(l) || jsonb_build_object(
          'category_name',    c.name,
          'category_name_ar', c.name_ar,
          'cost_center_name', cc.name,
          'project_name',     pj.name
        ) ORDER BY l.line_no
      )
      FROM public.expense_lines l
      LEFT JOIN public.expense_categories c   ON c.id  = l.category_id
      LEFT JOIN public.expense_cost_centers cc ON cc.id = l.cost_center_id
      LEFT JOIN public.expense_projects pj    ON pj.id = l.project_id
      WHERE l.entry_id = e.id
    ), '[]'::jsonb),
    'payments', COALESCE((
      SELECT jsonb_agg(to_jsonb(p) || jsonb_build_object('created_by_name', pc.full_name)
                       ORDER BY p.payment_date, p.created_at)
      FROM public.expense_payments p
      LEFT JOIN public.profiles pc ON pc.id = p.created_by
      WHERE p.entry_id = e.id
    ), '[]'::jsonb),
    'approvals', COALESCE((
      SELECT jsonb_agg(to_jsonb(a) || jsonb_build_object('actor_name', ac.full_name)
                       ORDER BY a.sequence)
      FROM public.expense_approvals a
      LEFT JOIN public.profiles ac ON ac.id = a.actor_id
      WHERE a.entry_id = e.id
    ), '[]'::jsonb),
    'attachments', COALESCE((
      SELECT jsonb_agg(to_jsonb(t) || jsonb_build_object('uploaded_by_name', tc.full_name)
                       ORDER BY t.created_at)
      FROM public.expense_attachments t
      LEFT JOIN public.profiles tc ON tc.id = t.uploaded_by
      WHERE t.entry_id = e.id
    ), '[]'::jsonb)
  )
  FROM public.expense_entries e
  LEFT JOIN public.suppliers s  ON s.id  = e.supplier_id
  LEFT JOIN public.profiles  pr ON pr.id = e.employee_id
  LEFT JOIN public.profiles  cb ON cb.id = e.created_by
  LEFT JOIN public.profiles  ab ON ab.id = e.approved_by
  LEFT JOIN public.profiles  pb ON pb.id = e.posted_by
  LEFT JOIN public.warehouses w ON w.id  = e.warehouse_id
  LEFT JOIN public.expense_cost_centers cc ON cc.id = e.cost_center_id
  LEFT JOIN public.expense_projects pj      ON pj.id = e.project_id
  WHERE e.id = p_entry_id
$$;

--
-- Name: expense_lookups(boolean); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.expense_lookups(p_include_archived boolean DEFAULT false) RETURNS jsonb
    LANGUAGE sql STABLE
    SET search_path TO 'public'
    AS $$
  SELECT jsonb_build_object(
    'categories', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', c.id,
               'name', c.name,
               'name_ar', c.name_ar,
               'is_active', c.is_active,
               'sort_order', c.sort_order,
               'usage_count', (SELECT count(*) FROM public.expense_lines l WHERE l.category_id = c.id),
               'account_id', c.account_id,
               'account_code', a.code,
               'account_name_ar', a.name_ar
             ) ORDER BY c.sort_order, c.name)
      FROM public.expense_categories c
      LEFT JOIN public.accounts a ON a.id = c.account_id
      WHERE p_include_archived OR c.is_active
    ), '[]'::jsonb),
    'warehouses', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', w.id, 'name', w.name, 'name_ar', w.name_ar, 'is_default', w.is_default
             ) ORDER BY w.name)
      FROM public.warehouses w
      WHERE w.is_active IS NOT FALSE
    ), '[]'::jsonb),
    'cost_centers', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', cc.id, 'code', cc.code, 'name', cc.name, 'name_ar', cc.name_ar
             ) ORDER BY cc.name)
      FROM public.expense_cost_centers cc
      WHERE cc.is_active
    ), '[]'::jsonb),
    'projects', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', pj.id, 'code', pj.code, 'name', pj.name, 'name_ar', pj.name_ar
             ) ORDER BY pj.name)
      FROM public.expense_projects pj
      WHERE pj.is_active
    ), '[]'::jsonb),
    'suppliers', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name) ORDER BY s.name)
      FROM public.suppliers s
      WHERE s.is_active IS NOT FALSE
    ), '[]'::jsonb),
    'employees', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', p.id, 'name', p.full_name) ORDER BY p.full_name)
      FROM public.profiles p
      WHERE p.is_active IS NOT FALSE
        AND EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = p.id)
        AND NOT EXISTS (SELECT 1 FROM public.platform_admins pa WHERE pa.user_id = p.id)
        AND p.full_name NOT ILIKE '%سوبر%'
        AND p.full_name NOT ILIKE '%superadmin%'
    ), '[]'::jsonb),
    'financial_accounts', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', a.id, 'code', a.code, 'name_ar', a.name_ar,
               'account_type', a.account_type,
               'requires_reconciliation', a.requires_reconciliation
             ) ORDER BY a.code)
      FROM public.accounts a
      WHERE a.is_active IS NOT FALSE
        AND (a.requires_reconciliation IS TRUE OR a.code LIKE '11%')
    ), '[]'::jsonb)
  )
$$;

--
-- Name: list_expenses(text, public.expense_status[], uuid, uuid, uuid, uuid, uuid, uuid, text, date, date, numeric, numeric, uuid[], integer, date, uuid); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.list_expenses(p_search text DEFAULT NULL::text, p_status public.expense_status[] DEFAULT NULL::public.expense_status[], p_category_id uuid DEFAULT NULL::uuid, p_warehouse_id uuid DEFAULT NULL::uuid, p_cost_center_id uuid DEFAULT NULL::uuid, p_project_id uuid DEFAULT NULL::uuid, p_supplier_id uuid DEFAULT NULL::uuid, p_employee_id uuid DEFAULT NULL::uuid, p_payment_state text DEFAULT NULL::text, p_date_from date DEFAULT NULL::date, p_date_to date DEFAULT NULL::date, p_amount_min numeric DEFAULT NULL::numeric, p_amount_max numeric DEFAULT NULL::numeric, p_category_ids uuid[] DEFAULT NULL::uuid[], p_limit integer DEFAULT 50, p_cursor_date date DEFAULT NULL::date, p_cursor_id uuid DEFAULT NULL::uuid) RETURNS TABLE(id uuid, reference text, status public.expense_status, entry_type public.expense_entry_type, payee_type public.expense_payee_type, payee_name text, supplier_id uuid, supplier_name text, employee_id uuid, employee_name text, warehouse_id uuid, warehouse_name text, cost_center_id uuid, cost_center_name text, project_id uuid, project_name text, expense_date date, due_date date, posting_date date, description text, note text, total_amount numeric, paid_amount numeric, remaining_amount numeric, line_count integer, primary_category text, primary_category_ar text, version integer, created_by uuid, created_by_name text, created_at timestamp with time zone, approved_at timestamp with time zone, posted_at timestamp with time zone, total_count bigint, next_cursor_date date, next_cursor_id uuid)
    LANGUAGE sql STABLE
    SET search_path TO 'public'
    AS $$
  WITH all_matching AS (
    SELECT
      e.id, e.reference, e.status, e.entry_type, e.payee_type, e.payee_name,
      e.supplier_id, e.employee_id, e.warehouse_id, e.cost_center_id, e.project_id,
      e.expense_date, e.due_date, e.posting_date, e.description, e.note,
      e.total_amount, e.paid_amount, e.remaining_amount, e.line_count,
      e.version, e.created_by, e.created_at, e.approved_at, e.posted_at,
      count(*) OVER () AS full_count
    FROM public.expense_entries e
    WHERE
      (p_search IS NULL OR btrim(p_search) = '' OR
        e.reference ILIKE '%' || btrim(p_search) || '%' OR
        COALESCE(e.description, '') ILIKE '%' || btrim(p_search) || '%' OR
        COALESCE(e.note, '')        ILIKE '%' || btrim(p_search) || '%' OR
        COALESCE(e.payee_name, '')  ILIKE '%' || btrim(p_search) || '%')
      AND (p_status IS NULL OR e.status = ANY (p_status))
      AND (p_warehouse_id   IS NULL OR e.warehouse_id   = p_warehouse_id)
      AND (p_cost_center_id IS NULL OR e.cost_center_id = p_cost_center_id)
      AND (p_project_id     IS NULL OR e.project_id     = p_project_id)
      AND (p_supplier_id    IS NULL OR e.supplier_id    = p_supplier_id)
      AND (p_employee_id    IS NULL OR e.employee_id    = p_employee_id)
      AND (p_date_from IS NULL OR e.expense_date >= p_date_from)
      AND (p_date_to   IS NULL OR e.expense_date <= p_date_to)
      AND (p_amount_min IS NULL OR e.total_amount >= p_amount_min)
      AND (p_amount_max IS NULL OR e.total_amount <= p_amount_max)
      AND (
        p_payment_state IS NULL
        OR (p_payment_state = 'unpaid'  AND e.paid_amount <= 0)
        OR (p_payment_state = 'partial' AND e.paid_amount > 0
                                        AND e.paid_amount < e.total_amount - 0.005)
        OR (p_payment_state = 'paid'    AND e.paid_amount >= e.total_amount - 0.005)
      )
      AND (
        p_category_id IS NULL
        OR EXISTS (SELECT 1 FROM public.expense_lines l
                   WHERE l.entry_id = e.id AND l.category_id = p_category_id)
      )
      AND (
        p_category_ids IS NULL OR cardinality(p_category_ids) = 0
        OR EXISTS (SELECT 1 FROM public.expense_lines l
                   WHERE l.entry_id = e.id AND l.category_id = ANY (p_category_ids))
      )
  ),
  paged AS (
    SELECT *
    FROM all_matching m
    WHERE (
      p_cursor_date IS NULL
      OR (m.expense_date, m.id) < (p_cursor_date, COALESCE(p_cursor_id, m.id))
    )
    ORDER BY m.expense_date DESC, m.id DESC
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200)
  )
  SELECT
    c.id, c.reference, c.status, c.entry_type, c.payee_type, c.payee_name,
    c.supplier_id, s.name,
    c.employee_id, pr.full_name,
    c.warehouse_id, w.name,
    c.cost_center_id, cc.name,
    c.project_id, pj.name,
    c.expense_date, c.due_date, c.posting_date, c.description, c.note,
    c.total_amount, c.paid_amount, c.remaining_amount, c.line_count,
    cat.name, cat.name_ar,
    c.version, c.created_by, pr2.full_name, c.created_at, c.approved_at, c.posted_at,
    COALESCE(c.full_count, 0::bigint) AS total_count,
    c.expense_date AS next_cursor_date,
    c.id AS next_cursor_id
  FROM paged c
  LEFT JOIN public.suppliers s        ON s.id = c.supplier_id
  LEFT JOIN public.profiles  pr       ON pr.id = c.employee_id
  LEFT JOIN public.profiles  pr2      ON pr2.id = c.created_by
  LEFT JOIN public.warehouses w       ON w.id = c.warehouse_id
  LEFT JOIN public.expense_cost_centers cc ON cc.id = c.cost_center_id
  LEFT JOIN public.expense_projects pj ON pj.id = c.project_id
  LEFT JOIN LATERAL (
    SELECT l.category_id
    FROM public.expense_lines l
    WHERE l.entry_id = c.id
    ORDER BY l.gross_amount DESC, l.line_no ASC
    LIMIT 1
  ) prim ON true
  LEFT JOIN public.expense_categories cat ON cat.id = prim.category_id
  ORDER BY c.expense_date DESC, c.id DESC;
$$;


--
-- Name: expense_projects expense_projects_pkey; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.expense_projects
    ADD CONSTRAINT expense_projects_pkey PRIMARY KEY (id);

--
-- Name: expense_projects_active_idx; Type: INDEX; Schema: public; Owner: supabase_admin
--

CREATE INDEX expense_projects_active_idx ON public.expense_projects USING btree (is_active, name);

--
-- Name: expense_projects_code_key; Type: INDEX; Schema: public; Owner: supabase_admin
--

CREATE UNIQUE INDEX expense_projects_code_key ON public.expense_projects USING btree (lower(btrim(code))) WHERE ((code IS NOT NULL) AND (btrim(code) <> ''::text));

--
-- Name: expense_projects tg_expense_projects_updated; Type: TRIGGER; Schema: public; Owner: supabase_admin
--

CREATE TRIGGER tg_expense_projects_updated BEFORE UPDATE ON public.expense_projects FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

--
-- Name: expense_projects; Type: ROW SECURITY; Schema: public; Owner: supabase_admin
--

ALTER TABLE public.expense_projects ENABLE ROW LEVEL SECURITY;

--
-- Name: expense_projects expense_projects_manage; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY expense_projects_manage ON public.expense_projects TO authenticated USING ((public.has_role(auth.uid(), 'owner'::public.app_role) OR public.has_role(auth.uid(), 'manager'::public.app_role))) WITH CHECK ((public.has_role(auth.uid(), 'owner'::public.app_role) OR public.has_role(auth.uid(), 'manager'::public.app_role)));

--
-- Name: expense_projects expense_projects_read; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY expense_projects_read ON public.expense_projects FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));

--
-- Name: TABLE expense_projects; Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.expense_projects TO service_role;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.expense_projects TO authenticated;


--
-- Name: SEQUENCE expense_reference_seq; Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT SELECT,USAGE ON SEQUENCE public.expense_reference_seq TO authenticated;


--
-- Name: expense_approvals expense_approvals_read; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY expense_approvals_read ON public.expense_approvals FOR SELECT TO authenticated USING (public.can_read_expense_entry(entry_id, auth.uid()));

--
-- Name: expense_attachments expense_attachments_read; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY expense_attachments_read ON public.expense_attachments FOR SELECT TO authenticated USING (public.can_read_expense_entry(entry_id, auth.uid()));

--
-- Name: expense_lines expense_lines_read; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY expense_lines_read ON public.expense_lines FOR SELECT TO authenticated USING (public.can_read_expense_entry(entry_id, auth.uid()));

--
-- Name: expense_payments expense_payments_read; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY expense_payments_read ON public.expense_payments FOR SELECT TO authenticated USING (public.can_read_expense_entry(entry_id, auth.uid()));

--
-- Name: FUNCTION can_read_expense_entry(p_entry_id uuid, p_user uuid); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.can_read_expense_entry(p_entry_id uuid, p_user uuid) FROM PUBLIC;

GRANT ALL ON FUNCTION public.can_read_expense_entry(p_entry_id uuid, p_user uuid) TO service_role;

GRANT ALL ON FUNCTION public.can_read_expense_entry(p_entry_id uuid, p_user uuid) TO authenticated;


--
-- Name: FUNCTION cancel_expense(p_entry_id uuid, p_reason text, p_expected_version integer); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.cancel_expense(p_entry_id uuid, p_reason text, p_expected_version integer) FROM PUBLIC;

GRANT ALL ON FUNCTION public.cancel_expense(p_entry_id uuid, p_reason text, p_expected_version integer) TO service_role;

GRANT ALL ON FUNCTION public.cancel_expense(p_entry_id uuid, p_reason text, p_expected_version integer) TO authenticated;


--
-- Name: FUNCTION close_expense(p_entry_id uuid); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.close_expense(p_entry_id uuid) FROM PUBLIC;

GRANT ALL ON FUNCTION public.close_expense(p_entry_id uuid) TO service_role;

GRANT ALL ON FUNCTION public.close_expense(p_entry_id uuid) TO authenticated;


--
-- Name: FUNCTION decide_expense(p_entry_id uuid, p_approve boolean, p_reason text, p_expected_version integer); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.decide_expense(p_entry_id uuid, p_approve boolean, p_reason text, p_expected_version integer) FROM PUBLIC;

GRANT ALL ON FUNCTION public.decide_expense(p_entry_id uuid, p_approve boolean, p_reason text, p_expected_version integer) TO authenticated;

GRANT ALL ON FUNCTION public.decide_expense(p_entry_id uuid, p_approve boolean, p_reason text, p_expected_version integer) TO service_role;


--
-- Name: FUNCTION expense_can_write_document(p_entry_id uuid, p_user uuid); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.expense_can_write_document(p_entry_id uuid, p_user uuid) FROM PUBLIC;

GRANT ALL ON FUNCTION public.expense_can_write_document(p_entry_id uuid, p_user uuid) TO service_role;


--
-- Name: FUNCTION expense_summary(p_date_from date, p_date_to date, p_warehouse_id uuid); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.expense_summary(p_date_from date, p_date_to date, p_warehouse_id uuid) FROM PUBLIC;

GRANT ALL ON FUNCTION public.expense_summary(p_date_from date, p_date_to date, p_warehouse_id uuid) TO service_role;

GRANT ALL ON FUNCTION public.expense_summary(p_date_from date, p_date_to date, p_warehouse_id uuid) TO authenticated;


--
-- Name: FUNCTION reverse_expense(p_entry_id uuid, p_reason text); Type: COMMENT; Schema: public; Owner: supabase_admin
--

COMMENT ON FUNCTION public.reverse_expense(p_entry_id uuid, p_reason text) IS 'T-07: عكس مصروف يعكس قيده في الأستاذ (reverse_journal_entry) قبل إنشاء المستند العكسي.';

--
-- Name: FUNCTION reverse_expense(p_entry_id uuid, p_reason text); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.reverse_expense(p_entry_id uuid, p_reason text) FROM PUBLIC;

GRANT ALL ON FUNCTION public.reverse_expense(p_entry_id uuid, p_reason text) TO service_role;

GRANT ALL ON FUNCTION public.reverse_expense(p_entry_id uuid, p_reason text) TO authenticated;


--
-- Name: FUNCTION submit_expense(p_entry_id uuid, p_expected_version integer); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.submit_expense(p_entry_id uuid, p_expected_version integer) FROM PUBLIC;

GRANT ALL ON FUNCTION public.submit_expense(p_entry_id uuid, p_expected_version integer) TO service_role;

GRANT ALL ON FUNCTION public.submit_expense(p_entry_id uuid, p_expected_version integer) TO authenticated;

--
-- Name: expense_payments tg_expense_payments_sync_entry; Type: TRIGGER; Schema: public; Owner: supabase_admin
--

CREATE TRIGGER tg_expense_payments_sync_entry AFTER INSERT OR DELETE OR UPDATE ON public.expense_payments FOR EACH ROW EXECUTE FUNCTION public.tg_expense_payments_sync_entry();


--
-- Name: FUNCTION update_expense(p_entry_id uuid, p_expected_version integer, p_lines jsonb, p_expense_date date, p_due_date date, p_entry_type public.expense_entry_type, p_payee_type public.expense_payee_type, p_payee_name text, p_supplier_id uuid, p_employee_id uuid, p_warehouse_id uuid, p_cost_center_id uuid, p_project_id uuid, p_description text, p_note text, p_tax_mode public.expense_tax_mode); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.update_expense(p_entry_id uuid, p_expected_version integer, p_lines jsonb, p_expense_date date, p_due_date date, p_entry_type public.expense_entry_type, p_payee_type public.expense_payee_type, p_payee_name text, p_supplier_id uuid, p_employee_id uuid, p_warehouse_id uuid, p_cost_center_id uuid, p_project_id uuid, p_description text, p_note text, p_tax_mode public.expense_tax_mode) FROM PUBLIC;

GRANT ALL ON FUNCTION public.update_expense(p_entry_id uuid, p_expected_version integer, p_lines jsonb, p_expense_date date, p_due_date date, p_entry_type public.expense_entry_type, p_payee_type public.expense_payee_type, p_payee_name text, p_supplier_id uuid, p_employee_id uuid, p_warehouse_id uuid, p_cost_center_id uuid, p_project_id uuid, p_description text, p_note text, p_tax_mode public.expense_tax_mode) TO service_role;

GRANT ALL ON FUNCTION public.update_expense(p_entry_id uuid, p_expected_version integer, p_lines jsonb, p_expense_date date, p_due_date date, p_entry_type public.expense_entry_type, p_payee_type public.expense_payee_type, p_payee_name text, p_supplier_id uuid, p_employee_id uuid, p_warehouse_id uuid, p_cost_center_id uuid, p_project_id uuid, p_description text, p_note text, p_tax_mode public.expense_tax_mode) TO authenticated;


--
-- Name: FUNCTION update_expense_v2(p_entry_id uuid, p_expected_version integer, p_lines jsonb, p_expense_date date, p_due_date date, p_entry_type public.expense_entry_type, p_payee_type public.expense_payee_type, p_payee_name text, p_supplier_id uuid, p_employee_id uuid, p_warehouse_id uuid, p_cost_center_id uuid, p_project_id uuid, p_description text, p_note text, p_tax_mode public.expense_tax_mode, p_tax_recoverable boolean, p_supplier_invoice_number text); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.update_expense_v2(p_entry_id uuid, p_expected_version integer, p_lines jsonb, p_expense_date date, p_due_date date, p_entry_type public.expense_entry_type, p_payee_type public.expense_payee_type, p_payee_name text, p_supplier_id uuid, p_employee_id uuid, p_warehouse_id uuid, p_cost_center_id uuid, p_project_id uuid, p_description text, p_note text, p_tax_mode public.expense_tax_mode, p_tax_recoverable boolean, p_supplier_invoice_number text) FROM PUBLIC;

GRANT ALL ON FUNCTION public.update_expense_v2(p_entry_id uuid, p_expected_version integer, p_lines jsonb, p_expense_date date, p_due_date date, p_entry_type public.expense_entry_type, p_payee_type public.expense_payee_type, p_payee_name text, p_supplier_id uuid, p_employee_id uuid, p_warehouse_id uuid, p_cost_center_id uuid, p_project_id uuid, p_description text, p_note text, p_tax_mode public.expense_tax_mode, p_tax_recoverable boolean, p_supplier_invoice_number text) TO authenticated;

GRANT ALL ON FUNCTION public.update_expense_v2(p_entry_id uuid, p_expected_version integer, p_lines jsonb, p_expense_date date, p_due_date date, p_entry_type public.expense_entry_type, p_payee_type public.expense_payee_type, p_payee_name text, p_supplier_id uuid, p_employee_id uuid, p_warehouse_id uuid, p_cost_center_id uuid, p_project_id uuid, p_description text, p_note text, p_tax_mode public.expense_tax_mode, p_tax_recoverable boolean, p_supplier_invoice_number text) TO service_role;


--
-- Name: FUNCTION delete_expense_category(p_id uuid); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.delete_expense_category(p_id uuid) FROM PUBLIC;

GRANT ALL ON FUNCTION public.delete_expense_category(p_id uuid) TO service_role;

GRANT ALL ON FUNCTION public.delete_expense_category(p_id uuid) TO authenticated;


--
-- Name: FUNCTION save_expense_category(p_id uuid, p_name text, p_name_ar text, p_sort_order integer, p_notes text, p_is_active boolean); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.save_expense_category(p_id uuid, p_name text, p_name_ar text, p_sort_order integer, p_notes text, p_is_active boolean) FROM PUBLIC;

GRANT ALL ON FUNCTION public.save_expense_category(p_id uuid, p_name text, p_name_ar text, p_sort_order integer, p_notes text, p_is_active boolean) TO service_role;

GRANT ALL ON FUNCTION public.save_expense_category(p_id uuid, p_name text, p_name_ar text, p_sort_order integer, p_notes text, p_is_active boolean) TO authenticated;


--
-- Name: FUNCTION set_expense_category_account(p_category_id uuid, p_account_id uuid); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.set_expense_category_account(p_category_id uuid, p_account_id uuid) FROM PUBLIC;

GRANT ALL ON FUNCTION public.set_expense_category_account(p_category_id uuid, p_account_id uuid) TO authenticated;

GRANT ALL ON FUNCTION public.set_expense_category_account(p_category_id uuid, p_account_id uuid) TO service_role;


--
-- Name: expense_line_tax(numeric, numeric, public.expense_tax_mode); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.expense_line_tax(p_gross numeric, p_tax_rate numeric, p_mode public.expense_tax_mode) RETURNS numeric
    LANGUAGE sql IMMUTABLE
    SET search_path TO 'public'
    AS $$
  SELECT CASE
    WHEN p_gross IS NULL OR coalesce(p_tax_rate, 0) <= 0 OR p_mode = 'NONE' THEN 0::numeric
    WHEN p_mode = 'EXCLUSIVE' THEN public.expense_round(p_gross * p_tax_rate / 100)
    ELSE public.expense_round(p_gross - public.expense_line_net(p_gross, p_tax_rate, p_mode))
  END
$$;

--
-- Name: FUNCTION expense_line_net(p_gross numeric, p_tax_rate numeric, p_mode public.expense_tax_mode); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.expense_line_net(p_gross numeric, p_tax_rate numeric, p_mode public.expense_tax_mode) FROM PUBLIC;

GRANT ALL ON FUNCTION public.expense_line_net(p_gross numeric, p_tax_rate numeric, p_mode public.expense_tax_mode) TO service_role;


--
-- Name: FUNCTION expense_line_production_base_amount(p_net_amount numeric, p_tax_amount numeric, p_tax_recoverable boolean); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.expense_line_production_base_amount(p_net_amount numeric, p_tax_amount numeric, p_tax_recoverable boolean) FROM PUBLIC;

GRANT ALL ON FUNCTION public.expense_line_production_base_amount(p_net_amount numeric, p_tax_amount numeric, p_tax_recoverable boolean) TO service_role;


--
-- Name: FUNCTION delete_expense_approval_rule(p_rule_id uuid); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.delete_expense_approval_rule(p_rule_id uuid) FROM PUBLIC;

GRANT ALL ON FUNCTION public.delete_expense_approval_rule(p_rule_id uuid) TO authenticated;

GRANT ALL ON FUNCTION public.delete_expense_approval_rule(p_rule_id uuid) TO service_role;


--
-- Name: FUNCTION expense_required_approval_rank(p_amount numeric); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.expense_required_approval_rank(p_amount numeric) FROM PUBLIC;

GRANT ALL ON FUNCTION public.expense_required_approval_rank(p_amount numeric) TO service_role;


--
-- Name: FUNCTION save_expense_approval_rule(p_min_amount numeric, p_required_role_rank integer); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.save_expense_approval_rule(p_min_amount numeric, p_required_role_rank integer) FROM PUBLIC;

GRANT ALL ON FUNCTION public.save_expense_approval_rule(p_min_amount numeric, p_required_role_rank integer) TO authenticated;

GRANT ALL ON FUNCTION public.save_expense_approval_rule(p_min_amount numeric, p_required_role_rank integer) TO service_role;


--
-- Name: FUNCTION tg_expense_entries_guard(); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.tg_expense_entries_guard() FROM PUBLIC;

GRANT ALL ON FUNCTION public.tg_expense_entries_guard() TO service_role;


--
-- Name: FUNCTION expense_ledger_summary(p_entry_id uuid, OUT o_net numeric, OUT o_tax numeric, OUT o_account_code text); Type: COMMENT; Schema: public; Owner: supabase_admin
--

COMMENT ON FUNCTION public.expense_ledger_summary(p_entry_id uuid, OUT o_net numeric, OUT o_tax numeric, OUT o_account_code text) IS 'T-07: صافي المصروف وضريبته وحسابه من التصنيف — مصدر وحيد لقيد المصروف.';

--
-- Name: FUNCTION expense_ledger_summary(p_entry_id uuid, OUT o_net numeric, OUT o_tax numeric, OUT o_account_code text); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.expense_ledger_summary(p_entry_id uuid, OUT o_net numeric, OUT o_tax numeric, OUT o_account_code text) FROM PUBLIC;

GRANT ALL ON FUNCTION public.expense_ledger_summary(p_entry_id uuid, OUT o_net numeric, OUT o_tax numeric, OUT o_account_code text) TO service_role;


--
-- Name: FUNCTION tg_expense_lines_sync_total(); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.tg_expense_lines_sync_total() FROM PUBLIC;

GRANT ALL ON FUNCTION public.tg_expense_lines_sync_total() TO service_role;


--
-- Name: TABLE expense_legacy_reconciliation; Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT SELECT ON TABLE public.expense_legacy_reconciliation TO authenticated;

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.expense_legacy_reconciliation TO service_role;


--
-- Name: FUNCTION reverse_expense_payment(p_payment_id uuid, p_reason text); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.reverse_expense_payment(p_payment_id uuid, p_reason text) FROM PUBLIC;

GRANT ALL ON FUNCTION public.reverse_expense_payment(p_payment_id uuid, p_reason text) TO service_role;

GRANT ALL ON FUNCTION public.reverse_expense_payment(p_payment_id uuid, p_reason text) TO authenticated;


--
-- Name: FUNCTION expense_detail(p_entry_id uuid); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.expense_detail(p_entry_id uuid) FROM PUBLIC;

GRANT ALL ON FUNCTION public.expense_detail(p_entry_id uuid) TO service_role;

GRANT ALL ON FUNCTION public.expense_detail(p_entry_id uuid) TO authenticated;


--
-- Name: FUNCTION expense_lookups(p_include_archived boolean); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.expense_lookups(p_include_archived boolean) FROM PUBLIC;

GRANT ALL ON FUNCTION public.expense_lookups(p_include_archived boolean) TO service_role;

GRANT ALL ON FUNCTION public.expense_lookups(p_include_archived boolean) TO authenticated;


--
-- Name: FUNCTION list_expenses(p_search text, p_status public.expense_status[], p_category_id uuid, p_warehouse_id uuid, p_cost_center_id uuid, p_project_id uuid, p_supplier_id uuid, p_employee_id uuid, p_payment_state text, p_date_from date, p_date_to date, p_amount_min numeric, p_amount_max numeric, p_category_ids uuid[], p_limit integer, p_cursor_date date, p_cursor_id uuid); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.list_expenses(p_search text, p_status public.expense_status[], p_category_id uuid, p_warehouse_id uuid, p_cost_center_id uuid, p_project_id uuid, p_supplier_id uuid, p_employee_id uuid, p_payment_state text, p_date_from date, p_date_to date, p_amount_min numeric, p_amount_max numeric, p_category_ids uuid[], p_limit integer, p_cursor_date date, p_cursor_id uuid) FROM PUBLIC;

GRANT ALL ON FUNCTION public.list_expenses(p_search text, p_status public.expense_status[], p_category_id uuid, p_warehouse_id uuid, p_cost_center_id uuid, p_project_id uuid, p_supplier_id uuid, p_employee_id uuid, p_payment_state text, p_date_from date, p_date_to date, p_amount_min numeric, p_amount_max numeric, p_category_ids uuid[], p_limit integer, p_cursor_date date, p_cursor_id uuid) TO service_role;

GRANT ALL ON FUNCTION public.list_expenses(p_search text, p_status public.expense_status[], p_category_id uuid, p_warehouse_id uuid, p_cost_center_id uuid, p_project_id uuid, p_supplier_id uuid, p_employee_id uuid, p_payment_state text, p_date_from date, p_date_to date, p_amount_min numeric, p_amount_max numeric, p_category_ids uuid[], p_limit integer, p_cursor_date date, p_cursor_id uuid) TO authenticated;


--
-- Name: FUNCTION tg_expense_payments_sync_entry(); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.tg_expense_payments_sync_entry() FROM PUBLIC;

GRANT ALL ON FUNCTION public.tg_expense_payments_sync_entry() TO service_role;


--
-- Name: FUNCTION expense_line_tax(p_gross numeric, p_tax_rate numeric, p_mode public.expense_tax_mode); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.expense_line_tax(p_gross numeric, p_tax_rate numeric, p_mode public.expense_tax_mode) FROM PUBLIC;

GRANT ALL ON FUNCTION public.expense_line_tax(p_gross numeric, p_tax_rate numeric, p_mode public.expense_tax_mode) TO service_role;

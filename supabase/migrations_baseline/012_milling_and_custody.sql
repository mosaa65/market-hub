-- ============================================================================
-- الترحيل 012_milling_and_custody.sql — مجال: milling_and_custody
-- جزء من خط الأساس الجديد: تعريف نهائي واحد لكل كائن، مبني من مخطط مرجعي
-- مستخرج من الترحيلات التاريخية الكاملة (راجع supabase/migrations/README.md).
-- ============================================================================

--
-- Name: assert_payment_splits_balance(); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.assert_payment_splits_balance() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_split_total numeric := 0;
  v_paid numeric;
  v_total numeric;
  v_document_type text;
  v_document_id uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_document_type := OLD.document_type;
    v_document_id := OLD.document_id;
  ELSE
    v_document_type := NEW.document_type;
    v_document_id := NEW.document_id;
  END IF;

  SELECT round(coalesce(sum(amount), 0), 2) INTO v_split_total
    FROM public.payment_splits
   WHERE document_type = v_document_type AND document_id = v_document_id;

  IF v_document_type = 'purchase_invoice' THEN
    SELECT pi.paid, pi.total INTO v_paid, v_total
      FROM public.purchase_invoices pi WHERE pi.id = v_document_id;
  ELSE
    SELECT si.paid, si.total
      INTO v_paid, v_total
      FROM public.milling_service_documents d
      JOIN public.sales_invoices si ON si.id = d.sales_invoice_id
     WHERE d.id = v_document_id;
  END IF;

  IF v_total IS NULL THEN
    RAISE EXCEPTION 'Record the document before its payment split';
  END IF;
  IF v_split_total > round(v_total, 2) THEN
    RAISE EXCEPTION 'Payment split total (%) exceeds the document total (%)',
      v_split_total, round(v_total, 2);
  END IF;
  IF v_split_total <> round(coalesce(v_paid, 0), 2) THEN
    RAISE EXCEPTION 'Payment split total (%) does not match the paid amount (%)',
      v_split_total, round(coalesce(v_paid, 0), 2);
  END IF;

  RETURN NULL;
END;
$$;

--
-- Name: can_operate_milling(); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.can_operate_milling() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT public.is_staff(auth.uid())
     AND (
       EXISTS (
         SELECT 1
         FROM public.user_roles ur
         WHERE ur.user_id = auth.uid()
           AND ur.role IN ('owner', 'manager', 'warehouse', 'cashier')
       )
       OR public.is_platform_superadmin(auth.uid())
     );
$$;

--
-- Name: can_view_milling(); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.can_view_milling() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT public.is_staff(auth.uid())
     AND EXISTS (
       SELECT 1
       FROM public.user_roles ur
       WHERE ur.user_id = auth.uid()
         AND ur.role IN ('owner', 'manager', 'accountant', 'warehouse', 'cashier')
     );
$$;

--
-- Name: capture_milling_service_estimate_from_intake(); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.capture_milling_service_estimate_from_intake() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_basis text;
  v_rate numeric(18,4);
  v_short_name text;
  v_name_ar text;
  v_quantity numeric(18,3);
BEGIN
  IF NEW.entry_type <> 'INTAKE' OR NEW.milling_document_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT p.cost_price, u.short_name, u.name_ar, d.billing_basis
    INTO v_rate, v_short_name, v_name_ar, v_basis
    FROM public.milling_service_documents d
    JOIN public.sales_invoice_items si ON si.invoice_id = d.sales_invoice_id
    JOIN public.products p ON p.id = si.product_id AND p.item_class = 'SERVICE'
    LEFT JOIN public.units u ON u.id = coalesce(p.base_uom_id, p.unit_id)
   WHERE d.id = NEW.milling_document_id
   ORDER BY si.id
   LIMIT 1;

  v_basis := CASE
    WHEN upper(coalesce(v_basis, '')) IN ('PER_BAG', 'BAG') THEN 'BAG'
    WHEN upper(coalesce(v_basis, '')) IN ('PER_KG', 'KG') THEN 'KG'
    WHEN lower(coalesce(v_short_name, '')) IN ('bag', 'sack', 'كيس', 'جوال')
      OR coalesce(v_name_ar, '') ILIKE '%كيس%'
      OR coalesce(v_name_ar, '') ILIKE '%جوال%' THEN 'BAG'
    WHEN lower(coalesce(v_short_name, '')) IN ('kg', 'كجم', 'كغ', 'كيلوجرام')
      OR coalesce(v_name_ar, '') ILIKE '%كيلو%'
      OR coalesce(v_name_ar, '') ILIKE '%كجم%' THEN 'KG'
    WHEN coalesce(NEW.bags_in, 0) > 0 THEN 'BAG'
    WHEN coalesce(NEW.kg_in, 0) > 0 THEN 'KG'
    ELSE NULL
  END;

  IF v_basis = 'BAG' THEN
    SELECT coalesce(sum(bags_in), 0)::numeric(18,3)
      INTO v_quantity
      FROM public.custody_ledger
     WHERE milling_document_id = NEW.milling_document_id
       AND entry_type = 'INTAKE';
  ELSIF v_basis = 'KG' THEN
    SELECT coalesce(sum(kg_in), 0)::numeric(18,3)
      INTO v_quantity
      FROM public.custody_ledger
     WHERE milling_document_id = NEW.milling_document_id
       AND entry_type = 'INTAKE';
  END IF;

  UPDATE public.milling_service_documents
     SET estimated_cost_basis = CASE WHEN coalesce(v_rate, 0) > 0 THEN v_basis ELSE NULL END,
         estimated_cost_rate = CASE WHEN coalesce(v_rate, 0) > 0 THEN v_rate ELSE NULL END,
         estimated_cost_quantity = CASE WHEN coalesce(v_rate, 0) > 0 THEN v_quantity ELSE NULL END,
         estimated_cost_amount = CASE
           WHEN coalesce(v_rate, 0) > 0 AND coalesce(v_quantity, 0) > 0
           THEN round(v_rate * v_quantity, 2)
           ELSE NULL
         END,
         estimated_cost_captured_at = CASE WHEN coalesce(v_rate, 0) > 0 THEN now() ELSE NULL END
   WHERE id = NEW.milling_document_id;

  RETURN NEW;
END;
$$;

--
-- Name: consume_internal_supplies(uuid, jsonb, text); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.consume_internal_supplies(_warehouse_id uuid, _lines jsonb, _notes text) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_user uuid := auth.uid();
  v_ref text;
  v_doc_id uuid := gen_random_uuid();
  r record;
  v_unit_cost numeric;
  v_line_cost numeric;
  v_total_cost numeric := 0;
  v_journal_lines jsonb := '[]'::jsonb;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT public.can_operate_milling() THEN
    RAISE EXCEPTION 'You are not permitted to issue internal consumables';
  END IF;
  IF _warehouse_id IS NULL THEN
    RAISE EXCEPTION 'Warehouse is required';
  END IF;
  IF _lines IS NULL OR jsonb_typeof(_lines) <> 'array' OR jsonb_array_length(_lines) = 0 THEN
    RAISE EXCEPTION 'At least one consumable line is required';
  END IF;

  FOR r IN SELECT * FROM jsonb_to_recordset(_lines) AS l(item_id uuid, qty numeric)
  LOOP
    IF r.item_id IS NULL OR coalesce(r.qty, 0) <= 0 THEN
      RAISE EXCEPTION 'Every line needs an item and a positive quantity';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.products
      WHERE id = r.item_id AND item_class IN ('NON_STOCK_ITEM', 'PACKAGING') AND is_active
    ) THEN
      RAISE EXCEPTION 'Only consumable (NON_STOCK_ITEM / PACKAGING) items may be issued here';
    END IF;
  END LOOP;

  v_ref := 'CS-' || to_char(now(), 'YYYYMM') || '-' || lpad(nextval('public.milling_service_seq')::text, 4, '0');

  FOR r IN SELECT * FROM jsonb_to_recordset(_lines) AS l(item_id uuid, qty numeric)
  LOOP
    SELECT coalesce(
      (SELECT sum(cl.quantity * cl.last_unit_cost) / nullif(sum(cl.quantity), 0)
         FROM public.item_cost_layers cl
        WHERE cl.product_id = r.item_id AND cl.quantity > 0
          AND cl.owner_type = 'COMPANY'),
      (SELECT cost_price FROM public.products WHERE id = r.item_id),
      0
    ) INTO v_unit_cost;

    v_line_cost := round(coalesce(r.qty, 0) * coalesce(v_unit_cost, 0), 2);
    v_total_cost := v_total_cost + v_line_cost;

    PERFORM public.post_stock_delta(
      p_product_id => r.item_id,
      p_warehouse_id => _warehouse_id,
      p_signed_qty => -coalesce(r.qty, 0),
      p_unit_cost => v_unit_cost,
      p_movement_kind => 'ISSUE'::public.stock_movement_kind,
      p_source_type => 'internal_consumables',
      p_source_id => v_doc_id,
      p_note => 'صرف مستهلكات داخلي ' || v_ref || coalesce(' — ' || _notes, ''),
      p_owner_type => 'COMPANY'::public.owner_type,
      p_owner_id => NULL,
      p_movement_type_legacy => 'adjustment'::public.movement_type);
    -- شرط stock_movements_adjustment_reason_required: سبب الحركة إلزامي.
    UPDATE public.stock_movements
       SET adjustment_reason = coalesce(adjustment_reason, 'Internal consumables ' || v_ref)
     WHERE source_type = 'internal_consumables' AND source_id = v_doc_id
       AND adjustment_reason IS NULL;
  END LOOP;

  IF v_total_cost > 0 THEN
    v_journal_lines := jsonb_build_array(
      jsonb_build_object(
        'account_code', '5316',
        'debit', v_total_cost,
        'credit', 0,
        'memo', 'مصروف مواد تعبئة وتغليف مستهلكة (' || v_ref || ')'
      ),
      jsonb_build_object(
        'account_code', '1315',
        'debit', 0,
        'credit', v_total_cost,
        'memo', 'منصرف مخزون مواد التعبئة (' || v_ref || ')'
      )
    );

    PERFORM public.create_journal_entry(
      p_memo => 'صرف مستهلكات تعبئة وتشغيل ' || v_ref || coalesce(' — ' || _notes, ''),
      p_entry_date => CURRENT_DATE,
      p_source_type => 'consume_internal_supplies',
      p_source_id => v_doc_id,  -- P0-2: معرّف العملية لا معرّف المستودع
      p_is_system => true,
      p_lines => v_journal_lines
    );
  END IF;

  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, payload)
  VALUES (v_user, 'consumables.issued', 'stock_movement', v_doc_id,
    jsonb_build_object(
      'doc_id', v_doc_id,
      'ref', v_ref,
      'warehouse_id', _warehouse_id,
      'lines', _lines,
      'total_cost', v_total_cost,
      'notes', _notes
    ));

  RETURN v_ref;
END $$;

--
-- Name: create_expense(jsonb, date, date, public.expense_entry_type, public.expense_payee_type, text, uuid, uuid, uuid, uuid, uuid, text, text, public.expense_tax_mode, text, boolean); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.create_expense(p_lines jsonb, p_expense_date date DEFAULT CURRENT_DATE, p_due_date date DEFAULT NULL::date, p_entry_type public.expense_entry_type DEFAULT 'DIRECT'::public.expense_entry_type, p_payee_type public.expense_payee_type DEFAULT 'NONE'::public.expense_payee_type, p_payee_name text DEFAULT NULL::text, p_supplier_id uuid DEFAULT NULL::uuid, p_employee_id uuid DEFAULT NULL::uuid, p_warehouse_id uuid DEFAULT NULL::uuid, p_cost_center_id uuid DEFAULT NULL::uuid, p_project_id uuid DEFAULT NULL::uuid, p_description text DEFAULT NULL::text, p_note text DEFAULT NULL::text, p_tax_mode public.expense_tax_mode DEFAULT 'NONE'::public.expense_tax_mode, p_reference text DEFAULT NULL::text, p_submit boolean DEFAULT false) RETURNS public.expense_entries
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_user   uuid := public.expense_actor();
  v_entry  public.expense_entries;
  v_total  numeric;
  v_count  integer;
  v_ref    text;
  v_status public.expense_status;
  v_currency text;
  v_symbol   text;
BEGIN
  PERFORM public.expense_assert_capability(v_user, 'expense.create');

  IF p_expense_date IS NULL THEN
    RAISE EXCEPTION 'Expense date is required' USING ERRCODE = '22023';
  END IF;
  -- Plan §10: the three dates are distinct concepts; a due date before the
  -- occurrence would make the ageing report negative from day one.
  IF p_due_date IS NOT NULL AND p_due_date < p_expense_date THEN
    RAISE EXCEPTION 'Due date cannot precede the expense date' USING ERRCODE = '22023';
  END IF;

  -- The payee triple is validated in SQL as well as by the table constraint, so
  -- the caller gets a readable message instead of a constraint name.
  IF p_payee_type = 'SUPPLIER' AND p_supplier_id IS NULL THEN
    RAISE EXCEPTION 'A supplier payee requires a supplier' USING ERRCODE = '22023';
  END IF;
  IF p_payee_type = 'EMPLOYEE' AND p_employee_id IS NULL THEN
    RAISE EXCEPTION 'An employee payee requires a staff member' USING ERRCODE = '22023';
  END IF;

  -- Currency is snapshotted at creation (Phase 1 rationale): a later change to
  -- the company currency must not re-label a historical voucher.
  SELECT COALESCE(NULLIF(btrim(currency), ''), 'YER'),
         COALESCE(NULLIF(btrim(currency_symbol), ''), '﷼')
    INTO v_currency, v_symbol
  FROM public.company_settings
  ORDER BY id
  LIMIT 1;
  v_currency := COALESCE(v_currency, 'YER');
  v_symbol   := COALESCE(v_symbol, '﷼');

  -- `submit` is offered as a flag because the common real-world action is
  -- "record it and send it for approval", and doing that in two round-trips is
  -- how a document ends up stranded in DRAFT.
  v_status := CASE WHEN p_submit THEN 'SUBMITTED'::public.expense_status
                   ELSE 'DRAFT'::public.expense_status END;

  v_ref := COALESCE(
    NULLIF(btrim(COALESCE(p_reference, '')), ''),
    public.next_expense_reference()
  );

  INSERT INTO public.expense_entries (
    reference, entry_type, status, source_kind,
    payee_type, payee_name, supplier_id, employee_id,
    warehouse_id, cost_center_id, project_id,
    expense_date, due_date,
    description, note,
    tax_mode, currency, currency_symbol,
    created_by, submitted_by, submitted_at
  )
  VALUES (
    v_ref, p_entry_type, v_status, 'MANUAL',
    p_payee_type,
    nullif(btrim(coalesce(p_payee_name, '')), ''),
    CASE WHEN p_payee_type = 'SUPPLIER' THEN p_supplier_id END,
    CASE WHEN p_payee_type = 'EMPLOYEE' THEN p_employee_id END,
    p_warehouse_id, p_cost_center_id, p_project_id,
    p_expense_date, p_due_date,
    nullif(btrim(coalesce(p_description, '')), ''),
    nullif(btrim(coalesce(p_note, '')), ''),
    p_tax_mode, v_currency, v_symbol,
    v_user,
    CASE WHEN p_submit THEN v_user END,
    CASE WHEN p_submit THEN now() END
  )
  RETURNING * INTO v_entry;

  SELECT o_total, o_count INTO v_total, v_count
  FROM public.expense_write_lines(v_entry.id, p_lines, p_tax_mode);

  -- The line trigger already synced these; the assignment is explicit so the
  -- RETURNING value below is correct without a second read.
  UPDATE public.expense_entries
     SET total_amount = v_total,
         line_count   = v_count
   WHERE id = v_entry.id
  RETURNING * INTO v_entry;

  PERFORM public.expense_log_action(
    v_entry.id, 'created', NULL, v_status,
    CASE WHEN p_submit THEN 'Created and submitted' ELSE 'Created as draft' END, v_user);

  RETURN v_entry;
END $$;

--
-- Name: create_expense_v2(jsonb, date, date, public.expense_entry_type, public.expense_payee_type, text, uuid, uuid, uuid, uuid, uuid, text, text, public.expense_tax_mode, text, boolean, text, boolean, text); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.create_expense_v2(p_lines jsonb, p_expense_date date DEFAULT CURRENT_DATE, p_due_date date DEFAULT NULL::date, p_entry_type public.expense_entry_type DEFAULT 'DIRECT'::public.expense_entry_type, p_payee_type public.expense_payee_type DEFAULT 'NONE'::public.expense_payee_type, p_payee_name text DEFAULT NULL::text, p_supplier_id uuid DEFAULT NULL::uuid, p_employee_id uuid DEFAULT NULL::uuid, p_warehouse_id uuid DEFAULT NULL::uuid, p_cost_center_id uuid DEFAULT NULL::uuid, p_project_id uuid DEFAULT NULL::uuid, p_description text DEFAULT NULL::text, p_note text DEFAULT NULL::text, p_tax_mode public.expense_tax_mode DEFAULT 'NONE'::public.expense_tax_mode, p_reference text DEFAULT NULL::text, p_submit boolean DEFAULT false, p_supplier_invoice_number text DEFAULT NULL::text, p_tax_recoverable boolean DEFAULT false, p_idempotency_key text DEFAULT NULL::text) RETURNS public.expense_entries
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
$$;

--
-- Name: create_milling_service_document(uuid, uuid, uuid, numeric, numeric, uuid, numeric, numeric, text, numeric, text); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.create_milling_service_document(_customer_id uuid, _warehouse_id uuid, _grain_item_id uuid, _bags numeric, _kg numeric, _service_item_id uuid, _service_unit_price numeric, _discount numeric, _payment_method text, _paid numeric, _notes text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_user uuid := auth.uid();
  v_document_id uuid;
  v_document_number text;
  v_invoice_id uuid;
  v_invoice_number text;
  v_subtotal numeric;
  v_total numeric;
  v_paid numeric;
  v_outstanding numeric;
  v_customer_balance numeric;
  v_credit_limit numeric;
  v_period text := to_char(coalesce(current_date, now()::date), 'MM-YYYY');
  v_basis text;
  v_fee_qty numeric;
  v_fee_per_unit numeric;
  v_description text;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT (
    public.has_role(v_user, 'owner')
    OR public.has_role(v_user, 'manager')
    OR public.has_role(v_user, 'cashier')
  ) THEN
    RAISE EXCEPTION 'You are not permitted to create milling service documents';
  END IF;
  IF _customer_id IS NULL OR _warehouse_id IS NULL OR _grain_item_id IS NULL
     OR _service_item_id IS NULL THEN
    RAISE EXCEPTION 'Customer, warehouse, grain and service are required';
  END IF;
  IF coalesce(_bags, 0) <= 0 AND coalesce(_kg, 0) <= 0 THEN
    RAISE EXCEPTION 'Record at least one bag or a positive weight';
  END IF;
  IF coalesce(_bags, 0) < 0 OR coalesce(_kg, 0) < 0 THEN
    RAISE EXCEPTION 'Quantities cannot be negative';
  END IF;
  IF coalesce(_service_unit_price, 0) < 0 OR coalesce(_discount, 0) < 0
     OR coalesce(_paid, 0) < 0 THEN
    RAISE EXCEPTION 'Service price, discount and paid amount cannot be negative';
  END IF;
  IF _payment_method NOT IN ('cash', 'card', 'bank_transfer', 'credit', 'mobile_money', 'split') THEN
    RAISE EXCEPTION 'Unsupported payment method';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.products
    WHERE id = _grain_item_id AND item_class = 'RAW_MATERIAL' AND is_active
  ) THEN
    RAISE EXCEPTION 'Intake item must be an active RAW_MATERIAL grain';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.products
    WHERE id = _service_item_id AND item_class = 'SERVICE' AND is_active AND is_sellable
  ) THEN
    RAISE EXCEPTION 'Milling fee item must be an active sellable SERVICE';
  END IF;

  SELECT balance, credit_limit
    INTO v_customer_balance, v_credit_limit
  FROM public.customers
  WHERE id = _customer_id AND is_active = true
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Selected customer is unavailable';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.warehouses WHERE id = _warehouse_id AND is_active) THEN
    RAISE EXCEPTION 'Selected warehouse is unavailable';
  END IF;

  v_subtotal := round(coalesce(_service_unit_price, 0), 2);
  v_total := round(v_subtotal - coalesce(_discount, 0), 2);
  IF v_total < 0 THEN
    RAISE EXCEPTION 'Discount cannot exceed the service fee';
  END IF;
  v_paid := least(round(coalesce(_paid, 0), 2), v_total);
  v_outstanding := round(v_total - v_paid, 2);
  IF _payment_method = 'credit' AND v_paid <> 0 THEN
    RAISE EXCEPTION 'Credit payment method requires zero paid amount';
  END IF;
  IF v_outstanding > 0 AND NOT public.customer_credit_limit_allows(_customer_id, v_outstanding) THEN
    RAISE EXCEPTION
      'Credit limit exceeded: current balance %, requested debt %, limit %',
      coalesce(v_customer_balance, 0), v_outstanding, coalesce(v_credit_limit, 0);
  END IF;

  -- P1-1: أساس التسعير يُخزَّن بدل دفنه في كمية 1 وسعر إجمالي.
  IF coalesce(_bags, 0) > 0 THEN
    v_basis       := 'PER_BAG';
    v_fee_qty     := round(_bags, 3);
    v_fee_per_unit := round(v_subtotal / _bags, 2);
    v_description := format(
      'أجور طحن وتجهيز — %s كيس × %s (فترة الاستلام %s)',
      trim(to_char(_bags, 'FM999999990.###')),
      trim(to_char(v_fee_per_unit, 'FM999999990.00')),
      v_period);
  ELSE
    v_basis       := 'PER_KG';
    v_fee_qty     := round(_kg, 3);
    v_fee_per_unit := round(v_subtotal / nullif(_kg, 0), 2);
    v_description := format(
      'أجور طحن وتجهيز — %s كجم × %s (فترة الاستلام %s)',
      trim(to_char(_kg, 'FM999999990.###')),
      trim(to_char(v_fee_per_unit, 'FM999999990.00')),
      v_period);
  END IF;

  v_invoice_number := public.next_invoice_number();
  INSERT INTO public.sales_invoices (
    invoice_number, customer_id, warehouse_id, status, payment_status,
    subtotal, discount, tax, total, paid, payment_method, note, created_by
  ) VALUES (
    v_invoice_number, _customer_id, _warehouse_id, 'confirmed',
    public.derive_payment_status(v_paid, v_total),
    v_subtotal, round(coalesce(_discount, 0), 2), 0, v_total, v_paid,
    _payment_method::public.payment_method, nullif(btrim(_notes), ''), v_user
  ) RETURNING id INTO v_invoice_id;

  INSERT INTO public.sales_invoice_items (
    invoice_id, product_id, description, quantity, unit_price, discount, tax, total,
    line_type, stock_effect
  ) VALUES (
    v_invoice_id, _service_item_id, v_description, v_fee_qty, v_fee_per_unit,
    0, 0, v_subtotal, 'SERVICE', 'NONE'
  );

  IF v_outstanding > 0 THEN
    UPDATE public.customers
    SET balance = round(coalesce(balance, 0) + v_outstanding, 2), updated_at = now()
    WHERE id = _customer_id;

    INSERT INTO public.customer_ledger (
      customer_id, entry_type, debit, reference_id, reference_type,
      occurred_at, created_by, source_key, note
    ) VALUES (
      _customer_id, 'sale', v_outstanding, v_invoice_id, 'sales_invoice',
      now(), v_user, 'sale:' || v_invoice_id, 'قيد أجور طحن آجل'
    ) ON CONFLICT (source_key) DO NOTHING;
  END IF;

  PERFORM public.post_sales_invoice(v_invoice_id);

  v_document_number := 'MT-' || to_char(now(), 'YYYYMM') || '-' ||
    lpad(nextval('public.milling_document_seq')::text, 4, '0');
  INSERT INTO public.milling_service_documents (
    document_number, customer_id, warehouse_id, sales_invoice_id, created_by,
    billing_basis, fee_per_unit, fee_quantity
  ) VALUES (
    v_document_number, _customer_id, _warehouse_id, v_invoice_id, v_user,
    v_basis, v_fee_per_unit, v_fee_qty
  ) RETURNING id INTO v_document_id;

  INSERT INTO public.custody_ledger (
    customer_id, warehouse_id, entry_type, item_id, doc_number,
    bags_in, kg_in, milling_document_id, notes, created_by
  ) VALUES (
    _customer_id, _warehouse_id, 'INTAKE', _grain_item_id, v_document_number,
    coalesce(_bags, 0), coalesce(_kg, 0), v_document_id, _notes, v_user
  );

  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, payload)
  VALUES (v_user, 'milling.service_document.created', 'milling_service_documents', v_document_id,
    jsonb_build_object(
      'document_number', v_document_number,
      'invoice_id', v_invoice_id,
      'invoice_number', v_invoice_number,
      'customer_id', _customer_id,
      'grain_item_id', _grain_item_id,
      'bags', coalesce(_bags, 0),
      'kg', coalesce(_kg, 0),
      'billing_basis', v_basis,
      'fee_per_unit', v_fee_per_unit,
      'fee_quantity', v_fee_qty,
      'service_total', v_total,
      'paid', v_paid,
      'outstanding', v_outstanding,
      'stock_impact', 'NONE — customer custody'
    ));

  RETURN jsonb_build_object(
    'document_id', v_document_id,
    'document_number', v_document_number,
    'invoice_id', v_invoice_id,
    'invoice_number', v_invoice_number,
    'billing_basis', v_basis,
    'fee_per_unit', v_fee_per_unit,
    'fee_quantity', v_fee_qty
  );
END $$;

--
-- Name: create_milling_service_document_multi(uuid, uuid, jsonb, uuid, numeric, numeric, text, numeric, text); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.create_milling_service_document_multi(_customer_id uuid, _warehouse_id uuid, _grains jsonb, _service_item_id uuid, _service_unit_price numeric, _discount numeric, _payment_method text, _paid numeric, _notes text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  RETURN public.create_milling_service_document_multi(
    _customer_id, _warehouse_id, _grains, _service_item_id, _service_unit_price,
    _discount, _payment_method, _paid, _notes, '[]'::jsonb
  );
END $$;

--
-- Name: create_milling_service_document_multi(uuid, uuid, jsonb, uuid, numeric, numeric, text, numeric, text, jsonb); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.create_milling_service_document_multi(_customer_id uuid, _warehouse_id uuid, _grains jsonb, _service_item_id uuid, _service_unit_price numeric, _discount numeric, _payment_method text, _paid numeric, _notes text, _payment_splits jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_user uuid := auth.uid();
  v_document_id uuid;
  v_document_number text;
  v_invoice_id uuid;
  v_invoice_number text;
  v_subtotal numeric;
  v_total numeric;
  v_paid numeric;
  v_outstanding numeric;
  v_customer_balance numeric;
  v_credit_limit numeric;
  v_is_system boolean := false;
  v_split record;
  v_split_total numeric := 0;
  v_split_count integer := 0;
  v_recorded_method text := coalesce(_payment_method, 'cash');
  r record;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT (
    public.has_role(v_user, 'owner')
    OR public.has_role(v_user, 'manager')
    OR public.has_role(v_user, 'cashier')
  ) THEN
    RAISE EXCEPTION 'You are not permitted to create milling service documents';
  END IF;
  IF _customer_id IS NULL OR _warehouse_id IS NULL OR _service_item_id IS NULL THEN
    RAISE EXCEPTION 'Customer, warehouse and service are required';
  END IF;
  IF _grains IS NULL OR jsonb_typeof(_grains) <> 'array' OR jsonb_array_length(_grains) = 0 THEN
    RAISE EXCEPTION 'At least one grain line is required';
  END IF;
  IF coalesce(_service_unit_price, 0) < 0 OR coalesce(_discount, 0) < 0
     OR coalesce(_paid, 0) < 0 THEN
    RAISE EXCEPTION 'Service price, discount and paid amount cannot be negative';
  END IF;
  IF _payment_method NOT IN ('cash', 'card', 'bank_transfer', 'credit', 'mobile_money', 'split') THEN
    RAISE EXCEPTION 'Unsupported payment method';
  END IF;

  -- تجزئة الدفع: طرق تحصيل فقط، بمبالغ موجبة
  IF coalesce(jsonb_typeof(_payment_splits), '') = 'array'
     AND jsonb_array_length(_payment_splits) > 0 THEN
    FOR v_split IN
      SELECT part ->> 'method' AS method,
             coalesce((part ->> 'amount')::numeric, 0) AS amount,
             nullif(part ->> 'cashbox_id', '')::uuid AS cashbox_id,
             nullif(part ->> 'bank_account_id', '')::uuid AS bank_account_id,
             nullif(part ->> 'payment_method_id', '') AS payment_method_id,
             nullif(btrim(coalesce(part ->> 'reference', '')), '') AS reference
        FROM jsonb_array_elements(_payment_splits) AS part
    LOOP
      IF v_split.method IS NULL
         OR v_split.method NOT IN ('cash', 'card', 'bank_transfer', 'mobile_money', 'cheque') THEN
        RAISE EXCEPTION 'Unsupported milling split method: %', v_split.method;
      END IF;
      IF public.resolve_writable_payment_method(
           coalesce(v_split.payment_method_id, v_split.method), 'pos', true
         ) IS DISTINCT FROM v_split.method THEN
        RAISE EXCEPTION 'Payment method id does not match milling tender %', v_split.method;
      END IF;
      IF v_split.amount <= 0 THEN
        RAISE EXCEPTION 'Every milling payment tender requires a positive amount';
      END IF;
      v_split_total := v_split_total + v_split.amount;
      v_split_count := v_split_count + 1;
    END LOOP;
    IF v_split_count > 1 THEN
      v_recorded_method := 'split';
    END IF;
  END IF;

  -- تحقق أسطر الحبوب: منتج أمانات + كمية موجبة
  FOR r IN SELECT * FROM jsonb_to_recordset(_grains) AS g(item_id uuid, bags numeric, kg numeric)
  LOOP
    IF r.item_id IS NULL THEN
      RAISE EXCEPTION 'Every grain line needs an item';
    END IF;
    IF coalesce(r.bags, 0) < 0 OR coalesce(r.kg, 0) < 0 THEN
      RAISE EXCEPTION 'Grain quantities cannot be negative';
    END IF;
    IF coalesce(r.bags, 0) = 0 AND coalesce(r.kg, 0) = 0 THEN
      RAISE EXCEPTION 'Every grain line needs a positive quantity';
    END IF;
  END LOOP;

  SELECT balance, credit_limit, is_system
    INTO v_customer_balance, v_credit_limit, v_is_system
    FROM public.customers
   WHERE id = _customer_id AND is_active = true
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Selected customer is unavailable';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.warehouses WHERE id = _warehouse_id AND is_active) THEN
    RAISE EXCEPTION 'Selected warehouse is unavailable';
  END IF;

  v_subtotal := round(coalesce(_service_unit_price, 0), 2);
  v_total := round(v_subtotal - coalesce(_discount, 0), 2);
  IF v_total < 0 THEN
    RAISE EXCEPTION 'Discount cannot exceed the service fee';
  END IF;

  IF v_split_count > 0 THEN
    IF round(v_split_total, 2) > v_total THEN
      RAISE EXCEPTION 'Milling payment split total (%) exceeds the fee total (%)',
        round(v_split_total, 2), v_total;
    END IF;
    v_paid := round(v_split_total, 2);
  ELSE
    v_paid := least(round(coalesce(_paid, 0), 2), v_total);
  END IF;

  v_outstanding := round(v_total - v_paid, 2);
  IF _payment_method = 'credit' AND v_split_count = 0 AND v_paid <> 0 THEN
    RAISE EXCEPTION 'Credit payment method requires zero paid amount';
  END IF;
  IF v_outstanding > 0 AND v_is_system THEN
    RAISE EXCEPTION
      'The system cash customer cannot carry credit — select a real customer for a deferred ticket'
      USING ERRCODE = 'check_violation';
  END IF;
  IF v_outstanding > 0 AND NOT public.customer_credit_limit_allows(_customer_id, v_outstanding) THEN
    RAISE EXCEPTION
      'Credit limit exceeded: current balance %, requested debt %, limit %',
      coalesce(v_customer_balance, 0), v_outstanding, coalesce(v_credit_limit, 0);
  END IF;

  v_invoice_number := public.next_invoice_number();
  INSERT INTO public.sales_invoices (
    invoice_number, customer_id, warehouse_id, status, payment_status,
    subtotal, discount, tax, total, paid, payment_method, note, created_by
  ) VALUES (
    v_invoice_number, _customer_id, _warehouse_id, 'confirmed',
    public.derive_payment_status(v_paid, v_total),
    v_subtotal, round(coalesce(_discount, 0), 2), 0, v_total, v_paid,
    v_recorded_method::public.payment_method, nullif(btrim(_notes), ''), v_user
  ) RETURNING id INTO v_invoice_id;

  INSERT INTO public.sales_invoice_items (
    invoice_id, product_id, description, quantity, unit_price, discount, tax, total,
    line_type, stock_effect
  ) VALUES (
    v_invoice_id, _service_item_id, 'أجور طحن وتجهيز', 1, v_subtotal,
    0, 0, v_subtotal, 'SERVICE', 'NONE'
  );

  IF v_outstanding > 0 THEN
    UPDATE public.customers
    SET balance = round(coalesce(balance, 0) + v_outstanding, 2), updated_at = now()
    WHERE id = _customer_id;

    INSERT INTO public.customer_ledger (
      customer_id, entry_type, debit, reference_id, reference_type,
      occurred_at, created_by, source_key, note
    ) VALUES (
      _customer_id, 'sale', v_outstanding, v_invoice_id, 'sales_invoice',
      now(), v_user, 'sale:' || v_invoice_id, 'قيد أجور طحن آجل'
    ) ON CONFLICT (source_key) DO NOTHING;
  END IF;

  v_document_number := 'MT-' || to_char(now(), 'YYYYMM') || '-' ||
    lpad(nextval('public.milling_document_seq')::text, 4, '0');
  INSERT INTO public.milling_service_documents (
    document_number, customer_id, warehouse_id, sales_invoice_id, created_by
  ) VALUES (
    v_document_number, _customer_id, _warehouse_id, v_invoice_id, v_user
  ) RETURNING id INTO v_document_id;

  -- أجزاء الدفع تُسجّل قبل الترحيل ليقرأها post_sales_invoice ويوزّعها على الحسابات.
  IF v_split_count > 0 THEN
    FOR v_split IN
      SELECT part ->> 'method' AS method,
             coalesce((part ->> 'amount')::numeric, 0) AS amount,
             nullif(part ->> 'cashbox_id', '')::uuid AS cashbox_id,
             nullif(part ->> 'bank_account_id', '')::uuid AS bank_account_id,
             nullif(part ->> 'payment_method_id', '') AS payment_method_id,
             nullif(btrim(coalesce(part ->> 'reference', '')), '') AS reference
        FROM jsonb_array_elements(_payment_splits) AS part
    LOOP
      INSERT INTO public.payment_splits (
        document_type, document_id, method, amount, reference, created_by,
        cashbox_id, bank_account_id, payment_method_id
      ) VALUES (
        'milling_service_document', v_document_id,
        v_split.method::public.payment_method, round(v_split.amount, 2),
        v_split.reference, v_user, v_split.cashbox_id, v_split.bank_account_id,
        coalesce(v_split.payment_method_id, v_split.method)
      );
      INSERT INTO public.customer_payment_splits (
        customer_id, invoice_id, method, amount, occurred_at, created_by,
        cashbox_id, bank_account_id, payment_method_id, reference_no
      ) VALUES (
        _customer_id, v_invoice_id, v_split.method::public.payment_method,
        round(v_split.amount, 2), now(), v_user, v_split.cashbox_id,
        v_split.bank_account_id, coalesce(v_split.payment_method_id, v_split.method),
        v_split.reference
      );
    END LOOP;
  END IF;

  PERFORM set_config('app.payment_split_internal_post', 'on', true);
  PERFORM public.post_sales_invoice(v_invoice_id);
  PERFORM set_config('app.payment_split_internal_post', 'off', true);

  FOR r IN SELECT * FROM jsonb_to_recordset(_grains) AS g(item_id uuid, bags numeric, kg numeric)
  LOOP
    INSERT INTO public.custody_ledger (
      customer_id, warehouse_id, entry_type, item_id, doc_number,
      bags_in, kg_in, milling_document_id, notes, created_by
    ) VALUES (
      _customer_id, _warehouse_id, 'INTAKE', r.item_id, v_document_number,
      coalesce(r.bags, 0), coalesce(r.kg, 0), v_document_id, _notes, v_user
    );
  END LOOP;

  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, payload)
  VALUES (v_user, 'milling.service_document.created', 'milling_service_documents', v_document_id,
    jsonb_build_object(
      'document_number', v_document_number,
      'invoice_id', v_invoice_id,
      'grains', _grains,
      'service_total', v_total,
      'paid', v_paid,
      'outstanding', v_outstanding,
      'has_splits', v_split_count > 0,
      'split_count', v_split_count,
      'stock_impact', 'NONE — customer custody'
    ));

  RETURN jsonb_build_object(
    'document_id', v_document_id,
    'document_number', v_document_number,
    'invoice_id', v_invoice_id,
    'invoice_number', v_invoice_number
  );
END $$;

--
-- Name: create_milling_service_document_multi_priced(uuid, uuid, jsonb, uuid, numeric, numeric, text, numeric, text, jsonb, text, numeric); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.create_milling_service_document_multi_priced(p_customer_id uuid, p_warehouse_id uuid, p_grains jsonb, p_service_item_id uuid, p_service_gross numeric, p_discount numeric, p_payment_method text, p_paid numeric, p_notes text, p_payment_splits jsonb, p_billing_basis text, p_fee_quantity numeric) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_result jsonb;
  v_document_id uuid;
  v_invoice_id uuid;
  v_service record;
  v_basis text := upper(coalesce(p_billing_basis, ''));
  v_unit_basis text;
  v_quantity numeric(18,3) := round(coalesce(p_fee_quantity, 0), 3);
  v_expected_quantity numeric(18,3);
  v_gross numeric(18,2) := round(coalesce(p_service_gross, 0), 2);
  v_discount numeric(18,2) := round(coalesce(p_discount, 0), 2);
  v_net numeric(18,2);
  v_rate numeric(18,6);
  v_unit_increment numeric(30,12);
  v_description text;
BEGIN
  IF v_basis NOT IN ('PER_BAG', 'PER_KG') THEN
    RAISE EXCEPTION 'Billing basis must be PER_BAG or PER_KG';
  END IF;
  IF v_quantity <= 0 THEN
    RAISE EXCEPTION 'The billed bag or kilogram quantity must be positive';
  END IF;
  IF v_gross <= 0 OR v_discount < 0 OR v_discount >= v_gross THEN
    RAISE EXCEPTION 'The net milling service fee must remain positive after discount';
  END IF;
  IF p_grains IS NULL OR jsonb_typeof(p_grains) <> 'array' THEN
    RAISE EXCEPTION 'At least one grain line is required';
  END IF;

  IF v_basis = 'PER_BAG' THEN
    SELECT round(coalesce(sum(g.bags), 0), 3)
      INTO v_expected_quantity
      FROM jsonb_to_recordset(p_grains) AS g(item_id uuid, bags numeric, kg numeric);
    v_unit_increment := 0.001;
  ELSE
    SELECT round(coalesce(sum(g.kg), 0), 3)
      INTO v_expected_quantity
      FROM jsonb_to_recordset(p_grains) AS g(item_id uuid, bags numeric, kg numeric);
    v_unit_increment := 0.001;
  END IF;
  IF v_expected_quantity <= 0 OR v_quantity <> v_expected_quantity THEN
    RAISE EXCEPTION 'Billed quantity (%) does not match received quantity (%) for %',
      v_quantity, v_expected_quantity, v_basis;
  END IF;

  SELECT p.id, p.cost_price, coalesce(p.base_uom_id, p.unit_id) AS uom_id,
         p.name_ar, p.name, u.short_name, u.name AS uom_name, u.name_ar AS uom_name_ar
    INTO v_service
    FROM public.products p
    LEFT JOIN public.units u ON u.id = coalesce(p.base_uom_id, p.unit_id)
   WHERE p.id = p_service_item_id
     AND p.item_class = 'SERVICE'
     AND p.is_active
     AND p.is_sellable;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Milling service must be an active sellable service item';
  END IF;

  v_unit_basis := CASE
    WHEN lower(coalesce(v_service.short_name, '') || ' ' || coalesce(v_service.uom_name_ar, '') || ' ' || coalesce(v_service.uom_name, ''))
      ~ '(bag|sack|كيس|جوال)' THEN 'PER_BAG'
    WHEN lower(coalesce(v_service.short_name, '') || ' ' || coalesce(v_service.uom_name_ar, '') || ' ' || coalesce(v_service.uom_name, ''))
      ~ '(kg|كجم|كغ|كيلو|kilogram)' THEN 'PER_KG'
    ELSE NULL
  END;
  IF v_unit_basis IS NOT NULL AND v_unit_basis <> v_basis THEN
    RAISE EXCEPTION 'Billing basis % does not match service item base unit %',
      v_basis, coalesce(v_service.uom_name_ar, v_service.uom_name, v_service.short_name, 'unknown');
  END IF;

  v_net := round(v_gross - v_discount, 2);
  v_rate := round(v_gross / v_quantity, 6);
  v_description := format(
    'أجور الطحن — %s %s × %s',
    trim(to_char(v_quantity, 'FM999999990.###')),
    CASE WHEN v_basis = 'PER_BAG' THEN 'كيس' ELSE 'كجم' END,
    trim(to_char(v_rate, 'FM999999990.######'))
  );

  -- The old RPC handles authentication, credit limits, payment splits, cash
  -- settlement and custody intake atomically. Passing net/zero discount makes
  -- its pre-posted journal match cash + receivable exactly.
  v_result := public.create_milling_service_document_multi(
    p_customer_id, p_warehouse_id, p_grains, p_service_item_id,
    v_net, 0, p_payment_method, p_paid, p_notes, coalesce(p_payment_splits, '[]'::jsonb)
  );
  v_document_id := nullif(v_result ->> 'document_id', '')::uuid;
  v_invoice_id := nullif(v_result ->> 'invoice_id', '')::uuid;
  IF v_document_id IS NULL OR v_invoice_id IS NULL THEN
    RAISE EXCEPTION 'The milling intake did not return its invoice and document references';
  END IF;

  UPDATE public.sales_invoices
     SET subtotal = v_gross,
         discount = v_discount,
         total = v_net
   WHERE id = v_invoice_id;

  UPDATE public.sales_invoice_items
     SET description = v_description,
         quantity = v_quantity,
         unit_price = round(v_gross / v_quantity, 2),
         discount = v_discount,
         tax = 0,
         total = v_net,
         line_type = 'SERVICE',
         stock_effect = 'NONE',
         uom_id = v_service.uom_id,
         entered_quantity = v_quantity,
         entered_unit_price = v_rate,
         base_quantity = v_quantity,
         base_unit_price = v_rate,
         uom_conversion_factor = 1,
         uom_quantity_increment = v_unit_increment
   WHERE invoice_id = v_invoice_id
     AND product_id = p_service_item_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'The posted milling invoice is missing its service line';
  END IF;

  UPDATE public.milling_service_documents
     SET billing_basis = v_basis,
         fee_per_unit = v_rate,
         fee_quantity = v_quantity,
         estimated_cost_basis = CASE
           WHEN coalesce(v_service.cost_price, 0) > 0 THEN
             CASE WHEN v_basis = 'PER_BAG' THEN 'BAG' ELSE 'KG' END
           ELSE NULL END,
         estimated_cost_rate = CASE
           WHEN coalesce(v_service.cost_price, 0) > 0 THEN v_service.cost_price ELSE NULL END,
         estimated_cost_quantity = CASE
           WHEN coalesce(v_service.cost_price, 0) > 0 THEN v_quantity ELSE NULL END,
         estimated_cost_amount = CASE
           WHEN coalesce(v_service.cost_price, 0) > 0
             THEN round(v_service.cost_price * v_quantity, 2) ELSE NULL END,
         estimated_cost_captured_at = CASE
           WHEN coalesce(v_service.cost_price, 0) > 0 THEN now() ELSE NULL END
   WHERE id = v_document_id;

  RETURN v_result || jsonb_build_object(
    'billing_basis', v_basis,
    'fee_per_unit', v_rate,
    'fee_quantity', v_quantity
  );
END;
$$;

--
-- Name: create_purchase(uuid, uuid, text, numeric, numeric, text, jsonb, jsonb); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.create_purchase(_warehouse_id uuid, _supplier_id uuid, _payment_method text, _paid numeric, _discount numeric, _note text, _items jsonb, _payment_splits jsonb) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_invoice_id       uuid;
  v_invoice_no       text;
  v_user             uuid := auth.uid();
  v_item             jsonb;
  v_subtotal         numeric := 0;
  v_tax_total        numeric := 0;
  v_total            numeric := 0;
  v_qty              numeric;
  v_entered_qty      numeric;
  v_conversion_factor numeric;
  v_quantity_increment numeric;
  v_entered_cost     numeric;
  v_uom_id           uuid;
  v_cost             numeric;
  v_tax_rate         numeric;
  v_line_total       numeric;
  v_line_tax         numeric;
  v_product          uuid;
  v_effect           text;
  v_type             text;
  v_purchasable      boolean;
  v_system           boolean := false;
  v_supplier_balance numeric;
  v_paid             numeric;
  v_split            record;
  v_split_total      numeric := 0;
  v_split_count      integer := 0;
  v_recorded_method  text := coalesce(_payment_method, 'cash');
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT public.is_staff(v_user) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  IF _warehouse_id IS NULL THEN
    RAISE EXCEPTION 'Warehouse required';
  END IF;
  IF _supplier_id IS NULL THEN
    RAISE EXCEPTION 'Supplier required';
  END IF;
  IF coalesce(jsonb_array_length(_items), 0) = 0 THEN
    RAISE EXCEPTION 'No items';
  END IF;

  ------------------------------------------------------------------ validate
  FOR v_item IN SELECT * FROM jsonb_array_elements(_items) LOOP
    v_qty      := (v_item ->> 'quantity')::numeric;
    v_cost     := (v_item ->> 'unit_cost')::numeric;
    v_tax_rate := coalesce((v_item ->> 'tax_rate')::numeric, 0);

    IF v_qty IS NULL OR v_qty <= 0 THEN
      RAISE EXCEPTION 'Invalid quantity';
    END IF;
    IF v_cost IS NULL OR v_cost < 0 THEN
      RAISE EXCEPTION 'Invalid unit cost';
    END IF;
    IF v_tax_rate < 0 OR v_tax_rate > 100 THEN
      RAISE EXCEPTION 'Invalid tax rate';
    END IF;
    IF (v_item ->> 'product_id') IS NOT NULL THEN
      SELECT p.is_purchasable INTO v_purchasable
      FROM public.products p WHERE p.id = (v_item ->> 'product_id')::uuid;

      IF v_purchasable IS NOT TRUE THEN
        RAISE EXCEPTION 'Item % is not marked as purchasable', v_item ->> 'product_id';
      END IF;

      v_product := (v_item ->> 'product_id')::uuid;
      v_uom_id := nullif(btrim(coalesce(v_item ->> 'uom_id', '')), '')::uuid;
      v_entered_qty := v_qty;
      v_entered_cost := v_cost;
      v_conversion_factor := public.product_uom_factor(v_product, v_uom_id, 'PURCHASE');
      v_qty := public.product_quantity_in_base(v_product, v_entered_qty, v_uom_id, 'PURCHASE');
      v_cost := round(v_entered_cost / v_conversion_factor, 6);
    ELSE
      v_entered_qty := v_qty;
      v_entered_cost := v_cost;
      v_conversion_factor := 1;
    END IF;

    v_line_total := round(v_entered_qty * v_entered_cost, 2);
    v_line_tax   := round(v_line_total * v_tax_rate / 100, 2);
    v_subtotal   := v_subtotal + v_line_total;
    v_tax_total  := v_tax_total + v_line_tax;
  END LOOP;

  v_total := v_subtotal + v_tax_total - coalesce(_discount, 0);

  -- ── التحقق من تجزئة الدفع قبل أي إدراج ──
  IF coalesce(jsonb_typeof(_payment_splits), '') = 'array'
     AND jsonb_array_length(_payment_splits) > 0 THEN
    FOR v_split IN
      SELECT part ->> 'method' AS method,
             coalesce((part ->> 'amount')::numeric, 0) AS amount,
             nullif(part ->> 'cashbox_id', '')::uuid AS cashbox_id,
             nullif(part ->> 'bank_account_id', '')::uuid AS bank_account_id,
             nullif(part ->> 'payment_method_id', '') AS payment_method_id,
             nullif(btrim(coalesce(part ->> 'reference', '')), '') AS reference
        FROM jsonb_array_elements(_payment_splits) AS part
    LOOP
      IF v_split.method IS NULL
         OR v_split.method NOT IN ('cash', 'card', 'bank_transfer', 'mobile_money', 'cheque') THEN
        RAISE EXCEPTION 'Unsupported purchase split method: %', v_split.method;
      END IF;
      IF public.resolve_writable_payment_method(
           coalesce(v_split.payment_method_id, v_split.method), 'purchases', true
         ) IS DISTINCT FROM v_split.method THEN
        RAISE EXCEPTION 'Payment method id does not match purchase tender %', v_split.method;
      END IF;
      IF v_split.amount <= 0 THEN
        RAISE EXCEPTION 'Every purchase payment tender requires a positive amount';
      END IF;
      v_split_total := v_split_total + v_split.amount;
      v_split_count := v_split_count + 1;
    END LOOP;

    IF round(v_split_total, 2) > round(v_total, 2) THEN
      RAISE EXCEPTION 'Purchase payment split total (%) exceeds the invoice total (%)',
        round(v_split_total, 2), round(v_total, 2);
    END IF;

    IF v_split_count > 1 THEN
      v_recorded_method := 'split';
    END IF;
  END IF;

  SELECT balance, is_system INTO v_supplier_balance, v_system
    FROM public.suppliers WHERE id = _supplier_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Selected supplier is unavailable';
  END IF;

  -- مع التجزئة، المدفوع هو مجموع الأجزاء نفسها، لا رقم يخمّنه العميل.
  v_paid := CASE
              WHEN v_split_count > 0 THEN round(v_split_total, 2)
              ELSE least(coalesce(_paid, 0), v_total)
            END;

  IF v_paid < 0 OR v_paid > v_total THEN
    RAISE EXCEPTION 'Paid amount (%) must be between zero and the invoice total (%)', v_paid, v_total;
  END IF;

  IF v_paid < v_total AND v_system THEN
    RAISE EXCEPTION
      'The system cash supplier cannot carry a payable balance — record a paid purchase or choose a real supplier'
      USING ERRCODE = 'check_violation';
  END IF;

  v_invoice_no := public.next_purchase_number();

  INSERT INTO public.purchase_invoices (
    invoice_number, supplier_id, warehouse_id, status, payment_status,
    subtotal, discount, tax, total, paid, payment_method, note, created_by
  )
  VALUES (
    v_invoice_no, _supplier_id, _warehouse_id,
    'confirmed'::public.invoice_status,
    public.derive_payment_status(v_paid, v_total),
    v_subtotal, coalesce(_discount, 0), v_tax_total, v_total, v_paid,
    v_recorded_method::public.payment_method, nullif(btrim(_note), ''), v_user
  )
  RETURNING id INTO v_invoice_id;

  --------------------------------------------------------------------- post
  FOR v_item IN SELECT * FROM jsonb_array_elements(_items) LOOP
    v_product  := (v_item ->> 'product_id')::uuid;
    v_entered_qty := (v_item ->> 'quantity')::numeric;
    v_entered_cost := (v_item ->> 'unit_cost')::numeric;
    v_uom_id := nullif(btrim(coalesce(v_item ->> 'uom_id', '')), '')::uuid;
    v_qty := v_entered_qty;
    v_cost := v_entered_cost;
    v_conversion_factor := 1;
    v_quantity_increment := NULL;
    v_tax_rate := coalesce((v_item ->> 'tax_rate')::numeric, 0);

    IF v_product IS NOT NULL THEN
      v_conversion_factor := public.product_uom_factor(v_product, v_uom_id, 'PURCHASE');
      SELECT pu.quantity_increment
        INTO v_quantity_increment
        FROM public.product_uoms pu
       WHERE pu.product_id = v_product
         AND pu.unit_id = coalesce(v_uom_id, (SELECT coalesce(p.base_uom_id, p.unit_id)
           FROM public.products p WHERE p.id = v_product))
         AND pu.is_active;
      v_quantity_increment := coalesce(v_quantity_increment, 0.001);
      v_qty := public.product_quantity_in_base(v_product, v_entered_qty, v_uom_id, 'PURCHASE');
      v_cost := round(v_entered_cost / v_conversion_factor, 6);
      v_uom_id := coalesce(v_uom_id, (SELECT coalesce(p.base_uom_id, p.unit_id)
        FROM public.products p WHERE p.id = v_product));
    END IF;

    v_line_total := round(v_entered_qty * v_entered_cost, 2);
    v_line_tax   := round(v_line_total * v_tax_rate / 100, 2);

    SELECT r.o_line_type, r.o_stock_effect
      INTO v_type, v_effect
    FROM public.resolve_purchase_line(v_item) AS r;

    INSERT INTO public.purchase_invoice_items (
      invoice_id, product_id, quantity, unit_cost, discount, tax, total,
      line_type, stock_effect, batch_number, expiry_date, uom_id, base_unit_cost,
      entered_quantity, base_quantity, uom_conversion_factor, entered_unit_cost,
      uom_quantity_increment
    )
    VALUES (
      v_invoice_id, v_product, v_qty, v_cost, 0, v_line_tax, v_line_total + v_line_tax,
      v_type, v_effect,
      nullif(btrim(coalesce(v_item ->> 'batch_number', '')), ''),
      nullif(btrim(coalesce(v_item ->> 'expiry_date', '')), '')::date,
      v_uom_id, CASE WHEN v_product IS NULL THEN NULL ELSE v_cost END,
      CASE WHEN v_product IS NULL THEN NULL ELSE v_entered_qty END,
      CASE WHEN v_product IS NULL THEN NULL ELSE v_qty END,
      CASE WHEN v_product IS NULL THEN NULL ELSE v_conversion_factor END,
      CASE WHEN v_product IS NULL THEN NULL ELSE v_entered_cost END,
      v_quantity_increment
    );

    IF v_effect = 'STOCK_RECEIPT' AND v_product IS NOT NULL THEN
      PERFORM public.post_stock_delta(
        v_product,
        _warehouse_id,
        v_qty,
        v_cost,
        'RECEIPT'::public.stock_movement_kind,
        'purchase_invoice',
        v_invoice_id,
        'Purchase receipt',
        'COMPANY'::public.owner_type,
        NULL,
        'purchase'::public.movement_type
      );
    END IF;
  END LOOP;

  -- سجلات التجزئة — الحارس المؤجل يتحقق من مطابقة المدفوع عند الالتزام.
  IF v_split_count > 0 THEN
    FOR v_split IN
      SELECT part ->> 'method' AS method,
             coalesce((part ->> 'amount')::numeric, 0) AS amount,
             nullif(btrim(coalesce(part ->> 'reference', '')), '') AS reference,
             nullif(part ->> 'cashbox_id', '')::uuid AS cashbox_id,
             nullif(part ->> 'bank_account_id', '')::uuid AS bank_account_id,
             nullif(part ->> 'payment_method_id', '') AS payment_method_id
        FROM jsonb_array_elements(_payment_splits) AS part
    LOOP
      INSERT INTO public.payment_splits (
        document_type, document_id, method, amount, reference, created_by,
        cashbox_id, bank_account_id, payment_method_id
      )
      VALUES (
        'purchase_invoice', v_invoice_id,
        v_split.method::public.payment_method,
        round(v_split.amount, 2), v_split.reference, v_user,
        v_split.cashbox_id, v_split.bank_account_id,
        coalesce(v_split.payment_method_id, v_split.method)
      );
    END LOOP;
  END IF;

  IF v_paid < v_total THEN
    UPDATE public.suppliers
    SET balance = balance + (v_total - v_paid), updated_at = now()
    WHERE id = _supplier_id;
  END IF;

  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, payload)
  VALUES (v_user, 'purchase.posted', 'purchase_invoice', v_invoice_id,
    jsonb_build_object(
      'invoice_number', v_invoice_no,
      'supplier_id', _supplier_id,
      'warehouse_id', _warehouse_id,
      'total', v_total,
      'paid', v_paid,
      'line_count', jsonb_array_length(_items),
      'has_splits', v_split_count > 0,
      'split_count', v_split_count
    ));

  PERFORM set_config('app.payment_split_internal_post', 'on', true);
  PERFORM public.post_purchase_invoice(v_invoice_id);
  PERFORM set_config('app.payment_split_internal_post', 'off', true);

  RETURN v_invoice_id;
END $$;

--
-- Name: create_purchase(uuid, uuid, text, numeric, numeric, text, jsonb, uuid, uuid, text, text); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.create_purchase(_warehouse_id uuid, _supplier_id uuid, _payment_method text, _paid numeric, _discount numeric, _note text, _items jsonb, _cashbox_id uuid DEFAULT NULL::uuid, _bank_account_id uuid DEFAULT NULL::uuid, _payment_reference text DEFAULT NULL::text, _payment_method_id text DEFAULT NULL::text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_invoice_id uuid;
  v_resolved_cashbox uuid := _cashbox_id;
  v_split_method text;
  v_payment_splits jsonb := '[]'::jsonb;
BEGIN
  -- نفس سلوك النسخة السابقة: الصندوق الافتراضي للدفع النقدي عند غيابه.
  IF _payment_method = 'cash' AND v_resolved_cashbox IS NULL THEN
    SELECT id INTO v_resolved_cashbox
      FROM public.cashboxes
     WHERE is_active = true AND is_default = true
     LIMIT 1;
    IF v_resolved_cashbox IS NULL THEN
      SELECT id INTO v_resolved_cashbox FROM public.cashboxes
       WHERE is_active = true ORDER BY created_at ASC LIMIT 1;
    END IF;
  END IF;

  IF coalesce(_paid, 0) > 0 AND _payment_method <> 'credit' THEN
    v_split_method := public.resolve_writable_payment_method(
      coalesce(_payment_method_id, _payment_method), 'purchases', true
    );
    IF v_split_method IS DISTINCT FROM _payment_method THEN
      RAISE EXCEPTION 'Payment method id does not match purchase method %', _payment_method;
    END IF;
    v_payment_splits := jsonb_build_array(jsonb_build_object(
      'method', v_split_method,
      'amount', round(_paid, 2),
      'payment_method_id', coalesce(_payment_method_id, _payment_method),
      'cashbox_id', v_resolved_cashbox,
      'bank_account_id', _bank_account_id,
      'reference', _payment_reference
    ));
  END IF;

  v_invoice_id := public.create_purchase(
    _warehouse_id, _supplier_id, _payment_method, _paid, _discount, _note, _items,
    v_payment_splits
  );

  UPDATE public.purchase_invoices
     SET cashbox_id = v_resolved_cashbox,
         bank_account_id = _bank_account_id,
         payment_reference = nullif(btrim(_payment_reference), ''),
         payment_method_id = _payment_method_id
   WHERE id = v_invoice_id;

  RETURN v_invoice_id;
END $$;

--
-- Name: create_purchase_return(uuid, uuid, uuid, text, text, jsonb); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.create_purchase_return(_invoice_id uuid, _warehouse_id uuid, _supplier_id uuid, _refund_method text, _note text, _items jsonb) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_id     uuid;
  v_no     text;
  v_user   uuid := auth.uid();
  v_item   jsonb;
  v_entered_qty numeric;
  v_entered_cost numeric;
  v_factor numeric;
  v_uom_id uuid;
  v_quantity_increment numeric;
  v_sub    numeric := 0;
  v_tax    numeric := 0;
  v_tot    numeric := 0;
  v_qty    numeric;
  v_cost   numeric;
  v_lt     numeric;
  v_ltax   numeric;
  v_p      uuid;
  v_effect text;
  v_type   text;
  v_avail  numeric;
  v_entry  uuid;
  v_lines  jsonb := '[]'::jsonb;
  v_cash_acct text;
  r        record;
  v_origin record;
  v_invoice record;
  v_invoice_item_id uuid;
  v_returned numeric;
  v_discount_factor numeric := 1;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT public.is_staff(v_user) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  IF _invoice_id IS NULL THEN
    RAISE EXCEPTION 'A purchase return must be linked to its original invoice';
  END IF;
  IF coalesce(jsonb_array_length(_items), 0) = 0 THEN
    RAISE EXCEPTION 'No items';
  END IF;

  SELECT * INTO v_invoice
    FROM public.purchase_invoices
   WHERE id = _invoice_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Original purchase invoice % does not exist', _invoice_id;
  END IF;
  IF v_invoice.status IN ('draft', 'cancelled') THEN
    RAISE EXCEPTION 'A return requires a confirmed purchase invoice';
  END IF;
  IF _supplier_id IS DISTINCT FROM v_invoice.supplier_id
     OR _warehouse_id IS DISTINCT FROM v_invoice.warehouse_id THEN
    RAISE EXCEPTION 'Purchase return supplier and warehouse must match the original invoice';
  END IF;
  IF coalesce(v_invoice.subtotal, 0) > 0 AND coalesce(v_invoice.discount, 0) > 0 THEN
    v_discount_factor := 1 - least(1, v_invoice.discount / v_invoice.subtotal);
  END IF;

  IF EXISTS (
    SELECT 1
      FROM jsonb_array_elements(_items) AS src(item)
     GROUP BY nullif(btrim(coalesce(src.item ->> 'invoice_item_id', '')), '')::uuid
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Combine each original invoice line into one return line';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(_items) LOOP
    v_p    := (v_item ->> 'product_id')::uuid;
    v_qty  := (v_item ->> 'quantity')::numeric;
    v_entered_qty := v_qty;
    v_uom_id := nullif(btrim(coalesce(v_item ->> 'uom_id', '')), '')::uuid;
    v_invoice_item_id := nullif(btrim(coalesce(v_item ->> 'invoice_item_id', '')), '')::uuid;
    IF v_invoice_item_id IS NULL OR v_p IS NULL OR v_entered_qty IS NULL OR v_entered_qty <= 0 THEN
      RAISE EXCEPTION 'Every purchase return line must reference an invoice item and positive quantity';
    END IF;
    SELECT pii.* INTO v_origin
      FROM public.purchase_invoice_items pii
     WHERE pii.id = v_invoice_item_id
       AND pii.invoice_id = _invoice_id
       AND pii.product_id = v_p
     FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Purchase return item % does not belong to the selected invoice', v_invoice_item_id;
    END IF;
    IF v_uom_id IS DISTINCT FROM v_origin.uom_id THEN
      RAISE EXCEPTION 'Purchase returns must use the original invoice line unit';
    END IF;
    v_quantity_increment := coalesce(v_origin.uom_quantity_increment, 0.001);
    IF mod(v_entered_qty, v_quantity_increment) <> 0 THEN
      RAISE EXCEPTION 'Returned quantity must follow the original invoice unit increment %', v_quantity_increment
        USING ERRCODE = 'check_violation';
    END IF;
    v_factor := coalesce(v_origin.uom_conversion_factor, 1);
    v_qty := v_entered_qty * v_factor;
    IF v_qty <> round(v_qty, 3) THEN
      RAISE EXCEPTION 'Returned base quantity exceeds inventory precision on invoice line %', v_invoice_item_id
        USING ERRCODE = 'check_violation';
    END IF;
    v_cost := coalesce(v_origin.base_unit_cost, v_origin.unit_cost);
    v_entered_cost := coalesce(v_origin.entered_unit_cost, v_cost * v_factor);

    SELECT coalesce(sum(pri.quantity), 0) INTO v_returned
      FROM public.purchase_return_items pri
      JOIN public.purchase_returns pr ON pr.id = pri.return_id
     WHERE pr.invoice_id = _invoice_id
       AND pri.product_id = v_p
       AND (pri.invoice_item_id = v_invoice_item_id OR pri.invoice_item_id IS NULL);
    IF v_returned + v_qty > v_origin.quantity THEN
      RAISE EXCEPTION 'Purchase return exceeds the received quantity on invoice line %', v_invoice_item_id
        USING ERRCODE = 'check_violation';
    END IF;

    v_effect := public.item_stock_effect(v_p, 'out');

    -- Only a tracked good has stock to send back.
    IF v_effect = 'STOCK_ISSUE' THEN
      SELECT i.quantity INTO v_avail
      FROM public.inventory i
      WHERE i.product_id = v_p
        AND i.warehouse_id = _warehouse_id
        AND i.owner_type = 'COMPANY'
        AND i.owner_id IS NULL;

      IF coalesce(v_avail, 0) < v_qty THEN
        RAISE EXCEPTION 'Insufficient stock for item %', v_p;
      END IF;
    END IF;

    v_lt   := round(v_qty * v_cost * v_discount_factor, 2);
    v_ltax := round(v_qty * coalesce(v_origin.tax / nullif(v_origin.quantity, 0), 0), 2);
    v_sub  := v_sub + v_lt;
    v_tax  := v_tax + v_ltax;
  END LOOP;
  v_tot := v_sub + v_tax;
  v_no  := public.next_purchase_return_number();

  INSERT INTO public.purchase_returns (
    return_number, invoice_id, supplier_id, warehouse_id,
    subtotal, tax, total, refund_method, note, created_by
  )
  VALUES (
    v_no, _invoice_id, _supplier_id, _warehouse_id,
    v_sub, v_tax, v_tot, _refund_method::public.payment_method,
    nullif(btrim(_note), ''), v_user
  )
  RETURNING id INTO v_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(_items) LOOP
    v_p    := (v_item ->> 'product_id')::uuid;
    v_entered_qty := (v_item ->> 'quantity')::numeric;
    v_uom_id := nullif(btrim(coalesce(v_item ->> 'uom_id', '')), '')::uuid;
    v_invoice_item_id := nullif(btrim(coalesce(v_item ->> 'invoice_item_id', '')), '')::uuid;
    SELECT pii.* INTO v_origin
      FROM public.purchase_invoice_items pii
     WHERE pii.id = v_invoice_item_id AND pii.invoice_id = _invoice_id AND pii.product_id = v_p;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Purchase return item % does not belong to the selected invoice', v_invoice_item_id;
    END IF;
    v_quantity_increment := coalesce(v_origin.uom_quantity_increment, 0.001);
    v_factor := coalesce(v_origin.uom_conversion_factor, 1);
    v_qty := v_entered_qty * v_factor;
    v_cost := coalesce(v_origin.base_unit_cost, v_origin.unit_cost);
    v_entered_cost := coalesce(v_origin.entered_unit_cost, v_cost * v_factor);
    v_lt   := round(v_qty * v_cost * v_discount_factor, 2);
    v_ltax := round(v_qty * coalesce(v_origin.tax / nullif(v_origin.quantity, 0), 0), 2);

    v_type   := public.item_line_type(v_p, false);
    v_effect := public.item_stock_effect(v_p, 'out');

    INSERT INTO public.purchase_return_items (
      return_id, product_id, quantity, unit_cost, tax, total, line_type, invoice_item_id,
      uom_id, entered_quantity, base_quantity, uom_conversion_factor, entered_unit_cost,
      uom_quantity_increment
    )
    VALUES (
      v_id, v_p, v_qty, v_cost, v_ltax, v_lt + v_ltax, v_type, v_invoice_item_id,
      coalesce(v_uom_id, (SELECT coalesce(p.base_uom_id, p.unit_id)
        FROM public.products p WHERE p.id = v_p)),
      v_entered_qty, v_qty, v_factor, v_entered_cost, v_quantity_increment
    );

    IF v_effect = 'STOCK_ISSUE' THEN
      PERFORM public.post_stock_delta(
        v_p,
        _warehouse_id,
        -v_qty,
        v_cost,
        'ISSUE'::public.stock_movement_kind,
        'purchase_return',
        v_id,
        'Purchase return',
        'COMPANY'::public.owner_type,
        NULL,
        'purchase_return'::public.movement_type
      );
    END IF;
  END LOOP;

  -- T-12: رصيد المورد يتغير فعليًا ويمكن أن يصير سالبًا (دائنًا لنا —
  -- مبلغ مسترد مستحق) بدل إخفاء الفرق بـ greatest(...,0).
  IF _supplier_id IS NOT NULL THEN
    UPDATE public.suppliers
    SET balance = round(coalesce(balance, 0) - v_tot, 2), updated_at = now()
    WHERE id = _supplier_id;
  END IF;

  -- ── T-08(ب): قيد المرتجع — أطراف قيد المشتريات المقلوبة ──────────────────
  IF v_tot <> 0 THEN
    -- المخزون يُخفض بقيمته الدفترية الفعلية المحسوبة بالمحرك، لا بسعر الشراء التاريخي.
    -- اجمع حركات الصرف مباشرة لتجنب تكرار القيمة عند تعدد أسطر الصنف.
    FOR r IN
      SELECT p.item_class,
             sum(coalesce(sm.total_cost, 0)) AS book_value
        FROM public.stock_movements sm
        JOIN public.products p ON p.id = sm.product_id
       WHERE sm.source_type = 'purchase_return'
         AND sm.source_id = v_id
         AND sm.movement_kind = 'ISSUE'::public.stock_movement_kind
       GROUP BY p.item_class
      HAVING sum(coalesce(sm.total_cost, 0)) <> 0
    LOOP
      v_lines := v_lines || jsonb_build_object(
        'account_code', CASE r.item_class
                          WHEN 'RAW_MATERIAL' THEN '1311'
                          WHEN 'BY_PRODUCT'   THEN '1314'
                          WHEN 'FINISHED_GOOD' THEN '1313'
                          ELSE '1315' END,
        'credit', round(r.book_value, 2),
        'memo', 'مرتجع مشتريات ' || coalesce(r.item_class, 'GOOD'));
    END LOOP;

    -- الخدمة والسلعة غير المتتبعة لا تخفضان أصل المخزون؛ اعكس مصروف الشراء
    -- بالقيمة التاريخية التي استُخدمت في ترحيل الفاتورة الأصلية.
    FOR r IN
      SELECT p.item_class,
             sum(ri.total - coalesce(ri.tax, 0)) AS expense_amount
        FROM public.purchase_return_items ri
        LEFT JOIN public.products p ON p.id = ri.product_id
       WHERE ri.return_id = v_id
         AND public.item_stock_effect(ri.product_id, 'out') <> 'STOCK_ISSUE'
       GROUP BY p.item_class
      HAVING sum(ri.total - coalesce(ri.tax, 0)) <> 0
    LOOP
      v_lines := v_lines || jsonb_build_object(
        'account_code', '5911',
        'credit', round(r.expense_amount, 2),
        'memo', 'عكس مصروف شراء ' || coalesce(r.item_class, 'GOOD'));
    END LOOP;

    IF v_tax <> 0 THEN
      v_lines := v_lines || jsonb_build_object(
        'account_code', '1316', 'credit', round(v_tax, 2),
        'memo', 'عكس ضريبة المدخلات');
    END IF;

    -- الطرف المدين: إن كان الاسترداد نقدًا/بنكًا فهو مدين نقدًا (استرِدّ فعلاً)،
    -- وإلا فهو عكس ذمة المورد (مدين على 2111).
    v_cash_acct := public.payment_method_ledger_account(_refund_method);
    IF v_cash_acct IS NOT NULL THEN
      v_lines := v_lines || jsonb_build_object(
        'account_code', v_cash_acct, 'debit', round(v_tot, 2),
        'memo', 'استرداد من المورد');
    ELSE
      v_lines := v_lines || jsonb_build_object(
        'account_code', '2111', 'debit', round(v_tot, 2),
        'memo', 'عكس ذمة المورد');
    END IF;

    v_entry := public.balance_and_post_return(
      'مرتجع مشتريات ' || v_no, CURRENT_DATE, 'purchase_return', v_id, v_lines);
  END IF;

  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, payload)
  VALUES (v_user, 'purchase_return.posted', 'purchase_return', v_id,
    jsonb_build_object(
      'return_number', v_no,
      'invoice_id', _invoice_id,
      'supplier_id', _supplier_id,
      'total', v_tot,
      'journal_entry_id', v_entry
    ));

  RETURN v_id;
END $$;

--
-- Name: create_sale(uuid, uuid, text, numeric, numeric, text, jsonb); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.create_sale(_warehouse_id uuid, _customer_id uuid, _payment_method text, _paid numeric, _discount numeric, _note text, _items jsonb) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  RETURN public.create_sale(
    _warehouse_id, _customer_id, _payment_method, _paid, _discount, _note, _items, current_date, '[]'::jsonb
  );
END;
$$;

--
-- Name: create_sale(uuid, uuid, text, numeric, numeric, text, jsonb, date); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.create_sale(_warehouse_id uuid, _customer_id uuid, _payment_method text, _paid numeric, _discount numeric, _note text, _items jsonb, _sale_date date) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  RETURN public.create_sale(
    _warehouse_id, _customer_id, _payment_method, _paid, _discount, _note, _items, _sale_date, '[]'::jsonb
  );
END;
$$;

--
-- Name: create_sale(uuid, uuid, text, numeric, numeric, text, jsonb, date, jsonb); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.create_sale(_warehouse_id uuid, _customer_id uuid, _payment_method text, _paid numeric, _discount numeric, _note text, _items jsonb, _sale_date date, _payment_splits jsonb) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_invoice_id     uuid;
  v_invoice_number text;
  v_user           uuid := auth.uid();
  v_line           record;
  v_subtotal       numeric := 0;
  v_tax_total      numeric := 0;
  v_discount       numeric := coalesce(_discount, 0);
  v_total          numeric := 0;
  v_paid           numeric := 0;
  v_outstanding    numeric := 0;
  v_price          numeric;
  v_entered_price  numeric;
  v_entered_quantity numeric;
  v_conversion_factor numeric;
  v_quantity_increment numeric;
  v_base_quantity  numeric;
  v_tax_rate       numeric;
  v_customer_balance numeric;
  v_credit_limit   numeric;
  v_line_total     numeric;
  v_line_tax       numeric;
  v_effect         text;
  v_line_type      text;
  v_sellable       boolean;
  v_status         public.invoice_status;
  v_last_item_id   uuid;
  v_available      numeric;
  v_system         boolean := false;
  v_posted_at      timestamptz;
  v_split          record;
  v_split_total    numeric := 0;
  v_distinct_methods integer := 0;
  v_recorded_method text := _payment_method;
  v_has_splits     boolean := false;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT (
    public.has_role(v_user, 'owner')
    OR public.has_role(v_user, 'manager')
    OR public.has_role(v_user, 'cashier')
  ) THEN
    RAISE EXCEPTION 'You are not permitted to post sales';
  END IF;

  IF _warehouse_id IS NULL THEN
    RAISE EXCEPTION 'Warehouse is required';
  END IF;

  IF coalesce(jsonb_typeof(_items), '') <> 'array'
     OR coalesce(jsonb_array_length(_items), 0) = 0 THEN
    RAISE EXCEPTION 'Cart is empty';
  END IF;

  IF v_discount < 0 THEN
    RAISE EXCEPTION 'Discount cannot be negative';
  END IF;

  IF coalesce(_paid, 0) < 0 THEN
    RAISE EXCEPTION 'Paid amount cannot be negative';
  END IF;

  -- ── التحقق من صحة سجلات الدفع المجزأ إن وجدت ──
  IF coalesce(jsonb_typeof(_payment_splits), 'jsonb') = 'array'
     AND coalesce(jsonb_array_length(_payment_splits), 0) > 0 THEN
    v_has_splits := true;

    FOR v_split IN
      SELECT part ->> 'method' AS method,
             coalesce((part ->> 'amount')::numeric, 0) AS amount,
             nullif(part ->> 'cashbox_id', '')::uuid AS cashbox_id,
             nullif(part ->> 'bank_account_id', '')::uuid AS bank_account_id,
             nullif(part ->> 'payment_method_id', '') AS payment_method_id,
             nullif(btrim(coalesce(part ->> 'reference', '')), '') AS reference
      FROM jsonb_array_elements(_payment_splits) AS part
    LOOP
      IF v_split.method IS NULL
         OR v_split.method NOT IN ('cash', 'card', 'bank_transfer', 'mobile_money', 'cheque') THEN
        RAISE EXCEPTION 'Unsupported split payment method: %', v_split.method;
      END IF;
      IF public.resolve_writable_payment_method(
           coalesce(v_split.payment_method_id, v_split.method), 'pos', true
         ) IS DISTINCT FROM v_split.method THEN
        RAISE EXCEPTION 'Payment method id does not match split tender %', v_split.method;
      END IF;
      IF v_split.amount <= 0 THEN
        RAISE EXCEPTION 'Every payment tender component requires a positive amount';
      END IF;
      v_split_total := v_split_total + v_split.amount;
    END LOOP;

    SELECT count(DISTINCT part ->> 'method') INTO v_distinct_methods
    FROM jsonb_array_elements(_payment_splits) AS part;

    IF v_distinct_methods <> jsonb_array_length(_payment_splits) THEN
      RAISE EXCEPTION 'A payment method may only be included once in a split';
    END IF;

    IF v_distinct_methods > 1 THEN
      v_recorded_method := 'split';
    END IF;
  ELSE
    IF _payment_method NOT IN ('cash', 'card', 'bank_transfer', 'credit', 'mobile_money', 'cheque') THEN
      RAISE EXCEPTION 'Unsupported payment method: %', _payment_method;
    END IF;
  END IF;

  -- ── التحقق من رصيد المخزون لجميع البنود ──
  FOR v_line IN
    SELECT r.o_product_id AS product_id,
           sum(public.product_quantity_in_base(
             r.o_product_id,
             r.o_quantity,
             nullif(btrim(coalesce(line ->> 'uom_id', '')), '')::uuid,
             'SALE'
           )) AS quantity
    FROM jsonb_array_elements(_items) AS line
    CROSS JOIN LATERAL public.resolve_sale_line(line) AS r
    WHERE r.o_stock_effect = 'STOCK_ISSUE'
    GROUP BY r.o_product_id
    ORDER BY r.o_product_id
  LOOP
    SELECT i.quantity INTO v_available
    FROM public.inventory i
    WHERE i.product_id = v_line.product_id
      AND i.warehouse_id = _warehouse_id
      AND i.owner_type = 'COMPANY'
      AND i.owner_id IS NULL
    FOR UPDATE;

    v_available := coalesce(v_available, 0);

    IF v_available < v_line.quantity THEN
      RAISE EXCEPTION
        'Insufficient stock for item %: available %, requested %',
        v_line.product_id, v_available, v_line.quantity
        USING ERRCODE = 'check_violation';
    END IF;
  END LOOP;

  -- ── حساب المجاميع والأسعار ──
  FOR v_line IN
    SELECT r.o_product_id    AS product_id,
           r.o_quantity      AS quantity,
           r.o_service_name  AS service_name,
           coalesce((line ->> 'unit_price')::numeric, 0) AS input_price,
           coalesce((line ->> 'tax_rate')::numeric, 0)   AS input_tax,
           nullif(btrim(coalesce(line ->> 'uom_id', '')), '')::uuid AS uom_id
    FROM jsonb_array_elements(_items) AS line
    CROSS JOIN LATERAL public.resolve_sale_line(line) AS r
  LOOP
    v_base_quantity := NULL;
    IF v_line.quantity IS NULL OR v_line.quantity <= 0 THEN
      RAISE EXCEPTION 'Every sale line requires a positive quantity';
    END IF;

    IF v_line.product_id IS NULL THEN
      IF coalesce(v_line.service_name, '') = '' THEN
        RAISE EXCEPTION 'Every service line requires a description';
      END IF;
      IF v_line.input_price < 0 OR v_line.input_tax < 0 OR v_line.input_tax > 100 THEN
        RAISE EXCEPTION 'Service line "%" has an invalid price or tax rate', v_line.service_name;
      END IF;
      v_price    := v_line.input_price;
      v_tax_rate := v_line.input_tax;
    ELSE
      SELECT p.tax_rate, p.is_sellable
        INTO v_tax_rate, v_sellable
      FROM public.products p
      WHERE p.id = v_line.product_id AND p.is_active = true
      FOR UPDATE;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Item % is not available for sale', v_line.product_id;
      END IF;

      IF v_sellable IS NOT TRUE THEN
        RAISE EXCEPTION 'Item % is not marked as sellable', v_line.product_id;
      END IF;

      v_conversion_factor := public.product_uom_factor(v_line.product_id, v_line.uom_id, 'SALE');
      v_entered_price := public.product_uom_price(v_line.product_id, v_line.uom_id, 'SALE');
      v_base_quantity := public.product_quantity_in_base(
        v_line.product_id, v_line.quantity, v_line.uom_id, 'SALE'
      );
      v_price := round(v_entered_price / v_conversion_factor, 6);

      IF v_entered_price < 0 OR v_tax_rate < 0 OR v_tax_rate > 100 THEN
        RAISE EXCEPTION 'Item % has invalid pricing or tax configuration', v_line.product_id;
      END IF;
    END IF;

    v_line_total := round(v_line.quantity * CASE WHEN v_line.product_id IS NULL THEN v_price ELSE v_entered_price END, 2);
    v_subtotal   := v_subtotal + v_line_total;
    v_tax_total  := v_tax_total + round(v_line_total * v_tax_rate / 100, 2);
  END LOOP;

  v_total := round(v_subtotal + v_tax_total - v_discount, 2);
  IF v_discount > v_subtotal + v_tax_total OR v_total < 0 THEN
    RAISE EXCEPTION 'Discount cannot exceed the invoice amount';
  END IF;

  IF _customer_id IS NOT NULL THEN
    SELECT balance, credit_limit, is_system
      INTO v_customer_balance, v_credit_limit, v_system
    FROM public.customers
    WHERE id = _customer_id AND is_active = true
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Selected customer is unavailable';
    END IF;
  END IF;

  -- مطابقة مبالغ الدفع
  v_paid := least(coalesce(_paid, 0), v_total);
  v_outstanding := round(v_total - v_paid, 2);

  IF v_has_splits THEN
    IF round(v_split_total, 2) <> round(v_paid, 2) THEN
      RAISE EXCEPTION 'Split breakdown total (%) does not match paid amount (%)',
        round(v_split_total, 2), round(v_paid, 2);
    END IF;
  END IF;

  IF v_outstanding > 0 AND _customer_id IS NULL THEN
    RAISE EXCEPTION 'A customer is required when the sale has an unpaid amount';
  END IF;

  IF v_outstanding > 0 AND v_system THEN
    RAISE EXCEPTION
      'The system cash customer cannot carry credit — select a real customer for a deferred sale'
      USING ERRCODE = 'check_violation';
  END IF;

  IF v_outstanding > 0 AND NOT public.customer_credit_limit_allows(_customer_id, v_outstanding) THEN
    RAISE EXCEPTION
      'Credit limit exceeded: current balance %, requested debt %, limit %',
      coalesce(v_customer_balance, 0), v_outstanding, coalesce(v_credit_limit, 0);
  END IF;

  v_status := 'confirmed'::public.invoice_status;
  v_invoice_number := public.next_invoice_number();
  v_posted_at := coalesce(_sale_date, current_date)::timestamp + localtime;

  -- ── إدراج رأس الفاتورة ──
  INSERT INTO public.sales_invoices (
    invoice_number, customer_id, warehouse_id, status, payment_status,
    subtotal, discount, tax, total, paid, payment_method, note, created_by,
    created_at, updated_at
  )
  VALUES (
    v_invoice_number, _customer_id, _warehouse_id, v_status,
    public.derive_payment_status(v_paid, v_total),
    v_subtotal, v_discount, v_tax_total, v_total, v_paid,
    v_recorded_method::public.payment_method, nullif(btrim(_note), ''), v_user,
    v_posted_at, now()
  )
  RETURNING id INTO v_invoice_id;

  -- ── إدراج سطور الفاتورة وحركات المخزون ──
  FOR v_line IN
    SELECT r.o_product_id   AS product_id,
           r.o_quantity     AS entered_quantity,
           CASE WHEN r.o_product_id IS NULL THEN r.o_quantity
             ELSE public.product_quantity_in_base(
               r.o_product_id,
               r.o_quantity,
               nullif(btrim(coalesce(line ->> 'uom_id', '')), '')::uuid,
               'SALE'
             )
           END AS quantity,
           r.o_stock_effect AS stock_effect,
           r.o_service_name AS service_name,
           coalesce((line ->> 'unit_price')::numeric, 0) AS input_price,
           coalesce((line ->> 'tax_rate')::numeric, 0)   AS input_tax,
           nullif(btrim(coalesce(line ->> 'uom_id', '')), '')::uuid AS uom_id,
           nullif(btrim(coalesce(line ->> 'batch_id', '')), '')::uuid AS batch_id,
           nullif(btrim(coalesce(line ->> 'batch_number', '')), '') AS batch_number
    FROM jsonb_array_elements(_items) AS line
    CROSS JOIN LATERAL public.resolve_sale_line(line) AS r
  LOOP
    IF v_line.product_id IS NULL THEN
      v_entered_quantity := v_line.entered_quantity;
      v_conversion_factor := 1;
      v_quantity_increment := NULL;
      v_entered_price := v_line.input_price;
      v_price     := v_line.input_price;
      v_tax_rate  := v_line.input_tax;
      v_line_type := 'AD_HOC_SERVICE';
      v_effect    := 'NONE';
    ELSE
      SELECT p.tax_rate
        INTO v_tax_rate
      FROM public.products p WHERE p.id = v_line.product_id;

      v_entered_quantity := v_line.entered_quantity;
      v_conversion_factor := public.product_uom_factor(v_line.product_id, v_line.uom_id, 'SALE');
      SELECT pu.quantity_increment
        INTO v_quantity_increment
        FROM public.product_uoms pu
       WHERE pu.product_id = v_line.product_id
         AND pu.unit_id = coalesce(v_line.uom_id, (SELECT coalesce(p.base_uom_id, p.unit_id)
           FROM public.products p WHERE p.id = v_line.product_id))
         AND pu.is_active;
      v_quantity_increment := coalesce(v_quantity_increment, 0.001);
      v_entered_price := public.product_uom_price(v_line.product_id, v_line.uom_id, 'SALE');
      v_price := round(v_entered_price / v_conversion_factor, 6);

      v_line_type := public.item_line_type(v_line.product_id, false);
      v_effect    := public.item_stock_effect(v_line.product_id, 'out');

      IF v_effect = 'STOCK_ISSUE' THEN
        PERFORM public.post_stock_delta(
          p_product_id => v_line.product_id,
          p_warehouse_id => _warehouse_id,
          p_signed_qty => -v_line.quantity,
          p_unit_cost => NULL,
          p_movement_kind => 'ISSUE'::public.stock_movement_kind,
          p_source_type => 'sales_invoice',
          p_source_id => v_invoice_id,
          p_note => 'POS sale',
          p_owner_type => 'COMPANY'::public.owner_type,
          p_owner_id => NULL,
          p_movement_type_legacy => 'sale'::public.movement_type
        );
      END IF;
    END IF;

    v_line_total := round(coalesce(v_entered_quantity, v_line.quantity) * v_entered_price, 2);
    v_line_tax   := round(v_line_total * v_tax_rate / 100, 2);

    INSERT INTO public.sales_invoice_items (
      invoice_id, product_id, description, quantity, unit_price, discount, tax, total,
      line_type, stock_effect, uom_id, batch_id, batch_number, base_unit_price,
      entered_quantity, base_quantity, uom_conversion_factor, entered_unit_price,
      uom_quantity_increment
    )
    VALUES (
      v_invoice_id,
      v_line.product_id,
      CASE WHEN v_line.product_id IS NULL THEN v_line.service_name ELSE NULL END,
      v_line.quantity, v_price, 0, v_line_tax, v_line_total + v_line_tax,
      v_line_type, v_effect,
      CASE WHEN v_line.product_id IS NULL THEN NULL
        ELSE coalesce(v_line.uom_id, (SELECT coalesce(p.base_uom_id, p.unit_id)
          FROM public.products p WHERE p.id = v_line.product_id)) END,
      v_line.batch_id, v_line.batch_number, CASE WHEN v_line.product_id IS NULL THEN NULL ELSE v_price END,
      CASE WHEN v_line.product_id IS NULL THEN NULL ELSE v_entered_quantity END,
      CASE WHEN v_line.product_id IS NULL THEN NULL ELSE v_line.quantity END,
      CASE WHEN v_line.product_id IS NULL THEN NULL ELSE v_conversion_factor END,
      CASE WHEN v_line.product_id IS NULL THEN NULL ELSE v_entered_price END,
      v_quantity_increment
    )
    RETURNING id INTO v_last_item_id;

    IF v_line_type = 'AD_HOC_SERVICE' THEN
      INSERT INTO public.ad_hoc_service_lines (
        invoice_id, invoice_item_id, description, quantity, unit_price,
        discount, tax, total, created_by
      )
      VALUES (
        v_invoice_id, v_last_item_id, v_line.service_name, v_line.quantity,
        v_price, 0, v_line_tax, v_line_total + v_line_tax, v_user
      );
    END IF;
  END LOOP;

  -- مزامنة تواريخ حركات المخزون مع تاريخ البيع
  PERFORM set_config('app.stock_engine', 'on', true);
  UPDATE public.stock_movements
  SET created_at = v_posted_at
  WHERE source_type = 'sales_invoice' AND source_id = v_invoice_id;
  PERFORM set_config('app.stock_engine', 'off', true);

  -- ── تحديث ذمة العميل للآجل إن وجد ──
  IF v_outstanding > 0 THEN
    UPDATE public.customers
    SET balance = round(coalesce(balance, 0) + v_outstanding, 2), updated_at = now()
    WHERE id = _customer_id;

    INSERT INTO public.customer_ledger (
      customer_id, entry_type, debit, reference_id, reference_type,
      occurred_at, created_by, source_key, note
    )
    VALUES (
      _customer_id, 'sale', v_outstanding, v_invoice_id, 'sales_invoice',
      v_posted_at, v_user, 'sale:' || v_invoice_id, 'قيد بيع آجل'
    )
    ON CONFLICT (source_key) DO NOTHING;
  END IF;

  -- ── إدراج سجلات الدفع المجزأ قبل الترحيل المحاسبي ──
  IF v_has_splits THEN
    FOR v_split IN
      SELECT part ->> 'method' AS method,
             coalesce((part ->> 'amount')::numeric, 0) AS amount,
             nullif(part ->> 'cashbox_id', '')::uuid AS cashbox_id,
             nullif(part ->> 'bank_account_id', '')::uuid AS bank_account_id,
             nullif(part ->> 'payment_method_id', '') AS payment_method_id,
             nullif(btrim(coalesce(part ->> 'reference', '')), '') AS reference
      FROM jsonb_array_elements(_payment_splits) AS part
    LOOP
      IF v_split.amount > 0 THEN
        INSERT INTO public.customer_payment_splits (
          customer_id, invoice_id, method, amount, occurred_at, created_by,
          cashbox_id, bank_account_id, payment_method_id, reference_no
        )
        VALUES (
          _customer_id,
          v_invoice_id,
          v_split.method::public.payment_method,
          round(v_split.amount, 2),
          v_posted_at,
          v_user,
          v_split.cashbox_id,
          v_split.bank_account_id,
          coalesce(v_split.payment_method_id, v_split.method),
          v_split.reference
        );
      END IF;
    END LOOP;
  END IF;

  -- ── سجل التدقيق ──
  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, payload)
  VALUES (v_user, 'sale.posted', 'sales_invoice', v_invoice_id,
    jsonb_build_object(
      'invoice_number', v_invoice_number,
      'warehouse_id', _warehouse_id,
      'customer_id', _customer_id,
      'payment_method', v_recorded_method,
      'total', v_total,
      'paid', v_paid,
      'outstanding', v_outstanding,
      'has_splits', v_has_splits,
      'split_count', CASE WHEN v_has_splits THEN jsonb_array_length(_payment_splits) ELSE 0 END,
      'line_count', jsonb_array_length(_items)
    ));

  -- ── الترحيل المحاسبي المتوازن التلقائي ──
  PERFORM set_config('app.payment_split_internal_post', 'on', true);
  PERFORM public.post_sales_invoice(v_invoice_id);
  PERFORM set_config('app.payment_split_internal_post', 'off', true);

  RETURN v_invoice_id;
END;
$$;

--
-- Name: create_sales_return(uuid, uuid, uuid, text, text, jsonb); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.create_sales_return(_invoice_id uuid, _warehouse_id uuid, _customer_id uuid, _refund_method text, _note text, _items jsonb) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_id        uuid;
  v_no        text;
  v_user      uuid := auth.uid();
  v_item      jsonb;
  v_sub       numeric := 0;
  v_tax       numeric := 0;
  v_tot       numeric := 0;
  v_qty       numeric;
  v_price     numeric;
  v_lt        numeric;
  v_ltax      numeric;
  v_p         uuid;
  v_effect    text;
  v_type      text;
  v_entry     uuid;
  v_lines     jsonb := '[]'::jsonb;
  v_cash_acct text;
  r           record;
  v_debits    numeric := 0;
  v_credits   numeric := 0;
  v_inv       record;
  v_returned  numeric;
  v_uom_id    uuid;
  v_entered_qty numeric;
  v_factor    numeric;
  v_quantity_increment numeric;
  v_entered_price numeric;
  v_invoice_item_id uuid;
  v_discount_factor numeric := 1;
  -- جديد: توزيع قيمة المرتجع بين الذمة والاسترداد النقدي
  v_credit_applied numeric := 0;
  v_cash_refund    numeric := 0;
  v_invoice_outstanding numeric := 0;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT public.is_staff(v_user) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  IF _invoice_id IS NULL THEN
    RAISE EXCEPTION 'A sales return must be linked to its original invoice';
  END IF;
  IF coalesce(jsonb_array_length(_items), 0) = 0 THEN
    RAISE EXCEPTION 'No items';
  END IF;
  IF _refund_method IS NULL
     OR NOT (_refund_method::public.payment_method = ANY (ARRAY['cash','card','bank_transfer','mobile_money','split','credit']::public.payment_method[])) THEN
    RAISE EXCEPTION 'A return refund method must be one of: cash, card, bank_transfer, mobile_money, split, credit';
  END IF;

  -- ── الفاتورة الأصلية: مقفولة، مؤكدة، وبطرفيها ───────────────────────────
  SELECT * INTO v_inv FROM public.sales_invoices WHERE id = _invoice_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Original invoice % does not exist', _invoice_id;
  END IF;
  IF v_inv.status IN ('draft', 'cancelled') THEN
    RAISE EXCEPTION 'Invoice % is % - a return needs a confirmed sale', v_inv.invoice_number, v_inv.status;
  END IF;
  IF _customer_id IS NOT NULL AND v_inv.customer_id IS DISTINCT FROM _customer_id THEN
    RAISE EXCEPTION 'The return customer does not match the invoice customer';
  END IF;
  IF _warehouse_id IS NOT NULL AND v_inv.warehouse_id IS DISTINCT FROM _warehouse_id THEN
    RAISE EXCEPTION 'A return must go back to the invoice warehouse (%)', v_inv.warehouse_id;
  END IF;
  IF coalesce(v_inv.subtotal, 0) > 0 AND coalesce(v_inv.discount, 0) > 0 THEN
    v_discount_factor := 1 - least(1, v_inv.discount / v_inv.subtotal);
  END IF;

  -- A return identifies the exact source line and reuses its historical UoM
  -- factor and price. Current product settings must not reinterpret an old sale.
  IF EXISTS (
    SELECT 1
      FROM jsonb_array_elements(_items) AS src(item)
     WHERE nullif(btrim(coalesce(src.item ->> 'invoice_item_id', '')), '') IS NULL
        OR coalesce((src.item ->> 'quantity')::numeric, 0) <= 0
        OR NOT EXISTS (
          SELECT 1
            FROM public.sales_invoice_items sit
           WHERE sit.id = nullif(btrim(coalesce(src.item ->> 'invoice_item_id', '')), '')::uuid
             AND sit.invoice_id = _invoice_id
             AND sit.product_id = nullif(btrim(coalesce(src.item ->> 'product_id', '')), '')::uuid
             AND sit.uom_id IS NOT DISTINCT FROM nullif(btrim(coalesce(src.item ->> 'uom_id', '')), '')::uuid
             AND mod((src.item ->> 'quantity')::numeric, coalesce(sit.uom_quantity_increment, 0.001)) = 0
        )
  ) THEN
    RAISE EXCEPTION 'Every sales return line must match an original invoice line and its unit'
      USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (
    SELECT 1
      FROM jsonb_array_elements(_items) AS src(item)
     GROUP BY nullif(btrim(coalesce(src.item ->> 'invoice_item_id', '')), '')::uuid
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Combine each original invoice line into one return line';
  END IF;

  FOR r IN
    SELECT sit.id AS invoice_item_id, sit.product_id,
           sum((src.item ->> 'quantity')::numeric) AS entered_quantity,
           sum((src.item ->> 'quantity')::numeric) * coalesce(sit.uom_conversion_factor, 1) AS quantity,
           coalesce(sit.uom_conversion_factor, 1) AS factor,
           coalesce(sit.uom_quantity_increment, 0.001) AS quantity_increment,
           coalesce(sit.base_unit_price, sit.unit_price) AS unit_price,
           coalesce(sit.tax / nullif(sit.quantity, 0), 0) AS unit_tax,
           sit.quantity AS sold_quantity
      FROM jsonb_array_elements(_items) AS src(item)
      JOIN public.sales_invoice_items sit
        ON sit.id = nullif(btrim(coalesce(src.item ->> 'invoice_item_id', '')), '')::uuid
       AND sit.invoice_id = _invoice_id
     GROUP BY sit.id, sit.product_id, sit.uom_conversion_factor, sit.uom_quantity_increment,
              sit.base_unit_price, sit.unit_price, sit.tax, sit.quantity
  LOOP
    IF r.quantity <> round(r.quantity, 3) THEN
      RAISE EXCEPTION 'Returned base quantity exceeds the inventory precision for line %', r.invoice_item_id
        USING ERRCODE = 'check_violation';
    END IF;
    SELECT coalesce(sum(ri.quantity), 0) INTO v_returned
      FROM public.sales_return_items ri
      JOIN public.sales_returns sr ON sr.id = ri.return_id
     WHERE sr.invoice_id = _invoice_id AND ri.product_id = r.product_id
       AND (ri.invoice_item_id = r.invoice_item_id OR ri.invoice_item_id IS NULL);
    IF v_returned + r.quantity > r.sold_quantity THEN
      RAISE EXCEPTION 'Return exceeds the remaining quantity on invoice line %', r.invoice_item_id
        USING ERRCODE = 'check_violation';
    END IF;
    v_sub := v_sub + round(coalesce(r.unit_price, 0) * r.quantity * v_discount_factor, 2);
    v_tax := v_tax + round(coalesce(r.unit_tax, 0) * r.quantity, 2);
  END LOOP;

  -- The returned subtotal uses the original invoice discount allocation.
  v_tot := round(v_sub + v_tax, 2);
  IF v_tot <= 0 THEN
    RAISE EXCEPTION 'The return value must be greater than zero';
  END IF;

  v_no := public.next_sales_return_number();

  INSERT INTO public.sales_returns (
    return_number, invoice_id, customer_id, warehouse_id,
    subtotal, tax, total, refund_method, note, created_by
  )
  VALUES (
    v_no, _invoice_id, coalesce(_customer_id, v_inv.customer_id), v_inv.warehouse_id,
    round(v_sub, 2), round(v_tax, 2), v_tot, _refund_method::public.payment_method,
    nullif(btrim(_note), ''), v_user
  )
  RETURNING id INTO v_id;

  FOR r IN
    SELECT sit.id AS invoice_item_id, sit.product_id,
           sum((src.item ->> 'quantity')::numeric) AS entered_quantity,
           sum((src.item ->> 'quantity')::numeric) * coalesce(sit.uom_conversion_factor, 1) AS quantity,
           coalesce(sit.uom_conversion_factor, 1) AS factor,
           sit.uom_id AS uom_id,
           coalesce(sit.uom_quantity_increment, 0.001) AS quantity_increment,
           coalesce(sit.base_unit_price, sit.unit_price) AS unit_price,
           coalesce(sit.entered_unit_price,
             coalesce(sit.base_unit_price, sit.unit_price) * coalesce(sit.uom_conversion_factor, 1)) AS entered_unit_price,
           coalesce(sit.tax / nullif(sit.quantity, 0), 0) AS unit_tax
      FROM jsonb_array_elements(_items) AS src(item)
      JOIN public.sales_invoice_items sit
        ON sit.id = nullif(btrim(coalesce(src.item ->> 'invoice_item_id', '')), '')::uuid
       AND sit.invoice_id = _invoice_id
     GROUP BY sit.id, sit.product_id, sit.uom_conversion_factor, sit.uom_quantity_increment, sit.uom_id,
              sit.unit_price, sit.base_unit_price,
              sit.entered_unit_price, sit.tax, sit.quantity
  LOOP
    v_invoice_item_id := r.invoice_item_id;
    v_p   := r.product_id;
    v_qty := r.quantity;
    v_uom_id := r.uom_id;
    v_entered_qty := r.entered_quantity;
    v_factor := r.factor;
    v_price := round(coalesce(r.unit_price, 0), 6);
    v_entered_price := round(coalesce(r.entered_unit_price, 0), 4);
    v_lt    := round(v_qty * v_price * v_discount_factor, 2);
    v_ltax  := round(coalesce(r.unit_tax, 0) * v_qty, 2);

    v_type   := public.item_line_type(v_p, false);
    v_effect := public.item_stock_effect(v_p, 'in');

    INSERT INTO public.sales_return_items (
      return_id, product_id, quantity, unit_price, tax, total, line_type, invoice_item_id,
      uom_id, entered_quantity, base_quantity, uom_conversion_factor, entered_unit_price,
      uom_quantity_increment
    )
    VALUES (
      v_id, v_p, v_qty, v_price, v_ltax, v_lt + v_ltax, v_type, v_invoice_item_id,
      v_uom_id,
      v_entered_qty, v_qty, v_factor, v_entered_price, r.quantity_increment
    );

    IF v_effect = 'STOCK_RECEIPT' THEN
      PERFORM public.post_stock_delta(
        p_product_id => v_p,
        p_warehouse_id => v_inv.warehouse_id,
        p_signed_qty => v_qty,
        p_unit_cost => NULL,   -- التقييم بمتوسط الطبقة (P0-3)
        p_movement_kind => 'RECEIPT'::public.stock_movement_kind,
        p_source_type => 'sales_return',
        p_source_id => v_id,
        p_note => 'Sales return ' || v_no,
        p_owner_type => 'COMPANY'::public.owner_type,
        p_owner_id => NULL,
        p_movement_type_legacy => 'sale_return'::public.movement_type
      );
    END IF;
  END LOOP;

  -- ── الأثر على العميل: مقدار واحد يخصمه الدفتر والأستاذ معًا ───────────────
  -- تُقفل ذمة الفاتورة قبل قراءتها: مرتجعتان متزامنتان لا تتجاوزان ذمتها.
  SELECT round(greatest(coalesce(total, 0) - coalesce(paid, 0), 0), 2)
    INTO v_invoice_outstanding
    FROM public.sales_invoices
   WHERE id = _invoice_id
   FOR UPDATE;

  IF v_inv.customer_id IS NOT NULL THEN
    -- قفل صف العميل ليتسلسل هذا المرتجع مع كل مرتجع/تحصيل آخر على نفس العميل.
    PERFORM public.customer_balance_lock(v_inv.customer_id);

    -- ذمة الفاتورة لا تنقص بأكثر من قيمتها، والباقي يُردّ نقدًا.
    v_credit_applied := round(least(v_tot, v_invoice_outstanding), 2);
    v_cash_refund    := round(v_tot - v_credit_applied, 2);

    IF v_credit_applied > 0 THEN
      UPDATE public.sales_invoices
         SET paid = round(coalesce(paid, 0) + v_credit_applied, 2),
             status = CASE
               WHEN round(coalesce(total, 0) - (round(coalesce(paid, 0) + v_credit_applied, 2)), 2) <= 0.005
                 THEN 'returned'::public.invoice_status
               ELSE 'confirmed'::public.invoice_status END,
             payment_status = public.derive_payment_status(
               round(coalesce(paid, 0) + v_credit_applied, 2), total),
             updated_at = now()
       WHERE id = _invoice_id;
    ELSE
      -- لا يوجد ما يُخصم من الذمة (فاتورة مسدَّدة). نحدّث حالة الفاتورة وحدها.
      UPDATE public.sales_invoices
         SET status = CASE
               WHEN round(coalesce(total, 0) - coalesce(paid, 0), 2) <= 0.005
                 THEN 'returned'::public.invoice_status
               ELSE status END,
             payment_status = public.derive_payment_status(paid, total),
             updated_at = now()
       WHERE id = _invoice_id;
    END IF;

    IF v_credit_applied > 0 THEN
      INSERT INTO public.customer_ledger (
        customer_id, entry_type, credit, reference_id, reference_type,
        occurred_at, created_by, source_key, note
      )
      VALUES (
        v_inv.customer_id, 'return', v_credit_applied, v_id, 'sales_return',
        now(), v_user, 'return:' || v_id,
        'مرتجع مبيعات — خصم من الذمة'
      );
    END IF;

    IF _refund_method = 'credit' THEN
      -- الاسترداد على الحساب: يبقى المبلغ ذمة دائنة للعميل (لا نقد يخرج).
      IF v_cash_refund > 0 THEN
        INSERT INTO public.customer_ledger (
          customer_id, entry_type, credit, reference_id, reference_type,
          occurred_at, created_by, source_key, note
        )
        VALUES (
          v_inv.customer_id, 'return', v_cash_refund, v_id, 'sales_return_credit',
          now(), v_user, 'return-credit:' || v_id,
          'مرتجع مبيعات — رصيد دائن للعميل'
        );
      END IF;
    ELSIF v_cash_refund > 0 THEN
      -- استرداد نقدي: المال يخرج من الصندوق/البنك، فلا يبقى منه أثر على الذمة.
      -- ⚠️ لا يُسجَّل هنا سطر في دفتر العميل:
      --    • سطر دائن يجعل الدفتر يخصم مبلغًا أعاده العميل نقدًا ← رصيد دائن وهمي.
      --    • سطر مدين يُنشئ حركة مصطنعة تُعادل الدائن وتُخفي النقد ← مصالحة صورية.
      -- الأثر النقدي كامل في القيد المحاسبي (credit على حساب الصندوق/البنك).
      NULL;
    END IF;

    PERFORM public.recalculate_customer_balance(
      v_inv.customer_id, 'مرتجع مبيعات ' || v_no, 'document_repost');
  END IF;

  -- ── القيد: يعكس إيراد البيع وضريبته وCOGS ─────────────────────────────────
  FOR r IN
    SELECT coalesce(p.item_class::text, 'UNCLASSIFIED') AS bucket,
           sum(ri.total - coalesce(ri.tax, 0)) AS net_amount
      FROM public.sales_return_items ri
      LEFT JOIN public.products p ON p.id = ri.product_id
     WHERE ri.return_id = v_id
     GROUP BY coalesce(p.item_class::text, 'UNCLASSIFIED')
    HAVING sum(ri.total - coalesce(ri.tax, 0)) <> 0
  LOOP
    v_lines := v_lines || jsonb_build_object(
      'account_code', CASE r.bucket
                        WHEN 'BY_PRODUCT' THEN '4211'
                        WHEN 'SERVICE'    THEN '4311'
                        ELSE '4111' END,
      'debit', round(r.net_amount, 2),
      'memo', 'مرتجع إيراد ' || r.bucket);
  END LOOP;

  IF v_tax <> 0 THEN
    v_lines := v_lines || jsonb_build_object(
      'account_code', '2311', 'debit', round(v_tax, 2),
      'memo', 'عكس ضريبة القيمة المضافة');
  END IF;

  -- معالجة الطرف الدائن للقيد: الذمة أو الصندوق بحسب طريقة الاسترداد
  IF _refund_method = 'credit' THEN
    v_lines := v_lines || jsonb_build_object(
      'account_code', '1211', 'credit', v_tot,
      'partner_type', 'customer', 'partner_id', v_inv.customer_id,
      'memo', 'عكس ذمم مبيعات — مرتجع آجل');
  ELSE
    IF v_credit_applied > 0 THEN
      v_lines := v_lines || jsonb_build_object(
        'account_code', '1211', 'credit', v_credit_applied,
        'partner_type', 'customer', 'partner_id', v_inv.customer_id,
        'memo', 'عكس ذم العميل');
    END IF;

    IF v_cash_refund > 0 THEN
      v_cash_acct := public.payment_method_ledger_account(_refund_method::text);
      IF v_cash_acct IS NULL THEN
        RAISE EXCEPTION
          'No ledger account could be resolved for refund tender % — record the refund through the treasury',
          _refund_method;
      END IF;
      v_lines := v_lines || jsonb_build_object(
        'account_code', v_cash_acct, 'credit', v_cash_refund,
        'memo', 'استرداد نقدي للعميل');
    END IF;
  END IF;

  -- عكس COGS وقيمة المخزون مباشرة من حركات المرتجع، بلا ربط مضاعف بأسطر الصنف.
  FOR r IN
    SELECT p.item_class,
           sum(coalesce(sm.total_cost, 0)) AS cost
      FROM public.stock_movements sm
      JOIN public.products p ON p.id = sm.product_id
     WHERE sm.source_type = 'sales_return'
       AND sm.source_id = v_id
       AND sm.warehouse_id = v_inv.warehouse_id
       AND sm.movement_kind = 'RECEIPT'::public.stock_movement_kind
     GROUP BY p.item_class
    HAVING sum(coalesce(sm.total_cost, 0)) <> 0
  LOOP
    IF r.cost IS NULL OR r.cost = 0 THEN
      CONTINUE;
    END IF;
    v_lines := v_lines || jsonb_build_object(
      'account_code', CASE r.item_class
                        WHEN 'RAW_MATERIAL' THEN '1311'
                        WHEN 'BY_PRODUCT'   THEN '1314'
                        ELSE '1313' END,
      'debit', round(r.cost, 2),
      'memo', 'مرتجع مخزون ' || r.item_class);
    v_lines := v_lines || jsonb_build_object(
      'account_code', '5111', 'credit', round(r.cost, 2),
      'memo', 'عكس تكلفة البضاعة المباعة');
  END LOOP;

  SELECT coalesce(sum((ln->>'debit')::numeric), 0),
         coalesce(sum((ln->>'credit')::numeric), 0)
    INTO v_debits, v_credits
    FROM jsonb_array_elements(v_lines) AS ln;

  IF v_debits > 0 OR v_credits > 0 THEN
    v_entry := public.balance_and_post_return(
      p_memo => 'مرتجع مبيعات ' || v_no,
      p_date => CURRENT_DATE,
      p_source_type => 'sales_return',
      p_source_id => v_id,
      p_lines => v_lines);
  END IF;

  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, payload)
  VALUES (v_user, 'sales_return.posted', 'sales_return', v_id,
    jsonb_build_object(
      'return_number', v_no,
      'invoice_id', _invoice_id,
      'customer_id', v_inv.customer_id,
      'total', v_tot,
      'customer_credit', v_credit_applied,
      'cash_refund', v_cash_refund,
      'journal_entry_id', v_entry
    ));

  RETURN v_id;
END $$;

--
-- Name: create_stock_transfer(uuid, uuid, text, jsonb); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.create_stock_transfer(_from uuid, _to uuid, _note text, _items jsonb) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_id     uuid;
  v_no     text;
  v_user   uuid := auth.uid();
  v_item   jsonb;
  v_p      uuid;
  v_qty    numeric;
  v_stock  numeric;
  v_nature public.item_nature;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT public.is_staff(v_user) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  IF _from = _to THEN
    RAISE EXCEPTION 'Source and destination must differ';
  END IF;
  IF coalesce(jsonb_array_length(_items), 0) = 0 THEN
    RAISE EXCEPTION 'No items';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(_items) LOOP
    v_p   := (v_item ->> 'product_id')::uuid;
    v_qty := (v_item ->> 'quantity')::numeric;

    IF v_qty IS NULL OR v_qty <= 0 THEN
      RAISE EXCEPTION 'Invalid transfer quantity';
    END IF;

    SELECT p.item_nature INTO v_nature FROM public.products p WHERE p.id = v_p;
    IF v_nature = 'SERVICE' THEN
      RAISE EXCEPTION 'Item % is a SERVICE and cannot be transferred', v_p;
    END IF;
    IF public.item_effective_policy(v_p) <> 'TRACKED' THEN
      RAISE EXCEPTION 'Item % is not a tracked item and cannot be transferred between warehouses', v_p;
    END IF;

    SELECT i.quantity INTO v_stock
    FROM public.inventory i
    WHERE i.product_id = v_p
      AND i.warehouse_id = _from
      AND i.owner_type = 'COMPANY'
      AND i.owner_id IS NULL;

    IF coalesce(v_stock, 0) < v_qty THEN
      RAISE EXCEPTION 'Insufficient stock for item %', v_p;
    END IF;
  END LOOP;

  v_no := public.next_transfer_number();

  INSERT INTO public.stock_transfers (transfer_number, from_warehouse_id, to_warehouse_id, note, created_by)
  VALUES (v_no, _from, _to, nullif(btrim(_note), ''), v_user)
  RETURNING id INTO v_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(_items) LOOP
    v_p   := (v_item ->> 'product_id')::uuid;
    v_qty := (v_item ->> 'quantity')::numeric;

    INSERT INTO public.stock_transfer_items (transfer_id, product_id, quantity)
    VALUES (v_id, v_p, v_qty);

    PERFORM public.post_stock_delta(
      v_p, _from, -v_qty, NULL,
      'TRANSFER_OUT'::public.stock_movement_kind, 'stock_transfer', v_id,
      'Transfer out', 'COMPANY'::public.owner_type, NULL,
      'transfer_out'::public.movement_type
    );

    PERFORM public.post_stock_delta(
      v_p, _to, v_qty, NULL,
      'TRANSFER_IN'::public.stock_movement_kind, 'stock_transfer', v_id,
      'Transfer in', 'COMPANY'::public.owner_type, NULL,
      'transfer_in'::public.movement_type
    );
  END LOOP;

  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, payload)
  VALUES (v_user, 'stock_transfer.posted', 'stock_transfer', v_id,
    jsonb_build_object(
      'transfer_number', v_no,
      'from_warehouse_id', _from,
      'to_warehouse_id', _to,
      'line_count', jsonb_array_length(_items)
    ));

  RETURN v_id;
END $$;

--
-- Name: custody_adjustment(uuid, uuid, uuid, numeric, numeric, text); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.custody_adjustment(_customer_id uuid, _warehouse_id uuid, _item_id uuid, _bags_delta numeric, _kg_delta numeric, _reason text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_user uuid := auth.uid();
  v_id uuid;
  v_doc text;
  v_balance_bags numeric;
  v_balance_kg numeric;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT public.can_operate_milling() THEN
    RAISE EXCEPTION 'You are not permitted to record custody adjustments';
  END IF;
  IF nullif(btrim(coalesce(_reason, '')), '') IS NULL THEN
    RAISE EXCEPTION 'A reason is required for a custody adjustment';
  END IF;
  IF coalesce(_bags_delta, 0) = 0 AND coalesce(_kg_delta, 0) = 0 THEN
    RAISE EXCEPTION 'An adjustment needs a non-zero bags or kg change';
  END IF;

  SELECT * FROM public.custody_balance(_customer_id, _warehouse_id, _item_id)
    INTO v_balance_bags, v_balance_kg;

  IF coalesce(_bags_delta, 0) < 0 AND abs(_bags_delta) > v_balance_bags THEN
    RAISE EXCEPTION 'Bags balance (%) cannot go below zero', v_balance_bags;
  END IF;
  IF coalesce(_kg_delta, 0) < 0 AND abs(_kg_delta) > v_balance_kg THEN
    RAISE EXCEPTION 'Kg balance (%) cannot go below zero', v_balance_kg;
  END IF;

  v_doc := 'CA-' || to_char(now(), 'YYYYMM') || '-' || lpad(nextval('public.milling_service_seq')::text, 4, '0');

  INSERT INTO public.custody_ledger
    (customer_id, warehouse_id, entry_type, item_id, doc_number,
     bags_in, bags_out, kg_in, kg_out,
     notes, created_by)
  VALUES
    (_customer_id, _warehouse_id, 'ADJUSTMENT', _item_id, v_doc,
     CASE WHEN coalesce(_bags_delta, 0) > 0 THEN _bags_delta ELSE 0 END,
     CASE WHEN coalesce(_bags_delta, 0) < 0 THEN abs(_bags_delta) ELSE 0 END,
     CASE WHEN coalesce(_kg_delta, 0) > 0 THEN _kg_delta ELSE 0 END,
     CASE WHEN coalesce(_kg_delta, 0) < 0 THEN abs(_kg_delta) ELSE 0 END,
     'سبب التعديل: ' || btrim(_reason), v_user)
  RETURNING id INTO v_id;

  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, payload)
  VALUES (v_user, 'custody.adjustment', 'custody_ledger', v_id,
    jsonb_build_object(
      'doc_number', v_doc,
      'bags_delta', coalesce(_bags_delta, 0),
      'kg_delta', coalesce(_kg_delta, 0),
      'reason', btrim(_reason),
      'stock_impact', 'NONE — customer custody'
    ));

  RETURN v_id;
END $$;

--
-- Name: custody_delivery(uuid, uuid, jsonb, text); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.custody_delivery(_customer_id uuid, _warehouse_id uuid, _lines jsonb, _notes text) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_user uuid := auth.uid();
  v_doc text;
  v_balance_bags numeric;
  v_balance_kg numeric;
  v_batch_bags numeric;
  v_batch_kg numeric;
  r record;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT public.can_operate_milling() THEN
    RAISE EXCEPTION 'You are not permitted to record custody deliveries';
  END IF;
  IF _customer_id IS NULL OR _warehouse_id IS NULL THEN
    RAISE EXCEPTION 'Customer and warehouse are required';
  END IF;
  IF _lines IS NULL OR jsonb_typeof(_lines) <> 'array' OR jsonb_array_length(_lines) = 0 THEN
    RAISE EXCEPTION 'At least one delivery line is required';
  END IF;

  -- تحقق مسبق لكل صنف: الرصيد بعد الدفعة كاملة ≥ 0.
  FOR r IN SELECT * FROM jsonb_to_recordset(_lines)
             AS l(item_id uuid, bags numeric, kg numeric)
  LOOP
    IF r.item_id IS NULL THEN
      RAISE EXCEPTION 'Every delivery line needs an item';
    END IF;
    IF coalesce(r.bags, 0) <= 0 AND coalesce(r.kg, 0) <= 0 THEN
      RAISE EXCEPTION 'Every delivery line needs bags or a positive weight';
    END IF;
    IF coalesce(r.bags, 0) < 0 OR coalesce(r.kg, 0) < 0 THEN
      RAISE EXCEPTION 'Delivery quantities cannot be negative';
    END IF;

    SELECT * FROM public.custody_balance(_customer_id, _warehouse_id, r.item_id)
      INTO v_balance_bags, v_balance_kg;

    SELECT coalesce(sum(bags), 0), coalesce(sum(kg), 0)
      INTO v_batch_bags, v_batch_kg
    FROM jsonb_to_recordset(_lines) AS l2(item_id uuid, bags numeric, kg numeric)
    WHERE l2.item_id = r.item_id;

    IF coalesce(r.bags, 0) + (v_batch_bags - coalesce(r.bags, 0)) > v_balance_bags
       OR coalesce(r.bags, 0) > v_balance_bags THEN
      RAISE EXCEPTION 'Bags balance (%) for this item is less than the delivery (%)',
        v_balance_bags, v_batch_bags;
    END IF;
    IF coalesce(r.kg, 0) + (v_batch_kg - coalesce(r.kg, 0)) > v_balance_kg
       OR coalesce(r.kg, 0) > v_balance_kg THEN
      RAISE EXCEPTION 'Kg balance (%) for this item is less than the delivery (%)',
        v_balance_kg, v_batch_kg;
    END IF;
  END LOOP;

  v_doc := 'CD-' || to_char(now(), 'YYYYMM') || '-' || lpad(nextval('public.milling_delivery_seq')::text, 4, '0');

  FOR r IN SELECT * FROM jsonb_to_recordset(_lines)
             AS l(item_id uuid, bags numeric, kg numeric)
  LOOP
    INSERT INTO public.custody_ledger
      (customer_id, warehouse_id, entry_type, item_id, doc_number,
       bags_out, kg_out, notes, created_by)
    VALUES
      (_customer_id, _warehouse_id, 'DELIVERY', r.item_id, v_doc,
       coalesce(r.bags, 0), coalesce(r.kg, 0), _notes, v_user);
  END LOOP;

  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, payload)
  VALUES (v_user, 'custody.delivery', 'custody_ledger', _customer_id,
    jsonb_build_object(
      'doc_number', v_doc,
      'lines', _lines,
      'stock_impact', 'NONE — customer custody'
    ));

  RETURN v_doc;
END $$;

--
-- Name: custody_grain_items(); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.custody_grain_items() RETURNS TABLE(id uuid, sku text, name text, name_ar text, item_class public.item_class, sale_price numeric, cost_price numeric, package_weight_kg numeric)
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT p.id, p.sku, p.name, p.name_ar, p.item_class, p.sale_price, p.cost_price, p.package_weight_kg
  FROM public.products p
  WHERE p.item_class = 'RAW_MATERIAL' AND p.is_active AND p.is_custody_item
  ORDER BY p.name_ar NULLS LAST, p.name;
$$;

--
-- Name: custody_intake(uuid, uuid, uuid, numeric, numeric, text); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.custody_intake(_customer_id uuid, _warehouse_id uuid, _item_id uuid, _bags numeric, _kg numeric, _notes text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_user uuid := auth.uid();
  v_id uuid;
  v_doc text;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT public.can_operate_milling() THEN
    RAISE EXCEPTION 'You are not permitted to record custody intakes';
  END IF;
  IF _customer_id IS NULL OR _warehouse_id IS NULL OR _item_id IS NULL THEN
    RAISE EXCEPTION 'Customer, warehouse and item are required';
  END IF;
  IF coalesce(_bags, 0) <= 0 AND coalesce(_kg, 0) <= 0 THEN
    RAISE EXCEPTION 'Record at least one bag or a positive weight';
  END IF;
  IF coalesce(_bags, 0) < 0 OR coalesce(_kg, 0) < 0 THEN
    RAISE EXCEPTION 'Quantities cannot be negative';
  END IF;

  -- صنف الاستلام حبوب خام فقط — من القاعدة لا من الواجهة.
  IF NOT EXISTS (
    SELECT 1 FROM public.products
    WHERE id = _item_id AND item_class = 'RAW_MATERIAL' AND is_active
  ) THEN
    RAISE EXCEPTION 'Intake item must be an active RAW_MATERIAL grain';
  END IF;

  v_doc := 'CI-' || to_char(now(), 'YYYYMM') || '-' || lpad(nextval('public.milling_intake_seq')::text, 4, '0');

  INSERT INTO public.custody_ledger
    (customer_id, warehouse_id, entry_type, item_id, doc_number,
     bags_in, kg_in, notes, created_by)
  VALUES
    (_customer_id, _warehouse_id, 'INTAKE', _item_id, v_doc,
     coalesce(_bags, 0), coalesce(_kg, 0), _notes, v_user)
  RETURNING id INTO v_id;

  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, payload)
  VALUES (v_user, 'custody.intake', 'custody_ledger', v_id,
    jsonb_build_object(
      'doc_number', v_doc,
      'customer_id', _customer_id,
      'item_id', _item_id,
      'bags', coalesce(_bags, 0),
      'kg', coalesce(_kg, 0),
      'stock_impact', 'NONE — customer custody'
    ));

  RETURN v_id;
END $$;

--
-- Name: custody_intake_multi(uuid, uuid, jsonb, text); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.custody_intake_multi(_customer_id uuid, _warehouse_id uuid, _lines jsonb, _notes text) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_user uuid := auth.uid();
  v_doc text;
  r record;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT public.can_operate_milling() THEN
    RAISE EXCEPTION 'You are not permitted to record custody intakes';
  END IF;
  IF _customer_id IS NULL OR _warehouse_id IS NULL THEN
    RAISE EXCEPTION 'Customer and warehouse are required';
  END IF;
  IF _lines IS NULL OR jsonb_typeof(_lines) <> 'array' OR jsonb_array_length(_lines) = 0 THEN
    RAISE EXCEPTION 'At least one intake line is required';
  END IF;

  FOR r IN SELECT * FROM jsonb_to_recordset(_lines) AS l(item_id uuid, bags numeric, kg numeric)
  LOOP
    IF r.item_id IS NULL THEN
      RAISE EXCEPTION 'Every intake line needs an item';
    END IF;
    IF coalesce(r.bags, 0) <= 0 AND coalesce(r.kg, 0) <= 0 THEN
      RAISE EXCEPTION 'Every intake line needs bags or a positive weight';
    END IF;
    IF coalesce(r.bags, 0) < 0 OR coalesce(r.kg, 0) < 0 THEN
      RAISE EXCEPTION 'Quantities cannot be negative';
    END IF;
    -- صنف الاستلام حبوب خام فقط — منتجات الأمانات (is_custody_item).
    IF NOT EXISTS (
      SELECT 1 FROM public.products
      WHERE id = r.item_id AND item_class = 'RAW_MATERIAL' AND is_active AND is_custody_item
    ) THEN
      RAISE EXCEPTION 'Intake items must be active custody grain products (is_custody_item)';
    END IF;
  END LOOP;

  v_doc := 'CI-' || to_char(now(), 'YYYYMM') || '-' || lpad(nextval('public.milling_intake_seq')::text, 4, '0');

  FOR r IN SELECT * FROM jsonb_to_recordset(_lines) AS l(item_id uuid, bags numeric, kg numeric)
  LOOP
    INSERT INTO public.custody_ledger
      (customer_id, warehouse_id, entry_type, item_id, doc_number,
       bags_in, kg_in, notes, created_by)
    VALUES
      (_customer_id, _warehouse_id, 'INTAKE', r.item_id, v_doc,
       coalesce(r.bags, 0), coalesce(r.kg, 0), _notes, v_user);
  END LOOP;

  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, payload)
  VALUES (v_user, 'custody.intake', 'custody_ledger', _customer_id,
    jsonb_build_object(
      'doc_number', v_doc,
      'customer_id', _customer_id,
      'lines', _lines,
      'stock_impact', 'NONE — customer custody'
    ));

  RETURN v_doc;
END $$;

--
-- Name: custody_link_invoice(uuid, uuid); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.custody_link_invoice(_custody_entry_id uuid, _invoice_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_user uuid := auth.uid();
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT public.can_operate_milling() THEN
    RAISE EXCEPTION 'You are not permitted to link custody invoices';
  END IF;
  IF _custody_entry_id IS NULL OR _invoice_id IS NULL THEN
    RAISE EXCEPTION 'Custody entry and invoice are required';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.sales_invoices WHERE id = _invoice_id) THEN
    RAISE EXCEPTION 'Invoice does not exist';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.custody_ledger
    WHERE service_invoice_id = _invoice_id AND id <> _custody_entry_id
  ) THEN
    RAISE EXCEPTION 'This invoice is already linked to another custody entry';
  END IF;

  UPDATE public.custody_ledger
     SET service_invoice_id = _invoice_id
   WHERE id = _custody_entry_id;

  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, payload)
  VALUES (v_user, 'custody.invoice_linked', 'custody_ledger', _custody_entry_id,
    jsonb_build_object('invoice_id', _invoice_id, 'stock_impact', 'NONE'));
END $$;

--
-- Name: custody_milling(uuid, uuid, uuid, numeric, numeric, jsonb, text); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.custody_milling(_customer_id uuid, _warehouse_id uuid, _grain_item_id uuid, _bags_out numeric, _kg_out numeric, _outputs jsonb, _notes text) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_user uuid := auth.uid();
  v_doc text;
  v_balance_bags numeric;
  v_balance_kg numeric;
  v_total_out_bags numeric := 0;
  v_total_out_kg numeric := 0;
  r record;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT public.can_operate_milling() THEN
    RAISE EXCEPTION 'You are not permitted to record custody milling';
  END IF;
  IF _customer_id IS NULL OR _warehouse_id IS NULL OR _grain_item_id IS NULL THEN
    RAISE EXCEPTION 'Customer, warehouse and grain item are required';
  END IF;
  IF coalesce(_bags_out, 0) <= 0 AND coalesce(_kg_out, 0) <= 0 THEN
    RAISE EXCEPTION 'Milling must consume at least one bag or a positive weight of grain';
  END IF;
  IF _outputs IS NULL OR jsonb_typeof(_outputs) <> 'array' OR jsonb_array_length(_outputs) = 0 THEN
    RAISE EXCEPTION 'At least one output line is required';
  END IF;

  -- صنف الحبوب خام، وأصناف النواتج منتجات/نواتج جانبية — من القاعدة.
  IF NOT EXISTS (
    SELECT 1 FROM public.products
    WHERE id = _grain_item_id AND item_class = 'RAW_MATERIAL' AND is_active
  ) THEN
    RAISE EXCEPTION 'Milling input must be an active RAW_MATERIAL grain';
  END IF;

  SELECT * FROM public.custody_balance(_customer_id, _warehouse_id, _grain_item_id)
    INTO v_balance_bags, v_balance_kg;

  IF coalesce(_bags_out, 0) > v_balance_bags THEN
    RAISE EXCEPTION 'Grain bags balance (%) is less than the requested milling amount (%)',
      v_balance_bags, coalesce(_bags_out, 0);
  END IF;
  IF coalesce(_kg_out, 0) > v_balance_kg THEN
    RAISE EXCEPTION 'Grain kg balance (%) is less than the requested milling amount (%)',
      v_balance_kg, coalesce(_kg_out, 0);
  END IF;

  FOR r IN SELECT * FROM jsonb_to_recordset(_outputs)
             AS o(item_id uuid, bags numeric, kg numeric)
  LOOP
    IF r.item_id IS NULL THEN
      RAISE EXCEPTION 'Every output line needs an item';
    END IF;
    IF coalesce(r.bags, 0) <= 0 AND coalesce(r.kg, 0) <= 0 THEN
      RAISE EXCEPTION 'Every output line needs bags or a positive weight';
    END IF;
    IF coalesce(r.bags, 0) < 0 OR coalesce(r.kg, 0) < 0 THEN
      RAISE EXCEPTION 'Output quantities cannot be negative';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.products
      WHERE id = r.item_id AND item_class IN ('FINISHED_GOOD', 'BY_PRODUCT') AND is_active
    ) THEN
      RAISE EXCEPTION 'Milling outputs must be FINISHED_GOOD or BY_PRODUCT items';
    END IF;
    v_total_out_bags := v_total_out_bags + coalesce(r.bags, 0);
    v_total_out_kg   := v_total_out_kg + coalesce(r.kg, 0);
  END LOOP;

  v_doc := 'CM-' || to_char(now(), 'YYYYMM') || '-' || lpad(nextval('public.milling_service_seq')::text, 4, '0');

  -- صادر الحبوب
  INSERT INTO public.custody_ledger
    (customer_id, warehouse_id, entry_type, item_id, doc_number,
     bags_out, kg_out, notes, created_by)
  VALUES
    (_customer_id, _warehouse_id, 'MILLING', _grain_item_id, v_doc,
     coalesce(_bags_out, 0), coalesce(_kg_out, 0), _notes, v_user);

  -- وارد النواتج: سطر لكل ناتج
  FOR r IN SELECT * FROM jsonb_to_recordset(_outputs)
             AS o(item_id uuid, bags numeric, kg numeric)
  LOOP
    INSERT INTO public.custody_ledger
      (customer_id, warehouse_id, entry_type, item_id, doc_number,
       bags_in, kg_in, notes, created_by)
    VALUES
      (_customer_id, _warehouse_id, 'MILLING', r.item_id, v_doc,
       coalesce(r.bags, 0), coalesce(r.kg, 0), _notes, v_user);
  END LOOP;

  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, payload)
  VALUES (v_user, 'custody.milling', 'custody_ledger', _customer_id,
    jsonb_build_object(
      'doc_number', v_doc,
      'grain_item_id', _grain_item_id,
      'grain_bags', coalesce(_bags_out, 0),
      'grain_kg', coalesce(_kg_out, 0),
      'outputs', _outputs,
      'stock_impact', 'NONE — customer custody'
    ));

  RETURN v_doc;
END $$;

--
-- Name: custody_milling(uuid, uuid, uuid, numeric, numeric, jsonb, text, uuid); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.custody_milling(_customer_id uuid, _warehouse_id uuid, _grain_item_id uuid, _bags_out numeric, _kg_out numeric, _outputs jsonb, _notes text, _grain_type_id uuid DEFAULT NULL::uuid) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_user uuid := auth.uid();
  v_doc text;
  v_balance_bags numeric;
  v_balance_kg numeric;
  v_total_out_bags numeric := 0;
  v_total_out_kg numeric := 0;
  v_grain_type_name text := NULL;
  v_grain_type_loss numeric := NULL;
  r record;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT public.can_operate_milling() THEN
    RAISE EXCEPTION 'You are not permitted to record custody milling';
  END IF;
  IF _customer_id IS NULL OR _warehouse_id IS NULL OR _grain_item_id IS NULL THEN
    RAISE EXCEPTION 'Customer, warehouse and grain item are required';
  END IF;
  IF coalesce(_bags_out, 0) <= 0 AND coalesce(_kg_out, 0) <= 0 THEN
    RAISE EXCEPTION 'Milling must consume at least one bag or a positive weight of grain';
  END IF;
  IF _outputs IS NULL OR jsonb_typeof(_outputs) <> 'array' OR jsonb_array_length(_outputs) = 0 THEN
    RAISE EXCEPTION 'At least one output line is required';
  END IF;

  -- نوع الحبة المرجعي: يجب أن يكون نشطاً إن مُرِّر.
  IF _grain_type_id IS NOT NULL THEN
    SELECT gt.name_ar, gt.default_loss_rate_pct
      INTO v_grain_type_name, v_grain_type_loss
      FROM public.grain_types gt
     WHERE gt.id = _grain_type_id AND gt.is_active;
    IF v_grain_type_name IS NULL THEN
      RAISE EXCEPTION 'Grain type is not active or does not exist';
    END IF;
  END IF;

  -- صنف الحبوب خام، وأصناف النواتج منتجات/نواتج جانبية — من القاعدة.
  IF NOT EXISTS (
    SELECT 1 FROM public.products
    WHERE id = _grain_item_id AND item_class = 'RAW_MATERIAL' AND is_active
  ) THEN
    RAISE EXCEPTION 'Milling input must be an active RAW_MATERIAL grain';
  END IF;

  SELECT * FROM public.custody_balance(_customer_id, _warehouse_id, _grain_item_id)
    INTO v_balance_bags, v_balance_kg;

  IF coalesce(_bags_out, 0) > v_balance_bags THEN
    RAISE EXCEPTION 'Grain bags balance (%) is less than the requested milling amount (%)',
      v_balance_bags, coalesce(_bags_out, 0);
  END IF;
  IF coalesce(_kg_out, 0) > v_balance_kg THEN
    RAISE EXCEPTION 'Grain kg balance (%) is less than the requested milling amount (%)',
      v_balance_kg, coalesce(_kg_out, 0);
  END IF;

  FOR r IN SELECT * FROM jsonb_to_recordset(_outputs)
             AS o(item_id uuid, bags numeric, kg numeric)
  LOOP
    IF r.item_id IS NULL THEN
      RAISE EXCEPTION 'Every output line needs an item';
    END IF;
    IF coalesce(r.bags, 0) <= 0 AND coalesce(r.kg, 0) <= 0 THEN
      RAISE EXCEPTION 'Every output line needs bags or a positive weight';
    END IF;
    IF coalesce(r.bags, 0) < 0 OR coalesce(r.kg, 0) < 0 THEN
      RAISE EXCEPTION 'Output quantities cannot be negative';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.products
      WHERE id = r.item_id AND item_class IN ('FINISHED_GOOD', 'BY_PRODUCT') AND is_active
    ) THEN
      RAISE EXCEPTION 'Milling outputs must be FINISHED_GOOD or BY_PRODUCT items';
    END IF;
    v_total_out_bags := v_total_out_bags + coalesce(r.bags, 0);
    v_total_out_kg   := v_total_out_kg + coalesce(r.kg, 0);
  END LOOP;

  v_doc := 'CM-' || to_char(now(), 'YYYYMM') || '-' || lpad(nextval('public.milling_service_seq')::text, 4, '0');

  -- صادر الحبوب — يوثّق نوع الحبة المرجعي في الملاحظات إن مُرِّر
  INSERT INTO public.custody_ledger
    (customer_id, warehouse_id, entry_type, item_id, doc_number,
     bags_out, kg_out, notes, created_by)
  VALUES
    (_customer_id, _warehouse_id, 'MILLING', _grain_item_id, v_doc,
     coalesce(_bags_out, 0), coalesce(_kg_out, 0),
     CASE WHEN v_grain_type_name IS NOT NULL
          THEN coalesce(_notes, '') || CASE WHEN coalesce(_notes, '') = '' THEN '' ELSE ' — ' END
               || '[نوع الحبة: ' || v_grain_type_name || ']'
          ELSE _notes END,
     v_user);

  -- وارد النواتج: سطر لكل ناتج
  FOR r IN SELECT * FROM jsonb_to_recordset(_outputs)
             AS o(item_id uuid, bags numeric, kg numeric)
  LOOP
    INSERT INTO public.custody_ledger
      (customer_id, warehouse_id, entry_type, item_id, doc_number,
       bags_in, kg_in, notes, created_by)
    VALUES
      (_customer_id, _warehouse_id, 'MILLING', r.item_id, v_doc,
       coalesce(r.bags, 0), coalesce(r.kg, 0), _notes, v_user);
  END LOOP;

  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, payload)
  VALUES (v_user, 'custody.milling', 'custody_ledger', _customer_id,
    jsonb_build_object(
      'doc_number', v_doc,
      'grain_item_id', _grain_item_id,
      'grain_type_id', _grain_type_id,
      'grain_type_name', v_grain_type_name,
      'grain_type_default_loss_pct', v_grain_type_loss,
      'grain_bags', coalesce(_bags_out, 0),
      'grain_kg', coalesce(_kg_out, 0),
      'outputs', _outputs,
      'stock_impact', 'NONE — customer custody'
    ));

  RETURN v_doc;
END $$;

--
-- Name: custody_milling_multi(uuid, uuid, jsonb, jsonb, text); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.custody_milling_multi(_customer_id uuid, _warehouse_id uuid, _grains jsonb, _outputs jsonb, _notes text) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_user uuid := auth.uid();
  v_doc text;
  v_balance_bags numeric;
  v_balance_kg numeric;
  v_total_out_bags numeric := 0;
  v_total_out_kg numeric := 0;
  r record;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT public.can_operate_milling() THEN
    RAISE EXCEPTION 'You are not permitted to record custody milling';
  END IF;
  IF _customer_id IS NULL OR _warehouse_id IS NULL THEN
    RAISE EXCEPTION 'Customer and warehouse are required';
  END IF;
  IF _grains IS NULL OR jsonb_typeof(_grains) <> 'array' OR jsonb_array_length(_grains) = 0 THEN
    RAISE EXCEPTION 'At least one grain line is required';
  END IF;
  IF _outputs IS NULL OR jsonb_typeof(_outputs) <> 'array' OR jsonb_array_length(_outputs) = 0 THEN
    RAISE EXCEPTION 'At least one output line is required';
  END IF;

  -- تحقق أسطر الحبوب: صنف خام + رصيد كافٍ
  FOR r IN SELECT * FROM jsonb_to_recordset(_grains) AS g(item_id uuid, bags numeric, kg numeric)
  LOOP
    IF r.item_id IS NULL THEN
      RAISE EXCEPTION 'Every grain line needs an item';
    END IF;
    IF coalesce(r.bags, 0) <= 0 AND coalesce(r.kg, 0) <= 0 THEN
      RAISE EXCEPTION 'Every grain line needs bags or a positive weight';
    END IF;
    IF coalesce(r.bags, 0) < 0 OR coalesce(r.kg, 0) < 0 THEN
      RAISE EXCEPTION 'Quantities cannot be negative';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.products
      WHERE id = r.item_id AND item_class = 'RAW_MATERIAL' AND is_active AND is_custody_item
    ) THEN
      RAISE EXCEPTION 'Milling input must be active custody grain products (is_custody_item)';
    END IF;

    SELECT * FROM public.custody_balance(_customer_id, _warehouse_id, r.item_id)
      INTO v_balance_bags, v_balance_kg;
    IF coalesce(r.bags, 0) > v_balance_bags THEN
      RAISE EXCEPTION 'Grain bags balance (%) is less than the requested milling amount (%)',
        v_balance_bags, coalesce(r.bags, 0);
    END IF;
    IF coalesce(r.kg, 0) > v_balance_kg THEN
      RAISE EXCEPTION 'Grain kg balance (%) is less than the requested milling amount (%)',
        v_balance_kg, coalesce(r.kg, 0);
    END IF;
  END LOOP;

  -- تحقق أسطر النواتج
  FOR r IN SELECT * FROM jsonb_to_recordset(_outputs) AS o(item_id uuid, bags numeric, kg numeric)
  LOOP
    IF r.item_id IS NULL THEN
      RAISE EXCEPTION 'Every output line needs an item';
    END IF;
    IF coalesce(r.bags, 0) <= 0 AND coalesce(r.kg, 0) <= 0 THEN
      RAISE EXCEPTION 'Every output line needs bags or a positive weight';
    END IF;
    IF coalesce(r.bags, 0) < 0 OR coalesce(r.kg, 0) < 0 THEN
      RAISE EXCEPTION 'Output quantities cannot be negative';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.products
      WHERE id = r.item_id AND item_class IN ('FINISHED_GOOD', 'BY_PRODUCT')
        AND is_active AND is_custody_item
    ) THEN
      RAISE EXCEPTION 'Milling outputs must be active custody output products (is_custody_item)';
    END IF;
    v_total_out_bags := v_total_out_bags + coalesce(r.bags, 0);
    v_total_out_kg   := v_total_out_kg + coalesce(r.kg, 0);
  END LOOP;

  v_doc := 'CM-' || to_char(now(), 'YYYYMM') || '-' || lpad(nextval('public.milling_service_seq')::text, 4, '0');

  -- صادر الحبوب: سطر لكل صنف
  FOR r IN SELECT * FROM jsonb_to_recordset(_grains) AS g(item_id uuid, bags numeric, kg numeric)
  LOOP
    INSERT INTO public.custody_ledger
      (customer_id, warehouse_id, entry_type, item_id, doc_number,
       bags_out, kg_out, notes, created_by)
    VALUES
      (_customer_id, _warehouse_id, 'MILLING', r.item_id, v_doc,
       coalesce(r.bags, 0), coalesce(r.kg, 0), _notes, v_user);
  END LOOP;

  -- وارد النواتج: سطر لكل ناتج
  FOR r IN SELECT * FROM jsonb_to_recordset(_outputs) AS o(item_id uuid, bags numeric, kg numeric)
  LOOP
    INSERT INTO public.custody_ledger
      (customer_id, warehouse_id, entry_type, item_id, doc_number,
       bags_in, kg_in, notes, created_by)
    VALUES
      (_customer_id, _warehouse_id, 'MILLING', r.item_id, v_doc,
       coalesce(r.bags, 0), coalesce(r.kg, 0), _notes, v_user);
  END LOOP;

  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, payload)
  VALUES (v_user, 'custody.milling', 'custody_ledger', _customer_id,
    jsonb_build_object(
      'doc_number', v_doc,
      'grains', _grains,
      'outputs', _outputs,
      'output_bags', v_total_out_bags,
      'output_kg', v_total_out_kg,
      'stock_impact', 'NONE — customer custody'
    ));

  RETURN v_doc;
END $$;

--
-- Name: custody_output_items(); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.custody_output_items() RETURNS TABLE(id uuid, sku text, name text, name_ar text, item_class public.item_class, sale_price numeric, cost_price numeric, package_weight_kg numeric)
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT p.id, p.sku, p.name, p.name_ar, p.item_class, p.sale_price, p.cost_price, p.package_weight_kg
  FROM public.products p
  WHERE p.item_class IN ('FINISHED_GOOD', 'BY_PRODUCT') AND p.is_active AND p.is_custody_item
  ORDER BY p.name_ar NULLS LAST, p.name;
$$;

--
-- Name: fn_next_document_number(text, uuid, uuid, uuid, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.fn_next_document_number(p_document_type text, p_company_id uuid DEFAULT NULL::uuid, p_branch_id uuid DEFAULT NULL::uuid, p_pos_id uuid DEFAULT NULL::uuid, p_at timestamp with time zone DEFAULT now()) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_seq_name text := public.fn_document_numbering_sequence_name(p_document_type);
  v_cfg      record;
  v_number   bigint;
  v_result   text;
BEGIN
  IF v_seq_name IS NULL THEN
    RAISE EXCEPTION 'Unknown document type: %', p_document_type;
  END IF;

  SELECT * INTO v_cfg
  FROM public.fn_resolve_document_numbering(p_document_type, p_company_id, p_branch_id, p_pos_id);

  -- Atomic allocation. The sequence guarantees uniqueness even when two
  -- cashiers create the same document type in the same millisecond.
  EXECUTE format('SELECT nextval(%L)', v_seq_name) INTO v_number;

  IF v_cfg IS NULL THEN
    -- Engine row missing: still return a safe, unique number.
    RETURN v_number::text;
  END IF;

  v_result := public.fn_format_document_number(
    v_number, v_cfg.prefix, v_cfg.format_tokens, v_cfg.padding,
    v_cfg.separator, v_cfg.date_part, p_at
  );

  -- Keep the informational counter in sync (never used for allocation).
  UPDATE public.document_numbering
    SET current_value = GREATEST(current_value, v_number),
        updated_at = now()
    WHERE id = v_cfg.id;

  RETURN v_result;
END $$;

--
-- Name: fn_set_document_numbering(text, text, text, smallint, text, text, text, bigint); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.fn_set_document_numbering(p_document_type text, p_prefix text DEFAULT NULL::text, p_format_tokens text DEFAULT NULL::text, p_padding smallint DEFAULT NULL::smallint, p_date_part text DEFAULT NULL::text, p_separator text DEFAULT NULL::text, p_reset_policy text DEFAULT NULL::text, p_next_value bigint DEFAULT NULL::bigint) RETURNS public.document_numbering
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_seq     text := public.fn_document_numbering_sequence_name(p_document_type);
  v_row     public.document_numbering;
  v_max     bigint := 0;
  v_is_called boolean;
  v_expected bigint;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT (public.has_role(v_uid, 'owner') OR public.has_role(v_uid, 'manager')) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  IF v_seq IS NULL THEN
    RAISE EXCEPTION 'Unknown document type: %', p_document_type;
  END IF;

  SELECT * INTO v_row
  FROM public.document_numbering
  WHERE document_type = p_document_type AND scope = 'global'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No numbering configuration for %', p_document_type;
  END IF;

  -- ── Guard: never allow a starting value that would duplicate a number that
  --    has already been issued for this document type.
  IF p_next_value IS NOT NULL THEN
    IF p_next_value < 0 THEN
      RAISE EXCEPTION 'Starting number cannot be negative';
    END IF;

    -- Highest number actually visible in the documents, parsed from the tail
    -- of the stored text ("INV-202610-0125" -> 125).
    v_max := CASE p_document_type
      WHEN 'sales_invoice'    THEN (SELECT COALESCE(MAX(NULLIF(regexp_replace(invoice_number, '\D', '', 'g'), '')::bigint), 0) FROM public.sales_invoices)
      WHEN 'purchase_invoice' THEN (SELECT COALESCE(MAX(NULLIF(regexp_replace(invoice_number, '\D', '', 'g'), '')::bigint), 0) FROM public.purchase_invoices)
      WHEN 'sales_return'     THEN (SELECT COALESCE(MAX(NULLIF(regexp_replace(return_number, '\D', '', 'g'), '')::bigint), 0) FROM public.sales_returns)
      WHEN 'purchase_return'  THEN (SELECT COALESCE(MAX(NULLIF(regexp_replace(return_number, '\D', '', 'g'), '')::bigint), 0) FROM public.purchase_returns)
      WHEN 'stock_transfer'   THEN (SELECT COALESCE(MAX(NULLIF(regexp_replace(transfer_number, '\D', '', 'g'), '')::bigint), 0) FROM public.stock_transfers)
      ELSE 0
    END;

    IF p_next_value <= v_max THEN
      RAISE EXCEPTION
        'Starting number % is not greater than an existing number (%). Choose a value above %.',
        p_next_value, v_max, v_max;
    END IF;

    SELECT is_called, last_value INTO v_is_called, v_expected
      FROM public.document_numbering WHERE id = v_row.id; -- placeholder, replaced below

    -- is_called is read from the real sequence.
    EXECUTE format('SELECT is_called, last_value FROM %s', v_seq) INTO v_is_called, v_expected;

    -- setval(seq, n, false) -> the NEXT nextval() returns exactly n.
    EXECUTE format('SELECT setval(%L, %s, false)', v_seq, p_next_value);
  END IF;

  UPDATE public.document_numbering SET
    prefix        = COALESCE(p_prefix,        prefix),
    format_tokens = COALESCE(p_format_tokens, format_tokens),
    padding       = COALESCE(p_padding,       padding),
    date_part     = COALESCE(p_date_part,     date_part),
    separator     = COALESCE(p_separator,     separator),
    reset_policy  = COALESCE(p_reset_policy,  reset_policy),
    current_value = CASE
                      WHEN p_next_value IS NOT NULL THEN p_next_value - 1
                      ELSE current_value
                    END,
    updated_at    = now()
  WHERE id = v_row.id
  RETURNING * INTO v_row;

  -- Audit trail (best effort: projects without the log table stay silent).
  BEGIN
    INSERT INTO public.backup_logs (log_type, status, message, details)
    VALUES (
      'settings',
      'success',
      'Document numbering updated: ' || p_document_type,
      jsonb_build_object(
        'document_type', p_document_type,
        'next_value',    p_next_value,
        'prefix',        v_row.prefix,
        'format_tokens', v_row.format_tokens,
        'padding',       v_row.padding,
        'date_part',     v_row.date_part,
        'actor',         v_uid
      )
    );
  EXCEPTION WHEN undefined_table OR undefined_column THEN
    NULL;
  END;

  RETURN v_row;
END $$;

--
-- Name: milling_document_delivery(uuid, jsonb, text); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.milling_document_delivery(_document_id uuid, _lines jsonb, _notes text) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_user uuid := auth.uid();
  v_customer_id uuid;
  v_warehouse_id uuid;
  v_status text;
  v_doc text;
  v_has_remaining boolean;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT public.can_operate_milling() THEN
    RAISE EXCEPTION 'You are not permitted to deliver milling documents';
  END IF;
  SELECT customer_id, warehouse_id, status
    INTO v_customer_id, v_warehouse_id, v_status
  FROM public.milling_service_documents
  WHERE id = _document_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Milling service document does not exist';
  END IF;
  IF v_status <> 'PROCESSED' THEN
    RAISE EXCEPTION 'Record milling outputs before delivery';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(coalesce(_lines, '[]'::jsonb)) AS r(item_id uuid, bags numeric, kg numeric)
    LEFT JOIN LATERAL (
      SELECT sum(bags_in - bags_out) AS bags_balance, sum(kg_in - kg_out) AS kg_balance
      FROM public.custody_ledger
      WHERE milling_document_id = _document_id AND item_id = r.item_id
    ) b ON true
    WHERE coalesce(r.bags, 0) < 0 OR coalesce(r.kg, 0) < 0
       OR coalesce(b.bags_balance, 0) < coalesce(r.bags, 0)
       OR coalesce(b.kg_balance, 0) < coalesce(r.kg, 0)
  ) THEN
    RAISE EXCEPTION 'Delivery quantity is not available on this milling document';
  END IF;

  v_doc := public.custody_delivery(v_customer_id, v_warehouse_id, _lines, _notes);
  UPDATE public.custody_ledger
  SET milling_document_id = _document_id
  WHERE doc_number = v_doc AND entry_type = 'DELIVERY';

  SELECT EXISTS (
    SELECT 1
    FROM public.custody_ledger
    WHERE milling_document_id = _document_id
    GROUP BY item_id
    HAVING sum(bags_in - bags_out) > 0 OR sum(kg_in - kg_out) > 0
  ) INTO v_has_remaining;

  IF NOT v_has_remaining THEN
    UPDATE public.milling_service_documents
    SET status = 'DELIVERED', delivered_at = now()
    WHERE id = _document_id;
  END IF;
  RETURN v_doc;
END $$;

--
-- Name: milling_document_process(uuid, uuid, numeric, numeric, jsonb, text); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.milling_document_process(_document_id uuid, _grain_item_id uuid, _bags_out numeric, _kg_out numeric, _outputs jsonb, _notes text) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_user uuid := auth.uid();
  v_customer_id uuid;
  v_warehouse_id uuid;
  v_status text;
  v_doc text;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT public.can_operate_milling() THEN
    RAISE EXCEPTION 'You are not permitted to process milling documents';
  END IF;
  SELECT customer_id, warehouse_id, status
    INTO v_customer_id, v_warehouse_id, v_status
  FROM public.milling_service_documents
  WHERE id = _document_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Milling service document does not exist';
  END IF;
  IF v_status = 'DELIVERED' THEN
    RAISE EXCEPTION 'Delivered milling service documents cannot be processed';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.custody_ledger
    WHERE milling_document_id = _document_id AND item_id = _grain_item_id
    GROUP BY item_id
    HAVING sum(bags_in - bags_out) >= coalesce(_bags_out, 0)
       AND sum(kg_in - kg_out) >= coalesce(_kg_out, 0)
  ) THEN
    RAISE EXCEPTION 'The selected grain quantity is not available on this milling document';
  END IF;

  v_doc := public.custody_milling(
    v_customer_id, v_warehouse_id, _grain_item_id, _bags_out, _kg_out, _outputs, _notes
  );
  UPDATE public.custody_ledger
  SET milling_document_id = _document_id
  WHERE doc_number = v_doc AND entry_type = 'MILLING';
  UPDATE public.milling_service_documents
  SET status = 'PROCESSED', processed_at = coalesce(processed_at, now())
  WHERE id = _document_id;

  RETURN v_doc;
END $$;

--
-- Name: milling_service_cost_report(date, date, uuid); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.milling_service_cost_report(p_date_from date DEFAULT NULL::date, p_date_to date DEFAULT CURRENT_DATE, p_cost_center_id uuid DEFAULT NULL::uuid) RETURNS TABLE(cost_center_id uuid, cost_center_name text, expense_amount numeric, expense_document_count bigint, processed_bags numeric, processed_kg numeric, estimated_service_cost numeric, estimate_covered_bags numeric, estimate_covered_kg numeric, completed_invoice_revenue numeric, completed_document_count bigint, actual_cost_per_bag numeric, actual_cost_per_kg numeric, estimated_cost_per_bag numeric, estimated_cost_per_kg numeric, service_contribution_after_allocated_cost numeric)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_user uuid := public.expense_actor();
  v_cost_center_id uuid := p_cost_center_id;
BEGIN
  PERFORM public.expense_assert_capability(v_user, 'expense.report');
  IF p_date_from IS NOT NULL AND p_date_to IS NOT NULL AND p_date_from > p_date_to THEN
    RAISE EXCEPTION 'The report start date must not be after its end date';
  END IF;

  IF v_cost_center_id IS NULL THEN
    SELECT id INTO v_cost_center_id
      FROM public.expense_cost_centers
     WHERE upper(coalesce(code, '')) = 'MILLING-SERVICE'
        OR name_ar = 'خدمة الطحن'
     ORDER BY CASE WHEN upper(coalesce(code, '')) = 'MILLING-SERVICE' THEN 0 ELSE 1 END
     LIMIT 1;
  END IF;
  IF v_cost_center_id IS NULL THEN
    RAISE EXCEPTION 'Create or select a cost center for the milling service';
  END IF;

  RETURN QUERY
  WITH center AS (
    SELECT cc.id, coalesce(cc.name_ar, cc.name) AS label
      FROM public.expense_cost_centers cc
     WHERE cc.id = v_cost_center_id AND cc.is_active
  ), expense_totals AS (
    SELECT coalesce(sum(l.net_amount + CASE WHEN e.tax_recoverable THEN 0 ELSE l.tax_amount END), 0)::numeric AS amount,
           count(DISTINCT e.id)::bigint AS document_count
      FROM public.expense_lines l
      JOIN public.expense_entries e ON e.id = l.entry_id
     WHERE coalesce(l.cost_center_id, e.cost_center_id) = v_cost_center_id
       AND e.status = ANY (ARRAY['POSTED','PARTIALLY_PAID','PAID','CLOSED']::public.expense_status[])
       AND (p_date_from IS NULL OR e.expense_date >= p_date_from)
       AND (p_date_to IS NULL OR e.expense_date <= p_date_to)
  ), milling AS (
    SELECT coalesce(sum(cl.bags_out), 0)::numeric AS bags,
           coalesce(sum(cl.kg_out), 0)::numeric AS kg
      FROM public.custody_ledger cl
     WHERE cl.entry_type = 'MILLING'
       AND (cl.bags_out > 0 OR cl.kg_out > 0)
       AND (p_date_from IS NULL OR cl.created_at::date >= p_date_from)
       AND (p_date_to IS NULL OR cl.created_at::date <= p_date_to)
  ), estimates AS (
    -- Billing estimates belong to intake tickets. The multi-grain milling RPC
    -- records custody movements by its own processing number, so do not join
    -- estimates through milling_document_id (it is NULL on that path).
    SELECT coalesce(sum(d.estimated_cost_amount), 0)::numeric AS amount,
           coalesce(sum(CASE WHEN d.estimated_cost_basis = 'BAG'
                             THEN d.estimated_cost_amount ELSE 0 END), 0)::numeric AS bag_amount,
           coalesce(sum(CASE WHEN d.estimated_cost_basis = 'KG'
                             THEN d.estimated_cost_amount ELSE 0 END), 0)::numeric AS kg_amount,
           coalesce(sum(CASE WHEN d.estimated_cost_basis = 'BAG'
                             THEN d.estimated_cost_quantity ELSE 0 END), 0)::numeric AS bags,
           coalesce(sum(CASE WHEN d.estimated_cost_basis = 'KG'
                             THEN d.estimated_cost_quantity ELSE 0 END), 0)::numeric AS kg
      FROM public.milling_service_documents d
     WHERE d.estimated_cost_amount IS NOT NULL
       AND (p_date_from IS NULL OR d.received_at::date >= p_date_from)
       AND (p_date_to IS NULL OR d.received_at::date <= p_date_to)
  ), completed AS (
    SELECT coalesce(sum(si.total), 0)::numeric AS revenue,
           count(*)::bigint AS document_count
      FROM public.milling_service_documents d
      JOIN public.sales_invoices si ON si.id = d.sales_invoice_id
     WHERE d.status = 'DELIVERED'
       AND d.delivered_at IS NOT NULL
       AND (p_date_from IS NULL OR d.delivered_at::date >= p_date_from)
       AND (p_date_to IS NULL OR d.delivered_at::date <= p_date_to)
  )
  SELECT center.id,
         center.label,
         expense_totals.amount,
         expense_totals.document_count,
         milling.bags,
         milling.kg,
         estimates.amount,
         estimates.bags,
         estimates.kg,
         completed.revenue,
         completed.document_count,
         CASE WHEN milling.bags > 0 THEN round(expense_totals.amount / milling.bags, 4) END,
         CASE WHEN milling.kg > 0 THEN round(expense_totals.amount / milling.kg, 4) END,
         CASE WHEN estimates.bags > 0 THEN round(estimates.bag_amount / estimates.bags, 4) END,
         CASE WHEN estimates.kg > 0 THEN round(estimates.kg_amount / estimates.kg, 4) END,
         completed.revenue - expense_totals.amount
    FROM center CROSS JOIN expense_totals CROSS JOIN milling CROSS JOIN estimates CROSS JOIN completed;
END;
$$;

--
-- Name: next_expense_reference(); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.next_expense_reference() RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  RETURN public.fn_next_document_number('expense');
END $$;

--
-- Name: next_invoice_number(); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.next_invoice_number() RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  RETURN public.fn_next_document_number('sales_invoice');
END $$;

--
-- Name: next_purchase_number(); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.next_purchase_number() RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  RETURN public.fn_next_document_number('purchase_invoice');
END $$;

--
-- Name: next_purchase_return_number(); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.next_purchase_return_number() RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  RETURN public.fn_next_document_number('purchase_return');
END $$;

--
-- Name: next_sales_return_number(); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.next_sales_return_number() RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  RETURN public.fn_next_document_number('sales_return');
END $$;

--
-- Name: next_transfer_number(); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.next_transfer_number() RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  RETURN public.fn_next_document_number('stock_transfer');
END $$;

--
-- Name: product_delete_guard(uuid); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.product_delete_guard(p_product_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_counts   jsonb;
  v_blocking bigint;
BEGIN
  -- الصلاحية مفحوصة في القاعدة: لا يعتمد على الواجهة.
  IF NOT (
    public.has_role(auth.uid(), 'owner')
    OR public.has_role(auth.uid(), 'manager')
    OR public.is_platform_admin(auth.uid())
  ) THEN
    RETURN jsonb_build_object('deleted', false, 'reason', 'forbidden');
  END IF;

  v_counts   := public.product_reference_counts(p_product_id);
  v_blocking := COALESCE((v_counts ->> 'blocking_total')::bigint, 0);

  IF v_blocking > 0 THEN
    -- مرجع تاريخي أو مستند أو عميل: لا حذف أبدًا. البديل هو إلغاء التنشيط.
    RETURN jsonb_build_object(
      'deleted', false,
      'reason',  'referenced',
      'counts',  v_counts
    );
  END IF;

  -- لا مراجع: امسح ملحقات الكتالوج التي لا تحمل معنى ماليًا، ثم الصنف.
  BEGIN
    DELETE FROM public.product_compatibilities WHERE product_id = p_product_id;
  EXCEPTION WHEN undefined_table THEN NULL;
  END;

  DELETE FROM public.inventory WHERE product_id = p_product_id;

  DELETE FROM public.products WHERE id = p_product_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('deleted', false, 'reason', 'not_found');
  END IF;

  RETURN jsonb_build_object(
    'deleted', true,
    'reason',  'deleted',
    'counts',  v_counts
  );
END;
$$;

--
-- Name: product_reference_counts(uuid); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.product_reference_counts(p_product_id uuid) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $_$
DECLARE
  v_sales_items      bigint := 0;
  v_purchase_items   bigint := 0;
  v_sales_returns    bigint := 0;
  v_purchase_returns bigint := 0;
  v_transfers        bigint := 0;
  v_stock_movements  bigint := 0;
  v_inventory_rows   bigint := 0;
  v_compatibilities  bigint := 0;
  v_custody_entries  bigint := 0;
  v_other_refs       bigint := 0;
  v_blocking         bigint := 0;

  v_table   text;
  v_column  text;
  v_count   bigint;
BEGIN
  -- ------------------------------------------------------------------------
  -- 1) العدّادات المعروفة (تبقى صريحة لأن الواجهة تعرضها بأسماء مقروءة)
  -- ------------------------------------------------------------------------
  SELECT count(*) INTO v_sales_items
    FROM public.sales_invoice_items WHERE product_id = p_product_id;

  SELECT count(*) INTO v_purchase_items
    FROM public.purchase_invoice_items WHERE product_id = p_product_id;

  -- المرتجعات والتحويلات تُفحص ديناميكيًا: تثبيتات أقدم لا تحتوي هذه الجداول.
  BEGIN
    SELECT count(*) INTO v_sales_returns
      FROM public.sales_return_items WHERE product_id = p_product_id;
  EXCEPTION WHEN undefined_table THEN v_sales_returns := 0;
  END;

  BEGIN
    SELECT count(*) INTO v_purchase_returns
      FROM public.purchase_return_items WHERE product_id = p_product_id;
  EXCEPTION WHEN undefined_table THEN v_purchase_returns := 0;
  END;

  BEGIN
    SELECT count(*) INTO v_transfers
      FROM public.stock_transfer_items WHERE product_id = p_product_id;
  EXCEPTION WHEN undefined_table THEN v_transfers := 0;
  END;

  SELECT count(*) INTO v_stock_movements
    FROM public.stock_movements WHERE product_id = p_product_id;

  SELECT count(*) INTO v_inventory_rows
    FROM public.inventory WHERE product_id = p_product_id;

  BEGIN
    SELECT count(*) INTO v_compatibilities
      FROM public.product_compatibilities WHERE product_id = p_product_id;
  EXCEPTION WHEN undefined_table THEN v_compatibilities := 0;
  END;

  -- ------------------------------------------------------------------------
  -- 2) دفتر أمانات المطحنة — كل استلام/طحن/تسليم مربوط بصنف وعميل
  --
  -- هذا هو الثقب الذي أُصلح: الصنف الذي استُلم في المطحنة وأُعيد تسليمه ليس
  -- «غير مرتبط» حتى لو لم يدخل فاتورة بيع أو شراء.
  -- ------------------------------------------------------------------------
  BEGIN
    SELECT count(*) INTO v_custody_entries
      FROM public.custody_ledger WHERE item_id = p_product_id;
  EXCEPTION WHEN undefined_table THEN v_custody_entries := 0;
  END;

  -- ------------------------------------------------------------------------
  -- 3) قاعدة عامة: كل مفتاح خارجي آخر يشير إلى products(id) ويحمل صفًا
  --
  -- تُستثنى الجداول المعروفة أعلاه (عُدّت بالفعل) والجداول الوصفية التي تُحذف
  -- مع الصنف (inventory / product_compatibilities). أي جدول جديد يُضاف لاحقًا
  -- يدخل الحساب تلقائيًا؛ فالحذف يبقى محصورًا في «غير المرتبطين».
  -- ------------------------------------------------------------------------
  FOR v_table, v_column IN
    SELECT DISTINCT c.conrelid::regclass::text, a.attname
      FROM pg_constraint c
      JOIN pg_attribute a
        ON a.attrelid = c.conrelid
       AND a.attnum = ANY (c.conkey)
     WHERE c.contype = 'f'
       AND c.confrelid = 'public.products'::regclass
       AND c.conrelid::regclass::text NOT IN (
         'public.sales_invoice_items',
         'public.purchase_invoice_items',
         'public.sales_return_items',
         'public.purchase_return_items',
         'public.stock_transfer_items',
         'public.stock_movements',
         'public.inventory',
         'public.product_compatibilities'
       )
  LOOP
    -- الحماية من الحقن: الأسماء تأتي من كتالوج القاعدة نفسه، لكن نتحقق منها
    -- صراحةً فلا يُنفَّذ إلا مُعرِّف كائن معروف.
    CONTINUE WHEN v_table !~ '^[a-z_][a-z0-9_]*(\.[a-z_][a-z0-9_]*)?$';
    CONTINUE WHEN v_column !~ '^[a-z_][a-z0-9_]*$';

    BEGIN
      EXECUTE format('SELECT count(*) FROM %s WHERE %I = $1', v_table, v_column)
        INTO v_count
        USING p_product_id;
      v_other_refs := v_other_refs + coalesce(v_count, 0);
    EXCEPTION WHEN undefined_table OR undefined_column THEN
      -- تثبيت بلا الجدول/العمود: لا مراجع منه.
      NULL;
    END;
  END LOOP;

  v_blocking := v_sales_items + v_purchase_items + v_sales_returns
              + v_purchase_returns + v_transfers + v_stock_movements
              + v_custody_entries + v_other_refs;

  RETURN jsonb_build_object(
    'product_id',          p_product_id,
    'sales_items',         v_sales_items,
    'purchase_items',      v_purchase_items,
    'sales_returns',       v_sales_returns,
    'purchase_returns',    v_purchase_returns,
    'transfers',           v_transfers,
    'stock_movements',     v_stock_movements,
    'inventory_rows',      v_inventory_rows,
    'compatibilities',     v_compatibilities,
    'custody_entries',     v_custody_entries,
    'other_refs',          v_other_refs,
    'blocking_total',      v_blocking,
    'can_delete',          v_blocking = 0,
    'has_history',         v_stock_movements > 0
                           OR v_inventory_rows > 0
                           OR v_custody_entries > 0
  );
END;
$_$;

--
-- Name: reject_custody_items_in_commercial_documents(); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.reject_custody_items_in_commercial_documents() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF NEW.product_id IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.products p
    WHERE p.id = NEW.product_id
      AND p.is_custody_item
  ) THEN
    RAISE EXCEPTION 'Mill custody item % cannot be used in a commercial invoice', NEW.product_id
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

--
-- Name: custody_ledger; Type: TABLE; Schema: public; Owner: supabase_admin
--

CREATE TABLE public.custody_ledger (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    customer_id uuid NOT NULL,
    warehouse_id uuid NOT NULL,
    entry_type public.custody_entry_type NOT NULL,
    item_id uuid NOT NULL,
    doc_number character varying(50),
    bags_in numeric(12,3) DEFAULT 0 NOT NULL,
    bags_out numeric(12,3) DEFAULT 0 NOT NULL,
    kg_in numeric(12,3) DEFAULT 0 NOT NULL,
    kg_out numeric(12,3) DEFAULT 0 NOT NULL,
    unit_price numeric(14,2) DEFAULT 0 NOT NULL,
    amount numeric(14,2) DEFAULT 0 NOT NULL,
    milling_document_id uuid,
    service_invoice_id uuid,
    notes text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    source_type text,
    source_id uuid,
    CONSTRAINT custody_ledger_invoice_only_money_check CHECK (((service_invoice_id IS NULL) OR ((unit_price = (0)::numeric) AND (amount = (0)::numeric)))),
    CONSTRAINT custody_ledger_movement_check CHECK (((((bags_in + bags_out) + kg_in) + kg_out) > (0)::numeric)),
    CONSTRAINT custody_ledger_one_side_check CHECK ((((bags_in = (0)::numeric) OR (bags_out = (0)::numeric)) AND ((kg_in = (0)::numeric) OR (kg_out = (0)::numeric)))),
    CONSTRAINT custody_ledger_quantities_check CHECK (((bags_in >= (0)::numeric) AND (bags_out >= (0)::numeric) AND (kg_in >= (0)::numeric) AND (kg_out >= (0)::numeric))),
    CONSTRAINT custody_ledger_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL
);

--
-- Name: milling_service_documents; Type: TABLE; Schema: public; Owner: supabase_admin
--

CREATE TABLE public.milling_service_documents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    document_number character varying(50) NOT NULL,
    customer_id uuid NOT NULL,
    warehouse_id uuid NOT NULL,
    sales_invoice_id uuid NOT NULL,
    status character varying(20) DEFAULT 'RECEIVED'::character varying NOT NULL,
    received_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    processed_at timestamp with time zone,
    delivered_at timestamp with time zone,
    created_by uuid,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    billing_basis text,
    fee_per_unit numeric(18,6),
    fee_quantity numeric(14,3),
    estimated_cost_basis text,
    estimated_cost_rate numeric(18,4),
    estimated_cost_quantity numeric(18,3),
    estimated_cost_amount numeric(18,2),
    estimated_cost_captured_at timestamp with time zone,
    CONSTRAINT milling_service_documents_estimated_cost_basis_check CHECK (((estimated_cost_basis IS NULL) OR (estimated_cost_basis = ANY (ARRAY['BAG'::text, 'KG'::text])))),
    CONSTRAINT milling_service_documents_status_check CHECK (((status)::text = ANY ((ARRAY['RECEIVED'::character varying, 'PROCESSED'::character varying, 'DELIVERED'::character varying])::text[]))),
    CONSTRAINT milling_service_documents_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL
);

--
-- Name: milling_delivery_seq; Type: SEQUENCE; Schema: public; Owner: supabase_admin
--

CREATE SEQUENCE public.milling_delivery_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: milling_document_seq; Type: SEQUENCE; Schema: public; Owner: supabase_admin
--

CREATE SEQUENCE public.milling_document_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: milling_intake_seq; Type: SEQUENCE; Schema: public; Owner: supabase_admin
--

CREATE SEQUENCE public.milling_intake_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: milling_margin_report; Type: VIEW; Schema: public; Owner: supabase_admin
--

CREATE VIEW public.milling_margin_report WITH (security_invoker='true') AS
 WITH sold AS (
         SELECT it.product_id,
            sum(it.quantity) AS qty_sold,
            sum(it.total) AS revenue,
            count(DISTINCT si.id) AS invoice_count
           FROM (public.sales_invoice_items it
             JOIN public.sales_invoices si ON ((si.id = it.invoice_id)))
          WHERE (((si.created_at)::date >= (CURRENT_DATE - 365)) AND ((si.created_at)::date <= CURRENT_DATE) AND (si.status <> ALL (ARRAY['draft'::public.invoice_status, 'cancelled'::public.invoice_status])) AND (it.stock_effect = 'STOCK_ISSUE'::text))
          GROUP BY it.product_id
        )
 SELECT p.id AS product_id,
    p.sku,
    p.name_ar,
    p.item_class,
    COALESCE(s.qty_sold, (0)::numeric) AS qty_sold,
    COALESCE(s.revenue, (0)::numeric) AS revenue,
    COALESCE(s.invoice_count, (0)::bigint) AS invoice_count,
    c.unit_cost,
    c.basis,
    round((COALESCE(s.qty_sold, (0)::numeric) * COALESCE(c.unit_cost, (0)::numeric)), 2) AS cost_of_goods,
    round((COALESCE(s.revenue, (0)::numeric) - (COALESCE(s.qty_sold, (0)::numeric) * COALESCE(c.unit_cost, (0)::numeric))), 2) AS margin,
        CASE
            WHEN (COALESCE(s.revenue, (0)::numeric) > (0)::numeric) THEN round((((COALESCE(s.revenue, (0)::numeric) - (COALESCE(s.qty_sold, (0)::numeric) * COALESCE(c.unit_cost, (0)::numeric))) * (100)::numeric) / s.revenue), 2)
            ELSE NULL::numeric
        END AS margin_pct,
        CASE
            WHEN (c.basis = 'ACTUAL'::text) THEN 'ACTUAL'::text
            ELSE 'REFERENCE'::text
        END AS cost_basis
   FROM ((sold s
     JOIN public.products p ON ((p.id = s.product_id)))
     LEFT JOIN LATERAL ( SELECT COALESCE(
                CASE
                    WHEN (l.quantity > (0)::numeric) THEN round((l.total_value / l.quantity), 4)
                    ELSE NULL::numeric
                END, p.cost_price, (0)::numeric) AS unit_cost,
                CASE
                    WHEN ((l.quantity > (0)::numeric) AND (l.total_value > (0)::numeric)) THEN 'ACTUAL'::text
                    ELSE 'REFERENCE'::text
                END AS basis
           FROM (( SELECT 1 AS "?column?") x
             LEFT JOIN LATERAL ( SELECT sum(cl.quantity) AS quantity,
                    sum(cl.total_value) AS total_value
                   FROM public.item_cost_layers cl
                  WHERE ((cl.product_id = p.id) AND (cl.owner_type = 'COMPANY'::public.owner_type))) l ON (true))) c ON (true));

--
-- Name: milling_service_seq; Type: SEQUENCE; Schema: public; Owner: supabase_admin
--

CREATE SEQUENCE public.milling_service_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: payment_splits trg_payment_splits_balance; Type: TRIGGER; Schema: public; Owner: supabase_admin
--

CREATE CONSTRAINT TRIGGER trg_payment_splits_balance AFTER INSERT OR DELETE OR UPDATE ON public.payment_splits DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.assert_payment_splits_balance();

--
-- Name: FUNCTION assert_payment_splits_balance(); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.assert_payment_splits_balance() FROM PUBLIC;

GRANT ALL ON FUNCTION public.assert_payment_splits_balance() TO service_role;


--
-- Name: FUNCTION can_operate_milling(); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.can_operate_milling() FROM PUBLIC;

GRANT ALL ON FUNCTION public.can_operate_milling() TO service_role;

GRANT ALL ON FUNCTION public.can_operate_milling() TO authenticated;


--
-- Name: grain_types grain_types_read; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY grain_types_read ON public.grain_types FOR SELECT TO authenticated USING (public.can_view_milling());

--
-- Name: FUNCTION can_view_milling(); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.can_view_milling() FROM PUBLIC;

GRANT ALL ON FUNCTION public.can_view_milling() TO service_role;

GRANT ALL ON FUNCTION public.can_view_milling() TO authenticated;


--
-- Name: FUNCTION capture_milling_service_estimate_from_intake(); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.capture_milling_service_estimate_from_intake() FROM PUBLIC;

GRANT ALL ON FUNCTION public.capture_milling_service_estimate_from_intake() TO service_role;


--
-- Name: FUNCTION consume_internal_supplies(_warehouse_id uuid, _lines jsonb, _notes text); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.consume_internal_supplies(_warehouse_id uuid, _lines jsonb, _notes text) FROM PUBLIC;

GRANT ALL ON FUNCTION public.consume_internal_supplies(_warehouse_id uuid, _lines jsonb, _notes text) TO service_role;

GRANT ALL ON FUNCTION public.consume_internal_supplies(_warehouse_id uuid, _lines jsonb, _notes text) TO authenticated;


--
-- Name: FUNCTION create_expense(p_lines jsonb, p_expense_date date, p_due_date date, p_entry_type public.expense_entry_type, p_payee_type public.expense_payee_type, p_payee_name text, p_supplier_id uuid, p_employee_id uuid, p_warehouse_id uuid, p_cost_center_id uuid, p_project_id uuid, p_description text, p_note text, p_tax_mode public.expense_tax_mode, p_reference text, p_submit boolean); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.create_expense(p_lines jsonb, p_expense_date date, p_due_date date, p_entry_type public.expense_entry_type, p_payee_type public.expense_payee_type, p_payee_name text, p_supplier_id uuid, p_employee_id uuid, p_warehouse_id uuid, p_cost_center_id uuid, p_project_id uuid, p_description text, p_note text, p_tax_mode public.expense_tax_mode, p_reference text, p_submit boolean) FROM PUBLIC;

GRANT ALL ON FUNCTION public.create_expense(p_lines jsonb, p_expense_date date, p_due_date date, p_entry_type public.expense_entry_type, p_payee_type public.expense_payee_type, p_payee_name text, p_supplier_id uuid, p_employee_id uuid, p_warehouse_id uuid, p_cost_center_id uuid, p_project_id uuid, p_description text, p_note text, p_tax_mode public.expense_tax_mode, p_reference text, p_submit boolean) TO service_role;

GRANT ALL ON FUNCTION public.create_expense(p_lines jsonb, p_expense_date date, p_due_date date, p_entry_type public.expense_entry_type, p_payee_type public.expense_payee_type, p_payee_name text, p_supplier_id uuid, p_employee_id uuid, p_warehouse_id uuid, p_cost_center_id uuid, p_project_id uuid, p_description text, p_note text, p_tax_mode public.expense_tax_mode, p_reference text, p_submit boolean) TO authenticated;


--
-- Name: FUNCTION create_expense_v2(p_lines jsonb, p_expense_date date, p_due_date date, p_entry_type public.expense_entry_type, p_payee_type public.expense_payee_type, p_payee_name text, p_supplier_id uuid, p_employee_id uuid, p_warehouse_id uuid, p_cost_center_id uuid, p_project_id uuid, p_description text, p_note text, p_tax_mode public.expense_tax_mode, p_reference text, p_submit boolean, p_supplier_invoice_number text, p_tax_recoverable boolean, p_idempotency_key text); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.create_expense_v2(p_lines jsonb, p_expense_date date, p_due_date date, p_entry_type public.expense_entry_type, p_payee_type public.expense_payee_type, p_payee_name text, p_supplier_id uuid, p_employee_id uuid, p_warehouse_id uuid, p_cost_center_id uuid, p_project_id uuid, p_description text, p_note text, p_tax_mode public.expense_tax_mode, p_reference text, p_submit boolean, p_supplier_invoice_number text, p_tax_recoverable boolean, p_idempotency_key text) FROM PUBLIC;

GRANT ALL ON FUNCTION public.create_expense_v2(p_lines jsonb, p_expense_date date, p_due_date date, p_entry_type public.expense_entry_type, p_payee_type public.expense_payee_type, p_payee_name text, p_supplier_id uuid, p_employee_id uuid, p_warehouse_id uuid, p_cost_center_id uuid, p_project_id uuid, p_description text, p_note text, p_tax_mode public.expense_tax_mode, p_reference text, p_submit boolean, p_supplier_invoice_number text, p_tax_recoverable boolean, p_idempotency_key text) TO authenticated;

GRANT ALL ON FUNCTION public.create_expense_v2(p_lines jsonb, p_expense_date date, p_due_date date, p_entry_type public.expense_entry_type, p_payee_type public.expense_payee_type, p_payee_name text, p_supplier_id uuid, p_employee_id uuid, p_warehouse_id uuid, p_cost_center_id uuid, p_project_id uuid, p_description text, p_note text, p_tax_mode public.expense_tax_mode, p_reference text, p_submit boolean, p_supplier_invoice_number text, p_tax_recoverable boolean, p_idempotency_key text) TO service_role;


--
-- Name: FUNCTION create_milling_service_document(_customer_id uuid, _warehouse_id uuid, _grain_item_id uuid, _bags numeric, _kg numeric, _service_item_id uuid, _service_unit_price numeric, _discount numeric, _payment_method text, _paid numeric, _notes text); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.create_milling_service_document(_customer_id uuid, _warehouse_id uuid, _grain_item_id uuid, _bags numeric, _kg numeric, _service_item_id uuid, _service_unit_price numeric, _discount numeric, _payment_method text, _paid numeric, _notes text) FROM PUBLIC;

GRANT ALL ON FUNCTION public.create_milling_service_document(_customer_id uuid, _warehouse_id uuid, _grain_item_id uuid, _bags numeric, _kg numeric, _service_item_id uuid, _service_unit_price numeric, _discount numeric, _payment_method text, _paid numeric, _notes text) TO service_role;

GRANT ALL ON FUNCTION public.create_milling_service_document(_customer_id uuid, _warehouse_id uuid, _grain_item_id uuid, _bags numeric, _kg numeric, _service_item_id uuid, _service_unit_price numeric, _discount numeric, _payment_method text, _paid numeric, _notes text) TO authenticated;



--
-- Name: FUNCTION create_milling_service_document_multi(_customer_id uuid, _warehouse_id uuid, _grains jsonb, _service_item_id uuid, _service_unit_price numeric, _discount numeric, _payment_method text, _paid numeric, _notes text); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.create_milling_service_document_multi(_customer_id uuid, _warehouse_id uuid, _grains jsonb, _service_item_id uuid, _service_unit_price numeric, _discount numeric, _payment_method text, _paid numeric, _notes text) FROM PUBLIC;

GRANT ALL ON FUNCTION public.create_milling_service_document_multi(_customer_id uuid, _warehouse_id uuid, _grains jsonb, _service_item_id uuid, _service_unit_price numeric, _discount numeric, _payment_method text, _paid numeric, _notes text) TO authenticated;

GRANT ALL ON FUNCTION public.create_milling_service_document_multi(_customer_id uuid, _warehouse_id uuid, _grains jsonb, _service_item_id uuid, _service_unit_price numeric, _discount numeric, _payment_method text, _paid numeric, _notes text) TO service_role;

--
-- Name: FUNCTION create_milling_service_document_multi(_customer_id uuid, _warehouse_id uuid, _grains jsonb, _service_item_id uuid, _service_unit_price numeric, _discount numeric, _payment_method text, _paid numeric, _notes text, _payment_splits jsonb); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.create_milling_service_document_multi(_customer_id uuid, _warehouse_id uuid, _grains jsonb, _service_item_id uuid, _service_unit_price numeric, _discount numeric, _payment_method text, _paid numeric, _notes text, _payment_splits jsonb) FROM PUBLIC;

GRANT ALL ON FUNCTION public.create_milling_service_document_multi(_customer_id uuid, _warehouse_id uuid, _grains jsonb, _service_item_id uuid, _service_unit_price numeric, _discount numeric, _payment_method text, _paid numeric, _notes text, _payment_splits jsonb) TO authenticated;

GRANT ALL ON FUNCTION public.create_milling_service_document_multi(_customer_id uuid, _warehouse_id uuid, _grains jsonb, _service_item_id uuid, _service_unit_price numeric, _discount numeric, _payment_method text, _paid numeric, _notes text, _payment_splits jsonb) TO service_role;


--
-- Name: FUNCTION create_milling_service_document_multi_priced(p_customer_id uuid, p_warehouse_id uuid, p_grains jsonb, p_service_item_id uuid, p_service_gross numeric, p_discount numeric, p_payment_method text, p_paid numeric, p_notes text, p_payment_splits jsonb, p_billing_basis text, p_fee_quantity numeric); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.create_milling_service_document_multi_priced(p_customer_id uuid, p_warehouse_id uuid, p_grains jsonb, p_service_item_id uuid, p_service_gross numeric, p_discount numeric, p_payment_method text, p_paid numeric, p_notes text, p_payment_splits jsonb, p_billing_basis text, p_fee_quantity numeric) FROM PUBLIC;

GRANT ALL ON FUNCTION public.create_milling_service_document_multi_priced(p_customer_id uuid, p_warehouse_id uuid, p_grains jsonb, p_service_item_id uuid, p_service_gross numeric, p_discount numeric, p_payment_method text, p_paid numeric, p_notes text, p_payment_splits jsonb, p_billing_basis text, p_fee_quantity numeric) TO authenticated;

GRANT ALL ON FUNCTION public.create_milling_service_document_multi_priced(p_customer_id uuid, p_warehouse_id uuid, p_grains jsonb, p_service_item_id uuid, p_service_gross numeric, p_discount numeric, p_payment_method text, p_paid numeric, p_notes text, p_payment_splits jsonb, p_billing_basis text, p_fee_quantity numeric) TO service_role;

--
-- Name: create_purchase(uuid, uuid, text, numeric, numeric, text, jsonb); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.create_purchase(_warehouse_id uuid, _supplier_id uuid, _payment_method text, _paid numeric, _discount numeric, _note text, _items jsonb) RETURNS uuid
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT public.create_purchase(
    _warehouse_id, _supplier_id, _payment_method, _paid, _discount, _note, _items,
    '[]'::jsonb
  );
$$;


--
-- Name: FUNCTION create_purchase_return(_invoice_id uuid, _warehouse_id uuid, _supplier_id uuid, _refund_method text, _note text, _items jsonb); Type: COMMENT; Schema: public; Owner: supabase_admin
--

COMMENT ON FUNCTION public.create_purchase_return(_invoice_id uuid, _warehouse_id uuid, _supplier_id uuid, _refund_method text, _note text, _items jsonb) IS 'T-08/T-12: مرتجع مشتريات بقيد أستاذ عكسي ورصيد مورد فعلي (قد يكون سالبًا).';

--
-- Name: FUNCTION create_purchase_return(_invoice_id uuid, _warehouse_id uuid, _supplier_id uuid, _refund_method text, _note text, _items jsonb); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.create_purchase_return(_invoice_id uuid, _warehouse_id uuid, _supplier_id uuid, _refund_method text, _note text, _items jsonb) FROM PUBLIC;

GRANT ALL ON FUNCTION public.create_purchase_return(_invoice_id uuid, _warehouse_id uuid, _supplier_id uuid, _refund_method text, _note text, _items jsonb) TO service_role;

GRANT ALL ON FUNCTION public.create_purchase_return(_invoice_id uuid, _warehouse_id uuid, _supplier_id uuid, _refund_method text, _note text, _items jsonb) TO authenticated;


--
-- Name: FUNCTION create_sale(_warehouse_id uuid, _customer_id uuid, _payment_method text, _paid numeric, _discount numeric, _note text, _items jsonb); Type: COMMENT; Schema: public; Owner: supabase_admin
--

COMMENT ON FUNCTION public.create_sale(_warehouse_id uuid, _customer_id uuid, _payment_method text, _paid numeric, _discount numeric, _note text, _items jsonb) IS 'T-06 + P0-3: إنشاء فاتورة مبيعات وتقييم مخزونها وترحيلها للأستاذ في نفس المعاملة.';



--
-- Name: FUNCTION create_sale(_warehouse_id uuid, _customer_id uuid, _payment_method text, _paid numeric, _discount numeric, _note text, _items jsonb); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.create_sale(_warehouse_id uuid, _customer_id uuid, _payment_method text, _paid numeric, _discount numeric, _note text, _items jsonb) FROM PUBLIC;

GRANT ALL ON FUNCTION public.create_sale(_warehouse_id uuid, _customer_id uuid, _payment_method text, _paid numeric, _discount numeric, _note text, _items jsonb) TO service_role;

GRANT ALL ON FUNCTION public.create_sale(_warehouse_id uuid, _customer_id uuid, _payment_method text, _paid numeric, _discount numeric, _note text, _items jsonb) TO authenticated;

--
-- Name: FUNCTION create_sale(_warehouse_id uuid, _customer_id uuid, _payment_method text, _paid numeric, _discount numeric, _note text, _items jsonb, _sale_date date); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.create_sale(_warehouse_id uuid, _customer_id uuid, _payment_method text, _paid numeric, _discount numeric, _note text, _items jsonb, _sale_date date) FROM PUBLIC;

GRANT ALL ON FUNCTION public.create_sale(_warehouse_id uuid, _customer_id uuid, _payment_method text, _paid numeric, _discount numeric, _note text, _items jsonb, _sale_date date) TO service_role;

GRANT ALL ON FUNCTION public.create_sale(_warehouse_id uuid, _customer_id uuid, _payment_method text, _paid numeric, _discount numeric, _note text, _items jsonb, _sale_date date) TO authenticated;

--
-- Name: FUNCTION create_sale(_warehouse_id uuid, _customer_id uuid, _payment_method text, _paid numeric, _discount numeric, _note text, _items jsonb, _sale_date date, _payment_splits jsonb); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.create_sale(_warehouse_id uuid, _customer_id uuid, _payment_method text, _paid numeric, _discount numeric, _note text, _items jsonb, _sale_date date, _payment_splits jsonb) FROM PUBLIC;

GRANT ALL ON FUNCTION public.create_sale(_warehouse_id uuid, _customer_id uuid, _payment_method text, _paid numeric, _discount numeric, _note text, _items jsonb, _sale_date date, _payment_splits jsonb) TO service_role;

GRANT ALL ON FUNCTION public.create_sale(_warehouse_id uuid, _customer_id uuid, _payment_method text, _paid numeric, _discount numeric, _note text, _items jsonb, _sale_date date, _payment_splits jsonb) TO authenticated;


--
-- Name: FUNCTION create_sales_return(_invoice_id uuid, _warehouse_id uuid, _customer_id uuid, _refund_method text, _note text, _items jsonb); Type: COMMENT; Schema: public; Owner: supabase_admin
--

COMMENT ON FUNCTION public.create_sales_return(_invoice_id uuid, _warehouse_id uuid, _customer_id uuid, _refund_method text, _note text, _items jsonb) IS 'P0-1: مرتجع مبيعات مربوط بفاتورته الأصلية — بنود مقفولة، كميات مرتجعة محسوبة، وسعر وضريبة من الفاتورة.';

--
-- Name: FUNCTION create_sales_return(_invoice_id uuid, _warehouse_id uuid, _customer_id uuid, _refund_method text, _note text, _items jsonb); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.create_sales_return(_invoice_id uuid, _warehouse_id uuid, _customer_id uuid, _refund_method text, _note text, _items jsonb) FROM PUBLIC;

GRANT ALL ON FUNCTION public.create_sales_return(_invoice_id uuid, _warehouse_id uuid, _customer_id uuid, _refund_method text, _note text, _items jsonb) TO service_role;

GRANT ALL ON FUNCTION public.create_sales_return(_invoice_id uuid, _warehouse_id uuid, _customer_id uuid, _refund_method text, _note text, _items jsonb) TO authenticated;


--
-- Name: FUNCTION create_stock_transfer(_from uuid, _to uuid, _note text, _items jsonb); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.create_stock_transfer(_from uuid, _to uuid, _note text, _items jsonb) FROM PUBLIC;

GRANT ALL ON FUNCTION public.create_stock_transfer(_from uuid, _to uuid, _note text, _items jsonb) TO service_role;

GRANT ALL ON FUNCTION public.create_stock_transfer(_from uuid, _to uuid, _note text, _items jsonb) TO authenticated;


--
-- Name: FUNCTION custody_adjustment(_customer_id uuid, _warehouse_id uuid, _item_id uuid, _bags_delta numeric, _kg_delta numeric, _reason text); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.custody_adjustment(_customer_id uuid, _warehouse_id uuid, _item_id uuid, _bags_delta numeric, _kg_delta numeric, _reason text) FROM PUBLIC;

GRANT ALL ON FUNCTION public.custody_adjustment(_customer_id uuid, _warehouse_id uuid, _item_id uuid, _bags_delta numeric, _kg_delta numeric, _reason text) TO service_role;


--
-- Name: FUNCTION custody_delivery(_customer_id uuid, _warehouse_id uuid, _lines jsonb, _notes text); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.custody_delivery(_customer_id uuid, _warehouse_id uuid, _lines jsonb, _notes text) FROM PUBLIC;

GRANT ALL ON FUNCTION public.custody_delivery(_customer_id uuid, _warehouse_id uuid, _lines jsonb, _notes text) TO service_role;

GRANT ALL ON FUNCTION public.custody_delivery(_customer_id uuid, _warehouse_id uuid, _lines jsonb, _notes text) TO authenticated;


--
-- Name: FUNCTION custody_grain_items(); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.custody_grain_items() FROM PUBLIC;

GRANT ALL ON FUNCTION public.custody_grain_items() TO authenticated;

GRANT ALL ON FUNCTION public.custody_grain_items() TO service_role;


--
-- Name: FUNCTION custody_intake(_customer_id uuid, _warehouse_id uuid, _item_id uuid, _bags numeric, _kg numeric, _notes text); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.custody_intake(_customer_id uuid, _warehouse_id uuid, _item_id uuid, _bags numeric, _kg numeric, _notes text) FROM PUBLIC;

GRANT ALL ON FUNCTION public.custody_intake(_customer_id uuid, _warehouse_id uuid, _item_id uuid, _bags numeric, _kg numeric, _notes text) TO service_role;

GRANT ALL ON FUNCTION public.custody_intake(_customer_id uuid, _warehouse_id uuid, _item_id uuid, _bags numeric, _kg numeric, _notes text) TO authenticated;


--
-- Name: FUNCTION custody_intake_multi(_customer_id uuid, _warehouse_id uuid, _lines jsonb, _notes text); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.custody_intake_multi(_customer_id uuid, _warehouse_id uuid, _lines jsonb, _notes text) FROM PUBLIC;

GRANT ALL ON FUNCTION public.custody_intake_multi(_customer_id uuid, _warehouse_id uuid, _lines jsonb, _notes text) TO authenticated;

GRANT ALL ON FUNCTION public.custody_intake_multi(_customer_id uuid, _warehouse_id uuid, _lines jsonb, _notes text) TO service_role;


--
-- Name: FUNCTION custody_link_invoice(_custody_entry_id uuid, _invoice_id uuid); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.custody_link_invoice(_custody_entry_id uuid, _invoice_id uuid) FROM PUBLIC;

GRANT ALL ON FUNCTION public.custody_link_invoice(_custody_entry_id uuid, _invoice_id uuid) TO service_role;

GRANT ALL ON FUNCTION public.custody_link_invoice(_custody_entry_id uuid, _invoice_id uuid) TO authenticated;



--
-- Name: FUNCTION custody_milling(_customer_id uuid, _warehouse_id uuid, _grain_item_id uuid, _bags_out numeric, _kg_out numeric, _outputs jsonb, _notes text); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.custody_milling(_customer_id uuid, _warehouse_id uuid, _grain_item_id uuid, _bags_out numeric, _kg_out numeric, _outputs jsonb, _notes text) FROM PUBLIC;

GRANT ALL ON FUNCTION public.custody_milling(_customer_id uuid, _warehouse_id uuid, _grain_item_id uuid, _bags_out numeric, _kg_out numeric, _outputs jsonb, _notes text) TO service_role;

GRANT ALL ON FUNCTION public.custody_milling(_customer_id uuid, _warehouse_id uuid, _grain_item_id uuid, _bags_out numeric, _kg_out numeric, _outputs jsonb, _notes text) TO authenticated;

--
-- Name: FUNCTION custody_milling(_customer_id uuid, _warehouse_id uuid, _grain_item_id uuid, _bags_out numeric, _kg_out numeric, _outputs jsonb, _notes text, _grain_type_id uuid); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.custody_milling(_customer_id uuid, _warehouse_id uuid, _grain_item_id uuid, _bags_out numeric, _kg_out numeric, _outputs jsonb, _notes text, _grain_type_id uuid) FROM PUBLIC;

GRANT ALL ON FUNCTION public.custody_milling(_customer_id uuid, _warehouse_id uuid, _grain_item_id uuid, _bags_out numeric, _kg_out numeric, _outputs jsonb, _notes text, _grain_type_id uuid) TO authenticated;

GRANT ALL ON FUNCTION public.custody_milling(_customer_id uuid, _warehouse_id uuid, _grain_item_id uuid, _bags_out numeric, _kg_out numeric, _outputs jsonb, _notes text, _grain_type_id uuid) TO service_role;


--
-- Name: FUNCTION custody_milling_multi(_customer_id uuid, _warehouse_id uuid, _grains jsonb, _outputs jsonb, _notes text); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.custody_milling_multi(_customer_id uuid, _warehouse_id uuid, _grains jsonb, _outputs jsonb, _notes text) FROM PUBLIC;

GRANT ALL ON FUNCTION public.custody_milling_multi(_customer_id uuid, _warehouse_id uuid, _grains jsonb, _outputs jsonb, _notes text) TO authenticated;

GRANT ALL ON FUNCTION public.custody_milling_multi(_customer_id uuid, _warehouse_id uuid, _grains jsonb, _outputs jsonb, _notes text) TO service_role;


--
-- Name: FUNCTION custody_output_items(); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.custody_output_items() FROM PUBLIC;

GRANT ALL ON FUNCTION public.custody_output_items() TO authenticated;

GRANT ALL ON FUNCTION public.custody_output_items() TO service_role;


--
-- Name: FUNCTION fn_next_document_number(p_document_type text, p_company_id uuid, p_branch_id uuid, p_pos_id uuid, p_at timestamp with time zone); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.fn_next_document_number(p_document_type text, p_company_id uuid, p_branch_id uuid, p_pos_id uuid, p_at timestamp with time zone) FROM PUBLIC;

GRANT ALL ON FUNCTION public.fn_next_document_number(p_document_type text, p_company_id uuid, p_branch_id uuid, p_pos_id uuid, p_at timestamp with time zone) TO service_role;


--
-- Name: FUNCTION fn_set_document_numbering(p_document_type text, p_prefix text, p_format_tokens text, p_padding smallint, p_date_part text, p_separator text, p_reset_policy text, p_next_value bigint); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.fn_set_document_numbering(p_document_type text, p_prefix text, p_format_tokens text, p_padding smallint, p_date_part text, p_separator text, p_reset_policy text, p_next_value bigint) FROM PUBLIC;

GRANT ALL ON FUNCTION public.fn_set_document_numbering(p_document_type text, p_prefix text, p_format_tokens text, p_padding smallint, p_date_part text, p_separator text, p_reset_policy text, p_next_value bigint) TO service_role;

GRANT ALL ON FUNCTION public.fn_set_document_numbering(p_document_type text, p_prefix text, p_format_tokens text, p_padding smallint, p_date_part text, p_separator text, p_reset_policy text, p_next_value bigint) TO authenticated;


--
-- Name: FUNCTION milling_document_delivery(_document_id uuid, _lines jsonb, _notes text); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.milling_document_delivery(_document_id uuid, _lines jsonb, _notes text) FROM PUBLIC;

GRANT ALL ON FUNCTION public.milling_document_delivery(_document_id uuid, _lines jsonb, _notes text) TO service_role;

GRANT ALL ON FUNCTION public.milling_document_delivery(_document_id uuid, _lines jsonb, _notes text) TO authenticated;


--
-- Name: FUNCTION milling_document_process(_document_id uuid, _grain_item_id uuid, _bags_out numeric, _kg_out numeric, _outputs jsonb, _notes text); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.milling_document_process(_document_id uuid, _grain_item_id uuid, _bags_out numeric, _kg_out numeric, _outputs jsonb, _notes text) FROM PUBLIC;

GRANT ALL ON FUNCTION public.milling_document_process(_document_id uuid, _grain_item_id uuid, _bags_out numeric, _kg_out numeric, _outputs jsonb, _notes text) TO service_role;


--
-- Name: FUNCTION milling_service_cost_report(p_date_from date, p_date_to date, p_cost_center_id uuid); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.milling_service_cost_report(p_date_from date, p_date_to date, p_cost_center_id uuid) FROM PUBLIC;

GRANT ALL ON FUNCTION public.milling_service_cost_report(p_date_from date, p_date_to date, p_cost_center_id uuid) TO authenticated;

GRANT ALL ON FUNCTION public.milling_service_cost_report(p_date_from date, p_date_to date, p_cost_center_id uuid) TO service_role;


--
-- Name: FUNCTION next_expense_reference(); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.next_expense_reference() FROM PUBLIC;

GRANT ALL ON FUNCTION public.next_expense_reference() TO service_role;


--
-- Name: FUNCTION next_invoice_number(); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.next_invoice_number() FROM PUBLIC;

GRANT ALL ON FUNCTION public.next_invoice_number() TO service_role;


--
-- Name: FUNCTION next_purchase_number(); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.next_purchase_number() FROM PUBLIC;

GRANT ALL ON FUNCTION public.next_purchase_number() TO service_role;


--
-- Name: FUNCTION next_purchase_return_number(); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.next_purchase_return_number() FROM PUBLIC;

GRANT ALL ON FUNCTION public.next_purchase_return_number() TO service_role;


--
-- Name: FUNCTION next_sales_return_number(); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.next_sales_return_number() FROM PUBLIC;

GRANT ALL ON FUNCTION public.next_sales_return_number() TO service_role;


--
-- Name: FUNCTION next_transfer_number(); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.next_transfer_number() FROM PUBLIC;

GRANT ALL ON FUNCTION public.next_transfer_number() TO service_role;


--
-- Name: FUNCTION product_delete_guard(p_product_id uuid); Type: COMMENT; Schema: public; Owner: supabase_admin
--

COMMENT ON FUNCTION public.product_delete_guard(p_product_id uuid) IS 'حذف صنف فقط إذا لم يرتبط بأي مستند أو عميل أو سجل مخزون. غير ذلك تُرجع referenced والواجهة تعرض إلغاء التنشيط.';

--
-- Name: FUNCTION product_delete_guard(p_product_id uuid); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.product_delete_guard(p_product_id uuid) FROM PUBLIC;

GRANT ALL ON FUNCTION public.product_delete_guard(p_product_id uuid) TO service_role;


--
-- Name: FUNCTION product_reference_counts(p_product_id uuid); Type: COMMENT; Schema: public; Owner: supabase_admin
--

COMMENT ON FUNCTION public.product_reference_counts(p_product_id uuid) IS 'عدد المراجع لكل صنف قبل الحذف. يشمل دفتر أمانات المطحنة (custody_ledger) وأي مفتاح خارجي آخر يشير إلى products(id).';

--
-- Name: FUNCTION product_reference_counts(p_product_id uuid); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.product_reference_counts(p_product_id uuid) FROM PUBLIC;

GRANT ALL ON FUNCTION public.product_reference_counts(p_product_id uuid) TO service_role;

GRANT ALL ON FUNCTION public.product_reference_counts(p_product_id uuid) TO authenticated;


--
-- Name: FUNCTION reject_custody_items_in_commercial_documents(); Type: COMMENT; Schema: public; Owner: supabase_admin
--

COMMENT ON FUNCTION public.reject_custody_items_in_commercial_documents() IS 'Defense in depth: prevents a mill custody item from entering a sales or purchase invoice.';

--
-- Name: purchase_invoice_items purchase_invoice_items_reject_custody_products; Type: TRIGGER; Schema: public; Owner: supabase_admin
--

CREATE TRIGGER purchase_invoice_items_reject_custody_products BEFORE INSERT OR UPDATE OF product_id ON public.purchase_invoice_items FOR EACH ROW EXECUTE FUNCTION public.reject_custody_items_in_commercial_documents();

--
-- Name: sales_invoice_items sales_invoice_items_reject_custody_products; Type: TRIGGER; Schema: public; Owner: supabase_admin
--

CREATE TRIGGER sales_invoice_items_reject_custody_products BEFORE INSERT OR UPDATE OF product_id ON public.sales_invoice_items FOR EACH ROW EXECUTE FUNCTION public.reject_custody_items_in_commercial_documents();

--
-- Name: FUNCTION reject_custody_items_in_commercial_documents(); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.reject_custody_items_in_commercial_documents() FROM PUBLIC;

GRANT ALL ON FUNCTION public.reject_custody_items_in_commercial_documents() TO service_role;

--
-- Name: custody_balance(uuid, uuid, uuid); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.custody_balance(_customer_id uuid, _warehouse_id uuid, _item_id uuid) RETURNS TABLE(bags numeric, kg numeric)
    LANGUAGE sql STABLE
    SET search_path TO 'public'
    AS $$
  SELECT coalesce(sum(bags_in - bags_out), 0) AS bags,
         coalesce(sum(kg_in - kg_out), 0) AS kg
  FROM public.custody_ledger
  WHERE customer_id = _customer_id
    AND warehouse_id = _warehouse_id
    AND item_id = _item_id
$$;


--
-- Name: custody_balances; Type: VIEW; Schema: public; Owner: supabase_admin
--

CREATE VIEW public.custody_balances WITH (security_invoker='true') AS
 SELECT l.customer_id,
    l.warehouse_id,
    l.item_id,
    p.sku,
    p.name_ar,
    p.item_class,
    sum((l.bags_in - l.bags_out)) AS bags_balance,
    sum((l.kg_in - l.kg_out)) AS kg_balance
   FROM (public.custody_ledger l
     JOIN public.products p ON ((p.id = l.item_id)))
  GROUP BY l.customer_id, l.warehouse_id, l.item_id, p.sku, p.name_ar, p.item_class;

--
-- Name: custody_customer_statement; Type: VIEW; Schema: public; Owner: supabase_admin
--

CREATE VIEW public.custody_customer_statement WITH (security_invoker='true') AS
 SELECT l.customer_id,
    c.name AS customer_name_ar,
    l.warehouse_id,
    w.name_ar AS warehouse_name_ar,
    l.item_id,
    p.sku,
    p.name_ar AS item_name_ar,
    p.item_class,
    sum(l.bags_in) AS received_bags,
    sum(l.kg_in) AS received_kg,
    sum(l.bags_out) AS issued_bags,
    sum(l.kg_out) AS issued_kg,
    sum((l.bags_in - l.bags_out)) AS remaining_bags,
    sum((l.kg_in - l.kg_out)) AS remaining_kg,
    max(l.created_at) AS last_movement_at
   FROM (((public.custody_ledger l
     JOIN public.products p ON ((p.id = l.item_id)))
     LEFT JOIN public.customers c ON ((c.id = l.customer_id)))
     LEFT JOIN public.warehouses w ON ((w.id = l.warehouse_id)))
  GROUP BY l.customer_id, c.name, l.warehouse_id, w.name_ar, l.item_id, p.sku, p.name_ar, p.item_class;

--
-- Name: custody_detected_loss; Type: VIEW; Schema: public; Owner: supabase_admin
--

CREATE VIEW public.custody_detected_loss WITH (security_invoker='true') AS
 WITH grain_flow AS (
         SELECT l.customer_id,
            l.warehouse_id,
            l.item_id,
            COALESCE((l.milling_document_id)::text, (l.doc_number)::text) AS operation_key,
            p.name_ar AS grain_name_ar,
            sum(l.kg_out) AS milled_kg,
            sum(l.bags_out) AS milled_bags
           FROM (public.custody_ledger l
             JOIN public.products p ON ((p.id = l.item_id)))
          WHERE ((l.entry_type = 'MILLING'::public.custody_entry_type) AND (p.item_class = 'RAW_MATERIAL'::public.item_class))
          GROUP BY l.customer_id, l.warehouse_id, l.item_id, COALESCE((l.milling_document_id)::text, (l.doc_number)::text), p.name_ar
        ), output_flow AS (
         SELECT l.customer_id,
            l.warehouse_id,
            COALESCE((l.milling_document_id)::text, (l.doc_number)::text) AS operation_key,
            sum(l.kg_in) AS produced_kg,
            sum(l.bags_in) AS produced_bags
           FROM (public.custody_ledger l
             JOIN public.products p ON ((p.id = l.item_id)))
          WHERE ((l.entry_type = 'MILLING'::public.custody_entry_type) AND (p.item_class = ANY (ARRAY['FINISHED_GOOD'::public.item_class, 'BY_PRODUCT'::public.item_class])))
          GROUP BY l.customer_id, l.warehouse_id, COALESCE((l.milling_document_id)::text, (l.doc_number)::text)
        )
 SELECT g.customer_id,
    c.name AS customer_name_ar,
    g.warehouse_id,
    w.name_ar AS warehouse_name_ar,
    g.item_id,
    g.grain_name_ar,
    g.operation_key,
    g.milled_bags,
    g.milled_kg,
    COALESCE(o.produced_bags, (0)::numeric) AS produced_bags,
    COALESCE(o.produced_kg, (0)::numeric) AS produced_kg,
    round((g.milled_kg - COALESCE(o.produced_kg, (0)::numeric)), 3) AS detected_loss_kg,
        CASE
            WHEN ((g.milled_kg > (0)::numeric) AND ((g.milled_kg - COALESCE(o.produced_kg, (0)::numeric)) > (g.milled_kg * 0.05))) THEN 'REVIEW'::text
            ELSE 'OK'::text
        END AS loss_status
   FROM (((grain_flow g
     LEFT JOIN output_flow o ON (((o.customer_id = g.customer_id) AND (o.warehouse_id = g.warehouse_id) AND (o.operation_key = g.operation_key))))
     LEFT JOIN public.customers c ON ((c.id = g.customer_id)))
     LEFT JOIN public.warehouses w ON ((w.id = g.warehouse_id)));

--
-- Name: custody_ledger custody_ledger_pkey; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.custody_ledger
    ADD CONSTRAINT custody_ledger_pkey PRIMARY KEY (id);

--
-- Name: idx_custody_created_entry; Type: INDEX; Schema: public; Owner: supabase_admin
--

CREATE INDEX idx_custody_created_entry ON public.custody_ledger USING btree (created_at DESC, entry_type);

--
-- Name: idx_custody_customer_item; Type: INDEX; Schema: public; Owner: supabase_admin
--

CREATE INDEX idx_custody_customer_item ON public.custody_ledger USING btree (customer_id, item_id);

--
-- Name: idx_custody_customer_wh_item; Type: INDEX; Schema: public; Owner: supabase_admin
--

CREATE INDEX idx_custody_customer_wh_item ON public.custody_ledger USING btree (customer_id, warehouse_id, item_id);

--
-- Name: idx_custody_doc_number; Type: INDEX; Schema: public; Owner: supabase_admin
--

CREATE INDEX idx_custody_doc_number ON public.custody_ledger USING btree (doc_number);

--
-- Name: idx_custody_entry_type; Type: INDEX; Schema: public; Owner: supabase_admin
--

CREATE INDEX idx_custody_entry_type ON public.custody_ledger USING btree (entry_type, created_at DESC);

--
-- Name: idx_custody_invoice; Type: INDEX; Schema: public; Owner: supabase_admin
--

CREATE INDEX idx_custody_invoice ON public.custody_ledger USING btree (service_invoice_id) WHERE (service_invoice_id IS NOT NULL);

--
-- Name: idx_custody_milling_document; Type: INDEX; Schema: public; Owner: supabase_admin
--

CREATE INDEX idx_custody_milling_document ON public.custody_ledger USING btree (milling_document_id, created_at DESC) WHERE (milling_document_id IS NOT NULL);

--
-- Name: idx_custody_source; Type: INDEX; Schema: public; Owner: supabase_admin
--

CREATE INDEX idx_custody_source ON public.custody_ledger USING btree (source_type, source_id) WHERE (source_id IS NOT NULL);

--
-- Name: idx_custody_warehouse; Type: INDEX; Schema: public; Owner: supabase_admin
--

CREATE INDEX idx_custody_warehouse ON public.custody_ledger USING btree (warehouse_id, created_at DESC);

--
-- Name: custody_ledger custody_capture_milling_service_estimate; Type: TRIGGER; Schema: public; Owner: supabase_admin
--

CREATE TRIGGER custody_capture_milling_service_estimate AFTER INSERT ON public.custody_ledger FOR EACH ROW WHEN (((new.entry_type = 'INTAKE'::public.custody_entry_type) AND (new.milling_document_id IS NOT NULL))) EXECUTE FUNCTION public.capture_milling_service_estimate_from_intake();

--
-- Name: custody_ledger; Type: ROW SECURITY; Schema: public; Owner: supabase_admin
--

ALTER TABLE public.custody_ledger ENABLE ROW LEVEL SECURITY;

--
-- Name: custody_ledger custody_ledger_read; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY custody_ledger_read ON public.custody_ledger FOR SELECT TO authenticated USING (public.can_view_milling());

--
-- Name: custody_ledger custody_ledger_service_all; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY custody_ledger_service_all ON public.custody_ledger TO service_role USING (true) WITH CHECK (true);

--
-- Name: TABLE custody_ledger; Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.custody_ledger TO service_role;

GRANT SELECT ON TABLE public.custody_ledger TO authenticated;


--
-- Name: COLUMN milling_service_documents.billing_basis; Type: COMMENT; Schema: public; Owner: supabase_admin
--

COMMENT ON COLUMN public.milling_service_documents.billing_basis IS 'P1-1: أساس التسعير — PER_BAG (أجرة الكيس × عدد الأكياس) أو PER_KG (أجرة الكيلو × الوزن).';

--
-- Name: COLUMN milling_service_documents.fee_per_unit; Type: COMMENT; Schema: public; Owner: supabase_admin
--

COMMENT ON COLUMN public.milling_service_documents.fee_per_unit IS 'P1-1: سعر الوحدة المتعاقد عليه (للكيس أو للكيلو) في هذا المستند.';

--
-- Name: COLUMN milling_service_documents.fee_quantity; Type: COMMENT; Schema: public; Owner: supabase_admin
--

COMMENT ON COLUMN public.milling_service_documents.fee_quantity IS 'P1-1: الكمية المسعّرة (عدد الأكياس أو الكيلوجرامات) التي ضُربت في fee_per_unit.';

--
-- Name: COLUMN milling_service_documents.estimated_cost_rate; Type: COMMENT; Schema: public; Owner: supabase_admin
--

COMMENT ON COLUMN public.milling_service_documents.estimated_cost_rate IS 'Snapshot of the service product cost_price per its configured base unit. Analytic estimate only; it never posts to the ledger.';

--
-- Name: COLUMN milling_service_documents.estimated_cost_amount; Type: COMMENT; Schema: public; Owner: supabase_admin
--

COMMENT ON COLUMN public.milling_service_documents.estimated_cost_amount IS 'Estimated cost snapshot for this customer service document; actual service expenses remain ordinary expenses.';

--
-- Name: custody_service_money; Type: VIEW; Schema: public; Owner: supabase_admin
--

CREATE VIEW public.custody_service_money WITH (security_invoker='true') AS
 SELECT d.id AS custody_entry_id,
    d.customer_id,
    c.name AS customer_name_ar,
    d.document_number AS doc_number,
    d.created_at,
    si.id AS invoice_id,
    si.invoice_number,
    si.status,
    si.subtotal,
    si.tax,
    si.discount,
    si.total,
    si.paid,
    round((si.total - si.paid), 2) AS outstanding
   FROM ((public.milling_service_documents d
     JOIN public.sales_invoices si ON ((si.id = d.sales_invoice_id)))
     LEFT JOIN public.customers c ON ((c.id = d.customer_id)))
UNION ALL
 SELECT l.id AS custody_entry_id,
    l.customer_id,
    c.name AS customer_name_ar,
    l.doc_number,
    l.created_at,
    si.id AS invoice_id,
    si.invoice_number,
    si.status,
    si.subtotal,
    si.tax,
    si.discount,
    si.total,
    si.paid,
    round((si.total - si.paid), 2) AS outstanding
   FROM ((public.custody_ledger l
     JOIN public.sales_invoices si ON ((si.id = l.service_invoice_id)))
     LEFT JOIN public.customers c ON ((c.id = l.customer_id)))
  WHERE (NOT (EXISTS ( SELECT 1
           FROM public.milling_service_documents d
          WHERE (d.sales_invoice_id = l.service_invoice_id))));

--
-- Name: milling_service_documents milling_service_documents_invoice_key; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.milling_service_documents
    ADD CONSTRAINT milling_service_documents_invoice_key UNIQUE (sales_invoice_id);

--
-- Name: milling_service_documents milling_service_documents_number_key; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.milling_service_documents
    ADD CONSTRAINT milling_service_documents_number_key UNIQUE (document_number);

--
-- Name: milling_service_documents milling_service_documents_pkey; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.milling_service_documents
    ADD CONSTRAINT milling_service_documents_pkey PRIMARY KEY (id);

--
-- Name: idx_milling_service_documents_customer; Type: INDEX; Schema: public; Owner: supabase_admin
--

CREATE INDEX idx_milling_service_documents_customer ON public.milling_service_documents USING btree (customer_id, received_at DESC);

--
-- Name: milling_service_documents; Type: ROW SECURITY; Schema: public; Owner: supabase_admin
--

ALTER TABLE public.milling_service_documents ENABLE ROW LEVEL SECURITY;

--
-- Name: milling_service_documents milling_service_documents_read; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY milling_service_documents_read ON public.milling_service_documents FOR SELECT TO authenticated USING (public.can_view_milling());

--
-- Name: milling_service_documents milling_service_documents_service_all; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY milling_service_documents_service_all ON public.milling_service_documents TO service_role USING (true) WITH CHECK (true);

--
-- Name: TABLE milling_service_documents; Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.milling_service_documents TO service_role;

GRANT SELECT ON TABLE public.milling_service_documents TO authenticated;


--
-- Name: SEQUENCE milling_delivery_seq; Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT USAGE ON SEQUENCE public.milling_delivery_seq TO service_role;

GRANT SELECT,USAGE ON SEQUENCE public.milling_delivery_seq TO authenticated;


--
-- Name: SEQUENCE milling_document_seq; Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT USAGE ON SEQUENCE public.milling_document_seq TO service_role;

GRANT SELECT,USAGE ON SEQUENCE public.milling_document_seq TO authenticated;


--
-- Name: SEQUENCE milling_intake_seq; Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT USAGE ON SEQUENCE public.milling_intake_seq TO service_role;

GRANT SELECT,USAGE ON SEQUENCE public.milling_intake_seq TO authenticated;


--
-- Name: TABLE milling_margin_report; Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT SELECT ON TABLE public.milling_margin_report TO authenticated;

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.milling_margin_report TO service_role;

--
-- Name: fn_document_numbering_sequence_name(text); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.fn_document_numbering_sequence_name(p_document_type text) RETURNS text
    LANGUAGE sql IMMUTABLE
    SET search_path TO 'public'
    AS $$
  SELECT CASE p_document_type
    WHEN 'sales_invoice'      THEN 'public.sales_invoice_seq'
    WHEN 'purchase_invoice'   THEN 'public.purchase_invoice_seq'
    WHEN 'sales_return'       THEN 'public.sales_return_seq'
    WHEN 'purchase_return'    THEN 'public.purchase_return_seq'
    WHEN 'stock_transfer'     THEN 'public.stock_transfer_seq'
    WHEN 'expense'            THEN 'public.expense_reference_seq'
    WHEN 'quotation'          THEN 'public.quotation_seq'
    WHEN 'purchase_order'     THEN 'public.purchase_order_seq'
    WHEN 'goods_receipt'      THEN 'public.goods_receipt_seq'
    WHEN 'sales_order'        THEN 'public.sales_order_seq'
    WHEN 'customer_payment'   THEN 'public.customer_payment_seq'
    WHEN 'supplier_payment'   THEN 'public.supplier_payment_seq'
    WHEN 'stock_adjustment'   THEN 'public.stock_adjustment_seq'
    WHEN 'milling_intake'     THEN 'public.milling_intake_seq'
    WHEN 'milling_service'    THEN 'public.milling_service_seq'
    WHEN 'journal_entry'      THEN 'public.journal_entry_seq'
    ELSE NULL
  END;
$$;


--
-- Name: SEQUENCE milling_service_seq; Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT USAGE ON SEQUENCE public.milling_service_seq TO service_role;

GRANT SELECT,USAGE ON SEQUENCE public.milling_service_seq TO authenticated;


--
-- Name: FUNCTION create_purchase(_warehouse_id uuid, _supplier_id uuid, _payment_method text, _paid numeric, _discount numeric, _note text, _items jsonb); Type: COMMENT; Schema: public; Owner: supabase_admin
--

COMMENT ON FUNCTION public.create_purchase(_warehouse_id uuid, _supplier_id uuid, _payment_method text, _paid numeric, _discount numeric, _note text, _items jsonb) IS 'T-06: إنشاء فاتورة مشتريات وترحيلها تلقائيًا للأستاذ في نفس المعاملة.';



--
-- Name: FUNCTION create_purchase(_warehouse_id uuid, _supplier_id uuid, _payment_method text, _paid numeric, _discount numeric, _note text, _items jsonb); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.create_purchase(_warehouse_id uuid, _supplier_id uuid, _payment_method text, _paid numeric, _discount numeric, _note text, _items jsonb) FROM PUBLIC;

GRANT ALL ON FUNCTION public.create_purchase(_warehouse_id uuid, _supplier_id uuid, _payment_method text, _paid numeric, _discount numeric, _note text, _items jsonb) TO service_role;

GRANT ALL ON FUNCTION public.create_purchase(_warehouse_id uuid, _supplier_id uuid, _payment_method text, _paid numeric, _discount numeric, _note text, _items jsonb) TO authenticated;

--
-- Name: FUNCTION create_purchase(_warehouse_id uuid, _supplier_id uuid, _payment_method text, _paid numeric, _discount numeric, _note text, _items jsonb, _payment_splits jsonb); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.create_purchase(_warehouse_id uuid, _supplier_id uuid, _payment_method text, _paid numeric, _discount numeric, _note text, _items jsonb, _payment_splits jsonb) FROM PUBLIC;

GRANT ALL ON FUNCTION public.create_purchase(_warehouse_id uuid, _supplier_id uuid, _payment_method text, _paid numeric, _discount numeric, _note text, _items jsonb, _payment_splits jsonb) TO authenticated;

GRANT ALL ON FUNCTION public.create_purchase(_warehouse_id uuid, _supplier_id uuid, _payment_method text, _paid numeric, _discount numeric, _note text, _items jsonb, _payment_splits jsonb) TO service_role;

--
-- Name: FUNCTION create_purchase(_warehouse_id uuid, _supplier_id uuid, _payment_method text, _paid numeric, _discount numeric, _note text, _items jsonb, _cashbox_id uuid, _bank_account_id uuid, _payment_reference text, _payment_method_id text); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.create_purchase(_warehouse_id uuid, _supplier_id uuid, _payment_method text, _paid numeric, _discount numeric, _note text, _items jsonb, _cashbox_id uuid, _bank_account_id uuid, _payment_reference text, _payment_method_id text) FROM PUBLIC;

GRANT ALL ON FUNCTION public.create_purchase(_warehouse_id uuid, _supplier_id uuid, _payment_method text, _paid numeric, _discount numeric, _note text, _items jsonb, _cashbox_id uuid, _bank_account_id uuid, _payment_reference text, _payment_method_id text) TO service_role;

GRANT ALL ON FUNCTION public.create_purchase(_warehouse_id uuid, _supplier_id uuid, _payment_method text, _paid numeric, _discount numeric, _note text, _items jsonb, _cashbox_id uuid, _bank_account_id uuid, _payment_reference text, _payment_method_id text) TO authenticated;


--
-- Name: FUNCTION custody_balance(_customer_id uuid, _warehouse_id uuid, _item_id uuid); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.custody_balance(_customer_id uuid, _warehouse_id uuid, _item_id uuid) FROM PUBLIC;

GRANT ALL ON FUNCTION public.custody_balance(_customer_id uuid, _warehouse_id uuid, _item_id uuid) TO service_role;


--
-- Name: TABLE custody_balances; Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT SELECT ON TABLE public.custody_balances TO authenticated;

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.custody_balances TO service_role;


--
-- Name: TABLE custody_customer_statement; Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT SELECT ON TABLE public.custody_customer_statement TO authenticated;

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.custody_customer_statement TO service_role;


--
-- Name: TABLE custody_detected_loss; Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT SELECT ON TABLE public.custody_detected_loss TO authenticated;

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.custody_detected_loss TO service_role;


--
-- Name: TABLE custody_service_money; Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT SELECT ON TABLE public.custody_service_money TO authenticated;

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.custody_service_money TO service_role;


--
-- Name: FUNCTION fn_document_numbering_sequence_name(p_document_type text); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.fn_document_numbering_sequence_name(p_document_type text) FROM PUBLIC;

GRANT ALL ON FUNCTION public.fn_document_numbering_sequence_name(p_document_type text) TO service_role;

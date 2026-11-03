BEGIN;

-- Financial reads are finance-role data, not general staff data.
DROP POLICY IF EXISTS "accounts_read" ON public.accounts;
CREATE POLICY accounts_read_finance ON public.accounts
  FOR SELECT TO authenticated
  USING (public.can_read_finance(auth.uid()));

DROP POLICY IF EXISTS "customer_ledger_view" ON public.customer_ledger;
CREATE POLICY customer_ledger_view_finance ON public.customer_ledger
  FOR SELECT TO authenticated
  USING (public.can_read_finance(auth.uid()));

DROP POLICY IF EXISTS "staff_view_customer_payments" ON public.customer_payments;
CREATE POLICY customer_payments_view_finance ON public.customer_payments
  FOR SELECT TO authenticated
  USING (public.can_read_finance(auth.uid()) OR public.has_role(auth.uid(), 'cashier'));

DROP POLICY IF EXISTS "journal_read" ON public.journal_entries;
CREATE POLICY journal_read_finance ON public.journal_entries
  FOR SELECT TO authenticated
  USING (public.can_read_finance(auth.uid()));

DROP POLICY IF EXISTS "journal_lines_read" ON public.journal_lines;
CREATE POLICY journal_lines_read_finance ON public.journal_lines
  FOR SELECT TO authenticated
  USING (public.can_read_finance(auth.uid()));

DROP POLICY IF EXISTS cost_tx_read ON public.item_cost_transactions;
CREATE POLICY cost_tx_read_finance ON public.item_cost_transactions
  FOR SELECT TO authenticated
  USING (
    public.can_read_finance(auth.uid())
    AND ((owner_type = 'COMPANY'::owner_type) OR (owner_id = auth.uid()))
  );

DROP POLICY IF EXISTS opening_bal_read ON public.opening_balance_documents;
CREATE POLICY opening_bal_read_finance ON public.opening_balance_documents
  FOR SELECT TO authenticated
  USING (public.can_read_finance(auth.uid()));

DROP POLICY IF EXISTS opening_bal_lines_read ON public.opening_balance_lines;
CREATE POLICY opening_bal_lines_read_finance ON public.opening_balance_lines
  FOR SELECT TO authenticated
  USING (public.can_read_finance(auth.uid()));

ALTER VIEW public.opening_balance_summary SET (security_invoker = true);

-- Supplier ledger writes and reads are available through finance roles only;
-- trusted SECURITY DEFINER posting functions remain able to maintain the ledger.
DROP POLICY IF EXISTS supplier_ledger_read_all ON public.supplier_ledger;
DROP POLICY IF EXISTS supplier_ledger_insert_auth ON public.supplier_ledger;
DROP POLICY IF EXISTS supplier_ledger_update_auth ON public.supplier_ledger;
CREATE POLICY supplier_ledger_read_finance ON public.supplier_ledger
  FOR SELECT TO authenticated
  USING (public.can_read_finance(auth.uid()));

DROP POLICY IF EXISTS "supplier_payments_read_auth" ON public.supplier_payments;
DROP POLICY IF EXISTS supplier_payments_read_all ON public.supplier_payments;
CREATE POLICY supplier_payments_read_finance ON public.supplier_payments
  FOR SELECT TO authenticated
  USING (public.can_read_finance(auth.uid()));

CREATE OR REPLACE FUNCTION public.get_supplier_statement(
  p_supplier_id uuid,
  p_start_date timestamptz DEFAULT NULL,
  p_end_date timestamptz DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  occurred_at timestamptz,
  entry_type text,
  debit numeric,
  credit numeric,
  running_balance numeric,
  reference_type text,
  reference_id uuid,
  due_date date,
  note text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.can_read_finance(auth.uid()) THEN
    RAISE EXCEPTION 'Only finance roles may read supplier statements'
      USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    WITH ordered_entries AS (
      SELECT sl.id, sl.occurred_at, sl.entry_type, sl.debit, sl.credit,
        SUM(sl.credit - sl.debit) OVER (ORDER BY sl.occurred_at ASC, sl.id ASC) AS running_balance,
        sl.reference_type, sl.reference_id, sl.due_date, sl.note
      FROM public.supplier_ledger sl
      WHERE sl.supplier_id = p_supplier_id
    )
    SELECT oe.id, oe.occurred_at, oe.entry_type, oe.debit, oe.credit, oe.running_balance,
      oe.reference_type, oe.reference_id, oe.due_date, oe.note
    FROM ordered_entries oe
    WHERE (p_start_date IS NULL OR oe.occurred_at >= p_start_date)
      AND (p_end_date IS NULL OR oe.occurred_at <= p_end_date)
    ORDER BY oe.occurred_at DESC, oe.id DESC;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_supplier_statement(uuid, timestamptz, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_supplier_statement(uuid, timestamptz, timestamptz)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.get_supplier_statement(uuid, timestamptz, timestamptz)
  TO authenticated;

-- The seven-argument journal API is the internal system-posting entry point.
-- Trusted SECURITY DEFINER business RPCs call the seven-argument function as owner.
REVOKE EXECUTE ON FUNCTION public.create_journal_entry(text, date, text, uuid, boolean, jsonb, boolean)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.reverse_journal_entry(uuid, text)
  FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE FUNCTION public.reverse_journal_entry(p_entry_id uuid, p_reason text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_old record;
  v_id uuid;
BEGIN
  IF v_user IS NULL OR NOT (public.has_role(v_user, 'owner') OR public.has_role(v_user, 'manager')
      OR public.has_role(v_user, 'accountant')) THEN
    RAISE EXCEPTION 'Only an owner, manager or accountant may reverse journal entries';
  END IF;
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'Reversing an entry requires a reason';
  END IF;
  SELECT * INTO v_old FROM public.journal_entries WHERE id = p_entry_id FOR UPDATE;
  IF NOT FOUND OR v_old.status <> 'POSTED' THEN
    RAISE EXCEPTION 'Only a posted entry can be reversed';
  END IF;

  SELECT public.create_journal_entry(
    'عكس القيد ' || v_old.entry_number || ': ' || btrim(p_reason),
    CURRENT_DATE, 'journal_reversal', p_entry_id, v_old.is_system,
    (SELECT coalesce(jsonb_agg(jsonb_build_object(
      'account_code', a.code,
      'debit', CASE WHEN jl.debit > 0 THEN 0 ELSE jl.credit END,
      'credit', CASE WHEN jl.debit > 0 THEN jl.debit ELSE 0 END,
      'memo', coalesce(jl.memo, a.name_ar)
    ) ORDER BY jl.id), '[]'::jsonb)
    FROM public.journal_lines jl JOIN public.accounts a ON a.id = jl.account_id
    WHERE jl.entry_id = p_entry_id),
    true
  ) INTO v_id;

  UPDATE public.journal_entries SET status = 'REVERSED' WHERE id = p_entry_id;
  RETURN v_id;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.reverse_journal_entry(uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.create_opening_balance(
  _effective_date date,
  _lines jsonb,
  _notes text DEFAULT NULL::text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_id uuid;
  v_num text;
  l jsonb;
  v_side text;
  v_section text;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT (public.has_role(v_user, 'owner') OR public.has_role(v_user, 'manager')
          OR public.has_role(v_user, 'accountant')) THEN
    RAISE EXCEPTION 'Only an owner, manager or accountant may open the books';
  END IF;
  IF _effective_date IS NULL THEN
    RAISE EXCEPTION 'Effective date is required';
  END IF;
  IF _lines IS NULL OR jsonb_typeof(_lines) <> 'array' OR jsonb_array_length(_lines) = 0 THEN
    RAISE EXCEPTION 'An opening entry needs at least one line';
  END IF;

  v_num := 'OB-' || to_char(_effective_date, 'YYYYMMDD') || '-' ||
           lpad(nextval('public.opening_balance_seq')::text, 3, '0');
  INSERT INTO public.opening_balance_documents
    (document_number, effective_date, status, fiscal_year, notes, created_by)
  VALUES
    (v_num, _effective_date, 'DRAFT', EXTRACT(YEAR FROM _effective_date)::int,
     nullif(btrim(coalesce(_notes, '')), ''), v_user)
  RETURNING id INTO v_id;

  FOR l IN SELECT * FROM jsonb_array_elements(_lines)
  LOOP
    v_section := l->>'section';
    IF v_section NOT IN ('STOCK','RECEIVABLE','PAYABLE','CASH','BANK','ASSET','LIABILITY','CAPITAL') THEN
      RAISE EXCEPTION 'Unknown opening section: %', v_section;
    END IF;
    v_side := CASE WHEN v_section IN ('STOCK','RECEIVABLE','CASH','BANK','ASSET')
                   THEN 'DEBIT' ELSE 'CREDIT' END;
    IF coalesce((l->>'amount')::numeric, 0) <= 0 THEN
      RAISE EXCEPTION 'Line amount must be greater than zero (section %)', v_section;
    END IF;
    IF v_section = 'STOCK' AND ((l->>'product_id') IS NULL OR (l->>'warehouse_id') IS NULL
       OR coalesce((l->>'quantity')::numeric, 0) <= 0) THEN
      RAISE EXCEPTION 'Stock opening line requires an item, warehouse and positive quantity';
    END IF;
    IF v_section = 'RECEIVABLE' AND (l->>'customer_id') IS NULL THEN
      RAISE EXCEPTION 'Receivable opening line requires a customer';
    END IF;
    IF v_section = 'PAYABLE' AND (l->>'supplier_id') IS NULL THEN
      RAISE EXCEPTION 'Payable opening line requires a supplier';
    END IF;

    INSERT INTO public.opening_balance_lines
      (document_id, section, side, ref_type, ref_id, product_id, warehouse_id,
       customer_id, supplier_id, description, quantity, unit_cost, amount, ledger_account_code)
    VALUES
      (v_id, v_section, v_side, l->>'ref_type', (l->>'ref_id')::uuid,
       (l->>'product_id')::uuid, (l->>'warehouse_id')::uuid,
       (l->>'customer_id')::uuid, (l->>'supplier_id')::uuid,
       coalesce(nullif(btrim(coalesce(l->>'description', '')), ''), v_section),
       (l->>'quantity')::numeric, (l->>'unit_cost')::numeric,
       (l->>'amount')::numeric, nullif(btrim(l->>'ledger_account_code'), ''));
  END LOOP;
  RETURN v_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_opening_balance(
  _document_id uuid,
  _effective_date date,
  _lines jsonb,
  _notes text DEFAULT NULL::text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_doc record;
  l jsonb;
  v_section text;
  v_side text;
BEGIN
  IF v_user IS NULL OR NOT (public.has_role(v_user, 'owner') OR public.has_role(v_user, 'manager')
      OR public.has_role(v_user, 'accountant')) THEN
    RAISE EXCEPTION 'Only an owner, manager or accountant may edit opening balances';
  END IF;
  IF _effective_date IS NULL THEN RAISE EXCEPTION 'Effective date is required'; END IF;
  IF _lines IS NULL OR jsonb_typeof(_lines) <> 'array' OR jsonb_array_length(_lines) = 0 THEN
    RAISE EXCEPTION 'An opening entry needs at least one line';
  END IF;

  SELECT * INTO v_doc FROM public.opening_balance_documents WHERE id = _document_id FOR UPDATE;
  IF NOT FOUND OR v_doc.status <> 'DRAFT' THEN
    RAISE EXCEPTION 'Only a draft opening document can be edited';
  END IF;

  UPDATE public.opening_balance_documents
    SET effective_date = _effective_date,
        fiscal_year = EXTRACT(YEAR FROM _effective_date)::int,
        notes = nullif(btrim(coalesce(_notes, '')), '')
    WHERE id = _document_id;
  DELETE FROM public.opening_balance_lines WHERE document_id = _document_id;

  FOR l IN SELECT * FROM jsonb_array_elements(_lines)
  LOOP
    v_section := l->>'section';
    IF v_section NOT IN ('STOCK','RECEIVABLE','PAYABLE','CASH','BANK','ASSET','LIABILITY','CAPITAL') THEN
      RAISE EXCEPTION 'Unknown opening section: %', v_section;
    END IF;
    v_side := CASE WHEN v_section IN ('STOCK','RECEIVABLE','CASH','BANK','ASSET')
                   THEN 'DEBIT' ELSE 'CREDIT' END;
    IF coalesce((l->>'amount')::numeric, 0) <= 0 THEN
      RAISE EXCEPTION 'Line amount must be greater than zero (section %)', v_section;
    END IF;
    IF v_section = 'STOCK' AND ((l->>'product_id') IS NULL OR (l->>'warehouse_id') IS NULL
       OR coalesce((l->>'quantity')::numeric, 0) <= 0) THEN
      RAISE EXCEPTION 'Stock opening line requires an item, warehouse and positive quantity';
    END IF;
    IF v_section = 'RECEIVABLE' AND (l->>'customer_id') IS NULL THEN
      RAISE EXCEPTION 'Receivable opening line requires a customer';
    END IF;
    IF v_section = 'PAYABLE' AND (l->>'supplier_id') IS NULL THEN
      RAISE EXCEPTION 'Payable opening line requires a supplier';
    END IF;

    INSERT INTO public.opening_balance_lines
      (document_id, section, side, ref_type, ref_id, product_id, warehouse_id,
       customer_id, supplier_id, description, quantity, unit_cost, amount, ledger_account_code)
    VALUES
      (_document_id, v_section, v_side, l->>'ref_type', (l->>'ref_id')::uuid,
       (l->>'product_id')::uuid, (l->>'warehouse_id')::uuid,
       (l->>'customer_id')::uuid, (l->>'supplier_id')::uuid,
       coalesce(nullif(btrim(coalesce(l->>'description', '')), ''), v_section),
       (l->>'quantity')::numeric, (l->>'unit_cost')::numeric,
       (l->>'amount')::numeric, nullif(btrim(l->>'ledger_account_code'), ''));
  END LOOP;
  RETURN _document_id;
END;
$function$;
GRANT EXECUTE ON FUNCTION public.update_opening_balance(uuid, date, jsonb, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.post_opening_balance(_document_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_doc record;
  v_debit numeric;
  v_credit numeric;
  v_capital numeric;
  v_lines jsonb := '[]'::jsonb;
  v_journal uuid;
  v_account text;
  v_balance numeric;
  l record;
BEGIN
  IF v_user IS NULL OR NOT (public.has_role(v_user, 'owner') OR public.has_role(v_user, 'manager')
      OR public.has_role(v_user, 'accountant')) THEN
    RAISE EXCEPTION 'Only an owner, manager or accountant may post opening balances';
  END IF;
  SELECT * INTO v_doc FROM public.opening_balance_documents WHERE id = _document_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Opening document not found'; END IF;
  IF v_doc.status <> 'DRAFT' THEN
    RAISE EXCEPTION 'Document % is already %', v_doc.document_number, v_doc.status;
  END IF;

  SELECT coalesce(sum(amount) FILTER (WHERE side = 'DEBIT'), 0),
         coalesce(sum(amount) FILTER (WHERE side = 'CREDIT'), 0),
         coalesce(sum(amount) FILTER (WHERE section = 'CAPITAL'), 0)
    INTO v_debit, v_credit, v_capital
    FROM public.opening_balance_lines WHERE document_id = _document_id;
  IF v_debit <> v_credit THEN
    RAISE EXCEPTION 'Opening entry does not balance: debits % vs credits % (difference %).',
      round(v_debit, 2)::text, round(v_credit, 2)::text, round(v_debit - v_credit, 2)::text;
  END IF;

  FOR l IN SELECT * FROM public.opening_balance_lines WHERE document_id = _document_id ORDER BY id
  LOOP
    IF l.section = 'STOCK' THEN
      PERFORM public.post_stock_delta(
        p_product_id => l.product_id, p_warehouse_id => l.warehouse_id,
        p_signed_qty => l.quantity, p_unit_cost => coalesce(l.unit_cost, 0),
        p_movement_kind => 'OPENING', p_movement_type_legacy => 'opening',
        p_source_type => 'opening_balance', p_source_id => _document_id,
        p_note => 'رصيد افتتاحي ' || v_doc.document_number,
        p_owner_type => 'COMPANY', p_owner_id => NULL);
      PERFORM public.apply_cost_movement(
        p_product_id => l.product_id, p_warehouse_id => l.warehouse_id,
        p_signed_qty => l.quantity, p_incoming_cost => l.unit_cost,
        p_source_type => 'opening_balance', p_source_id => _document_id,
        p_note => 'رصيد افتتاحي ' || v_doc.document_number);
      SELECT coalesce(l.ledger_account_code,
        CASE p.item_class WHEN 'RAW_MATERIAL' THEN '1311' WHEN 'BY_PRODUCT' THEN '1314' ELSE '1313' END)
        INTO v_account FROM public.products p WHERE p.id = l.product_id;
      v_lines := v_lines || jsonb_build_object('account_code', v_account,
        'debit', round(l.amount, 2), 'memo', 'رصيد افتتاحي — ' || l.description);

    ELSIF l.section = 'RECEIVABLE' THEN
      INSERT INTO public.customer_ledger
        (customer_id, entry_type, debit, credit, reference_id, reference_type, occurred_at, created_by, note)
      VALUES (l.customer_id, 'adjustment', l.amount, 0, _document_id, 'opening_balance',
        v_doc.effective_date::timestamptz, v_user, 'رصيد افتتاحي ' || v_doc.document_number);
      v_lines := v_lines || jsonb_build_object('account_code', coalesce(l.ledger_account_code, '1211'),
        'debit', round(l.amount, 2), 'memo', 'رصيد افتتاحي — ' || l.description);

    ELSIF l.section = 'PAYABLE' THEN
      UPDATE public.suppliers SET balance = coalesce(balance, 0) + l.amount WHERE id = l.supplier_id;
      SELECT balance INTO v_balance FROM public.suppliers WHERE id = l.supplier_id;
      INSERT INTO public.supplier_ledger
        (supplier_id, entry_type, debit, credit, balance_after, reference_type, reference_id,
         occurred_at, source_key, note, created_by)
      VALUES (l.supplier_id, 'OPENING_BALANCE', 0, l.amount, v_balance, 'opening_balance', _document_id,
        v_doc.effective_date::timestamptz, 'OB-' || _document_id::text || '-' || l.id::text,
        'رصيد افتتاحي ' || v_doc.document_number, v_user)
      ON CONFLICT (source_key) DO NOTHING;
      v_lines := v_lines || jsonb_build_object('account_code', coalesce(l.ledger_account_code, '2111'),
        'credit', round(l.amount, 2), 'memo', 'رصيد افتتاحي — ' || l.description);

    ELSE
      v_account := coalesce(l.ledger_account_code,
        CASE l.section WHEN 'CASH' THEN '1101' WHEN 'BANK' THEN '1111'
          WHEN 'ASSET' THEN '1411' WHEN 'LIABILITY' THEN '2111' WHEN 'CAPITAL' THEN '3111' END);
      IF v_account IS NULL THEN RAISE EXCEPTION 'No ledger account mapping for %', l.section; END IF;
      v_lines := v_lines || jsonb_build_object('account_code', v_account,
        CASE WHEN l.side = 'DEBIT' THEN 'debit' ELSE 'credit' END,
        round(l.amount, 2), 'memo', 'رصيد افتتاحي — ' || l.description);
    END IF;
  END LOOP;

  v_journal := public.create_journal_entry(
    'رصيد افتتاحي ' || v_doc.document_number, v_doc.effective_date,
    'opening_balance', _document_id, true, v_lines);

  UPDATE public.opening_balance_documents
    SET total_assets = v_debit, total_liabilities = v_credit - v_capital,
        capital_required = v_debit - v_credit + v_capital,
        status = 'POSTED', posted_by = v_user, posted_at = now()
    WHERE id = _document_id;
  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, payload)
  VALUES (v_user, 'opening_balance.posted', 'opening_balance', _document_id,
    jsonb_build_object('document_number', v_doc.document_number, 'debits', v_debit,
      'credits', v_credit, 'journal_entry_id', v_journal));
  RETURN _document_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.reverse_opening_balance(_document_id uuid, _reason text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_doc record;
  v_new uuid;
  v_journal uuid;
  v_balance numeric;
  l record;
BEGIN
  IF v_user IS NULL OR NOT (public.has_role(v_user, 'owner') OR public.has_role(v_user, 'manager')
      OR public.has_role(v_user, 'accountant')) THEN
    RAISE EXCEPTION 'Only an owner, manager or accountant may reverse opening balances';
  END IF;
  IF _reason IS NULL OR btrim(_reason) = '' THEN
    RAISE EXCEPTION 'Reversing an opening entry requires a reason';
  END IF;
  SELECT * INTO v_doc FROM public.opening_balance_documents WHERE id = _document_id FOR UPDATE;
  IF NOT FOUND OR v_doc.status <> 'POSTED' THEN
    RAISE EXCEPTION 'Only a posted opening document can be reversed';
  END IF;

  INSERT INTO public.opening_balance_documents
    (document_number, effective_date, status, fiscal_year, reverses_document_id,
     notes, created_by, posted_at, posted_by)
  VALUES ('OBR-' || v_doc.document_number, v_doc.effective_date, 'POSTED', v_doc.fiscal_year,
    _document_id, 'عكس القيد الافتتاحي ' || v_doc.document_number || ': ' || btrim(_reason),
    v_user, now(), v_user)
  RETURNING id INTO v_new;

  INSERT INTO public.opening_balance_lines
    (document_id, section, side, ref_type, ref_id, product_id, warehouse_id,
     customer_id, supplier_id, description, quantity, unit_cost, amount, ledger_account_code)
  SELECT v_new, section, CASE WHEN side = 'DEBIT' THEN 'CREDIT' ELSE 'DEBIT' END,
    ref_type, ref_id, product_id, warehouse_id, customer_id, supplier_id,
    'عكس: ' || description, quantity, unit_cost, amount, ledger_account_code
  FROM public.opening_balance_lines WHERE document_id = _document_id;

  FOR l IN SELECT * FROM public.opening_balance_lines WHERE document_id = _document_id ORDER BY id
  LOOP
    IF l.section = 'STOCK' THEN
      PERFORM public.post_stock_delta(
        p_product_id => l.product_id, p_warehouse_id => l.warehouse_id,
        p_signed_qty => -l.quantity, p_unit_cost => coalesce(l.unit_cost, 0),
        p_movement_kind => 'ADJUSTMENT', p_movement_type_legacy => 'opening',
        p_source_type => 'opening_balance_reversal', p_source_id => v_new,
        p_note => 'عكس رصيد افتتاحي ' || v_doc.document_number,
        p_owner_type => 'COMPANY', p_owner_id => NULL);
      PERFORM public.apply_cost_movement(
        p_product_id => l.product_id, p_warehouse_id => l.warehouse_id,
        p_signed_qty => -l.quantity, p_incoming_cost => NULL,
        p_source_type => 'opening_balance_reversal', p_source_id => v_new,
        p_note => 'عكس رصيد افتتاحي ' || v_doc.document_number);

    ELSIF l.section = 'RECEIVABLE' THEN
      INSERT INTO public.customer_ledger
        (customer_id, entry_type, debit, credit, reference_id, reference_type, occurred_at, created_by, note)
      VALUES (l.customer_id, 'adjustment', 0, l.amount, v_new, 'opening_balance_reversal',
        now(), v_user, 'عكس رصيد افتتاحي ' || v_doc.document_number);

    ELSIF l.section = 'PAYABLE' THEN
      UPDATE public.suppliers SET balance = coalesce(balance, 0) - l.amount WHERE id = l.supplier_id;
      SELECT balance INTO v_balance FROM public.suppliers WHERE id = l.supplier_id;
      INSERT INTO public.supplier_ledger
        (supplier_id, entry_type, debit, credit, balance_after, reference_type, reference_id,
         occurred_at, source_key, note, created_by)
      VALUES (l.supplier_id, 'OPENING_BALANCE', l.amount, 0, v_balance, 'opening_balance_reversal', v_new,
        now(), 'OBR-' || _document_id::text || '-' || l.id::text,
        'عكس رصيد افتتاحي ' || v_doc.document_number || ': ' || btrim(_reason), v_user)
      ON CONFLICT (source_key) DO NOTHING;
    END IF;
  END LOOP;

  SELECT id INTO v_journal FROM public.journal_entries
    WHERE source_type = 'opening_balance' AND source_id = _document_id AND status = 'POSTED'
    FOR UPDATE;
  IF v_journal IS NOT NULL THEN
    PERFORM public.reverse_journal_entry(v_journal, btrim(_reason));
  END IF;

  UPDATE public.opening_balance_documents SET status = 'REVERSED' WHERE id = _document_id;
  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, payload)
  VALUES (v_user, 'opening_balance.reversed', 'opening_balance', _document_id,
    jsonb_build_object('reversal_document_id', v_new, 'journal_entry_id', v_journal, 'reason', btrim(_reason)));
  RETURN v_new;
END;
$function$;

COMMIT;

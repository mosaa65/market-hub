-- ============================================================================
-- الترحيل 007_sales_and_collections.sql — مجال: sales_and_collections
-- جزء من خط الأساس الجديد: تعريف نهائي واحد لكل كائن، مبني من مخطط مرجعي
-- مستخرج من الترحيلات التاريخية الكاملة (راجع supabase/migrations/README.md).
-- ============================================================================

--
-- Name: adjust_loyalty(uuid, numeric, text, text); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.adjust_loyalty(_customer uuid, _points numeric, _kind text, _note text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE v_id UUID; v_user UUID := auth.uid();
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT public.is_staff(v_user) THEN RAISE EXCEPTION 'Forbidden'; END IF;
  IF _kind NOT IN ('earn','redeem','adjust') THEN RAISE EXCEPTION 'Invalid kind'; END IF;

  INSERT INTO public.loyalty_transactions(customer_id, points, kind, note, created_by)
  VALUES (_customer, _points, _kind, _note, v_user)
  RETURNING id INTO v_id;

  UPDATE public.customers
    SET loyalty_points = GREATEST(loyalty_points + (CASE WHEN _kind='redeem' THEN -ABS(_points) ELSE ABS(_points) END), 0),
        updated_at = now()
    WHERE id = _customer;

  RETURN v_id;
END $$;

--
-- Name: allocate_sales_invoice_item_batches(); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.allocate_sales_invoice_item_batches() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_warehouse_id uuid;
  v_tracking public.item_tracking;
  v_product_strategy text;
  v_settings jsonb;
  v_strategy text;
  v_prevent_expired boolean;
  v_enforce_pos boolean;
  v_allow_negative_sales boolean := false;
  v_batch record;
  v_remaining numeric := NEW.quantity;
  v_take numeric;
  v_primary_id uuid;
  v_primary_number text;
  v_negative_batch_id uuid;
  v_negative_batch_number constant text := '__NEGATIVE_SALE__';
BEGIN
  IF NEW.product_id IS NULL OR NEW.stock_effect IS DISTINCT FROM 'STOCK_ISSUE' THEN RETURN NEW; END IF;
  SELECT p.tracking, p.batch_dispatch_strategy INTO v_tracking, v_product_strategy
    FROM public.products p WHERE p.id = NEW.product_id;
  IF v_tracking <> 'BATCH'::public.item_tracking THEN RETURN NEW; END IF;

  SELECT si.warehouse_id INTO v_warehouse_id FROM public.sales_invoices si WHERE si.id = NEW.invoice_id;
  SELECT coalesce(cs.batch_settings, '{}'::jsonb), cs.allow_negative_sales
    INTO v_settings, v_allow_negative_sales FROM public.company_settings cs WHERE cs.id = 1 FOR SHARE;
  v_allow_negative_sales := coalesce(v_allow_negative_sales, false);
  v_strategy := coalesce(v_product_strategy, v_settings ->> 'dispatch_strategy', 'FEFO');
  IF v_strategy NOT IN ('FEFO', 'FIFO', 'MANUAL') THEN v_strategy := 'FEFO'; END IF;
  v_prevent_expired := coalesce((v_settings ->> 'prevent_selling_expired')::boolean, true);
  v_enforce_pos := coalesce((v_settings ->> 'enforce_batch_selection_on_pos')::boolean, false);

  IF NEW.batch_id IS NOT NULL THEN
    SELECT pb.id, pb.batch_number, pb.expiry_date, pb.quantity INTO v_batch FROM public.product_batches pb
     WHERE pb.id = NEW.batch_id AND pb.product_id = NEW.product_id AND pb.warehouse_id = v_warehouse_id
       AND NOT pb.is_negative_balance FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'The selected batch does not belong to this product and warehouse' USING ERRCODE = 'check_violation'; END IF;
    IF v_prevent_expired AND v_batch.expiry_date IS NOT NULL AND v_batch.expiry_date <= current_date THEN
      RAISE EXCEPTION 'Cannot sell expired batch %', v_batch.batch_number USING ERRCODE = 'check_violation';
    END IF;
    v_take := least(greatest(v_batch.quantity, 0), v_remaining);
    IF v_take > 0 THEN
      UPDATE public.product_batches SET quantity = round(quantity - v_take, 3), updated_at = now() WHERE id = v_batch.id;
      INSERT INTO public.sales_invoice_item_batch_allocations(sales_invoice_item_id, batch_id, quantity)
      VALUES (NEW.id, v_batch.id, v_take);
      v_primary_id := v_batch.id; v_primary_number := v_batch.batch_number; v_remaining := v_remaining - v_take;
    END IF;
  ELSE
    IF v_strategy = 'MANUAL' OR v_enforce_pos THEN
      RAISE EXCEPTION 'Select a batch for item % before completing this sale', NEW.product_id USING ERRCODE = 'check_violation';
    END IF;
    FOR v_batch IN
      SELECT pb.id, pb.batch_number, pb.expiry_date, pb.quantity FROM public.product_batches pb
       WHERE pb.product_id = NEW.product_id AND pb.warehouse_id = v_warehouse_id
         AND NOT pb.is_negative_balance AND pb.quantity > 0
         AND (NOT v_prevent_expired OR pb.expiry_date IS NULL OR pb.expiry_date > current_date)
       ORDER BY CASE WHEN v_strategy = 'FIFO' THEN pb.created_at END ASC,
                CASE WHEN v_strategy = 'FIFO' THEN pb.id END ASC,
                CASE WHEN v_strategy = 'FEFO' THEN pb.expiry_date END ASC NULLS LAST,
                CASE WHEN v_strategy = 'FEFO' THEN pb.created_at END ASC, pb.id ASC FOR UPDATE
    LOOP
      EXIT WHEN v_remaining <= 0;
      v_take := least(v_batch.quantity, v_remaining);
      UPDATE public.product_batches SET quantity = round(quantity - v_take, 3), updated_at = now() WHERE id = v_batch.id;
      INSERT INTO public.sales_invoice_item_batch_allocations(sales_invoice_item_id, batch_id, quantity)
      VALUES (NEW.id, v_batch.id, v_take);
      IF v_primary_id IS NULL THEN v_primary_id := v_batch.id; v_primary_number := v_batch.batch_number; END IF;
      v_remaining := v_remaining - v_take;
    END LOOP;
  END IF;

  IF v_remaining > 0 THEN
    IF NOT v_allow_negative_sales THEN
      RAISE EXCEPTION 'Available eligible batches do not cover item % (short by %)', NEW.product_id, v_remaining USING ERRCODE = 'check_violation';
    END IF;
    SELECT pb.id INTO v_negative_batch_id FROM public.product_batches pb
     WHERE pb.product_id = NEW.product_id AND pb.warehouse_id = v_warehouse_id
       AND pb.batch_number = v_negative_batch_number AND pb.is_negative_balance FOR UPDATE;
    IF FOUND THEN
      UPDATE public.product_batches SET quantity = round(quantity - v_remaining, 3), updated_at = now()
       WHERE id = v_negative_batch_id;
    ELSE
      INSERT INTO public.product_batches(product_id, warehouse_id, batch_number, quantity, unit_cost, note, is_negative_balance, created_by)
      VALUES (NEW.product_id, v_warehouse_id, v_negative_batch_number, -v_remaining, 0,
        'System negative-sale balance; settled by later receipts or sales returns.', true, auth.uid())
      RETURNING id INTO v_negative_batch_id;
    END IF;
    INSERT INTO public.sales_invoice_item_batch_allocations(sales_invoice_item_id, batch_id, quantity)
    VALUES (NEW.id, v_negative_batch_id, v_remaining);
    IF v_primary_id IS NULL THEN v_primary_id := v_negative_batch_id; v_primary_number := v_negative_batch_number; END IF;
  END IF;
  NEW.batch_id := v_primary_id; NEW.batch_number := v_primary_number;
  RETURN NEW;
END;
$$;

--
-- Name: customer_balance_lock(uuid); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.customer_balance_lock(p_customer_id uuid) RETURNS numeric
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_balance numeric;
BEGIN
  IF p_customer_id IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT c.balance INTO v_balance
    FROM public.customers c
   WHERE c.id = p_customer_id
   FOR UPDATE;
  RETURN v_balance;
END;
$$;

--
-- Name: customer_balance_reconciliation_report(); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.customer_balance_reconciliation_report() RETURNS TABLE(customer_id uuid, customer_name text, stored_balance numeric, ledger_balance numeric, difference numeric, entry_count bigint, broken_documents bigint, status text)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF NOT public.can_read_finance(auth.uid()) THEN
    RAISE EXCEPTION 'Only finance roles may read the customer balance reconciliation'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH totals AS (
    SELECT l.customer_id,
           round(coalesce(sum(l.debit - l.credit), 0), 2) AS ledger,
           count(*) AS entries
      FROM public.customer_ledger l
     GROUP BY l.customer_id
  ), broken AS (
    SELECT l.customer_id, count(*) AS n
      FROM public.customer_ledger l
     WHERE (l.reference_type = 'customer_payment'
            AND NOT EXISTS (SELECT 1 FROM public.customer_payments p WHERE p.id = l.reference_id))
        OR (l.reference_type = 'sales_invoice'
            AND NOT EXISTS (SELECT 1 FROM public.sales_invoices s WHERE s.id = l.reference_id))
     GROUP BY l.customer_id
  )
  SELECT c.id,
         c.name,
         round(coalesce(c.balance, 0), 2),
         coalesce(t.ledger, 0),
         round(coalesce(c.balance, 0) - coalesce(t.ledger, 0), 2),
         coalesce(t.entries, 0),
         coalesce(b.n, 0),
         CASE
           WHEN coalesce(b.n, 0) > 0 THEN 'broken_documents'
           WHEN coalesce(t.entries, 0) = 0 AND abs(coalesce(c.balance, 0)) >= 0.005 THEN 'ledger_empty'
           WHEN coalesce(t.entries, 0) > 0 AND abs(coalesce(c.balance, 0)) < 0.005
                AND abs(coalesce(t.ledger, 0)) >= 0.005 THEN 'ledger_only'
           WHEN abs(coalesce(c.balance, 0) - coalesce(t.ledger, 0)) >= 0.005 THEN 'mismatch'
           ELSE 'matched'
         END
    FROM public.customers c
    LEFT JOIN totals t ON t.customer_id = c.id
    LEFT JOIN broken b ON b.customer_id = c.id
   ORDER BY abs(coalesce(c.balance, 0) - coalesce(t.ledger, 0)) DESC, c.name;
END;
$$;

--
-- Name: customer_balance_stamp_after_sale(uuid); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.customer_balance_stamp_after_sale(p_customer_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF p_customer_id IS NOT NULL THEN
    PERFORM public.recalculate_customer_balance(
      p_customer_id, 'ترحيل فاتورة بيع', 'document_repost');
  END IF;
END;
$$;

--
-- Name: customer_ledger_balance(uuid); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.customer_ledger_balance(p_customer_id uuid) RETURNS numeric
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT round(coalesce(sum(l.debit - l.credit), 0), 2)
  FROM public.customer_ledger AS l
  WHERE l.customer_id = p_customer_id
$$;

--
-- Name: customer_ledger_time_mismatches(); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.customer_ledger_time_mismatches() RETURNS TABLE(ledger_id uuid, customer_id uuid, entry_type text, reference_type text, payment_date date, occurred_local_date date, drift_days integer)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF NOT public.can_read_finance(auth.uid()) THEN
    RAISE EXCEPTION 'Only finance roles may inspect ledger time drift'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT l.id,
         l.customer_id,
         l.entry_type,
         l.reference_type,
         p.payment_date,
         (l.occurred_at AT TIME ZONE public.business_timezone())::date,
         ((l.occurred_at AT TIME ZONE public.business_timezone())::date - p.payment_date)
    FROM public.customer_ledger l
    JOIN public.customer_payments p
      ON l.reference_type = 'customer_payment' AND p.id = l.reference_id
   WHERE (l.occurred_at AT TIME ZONE public.business_timezone())::date <> p.payment_date
   ORDER BY l.occurred_at DESC;
END;
$$;

--
-- Name: recalculate_all_customer_balances(text); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.recalculate_all_customer_balances(p_reason text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_user    uuid := auth.uid();
  v_cust    record;
  v_result  jsonb;
  v_changed integer := 0;
  v_total   integer := 0;
  v_details jsonb := '[]'::jsonb;
BEGIN
  IF v_user IS NULL OR NOT (public.has_role(v_user, 'owner')
      OR public.has_role(v_user, 'manager')
      OR public.has_role(v_user, 'accountant')) THEN
    RAISE EXCEPTION 'Only an owner, manager or accountant may recalculate customer balances'
      USING ERRCODE = '42501';
  END IF;
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'A reason is required before recalculating every customer balance';
  END IF;

  FOR v_cust IN SELECT id FROM public.customers ORDER BY id
  LOOP
    v_result := public.recalculate_customer_balance(v_cust.id, btrim(p_reason), 'recalculation');
    v_total := v_total + 1;
    IF (v_result->>'changed')::boolean THEN
      v_changed := v_changed + 1;
      v_details := v_details || jsonb_build_object(
        'customer_id', v_cust.id,
        'previous', (v_result->>'stored_balance')::numeric,
        'corrected', (v_result->>'corrected_balance')::numeric
      );
    END IF;
  END LOOP;

  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, payload)
  VALUES (v_user, 'customer_balance.bulk_recalculated', 'customer', NULL,
          jsonb_build_object('customers', v_total, 'changed', v_changed,
                             'reason', btrim(p_reason), 'details', v_details));

  RETURN jsonb_build_object('customers', v_total, 'changed', v_changed, 'details', v_details);
END;
$$;

--
-- Name: recalculate_customer_balance(uuid, text, text); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.recalculate_customer_balance(p_customer_id uuid, p_reason text DEFAULT NULL::text, p_type text DEFAULT 'recalculation'::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_user        uuid := auth.uid();
  v_customer    record;
  v_ledger      numeric;
  v_previous    numeric;
  v_difference  numeric;
  v_entry_count integer;
  v_unposted    integer;
  v_orphans     integer;
  v_type        text := coalesce(nullif(btrim(coalesce(p_type, '')), ''), 'recalculation');
BEGIN
  IF p_customer_id IS NULL THEN
    RAISE EXCEPTION 'A customer is required';
  END IF;
  IF v_type NOT IN ('recalculation', 'document_repost') THEN
    RAISE EXCEPTION 'Unknown correction type: %', v_type;
  END IF;

  -- قفل الصف: لا إعادة احتساب متوازية على نفس العميل.
  SELECT id, name, balance, updated_at
    INTO v_customer
    FROM public.customers
   WHERE id = p_customer_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Customer % does not exist', p_customer_id;
  END IF;

  -- 1) الرصيد المحاسبي = Σ(debit − credit). عمود الاسم debit/credit هو مصدر
  --    الحقيقة في هذا المخطط، ولا يُعتمد على entry_type في الحساب.
  SELECT round(coalesce(sum(l.debit - l.credit), 0), 2),
         count(*)
    INTO v_ledger, v_entry_count
    FROM public.customer_ledger l
   WHERE l.customer_id = p_customer_id;

  v_previous := round(coalesce(v_customer.balance, 0), 2);
  v_difference := round(v_previous - v_ledger, 2);

  -- 2) فحوص تشخيصية تُكشف في RETURN ولا تُصلَح عشوائيًا:
  --    حركات معلّقة تحت مستند مالي غير مرحلة/غير موجودة.
  SELECT count(*) INTO v_unposted
    FROM public.customer_ledger l
   WHERE l.customer_id = p_customer_id
     AND l.reference_type = 'customer_payment'
     AND NOT EXISTS (SELECT 1 FROM public.customer_payments p WHERE p.id = l.reference_id);

  SELECT count(*) INTO v_orphans
    FROM public.customer_ledger l
   WHERE l.customer_id = p_customer_id
     AND l.reference_type = 'sales_invoice'
     AND NOT EXISTS (SELECT 1 FROM public.sales_invoices s WHERE s.id = l.reference_id);

  -- 3) الكتابة — فقط عند وجود فرق فعلي، وبتسجيل من/إلى.
  IF abs(v_difference) >= 0.005 THEN
    UPDATE public.customers
       SET balance = v_ledger,
           updated_at = now()
     WHERE id = p_customer_id;

    INSERT INTO public.customer_balance_adjustments (
      customer_id, previous_balance, new_balance, ledger_balance,
      difference, reason, correction_type, actor_id, document_payload
    ) VALUES (
      p_customer_id, v_previous, v_ledger, v_ledger, v_difference,
      coalesce(nullif(btrim(coalesce(p_reason, '')), ''),
               'إعادة احتساب الرصيد المخزَّن من دفتر العميل'),
      v_type, v_user,
      jsonb_build_object('entry_count', v_entry_count,
                         'orphan_documents', v_orphans,
                         'missing_payment_documents', v_unposted)
    );
  END IF;

  RETURN jsonb_build_object(
    'customer_id',        p_customer_id,
    'customer_name',      v_customer.name,
    'ledger_balance',     v_ledger,
    'stored_balance',     v_previous,
    'corrected_balance',  CASE WHEN abs(v_difference) >= 0.005 THEN v_ledger ELSE v_previous END,
    'difference',         v_difference,
    'changed',            abs(v_difference) >= 0.005,
    'entry_count',        v_entry_count,
    'orphan_documents',   v_orphans,
    'missing_documents',  v_unposted,
    'status',
      CASE
        WHEN v_entry_count = 0 AND abs(v_previous) >= 0.005 THEN 'ledger_empty'
        WHEN v_entry_count > 0 AND abs(v_previous) < 0.005 AND abs(v_ledger) >= 0.005 THEN 'ledger_only'
        WHEN v_orphans > 0 OR v_unposted > 0 THEN 'broken_documents'
        WHEN abs(v_difference) >= 0.005 THEN 'mismatch'
        ELSE 'matched'
      END
  );
END;
$$;

--
-- Name: reject_paid_credit_sale_creation(); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.reject_paid_credit_sale_creation() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  IF NEW.payment_method = 'credit'::public.payment_method
     AND coalesce(NEW.paid, 0) > 0 THEN
    RAISE EXCEPTION 'Credit payment method requires zero paid amount; record the actual tender method for partial payment'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

--
-- Name: resolve_sale_line(jsonb); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.resolve_sale_line(p_line jsonb, OUT o_product_id uuid, OUT o_quantity numeric, OUT o_line_type text, OUT o_stock_effect text, OUT o_service_name text) RETURNS record
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_is_service_flag boolean := coalesce((p_line ->> 'is_service')::boolean, false);
  v_exists boolean;
BEGIN
  o_product_id   := nullif(btrim(coalesce(p_line ->> 'product_id', '')), '')::uuid;
  o_quantity     := (p_line ->> 'quantity')::numeric;
  o_service_name := nullif(btrim(coalesce(p_line ->> 'name', '')), '');

  IF o_product_id IS NULL THEN
    -- No product reference at all: this is an ad-hoc service line.
    o_line_type    := 'AD_HOC_SERVICE';
    o_stock_effect := 'NONE';
    RETURN;
  END IF;

  SELECT true INTO v_exists FROM public.products p WHERE p.id = o_product_id;

  IF v_exists IS NOT TRUE THEN
    IF v_is_service_flag THEN
      -- Legacy POS sent synthetic ids such as "service-<uuid>".
      o_product_id   := NULL;
      o_line_type    := 'AD_HOC_SERVICE';
      o_stock_effect := 'NONE';
      RETURN;
    END IF;
    RAISE EXCEPTION 'Item % does not exist', o_product_id;
  END IF;

  o_line_type    := public.item_line_type(o_product_id, false);
  o_stock_effect := public.item_stock_effect(o_product_id, 'out');
END $$;

--
-- Name: restore_sales_return_item_batches(); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.restore_sales_return_item_batches() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_invoice_id uuid;
  v_warehouse_id uuid;
  v_tracking public.item_tracking;
  v_remaining numeric := NEW.quantity;
  v_take numeric;
  v_source record;
BEGIN
  SELECT sr.invoice_id, sr.warehouse_id INTO v_invoice_id, v_warehouse_id
    FROM public.sales_returns sr WHERE sr.id = NEW.return_id;
  SELECT p.tracking INTO v_tracking FROM public.products p WHERE p.id = NEW.product_id;
  IF v_tracking <> 'BATCH'::public.item_tracking THEN RETURN NEW; END IF;

  FOR v_source IN
    SELECT si.id AS invoice_item_id, a.batch_id, pb.quantity AS batch_quantity,
           a.quantity - coalesce((
             SELECT sum(ra.quantity) FROM public.sales_return_item_batch_allocations ra
              WHERE ra.sales_invoice_item_id = si.id AND ra.batch_id = a.batch_id
           ), 0) AS returnable
      FROM public.sales_invoice_items si
      JOIN public.sales_invoice_item_batch_allocations a ON a.sales_invoice_item_id = si.id
      JOIN public.product_batches pb ON pb.id = a.batch_id
     WHERE si.invoice_id = v_invoice_id AND si.product_id = NEW.product_id
       AND (NEW.invoice_item_id IS NULL OR si.id = NEW.invoice_item_id)
       AND a.quantity > coalesce((
         SELECT sum(ra.quantity) FROM public.sales_return_item_batch_allocations ra
          WHERE ra.sales_invoice_item_id = si.id AND ra.batch_id = a.batch_id
       ), 0)
     ORDER BY si.id, a.created_at, a.batch_id
     FOR UPDATE OF pb
  LOOP
    EXIT WHEN v_remaining <= 0;
    v_take := least(v_source.returnable, v_remaining);
    UPDATE public.product_batches SET quantity = round(quantity + v_take, 3), updated_at = now()
     WHERE id = v_source.batch_id;
    INSERT INTO public.sales_return_item_batch_allocations(
      sales_return_item_id, sales_invoice_item_id, batch_id, quantity
    ) VALUES (NEW.id, v_source.invoice_item_id, v_source.batch_id, v_take);
    v_remaining := v_remaining - v_take;
  END LOOP;

  IF v_remaining > 0 THEN
    RAISE EXCEPTION 'Original invoice line does not have enough unreturned batch allocation for % base units', v_remaining
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

--
-- Name: sale_line_unit_cost(uuid, uuid); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.sale_line_unit_cost(p_product_id uuid, p_warehouse_id uuid) RETURNS numeric
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT coalesce(
    public.resolve_unit_cost(p_product_id, p_warehouse_id),
    (SELECT p.cost_price FROM public.products p WHERE p.id = p_product_id),
    0
  );
$$;

--
-- Name: sales_invoice_tender_breakdown(uuid); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.sales_invoice_tender_breakdown(_invoice_id uuid) RETURNS TABLE(method text, amount numeric)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT s.method::text, s.amount
  FROM public.customer_payment_splits AS s
  WHERE s.invoice_id = _invoice_id
  ORDER BY s.amount DESC;
$$;

--
-- Name: sales_line_cost(uuid, uuid, numeric, text); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.sales_line_cost(p_item_id uuid, p_invoice_id uuid, p_quantity numeric, p_line_type text DEFAULT NULL::text) RETURNS numeric
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_movement_cost numeric;
  v_costing       public.costing_method;
  v_reference     numeric;
BEGIN
  -- A service line carries no inventory cost. That is not a missing value.
  IF p_item_id IS NULL OR p_line_type IN ('SERVICE', 'AD_HOC_SERVICE') THEN
    RETURN 0;
  END IF;

  -- (a) The real cost of what actually left the warehouse for this invoice.
  SELECT m.unit_cost
    INTO v_movement_cost
  FROM public.stock_movements m
  WHERE m.product_id = p_item_id
    AND m.reference_id = p_invoice_id
    AND m.reference_type = 'sales_invoice'
    AND m.movement_kind = 'ISSUE'
    AND m.unit_cost IS NOT NULL
  ORDER BY m.created_at DESC
  LIMIT 1;

  IF v_movement_cost IS NOT NULL THEN
    RETURN round(coalesce(p_quantity, 0) * v_movement_cost, 2);
  END IF;

  -- (b) No movement cost. Only a declared STANDARD cost is a legitimate
  -- fallback, because the business chose that policy explicitly.
  SELECT COALESCE(ci.costing_method, p.costing_method),
         COALESCE(ci.default_cost, p.cost_price)
    INTO v_costing, v_reference
  FROM public.products p
  LEFT JOIN public.company_items ci
    ON ci.item_id = p.id AND ci.company_id = 1 AND ci.is_active
  WHERE p.id = p_item_id;

  IF v_costing = 'STANDARD' AND v_reference IS NOT NULL THEN
    RETURN round(coalesce(p_quantity, 0) * v_reference, 2);
  END IF;

  -- (c) Unknown. Deliberately NULL, never a guess.
  RETURN NULL;
END $$;

--
-- Name: tg_customer_ledger_sync_balance(); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.tg_customer_ledger_sync_balance() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    PERFORM public.recalculate_customer_balance(
      NEW.customer_id, 'مزامنة تلقائية من دفتر العميل', 'recalculation');
    IF TG_OP = 'UPDATE' AND OLD.customer_id IS DISTINCT FROM NEW.customer_id THEN
      PERFORM public.recalculate_customer_balance(
        OLD.customer_id, 'مزامنة تلقائية من دفتر العميل', 'recalculation');
    END IF;
    RETURN NULL;
  END IF;

  -- حذف حركة محاسبية: نُعيد الاحتساب بعده، لا نترك الرصيد معلّقًا على حركة رحلت.
  PERFORM public.recalculate_customer_balance(
    OLD.customer_id, 'إعادة احتساب بعد حذف حركة من الدفتر', 'recalculation');
  RETURN NULL;
END;
$$;

--
-- Name: tg_customer_ledger_system_guard(); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.tg_customer_ledger_system_guard() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF coalesce(NEW.debit, 0) - coalesce(NEW.credit, 0) <> 0 AND public.is_system_customer(NEW.customer_id) THEN
    RAISE EXCEPTION
      'The system cash customer can only carry settlement lines, never a credit balance'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END $$;

--
-- Name: ad_hoc_service_lines; Type: TABLE; Schema: public; Owner: supabase_admin
--

CREATE TABLE public.ad_hoc_service_lines (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    invoice_id uuid NOT NULL,
    invoice_item_id uuid,
    description text NOT NULL,
    quantity numeric(14,3) NOT NULL,
    unit_price numeric(14,2) NOT NULL,
    discount numeric(14,2) DEFAULT 0 NOT NULL,
    tax numeric(14,2) DEFAULT 0 NOT NULL,
    total numeric(14,2) NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ad_hoc_service_lines_quantity_check CHECK ((quantity > (0)::numeric)),
    CONSTRAINT ad_hoc_service_lines_unit_price_check CHECK ((unit_price >= (0)::numeric)),
    CONSTRAINT ad_hoc_service_lines_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL
);

--
-- Name: sales_invoices; Type: TABLE; Schema: public; Owner: supabase_admin
--

CREATE TABLE public.sales_invoices (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    invoice_number text NOT NULL,
    customer_id uuid,
    warehouse_id uuid,
    status public.invoice_status DEFAULT 'draft'::public.invoice_status NOT NULL,
    payment_status public.payment_status DEFAULT 'unpaid'::public.payment_status NOT NULL,
    subtotal numeric(14,2) DEFAULT 0 NOT NULL,
    discount numeric(14,2) DEFAULT 0 NOT NULL,
    tax numeric(14,2) DEFAULT 0 NOT NULL,
    total numeric(14,2) DEFAULT 0 NOT NULL,
    paid numeric(14,2) DEFAULT 0 NOT NULL,
    payment_method public.payment_method,
    note text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    document_number text GENERATED ALWAYS AS (invoice_number) STORED,
    cashbox_id uuid,
    bank_account_id uuid,
    payment_method_id text,
    payment_reference text,
    CONSTRAINT sales_invoices_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL
);

--
-- Name: customer_ledger_balances; Type: VIEW; Schema: public; Owner: supabase_admin
--

CREATE VIEW public.customer_ledger_balances WITH (security_invoker='true') AS
 SELECT c.id AS customer_id,
    c.name,
    round(COALESCE(sum((l.debit - l.credit)), (0)::numeric), 2) AS ledger_balance,
    c.balance AS legacy_balance,
    round((COALESCE(sum((l.debit - l.credit)), (0)::numeric) - c.balance), 2) AS difference
   FROM (public.customers c
     LEFT JOIN public.customer_ledger l ON ((l.customer_id = c.id)))
  GROUP BY c.id, c.name, c.balance;

--
-- Name: loyalty_transactions; Type: TABLE; Schema: public; Owner: supabase_admin
--

CREATE TABLE public.loyalty_transactions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    customer_id uuid NOT NULL,
    points numeric NOT NULL,
    kind text NOT NULL,
    reference_type text,
    reference_id uuid,
    note text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT loyalty_transactions_kind_check CHECK ((kind = ANY (ARRAY['earn'::text, 'redeem'::text, 'adjust'::text]))),
    CONSTRAINT loyalty_transactions_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id)
);

--
-- Name: sales_invoice_items; Type: TABLE; Schema: public; Owner: supabase_admin
--

CREATE TABLE public.sales_invoice_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    invoice_id uuid NOT NULL,
    product_id uuid,
    quantity numeric(14,3) NOT NULL,
    unit_price numeric(14,2) NOT NULL,
    discount numeric(14,2) DEFAULT 0 NOT NULL,
    tax numeric(14,2) DEFAULT 0 NOT NULL,
    total numeric(14,2) NOT NULL,
    description text,
    line_type text,
    stock_effect text,
    uom_id uuid,
    batch_id uuid,
    batch_number text,
    entered_quantity numeric(18,6),
    base_quantity numeric(18,6),
    uom_conversion_factor numeric(30,12),
    entered_unit_price numeric(18,4),
    base_unit_price numeric(18,6),
    uom_quantity_increment numeric(30,12),
    CONSTRAINT sales_invoice_items_base_unit_price_nonnegative CHECK (((base_unit_price IS NULL) OR (base_unit_price >= (0)::numeric))),
    CONSTRAINT sales_invoice_items_line_type_valid CHECK (((line_type IS NULL) OR (line_type = ANY (ARRAY['STOCKED_GOOD'::text, 'UNTRACKED_GOOD'::text, 'SERVICE'::text, 'CUSTOMER_OWNED_GOOD'::text, 'AD_HOC_SERVICE'::text])))),
    CONSTRAINT sales_invoice_items_stock_effect_valid CHECK (((stock_effect IS NULL) OR (stock_effect = ANY (ARRAY['STOCK_ISSUE'::text, 'STOCK_RECEIPT'::text, 'NONE'::text])))),
    CONSTRAINT sales_invoice_items_uom_increment_positive CHECK (((uom_quantity_increment IS NULL) OR (uom_quantity_increment > (0)::numeric))),
    CONSTRAINT sales_invoice_items_uom_snapshot_check CHECK (((num_nonnulls(entered_quantity, base_quantity, uom_conversion_factor, entered_unit_price, uom_quantity_increment) = ANY (ARRAY[0, 5])) AND ((entered_quantity IS NULL) OR ((entered_quantity > (0)::numeric) AND (base_quantity > (0)::numeric) AND (uom_conversion_factor > (0)::numeric) AND (entered_unit_price >= (0)::numeric) AND (uom_quantity_increment > (0)::numeric)))))
);

--
-- Name: quotation_seq; Type: SEQUENCE; Schema: public; Owner: supabase_admin
--

CREATE SEQUENCE public.quotation_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: sales_invoice_item_batch_allocations; Type: TABLE; Schema: public; Owner: supabase_admin
--

CREATE TABLE public.sales_invoice_item_batch_allocations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    sales_invoice_item_id uuid NOT NULL,
    batch_id uuid NOT NULL,
    quantity numeric(14,3) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT sales_invoice_item_batch_allocations_quantity_check CHECK ((quantity > (0)::numeric))
);

--
-- Name: sales_invoice_seq; Type: SEQUENCE; Schema: public; Owner: supabase_admin
--

CREATE SEQUENCE public.sales_invoice_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: sales_order_seq; Type: SEQUENCE; Schema: public; Owner: supabase_admin
--

CREATE SEQUENCE public.sales_order_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: sales_return_item_batch_allocations; Type: TABLE; Schema: public; Owner: supabase_admin
--

CREATE TABLE public.sales_return_item_batch_allocations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    sales_return_item_id uuid NOT NULL,
    sales_invoice_item_id uuid NOT NULL,
    batch_id uuid NOT NULL,
    quantity numeric(14,3) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT sales_return_item_batch_allocations_quantity_check CHECK ((quantity > (0)::numeric))
);

--
-- Name: sales_return_items; Type: TABLE; Schema: public; Owner: supabase_admin
--

CREATE TABLE public.sales_return_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    return_id uuid NOT NULL,
    product_id uuid NOT NULL,
    quantity numeric NOT NULL,
    unit_price numeric NOT NULL,
    tax numeric DEFAULT 0 NOT NULL,
    total numeric DEFAULT 0 NOT NULL,
    line_type text,
    invoice_item_id uuid,
    uom_id uuid,
    uom_quantity_increment numeric(30,12),
    entered_quantity numeric(18,6),
    base_quantity numeric(18,6),
    uom_conversion_factor numeric(30,12),
    entered_unit_price numeric(18,4),
    CONSTRAINT sales_return_items_quantity_check CHECK ((quantity > (0)::numeric)),
    CONSTRAINT sales_return_items_uom_snapshot_check CHECK (((num_nonnulls(entered_quantity, base_quantity, uom_conversion_factor, entered_unit_price, uom_quantity_increment) = ANY (ARRAY[0, 5])) AND ((entered_quantity IS NULL) OR ((entered_quantity > (0)::numeric) AND (base_quantity > (0)::numeric) AND (uom_conversion_factor > (0)::numeric) AND (entered_unit_price >= (0)::numeric) AND (uom_quantity_increment > (0)::numeric)))))
);

--
-- Name: sales_return_seq; Type: SEQUENCE; Schema: public; Owner: supabase_admin
--

CREATE SEQUENCE public.sales_return_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: sales_returns; Type: TABLE; Schema: public; Owner: supabase_admin
--

CREATE TABLE public.sales_returns (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    return_number text NOT NULL,
    invoice_id uuid,
    customer_id uuid,
    warehouse_id uuid NOT NULL,
    subtotal numeric DEFAULT 0 NOT NULL,
    tax numeric DEFAULT 0 NOT NULL,
    total numeric DEFAULT 0 NOT NULL,
    refund_method public.payment_method,
    note text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    document_number text GENERATED ALWAYS AS (return_number) STORED,
    cashbox_id uuid,
    bank_account_id uuid,
    payment_method_id text,
    payment_reference text,
    CONSTRAINT sales_returns_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL
);


--
-- Name: FUNCTION adjust_loyalty(_customer uuid, _points numeric, _kind text, _note text); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.adjust_loyalty(_customer uuid, _points numeric, _kind text, _note text) FROM PUBLIC;

GRANT ALL ON FUNCTION public.adjust_loyalty(_customer uuid, _points numeric, _kind text, _note text) TO service_role;

GRANT ALL ON FUNCTION public.adjust_loyalty(_customer uuid, _points numeric, _kind text, _note text) TO authenticated;


--
-- Name: FUNCTION allocate_sales_invoice_item_batches(); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.allocate_sales_invoice_item_batches() FROM PUBLIC;

GRANT ALL ON FUNCTION public.allocate_sales_invoice_item_batches() TO service_role;


--
-- Name: FUNCTION customer_balance_lock(p_customer_id uuid); Type: COMMENT; Schema: public; Owner: supabase_admin
--

COMMENT ON FUNCTION public.customer_balance_lock(p_customer_id uuid) IS 'يقفل صف العميل (FOR UPDATE) ويعيد رصيده المخزَّن — يُستدعى في أول كل مسار مالي قبل أي فحص ذمة.';

--
-- Name: FUNCTION customer_balance_lock(p_customer_id uuid); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.customer_balance_lock(p_customer_id uuid) FROM PUBLIC;


--
-- Name: FUNCTION customer_balance_reconciliation_report(); Type: COMMENT; Schema: public; Owner: supabase_admin
--

COMMENT ON FUNCTION public.customer_balance_reconciliation_report() IS 'تقرير مطابقة: الرصيد المخزَّن مقابل رصيد الدفتر لكل عميل مع تصنيف الحالة. قراءة فقط — لا تعدّل أي رصيد.';

--
-- Name: FUNCTION customer_balance_reconciliation_report(); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.customer_balance_reconciliation_report() FROM PUBLIC;

GRANT ALL ON FUNCTION public.customer_balance_reconciliation_report() TO authenticated;

GRANT ALL ON FUNCTION public.customer_balance_reconciliation_report() TO service_role;


--
-- Name: FUNCTION customer_balance_stamp_after_sale(p_customer_id uuid); Type: COMMENT; Schema: public; Owner: supabase_admin
--

COMMENT ON FUNCTION public.customer_balance_stamp_after_sale(p_customer_id uuid) IS 'نقطة واحدة يستدعيها كل مسار بيع بعد كتابة حركة الدفتر: تُعيد الرصيد المخزَّن إلى صافي الدفتر.';

--
-- Name: FUNCTION customer_balance_stamp_after_sale(p_customer_id uuid); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.customer_balance_stamp_after_sale(p_customer_id uuid) FROM PUBLIC;

GRANT ALL ON FUNCTION public.customer_balance_stamp_after_sale(p_customer_id uuid) TO service_role;


--
-- Name: FUNCTION customer_ledger_balance(p_customer_id uuid); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.customer_ledger_balance(p_customer_id uuid) FROM PUBLIC;

GRANT ALL ON FUNCTION public.customer_ledger_balance(p_customer_id uuid) TO service_role;


--
-- Name: FUNCTION customer_ledger_time_mismatches(); Type: COMMENT; Schema: public; Owner: supabase_admin
--

COMMENT ON FUNCTION public.customer_ledger_time_mismatches() IS 'يكشف حركات التحصيل التي يقع occurred_at فيها في يوم غير يوم payment_date — من آثار منطقة الخادم الزمنية السابقة. قراءة فقط.';

--
-- Name: FUNCTION customer_ledger_time_mismatches(); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.customer_ledger_time_mismatches() FROM PUBLIC;

GRANT ALL ON FUNCTION public.customer_ledger_time_mismatches() TO authenticated;

GRANT ALL ON FUNCTION public.customer_ledger_time_mismatches() TO service_role;


--
-- Name: FUNCTION recalculate_all_customer_balances(p_reason text); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.recalculate_all_customer_balances(p_reason text) FROM PUBLIC;

GRANT ALL ON FUNCTION public.recalculate_all_customer_balances(p_reason text) TO authenticated;

GRANT ALL ON FUNCTION public.recalculate_all_customer_balances(p_reason text) TO service_role;

--
-- Name: recalculate_customer_balance(uuid); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.recalculate_customer_balance(p_customer_id uuid) RETURNS jsonb
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT public.recalculate_customer_balance(p_customer_id, NULL, 'recalculation');
$$;


--
-- Name: FUNCTION reject_paid_credit_sale_creation(); Type: COMMENT; Schema: public; Owner: supabase_admin
--

COMMENT ON FUNCTION public.reject_paid_credit_sale_creation() IS 'R-56: A credit sale cannot carry an initial payment without a recorded settlement method.';

--
-- Name: FUNCTION reject_paid_credit_sale_creation(); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.reject_paid_credit_sale_creation() FROM PUBLIC;

GRANT ALL ON FUNCTION public.reject_paid_credit_sale_creation() TO service_role;


--
-- Name: FUNCTION resolve_sale_line(p_line jsonb, OUT o_product_id uuid, OUT o_quantity numeric, OUT o_line_type text, OUT o_stock_effect text, OUT o_service_name text); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.resolve_sale_line(p_line jsonb, OUT o_product_id uuid, OUT o_quantity numeric, OUT o_line_type text, OUT o_stock_effect text, OUT o_service_name text) FROM PUBLIC;

GRANT ALL ON FUNCTION public.resolve_sale_line(p_line jsonb, OUT o_product_id uuid, OUT o_quantity numeric, OUT o_line_type text, OUT o_stock_effect text, OUT o_service_name text) TO service_role;


--
-- Name: FUNCTION restore_sales_return_item_batches(); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.restore_sales_return_item_batches() FROM PUBLIC;

GRANT ALL ON FUNCTION public.restore_sales_return_item_batches() TO service_role;


--
-- Name: FUNCTION sale_line_unit_cost(p_product_id uuid, p_warehouse_id uuid); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.sale_line_unit_cost(p_product_id uuid, p_warehouse_id uuid) FROM PUBLIC;

GRANT ALL ON FUNCTION public.sale_line_unit_cost(p_product_id uuid, p_warehouse_id uuid) TO service_role;


--
-- Name: FUNCTION sales_invoice_tender_breakdown(_invoice_id uuid); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.sales_invoice_tender_breakdown(_invoice_id uuid) FROM PUBLIC;

GRANT ALL ON FUNCTION public.sales_invoice_tender_breakdown(_invoice_id uuid) TO service_role;


--
-- Name: FUNCTION sales_line_cost(p_item_id uuid, p_invoice_id uuid, p_quantity numeric, p_line_type text); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.sales_line_cost(p_item_id uuid, p_invoice_id uuid, p_quantity numeric, p_line_type text) FROM PUBLIC;

GRANT ALL ON FUNCTION public.sales_line_cost(p_item_id uuid, p_invoice_id uuid, p_quantity numeric, p_line_type text) TO service_role;

--
-- Name: customer_ledger tg_customer_ledger_sync_balance; Type: TRIGGER; Schema: public; Owner: supabase_admin
--

CREATE TRIGGER tg_customer_ledger_sync_balance AFTER INSERT OR DELETE OR UPDATE ON public.customer_ledger FOR EACH ROW EXECUTE FUNCTION public.tg_customer_ledger_sync_balance();

--
-- Name: customer_ledger tg_customer_ledger_system_guard; Type: TRIGGER; Schema: public; Owner: supabase_admin
--

CREATE TRIGGER tg_customer_ledger_system_guard BEFORE INSERT ON public.customer_ledger FOR EACH ROW EXECUTE FUNCTION public.tg_customer_ledger_system_guard();


--
-- Name: ad_hoc_service_lines ad_hoc_service_lines_pkey; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.ad_hoc_service_lines
    ADD CONSTRAINT ad_hoc_service_lines_pkey PRIMARY KEY (id);

--
-- Name: idx_ad_hoc_service_lines_invoice; Type: INDEX; Schema: public; Owner: supabase_admin
--

CREATE INDEX idx_ad_hoc_service_lines_invoice ON public.ad_hoc_service_lines USING btree (invoice_id);

--
-- Name: ad_hoc_service_lines; Type: ROW SECURITY; Schema: public; Owner: supabase_admin
--

ALTER TABLE public.ad_hoc_service_lines ENABLE ROW LEVEL SECURITY;

--
-- Name: ad_hoc_service_lines ad_hoc_service_lines_read; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY ad_hoc_service_lines_read ON public.ad_hoc_service_lines FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));

--
-- Name: TABLE ad_hoc_service_lines; Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.ad_hoc_service_lines TO service_role;

GRANT SELECT ON TABLE public.ad_hoc_service_lines TO authenticated;


--
-- Name: sales_invoices sales_invoices_invoice_number_key; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.sales_invoices
    ADD CONSTRAINT sales_invoices_invoice_number_key UNIQUE (invoice_number);

--
-- Name: sales_invoices sales_invoices_pkey; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.sales_invoices
    ADD CONSTRAINT sales_invoices_pkey PRIMARY KEY (id);

--
-- Name: ix_sales_invoices_bank_acc; Type: INDEX; Schema: public; Owner: supabase_admin
--

CREATE INDEX ix_sales_invoices_bank_acc ON public.sales_invoices USING btree (bank_account_id);

--
-- Name: ix_sales_invoices_cashbox; Type: INDEX; Schema: public; Owner: supabase_admin
--

CREATE INDEX ix_sales_invoices_cashbox ON public.sales_invoices USING btree (cashbox_id);

--
-- Name: sales_invoices sales_invoices_reject_paid_credit_insert; Type: TRIGGER; Schema: public; Owner: supabase_admin
--

CREATE TRIGGER sales_invoices_reject_paid_credit_insert BEFORE INSERT ON public.sales_invoices FOR EACH ROW EXECUTE FUNCTION public.reject_paid_credit_sale_creation();

--
-- Name: sales_invoices sales_updated; Type: TRIGGER; Schema: public; Owner: supabase_admin
--

CREATE TRIGGER sales_updated BEFORE UPDATE ON public.sales_invoices FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

--
-- Name: sales_invoices sale_view; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY sale_view ON public.sales_invoices FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));

--
-- Name: sales_invoices; Type: ROW SECURITY; Schema: public; Owner: supabase_admin
--

ALTER TABLE public.sales_invoices ENABLE ROW LEVEL SECURITY;

--
-- Name: TABLE sales_invoices; Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.sales_invoices TO service_role;

GRANT SELECT ON TABLE public.sales_invoices TO authenticated;


--
-- Name: customer_balance_reconciliation; Type: VIEW; Schema: public; Owner: supabase_admin
--

CREATE VIEW public.customer_balance_reconciliation WITH (security_invoker='true') AS
 SELECT customer_id,
    name,
    ledger_balance,
    legacy_balance,
    difference
   FROM public.customer_ledger_balances
  WHERE (difference <> (0)::numeric);

--
-- Name: TABLE customer_ledger_balances; Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT SELECT ON TABLE public.customer_ledger_balances TO authenticated;

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.customer_ledger_balances TO service_role;


--
-- Name: loyalty_transactions loyalty_transactions_pkey; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.loyalty_transactions
    ADD CONSTRAINT loyalty_transactions_pkey PRIMARY KEY (id);

--
-- Name: idx_loyalty_customer; Type: INDEX; Schema: public; Owner: supabase_admin
--

CREATE INDEX idx_loyalty_customer ON public.loyalty_transactions USING btree (customer_id, created_at DESC);

--
-- Name: loyalty_transactions Staff read loyalty; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY "Staff read loyalty" ON public.loyalty_transactions FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));

--
-- Name: loyalty_transactions Staff write loyalty; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY "Staff write loyalty" ON public.loyalty_transactions FOR INSERT TO authenticated WITH CHECK (public.is_staff(auth.uid()));

--
-- Name: loyalty_transactions; Type: ROW SECURITY; Schema: public; Owner: supabase_admin
--

ALTER TABLE public.loyalty_transactions ENABLE ROW LEVEL SECURITY;

--
-- Name: TABLE loyalty_transactions; Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.loyalty_transactions TO service_role;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.loyalty_transactions TO authenticated;


--
-- Name: sales_register; Type: VIEW; Schema: public; Owner: supabase_admin
--

CREATE VIEW public.sales_register WITH (security_invoker='true') AS
 SELECT i.id AS invoice_item_id,
    i.invoice_id,
    s.invoice_number,
    s.created_at,
    s.customer_id,
    s.status,
    s.payment_method,
    i.product_id,
    i.description,
    p.name AS item_name,
    p.name_ar AS item_name_ar,
    p.sku,
    i.quantity,
    i.unit_price,
    i.discount,
    i.tax,
    i.total,
    COALESCE(i.line_type,
        CASE
            WHEN (i.product_id IS NULL) THEN 'AD_HOC_SERVICE'::text
            ELSE public.item_line_type(i.product_id, false)
        END) AS line_type,
    COALESCE(i.stock_effect, 'NONE'::text) AS stock_effect,
    i.uom_id,
    public.sales_line_cost(i.product_id, i.invoice_id, i.quantity, i.line_type) AS line_cost,
    COALESCE(i.entered_quantity, i.quantity) AS entered_quantity,
    COALESCE(i.entered_unit_price, i.unit_price) AS entered_unit_price,
    COALESCE(i.uom_conversion_factor, (1)::numeric) AS uom_conversion_factor,
    u.name AS uom_name,
    COALESCE(u.name_ar, u.name) AS uom_name_ar,
    COALESCE(p.base_uom_id, p.unit_id) AS base_uom_id,
    base_u.name AS base_uom_name,
    COALESCE(base_u.name_ar, base_u.name) AS base_uom_name_ar
   FROM ((((public.sales_invoice_items i
     JOIN public.sales_invoices s ON ((s.id = i.invoice_id)))
     LEFT JOIN public.products p ON ((p.id = i.product_id)))
     LEFT JOIN public.units u ON ((u.id = COALESCE(i.uom_id, p.base_uom_id, p.unit_id))))
     LEFT JOIN public.units base_u ON ((base_u.id = COALESCE(p.base_uom_id, p.unit_id))));

--
-- Name: sales_invoice_items sales_invoice_items_pkey; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.sales_invoice_items
    ADD CONSTRAINT sales_invoice_items_pkey PRIMARY KEY (id);

--
-- Name: idx_sales_invoice_items_product; Type: INDEX; Schema: public; Owner: supabase_admin
--

CREATE INDEX idx_sales_invoice_items_product ON public.sales_invoice_items USING btree (product_id);

--
-- Name: sales_invoice_items sales_invoice_item_allocate_batches; Type: TRIGGER; Schema: public; Owner: supabase_admin
--

CREATE TRIGGER sales_invoice_item_allocate_batches BEFORE INSERT ON public.sales_invoice_items FOR EACH ROW EXECUTE FUNCTION public.allocate_sales_invoice_item_batches();

--
-- Name: sales_invoice_items sales_invoice_items_product_flags; Type: TRIGGER; Schema: public; Owner: supabase_admin
--

CREATE TRIGGER sales_invoice_items_product_flags BEFORE INSERT OR UPDATE ON public.sales_invoice_items FOR EACH ROW EXECUTE FUNCTION public.enforce_invoice_product_flags();

--
-- Name: sales_invoice_items sale_item_view; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY sale_item_view ON public.sales_invoice_items FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));

--
-- Name: sales_invoice_items; Type: ROW SECURITY; Schema: public; Owner: supabase_admin
--

ALTER TABLE public.sales_invoice_items ENABLE ROW LEVEL SECURITY;

--
-- Name: TABLE sales_invoice_items; Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.sales_invoice_items TO service_role;

GRANT SELECT ON TABLE public.sales_invoice_items TO authenticated;


--
-- Name: SEQUENCE quotation_seq; Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT USAGE ON SEQUENCE public.quotation_seq TO service_role;

GRANT SELECT,USAGE ON SEQUENCE public.quotation_seq TO authenticated;


--
-- Name: TABLE sales_invoice_item_batch_allocations; Type: COMMENT; Schema: public; Owner: supabase_admin
--

COMMENT ON TABLE public.sales_invoice_item_batch_allocations IS 'Exact batch quantities consumed by each sale line; batch_id on the invoice line remains a primary-batch compatibility field.';

--
-- Name: sales_invoice_item_batch_allocations sales_invoice_item_batch_allo_sales_invoice_item_id_batch_i_key; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.sales_invoice_item_batch_allocations
    ADD CONSTRAINT sales_invoice_item_batch_allo_sales_invoice_item_id_batch_i_key UNIQUE (sales_invoice_item_id, batch_id);

--
-- Name: sales_invoice_item_batch_allocations sales_invoice_item_batch_allocations_pkey; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.sales_invoice_item_batch_allocations
    ADD CONSTRAINT sales_invoice_item_batch_allocations_pkey PRIMARY KEY (id);

--
-- Name: idx_sales_item_batch_allocations_batch; Type: INDEX; Schema: public; Owner: supabase_admin
--

CREATE INDEX idx_sales_item_batch_allocations_batch ON public.sales_invoice_item_batch_allocations USING btree (batch_id);


--
-- Name: SEQUENCE sales_invoice_seq; Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT SELECT,USAGE ON SEQUENCE public.sales_invoice_seq TO authenticated;


--
-- Name: SEQUENCE sales_order_seq; Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT USAGE ON SEQUENCE public.sales_order_seq TO service_role;

GRANT SELECT,USAGE ON SEQUENCE public.sales_order_seq TO authenticated;


--
-- Name: sales_return_item_batch_allocations sales_return_item_batch_alloc_sales_return_item_id_sales_in_key; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.sales_return_item_batch_allocations
    ADD CONSTRAINT sales_return_item_batch_alloc_sales_return_item_id_sales_in_key UNIQUE (sales_return_item_id, sales_invoice_item_id, batch_id);

--
-- Name: sales_return_item_batch_allocations sales_return_item_batch_allocations_pkey; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.sales_return_item_batch_allocations
    ADD CONSTRAINT sales_return_item_batch_allocations_pkey PRIMARY KEY (id);

--
-- Name: idx_sales_return_batch_allocations_source; Type: INDEX; Schema: public; Owner: supabase_admin
--

CREATE INDEX idx_sales_return_batch_allocations_source ON public.sales_return_item_batch_allocations USING btree (sales_invoice_item_id, batch_id);


--
-- Name: COLUMN sales_return_items.invoice_item_id; Type: COMMENT; Schema: public; Owner: supabase_admin
--

COMMENT ON COLUMN public.sales_return_items.invoice_item_id IS 'P0-1: بند الفاتورة الأصلية الذي يُرجع منه. NULL يعني «أي بند لنفس الصنف» (توافق مع المرتجعات القديمة).';

--
-- Name: sales_return_items sales_return_items_pkey; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.sales_return_items
    ADD CONSTRAINT sales_return_items_pkey PRIMARY KEY (id);

--
-- Name: idx_sales_return_items_invoice_item; Type: INDEX; Schema: public; Owner: supabase_admin
--

CREATE INDEX idx_sales_return_items_invoice_item ON public.sales_return_items USING btree (invoice_item_id) WHERE (invoice_item_id IS NOT NULL);

--
-- Name: idx_sales_return_items_product; Type: INDEX; Schema: public; Owner: supabase_admin
--

CREATE INDEX idx_sales_return_items_product ON public.sales_return_items USING btree (product_id);

--
-- Name: sales_return_items sales_return_item_restore_batches; Type: TRIGGER; Schema: public; Owner: supabase_admin
--

CREATE TRIGGER sales_return_item_restore_batches AFTER INSERT ON public.sales_return_items FOR EACH ROW EXECUTE FUNCTION public.restore_sales_return_item_batches();

--
-- Name: sales_return_items; Type: ROW SECURITY; Schema: public; Owner: supabase_admin
--

ALTER TABLE public.sales_return_items ENABLE ROW LEVEL SECURITY;

--
-- Name: sales_return_items staff read sret_i; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY "staff read sret_i" ON public.sales_return_items FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));

--
-- Name: sales_return_items staff write sret_i; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY "staff write sret_i" ON public.sales_return_items TO authenticated USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

--
-- Name: TABLE sales_return_items; Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.sales_return_items TO service_role;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.sales_return_items TO authenticated;


--
-- Name: SEQUENCE sales_return_seq; Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT SELECT,USAGE ON SEQUENCE public.sales_return_seq TO authenticated;


--
-- Name: sales_returns sales_returns_pkey; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.sales_returns
    ADD CONSTRAINT sales_returns_pkey PRIMARY KEY (id);

--
-- Name: sales_returns sales_returns_return_number_key; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.sales_returns
    ADD CONSTRAINT sales_returns_return_number_key UNIQUE (return_number);

--
-- Name: sales_returns; Type: ROW SECURITY; Schema: public; Owner: supabase_admin
--

ALTER TABLE public.sales_returns ENABLE ROW LEVEL SECURITY;

--
-- Name: sales_returns staff read sret; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY "staff read sret" ON public.sales_returns FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));

--
-- Name: sales_returns staff write sret; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY "staff write sret" ON public.sales_returns TO authenticated USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

--
-- Name: TABLE sales_returns; Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.sales_returns TO service_role;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.sales_returns TO authenticated;



--
-- Name: FUNCTION recalculate_customer_balance(p_customer_id uuid, p_reason text, p_type text); Type: COMMENT; Schema: public; Owner: supabase_admin
--

COMMENT ON FUNCTION public.recalculate_customer_balance(p_customer_id uuid, p_reason text, p_type text) IS 'الدالة المركزية الوحيدة لتحديث الرصيد المخزَّن: تقرأ الدفتر، تحسب الصافي، تكتب customers.balance، وتُسجّل التصحيح في customer_balance_adjustments. لا تحذف أي حركة.';

--
-- Name: FUNCTION recalculate_customer_balance(p_customer_id uuid); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.recalculate_customer_balance(p_customer_id uuid) FROM PUBLIC;

GRANT ALL ON FUNCTION public.recalculate_customer_balance(p_customer_id uuid) TO authenticated;

GRANT ALL ON FUNCTION public.recalculate_customer_balance(p_customer_id uuid) TO service_role;

--
-- Name: FUNCTION recalculate_customer_balance(p_customer_id uuid, p_reason text, p_type text); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.recalculate_customer_balance(p_customer_id uuid, p_reason text, p_type text) FROM PUBLIC;

GRANT ALL ON FUNCTION public.recalculate_customer_balance(p_customer_id uuid, p_reason text, p_type text) TO authenticated;

GRANT ALL ON FUNCTION public.recalculate_customer_balance(p_customer_id uuid, p_reason text, p_type text) TO service_role;


--
-- Name: TRIGGER tg_customer_ledger_sync_balance ON customer_ledger; Type: COMMENT; Schema: public; Owner: supabase_admin
--

COMMENT ON TRIGGER tg_customer_ledger_sync_balance ON public.customer_ledger IS 'مصدر الحقيقة: كل حركة في دفتر العميل تُعيد احتساب الرصيد المخزَّن ذريًا في نفس المعاملة.';

--
-- Name: FUNCTION tg_customer_ledger_sync_balance(); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.tg_customer_ledger_sync_balance() FROM PUBLIC;


--
-- Name: FUNCTION tg_customer_ledger_system_guard(); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.tg_customer_ledger_system_guard() FROM PUBLIC;

GRANT ALL ON FUNCTION public.tg_customer_ledger_system_guard() TO service_role;


--
-- Name: TABLE customer_balance_reconciliation; Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT SELECT ON TABLE public.customer_balance_reconciliation TO authenticated;

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.customer_balance_reconciliation TO service_role;


--
-- Name: VIEW sales_register; Type: COMMENT; Schema: public; Owner: supabase_admin
--

COMMENT ON VIEW public.sales_register IS 'Invoice register: quantity/unit_price remain base-stock values; entered_quantity/entered_unit_price and UoM labels preserve the document unit.';

--
-- Name: service_revenue; Type: VIEW; Schema: public; Owner: supabase_admin
--

CREATE VIEW public.service_revenue WITH (security_invoker='true') AS
 SELECT invoice_id,
    invoice_number,
    created_at,
    customer_id,
    line_type,
    description,
    quantity,
    unit_price,
    total,
    false AS affects_inventory
   FROM public.sales_register r
  WHERE ((line_type = ANY (ARRAY['SERVICE'::text, 'AD_HOC_SERVICE'::text])) AND (status <> ALL (ARRAY['draft'::public.invoice_status, 'cancelled'::public.invoice_status, 'returned'::public.invoice_status])));

--
-- Name: TABLE sales_register; Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT SELECT ON TABLE public.sales_register TO authenticated;

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.sales_register TO service_role;


--
-- Name: TABLE service_revenue; Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT SELECT ON TABLE public.service_revenue TO authenticated;

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.service_revenue TO service_role;

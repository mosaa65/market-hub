-- البيع بالسالب: إزالة الحارس المسبق المتعارض من create_sale عند تفعيل
-- السياسة المركزية. يظل post_stock_delta السلطة النهائية، ولا يسمح بالسالب
-- إلا لصرف مخزون الشركة الناتج من sales_invoice.
BEGIN;

CREATE OR REPLACE FUNCTION public.create_sale(
  _warehouse_id uuid,
  _customer_id uuid,
  _payment_method text,
  _paid numeric,
  _discount numeric,
  _note text,
  _items jsonb,
  _sale_date date,
  _payment_splits jsonb
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_invoice_id uuid;
  v_invoice_number text;
  v_user uuid := auth.uid();
  v_line record;
  v_subtotal numeric := 0;
  v_tax_total numeric := 0;
  v_discount numeric := coalesce(_discount, 0);
  v_total numeric := 0;
  v_paid numeric := 0;
  v_outstanding numeric := 0;
  v_price numeric;
  v_entered_price numeric;
  v_entered_quantity numeric;
  v_conversion_factor numeric;
  v_quantity_increment numeric;
  v_base_quantity numeric;
  v_tax_rate numeric;
  v_customer_balance numeric;
  v_credit_limit numeric;
  v_line_total numeric;
  v_line_tax numeric;
  v_effect text;
  v_line_type text;
  v_sellable boolean;
  v_status public.invoice_status;
  v_last_item_id uuid;
  v_available numeric;
  v_allow_negative_sales boolean := false;
  v_system boolean := false;
  v_posted_at timestamptz;
  v_split record;
  v_split_total numeric := 0;
  v_distinct_methods integer := 0;
  v_recorded_method text := _payment_method;
  v_has_splits boolean := false;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT (public.has_role(v_user, 'owner') OR public.has_role(v_user, 'manager')
          OR public.has_role(v_user, 'cashier')) THEN
    RAISE EXCEPTION 'You are not permitted to post sales';
  END IF;
  IF _warehouse_id IS NULL THEN RAISE EXCEPTION 'Warehouse is required'; END IF;
  IF coalesce(jsonb_typeof(_items), '') <> 'array'
     OR coalesce(jsonb_array_length(_items), 0) = 0 THEN
    RAISE EXCEPTION 'Cart is empty';
  END IF;
  IF v_discount < 0 THEN RAISE EXCEPTION 'Discount cannot be negative'; END IF;
  IF coalesce(_paid, 0) < 0 THEN RAISE EXCEPTION 'Paid amount cannot be negative'; END IF;

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
    IF v_distinct_methods > 1 THEN v_recorded_method := 'split'; END IF;
  ELSE
    IF _payment_method NOT IN ('cash', 'card', 'bank_transfer', 'credit', 'mobile_money', 'cheque') THEN
      RAISE EXCEPTION 'Unsupported payment method: %', _payment_method;
    END IF;
  END IF;

  -- الحارس المبكر يجب أن يطابق post_stock_delta. نقفل صف الإعداد أيضاً كي
  -- لا يتغير القرار في منتصف ترحيل الفاتورة.
  SELECT allow_negative_sales INTO v_allow_negative_sales
    FROM public.company_settings WHERE id = 1 FOR SHARE;
  v_allow_negative_sales := coalesce(v_allow_negative_sales, false);

  FOR v_line IN
    SELECT r.o_product_id AS product_id,
           sum(public.product_quantity_in_base(
             r.o_product_id, r.o_quantity,
             nullif(btrim(coalesce(line ->> 'uom_id', '')), '')::uuid, 'SALE'
           )) AS quantity
    FROM jsonb_array_elements(_items) AS line
    CROSS JOIN LATERAL public.resolve_sale_line(line) AS r
    WHERE r.o_stock_effect = 'STOCK_ISSUE'
    GROUP BY r.o_product_id
    ORDER BY r.o_product_id
  LOOP
    SELECT i.quantity INTO v_available
      FROM public.inventory i
     WHERE i.product_id = v_line.product_id AND i.warehouse_id = _warehouse_id
       AND i.owner_type = 'COMPANY' AND i.owner_id IS NULL
     FOR UPDATE;
    v_available := coalesce(v_available, 0);
    IF NOT v_allow_negative_sales AND v_available < v_line.quantity THEN
      RAISE EXCEPTION 'Insufficient stock for item %: available %, requested %',
        v_line.product_id, v_available, v_line.quantity USING ERRCODE = 'check_violation';
    END IF;
  END LOOP;

  FOR v_line IN
    SELECT r.o_product_id AS product_id, r.o_quantity AS quantity, r.o_service_name AS service_name,
           coalesce((line ->> 'unit_price')::numeric, 0) AS input_price,
           coalesce((line ->> 'tax_rate')::numeric, 0) AS input_tax,
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
      v_price := v_line.input_price; v_tax_rate := v_line.input_tax;
    ELSE
      SELECT p.tax_rate, p.is_sellable INTO v_tax_rate, v_sellable
        FROM public.products p WHERE p.id = v_line.product_id AND p.is_active = true FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'Item % is not available for sale', v_line.product_id; END IF;
      IF v_sellable IS NOT TRUE THEN RAISE EXCEPTION 'Item % is not marked as sellable', v_line.product_id; END IF;
      v_conversion_factor := public.product_uom_factor(v_line.product_id, v_line.uom_id, 'SALE');
      v_entered_price := public.product_uom_price(v_line.product_id, v_line.uom_id, 'SALE');
      v_base_quantity := public.product_quantity_in_base(v_line.product_id, v_line.quantity, v_line.uom_id, 'SALE');
      v_price := round(v_entered_price / v_conversion_factor, 6);
      IF v_entered_price < 0 OR v_tax_rate < 0 OR v_tax_rate > 100 THEN
        RAISE EXCEPTION 'Item % has invalid pricing or tax configuration', v_line.product_id;
      END IF;
    END IF;
    v_line_total := round(v_line.quantity * CASE WHEN v_line.product_id IS NULL THEN v_price ELSE v_entered_price END, 2);
    v_subtotal := v_subtotal + v_line_total;
    v_tax_total := v_tax_total + round(v_line_total * v_tax_rate / 100, 2);
  END LOOP;

  v_total := round(v_subtotal + v_tax_total - v_discount, 2);
  IF v_discount > v_subtotal + v_tax_total OR v_total < 0 THEN
    RAISE EXCEPTION 'Discount cannot exceed the invoice amount';
  END IF;
  IF _customer_id IS NOT NULL THEN
    SELECT balance, credit_limit, is_system INTO v_customer_balance, v_credit_limit, v_system
      FROM public.customers WHERE id = _customer_id AND is_active = true FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Selected customer is unavailable'; END IF;
  END IF;
  v_paid := least(coalesce(_paid, 0), v_total);
  v_outstanding := round(v_total - v_paid, 2);
  IF v_has_splits AND round(v_split_total, 2) <> round(v_paid, 2) THEN
    RAISE EXCEPTION 'Split breakdown total (%) does not match paid amount (%)', round(v_split_total, 2), round(v_paid, 2);
  END IF;
  IF v_outstanding > 0 AND _customer_id IS NULL THEN RAISE EXCEPTION 'A customer is required when the sale has an unpaid amount'; END IF;
  IF v_outstanding > 0 AND v_system THEN
    RAISE EXCEPTION 'The system cash customer cannot carry credit — select a real customer for a deferred sale' USING ERRCODE = 'check_violation';
  END IF;
  IF v_outstanding > 0 AND NOT public.customer_credit_limit_allows(_customer_id, v_outstanding) THEN
    RAISE EXCEPTION 'Credit limit exceeded: current balance %, requested debt %, limit %',
      coalesce(v_customer_balance, 0), v_outstanding, coalesce(v_credit_limit, 0);
  END IF;

  v_status := 'confirmed'::public.invoice_status;
  v_invoice_number := public.next_invoice_number();
  v_posted_at := coalesce(_sale_date, current_date)::timestamp + localtime;
  INSERT INTO public.sales_invoices (
    invoice_number, customer_id, warehouse_id, status, payment_status, subtotal, discount, tax,
    total, paid, payment_method, note, created_by, created_at, updated_at
  ) VALUES (
    v_invoice_number, _customer_id, _warehouse_id, v_status, public.derive_payment_status(v_paid, v_total),
    v_subtotal, v_discount, v_tax_total, v_total, v_paid, v_recorded_method::public.payment_method,
    nullif(btrim(_note), ''), v_user, v_posted_at, now()
  ) RETURNING id INTO v_invoice_id;

  FOR v_line IN
    SELECT r.o_product_id AS product_id, r.o_quantity AS entered_quantity,
           CASE WHEN r.o_product_id IS NULL THEN r.o_quantity ELSE public.product_quantity_in_base(
             r.o_product_id, r.o_quantity, nullif(btrim(coalesce(line ->> 'uom_id', '')), '')::uuid, 'SALE'
           ) END AS quantity,
           r.o_stock_effect AS stock_effect, r.o_service_name AS service_name,
           coalesce((line ->> 'unit_price')::numeric, 0) AS input_price,
           coalesce((line ->> 'tax_rate')::numeric, 0) AS input_tax,
           nullif(btrim(coalesce(line ->> 'uom_id', '')), '')::uuid AS uom_id,
           nullif(btrim(coalesce(line ->> 'batch_id', '')), '')::uuid AS batch_id,
           nullif(btrim(coalesce(line ->> 'batch_number', '')), '') AS batch_number
      FROM jsonb_array_elements(_items) AS line
      CROSS JOIN LATERAL public.resolve_sale_line(line) AS r
  LOOP
    IF v_line.product_id IS NULL THEN
      v_entered_quantity := v_line.entered_quantity; v_conversion_factor := 1; v_quantity_increment := NULL;
      v_entered_price := v_line.input_price; v_price := v_line.input_price; v_tax_rate := v_line.input_tax;
      v_line_type := 'AD_HOC_SERVICE'; v_effect := 'NONE';
    ELSE
      SELECT p.tax_rate INTO v_tax_rate FROM public.products p WHERE p.id = v_line.product_id;
      v_entered_quantity := v_line.entered_quantity;
      v_conversion_factor := public.product_uom_factor(v_line.product_id, v_line.uom_id, 'SALE');
      SELECT pu.quantity_increment INTO v_quantity_increment FROM public.product_uoms pu
       WHERE pu.product_id = v_line.product_id
         AND pu.unit_id = coalesce(v_line.uom_id, (SELECT coalesce(p.base_uom_id, p.unit_id) FROM public.products p WHERE p.id = v_line.product_id))
         AND pu.is_active;
      v_quantity_increment := coalesce(v_quantity_increment, 0.001);
      v_entered_price := public.product_uom_price(v_line.product_id, v_line.uom_id, 'SALE');
      v_price := round(v_entered_price / v_conversion_factor, 6);
      v_line_type := public.item_line_type(v_line.product_id, false);
      v_effect := public.item_stock_effect(v_line.product_id, 'out');
      IF v_effect = 'STOCK_ISSUE' THEN
        PERFORM public.post_stock_delta(
          p_product_id => v_line.product_id, p_warehouse_id => _warehouse_id, p_signed_qty => -v_line.quantity,
          p_unit_cost => NULL, p_movement_kind => 'ISSUE'::public.stock_movement_kind,
          p_source_type => 'sales_invoice', p_source_id => v_invoice_id, p_note => 'POS sale',
          p_owner_type => 'COMPANY'::public.owner_type, p_owner_id => NULL,
          p_movement_type_legacy => 'sale'::public.movement_type
        );
      END IF;
    END IF;
    v_line_total := round(coalesce(v_entered_quantity, v_line.quantity) * v_entered_price, 2);
    v_line_tax := round(v_line_total * v_tax_rate / 100, 2);
    INSERT INTO public.sales_invoice_items (
      invoice_id, product_id, description, quantity, unit_price, discount, tax, total, line_type,
      stock_effect, uom_id, batch_id, batch_number, base_unit_price, entered_quantity, base_quantity,
      uom_conversion_factor, entered_unit_price, uom_quantity_increment
    ) VALUES (
      v_invoice_id, v_line.product_id, CASE WHEN v_line.product_id IS NULL THEN v_line.service_name ELSE NULL END,
      v_line.quantity, v_price, 0, v_line_tax, v_line_total + v_line_tax, v_line_type, v_effect,
      CASE WHEN v_line.product_id IS NULL THEN NULL ELSE coalesce(v_line.uom_id, (SELECT coalesce(p.base_uom_id, p.unit_id) FROM public.products p WHERE p.id = v_line.product_id)) END,
      v_line.batch_id, v_line.batch_number, CASE WHEN v_line.product_id IS NULL THEN NULL ELSE v_price END,
      CASE WHEN v_line.product_id IS NULL THEN NULL ELSE v_entered_quantity END,
      CASE WHEN v_line.product_id IS NULL THEN NULL ELSE v_line.quantity END,
      CASE WHEN v_line.product_id IS NULL THEN NULL ELSE v_conversion_factor END,
      CASE WHEN v_line.product_id IS NULL THEN NULL ELSE v_entered_price END, v_quantity_increment
    ) RETURNING id INTO v_last_item_id;
    IF v_line_type = 'AD_HOC_SERVICE' THEN
      INSERT INTO public.ad_hoc_service_lines (invoice_id, invoice_item_id, description, quantity, unit_price, discount, tax, total, created_by)
      VALUES (v_invoice_id, v_last_item_id, v_line.service_name, v_line.quantity, v_price, 0, v_line_tax, v_line_total + v_line_tax, v_user);
    END IF;
  END LOOP;

  PERFORM set_config('app.stock_engine', 'on', true);
  UPDATE public.stock_movements SET created_at = v_posted_at
    WHERE source_type = 'sales_invoice' AND source_id = v_invoice_id;
  PERFORM set_config('app.stock_engine', 'off', true);
  IF v_outstanding > 0 THEN
    UPDATE public.customers SET balance = round(coalesce(balance, 0) + v_outstanding, 2), updated_at = now() WHERE id = _customer_id;
    INSERT INTO public.customer_ledger (customer_id, entry_type, debit, reference_id, reference_type, occurred_at, created_by, source_key, note)
    VALUES (_customer_id, 'sale', v_outstanding, v_invoice_id, 'sales_invoice', v_posted_at, v_user, 'sale:' || v_invoice_id, 'قيد بيع آجل')
    ON CONFLICT (source_key) DO NOTHING;
  END IF;
  IF v_has_splits THEN
    FOR v_split IN
      SELECT part ->> 'method' AS method, coalesce((part ->> 'amount')::numeric, 0) AS amount,
             nullif(part ->> 'cashbox_id', '')::uuid AS cashbox_id,
             nullif(part ->> 'bank_account_id', '')::uuid AS bank_account_id,
             nullif(part ->> 'payment_method_id', '') AS payment_method_id,
             nullif(btrim(coalesce(part ->> 'reference', '')), '') AS reference
      FROM jsonb_array_elements(_payment_splits) AS part
    LOOP
      IF v_split.amount > 0 THEN
        INSERT INTO public.customer_payment_splits (customer_id, invoice_id, method, amount, occurred_at, created_by, cashbox_id, bank_account_id, payment_method_id, reference_no)
        VALUES (_customer_id, v_invoice_id, v_split.method::public.payment_method, round(v_split.amount, 2), v_posted_at, v_user, v_split.cashbox_id, v_split.bank_account_id, coalesce(v_split.payment_method_id, v_split.method), v_split.reference);
      END IF;
    END LOOP;
  END IF;
  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, payload)
  VALUES (v_user, 'sale.posted', 'sales_invoice', v_invoice_id, jsonb_build_object(
    'invoice_number', v_invoice_number, 'warehouse_id', _warehouse_id, 'customer_id', _customer_id,
    'payment_method', v_recorded_method, 'total', v_total, 'paid', v_paid, 'outstanding', v_outstanding,
    'has_splits', v_has_splits, 'split_count', CASE WHEN v_has_splits THEN jsonb_array_length(_payment_splits) ELSE 0 END,
    'line_count', jsonb_array_length(_items)
  ));
  PERFORM set_config('app.payment_split_internal_post', 'on', true);
  PERFORM public.post_sales_invoice(v_invoice_id);
  PERFORM set_config('app.payment_split_internal_post', 'off', true);
  RETURN v_invoice_id;
END;
$$;

COMMIT;

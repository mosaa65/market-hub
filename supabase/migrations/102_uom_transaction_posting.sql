-- Enable product-specific units of measure in the atomic purchase, sales, and return posting paths.
-- Inventory, batch, and cost movements continue to use the product base unit. Existing invoice
-- rows remain unchanged; new rows record entered quantity, factor, base quantity, and unit price.
BEGIN;

-- Legacy unit_price/unit_cost columns are used by existing views and stay at
-- their current scale. Exact base-unit prices are stored separately so package
-- prices such as 10 / 3 do not lose precision in valuation or returns.
ALTER TABLE public.sales_invoice_items
  ADD COLUMN base_unit_price numeric(18,6),
  ADD COLUMN uom_quantity_increment numeric(30,12),
  ADD CONSTRAINT sales_invoice_items_base_unit_price_nonnegative
    CHECK (base_unit_price IS NULL OR base_unit_price >= 0),
  ADD CONSTRAINT sales_invoice_items_uom_increment_positive
    CHECK (uom_quantity_increment IS NULL OR uom_quantity_increment > 0);
ALTER TABLE public.purchase_invoice_items
  ADD COLUMN base_unit_cost numeric(18,6),
  ADD COLUMN uom_quantity_increment numeric(30,12),
  ADD CONSTRAINT purchase_invoice_items_base_unit_cost_nonnegative
    CHECK (base_unit_cost IS NULL OR base_unit_cost >= 0),
  ADD CONSTRAINT purchase_invoice_items_uom_increment_positive
    CHECK (uom_quantity_increment IS NULL OR uom_quantity_increment > 0);

-- Return lines must point to the exact source invoice line. Product-only
-- matching is ambiguous when one product is sold/purchased at multiple prices.
ALTER TABLE public.purchase_return_items
  ADD COLUMN invoice_item_id uuid;
CREATE INDEX purchase_return_items_invoice_item_idx
  ON public.purchase_return_items(invoice_item_id)
  WHERE invoice_item_id IS NOT NULL;
COMMENT ON COLUMN public.purchase_return_items.invoice_item_id IS
  'Original purchase invoice line whose unit, conversion, price, and lot define this return.';

ALTER TABLE public.sales_return_items
  ADD COLUMN uom_id uuid REFERENCES public.units(id) ON DELETE SET NULL,
  ADD COLUMN uom_quantity_increment numeric(30,12),
  ADD COLUMN entered_quantity numeric(18,6),
  ADD COLUMN base_quantity numeric(18,6),
  ADD COLUMN uom_conversion_factor numeric(30,12),
  ADD COLUMN entered_unit_price numeric(18,4),
  ADD CONSTRAINT sales_return_items_uom_snapshot_check CHECK (
    num_nonnulls(entered_quantity, base_quantity, uom_conversion_factor, entered_unit_price, uom_quantity_increment) IN (0, 5)
    AND (entered_quantity IS NULL OR (entered_quantity > 0 AND base_quantity > 0
      AND uom_conversion_factor > 0 AND entered_unit_price >= 0 AND uom_quantity_increment > 0))
  );

ALTER TABLE public.purchase_return_items
  ADD COLUMN uom_id uuid REFERENCES public.units(id) ON DELETE SET NULL,
  ADD COLUMN uom_quantity_increment numeric(30,12),
  ADD COLUMN entered_quantity numeric(18,6),
  ADD COLUMN base_quantity numeric(18,6),
  ADD COLUMN uom_conversion_factor numeric(30,12),
  ADD COLUMN entered_unit_cost numeric(18,4),
  ADD CONSTRAINT purchase_return_items_uom_snapshot_check CHECK (
    num_nonnulls(entered_quantity, base_quantity, uom_conversion_factor, entered_unit_cost, uom_quantity_increment) IN (0, 5)
    AND (entered_quantity IS NULL OR (entered_quantity > 0 AND base_quantity > 0
      AND uom_conversion_factor > 0 AND entered_unit_cost >= 0 AND uom_quantity_increment > 0))
  );

ALTER TABLE public.sales_invoice_items
  DROP CONSTRAINT sales_invoice_items_uom_snapshot_check,
  ADD CONSTRAINT sales_invoice_items_uom_snapshot_check CHECK (
    num_nonnulls(entered_quantity, base_quantity, uom_conversion_factor, entered_unit_price, uom_quantity_increment) IN (0, 5)
    AND (entered_quantity IS NULL OR (entered_quantity > 0 AND base_quantity > 0
      AND uom_conversion_factor > 0 AND entered_unit_price >= 0 AND uom_quantity_increment > 0))
  );
ALTER TABLE public.purchase_invoice_items
  DROP CONSTRAINT purchase_invoice_items_uom_snapshot_check,
  ADD CONSTRAINT purchase_invoice_items_uom_snapshot_check CHECK (
    num_nonnulls(entered_quantity, base_quantity, uom_conversion_factor, entered_unit_cost, uom_quantity_increment) IN (0, 5)
    AND (entered_quantity IS NULL OR (entered_quantity > 0 AND base_quantity > 0
      AND uom_conversion_factor > 0 AND entered_unit_cost >= 0 AND uom_quantity_increment > 0))
  );

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
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
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

CREATE OR REPLACE FUNCTION public.create_purchase(
  _warehouse_id uuid,
  _supplier_id uuid,
  _payment_method text,
  _paid numeric,
  _discount numeric,
  _note text,
  _items jsonb,
  _payment_splits jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
END $function$;

CREATE OR REPLACE FUNCTION public.create_sales_return(
  _invoice_id uuid,
  _warehouse_id uuid,
  _customer_id uuid,
  _refund_method text,
  _note text,
  _items jsonb
)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
     OR NOT (_refund_method::public.payment_method = ANY (ARRAY['cash','card','bank_transfer','mobile_money','split']::public.payment_method[])) THEN
    RAISE EXCEPTION 'A return refund method cannot be credit — pick the account the money leaves from';
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

  -- العميل فقط إن كان للفاتورة عميل. النقدي يُسوّى على الصندوق/البنك في القيد.
  IF v_inv.customer_id IS NOT NULL THEN
    UPDATE public.customers
    SET balance = round(coalesce(balance, 0) - v_tot, 2), updated_at = now()
    WHERE id = v_inv.customer_id;

    INSERT INTO public.customer_ledger (
      customer_id, entry_type, credit, reference_id, reference_type,
      occurred_at, created_by, source_key, note
    )
    VALUES (
      v_inv.customer_id, 'return', round(v_tot, 2), v_id, 'sales_return',
      now(), v_user, 'return:' || v_id, 'مرتجع مبيعات'
    )
    ON CONFLICT (source_key) DO NOTHING;
  END IF;

  -- ── القيد: يعكس إيراد البيع وضريبته وCOGS، وللفاتورة النقدية يخرج نقداً ──
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

  v_cash_acct := public.payment_method_ledger_account(_refund_method::text);
  IF v_cash_acct IS NOT NULL THEN
    v_lines := v_lines || jsonb_build_object(
      'account_code', v_cash_acct, 'credit', round(v_tot, 2),
      'memo', 'استرداد للعميل');
  ELSE
    v_lines := v_lines || jsonb_build_object(
      'account_code', '1211', 'credit', round(v_tot, 2),
      'partner_type', 'customer', 'partner_id', v_inv.customer_id,
      'memo', 'عكس ذم العميل');
  END IF;

  -- عكس COGS بقيمة الحركة الفعلية التي أعادتها post_stock_delta.
  FOR r IN
    SELECT p.item_class,
           sum(coalesce(sm.total_cost, 0)) AS cost
      FROM public.sales_return_items ri
      JOIN public.products p ON p.id = ri.product_id
      LEFT JOIN public.stock_movements sm
        ON sm.product_id = ri.product_id
       AND sm.source_type = 'sales_return'
       AND sm.source_id = v_id
       AND sm.warehouse_id = v_inv.warehouse_id
     WHERE ri.return_id = v_id
       AND public.item_stock_effect(ri.product_id, 'in') = 'STOCK_RECEIPT'
     GROUP BY p.item_class
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
      'journal_entry_id', v_entry
    ));

  RETURN v_id;
END $function$;

CREATE OR REPLACE FUNCTION public.create_purchase_return(_invoice_id uuid, _warehouse_id uuid, _supplier_id uuid, _refund_method text, _note text, _items jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    -- عكس المخزون/مصروف المشتريات (صافي ضريبة البند)، مجمّعًا حسب النوع.
    FOR r IN
      SELECT p.item_class,
             sum(ri.total - coalesce(ri.tax, 0)) AS net_amount
        FROM public.purchase_return_items ri
        LEFT JOIN public.products p ON p.id = ri.product_id
       WHERE ri.return_id = v_id
       GROUP BY p.item_class
      HAVING sum(ri.total - coalesce(ri.tax, 0)) <> 0
    LOOP
      v_lines := v_lines || jsonb_build_object(
        'account_code', CASE r.item_class
                          WHEN 'RAW_MATERIAL' THEN '1311'
                          WHEN 'BY_PRODUCT'   THEN '1314'
                          WHEN 'SERVICE'      THEN '5911'
                          ELSE '1313' END,
        'credit', round(r.net_amount, 2),
        'memo', 'مرتجع مشتريات ' || coalesce(r.item_class, 'GOOD'));
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
END $function$;

-- Keep batch restoration/consumption tied to the precise source invoice line
-- selected by create_*_return; same-product lines can have different lots.
CREATE OR REPLACE FUNCTION public.restore_sales_return_item_batches()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.consume_purchase_return_item_batches()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_invoice_id uuid;
  v_warehouse_id uuid;
  v_tracking public.item_tracking;
  v_remaining numeric := NEW.quantity;
  v_take numeric;
  v_source record;
BEGIN
  SELECT pr.invoice_id, pr.warehouse_id INTO v_invoice_id, v_warehouse_id
    FROM public.purchase_returns pr WHERE pr.id = NEW.return_id FOR UPDATE;
  IF v_invoice_id IS NULL THEN
    SELECT tracking INTO v_tracking FROM public.products WHERE id = NEW.product_id;
    IF v_tracking = 'BATCH'::public.item_tracking THEN
      RAISE EXCEPTION 'Batch-tracked purchase returns must reference the original purchase invoice'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  PERFORM 1 FROM public.purchase_invoices WHERE id = v_invoice_id FOR UPDATE;
  SELECT tracking INTO v_tracking FROM public.products WHERE id = NEW.product_id;
  IF v_tracking <> 'BATCH'::public.item_tracking THEN RETURN NEW; END IF;

  FOR v_source IN
    SELECT pii.id AS invoice_item_id, pb.id AS batch_id, pb.quantity AS batch_quantity,
           pii.quantity - coalesce((
             SELECT sum(ra.quantity) FROM public.purchase_return_item_batch_allocations ra
              WHERE ra.purchase_invoice_item_id = pii.id
           ), 0) AS returnable
      FROM public.purchase_invoice_items pii
      JOIN public.product_batches pb
        ON pb.product_id = pii.product_id AND pb.warehouse_id = v_warehouse_id
       AND pb.batch_number = pii.batch_number
     WHERE pii.invoice_id = v_invoice_id AND pii.product_id = NEW.product_id
       AND (NEW.invoice_item_id IS NULL OR pii.id = NEW.invoice_item_id)
       AND pii.stock_effect = 'STOCK_RECEIPT'
       AND pii.quantity > coalesce((
         SELECT sum(ra.quantity) FROM public.purchase_return_item_batch_allocations ra
          WHERE ra.purchase_invoice_item_id = pii.id
       ), 0)
     ORDER BY pii.id, pb.id
     FOR UPDATE OF pb
  LOOP
    EXIT WHEN v_remaining <= 0;
    IF v_source.batch_quantity <= 0 THEN CONTINUE; END IF;
    v_take := least(v_source.returnable, v_remaining, v_source.batch_quantity);
    UPDATE public.product_batches SET quantity = round(quantity - v_take, 3), updated_at = now()
     WHERE id = v_source.batch_id;
    INSERT INTO public.purchase_return_item_batch_allocations(
      purchase_return_item_id, purchase_invoice_item_id, batch_id, quantity
    ) VALUES (NEW.id, v_source.invoice_item_id, v_source.batch_id, v_take);
    v_remaining := v_remaining - v_take;
  END LOOP;

  IF v_remaining > 0 THEN
    RAISE EXCEPTION 'Original purchase invoice line does not have enough remaining lot quantity for % base units', v_remaining
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.create_sale(uuid, uuid, text, numeric, numeric, text, jsonb, date, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_sale(uuid, uuid, text, numeric, numeric, text, jsonb, date, jsonb) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.create_purchase(uuid, uuid, text, numeric, numeric, text, jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_purchase(uuid, uuid, text, numeric, numeric, text, jsonb, jsonb) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.create_sales_return(uuid, uuid, uuid, text, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_sales_return(uuid, uuid, uuid, text, text, jsonb) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.create_purchase_return(uuid, uuid, uuid, text, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_purchase_return(uuid, uuid, uuid, text, text, jsonb) TO authenticated, service_role;

COMMENT ON TABLE public.product_uoms IS
  'Active item-specific purchase and sales units; stock quantities, batches, and valuation remain in the product base unit.';
COMMENT ON COLUMN public.purchase_return_items.invoice_item_id IS
  'Exact source purchase invoice line used to validate quantity, historical unit conversion, price, and batch return.';

COMMIT;

-- Rollback (manual only): restore create_sale, create_purchase, create_sales_return,
-- create_purchase_return and the two batch-return trigger functions to their
-- pre-102 definitions. Then remove the 102-only constraints/FKs, purchase-return
-- source-line index and columns (including exact base-price and UoM snapshots).
-- Review posted documents first; never discard snapshots from live transactions.

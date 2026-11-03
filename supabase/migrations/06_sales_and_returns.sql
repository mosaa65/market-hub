-- ============================================================================
-- 07_sales_and_returns.sql
--
-- المبيعات ومرتجعاتها والتحصيلات.
--
-- مُستخرج من الحالة النهائية الحقيقية لقاعدة البيانات، لا من تاريخ الملفات.
-- لا يحتوي أي بيانات أعمال أو تجارية. راجع supabase/MIGRATIONS_RULES.md
-- ============================================================================

-- ── TABLES ────────────────────────────────────────────────────────────────
CREATE TABLE public.sales_invoices (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  invoice_number text NOT NULL,
  customer_id uuid,
  warehouse_id uuid,
  -- حالة الدورة: مسودة / مؤكدة / ملغاة / مُرجَعة. لا تُكتب من مبلغ السداد.
  status public.invoice_status DEFAULT 'draft'::invoice_status NOT NULL,
  -- حالة السداد: غير مدفوعة / جزئية / مدفوعة / مدفوعة بالزيادة.
  -- منفصلة عن status لأن العمود الواحد لا يحمل قيمتين: فاتورة «مؤكدة»
  -- و«مدفوعة جزئيًا» في وقت واحد يستحيل تمثيلها بعمود واحد.
  -- تُشتقّ من (paid مقابل total) ولا تُكتب يدويًا.
  payment_status public.payment_status DEFAULT 'unpaid'::payment_status NOT NULL,
  subtotal numeric(14,2) DEFAULT 0 NOT NULL,
  discount numeric(14,2) DEFAULT 0 NOT NULL,
  tax numeric(14,2) DEFAULT 0 NOT NULL,
  total numeric(14,2) DEFAULT 0 NOT NULL,
  paid numeric(14,2) DEFAULT 0 NOT NULL,
  payment_method public.payment_method,
  note text,
  created_by uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

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
  uom_id uuid
);

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
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

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
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.sales_return_items (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  return_id uuid NOT NULL,
  product_id uuid NOT NULL,
  quantity numeric NOT NULL,
  unit_price numeric NOT NULL,
  tax numeric DEFAULT 0 NOT NULL,
  total numeric DEFAULT 0 NOT NULL,
  line_type text
);

CREATE TABLE public.customer_payments (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  customer_id uuid NOT NULL,
  invoice_id uuid,
  amount numeric(14,2) NOT NULL,
  payment_method public.payment_method DEFAULT 'cash'::payment_method NOT NULL,
  payment_date date DEFAULT CURRENT_DATE NOT NULL,
  note text,
  created_by uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.customer_payment_splits (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  customer_id uuid,
  invoice_id uuid,
  payment_id uuid,
  method public.payment_method NOT NULL,
  amount numeric(14,2) NOT NULL,
  occurred_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- ── CONSTRAINTS ───────────────────────────────────────────────────────────
ALTER TABLE public.sales_invoices ADD CONSTRAINT "sales_invoices_pkey" PRIMARY KEY (id);
ALTER TABLE public.sales_invoices ADD CONSTRAINT "sales_invoices_invoice_number_key" UNIQUE (invoice_number);
ALTER TABLE public.sales_invoice_items ADD CONSTRAINT "sales_invoice_items_line_type_valid" CHECK (((line_type IS NULL) OR (line_type = ANY (ARRAY['STOCKED_GOOD'::text, 'UNTRACKED_GOOD'::text, 'SERVICE'::text, 'CUSTOMER_OWNED_GOOD'::text, 'AD_HOC_SERVICE'::text]))));
ALTER TABLE public.sales_invoice_items ADD CONSTRAINT "sales_invoice_items_stock_effect_valid" CHECK (((stock_effect IS NULL) OR (stock_effect = ANY (ARRAY['STOCK_ISSUE'::text, 'STOCK_RECEIPT'::text, 'NONE'::text]))));
ALTER TABLE public.sales_invoice_items ADD CONSTRAINT "sales_invoice_items_pkey" PRIMARY KEY (id);
ALTER TABLE public.ad_hoc_service_lines ADD CONSTRAINT "ad_hoc_service_lines_quantity_check" CHECK ((quantity > (0)::numeric));
ALTER TABLE public.ad_hoc_service_lines ADD CONSTRAINT "ad_hoc_service_lines_unit_price_check" CHECK ((unit_price >= (0)::numeric));
ALTER TABLE public.ad_hoc_service_lines ADD CONSTRAINT "ad_hoc_service_lines_pkey" PRIMARY KEY (id);
ALTER TABLE public.sales_returns ADD CONSTRAINT "sales_returns_pkey" PRIMARY KEY (id);
ALTER TABLE public.sales_returns ADD CONSTRAINT "sales_returns_return_number_key" UNIQUE (return_number);
ALTER TABLE public.sales_return_items ADD CONSTRAINT "sales_return_items_quantity_check" CHECK ((quantity > (0)::numeric));
ALTER TABLE public.sales_return_items ADD CONSTRAINT "sales_return_items_pkey" PRIMARY KEY (id);
ALTER TABLE public.customer_payments ADD CONSTRAINT "customer_payments_amount_check" CHECK ((amount > (0)::numeric));
ALTER TABLE public.customer_payments ADD CONSTRAINT "customer_payments_pkey" PRIMARY KEY (id);
ALTER TABLE public.customer_payment_splits ADD CONSTRAINT "customer_payment_splits_amount_check" CHECK ((amount > (0)::numeric));
ALTER TABLE public.customer_payment_splits ADD CONSTRAINT "customer_payment_splits_pkey" PRIMARY KEY (id);

-- ── INDEXES ───────────────────────────────────────────────────────────────
CREATE INDEX idx_sales_invoice_items_product ON public.sales_invoice_items USING btree (product_id);
CREATE INDEX idx_ad_hoc_service_lines_invoice ON public.ad_hoc_service_lines USING btree (invoice_id);
CREATE INDEX idx_sales_return_items_product ON public.sales_return_items USING btree (product_id);
CREATE INDEX idx_customer_payments_customer ON public.customer_payments USING btree (customer_id, payment_date DESC);
CREATE INDEX idx_customer_payments_invoice ON public.customer_payments USING btree (invoice_id);
CREATE INDEX customer_payment_splits_invoice_idx ON public.customer_payment_splits USING btree (invoice_id, occurred_at DESC);
CREATE INDEX customer_payment_splits_occurred_at_idx ON public.customer_payment_splits USING btree (occurred_at DESC);

-- ── FUNCTIONS ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.create_sale(_warehouse_id uuid, _customer_id uuid, _payment_method text, _paid numeric, _discount numeric, _note text, _items jsonb, _sale_date date, _payment_splits jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_invoice_id         uuid;
  v_total              numeric;
  v_paid               numeric;
  v_user               uuid := auth.uid();
  v_split              record;
  v_component_count    integer := 0;
  v_split_total        numeric := 0;
  v_distinct_methods   integer := 0;
  v_single_method      text;
  v_recorded_method    text := _payment_method;
BEGIN
  IF coalesce(jsonb_typeof(_payment_splits), 'jsonb') <> 'array'
     OR coalesce(jsonb_array_length(_payment_splits), 0) = 0 THEN
    -- No breakdown supplied: exact legacy behaviour.
    RETURN public.create_sale(
      _warehouse_id, _customer_id, _payment_method, _paid, _discount, _note, _items, _sale_date
    );
  END IF;

  FOR v_split IN
    SELECT (part ->> 'method') AS method,
           coalesce((part ->> 'amount')::numeric, 0) AS amount
    FROM jsonb_array_elements(_payment_splits) AS part
  LOOP
    IF v_split.method IS NULL
      OR v_split.method NOT IN ('cash', 'card', 'bank_transfer', 'mobile_money', 'split') THEN
      RAISE EXCEPTION 'Unsupported payment method: %', v_split.method;
    END IF;
    IF v_split.amount <= 0 THEN
      RAISE EXCEPTION 'Every payment tender component requires a positive amount';
    END IF;

    v_component_count := v_component_count + 1;
    v_split_total := v_split_total + v_split.amount;
  END LOOP;

  SELECT count(DISTINCT part ->> 'method'), min(part ->> 'method')
    INTO v_distinct_methods, v_single_method
  FROM jsonb_array_elements(_payment_splits) AS part;

  -- The tender breakdown and the paid amount must agree, otherwise the invoice
  -- and the recorded payments would drift apart.
  IF round(v_split_total, 2) <> round(coalesce(_paid, 0), 2) THEN
    RAISE EXCEPTION
      'Payment breakdown total % does not match the paid amount %',
      round(v_split_total, 2), round(coalesce(_paid, 0), 2);
  END IF;

  v_recorded_method := CASE
    WHEN v_distinct_methods > 1 THEN 'split'
    ELSE v_single_method
  END;

  v_invoice_id := public.create_sale(
    _warehouse_id, _customer_id, v_recorded_method, _paid, _discount, _note, _items, _sale_date
  );

  SELECT total, paid INTO v_total, v_paid FROM public.sales_invoices WHERE id = v_invoice_id;

  UPDATE public.sales_invoices
  SET payment_method = v_recorded_method::public.payment_method, updated_at = now()
  WHERE id = v_invoice_id
    AND payment_method IS DISTINCT FROM v_recorded_method::public.payment_method;

  FOR v_split IN
    SELECT (part ->> 'method') AS method,
           coalesce((part ->> 'amount')::numeric, 0) AS amount
    FROM jsonb_array_elements(_payment_splits) AS part
  LOOP
    INSERT INTO public.customer_payment_splits (
      customer_id, invoice_id, method, amount, occurred_at, created_by
    )
    VALUES (
      _customer_id, v_invoice_id, v_split.method::public.payment_method,
      round(v_split.amount, 2),
      coalesce(_sale_date, current_date)::timestamp + localtime,
      v_user
    );
  END LOOP;

  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, payload)
  VALUES (v_user, 'sale.tender_breakdown.recorded', 'sales_invoice', v_invoice_id,
    jsonb_build_object(
      'recorded_payment_method', v_recorded_method,
      'components', v_component_count,
      'tender_total', round(v_split_total, 2),
      'total', v_total,
      'paid', v_paid
    ));

  RETURN v_invoice_id;
END $function$;

CREATE OR REPLACE FUNCTION public.create_sale(_warehouse_id uuid, _customer_id uuid, _payment_method text, _paid numeric, _discount numeric, _note text, _items jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  v_tax_rate       numeric;
  v_cost           numeric;
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

  IF _payment_method NOT IN ('cash', 'card', 'bank_transfer', 'credit', 'mobile_money', 'split') THEN
    RAISE EXCEPTION 'Unsupported payment method';
  END IF;

  IF v_discount < 0 THEN
    RAISE EXCEPTION 'Discount cannot be negative';
  END IF;

  IF coalesce(_paid, 0) < 0 THEN
    RAISE EXCEPTION 'Paid amount cannot be negative';
  END IF;

  -- ============================================================== VALIDATION
  -- Only lines whose policy is STOCK_ISSUE are stock-checked. Aggregating by
  -- item and locking the inventory row protects against concurrent checkouts.
  FOR v_line IN
    SELECT r.o_product_id AS product_id, sum(r.o_quantity) AS quantity
    FROM jsonb_array_elements(_items) AS line
    CROSS JOIN LATERAL public.resolve_sale_line(line) AS r
    WHERE r.o_stock_effect = 'STOCK_ISSUE'
    GROUP BY r.o_product_id
    ORDER BY r.o_product_id
  LOOP
    SELECT i.quantity
      INTO v_available
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

  -- Totals. Catalogue price wins for a catalogue item; the operator's price is
  -- used only for ad-hoc service lines.
  FOR v_line IN
    SELECT r.o_product_id    AS product_id,
           r.o_quantity      AS quantity,
           r.o_service_name  AS service_name,
           coalesce((line ->> 'unit_price')::numeric, 0) AS input_price,
           coalesce((line ->> 'tax_rate')::numeric, 0)   AS input_tax
    FROM jsonb_array_elements(_items) AS line
    CROSS JOIN LATERAL public.resolve_sale_line(line) AS r
  LOOP
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
      SELECT p.sale_price, p.tax_rate, p.is_sellable
        INTO v_price, v_tax_rate, v_sellable
      FROM public.products p
      WHERE p.id = v_line.product_id AND p.is_active = true
      FOR UPDATE;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Item % is not available for sale', v_line.product_id;
      END IF;

      IF v_sellable IS NOT TRUE THEN
        RAISE EXCEPTION 'Item % is not marked as sellable', v_line.product_id;
      END IF;

      IF v_price < 0 OR v_tax_rate < 0 OR v_tax_rate > 100 THEN
        RAISE EXCEPTION 'Item % has invalid pricing or tax configuration', v_line.product_id;
      END IF;
    END IF;

    v_line_total := round(v_line.quantity * v_price, 2);
    v_subtotal   := v_subtotal + v_line_total;
    v_tax_total  := v_tax_total + round(v_line_total * v_tax_rate / 100, 2);
  END LOOP;

  v_total := round(v_subtotal + v_tax_total - v_discount, 2);
  IF v_discount > v_subtotal + v_tax_total OR v_total < 0 THEN
    RAISE EXCEPTION 'Discount cannot exceed the invoice amount';
  END IF;

  IF _customer_id IS NOT NULL THEN
    SELECT balance, credit_limit
      INTO v_customer_balance, v_credit_limit
    FROM public.customers
    WHERE id = _customer_id AND is_active = true
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Selected customer is unavailable';
    END IF;
  END IF;

  -- Tender above the total is change, not revenue and not credit.
  v_paid := least(coalesce(_paid, 0), v_total);
  v_outstanding := round(v_total - v_paid, 2);

  IF v_outstanding > 0 AND _customer_id IS NULL THEN
    RAISE EXCEPTION 'A customer is required when the sale has an unpaid amount';
  END IF;
  IF v_outstanding > 0 AND NOT public.customer_credit_limit_allows(_customer_id, v_outstanding) THEN
    RAISE EXCEPTION
      'Credit limit exceeded: current balance %, requested debt %, limit %',
      coalesce(v_customer_balance, 0), v_outstanding, coalesce(v_credit_limit, 0);
  END IF;

  -- حالة الدورة: فاتورة أُنشئت وهي مؤكدة (أثرها المالي واقع بعد الإنشاء).
  -- السداد له عمود مستقل فلا يمحو «مؤكدة».
  v_status := 'confirmed'::public.invoice_status;

  v_invoice_number := public.next_invoice_number();

  INSERT INTO public.sales_invoices (
    invoice_number, customer_id, warehouse_id, status, payment_status,
    subtotal, discount, tax, total, paid, payment_method, note, created_by
  )
  VALUES (
    v_invoice_number, _customer_id, _warehouse_id, v_status,
    -- payment_status يُشتقّ من paid مقابل total، ولا يُكتب يدويًا.
    public.derive_payment_status(v_paid, v_total),
    v_subtotal, v_discount, v_tax_total, v_total, v_paid,
    _payment_method::public.payment_method, nullif(btrim(_note), ''), v_user
  )
  RETURNING id INTO v_invoice_id;

  -- ================================================================== POSTING
  FOR v_line IN
    SELECT r.o_product_id   AS product_id,
           r.o_quantity     AS quantity,
           r.o_stock_effect AS stock_effect,
           r.o_service_name AS service_name,
           coalesce((line ->> 'unit_price')::numeric, 0) AS input_price,
           coalesce((line ->> 'tax_rate')::numeric, 0)   AS input_tax,
           nullif(btrim(coalesce(line ->> 'uom_id', '')), '')::uuid AS uom_id
    FROM jsonb_array_elements(_items) AS line
    CROSS JOIN LATERAL public.resolve_sale_line(line) AS r
  LOOP
    v_cost := NULL;

    IF v_line.product_id IS NULL THEN
      v_price     := v_line.input_price;
      v_tax_rate  := v_line.input_tax;
      v_line_type := 'AD_HOC_SERVICE';
      v_effect    := 'NONE';
    ELSE
      SELECT p.sale_price, p.tax_rate, p.cost_price
        INTO v_price, v_tax_rate, v_cost
      FROM public.products p WHERE p.id = v_line.product_id;

      v_line_type := public.item_line_type(v_line.product_id, false);
      -- Re-derive the effect at posting time so a policy change between
      -- validation and posting cannot slip a movement through unannounced.
      v_effect := public.item_stock_effect(v_line.product_id, 'out');

      IF v_effect = 'STOCK_ISSUE' THEN
        PERFORM public.post_stock_delta(
          v_line.product_id,
          _warehouse_id,
          -v_line.quantity,
          v_cost,
          'ISSUE'::public.stock_movement_kind,
          'sales_invoice',
          v_invoice_id,
          'POS sale',
          'COMPANY'::public.owner_type,
          NULL,
          'sale'::public.movement_type
        );
      END IF;
    END IF;

    v_line_total := round(v_line.quantity * v_price, 2);
    v_line_tax   := round(v_line_total * v_tax_rate / 100, 2);

    INSERT INTO public.sales_invoice_items (
      invoice_id, product_id, description, quantity, unit_price, discount, tax, total,
      line_type, stock_effect, uom_id
    )
    VALUES (
      v_invoice_id,
      v_line.product_id,
      CASE WHEN v_line.product_id IS NULL THEN v_line.service_name ELSE NULL END,
      v_line.quantity, v_price, 0, v_line_tax, v_line_total + v_line_tax,
      v_line_type, v_effect, v_line.uom_id
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
      now(), v_user, 'sale:' || v_invoice_id, 'قيد بيع آجل'
    )
    ON CONFLICT (source_key) DO NOTHING;
  END IF;

  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, payload)
  VALUES (v_user, 'sale.posted', 'sales_invoice', v_invoice_id,
    jsonb_build_object(
      'invoice_number', v_invoice_number,
      'warehouse_id', _warehouse_id,
      'customer_id', _customer_id,
      'payment_method', _payment_method,
      'total', v_total,
      'paid', v_paid,
      'outstanding', v_outstanding,
      'line_count', jsonb_array_length(_items)
    ));

  RETURN v_invoice_id;
END $function$;

CREATE OR REPLACE FUNCTION public.create_sale(_warehouse_id uuid, _customer_id uuid, _payment_method text, _paid numeric, _discount numeric, _note text, _items jsonb, _sale_date date)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_invoice_id uuid;
  v_posted_at  timestamptz;
BEGIN
  IF _sale_date IS NULL THEN
    RAISE EXCEPTION 'Sale date is required';
  END IF;

  IF coalesce(jsonb_typeof(_items), '') <> 'array'
     OR coalesce(jsonb_array_length(_items), 0) = 0 THEN
    RAISE EXCEPTION 'Cart is empty';
  END IF;

  -- All validation, stock movement, ledger posting and auditing happen here.
  v_invoice_id := public.create_sale(
    _warehouse_id, _customer_id, _payment_method, _paid, _discount, _note, _items
  );

  v_posted_at := _sale_date::timestamp + localtime;

  UPDATE public.sales_invoices
  SET created_at = v_posted_at, updated_at = now()
  WHERE id = v_invoice_id;

  UPDATE public.stock_movements
  SET created_at = v_posted_at
  WHERE source_type = 'sales_invoice' AND source_id = v_invoice_id;

  RETURN v_invoice_id;
END $function$;

CREATE OR REPLACE FUNCTION public.create_sales_return(_invoice_id uuid, _warehouse_id uuid, _customer_id uuid, _refund_method text, _note text, _items jsonb)
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
  v_tr        numeric;
  v_lt        numeric;
  v_ltax      numeric;
  v_p         uuid;
  v_effect    text;
  v_type      text;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT public.is_staff(v_user) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  IF coalesce(jsonb_array_length(_items), 0) = 0 THEN
    RAISE EXCEPTION 'No items';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(_items) LOOP
    v_qty   := (v_item ->> 'quantity')::numeric;
    v_price := (v_item ->> 'unit_price')::numeric;
    v_tr    := coalesce((v_item ->> 'tax_rate')::numeric, 0);
    v_lt    := v_qty * v_price;
    v_ltax  := v_lt * v_tr / 100;
    v_sub   := v_sub + v_lt;
    v_tax   := v_tax + v_ltax;
  END LOOP;
  v_tot := v_sub + v_tax;
  v_no  := public.next_sales_return_number();

  INSERT INTO public.sales_returns (
    return_number, invoice_id, customer_id, warehouse_id,
    subtotal, tax, total, refund_method, note, created_by
  )
  VALUES (
    v_no, _invoice_id, _customer_id, _warehouse_id,
    v_sub, v_tax, v_tot, _refund_method::public.payment_method,
    nullif(btrim(_note), ''), v_user
  )
  RETURNING id INTO v_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(_items) LOOP
    v_p     := (v_item ->> 'product_id')::uuid;
    v_qty   := (v_item ->> 'quantity')::numeric;
    v_price := (v_item ->> 'unit_price')::numeric;
    v_tr    := coalesce((v_item ->> 'tax_rate')::numeric, 0);
    v_lt    := v_qty * v_price;
    v_ltax  := v_lt * v_tr / 100;

    v_type   := public.item_line_type(v_p, false);
    v_effect := public.item_stock_effect(v_p, 'in');

    INSERT INTO public.sales_return_items (
      return_id, product_id, quantity, unit_price, tax, total, line_type
    )
    VALUES (v_id, v_p, v_qty, v_price, v_ltax, v_lt + v_ltax, v_type);

    -- Only a tracked good comes back into stock.
    IF v_effect = 'STOCK_RECEIPT' THEN
      PERFORM public.post_stock_delta(
        v_p,
        _warehouse_id,
        v_qty,
        v_price,
        'RECEIPT'::public.stock_movement_kind,
        'sales_return',
        v_id,
        'Sales return',
        'COMPANY'::public.owner_type,
        NULL,
        'sale_return'::public.movement_type
      );
    END IF;
  END LOOP;

  IF _customer_id IS NOT NULL THEN
    UPDATE public.customers
    SET balance = greatest(balance - v_tot, 0), updated_at = now()
    WHERE id = _customer_id;

    INSERT INTO public.customer_ledger (
      customer_id, entry_type, credit, reference_id, reference_type,
      occurred_at, created_by, source_key, note
    )
    VALUES (
      _customer_id, 'return', round(v_tot, 2), v_id, 'sales_return',
      now(), v_user, 'return:' || v_id, 'مرتجع مبيعات'
    )
    ON CONFLICT (source_key) DO NOTHING;
  END IF;

  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, payload)
  VALUES (v_user, 'sales_return.posted', 'sales_return', v_id,
    jsonb_build_object(
      'return_number', v_no,
      'invoice_id', _invoice_id,
      'customer_id', _customer_id,
      'total', v_tot
    ));

  RETURN v_id;
END $function$;

-- NOTE: next_invoice_number() and next_sales_return_number() are defined ONCE, in
-- 14_document_numbering_engine.sql. This file used to define its own copies
-- reading sales_invoice_seq / sales_return_seq and company_settings' prefix
-- columns — a second, competing numbering design. The engine now owns the
-- numbering table, the sequences and the format, so keeping those bodies here
-- would let the two designs disagree silently (R-13/R-14). Name and signature are
-- unchanged, so no caller breaks.

-- ---------------------------------------------------------------------------
-- record_customer_payment — سند تحصيل مستحقات.
--
-- ⚠️ مبدأ حاكم: **التحصيل لا يتحوّل إلى دفعة مقدمة بصمت.**
--   الدفعة العادية محدودة بالفاتورة المختارة أو بإجمالي مستحقات العميل. وإن
--   أراد المشغّل دفعة مقدمة حقيقية فهناك دالة صريحة منفصلة
--   `record_customer_advance_payment` تحمل الاسم نفسه وتُنشئ سجلًا مميّزًا.
--   قبل هذا، كان أي فائض يُصنَّف "دفعة مقدمة" ضمنًا بلا إقرار من أحد — وهو
--   ما يُفسد مطابقة كشف الحساب لأن المستند يقول شيئًا والدفتر يقول آخر.
--
-- ما جاء من origin/main: منطق منع التحوّل الصامت، وفحص الرصيد الكلي قبل
-- التوزيع، والدالة الصريحة للدفعة المقدمة.
-- ما أُبقي من نسختنا الأحدث: اشتقاق payment_status عبر
-- `derive_payment_status` (فلا تُكتب حالة السداد يدويًا)، وحارس طريقة الدفع
-- الموحّد `resolve_writable_payment_method` بدل القائمة الحرفية القديمة،
-- وإبقاء status الدورة على 'confirmed' لأن الدفع لا يغيّرها.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_customer_payment(_customer_id uuid, _invoice_id uuid, _amount numeric, _method text, _payment_date date, _note text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid;
  v_user uuid := auth.uid();
  v_invoice record;
  v_customer_balance numeric;
  v_remaining numeric := round(coalesce(_amount, 0), 2);
  v_allocation numeric;
  v_outstanding numeric := 0;
  v_stored_method text;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT (
    public.has_role(v_user, 'owner')
    OR public.has_role(v_user, 'manager')
    OR public.has_role(v_user, 'accountant')
    OR public.has_role(v_user, 'cashier')
  ) THEN
    RAISE EXCEPTION 'You are not permitted to record customer payments';
  END IF;

  IF _customer_id IS NULL OR v_remaining <= 0 THEN
    RAISE EXCEPTION 'A customer and a positive amount are required';
  END IF;

  -- الحارس الموحّد: يطبّع القيمة عبر كتالوج طرق الدفع ويعيد القيمة المخزّنة.
  -- يستبدل القائمة الحرفية القديمة NOT IN ('cash','card',...) التي كانت ترفض
  -- كل طريقة يمنية جديدة (بنك الكريمي، جوالى، جيب...).
  v_stored_method := public.resolve_writable_payment_method(
    _method, 'customer_collection', true
  );

  -- صف العميل هو قفل التسلسل لكل سندات هذا العميل: يمنع تحصيلين متزامنين من
  -- استهلاك نفس المستحق.
  SELECT balance
    INTO v_customer_balance
  FROM public.customers
  WHERE id = _customer_id
    AND is_active = true
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Customer is unavailable';
  END IF;

  IF _invoice_id IS NOT NULL THEN
    SELECT id, total, paid, customer_id
      INTO v_invoice
    FROM public.sales_invoices
    WHERE id = _invoice_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Invoice not found';
    END IF;

    IF v_invoice.customer_id IS DISTINCT FROM _customer_id THEN
      RAISE EXCEPTION 'Invoice does not belong to this customer';
    END IF;

    IF v_invoice.total - v_invoice.paid <= 0 THEN
      RAISE EXCEPTION 'Invoice has no outstanding balance';
    END IF;

    IF v_remaining > v_invoice.total - v_invoice.paid THEN
      RAISE EXCEPTION 'Payment exceeds the invoice outstanding balance';
    END IF;

    INSERT INTO public.customer_payments (
      customer_id, invoice_id, amount, payment_method, payment_date, note, created_by
    )
    VALUES (
      _customer_id, _invoice_id, v_remaining, v_stored_method::public.payment_method,
      coalesce(_payment_date, current_date), nullif(trim(_note), ''), v_user
    )
    RETURNING id INTO v_id;

    INSERT INTO public.customer_ledger(customer_id, entry_type, credit, reference_id, reference_type, occurred_at, created_by, source_key, note)
    VALUES (_customer_id, 'payment', v_remaining, v_id, 'customer_payment', coalesce(_payment_date, current_date)::timestamptz, v_user, 'payment:' || v_id, coalesce(nullif(trim(_note), ''), 'دفعة عميل'))
    ON CONFLICT (source_key) DO NOTHING;

    UPDATE public.sales_invoices
    SET paid = paid + v_remaining,
        -- حالة الدورة تبقى «مؤكدة» — الدفع لا يغيّرها.
        -- حالة السداد تُحدّث في عمودها المستقل.
        status = 'confirmed'::public.invoice_status,
        payment_status = public.derive_payment_status(paid + v_remaining, total),
        updated_at = now()
    WHERE id = _invoice_id;
  ELSE
    -- لا فاتورة مختارة: تُستهلك أقدم الذمم أولًا. نفحص الإجمالي **قبل**
    -- التوزيع كي لا يتحوّل أي فائض بالخطأ إلى دفعة مقدمة.
    SELECT coalesce(sum(total - paid), 0)
      INTO v_outstanding
    FROM public.sales_invoices
    WHERE customer_id = _customer_id
      AND total > paid
      AND status NOT IN ('cancelled'::public.invoice_status, 'returned'::public.invoice_status);

    -- عميل قديم قد يكون له رصيد افتتاحي حقيقي بلا فواتير فردية. يبقى قابلًا
    -- للتحصيل حتى ذلك الرصيد، لكن لا يُصنَّف «دفعة مقدمة» ضمنًا أبدًا.
    IF v_outstanding <= 0 AND coalesce(v_customer_balance, 0) <= 0 THEN
      RAISE EXCEPTION 'Customer has no outstanding balance. Record an explicit advance payment instead.';
    END IF;
    IF v_outstanding > 0 AND v_remaining > v_outstanding THEN
      RAISE EXCEPTION 'Payment exceeds the customer outstanding balance';
    END IF;

    IF v_outstanding <= 0 THEN
      IF v_remaining > v_customer_balance THEN
        RAISE EXCEPTION 'Payment exceeds the customer outstanding balance';
      END IF;

      INSERT INTO public.customer_payments (
        customer_id, invoice_id, amount, payment_method, payment_date, note, created_by
      )
      VALUES (
        _customer_id, NULL, v_remaining, v_stored_method::public.payment_method,
        coalesce(_payment_date, current_date),
        coalesce(nullif(trim(_note), ''), 'سداد رصيد غير مرتبط بفاتورة'), v_user
      )
      RETURNING id INTO v_id;

      INSERT INTO public.customer_ledger(customer_id, entry_type, credit, reference_id, reference_type, occurred_at, created_by, source_key, note)
      VALUES (_customer_id, 'payment', v_remaining, v_id, 'customer_payment', coalesce(_payment_date, current_date)::timestamptz, v_user, 'payment:' || v_id, coalesce(nullif(trim(_note), ''), 'سداد رصيد غير مرتبط بفاتورة'))
      ON CONFLICT (source_key) DO NOTHING;

      v_remaining := 0;
    END IF;

    FOR v_invoice IN
      SELECT id, total, paid
      FROM public.sales_invoices
      WHERE customer_id = _customer_id
        AND total > paid
        AND status NOT IN ('cancelled'::public.invoice_status, 'returned'::public.invoice_status)
      ORDER BY created_at, id
      FOR UPDATE
    LOOP
      EXIT WHEN v_remaining <= 0;

      v_allocation := least(v_remaining, v_invoice.total - v_invoice.paid);

      INSERT INTO public.customer_payments (
        customer_id, invoice_id, amount, payment_method, payment_date, note, created_by
      )
      VALUES (
        _customer_id, v_invoice.id, v_allocation, v_stored_method::public.payment_method,
        coalesce(_payment_date, current_date), nullif(trim(_note), ''), v_user
      )
      RETURNING id INTO v_id;

      INSERT INTO public.customer_ledger(customer_id, entry_type, credit, reference_id, reference_type, occurred_at, created_by, source_key, note)
      VALUES (_customer_id, 'payment', v_allocation, v_id, 'customer_payment', coalesce(_payment_date, current_date)::timestamptz, v_user, 'payment:' || v_id, coalesce(nullif(trim(_note), ''), 'دفعة عميل'))
      ON CONFLICT (source_key) DO NOTHING;

      UPDATE public.sales_invoices
      SET paid = paid + v_allocation,
          status = 'confirmed'::public.invoice_status,
          payment_status = public.derive_payment_status(paid + v_allocation, total),
          updated_at = now()
      WHERE id = v_invoice.id;

      v_remaining := v_remaining - v_allocation;
    END LOOP;
  END IF;

  UPDATE public.customers
  SET balance = round(coalesce(balance, 0) - _amount, 2), updated_at = now()
  WHERE id = _customer_id;

  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, payload)
  VALUES (
    v_user,
    'customer_payment.recorded',
    'customer',
    _customer_id,
    jsonb_build_object(
      'invoice_id', _invoice_id,
      'amount', _amount,
      'method', v_stored_method,
      'payment_date', coalesce(_payment_date, current_date),
      'allocation', CASE WHEN _invoice_id IS NULL THEN 'oldest_first' ELSE 'selected_invoice' END
    )
  );

  RETURN v_id;
END;
$function$;

COMMENT ON FUNCTION public.record_customer_payment(uuid, uuid, numeric, text, date, text) IS
  'تحصيل مستحقات فقط: يحدّ المبلغ بالفاتورة أو بإجمالي الذمم، ويوزّع تلقائيًا من أقدم الفواتير، ولا يحوّل الفائض إلى دفعة مقدمة بصمت.';

-- ---------------------------------------------------------------------------
-- record_customer_advance_payment — دفعة مقدمة **صريحة**.
--
-- منفصلة عن سند التحصيل عن قصد: الدفعة المقدمة لا تسدّد فواتير قائمة تلقائيًا،
-- بل تُقيَّد في الدفتر بسجل متميّز (`credit` + `advance-payment:` prefix) ليظهر
-- أثرها في كشف الحساب كرصيد لصالح العميل، لا كسداد.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_customer_advance_payment(_customer_id uuid, _amount numeric, _method text, _payment_date date, _note text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid;
  v_user uuid := auth.uid();
  v_stored_method text;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT (
    public.has_role(v_user, 'owner')
    OR public.has_role(v_user, 'manager')
    OR public.has_role(v_user, 'accountant')
    OR public.has_role(v_user, 'cashier')
  ) THEN
    RAISE EXCEPTION 'You are not permitted to record customer payments';
  END IF;

  IF _customer_id IS NULL OR coalesce(_amount, 0) <= 0 THEN
    RAISE EXCEPTION 'A customer and a positive advance amount are required';
  END IF;

  v_stored_method := public.resolve_writable_payment_method(
    _method, 'customer_collection', true
  );

  PERFORM 1 FROM public.customers
  WHERE id = _customer_id AND is_active = true
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Customer is unavailable';
  END IF;

  INSERT INTO public.customer_payments (
    customer_id, invoice_id, amount, payment_method, payment_date, note, created_by
  )
  VALUES (
    _customer_id, NULL, round(_amount, 2), v_stored_method::public.payment_method,
    coalesce(_payment_date, current_date),
    coalesce(nullif(trim(_note), ''), 'دفعة مقدمة'), v_user
  )
  RETURNING id INTO v_id;

  UPDATE public.customers
  SET balance = round(coalesce(balance, 0) - _amount, 2), updated_at = now()
  WHERE id = _customer_id;

  INSERT INTO public.customer_ledger(customer_id, entry_type, credit, reference_id, reference_type, occurred_at, created_by, source_key, note)
  VALUES (_customer_id, 'credit', round(_amount, 2), v_id, 'customer_payment', coalesce(_payment_date, current_date)::timestamptz, v_user, 'advance-payment:' || v_id, coalesce(nullif(trim(_note), ''), 'دفعة مقدمة'))
  ON CONFLICT (source_key) DO NOTHING;

  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, payload)
  VALUES (
    v_user, 'customer_advance_payment.recorded', 'customer', _customer_id,
    jsonb_build_object('amount', _amount, 'method', v_stored_method, 'payment_date', coalesce(_payment_date, current_date))
  );

  RETURN v_id;
END;
$function$;

COMMENT ON FUNCTION public.record_customer_advance_payment(uuid, numeric, text, date, text) IS
  'دفعة مقدمة صريحة للعميل؛ لا تسدّد فواتير قائمة تلقائيًا، بل تُقيَّد كرصيد لصالحه في دفتر العملاء.';

CREATE OR REPLACE FUNCTION public.resolve_sale_line(p_line jsonb, OUT o_product_id uuid, OUT o_quantity numeric, OUT o_line_type text, OUT o_stock_effect text, OUT o_service_name text)
 RETURNS record
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
END $function$;

CREATE OR REPLACE FUNCTION public.sales_invoice_tender_breakdown(_invoice_id uuid)
 RETURNS TABLE(method text, amount numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT s.method::text, s.amount
  FROM public.customer_payment_splits AS s
  WHERE s.invoice_id = _invoice_id
  ORDER BY s.amount DESC;
$function$;

CREATE OR REPLACE FUNCTION public.sales_line_cost(p_item_id uuid, p_invoice_id uuid, p_quantity numeric, p_line_type text DEFAULT NULL::text)
 RETURNS numeric
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
END $function$;


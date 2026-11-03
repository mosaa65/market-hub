-- ============================================================================
-- 08_purchasing_and_returns.sql
--
-- المشتريات ومرتجعاتها.
--
-- مُستخرج من الحالة النهائية الحقيقية لقاعدة البيانات، لا من تاريخ الملفات.
-- لا يحتوي أي بيانات أعمال أو تجارية. راجع supabase/MIGRATIONS_RULES.md
-- ============================================================================

-- ── TABLES ────────────────────────────────────────────────────────────────
CREATE TABLE public.purchase_invoices (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  invoice_number text NOT NULL,
  supplier_id uuid,
  warehouse_id uuid,
  -- حالة الدورة: مسودة / مؤكدة / ملغاة. لا تُكتب من مبلغ السداد.
  status public.invoice_status DEFAULT 'draft'::invoice_status NOT NULL,
  -- حالة السداد، منفصلة، وتُشتقّ من (paid مقابل total).
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

CREATE TABLE public.purchase_invoice_items (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  invoice_id uuid NOT NULL,
  product_id uuid NOT NULL,
  quantity numeric(14,3) NOT NULL,
  unit_cost numeric(14,2) NOT NULL,
  discount numeric(14,2) DEFAULT 0 NOT NULL,
  tax numeric(14,2) DEFAULT 0 NOT NULL,
  total numeric(14,2) NOT NULL,
  line_type text,
  stock_effect text
);

CREATE TABLE public.purchase_returns (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  return_number text NOT NULL,
  invoice_id uuid,
  supplier_id uuid,
  warehouse_id uuid NOT NULL,
  subtotal numeric DEFAULT 0 NOT NULL,
  tax numeric DEFAULT 0 NOT NULL,
  total numeric DEFAULT 0 NOT NULL,
  refund_method public.payment_method,
  note text,
  created_by uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.purchase_return_items (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  return_id uuid NOT NULL,
  product_id uuid NOT NULL,
  quantity numeric NOT NULL,
  unit_cost numeric NOT NULL,
  tax numeric DEFAULT 0 NOT NULL,
  total numeric DEFAULT 0 NOT NULL,
  line_type text
);

-- ── CONSTRAINTS ───────────────────────────────────────────────────────────
ALTER TABLE public.purchase_invoices ADD CONSTRAINT "purchase_invoices_pkey" PRIMARY KEY (id);
ALTER TABLE public.purchase_invoices ADD CONSTRAINT "purchase_invoices_invoice_number_key" UNIQUE (invoice_number);
ALTER TABLE public.purchase_invoice_items ADD CONSTRAINT "purchase_invoice_items_line_type_valid" CHECK (((line_type IS NULL) OR (line_type = ANY (ARRAY['STOCKED_GOOD'::text, 'UNTRACKED_GOOD'::text, 'SERVICE'::text, 'CUSTOMER_OWNED_GOOD'::text, 'AD_HOC_SERVICE'::text]))));
ALTER TABLE public.purchase_invoice_items ADD CONSTRAINT "purchase_invoice_items_pkey" PRIMARY KEY (id);
ALTER TABLE public.purchase_returns ADD CONSTRAINT "purchase_returns_pkey" PRIMARY KEY (id);
ALTER TABLE public.purchase_returns ADD CONSTRAINT "purchase_returns_return_number_key" UNIQUE (return_number);
ALTER TABLE public.purchase_return_items ADD CONSTRAINT "purchase_return_items_quantity_check" CHECK ((quantity > (0)::numeric));
ALTER TABLE public.purchase_return_items ADD CONSTRAINT "purchase_return_items_pkey" PRIMARY KEY (id);

-- ── INDEXES ───────────────────────────────────────────────────────────────
CREATE INDEX idx_purchase_invoice_items_product ON public.purchase_invoice_items USING btree (product_id);
CREATE INDEX idx_purchase_return_items_product ON public.purchase_return_items USING btree (product_id);

-- ── FUNCTIONS ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.create_purchase(_warehouse_id uuid, _supplier_id uuid, _payment_method text, _paid numeric, _discount numeric, _note text, _items jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_invoice_id     uuid;
  v_invoice_no     text;
  v_user           uuid := auth.uid();
  v_item           jsonb;
  v_subtotal       numeric := 0;
  v_tax_total      numeric := 0;
  v_total          numeric := 0;
  v_qty            numeric;
  v_cost           numeric;
  v_tax_rate       numeric;
  v_line_total     numeric;
  v_line_tax       numeric;
  v_product        uuid;
  v_effect         text;
  v_type           text;
  v_purchasable    boolean;
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
    END IF;

    v_line_total := v_qty * v_cost;
    v_line_tax   := v_line_total * v_tax_rate / 100;
    v_subtotal   := v_subtotal + v_line_total;
    v_tax_total  := v_tax_total + v_line_tax;
  END LOOP;

  v_total := v_subtotal + v_tax_total - coalesce(_discount, 0);
  v_invoice_no := public.next_purchase_number();

  INSERT INTO public.purchase_invoices (
    invoice_number, supplier_id, warehouse_id, status, payment_status,
    subtotal, discount, tax, total, paid, payment_method, note, created_by
  )
  VALUES (
    v_invoice_no, _supplier_id, _warehouse_id,
    -- حالة الدورة: مشتريات أُنشئت مؤكدة — أثرها المخزني والمالي واقع.
    'confirmed'::public.invoice_status,
    -- حالة السداد مشتقّة، لا مكتوبة من مبلغ الدفع مباشرةً.
    public.derive_payment_status(coalesce(_paid, 0), v_total),
    v_subtotal, coalesce(_discount, 0), v_tax_total, v_total, coalesce(_paid, 0),
    _payment_method::public.payment_method, nullif(btrim(_note), ''), v_user
  )
  RETURNING id INTO v_invoice_id;

  --------------------------------------------------------------------- post
  FOR v_item IN SELECT * FROM jsonb_array_elements(_items) LOOP
    v_product  := (v_item ->> 'product_id')::uuid;
    v_qty      := (v_item ->> 'quantity')::numeric;
    v_cost     := (v_item ->> 'unit_cost')::numeric;
    v_tax_rate := coalesce((v_item ->> 'tax_rate')::numeric, 0);

    v_line_total := v_qty * v_cost;
    v_line_tax   := v_line_total * v_tax_rate / 100;

    SELECT r.o_line_type, r.o_stock_effect
      INTO v_type, v_effect
    FROM public.resolve_purchase_line(v_item) AS r;

    INSERT INTO public.purchase_invoice_items (
      invoice_id, product_id, quantity, unit_cost, discount, tax, total,
      line_type, stock_effect
    )
    VALUES (
      v_invoice_id, v_product, v_qty, v_cost, 0, v_line_tax, v_line_total + v_line_tax,
      v_type, v_effect
    );

    -- Rule 5: only a TRACKED good increases stock. A service or an untracked
    -- good is a pure expense: it changes no balance and no valuation.
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

  IF coalesce(_paid, 0) < v_total THEN
    UPDATE public.suppliers
    SET balance = balance + (v_total - coalesce(_paid, 0)), updated_at = now()
    WHERE id = _supplier_id;
  END IF;

  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, payload)
  VALUES (v_user, 'purchase.posted', 'purchase_invoice', v_invoice_id,
    jsonb_build_object(
      'invoice_number', v_invoice_no,
      'supplier_id', _supplier_id,
      'warehouse_id', _warehouse_id,
      'total', v_total,
      'paid', coalesce(_paid, 0),
      'line_count', jsonb_array_length(_items)
    ));

  RETURN v_invoice_id;
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
  v_sub    numeric := 0;
  v_tax    numeric := 0;
  v_tot    numeric := 0;
  v_qty    numeric;
  v_cost   numeric;
  v_tr     numeric;
  v_lt     numeric;
  v_ltax   numeric;
  v_p      uuid;
  v_effect text;
  v_type   text;
  v_avail  numeric;
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
    v_p    := (v_item ->> 'product_id')::uuid;
    v_qty  := (v_item ->> 'quantity')::numeric;
    v_cost := (v_item ->> 'unit_cost')::numeric;
    v_tr   := coalesce((v_item ->> 'tax_rate')::numeric, 0);

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

    v_lt   := v_qty * v_cost;
    v_ltax := v_lt * v_tr / 100;
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
    v_qty  := (v_item ->> 'quantity')::numeric;
    v_cost := (v_item ->> 'unit_cost')::numeric;
    v_tr   := coalesce((v_item ->> 'tax_rate')::numeric, 0);
    v_lt   := v_qty * v_cost;
    v_ltax := v_lt * v_tr / 100;

    v_type   := public.item_line_type(v_p, false);
    v_effect := public.item_stock_effect(v_p, 'out');

    INSERT INTO public.purchase_return_items (
      return_id, product_id, quantity, unit_cost, tax, total, line_type
    )
    VALUES (v_id, v_p, v_qty, v_cost, v_ltax, v_lt + v_ltax, v_type);

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

  IF _supplier_id IS NOT NULL THEN
    UPDATE public.suppliers
    SET balance = greatest(balance - v_tot, 0), updated_at = now()
    WHERE id = _supplier_id;
  END IF;

  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, payload)
  VALUES (v_user, 'purchase_return.posted', 'purchase_return', v_id,
    jsonb_build_object(
      'return_number', v_no,
      'invoice_id', _invoice_id,
      'supplier_id', _supplier_id,
      'total', v_tot
    ));

  RETURN v_id;
END $function$;

-- NOTE: next_purchase_number() and next_purchase_return_number() are defined ONCE,
-- in 14_document_numbering_engine.sql. This file used to define its own copies
-- reading purchase_invoice_seq / purchase_return_seq and company_settings' prefix
-- columns — a second, competing numbering design. The engine now owns the
-- numbering table, the sequences and the format, so a second definition here would
-- be dead code whose body could silently drift from the engine's (R-13/R-14). The
-- name and signature are unchanged, so no caller breaks.

CREATE OR REPLACE FUNCTION public.resolve_purchase_line(p_line jsonb, OUT o_product_id uuid, OUT o_quantity numeric, OUT o_line_type text, OUT o_stock_effect text)
 RETURNS record
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_is_service_flag boolean := coalesce((p_line ->> 'is_service')::boolean, false);
  v_nature public.item_nature;
BEGIN
  o_product_id := nullif(btrim(coalesce(p_line ->> 'product_id', '')), '')::uuid;
  o_quantity   := (p_line ->> 'quantity')::numeric;

  IF o_product_id IS NULL THEN
    o_line_type    := 'AD_HOC_SERVICE';
    o_stock_effect := 'NONE';
    RETURN;
  END IF;

  SELECT p.item_nature INTO v_nature FROM public.products p WHERE p.id = o_product_id;

  IF v_nature IS NULL THEN
    IF v_is_service_flag THEN
      o_product_id   := NULL;
      o_line_type    := 'AD_HOC_SERVICE';
      o_stock_effect := 'NONE';
      RETURN;
    END IF;
    RAISE EXCEPTION 'Item % does not exist', o_product_id;
  END IF;

  o_line_type    := public.item_line_type(o_product_id, false);
  o_stock_effect := public.item_stock_effect(o_product_id, 'in');
END $function$;


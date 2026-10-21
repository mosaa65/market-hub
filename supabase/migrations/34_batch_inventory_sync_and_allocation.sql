-- ============================================================================
-- 31_batch_inventory_sync_and_allocation.sql
--
-- 1. Constraints on product_batches (nonnegative quantity and unit_cost).
-- 2. batch_settings column in company_settings with defaults.
-- 3. batch_id & batch_number columns in sales_invoice_items and purchase_invoice_items.
-- 4. Batch Management & Sync Functions:
--    - save_product_batch (with inventory sync via post_stock_delta)
--    - delete_product_batch (with inventory sync via post_stock_delta)
--    - reconcile_batches_with_inventory (compares batch sums vs inventory)
--    - get_batch_kpis (accurate aggregate metrics across all rows)
--    - get_batch_settings / save_batch_settings
-- 5. Updated create_sale with FEFO/FIFO batch allocation and expired batch prevention.
-- 6. Updated create_purchase with automatic batch creation/update and tracking enforcement.
-- ============================================================================

-- 1. Constraints on product_batches
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'product_batches_quantity_nonnegative'
  ) THEN
    ALTER TABLE public.product_batches
      ADD CONSTRAINT product_batches_quantity_nonnegative CHECK (quantity >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'product_batches_unit_cost_nonnegative'
  ) THEN
    ALTER TABLE public.product_batches
      ADD CONSTRAINT product_batches_unit_cost_nonnegative CHECK (unit_cost >= 0);
  END IF;
END $$;

-- 2. Add batch_settings to company_settings
ALTER TABLE public.company_settings
  ADD COLUMN IF NOT EXISTS batch_settings jsonb DEFAULT '{
    "dispatch_strategy": "FEFO",
    "prevent_selling_expired": true,
    "warning_days": 30,
    "enforce_on_purchase": false,
    "enforce_batch_selection_on_pos": false,
    "auto_sync_inventory": true
  }'::jsonb;

-- 3. Columns in sales_invoice_items and purchase_invoice_items
ALTER TABLE public.sales_invoice_items
  ADD COLUMN IF NOT EXISTS batch_id uuid REFERENCES public.product_batches(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS batch_number text;

ALTER TABLE public.purchase_invoice_items
  ADD COLUMN IF NOT EXISTS batch_number text,
  ADD COLUMN IF NOT EXISTS expiry_date date;

-- 4. Functions for Batch Management & Sync

CREATE OR REPLACE FUNCTION public.get_batch_settings()
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
STABLE
AS $function$
  SELECT coalesce(
    batch_settings,
    '{
      "dispatch_strategy": "FEFO",
      "prevent_selling_expired": true,
      "warning_days": 30,
      "enforce_on_purchase": false,
      "enforce_batch_selection_on_pos": false,
      "auto_sync_inventory": true
    }'::jsonb
  )
  FROM public.company_settings
  LIMIT 1;
$function$;

CREATE OR REPLACE FUNCTION public.save_batch_settings(p_settings jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_merged jsonb;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT (public.has_role(v_user, 'owner') OR public.has_role(v_user, 'manager')) THEN
    RAISE EXCEPTION 'Not authorized to change company settings';
  END IF;

  UPDATE public.company_settings
  SET batch_settings = coalesce(batch_settings, '{}'::jsonb) || p_settings,
      updated_at = now()
  RETURNING batch_settings INTO v_merged;

  RETURN v_merged;
END $function$;

CREATE OR REPLACE FUNCTION public.get_batch_kpis(p_warning_days integer DEFAULT 30)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_today date := CURRENT_DATE;
  v_soon_limit date := CURRENT_DATE + (coalesce(p_warning_days, 30) || ' days')::interval;
  v_total bigint;
  v_expired bigint;
  v_soon bigint;
  v_valid bigint;
  v_none bigint;
BEGIN
  SELECT
    count(*),
    count(*) FILTER (WHERE expiry_date IS NOT NULL AND expiry_date <= v_today),
    count(*) FILTER (WHERE expiry_date IS NOT NULL AND expiry_date > v_today AND expiry_date <= v_soon_limit),
    count(*) FILTER (WHERE expiry_date IS NOT NULL AND expiry_date > v_soon_limit),
    count(*) FILTER (WHERE expiry_date IS NULL)
  INTO
    v_total, v_expired, v_soon, v_valid, v_none
  FROM public.product_batches;

  RETURN jsonb_build_object(
    'total', coalesce(v_total, 0),
    'expired', coalesce(v_expired, 0),
    'soon', coalesce(v_soon, 0),
    'valid', coalesce(v_valid, 0),
    'none', coalesce(v_none, 0),
    'at_risk', coalesce(v_expired, 0) + coalesce(v_soon, 0)
  );
END $function$;

CREATE OR REPLACE FUNCTION public.save_product_batch(
  p_product_id uuid,
  p_warehouse_id uuid,
  p_batch_number text,
  p_expiry_date date DEFAULT NULL,
  p_quantity numeric DEFAULT 0,
  p_unit_cost numeric DEFAULT 0,
  p_note text DEFAULT NULL,
  p_sync_inventory boolean DEFAULT true,
  p_batch_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_id   uuid;
  v_old_qty numeric := 0;
  v_delta numeric := 0;
  v_product_tracked boolean;
  v_cost numeric := coalesce(p_unit_cost, 0);
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_product_id IS NULL THEN
    RAISE EXCEPTION 'Product is required for batch';
  END IF;
  IF p_warehouse_id IS NULL THEN
    RAISE EXCEPTION 'Warehouse is required for batch';
  END IF;
  IF p_batch_number IS NULL OR btrim(p_batch_number) = '' THEN
    RAISE EXCEPTION 'Batch number is required';
  END IF;
  IF p_quantity < 0 THEN
    RAISE EXCEPTION 'Batch quantity cannot be negative';
  END IF;
  IF v_cost < 0 THEN
    RAISE EXCEPTION 'Batch unit cost cannot be negative';
  END IF;

  SELECT (inventory_policy = 'TRACKED') INTO v_product_tracked
  FROM public.products WHERE id = p_product_id;

  IF p_batch_id IS NOT NULL THEN
    -- Editing existing batch
    SELECT id, quantity INTO v_id, v_old_qty
    FROM public.product_batches
    WHERE id = p_batch_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Batch % not found', p_batch_id;
    END IF;

    UPDATE public.product_batches
    SET product_id = p_product_id,
        warehouse_id = p_warehouse_id,
        batch_number = btrim(p_batch_number),
        expiry_date = p_expiry_date,
        quantity = p_quantity,
        unit_cost = v_cost,
        note = nullif(btrim(p_note), ''),
        updated_at = now()
    WHERE id = v_id;

    v_delta := p_quantity - v_old_qty;
  ELSE
    -- Creating new batch
    SELECT id, quantity INTO v_id, v_old_qty
    FROM public.product_batches
    WHERE product_id = p_product_id
      AND warehouse_id = p_warehouse_id
      AND batch_number = btrim(p_batch_number)
    FOR UPDATE;

    IF FOUND THEN
      -- Existing batch number for same product and warehouse
      UPDATE public.product_batches
      SET quantity = round(quantity + p_quantity, 3),
          unit_cost = CASE WHEN v_cost > 0 THEN v_cost ELSE unit_cost END,
          expiry_date = coalesce(p_expiry_date, expiry_date),
          note = coalesce(nullif(btrim(p_note), ''), note),
          updated_at = now()
      WHERE id = v_id;

      v_delta := p_quantity;
    ELSE
      INSERT INTO public.product_batches (
        product_id, warehouse_id, batch_number, expiry_date, quantity, unit_cost, note, created_by
      )
      VALUES (
        p_product_id, p_warehouse_id, btrim(p_batch_number), p_expiry_date,
        p_quantity, v_cost, nullif(btrim(p_note), ''), v_user
      )
      RETURNING id INTO v_id;

      v_delta := p_quantity;
    END IF;
  END IF;

  -- Sync with inventory ledger if enabled
  IF p_sync_inventory AND v_delta <> 0 AND coalesce(v_product_tracked, true) THEN
    PERFORM public.post_stock_delta(
      p_product_id,
      p_warehouse_id,
      v_delta,
      v_cost,
      CASE WHEN v_delta > 0 THEN 'RECEIPT'::public.stock_movement_kind ELSE 'ADJUSTMENT'::public.stock_movement_kind END,
      'product_batch',
      v_id,
      CASE WHEN v_delta > 0 THEN 'توريد دفعة: ' || btrim(p_batch_number) ELSE 'تعديل دفعة: ' || btrim(p_batch_number) END,
      'COMPANY'::public.owner_type,
      NULL,
      CASE WHEN v_delta > 0 THEN 'purchase'::public.movement_type ELSE 'adjustment'::public.movement_type END
    );
  END IF;

  RETURN v_id;
END $function$;

CREATE OR REPLACE FUNCTION public.delete_product_batch(
  p_batch_id uuid,
  p_sync_inventory boolean DEFAULT true
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_prod uuid;
  v_wh   uuid;
  v_qty  numeric;
  v_cost numeric;
  v_batch_no text;
  v_tracked boolean;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT product_id, warehouse_id, quantity, unit_cost, batch_number
    INTO v_prod, v_wh, v_qty, v_cost, v_batch_no
  FROM public.product_batches
  WHERE id = p_batch_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  SELECT (inventory_policy = 'TRACKED') INTO v_tracked
  FROM public.products WHERE id = v_prod;

  DELETE FROM public.product_batches WHERE id = p_batch_id;

  IF p_sync_inventory AND v_qty > 0 AND coalesce(v_tracked, true) THEN
    PERFORM public.post_stock_delta(
      v_prod,
      v_wh,
      -v_qty,
      v_cost,
      'ADJUSTMENT'::public.stock_movement_kind,
      'product_batch',
      p_batch_id,
      'حذف دفعة رقم: ' || v_batch_no,
      'COMPANY'::public.owner_type,
      NULL,
      'adjustment'::public.movement_type
    );
  END IF;

  RETURN true;
END $function$;

CREATE OR REPLACE FUNCTION public.reconcile_batches_with_inventory(
  p_warehouse_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_rec record;
  v_diff numeric;
  v_results jsonb := '[]'::jsonb;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  FOR v_rec IN
    WITH batch_sums AS (
      SELECT product_id, warehouse_id, sum(quantity) as total_batch_qty
      FROM public.product_batches
      WHERE (p_warehouse_id IS NULL OR warehouse_id = p_warehouse_id)
      GROUP BY product_id, warehouse_id
    ),
    inv_stocks AS (
      SELECT product_id, warehouse_id, quantity as inv_qty
      FROM public.inventory
      WHERE owner_type = 'COMPANY'
        AND (p_warehouse_id IS NULL OR warehouse_id = p_warehouse_id)
    )
    SELECT
      coalesce(b.product_id, i.product_id) as product_id,
      coalesce(b.warehouse_id, i.warehouse_id) as warehouse_id,
      coalesce(b.total_batch_qty, 0) as batch_qty,
      coalesce(i.inv_qty, 0) as inventory_qty
    FROM batch_sums b
    FULL OUTER JOIN inv_stocks i
      ON b.product_id = i.product_id AND b.warehouse_id = i.warehouse_id
    WHERE coalesce(b.total_batch_qty, 0) <> coalesce(i.inv_qty, 0)
  LOOP
    v_diff := v_rec.batch_qty - v_rec.inventory_qty;
    v_results := v_results || jsonb_build_object(
      'product_id', v_rec.product_id,
      'warehouse_id', v_rec.warehouse_id,
      'batch_qty', v_rec.batch_qty,
      'inventory_qty', v_rec.inventory_qty,
      'difference', v_diff
    );
  END LOOP;

  RETURN v_results;
END $function$;

-- 5. Updated create_sale with FEFO/FIFO batch allocation & expired check
CREATE OR REPLACE FUNCTION public.create_sale(
  _warehouse_id uuid,
  _customer_id uuid,
  _payment_method text,
  _paid numeric,
  _discount numeric,
  _note text,
  _items jsonb
)
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
  -- Batch allocation variables
  v_batch_settings jsonb;
  v_dispatch_strat text := 'FEFO';
  v_prevent_expired boolean := true;
  v_enforce_pos    boolean := false;
  v_item_batch_id  uuid;
  v_batch_rec      record;
  v_rem_qty        numeric;
  v_alloc_qty      numeric;
  v_primary_batch_id uuid;
  v_primary_batch_no text;
  v_product_tracking text;
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

  -- Load batch settings
  SELECT coalesce(batch_settings, '{}'::jsonb) INTO v_batch_settings
  FROM public.company_settings LIMIT 1;

  v_dispatch_strat := coalesce(v_batch_settings ->> 'dispatch_strategy', 'FEFO');
  v_prevent_expired := coalesce((v_batch_settings ->> 'prevent_selling_expired')::boolean, true);
  v_enforce_pos := coalesce((v_batch_settings ->> 'enforce_batch_selection_on_pos')::boolean, false);

  -- ============================================================== VALIDATION
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

  -- Totals
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

  v_status := 'confirmed'::public.invoice_status;
  v_invoice_number := public.next_invoice_number();

  INSERT INTO public.sales_invoices (
    invoice_number, customer_id, warehouse_id, status, payment_status,
    subtotal, discount, tax, total, paid, payment_method, note, created_by
  )
  VALUES (
    v_invoice_number, _customer_id, _warehouse_id, v_status,
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
           nullif(btrim(coalesce(line ->> 'uom_id', '')), '')::uuid AS uom_id,
           nullif(btrim(coalesce(line ->> 'batch_id', '')), '')::uuid AS explicit_batch_id
    FROM jsonb_array_elements(_items) AS line
    CROSS JOIN LATERAL public.resolve_sale_line(line) AS r
  LOOP
    v_cost := NULL;
    v_primary_batch_id := NULL;
    v_primary_batch_no := NULL;

    IF v_line.product_id IS NULL THEN
      v_price     := v_line.input_price;
      v_tax_rate  := v_line.input_tax;
      v_line_type := 'AD_HOC_SERVICE';
      v_effect    := 'NONE';
    ELSE
      SELECT p.sale_price, p.tax_rate, p.cost_price, p.tracking::text
        INTO v_price, v_tax_rate, v_cost, v_product_tracking
      FROM public.products p WHERE p.id = v_line.product_id;

      v_line_type := public.item_line_type(v_line.product_id, false);
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

        -- ── Batch Allocation & Deduction ───────────────────────────
        IF v_line.explicit_batch_id IS NOT NULL THEN
          -- Explicit batch chosen
          SELECT id, batch_number, quantity, expiry_date
            INTO v_batch_rec
          FROM public.product_batches
          WHERE id = v_line.explicit_batch_id
            AND product_id = v_line.product_id
            AND warehouse_id = _warehouse_id
          FOR UPDATE;

          IF NOT FOUND THEN
            RAISE EXCEPTION 'الدفعة المحددة غير موجودة في المستودع لهذا المنتج';
          END IF;

          IF v_prevent_expired AND v_batch_rec.expiry_date IS NOT NULL AND v_batch_rec.expiry_date <= CURRENT_DATE THEN
            RAISE EXCEPTION 'لا يمكن بيع الدفعة المنتهية: % (تاريخ الانتهاء: %)', v_batch_rec.batch_number, v_batch_rec.expiry_date;
          END IF;

          IF v_batch_rec.quantity < v_line.quantity THEN
            RAISE EXCEPTION 'الكمية المطلوبة تتجاوز رصيد الدفعة % (المتاح: %, المطلوب: %)',
              v_batch_rec.batch_number, v_batch_rec.quantity, v_line.quantity;
          END IF;

          UPDATE public.product_batches
          SET quantity = round(quantity - v_line.quantity, 3), updated_at = now()
          WHERE id = v_batch_rec.id;

          v_primary_batch_id := v_batch_rec.id;
          v_primary_batch_no := v_batch_rec.batch_number;

        ELSIF v_product_tracking = 'BATCH' OR EXISTS (
          SELECT 1 FROM public.product_batches
          WHERE product_id = v_line.product_id AND warehouse_id = _warehouse_id AND quantity > 0
        ) THEN
          IF v_dispatch_strat = 'MANUAL' AND v_enforce_pos AND v_product_tracking = 'BATCH' THEN
            RAISE EXCEPTION 'يجب تحديد الدفعة للصنف % في نقطة البيع', v_line.product_id;
          END IF;

          v_rem_qty := v_line.quantity;

          FOR v_batch_rec IN
            SELECT id, batch_number, quantity, expiry_date
            FROM public.product_batches
            WHERE product_id = v_line.product_id
              AND warehouse_id = _warehouse_id
              AND quantity > 0
              AND (NOT v_prevent_expired OR expiry_date IS NULL OR expiry_date > CURRENT_DATE)
            ORDER BY
              CASE WHEN v_dispatch_strat = 'FIFO' THEN created_at END ASC,
              CASE WHEN v_dispatch_strat <> 'FIFO' THEN expiry_date END ASC NULLS LAST,
              created_at ASC
            FOR UPDATE
          LOOP
            EXIT WHEN v_rem_qty <= 0;

            v_alloc_qty := least(v_batch_rec.quantity, v_rem_qty);
            UPDATE public.product_batches
            SET quantity = round(quantity - v_alloc_qty, 3), updated_at = now()
            WHERE id = v_batch_rec.id;

            IF v_primary_batch_id IS NULL THEN
              v_primary_batch_id := v_batch_rec.id;
              v_primary_batch_no := v_batch_rec.batch_number;
            END IF;

            v_rem_qty := v_rem_qty - v_alloc_qty;
          END LOOP;

          IF v_product_tracking = 'BATCH' AND v_rem_qty > 0 THEN
            RAISE EXCEPTION 'رصيد الدفعات المتاح والصالح غير كافٍ للصنف % (المتبقي: %)',
              v_line.product_id, v_rem_qty;
          END IF;
        END IF;
      END IF;
    END IF;

    v_line_total := round(v_line.quantity * v_price, 2);
    v_line_tax   := round(v_line_total * v_tax_rate / 100, 2);

    INSERT INTO public.sales_invoice_items (
      invoice_id, product_id, description, quantity, unit_price, discount, tax, total,
      line_type, stock_effect, uom_id, batch_id, batch_number
    )
    VALUES (
      v_invoice_id,
      v_line.product_id,
      CASE WHEN v_line.product_id IS NULL THEN v_line.service_name ELSE NULL END,
      v_line.quantity, v_price, 0, v_line_tax, v_line_total + v_line_tax,
      v_line_type, v_effect, v_line.uom_id,
      v_primary_batch_id, v_primary_batch_no
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

  PERFORM public.post_sales_invoice(v_invoice_id);

  RETURN v_invoice_id;
END $function$;

-- 6. Updated create_purchase with auto batch creation & tracking enforcement
CREATE OR REPLACE FUNCTION public.create_purchase(
  _warehouse_id uuid,
  _supplier_id uuid,
  _payment_method text,
  _paid numeric,
  _discount numeric,
  _note text,
  _items jsonb
)
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
  v_batch_settings jsonb;
  v_enforce_purchase boolean := false;
  v_batch_no       text;
  v_expiry_date    date;
  v_product_tracking text;
  v_existing_batch_id uuid;
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

  SELECT coalesce(batch_settings, '{}'::jsonb) INTO v_batch_settings
  FROM public.company_settings LIMIT 1;
  v_enforce_purchase := coalesce((v_batch_settings ->> 'enforce_on_purchase')::boolean, false);

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
      SELECT p.is_purchasable, p.tracking::text
        INTO v_purchasable, v_product_tracking
      FROM public.products p WHERE p.id = (v_item ->> 'product_id')::uuid;

      IF v_purchasable IS NOT TRUE THEN
        RAISE EXCEPTION 'Item % is not marked as purchasable', v_item ->> 'product_id';
      END IF;

      IF v_enforce_purchase AND v_product_tracking = 'BATCH' THEN
        IF nullif(btrim(coalesce(v_item ->> 'batch_number', '')), '') IS NULL THEN
          RAISE EXCEPTION 'يجب إدخال رقم الدفعة للصنف المتبع بالدفعات: %', v_item ->> 'product_id';
        END IF;
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
    'confirmed'::public.invoice_status,
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
    v_batch_no := nullif(btrim(coalesce(v_item ->> 'batch_number', '')), '');
    v_expiry_date := nullif(btrim(coalesce(v_item ->> 'expiry_date', '')), '')::date;

    v_line_total := v_qty * v_cost;
    v_line_tax   := v_line_total * v_tax_rate / 100;

    SELECT r.o_line_type, r.o_stock_effect
      INTO v_type, v_effect
    FROM public.resolve_purchase_line(v_item) AS r;

    INSERT INTO public.purchase_invoice_items (
      invoice_id, product_id, quantity, unit_cost, discount, tax, total,
      line_type, stock_effect, batch_number, expiry_date
    )
    VALUES (
      v_invoice_id, v_product, v_qty, v_cost, 0, v_line_tax, v_line_total + v_line_tax,
      v_type, v_effect, v_batch_no, v_expiry_date
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

      -- Automatic batch creation / increment
      IF v_batch_no IS NOT NULL THEN
        SELECT id INTO v_existing_batch_id
        FROM public.product_batches
        WHERE product_id = v_product AND warehouse_id = _warehouse_id AND batch_number = v_batch_no
        FOR UPDATE;

        IF FOUND THEN
          UPDATE public.product_batches
          SET quantity = round(quantity + v_qty, 3),
              unit_cost = CASE WHEN v_cost > 0 THEN v_cost ELSE unit_cost END,
              expiry_date = coalesce(v_expiry_date, expiry_date),
              updated_at = now()
          WHERE id = v_existing_batch_id;
        ELSE
          INSERT INTO public.product_batches (
            product_id, warehouse_id, batch_number, expiry_date, quantity, unit_cost, created_by
          )
          VALUES (
            v_product, _warehouse_id, v_batch_no, v_expiry_date, v_qty, v_cost, v_user
          );
        END IF;
      END IF;
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

  PERFORM public.post_purchase_invoice(v_invoice_id);

  RETURN v_invoice_id;
END $function$;

-- 7. Permissions
GRANT EXECUTE ON FUNCTION public.get_batch_settings() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.save_batch_settings(jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_batch_kpis(integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.save_product_batch(uuid, uuid, text, date, numeric, numeric, text, boolean, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.delete_product_batch(uuid, boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reconcile_batches_with_inventory(uuid) TO authenticated, service_role;

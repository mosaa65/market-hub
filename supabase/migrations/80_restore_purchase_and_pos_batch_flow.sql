-- Restore detailed batch tracking after the split invoice RPCs stopped passing
-- batch fields into invoice items. Inventory quantities remain authoritative;
-- product_batches mirrors the tracked portions of receipts and issues.

BEGIN;

ALTER TABLE public.company_settings
  ALTER COLUMN batch_settings SET DEFAULT '{
    "dispatch_strategy": "FEFO",
    "prevent_selling_expired": true,
    "warning_days": 30,
    "enforce_on_purchase": true,
    "enforce_batch_selection_on_pos": false,
    "auto_sync_inventory": true
  }'::jsonb;

UPDATE public.company_settings
SET batch_settings = coalesce(batch_settings, '{}'::jsonb) || '{"enforce_on_purchase": true}'::jsonb
WHERE batch_settings IS NULL
   OR batch_settings ->> 'enforce_on_purchase' IS DISTINCT FROM 'true';

CREATE TABLE IF NOT EXISTS public.sales_invoice_item_batch_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sales_invoice_item_id uuid NOT NULL REFERENCES public.sales_invoice_items(id)
    ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
  batch_id uuid NOT NULL REFERENCES public.product_batches(id) ON DELETE RESTRICT,
  quantity numeric(14,3) NOT NULL CHECK (quantity > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (sales_invoice_item_id, batch_id)
);

CREATE INDEX IF NOT EXISTS idx_sales_item_batch_allocations_batch
  ON public.sales_invoice_item_batch_allocations(batch_id);
REVOKE ALL ON TABLE public.sales_invoice_item_batch_allocations FROM PUBLIC, anon, authenticated;

COMMENT ON TABLE public.sales_invoice_item_batch_allocations IS
  'Exact batch quantities consumed by each sale line; batch_id on the invoice line remains a primary-batch compatibility field.';

-- Legacy stock already in inventory predates reliable batch receipts. Create
-- non-expiring opening batches only for the positive difference; do not change
-- inventory or write stock movements during this reconciliation.
INSERT INTO public.product_batches (
  product_id, warehouse_id, batch_number, expiry_date, quantity, unit_cost, note
)
SELECT i.product_id,
       i.warehouse_id,
       'LEGACY-' || left(replace(i.product_id::text, '-', ''), 8) || '-' ||
         left(replace(i.warehouse_id::text, '-', ''), 8),
       NULL,
       round(greatest(i.quantity - coalesce(b.total, 0), 0), 3),
       coalesce(p.cost_price, 0),
       'رصيد افتتاحي للتوافق مع رصيد المخزون السابق'
FROM public.inventory i
JOIN public.products p ON p.id = i.product_id
LEFT JOIN LATERAL (
  SELECT sum(pb.quantity) AS total
  FROM public.product_batches pb
  WHERE pb.product_id = i.product_id AND pb.warehouse_id = i.warehouse_id
) b ON true
WHERE i.owner_type = 'COMPANY'
  AND i.owner_id IS NULL
  AND i.quantity > coalesce(b.total, 0)
  AND p.item_nature = 'GOOD'
  AND p.inventory_policy = 'TRACKED'
  AND p.tracking = 'BATCH'
ON CONFLICT (product_id, warehouse_id, batch_number) DO UPDATE
SET quantity = EXCLUDED.quantity,
    updated_at = now();

CREATE OR REPLACE FUNCTION public.sync_purchase_invoice_item_batch()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_warehouse_id uuid;
  v_tracking public.item_tracking;
BEGIN
  IF NEW.product_id IS NULL OR NEW.stock_effect IS DISTINCT FROM 'STOCK_RECEIPT' THEN
    RETURN NEW;
  END IF;

  SELECT p.tracking INTO v_tracking
  FROM public.products p
  WHERE p.id = NEW.product_id;

  IF v_tracking <> 'BATCH'::public.item_tracking THEN
    RETURN NEW;
  END IF;

  IF nullif(btrim(coalesce(NEW.batch_number, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Batch-tracked purchase items require a batch number'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT pi.warehouse_id INTO v_warehouse_id
  FROM public.purchase_invoices pi
  WHERE pi.id = NEW.invoice_id;

  INSERT INTO public.product_batches (
    product_id, warehouse_id, batch_number, expiry_date, quantity, unit_cost, created_by
  )
  VALUES (
    NEW.product_id, v_warehouse_id, btrim(NEW.batch_number), NEW.expiry_date,
    NEW.quantity, NEW.unit_cost, auth.uid()
  )
  ON CONFLICT (product_id, warehouse_id, batch_number) DO UPDATE
  SET quantity = round(public.product_batches.quantity + EXCLUDED.quantity, 3),
      unit_cost = CASE
        WHEN public.product_batches.quantity + EXCLUDED.quantity > 0 THEN
          round((public.product_batches.quantity * public.product_batches.unit_cost +
                 EXCLUDED.quantity * EXCLUDED.unit_cost) /
                (public.product_batches.quantity + EXCLUDED.quantity), 4)
        ELSE public.product_batches.unit_cost
      END,
      expiry_date = coalesce(EXCLUDED.expiry_date, public.product_batches.expiry_date),
      updated_at = now();

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.sync_purchase_invoice_item_batch() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS purchase_invoice_item_sync_batch ON public.purchase_invoice_items;
CREATE CONSTRAINT TRIGGER purchase_invoice_item_sync_batch
AFTER INSERT ON public.purchase_invoice_items
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.sync_purchase_invoice_item_batch();

CREATE OR REPLACE FUNCTION public.allocate_sales_invoice_item_batches()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_warehouse_id uuid;
  v_tracking public.item_tracking;
  v_settings jsonb;
  v_strategy text;
  v_prevent_expired boolean;
  v_enforce_pos boolean;
  v_batch record;
  v_remaining numeric := NEW.quantity;
  v_take numeric;
  v_primary_id uuid;
  v_primary_number text;
BEGIN
  IF NEW.product_id IS NULL OR NEW.stock_effect IS DISTINCT FROM 'STOCK_ISSUE' THEN
    RETURN NEW;
  END IF;

  SELECT p.tracking INTO v_tracking
  FROM public.products p
  WHERE p.id = NEW.product_id;

  IF v_tracking <> 'BATCH'::public.item_tracking THEN
    RETURN NEW;
  END IF;

  SELECT si.warehouse_id INTO v_warehouse_id
  FROM public.sales_invoices si
  WHERE si.id = NEW.invoice_id;

  SELECT coalesce(cs.batch_settings, '{}'::jsonb)
    INTO v_settings
  FROM public.company_settings cs
  LIMIT 1;

  v_strategy := coalesce(v_settings ->> 'dispatch_strategy', 'FEFO');
  IF v_strategy NOT IN ('FEFO', 'FIFO', 'MANUAL') THEN
    v_strategy := 'FEFO';
  END IF;
  v_prevent_expired := coalesce((v_settings ->> 'prevent_selling_expired')::boolean, true);
  v_enforce_pos := coalesce((v_settings ->> 'enforce_batch_selection_on_pos')::boolean, false);

  IF NEW.batch_id IS NOT NULL THEN
    SELECT pb.id, pb.batch_number, pb.expiry_date, pb.quantity
      INTO v_batch
    FROM public.product_batches pb
    WHERE pb.id = NEW.batch_id
      AND pb.product_id = NEW.product_id
      AND pb.warehouse_id = v_warehouse_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'The selected batch does not belong to this product and warehouse'
        USING ERRCODE = 'check_violation';
    END IF;
    IF v_prevent_expired AND v_batch.expiry_date IS NOT NULL AND v_batch.expiry_date <= current_date THEN
      RAISE EXCEPTION 'Cannot sell expired batch %', v_batch.batch_number
        USING ERRCODE = 'check_violation';
    END IF;
    IF v_batch.quantity < NEW.quantity THEN
      RAISE EXCEPTION 'Batch % has insufficient stock: available %, requested %',
        v_batch.batch_number, v_batch.quantity, NEW.quantity
        USING ERRCODE = 'check_violation';
    END IF;

    UPDATE public.product_batches
    SET quantity = round(quantity - NEW.quantity, 3), updated_at = now()
    WHERE id = v_batch.id;
    INSERT INTO public.sales_invoice_item_batch_allocations(sales_invoice_item_id, batch_id, quantity)
    VALUES (NEW.id, v_batch.id, NEW.quantity);
    v_primary_id := v_batch.id;
    v_primary_number := v_batch.batch_number;
  ELSE
    IF v_strategy = 'MANUAL' OR v_enforce_pos THEN
      RAISE EXCEPTION 'Select a batch for item % before completing this sale', NEW.product_id
        USING ERRCODE = 'check_violation';
    END IF;

    FOR v_batch IN
      SELECT pb.id, pb.batch_number, pb.expiry_date, pb.quantity
      FROM public.product_batches pb
      WHERE pb.product_id = NEW.product_id
        AND pb.warehouse_id = v_warehouse_id
        AND pb.quantity > 0
        AND (NOT v_prevent_expired OR pb.expiry_date IS NULL OR pb.expiry_date > current_date)
      ORDER BY
        CASE WHEN v_strategy = 'FIFO' THEN pb.created_at END ASC,
        CASE WHEN v_strategy = 'FIFO' THEN pb.id END ASC,
        CASE WHEN v_strategy = 'FEFO' THEN pb.expiry_date END ASC NULLS LAST,
        CASE WHEN v_strategy = 'FEFO' THEN pb.created_at END ASC,
        pb.id ASC
      FOR UPDATE
    LOOP
      EXIT WHEN v_remaining <= 0;
      v_take := least(v_batch.quantity, v_remaining);

      UPDATE public.product_batches
      SET quantity = round(quantity - v_take, 3), updated_at = now()
      WHERE id = v_batch.id;
      INSERT INTO public.sales_invoice_item_batch_allocations(sales_invoice_item_id, batch_id, quantity)
      VALUES (NEW.id, v_batch.id, v_take);

      IF v_primary_id IS NULL THEN
        v_primary_id := v_batch.id;
        v_primary_number := v_batch.batch_number;
      END IF;
      v_remaining := v_remaining - v_take;
    END LOOP;

    IF v_remaining > 0 THEN
      RAISE EXCEPTION 'Available eligible batches do not cover item % (short by %)',
        NEW.product_id, v_remaining
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  NEW.batch_id := v_primary_id;
  NEW.batch_number := v_primary_number;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.allocate_sales_invoice_item_batches() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS sales_invoice_item_allocate_batches ON public.sales_invoice_items;
CREATE TRIGGER sales_invoice_item_allocate_batches
BEFORE INSERT ON public.sales_invoice_items
FOR EACH ROW EXECUTE FUNCTION public.allocate_sales_invoice_item_batches();

-- Existing batches whose totals exceed inventory are intentionally not reduced
-- automatically: their original lot attribution cannot be recovered safely.

-- Keep the current split-payment RPC contracts while restoring their batch payloads.
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
    SELECT r.o_product_id AS product_id, sum(r.o_quantity) AS quantity
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
           r.o_quantity     AS quantity,
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
      v_price     := v_line.input_price;
      v_tax_rate  := v_line.input_tax;
      v_line_type := 'AD_HOC_SERVICE';
      v_effect    := 'NONE';
    ELSE
      SELECT p.sale_price, p.tax_rate
        INTO v_price, v_tax_rate
      FROM public.products p WHERE p.id = v_line.product_id;

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
      v_line_type, v_effect, v_line.uom_id, v_line.batch_id, v_line.batch_number
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

GRANT EXECUTE ON FUNCTION public.create_sale(uuid, uuid, text, numeric, numeric, text, jsonb, date, jsonb) TO authenticated, service_role;
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
    END IF;

    v_line_total := v_qty * v_cost;
    v_line_tax   := v_line_total * v_tax_rate / 100;
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
      line_type, stock_effect, batch_number, expiry_date
    )
    VALUES (
      v_invoice_id, v_product, v_qty, v_cost, 0, v_line_tax, v_line_total + v_line_tax,
      v_type, v_effect,
      nullif(btrim(coalesce(v_item ->> 'batch_number', '')), ''),
      nullif(btrim(coalesce(v_item ->> 'expiry_date', '')), '')::date
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

REVOKE ALL ON FUNCTION public.create_purchase(uuid, uuid, text, numeric, numeric, text, jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_purchase(uuid, uuid, text, numeric, numeric, text, jsonb, jsonb) TO authenticated, service_role;

COMMIT;

-- Keep batch dispatch selectable per product and keep lot balances aligned
-- through sales and purchase returns.
BEGIN;

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS batch_dispatch_strategy text;

ALTER TABLE public.products
  DROP CONSTRAINT IF EXISTS products_batch_dispatch_strategy_check;
ALTER TABLE public.products
  ADD CONSTRAINT products_batch_dispatch_strategy_check
  CHECK (batch_dispatch_strategy IS NULL OR batch_dispatch_strategy IN ('FEFO', 'FIFO', 'MANUAL'));

COMMENT ON COLUMN public.products.batch_dispatch_strategy IS
  'Optional per-product batch dispatch override. NULL inherits company batch settings. This controls lot rotation, not inventory valuation.';

CREATE TABLE IF NOT EXISTS public.sales_return_item_batch_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sales_return_item_id uuid NOT NULL REFERENCES public.sales_return_items(id) ON DELETE CASCADE,
  sales_invoice_item_id uuid NOT NULL REFERENCES public.sales_invoice_items(id) ON DELETE RESTRICT,
  batch_id uuid NOT NULL REFERENCES public.product_batches(id) ON DELETE RESTRICT,
  quantity numeric(14,3) NOT NULL CHECK (quantity > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (sales_return_item_id, sales_invoice_item_id, batch_id)
);

CREATE INDEX IF NOT EXISTS idx_sales_return_batch_allocations_source
  ON public.sales_return_item_batch_allocations(sales_invoice_item_id, batch_id);
REVOKE ALL ON TABLE public.sales_return_item_batch_allocations FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS public.purchase_return_item_batch_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_return_item_id uuid NOT NULL REFERENCES public.purchase_return_items(id) ON DELETE CASCADE,
  purchase_invoice_item_id uuid NOT NULL REFERENCES public.purchase_invoice_items(id) ON DELETE RESTRICT,
  batch_id uuid NOT NULL REFERENCES public.product_batches(id) ON DELETE RESTRICT,
  quantity numeric(14,3) NOT NULL CHECK (quantity > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (purchase_return_item_id, purchase_invoice_item_id, batch_id)
);

CREATE INDEX IF NOT EXISTS idx_purchase_return_batch_allocations_source
  ON public.purchase_return_item_batch_allocations(purchase_invoice_item_id, batch_id);
REVOKE ALL ON TABLE public.purchase_return_item_batch_allocations FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.allocate_sales_invoice_item_batches()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_warehouse_id uuid;
  v_tracking public.item_tracking;
  v_product_strategy text;
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

  SELECT p.tracking, p.batch_dispatch_strategy
    INTO v_tracking, v_product_strategy
    FROM public.products p WHERE p.id = NEW.product_id;
  IF v_tracking <> 'BATCH'::public.item_tracking THEN RETURN NEW; END IF;

  SELECT si.warehouse_id INTO v_warehouse_id
    FROM public.sales_invoices si WHERE si.id = NEW.invoice_id;
  SELECT coalesce(cs.batch_settings, '{}'::jsonb) INTO v_settings
    FROM public.company_settings cs LIMIT 1;

  v_strategy := coalesce(v_product_strategy, v_settings ->> 'dispatch_strategy', 'FEFO');
  IF v_strategy NOT IN ('FEFO', 'FIFO', 'MANUAL') THEN v_strategy := 'FEFO'; END IF;
  v_prevent_expired := coalesce((v_settings ->> 'prevent_selling_expired')::boolean, true);
  v_enforce_pos := coalesce((v_settings ->> 'enforce_batch_selection_on_pos')::boolean, false);

  IF NEW.batch_id IS NOT NULL THEN
    SELECT pb.id, pb.batch_number, pb.expiry_date, pb.quantity
      INTO v_batch
      FROM public.product_batches pb
     WHERE pb.id = NEW.batch_id AND pb.product_id = NEW.product_id
       AND pb.warehouse_id = v_warehouse_id
     FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'The selected batch does not belong to this product and warehouse'
        USING ERRCODE = 'check_violation';
    END IF;
    IF v_prevent_expired AND v_batch.expiry_date IS NOT NULL AND v_batch.expiry_date <= current_date THEN
      RAISE EXCEPTION 'Cannot sell expired batch %', v_batch.batch_number USING ERRCODE = 'check_violation';
    END IF;
    IF v_batch.quantity < NEW.quantity THEN
      RAISE EXCEPTION 'Batch % has insufficient stock: available %, requested %',
        v_batch.batch_number, v_batch.quantity, NEW.quantity USING ERRCODE = 'check_violation';
    END IF;
    UPDATE public.product_batches SET quantity = round(quantity - NEW.quantity, 3), updated_at = now()
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
       WHERE pb.product_id = NEW.product_id AND pb.warehouse_id = v_warehouse_id
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
      UPDATE public.product_batches SET quantity = round(quantity - v_take, 3), updated_at = now()
       WHERE id = v_batch.id;
      INSERT INTO public.sales_invoice_item_batch_allocations(sales_invoice_item_id, batch_id, quantity)
      VALUES (NEW.id, v_batch.id, v_take);
      IF v_primary_id IS NULL THEN v_primary_id := v_batch.id; v_primary_number := v_batch.batch_number; END IF;
      v_remaining := v_remaining - v_take;
    END LOOP;
    IF v_remaining > 0 THEN
      RAISE EXCEPTION 'Available eligible batches do not cover item % (short by %)', NEW.product_id, v_remaining
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  NEW.batch_id := v_primary_id;
  NEW.batch_number := v_primary_number;
  RETURN NEW;
END;
$function$;

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
    RAISE EXCEPTION
      'Cannot return this batch-tracked item: original sale has no remaining batch allocation for % units. Reconcile historical sales before returning.',
      v_remaining USING ERRCODE = 'check_violation';
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
    RAISE EXCEPTION
      'Cannot return batch-tracked item: original purchase lots do not cover % units in current stock.',
      v_remaining USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.guard_purchase_return_item_origin()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_invoice_id uuid;
  v_return_supplier uuid;
  v_return_warehouse uuid;
  v_invoice_supplier uuid;
  v_invoice_warehouse uuid;
  v_purchased numeric;
  v_returned numeric;
BEGIN
  IF NEW.product_id IS NULL OR NEW.quantity IS NULL OR NEW.quantity <= 0 THEN
    RAISE EXCEPTION 'Purchase return line requires a product and positive quantity'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT pr.invoice_id, pr.supplier_id, pr.warehouse_id
    INTO v_invoice_id, v_return_supplier, v_return_warehouse
    FROM public.purchase_returns pr WHERE pr.id = NEW.return_id FOR UPDATE;
  IF v_invoice_id IS NULL THEN
    RAISE EXCEPTION 'Purchase returns must reference the original purchase invoice'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT pi.supplier_id, pi.warehouse_id
    INTO v_invoice_supplier, v_invoice_warehouse
    FROM public.purchase_invoices pi WHERE pi.id = v_invoice_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Original purchase invoice does not exist' USING ERRCODE = 'check_violation';
  END IF;
  IF v_return_supplier IS DISTINCT FROM v_invoice_supplier
     OR v_return_warehouse IS DISTINCT FROM v_invoice_warehouse THEN
    RAISE EXCEPTION 'Purchase return supplier and warehouse must match the original invoice'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT coalesce(sum(pii.quantity), 0)
    INTO v_purchased
    FROM public.purchase_invoice_items pii
   WHERE pii.invoice_id = v_invoice_id AND pii.product_id = NEW.product_id;
  IF v_purchased <= 0 THEN
    RAISE EXCEPTION 'Item % is not on the original purchase invoice', NEW.product_id
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT coalesce(sum(pri.quantity), 0)
    INTO v_returned
    FROM public.purchase_return_items pri
    JOIN public.purchase_returns pr ON pr.id = pri.return_id
   WHERE pr.invoice_id = v_invoice_id AND pri.product_id = NEW.product_id;
  IF v_returned + NEW.quantity > v_purchased THEN
    RAISE EXCEPTION 'Purchase return exceeds received quantity: received %, already returned %, requested %',
      v_purchased, v_returned, NEW.quantity USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS purchase_return_item_origin_guard ON public.purchase_return_items;
CREATE TRIGGER purchase_return_item_origin_guard
BEFORE INSERT ON public.purchase_return_items
FOR EACH ROW EXECUTE FUNCTION public.guard_purchase_return_item_origin();
DROP TRIGGER IF EXISTS sales_return_item_restore_batches ON public.sales_return_items;
CREATE TRIGGER sales_return_item_restore_batches
AFTER INSERT ON public.sales_return_items
FOR EACH ROW EXECUTE FUNCTION public.restore_sales_return_item_batches();

DROP TRIGGER IF EXISTS purchase_return_item_consume_batches ON public.purchase_return_items;
CREATE TRIGGER purchase_return_item_consume_batches
AFTER INSERT ON public.purchase_return_items
FOR EACH ROW EXECUTE FUNCTION public.consume_purchase_return_item_batches();

REVOKE ALL ON FUNCTION public.restore_sales_return_item_batches() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.consume_purchase_return_item_batches() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guard_purchase_return_item_origin() FROM PUBLIC, anon, authenticated;

COMMIT;

-- Rollback: drop return allocation/origin triggers/functions and allocation tables,
-- remove products_batch_dispatch_strategy_check and batch_dispatch_strategy,
-- and restore public.allocate_sales_invoice_item_batches() from migration 80.

-- Central, audited negative-sale policy.
--
-- The exception is deliberately narrow: only a company-owned STOCK_ISSUE
-- created by a sales invoice may take a balance below zero. Manufacturing,
-- transfers, stocktakes and other stock documents remain fail-closed.
BEGIN;

ALTER TABLE public.company_settings
  ADD COLUMN IF NOT EXISTS allow_negative_sales boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.company_settings.allow_negative_sales IS
  'Allows only posted sales-invoice issues to create negative company stock. It never authorizes production, transfer, adjustment, or custody stock to go negative.';

-- A negative-sale batch is an internal balancing lot. Normal lots remain
-- non-negative, and the flag makes the exceptional row explicit/auditable.
ALTER TABLE public.product_batches
  ADD COLUMN IF NOT EXISTS is_negative_balance boolean NOT NULL DEFAULT false;

ALTER TABLE public.product_batches
  DROP CONSTRAINT IF EXISTS product_batches_quantity_nonnegative;
ALTER TABLE public.product_batches
  DROP CONSTRAINT IF EXISTS product_batches_quantity_or_negative_balance;
ALTER TABLE public.product_batches
  ADD CONSTRAINT product_batches_quantity_or_negative_balance
  CHECK (quantity >= 0 OR is_negative_balance);

COMMENT ON COLUMN public.product_batches.is_negative_balance IS
  'System-only negative-sale balancing batch. Physical receipt lots must remain non-negative.';

-- Cost layers must mirror a permitted negative quantity. Keeping the estimated
-- negative value is what lets the next receipt settle the oversold quantity
-- instead of inflating the cost of the remaining balance.
ALTER TABLE public.item_cost_layers
  DROP CONSTRAINT IF EXISTS item_cost_layers_qty_check;
ALTER TABLE public.item_cost_layers
  DROP CONSTRAINT IF EXISTS item_cost_layers_value_check;

CREATE OR REPLACE FUNCTION public.apply_cost_movement(
  p_product_id uuid,
  p_warehouse_id uuid,
  p_signed_qty numeric,
  p_incoming_cost numeric DEFAULT NULL::numeric,
  p_source_type text DEFAULT NULL::text,
  p_source_id uuid DEFAULT NULL::uuid,
  p_note text DEFAULT NULL::text,
  p_owner_type public.owner_type DEFAULT 'COMPANY'::public.owner_type,
  p_owner_id uuid DEFAULT NULL::uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user     uuid := auth.uid();
  v_method   public.costing_method := CASE
    WHEN p_owner_type = 'COMPANY'::public.owner_type
      THEN public.company_costing_method()
    ELSE 'MOVING_AVERAGE'::public.costing_method
  END;
  v_qty0     numeric := 0;
  v_val0     numeric := 0;
  v_in_cost  numeric;
  v_out_cost numeric;
  v_qty1     numeric;
  v_val1     numeric;
  v_tx_cost  numeric;
BEGIN
  IF p_signed_qty IS NULL OR p_signed_qty = 0 THEN RETURN; END IF;
  IF p_signed_qty <> round(p_signed_qty, 3) THEN
    RAISE EXCEPTION 'Stock movement quantity exceeds the supported precision of three decimal places'
      USING ERRCODE = 'check_violation';
  END IF;
  IF p_product_id IS NULL OR p_warehouse_id IS NULL THEN
    RAISE EXCEPTION 'Item and location are required to value a movement';
  END IF;
  IF p_owner_type = 'COMPANY'::public.owner_type
     AND v_method IS DISTINCT FROM 'MOVING_AVERAGE'::public.costing_method THEN
    RAISE EXCEPTION
      'Company stock posting is blocked because the saved costing method (%) is not supported. Switch to MOVING_AVERAGE in Stock Settings before posting stock documents.',
      v_method USING ERRCODE = '55000';
  END IF;

  SELECT cl.quantity, cl.total_value INTO v_qty0, v_val0
    FROM public.item_cost_layers cl
   WHERE cl.product_id = p_product_id AND cl.warehouse_id = p_warehouse_id
     AND cl.owner_type = p_owner_type AND cl.owner_id IS NOT DISTINCT FROM p_owner_id
   FOR UPDATE;
  v_qty0 := coalesce(v_qty0, 0);
  v_val0 := coalesce(v_val0, 0);
  v_qty1 := round(v_qty0 + p_signed_qty, 3);

  IF p_signed_qty > 0 THEN
    v_in_cost := coalesce(
      p_incoming_cost,
      CASE WHEN v_qty0 > 0 THEN round(v_val0 / v_qty0, 4) END,
      (SELECT p.cost_price FROM public.products p WHERE p.id = p_product_id), 0);
    v_val1 := v_val0 + round(p_signed_qty * v_in_cost, 2);
    v_tx_cost := coalesce(p_incoming_cost, v_in_cost, 0);
  ELSE
    v_out_cost := CASE WHEN v_qty0 > 0 THEN round(v_val0 / v_qty0, 4)
                       ELSE coalesce((SELECT p.cost_price FROM public.products p WHERE p.id = p_product_id), 0)
                  END;
    -- Do not clamp at zero: a negative value is the estimated cost of an
    -- oversold balance and is settled by the next receipt.
    v_val1 := v_val0 - round(abs(p_signed_qty) * v_out_cost, 2);
    v_tx_cost := coalesce(v_out_cost, 0);
  END IF;

  INSERT INTO public.item_cost_layers
    (product_id, warehouse_id, owner_type, owner_id, quantity, total_value,
     valuation_method, last_unit_cost, last_movement_at, updated_at)
  VALUES
    (p_product_id, p_warehouse_id, p_owner_type, p_owner_id, v_qty1, v_val1,
     v_method, coalesce(p_incoming_cost, v_in_cost, v_out_cost, 0), now(), now())
  ON CONFLICT (product_id, warehouse_id, owner_type, owner_id)
  DO UPDATE SET quantity = EXCLUDED.quantity, total_value = EXCLUDED.total_value,
                valuation_method = EXCLUDED.valuation_method,
                last_unit_cost = EXCLUDED.last_unit_cost, last_movement_at = now(), updated_at = now();

  INSERT INTO public.item_cost_transactions
    (product_id, warehouse_id, owner_type, owner_id, direction, quantity, unit_cost, value,
     method, quantity_before, value_before, quantity_after, value_after, source_type, source_id, note)
  VALUES
    (p_product_id, p_warehouse_id, p_owner_type, p_owner_id,
     CASE WHEN p_signed_qty > 0 THEN 'IN' ELSE 'OUT' END, abs(p_signed_qty), v_tx_cost,
     round(abs(p_signed_qty) * v_tx_cost, 2), v_method, v_qty0, v_val0, v_qty1, v_val1,
     p_source_type, p_source_id, p_note);

  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, payload)
  VALUES (v_user, 'cost.movement_applied', 'product', p_product_id,
    jsonb_build_object('warehouse_id', p_warehouse_id, 'method', v_method,
      'direction', CASE WHEN p_signed_qty > 0 THEN 'IN' ELSE 'OUT' END,
      'quantity', abs(p_signed_qty), 'actual_purchase_cost', CASE WHEN p_signed_qty > 0 THEN p_incoming_cost ELSE NULL END,
      'valuation_unit_cost', CASE WHEN p_signed_qty > 0 THEN v_in_cost ELSE v_out_cost END,
      'quantity_after', v_qty1, 'value_after', v_val1, 'source_type', p_source_type, 'source_id', p_source_id));
END;
$function$;

CREATE OR REPLACE FUNCTION public.post_stock_delta(
  p_product_id uuid,
  p_warehouse_id uuid,
  p_signed_qty numeric,
  p_unit_cost numeric DEFAULT NULL::numeric,
  p_movement_kind public.stock_movement_kind DEFAULT 'ADJUSTMENT'::public.stock_movement_kind,
  p_source_type text DEFAULT NULL::text,
  p_source_id uuid DEFAULT NULL::uuid,
  p_note text DEFAULT NULL::text,
  p_owner_type public.owner_type DEFAULT 'COMPANY'::public.owner_type,
  p_owner_id uuid DEFAULT NULL::uuid,
  p_movement_type_legacy public.movement_type DEFAULT NULL::public.movement_type
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_mt public.movement_type;
  v_policy public.inventory_policy;
  v_nature public.item_nature;
  v_before numeric;
  v_after numeric;
  v_val0 numeric;
  v_val1 numeric;
  v_value numeric;
  v_movement_id uuid;
  v_allow_negative_sales boolean := false;
  v_permitted_negative_issue boolean := false;
BEGIN
  IF v_user IS NOT NULL AND NOT public.is_staff(v_user) THEN RAISE EXCEPTION 'Forbidden'; END IF;
  IF p_signed_qty IS NULL OR p_signed_qty = 0 THEN RETURN; END IF;
  IF p_signed_qty <> round(p_signed_qty, 3) THEN
    RAISE EXCEPTION 'Stock movement quantity exceeds the supported precision of three decimal places'
      USING ERRCODE = 'check_violation';
  END IF;
  IF p_product_id IS NULL OR p_warehouse_id IS NULL THEN
    RAISE EXCEPTION 'Item and warehouse are required for a stock movement';
  END IF;

  SELECT allow_negative_sales INTO v_allow_negative_sales
    FROM public.company_settings WHERE id = 1 FOR SHARE;
  v_allow_negative_sales := coalesce(v_allow_negative_sales, false);
  v_permitted_negative_issue := v_allow_negative_sales
    AND p_owner_type = 'COMPANY'::public.owner_type
    AND p_movement_kind = 'ISSUE'::public.stock_movement_kind
    AND p_source_type = 'sales_invoice';

  v_mt := coalesce(p_movement_type_legacy, CASE p_movement_kind
    WHEN 'RECEIPT' THEN 'purchase'::public.movement_type
    WHEN 'ISSUE' THEN 'sale'::public.movement_type
    WHEN 'TRANSFER_IN' THEN 'transfer_in'::public.movement_type
    WHEN 'TRANSFER_OUT' THEN 'transfer_out'::public.movement_type
    ELSE 'adjustment'::public.movement_type END);

  SELECT p.item_nature, public.item_effective_policy(p.id) INTO v_nature, v_policy
    FROM public.products p WHERE p.id = p_product_id;
  IF v_nature = 'SERVICE' OR v_policy <> 'TRACKED' THEN
    RAISE EXCEPTION 'Item % does not hold company stock (nature %, policy %)',
      p_product_id, coalesce(v_nature::text, '?'), coalesce(v_policy::text, '?');
  END IF;

  SELECT i.quantity INTO v_before FROM public.inventory i
   WHERE i.product_id = p_product_id AND i.warehouse_id = p_warehouse_id
     AND i.owner_type = p_owner_type AND i.owner_id IS NOT DISTINCT FROM p_owner_id FOR UPDATE;
  v_before := coalesce(v_before, 0);
  v_after := round(v_before + p_signed_qty, 3);
  IF v_after < 0 AND NOT v_permitted_negative_issue THEN
    RAISE EXCEPTION 'Insufficient stock for item % in warehouse %: available %, requested %',
      p_product_id, p_warehouse_id, v_before, abs(p_signed_qty) USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO public.inventory (product_id, warehouse_id, owner_type, owner_id, quantity)
  VALUES (p_product_id, p_warehouse_id, p_owner_type, p_owner_id, v_after)
  ON CONFLICT (product_id, warehouse_id, owner_type, owner_id)
  DO UPDATE SET quantity = EXCLUDED.quantity, updated_at = now();

  SELECT cl.total_value INTO v_val0 FROM public.item_cost_layers cl
   WHERE cl.product_id = p_product_id AND cl.warehouse_id = p_warehouse_id
     AND cl.owner_type = p_owner_type AND cl.owner_id IS NOT DISTINCT FROM p_owner_id;
  v_val0 := coalesce(v_val0, 0);

  PERFORM set_config('app.stock_engine', 'on', true);
  INSERT INTO public.stock_movements
    (product_id, warehouse_id, movement_type, quantity, unit_cost, reference, note, created_by,
     movement_kind, source_type, source_id, owner_type, owner_id, adjustment_reason)
  VALUES
    (p_product_id, p_warehouse_id, v_mt, p_signed_qty, p_unit_cost,
     coalesce(p_source_type, '') || coalesce(':' || p_source_id::text, ''), p_note, v_user,
     p_movement_kind, p_source_type, p_source_id, p_owner_type, p_owner_id,
     CASE WHEN v_mt = 'adjustment'::public.movement_type
       THEN coalesce(nullif(btrim(p_note), ''), nullif(btrim(p_source_type), ''), 'Stock adjustment') ELSE NULL END)
  RETURNING id INTO v_movement_id;

  PERFORM public.apply_cost_movement(p_product_id, p_warehouse_id, p_signed_qty, p_unit_cost,
    p_source_type, p_source_id, p_note, p_owner_type, p_owner_id);

  SELECT cl.total_value INTO v_val1 FROM public.item_cost_layers cl
   WHERE cl.product_id = p_product_id AND cl.warehouse_id = p_warehouse_id
     AND cl.owner_type = p_owner_type AND cl.owner_id IS NOT DISTINCT FROM p_owner_id;
  v_val1 := coalesce(v_val1, 0);
  v_value := CASE WHEN p_signed_qty > 0 THEN round(abs(v_val1 - v_val0), 2)
                  ELSE round(abs(v_val0 - v_val1), 2) END;
  UPDATE public.stock_movements SET total_cost = v_value,
    unit_cost = CASE WHEN p_signed_qty <> 0 THEN round(v_value / abs(p_signed_qty), 4) ELSE unit_cost END
   WHERE id = v_movement_id;
  PERFORM set_config('app.stock_engine', 'off', true);
END;
$function$;

-- Keep FEFO/FIFO/manual allocation for physical lots, then represent only the
-- uncovered balance in one explicitly flagged system lot. The sales-return
-- allocator already restores its recorded allocations, so an oversold portion
-- is automatically settled if that sales line is returned.
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
$function$;

REVOKE ALL ON FUNCTION public.apply_cost_movement(uuid, uuid, numeric, numeric, text, uuid, text, public.owner_type, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.post_stock_delta(uuid, uuid, numeric, numeric, public.stock_movement_kind, text, uuid, text, public.owner_type, uuid, public.movement_type) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.allocate_sales_invoice_item_batches() FROM PUBLIC, anon, authenticated;

COMMIT;

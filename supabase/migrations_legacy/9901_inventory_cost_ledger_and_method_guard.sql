-- Keep the cost transaction ledger truthful on receipts and issues. The only
-- supported company valuation engine is moving average; if a legacy setting
-- still names an incomplete method, company stock postings fail closed until an
-- owner or manager switches it. Customer-owned material is not valued by the
-- company's costing policy. This migration does not rewrite company settings.
BEGIN;

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
  IF p_signed_qty IS NULL OR p_signed_qty = 0 THEN
    RETURN;
  END IF;
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
      v_method
      USING ERRCODE = '55000';
  END IF;

  SELECT cl.quantity, cl.total_value
    INTO v_qty0, v_val0
    FROM public.item_cost_layers cl
   WHERE cl.product_id = p_product_id
     AND cl.warehouse_id = p_warehouse_id
     AND cl.owner_type = p_owner_type
     AND cl.owner_id IS NOT DISTINCT FROM p_owner_id
   FOR UPDATE;

  v_qty0 := coalesce(v_qty0, 0);
  v_val0 := coalesce(v_val0, 0);
  v_qty1 := round(v_qty0 + p_signed_qty, 3);

  IF p_signed_qty > 0 THEN
    v_in_cost := coalesce(
      p_incoming_cost,
      CASE WHEN v_qty0 > 0 THEN round(v_val0 / v_qty0, 4) END,
      (SELECT p.cost_price FROM public.products p WHERE p.id = p_product_id),
      0
    );
    v_val1 := v_val0 + round(p_signed_qty * v_in_cost, 2);
    -- Receipts record actual purchase cost when supplied; internal receipts
    -- without a source cost use the valuation cost assigned by the engine.
    v_tx_cost := coalesce(p_incoming_cost, v_in_cost, 0);
  ELSE
    IF v_qty0 <= 0 THEN
      v_out_cost := coalesce(
        (SELECT p.cost_price FROM public.products p WHERE p.id = p_product_id),
        0
      );
    ELSE
      v_out_cost := round(v_val0 / v_qty0, 4);
    END IF;

    v_val1 := v_val0 - round(abs(p_signed_qty) * v_out_cost, 2);
    IF v_qty1 <= 0 OR v_val1 < 0 THEN
      v_val1 := 0;
    END IF;
    -- Issues are valued at the cost removed from inventory. The previous
    -- implementation wrote zero because it only looked at p_incoming_cost.
    v_tx_cost := coalesce(v_out_cost, 0);
  END IF;

  INSERT INTO public.item_cost_layers
    (product_id, warehouse_id, owner_type, owner_id, quantity, total_value,
     valuation_method, last_unit_cost, last_movement_at, updated_at)
  VALUES
    (p_product_id, p_warehouse_id, p_owner_type, p_owner_id, v_qty1, v_val1,
     v_method, coalesce(p_incoming_cost, v_in_cost, v_out_cost, 0), now(), now())
  ON CONFLICT (product_id, warehouse_id, owner_type, owner_id)
  DO UPDATE SET quantity = EXCLUDED.quantity,
                total_value = EXCLUDED.total_value,
                valuation_method = EXCLUDED.valuation_method,
                last_unit_cost = EXCLUDED.last_unit_cost,
                last_movement_at = now(),
                updated_at = now();

  INSERT INTO public.item_cost_transactions
    (product_id, warehouse_id, owner_type, owner_id, direction, quantity,
     unit_cost, value, method, quantity_before, value_before,
     quantity_after, value_after, source_type, source_id, note)
  VALUES
    (p_product_id, p_warehouse_id, p_owner_type, p_owner_id,
     CASE WHEN p_signed_qty > 0 THEN 'IN' ELSE 'OUT' END,
     abs(p_signed_qty), v_tx_cost,
     round(abs(p_signed_qty) * v_tx_cost, 2), v_method, v_qty0, v_val0,
     v_qty1, v_val1, p_source_type, p_source_id, p_note);

  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, payload)
  VALUES (v_user, 'cost.movement_applied', 'product', p_product_id,
    jsonb_build_object(
      'warehouse_id', p_warehouse_id,
      'method', v_method,
      'direction', CASE WHEN p_signed_qty > 0 THEN 'IN' ELSE 'OUT' END,
      'quantity', abs(p_signed_qty),
      'actual_purchase_cost', CASE WHEN p_signed_qty > 0 THEN p_incoming_cost ELSE NULL END,
      'valuation_unit_cost', CASE WHEN p_signed_qty > 0 THEN v_in_cost ELSE v_out_cost END,
      'quantity_after', v_qty1,
      'value_after', v_val1,
      'source_type', p_source_type,
      'source_id', p_source_id));
END;
$function$;

COMMENT ON FUNCTION public.apply_cost_movement(uuid, uuid, numeric, numeric, text, uuid, text, public.owner_type, uuid) IS
  'Internal moving-average valuation writer. Company movements fail closed when an unsupported costing method remains saved; customer-owned material never uses company costing policy.';

-- Keep each stock movement's value synchronized with the exact valuation-layer
-- change. Receipts with no explicit incoming price (such as sales returns) use
-- the layer's moving average; their movement must record the increase, not zero.
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
  v_user    uuid := auth.uid();
  v_mt      public.movement_type;
  v_policy  public.inventory_policy;
  v_nature  public.item_nature;
  v_before  numeric;
  v_after   numeric;
  v_val0    numeric;
  v_val1    numeric;
  v_value   numeric;
  v_movement_id uuid;
BEGIN
  IF v_user IS NOT NULL AND NOT public.is_staff(v_user) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  IF p_signed_qty IS NULL OR p_signed_qty = 0 THEN
    RETURN;
  END IF;
  IF p_signed_qty <> round(p_signed_qty, 3) THEN
    RAISE EXCEPTION 'Stock movement quantity exceeds the supported precision of three decimal places'
      USING ERRCODE = 'check_violation';
  END IF;
  IF p_product_id IS NULL OR p_warehouse_id IS NULL THEN
    RAISE EXCEPTION 'Item and warehouse are required for a stock movement';
  END IF;

  v_mt := coalesce(
    p_movement_type_legacy,
    CASE p_movement_kind
      WHEN 'RECEIPT'      THEN 'purchase'::public.movement_type
      WHEN 'ISSUE'        THEN 'sale'::public.movement_type
      WHEN 'TRANSFER_IN'  THEN 'transfer_in'::public.movement_type
      WHEN 'TRANSFER_OUT' THEN 'transfer_out'::public.movement_type
      ELSE 'adjustment'::public.movement_type
    END
  );

  SELECT p.item_nature, public.item_effective_policy(p.id)
    INTO v_nature, v_policy
    FROM public.products p
   WHERE p.id = p_product_id;
  IF v_nature = 'SERVICE' OR v_policy <> 'TRACKED' THEN
    RAISE EXCEPTION
      'Item % does not hold company stock (nature %, policy %)',
      p_product_id, coalesce(v_nature::text, '?'), coalesce(v_policy::text, '?');
  END IF;

  SELECT i.quantity INTO v_before
    FROM public.inventory i
   WHERE i.product_id = p_product_id
     AND i.warehouse_id = p_warehouse_id
     AND i.owner_type = p_owner_type
     AND i.owner_id IS NOT DISTINCT FROM p_owner_id
   FOR UPDATE;
  v_before := coalesce(v_before, 0);
  v_after := round(v_before + p_signed_qty, 3);
  IF v_after < 0 AND p_owner_type = 'COMPANY' THEN
    RAISE EXCEPTION
      'Insufficient stock for item % in warehouse %: available %, requested %',
      p_product_id, p_warehouse_id, v_before, abs(p_signed_qty)
      USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO public.inventory
    (product_id, warehouse_id, owner_type, owner_id, quantity)
  VALUES
    (p_product_id, p_warehouse_id, p_owner_type, p_owner_id, v_after)
  ON CONFLICT (product_id, warehouse_id, owner_type, owner_id)
  DO UPDATE SET quantity = EXCLUDED.quantity, updated_at = now();

  SELECT cl.total_value INTO v_val0
    FROM public.item_cost_layers cl
   WHERE cl.product_id = p_product_id
     AND cl.warehouse_id = p_warehouse_id
     AND cl.owner_type = p_owner_type
     AND cl.owner_id IS NOT DISTINCT FROM p_owner_id;
  v_val0 := coalesce(v_val0, 0);

  PERFORM set_config('app.stock_engine', 'on', true);
  INSERT INTO public.stock_movements
    (product_id, warehouse_id, movement_type, quantity, unit_cost, reference,
     note, created_by, movement_kind, source_type, source_id, owner_type, owner_id,
     adjustment_reason)
  VALUES
    (p_product_id, p_warehouse_id, v_mt, p_signed_qty, p_unit_cost,
     coalesce(p_source_type, '') || coalesce(':' || p_source_id::text, ''),
     p_note, v_user, p_movement_kind, p_source_type, p_source_id, p_owner_type,
     p_owner_id,
     CASE WHEN v_mt = 'adjustment'::public.movement_type
          THEN coalesce(nullif(btrim(p_note), ''), nullif(btrim(p_source_type), ''), 'Stock adjustment')
          ELSE NULL END)
  RETURNING id INTO v_movement_id;

  PERFORM public.apply_cost_movement(
    p_product_id => p_product_id,
    p_warehouse_id => p_warehouse_id,
    p_signed_qty => p_signed_qty,
    p_incoming_cost => p_unit_cost,
    p_source_type => p_source_type,
    p_source_id => p_source_id,
    p_note => p_note,
    p_owner_type => p_owner_type,
    p_owner_id => p_owner_id);

  SELECT cl.total_value INTO v_val1
    FROM public.item_cost_layers cl
   WHERE cl.product_id = p_product_id
     AND cl.warehouse_id = p_warehouse_id
     AND cl.owner_type = p_owner_type
     AND cl.owner_id IS NOT DISTINCT FROM p_owner_id;
  v_val1 := coalesce(v_val1, 0);

  IF p_signed_qty > 0 THEN
    v_value := round(greatest(v_val1 - v_val0, 0), 2);
  ELSE
    v_value := round(greatest(v_val0 - v_val1, 0), 2);
  END IF;

  UPDATE public.stock_movements
     SET total_cost = v_value,
         unit_cost = CASE
           WHEN p_signed_qty <> 0 AND v_value IS NOT NULL
             THEN round(v_value / abs(p_signed_qty), 4)
           ELSE unit_cost
         END
   WHERE id = v_movement_id;
  PERFORM set_config('app.stock_engine', 'off', true);
END;
$function$;

COMMENT ON FUNCTION public.post_stock_delta(uuid, uuid, numeric, numeric, public.stock_movement_kind, text, uuid, text, public.owner_type, uuid, public.movement_type) IS
  'Posts quantity and exact valuation-layer value atomically; receipts and issues both record the layer value change.';

CREATE OR REPLACE FUNCTION public.set_company_costing_method(
  _method text,
  _source text,
  _notes text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_old public.costing_method;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT (public.has_role(v_user, 'owner') OR public.has_role(v_user, 'manager')) THEN
    RAISE EXCEPTION 'Only an owner or manager can change the company costing method';
  END IF;

  _method := upper(btrim(coalesce(_method, '')));
  IF _method <> 'MOVING_AVERAGE' THEN
    RAISE EXCEPTION
      'Only MOVING_AVERAGE is currently available. FIFO valuation layers and standard cost variance posting are not complete.'
      USING ERRCODE = '22023';
  END IF;

  SELECT costing_method INTO v_old
    FROM public.company_costing_settings
   WHERE id = 1
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Company costing settings row is missing';
  END IF;
  IF v_old = 'MOVING_AVERAGE'::public.costing_method THEN
    RETURN;
  END IF;

  IF EXISTS (
       SELECT 1
         FROM public.inventory i
        WHERE i.owner_type = 'COMPANY'::public.owner_type
          AND i.quantity <> 0
     ) OR EXISTS (
       SELECT 1
         FROM public.item_cost_layers cl
        WHERE cl.owner_type = 'COMPANY'::public.owner_type
          AND (cl.quantity <> 0 OR cl.total_value <> 0)
     ) THEN
    RAISE EXCEPTION
      'Cannot switch the saved costing method while company stock or non-zero cost layers exist. Reconcile the balances before changing the valuation method.'
      USING ERRCODE = '55000';
  END IF;

  UPDATE public.company_costing_settings
     SET costing_method = 'MOVING_AVERAGE'::public.costing_method,
         effective_from = CURRENT_DATE,
         updated_by = v_user,
         updated_at = now(),
         notes = nullif(btrim(coalesce(_notes, '')), '')
   WHERE id = 1;

  INSERT INTO public.costing_policy_history
    (costing_method, previous_method, reason, changed_by)
  VALUES
    ('MOVING_AVERAGE'::public.costing_method, v_old,
     nullif(btrim(coalesce(_notes, '')), ''), v_user);
END;
$function$;

COMMENT ON FUNCTION public.set_company_costing_method(text, text, text) IS
  'Allows only the supported company-wide moving-average method until FIFO and standard valuation are fully integrated.';

CREATE OR REPLACE FUNCTION public.enforce_invoice_product_flags()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_active boolean;
  v_allowed boolean;
BEGIN
  IF NEW.product_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'sales_invoice_items' THEN
    SELECT p.is_active, p.is_sellable
      INTO v_active, v_allowed
      FROM public.products p
     WHERE p.id = NEW.product_id;
    IF NOT FOUND OR v_active IS NOT TRUE OR v_allowed IS NOT TRUE THEN
      RAISE EXCEPTION 'Item % is inactive or not marked as sellable', NEW.product_id
        USING ERRCODE = 'check_violation';
    END IF;
  ELSIF TG_TABLE_NAME = 'purchase_invoice_items' THEN
    SELECT p.is_active, p.is_purchasable
      INTO v_active, v_allowed
      FROM public.products p
     WHERE p.id = NEW.product_id;
    IF NOT FOUND OR v_active IS NOT TRUE OR v_allowed IS NOT TRUE THEN
      RAISE EXCEPTION 'Item % is inactive or not marked as purchasable', NEW.product_id
        USING ERRCODE = 'check_violation';
    END IF;
  ELSE
    RAISE EXCEPTION 'Unexpected invoice item table: %', TG_TABLE_NAME;
  END IF;

  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.enforce_invoice_product_flags() IS
  'Final server-side guard for active, sellable sales lines and active, purchasable purchase lines.';

DROP TRIGGER IF EXISTS sales_invoice_items_product_flags ON public.sales_invoice_items;
CREATE TRIGGER sales_invoice_items_product_flags
BEFORE INSERT OR UPDATE ON public.sales_invoice_items
FOR EACH ROW EXECUTE FUNCTION public.enforce_invoice_product_flags();

DROP TRIGGER IF EXISTS purchase_invoice_items_product_flags ON public.purchase_invoice_items;
CREATE TRIGGER purchase_invoice_items_product_flags
BEFORE INSERT OR UPDATE ON public.purchase_invoice_items
FOR EACH ROW EXECUTE FUNCTION public.enforce_invoice_product_flags();

REVOKE ALL ON FUNCTION public.enforce_invoice_product_flags() FROM PUBLIC, anon, authenticated;

-- Cost layers are an internal posting ledger. Invoice, opening-stock and stock
-- document RPCs call this function as their definer; clients must not invoke
-- it directly to fabricate valuation rows without a matching stock movement.
REVOKE ALL ON FUNCTION public.apply_cost_movement(
  uuid, uuid, numeric, numeric, text, uuid, text, public.owner_type, uuid
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_cost_movement(
  uuid, uuid, numeric, numeric, text, uuid, text, public.owner_type, uuid
) TO service_role;

COMMIT;

-- Rollback: drop both invoice item triggers and enforce_invoice_product_flags(),
-- then restore apply_cost_movement() and set_company_costing_method() from
-- 05_products_and_inventory.sql, post_stock_delta() from 44_form_fix_forward.sql,
-- and the apply_cost_movement() execute grants from 13_foreign_keys_and_grants.sql.

-- Keep the cost transaction ledger truthful on both receipts and issues, and
-- prevent selecting costing methods whose inventory/accounting engines are
-- not complete. Existing settings are not rewritten by this migration.
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
  v_method   public.costing_method := public.company_costing_method();
  v_qty0     numeric := 0;
  v_val0     numeric := 0;
  v_in_cost  numeric;
  v_out_cost numeric;
  v_qty1     numeric;
  v_val1     numeric;
  v_standard numeric;
  v_pending  integer;
  v_tx_cost  numeric;
BEGIN
  IF p_signed_qty IS NULL OR p_signed_qty = 0 THEN
    RETURN;
  END IF;
  IF p_product_id IS NULL OR p_warehouse_id IS NULL THEN
    RAISE EXCEPTION 'Item and location are required to value a movement';
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
    IF v_method = 'STANDARD' THEN
      SELECT p.standard_cost INTO v_standard
        FROM public.products p WHERE p.id = p_product_id;

      IF v_standard IS NULL OR v_standard = 0 THEN
        SELECT count(*)::int INTO v_pending
          FROM public.standard_cost_readiness;
        RAISE EXCEPTION
          'Standard cost is not set for this item (%). % more tracked item(s) also lack one - see standard_cost_readiness.',
          p_product_id, v_pending;
      END IF;
      v_in_cost := v_standard;
    ELSE
      v_in_cost := coalesce(
        p_incoming_cost,
        CASE WHEN v_qty0 > 0 THEN round(v_val0 / v_qty0, 4) END,
        (SELECT p.cost_price FROM public.products p WHERE p.id = p_product_id),
        0
      );
    END IF;
    v_val1 := v_val0 + round(p_signed_qty * v_in_cost, 2);
    -- Receipts record actual purchase cost when supplied; internal receipts
    -- without a source cost use the valuation cost assigned by the engine.
    v_tx_cost := coalesce(p_incoming_cost, v_in_cost, 0);
  ELSE
    IF v_qty0 <= 0 THEN
      v_out_cost := coalesce(
        (SELECT p.standard_cost FROM public.products p
          WHERE p.id = p_product_id AND v_method = 'STANDARD'),
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
  'Applies the central inventory valuation and records non-zero actual receipt or issue cost in item_cost_transactions.';

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

COMMIT;

-- Rollback: drop both invoice item triggers and enforce_invoice_product_flags(),
-- then restore apply_cost_movement() and set_company_costing_method() from
-- 05_products_and_inventory.sql.

-- 30_fix_stock_delta_adjustment_reason.sql
-- Fix check constraint stock_movements_adjustment_reason_required
-- by populating adjustment_reason upon INSERT in post_stock_delta when legacy movement type is 'adjustment'.

CREATE OR REPLACE FUNCTION public.post_stock_delta(
  p_product_id uuid,
  p_warehouse_id uuid,
  p_signed_qty numeric,
  p_unit_cost numeric DEFAULT NULL::numeric,
  p_movement_kind stock_movement_kind DEFAULT 'ADJUSTMENT'::stock_movement_kind,
  p_source_type text DEFAULT NULL::text,
  p_source_id uuid DEFAULT NULL::uuid,
  p_note text DEFAULT NULL::text,
  p_owner_type owner_type DEFAULT 'COMPANY'::owner_type,
  p_owner_id uuid DEFAULT NULL::uuid,
  p_movement_type_legacy movement_type DEFAULT NULL::movement_type
)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_existing    numeric;
  v_new_qty     numeric;
  v_total_cost  numeric;
  v_legacy_type public.movement_type;
  v_owner_type  public.owner_type := COALESCE(p_owner_type, 'COMPANY');
BEGIN
  IF p_signed_qty IS NULL OR p_signed_qty = 0 THEN
    RAISE EXCEPTION 'Stock delta must be a non-zero quantity';
  END IF;

  IF p_product_id IS NULL OR p_warehouse_id IS NULL THEN
    RAISE EXCEPTION 'Item and location are required for a stock movement';
  END IF;

  -- Lock the exact position being changed.
  SELECT quantity
    INTO v_existing
  FROM public.inventory
  WHERE product_id = p_product_id
    AND warehouse_id = p_warehouse_id
    AND owner_type = v_owner_type
    AND owner_id IS NOT DISTINCT FROM p_owner_id
  FOR UPDATE;

  v_existing := COALESCE(v_existing, 0);
  v_new_qty  := round(v_existing + p_signed_qty, 3);

  -- Stock can never go negative, for company stock or for customer-owned stock.
  IF v_new_qty < 0 THEN
    RAISE EXCEPTION
      'Insufficient stock: item %, location %, available %, requested %',
      p_product_id, p_warehouse_id, v_existing, abs(p_signed_qty)
      USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO public.inventory (product_id, warehouse_id, quantity, owner_type, owner_id, updated_at)
  VALUES (p_product_id, p_warehouse_id, v_new_qty, v_owner_type, p_owner_id, now())
  ON CONFLICT (product_id, warehouse_id, owner_type, owner_id)
  DO UPDATE SET quantity = v_new_qty, updated_at = now();

  v_total_cost := CASE
    WHEN p_unit_cost IS NULL THEN NULL
    ELSE round(abs(p_signed_qty) * p_unit_cost, 2)
  END;

  -- Legacy enum value, so the old reporting paths keep working unchanged.
  v_legacy_type := COALESCE(
    p_movement_type_legacy,
    CASE p_movement_kind
      WHEN 'RECEIPT'      THEN 'purchase'::public.movement_type
      WHEN 'ISSUE'        THEN 'sale'::public.movement_type
      WHEN 'TRANSFER_IN'  THEN 'transfer_in'::public.movement_type
      WHEN 'TRANSFER_OUT' THEN 'transfer_out'::public.movement_type
      WHEN 'OPENING'      THEN 'opening'::public.movement_type
      WHEN 'PRODUCTION'   THEN 'production_in'::public.movement_type
      ELSE 'adjustment'::public.movement_type
    END
  );

  INSERT INTO public.stock_movements (
    product_id, warehouse_id, movement_type, movement_kind,
    quantity, unit_cost, total_cost,
    reference_type, reference_id, source_type, source_id,
    owner_type, owner_id,
    note, created_by,
    adjustment_reason
  )
  VALUES (
    p_product_id, p_warehouse_id, v_legacy_type, p_movement_kind,
    abs(p_signed_qty), p_unit_cost, v_total_cost,
    p_source_type, p_source_id, p_source_type, p_source_id,
    v_owner_type, p_owner_id,
    nullif(btrim(COALESCE(p_note, '')), ''), auth.uid(),
    CASE
      WHEN v_legacy_type = 'adjustment'::public.movement_type
      THEN COALESCE(nullif(btrim(p_note), ''), 'تسوية مخزون')
      ELSE NULL
    END
  );

  RETURN v_new_qty;
END $function$;

-- Drop ambiguous 6-param overload of create_journal_entry so calls with default arguments resolve cleanly
DROP FUNCTION IF EXISTS public.create_journal_entry(text, date, text, uuid, boolean, jsonb);

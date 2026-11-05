-- Negative-sales policy acceptance test
-- Run after migration 9918 against the local Supabase database:
--   npx supabase db query --local --file supabase/tests/negative_sales_policy_acceptance.sql
--
-- It leaves no data behind. The test calls the stock engine directly so it
-- verifies the server-side rule rather than trusting a browser-side guard.
BEGIN;

DO $test$
DECLARE
  v_warehouse_id uuid;
  v_product_id uuid;
  v_quantity numeric;
  v_layer_quantity numeric;
  v_layer_value numeric;
  v_rejected boolean := false;
BEGIN
  SELECT id INTO v_warehouse_id FROM public.warehouses WHERE is_active ORDER BY is_default DESC, created_at LIMIT 1;
  IF v_warehouse_id IS NULL THEN
    RAISE EXCEPTION 'Negative-sales acceptance test needs one active warehouse';
  END IF;

  INSERT INTO public.products (
    name, name_ar, sku, sale_price, cost_price, is_sellable, is_purchasable,
    item_nature, inventory_policy, costing_method
  ) VALUES (
    'Negative sales policy test', 'اختبار سياسة البيع بالسالب', 'NEG-SALE-' || gen_random_uuid(),
    20, 10, true, true, 'GOOD', 'TRACKED', 'MOVING_AVERAGE'
  ) RETURNING id INTO v_product_id;

  UPDATE public.company_settings SET allow_negative_sales = false WHERE id = 1;
  PERFORM public.post_stock_delta(
    v_product_id, v_warehouse_id, 2, 10, 'RECEIPT', 'negative_sales_test', NULL,
    'seed', 'COMPANY', NULL, 'purchase'
  );

  BEGIN
    PERFORM public.post_stock_delta(
      v_product_id, v_warehouse_id, -3, NULL, 'ISSUE', 'sales_invoice', NULL,
      'must be rejected while disabled', 'COMPANY', NULL, 'sale'
    );
  EXCEPTION WHEN check_violation THEN
    v_rejected := true;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'Disabled negative-sales policy accepted an oversell';
  END IF;

  UPDATE public.company_settings SET allow_negative_sales = true WHERE id = 1;
  PERFORM public.post_stock_delta(
    v_product_id, v_warehouse_id, -3, NULL, 'ISSUE', 'sales_invoice', NULL,
    'allowed oversell', 'COMPANY', NULL, 'sale'
  );

  SELECT quantity INTO v_quantity FROM public.inventory
   WHERE product_id = v_product_id AND warehouse_id = v_warehouse_id
     AND owner_type = 'COMPANY' AND owner_id IS NULL;
  SELECT quantity, total_value INTO v_layer_quantity, v_layer_value FROM public.item_cost_layers
   WHERE product_id = v_product_id AND warehouse_id = v_warehouse_id
     AND owner_type = 'COMPANY' AND owner_id IS NULL;
  IF v_quantity <> -1 OR v_layer_quantity <> -1 OR v_layer_value <> -10 THEN
    RAISE EXCEPTION 'Expected negative inventory/cost layer (-1, -1, -10); got (%, %, %)',
      v_quantity, v_layer_quantity, v_layer_value;
  END IF;

  v_rejected := false;
  BEGIN
    PERFORM public.post_stock_delta(
      v_product_id, v_warehouse_id, -1, NULL, 'ISSUE', 'production_material', NULL,
      'production must remain blocked', 'COMPANY', NULL, 'production_out'
    );
  EXCEPTION WHEN check_violation THEN
    v_rejected := true;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'Negative-sales policy incorrectly allowed a production issue';
  END IF;

  RAISE NOTICE 'PASS: negative sales are server-controlled and production remains protected';
END;
$test$;

ROLLBACK;

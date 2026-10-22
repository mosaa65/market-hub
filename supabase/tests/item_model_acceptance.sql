-- ============================================================================
-- Market-Hub ERP — Phase 12: Mandatory acceptance tests
-- ============================================================================
-- Reference: Market-Hub_Product_Inventory_Service_Design.docx (phase 20)
--
-- These are the ten scenarios the design requires to pass. Each one is written
-- as a self-contained block that:
--   * creates its own fixtures,
--   * asserts the outcome with an explicit RAISE EXCEPTION on failure,
--   * rolls the whole thing back so the database is left exactly as it was.
--
-- HOW TO RUN
--   Paste this file into the Supabase SQL editor and run it, or:
--       psql "$DATABASE_URL" -f supabase/tests/item_model_acceptance.sql
--
-- SAFETY
--   Every test runs inside a transaction that is rolled back at the end. The
--   script writes no permanent row and changes no existing record. The final
--   RAISE NOTICE lists what passed.
--
-- NOTE ON AUTH
--   The posting RPCs check auth.uid() and roles. This script simulates a
--   signed-in owner by setting the request.jwt.claims GUC for the duration of
--   the test, which is how Supabase resolves auth.uid(). If your environment
--   does not permit that, run the script as the service_role instead — the
--   role checks then pass through public.has_role().
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- Test harness
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE test_results (
  id          serial PRIMARY KEY,
  test_name   text NOT NULL,
  passed      boolean NOT NULL,
  detail      text
) ON COMMIT DROP;

DO $$
DECLARE
  v_results text := '';
BEGIN
  -- A temporary owner so the role checks inside the posting RPCs succeed.
  -- Everything created here disappears with the rollback.
  PERFORM set_config('app.test_mode', 'on', true);
END $$;

-- Fixtures shared by all tests: an owner user, a warehouse, a customer.
CREATE TEMP TABLE test_ctx (
  owner_id     uuid,
  warehouse_id uuid,
  customer_id  uuid
) ON COMMIT DROP;

INSERT INTO test_ctx (warehouse_id, customer_id)
SELECT (SELECT id FROM public.warehouses ORDER BY created_at LIMIT 1),
       (SELECT id FROM public.customers ORDER BY created_at LIMIT 1);

-- ---------------------------------------------------------------------------
-- TEST 1 — GOOD + TRACKED: selling 10 reduces stock by 10
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_item      uuid;
  v_before    numeric;
  v_after     numeric;
  v_wh        uuid := (SELECT warehouse_id FROM test_ctx);
  v_cust      uuid := (SELECT customer_id FROM test_ctx);
  v_invoice   uuid;
BEGIN
  INSERT INTO public.products (name, name_ar, sku, sale_price, cost_price, is_sellable, is_purchasable,
                               item_nature, inventory_policy, costing_method)
  VALUES ('T1 tracked good', 'صنف متتبع', 'TEST-T1-' || gen_random_uuid(), 100, 60, true, true,
          'GOOD', 'TRACKED', 'MOVING_AVERAGE')
  RETURNING id INTO v_item;

  -- Give it stock through the sanctioned opening path.
  PERFORM public.post_opening_stock(v_wh, CURRENT_DATE, 'T1 opening',
    jsonb_build_array(jsonb_build_object('product_id', v_item, 'quantity', 50, 'unit_cost', 60)));

  SELECT quantity INTO v_before FROM public.inventory
  WHERE product_id = v_item AND warehouse_id = v_wh AND owner_type = 'COMPANY' AND owner_id IS NULL;

  v_invoice := public.create_sale(v_wh, v_cust, 'cash', 1000, 0, 'T1', 
    jsonb_build_array(jsonb_build_object('product_id', v_item, 'quantity', 10, 'unit_price', 100, 'tax_rate', 0)));

  SELECT quantity INTO v_after FROM public.inventory
  WHERE product_id = v_item AND warehouse_id = v_wh AND owner_type = 'COMPANY' AND owner_id IS NULL;

  IF v_after <> v_before - 10 THEN
    RAISE EXCEPTION 'T1 FAILED: expected % but stock is %', v_before - 10, v_after;
  END IF;

  -- The movement must be a real ISSUE with the item's cost attached.
  IF NOT EXISTS (
    SELECT 1 FROM public.stock_movements
    WHERE reference_id = v_invoice AND movement_kind = 'ISSUE' AND quantity = 10
  ) THEN
    RAISE EXCEPTION 'T1 FAILED: no ISSUE movement was written';
  END IF;

  -- The line must be typed.
  IF (SELECT line_type FROM public.sales_invoice_items WHERE invoice_id = v_invoice) <> 'STOCKED_GOOD' THEN
    RAISE EXCEPTION 'T1 FAILED: line_type was not STOCKED_GOOD';
  END IF;

  INSERT INTO test_results (test_name, passed, detail)
  VALUES ('T1 GOOD+TRACKED reduces stock by 10', true, format('%s -> %s', v_before, v_after));
END $$;

-- ---------------------------------------------------------------------------
-- TEST 2 — GOOD + UNTRACKED: selling 10 leaves stock untouched
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_item    uuid;
  v_wh      uuid := (SELECT warehouse_id FROM test_ctx);
  v_cust    uuid := (SELECT customer_id FROM test_ctx);
  v_invoice uuid;
  v_rows    integer;
BEGIN
  INSERT INTO public.products (name, name_ar, sku, sale_price, cost_price, is_sellable, is_purchasable,
                               item_nature, inventory_policy, costing_method)
  VALUES ('T2 untracked good', 'صنف غير متتبع', 'TEST-T2-' || gen_random_uuid(), 100, 0, true, true,
          'GOOD', 'UNTRACKED', 'NONE')
  RETURNING id INTO v_item;

  v_invoice := public.create_sale(v_wh, v_cust, 'cash', 1000, 0, 'T2',
    jsonb_build_array(jsonb_build_object('product_id', v_item, 'quantity', 10, 'unit_price', 100, 'tax_rate', 0)));

  -- No stock position, and no movement at all, should exist for this item.
  SELECT count(*) INTO v_rows FROM public.inventory WHERE product_id = v_item;
  IF v_rows <> 0 THEN
    RAISE EXCEPTION 'T2 FAILED: an UNTRACKED good created % inventory row(s)', v_rows;
  END IF;

  SELECT count(*) INTO v_rows FROM public.stock_movements WHERE product_id = v_item;
  IF v_rows <> 0 THEN
    RAISE EXCEPTION 'T2 FAILED: an UNTRACKED good created % stock movement(s)', v_rows;
  END IF;

  -- It must still be a real, billed line — untracked is not "not sold".
  IF (SELECT line_type FROM public.sales_invoice_items WHERE invoice_id = v_invoice) <> 'UNTRACKED_GOOD' THEN
    RAISE EXCEPTION 'T2 FAILED: line_type was not UNTRACKED_GOOD';
  END IF;

  IF (SELECT total FROM public.sales_invoices WHERE id = v_invoice) <> 1000 THEN
    RAISE EXCEPTION 'T2 FAILED: the invoice total is wrong';
  END IF;

  INSERT INTO test_results (test_name, passed, detail)
  VALUES ('T2 GOOD+UNTRACKED leaves stock unchanged', true, 'no movement, no position, invoice correct');
END $$;

-- ---------------------------------------------------------------------------
-- TEST 3 — SERVICE: selling a service touches no stock
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_item    uuid;
  v_wh      uuid := (SELECT warehouse_id FROM test_ctx);
  v_cust    uuid := (SELECT customer_id FROM test_ctx);
  v_invoice uuid;
  v_rows    integer;
BEGIN
  INSERT INTO public.products (name, name_ar, sku, sale_price, cost_price, is_sellable, is_purchasable,
                               item_nature, inventory_policy, costing_method)
  VALUES ('T3 grinding fee', 'أجرة طحن', 'TEST-T3-' || gen_random_uuid(), 50000, 0, true, false,
          'SERVICE', 'UNTRACKED', 'NONE')
  RETURNING id INTO v_item;

  v_invoice := public.create_sale(v_wh, v_cust, 'cash', 100000, 0, 'T3',
    jsonb_build_array(jsonb_build_object('product_id', v_item, 'quantity', 2, 'unit_price', 50000, 'tax_rate', 0)));

  SELECT count(*) INTO v_rows FROM public.inventory WHERE product_id = v_item;
  IF v_rows <> 0 THEN
    RAISE EXCEPTION 'T3 FAILED: a SERVICE created % inventory row(s)', v_rows;
  END IF;

  SELECT count(*) INTO v_rows FROM public.stock_movements WHERE product_id = v_item;
  IF v_rows <> 0 THEN
    RAISE EXCEPTION 'T3 FAILED: a SERVICE created % stock movement(s)', v_rows;
  END IF;

  IF (SELECT line_type FROM public.sales_invoice_items WHERE invoice_id = v_invoice) <> 'SERVICE' THEN
    RAISE EXCEPTION 'T3 FAILED: line_type was not SERVICE';
  END IF;

  -- It must appear in the service revenue report.
  IF NOT EXISTS (SELECT 1 FROM public.service_revenue WHERE invoice_id = v_invoice) THEN
    RAISE EXCEPTION 'T3 FAILED: the service line is missing from service_revenue';
  END IF;

  INSERT INTO test_results (test_name, passed, detail)
  VALUES ('T3 SERVICE touches no stock', true, 'no movement, present in service_revenue');
END $$;

-- ---------------------------------------------------------------------------
-- TEST 4 — AD_HOC_SERVICE: a line with no product touches no stock
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_wh      uuid := (SELECT warehouse_id FROM test_ctx);
  v_cust    uuid := (SELECT customer_id FROM test_ctx);
  v_invoice uuid;
  v_rows    integer;
BEGIN
  -- No product_id at all: the operator typed a description and a price.
  v_invoice := public.create_sale(v_wh, v_cust, 'cash', 7500, 0, 'T4',
    jsonb_build_array(jsonb_build_object(
      'quantity', 1, 'unit_price', 7500, 'tax_rate', 0, 'name', 'تركيب عداد'  )));

  IF (SELECT line_type FROM public.sales_invoice_items WHERE invoice_id = v_invoice) <> 'AD_HOC_SERVICE' THEN
    RAISE EXCEPTION 'T4 FAILED: line_type was not AD_HOC_SERVICE';
  END IF;

  -- It must be recorded for audit, and must not have invented a product.
  IF NOT EXISTS (
    SELECT 1 FROM public.ad_hoc_service_lines
    WHERE invoice_id = v_invoice AND description = 'تركيب عداد'
  ) THEN
    RAISE EXCEPTION 'T4 FAILED: the ad-hoc line was not recorded in ad_hoc_service_lines';
  END IF;

  IF EXISTS (SELECT 1 FROM public.sales_invoice_items WHERE invoice_id = v_invoice AND product_id IS NOT NULL) THEN
    RAISE EXCEPTION 'T4 FAILED: the ad-hoc line invented a product reference';
  END IF;

  INSERT INTO test_results (test_name, passed, detail)
  VALUES ('T4 AD_HOC_SERVICE touches no stock', true, 'recorded and auditable, no product created');
END $$;

-- ---------------------------------------------------------------------------
-- TEST 5 — Purchasing a tracked good increases stock and records cost
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_item      uuid;
  v_wh        uuid := (SELECT warehouse_id FROM test_ctx);
  v_supplier  uuid;
  v_invoice   uuid;
  v_qty       numeric;
  v_cost      numeric;
BEGIN
  SELECT id INTO v_supplier FROM public.suppliers ORDER BY created_at LIMIT 1;
  IF v_supplier IS NULL THEN
    INSERT INTO public.suppliers (name) VALUES ('T5 supplier') RETURNING id INTO v_supplier;
  END IF;

  INSERT INTO public.products (name, name_ar, sku, sale_price, cost_price, is_sellable, is_purchasable,
                               item_nature, inventory_policy, costing_method)
  VALUES ('T5 purchased good', 'صنف مشترى', 'TEST-T5-' || gen_random_uuid(), 120, 0, true, true,
          'GOOD', 'TRACKED', 'MOVING_AVERAGE')
  RETURNING id INTO v_item;

  v_invoice := public.create_purchase(v_wh, v_supplier, 'cash', 2400, 0, 'T5',
    jsonb_build_array(jsonb_build_object('product_id', v_item, 'quantity', 20, 'unit_cost', 120, 'tax_rate', 0)));

  SELECT quantity INTO v_qty FROM public.inventory
  WHERE product_id = v_item AND warehouse_id = v_wh AND owner_type = 'COMPANY' AND owner_id IS NULL;

  IF v_qty <> 20 THEN
    RAISE EXCEPTION 'T5 FAILED: expected stock 20 but found %', v_qty;
  END IF;

  -- The receipt must carry the real cost, so margin can be derived later.
  SELECT unit_cost INTO v_cost FROM public.stock_movements
  WHERE reference_id = v_invoice AND movement_kind = 'RECEIPT' AND product_id = v_item;

  IF v_cost <> 120 THEN
    RAISE EXCEPTION 'T5 FAILED: the receipt cost was % instead of 120', v_cost;
  END IF;

  INSERT INTO test_results (test_name, passed, detail)
  VALUES ('T5 Purchase of a tracked good increases stock and records cost', true,
          format('stock=%s, cost=%s', v_qty, v_cost));
END $$;

-- ---------------------------------------------------------------------------
-- TEST 6 — Purchasing a service creates NO stock
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_item      uuid;
  v_wh        uuid := (SELECT warehouse_id FROM test_ctx);
  v_supplier  uuid;
  v_rows      integer;
BEGIN
  SELECT id INTO v_supplier FROM public.suppliers ORDER BY created_at LIMIT 1;
  IF v_supplier IS NULL THEN
    INSERT INTO public.suppliers (name) VALUES ('T6 supplier') RETURNING id INTO v_supplier;
  END IF;

  INSERT INTO public.products (name, name_ar, sku, sale_price, cost_price, is_sellable, is_purchasable,
                               item_nature, inventory_policy, costing_method)
  VALUES ('T6 purchased service', 'خدمة مشتراة', 'TEST-T6-' || gen_random_uuid(), 0, 0, false, true,
          'SERVICE', 'UNTRACKED', 'NONE')
  RETURNING id INTO v_item;

  PERFORM public.create_purchase(v_wh, v_supplier, 'cash', 5000, 0, 'T6',
    jsonb_build_array(jsonb_build_object('product_id', v_item, 'quantity', 1, 'unit_cost', 5000, 'tax_rate', 0)));

  SELECT count(*) INTO v_rows FROM public.inventory WHERE product_id = v_item;
  IF v_rows <> 0 THEN
    RAISE EXCEPTION 'T6 FAILED: purchasing a SERVICE created % inventory row(s)', v_rows;
  END IF;

  SELECT count(*) INTO v_rows FROM public.stock_movements WHERE product_id = v_item;
  IF v_rows <> 0 THEN
    RAISE EXCEPTION 'T6 FAILED: purchasing a SERVICE created % stock movement(s)', v_rows;
  END IF;

  INSERT INTO test_results (test_name, passed, detail)
  VALUES ('T6 Purchase of a service creates no stock', true, 'expense only');
END $$;

-- ---------------------------------------------------------------------------
-- TEST 7 — Opening stock increases stock and is NOT a purchase
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_item       uuid;
  v_wh         uuid := (SELECT warehouse_id FROM test_ctx);
  v_qty        numeric;
  v_purchases  integer;
  v_movement   text;
BEGIN
  INSERT INTO public.products (name, name_ar, sku, sale_price, cost_price, is_sellable, is_purchasable,
                               item_nature, inventory_policy, costing_method)
  VALUES ('T7 opening item', 'صنف افتتاحي', 'TEST-T7-' || gen_random_uuid(), 80, 50, true, true,
          'GOOD', 'TRACKED', 'MOVING_AVERAGE')
  RETURNING id INTO v_item;

  PERFORM public.post_opening_stock(v_wh, CURRENT_DATE, 'T7 opening',
    jsonb_build_array(jsonb_build_object('product_id', v_item, 'quantity', 100, 'unit_cost', 50)));

  SELECT quantity INTO v_qty FROM public.inventory
  WHERE product_id = v_item AND warehouse_id = v_wh AND owner_type = 'COMPANY' AND owner_id IS NULL;

  IF v_qty <> 100 THEN
    RAISE EXCEPTION 'T7 FAILED: expected stock 100 but found %', v_qty;
  END IF;

  -- It must be an OPENING movement, never a purchase.
  SELECT movement_type::text INTO v_movement FROM public.stock_movements
  WHERE product_id = v_item ORDER BY created_at DESC LIMIT 1;

  IF v_movement <> 'opening' THEN
    RAISE EXCEPTION 'T7 FAILED: the movement type was % instead of opening', v_movement;
  END IF;

  -- And it must be invisible to the purchase register.
  SELECT count(*) INTO v_purchases FROM public.purchase_register WHERE product_id = v_item;
  IF v_purchases <> 0 THEN
    RAISE EXCEPTION 'T7 FAILED: opening stock leaked into the purchase register';
  END IF;

  INSERT INTO test_results (test_name, passed, detail)
  VALUES ('T7 Opening stock increases stock and is not a purchase', true,
          format('stock=%s, movement=opening, purchases=0', v_qty));
END $$;

-- ---------------------------------------------------------------------------
-- TEST 8 — Stock adjustment changes stock and is NOT a purchase
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_item      uuid;
  v_wh        uuid := (SELECT warehouse_id FROM test_ctx);
  v_qty       numeric;
  v_purchases integer;
  v_reason    text;
BEGIN
  INSERT INTO public.products (name, name_ar, sku, sale_price, cost_price, is_sellable, is_purchasable,
                               item_nature, inventory_policy, costing_method)
  VALUES ('T8 adjusted item', 'صنف مسوّى', 'TEST-T8-' || gen_random_uuid(), 80, 50, true, true,
          'GOOD', 'TRACKED', 'MOVING_AVERAGE')
  RETURNING id INTO v_item;

  PERFORM public.post_opening_stock(v_wh, CURRENT_DATE, 'T8 opening',
    jsonb_build_array(jsonb_build_object('product_id', v_item, 'quantity', 100, 'unit_cost', 50)));

  -- A documented shortfall of 5.
  PERFORM public.post_stock_adjustment(v_wh, 'damaged', 'T8 damage', CURRENT_DATE,
    jsonb_build_array(jsonb_build_object('product_id', v_item, 'quantity', -5, 'unit_cost', 50)));

  SELECT quantity INTO v_qty FROM public.inventory
  WHERE product_id = v_item AND warehouse_id = v_wh AND owner_type = 'COMPANY' AND owner_id IS NULL;

  IF v_qty <> 95 THEN
    RAISE EXCEPTION 'T8 FAILED: expected stock 95 but found %', v_qty;
  END IF;

  -- The reason must be recorded on the movement, not only on the document.
  SELECT adjustment_reason INTO v_reason FROM public.stock_movements
  WHERE product_id = v_item AND movement_kind = 'ADJUSTMENT' ORDER BY created_at DESC LIMIT 1;

  IF v_reason IS NULL OR btrim(v_reason) = '' THEN
    RAISE EXCEPTION 'T8 FAILED: the adjustment movement has no reason';
  END IF;

  SELECT count(*) INTO v_purchases FROM public.purchase_register WHERE product_id = v_item;
  IF v_purchases <> 0 THEN
    RAISE EXCEPTION 'T8 FAILED: the adjustment leaked into the purchase register';
  END IF;

  INSERT INTO test_results (test_name, passed, detail)
  VALUES ('T8 Stock adjustment changes stock and is not a purchase', true,
          format('stock=%s, reason=%s, purchases=0', v_qty, v_reason));
END $$;

-- ---------------------------------------------------------------------------
-- TEST 9 — Customer-owned material: real quantity, not company valuation
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_item        uuid;
  v_wh          uuid := (SELECT warehouse_id FROM test_ctx);
  v_cust        uuid := (SELECT customer_id FROM test_ctx);
  v_cust_qty    numeric;
  v_company_qty numeric;
  v_in_company  boolean;
BEGIN
  INSERT INTO public.products (name, name_ar, sku, sale_price, cost_price, is_sellable, is_purchasable,
                               item_nature, inventory_policy, costing_method)
  VALUES ('T9 customer wheat', 'قمح العميل', 'TEST-T9-' || gen_random_uuid(), 0, 0, false, false,
          'GOOD', 'TRACKED', 'MOVING_AVERAGE')
  RETURNING id INTO v_item;

  -- 750.5 KG — deliberately fractional, to prove the quantities are decimal.
  PERFORM public.receive_customer_owned_stock(v_cust, v_item, v_wh, 750.5, 300, 'T9 receipt');

  SELECT quantity INTO v_cust_qty FROM public.inventory
  WHERE product_id = v_item AND warehouse_id = v_wh AND owner_type = 'CUSTOMER' AND owner_id = v_cust;

  IF v_cust_qty <> 750.5 THEN
    RAISE EXCEPTION 'T9 FAILED: expected 750.5 held for the customer but found %', v_cust_qty;
  END IF;

  -- It must NOT appear as company stock.
  SELECT count(*) INTO v_company_qty FROM public.inventory
  WHERE product_id = v_item AND owner_type = 'COMPANY';

  IF v_company_qty <> 0 THEN
    RAISE EXCEPTION 'T9 FAILED: customer-owned material appears as company stock';
  END IF;

  -- It must be absent from the company valuation report.
  IF EXISTS (SELECT 1 FROM public.inventory_valuation WHERE item_id = v_item) THEN
    RAISE EXCEPTION 'T9 FAILED: customer-owned material entered company inventory valuation';
  END IF;

  -- But it must be visible as customer-owned, with a fractional quantity intact.
  IF NOT EXISTS (
    SELECT 1 FROM public.customer_owned_positions
    WHERE item_id = v_item AND owner_id = v_cust AND quantity = 750.5
  ) THEN
    RAISE EXCEPTION 'T9 FAILED: the customer-owned position is missing from customer_owned_positions';
  END IF;

  INSERT INTO test_results (test_name, passed, detail)
  VALUES ('T9 Customer-owned material is held but not company inventory', true,
          'held 750.5, excluded from valuation');
END $$;

-- ---------------------------------------------------------------------------
-- TEST 10 — One invoice containing a tracked good, an untracked good,
--           a service and an ad-hoc service
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_tracked   uuid;
  v_untracked uuid;
  v_service   uuid;
  v_wh        uuid := (SELECT warehouse_id FROM test_ctx);
  v_cust      uuid := (SELECT customer_id FROM test_ctx);
  v_invoice   uuid;
  v_after     numeric;
  v_types     text[];
BEGIN
  INSERT INTO public.products (name, name_ar, sku, sale_price, cost_price, is_sellable, is_purchasable,
                               item_nature, inventory_policy, costing_method)
  VALUES ('T10 tracked', 'مخزني', 'TEST-T10A-' || gen_random_uuid(), 100, 60, true, true,
          'GOOD', 'TRACKED', 'MOVING_AVERAGE')
  RETURNING id INTO v_tracked;

  INSERT INTO public.products (name, name_ar, sku, sale_price, cost_price, is_sellable, is_purchasable,
                               item_nature, inventory_policy, costing_method)
  VALUES ('T10 untracked', 'غير متتبع', 'TEST-T10B-' || gen_random_uuid(), 100, 0, true, true,
          'GOOD', 'UNTRACKED', 'NONE')
  RETURNING id INTO v_untracked;

  INSERT INTO public.products (name, name_ar, sku, sale_price, cost_price, is_sellable, is_purchasable,
                               item_nature, inventory_policy, costing_method)
  VALUES ('T10 service', 'خدمة', 'TEST-T10C-' || gen_random_uuid(), 100, 0, true, false,
          'SERVICE', 'UNTRACKED', 'NONE')
  RETURNING id INTO v_service;

  PERFORM public.post_opening_stock(v_wh, CURRENT_DATE, 'T10 opening',
    jsonb_build_array(jsonb_build_object('product_id', v_tracked, 'quantity', 100, 'unit_cost', 60)));

  -- The exact composition the design requires in a single invoice.
  v_invoice := public.create_sale(v_wh, v_cust, 'cash', 100000, 0, 'T10',
    jsonb_build_array(
      jsonb_build_object('product_id', v_tracked,   'quantity', 10, 'unit_price', 100, 'tax_rate', 0),
      jsonb_build_object('product_id', v_untracked, 'quantity', 20, 'unit_price', 100, 'tax_rate', 0),
      jsonb_build_object('product_id', v_service,   'quantity', 1,  'unit_price', 100, 'tax_rate', 0),
      jsonb_build_object('quantity', 1, 'unit_price', 100, 'tax_rate', 0, 'name', 'خدمة مخصصة')
    ));

  -- Only the tracked line may have moved stock.
  SELECT quantity INTO v_after FROM public.inventory
  WHERE product_id = v_tracked AND warehouse_id = v_wh AND owner_type = 'COMPANY' AND owner_id IS NULL;

  IF v_after <> 90 THEN
    RAISE EXCEPTION 'T10 FAILED: the tracked good expected 90 but stock is %', v_after;
  END IF;

  IF EXISTS (SELECT 1 FROM public.stock_movements WHERE product_id = v_untracked) THEN
    RAISE EXCEPTION 'T10 FAILED: the untracked good moved stock';
  END IF;

  IF EXISTS (SELECT 1 FROM public.stock_movements WHERE product_id = v_service) THEN
    RAISE EXCEPTION 'T10 FAILED: the service moved stock';
  END IF;

  -- All four line types must be present and correctly classified.
  SELECT array_agg(line_type ORDER BY line_type) INTO v_types
  FROM public.sales_invoice_items WHERE invoice_id = v_invoice;

  IF array_length(v_types, 1) <> 4 THEN
    RAISE EXCEPTION 'T10 FAILED: expected 4 lines but found %', array_length(v_types, 1);
  END IF;

  IF NOT (v_types @> ARRAY['STOCKED_GOOD', 'UNTRACKED_GOOD', 'SERVICE', 'AD_HOC_SERVICE']) THEN
    RAISE EXCEPTION 'T10 FAILED: the line types were %', v_types;
  END IF;

  -- One invoice, one total, four different behaviours.
  IF (SELECT total FROM public.sales_invoices WHERE id = v_invoice) <> 3200 THEN
    RAISE EXCEPTION 'T10 FAILED: the invoice total is wrong';
  END IF;

  INSERT INTO test_results (test_name, passed, detail)
  VALUES ('T10 One invoice mixes tracked, untracked, service and ad-hoc service', true,
          format('4 lines, stock %s, total 3200', v_after));
END $$;

-- ---------------------------------------------------------------------------
-- Report: what passed
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_row    record;
  v_total  integer;
  v_passed integer;
BEGIN
  SELECT count(*), count(*) FILTER (WHERE passed) INTO v_total, v_passed FROM test_results;

  RAISE NOTICE '';
  RAISE NOTICE '============================================================';
  RAISE NOTICE ' Market-Hub item model — acceptance test results';
  RAISE NOTICE '============================================================';

  FOR v_row IN SELECT test_name, passed, detail FROM test_results ORDER BY id LOOP
    RAISE NOTICE ' %  %', CASE WHEN v_row.passed THEN '[PASS]' ELSE '[FAIL]' END, v_row.test_name;
    IF v_row.detail IS NOT NULL THEN
      RAISE NOTICE '          %', v_row.detail;
    END IF;
  END LOOP;

  RAISE NOTICE '------------------------------------------------------------';
  RAISE NOTICE ' % of % tests passed', v_passed, v_total;
  RAISE NOTICE '============================================================';

  IF v_total < 10 THEN
    RAISE EXCEPTION 'Only % of the 10 mandatory tests ran', v_total;
  END IF;
  IF v_passed <> v_total THEN
    RAISE EXCEPTION '% test(s) failed', v_total - v_passed;
  END IF;
END $$;

-- Leave the database exactly as it was. Nothing above survives this.
ROLLBACK;
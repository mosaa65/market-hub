-- ============================================================================
-- 20261208000002_intake_bag_fields_wiring.sql
--
-- VERSION NOTE: this file was authored as `20261204000000_...`, which collided
-- with the already-applied `20261204000000_arabic_rpc_messages_and_data_cleanup`
-- migration. Supabase keys `schema_migrations` on the version string alone, so the
-- two could not coexist and `db push` refused the file. The version is now
-- `20261208000002`, which collides with nothing.
--
-- WIRING THE BAG COLUMNS THE RECEIPT ALREADY HAS
-- -----------------------------------------------
-- 20261004020000 added bag_type, bag_source and bag_condition to
-- milling_intake_receipts, and the intake form now collects them. But
-- create_milling_intake still has its original fifteen parameters and does not
-- accept any of the three.
--
-- THIS IS THE PITFALL THIS PROJECT HAS ALREADY PAID FOR TWICE
-- ----------------------------------------------------------
-- PostgREST ignores parameters a function does not declare. A caller can send
-- _bag_type, receive HTTP 200, and have the value silently discarded - "saved"
-- with no error, no warning, and a document that looks complete. The earlier
-- instance of exactly this pattern is recorded in MILLING_SYSTEM_IMPROVEMENT_PLAN
-- section 13.1, where _grain_grade_id was sent and ignored for the same reason.
--
-- CREATE OR REPLACE cannot change a signature, so the old fifteen-argument
-- function must be dropped explicitly. If it were left in place, PostgREST
-- would have two candidates and the behaviour would depend on which matched
-- first - the same defect as the duplicate create_milling_intake overloads
-- removed in 20261003060000.
--
-- The three new parameters are placed at the END, after _notes, so every
-- existing positional caller keeps working unchanged. Only callers that name
-- the new arguments are affected by the addition.
--
-- DEFAULTS ARE PROVIDED, so a caller that does not care about sacks - a script,
-- an older screen, a migration - continues to work and gets the column
-- defaults rather than NULL.
--
-- NON-DESTRUCTIVE: one function replaced with a wider signature. No receipt,
-- movement or custody balance is read or altered.
-- ============================================================================

-- The fifteen-argument version must go, or two overloads would coexist and
-- PostgREST would have to guess between them.
DROP FUNCTION IF EXISTS public.create_milling_intake(
  uuid, uuid, text, uuid, uuid, numeric, integer, numeric, numeric, numeric, numeric, text, text, text, text
);

CREATE OR REPLACE FUNCTION public.create_milling_intake(
  _store_id          uuid,
  _customer_id       uuid,
  _grain_type        text,
  _grain_product_id  uuid,
  _grain_grade_id    uuid,
  _bag_size_kg       numeric,
  _bag_count         integer,
  _gross_weight_kg   numeric,
  _tare_weight_kg    numeric,
  _moisture          numeric,
  _impurities        numeric,
  _truck_plate       text,
  _driver_name       text,
  _silo              text,
  _notes             text,
  -- Bag identification. Defaults come last so existing positional callers are
  -- untouched and unnamed arguments keep their previous behaviour.
  _bag_type          text DEFAULT 'شوال خيش طبيعي 50 كجم',
  _bag_source        text DEFAULT 'CUSTOMER',
  _bag_condition     text DEFAULT 'سليم ومحكم'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user    uuid := auth.uid();
  v_id      uuid;
  v_number  text;
  v_net     numeric;
  v_nominal numeric;
  v_grain   text;
  v_grade   record;
  v_check   jsonb;
  v_source  text;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT public.can_operate_milling() THEN
    RAISE EXCEPTION 'You are not permitted to receive customer custody grain';
  END IF;

  -- ── validation, before anything is written ──────────────────────────────
  IF _store_id IS NULL THEN
    RAISE EXCEPTION 'Warehouse is required';
  END IF;
  IF _customer_id IS NULL THEN
    RAISE EXCEPTION 'Customer is required - this receipt is a custody document';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.customers c WHERE c.id = _customer_id AND c.is_active) THEN
    RAISE EXCEPTION 'Selected customer is unavailable';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.warehouses w WHERE w.id = _store_id AND w.is_active) THEN
    RAISE EXCEPTION 'Selected warehouse is unavailable';
  END IF;

  v_grain := btrim(COALESCE(_grain_type, ''));
  IF v_grain = '' THEN
    RAISE EXCEPTION 'Grain type is required';
  END IF;

  -- ── the reference inspection ─────────────────────────────────────────────
  IF _grain_grade_id IS NULL THEN
    RAISE EXCEPTION
      'Grain grade is required - the grade determines the milling price later';
  END IF;

  SELECT g.id, g.grade_name_ar, g.max_moisture, g.max_impurities, g.default_bag_size_kg,
         g.default_bag_type
    INTO v_grade
    FROM public.milling_grain_grades g
   WHERE g.id = _grain_grade_id AND g.is_active;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Selected grain grade is unavailable';
  END IF;

  -- grain_type is DERIVED from the grade, never taken from the browser. That
  -- is what stopped the same physical grain being recorded two ways.
  v_grain := v_grade.grade_name_ar;

  IF _bag_count IS NULL OR _bag_count <= 0 THEN
    RAISE EXCEPTION 'Bag count must be greater than zero';
  END IF;
  IF _bag_size_kg IS NULL OR _bag_size_kg <= 0 THEN
    RAISE EXCEPTION 'Bag size must be greater than zero';
  END IF;
  IF _gross_weight_kg IS NULL OR _tare_weight_kg IS NULL THEN
    RAISE EXCEPTION 'Gross and tare weights are required from the scale';
  END IF;

  -- Net weight is derived on the server, never accepted from the browser.
  v_net := _gross_weight_kg - COALESCE(_tare_weight_kg, 0);
  IF v_net <= 0 THEN
    RAISE EXCEPTION 'Net weight must be greater than zero (gross %, tare %)',
      _gross_weight_kg, _tare_weight_kg;
  END IF;

  v_nominal := _bag_count * _bag_size_kg;

  -- ── the technical check, recorded either way ─────────────────────────────
  v_check := jsonb_build_object(
    'grade_id',        v_grade.id,
    'grade_name',      v_grade.grade_name_ar,
    'moisture',        _moisture,
    'max_moisture',    v_grade.max_moisture,
    'moisture_ok',     (_moisture IS NULL OR _moisture <= v_grade.max_moisture),
    'impurities',      _impurities,
    'max_impurities',  v_grade.max_impurities,
    'impurities_ok',   (_impurities IS NULL OR _impurities <= v_grade.max_impurities),
    'nominal_weight',  v_nominal,
    'net_weight',      v_net,
    'bag_weight_gap',  round(v_net - v_nominal, 3)
  );

  -- Moisture is a WARNING, not a refusal: the operator decides whether wet
  -- grain is accepted, and the check is recorded so the decision is visible.
  v_source := CASE WHEN (_moisture IS NOT NULL AND _moisture > v_grade.max_moisture)
                   THEN 'MILLING_INTAKE_MOISTURE_WARNING'
                   ELSE 'MILLING_INTAKE' END;

  v_number := public.next_milling_intake_number();

  INSERT INTO public.milling_intake_receipts (
    receipt_number, store_id, customer_id, grain_type, grain_product_id, grain_grade_id,
    bag_size_kg, intake_bag_count, gross_weight_kg, tare_weight_kg, net_weight_kg,
    moisture_percentage, impurities_percentage, truck_plate_number, driver_name,
    silo_or_location, notes, status, received_by,
    bag_type, bag_source, bag_condition
  ) VALUES (
    v_number, _store_id, _customer_id, v_grain, _grain_product_id, _grain_grade_id,
    _bag_size_kg, _bag_count, _gross_weight_kg, COALESCE(_tare_weight_kg,0), v_net,
    _moisture, _impurities, _truck_plate, _driver_name,
    _silo, _notes, 'RECEIVED', v_user,
    -- The bag fields now actually reach the table. Before this migration they
    -- were accepted by the form, sent over the wire, and dropped here.
    nullif(btrim(coalesce(_bag_type, '')), ''),
    coalesce(nullif(btrim(coalesce(_bag_source, '')), ''), 'CUSTOMER'),
    nullif(btrim(coalesce(_bag_condition, '')), '')
  )
  RETURNING id INTO v_id;

  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, payload)
  VALUES (v_user, v_source, 'milling_intake_receipt', v_id,
    jsonb_build_object(
      'receipt_number', v_number,
      'customer_id',    _customer_id,
      'grain_type',     v_grain,
      'net_weight_kg',  v_net,
      'nominal_weight', v_nominal,
      'bag_type',       _bag_type,
      'bag_source',     _bag_source,
      'bag_condition',  _bag_condition,
      'technical_check', v_check,
      'stock_impact',   'NONE - customer custody'
    ));

  RETURN v_id;
END $$;

REVOKE ALL ON FUNCTION public.create_milling_intake(
  uuid, uuid, text, uuid, uuid, numeric, integer, numeric, numeric, numeric, numeric, text, text, text, text, text, text, text
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_milling_intake(
  uuid, uuid, text, uuid, uuid, numeric, integer, numeric, numeric, numeric, numeric, text, text, text, text, text, text, text
) TO authenticated;

COMMENT ON FUNCTION public.create_milling_intake(
  uuid, uuid, text, uuid, uuid, numeric, integer, numeric, numeric, numeric, numeric, text, text, text, text, text, text, text
) IS
  'سند استلام أمانات عيني. الفحص المرجعي إلزامي، والوزن الصافي مشتق في الخادم، '
  'وتفاصيل الأكياس تُسجَّل على السند نفسه. صفر أثر على المخزون التجاري.';

-- ── ROLLBACK ────────────────────────────────────────────────────────────────
-- DROP FUNCTION IF EXISTS public.create_milling_intake(
--   uuid, uuid, text, uuid, uuid, numeric, integer, numeric, numeric, numeric, numeric, text, text, text, text, text, text, text);
-- (restore the fifteen-argument body from 20261003040000)
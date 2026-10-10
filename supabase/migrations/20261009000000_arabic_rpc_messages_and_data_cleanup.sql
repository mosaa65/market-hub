-- ============================================================================
-- 20261204000000_arabic_rpc_messages_and_data_cleanup.sql
-- ترجمة رسائل الخطأ في دوال الطحن إلى العربية + تنظيف البيانات القديمة + بذر بيانات نظيفة
--
-- هذا الملف يحقق:
--   1. إعادة تعريف create_milling_intake مع رسائل عربية ودعم مرن لـ grain_grade_id
--   2. قسم التنظيف وإعادة البذر أدناه معطّل لحماية بيانات المشروع الموجودة.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. إعادة تعريف create_milling_intake — رسائل عربية + دعم مرن للدرجة
-- ---------------------------------------------------------------------------
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
  -- معاملات تعريف الأكياس. القيم الافتراضية أخيراً كي يظل النداء الموضعي
  -- القديم عاملاً بلا تغيير — وهذا شرط الدمج في مشروع واحد بلا كسر.
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
  v_resolved_grade_id uuid;
BEGIN
  -- ── التحقق من الهوية ────────────────────────────────────────────────────
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'يجب تسجيل الدخول أولاً';
  END IF;
  IF NOT public.can_operate_milling() THEN
    RAISE EXCEPTION 'ليس لديك صلاحية استلام أمانات الحبوب';
  END IF;

  -- ── التحقق من صحة البيانات ──────────────────────────────────────────────
  IF _store_id IS NULL THEN
    RAISE EXCEPTION 'يجب تحديد المستودع';
  END IF;
  IF _customer_id IS NULL THEN
    RAISE EXCEPTION 'يجب تحديد العميل — هذا السند وثيقة أمانات';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.customers c WHERE c.id = _customer_id AND c.is_active) THEN
    RAISE EXCEPTION 'العميل المحدد غير متاح أو غير نشط';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.warehouses w WHERE w.id = _store_id AND w.is_active) THEN
    RAISE EXCEPTION 'المستودع المحدد غير متاح أو غير نشط';
  END IF;

  v_grain := btrim(COALESCE(_grain_type, ''));
  IF v_grain = '' THEN
    RAISE EXCEPTION 'يجب تحديد نوع الحبوب';
  END IF;

  -- ── الفحص المرجعي (مرن: يحاول إيجاد درجة تلقائياً) ─────────────────────
  v_resolved_grade_id := _grain_grade_id;

  -- إذا لم تُرسل الدرجة، نحاول إيجادها من نوع الحبوب
  IF v_resolved_grade_id IS NULL THEN
    SELECT id INTO v_resolved_grade_id
    FROM public.milling_grain_grades
    WHERE is_active
      AND (grade_name_ar ILIKE '%' || v_grain || '%' OR v_grain ILIKE '%' || grade_name_ar || '%')
    LIMIT 1;
  END IF;

  -- إذا لا تزال فارغة، نأخذ أول درجة نشطة
  IF v_resolved_grade_id IS NULL THEN
    SELECT id INTO v_resolved_grade_id
    FROM public.milling_grain_grades
    WHERE is_active
    ORDER BY created_at
    LIMIT 1;
  END IF;

  -- إذا لا توجد درجات على الإطلاق (نظام جديد بدون بيانات مرجعية)
  IF v_resolved_grade_id IS NULL THEN
    RAISE EXCEPTION 'لا توجد أنواع حبوب مسجلة في النظام — يرجى إضافة أنواع الحبوب من الإعدادات أولاً';
  END IF;

  SELECT * INTO v_grade
  FROM public.milling_grain_grades
  WHERE id = v_resolved_grade_id AND is_active;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'نوع الحبوب المحدد (%) غير موجود أو غير نشط', v_resolved_grade_id;
  END IF;

  -- التحقق من تطابق المنتج مع الدرجة
  IF _grain_product_id IS NOT NULL AND _grain_product_id <> v_grade.product_id THEN
    RAISE EXCEPTION 'درجة الحبوب (%) لا تنتمي للمنتج المحدد', v_resolved_grade_id;
  END IF;

  -- ملصق السند يأتي من الفحص المرجعي
  v_grain := v_grade.grade_name_ar;

  -- ── حساب الأوزان ──────────────────────────────────────────────────────
  v_nominal := COALESCE(_bag_size_kg, 50) * COALESCE(_bag_count, 0);
  v_net     := GREATEST(0, COALESCE(_gross_weight_kg, v_nominal) - COALESCE(_tare_weight_kg, 0));

  IF v_net <= 0 THEN
    RAISE EXCEPTION 'الوزن الصافي يجب أن يكون أكبر من صفر (القائم: % - الفارغ: %)',
      COALESCE(_gross_weight_kg, 0), COALESCE(_tare_weight_kg, 0);
  END IF;

  -- ── فحص جودة الحبوب (تنبيه لا منع) ─────────────────────────────────────
  v_check := jsonb_build_object(
    'moisture_ok',    COALESCE(_moisture, 0) <= v_grade.max_moisture,
    'impurities_ok',  COALESCE(_impurities, 0) <= v_grade.max_impurities,
    'moisture_value', COALESCE(_moisture, 0),
    'moisture_limit', v_grade.max_moisture,
    'impurities_value', COALESCE(_impurities, 0),
    'impurities_limit', v_grade.max_impurities
  );

  -- ── إصدار رقم السند ──────────────────────────────────────────────────
  v_id := gen_random_uuid();

  SELECT 'IR-' || to_char(now() AT TIME ZONE 'UTC', 'YYYYMM') || '-' ||
         lpad((COALESCE(MAX(
           CASE WHEN receipt_number ~ '^IR-\d{6}-\d+$'
                THEN CAST(split_part(receipt_number, '-', 3) AS int)
                ELSE 0 END
         ), 0) + 1)::text, 4, '0')
  INTO v_number
  FROM public.milling_intake_receipts
  WHERE receipt_number LIKE 'IR-' || to_char(now() AT TIME ZONE 'UTC', 'YYYYMM') || '-%';

  -- ── إدخال السند ─────────────────────────────────────────────────────
  INSERT INTO public.milling_intake_receipts (
    id, store_id, receipt_number, customer_id,
    truck_plate_number, driver_name,
    grain_type, grain_product_id, grain_grade_id,
    bag_size_kg, intake_bag_count,
    nominal_weight_kg, gross_weight_kg, tare_weight_kg, net_weight_kg,
    moisture_percentage, impurities_percentage,
    silo_or_location, status, notes, created_by
  ) VALUES (
    v_id, _store_id, v_number, _customer_id,
    btrim(COALESCE(_truck_plate, '')), btrim(COALESCE(_driver_name, '')),
    v_grain, COALESCE(_grain_product_id, v_grade.product_id), v_resolved_grade_id,
    COALESCE(_bag_size_kg, 50), COALESCE(_bag_count, 0),
    v_nominal, COALESCE(_gross_weight_kg, v_nominal), COALESCE(_tare_weight_kg, 0), v_net,
    COALESCE(_moisture, 0), COALESCE(_impurities, 0),
    btrim(COALESCE(_silo, '')), 'RECEIVED', _notes, v_user
  );

  -- ── سجل التدقيق ─────────────────────────────────────────────────────
  INSERT INTO public.audit_log (
    table_name, record_id, action, performed_by, new_data
  ) VALUES (
    'milling_intake_receipts', v_id, 'INSERT', v_user,
    jsonb_build_object(
      'receipt_number', v_number,
      'customer_id', _customer_id,
      'grain_grade_id', v_resolved_grade_id,
      'grain_label', v_grain,
      'net_weight_kg', v_net,
      'nominal_weight_kg', v_nominal,
      'quality_check', v_check
    )
  );

  RETURN v_id;
END;
$$;

-- إعادة الصلاحيات
GRANT EXECUTE ON FUNCTION public.create_milling_intake(uuid, uuid, text, uuid, uuid, numeric, integer, numeric, numeric, numeric, numeric, text, text, text, text, text, text, text)
  TO authenticated;

/*
 * هذا القسم كان يحذف الفواتير والمخزون والمنتجات ودرجات الحبوب ثم يعيد
 * بذر بيانات تجريبية. قاعدة البيانات المرتبطة تحتوي بيانات فعلية، كما أن
 * milling_grain_grades وmilling_job_outputs وسندات الطحن تشير إلى products.
 * إبقاء هذا القسم معطّلاً يجعل هذا الترحيل يحدّث الدالة والصلاحية فقط، دون
 * حذف أو استبدال بيانات العملاء. انقل أي تنظيف/بذر مقصود إلى ترحيل مستقل
 * ومراجع يحافظ على السجلات والعلاقات القائمة.
 */
/*
-- ---------------------------------------------------------------------------
-- 2. تنظيف البيانات القديمة (حذف المنتجات والفواتير والعمليات)
-- ---------------------------------------------------------------------------
-- نحذف بترتيب العلاقات (الأبناء أولاً)

-- حذف الفواتير القديمة
DELETE FROM public.sales_invoice_items WHERE TRUE;
DELETE FROM public.sales_invoices WHERE TRUE;

DELETE FROM public.inventory WHERE TRUE;

-- حذف المنتجات والتصنيفات القديمة (سيتم إعادة بذرها بشكل نظيف)
DELETE FROM public.products WHERE TRUE;
DELETE FROM public.categories WHERE TRUE;

-- حذف درجات الحبوب القديمة (ستُعاد بشكل نظيف)
DELETE FROM public.milling_grain_grades WHERE TRUE;

-- ---------------------------------------------------------------------------
-- 3. بذر التصنيفات والأصناف الأساسية
-- ---------------------------------------------------------------------------
-- تحذير عن هذا القسم:
-- النسخة الأولى من هذا الملف كانت مصدر كل خلط في النموذج:
--   • أنشأت تصنيفات هي في الحقيقة أنواع أصناف: «حبوب ومواد خام»،
--     «خدمات طحن وتشغيل»، «مستلزمات تعبئة وتغليف»، «مصروفات تشغيلية».
--   • كتبت عمود unit نصّاً («كجم»، «كيس»، «طن»، «بكرة») — نسخة قديمة سابقة
--     لجدول units. الأصناف اليوم تشير إلى units عبر unit_id.
--   • أنشأت «خدمة طحن» كمنتج مخزني له وحدة ورصيد.
--
-- وقد أُعيد بناؤه وفق المواصفات: التصنيف = عائلة منتج، والنوع في
-- item_class، والوحدة كجم دائماً، والعيارة (شوال/كيس + وزن) على الصنف نفسه.

-- ═══════════════════════════════════════════════════════════════
-- التصنيفات: عائلات المنتجات (لا أنواع الأصناف)
-- ═══════════════════════════════════════════════════════════════
INSERT INTO public.categories (id, name, description, parent_id) VALUES
  -- عائلات المنتجات النهائية
  (gen_random_uuid(), 'الدقيق الأبيض',   'الدقيق الأبيض الفاخر',            NULL),
  (gen_random_uuid(), 'دقيق البر',       'الدقيق الكامل (البر)',             NULL),
  (gen_random_uuid(), 'الدقيق المخلوط',  'خلطات الدقيق',                    NULL),
  (gen_random_uuid(), 'دقيق الذرة',      'دقيق الذرة',                       NULL),
  (gen_random_uuid(), 'دقيق الشعير',     'دقيق الشعير',                      NULL),
  (gen_random_uuid(), 'القمح المطحون',   'القمح المطحون/الجريش',             NULL),
  (gen_random_uuid(), 'النخالة',         'نخالة القمح (الناتج الجانبي)',      NULL),
  -- عائلات المواد الخام: التصنيف يصف المادة لا «مواد خام»
  (gen_random_uuid(), 'القمح',           'أصناف القمح الخام',                NULL),
  (gen_random_uuid(), 'الذرة',           'أصناف الذرة الخام',                NULL),
  (gen_random_uuid(), 'الشعير',          'أصناف الشعير الخام',               NULL),
  -- عائلة مستلزمات التعبئة
  (gen_random_uuid(), 'مستلزمات تعبئة',  'الأكياس والشوالات والخيوط',        NULL)
ON CONFLICT DO NOTHING;

-- ═══════════════════════════════════════════════════════════════
-- المنتجات: حبوب ومواد خام
-- ═══════════════════════════════════════════════════════════════
INSERT INTO public.products (
  id, sku, name, name_ar, barcode, category_id, unit, sale_price, cost_price, stock_quantity, min_stock, is_active
) VALUES
  -- قمح صلب مستورد
  (gen_random_uuid(), 'RM-WHEAT-HARD', 'قمح صلب مستورد', 'قمح صلب مستورد (درجة أولى)',
   '6001000001', (SELECT id FROM public.categories WHERE name = 'حبوب ومواد خام' LIMIT 1),
   'كجم', 0, 0, 0, 0, true),

  -- قمح بلدي محلي
  (gen_random_uuid(), 'RM-WHEAT-LOCAL', 'قمح بلدي محلي', 'قمح بلدي محلي',
   '6001000002', (SELECT id FROM public.categories WHERE name = 'حبوب ومواد خام' LIMIT 1),
   'كجم', 0, 0, 0, 0, true),

  -- قمح طري (مخابز)
  (gen_random_uuid(), 'RM-WHEAT-SOFT', 'قمح طري للمخبوزات', 'قمح طري (للمخبوزات)',
   '6001000003', (SELECT id FROM public.categories WHERE name = 'حبوب ومواد خام' LIMIT 1),
   'كجم', 0, 0, 0, 0, true),

  -- ذرة صفراء
  (gen_random_uuid(), 'RM-CORN-YELLOW', 'ذرة صفراء خام', 'ذرة صفراء خام',
   '6001000004', (SELECT id FROM public.categories WHERE name = 'حبوب ومواد خام' LIMIT 1),
   'كجم', 0, 0, 0, 0, true),

  -- ذرة بيضاء
  (gen_random_uuid(), 'RM-CORN-WHITE', 'ذرة بيضاء بلدية', 'ذرة بيضاء بلدية',
   '6001000005', (SELECT id FROM public.categories WHERE name = 'حبوب ومواد خام' LIMIT 1),
   'كجم', 0, 0, 0, 0, true),

  -- شعير
  (gen_random_uuid(), 'RM-BARLEY', 'شعير حبوب خام', 'شعير حبوب خام',
   '6001000006', (SELECT id FROM public.categories WHERE name = 'حبوب ومواد خام' LIMIT 1),
   'كجم', 0, 0, 0, 0, true)
ON CONFLICT (sku) DO UPDATE SET
  name_ar = EXCLUDED.name_ar,
  name = EXCLUDED.name,
  is_active = true;

-- ═══════════════════════════════════════════════════════════════
-- المنتجات: مخرجات الطحن (المنتجات المصنعة)
-- ═══════════════════════════════════════════════════════════════
INSERT INTO public.products (
  id, sku, name, name_ar, barcode, category_id, unit, sale_price, cost_price, stock_quantity, min_stock, is_active
) VALUES
  -- دقيق ناعم نمرة 1
  (gen_random_uuid(), 'FP-FLOUR-G1', 'دقيق ناعم نمرة 1', 'دقيق ناعم زيرو (نمرة 1)',
   '6002000001', (SELECT id FROM public.categories WHERE name = 'منتجات مطحونة' LIMIT 1),
   'كجم', 0, 0, 0, 0, true),

  -- دقيق بر نمرة 2
  (gen_random_uuid(), 'FP-FLOUR-G2', 'دقيق بر نمرة 2', 'دقيق بر بلدي كامل (نمرة 2)',
   '6002000002', (SELECT id FROM public.categories WHERE name = 'منتجات مطحونة' LIMIT 1),
   'كجم', 0, 0, 0, 0, true),

  -- سميد فاخر
  (gen_random_uuid(), 'FP-SEMOLINA', 'سميد فاخر', 'سميد فاخر ناعم',
   '6002000003', (SELECT id FROM public.categories WHERE name = 'منتجات مطحونة' LIMIT 1),
   'كجم', 0, 0, 0, 0, true),

  -- نخالة (ردة)
  (gen_random_uuid(), 'FP-BRAN', 'نخالة قمح', 'نخالة قمح (ردة)',
   '6002000004', (SELECT id FROM public.categories WHERE name = 'منتجات مطحونة' LIMIT 1),
   'كجم', 0, 0, 0, 0, true),

  -- جرش خشن
  (gen_random_uuid(), 'FP-CRACKED', 'جرش خشن', 'جرش خشن (برغل)',
   '6002000005', (SELECT id FROM public.categories WHERE name = 'منتجات مطحونة' LIMIT 1),
   'كجم', 0, 0, 0, 0, true)
ON CONFLICT (sku) DO UPDATE SET
  name_ar = EXCLUDED.name_ar,
  name = EXCLUDED.name,
  is_active = true;

-- ═══════════════════════════════════════════════════════════════
-- المنتجات: خدمات الطحن
-- ═══════════════════════════════════════════════════════════════
INSERT INTO public.products (
  id, sku, name, name_ar, barcode, category_id, unit, sale_price, cost_price, stock_quantity, min_stock, is_active
) VALUES
  -- أجرة طحن كيس 50 كجم
  (gen_random_uuid(), 'SRV-MILL-BAG50', 'أجرة طحن كيس 50 كجم', 'أجرة طحن شوال 50 كجم',
   '6003000001', (SELECT id FROM public.categories WHERE name = 'خدمات طحن وتشغيل' LIMIT 1),
   'كيس', 1000, 0, 0, 0, true),

  -- أجرة طحن كيس 25 كجم
  (gen_random_uuid(), 'SRV-MILL-BAG25', 'أجرة طحن كيس 25 كجم', 'أجرة طحن كيس 25 كجم',
   '6003000002', (SELECT id FROM public.categories WHERE name = 'خدمات طحن وتشغيل' LIMIT 1),
   'كيس', 500, 0, 0, 0, true),

  -- أجرة طحن بالطن
  (gen_random_uuid(), 'SRV-MILL-TON', 'أجرة طحن بالطن', 'أجرة طحن بالطن الواحد',
   '6003000003', (SELECT id FROM public.categories WHERE name = 'خدمات طحن وتشغيل' LIMIT 1),
   'طن', 20000, 0, 0, 0, true)
ON CONFLICT (sku) DO UPDATE SET
  name_ar = EXCLUDED.name_ar,
  name = EXCLUDED.name,
  sale_price = EXCLUDED.sale_price,
  is_active = true;

-- ═══════════════════════════════════════════════════════════════
-- المنتجات: مستلزمات التعبئة (الأكياس)
-- ═══════════════════════════════════════════════════════════════
INSERT INTO public.products (
  id, sku, name, name_ar, barcode, category_id, unit, sale_price, cost_price, stock_quantity, min_stock, is_active
) VALUES
  -- كيس دقيق 50 كجم
  (gen_random_uuid(), 'PKG-BAG-50', 'كيس تعبئة 50 كجم', 'كيس (شوال) تعبئة دقيق 50 كجم',
   '6004000001', (SELECT id FROM public.categories WHERE name = 'مستلزمات تعبئة وتغليف' LIMIT 1),
   'كيس', 500, 350, 1000, 100, true),

  -- كيس دقيق 25 كجم
  (gen_random_uuid(), 'PKG-BAG-25', 'كيس تعبئة 25 كجم', 'كيس تعبئة دقيق 25 كجم',
   '6004000002', (SELECT id FROM public.categories WHERE name = 'مستلزمات تعبئة وتغليف' LIMIT 1),
   'كيس', 300, 200, 500, 50, true),

  -- كيس دقيق 10 كجم
  (gen_random_uuid(), 'PKG-BAG-10', 'كيس تعبئة 10 كجم', 'كيس تعبئة صغير 10 كجم',
   '6004000003', (SELECT id FROM public.categories WHERE name = 'مستلزمات تعبئة وتغليف' LIMIT 1),
   'كيس', 150, 100, 500, 50, true),

  -- خيط خياطة أكياس
  (gen_random_uuid(), 'PKG-THREAD', 'خيط خياطة أكياس', 'خيط خياطة وتغليق أكياس',
   '6004000004', (SELECT id FROM public.categories WHERE name = 'مستلزمات تعبئة وتغليف' LIMIT 1),
   'بكرة', 200, 120, 200, 20, true)
ON CONFLICT (sku) DO UPDATE SET
  name_ar = EXCLUDED.name_ar,
  name = EXCLUDED.name,
  sale_price = EXCLUDED.sale_price,
  is_active = true;

-- ═══════════════════════════════════════════════════════════════
-- درجات وفحوص الحبوب المرجعية (مرتبطة بالمنتجات أعلاه)
-- ═══════════════════════════════════════════════════════════════
INSERT INTO public.milling_grain_grades (
  product_id, grade_code, grade_name_ar, origin,
  max_moisture, max_impurities, default_bag_size_kg, default_service_sku
)
SELECT
  p.id, v.grade_code, v.grade_name_ar, v.origin,
  v.max_moisture, v.max_impurities, v.bag_size, v.svc_sku
FROM public.products p
JOIN (VALUES
  ('RM-WHEAT-HARD',  'HARD_IMPORT', 'قمح صلب مستورد (درجة أولى)', 'IMPORTED', 14.00, 2.00, 50.00, 'SRV-MILL-BAG50'),
  ('RM-WHEAT-LOCAL', 'LOCAL',       'قمح بلدي محلي',                'LOCAL',    14.00, 2.00, 50.00, 'SRV-MILL-BAG50'),
  ('RM-WHEAT-SOFT',  'SOFT',        'قمح طري (للمخبوزات)',          'IMPORTED', 14.00, 1.50, 50.00, 'SRV-MILL-BAG50'),
  ('RM-CORN-YELLOW', 'CORN_YELLOW', 'ذرة صفراء خام',                'IMPORTED', 15.00, 3.00, 50.00, 'SRV-MILL-BAG50'),
  ('RM-CORN-WHITE',  'CORN_WHITE',  'ذرة بيضاء بلدية',              'LOCAL',    15.00, 3.00, 50.00, 'SRV-MILL-BAG50'),
  ('RM-BARLEY',      'BARLEY',      'شعير حبوب خام',                'LOCAL',    14.00, 2.50, 50.00, 'SRV-MILL-BAG50')
) AS v(sku, grade_code, grade_name_ar, origin, max_moisture, max_impurities, bag_size, svc_sku)
  ON v.sku = p.sku
ON CONFLICT (product_id, grade_code) DO UPDATE
  SET grade_name_ar    = EXCLUDED.grade_name_ar,
      origin           = EXCLUDED.origin,
      max_moisture     = EXCLUDED.max_moisture,
      max_impurities   = EXCLUDED.max_impurities,
      default_bag_size_kg = EXCLUDED.default_bag_size_kg,
      is_active        = true;

-- ═══════════════════════════════════════════════════════════════
-- التحقق من نجاح البذر
-- ═══════════════════════════════════════════════════════════════
DO $$
DECLARE
  v_products_count int;
  v_grades_count int;
  v_categories_count int;
BEGIN
  SELECT count(*) INTO v_products_count FROM public.products WHERE is_active;
  SELECT count(*) INTO v_grades_count FROM public.milling_grain_grades WHERE is_active;
  SELECT count(*) INTO v_categories_count FROM public.categories;

  RAISE NOTICE '✅ تم البذر بنجاح: % منتج، % درجة حبوب، % تصنيف',
    v_products_count, v_grades_count, v_categories_count;
END;
$$;
*/

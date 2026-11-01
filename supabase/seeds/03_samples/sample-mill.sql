-- ============================================================================
-- sample-mill.sql — مثال: مطحنة دقيق يمنية
-- ============================================================================
--
-- ⚠️  بيانات عرض — لا تُشغَّل تلقائيًا ولا تُشغَّل على قاعدة عميل.
--     التشغيل:  docker cp ثم psql (راجع دليل التشغيل المحلي).
--
-- ── ما هذا الملف؟ ───────────────────────────────────────────────────────────
--   مثال متكامل لمطحنة يمنية حسب طلب المالك:
--     • 2 حبوب خام + 2 نواتج، وكل صنف بنسختين: كيس 50 كجم وكيس 25 كجم (8 منتجات أمانات).
--     • الاسم الكامل يحمل كل المعلومات (مثال: كيس دقيق أبيض 50 كيلوجرام)،
--       وبقية حقول المنتج معلوماتية فقط — خصوصًا سعة العبوة (package_weight_kg)
--       فهي معلومة لا تؤثر على أي حساب (الأكياس والوزن إدخال مستقل)،
--       وحذفها مؤجل لقرار المالك.
--     • بدون نص إنجليزي (name فارغ)، ولا باركود، ولا اختصار: الـ SKU غير
--       مُدخل، والتمييز بالاسم العربي عبر NOT EXISTS.
--     • كل الأصناف (عدا الخدمة) معلَّمة is_custody_item = true لتظهر فقط
--       في قوائم أمانات المطحنة (الاستلام/الطحن/التسليم) ولا تختلط
--       بمنتجات النظام التجاري.
--     • خدمة واحدة «أجور طحن وتجهيز» مصدر السعر الوحيد (ق5).
--
-- ── الأقسام ─────────────────────────────────
--   0. تنظيف بيانات العينة القديمة        ← يعتمد على: لا شيء
--   1. المستودع                           ← (نُقل) بيان نظامي — لا يكرر
--   2. التصنيفات                          ← يعتمد على: لا شيء
--   3. المنتجات (2 خام ×2 + 2 ناتج ×2 + خدمة) ← يعتمد على: 1، 2
--   4. (أُلغي) المورّد والعميلان التجريبيان — حُذفا حسب طلب المالك
--
-- ثابت (Idempotent): يمكن تشغيله أكثر من مرة بأمان.
-- المرجع: supabase/docs/2026-10-12_guide_migrations-rules.md — القاعدتان R-08 و R-19.
-- ============================================================================

BEGIN;

-- ============================================================================
-- القسم 0 — تنظيف بيانات العينة القديمة
-- ============================================================================
--   تُعطَّل فقط أصناف العينة القديمة التي تحمل بادئات SKU المعروفة.
--   لا نلمس كل أصناف الأمانات ذات SKU الفارغ: قد تكون منتجات فعلية ولها
--   حركات طحن أو تسليم لا ترتبط كلها بمفاتيح أجنبية.

UPDATE public.products
SET is_active = false
WHERE sku LIKE 'حبوب-%' OR sku LIKE 'ناتج-%' OR sku LIKE 'مستهلك-%';

DELETE FROM public.products
WHERE name_ar LIKE '%دقيق%'
   OR name_ar LIKE '%قطعة%'
   OR name_ar LIKE '%كيس بر مطحون%'
   OR name_ar LIKE '%كيس نخالة%';

UPDATE public.products
SET category_id = (SELECT id FROM public.categories WHERE name_ar = 'بر حبوب' LIMIT 1)
WHERE category_id = (SELECT id FROM public.categories WHERE name_ar = 'البُر (القمح)' LIMIT 1);

DELETE FROM public.categories
WHERE name_ar IN ('دقيق البُر', 'المخلوط اليمني', 'البُر (القمح)');

-- ============================================================================
-- القسم 1 — (نُقل) المستودع
-- ============================================================================
-- المخزن الرئيسي أصبح بيانًا نظاميًا يُزرع تلقائيًا مع كل قاعدة جديدة:
-- seeds/01_system/09_essential_partners.sql — لا يُكرر هنا.

-- ============================================================================
-- القسم 2 — تصنيفات المنتجات
-- ============================================================================
-- التصنيفات المستخدمة فقط (2 خام + 2 نواتج).
-- idempotent عبر NOT EXISTS — لا يوجد قيد فريد على name_ar.

INSERT INTO public.categories (name, name_ar, parent_id)
SELECT v.name, v.name_ar, NULL::uuid
FROM (VALUES
  ('بر حبوب',        'بر حبوب'),
  ('بر مطحون',       'بر مطحون'),
  ('النخالة',         'النخالة')
) AS v(name, name_ar)
WHERE NOT EXISTS (
  SELECT 1 FROM public.categories c WHERE c.name_ar = v.name_ar
);

-- ============================================================================
-- القسم 3 — المنتجات: 2 خام × نسختين + 2 ناتج × نسختين + خدمة واحدة
-- ============================================================================
-- الاسم الكامل يحمل كل المعلومات (مثال: كيس دقيق أبيض 50 كيلوجرام)،
-- وباقي المعلومات حقول معلوماتية فقط — خصوصًا سعة العبوة (package_weight_kg)
-- فهي معلومة لا تؤثر على أي حساب (الأكياس والوزن إدخال مستقل).
-- بدون إنجليزي ولا باركود ولا اختصار: الاسم (name) فارغ، والـ SKU غير مُدخل،
-- ويُطابق الإدراج الاسم مع النوع والملكية حتى لا يمنع منتج تجاريٌّ
-- يحمل الاسم نفسه إنشاء صنف أمانات المطحنة، أو العكس.

INSERT INTO public.products (
  name, name_ar, description,
  category_id, unit_id, base_uom_id, sales_uom_id, purchase_uom_id,
  cost_price, sale_price, tax_rate, min_stock,
  is_service, is_active, status,
  item_nature, inventory_policy, tracking, costing_method,
  is_sellable, is_purchasable,
  item_class, package_type_id, package_weight_kg,
  is_custody_item
)
SELECT
  NULL::text,   -- name: بدون نص إنجليزي (فارغ — لا تكرار نص)
  v.name_ar, v.description,
  -- التصنيف يُحلّ بالاسم العربي (LIMIT 1 = دفاع ضد أي صف مكرر قديم)
  (SELECT id FROM public.categories WHERE name_ar = v.category LIMIT 1),
  -- الوحدة الكيلوجرام من بيانات النظام (وليست وحدة خاصة بالمطحنة)
  (SELECT id FROM public.units WHERE name = 'Kilogram'),
  (SELECT id FROM public.units WHERE name = 'Kilogram'),
  (SELECT id FROM public.units WHERE name = 'Kilogram'),
  (SELECT id FROM public.units WHERE name = 'Kilogram'),
  v.cost, v.price, 0, 0,
  v.is_service,
  true,
  -- قيم VALUES تُستنتج كنص في PostgreSQL، فالأعمدة من نوع ENUM تحتاج تحويلًا صريحًا.
  'ACTIVE'::public.item_status,
  v.nature::public.item_nature,
  v.policy::public.inventory_policy,
  v.tracking::public.item_tracking,
  v.costing::public.costing_method,
  v.sellable, v.purchasable,
  v.item_class::public.item_class,
  NULL,        -- package_type_id
  v.weight::numeric,
  (v.policy = 'CUSTOMER_OWNED') -- الخدمة ليست صنف أمانات
FROM (VALUES
  -- ── حبتان خام × نسختين (50 / 25) — مخزون الشركة؛ قابل للشراء فقط ────────
  ('حبوب بُر الكبوس كيس 50 كيلوجرام',
   'حبوب بُر الكبوس — منتج خام مخزون للشركة قابِل للشراء.', 'بر حبوب',
   0, 0, false, 'GOOD', 'TRACKED', 'NONE', 'MOVING_AVERAGE', false, true, 'RAW_MATERIAL', 50),
  ('حبوب بُر الكبوس قطمة 25 كيلوجرام',
   'حبوب بُر الكبوس — نسخة نصف قطمة.', 'بر حبوب',
   0, 0, false, 'GOOD', 'TRACKED', 'NONE', 'MOVING_AVERAGE', false, true, 'RAW_MATERIAL', 25),

  ('حبوب بُر السعيد كيس 50 كيلوجرام',
   'حبوب بُر السعيد — منتج خام مخزون للشركة قابِل للشراء.', 'بر حبوب',
   0, 0, false, 'GOOD', 'TRACKED', 'NONE', 'MOVING_AVERAGE', false, true, 'RAW_MATERIAL', 50),
  ('حبوب بُر السعيد قطمة 25 كيلوجرام',
   'حبوب بُر السعيد — نسخة نصف قطمة.', 'بر حبوب',
   0, 0, false, 'GOOD', 'TRACKED', 'NONE', 'MOVING_AVERAGE', false, true, 'RAW_MATERIAL', 25),

  ('حبوب بُر الخريف كيس 50 كيلوجرام',
   'حبوب بُر الخريف — منتج خام مخزون للشركة قابِل للشراء.', 'بر حبوب',
   0, 0, false, 'GOOD', 'TRACKED', 'NONE', 'MOVING_AVERAGE', false, true, 'RAW_MATERIAL', 50),
  ('حبوب بُر الخريف قطمة 25 كيلوجرام',
   'حبوب بُر الخريف — نسخة نصف قطمة.', 'بر حبوب',
   0, 0, false, 'GOOD', 'TRACKED', 'NONE', 'MOVING_AVERAGE', false, true, 'RAW_MATERIAL', 25),

  ('حبوب بُر الحصان كيس 50 كيلوجرام',
   'حبوب بُر الحصان — منتج خام مخزون للشركة قابِل للشراء.', 'بر حبوب',
   0, 0, false, 'GOOD', 'TRACKED', 'NONE', 'MOVING_AVERAGE', false, true, 'RAW_MATERIAL', 50),
  ('حبوب بُر الحصان قطمة 25 كيلوجرام',
   'حبوب بُر الحصان — نسخة نصف قطمة.', 'بر حبوب',
   0, 0, false, 'GOOD', 'TRACKED', 'NONE', 'MOVING_AVERAGE', false, true, 'RAW_MATERIAL', 25),

  ('حبوب بُر الخيول كيس 50 كيلوجرام',
   'حبوب بُر الخيول — منتج خام مخزون للشركة قابِل للشراء.', 'بر حبوب',
   0, 0, false, 'GOOD', 'TRACKED', 'NONE', 'MOVING_AVERAGE', false, true, 'RAW_MATERIAL', 50),
  ('حبوب بُر الخيول قطمة 25 كيلوجرام',
   'حبوب بُر الخيول — نسخة نصف قطمة.', 'بر حبوب',
   0, 0, false, 'GOOD', 'TRACKED', 'NONE', 'MOVING_AVERAGE', false, true, 'RAW_MATERIAL', 25),

  -- ── ناتجان × نسختين (50 / 25) — مخزون الشركة؛ قابل للبيع فقط ───────────────
  ('كيس بر مطحون أبيض 50 كيلوجرام',
   'بر مطحون أبيض من البُر — سلعة مخزونة للشركة قابلة للبيع.', 'بر مطحون',
   0, 0, false, 'GOOD', 'TRACKED', 'NONE', 'MOVING_AVERAGE', true, false, 'FINISHED_GOOD', 50),
  ('قطمة بر مطحون أبيض 25 كيلوجرام',
   'بر مطحون أبيض من البُر — نسخة نصف قطمة.', 'بر مطحون',
   0, 0, false, 'GOOD', 'TRACKED', 'NONE', 'MOVING_AVERAGE', true, false, 'FINISHED_GOOD', 25),

  ('كيس بر مطحون الكبوس 50 كيلوجرام',
   'بر مطحون الكبوس — منتج نهائي مخزون للشركة قابِل للبيع.', 'بر مطحون',
   0, 0, false, 'GOOD', 'TRACKED', 'NONE', 'MOVING_AVERAGE', true, false, 'FINISHED_GOOD', 50),
  ('قطمة بر مطحون الكبوس 25 كيلوجرام',
   'بر مطحون الكبوس — نسخة نصف قطمة.', 'بر مطحون',
   0, 0, false, 'GOOD', 'TRACKED', 'NONE', 'MOVING_AVERAGE', true, false, 'FINISHED_GOOD', 25),

  ('كيس بر مطحون السعيد 50 كيلوجرام',
   'بر مطحون السعيد — منتج نهائي مخزون للشركة قابِل للبيع.', 'بر مطحون',
   0, 0, false, 'GOOD', 'TRACKED', 'NONE', 'MOVING_AVERAGE', true, false, 'FINISHED_GOOD', 50),
  ('قطمة بر مطحون السعيد 25 كيلوجرام',
   'بر مطحون السعيد — نسخة نصف قطمة.', 'بر مطحون',
   0, 0, false, 'GOOD', 'TRACKED', 'NONE', 'MOVING_AVERAGE', true, false, 'FINISHED_GOOD', 25),

  ('كيس بر مطحون الخريف 50 كيلوجرام',
   'بر مطحون الخريف — منتج نهائي مخزون للشركة قابِل للبيع.', 'بر مطحون',
   0, 0, false, 'GOOD', 'TRACKED', 'NONE', 'MOVING_AVERAGE', true, false, 'FINISHED_GOOD', 50),
  ('قطمة بر مطحون الخريف 25 كيلوجرام',
   'بر مطحون الخريف — نسخة نصف قطمة.', 'بر مطحون',
   0, 0, false, 'GOOD', 'TRACKED', 'NONE', 'MOVING_AVERAGE', true, false, 'FINISHED_GOOD', 25),

  ('كيس بر مطحون الحصان 50 كيلوجرام',
   'بر مطحون الحصان — منتج نهائي مخزون للشركة قابِل للبيع.', 'بر مطحون',
   0, 0, false, 'GOOD', 'TRACKED', 'NONE', 'MOVING_AVERAGE', true, false, 'FINISHED_GOOD', 50),
  ('قطمة بر مطحون الحصان 25 كيلوجرام',
   'بر مطحون الحصان — نسخة نصف قطمة.', 'بر مطحون',
   0, 0, false, 'GOOD', 'TRACKED', 'NONE', 'MOVING_AVERAGE', true, false, 'FINISHED_GOOD', 25),

  ('كيس بر مطحون الخيول 50 كيلوجرام',
   'بر مطحون الخيول — منتج نهائي مخزون للشركة قابِل للبيع.', 'بر مطحون',
   0, 0, false, 'GOOD', 'TRACKED', 'NONE', 'MOVING_AVERAGE', true, false, 'FINISHED_GOOD', 50),
  ('قطمة بر مطحون الخيول 25 كيلوجرام',
   'بر مطحون الخيول — نسخة نصف قطمة.', 'بر مطحون',
   0, 0, false, 'GOOD', 'TRACKED', 'NONE', 'MOVING_AVERAGE', true, false, 'FINISHED_GOOD', 25),

  -- ── الخدمة الوحيدة: أجور طحن وتجهيز (ق5 — البساطة المطلقة) ────────────────
  -- سطر واحد في فاتورة الأجور، والسعر من هذا الصنف (مصدر السعر الوحيد).
  -- ليست منتج أمانات (is_custody_item = false) — تظهر فقط في فاتورة الأجور.
  ('أجور طحن وتجهيز',
   'أجرة الخدمة الوحيدة للطحن والتجهيز — سعرها من هذا الصنف ولا يُدخل في مكان آخر.', 'بر مطحون',
   0, 500, true, 'SERVICE', 'UNTRACKED', 'NONE', 'NONE', true, false, 'SERVICE', NULL)

) AS v(name_ar, description, category, cost, price, is_service,
       nature, policy, tracking, costing, sellable, purchasable, item_class, weight)
WHERE NOT EXISTS (
  SELECT 1 FROM public.products p
  WHERE p.name_ar = v.name_ar
    AND p.item_class = v.item_class::public.item_class
    AND p.item_nature = v.nature::public.item_nature
    AND p.inventory_policy = v.policy::public.inventory_policy
    AND p.is_custody_item = (v.policy = 'CUSTOMER_OWNED')
);

-- ============================================================================
-- القسم 3ب — أصناف الأمانات (مملوكة للعميل / لا تعتمد على البيع والشراء)
-- ============================================================================
-- هذه المنتجات تُظهر في صفحة «أصناف الأمانات» فقط لأنّها تحمل:
--   is_custody_item = true
--   inventory_policy = 'CUSTOMER_OWNED'
--   item_class IN ('RAW_MATERIAL', 'FINISHED_GOOD', 'BY_PRODUCT')
-- وتخضع لقيود قاعدة البيانات التي تمنع دخولها في الفواتير التجارية.

INSERT INTO public.products (
  name, name_ar, description,
  category_id, unit_id, base_uom_id, sales_uom_id, purchase_uom_id,
  cost_price, sale_price, tax_rate, min_stock,
  is_service, is_active, status,
  item_nature, inventory_policy, tracking, costing_method,
  is_sellable, is_purchasable,
  item_class, package_type_id, package_weight_kg,
  is_custody_item
)
SELECT
  NULL::text,
  v.name_ar, v.description,
  (SELECT id FROM public.categories WHERE name_ar = v.category LIMIT 1),
  (SELECT id FROM public.units WHERE name = 'Kilogram'),
  (SELECT id FROM public.units WHERE name = 'Kilogram'),
  (SELECT id FROM public.units WHERE name = 'Kilogram'),
  (SELECT id FROM public.units WHERE name = 'Kilogram'),
  0, 0, 0, 0,
  false,
  true,
  'ACTIVE'::public.item_status,
  'GOOD'::public.item_nature,
  'CUSTOMER_OWNED'::public.inventory_policy,
  'NONE'::public.item_tracking,
  'NONE'::public.costing_method,
  false,
  false,
  v.item_class::public.item_class,
  NULL,
  v.weight::numeric,
  true
FROM (VALUES
  ('أمانة حبوب بر السعيد كيس 50 كيلوجرام',
   'أمانة حبوب بر السعيد — حبوب خام مستلمة من العميل لدى المطحنة.', 'بر حبوب', 'RAW_MATERIAL', 50),
  ('أمانة حبوب بر السعيد قطمة 25 كيلوجرام',
   'أمانة حبوب بر السعيد — نسخة نصف قطمة من الحبوب المستلمة.', 'بر حبوب', 'RAW_MATERIAL', 25),

  ('أمانة حبوب بر الكبوس كيس 50 كيلوجرام',
   'أمانة حبوب بر الكبوس — حبوب خام مستلمة من العميل لدى المطحنة.', 'بر حبوب', 'RAW_MATERIAL', 50),
  ('أمانة حبوب بر الكبوس قطمة 25 كيلوجرام',
   'أمانة حبوب بر الكبوس — نسخة نصف قطمة من الحبوب المستلمة.', 'بر حبوب', 'RAW_MATERIAL', 25),

  ('أمانة حبوب بر الخريف كيس 50 كيلوجرام',
   'أمانة حبوب بر الخريف — حبوب خام مستلمة من العميل لدى المطحنة.', 'بر حبوب', 'RAW_MATERIAL', 50),
  ('أمانة حبوب بر الخريف قطمة 25 كيلوجرام',
   'أمانة حبوب بر الخريف — نسخة نصف قطمة من الحبوب المستلمة.', 'بر حبوب', 'RAW_MATERIAL', 25),

  ('أمانة حبوب بر الحصان كيس 50 كيلوجرام',
   'أمانة حبوب بر الحصان — حبوب خام مستلمة من العميل لدى المطحنة.', 'بر حبوب', 'RAW_MATERIAL', 50),
  ('أمانة حبوب بر الحصان قطمة 25 كيلوجرام',
   'أمانة حبوب بر الحصان — نسخة نصف قطمة من الحبوب المستلمة.', 'بر حبوب', 'RAW_MATERIAL', 25),

  ('أمانة حبوب بر الخيول كيس 50 كيلوجرام',
   'أمانة حبوب بر الخيول — حبوب خام مستلمة من العميل لدى المطحنة.', 'بر حبوب', 'RAW_MATERIAL', 50),
  ('أمانة حبوب بر الخيول قطمة 25 كيلوجرام',
   'أمانة حبوب بر الخيول — نسخة نصف قطمة من الحبوب المستلمة.', 'بر حبوب', 'RAW_MATERIAL', 25)
) AS v(name_ar, description, category, item_class, weight)
WHERE NOT EXISTS (
  SELECT 1
  FROM public.products p
  WHERE p.name_ar = v.name_ar
    AND p.is_custody_item = true
    AND p.item_class = v.item_class::public.item_class
);

-- ============================================================================
-- القسم 3ج — نواتج أمانات الطحن (صنفات نواتج العميل في المطحنة)
-- ============================================================================
-- هذه الأصناف تتبع نفس المبدأ: أمانة العميل، لا تدخل في المبيعات أو الشراء
-- التجاري، كل اسم يبدأ بـ «أمانة» للتمييز في صفحة الأصناف.

INSERT INTO public.products (
  name, name_ar, description,
  category_id, unit_id, base_uom_id, sales_uom_id, purchase_uom_id,
  cost_price, sale_price, tax_rate, min_stock,
  is_service, is_active, status,
  item_nature, inventory_policy, tracking, costing_method,
  is_sellable, is_purchasable,
  item_class, package_type_id, package_weight_kg,
  is_custody_item
)
SELECT
  NULL::text,
  v.name_ar, v.description,
  (SELECT id FROM public.categories WHERE name_ar = v.category LIMIT 1),
  (SELECT id FROM public.units WHERE name = 'Kilogram'),
  (SELECT id FROM public.units WHERE name = 'Kilogram'),
  (SELECT id FROM public.units WHERE name = 'Kilogram'),
  (SELECT id FROM public.units WHERE name = 'Kilogram'),
  0, 0, 0, 0,
  false,
  true,
  'ACTIVE'::public.item_status,
  'GOOD'::public.item_nature,
  'CUSTOMER_OWNED'::public.inventory_policy,
  'NONE'::public.item_tracking,
  'NONE'::public.costing_method,
  false,
  false,
  v.item_class::public.item_class,
  NULL,
  v.weight::numeric,
  true
FROM (VALUES
  ('أمانة بر مطحون أبيض كيس 50 كيلوجرام',
   'أمانة بر مطحون أبيض — ناتج طحن مستلم من العميل للبقاء في أماناته.', 'بر مطحون', 'FINISHED_GOOD', 50),
  ('أمانة بر مطحون أبيض قطمة 25 كيلوجرام',
   'أمانة بر مطحون أبيض — نسخة نصف قطمة من ناتج الأمانة.', 'بر مطحون', 'FINISHED_GOOD', 25),

  ('أمانة بر مطحون الحصان كيس 50 كيلوجرام',
   'أمانة بر مطحون الحصان — ناتج طحن مستلم من العميل للبقاء في أماناته.', 'بر مطحون', 'FINISHED_GOOD', 50),
  ('أمانة بر مطحون الحصان قطمة 25 كيلوجرام',
   'أمانة بر مطحون الحصان — نسخة نصف قطمة من ناتج الأمانة.', 'بر مطحون', 'FINISHED_GOOD', 25),

  ('أمانة بر مطحون الخريف كيس 50 كيلوجرام',
   'أمانة بر مطحون الخريف — ناتج طحن مستلم من العميل للبقاء في أماناته.', 'بر مطحون', 'FINISHED_GOOD', 50),
  ('أمانة بر مطحون الخريف قطمة 25 كيلوجرام',
   'أمانة بر مطحون الخريف — نسخة نصف قطمة من ناتج الأمانة.', 'بر مطحون', 'FINISHED_GOOD', 25),

  ('أمانة بر مطحون الخيول كيس 50 كيلوجرام',
   'أمانة بر مطحون الخيول — ناتج طحن مستلم من العميل للبقاء في أماناته.', 'بر مطحون', 'FINISHED_GOOD', 50),
  ('أمانة بر مطحون الخيول قطمة 25 كيلوجرام',
   'أمانة بر مطحون الخيول — نسخة نصف قطمة من ناتج الأمانة.', 'بر مطحون', 'FINISHED_GOOD', 25),

  ('أمانة بر مطحون السعيد كيس 50 كيلوجرام',
   'أمانة بر مطحون السعيد — ناتج طحن مستلم من العميل للبقاء في أماناته.', 'بر مطحون', 'FINISHED_GOOD', 50),
  ('أمانة بر مطحون السعيد قطمة 25 كيلوجرام',
   'أمانة بر مطحون السعيد — نسخة نصف قطمة من ناتج الأمانة.', 'بر مطحون', 'FINISHED_GOOD', 25),

  ('أمانة بر مطحون الكبوس كيس 50 كيلوجرام',
   'أمانة بر مطحون الكبوس — ناتج طحن مستلم من العميل للبقاء في أماناته.', 'بر مطحون', 'FINISHED_GOOD', 50),
  ('أمانة بر مطحون الكبوس قطمة 25 كيلوجرام',
   'أمانة بر مطحون الكبوس — نسخة نصف قطمة من ناتج الأمانة.', 'بر مطحون', 'FINISHED_GOOD', 25)
) AS v(name_ar, description, category, item_class, weight)
WHERE NOT EXISTS (
  SELECT 1
  FROM public.products p
  WHERE p.name_ar = v.name_ar
    AND p.is_custody_item = true
    AND p.item_class = v.item_class::public.item_class
);

-- ============================================================================
-- القسم 4 — المورّد والعميلان
-- ============================================================================
-- (أُلغي حسب طلب المالك): بيانات «مؤسسة الحبوب للتوريدات» وعميلي التجربة
-- «مخابز الأمانة» و«تجارة النور» حُذفت من هذا الملف.
-- اللازم للنظام فقط يبقى مزروعاً تلقائياً من seeds/01_system/09_essential_partners.sql:
--   المخزن الرئيسي (code=MAIN) + «عميل نقدي» + «مورد نقدي».
--
--   تنبيه تنظيف: إن كانت بيانات القسم القديم موجودة في قاعدة سابقة،
--   تُحذف هنا (بلا مرجع حركات) حتى لا تبقى عالقة:
DELETE FROM public.suppliers WHERE name = 'مؤسسة الحبوب للتوريدات'
  AND NOT EXISTS (SELECT 1 FROM public.purchase_invoices pi WHERE pi.supplier_id = public.suppliers.id);
DELETE FROM public.customers WHERE name IN ('مخابز الأمانة', 'تجارة النور للحبوب')
  AND NOT EXISTS (SELECT 1 FROM public.custody_ledger l WHERE l.customer_id = public.customers.id)
  AND NOT EXISTS (SELECT 1 FROM public.sales_invoices si WHERE si.customer_id = public.customers.id);

COMMIT;

-- ============================================================================
-- التحقق بعد التشغيل
-- ============================================================================
-- شغّل هذه الاستعلامات للتأكد من أن البيانات نزلت صحيحة:
--
--   SELECT count(*) FROM public.products WHERE is_custody_item AND is_active;   -- المتوقع: 8
--   SELECT count(*) FROM public.products WHERE item_class='SERVICE' AND is_active; -- المتوقع: 1
--   SELECT count(*) FROM public.products WHERE name ~ '[a-zA-Z]' AND is_active; -- المتوقع: 0 (عربي فقط)
--   SELECT count(*) FROM public.products WHERE sku IS NOT NULL AND is_custody_item AND is_active; -- المتوقع: 0
-- ============================================================================

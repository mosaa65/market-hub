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
  ('البُر (القمح)',   'البُر (القمح)'),
  ('دقيق البُر',      'دقيق البُر'),
  ('المخلوط اليمني',  'المخلوط اليمني'),
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
  -- ── حبتان خام × نسختين (50 / 25) — الاسم الكامل يحمل كل المعلومات ────────
  ('حبوب بُر سمراء كيس 50 كيلوجرام',
   'حبوب بُر سمراء محلي — أشهر أصناف القمح اليمني.', 'البُر (القمح)',
   0, 0, false, 'GOOD', 'CUSTOMER_OWNED', 'NONE', 'NONE', false, false, 'RAW_MATERIAL', 50),
  ('حبوب بُر سمراء كيس 25 كيلوجرام',
   'حبوب بُر سمراء محلي — نسخة نصف كيس.', 'البُر (القمح)',
   0, 0, false, 'GOOD', 'CUSTOMER_OWNED', 'NONE', 'NONE', false, false, 'RAW_MATERIAL', 25),

  ('حبوب بُر ميساني كيس 50 كيلوجرام',
   'حبوب بُر ميساني — صنف قمح محلي معروف.', 'البُر (القمح)',
   0, 0, false, 'GOOD', 'CUSTOMER_OWNED', 'NONE', 'NONE', false, false, 'RAW_MATERIAL', 50),
  ('حبوب بُر ميساني كيس 25 كيلوجرام',
   'حبوب بُر ميساني — نسخة نصف كيس.', 'البُر (القمح)',
   0, 0, false, 'GOOD', 'CUSTOMER_OWNED', 'NONE', 'NONE', false, false, 'RAW_MATERIAL', 25),

  -- ── ناتجان × نسختين (50 / 25) ────────────────────────────────────────────
  ('كيس دقيق أبيض 50 كيلوجرام',
   'دقيق أبيض من البُر — للخبز والرشوش والملوج.', 'دقيق البُر',
   0, 0, false, 'GOOD', 'CUSTOMER_OWNED', 'NONE', 'NONE', false, false, 'FINISHED_GOOD', 50),
  ('كيس دقيق أبيض 25 كيلوجرام',
   'دقيق أبيض من البُر — نسخة نصف كيس.', 'دقيق البُر',
   0, 0, false, 'GOOD', 'CUSTOMER_OWNED', 'NONE', 'NONE', false, false, 'FINISHED_GOOD', 25),

  ('كيس نخالة 50 كيلوجرام',
   'نخالة البُر — ناتج طحن يُسجّل أمانةً للعميل ويُسلّم له.', 'النخالة',
   0, 0, false, 'GOOD', 'CUSTOMER_OWNED', 'NONE', 'NONE', false, false, 'BY_PRODUCT', 50),
  ('كيس نخالة 25 كيلوجرام',
   'نخالة البُر — ناتج طحن أمانة للعميل — نسخة نصف كيس.', 'النخالة',
   0, 0, false, 'GOOD', 'CUSTOMER_OWNED', 'NONE', 'NONE', false, false, 'BY_PRODUCT', 25),

  -- ── الخدمة الوحيدة: أجور طحن وتجهيز (ق5 — البساطة المطلقة) ────────────────
  -- سطر واحد في فاتورة الأجور، والسعر من هذا الصنف (مصدر السعر الوحيد).
  -- ليست منتج أمانات (is_custody_item = false) — تظهر فقط في فاتورة الأجور.
  ('أجور طحن وتجهيز',
   'أجرة الخدمة الوحيدة للطحن والتجهيز — سعرها من هذا الصنف ولا يُدخل في مكان آخر.', 'دقيق البُر',
   0, 1000, true, 'SERVICE', 'UNTRACKED', 'NONE', 'NONE', true, false, 'SERVICE', NULL)

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

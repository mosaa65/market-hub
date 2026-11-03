-- ============================================================================
-- 17_package_weight.sql
--
-- سعة العبوة الرسمية (وزن الكيس) — عمود موحّد على جدول المنتجات.
--
-- الخلفية: العمود package_weight_kg أُضيف في 05_products_and_inventory.sql،
-- لكنه لم يُطبَّق على المخطط الحيّ (تعارض/تخطٍّ في التطبيق). النتيجة: شاشتا
-- الطحن والتسليم تُرجعان SelectQueryError عند قراءة العمود، وخريطة السعة تبقى
-- فارغة فيعرض النظام 0 لكل الأصناف.
--
-- هذه المهاجرة idempotent: تُضيف العمود إن لم يكن موجوداً، وتُطبّق القيود
-- والتعليق التوثيقي دائماً. آمنة للتشغيل أكثر من مرة.
--
-- القاعدة الرسمية: أي منتج يُعبّأ (FINISHED_GOOD / BY_PRODUCT / RAW_MATERIAL)
-- يمكن أن يحمل سعة عبوة افتراضية بالكيلوجرام. تُستخدم فقط لتعبئة نموذج
-- "الوزن الافتراضي" في شاشات الطحن والتسليم — لا تؤثر على أي حساب مخزون.
--
-- ROLLBACK:
--   ALTER TABLE public.products DROP COLUMN IF EXISTS package_weight_kg;
-- ============================================================================

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS package_weight_kg numeric(12,3);

DO $$ BEGIN
  ALTER TABLE public.products
    ADD CONSTRAINT products_package_weight_positive_check
    CHECK (package_weight_kg IS NULL OR package_weight_kg > 0);
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

COMMENT ON COLUMN public.products.package_weight_kg IS
  'السعة الافتراضية للعبوة بالكيلوجرام (مثال 50 أو 25). تُستخدم لتعبئة الوزن الافتراضي في شاشات الطحن والتسليم فقط.';

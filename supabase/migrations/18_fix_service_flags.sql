-- ============================================================================
-- 18_fix_service_flags.sql — تصحيح عمود products.is_service
-- ============================================================================
--
-- ── المشكلة ─────────────────────────────────────────────────────────────────
--   كان عمود `products.is_service` مُعبّأً بشكل **معكوس** في بيانات العرض:
--     • كل النواتج (FINISHED_GOOD / BY_PRODUCT) كانت is_service = TRUE
--     • والخدمة الوحيدة (SERVICE — «أجور طحن وتجهيز») كانت is_service = FALSE
--   الأثر العملي:
--     1. نقطة البيع كانت تمنع بيع النواتج لأنها تُعامَل كخدمة (بلا فحص مخزون)،
--        وتستثني صنف «أجور طحن» من القائمة فيستحيل بيع أجرة الطحن.
--     2. التقارير كانت تعتبر النواتج «خدمات» (بلا تكلفة مخزون).
--
-- ── القاعدة الصحيحة (docs/milling/00 — ق5 / 04 — د2) ────────────────────────
--   `is_service = TRUE` **فقط** لأصناف `item_class = 'SERVICE'`.
--   كل ما عداه بضاعة → `is_service = FALSE`.
--
-- ── idempotent: يمكن تشغيله أكثر من مرة بأمان (UPDATE بلا قيود فريدة) ───────
-- ============================================================================

BEGIN;

-- 1) الخدمات الحقيقية فقط
UPDATE public.products
SET is_service = true
WHERE item_class = 'SERVICE'
  AND is_service IS DISTINCT FROM true;

-- 2) كل ما ليس خدمة = بضاعة (خام/ناتج/مستهلكات/…)
UPDATE public.products
SET is_service = false
WHERE item_class <> 'SERVICE'
  AND is_service IS DISTINCT FROM false;

COMMIT;

-- ── التحقق بعد التشغيل ──────────────────────────────────────────────────────
-- SELECT item_class, is_service, count(*)
-- FROM public.products GROUP BY 1, 2 ORDER BY 1;
--
-- المتوقع:  SERVICE → is_service = TRUE (صف واحد)
--            كل الباقي → is_service = FALSE

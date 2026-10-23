-- ═══════════════════════════════════
-- البند 8 من تقرير التدقيق — سلسلة التتبع (Traceability)
--
-- المشكلة الموثقة (rebuild-plan §1.3 الخطوة 6): حركات الأمانة ليست كلها
-- موثقة المصدر، فلا يمكن الإجابة على سؤال "هذا الكيس جاء من أي استلام؟".
-- كان الربط الوحيد حقل `milling_document_id` الاختياري.
--
-- الحل: عمودان عامان على نمط المحرك `post_stock_delta`:
--   source_type : نوع المصدر (milling_document / custody_adjustment /
--                 stock_conversion / manual)
--   source_id   : معرف المصدر (uuid)
-- مع فهارس تشغيلية للبحث العكسي، وتحديث تلقائي للحركات القديمة من
-- رابط milling_document_id حتى لا تفقدها سلسلة التتبع.
-- ═══════════════════

ALTER TABLE public.custody_ledger
  ADD COLUMN IF NOT EXISTS source_type text,
  ADD COLUMN IF NOT EXISTS source_id uuid;

-- فهرس البحث العكسي: من المصدر إلى حركاته
CREATE INDEX IF NOT EXISTS idx_custody_source
  ON public.custody_ledger (source_type, source_id)
  WHERE source_id IS NOT NULL;

-- ترحيل البيانات القديمة: الحركات المرتبطة بوثيقة milling_service_documents
-- تصبح موثقة المصدر تلقائياً (milling_document)
UPDATE public.custody_ledger cl
SET source_type = 'milling_document',
    source_id   = cl.milling_document_id
WHERE cl.milling_document_id IS NOT NULL
  AND cl.source_id IS NULL;

-- تعليق على الدوال: الأعمدة الجديدة تُكتب عبر RPCs القائمة في الترحيلات
-- القادمة (تسجيل الطحن/التسليم/التسوية تمرر مصدرها) — لا تغيير في
-- التواقيع القائمة حتى لا تنكسر الاستدعاءات.

-- ============================================================================
-- 15_freeze_document_numbers.sql — تجميد أرقام المستندات
-- ============================================================================
--
-- ما هذا الملف؟
--   يضيف عمود `document_number` إلى كل جدول مستند مرقَّم. وهو عمود **مُولَّد**
--   (GENERATED ALWAYS ... STORED) يعكس العمود الأصلي في الجدول:
--
--     sales_invoices     → يعكس invoice_number
--     purchase_invoices  → يعكس invoice_number
--     sales_returns      → يعكس return_number
--     purchase_returns   → يعكس return_number
--     stock_transfers    → يعكس transfer_number
--
-- ── لماذا عمود مُولَّد لا عادي؟ ──────────────────────────────────────────────
--   العمود المُولَّد **لا يمكن الكتابة عليه**: أي محاولة UPDATE أو INSERT عليه
--   ترمي خطأ من PostgreSQL نفسه. هذا هو التجميد: لا كود — ولا خطأ برمجي — يمكنه
--   أن يُعيد كتابة رقم صادر، لأن القاعدة ترفضه قبل أن يفكّر فيه أي مُشغّل أو دالة.
--
--   والبديل (عمود عادي + trigger يمنع التغيير) أضعف: يعتمد على أن المُشغّل
--   مثبَّت ولم يُعطَّل، ويسمح بالتعديل إن أُلغيت سياسة بلا قصد.
--
-- ── لماذا اسم موحّد؟ ────────────────────────────────────────────────────────
--   كل جدول كان يسمّي عموده بشكل مختلف (`invoice_number`, `return_number`,
--   `transfer_number`). فيمنح هذا العمود قراءةً واحدة لكل أنواع المستندات:
--
--     SELECT document_number FROM sales_invoices UNION ...
--
--   والأعمدة الأصلية تبقى كما هي، فلا ينكسر أي كود يقرأها. فهذا إضافة لا إحلال.
--
-- ── ما ليس في هذا الملف ─────────────────────────────────────────────────────
--   مزامنة عدّاد `current_value` من التسلسلات: مكانها بذرة الترقيم
--   `07_document_numbering.sql`، لأنها بيانات لا بنية. كان المصدر يضعها هنا،
--   فتُنفَّذ في الترحيل وتُكرَّر في البذرة — والتكرار مرفوض (القاعدة R-1).
--
-- ⚠️ المصدر: origin/main — 20261210000100_freeze_document_numbers.sql
--    عُدِّل عند الدمج: حُذف قسم مزامنة العدّاد لتكراره مع البذرة 07.
-- ============================================================================

-- ── العمود الموحّد ──────────────────────────────────────────────────────────
-- IF NOT EXISTS يجعل الملف آمنًا لو طُبِّق مرتين.
ALTER TABLE public.sales_invoices
  ADD COLUMN IF NOT EXISTS document_number text GENERATED ALWAYS AS (invoice_number) STORED;

ALTER TABLE public.purchase_invoices
  ADD COLUMN IF NOT EXISTS document_number text GENERATED ALWAYS AS (invoice_number) STORED;

ALTER TABLE public.sales_returns
  ADD COLUMN IF NOT EXISTS document_number text GENERATED ALWAYS AS (return_number) STORED;

ALTER TABLE public.purchase_returns
  ADD COLUMN IF NOT EXISTS document_number text GENERATED ALWAYS AS (return_number) STORED;

ALTER TABLE public.stock_transfers
  ADD COLUMN IF NOT EXISTS document_number text GENERATED ALWAYS AS (transfer_number) STORED;

-- ── التحقق الذاتي ───────────────────────────────────────────────────────────
-- نتحقق أن العمود مُولَّد فعلاً، لا مجرد موجود. لو أُنشئ عمودًا عاديًا (باسم
-- مشابه) لظنّ الكود أن الأرقام محميّة وهي ليست كذلك — وهو أسوأ من عدم وجوده،
-- لأنه يعطي طمأنينة كاذبة.
DO $$
DECLARE
  v_tbl    text;
  v_tables text[] := ARRAY['sales_invoices', 'purchase_invoices', 'sales_returns',
                           'purchase_returns', 'stock_transfers'];
  v_bad    text[] := ARRAY[]::text[];
BEGIN
  FOREACH v_tbl IN ARRAY v_tables LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = v_tbl
        AND column_name = 'document_number'
        AND is_generated = 'ALWAYS'
    ) THEN
      v_bad := v_bad || v_tbl;
    END IF;
  END LOOP;

  IF array_length(v_bad, 1) > 0 THEN
    RAISE EXCEPTION
      'عمود document_number ليس مُولَّدًا في: % — الأرقام ليست محميّة من التعديل',
      array_to_string(v_bad, ', ');
  END IF;
END $$;

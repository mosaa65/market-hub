-- ============================================================================
-- 07_document_numbering.sql — إعداد ترقيم المستندات
-- ============================================================================
--
-- ما هذا الملف؟
--   صف لكل نوع مستند في النظام: بادئته، وصيغته، وحشوه. محرّك الترقيم في
--   `supabase/migrations/14_document_numbering_engine.sql` يقرأ من هنا ليُنتج
--   الرقم الافتراضي المعروض: `{PREFIX}-{YYYY}-{MM}-{SEQ}` ← `INV-2026-10-0001`.
--
-- لماذا هو ملف نظام (يُشغَّل تلقائيًا)؟
--   لأن بلا هذه الصفوف يرفض المحرّك توليد أي رقم:
--     «No numbering configuration for sales_invoice»
--   فيتوقف البيع والشراء والطحن والمصروفات. فالنظام لا يعمل بدونها.
--
-- ── لماذا في seed لا في migration؟ ──────────────────────────────────────────
--   الترحيل بنية (جدول وأعمدة ودوال)، وهذه **بيانات** (17 صف إعداد). والقانون
--   في `MIGRATIONS_RULES.md` يفصل بينهما فصلًا صريحًا.
--   المصدر كان يضعها داخل الترحيل — نُقلت هنا عند الدمج.
--
-- ── القيم تعكس السلوك الحالي ────────────────────────────────────────────────
--   العمود `date_part` قيمته 'none' للجميع، والصيغة تحمل `{YYYY}{MM}` صراحةً.
--   هذا مقصود: العدد لا يُصفَّر شهريًا ولا سنويًا، والتاريخ عرضٌ في الاسم فقط.
--   فالترقيم متصل أبدًا، ولا يتكرر رقم أبدًا عبر السنوات.
--
-- ── ⚠️ لا تُغيَّر الأرقام بعد الإصدار ───────────────────────────────────────
--   الرقم يُخزَّن نصًا على صف المستند عند إنشائه. فتعديل صف هنا يُغيّر
--   **المستندات القادمة فقط**، ولا يُعيد كتابة مستند صادر. هذا مقصود (انظر
--   `15_freeze_document_numbers.sql` الذي يمنع التغيير من جهة المستند).
--
-- ثابت (Idempotent): ON CONFLICT على (document_type, scope, scope_id).
-- المرجع: supabase/MIGRATIONS_RULES.md — القاعدتان R-19 و R-30.
-- ============================================================================

BEGIN;

-- ── صفوف الإعداد ────────────────────────────────────────────────────────────
-- الأعمدة:
--   document_type  مفتاح النوع — يطابق ما تمرّره الدوال: 'sales_invoice'…
--   section        تجميع للعرض في الشاشة الإدارية فقط، لا أثر تشغيلي
--   label_ar/en    الاسم المعروض في الشاشة
--   prefix         البادئة: INV · SR · PO · JV …
--   format_tokens  القالب. الرموز: {PREFIX} {SEQ} {YYYY} {YY} {MM} {DD}
--   padding        عدد أصفار الحشو. 0 = بلا حشو
--   date_part      'none' — لا يُصفَّر العدّاد. التاريخ في القالب عرضٌ فقط
INSERT INTO public.document_numbering
  (document_type, section, label_ar, label_en, prefix, separator, format_tokens, padding, date_part)
VALUES
  -- ── المبيعات ──────────────────────────────────────────────────────────────
  ('sales_invoice',    'sales',      'فاتورة مبيعات',   'Sales Invoice',     'INV',  '-', '{PREFIX}-{YYYY}-{MM}-{SEQ}',  4, 'none'),
  ('sales_return',     'sales',      'مرتجع مبيعات',    'Sales Return',      'SR',   '-', '{PREFIX}-{YYYY}-{MM}-{SEQ}',  4, 'none'),
  ('quotation',        'sales',      'عرض سعر',         'Quotation',         'QUO',  '-', '{PREFIX}-{YYYY}-{MM}-{SEQ}',  4, 'none'),
  ('sales_order',      'sales',      'أمر بيع',         'Sales Order',       'SO',   '-', '{PREFIX}-{YYYY}-{MM}-{SEQ}',  4, 'none'),

  -- ── المشتريات ─────────────────────────────────────────────────────────────
  ('purchase_invoice', 'purchase',   'فاتورة مشتريات',  'Purchase Invoice',  'PO',   '-', '{PREFIX}-{YYYY}-{MM}-{SEQ}',  4, 'none'),
  ('purchase_return',  'purchase',   'مرتجع مشتريات',   'Purchase Return',   'PR',   '-', '{PREFIX}-{YYYY}-{MM}-{SEQ}',  4, 'none'),
  ('purchase_order',   'purchase',   'أمر شراء',         'Purchase Order',    'PO',   '-', '{PREFIX}-{YYYY}-{MM}-{SEQ}',  4, 'none'),

  -- ── المخزون ───────────────────────────────────────────────────────────────
  ('goods_receipt',    'inventory',  'سند استلام',      'Goods Receipt',     'GRN',  '-', '{PREFIX}-{YYYY}-{MM}-{SEQ}',  4, 'none'),
  ('stock_transfer',   'inventory',  'تحويل مخزني',     'Stock Transfer',    'TR',   '-', '{PREFIX}-{YYYY}-{MM}-{SEQ}',  4, 'none'),
  ('stock_adjustment', 'inventory',  'تسوية مخزنية',    'Stock Adjustment',  'ADJ',  '-', '{PREFIX}-{YYYY}-{MM}-{SEQ}',  4, 'none'),

  -- ── المطحنة ──────────────────────────────────────────────────────
  ('milling_intake',   'milling',    'سند استلام أمانات', 'Milling Intake',    'MI',   '-', '{PREFIX}-{YYYY}-{MM}-{SEQ}',  4, 'none'),
  ('milling_service',  'milling',    'سند خدمة طحن',    'Milling Service',   'MS',   '-', '{PREFIX}-{YYYY}-{MM}-{SEQ}',  4, 'none'),

  -- ── السندات والمالية ──────────────────────────────────────────────────────
  ('customer_payment', 'receipts',   'سند قبض عميل',    'Customer Receipt',  'RV',   '-', '{PREFIX}-{YYYY}-{MM}-{SEQ}',  4, 'none'),
  ('supplier_payment', 'payments',   'سند صرف مورد',    'Supplier Payment',  'PV',   '-', '{PREFIX}-{YYYY}-{MM}-{SEQ}',  4, 'none'),
  ('expense',          'payments',   'سند مصروف',       'Expense Voucher',   'EXP',  '-', '{PREFIX}-{YYYY}-{MM}-{SEQ}',  4, 'none'),
  ('journal_entry',    'finance',    'قيد يومية',       'Journal Entry',      'JV',   '-', '{PREFIX}-{YYYY}-{MM}-{SEQ}',  4, 'none')
-- ⚠️ صيغة ON CONFLICT تطابق فهرس التعبير في الترحيل 14 حرفيًا.
-- لا نكتب (document_type, scope, scope_id) مجرّدة: scope_id = NULL لا يتعارض
-- مع NULL في SQL، فيمرّ الصف مكررًا كل تشغيل. راجع الشرح في الترحيل 14.
ON CONFLICT (document_type, scope, (coalesce(scope_id, '00000000-0000-0000-0000-000000000000'::uuid))) DO NOTHING;

-- ── مزامنة العدّاد المعروض ──────────────────────────────────────────────────
-- `current_value` **للعرض فقط** — التخصيص الحقيقي من التسلسل. نضبطه من
-- last_value الفعلي ليُظهر للعميل رقماً صادقاً بدل صفر مضلِّل.
-- آمن على قاعدة جديدة (التسلسل قيمته 1).
DO $$
DECLARE
  r RECORD;
  v_last bigint;
BEGIN
  FOR r IN SELECT * FROM public.document_numbering WHERE scope = 'global' LOOP
    IF public.fn_document_numbering_sequence_name(r.document_type) IS NOT NULL THEN
      EXECUTE format(
        'SELECT last_value FROM %s',
        public.fn_document_numbering_sequence_name(r.document_type)
      ) INTO v_last;

      UPDATE public.document_numbering
        SET current_value = COALESCE(v_last, 0)
        WHERE id = r.id;
    END IF;
  END LOOP;
END $$;

-- ── التحقق الذاتي ───────────────────────────────────────────────────────────
-- كل نوع مستند يمرّره الكود يجب أن يكون له صف، وإلا توقف تدفّق كامل بصمت ثم
-- انكسر عند أول استخدام. نفحص الآن ونسمّي الناقص.
DO $$
DECLARE
  v_required text[] := ARRAY[
    'sales_invoice', 'sales_return', 'purchase_invoice', 'purchase_return',
    'stock_transfer', 'expense', 'customer_payment', 'supplier_payment',
    'journal_entry', 'milling_intake', 'milling_service'
  ];
  v_missing text[];
BEGIN
  SELECT array_agg(t) INTO v_missing
  FROM unnest(v_required) AS t
  WHERE NOT EXISTS (
    SELECT 1 FROM public.document_numbering d
    WHERE d.document_type = t AND d.scope = 'global'
  );

  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION
      'أنواع مستندات بلا إعداد ترقيم: % — المحرّك سيرفض توليد أرقامها',
      array_to_string(v_missing, ', ');
  END IF;

  -- ونوع غير معروف في الجدول = صف لا يُستخدم أبداً (خطأ غالباً مطبعي).
  IF EXISTS (
    SELECT 1 FROM public.document_numbering d
    WHERE public.fn_document_numbering_sequence_name(d.document_type) IS NULL
  ) THEN
    RAISE WARNING
      'صفوف ترقيم بأنواع مستندات لا يعرفها المحرّك — لن تُستخدم: %',
      (SELECT string_agg(document_type, ', ')
       FROM public.document_numbering
       WHERE public.fn_document_numbering_sequence_name(document_type) IS NULL);
  END IF;
END $$;

COMMIT;

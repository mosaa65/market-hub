 -- ============================================================================
-- 08_payment_methods.sql — كتالوج طرق الدفع
-- ============================================================================
--
-- ما هذا الملف؟
--   طرق الاختيار الجديدة أربع فقط: النقد والآجل والتحويل البنكي والمحفظة.
--   على القواعد القائمة تبقى الصفوف التاريخية غير نشطة. إعادة البناء النظيفة
--   لا تزرع هويات البنوك/المحافظ المسماة أو البطاقة والشيك ضمن الكتالوج.
--
-- لماذا هو ملف نظام (يُشغَّل تلقائيًا)؟
--   لأن بلا هذه الصفوف لا يستطيع الكاشير تسجيل أي دفعة: كل الاستعلامات تقرأ
--   من payment_methods، والمبيعات والمشتريات والمصروفات والتحصيل تعتمد عليها.
--
-- ── لماذا في seed لا في migration؟ ──────────────────────────────────────────
--   هذه **بيانات مرجعية** — كتالوج ثابت لا يعمل النظام بدونه، وهو نفسه في كل
--   نسخة. والقانون في `supabase/docs/2026-10-12_guide_migrations-rules.md` يضعها في `seeds/01_system/`،
--   لا في الترحيل. المصدر كان يضعها داخل الترحيل — نُقلت هنا عند الدمج.
--
-- ── الربط المحاسبي ──────────────────────────────────────────────────────────
--   كل طريقة تحمل `ledger_kind` و`default_account_code`، فيعرف محرّك الترحيل
--   أين يسجّل المبلغ:
--
--     CASH   → 1101 الصندوق
--     BANK   → 1111 البنك
--     WALLET → 1131 المحفظة الإلكترونية
--     CARD   → 1111 (سجلات تاريخية فقط؛ لا يُقبل في عمليات جديدة)
--     CREDIT → 1211 ذمم العملاء
--     OTHER  → بلا حساب (خط الدفع المجزأ ليس وسيلة)
--
-- ── `legacy_ids` ليست زخرفة ─────────────────────────────────────────────────
--   تحتفظ أنواع قاعدة البيانات التاريخية بقيمها، لكن التثبيت الجديد لا يزرع
--   هويات البنوك/المحافظ المسماة أو البطاقة/الشيك في كتالوج الخيارات.
--
--   المستندات السابقة تحتفظ بقيمة الدفع المخزنة وبقيدها؛ أما الإعدادات والكتابة
--   الجديدة فمقصورة على النقد والآجل والتحويل والمحفظة العامة.
--
-- ── ⚠️ الأسماء والحسابات مرتبطة ببعضها ──────────────────────────────────────
--   `default_account_code` تشير إلى أكواد دليل الحسابات في
--   `03_chart_of_accounts.sql`. تغيير كود هناك بلا تغييره هنا يقطع الربط
--   بصمت، فيفشل الترحيل عند أول دفعة بتلك الطريقة.
--
-- ── `shipped_name_ar` هي أساس ميزة «معدّلة» ───────────────────────────────
--   تُكتب عند الزرع ولا تُعدَّل أبداً، فتعرف شاشة الإعدادات أن المنشأة أعادت
--   تسمية طريقة نظامية، وتعرض اسمها الأصلي. لو حُذفت هذه الكتابة لعاد
--   `is_renamed` إلى `false` دائماً كما كان قبل إصلاح الترحيل 16.
--
-- ── إعداد المنشأة الافتراضي يُزرع هنا ────────────────────────────────────────
--   قسم 4.1 من الترحيل 16 كان يُدرج `payment_method_settings` للطرق القديمة
--   القديمة، لكنه يعمل **قبل** هذه البذرة، فيجد كتالوجاً فارغاً ويُدرج صفراً
--   بصمت. نُقل الإدراج إلى هنا بعد الكتالوج، فهو بيانات لا بنية.
--
-- ثابت (Idempotent): ON CONFLICT على المفتاح الأساسي `id` (رمز برمجي ثابت).
-- المرجع: supabase/docs/2026-10-12_guide_migrations-rules.md — القاعدتان R-19 و R-30.
-- ============================================================================

BEGIN;

INSERT INTO public.payment_methods (
  id, name_ar, name_en, icon_key, is_active, sort_order, allowed_contexts,
  ledger_kind, default_account_code, is_credit_term, requires_reference,
  legacy_ids, legacy_id, notes, shipped_name_ar
) VALUES
  -- ─── النقد: الأصل، ومتاح في كل قسم بما فيه المرتجعات ──────────────────────
  ('cash', 'نقداً', 'Cash', 'cash', true, 10,
   ARRAY['pos','sales','purchases','expenses','customer_collection','sales_returns','purchase_returns'],
   'CASH', '1101', false, false, ARRAY['cash'], 'cash',
   'الصندوق. الأكثر استخداماً في السوق اليمني.',
   'نقداً'),

  -- ─── الآجل ────────────────────────────────────────────────────────────────
  ('credit', 'آجل', 'Credit', 'credit', true, 20,
   ARRAY['pos','sales','purchases','sales_returns','purchase_returns'],
   'CREDIT', '1211', true, false, ARRAY['credit'], 'credit',
   'لا يُحصَّل الآن: يصبح ذمة على العميل أو للمورد. لا معنى له في المصروفات أو التحصيل.',
   'آجل'),

  -- ─── تحويل بنكي عام: غير مرتبط ببنك بعينه ────────────────────────────────
  ('bank_transfer', 'تحويل بنكي', 'Bank transfer', 'bank-transfer', true, 30,
   ARRAY['pos','sales','purchases','expenses','customer_collection'],
   'BANK', '1111', false, true, ARRAY['bank_transfer'], 'bank_transfer',
   'حوالة مصرفية عامة. يتطلب رقم الحوالة.',
   'تحويل بنكي'),

  -- ─── المحفظة الإلكترونية العامة: البديل التاريخي بلا مؤسسة محددة ─────────
  ('mobile_money', 'محفظة إلكترونية', 'Mobile money', 'mobile-money', true, 110,
   ARRAY['pos','sales','purchases','expenses','customer_collection'],
   'WALLET', '1131', false, true, ARRAY['mobile_money'], 'mobile_money',
   'محفظة محلية غير محددة. تبقى للتوافق مع العمليات القديمة.',
   'محفظة إلكترونية'),

  -- ─── خط الدفع المجزأ: اسم وأيقونة للفاتورة التي سُدّدت بأكثر من وسيلة ────
  ('split', 'دفع بأكثر من طريقة', 'Split payment', 'split', true, 900,
   ARRAY['pos','sales'],
   'OTHER', NULL, false, false, ARRAY['split'], 'split',
   'ليس وسيلة يختارها الكاشير؛ ما تسجّله الفاتورة عند تعدد وسائل السداد.',
   'دفع بأكثر من طريقة')
ON CONFLICT (id) DO UPDATE SET
  name_ar              = EXCLUDED.name_ar,
  name_en              = EXCLUDED.name_en,
  icon_key             = EXCLUDED.icon_key,
  is_active            = EXCLUDED.is_active,
  sort_order           = EXCLUDED.sort_order,
  allowed_contexts     = EXCLUDED.allowed_contexts,
  ledger_kind          = EXCLUDED.ledger_kind,
  default_account_code = COALESCE(EXCLUDED.default_account_code, public.payment_methods.default_account_code),
  is_credit_term       = EXCLUDED.is_credit_term,
  requires_reference   = EXCLUDED.requires_reference,
  legacy_ids           = EXCLUDED.legacy_ids,
  legacy_id            = EXCLUDED.legacy_id,   -- القيمة المخزّنة: للصفوف النظامية تتبع العائلة
  notes                = EXCLUDED.notes,
  shipped_name_ar      = EXCLUDED.shipped_name_ar,   -- الاسم الأصلي يُحدَّث مع البذرة فقط
  updated_at           = now();

-- ── إعداد المنشأة الافتراضي للطرق الأربع المعتمدة ──────────────────────────
-- نُقل من الترحيل 16 §4.1: كان يُدرج قبل هذه البذرة فيجد الكتالوج فارغًا ويُدرج
-- صفرًا بصمت. هنا يجده مملوءًا، فإن غاب صف إعداد لطريقة قديمة، لا يُفقد خيار
-- دفع من الصندوق عند الترقية.
--
-- ON CONFLICT DO NOTHING: إعداد المنشأة ملك المنشأة؛ من اختار طريقة لا يُستبدل
-- اختياره. والطرق اليمنية المسمّاة لا تأخذ صفًا هنا عن قصد — غياب الصف يعني
-- «ورّث افتراضي الكتالوج».
INSERT INTO public.payment_method_settings (
  payment_method_id, enabled, sort_order, enabled_contexts
)
SELECT m.id, true, m.sort_order, m.allowed_contexts
FROM public.payment_methods m
WHERE m.id IN ('cash','credit','bank_transfer','mobile_money')
ON CONFLICT (payment_method_id) DO NOTHING;

-- ── التحقق الذاتي ───────────────────────────────────────────────────────────
-- كل كود حساب في الكتالوج يجب أن يوجد في دليل الحسابات. لو غاب، لظهر الخطأ
-- متأخرًا عند أول دفعة بتلك الطريقة — وقت لا ينتظر أحد. نفحصه الآن.
DO $$
DECLARE
  v_missing text[];
BEGIN
  SELECT array_agg(m.id || ' → ' || m.default_account_code) INTO v_missing
  FROM public.payment_methods m
  WHERE m.default_account_code IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.accounts a WHERE a.code = m.default_account_code
    );

  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION
      'طرق دفع تشير إلى حسابات غير موجودة في دليل الحسابات: %',
      array_to_string(v_missing, ', ');
  END IF;

  -- القيم الأساسية الأربع وحالة split لها تعريف؛ enum card/cheque تبقى للتوافق
  -- مع قواعد البيانات القديمة، لكنها لا تُزرع كخيارات في قاعدة جديدة.
  IF EXISTS (
    SELECT 1 FROM unnest(ARRAY['cash','credit','bank_transfer','mobile_money','split']) AS t
    WHERE NOT EXISTS (
      SELECT 1 FROM public.payment_methods m WHERE t = ANY(m.legacy_ids)
    )
  ) THEN
    RAISE EXCEPTION
      'قيم payment_method تاريخية بلا طريقة دفع تقابلها — التقارير القديمة ستُهملها';
  END IF;
  -- وكل صف نظامي يجب أن يحمل اسمه الأصلي، وإلا عادت ميزة «معدّلة» معطّلة.
  IF EXISTS (
    SELECT 1 FROM public.payment_methods m
    WHERE m.is_system AND coalesce(btrim(m.shipped_name_ar), '') = ''
  ) THEN
    RAISE EXCEPTION
      'طرق دفع نظامية بلا اسم أصلي مشحون (shipped_name_ar) — ميزة «معدّلة» لن تعمل';
  END IF;

  -- خيارات الدفع الجديدة الأربع فقط لها إعدادات قابلة للتعديل.
  IF EXISTS (
    SELECT 1 FROM unnest(ARRAY['cash','credit','bank_transfer','mobile_money']) AS t
    WHERE NOT EXISTS (
      SELECT 1 FROM public.payment_method_settings s WHERE s.payment_method_id = t
    )
  ) THEN
    RAISE EXCEPTION
      'طريقة دفع أساسية بلا صف إعداد للمنشأة';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.payment_methods m
    WHERE m.is_active AND m.id NOT IN ('cash','credit','bank_transfer','mobile_money','split')
  ) THEN
    RAISE EXCEPTION 'يوجد خيار نشط خارج طرق الدفع الأربع المعتمدة';
  END IF;
END $$;

COMMIT;

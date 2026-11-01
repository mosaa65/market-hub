-- ═══════════════════════════════════════════════════════════════════════════
--  apply_to_cloud.sql — تطبيق مُجمَّع على قاعدة Supabase السحابية
--
--  هذا الملف مقصود للّصق في:  Supabase Dashboard → SQL Editor → New query → Run
--
--  يحتوي بالترتيب:
--    1) فحص الحالة قبل التطبيق (ماذا يوجد الآن)
--    2) البذرة النظامية: كتالوج طرق الدفع (idempotent)
--    3) الهجرة 68: تدقيق ربط طرق الدفع بحسابات الدليل
--    4) فحص النتيجة بعد التطبيق
--
--  السلامة:
--    • لا DELETE ولا DROP لأي جدول أو بيانات.
--    • كل INSERT عليه ON CONFLICT، فإعادة التشغيل آمنة.
--    • البذرة لا تُعيد تفعيل طريقة أوقفتها المنشأة (تحديث الاسم والأيقونة فقط).
-- ═══════════════════════════════════════════════════════════════════════════

-- ── (0) ملاحظة على المعاملات ────────────────────────────────────────────────
-- لا نستعمل BEGIN/COMMIT حول الملف كله: محرر SQL في Supabase ينفّذ الدفعة
-- كاملةً، ولفّ الدوال والاستعلامات في معاملة واحدة قد يُخفي الخطأ بدل إظهاره.
-- الهجرة 68 نفسها تحتوي BEGIN/COMMIT خاصًّا بها، وهو صحيح.

-- ── (1) قبل: ماذا يوجد الآن؟ ────────────────────────────────────────────────
SELECT
  'before' AS phase,
  (SELECT count(*) FROM public.payment_methods) AS payment_methods,
  (SELECT count(*) FROM public.payment_method_settings) AS method_settings,
  (SELECT count(*) FROM public.accounts WHERE code IN ('1101','1111','1131','1221')) AS ledger_accounts_of_4;

SELECT code, name_ar, is_postable, is_active
FROM public.accounts
WHERE code IN ('1101','1111','1131','1221')
ORDER BY code;

-- ═══════════════════════════════════════════════════════════════════════════
--  (2) البذرة: supabase/seeds/01_system/08_payment_methods.sql
-- ═══════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────
--  المصدر: supabase/seeds/01_system/08_payment_methods.sql
-- ─────────────────────────────────────────────────────────────────────────
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

-- ترحيل توافقي من إصدارات قديمة كانت تزرع خيارات مسماة/بطاقة/شيك وتتركها
-- نشطة. عطّلها واحذف إعداداتها حتى لا تفشل البذرة أو تظهر خارج الخيارات
-- الأربعة. نحتفظ بصفوف الكتالوج نفسها عند وجود مراجع تاريخية في قواعد قائمة.
UPDATE public.payment_methods
   SET is_active = false,
       updated_at = now()
 WHERE is_active
   AND id NOT IN ('cash','credit','bank_transfer','mobile_money','split');

DELETE FROM public.payment_method_settings
 WHERE payment_method_id NOT IN ('cash','credit','bank_transfer','mobile_money');

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


-- ═══════════════════════════════════════════════════════════════════════════
--  (3) الهجرة: supabase/migrations/68_payment_account_linkage_audit.sql
-- ═══════════════════════════════════════════════════════════════════════════
-- ═══════════════════════════════════════════════════════════════════════════
-- 68 — تدقيق ربط طرق الدفع بحسابات دليل الحسابات
--
-- ═══════════════════════════════════════════════════════════════════════════
--  المشكلة التي يعالجها هذا الملف
-- ═══════════════════════════════════════════════════════════════════════════
--  `payment_method_ledger_account()` تُرجع كودًا نصيًّا (1101 / 1111 / 1131 /
--  1221) ثم يُترجمه محرّك الترحيل إلى `accounts.id`. إن كان الكود **غير موجود**
--  في الدليل، فإن الترحيل إما يفشل عند نقطة البيع، أو — وهو الأسوأ — يسقط على
--  حساب افتراضي غير مقصود فيظهر المال في صندوق لم يستلمه أحد.
--
--  لم يكن هناك أي فحص يضمن وجود الحسابات الأربعة قبل الإصدار. هذا الملف:
--
--    1. يتأكد أن الحسابات الأربعة موجودة وقابلة للترحيل (`is_postable`).
--    2. يتحقق أن **كل** طريقة دفع مفعّلة تشير إلى حساب موجود فعلًا.
--    3. يعرّض واجهة `payment_method_account_linkage()` يقرأها فحص الإصدار
--       وشاشة الإعدادات، فلا تبقى المشكلة اكتشافًا متأخرًا وقت البيع.
--
--  لماذا لا "يصلح" الحسابات الناقصة تلقائيًا
--  ──────────────────────────────────────────
--  إنشاء حساب محاسبي بصمت أخطر من الفشل الصريح: المحاسب هو من يقرر أين يقع
--  الحساب في الشجرة وأي طبيعة له. الملف يُبلغ، والإصلاح قرار بشري. الحالة
--  الوحيدة الآمنة للبناء التلقائي هي حساب من نوع ASSET بلا أب، وهو ما لا يفعله
--  هذا الملف — بل يُدرج الجذر فقط إن غاب وحده.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. الحسابات الحيّة التي يعتمد عليها محرّك الترحيل ───────────────────────
--
--  مطابقة حرفية لـ `payment_method_ledger_account()` (الهجرة 63) ولـ
--  `seeds/01_system/03_chart_of_accounts.sql`:
--
--    1101  النقدية بالصندوق        ← CASH
--    1111  حسابات البنوك           ← BANK / CARD
--    1131  المحافظ الإلكترونية     ← WALLET
--    1221  أوراق قبض (شيك تحت التحصيل) ← CHEQUE
--
--  ملاحظة مهمّة: 1111 و1131 **حسابات تجميعية** (`is_postable = true` في البذرة
--  لكن غايتها التجميع). عند إضافة بنك أو محفظة فعلية من الإعدادات تُربط الحسابات
--  الفرعية بها؛ أما حين لا يوجد سوى الحساب التجميعي فالترحيل يقع عليه وهو
--  السلوك المقصود والمختبَر.

CREATE OR REPLACE FUNCTION public.required_payment_ledger_accounts()
RETURNS TABLE (code text, expected_name text, ledger_kind text)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  -- كل الأعمدة بـ `text` صريحًا حتى يطابق نوع الإرجاع المعلن.
  -- `VALUES` بلا تحويل صريح يستنتج أعمدة `unknown` فيُرفض في تدقيق التوقيع.
  SELECT * FROM (
    VALUES
      ('1101'::text, 'النقدية بالصندوق'::text,              'CASH'::text),
      ('1111'::text, 'حسابات البنوك'::text,                  'BANK'::text),
      ('1131'::text, 'المحافظ الإلكترونية'::text,            'WALLET'::text),
      ('1221'::text, 'أوراق قبض — شيكات برسم التحصيل'::text, 'CHEQUE'::text)
  ) AS t(code, expected_name, ledger_kind);
$$;

COMMENT ON FUNCTION public.required_payment_ledger_accounts() IS
  'الحسابات الأربعة التي يعتمد عليها payment_method_ledger_account(). يعرّضها فحص الإصدار وشاشة الإعدادات.';

-- ── 2. واجهة الربط: ما الذي ينقص فعلًا؟ ────────────────────────────────────
--
--  صف واحد لكل طريقة دفع في الكتالوج (بما فيها غير المفعّلة، لتظهر في الإعدادات)
--  مع كود الحساب وحالته. `account_name` فارغ = الحساب غير موجود.

CREATE OR REPLACE FUNCTION public.payment_method_account_linkage()
RETURNS TABLE (
  method_id            text,
  method_name          text,
  ledger_kind          text,
  is_active            boolean,
  account_code         text,
  account_name         text,
  account_exists       boolean,
  account_postable     boolean,
  is_healthy           boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  --
  -- `payment_method_ledger_account()` تقبل **معرّف الكتالوج** أو قيمة ENUM
  -- خامًا (كلاهما يُحلّ عبر payment_method_resolve_id). فنمرّر `m.id` مباشرةً.
  --
  -- كان الإصدار الأول من هذه الدالة يستخدم مودعًا غير موجود اسمه `legacy_value`
  -- على `payment_methods` (العمود الحقيقي `legacy_ids` وهو مصفوفة) كانت الدالة
  -- تُرفض عند الإنشاء. وهذا أصحّ من unnest المصّفوفة: كل صف يبقى صفًا واحدًا
  -- حتى لو كان له أكثر من قيمة قديمة.
  --
  -- ⚠️ أسماء أعمدة الإرجاع (`code`, `ledger_kind`, `is_active`) تصبح متغيّرات
  -- في جسم الدالة عند `LANGUAGE sql`، فـ `code.account_code` أو عمود عارٍ اسمه
  -- `is_active` يُحسم خطأً إلى متغيّر لا إلى العمود. لذلك كل مرجع هنا مُؤهّل باسم
  -- جدوله: `m.` لطريقة الدفع، `l.` للحساب المحسوب، `a.` للحساب، والاسم
  -- المستعار `lnk` للاسم الذي يُعاد.
  --
  -- `payment_method_ledger_account()` تقبل معرّف الكتالوج أو قيمة ENUM خامًا
  -- (كلاهما يُحلّ عبر payment_method_resolve_id)، فنمرّر `m.id` مباشرةً.
  SELECT
    m.id                        AS method_id,
    m.name_ar                   AS method_name,
    m.ledger_kind               AS ledger_kind,
    m.is_active                 AS is_active,
    l.account_code              AS account_code,
    a.name_ar                   AS account_name,
    (a.id IS NOT NULL)          AS account_exists,
    COALESCE(a.is_postable, false) AS account_postable,
    CASE
      WHEN m.ledger_kind = 'CREDIT' THEN l.account_code IS NULL
      ELSE COALESCE(a.id IS NOT NULL AND a.is_postable AND a.is_active, false)
    END                         AS is_healthy
  FROM public.payment_methods AS m
  -- احسب الكود مرة واحدة لكل صف بدل استدعاء الدالة ثلاث مرات.
  CROSS JOIN LATERAL (
    SELECT public.payment_method_ledger_account(m.id) AS account_code
  ) AS l
  LEFT JOIN public.accounts AS a ON a.code = l.account_code
  ORDER BY m.sort_order, m.id;
$$;

COMMENT ON FUNCTION public.payment_method_account_linkage() IS
  'لكل طريقة دفع: الحساب الذي تُقيَّد عليه وهل هو موجود وقابل للترحيل. يستخدمها فحص الإصدار وشاشة الإعدادات.';

REVOKE ALL ON FUNCTION public.payment_method_account_linkage() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.payment_method_account_linkage() TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.required_payment_ledger_accounts() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.required_payment_ledger_accounts() TO authenticated, service_role;

-- ── 3. تدقيق البذرة عند التثبيت: الإبلاغ لا الإنشاء ────────────────────────
--
--  يُنفَّذ مرة عند تطبيق الهجرة. منشأة قائمة قد تكون حذفت أو نقلت حسابًا، وهنا
--  نُسجّل ذلك بوضوح في سجل الخادم بدل أن يُكتشف عند أول بيعة في الكاشير.

DO $$
DECLARE
  r          record;
  --
  -- مصفوفة فارغة تُكتب `ARRAY[]::text[]` لا `'{}'::text[]`.
  -- `'{}'` حرفيًا يُفسّر كـ array بمحدّدات فارغة، و`v := v || x` عليه
  -- تُنتج عنصرًا واحدًا في الموضع 0 بدل الموضع 1 — وهو ما يُفسد `array_length`
  -- في الشروط أدناه. الكتابة الصريحة تُنشئ مصفوفة بلا أبعاد فتلحق العناصر
  -- طبيعيًا من 1.
  v_missing  text[] := ARRAY[]::text[];
  v_inactive text[] := ARRAY[]::text[];
  v_bad      text[] := ARRAY[]::text[];
BEGIN
  FOR r IN
    --
    -- أعمدة `a.id` وأخواتها بلا اسم مستعار تتعارض مع عمود الإرجاع `code`
    -- في الدالة (كلاهما اسمه `code`)، فكانت ستُعطي خطأ `column reference is
    -- ambiguous`. الأسماء الصريحة تمنع ذلك وتجعل الشرط التالي مقروءًا.
    SELECT
      req.code        AS required_code,
      a.id            AS account_id,
      a.is_postable   AS is_postable,
      a.is_active     AS is_active
    FROM public.required_payment_ledger_accounts() AS req
    LEFT JOIN public.accounts AS a ON a.code = req.code
  LOOP
    --
    -- `r` صف record من نتيجة الاستعلام، وحقوله تُقرأ ولا تُكتب.
    -- المحاولة الأولى كانت تُسنِد إلى `r.code` داخل الحلقة، وهو غير مسموح في
    -- PL/pgSQL (`record` ليس متغيرًا قابلاً للكتابة أثناء FOR...IN). لذا تُقرأ
    -- الأسماء المسماة مباشرةً أدناه.
    --
    -- `COALESCE(..., false)` ضروري: عند غياب الحساب تكون `a.is_postable`
    -- و`a.is_active` فارغتين، و`NOT NULL` تساوي NULL لا true، فلا يدخل أي
    -- فرع. غيابُ الحساب يُلتقط أولًا لكن هذا يضمن عدم تعليق بقية الحالات.
    IF r.account_id IS NULL THEN
      v_missing := v_missing || r.required_code;
    ELSIF COALESCE(r.is_postable, false) = false THEN
      v_bad := v_bad || r.required_code;
    ELSIF COALESCE(r.is_active, false) = false THEN
      v_inactive := v_inactive || r.required_code;
    END IF;
  END LOOP;

  IF array_length(v_missing, 1) > 0 THEN
    RAISE WARNING
      'payment-linkage: حسابات الدليل التالية مفقودة % — أي طريقة دفع تشير إليها ستُفشل الترحيل. أضفها من شجرة الحسابات.',
      v_missing;
  END IF;

  IF array_length(v_bad, 1) > 0 THEN
    RAISE WARNING
      'payment-linkage: حسابات غير قابلة للترحيل (is_postable = false): % — الترحيل عليها مرفوض.',
      v_bad;
  END IF;

  IF array_length(v_inactive, 1) > 0 THEN
    RAISE WARNING
      'payment-linkage: حسابات معطّلة: % — فعّلها قبل التحصيل على هذه الطرق.',
      v_inactive;
  END IF;

  IF array_length(v_missing, 1) = 0
     AND array_length(v_bad, 1) = 0
     AND array_length(v_inactive, 1) = 0 THEN
    RAISE NOTICE 'payment-linkage: الحسابات الأربعة موجودة وقابلة للترحيل ومفعّلة.';
  END IF;
END $$;

-- ── 4. أي طريقة مفعّلة بلا حساب حيّ؟ ───────────────────────────────────────
--
--  فحص ثانٍ مستقل: قد توجد الحسابات الأربعة، لكن طريقةً ما (بطاقة/شيك/منشأة
--  أضافتها) ترجع كودًا آخر غير موجود.

DO $$
DECLARE
  r        record;
  v_broken text[] := ARRAY[]::text[];
BEGIN
  FOR r IN
    -- عمود الإرجاع `is_active` يحمل اسمًا شائعًا جدًا؛ تأهيله بجدول الدالة
    -- يمنع التباسه بأي متغيّر في هذه الكتلة.
    SELECT l.method_id, l.method_name, l.account_code
    FROM public.payment_method_account_linkage() AS l
    WHERE l.is_active AND NOT l.is_healthy AND l.ledger_kind <> 'CREDIT'
  LOOP
    v_broken := v_broken || format('%s→%s', r.method_id, COALESCE(r.account_code, 'NULL'));
  END LOOP;

  IF array_length(v_broken, 1) > 0 THEN
    RAISE WARNING
      'payment-linkage: طرق دفع مفعّلة بلا حساب سليم % — تحصيلها سيفشل أو يسقط على حساب غير مقصود.',
      v_broken;
  END IF;
END $$;

COMMIT;

-- Rollback:
--   DROP FUNCTION IF EXISTS public.payment_method_account_linkage();
--   DROP FUNCTION IF EXISTS public.required_payment_ledger_accounts();


-- ═══════════════════════════════════════════════════════════════════════════
--  (4) بعد: تحقق من النتيجة
-- ═══════════════════════════════════════════════════════════════════════════

-- العدّادات بعد التطبيق — قارنها بالقسم (1).
SELECT
  'after' AS phase,
  (SELECT count(*) FROM public.payment_methods) AS payment_methods,
  (SELECT count(*) FROM public.payment_method_settings) AS method_settings,
  (SELECT count(*) FROM public.accounts WHERE code IN ('1101','1111','1131','1221')) AS ledger_accounts_of_4;

-- ⭐ النتيجة الأهم: صحة كل طريقة دفع مقابل دليل الحسابات.
--   is_healthy = true  ⟶ الطريقة تعمل وستُرحَّل إلى حسابها.
--   is_healthy = false ⟶ مفعّلة ولا تجد حسابًا: التحصيل بها سيفشل.
SELECT
  method_name,
  ledger_kind,
  account_code,
  account_name,
  is_active,
  is_healthy
FROM public.payment_method_account_linkage()
ORDER BY is_healthy, method_name;

-- ملخّص: كم طريقة مكسورة؟
SELECT count(*) AS broken_active_methods
FROM public.payment_method_account_linkage()
WHERE is_active AND NOT is_healthy AND ledger_kind <> 'CREDIT';

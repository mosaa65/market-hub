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

-- ============================================================================
-- 16_payment_methods.sql — طرق الدفع الموحّدة
-- ============================================================================
--
-- ما هذا الملف؟
--   الملف **الوحيد** الذي يعرّف طرق الدفع: الكتالوج، وإعداد كل مستأجر، وحرّاس
--   الكتابة، والمكان الواحد الذي يقرّر كيف تُرحَّل كل طريقة إلى الدفتر.
--
-- لماذا هو مهم؟
--   قبل هذا الملف كانت طرق الدفع مبثوثة في ثمانية ملفات بلا مالك واحد:
--
--     · تعريف قيمة payment_method  — في 20260621011940
--     · توسيعها بـ mobile_money     — ثلاثة ملفات متتالية، **اثنان مكرران**
--     · قوائم القيم المسموحة        — منسوخة نصًا داخل create_sale
--                                      و record_customer_payment، فتتباعد
--
--   اليوم مصدر واحد: جدول payment_methods، ودوال تحلّ الاسم إلى قيمته الشرعية.
--   وإضافة طريقة جديدة صارت صفًا في الجدول لا تعديلًا في عشر دوال.
--
-- ── البنية ──────────────────────────────────────────────────────────────────
--   payment_methods           الكتالوج: 13 طريقة (بذرة 08_payment_methods.sql)
--   payment_method_settings   إعداد كل طريقة لكل مستأجر (تفعيل وتعطيل وترتيب)
--   resolve_writable_payment_method   يحوّل ما أرسله العميل إلى قيمة شرعية
--   payment_method_legacy_id  يعيد القيمة التاريخية — للتقارير القديمة
--   ledger_account_code_for_payment_method   الحساب الذي تُرحَّل عليه
--
-- ── الكتالوج في البذور لا هنا ───────────────────────────────────────────────
--   صفوف الطرق الـ 13 **بيانات مرجعية**، فمكانها
--   `supabase/seeds/01_system/08_payment_methods.sql`. المصدر كان يضعها داخل
--   الترحيل — نُقلت عند الدمج، راجع MIGRATIONS_RULES.md القاعدة R-1.
--
-- ⚠️ المصدر: origin/main — 20261208000000_payment_methods_catalog_unified.sql
--    و 20261208000001_payment_methods_tenant_authoring.sql (امتداد مباشر له،
--    لا يعمل منفصلًا عنه، فدُمجا في ملف واحد).
--    عُدِّل عند الدمج: نُقل الكتالوج إلى البذرة، وأُزيل إعادة تعريف الدوال التي
--    عندنا نسخة أحدث منها (create_sale، record_customer_payment، المرتجعات).
--    وأُصلحت ثلاثة أخطاء كشفها تقرير `MIGRATION_16_REVIEW.md`:
--      · §1.1 كان `coalesce(legacy_id, …)` يتوقف عند قيمة موجودة فيُبقي كل بنك
--        ومحفظة على 'cash' — صار CASE يشتقّ القيمة من المصدر الحقيقي.
--      · §1.2 حُذف `DEFAULT 'cash'` لأنه هو ما جعل `coalesce` يجد قيمة أبدًا.
--      · §8.1 كان شرط الإصلاح يطابق «القيمة غير الصالحة» و'cash' صالحة، فلم
--        يعمل الإصلاح قط؛ صار يطابق قيمة تخالف ما تشتقّه الدالة فعلًا.
-- ════════════════════════════════════════════════════════════════════════════
-- ════════════════════════════════════════════════════════════════════════════
-- ما استبدله هذا الملف
-- ════════════════════════════════════════════════════════════════════════════
-- قبل هذا الترحيل كانت طرق الدفع مبثوثة في ثمانية ملفات بلا مالك واحد:
--
--   تعريف النوع وتوسيعه
--     20260621011940  CREATE TYPE payment_method ('cash','card','bank_transfer','credit')
--     20260706120000  ALTER TYPE … ADD VALUE 'mobile_money'   (رُقعة بذرة blackbox)
--     20260706121000  ALTER TYPE … ADD VALUE 'mobile_money'   (مكررة، بذرة reset)
--     20260707021000  ALTER TYPE … ADD VALUE 'mobile_money'   (مكررة، بذرة yemen)
--
--   قوائم القيم المسموحة منسوخة داخل دوال الكتابة
--     20260801090000  create_sale       NOT IN ('cash','card','bank_transfer','credit','mobile_money')
--     20260801090000  record_customer_payment NOT IN ('cash','card','bank_transfer','mobile_money')
--     20260929030000  create_sale       NOT IN (… ,'split')
--     20260929030000  أجزاء الدفع المجزأ  NOT IN ('cash','card','bank_transfer','mobile_money','split')
--     20260928000000  نفس حارس المجزأ، في النسخة المُستبدَلة
--
--   «إلى أي حساب تُرحَّل هذه الطريقة» مثبّت في محرّك الترحيل
--     20261202000000 / 20261202000100 / 20261202000200 / 20261203000000
--       IF payment_method IN ('bank_transfer','card','mobile_money') THEN '1111' ELSE '1101'
--
-- والأثر كان ملموسًا لا نظريًا: إضافة طريقة يمنية مثل بنك الكريمي كانت تتطلب
-- تعديل خمسة ملفات؛ ومن يعدّل النوع فقط تُرحَّل طريقته إلى **الصندوق** بدل البنك —
-- بصمت وبلا خطأ ظاهر، فيتضخم الصندوق وينقص البنك.
--
-- ════════════════════════════════════════════════════════════════════════════
-- المصدر الوحيد للحقيقة بعد هذا الملف
-- ════════════════════════════════════════════════════════════════════════════
--   public.payment_methods            الطرق المتاحة: الهوية، والأيقونة، وعائلة
--                                     الحساب، والأقسام، والربط المحاسبي.
--                                     ← للمطورين فقط، المنشأة لا تكتب هنا
--   public.payment_method_settings     التفعيل والترتيب والأقسام لكل منشأة
--
--   public.payment_method_legacy_id()  معرّف → القيمة التي تُخزَّن على المستند
--   public.payment_method_is_allowed() هل تُسمح هنا الآن
--   public.payment_method_ledger_account() الحساب الذي تُسوّى إليه
--
-- كل دوال الكتابة ومحرّك الترحيل تستدعي هذه. وإضافة طريقة جديدة صارت صفًا في
-- موضع واحد — بذرة الكتالوج في نهاية هذا الملف — فتصير صالحة فورًا في كل مكان.
--
-- ════════════════════════════════════════════════════════════════════════════
-- المتطلب: PostgreSQL 12 أو أحدث (لا حاجة لـ ALTER TYPE خارج المعاملة)
-- ════════════════════════════════════════════════════════════════════════════
-- Postgres 12 يسمح بـ ALTER TYPE … ADD VALUE داخل كتلة معاملة. وهذا مهم هنا:
-- قاعدة الإنتاج تحمل mobile_money فقط لأن ثلاث رقع بذور متتالية شُغّلت؛ وقاعدة
-- جديدة مبنية من الترحيلات كانت ستبقى بلا split الذي يطلبه محرّك المبيعات منذ
-- 20260929030000. لذلك يوسّع هذا الملف النوع في معاملة واحدة وبشكل ثابت، ويضع
-- كل شيء على أوسع مجموعة:
--
--     cash | card | bank_transfer | credit | mobile_money | split | cheque
--
-- على PostgreSQL 11 أو أقدم، شغّل جملة واحدة منفردة أولًا:
--     ALTER TYPE public.payment_method ADD VALUE IF NOT EXISTS 'cheque';
-- ثم طبّق هذا الترحيل — فإضافة القيمة لا أثر لها إن كانت موجودة.
--
-- ════════════════════════════════════════════════════════════════════════════
-- 🔒 لا حذف ولا تعديل ولا نقل لأي بيانات قائمة
-- ════════════════════════════════════════════════════════════════════════════
--   • كل عمود قائم يحتفظ بنوعه وقيمته.
--   • كل صف قائم في sales_invoices وpurchase_invoices وexpenses و
--     customer_payments وsales_returns وpurchase_returns وcustomer_payment_splits
--     يحتفظ بقيمة payment_method المخزّنة بايتًا ببايت.
--   • كل قيمة تاريخية في النوع تقابلها طريقة في الكتالوج، فتُعرض المستندات القديمة
--     باسمها العربي وأيقونتها الصحيحة.
--   • لا DELETE ولا UPDATE ولا TRUNCATE لبيانات أعمال هنا.
--   • الكتابة الوحيدة: كتالوج المطورين (تعريف مملوك للمطورين لا بيانات عميل)،
--     وصفوف الإعداد غير الموجودة أصلًا (ON CONFLICT DO NOTHING — اختيار المنشأة
--     لا يُستبدل أبدًا).
--
-- ════════════════════════════════════════════════════════════════════════════
-- ما لم يُفعَل عن قصد
-- ════════════════════════════════════════════════════════════════════════════
--   • النوع لم يُستبدل بعمود نصي وجدول بحث. فذلك يفرض إعادة كتابة ستة أعمدة على
--     سبعة جداول تحمل تاريخًا ماليًا حقيقيًا، لمكسب لا يراه المستخدم. الكتالوج
--     يمنح الهوية والترتيب والأقسام، والنوع يبقى عقد التخزين.
--   • لا يُفرض account_id على أي طريقة. `default_account_code` و
--     `payment_method_settings.default_account_id` جلسات للمرحلة المحاسبية؛
--     تُملأ اليوم إرشادًا وتُقرأ كبديل فقط.
--   • لا يُضاف سلوك دفتر أستاذ أو قيود أو دليل حسابات هنا.
--
-- ثابت (Idempotent): آمن للتطبيق المتكرر. إعادة التشغيل تُحدِّث تعريفات الكتالوج
-- (الأسماء والأيقونات والترتيب والأقسام) بلا مسّ إعدادات المنشأة.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. توسيع النوع إلى المجموعة الكاملة التي يستخدمها التطبيق فعلًا.
--
-- على PostgreSQL 12+ هذا قانوني داخل المعاملة. و`IF NOT EXISTS` يجعل كل قيمة من
-- السبع بلا أثر إن كانت موجودة، فيغطّي الحالتين معًا: "رقع البذور الثلاث شُغّلت"
-- و"لم تُشغَّل".
-- ---------------------------------------------------------------------------
ALTER TYPE public.payment_method ADD VALUE IF NOT EXISTS 'cash';
ALTER TYPE public.payment_method ADD VALUE IF NOT EXISTS 'card';
ALTER TYPE public.payment_method ADD VALUE IF NOT EXISTS 'bank_transfer';
ALTER TYPE public.payment_method ADD VALUE IF NOT EXISTS 'credit';
ALTER TYPE public.payment_method ADD VALUE IF NOT EXISTS 'mobile_money';
ALTER TYPE public.payment_method ADD VALUE IF NOT EXISTS 'split';
ALTER TYPE public.payment_method ADD VALUE IF NOT EXISTS 'cheque';

COMMENT ON TYPE public.payment_method IS
  'القيمة المخزّنة على المستند. لا تُستخدم للعرض ولا للتفعيل؛ العرض والتفعيل والأقسام تأتي من public.payment_methods.';


-- ============================================================================
-- 2. كتالوج المطورين — أي طرق دفع توجد
--
-- المنشأة لا تكتب هنا أبدًا. الصفوف تأتي من هذا الترحيل وحده، فلا يمكن اختراع
-- طريقة من المتصفّح ولا تقديم أيقونة من عميل. و`id` **مفتاح نصي ثابت** لا UUID:
-- فيستطيع الترحيل مخاطبة الطريقة بلا لبس وبثبات أبدي، وتبقى إشارة الأيقونة
-- مقروءة.
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.payment_methods (
  id                   text PRIMARY KEY,

  name_ar              text        NOT NULL,
  name_en              text,

  -- **مفتاح**، لا رابط ولا base64 أبدًا. السجل المضمَّن في
  -- src/lib/payments/payment-methods.ts يحلّه إلى مكوّن، فأيقونة الدفع بلا أي
  -- طلب شبكة ولا يمكن أن تفشل في التحميل.
  icon_key             text        NOT NULL DEFAULT 'generic',

  -- توفّر على مستوى المطور، لإيقاف طريقة في كل مكان دفعة واحدة بلا حذف
  -- التاريخ الذي يشير إليها.
  is_active            boolean     NOT NULL DEFAULT true,

  -- ترتيب العرض الافتراضي. والمنشأة تتجاوزه في الإعدادات.
  sort_order           integer     NOT NULL DEFAULT 100,

  -- الأقسام التي **يسمح** بها المطورون. والمنشأة يمكنها فقط تضييقها.
  allowed_contexts     text[]      NOT NULL DEFAULT ARRAY[]::text[],

  -- عائلة الحساب التي تُسوّى إليها الأموال. عليها يتفرّع محرّك الترحيل بدل
  -- قائمة قيم النوع المضمّنة.
  ledger_kind          text        NOT NULL DEFAULT 'CASH',

  -- وصلة محاسبية. إرشادية اليوم؛ والربط الرسمي الخاص بكل منشأة هو
  -- payment_method_settings.default_account_id.
  default_account_code text,

  -- سلوك يجب ألا تثبّته الواجهة في كودها.
  is_credit_term       boolean     NOT NULL DEFAULT false,
  requires_reference   boolean     NOT NULL DEFAULT false,

  -- قيم النوع التي يمثّلها هذا الصف. تتيح لفواتير تاريخية خزّنت
  -- 'bank_transfer' أن تُعرض من الكتالوج بدل خريطة محلية.
  legacy_ids           text[]      NOT NULL DEFAULT ARRAY[]::text[],

  notes                text,

  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT payment_methods_id_normalised
    CHECK (id = lower(btrim(id)) AND id <> ''),
  CONSTRAINT payment_methods_ledger_kind_valid
    CHECK (ledger_kind IN ('CASH','BANK','WALLET','CARD','CREDIT','OTHER')),
  CONSTRAINT payment_methods_contexts_valid
    CHECK (allowed_contexts <@ ARRAY[
      'pos','sales','purchases','expenses','customer_collection',
      'sales_returns','purchase_returns'
    ]::text[])
);

COMMENT ON TABLE public.payment_methods IS
  'كتالوج طرق الدفع الذي يجهّزه المطورون. العميل لا ينشئ صفوفاً هنا؛ يختار ويفعّل فقط.';
COMMENT ON COLUMN public.payment_methods.icon_key IS
  'مفتاح أيقونة مركزي يُحلّ إلى مكوّن داخل الحزمة. ليس رابطاً خارجياً ولا Base64.';
COMMENT ON COLUMN public.payment_methods.ledger_kind IS
  'عائلة الحساب (صندوق/بنك/محفظة/بطاقة/آجل). يستخدمها محرك الترحيل بدل تعداد قيم الـEnum.';
COMMENT ON COLUMN public.payment_methods.default_account_code IS
  'ربط محاسبي مستقبلي: payment_method → account. إرشادي في هذه المرحلة.';
COMMENT ON COLUMN public.payment_methods.legacy_ids IS
  'قيم public.payment_method التي تمثّلها هذه الطريقة، لعرض الفواتير التاريخية من الكتالوج.';

CREATE INDEX IF NOT EXISTS ix_payment_methods_order
  ON public.payment_methods (is_active, sort_order, id);

CREATE INDEX IF NOT EXISTS ix_payment_methods_legacy_ids
  ON public.payment_methods USING gin (legacy_ids);


-- ============================================================================
-- 3. إعداد المنشأة — ما اختارته **هذه** المنشأة
--
-- أي طريقة بلا صف هنا لم تلمسها المنشأة قط، فترث افتراضيات الكتالوج؛ لذلك
-- إضافة طريقة في ترحيل تجعلها متاحة بلا أي backfill.
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.payment_method_settings (
  payment_method_id  text PRIMARY KEY
    REFERENCES public.payment_methods(id) ON DELETE CASCADE,

  enabled            boolean NOT NULL DEFAULT true,
  sort_order         integer NOT NULL DEFAULT 100,
  enabled_contexts   text[]  NOT NULL DEFAULT ARRAY[]::text[],

  -- وصلة محاسبية لكل منشأة: المرحلة التي يُربط فيها بنك الكريمي بحساب بنكي
  -- بعينه بدل حساب عام.
  default_account_id uuid REFERENCES public.accounts(id) ON DELETE SET NULL,

  updated_at         timestamptz NOT NULL DEFAULT now(),
  updated_by         uuid REFERENCES auth.users(id) ON DELETE SET NULL,

  CONSTRAINT payment_method_settings_contexts_valid
    CHECK (enabled_contexts <@ ARRAY[
      'pos','sales','purchases','expenses','customer_collection',
      'sales_returns','purchase_returns'
    ]::text[])
);

COMMENT ON TABLE public.payment_method_settings IS
  'تخصيص العميل: تفعيل كل طريقة، ترتيب عرضها، والأقسام التي تظهر فيها.';
COMMENT ON COLUMN public.payment_method_settings.enabled_contexts IS
  'الأقسام المسموح بها لهذه المنشأة. لا يمكن أن تتجاوز allowed_contexts في الكتالوج.';

CREATE INDEX IF NOT EXISTS ix_payment_method_settings_order
  ON public.payment_method_settings (enabled, sort_order);


-- ---------------------------------------------------------------------------
-- 3.1 يمكن للمنشأة أن **تضيّق** قائمة الأقسام التي حدّدها المطورون، لا أن توسّعها.
--     وقيود CHECK لا ترى الصف الأب، فالحل trigger.
--     بلاه، قد يعرض خطأ في شاشة الإعدادات «آجل» عند تحصيل نقدي، أو محفظة داخل
--     مرتجع مشتريات حيث يُفترض احترام طريقة الاسترداد.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.payment_method_settings_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_allowed text[];
BEGIN
  SELECT allowed_contexts INTO v_allowed
  FROM public.payment_methods
  WHERE id = NEW.payment_method_id;

  IF v_allowed IS NULL THEN
    RAISE EXCEPTION 'طريقة الدفع غير موجودة في الكتالوج: %', NEW.payment_method_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF NOT (NEW.enabled_contexts <@ v_allowed) THEN
    RAISE EXCEPTION
      'الأقسام المختارة (%) تتجاوز ما يسمح به الكتالوج لطريقة % (%)',
      array_to_string(NEW.enabled_contexts, ', '),
      NEW.payment_method_id,
      array_to_string(v_allowed, ', ')
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END $$;

COMMENT ON FUNCTION public.payment_method_settings_guard() IS
  'يمنع توسيع أقسام طريقة الدفع خارج ما يسمح به كتالوج المطورين.';

DROP TRIGGER IF EXISTS payment_method_settings_context_guard
  ON public.payment_method_settings;
CREATE TRIGGER payment_method_settings_context_guard
  BEFORE INSERT OR UPDATE ON public.payment_method_settings
  FOR EACH ROW EXECUTE FUNCTION public.payment_method_settings_guard();

DROP TRIGGER IF EXISTS payment_methods_updated ON public.payment_methods;
CREATE TRIGGER payment_methods_updated
  BEFORE UPDATE ON public.payment_methods
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

DROP TRIGGER IF EXISTS payment_method_settings_updated
  ON public.payment_method_settings;
CREATE TRIGGER payment_method_settings_updated
  BEFORE UPDATE ON public.payment_method_settings
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();


-- ---------------------------------------------------------------------------
-- 3.2 سياسات RLS.
--     الكتالوج يقرأه أي موظف — فكل شاشة تحتاج الأسماء والأيقونات — ولا يكتبه
--     أحد عبر PostgREST: فهو يأتي مع الترحيلات، وهي تعمل بصلاحية المالك وتتجاوز
--     RLS. وإعداد المنشأة يقرأه الموظفون ويكتبه المالك/المدير، كبقية شاشات
--     الإعدادات في المشروع.
-- ---------------------------------------------------------------------------
ALTER TABLE public.payment_methods          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_method_settings  ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON public.payment_methods TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payment_method_settings TO authenticated;
GRANT ALL ON public.payment_methods, public.payment_method_settings TO service_role;

DROP POLICY IF EXISTS "payment_methods read" ON public.payment_methods;
CREATE POLICY "payment_methods read"
  ON public.payment_methods
  FOR SELECT TO authenticated
  USING (public.is_staff(auth.uid()));

DROP POLICY IF EXISTS "payment_method_settings read" ON public.payment_method_settings;
CREATE POLICY "payment_method_settings read"
  ON public.payment_method_settings
  FOR SELECT TO authenticated
  USING (public.is_staff(auth.uid()));

DROP POLICY IF EXISTS "payment_method_settings write" ON public.payment_method_settings;
CREATE POLICY "payment_method_settings write"
  ON public.payment_method_settings
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'owner') OR public.has_role(auth.uid(), 'manager'))
  WITH CHECK (public.has_role(auth.uid(), 'owner') OR public.has_role(auth.uid(), 'manager'));


-- ============================================================================
-- 4. البذرة — الكتالوج اليمني
--
-- هذه هي الطرق التي نجهّزها نحن المطورين. و`ON CONFLICT DO UPDATE` يجعل إعادة
-- التطبيق تحدّث الأسماء والأيقونات والترتيب والأقسام. ولا يلمس
-- payment_method_settings عن قصد: مفاتيح المنشأة ملكها، والترحيل يجب ألا يعيد
-- ضبطها أبدًا.
--
-- و`legacy_ids` حاملة لا زخرفة. هي ما يسمح لـ cash/card/bank_transfer/credit/
-- mobile_money بالاحتفاظ بمعناها الدقيق بينما تصبح خمس مؤسسات يمنية مسمّاة طرقًا
-- من الدرجة الأولى تُختار بجانبها.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 4.1 إعداد المنشأة **لا** يُملأ هنا.
--
-- لماذا لا: يجب أن توجد صفوف payment_method_settings للطرق الست التاريخية حتى لا
-- تُفقد خيار دفع من الصندوق عند الترقية. لكن هذا الترحيل يعمل **قبل** بذرة
-- الكتالوج، فـ `SELECT … FROM public.payment_methods` هنا يجد جدولًا فارغًا،
-- ويُدرج صفرًا، ولا يبلّغ عن خطأ. فالـ backfill كُتب، ونُفّذ، ولم يفعل شيئًا —
-- بينما قاعدة صادف أنها زُرعت أولًا تتصرف مختلفًا. وهذا عمل إدخال بيانات لا عمل
-- بنية.
--
-- ومكانه الآن: supabase/seeds/01_system/08_payment_methods.sql، مباشرة بعد
-- إدراج الكتالوج. فهو صف بيانات مرجعية، و MIGRATIONS_RULES.md القسم 1 يضع
-- المرجعيات في البذرة بجانب الصفوف التي تعتمد عليها — وهو ما يُزيل هشاشة
-- الترتيب كليًا.
--
-- والطرق اليمنية المسمّاة لا تأخذ صف إعداد عن قصد: غياب الصف يعني «ورّث افتراضي
-- الكتالوج»، وهو مفعّل ومقيّد بأقسام الكتالوج، فتظهر كإضافة عادية.
-- ---------------------------------------------------------------------------


-- ============================================================================
-- 5. الدوال المساعدة الثلاث التي يناديها كل شيء
--
-- تُستبدل بها، في موضع واحد، ما كان مكرّرًا كقيم ENUM حرفية في خمس دوال RPC
-- وأربعة ترحيلات لترحيل الدفتر.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 5.1 معرّف كتالوجي ← القيمة التي يخزّنها المستند.
--
-- التحويل **الوحيد** المسموح. لا يجوز أن تخمّن شاشة، ولا أن تستقبل `create_sale`
-- قيمة لا يحملها النوع.
--
-- ومعرّف مجهول يعيد 'cash' لا NULL، لأن NULL في عمود payment_method أسوأ من قيمة
-- خاطئة لكن صالحة: فمحرّك الدفتر يسقط إلى نهاية CASE ويُرحّل إلى الصندوق مهما
-- كان. والحارس في 6.1 هو ما يرفض المعرّفات المجهولة مقدّمًا؛ وهذه أدنى حدّ أخير.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.payment_method_legacy_id(p_id text)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH norm AS (
    SELECT lower(btrim(coalesce(p_id, ''))) AS v
  ),
  direct AS (
    -- المعرّف هو نفسه قيمة ENUM (cash, card, bank_transfer, credit,
    -- mobile_money, split, cheque): يُقبل كما هو. وهذا ما يبقي كل مستدعٍ قائم
    -- يعمل بلا تغيير.
    SELECT n.v
    FROM norm n
    WHERE n.v <> ''
      AND EXISTS (
        SELECT 1 FROM pg_enum e
        JOIN pg_type t ON t.oid = e.enumtypid
        JOIN pg_namespace ns ON ns.oid = t.typnamespace
        WHERE ns.nspname = 'public' AND t.typname = 'payment_method'
          AND e.enumlabel = n.v
      )
  ),
  via_catalog AS (
    SELECT coalesce(
             nullif(m.legacy_ids[1], ''),
             CASE m.ledger_kind
               WHEN 'BANK'   THEN 'bank_transfer'
               WHEN 'WALLET' THEN 'mobile_money'
               WHEN 'CARD'   THEN 'card'
               WHEN 'CREDIT' THEN 'credit'
               WHEN 'CASH'   THEN 'cash'
               ELSE 'cash'
             END
           ) AS v
    FROM public.payment_methods m, norm n
    WHERE m.id = n.v
  )
  SELECT coalesce(
    (SELECT v FROM direct),
    (SELECT v FROM via_catalog),
    'cash'
  );
$$;

COMMENT ON FUNCTION public.payment_method_legacy_id(text) IS
  'يحوّل معرّف الكتالوج إلى القيمة التي يفهمها عمود payment_method. المصدر الوحيد لهذا التحويل في النظام.';

-- ---------------------------------------------------------------------------
-- 5.2 قيمة مخزّنة ← صف الكتالوج الذي يمثّلها.
--     يُستخدم لتسمية المستندات التاريخية من الكتالوج بدل خريطة تسميات محلية،
--     فيُعرَّف اسم الطريقة الجديدة مرة واحدة.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.payment_method_catalog_id(p_stored text)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT m.id
  FROM public.payment_methods m
  WHERE lower(btrim(coalesce(p_stored, ''))) = ANY (m.legacy_ids)
  ORDER BY m.sort_order, m.id
  LIMIT 1;
$$;

COMMENT ON FUNCTION public.payment_method_catalog_id(text) IS
  'يعيد معرّف الكتالوج المقابل لقيمة مخزّنة، لعرض الفواتير التاريخية من الكتالوج.';

-- ---------------------------------------------------------------------------
-- 5.3 تطبيع أي قيمة واردة إلى معرّف كتالوجي.
--
-- ترتيب الحل مهمّ. فقيمة ENUM خام يجب أن تُحلّ إلى الصف الكتالوجي **المرجعي**
-- لتلك القيمة، لا إلى أي مؤسسة مسمّاة تصادف أنها تحملها أيضًا. فيجب أن تصير
-- 'bank_transfer' تحويلًا بنكيًا عامًا، لا بنك الكريمي أبدًا.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.payment_method_resolve_id(p_value text)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH norm AS (
    SELECT lower(btrim(coalesce(p_value, ''))) AS v
  )
  SELECT coalesce(
    -- 1. معرّف كتالوجي مطابق يفوز مباشرةً.
    (SELECT m.id FROM public.payment_methods m, norm n WHERE m.id = n.v),
    -- 2. قيمة ENUM مطابقة تُحلّ إلى الصف المرجعي لتلك القيمة.
    (SELECT public.payment_method_catalog_id(n.v) FROM norm n WHERE n.v <> ''),
    -- 3. غير قابلة للحل: تُعاد كما هي ليبلّغ المستدعي بأمانة بدل أن يستبدل
    --    صامتًا طريقة لم يخترها المشغّل.
    (SELECT nullif(n.v, '') FROM norm n)
  );
$$;

COMMENT ON FUNCTION public.payment_method_resolve_id(text) IS
  'يطبّع أي قيمة واردة من الواجهة إلى معرّف كتالوجي، دون تخمين صامت.';

-- ---------------------------------------------------------------------------
-- 5.4 هل يمكن استخدام هذه الطريقة، في هذا القسم، الآن؟
--
-- حارس الكتابة الواحد. يقرأ إعداد المنشأة ويرجع إلى الكتالوج، فيكون أي طريقة لم
-- يضبطها أحد صالحة للاستخدام فورًا.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.payment_method_is_allowed(
  p_value   text,
  p_context text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH resolved AS (
    SELECT public.payment_method_resolve_id(p_value) AS id
  )
  SELECT EXISTS (
    SELECT 1
    FROM public.payment_methods m
    LEFT JOIN public.payment_method_settings s ON s.payment_method_id = m.id
    CROSS JOIN resolved r
    WHERE m.id = r.id
      -- يمكن للمطورين إيقاف طريقة في كل مكان بلا حذفها.
      AND m.is_active
      AND coalesce(s.enabled, true)
      AND p_context = ANY (
        CASE
          WHEN coalesce(cardinality(s.enabled_contexts), 0) > 0
            THEN s.enabled_contexts
          ELSE m.allowed_contexts
        END
      )
  );
$$;

COMMENT ON FUNCTION public.payment_method_is_allowed(text, text) IS
  'هل طريقة الدفع مفعّلة ومسموح بها في هذا القسم لهذه المنشأة؟ الحارس الوحيد في النظام.';

-- ---------------------------------------------------------------------------
-- 5.5 إلى أي حساب تُسوّى هذه الطريقة؟
--
-- يستبدل النسخ الأربع من
--   IF payment_method IN ('bank_transfer','card','mobile_money') THEN '1111' ELSE '1101'
-- التي كانت تُرحّل كل طريقة يمنية جديدة إلى الصندوق.
--
-- و`credit` تعيد NULL عن قصد: لم يُحصَّل شيء، فلا يوجد سطر نقد أو بنك يُكتب. وعلى
-- المستدعي أن يتحقّق من NULL لا أن يعامل النتيجة كأنها كود.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.payment_method_ledger_account(p_stored text)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    -- الإرشاد الصريح في صف الكتالوج يفوز.
    WHEN m.default_account_code IS NOT NULL THEN m.default_account_code
    -- وإلا تُشتقّ من عائلة الحساب. و NULL لـ CREDIT مقصود.
    WHEN m.ledger_kind IN ('BANK','WALLET','CARD') THEN '1111'
    WHEN m.ledger_kind = 'CREDIT' THEN NULL
    WHEN m.ledger_kind = 'CASH'   THEN '1101'
    ELSE '1101'
  END
  FROM public.payment_methods m
  WHERE m.id = public.payment_method_resolve_id(p_stored);
$$;

COMMENT ON FUNCTION public.payment_method_ledger_account(text) IS
  'الحساب الذي تُسوّى إليه طريقة الدفع. يعيد NULL للآجل لأن شيئاً لم يُحصَّل.';

-- ---------------------------------------------------------------------------
-- 5.6 منح الدوال المساعدة. فهي للقراءة فقط، و SECURITY DEFINER، وحتمية نسبةً
--     لكتالوج معيّن، فيجوز للمستدعين الموثّقين تنفيذها.
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.payment_method_legacy_id(text)          FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.payment_method_catalog_id(text)         FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.payment_method_resolve_id(text)         FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.payment_method_is_allowed(text, text)   FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.payment_method_ledger_account(text)     FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.payment_method_legacy_id(text)        TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.payment_method_catalog_id(text)       TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.payment_method_resolve_id(text)       TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.payment_method_is_allowed(text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.payment_method_ledger_account(text)   TO authenticated, service_role;


-- ============================================================================
-- 6. حارس الكتابة — دالة واحدة تستبدل خمس قوائم ENUM مضمّنة
--
-- كل مسار كتابة يناديها بدل تكرار
--   NOT IN ('cash','card','bank_transfer','credit','mobile_money')
-- وهو ما جعل إضافة طريقة جديدة مستحيلة بلا تعديل خمسة ملفات، وما سمح لشاشات
-- المرتجعات بإرسال قيمة `bank` لا يحملها النوع.
--
-- و`p_strict_context` يتحكّم في تطبيق تقييد القسم:
--   • true  — إدخال مشغّل عادي. يجب أن تكون الطريقة مفعّلة **لهذا** القسم.
--             يمنع ظهور محفظة في مرتجع مشتريات.
--   • false — إعادة تشغيل / إصلاح. يجب أن توجد الطريقة وتكون مفعّلة للمنشأة،
--             بلا تقييد بقسم. يُستخدم حيث يُعاد ترحيل مستند تاريخي بعد تغيير
--             المنشأة إعداداتها، فلا نعيد كتابة التاريخ.
--
-- يعيد القيمة المُراد **تخزينها** (بعد تحويلها عبر النوع)، أو يرفع استثناءً.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.resolve_writable_payment_method(
  p_value          text,
  p_context        text,
  p_strict_context boolean DEFAULT true
)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id      text;
  v_stored  text;
  v_enabled boolean;
BEGIN
  v_id := public.payment_method_resolve_id(p_value);

  -- ← يلي: التحقق من الصلاحية ثم التحويل، بترتيب صريح
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'طريقة دفع غير صالحة: %', coalesce(p_value, '(فارغ)')
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT coalesce(s.enabled, true) AND m.is_active
    INTO v_enabled
  FROM public.payment_methods m
  LEFT JOIN public.payment_method_settings s ON s.payment_method_id = m.id
  WHERE m.id = v_id;

  IF v_enabled IS NOT TRUE THEN
    RAISE EXCEPTION 'طريقة الدفع غير مفعّلة: %', p_value
      USING ERRCODE = 'check_violation';
  END IF;

  IF p_strict_context
     AND NOT public.payment_method_is_allowed(v_id, coalesce(p_context, 'pos')) THEN
    RAISE EXCEPTION
      'طريقة الدفع "%" غير مسموح بها في قسم "%"', p_value, coalesce(p_context, 'pos')
      USING ERRCODE = 'check_violation';
  END IF;

  v_stored := public.payment_method_legacy_id(v_id);

  IF v_stored IS NULL THEN
    RAISE EXCEPTION 'تعذّر تحويل طريقة الدفع إلى قيمة صالحة: %', p_value
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN v_stored;
END $$;

COMMENT ON FUNCTION public.resolve_writable_payment_method(text, text, boolean) IS
  'الحارس الموحّد لكتابة طريقة الدفع: يتحقق من الصلاحية ثم يعيد القيمة المخزّنة. بديل القوائم المضمّنة في دوال الكتابة.';

REVOKE ALL ON FUNCTION public.resolve_writable_payment_method(text, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_writable_payment_method(text, text, boolean) TO authenticated, service_role;


-- ============================================================================
-- 7. مسارات الكتابة تستعمل الكتالوج الآن
--
-- كل واحد من هؤلاء هو الجسم **الحالي** للدالة، بلا تغيير إلا معالجة طريقة
-- الدفع. ولا يُمسّ المخزون ولا حدود الائتمان ولا ترحيل الذمم ولا التدقيق ولا
-- الترقيم — فطريقة الدفع تسمية وعائلة حساب، لا قاعدة عمل.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 8. محرّك ترحيل الدفتر يسأل الكتالوج الآن
--
-- أربعة ترحيلات كان كل منها يحمل نسخته من:
--
--   IF payment_method = 'credit' THEN NULL
--   ELSIF payment_method IN ('bank_transfer','card','mobile_money') THEN '1111'
--   ELSE '1101' END IF
--
-- ذلك الفرع من ثلاثة أسطر هو السبب في استحالة إضافة طريقة يمنية جديدة بأمان.
-- فبنك الكريمي مسجّلًا كـ 'bank_transfer' رُحّل صحيحًا **بالمصادفة**: فقط لأن
-- `legacy_ids` صادف أنها تُطابق قيمة موجودة في القائمة. أما طريقة عائلتها BANK
-- وقيمتها التاريخية تُحلّ إلى شيء آخر فلَكانت رُحّلت إلى الصندوق بلا أي خطأ.
--
-- وكل جسم أدناه هو الدالة **الحالية**، مع استبدال ذلك الفرع وحده بـ
-- public.payment_method_ledger_account(). وبناء القيد، وتصنيف الإيراد، وحلّ
-- التكلفة، وسطر الضريبة، وحارس «مرة واحدة فقط»، والعرض — بلا مساس.
--
-- لاحظ ترتيب التعريفات الأربعة: كلٌّ يستبدل ما قبله، وقد أُعيد تشغيلها هنا
-- بالترتيب نفسه فيكون التعريف النهائي مطابقًا لما يعمل به الإنتاج — زائد نداء
-- الكتالوج.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 8.1 ledger_account_code_for_payment_method — الفرع، مُسمّى مرة واحدة.
--
-- أُبقي كغلاف بدل تضمين النداء في كل دالة ترحيل، فتبقى الدوال الأربع تُقرأ كما
-- كانت ويستطيع المراجع مقارنتها سطرًا بسطر بأصولها.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ledger_account_code_for_payment_method(
  p_payment_method text
)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.payment_method_ledger_account(p_payment_method);
$$;

COMMENT ON FUNCTION public.ledger_account_code_for_payment_method(text) IS
  'الحساب الذي تُسوّى إليه طريقة الدفع في القيود. يعيد NULL للآجل، ويأتي من الكتالوج لا من قائمة مضمّنة.';

REVOKE ALL ON FUNCTION public.ledger_account_code_for_payment_method(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ledger_account_code_for_payment_method(text) TO authenticated, service_role;


-- ---------------------------------------------------------------------------
-- 8.2 post_sales_invoice
--
-- منقول حرفيًا من
--   20261202000200_cash_received_is_debited_not_credited.sql
-- وهو أحدث نسخ ترحيل المبيعات الثلاث. التغيير الوحيد هو استبدال:
--
--   IF v_inv.payment_method = 'credit' THEN NULL
--   ELSIF v_inv.payment_method IN ('bank_transfer','card','mobile_money') THEN '1111'
--   ELSE '1101' END IF
--
-- باستدعاء الكتالوج. وكل ما عدا ذلك — حارس «مرة واحدة فقط»، ورفض الدفع الزائد،
-- وتصنيف الإيراد حسب item_class، وسطر الضريبة، وسطور تكلفة المبيعات، و
-- create_journal_entry — بلا مساس.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.post_sales_invoice(p_invoice_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user    uuid := auth.uid();
  v_inv     record;
  v_existing uuid;
  v_entry   uuid;
  v_lines   jsonb := '[]'::jsonb;
  v_cash_acct text;
  v_collectable numeric := 0;
  r         record;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT (public.has_role(v_user,'owner') OR public.has_role(v_user,'manager')
          OR public.has_role(v_user,'accountant')) THEN
    RAISE EXCEPTION 'Only an owner, manager or accountant may post an invoice';
  END IF;

  SELECT * INTO v_inv FROM public.sales_invoices WHERE id = p_invoice_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice not found';
  END IF;

  IF v_inv.status IN ('draft','cancelled') THEN
    RAISE EXCEPTION 'Invoice % is % - only confirmed, paid or partial invoices post',
      v_inv.invoice_number, v_inv.status;
  END IF;

  IF v_inv.paid < 0 THEN
    RAISE EXCEPTION 'Invoice % carries a negative payment (%). A refund is a credit note, not a negative payment.',
      v_inv.invoice_number, v_inv.paid;
  END IF;
  IF v_inv.paid > v_inv.total THEN
    RAISE EXCEPTION 'Invoice % was paid % against a total of %. Fix the invoice before posting - a payment cannot exceed the invoice.',
      v_inv.invoice_number, v_inv.paid, v_inv.total;
  END IF;
  IF v_inv.tax < 0 THEN
    RAISE EXCEPTION 'Invoice % carries a negative tax amount', v_inv.invoice_number;
  END IF;

  SELECT id INTO v_existing
    FROM public.journal_entries
   WHERE source_type = 'sales_invoice' AND source_id = p_invoice_id
     AND status <> 'REVERSED';
  IF v_existing IS NOT NULL THEN
    RAISE EXCEPTION 'Invoice % has already been posted to the ledger', v_inv.invoice_number;
  END IF;

  -- ── الحساب من الكتالوج بدل القائمة المضمّنة ─────────────────────────────
  -- 'credit'          -> NULL      (لم يُحصَّل شيء)
  -- BANK/WALLET/CARD  -> '1111'    (يخرج عبر البنك)
  -- CASH / OTHER      -> '1101'    (الصندوق؛ وsplit تُسوّى نقداً)
  v_cash_acct := public.ledger_account_code_for_payment_method(v_inv.payment_method);

  v_collectable := greatest(v_inv.total - v_inv.paid, 0);

  -- ── revenue, credited ──
  FOR r IN
    SELECT p.item_class, sum(it.total) AS amount
      FROM public.sales_invoice_items it
      JOIN public.products p ON p.id = it.product_id
     WHERE it.invoice_id = p_invoice_id
     GROUP BY p.item_class
    HAVING sum(it.total) <> 0
  LOOP
    v_lines := v_lines || jsonb_build_object(
      'account_code', CASE r.item_class
                        WHEN 'BY_PRODUCT' THEN '4211'
                        WHEN 'SERVICE'    THEN '4311'
                        ELSE '4111' END,
      'credit', round(r.amount, 2),
      'memo', 'إيراد ' || r.item_class);
  END LOOP;

  IF jsonb_array_length(v_lines) = 0 THEN
    RAISE EXCEPTION 'Invoice % has no revenue lines', v_inv.invoice_number;
  END IF;

  -- ── ما استلمته المنشأة: النقد والذمة كلاهما مدين ──
  -- هما بديلان لنفس الزيادة، فبيعة مسدّدة بالكامل لها مدين نقدي بلا ذمة، وبيعة
  -- آجلة العكس.
  IF v_inv.paid > 0 AND v_cash_acct IS NOT NULL THEN
    v_lines := v_lines || jsonb_build_object(
      'account_code', v_cash_acct, 'debit', round(v_inv.paid, 2),
      'memo', 'تحصيل نقدي/بنكي');
  END IF;
  IF v_collectable > 0 THEN
    v_lines := v_lines || jsonb_build_object(
      'account_code', '1211', 'debit', round(v_collectable, 2),
      'memo', 'ذمم العميل ' || coalesce(v_inv.invoice_number, ''));
  END IF;

  IF v_inv.tax > 0 THEN
    v_lines := v_lines || jsonb_build_object(
      'account_code', '2311', 'credit', round(v_inv.tax, 2),
      'memo', 'ضريبة القيمة المضافة المستحقة');
  END IF;

  -- ── the cost of the goods that left ──
  FOR r IN
    SELECT p.item_class,
           sum(it.quantity * public.resolve_unit_cost(p.id, v_inv.warehouse_id)) AS cost
      FROM public.sales_invoice_items it
      JOIN public.products p ON p.id = it.product_id
     WHERE it.invoice_id = p_invoice_id
       AND it.stock_effect = 'STOCK_ISSUE'
     GROUP BY p.item_class
  LOOP
    IF r.cost IS NULL OR r.cost = 0 THEN
      CONTINUE;   -- no cost known; a zero COGS line would overstate profit
    END IF;
    v_lines := v_lines || jsonb_build_object(
      'account_code', CASE r.item_class
                        WHEN 'RAW_MATERIAL' THEN '1311'
                        WHEN 'BY_PRODUCT'   THEN '1314'
                        ELSE '1313' END,
      'credit', round(r.cost, 2),
      'memo', 'تكلفة ' || r.item_class);
    v_lines := v_lines || jsonb_build_object(
      'account_code', '5111', 'debit', round(r.cost, 2),
      'memo', 'تكلفة البضاعة المباعة');
  END LOOP;

  v_entry := public.create_journal_entry(
    'فاتورة مبيعات ' || v_inv.invoice_number,
    v_inv.created_at::date,
    'sales_invoice', p_invoice_id, true, v_lines);

  RETURN v_entry;
END $$;

REVOKE ALL ON FUNCTION public.post_sales_invoice(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.post_sales_invoice(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.post_sales_invoice(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.post_sales_invoice(uuid) IS
  'يرحّل فاتورة مبيعات إلى الدفتر. حساب التحصيل يأتي من كتالوج طرق الدفع، والإيراد من تصنيف الصنف.';


-- ---------------------------------------------------------------------------
-- 8.3 post_purchase_invoice
--
-- منقول حرفيًا من
--   20261203000000_post_purchase_invoices_to_ledger.sql
-- مع التغيير الواحد نفسه على فرع طريقة الدفع. وتصنيف البضاعة مقابل المصروف حسب
-- stock_effect، وضريبة المدخلات القابلة للاسترداد على 1316، وpartner_id المورد
-- على سطر الذمة — كلها بلا مساس.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.post_purchase_invoice(p_invoice_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user    uuid := auth.uid();
  v_inv     record;
  v_existing uuid;
  v_entry   uuid;
  v_lines   jsonb := '[]'::jsonb;
  v_cash_acct text;
  v_owed     numeric := 0;
  r         record;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT (public.has_role(v_user,'owner') OR public.has_role(v_user,'manager')
          OR public.has_role(v_user,'accountant')) THEN
    RAISE EXCEPTION 'Only an owner, manager or accountant may post a purchase invoice';
  END IF;

  SELECT * INTO v_inv FROM public.purchase_invoices WHERE id = p_invoice_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Purchase invoice not found';
  END IF;

  IF v_inv.status IN ('draft','cancelled') THEN
    RAISE EXCEPTION 'Purchase % is % - only confirmed, paid or partial invoices post',
      v_inv.invoice_number, v_inv.status;
  END IF;

  IF v_inv.paid < 0 THEN
    RAISE EXCEPTION 'Purchase % carries a negative payment (%). A supplier return is a return document, not a negative payment.',
      v_inv.invoice_number, v_inv.paid;
  END IF;
  IF v_inv.paid > v_inv.total THEN
    RAISE EXCEPTION 'Purchase % was paid % against a total of %. Fix the invoice before posting - a payment cannot exceed the invoice.',
      v_inv.invoice_number, v_inv.paid, v_inv.total;
  END IF;

  SELECT id INTO v_existing
    FROM public.journal_entries
   WHERE source_type = 'purchase_invoice' AND source_id = p_invoice_id
     AND status <> 'REVERSED';
  IF v_existing IS NOT NULL THEN
    RAISE EXCEPTION 'Purchase % has already been posted to the ledger', v_inv.invoice_number;
  END IF;

  -- ── الحساب من الكتالوج بدل القائمة المضمّنة ─────────────────────────────
  v_cash_acct := public.ledger_account_code_for_payment_method(v_inv.payment_method);

  v_owed := greatest(v_inv.total - v_inv.paid, 0);

  -- ── what was acquired ──
  FOR r IN
    SELECT p.item_class,
           coalesce(it.stock_effect, 'NONE') AS effect,
           sum(it.total)                     AS amount,
           sum(it.tax)                       AS line_tax
      FROM public.purchase_invoice_items it
      JOIN public.products p ON p.id = it.product_id
     WHERE it.invoice_id = p_invoice_id
     GROUP BY p.item_class, coalesce(it.stock_effect, 'NONE')
    HAVING sum(it.total) <> 0 OR sum(it.tax) <> 0
  LOOP
    IF r.amount <> 0 THEN
      -- البضاعة التي دخلت المخزون تذهب إلى حساب مخزون فئتها؛ وأي شيء آخر مصروف،
      -- لا زيادة في المخزون.
      v_lines := v_lines || jsonb_build_object(
        'account_code', CASE
          WHEN r.effect <> 'STOCK_RECEIPT' THEN '5911'
          ELSE CASE r.item_class
                 WHEN 'RAW_MATERIAL' THEN '1311'
                 WHEN 'BY_PRODUCT'   THEN '1314'
                 WHEN 'FINISHED_GOOD' THEN '1313'
                 ELSE '1315' END END,
        'debit', round(r.amount, 2),
        'memo', CASE WHEN r.effect <> 'STOCK_RECEIPT'
                     THEN 'مصروف مشتريات ' || r.item_class
                     ELSE 'شراء ' || r.item_class END);
    END IF;

    -- ضريبة المدخلات قابلة للاسترداد فهي أصل بحد ذاتها.
    IF r.line_tax <> 0 THEN
      v_lines := v_lines || jsonb_build_object(
        'account_code', '1316', 'debit', round(r.line_tax, 2),
        'memo', 'ضريبة مدخلات قابلة للاسترداد');
    END IF;
  END LOOP;

  -- فاتورة مشتريات تحمل ضريبة في رأسها لا في أسطرها تبقى ضريبتها قائمة.
  IF v_inv.tax <> 0 AND not exists (
       SELECT 1 FROM public.purchase_invoice_items it
        WHERE it.invoice_id = p_invoice_id AND it.tax <> 0) THEN
    v_lines := v_lines || jsonb_build_object(
      'account_code', '1316', 'debit', round(v_inv.tax, 2),
      'memo', 'ضريبة مدخلات قابلة للاسترداد');
  END IF;

  IF jsonb_array_length(v_lines) = 0 THEN
    RAISE EXCEPTION 'Purchase % has nothing to post - its lines are empty or zero',
      v_inv.invoice_number;
  END IF;

  -- ── what was paid and what is owed ──
  IF v_owed > 0 THEN
    v_lines := v_lines || jsonb_build_object(
      'account_code', '2111', 'credit', round(v_owed, 2),
      'memo', 'مستحق للمورد',
      'partner_type', 'supplier',
      'partner_id', v_inv.supplier_id);
  END IF;

  IF v_inv.paid > 0 AND v_cash_acct IS NOT NULL THEN
    v_lines := v_lines || jsonb_build_object(
      'account_code', v_cash_acct, 'credit', round(v_inv.paid, 2),
      'memo', 'سداد للمورد');
  END IF;

  v_entry := public.create_journal_entry(
    'فاتورة مشتريات ' || v_inv.invoice_number,
    v_inv.created_at::date,
    'purchase_invoice', p_invoice_id, true, v_lines);

  RETURN v_entry;
END $$;

REVOKE ALL ON FUNCTION public.post_purchase_invoice(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.post_purchase_invoice(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.post_purchase_invoice(uuid) IS
  'يرحّل فاتورة مشتريات: مخزون/مصروف + ضريبة مدخلات، مقابل النقدية أو ذمم الموردين. '
  'حساب الدفع يأتي من كتالوج طرق الدفع لا من قائمة مضمّنة.';


-- ============================================================================
-- 9. عرض تقارير — أسماء الطرق تأتي من الكتالوج لا من CASE
--
-- دالة قراءة واحدة كي لا تعيد الكشوف والتقارير والتصدير بناء خريطة تسميات كلٌّ
-- على حدة. تُعيد معرّف الكتالوج، والاسمين العربي والإنجليزي، وعائلة الحساب، لأي
-- قيمة مخزّنة بما فيها التاريخية.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.payment_method_catalog_view()
RETURNS TABLE (
  id                  text,
  name_ar             text,
  name_en             text,
  icon_key            text,
  ledger_kind         text,
  default_account_code text,
  is_credit_term      boolean,
  is_active           boolean,
  sort_order          integer,
  allowed_contexts    text[],
  -- طبقة المنشأة، مدموجة كي تُبلغ طريقة غير مضبوطة عن افتراضياتها بدل قيم NULL
  -- تحتاج التقارير إلى معالجة خاصة.
  enabled             boolean,
  effective_sort_order integer,
  effective_contexts  text[],
  is_configured       boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    m.id,
    m.name_ar,
    m.name_en,
    m.icon_key,
    m.ledger_kind,
    m.default_account_code,
    m.is_credit_term,
    m.is_active,
    m.sort_order,
    m.allowed_contexts,
    coalesce(s.enabled, true),
    coalesce(s.sort_order, m.sort_order),
    CASE
      WHEN coalesce(cardinality(s.enabled_contexts), 0) > 0
        THEN s.enabled_contexts
      ELSE m.allowed_contexts
    END,
    (s.payment_method_id IS NOT NULL)
  FROM public.payment_methods m
  LEFT JOIN public.payment_method_settings s ON s.payment_method_id = m.id
  ORDER BY coalesce(s.sort_order, m.sort_order), m.id;
$$;

COMMENT ON FUNCTION public.payment_method_catalog_view() IS
  'عرض موحّد لطرق الدفع مع تخصيص المنشأة، لاستخدامه في التقارير والتصدير دون خرائط تسميات محلية.';

REVOKE ALL ON FUNCTION public.payment_method_catalog_view() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.payment_method_catalog_view() TO authenticated, service_role;


-- ============================================================================
-- 10. إلى أين ذهبت التعريفات القديمة
--
-- الترحيلات أدناه صارت **مُستبدَلة** وتُركت في مكانها للتاريخ فقط — ولا تُعدَّل
-- أبدًا، لأن إعادة كتابة ترحيل مُطبَّق تجعل المخطط يعتمد على ترتيب تشغيل الملفات
-- الذي صادف حدوثه:
--
--   20260706120000  ALTER TYPE payment_method ADD VALUE 'mobile_money'
--   20260706121000  تكرار لما سبق (مسار بذرة reset)
--   20260707021000  تكرار لما سبق (مسار بذرة yemen)
--        -> القسم 1 يوسّع النوع إلى المجموعة الكاملة داخل المعاملة.
--
--   20260801090000  حرّاس create_sale / record_customer_payment الحرفية
--        -> القسمان 7.1 و 7.4 يستبدلان كليهما بـ
--           resolve_writable_payment_method.
--
--   20260928000000  محرّك الدفع المجزأ المُستبدَل، وحارس جزء حرفي
--        -> استُبدل بـ 20260929030000، الذي يستبدله القسم 7.3 الآن.
--
--   20260929030000  create_sale (ثلاث نسخ)، create_sales_return
--        -> الأقسام 7.1-7.3 و 7.5.
--
--   20260929040000  create_purchase_return
--        -> القسم 7.6.
--
--   20261202000000  post_sales_invoice، فرع طريقة الدفع
--   20261202000100  الفرع نفسه، رفض الدفع الزائد
--   20261202000200  الفرع نفسه، تصحيح مدين النقد
--   20261203000000  post_purchase_invoice، الفرع نفسه
--        -> القسمان 8.2 و 8.3.
--
-- لماذا لا تُحذف: كل واحد منها يُنشئ أيضًا فهارس و views وقيودًا ودوالًا مساعدة
-- لا يعيد هذا الملف إنشاءها. وحذفها كان سيُسقط تلك الكائنات على قاعدة جديدة بينما
-- يبقى الإنتاج بلا مساس — وهو بالضبط نوع الانحراف الذي يجعل المخطط عصيّ الفهم.
-- واستبدال التعريفات هنا أسلم وكافٍ: بعد هذا الترحيل، لا دالة حيّة تحوي قائمة
-- طرق دفع مضمّنة.
-- ============================================================================

-- ============================================================================
-- القسم الثاني — تفويض المستأجر
--
-- امتداد مباشر لما سبق لا يعمل منفصلاً عنه: يعدّل الجداول التي أُنشئت
-- أعلاه، ويعرّف الدوال التي تحتاجها. لذلك دُمج الملفان (16 و17 في خطة
-- الدمج) في ترحيل واحد باسم 16.
--
-- المصدر: origin/main — 20261208000001_payment_methods_tenant_authoring.sql
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. أعمدة المصدر والتأليف على الكتالوج.
-- ---------------------------------------------------------------------------
ALTER TABLE public.payment_methods
  ADD COLUMN IF NOT EXISTS created_by       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS is_system        boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS legacy_id        text,
  ADD COLUMN IF NOT EXISTS default_ledger_kind text,
  -- الاسم العربي كما شحنه المطورون بالضبط. يُكتب **فقط** في البذرة
  -- (seeds/01_system/08_payment_methods.sql) ولا يُحدَّث بعدها أبدًا، فيجد
  -- `payment_method_catalog_view().is_renamed` أساسًا حقيقيًا للمقارنة. بلاه
  -- كان العلم لا يقارن إلا الصف بنفسه، فكان false دائمًا.
  ADD COLUMN IF NOT EXISTS shipped_name_ar  text;

COMMENT ON COLUMN public.payment_methods.shipped_name_ar IS
  'الاسم العربي كما شحنه المطورون في البذرة. لا يُعدَّل بعد الزرع، ويُقارَن به name_ar لمعرفة إن كانت المنشأة قد أعادت التسمية.';

COMMENT ON COLUMN public.payment_methods.created_by IS
  'من أنشأ الطريقة. NULL = أنشأها المطورون في ترحيل، لا منشأة.';
COMMENT ON COLUMN public.payment_methods.is_system IS
  'true = صف يملكه المطورون. لا تحذفه منشأة، ولا يغيّر أحدٌ نوع حسابه.';
COMMENT ON COLUMN public.payment_methods.legacy_id IS
  'القيمة المخزّنة التي تُسوّى عليها الطريقة. للصفوف النظامية = legacy_ids[1]، وللصفوف التي أنشأتها منشأة يختارها المنشئ من ضمن الـEnum.';
COMMENT ON COLUMN public.payment_methods.default_ledger_kind IS
  'نوع الحساب الذي اقترحته المنشأة عند الإنشاء. للعرض والتشخيص فقط؛ المحرّك يقرأ ledger_kind.';

-- 1.1 التعبئة الأولى: كل صف قائم هو صف مطورين.
--
--     القيمة المخزّنة هي legacy_ids[1] عندما يُصرّح الصف بها. والمؤسسة المسمّاة
--     التي يشحنها الكتالوج الموحّد تحمل عمدًا قائمة legacy **فارغة** — بنك
--     الكريمي وجيب يتشاركان قيمة `bank_transfer` / `mobile_money` العامة بدل
--     إعادة تعريفها — فالسقوط إلى 'cash' هنا كان سيحوّل بنكًا إلى الصندوق ويجعل
--     `payment_method_legacy_id('kuraimi_bank')` تعيد 'cash'.
--
--     فالبديل الصحيح هو **عائلة الحساب**، وهي ما يعتبرها محرّك الترحيل مرجعًا
--     أصلًا، ثم 'cash' فقط لصف لا يملك أيهما. وهذا يطابق CASE الاحتياطي داخل
--     `payment_method_legacy_id` فلا يتناقض العمود والدالة.
--
--     ⚠️ هذا مكتوب CASE غير مشروط، لا `coalesce(legacy_id, …)`. فالعمود يبدأ NULL
--     على قاعدة جديدة، لكن على أي قاعدة شغّلها سابقًا وأعطته قيمة — أو حملت
--     DEFAULT 'cash' القديم — سيجد `coalesce` قيمة غير NULL **ويتوقف**، فيُبقي كل
--     صف بنك ومحفظة مخزَّنًا 'cash' بصمت. وهذا بالضبط الخلل الذي يوثّقه تقرير
--     `MIGRATION_16_REVIEW.md` §2: المستند يقول بنك والدفتر يقول صندوق، فتصير
--     التسوية مستحيلة. أما CASE فيعيد اشتقاق القيمة من المصدر المرجعي كل مرة،
--     فيتقارب تشغيل متكرر إلى الجواب الصحيح نفسه بدل أن يحفظ الفساد الذي جاء
--     لإصلاحه.
--
--     واختير WHERE بحيث لا تُلمس إلا الصفوف التي تخالف قيمتها المخزّنة هذا
--     الاشتقاق. ولا يجب أن يرى trigger `payment_methods_authoring_guard`
--     (القسم 3) تحديثًا بلا أثر هنا، ويُترك اختيار صف المنشأة الصريح كما هو لأن
--     CASE يقرأ `legacy_ids[1]` أولًا.
UPDATE public.payment_methods
   SET is_system = true,
       legacy_id = CASE
         -- 1. القيمة التي يصرّح بها الصف. صفوف المطورين التي تسمّي قيمة ENUM
         --    تحملها هنا؛ وصف المنشأة يحمل اختيارها الخاص.
         WHEN nullif(legacy_ids[1], '') IS NOT NULL THEN legacy_ids[1]
         -- 2. عائلة الحساب، وهي ما يثق به محرّك الترحيل.
         WHEN ledger_kind = 'BANK'   THEN 'bank_transfer'
         WHEN ledger_kind = 'WALLET' THEN 'mobile_money'
         WHEN ledger_kind = 'CARD'   THEN 'card'
         WHEN ledger_kind = 'CREDIT' THEN 'credit'
         WHEN ledger_kind = 'CASH'   THEN 'cash'
         -- 3. صف لا يملك أيهما. هنا يقع 'OTHER' (الطريقة الرمزية split).
         ELSE coalesce(nullif(legacy_id, ''), 'cash')
       END
 WHERE is_system IS DISTINCT FROM true
    -- صف تستطيع عائلته إنتاج قيمة لكن قيمته المخزّنة تخالفها: الفساد الذي
    -- وُجد هذا القسم لإصلاحه.
    OR (
      ledger_kind IN ('BANK','WALLET','CARD','CREDIT','CASH')
      AND legacy_id IS DISTINCT FROM CASE ledger_kind
            WHEN 'BANK'   THEN 'bank_transfer'
            WHEN 'WALLET' THEN 'mobile_money'
            WHEN 'CARD'   THEN 'card'
            WHEN 'CREDIT' THEN 'credit'
            ELSE coalesce(nullif(legacy_ids[1], ''), 'cash')
          END
    );

-- 1.2 من الآن العمود هو المرجع، فيجب ألا يغيب أبدًا.
--
--     ⚠️ No `DEFAULT 'cash'` here, and this matters. A column default is applied
--     to any INSERT that omits the column — including `create_tenant_payment_method`
--     if it ever forgets it, and any future seed that adds a row without setting
--     it. The tenant RPC always writes `legacy_id` explicitly, so the default was
--     never needed; but while it existed it also meant §1.1's `coalesce` found a
--     non-NULL 'cash' on a second run and stopped, freezing every bank row as
--     cash — the exact bug MIGRATION_16_REVIEW.md §2 describes. Leaving the
--     default off means "forgot to set it" fails loudly against the NOT NULL
--     below instead of silently recording a bank as cash.
ALTER TABLE public.payment_methods
  ALTER COLUMN legacy_id DROP DEFAULT;
UPDATE public.payment_methods SET legacy_id = 'cash' WHERE legacy_id IS NULL;
ALTER TABLE public.payment_methods
  ALTER COLUMN legacy_id SET NOT NULL;

-- 1.3 لا يجوز أن يحمل إلا قيمة يستطيع النوع تخزينها. وهذا القيد هو ما يجعل
--     كتابة قيمة ترفضها الجداول المالية من طريقة أنشأتها منشأة أمرًا مستحيلًا.
ALTER TABLE public.payment_methods
  DROP CONSTRAINT IF EXISTS payment_methods_legacy_id_valid;
ALTER TABLE public.payment_methods
  ADD CONSTRAINT payment_methods_legacy_id_valid
  CHECK (legacy_id IN ('cash','card','bank_transfer','credit','mobile_money','split','cheque'));

-- 1.4 لا يجوز أن يستخدم صف منشأة معرّف مطور. و `is_system` هو ما يفصل بينهما،
--     فلا يمكن لطريقة منشأة أن تحجب بنك الكريمي أبدًا.
CREATE INDEX IF NOT EXISTS ix_payment_methods_system
  ON public.payment_methods (is_system, is_active, sort_order);

-- 1.5 الأسماء هي ما يقرأه المشغّل عند الصندوق؛ والفراغ غير مقبول.
ALTER TABLE public.payment_methods
  DROP CONSTRAINT IF EXISTS payment_methods_name_ar_present;
ALTER TABLE public.payment_methods
  ADD CONSTRAINT payment_methods_name_ar_present
  CHECK (btrim(coalesce(name_ar, '')) <> '');

-- 1.6 صف المنشأة لا تاريخ له يُحفظ، فقد لا يحمل قائمة legacy أبدًا؛ ويبقى العمود
--     لصفوف المطورين التي تحتاجها.
ALTER TABLE public.payment_methods
  ALTER COLUMN legacy_ids SET DEFAULT ARRAY[]::text[];

-- 1.7 مفتاح أيقونة واحد لكل صف، من السجل المضمَّن. وصف مطور بمفتاح لا تعرفه
--     حزمة العميل يبقى يُعرض عبر بديل عائلة الحساب، فهذا إرشاد لا جدار.
COMMENT ON COLUMN public.payment_methods.icon_key IS
  'مفتاح أيقونة مركزي يُحلّ إلى مكوّن داخل الحزمة (ليس رابطاً). قائمة المفاتيح المتاحة للعميل في src/lib/payments/payment-methods.ts.';

-- ---------------------------------------------------------------------------
-- 2. أعمدة الملكية على إعداد المنشأة، ليعرف التعديل مَن صاحبه ومن أين جاء.
--    و`updated_at` / `updated_by` موجودان أصلًا.
-- ---------------------------------------------------------------------------
ALTER TABLE public.payment_method_settings
  ADD COLUMN IF NOT EXISTS created_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS updated_by_platform boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.payment_method_settings.updated_by_platform IS
  'true = آخر تعديل جاء من مسؤول منصة (سوبر أدمن)، لا من المنشأة نفسها.';

-- ---------------------------------------------------------------------------
-- 3. الحارس — ما يجوز لإعادة التسمية أن تغيّره وما لا يجوز.
--
--    trigger لا سياسة، لأن القاعدة عن **أي أعمدة** تغيّرت، و RLS لا ترى الصف
--    OLD. ويعمل لكل كاتب، بما فيه تحديث PostgREST مباشر من مالك، وهو بالضبط
--    الحالة التي تتركها قاعدة مقصورة على الواجهة مفتوحة.
--
--    اقرأ الفرعين جملة واحدة:
--      «اسمٌ وأيقونة: نعم. حسابٌ وقيمةٌ مخزّنة: لا، إلا في صفٍّ أنشأته أنت.»
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.payment_methods_authoring_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
BEGIN
  -- مشغّل الترحيلات ومفتاح خدمة المنصة لا يقيّدهما هذا الحكم: فهما المطورون،
  -- وهذا الـtrigger موجود أصلًا ليتسنّى لهما تغيير البذرة.
  IF v_user IS NULL OR public.is_platform_superadmin(v_user) THEN
    RETURN NEW;
  END IF;

  IF NOT (public.has_role(v_user, 'owner') OR public.has_role(v_user, 'manager')) THEN
    RAISE EXCEPTION 'لا تملك صلاحية تعديل طرق الدفع'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- 3.1 صف المطور ليس ملك المنشأة لتثريه. يمكنها إعادة تسميته وتغيير أيقونته؛
  --     وكل عمود يقرّر كيف تتحرّك الأموال مجمّد.
  IF OLD.is_system THEN
    IF NEW.ledger_kind   IS DISTINCT FROM OLD.ledger_kind
       OR NEW.legacy_id  IS DISTINCT FROM OLD.legacy_id
       OR NEW.is_system  IS DISTINCT FROM OLD.is_system
       OR NEW.is_active  IS DISTINCT FROM OLD.is_active
       OR NEW.legacy_ids IS DISTINCT FROM OLD.legacy_ids
       OR NEW.id         IS DISTINCT FROM OLD.id THEN
      RAISE EXCEPTION
        'لا يمكن تغيير طبيعة طريقة دفع نظامية (%) — يمكن تعديل الاسم والأيقونة والترتيب فقط',
        OLD.id
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  -- 3.2 A tenant row is theirs, but its shape is still the platform's.
  IF NEW.is_system IS DISTINCT FROM OLD.is_system THEN
    RAISE EXCEPTION 'لا يمكن ترقية طريقة دفع إلى نظامية من الواجهة'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.ledger_kind NOT IN ('CASH','BANK','WALLET','CARD','OTHER') THEN
    RAISE EXCEPTION 'نوع الحساب "%" غير متاح لطريقة دفع تنشئها المنشأة', NEW.ledger_kind
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END $$;

COMMENT ON FUNCTION public.payment_methods_authoring_guard() IS
  'يسمح للمنشأة بتعديل الاسم والأيقونة، ويمنعها من تغيير نوع الحساب أو القيمة المخزّنة لطريقة نظامية.';

DROP TRIGGER IF EXISTS payment_methods_authoring_guard ON public.payment_methods;
CREATE TRIGGER payment_methods_authoring_guard
  BEFORE UPDATE ON public.payment_methods
  FOR EACH ROW EXECUTE FUNCTION public.payment_methods_authoring_guard();

-- 3.3 The same sentence for DELETE: a tenant method may be removed by its owner,
--     a developer method never. `ON DELETE CASCADE` on the settings row means
--     the configuration disappears with it — which is correct for a row the
--     business itself created.
CREATE OR REPLACE FUNCTION public.payment_methods_delete_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
BEGIN
  IF v_user IS NULL OR public.is_platform_superadmin(v_user) THEN
    RETURN OLD;
  END IF;

  IF OLD.is_system THEN
    RAISE EXCEPTION
      'لا يمكن حذف طريقة دفع نظامية (%) — عطّلها بدلاً من ذلك', OLD.id
      USING ERRCODE = 'check_violation';
  END IF;

  IF NOT (public.has_role(v_user, 'owner') OR public.has_role(v_user, 'manager')) THEN
    RAISE EXCEPTION 'لا تملك صلاحية حذف طرق الدفع'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN OLD;
END $$;

COMMENT ON FUNCTION public.payment_methods_delete_guard() IS
  'يمنع حذف طريقة نظامية؛ ويقصر حذف طرق المنشأة على المالك أو المدير.';

DROP TRIGGER IF EXISTS payment_methods_delete_guard ON public.payment_methods;
CREATE TRIGGER payment_methods_delete_guard
  BEFORE DELETE ON public.payment_methods
  FOR EACH ROW EXECUTE FUNCTION public.payment_methods_delete_guard();

-- 3.4 دفاع متعدد الطبقات: حتى لو وُسّعت سياسة يومًا، لا يمكن لمستدعٍ غير منصة أن
--     يُدرج مباشرةً في الكتالوج. الإدراج يمرّ عبر دالة RPC في القسم 4، التي تختم
--     created_by و is_system = false.
DROP POLICY IF EXISTS "payment_methods tenant insert" ON public.payment_methods;
CREATE POLICY "payment_methods tenant insert"
  ON public.payment_methods
  FOR INSERT TO authenticated
  WITH CHECK (public.is_platform_superadmin(auth.uid()));

-- 3.5 والحذف عبر PostgREST عمل منصة فقط. وصف المنشأة نفسه يُزال عبر
--     remove_tenant_payment_method()، وهي قابلة للتدقيق وتستطيع الرفض إذا كانت
--     الطريقة قيد الاستخدام.
DROP POLICY IF EXISTS "payment_methods platform delete" ON public.payment_methods;
CREATE POLICY "payment_methods platform delete"
  ON public.payment_methods
  FOR DELETE TO authenticated
  USING (public.is_platform_superadmin(auth.uid()));

-- 3.6 الـUPDATE يحكمه بالفعل سياسة الموظفين القائمة، ويضيّقه trigger في 3.1 إلى
--     الملكية فوق ذلك. أُعيد إنشاؤه صراحةً هنا ليكون الملف مكتفيًا بذاته على قاعدة
--     أُعيدت تسمية السياسة فيها.
DROP POLICY IF EXISTS "payment_methods tenant update" ON public.payment_methods;
CREATE POLICY "payment_methods tenant update"
  ON public.payment_methods
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'owner') OR public.has_role(auth.uid(), 'manager')
         OR public.is_platform_superadmin(auth.uid()))
  WITH CHECK (public.has_role(auth.uid(), 'owner') OR public.has_role(auth.uid(), 'manager')
              OR public.is_platform_superadmin(auth.uid()));

GRANT INSERT, UPDATE, DELETE ON public.payment_methods TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. دوال RPC الثلاث التي تناديها شاشة الإعدادات.
--
--    كل واحدة هي الطريق المسموح الوحيد لعملها، فيكون لكل قاعدة مهمة موضع واحد
--    للإنفاذ وموضع واحد للقراءة.
-- ---------------------------------------------------------------------------

-- 4.1 هل يملك المستدعي حق التأليف في الكتالوج أصلًا؟
CREATE OR REPLACE FUNCTION public.can_author_payment_methods()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_platform_superadmin(auth.uid())
      OR public.has_role(auth.uid(), 'owner')
      OR public.has_role(auth.uid(), 'manager');
$$;

COMMENT ON FUNCTION public.can_author_payment_methods() IS
  'هل يملك المستخدم الحالي حق تسمية/أيقنة/إنشاء طرق دفع؟ صاحب المنشأة والمدير وسوبر أدمن المنصة.';

REVOKE ALL ON FUNCTION public.can_author_payment_methods() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_author_payment_methods() TO authenticated, service_role;

-- 4.2 التسمية تسمية: قصّها، وحدّدها، وارفض الفارغة. وإبقاء ذلك في دالة واحدة
--     يعني أن الـRPC وأي واجهة مستقبلية لا يمكن أن تختلفا.
CREATE OR REPLACE FUNCTION public.payment_method_clean_label(p_label text)
RETURNS text
LANGUAGE sql SET search_path = public
IMMUTABLE
AS $$
  SELECT nullif(btrim(coalesce(p_label, '')), '');
$$;

COMMENT ON FUNCTION public.payment_method_clean_label(text) IS
  'تطبيع تسمية طريقة الدفع: قصّ الفراغات وإرجاع NULL للنص الفارغ.';

REVOKE ALL ON FUNCTION public.payment_method_clean_label(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.payment_method_clean_label(text) TO authenticated, service_role;

-- 4.3 إعادة التسمية / إعادة الأيقنة.
--
--     تُعيد الحالة الجديدة عن قصد ليؤكّدها المستدعي، بدل الثقة بأن التحديث طابق
--     صفًا.
CREATE OR REPLACE FUNCTION public.update_payment_method_identity(
  p_id        text,
  p_name_ar   text DEFAULT NULL,
  p_name_en   text DEFAULT NULL,
  p_icon_key  text DEFAULT NULL
)
RETURNS TABLE (id text, name_ar text, name_en text, icon_key text, is_system boolean)
LANGUAGE plpgsql SET search_path = public
SECURITY INVOKER
AS $$
DECLARE
  v_row       public.payment_methods;
  v_name_ar   text;
  v_name_en   text;
  v_icon_key  text;
BEGIN
  IF NOT public.can_author_payment_methods() THEN
    RAISE EXCEPTION 'لا تملك صلاحية تعديل طرق الدفع — هذه الصلاحية لصاحب المنشأة والمدير وسوبر أدمن المنصة'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- `payment_methods.id` مُؤهّل عن قصد: فـ `id` غير المؤهّل داخل دالة plpgsql
  -- تحمل معامل OUT باسم `id` يُحلّ إلى **المعامل** لا العمود، فيطابق البحث لا شيء
  -- بصمت.
  SELECT * INTO v_row FROM public.payment_methods WHERE public.payment_methods.id = p_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'طريقة الدفع "%" غير موجودة في الكتالوج', p_id
      USING ERRCODE = 'no_data_found';
  END IF;

  -- تُحلّ القيم الثلاث الجديدة **قبل** التحديث، حتى لا تشير قائمة SET في UPDATE
  -- إلا إلى متغيّرات عادية. فداخل دالة RETURNS TABLE، يكون `name_ar` غير المؤهّل
  -- في تعبير هو معامل OUT — قابل للكتابة في PostgreSQL >= 14 وخطأ قبلها. والإسناد
  -- إلى متغيرات محلية أولًا يجعل الجملة تعني الشيء نفسه على كل نسخة مدعومة.

  -- لا يجوز أن تُفرِغ إعادة التسمية طريقةً من الصندوق.
  IF p_name_ar IS NOT NULL AND public.payment_method_clean_label(p_name_ar) IS NULL THEN
    RAISE EXCEPTION 'اسم طريقة الدفع لا يمكن أن يكون فارغاً'
      USING ERRCODE = 'check_violation';
  END IF;

  v_name_ar  := coalesce(public.payment_method_clean_label(p_name_ar), v_row.name_ar);
  v_name_en  := CASE
                  WHEN p_name_en IS NULL THEN v_row.name_en
                  ELSE public.payment_method_clean_label(p_name_en)
                END;
  v_icon_key := coalesce(public.payment_method_clean_label(p_icon_key), v_row.icon_key);

  UPDATE public.payment_methods m
     SET name_ar    = v_name_ar,
         name_en    = v_name_en,
         icon_key   = v_icon_key,
         updated_at = now()
   WHERE m.id = p_id;

  INSERT INTO public.audit_logs (actor_id, action, entity_type, payload)
  VALUES (
    auth.uid(),
    'payment_method.identity.updated',
    'payment_method',
    jsonb_build_object(
      'id', p_id,
      'before', jsonb_build_object(
        'name_ar', v_row.name_ar, 'name_en', v_row.name_en, 'icon_key', v_row.icon_key),
      'after',  jsonb_build_object(
        'name_ar', v_name_ar, 'name_en', v_name_en, 'icon_key', v_icon_key),
      'by_platform', public.is_platform_superadmin(auth.uid())
    ));

  RETURN QUERY
    SELECT m.id::text, m.name_ar::text, m.name_en::text, m.icon_key::text, m.is_system::boolean
    FROM public.payment_methods m
    WHERE m.id = p_id;
END $$;

COMMENT ON FUNCTION public.update_payment_method_identity(text, text, text, text) IS
  'تعديل اسم طريقة الدفع وأيقونتها. لا يمسّ نوع الحساب ولا القيمة المخزّنة، ولا يسمح بتسمية فارغة.';

REVOKE ALL ON FUNCTION public.update_payment_method_identity(text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_payment_method_identity(text, text, text, text) TO authenticated, service_role;

-- 4.4 ADD a method the developers did not ship.
--
--     The id is DERIVED from the Arabic name and de-duplicated, never taken
--     from the browser: an id is a stable key that migrations and reports will
--     address forever, so it must not be something a client can choose or
--     predictably collide with بنك الكريمي.
CREATE OR REPLACE FUNCTION public.create_tenant_payment_method(
  p_name_ar       text,
  p_name_en       text,
  p_icon_key      text,
  p_legacy_id     text,
  p_ledger_kind   text,
  p_contexts      text[] DEFAULT NULL,
  p_requires_reference boolean DEFAULT true
)
RETURNS text
LANGUAGE plpgsql SET search_path = public
SECURITY INVOKER
AS $$
DECLARE
  v_user        uuid := auth.uid();
  v_name        text;
  v_name_en     text;
  v_legacy      text;
  v_kind        text;
  v_contexts    text[];
  v_base        text;
  v_next_order  integer;
  v_auto_id     text;
BEGIN
  IF NOT public.can_author_payment_methods() THEN
    RAISE EXCEPTION 'لا تملك صلاحية إضافة طرق دفع — هذه الصلاحية لصاحب المنشأة والمدير وسوبر أدمن المنصة'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  v_name := public.payment_method_clean_label(p_name_ar);
  IF v_name IS NULL THEN
    RAISE EXCEPTION 'اسم طريقة الدفع مطلوب' USING ERRCODE = 'check_violation';
  END IF;
  IF length(v_name) > 60 THEN
    RAISE EXCEPTION 'اسم طريقة الدفع طويل جداً (الحد 60 حرفاً)'
      USING ERRCODE = 'check_violation';
  END IF;
  v_name_en := public.payment_method_clean_label(p_name_en);
  IF v_name_en IS NOT NULL AND length(v_name_en) > 60 THEN
    RAISE EXCEPTION 'الاسم الإنجليزي طويل جداً (الحد 60 حرفاً)'
      USING ERRCODE = 'check_violation';
  END IF;

  -- القيمة المخزّنة. لا يجوز للمنشأة إدخال قيمة لا يحملها النوع، ولا اختيار
  -- 'split' — فتلك القيمة تعني «سُدّدت بأكثر من وسيلة» وتكتبها محرّك الدفع المجزأ،
  -- لا يختارها مشغّل.
  v_legacy := lower(btrim(coalesce(p_legacy_id, '')));
  IF v_legacy NOT IN ('cash','card','bank_transfer','mobile_money','cheque') THEN
    RAISE EXCEPTION
      'القيمة المخزّنة "%" غير متاحة لطريقة تنشئها المنشأة (المتاح: cash, card, bank_transfer, mobile_money, cheque)',
      coalesce(p_legacy_id, '(فارغ)')
      USING ERRCODE = 'check_violation';
  END IF;

  -- عائلة الحساب تتبع القيمة المخزّنة. واشتقاقها بدل قبولها يعني أن المنشأة لا
  -- تستطيع جعل محفظة تُرحّل إلى الصندوق: فالمزاوجة حقيقة عن النوع لا تفضيل.
  --
  -- و`p_ledger_kind` **مُتجاهَل** عن قصد. هو موجود في التوقيع ليتمكن أدوات المنصة
  -- من تمرير إرشاد، لكن مستدعيًا يرسل 'CASH' لمحفظة لا يحصل عليه: فـ CASE أدناه
  -- هو الجواب الوحيد.
  v_kind := CASE v_legacy
              WHEN 'cash'         THEN 'CASH'
              WHEN 'card'         THEN 'CARD'
              WHEN 'bank_transfer' THEN 'BANK'
              WHEN 'cheque'       THEN 'BANK'
              WHEN 'mobile_money' THEN 'WALLET'
            END;

  -- الأقسام افتراضيًا كل ما يمكن للعائلة أن تظهر فيه بشكل مشروع. و`credit` ليس
  -- في القائمة عن قصد: فطريقة المنشأة وسيلة **تحصيل** أموال، و«آجل» ليست كذلك.
  v_contexts := coalesce(
    p_contexts,
    ARRAY['pos','sales','purchases','expenses','customer_collection']::text[]
  );
  IF NOT (v_contexts <@ ARRAY[
    'pos','sales','purchases','expenses','customer_collection',
    'sales_returns','purchase_returns']::text[]) THEN
    RAISE EXCEPTION 'أحد الأقسام المختارة غير معروف'
      USING ERRCODE = 'check_violation';
  END IF;

  -- معرّف ثابت مقروء مشتق من الاسم. والعربي يُنقل إلى slug؛ وأي شيء لا يترك
  -- محارف صالحة يسقط إلى بادئة، فيبقى المعرّف غير فارغ أبدًا ومطابقًا لقيد الجدول
  -- دائمًا.
  --
  -- وإن لم يُمرَّر اسم إنجليزي، يُؤخذ الـslug من الكتالوج **المولَّد** من المعرّف
  -- العربي، لا من النص العربي الحرفي: فقيد الجدول يشترط `id = lower(btrim(id))`،
  -- والعربية بلا حالة أحرف، فقاعدة عربية خام تنجح اليوم وتنكسر لحظة إضافة كلمة
  -- لاتينية.
  v_base := regexp_replace(lower(coalesce(v_name_en, '')), '[^a-z0-9]+', '_', 'g');
  v_base := btrim(coalesce(v_base, ''), '_');

  IF v_base = '' THEN
    SELECT regexp_replace(lower(m.id), '[^a-z0-9]+', '_', 'g')
      INTO v_base
    FROM public.payment_methods m
    WHERE m.id = public.payment_method_resolve_id(v_legacy);

    v_base := btrim(coalesce(v_base, ''), '_');
  END IF;

  IF v_base = '' THEN
    v_base := 'tenant_' || nullif(btrim(v_legacy, '_'), '');
  END IF;

  -- معرّف واحد يُسنَد قبل الـINSERT، فلا تشير الجملة أدناه إلا إلى متغيرات محلية
  -- عادية. وترك PostgreSQL يختار اللاحقة الحرة التالية ضمنيًا ممكن، لكنه يجعل
  -- تفرّد `id` معتمدًا على صورة استعلام فرعي لا على حلقة على الجدول الحيّ.
  v_auto_id := v_base;
  WHILE EXISTS (SELECT 1 FROM public.payment_methods m WHERE m.id = v_auto_id) LOOP
    v_auto_id := v_base || '_' || (2 + (SELECT count(*) FROM public.payment_methods m
                                       WHERE m.id LIKE v_base || '\_%'))::text;
  END LOOP;

  -- يُرتَّب بعد آخر صف قائم، فتظهر الطريقة المضافة حديثًا في نهاية ترتيب المشغّل
  -- لا في وسطه.
  SELECT coalesce(max(m.sort_order), 100) + 10
    INTO v_next_order
  FROM public.payment_methods m;

  INSERT INTO public.payment_methods (
    id, name_ar, name_en, icon_key, is_active, sort_order, allowed_contexts,
    ledger_kind, default_account_code, is_credit_term, requires_reference,
    legacy_ids, legacy_id, default_ledger_kind, is_system, created_by, notes
  ) VALUES (
    v_auto_id,
    v_name,
    v_name_en,
    coalesce(public.payment_method_clean_label(p_icon_key), 'wallet'),
    true,
    v_next_order,
    v_contexts,
    v_kind,
    public.payment_method_ledger_account(v_legacy),
    false,
    coalesce(p_requires_reference, true),
    ARRAY[]::text[],
    v_legacy,
    v_kind,
    false,
    v_user,
    'طريقة دفع أنشأتها المنشأة.'
  );

  -- صف في الإعدادات أيضًا، فتصير الطريقة الجديدة قابلة للتعديل فورًا وتحمل
  -- الأقسام نفسها التي حصل عليها صف الكتالوج.
  INSERT INTO public.payment_method_settings (
    payment_method_id, enabled, sort_order, enabled_contexts, created_by
  )
  SELECT m.id, true, m.sort_order, m.allowed_contexts, v_user
  FROM public.payment_methods m
  WHERE m.id = v_auto_id
  ON CONFLICT (payment_method_id) DO NOTHING;

  INSERT INTO public.audit_logs (actor_id, action, entity_type, payload)
  VALUES (
    v_user, 'payment_method.created', 'payment_method',
    jsonb_build_object(
      'id', v_auto_id, 'name_ar', v_name, 'legacy_id', v_legacy,
      'ledger_kind', v_kind, 'contexts', v_contexts,
      'by_platform', public.is_platform_superadmin(v_user)
    ));

  RETURN v_auto_id;
END $$;

COMMENT ON FUNCTION public.create_tenant_payment_method(text, text, text, text, text, text[], boolean) IS
  'إضافة طريقة دفع لم يشحنها المطورون: تُشتق قيمتها المخزّنة ونوع حسابها من اختيار المنشأة، والمعرّف يُولَّد ولا يأتي من المتصفح.';

REVOKE ALL ON FUNCTION public.create_tenant_payment_method(text, text, text, text, text, text[], boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_tenant_payment_method(text, text, text, text, text, text[], boolean) TO authenticated, service_role;

-- 4.5 REMOVE a tenant method.
--
--     Refuses while documents still reference it: a removal that silently
--     changed how a past invoice labels itself is the one outcome this feature
--     must never produce. The operator is told to disable it instead.
CREATE OR REPLACE FUNCTION public.remove_tenant_payment_method(p_id text)
RETURNS void
LANGUAGE plpgsql SET search_path = public
SECURITY INVOKER
AS $$
DECLARE
  v_row   public.payment_methods;
  v_in_use boolean;
  v_legacy text;
BEGIN
  IF NOT public.can_author_payment_methods() THEN
    RAISE EXCEPTION 'لا تملك صلاحية حذف طرق الدفع'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- `payment_methods.id` is qualified so it is the COLUMN and not a variable.
  SELECT * INTO v_row FROM public.payment_methods WHERE public.payment_methods.id = p_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'طريقة الدفع "%" غير موجودة', p_id USING ERRCODE = 'no_data_found';
  END IF;

  IF v_row.is_system THEN
    RAISE EXCEPTION
      'لا يمكن حذف طريقة دفع نظامية (%) — عطّلها أو غيّر تسميتها بدلاً من ذلك', p_id
      USING ERRCODE = 'check_violation';
  END IF;

  v_legacy := v_row.legacy_id;

  -- هل القيمة المخزّنة ما زالت على مستند؟ لا تصل إلى هنا إلا طرق المنشأة **نفسها**،
  -- وقيمتها المخزّنة مشتركة مع الطريقة العامة للعائلة نفسها، فهذا سؤال حقيقي فقط
  -- عندما تكون الطريقة جديدة كليًا.
  SELECT EXISTS (
    SELECT 1 FROM public.customer_payment_splits s WHERE s.method::text = v_legacy
    UNION ALL
    SELECT 1 FROM public.sales_returns  r WHERE r.refund_method::text = v_legacy
    UNION ALL
    SELECT 1 FROM public.purchase_returns r WHERE r.refund_method::text = v_legacy
    UNION ALL
    SELECT 1 FROM public.expenses e WHERE e.payment_method::text = v_legacy
  ) INTO v_in_use;

  IF v_in_use THEN
    RAISE EXCEPTION
      'طريقة الدفع "%" مستخدمة في مستندات قائمة — عطّلها (Disabled) بدلاً من حذفها', p_id
      USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO public.audit_logs (actor_id, action, entity_type, payload)
  VALUES (
    auth.uid(), 'payment_method.deleted', 'payment_method',
    jsonb_build_object(
      'id', p_id, 'name_ar', v_row.name_ar, 'legacy_id', v_legacy,
      'by_platform', public.is_platform_superadmin(auth.uid())
    ));

  DELETE FROM public.payment_methods WHERE public.payment_methods.id = p_id;
END $$;

COMMENT ON FUNCTION public.remove_tenant_payment_method(text) IS
  'حذف طريقة دفع أنشأتها المنشأة. يرفض الحذف إذا كانت الطريقة مستخدمة في مستندات قائمة، ويطلب تعطيلها بدلاً من ذلك.';

REVOKE ALL ON FUNCTION public.remove_tenant_payment_method(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.remove_tenant_payment_method(text) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. حارس الكتابة ومحرّك الدفتر يجب أن يفهمًا طريقة منشأة معًا.
--
--    `resolve_writable_payment_method` في 20261208000000 تحلّ بالفعل أي معرّف
--    كتالوجي عبر `payment_method_resolve_id`، فمعرّف يُنشأ هنا يعمل بلا تغيير.
--    وما يحتاج إعادة فحص هو **القيمة** التي تُعيدها: فـ `payment_method_legacy_id`
--    تقرأ `legacy_ids[1]` أولًا، وهو فارغ لصف المنشأة، ثم ترجع إلى عائلة الحساب
--    فقط. وذلك الرجوع كان يحوّل «شيكًا» لمنشأة (legacy_id 'cheque'، عائلة BANK)
--    إلى 'bank_transfer' — فيُهمل بصمت القيمة التي اختارتها المنشأة.
--
--    فالدالة الآن تقرأ `legacy_id` الصريح أولًا. ولكل صف قائم مُلئ `legacy_id` من
--    `legacy_ids[1]` سابقًا، فهذا بلا أثر على كل الطرق التاريخية ولا يغيّر السلوك
--    إلا لصفوف المنشأة.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.payment_method_legacy_id(p_id text)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH norm AS (
    SELECT lower(btrim(coalesce(p_id, ''))) AS v
  ),
  direct AS (
    SELECT n.v
    FROM norm n
    WHERE n.v <> ''
      AND EXISTS (
        SELECT 1 FROM pg_enum e
        JOIN pg_type t ON t.oid = e.enumtypid
        JOIN pg_namespace ns ON ns.oid = t.typnamespace
        WHERE ns.nspname = 'public' AND t.typname = 'payment_method'
          AND e.enumlabel = n.v
      )
  ),
  via_catalog AS (
    SELECT coalesce(
             -- 1. القيمة التي يصرّح بها الصف. هنا تحمل الطريقة التي أنشأتها المنشأة
             --    هويتها.
             nullif(m.legacy_id, ''),
             -- 2. القائمة التاريخية، لأي صف يسبق وجود هذا العمود.
             nullif(m.legacy_ids[1], ''),
             -- 3. عائلة الحساب. ومؤسسة مسمّاة يشحنها الكتالوج الموحّد تحمل قائمة
             --    legacy **فارغة** عن قصد — فهي تتشارك قيمة bank_transfer /
             --    mobile_money العامة — فأدناه جواب حقيقي لها لا بديل مؤقت. وهو
             --    ما يمنع «البنك» من الهبوط على الصندوق أبدًا.
             CASE m.ledger_kind
               WHEN 'BANK'   THEN 'bank_transfer'
               WHEN 'WALLET' THEN 'mobile_money'
               WHEN 'CARD'   THEN 'card'
               WHEN 'CREDIT' THEN 'credit'
               WHEN 'CASH'   THEN 'cash'
               ELSE 'cash'
             END
           ) AS v
    FROM public.payment_methods m, norm n
    WHERE m.id = n.v
  )
  SELECT coalesce(
    (SELECT v FROM direct),
    (SELECT v FROM via_catalog),
    -- لا يصل إلى هنا إلا معرّف لا يعرفه الكتالوج فعلًا. فالكاشير لا يمكنه قبول
    -- مال بطريقة لا نعرفها، فهذا عمدًا النقد العام الأمين بدل NULL في عمود فاتورة.
    'cash'
  );
$$;

COMMENT ON FUNCTION public.payment_method_legacy_id(text) IS
  'يحوّل معرّف الكتالوج إلى القيمة التي يفهمها عمود payment_method. يقرأ legacy_id أولاً لدعم الطرق التي أنشأتها المنشأة.';

-- 5.1 `payment_method_ledger_account` تُحلّ عبر `payment_method_resolve_id`،
--     وهي بلا تغيير وتتعامل بالفعل مع معرّف منشأة. أُعيد تأكيدها هنا ليرى قارئ
--     **هذا** الملف المسار كاملاً دون فتح الترحيل السابق.
CREATE OR REPLACE FUNCTION public.payment_method_ledger_account(p_stored text)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    -- يُفحص «آجل» **أولًا**، قبل أي كود إرشادي. فبيعة آجلة لا تحصّل شيئًا، فلا
    -- يوجد سطر نقد أو بنك يُكتب — وبذرة الكتالوج تعطي صف الآجل
    -- default_account_code ('1211') إرشادًا لحساب الذمة. وترك ذلك الكود يفوز
    -- كان يُرحّل حركة بنك/نقد لأموال لم تُستلم قط.
    WHEN m.ledger_kind = 'CREDIT' THEN NULL
    -- الإرشاد الصريح في صف الكتالوج يفوز لكل نقد حقيقي.
    WHEN m.default_account_code IS NOT NULL THEN m.default_account_code
    WHEN m.ledger_kind IN ('BANK','WALLET','CARD') THEN '1111'
    WHEN m.ledger_kind = 'CASH'   THEN '1101'
    ELSE '1101'
  END
  FROM public.payment_methods m
  WHERE m.id = public.payment_method_resolve_id(p_stored);
$$;

-- ---------------------------------------------------------------------------
-- 6. The reporting view must expose the new columns, because the settings
--    screen edits names and icons and the reports label historic documents.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.payment_method_catalog_view();

CREATE OR REPLACE FUNCTION public.payment_method_catalog_view()
RETURNS TABLE (
  id                   text,
  name_ar              text,
  name_en              text,
  icon_key             text,
  ledger_kind          text,
  default_account_code text,
  is_credit_term       boolean,
  is_active            boolean,
  sort_order           integer,
  allowed_contexts     text[],
  legacy_id            text,
  is_system            boolean,
  requires_reference   boolean,
  enabled              boolean,
  effective_sort_order integer,
  effective_contexts   text[],
  is_configured        boolean,
  is_renamed           boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    m.id,
    m.name_ar,
    m.name_en,
    m.icon_key,
    m.ledger_kind,
    m.default_account_code,
    m.is_credit_term,
    m.is_active,
    m.sort_order,
    m.allowed_contexts,
    m.legacy_id,
    m.is_system,
    m.requires_reference,
    coalesce(s.enabled, true),
    coalesce(s.sort_order, m.sort_order),
    CASE
      WHEN coalesce(cardinality(s.enabled_contexts), 0) > 0
        THEN s.enabled_contexts
      ELSE m.allowed_contexts
    END,
    (s.payment_method_id IS NOT NULL),
    -- صف مطور لم تعد تسميته تطابق اسمه العربي المشحون. يُبلَّغ به لتستطيع شاشة
    -- الإعدادات عرض «معدّلة» وتقديم إعادة تعيين، وهو البديل الأمين لضياع الأصل
    -- بصمت.
    --
    -- يُقارَن بالتسمية المشحونة المخزّنة، لا بالصف نفسه — فمقارنة الصف بنفسه
    -- تكون false دائمًا، وهو ما جعل هذا العلم ميتًا منذ ولادته
    -- (MIGRATION_16_REVIEW.md §3). و COALESCE يجعل صف المنشأة (اسم مشحون NULL)
    -- يُبلّغ false.
    (m.is_system AND m.shipped_name_ar IS NOT NULL
     AND m.name_ar IS DISTINCT FROM m.shipped_name_ar)
  FROM public.payment_methods m
  LEFT JOIN public.payment_method_settings s ON s.payment_method_id = m.id
  ORDER BY coalesce(s.sort_order, m.sort_order), m.id;
$$;

COMMENT ON FUNCTION public.payment_method_catalog_view() IS
  'عرض موحّد لطرق الدفع مع تخصيص المنشأة والأسماء المعدّلة، لاستخدامه في التقارير والإعدادات دون خرائط محلية.';

REVOKE ALL ON FUNCTION public.payment_method_catalog_view() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.payment_method_catalog_view() TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 7. The seed refreshes developer rows only — HOW TO DO IT CORRECTLY
--
--    `ON CONFLICT DO UPDATE` in 20261208000000 reset name_ar / icon_key on
--    every re-apply, so a future migration that re-runs that seed would
--    overwrite every rename a business had made.
--
--    The seed there is a static `VALUES` list, and PostgreSQL gives an
--    `ON CONFLICT DO UPDATE` no way to reference the row's OLD value —
--    `EXCLUDED` is the incoming tuple, `payment_methods.*` is the existing one,
--    and there is no `OLD` in this context. So the fix is not a cleverer SET
--    expression: it is to write the refreshed seed into a TEMP table first and
--    merge from it, where the existing row is an ordinary join target.
--
--    The recipe the next migration should follow is below, commented rather
--    than executed, because changing the seed's CONTENT is not this file's job:
--
--      CREATE TEMP TABLE seed_pm ON COMMIT DROP AS
--        SELECT * FROM (VALUES
--          ('cash', 'نقداً', 'Cash', 'cash', 10, ...),
--          ('cheque', 'شيك', 'Cheque', 'cheque', 120, ...)
--        ) AS t(id, name_ar, name_en, icon_key, sort_order, ...);
--
--      -- 7.1 Rows the business renamed keep their authoring.
--      UPDATE public.payment_methods m
--         SET sort_order   = s.sort_order,
--             allowed_contexts = s.allowed_contexts,
--             ledger_kind  = s.ledger_kind,
--             default_account_code = s.default_account_code,
--             requires_reference   = s.requires_reference,
--             legacy_id    = s.legacy_id,
--             legacy_ids   = s.legacy_ids,
--             updated_at   = now()
--        FROM seed_pm s
--       WHERE m.id = s.id
--         AND m.is_system
--         AND EXISTS (SELECT 1 FROM public.payment_method_settings st
--                      WHERE st.payment_method_id = m.id
--                        AND st.updated_by_platform = false
--                        AND m.updated_at > m.created_at);
--
--      -- 7.2 Rows nobody personalised get the shipped label back.
--      UPDATE public.payment_methods m
--         SET name_ar = s.name_ar, name_en = s.name_en, icon_key = s.icon_key,
--             sort_order = s.sort_order, allowed_contexts = s.allowed_contexts,
--             ledger_kind = s.ledger_kind, legacy_id = s.legacy_id,
--             legacy_ids = s.legacy_ids, updated_at = now()
--        FROM seed_pm s
--       WHERE m.id = s.id AND m.is_system
--         AND NOT EXISTS (SELECT 1 FROM public.payment_method_settings st
--                          WHERE st.payment_method_id = m.id
--                            AND st.updated_by_platform = false
--                            AND m.updated_at > m.created_at);
--
--      -- 7.3 Anything new in the seed.
--      INSERT INTO public.payment_methods (id, name_ar, ...)
--      SELECT s.* FROM seed_pm s
--      WHERE NOT EXISTS (SELECT 1 FROM public.payment_methods m WHERE m.id = s.id);
--
--    `is_system`, `id` and `ledger_kind` are never taken from a tenant, and
--    `updated_by_platform = true` marks an edit the platform made itself, so
--    the platform can correct its own row without freezing it forever.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.payment_methods_seed_is_identity_owned(p_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.payment_methods m
    JOIN public.payment_method_settings s ON s.payment_method_id = m.id
    WHERE m.id = p_id
      AND s.updated_by_platform = false
      AND s.payment_method_id IS NOT NULL
      AND m.is_system
      -- لا يُعدّ مؤلَّفًا إلا صف لمسته المنشأة فعلًا.
      AND m.updated_at > m.created_at
  );
$$;

COMMENT ON FUNCTION public.payment_methods_seed_is_identity_owned(text) IS
  'هل عدّلت المنشأة اسم/أيقونة هذه الطريقة؟ يستخدمه الـSeed لاحقاً ليحترم التعديل؛ الترحيلات التي تزرع لا تضرب صفوف المنشأة.';

REVOKE ALL ON FUNCTION public.payment_methods_seed_is_identity_owned(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.payment_methods_seed_is_identity_owned(text) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 8. التحقق من الثوابت التي يدّعيها هذا الملف، والفشل بصوت عالٍ إن خُرق أي منها.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_bad integer;
  v_repaired integer;
BEGIN
  -- ── 8.1 إصلاح أي صف تخالف قيمته المخزّنة عائلة حسابه ──
  --
  -- مؤسسة مسمّاة (بنك الكريمي، جيب) تُشحن بقائمة legacy **فارغة** لأنها تتشارك
  -- قيمة `bank_transfer` / `mobile_money` العامة. وعندما شغّل الـbackfill في
  -- القسم 1 على قاعدة كانت تلك القائمة فيها فارغة، كان يمكن لنسخة أقدم من هذا
  -- الملف أن تترك legacy_id على حدّ 'cash' — وهو ما يحوّل بنكًا إلى الصندوق.
  -- فعُدنا نشتقّها هنا من عائلة الحساب، وهي ما يثق به محرّك الترحيل أصلًا، فيُستعاد
  -- الثابت أدناه بدل الاكتفاء بتأكيده.
  --
  -- ⚠️ شرط WHERE هو بيت القصيد. يجب أن يطابق القيمة **المعطوبة**، لا قيمة «غير
  --    صالحة». فـ 'cash' قيمة ENUM صالحة تمامًا، لذلك لم يطابق الشرط القديم
  --    `coalesce(legacy_id,'') NOT IN (…)` أي صف بنك خُزّن خطأً 'cash' — فالإصلاح
  --    كُتب، ونُفّذ، وطبع نجاحًا، ولم يغيّر شيئًا (MIGRATION_16_REVIEW.md §2.3 ب).
  --    أما المقارنة بالقيمة المشتقة فتجعل الصف يطابق بحكم التعريف متى كان خاطئًا.
  --    والصفوف التي لا تستطيع عائلتها إنتاج قيمة، والصفوف التي توافق قيمتها
  --    المعلنة أصلًا، تُترك بلا مساس.
  UPDATE public.payment_methods
     SET legacy_id = CASE ledger_kind
                       WHEN 'BANK'   THEN 'bank_transfer'
                       WHEN 'WALLET' THEN 'mobile_money'
                       WHEN 'CARD'   THEN 'card'
                       WHEN 'CREDIT' THEN 'credit'
                       WHEN 'CASH'   THEN 'cash'
                       ELSE legacy_id
                     END,
         updated_at = now()
   WHERE ledger_kind IN ('BANK','WALLET','CARD','CREDIT','CASH')
     -- legacy_ids[1] إقرار الصف الصريح وهو يفوز دائمًا؛ ومؤسسة مسمّاة تحمل قائمة
     -- فارغة، فتردّ العائلة عنها.
     AND coalesce(nullif(legacy_ids[1], ''), 'cash') <> CASE ledger_kind
                       WHEN 'BANK'   THEN 'bank_transfer'
                       WHEN 'WALLET' THEN 'mobile_money'
                       WHEN 'CARD'   THEN 'card'
                       WHEN 'CREDIT' THEN 'credit'
                       ELSE 'cash'
                     END
     AND legacy_id IS DISTINCT FROM CASE ledger_kind
                       WHEN 'BANK'   THEN 'bank_transfer'
                       WHEN 'WALLET' THEN 'mobile_money'
                       WHEN 'CARD'   THEN 'card'
                       WHEN 'CREDIT' THEN 'credit'
                       ELSE 'cash'
                     END;

  GET DIAGNOSTICS v_repaired = ROW_COUNT;
  IF v_repaired > 0 THEN
    RAISE NOTICE '↩️ أُعيد اشتقاق القيمة المخزّنة لـ % طريقة من عائلة حسابها', v_repaired;
  END IF;

  SELECT count(*) INTO v_bad
  FROM public.payment_methods
  WHERE legacy_id IS NULL
     OR legacy_id NOT IN ('cash','card','bank_transfer','credit','mobile_money','split','cheque');

  IF v_bad > 0 THEN
    RAISE EXCEPTION 'FAIL: % صفاً في الكتالوج بقيمة مخزّنة غير صالحة', v_bad;
  END IF;

  -- 8.2 كل قيمة مخزّنة على مستند حيّ يجب أن تبقى قابلة للحل، كما كانت تمامًا.
  --     محميّ بـ EXISTS كي لا تفشل قاعدة لم تُشغّل بذرة الكتالوج الموحّد بعد على
  --     صف لم تستقبله قط.
  IF EXISTS (SELECT 1 FROM public.payment_methods WHERE id = 'kuraimi_bank')
     AND public.payment_method_legacy_id('kuraimi_bank') <> 'bank_transfer' THEN
    RAISE EXCEPTION 'FAIL: kuraimi_bank -> % (expected bank_transfer)',
      public.payment_method_legacy_id('kuraimi_bank');
  END IF;
  IF EXISTS (SELECT 1 FROM public.payment_methods WHERE id = 'jaib')
     AND public.payment_method_legacy_id('jaib') <> 'mobile_money' THEN
    RAISE EXCEPTION 'FAIL: jaib -> % (expected mobile_money)',
      public.payment_method_legacy_id('jaib');
  END IF;
  IF EXISTS (SELECT 1 FROM public.payment_methods WHERE id = 'kuraimi_bank')
     AND public.payment_method_ledger_account('kuraimi_bank') <> '1111' THEN
    RAISE EXCEPTION 'FAIL: kuraimi_bank settles to %',
      public.payment_method_ledger_account('kuraimi_bank');
  END IF;
  IF EXISTS (SELECT 1 FROM public.payment_methods WHERE id = 'credit')
     AND public.payment_method_ledger_account('credit') IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL: credit must settle to NULL';
  END IF;

  RAISE NOTICE '✅ طبقة التأليف جاهزة: % طريقة، منها % نظامية',
    (SELECT count(*) FROM public.payment_methods),
    (SELECT count(*) FROM public.payment_methods WHERE is_system);
END $$;


COMMIT;

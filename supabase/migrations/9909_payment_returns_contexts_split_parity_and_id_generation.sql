-- ═══════════════════════════════════════════════════════════════════════════
-- 9909 — إغلاق أربع ثغرات في نظام طرق الدفع
--
--  ما يعالجه هذا الملف
--  ───────────────────
--   1. تحويل بنكي والمحفظة كانا ممنوعين في قسمي المرتجعات، فيتعذّر تسجيل
--      استرداد بنكي أو عبر المحفظة، ويُضطر الكاشير لتسجيله نقدًا من الصندوق —
--      وهو خطأ محاسبي حقيقي يظهر في رصيد الصندوق.
--
--   2. الدفع المجزأ كان يقبل `card` تاريخيًا في `payment_splits` و
--      `customer_payment_splits` بينما الخيارات المعتمدة أربعة. القيمة القديمة
--      تبقى مقروءة في المستندات السابقة، لكنها لم تعد تُكتب في صف تجزئة جديد.
--
--   3. توليد معرّف طريقة الدفع التي تنشئها المنشأة كان حلقة `WHILE EXISTS` على
--      الجدول؛ طلبان متزامنان بنفس الاسم يولّدان نفس المعرّف فيفشل أحدهما
--      بقيد التفرّد بدل أن يحصل على معرّف تالٍ. الحل: استعارة قفل المعاملة
--      بـ advisory lock على اسم مبدئي واحد.
--
--   4. `payment_method_settings.default_account_id` لم يكن يكتبه أي مسار في
--      الواجهة، فيسقط الترحيل دائمًا على الحساب التجميعي (1111/1131). الملف
--      يضيف دالة تحرير مشروطة: الحساب المقبول هو حساب فرعي تحت حساب عائلة
--      الطريقة نفسه، فلا يمكن ربط محفظة بحساب صندوق.
--
--  التراجع
--  ──────
--  إعادة `allowed_contexts` لتحويل بنكي والمحفظة إلى ما قبل هذا الملف، وإرجاع
--  `create_tenant_payment_method` من الترحيل 16، وحذف الدالة الإدارية الجديدة.
--  الأسطر المقبولة سابقًا في التجزئة لا تتأثر: الحارس يعمل على الإدراج الجديد.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. المرتجعات: البنك والمحفظة قناتا استرداد مشروعان ─────────────────────
--
-- التوسيع على مستوى الكتالوج فقط. المنشأة قد تكون ضيّقت قائمتها في
-- `payment_method_settings.enabled_contexts`؛ ضييقها ملكها ولا يُوسَّع هنا،
-- كما ينصّ عليه `payment_method_settings_guard`.
UPDATE public.payment_methods m
   SET allowed_contexts = ARRAY[
         'pos','sales','purchases','expenses','customer_collection',
         'sales_returns','purchase_returns'
       ]::text[],
       updated_at = now()
 WHERE m.id IN ('bank_transfer', 'mobile_money')
   AND m.allowed_contexts IS DISTINCT FROM ARRAY[
         'pos','sales','purchases','expenses','customer_collection',
         'sales_returns','purchase_returns'
       ]::text[];

-- ── 2. الدفع المجزأ: القنوات الثلاث فقط في الصفوف الجديدة ──────────────────
--
-- `guard_four_payment_method_write` يمرّ فوق `payment_splits` و
-- `customer_payment_splits` لكنه لا يعترض على `card`: القيمة مقبولة في التعداد
-- وتسقط إلى حساب البنك 1111، فيبدو الصف سليمًا. محلّل التجزئة في الواجهة يعرف
-- القنوات الثلاث فقط، فصف `card` لا ينشئه أي مسار حقيقي — وهو بقية من إعداد
-- قديم تُنتج توزيعًا يخالف ما عرضه الكاشير. الصفوف التاريخية تبقى قابلة للتعديل
-- في حقولها الأخرى: التحديث الذي لا يغيّر القناة يمرّ بلا فحص.
CREATE OR REPLACE FUNCTION public.guard_split_tender_approved()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_method    text := lower(btrim(coalesce(to_jsonb(NEW) ->> TG_ARGV[0], '')));
  v_old       text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    v_old := lower(btrim(coalesce(to_jsonb(OLD) ->> TG_ARGV[0], '')));
    IF v_method IS NOT DISTINCT FROM v_old THEN
      RETURN NEW;
    END IF;
  END IF;

  -- ثلاث قنوات، لا «كل ما ليس البطاقة»: القائمة المسموحة تُغلق الباب على أي
  -- قيمة تاريخية أخرى (cheque) تُدخل من مسار RPC قديم.
  IF v_method NOT IN ('cash', 'bank_transfer', 'mobile_money') THEN
    RAISE EXCEPTION
      'قناة الدفع المجزأ "%" غير معتمدة. القنوات: نقداً، تحويل بنكي، محفظة إلكترونية.',
      coalesce(nullif(v_method, ''), '(فارغ)')
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END $$;

COMMENT ON FUNCTION public.guard_split_tender_approved() IS
  'لا يقبل في صف تجزئة جديد إلا القنوات الثلاث المعتمدة، ويترك الصفوف التاريخية كما هي.';

REVOKE ALL ON FUNCTION public.guard_split_tender_approved() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_split_tender_approved_customer ON public.customer_payment_splits;
CREATE TRIGGER trg_split_tender_approved_customer
  BEFORE INSERT OR UPDATE OF method ON public.customer_payment_splits
  FOR EACH ROW EXECUTE FUNCTION public.guard_split_tender_approved('method');

DROP TRIGGER IF EXISTS trg_split_tender_approved_document ON public.payment_splits;
CREATE TRIGGER trg_split_tender_approved_document
  BEFORE INSERT OR UPDATE OF method ON public.payment_splits
  FOR EACH ROW EXECUTE FUNCTION public.guard_split_tender_approved('method');

-- ── 3. توليد معرّف طريقة الدفع تحت قفل ─────────────────────────────────────
--
-- المنطق كله كما في الترحيل 16، إلا أن اختيار المعرّف التالي يقع على قفل
-- استشاري على الاسم المبدئي قبل فحص الوجود. القفل مرتبط بالمعاملة فيُحرَّر
-- تلقائيًا عند الالتزام أو التراجع، فلا يبقى معلّقًا على خطأ.
CREATE OR REPLACE FUNCTION public.create_tenant_payment_method(
  p_name_ar text,
  p_name_en text,
  p_icon_key text,
  p_legacy_id text,
  p_ledger_kind text,
  p_contexts text[] DEFAULT NULL::text[],
  p_requires_reference boolean DEFAULT true
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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
  v_suffix      integer := 1;
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

  -- أربع قيم فقط: الثلاث المعتمدة للتحصيل، مع `card` و`cheque` باقيتين للتوافق
  -- مع صفوف قديمة. ما تغيّر عن الترحيل 16 هو مسار التجزئة أدناه، لا هذه القائمة.
  v_legacy := lower(btrim(coalesce(p_legacy_id, '')));
  IF v_legacy NOT IN ('cash', 'card', 'bank_transfer', 'mobile_money', 'cheque') THEN
    RAISE EXCEPTION
      'القيمة المخزّنة "%" غير متاحة لطريقة تنشئها المنشأة (المتاح: cash, bank_transfer, mobile_money)',
      coalesce(p_legacy_id, '(فارغ)')
      USING ERRCODE = 'check_violation';
  END IF;

  -- العائلة تتبع القيمة المخزّنة، ولا تُقبل من المتصفح.
  v_kind := CASE v_legacy
              WHEN 'cash'           THEN 'CASH'
              WHEN 'bank_transfer'  THEN 'BANK'
              WHEN 'mobile_money'   THEN 'WALLET'
            END;

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

  IF EXISTS (
    SELECT 1 FROM public.payment_methods m
     WHERE m.is_active
       AND lower(btrim(m.name_ar)) = lower(v_name)
  ) THEN
    RAISE EXCEPTION 'توجد طريقة دفع مفعّلة بهذا الاسم: %', v_name
      USING ERRCODE = 'unique_violation';
  END IF;

  -- نفس اشتقاق الترحيل 16: الاسم الإنجليزي أولًا، وإلا معرّف الكتالوج المرجعي
  -- للقيمة المخزّنة، وإلا بادئة محايدة. الاسم العربي لا يُستخدم حرفيًا لأن قيد
  -- الجدول يشترط أن يكون المعرّف لاتينيًا صغيرًا.
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

  -- 🔒 مفتاح واحد لكل معرّف يُشتق من هذا الاسم. بدونه يقرأ طلبان متزامنان
  --    «غير موجود» فيختاران نفس المعرّف، فينجح أحدهما ويفشل الآخر بقيد التفرّد.
  PERFORM pg_advisory_xact_lock(hashtext('payment_method_id:' || v_base));

  v_auto_id := v_base;
  LOOP
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.payment_methods m WHERE m.id = v_auto_id);
    v_suffix := v_suffix + 1;
    v_auto_id := v_base || '_' || v_suffix::text;
  END LOOP;

  -- يُرتَّب بعد آخر صف قائم، فتظهر الطريقة المضافة حديثًا في نهاية ترتيب المشغّل.
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
  'إضافة طريقة دفع لم يشحنها المطورون: تُشتق قيمتها المخزّنة ونوع حسابها من اختيار المنشأة، والمعرّف يُولَّد تحت قفل استشاري بالاسم.';

REVOKE ALL ON FUNCTION public.create_tenant_payment_method(text, text, text, text, text, text[], boolean)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_tenant_payment_method(text, text, text, text, text, text[], boolean)
  TO authenticated, service_role;

-- ── 4. ربط طريقة الدفع بحساب افتراضي من الدليل ─────────────────────────────
--
-- القاعدة: يُقبل فقط حساب ينتمي إلى عائلة الطريقة (صندوق لِـ CASH، بنك لِـ BANK،
-- محفظة لِـ WALLET). الحساب التجميعي نفسه مرفوض: ربطه لا يحقّق شيئًا لأن
-- `payment_method_ledger_account()` يُرجعه أصلًا، والغرض هو تخصيص بنك بعينه
-- أو صندوق بعينه. `NULL` يعني «الرجوع إلى الافتراضي» وهو مسموح دائمًا.
CREATE OR REPLACE FUNCTION public.set_payment_method_default_account(
  p_method_id text,
  p_account_id uuid
)
RETURNS TABLE (payment_method_id text, default_account_id uuid, account_code text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_kind      text;
  v_acct      public.accounts;
  v_expected  text;
  v_expected_code text;
  v_in_family boolean;
BEGIN
  IF NOT public.can_author_payment_methods() THEN
    RAISE EXCEPTION 'لا تملك صلاحية تعديل طرق الدفع — هذه الصلاحية لصاحب المنشأة والمدير وسوبر أدمن المنصة'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT m.ledger_kind INTO v_kind
    FROM public.payment_methods m
   WHERE m.id = p_method_id AND m.is_active;
  IF v_kind IS NULL THEN
    RAISE EXCEPTION 'طريقة الدفع غير موجودة أو متوقفة: %', p_method_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF v_kind NOT IN ('CASH', 'BANK', 'WALLET') THEN
    RAISE EXCEPTION 'هذه الطريقة لا تُسوّى على حساب: %', p_method_id
      USING ERRCODE = 'check_violation';
  END IF;

  IF p_account_id IS NOT NULL THEN
    SELECT * INTO v_acct FROM public.accounts a WHERE a.id = p_account_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'الحساب غير موجود في دليل الحسابات' USING ERRCODE = 'foreign_key_violation';
    END IF;
    IF v_acct.is_postable IS NOT TRUE OR v_acct.is_active IS NOT TRUE THEN
      RAISE EXCEPTION 'الحساب "%" غير قابل للترحيل أو غير مفعّل', v_acct.code
        USING ERRCODE = 'check_violation';
    END IF;

    --
    -- مطابقة الكود المباشرة لا تكفي: الحسابات البنكية الفعلية تُنشأ تحت 1111
    -- بأكواد فرعية مثل 1111001، وحسابات المحافظ تحت 1131. فنقبل الكود نفسه أو
    -- أي كود يبدأ بادئته. وتُقبل أيضًا 1101 لصناديق تحمل حسابها الأصلي، لأن
    -- الصندوق الرئيسي في البذرة مرتبط بـ 1101 مباشرةً.
    v_expected := CASE v_kind WHEN 'CASH' THEN '1101' WHEN 'BANK' THEN '1111' ELSE '1131' END;
    v_expected_code := coalesce(public.payment_method_ledger_account(p_method_id), v_expected);

    v_in_family :=
      v_acct.code = v_expected
      OR v_acct.code LIKE v_expected || '%'
      OR v_acct.code = v_expected_code
      OR v_acct.code LIKE v_expected_code || '%';

    IF NOT v_in_family THEN
      RAISE EXCEPTION
        'الحساب "%" لا ينتمي إلى عائلة هذه الطريقة (المتوقع % أو أحد فروعه)',
        v_acct.code, v_expected
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  INSERT INTO public.payment_method_settings AS s (
    payment_method_id, enabled, sort_order, enabled_contexts, default_account_id,
    updated_at, updated_by
  )
  VALUES (
    p_method_id, true,
    coalesce((SELECT m.sort_order FROM public.payment_methods m WHERE m.id = p_method_id), 100),
    ARRAY[]::text[], p_account_id, now(), auth.uid()
  )
  ON CONFLICT (payment_method_id) DO UPDATE
    SET default_account_id = EXCLUDED.default_account_id,
        updated_at         = now(),
        updated_by         = auth.uid();

  RETURN QUERY
    SELECT s.payment_method_id, s.default_account_id, a.code
      FROM public.payment_method_settings s
      LEFT JOIN public.accounts a ON a.id = s.default_account_id
     WHERE s.payment_method_id = p_method_id;
END $$;

COMMENT ON FUNCTION public.set_payment_method_default_account(text, uuid) IS
  'تربط طريقة الدفع بحساب فرعي من عائلتها (صندوق/بنك/محفظة)، أو ترجعها للافتراضي بإرسال NULL.';

REVOKE ALL ON FUNCTION public.set_payment_method_default_account(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_payment_method_default_account(text, uuid)
  TO authenticated, service_role;

COMMIT;

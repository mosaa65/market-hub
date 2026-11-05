-- ============================================================================
-- 41_fix_tax_declaration_and_admin_completeness.sql
--
-- مكمّل لـ 39/40. 39 تُصلح **البيانات** و 40 تُصلح **السياسات**، لكن قاعدة
-- قائمة لا تنال تصحيحًا في 27 (تعريف الدالة) بمجرد تعديل ملف هجرة قديم.
-- لذلك هذا الملف يعيد تعريف الدالة بإصداره الصحيح، ثم يفرض اكتمال حسابات
-- المنصة بفحص أعمق من 39.
--
--   1) generate_tax_declaration: إعادة تعريف بالعمود الصحيح (created_at).
--      الحالة المكتشفة: الدالة على السحابة ما تزال تقرأ sales_invoices.
--      invoice_date (غير موجود) → 42703 عند كل استدعاء، فتسقط معها
--      settle_tax_period أيضًا (تستدعيها داخليًا).
--
--   2) settle_tax_period: يعاد تعريفه بنفس فحوص 27 المصححة، ليستحيل أن
--      تنتج تسوية صفرية صامتة من نطاق فارغ.
--
--   3) حسابات المنصة: إكمال فوري لأي صف في auth.users يملك بريدًا من قائمة
--      المنصة لكنه ناقص identities/profiles/platform_admins/user_roles —
--      بما في ذلك الحساب الرابع (a000…004) و أي حساب أضافه المالك لاحقًا.
--
--   4) دالة فحص دائمة platform_admin_audit() ترجع تقريرًا بكل نقص — يستدعيها
--      الـ CLI وسكربت CI، ويمكن استدعاؤها يدويًا بعد أي نشر.
--
-- ثابت، ولا يغيّر كلمات المرور ولا يُفعّل حسابًا أوقفه المالك.
-- ============================================================================

BEGIN;

-- ── (1) الإقرار الضريبي: التعريف الصحيح ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.generate_tax_declaration(
  p_start_date date,
  p_end_date   date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user          uuid := auth.uid();
  v_sales_taxable numeric(18,2) := 0;
  v_output_tax    numeric(18,2) := 0;
  v_purch_taxable numeric(18,2) := 0;
  v_input_tax     numeric(18,2) := 0;
  v_net_tax       numeric(18,2) := 0;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  IF p_start_date IS NULL OR p_end_date IS NULL THEN
    RAISE EXCEPTION 'Tax declaration needs both start_date and end_date'
      USING ERRCODE = '22023';
  END IF;
  IF p_end_date < p_start_date THEN
    RAISE EXCEPTION 'Tax declaration end_date (%) is before start_date (%)', p_end_date, p_start_date
      USING ERRCODE = '22023';
  END IF;

  -- 1) ضريبة المخرجات من القيود المرحلة لحساب 2311 (رصيد دائن)
  SELECT coalesce(sum(jl.credit - jl.debit), 0)
    INTO v_output_tax
    FROM public.journal_lines jl
    JOIN public.journal_entries je ON je.id = jl.entry_id
    JOIN public.accounts a ON a.id = jl.account_id
   WHERE a.code = '2311'
     AND je.status = 'POSTED'
     AND je.source_type <> 'tax_settlement'
     AND je.entry_date BETWEEN p_start_date AND p_end_date;

  -- 2) ضريبة المدخلات من القيود المرحلة لحساب 1316 (رصيد مدين)
  SELECT coalesce(sum(jl.debit - jl.credit), 0)
    INTO v_input_tax
    FROM public.journal_lines jl
    JOIN public.journal_entries je ON je.id = jl.entry_id
    JOIN public.accounts a ON a.id = jl.account_id
   WHERE a.code = '1316'
     AND je.status = 'POSTED'
     AND je.source_type <> 'tax_settlement'
     AND je.entry_date BETWEEN p_start_date AND p_end_date;

  -- 3) إجمالي المبيعات الخاضعة للضريبة.
  --    ⚠️ sales_invoices ليس فيها invoice_date. التاريخ التشغيلي هو created_at
  --    (نفس ما تعتمده تقارير 12 ويومية الترحيل). المقارنة نصف مفتوحة كي لا
  --    تسقط فواتير آخر يوم في الفترة.
  SELECT coalesce(sum(subtotal), 0)
    INTO v_sales_taxable
    FROM public.sales_invoices
   WHERE status = 'confirmed'
     AND created_at >= p_start_date::timestamptz
     AND created_at <  (p_end_date + 1)::timestamptz;

  -- 4) إجمالي المشتريات في الفترة
  SELECT coalesce(sum(subtotal), 0)
    INTO v_purch_taxable
    FROM public.purchase_invoices
   WHERE status = 'confirmed'
     AND created_at >= p_start_date::timestamptz
     AND created_at <  (p_end_date + 1)::timestamptz;

  v_net_tax := v_output_tax - v_input_tax;

  RETURN jsonb_build_object(
    'start_date', p_start_date,
    'end_date', p_end_date,
    'taxable_sales', v_sales_taxable,
    'output_tax', v_output_tax,
    'taxable_purchases', v_purch_taxable,
    'input_tax', v_input_tax,
    'net_tax_payable', v_net_tax
  );
END $$;

REVOKE ALL ON FUNCTION public.generate_tax_declaration(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.generate_tax_declaration(date, date) TO authenticated, service_role;

COMMENT ON FUNCTION public.generate_tax_declaration(date, date) IS
  'T-23: أرقام الإقرار الضريبي للفترة. تاريخ الفواتير = created_at (لا يوجد invoice_date في المخطط).';

-- ── (2) settle_tax_period: إعادة تعريف كاملة ─────────────────────────────────
-- لماذا كاملة لا «فحص ثم رجاء»: الدالة SECURITY DEFINER تستدعي
-- generate_tax_declaration داخليًا. لو بقيت نسخة قديمة على قاعدة قائمة
-- لبقيت التسوية معطلة، ولو تركناها لفحص نصي هشّ لتعطّل البناء عند أي
-- تنسيق مختلف. التعريف الكامل أدناه قطعي: نفس منطق 27 المصحح + رفض النطاق
-- الفارغ + رفض التسوية الصفرية.
CREATE OR REPLACE FUNCTION public.settle_tax_period(
  p_start_date      date,
  p_end_date        date,
  p_period_number   text,
  p_settlement_date date DEFAULT CURRENT_DATE
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user          uuid := auth.uid();
  v_decl          jsonb;
  v_output_tax    numeric(18,2);
  v_input_tax     numeric(18,2);
  v_net_tax       numeric(18,2);
  v_sales         numeric(18,2);
  v_purch         numeric(18,2);
  v_lines         jsonb := '[]'::jsonb;
  v_entry_id      uuid;
  v_settle_id     uuid;
  v_memo          text;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  -- نطاق وسياق إلزاميان: بدونهما كان يُنشأ قيد تسوية بقيمة صفر (أثر كاذب).
  IF p_start_date IS NULL OR p_end_date IS NULL
     OR nullif(btrim(coalesce(p_period_number, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Tax settlement requires start_date, end_date and period_number'
      USING ERRCODE = '22023';
  END IF;
  IF p_end_date < p_start_date THEN
    RAISE EXCEPTION 'Tax settlement end_date (%) is before start_date (%)', p_end_date, p_start_date
      USING ERRCODE = '22023';
  END IF;

  IF NOT (public.has_role(v_user, 'owner')
          OR public.has_role(v_user, 'manager')
          OR public.has_role(v_user, 'accountant')) THEN
    RAISE EXCEPTION 'Only an owner, manager or accountant may settle taxes'
      USING ERRCODE = '42501';
  END IF;

  PERFORM public.assert_period_open(p_settlement_date);

  IF EXISTS (
    SELECT 1 FROM public.tax_settlement_periods
     WHERE period_number = p_period_number
  ) THEN
    RAISE EXCEPTION 'Tax period % already exists or settled', p_period_number;
  END IF;

  -- قراءة أرقام الإقرار (النسخة السليمة)
  v_decl := public.generate_tax_declaration(p_start_date, p_end_date);
  v_sales      := (v_decl->>'taxable_sales')::numeric;
  v_output_tax := (v_decl->>'output_tax')::numeric;
  v_purch      := (v_decl->>'taxable_purchases')::numeric;
  v_input_tax  := (v_decl->>'input_tax')::numeric;
  v_net_tax    := (v_decl->>'net_tax_payable')::numeric;

  IF coalesce(v_output_tax, 0) = 0 AND coalesce(v_input_tax, 0) = 0 THEN
    RAISE EXCEPTION 'لا توجد حركات ضريبية مرحّلة للفترة المحددة لتسويتها'
      USING ERRCODE = '22023';
  END IF;

  -- بناء قيد التسوية المتوازن:
  IF v_output_tax > 0 THEN
    v_lines := v_lines || jsonb_build_array(
      jsonb_build_object(
        'account_code', '2311', 'debit', v_output_tax, 'credit', 0,
        'memo', 'تسوية ضريبة المخرجات للفترة ' || p_period_number
      )
    );
  END IF;

  IF v_input_tax > 0 THEN
    v_lines := v_lines || jsonb_build_array(
      jsonb_build_object(
        'account_code', '1316', 'debit', 0, 'credit', v_input_tax,
        'memo', 'تسوية ضريبة المدخلات للفترة ' || p_period_number
      )
    );
  END IF;

  IF v_net_tax > 0 THEN
    v_lines := v_lines || jsonb_build_array(
      jsonb_build_object(
        'account_code', '2321', 'debit', 0, 'credit', v_net_tax,
        'memo', 'صافي ضريبة القيمة المضافة المستحقة للدفع — ' || p_period_number
      )
    );
  ELSIF v_net_tax < 0 THEN
    v_lines := v_lines || jsonb_build_array(
      jsonb_build_object(
        'account_code', '2321', 'debit', -v_net_tax, 'credit', 0,
        'memo', 'رصيد ضريبة مدخلات فائض مسترد/مرحل — ' || p_period_number
      )
    );
  END IF;

  v_memo := 'قيد التسوية والإقرار الضريبي للفترة ' || p_period_number ||
            ' (' || to_char(p_start_date, 'YYYY-MM-DD') || ' إلى ' || to_char(p_end_date, 'YYYY-MM-DD') || ')';

  v_entry_id := public.create_journal_entry(
    v_memo, p_settlement_date, 'tax_settlement', NULL, true, v_lines, false
  );

  INSERT INTO public.tax_settlement_periods (
    period_number, start_date, end_date, total_taxable_sales,
    output_tax_amount, total_taxable_purchases, input_tax_amount,
    net_tax_payable, status, journal_entry_id, settled_at, settled_by
  )
  VALUES (
    btrim(p_period_number), p_start_date, p_end_date, v_sales,
    v_output_tax, v_purch, v_input_tax,
    v_net_tax, 'SETTLED', v_entry_id, now(), v_user
  )
  RETURNING id INTO v_settle_id;

  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, payload)
  VALUES (v_user, 'tax.settled', 'tax_settlement', v_settle_id,
          jsonb_build_object('period_number', p_period_number, 'net_tax', v_net_tax, 'entry_id', v_entry_id));

  RETURN v_settle_id;
END $$;

REVOKE ALL ON FUNCTION public.settle_tax_period(date, date, text, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.settle_tax_period(date, date, text, date) TO authenticated, service_role;

COMMENT ON FUNCTION public.settle_tax_period(date, date, text, date) IS
  'T-23: قيد تسوية 2311/1316 والفرق إلى 2321. يرفض النطاق الفارغ والتسوية الصفرية.';

-- ── (3) إكمال حسابات المنصة الموجودة مسبقًا في auth.users ──────────────────
-- قائمة المنصة الحقيقية: صفوف platform_admins **أو** بريد معروف. الاجتماع
-- بين الشرطين يسمح بإضافة سوبر أدمن جديد من الواجهة (شاشة المنصة) ثم
-- تكتمل صفوفه تلقائيًا عند أول هجرة لاحقة، بلا لمس البذرة.
WITH admins AS (
  SELECT u.id AS user_id,
         coalesce(nullif(btrim(p.full_name), ''), split_part(u.email, '@', 1)) AS full_name,
         p.phone AS phone
  FROM auth.users u
  LEFT JOIN public.profiles p ON p.id = u.id
  WHERE u.deleted_at IS NULL
    AND (
      EXISTS (SELECT 1 FROM public.platform_admins pa WHERE pa.user_id = u.id)
      OR lower(u.email) IN (
        'mousa.mc13@gmail.com', 'shoeabvv@gmail.com',
        'emadfasill2001@gmail.com', 'ahmedhetar15@gmail.com'
      )
    )
)
INSERT INTO public.profiles (id, full_name, phone, language, theme, is_active)
SELECT a.user_id, a.full_name, a.phone, 'ar', 'dark', true
FROM admins a
ON CONFLICT (id) DO UPDATE
  SET full_name = COALESCE(NULLIF(btrim(public.profiles.full_name), ''), EXCLUDED.full_name),
      phone     = COALESCE(public.profiles.phone, EXCLUDED.phone),
      updated_at = now();

-- الهوية: بريد
WITH admins AS (
  SELECT u.id AS user_id, u.email
  FROM auth.users u
  WHERE u.deleted_at IS NULL
    AND (
      EXISTS (SELECT 1 FROM public.platform_admins pa WHERE pa.user_id = u.id)
      OR lower(u.email) IN (
        'mousa.mc13@gmail.com', 'shoeabvv@gmail.com',
        'emadfasill2001@gmail.com', 'ahmedhetar15@gmail.com'
      )
    )
)
INSERT INTO auth.identities (id, user_id, provider_id, provider, identity_data, created_at, updated_at, last_sign_in_at)
SELECT gen_random_uuid(), a.user_id, a.user_id::text, 'email',
       jsonb_build_object('sub', a.user_id::text, 'email', a.email,
                          'email_verified', true, 'phone_verified', true),
       now(), now(), NULL
FROM admins a
ON CONFLICT (provider, provider_id) DO NOTHING;

-- الهوية: هاتف (فقط لمن له رقم وكلمة مرور/هوية بريد — لا هوية هاتف بلا رقم)
WITH admins AS (
  SELECT u.id AS user_id, u.phone
  FROM auth.users u
  WHERE u.deleted_at IS NULL
    AND nullif(btrim(coalesce(u.phone, '')), '') IS NOT NULL
    AND (
      EXISTS (SELECT 1 FROM public.platform_admins pa WHERE pa.user_id = u.id)
      OR lower(u.email) IN (
        'mousa.mc13@gmail.com', 'shoeabvv@gmail.com',
        'emadfasill2001@gmail.com', 'ahmedhetar15@gmail.com'
      )
    )
)
INSERT INTO auth.identities (id, user_id, provider_id, provider, identity_data, created_at, updated_at, last_sign_in_at)
SELECT gen_random_uuid(), a.user_id, a.user_id::text, 'phone',
       jsonb_build_object('sub', a.user_id::text, 'email_verified', false, 'phone_verified', true),
       now(), now(), NULL
FROM admins a
WHERE NOT EXISTS (
  SELECT 1 FROM auth.identities i
  WHERE i.user_id = a.user_id AND i.provider = 'phone'
);

-- دور المتجر: owner لكل مسؤول منصة (الكود يعتمد على has_role في كل سياسة)
INSERT INTO public.user_roles (user_id, role)
SELECT pa.user_id, 'owner'::public.app_role
FROM public.platform_admins pa
WHERE NOT EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = pa.user_id)
ON CONFLICT DO NOTHING;

-- صف المنصة: من هو مسؤول منصة **بالكود** ولم يُدرج صفه، يُدرج كـ support
-- (أقل صلاحية) لا superadmin — الترقية قرار بشري من الواجهة.
INSERT INTO public.platform_admins (user_id, role, is_active, mfa_required)
SELECT u.id, 'support', true, false
FROM auth.users u
WHERE u.deleted_at IS NULL
  AND lower(u.email) IN (
    'mousa.mc13@gmail.com', 'shoeabvv@gmail.com',
    'emadfasill2001@gmail.com', 'ahmedhetar15@gmail.com'
  )
  AND NOT EXISTS (SELECT 1 FROM public.platform_admins pa WHERE pa.user_id = u.id)
ON CONFLICT (user_id) DO NOTHING;

-- ── (4) دالة الفحص الدائمة ──────────────────────────────────────────────────
-- تقرير واحد يجيب: ما الذي ينقص حسابات المنصة الآن؟
CREATE OR REPLACE FUNCTION public.platform_admin_audit()
RETURNS TABLE (
  user_id        uuid,
  email          text,
  platform_role  text,
  is_active      boolean,
  has_email_id   boolean,
  has_phone_id   boolean,
  has_profile    boolean,
  has_store_role boolean,
  is_superadmin  boolean,
  problems       text[]
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    pa.user_id,
    u.email::text,
    pa.role,
    pa.is_active,
    EXISTS (SELECT 1 FROM auth.identities i WHERE i.user_id = pa.user_id AND i.provider = 'email'),
    EXISTS (SELECT 1 FROM auth.identities i WHERE i.user_id = pa.user_id AND i.provider = 'phone'),
    EXISTS (SELECT 1 FROM public.profiles p       WHERE p.id      = pa.user_id),
    EXISTS (SELECT 1 FROM public.user_roles r     WHERE r.user_id = pa.user_id),
    public.is_platform_superadmin(pa.user_id),
    array_remove(ARRAY[
      CASE WHEN u.id IS NULL                    THEN 'missing auth.users'                END,
      CASE WHEN u.deleted_at IS NOT NULL         THEN 'auth user deleted'                 END,
      CASE WHEN u.email_confirmed_at IS NULL     THEN 'email not confirmed'                END,
      CASE WHEN u.banned_until > now()           THEN 'auth user banned'                  END,
      CASE WHEN NOT EXISTS (SELECT 1 FROM auth.identities i WHERE i.user_id = pa.user_id AND i.provider = 'email')
                                                 THEN 'missing email identity'            END,
      CASE WHEN NOT EXISTS (SELECT 1 FROM auth.identities i WHERE i.user_id = pa.user_id AND i.provider = 'phone')
                                                 THEN 'missing phone identity'            END,
      CASE WHEN NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = pa.user_id)
                                                 THEN 'missing profile'                   END,
      CASE WHEN NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = pa.user_id AND p.is_active)
                                                 THEN 'profile inactive (is_staff = false)' END,
      CASE WHEN NOT EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = pa.user_id)
                                                 THEN 'missing store role (RLS hides everything)' END,
      CASE WHEN pa.role = 'superadmin' AND NOT public.is_platform_superadmin(pa.user_id)
                                                 THEN 'superadmin row does not satisfy the predicate' END,
      CASE WHEN pa.role = 'support' AND public.is_platform_superadmin(pa.user_id)
                                                 THEN 'support account satisfies superadmin predicate' END
    ], NULL) AS problems
  FROM public.platform_admins pa
  LEFT JOIN auth.users u ON u.id = pa.user_id
  ORDER BY pa.role DESC, u.email;
$$;

COMMENT ON FUNCTION public.platform_admin_audit() IS
  'تقرير اكتمال حسابات المنصة: أي مشكلة في الهوية أو الملف أو الأدوار أو تعارض الدالة. يعيد صفوفًا بلا مشاكل أيضًا (problems = {}).';

REVOKE ALL ON FUNCTION public.platform_admin_audit() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_admin_audit() TO authenticated, service_role;

-- ── (5) التحقق النهائي ──────────────────────────────────────────────────────
DO $$
DECLARE
  v_bad text;
BEGIN
  -- لا حساب منصة بنقص في أي عمود (عدا is_active لحساب أوقفه المالك)
  SELECT string_agg(a.email || ' → ' || array_to_string(a.problems, ' | '), E'\n')
    INTO v_bad
  FROM public.platform_admin_audit() a
  WHERE a.problems <> '{}'::text[]
    AND NOT ('profile inactive (is_staff = false)' = ANY (a.problems) AND a.is_active = false);
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'حسابات منصة ناقصة بعد الإصلاح: %', E'\n' || v_bad;
  END IF;

  -- الأربعة المعروفون: يجب أن يكونوا موجودين فعليًا
  IF (SELECT count(*) FROM public.platform_admins
       WHERE user_id IN ('a0000000-0000-4000-a000-000000000001',
                         'a0000000-0000-4000-a000-000000000002',
                         'a0000000-0000-4000-a000-000000000003',
                         'a0000000-0000-4000-a000-000000000004')) < 4 THEN
    RAISE EXCEPTION 'الملفات الأربعة لحسابات المنصة غير مكتملة في platform_admins';
  END IF;

  -- الدالة الضريبية السارية لا تقرأ عمودًا غير موجود
  IF position('invoice_date' IN regexp_replace(
       pg_get_functiondef('public.generate_tax_declaration(date,date)'::regprocedure),
       '--[^\n]*', '', 'g')) > 0 THEN
    RAISE EXCEPTION 'generate_tax_declaration ما يزال يقرأ invoice_date بعد الإصلاح';
  END IF;
END $$;

COMMIT;

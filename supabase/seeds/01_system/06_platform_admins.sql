-- ============================================================================
-- 06_platform_admins.sql — مسؤولو المنصة (سوبر أدمن ودعم)
-- ============================================================================
--
-- ما هذا الملف؟
--   حسابات المنصة التي تدير النظام فوق مستوى المتاجر: السوبر أدمن والدعم.
--   تُزرع هنا **بحساب مصادقة حقيقي** — لا صفوف في جدول بلا مستخدم يستطيع
--   تسجيل الدخول.
--
-- لماذا هو ملف نظام (يُشغَّل تلقائيًا)؟
--   لأن بلا مسؤول منصة، لا يستطيع أحد إدارة الباقات أو الوحدات أو تفعيل
--   الاشتراكات. النظام يُبنى كاملًا في db reset، ولو لم يوجد مسؤول لكانت
--   اللوحة الإدارية غير قابلة للوصول أصلاً.
--
-- ── لماذا في seed لا في migration؟ ──────────────────────────────────────────
--   لأن الترحيل بنية (جداول وأعمدة ودوال)، وهذا **بيانات** (صفوف مستخدمين).
--   والترحيل يُطبَّق مرة واحدة لا تُلغى، أما البيانات فتُشغَّل وتُعدَّل.
--   راجع supabase/MIGRATIONS_RULES.md.
--
-- ── لماذا Auth وليس صفوف جدول فقط؟ ──────────────────────────────────────────
--   لو أدرجنا في platform_admins فقط لأعطينا المستخدم صلاحية **لا يستطيع
--   استخدامها**: لا صف في auth.users يعني لا تسجيل دخول، ولا هوية يُبنى عليها
--   auth.uid(). فالصلاحية بلا حساب وهم.
--
--   لذلك يُدرج الملف في أربعة جداول مترابطة:
--     1. auth.users        ← الهوية وكلمة المرور (مشفّرة)
--     2. auth.identities   ← طريقة الدخول (بريد/هاتف) عند GoTrue
--     3. public.profiles   ← الاسم الظاهر والهاتف واللغة
--     4. public.platform_admins ← دور المنصة (superadmin / support)
--
-- ── الأدوار ─────────────────────────────────────────────────────────────────
--   superadmin : صلاحية كاملة على المنصة (الباقات، الوحدات، الإدارة).
--   support    : قراءة للدعم — لا يحقّق is_platform_superadmin ولا يرى
--                لوحات الإدارة. القيد في الجدول يسمح بهاتين القيمتين فقط.
--
-- ── لماذا CTE ولا جدول مؤقت؟ ────────────────────────────────────────────────
--   Supabase CLI يرسل ملف البذرة عبر PostgREST، والجداول المؤقتة (TEMP TABLE)
--   لا تُرى في هذا السياق فيفشل الملف بـ «relation does not exist». الـ CTE
--   (WITH ... VALUES) محمول: يُكتب داخل كل عبارة، ولا يحتاج حالة بين العبارات.
--
--   كذلك لا نعتمد على دالة مساعدة مؤقتة، لأن كل عبارة قد تُنفَّذ في جلسة
--   مختلفة. الـ CTE أطول قليلًا لكنه لا يفشل.
--
-- ── ⚠️ كلمات المرور ──────────────────────────────────────────────────────────
--   هذه كلمات مرور **تطوير محلي فقط**، مكتوبة صراحةً هنا بطلب صاحب المشروع
--   لتسهيل التهيئة الأولى. عند النشر لعميل حقيقي **غيّرها فورًا** من التطبيق،
--   أو احذف هذا الملف من التشغيل التلقائي.
--
-- ثابت (Idempotent): يُشغَّل أكثر من مرة بأمان — كل إدراج بـ ON CONFLICT.
-- المرجع: supabase/MIGRATIONS_RULES.md — القاعدتان R-19 و R-30.
-- ============================================================================

BEGIN;

-- ── المتطلب: pgcrypto ───────────────────────────────────────────────────────
-- crypt() و gen_salt() هما ما يشفّر كلمة المرور بالصيغة التي يفهمها GoTrue
-- (bcrypt). يُستدعى بمخططه الصريح (extensions.crypt) لأن search_path هنا لا
-- يشمل extensions — وهذا هو الصحيح أمنيًا أيضًا: لا نوسّع search_path لدالة
-- تشفير، بل نسمّيها كاملة.
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

DO $$
BEGIN
  IF to_regprocedure('extensions.crypt(text, text)') IS NULL THEN
    RAISE EXCEPTION 'pgcrypto.crypt غير متاح في مخطط extensions — لا يمكن تشفير كلمات المرور';
  END IF;
END $$;

-- ── 1) auth.users ───────────────────────────────────────────────────────────
-- الأعمدة غير الظاهرة (instance_id, aud, role) إلزامية عند GoTrue لقبول الصف:
--   instance_id = '00000000-0000-0000-0000-000000000000'  ← التثبيت الواحد
--   aud         = 'authenticated'                          ← جمهور الرمز
--   role        = 'authenticated'                          ← دور Postgres
--
-- email_confirmed_at و phone_confirmed_at مملوءان: هذه حسابات إدارية جاهزة،
--   لا تنتظر تأكيد بريد أو رسالة SMS.
-- raw_app_meta_data يحمل 'provider' و'providers' — بدونهما ترفض الواجهة
--   الجلسة وتعيد المستخدم إلى صفحة الدخول.
--
-- المعرّفات ثابتة (UUID مكتوبة صراحةً) لا عشوائية: المعرّف العشوائي يتغيّر مع
--   كل تشغيل فينشئ مستخدمًا جديدًا كل مرة — وهو عكس المطلوب من بذرة ثابتة.
WITH seed(user_id, email, phone, password, full_name, role) AS (VALUES
  ('a0000000-0000-4000-a000-000000000001'::uuid, 'mousa.mc13@gmail.com',     '+967772217218', 'Super#2004',   'موسى العواضي',  'superadmin'),
  ('a0000000-0000-4000-a000-000000000002'::uuid, 'shoeabvv@gmail.com',       '+967772317950', 'Super#2004',   'يونس العفيف',   'superadmin'),
  ('a0000000-0000-4000-a000-000000000003'::uuid, 'emadfasill2001@gmail.com', '+967784795104', 'Super#2004', 'عماد الجماعي', 'support'),
  ('a0000000-0000-4000-a000-000000000004'::uuid, 'ahmedhetar15@gmail.com', '+967779121636', 'Super#2004', 'أحمد الهتار', 'superadmin')
)
INSERT INTO auth.users (
  id, instance_id, aud, role,
  email, phone,
  encrypted_password,
  email_confirmed_at, phone_confirmed_at,
  raw_app_meta_data, raw_user_meta_data,
  confirmation_token, recovery_token, email_change, email_change_token_new,
  created_at, updated_at
)
SELECT
  s.user_id,
  '00000000-0000-0000-0000-000000000000'::uuid,
  'authenticated',
  'authenticated',
  s.email,
  -- ⚠️ الهاتف يُخزَّن **بلا علامة +** — هكذا يخزّنه GoTrue نفسه (تحقّقنا من
  -- مستخدم أنشأه signup بالهاتف: خزّن 967700000009 لا +967700000009).
  -- وبصيغة + لا يجد GoTrue المستخدم عند الدخول بالهاتف، فيعيد
  -- invalid_credentials رغم صحة الرقم وكلمة المرور.
  replace(s.phone, '+', ''),
  extensions.crypt(s.password, extensions.gen_salt('bf')),
  now(),
  now(),
  jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email', 'phone')),
  jsonb_build_object('full_name', s.full_name),
  -- هذه الأعمدة افتراضها NULL في المخطط، لكن GoTrue يقرأها كـ string عند
  -- الدخول فيفشل بـ «converting NULL to string is unsupported» ويعيد 500.
  -- النص الفارغ هو ما يكتبه GoTrue نفسه، فنطابقه.
  '', '', '', '',
  now(),
  now()
FROM seed s
ON CONFLICT (id) DO UPDATE
  SET encrypted_password = EXCLUDED.encrypted_password
  WHERE auth.users.encrypted_password IS NULL
    AND auth.users.email = EXCLUDED.email;

-- ── 2) auth.identities ──────────────────────────────────────────────────────
-- GoTrue لا يقرأ البريد من auth.users مباشرة عند الدخول، بل من هنا — صف لكل
-- «هوية» (بريد، هاتف). بلا هذا الصف: كلمة المرور صحيحة ومع ذلك يفشل الدخول.
--
-- provider_id هو نفسه المعرّف، والتفرد على (provider, provider_id).
-- ملاحظة: عمود email في هذا الجدول **مُولَّد** (generated) من identity_data،
-- فلا يُكتب صراحةً — كتابته ترمي «cannot insert a non-DEFAULT value».
WITH seed(user_id, email, phone) AS (VALUES
  ('a0000000-0000-4000-a000-000000000001'::uuid, 'mousa.mc13@gmail.com',     '+967772217218'),
  ('a0000000-0000-4000-a000-000000000002'::uuid, 'shoeabvv@gmail.com',       '+967772317950'),
  ('a0000000-0000-4000-a000-000000000003'::uuid, 'emadfasill2001@gmail.com', '+967784795104'),
  ('a0000000-0000-4000-a000-000000000004'::uuid, 'ahmedhetar15@gmail.com',   '+967779121636')
)
INSERT INTO auth.identities (
  id, user_id, provider_id, provider,
  identity_data,
  created_at, updated_at,
  last_sign_in_at
)
SELECT
  gen_random_uuid(),
  s.user_id,
  s.user_id::text,
  'email',
  jsonb_build_object(
    'sub', s.user_id::text,
    'email', s.email,
    'email_verified', true,
    'phone_verified', true,
    'phone', s.phone
  ),
  now(),
  now(),
  NULL
FROM seed s
ON CONFLICT (provider, provider_id) DO NOTHING;

-- ── 2ب) auth.identities — هوية الهاتف ────────────────────────────────────────
-- GoTrue يبحث عن المستخدم عند الدخول **بالهاتف** في provider = 'phone'، لا في
-- عمود auth.users.phone. فوجود الرقم في العمود وحده لا يكفي: بلا هذا الصف
-- يعيد الدخول بالهاتف «invalid_credentials» رغم أن الرقم وكلمة المرور صحيحان.
--
-- ⚠️ shape هذه الهوية مأخوذ من مستخدم أنشأه GoTrue بنفسه (signup بالهاتف)
-- وقارنّاه به، لا من تخمين:
--   provider_id   = **معرّف المستخدم** (UUID)، لا رقم الهاتف!
--   identity_data = sub + email_verified + phone_verified فقط، بلا حقل phone.
--
-- المحاولة الأولى وضعت provider_id = رقم الهاتف، ففشل الدخول رغم صحة كل شيء
-- آخر. GoTrue لا يستدلّ على المستخدم بـ provider_id هنا، بل بجدول users.phone،
-- والتفرد على (provider, provider_id) هو ما يمنع صفين لنفس المستخدم.
--
-- ⚠️ إصلاح 2026-10-21 — سبب فشل تسجيل الدخول بالهاتف على الإنتاج:
--   كانت البذرة تزرع هوية الهاتف بـ identity_data **بلا حقل `phone`**. هذا
--   الصف يُقبل، لكنه لا يطابق أي رقم فيبحث GoTrue بلا نتيجة ويعيد
--   invalid_credentials رغم صحة الرقم وكلمة المرور (auth.users.phone كان
--   صحيحًا!). البيانات الحقيقية على المشروع أظهرت الهوية هكذا:
--     {"email_verified": false, "phone_verified": true, "sub": "<uuid>"}
--   أي معرف بلا رقم. Supabase نفسه يكتب الرقم في identity_data.phone،
--   فصار الـseed يطابقه. لكن ON CONFLICT DO NOTHING لا يصلح الصف المعطوب
--   القائم، فتحوّل إلى DO UPDATE يكتب identity_data الصحيحة.
--   إن كانت البيئة تعتمد على الدخول بالهاتف شغّل هذا الملف مرة بعد النشر.
WITH seed(user_id, phone) AS (VALUES
  ('a0000000-0000-4000-a000-000000000001'::uuid, '+967772217218'),
  ('a0000000-0000-4000-a000-000000000002'::uuid, '+967772317950'),
  ('a0000000-0000-4000-a000-000000000003'::uuid, '+967784795104'),
  ('a0000000-0000-4000-a000-000000000004'::uuid, '+967779121636')
)
INSERT INTO auth.identities (
  id, user_id, provider_id, provider,
  identity_data,
  created_at, updated_at,
  last_sign_in_at
)
SELECT
  gen_random_uuid(),
  s.user_id,
  s.user_id::text,
  'phone',
  jsonb_build_object(
    'sub', s.user_id::text,
    'email_verified', false,
    'phone_verified', true,
    -- الرقم إلزامي هنا: بلا هذا الحقل لا تجد قراءة الهوية شيئًا ليطابقه
    -- GoTrue فيعيد invalid_credentials رغم صحة الرقم في auth.users.phone.
    'phone', s.phone
  ),
  now(),
  now(),
  NULL
FROM seed s
ON CONFLICT (provider, provider_id) DO UPDATE
  SET identity_data = EXCLUDED.identity_data,
      updated_at    = now();

-- ── 3) public.profiles ──────────────────────────────────────────────────────
-- الاسم الظاهر واللغة. العربية 'ar' و«الوضع الداكن» ليكونا الافتراضي عند أول
-- دخول بدل إعدادات إنجليزية تُربك المستخدم العربي.
--
-- ملاحظة: مُشغّل handle_new_user على auth.users يكتب هذا الصف تلقائيًا عند
-- إدراج المستخدم أعلاه. الإدراج هنا **مقصود** رغم ذلك: يضمن الحقول التي لا
-- يعرفها المُشغّل (الهاتف)، ويصحّح الاسم لو تغيّر، ويجعل الملف مستقلًا لا
-- يعتمد على ترتيب تشغيل المُشغّلات.
WITH seed(user_id, full_name, phone) AS (VALUES
  ('a0000000-0000-4000-a000-000000000001'::uuid, 'موسى العواضي',  '+967772217218'),
  ('a0000000-0000-4000-a000-000000000002'::uuid, 'يونس العفيف',   '+967772317950'),
  ('a0000000-0000-4000-a000-000000000003'::uuid, 'عماد الجماعي', '+967784795104'),
  ('a0000000-0000-4000-a000-000000000004'::uuid, 'أحمد الهتار',   '+967779121636')
)
INSERT INTO public.profiles (id, full_name, phone, language, theme, is_active)
SELECT s.user_id, s.full_name, s.phone, 'ar', 'dark', true
FROM seed s
ON CONFLICT (id) DO UPDATE
  SET full_name  = EXCLUDED.full_name,
      phone      = EXCLUDED.phone,
      is_active  = true,
      updated_at = now();

-- ── 4) public.platform_admins ───────────────────────────────────────────────
-- دور المنصة نفسه — هو ما تقرأه is_platform_superadmin.
-- القيد على الجدول يسمح بـ 'superadmin' و'support' فقط.
WITH seed(user_id, role, mfa_required) AS (VALUES
  ('a0000000-0000-4000-a000-000000000001'::uuid, 'superadmin', false),
  ('a0000000-0000-4000-a000-000000000002'::uuid, 'superadmin', false),
  ('a0000000-0000-4000-a000-000000000003'::uuid, 'support',    false),
  ('a0000000-0000-4000-a000-000000000004'::uuid, 'superadmin', false)
)
INSERT INTO public.platform_admins (user_id, role, is_active, mfa_required)
SELECT s.user_id, s.role, true, s.mfa_required
FROM seed s
ON CONFLICT (user_id) DO UPDATE
  SET role         = EXCLUDED.role,
      is_active    = true,
      mfa_required = EXCLUDED.mfa_required;

-- ── 5) public.user_roles — دور المتجر ────────────────────────────────────────
--
-- ⚠️ هذا القسم هو الإصلاح الحاسم (2026-10-13):
--
-- كانت البذرة تزرع دور المنصة (platform_admins) وتترك دور المتجر فارغاً —
-- والنتيجة: مستخدم يدخل بنجاح ورؤية صفر في كل الشاشات. كل سياسات RLS
-- للتطبيق (prod_view · can_read_finance · can_operate_milling ·
-- expense policies …) تعتمد على is_staff() / has_role() — وهما يقرآن
-- هذا الجدول. بلا صف هنا: is_staff = false، فكل سياسة تُخفي كل شيء.
--
-- دور 'owner' هو الأوسع: يرى كل الشاشات ويدير كل شيء — وهو الدور الصحيح
-- لصاحب المنشأة. ملاحظة على المستخدم الرابع: صف auth.users له يوجد في
-- قسم 1 (أُضيف لاحقاً) لكن بقية جداوله في القوائم أعلاه — أزرع دوره هنا
-- كذلك حتى لا يكون لدينا حساب يستطيع الدخول ولا يرى شيئاً.
--
WITH seed(user_id, role) AS (VALUES
  ('a0000000-0000-4000-a000-000000000001'::uuid, 'owner'),
  ('a0000000-0000-4000-a000-000000000002'::uuid, 'owner'),
  ('a0000000-0000-4000-a000-000000000003'::uuid, 'owner'),
  ('a0000000-0000-4000-a000-000000000004'::uuid, 'owner')
)
INSERT INTO public.user_roles (user_id, role)
SELECT s.user_id, s.role::public.app_role
FROM seed s
ON CONFLICT DO NOTHING;

-- ── التحقق الذاتي ───────────────────────────────────────────────────────────
-- لا نسكت عن بذرة ناقصة: كل مسؤول يجب أن يوجد في الجداول الأربعة، وإلا كان
-- لدينا حساب لا يستطيع الدخول أو صلاحية بلا صاحب.
DO $$
DECLARE
  v_expected uuid[] := ARRAY[
    'a0000000-0000-4000-a000-000000000001'::uuid,
    'a0000000-0000-4000-a000-000000000002'::uuid,
    'a0000000-0000-4000-a000-000000000003'::uuid,
    'a0000000-0000-4000-a000-000000000004'::uuid
  ];
  v_id uuid;
BEGIN
  FOREACH v_id IN ARRAY v_expected LOOP
    IF NOT EXISTS (SELECT 1 FROM auth.users u             WHERE u.id = v_id)
    OR NOT EXISTS (SELECT 1 FROM public.profiles p        WHERE p.id = v_id)
    OR NOT EXISTS (SELECT 1 FROM public.platform_admins a WHERE a.user_id = v_id)
    -- دور المتجر إلزامي أيضًا — بدونه كل سياسات RLS للتطبيق تخفي كل شيء
    -- رغم نجاح الدخول (إصلاح 2026-10-13)
    OR NOT EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = v_id)
    -- هوية البريد إلزالية — بدونها لا يعمل الدخول بالبريد
    OR NOT EXISTS (SELECT 1 FROM auth.identities i
                   WHERE i.user_id = v_id AND i.provider = 'email')
    -- هوية الهاتف إلزالية كذلك — بدونها يعيد الدخول بالهاتف invalid_credentials
    OR NOT EXISTS (SELECT 1 FROM auth.identities i
                   WHERE i.user_id = v_id AND i.provider = 'phone')
    THEN
      RAISE EXCEPTION
        'حساب منصة لم يكتمل بناؤه (%) — ناقص في auth.users أو هوية البريد أو هوية الهاتف أو profiles أو platform_admins أو user_roles',
        v_id;
    END IF;
  END LOOP;

  -- وكل من يحمل superadmin يجب أن تتحقق له الدالة فعلًا، لا مجرد صف موجود.
  IF EXISTS (
    SELECT 1 FROM public.platform_admins pa
    WHERE pa.role = 'superadmin'
      AND pa.is_active
      AND NOT public.is_platform_superadmin(pa.user_id)
  ) THEN
    RAISE EXCEPTION 'صف سوبر أدمن لا تحقّقه is_platform_superadmin — تعارض بين البيانات والدالة';
  END IF;

  -- والدعم يجب ألّا يحقّق صلاحية السوبر أدمن.
  IF EXISTS (
    SELECT 1 FROM public.platform_admins pa
    WHERE pa.role = 'support'
      AND public.is_platform_superadmin(pa.user_id)
  ) THEN
    RAISE EXCEPTION 'حساب دعم يحقّق صلاحية سوبر أدمن — تسرّب صلاحيات';
  END IF;
END $$;

COMMIT;

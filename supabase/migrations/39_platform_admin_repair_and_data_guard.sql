-- ============================================================================
-- 39_platform_admin_repair_and_data_guard.sql
--
-- لماذا هجرة لا بذرة؟
--   البذرة (seeds) بيانات تُشغَّل يدويًا، وهي المرجع عند **البناء الجديد**.
--   لكن قاعدة موجودة (السحابة) لن تنال إصلاحًا في 06_platform_admins.sql
--   بمجرد تعديل الملف. الهجرة هنا تُطبَّق تلقائيًا على كل قاعدة (db push)
--   وتصلح الحالة القائمة، وتظل البذرة المرجع للبناء التالي.
--
-- ما تُصلحه:
--   1) المستخدم الرابع (أحمد الهتار — a000…004) أُدرج في auth.users في البذرة
--      لكن **بقية صفوفه ناقصة**: auth.identities (بريد + هاتف)، profiles،
--      platform_admins، user_roles. النتيجة: يستطيع الدخول بكلمة المرور لكن
--      لا هوية بريد/هاتف صحيحة، ولا ملف شخصي (is_staff=false)، ولا دور منصة،
--      ولا دور متجر → كل الشاشات فارغة.
--
--   2) أي سوبر أدمن آخر ناقص الصف في platform_admins / user_roles / profiles
--      يُكمَّل هنا بصلاحية واحدة: إذا كان في auth.users وبريده معروف فهو
--      «حساب منصة» يجب أن يكون كاملًا.
--
--   3) حارس دائم: لم نعد نثق بأن البذرة تُشغَّل. أي صف في auth.users يحمل
--      بريدًا من قائمة مسؤولي المنصة ولا يوجد له صف في الجداول الأربعة
--      يُكتشف، ويُبنى تلقائيًا (بأقل صلاحية صحيحة: owner + superadmin فقط
--      للحسابات المعروفة).
--
--   4) الهاتف يُخزَّن بلا "+" في auth.users (كما يكتبه GoTrue)، وفي profiles
--      بصيغة + — وهذا هو ما تفعله البذرة بالضبط فنتابعه.
--
-- الصلاحيات: هذا الملف يكتب في auth.* و public.*، فتشغيله يحتاج postgres
-- (service role / db push). لا يعمل من العميل أبدًا.
--
-- ثابت: كل إدراج ON CONFLICT DO NOTHING / DO UPDATE.
-- ============================================================================

BEGIN;

-- ── (1) المستخدمون المعروفون (نفس أرقام البذرة حرفيًا) ──────────────────────
-- نُعرّفهم هنا CTE مرة واحدة؛ يُستخدم في كل عبارة أدناه.
-- ملاحظة: لا نُعيد كتابة كلمات المرور هنا — البذرة تفعل ذلك عند البناء.
-- الحساب الموجود تبقى كلمة مروره كما هي؛ هذا الملف يُكمل **البنيان** فقط،
-- فلا يستطيع إعادة تعيين كلمة مرور لأحد عرضًا.
WITH known(user_id, email, phone, full_name, platform_role) AS (VALUES
  ('a0000000-0000-4000-a000-000000000001'::uuid, 'mousa.mc13@gmail.com',     '+967772217218', 'موسى العواضي',  'superadmin'),
  ('a0000000-0000-4000-a000-000000000002'::uuid, 'shoeabvv@gmail.com',       '+967772317950', 'يونس العفيف',   'superadmin'),
  ('a0000000-0000-4000-a000-000000000003'::uuid, 'emadfasill2001@gmail.com', '+967784795104', 'عماد الجماعي',  'support'),
  ('a0000000-0000-4000-a000-000000000004'::uuid, 'ahmedhetar15@gmail.com',   '+967779121636', 'أحمد الهتار',   'superadmin')
)
-- 1-أ) الهوية المفقودة: يُكمل auth.users لو غاب صفه أصلًا (بذرة لم تُشغَّل).
INSERT INTO auth.users (
  id, instance_id, aud, role, email, phone, encrypted_password,
  email_confirmed_at, phone_confirmed_at,
  raw_app_meta_data, raw_user_meta_data,
  confirmation_token, recovery_token, email_change, email_change_token_new,
  created_at, updated_at
)
SELECT
  k.user_id,
  '00000000-0000-0000-0000-000000000000'::uuid,
  'authenticated', 'authenticated',
  k.email, replace(k.phone, '+', ''),
  -- بلا كلمة مرور قابلة للدخول: NULL يُرفض عند الدخول، فيُنشئ المالك كلمة
  -- مرور عبر «نسيت كلمة المرور» بدل كلمة سر مكتوبة في المستودع.
  NULL, now(), now(),
  jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email', 'phone')),
  jsonb_build_object('full_name', k.full_name),
  '', '', '', '', now(), now()
FROM known k
WHERE NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = k.user_id)
  AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE lower(u.email) = lower(k.email));

-- ── (2) الهويات: بريد وهاتف لكل حساب معروف ───────────────────────────────────
WITH known(user_id, email, phone) AS (VALUES
  ('a0000000-0000-4000-a000-000000000001'::uuid, 'mousa.mc13@gmail.com',     '+967772217218'),
  ('a0000000-0000-4000-a000-000000000002'::uuid, 'shoeabvv@gmail.com',       '+967772317950'),
  ('a0000000-0000-4000-a000-000000000003'::uuid, 'emadfasill2001@gmail.com', '+967784795104'),
  ('a0000000-0000-4000-a000-000000000004'::uuid, 'ahmedhetar15@gmail.com',   '+967779121636')
)
INSERT INTO auth.identities (id, user_id, provider_id, provider, identity_data, created_at, updated_at, last_sign_in_at)
SELECT gen_random_uuid(), k.user_id, k.user_id::text, 'email',
       jsonb_build_object(
         'sub', k.user_id::text, 'email', k.email,
         'email_verified', true, 'phone_verified', true, 'phone', k.phone
       ),
       now(), now(), NULL
FROM known k
WHERE EXISTS (SELECT 1 FROM auth.users u WHERE u.id = k.user_id)
ON CONFLICT (provider, provider_id) DO NOTHING;

WITH known(user_id) AS (VALUES
  ('a0000000-0000-4000-a000-000000000001'::uuid),
  ('a0000000-0000-4000-a000-000000000002'::uuid),
  ('a0000000-0000-4000-a000-000000000003'::uuid),
  ('a0000000-0000-4000-a000-000000000004'::uuid)
)
INSERT INTO auth.identities (id, user_id, provider_id, provider, identity_data, created_at, updated_at, last_sign_in_at)
SELECT gen_random_uuid(), k.user_id, k.user_id::text, 'phone',
       jsonb_build_object('sub', k.user_id::text, 'email_verified', false, 'phone_verified', true),
       now(), now(), NULL
FROM known k
WHERE EXISTS (SELECT 1 FROM auth.users u WHERE u.id = k.user_id)
  AND NOT EXISTS (
    SELECT 1 FROM auth.identities i
    WHERE i.user_id = k.user_id AND i.provider = 'phone'
  );

-- ⚠️ سبب وجود NOT EXISTS أعلاه بدل ON CONFLICT وحده:
--   uniIQUE (provider, provider_id) يمنع صفين لنفس (phone, user). لكن حسابًا
--   قديمًا قد يحمل هوية هاتف بـ provider_id مختلف (تصميم أقدم) — فيمرّ
--   ON CONFLICT ويُدرج هوية هاتف ثانية لنفس المستخدم. GoTrue قد يختار
--   عشوائيًا بينهما. الفحص الاسمي يمنع التكرار من أصله.

-- ── (3) profiles: الملف الشخصي لكل حساب في auth.users ينتمي للمنصة ────────
WITH known(user_id, full_name, phone) AS (VALUES
  ('a0000000-0000-4000-a000-000000000001'::uuid, 'موسى العواضي',  '+967772217218'),
  ('a0000000-0000-4000-a000-000000000002'::uuid, 'يونس العفيف',   '+967772317950'),
  ('a0000000-0000-4000-a000-000000000003'::uuid, 'عماد الجماعي', '+967784795104'),
  ('a0000000-0000-4000-a000-000000000004'::uuid, 'أحمد الهتار',   '+967779121636')
)
INSERT INTO public.profiles (id, full_name, phone, language, theme, is_active)
SELECT k.user_id, k.full_name, k.phone, 'ar', 'dark', true
FROM known k
WHERE EXISTS (SELECT 1 FROM auth.users u WHERE u.id = k.user_id)
ON CONFLICT (id) DO UPDATE
  SET full_name = EXCLUDED.full_name,
      phone     = EXCLUDED.phone,
      -- لا نغيّر is_active لحساب أوقفه المالك عن قصد: الإصلاح يُكمل الناقص،
      -- لا يعيد تفعيل حساب موقوف.
      is_active = COALESCE(public.profiles.is_active, true),
      updated_at = now();

-- ── (4) platform_admins ─────────────────────────────────────────────────────
WITH known(user_id, platform_role) AS (VALUES
  ('a0000000-0000-4000-a000-000000000001'::uuid, 'superadmin'),
  ('a0000000-0000-4000-a000-000000000002'::uuid, 'superadmin'),
  ('a0000000-0000-4000-a000-000000000003'::uuid, 'support'),
  ('a0000000-0000-4000-a000-000000000004'::uuid, 'superadmin')
)
INSERT INTO public.platform_admins (user_id, role, is_active, mfa_required)
SELECT k.user_id, k.platform_role, true, false
FROM known k
WHERE EXISTS (SELECT 1 FROM auth.users u WHERE u.id = k.user_id)
ON CONFLICT (user_id) DO NOTHING;   -- لا نرقّي/نخفّض دورًا قائمًا بقرار إداري

-- ── (5) user_roles: دور المتجر (بدونه RLS يُخفي كل شيء) ─────────────────────
WITH known(user_id) AS (VALUES
  ('a0000000-0000-4000-a000-000000000001'::uuid),
  ('a0000000-0000-4000-a000-000000000002'::uuid),
  ('a0000000-0000-4000-a000-000000000003'::uuid),
  ('a0000000-0000-4000-a000-000000000004'::uuid)
)
INSERT INTO public.user_roles (user_id, role)
SELECT k.user_id, 'owner'::public.app_role
FROM known k
WHERE EXISTS (SELECT 1 FROM auth.users u WHERE u.id = k.user_id)
  AND NOT EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = k.user_id)
ON CONFLICT DO NOTHING;

-- ── (6) حارس: كل صف في platform_admins يجب أن يراه is_platform_superadmin
--         أو is_platform_admin كما ينص دوره، وكل سوبر أدمن له دور متجر ──────
DO $$
DECLARE
  v_bad text;
BEGIN
  -- 6-أ) صف سوبر أدمن نشط لا تحقّقه الدالة
  SELECT string_agg(pa.user_id::text, ', ') INTO v_bad
  FROM public.platform_admins pa
  WHERE pa.role = 'superadmin' AND pa.is_active
    AND NOT public.is_platform_superadmin(pa.user_id);
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'صف سوبر أدمن لا تحقّقه is_platform_superadmin: %', v_bad;
  END IF;

  -- 6-ب) حساب دعم يمرّ كسوبر أدمن (تسرّب صلاحيات)
  SELECT string_agg(pa.user_id::text, ', ') INTO v_bad
  FROM public.platform_admins pa
  WHERE pa.role = 'support' AND public.is_platform_superadmin(pa.user_id);
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'حساب دعم يحقّق is_platform_superadmin: %', v_bad;
  END IF;

  -- 6-ج) سوبر أدمن بلا دور متجر ولا ملف شخصي = حساب يدخل ولا يرى شيئًا
  SELECT string_agg(pa.user_id::text, ', ') INTO v_bad
  FROM public.platform_admins pa
  WHERE NOT EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = pa.user_id)
     OR NOT EXISTS (SELECT 1 FROM public.profiles  p WHERE p.id     = pa.user_id);
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'مسؤول منصة بلا دور متجر أو ملف شخصي: %', v_bad;
  END IF;
END $$;

COMMIT;

-- ============================================================================
-- التحقق (المتوقع: أربعة صفوف، كل عمود true):
--
--   SELECT u.email,
--          (SELECT count(*) FROM auth.identities i WHERE i.user_id=u.id)          AS identities,
--          EXISTS (SELECT 1 FROM public.profiles p WHERE p.id=u.id)               AS has_profile,
--          EXISTS (SELECT 1 FROM public.platform_admins pa WHERE pa.user_id=u.id) AS has_platform,
--          EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id=u.id)        AS has_store_role,
--          public.is_platform_superadmin(u.id)                                     AS is_super
--     FROM auth.users u
--    WHERE u.id IN ('a0000000-0000-4000-a000-000000000001','a0000000-0000-4000-a000-000000000002',
--                   'a0000000-0000-4000-a000-000000000003','a0000000-0000-4000-a000-000000000004')
--    ORDER BY u.email;
-- ============================================================================

-- ============================================================================
-- 40_restore_platform_admin_privileges.sql
--
-- إصلاح أعمق مما فعلته 38: 38 مُنحت للدور authenticated، لكن **السياسات**
-- المشكوك فيها هي التي تخفي الصفوف. هذا الملف يعيد بناء نموذج الصلاحيات
-- الخاص بمستخدمي المنصة من الأساس، حتى لا يعتمد سوبر أدمن على «صدفة» أن
-- له دور متجر owner.
--
-- ما يُصلحه:
--
--   1) platform_admins: سياسة الإدارة كانت USING (is_platform_superadmin)
--      للكتابة، و FOR ALL تشمل SELECT — أي أن سوبر أدمن لا يستطيع قراءة
--      صفوف سوبر أدمن **آخرين**، ولا رؤية نفسه إن أُوقف أو غيّر دوره (لأن
--      is_platform_superadmin يشترط is_active و role='superadmin').
--      النتيجة العملية: شاشة «مسؤولو المنصة» تبدو فارغة للمستخدم الرابع
--      قبل أن يُضاف صفه، ولو أُوقف حساب لأصبح غير مرئي ولا يمكن إصلاحه من
--      الواجهة. السياسات هنا صريحة منفصلة: قراءة لمسؤول المنصة النشط، كتابة
--      لسوبر أدمن نشط فقط، وقراءة ذاتية دائمًا.
--
--   2) profiles: لا سياسة قراءة لمسؤول المنصة على ملفات الآخرين، فيحتاج
--      عرض «من الذي أنشأ القيد» إلى service_role. نضيف قراءة لمسؤول المنصة.
--
--   3) user_roles: نفس الفكرة — مسؤول المنصة يحتاج معرفة أدوار المنازل
--      لأغراض الدعم. القراءة فقط، والكتابة تبقى لمالك المتجر.
--
--   4) حماية من القفل الذاتي: منع أي عملية تجعل عدد السوبر أدمن النشطين
--      صفرًا (حذف/تعطيل/تخفيض الدور) — وهو أسوأ عطل ممكن في نظام متعدد
--      المستأجرين، لأنه لا يوجد من يصلحه من الواجهة.
--
-- ثابت: كل عبارة CREATE POLICY مسبوقة بـ DROP IF EXISTS.
-- ============================================================================

BEGIN;

-- ── (1) platform_admins ─────────────────────────────────────────────────────
DROP POLICY IF EXISTS "platform_admins_manage"    ON public.platform_admins;
DROP POLICY IF EXISTS "platform_admins_select"    ON public.platform_admins;
DROP POLICY IF EXISTS "platform_admins_self_read" ON public.platform_admins;

-- قراءة: أي مسؤول منصة نشط يرى القائمة كاملة (الكتابة تبقى محصورة).
CREATE POLICY "platform_admins_read" ON public.platform_admins
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (public.is_platform_admin(auth.uid()));

-- قراءة ذاتية دائمة: صاحب الصف يرى دوره حتى لو أُوقف (ليعرف السبب).
CREATE POLICY "platform_admins_self_read" ON public.platform_admins
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- إدارة: سوبر أدمن نشط فقط.
CREATE POLICY "platform_admins_insert" ON public.platform_admins
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (public.is_platform_superadmin(auth.uid()));

CREATE POLICY "platform_admins_update" ON public.platform_admins
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING (public.is_platform_superadmin(auth.uid()))
  WITH CHECK (public.is_platform_superadmin(auth.uid()));

CREATE POLICY "platform_admins_delete" ON public.platform_admins
  AS PERMISSIVE FOR DELETE TO authenticated
  USING (public.is_platform_superadmin(auth.uid()));

-- ── (2) profiles: قراءة إدارية لمسؤول المنصة ────────────────────────────────
-- (السياسة القائمة "profiles read own" تبقى كما هي؛ هذه إضافة لا استبدال.)
DROP POLICY IF EXISTS "platform admin reads profiles" ON public.profiles;
CREATE POLICY "platform admin reads profiles" ON public.profiles
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (public.is_platform_admin(auth.uid()));

-- ── (3) user_roles: قراءة إدارية لمسؤول المنصة ──────────────────────────────
DROP POLICY IF EXISTS "platform admin reads user_roles" ON public.user_roles;
CREATE POLICY "platform admin reads user_roles" ON public.user_roles
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (public.is_platform_admin(auth.uid()));

-- ── (4) حماية القفل الذاتي: لا صفر سوبر أدمن ────────────────────────────────
-- تُنفّذ كـ CONSTRAINT TRIGGER مؤجّل إلى نهاية المعاملة: تقدر سوبر أدمن
-- واحدًا ثم تضيف آخر في نفس المعاملة (عملية استبدال مشروعة)، وترفض
-- المعاملة كلها إن انتهت بصفر سوبر أدمن.
CREATE OR REPLACE FUNCTION public.tg_platform_admins_keep_superadmin()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_remaining integer;
BEGIN
  SELECT count(*) INTO v_remaining
  FROM public.platform_admins
  WHERE role = 'superadmin' AND is_active;

  IF v_remaining = 0 THEN
    RAISE EXCEPTION 'PLATFORM_LOCKOUT: لا يمكن ترك المنصة بلا سوبر أدمن نشط'
      USING ERRCODE = '23514',
            HINT = 'أضف سوبر أدمن آخر أو فعّل الحساب قبل تعطيل الأخير';
  END IF;

  RETURN NULL;  -- AFTER trigger
END;
$$;

COMMENT ON FUNCTION public.tg_platform_admins_keep_superadmin() IS
  'R-40: يمنع ترك platform_admins بلا سوبر أدمن نشط — لا يوجد من يصلحه من الواجهة إن وقع.';

REVOKE ALL ON FUNCTION public.tg_platform_admins_keep_superadmin() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_platform_admins_keep_superadmin ON public.platform_admins;
CREATE CONSTRAINT TRIGGER trg_platform_admins_keep_superadmin
  AFTER INSERT OR UPDATE OR DELETE ON public.platform_admins
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_platform_admins_keep_superadmin();

-- ⚠️ ملاحظة على UPDATE/DELETE من داخل الجدول نفسه: المشغّل لا يمنع بذرة
--    كاملة تُفرّغ الجدول ثم تملؤه في نفس المعاملة — وهذا هو المقصود (البذرة
--    القانونية الوحيدة). ما يمنعه هو إنهاء معاملة بحالة صفر.

-- ── (5) منح القراءة على الجداول الإدارية ─────────────────────────────────────
-- سياسة RLS لا تعمل بلا GRANT. كان المنح موجودًا؛ نؤكده لأن 36 سحب ALL على
-- كل الجداول ثم أعاد قائمة صريحة — ولم يكن platform_audit_logs فيها.
GRANT SELECT, INSERT ON public.platform_audit_logs TO authenticated;
GRANT SELECT ON public.platform_admins, public.platform_modules, public.platform_plans TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.platform_admins TO authenticated;

-- ── (6) التحقق ──────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF (SELECT count(*) FROM public.platform_admins WHERE role = 'superadmin' AND is_active) = 0 THEN
    RAISE EXCEPTION 'PLATFORM_LOCKOUT: قاعدة البيانات بلا سوبر أدمن نشط عند تطبيق 40';
  END IF;
END $$;

COMMIT;

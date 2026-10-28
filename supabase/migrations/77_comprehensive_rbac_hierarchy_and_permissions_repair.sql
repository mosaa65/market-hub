-- ============================================================================
-- 77_comprehensive_rbac_hierarchy_and_permissions_repair.sql
--
-- الغاية:
-- حل جذري ونهائي لمشاكل الصلاحيات (RBAC) والتناقضات بين أذونات المالك والأدوار:
--
-- 1. الهرمية التلقائية للأدوار (Hierarchical Role Inheritance):
--    - مالك المتجر (owner) وسوبر أدمن المنصة (is_platform_superadmin) يرثان
--      تلقائياً كافة الصلاحيات التشغيلية (manager, accountant, cashier, warehouse)
--      دون الحاجة لتكرار ذكر 'owner' في كل سياسة أو حارس دالة.
--    - مدير المتجر (manager) يرث صلاحيات الكاشير وأمين المستودع (cashier, warehouse).
--
-- 2. توحيد وإصلاح دالة is_staff:
--    - تشمل مسؤولي المنصة (is_platform_admin) ولا تفشل بسبب قيمة profiles.is_active
--      إذا كانت null أثناء الإنشاء الأولي للحساب.
--
-- 3. الصلاحيات الافتراضية لقاعدة البيانات (PostgreSQL DEFAULT PRIVILEGES):
--    - ضبط ALTER DEFAULT PRIVILEGES في مخطط public لمنح authenticated صلاحيات
--      SELECT, INSERT, UPDATE, DELETE على الجداول و EXECUTE على الدوال تلقائياً،
--      مما يمنع ظهور خطأ 42501 (Permission Denied) مستقبلاً مع كل تطوير جديد.
--
-- 4. إتاحة دالة has_any_role كدالة مساعدة آمنة للمصفوفات.
-- ============================================================================

BEGIN;

-- ── (1) إعادة تعريف has_role مع الدعم الهرمي الكامل ────────────────────────
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF _user_id IS NULL THEN
    RETURN false;
  END IF;

  -- (أ) التحقق من الدور المباشر أو الوراثة الهرمية من user_roles
  IF EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = _user_id
      AND (
        -- تطابق الدور مباشرة
        ur.role = _role
        -- المالك يملك صلاحيات كل الأدوار التشغيلية
        OR ur.role = 'owner'
        -- المدير يملك صلاحيات الكاشير والمستودع
        OR (ur.role = 'manager' AND _role IN ('cashier', 'warehouse'))
      )
  ) THEN
    RETURN true;
  END IF;

  -- (ب) سوبر أدمن المنصة يرث كافة الأدوار لأغراض الدعم والإشراف
  IF public.is_platform_superadmin(_user_id) THEN
    RETURN true;
  END IF;

  RETURN false;
END;
$$;

COMMENT ON FUNCTION public.has_role(uuid, public.app_role) IS
  'فحص هرمي للدور: المالك وسوبر أدمن المنصة يرثان كل الأدوار، والمدير يرث الكاشير والمستودع.';

-- ── (2) توفير دالة has_any_role لمطابقة أي دور من مصفوفة ─────────────────────
CREATE OR REPLACE FUNCTION public.has_any_role(_user_id uuid, _roles app_role[])
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF _user_id IS NULL THEN
    RETURN false;
  END IF;

  IF public.is_platform_superadmin(_user_id) THEN
    RETURN true;
  END IF;

  RETURN EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = _user_id
      AND (
        ur.role = ANY(_roles)
        OR ur.role = 'owner'
        OR (ur.role = 'manager' AND ('cashier'::app_role = ANY(_roles) OR 'warehouse'::app_role = ANY(_roles)))
      )
  );
END;
$$;

COMMENT ON FUNCTION public.has_any_role(uuid, public.app_role[]) IS
  'فحص هرمي متعدد: يتحقق من وجود أي دور من القائمة مع احترام وراثة المالك والمدير.';

-- ── (3) تحصين دالة is_staff ضد تعطل الحسابات الجديدة ────────────────────────
CREATE OR REPLACE FUNCTION public.is_staff(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT (
    EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id)
    OR public.is_platform_admin(_user_id)
  )
  AND COALESCE((SELECT is_active FROM public.profiles WHERE id = _user_id), true);
$$;

COMMENT ON FUNCTION public.is_staff(uuid) IS
  'يتحقق أن المستخدم مسجل في طاقم المتجر أو إدارة المنصة وحسابه غير معطل.';

-- ── (4) ترقية رتبة المصروفات والمالية expense_role_rank ─────────────────────
CREATE OR REPLACE FUNCTION public.expense_role_rank(p_user uuid)
RETURNS integer
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN public.is_platform_superadmin(p_user) THEN 100
    WHEN public.has_role(p_user, 'owner')      THEN 50
    WHEN public.has_role(p_user, 'manager')    THEN 40
    WHEN public.has_role(p_user, 'accountant') THEN 30
    WHEN public.has_role(p_user, 'cashier')    THEN 20
    WHEN public.has_role(p_user, 'warehouse')  THEN 10
    ELSE 0
  END;
$$;

-- ── (5) تحصين إمكانية تشغيل المعصرة/المطحنة can_operate_milling ──────────────
CREATE OR REPLACE FUNCTION public.can_operate_milling()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_staff(auth.uid())
     AND (
       EXISTS (
         SELECT 1
         FROM public.user_roles ur
         WHERE ur.user_id = auth.uid()
           AND ur.role IN ('owner', 'manager', 'warehouse', 'cashier')
       )
       OR public.is_platform_superadmin(auth.uid())
     );
$$;

-- ── (6) ضبط الصلاحيات التلقائية (Default Privileges) والأذونات العامة ───────
-- تضمن ألا يتعطل أي جدول أو دالة مستقبلية بخطأ 42501
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO authenticated;

GRANT USAGE ON SCHEMA public TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;

-- منح صريح لدوال الصلاحيات الأساسية
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.has_any_role(uuid, public.app_role[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_staff(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_platform_admin(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_platform_superadmin(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_read_finance(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_operate_milling() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.expense_role_rank(uuid) TO authenticated, service_role;

COMMIT;

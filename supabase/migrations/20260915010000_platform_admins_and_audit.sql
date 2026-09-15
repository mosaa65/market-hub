-- ==========================================================
-- 20260915010000_platform_admins_and_audit.sql
-- Vortex ERP Platform Admin (Level 1) & Platform Audit Trail
-- ==========================================================

-- 1. Platform Admins Table (Strictly isolated from tenant user_roles)
CREATE TABLE IF NOT EXISTS public.platform_admins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('superadmin', 'support')),
  is_active boolean NOT NULL DEFAULT true,
  mfa_required boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_login timestamptz,
  CONSTRAINT uq_platform_admin_user UNIQUE (user_id)
);

-- 2. Platform Audit Trail (Records global subscription/tenant operations)
CREATE TABLE IF NOT EXISTS public.platform_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id uuid REFERENCES public.platform_admins(id) ON DELETE SET NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  action text NOT NULL,
  target_tenant_id text,
  payload jsonb,
  ip_address text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 3. Helper Security Functions
CREATE OR REPLACE FUNCTION public.is_platform_admin(p_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.platform_admins
    WHERE user_id = p_user_id AND is_active = true
  );
$$;

CREATE OR REPLACE FUNCTION public.is_platform_superadmin(p_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.platform_admins
    WHERE user_id = p_user_id AND role = 'superadmin' AND is_active = true
  );
$$;

-- 4. Enable RLS
ALTER TABLE public.platform_admins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_audit_logs ENABLE ROW LEVEL SECURITY;

-- 5. Policies
DROP POLICY IF EXISTS platform_admins_select ON public.platform_admins;
CREATE POLICY platform_admins_select ON public.platform_admins
  FOR SELECT TO authenticated
  USING (public.is_platform_admin(auth.uid()));

DROP POLICY IF EXISTS platform_admins_manage ON public.platform_admins;
CREATE POLICY platform_admins_manage ON public.platform_admins
  FOR ALL TO authenticated
  USING (public.is_platform_superadmin(auth.uid()))
  WITH CHECK (public.is_platform_superadmin(auth.uid()));

DROP POLICY IF EXISTS platform_audit_logs_select ON public.platform_audit_logs;
CREATE POLICY platform_audit_logs_select ON public.platform_audit_logs
  FOR SELECT TO authenticated
  USING (public.is_platform_admin(auth.uid()));

DROP POLICY IF EXISTS platform_audit_logs_insert ON public.platform_audit_logs;
CREATE POLICY platform_audit_logs_insert ON public.platform_audit_logs
  FOR INSERT TO authenticated
  WITH CHECK (public.is_platform_admin(auth.uid()) OR auth.uid() IS NOT NULL);

-- 6. Grants
GRANT SELECT ON public.platform_admins TO authenticated;
GRANT SELECT, INSERT ON public.platform_audit_logs TO authenticated;
GRANT ALL ON public.platform_admins TO service_role;
GRANT ALL ON public.platform_audit_logs TO service_role;

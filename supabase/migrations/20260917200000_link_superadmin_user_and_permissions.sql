-- ==========================================================
-- 20260917200000_link_superadmin_user_and_permissions.sql
-- Link Mousa / Owner account to platform_admins table
-- Ensure rock-solid superadmin permissions for subscription plans
--
-- ⚠️ HISTORICAL — SUPERSEDED BY 20260929000100.
--
-- This file conflated two independent scopes (see the header of
-- 20260929000100) in two ways:
--
--   1. FUNCTIONS: it defined is_platform_admin / is_platform_superadmin as
--      "has a platform_admins row OR is a tenant owner". 20260929000100 replaces
--      both bodies so a tenant owner no longer satisfies a platform policy.
--      Everything below that only re-asserts those bodies is therefore inert.
--
--   2. DATA: step 2 matched accounts by NAME SUBSTRING ('%mousa%', '%موسى%')
--      and inserted them into platform_admins. Privilege matched by a person's
--      name is not a control, it is a guess — and on a deployment where some
--      unrelated customer happens to be named موسى it grants them superadmin.
--      The statements are kept because this version is already recorded on the
--      existing deployment; on any new deployment they match zero rows.
--      NO FUTURE MIGRATION MAY MATCH PRIVILEGES BY NAME OR EMAIL SUBSTRING.
--
-- The DO UPDATE clauses below were also changed to DO NOTHING so that a
-- deliberate revocation (is_active = false) is not silently undone.
-- ==========================================================

-- 1. Ensure platform_admins table exists with correct schema
CREATE TABLE IF NOT EXISTS public.platform_admins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('superadmin', 'support', 'admin')),
  is_active boolean NOT NULL DEFAULT true,
  mfa_required boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_login timestamptz,
  CONSTRAINT uq_platform_admin_user UNIQUE (user_id)
);

-- 2. Link existing Mousa / Owner accounts into platform_admins
DO $$
DECLARE
  r RECORD;
BEGIN
  -- A) Link by user_roles (any owner)
  FOR r IN (
    SELECT DISTINCT user_id FROM public.user_roles WHERE role = 'owner'
  ) LOOP
    INSERT INTO public.platform_admins (user_id, role, is_active, mfa_required)
    VALUES (r.user_id, 'superadmin', true, false)
    -- DO NOTHING, not DO UPDATE. The payload is identical either way, so
    -- UPDATE bought nothing — except silently UNDOING an operator's deliberate
    -- revocation (is_active = false) the next time this ran.
    ON CONFLICT (user_id) DO NOTHING;
  END LOOP;

  -- Payload is identical on every conflict path, so DO NOTHING is used to
  -- preserve an operator's explicit revocation instead of overwriting it.
  -- B) Link by profiles full_name containing 'موسى' or 'mousa'
  --    (historical — matches zero rows on a new deployment; never copy this.)
  FOR r IN (
    SELECT id AS user_id FROM public.profiles
    WHERE full_name ILIKE '%موسى%' OR full_name ILIKE '%mousa%'
  ) LOOP
    BEGIN
      INSERT INTO public.platform_admins (user_id, role, is_active, mfa_required)
      VALUES (r.user_id, 'superadmin', true, false)
      ON CONFLICT (user_id) DO NOTHING;   -- never undo a revocation
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END LOOP;

  -- C) Link by auth.users email containing 'mousa'
  --    (historical — matches zero rows on a new deployment; never copy this.)
  FOR r IN (
    SELECT id AS user_id FROM auth.users
    WHERE email ILIKE '%mousa%'
  ) LOOP
    BEGIN
      INSERT INTO public.platform_admins (user_id, role, is_active, mfa_required)
      VALUES (r.user_id, 'superadmin', true, false)
      ON CONFLICT (user_id) DO NOTHING;   -- never undo a revocation
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END LOOP;
END $$;
CREATE OR REPLACE FUNCTION public.is_platform_admin(p_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.platform_admins
    WHERE user_id = p_user_id AND is_active = true
  ) OR EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = p_user_id AND role = 'owner'
  );
$$;

CREATE OR REPLACE FUNCTION public.is_platform_superadmin(p_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.platform_admins
    WHERE user_id = p_user_id AND role IN ('superadmin', 'admin') AND is_active = true
  ) OR EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = p_user_id AND role = 'owner'
  );
$$;

-- 4. Enable RLS and setup robust policies on platform_admins
ALTER TABLE public.platform_admins ENABLE ROW LEVEL SECURITY;

-- Allow all authenticated users to view platform admins so the Users UI can display the Superadmin badge
DROP POLICY IF EXISTS platform_admins_select ON public.platform_admins;
CREATE POLICY platform_admins_select ON public.platform_admins
  FOR SELECT TO authenticated
  USING (true);

-- Allow superadmins or owners to manage platform admins
DROP POLICY IF EXISTS platform_admins_manage ON public.platform_admins;
DROP POLICY IF EXISTS platform_admins_insert ON public.platform_admins;
DROP POLICY IF EXISTS platform_admins_update ON public.platform_admins;
DROP POLICY IF EXISTS platform_admins_delete ON public.platform_admins;

CREATE POLICY platform_admins_manage ON public.platform_admins
  FOR ALL TO authenticated
  USING (public.is_platform_superadmin(auth.uid()))
  WITH CHECK (public.is_platform_superadmin(auth.uid()));

-- 5. Strict but accessible policies on tenant_subscriptions
ALTER TABLE public.tenant_subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_subscriptions_select ON public.tenant_subscriptions;
CREATE POLICY tenant_subscriptions_select ON public.tenant_subscriptions
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS tenant_subscriptions_update ON public.tenant_subscriptions;
CREATE POLICY tenant_subscriptions_update ON public.tenant_subscriptions
  FOR UPDATE TO authenticated
  USING (public.is_platform_admin(auth.uid()))
  WITH CHECK (public.is_platform_admin(auth.uid()));

DROP POLICY IF EXISTS tenant_subscriptions_insert ON public.tenant_subscriptions;
-- NOTE: an INSERT policy accepts only WITH CHECK; `USING` is invalid for INSERT in
-- PostgreSQL (SQLSTATE 42601), which previously aborted this migration. The
-- original intent — "only platform admins may insert" — is fully preserved.
CREATE POLICY tenant_subscriptions_insert ON public.tenant_subscriptions
  FOR INSERT TO authenticated
  WITH CHECK (public.is_platform_admin(auth.uid()));

-- 6. Grants
GRANT SELECT, INSERT, UPDATE, DELETE ON public.platform_admins TO authenticated;
GRANT ALL ON public.platform_admins TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.tenant_subscriptions TO authenticated;
GRANT ALL ON public.tenant_subscriptions TO service_role;

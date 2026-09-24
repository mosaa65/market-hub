-- ==========================================================
-- 20260918000000_restrict_platform_admins_select.sql
-- SECURITY FIX: platform_admins was world-readable.
--
-- The previous migration (20260917200000) reopened the SELECT policy on
-- public.platform_admins with USING (true), which let ANY authenticated
-- user read the entire platform superadmin registry straight from the API
-- (the client-side gating in the Users page was cosmetic only).
--
-- This migration restores strict platform-admin-only visibility. It does not
-- touch any data, any other table, or any other policy.
-- ==========================================================

-- 1) Replace the permissive SELECT policy with an admin-only one.
--    public.is_platform_admin(uuid) is a SECURITY DEFINER helper that already
--    exists (see 20260915010000 / 20260917200000) and is safe to call in a
--    policy because it only returns a boolean.
DROP POLICY IF EXISTS platform_admins_select ON public.platform_admins;
CREATE POLICY platform_admins_select ON public.platform_admins
  FOR SELECT TO authenticated
  USING (public.is_platform_admin(auth.uid()));

-- 2) Keep the management policy (INSERT/UPDATE/DELETE) restricted to
--    superadmins. Re-created defensively so the table ends in a known state.
DROP POLICY IF EXISTS platform_admins_manage ON public.platform_admins;
CREATE POLICY platform_admins_manage ON public.platform_admins
  FOR ALL TO authenticated
  USING (public.is_platform_superadmin(auth.uid()))
  WITH CHECK (public.is_platform_superadmin(auth.uid()));

-- 3) Re-assert the table grant without widening it. SELECT stays granted at
--    the table level (RLS is what narrows it), matching the rest of the
--    schema's grant + RLS pattern.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.platform_admins TO authenticated;
GRANT ALL ON public.platform_admins TO service_role;
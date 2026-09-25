-- ==========================================================
-- 20260918000100_add_profiles_is_active.sql
-- Adds a real account-level enable/disable flag for store users.
--
-- Before this migration the schema had no user status mechanism at all
-- (is_active only existed on customers/suppliers/products/warehouses), so
-- "disabling" a user was impossible without a schema change. This adds the
-- single column needed and nothing else.
--
-- Existing users automatically become is_active = true via the DEFAULT.
-- No row is modified, deleted, or rewritten by this migration.
-- ==========================================================

-- 1) Add the flag. NOT NULL + DEFAULT so every existing profile is active.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

-- 2) Reuse the EXISTING permission model for who may change the flag.
--    The project's admin boundary is exactly the same predicate already used
--    across the schema for staff governance:
--        public.has_role(auth.uid(),'owner')          -> store owner
--        public.is_platform_superadmin(auth.uid())    -> platform superadmin
--    No new role or permission is introduced.
--
--    profiles already has RLS enabled with a permissive SELECT policy
--    (profiles_self_select USING (true)) and a self-only UPDATE policy
--    (profiles_self_update USING (id = auth.uid())). The self-only UPDATE
--    policy is what currently prevents users from editing each other; we add
--    a narrowly-scoped policy so an admin can toggle is_active, without
--    widening UPDATE to arbitrary columns for non-admins.
DROP POLICY IF EXISTS profiles_admin_toggle_active ON public.profiles;
CREATE POLICY profiles_admin_toggle_active ON public.profiles
  FOR UPDATE TO authenticated
  USING (
    public.has_role(auth.uid(), 'owner')
    OR public.is_platform_superadmin(auth.uid())
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'owner')
    OR public.is_platform_superadmin(auth.uid())
  );

-- 3) Grants: profiles UPDATE is already granted to authenticated
--    (see 20260621011940). Re-asserted here so the table ends in a known
--    state without widening anything.
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
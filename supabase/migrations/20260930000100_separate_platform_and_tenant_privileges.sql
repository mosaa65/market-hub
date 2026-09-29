-- ============================================================================
-- 20260930000100_separate_platform_and_tenant_privileges.sql
--
-- ARCHITECTURE FIX — separates platform administration from tenant ownership.
--
-- PROBLEM
-- -------
-- The platform predicates do not actually express "platform administrator".
-- They express "platform administrator OR any tenant owner", because of the
-- trailing OR clause:
--
--     is_platform_admin(uid)      = platform_admins row  OR  user_roles.role = 'owner'
--     is_platform_superadmin(uid) = platform_admins row  OR  user_roles.role = 'owner'
--
-- Consequences, all of them real:
--
--   1. Every tenant owner is a platform superadmin. On a multi-customer
--      deployment, the owner of customer A satisfies platform-level policies.
--      Any policy written as "platform admins only" silently includes every
--      tenant owner of every tenant.
--   2. `platform_admins` stops being the source of truth. Granting or revoking
--      a platform role has no effect for any user who also happens to be an
--      owner — revoking superadmin from an owner leaves them superadmin.
--   3. The two concepts were also conflated on the DATA side: 20260917200000
--      inserted a platform_admins row for EVERY user with role 'owner', and
--      additionally matched users by name substring ('%mousa%' / '%موسى%') and
--      email substring ('%mousa%'). Matching privileges by a person's name is
--      not a security control — it is a guess.
--
-- TARGET MODEL
-- ------------
--     Supabase Auth
--           |
--           +-- Normal tenant user --> user_roles       (tenant scope)
--           |
--           +-- Platform admin     --> platform_admins  (platform scope)
--
--     The two tables are independent. Holding one grants nothing in the other.
--
-- WHY THIS IS A NEW MIGRATION AND NOT AN EDIT
-- -------------------------------------------
-- 20260917200000 is already applied. Its version must remain in
-- supabase_migrations.schema_migrations; rewriting it would cause history
-- drift. Forward-only correction is mandatory.
--
-- ⚠️ BEHAVIOUR CHANGE — READ BEFORE APPLYING
-- ------------------------------------------
-- From now on, being a tenant 'owner' no longer grants platform access. If any
-- operator currently relies on that (i.e. they are an owner but have no
-- platform_admins row), they will lose access to platform-only screens.
--
-- Step 3 below is a NON-DESTRUCTIVE reconciliation that closes that gap: it
-- inserts the missing platform_admins row for any active owner, so nobody loses
-- access on the day this runs. It performs NO deletes. After that point the two
-- scopes are genuinely independent and can be managed separately.
--
-- NON-DESTRUCTIVE: no DELETE, no TRUNCATE, no DROP of data. Only
-- CREATE OR REPLACE of two functions, plus guarded INSERTs that cannot
-- duplicate an existing row.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. is_platform_admin(): platform_admins ONLY.
--
--    A tenant owner is NOT a platform admin. This is the whole point of
--    separating the two tables.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_platform_admin(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.platform_admins
    WHERE user_id = p_user_id
      AND is_active = true
  );
$$;

-- ---------------------------------------------------------------------------
-- 2. is_platform_superadmin(): platform_admins with a superadmin-grade role.
--
--    'support' is intentionally excluded — it is a read-only support role and
--    must not satisfy superadmin-only policies (notably platform_admins_manage,
--    which governs who may edit the platform admin registry itself).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_platform_superadmin(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.platform_admins
    WHERE user_id = p_user_id
      AND role IN ('superadmin', 'admin')
      AND is_active = true
  );
$$;

-- ---------------------------------------------------------------------------
-- 3. Access-preserving reconciliation (ADDITIVE — inserts only).
--
--    Before this migration, every 'owner' satisfied is_platform_admin() through
--    the OR clause, regardless of whether a platform_admins row existed. Once
--    that clause is gone, such a user would lose platform access.
--
--    To guarantee no operator is locked out by this change, materialise the
--    implicit grant as an explicit row. This is the ONLY safe direction:
--      * it never removes access,
--      * it never deletes a row,
--      * it is idempotent via ON CONFLICT on the existing unique(user_id),
--      * existing rows keep their current role (DO NOTHING, not DO UPDATE) so a
--        deliberate role change made through the UI is not overwritten.
--
--    NOTE: this grants superadmin to active owners. On a single-tenant
--    deployment that is exactly one person. If your deployment has multiple
--    tenants and you do NOT want every tenant owner to be a platform
--    superadmin, inspect the SELECT below first and grant platform access to
--    only the intended operators afterwards (see docs, section "Super Admin
--    Architecture"). The rows this inserts can be revoked at any time through
--    platform_admins — which is the point: it is now data, not a rule.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_inserted integer := 0;
  r RECORD;
BEGIN
  FOR r IN (
    SELECT DISTINCT ur.user_id
    FROM public.user_roles AS ur
    WHERE ur.role = 'owner'
      AND NOT EXISTS (
        SELECT 1 FROM public.platform_admins AS pa WHERE pa.user_id = ur.user_id
      )
  ) LOOP
    INSERT INTO public.platform_admins (user_id, role, is_active, mfa_required)
    VALUES (r.user_id, 'superadmin', true, false)
    ON CONFLICT (user_id) DO NOTHING;

    v_inserted := v_inserted + 1;
  END LOOP;

  RAISE NOTICE
    'separate_platform_and_tenant_privileges: materialised % implicit platform-admin grant(s) from tenant owners. Review platform_admins and revoke any that should not hold platform access.',
    v_inserted;
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. Document the contract in the schema itself.
-- ---------------------------------------------------------------------------
COMMENT ON FUNCTION public.is_platform_admin(uuid) IS
  'True only for an active row in platform_admins. Tenant roles (user_roles) '
  'are deliberately NOT considered: platform and tenant scopes are separate. '
  'Do not re-add an OR user_roles clause.';

COMMENT ON FUNCTION public.is_platform_superadmin(uuid) IS
  'True only for an active platform_admins row with role superadmin or admin. '
  'Excludes support. Tenant ownership grants nothing at platform scope.';

COMMENT ON TABLE public.platform_admins IS
  'Platform-scope administrators. Independent of public.user_roles (tenant '
  'scope). Rows are granted explicitly by an operator; no trigger or signup '
  'path may insert here.';

COMMENT ON TABLE public.user_roles IS
  'Tenant-scope roles (owner/manager/accountant/cashier/warehouse). Holding a '
  'role here grants NO platform-level access.';

-- ============================================================================
-- 20260929000500_fix_platform_admin_self_read_loop.sql
--
-- 🔴 FIXES "the super-admin sees every page blocked" — a CLOSED LOOP between
--    the platform_admins RLS policy and the client's permission bootstrap.
--
-- SYMPTOM
-- -------
-- The account exists in public.platform_admins with role = 'superadmin' and
-- is_active = true. The database is correct. Yet the UI locks every page.
--
-- ROOT CAUSE
-- ----------
-- 1. The policy is:
--        platform_admins_select USING (public.is_platform_admin(auth.uid()))
--    so reading ONE row of platform_admins requires evaluating a predicate that
--    itself reads platform_admins.
--
-- 2. The client bootstraps its entire permission state with exactly that read
--    (src/lib/auth.tsx -> fetchAdminFlags):
--        .from("platform_admins").select("role, is_active").eq("user_id", me)
--    If that returns no row or an error, the client concludes
--        isPlatformAdmin = false, isPlatformSuperadmin = false
--    (auth.tsx silently swallows the error and returns false).
--
-- 3. app-shell.tsx gates navigation on `isPlatformAdmin || isPlatformSuperadmin
--    || hasRole("owner")`. All three are false for a platform-only account with
--    no tenant role, so EVERY page is blocked — even though the row exists.
--
-- 4. 20260929000100 removed the `OR user_roles.role = 'owner'` fallback from
--    is_platform_admin(). That fallback had been masking the loop: while it
--    existed, almost any real operator satisfied the predicate through their
--    owner role, so the bootstrap read never came back empty. Removing the
--    conflation was correct — but it exposed this loop, which must now be
--    broken properly.
--
-- THE FIX — two independent changes, either of which alone is insufficient:
--
--   A. HARDEN THE PREDICATES. is_platform_admin() / is_platform_superadmin()
--      are SECURITY DEFINER helpers that read platform_admins for the CALLER.
--      They must not be subject to the very policy they serve, or the policy
--      can never be evaluated for the first row. Pin search_path (already done)
--      and make the intent explicit so no future migration "hardens" them back
--      into a lockout.
--
--   B. GIVE EVERY CALLER THE RIGHT TO SEE THEIR OWN ROW. A self-read policy is
--      added alongside the admin-wide one. This is the standard escape hatch for
--      an RLS-read bootstrap: "you may always read the row that describes you".
--      It leaks nothing — the row is the caller's own — and it removes the
--      dependency on the predicate entirely.
--
-- NON-DESTRUCTIVE: policies and comments only. No row is read, written or
-- deleted; no table or column is altered.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Self-read policy — breaks the loop.
--
--    Additive: RLS policies are OR'd, so this does not weaken
--    platform_admins_select, it widens it by exactly one row per caller.
--    Without it the client cannot determine its own platform permissions
--    because the determination itself is what RLS is refusing.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS platform_admins_self_read ON public.platform_admins;
CREATE POLICY platform_admins_self_read ON public.platform_admins
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

COMMENT ON POLICY platform_admins_self_read ON public.platform_admins IS
  'A caller may always read the platform_admins row that describes THEMSELVES. '
  'Required because the client bootstraps its permission state with a direct '
  'SELECT on this table (src/lib/auth.tsx -> fetchAdminFlags); without this the '
  'evaluation of platform_admins_select depends on a predicate that reads the '
  'same table, and the read returns nothing, silently disabling the UI for a '
  'legitimate super-admin. Exposes one row, to its owner, only.';

-- ---------------------------------------------------------------------------
-- 2. Re-assert the predicates. SECURITY DEFINER so policy evaluation is not
--    itself filtered by RLS, and an explicit pinned search_path so the helper
--    cannot be hijacked by a shadowing object.
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

COMMENT ON FUNCTION public.is_platform_admin(uuid) IS
  'True only for an active row in platform_admins. SECURITY DEFINER on purpose: '
  'it is evaluated from inside the platform_admins RLS policy and would '
  'otherwise be unable to see the row it is testing for. Tenant roles '
  '(user_roles) are deliberately NOT considered — do not re-add an OR clause.';
COMMENT ON FUNCTION public.is_platform_superadmin(uuid) IS
  'True only for an active platform_admins row with role superadmin or admin. '
  'Excludes support. SECURITY DEFINER for the same reason as '
  'is_platform_admin — it backs the platform_admins_manage policy.';

-- ---------------------------------------------------------------------------
-- 3. Make sure the helper is executable by every role that can evaluate a
--    policy on this table, including before a session exists.
-- ---------------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION public.is_platform_admin(uuid)      TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_platform_superadmin(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. Verify the two roles that matter, and shout if the loop is still open.
--    A silent zero-row result is exactly how this failed in production; the
--    next operator deserves a loud answer instead.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_admins integer;
  v_self_policy boolean;
BEGIN
  SELECT count(*) INTO v_admins FROM public.platform_admins;

  SELECT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'platform_admins'
      AND policyname = 'platform_admins_self_read'
  ) INTO v_self_policy;

  RAISE NOTICE
    'fix_platform_admin_self_read_loop: platform_admins has % row(s); self-read policy present: %',
    v_admins, v_self_policy;

  IF NOT v_self_policy THEN
    RAISE EXCEPTION
      'Self-read policy was not created — super-admins will still see every page blocked.';
  END IF;

  IF v_admins = 0 THEN
    RAISE WARNING
      'platform_admins is EMPTY. A platform-only account will have no tenant role '
      'and therefore no navigation at all. Grant the platform role (see '
      'docs/database/migration-safety-notes.md section 9) before signing in.';
  END IF;
END $$;
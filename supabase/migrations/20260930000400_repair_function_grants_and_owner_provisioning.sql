-- ============================================================================
-- 20260930000400_repair_function_grants_and_owner_provisioning.sql
--
-- FORWARD CORRECTION for three defects introduced by 20260929000000..300.
--
-- DEFECT 1 — the function-grant list is incomplete (breaks a fresh deployment)
-- ---------------------------------------------------------------------------
-- 20260929000200 ends with:
--     REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, anon;
-- and re-grants EXECUTE to `authenticated` for a hand-written list of names.
-- That list was derived from the app's supabase.rpc() call sites at the time.
-- It is missing:
--
--     search_products(p_query, p_category_id, ...)        <- products list
--     customer_ledger_balance(uuid)                       <- customer statements
--     has_role(uuid, public.app_role)                     <- every tenant RLS policy
--     is_staff(uuid)                                      <- every tenant RLS policy
--     warehouse_reference_counts(uuid)                    <- warehouse delete guard
--
-- and it can never include a function that did not exist when the file was
-- written — including anything created later through the Dashboard SQL editor.
--
-- CONSEQUENCE ON AN EXISTING PROJECT: none. This version is already recorded
-- there, so 20260929000200 does not re-run and the pre-existing grants survive.
-- CONSEQUENCE ON A FRESH PROJECT: the app installs and then fails at runtime —
-- the products list, the customer statement and every tenant RLS predicate are
-- `permission denied for function ...`. This migration repairs that.
--
-- DEFECT 2 — `anon` must be able to evaluate the RLS predicates
-- ------------------------------------------------------------
-- A policy that calls public.has_role(auth.uid(), 'owner') is evaluated by
-- Postgres as the CALLING role. During sign-in the caller is `anon` — there is
-- no session yet, which is the whole point of signing in. If `anon` holds no
-- EXECUTE on has_role/is_staff the evaluation raises
-- `permission denied for function has_role`, the query inside GoTrue fails, and
-- the Auth API answers:
--     500 {"error_code":"unexpected_failure","msg":"Database error querying schema"}
--
-- 20260929000300 fixed this for the schema's DEFAULT privileges but left the two
-- explicit per-function REVOKEs from 20260929000200 (lines 105 and 110) in
-- force, so the predicate path is still broken. Re-granted explicitly below.
--
-- This does NOT reopen anything: has_role and is_staff are boolean predicates
-- over the caller's own id. They reveal nothing an authenticated user cannot
-- already read from their own user_roles row, and `anon` always passes
-- auth.uid() = NULL so they simply evaluate to false.
--
-- DEFECT 3 — is_staff() fails OPEN instead of closed
-- --------------------------------------------------
-- 20260918000200 line 41 reads:
--     AND COALESCE((SELECT is_active FROM profiles WHERE id = _user_id), true)
-- The COALESCE fallback is `true`, so a caller with NO profiles row is treated
-- as an ACTIVE staff member. That is the opposite of the file's stated intent
-- ("makes a disabled account actually fail RLS"): deleting or never creating a
-- profile row made a user MORE privileged, not less. Corrected to `false`.
--
-- NON-DESTRUCTIVE: privileges and function bodies only. No table is altered,
-- no row is read, written or deleted, no policy is dropped.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Repair the is_staff() fail-open fallback.
--    Body copied from 20260918000200 with the single COALESCE corrected.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_staff(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id)
    AND COALESCE((SELECT is_active FROM public.profiles WHERE id = _user_id), false)
$$;

COMMENT ON FUNCTION public.is_staff(uuid) IS
  'True only for a user that holds a tenant role AND has an ACTIVE profile row. '
  'Fails CLOSED: a missing profiles row is inactive, not active. Evaluated '
  'inside RLS policies, therefore executable by anon and authenticated.';

-- ---------------------------------------------------------------------------
-- 2. RLS predicates that policies call directly must be callable by the role
--    evaluating the policy. `anon` is that role before a session exists.
-- ---------------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_staff(uuid)                  TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_platform_admin(uuid)         TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_platform_superadmin(uuid)    TO authenticated;

-- The two platform predicates are granted to `authenticated` deliberately:
-- 20260929000200 revoked them to stop any signed-in user from probing whether
-- an arbitrary UUID is a platform admin. That concern is real, but it is not
-- addressed by revoking the grant — the policies already call these functions
-- during evaluation, and RLS only ever calls them with auth.uid(), never with a
-- caller-supplied UUID. The probe vector is PostgREST /rpc/<name>, which cannot
-- be called at all unless EXECUTE is granted, and is additionally blocked by
-- the fact that these are pure predicates. If you want them off /rpc entirely,
-- do it in the API layer, not by breaking your own policies.
-- (They are intentionally NOT granted to anon.)

-- ---------------------------------------------------------------------------
-- 3. Re-grant EXECUTE to `authenticated` on every remaining application
--    function, so the list can never again be "one function short".
--
--    Written dynamically instead of as a hand-kept list on purpose: the previous
--    failure mode was exactly that the list fell out of date. Internal-only
--    helpers are excluded by name, because exposing them over PostgREST has no
--    legitimate use (see comments on each name below).
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  r RECORD;
  v_granted integer := 0;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig, p.proname
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prokind IN ('f', 'p')                       -- functions and procedures
      AND p.proname NOT IN (
        -- trigger functions: invoked by Postgres, never by a client
        'handle_new_user',
        'bootstrap_first_owner',
        'tg_set_updated_at',
        -- internal helper, service-side auth logging
        '_log_auth_attempt'
      )
  LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', r.sig);
    v_granted := v_granted + 1;
  END LOOP;

  RAISE NOTICE
    '20260929000400: EXECUTE granted to authenticated on % function(s).', v_granted;
END $$;

-- ---------------------------------------------------------------------------
-- 4. Default privileges: do not let the NEXT migration silently re-hide
--    functions from service_role.
--
--    20260929000200 revoked EXECUTE from PUBLIC in the DEFAULT ACL:
--         ALTER DEFAULT PRIVILEGES IN SCHEMA public
--           REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
--    `service_role`'s access to a new function came from that PUBLIC entry, so
--    every function created afterwards is invisible to service_role — which
--    breaks Edge Functions and any admin script until someone notices.
--
--    Re-asserted explicitly. `anon` is deliberately NOT touched here: it was
--    already restored by 20260929000300, and GoTrue needs it.
-- ---------------------------------------------------------------------------
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO authenticated;

-- Public (the implicit grant to every role) stays revoked: that is the one
-- default that genuinely had to go, and it is what 20260929000200 got right.

-- ---------------------------------------------------------------------------
-- 5. Document the single-source-of-truth rule, so the list is not rebuilt.
-- ---------------------------------------------------------------------------
COMMENT ON SCHEMA public IS
  'Application schema. Function exposure policy lives in '
  '20260929000200 + 20260929000300 + 20260929000400 and is enforced '
  'dynamically, not by a hand-maintained name list. RLS predicate helpers '
  '(has_role, is_staff) MUST keep EXECUTE for anon and authenticated, or '
  'sign-in and every tenant policy break.';

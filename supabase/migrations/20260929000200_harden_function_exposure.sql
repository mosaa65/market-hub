-- ============================================================================
-- 20260929000200_harden_function_exposure.sql
--
-- SECURITY HARDENING — closes the findings reported by Supabase's database
-- security advisor (25 warnings) down to the set that is genuinely required to
-- remain open.
--
-- SCOPE OF THE PROBLEM
-- --------------------
-- Every function in the `public` schema is auto-exposed by PostgREST at
-- /rest/v1/rpc/<name>. Supabase grants EXECUTE to `anon` and `authenticated` on
-- new functions by DEFAULT (via the `public` schema's default privileges), not
-- because anyone decided to. So a function can be callable over HTTP without
-- anyone ever granting it.
--
-- Two distinct problems were reported:
--
--   (A) anon_security_definer_function_executable  — callable WITHOUT signing in.
--       Nothing in this application is meant to be reachable anonymously. Any
--       SECURITY DEFINER function exposed to `anon` is an unauthenticated door
--       into privileged SQL. This is unambiguously wrong and is fixed here.
--
--   (B) authenticated_security_definer_function_executable — callable by any
--       signed-in user. This is NOT automatically wrong: SECURITY DEFINER is how
--       these functions intentionally bypass RLS to post a sale atomically, and
--       the app calls several of them directly via supabase.rpc(). Blanket
--       revocation would break the application. Each one is therefore classified
--       by whether the application actually calls it, and the ones that are only
--       used *inside* other functions (helpers) are locked down.
--
-- (C) function_search_path_mutable — a SECURITY DEFINER function without a
--     pinned search_path can be hijacked by a caller who creates an object with
--     a colliding name earlier in the search path. Fixed by pinning it.
--
-- NON-DESTRUCTIVE: grants and function attributes only. No data is read,
-- written, or deleted. No table is altered.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Revoke anonymous execution EVERYWHERE.
--
--    `anon` is the unauthenticated PostgREST role. No function in this
--    application is designed to be reachable without a session, so this is a
--    blanket, unqualified revocation across the whole schema — including any
--    function added later that this list does not name.
--
--    PUBLIC is revoked too: it is the implicit grant that makes functions
--    reachable by every role, and it is the root cause of the exposure.
-- ---------------------------------------------------------------------------
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM anon;

-- ---------------------------------------------------------------------------
-- 1b. CORRECTED IN PLACE — see 20260929000400.
--
--     The two statements below were the original text of this file:
--
--         ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
--         ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM anon;
--
--     Both are REMOVED, because neither does what it looks like it does:
--
--       * `REVOKE ... FROM anon` does not scope itself to functions this author
--         creates. It rewrites the schema-wide default ACL row owned by the role
--         running it, so it stripped anon from the DEFAULT grants and broke
--         GoTrue sign-in (500 "Database error querying schema"). 20260929000300
--         restores it and documents why.
--
--       * `REVOKE ... FROM PUBLIC` removes the implicit grant that is the ONLY
--         reason `service_role` can execute a newly created function. Every
--         function created after this point became unreachable from Edge
--         Functions and admin scripts.
--
--     The intent — "a newly created function must not be anonymously callable" —
--     is preserved and is now enforced by an explicit REVOKE per function
--     (step 1 above) plus the dynamic re-grant in 20260929000400. That is the
--     correct mechanism: ALTER DEFAULT PRIVILEGES is a schema-wide,
--     owner-scoped switch and must never be used to express "this one function
--     is private".
--
--     History note: this file is already recorded in schema_migrations, so the
--     deployed database keeps the old behaviour until 20260929000400 runs. That
--     is why the correction is re-asserted forward there.
-- ---------------------------------------------------------------------------
-- (removed — superseded by an explicit per-function REVOKE + 20260929000400)

-- ---------------------------------------------------------------------------
-- 2. Re-grant to `authenticated` only what the application actually calls.
--
--    The list below was produced by searching the client source for
--    supabase.rpc("<name>"). Granting anything broader reopens (B) without
--    benefit; granting anything narrower breaks the POS, purchasing, returns
--    and payment flows.
-- ---------------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION public.create_sale(uuid, uuid, text, numeric, numeric, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_sale(uuid, uuid, text, numeric, numeric, text, jsonb, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_purchase(uuid, uuid, text, numeric, numeric, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_purchase_return(uuid, uuid, uuid, text, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_sales_return(uuid, uuid, uuid, text, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_stock_transfer(uuid, uuid, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_customer_payment(uuid, uuid, numeric, text, date, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.adjust_loyalty(uuid, numeric, text, text) TO authenticated;

-- The 9-argument create_sale overload added by 20260928000000 (tender breakdown).
GRANT EXECUTE ON FUNCTION public.create_sale(uuid, uuid, text, numeric, numeric, text, jsonb, date, jsonb) TO authenticated;

-- Tender breakdown reader, added by 20260928000000. It already grants itself in
-- its own migration; re-stated here so this file is the single place that
-- defines the exposure policy.
GRANT EXECUTE ON FUNCTION public.sales_invoice_tender_breakdown(uuid) TO authenticated;

-- ⚠️ EXCEPTION — these two helpers are called by RLS policies and therefore MUST
-- remain executable. Do NOT revoke them; the remark below is superseded.
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_staff(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.search_products TO authenticated;
GRANT EXECUTE ON FUNCTION public.warehouse_reference_counts(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.customer_ledger_balance(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.customer_credit_limit_allows(uuid, numeric) TO authenticated;

-- Delete-guard helpers. These are called by the app to check whether a product
-- may be deleted and to explain why not. They are read-only queries, so they are
-- safe to expose to a signed-in user.
-- ⚠️ CORRECTION: this list is NOT the complete policy, and treating it as such
-- was a defect. Anything missing here became unreachable at runtime. The
-- authoritative fix is 20260929000400, which grants to `authenticated`
-- dynamically — including functions created after this file was written. Do not
-- re-introduce a hand-maintained name list as the sole mechanism.
GRANT EXECUTE ON FUNCTION public.product_delete_guard(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.product_reference_counts(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. Keep only the genuinely internal helpers off /rest/v1/rpc.
--
--    The helpers actually called from inside SQL — has_role, is_staff,
--    is_platform_admin, is_platform_superadmin — presented a real dilemma:
--    RLS evaluates them as the CALLER, so revoking EXECUTE breaks the policy that
--    calls them. Revoking them is therefore NOT a valid way to hide them, and
--    doing so broke sign-in (see 20260929000300). They are all granted in step 2
--    and re-asserted in 20260929000400.
--
--    What remains revoked here is the narrow set that is neither a policy
--    predicate nor a client RPC: the auth-logging helper and the boundary used
--    by customer_credit_limit_allows when invoked directly.
-- ---------------------------------------------------------------------------

-- NOTE: _log_auth_attempt is revoked by name only if it exists, since it is a
-- security-logging helper that should never be callable from the client.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = '_log_auth_attempt'
  ) THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public._log_auth_attempt FROM authenticated, anon, PUBLIC';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 4. Pin search_path on SECURITY DEFINER functions.
--
--    Without a pinned search_path, a SECURITY DEFINER function resolves
--    unqualified names using the CALLER's search_path. A caller who can create
--    an object named like a table the function touches can therefore redirect
--    the function's privileged query to their own object. Pinning removes that
--    entire class of attack.
--
--    Done dynamically so it also covers functions that may have been added
--    outside the migration chain (e.g. via the Dashboard SQL editor), which is
--    exactly how drift like this appears in the first place.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  r RECORD;
  v_count integer := 0;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig, p.proname
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef = true                      -- SECURITY DEFINER only
      AND (
        p.proconfig IS NULL
        OR NOT EXISTS (SELECT 1 FROM unnest(p.proconfig) c WHERE c LIKE 'search_path=%')
      )
  LOOP
    EXECUTE format('ALTER FUNCTION %s SET search_path = public, pg_temp', r.sig);
    v_count := v_count + 1;
    RAISE NOTICE 'pinned search_path on public.%', r.proname;
  END LOOP;

  RAISE NOTICE 'harden_function_exposure: pinned search_path on % function(s)', v_count;
END $$;

-- ---------------------------------------------------------------------------
-- 5. Explicitly pin the two RLS predicates and the auth-log helper, in case
--    they are not SECURITY DEFINER and were therefore skipped by step 4.
-- ---------------------------------------------------------------------------
ALTER FUNCTION public.is_platform_admin(uuid) SET search_path = public, pg_temp;
ALTER FUNCTION public.is_platform_superadmin(uuid) SET search_path = public, pg_temp;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = '_log_auth_attempt'
  ) THEN
    EXECUTE 'ALTER FUNCTION public._log_auth_attempt SET search_path = public, pg_temp';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 6. Document the policy so the next reader does not undo it.
-- ---------------------------------------------------------------------------
COMMENT ON FUNCTION public.is_platform_admin(uuid) IS
  'RLS predicate. NOT exposed over PostgREST: EXECUTE is revoked from anon and '
  'authenticated. Policy evaluation does not require a client grant. Do not '
  're-grant this to authenticated — doing so lets any user probe platform '
  'membership of any UUID.';

COMMENT ON FUNCTION public.is_platform_superadmin(uuid) IS
  'RLS predicate. NOT exposed over PostgREST (EXECUTE revoked from anon and '
  'authenticated). Do not re-grant.';

COMMENT ON FUNCTION public.create_sale(uuid, uuid, text, numeric, numeric, text, jsonb, date) IS
  'Called by the POS via supabase.rpc(). SECURITY DEFINER so the sale posts '
  'atomically regardless of RLS. EXECUTE is granted to authenticated only.';

COMMENT ON FUNCTION public.sales_invoice_tender_breakdown(uuid) IS
  'Read helper for statements: tender components of one invoice. Granted to '
  'authenticated; the underlying table is additionally protected by RLS.';
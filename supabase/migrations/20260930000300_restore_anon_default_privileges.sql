-- ============================================================================
-- 20260930000300_restore_anon_default_privileges.sql
--
-- 🔴 URGENT REGRESSION FIX — restores sign-in.
--
-- WHAT BROKE
-- ----------
-- 20260929000200 added:
--
--     ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM anon;
--
-- The intent was "new functions must not be anonymously callable". The effect
-- was far wider, because ALTER DEFAULT PRIVILEGES does not scope itself to
-- functions the author creates — it rewrites the default ACL entry for the
-- whole schema, owned by the role running it (`postgres`). Every default ACL
-- row for `postgres/public/functions` lost its `anon=X` entry:
--
--     before: {postgres=X/postgres, anon=X/postgres, authenticated=X/postgres, service_role=X/postgres}
--     after:  {postgres=X/postgres,                       authenticated=X/postgres, service_role=X/postgres}
--
-- Why that breaks login: GoTrue runs its authentication queries over PostgREST
-- as the `anon` role (the caller is not yet authenticated — that is the point of
-- signing in). With `anon` no longer in the schema's default function ACL,
-- GoTrue's login path fails inside Postgres and the Auth API returns:
--
--     500 {"error_code":"unexpected_failure","msg":"Database error querying schema"}
--
-- So the change intended to harden anonymous *function* exposure instead removed
-- anonymous *default grants* across the schema, breaking authentication itself.
--
-- WHY REVOKE-ON-ALL WAS NOT THE PROBLEM
-- -------------------------------------
-- The `REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM anon` in the same
-- migration only touched functions that existed at that moment, and GoTrue does
-- not call any of them. The damage came solely from the DEFAULT PRIVILEGES
-- statement, which changes what happens to *future* objects.
--
-- THE FIX
-- -------
-- Restore the exact default ACL that Supabase ships, for both owners that
-- matter (`postgres`, and `supabase_admin` for safety). This returns the schema
-- to its original default-grant behaviour.
--
-- The per-function revocations from 20260929000200 remain in force and are
-- unaffected: they are explicit ACLs on existing functions, not defaults. Anon
-- still cannot call any application function.
--
-- NON-DESTRUCTIVE: privilege metadata only. No data is read, written, or deleted.
-- ============================================================================

-- Restore anon's EXECUTE in the default ACL for functions in public, as it was
-- before 20260929000200.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon;

-- Re-assert the grants Supabase expects, so this migration is the single
-- authoritative statement of the schema's default function ACL.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO service_role;

-- NOTE ON INTENT
-- --------------
-- Restoring anon here does NOT reopen the advisor findings that
-- 20260929000200 fixed. Those were about *existing* functions holding an
-- explicit or default-derived EXECUTE grant. Default privileges only affect
-- functions created AFTER this statement, and the hardening policy for new
-- functions is now enforced the correct way:
--
--   * revoke from PUBLIC and anon explicitly on each new function, or
--   * rely on the per-function REVOKE list, which is reviewed in the same PR.
--
-- The lesson, recorded so it is not repeated: ALTER DEFAULT PRIVILEGES is a
-- schema-wide, owner-scoped switch. It must never be used to express "this one
-- function should be private" — that is what an explicit REVOKE is for.

COMMENT ON SCHEMA public IS
  'Application schema. Default function ACL intentionally includes anon: the '
  'Supabase Auth service (GoTrue) authenticates as anon before a session exists. '
  'Do NOT revoke anon from ALTER DEFAULT PRIVILEGES here — it breaks sign-in. '
  'Restrict individual functions with an explicit REVOKE instead.';

-- ============================================================================
-- 20260930000000_dehardcode_superadmin_identity.sql
--
-- SECURITY / ARCHITECTURE FIX — removes developer identity from the signup path.
--
-- PROBLEM
-- -------
-- 20260915030000 replaced public.handle_new_user() with a body that contained:
--
--     IF LOWER(NEW.email) = '<one developer's personal address>' THEN
--       INSERT INTO public.user_roles   ... 'owner'
--       INSERT INTO public.platform_admins ... 'superadmin'
--     END IF;
--
-- That is not merely cosmetic plumbing. It is a LIVE privilege-escalation rule
-- that runs on EVERY future signup:
--
--   1. It grants platform-level superadmin rights to whoever controls that one
--      email address. On a customer deployment that address belongs to somebody
--      else entirely — a third party is silently made superadmin of the
--      customer's database the moment they sign up.
--   2. Nothing in the database can revoke it durably. Deleting the
--      platform_admins row does not help: the next signup by that address
--      recreates it. The rule is in the trigger, not in the data.
--   3. It is invisible to the application. No screen shows "this address
--      auto-escalates", so no operator can audit or disable it.
--   4. It contradicts the whole point of `platform_admins` being a separate,
--      explicitly granted table.
--
-- WHY THE OLD MIGRATION CANNOT SIMPLY BE EDITED
-- ---------------------------------------------
-- 20260915030000 is already applied on deployments. Its version must stay in
-- supabase_migrations.schema_migrations, so it cannot be deleted or rewritten
-- into a different shape without causing history drift. The correction
-- therefore has to be a NEW forward migration — this file.
--
-- WHAT THIS MIGRATION DOES
-- ------------------------
--   1. Restores handle_new_user() to its correct, single responsibility:
--      create a profile row for a new auth user. Nothing else. No role grants,
--      no platform escalation, no address matching.
--   2. Leaves the (separately correct) tenant bootstrap rule intact: the FIRST
--      ever user becomes 'owner' so a fresh deployment is usable. That rule
--      lives in bootstrap_first_owner() and is identity-independent — it keys
--      on "no roles exist yet", not on who you are.
--   3. Does NOT delete or modify any existing row. If the developer's account
--      already holds superadmin on an existing deployment, that access is
--      preserved; it is now manageable data instead of an unrevocable rule.
--
-- NON-DESTRUCTIVE: no UPDATE, no DELETE, no TRUNCATE, no DROP of data.
-- Only two functions are replaced, both CREATE OR REPLACE.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. handle_new_user(): profile creation ONLY.
--
--    Deliberately has no knowledge of emails, roles, or platform_admins.
--    SECURITY DEFINER is required because the trigger runs in the context of
--    the auth service, not the end user.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, avatar_url, language, theme)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
    NEW.raw_user_meta_data->>'avatar_url',
    'ar',
    'dark'
  )
  ON CONFLICT (id) DO UPDATE
    SET full_name = COALESCE(EXCLUDED.full_name, public.profiles.full_name);

  RETURN NEW;
END;
$$;

-- Re-assert the trigger so the corrected function is definitely the one bound.
-- DROP TRIGGER IF EXISTS + CREATE is safe: it does not touch table data.
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ---------------------------------------------------------------------------
-- 2. bootstrap_first_owner(): keep the identity-independent first-user rule.
--
--    Re-stated here so the intended behaviour is explicit in one place. The
--    rule is safe by construction: it fires only while user_roles is globally
--    empty, i.e. exactly once per deployment, and it does NOT grant any
--    platform-level privilege — 'owner' is a tenant role.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bootstrap_first_owner()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.user_roles) THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.id, 'owner')
    ON CONFLICT (user_id, role) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_first_user_owner ON auth.users;
CREATE TRIGGER on_first_user_owner
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.bootstrap_first_owner();

-- ---------------------------------------------------------------------------
-- 3. Lock function execution down again.
--
--    20260915030000 recreated handle_new_user() with CREATE OR REPLACE, which
--    resets its ACL — and 20260621011959 had deliberately revoked PUBLIC
--    execute on it. Re-apply that revocation so the hardened state from the
--    original security migration is restored rather than silently lost.
-- ---------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.bootstrap_first_owner() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Record the intent in the database itself, so a future reader of the
--    schema does not reintroduce address-based escalation.
-- ---------------------------------------------------------------------------
COMMENT ON FUNCTION public.handle_new_user() IS
  'Creates a profile row for a new auth user. Intentionally performs NO role '
  'grants: platform privileges must be granted explicitly via platform_admins '
  'by an operator. Do not add email-based conditions here.';

COMMENT ON FUNCTION public.bootstrap_first_owner() IS
  'Grants tenant role owner to the very first user of a fresh deployment so '
  'the system is usable. Identity-independent: keyed on user_roles being '
  'globally empty. Never grants platform-level privileges.';

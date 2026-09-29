-- ============================================================================
-- 20260930000600_fix_auth_user_token_columns.sql
--
-- 🔴 FIXES THE AUTH OUTAGE: every sign-in, password recovery, user listing and
--    user deletion was returning HTTP 500.
--
-- SYMPTOM
-- -------
-- GoTrue (the Auth service, written in Go) logged, on every request that reads
-- a user row:
--
--     sql: Scan error on column index 3, name "confirmation_token":
--     converting NULL to string is unsupported
--
--     POST /token          -> 500  error finding user            (sign-in)
--     POST /recover        -> 500  error finding user
--     GET  /admin/users    -> 500  unable to fetch records
--     DELETE /admin/users/ -> 500  error finding user
--     GET  /settings       -> 200  (does not read auth.users)
--
-- ROOT CAUSE
-- ----------
-- The token columns on auth.users are declared `NOT NULL DEFAULT ''` in the
-- Supabase schema. GoTrue scans them into Go `string` values, and Go cannot
-- represent SQL NULL as a string — the scan fails and the whole query aborts.
--
--     m@gmail.com          : all five columns ''     -> sign-in works (200)
--     mousa.mc13@gmail.com : four of them NULL      -> sign-in fails (500)
--
-- WHY THEY ARE NULL
-- -----------------
-- Migrations 20260916000000 and 20260917200000 inserted rows into auth.users
-- with a direct `INSERT` that did not mention these columns, so they took NULL.
-- A row created through the supported path — `supabase.auth.admin.createUser`
-- (the Admin API, as used by the admin-create-user Edge Function) — has them
-- populated correctly. That is the whole difference, and it is why one account
-- worked and the other did not.
--
-- THE FIX — part A: repair the existing rows
-- ------------------------------------------
-- Set every NULL token column to the empty string the schema expects. This is
-- a targeted, value-preserving repair:
--   * only rows where the column IS NULL are touched,
--   * the replacement is '' — the documented default, not a fabricated token,
--   * no genuine pending confirmation/recovery token is overwritten, because
--     only NULLs are matched,
--   * no user, identity, profile or role is created, modified or deleted.
--
-- THE FIX — part B: make the recurrence impossible
-- ------------------------------------------------
-- A trigger on auth.users normalises these columns on INSERT and UPDATE, so any
-- future direct write — from a migration, a script, or the SQL editor — cannot
-- reintroduce NULL. The Admin API path is unaffected (it already writes '').
--
-- SAFE TO RE-RUN: the UPDATE matches nothing the second time, and the trigger
-- is created with DROP IF EXISTS first.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- A. Repair existing rows.
--
--    COALESCE-style, one column at a time, so a partially-correct row is fixed
--    without touching the columns that are already fine.
-- ---------------------------------------------------------------------------
UPDATE auth.users
SET confirmation_token = coalesce(confirmation_token, '')
WHERE confirmation_token IS NULL;

UPDATE auth.users
SET recovery_token = coalesce(recovery_token, '')
WHERE recovery_token IS NULL;

UPDATE auth.users
SET email_change_token_new = coalesce(email_change_token_new, '')
WHERE email_change_token_new IS NULL;

UPDATE auth.users
SET email_change_token_current = coalesce(email_change_token_current, '')
WHERE email_change_token_current IS NULL;

UPDATE auth.users
SET email_change = coalesce(email_change, '')
WHERE email_change IS NULL;

-- reauthentication_token is a newer column and is nullable on some schema
-- versions; repair it only if it exists.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'auth' AND table_name = 'users'
      AND column_name = 'reauthentication_token'
  ) THEN
    EXECUTE $sql$
      UPDATE auth.users
      SET reauthentication_token = coalesce(reauthentication_token, '')
      WHERE reauthentication_token IS NULL
    $sql$;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- B. Permanent guard: normalise on every future write.
--
--    A migration cannot reliably remember to set five string columns on an
--    INSERT into a table it does not own. A trigger makes it structurally
--    impossible to forget, which is the only durable fix.
--
--    NEW.<col> is NULL only when the caller omitted it or passed NULL; an
--    explicit value (including a real pending token) always survives.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.normalize_auth_user_token_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.confirmation_token IS NULL THEN
    NEW.confirmation_token := '';
  END IF;
  IF NEW.recovery_token IS NULL THEN
    NEW.recovery_token := '';
  END IF;
  IF NEW.email_change_token_new IS NULL THEN
    NEW.email_change_token_new := '';
  END IF;
  IF NEW.email_change_token_current IS NULL THEN
    NEW.email_change_token_current := '';
  END IF;
  IF NEW.email_change IS NULL THEN
    NEW.email_change := '';
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.normalize_auth_user_token_columns() IS
  'BEFORE INSERT OR UPDATE on auth.users. Replaces NULL with empty string in the '
  'token columns, which are NOT NULL DEFAULT '''' in the Supabase schema and are '
  'scanned into Go strings by GoTrue. A single NULL aborts every sign-in, '
  'password-recovery and admin request with "converting NULL to string is '
  'unsupported". This trigger is the structural guarantee that no direct INSERT '
  '(from a migration, script or SQL editor) can reintroduce that state.';

DROP TRIGGER IF EXISTS normalize_auth_user_token_columns ON auth.users;
CREATE TRIGGER normalize_auth_user_token_columns
  BEFORE INSERT OR UPDATE ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.normalize_auth_user_token_columns();

-- ---------------------------------------------------------------------------
-- C. Verify and report. The failure mode was a silent 500 in the Auth service;
--    the same condition must now be visible from the migration itself.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_bad integer;
BEGIN
  SELECT count(*) INTO v_bad
  FROM auth.users
  WHERE confirmation_token IS NULL
     OR recovery_token IS NULL
     OR email_change_token_new IS NULL
     OR email_change IS NULL;

  IF v_bad > 0 THEN
    RAISE EXCEPTION
      'fix_auth_user_token_columns: % row(s) still have NULL token columns. '
      'Sign-in will keep returning 500 until this is resolved.', v_bad;
  END IF;

  RAISE NOTICE
    'fix_auth_user_token_columns: all auth.users rows normalised; trigger installed.';
END $$;

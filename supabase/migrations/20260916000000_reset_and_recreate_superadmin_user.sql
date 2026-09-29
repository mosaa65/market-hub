-- ==========================================================
-- 20260916000000_reset_and_recreate_superadmin_user.sql
--
-- HISTORICAL / CREDENTIAL-REMOVED.
--
-- ORIGINAL PURPOSE (still honoured): provision the owner's own account as a
-- platform super-admin so a freshly built deployment is immediately usable by
-- its owner without a manual Dashboard step.
--
-- WHAT WAS WRONG AND IS NOW FIXED
--   1. It carried a PLAINTEXT PASSWORD in a committed file. Removed: the
--      account is created with an unusable password hash and the real password
--      is set by the operator through Supabase Auth. A migration must never
--      contain a credential.
--   2. It granted platform superadmin to ANY account bearing this address.
--      The grant is now CONDITIONAL (see step 7): it is issued only for an
--      account that this very migration created, recognised by its unusable
--      password and the absence of any auth identity. An account that already
--      existed — i.e. a real person who signed up — is never escalated.
--
-- SAFE ON A NEW PROJECT: the guard in step 1 detects the "fresh database"
-- case (no roles yet) and only then provisions the owner account.
-- SAFE ON AN EXISTING PROJECT: this version is already recorded there, so it
-- does not re-run; and if it did, the guard would skip it entirely.
--
-- See docs/database/migration-safety-notes.md for the provisioning contract.
-- ==========================================================

-- ---------------------------------------------------------------------------
-- GUARD — run only on a genuinely fresh deployment.
--
-- `user_roles` is empty exactly once per deployment (before anyone has been
-- granted a tenant role). On the deployment where this migration already ran,
-- and on every customer deployment that has real staff, this raises the whole
-- file to a no-op instead of touching a live account.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.user_roles LIMIT 1) THEN
    RAISE NOTICE
      '20260916000000 skipped: user_roles is not empty, this deployment is already provisioned.';
    RETURN;
  END IF;

  PERFORM 1; -- marker: the guarded block below starts here
END $$;

DO $$
DECLARE
  v_user_id uuid := gen_random_uuid();
  v_encrypted_pw text;
  v_is_new_account boolean := false;
BEGIN
  -- Fresh-deployment guard (same condition as the block above).
  IF EXISTS (SELECT 1 FROM public.user_roles LIMIT 1) THEN
    RETURN;
  END IF;

  -- 1. Cleanly delete old records if any
  DELETE FROM public.platform_admins WHERE user_id IN (SELECT id FROM auth.users WHERE LOWER(email) = 'mousa.mc13@gmail.com');
  DELETE FROM public.user_roles WHERE user_id IN (SELECT id FROM auth.users WHERE LOWER(email) = 'mousa.mc13@gmail.com');
  DELETE FROM public.profiles WHERE id IN (SELECT id FROM auth.users WHERE LOWER(email) = 'mousa.mc13@gmail.com');

  BEGIN
    DELETE FROM auth.identities WHERE user_id IN (SELECT id FROM auth.users WHERE LOWER(email) = 'mousa.mc13@gmail.com');
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  DELETE FROM auth.users WHERE LOWER(email) = 'mousa.mc13@gmail.com';

  -- 2. Credential removed on purpose.
  --    This migration previously called crypt('<plaintext>', gen_salt('bf'))
  --    to write a known password. That value is gone; a password can no
  --    longer be provisioned from source control. The account is created
  --    with an unusable password hash and must be set through the Supabase
  --    Auth admin API / Dashboard (see header).
  v_encrypted_pw := NULL;

  -- 3. Insert fresh user in auth.users.
  --
  --    ⚠️ THE TOKEN COLUMNS ARE MANDATORY, NOT COSMETIC.
  --    In the Supabase schema these five columns are `NOT NULL DEFAULT ''`, and
  --    GoTrue scans them into Go `string` values. Go cannot convert SQL NULL to
  --    a string, so a single NULL aborts the scan and EVERY request that reads a
  --    user row fails with HTTP 500:
  --        POST /token         -> 500 error finding user      (sign-in)
  --        POST /recover       -> 500 error finding user
  --        GET  /admin/users   -> 500 unable to fetch records
  --        DELETE /admin/users -> 500 error finding user
  --    Omitting them here is exactly what produced that outage. They are
  --    therefore listed explicitly, and 20260929000600 adds a trigger on
  --    auth.users so a NULL can never reappear.
  INSERT INTO auth.users (
    instance_id,
    id,
    aud,
    role,
    email,
    encrypted_password,
    email_confirmed_at,
    raw_app_meta_data,
    raw_user_meta_data,
    created_at,
    updated_at,
    confirmation_token,
    recovery_token,
    email_change,
    email_change_token_new,
    email_change_token_current
  ) VALUES (
    '00000000-0000-0000-0000-000000000000',
    v_user_id,
    'authenticated',
    'authenticated',
    'mousa.mc13@gmail.com',
    v_encrypted_pw,
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"موسى - السوبر أدمن"}'::jsonb,
    now(),
    now(),
    '',
    '',
    '',
    '',
    ''
  );

  -- 4. Insert identity for GoTrue email auth
  BEGIN
    INSERT INTO auth.identities (
      id,
      user_id,
      identity_data,
      provider,
      provider_id,
      last_sign_in_at,
      created_at,
      updated_at
    ) VALUES (
      v_user_id,
      v_user_id,
      jsonb_build_object('sub', v_user_id::text, 'email', 'mousa.mc13@gmail.com'),
      'email',
      v_user_id::text,
      now(),
      now(),
      now()
    );
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  -- 5. Insert profile
  INSERT INTO public.profiles (id, full_name, language, theme)
  VALUES (v_user_id, 'موسى - السوبر أدمن', 'ar', 'dark')
  ON CONFLICT (id) DO UPDATE SET full_name = 'موسى - السوبر أدمن';

  -- 6. Insert owner role in tenant user_roles
  INSERT INTO public.user_roles (user_id, role)
  VALUES (v_user_id, 'owner')
  ON CONFLICT (user_id, role) DO NOTHING;

  -- 7. Insert superadmin in platform_admins — CONDITIONALLY.
  --
  --    Platform superadmin is granted ONLY when the account just created is
  --    demonstrably one this migration manufactured, i.e.:
  --      * encrypted_password IS NULL  -> nobody can sign in as it yet, and
  --      * it has no auth identity     -> it is not a real person's signup.
  --    An account that already existed (a real user who registered through the
  --    Auth API) has an identity row and fails this test, so this migration can
  --    never escalate a third party.
  SELECT (u.encrypted_password IS NULL)
         AND NOT EXISTS (SELECT 1 FROM auth.identities i WHERE i.user_id = u.id)
    INTO v_is_new_account
    FROM auth.users u
   WHERE u.id = v_user_id;

  IF v_is_new_account THEN
    INSERT INTO public.platform_admins (user_id, role, is_active, mfa_required)
    VALUES (v_user_id, 'superadmin', true, false)
    ON CONFLICT (user_id) DO NOTHING;

    RAISE NOTICE
      '20260916000000: provisioned the deployment owner as platform superadmin. Set its password through Supabase Auth.';
  ELSE
    RAISE NOTICE
      '20260916000000: account already exists (has an identity) — platform grant NOT issued.';
  END IF;

END $$;

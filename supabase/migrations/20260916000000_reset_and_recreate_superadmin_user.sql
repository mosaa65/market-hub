-- ==========================================================
-- 20260916000000_reset_and_recreate_superadmin_user.sql
-- Delete existing mousa.mc13@gmail.com user and recreate cleanly
-- ==========================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
DECLARE
  v_user_id uuid := gen_random_uuid();
  v_encrypted_pw text;
BEGIN
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

  -- 2. Generate encrypted password hash with blowfish salt
  BEGIN
    v_encrypted_pw := extensions.crypt('Mousa@Vortex2026#SecureAdmin', extensions.gen_salt('bf'));
  EXCEPTION WHEN OTHERS THEN
    v_encrypted_pw := crypt('Mousa@Vortex2026#SecureAdmin', gen_salt('bf'));
  END;

  -- 3. Insert fresh user in auth.users
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
    updated_at
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
    now()
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

  -- 7. Insert superadmin in platform_admins
  INSERT INTO public.platform_admins (user_id, role, is_active, mfa_required)
  VALUES (v_user_id, 'superadmin', true, false)
  ON CONFLICT (user_id) DO UPDATE SET role = 'superadmin', is_active = true;

END $$;

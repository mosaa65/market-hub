-- ==========================================================
-- 20260915030000_superadmin_user_and_strict_subscription_rls.sql
-- Configure mousa.mc13@gmail.com as Platform Superadmin
-- Restrict tenant_subscriptions mutation strictly to platform admins
-- ==========================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
DECLARE
  v_user_id uuid;
  v_encrypted_pw text;
BEGIN
  -- Password for Superadmin: Mousa@Vortex2026#SecureAdmin
  v_encrypted_pw := crypt('Mousa@Vortex2026#SecureAdmin', gen_salt('bf'));

  SELECT id INTO v_user_id FROM auth.users WHERE email = 'mousa.mc13@gmail.com';

  IF v_user_id IS NULL THEN
    v_user_id := gen_random_uuid();
    INSERT INTO auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at
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
  ELSE
    UPDATE auth.users
    SET encrypted_password = v_encrypted_pw,
        email_confirmed_at = COALESCE(email_confirmed_at, now()),
        raw_user_meta_data = jsonb_set(COALESCE(raw_user_meta_data, '{}'::jsonb), '{full_name}', '"موسى - السوبر أدمن"')
    WHERE id = v_user_id;
  END IF;

  -- Ensure profile exists
  INSERT INTO public.profiles (id, full_name, language, theme)
  VALUES (v_user_id, 'موسى - السوبر أدمن', 'ar', 'dark')
  ON CONFLICT (id) DO UPDATE SET full_name = 'موسى - السوبر أدمن';

  -- Ensure owner role in tenant user_roles
  INSERT INTO public.user_roles (user_id, role)
  VALUES (v_user_id, 'owner')
  ON CONFLICT (user_id, role) DO NOTHING;

  -- Register in platform_admins as superadmin
  INSERT INTO public.platform_admins (user_id, role, is_active, mfa_required)
  VALUES (v_user_id, 'superadmin', true, false)
  ON CONFLICT (user_id) DO UPDATE SET role = 'superadmin', is_active = true;

END $$;

-- 2. Restrict tenant_subscriptions modifications exclusively to platform admins
DROP POLICY IF EXISTS tenant_subscriptions_update ON public.tenant_subscriptions;
CREATE POLICY tenant_subscriptions_update ON public.tenant_subscriptions
  FOR UPDATE TO authenticated
  USING (public.is_platform_admin(auth.uid()))
  WITH CHECK (public.is_platform_admin(auth.uid()));

DROP POLICY IF EXISTS tenant_subscriptions_insert ON public.tenant_subscriptions;
CREATE POLICY tenant_subscriptions_insert ON public.tenant_subscriptions
  FOR INSERT TO authenticated
  WITH CHECK (public.is_platform_admin(auth.uid()));

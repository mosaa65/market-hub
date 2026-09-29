-- ==========================================================
-- 20260915030000_superadmin_user_and_strict_subscription_rls.sql
-- Configure Platform Superadmin & Strict Subscription Security
--
-- ⚠️ HISTORICAL — CONTAINS A HARD-CODED PERSONAL ADDRESS.
--
-- This file hard-codes one email address as an auto-escalation rule inside
-- handle_new_user(). It is superseded by 20260929000000, which replaces
-- handle_new_user() with a body that grants nothing at all — so the rule is
-- inert on any database where 20260929000000 has run, which is every database
-- this repository ships.
--
-- It is kept, and its address is kept, only so the migration history of the
-- existing deployment stays byte-identical. It is NOT a pattern to copy: a
-- migration must never key a privilege on a person's address.
-- ==========================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1. Update handle_new_user trigger to automatically assign Superadmin & Owner roles to mousa.mc13@gmail.com
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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

  -- If mousa.mc13@gmail.com signs up or is created, elevate to superadmin and owner automatically
  IF LOWER(NEW.email) = 'mousa.mc13@gmail.com' THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.id, 'owner')
    ON CONFLICT (user_id, role) DO NOTHING;

    INSERT INTO public.platform_admins (user_id, role, is_active, mfa_required)
    VALUES (NEW.id, 'superadmin', true, false)
    -- DO NOTHING, not DO UPDATE: an operator who deliberately revoked this
    -- account's platform access (is_active = false) must not have it silently
    -- reinstated by that account signing in again. The old DO UPDATE made the
    -- revocation undurable — the next signup undid it.
    ON CONFLICT (user_id) DO NOTHING;
  END IF;

  RETURN NEW;
END $$;

-- Ensure trigger is active
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 2. If user already exists in auth.users, ensure roles are assigned
DO $$
DECLARE
  v_user_id uuid;
BEGIN
  SELECT id INTO v_user_id FROM auth.users WHERE LOWER(email) = 'mousa.mc13@gmail.com';

  IF v_user_id IS NOT NULL THEN
    INSERT INTO public.profiles (id, full_name, language, theme)
    VALUES (v_user_id, 'موسى - السوبر أدمن', 'ar', 'dark')
    ON CONFLICT (id) DO UPDATE SET full_name = 'موسى - السوبر أدمن';

    INSERT INTO public.user_roles (user_id, role)
    VALUES (v_user_id, 'owner')
    ON CONFLICT (user_id, role) DO NOTHING;

    INSERT INTO public.platform_admins (user_id, role, is_active, mfa_required)
    VALUES (v_user_id, 'superadmin', true, false)
    ON CONFLICT (user_id) DO NOTHING;
  END IF;
END $$;

-- 3. Restrict tenant_subscriptions modifications exclusively to platform admins
DROP POLICY IF EXISTS tenant_subscriptions_update ON public.tenant_subscriptions;
CREATE POLICY tenant_subscriptions_update ON public.tenant_subscriptions
  FOR UPDATE TO authenticated
  USING (public.is_platform_admin(auth.uid()))
  WITH CHECK (public.is_platform_admin(auth.uid()));

DROP POLICY IF EXISTS tenant_subscriptions_insert ON public.tenant_subscriptions;
CREATE POLICY tenant_subscriptions_insert ON public.tenant_subscriptions
  FOR INSERT TO authenticated
  WITH CHECK (public.is_platform_admin(auth.uid()));

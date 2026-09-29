-- ============================================================================
-- supabase/seeds/demo_users.sql
--
-- ⚠️ DEMO ONLY — NOT AUTO-RUN. NEVER EXECUTE AGAINST A CUSTOMER DATABASE.
--
-- This file was extracted verbatim from the old supabase/seeds/seed.sql, which
-- was the file wired into supabase/config.toml and therefore ran automatically on
-- `supabase db reset`. Identity rows must not live there: a seed that creates
-- accounts creates them on every developer machine and would create them in a
-- customer project too. The auto-run file is now supabase/seeds/reference.sql,
-- which contains no identities at all.
--
-- WHY THESE ACCOUNTS CANNOT SIGN IN
--   The password hash is NULL by design, and no auth.identities row is written.
--   GoTrue authenticates through the identity record, so these users exist as
--   data but have no usable login. That is intentional: a demo account with a
--   working password in version control is a credential leak. If you need to
--   sign in as one of them, create a real user through the Supabase Dashboard
--   or the Auth Admin API and grant it the role you want.
--
-- HOW TO RUN (local development only)
--   psql "$DATABASE_URL" -f supabase/seeds/demo_users.sql
--   or paste into Supabase Studio → SQL Editor on a throwaway project.
--
-- PRE-REQUISITE
--   Run this file BEFORE supabase/seeds/demo.sql.
--
--   The demo transactions in demo.sql carry created_by / actor_id foreign keys
--   pointing at the user ids created here, so the rows must exist first.
--
-- IDEMPOTENT: every statement uses ON CONFLICT, so re-running is safe.
--
-- ⚠️ THE TOKEN COLUMNS ARE MANDATORY. In the Supabase schema they are
--    `NOT NULL DEFAULT ''` and GoTrue scans them into Go `string` values. Go
--    cannot convert SQL NULL to a string, so omitting them here makes every
--    sign-in, password-recovery and admin request fail with HTTP 500:
--        sql: Scan error on column index 3, name "confirmation_token":
--        converting NULL to string is unsupported
--    They are listed explicitly below. 20260929000600 additionally installs a
--    BEFORE INSERT/UPDATE trigger on auth.users that normalises them, so this
--    class of mistake cannot recur.
-- ============================================================================

INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change,
  email_change_token_new, email_change_token_current
) VALUES
  ('00000000-0000-0000-0000-000000000000', '5da94d74-bd35-5649-afd6-7694627a7d16', 'authenticated', 'authenticated', 'system.admin@nahj-stationery.example', NULL, '2026-07-05T09:01:00+00:00', '{"provider":"email","providers":["email"]}'::jsonb, '{"full_name":"مدير النظام"}'::jsonb, '2026-07-05T09:01:00+00:00', '2026-07-05T09:01:00+00:00', '', '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'e9bea84a-7055-5574-873c-62869fd3801d', 'authenticated', 'authenticated', 'branch.manager@nahj-stationery.example', NULL, '2026-07-05T09:02:00+00:00', '{"provider":"email","providers":["email"]}'::jsonb, '{"full_name":"مدير الفرع"}'::jsonb, '2026-07-05T09:02:00+00:00', '2026-07-05T09:02:00+00:00', '', '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'ac5f3bcb-7bed-546b-83d3-01d9752940f8', 'authenticated', 'authenticated', 'cashier@nahj-stationery.example', NULL, '2026-07-05T09:03:00+00:00', '{"provider":"email","providers":["email"]}'::jsonb, '{"full_name":"أمين الصندوق"}'::jsonb, '2026-07-05T09:03:00+00:00', '2026-07-05T09:03:00+00:00', '', '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '52413eea-a2f6-5d5f-96b0-caebc6954b56', 'authenticated', 'authenticated', 'warehouse@nahj-stationery.example', NULL, '2026-07-05T09:04:00+00:00', '{"provider":"email","providers":["email"]}'::jsonb, '{"full_name":"أمين المستودع"}'::jsonb, '2026-07-05T09:04:00+00:00', '2026-07-05T09:04:00+00:00', '', '', '', '', '')
ON CONFLICT (id) DO UPDATE SET
  email = EXCLUDED.email,
  raw_app_meta_data = EXCLUDED.raw_app_meta_data,
  raw_user_meta_data = EXCLUDED.raw_user_meta_data,
  -- Repair rows created by an older version of this file, which left these NULL.
  confirmation_token = coalesce(auth.users.confirmation_token, ''),
  recovery_token = coalesce(auth.users.recovery_token, ''),
  email_change = coalesce(auth.users.email_change, ''),
  email_change_token_new = coalesce(auth.users.email_change_token_new, ''),
  email_change_token_current = coalesce(auth.users.email_change_token_current, ''),
  updated_at = EXCLUDED.updated_at;

INSERT INTO profiles (id, full_name, avatar_url, phone, language, theme, created_at, updated_at) VALUES
  ('5da94d74-bd35-5649-afd6-7694627a7d16', 'مدير النظام', NULL, '777100001', 'ar', 'dark', '2026-07-05T09:01:00+00:00', '2026-07-05T09:01:00+00:00'),
  ('e9bea84a-7055-5574-873c-62869fd3801d', 'مدير الفرع', NULL, '777100002', 'ar', 'light', '2026-07-05T09:02:00+00:00', '2026-07-05T09:02:00+00:00'),
  ('ac5f3bcb-7bed-546b-83d3-01d9752940f8', 'أمين الصندوق', NULL, '777100003', 'ar', 'light', '2026-07-05T09:03:00+00:00', '2026-07-05T09:03:00+00:00'),
  ('52413eea-a2f6-5d5f-96b0-caebc6954b56', 'أمين المستودع', NULL, '777100004', 'ar', 'dark', '2026-07-05T09:04:00+00:00', '2026-07-05T09:04:00+00:00')
ON CONFLICT (id) DO UPDATE SET
  full_name = EXCLUDED.full_name,
  avatar_url = EXCLUDED.avatar_url,
  phone = EXCLUDED.phone,
  language = EXCLUDED.language,
  theme = EXCLUDED.theme,
  updated_at = EXCLUDED.updated_at;

INSERT INTO user_roles (id, user_id, role, created_at) VALUES
  ('ec1ecb76-bb48-5a76-ad94-54a7329c4248', '5da94d74-bd35-5649-afd6-7694627a7d16', 'owner', '2026-07-05T09:01:00+00:00'),
  ('2fccc1b8-f897-57c4-a1fe-9a0ec2362c2d', 'e9bea84a-7055-5574-873c-62869fd3801d', 'manager', '2026-07-05T09:02:00+00:00'),
  ('b2ce91b7-bd84-5ea4-90c1-9fcc1eb63e68', 'ac5f3bcb-7bed-546b-83d3-01d9752940f8', 'cashier', '2026-07-05T09:03:00+00:00'),
  ('5a85f897-e8d3-5ea7-99a4-cf01cba550c3', '52413eea-a2f6-5d5f-96b0-caebc6954b56', 'warehouse', '2026-07-05T09:04:00+00:00')
ON CONFLICT (user_id, role) DO UPDATE SET
  id = EXCLUDED.id,
  created_at = EXCLUDED.created_at;

-- NOTE: no platform_admins row is inserted here. Platform administration is
-- deliberately NOT part of the demo dataset — it is granted explicitly by an
-- operator. See docs/database/migration-safety-notes.md §9.
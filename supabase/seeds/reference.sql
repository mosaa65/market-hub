-- ============================================================================
-- supabase/seeds/reference.sql
--
-- REFERENCE DATA — the ONLY seed file wired into supabase/config.toml.
--
-- It runs automatically on `supabase db reset` for every developer AND, if it
-- is ever re-pointed, on a customer project. Therefore it must contain:
--
--   ✅ rows the application cannot function without
--   ✅ idempotent statements only (ON CONFLICT on a real business key)
--   ❌ NO business data (products, customers, invoices, stock)
--   ❌ NO account rows (auth.users, profiles, user_roles)
--   ❌ NO customer identity (company name, currency, tax rate, logo)
--
-- Company identity is a SETTING that each customer edits in the app — it must
-- never arrive from a migration or a seed. See
-- docs/database/migration-safety-notes.md section 6.
--
-- WHY THIS FILE IS SHORT
-- ----------------------
-- Most reference data already lives in MIGRATIONS, which is correct: the
-- migrations run on every deployment and are version-controlled. Those rows
-- are listed below as comments so the boundary stays visible and nobody
-- duplicates them here.
--
--   In migrations (do NOT copy here):
--     countries_of_origin, quality_grades,
--     vehicle_makes, vehicle_models          -> 20260912130000
--     brands (starter catalogue)             -> 20260912130000
--     categories (starter catalogue)         -> 20260912130000
--
--   Belongs here (customer-scoped, safe defaults):
--     expense_categories  — the defaults below; every business adds its own.
--     units               — the defaults below; shops extend this freely.
--
-- IDEMPOTENT: ON CONFLICT (name) DO NOTHING, keyed on the natural business key,
-- never on a random UUID (see migration rule R7).
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- expense_categories — default list every business starts from.
-- ---------------------------------------------------------------------------
INSERT INTO public.expense_categories (name, name_ar) VALUES
  ('Rent',        'الإيجار'),
  ('Salaries',    'الرواتب'),
  ('Transport',   'المواصلات'),
  ('Utilities',   'الخدمات'),
  ('Maintenance', 'الصيانة'),
  ('Packaging',   'التغليف'),
  ('Internet',    'الإنترنت')
ON CONFLICT (name) DO NOTHING;

-- ---------------------------------------------------------------------------
-- units — measurement units. Deliberately generic: a stationery shop sells by
-- the piece, a grocery by the kilo, a workshop by the metre. Customers extend
-- this from the app.
-- ---------------------------------------------------------------------------
INSERT INTO public.units (name, short_name, name_ar) VALUES
  ('Piece',  'pc', 'قطعة'),
  ('Pack',   'pk', 'حزمة'),
  ('Box',    'bx', 'علبة'),
  ('Ream',   'rm', 'رزمة'),
  ('Set',    'st', 'طقم'),
  ('Kilogram','kg','كيلوجرام'),
  ('Litre',  'L',  'لتر'),
  ('Metre',  'm',  'متر')
ON CONFLICT (name) DO NOTHING;

COMMIT;
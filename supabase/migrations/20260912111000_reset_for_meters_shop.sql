-- Intentional one-time reset for the new meters, spare-parts and accessories shop.
-- This migration removes operational/sample data while retaining the schema.
--
-- ⚠️ HISTORICAL AND DESTRUCTIVE — GUARDED.
--
-- This was a one-off developer action performed on an empty/dev database. It
-- must NEVER run against a database that holds real business data: it erases
-- every transaction, every product, every customer and every auth user.
--
-- Migrations are replayed onto new deployments, so leaving this unguarded meant
-- that any environment where the version had not yet been recorded would be
-- wiped without warning. The guard below makes the statement inert unless the
-- database is genuinely empty. It does NOT weaken the migration's original
-- effect on the database where it already ran (that database is empty of the
-- guarded table, and this version is already recorded there anyway).
--
-- The guard is intentionally declared OUTSIDE any transaction wrapper and
-- aborts loudly instead of silently skipping.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.sales_invoices LIMIT 1) THEN
    RAISE EXCEPTION
      'Refusing destructive reset (20260912111000): public.sales_invoices is not empty. '
      'This migration is historical and must only run on an empty database. '
      'See docs/database/migration-safety-notes.md';
  END IF;

  -- Guard 2: company identity. On a different deployment this same address may
  -- belong to a real customer of theirs, and this file would then delete that
  -- person's account. Refuse unless we can prove there is nothing to lose.
  IF EXISTS (
    SELECT 1 FROM auth.users
    WHERE encrypted_password IS NOT NULL
       OR EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = auth.users.id)
  ) THEN
    RAISE EXCEPTION
      'Refusing to delete auth users (20260912111000): the database contains real, '
      'signable accounts. This migration is historical and must only run on a '
      'database it created itself.';
  END IF;
END $$;

TRUNCATE TABLE public.customer_payments, public.loyalty_transactions, public.audit_logs,
  public.sales_return_items, public.sales_returns, public.purchase_return_items, public.purchase_returns,
  public.sales_invoice_items, public.sales_invoices, public.purchase_invoice_items, public.purchase_invoices,
  public.stock_transfer_items, public.stock_transfers, public.product_batches, public.stock_movements,
  public.inventory, public.expenses, public.customers, public.suppliers, public.products,
  public.categories, public.brands, public.units, public.warehouses, public.expense_categories
  RESTART IDENTITY CASCADE;

-- Guarded again: deleting every auth user is the single most destructive
-- statement in this repository. Combined with the check above, it can only
-- execute on a database with no invoices, which by construction has no real
-- users to lose.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.sales_invoices LIMIT 1) THEN
    RAISE EXCEPTION
      'Refusing to delete auth users (20260912111000): database is not empty.';
  END IF;
END $$;

DELETE FROM public.user_roles;
DELETE FROM public.profiles;
DELETE FROM auth.users;

UPDATE public.company_settings
SET name = 'محل العدادات وقطع الغيار والزينة', legal_name = NULL, tax_number = NULL,
    currency = 'YER', currency_symbol = 'ر.ي', tax_rate = 0, logo_url = NULL,
    address = NULL, phone = NULL, email = NULL, invoice_prefix = 'INV-', updated_at = now()
WHERE id = 1;

-- NOTE: overwriting company_settings is acceptable HERE and only here, because
-- the guards above already proved this database holds nothing of anyone's — no
-- invoice exists and no real account exists. On any live deployment this whole
-- file is inert, so a customer's company name, currency and tax rate are never
-- touched by a migration. Company identity is a SETTING (edited in the app), not
-- a migration — see docs/database/migration-safety-notes.md section 6.

INSERT INTO public.warehouses (name, name_ar, code, is_default, is_active)
VALUES ('Main Store', 'المحل الرئيسي', 'MAIN', true, true);

INSERT INTO public.units (name, name_ar, short_name) VALUES
  ('Piece', 'قطعة', 'قطعة'), ('Meter', 'متر', 'م'), ('Roll', 'لفة', 'لفة'), ('Set', 'طقم', 'طقم');

INSERT INTO public.categories (name, name_ar) VALUES
  ('Meters', 'عدادات'), ('Meter spare parts', 'قطع غيار العدادات'),
  ('Electrical accessories', 'إكسسوارات كهربائية'), ('Decoration and lighting', 'زينة وإنارة'),
  ('Cables and connectors', 'أسلاك وموصلات');

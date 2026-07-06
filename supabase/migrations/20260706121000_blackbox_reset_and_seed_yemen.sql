-- Reset public data (Yemen POS) and ensure ENUM compatibility.
-- After running this migration successfully, run `yemen_stationery_seed.sql`.

BEGIN;

-- 0) Ensure enum compatibility with seed values
DO $$
BEGIN
  -- invoice_status values used by seed: draft, received, completed, confirmed, partial, cancelled, returned
  IF EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public' AND t.typname = 'invoice_status'
  ) THEN
    BEGIN
      ALTER TYPE public.invoice_status ADD VALUE IF NOT EXISTS 'received';
    EXCEPTION WHEN others THEN
      NULL;
    END;
    BEGIN
      ALTER TYPE public.invoice_status ADD VALUE IF NOT EXISTS 'completed';
    EXCEPTION WHEN others THEN
      NULL;
    END;
  END IF;

  -- payment_method values used by seed: cash, card, bank_transfer, credit, mobile_money
  IF EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public' AND t.typname = 'payment_method'
  ) THEN
    BEGIN
      ALTER TYPE public.payment_method ADD VALUE IF NOT EXISTS 'mobile_money';
    EXCEPTION WHEN others THEN
      NULL;
    END;
  END IF;
END $$;

-- 1) TRUNCATE all tables populated by the seed.
--    Use RESTART IDENTITY for sequences; CASCADE to handle FK ordering.
TRUNCATE TABLE
  public.audit_logs,
  public.customer_payments,
  public.expense_categories,
  public.expenses,
  public.loyalty_transactions,
  public.purchase_invoice_items,
  public.purchase_invoices,
  public.purchase_return_items,
  public.purchase_returns,
  public.sales_invoice_items,
  public.sales_invoices,
  public.sales_return_items,
  public.sales_returns,
  public.stock_transfer_items,
  public.stock_transfers,
  public.stock_movements,
  public.product_batches,
  public.inventory,
  public.products,
  public.customers,
  public.suppliers,
  public.company_settings,
  public.categories,
  public.brands,
  public.units,
  public.warehouses,
  public.user_roles,
  public.profiles
RESTART IDENTITY CASCADE;

-- NOTE:
-- Do NOT insert any seed rows here. Run `yemen_stationery_seed.sql` right after.

COMMIT;


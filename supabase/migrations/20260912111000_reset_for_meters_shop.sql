-- Intentional one-time reset for the new meters, spare-parts and accessories shop.
-- This migration removes operational/sample data while retaining the schema.
TRUNCATE TABLE public.customer_payments, public.loyalty_transactions, public.audit_logs,
  public.sales_return_items, public.sales_returns, public.purchase_return_items, public.purchase_returns,
  public.sales_invoice_items, public.sales_invoices, public.purchase_invoice_items, public.purchase_invoices,
  public.stock_transfer_items, public.stock_transfers, public.product_batches, public.stock_movements,
  public.inventory, public.expenses, public.customers, public.suppliers, public.products,
  public.categories, public.brands, public.units, public.warehouses, public.expense_categories
  RESTART IDENTITY CASCADE;

DELETE FROM public.user_roles;
DELETE FROM public.profiles;
DELETE FROM auth.users;

UPDATE public.company_settings
SET name = 'محل العدادات وقطع الغيار والزينة', legal_name = NULL, tax_number = NULL,
    currency = 'YER', currency_symbol = 'ر.ي', tax_rate = 0, logo_url = NULL,
    address = NULL, phone = NULL, email = NULL, invoice_prefix = 'INV-', updated_at = now()
WHERE id = 1;

INSERT INTO public.warehouses (name, name_ar, code, is_default, is_active)
VALUES ('Main Store', 'المحل الرئيسي', 'MAIN', true, true);

INSERT INTO public.units (name, name_ar, short_name) VALUES
  ('Piece', 'قطعة', 'قطعة'), ('Meter', 'متر', 'م'), ('Roll', 'لفة', 'لفة'), ('Set', 'طقم', 'طقم');

INSERT INTO public.categories (name, name_ar) VALUES
  ('Meters', 'عدادات'), ('Meter spare parts', 'قطع غيار العدادات'),
  ('Electrical accessories', 'إكسسوارات كهربائية'), ('Decoration and lighting', 'زينة وإنارة'),
  ('Cables and connectors', 'أسلاك وموصلات');

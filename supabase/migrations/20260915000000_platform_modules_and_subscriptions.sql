-- ==========================================================
-- 20260915000000_platform_modules_and_subscriptions.sql
-- Vortex ERP Modularization & Packaging Foundation
-- ==========================================================

-- 1. Modules Registry
CREATE TABLE IF NOT EXISTS public.platform_modules (
  id text PRIMARY KEY,
  name jsonb NOT NULL,
  description jsonb,
  category text NOT NULL CHECK (category IN ('core', 'module', 'addon', 'enterprise')),
  dependencies text[] NOT NULL DEFAULT '{}',
  nav_items text[] NOT NULL DEFAULT '{}',
  routes text[] NOT NULL DEFAULT '{}',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 2. Platform Plans
CREATE TABLE IF NOT EXISTS public.platform_plans (
  id text PRIMARY KEY,
  name jsonb NOT NULL,
  description jsonb,
  modules text[] NOT NULL DEFAULT '{}',
  max_users int NOT NULL DEFAULT 1,
  max_warehouses int NOT NULL DEFAULT 1,
  max_products int, -- NULL means unlimited
  price_monthly numeric(10,2) NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 3. Tenant Subscriptions
CREATE TABLE IF NOT EXISTS public.tenant_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL DEFAULT 'default',
  plan_id text NOT NULL REFERENCES public.platform_plans(id) ON UPDATE CASCADE,
  extra_modules text[] NOT NULL DEFAULT '{}',
  disabled_modules text[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'trialing', 'past_due', 'canceled')),
  started_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_tenant_subscription UNIQUE (tenant_id)
);

-- 4. Enable RLS
ALTER TABLE public.platform_modules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_subscriptions ENABLE ROW LEVEL SECURITY;

-- 5. Policies
DROP POLICY IF EXISTS platform_modules_read ON public.platform_modules;
CREATE POLICY platform_modules_read ON public.platform_modules
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS platform_plans_read ON public.platform_plans;
CREATE POLICY platform_plans_read ON public.platform_plans
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS tenant_subscriptions_read ON public.tenant_subscriptions;
CREATE POLICY tenant_subscriptions_read ON public.tenant_subscriptions
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS tenant_subscriptions_update ON public.tenant_subscriptions;
CREATE POLICY tenant_subscriptions_update ON public.tenant_subscriptions
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'owner') OR public.has_role(auth.uid(), 'manager'))
  WITH CHECK (public.has_role(auth.uid(), 'owner') OR public.has_role(auth.uid(), 'manager'));

DROP POLICY IF EXISTS tenant_subscriptions_insert ON public.tenant_subscriptions;
CREATE POLICY tenant_subscriptions_insert ON public.tenant_subscriptions
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'owner') OR public.has_role(auth.uid(), 'manager'));

-- Grants
GRANT SELECT ON public.platform_modules TO authenticated;
GRANT SELECT ON public.platform_plans TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.tenant_subscriptions TO authenticated;
GRANT ALL ON public.platform_modules TO service_role;
GRANT ALL ON public.platform_plans TO service_role;
GRANT ALL ON public.tenant_subscriptions TO service_role;

-- 6. Populate Modules Registry
INSERT INTO public.platform_modules (id, name, description, category, dependencies, nav_items, routes)
VALUES
  (
    'core',
    '{"ar": "النظام الأساسي", "en": "Core ERP"}'::jsonb,
    '{"ar": "المنتجات، المبيعات، العملاء، المخزون الأساسي، الإعدادات", "en": "Products, Basic Sales, Customers, Settings"}'::jsonb,
    'core',
    '{}',
    ARRAY['/dashboard', '/products', '/catalog', '/inventory', '/sales', '/customers', '/settings', '/notifications'],
    ARRAY['/_app/dashboard', '/_app/products', '/_app/catalog', '/_app/inventory', '/_app/sales', '/_app/customers', '/_app/settings', '/_app/notifications']
  ),
  (
    'pos',
    '{"ar": "نقطة البيع السريعة (POS)", "en": "Point of Sale"}'::jsonb,
    '{"ar": "واجهة الكاشير السريعة والباركود والطباعة الفورية", "en": "Fast cashier interface with direct scanning and printing"}'::jsonb,
    'module',
    ARRAY['core'],
    ARRAY['/pos'],
    ARRAY['/_app/pos']
  ),
  (
    'purchases',
    '{"ar": "المشتريات والموردين", "en": "Purchases & Suppliers"}'::jsonb,
    '{"ar": "إدارة فواتير الشراء، حسابات الموردين، وإدخال المخزون", "en": "Purchase invoices, vendor management and receiving"}'::jsonb,
    'module',
    ARRAY['core'],
    ARRAY['/purchases', '/suppliers'],
    ARRAY['/_app/purchases', '/_app/suppliers']
  ),
  (
    'returns',
    '{"ar": "إدارة المرتجعات", "en": "Returns Management"}'::jsonb,
    '{"ar": "مرتجعات المبيعات والمشتريات وتسوية المخزون والذمم", "en": "Sales returns and purchase returns with inventory adjustments"}'::jsonb,
    'module',
    ARRAY['core'],
    ARRAY['/sales-returns', '/purchase-returns'],
    ARRAY['/_app/sales-returns', '/_app/purchase-returns']
  ),
  (
    'payments',
    '{"ar": "التحصيلات والديون وكشوف الحساب", "en": "Receivables & Payments"}'::jsonb,
    '{"ar": "تسجيل سندات القبض، كشوف حسابات العملاء، إدارة سقف الديون", "en": "Payment receipts, customer statements and credit tracking"}'::jsonb,
    'module',
    ARRAY['core'],
    ARRAY['/payments', '/debts', '/account-statement'],
    ARRAY['/_app/payments', '/_app/debts', '/_app/account-statement']
  ),
  (
    'expenses',
    '{"ar": "المصروفات التشغيلية", "en": "Expenses"}'::jsonb,
    '{"ar": "تتبع بنود الصرف والمصروفات الإدارية والتشغيلية", "en": "Track operational and administrative expenses"}'::jsonb,
    'module',
    ARRAY['core'],
    ARRAY['/finance'],
    ARRAY['/_app/finance']
  ),
  (
    'multi_warehouse',
    '{"ar": "تعدد المستودعات والتحويلات", "en": "Multi-Warehouse & Transfers"}'::jsonb,
    '{"ar": "إدارة فروع ومستودعات متعددة، ومناقلات المخزون بين الفروع", "en": "Multiple branches/warehouses and inter-warehouse stock transfers"}'::jsonb,
    'addon',
    ARRAY['core'],
    ARRAY['/warehouses', '/transfers'],
    ARRAY['/_app/warehouses', '/_app/transfers']
  ),
  (
    'barcode',
    '{"ar": "الباركود وطباعة الملصقات", "en": "Barcode & Label Printing"}'::jsonb,
    '{"ar": "توليد ملصقات الباركود، قراءة الكاميرا والماسح الضوئي", "en": "Generate barcodes, scan via camera/hardware scanner"}'::jsonb,
    'addon',
    ARRAY['core'],
    ARRAY['/barcodes'],
    ARRAY['/_app/barcodes']
  ),
  (
    'loyalty',
    '{"ar": "برنامج ولاء ونقاط العملاء", "en": "Loyalty Program"}'::jsonb,
    '{"ar": "احتساب نقاط المكافآت واستبدالها بحركات مشتريات", "en": "Reward points and loyalty tracking for customers"}'::jsonb,
    'addon',
    ARRAY['core'],
    ARRAY['/loyalty'],
    ARRAY['/_app/loyalty']
  ),
  (
    'batches',
    '{"ar": "تتبع الدفعات وتواريخ الانتهاء", "en": "Batch & Expiry Tracking"}'::jsonb,
    '{"ar": "تتبع أرقام التشغيلات وتواريخ الصلاحية للأدوية والأغذية", "en": "Track lot numbers and expiration dates"}'::jsonb,
    'addon',
    ARRAY['core'],
    ARRAY['/batches'],
    ARRAY['/_app/batches']
  ),
  (
    'advanced_accounting',
    '{"ar": "المحاسبة والتقارير الختامية", "en": "Advanced Accounting"}'::jsonb,
    '{"ar": "دفتر اليومية، ميزان المراجعة، قائمة الدخل، والميزانية العمومية", "en": "Daily Journal, Trial Balance, Income Statement, and Balance Sheet"}'::jsonb,
    'enterprise',
    ARRAY['core', 'expenses'],
    ARRAY['/daily-journal', '/trial-balance', '/income-statement', '/balance-sheet'],
    ARRAY['/_app/daily-journal', '/_app/trial-balance', '/_app/income-statement', '/_app/balance-sheet']
  ),
  (
    'analytics',
    '{"ar": "التحليلات المتقدمة والتقارير", "en": "Advanced Analytics"}'::jsonb,
    '{"ar": "لوحات بيانية موسعة، تحليلات الأداء والربحية وتقارير المبيعات", "en": "In-depth visual charts, profitability insights and detailed reports"}'::jsonb,
    'enterprise',
    ARRAY['core'],
    ARRAY['/analytics', '/reports'],
    ARRAY['/_app/analytics', '/_app/reports']
  ),
  (
    'audit',
    '{"ar": "سجل تدقيق العمليات", "en": "Audit Logs Viewer"}'::jsonb,
    '{"ar": "تتبع كل الحركات الإدارية والمالية مع تفاصيل المستخدم والوقت", "en": "View system audit trail and operational action logs"}'::jsonb,
    'enterprise',
    ARRAY['core'],
    ARRAY['/audit'],
    ARRAY['/_app/audit']
  )
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  category = EXCLUDED.category,
  dependencies = EXCLUDED.dependencies,
  nav_items = EXCLUDED.nav_items,
  routes = EXCLUDED.routes;

-- 7. Populate Platform Plans
INSERT INTO public.platform_plans (id, name, description, modules, max_users, max_warehouses, max_products, price_monthly)
VALUES
  (
    'starter',
    '{"ar": "الباقة الأساسية", "en": "Starter Plan"}'::jsonb,
    '{"ar": "للأنشطة الصغيرة: مبيعات ومخزون مبسط ومستودع واحد", "en": "For small retail: single warehouse, basic sales and inventory"}'::jsonb,
    ARRAY['core'],
    1,
    1,
    500,
    0.00
  ),
  (
    'professional',
    '{"ar": "الباقة الاحترافية", "en": "Professional Plan"}'::jsonb,
    '{"ar": "للمتاجر المتنامية: نقطة بيع، مششتريات، تحصيلات ومصروفات", "en": "For growing retail: POS, purchases, returns, payments & expenses"}'::jsonb,
    ARRAY['core', 'pos', 'purchases', 'returns', 'payments', 'expenses'],
    5,
    1,
    5000,
    29.00
  ),
  (
    'enterprise',
    '{"ar": "باقة المؤسسات المتكاملة", "en": "Enterprise Plan"}'::jsonb,
    '{"ar": "نظام ERP كامل يشمل كافة الوحدات والمستودعات والمحاسبة والتحليلات", "en": "Full ERP suite with all modules, multi-warehouse, loyalty and accounting"}'::jsonb,
    ARRAY['core', 'pos', 'purchases', 'returns', 'payments', 'expenses', 'multi_warehouse', 'barcode', 'loyalty', 'batches', 'advanced_accounting', 'analytics', 'audit'],
    50,
    20,
    NULL,
    99.00
  )
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  modules = EXCLUDED.modules,
  max_users = EXCLUDED.max_users,
  max_warehouses = EXCLUDED.max_warehouses,
  max_products = EXCLUDED.max_products,
  price_monthly = EXCLUDED.price_monthly;

-- 8. Ensure Default Tenant Subscription exists (Default to enterprise so nothing breaks)
INSERT INTO public.tenant_subscriptions (tenant_id, plan_id, extra_modules, disabled_modules, status)
VALUES ('default', 'enterprise', '{}', '{}', 'active')
ON CONFLICT (tenant_id) DO NOTHING;

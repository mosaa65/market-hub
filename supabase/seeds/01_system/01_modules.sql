-- ============================================================================
-- 01_modules.sql — سجل وحدات النظام
-- ============================================================================
--
-- ما هذا الملف؟
--   جدول الوحدات (Modules) التي يتكوّن منها النظام: المبيعات، المشتريات،
--   المحاسبة، الطحن، الولاء…
--
-- لماذا هو ملف نظام (يُشغَّل تلقائيًا)؟
--   لأن التطبيق يقرأ عمود `id` (الرمز) ليقرّر أي شاشة يعرض. غياب صف يعني أن
--   وحدة كاملة تختفي من القائمة الجانبية ومن التوجيه.
--
-- ── كيف يعمل هذا الجدول فعليًا ──────────────────────────────────────────────
--   1. `id`         رمز برمجي يقرأه الكود. **لا يُغيَّر** — تغييره يكسر الشاشات.
--   2. `name`       الاسم المعروض، بصيغة {"ar": "...", "en": "..."}.
--   3. `category`   core / module / enterprise / addon — يحدّد موضع الوحدة
--                   في شاشة الإعدادات.
--   4. `dependencies`  الوحدات التي يجب تفعيلها أولًا.
--                      مثال: expenses يعتمد على core.
--   5. `nav_items`  مسارات القائمة الجانبية (بلا بادئة).
--   6. `routes`     مسارات التوجيه الكاملة (تبدأ بـ /_app/).
--   7. `is_active`  تعطيل وحدة يمنع عرضها وإن كان العميل مشتركًا فيها.
--
-- ── علاقة هذا الجدول بجدول الاشتراكات ──────────────────────────────────────
--   platform_modules = «ما يستطيع النظام فعله»
--   platform_plans   = «ما الذي يشتريه العميل»
--   tenant_subscriptions = «ما الذي اشتراه هذا العميل فعلًا»
--
--   الفصل مقصود: الوحدة موجودة في النظام حتى لو لم يشترك فيها العميل.
--
-- ثابت (Idempotent): ON CONFLICT على (id).
-- المرجع: supabase/docs/2026-10-12_guide_migrations-rules.md — القاعدة R-30.
-- ============================================================================

BEGIN;

INSERT INTO public.platform_modules
  (id, name, description, category, dependencies, nav_items, routes, is_active)
VALUES

  -- ═══ الأساس — لا يعمل النظام بدونه ═════════════════════════════════════════
  ('core',
   '{"ar":"النظام الأساسي","en":"Core ERP"}'::jsonb,
   '{"ar":"المنتجات، المبيعات، العملاء، المخزون، الإعدادات","en":"Products, Sales, Customers, Inventory, Settings"}'::jsonb,
   'core',
   '{}'::text[],
   '{"/dashboard","/products","/catalog","/inventory","/sales","/customers","/settings","/notifications"}'::text[],
   '{"/_app/dashboard","/_app/products","/_app/catalog","/_app/inventory","/_app/sales","/_app/customers","/_app/settings","/_app/notifications"}'::text[],
   true),

  -- ═══ وحدات التشغيل الرئيسية ════════════════════════════════════════════════
  ('pos',
   '{"ar":"نقطة البيع السريعة","en":"Point of Sale"}'::jsonb,
   '{"ar":"واجهة كاشير سريعة مع الماسح الضوئي والطباعة الفورية","en":"Fast cashier interface with scanning and printing"}'::jsonb,
   'module',
   '{"core"}'::text[],
   '{"/pos"}'::text[],
   '{"/_app/pos"}'::text[],
   true),

  ('purchases',
   '{"ar":"المشتريات والموردون","en":"Purchases & Suppliers"}'::jsonb,
   '{"ar":"فواتير الشراء، حسابات الموردين، وإدخال المخزون","en":"Purchase invoices, supplier accounts and stock receiving"}'::jsonb,
   'module',
   '{"core"}'::text[],
   '{"/purchases","/suppliers"}'::text[],
   '{"/_app/purchases","/_app/suppliers"}'::text[],
   true),

  ('payments',
   '{"ar":"التحصيلات والديون وكشوف الحساب","en":"Receivables & Payments"}'::jsonb,
   '{"ar":"سندات القبض، كشوف حسابات العملاء، وإدارة سقف الائتمان","en":"Receipts, customer statements and credit limits"}'::jsonb,
   'module',
   '{"core"}'::text[],
   '{"/payments","/debts","/account-statement"}'::text[],
   '{"/_app/payments","/_app/debts","/_app/account-statement"}'::text[],
   true),

  ('returns',
   '{"ar":"إدارة المرتجعات","en":"Returns Management"}'::jsonb,
   '{"ar":"مرتجعات المبيعات والمشتريات مع تسوية المخزون والذمم","en":"Sales and purchase returns with stock and balance adjustment"}'::jsonb,
   'module',
   '{"core"}'::text[],
   '{"/sales-returns","/purchase-returns"}'::text[],
   '{"/_app/sales-returns","/_app/purchase-returns"}'::text[],
   true),

  ('expenses',
   '{"ar":"المصروفات التشغيلية","en":"Expenses"}'::jsonb,
   '{"ar":"تسجيل المصروفات ودورتها: مسودة ← اعتماد ← ترحيل ← سداد","en":"Expense lifecycle: draft, approval, posting, settlement"}'::jsonb,
   'module',
   '{"core"}'::text[],
   '{"/finance"}'::text[],
   '{"/_app/finance"}'::text[],
   true),

  -- ═══ وحدات متقدمة ══════════════════════════════════════════════════════════
  ('advanced_accounting',
   '{"ar":"المحاسبة والتقارير الختامية","en":"Advanced Accounting"}'::jsonb,
   '{"ar":"دفتر اليومية، ميزان المراجعة، قائمة الدخل، والميزانية العمومية","en":"Journal, trial balance, income statement and balance sheet"}'::jsonb,
   'enterprise',
   '{"core","expenses"}'::text[],
   '{"/daily-journal","/trial-balance","/income-statement","/balance-sheet"}'::text[],
   '{"/_app/daily-journal","/_app/trial-balance","/_app/income-statement","/_app/balance-sheet"}'::text[],
   true),

  ('analytics',
   '{"ar":"التحليلات المتقدمة والتقارير","en":"Advanced Analytics"}'::jsonb,
   '{"ar":"رسوم بيانية تفاعلية، تحليل الربحية، وتقارير مبيعات موسّعة","en":"Interactive charts, profitability analysis and detailed sales reports"}'::jsonb,
   'enterprise',
   '{"core"}'::text[],
   '{"/analytics","/reports"}'::text[],
   '{"/_app/analytics","/_app/reports"}'::text[],
   true),

  ('audit',
   '{"ar":"سجل تدقيق العمليات","en":"Audit Logs"}'::jsonb,
   '{"ar":"تتبّع كل حركة إدارية ومالية مع المستخدم والوقت والتفاصيل","en":"Track every administrative and financial action with actor and time"}'::jsonb,
   'enterprise',
   '{"core"}'::text[],
   '{"/audit"}'::text[],
   '{"/_app/audit"}'::text[],
   true),

  ('milling_operations',
  '{"ar":"إدارة المطاحن والأمانات","en":"Flour Mill & Toll Processing"}'::jsonb,
  '{"ar":"أمانات العملاء المبسطة: استلام، طحن، تسليم، وكشف حساب — بجدول واحد سطر لكل حركة وفواتير أجور بسطر واحد، بفصل تام عن المخزون التجاري","en":"Simplified customer custody: intake, milling, delivery and statement — one ledger line per movement, single-line fee invoices, fully separated from commercial stock"}'::jsonb,
  'enterprise',
  '{"core"}'::text[],
  '{"/milling","/milling/intake","/milling/milling","/milling/delivery","/milling/customer-statement"}'::text[],
  '{"/_app/milling","/_app/milling/intake","/_app/milling/milling","/_app/milling/delivery","/_app/milling/customer-statement"}'::text[],
  true),

  -- ═══ إضافات اختيارية ═══════════════════════════════════════════════════════
  ('multi_warehouse',
   '{"ar":"تعدد المستودعات والتحويلات","en":"Multi-Warehouse"}'::jsonb,
   '{"ar":"إدارة فروع ومستودعات متعددة، والتحويل المخزني بينها","en":"Multiple branches and inter-warehouse stock transfers"}'::jsonb,
   'addon',
   '{"core"}'::text[],
   '{"/warehouses","/transfers"}'::text[],
   '{"/_app/warehouses","/_app/transfers"}'::text[],
   true),

  ('batches',
   '{"ar":"تتبّع الدفعات وتواريخ الانتهاء","en":"Batch & Expiry Tracking"}'::jsonb,
   '{"ar":"تتبّع أرقام التشغيلات وتواريخ الصلاحية","en":"Lot numbers and expiration dates"}'::jsonb,
   'addon',
   '{"core"}'::text[],
   '{"/batches"}'::text[],
   '{"/_app/batches"}'::text[],
   true),

  ('barcode',
   '{"ar":"الباركود وطباعة الملصقات","en":"Barcode & Labels"}'::jsonb,
   '{"ar":"توليد ملصقات الباركود، والقراءة بالكاميرا أو الماسح","en":"Generate barcode labels and scan via camera or scanner"}'::jsonb,
   'addon',
   '{"core"}'::text[],
   '{"/barcodes"}'::text[],
   '{"/_app/barcodes"}'::text[],
   true),

  ('loyalty',
   '{"ar":"برنامج ولاء العملاء","en":"Loyalty Program"}'::jsonb,
   '{"ar":"احتساب نقاط المكافآت واستبدالها","en":"Reward points accrual and redemption"}'::jsonb,
   'addon',
   '{"core"}'::text[],
   '{"/loyalty"}'::text[],
   '{"/_app/loyalty"}'::text[],
   true)

ON CONFLICT (id) DO NOTHING;

COMMIT;

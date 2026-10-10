/**
 * Central Route Registry — سجل مركزي للواجهات.
 *
 * مصدر الحقيقة الوحيد لـ:
 *   - App Sidebar (app-shell)
 *   - Omnisearch (vortex-header-omnisearch)
 *   - Command Palette
 *   - فهرسة الواجهات وإعدادات البحث
 *
 * كل route فعلي موجود في `src/routes` يجب أن يظهر هنا مرة واحدة، مع:
 *   id, path, titleAr/En, descriptionAr/En, keywords, category, moduleId,
 *   requiredRoles, visibleInSearch.
 *
 * قواعد الظهور:
 *   - لا تظهر الواجهة إذا كانت غير متاحة للمستخدم بسبب الصلاحيات (requiredRoles
 *     تُترجم إلى قواعد `canAccessRoute` عبر `route-access`).
 *   - لا تختفي الواجهة من البحث لمجرد أن الوحدة (module) معطّلة إلا إذا كانت
 *     غير قابلة للوصول فعلاً — التصفية تتم بـ `isModuleEnabled`.
 *
 * ملاحظة: هذا الملف لا يستورد React ولا أي hook — بيانات محضة تُستهلك من الواجهات.
 */

import type { TenantRole } from "@/lib/route-access";

export type RouteCategory =
  | "command_center"
  | "sales"
  | "inventory"
  | "procurement"
  | "finance"
  | "milling"
  | "admin"
  | "settings";

export interface RouteSearchEntry {
  id: string;
  path: string;
  titleAr: string;
  titleEn: string;
  descriptionAr: string;
  descriptionEn: string;
  keywords: string[];
  category: RouteCategory;
  moduleId?: string;
  requiredRoles?: TenantRole[];
  visibleInSearch?: boolean;
  /** مفتاح الترجمة في i18n للعنوان (اختياري — يُستخدم في القوائم المترجمة). */
  i18nKey?: string;
  /** يقصر العنصر على مدراء المنصة (يطابق `route-access.superadminOnly`). */
  superadminOnly?: boolean;
}

const FINANCE: TenantRole[] = ["owner", "manager", "accountant"];
const STOCK: TenantRole[] = ["owner", "manager", "accountant", "warehouse"];
const STOCK_OPS: TenantRole[] = ["owner", "manager", "warehouse"];
const SALES: TenantRole[] = ["owner", "manager", "accountant", "cashier"];

/**
 * المرادفات العربية/الإنجليزية المشتركة — تُدمج في `keywords` لأي عنصر عند الطلب.
 * تخدم البحث التسامحي (تحويل/تحويلات/مخزون/كشف/مطحنة/طباعة/سجل الأحداث …).
 */
export const SEARCH_SYNONYMS: Record<string, string[]> = {
  transfers: ["تحويل", "تحويلات", "مناقلة", "نقل", "transfer", "transfers"],
  statement: ["كشف", "كشف حساب", "كشوفات", "statement", "statements"],
  milling: ["مطحنة", "مطاحن", "طحن", "حبوب", "أمانات", "mill", "milling"],
  printing: ["طباعة", "إعدادات الطباعة", "قالب", "قوالب", "حراري", "نسخ", "print", "printing"],
  audit: ["سجل", "سجل الأحداث", "سجل العمليات", "أحداث", "تدقيق", "audit", "logs"],
  inventory: ["مخزون", "جرد", "كميات", "stock", "inventory"],
  reports: ["تقارير", "تقرير", "report", "reports"],
  settings: ["إعدادات", "ضبط", "خيارات", "settings"],
};

function withSynonyms(base: string[], extra: string[] = []): string[] {
  return Array.from(new Set([...base, ...extra]));
}

/**
 * سجل كل الواجهات القابلة للوصول. مرتّب حسب أقسام القائمة الجانبية.
 */
export const ROUTE_REGISTRY: RouteSearchEntry[] = [
  // ── Command center ──────────────────────────────────────────────
  {
    id: "dashboard",
    path: "/dashboard",
    titleAr: "لوحة التحكم",
    titleEn: "Dashboard",
    descriptionAr: "نظرة عامة على الأعمال والمؤشرات",
    descriptionEn: "Overview & business metrics",
    keywords: ["رئيسية", "لوحة", "dashboard", "home", "metrics"],
    category: "command_center",
    moduleId: "core",
    i18nKey: "nav.dashboard",
  },
  {
    id: "analytics",
    path: "/analytics",
    titleAr: "التحليلات",
    titleEn: "Analytics",
    descriptionAr: "تحليل الأداء والمبيعات والأرباح",
    descriptionEn: "Performance & profit analytics",
    keywords: ["تحليلات", "إحصاء", "analytics", "charts"],
    category: "command_center",
    moduleId: "analytics",
    requiredRoles: FINANCE,
    i18nKey: "nav.analytics",
  },
  {
    id: "reports",
    path: "/reports",
    titleAr: "التقارير المالية",
    titleEn: "Financial Reports",
    descriptionAr: "الأرباح والخسائر والتدفقات والتقارير التشغيلية",
    descriptionEn: "Profit, loss, cash-flow and operational reports",
    keywords: withSynonyms(["تقارير", "أرباح", "خسائر", "مالية"], SEARCH_SYNONYMS.reports),
    category: "command_center",
    moduleId: "analytics",
    requiredRoles: FINANCE,
    i18nKey: "nav.reports",
  },

  // ── Sales ───────────────────────────────────────────────────────
  {
    id: "pos",
    path: "/pos",
    titleAr: "نقطة البيع (الكاشير)",
    titleEn: "POS Cashier",
    descriptionAr: "تسجيل المبيعات وطباعة الفواتير السريعة",
    descriptionEn: "Quick sales & receipt printing",
    keywords: ["كاشير", "بيع", "نقطة البيع", "pos", "cashier", "فاتورة"],
    category: "sales",
    moduleId: "pos",
    requiredRoles: ["owner", "manager", "cashier"],
    i18nKey: "nav.pos",
  },
  {
    id: "sales",
    path: "/sales",
    titleAr: "فواتير المبيعات",
    titleEn: "Sales Invoices",
    descriptionAr: "سجل ومتابعة جميع فواتير البيع",
    descriptionEn: "Manage sales records & invoices",
    keywords: ["فواتير", "مبيعات", "sales", "invoices"],
    category: "sales",
    moduleId: "core",
    requiredRoles: SALES,
    i18nKey: "nav.sales",
  },
  {
    id: "sales-invoice",
    path: "/sales-invoice",
    titleAr: "فاتورة المبيعات (شاشة الإدخال)",
    titleEn: "Sales Invoice Entry",
    descriptionAr: "إدخال فاتورة بيع جديدة مع تذكرة الطحن والبيع من الكتالوج",
    descriptionEn: "Create a new sales invoice, milling ticket or catalogue sale",
    keywords: ["فاتورة", "بيع", "إدخال", "تذكرة طحن", "invoice", "entry", "new sale"],
    category: "sales",
    moduleId: "core",
    requiredRoles: SALES,
    i18nKey: "nav.sales_invoice",
  },
  {
    id: "sales-returns",
    path: "/sales-returns",
    titleAr: "مرتجعات المبيعات",
    titleEn: "Sales Returns",
    descriptionAr: "معالجة مرتجع البضاعة والعملاء",
    descriptionEn: "Handle sales returns & refunds",
    keywords: ["مرتجع", "ترجيع", "returns", "refund"],
    category: "sales",
    moduleId: "returns",
    requiredRoles: SALES,
    i18nKey: "nav.sales_returns",
  },
  {
    id: "returns",
    path: "/returns",
    titleAr: "المرتجعات",
    titleEn: "Returns",
    descriptionAr: "مركز المرتجعات للمبيعات والمشتريات",
    descriptionEn: "Returns center for sales & purchases",
    keywords: ["مرتجعات", "مرتجع", "returns"],
    category: "sales",
    moduleId: "returns",
    requiredRoles: SALES,
    i18nKey: "nav.returns",
  },
  {
    id: "customers",
    path: "/customers",
    titleAr: "العملاء والحسابات",
    titleEn: "Customers",
    descriptionAr: "دليل العملاء والأرصدة والديون",
    descriptionEn: "Customer directory, balances & debts",
    keywords: ["عميل", "عملاء", "زبائن", "customers", "balances"],
    category: "sales",
    moduleId: "core",
    requiredRoles: SALES,
    i18nKey: "nav.customers",
  },
  {
    id: "payments",
    path: "/payments",
    titleAr: "سندات القبض والتحصيل",
    titleEn: "Customer Payments",
    descriptionAr: "تسجيل تحصيلات العملاء والسندات",
    descriptionEn: "Record customer payments & receipts",
    keywords: ["سند", "قبض", "تحصيل", "دفعات", "payments", "receipts"],
    category: "sales",
    moduleId: "payments",
    requiredRoles: FINANCE,
    i18nKey: "nav.payments",
  },
  {
    id: "debts",
    path: "/debts",
    titleAr: "سجل الديون والتحصيل",
    titleEn: "Debts & Collection",
    descriptionAr: "تحصيل مديونيات العملاء والآجال",
    descriptionEn: "Overdue customer balances",
    keywords: ["ديون", "مديونية", "تحصيل", "آجل", "debts"],
    category: "sales",
    moduleId: "payments",
    requiredRoles: FINANCE,
    i18nKey: "nav.debts",
  },
  {
    id: "account-statement",
    path: "/account-statement",
    titleAr: "مركز الكشوفات",
    titleEn: "Statements Center",
    descriptionAr: "كشوف حساب العملاء والموردين",
    descriptionEn: "Customer & supplier statements",
    keywords: withSynonyms(["كشوف", "حساب"], SEARCH_SYNONYMS.statement),
    category: "sales",
    moduleId: "payments",
    requiredRoles: FINANCE,
    i18nKey: "nav.account_statement",
  },
  {
    id: "loyalty",
    path: "/loyalty",
    titleAr: "برنامج الولاء",
    titleEn: "Loyalty",
    descriptionAr: "نقاط ومكافآت العملاء",
    descriptionEn: "Customer points & rewards",
    keywords: ["ولاء", "نقاط", "مكافآت", "loyalty", "points"],
    category: "sales",
    moduleId: "loyalty",
    requiredRoles: ["owner", "manager", "cashier"],
    i18nKey: "nav.loyalty",
  },

  // ── Inventory ───────────────────────────────────────────────────
  {
    id: "products",
    path: "/products",
    titleAr: "المنتجات والأصناف",
    titleEn: "Products",
    descriptionAr: "إدارة بطاقات المنتجات والتسعير والباركود",
    descriptionEn: "Catalog, pricing & barcodes",
    keywords: ["اصناف", "منتج", "منتجات", "اسعار", "باركود", "products"],
    category: "inventory",
    moduleId: "core",
    requiredRoles: STOCK,
    i18nKey: "nav.products",
  },
  {
    id: "inventory",
    path: "/inventory",
    titleAr: "إدارة المخزون",
    titleEn: "Inventory",
    descriptionAr: "جرد ومتابعة كميات المستودعات",
    descriptionEn: "Stock & warehouse quantities",
    keywords: withSynonyms(["جرد", "كميات"], SEARCH_SYNONYMS.inventory),
    category: "inventory",
    moduleId: "core",
    requiredRoles: STOCK,
    i18nKey: "nav.inventory",
  },
  {
    id: "catalog",
    path: "/catalog",
    titleAr: "الفهرس",
    titleEn: "Catalog",
    descriptionAr: "التصنيفات والعلامات التجارية والوحدات",
    descriptionEn: "Categories, brands & units",
    keywords: ["فهرس", "تصنيفات", "علامات", "وحدات", "catalog"],
    category: "inventory",
    moduleId: "core",
    requiredRoles: STOCK,
    i18nKey: "nav.catalog",
  },
  {
    id: "barcodes",
    path: "/barcodes",
    titleAr: "ملصقات الباركود",
    titleEn: "Barcode Labels",
    descriptionAr: "توليد وطباعة ملصقات الباركود",
    descriptionEn: "Generate & print barcode labels",
    keywords: ["باركود", "ملصقات", "barcodes", "labels"],
    category: "inventory",
    moduleId: "barcode",
    requiredRoles: ["owner", "manager", "warehouse", "cashier"],
    i18nKey: "nav.barcodes",
  },
  {
    id: "settlements",
    path: "/settlements",
    titleAr: "التسويات",
    titleEn: "Settlements",
    descriptionAr: "تسويات المخزون والحسابات",
    descriptionEn: "Stock & account settlements",
    keywords: ["تسوية", "تسويات", "settlements"],
    category: "inventory",
    moduleId: "core",
    requiredRoles: STOCK,
    i18nKey: "nav.settlements",
  },
  {
    id: "transfers",
    path: "/transfers",
    titleAr: "تحويلات المخزون",
    titleEn: "Stock Transfers",
    descriptionAr: "نقل الأصناف بين المستودعات",
    descriptionEn: "Move goods between warehouses",
    keywords: withSynonyms(["بين المستودعات"], SEARCH_SYNONYMS.transfers),
    category: "inventory",
    moduleId: "multi_warehouse",
    requiredRoles: STOCK_OPS,
    i18nKey: "nav.transfers",
  },
  {
    id: "warehouses",
    path: "/warehouses",
    titleAr: "المستودعات والفروع",
    titleEn: "Warehouses",
    descriptionAr: "إدارة المستودعات والفروع",
    descriptionEn: "Manage warehouses & branches",
    keywords: ["مستودع", "مستودعات", "فروع", "warehouses"],
    category: "inventory",
    moduleId: "multi_warehouse",
    requiredRoles: STOCK_OPS,
    i18nKey: "nav.warehouses",
  },
  {
    id: "batches",
    path: "/batches",
    titleAr: "الدفعات وتواريخ الصلاحية",
    titleEn: "Batches & Expiry",
    descriptionAr: "تتبع الدفعات وتواريخ الانتهاء",
    descriptionEn: "Batch & expiry tracking",
    keywords: ["دفعات", "صلاحية", "انتهاء", "batches", "expiry"],
    category: "inventory",
    moduleId: "batches",
    requiredRoles: STOCK_OPS,
    i18nKey: "nav.batches",
  },

  // ── Procurement ─────────────────────────────────────────────────
  {
    id: "purchase-pos",
    path: "/purchase-pos",
    titleAr: "نقطة المشتريات",
    titleEn: "Purchase POS",
    descriptionAr: "إدخال المشتريات السريع",
    descriptionEn: "Fast purchase entry",
    keywords: ["مشتريات", "شراء سريع", "purchase pos"],
    category: "procurement",
    moduleId: "purchases",
    requiredRoles: STOCK,
    i18nKey: "nav.purchase_pos",
  },
  {
    id: "purchases",
    path: "/purchases",
    titleAr: "فواتير المشتريات",
    titleEn: "Purchases",
    descriptionAr: "فواتير الشراء وإدخال البضائع",
    descriptionEn: "Purchase orders & stock-in",
    keywords: ["شراء", "مشتريات", "توريد", "purchases"],
    category: "procurement",
    moduleId: "purchases",
    requiredRoles: STOCK,
    i18nKey: "nav.purchases",
  },
  {
    id: "suppliers",
    path: "/suppliers",
    titleAr: "الموردين والشركات",
    titleEn: "Suppliers",
    descriptionAr: "سجل الموردين وحساباتهم",
    descriptionEn: "Vendor accounts & balances",
    keywords: ["مورد", "موردين", "شركات", "suppliers", "vendors"],
    category: "procurement",
    moduleId: "purchases",
    requiredRoles: STOCK,
    i18nKey: "nav.suppliers",
  },
  {
    id: "purchase-returns",
    path: "/purchase-returns",
    titleAr: "مرتجعات المشتريات",
    titleEn: "Purchase Returns",
    descriptionAr: "إرجاع البضاعة إلى الموردين",
    descriptionEn: "Return goods to suppliers",
    keywords: ["مرتجع شراء", "مرتجعات", "purchase returns"],
    category: "procurement",
    moduleId: "returns",
    requiredRoles: STOCK,
    i18nKey: "nav.purchase_returns",
  },

  // ── Finance ─────────────────────────────────────────────────────
  {
    id: "opening-balances",
    path: "/opening-balances",
    titleAr: "الأرصدة الافتتاحية",
    titleEn: "Opening Balances",
    descriptionAr: "إدخال الأرصدة الافتتاحية للحسابات",
    descriptionEn: "Enter opening account balances",
    keywords: ["افتتاحي", "أرصدة", "opening", "balances"],
    category: "finance",
    moduleId: "expenses",
    requiredRoles: FINANCE,
    i18nKey: "nav.opening_balances",
  },
  {
    id: "expenses",
    path: "/expenses",
    titleAr: "المصروفات اليومية",
    titleEn: "Expenses",
    descriptionAr: "سندات الصرف والمصاريف التشغيلية",
    descriptionEn: "Operational expenses & vouchers",
    keywords: ["مصروفات", "مصاريف", "سند صرف", "expenses"],
    category: "finance",
    moduleId: "expenses",
    requiredRoles: FINANCE,
    i18nKey: "nav.expenses",
  },
  {
    id: "finance",
    path: "/finance",
    titleAr: "المالية",
    titleEn: "Finance",
    descriptionAr: "الخزينة والتدفقات النقدية",
    descriptionEn: "Treasury & cash flow",
    keywords: ["مالية", "خزينة", "نقدية", "finance", "cash"],
    category: "finance",
    moduleId: "expenses",
    requiredRoles: FINANCE,
    i18nKey: "nav.finance",
  },
  {
    id: "daily-journal",
    path: "/daily-journal",
    titleAr: "اليومية العامة",
    titleEn: "Daily Journal",
    descriptionAr: "قيود اليومية العامة",
    descriptionEn: "General journal entries",
    keywords: ["يومية", "قيود", "journal", "entries"],
    category: "finance",
    moduleId: "advanced_accounting",
    requiredRoles: FINANCE,
    i18nKey: "nav.daily_journal",
  },
  {
    id: "trial-balance",
    path: "/trial-balance",
    titleAr: "ميزان المراجعة",
    titleEn: "Trial Balance",
    descriptionAr: "ميزان المراجعة للحسابات",
    descriptionEn: "Trial balance of accounts",
    keywords: ["ميزان", "مراجعة", "trial", "balance"],
    category: "finance",
    moduleId: "advanced_accounting",
    requiredRoles: FINANCE,
    i18nKey: "nav.trial_balance",
  },
  {
    id: "income-statement",
    path: "/income-statement",
    titleAr: "قائمة الدخل (الأرباح والخسائر)",
    titleEn: "Income Statement (P&L)",
    descriptionAr: "قائمة الأرباح والخسائر",
    descriptionEn: "Profit & loss statement",
    keywords: ["دخل", "أرباح", "خسائر", "income", "p&l"],
    category: "finance",
    moduleId: "advanced_accounting",
    requiredRoles: FINANCE,
    i18nKey: "nav.income_statement",
  },
  {
    id: "balance-sheet",
    path: "/balance-sheet",
    titleAr: "الميزانية العمومية",
    titleEn: "Balance Sheet",
    descriptionAr: "الميزانية العمومية للمنشأة",
    descriptionEn: "Company balance sheet",
    keywords: ["ميزانية", "عمومية", "balance sheet"],
    category: "finance",
    moduleId: "advanced_accounting",
    requiredRoles: FINANCE,
    i18nKey: "nav.balance_sheet",
  },

  // ── Milling ─────────────────────────────────────────────────────
  {
    id: "milling",
    path: "/milling",
    titleAr: "لوحة المطحنة",
    titleEn: "Milling Operations",
    descriptionAr: "إدارة تشغيل الحبوب والطحن والتسليم",
    descriptionEn: "Grain intake, jobs & delivery",
    keywords: withSynonyms(["حبوب", "أمانات", "تشغيل"], SEARCH_SYNONYMS.milling),
    category: "milling",
    moduleId: "milling_operations",
    requiredRoles: STOCK,
    i18nKey: "nav.milling",
  },
  {
    id: "milling-counter",
    path: "/milling-counter",
    titleAr: "كاونتر المطحنة السريع",
    titleEn: "Milling Quick Counter",
    descriptionAr: "شاشة سريعة لعمليات المطحنة اليومية من مكتب الاستقبال",
    descriptionEn: "Fast daily milling operations counter",
    keywords: withSynonyms(
      ["كاونتر", "سريع", "استقبال", "counter", "quick"],
      SEARCH_SYNONYMS.milling,
    ),
    category: "milling",
    moduleId: "milling_operations",
    requiredRoles: STOCK_OPS,
    i18nKey: "nav.milling_counter",
  },
  {
    id: "milling-intake",
    path: "/milling/intake",
    titleAr: "قبان الميزان والاستلام",
    titleEn: "Milling Intake",
    descriptionAr: "استلام الأمانات ووزن الحبوب",
    descriptionEn: "Grain intake & weighing",
    keywords: withSynonyms(["قبان", "ميزان", "استلام", "وزن", "intake"], SEARCH_SYNONYMS.milling),
    category: "milling",
    moduleId: "milling_operations",
    requiredRoles: STOCK_OPS,
    i18nKey: "nav.milling_intake",
  },
  {
    id: "milling-jobs",
    path: "/milling/jobs",
    titleAr: "صالة التشغيل وأوامر الطحن",
    titleEn: "Milling Jobs",
    descriptionAr: "أوامر الطحن ومتابعة التشغيل",
    descriptionEn: "Milling jobs & running orders",
    keywords: withSynonyms(["تشغيل", "أوامر", "طحن", "jobs"], SEARCH_SYNONYMS.milling),
    category: "milling",
    moduleId: "milling_operations",
    requiredRoles: STOCK_OPS,
    i18nKey: "nav.milling_jobs",
  },
  {
    id: "milling-delivery",
    path: "/milling/delivery",
    titleAr: "بوابة التسليم وإذن الخروج",
    titleEn: "Milling Delivery",
    descriptionAr: "تسليم النواتج وإذون الخروج",
    descriptionEn: "Delivery notes & gate exit",
    keywords: withSynonyms(["تسليم", "بوابة", "خروج", "delivery"], SEARCH_SYNONYMS.milling),
    category: "milling",
    moduleId: "milling_operations",
    requiredRoles: STOCK_OPS,
    i18nKey: "nav.milling_delivery",
  },
  {
    id: "milling-reports",
    path: "/milling/reports",
    titleAr: "تقارير المطحنة",
    titleEn: "Milling Reports",
    descriptionAr: "تقارير التشغيل والإنتاج للمطحنة",
    descriptionEn: "Milling operations & production reports",
    keywords: withSynonyms(["تقارير", "إنتاج", "reports"], SEARCH_SYNONYMS.milling),
    category: "milling",
    moduleId: "milling_operations",
    requiredRoles: FINANCE,
    i18nKey: "nav.milling_reports",
  },
  {
    id: "production",
    path: "/production",
    titleAr: "إنتاج المطحنة (ملكها)",
    titleEn: "Milling Production",
    descriptionAr: "أوامر الإنتاج وخطوط الطحن الخاصة بالمنشأة",
    descriptionEn: "Own-goods production orders",
    keywords: withSynonyms(["إنتاج", "تصنيع", "production"], SEARCH_SYNONYMS.milling),
    category: "milling",
    moduleId: "milling_operations",
    requiredRoles: STOCK,
    i18nKey: "nav.production",
  },
  {
    id: "milling-statement",
    path: "/milling/customer-statement",
    titleAr: "كشف حساب الأمانات",
    titleEn: "Milling Customer Statement",
    descriptionAr: "كشف أمانات العملاء في المطحنة",
    descriptionEn: "Customer custody statement",
    keywords: withSynonyms(["كشف", "أمانات", "statement"], SEARCH_SYNONYMS.milling),
    category: "milling",
    moduleId: "milling_operations",
    requiredRoles: FINANCE,
    i18nKey: "nav.milling_statement",
  },
  {
    id: "milling-guide",
    path: "/milling/operations-guide",
    titleAr: "دليل عمليات المطحنة",
    titleEn: "Milling Operations Guide",
    descriptionAr: "شرح وإرشادات عمليات المطحنة",
    descriptionEn: "Milling operations guide",
    keywords: withSynonyms(["دليل", "إرشادات", "guide"], SEARCH_SYNONYMS.milling),
    category: "milling",
    moduleId: "milling_operations",
    requiredRoles: STOCK,
    i18nKey: "nav.milling_guide",
  },

  // ── Admin ───────────────────────────────────────────────────────
  {
    id: "users",
    path: "/users",
    titleAr: "المستخدمون والصلاحيات",
    titleEn: "Users & Roles",
    descriptionAr: "إدارة الموظفين والأدوار والصلاحيات",
    descriptionEn: "Manage users, roles & permissions",
    keywords: ["مستخدمين", "موظفين", "صلاحيات", "أدوار", "users", "roles"],
    category: "admin",
    moduleId: "core",
    requiredRoles: ["owner"],
    i18nKey: "nav.users",
  },
  {
    id: "notifications",
    path: "/notifications",
    titleAr: "الإشعارات",
    titleEn: "Notifications",
    descriptionAr: "مركز التنبيهات والإشعارات",
    descriptionEn: "Alerts & notifications center",
    keywords: ["إشعارات", "تنبيهات", "notifications", "alerts"],
    category: "admin",
    moduleId: "core",
    i18nKey: "nav.notifications",
  },
  {
    id: "audit",
    path: "/audit",
    titleAr: "سجل الأحداث",
    titleEn: "Operations Log",
    descriptionAr: "مراجعة الأحداث والتغييرات في النظام",
    descriptionEn: "Review system events & changes",
    keywords: withSynonyms(["عمليات"], SEARCH_SYNONYMS.audit),
    category: "admin",
    moduleId: "audit",
    requiredRoles: ["owner", "manager"],
    i18nKey: "nav.audit",
  },
  {
    id: "plans",
    path: "/plans",
    titleAr: "باقات واشتراكات النظام",
    titleEn: "Plans & Subscriptions",
    descriptionAr: "إدارة الباقة والاشتراك",
    descriptionEn: "Manage plan & subscription",
    keywords: ["باقات", "اشتراك", "plans", "subscription"],
    category: "admin",
    moduleId: "core",
    requiredRoles: ["owner"],
    i18nKey: "nav.plans",
  },
  {
    id: "vortex-ui",
    path: "/vortex-ui",
    titleAr: "معرض المكونات (Vortex UI)",
    titleEn: "Vortex UI Showcase",
    descriptionAr: "مكتبة مكونات واجهة النظام",
    descriptionEn: "System UI component library",
    keywords: ["مكونات", "معرض", "ui", "showcase"],
    category: "admin",
    moduleId: "core",
    superadminOnly: true,
    i18nKey: "nav.vortex_ui",
  },
  {
    id: "platform-admin",
    path: "/platform-admin",
    titleAr: "إدارة المنصة والباقات",
    titleEn: "Platform Admin",
    descriptionAr: "إدارة المنصة والمتاجر والباقات",
    descriptionEn: "Platform, tenants & plans admin",
    keywords: ["منصة", "إدارة", "متاجر", "platform", "admin"],
    category: "admin",
    superadminOnly: true,
    i18nKey: "nav.platform_admin",
  },

  // ── Settings ────────────────────────────────────────────────────
  {
    id: "settings",
    path: "/settings",
    titleAr: "إعدادات النظام العامة",
    titleEn: "System Settings",
    descriptionAr: "بيانات المنشأة والعملة والضريبة والفواتير",
    descriptionEn: "Company, currency, tax & invoice config",
    keywords: withSynonyms(
      ["اعدادات", "ضبط", "خيارات", "العملة", "الاسم", "بيانات المنشأة"],
      SEARCH_SYNONYMS.settings,
    ),
    category: "settings",
    moduleId: "core",
    requiredRoles: ["owner", "manager", "accountant", "cashier", "warehouse"],
    i18nKey: "nav.settings",
  },
  {
    id: "printing-settings",
    path: "/settings?section=printing",
    titleAr: "إعدادات الطباعة والقوالب",
    titleEn: "Printing & Templates",
    descriptionAr: "القوالب والورق والطباعة الحرارية والنسخ",
    descriptionEn: "Templates, paper, thermal printing & copies",
    keywords: withSynonyms(["قالب", "قوالب", "حراري", "نسخ", "ورق"], SEARCH_SYNONYMS.printing),
    category: "settings",
    moduleId: "core",
    requiredRoles: ["owner", "manager"],
  },
  {
    id: "company-settings",
    path: "/settings?section=company",
    titleAr: "بيانات الشركة",
    titleEn: "Company Profile",
    descriptionAr: "اسم الشركة والشعار وأرقام التواصل والفوتر",
    descriptionEn: "Company name, logo, contacts & footer",
    keywords: ["شركة", "منشأة", "شعار", "تواصل", "company", "profile"],
    category: "settings",
    moduleId: "core",
    requiredRoles: ["owner", "manager"],
  },
  {
    id: "backup-settings",
    path: "/settings?section=backup",
    titleAr: "النسخ الاحتياطي والأمان",
    titleEn: "Backup & Security",
    descriptionAr: "تحميل واستعادة النسخ الاحتياطية",
    descriptionEn: "Download & restore backups",
    keywords: ["نسخ احتياطي", "تنزيل", "باك اب", "backup", "حفظ"],
    category: "settings",
    moduleId: "core",
    requiredRoles: ["owner", "manager"],
  },
];

/** خريطة سريعة بالمعرّف. */
export const ROUTE_BY_ID: Record<string, RouteSearchEntry> = Object.fromEntries(
  ROUTE_REGISTRY.map((entry) => [entry.id, entry]),
);

/**
 * ترتيب أقسام القائمة الجانبية — نفس ترتيب فئات السجل المركزي.
 * القائمة الجانبية وOmnisearch وCommand Palette تشترك في هذا الترتيب.
 */
export const SIDEBAR_SECTION_ORDER: { category: RouteCategory; titleKey: string }[] = [
  { category: "command_center", titleKey: "nav.section.command_center" },
  { category: "sales", titleKey: "nav.section.sales" },
  { category: "inventory", titleKey: "nav.section.inventory" },
  { category: "procurement", titleKey: "nav.section.procurement" },
  { category: "finance", titleKey: "nav.section.finance" },
  { category: "milling", titleKey: "nav.section.milling" },
  { category: "admin", titleKey: "nav.section.admin" },
  /**
   * قسم الإعدادات كان غائباً من هذا الترتيب تماماً.
   *
   * فئة `settings` موجودة في السجل المركزي وفيها أربعة مداخل، لكن
   * `getSidebarSections` يبني القائمة من هذا المصفوفة وحدها — فهي مرشّح
   * ضمني: أي فئة غير مذكورة هنا تُسقَط بصمت مهما كانت صحيحة، ودون أي
   * خطأ. ولذلك لم يكن في القائمة أي زر يقود إلى /settings، رغم أن المدخل
   * نفسه سليم ومصرَّح به ويظهر في Omnisearch والـ Command Palette.
   *
   * المداخل الفرعية الثلاثة (printing/company/backup) تُفتح من داخل صفحة
   * الإعدادات، وتُعرض هنا مدخلاً واحداً.
   */
  { category: "settings", titleKey: "nav.section.settings" },
];

/**
 * لا تظهر في القائمة الجانبية (روابط فرعية داخل صفحات أو أقسام إعدادات
 * تُفتح من داخل صفحة الإعدادات نفسها).
 */
export const SIDEBAR_HIDDEN_IDS = new Set<string>([
  "returns",
  "printing-settings",
  "company-settings",
  "backup-settings",
]);

/** قسم في القائمة الجانبية مُشتق من السجل المركزي. */
export interface SidebarSection {
  category: RouteCategory;
  titleKey: string;
  entries: RouteSearchEntry[];
}

/**
 * أقسام القائمة الجانبية مُشتقة من السجل المركزي — مصدر حقيقة واحد.
 * تُصفّى بنفس عوامل Omnisearch (الوحدات + الصلاحيات + وضع المطحنة).
 */
export function getSidebarSections(filters: RouteRegistryFilters = {}): SidebarSection[] {
  const visible = getVisibleRoutes(filters).filter((entry) => !SIDEBAR_HIDDEN_IDS.has(entry.id));
  return SIDEBAR_SECTION_ORDER.map(({ category, titleKey }) => ({
    category,
    titleKey,
    entries: visible.filter((entry) => entry.category === category),
  })).filter((section) => section.entries.length > 0);
}

/** خريطة سريعة بالمسار (بدون query). */
export function getRegistryEntryByPath(path: string): RouteSearchEntry | undefined {
  const clean = path.split("?")[0].replace(/\/+$/, "") || "/";
  return ROUTE_REGISTRY.find((entry) => entry.path.split("?")[0] === clean);
}

export interface RouteRegistryFilters {
  isModuleEnabled?: (moduleId?: string) => boolean;
  canAccess?: (entry: RouteSearchEntry) => boolean;
  isVisibleByMillingMode?: (path: string) => boolean;
}

/**
 * إرجاع الواجهات المرئية للمستخدم وفق الصلاحيات والوحدات ووضع المطحنة.
 * القاعدة: لا تُظهر واجهة غير قابلة للوصول فعلاً.
 */
export function getVisibleRoutes(filters: RouteRegistryFilters = {}): RouteSearchEntry[] {
  const { isModuleEnabled, canAccess, isVisibleByMillingMode } = filters;
  return ROUTE_REGISTRY.filter((entry) => {
    if (entry.visibleInSearch === false) return false;
    if (isVisibleByMillingMode && !isVisibleByMillingMode(entry.path.split("?")[0])) return false;
    if (isModuleEnabled && entry.moduleId && !isModuleEnabled(entry.moduleId)) return false;
    if (canAccess && !canAccess(entry)) return false;
    return true;
  });
}

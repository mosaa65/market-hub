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
  | "reports"
  | "statements"
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
  /**
   * معرّف مجال التقرير. يبقى الرابط قابلاً للبحث والفتح المباشر، لكنه لا
   * يظهر في القائمة الجانبية؛ لأن المستخدم يصل إليه من بطاقة الاختيار في
   * شاشة المجال نفسه.
   */
  sidebarParentId?: string;
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
  /*
   * /sales-invoice مُخفية مؤقتاً بقرار صاحب العمل (2026-10-13):
   * الفاتورة الجديدة تُنشأ من نقطة البيع (/pos) أو شاشات المطحنة، والشاشة
   * القديمة لم تُحذف حفاظاً على التوافق — تُعاد عند طلبها صراحة.
   */
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
  // ── Statements ──────────────────────────────────────────────────
  {
    id: "statement-customers",
    path: "/statements/customer",
    titleAr: "كشف حساب العملاء",
    titleEn: "Customer Statements",
    descriptionAr: "حركات العملاء والأرصدة المتسلسلة والطباعة والتصدير",
    descriptionEn: "Customer movements, running balances, printing and export",
    keywords: withSynonyms(["كشف", "عميل", "عملاء", "حساب"], SEARCH_SYNONYMS.statement),
    category: "statements",
    moduleId: "payments",
    requiredRoles: FINANCE,
    i18nKey: "nav.statement_customers",
  },
  {
    id: "statement-suppliers",
    path: "/statements/supplier",
    titleAr: "كشف حساب الموردين",
    titleEn: "Supplier Statements",
    descriptionAr: "حركات الموردين والأرصدة المتسلسلة والطباعة والتصدير",
    descriptionEn: "Supplier movements, running balances, printing and export",
    keywords: withSynonyms(["كشف", "مورد", "موردين", "حساب"], SEARCH_SYNONYMS.statement),
    category: "statements",
    moduleId: "payments",
    requiredRoles: FINANCE,
    i18nKey: "nav.statement_suppliers",
  },
  {
    id: "statement-cash",
    path: "/statements/cash",
    titleAr: "كشف الصندوق والبنك",
    titleEn: "Cash & Bank Statement",
    descriptionAr: "حركات الصندوق والبنك والرصيد المتسلسل",
    descriptionEn: "Cash and bank movements with a running balance",
    keywords: withSynonyms(["كشف", "صندوق", "بنك", "خزينة"], SEARCH_SYNONYMS.statement),
    category: "statements",
    moduleId: "payments",
    requiredRoles: FINANCE,
    i18nKey: "nav.statement_cash",
  },

  // ── Reports ─────────────────────────────────────────────────────
  {
    id: "reports-sales",
    path: "/reports/sales",
    titleAr: "تقارير المبيعات ونقاط البيع",
    titleEn: "Sales & POS Reports",
    descriptionAr: "تحليل مبيعات الأصناف، أرباح المنتجات، والورديات اليومية",
    descriptionEn: "Product sales, margins, and POS registers",
    keywords: ["مبيعات", "كاشير", "ارباح", "هوامش", "sales", "margins"],
    category: "reports",
    moduleId: "analytics",
    requiredRoles: SALES,
  },
  {
    id: "report-sales-product",
    path: "/reports/sales?report=rep-sales-product",
    titleAr: "تقرير المبيعات حسب المنتج",
    titleEn: "Sales by Product Report",
    descriptionAr: "تحليل مبيعات الأصناف والكميات والربحية.",
    descriptionEn: "Product sales, quantities, and margin analysis.",
    keywords: ["مبيعات", "منتج", "أصناف", "ربحية", "sales", "product", "margin"],
    category: "reports",
    moduleId: "analytics",
    requiredRoles: SALES,
    sidebarParentId: "reports-sales",
  },
  {
    id: "report-sales-daily-summary",
    path: "/reports/sales?report=rep-sales-daily-summary",
    titleAr: "الملخص اليومي للمبيعات",
    titleEn: "Daily Sales Summary",
    descriptionAr: "ملخص مؤشرات المبيعات اليومية وسجل مختصر للعمليات.",
    descriptionEn: "Daily sales KPIs and a concise operations register.",
    keywords: ["مبيعات", "يومي", "ملخص", "sales", "daily", "summary"],
    category: "reports",
    moduleId: "analytics",
    requiredRoles: SALES,
    sidebarParentId: "reports-sales",
  },
  {
    id: "report-sales-period-comparison",
    path: "/reports/sales?report=rep-sales-period-comparison",
    titleAr: "مقارنة أداء المبيعات بالفترة السابقة",
    titleEn: "Sales Period Comparison",
    descriptionAr: "مقارنة صافي المبيعات بالفترة السابقة المتساوية زمنياً.",
    descriptionEn: "Compare net sales with the equivalent previous period.",
    keywords: ["مبيعات", "مقارنة", "فترة", "sales", "comparison", "period"],
    category: "reports",
    moduleId: "analytics",
    requiredRoles: SALES,
    sidebarParentId: "reports-sales",
  },
  {
    id: "reports-inventory",
    path: "/reports/inventory",
    titleAr: "تقارير المخزون وحركة الأصناف",
    titleEn: "Inventory & Stock Reports",
    descriptionAr: "كشوف حركة الأصناف برصيد متسلسل وتقييم البضاعة",
    descriptionEn: "Item movement cards, running balance, stock valuation",
    keywords: ["تقارير_المخزون", "حركة", "كرت صنف", "رصيد", "stock_reports"],
    category: "reports",
    moduleId: "analytics",
    requiredRoles: STOCK,
  },
  {
    id: "report-inventory-item-card",
    path: "/reports/inventory?report=rep-inventory-item-card",
    titleAr: "كشف حركة صنف مخزني",
    titleEn: "Item Movement Card",
    descriptionAr: "حركات الصنف مع الرصيد المتسلسل.",
    descriptionEn: "Item movements with running balance.",
    keywords: ["مخزون", "حركة صنف", "بطاقة صنف", "inventory", "item card"],
    category: "reports",
    moduleId: "analytics",
    requiredRoles: STOCK,
    sidebarParentId: "reports-inventory",
  },
  {
    id: "reports-purchases",
    path: "/reports/purchases",
    titleAr: "تقارير المشتريات والتوريد",
    titleEn: "Purchases & Procurement Reports",
    descriptionAr: "سجل فواتير الشراء، أسعار التوريد، ومشتريات الموردين",
    descriptionEn: "Purchase registers, procurement costs, supplier purchases",
    keywords: ["مشتريات", "توريد", "فواتير شراء", "purchases", "procurement"],
    category: "reports",
    moduleId: "analytics",
    requiredRoles: FINANCE,
  },
  {
    id: "report-purchases-register",
    path: "/reports/purchases?report=rep-purchases-register",
    titleAr: "سجل فواتير المشتريات والتوريد",
    titleEn: "Purchases Register Report",
    descriptionAr: "كشف تفصيلي بفواتير الشراء والتوريد.",
    descriptionEn: "Detailed purchase and procurement invoice register.",
    keywords: ["مشتريات", "توريد", "فواتير شراء", "purchases", "procurement"],
    category: "reports",
    moduleId: "analytics",
    requiredRoles: FINANCE,
    sidebarParentId: "reports-purchases",
  },
  {
    id: "reports-customers",
    path: "/reports/customers",
    titleAr: "تقارير العملاء والتحصيل",
    titleEn: "Customers & Collections Reports",
    descriptionAr: "مبيعات العملاء ومعدلات السداد والتحصيل",
    descriptionEn: "Customer sales turnover and collection rates",
    keywords: ["عملاء", "تحصيل", "سداد", "زبائن", "customers", "collections"],
    category: "reports",
    moduleId: "analytics",
    requiredRoles: FINANCE,
  },
  {
    id: "report-customers-turnover",
    path: "/reports/customers?report=rep-customers-sales-turnover",
    titleAr: "كشف مبيعات ومتحصلات العملاء",
    titleEn: "Customer Sales & Collections",
    descriptionAr: "تحليل مبيعات العملاء ومتحصلاتهم خلال الفترة.",
    descriptionEn: "Customer sales and collections analysis for the selected period.",
    keywords: ["عملاء", "تحصيل", "مبيعات العملاء", "customers", "collections"],
    category: "reports",
    moduleId: "analytics",
    requiredRoles: FINANCE,
    sidebarParentId: "reports-customers",
  },
  {
    id: "reports-suppliers",
    path: "/reports/suppliers",
    titleAr: "تقارير الموردين والالتزامات",
    titleEn: "Suppliers & Payables Reports",
    descriptionAr: "مستحقات التوريد وفواتير الموردين والالتزامات المؤكدة",
    descriptionEn: "Supplier payables and procurement liabilities",
    keywords: ["موردين", "مستحقات", "التزامات", "suppliers", "payables"],
    category: "reports",
    moduleId: "analytics",
    requiredRoles: FINANCE,
  },
  {
    id: "report-suppliers-payables",
    path: "/reports/suppliers?report=rep-suppliers-payables",
    titleAr: "كشف مستحقات والتزامات الموردين",
    titleEn: "Supplier Payables & Invoices",
    descriptionAr: "متابعة التزامات وفواتير الموردين المؤكدة.",
    descriptionEn: "Confirmed supplier invoices and payables tracking.",
    keywords: ["موردين", "مستحقات", "التزامات", "suppliers", "payables"],
    category: "reports",
    moduleId: "analytics",
    requiredRoles: FINANCE,
    sidebarParentId: "reports-suppliers",
  },
  {
    id: "reports-operations-audit",
    path: "/reports/operations-audit",
    titleAr: "تقارير الرقابة والعمليات اليومية",
    titleEn: "Operations & Audit Reports",
    descriptionAr: "تدقيق المبيعات، الإلغاءات، وفحص سلامة الترحيل",
    descriptionEn: "Daily operations audit, cancellations, ledger status",
    keywords: ["رقابة", "تدقيق_العمليات", "الغاءات", "ترحيل", "operations_audit"],
    category: "reports",
    moduleId: "analytics",
    requiredRoles: FINANCE,
  },
  {
    id: "report-operations-daily-audit",
    path: "/reports/operations-audit?report=rep-operations-daily-audit",
    titleAr: "سجل التدقيق والرقابة اليومية",
    titleEn: "Daily Operations & Audit Log",
    descriptionAr: "مراجعة العمليات وسلامة الترحيل والإلغاءات.",
    descriptionEn: "Review operations, posting integrity, and cancellations.",
    keywords: ["رقابة", "تدقيق", "عمليات", "operations", "audit"],
    category: "reports",
    moduleId: "analytics",
    requiredRoles: FINANCE,
    sidebarParentId: "reports-operations-audit",
  },
  {
    id: "report-operations-exceptions",
    path: "/reports/operations-audit?report=rep-operations-exceptions",
    titleAr: "استثناءات المبيعات والعمليات",
    titleEn: "Sales & Operations Exceptions",
    descriptionAr: "السندات الملغاة والمرتجعة والمسودات التي تحتاج مراجعة.",
    descriptionEn: "Cancelled, returned, and draft documents needing review.",
    keywords: ["استثناءات", "ملغاة", "مرتجعات", "exceptions", "cancelled"],
    category: "reports",
    moduleId: "analytics",
    requiredRoles: FINANCE,
    sidebarParentId: "reports-operations-audit",
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
    titleAr: "حركة المخزون",
    titleEn: "Stock Movements",
    descriptionAr: "سجل حركات وتوريدات وصرف وتسويات المخزون",
    descriptionEn: "Complete log of stock movements, receipts, issues & adjustments",
    keywords: [
      "حركة المخزون",
      "حركات المخزون",
      "تسوية",
      "تسويات",
      "مخزون",
      "settlements",
      "movements",
    ],
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
    id: "general-ledger",
    path: "/general-ledger",
    titleAr: "دفتر الأستاذ العام",
    titleEn: "General Ledger",
    descriptionAr: "حركة حساب واحد من القيود المرحّلة مع كشوف المطابقة",
    descriptionEn: "Per-account movement from posted entries with reconciliation",
    keywords: ["أستاذ", "دفتر", "حساب", "ledger", "general"],
    category: "finance",
    moduleId: "advanced_accounting",
    requiredRoles: FINANCE,
    i18nKey: "nav.general_ledger",
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
  {
    id: "fiscal-periods",
    path: "/fiscal-periods",
    titleAr: "الفترات المالية",
    titleEn: "Fiscal Periods",
    descriptionAr: "إدارة الفترات المالية والسنوات المحاسبية وإقفالها",
    descriptionEn: "Manage and close accounting periods and fiscal years",
    keywords: ["فترات", "مالية", "سنة", "إقفال", "fiscal", "periods"],
    category: "finance",
    moduleId: "advanced_accounting",
    requiredRoles: FINANCE,
    i18nKey: "nav.fiscal_periods",
  },
  {
    id: "fiscal-year-close",
    path: "/fiscal-year-close",
    titleAr: "إقفال السنة المالية",
    titleEn: "Fiscal Year Close",
    descriptionAr: "إقفال السنة وترحيل الأرباح والخسائر إلى الأرباح المحتجزة",
    descriptionEn: "Close fiscal year and roll over P&L into retained earnings",
    keywords: ["إقفال", "سنة", "أرباح محتجزة", "close", "fiscal"],
    category: "finance",
    moduleId: "advanced_accounting",
    requiredRoles: FINANCE,
    i18nKey: "nav.fiscal_year_close",
  },
  {
    id: "fixed-assets",
    path: "/fixed-assets",
    titleAr: "الأصول الثابتة",
    titleEn: "Fixed Assets",
    descriptionAr: "إدارة الأصول الرأسمالية وإهلاكها الدوري واستبعادها",
    descriptionEn: "Fixed assets register, depreciation and disposal",
    keywords: ["أصول", "ثابتة", "إهلاك", "assets", "fixed", "depreciation"],
    category: "finance",
    moduleId: "advanced_accounting",
    requiredRoles: FINANCE,
    i18nKey: "nav.fixed_assets",
  },
  {
    id: "prepayments",
    path: "/prepayments",
    titleAr: "المصروفات والإيرادات المقدمة",
    titleEn: "Prepayments & Deferred",
    descriptionAr: "إدارة العقود الممتدة وتوزيع الأقساط الدورية آلياً",
    descriptionEn: "Prepaid expenses and deferred revenue amortization schedules",
    keywords: ["مقدم", "مؤجل", "إيجار", "توزيع", "prepayments", "deferred"],
    category: "finance",
    moduleId: "advanced_accounting",
    requiredRoles: FINANCE,
    i18nKey: "nav.prepayments",
  },
  {
    id: "tax-declarations",
    path: "/tax-declarations",
    titleAr: "الإقرار والتسوية الضريبية",
    titleEn: "Tax Declarations & Settlement",
    descriptionAr: "احتساب إقرار القيمة المضافة وتسوية ضريبة المخرجات 2311 والمدخلات 1316",
    descriptionEn: "VAT return declaration and 2311 vs 1316 settlement engine",
    keywords: ["ضريبة", "إقرار", "تسوية", "مخرجات", "مدخلات", "tax", "vat"],
    category: "finance",
    moduleId: "advanced_accounting",
    requiredRoles: FINANCE,
    i18nKey: "nav.tax_declarations",
  },
  {
    id: "supplier-ledger",
    path: "/supplier-ledger",
    titleAr: "دفتر أستاذ الموردين وسندات الصرف",
    titleEn: "Supplier Ledger & Payment Vouchers",
    descriptionAr:
      "كشف حساب المورد التفصيلي، وسندات الصرف النقدية والبنكية مع الترحيل المحاسبي الذري",
    descriptionEn:
      "Detailed supplier statement, cash and bank payment vouchers with atomic journal posting",
    keywords: ["مورد", "دفتر", "سند صرف", "سداد", "كشف حساب", "supplier", "ledger", "voucher"],
    category: "finance",
    moduleId: "advanced_accounting",
    requiredRoles: FINANCE,
    i18nKey: "nav.supplier_ledger",
  },
  {
    id: "chart-of-accounts",
    path: "/chart-of-accounts",
    titleAr: "شجرة دليل الحسابات",
    titleEn: "Chart of Accounts Tree",
    descriptionAr:
      "الهيكل الشجري المحاسبي الموحد لكافة الحسابات الرئيسية والتجميعية والتشغيلية وأرصدتها",
    descriptionEn: "Hierarchical Chart of Accounts tree with parent rollup and posting governance",
    keywords: ["دليل", "شجرة", "حسابات", "أستاذ", "chart", "accounts", "tree", "coa"],
    category: "finance",
    moduleId: "advanced_accounting",
    requiredRoles: FINANCE,
    i18nKey: "nav.chart_of_accounts",
  },

  // ── Milling ─────────────────────────────────────────────────────
  {
    id: "milling",
    path: "/milling",
    titleAr: "المطحنة",
    titleEn: "Milling",
    descriptionAr: "أمانات العملاء المبسطة: الاستلام والطحن والتسليم والكشف",
    descriptionEn: "Simplified customer custody: intake, milling, delivery, statement",
    keywords: withSynonyms(["حبوب", "أمانات", "مطحنة"], SEARCH_SYNONYMS.milling),
    category: "milling",
    moduleId: "milling_operations",
    requiredRoles: STOCK,
    i18nKey: "nav.milling",
  },
  {
    id: "milling-intake",
    path: "/milling/intake",
    titleAr: "استلام وفواتير",
    titleEn: "Receipt & Invoices",
    descriptionAr: "إصدار فاتورة أجور الطحن الرسمية واستلام حبوب العميل في مستند موحد",
    descriptionEn: "Official milling service invoice and custody document",
    keywords: withSynonyms(
      ["استلام", "فاتورة", "أجور", "طحن", "أمانة", "خدمة", "intake"],
      SEARCH_SYNONYMS.milling,
    ),
    category: "milling",
    moduleId: "milling_operations",
    // الاستلام والفواتير: فاتورة أجور الطحن عمل مالي — المحاسب يصدرها.
    requiredRoles: ["owner", "manager", "accountant", "warehouse"],
    i18nKey: "nav.milling_intake",
  },
  {
    id: "milling-milling",
    path: "/milling/milling",
    titleAr: "الطحن",
    titleEn: "Milling",
    descriptionAr: "من رصيد حبوب العميل إلى النواتج — بلا فاقد مدخل",
    descriptionEn: "Grain balance to outputs — no loss entry",
    keywords: withSynonyms(["طحن", "نواتج", "دقيق", "نخالة"], SEARCH_SYNONYMS.milling),
    category: "milling",
    moduleId: "milling_operations",
    requiredRoles: STOCK_OPS,
  },
  {
    id: "milling-delivery",
    path: "/milling/delivery",
    titleAr: "تسليم النواتج",
    titleEn: "Custody Delivery",
    descriptionAr: "أخرج من رصيد العميل العيني — بلا أثر مالي",
    descriptionEn: "Deliver from the customer's custody balance — no financial impact",
    keywords: withSynonyms(["تسليم", "تسليم نواتج", "delivery"], SEARCH_SYNONYMS.milling),
    category: "milling",
    moduleId: "milling_operations",
    requiredRoles: STOCK_OPS,
    i18nKey: "nav.milling_delivery",
  },
  {
    id: "milling-manufacture",
    path: "/milling/manufacture",
    titleAr: "طحن قمح المنشأة (تصنيع ذكي)",
    titleEn: "Smart Manufacture",
    descriptionAr:
      "من مخزوننا: تحويل بالعد — أصناف تُنقص ونواتج تدخل بالكميات نفسها (أكياس/وحدات)، بلا أي حساب من السعة",
    descriptionEn:
      "Own-stock conversion by unit count: grain out, outputs in — no capacity math, no cost allocation",
    keywords: withSynonyms(["تصنيع", "تحويل", "تصنيع ذكي", "manufacture"], SEARCH_SYNONYMS.milling),
    category: "milling",
    moduleId: "milling_operations",
    requiredRoles: STOCK_OPS,
  },
  {
    id: "milling-performance",
    path: "/milling/performance",
    titleAr: "تقرير أداء المطحنة",
    titleEn: "Milling Performance",
    descriptionAr: "تقرير شهري: إيراد أجور الطحن، الكميات المطحونة، ومصروفات القسم",
    descriptionEn:
      "Monthly milling performance: fee revenue, milled quantities, department expenses",
    keywords: withSynonyms(
      ["أداء", "تقرير", "إيراد", "مصروفات", "performance"],
      SEARCH_SYNONYMS.milling,
    ),
    category: "milling",
    moduleId: "milling_operations",
    requiredRoles: ["owner", "manager", "accountant"],
    i18nKey: "nav.milling_performance",
  },
  {
    id: "milling-statement",
    path: "/milling/customer-statement",
    titleAr: "كشف حساب الأمانات",
    titleEn: "Customer Custody Statement",
    descriptionAr: "إدارة واستعراض أمانات العملاء، الأرصدة، الطحن والتسليم السريع، ومطابقة السجلات",
    descriptionEn: "Customer custody balances, milling, fast delivery, and ledger reconciliation",
    keywords: withSynonyms(
      ["أمانات", "أمانة", "كشف", "طحن", "تسليم", "custody"],
      SEARCH_SYNONYMS.milling,
    ),
    category: "milling",
    moduleId: "milling_operations",
    requiredRoles: STOCK,
    i18nKey: "nav.milling_statement",
  },
  {
    id: "milling-guide",
    path: "/milling/operations-guide",
    titleAr: "دليل تشغيل المطحنة",
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
    titleAr: "المكونات",
    titleEn: "Components",
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
    titleAr: "كل الإعدادات",
    titleEn: "All Settings",
    descriptionAr: "نظرة شاملة على كل إعدادات النظام",
    descriptionEn: "Every system setting in one place",
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
    id: "company-settings",
    path: "/settings?section=company",
    titleAr: "بيانات المنشأة",
    titleEn: "Business Profile",
    descriptionAr: "اسم المنشأة والشعار وأرقام التواصل",
    descriptionEn: "Business name, logo & contacts",
    keywords: ["شركة", "منشأة", "شعار", "تواصل", "company", "profile"],
    category: "settings",
    moduleId: "core",
    requiredRoles: ["owner", "manager"],
    i18nKey: "nav.settings_company",
  },
  {
    id: "invoicing-settings",
    path: "/settings?section=invoicing",
    titleAr: "الفواتير والعملة",
    titleEn: "Invoices & Currency",
    descriptionAr: "العملة والضريبة وترتيب أرقام المستندات",
    descriptionEn: "Currency, tax & document numbering",
    keywords: withSynonyms(["عملة", "ضريبة", "ترقيم"], SEARCH_SYNONYMS.settings),
    category: "settings",
    moduleId: "core",
    requiredRoles: ["owner", "manager"],
    i18nKey: "nav.settings_billing",
  },
  {
    id: "printing-settings",
    path: "/settings?section=printing",
    titleAr: "الطباعة وقوالب الفواتير",
    titleEn: "Printing & Invoice Templates",
    descriptionAr: "شكل الفاتورة والورق والطباعة الحرارية",
    descriptionEn: "Invoice template, paper & thermal printing",
    keywords: withSynonyms(["قالب", "قوالب", "حراري", "نسخ", "ورق"], SEARCH_SYNONYMS.printing),
    category: "settings",
    moduleId: "core",
    requiredRoles: ["owner", "manager"],
    i18nKey: "nav.settings_printing",
  },
  {
    id: "payment-methods-settings",
    path: "/settings?section=payment-methods",
    titleAr: "طرق الدفع",
    titleEn: "Payment Methods",
    descriptionAr: "اختر الطرق التي تستخدمها ورتّبها وحدّد أماكن ظهورها",
    descriptionEn: "Choose, order and scope the payment methods you use",
    keywords: ["دفع", "طرق الدفع", "نقد", "آجل", "payment", "methods"],
    category: "settings",
    moduleId: "core",
    requiredRoles: ["owner", "manager"],
    i18nKey: "nav.settings_payment_methods",
  },
  {
    id: "stock-settings",
    path: "/settings?section=stock-settings",
    titleAr: "المخزون والرموز",
    titleEn: "Stock & Codes",
    descriptionAr: "رموز الأصناف وقواعد الترقيم والتنبيهات المخزنية",
    descriptionEn: "Item codes, numbering rules & stock alerts",
    keywords: ["مخزون", "رموز", "SKU", "تنبيهات", "stock", "codes"],
    category: "settings",
    moduleId: "core",
    requiredRoles: ["owner", "manager"],
    i18nKey: "nav.settings_stock",
  },
  {
    id: "number-format-settings",
    path: "/settings?section=number-format",
    titleAr: "نظام الأرقام",
    titleEn: "Numbering System",
    descriptionAr: "شكل الأرقام المستخدم في كل الشاشات",
    descriptionEn: "The digit style used across the system",
    keywords: ["أرقام", "ارقام", "هندية", "number", "format"],
    category: "settings",
    requiredRoles: ["owner", "manager", "accountant", "cashier", "warehouse"],
    i18nKey: "nav.settings_numbers",
  },
  {
    id: "subscription-settings",
    path: "/settings?section=subscription",
    titleAr: "الباقة والاشتراك",
    titleEn: "Plan & Subscription",
    descriptionAr: "استهلاك الموارد وحدود الباقة",
    descriptionEn: "Resource usage & plan limits",
    keywords: ["باقة", "اشتراك", "حدود", "plan", "subscription"],
    category: "settings",
    moduleId: "core",
    requiredRoles: ["owner"],
    i18nKey: "nav.settings_plan",
  },
  {
    id: "milling-mode-settings",
    path: "/settings?section=milling-mode",
    titleAr: "نمط تشغيل المطحنة",
    titleEn: "Milling Mode",
    descriptionAr: "منشأة عادية أو مطحنة بالخطة المبسطة",
    descriptionEn: "General store or simplified mill",
    keywords: ["مطحنة", "نمط", "milling", "mode"],
    category: "settings",
    moduleId: "core",
    requiredRoles: ["owner"],
    i18nKey: "nav.settings_milling",
  },
  {
    id: "appearance-settings",
    path: "/settings?section=appearance",
    titleAr: "المظهر واللغة",
    titleEn: "Appearance & Language",
    descriptionAr: "لغة الواجهة واتجاه العرض",
    descriptionEn: "Interface language & layout direction",
    keywords: ["مظهر", "لغة", "سمة", "appearance", "language", "theme"],
    category: "settings",
    requiredRoles: ["owner", "manager", "accountant", "cashier", "warehouse"],
    i18nKey: "nav.settings_appearance",
  },
  {
    id: "catalog-settings",
    path: "/settings?section=catalog",
    titleAr: "تخصيص النشاط",
    titleEn: "Business Profile & Modules",
    descriptionAr: "نمط المتجر والموديولات المفعّلة",
    descriptionEn: "Store industry profile & active modules",
    keywords: ["نشاط", "متجر", "موديولات", "catalog", "modules"],
    category: "settings",
    moduleId: "core",
    requiredRoles: ["owner", "manager"],
    i18nKey: "nav.settings_activity",
  },
  {
    id: "sidebar-navigation-settings",
    path: "/settings?section=sidebar-navigation",
    titleAr: "تخصيص القائمة الجانبية",
    titleEn: "Sidebar Navigation",
    descriptionAr: "طريقة عرض التنقل وشكل الأيقونات وألوانها",
    descriptionEn: "Navigation views, icon shapes, and sidebar group colors",
    keywords: ["قائمة جانبية", "تنقل", "أيقونات", "ألوان", "sidebar", "navigation", "icons"],
    category: "settings",
    requiredRoles: ["owner", "manager", "accountant", "cashier", "warehouse"],
    i18nKey: "nav.settings_sidebar",
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
    i18nKey: "nav.settings_backup",
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
  { category: "reports", titleKey: "nav.section.reports" },
  { category: "statements", titleKey: "nav.section.statements" },
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
  "milling",
  "milling-milling",
  "milling-delivery",
  /**
   * ملاحظة: `settings` نفسه **لا** يُخفى. شاشات الإعدادات الفرعية كانت
   * مخفية كلها، فيُطوى قسم «النظام والإعدادات» على رابط عام واحد ويضطر
   * المستخدم لفتح /settings ثم البحث عن القسم داخلها. الآن صارت روابط
   * حقيقية تحته (§4.1 بند 3)، ويبقى الرابط الجامع نفسه لفتح الواجهة
   * الرئيسية للقسم.
   */
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
  const visible = getVisibleRoutes(filters).filter(
    (entry) => !SIDEBAR_HIDDEN_IDS.has(entry.id) && !entry.sidebarParentId,
  );
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

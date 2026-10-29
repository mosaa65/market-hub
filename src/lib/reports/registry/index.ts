/**
 * Vortex ERP — سجل تعريفات التقارير المركزي (Central Report Registry)
 * المرحلة 3: REP-015
 *
 * يحتوي على السجل المركزي لتعريفات التقارير التجارية،
 * ويبدأ بتسجيل التقريرين التجريبيين (Pilot):
 * 1. rep-sales-product (تقرير المبيعات حسب المنتج - نمط ترتيبي/تجميعي)
 * 2. rep-inventory-item-card (كشف حركة صنف مخزني - نمط كشف حركة مع رصيد لحظي)
 */

import type { ReportDefinition, ReportDomain } from "../types";
import { COMMON_REPORT_FILTERS } from "./filter-registry";

export const REPORT_SALES_PRODUCT: ReportDefinition = {
  id: "rep-sales-product",
  domain: "sales",
  viewTemplate: "grouped_ranking",
  titleAr: "تقرير المبيعات حسب المنتج",
  titleEn: "Sales by Product Report",
  descriptionAr: "تحليل مبيعات الأصناف والكميات المباعة وهوامش الربحية ونسب المساهمة التجارية.",
  dataProviderId: "dp-sales-register",
  dataSourceName: "sales_register",
  rowGrainAr: "مبيعات منتج مجمعة خلال الفترة",
  defaultSortField: "net_sales",
  defaultSortOrder: "desc",

  filters: [
    COMMON_REPORT_FILTERS.dateRange,
    COMMON_REPORT_FILTERS.customer,
    COMMON_REPORT_FILTERS.product,
    COMMON_REPORT_FILTERS.paymentMethod,
    COMMON_REPORT_FILTERS.search,
  ],

  columns: [
    {
      key: "sku",
      labelAr: "رمز الصنف (SKU)",
      labelEn: "SKU",
      dataType: "code",
      essential: true,
      defaultVisible: true,
      align: "right",
    },
    {
      key: "item_name_ar",
      labelAr: "اسم الصنف",
      labelEn: "Item Name",
      dataType: "text",
      essential: true,
      defaultVisible: true,
      align: "right",
    },
    {
      key: "quantity",
      labelAr: "الكمية بوحدة الأساس",
      labelEn: "Quantity in Base Unit",
      dataType: "quantity",
      defaultVisible: true,
      align: "left",
    },
    {
      key: "base_uom_name_ar",
      labelAr: "وحدة الأساس",
      labelEn: "Base Unit",
      dataType: "text",
      defaultVisible: true,
      align: "right",
    },
    {
      key: "gross_sales",
      labelAr: "إجمالي المبيعات",
      labelEn: "Gross Sales",
      dataType: "money",
      defaultVisible: true,
      align: "left",
      aggregate: "sum",
    },
    {
      key: "discounts",
      labelAr: "الخصومات",
      labelEn: "Discounts",
      dataType: "money",
      defaultVisible: true,
      align: "left",
      aggregate: "sum",
    },
    {
      key: "net_sales",
      labelAr: "صافي المبيعات",
      labelEn: "Net Sales",
      dataType: "money",
      essential: true,
      defaultVisible: true,
      align: "left",
      aggregate: "sum",
    },
    {
      key: "total_cost",
      labelAr: "تكلفة البضاعة المباعة",
      labelEn: "COGS",
      dataType: "money",
      defaultVisible: true,
      align: "left",
      aggregate: "sum",
    },
    {
      key: "gross_margin",
      labelAr: "هامش الربح",
      labelEn: "Gross Margin",
      dataType: "money",
      defaultVisible: true,
      align: "left",
      aggregate: "sum",
    },
    {
      key: "margin_percentage",
      labelAr: "نسبة الهامش",
      labelEn: "Margin %",
      dataType: "percentage",
      defaultVisible: true,
      align: "left",
      unit: "%",
    },
  ],

  metrics: [
    {
      key: "grossSales",
      labelAr: "إجمالي المبيعات الخام",
      labelEn: "Gross Sales",
      format: "money",
      calculationRuleAr: "الكمية × سعر البيع قبل الخصم",
    },
    {
      key: "itemDiscounts",
      labelAr: "إجمالي الخصومات",
      labelEn: "Total Discounts",
      format: "money",
      calculationRuleAr: "مجموع خصومات البنود",
    },
    {
      key: "netSales",
      labelAr: "صافي المبيعات",
      labelEn: "Net Sales",
      format: "money",
      calculationRuleAr: "إجمالي المبيعات - الخصومات الممنوحة",
    },
    {
      key: "totalCost",
      labelAr: "إجمالي تكلفة المبيعات",
      labelEn: "Total COGS",
      format: "money",
      calculationRuleAr: "مجموع تكلفة البنود من sales_register.line_cost",
    },
    {
      key: "grossMargin",
      labelAr: "هامش المساهمة الإجمالي",
      labelEn: "Gross Margin",
      format: "money",
      calculationRuleAr: "صافي المبيعات - تكلفة المبيعات",
    },
    {
      key: "marginPercentage",
      labelAr: "متوسط نسبة الهامش",
      labelEn: "Margin %",
      format: "percentage",
      calculationRuleAr: "(هامش المساهمة / صافي المبيعات) × 100",
    },
  ],

  exportCapabilities: {
    pdfTemplate: "summary",
    excelMultiSheet: true,
    csvSupported: true,
    directPrintSlip: false,
  },
};

export const REPORT_SALES_CUSTOMER: ReportDefinition = {
  id: "rep-sales-customer",
  domain: "sales",
  viewTemplate: "grouped_ranking",
  titleAr: "تقرير المبيعات حسب العميل",
  titleEn: "Sales by Customer Report",
  descriptionAr: "تحليل مبيعات ومتحصلات العملاء وحجم الفواتير والربحية لكل عميل.",
  dataProviderId: "dp-sales-register",
  dataSourceName: "sales_register",
  rowGrainAr: "مبيعات عميل مجمعة خلال الفترة",
  defaultSortField: "net_sales",
  defaultSortOrder: "desc",

  filters: [
    COMMON_REPORT_FILTERS.dateRange,
    COMMON_REPORT_FILTERS.customer,
    COMMON_REPORT_FILTERS.paymentMethod,
    COMMON_REPORT_FILTERS.search,
  ],

  columns: [
    {
      key: "customer_name",
      labelAr: "اسم العميل",
      labelEn: "Customer Name",
      dataType: "text",
      essential: true,
      defaultVisible: true,
      align: "right",
    },
    {
      key: "invoice_count",
      labelAr: "عدد الفواتير",
      labelEn: "Invoices",
      dataType: "quantity",
      defaultVisible: true,
      align: "left",
      aggregate: "sum",
    },
    {
      key: "net_sales",
      labelAr: "صافي المبيعات",
      labelEn: "Net Sales",
      dataType: "money",
      essential: true,
      defaultVisible: true,
      align: "left",
      aggregate: "sum",
    },
  ],

  metrics: [
    {
      key: "totalRowCount",
      labelAr: "إجمالي العملاء",
      labelEn: "Customers Count",
      format: "integer",
      calculationRuleAr: "عدد العملاء الذين تمت لهم عمليات بيع",
    },
    {
      key: "netSales",
      labelAr: "صافي المبيعات",
      labelEn: "Net Sales",
      format: "money",
      calculationRuleAr: "صافي مبيعات العملاء",
    },
  ],

  exportCapabilities: {
    pdfTemplate: "summary",
    excelMultiSheet: true,
    csvSupported: true,
    directPrintSlip: false,
  },
};

export const REPORT_SALES_BRANCH: ReportDefinition = {
  id: "rep-sales-branch",
  domain: "sales",
  viewTemplate: "grouped_ranking",
  titleAr: "تقرير المبيعات حسب الفرع",
  titleEn: "Sales by Branch Report",
  descriptionAr: "تحليل مبيعات الفروع ومساهمة كل فرع في الإيرادات والأرباح التشغيلية.",
  dataProviderId: "dp-sales-register",
  dataSourceName: "sales_register",
  rowGrainAr: "مبيعات فرع مجمعة خلال الفترة",
  defaultSortField: "net_sales",
  defaultSortOrder: "desc",

  filters: [
    COMMON_REPORT_FILTERS.dateRange,
    COMMON_REPORT_FILTERS.paymentMethod,
    COMMON_REPORT_FILTERS.search,
  ],

  columns: [
    {
      key: "branch_name",
      labelAr: "الفرع",
      labelEn: "Branch",
      dataType: "text",
      essential: true,
      defaultVisible: true,
      align: "right",
    },
    {
      key: "invoice_count",
      labelAr: "عدد العمليات",
      labelEn: "Operations",
      dataType: "quantity",
      defaultVisible: true,
      align: "left",
      aggregate: "sum",
    },
    {
      key: "gross_sales",
      labelAr: "إجمالي المبيعات",
      labelEn: "Gross Sales",
      dataType: "money",
      defaultVisible: true,
      align: "left",
      aggregate: "sum",
    },
    {
      key: "net_sales",
      labelAr: "صافي المبيعات",
      labelEn: "Net Sales",
      dataType: "money",
      essential: true,
      defaultVisible: true,
      align: "left",
      aggregate: "sum",
    },
    {
      key: "gross_margin",
      labelAr: "هامش الربح",
      labelEn: "Gross Margin",
      dataType: "money",
      defaultVisible: true,
      align: "left",
      aggregate: "sum",
    },
  ],

  metrics: [
    {
      key: "totalRowCount",
      labelAr: "عدد الفروع النشطة",
      labelEn: "Branches",
      format: "integer",
      calculationRuleAr: "عدد الفروع المسجلة للعمليات",
    },
    {
      key: "netSales",
      labelAr: "صافي مبيعات الفروع",
      labelEn: "Net Sales",
      format: "money",
      calculationRuleAr: "إجمالي المبيعات المنفذة عبر الفروع",
    },
  ],

  exportCapabilities: {
    pdfTemplate: "summary",
    excelMultiSheet: true,
    csvSupported: true,
    directPrintSlip: false,
  },
};

export const REPORT_SALES_WAREHOUSE: ReportDefinition = {
  id: "rep-sales-warehouse",
  domain: "sales",
  viewTemplate: "grouped_ranking",
  titleAr: "تقرير المبيعات حسب المستودع",
  titleEn: "Sales by Warehouse Report",
  descriptionAr: "تحليل حركة مبيعات الأصناف والكميات المنصرفة من كل مستودع.",
  dataProviderId: "dp-sales-register",
  dataSourceName: "sales_register",
  rowGrainAr: "مبيعات مستودع مجمعة خلال الفترة",
  defaultSortField: "net_sales",
  defaultSortOrder: "desc",

  filters: [
    COMMON_REPORT_FILTERS.dateRange,
    COMMON_REPORT_FILTERS.warehouse,
    COMMON_REPORT_FILTERS.paymentMethod,
    COMMON_REPORT_FILTERS.search,
  ],

  columns: [
    {
      key: "warehouse_name",
      labelAr: "المستودع",
      labelEn: "Warehouse",
      dataType: "text",
      essential: true,
      defaultVisible: true,
      align: "right",
    },
    {
      key: "invoice_count",
      labelAr: "عدد الفواتير",
      labelEn: "Invoices",
      dataType: "quantity",
      defaultVisible: true,
      align: "left",
      aggregate: "sum",
    },
    {
      key: "net_sales",
      labelAr: "صافي المبيعات",
      labelEn: "Net Sales",
      dataType: "money",
      essential: true,
      defaultVisible: true,
      align: "left",
      aggregate: "sum",
    },
  ],

  metrics: [
    {
      key: "totalRowCount",
      labelAr: "عدد المستودعات",
      labelEn: "Warehouses",
      format: "integer",
      calculationRuleAr: "عدد المستودعات المنصرف منها بضائع",
    },
    {
      key: "netSales",
      labelAr: "صافي مبيعات المستودعات",
      labelEn: "Net Sales",
      format: "money",
      calculationRuleAr: "إجمالي صافي مبيعات المستودعات",
    },
  ],

  exportCapabilities: {
    pdfTemplate: "summary",
    excelMultiSheet: true,
    csvSupported: true,
    directPrintSlip: false,
  },
};

export const REPORT_INVENTORY_ITEM_CARD: ReportDefinition = {
  id: "rep-inventory-item-card",
  domain: "inventory",
  viewTemplate: "movement_statement",
  titleAr: "كشف حركة صنف مخزني (بطاقة الصنف)",
  titleEn: "Item Movement Card",
  descriptionAr: "كشف حركة تفصيلي يوضح الحركات الواردة والمنصرفة مع الرصيد اللحظي المتسلسل.",
  dataProviderId: "dp-inventory-movements",
  dataSourceName: "stock_movements",
  rowGrainAr: "حركة مخزنية واردة أو منصرفة مع رصيد متسلسل",
  defaultSortField: "created_at",
  defaultSortOrder: "asc",

  filters: [
    COMMON_REPORT_FILTERS.dateRange,
    {
      ...COMMON_REPORT_FILTERS.product,
      required: true, // بطاقة الصنف تتطلب اختيار الصنف
    },
    COMMON_REPORT_FILTERS.warehouse,
  ],

  columns: [
    {
      key: "created_at",
      labelAr: "التاريخ والوقت",
      labelEn: "Date & Time",
      dataType: "datetime",
      essential: true,
      defaultVisible: true,
      align: "right",
    },
    {
      key: "movement_type",
      labelAr: "نوع الحركة",
      labelEn: "Movement Type",
      dataType: "status_badge",
      essential: true,
      defaultVisible: true,
      align: "center",
    },
    {
      key: "reference",
      labelAr: "المرجع / السند",
      labelEn: "Reference",
      dataType: "code",
      defaultVisible: true,
      align: "right",
    },
    {
      key: "warehouse_name",
      labelAr: "المستودع",
      labelEn: "Warehouse",
      dataType: "text",
      defaultVisible: true,
      align: "right",
    },
    {
      key: "base_uom_name_ar",
      labelAr: "وحدة الأساس",
      labelEn: "Base Unit",
      dataType: "text",
      defaultVisible: true,
      align: "right",
    },
    {
      key: "inbound_quantity",
      labelAr: "وارد (+) بوحدة الأساس",
      labelEn: "Inbound (+)",
      dataType: "quantity",
      defaultVisible: true,
      align: "left",
      aggregate: "sum",
    },
    {
      key: "outbound_quantity",
      labelAr: "صادر (-) بوحدة الأساس",
      labelEn: "Outbound (-)",
      dataType: "quantity",
      defaultVisible: true,
      align: "left",
      aggregate: "sum",
    },
    {
      key: "running_balance",
      labelAr: "الرصيد اللحظي بوحدة الأساس",
      labelEn: "Running Balance",
      dataType: "quantity",
      essential: true,
      defaultVisible: true,
      align: "left",
    },
    {
      key: "note",
      labelAr: "ملاحظات",
      labelEn: "Notes",
      dataType: "text",
      defaultVisible: false,
      align: "right",
    },
  ],

  metrics: [
    {
      key: "openingBalance",
      labelAr: "الرصيد الافتتاحي بوحدة الأساس",
      labelEn: "Opening Balance",
      format: "quantity",
      calculationRuleAr: "رصيد الحركات السابقة لتاريخ البداية",
    },
    {
      key: "totalInbound",
      labelAr: "إجمالي الوارد بوحدة الأساس",
      labelEn: "Total Inbound",
      format: "quantity",
      calculationRuleAr: "مجموع الحركات التي تزيد المخزون خلال الفترة",
    },
    {
      key: "totalOutbound",
      labelAr: "إجمالي الصادر بوحدة الأساس",
      labelEn: "Total Outbound",
      format: "quantity",
      calculationRuleAr: "مجموع الحركات التي تنقص المخزون خلال الفترة",
    },
    {
      key: "closingBalance",
      labelAr: "الرصيد الختامي بوحدة الأساس",
      labelEn: "Closing Balance",
      format: "quantity",
      calculationRuleAr: "الافتتاحي + إجمالي الوارد - إجمالي الصادر",
    },
  ],

  exportCapabilities: {
    pdfTemplate: "movement",
    excelMultiSheet: false,
    csvSupported: true,
    directPrintSlip: true,
  },
};

/** أصناف نفدت أو وصلت إلى رصيد صفري؛ الفحص والتنقيح يتمان داخل الخادم. */
export const REPORT_INVENTORY_LOW_STOCK: ReportDefinition = {
  id: "rep-inventory-low-stock",
  domain: "inventory",
  viewTemplate: "status_exceptions",
  titleAr: "الأصناف المنتهية والمنخفضة",
  titleEn: "Low & Out-of-Stock Items",
  descriptionAr: "يعرض الأصناف ذات الرصيد الصفري أو السالب التي تحتاج إلى إجراء مخزني.",
  dataProviderId: "dp-inventory-valuation",
  dataSourceName: "inventory_valuation",
  rowGrainAr: "رصيد صنف في مستودع",
  defaultSortField: "quantity",
  defaultSortOrder: "asc",
  filters: [COMMON_REPORT_FILTERS.warehouse, COMMON_REPORT_FILTERS.search],
  columns: [
    {
      key: "sku",
      labelAr: "رمز الصنف",
      labelEn: "SKU",
      dataType: "code",
      essential: true,
      defaultVisible: true,
    },
    {
      key: "item_name_ar",
      labelAr: "الصنف",
      labelEn: "Item",
      dataType: "text",
      essential: true,
      defaultVisible: true,
    },
    {
      key: "warehouse_name",
      labelAr: "المستودع",
      labelEn: "Warehouse",
      dataType: "text",
      defaultVisible: true,
    },
    {
      key: "quantity",
      labelAr: "الرصيد الحالي بوحدة الأساس",
      labelEn: "On Hand",
      dataType: "quantity",
      essential: true,
      defaultVisible: true,
    },
    {
      key: "base_uom_name_ar",
      labelAr: "وحدة الأساس",
      labelEn: "Base Unit",
      dataType: "text",
      defaultVisible: true,
    },
    {
      key: "min_stock",
      labelAr: "حد التنبيه الأدنى",
      labelEn: "Minimum Alert Level",
      dataType: "quantity",
      defaultVisible: true,
    },
    {
      key: "reference_valuation",
      labelAr: "القيمة المرجعية",
      labelEn: "Reference Value",
      dataType: "money",
      defaultVisible: true,
      aggregate: "sum",
    },
  ],
  metrics: [
    {
      key: "exceptionCount",
      labelAr: "عدد الأصناف المتأثرة",
      labelEn: "Affected Items",
      format: "integer",
      calculationRuleAr: "عدد الأرصدة التي لا تتجاوز حد التنبيه الأدنى",
    },
    {
      key: "totalValue",
      labelAr: "القيمة المرجعية",
      labelEn: "Reference Value",
      format: "money",
      calculationRuleAr: "مجموع القيمة المرجعية للأصناف المعروضة",
    },
  ],
  exceptionSource: "inventory_low_stock",
  exportCapabilities: {
    pdfTemplate: "detailed",
    excelMultiSheet: true,
    csvSupported: true,
    directPrintSlip: false,
  },
};

/** أصناف لها رصيد قائم دون حركة صرف ضمن الفترة المختارة. */
export const REPORT_INVENTORY_SLOW_MOVING: ReportDefinition = {
  id: "rep-inventory-slow-moving",
  domain: "inventory",
  viewTemplate: "status_exceptions",
  titleAr: "الأصناف الراكدة",
  titleEn: "Slow-Moving Inventory",
  descriptionAr: "يرصد الأصناف ذات الرصيد القائم التي لم تسجل حركة صرف خلال الفترة المختارة.",
  dataProviderId: "dp-inventory-valuation",
  dataSourceName: "inventory_valuation",
  rowGrainAr: "رصيد صنف راكد",
  defaultSortField: "reference_valuation",
  defaultSortOrder: "desc",
  filters: [COMMON_REPORT_FILTERS.dateRange, COMMON_REPORT_FILTERS.search],
  columns: [
    {
      key: "sku",
      labelAr: "رمز الصنف",
      labelEn: "SKU",
      dataType: "code",
      essential: true,
      defaultVisible: true,
    },
    {
      key: "item_name_ar",
      labelAr: "الصنف",
      labelEn: "Item",
      dataType: "text",
      essential: true,
      defaultVisible: true,
    },
    {
      key: "warehouse_name",
      labelAr: "المستودع",
      labelEn: "Warehouse",
      dataType: "text",
      defaultVisible: true,
    },
    {
      key: "quantity",
      labelAr: "الرصيد بوحدة الأساس",
      labelEn: "On Hand",
      dataType: "quantity",
      defaultVisible: true,
    },
    {
      key: "base_uom_name_ar",
      labelAr: "وحدة الأساس",
      labelEn: "Base Unit",
      dataType: "text",
      defaultVisible: true,
    },
    {
      key: "reference_valuation",
      labelAr: "قيمة الرصيد",
      labelEn: "Stock Value",
      dataType: "money",
      essential: true,
      defaultVisible: true,
      aggregate: "sum",
    },
  ],
  metrics: [
    {
      key: "exceptionCount",
      labelAr: "الأصناف الراكدة",
      labelEn: "Slow Items",
      format: "integer",
      calculationRuleAr: "عدد الأصناف دون حركة صرف ضمن الفترة",
    },
    {
      key: "totalValue",
      labelAr: "قيمة المخزون الراكد",
      labelEn: "Slow Stock Value",
      format: "money",
      calculationRuleAr: "مجموع القيم المرجعية للأصناف الراكدة",
    },
  ],
  exceptionSource: "inventory_slow_moving",
  exportCapabilities: {
    pdfTemplate: "detailed",
    excelMultiSheet: true,
    csvSupported: true,
    directPrintSlip: false,
  },
};

/** فجوات تصنيف المنتجات وسياسة المخزون، من عرض الخادم المخصص. */
export const REPORT_ITEM_CLASSIFICATION_GAPS: ReportDefinition = {
  id: "rep-item-classification-gaps",
  domain: "operations_audit",
  viewTemplate: "status_exceptions",
  titleAr: "فجوات تصنيف المنتجات",
  titleEn: "Item Classification Gaps",
  descriptionAr:
    "يكشف المنتجات التي تحتاج استكمال التصنيف أو سياسة المخزون قبل أن تؤثر في التقارير.",
  dataProviderId: "dp-item-classification-gaps",
  dataSourceName: "item_classification_gaps",
  rowGrainAr: "منتج به فجوة تصنيف",
  defaultSortField: "sku",
  defaultSortOrder: "asc",
  filters: [],
  columns: [
    {
      key: "sku",
      labelAr: "رمز الصنف",
      labelEn: "SKU",
      dataType: "code",
      essential: true,
      defaultVisible: true,
    },
    {
      key: "name_ar",
      labelAr: "اسم الصنف",
      labelEn: "Item",
      dataType: "text",
      essential: true,
      defaultVisible: true,
    },
    {
      key: "item_nature",
      labelAr: "طبيعة الصنف",
      labelEn: "Item Nature",
      dataType: "text",
      defaultVisible: true,
    },
    {
      key: "item_class",
      labelAr: "التصنيف",
      labelEn: "Classification",
      dataType: "text",
      defaultVisible: true,
    },
    {
      key: "inventory_policy",
      labelAr: "سياسة المخزون",
      labelEn: "Inventory Policy",
      dataType: "text",
      defaultVisible: true,
    },
    {
      key: "reason",
      labelAr: "سبب المراجعة",
      labelEn: "Reason",
      dataType: "text",
      essential: true,
      defaultVisible: true,
    },
  ],
  metrics: [
    {
      key: "gapCount",
      labelAr: "فجوات تحتاج استكمالاً",
      labelEn: "Open Gaps",
      format: "integer",
      calculationRuleAr: "عدد المنتجات ذات الفجوات المسجلة في العرض",
    },
  ],
  exceptionSource: "item_classification_gaps",
  exportCapabilities: {
    pdfTemplate: "detailed",
    excelMultiSheet: true,
    csvSupported: true,
    directPrintSlip: false,
  },
};

/** ملخص تشغيلي يومي يستفيد من قالب الملخص ومصدر سجل المبيعات القائم. */
export const REPORT_SALES_DAILY_SUMMARY: ReportDefinition = {
  id: "rep-sales-daily-summary",
  domain: "sales",
  viewTemplate: "summary",
  titleAr: "الملخص اليومي للمبيعات",
  titleEn: "Daily Sales Summary",
  descriptionAr: "ملخص مؤشرات المبيعات اليومية مع سجل مختصر للفواتير والبنود المنفذة.",
  dataProviderId: "dp-sales-register",
  dataSourceName: "sales_register",
  rowGrainAr: "بند مبيعات ضمن الفترة المحددة",
  defaultSortField: "created_at",
  defaultSortOrder: "desc",
  filters: [
    COMMON_REPORT_FILTERS.dateRange,
    COMMON_REPORT_FILTERS.paymentMethod,
    COMMON_REPORT_FILTERS.search,
  ],
  columns: [
    {
      key: "invoice_number",
      labelAr: "رقم الفاتورة",
      labelEn: "Invoice",
      dataType: "code",
      essential: true,
      defaultVisible: true,
      align: "right",
    },
    {
      key: "created_at",
      labelAr: "وقت التنفيذ",
      labelEn: "Created At",
      dataType: "datetime",
      essential: true,
      defaultVisible: true,
      align: "right",
    },
    {
      key: "payment_method",
      labelAr: "طريقة الدفع",
      labelEn: "Payment Method",
      dataType: "text",
      defaultVisible: true,
      align: "center",
    },
    {
      key: "entered_quantity",
      labelAr: "كمية الفاتورة",
      labelEn: "Invoice Quantity",
      dataType: "quantity",
      defaultVisible: true,
      align: "left",
    },
    {
      key: "uom_name_ar",
      labelAr: "الوحدة",
      labelEn: "Unit",
      dataType: "text",
      defaultVisible: true,
      align: "right",
    },
    {
      key: "entered_unit_price",
      labelAr: "سعر وحدة الفاتورة",
      labelEn: "Invoice Unit Price",
      dataType: "money",
      defaultVisible: true,
      align: "left",
    },
    {
      key: "total",
      labelAr: "صافي البند",
      labelEn: "Net Line Total",
      dataType: "money",
      essential: true,
      defaultVisible: true,
      align: "left",
      aggregate: "sum",
    },
  ],
  metrics: [
    {
      key: "totalRowCount",
      labelAr: "عدد البنود",
      labelEn: "Line Count",
      format: "integer",
      calculationRuleAr: "عدد بنود المبيعات المطابقة للفلاتر",
    },
    {
      key: "netSales",
      labelAr: "صافي المبيعات",
      labelEn: "Net Sales",
      format: "money",
      calculationRuleAr: "مجموع صافي بنود المبيعات",
    },
    {
      key: "grossMargin",
      labelAr: "هامش الربح",
      labelEn: "Gross Margin",
      format: "money",
      calculationRuleAr: "صافي المبيعات ناقص تكلفة البنود",
    },
  ],
  exportCapabilities: {
    pdfTemplate: "summary",
    excelMultiSheet: true,
    csvSupported: true,
    directPrintSlip: true,
  },
};

/** مقارنة المبيعات مع الفترة السابقة؛ كل الحسابات تتم في دالة الخادم. */
export const REPORT_SALES_PERIOD_COMPARISON: ReportDefinition = {
  id: "rep-sales-period-comparison",
  domain: "sales",
  viewTemplate: "comparison",
  titleAr: "مقارنة أداء المبيعات بالفترة السابقة",
  titleEn: "Sales Period Comparison",
  descriptionAr: "يقارن صافي المبيعات للفترة المحددة بالفترة السابقة المتساوية زمنيًا.",
  dataProviderId: "dp-sales-register",
  dataSourceName: "sales_register",
  rowGrainAr: "بند مبيعات في الفترة الحالية",
  defaultSortField: "created_at",
  defaultSortOrder: "desc",
  filters: [
    COMMON_REPORT_FILTERS.dateRange,
    COMMON_REPORT_FILTERS.customer,
    COMMON_REPORT_FILTERS.product,
    COMMON_REPORT_FILTERS.paymentMethod,
  ],
  columns: [
    {
      key: "invoice_number",
      labelAr: "رقم الفاتورة",
      labelEn: "Invoice",
      dataType: "code",
      essential: true,
      defaultVisible: true,
      align: "right",
    },
    {
      key: "created_at",
      labelAr: "تاريخ العملية",
      labelEn: "Date",
      dataType: "datetime",
      defaultVisible: true,
      align: "right",
    },
    {
      key: "item_name_ar",
      labelAr: "الصنف",
      labelEn: "Item",
      dataType: "text",
      defaultVisible: true,
      align: "right",
    },
    {
      key: "entered_quantity",
      labelAr: "كمية الفاتورة",
      labelEn: "Invoice Quantity",
      dataType: "quantity",
      defaultVisible: true,
      align: "left",
    },
    {
      key: "uom_name_ar",
      labelAr: "الوحدة",
      labelEn: "Unit",
      dataType: "text",
      defaultVisible: true,
      align: "right",
    },
    {
      key: "entered_unit_price",
      labelAr: "سعر وحدة الفاتورة",
      labelEn: "Invoice Unit Price",
      dataType: "money",
      defaultVisible: true,
      align: "left",
    },
    {
      key: "total",
      labelAr: "صافي البند",
      labelEn: "Net Total",
      dataType: "money",
      essential: true,
      defaultVisible: true,
      align: "left",
      aggregate: "sum",
    },
  ],
  metrics: [
    {
      key: "netSales",
      labelAr: "صافي المبيعات الحالية",
      labelEn: "Current Net Sales",
      format: "money",
      calculationRuleAr: "صافي مبيعات الفترة المختارة",
    },
    {
      key: "grossMargin",
      labelAr: "هامش الربح الحالي",
      labelEn: "Current Gross Margin",
      format: "money",
      calculationRuleAr: "صافي المبيعات ناقص تكلفة البنود",
    },
  ],
  comparison: {
    metricKey: "netSales",
    metricLabelAr: "صافي المبيعات",
    metricFormat: "money",
    comparisonMode: "previous_period",
  },
  exportCapabilities: {
    pdfTemplate: "summary",
    excelMultiSheet: true,
    csvSupported: true,
    directPrintSlip: false,
  },
};

/** الحالات التي تستلزم مراجعة تشغيلية: الملغاة والمرتجعة والمسودات. */
export const REPORT_OPERATIONS_EXCEPTIONS: ReportDefinition = {
  id: "rep-operations-exceptions",
  domain: "operations_audit",
  viewTemplate: "status_exceptions",
  titleAr: "استثناءات المبيعات والعمليات",
  titleEn: "Sales & Operations Exceptions",
  descriptionAr: "يعرض السندات الملغاة والمرتجعة والمسودات التي تحتاج مراجعة تشغيلية.",
  dataProviderId: "dp-sales-register",
  dataSourceName: "sales_register",
  rowGrainAr: "بند عملية استثنائية",
  defaultSortField: "created_at",
  defaultSortOrder: "desc",
  filters: [
    COMMON_REPORT_FILTERS.dateRange,
    COMMON_REPORT_FILTERS.customer,
    COMMON_REPORT_FILTERS.search,
  ],
  columns: [
    {
      key: "invoice_number",
      labelAr: "رقم السند",
      labelEn: "Document Number",
      dataType: "code",
      essential: true,
      defaultVisible: true,
      align: "right",
    },
    {
      key: "created_at",
      labelAr: "وقت العملية",
      labelEn: "Timestamp",
      dataType: "datetime",
      essential: true,
      defaultVisible: true,
      align: "right",
    },
    {
      key: "status",
      labelAr: "الحالة",
      labelEn: "Status",
      dataType: "status_badge",
      essential: true,
      defaultVisible: true,
      align: "center",
    },
    {
      key: "item_name_ar",
      labelAr: "الصنف",
      labelEn: "Item",
      dataType: "text",
      defaultVisible: true,
      align: "right",
    },
    {
      key: "total",
      labelAr: "قيمة البند",
      labelEn: "Line Value",
      dataType: "money",
      defaultVisible: true,
      align: "left",
      aggregate: "sum",
    },
  ],
  metrics: [
    {
      key: "exceptionCount",
      labelAr: "إجمالي الاستثناءات",
      labelEn: "Exceptions",
      format: "integer",
      calculationRuleAr: "عدد البنود ذات الحالات غير الاعتيادية",
    },
    {
      key: "cancelledCount",
      labelAr: "الملغاة",
      labelEn: "Cancelled",
      format: "integer",
      calculationRuleAr: "عدد البنود الملغاة المطابقة للفلاتر",
    },
    {
      key: "returnedCount",
      labelAr: "المرتجعة",
      labelEn: "Returned",
      format: "integer",
      calculationRuleAr: "عدد البنود المرتجعة المطابقة للفلاتر",
    },
    {
      key: "exceptionValue",
      labelAr: "قيمة الاستثناءات",
      labelEn: "Exception Value",
      format: "money",
      calculationRuleAr: "مجموع قيم جميع الاستثناءات المطابقة للفلاتر",
    },
  ],
  exceptionSource: "sales_register",
  exportCapabilities: {
    pdfTemplate: "detailed",
    excelMultiSheet: true,
    csvSupported: true,
    directPrintSlip: false,
  },
};

export const REPORT_PURCHASES_REGISTER: ReportDefinition = {
  id: "rep-purchases-register",
  domain: "purchases",
  viewTemplate: "detailed_table",
  titleAr: "سجل فواتير المشتريات والتوريد",
  titleEn: "Purchases Register Report",
  descriptionAr: "كشف تفصيلي بمشتريات البضائع والمدخلات مع الموردين ومقارنة الأسعار والكميات.",
  dataProviderId: "dp-purchase-register",
  dataSourceName: "purchase_register",
  rowGrainAr: "بند فاتورة شراء مؤكدة",
  defaultSortField: "created_at",
  defaultSortOrder: "desc",

  filters: [
    COMMON_REPORT_FILTERS.dateRange,
    COMMON_REPORT_FILTERS.supplier,
    COMMON_REPORT_FILTERS.product,
    COMMON_REPORT_FILTERS.search,
  ],

  columns: [
    {
      key: "invoice_number",
      labelAr: "رقم الفاتورة",
      labelEn: "Invoice No",
      dataType: "code",
      essential: true,
      defaultVisible: true,
      align: "right",
    },
    {
      key: "created_at",
      labelAr: "التاريخ",
      labelEn: "Date",
      dataType: "date",
      essential: true,
      defaultVisible: true,
      align: "right",
    },
    {
      key: "sku",
      labelAr: "رمز الصنف",
      labelEn: "SKU",
      dataType: "code",
      defaultVisible: true,
      align: "right",
    },
    {
      key: "item_name_ar",
      labelAr: "اسم الصنف",
      labelEn: "Item Name",
      dataType: "text",
      defaultVisible: true,
      align: "right",
    },
    {
      key: "entered_quantity",
      labelAr: "كمية الفاتورة",
      labelEn: "Invoice Quantity",
      dataType: "quantity",
      defaultVisible: true,
      align: "left",
    },
    {
      key: "uom_name_ar",
      labelAr: "الوحدة",
      labelEn: "Unit",
      dataType: "text",
      defaultVisible: true,
      align: "right",
    },
    {
      key: "entered_unit_cost",
      labelAr: "تكلفة وحدة الفاتورة",
      labelEn: "Invoice Unit Cost",
      dataType: "money",
      defaultVisible: true,
      align: "left",
    },
    {
      key: "quantity",
      labelAr: "كمية الأساس المخزنية",
      labelEn: "Base Stock Quantity",
      dataType: "quantity",
      defaultVisible: false,
      align: "left",
    },
    {
      key: "unit_cost",
      labelAr: "تكلفة وحدة الأساس",
      labelEn: "Base Unit Cost",
      dataType: "money",
      defaultVisible: false,
      align: "left",
    },
    {
      key: "total",
      labelAr: "إجمالي البند",
      labelEn: "Total",
      dataType: "money",
      essential: true,
      defaultVisible: true,
      align: "left",
      aggregate: "sum",
    },
  ],

  metrics: [
    {
      key: "totalRowCount",
      labelAr: "عدد البنود",
      labelEn: "Total Lines",
      format: "integer",
      calculationRuleAr: "إجمالي بنود فواتير الشراء",
    },
    {
      key: "grossPurchases",
      labelAr: "إجمالي المشتريات الخام",
      labelEn: "Gross Purchases",
      format: "money",
      calculationRuleAr: "مجموع كمية الأساس × تكلفة وحدة الأساس قبل الخصم",
    },
    {
      key: "netPurchases",
      labelAr: "صافي المشتريات",
      labelEn: "Net Purchases",
      format: "money",
      calculationRuleAr: "إجمالي المشتريات بعد الخصم",
    },
  ],

  exportCapabilities: {
    pdfTemplate: "detailed",
    excelMultiSheet: true,
    csvSupported: true,
    directPrintSlip: false,
  },
};

export const REPORT_CUSTOMERS_TURNOVER: ReportDefinition = {
  id: "rep-customers-sales-turnover",
  domain: "customers",
  viewTemplate: "grouped_ranking",
  titleAr: "كشف مبيعات ومتحصلات العملاء",
  titleEn: "Customer Sales & Collections",
  descriptionAr: "تحليل مبيعات العملاء وإجمالي المبالغ المسددة والمتبقية لكل عميل.",
  dataProviderId: "dp-sales-register",
  dataSourceName: "sales_register",
  rowGrainAr: "عميل مجمّع خلال الفترة",
  defaultSortField: "net_sales",
  defaultSortOrder: "desc",

  filters: [
    COMMON_REPORT_FILTERS.dateRange,
    COMMON_REPORT_FILTERS.customer,
    COMMON_REPORT_FILTERS.search,
  ],

  columns: [
    {
      key: "customer_name",
      labelAr: "العميل",
      labelEn: "Customer",
      dataType: "text",
      essential: true,
      defaultVisible: true,
      align: "right",
    },
    {
      key: "invoice_count",
      labelAr: "عدد الفواتير",
      labelEn: "Invoice Count",
      dataType: "quantity",
      defaultVisible: true,
      align: "left",
      aggregate: "sum",
    },
    {
      key: "net_sales",
      labelAr: "إجمالي المبيعات",
      labelEn: "Net Sales",
      dataType: "money",
      essential: true,
      defaultVisible: true,
      align: "left",
      aggregate: "sum",
    },
  ],

  metrics: [
    {
      key: "totalRowCount",
      labelAr: "عدد الحركات",
      labelEn: "Total Moves",
      format: "integer",
      calculationRuleAr: "إجمالي الحركات للعملاء",
    },
    {
      key: "netSales",
      labelAr: "إجمالي المبيعات",
      labelEn: "Total Sales",
      format: "money",
      calculationRuleAr: "صافي مبيعات العملاء",
    },
  ],

  exportCapabilities: {
    pdfTemplate: "summary",
    excelMultiSheet: true,
    csvSupported: true,
    directPrintSlip: false,
  },
};

export const REPORT_SUPPLIERS_PAYABLES: ReportDefinition = {
  id: "rep-suppliers-payables",
  domain: "suppliers",
  viewTemplate: "detailed_table",
  titleAr: "كشف مستحقات والتزامات الموردين",
  titleEn: "Supplier Payables & Invoices",
  descriptionAr: "متابعة التزامات التوريد وفواتير المشتريات المؤكدة لكل مورد.",
  dataProviderId: "dp-purchase-register",
  dataSourceName: "purchase_register",
  rowGrainAr: "فاتورة شراء وتوريد",
  defaultSortField: "created_at",
  defaultSortOrder: "desc",

  filters: [
    COMMON_REPORT_FILTERS.dateRange,
    COMMON_REPORT_FILTERS.supplier,
    COMMON_REPORT_FILTERS.search,
  ],

  columns: [
    {
      key: "invoice_number",
      labelAr: "رقم الفاتورة",
      labelEn: "Invoice No",
      dataType: "code",
      essential: true,
      defaultVisible: true,
      align: "right",
    },
    {
      key: "created_at",
      labelAr: "التاريخ",
      labelEn: "Date",
      dataType: "date",
      defaultVisible: true,
      align: "right",
    },
    {
      key: "item_name_ar",
      labelAr: "الصنف المورد",
      labelEn: "Supplied Item",
      dataType: "text",
      defaultVisible: true,
      align: "right",
    },
    {
      key: "total",
      labelAr: "قيمة المستحق",
      labelEn: "Payable Amount",
      dataType: "money",
      essential: true,
      defaultVisible: true,
      align: "left",
      aggregate: "sum",
    },
  ],

  metrics: [
    {
      key: "totalRowCount",
      labelAr: "عدد الفواتير",
      labelEn: "Invoice Count",
      format: "integer",
      calculationRuleAr: "إجمالي فواتير التوريد",
    },
    {
      key: "netPurchases",
      labelAr: "إجمالي المستحقات",
      labelEn: "Total Payables",
      format: "money",
      calculationRuleAr: "صافي التزامات التوريد",
    },
  ],

  exportCapabilities: {
    pdfTemplate: "detailed",
    excelMultiSheet: true,
    csvSupported: true,
    directPrintSlip: false,
  },
};

export const REPORT_OPERATIONS_DAILY_AUDIT: ReportDefinition = {
  id: "rep-operations-daily-audit",
  domain: "operations_audit",
  viewTemplate: "detailed_table",
  titleAr: "سجل التدقيق والرقابة اليومية للعمليات",
  titleEn: "Daily Operations & Audit Log",
  descriptionAr: "تدقيق العمليات وسجلات الحركات والتحقق من سلامة المبيعات والإلغاءات.",
  dataProviderId: "dp-sales-register",
  dataSourceName: "sales_register",
  rowGrainAr: "عملية أو حركة مسجلة بالنظام",
  defaultSortField: "created_at",
  defaultSortOrder: "desc",

  filters: [
    COMMON_REPORT_FILTERS.dateRange,
    COMMON_REPORT_FILTERS.paymentMethod,
    COMMON_REPORT_FILTERS.search,
  ],

  columns: [
    {
      key: "invoice_number",
      labelAr: "رقم السند/الفاتورة",
      labelEn: "Doc No",
      dataType: "code",
      essential: true,
      defaultVisible: true,
      align: "right",
    },
    {
      key: "created_at",
      labelAr: "وقت التنفيذ",
      labelEn: "Timestamp",
      dataType: "datetime",
      essential: true,
      defaultVisible: true,
      align: "right",
    },
    {
      key: "status",
      labelAr: "حالة السند",
      labelEn: "Status",
      dataType: "status_badge",
      essential: true,
      defaultVisible: true,
      align: "center",
    },
    {
      key: "payment_method",
      labelAr: "طريقة الدفع",
      labelEn: "Method",
      dataType: "text",
      defaultVisible: true,
      align: "center",
    },
    {
      key: "total",
      labelAr: "المبلغ الإجمالي",
      labelEn: "Total",
      dataType: "money",
      essential: true,
      defaultVisible: true,
      align: "left",
      aggregate: "sum",
    },
  ],

  metrics: [
    {
      key: "totalRowCount",
      labelAr: "إجمالي العمليات",
      labelEn: "Total Actions",
      format: "integer",
      calculationRuleAr: "عدد الحركات المسجلة",
    },
    {
      key: "netSales",
      labelAr: "إجمالي المبالغ المنفذة",
      labelEn: "Total Executed",
      format: "money",
      calculationRuleAr: "مجموع مبالغ العمليات",
    },
  ],

  exportCapabilities: {
    pdfTemplate: "detailed",
    excelMultiSheet: true,
    csvSupported: true,
    directPrintSlip: true,
  },
};

// السجل المركزي لجميع التقارير
const REPORT_DEFINITIONS: ReportDefinition[] = [
  REPORT_SALES_PRODUCT,
  REPORT_SALES_CUSTOMER,
  REPORT_SALES_BRANCH,
  REPORT_SALES_WAREHOUSE,
  REPORT_SALES_DAILY_SUMMARY,
  REPORT_SALES_PERIOD_COMPARISON,
  REPORT_INVENTORY_ITEM_CARD,
  REPORT_INVENTORY_LOW_STOCK,
  REPORT_INVENTORY_SLOW_MOVING,
  REPORT_PURCHASES_REGISTER,
  REPORT_CUSTOMERS_TURNOVER,
  REPORT_SUPPLIERS_PAYABLES,
  REPORT_OPERATIONS_DAILY_AUDIT,
  REPORT_OPERATIONS_EXCEPTIONS,
  REPORT_ITEM_CLASSIFICATION_GAPS,
];

export class ReportRegistry {
  private static reports: Map<string, ReportDefinition> = new Map(
    REPORT_DEFINITIONS.map((r) => [r.id, r]),
  );

  static register(definition: ReportDefinition): void {
    this.reports.set(definition.id, definition);
  }

  static get(id: string): ReportDefinition | undefined {
    return this.reports.get(id);
  }

  static getByDomain(domain: ReportDomain): ReportDefinition[] {
    return Array.from(this.reports.values()).filter((r) => r.domain === domain);
  }

  static getAll(): ReportDefinition[] {
    return Array.from(this.reports.values());
  }
}

export * from "./filter-registry";
export * from "./column-bridge";

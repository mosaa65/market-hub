/**
 * Vortex ERP — عقود وأنواع سجل التقارير (Report Registry Contracts)
 * المرحلة 3: REP-012
 */

export type ReportDomain =
  "sales" | "purchases" | "inventory" | "customers" | "suppliers" | "operations_audit";

export type ReportViewTemplateType =
  | "detailed_table"
  | "grouped"
  | "chart"
  | "grouped_ranking"
  | "movement_statement"
  | "summary"
  | "comparison"
  | "status_exceptions";

export type ReportFilterValues = Record<string, any>;

export type ColumnDataType =
  | "text"
  | "code"
  | "money"
  | "quantity"
  | "percentage"
  | "date"
  | "datetime"
  | "status_badge"
  | "action_link";

export type FilterControlType =
  | "date_range"
  | "warehouse_select"
  | "customer_select"
  | "supplier_select"
  | "product_select"
  | "category_select"
  | "payment_method_select"
  | "invoice_status_select"
  | "text_search"
  | "boolean_toggle";

export interface ReportColumnDefinition {
  key: string;
  labelAr: string;
  labelEn: string;
  dataType: ColumnDataType;
  essential?: boolean;
  defaultVisible: boolean;
  align?: "right" | "left" | "center";
  aggregate?: "sum" | "avg" | "count" | "none";
  unit?: string;
  exportable?: boolean;
  groupAr?: string;
  groupEn?: string;
}

export interface ReportFilterDefinition {
  key: string;
  controlType: FilterControlType;
  labelAr: string;
  labelEn: string;
  required: boolean;
  defaultValue?: unknown;
  optionsSource?: string;
  placeholderAr?: string;
}

export interface ReportMetricDefinition {
  key: string;
  labelAr: string;
  labelEn: string;
  format: "money" | "quantity" | "percentage" | "integer";
  descriptionAr?: string;
  calculationRuleAr: string;
}

export interface ReportExportCapabilities {
  pdfTemplate: "summary" | "detailed" | "movement";
  excelMultiSheet: boolean;
  csvSupported: boolean;
  directPrintSlip: boolean;
}

/** مصدر فرز الاستثناءات المدعوم في الخادم. */
export type ReportExceptionSource =
  | "sales_register"
  | "purchase_register"
  | "inventory_low_stock"
  | "inventory_slow_moving"
  | "item_classification_gaps";

/**
 * عقد كتلة المقارنة بين فترتين.
 *
 * يُحسب الفارق المطلق ونسبة التغير داخل الخادم، ولا يُعاد أي تجميع خام للواجهة.
 */
export interface ReportComparisonContract {
  metricKey: string;
  metricLabelAr: string;
  metricFormat: "money" | "quantity" | "percentage" | "integer";
  comparisonMode?: "previous_period" | "previous_year";
}

/** كتلة المقارنة الجاهزة القادمة من الخادم. */
export interface ReportComparisonResult {
  metricKey: string;
  metricLabelAr: string;
  currentValue: number;
  previousValue: number;
  absoluteDelta: number;
  percentChange: number | null;
  previousStartDate: string | null;
  previousEndDate: string | null;
  format: "money" | "quantity" | "percentage" | "integer";
}

export interface ReportDefinition {
  id: string; // مثال: 'rep-sales-product'
  domain: ReportDomain;
  viewTemplate: ReportViewTemplateType;
  titleAr: string;
  titleEn: string;
  descriptionAr: string;

  // مزود البيانات ومصدر الحقيقة
  dataProviderId: string;
  dataSourceName: string;
  rowGrainAr: string; // ما يمثله الصف (مثل: بند فاتورة بيع)
  defaultSortField: string;
  defaultSortOrder: "asc" | "desc";

  // العقود والعناصر
  filters: ReportFilterDefinition[];
  columns: ReportColumnDefinition[];
  metrics: ReportMetricDefinition[];

  costBasisNotice?: "ACTUAL" | "REFERENCE_ONLY" | "MIXED";

  // إمكانات التصدير
  exportCapabilities: ReportExportCapabilities;

  // عقد كتلة المقارنة (مطلوب فقط لقوالب "comparison")
  comparison?: ReportComparisonContract;

  // مصدر فرز الاستثناءات (مطلوب فقط لقوالب "status_exceptions")
  exceptionSource?: ReportExceptionSource;

  // الصلاحيات (اختياري)
  requiredPermission?: string;
}

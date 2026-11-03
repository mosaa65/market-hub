/**
 * Vortex ERP — سجل الفلاتر الموحد للتقارير (Report Filter Registry)
 * المرحلة 3: REP-013
 */

import type { ReportFilterDefinition } from "../types";

export const COMMON_REPORT_FILTERS: Record<string, ReportFilterDefinition> = {
  dateRange: {
    key: "dateRange",
    controlType: "date_range",
    labelAr: "الفترة الزمنية",
    labelEn: "Date Range",
    required: false,
    defaultValue: {
      preset: "this_month",
    },
  },
  warehouse: {
    key: "warehouseId",
    controlType: "warehouse_select",
    labelAr: "المستودع",
    labelEn: "Warehouse",
    required: false,
    optionsSource: "warehouses",
    placeholderAr: "كل المستودعات",
  },
  customer: {
    key: "customerId",
    controlType: "customer_select",
    labelAr: "العميل",
    labelEn: "Customer",
    required: false,
    optionsSource: "customers",
    placeholderAr: "كل العملاء",
  },
  supplier: {
    key: "supplierId",
    controlType: "supplier_select",
    labelAr: "المورد",
    labelEn: "Supplier",
    required: false,
    optionsSource: "suppliers",
    placeholderAr: "كل الموردين",
  },
  product: {
    key: "productId",
    controlType: "product_select",
    labelAr: "المنتج / الصنف",
    labelEn: "Product / Item",
    required: false,
    optionsSource: "products",
    placeholderAr: "كل المنتجات",
  },
  paymentMethod: {
    key: "paymentMethod",
    controlType: "payment_method_select",
    labelAr: "طريقة الدفع",
    labelEn: "Payment Method",
    required: false,
    placeholderAr: "كل طرق الدفع",
  },
  invoiceStatus: {
    key: "status",
    controlType: "invoice_status_select",
    labelAr: "حالة الفاتورة",
    labelEn: "Invoice Status",
    required: false,
    placeholderAr: "كل الحالات النشطة",
  },
  search: {
    key: "search",
    controlType: "text_search",
    labelAr: "بحث سريع",
    labelEn: "Search",
    required: false,
    placeholderAr: "رقم الفاتورة، اسم الصنف، الباركود...",
  },
};

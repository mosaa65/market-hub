import type { LucideIcon } from "lucide-react";
import {
  BarChart3,
  Boxes,
  FileCheck2,
  FileClock,
  FileInput,
  FileOutput,
  HandCoins,
  PackageSearch,
  ReceiptText,
  ShoppingCart,
  Users,
} from "lucide-react";

export type ReportType =
  | "customer-account"
  | "supplier-account"
  | "purchases"
  | "debts"
  | "sales-invoices"
  | "inventory-movements"
  | "returns"
  | "expenses"
  | "profit-sales"
  | "cash"
  | "product";

export interface ReportDefinition {
  type: ReportType;
  title: { ar: string; en: string };
  description: { ar: string; en: string };
  icon: LucideIcon;
  /** نوع التقرير الذي يمكن عرضه فعليًا في النسخة الأولى */
  implemented: boolean;
  entityType?: "customer" | "supplier" | "cash";
}

export const REPORT_DEFINITIONS: ReportDefinition[] = [
  {
    type: "customer-account",
    title: { ar: "كشف حساب العميل", en: "Customer account" },
    description: {
      ar: "حركات العميل والرصيد التراكمي",
      en: "Customer movements and running balance",
    },
    icon: Users,
    implemented: true,
    entityType: "customer",
  },
  {
    type: "supplier-account",
    title: { ar: "كشف حساب المورد", en: "Supplier account" },
    description: {
      ar: "فواتير المورد والمرتجعات والسداد المرافق",
      en: "Supplier invoices, returns and bundled payments",
    },
    icon: HandCoins,
    implemented: true,
    entityType: "supplier",
  },
  {
    type: "cash",
    title: { ar: "كشف الصندوق والبنك", en: "Cash and bank" },
    description: {
      ar: "التحصيلات والمدفوعات والمصروفات",
      en: "Collections, payments and expenses",
    },
    icon: ReceiptText,
    implemented: true,
    entityType: "cash",
  },
  {
    type: "purchases",
    title: { ar: "كشف المشتريات", en: "Purchases" },
    description: { ar: "فواتير المشتريات وبنودها", en: "Purchase invoices and items" },
    icon: ShoppingCart,
    implemented: true,
  },
  {
    type: "debts",
    title: { ar: "كشف الديون والمستحقات", en: "Debts and receivables" },
    description: { ar: "الأرصدة المستحقة ومصادرها", en: "Outstanding balances and their sources" },
    icon: FileClock,
    implemented: true,
  },
  {
    type: "sales-invoices",
    title: { ar: "كشف فواتير العملاء", en: "Customer invoices" },
    description: {
      ar: "فواتير المبيعات والمدفوع والمتبقي",
      en: "Sales invoices, paid and remaining",
    },
    icon: FileCheck2,
    implemented: true,
  },
  {
    type: "inventory-movements",
    title: { ar: "كشف حركة المخزون", en: "Inventory movements" },
    description: { ar: "الإدخال والإخراج والتسويات", en: "Inbound, outbound and adjustments" },
    icon: Boxes,
    implemented: true,
  },
  {
    type: "returns",
    title: { ar: "كشف المرتجعات", en: "Returns" },
    description: { ar: "مرتجعات المبيعات والمشتريات", en: "Sales and purchase returns" },
    icon: FileInput,
    implemented: true,
  },
  {
    type: "expenses",
    title: { ar: "كشف المصروفات", en: "Expenses" },
    description: { ar: "المصروفات حسب التصنيف والفترة", en: "Expenses by category and period" },
    icon: FileOutput,
    implemented: true,
  },
  {
    type: "profit-sales",
    title: { ar: "كشف الأرباح والمبيعات الأساسي", en: "Basic profit and sales" },
    description: { ar: "المبيعات والتكلفة والربح الأساسي", en: "Sales, cost and basic profit" },
    icon: BarChart3,
    implemented: true,
  },
  {
    type: "product",
    title: { ar: "كشف الصنف", en: "Product statement" },
    description: { ar: "حركة الصنف وكميته وقيمته", en: "Product movement, quantity and value" },
    icon: PackageSearch,
    implemented: true,
  },
];

export const DEFAULT_REPORT_TYPE: ReportType = "customer-account";

export function reportDefinition(type: ReportType): ReportDefinition {
  return REPORT_DEFINITIONS.find((report) => report.type === type) ?? REPORT_DEFINITIONS[0];
}

export function reportTypeForEntity(entityType: "customer" | "supplier" | "cash"): ReportType {
  if (entityType === "supplier") return "supplier-account";
  if (entityType === "cash") return "cash";
  return "customer-account";
}

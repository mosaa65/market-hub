/**
 * Vortex ERP — سجل أبعاد التجميع المرن لكل مجالات التقارير (Dimension Registry)
 * يدعم التجميع متعدد الأبعاد ودمج أكثر من بُعد في نفس السطر، وتحديد الأعمدة المرتبطة بكل بعد.
 */

import type { LucideIcon } from "lucide-react";
import {
  Users,
  Package,
  CreditCard,
  Building2,
  Warehouse,
  Truck,
  ArrowLeftRight,
  UserCheck,
  Tag,
} from "lucide-react";
import type { ReportColumnDefinition, ReportDomain } from "../types";

export type ReportDimensionKey =
  | "customer"
  | "supplier"
  | "product"
  | "category"
  | "branch"
  | "warehouse"
  | "payment_method"
  | "movement_type"
  | "user";

export interface DomainDimensionConfig {
  key: ReportDimensionKey;
  labelAr: string;
  labelEn: string;
  icon: LucideIcon;
  /** الأعمدة التي تُضاف وتُعرض في الجدول عند تفعيل هذا البعد */
  columns: ReportColumnDefinition[];
}

// ── 1. أبعاد مجال المبيعات (Sales) ──
export const SALES_DIMENSIONS: DomainDimensionConfig[] = [
  {
    key: "customer",
    labelAr: "العميل",
    labelEn: "Customer",
    icon: Users,
    columns: [
      {
        key: "customer_name",
        labelAr: "العميل",
        labelEn: "Customer",
        dataType: "text",
        defaultVisible: true,
        groupAr: "أبعاد التجميع",
        groupEn: "Dimensions",
      },
    ],
  },
  {
    key: "product",
    labelAr: "المنتج",
    labelEn: "Product",
    icon: Package,
    columns: [
      {
        key: "sku",
        labelAr: "رمز الصنف (SKU)",
        labelEn: "SKU",
        dataType: "code",
        defaultVisible: true,
        groupAr: "أبعاد التجميع",
        groupEn: "Dimensions",
      },
      {
        key: "product_name",
        labelAr: "اسم المنتج",
        labelEn: "Product Name",
        dataType: "text",
        defaultVisible: true,
        groupAr: "أبعاد التجميع",
        groupEn: "Dimensions",
      },
    ],
  },
  {
    key: "payment_method",
    labelAr: "طريقة الدفع",
    labelEn: "Payment Method",
    icon: CreditCard,
    columns: [
      {
        key: "payment_method_name",
        labelAr: "طريقة الدفع",
        labelEn: "Payment Method",
        dataType: "text",
        defaultVisible: true,
        groupAr: "أبعاد التجميع",
        groupEn: "Dimensions",
      },
    ],
  },
  {
    key: "branch",
    labelAr: "الفرع",
    labelEn: "Branch",
    icon: Building2,
    columns: [
      {
        key: "branch_name",
        labelAr: "الفرع",
        labelEn: "Branch",
        dataType: "text",
        defaultVisible: true,
        groupAr: "أبعاد التجميع",
        groupEn: "Dimensions",
      },
    ],
  },
  {
    key: "warehouse",
    labelAr: "المستودع",
    labelEn: "Warehouse",
    icon: Warehouse,
    columns: [
      {
        key: "warehouse_name",
        labelAr: "المستودع",
        labelEn: "Warehouse",
        dataType: "text",
        defaultVisible: true,
        groupAr: "أبعاد التجميع",
        groupEn: "Dimensions",
      },
    ],
  },
];

// ── 2. أبعاد مجال المشتريات (Purchases) ──
export const PURCHASES_DIMENSIONS: DomainDimensionConfig[] = [
  {
    key: "supplier",
    labelAr: "المورد",
    labelEn: "Supplier",
    icon: Truck,
    columns: [
      {
        key: "supplier_name",
        labelAr: "المورد",
        labelEn: "Supplier",
        dataType: "text",
        defaultVisible: true,
        groupAr: "أبعاد التجميع",
      },
    ],
  },
  {
    key: "product",
    labelAr: "المنتج",
    labelEn: "Product",
    icon: Package,
    columns: [
      {
        key: "sku",
        labelAr: "رمز الصنف (SKU)",
        labelEn: "SKU",
        dataType: "code",
        defaultVisible: true,
        groupAr: "أبعاد التجميع",
      },
      {
        key: "product_name",
        labelAr: "اسم المنتج",
        labelEn: "Product Name",
        dataType: "text",
        defaultVisible: true,
        groupAr: "أبعاد التجميع",
      },
    ],
  },
  {
    key: "warehouse",
    labelAr: "المستودع",
    labelEn: "Warehouse",
    icon: Warehouse,
    columns: [
      {
        key: "warehouse_name",
        labelAr: "المستودع",
        labelEn: "Warehouse",
        dataType: "text",
        defaultVisible: true,
        groupAr: "أبعاد التجميع",
      },
    ],
  },
  {
    key: "payment_method",
    labelAr: "طريقة السداد",
    labelEn: "Payment Method",
    icon: CreditCard,
    columns: [
      {
        key: "payment_method_name",
        labelAr: "طريقة السداد",
        labelEn: "Payment Method",
        dataType: "text",
        defaultVisible: true,
        groupAr: "أبعاد التجميع",
      },
    ],
  },
];

// ── 3. أبعاد مجال المخزون (Inventory) ──
export const INVENTORY_DIMENSIONS: DomainDimensionConfig[] = [
  {
    key: "product",
    labelAr: "الصنف",
    labelEn: "Product",
    icon: Package,
    columns: [
      {
        key: "sku",
        labelAr: "رمز الصنف (SKU)",
        labelEn: "SKU",
        dataType: "code",
        defaultVisible: true,
        groupAr: "أبعاد التجميع",
      },
      {
        key: "product_name",
        labelAr: "اسم الصنف",
        labelEn: "Product Name",
        dataType: "text",
        defaultVisible: true,
        groupAr: "أبعاد التجميع",
      },
    ],
  },
  {
    key: "warehouse",
    labelAr: "المستودع",
    labelEn: "Warehouse",
    icon: Warehouse,
    columns: [
      {
        key: "warehouse_name",
        labelAr: "المستودع",
        labelEn: "Warehouse",
        dataType: "text",
        defaultVisible: true,
        groupAr: "أبعاد التجميع",
      },
    ],
  },
  {
    key: "movement_type",
    labelAr: "نوع الحركة",
    labelEn: "Movement Type",
    icon: ArrowLeftRight,
    columns: [
      {
        key: "movement_type_name",
        labelAr: "نوع الحركة",
        labelEn: "Movement Type",
        dataType: "status_badge",
        defaultVisible: true,
        groupAr: "أبعاد التجميع",
      },
    ],
  },
];

// ── 4. أبعاد مجال العملاء (Customers) ──
export const CUSTOMERS_DIMENSIONS: DomainDimensionConfig[] = [
  {
    key: "customer",
    labelAr: "العميل",
    labelEn: "Customer",
    icon: Users,
    columns: [
      {
        key: "customer_name",
        labelAr: "العميل",
        labelEn: "Customer",
        dataType: "text",
        defaultVisible: true,
        groupAr: "أبعاد التجميع",
      },
    ],
  },
  {
    key: "payment_method",
    labelAr: "طريقة السداد",
    labelEn: "Payment Method",
    icon: CreditCard,
    columns: [
      {
        key: "payment_method_name",
        labelAr: "طريقة السداد",
        labelEn: "Payment Method",
        dataType: "text",
        defaultVisible: true,
        groupAr: "أبعاد التجميع",
      },
    ],
  },
];

// ── 5. أبعاد مجال الموردين (Suppliers) ──
export const SUPPLIERS_DIMENSIONS: DomainDimensionConfig[] = [
  {
    key: "supplier",
    labelAr: "المورد",
    labelEn: "Supplier",
    icon: Truck,
    columns: [
      {
        key: "supplier_name",
        labelAr: "المورد",
        labelEn: "Supplier",
        dataType: "text",
        defaultVisible: true,
        groupAr: "أبعاد التجميع",
      },
    ],
  },
  {
    key: "payment_method",
    labelAr: "طريقة السداد",
    labelEn: "Payment Method",
    icon: CreditCard,
    columns: [
      {
        key: "payment_method_name",
        labelAr: "طريقة السداد",
        labelEn: "Payment Method",
        dataType: "text",
        defaultVisible: true,
        groupAr: "أبعاد التجميع",
      },
    ],
  },
];

// ── 6. أبعاد مجال الرقابة والعمليات (Operations Audit) ──
export const OPERATIONS_AUDIT_DIMENSIONS: DomainDimensionConfig[] = [
  {
    key: "user",
    labelAr: "المستخدم / الكاشير",
    labelEn: "User / Cashier",
    icon: UserCheck,
    columns: [
      {
        key: "user_name",
        labelAr: "المستخدم",
        labelEn: "User",
        dataType: "text",
        defaultVisible: true,
        groupAr: "أبعاد التجميع",
      },
    ],
  },
  {
    key: "branch",
    labelAr: "الفرع",
    labelEn: "Branch",
    icon: Building2,
    columns: [
      {
        key: "branch_name",
        labelAr: "الفرع",
        labelEn: "Branch",
        dataType: "text",
        defaultVisible: true,
        groupAr: "أبعاد التجميع",
      },
    ],
  },
  {
    key: "category",
    labelAr: "نوع العملية",
    labelEn: "Operation Nature",
    icon: Tag,
    columns: [
      {
        key: "operation_type_name",
        labelAr: "نوع العملية",
        labelEn: "Operation",
        dataType: "status_badge",
        defaultVisible: true,
        groupAr: "أبعاد التجميع",
      },
    ],
  },
];

/** قاموس استرجاع الأبعاد المتاحة لأي مجال */
export const DOMAIN_DIMENSIONS_MAP: Record<ReportDomain, DomainDimensionConfig[]> = {
  sales: SALES_DIMENSIONS,
  purchases: PURCHASES_DIMENSIONS,
  inventory: INVENTORY_DIMENSIONS,
  customers: CUSTOMERS_DIMENSIONS,
  suppliers: SUPPLIERS_DIMENSIONS,
  operations_audit: OPERATIONS_AUDIT_DIMENSIONS,
};

export function getDomainDimensions(domain: ReportDomain): DomainDimensionConfig[] {
  return DOMAIN_DIMENSIONS_MAP[domain] || SALES_DIMENSIONS;
}

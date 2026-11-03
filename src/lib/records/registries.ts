import type { ColumnRegistry } from "./column-registry";

/**
 * The column registry for each records screen.
 *
 * These are *declarations only* — they list the fields a screen offers and
 * which of them start hidden. The renderer for each key lives with the screen
 * (`DataTableColumn`), and a key declared here without a matching column is
 * simply never drawn.
 *
 * Defaults follow the plan's rule for each screen: the column that **names** the
 * record is essential, the actions column is essential, and the technical
 * identifiers (English name, SKU, internal codes) start hidden because they are
 * for search and data entry, not for scanning a list (§9.2).
 */

/**
 * Products — §9.2: the Arabic name is the primary identity and is always shown;
 * the English name and SKU are hidden by default but available from the picker
 * and still searchable.
 */
export const PRODUCTS_COLUMNS: ColumnRegistry = {
  id: "products",
  columns: [
    {
      key: "name",
      labelAr: "اسم المنتج",
      labelEn: "Product name",
      essential: true,
      defaultVisible: true,
    },
    { key: "name_ar", labelAr: "الاسم بالعربية", labelEn: "Arabic name", defaultVisible: true },
    {
      key: "name_en",
      labelAr: "الاسم بالإنجليزية",
      labelEn: "English name",
      defaultVisible: false,
    },
    { key: "category", labelAr: "التصنيف", labelEn: "Category", defaultVisible: true },
    { key: "brand", labelAr: "العلامة التجارية", labelEn: "Brand", defaultVisible: false },
    { key: "unit", labelAr: "الوحدة", labelEn: "Unit", defaultVisible: true },
    { key: "sku", labelAr: "رمز الصنف", labelEn: "SKU", defaultVisible: false },
    { key: "barcode", labelAr: "الباركود", labelEn: "Barcode", defaultVisible: false },
    { key: "sale_price", labelAr: "سعر البيع", labelEn: "Sale price", defaultVisible: true },
    { key: "cost_price", labelAr: "سعر التكلفة", labelEn: "Cost price", defaultVisible: false },
    { key: "stock", labelAr: "الكمية المتاحة", labelEn: "Stock", defaultVisible: true },
    { key: "min_stock", labelAr: "حد الطلب الأدنى", labelEn: "Min stock", defaultVisible: false },
    { key: "tax_rate", labelAr: "نسبة الضريبة", labelEn: "Tax rate", defaultVisible: false },
    {
      key: "role",
      labelAr: "دور الصنف",
      labelEn: "Item role",
      defaultVisible: false,
      groupAr: "متقدم",
      groupEn: "Advanced",
    },
    {
      key: "shelf_location",
      labelAr: "موقع الرف",
      labelEn: "Shelf location",
      defaultVisible: false,
      groupAr: "متقدم",
      groupEn: "Advanced",
    },
    { key: "is_active", labelAr: "الحالة", labelEn: "Status", defaultVisible: true },
    {
      key: "actions",
      labelAr: "الإجراءات",
      labelEn: "Actions",
      essential: true,
      defaultVisible: true,
    },
  ],
};

/** Inventory movements / balances — the identifier is the product itself. */
export const INVENTORY_COLUMNS: ColumnRegistry = {
  id: "inventory",
  columns: [
    {
      key: "product",
      labelAr: "الصنف",
      labelEn: "Item",
      essential: true,
      defaultVisible: true,
    },
    { key: "sku", labelAr: "رمز الصنف", labelEn: "SKU", defaultVisible: false },
    { key: "warehouse", labelAr: "المستودع", labelEn: "Warehouse", defaultVisible: true },
    { key: "quantity", labelAr: "الكمية", labelEn: "Quantity", defaultVisible: true },
    { key: "unit", labelAr: "الوحدة", labelEn: "Unit", defaultVisible: true },
    { key: "min_stock", labelAr: "حد الطلب الأدنى", labelEn: "Min stock", defaultVisible: false },
    { key: "cost", labelAr: "التكلفة", labelEn: "Cost", defaultVisible: false },
    { key: "value", labelAr: "قيمة المخزون", labelEn: "Stock value", defaultVisible: true },
    { key: "status", labelAr: "الحالة", labelEn: "Status", defaultVisible: true },
    {
      key: "actions",
      labelAr: "الإجراءات",
      labelEn: "Actions",
      essential: true,
      defaultVisible: true,
    },
  ],
};

/** Sales invoices. */
export const SALES_COLUMNS: ColumnRegistry = {
  id: "sales",
  columns: [
    {
      key: "invoice_number",
      labelAr: "رقم الفاتورة",
      labelEn: "Invoice no.",
      essential: true,
      defaultVisible: true,
    },
    { key: "date", labelAr: "التاريخ", labelEn: "Date", defaultVisible: true },
    { key: "customer", labelAr: "العميل", labelEn: "Customer", defaultVisible: true },
    { key: "total", labelAr: "الإجمالي", labelEn: "Total", defaultVisible: true },
    { key: "paid", labelAr: "المدفوع", labelEn: "Paid", defaultVisible: true },
    { key: "balance", labelAr: "المتبقي", labelEn: "Balance", defaultVisible: true },
    {
      key: "payment_method",
      labelAr: "طريقة الدفع",
      labelEn: "Payment method",
      defaultVisible: false,
    },
    { key: "status", labelAr: "الحالة", labelEn: "Status", defaultVisible: true },
    { key: "items", labelAr: "عدد الأصناف", labelEn: "Item count", defaultVisible: false },
    {
      key: "actions",
      labelAr: "الإجراءات",
      labelEn: "Actions",
      essential: true,
      defaultVisible: true,
    },
  ],
};

/** Purchase invoices. */
export const PURCHASES_COLUMNS: ColumnRegistry = {
  id: "purchases",
  columns: [
    {
      key: "invoice_number",
      labelAr: "رقم الفاتورة",
      labelEn: "Invoice no.",
      essential: true,
      defaultVisible: true,
    },
    { key: "date", labelAr: "التاريخ", labelEn: "Date", defaultVisible: true },
    { key: "supplier", labelAr: "المورد", labelEn: "Supplier", defaultVisible: true },
    { key: "total", labelAr: "الإجمالي", labelEn: "Total", defaultVisible: true },
    { key: "paid", labelAr: "المدفوع", labelEn: "Paid", defaultVisible: true },
    { key: "balance", labelAr: "المتبقي", labelEn: "Balance", defaultVisible: true },
    { key: "status", labelAr: "الحالة", labelEn: "Status", defaultVisible: true },
    { key: "items", labelAr: "عدد الأصناف", labelEn: "Item count", defaultVisible: false },
    {
      key: "actions",
      labelAr: "الإجراءات",
      labelEn: "Actions",
      essential: true,
      defaultVisible: true,
    },
  ],
};

/** Customers directory. */
export const CUSTOMERS_COLUMNS: ColumnRegistry = {
  id: "customers",
  columns: [
    {
      key: "name",
      labelAr: "اسم العميل",
      labelEn: "Customer",
      essential: true,
      defaultVisible: true,
    },
    { key: "phone", labelAr: "الهاتف", labelEn: "Phone", defaultVisible: true },
    { key: "balance", labelAr: "الرصيد", labelEn: "Balance", defaultVisible: true },
    {
      key: "credit_limit",
      labelAr: "سقف المديونية",
      labelEn: "Credit limit",
      defaultVisible: false,
    },
    { key: "address", labelAr: "العنوان", labelEn: "Address", defaultVisible: false },
    { key: "status", labelAr: "الحالة", labelEn: "Status", defaultVisible: true },
    {
      key: "actions",
      labelAr: "الإجراءات",
      labelEn: "Actions",
      essential: true,
      defaultVisible: true,
    },
  ],
};

/** Suppliers directory. */
export const SUPPLIERS_COLUMNS: ColumnRegistry = {
  id: "suppliers",
  columns: [
    {
      key: "name",
      labelAr: "اسم المورد",
      labelEn: "Supplier",
      essential: true,
      defaultVisible: true,
    },
    { key: "phone", labelAr: "الهاتف", labelEn: "Phone", defaultVisible: true },
    { key: "balance", labelAr: "الرصيد", labelEn: "Balance", defaultVisible: true },
    { key: "address", labelAr: "العنوان", labelEn: "Address", defaultVisible: false },
    { key: "status", labelAr: "الحالة", labelEn: "Status", defaultVisible: true },
    {
      key: "actions",
      labelAr: "الإجراءات",
      labelEn: "Actions",
      essential: true,
      defaultVisible: true,
    },
  ],
};

/** Payment methods — managed in Settings, but shares the same toolbar. */
export const PAYMENT_METHODS_COLUMNS: ColumnRegistry = {
  id: "payment-methods",
  columns: [
    {
      key: "name",
      labelAr: "الطريقة",
      labelEn: "Method",
      essential: true,
      defaultVisible: true,
    },
    { key: "enabled", labelAr: "الحالة", labelEn: "Status", defaultVisible: true },
    { key: "contexts", labelAr: "أماكن الظهور", labelEn: "Appears in", defaultVisible: true },
    {
      key: "ledger_kind",
      labelAr: "عائلة التسوية",
      labelEn: "Settlement family",
      defaultVisible: false,
    },
    {
      key: "account",
      labelAr: "الحساب المحاسبي",
      labelEn: "Ledger account",
      defaultVisible: false,
    },
    { key: "order", labelAr: "الترتيب", labelEn: "Order", defaultVisible: true },
    {
      key: "actions",
      labelAr: "الإجراءات",
      labelEn: "Actions",
      essential: true,
      defaultVisible: true,
    },
  ],
};

/** All registries by screen id. */
export const COLUMN_REGISTRIES: Record<string, ColumnRegistry> = {
  products: PRODUCTS_COLUMNS,
  inventory: INVENTORY_COLUMNS,
  sales: SALES_COLUMNS,
  purchases: PURCHASES_COLUMNS,
  customers: CUSTOMERS_COLUMNS,
  suppliers: SUPPLIERS_COLUMNS,
  "payment-methods": PAYMENT_METHODS_COLUMNS,
};

export function getColumnRegistry(screen: string): ColumnRegistry | undefined {
  return COLUMN_REGISTRIES[screen];
}

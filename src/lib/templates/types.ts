export type DocumentType =
  | "customer_invoice"     // فاتورة العميل
  | "inventory_document"   // مستند حركة المخزون
  | "purchase_invoice"     // فاتورة الشراء
  | "sales_return"         // مردود المبيعات
  | "purchase_return"      // مردود المشتريات
  | "stock_transfer"       // تحويل مخزني
  | "stock_receipt"        // إذن استلام مخزني
  | "stock_issue"          // إذن صرف مخزني
  | "payment_receipt"      // سند قبض/صرف
  | "quotation"            // عرض سعر
  | "delivery_note";       // إذن تسليم

export type PaperSize = "80mm" | "58mm" | "A4" | "A5";

export type InvoiceTemplateId = "thermal" | "standard" | "elegant" | string;

export interface DocumentLine {
  product: string;
  qty: number;
  unit?: string;
  code?: string; // SKU / Barcode
  price?: number;
  total?: number;
  discount?: number;
  tax?: number;
  note?: string;
}

export interface CompanyDetails {
  name?: string;
  address?: string;
  phone?: string;
  vat?: string;
  logo?: string;
  email?: string;
  website?: string;
}

export interface CustomFieldOptions {
  showLogo?: boolean;
  showCompanyInfo?: boolean;
  showCustomerInfo?: boolean;
  showDocNumberDate?: boolean;
  showMovementInfo?: boolean;
  showFinancialDetails?: boolean;
  showPaymentInfo?: boolean;
  showNotes?: boolean;
  showSignatures?: boolean;
  showFooter?: boolean;
  showBranding?: boolean;
}

export interface UnifiedDocumentData {
  docType?: DocumentType;
  title: string;
  number: string;
  relatedRef?: string; // رقم الفاتورة أو العملية المرتبطة
  date: string;
  dueDate?: string;
  
  // Party & Customer Details
  partyLabel?: string;
  partyName?: string;
  partyPhone?: string;
  partyVat?: string;
  partyAddress?: string;

  // Inventory & Warehouse Specific
  movementType?: string; // نوع الحركة (مثال: صرف مبيعات، تسوية مخزنية، تحويل)
  warehouse?: string; // المستودع المصدر/الرئيسي
  destinationWarehouse?: string; // المستودع الوجهة في حالة التحويل
  operatorName?: string; // اسم الموظف / المنفذ للحركة

  // Payment & Financials
  payment?: string;
  status?: string;
  subtotal?: number;
  tax?: number;
  discount?: number;
  total?: number;
  paid?: number;
  balance?: number;
  currency?: string;

  // Notes & Footer
  notes?: string;
  terms?: string;
  lines: DocumentLine[];
  company?: CompanyDetails;
  brandingText?: string;
  
  // Dynamic Field Customization Override
  options?: CustomFieldOptions;
}

// Backward compatibility alias
export type UnifiedInvoiceData = UnifiedDocumentData;
export type InvoiceLine = DocumentLine;

export interface InvoiceLabels {
  invoice: string;
  date: string;
  dueDate?: string;
  billTo: string;
  warehouse: string;
  destinationWarehouse?: string;
  operator?: string;
  movementType?: string;
  payment: string;
  status: string;
  product: string;
  code?: string;
  unit?: string;
  qty: string;
  price: string;
  total: string;
  subtotal: string;
  tax: string;
  discount: string;
  grandTotal: string;
  paid: string;
  balance: string;
  thanks: string;
  poweredBy: string;
  notes?: string;
  recipientSignature?: string;
  authorizedSignature?: string;
  warehouseKeeperSignature?: string;
}

export interface PrintTemplateMeta {
  id: InvoiceTemplateId;
  nameAr: string;
  nameEn: string;
  category: "thermal" | "standard" | "custom";
  paperSize: PaperSize;
  supportedDocTypes?: DocumentType[];
}

export type TemplateRenderer = (
  doc: UnifiedDocumentData,
  labels: InvoiceLabels,
  rtl: boolean,
  options?: CustomFieldOptions
) => string;

export interface PrintSettings extends CustomFieldOptions {
  defaultCustomerTemplate: InvoiceTemplateId;
  defaultInventoryTemplate: InvoiceTemplateId;
  paperSize: PaperSize;
  autoPrintCustomerInvoice: boolean;
  autoPrintInventoryDocument: boolean;
  printMode: "auto" | "ask" | "off";
}

export interface PrintJobItem {
  doc: UnifiedDocumentData;
  templateId?: InvoiceTemplateId;
}

export const DEFAULT_BRANDING = "مشغل بواسطة إنما سوفت للحلول البرمجية - 772217218";

export function escapeHtml(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function formatMoney(n?: number, cur = ""): string {
  if (n === undefined || n === null) return "0.00";
  return `${cur ? cur + " " : ""}${Number(n || 0).toFixed(2)}`;
}

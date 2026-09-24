export interface InvoiceLine {
  product: string;
  qty: number;
  price: number;
  total: number;
  unit?: string;
  code?: string;
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

export interface UnifiedInvoiceData {
  title: string;
  number: string;
  date: string;
  dueDate?: string;
  partyLabel: string;
  partyName: string;
  partyPhone?: string;
  partyVat?: string;
  partyAddress?: string;
  warehouse?: string;
  payment?: string;
  status?: string;
  notes?: string;
  terms?: string;
  lines: InvoiceLine[];
  subtotal: number;
  tax: number;
  discount: number;
  total: number;
  paid?: number;
  company?: CompanyDetails;
  currency?: string;
  brandingText?: string;
}

export interface InvoiceLabels {
  invoice: string;
  date: string;
  dueDate?: string;
  billTo: string;
  warehouse: string;
  payment: string;
  status: string;
  product: string;
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
}

export type InvoiceTemplateId = "thermal" | "standard" | "elegant" | string;

export interface PrintTemplateMeta {
  id: InvoiceTemplateId;
  nameAr: string;
  nameEn: string;
  category: "thermal" | "standard" | "custom";
  paperSize: "80mm" | "58mm" | "A4" | "A5";
}

export type TemplateRenderer = (
  doc: UnifiedInvoiceData,
  labels: InvoiceLabels,
  rtl: boolean
) => string;

export const DEFAULT_BRANDING = "Powered by Inama Soft - 772217218";

export function escapeHtml(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function formatMoney(n: number, cur = ""): string {
  return `${cur ? cur + " " : ""}${Number(n || 0).toFixed(2)}`;
}

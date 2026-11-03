/**
 * Unified Communication Engine — Types & Contracts
 * Market-Hub ERP
 */

import type { CompanyProfile } from "@/lib/printing/company-profile";

export type MessageLanguage = "ar" | "en";

export type CommunicationChannel = "whatsapp" | "sms" | "native_share" | "clipboard" | "print";

export type CommunicationEventType =
  | "payment_received"
  | "payment_request"
  | "debt_reminder"
  | "invoice_created"
  | "invoice_share"
  | "statement_share"
  | "supplier_notice"
  | "general_customer_notice"
  | "milling_document_share";

export type DeliveryStatus =
  "idle" | "preparing" | "ready" | "opened" | "shared" | "copied" | "failed";

export interface CustomerContext {
  id: string;
  name: string;
  phone?: string | null;
  email?: string | null;
  balance: number;
  creditLimit?: number;
  preferredLanguage?: MessageLanguage;
  hasLedgerActivity?: boolean;
}

export interface InvoiceContext {
  id: string;
  invoiceNumber: string;
  date: string;
  subtotal: number;
  tax?: number;
  discount?: number;
  total: number;
  paid: number;
  remaining: number;
  dueDate?: string | null;
  status?: string;
  linesCount?: number;
}

export interface PaymentContext {
  id?: string;
  receiptNumber: string;
  date: string;
  amount: number;
  method: string;
  remainingBalance?: number;
  notes?: string | null;
  invoiceNumber?: string | null;
}

export interface StatementContext {
  periodLabel: string;
  openingBalance: number;
  totalDebit: number;
  totalCredit: number;
  closingBalance: number;
  transactionsCount: number;
}

export interface UnifiedCommunicationContext {
  customer?: CustomerContext | null;
  company?: CompanyProfile | null;
  invoice?: InvoiceContext | null;
  payment?: PaymentContext | null;
  statement?: StatementContext | null;
  millingDocumentNumber?: string | null;
  millingStatus?: string | null;
  event: CommunicationEventType;
  language?: MessageLanguage;
}

export type ActionKey =
  | "payment_request"
  | "debt_reminder"
  | "invoice_share"
  | "payment_receipt"
  | "statement_share"
  | "statement_export_pdf"
  | "statement_export_excel"
  | "customer_general_message";

export interface ActionDescriptor {
  key: ActionKey;
  labelAr: string;
  labelEn: string;
  descriptionAr?: string;
  descriptionEn?: string;
  enabled: boolean;
  disabledReasonAr?: string;
  disabledReasonEn?: string;
  category: "finance" | "invoice" | "statement" | "general";
  isPrimary?: boolean;
}

export interface RenderedMessage {
  text: string;
  event: CommunicationEventType;
  language: MessageLanguage;
  recipientPhone?: string | null;
  normalizedPhone?: string | null;
  isValidRecipient: boolean;
  canSendWhatsApp: boolean;
  whatsAppUrl: string | null;
}

export interface DocumentExportResult {
  filename: string;
  format: "pdf" | "xlsx" | "csv" | "html";
  blob?: Blob;
  url?: string;
}

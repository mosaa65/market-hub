/**
 * Unified Communication Context Builder
 * Market-Hub ERP
 *
 * Assembles unified context from real database records and the active Company Profile.
 */

import { getCachedCompanyProfile, type CompanyProfile } from "@/lib/printing/company-profile";
import type { StatementResult } from "@/lib/statements/types";
import type {
  CommunicationEventType,
  CustomerContext,
  InvoiceContext,
  MessageLanguage,
  PaymentContext,
  StatementContext,
  UnifiedCommunicationContext,
} from "./types";

export interface BuildContextOptions {
  event: CommunicationEventType;
  customer?: Partial<CustomerContext> | null;
  invoice?: Partial<InvoiceContext> | null;
  payment?: Partial<PaymentContext> | null;
  statement?: Partial<StatementContext> | null;
  millingDocumentNumber?: string | null;
  millingStatus?: string | null;
  company?: CompanyProfile | null;
  language?: MessageLanguage;
}

export function buildUnifiedContext(options: BuildContextOptions): UnifiedCommunicationContext {
  const company = options.company ?? getCachedCompanyProfile();

  let customerCtx: CustomerContext | null = null;
  if (options.customer) {
    customerCtx = {
      id: options.customer.id || "",
      name: options.customer.name || "",
      phone: options.customer.phone || null,
      email: options.customer.email || null,
      balance: Number(options.customer.balance ?? 0),
      creditLimit: Number(options.customer.creditLimit ?? 0),
      preferredLanguage: options.customer.preferredLanguage,
      hasLedgerActivity: options.customer.hasLedgerActivity,
    };
  }

  let invoiceCtx: InvoiceContext | null = null;
  if (options.invoice) {
    invoiceCtx = {
      id: options.invoice.id || "",
      invoiceNumber: options.invoice.invoiceNumber || "",
      date: options.invoice.date || new Date().toISOString().split("T")[0],
      subtotal: Number(options.invoice.subtotal ?? 0),
      tax: Number(options.invoice.tax ?? 0),
      discount: Number(options.invoice.discount ?? 0),
      total: Number(options.invoice.total ?? 0),
      paid: Number(options.invoice.paid ?? 0),
      remaining: Number(options.invoice.remaining ?? 0),
      dueDate: options.invoice.dueDate,
      status: options.invoice.status,
      linesCount: options.invoice.linesCount,
    };
  }

  let paymentCtx: PaymentContext | null = null;
  if (options.payment) {
    paymentCtx = {
      id: options.payment.id,
      receiptNumber: options.payment.receiptNumber || "",
      date: options.payment.date || new Date().toISOString().split("T")[0],
      amount: Number(options.payment.amount ?? 0),
      method: options.payment.method || "نقداً",
      remainingBalance: options.payment.remainingBalance,
      notes: options.payment.notes,
      invoiceNumber: options.payment.invoiceNumber,
    };
  }

  let statementCtx: StatementContext | null = null;
  if (options.statement) {
    statementCtx = {
      periodLabel: options.statement.periodLabel || "كامل الفترة",
      openingBalance: Number(options.statement.openingBalance ?? 0),
      totalDebit: Number(options.statement.totalDebit ?? 0),
      totalCredit: Number(options.statement.totalCredit ?? 0),
      closingBalance: Number(options.statement.closingBalance ?? 0),
      transactionsCount: Number(options.statement.transactionsCount ?? 0),
    };
  }

  return {
    event: options.event,
    customer: customerCtx,
    company,
    invoice: invoiceCtx,
    payment: paymentCtx,
    statement: statementCtx,
    millingDocumentNumber: options.millingDocumentNumber,
    millingStatus: options.millingStatus,
    language: options.language,
  };
}

export function statementToContext(result: StatementResult): StatementContext {
  return {
    periodLabel: result.period.label,
    openingBalance: result.openingBalance,
    totalDebit: result.totalDebit,
    totalCredit: result.totalCredit,
    closingBalance: result.closingBalance,
    transactionsCount: result.transactions.length,
  };
}

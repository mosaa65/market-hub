/**
 * Statement Adapter — الخزينة / الصندوق (cash)
 *
 * يُبنى من الحركات النقدية الموجودة فعليًا في المشروع — بلا أي جدول جديد:
 *   customer_payments                 → وارد (debit)
 *   purchase_invoices.paid            → صادر (credit)
 *   expenses.amount                   → صادر (credit)
 *
 * شرط الدقة: تُحتسب فقط الدفعات غير النقدية؟ لا — القاعدة المحاسبية هنا:
 * كل حركة مرّت على الصندوق فعلًا. لذلك:
 *   - customer_payments: كل السدادات المُحصَّلة (نقدًا/بنكًا/شبكة) تُعدّ واردات صندوق.
 *   - purchase_invoices.paid: كل سداد لمورد يُعدّ صادرًا من الصندوق.
 *   - expenses: كل مصروف يُعدّ صادرًا من الصندوق.
 *
 * قراءة فقط — صفر تغيير في قاعدة البيانات.
 */

import { supabase } from "@/integrations/supabase/client";
import type { LedgerEntry, StatementEntity } from "../types";

export const CASH_ENTITY_ID = "treasury";

interface CustomerPaymentRow {
  id: string;
  customer_id: string;
  amount: number | null;
  payment_method: string | null;
  payment_date: string;
  note: string | null;
  created_at: string;
  customers: { name: string } | null;
}

interface PurchasePaidRow {
  id: string;
  invoice_number: string;
  supplier_id: string | null;
  total: number | null;
  paid: number | null;
  payment_method: string | null;
  created_at: string;
  suppliers: { name: string } | null;
}

interface ExpenseRow {
  id: string;
  amount: number | null;
  payment_method: string | null;
  expense_date: string;
  note: string | null;
  created_at: string;
  expense_categories: { name: string; name_ar: string | null } | null;
}

/** تحويل سداد عميل إلى وارد صندوق */
export function customerPaymentToCashEntry(
  row: CustomerPaymentRow,
  lang: "ar" | "en" = "ar",
): LedgerEntry {
  const who = row.customers?.name ?? (lang === "ar" ? "عميل" : "Customer");
  return {
    id: `cp:${row.id}`,
    // نستخدم created_at لأنه يحمل الوقت الفعلي، و payment_date تاريخ فقط
    occurredAt: row.created_at || `${row.payment_date}T00:00:00Z`,
    kind: "payment",
    debit: Number(row.amount ?? 0),
    credit: 0,
    reference: null,
    description: row.note || (lang === "ar" ? `تحصيل من ${who}` : `Collection from ${who}`),
    referenceId: row.id,
    referenceType: "customer_payment",
    meta: {
      entitySource: "customer_payments",
      paymentMethod: row.payment_method,
      counterparty: who,
      entityId: CASH_ENTITY_ID,
    },
  };
}

/** تحويل سداد مورد إلى صادر صندوق */
export function supplierPaymentToCashEntry(
  row: PurchasePaidRow,
  lang: "ar" | "en" = "ar",
): LedgerEntry | null {
  const paid = Number(row.paid ?? 0);
  if (paid <= 0) return null;
  const who = row.suppliers?.name ?? (lang === "ar" ? "مورد" : "Supplier");
  return {
    id: `pinv-cash:${row.id}`,
    occurredAt: row.created_at,
    kind: "payment",
    debit: 0,
    credit: paid,
    reference: row.invoice_number,
    description: lang === "ar" ? `سداد للمورد ${who}` : `Payment to ${who}`,
    referenceId: row.id,
    referenceType: "purchase_invoice",
    meta: {
      entitySource: "purchase_invoices.paid",
      paymentMethod: row.payment_method,
      counterparty: who,
      bundledWithInvoice: true,
      entityId: CASH_ENTITY_ID,
    },
  };
}

/** تحويل مصروف إلى صادر صندوق */
export function expenseToCashEntry(row: ExpenseRow, lang: "ar" | "en" = "ar"): LedgerEntry {
  const cat =
    (lang === "ar" ? row.expense_categories?.name_ar : null) ??
    row.expense_categories?.name ??
    (lang === "ar" ? "مصروف عام" : "General expense");
  return {
    id: `exp:${row.id}`,
    occurredAt: `${row.expense_date}T00:00:00Z`,
    kind: "expense",
    debit: 0,
    credit: Number(row.amount ?? 0),
    reference: null,
    description: row.note || cat,
    referenceId: row.id,
    referenceType: "expense",
    meta: {
      entitySource: "expenses",
      paymentMethod: row.payment_method,
      category: cat,
      entityId: CASH_ENTITY_ID,
    },
  };
}

export interface CashStatementData {
  entity: StatementEntity;
  entries: LedgerEntry[];
  cachedBalance: null;
  breakdown: {
    collections: number;
    supplierPayments: number;
    expenses: number;
  };
}

/**
 * كشف الخزينة. الترتيب محسوب في الـ Engine، لذلك نُعيد الحركات خامًا.
 * ملاحظة: تُدرج فقط حركات لها تاريخ صالح.
 */
export async function loadCashStatement(lang: "ar" | "en" = "ar"): Promise<CashStatementData> {
  const [paymentsRes, purchasesRes, expensesRes] = await Promise.all([
    supabase
      .from("customer_payments")
      .select(
        "id, customer_id, amount, payment_method, payment_date, note, created_at, customers(name)",
      )
      .order("created_at", { ascending: true }),
    supabase
      .from("purchase_invoices")
      .select(
        "id, invoice_number, supplier_id, total, paid, payment_method, created_at, suppliers(name)",
      )
      .gt("paid", 0)
      .order("created_at", { ascending: true }),
    supabase
      .from("expenses")
      .select(
        "id, amount, payment_method, expense_date, note, created_at, expense_categories(name,name_ar)",
      )
      .order("expense_date", { ascending: true }),
  ]);

  const entries: LedgerEntry[] = [];
  let collections = 0;
  let supplierPayments = 0;
  let expenses = 0;

  for (const row of (paymentsRes.data ?? []) as unknown as CustomerPaymentRow[]) {
    const entry = customerPaymentToCashEntry(row, lang);
    if (entry.debit > 0) collections += entry.debit;
    entries.push(entry);
  }
  for (const row of (purchasesRes.data ?? []) as unknown as PurchasePaidRow[]) {
    const entry = supplierPaymentToCashEntry(row, lang);
    if (!entry) continue;
    supplierPayments += entry.credit;
    entries.push(entry);
  }
  for (const row of (expensesRes.data ?? []) as unknown as ExpenseRow[]) {
    const entry = expenseToCashEntry(row, lang);
    if (entry.credit > 0) expenses += entry.credit;
    entries.push(entry);
  }

  const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

  return {
    entity: {
      id: CASH_ENTITY_ID,
      type: "cash",
      name: lang === "ar" ? "الصندوق والبنك" : "Cash & Bank",
      phone: null,
      email: null,
      address: null,
      creditLimit: null,
      cachedBalance: null,
    },
    entries,
    cachedBalance: null,
    breakdown: {
      collections: round2(collections),
      supplierPayments: round2(supplierPayments),
      expenses: round2(expenses),
    },
  };
}

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

interface SupplierPaymentRow {
  id: string;
  voucher_number?: string | null;
  supplier_id: string | null;
  amount: number | null;
  payment_method: string | null;
  payment_date: string;
  notes: string | null;
  created_at?: string | null;
  suppliers?: { name: string } | null;
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

/**
 * A payment recorded by the new expense module.
 *
 * This is the row that actually moved money. `public.expenses.amount` only ever
 * knew what was SPENT, never what was PAID — a distinction that did not exist
 * while every expense was assumed to be settled on the spot.
 */
interface ExpensePaymentRow {
  id: string;
  entry_id: string;
  amount: number | null;
  payment_method: string | null;
  payment_date: string;
  account_label: string | null;
  note: string | null;
  created_at: string;
  reversal_of: string | null;
  reversed_by: string | null;
  expense_entries: {
    reference: string;
    status: string;
    expense_date: string;
  } | null;
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

/** تحويل سند صرف مورد إلى صادر صندوق */
export function supplierVoucherToCashEntry(
  row: SupplierPaymentRow,
  lang: "ar" | "en" = "ar",
): LedgerEntry | null {
  const amt = Number(row.amount ?? 0);
  if (amt <= 0) return null;
  const who = row.suppliers?.name ?? (lang === "ar" ? "مورد" : "Supplier");
  const ref = row.voucher_number || row.id.slice(0, 8);
  return {
    id: `sp-cash:${row.id}`,
    occurredAt: row.created_at || `${row.payment_date}T00:00:00Z`,
    kind: "payment",
    debit: 0,
    credit: amt,
    reference: ref,
    description:
      row.notes ||
      (lang === "ar" ? `سند صرف للمورد ${who} (${ref})` : `Payment voucher to ${who} (${ref})`),
    referenceId: row.id,
    referenceType: "supplier_payment",
    meta: {
      entitySource: "supplier_payments",
      paymentMethod: row.payment_method,
      counterparty: who,
      voucherNumber: row.voucher_number,
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

/**
 * Converts a recorded expense payment into a cash movement.
 *
 * Two rules are enforced here, and both are the reason this function exists
 * rather than reusing `expenseToCashEntry`:
 *
 *  1. **A reversal nets to zero.** A reversed payment and its reversal row both
 *     stay in the table as evidence, but neither moves money any more, so both
 *     are dropped from the cash register. Including either one alone would show
 *     cash leaving twice or not at all.
 *
 *  2. **Only settled money leaves the drawer.** An accrued expense with no
 *     payment produces no entry at all — which is exactly what the old adapter
 *     got wrong when it treated every expense amount as a cash outflow.
 */
export function expensePaymentToCashEntry(
  row: ExpensePaymentRow,
  lang: "ar" | "en" = "ar",
): LedgerEntry | null {
  if (row.reversed_by || row.reversal_of) return null;

  const amount = Number(row.amount ?? 0);
  if (amount <= 0) return null;

  const reference = row.expense_entries?.reference ?? null;
  const label = lang === "ar" ? "سداد مصروف" : "Expense payment";

  return {
    id: `exppay:${row.id}`,
    // `created_at` carries the real time of the transaction; `payment_date` is
    // a date only and would sort every payment of a day at midnight.
    occurredAt: row.created_at,
    kind: "expense",
    debit: 0,
    credit: amount,
    reference,
    description: row.note || (reference ? `${label} ${reference}` : label),
    referenceId: row.id,
    referenceType: "expense_payment",
    meta: {
      entitySource: "expense_payments",
      paymentMethod: row.payment_method,
      account: row.account_label,
      expenseEntryId: row.entry_id,
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
  const [paymentsRes, purchasesRes, expensesRes, expensePaymentsRes, supplierPaymentsRes] =
    await Promise.all([
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
      // Legacy rows only. An expense migrated into the new module gets a mirrored
      // row whose `legacy_expense_id` points back here, and counting both would
      // charge the cash drawer twice for the same money.
      supabase
        .from("expenses")
        .select(
          "id, amount, payment_method, expense_date, note, created_at, expense_categories(name,name_ar)",
        )
        .order("expense_date", { ascending: true }),
      (supabase as any)
        .from("expense_payments")
        .select(
          "id, entry_id, amount, payment_method, payment_date, account_label, note, created_at, reversal_of, reversed_by, expense_entries(reference,status,expense_date)",
        )
        .order("created_at", { ascending: true }),
      (supabase as any)
        .from("supplier_payments")
        .select(
          "id, voucher_number, supplier_id, amount, payment_method, payment_date, notes, created_at, suppliers(name)",
        )
        .order("created_at", { ascending: true }),
    ]);

  /*
   * Rows that have been bridged into the new module are excluded from the
   * legacy pass. The bridge is one-way and additive, so without this filter a
   * migrated expense would appear once as its old self and once as its new
   * document's payment.
   */
  let bridgedLegacyIds = new Set<string>();
  const legacyRows = (expensesRes.data ?? []) as unknown as ExpenseRow[];

  if (legacyRows.length) {
    // Cast through `unknown`: `database.ts` is generated from the DEPLOYED
    // schema, so it cannot know about `expense_entries` until the migration is
    // applied and the types are regenerated. Casting only here — rather than
    // weakening the client type for the whole app — keeps every other query in
    // this file fully checked.
    const { data: bridged } = (await (supabase as any)
      .from("expense_entries")
      .select("legacy_expense_id")
      .not("legacy_expense_id", "is", null)) as {
      data: { legacy_expense_id: string | null }[] | null;
    };

    bridgedLegacyIds = new Set(
      (bridged ?? []).map((row) => row.legacy_expense_id).filter((id): id is string => Boolean(id)),
    );
  }

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
  for (const row of (supplierPaymentsRes?.data ?? []) as unknown as SupplierPaymentRow[]) {
    const entry = supplierVoucherToCashEntry(row, lang);
    if (!entry) continue;
    supplierPayments += entry.credit;
    entries.push(entry);
  }
  for (const row of legacyRows) {
    if (bridgedLegacyIds.has(row.id)) continue;
    const entry = expenseToCashEntry(row, lang);
    if (entry.credit > 0) expenses += entry.credit;
    entries.push(entry);
  }
  for (const row of (expensePaymentsRes.data ?? []) as unknown as ExpensePaymentRow[]) {
    const entry = expensePaymentToCashEntry(row, lang);
    if (!entry) continue;
    expenses += entry.credit;
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

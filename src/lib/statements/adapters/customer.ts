/**
 * Statement Adapter — العميل
 *
 * المصدر الأساسي: public.customer_ledger (الدفتر الموجود أصلًا في المشروع).
 * لا يُنشأ أي جدول أو عمود. قراءة فقط.
 *
 * ملاحظة مهمة: الجدول منشأ في migration 20260912140000 و يحتوي:
 *   entry_type IN ('sale','payment','return','adjustment','credit')
 *   debit, credit, occurred_at, reference_id, reference_type, source_key, note
 */

import { supabase } from "@/integrations/supabase/client";
import type { LedgerEntry, StatementEntity } from "../types";
import { customerLedgerTable } from "../untyped";

/** صفوف دفتر العميل كما تُقرأ من قاعدة البيانات */
interface CustomerLedgerRow {
  id: string;
  entry_type: string;
  debit: number | null;
  credit: number | null;
  occurred_at: string;
  note: string | null;
  reference_id: string | null;
  reference_type: string | null;
  source_key: string | null;
}

/**
 * خريطة أنواع قيود الدفتر إلى أنواع الحركات الموحّدة.
 * النوعان 'adjustment' و 'credit' يُوحَّدان إلى adjustment لأن كليهما تسوية
 * بلا أثر تشغيلي على الفاتورة — وهذا لا يحتاج أي تعديل في قاعدة البيانات.
 */
const ENTRY_TYPE_MAP: Record<string, LedgerEntry["kind"]> = {
  sale: "sale",
  payment: "payment",
  return: "return",
  adjustment: "adjustment",
  credit: "adjustment",
};

export function mapLedgerEntryType(entryType: string): LedgerEntry["kind"] {
  return ENTRY_TYPE_MAP[entryType] ?? "adjustment";
}

/** تحويل صف دفتر خام إلى حركة موحّدة (بلا أي حساب أرصدة) */
export function toLedgerEntry(row: CustomerLedgerRow): LedgerEntry {
  return {
    id: `ledger:${row.id}`,
    occurredAt: row.occurred_at,
    kind: mapLedgerEntryType(row.entry_type),
    debit: Number(row.debit ?? 0),
    credit: Number(row.credit ?? 0),
    reference: null, // يُملأ في مرحلة الإثراء
    description: row.note,
    referenceId: row.reference_id,
    referenceType: row.reference_type,
    meta: { sourceKey: row.source_key, ledgerId: row.id, entitySource: "customer_ledger" },
  };
}

/**
 * جلب مراجع الحركات (أرقام الفواتير والسندات) في نداءين فقط — لا N+1.
 * الحركات التي مرجعها فاتورة تُقرأ من sales_invoices،
 * والحركات التي مرجعها سند سداد تُقرأ من sales_invoices عبر invoice_id.
 */
async function enrichReferences(
  entries: LedgerEntry[],
  fallbackLabel: { receipt: string; entry: string },
): Promise<LedgerEntry[]> {
  const invoiceIds = Array.from(
    new Set(
      entries
        .filter((e) => e.referenceType === "sales_invoice" && e.referenceId)
        .map((e) => e.referenceId as string),
    ),
  );
  const paymentIds = Array.from(
    new Set(
      entries
        .filter((e) => e.referenceType === "customer_payment" && e.referenceId)
        .map((e) => e.referenceId as string),
    ),
  );

  const invoiceNumberById = new Map<string, string>();
  const methodByPaymentId = new Map<string, string>();
  const invoiceNumberByPaymentId = new Map<string, string>();

  if (invoiceIds.length > 0) {
    const { data } = await supabase
      .from("sales_invoices")
      .select("id, invoice_number")
      .in("id", invoiceIds);
    for (const row of data ?? []) invoiceNumberById.set(row.id, row.invoice_number);
  }

  if (paymentIds.length > 0) {
    const { data } = await supabase
      .from("customer_payments")
      .select("id, payment_method, invoice_id, sales_invoices(invoice_number)")
      .in("id", paymentIds);
    for (const row of (data ?? []) as any[]) {
      methodByPaymentId.set(row.id, row.payment_method);
      const invNo = row.sales_invoices?.invoice_number;
      if (invNo) invoiceNumberByPaymentId.set(row.id, invNo);
    }
  }

  return entries.map((entry) => {
    let reference = entry.reference;
    let paymentMethod = entry.meta?.paymentMethod as string | undefined;

    if (entry.referenceType === "sales_invoice" && entry.referenceId) {
      reference = invoiceNumberById.get(entry.referenceId) ?? null;
    } else if (entry.referenceType === "customer_payment" && entry.referenceId) {
      reference = invoiceNumberByPaymentId.get(entry.referenceId) ?? fallbackLabel.receipt;
      paymentMethod = methodByPaymentId.get(entry.referenceId) ?? paymentMethod;
    }

    return {
      ...entry,
      reference,
      meta: { ...(entry.meta ?? {}), paymentMethod },
    };
  });
}

export interface CustomerStatementData {
  entity: StatementEntity | null;
  entries: LedgerEntry[];
  /** الرصيد المخزَّن في customers.balance — للتحقق */
  cachedBalance: number | null;
  /** هل الدفتر يحتوي أي قيود أصلًا؟ */
  hasLedgerData: boolean;
}

/**
 * قراءة كامل كشف العميل: بيانات الجهة + الحركات + الرصيد المخزَّن.
 * ملاحظة: الرصيد المخزَّن يُقرأ مباشرة من customers.balance وهو cache
 * يُحدَّثه RPC — ولا نعتمد عليه في الحساب، بل للتحقق فقط.
 */
export async function loadCustomerStatement(
  customerId: string,
  lang: "ar" | "en" = "ar",
): Promise<CustomerStatementData> {
  const fallbackLabel = {
    receipt: lang === "ar" ? "سند قبض" : "Receipt",
    entry: lang === "ar" ? "قيد" : "Entry",
  };

  const [customerRes, ledgerRes] = await Promise.all([
    supabase
      .from("customers")
      .select("id, name, phone, email, address, credit_limit, balance")
      .eq("id", customerId)
      .maybeSingle(),
    customerLedgerTable<CustomerLedgerRow>()
      .select(
        "id, entry_type, debit, credit, occurred_at, note, reference_id, reference_type, source_key",
      )
      .eq("customer_id", customerId)
      .order("occurred_at", { ascending: true })
      .order("id", { ascending: true }),
  ]);

  const customer = customerRes.data;
  const entity: StatementEntity | null = customer
    ? {
        id: customer.id,
        type: "customer",
        name: customer.name,
        phone: customer.phone,
        email: customer.email,
        address: customer.address,
        creditLimit: Number(customer.credit_limit ?? 0),
        cachedBalance: Number(customer.balance ?? 0),
      }
    : null;

  const rows = (ledgerRes.data ?? []) as CustomerLedgerRow[];
  const baseEntries = rows.map(toLedgerEntry);
  const entries = await enrichReferences(baseEntries, fallbackLabel);

  return {
    entity,
    entries,
    cachedBalance: customer ? Number(customer.balance ?? 0) : null,
    hasLedgerData: rows.length > 0,
  };
}

/**
 * قراءة حركات عدة عملاء في نداء واحد — تُستخدم في كشف الديون وشاشات التجميع
 * بدل قراءة customers.balance المخزَّن.
 */
export async function loadAllCustomerLedgerEntries(): Promise<Map<string, LedgerEntry[]>> {
  const { data } = await customerLedgerTable<CustomerLedgerRow & { customer_id: string }>()
    .select(
      "id, customer_id, entry_type, debit, credit, occurred_at, note, reference_id, reference_type",
    )
    .order("occurred_at", { ascending: true })
    .order("id", { ascending: true });

  const map = new Map<string, LedgerEntry[]>();
  for (const row of (data ?? []) as (CustomerLedgerRow & { customer_id: string })[]) {
    const key = row.customer_id;
    if (!key) continue;
    const entry = toLedgerEntry(row);
    entry.meta = { ...(entry.meta ?? {}), entityId: key };
    const list = map.get(key);
    if (list) list.push(entry);
    else map.set(key, [entry]);
  }
  return map;
}

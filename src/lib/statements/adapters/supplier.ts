/**
 * Statement Adapter — المورد
 *
 * ⚠️ لا يوجد دفتر موردين في قاعدة البيانات (لا supplier_ledger ولا supplier_payments).
 * لذلك تُشتقّ الحركات من المستندات الموجودة فعليًا:
 *   purchase_invoices  → حركة توريد (credit) + سداد مرافق (debit = paid)
 *   purchase_returns   → حركة مرتجع (debit)
 *
 * القيد المعماري المعتمد (قرار المستخدم #2): نقبل هذا الاشتقاق مع وسم واضح
 * «سداد مرافق للفاتورة» لأن `purchase_invoices.paid` قيمة تراكمية بلا تاريخ سداد مستقل.
 *
 * قراءة فقط — صفر تغيير في قاعدة البيانات.
 */

import { supabase } from "@/integrations/supabase/client";
import type { LedgerEntry, StatementEntity } from "../types";

/** اتجاه المورد: credit = المستحق للمورد (علينا)، debit = ما سُدِّد/أُرجع */
export const SUPPLIER_PAID_TAG_AR = "سداد مرافق للفاتورة";
export const SUPPLIER_PAID_TAG_EN = "Payment bundled with invoice";

interface PurchaseInvoiceRow {
  id: string;
  invoice_number: string;
  supplier_id: string | null;
  total: number | null;
  paid: number | null;
  status: string | null;
  payment_method: string | null;
  note: string | null;
  created_at: string;
}

interface PurchaseReturnRow {
  id: string;
  return_number: string;
  supplier_id: string | null;
  invoice_id: string | null;
  total: number | null;
  note: string | null;
  created_at: string;
}

/**
 * تحويل فاتورة توريد إلى حركة واحدة.
 * الرصيد المستحق للمورد = total - paid (لأن جزءًا قد يكون مدفوعًا مقدَّمًا).
 * ونُولّد سطر سداد منفصل بقيمة paid مع وسم صريح حتى لا يُفهم كتاريخ سداد حقيقي.
 */
export function purchaseInvoiceToEntries(
  row: PurchaseInvoiceRow,
  lang: "ar" | "en" = "ar",
): LedgerEntry[] {
  const total = Number(row.total ?? 0);
  const paid = Number(row.paid ?? 0);
  const entries: LedgerEntry[] = [];

  if (total > 0) {
    entries.push({
      id: `pinv:${row.id}`,
      occurredAt: row.created_at,
      kind: "sale", // توريد
      debit: 0,
      credit: total,
      reference: row.invoice_number,
      description: row.note || (lang === "ar" ? "توريد بضاعة" : "Goods received"),
      referenceId: row.id,
      referenceType: "purchase_invoice",
      meta: { entitySource: "purchase_invoices", status: row.status },
    });
  }

  // سداد مُدمج داخل الفاتورة — بلا تاريخ سداد مستقل في قاعدة البيانات
  if (paid > 0 && paid <= total) {
    entries.push({
      id: `pinv-paid:${row.id}`,
      occurredAt: row.created_at,
      kind: "payment",
      debit: paid,
      credit: 0,
      reference: row.invoice_number,
      description: lang === "ar" ? SUPPLIER_PAID_TAG_AR : SUPPLIER_PAID_TAG_EN,
      referenceId: row.id,
      referenceType: "purchase_invoice",
      meta: {
        entitySource: "purchase_invoices.paid",
        derived: true,
        paymentMethod: row.payment_method,
        bundledWithInvoice: true,
      },
    });
  }

  // حالة نادرة: paid > total (دفعة مقدمة/إفراط) → نُظهر زيادة السداد كحركة مستقلة
  if (paid > total && total >= 0) {
    const extra = Number((paid - total).toFixed(2));
    entries.push({
      id: `pinv-overpaid:${row.id}`,
      occurredAt: row.created_at,
      kind: "payment",
      debit: extra,
      credit: 0,
      reference: row.invoice_number,
      description:
        lang === "ar" ? "دفعة زائدة عن قيمة الفاتورة" : "Payment exceeding invoice value",
      referenceId: row.id,
      referenceType: "purchase_invoice",
      meta: { entitySource: "purchase_invoices.paid", derived: true, overpayment: true },
    });
  }

  return entries;
}

/** تحويل مرتجع مشتريات إلى حركة واحدة (تخفيض المستحق للمورد) */
export function purchaseReturnToEntries(
  row: PurchaseReturnRow,
  lang: "ar" | "en" = "ar",
): LedgerEntry {
  return {
    id: `pret:${row.id}`,
    occurredAt: row.created_at,
    kind: "return",
    debit: Number(row.total ?? 0),
    credit: 0,
    reference: row.return_number,
    description: row.note || (lang === "ar" ? "مرتجع مشتريات" : "Purchase return"),
    referenceId: row.id,
    referenceType: "purchase_return",
    meta: { entitySource: "purchase_returns" },
  };
}

export interface SupplierStatementData {
  entity: StatementEntity | null;
  entries: LedgerEntry[];
  cachedBalance: number | null;
  /** هل البيانات مُشتقّة (لا يوجد دفتر موردين)؟ */
  derived: boolean;
}

export async function loadSupplierStatement(
  supplierId: string,
  lang: "ar" | "en" = "ar",
): Promise<SupplierStatementData> {
  const [supplierRes, invoiceRes, returnRes] = await Promise.all([
    supabase
      .from("suppliers")
      .select("id, name, phone, email, address, balance")
      .eq("id", supplierId)
      .maybeSingle(),
    supabase
      .from("purchase_invoices")
      .select(
        "id, invoice_number, supplier_id, total, paid, status, payment_method, note, created_at",
      )
      .eq("supplier_id", supplierId)
      .order("created_at", { ascending: true }),
    supabase
      .from("purchase_returns")
      .select("id, return_number, supplier_id, invoice_id, total, note, created_at")
      .eq("supplier_id", supplierId)
      .order("created_at", { ascending: true }),
  ]);

  const supplier = supplierRes.data;
  const entity: StatementEntity | null = supplier
    ? {
        id: supplier.id,
        type: "supplier",
        name: supplier.name,
        phone: supplier.phone,
        email: supplier.email,
        address: supplier.address,
        creditLimit: null,
        cachedBalance: Number(supplier.balance ?? 0),
      }
    : null;

  const entries: LedgerEntry[] = [];
  for (const row of (invoiceRes.data ?? []) as PurchaseInvoiceRow[]) {
    entries.push(...purchaseInvoiceToEntries(row, lang));
  }
  for (const row of (returnRes.data ?? []) as PurchaseReturnRow[]) {
    entries.push(purchaseReturnToEntries(row, lang));
  }

  return {
    entity,
    entries,
    cachedBalance: supplier ? Number(supplier.balance ?? 0) : null,
    derived: true,
  };
}

/** قراءة حركات كل الموردين في نداءين — لكشف الديون الدائنة */
export async function loadAllSupplierEntries(
  lang: "ar" | "en" = "ar",
): Promise<Map<string, LedgerEntry[]>> {
  const [invoiceRes, returnRes] = await Promise.all([
    supabase
      .from("purchase_invoices")
      .select(
        "id, invoice_number, supplier_id, total, paid, status, payment_method, note, created_at",
      )
      .order("created_at", { ascending: true }),
    supabase
      .from("purchase_returns")
      .select("id, return_number, supplier_id, invoice_id, total, note, created_at")
      .order("created_at", { ascending: true }),
  ]);

  const map = new Map<string, LedgerEntry[]>();
  const push = (supplierId: string, entry: LedgerEntry) => {
    entry.meta = { ...(entry.meta ?? {}), entityId: supplierId };
    const list = map.get(supplierId);
    if (list) list.push(entry);
    else map.set(supplierId, [entry]);
  };

  for (const row of (invoiceRes.data ?? []) as PurchaseInvoiceRow[]) {
    if (!row.supplier_id) continue;
    for (const entry of purchaseInvoiceToEntries(row, lang)) push(row.supplier_id, entry);
  }
  for (const row of (returnRes.data ?? []) as PurchaseReturnRow[]) {
    if (!row.supplier_id) continue;
    push(row.supplier_id, purchaseReturnToEntries(row, lang));
  }

  return map;
}

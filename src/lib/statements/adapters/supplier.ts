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
import { rawRest } from "../untyped";
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
  /** بنود الفاتورة — اختيارية، تُجلب لتفصيل القيد فقط */
  purchase_invoice_items?: InvoiceItemRow[] | null;
}

/** بند فاتورة شراء — للتفصيل «ماذا اشترى وكم الكمية» */
interface InvoiceItemRow {
  id: string;
  quantity: number | null;
  unit_cost: number | null;
  tax: number | null;
  total: number | null;
  products: { name: string; name_ar: string | null; sku: string | null } | null;
}

/** صفوف بنود الفواتير مقسّمة على معرّف الفاتورة */
type InvoiceItemsMap = Map<string, InvoiceItemRow[]>;

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
  items: InvoiceItemRow[] = [],
): LedgerEntry[] {
  const total = Number(row.total ?? 0);
  const paid = Number(row.paid ?? 0);
  const entries: LedgerEntry[] = [];
  const itemLines = normalizeInvoiceItems(items);

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
      meta: {
        entitySource: "purchase_invoices",
        status: row.status,
        paymentMethod: row.payment_method,
        note: row.note,
        itemCount: itemLines.length,
        // تفاصيل الفاتورة: ماذا اشترى وكم الكمية وسعر الوحدة
        items: itemLines,
      },
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
        itemCount: itemLines.length,
        items: itemLines,
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
    meta: {
      entitySource: "purchase_returns",
      note: row.note,
      invoiceId: row.invoice_id,
    },
  };
}

/**
 * تنظيف بنود الفاتورة — يتخطى الصفوف بلا كمية/بلا منتج ويوحّد الشكل.
 * الغرض: عرض «ماذا اشترى وكم الكمية» داخل تفصيل القيد.
 */
function normalizeInvoiceItems(items: InvoiceItemRow[] | null | undefined) {
  return (items ?? [])
    .filter((item) => item && Number(item.quantity ?? 0) > 0)
    .map((item) => ({
      id: item.id,
      name: item.products?.name ?? null,
      nameAr: item.products?.name_ar ?? null,
      sku: item.products?.sku ?? null,
      quantity: Number(item.quantity ?? 0),
      unitCost: Number(item.unit_cost ?? 0),
      total: Number(item.total ?? 0),
    }));
}

/** تصنيف بنود كل فاتورة على معرّفها */
function groupItemsByInvoice(rows: Record<string, unknown>[]): InvoiceItemsMap {
  const map: InvoiceItemsMap = new Map();
  for (const row of rows as unknown as (InvoiceItemRow & { invoice_id: string })[]) {
    if (!row?.invoice_id) continue;
    const list = map.get(row.invoice_id);
    if (list) list.push(row);
    else map.set(row.invoice_id, [row]);
  }
  return map;
}

/** أعمدة فاتورة الشراء كما يقرأها هذا المحوّل */
const PURCHASE_INVOICE_COLUMNS =
  "id,invoice_number,supplier_id,total,paid,status,payment_method,note,created_at";
const PURCHASE_RETURN_COLUMNS = "id,return_number,supplier_id,invoice_id,total,note,created_at";

/**
 * قراءة فواتير/مرتجعات المورد عبر الوسيط `raw-rest`.
 * السبب: تفادي تلف معاملات الاستعلام (`eq.` النصية) من إضافات/بروكسيات
 * المتصفح التي تُحمّل قيمًا دخيلة مثل "treasury" فتُفشل الطلب بـ 400.
 */
async function fetchSupplierDocuments(
  supplierId?: string,
): Promise<[PurchaseInvoiceRow[], PurchaseReturnRow[], InvoiceItemsMap]> {
  const eq = supplierId ? `&supplier_id=eq.${encodeURIComponent(supplierId)}` : "";
  const [invoices, returns] = await Promise.all([
    rawRest<PurchaseInvoiceRow>("purchase_invoices", {
      columns: PURCHASE_INVOICE_COLUMNS,
      query: `select=${PURCHASE_INVOICE_COLUMNS}${eq}&order=created_at.asc`,
    }),
    rawRest<PurchaseReturnRow>("purchase_returns", {
      columns: PURCHASE_RETURN_COLUMNS,
      query: `select=${PURCHASE_RETURN_COLUMNS}${eq}&order=created_at.asc`,
    }),
  ]);

  // بنود الفواتير — للتفصيل فقط، وفشلها لا يُسقط الكشف
  let items: InvoiceItemsMap = new Map();
  try {
    const invoiceIds = invoices.map((row) => row.id).filter(Boolean);
    if (invoiceIds.length > 0) {
      const itemsColumns = "id,invoice_id,quantity,unit_cost,tax,total,products(name,name_ar,sku)";
      const rows = await rawRest<Record<string, unknown>>("purchase_invoice_items", {
        columns: itemsColumns,
        query: `select=${itemsColumns}&invoice_id=in.(${invoiceIds.join(",")})`,
      });
      items = groupItemsByInvoice(rows);
    }
  } catch {
    items = new Map();
  }

  return [invoices, returns, items];
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
  const supplierRes = await supabase
    .from("suppliers")
    .select("id, name, phone, email, address, balance")
    .eq("id", supplierId)
    .maybeSingle();

  const [invoiceRows, returnRows, itemsByInvoice] = await fetchSupplierDocuments(supplierId);

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
  for (const row of invoiceRows) {
    entries.push(...purchaseInvoiceToEntries(row, lang, itemsByInvoice.get(row.id) ?? []));
  }
  for (const row of returnRows) {
    entries.push(purchaseReturnToEntries(row, lang));
  }

  return {
    entity,
    entries,
    cachedBalance: supplier ? Number(supplier.balance ?? 0) : null,
    derived: true,
  };
}

/** قراءة حركات كل الموردين — لكشف الديون الدائنة */
export async function loadAllSupplierEntries(
  lang: "ar" | "en" = "ar",
): Promise<Map<string, LedgerEntry[]>> {
  const [invoiceRows, returnRows, itemsByInvoice] = await fetchSupplierDocuments();

  const map = new Map<string, LedgerEntry[]>();
  const push = (supplierId: string, entry: LedgerEntry) => {
    entry.meta = { ...(entry.meta ?? {}), entityId: supplierId };
    const list = map.get(supplierId);
    if (list) list.push(entry);
    else map.set(supplierId, [entry]);
  };

  for (const row of invoiceRows) {
    if (!row.supplier_id) continue;
    for (const entry of purchaseInvoiceToEntries(row, lang, itemsByInvoice.get(row.id) ?? [])) {
      push(row.supplier_id, entry);
    }
  }
  for (const row of returnRows) {
    if (!row.supplier_id) continue;
    push(row.supplier_id, purchaseReturnToEntries(row, lang));
  }

  return map;
}

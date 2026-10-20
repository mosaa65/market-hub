/**
 * Market-Hub ERP — Custody data layer (the simplified mill).
 *
 * One table (custody_ledger), one line per movement, and the balance is always
 * derived — never stored. Every write goes through an atomic RPC; the browser
 * has no INSERT on the table (R-23).
 *
 * The three concepts this module keeps apart, on purpose:
 *   custodyIntake()    customer grain arrives      → stock impact: NONE
 *   custodyMilling()   grain is milled for someone → stock impact: NONE
 *   custodyDelivery()  goods leave to the customer → stock impact: NONE
 *
 * A mill that sells its own flour does that through the ordinary sales screens.
 * Nothing here touches grain stock — that is the whole point of the module.
 *
 * المرجع: docs/milling/00_خطة_التبسيط_المعتمدة.md
 */

import { supabase } from "@/integrations/supabase/client";
import { paymentMethodLabel } from "@/lib/payments/payment-methods";
import { formatFormalDateTime } from "@/lib/format-preferences";
import type { UnifiedDocumentData } from "@/lib/templates/types";

/* The generated types do not know the custody schema yet. Widening the global
 * Database type for one feature would hide real errors elsewhere, so we keep a
 * single narrow, documented escape hatch here. */
const db = supabase as any;

/* ------------------------------------------------------------------ types */

export type CustodyEntryType = "INTAKE" | "MILLING" | "DELIVERY" | "ADJUSTMENT";

export interface ProductOption {
  id: string;
  sku: string;
  name: string;
  name_ar: string | null;
  item_class: string;
  sale_price: number;
  cost_price?: number | null;
  /** سعة العبوة بالكجم إن كان الصنف معبّأً — تُستخدم لاحتساب الوزن تلقائياً. */
  package_weight_kg: number | null;
}

export interface CustodyBalance {
  customer_id: string;
  warehouse_id: string;
  item_id: string;
  sku: string;
  name_ar: string;
  item_class: string;
  bags_balance: number;
  kg_balance: number;
}

export interface CustodyStatementRow {
  customer_id: string;
  customer_name_ar: string;
  warehouse_id: string;
  warehouse_name_ar: string;
  item_id: string;
  sku: string;
  item_name_ar: string;
  item_class: string;
  received_bags: number;
  received_kg: number;
  issued_bags: number;
  issued_kg: number;
  remaining_bags: number;
  remaining_kg: number;
  last_movement_at: string;
}

export interface CustodyMoneyRow {
  custody_entry_id: string;
  customer_id: string;
  customer_name_ar: string;
  doc_number: string;
  created_at: string;
  invoice_id: string;
  invoice_number: string;
  status: string;
  subtotal: number;
  tax: number;
  discount: number;
  total: number;
  paid: number;
  outstanding: number;
}

export interface CustodyLossRow {
  customer_id: string;
  customer_name_ar: string;
  warehouse_id: string;
  warehouse_name_ar: string;
  item_id: string;
  grain_name_ar: string;
  milled_bags: number;
  milled_kg: number;
  produced_bags: number;
  produced_kg: number;
  detected_loss_kg: number;
  loss_status: "OK" | "REVIEW";
}

export interface CustodyLine {
  itemId: string;
  bags: number;
  kg: number;
}

/** مستند خدمة موحّد: أمانة العميل وفاتورة أجوره في مرجع واحد. */
export interface MillingServiceDocument {
  id: string;
  document_number: string;
  customer_id: string;
  warehouse_id: string;
  sales_invoice_id: string;
  status: "RECEIVED" | "PROCESSED" | "DELIVERED";
  received_at: string;
  processed_at: string | null;
  delivered_at: string | null;
  /** P1-1: أساس التسعير المسجَّل (PER_BAG أو PER_KG). */
  billing_basis?: string | null;
  /** P1-1: سعر الوحدة المتعاقد عليه (للكيس أو للكيلو). */
  fee_per_unit?: number | null;
  /** P1-1: الكمية المسعّرة (عدد الأكياس أو الكيلوجرامات). */
  fee_quantity?: number | null;
  customers?: { name: string; phone: string | null } | null;
  warehouses?: { name: string; name_ar: string | null } | null;
  sales_invoices?: {
    invoice_number: string;
    subtotal?: number;
    discount?: number;
    total: number;
    paid: number;
    payment_method: string | null;
    payment_status: string;
  } | null;
}

export interface MillingServiceDocumentCreated {
  document_id: string;
  document_number: string;
  invoice_id: string;
  invoice_number: string;
  billing_basis?: "PER_BAG" | "PER_KG" | null;
  fee_per_unit?: number | null;
  fee_quantity?: number | null;
}

export interface MillingDocumentLine {
  id: string;
  entry_type: CustodyEntryType;
  item_id: string;
  item_name_ar: string;
  item_sku: string;
  item_class: string;
  package_weight_kg: number | null;
  doc_number: string;
  bags_in: number;
  bags_out: number;
  kg_in: number;
  kg_out: number;
  notes: string | null;
  created_at: string;
}

export interface MillingDocumentDetails extends MillingServiceDocument {
  lines: MillingDocumentLine[];
  intakeGrain: {
    itemId: string;
    nameAr: string;
    packageWeightKg: number | null;
    bagsReceived: number;
    kgReceived: number;
    bagsMilled: number;
    kgMilled: number;
    bagsRemaining: number;
    kgRemaining: number;
  } | null;
  outputsSummary: {
    itemId: string;
    nameAr: string;
    itemClass: string;
    bagsProduced: number;
    kgProduced: number;
    bagsDelivered: number;
    kgDelivered: number;
    bagsRemaining: number;
    kgRemaining: number;
  }[];
}

export interface OpResult<T = string> {
  ok: boolean;
  id?: T;
  data?: T;
  message?: string;
}

/* --------------------------------------------------------- label helpers */

export function translateCustodyError(msg: string): string {
  if (!msg) return "حدث خطأ غير متوقع في معالجة العملية.";
  if (msg.includes("balance") && msg.includes("less than"))
    return "الكمية المطلوبة أكبر من رصيد العميل المتبقي.";
  if (msg.includes("RAW_MATERIAL")) return "صنف الاستلام يجب أن يكون حبوباً خاماً.";
  if (msg.includes("FINISHED_GOOD"))
    return "صنف الناتج يجب أن يكون منتجاً نهائياً أو ناتجاً جانبياً.";
  if (msg.includes("reason is required")) return "سبب التعديل إلزامي.";
  if (msg.includes("Customer, warehouse")) return "يرجى تحديد العميل والمخزن والصنف.";
  if (msg.includes("Not authenticated")) return "يجب تسجيل الدخول أولاً.";
  if (msg.includes("not permitted")) return "لا تملك صلاحية هذه العملية.";
  return msg;
}

/* ------------------------------------------------------------- item reads */

/** حبوب خام للقوائم — من القاعدة لا من مصفوفات الكود. */
export async function fetchGrainItems(): Promise<ProductOption[]> {
  const { data, error } = await db
    .from("products")
    .select("id, sku, name, name_ar, item_class, sale_price, cost_price, package_weight_kg")
    .eq("item_class", "RAW_MATERIAL")
    .eq("is_active", true)
    .order("name_ar");

  if (error) throw error;
  return (data ?? []) as ProductOption[];
}

/** نواتج (منتجات نهائية + نواتج جانبية). */
export async function fetchOutputItems(): Promise<ProductOption[]> {
  const { data, error } = await db
    .from("products")
    .select("id, sku, name, name_ar, item_class, sale_price, cost_price, package_weight_kg")
    .in("item_class", ["FINISHED_GOOD", "BY_PRODUCT"])
    .eq("is_active", true)
    .order("name_ar");

  if (error) throw error;
  return (data ?? []) as ProductOption[];
}

/** صنف الأجور الخدمي — سعره هو مصدر السعر الوحيد (ق5). */
export async function fetchServiceItem(): Promise<ProductOption | null> {
  // م5: جلب خدمة أجور الطحن بدقة (بالكود أو الاسم) وتجنب الترتيب العشوائي حسب UUID
  const { data, error } = await db
    .from("products")
    .select("id, sku, name, name_ar, item_class, sale_price, package_weight_kg")
    .eq("item_class", "SERVICE")
    .eq("is_active", true);

  if (error) throw error;
  const list = (data ?? []) as ProductOption[];
  if (list.length === 0) return null;

  // تفضيل خدمة أجور الطحن المخصصة
  const millingService = list.find(
    (p) =>
      p.sku?.toUpperCase() === "SRV-MILL" ||
      p.sku?.toUpperCase().includes("MILL") ||
      (p.name_ar && (p.name_ar.includes("طحن") || p.name_ar.includes("أجور"))) ||
      (p.name && p.name.toLowerCase().includes("milling")),
  );

  return millingService || list[0];
}

/**
 * سعة العبوة الرسمية (بالكجم) لصنف من القاعدة — مصدر واحد لا يُدخل في الواجهة.
 * منتج بلا سعة أو بغير وزن يُعيد null والواجهة تعامل الوزن يدوياً.
 */
export function capacityKgOf(
  item: ProductOption | { package_weight_kg?: number | null } | null | undefined,
): number | null {
  const v = Number(item?.package_weight_kg ?? 0);
  return Number.isFinite(v) && v > 0 ? v : null;
}

/* -------------------------------------------------------------- balances */

export async function fetchCustodyBalances(
  customerId?: string,
  warehouseId?: string,
): Promise<CustodyBalance[]> {
  let q = db.from("custody_balances").select("*").order("name_ar");
  if (customerId) q = q.eq("customer_id", customerId);
  if (warehouseId) q = q.eq("warehouse_id", warehouseId);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as CustodyBalance[];
}

/* ------------------------------------------------------------ the writes */

export interface CustodyIntakeInput {
  customerId: string;
  warehouseId: string;
  itemId: string;
  bags: number;
  kg: number;
  notes?: string;
}

export async function custodyIntake(input: CustodyIntakeInput): Promise<OpResult> {
  if (!input.customerId) return { ok: false, message: "اختر العميل صاحب الأمانات." };
  if (!input.warehouseId) return { ok: false, message: "اختر المستودع." };
  if (!input.itemId) return { ok: false, message: "اختر صنف الحبوب." };
  if ((input.bags ?? 0) <= 0 && (input.kg ?? 0) <= 0) {
    return { ok: false, message: "سجّل عدد الأكياس أو الوزن على الأقل." };
  }

  const { data, error } = await db.rpc("custody_intake", {
    _customer_id: input.customerId,
    _warehouse_id: input.warehouseId,
    _item_id: input.itemId,
    _bags: input.bags ?? 0,
    _kg: input.kg ?? 0,
    _notes: input.notes ?? null,
  });
  if (error) return { ok: false, message: translateCustodyError(error.message) };
  return { ok: true, id: data as string };
}

/**
 * ينشئ من كاونتر المطحنة عملية واحدة حقيقية: استلام أمانة + فاتورة مبيعات
 * رسمية + أثر الذمة عند وجود آجل. لا يوجد ربط فاتورة لاحق.
 */
export async function createMillingServiceDocument(input: {
  customerId: string;
  warehouseId: string;
  grainItemId: string;
  bags: number;
  kg: number;
  serviceItemId: string;
  serviceUnitPrice: number;
  discount?: number;
  paymentMethod: string;
  paid: number;
  notes?: string;
}): Promise<OpResult<MillingServiceDocumentCreated>> {
  if (!input.customerId || !input.warehouseId || !input.grainItemId || !input.serviceItemId) {
    return { ok: false, message: "اختر العميل والمخزن والحبوب وخدمة الطحن." };
  }
  if ((input.bags ?? 0) <= 0 && (input.kg ?? 0) <= 0) {
    return { ok: false, message: "سجّل عدد الأكياس أو الوزن على الأقل." };
  }
  if ((input.serviceUnitPrice ?? 0) < 0 || (input.discount ?? 0) < 0 || (input.paid ?? 0) < 0) {
    return { ok: false, message: "السعر والخصم والمدفوع لا يمكن أن تكون سالبة." };
  }

  const { data, error } = await db.rpc("create_milling_service_document", {
    _customer_id: input.customerId,
    _warehouse_id: input.warehouseId,
    _grain_item_id: input.grainItemId,
    _bags: input.bags ?? 0,
    _kg: input.kg ?? 0,
    _service_item_id: input.serviceItemId,
    _service_unit_price: input.serviceUnitPrice ?? 0,
    _discount: input.discount ?? 0,
    _payment_method: input.paymentMethod,
    _paid: input.paid ?? 0,
    _notes: input.notes ?? null,
  });
  if (error) return { ok: false, message: translateCustodyError(error.message) };
  return { ok: true, data: data as MillingServiceDocumentCreated };
}

export async function fetchMillingServiceDocument(
  documentId: string,
): Promise<MillingServiceDocument | null> {
  if (!documentId) return null;
  const { data, error } = await db
    .from("milling_service_documents")
    .select(
      `id, document_number, customer_id, warehouse_id, sales_invoice_id, status,
       received_at, processed_at, delivered_at, billing_basis, fee_per_unit, fee_quantity,
       customers(name, phone), warehouses(name, name_ar),
       sales_invoices(invoice_number, subtotal, discount, total, paid, payment_method, payment_status)`,
    )
    .eq("id", documentId)
    .maybeSingle();
  if (error) throw error;
  return (data ?? null) as MillingServiceDocument | null;
}

export async function fetchMillingDocuments(options?: {
  customerId?: string;
  status?: string;
  search?: string;
}): Promise<MillingServiceDocument[]> {
  let q = db
    .from("milling_service_documents")
    .select(
      `id, document_number, customer_id, warehouse_id, sales_invoice_id, status,
       received_at, processed_at, delivered_at, created_at, billing_basis, fee_per_unit, fee_quantity,
       customers(name, phone), warehouses(name, name_ar),
       sales_invoices(invoice_number, subtotal, discount, total, paid, payment_method, payment_status)`,
    )
    .order("created_at", { ascending: false })
    .limit(100);

  if (options?.customerId) {
    q = q.eq("customer_id", options.customerId);
  }
  if (options?.status && options.status !== "ALL") {
    q = q.eq("status", options.status);
  }

  const { data, error } = await q;
  if (error) throw error;
  let list = (data ?? []) as MillingServiceDocument[];
  if (options?.search?.trim()) {
    const s = options.search.trim().toLowerCase();
    list = list.filter(
      (d) =>
        (d.document_number || "").toLowerCase().includes(s) ||
        (d.customers?.name || "").toLowerCase().includes(s) ||
        (d.sales_invoices?.invoice_number || "").toLowerCase().includes(s),
    );
  }
  return list;
}

export async function fetchMillingDocumentDetails(
  documentId: string,
): Promise<MillingDocumentDetails | null> {
  if (!documentId) return null;

  const doc = await fetchMillingServiceDocument(documentId);
  if (!doc) return null;

  const { data: rawLines, error } = await db
    .from("custody_ledger")
    .select(
      `id, entry_type, item_id, doc_number, bags_in, bags_out, kg_in, kg_out, notes, created_at,
       products(name, name_ar, sku, item_class, package_weight_kg)`,
    )
    .eq("milling_document_id", documentId)
    .order("created_at", { ascending: true });

  if (error) throw error;

  const lines: MillingDocumentLine[] = (rawLines ?? []).map((r: any) => ({
    id: r.id,
    entry_type: r.entry_type,
    item_id: r.item_id,
    item_name_ar: r.products?.name_ar || r.products?.name || "—",
    item_sku: r.products?.sku || "",
    item_class: r.products?.item_class || "",
    package_weight_kg: r.products?.package_weight_kg ?? null,
    doc_number: r.doc_number,
    bags_in: Number(r.bags_in ?? 0),
    bags_out: Number(r.bags_out ?? 0),
    kg_in: Number(r.kg_in ?? 0),
    kg_out: Number(r.kg_out ?? 0),
    notes: r.notes,
    created_at: r.created_at,
  }));

  // 1) Intake grain summary
  const intakeLines = lines.filter((l) => l.entry_type === "INTAKE");
  let intakeGrain: MillingDocumentDetails["intakeGrain"] = null;
  if (intakeLines.length > 0) {
    const firstIntake = intakeLines[0];
    const totalBagsIn = intakeLines.reduce((acc, l) => acc + l.bags_in, 0);
    const totalKgIn = intakeLines.reduce((acc, l) => acc + l.kg_in, 0);
    const milledLines = lines.filter(
      (l) =>
        l.entry_type === "MILLING" &&
        l.item_id === firstIntake.item_id &&
        l.bags_out + l.kg_out > 0,
    );
    const totalBagsMilled = milledLines.reduce((acc, l) => acc + l.bags_out, 0);
    const totalKgMilled = milledLines.reduce((acc, l) => acc + l.kg_out, 0);

    const derivedCapacity =
      firstIntake.package_weight_kg ||
      (totalBagsIn > 0 && totalKgIn > 0 ? Math.round(totalKgIn / totalBagsIn) : null);

    intakeGrain = {
      itemId: firstIntake.item_id,
      nameAr: firstIntake.item_name_ar,
      packageWeightKg: derivedCapacity,
      bagsReceived: totalBagsIn,
      kgReceived: totalKgIn,
      bagsMilled: totalBagsMilled,
      kgMilled: totalKgMilled,
      bagsRemaining: Math.max(0, totalBagsIn - totalBagsMilled),
      kgRemaining: Math.max(0, totalKgIn - totalKgMilled),
    };
  }

  // 2) Outputs summary
  const outputLines = lines.filter(
    (l) => l.entry_type === "MILLING" && (l.bags_in > 0 || l.kg_in > 0),
  );
  const outputsByItem = new Map<
    string,
    {
      itemId: string;
      nameAr: string;
      itemClass: string;
      bagsProduced: number;
      kgProduced: number;
    }
  >();

  for (const o of outputLines) {
    const curr = outputsByItem.get(o.item_id) ?? {
      itemId: o.item_id,
      nameAr: o.item_name_ar,
      itemClass: o.item_class,
      bagsProduced: 0,
      kgProduced: 0,
    };
    curr.bagsProduced += o.bags_in;
    curr.kgProduced += o.kg_in;
    outputsByItem.set(o.item_id, curr);
  }

  const deliveryLines = lines.filter((l) => l.entry_type === "DELIVERY");
  const outputsSummary = Array.from(outputsByItem.values()).map((out) => {
    const itemDeliveries = deliveryLines.filter((d) => d.item_id === out.itemId);
    const bagsDelivered = itemDeliveries.reduce((acc, d) => acc + d.bags_out, 0);
    const kgDelivered = itemDeliveries.reduce((acc, d) => acc + d.kg_out, 0);
    return {
      itemId: out.itemId,
      nameAr: out.nameAr,
      itemClass: out.itemClass,
      bagsProduced: out.bagsProduced,
      kgProduced: out.kgProduced,
      bagsDelivered,
      kgDelivered,
      bagsRemaining: Math.max(0, out.bagsProduced - bagsDelivered),
      kgRemaining: Math.max(0, out.kgProduced - kgDelivered),
    };
  });

  return {
    ...doc,
    lines,
    intakeGrain,
    outputsSummary,
  };
}

export function buildMillingDocumentUnifiedDoc(
  details: MillingDocumentDetails,
  stage: "intake" | "milled" | "delivery" = "intake",
): UnifiedDocumentData {
  const inv = details.sales_invoices as any;
  const subtotal = Number(inv?.subtotal ?? inv?.total ?? 0);
  const discount = Number(inv?.discount ?? 0);
  const total = Number(inv?.total ?? Math.max(0, subtotal - discount));
  const paid = Number(inv?.paid ?? 0);
  const remaining = Math.max(0, total - paid);
  const title =
    stage === "delivery"
      ? "سند تسليم أمانة وفاتورة أجور"
      : stage === "milled"
        ? "فاتورة أجور وسند استلام أمانة (محدّث بالنواتج)"
        : "فاتورة أجور وسند استلام أمانة";

  const lines: any[] = [];

  // سطر الاستلام
  if (details.intakeGrain) {
    const g = details.intakeGrain;
    const bagSize =
      g.packageWeightKg ||
      (g.bagsReceived > 0 && g.kgReceived > 0 ? Math.round(g.kgReceived / g.bagsReceived) : 50);
    lines.push({
      product: `حبوب مستلمة: ${g.nameAr}`,
      qty: g.bagsReceived > 0 ? g.bagsReceived : g.kgReceived,
      unit: g.bagsReceived > 0 ? "كيس" : "كجم",
      price: 0,
      total: 0,
      remainingKg: g.kgReceived,
      note:
        g.bagsReceived > 0
          ? `${g.bagsReceived} كيس سعة ${bagSize} كجم (إجمالي ${g.kgReceived.toLocaleString()} كجم)`
          : `إجمالي ${g.kgReceived.toLocaleString()} كجم`,
    });
  }

  // أسطر النواتج إن كانت المرحلة طحن أو تسليم
  if (stage !== "intake" && details.outputsSummary.length > 0) {
    for (const out of details.outputsSummary) {
      const deliveredBags = out.bagsDelivered || 0;
      const deliveredKg = out.kgDelivered || 0;
      lines.push({
        product: `ناتج طحن: ${out.nameAr}`,
        qty:
          stage === "delivery" && deliveredBags > 0
            ? deliveredBags
            : out.bagsProduced > 0
              ? out.bagsProduced
              : out.kgProduced,
        unit: out.bagsProduced > 0 ? "كيس" : "كجم",
        previousQty: out.bagsProduced,
        remainingQty: out.bagsRemaining,
        previousKg: out.kgProduced,
        remainingKg: out.kgRemaining,
        currentKg: deliveredKg,
        price: 0,
        total: 0,
        note: `المسجل: ${out.bagsProduced} كيس | المسلّم: ${out.bagsDelivered} كيس | المتبقي: ${out.bagsRemaining} كيس`,
      });
    }
  }

  // سطر فاتورة أجور الطحن الرسمية — P1-1: أساس التسعير من المستند نفسه،
  // لا من قسمة الإجمالي على عدد الأكياس (كان يعطي رقماً غير متعاقد عليه).
  const bagCount = details.intakeGrain?.bagsReceived || 0;
  const basis =
    details.billing_basis === "PER_BAG" || details.billing_basis === "PER_KG"
      ? details.billing_basis
      : bagCount > 0
        ? "PER_BAG"
        : "PER_KG";
  const feeQty =
    Number(details.fee_quantity) > 0
      ? Number(details.fee_quantity)
      : basis === "PER_BAG"
        ? bagCount || 1
        : Number(details.intakeGrain?.kgReceived) || 1;
  const feePerUnit =
    Number(details.fee_per_unit) > 0
      ? Number(details.fee_per_unit)
      : Number((subtotal / feeQty).toFixed(2));
  lines.push({
    product: `أجور طحن وتجهيز (${details.intakeGrain?.nameAr || "حبوب"})`,
    qty: feeQty,
    unit: basis === "PER_BAG" ? "كيس" : "كجم",
    price: feePerUnit,
    total: subtotal,
    note: inv?.invoice_number ? `فاتورة مبيعات رسمية #${inv.invoice_number}` : undefined,
  });

  const statusLabel =
    details.status === "DELIVERED"
      ? "تم التسليم بالكامل"
      : details.status === "PROCESSED"
        ? "تم الطحن — بانتظار التسليم"
        : "مستلم — بانتظار الطحن";

  return {
    docType: stage === "delivery" ? "delivery_note" : "mill_document",
    title,
    number: details.document_number,
    relatedRef: inv?.invoice_number ? `فاتورة رسمية #${inv.invoice_number}` : undefined,
    date: formatFormalDateTime(details.received_at).date,
    partyLabel: "صاحب الأمانة / العميل:",
    partyName: details.customers?.name || "عميل أمانة",
    partyPhone: details.customers?.phone || undefined,
    warehouse: details.warehouses?.name_ar || details.warehouses?.name || "المستودع الرئيسي",
    movementType: "أمانة عينية خاصة بالعميل + فاتورة مبيعات رسمية لأجور الخدمة",
    status: statusLabel,
    lines,
    subtotal,
    discount,
    total,
    paid,
    balance: remaining,
    payment: inv?.payment_method ? paymentMethodLabel(inv.payment_method) : "نقداً",
    notes:
      "حبوب ونواتج ملك العميل (أمانة عينية خارج مخزون المنشأة). أجور الخدمة مثبتة بالفاتورة الرسمية المبينة أعلاه.",
    options: {
      showFinancialDetails: true,
      showPaymentInfo: true,
      showBarcode: true,
      showQrCode: true,
      showSignatures: true,
      showNotes: true,
    },
  };
}

export function syncAutoWeightOnItemChange(
  newItem: ProductOption | null | undefined,
  currentBags: number | string,
  isCurrentlyAuto: boolean,
  currentKg: string,
): { kg: string; isAuto: boolean } {
  const cap = capacityKgOf(newItem);
  const bags = Number(currentBags) || 0;
  if (cap && cap > 0) {
    if (isCurrentlyAuto || currentKg === "" || Number(currentKg) === 0) {
      return {
        kg: bags > 0 ? String(bags * cap) : "",
        isAuto: bags > 0,
      };
    }
    return { kg: currentKg, isAuto: isCurrentlyAuto };
  }
  if (isCurrentlyAuto) {
    return { kg: "", isAuto: false };
  }
  return { kg: currentKg, isAuto: false };
}

/** رقم السند من معرّف السطر — لاستخدام طباعة السند بعد الحفظ مباشرة. */
export async function fetchCustodyDocNumber(entryId: string): Promise<string | null> {
  const { data, error } = await db
    .from("custody_ledger")
    .select("doc_number")
    .eq("id", entryId)
    .maybeSingle();
  if (error) throw error;
  return (data as { doc_number: string | null } | null)?.doc_number ?? null;
}

export interface CustodyMillingInput {
  customerId: string;
  warehouseId: string;
  grainItemId: string;
  bagsOut: number;
  kgOut: number;
  outputs: CustodyLine[];
  notes?: string;
}

export async function custodyMilling(input: CustodyMillingInput): Promise<OpResult> {
  if (!input.customerId) return { ok: false, message: "اختر العميل." };
  if (!input.warehouseId) return { ok: false, message: "اختر المستودع." };
  if (!input.grainItemId) return { ok: false, message: "اختر صنف الحبوب المطحونة." };
  if ((input.bagsOut ?? 0) <= 0 && (input.kgOut ?? 0) <= 0) {
    return { ok: false, message: "حدد كمية الحبوب المطحونة (أكياس أو كجم)." };
  }
  const validOutputs = (input.outputs ?? []).filter(
    (o) => o.itemId && ((o.bags ?? 0) > 0 || (o.kg ?? 0) > 0),
  );
  if (validOutputs.length === 0) {
    return { ok: false, message: "أضف ناتجاً واحداً على الأقل (صنف + كمية)." };
  }

  const { data, error } = await db.rpc("custody_milling", {
    _customer_id: input.customerId,
    _warehouse_id: input.warehouseId,
    _grain_item_id: input.grainItemId,
    _bags_out: input.bagsOut ?? 0,
    _kg_out: input.kgOut ?? 0,
    _outputs: validOutputs.map((o) => ({
      item_id: o.itemId,
      bags: o.bags ?? 0,
      kg: o.kg ?? 0,
    })),
    _notes: input.notes ?? null,
  });
  if (error) return { ok: false, message: translateCustodyError(error.message) };
  return { ok: true, data: data as string };
}

export async function processMillingServiceDocument(input: {
  documentId: string;
  grainItemId: string;
  bagsOut: number;
  kgOut: number;
  outputs: CustodyLine[];
  notes?: string;
}): Promise<OpResult> {
  const validOutputs = (input.outputs ?? []).filter(
    (line) => line.itemId && ((line.bags ?? 0) > 0 || (line.kg ?? 0) > 0),
  );
  if (!input.documentId || !input.grainItemId || validOutputs.length === 0) {
    return { ok: false, message: "اختر المستند والحبوب وأضف ناتجاً واحداً على الأقل." };
  }
  const { data, error } = await db.rpc("milling_document_process", {
    _document_id: input.documentId,
    _grain_item_id: input.grainItemId,
    _bags_out: input.bagsOut ?? 0,
    _kg_out: input.kgOut ?? 0,
    _outputs: validOutputs.map((line) => ({
      item_id: line.itemId,
      bags: line.bags ?? 0,
      kg: line.kg ?? 0,
    })),
    _notes: input.notes ?? null,
  });
  if (error) return { ok: false, message: translateCustodyError(error.message) };
  return { ok: true, data: data as string };
}

export interface CustodyDeliveryInput {
  customerId: string;
  warehouseId: string;
  lines: CustodyLine[];
  notes?: string;
}

export async function custodyDelivery(input: CustodyDeliveryInput): Promise<OpResult> {
  if (!input.customerId) return { ok: false, message: "اختر العميل." };
  if (!input.warehouseId) return { ok: false, message: "اختر المستودع." };
  const validLines = (input.lines ?? []).filter(
    (l) => l.itemId && ((l.bags ?? 0) > 0 || (l.kg ?? 0) > 0),
  );
  if (validLines.length === 0) {
    return { ok: false, message: "أضف سطر تسليم واحداً على الأقل." };
  }

  const { data, error } = await db.rpc("custody_delivery", {
    _customer_id: input.customerId,
    _warehouse_id: input.warehouseId,
    _lines: validLines.map((l) => ({
      item_id: l.itemId,
      bags: l.bags ?? 0,
      kg: l.kg ?? 0,
    })),
    _notes: input.notes ?? null,
  });
  if (error) return { ok: false, message: translateCustodyError(error.message) };
  return { ok: true, data: data as string };
}

export async function deliverMillingServiceDocument(input: {
  documentId: string;
  lines: CustodyLine[];
  notes?: string;
}): Promise<OpResult> {
  const validLines = (input.lines ?? []).filter(
    (line) => line.itemId && ((line.bags ?? 0) > 0 || (line.kg ?? 0) > 0),
  );
  if (!input.documentId || validLines.length === 0) {
    return { ok: false, message: "اختر المستند وأضف سطر تسليم واحداً على الأقل." };
  }
  const { data, error } = await db.rpc("milling_document_delivery", {
    _document_id: input.documentId,
    _lines: validLines.map((line) => ({
      item_id: line.itemId,
      bags: line.bags ?? 0,
      kg: line.kg ?? 0,
    })),
    _notes: input.notes ?? null,
  });
  if (error) return { ok: false, message: translateCustodyError(error.message) };
  return { ok: true, data: data as string };
}

export interface CustodyAdjustmentInput {
  customerId: string;
  warehouseId: string;
  itemId: string;
  bagsDelta: number;
  kgDelta: number;
  reason: string;
}

export async function custodyAdjustment(input: CustodyAdjustmentInput): Promise<OpResult> {
  if (!input.customerId || !input.warehouseId || !input.itemId) {
    return { ok: false, message: "يرجى تحديد العميل والمخزن والصنف." };
  }
  if (!input.reason?.trim()) return { ok: false, message: "سبب التعديل إلزامي." };
  if ((input.bagsDelta ?? 0) === 0 && (input.kgDelta ?? 0) === 0) {
    return { ok: false, message: "التعديل يحتاج فرقاً غير صفري في الأكياس أو الكجم." };
  }

  const { data, error } = await db.rpc("custody_adjustment", {
    _customer_id: input.customerId,
    _warehouse_id: input.warehouseId,
    _item_id: input.itemId,
    _bags_delta: input.bagsDelta ?? 0,
    _kg_delta: input.kgDelta ?? 0,
    _reason: input.reason.trim(),
  });
  if (error) return { ok: false, message: translateCustodyError(error.message) };
  return { ok: true, id: data as string };
}

/* ------------------------------------------------------- the statement */

export async function fetchCustodyStatement(customerId?: string): Promise<CustodyStatementRow[]> {
  let q = db.from("custody_customer_statement").select("*").order("customer_name_ar");
  if (customerId) q = q.eq("customer_id", customerId);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as CustodyStatementRow[];
}

/** التبويب المالي: فواتير الأجور المرتبطة بسطور الأمانة. */
export async function fetchCustodyServiceMoney(customerId?: string): Promise<CustodyMoneyRow[]> {
  let q = db
    .from("custody_service_money")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(200);
  if (customerId) q = q.eq("customer_id", customerId);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as CustodyMoneyRow[];
}

/** سطور الطحن غير المربوطة بفاتورة أجور — تُربط من التبويب المالي. */
export interface UnlinkedMillingEntry {
  id: string;
  customer_id: string;
  doc_number: string;
  created_at: string;
}
export async function fetchUnlinkedMillingEntries(): Promise<UnlinkedMillingEntry[]> {
  const { data, error } = await db
    .from("custody_ledger")
    .select("id, customer_id, doc_number, created_at")
    .eq("entry_type", "MILLING")
    .is("service_invoice_id", null)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw error;
  return (data ?? []) as UnlinkedMillingEntry[];
}

/** فواتير مبيعات مؤكدة ولم تُسدَّد بالكامل لعميل — مرشّحات لربط الأجور. */
export async function fetchCustomerOpenInvoices(customerId: string) {
  const { data, error } = await db
    .from("sales_invoices")
    .select("id, invoice_number, total, paid, status, payment_status, created_at")
    .eq("customer_id", customerId)
    /*
     * الفلترة على المحورين المنفصلين (01_core_enums_and_helpers):
     *  * status        = دورة المستند  -> 'confirmed' فقط (draft/cancelled/returned لا تُربط)
     *  * payment_status = حالة السداد  -> نستثني 'paid' المُسدَّدة بالكامل
     * كان الاستعلام السابق يفلتر status in ('confirmed','partial') و«partial»
     * ليست قيمة في invoice_status إطلاقاً، فكان الفلتر بلا أثر حقيقي.
     */
    .eq("status", "confirmed")
    .neq("payment_status", "paid")
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw error;
  return (data ?? []) as {
    id: string;
    invoice_number: string;
    total: number;
    paid: number;
    status: string;
    payment_status: string;
    created_at: string;
  }[];
}

/**
 * ربط سطر أمانة (MILLING) بفاتورة الأجور — القيمة الوحيدة المالية المرتبطة
 * بالأمانات. الفاتورة نفسها تُنشأ من شاشات المبيعات القياسية (ق5: سطر واحد)،
 * وهذا الربط فقط ما يجعلها تظهر في التبويب المالي للكشف.
 */
export async function linkCustodyInvoice(
  custodyEntryId: string,
  invoiceId: string,
): Promise<OpResult> {
  if (!custodyEntryId || !invoiceId) {
    return { ok: false, message: "سطر الأمانة والفاتورة مطلوبان." };
  }
  const { error } = await db.rpc("custody_link_invoice", {
    _custody_entry_id: custodyEntryId,
    _invoice_id: invoiceId,
  });
  if (error) return { ok: false, message: translateCustodyError(error.message) };
  return { ok: true };
}

/** الفاقد المكتشف — يُكتشف لا يُدخل (ق2). تنبيه ولا يمنع. */
export async function fetchDetectedLoss(): Promise<CustodyLossRow[]> {
  const { data, error } = await db
    .from("custody_detected_loss")
    .select("*")
    .order("customer_name_ar");
  if (error) throw error;
  return (data ?? []) as CustodyLossRow[];
}

/* ---------------------------------------------------------------- misc */

export const MILLING_MODULE_ID = "milling_operations";

/* ------------------------------------- print vouchers (05 §بند 8.4) */

/**
 * سند طباعة موحّد لعملية أمانة (استلام/طحن/تسليم/تعديل).
 *
 * يُبنى من سجل السند الفعلي في `custody_ledger` (لا من حالة الشاشة)، مع
 * أسماء العميل/المخزن/الأصناف من جداول النظام. الحقول المالية صفرية لأن
 * الأمانات بلا مال (ق2/د6) — الفاتورة الوحيدة هي فاتورة الأجور المربوطة.
 *
 * المستند يمرّ عبر محرك الطباعة القياسي للنظام (renderUnifiedDocument /
 * printUnifiedDocument) فترث أوراق A4/حراري وقالب `milling-clean` وقواعد
 * الطباعة العامة — لا قالب خاص بالمطحنة ولا مصدر ثانٍ للتنسيق.
 */
export interface CustodyVoucherData {
  entryType: "INTAKE" | "MILLING" | "DELIVERY" | "ADJUSTMENT";
  docNumber: string;
  createdAt: string;
  customerName: string;
  customerPhone?: string | null;
  warehouseName: string;
  notes?: string | null;
  /** أسطر السند: صنف + كمية — كجم يظهر وإن صفر لأكياس فقط. */
  lines: { item: string; bags: number; kg: number }[];
}

const VOUCHER_TITLES: Record<CustodyVoucherData["entryType"], string> = {
  INTAKE: "سند استلام أمانة",
  MILLING: "سند طحن أمانة",
  DELIVERY: "سند تسليم أمانة",
  ADJUSTMENT: "سند تعديل جردي",
};

export async function buildCustodyVoucher(docNumber: string): Promise<CustodyVoucherData | null> {
  if (!docNumber?.trim()) return null;

  /* سطور السند من السجل الوحيد — بلا حالة شاشة ولا حساب محلي. */
  const { data, error } = await db
    .from("custody_ledger")
    .select(
      `id, entry_type, doc_number, bags_in, bags_out, kg_in, kg_out, notes, created_at,
       customers(name, phone),
       warehouses(name, name_ar),
       products(name, name_ar, sku)`,
    )
    .eq("doc_number", docNumber.trim())
    .order("created_at");
  if (error) throw error;
  if (!data?.length) return null;

  const first = data[0] as {
    entry_type: CustodyVoucherData["entryType"];
    doc_number: string;
    created_at: string;
    notes: string | null;
    customers: { name: string; phone: string | null } | null;
    warehouses: { name: string; name_ar: string | null } | null;
  };

  const lines = data.map((r: any) => ({
    item: r.products?.name_ar || r.products?.name || "—",
    bags: Number(r.bags_in ?? 0) + Number(r.bags_out ?? 0),
    kg: Number(r.kg_in ?? 0) + Number(r.kg_out ?? 0),
  }));

  return {
    entryType: first.entry_type,
    docNumber: first.doc_number,
    createdAt: first.created_at,
    customerName: first.customers?.name || "—",
    customerPhone: first.customers?.phone || null,
    warehouseName: first.warehouses?.name_ar || first.warehouses?.name || "—",
    notes: first.notes,
    lines,
  };
}

/** يحوّل سند الأمانة إلى UnifiedDocumentData لمحرك الطباعة القياسي. */
export function custodyVoucherToDoc(v: CustodyVoucherData): UnifiedDocumentData {
  const isDelivery = v.entryType === "DELIVERY";
  const title = VOUCHER_TITLES[v.entryType];
  return {
    docType: isDelivery ? ("delivery_note" as const) : ("mill_document" as const),
    title,
    number: v.docNumber,
    date: new Date(v.createdAt).toLocaleString("ar-EG"),
    partyLabel: "صاحب الأمانة / العميل:",
    partyName: v.customerName,
    partyPhone: v.customerPhone ?? undefined,
    warehouse: v.warehouseName,
    movementType: isDelivery ? "تسليم أمانات عينية للعميل" : "أمانة — بلا أثر مخزني أو مالي",
    status: "مسجّل",
    lines: v.lines.map((l: any) => ({
      product: l.item,
      qty: l.bags > 0 ? l.bags : l.kg,
      unit: l.bags > 0 ? "كيس" : "كجم",
      price: 0,
      total: 0,
      note: l.note || (l.bags > 0 && l.kg > 0 ? `${l.kg} كجم` : undefined),
      previousQty: l.previousBags,
      remainingQty: l.remainingBags,
      previousKg: l.previousKg,
      remainingKg: l.remainingKg,
      currentKg: l.kg,
    })),
    notes:
      v.notes ??
      (isDelivery
        ? "تم تسليم الأمانات للعميل بحالة ممتازة."
        : "حبوب/نواتج ملك العميل — أمانة لا ذمة. صفر أثر على مخزون المطحنة."),
    options: {
      showFinancialDetails: false,
      showPaymentInfo: false,
      showBarcode: true,
      showQrCode: true,
      showSignatures: true,
    },
  };
}

/** بناء سند تسليم أمانات مخصص بالدفعات (الرصيد السابق، المسلّم الآن، المتبقي). */
export function buildCustodyDeliveryDoc({
  docNumber,
  customerName,
  customerPhone,
  warehouseName,
  lines,
  notes,
  date,
}: {
  docNumber: string;
  customerName: string;
  customerPhone?: string | null;
  warehouseName: string;
  lines: {
    itemName: string;
    previousBags: number;
    previousKg: number;
    deliveredBags: number;
    deliveredKg: number;
    remainingBags: number;
    remainingKg: number;
    unit?: string;
    note?: string;
  }[];
  notes?: string;
  date?: string;
}): UnifiedDocumentData {
  return {
    docType: "delivery_note",
    title: "سند تسليم أمانات نواتج طحن",
    number: docNumber,
    date: date || new Date().toLocaleString("ar-EG"),
    partyLabel: "العميل المستلم:",
    partyName: customerName,
    partyPhone: customerPhone || undefined,
    warehouse: warehouseName,
    movementType: "صرف وتسليم أمانات عينية (دفعات)",
    status: "تم التسليم",
    lines: lines.map((l) => ({
      product: l.itemName,
      qty: l.deliveredBags > 0 ? l.deliveredBags : l.deliveredKg,
      unit: l.unit || (l.deliveredBags > 0 ? "كيس" : "كجم"),
      price: 0,
      total: 0,
      previousQty: l.previousBags,
      remainingQty: l.remainingBags,
      previousKg: l.previousKg,
      remainingKg: l.remainingKg,
      currentKg: l.deliveredKg,
      note:
        l.note || (l.deliveredBags > 0 && l.deliveredKg > 0 ? `${l.deliveredKg} كجم` : undefined),
    })),
    notes: notes || "تم تسليم الأمانات الموضحة أعلاه للعميل / السائق بموجب إذن الصرف المعتمد.",
    options: {
      showFinancialDetails: false,
      showPaymentInfo: false,
      showBarcode: true,
      showQrCode: true,
      showSignatures: true,
      showCustomerInfo: true,
      showCompanyInfo: true,
      showNotes: true,
    },
  };
}

/* ----------------------------------------- smart manufacture (خطوة 7) */

/** مستند تحويل/تصنيع: وارد قمح يُنقص، صادر نواتج تزيد، تكلفة موزّعة نسبياً. */
export async function smartManufacture(input: {
  warehouseId: string;
  grainItemId: string;
  grainQty: number;
  outputs: { itemId: string; qty: number }[];
  notes?: string;
}): Promise<OpResult> {
  if (!input.warehouseId || !input.grainItemId) {
    return { ok: false, message: "اختر المخزن وصنف القمح." };
  }
  if ((input.grainQty ?? 0) <= 0) {
    return { ok: false, message: "كمية القمح يجب أن تكون أكبر من صفر." };
  }
  const validOutputs = (input.outputs ?? []).filter((o) => o.itemId && (o.qty ?? 0) > 0);
  if (validOutputs.length === 0) {
    return { ok: false, message: "أضف ناتجاً واحداً على الأقل (صنف + كمية)." };
  }

  const { data, error } = await db.rpc("smart_manufacture", {
    _warehouse_id: input.warehouseId,
    _grain_item_id: input.grainItemId,
    _grain_qty: input.grainQty,
    _outputs: validOutputs.map((o) => ({ item_id: o.itemId, qty: o.qty })),
    _notes: input.notes ?? null,
  });
  if (error) return { ok: false, message: translateCustodyError(error.message) };
  return { ok: true, data: data as string };
}

/* --------------------------------- internal consumables issue (خطوة 7 — ق4) */

/** فاتورة صرف مستهلكات داخلي: تُنقص كمياتها من مخزن المستهلكات بدقة. */
export async function consumeInternalSupplies(input: {
  warehouseId: string;
  lines: { itemId: string; qty: number }[];
  notes?: string;
}): Promise<OpResult> {
  if (!input.warehouseId) return { ok: false, message: "اختر المخزن." };
  const validLines = (input.lines ?? []).filter((l) => l.itemId && (l.qty ?? 0) > 0);
  if (validLines.length === 0) {
    return { ok: false, message: "أضف سطراً واحداً على الأقل (صنف + كمية)." };
  }

  const { data, error } = await db.rpc("consume_internal_supplies", {
    _warehouse_id: input.warehouseId,
    _lines: validLines.map((l) => ({ item_id: l.itemId, qty: l.qty })),
    _notes: input.notes ?? null,
  });
  if (error) return { ok: false, message: translateCustodyError(error.message) };
  return { ok: true, data: data as string };
}

/** مستهلكات (أكياس/خيط/زيت) — تصرف من مخزن المستهلكات. */
export async function fetchConsumableItems(): Promise<ProductOption[]> {
  const { data, error } = await db
    .from("products")
    .select("id, sku, name, name_ar, item_class, sale_price, package_weight_kg")
    .in("item_class", ["NON_STOCK_ITEM", "PACKAGING"])
    .eq("is_active", true)
    .order("name_ar");
  if (error) throw error;
  return (data ?? []) as ProductOption[];
}

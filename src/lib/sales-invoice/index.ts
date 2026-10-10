/**
 * Market-Hub ERP — Sales invoice, two selling modes.
 *
 * THE TWO MODES ARE DIFFERENT ACTS, NOT TWO SKINS ON ONE FORM
 * ----------------------------------------------------------
 * POS sells a KNOWN product: the operator scans or picks it, and price, tax
 * rate, unit and stock effect are all properties of that product. The only
 * thing the operator supplies is a quantity.
 *
 * A milling ticket sells a SERVICE whose terms are negotiated at the counter:
 * how much grain, ground to what grade, into how many sacks, and at what fee.
 * None of that exists in the catalogue, because it is particular to this
 * customer on this day.
 *
 * Forcing the second through the first is what produces a "service product"
 * created on the fly for every sale, which then pollutes the catalogue with
 * hundreds of near-identical entries and makes every margin report useless.
 * The engine already supports an ad-hoc service line - `resolve_sale_line`
 * returns AD_HOC_SERVICE with stock effect NONE when there is no product id -
 * so the ticket mode uses that deliberately rather than fighting it.
 *
 * A NOTE ON WHAT THE TICKET DOES NOT DO
 * -------------------------------------
 * A milling ticket here is a SERVICE sale: the mill charges for grinding and
 * does not transfer ownership of any stock. If the customer is depositing
 * their own grain and collecting their own flour, that is custody, and it is
 * handled by the milling desk with its own documents - not by a sale. Mixing
 * the two would put customer grain through the mill's revenue, which is the
 * one thing the whole custody design exists to prevent.
 */
import { supabase } from "@/integrations/supabase/client";

const db = supabase as any;

/**
 * The value a document stores.
 *
 * Kept as a union of the ENUM's own labels — NOT widened to `string` — because
 * `createSalesInvoice` passes it straight to a Postgres function that casts to
 * the payment_method type. A named Yemeni method such as بنك الكريمي is
 * converted to its stored value by `toLegacyPaymentValue` at the call site, so
 * this type stays an honest description of what the column can hold.
 */
export type PaymentMethod = "cash" | "card" | "bank_transfer" | "credit" | "mobile_money" | "split";

/** A ready-made catalogue line, as POS sells it. */
export interface CatalogLine {
  kind: "catalog";
  product_id: string;
  name: string;
  sku?: string | null;
  quantity: number;
  unit_price: number;
  tax_rate: number;
  unit_label?: string | null;
}

/**
 * A negotiated service line, as a milling ticket sells it.
 *
 * `product_id` is deliberately absent and stays absent: the line is priced by
 * the terms on it, and `name` is what the customer sees on the invoice.
 */
export interface ServiceLineInput {
  kind: "service";
  name: string;
  quantity: number;
  unit_price: number;
  tax_rate?: number;
  /** Free-form detail printed under the line: grade, sacks, fee basis. */
  detail?: string;
}

export type InvoiceLine = CatalogLine | ServiceLineInput;

export interface CreateSalesInvoiceInput {
  warehouseId: string;
  customerId?: string | null;
  saleDate?: string;
  paymentMethod: PaymentMethod;
  paid: number;
  discount?: number;
  note?: string;
  lines: InvoiceLine[];
}

export interface SalesInvoiceResult {
  ok: boolean;
  message?: string;
  invoiceId?: string;
  invoiceNumber?: string;
  total?: number;
}

/* ------------------------------------------------------------------ reads */

/** Products the mill can actually sell: sellable, active, company-owned. */
export async function fetchSellableProducts(warehouseId?: string) {
  const { data, error } = await db
    .from("products")
    .select("id, sku, barcode, name, name_ar, sale_price, tax_rate, unit_id, item_class, is_active")
    .eq("is_active", true)
    .eq("is_sellable", true)
    .order("name_ar");

  if (error) throw new Error(`تعذّر تحميل الأصناف القابلة للبيع: ${error.message}`);
  const rows = (data ?? []) as any[];

  // Stock on hand, when a warehouse is known, so the operator sees what can
  // actually leave today rather than discovering it at posting time.
  const onHand: Record<string, number> = {};
  if (warehouseId) {
    const { data: inv } = await db
      .from("stock_positions")
      .select("item_id, quantity, is_company_owned")
      .eq("warehouse_id", warehouseId);
    for (const r of (inv ?? []) as any[]) {
      if (r.is_company_owned) {
        onHand[r.item_id] = (onHand[r.item_id] ?? 0) + Number(r.quantity ?? 0);
      }
    }
  }

  return rows.map((r) => ({
    id: r.id as string,
    sku: r.sku as string | null,
    barcode: r.barcode as string | null,
    name: (r.name_ar || r.name) as string,
    sale_price: Number(r.sale_price ?? 0),
    tax_rate: Number(r.tax_rate ?? 0),
    unit_id: r.unit_id as string | null,
    item_class: r.item_class as string | null,
    on_hand: onHand[r.id] ?? 0,
  }));
}

export interface SellableProduct {
  id: string;
  sku: string | null;
  barcode: string | null;
  name: string;
  sale_price: number;
  tax_rate: number;
  unit_id: string | null;
  item_class: string | null;
  on_hand: number;
}

/**
 * Service products already in the catalogue, for the ticket mode's fee.
 *
 * Offered as a starting point, never as a constraint: a ticket can still be
 * priced freely, because the fee for grinding a specific customer's grain is
 * a negotiation, not a catalogue lookup.
 */
export async function fetchMillingServices() {
  const { data, error } = await db
    .from("products")
    .select("id, sku, name, name_ar, sale_price, tax_rate")
    .eq("item_nature", "SERVICE")
    .eq("is_active", true)
    .order("sku");

  if (error) throw new Error(`تعذّر تحميل خدمات الطحن: ${error.message}`);
  return ((data ?? []) as any[]).map((r) => ({
    id: r.id as string,
    sku: r.sku as string | null,
    name: (r.name_ar || r.name) as string,
    sale_price: Number(r.sale_price ?? 0),
    tax_rate: Number(r.tax_rate ?? 0),
  }));
}

/* ----------------------------------------------------------------- writes */

export async function createSalesInvoice(
  input: CreateSalesInvoiceInput,
): Promise<SalesInvoiceResult> {
  try {
    if (!input.warehouseId) throw new Error("المستودع غير محدد.");
    if (!input.lines.length) throw new Error("أضف بنداً واحداً على الأقل.");

    // The engine accepts an ad-hoc service line with a NULL product_id, and
    // that is exactly what a negotiated milling ticket is. Sending a made-up
    // product id here would be rejected by resolve_sale_line, and creating a
    // throwaway product for each sale would fill the catalogue with noise.
    const items = input.lines.map((l) =>
      l.kind === "service"
        ? {
            product_id: null,
            quantity: Number(l.quantity),
            unit_price: Number(l.unit_price),
            tax_rate: Number(l.tax_rate ?? 0),
            is_service: true,
            name: l.name,
          }
        : {
            product_id: l.product_id,
            quantity: Number(l.quantity),
            unit_price: Number(l.unit_price),
            tax_rate: Number(l.tax_rate),
            is_service: false,
            name: l.name,
          },
    );

    // A credit sale collects nothing; every other method records what was
    // actually received and leaves the remainder as a receivable. Deriving
    // this here rather than trusting the form keeps the ledger and the invoice
    // from disagreeing.
    const paid =
      input.paymentMethod === "credit"
        ? 0
        : Math.max(0, Math.min(Number(input.paid) || 0, Number.MAX_SAFE_INTEGER));

    // create_sale has THREE overloads and none of them takes a sale date: the
    // invoice is dated by the engine when it is created. Passing _sale_date
    // would be ignored silently by PostgREST, so the form's date field is a
    // display value and the function is called without it.
    const { data, error } = await db.rpc("create_sale", {
      _warehouse_id: input.warehouseId,
      _customer_id: input.customerId || null,
      _payment_method: input.paymentMethod,
      _paid: paid,
      _discount: Number(input.discount ?? 0),
      _note: input.note ?? null,
      _items: items,
    });
    if (error) throw new Error(error.message);

    const invoiceId = data as string;
    const { data: inv } = await db
      .from("sales_invoices")
      .select("invoice_number, total")
      .eq("id", invoiceId)
      .maybeSingle();

    return {
      ok: true,
      invoiceId,
      invoiceNumber: inv?.invoice_number ?? invoiceId.slice(0, 8),
      total: Number(inv?.total ?? 0),
    };
  } catch (err: any) {
    return { ok: false, message: err.message || "تعذّر إصدار الفاتورة." };
  }
}

/* ---------------------------------------------------------------- helpers */

export function lineTotal(l: InvoiceLine): number {
  return Number(l.quantity) * Number(l.unit_price);
}

export function invoiceTotals(lines: InvoiceLine[], discount = 0) {
  const subtotal = lines.reduce((s, l) => s + lineTotal(l), 0);
  const tax = 0; // tax_rate is per line and settled by the engine at posting
  const total = Math.max(0, subtotal - discount);
  return { subtotal, tax, total };
}

export const yer = (v: number | null | undefined) =>
  `${(v ?? 0).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })} ر.ي`;

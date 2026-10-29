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
  uom_id?: string | null;
  batch_id?: string | null;
  batch_number?: string | null;
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
  cashboxId?: string | null;
  bankAccountId?: string | null;
  paymentMethodId?: string | null;
  paymentReference?: string | null;
  chequeNumber?: string | null;
  chequeBank?: string | null;
  chequeDueDate?: string | null;
  chequeDrawer?: string | null;
  paymentSplits?: {
    method: string;
    amount: number;
    payment_method_id?: string;
    reference?: string | null;
  }[] | null;
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
export async function fetchSellableProducts(warehouseId?: string, lang: "ar" | "en" = "ar") {
  const { data, error } = await db
    .from("products")
    .select("id, sku, barcode, name, name_ar, sale_price, tax_rate, unit_id, item_class, is_active, unit:units!products_unit_id_fkey(name, name_ar, short_name)")
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

  const saleUomsByProduct = new Map<string, SellableUom[]>();
  const barcodeByUom = new Map<string, string[]>();
  const basePrices = new Map<string, number>();
  if (rows.length) {
    const ids = rows.map((row) => row.id);
    const [uomResult, companyPriceResult] = await Promise.all([
      db.from("product_uoms")
        .select("id, product_id, unit_id, factor_to_base, quantity_increment, can_sell, is_default_sale, unit:units!product_uoms_unit_id_fkey(name, name_ar, short_name)")
        .in("product_id", ids)
        .eq("is_active", true)
        .eq("can_sell", true),
      db.from("company_items")
        .select("item_id, default_sale_price")
        .eq("company_id", 1)
        .eq("is_active", true)
        .in("item_id", ids),
    ]);
    const missingUomSchema = uomResult.error && ["42P01", "PGRST205"].includes(uomResult.error.code ?? "");
    if (uomResult.error && !missingUomSchema) throw new Error(`تعذّر تحميل وحدات البيع: ${uomResult.error.message}`);
    if (companyPriceResult.error) throw new Error(`تعذّر تحميل أسعار المنشأة: ${companyPriceResult.error.message}`);
    for (const row of companyPriceResult.data ?? []) {
      if (row.default_sale_price != null) basePrices.set(row.item_id, Number(row.default_sale_price));
    }
    if (!missingUomSchema && uomResult.data?.length) {
      const uomIds = uomResult.data.map((row: any) => row.id);
      const [priceResult, barcodeResult] = await Promise.all([
        db.from("product_uom_prices").select("product_uom_id, sale_price").in("product_uom_id", uomIds).eq("company_id", 1),
        db.from("product_uom_barcodes").select("product_uom_id, barcode").in("product_uom_id", uomIds).eq("company_id", 1).eq("is_active", true),
      ]);
      if (priceResult.error) throw new Error(`تعذّر تحميل أسعار وحدات البيع: ${priceResult.error.message}`);
      if (barcodeResult.error) throw new Error(`تعذّر تحميل باركودات وحدات البيع: ${barcodeResult.error.message}`);
      const prices = new Map<string, number>();
      for (const row of priceResult.data ?? []) if (row.sale_price != null) prices.set(row.product_uom_id, Number(row.sale_price));
      for (const row of barcodeResult.data ?? []) {
        const list = barcodeByUom.get(row.product_uom_id) ?? [];
        list.push(row.barcode);
        barcodeByUom.set(row.product_uom_id, list);
      }
      for (const row of uomResult.data as any[]) {
        const basePrice = basePrices.get(row.product_id) ?? Number(rows.find((product) => product.id === row.product_id)?.sale_price ?? 0);
        const unit = row.unit;
        const list = saleUomsByProduct.get(row.product_id) ?? [];
        list.push({
          unit_id: row.unit_id,
          factor_to_base: Number(row.factor_to_base),
          sale_price: prices.get(row.id) ?? basePrice * Number(row.factor_to_base),
          quantity_increment: Number(row.quantity_increment ?? 1),
          label: unit ? `${lang === "ar" ? unit.name_ar || unit.name : unit.name || unit.name_ar}${unit.short_name ? ` (${unit.short_name})` : ""}` : "",
          is_default_sale: row.is_default_sale === true,
          barcodes: barcodeByUom.get(row.id) ?? [],
        });
        saleUomsByProduct.set(row.product_id, list);
      }
    }
  }

  return rows.map((r) => {
    const saleUoms = saleUomsByProduct.get(r.id) ?? [];
    const defaultUom = saleUoms.find((unit) => unit.is_default_sale) ?? saleUoms.find((unit) => unit.unit_id === r.unit_id);
    return {
    id: r.id as string,
    sku: r.sku as string | null,
    barcode: r.barcode as string | null,
    name: (r.name_ar || r.name) as string,
    sale_price: defaultUom?.sale_price ?? basePrices.get(r.id) ?? Number(r.sale_price ?? 0),
    tax_rate: Number(r.tax_rate ?? 0),
    unit_id: r.unit_id as string | null,
    base_unit_label: r.unit ? (r.unit.short_name || (lang === "ar" ? r.unit.name_ar || r.unit.name : r.unit.name || r.unit.name_ar)) : null,
    sale_uoms: saleUoms,
    default_sales_uom_id: defaultUom?.unit_id ?? r.unit_id,
    default_sales_factor: defaultUom?.factor_to_base ?? 1,
    default_unit_label: defaultUom?.label ?? (r.unit?.short_name || (lang === "ar" ? r.unit?.name_ar || r.unit?.name : r.unit?.name || r.unit?.name_ar) || null),
    item_class: r.item_class as string | null,
    on_hand: onHand[r.id] ?? 0,
  };
  });
}

export interface SellableUom {
  unit_id: string;
  factor_to_base: number;
  sale_price: number;
  quantity_increment: number;
  label: string;
  is_default_sale: boolean;
  barcodes: string[];
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
  base_unit_label: string | null;
  sale_uoms: SellableUom[];
  default_sales_uom_id: string | null;
  default_sales_factor: number;
  default_unit_label: string | null;
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
            batch_id: l.batch_id ?? null,
            batch_number: l.batch_number ?? null,
            uom_id: l.uom_id ?? null,
          },
    );

    const paymentSplits = (input.paymentSplits ?? []).filter((line) => Number(line.amount) > 0);

    // A credit sale collects nothing; every other method records what was
    // actually received and leaves the remainder as a receivable. Deriving
    // this here rather than trusting the form keeps the ledger and the invoice
    // from disagreeing.
    const paid = paymentSplits.length
      ? Math.round(paymentSplits.reduce((sum, line) => sum + Number(line.amount), 0) * 100) / 100
      : input.paymentMethod === "credit"
        ? 0
        : Math.max(0, Math.min(Number(input.paid) || 0, Number.MAX_SAFE_INTEGER));

    const saleArgs = {
      _warehouse_id: input.warehouseId,
      _customer_id: input.customerId || null,
      _payment_method: paymentSplits.length > 1 ? "split" : input.paymentMethod,
      _paid: paid,
      _discount: Number(input.discount ?? 0),
      _note: input.note ?? null,
      _items: items,
    };
    // Always call the current 9-argument atomic function. The older shorter
    // overloads do not accept UOM snapshots and would silently post base units.
    const { data, error } = await db.rpc("create_sale", {
      ...saleArgs,
      _sale_date: input.saleDate ?? new Date().toISOString().slice(0, 10),
      _payment_splits: paymentSplits.map((line) => ({
        method: line.method,
        amount: Number(line.amount),
        payment_method_id: line.payment_method_id || line.method,
        reference: line.reference || null,
      })),
    });
    if (error) throw new Error(error.message);

    const invoiceId = data as string;

    // Update invoice with specific treasury & settlement routing metadata
    if (
      paymentSplits.length === 0 &&
      (input.cashboxId || input.bankAccountId || input.paymentMethodId || input.paymentReference)
    ) {
      try {
        await db
          .from("sales_invoices")
          .update({
            cashbox_id: input.cashboxId || null,
            bank_account_id: input.bankAccountId || null,
            payment_method_id: input.paymentMethodId || null,
            payment_reference: input.paymentReference || null,
          })
          .eq("id", invoiceId);
      } catch (metaErr) {
        console.warn("Settlement metadata update skipped or column not ready:", metaErr);
      }
    }

    // Register cheque if payment is cheque and cheque number was provided
    if (
      (input.paymentMethod === ("cheque" as any) || input.chequeNumber) &&
      input.chequeNumber &&
      paid > 0
    ) {
      try {
        await db.from("cheques_register").insert({
          cheque_number: input.chequeNumber,
          bank_name: input.chequeBank || "شيك مصرفي",
          drawer_name: input.chequeDrawer || null,
          due_date: input.chequeDueDate || new Date().toISOString().slice(0, 10),
          amount: paid,
          status: "UNDER_COLLECTION",
          customer_id: input.customerId || null,
          invoice_id: invoiceId,
          notes: input.note || null,
        });
      } catch (chequeErr) {
        console.warn("Cheque registration skipped or table not ready:", chequeErr);
      }
    }

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

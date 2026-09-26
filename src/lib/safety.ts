/**
 * Market Hub — Referential safety.
 *
 * Prevents the data-loss path found in the audit: the schema has
 * `ON DELETE CASCADE` from products → inventory/stock_movements, so deleting a
 * product that had stock history silently destroyed that history, while products
 * referenced by invoices failed with a raw Postgres FK error.
 *
 * Strategy (see `supabase/migrations/*_referential_safety_and_product_search.sql`):
 *   1. If the `product_delete_guard` RPC is deployed, use it — it checks every
 *      reference inside the database and only deletes when nothing points at the
 *      product.
 *   2. If the RPC is NOT deployed, fall back to counting references with ordinary
 *      SELECT queries and make the same decision in the client.
 *
 * Either way the rule is identical and is what the UI communicates:
 *
 *   no references            → hard delete is allowed
 *   referenced by documents  → delete is refused, offer deactivate instead
 *   has stock history only   → delete is refused, offer deactivate instead
 *
 * This module reads and writes no business data itself except through the guard.
 */

import { supabase } from "@/integrations/supabase/client";

/**
 * The generated Supabase types only know the functions/tables that existed when
 * they were last generated. The referential-safety functions and some catalog
 * tables are not in them, so this module works through a loosely-typed view of
 * the client. That is deliberate: it keeps the generated types honest for
 * everyone else instead of widening them globally.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type LooseClient = any;
const db = supabase as LooseClient;

export interface ReferenceCounts {
  salesItems: number;
  purchaseItems: number;
  salesReturns: number;
  purchaseReturns: number;
  transfers: number;
  stockMovements: number;
  inventoryRows: number;
  compatibilities: number;
  blockingTotal: number;
  canDelete: boolean;
  hasHistory: boolean;
}

export type DeleteOutcome =
  | { status: "deleted" }
  | { status: "blocked"; counts: ReferenceCounts }
  | { status: "forbidden" }
  | { status: "not_found" }
  | { status: "error"; message: string };

/* ------------------------------------------------------------------ */
/*  Read: how many things reference this product?                      */
/* ------------------------------------------------------------------ */

/** Returns `null` when reference counting is unavailable (never throws). */
export async function getProductReferenceCounts(
  productId: string,
): Promise<ReferenceCounts | null> {
  // Prefer the server-side guard (single round trip, authoritative).
  const rpc = await db.rpc("product_reference_counts", { p_product_id: productId } as never);

  if (!rpc.error && rpc.data) {
    return normalizeCounts(rpc.data as Record<string, unknown>);
  }

  // Fallback: count client-side with plain SELECTs. Works without the migration.
  return countReferencesOnClient(productId);
}

async function countReferencesOnClient(productId: string): Promise<ReferenceCounts | null> {
  const countOf = async (table: string, column = "product_id"): Promise<number> => {
    try {
      const { count, error } = await db
        .from(table)
        .select("*", { count: "exact", head: true })
        .eq(column, productId);
      if (error) return 0;
      return count ?? 0;
    } catch {
      return 0;
    }
  };

  try {
    const [
      salesItems,
      purchaseItems,
      salesReturns,
      purchaseReturns,
      transfers,
      stockMovements,
      inventoryRows,
      compatibilities,
    ] = await Promise.all([
      countOf("sales_invoice_items"),
      countOf("purchase_invoice_items"),
      countOf("sales_return_items"),
      countOf("purchase_return_items"),
      countOf("stock_transfer_items"),
      countOf("stock_movements"),
      countOf("inventory"),
      countOf("product_compatibilities"),
    ]);

    const blockingTotal =
      salesItems + purchaseItems + salesReturns + purchaseReturns + transfers + stockMovements;

    return {
      salesItems,
      purchaseItems,
      salesReturns,
      purchaseReturns,
      transfers,
      stockMovements,
      inventoryRows,
      compatibilities,
      blockingTotal,
      canDelete: blockingTotal === 0,
      hasHistory: stockMovements > 0 || inventoryRows > 0,
    };
  } catch {
    // If even the fallback fails we cannot prove the product is unreferenced, so
    // we must not allow a delete. Returning null makes the caller refuse.
    return null;
  }
}

function normalizeCounts(raw: Record<string, unknown>): ReferenceCounts {
  const num = (key: string) => Number(raw[key] ?? 0);
  const blockingTotal = num("blocking_total");
  return {
    salesItems: num("sales_items"),
    purchaseItems: num("purchase_items"),
    salesReturns: num("sales_returns"),
    purchaseReturns: num("purchase_returns"),
    transfers: num("transfers"),
    stockMovements: num("stock_movements"),
    inventoryRows: num("inventory_rows"),
    compatibilities: num("compatibilities"),
    blockingTotal,
    canDelete: raw.can_delete === true || blockingTotal === 0,
    hasHistory: raw.has_history === true || num("stock_movements") > 0 || num("inventory_rows") > 0,
  };
}

/* ------------------------------------------------------------------ */
/*  Write: guarded delete                                              */
/* ------------------------------------------------------------------ */

/**
 * Delete a product only if nothing references it.
 *
 * Never throws — always returns an outcome the UI can act on.
 */
export async function deleteProductSafely(productId: string): Promise<DeleteOutcome> {
  const rpc = await db.rpc("product_delete_guard", { p_product_id: productId } as never);

  if (!rpc.error && rpc.data) {
    const data = rpc.data as Record<string, unknown>;
    if (data.deleted === true) return { status: "deleted" };
    const reason = String(data.reason ?? "");
    if (reason === "forbidden") return { status: "forbidden" };
    if (reason === "not_found") return { status: "not_found" };
    if (reason === "referenced") {
      const counts = data.counts
        ? normalizeCounts(data.counts as Record<string, unknown>)
        : await countReferencesOnClient(productId);
      if (counts) return { status: "blocked", counts };
      return { status: "error", message: "referenced" };
    }
    return { status: "error", message: reason || "unknown" };
  }

  // ---- Fallback path (RPC not deployed) ----
  // Count first; if we cannot prove it is unreferenced, refuse.
  const counts = await countReferencesOnClient(productId);
  if (!counts) {
    return { status: "error", message: "unavailable" };
  }
  if (!counts.canDelete) {
    return { status: "blocked", counts };
  }

  // Safe: no documents and no stock history reference it. Clear the pure-catalog
  // satellites first (they carry no financial meaning), then the product.
  await db.from("product_compatibilities").delete().eq("product_id", productId);
  await db.from("inventory").delete().eq("product_id", productId);

  const { error } = await db.from("products").delete().eq("id", productId);
  if (error) {
    // A FK violation here means the schema changed under us — surface it as blocked.
    if (error.code === "23503") {
      const fresh = await countReferencesOnClient(productId);
      if (fresh) return { status: "blocked", counts: fresh };
    }
    return { status: "error", message: error.message };
  }

  return { status: "deleted" };
}

/* ------------------------------------------------------------------ */
/*  Deactivate / reactivate (the safe alternative)                     */
/* ------------------------------------------------------------------ */

/**
 * Soft "deactivate" — updates only the `is_active` flag on one product.
 * This is a normal column update on a single row; it does not touch documents,
 * stock or any other table.
 */
export async function setProductActive(
  productId: string,
  isActive: boolean,
): Promise<{ ok: boolean; message?: string }> {
  const { error } = await db.from("products").update({ is_active: isActive }).eq("id", productId);
  if (error) return { ok: false, message: error.message };
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/*  Presentation helpers                                               */
/* ------------------------------------------------------------------ */

/** Human-readable list of what blocks the delete, for the dialog copy. */
export function describeReferences(counts: ReferenceCounts, lang: string): string[] {
  const ar = lang === "ar";
  const out: string[] = [];
  const push = (n: number, arLabel: string, enLabel: string) => {
    if (n > 0) out.push(`${n} ${ar ? arLabel : enLabel}`);
  };

  push(counts.salesItems, "بند فاتورة بيع", "sales invoice line(s)");
  push(counts.purchaseItems, "بند فاتورة شراء", "purchase invoice line(s)");
  push(counts.salesReturns, "بند مرتجع بيع", "sales return line(s)");
  push(counts.purchaseReturns, "بند مرتجع شراء", "purchase return line(s)");
  push(counts.transfers, "بند تحويل مخزون", "stock transfer line(s)");
  push(counts.stockMovements, "حركة مخزون", "stock movement(s)");

  return out;
}

/** True when the only problem is stock history (no financial documents). */
export function isHistoryOnly(counts: ReferenceCounts): boolean {
  const documentsOnly =
    counts.salesItems +
    counts.purchaseItems +
    counts.salesReturns +
    counts.purchaseReturns +
    counts.transfers;
  return documentsOnly === 0 && counts.stockMovements > 0;
}

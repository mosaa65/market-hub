/**
 * Market-Hub ERP — Stock operations API.
 *
 * Every function here calls an atomic RPC. None of them writes a table
 * directly, because stock, its ledger and the owning document must move
 * together or not at all (design sections 10 and 18).
 *
 * The three concepts this module keeps apart, on purpose:
 *
 *   postOpeningStock()     a standing balance, NOT a purchase
 *   postStockAdjustment()  a correction to a balance, NOT a purchase
 *   receiveCustomerOwned() material we hold but do not own
 *
 * A purchase is a purchase. It goes through `create_purchase` in the
 * procurement module, and it is the only thing that shows in the purchase
 * report.
 */

import { supabase } from "@/integrations/supabase/client";

const db = supabase as any;

export interface StockOperationResult {
  ok: boolean;
  id?: string;
  message?: string;
}

/* --------------------------------------------------------- opening stock */

export interface OpeningStockLine {
  productId: string;
  quantity: number;
  unitCost: number;
  note?: string;
}

/**
 * Posts an opening balance. Design rule #6: this creates a real stock position
 * and its ledger entry, and it must never be counted as a purchase.
 */
export async function postOpeningStock(input: {
  warehouseId: string;
  effectiveDate: string;
  note?: string;
  lines: OpeningStockLine[];
}): Promise<StockOperationResult> {
  if (input.lines.length === 0) {
    return { ok: false, message: "لا توجد بنود في رصيد أول المدة." };
  }

  const { data, error } = await db.rpc("post_opening_stock", {
    _warehouse_id: input.warehouseId,
    _effective_date: input.effectiveDate,
    _note: input.note ?? null,
    _items: input.lines.map((line) => ({
      product_id: line.productId,
      quantity: line.quantity,
      unit_cost: line.unitCost,
      note: line.note ?? null,
    })),
  });

  if (error) return { ok: false, message: error.message };
  return { ok: true, id: data as string };
}

/* ------------------------------------------------------ stock adjustment */

export interface AdjustmentLine {
  productId: string;
  /** Signed: positive increases the balance, negative decreases it. */
  quantity: number;
  unitCost: number;
  note?: string;
}

/**
 * Posts a documented adjustment. Design rule #6: this is not a purchase either.
 * The reason is mandatory and is stored on the movement itself.
 */
export async function postStockAdjustment(input: {
  warehouseId: string;
  reason: string;
  note?: string;
  effectiveDate: string;
  lines: AdjustmentLine[];
}): Promise<StockOperationResult> {
  if (!input.reason?.trim()) {
    return { ok: false, message: "سبب التسوية إلزامي." };
  }
  if (input.lines.length === 0) {
    return { ok: false, message: "لا توجد بنود في التسوية." };
  }

  const { data, error } = await db.rpc("post_stock_adjustment", {
    _warehouse_id: input.warehouseId,
    _reason: input.reason,
    _note: input.note ?? null,
    _effective_date: input.effectiveDate,
    _items: input.lines.map((line) => ({
      product_id: line.productId,
      quantity: line.quantity,
      unit_cost: line.unitCost,
      note: line.note ?? null,
    })),
  });

  if (error) return { ok: false, message: error.message };
  return { ok: true, id: data as string };
}

/* --------------------------------------------------- customer-owned stock */

/**
 * Records material that physically sits in our premises but belongs to a
 * customer. Because the inventory row is written under owner_type = CUSTOMER,
 * it is excluded from `company_stock_positions` and from company valuation.
 */
export async function receiveCustomerOwnedStock(input: {
  customerId: string;
  productId: string;
  warehouseId: string;
  quantity: number;
  unitCost?: number;
  note?: string;
}): Promise<StockOperationResult> {
  const { data, error } = await db.rpc("receive_customer_owned_stock", {
    _customer_id: input.customerId,
    _product_id: input.productId,
    _warehouse_id: input.warehouseId,
    _quantity: input.quantity,
    _unit_cost: input.unitCost ?? 0,
    _note: input.note ?? null,
  });

  if (error) return { ok: false, message: error.message };
  return { ok: true, id: data as string };
}

/**
 * Releases customer-owned material — a physical hand-over, not a sale. It
 * changes no revenue and no receivable.
 */
export async function releaseCustomerOwnedStock(input: {
  customerId: string;
  productId: string;
  warehouseId: string;
  quantity: number;
  note?: string;
}): Promise<StockOperationResult> {
  const { data, error } = await db.rpc("release_customer_owned_stock", {
    _customer_id: input.customerId,
    _product_id: input.productId,
    _warehouse_id: input.warehouseId,
    _quantity: input.quantity,
    _note: input.note ?? null,
  });

  if (error) return { ok: false, message: error.message };
  return { ok: true, id: data as string };
}

/* --------------------------------------------------------------- reading */

export interface StockPositionRow {
  item_id: string;
  warehouse_id: string;
  owner_type: string;
  owner_id: string | null;
  quantity: number;
  item_nature: string;
  inventory_policy: string;
  reference_valuation: number;
  is_company_owned: boolean;
  warehouse_name: string | null;
  warehouse_name_ar: string | null;
  item_name: string;
  item_name_ar: string | null;
  sku: string | null;
}

/**
 * Company-owned, tracked stock only. This is the correct source for an
 * inventory report: it excludes services, untracked goods and — crucially —
 * customer-owned material.
 */
export async function fetchCompanyStockPositions(): Promise<StockPositionRow[]> {
  const { data, error } = await db
    .from("company_stock_positions")
    .select(
      "item_id, warehouse_id, owner_type, owner_id, quantity, item_nature, inventory_policy, reference_valuation, is_company_owned, warehouse_name, warehouse_name_ar, item_name, item_name_ar, sku",
    )
    .order("item_name");

  if (error) return [];
  return (data ?? []) as StockPositionRow[];
}

/** Material held for customers. Its value is explicitly not company inventory. */
export async function fetchCustomerOwnedPositions(): Promise<StockPositionRow[]> {
  const { data, error } = await db
    .from("customer_owned_positions")
    .select(
      "item_id, warehouse_id, owner_type, owner_id, quantity, item_nature, inventory_policy, reference_valuation, is_company_owned, warehouse_name, warehouse_name_ar, item_name, item_name_ar, sku",
    )
    .order("item_name");

  if (error) return [];
  return (data ?? []) as StockPositionRow[];
}

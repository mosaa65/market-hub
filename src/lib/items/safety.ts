/**
 * Market-Hub ERP — Item policy safety.
 *
 * The database refuses a policy change once an item has inventory history
 * (trigger `products_guard_policy_change`). That is correct, but a raw error is
 * a bad experience. This module lets the UI ask the question *before* the user
 * tries, so the form can explain why a change is blocked and offer the
 * governed path instead.
 *
 * It is read-only: it inspects, it never writes. The governed write goes
 * through `approve_item_policy_change()` / `save_item_policy()`.
 */

import { supabase } from "@/integrations/supabase/client";
import type {
  CostingMethod,
  InventoryPolicy,
  ItemNature,
  ItemPolicy,
  ItemTracking,
} from "./policy";

const db = supabase as any;

/* ------------------------------------------------------------------ reads */

export interface ItemHistorySummary {
  hasHistory: boolean;
  movementCount: number;
  companyBalance: number;
  customerOwnedBalance: number;
}

/**
 * Does this item already have a ledger? Returns zeroes when the counts cannot
 * be read, and treats "unknown" as "has history" for the caller's safety.
 */
export async function getItemHistory(itemId: string): Promise<ItemHistorySummary> {
  const empty: ItemHistorySummary = {
    hasHistory: false,
    movementCount: 0,
    companyBalance: 0,
    customerOwnedBalance: 0,
  };

  try {
    const [movements, inventory] = await Promise.all([
      db
        .from("stock_movements")
        .select("id", { count: "exact", head: true })
        .eq("product_id", itemId),
      db.from("inventory").select("quantity, owner_type").eq("product_id", itemId),
    ]);

    const movementCount = movements.error ? 0 : (movements.count ?? 0);
    const rows: { quantity: number; owner_type: string }[] = inventory.error
      ? []
      : (inventory.data ?? []);

    const companyBalance = rows
      .filter((row) => row.owner_type === "COMPANY")
      .reduce((sum, row) => sum + Number(row.quantity ?? 0), 0);

    const customerOwnedBalance = rows
      .filter((row) => row.owner_type !== "COMPANY")
      .reduce((sum, row) => sum + Number(row.quantity ?? 0), 0);

    return {
      hasHistory: movementCount > 0 || companyBalance !== 0 || customerOwnedBalance !== 0,
      movementCount,
      companyBalance,
      customerOwnedBalance,
    };
  } catch {
    // Unable to prove the item is untouched — report history so the caller
    // takes the safe path.
    return { ...empty, hasHistory: true };
  }
}

/**
 * Whether the current user may perform a governed policy change.
 * Mirrors the server check in `approve_item_policy_change()`.
 */
export function canApprovePolicyChange(hasRole: (role: string) => boolean): boolean {
  return hasRole("owner") || hasRole("manager");
}

/* ----------------------------------------------------------------- writes */

export interface SaveItemPolicyInput {
  itemId: string;
  nature: ItemNature;
  inventoryPolicy: InventoryPolicy;
  costingMethod: CostingMethod;
  tracking: ItemTracking;
  isSellable: boolean;
  isPurchasable: boolean;
  baseUomId?: string | null;
  salesUomId?: string | null;
  purchaseUomId?: string | null;
  uomConversions?: unknown[] | null;
}

export interface SaveItemPolicyResult {
  ok: boolean;
  /** A message ready to show the user, when ok is false. */
  message?: string;
}

/**
 * Saves the policy-bearing fields through the governed RPC instead of writing
 * `products` directly. The RPC applies the same rules the database trigger
 * enforces and writes the audit entry.
 */
export async function saveItemPolicy(input: SaveItemPolicyInput): Promise<SaveItemPolicyResult> {
  const { error } = await db.rpc("save_item_policy", {
    _item_id: input.itemId,
    _item_nature: input.nature,
    _inventory_policy: input.inventoryPolicy,
    _costing_method: input.costingMethod,
    _tracking: input.tracking,
    _is_sellable: input.isSellable,
    _is_purchasable: input.isPurchasable,
    _base_uom_id: input.baseUomId ?? null,
    _sales_uom_id: input.salesUomId ?? null,
    _purchase_uom_id: input.purchaseUomId ?? null,
    _uom_conversions: input.uomConversions ?? null,
  });

  if (error) return { ok: false, message: error.message };
  return { ok: true };
}

/**
 * The governed transition for an item that already has history. Requires a
 * written reason, which is stored in the audit trail with the before/after
 * snapshot.
 */
export async function approvePolicyChange(input: {
  itemId: string;
  nature: ItemNature;
  inventoryPolicy: InventoryPolicy;
  costingMethod: CostingMethod;
  tracking: ItemTracking;
  reason: string;
}): Promise<SaveItemPolicyResult> {
  const { error } = await db.rpc("approve_item_policy_change", {
    _item_id: input.itemId,
    _new_nature: input.nature,
    _new_policy: input.inventoryPolicy,
    _new_costing: input.costingMethod,
    _new_tracking: input.tracking,
    _reason: input.reason,
  });

  if (error) return { ok: false, message: error.message };
  return { ok: true };
}

/** Reads the effective policy the server will use, including any company override. */
export async function fetchEffectivePolicy(itemId: string): Promise<InventoryPolicy | null> {
  const { data, error } = await db.rpc("item_effective_policy", { p_item_id: itemId });
  if (error) return null;
  return (data as InventoryPolicy) ?? null;
}

/* --------------------------------------------------------- presentation */

/**
 * Explains, in the user's language, why a policy change is refused and what to
 * do instead. Used by the product form when the guard rejects a save.
 */
export function explainPolicyBlock(
  history: ItemHistorySummary,
  lang: string,
): { title: string; body: string } {
  const ar = lang === "ar";

  if (history.companyBalance !== 0) {
    return {
      title: ar ? "لا يمكن إيقاف التتبع الآن" : "Tracking cannot be switched off right now",
      body: ar
        ? `لا يزال الصنف يحمل رصيدًا قدره ${history.companyBalance}. صفّر الرصيد أولًا عبر تسوية مخزون موثّقة، ثم أوقف التتبع.`
        : `The item still holds a balance of ${history.companyBalance}. Bring it to zero with a documented stock adjustment, then switch tracking off.`,
    };
  }

  return {
    title: ar ? "هذا الصنف له حركات مخزنية" : "This item already has inventory history",
    body: ar
      ? `يوجد ${history.movementCount} حركة مخزنية مسجلة. تغيير السياسة ممكن لكن يجب أن يمر بعملية معتمدة ومسجلة مع ذكر السبب، حتى يبقى التاريخ مفهومًا.`
      : `${history.movementCount} stock movements are recorded. A policy change is still possible, but it must go through a governed, reason-logged transition so the history stays explainable.`,
  };
}

/** The policy object a row should be read as, tolerating legacy rows. */
export function policyFromRow(
  row: Partial<{
    item_nature: string | null;
    inventory_policy: string | null;
    tracking: string | null;
    costing_method: string | null;
    is_sellable: boolean | null;
    is_purchasable: boolean | null;
    is_service: boolean | null;
  }>,
): ItemPolicy {
  // A row written before this migration has no policy columns at all. Its only
  // honest signal is `is_service`, so that is the fallback — and nothing else.
  if (!row.item_nature) {
    if (row.is_service === true) {
      return {
        item_nature: "SERVICE",
        inventory_policy: "UNTRACKED",
        tracking: "NONE",
        costing_method: "NONE",
        is_sellable: true,
        is_purchasable: false,
      };
    }
    return {
      item_nature: "GOOD",
      inventory_policy: "TRACKED",
      tracking: "NONE",
      costing_method: "MOVING_AVERAGE",
      is_sellable: true,
      is_purchasable: true,
    };
  }

  return {
    item_nature: (row.item_nature as ItemNature) ?? "GOOD",
    inventory_policy: (row.inventory_policy as InventoryPolicy) ?? "TRACKED",
    tracking: (row.tracking as ItemTracking) ?? "NONE",
    costing_method: (row.costing_method as CostingMethod) ?? "MOVING_AVERAGE",
    is_sellable: row.is_sellable ?? true,
    is_purchasable: row.is_purchasable ?? true,
  };
}

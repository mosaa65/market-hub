import type { CostingMethod, InventoryPolicy, ItemNature, ItemTracking } from "./policy";

export interface UserItemPolicyPreferences {
  item_nature: ItemNature;
  inventory_policy: InventoryPolicy;
  tracking: ItemTracking;
  costing_method: CostingMethod;
  is_sellable: boolean;
  is_purchasable: boolean;
}

const STORAGE_PREFIX = "market_hub_item_policy_preferences";

export const DEFAULT_USER_ITEM_POLICY_PREFERENCES: UserItemPolicyPreferences = {
  item_nature: "GOOD",
  inventory_policy: "TRACKED",
  tracking: "NONE",
  costing_method: "MOVING_AVERAGE",
  is_sellable: true,
  is_purchasable: true,
};

function storageKey(userId: string) {
  return `${STORAGE_PREFIX}:${userId}`;
}

function normalizePreferences(value: Partial<UserItemPolicyPreferences>): UserItemPolicyPreferences {
  const item_nature = value.item_nature === "SERVICE" ? "SERVICE" : "GOOD";
  const inventory_policy =
    item_nature === "SERVICE"
      ? "UNTRACKED"
      : value.inventory_policy === "UNTRACKED"
        ? "UNTRACKED"
        : value.inventory_policy === "CUSTOMER_OWNED"
          ? "CUSTOMER_OWNED"
          : "TRACKED";
  const tracking =
    inventory_policy === "TRACKED" && value.tracking === "BATCH"
      ? "BATCH"
      : inventory_policy === "TRACKED" && value.tracking === "SERIAL"
        ? "SERIAL"
        : "NONE";
  const costing_method =
    inventory_policy !== "TRACKED"
      ? "NONE"
      : value.costing_method === "FIFO"
        ? "FIFO"
        : value.costing_method === "STANDARD"
          ? "STANDARD"
          : "MOVING_AVERAGE";

  return {
    item_nature,
    inventory_policy,
    tracking,
    costing_method,
    is_sellable: value.is_sellable !== false,
    is_purchasable: value.is_purchasable !== false,
  };
}

export function readUserItemPolicyPreferences(userId: string): UserItemPolicyPreferences {
  if (typeof window === "undefined") return DEFAULT_USER_ITEM_POLICY_PREFERENCES;

  try {
    const raw = window.localStorage.getItem(storageKey(userId));
    if (!raw) return DEFAULT_USER_ITEM_POLICY_PREFERENCES;
    return normalizePreferences(JSON.parse(raw) as Partial<UserItemPolicyPreferences>);
  } catch {
    return DEFAULT_USER_ITEM_POLICY_PREFERENCES;
  }
}

export function saveUserItemPolicyPreferences(
  userId: string,
  preferences: UserItemPolicyPreferences,
) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey(userId), JSON.stringify(normalizePreferences(preferences)));
  } catch {
    // Preferences are best-effort if browser storage is unavailable.
  }
}


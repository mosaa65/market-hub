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

export function readUserItemPolicyPreferences(userId: string): UserItemPolicyPreferences {
  if (typeof window === "undefined") return DEFAULT_USER_ITEM_POLICY_PREFERENCES;

  try {
    const raw = window.localStorage.getItem(storageKey(userId));
    if (!raw) return DEFAULT_USER_ITEM_POLICY_PREFERENCES;
    const saved = {
      ...DEFAULT_USER_ITEM_POLICY_PREFERENCES,
      ...JSON.parse(raw),
    };
    // Older releases upgraded the untouched default to BATCH. Restore NONE
    // only for that exact default-shaped preference; preserve explicit choices.
    if (
      saved.item_nature === "GOOD" &&
      saved.inventory_policy === "TRACKED" &&
      saved.tracking === "BATCH" &&
      saved.costing_method === "MOVING_AVERAGE" &&
      saved.is_sellable === true &&
      saved.is_purchasable === true
    ) {
      saved.tracking = "NONE";
    }
    return saved;
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
    window.localStorage.setItem(storageKey(userId), JSON.stringify(preferences));
  } catch {
    // Preferences are best-effort if browser storage is unavailable.
  }
}

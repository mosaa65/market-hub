/**
 * Phase 4: Centralized Query Keys for Granular Cache Invalidation and SWR
 *
 * Two shapes live here:
 *
 *  1. `QUERY_KEYS` — the legacy flat keys. Kept because several routes and the
 *     Realtime subscriptions already reference them; changing their values would
 *     silently break invalidation. Do not add new entries.
 *  2. Typed key factories (`productKeys`, `supplierKeys`, `customerKeys`,
 *     `catalogKeys`, `inventoryKeys`, `transferKeys`) — the agreed contract for
 *     new code. A factory exists per domain so a mutation can invalidate
 *     *exactly* the keys it changed instead of matching by prefix.
 *
 * @see docs/UNIFIED_RECORD_LISTS_AUDIT_AND_REPAIR_PLAN_AR.md §5 Phase 1
 */
export const QUERY_KEYS = {
  products: ["products"] as const,
  productMeta: ["products", "meta"] as const,
  inventory: (warehouseId?: string) => ["inventory", warehouseId] as const,
  warehouses: ["warehouses"] as const,
  customers: ["customers"] as const,
  suppliers: ["suppliers"] as const,
  catalog: ["catalog"] as const,
  makes: ["makes"] as const,
  models: (makeId?: string) => ["models", makeId] as const,
  dashboard: ["dashboard"] as const,
  analytics: (range?: string) => ["analytics", range] as const,
  settlements: ["settlements"] as const,
  invoices: ["invoices"] as const,
  sales: ["sales"] as const,
};

/* ------------------------------------------------------------------ */
/*  Typed factories                                                    */
/* ------------------------------------------------------------------ */

/**
 * Keys for the products screen.
 *
 * - `all`    → prefix used for prefix-matching invalidation across the domain.
 * - `list`   → the streamed catalogue (`useInfiniteQuery`).
 * - `count`  → the server `count: "exact"` for the whole catalogue.
 * - `meta`   → categories/brands/units/origins/qualities lookups (long-lived).
 * - `detail` → a single product with its lazy-loaded relations (compatibilities).
 *
 * `meta` is deliberately NOT nested under the `list` key, so invalidating the
 * list after saving one product never forces a re-read of the static lookups.
 */
export const productKeys = {
  all: ["products"] as const,
  list: () => [...productKeys.all, "list"] as const,
  count: () => [...productKeys.all, "count"] as const,
  meta: () => [...productKeys.all, "meta"] as const,
  detail: (id: string) => [...productKeys.all, "detail", id] as const,
};

export const supplierKeys = {
  all: ["suppliers"] as const,
  list: () => [...supplierKeys.all, "list"] as const,
  detail: (id: string) => [...supplierKeys.all, "detail", id] as const,
};

export const customerKeys = {
  all: ["customers"] as const,
  list: () => [...customerKeys.all, "list"] as const,
  detail: (id: string) => [...customerKeys.all, "detail", id] as const,
};

export const catalogKeys = {
  all: ["catalog"] as const,
  metrics: () => [...catalogKeys.all, "metrics"] as const,
  tab: (tab: string) => [...catalogKeys.all, tab] as const,
};

export const inventoryKeys = {
  all: ["inventory"] as const,
  itemIds: () => [...inventoryKeys.all, "item-ids"] as const,
  value: () => [...inventoryKeys.all, "value"] as const,
  /** One stream per warehouse — the warehouse changes which rows are returned. */
  list: (warehouseId?: string) => [...inventoryKeys.all, "list", warehouseId ?? "all"] as const,
};

export const transferKeys = {
  all: ["transfers"] as const,
  list: () => [...transferKeys.all, "list"] as const,
};

/* ------------------------------------------------------------------ */
/*  Cache lifecycle helpers                                            */
/* ------------------------------------------------------------------ */

/**
 * Root keys of every cache entry that holds tenant-scoped business rows.
 *
 * The QueryClient is *session memory*, not an offline store, and the app has no
 * persisted cache — but the default `staleTime` is 2 minutes, so without an
 * explicit clear a second user signing in on the same terminal can briefly see
 * the previous session's rows before the first refetch resolves.
 *
 * Static reference data with no tenant-scoped rows in it (taxonomy lookups,
 * route-preload metadata) is intentionally left in place.
 */
const SESSION_VARIANT_PREFIXES: readonly string[] = [
  "products",
  "customers",
  "suppliers",
  "inventory",
  "invoices",
  "sales",
  "settlements",
  "transfers",
  "dashboard",
  "analytics",
  "expenses",
  "payments",
  "debts",
  "opening",
  // The payment-method catalogue carries the business's OWN names, icons and
  // enabled set (`payment_method_settings`). Leaving it cached across an
  // identity change would show the previous business's method names in the
  // picker — and its enabled/disabled choices — until the 30-minute staleTime
  // expired. The developer catalogue is identical for everyone, but the merge
  // is not, and the key cannot distinguish the two.
  "payment-methods",
];

/**
 * Removes every cached business record for the session that just ended.
 *
 * Call this on sign-out and whenever the signed-in identity/company changes,
 * *before* the next screen renders. It never touches in-flight writes (the
 * offline sync engine keeps its own queue) — it only drops read results that
 * belong to the previous identity.
 */
export function clearSessionQueryCache(queryClient: {
  removeQueries: (filters?: {
    predicate?: (query: { queryKey: readonly unknown[] }) => boolean;
  }) => void;
}): void {
  queryClient.removeQueries({
    predicate: (query) => {
      const root = query.queryKey[0];
      return typeof root === "string" && SESSION_VARIANT_PREFIXES.includes(root);
    },
  });
}

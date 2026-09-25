/**
 * Phase 4: Centralized Query Keys for Granular Cache Invalidation and SWR
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
};

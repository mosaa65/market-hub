/**
 * Column registry — which fields a screen may show, hide and remember.
 *
 * The plan (§9.1) asks for a "Visible columns" control that is *the same
 * control* on every list, backed by a per-record-type registry that refuses to
 * hide the identifying column or the actions column.
 *
 * Why a registry rather than deriving the list from `DataTableColumn[]`:
 *
 *  - A `DataTableColumn` carries `cell`/`sortValue` renderers, so it cannot be
 *    serialised or compared. The user's choice has to be stored as plain keys,
 *    which means the set of choosable keys must be declared separately from the
 *    renderers that implement them.
 *  - A derived list cannot express "this column is optional *and* starts
 *    hidden", "this one is essential", or give a column a plain-language label
 *    that differs from its spreadsheet-ish header.
 *
 * The registry is data only — no React, no Supabase — so it can be unit tested
 * and read by both the toolbar and the table.
 */

/** One choosable column on a screen. */
export interface ColumnDefinition {
  /** Stable key; must match the `DataTableColumn.key` it controls. */
  key: string;
  /** Plain-language label shown in the picker. */
  labelAr: string;
  labelEn: string;
  /**
   * Essential columns can never be hidden. The registry *enforces* this: a
   * stored preference claiming `essential: true` is ignored, so a bad value in
   * `localStorage` (or a hand-edited one) cannot produce a table with no name
   * and no actions.
   */
  essential?: boolean;
  /** Shown when the user has no saved preference. */
  defaultVisible: boolean;
  /** Grouping inside the picker, so 20 fields do not arrive as one flat list. */
  groupAr?: string;
  groupEn?: string;
  /** Search terms beyond the label (e.g. the Arabic synonym of a Latin key). */
  keywords?: string[];
}

export interface ColumnRegistry {
  /** Record type id, also used as part of the storage key. */
  id: string;
  columns: ColumnDefinition[];
}

/** The user's resolved visibility map for one screen. */
export type ColumnVisibility = Record<string, boolean>;

/** Defaults derived from a registry. */
export function defaultVisibility(registry: ColumnRegistry): ColumnVisibility {
  const result: ColumnVisibility = {};
  for (const column of registry.columns) {
    result[column.key] = column.essential ? true : column.defaultVisible;
  }
  return result;
}

/**
 * Merge a stored/preferred map over the registry.
 *
 * Rules, in order:
 *  1. Essential columns are always `true` — a stored `false` is discarded
 *     rather than trusted.
 *  2. A key that no longer exists in the registry is dropped, so removing a
 *     field from a screen does not leave a phantom preference behind.
 *  3. A key that is new in the registry takes its declared default, so adding a
 *     column does not make it invisible for existing users.
 */
export function resolveVisibility(
  registry: ColumnRegistry,
  stored?: ColumnVisibility | null,
): ColumnVisibility {
  const resolved = defaultVisibility(registry);
  if (!stored) return resolved;

  for (const column of registry.columns) {
    if (column.essential) {
      resolved[column.key] = true;
      continue;
    }
    const value = stored[column.key];
    if (typeof value === "boolean") resolved[column.key] = value;
  }

  return resolved;
}

/** True when the caller's map differs from the registry defaults. */
export function isCustomized(registry: ColumnRegistry, visibility: ColumnVisibility): boolean {
  const defaults = defaultVisibility(registry);
  return registry.columns.some(
    (column) => Boolean(visibility[column.key]) !== Boolean(defaults[column.key]),
  );
}

/* ------------------------------------------------------------------ */
/*  Persistence — per user, per screen, local only                     */
/* ------------------------------------------------------------------ */

const STORAGE_PREFIX = "market-hub:columns:v1";

function storageKey(screen: string) {
  return `${STORAGE_PREFIX}:${screen}`;
}

export function readColumnVisibility(screen: string, registry: ColumnRegistry): ColumnVisibility {
  if (typeof window === "undefined") return defaultVisibility(registry);
  try {
    const raw = window.localStorage.getItem(storageKey(screen));
    if (!raw) return defaultVisibility(registry);
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return defaultVisibility(registry);
    return resolveVisibility(registry, parsed as ColumnVisibility);
  } catch {
    return defaultVisibility(registry);
  }
}

export function writeColumnVisibility(screen: string, visibility: ColumnVisibility) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey(screen), JSON.stringify(visibility));
  } catch {
    // Storage blocked/full: the choice still applies for this session.
  }
}

export function clearColumnVisibility(screen: string, registry: ColumnRegistry): ColumnVisibility {
  if (typeof window !== "undefined") {
    try {
      window.localStorage.removeItem(storageKey(screen));
    } catch {
      // best effort
    }
  }
  return defaultVisibility(registry);
}

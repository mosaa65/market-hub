import { useCallback, useMemo, useState } from "react";

import {
  clearColumnVisibility,
  defaultVisibility,
  isCustomized,
  readColumnVisibility,
  resolveVisibility,
  writeColumnVisibility,
  type ColumnRegistry,
  type ColumnVisibility,
} from "@/lib/records/column-registry";

/**
 * Ties a screen to its column registry.
 *
 * Returns the resolved visibility map (essentials forced on), a setter, a reset,
 * and the list of columns the picker should offer. The storage key is the
 * registry id, so two screens that show the same record type share one
 * preference and a screen cannot read another's.
 *
 * Storage is read lazily in the state initialiser, which is safe under SSR
 * (`typeof window` guard inside the reader).
 */
export interface UseColumnVisibilityResult {
  /** Resolved map — essentials already forced to `true`. */
  visibility: ColumnVisibility;
  /** True when the current map differs from the registry defaults. */
  customized: boolean;
  toggle: (key: string) => void;
  /** Reset to the registry defaults and drop the stored preference. */
  reset: () => void;
  /** The columns the picker may offer, in registry order. */
  available: ColumnRegistry["columns"];
}

export function useColumnVisibility(
  screen: string,
  registry: ColumnRegistry,
): UseColumnVisibilityResult {
  const [visibility, setVisibility] = useState<ColumnVisibility>(() =>
    readColumnVisibility(screen, registry),
  );

  const toggle = useCallback(
    (key: string) => {
      setVisibility((prev) => {
        // An essential column is not toggleable. The registry is the authority,
        // so a click on it is a no-op rather than a hidden column.
        const column = registry.columns.find((c) => c.key === key);
        if (!column || column.essential) return prev;

        const next = resolveVisibility(registry, { ...prev, [key]: !prev[key] });
        writeColumnVisibility(screen, next);
        return next;
      });
    },
    [registry, screen],
  );

  const reset = useCallback(() => {
    setVisibility(clearColumnVisibility(screen, registry));
  }, [registry, screen]);

  const customized = useMemo(() => isCustomized(registry, visibility), [registry, visibility]);

  return {
    visibility,
    customized,
    toggle,
    reset,
    available: registry.columns,
  };
}

export { defaultVisibility };

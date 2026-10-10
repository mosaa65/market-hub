import { useState, useCallback } from "react";

/**
 * Persists view mode (cards, list, table/classic) per page in localStorage.
 * Each page has an isolated key (e.g. `vortex_view_mode_sales`, `vortex_view_mode_purchases`).
 *
 * @param pageKey Unique key for the route/page
 * @param defaultMode Initial default mode if nothing saved in localStorage
 * @param allowedModes Optional list of permitted modes
 */
export function useStoredViewMode<T extends string>(
  pageKey: string,
  defaultMode: T,
  allowedModes?: readonly T[],
): [T, (mode: T | ((prev: T) => T)) => void] {
  const storageKey = `vortex_view_mode_${pageKey}`;

  const [mode, setModeState] = useState<T>(() => {
    if (typeof window === "undefined") return defaultMode;
    try {
      const saved = window.localStorage.getItem(storageKey);
      if (saved && (!allowedModes || (allowedModes as readonly string[]).includes(saved))) {
        return saved as T;
      }
    } catch {
      // Ignore localStorage access errors (e.g. private browsing mode)
    }
    return defaultMode;
  });

  const setMode = useCallback(
    (action: T | ((prev: T) => T)) => {
      setModeState((prev) => {
        const next = typeof action === "function" ? (action as (prev: T) => T)(prev) : action;
        try {
          if (typeof window !== "undefined") {
            window.localStorage.setItem(storageKey, next);
          }
        } catch {
          // Ignore storage write errors
        }
        return next;
      });
    },
    [storageKey],
  );

  return [mode, setMode];
}

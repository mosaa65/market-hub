import { useCallback, useState } from "react";

import type { RecordsViewMode } from "@/components/ui/records-view";

/**
 * Persisted records-view mode.
 *
 * The cards/list/table toggle used to reset to "cards" on every mount, so
 * leaving a screen and coming back silently discarded the user's choice. This
 * hook keeps the selection in `localStorage` under a per-screen key, so the
 * last mode a user picked on a given screen is restored the next time that
 * screen mounts — including after navigating to another page and back.
 *
 * The key is per-screen (`vortex_view_mode:<screen>`) on purpose: choosing
 * "list" on Batches must not force "list" on Settlements.
 *
 * The initial read is guarded by `typeof window` so it is safe under SSR, and
 * an unreadable/foreign stored value falls back to `fallback` rather than
 * rendering an invalid mode.
 */
export function usePersistedViewMode(
  screen: string,
  fallback: RecordsViewMode = "cards",
): [RecordsViewMode, (mode: RecordsViewMode) => void] {
  const storageKey = `vortex_view_mode:${screen}`;

  const [viewMode, setViewMode] = useState<RecordsViewMode>(() => {
    if (typeof window === "undefined") return fallback;
    try {
      const stored = window.localStorage.getItem(storageKey);
      if (stored === "cards" || stored === "list" || stored === "table") return stored;
    } catch {
      // Storage can be unavailable (private mode / blocked cookies) — fall back.
    }
    return fallback;
  });

  const setMode = useCallback(
    (mode: RecordsViewMode) => {
      setViewMode(mode);
      if (typeof window === "undefined") return;
      try {
        window.localStorage.setItem(storageKey, mode);
      } catch {
        // Persisting is best-effort; the in-memory selection still works.
      }
    },
    [storageKey],
  );

  return [viewMode, setMode];
}

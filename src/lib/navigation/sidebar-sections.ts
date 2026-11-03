import { useCallback, useEffect, useState } from "react";

/**
 * Collapsible sidebar sections — persisted per user and per device.
 *
 * The plan (§4.1) asks for three things that only make sense together:
 *
 *  1. Every main section gets its own open/closed state, keyed by the section
 *     name — not by index, so re-ordering `SIDEBAR_SECTION_ORDER` cannot make a
 *     user's saved choice land on the wrong section.
 *  2. The state survives a reload. It is a UI preference, so it lives in
 *     `localStorage` and never touches the server (this is exactly the
 *     "non-commercial UI preference" exception in §5.1/§3).
 *  3. The section containing the *active* screen is always open, so navigating
 *     to a page can never leave its own link hidden inside a collapsed group.
 *
 * The storage key is scoped by user id, so two staff members sharing one
 * counter PC do not inherit each other's layout.
 */
const STORAGE_PREFIX = "vortex_sidebar_sections:";

export type SidebarSectionState = Record<string, boolean>;

function storageKey(userId?: string | null) {
  return `${STORAGE_PREFIX}${userId ?? "anon"}`;
}

/** Returns `{}` for a missing/corrupt value — an unreadable preference must not
 *  break the navigation. */
export function readSidebarSectionState(userId?: string | null): SidebarSectionState {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(storageKey(userId));
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return {};
    const result: SidebarSectionState = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === "boolean") result[key] = value;
    }
    return result;
  } catch {
    return {};
  }
}

export function writeSidebarSectionState(
  userId: string | null | undefined,
  state: SidebarSectionState,
) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey(userId), JSON.stringify(state));
  } catch {
    // Best-effort: a blocked/limited storage keeps the state for this session.
  }
}

export interface UseSidebarSectionsOptions {
  userId?: string | null;
  /** Section keys that must stay open because they contain the active route. */
  forceOpenKeys?: string[];
  /**
   * Default for a section the user has never touched. The active section is
   * open, everything else starts collapsed, which keeps a long sidebar short on
   * first run instead of showing 40 links at once.
   */
  defaultOpen?: (key: string) => boolean;
}

export interface UseSidebarSectionsResult {
  isOpen: (key: string) => boolean;
  toggle: (key: string) => void;
  /** Opens a section without collapsing the others. */
  open: (key: string) => void;
}

export function useSidebarSections({
  userId,
  forceOpenKeys = [],
  defaultOpen,
}: UseSidebarSectionsOptions): UseSidebarSectionsResult {
  const [state, setState] = useState<SidebarSectionState>(() => readSidebarSectionState(userId));

  // Re-read when a different user signs in on the same machine.
  useEffect(() => {
    setState(readSidebarSectionState(userId));
  }, [userId]);

  const forced = new Set(forceOpenKeys);

  const isOpen = useCallback(
    (key: string) => {
      if (forced.has(key)) return true;
      const stored = state[key];
      if (typeof stored === "boolean") return stored;
      return defaultOpen ? defaultOpen(key) : forced.has(key);
    },
    // `forced` is rebuilt per render; its identity is not part of the contract.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state, forceOpenKeys.join("|"), defaultOpen],
  );

  const persist = useCallback(
    (next: SidebarSectionState) => {
      setState(next);
      writeSidebarSectionState(userId, next);
    },
    [userId],
  );

  const toggle = useCallback(
    (key: string) => {
      setState((prev) => {
        const currentlyOpen = forced.has(key)
          ? true
          : typeof prev[key] === "boolean"
            ? prev[key]
            : (defaultOpen?.(key) ?? false);
        const next = { ...prev, [key]: !currentlyOpen };
        writeSidebarSectionState(userId, next);
        return next;
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [userId, forceOpenKeys.join("|"), defaultOpen],
  );

  const open = useCallback(
    (key: string) => {
      persist({ ...state, [key]: true });
    },
    [persist, state],
  );

  return { isOpen, toggle, open };
}

/**
 * Which section key holds a given pathname.
 *
 * The active section must be forced open, and the sidebar builds its keys from
 * `SIDEBAR_SECTION_ORDER` — so the mapping is looked up from the same list the
 * sidebar renders rather than from the path's first segment, because several
 * sections share a first segment (`/settings` lives under "settings" while
 * `/milling/*` spans "milling").
 */
export function resolveActiveSectionKey(params: {
  pathname: string;
  sections: { key: string; paths: string[] }[];
}): string | null {
  const { pathname, sections } = params;
  let best: { key: string; length: number } | null = null;

  for (const section of sections) {
    for (const path of section.paths) {
      const clean = path.split("?")[0];
      const matches = pathname === clean || pathname.startsWith(`${clean}/`);
      if (!matches) continue;
      if (!best || clean.length > best.length) {
        best = { key: section.key, length: clean.length };
      }
    }
  }

  return best?.key ?? null;
}

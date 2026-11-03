import { useCallback, useEffect, useState } from "react";
import type { SidebarViewMode } from "./sidebar-views";

const STORAGE_PREFIX = "vortex_sidebar_preferences_v1:";
const VALID_MODES = new Set<SidebarViewMode>(["daily", "activity", "focus", "explorer"]);
const VALID_ICON_SHAPES = new Set(["rounded", "circle"]);
const VALID_ICON_COLOR_MODES = new Set(["system", "activity", "custom"]);

export interface SidebarPreferences {
  mode: SidebarViewMode;
  focusGroup: string;
  explorerGroup: string | null;
  favorites: string[];
  recentIds: string[];
  collapsedSections: Record<string, boolean>;
  iconShape: "rounded" | "circle";
  iconColorMode: "system" | "activity" | "custom";
  customIconColors: Record<string, string>;
  showFavorites: boolean;
  showRecent: boolean;
  defaultExpanded: "active" | "all" | "none";
}

export const DEFAULT_SIDEBAR_PREFERENCES: SidebarPreferences = {
  mode: "daily",
  focusGroup: "sales",
  explorerGroup: null,
  favorites: [],
  recentIds: [],
  collapsedSections: {},
  iconShape: "rounded",
  iconColorMode: "activity",
  customIconColors: {},
  showFavorites: true,
  showRecent: true,
  defaultExpanded: "active",
};

function storageKey(userId?: string | null) {
  return `${STORAGE_PREFIX}${userId ?? "anon"}`;
}

export function parseSidebarPreferences(raw: string | null): SidebarPreferences {
  if (!raw) return { ...DEFAULT_SIDEBAR_PREFERENCES };
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) {
      return { ...DEFAULT_SIDEBAR_PREFERENCES };
    }
    const value = parsed as Record<string, unknown>;
    const collapsedSections: Record<string, boolean> = {};
    const customIconColors: Record<string, string> = {};
    if (typeof value.collapsedSections === "object" && value.collapsedSections !== null) {
      for (const [key, open] of Object.entries(value.collapsedSections)) {
        if (typeof open === "boolean") collapsedSections[key] = open;
      }
    }
    if (typeof value.customIconColors === "object" && value.customIconColors !== null) {
      for (const [key, color] of Object.entries(value.customIconColors)) {
        if (typeof color === "string" && /^[a-z]+$/.test(color)) customIconColors[key] = color;
      }
    }
    return {
      mode: VALID_MODES.has(value.mode as SidebarViewMode)
        ? (value.mode as SidebarViewMode)
        : DEFAULT_SIDEBAR_PREFERENCES.mode,
      focusGroup:
        typeof value.focusGroup === "string"
          ? value.focusGroup
          : DEFAULT_SIDEBAR_PREFERENCES.focusGroup,
      explorerGroup: typeof value.explorerGroup === "string" ? value.explorerGroup : null,
      favorites: uniqueStrings(value.favorites),
      recentIds: uniqueStrings(value.recentIds).slice(0, 5),
      collapsedSections,
      iconShape: VALID_ICON_SHAPES.has(value.iconShape as string)
        ? (value.iconShape as "rounded" | "circle")
        : DEFAULT_SIDEBAR_PREFERENCES.iconShape,
      iconColorMode: VALID_ICON_COLOR_MODES.has(value.iconColorMode as string)
        ? (value.iconColorMode as "system" | "activity" | "custom")
        : DEFAULT_SIDEBAR_PREFERENCES.iconColorMode,
      customIconColors,
      showFavorites:
        typeof value.showFavorites === "boolean"
          ? value.showFavorites
          : DEFAULT_SIDEBAR_PREFERENCES.showFavorites,
      showRecent:
        typeof value.showRecent === "boolean"
          ? value.showRecent
          : DEFAULT_SIDEBAR_PREFERENCES.showRecent,
      defaultExpanded: ["active", "all", "none"].includes(value.defaultExpanded as string)
        ? (value.defaultExpanded as "active" | "all" | "none")
        : DEFAULT_SIDEBAR_PREFERENCES.defaultExpanded,
    };
  } catch {
    return { ...DEFAULT_SIDEBAR_PREFERENCES };
  }
}

export function readSidebarPreferences(userId?: string | null): SidebarPreferences {
  if (typeof window === "undefined") return { ...DEFAULT_SIDEBAR_PREFERENCES };
  try {
    return parseSidebarPreferences(window.localStorage.getItem(storageKey(userId)));
  } catch {
    return { ...DEFAULT_SIDEBAR_PREFERENCES };
  }
}

function writeSidebarPreferences(
  userId: string | null | undefined,
  preferences: SidebarPreferences,
) {
  if (typeof window === "undefined") return;
  const key = storageKey(userId);
  try {
    window.localStorage.setItem(key, JSON.stringify(preferences));
  } catch {
    // Preferences remain available for the current session if storage is unavailable.
  }
  queueMicrotask(() => {
    window.dispatchEvent(
      new CustomEvent("vortex-sidebar-preferences-change", {
        detail: { key, preferences },
      }),
    );
  });
}

function uniqueStrings(value: unknown): string[] {
  return Array.isArray(value)
    ? [...new Set(value.filter((item): item is string => typeof item === "string"))]
    : [];
}

export function useSidebarPreferences(userId?: string | null) {
  const [preferences, setPreferences] = useState(() => readSidebarPreferences(userId));

  useEffect(() => {
    setPreferences(readSidebarPreferences(userId));
  }, [userId]);

  useEffect(() => {
    const key = storageKey(userId);
    const syncFromSameTab = (event: Event) => {
      const detail = (event as CustomEvent<{ key: string; preferences: SidebarPreferences }>)
        .detail;
      if (detail?.key === key) setPreferences(detail.preferences);
    };
    const syncFromOtherTab = (event: StorageEvent) => {
      if (event.key === key) setPreferences(parseSidebarPreferences(event.newValue));
    };
    window.addEventListener("vortex-sidebar-preferences-change", syncFromSameTab);
    window.addEventListener("storage", syncFromOtherTab);
    return () => {
      window.removeEventListener("vortex-sidebar-preferences-change", syncFromSameTab);
      window.removeEventListener("storage", syncFromOtherTab);
    };
  }, [userId]);

  const update = useCallback(
    (change: Partial<SidebarPreferences>) => {
      setPreferences((current) => {
        const next = { ...current, ...change };
        writeSidebarPreferences(userId, next);
        return next;
      });
    },
    [userId],
  );

  const toggleFavorite = useCallback(
    (routeId: string) => {
      setPreferences((current) => {
        const favorites = current.favorites.includes(routeId)
          ? current.favorites.filter((id) => id !== routeId)
          : [...current.favorites, routeId];
        const next = { ...current, favorites };
        writeSidebarPreferences(userId, next);
        return next;
      });
    },
    [userId],
  );

  const recordRecent = useCallback(
    (routeId: string) => {
      setPreferences((current) => {
        const next = {
          ...current,
          recentIds: [routeId, ...current.recentIds.filter((id) => id !== routeId)].slice(0, 5),
        };
        writeSidebarPreferences(userId, next);
        return next;
      });
    },
    [userId],
  );

  return { preferences, update, toggleFavorite, recordRecent };
}

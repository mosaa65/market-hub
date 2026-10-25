import { useCompanyCurrency } from "@/hooks/use-company-currency";
import { HeaderNavArrows } from "@/components/header-nav-arrows";
import { Link, useRouterState, useNavigate } from "@tanstack/react-router";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import {
  Bell,
  Check,
  ChevronDown,
  Layers3,
  LogOut,
  Menu,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  RotateCw,
  Sparkles,
  Star,
  Sun,
} from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { canAccessRoute, getRouteRule } from "@/lib/route-access";
import { useAuth } from "@/lib/auth";
import { useModules } from "@/lib/modules";
import { CommandPalette } from "@/components/command-palette";
import { SiteFooter } from "@/components/site-footer";
import { VortexHeaderOmnisearch } from "@/components/vortex-header-omnisearch";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { ConnectionBanner } from "@/components/ui/connection";
import { Hint } from "@/components/ui/hint";
import { useSidebarSections } from "@/lib/navigation/sidebar-sections";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { setCompanySettingsCache } from "@/lib/format";
import { checkBackupReminderStatus } from "@/lib/backup/reminder";
import { useMillingMode, isRouteVisibleByMillingMode } from "@/lib/milling-mode";
import { startAutoBackupScheduler } from "@/lib/backup/auto-scheduler";
import { useTheme } from "@/lib/theme";
import { ThemePaletteQuickSwitcher } from "@/components/theme/theme-palette-quick-switcher";
import { getSidebarSections, type SidebarSection } from "@/lib/navigation";
import { routeIcon } from "@/lib/navigation/route-icons";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  buildSidebarView,
  useSidebarPreferences,
  type SidebarViewGroup,
  type SidebarViewMode,
  type SidebarPreferences,
} from "@/lib/navigation";

const CATEGORY_STYLES: Record<
  string,
  {
    iconBoxActive: string;
    iconBoxInactive: string;
    iconActive: string;
    iconInactive: string;
    accentPill: string;
    activeBg: string;
  }
> = {
  command_center: {
    iconBoxActive: "bg-primary/20 text-primary ring-1 ring-primary/40",
    iconBoxInactive: "bg-primary/10 text-primary group-hover:bg-primary/20",
    iconActive: "text-primary stroke-[2.4]",
    iconInactive: "text-primary/75 group-hover:scale-110",
    accentPill: "bg-primary",
    activeBg: "bg-gradient-to-r from-primary/15 via-primary/5 to-transparent border-primary/20",
  },
  sales: {
    iconBoxActive: "bg-emerald-500/20 text-emerald-500 ring-1 ring-emerald-500/40",
    iconBoxInactive:
      "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 group-hover:bg-emerald-500/20",
    iconActive: "text-emerald-500 stroke-[2.4]",
    iconInactive: "text-emerald-600 dark:text-emerald-400 group-hover:scale-110",
    accentPill: "bg-emerald-500",
    activeBg:
      "bg-gradient-to-r from-emerald-500/15 via-emerald-500/5 to-transparent border-emerald-500/20",
  },
  inventory: {
    iconBoxActive: "bg-cyan-500/20 text-cyan-500 ring-1 ring-cyan-500/40",
    iconBoxInactive: "bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 group-hover:bg-cyan-500/20",
    iconActive: "text-cyan-500 stroke-[2.4]",
    iconInactive: "text-cyan-600 dark:text-cyan-400 group-hover:scale-110",
    accentPill: "bg-cyan-500",
    activeBg: "bg-gradient-to-r from-cyan-500/15 via-cyan-500/5 to-transparent border-cyan-500/20",
  },
  procurement: {
    iconBoxActive: "bg-amber-500/20 text-amber-500 ring-1 ring-amber-500/40",
    iconBoxInactive:
      "bg-amber-500/10 text-amber-600 dark:text-amber-400 group-hover:bg-amber-500/20",
    iconActive: "text-amber-500 stroke-[2.4]",
    iconInactive: "text-amber-600 dark:text-amber-400 group-hover:scale-110",
    accentPill: "bg-amber-500",
    activeBg:
      "bg-gradient-to-r from-amber-500/15 via-amber-500/5 to-transparent border-amber-500/20",
  },
  finance: {
    iconBoxActive: "bg-violet-500/20 text-violet-500 ring-1 ring-violet-500/40",
    iconBoxInactive:
      "bg-violet-500/10 text-violet-600 dark:text-violet-400 group-hover:bg-violet-500/20",
    iconActive: "text-violet-500 stroke-[2.4]",
    iconInactive: "text-violet-600 dark:text-violet-400 group-hover:scale-110",
    accentPill: "bg-violet-500",
    activeBg:
      "bg-gradient-to-r from-violet-500/15 via-violet-500/5 to-transparent border-violet-500/20",
  },
  milling: {
    iconBoxActive: "bg-orange-500/20 text-orange-500 ring-1 ring-orange-500/40",
    iconBoxInactive:
      "bg-orange-500/10 text-orange-600 dark:text-orange-400 group-hover:bg-orange-500/20",
    iconActive: "text-orange-500 stroke-[2.4]",
    iconInactive: "text-orange-600 dark:text-orange-400 group-hover:scale-110",
    accentPill: "bg-orange-500",
    activeBg:
      "bg-gradient-to-r from-orange-500/15 via-orange-500/5 to-transparent border-orange-500/20",
  },
  reports: {
    iconBoxActive: "bg-blue-500/20 text-blue-500 ring-1 ring-blue-500/40",
    iconBoxInactive: "bg-blue-500/10 text-blue-600 dark:text-blue-400 group-hover:bg-blue-500/20",
    iconActive: "text-blue-500 stroke-[2.4]",
    iconInactive: "text-blue-600 dark:text-blue-400 group-hover:scale-110",
    accentPill: "bg-blue-500",
    activeBg: "bg-blue-500/10 border-blue-500/20",
  },
  statements: {
    iconBoxActive: "bg-teal-500/20 text-teal-500 ring-1 ring-teal-500/40",
    iconBoxInactive: "bg-teal-500/10 text-teal-600 dark:text-teal-400 group-hover:bg-teal-500/20",
    iconActive: "text-teal-500 stroke-[2.4]",
    iconInactive: "text-teal-600 dark:text-teal-400 group-hover:scale-110",
    accentPill: "bg-teal-500",
    activeBg: "bg-teal-500/10 border-teal-500/20",
  },
  admin: {
    iconBoxActive: "bg-rose-500/20 text-rose-500 ring-1 ring-rose-500/40",
    iconBoxInactive: "bg-rose-500/10 text-rose-600 dark:text-rose-400 group-hover:bg-rose-500/20",
    iconActive: "text-rose-500 stroke-[2.4]",
    iconInactive: "text-rose-600 dark:text-rose-400 group-hover:scale-110",
    accentPill: "bg-rose-500",
    activeBg: "bg-gradient-to-r from-rose-500/15 via-rose-500/5 to-transparent border-rose-500/20",
  },
  settings: {
    iconBoxActive: "bg-teal-500/20 text-teal-500 ring-1 ring-teal-500/40",
    iconBoxInactive: "bg-teal-500/10 text-teal-600 dark:text-teal-400 group-hover:bg-teal-500/20",
    iconActive: "text-teal-500 stroke-[2.4]",
    iconInactive: "text-teal-600 dark:text-teal-400 group-hover:scale-110",
    accentPill: "bg-teal-500",
    activeBg: "bg-gradient-to-r from-teal-500/15 via-teal-500/5 to-transparent border-teal-500/20",
  },
};

const CUSTOM_STYLE_CATEGORIES: Record<string, string> = {
  emerald: "sales",
  cyan: "inventory",
  amber: "procurement",
  blue: "command_center",
  rose: "admin",
  teal: "settings",
  orange: "milling",
  violet: "finance",
};

function getSidebarStyle(category: string, groupKey: string, preferences: SidebarPreferences) {
  const customStyle = CUSTOM_STYLE_CATEGORIES[preferences.customIconColors[groupKey] ?? ""];
  const styleCategory =
    preferences.iconColorMode === "system"
      ? "command_center"
      : preferences.iconColorMode === "custom"
        ? (customStyle ?? category)
        : category;
  return CATEGORY_STYLES[styleCategory] ?? CATEGORY_STYLES.command_center;
}

const SidebarContents = memo(function SidebarContents({
  onNavigate,
  collapsed = false,
  onToggleCollapse,
}: {
  onNavigate?: () => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}) {
  const { t, dir, lang } = useI18n();
  const isAr = lang === "ar";

  const { user, signOut, isPlatformAdmin, isPlatformSuperadmin, roles } = useAuth();
  const { preferences, update, toggleFavorite, recordRecent } = useSidebarPreferences(user?.id);

  const { isModuleEnabled } = useModules();

  const navigate = useNavigate();

  // Must be passed as an options object with a `select` selector. Passing a bare
  // function leaves `select` undefined, so the hook returns the whole RouterState
  // object and `pathname.startsWith(...)` below throws
  // "TypeError: pathname.startsWith is not a function".
  const pathname = useRouterState({
    select: (s) => s.location.pathname,
  });

  /** معاملات الرابط الحالية، لتفعيل عناصر الإعدادات والتقارير بدقة. */
  const currentSearch = useRouterState({
    select: (s) => s.location.searchStr ?? "",
  });
  const currentSearchParams = useMemo(() => new URLSearchParams(currentSearch), [currentSearch]);
  const currentSection = currentSearchParams.get("section");

  // Navigation belongs to the application itself, not to an individual tenant.
  // The company logo remains available in invoices and printable documents.
  const logoUrl = "/vortex-erp-mark.png";

  const { mode: millingMode } = useMillingMode();

  const filteredSections = useMemo<SidebarSection[]>(() => {
    return getSidebarSections({
      isModuleEnabled,
      isVisibleByMillingMode: (path) => isRouteVisibleByMillingMode(path, millingMode),
      canAccess: (entry) =>
        canAccessRoute(entry.path.split("?")[0], { roles, isPlatformAdmin, isPlatformSuperadmin }),
    });
  }, [isModuleEnabled, isPlatformAdmin, isPlatformSuperadmin, roles, millingMode]);

  /*
   * Collapsible sections (§4.1).
   *
   * `key` is the route category, not the array index, so reordering the sidebar
   * cannot apply a saved choice to the wrong section. The section that holds
   * the current screen is force-opened: navigating into a page must never leave
   * its own link hidden inside a collapsed group.
   */
  const { groups: viewGroups, availableFocusGroups } = useMemo(
    () =>
      buildSidebarView(
        filteredSections,
        preferences.mode,
        preferences.mode === "explorer" ? preferences.explorerGroup : preferences.focusGroup,
      ),
    [filteredSections, preferences.mode, preferences.focusGroup, preferences.explorerGroup],
  );

  // مجدول النسخ الاحتياطي التلقائي — يعمل مرة واحدة عند إقلاع التطبيق
  useEffect(() => {
    startAutoBackupScheduler();
  }, []);

  useEffect(() => {
    if (
      preferences.mode === "explorer" &&
      preferences.explorerGroup &&
      !availableFocusGroups.some((group) => group.key === preferences.explorerGroup)
    ) {
      update({ explorerGroup: null });
    }
    if (
      preferences.mode === "focus" &&
      preferences.focusGroup &&
      !availableFocusGroups.some((group) => group.key === preferences.focusGroup)
    ) {
      update({
        focusGroup:
          availableFocusGroups.find((group) => group.key !== "command_center")?.key ??
          availableFocusGroups[0]?.key ??
          "command_center",
      });
    }
  }, [
    availableFocusGroups,
    preferences.explorerGroup,
    preferences.focusGroup,
    preferences.mode,
    update,
  ]);

  const activeGroupKey = useMemo(() => {
    return (
      availableFocusGroups.find((group) =>
        group.entries.some(
          (entry) =>
            pathname === entry.path.split("?")[0] ||
            (entry.path.split("?")[0] !== "/dashboard" &&
              pathname.startsWith(`${entry.path.split("?")[0]}/`)),
        ),
      )?.key ?? null
    );
  }, [availableFocusGroups, pathname]);

  const activeRouteId = useMemo(() => {
    const matchingEntries = filteredSections
      .flatMap((section) => section.entries)
      .filter((entry) => {
        const [entryPath, entryQuery] = entry.path.split("?");
        if (
          pathname !== entryPath &&
          (entryPath === "/dashboard" || !pathname.startsWith(`${entryPath}/`))
        ) {
          return false;
        }
        const expectedSearch = new URLSearchParams(entryQuery ?? "");
        return Array.from(expectedSearch.entries()).every(
          ([key, value]) => currentSearchParams.get(key) === value,
        );
      })
      .sort((left, right) => {
        const leftQueryLength = left.path.split("?")[1]?.length ?? 0;
        const rightQueryLength = right.path.split("?")[1]?.length ?? 0;
        return (
          rightQueryLength - leftQueryLength ||
          right.path.split("?")[0].length - left.path.split("?")[0].length
        );
      });
    return matchingEntries[0]?.id ?? null;
  }, [currentSearchParams, filteredSections, pathname]);

  useEffect(() => {
    if (activeRouteId) recordRecent(activeRouteId);
  }, [activeRouteId, recordRecent]);

  const previousFocusPathname = useRef<string | null>(null);
  useEffect(() => {
    const pathnameChanged = previousFocusPathname.current !== pathname;
    previousFocusPathname.current = pathname;
    if (!pathnameChanged) return;
    if (
      preferences.mode === "focus" &&
      activeGroupKey &&
      activeGroupKey !== "command_center" &&
      activeGroupKey !== preferences.focusGroup
    ) {
      update({ focusGroup: activeGroupKey });
    }
  }, [activeGroupKey, pathname, preferences.focusGroup, preferences.mode, update]);

  const visibleEntries = useMemo(
    () => filteredSections.flatMap((section) => section.entries),
    [filteredSections],
  );
  const favoriteEntries = useMemo(
    () =>
      preferences.favorites.flatMap((id) => {
        const entry = visibleEntries.find((candidate) => candidate.id === id);
        return entry ? [entry] : [];
      }),
    [preferences.favorites, visibleEntries],
  );
  const recentEntries = useMemo(
    () =>
      preferences.recentIds.flatMap((id) => {
        if (preferences.favorites.includes(id)) return [];
        const entry = visibleEntries.find((candidate) => candidate.id === id);
        return entry ? [entry] : [];
      }),
    [preferences.favorites, preferences.recentIds, visibleEntries],
  );
  const displayGroups: SidebarViewGroup[] =
    preferences.mode === "explorer"
      ? viewGroups
      : [
          ...(preferences.showFavorites && favoriteEntries.length
            ? [
                {
                  key: "favorites",
                  titleAr: "المفضلة",
                  titleEn: "Favorites",
                  styleCategory: "command_center" as const,
                  entries: favoriteEntries,
                },
              ]
            : []),
          ...(preferences.showRecent && recentEntries.length
            ? [
                {
                  key: "recent",
                  titleAr: "آخر الصفحات",
                  titleEn: "Recent pages",
                  styleCategory: "command_center" as const,
                  entries: recentEntries,
                },
              ]
            : []),
          ...viewGroups,
        ];

  const { isOpen: isSectionOpen, toggle: toggleSection } = useSidebarSections({
    userId: user?.id,
    // لا نجبر القسم النشط على البقاء مفتوحاً؛ زر القسم يجب أن يفتح ويغلق
    // كل الأقسام بنفس السلوك حتى أثناء الوقوف داخل إحدى شاشاته.
    forceOpenKeys: [],
    // First run: only the section you are standing in is expanded.
    defaultOpen: (key) =>
      preferences.defaultExpanded === "all" ||
      (preferences.defaultExpanded === "active" && key === activeGroupKey),
  });

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-sidebar text-sidebar-foreground">
      {/* Sidebar Header with Brand Logo */}
      <div
        className={cn(
          "flex h-16 items-center border-b border-sidebar-border/60 transition-all duration-300",
          collapsed ? "justify-center px-2" : "justify-start gap-2.5 px-4",
        )}
      >
        {collapsed ? (
          <img
            src={logoUrl}
            alt={t("app.name")}
            className="size-9 shrink-0 object-contain"
            onError={(event) => {
              event.currentTarget.style.visibility = "hidden";
            }}
          />
        ) : (
          <>
            {/* شعار مركّب (رمز + كلمة) بجانب النص */}
            <img
              src="/vortex-erp-wordmark.png"
              alt={t("app.name")}
              className="h-9 w-auto shrink-0 object-contain"
              onError={(event) => {
                event.currentTarget.style.visibility = "hidden";
              }}
            />
            <span className="text-base font-extrabold tracking-tight text-foreground">فورتكس</span>
          </>
        )}
      </div>

      {/* Navigation Links */}
      <nav
        className={cn(
          "flex-1 min-h-0 overflow-y-auto overflow-x-hidden overscroll-contain custom-scrollbar",
          collapsed ? "px-2 py-3 space-y-2" : "px-3 py-3.5 space-y-2.5",
        )}
      >
        <div className={cn("mb-3 space-y-2", collapsed && "mb-1 flex justify-center")}>
          <DropdownMenu>
            <Hint
              label={collapsed ? t("nav.view.selector") : undefined}
              side={dir === "rtl" ? "left" : "right"}
            >
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className={cn(
                    "flex min-h-10 items-center rounded-lg border border-sidebar-border/70 bg-sidebar-accent/35 text-start text-xs font-semibold text-foreground transition-colors hover:bg-sidebar-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
                    collapsed ? "w-10 justify-center p-0" : "w-full gap-2 px-3",
                  )}
                  aria-label={t("nav.view.selector")}
                >
                  <Layers3 className="size-4 shrink-0 text-primary" />
                  {!collapsed && (
                    <>
                      <span className="min-w-0 flex-1 truncate">{t("nav.view.selector")}</span>
                      <span className="truncate text-[11px] font-medium text-muted-foreground">
                        {t(`nav.view.${preferences.mode}`)}
                      </span>
                      <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
                    </>
                  )}
                </button>
              </DropdownMenuTrigger>
            </Hint>
            <DropdownMenuContent align={dir === "rtl" ? "end" : "start"} className="w-60">
              <DropdownMenuLabel>{t("nav.view.selector")}</DropdownMenuLabel>
              {(["daily", "activity", "focus", "explorer"] as SidebarViewMode[]).map((mode) => (
                <DropdownMenuItem
                  key={mode}
                  onSelect={() =>
                    update({
                      mode,
                      ...(mode === "explorer" ? { explorerGroup: null } : {}),
                      ...(mode === "focus" && activeGroupKey && activeGroupKey !== "command_center"
                        ? { focusGroup: activeGroupKey }
                        : {}),
                    })
                  }
                >
                  <span className="flex-1">{t(`nav.view.${mode}`)}</span>
                  {preferences.mode === mode && <Check className="size-4 text-primary" />}
                </DropdownMenuItem>
              ))}
              {(preferences.mode === "focus" || preferences.mode === "explorer") && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel>{t("nav.view.choose_unit")}</DropdownMenuLabel>
                  {availableFocusGroups
                    .filter((group) => group.key !== "command_center")
                    .map((group) => (
                      <DropdownMenuItem
                        key={group.key}
                        onSelect={() =>
                          update(
                            preferences.mode === "explorer"
                              ? { explorerGroup: group.key }
                              : { focusGroup: group.key },
                          )
                        }
                      >
                        <span className="flex-1">{t(`nav.view.group.${group.key}`)}</span>
                        {(preferences.mode === "explorer"
                          ? preferences.explorerGroup
                          : preferences.focusGroup) === group.key && (
                          <Check className="size-4 text-primary" />
                        )}
                      </DropdownMenuItem>
                    ))}
                </>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={() => update({ mode: "daily", focusGroup: "sales", explorerGroup: null })}
              >
                {t("nav.view.reset")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          {!collapsed && preferences.mode === "focus" && (
            <div className="flex items-center gap-2 px-1 text-[11px] text-muted-foreground">
              <span className="shrink-0">{t("nav.view.choose_unit")}:</span>
              <span className="truncate font-semibold text-foreground">
                {t(`nav.view.group.${preferences.focusGroup}`)}
              </span>
            </div>
          )}
        </div>
        {displayGroups.map((sec, secIdx) => {
          const sectionKey = sec.key;
          const sectionOpen =
            preferences.mode === "explorer" || collapsed ? true : isSectionOpen(sectionKey);
          const activeInSection = activeGroupKey === sectionKey;

          return (
            <div key={sectionKey}>
              {preferences.mode === "explorer" ? (
                !collapsed && (
                  <div
                    className={cn(
                      "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs font-bold tracking-[0.04em]",
                      activeInSection ? "text-foreground" : "text-muted-foreground",
                    )}
                  >
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary/70" aria-hidden />
                    <span className="min-w-0 flex-1 truncate text-start">
                      {t(
                        sec.key === "favorites"
                          ? "nav.view.favorites"
                          : sec.key === "recent"
                            ? "nav.view.recent"
                            : `nav.view.group.${sec.key}`,
                      )}
                    </span>
                  </div>
                )
              ) : !collapsed ? (
                <button
                  type="button"
                  onClick={() => toggleSection(sectionKey)}
                  aria-expanded={sectionOpen}
                  aria-controls={`sidebar-section-${sectionKey}`}
                  className={cn(
                    "flex w-full items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-bold uppercase tracking-[0.12em]",
                    "transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
                    activeInSection
                      ? "text-foreground"
                      : "text-muted-foreground/80 hover:bg-sidebar-accent/60 hover:text-foreground",
                  )}
                >
                  <span className="min-w-0 flex-1 truncate text-start">
                    {t(
                      sec.key === "favorites"
                        ? "nav.view.favorites"
                        : sec.key === "recent"
                          ? "nav.view.recent"
                          : `nav.view.group.${sec.key}`,
                    )}
                  </span>
                  <span
                    className={cn(
                      "grid size-5 shrink-0 place-items-center rounded-md text-muted-foreground/70 transition-transform duration-200",
                      sectionOpen ? "rotate-0" : dir === "rtl" ? "rotate-90" : "-rotate-90",
                    )}
                    aria-hidden
                  >
                    <ChevronDown className="size-3.5" />
                  </span>
                </button>
              ) : (
                secIdx > 0 && <div className="my-2 h-px w-7 mx-auto bg-sidebar-border/60" />
              )}

              <ul
                id={`sidebar-section-${sectionKey}`}
                hidden={!sectionOpen}
                className={cn(collapsed ? "space-y-1.5" : "space-y-1 mt-0.5")}
              >
                {sec.entries.map((it) => {
                  /*
                   * Active-link matching.
                   *
                   * Entries that differ only by `?section=` share one pathname,
                   * so comparing paths alone lit up every settings link at once.
                   * A sectioned entry is active only when its own section is the
                   * selected one; the unsectioned `/settings` entry ("/settings")
                   * stays active for the hub itself.
                   */
                  const [entryPath, entryQuery] = it.path.split("?");
                  const entrySearch = new URLSearchParams(entryQuery ?? "");
                  const hasEntryQuery = Array.from(entrySearch.keys()).length > 0;
                  const queryMatches = Array.from(entrySearch.entries()).every(
                    ([key, value]) => currentSearchParams.get(key) === value,
                  );

                  const active = hasEntryQuery
                    ? pathname === entryPath && queryMatches
                    : entryPath === "/settings"
                      ? // The hub itself: active only when no section is chosen,
                        // otherwise the sectioned link below it takes the mark.
                        pathname === "/settings" && !currentSection
                      : pathname === entryPath ||
                        (entryPath !== "/dashboard" && pathname.startsWith(`${entryPath}/`));
                  const Icon = routeIcon(it.id);
                  const translated = it.i18nKey ? t(it.i18nKey) : undefined;
                  const title =
                    translated && translated !== it.i18nKey
                      ? translated
                      : isAr
                        ? it.titleAr
                        : it.titleEn;
                  const catStyle = getSidebarStyle(sec.styleCategory, sec.key, preferences);
                  const isFavorite = preferences.favorites.includes(it.id);
                  const iconShapeClass =
                    preferences.iconShape === "circle" ? "rounded-full" : "rounded-lg";

                  return (
                    <li key={it.id} className="relative">
                      {/* In the collapsed rail the label must appear on hover —
                       *  a unified tooltip, never a bare `title`. */}
                      <Hint
                        label={collapsed ? title : undefined}
                        side={dir === "rtl" ? "left" : "right"}
                      >
                        <Link
                          /*
                           * `to` هو المسار فقط؛ معاملات كل رابط (قسم إعدادات
                           * أو تقرير محدد) تمرر عبر `search`، وإلا يعاملها
                           * الموجّه كجزء من pathname ولا يجد المسار.
                           */
                          to={entryPath}
                          search={
                            hasEntryQuery
                              ? (Object.fromEntries(entrySearch.entries()) as any)
                              : undefined
                          }
                          onClick={onNavigate}
                          className={cn(
                            "group relative flex items-center transition-all duration-200 outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
                            collapsed
                              ? cn(
                                  "h-10 w-10 mx-auto justify-center p-0",
                                  preferences.iconShape === "circle"
                                    ? "rounded-full"
                                    : "rounded-xl",
                                )
                              : "gap-3 ps-3 pe-10 py-2.5 rounded-xl text-[13.5px] sm:text-sm font-medium",
                            active
                              ? collapsed
                                ? cn("shadow-md ring-2 ring-white/10", catStyle.iconBoxActive)
                                : cn(
                                    "text-foreground font-semibold shadow-sm border",
                                    catStyle.activeBg,
                                  )
                              : collapsed
                                ? "text-muted-foreground hover:bg-surface-2 hover:text-foreground hover:scale-105"
                                : "text-muted-foreground hover:bg-sidebar-accent/70 hover:text-foreground",
                          )}
                        >
                          {active && !collapsed && (
                            <span
                              className={cn(
                                "absolute inset-y-2 w-[3.5px] rounded-full",
                                catStyle.accentPill,
                                dir === "rtl" ? "right-0" : "left-0",
                              )}
                            />
                          )}

                          <div
                            className={cn(
                              "grid place-items-center transition-all duration-200 shrink-0",
                              collapsed
                                ? "h-full w-full"
                                : cn(
                                    cn("h-7 w-7", iconShapeClass),
                                    active ? catStyle.iconBoxActive : catStyle.iconBoxInactive,
                                  ),
                            )}
                          >
                            <Icon
                              className={cn(
                                "shrink-0 transition-all duration-200",
                                collapsed
                                  ? active
                                    ? "h-5 w-5 stroke-[2.4]"
                                    : "h-5 w-5 group-hover:scale-110"
                                  : active
                                    ? cn("h-4 w-4", catStyle.iconActive)
                                    : cn("h-4 w-4", catStyle.iconInactive),
                              )}
                            />
                          </div>

                          {!collapsed && (
                            <span className="truncate leading-tight font-medium group-hover:text-foreground transition-colors">
                              {title}
                            </span>
                          )}
                        </Link>
                      </Hint>
                      {!collapsed && sectionKey !== "recent" && (
                        <Hint
                          label={
                            isFavorite
                              ? isAr
                                ? "إزالة من المفضلة"
                                : "Remove from favorites"
                              : isAr
                                ? "إضافة إلى المفضلة"
                                : "Add to favorites"
                          }
                          side={dir === "rtl" ? "left" : "right"}
                        >
                          <button
                            type="button"
                            onClick={() => toggleFavorite(it.id)}
                            aria-label={
                              isFavorite
                                ? isAr
                                  ? "إزالة من المفضلة"
                                  : "Remove from favorites"
                                : isAr
                                  ? "إضافة إلى المفضلة"
                                  : "Add to favorites"
                            }
                            aria-pressed={isFavorite}
                            className="absolute inset-y-0 end-1 my-auto grid size-8 place-items-center rounded-md text-muted-foreground/70 opacity-70 transition-opacity hover:bg-sidebar-accent hover:text-amber-500 hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 group-hover:opacity-100"
                          >
                            <Star
                              className={cn(
                                "size-3.5",
                                isFavorite && "fill-amber-400 text-amber-500",
                              )}
                            />
                          </button>
                        </Hint>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </nav>

      {/* ERP Tour trigger button */}
      <div className={cn("px-2.5 pb-1", collapsed && "flex justify-center p-2 pb-1")}>
        <button
          type="button"
          onClick={() => {
            window.dispatchEvent(new CustomEvent("open-vortex-welcome"));
            if (onNavigate) onNavigate();
          }}
          className={cn(
            "group relative flex items-center rounded-xl text-xs font-semibold text-muted-foreground hover:bg-primary/10 hover:text-primary transition-all duration-200 border border-transparent hover:border-primary/20",
            collapsed ? "h-9 w-9 justify-center p-0" : "w-full gap-2.5 px-3 py-2",
          )}
          title={isAr ? "جولة في النظام والتعريف بالواجهات" : "ERP Guided Tour"}
          aria-label={isAr ? "جولة في النظام" : "ERP Guided Tour"}
        >
          <div className="grid h-6 w-6 shrink-0 place-items-center rounded-lg bg-primary/15 text-primary">
            <Sparkles className="size-3.5 group-hover:scale-110 transition-transform" />
          </div>
          {!collapsed && (
            <span className="truncate">{isAr ? "جولة في النظام" : "ERP System Tour"}</span>
          )}
        </button>
      </div>

      {/* Footer Profile & Sign Out */}
      <div
        className={cn(
          "border-t border-sidebar-border/60 p-2.5 pb-[max(0.75rem,env(safe-area-inset-bottom,0px))]",
          collapsed && "flex justify-center p-2",
        )}
      >
        <button
          onClick={async () => {
            await signOut();
            navigate({
              to: "/auth",
              replace: true,
            });
          }}
          className={cn(
            "group relative flex items-center rounded-xl text-[13.5px] font-medium text-muted-foreground hover:bg-sidebar-accent hover:text-foreground transition-colors",
            collapsed ? "h-10 w-10 justify-center p-0" : "w-full gap-2.5 px-3 p-2",
          )}
          title={lang === "ar" ? "تسجيل الخروج" : "Sign out"}
        >
          <div className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-gradient-to-br from-primary/20 to-chart-4/20 text-[11px] font-bold text-foreground border border-primary/20">
            {(user?.email ?? "?").charAt(0).toUpperCase()}
          </div>

          {!collapsed && (
            <>
              <span className="min-w-0 flex-1 truncate text-start text-xs font-medium">
                {user?.email}
              </span>

              <LogOut className="h-4 w-4 shrink-0 opacity-60 group-hover:opacity-100 transition" />
            </>
          )}

          {collapsed && (
            <div
              className={cn(
                "pointer-events-none absolute z-50 whitespace-nowrap rounded-xl bg-popover/95 backdrop-blur-md px-3 py-1.5 text-xs font-semibold text-popover-foreground shadow-xl border border-border/80 transition-all duration-150 scale-95 opacity-0 group-hover:scale-100 group-hover:opacity-100",
                dir === "rtl" ? "right-full me-3.5" : "left-full ms-3.5",
              )}
            >
              <span>
                {lang === "ar" ? "تسجيل الخروج" : "Sign out"} ({user?.email})
              </span>

              <div
                className={cn(
                  "absolute top-1/2 -translate-y-1/2 border-[5px] border-transparent",
                  dir === "rtl"
                    ? "left-full -ms-[1px] border-s-popover/95"
                    : "right-full -me-[1px] border-e-popover/95",
                )}
              />
            </div>
          )}
        </button>
      </div>
    </div>
  );
});

export function AppShell({ children }: { children: React.ReactNode }) {
  const { t, dir } = useI18n();

  const navigate = useNavigate();

  const pathname = useRouterState({
    select: (s) => s.location.pathname,
  });

  const isPosRoute =
    pathname === "/pos" ||
    pathname.startsWith("/pos/") ||
    pathname === "/purchase-pos" ||
    pathname.startsWith("/purchase-pos/");

  const [paletteOpen, setPaletteOpen] = useState(false);

  const [mobileOpen, setMobileOpen] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [searchFocused, setSearchFocused] = useState(false);

  // لا يتم تحميل قائمة التنبيهات كاملة داخل الغلاف؛ صفحة التنبيهات هي المسؤولة عن ذلك.
  // إبقاء الملخص بقيمة آمنة يمنع تعطل الغلاف قبل فتح صفحة التنبيهات، بينما يظل
  // تنبيه ��لنسخة الاحتياطية الفوري يعمل بشكل مستقل.
  const alertsSummary = { total: 0, hasDanger: false };

  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("vortex_sidebar_collapsed") === "true";
    }

    return false;
  });

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev;

      if (typeof window !== "undefined") {
        localStorage.setItem("vortex_sidebar_collapsed", String(next));
      }

      return next;
    });
  };

  /* دخول الإعدادات لا يغلق القائمة الجانبية تلقائياً — القائمة تبقى كما
   * تركها المستخدم، ويُغلقها هو بنفسه فقط. */

  // السمة تُقرأ من المزوّد المركزي، لا من حالة محلية هنا: كانت الحالة المحلية
  // تفقد الخيار إذا حُفظت خارج غلاف التطبيق (صفحة الدخول، شاشة البداية).
  const { theme, setTheme } = useTheme();

  // Use centralized company currency with TanStack Query cache (5min staleTime)
  useCompanyCurrency();

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // اختصار لوحة الأوامر الشاملة (Command Palette): Ctrl+Shift+P أو Cmd+Shift+P
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "p") {
        e.preventDefault();
        setPaletteOpen((x) => !x);
      }
    };

    window.addEventListener("keydown", handler);

    return () => window.removeEventListener("keydown", handler);
  }, []);

  const sideEdge = dir === "rtl" ? "border-l" : "border-r";

  return (
    <div className="relative z-10 flex h-[100dvh] w-full overflow-hidden text-foreground ps-[env(safe-area-inset-left,0px)] pe-[env(safe-area-inset-right,0px)]">
      {/* Desktop sidebar */}
      <aside
        className={cn(
          "hidden md:flex h-full shrink-0 flex-col overflow-hidden transition-all duration-300 ease-in-out",

          collapsed ? "w-[72px]" : "w-64",

          sideEdge,
          "border-sidebar-border/60",
        )}
      >
        <SidebarContents collapsed={collapsed} onToggleCollapse={toggleCollapsed} />
      </aside>

      {/* Mobile drawer */}
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent
          side={dir === "rtl" ? "right" : "left"}
          className="w-72 p-0 bg-sidebar border-sidebar-border/60 overflow-hidden flex flex-col pt-[env(safe-area-inset-top,0px)] pb-[env(safe-area-inset-bottom,0px)]"
        >
          <SidebarContents onNavigate={() => setMobileOpen(false)} />
        </SheetContent>
      </Sheet>

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {/* Offline notice — sits above everything in the content column */}
        <ConnectionBanner />

        {/* Top bar */}
        <header className="sticky top-0 z-30 flex min-h-[calc(4rem+env(safe-area-inset-top,0px))] flex-none items-center gap-2.5 border-b border-border/60 bg-background/80 px-4 pt-[env(safe-area-inset-top,0px)] pb-1 backdrop-blur-xl sm:px-6">
          {/* Mobile menu toggle - smoothly hides when search is focused */}
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            className={cn(
              "grid h-10 w-10 shrink-0 place-items-center rounded-full border border-border/60 bg-surface text-muted-foreground transition-all duration-300 hover:border-ring/40 hover:bg-surface-2 hover:text-foreground active:scale-95 md:hidden",
              searchFocused
                ? "w-0 max-w-0 opacity-0 pointer-events-none scale-0 -ms-2"
                : "w-10 opacity-100 scale-100",
            )}
            aria-label={dir === "rtl" ? "فتح القائمة الجانبية" : "Open sidebar"}
          >
            <Menu className="h-4.5 w-4.5" />
          </button>

          {/* Smart back/forward navigation remains available on POS routes. */}
          <HeaderNavArrows />

          {/*
           * Desktop sidebar collapse / expand — the plan's control (§4.2).
           *
           * One icon language, always: a square control with a neutral surface
           * and rounded corners, showing `PanelLeftClose` when the rail is open
           * (pressing it closes) and `PanelLeftOpen` when it is closed. The
           * previous version swapped in a `Menu` glyph on the settings route,
           * so the same button meant two different things on two screens.
           *
           * In RTL the whole control mirrors with the layout, and the icon is
           * flipped so "close" always points at the edge the panel leaves.
           */}
          <button
            type="button"
            onClick={toggleCollapsed}
            className={cn(
              "hidden md:grid h-10 w-10 shrink-0 place-items-center rounded-full border border-border/40 bg-transparent text-muted-foreground backdrop-blur-sm transition-all duration-300 hover:border-ring/40 hover:bg-surface/40 hover:text-foreground active:scale-95",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
              searchFocused && "md:hidden lg:grid",
            )}
            title={
              collapsed
                ? dir === "rtl"
                  ? "توسيع القائمة الجانبية"
                  : "Expand sidebar"
                : dir === "rtl"
                  ? "طي القائمة (أيقونات فقط)"
                  : "Collapse sidebar"
            }
            aria-label={
              collapsed
                ? dir === "rtl"
                  ? "توسيع القائمة الجانبية"
                  : "Expand sidebar"
                : dir === "rtl"
                  ? "طي القائمة (أيقونات فقط)"
                  : "Collapse sidebar"
            }
          >
            {collapsed ? (
              <PanelLeftOpen className="h-4.5 w-4.5 rtl:-scale-x-100" />
            ) : (
              <PanelLeftClose className="h-4.5 w-4.5 rtl:-scale-x-100" />
            )}
          </button>

          <VortexHeaderOmnisearch onFocusChange={setSearchFocused} />

          <div
            className={cn(
              "ms-auto flex items-center gap-2 transition-all duration-300",
              searchFocused
                ? "max-w-0 overflow-hidden opacity-0 pointer-events-none scale-90 sm:max-w-none sm:opacity-100 sm:pointer-events-auto sm:scale-100"
                : "max-w-[300px] opacity-100 scale-100",
            )}
          >
            {/* زر تحديث الصفحة الحالية في نفس المكان بدون انتقال */}
            <button
              type="button"
              onClick={() => {
                setIsRefreshing(true);
                window.location.reload();
              }}
              className="grid h-10 w-10 place-items-center rounded-full border border-border/60 bg-surface text-muted-foreground hover:text-foreground hover:border-ring/40 hover:bg-surface-2 transition-all active:scale-95"
              title={dir === "rtl" ? "تحديث الصفحة الحالية" : "Refresh page"}
              aria-label={dir === "rtl" ? "تحديث الصفحة" : "Refresh"}
            >
              <RotateCw
                className={cn(
                  "h-4 w-4 transition-all duration-300",
                  isRefreshing && "animate-spin text-primary",
                )}
              />
            </button>

            {/* زر اختيار ثيم ولون النظام السريع */}
            <ThemePaletteQuickSwitcher />

            {/* زر تبديل الوضع (فاتح / مظلم) */}
            <button
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              className="grid h-10 w-10 place-items-center rounded-full border border-border/60 bg-surface text-muted-foreground hover:text-foreground hover:border-ring/40 hover:bg-surface-2 transition-all active:scale-95"
              title={t("common.theme")}
              aria-label={t("common.theme")}
            >
              {theme === "dark" ? (
                <Sun className="h-4 w-4 text-amber-400" />
              ) : (
                <Moon className="h-4 w-4 text-sky-500" />
              )}
            </button>

            {/* زر الإشعارات مع الشارة الذكية والرقم الصغير */}
            <button
              className="relative grid h-10 w-10 place-items-center rounded-full border border-border/60 bg-surface text-muted-foreground hover:text-foreground hover:border-ring/40 hover:bg-surface-2 transition-all active:scale-95"
              title={
                checkBackupReminderStatus().isDue
                  ? "تنبيه: حان موعد تنزيل نسخة احتياطية محلية للجهاز!"
                  : alertsSummary?.total
                    ? `لديك ${alertsSummary.total} تنبيهات نشطة`
                    : t("nav.notifications")
              }
              aria-label={t("nav.notifications")}
              onClick={() =>
                navigate({
                  to: "/notifications",
                })
              }
            >
              <Bell className="h-4 w-4" />

              {/* الشارة الذكية: دائرة نابضة للتنبيهات العاجلة ورقم أنيق مصغر */}
              {checkBackupReminderStatus().isDue || alertsSummary?.hasDanger ? (
                <span className="absolute -top-1 -end-1 flex items-center justify-center">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-500 opacity-75" />
                  <span className="relative flex h-4 min-w-[16px] items-center justify-center rounded-full bg-gradient-to-r from-red-600 to-rose-500 px-1 text-[9px] font-extrabold text-white shadow-md ring-2 ring-background">
                    {alertsSummary?.total || "!"}
                  </span>
                </span>
              ) : alertsSummary?.total && alertsSummary.total > 0 ? (
                <span className="absolute -top-0.5 -end-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-amber-500 px-1 text-[9px] font-bold text-white shadow-sm ring-2 ring-background">
                  {alertsSummary.total}
                </span>
              ) : (
                <span className="absolute top-2 end-2 h-2 w-2 rounded-full bg-primary/70 ring-2 ring-background" />
              )}
            </button>
          </div>
        </header>

        <main
          className={cn(
            "flex-1 min-h-0 overflow-y-auto overflow-x-hidden custom-scrollbar pb-app-safe",
            isPosRoute ? "flex flex-col" : "",
          )}
        >
          {isPosRoute ? (
            <div className="flex-1 min-h-0 flex flex-col overflow-hidden p-2 pb-app-safe sm:p-3">
              {children}
            </div>
          ) : (
            <div className="flex min-h-full w-full flex-col">
              <div className="mx-auto w-full max-w-[1400px] flex-1 px-2 pt-3 pb-app-safe sm:px-1 sm:py-4 lg:px-1 lg:py-6">
                {children}
              </div>
              {/* Company identity (name, address, contacts, tax number) read from
                  company_settings — the same source as every printed document. */}
              <SiteFooter className="mt-auto" />
            </div>
          )}
        </main>
      </div>

      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </div>
  );
}

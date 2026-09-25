import { Link, useRouterState, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  LayoutDashboard,
  ScanBarcode,
  ShoppingBag,
  Package,
  Warehouse,
  Receipt,
  Truck,
  Users,
  Building2,
  Wallet,
  BarChart3,
  ShieldCheck,
  Bell,
  Settings,
  Search,
  Command as CommandIcon,
  LogOut,
  Moon,
  Sun,
  Sparkles,
  RotateCcw,
  ArrowRightLeft,
  CalendarClock,
  Barcode,
  Gift,
  History,
  Layers,
  Boxes,
  Menu,
  HandCoins,
  AlertTriangle,
  LineChart,
  FileText,
  BookOpen,
  Scale,
  Landmark,
  PieChart,
  PanelLeftClose,
  PanelLeftOpen,
  Crown,
  ClipboardList,
} from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/lib/auth";
import { useModules } from "@/lib/modules";
import { CommandPalette } from "@/components/command-palette";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { ConnectionBanner } from "@/components/ui/connection";
import { cn } from "@/lib/utils";
import { InamaSoftFooter } from "@/components/inama-soft-footer";

type Item = {
  to: string;
  icon: typeof LayoutDashboard;
  key: string;
  moduleId?: string;
  superadminOnly?: boolean;
  allowedRoles?: (
    | "owner"
    | "manager"
    | "accountant"
    | "cashier"
    | "warehouse"
  )[];
  color?: string;
  bg?: string;
};

type Section = {
  titleKey: string;
  items: Item[];
};

const sections: Section[] = [
  {
    titleKey: "nav.section.overview",
    items: [
      {
        to: "/dashboard",
        icon: LayoutDashboard,
        key: "nav.dashboard",
        moduleId: "core",
        color: "text-sky-500",
        bg: "bg-sky-500/15",
      },
      {
        to: "/analytics",
        icon: LineChart,
        key: "nav.analytics",
        moduleId: "analytics",
        allowedRoles: ["owner", "manager", "accountant"],
        color: "text-indigo-500",
        bg: "bg-indigo-500/15",
      },
      {
        to: "/plans",
        icon: Crown,
        key: "nav.plans",
        moduleId: "core",
        allowedRoles: ["owner"],
        color: "text-amber-500",
        bg: "bg-amber-500/15",
      },
    ],
  },

  {
    titleKey: "nav.section.operations",
    items: [
      {
        to: "/pos",
        icon: ScanBarcode,
        key: "nav.pos",
        moduleId: "pos",
        allowedRoles: ["owner", "manager", "cashier"],
        color: "text-emerald-500",
        bg: "bg-emerald-500/15",
      },
      {
        to: "/products",
        icon: Package,
        key: "nav.products",
        moduleId: "core",
        color: "text-teal-500",
        bg: "bg-teal-500/15",
      },
      {
        to: "/catalog",
        icon: Layers,
        key: "nav.catalog",
        moduleId: "core",
        allowedRoles: ["owner", "manager", "accountant", "warehouse"],
        color: "text-amber-500",
        bg: "bg-amber-500/15",
      },
      {
        to: "/inventory",
        icon: Warehouse,
        key: "nav.inventory",
        moduleId: "core",
        allowedRoles: ["owner", "manager", "accountant", "warehouse"],
        color: "text-cyan-500",
        bg: "bg-cyan-500/15",
      },
      {
        to: "/settlements",
        icon: ClipboardList,
        key: "nav.settlements",
        moduleId: "core",
        allowedRoles: ["owner", "manager", "warehouse", "accountant"],
        color: "text-amber-500",
        bg: "bg-amber-500/15",
      },
      {
        to: "/warehouses",
        icon: Boxes,
        key: "nav.warehouses",
        moduleId: "multi_warehouse",
        allowedRoles: ["owner", "manager", "warehouse"],
        color: "text-blue-500",
        bg: "bg-blue-500/15",
      },
      {
        to: "/batches",
        icon: CalendarClock,
        key: "nav.batches",
        moduleId: "batches",
        allowedRoles: ["owner", "manager", "warehouse"],
        color: "text-orange-500",
        bg: "bg-orange-500/15",
      },
      {
        to: "/sales",
        icon: Receipt,
        key: "nav.sales",
        moduleId: "core",
        allowedRoles: ["owner", "manager", "accountant", "cashier"],
        color: "text-emerald-400",
        bg: "bg-emerald-500/15",
      },
      {
        to: "/sales-returns",
        icon: RotateCcw,
        key: "nav.sales_returns",
        moduleId: "returns",
        allowedRoles: ["owner", "manager", "accountant", "cashier"],
        color: "text-rose-400",
        bg: "bg-rose-500/15",
      },
      {
        to: "/purchases",
        icon: Truck,
        key: "nav.purchases",
        moduleId: "purchases",
        allowedRoles: ["owner", "manager", "accountant", "warehouse"],
        color: "text-blue-400",
        bg: "bg-blue-500/15",
      },
      {
        to: "/purchase-pos",
        icon: ShoppingBag,
        key: "nav.purchase_pos",
        moduleId: "purchases",
        allowedRoles: ["owner", "manager", "accountant", "warehouse"],
        color: "text-indigo-400",
        bg: "bg-indigo-500/15",
      },
      {
        to: "/purchase-returns",
        icon: RotateCcw,
        key: "nav.purchase_returns",
        moduleId: "returns",
        allowedRoles: ["owner", "manager", "accountant", "warehouse"],
        color: "text-rose-500",
        bg: "bg-rose-500/15",
      },
      {
        to: "/transfers",
        icon: ArrowRightLeft,
        key: "nav.transfers",
        moduleId: "multi_warehouse",
        allowedRoles: ["owner", "manager", "warehouse"],
        color: "text-purple-400",
        bg: "bg-purple-500/15",
      },
      {
        to: "/barcodes",
        icon: Barcode,
        key: "nav.barcodes",
        moduleId: "barcode",
        allowedRoles: ["owner", "manager", "warehouse", "cashier"],
        color: "text-violet-500",
        bg: "bg-violet-500/15",
      },
    ],
  },

  {
    titleKey: "nav.section.relations",
    items: [
      {
        to: "/customers",
        icon: Users,
        key: "nav.customers",
        moduleId: "core",
        allowedRoles: ["owner", "manager", "accountant", "cashier"],
        color: "text-teal-400",
        bg: "bg-teal-500/15",
      },
      {
        to: "/suppliers",
        icon: Building2,
        key: "nav.suppliers",
        moduleId: "purchases",
        allowedRoles: ["owner", "manager", "accountant", "warehouse"],
        color: "text-blue-500",
        bg: "bg-blue-500/15",
      },
      {
        to: "/loyalty",
        icon: Gift,
        key: "nav.loyalty",
        moduleId: "loyalty",
        allowedRoles: ["owner", "manager", "cashier"],
        color: "text-pink-500",
        bg: "bg-pink-500/15",
      },
    ],
  },

  {
    titleKey: "nav.section.accounting",
    items: [
      {
        to: "/payments",
        icon: HandCoins,
        key: "nav.payments",
        moduleId: "payments",
        allowedRoles: ["owner", "manager", "accountant"],
        color: "text-amber-500",
        bg: "bg-amber-500/15",
      },
      {
        to: "/debts",
        icon: AlertTriangle,
        key: "nav.debts",
        moduleId: "payments",
        allowedRoles: ["owner", "manager", "accountant"],
        color: "text-red-500",
        bg: "bg-red-500/15",
      },
      {
        to: "/account-statement",
        icon: FileText,
        key: "nav.account_statement",
        moduleId: "payments",
        allowedRoles: ["owner", "manager", "accountant"],
        color: "text-yellow-500",
        bg: "bg-yellow-500/15",
      },
      {
        to: "/daily-journal",
        icon: BookOpen,
        key: "nav.daily_journal",
        moduleId: "advanced_accounting",
        allowedRoles: ["owner", "manager", "accountant"],
        color: "text-emerald-500",
        bg: "bg-emerald-500/15",
      },
      {
        to: "/trial-balance",
        icon: Scale,
        key: "nav.trial_balance",
        moduleId: "advanced_accounting",
        allowedRoles: ["owner", "manager", "accountant"],
        color: "text-cyan-400",
        bg: "bg-cyan-500/15",
      },
      {
        to: "/income-statement",
        icon: PieChart,
        key: "nav.income_statement",
        moduleId: "advanced_accounting",
        allowedRoles: ["owner", "manager", "accountant"],
        color: "text-lime-500",
        bg: "bg-lime-500/15",
      },
      {
        to: "/balance-sheet",
        icon: Landmark,
        key: "nav.balance_sheet",
        moduleId: "advanced_accounting",
        allowedRoles: ["owner", "manager", "accountant"],
        color: "text-indigo-400",
        bg: "bg-indigo-500/15",
      },
      {
        to: "/finance",
        icon: Wallet,
        key: "nav.finance",
        moduleId: "expenses",
        allowedRoles: ["owner", "manager", "accountant"],
        color: "text-emerald-500",
        bg: "bg-emerald-500/15",
      },
      {
        to: "/reports",
        icon: BarChart3,
        key: "nav.reports",
        moduleId: "analytics",
        allowedRoles: ["owner", "manager", "accountant"],
        color: "text-sky-400",
        bg: "bg-sky-500/15",
      },
    ],
  },

  {
    titleKey: "nav.section.admin",
    items: [
      {
        to: "/users",
        icon: ShieldCheck,
        key: "nav.users",
        moduleId: "core",
        allowedRoles: ["owner"],
        color: "text-violet-400",
        bg: "bg-violet-500/15",
      },
      {
        to: "/audit",
        icon: History,
        key: "nav.audit",
        moduleId: "audit",
        allowedRoles: ["owner", "manager"],
        color: "text-orange-400",
        bg: "bg-orange-500/15",
      },
      {
        to: "/notifications",
        icon: Bell,
        key: "nav.notifications",
        moduleId: "core",
        color: "text-yellow-400",
        bg: "bg-yellow-500/15",
      },
      {
        to: "/settings",
        icon: Settings,
        key: "nav.settings",
        moduleId: "core",
        allowedRoles: ["owner", "manager"],
        color: "text-slate-400",
        bg: "bg-slate-500/15",
      },
      {
        to: "/platform-admin",
        icon: Crown,
        key: "nav.platform_admin",
        superadminOnly: true,
        color: "text-amber-500",
        bg: "bg-amber-500/15",
      },
    ],
  },
];

function SidebarContents({
  onNavigate,
  collapsed = false,
  onToggleCollapse,
}: {
  onNavigate?: () => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}) {
  const { t, dir, lang } = useI18n();

  const {
    user,
    signOut,
    isPlatformAdmin,
    isPlatformSuperadmin,
    hasRole,
    roles,
  } = useAuth();

  const isSuperOrOwner =
    isPlatformAdmin || isPlatformSuperadmin || hasRole("owner");

  const { isModuleEnabled } = useModules();

  const navigate = useNavigate();

  // Must be passed as an options object with a `select` selector. Passing a bare
  // function leaves `select` undefined, so the hook returns the whole RouterState
  // object and `pathname.startsWith(...)` below throws
  // "TypeError: pathname.startsWith is not a function".
  const pathname = useRouterState({
    select: (s) => s.location.pathname,
  });

  // Navigation belongs to the application itself, not to an individual tenant.
  // The company logo remains available in invoices and printable documents.
  const logoUrl = "/vortex-erp-wordmark.png";
  const compactLogoUrl = "/vortex-erp-mark.png";

  const filteredSections = useMemo(() => {
    return sections
      .map((sec) => ({
        ...sec,
        items: sec.items.filter((it) => {
          if (it.superadminOnly && !isSuperOrOwner) {
            return false;
          }

          if (
            !isSuperOrOwner &&
            it.allowedRoles &&
            !it.allowedRoles.some((role) =>
              roles.includes(role),
            )
          ) {
            return false;
          }

          return isModuleEnabled(it.moduleId);
        }),
      }))
      .filter((sec) => sec.items.length > 0);
  }, [isModuleEnabled, isSuperOrOwner, roles]);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-sidebar text-sidebar-foreground">
      {/* Sidebar Header with Brand Logo */}
      <div
        className={cn(
          "flex h-16 items-center border-b border-sidebar-border/60 transition-all duration-300",
          collapsed
            ? "justify-center px-2"
            : "justify-center px-4",
        )}
      >
        <img
          src={collapsed ? compactLogoUrl : logoUrl}
          alt={t("app.name")}
          className={cn(
            "object-contain",
            collapsed ? "size-9" : "h-11 w-[150px] max-w-full",
          )}
          onError={(event) => {
            event.currentTarget.style.visibility = "hidden";
          }}
        />
      </div>

      {/* Navigation Links */}
      <nav
        className={cn(
          "flex-1 min-h-0 overflow-y-auto overflow-x-hidden overscroll-contain custom-scrollbar",
          collapsed
            ? "px-2 py-3 space-y-2"
            : "px-3 py-3.5 space-y-4",
        )}
      >
        {filteredSections.map((sec, secIdx) => (
          <div key={sec.titleKey}>
            {!collapsed ? (
              <div className="px-3 pb-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground/80 truncate">
                {t(sec.titleKey)}
              </div>
            ) : (
              secIdx > 0 && (
                <div className="my-2 h-px w-7 mx-auto bg-sidebar-border/60" />
              )
            )}

            <ul
              className={cn(
                collapsed ? "space-y-1.5" : "space-y-1",
              )}
            >
              {sec.items.map((it) => {
                const active =
                  pathname === it.to ||
                  (it.to !== "/dashboard" &&
                    pathname.startsWith(`${it.to}/`));

                return (
                  <li key={it.to} className="relative">
                    <Link
                      to={it.to}
                      onClick={onNavigate}
                      className={cn(
                        "group relative flex items-center transition-all duration-200",

                        collapsed
                          ? "h-10 w-10 mx-auto justify-center rounded-xl p-0"
                          : "gap-3 px-3 py-2.5 rounded-xl text-[13.5px] sm:text-sm font-medium",

                        active
                          ? collapsed
                            ? "bg-primary text-primary-foreground shadow-md shadow-primary/25 ring-2 ring-primary/40"
                            : "bg-gradient-to-r from-primary/20 via-primary/10 to-primary/5 text-foreground font-semibold shadow-[inset_0_0_0_1px_oklch(1_0_0_/_0.08)]"
                          : collapsed
                            ? "text-muted-foreground hover:bg-surface-2 hover:text-foreground hover:scale-105"
                            : "text-muted-foreground hover:bg-sidebar-accent/70 hover:text-foreground",
                      )}
                    >
                      {active && !collapsed && (
                        <span
                          className={cn(
                            "absolute inset-y-2 w-[3px] rounded-full bg-primary",
                            dir === "rtl"
                              ? "right-0"
                              : "left-0",
                          )}
                        />
                      )}

                      <div
                        className={cn(
                          "grid place-items-center transition-transform duration-200",

                          collapsed
                            ? "h-full w-full"
                            : cn(
                                "h-7 w-7 rounded-lg group-hover:scale-110",
                                it.bg || "bg-surface-2/60",
                                active &&
                                  "ring-1 ring-primary/40 shadow-sm",
                              ),
                        )}
                      >
                        <it.icon
                          className={cn(
                            "shrink-0 transition-colors",

                            collapsed
                              ? active
                                ? "h-5 w-5 text-primary-foreground stroke-[2.2]"
                                : cn(
                                    "h-5 w-5",
                                    it.color ||
                                      "text-muted-foreground group-hover:text-foreground",
                                  )
                              : active
                                ? "h-4 w-4 text-primary stroke-[2.5]"
                                : cn(
                                    "h-4 w-4",
                                    it.color ||
                                      "text-muted-foreground group-hover:text-foreground",
                                  ),
                          )}
                        />
                      </div>

                      {!collapsed && (
                        <span className="truncate leading-normal">
                          {t(it.key)}
                        </span>
                      )}

                      {/* Tooltip in Icon-only mode */}
                      {collapsed && (
                        <div
                          className={cn(
                            "pointer-events-none absolute z-50 whitespace-nowrap rounded-xl bg-popover/95 backdrop-blur-md px-3 py-1.5 text-xs font-semibold text-popover-foreground shadow-xl border border-border/80 transition-all duration-150 scale-95 opacity-0 group-hover:scale-100 group-hover:opacity-100",
                            dir === "rtl"
                              ? "right-full me-3.5"
                              : "left-full ms-3.5",
                          )}
                        >
                          <div className="flex items-center gap-1.5">
                            <span>{t(it.key)}</span>

                            {it.superadminOnly && (
                              <Crown className="h-3 w-3 text-amber-500 shrink-0" />
                            )}
                          </div>

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
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      {/* Footer Profile & Sign Out */}
      <div
        className={cn(
          "border-t border-sidebar-border/60 p-2.5",
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
            collapsed
              ? "h-10 w-10 justify-center p-0"
              : "w-full gap-2.5 px-3 p-2",
          )}
          title={
            lang === "ar"
              ? "تسجيل الخروج"
              : "Sign out"
          }
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
                dir === "rtl"
                  ? "right-full me-3.5"
                  : "left-full ms-3.5",
              )}
            >
              <span>
                {lang === "ar"
                  ? "تسجيل الخروج"
                  : "Sign out"}{" "}
                ({user?.email})
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
}

export function AppShell({
  children,
}: {
  children: React.ReactNode;
}) {
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

  const [paletteOpen, setPaletteOpen] =
    useState(false);

  const [mobileOpen, setMobileOpen] =
    useState(false);

  const [collapsed, setCollapsed] =
    useState<boolean>(() => {
      if (typeof window !== "undefined") {
        return (
          localStorage.getItem(
            "vortex_sidebar_collapsed",
          ) === "true"
        );
      }

      return false;
    });

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev;

      if (typeof window !== "undefined") {
        localStorage.setItem(
          "vortex_sidebar_collapsed",
          String(next),
        );
      }

      return next;
    });
  };

  const [theme, setTheme] =
    useState<"dark" | "light">(
      () =>
        (typeof window !== "undefined" &&
          (localStorage.getItem("theme") as
            | "dark"
            | "light")) ||
        "dark",
    );

  useEffect(() => {
    const root = document.documentElement;

    root.classList.toggle(
      "dark",
      theme === "dark",
    );

    root.classList.toggle(
      "light",
      theme === "light",
    );

    localStorage.setItem("theme", theme);
  }, [theme]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (
        (e.metaKey || e.ctrlKey) &&
        e.key.toLowerCase() === "k"
      ) {
        e.preventDefault();

        setPaletteOpen((x) => !x);
      }
    };

    window.addEventListener(
      "keydown",
      handler,
    );

    return () =>
      window.removeEventListener(
        "keydown",
        handler,
      );
  }, []);

  const sideEdge =
    dir === "rtl"
      ? "border-l"
      : "border-r";

  return (
    <div className="relative z-10 flex h-screen w-full overflow-hidden text-foreground">
      {/* Desktop sidebar */}
      <aside
        className={cn(
          "hidden md:flex h-full shrink-0 flex-col overflow-hidden transition-all duration-300 ease-in-out",

          collapsed
            ? "w-[72px]"
            : "w-64",

          sideEdge,
          "border-sidebar-border/60",
        )}
      >
        <SidebarContents
          collapsed={collapsed}
          onToggleCollapse={toggleCollapsed}
        />
      </aside>

      {/* Mobile drawer */}
      <Sheet
        open={mobileOpen}
        onOpenChange={setMobileOpen}
      >
        <SheetContent
          side={
            dir === "rtl"
              ? "right"
              : "left"
          }
          className="w-72 p-0 bg-sidebar border-sidebar-border/60 overflow-hidden"
        >
          <SidebarContents
            onNavigate={() =>
              setMobileOpen(false)
            }
          />
        </SheetContent>
      </Sheet>

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {/* Offline notice — sits above everything in the content column */}
        <ConnectionBanner />

        {/* Top bar */}
        <header className="sticky top-0 z-30 flex h-16 items-center gap-2.5 border-b border-border/60 bg-background/70 px-4 backdrop-blur-xl sm:px-6">
          <button
            onClick={() =>
              setMobileOpen(true)
            }
            className="md:hidden grid h-10 w-10 place-items-center rounded-full border border-border/60 bg-surface text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Open menu"
          >
            <Menu className="h-4.5 w-4.5" />
          </button>

          {/* Desktop Sidebar Collapse / Expand Toggle */}
          <button
            type="button"
            onClick={toggleCollapsed}
            className="hidden md:grid h-10 w-10 shrink-0 place-items-center rounded-full border border-border/60 bg-surface text-muted-foreground hover:text-foreground hover:border-ring/40 transition-colors"
            title={
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
              <PanelLeftOpen className="h-4.5 w-4.5" />
            ) : (
              <PanelLeftClose className="h-4.5 w-4.5" />
            )}
          </button>

          <button
            onClick={() =>
              setPaletteOpen(true)
            }
            className="group flex h-10 flex-1 max-w-xl items-center gap-2.5 rounded-full border border-border/60 bg-surface/80 px-4 text-sm text-muted-foreground transition-all hover:border-ring/40 hover:bg-surface hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
          >
            <Search className="h-4 w-4" />

            <span className="flex-1 text-start truncate">
              {t("common.search")}
            </span>

            <kbd className="hidden sm:inline-flex items-center gap-1 rounded-full border border-border/60 bg-background/60 px-2 py-0.5 text-[10px] font-mono text-muted-foreground">
              <CommandIcon className="h-3 w-3" /> K
            </kbd>
          </button>

          <div className="ms-auto flex items-center gap-2">
            <button
              onClick={() =>
                setTheme(
                  theme === "dark"
                    ? "light"
                    : "dark",
                )
              }
              className="grid h-10 w-10 place-items-center rounded-full border border-border/60 bg-surface text-muted-foreground hover:text-foreground hover:border-ring/40 transition-colors"
              title={t("common.theme")}
              aria-label={t("common.theme")}
            >
              {theme === "dark" ? (
                <Sun className="h-4 w-4" />
              ) : (
                <Moon className="h-4 w-4" />
              )}
            </button>

            <button
              className="relative grid h-10 w-10 place-items-center rounded-full border border-border/60 bg-surface text-muted-foreground hover:text-foreground hover:border-ring/40 transition-colors"
              title={t("nav.notifications")}
              aria-label={t("nav.notifications")}
              onClick={() =>
                navigate({
                  to: "/notifications",
                })
              }
            >
              <Bell className="h-4 w-4" />

              <span className="absolute top-2 end-2 h-1.5 w-1.5 rounded-full bg-primary ring-2 ring-background" />
            </button>
          </div>
        </header>

        <main
          className={cn(
            "flex-1 min-h-0 overflow-y-auto overflow-x-hidden custom-scrollbar",
            isPosRoute ? "flex flex-col" : ""
          )}
        >
          {isPosRoute ? (
            <div className="flex-1 min-h-0 flex flex-col p-3 sm:p-5 pb-16">{children}</div>
          ) : (
            <>
              <div className="mx-auto w-full max-w-[1400px] px-3 py-4 sm:px-4 sm:py-5 lg:px-6 lg:py-6">
                {children}
              </div>
              <InamaSoftFooter />
            </>
          )}
        </main>
      </div>

      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
      />
    </div>
  );
}

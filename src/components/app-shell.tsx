import { Link, useRouterState, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  LayoutDashboard, ScanBarcode, Package, Warehouse, Receipt, Truck,
  Users, Building2, Wallet, BarChart3, ShieldCheck, Bell, Settings,
  Search, Command as CommandIcon, LogOut, Moon, Sun, Sparkles,
  RotateCcw, ArrowRightLeft, CalendarClock, Barcode, Gift, History, Layers, Boxes,
  Menu, HandCoins, AlertTriangle, LineChart, FileText, BookOpen, Scale, Landmark, PieChart,
  PanelLeftClose, PanelLeftOpen,
} from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/lib/auth";
import { useModules } from "@/lib/modules";
import { supabase } from "@/integrations/supabase/client";
import { CommandPalette } from "@/components/command-palette";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { InamaSoftFooter } from "@/components/inama-soft-footer";

type Item = { to: string; icon: typeof LayoutDashboard; key: string; moduleId?: string };
type Section = { titleKey: string; items: Item[] };

const sections: Section[] = [
  {
    titleKey: "nav.section.overview",
    items: [
      { to: "/dashboard", icon: LayoutDashboard, key: "nav.dashboard", moduleId: "core" },
      { to: "/analytics", icon: LineChart, key: "nav.analytics", moduleId: "analytics" },
    ],
  },
  {
    titleKey: "nav.section.operations",
    items: [
      { to: "/pos", icon: ScanBarcode, key: "nav.pos", moduleId: "pos" },
      { to: "/products", icon: Package, key: "nav.products", moduleId: "core" },
      { to: "/catalog", icon: Layers, key: "nav.catalog", moduleId: "core" },
      { to: "/inventory", icon: Warehouse, key: "nav.inventory", moduleId: "core" },
      { to: "/warehouses", icon: Boxes, key: "nav.warehouses", moduleId: "multi_warehouse" },
      { to: "/batches", icon: CalendarClock, key: "nav.batches", moduleId: "batches" },
      { to: "/sales", icon: Receipt, key: "nav.sales", moduleId: "core" },
      { to: "/sales-returns", icon: RotateCcw, key: "nav.sales_returns", moduleId: "returns" },
      { to: "/purchases", icon: Truck, key: "nav.purchases", moduleId: "purchases" },
      { to: "/purchase-returns", icon: RotateCcw, key: "nav.purchase_returns", moduleId: "returns" },
      { to: "/transfers", icon: ArrowRightLeft, key: "nav.transfers", moduleId: "multi_warehouse" },
      { to: "/barcodes", icon: Barcode, key: "nav.barcodes", moduleId: "barcode" },
    ],
  },
  {
    titleKey: "nav.section.relations",
    items: [
      { to: "/customers", icon: Users, key: "nav.customers", moduleId: "core" },
      { to: "/suppliers", icon: Building2, key: "nav.suppliers", moduleId: "purchases" },
      { to: "/loyalty", icon: Gift, key: "nav.loyalty", moduleId: "loyalty" },
    ],
  },
  {
    titleKey: "nav.section.accounting",
    items: [
      { to: "/payments", icon: HandCoins, key: "nav.payments", moduleId: "payments" },
      { to: "/debts", icon: AlertTriangle, key: "nav.debts", moduleId: "payments" },
      { to: "/account-statement", icon: FileText, key: "nav.account_statement", moduleId: "payments" },
      { to: "/daily-journal", icon: BookOpen, key: "nav.daily_journal", moduleId: "advanced_accounting" },
      { to: "/trial-balance", icon: Scale, key: "nav.trial_balance", moduleId: "advanced_accounting" },
      { to: "/income-statement", icon: PieChart, key: "nav.income_statement", moduleId: "advanced_accounting" },
      { to: "/balance-sheet", icon: Landmark, key: "nav.balance_sheet", moduleId: "advanced_accounting" },
      { to: "/finance", icon: Wallet, key: "nav.finance", moduleId: "expenses" },
      { to: "/reports", icon: BarChart3, key: "nav.reports", moduleId: "analytics" },
    ],
  },
  {
    titleKey: "nav.section.admin",
    items: [
      { to: "/users", icon: ShieldCheck, key: "nav.users", moduleId: "core" },
      { to: "/audit", icon: History, key: "nav.audit", moduleId: "audit" },
      { to: "/notifications", icon: Bell, key: "nav.notifications", moduleId: "core" },
      { to: "/settings", icon: Settings, key: "nav.settings", moduleId: "core" },
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
  const { user, signOut } = useAuth();
  const { isModuleEnabled, currentPlan } = useModules();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [logoUrl, setLogoUrl] = useState<string>("/inama-soft-logo.ico");

  useEffect(() => {
    supabase
      .from("company_settings")
      .select("logo_url")
      .order("id")
      .limit(1)
      .maybeSingle()
      .then(({ data }) => {
        if (data?.logo_url) setLogoUrl(data.logo_url);
      });
  }, []);

  const filteredSections = useMemo(() => {
    return sections
      .map((sec) => ({
        ...sec,
        items: sec.items.filter((it) => isModuleEnabled(it.moduleId)),
      }))
      .filter((sec) => sec.items.length > 0);
  }, [isModuleEnabled]);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-sidebar text-sidebar-foreground">
      {/* Sidebar Header with Brand Logo */}
      <div className={cn(
        "flex h-16 items-center border-b border-sidebar-border/60 transition-all duration-300",
        collapsed ? "justify-center px-2" : "gap-2.5 px-4 justify-between"
      )}>
        <div className="flex items-center gap-2.5 min-w-0">
          <img
            src={logoUrl}
            alt={t("app.name")}
            className="h-9 w-9 shrink-0 rounded-xl object-contain bg-surface-2/90 p-1 border border-border/60 shadow-md ring-1 ring-white/10"
            onError={() => setLogoUrl("/inama-soft-logo.ico")}
          />
          {!collapsed && (
            <div className="flex flex-col leading-tight min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-sm font-bold tracking-tight text-foreground truncate">{t("app.name")}</span>
                <span className="inline-flex items-center rounded-full bg-primary/10 border border-primary/25 px-1.5 py-0.2 text-[9px] font-medium text-primary shrink-0">
                  {lang === "ar" ? currentPlan.name.ar : currentPlan.name.en}
                </span>
              </div>
              <span className="text-[10px] text-muted-foreground">ERP · Inama Soft</span>
            </div>
          )}
        </div>

        {!collapsed && onToggleCollapse && (
          <button
            type="button"
            onClick={onToggleCollapse}
            className="hidden md:grid h-8 w-8 place-items-center rounded-lg border border-sidebar-border/80 bg-surface-2/60 text-muted-foreground hover:bg-surface-3 hover:text-foreground transition"
            title={lang === "ar" ? "عرض أيقونات فقط" : "Collapse sidebar"}
          >
            <PanelLeftClose className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Navigation Links */}
      <nav className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-2 py-3 space-y-4 overscroll-contain [scrollbar-gutter:stable]">
        {filteredSections.map((sec) => (
          <div key={sec.titleKey}>
            {!collapsed ? (
              <div className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/70 truncate">
                {t(sec.titleKey)}
              </div>
            ) : (
              <div className="my-2 border-t border-sidebar-border/40 mx-2" />
            )}
            <ul className="space-y-0.5">
              {sec.items.map((it) => {
                const active = pathname === it.to || pathname.startsWith(it.to + "/");
                return (
                  <li key={it.to}>
                    <Link
                      to={it.to}
                      onClick={onNavigate}
                      title={t(it.key)}
                      className={cn(
                        "group relative flex items-center rounded-xl text-[13px] font-medium transition-all",
                        collapsed ? "justify-center p-2.5" : "gap-3 px-3 py-2",
                        active
                          ? "bg-gradient-to-r from-primary/15 to-primary/5 text-foreground shadow-[inset_0_0_0_1px_oklch(1_0_0_/_0.06)]"
                          : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground"
                      )}
                    >
                      {active && (
                        <span className={cn("absolute inset-y-2 w-[3px] rounded-full bg-primary", dir === "rtl" ? "right-0" : "left-0")} />
                      )}
                      <it.icon className={cn("h-4.5 w-4.5 shrink-0 transition-colors", active ? "text-primary" : "text-muted-foreground group-hover:text-foreground")} />
                      {!collapsed && <span className="truncate">{t(it.key)}</span>}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      {/* Footer Profile & Desktop Toggle */}
      <div className={cn("border-t border-sidebar-border/60 p-2 space-y-1", collapsed && "flex flex-col items-center")}>
        {onToggleCollapse && (
          <button
            type="button"
            onClick={onToggleCollapse}
            className={cn(
              "hidden md:flex w-full items-center rounded-xl p-2 text-xs text-muted-foreground hover:bg-sidebar-accent hover:text-foreground transition",
              collapsed ? "justify-center" : "gap-2.5 px-3"
            )}
            title={collapsed
              ? (lang === "ar" ? "توسيع القائمة (أيقونات وأسماء)" : "Expand sidebar")
              : (lang === "ar" ? "طي القائمة (أيقونات فقط)" : "Collapse sidebar")}
          >
            {collapsed ? (
              <PanelLeftOpen className="h-4 w-4 text-primary" />
            ) : (
              <>
                <PanelLeftClose className="h-4 w-4" />
                <span className="truncate">{lang === "ar" ? "عرض أيقونات فقط" : "Collapse sidebar"}</span>
              </>
            )}
          </button>
        )}

        <button
          onClick={async () => { await signOut(); navigate({ to: "/auth", replace: true }); }}
          className={cn(
            "flex w-full items-center rounded-xl p-2 text-[13px] text-muted-foreground hover:bg-sidebar-accent hover:text-foreground transition-colors",
            collapsed ? "justify-center" : "gap-2.5 px-3"
          )}
          title={lang === "ar" ? "تسجيل الخروج" : "Sign out"}
        >
          <div className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-gradient-to-br from-primary/20 to-chart-4/20 text-[11px] font-semibold text-foreground">
            {(user?.email ?? "?").charAt(0).toUpperCase()}
          </div>
          {!collapsed && (
            <>
              <span className="min-w-0 flex-1 truncate text-start">{user?.email}</span>
              <LogOut className="h-3.5 w-3.5 shrink-0" />
            </>
          )}
        </button>
      </div>
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const { t, dir } = useI18n();
  const navigate = useNavigate();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
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
  const [theme, setTheme] = useState<"dark" | "light">(() =>
    (typeof window !== "undefined" && (localStorage.getItem("theme") as "dark" | "light")) || "dark"
  );

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", theme === "dark");
    root.classList.toggle("light", theme === "light");
    localStorage.setItem("theme", theme);
  }, [theme]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((x) => !x);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const sideEdge = dir === "rtl" ? "border-l" : "border-r";

  return (
    <div className="relative z-10 flex h-screen w-full overflow-hidden text-foreground">
      {/* Desktop sidebar */}
      <aside className={cn(
        "hidden md:flex h-full shrink-0 flex-col overflow-hidden transition-all duration-300 ease-in-out",
        collapsed ? "w-[72px]" : "w-64",
        sideEdge,
        "border-sidebar-border/60"
      )}>
        <SidebarContents collapsed={collapsed} onToggleCollapse={toggleCollapsed} />
      </aside>

      {/* Mobile drawer */}
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side={dir === "rtl" ? "right" : "left"} className="w-72 p-0 bg-sidebar border-sidebar-border/60 overflow-hidden">
          <SidebarContents onNavigate={() => setMobileOpen(false)} />
        </SheetContent>
      </Sheet>

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {/* Top bar */}
        <header className="sticky top-0 z-30 flex h-16 items-center gap-2.5 border-b border-border/60 bg-background/70 px-4 backdrop-blur-xl sm:px-6">
          <button
            onClick={() => setMobileOpen(true)}
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
            title={collapsed
              ? (dir === "rtl" ? "توسيع القائمة الجانبية" : "Expand sidebar")
              : (dir === "rtl" ? "طي القائمة (أيقونات فقط)" : "Collapse sidebar")}
          >
            {collapsed ? <PanelLeftOpen className="h-4.5 w-4.5" /> : <PanelLeftClose className="h-4.5 w-4.5" />}
          </button>

          <button
            onClick={() => setPaletteOpen(true)}
            className="group flex h-10 flex-1 max-w-xl items-center gap-2.5 rounded-full border border-border/60 bg-surface/80 px-4 text-sm text-muted-foreground transition-all hover:border-ring/40 hover:bg-surface hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
          >
            <Search className="h-4 w-4" />
            <span className="flex-1 text-start truncate">{t("common.search")}</span>
            <kbd className="hidden sm:inline-flex items-center gap-1 rounded-full border border-border/60 bg-background/60 px-2 py-0.5 text-[10px] font-mono text-muted-foreground">
              <CommandIcon className="h-3 w-3" /> K
            </kbd>
          </button>

          <div className="ms-auto flex items-center gap-2">
            <button
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              className="grid h-10 w-10 place-items-center rounded-full border border-border/60 bg-surface text-muted-foreground hover:text-foreground hover:border-ring/40 transition-colors"
              title={t("common.theme")}
              aria-label={t("common.theme")}
            >
              {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
            <button
              className="relative grid h-10 w-10 place-items-center rounded-full border border-border/60 bg-surface text-muted-foreground hover:text-foreground hover:border-ring/40 transition-colors"
              title={t("nav.notifications")}
              aria-label={t("nav.notifications")}
              onClick={() => navigate({ to: "/notifications" })}
            >
              <Bell className="h-4 w-4" />
              <span className="absolute top-2 end-2 h-1.5 w-1.5 rounded-full bg-primary ring-2 ring-background" />
            </button>
          </div>
        </header>

        <main className="flex-1 min-h-0 overflow-y-auto">
          <div className="mx-auto w-full max-w-[1400px] p-4 sm:p-6">{children}</div>
          <InamaSoftFooter />
        </main>
      </div>

      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </div>
  );
}

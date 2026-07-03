import { Link, useRouterState, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  LayoutDashboard, ScanBarcode, Package, Warehouse, Receipt, Truck,
  Users, Building2, Wallet, BarChart3, ShieldCheck, Bell, Settings,
  Search, Command as CommandIcon, LogOut, Moon, Sun, Sparkles,
  RotateCcw, ArrowRightLeft, CalendarClock, Barcode, Gift, History, Layers, Boxes,
  Menu,
} from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/lib/auth";
import { CommandPalette } from "@/components/command-palette";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

type Item = { to: string; icon: typeof LayoutDashboard; key: string };
type Section = { titleKey: string; items: Item[] };

const sections: Section[] = [
  { titleKey: "nav.section.overview", items: [{ to: "/dashboard", icon: LayoutDashboard, key: "nav.dashboard" }] },
  {
    titleKey: "nav.section.operations",
    items: [
      { to: "/pos", icon: ScanBarcode, key: "nav.pos" },
      { to: "/products", icon: Package, key: "nav.products" },
      { to: "/catalog", icon: Layers, key: "nav.catalog" },
      { to: "/inventory", icon: Warehouse, key: "nav.inventory" },
      { to: "/warehouses", icon: Boxes, key: "nav.warehouses" },
      { to: "/batches", icon: CalendarClock, key: "nav.batches" },
      { to: "/sales", icon: Receipt, key: "nav.sales" },
      { to: "/purchases", icon: Truck, key: "nav.purchases" },
      { to: "/returns", icon: RotateCcw, key: "nav.returns" },
      { to: "/transfers", icon: ArrowRightLeft, key: "nav.transfers" },
      { to: "/barcodes", icon: Barcode, key: "nav.barcodes" },
    ],
  },
  {
    titleKey: "nav.section.relations",
    items: [
      { to: "/customers", icon: Users, key: "nav.customers" },
      { to: "/suppliers", icon: Building2, key: "nav.suppliers" },
      { to: "/loyalty", icon: Gift, key: "nav.loyalty" },
    ],
  },
  {
    titleKey: "nav.section.accounting",
    items: [
      { to: "/finance", icon: Wallet, key: "nav.finance" },
      { to: "/reports", icon: BarChart3, key: "nav.reports" },
    ],
  },
  {
    titleKey: "nav.section.admin",
    items: [
      { to: "/users", icon: ShieldCheck, key: "nav.users" },
      { to: "/audit", icon: History, key: "nav.audit" },
      { to: "/notifications", icon: Bell, key: "nav.notifications" },
      { to: "/settings", icon: Settings, key: "nav.settings" },
    ],
  },
];

function SidebarContents({ onNavigate }: { onNavigate?: () => void }) {
  const { t, dir } = useI18n();
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      <div className="flex h-16 items-center gap-2.5 px-5 border-b border-sidebar-border/60">
        <div className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-primary via-primary to-chart-4 shadow-lg shadow-primary/20 ring-1 ring-white/10">
          <Sparkles className="h-4 w-4 text-primary-foreground" />
        </div>
        <div className="flex flex-col leading-tight">
          <span className="text-sm font-semibold tracking-tight text-foreground">{t("app.name")}</span>
          <span className="text-[10px] text-muted-foreground">ERP · v0.1</span>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-6">
        {sections.map((sec) => (
          <div key={sec.titleKey}>
            <div className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/70">
              {t(sec.titleKey)}
            </div>
            <ul className="space-y-0.5">
              {sec.items.map((it) => {
                const active = pathname === it.to || pathname.startsWith(it.to + "/");
                return (
                  <li key={it.to}>
                    <Link
                      to={it.to}
                      onClick={onNavigate}
                      className={cn(
                        "group relative flex items-center gap-3 rounded-xl px-3 py-2 text-[13px] font-medium transition-all",
                        active
                          ? "bg-gradient-to-r from-primary/15 to-primary/5 text-foreground shadow-[inset_0_0_0_1px_oklch(1_0_0_/_0.06)]"
                          : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground"
                      )}
                    >
                      {active && (
                        <span className={cn("absolute inset-y-2 w-[3px] rounded-full bg-primary", dir === "rtl" ? "right-0" : "left-0")} />
                      )}
                      <it.icon className={cn("h-4 w-4 shrink-0 transition-colors", active ? "text-primary" : "text-muted-foreground group-hover:text-foreground")} />
                      <span className="truncate">{t(it.key)}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="border-t border-sidebar-border/60 p-3">
        <button
          onClick={async () => { await signOut(); navigate({ to: "/auth", replace: true }); }}
          className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-[13px] text-muted-foreground hover:bg-sidebar-accent hover:text-foreground transition-colors"
        >
          <div className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-gradient-to-br from-primary/20 to-chart-4/20 text-[11px] font-semibold text-foreground">
            {(user?.email ?? "?").charAt(0).toUpperCase()}
          </div>
          <span className="min-w-0 flex-1 truncate text-start">{user?.email}</span>
          <LogOut className="h-3.5 w-3.5 shrink-0" />
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
    <div className="relative z-10 flex min-h-screen w-full text-foreground">
      {/* Desktop sidebar */}
      <aside className={cn("hidden md:flex w-64 shrink-0 flex-col", sideEdge, "border-sidebar-border/60")}>
        <SidebarContents />
      </aside>

      {/* Mobile drawer */}
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side={dir === "rtl" ? "right" : "left"} className="w-72 p-0 bg-sidebar border-sidebar-border/60">
          <SidebarContents onNavigate={() => setMobileOpen(false)} />
        </SheetContent>
      </Sheet>

      {/* Main column */}
      <div className="flex flex-1 flex-col min-w-0">
        {/* Top bar */}
        <header className="sticky top-0 z-30 flex h-16 items-center gap-2.5 border-b border-border/60 bg-background/70 px-4 backdrop-blur-xl sm:px-6">
          <button
            onClick={() => setMobileOpen(true)}
            className="md:hidden grid h-10 w-10 place-items-center rounded-full border border-border/60 bg-surface text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Open menu"
          >
            <Menu className="h-4.5 w-4.5" />
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

        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-[1400px] p-4 sm:p-6">{children}</div>
        </main>
      </div>

      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </div>
  );
}

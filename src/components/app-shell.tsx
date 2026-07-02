import { Link, useRouterState, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  LayoutDashboard, ScanBarcode, Package, Warehouse, Receipt, Truck,
  Users, Building2, Wallet, BarChart3, ShieldCheck, Bell, Settings,
  Search, Command as CommandIcon, LogOut, Moon, Sun, Languages, Sparkles,
  ChevronRight, RotateCcw, ArrowRightLeft, CalendarClock, Barcode, Gift, History, Layers, Boxes,
} from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/lib/auth";
import { CommandPalette } from "@/components/command-palette";
import { cn } from "@/lib/utils";

type Item = { to: string; icon: typeof LayoutDashboard; key: string };
type Section = { titleKey: string; items: Item[] };

const sections: Section[] = [
  {
    titleKey: "nav.section.overview",
    items: [{ to: "/dashboard", icon: LayoutDashboard, key: "nav.dashboard" }],
  },
  {
    titleKey: "nav.section.operations",
    items: [
      { to: "/pos", icon: ScanBarcode, key: "nav.pos" },
      { to: "/products", icon: Package, key: "nav.products" },
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

export function AppShell({ children }: { children: React.ReactNode }) {
  const { t, lang, setLang, dir } = useI18n();
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [paletteOpen, setPaletteOpen] = useState(false);
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
      {/* Sidebar */}
      <aside className={cn("hidden md:flex w-64 shrink-0 flex-col bg-sidebar text-sidebar-foreground", sideEdge, "border-sidebar-border")}>
        <div className="flex h-14 items-center gap-2 px-4 border-b border-sidebar-border">
          <div className="grid h-7 w-7 place-items-center rounded-md bg-gradient-to-br from-primary to-chart-4 shadow-[0_0_0_1px_oklch(1_0_0_/_0.08)_inset]">
            <Sparkles className="h-3.5 w-3.5 text-primary-foreground" />
          </div>
          <div className="flex flex-col leading-tight">
            <span className="text-sm font-semibold tracking-tight text-foreground">{t("app.name")}</span>
            <span className="text-[10px] text-muted-foreground">ERP · v0.1</span>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto px-2 py-3 space-y-5">
          {sections.map((sec) => (
            <div key={sec.titleKey}>
              <div className="px-2 pb-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                {t(sec.titleKey)}
              </div>
              <ul className="space-y-0.5">
                {sec.items.map((it) => {
                  const active = pathname === it.to || pathname.startsWith(it.to + "/");
                  return (
                    <li key={it.to}>
                      <Link
                        to={it.to}
                        className={cn(
                          "group flex items-center gap-2.5 rounded-md px-2 py-1.5 text-[13px] transition-colors",
                          active
                            ? "bg-sidebar-accent text-sidebar-accent-foreground"
                            : "text-sidebar-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
                        )}
                      >
                        <it.icon className={cn("h-4 w-4 shrink-0", active ? "text-primary" : "text-muted-foreground group-hover:text-foreground")} />
                        <span className="truncate">{t(it.key)}</span>
                        {active && <ChevronRight className={cn("ms-auto h-3.5 w-3.5 text-muted-foreground", dir === "rtl" && "rotate-180")} />}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        <div className="border-t border-sidebar-border p-2">
          <button
            onClick={async () => { await signOut(); navigate({ to: "/auth", replace: true }); }}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-[13px] text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
          >
            <LogOut className="h-4 w-4" />
            <span className="truncate">{user?.email}</span>
          </button>
        </div>
      </aside>

      {/* Main column */}
      <div className="flex flex-1 flex-col min-w-0">
        {/* Top bar */}
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-background/70 px-4 backdrop-blur-xl">
          <button
            onClick={() => setPaletteOpen(true)}
            className="group flex h-9 flex-1 max-w-md items-center gap-2 rounded-md border border-border bg-surface px-3 text-sm text-muted-foreground transition-colors hover:border-ring/40 hover:text-foreground"
          >
            <Search className="h-4 w-4" />
            <span className="flex-1 text-start truncate">{t("common.search")}</span>
            <kbd className="hidden sm:inline-flex items-center gap-1 rounded border border-border bg-background px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground">
              <CommandIcon className="h-3 w-3" /> K
            </kbd>
          </button>

          <div className="ms-auto flex items-center gap-1.5">
            <button
              onClick={() => setLang(lang === "en" ? "ar" : "en")}
              className="flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
              title={t("common.language")}
            >
              <Languages className="h-3.5 w-3.5" />
              {lang === "en" ? "EN" : "ع"}
            </button>
            <button
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              className="flex h-9 w-9 items-center justify-center rounded-md border border-border bg-surface text-muted-foreground hover:text-foreground transition-colors"
              title={t("common.theme")}
            >
              {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
            <button
              className="flex h-9 w-9 items-center justify-center rounded-md border border-border bg-surface text-muted-foreground hover:text-foreground transition-colors relative"
              title={t("nav.notifications")}
              onClick={() => navigate({ to: "/notifications" })}
            >
              <Bell className="h-4 w-4" />
              <span className="absolute top-1.5 end-1.5 h-1.5 w-1.5 rounded-full bg-primary" />
            </button>

          </div>
        </header>

        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-[1400px] p-6">{children}</div>
        </main>
      </div>

      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </div>
  );
}

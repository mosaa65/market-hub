import fs from "node:fs";

let content = fs.readFileSync("src/components/app-shell.tsx", "utf8");
content = content.replace(/\r\n/g, "\n");

// Add PanelLeftClose, PanelLeftOpen to imports
content = content.replace(
  '  Menu, HandCoins, AlertTriangle, LineChart, FileText, BookOpen, Scale, Landmark, PieChart,',
  '  Menu, HandCoins, AlertTriangle, LineChart, FileText, BookOpen, Scale, Landmark, PieChart,\n  PanelLeftClose, PanelLeftOpen,'
);

// Add supabase import
content = content.replace(
  'import { useModules } from "@/lib/modules";',
  'import { useModules } from "@/lib/modules";\nimport { supabase } from "@/integrations/supabase/client";'
);

// Replace SidebarContents component signature and body
const oldSidebarContentsSignature = 'function SidebarContents({ onNavigate }: { onNavigate?: () => void }) {';
const newSidebarContents = `function SidebarContents({
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
}`;

// Replace SidebarContents
const oldSectionRegex = /function SidebarContents\(\{ onNavigate \}: \{ onNavigate\?: \(\) => void \}\) \{[\s\S]*?export function AppShell/;
content = content.replace(oldSectionRegex, `${newSidebarContents}\n\nexport function AppShell`);

// Now update AppShell implementation
content = content.replace(
  '  const [mobileOpen, setMobileOpen] = useState(false);',
  `  const [mobileOpen, setMobileOpen] = useState(false);
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
  };`
);

// Update Desktop sidebar aside
content = content.replace(
  `<aside className={cn("hidden md:flex h-full w-64 shrink-0 flex-col overflow-hidden", sideEdge, "border-sidebar-border/60")}>
        <SidebarContents />
      </aside>`,
  `<aside className={cn(
        "hidden md:flex h-full shrink-0 flex-col overflow-hidden transition-all duration-300 ease-in-out",
        collapsed ? "w-[72px]" : "w-64",
        sideEdge,
        "border-sidebar-border/60"
      )}>
        <SidebarContents collapsed={collapsed} onToggleCollapse={toggleCollapsed} />
      </aside>`
);

// Add toggle button to Header next to search bar
content = content.replace(
  `          <button
            onClick={() => setPaletteOpen(true)}
            className="group flex h-10 flex-1 max-w-xl`,
  `          {/* Desktop Sidebar Collapse / Expand Toggle */}
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
            className="group flex h-10 flex-1 max-w-xl`
);

fs.writeFileSync("src/components/app-shell.tsx", content, "utf8");
console.log("Updated app-shell.tsx with Logo image, Collapsible sidebar, and header controls.");

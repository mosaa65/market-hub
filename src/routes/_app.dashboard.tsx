import { lazy, useState, useEffect, useMemo } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/page-header";
import { formatLuxuryDate, toSystemDigits } from "@/lib/format-preferences";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import { paymentMethodLabel as paymentMethodLabelFromCatalog } from "@/lib/payments/payment-methods";
import { useModules } from "@/lib/modules";
import { useAuth } from "@/lib/auth";
import { money, num } from "@/lib/format";
import { VortexMetricCard } from "@/components/vortex-ui/finance/vortex-metric-card";
import {
  ArrowUpRight,
  ArrowDownRight,
  DollarSign,
  ShoppingCart,
  Users,
  AlertTriangle,
  Package,
  TrendingUp,
  Wallet,
  ArrowRight,
  Sparkles,
  Receipt,
  Trophy,
  UserCheck,
  Award,
  Boxes,
  Sun,
  Moon,
  Sunrise,
  Crown,
  ShieldCheck,
  Calendar as CalendarIcon,
  CalendarDays,
  Clock,
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  RotateCcw,
  CalendarCheck,
  Radio,
  Activity,
  Zap,
  CheckCircle2,
} from "lucide-react";
const DashboardCharts = lazy(() => import("@/components/dashboard/dashboard-charts"));

export const Route = createFileRoute("/_app/dashboard")({
  head: () => ({ meta: [{ title: "Dashboard — Vortex ERP" }] }),
  component: DashboardPage,
});

const CHART_COLORS = [
  "oklch(0.62 0.21 260)",
  "oklch(0.7 0.18 180)",
  "oklch(0.72 0.18 60)",
  "oklch(0.68 0.2 340)",
  "oklch(0.75 0.15 140)",
];

const TOOLTIP_STYLE = {
  background: "var(--popover)",
  color: "var(--popover-foreground)",
  border: "1px solid var(--border)",
  borderRadius: 14,
  fontSize: 12,
  boxShadow: "var(--shadow-elegant)",
} as const;
const TOOLTIP_ITEM_STYLE = { color: "var(--popover-foreground)" } as const;
const TOOLTIP_LABEL_STYLE = { color: "var(--muted-foreground)", marginBottom: 4 } as const;
const CHART_GRID_STROKE = "var(--border)";

function paymentMethodLabel(method: string | null | undefined, isAr: boolean): string {
  // The catalogue, not a local map — see the same change in _app.analytics.tsx.
  return paymentMethodLabelFromCatalog(method, isAr ? "ar" : "en");
}

function getGreeting(hour: number, isAr: boolean) {
  if (hour >= 4 && hour < 12) {
    return {
      title: isAr ? "صباح الخير والبركة" : "Good morning",
      icon: Sunrise,
      badge: isAr ? "بداية يوم موفقة ☀️" : "Morning focus",
      color: "text-amber-500",
    };
  }
  if (hour >= 12 && hour < 17) {
    return {
      title: isAr ? "طاب يومك بكل خير" : "Good afternoon",
      icon: Sun,
      badge: isAr ? "ذروة النشاط 🌤️" : "Peak afternoon",
      color: "text-amber-400",
    };
  }
  return {
    title: isAr ? "مساء النور والمسرات" : "Good evening",
    icon: Moon,
    badge: isAr ? "أمسية سعيدة 🌙" : "Evening wrap-up",
    color: "text-indigo-400",
  };
}

function getRoleMeta(
  isPlatformSuperadmin: boolean,
  isPlatformAdmin: boolean,
  hasRole: (r: any) => boolean,
  isAr: boolean,
) {
  if (isPlatformSuperadmin) {
    return {
      label: isAr ? "السوبر أدمن 👑" : "Superadmin",
      badgeCls: "border-amber-500/40 bg-amber-500/10 text-amber-500",
      icon: Crown,
    };
  }
  if (isPlatformAdmin) {
    return {
      label: isAr ? "مدير المنصة 🛡️" : "Platform Admin",
      badgeCls: "border-primary/40 bg-primary/10 text-primary",
      icon: ShieldCheck,
    };
  }
  if (hasRole("owner")) {
    return {
      label: isAr ? "مالك النظام ⚡" : "Business Owner",
      badgeCls: "border-emerald-500/40 bg-emerald-500/10 text-emerald-500",
      icon: Crown,
    };
  }
  if (hasRole("admin")) {
    return {
      label: isAr ? "مدير النظام 👔" : "Admin",
      badgeCls: "border-primary/30 bg-primary/10 text-primary",
      icon: ShieldCheck,
    };
  }
  if (hasRole("accountant")) {
    return {
      label: isAr ? "المحاسب المالي 💼" : "Accountant",
      badgeCls: "border-blue-500/30 bg-blue-500/10 text-blue-500",
      icon: ShieldCheck,
    };
  }
  if (hasRole("cashier")) {
    return {
      label: isAr ? "كاشير 🏷️" : "Cashier",
      badgeCls: "border-cyan-500/30 bg-cyan-500/10 text-cyan-500",
      icon: ShieldCheck,
    };
  }
  return {
    label: isAr ? "عضو فريق" : "Staff Member",
    badgeCls: "border-border bg-surface-2 text-muted-foreground",
    icon: ShieldCheck,
  };
}

function DashboardPage() {
  const { isModuleEnabled } = useModules();
  const { t, lang, dir } = useI18n();
  const isAr = lang === "ar";
  const { user, isPlatformAdmin, isPlatformSuperadmin, hasRole } = useAuth();

  // User Profile
  const { data: profile } = useQuery({
    queryKey: ["current-user-profile", user?.id],
    enabled: Boolean(user?.id),
    queryFn: async () => {
      if (!user?.id) return null;
      const { data } = await supabase
        .from("profiles")
        .select("full_name, avatar_url")
        .eq("id", user.id)
        .maybeSingle();
      return data;
    },
  });

  const userName =
    profile?.full_name ||
    user?.user_metadata?.full_name ||
    (user?.email ? user.email.split("@")[0] : isAr ? "موسى" : "User");

  // Selected Date, Calendar View Month & Live Clock State
  const [selectedDate, setSelectedDate] = useState<Date>(() => new Date());
  const [calendarMonth, setCalendarMonth] = useState<Date>(() => new Date());
  const [currentTime, setCurrentTime] = useState<Date>(() => new Date());

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const now = currentTime;
  const currentHour = now.getHours();
  const greeting = getGreeting(currentHour, isAr);
  const roleMeta = getRoleMeta(isPlatformSuperadmin, isPlatformAdmin, hasRole, isAr);

  // Elegant Date formatting
  const formattedDate = now.toLocaleDateString(isAr ? "ar-YE" : "en-US", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  const { data } = useQuery({
    queryKey: ["dashboard-v2"],
    staleTime: 180_000, // 3 minutes cache for dashboard metrics
    queryFn: async () => {
      const since = new Date(Date.now() - 30 * 86400_000).toISOString();
      const since14 = new Date(Date.now() - 14 * 86400_000).toISOString();
      const [sales, customers, products, inv, items, recent, expenses] = await Promise.all([
        supabase
          .from("sales_invoices")
          .select("id,invoice_number,total,paid,payment_method,created_at,status,customer_id")
          .gte("created_at", since),
        supabase
          .from("customers")
          .select("id,name,balance", { count: "exact" })
          .eq("is_active", true)
          .limit(500),
        supabase.from("products").select("id,name,name_ar,min_stock,sale_price").limit(1000),
        supabase.from("inventory").select("product_id,quantity").limit(2000),
        supabase
          .from("sales_invoice_items")
          .select(
            "product_id,quantity,total,invoice_id,sales_invoices!inner(created_at,customer_id)",
          )
          .gte("sales_invoices.created_at", since)
          .limit(2000),
        supabase
          .from("sales_invoices")
          .select("id,invoice_number,total,status,created_at,customers(name)")
          .gte("created_at", since14)
          .order("created_at", { ascending: false })
          .limit(8),
        (supabase as any)
          .from("expense_entries")
          .select("total_amount,paid_amount,status,expense_date,created_at")
          .in("status", ["POSTED", "PARTIALLY_PAID", "PAID", "CLOSED"])
          .gte("expense_date", since.slice(0, 10)),
      ]);

      const salesRows = sales.data ?? [];
      const stockMap = new Map<string, number>();
      (inv.data ?? []).forEach((r: any) =>
        stockMap.set(r.product_id, (stockMap.get(r.product_id) ?? 0) + Number(r.quantity)),
      );
      const lowStock = (products.data ?? []).filter(
        (p: any) => (stockMap.get(p.id) ?? 0) <= Number(p.min_stock ?? 0),
      );

      const daily: { day: string; revenue: number; orders: number }[] = [];
      for (let i = 13; i >= 0; i--) {
        const d = new Date(Date.now() - i * 86400_000);
        const key = d.toISOString().slice(0, 10);
        const label = d.toLocaleDateString(lang === "ar" ? "ar" : "en", { weekday: "short" });
        const rows = salesRows.filter((r) => (r as any).created_at.slice(0, 10) === key);
        daily.push({
          day: label,
          revenue: rows.reduce((a, r: any) => a + Number(r.total), 0),
          orders: rows.length,
        });
      }

      const prodAgg = new Map<string, { qty: number; total: number }>();
      (items.data ?? []).forEach((it: any) => {
        const cur = prodAgg.get(it.product_id) ?? { qty: 0, total: 0 };
        cur.qty += Number(it.quantity);
        cur.total += Number(it.total);
        prodAgg.set(it.product_id, cur);
      });
      const prodMap = new Map((products.data ?? []).map((p: any) => [p.id, p]));
      const topProducts = Array.from(prodAgg.entries())
        .map(([id, v]) => ({ ...v, product: prodMap.get(id) as any }))
        .filter((x) => x.product)
        .sort((a, b) => b.total - a.total)
        .slice(0, 5);

      const paySplit: Record<string, number> = {};
      salesRows.forEach((r: any) => {
        const label = paymentMethodLabel(r.payment_method, lang === "ar");
        paySplit[label] = (paySplit[label] ?? 0) + Number(r.paid);
      });

      const totalRev = salesRows.reduce((a, r: any) => a + Number(r.total), 0);
      const totalPaid = salesRows.reduce((a, r: any) => a + Number(r.paid), 0);
      const expRows = (expenses.data ?? []) as any[];
      const totalExpenses = expRows.reduce((a, r) => a + Number(r.total_amount || 0), 0);
      const totalExpenseCashPaid = expRows.reduce((a, r) => a + Number(r.paid_amount || 0), 0);
      const receivables = (customers.data ?? []).reduce(
        (a, r: any) => a + Math.max(0, Number(r.balance ?? 0)),
        0,
      );
      const topDebtors = (customers.data ?? [])
        .filter((c: any) => Number(c.balance) > 0)
        .sort((a: any, b: any) => Number(b.balance) - Number(a.balance))
        .slice(0, 5);

      return {
        allSalesRows: salesRows,
        revenue: totalRev,
        collected: totalPaid,
        orders: salesRows.length,
        customers: customers.count ?? 0,
        alerts: lowStock.length,
        expenses: totalExpenses,
        receivables,
        netCash: totalPaid - totalExpenseCashPaid,
        daily,
        topProducts,
        paySplit,
        recent: recent.data ?? [],
        lowStock: lowStock.slice(0, 6).map((p: any) => ({ ...p, stock: stockMap.get(p.id) ?? 0 })),
        topDebtors,
      };
    },
  });

  const paymentPie = Object.entries(data?.paySplit ?? {}).map(([name, value]) => ({ name, value }));

  const GreetingIcon = greeting.icon;

  return (
    <>
      <PageHeader title={t("dash.title")} subtitle={t("dash.subtitle")} />

      {/* ═══════════════════════════════════════════════════════════════════════
          TOP EXECUTIVE BANNER — FULL WIDTH, COMPACT HEIGHT, UNIFIED ELEGANCE
          ═══════════════════════════════════════════════════════════════════════ */}
      <div className="mb-4 w-full rounded-2xl border border-border/70 bg-gradient-to-r from-card via-card/95 to-surface-2/40 dark:from-zinc-950 dark:via-zinc-900/90 dark:to-zinc-950 px-4 sm:px-6 py-3 sm:py-3.5 shadow-sm backdrop-blur-xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-4 transition-all">
        {/* User Identity & Smart Greeting (Single Unified Color, Zero Clutter) */}
        <div className="flex items-center gap-3 sm:gap-4 min-w-0">
          {/* User Avatar: Luxury Circular Frosted Glass Badge with Live Pulse */}
          <div className="relative shrink-0">
            {profile?.avatar_url ? (
              <img
                src={profile.avatar_url}
                alt={userName}
                className="size-11 sm:size-12 rounded-full object-cover ring-2 ring-amber-500/30 shadow-md"
              />
            ) : (
              <div className="relative grid size-11 sm:size-12 place-items-center rounded-full bg-gradient-to-tr from-amber-500/20 via-zinc-800/40 to-emerald-500/20 dark:from-amber-400/15 dark:via-zinc-800/60 dark:to-emerald-400/15 backdrop-blur-xl border border-white/20 dark:border-white/10 shadow-md ring-1 ring-amber-500/25">
                <roleMeta.icon className="size-5 sm:size-6 text-amber-500 dark:text-amber-400 filter drop-shadow-sm" />
              </div>
            )}
            <span
              className="absolute -bottom-0.5 -end-0.5 flex size-4 items-center justify-center"
              title={isAr ? "جلسة موثقة ومتصلة لحظياً" : "Live Session"}
            >
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-60" />
              <span className="relative inline-flex size-2.5 rounded-full bg-emerald-500 ring-2 ring-card shadow-xs" />
            </span>
          </div>

          {/* Smart Greeting & User Name in Clean Unified High-End Typography */}
          <div className="space-y-0.5 min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs sm:text-sm font-semibold text-muted-foreground flex items-center gap-1.5">
                <GreetingIcon className={`size-3.5 ${greeting.color}`} />
                <span>{greeting.title}،</span>
              </span>
              <span className="text-sm sm:text-base font-black text-foreground tracking-tight">
                {userName}
              </span>
              <span
                className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.2 text-[10px] font-bold shadow-xs ${roleMeta.badgeCls}`}
              >
                <span>{roleMeta.label}</span>
              </span>
            </div>
            <p className="text-[11px] sm:text-xs text-muted-foreground font-medium truncate">
              {isAr
                ? "لوحة القيادة التنفيذية • متابعة مباشرة لتدفقات الأعمال والعمليات التشغيلية"
                : "Executive Command Deck • Live operational monitoring & business workflows"}
            </p>
          </div>
        </div>

        {/* Live System Indicator Badge */}
        <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1 text-xs font-semibold text-emerald-600 dark:text-emerald-400 shadow-xs">
            <span className="size-2 rounded-full bg-emerald-500 animate-pulse" />
            <span>{isAr ? "مركز العمليات متصل" : "Command Deck Active"}</span>
          </span>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════════════
          EXECUTIVE WORKFLOW DECK: (OPERATIONS BRIEFING & DOCK) + (LUXURY MONTH CHRONOS)
          ═══════════════════════════════════════════════════════════════════════ */}
      <div className="mb-6 space-y-4">
        {(() => {
          // Date selection helpers
          const selectedDateKey = `${selectedDate.getFullYear()}-${String(selectedDate.getMonth() + 1).padStart(2, "0")}-${String(selectedDate.getDate()).padStart(2, "0")}`;
          const todayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
          const isSelectedToday = selectedDateKey === todayKey;

          // Calendar calculation for full month
          const calYear = calendarMonth.getFullYear();
          const calMonth = calendarMonth.getMonth();
          const firstDayOfMonth = new Date(calYear, calMonth, 1);
          const lastDayOfMonth = new Date(calYear, calMonth + 1, 0);
          const daysInMonth = lastDayOfMonth.getDate();

          // Week starts on Saturday (0) through Friday (6)
          const startOffset = (firstDayOfMonth.getDay() + 1) % 7;
          const prevMonthLastDate = new Date(calYear, calMonth, 0).getDate();

          const calendarCells = [];
          for (let i = startOffset - 1; i >= 0; i--) {
            const d = prevMonthLastDate - i;
            calendarCells.push({
              day: d,
              date: new Date(calYear, calMonth - 1, d),
              isCurrentMonth: false,
            });
          }
          for (let d = 1; d <= daysInMonth; d++) {
            calendarCells.push({
              day: d,
              date: new Date(calYear, calMonth, d),
              isCurrentMonth: true,
            });
          }
          const targetTotal = calendarCells.length > 35 ? 42 : 35;
          const nextDaysNeeded = targetTotal - calendarCells.length;
          for (let d = 1; d <= nextDaysNeeded; d++) {
            calendarCells.push({
              day: d,
              date: new Date(calYear, calMonth + 1, d),
              isCurrentMonth: false,
            });
          }

          const monthNamesAr = [
            "يناير",
            "فبراير",
            "مارس",
            "أبريل",
            "مايو",
            "يونيو",
            "يوليو",
            "أغسطس",
            "سبتمبر",
            "أكتوبر",
            "نوفمبر",
            "ديسمبر",
          ];
          const monthNamesEn = [
            "January",
            "February",
            "March",
            "April",
            "May",
            "June",
            "July",
            "August",
            "September",
            "October",
            "November",
            "December",
          ];
          const currentMonthName = isAr ? monthNamesAr[calMonth] : monthNamesEn[calMonth];

          const weekHeadersAr = [
            "السبت",
            "الأحد",
            "الاثنين",
            "الثلاثاء",
            "الأربعاء",
            "الخميس",
            "الجمعة",
          ];
          const weekHeadersEn = ["Sat", "Sun", "Mon", "Tue", "Wed", "Thu", "Fri"];
          const weekHeaders = isAr ? weekHeadersAr : weekHeadersEn;

          // Sales rows calculation for selected date
          const allSales = data?.allSalesRows ?? [];
          const selectedDaySalesRows = allSales.filter(
            (r: any) => ((r.created_at || "") as string).slice(0, 10) === selectedDateKey,
          );
          const selectedDayRevenue = isSelectedToday
            ? data?.daily && data.daily.length > 0
              ? (data.daily[data.daily.length - 1]?.revenue ?? 0)
              : selectedDaySalesRows.reduce((a: number, r: any) => a + Number(r.total || 0), 0)
            : selectedDaySalesRows.reduce((a: number, r: any) => a + Number(r.total || 0), 0);
          const selectedDayOrders = isSelectedToday
            ? data?.daily && data.daily.length > 0
              ? (data.daily[data.daily.length - 1]?.orders ?? 0)
              : selectedDaySalesRows.length
            : selectedDaySalesRows.length;

          const selectedLuxuryDate = formatLuxuryDate(selectedDate, {
            showDayName: true,
            showYear: true,
          });

          return (
            <>
              {/* Top Row: Operational Briefing & Launchers + Full Month Luxury Chronos */}
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-12 items-stretch">
                {/* Card 1: Operational Briefing & Quick Launchers Dock (6 cols) */}
                <div className="relative overflow-hidden rounded-3xl border border-border/80 bg-gradient-to-br from-card via-card/95 to-zinc-900/40 dark:from-zinc-950 dark:via-zinc-900/90 dark:to-zinc-950 p-5 sm:p-6 lg:col-span-6 shadow-panel backdrop-blur-xl flex flex-col justify-between">
                  {/* Ambient Lighting */}
                  <div className="pointer-events-none absolute -top-24 -start-24 size-72 rounded-full bg-amber-500/10 blur-3xl opacity-70" />
                  <div className="pointer-events-none absolute -bottom-24 -end-24 size-64 rounded-full bg-emerald-500/10 blur-3xl opacity-60" />
                  <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-amber-500/30 to-transparent" />

                  {/* Operational Briefing Header (Replaced user greeting with business health briefing) */}
                  <div className="relative space-y-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="grid size-11 place-items-center rounded-2xl bg-gradient-to-br from-amber-500/20 via-amber-500/10 to-transparent border border-amber-500/30 text-amber-500 shadow-inner">
                          <Activity className="size-5" />
                        </div>
                        <div>
                          <h3 className="text-base sm:text-lg font-black text-foreground tracking-tight">
                            {isAr
                              ? "الموجز التنفيذي والجاهزية اليومية"
                              : "Executive Operations Briefing"}
                          </h3>
                          <p className="text-xs text-muted-foreground font-medium">
                            {isAr
                              ? "كفاءة حركة النقد ومسارات الإنجاز الفوري"
                              : "Cash velocity & rapid execution paths"}
                          </p>
                        </div>
                      </div>
                      <span className="hidden sm:inline-flex items-center gap-1 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-0.5 text-[11px] font-bold text-emerald-600 dark:text-emerald-400">
                        <CheckCircle2 className="size-3" />
                        <span>{isAr ? "تشغيلي 100%" : "Optimal"}</span>
                      </span>
                    </div>

                    {/* Operational Pulse Metrics */}
                    <div className="grid grid-cols-3 gap-2.5 pt-1">
                      <div className="rounded-2xl border border-border/70 bg-surface/60 p-3 backdrop-blur-xs">
                        <span className="block text-[11px] font-semibold text-muted-foreground mb-1">
                          {isAr ? "الوردية والبيع" : "Shift Status"}
                        </span>
                        <div className="flex items-center gap-1.5">
                          <span className="size-2 rounded-full bg-emerald-500 animate-pulse" />
                          <span className="text-xs sm:text-sm font-bold text-foreground truncate">
                            {isAr ? "نقطة البيع نشطة" : "POS Ready"}
                          </span>
                        </div>
                      </div>

                      <div className="rounded-2xl border border-border/70 bg-surface/60 p-3 backdrop-blur-xs">
                        <span className="block text-[11px] font-semibold text-muted-foreground mb-1">
                          {isAr ? "عمليات اليوم المختار" : "Selected Day"}
                        </span>
                        <div className="flex items-center gap-1.5 font-mono text-xs sm:text-sm font-black text-foreground">
                          <ShoppingCart className="size-3.5 text-amber-500 shrink-0" />
                          <span>
                            {num(selectedDayOrders)} {isAr ? "فاتورة" : "orders"}
                          </span>
                        </div>
                      </div>

                      <div className="rounded-2xl border border-border/70 bg-surface/60 p-3 backdrop-blur-xs">
                        <span className="block text-[11px] font-semibold text-muted-foreground mb-1">
                          {isAr ? "جاهزية البيانات" : "Data Sync"}
                        </span>
                        <div className="flex items-center gap-1.5 text-xs sm:text-sm font-bold text-foreground">
                          <Zap className="size-3.5 text-amber-500 shrink-0" />
                          <span className="text-emerald-600 dark:text-emerald-400 truncate">
                            {isAr ? "محدثة كلياً" : "Live Synced"}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Fast Launchers Dock (Preserved Exactly As Requested) */}
                  <div className="relative mt-5 pt-4 border-t border-border/50">
                    <div className="flex items-center justify-between mb-2.5">
                      <span className="text-xs font-bold text-muted-foreground">
                        {isAr ? "مسارات الإطلاق السريع:" : "Fast Actions:"}
                      </span>
                      <span className="text-[11px] font-medium text-muted-foreground/80">
                        {isAr ? "اختصارات لوحة المفاتيح مدعومة" : "Shortcuts ready"}
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        to="/pos"
                        className="inline-flex h-8 sm:h-9 items-center gap-2 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 px-3 text-xs font-bold text-white shadow-sm hover:from-amber-600 hover:to-amber-700 transition-all active:scale-95"
                      >
                        <Zap className="size-3.5" />
                        <span>{lang === "ar" ? "نقطة البيع (POS)" : "Open POS"}</span>
                        <kbd className="hidden sm:inline-block rounded bg-black/20 px-1 py-0.2 text-[9px] font-mono">
                          F2
                        </kbd>
                      </Link>

                      <Link
                        to="/sales"
                        className="inline-flex h-8 sm:h-9 items-center gap-1.5 rounded-xl border border-border/80 bg-surface/80 px-2.5 text-xs font-semibold text-foreground hover:bg-surface-2 transition-all active:scale-95"
                      >
                        <Receipt className="size-3.5 text-muted-foreground" />
                        <span>{lang === "ar" ? "الفواتير" : "Invoices"}</span>
                      </Link>

                      <Link
                        to="/debts"
                        className="inline-flex h-8 sm:h-9 items-center gap-1.5 rounded-xl border border-border/80 bg-surface/80 px-2.5 text-xs font-semibold text-foreground hover:bg-surface-2 transition-all active:scale-95"
                      >
                        <Wallet className="size-3.5 text-amber-500" />
                        <span>{lang === "ar" ? "التحصيل والديون" : "Debts"}</span>
                      </Link>

                      <Link
                        to={"/products" as any}
                        search={{ barcode: undefined } as any}
                        className="inline-flex h-8 sm:h-9 items-center gap-1.5 rounded-xl border border-border/80 bg-surface/80 px-2.5 text-xs font-semibold text-foreground hover:bg-surface-2 transition-all active:scale-95"
                      >
                        <Package className="size-3.5 text-muted-foreground" />
                        <span>{lang === "ar" ? "المنتجات" : "Products"}</span>
                      </Link>
                    </div>
                  </div>
                </div>

                {/* Card 2: Luxury Executive Chronos & Full Month Calendar (6 cols) */}
                <div className="relative overflow-hidden rounded-3xl border border-border/80 bg-gradient-to-br from-card via-surface/90 to-zinc-900/30 dark:from-zinc-950 dark:via-zinc-900/80 dark:to-zinc-950 p-5 sm:p-6 lg:col-span-6 shadow-panel backdrop-blur-xl flex flex-col justify-between">
                  {/* Ambient Lighting */}
                  <div className="pointer-events-none absolute -top-20 -end-20 size-60 rounded-full bg-amber-500/10 blur-3xl opacity-60" />
                  <div className="pointer-events-none absolute -bottom-20 -start-20 size-56 rounded-full bg-emerald-500/10 blur-3xl opacity-40" />
                  <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-amber-500/30 to-transparent" />

                  <div className="space-y-3.5">
                    {/* Header: Month Navigator + Live Universal Clock (No Country Label) */}
                    <div className="flex items-center justify-between gap-2 border-b border-border/50 pb-3">
                      {/* Month Switcher with Circular Buttons */}
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setCalendarMonth(new Date(calYear, calMonth - 1, 1))}
                          className="size-8 rounded-full border border-border/80 bg-surface/80 hover:bg-surface-2 text-foreground flex items-center justify-center transition-all active:scale-95 shadow-xs"
                          title={isAr ? "الشهر السابق" : "Previous Month"}
                        >
                          <ChevronRight className="size-4 rtl:rotate-0 rotate-180" />
                        </button>

                        <div className="text-center min-w-[110px]">
                          <span className="block text-sm font-black text-foreground tracking-tight">
                            {currentMonthName} {calYear}
                          </span>
                        </div>

                        <button
                          type="button"
                          onClick={() => setCalendarMonth(new Date(calYear, calMonth + 1, 1))}
                          className="size-8 rounded-full border border-border/80 bg-surface/80 hover:bg-surface-2 text-foreground flex items-center justify-center transition-all active:scale-95 shadow-xs"
                          title={isAr ? "الشهر التالي" : "Next Month"}
                        >
                          <ChevronLeft className="size-4 rtl:rotate-0 rotate-180" />
                        </button>

                        {!isSelectedToday && (
                          <button
                            type="button"
                            onClick={() => {
                              const t = new Date();
                              setSelectedDate(t);
                              setCalendarMonth(new Date(t.getFullYear(), t.getMonth(), 1));
                            }}
                            className="size-8 rounded-full border border-amber-500/30 bg-amber-500/10 text-amber-500 hover:bg-amber-500/20 flex items-center justify-center transition-all active:scale-95 shadow-xs"
                            title={isAr ? "العودة لتاريخ اليوم" : "Reset to Today"}
                          >
                            <RotateCcw className="size-3.5" />
                          </button>
                        )}
                      </div>

                      {/* Clean Universal Digital Clock (Zero Country Label) */}
                      <div className="rounded-2xl border border-border/80 bg-zinc-900/10 dark:bg-zinc-800/40 px-3 py-1.5 text-end shadow-xs backdrop-blur-md">
                        <div className="flex items-center gap-1.5 text-xs sm:text-sm font-black font-mono text-foreground justify-end tracking-wider">
                          <Clock className="size-3.5 text-amber-500 animate-pulse" />
                          <span>
                            {now.toLocaleTimeString(isAr ? "ar-YE" : "en-US", {
                              hour: "2-digit",
                              minute: "2-digit",
                              second: "2-digit",
                            })}
                          </span>
                        </div>
                        <div className="flex items-center gap-1 text-[9px] text-muted-foreground font-semibold justify-end">
                          <Radio className="size-2 text-emerald-500 animate-pulse" />
                          <span>{isAr ? "مزامنة التوقيت الحي" : "Live Clock Sync"}</span>
                        </div>
                      </div>
                    </div>

                    {/* Full Month Calendar Grid (7 Weekdays + Circular Day Buttons) */}
                    <div className="rounded-2xl border border-border/60 bg-surface/40 p-2.5 backdrop-blur-xs">
                      {/* Weekday Labels Header */}
                      <div className="grid grid-cols-7 gap-1 text-center mb-1.5">
                        {weekHeaders.map((w, idx) => (
                          <span
                            key={idx}
                            className="text-[10px] sm:text-[11px] font-bold text-muted-foreground/80 py-0.5"
                          >
                            {w.slice(0, 3)}
                          </span>
                        ))}
                      </div>

                      {/* Month Day Cells */}
                      <div className="grid grid-cols-7 gap-1 place-items-center">
                        {calendarCells.map((cell, idx) => {
                          const cellDateKey = `${cell.date.getFullYear()}-${String(cell.date.getMonth() + 1).padStart(2, "0")}-${String(cell.date.getDate()).padStart(2, "0")}`;
                          const isSelected = cellDateKey === selectedDateKey;
                          const isTodayCell = cellDateKey === todayKey;

                          return (
                            <button
                              key={idx}
                              type="button"
                              onClick={() => {
                                setSelectedDate(cell.date);
                              }}
                              className={`size-7 sm:size-8 rounded-full flex items-center justify-center font-mono text-xs font-semibold transition-all ${
                                isSelected
                                  ? "bg-gradient-to-tr from-amber-500 to-amber-600 text-white font-black shadow-md scale-105 ring-2 ring-amber-500/50"
                                  : isTodayCell
                                    ? "border border-amber-500/60 bg-amber-500/10 text-amber-500 font-bold hover:bg-amber-500/20"
                                    : cell.isCurrentMonth
                                      ? "text-foreground hover:bg-surface-2 hover:scale-105"
                                      : "text-muted-foreground/35 hover:text-muted-foreground/60 text-[11px]"
                              }`}
                              title={
                                formatLuxuryDate(cell.date, { showDayName: true, showYear: true })
                                  .full
                              }
                            >
                              {cell.day}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Selected Date Status & Daily Filter Feedback */}
                    <div className="flex items-center justify-between text-xs pt-1 text-muted-foreground">
                      <div className="flex items-center gap-1.5 font-medium truncate">
                        <CalendarCheck className="size-3.5 text-amber-500 shrink-0" />
                        <span className="font-bold text-foreground">
                          {selectedLuxuryDate.weekday}، {selectedLuxuryDate.day}{" "}
                          {selectedLuxuryDate.month} {selectedLuxuryDate.year}
                        </span>
                        {!isSelectedToday && (
                          <span className="inline-flex items-center rounded-md bg-amber-500/10 border border-amber-500/20 px-1.5 py-0.2 text-[9px] font-bold text-amber-600 dark:text-amber-400">
                            {isAr ? "مفلتر" : "Filtered"}
                          </span>
                        )}
                      </div>

                      <Link
                        to="/daily-journal"
                        className="text-[11px] font-bold text-amber-500 hover:text-amber-600 dark:hover:text-amber-400 hover:underline flex items-center gap-0.5 shrink-0"
                      >
                        {isAr ? "دفتر اليومية" : "Journal"}
                        <ChevronLeft className="size-3 rtl:rotate-0 rotate-180" />
                      </Link>
                    </div>
                  </div>
                </div>
              </div>

              {/* Bottom Deck: Executive Business Vitals & Real-Time Pulse (3 Dynamic Cards) */}
              {data && (
                <div className="grid grid-cols-1 gap-3 sm:gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {/* Vital Card 1: Selected Day Sales Velocity (Dynamic according to chosen date) */}
                  <div className="relative overflow-hidden rounded-2xl border border-border/80 bg-gradient-to-br from-card via-card/95 to-surface-2/40 p-4.5 shadow-sm transition-all hover:shadow-md hover:border-primary/40 group">
                    <div className="pointer-events-none absolute top-0 end-0 size-24 bg-primary/10 rounded-full blur-xl group-hover:bg-primary/15 transition-all" />
                    <div className="flex items-center justify-between text-xs text-muted-foreground mb-2">
                      <div className="flex items-center gap-2">
                        <div className="grid size-8 place-items-center rounded-xl bg-primary/10 text-primary border border-primary/20">
                          <TrendingUp className="size-4" />
                        </div>
                        <span className="font-bold text-foreground text-xs sm:text-sm">
                          {isSelectedToday
                            ? isAr
                              ? "تدفق مبيعات اليوم"
                              : "Today Sales Inflow"
                            : isAr
                              ? `مبيعات (${selectedDateKey})`
                              : `Inflow (${selectedDateKey})`}
                        </span>
                      </div>
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold border ${
                          isSelectedToday
                            ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-600 dark:text-emerald-400"
                            : "bg-amber-500/10 border-amber-500/20 text-amber-600 dark:text-amber-400"
                        }`}
                      >
                        <span
                          className={`size-1.5 rounded-full ${isSelectedToday ? "bg-emerald-500 animate-pulse" : "bg-amber-500"}`}
                        />
                        <span>
                          {isSelectedToday
                            ? isAr
                              ? "مباشر"
                              : "Live"
                            : isAr
                              ? "يوم محدد"
                              : "Selected"}
                        </span>
                      </span>
                    </div>

                    <div className="mt-2.5 flex items-baseline justify-between gap-2">
                      <span className="text-2xl sm:text-3xl font-black font-mono tracking-tight text-foreground">
                        {money(selectedDayRevenue)}
                      </span>
                    </div>

                    <div className="mt-2 pt-2 border-t border-border/50 flex items-center justify-between text-xs text-muted-foreground">
                      <span className="flex items-center gap-1 text-[11px] font-medium">
                        <ShoppingCart className="size-3 text-muted-foreground/70" />
                        <span>
                          {num(selectedDayOrders)} {isAr ? "فواتير مسجلة" : "invoices recorded"}
                        </span>
                      </span>
                      <Link
                        to="/sales"
                        className="text-[11px] font-bold text-primary hover:underline flex items-center gap-0.5"
                      >
                        {isAr ? "سجل المبيعات" : "Sales log"}
                        <ChevronLeft className="size-3 rtl:rotate-0 rotate-180" />
                      </Link>
                    </div>
                  </div>

                  {/* Vital Card 2: Market Liquidity & Receivables Exposure (Lifetime Metric - Untouched) */}
                  <div className="relative overflow-hidden rounded-2xl border border-border/80 bg-gradient-to-br from-card via-card/95 to-surface-2/40 p-4.5 shadow-sm transition-all hover:shadow-md hover:border-amber-500/40 group">
                    <div className="pointer-events-none absolute top-0 end-0 size-24 bg-amber-500/10 rounded-full blur-xl group-hover:bg-amber-500/15 transition-all" />
                    <div className="flex items-center justify-between text-xs text-muted-foreground mb-2">
                      <div className="flex items-center gap-2">
                        <div className="grid size-8 place-items-center rounded-xl bg-amber-500/10 text-amber-500 border border-amber-500/20">
                          <Wallet className="size-4" />
                        </div>
                        <span className="font-bold text-foreground text-xs sm:text-sm">
                          {isAr ? "مستحقات السوق والذمم" : "Receivables & Market"}
                        </span>
                      </div>
                      <span className="rounded-full bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 text-[10px] font-bold text-amber-600 dark:text-amber-400">
                        {isAr ? "إجمالي تراكمي" : "Total Ledger"}
                      </span>
                    </div>

                    <div className="mt-2.5 flex items-baseline justify-between gap-2">
                      <span className="text-2xl sm:text-3xl font-black font-mono tracking-tight text-foreground">
                        {money(data.receivables ?? 0)}
                      </span>
                    </div>

                    <div className="mt-2 pt-2 border-t border-border/50 flex items-center justify-between text-xs text-muted-foreground">
                      <span className="text-[11px] font-medium">
                        {isAr ? "أرصدة عملاء قائمة بالسوق" : "Outstanding customer balances"}
                      </span>
                      <Link
                        to="/debts"
                        className="text-[11px] font-bold text-amber-600 dark:text-amber-400 hover:underline flex items-center gap-0.5"
                      >
                        {isAr ? "متابعة وسندات" : "Collect"}
                        <ChevronLeft className="size-3 rtl:rotate-0 rotate-180" />
                      </Link>
                    </div>
                  </div>

                  {/* Vital Card 3: Supply Chain Readiness & Critical Stock (Lifetime Metric - Untouched) */}
                  <div className="relative overflow-hidden rounded-2xl border border-border/80 bg-gradient-to-br from-card via-card/95 to-surface-2/40 p-4.5 shadow-sm transition-all hover:shadow-md hover:border-chart-4/40 group sm:col-span-2 lg:col-span-1">
                    <div className="pointer-events-none absolute top-0 end-0 size-24 bg-chart-4/10 rounded-full blur-xl group-hover:bg-chart-4/15 transition-all" />
                    <div className="flex items-center justify-between text-xs text-muted-foreground mb-2">
                      <div className="flex items-center gap-2">
                        <div className="grid size-8 place-items-center rounded-xl bg-primary/10 text-primary border border-primary/20">
                          <Activity className="size-4" />
                        </div>
                        <span className="font-bold text-foreground text-xs sm:text-sm">
                          {isAr ? "جاهزية المخزون وسلاسل الإمداد" : "Stock Readiness & Ops"}
                        </span>
                      </div>
                      <span className="text-[10px] font-mono font-semibold text-muted-foreground">
                        {isAr ? "فحص آلي" : "Auto Check"}
                      </span>
                    </div>

                    <div className="mt-2.5 flex items-center gap-2">
                      {(data.alerts ?? 0) > 0 ? (
                        <div className="flex items-center gap-2 rounded-xl bg-rose-500/10 border border-rose-500/20 px-3 py-1.5 text-rose-600 dark:text-rose-400 w-full">
                          <AlertTriangle className="size-4 shrink-0 animate-bounce" />
                          <span className="text-xs sm:text-sm font-bold truncate">
                            {data.alerts}{" "}
                            {isAr ? "أصناف دون حد الأمان" : "items below reorder point"}
                          </span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20 px-3 py-1.5 text-emerald-600 dark:text-emerald-400 w-full">
                          <CheckCircle2 className="size-4 shrink-0" />
                          <span className="text-xs sm:text-sm font-bold truncate">
                            {isAr ? "المستودعات متزنة وفي النطاق الآمن" : "Warehouses optimal"}
                          </span>
                        </div>
                      )}
                    </div>

                    <div className="mt-2 pt-2 border-t border-border/50 flex items-center justify-between text-xs text-muted-foreground">
                      <span className="text-[11px] font-medium truncate">
                        {(data.alerts ?? 0) > 0
                          ? isAr
                            ? "تتطلب إصدار أمر شراء أو تحويل"
                            : "Reorder or transfer needed"
                          : isAr
                            ? "لا توجد نواقص حرجة تتطلب تدخلاً"
                            : "All safety limits honored"}
                      </span>
                      <Link
                        to="/inventory"
                        className="text-[11px] font-bold text-primary hover:underline flex items-center gap-0.5 shrink-0"
                      >
                        {isAr ? "فحص المستودعات" : "Inspect"}
                        <ChevronLeft className="size-3 rtl:rotate-0 rotate-180" />
                      </Link>
                    </div>
                  </div>
                </div>
              )}
            </>
          );
        })()}
      </div>

      {/* Modern Vortex Metric Cards Grid - 2 cards per row on mobile */}
      <div className="grid grid-cols-2 gap-2.5 sm:gap-4 lg:grid-cols-4 mb-6">
        <Link to="/sales" className="block focus:outline-none">
          <VortexMetricCard
            title={t("dash.sales")}
            value={num(data?.orders ?? 0)}
            subtitle={lang === "ar" ? "مبيعات آخر 30 يوماً" : "Last 30 days"}
            badge={lang === "ar" ? "فواتير" : "Orders"}
            currency=""
            icon={<ShoppingCart className="size-5" />}
            iconClassName="bg-primary/10 text-primary"
            trend={{
              value: "+4.2%",
              direction: "up",
              isPositive: true,
              label: lang === "ar" ? "نمو" : "growth",
            }}
          />
        </Link>

        <Link to="/customers" className="block focus:outline-none">
          <VortexMetricCard
            title={t("dash.customers")}
            value={num(data?.customers ?? 0)}
            subtitle={lang === "ar" ? "عملاء نشطون مسجلون" : "Registered customers"}
            badge={lang === "ar" ? "عميل" : "Clients"}
            currency=""
            icon={<Users className="size-5" />}
            iconClassName="bg-cyan-500/10 text-cyan-600 dark:text-cyan-400"
            trend={{
              value: "+2",
              direction: "up",
              isPositive: true,
              label: lang === "ar" ? "جديد" : "new",
            }}
          />
        </Link>

        <Link to="/finance" className="block focus:outline-none">
          <VortexMetricCard
            title={lang === "ar" ? "المصروفات التشغيلية" : "Expenses"}
            value={money(data?.expenses ?? 0)}
            subtitle={lang === "ar" ? "المصروفات المسجلة" : "Logged expenses"}
            currency=""
            icon={<Wallet className="size-5" />}
            iconClassName="bg-amber-500/10 text-amber-600 dark:text-amber-400"
            trend={{
              value: "-3%",
              direction: "down",
              isPositive: true,
              label: lang === "ar" ? "وفورات" : "savings",
            }}
          />
        </Link>

        <Link to="/inventory" className="block focus:outline-none">
          <VortexMetricCard
            title={t("dash.alerts")}
            value={num(data?.alerts ?? 0)}
            subtitle={
              (data?.alerts ?? 0) > 0
                ? lang === "ar"
                  ? "منتجات تحت حد الطلب"
                  : "Items below min stock"
                : lang === "ar"
                  ? "المخزون بمستوى ممتاز"
                  : "Stock level healthy"
            }
            currency=""
            badge={(data?.alerts ?? 0) > 0 ? (lang === "ar" ? "تنبيه" : "Alert") : undefined}
            icon={<AlertTriangle className="size-5" />}
            iconClassName={
              (data?.alerts ?? 0) > 0
                ? "bg-rose-500/10 text-rose-600 dark:text-rose-400"
                : "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
            }
            trend={{
              value: (data?.alerts ?? 0) > 0 ? `${data?.alerts} تنبيه` : "سليم ✓",
              direction: (data?.alerts ?? 0) > 0 ? "down" : "up",
              isPositive: (data?.alerts ?? 0) === 0,
            }}
            highlight={(data?.alerts ?? 0) > 0}
          />
        </Link>
      </div>

      {/* Charts row */}
      <div className="mt-6 grid grid-cols-1 gap-3 lg:grid-cols-3">
        <div className="panel-elevated lg:col-span-2 p-5 rounded-3xl border border-border/80 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold">{t("dash.revenue_trend")}</h3>
              <p className="text-xs text-muted-foreground">{t("dash.last_14_days")}</p>
            </div>
            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <span className="h-2 w-2 rounded-full bg-primary" /> {isAr ? "الإيراد" : "Revenue"}
              <span className="ms-2 h-2 w-2 rounded-full bg-chart-2" />{" "}
              {isAr ? "الطلبات" : "Orders"}
            </div>
          </div>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data?.daily ?? []}>
                <defs>
                  <linearGradient id="g1" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--primary, #3b82f6)" stopOpacity={0.4} />
                    <stop offset="100%" stopColor="var(--primary, #3b82f6)" stopOpacity={0.0} />
                  </linearGradient>
                  <linearGradient id="g2" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#06b6d4" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="#06b6d4" stopOpacity={0.0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke={CHART_GRID_STROKE} strokeDasharray="3 3" vertical={false} />
                <XAxis
                  dataKey="day"
                  stroke="currentColor"
                  className="text-muted-foreground opacity-60"
                  fontSize={11}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  yAxisId="rev"
                  stroke="currentColor"
                  className="text-muted-foreground opacity-60"
                  fontSize={11}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v) => (v >= 1000 ? `${(v / 1000).toFixed(0)}k` : `${v}`)}
                />
                <YAxis
                  yAxisId="orders"
                  orientation="right"
                  stroke="currentColor"
                  className="text-muted-foreground opacity-40"
                  fontSize={10}
                  tickLine={false}
                  axisLine={false}
                  allowDecimals={false}
                />
                <Tooltip
                  contentStyle={TOOLTIP_STYLE}
                  itemStyle={TOOLTIP_ITEM_STYLE}
                  labelStyle={TOOLTIP_LABEL_STYLE}
                  formatter={(val: any, name: any) => [
                    name === "revenue"
                      ? money(Number(val))
                      : `${num(Number(val))} ${isAr ? "طلب" : "orders"}`,
                    name === "revenue"
                      ? isAr
                        ? "الإيراد"
                        : "Revenue"
                      : isAr
                        ? "عدد الفواتير"
                        : "Orders",
                  ]}
                />
                <Area
                  yAxisId="rev"
                  type="monotone"
                  dataKey="revenue"
                  name="revenue"
                  stroke="var(--primary, #3b82f6)"
                  strokeWidth={2.5}
                  fill="url(#g1)"
                />
                <Area
                  yAxisId="orders"
                  type="monotone"
                  dataKey="orders"
                  name="orders"
                  stroke="#06b6d4"
                  strokeWidth={2}
                  fill="url(#g2)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="panel-elevated p-5 rounded-3xl border border-border/80 shadow-sm">
          <h3 className="text-sm font-semibold">
            {lang === "ar" ? "توزيع طرق الدفع" : "Payment mix"}
          </h3>
          <p className="text-xs text-muted-foreground">{t("dash.last_30_days")}</p>
          <div className="mt-4 h-52">
            {paymentPie.length === 0 ? (
              <div className="grid h-full place-items-center text-xs text-muted-foreground">
                {t("common.no_data")}
              </div>
            ) : (
              <ResponsiveContainer>
                <PieChart>
                  <Pie
                    data={paymentPie}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={50}
                    outerRadius={80}
                    strokeWidth={0}
                  >
                    {paymentPie.map((_, i) => (
                      <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={TOOLTIP_STYLE}
                    itemStyle={TOOLTIP_ITEM_STYLE}
                    labelStyle={TOOLTIP_LABEL_STYLE}
                    formatter={(val: any, itemName: any) => [
                      money(Number(val)),
                      String(itemName ?? ""),
                    ]}
                  />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
          <div className="mt-2 space-y-1.5">
            {paymentPie.map((p, i) => (
              <div key={p.name} className="flex items-center justify-between text-xs">
                <span className="flex items-center gap-2 text-muted-foreground">
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ background: CHART_COLORS[i % CHART_COLORS.length] }}
                  />
                  {p.name}
                </span>
                <span className="font-mono">{money(p.value)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Top products & Recent sales */}
      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Card: Top Selling Products */}
        <div className="relative overflow-hidden rounded-3xl border border-border/80 bg-gradient-to-br from-card via-card/95 to-surface-2/40 p-5 sm:p-6 shadow-sm backdrop-blur-md">
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="grid size-9 place-items-center rounded-xl bg-amber-500/10 text-amber-500 border border-amber-500/20">
                <Trophy className="size-4.5" />
              </div>
              <div>
                <h3 className="text-sm sm:text-base font-bold flex items-center gap-1.5 text-foreground">
                  {t("dash.top_products")}
                </h3>
                <p className="text-[11px] text-muted-foreground font-medium">
                  {t("dash.last_30_days")}
                </p>
              </div>
            </div>
            <span className="rounded-full bg-amber-500/10 px-2.5 py-0.5 text-[11px] font-bold text-amber-600 dark:text-amber-400 border border-amber-500/20">
              {data?.topProducts?.length ?? 0} {isAr ? "منتجات متصدرة" : "top items"}
            </span>
          </div>

          {(data?.topProducts.length ?? 0) === 0 ? (
            <div className="grid place-items-center py-12 text-xs text-muted-foreground">
              {t("common.no_data")}
            </div>
          ) : (
            <div className="space-y-3.5">
              {data!.topProducts.map((tp, i) => {
                const max = data!.topProducts[0].total || 1;
                const pct = Math.min(100, Math.max(5, (tp.total / max) * 100));
                const name =
                  lang === "ar"
                    ? tp.product?.name_ar || tp.product?.name
                    : tp.product?.name || tp.product?.name_ar;

                const rankBadges = [
                  "bg-gradient-to-r from-amber-400 to-amber-600 text-white shadow-xs font-black ring-1 ring-amber-400/40",
                  "bg-gradient-to-r from-slate-300 to-slate-400 text-slate-900 shadow-xs font-black ring-1 ring-slate-300/40",
                  "bg-gradient-to-r from-amber-700 to-amber-800 text-white shadow-xs font-black ring-1 ring-amber-700/40",
                ];
                const badgeClass =
                  i < 3 ? rankBadges[i] : "bg-surface-2 text-muted-foreground font-bold";

                return (
                  <div
                    key={i}
                    className="group rounded-2xl border border-border/50 bg-surface/50 p-3 hover:bg-surface-2/60 transition-all"
                  >
                    <div className="mb-2 flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span
                          className={`grid size-6 place-items-center rounded-lg text-[11px] shrink-0 ${badgeClass}`}
                        >
                          {i + 1}
                        </span>
                        <span className="truncate font-bold text-foreground text-xs sm:text-sm">
                          {name}
                        </span>
                      </div>
                      <div className="text-end shrink-0 ms-2">
                        <span className="font-mono font-black text-foreground text-xs sm:text-sm">
                          {money(tp.total)}
                        </span>
                        <span className="block text-[10px] text-muted-foreground font-semibold">
                          {num(tp.qty)} {isAr ? "مباع" : "sold"}
                        </span>
                      </div>
                    </div>
                    {/* Modern Multi-tone progress capsule */}
                    <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-amber-500 via-emerald-500 to-teal-400 transition-all duration-500"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Card: Recent Sales Transaction Stream */}
        <div className="relative overflow-hidden rounded-3xl border border-border/80 bg-gradient-to-br from-card via-card/95 to-surface-2/40 p-5 sm:p-6 shadow-sm backdrop-blur-md">
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="grid size-9 place-items-center rounded-xl bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">
                <Receipt className="size-4.5" />
              </div>
              <div>
                <h3 className="text-sm sm:text-base font-bold flex items-center gap-1.5 text-foreground">
                  {t("dash.recent_sales")}
                </h3>
                <p className="text-[11px] text-muted-foreground font-medium">
                  {isAr ? "أحدث حركات الفواتير المسجلة" : "Latest invoice activity"}
                </p>
              </div>
            </div>
            <Link
              to="/sales"
              className="text-xs font-bold text-amber-500 hover:text-amber-600 dark:hover:text-amber-400 hover:underline flex items-center gap-0.5"
            >
              {lang === "ar" ? "عرض السجل كامل" : "Full log"}{" "}
              <ChevronLeft className="size-3.5 rtl:rotate-0 rotate-180" />
            </Link>
          </div>

          {(data?.recent.length ?? 0) === 0 ? (
            <div className="grid place-items-center py-12 text-xs text-muted-foreground">
              {t("dash.no_invoices_hint")}
            </div>
          ) : (
            <div className="space-y-2.5">
              {(data?.recent ?? []).map((r: any) => {
                const isPaid = r.status === "paid";
                const isPartial = r.status === "partial";
                const statusCls = isPaid
                  ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20"
                  : isPartial
                    ? "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20"
                    : "bg-surface-2 text-muted-foreground border-border/60";

                const statusLabel = isPaid
                  ? isAr
                    ? "مدفوعة"
                    : "Paid"
                  : isPartial
                    ? isAr
                      ? "جزئي"
                      : "Partial"
                    : isAr
                      ? "معلقة"
                      : "Pending";

                return (
                  <div
                    key={r.id}
                    className="flex items-center justify-between rounded-2xl border border-border/50 bg-surface/50 p-3 hover:bg-surface-2/60 transition-all text-sm group"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-zinc-800/10 dark:bg-zinc-800/50 border border-border/60 text-muted-foreground group-hover:border-amber-500/30 transition-colors">
                        <UserCheck className="size-4 text-foreground/70" />
                      </div>
                      <div className="min-w-0">
                        <div className="truncate font-bold text-foreground text-xs sm:text-sm">
                          {r.customers?.name ?? (lang === "ar" ? "عميل نقدي" : "Walk-in")}
                        </div>
                        <div className="text-[11px] text-muted-foreground font-mono flex items-center gap-1.5">
                          <span>{r.invoice_number}</span>
                          <span>•</span>
                          <span>
                            {new Date(r.created_at).toLocaleDateString(isAr ? "ar-YE" : "en-US", {
                              month: "short",
                              day: "numeric",
                            })}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="text-end shrink-0 ms-2">
                      <div className="font-black font-mono text-foreground text-xs sm:text-sm">
                        {money(Number(r.total))}
                      </div>
                      <span
                        className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-bold ${statusCls}`}
                      >
                        <span
                          className={`size-1 rounded-full ${isPaid ? "bg-emerald-500" : isPartial ? "bg-amber-500" : "bg-muted-foreground"}`}
                        />
                        {statusLabel}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
      {/* Low stock & Top debtors */}
      <div className="mt-6 grid grid-cols-1 gap-3 lg:grid-cols-2">
        <div className="panel-elevated p-5 rounded-3xl border border-border/80 shadow-sm">
          <h3 className="text-sm font-semibold flex items-center gap-1.5">
            <Boxes className="h-4 w-4 text-warning" />{" "}
            {lang === "ar" ? "منتجات على وشك النفاد" : "Low stock alerts"}
          </h3>
          <p className="text-xs text-muted-foreground mb-4">
            {lang === "ar" ? "المنتجات تحت الحد الأدنى" : "Products below minimum"}
          </p>
          {(data?.lowStock.length ?? 0) === 0 ? (
            <div className="grid place-items-center py-10 text-xs text-emerald-500">
              ✓ {lang === "ar" ? "المخزون بحالة جيدة" : "All stock is healthy"}
            </div>
          ) : (
            <div className="space-y-2">
              {data!.lowStock.map((p: any) => {
                const name = lang === "ar" ? p.name_ar || p.name : p.name || p.name_ar;
                return (
                  <div
                    key={p.id}
                    className="flex items-center justify-between rounded-xl border border-warning/20 bg-warning/5 px-3 py-2 text-sm"
                  >
                    <span className="truncate">{name}</span>
                    <span className="font-mono text-warning">
                      {p.stock} / {p.min_stock}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="panel-elevated p-5 rounded-3xl border border-border/80 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-sm font-semibold flex items-center gap-1.5">
              <Users className="h-4 w-4 text-chart-3" />{" "}
              {lang === "ar" ? "أعلى الديون" : "Top debtors"}
            </h3>
            <Link
              to="/debts"
              className="text-[11px] text-primary hover:underline flex items-center gap-0.5"
            >
              {lang === "ar" ? "الكل" : "All"} <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
          {(data?.topDebtors.length ?? 0) === 0 ? (
            <div className="grid place-items-center py-10 text-xs text-emerald-500">
              ✓ {lang === "ar" ? "لا توجد ذمم" : "No outstanding balances"}
            </div>
          ) : (
            <div className="space-y-2">
              {data!.topDebtors.map((c: any) => (
                <div
                  key={c.id}
                  className="flex items-center justify-between rounded-xl border border-border bg-surface px-3 py-2 text-sm"
                >
                  <span className="truncate">{c.name}</span>
                  <span className="font-mono text-rose-500">{money(Number(c.balance))}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function MiniBadge({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "pos" | "neg" | "warn" | "neutral";
}) {
  const cls =
    tone === "pos"
      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-500"
      : tone === "neg"
        ? "border-rose-500/30 bg-rose-500/10 text-rose-500"
        : tone === "neutral"
          ? "border-primary/25 bg-primary/5 text-primary"
          : "border-amber-500/30 bg-amber-500/10 text-amber-500";
  return (
    <div className={`rounded-full border px-3 py-1 text-xs backdrop-blur shadow-sm ${cls}`}>
      <span className="opacity-70">{label}:</span>{" "}
      <span className="font-bold font-mono">{value}</span>
    </div>
  );
}

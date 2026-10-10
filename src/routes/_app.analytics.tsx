import { ModuleGuard } from "@/lib/modules";
import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/page-header";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import { money, num } from "@/lib/format";
import { paymentMethodLabel as paymentMethodLabelFromCatalog } from "@/lib/payments/payment-methods";
import { VortexMetricCard } from "@/components/vortex-ui/finance/vortex-metric-card";
import {
  Sparkles,
  TrendingUp,
  TrendingDown,
  Users,
  Package,
  Wallet,
  ShoppingCart,
  Calendar,
  Activity,
  AlertTriangle,
  Award,
  Layers,
  PieChart as PieChartIcon,
} from "lucide-react";
import {
  AreaChart,
  Area,
  LineChart,
  Line,
  BarChart,
  Bar,
  RadarChart,
  Radar,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
  ComposedChart,
} from "recharts";

export const Route = createFileRoute("/_app/analytics")({
  head: () => ({ meta: [{ title: "Analytics — Vortex ERP" }] }),
  component: () => (
    <ModuleGuard moduleId="analytics">
      <AnalyticsPage />
    </ModuleGuard>
  ),
});

const PALETTE = [
  "oklch(0.62 0.21 260)", // Indigo
  "oklch(0.7 0.18 180)", // Teal
  "oklch(0.72 0.18 60)", // Amber
  "oklch(0.68 0.2 340)", // Rose
  "oklch(0.75 0.15 140)", // Emerald
  "oklch(0.65 0.2 20)", // Orange
];

// Theme-aware tooltip styling with high contrast in both dark and light modes.
const TOOLTIP_STYLE = {
  background: "var(--card)",
  color: "var(--foreground)",
  border: "1px solid var(--border)",
  borderRadius: 14,
  fontSize: 12,
  padding: "10px 14px",
  boxShadow: "0 10px 25px -5px rgba(0, 0, 0, 0.25), 0 8px 10px -6px rgba(0, 0, 0, 0.2)",
} as const;

const TOOLTIP_ITEM_STYLE = {
  color: "var(--foreground)",
  fontWeight: 600,
  paddingTop: 2,
  paddingBottom: 2,
} as const;

const TOOLTIP_LABEL_STYLE = {
  color: "var(--muted-foreground)",
  fontWeight: 600,
  marginBottom: 6,
  borderBottom: "1px solid var(--border)",
  paddingBottom: 4,
} as const;

const CHART_GRID_STROKE = "var(--border)";
const CHART_AXIS_STROKE = "var(--muted-foreground)";
const CHART_POLAR_GRID_STROKE = "var(--border)";

function AnalyticsPage() {
  const { t, lang } = useI18n();
  const isAr = lang === "ar";
  const [days, setDays] = useState(30);

  const chartLabels = useMemo(
    () => ({
      revenue: isAr ? "الإيرادات" : "Revenue",
      expenses: isAr ? "المصروفات" : "Expenses",
      profit: isAr ? "الأرباح" : "Profit",
      orders: isAr ? "عدد الطلبات" : "Orders",
      customers: isAr ? "عدد العملاء" : "Customers",
      quantity: isAr ? "الكمية" : "Quantity",
      day: isAr ? "اليوم" : "Day",
    }),
    [isAr],
  );

  const { data, isLoading, isError } = useQuery({
    queryKey: ["analytics", days],
    staleTime: 60_000,
    queryFn: async () => {
      const since = new Date(Date.now() - days * 86400_000).toISOString();
      const [sales, items, products, inv, expenses, purchases] = await Promise.all([
        supabase
          .from("sales_invoices")
          .select("id,total,paid,payment_method,status,created_at,customer_id")
          .gte("created_at", since)
          .order("created_at", { ascending: false })
          .limit(1500),
        supabase
          .from("sales_invoice_items")
          .select(
            "product_id,quantity,total,invoice_id,sales_invoices!inner(created_at,customer_id)",
          )
          .gte("sales_invoices.created_at", since)
          .limit(3000),
        supabase
          .from("products")
          .select(
            "id,name,name_ar,cost,sale_price,min_stock,category_id,brand_id,categories(name,name_ar),brands(name,name_ar)",
          )
          .limit(2000),
        supabase
          .from("inventory")
          .select("product_id,quantity,warehouse_id,warehouses(name,name_ar)")
          .limit(2000),
        (supabase as any)
          .from("expense_entries")
          .select(
            "id,total_amount,expense_date,created_at,expense_lines(gross_amount,category_id,expense_categories(name,name_ar))",
          )
          .in("status", ["POSTED", "PARTIALLY_PAID", "PAID", "CLOSED"])
          .gte("expense_date", since.slice(0, 10))
          .limit(2000),
        supabase
          .from("purchase_invoices")
          .select("total,created_at")
          .gte("created_at", since)
          .limit(1000),
      ]);
      return {
        sales: sales.data ?? [],
        items: items.data ?? [],
        products: products.data ?? [],
        inv: inv.data ?? [],
        expenses: (expenses.data ?? []) as any[],
        purchases: purchases.data ?? [],
      };
    },
  });

  const insights = useMemo(() => {
    if (!data) return null;
    const sales = data.sales as any[];
    const items = data.items as any[];
    const prodMap = new Map((data.products as any[]).map((p) => [p.id, p]));

    // Daily buckets
    const daily: Record<
      string,
      { revenue: number; profit: number; orders: number; expenses: number; purchases: number }
    > = {};
    for (let i = days - 1; i >= 0; i--) {
      const key = localDayKey(new Date(Date.now() - i * 86400_000));
      daily[key] = { revenue: 0, profit: 0, orders: 0, expenses: 0, purchases: 0 };
    }
    sales.forEach((s) => {
      const key = localDayKey(s.created_at);
      if (!daily[key]) return;
      daily[key].revenue += Number(s.total);
      daily[key].orders += 1;
    });
    items.forEach((it: any) => {
      const key = it.sales_invoices?.created_at ? localDayKey(it.sales_invoices.created_at) : null;
      if (!key || !daily[key]) return;
      const p = prodMap.get(it.product_id) as any;
      const cost = p ? Number(p.cost ?? 0) : 0;
      daily[key].profit += Number(it.total) - cost * Number(it.quantity);
    });
    data.expenses.forEach((e: any) => {
      const key = localDayKey(e.expense_date || e.created_at);
      if (!daily[key]) return;
      daily[key].expenses += Number(e.total_amount || 0);
    });
    data.purchases.forEach((p: any) => {
      const key = localDayKey(p.created_at);
      if (!daily[key]) return;
      daily[key].purchases += Number(p.total);
    });
    const dailyArr = Object.entries(daily).map(([date, v]) => ({ date: date.slice(5), ...v }));

    // Category revenue
    const catAgg = new Map<string, { name: string; revenue: number }>();
    items.forEach((it: any) => {
      const p = prodMap.get(it.product_id) as any;
      const cat = p?.categories;
      const key = cat?.name ?? "—";
      const label = isAr ? cat?.name_ar || cat?.name || "—" : cat?.name || "—";
      const cur = catAgg.get(key) ?? { name: label, revenue: 0 };
      cur.revenue += Number(it.total);
      catAgg.set(key, cur);
    });
    const byCategory = Array.from(catAgg.values()).sort((a, b) => b.revenue - a.revenue);

    // Brand share
    const brandAgg = new Map<string, { name: string; qty: number; revenue: number }>();
    items.forEach((it: any) => {
      const p = prodMap.get(it.product_id) as any;
      const b = p?.brands;
      const key = b?.name ?? "—";
      const label = isAr ? b?.name_ar || b?.name || "—" : b?.name || "—";
      const cur = brandAgg.get(key) ?? { name: label, qty: 0, revenue: 0 };
      cur.qty += Number(it.quantity);
      cur.revenue += Number(it.total);
      brandAgg.set(key, cur);
    });
    const byBrand = Array.from(brandAgg.values())
      .sort((a, b) => b.qty - a.qty)
      .slice(0, 6);

    // Hour of day heat
    const hourAgg = new Array(24).fill(0);
    sales.forEach((s) => {
      const h = new Date(s.created_at).getHours();
      hourAgg[h] += Number(s.total);
    });
    const hourly = hourAgg.map((v, h) => ({ hour: `${h}:00`, revenue: v }));

    // Weekday pattern
    const dowAgg = new Array(7).fill(0);
    const dowCount = new Array(7).fill(0);
    sales.forEach((s) => {
      const d = new Date(s.created_at).getDay();
      dowAgg[d] += Number(s.total);
      dowCount[d] += 1;
    });
    const dowLabels = isAr
      ? ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"]
      : ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const weekday = dowAgg.map((v, i) => ({ day: dowLabels[i], revenue: v, orders: dowCount[i] }));

    // Payment mix
    const paySplit: Record<string, number> = {};
    sales.forEach((s) => {
      const label = paymentMethodLabel(s.payment_method, isAr);
      paySplit[label] = (paySplit[label] ?? 0) + Number(s.paid);
    });
    const payment = Object.entries(paySplit).map(([name, value]) => ({ name, value }));

    // Top products
    const prodAgg = new Map<string, { qty: number; total: number }>();
    items.forEach((it: any) => {
      const cur = prodAgg.get(it.product_id) ?? { qty: 0, total: 0 };
      cur.qty += Number(it.quantity);
      cur.total += Number(it.total);
      prodAgg.set(it.product_id, cur);
    });
    const topProducts = Array.from(prodAgg.entries())
      .map(([id, v]) => ({ ...v, product: prodMap.get(id) as any }))
      .filter((x) => x.product)
      .sort((a, b) => b.total - a.total)
      .slice(0, 10);

    // Inventory value at cost
    let invValue = 0;
    (data.inv as any[]).forEach((r) => {
      const p = prodMap.get(r.product_id) as any;
      if (p) invValue += Number(p.cost ?? 0) * Number(r.quantity);
    });

    // Warehouse distribution
    const whAgg = new Map<string, { name: string; qty: number }>();
    (data.inv as any[]).forEach((r) => {
      const w = r.warehouses;
      const label = isAr ? w?.name_ar || w?.name || "—" : w?.name || "—";
      const cur = whAgg.get(label) ?? { name: label, qty: 0 };
      cur.qty += Number(r.quantity);
      whAgg.set(label, cur);
    });
    const warehouses = Array.from(whAgg.values());

    // Customer segmentation (RFM-lite)
    const custAgg = new Map<string, { count: number; spend: number }>();
    sales.forEach((s) => {
      if (!s.customer_id) return;
      const cur = custAgg.get(s.customer_id) ?? { count: 0, spend: 0 };
      cur.count += 1;
      cur.spend += Number(s.total);
      custAgg.set(s.customer_id, cur);
    });
    const segments = { vip: 0, regular: 0, occasional: 0, walkin: 0 };
    let walkin = 0;
    sales.forEach((s) => {
      if (!s.customer_id) walkin += 1;
    });
    segments.walkin = walkin;
    custAgg.forEach((v) => {
      if (v.spend > 1000 || v.count >= 5) segments.vip += 1;
      else if (v.count >= 2) segments.regular += 1;
      else segments.occasional += 1;
    });
    const segData = [
      { name: "VIP", value: segments.vip, label: isAr ? "عملاء مميزون (VIP)" : "VIP" },
      {
        name: isAr ? "منتظمون" : "Regular",
        value: segments.regular,
        label: isAr ? "منتظمون" : "Regular",
      },
      {
        name: isAr ? "متقطعون" : "Occasional",
        value: segments.occasional,
        label: isAr ? "متقطعون" : "Occasional",
      },
      {
        name: isAr ? "عابرون" : "Walk-in",
        value: segments.walkin,
        label: isAr ? "نقدي / عابر" : "Walk-in",
      },
    ].filter((s) => s.value > 0);

    // Totals
    const totalRev = sales.reduce((a, s) => a + Number(s.total), 0);
    const totalProfit = dailyArr.reduce((a, d) => a + d.profit, 0);
    const totalExp = data.expenses.reduce(
      (a: number, e: any) => a + Number(e.total_amount || 0),
      0,
    );
    const avgOrder = sales.length ? totalRev / sales.length : 0;
    const uniqueCustomers = new Set(sales.map((s) => s.customer_id).filter(Boolean)).size;

    // Expense categories
    const expAgg = new Map<string, number>();
    data.expenses.forEach((e: any) => {
      const lines = e.expense_lines ?? [];
      if (lines.length > 0) {
        lines.forEach((l: any) => {
          const cat = l.expense_categories;
          const label = isAr ? cat?.name_ar || cat?.name || "—" : cat?.name || "—";
          expAgg.set(label, (expAgg.get(label) ?? 0) + Number(l.gross_amount || 0));
        });
      } else {
        const label = isAr ? "مصروفات عامة" : "General";
        expAgg.set(label, (expAgg.get(label) ?? 0) + Number(e.total_amount || 0));
      }
    });
    const expByCat = Array.from(expAgg.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);

    return {
      dailyArr,
      byCategory,
      byBrand,
      hourly,
      weekday,
      payment,
      topProducts,
      invValue,
      warehouses,
      segData,
      totalRev,
      totalProfit,
      totalExp,
      avgOrder,
      uniqueCustomers,
      expByCat,
      totalOrders: sales.length,
    };
    // `lang` is read through `isAr` above, which is derived from it — the memo
    // only depends on the derived flag, not on the raw value as well.
  }, [data, days, isAr]);

  const dayRanges = [7, 14, 30, 90];

  return (
    <>
      <PageHeader
        title={isAr ? "التحليلات المتقدمة" : "Advanced Analytics"}
        subtitle={
          isAr
            ? "رؤى بيانية ذكية وعميقة حول الأداء، العملاء، وهوامش الربح والمخزون"
            : "Deep insights into performance, customers, margins, and inventory"
        }
        actions={
          <div className="flex items-center gap-1 rounded-full border border-border/80 bg-surface p-1 shadow-sm">
            {dayRanges.map((d) => (
              <button
                key={d}
                onClick={() => setDays(d)}
                aria-pressed={days === d}
                className={`h-7 rounded-full px-3 text-[11px] font-bold transition-all ${
                  days === d
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {d}
                {isAr ? " يوم" : "d"}
              </button>
            ))}
          </div>
        }
      />

      {isError && (
        <div
          role="alert"
          className="mb-4 flex items-center gap-2 rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-xs text-destructive"
        >
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>
            {isAr
              ? "تعذّر تحميل بيانات التحليلات. حدّث الصفحة للمحاولة مجددًا."
              : "Could not load analytics data. Refresh the page to try again."}
          </span>
        </div>
      )}

      {/* Luxury Vortex KPI Cards */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 mb-6">
        <VortexMetricCard
          title={isAr ? "إجمالي المبيعات" : "Total Revenue"}
          value={money(insights?.totalRev ?? 0)}
          subtitle={
            isAr
              ? `${num(insights?.totalOrders ?? 0)} طلب مسجّل`
              : `${num(insights?.totalOrders ?? 0)} orders`
          }
          currency=""
          icon={<TrendingUp className="size-5" />}
          iconClassName="bg-primary/10 text-primary"
          trend={{
            value: `${num(insights?.totalOrders ?? 0)}`,
            direction: "up",
            isPositive: true,
            label: isAr ? "معاملة" : "tx",
          }}
        />

        <VortexMetricCard
          title={isAr ? "صافي الربح التقديري" : "Gross Profit"}
          value={money(insights?.totalProfit ?? 0)}
          subtitle={
            insights && insights.totalRev > 0
              ? `${((insights.totalProfit / insights.totalRev) * 100).toFixed(1)}% ${isAr ? "هامش ربح إجمالي" : "margin"}`
              : "—"
          }
          currency=""
          icon={<Sparkles className="size-5" />}
          iconClassName="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
          trend={{
            value:
              insights && insights.totalRev > 0
                ? `${((insights.totalProfit / insights.totalRev) * 100).toFixed(1)}%`
                : "0%",
            direction: "up",
            isPositive: (insights?.totalProfit ?? 0) >= 0,
            label: isAr ? "هامش" : "margin",
          }}
          highlight
        />

        <VortexMetricCard
          title={isAr ? "متوسط قيمة الفاتورة" : "Avg. Order"}
          value={money(insights?.avgOrder ?? 0)}
          subtitle={isAr ? "معدل الصرف لكل معاملة" : "per transaction"}
          currency=""
          icon={<ShoppingCart className="size-5" />}
          iconClassName="bg-chart-2/10 text-chart-2"
          trend={{
            value: money(insights?.avgOrder ?? 0),
            direction: "neutral",
            label: isAr ? "معدل" : "avg",
          }}
        />

        <VortexMetricCard
          title={isAr ? "العملاء النشطون والمخزون" : "Active Customers"}
          value={num(insights?.uniqueCustomers ?? 0)}
          subtitle={
            isAr
              ? `تكلفة المخزون: ${money(insights?.invValue ?? 0)}`
              : `Inventory cost: ${money(insights?.invValue ?? 0)}`
          }
          currency=""
          badge={isAr ? "عميل" : "Clients"}
          icon={<Users className="size-5" />}
          iconClassName="bg-chart-4/10 text-chart-4"
          trend={{
            value: money(insights?.invValue ?? 0),
            direction: "neutral",
            label: isAr ? "مخزون" : "stock",
          }}
        />
      </div>

      {/* Main Revenue vs Expenses & Profit Composed Chart */}
      <div className="panel-elevated p-5 sm:p-6 mb-6 rounded-3xl border border-border/80 shadow-sm">
        <div className="mb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h3 className="text-sm sm:text-base font-bold flex items-center gap-2">
              <Activity className="size-4 text-primary" />{" "}
              {isAr ? "مخطط تدفق الإيرادات والأرباح والمصروفات" : "Revenue, Profit & Expenses"}
            </h3>
            <p className="text-xs text-muted-foreground">
              {isAr ? `توزيع الحركات المالية اليومية لآخر ${days} يوماً` : `Last ${days} days`}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-full bg-primary" />
              <span>{chartLabels.revenue}</span>
            </span>
            <span className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-full bg-emerald-500" />
              <span>{chartLabels.profit}</span>
            </span>
            <span className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-full bg-rose-500" />
              <span>{chartLabels.expenses}</span>
            </span>
          </div>
        </div>

        <div className="h-72 sm:h-80 w-full">
          {isLoading && !insights ? (
            chartSkeleton()
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={insights?.dailyArr ?? []}>
                <defs>
                  <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--primary, #3b82f6)" stopOpacity={0.4} />
                    <stop offset="100%" stopColor="var(--primary, #3b82f6)" stopOpacity={0.0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke={CHART_GRID_STROKE} strokeDasharray="3 3" vertical={false} />
                <XAxis
                  dataKey="date"
                  stroke={CHART_AXIS_STROKE}
                  fontSize={11}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  stroke={CHART_AXIS_STROKE}
                  fontSize={11}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v) => (v >= 1000 ? `${(v / 1000).toFixed(0)}k` : `${v}`)}
                />
                <Tooltip
                  contentStyle={TOOLTIP_STYLE}
                  itemStyle={TOOLTIP_ITEM_STYLE}
                  labelStyle={TOOLTIP_LABEL_STYLE}
                  formatter={(val: any, name: any) => [money(Number(val)), name]}
                />
                <Area
                  type="monotone"
                  dataKey="revenue"
                  stroke="var(--primary, #3b82f6)"
                  strokeWidth={2.5}
                  fill="url(#revGrad)"
                  name={chartLabels.revenue}
                />
                <Bar
                  dataKey="expenses"
                  fill="oklch(0.65 0.2 20)"
                  radius={[4, 4, 0, 0]}
                  opacity={0.8}
                  name={chartLabels.expenses}
                />
                <Line
                  type="monotone"
                  dataKey="profit"
                  stroke="oklch(0.72 0.18 140)"
                  strokeWidth={2.5}
                  dot={false}
                  name={chartLabels.profit}
                />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Second Row: Category breakdown, Customer Segments, Top Brands */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3 mb-6">
        {/* Categories BarChart */}
        <div className="panel-elevated p-5 rounded-3xl border border-border/80 shadow-sm flex flex-col justify-between">
          <div>
            <h3 className="text-sm font-bold mb-1 flex items-center gap-1.5">
              <Layers className="size-4 text-primary" />
              {isAr ? "الإيراد حسب التصنيف" : "Revenue by Category"}
            </h3>
            <p className="text-xs text-muted-foreground mb-3">
              {isAr ? "أعلى التصنيفات إيراداً" : "Top performing categories"}
            </p>
          </div>
          <div className="h-60 w-full">
            {(insights?.byCategory.length ?? 0) === 0 ? (
              emptyState(lang)
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={insights!.byCategory.slice(0, 5)}
                  margin={{ top: 10, right: 10, left: 10, bottom: 20 }}
                >
                  <CartesianGrid stroke={CHART_GRID_STROKE} vertical={false} />
                  <XAxis
                    dataKey="name"
                    stroke={CHART_AXIS_STROKE}
                    fontSize={10}
                    tickLine={false}
                    axisLine={false}
                    interval={0}
                  />
                  <YAxis
                    stroke={CHART_AXIS_STROKE}
                    fontSize={10}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(v) => (v >= 1000 ? `${(v / 1000).toFixed(0)}k` : `${v}`)}
                  />
                  <Tooltip
                    contentStyle={TOOLTIP_STYLE}
                    itemStyle={TOOLTIP_ITEM_STYLE}
                    labelStyle={TOOLTIP_LABEL_STYLE}
                    formatter={(val: any) => [money(Number(val)), chartLabels.revenue]}
                  />
                  <Bar dataKey="revenue" radius={[6, 6, 0, 0]}>
                    {insights!.byCategory.slice(0, 5).map((_, i) => (
                      <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Customer Segments (Luxury Donut PieChart) */}
        <div className="panel-elevated p-5 rounded-3xl border border-border/80 shadow-sm flex flex-col justify-between">
          <div>
            <h3 className="text-sm font-bold mb-1 flex items-center gap-1.5">
              <Users className="size-4 text-chart-2" />
              {isAr ? "شرائح وولاء العملاء" : "Customer Segments"}
            </h3>
            <p className="text-xs text-muted-foreground mb-3">
              {isAr ? "تصنيف سلوك الشراء والتكرار" : "Loyalty & purchasing behavior"}
            </p>
          </div>
          <div className="h-60 w-full flex flex-col justify-center">
            {(insights?.segData.length ?? 0) === 0 ? (
              emptyState(lang)
            ) : (
              <div className="flex flex-col h-full justify-between">
                <div className="h-44 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={insights?.segData ?? []}
                        dataKey="value"
                        nameKey="label"
                        innerRadius={45}
                        outerRadius={70}
                        paddingAngle={3}
                        stroke="none"
                      >
                        {(insights?.segData ?? []).map((_, i) => (
                          <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
                        ))}
                      </Pie>
                      <Tooltip
                        contentStyle={TOOLTIP_STYLE}
                        itemStyle={TOOLTIP_ITEM_STYLE}
                        labelStyle={TOOLTIP_LABEL_STYLE}
                        formatter={(val: any, name: any) => [
                          `${num(Number(val))} ${chartLabels.customers}`,
                          name,
                        ]}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="grid grid-cols-2 gap-1.5 text-[11px] pt-1 border-t border-border/50">
                  {(insights?.segData ?? []).map((seg, i) => (
                    <div key={seg.name} className="flex items-center justify-between px-1">
                      <span className="flex items-center gap-1.5 text-muted-foreground truncate">
                        <span
                          className="size-2 rounded-full shrink-0"
                          style={{ background: PALETTE[i % PALETTE.length] }}
                        />
                        <span className="truncate">{seg.label}</span>
                      </span>
                      <span className="font-mono font-bold">{num(seg.value)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Top Brands (Radar or Sleek Progress Ranking) */}
        <div className="panel-elevated p-5 rounded-3xl border border-border/80 shadow-sm flex flex-col justify-between">
          <div>
            <h3 className="text-sm font-bold mb-1 flex items-center gap-1.5">
              <Award className="size-4 text-amber-500" />
              {isAr ? "أفضل العلامات التجارية" : "Top Brands"}
            </h3>
            <p className="text-xs text-muted-foreground mb-3">
              {isAr ? "الأكثر مبيعاً من حيث الكمية" : "Best-selling by quantity"}
            </p>
          </div>
          <div className="h-60 w-full">
            {(insights?.byBrand.length ?? 0) === 0 ? (
              emptyState(lang)
            ) : (insights?.byBrand.length ?? 0) >= 3 ? (
              <ResponsiveContainer width="100%" height="100%">
                <RadarChart data={insights?.byBrand ?? []}>
                  <PolarGrid stroke={CHART_POLAR_GRID_STROKE} />
                  <PolarAngleAxis
                    dataKey="name"
                    tick={{ fill: "var(--foreground)", fontSize: 10, fontWeight: 500 }}
                  />
                  <PolarRadiusAxis tick={{ fill: "var(--muted-foreground)", fontSize: 9 }} />
                  <Radar
                    dataKey="qty"
                    name={chartLabels.quantity}
                    stroke="oklch(0.68 0.2 340)"
                    fill="oklch(0.68 0.2 340)"
                    fillOpacity={0.45}
                  />
                  <Tooltip
                    contentStyle={TOOLTIP_STYLE}
                    itemStyle={TOOLTIP_ITEM_STYLE}
                    labelStyle={TOOLTIP_LABEL_STYLE}
                    formatter={(val: any, name: any) => [num(Number(val)), name]}
                  />
                </RadarChart>
              </ResponsiveContainer>
            ) : (
              <div className="space-y-3 pt-2">
                {insights!.byBrand.map((b, i) => {
                  const max = insights!.byBrand[0].qty || 1;
                  const pct = Math.round((b.qty / max) * 100);
                  return (
                    <div key={b.name} className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-semibold text-foreground flex items-center gap-1.5">
                          <span className="size-2 rounded-full bg-primary" />
                          <span>{b.name}</span>
                        </span>
                        <span className="font-mono text-muted-foreground">
                          {num(b.qty)} {chartLabels.quantity}
                        </span>
                      </div>
                      <div className="h-2 w-full overflow-hidden rounded-full bg-surface-2">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-primary to-chart-4"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Third row: Patterns (Weekday & Peak Hours) */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 mb-6">
        <div className="panel-elevated p-5 rounded-3xl border border-border/80 shadow-sm">
          <h3 className="text-sm font-bold mb-1 flex items-center gap-1.5">
            <Calendar className="size-4 text-chart-2" />{" "}
            {isAr ? "نمط أيام الأسبوع" : "Weekday Pattern"}
          </h3>
          <p className="text-xs text-muted-foreground mb-3">
            {isAr ? "توزيع إجمالي الإيرادات حسب أيام الأسبوع" : "Revenue distribution by day"}
          </p>
          <div className="h-64 w-full">
            {(insights?.weekday.reduce((a, d) => a + d.revenue, 0) ?? 0) === 0 ? (
              emptyState(lang)
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={insights?.weekday ?? []}>
                  <CartesianGrid stroke={CHART_GRID_STROKE} vertical={false} />
                  <XAxis
                    dataKey="day"
                    stroke={CHART_AXIS_STROKE}
                    fontSize={11}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    stroke={CHART_AXIS_STROKE}
                    fontSize={11}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(v) => (v >= 1000 ? `${(v / 1000).toFixed(0)}k` : `${v}`)}
                  />
                  <Tooltip
                    contentStyle={TOOLTIP_STYLE}
                    itemStyle={TOOLTIP_ITEM_STYLE}
                    labelStyle={TOOLTIP_LABEL_STYLE}
                    formatter={(val: any, name: any) =>
                      name === chartLabels.revenue
                        ? [money(Number(val)), name]
                        : [`${num(Number(val))} ${chartLabels.orders}`, name]
                    }
                  />
                  <Bar dataKey="revenue" name={chartLabels.revenue} radius={[8, 8, 0, 0]}>
                    {(insights?.weekday ?? []).map((_, i) => (
                      <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        <div className="panel-elevated p-5 rounded-3xl border border-border/80 shadow-sm">
          <h3 className="text-sm font-bold mb-1 flex items-center gap-1.5">
            <Activity className="size-4 text-chart-4" />{" "}
            {isAr ? "ساعات الذروة التشغيلية" : "Peak Hours"}
          </h3>
          <p className="text-xs text-muted-foreground mb-3">
            {isAr ? "توزيع الإيراد على مدار 24 ساعة" : "Revenue throughout the day"}
          </p>
          <div className="h-64 w-full">
            {(insights?.hourly.reduce((a, h) => a + h.revenue, 0) ?? 0) === 0 ? (
              emptyState(lang)
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={insights?.hourly ?? []}>
                  <defs>
                    <linearGradient id="peakHourGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="oklch(0.68 0.2 340)" stopOpacity={0.5} />
                      <stop offset="100%" stopColor="oklch(0.68 0.2 340)" stopOpacity={0.0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke={CHART_GRID_STROKE} vertical={false} />
                  <XAxis
                    dataKey="hour"
                    stroke={CHART_AXIS_STROKE}
                    fontSize={10}
                    tickLine={false}
                    axisLine={false}
                    interval={2}
                  />
                  <YAxis
                    stroke={CHART_AXIS_STROKE}
                    fontSize={11}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(v) => (v >= 1000 ? `${(v / 1000).toFixed(0)}k` : `${v}`)}
                  />
                  <Tooltip
                    contentStyle={TOOLTIP_STYLE}
                    itemStyle={TOOLTIP_ITEM_STYLE}
                    labelStyle={TOOLTIP_LABEL_STYLE}
                    formatter={(val: any) => [money(Number(val)), chartLabels.revenue]}
                  />
                  <Area
                    type="monotone"
                    dataKey="revenue"
                    name={chartLabels.revenue}
                    stroke="oklch(0.68 0.2 340)"
                    strokeWidth={2.5}
                    fill="url(#peakHourGrad)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>

      {/* Fourth row: top products & warehouses */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3 mb-6">
        <div className="panel-elevated p-5 sm:p-6 lg:col-span-2 rounded-3xl border border-border/80 shadow-sm">
          <h3 className="text-sm sm:text-base font-bold mb-1 flex items-center gap-1.5">
            <Package className="size-4 text-primary" />{" "}
            {isAr ? "أفضل 10 منتجات مبيعاً" : "Top 10 Products"}
          </h3>
          <p className="text-xs text-muted-foreground mb-4">
            {isAr ? "مرتبة تنازلياً حسب إجمالي الإيراد المحقق" : "Ranked by revenue"}
          </p>
          <div className="space-y-2.5">
            {(insights?.topProducts.length ?? 0) === 0 ? (
              <div className="grid place-items-center py-10 text-xs text-muted-foreground">
                {t("common.no_data")}
              </div>
            ) : (
              insights!.topProducts.map((tp, i) => {
                const max = insights!.topProducts[0].total || 1;
                const pct = (tp.total / max) * 100;
                const name = isAr
                  ? tp.product?.name_ar || tp.product?.name
                  : tp.product?.name || tp.product?.name_ar;
                return (
                  <div
                    key={i}
                    className="rounded-2xl border border-border/70 bg-card p-3 shadow-xs"
                  >
                    <div className="mb-2 flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2 min-w-0">
                        <span
                          className={`grid size-6 shrink-0 place-items-center rounded-full text-[10px] font-black ${
                            i < 3
                              ? "bg-gradient-to-br from-amber-400 to-orange-500 text-white shadow-xs"
                              : "bg-surface-2 text-muted-foreground"
                          }`}
                        >
                          {i + 1}
                        </span>
                        <span className="truncate font-semibold text-foreground">{name}</span>
                      </div>
                      <span className="font-mono font-bold text-muted-foreground shrink-0">
                        {num(tp.qty)} × · <span className="text-foreground">{money(tp.total)}</span>
                      </span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-primary via-chart-4 to-chart-2"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Warehouse Distribution */}
        <div className="panel-elevated p-5 sm:p-6 rounded-3xl border border-border/80 shadow-sm flex flex-col justify-between">
          <div>
            <h3 className="text-sm sm:text-base font-bold mb-1 flex items-center gap-1.5">
              <Layers className="size-4 text-cyan-500" />
              {isAr ? "توزيع كميات المخازن" : "Warehouse Distribution"}
            </h3>
            <p className="text-xs text-muted-foreground mb-3">
              {isAr ? "توزيع بضاعة المخزون حسب المستودع" : "Stock quantity split"}
            </p>
          </div>
          <div className="h-56 w-full">
            {(insights?.warehouses.length ?? 0) === 0 ? (
              emptyState(lang)
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={insights?.warehouses ?? []}
                    dataKey="qty"
                    nameKey="name"
                    innerRadius={50}
                    outerRadius={80}
                    paddingAngle={3}
                    stroke="none"
                  >
                    {(insights?.warehouses ?? []).map((_, i) => (
                      <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={TOOLTIP_STYLE}
                    itemStyle={TOOLTIP_ITEM_STYLE}
                    labelStyle={TOOLTIP_LABEL_STYLE}
                    formatter={(val: any, name: any) => [
                      `${num(Number(val))} ${chartLabels.quantity}`,
                      name,
                    ]}
                  />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
          <div className="mt-2 space-y-1.5 border-t border-border/50 pt-2">
            {(insights?.warehouses ?? []).map((w, i) => (
              <div key={w.name} className="flex items-center justify-between text-xs">
                <span className="flex items-center gap-2 text-muted-foreground">
                  <span
                    className="size-2 rounded-full"
                    style={{ background: PALETTE[i % PALETTE.length] }}
                  />
                  <span className="truncate">{w.name}</span>
                </span>
                <span className="font-mono font-bold text-foreground">{num(w.qty)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Fifth row: Payment methods + Expense categories */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 mb-6">
        {/* Payment Methods */}
        <div className="panel-elevated p-5 sm:p-6 rounded-3xl border border-border/80 shadow-sm flex flex-col justify-between">
          <div>
            <h3 className="text-sm sm:text-base font-bold mb-1 flex items-center gap-1.5">
              <Wallet className="size-4 text-chart-3" />{" "}
              {isAr ? "طرق الدفع والتحصيل" : "Payment Methods"}
            </h3>
            <p className="text-xs text-muted-foreground mb-3">
              {isAr ? "توزيع المبالغ المحصلة حسب قناة الدفع" : "Collected split"}
            </p>
          </div>
          <div className="h-56 w-full">
            {(insights?.payment.length ?? 0) === 0 ? (
              emptyState(lang)
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={insights?.payment ?? []}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={50}
                    outerRadius={80}
                    paddingAngle={3}
                    stroke="none"
                  >
                    {(insights?.payment ?? []).map((_, i) => (
                      <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={TOOLTIP_STYLE}
                    itemStyle={TOOLTIP_ITEM_STYLE}
                    labelStyle={TOOLTIP_LABEL_STYLE}
                    formatter={(val: any, name: any) => [money(Number(val)), name]}
                  />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
          {(insights?.payment.length ?? 0) > 0 && (
            <div className="mt-2 space-y-1.5 border-t border-border/50 pt-2">
              {(insights?.payment ?? []).map((p, i) => (
                <div key={p.name} className="flex items-center justify-between text-xs">
                  <span className="flex items-center gap-2 text-muted-foreground">
                    <span
                      className="size-2 rounded-full"
                      style={{ background: PALETTE[i % PALETTE.length] }}
                    />
                    <span className="truncate">{p.name}</span>
                  </span>
                  <span className="font-mono font-bold text-foreground">{money(p.value)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Expenses by Category */}
        <div className="panel-elevated p-5 sm:p-6 rounded-3xl border border-border/80 shadow-sm flex flex-col justify-between">
          <div>
            <h3 className="text-sm sm:text-base font-bold mb-1 flex items-center gap-1.5">
              <TrendingDown className="size-4 text-rose-500" />{" "}
              {isAr ? "المصروفات حسب التصنيف" : "Expenses by Category"}
            </h3>
            <p className="text-xs text-muted-foreground mb-3">
              {isAr
                ? `إجمالي: ${money(insights?.totalExp ?? 0)}`
                : `Total: ${money(insights?.totalExp ?? 0)}`}
            </p>
          </div>
          <div className="h-56 w-full">
            {(insights?.expByCat.length ?? 0) === 0 ? (
              emptyState(lang)
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={insights?.expByCat.slice(0, 6) ?? []}>
                  <CartesianGrid stroke={CHART_GRID_STROKE} vertical={false} />
                  <XAxis
                    dataKey="name"
                    stroke={CHART_AXIS_STROKE}
                    fontSize={10}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    stroke={CHART_AXIS_STROKE}
                    fontSize={11}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(v) => (v >= 1000 ? `${(v / 1000).toFixed(0)}k` : `${v}`)}
                  />
                  <Tooltip
                    contentStyle={TOOLTIP_STYLE}
                    itemStyle={TOOLTIP_ITEM_STYLE}
                    labelStyle={TOOLTIP_LABEL_STYLE}
                    formatter={(val: any) => [money(Number(val)), chartLabels.expenses]}
                  />
                  <Bar dataKey="value" fill="oklch(0.65 0.2 20)" radius={[8, 8, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

function emptyState(lang: string) {
  return (
    <div className="grid h-full place-items-center text-xs text-muted-foreground py-6">
      {lang === "ar" ? "لا توجد بيانات مسجلة لهذه الفترة" : "No data recorded for this period"}
    </div>
  );
}

function chartSkeleton() {
  return (
    <div className="flex h-full w-full items-center justify-center">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
    </div>
  );
}

function localDayKey(input: string | Date): string {
  const d = typeof input === "string" ? new Date(input) : input;
  if (Number.isNaN(d.getTime())) return "";
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

function paymentMethodLabel(method: string | null | undefined, isAr: boolean): string {
  // Reads the catalogue instead of a local map. The map that used to sit here
  // knew cash/card/bank_transfer/bank/credit only, so a mobile-money sale —
  // which the till has been able to take for a long time — rendered as the raw
  // string "mobile_money", and a cheque rendered as "cheque".
  return paymentMethodLabelFromCatalog(method, isAr ? "ar" : "en");
}

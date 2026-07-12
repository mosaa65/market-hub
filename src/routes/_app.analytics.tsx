import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/page-header";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import { money, num } from "@/lib/format";
import {
  Sparkles, TrendingUp, TrendingDown, Users, Package, Wallet, ShoppingCart, Calendar, Activity,
} from "lucide-react";
import {
  AreaChart, Area, LineChart, Line, BarChart, Bar, RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  PieChart, Pie, Cell, ResponsiveContainer, XAxis, YAxis, Tooltip, CartesianGrid, Legend, RadialBarChart, RadialBar,
  ComposedChart,
} from "recharts";

export const Route = createFileRoute("/_app/analytics")({
  head: () => ({ meta: [{ title: "Analytics — Vortex ERP" }] }),
  component: AnalyticsPage,
});

const PALETTE = ["oklch(0.62 0.21 260)", "oklch(0.7 0.18 180)", "oklch(0.72 0.18 60)", "oklch(0.68 0.2 340)", "oklch(0.75 0.15 140)", "oklch(0.65 0.2 20)"];

function AnalyticsPage() {
  const { t, lang } = useI18n();
  const [days, setDays] = useState(30);

  const { data } = useQuery({
    queryKey: ["analytics", days],
    queryFn: async () => {
      const since = new Date(Date.now() - days * 86400_000).toISOString();
      const [sales, items, products, inv, customers, expenses, purchases] = await Promise.all([
        supabase.from("sales_invoices").select("id,total,paid,payment_method,status,created_at,customer_id").gte("created_at", since),
        supabase.from("sales_invoice_items").select("product_id,quantity,total,invoice_id,sales_invoices!inner(created_at,customer_id)").gte("sales_invoices.created_at", since),
        supabase.from("products").select("id,name,name_ar,cost,sale_price,min_stock,category_id,brand_id,categories(name,name_ar),brands(name,name_ar)"),
        supabase.from("inventory").select("product_id,quantity,warehouse_id,warehouses(name,name_ar)"),
        supabase.from("customers").select("id,name,balance,created_at"),
        supabase.from("expenses").select("amount,created_at,category:expense_categories(name,name_ar)").gte("created_at", since),
        supabase.from("purchase_invoices").select("total,created_at").gte("created_at", since),
      ]);
      return {
        sales: sales.data ?? [],
        items: items.data ?? [],
        products: products.data ?? [],
        inv: inv.data ?? [],
        customers: customers.data ?? [],
        expenses: expenses.data ?? [],
        purchases: purchases.data ?? [],
      };
    },
  });

  const insights = useMemo(() => {
    if (!data) return null;
    const sales = data.sales as any[];
    const items = data.items as any[];
    const prodMap = new Map((data.products as any[]).map(p => [p.id, p]));

    // Daily buckets
    const daily: Record<string, { revenue: number; profit: number; orders: number; expenses: number; purchases: number }> = {};
    for (let i = days - 1; i >= 0; i--) {
      const key = new Date(Date.now() - i * 86400_000).toISOString().slice(0, 10);
      daily[key] = { revenue: 0, profit: 0, orders: 0, expenses: 0, purchases: 0 };
    }
    sales.forEach(s => {
      const key = s.created_at.slice(0, 10);
      if (!daily[key]) return;
      daily[key].revenue += Number(s.total);
      daily[key].orders += 1;
    });
    items.forEach((it: any) => {
      const key = it.sales_invoices?.created_at?.slice(0, 10);
      if (!key || !daily[key]) return;
      const p = prodMap.get(it.product_id) as any;
      const cost = p ? Number(p.cost ?? 0) : 0;
      daily[key].profit += Number(it.total) - cost * Number(it.quantity);
    });
    data.expenses.forEach((e: any) => {
      const key = e.created_at.slice(0, 10);
      if (!daily[key]) return;
      daily[key].expenses += Number(e.amount);
    });
    data.purchases.forEach((p: any) => {
      const key = p.created_at.slice(0, 10);
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
      const label = lang === "ar" ? (cat?.name_ar || cat?.name || "—") : (cat?.name || "—");
      const cur = catAgg.get(key) ?? { name: label, revenue: 0 };
      cur.revenue += Number(it.total);
      catAgg.set(key, cur);
    });
    const byCategory = Array.from(catAgg.values()).sort((a, b) => b.revenue - a.revenue);

    // Brand share
    const brandAgg = new Map<string, { name: string; qty: number }>();
    items.forEach((it: any) => {
      const p = prodMap.get(it.product_id) as any;
      const b = p?.brands;
      const key = b?.name ?? "—";
      const label = lang === "ar" ? (b?.name_ar || b?.name || "—") : (b?.name || "—");
      const cur = brandAgg.get(key) ?? { name: label, qty: 0 };
      cur.qty += Number(it.quantity);
      brandAgg.set(key, cur);
    });
    const byBrand = Array.from(brandAgg.values()).sort((a, b) => b.qty - a.qty).slice(0, 6);

    // Hour of day heat
    const hourAgg = new Array(24).fill(0);
    sales.forEach(s => {
      const h = new Date(s.created_at).getHours();
      hourAgg[h] += Number(s.total);
    });
    const hourly = hourAgg.map((v, h) => ({ hour: `${h}:00`, revenue: v }));

    // Weekday pattern
    const dowAgg = new Array(7).fill(0);
    const dowCount = new Array(7).fill(0);
    sales.forEach(s => {
      const d = new Date(s.created_at).getDay();
      dowAgg[d] += Number(s.total);
      dowCount[d] += 1;
    });
    const dowLabels = lang === "ar"
      ? ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"]
      : ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const weekday = dowAgg.map((v, i) => ({ day: dowLabels[i], revenue: v, orders: dowCount[i] }));

    // Payment mix
    const paySplit: Record<string, number> = {};
    sales.forEach(s => { paySplit[s.payment_method] = (paySplit[s.payment_method] ?? 0) + Number(s.paid); });
    const payment = Object.entries(paySplit).map(([name, value]) => ({ name, value }));

    // Top products
    const prodAgg = new Map<string, { qty: number; total: number }>();
    items.forEach((it: any) => {
      const cur = prodAgg.get(it.product_id) ?? { qty: 0, total: 0 };
      cur.qty += Number(it.quantity); cur.total += Number(it.total);
      prodAgg.set(it.product_id, cur);
    });
    const topProducts = Array.from(prodAgg.entries())
      .map(([id, v]) => ({ ...v, product: prodMap.get(id) as any }))
      .filter(x => x.product)
      .sort((a, b) => b.total - a.total).slice(0, 10);

    // Inventory value
    let invValue = 0;
    (data.inv as any[]).forEach(r => {
      const p = prodMap.get(r.product_id) as any;
      if (p) invValue += Number(p.cost ?? 0) * Number(r.quantity);
    });

    // Warehouse distribution
    const whAgg = new Map<string, { name: string; qty: number }>();
    (data.inv as any[]).forEach(r => {
      const w = r.warehouses;
      const label = lang === "ar" ? (w?.name_ar || w?.name || "—") : (w?.name || "—");
      const cur = whAgg.get(label) ?? { name: label, qty: 0 };
      cur.qty += Number(r.quantity);
      whAgg.set(label, cur);
    });
    const warehouses = Array.from(whAgg.values());

    // Customer segmentation (RFM-lite)
    const custAgg = new Map<string, { count: number; spend: number }>();
    sales.forEach(s => {
      if (!s.customer_id) return;
      const cur = custAgg.get(s.customer_id) ?? { count: 0, spend: 0 };
      cur.count += 1; cur.spend += Number(s.total);
      custAgg.set(s.customer_id, cur);
    });
    const segments = { vip: 0, regular: 0, occasional: 0, walkin: 0 };
    let walkin = 0;
    sales.forEach(s => { if (!s.customer_id) walkin += 1; });
    segments.walkin = walkin;
    custAgg.forEach(v => {
      if (v.spend > 1000 || v.count >= 5) segments.vip += 1;
      else if (v.count >= 2) segments.regular += 1;
      else segments.occasional += 1;
    });
    const segData = [
      { name: lang === "ar" ? "VIP" : "VIP", value: segments.vip },
      { name: lang === "ar" ? "منتظمون" : "Regular", value: segments.regular },
      { name: lang === "ar" ? "متقطعون" : "Occasional", value: segments.occasional },
      { name: lang === "ar" ? "عابرون" : "Walk-in", value: segments.walkin },
    ];

    // Totals
    const totalRev = sales.reduce((a, s) => a + Number(s.total), 0);
    const totalProfit = dailyArr.reduce((a, d) => a + d.profit, 0);
    const totalExp = data.expenses.reduce((a: number, e: any) => a + Number(e.amount), 0);
    const avgOrder = sales.length ? totalRev / sales.length : 0;
    const uniqueCustomers = new Set(sales.map(s => s.customer_id).filter(Boolean)).size;

    // Expense categories
    const expAgg = new Map<string, number>();
    data.expenses.forEach((e: any) => {
      const label = lang === "ar" ? (e.category?.name_ar || e.category?.name || "—") : (e.category?.name || "—");
      expAgg.set(label, (expAgg.get(label) ?? 0) + Number(e.amount));
    });
    const expByCat = Array.from(expAgg.entries()).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);

    return {
      dailyArr, byCategory, byBrand, hourly, weekday, payment, topProducts, invValue, warehouses,
      segData, totalRev, totalProfit, totalExp, avgOrder, uniqueCustomers, expByCat,
      totalOrders: sales.length,
    };
  }, [data, days, lang]);

  const dayRanges = [7, 14, 30, 90];

  return (
    <>
      <PageHeader
        title={lang === "ar" ? "التحليلات المتقدمة" : "Advanced Analytics"}
        subtitle={lang === "ar" ? "رؤى عميقة حول الأداء، العملاء، والمخزون" : "Deep insights into performance, customers, and inventory"}
        actions={
          <div className="flex items-center gap-1 rounded-full border border-border bg-surface p-1">
            {dayRanges.map(d => (
              <button
                key={d}
                onClick={() => setDays(d)}
                className={`h-7 rounded-full px-3 text-[11px] font-medium transition ${days === d ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
              >
                {d}{lang === "ar" ? "ي" : "d"}
              </button>
            ))}
          </div>
        }
      />

      {/* Hero KPI grid */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 mb-6">
        <HeroKpi icon={TrendingUp} label={lang === "ar" ? "إجمالي المبيعات" : "Total Revenue"} value={money(insights?.totalRev ?? 0)} sub={`${num(insights?.totalOrders ?? 0)} ${lang === "ar" ? "طلب" : "orders"}`} color="from-primary/30 to-primary/5" iconColor="text-primary" />
        <HeroKpi icon={Sparkles} label={lang === "ar" ? "صافي الربح" : "Gross Profit"} value={money(insights?.totalProfit ?? 0)} sub={insights && insights.totalRev > 0 ? `${((insights.totalProfit / insights.totalRev) * 100).toFixed(1)}% ${lang === "ar" ? "هامش" : "margin"}` : "—"} color="from-emerald-500/30 to-emerald-500/5" iconColor="text-emerald-500" />
        <HeroKpi icon={ShoppingCart} label={lang === "ar" ? "متوسط الفاتورة" : "Avg. Order"} value={money(insights?.avgOrder ?? 0)} sub={lang === "ar" ? "لكل معاملة" : "per transaction"} color="from-chart-2/30 to-chart-2/5" iconColor="text-chart-2" />
        <HeroKpi icon={Users} label={lang === "ar" ? "عملاء نشطون" : "Active Customers"} value={num(insights?.uniqueCustomers ?? 0)} sub={`${money(insights?.invValue ?? 0)} ${lang === "ar" ? "قيمة المخزون" : "stock value"}`} color="from-chart-4/30 to-chart-4/5" iconColor="text-chart-4" />
      </div>

      {/* Revenue vs Expenses composed */}
      <div className="panel-elevated p-5 mb-6">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold flex items-center gap-1.5"><Activity className="h-4 w-4 text-primary" /> {lang === "ar" ? "تدفق الإيرادات والأرباح" : "Revenue & Profit flow"}</h3>
            <p className="text-xs text-muted-foreground">{lang === "ar" ? `آخر ${days} يوم` : `Last ${days} days`}</p>
          </div>
        </div>
        <div className="h-72">
          <ResponsiveContainer>
            <ComposedChart data={insights?.dailyArr ?? []}>
              <defs>
                <linearGradient id="rev" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="oklch(0.62 0.21 260)" stopOpacity={0.5} />
                  <stop offset="100%" stopColor="oklch(0.62 0.21 260)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="oklch(1 0 0 / 0.05)" vertical={false} />
              <XAxis dataKey="date" stroke="oklch(0.62 0.015 270)" fontSize={11} tickLine={false} axisLine={false} />
              <YAxis stroke="oklch(0.62 0.015 270)" fontSize={11} tickLine={false} axisLine={false} />
              <Tooltip contentStyle={{ background: "oklch(0.18 0.007 270)", border: "1px solid oklch(1 0 0 / 0.08)", borderRadius: 12, fontSize: 12 }} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Area type="monotone" dataKey="revenue" stroke="oklch(0.62 0.21 260)" strokeWidth={2.5} fill="url(#rev)" name={lang === "ar" ? "الإيراد" : "Revenue"} />
              <Bar dataKey="expenses" fill="oklch(0.65 0.2 20)" radius={[4, 4, 0, 0]} opacity={0.7} name={lang === "ar" ? "المصروفات" : "Expenses"} />
              <Line type="monotone" dataKey="profit" stroke="oklch(0.7 0.18 140)" strokeWidth={2.5} dot={false} name={lang === "ar" ? "الربح" : "Profit"} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Second row */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3 mb-6">
        <div className="panel-elevated p-5">
          <h3 className="text-sm font-semibold mb-1">{lang === "ar" ? "الإيراد حسب التصنيف" : "Revenue by Category"}</h3>
          <p className="text-xs text-muted-foreground mb-3">{lang === "ar" ? "أعلى التصنيفات أداءً" : "Top performing categories"}</p>
          <div className="h-56">
            {(insights?.byCategory.length ?? 0) === 0 ? emptyState(lang) : (
              <ResponsiveContainer>
                <BarChart data={insights!.byCategory.slice(0, 6)} layout="vertical" margin={{ left: 40 }}>
                  <CartesianGrid stroke="oklch(1 0 0 / 0.05)" horizontal={false} />
                  <XAxis type="number" stroke="oklch(0.62 0.015 270)" fontSize={10} tickLine={false} axisLine={false} />
                  <YAxis type="category" dataKey="name" stroke="oklch(0.62 0.015 270)" fontSize={10} tickLine={false} axisLine={false} width={80} />
                  <Tooltip contentStyle={{ background: "oklch(0.18 0.007 270)", border: "1px solid oklch(1 0 0 / 0.08)", borderRadius: 12, fontSize: 12 }} />
                  <Bar dataKey="revenue" fill="oklch(0.62 0.21 260)" radius={[0, 6, 6, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        <div className="panel-elevated p-5">
          <h3 className="text-sm font-semibold mb-1">{lang === "ar" ? "شرائح العملاء" : "Customer Segments"}</h3>
          <p className="text-xs text-muted-foreground mb-3">{lang === "ar" ? "توزيع ولاء العملاء" : "Loyalty distribution"}</p>
          <div className="h-56">
            {(insights?.segData.reduce((a, s) => a + s.value, 0) ?? 0) === 0 ? emptyState(lang) : (
              <ResponsiveContainer>
                <RadialBarChart innerRadius="30%" outerRadius="100%" data={insights?.segData ?? []} startAngle={90} endAngle={-270}>
                  <RadialBar dataKey="value" cornerRadius={8}>
                    {(insights?.segData ?? []).map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
                  </RadialBar>
                  <Tooltip contentStyle={{ background: "oklch(0.18 0.007 270)", border: "1px solid oklch(1 0 0 / 0.08)", borderRadius: 12, fontSize: 12 }} />
                  <Legend iconSize={8} wrapperStyle={{ fontSize: 10 }} />
                </RadialBarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        <div className="panel-elevated p-5">
          <h3 className="text-sm font-semibold mb-1">{lang === "ar" ? "أفضل العلامات التجارية" : "Top Brands"}</h3>
          <p className="text-xs text-muted-foreground mb-3">{lang === "ar" ? "الأكثر مبيعاً بالكمية" : "Best-selling by quantity"}</p>
          <div className="h-56">
            {(insights?.byBrand.length ?? 0) === 0 ? emptyState(lang) : (
              <ResponsiveContainer>
                <RadarChart data={insights?.byBrand ?? []}>
                  <PolarGrid stroke="oklch(1 0 0 / 0.08)" />
                  <PolarAngleAxis dataKey="name" tick={{ fill: "oklch(0.62 0.015 270)", fontSize: 10 }} />
                  <PolarRadiusAxis tick={{ fill: "oklch(0.62 0.015 270)", fontSize: 9 }} />
                  <Radar dataKey="qty" stroke="oklch(0.68 0.2 340)" fill="oklch(0.68 0.2 340)" fillOpacity={0.5} />
                  <Tooltip contentStyle={{ background: "oklch(0.18 0.007 270)", border: "1px solid oklch(1 0 0 / 0.08)", borderRadius: 12, fontSize: 12 }} />
                </RadarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>

      {/* Third row: patterns */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 mb-6">
        <div className="panel-elevated p-5">
          <h3 className="text-sm font-semibold mb-1 flex items-center gap-1.5"><Calendar className="h-4 w-4 text-chart-2" /> {lang === "ar" ? "نمط أيام الأسبوع" : "Weekday Pattern"}</h3>
          <p className="text-xs text-muted-foreground mb-3">{lang === "ar" ? "الإيراد حسب اليوم" : "Revenue distribution by day"}</p>
          <div className="h-64">
            {(insights?.weekday.reduce((a, d) => a + d.revenue, 0) ?? 0) === 0 ? emptyState(lang) : (
              <ResponsiveContainer>
                <BarChart data={insights?.weekday ?? []}>
                  <CartesianGrid stroke="oklch(1 0 0 / 0.05)" vertical={false} />
                  <XAxis dataKey="day" stroke="oklch(0.62 0.015 270)" fontSize={11} tickLine={false} axisLine={false} />
                  <YAxis stroke="oklch(0.62 0.015 270)" fontSize={11} tickLine={false} axisLine={false} />
                  <Tooltip contentStyle={{ background: "oklch(0.18 0.007 270)", border: "1px solid oklch(1 0 0 / 0.08)", borderRadius: 12, fontSize: 12 }} />
                  <Bar dataKey="revenue" radius={[8, 8, 0, 0]}>
                    {(insights?.weekday ?? []).map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        <div className="panel-elevated p-5">
          <h3 className="text-sm font-semibold mb-1 flex items-center gap-1.5"><Activity className="h-4 w-4 text-chart-4" /> {lang === "ar" ? "الساعات الذروة" : "Peak Hours"}</h3>
          <p className="text-xs text-muted-foreground mb-3">{lang === "ar" ? "الإيراد خلال اليوم" : "Revenue throughout the day"}</p>
          <div className="h-64">
            {(insights?.hourly.reduce((a, h) => a + h.revenue, 0) ?? 0) === 0 ? emptyState(lang) : (
              <ResponsiveContainer>
                <AreaChart data={insights?.hourly ?? []}>
                  <defs>
                    <linearGradient id="hg" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="oklch(0.68 0.2 340)" stopOpacity={0.6} />
                      <stop offset="100%" stopColor="oklch(0.68 0.2 340)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="oklch(1 0 0 / 0.05)" vertical={false} />
                  <XAxis dataKey="hour" stroke="oklch(0.62 0.015 270)" fontSize={10} tickLine={false} axisLine={false} interval={2} />
                  <YAxis stroke="oklch(0.62 0.015 270)" fontSize={11} tickLine={false} axisLine={false} />
                  <Tooltip contentStyle={{ background: "oklch(0.18 0.007 270)", border: "1px solid oklch(1 0 0 / 0.08)", borderRadius: 12, fontSize: 12 }} />
                  <Area type="monotone" dataKey="revenue" stroke="oklch(0.68 0.2 340)" strokeWidth={2.5} fill="url(#hg)" />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>

      {/* Fourth row: top products & warehouses */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3 mb-6">
        <div className="panel-elevated p-5 lg:col-span-2">
          <h3 className="text-sm font-semibold mb-1 flex items-center gap-1.5"><Package className="h-4 w-4 text-primary" /> {lang === "ar" ? "أفضل 10 منتجات" : "Top 10 Products"}</h3>
          <p className="text-xs text-muted-foreground mb-4">{lang === "ar" ? "المرتّبة حسب الإيراد" : "Ranked by revenue"}</p>
          <div className="space-y-2.5">
            {(insights?.topProducts.length ?? 0) === 0 ? (
              <div className="grid place-items-center py-10 text-xs text-muted-foreground">{t("common.no_data")}</div>
            ) : insights!.topProducts.map((tp, i) => {
              const max = insights!.topProducts[0].total || 1;
              const pct = (tp.total / max) * 100;
              const name = lang === "ar" ? (tp.product?.name_ar || tp.product?.name) : (tp.product?.name || tp.product?.name_ar);
              return (
                <div key={i} className="rounded-xl border border-border bg-surface p-3">
                  <div className="mb-2 flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-[10px] font-bold ${i < 3 ? "bg-gradient-to-br from-amber-400 to-orange-500 text-white" : "bg-surface-2 text-muted-foreground"}`}>{i + 1}</span>
                      <span className="truncate font-medium">{name}</span>
                    </div>
                    <span className="font-mono text-muted-foreground shrink-0">{tp.qty} × · {money(tp.total)}</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
                    <div className="h-full rounded-full bg-gradient-to-r from-primary via-chart-4 to-chart-2" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="panel-elevated p-5">
          <h3 className="text-sm font-semibold mb-1">{lang === "ar" ? "توزيع المستودعات" : "Warehouse Distribution"}</h3>
          <p className="text-xs text-muted-foreground mb-3">{lang === "ar" ? "كمية المخزون" : "Stock quantity split"}</p>
          <div className="h-56">
            {(insights?.warehouses.length ?? 0) === 0 ? emptyState(lang) : (
              <ResponsiveContainer>
                <PieChart>
                  <Pie data={insights?.warehouses ?? []} dataKey="qty" nameKey="name" innerRadius={50} outerRadius={90} paddingAngle={2}>
                    {(insights?.warehouses ?? []).map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
                  </Pie>
                  <Tooltip contentStyle={{ background: "oklch(0.18 0.007 270)", border: "1px solid oklch(1 0 0 / 0.08)", borderRadius: 12, fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
          <div className="mt-2 space-y-1.5">
            {(insights?.warehouses ?? []).map((w, i) => (
              <div key={w.name} className="flex items-center justify-between text-xs">
                <span className="flex items-center gap-2 text-muted-foreground">
                  <span className="h-2 w-2 rounded-full" style={{ background: PALETTE[i % PALETTE.length] }} />
                  {w.name}
                </span>
                <span className="font-mono">{num(w.qty)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Fifth row: payment + expense */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 mb-6">
        <div className="panel-elevated p-5">
          <h3 className="text-sm font-semibold mb-1 flex items-center gap-1.5"><Wallet className="h-4 w-4 text-chart-3" /> {lang === "ar" ? "طرق الدفع" : "Payment Methods"}</h3>
          <p className="text-xs text-muted-foreground mb-3">{lang === "ar" ? "توزيع المحصّلات" : "Collected split"}</p>
          <div className="h-56">
            {(insights?.payment.length ?? 0) === 0 ? emptyState(lang) : (
              <ResponsiveContainer>
                <PieChart>
                  <Pie data={insights?.payment ?? []} dataKey="value" nameKey="name" outerRadius={90} label={{ fontSize: 10 }}>
                    {(insights?.payment ?? []).map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
                  </Pie>
                  <Tooltip contentStyle={{ background: "oklch(0.18 0.007 270)", border: "1px solid oklch(1 0 0 / 0.08)", borderRadius: 12, fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        <div className="panel-elevated p-5">
          <h3 className="text-sm font-semibold mb-1 flex items-center gap-1.5"><TrendingDown className="h-4 w-4 text-rose-500" /> {lang === "ar" ? "المصروفات حسب التصنيف" : "Expenses by Category"}</h3>
          <p className="text-xs text-muted-foreground mb-3">{money(insights?.totalExp ?? 0)} {lang === "ar" ? "إجمالي" : "total"}</p>
          <div className="h-56">
            {(insights?.expByCat.length ?? 0) === 0 ? emptyState(lang) : (
              <ResponsiveContainer>
                <BarChart data={insights?.expByCat.slice(0, 6) ?? []}>
                  <CartesianGrid stroke="oklch(1 0 0 / 0.05)" vertical={false} />
                  <XAxis dataKey="name" stroke="oklch(0.62 0.015 270)" fontSize={10} tickLine={false} axisLine={false} />
                  <YAxis stroke="oklch(0.62 0.015 270)" fontSize={11} tickLine={false} axisLine={false} />
                  <Tooltip contentStyle={{ background: "oklch(0.18 0.007 270)", border: "1px solid oklch(1 0 0 / 0.08)", borderRadius: 12, fontSize: 12 }} />
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
  return <div className="grid h-full place-items-center text-xs text-muted-foreground">{lang === "ar" ? "لا توجد بيانات" : "No data"}</div>;
}

function HeroKpi({ icon: Icon, label, value, sub, color, iconColor }: {
  icon: typeof TrendingUp; label: string; value: string; sub: string; color: string; iconColor: string;
}) {
  return (
    <div className={`relative overflow-hidden rounded-2xl border border-border/60 bg-gradient-to-br ${color} p-4`}>
      <div className="flex items-start justify-between">
        <div className="min-w-0">
          <p className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground truncate">{label}</p>
          <p className="mt-2 text-2xl font-bold tracking-tight truncate">{value}</p>
          <p className="mt-1 text-[10px] text-muted-foreground truncate">{sub}</p>
        </div>
        <div className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-background/40 backdrop-blur ${iconColor}`}>
          <Icon className="h-4 w-4" />
        </div>
      </div>
    </div>
  );
}

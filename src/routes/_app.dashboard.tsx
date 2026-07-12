import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/page-header";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import { money, num } from "@/lib/format";
import {
  ArrowUpRight, ArrowDownRight, DollarSign, ShoppingCart, Users, AlertTriangle,
  Package, TrendingUp, Wallet, ArrowRight, Sparkles, Receipt, Boxes,
} from "lucide-react";
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, BarChart, Bar, CartesianGrid,
  PieChart, Pie, Cell,
} from "recharts";

export const Route = createFileRoute("/_app/dashboard")({
  head: () => ({ meta: [{ title: "Dashboard — Vortex ERP" }] }),
  component: DashboardPage,
});

const CHART_COLORS = ["oklch(0.62 0.21 260)", "oklch(0.7 0.18 180)", "oklch(0.72 0.18 60)", "oklch(0.68 0.2 340)", "oklch(0.75 0.15 140)"];

function DashboardPage() {
  const { t, lang } = useI18n();

  const { data } = useQuery({
    queryKey: ["dashboard-v2"],
    queryFn: async () => {
      const since = new Date(Date.now() - 30 * 86400_000).toISOString();
      const since14 = new Date(Date.now() - 14 * 86400_000).toISOString();
      const [sales, customers, products, inv, items, recent, expenses] = await Promise.all([
        supabase.from("sales_invoices").select("total,paid,payment_method,created_at,status,customer_id").gte("created_at", since),
        supabase.from("customers").select("id,name,balance", { count: "exact" }).eq("is_active", true),
        supabase.from("products").select("id,name,name_ar,min_stock,sale_price"),
        supabase.from("inventory").select("product_id,quantity"),
        supabase.from("sales_invoice_items").select("product_id,quantity,total,invoice_id,sales_invoices!inner(created_at,customer_id)").gte("sales_invoices.created_at", since),
        supabase.from("sales_invoices").select("id,invoice_number,total,status,created_at,customers(name)").gte("created_at", since14).order("created_at", { ascending: false }).limit(8),
        supabase.from("expenses").select("amount,created_at").gte("created_at", since),
      ]);

      const salesRows = sales.data ?? [];
      const stockMap = new Map<string, number>();
      (inv.data ?? []).forEach((r: any) => stockMap.set(r.product_id, (stockMap.get(r.product_id) ?? 0) + Number(r.quantity)));
      const lowStock = (products.data ?? []).filter((p: any) => (stockMap.get(p.id) ?? 0) <= Number(p.min_stock ?? 0));

      // Daily revenue for last 14 days
      const daily: { day: string; revenue: number; orders: number }[] = [];
      for (let i = 13; i >= 0; i--) {
        const d = new Date(Date.now() - i * 86400_000);
        const key = d.toISOString().slice(0, 10);
        const label = d.toLocaleDateString(lang === "ar" ? "ar" : "en", { weekday: "short" });
        const rows = salesRows.filter(r => (r as any).created_at.slice(0, 10) === key);
        daily.push({
          day: label,
          revenue: rows.reduce((a, r: any) => a + Number(r.total), 0),
          orders: rows.length,
        });
      }

      // Top products
      const prodAgg = new Map<string, { qty: number; total: number }>();
      (items.data ?? []).forEach((it: any) => {
        const cur = prodAgg.get(it.product_id) ?? { qty: 0, total: 0 };
        cur.qty += Number(it.quantity); cur.total += Number(it.total);
        prodAgg.set(it.product_id, cur);
      });
      const prodMap = new Map((products.data ?? []).map((p: any) => [p.id, p]));
      const topProducts = Array.from(prodAgg.entries())
        .map(([id, v]) => ({ ...v, product: prodMap.get(id) as any }))
        .filter(x => x.product)
        .sort((a, b) => b.total - a.total).slice(0, 5);

      // Payment mix
      const paySplit: Record<string, number> = {};
      salesRows.forEach((r: any) => { paySplit[r.payment_method] = (paySplit[r.payment_method] ?? 0) + Number(r.paid); });

      const totalRev = salesRows.reduce((a, r: any) => a + Number(r.total), 0);
      const totalPaid = salesRows.reduce((a, r: any) => a + Number(r.paid), 0);
      const totalExpenses = (expenses.data ?? []).reduce((a, r: any) => a + Number(r.amount), 0);
      const receivables = (customers.data ?? []).reduce((a, r: any) => a + Math.max(0, Number(r.balance ?? 0)), 0);
      const topDebtors = (customers.data ?? []).filter((c: any) => Number(c.balance) > 0).sort((a: any, b: any) => Number(b.balance) - Number(a.balance)).slice(0, 5);

      return {
        revenue: totalRev,
        collected: totalPaid,
        orders: salesRows.length,
        customers: customers.count ?? 0,
        alerts: lowStock.length,
        expenses: totalExpenses,
        receivables,
        netCash: totalPaid - totalExpenses,
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

  return (
    <>
      <PageHeader
        title={t("dash.title")}
        subtitle={t("dash.subtitle")}
        actions={
          <Link to="/analytics" className="hidden sm:flex h-9 items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-4 text-xs font-medium text-primary hover:bg-primary/20 transition">
            <Sparkles className="h-3.5 w-3.5" /> {lang === "ar" ? "التحليلات المتقدمة" : "Advanced analytics"}
          </Link>
        }
      />

      {/* Hero banner */}
      <div className="relative mb-6 overflow-hidden rounded-3xl border border-border/60 bg-gradient-to-br from-primary/20 via-chart-4/10 to-chart-2/10 p-6 sm:p-8">
        <div className="absolute inset-0 opacity-30 [background-image:radial-gradient(circle_at_20%_20%,oklch(0.62_0.21_260/.5),transparent_50%),radial-gradient(circle_at_80%_80%,oklch(0.7_0.18_180/.4),transparent_50%)]" />
        <div className="relative grid gap-6 sm:grid-cols-[1fr_auto] sm:items-center">
          <div>
            <div className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[10px] font-medium uppercase tracking-widest text-muted-foreground backdrop-blur">
              <TrendingUp className="h-3 w-3" /> {lang === "ar" ? "آخر 30 يوم" : "Last 30 days"}
            </div>
            <h2 className="mt-3 text-3xl sm:text-4xl font-bold tracking-tight text-foreground">
              {money(data?.revenue ?? 0)}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {lang === "ar" ? "إجمالي المبيعات مع" : "Total revenue across"} <span className="font-semibold text-foreground">{num(data?.orders ?? 0)}</span> {lang === "ar" ? "فاتورة" : "orders"}
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <MiniBadge label={lang === "ar" ? "المحصّل" : "Collected"} value={money(data?.collected ?? 0)} tone="pos" />
              <MiniBadge label={lang === "ar" ? "الذمم" : "Receivable"} value={money(data?.receivables ?? 0)} tone="warn" />
              <MiniBadge label={lang === "ar" ? "صافي نقد" : "Net cash"} value={money(data?.netCash ?? 0)} tone={data?.netCash && data.netCash >= 0 ? "pos" : "neg"} />
            </div>
          </div>
          <div className="hidden sm:block h-32 w-64">
            <ResponsiveContainer>
              <AreaChart data={data?.daily ?? []}>
                <defs>
                  <linearGradient id="heroG" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="oklch(0.62 0.21 260)" stopOpacity={0.6} />
                    <stop offset="100%" stopColor="oklch(0.62 0.21 260)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <Area type="monotone" dataKey="revenue" stroke="oklch(0.62 0.21 260)" strokeWidth={2.5} fill="url(#heroG)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label={t("dash.sales")} value={num(data?.orders ?? 0)} delta="+4.1%" up icon={ShoppingCart} accent="primary" to="/sales" />
        <StatCard label={t("dash.customers")} value={num(data?.customers ?? 0)} delta="+2" up icon={Users} accent="chart-2" to="/customers" />
        <StatCard label={lang === "ar" ? "المصروفات" : "Expenses"} value={money(data?.expenses ?? 0)} delta="-3%" up={false} icon={Wallet} accent="chart-3" to="/finance" />
        <StatCard label={t("dash.alerts")} value={num(data?.alerts ?? 0)} delta={data?.alerts ? "!" : "0"} up={!data?.alerts} icon={AlertTriangle} accent="warning" to="/inventory" />
      </div>

      {/* Charts row */}
      <div className="mt-6 grid grid-cols-1 gap-3 lg:grid-cols-3">
        <div className="panel-elevated lg:col-span-2 p-5">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold">{t("dash.revenue_trend")}</h3>
              <p className="text-xs text-muted-foreground">{t("dash.last_14_days")}</p>
            </div>
            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <span className="h-2 w-2 rounded-full bg-primary" /> {lang === "ar" ? "الإيراد" : "Revenue"}
              <span className="ms-2 h-2 w-2 rounded-full bg-chart-2" /> {lang === "ar" ? "الطلبات" : "Orders"}
            </div>
          </div>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data?.daily ?? []}>
                <defs>
                  <linearGradient id="g1" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="oklch(0.62 0.21 260)" stopOpacity={0.5} />
                    <stop offset="100%" stopColor="oklch(0.62 0.21 260)" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="g2" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="oklch(0.7 0.18 180)" stopOpacity={0.4} />
                    <stop offset="100%" stopColor="oklch(0.7 0.18 180)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="oklch(1 0 0 / 0.05)" vertical={false} />
                <XAxis dataKey="day" stroke="oklch(0.62 0.015 270)" fontSize={11} tickLine={false} axisLine={false} />
                <YAxis stroke="oklch(0.62 0.015 270)" fontSize={11} tickLine={false} axisLine={false} />
                <Tooltip contentStyle={{ background: "oklch(0.18 0.007 270)", border: "1px solid oklch(1 0 0 / 0.08)", borderRadius: 12, fontSize: 12 }} />
                <Area type="monotone" dataKey="revenue" stroke="oklch(0.62 0.21 260)" strokeWidth={2.5} fill="url(#g1)" />
                <Area type="monotone" dataKey="orders" stroke="oklch(0.7 0.18 180)" strokeWidth={2} fill="url(#g2)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="panel-elevated p-5">
          <h3 className="text-sm font-semibold">{lang === "ar" ? "توزيع طرق الدفع" : "Payment mix"}</h3>
          <p className="text-xs text-muted-foreground">{t("dash.last_30_days")}</p>
          <div className="mt-4 h-52">
            {paymentPie.length === 0 ? (
              <div className="grid h-full place-items-center text-xs text-muted-foreground">{t("common.no_data")}</div>
            ) : (
              <ResponsiveContainer>
                <PieChart>
                  <Pie data={paymentPie} dataKey="value" nameKey="name" innerRadius={50} outerRadius={80} strokeWidth={0}>
                    {paymentPie.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                  </Pie>
                  <Tooltip contentStyle={{ background: "oklch(0.18 0.007 270)", border: "1px solid oklch(1 0 0 / 0.08)", borderRadius: 12, fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
          <div className="mt-2 space-y-1.5">
            {paymentPie.map((p, i) => (
              <div key={p.name} className="flex items-center justify-between text-xs">
                <span className="flex items-center gap-2 capitalize text-muted-foreground">
                  <span className="h-2 w-2 rounded-full" style={{ background: CHART_COLORS[i % CHART_COLORS.length] }} />
                  {p.name}
                </span>
                <span className="font-mono">{money(p.value)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Top products & Recent sales */}
      <div className="mt-6 grid grid-cols-1 gap-3 lg:grid-cols-2">
        <div className="panel-elevated p-5">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold flex items-center gap-1.5"><Package className="h-4 w-4 text-chart-2" /> {t("dash.top_products")}</h3>
              <p className="text-xs text-muted-foreground">{t("dash.last_30_days")}</p>
            </div>
          </div>
          {(data?.topProducts.length ?? 0) === 0 ? (
            <div className="grid place-items-center py-10 text-xs text-muted-foreground">{t("common.no_data")}</div>
          ) : (
            <div className="space-y-3">
              {data!.topProducts.map((tp, i) => {
                const max = data!.topProducts[0].total || 1;
                const pct = (tp.total / max) * 100;
                const name = lang === "ar" ? (tp.product?.name_ar || tp.product?.name) : (tp.product?.name || tp.product?.name_ar);
                return (
                  <div key={i}>
                    <div className="mb-1 flex items-center justify-between text-xs">
                      <span className="truncate font-medium">{name}</span>
                      <span className="font-mono text-muted-foreground">{money(tp.total)} · {tp.qty}</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
                      <div className="h-full rounded-full bg-gradient-to-r from-primary to-chart-4" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="panel-elevated p-5">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-sm font-semibold flex items-center gap-1.5"><Receipt className="h-4 w-4 text-primary" /> {t("dash.recent_sales")}</h3>
            <Link to="/sales" className="text-[11px] text-primary hover:underline flex items-center gap-0.5">{lang === "ar" ? "الكل" : "All"} <ArrowRight className="h-3 w-3" /></Link>
          </div>
          {(data?.recent.length ?? 0) === 0 ? (
            <div className="grid place-items-center py-10 text-xs text-muted-foreground">{t("dash.no_invoices_hint")}</div>
          ) : (
            <div className="divide-y divide-border/60">
              {(data?.recent ?? []).map((r: any) => (
                <div key={r.id} className="flex items-center justify-between py-2.5 text-sm">
                  <div className="min-w-0">
                    <div className="truncate font-medium">{r.customers?.name ?? (lang === "ar" ? "عميل نقدي" : "Walk-in")}</div>
                    <div className="text-[11px] text-muted-foreground font-mono">{r.invoice_number}</div>
                  </div>
                  <div className="text-end">
                    <div className="font-semibold font-mono">{money(Number(r.total))}</div>
                    <div className={`text-[10px] ${r.status === "paid" ? "text-emerald-500" : r.status === "partial" ? "text-amber-500" : "text-muted-foreground"}`}>{r.status}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Low stock & Top debtors */}
      <div className="mt-6 grid grid-cols-1 gap-3 lg:grid-cols-2">
        <div className="panel-elevated p-5">
          <h3 className="text-sm font-semibold flex items-center gap-1.5"><Boxes className="h-4 w-4 text-warning" /> {lang === "ar" ? "منتجات على وشك النفاد" : "Low stock alerts"}</h3>
          <p className="text-xs text-muted-foreground mb-4">{lang === "ar" ? "المنتجات تحت الحد الأدنى" : "Products below minimum"}</p>
          {(data?.lowStock.length ?? 0) === 0 ? (
            <div className="grid place-items-center py-10 text-xs text-emerald-500">✓ {lang === "ar" ? "المخزون بحالة جيدة" : "All stock is healthy"}</div>
          ) : (
            <div className="space-y-2">
              {data!.lowStock.map((p: any) => {
                const name = lang === "ar" ? (p.name_ar || p.name) : (p.name || p.name_ar);
                return (
                  <div key={p.id} className="flex items-center justify-between rounded-xl border border-warning/20 bg-warning/5 px-3 py-2 text-sm">
                    <span className="truncate">{name}</span>
                    <span className="font-mono text-warning">{p.stock} / {p.min_stock}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="panel-elevated p-5">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-sm font-semibold flex items-center gap-1.5"><Users className="h-4 w-4 text-chart-3" /> {lang === "ar" ? "أعلى الديون" : "Top debtors"}</h3>
            <Link to="/debts" className="text-[11px] text-primary hover:underline flex items-center gap-0.5">{lang === "ar" ? "الكل" : "All"} <ArrowRight className="h-3 w-3" /></Link>
          </div>
          {(data?.topDebtors.length ?? 0) === 0 ? (
            <div className="grid place-items-center py-10 text-xs text-emerald-500">✓ {lang === "ar" ? "لا توجد ذمم" : "No outstanding balances"}</div>
          ) : (
            <div className="space-y-2">
              {data!.topDebtors.map((c: any) => (
                <div key={c.id} className="flex items-center justify-between rounded-xl border border-border bg-surface px-3 py-2 text-sm">
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

function MiniBadge({ label, value, tone }: { label: string; value: string; tone: "pos" | "neg" | "warn" }) {
  const cls = tone === "pos" ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-500"
    : tone === "neg" ? "border-rose-500/30 bg-rose-500/10 text-rose-500"
    : "border-amber-500/30 bg-amber-500/10 text-amber-500";
  return (
    <div className={`rounded-full border px-3 py-1 text-xs backdrop-blur ${cls}`}>
      <span className="opacity-70">{label}:</span> <span className="font-semibold font-mono">{value}</span>
    </div>
  );
}

function StatCard({ label, value, delta, up, icon: Icon, accent, to }: {
  label: string; value: string; delta: string; up: boolean;
  icon: typeof DollarSign; accent: "primary" | "chart-2" | "chart-3" | "warning"; to?: string;
}) {
  const colorMap: Record<string, string> = {
    primary: "text-primary bg-primary/10",
    "chart-2": "text-chart-2 bg-chart-2/10",
    "chart-3": "text-chart-3 bg-chart-3/10",
    warning: "text-warning bg-warning/10",
  };
  const Body = (
    <div className="panel-elevated p-4 relative overflow-hidden group hover:border-ring/40 transition-all">
      <div className="flex items-start justify-between">
        <div className="min-w-0">
          <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground truncate">{label}</p>
          <p className="mt-2 text-2xl font-bold tracking-tight text-foreground truncate">{value}</p>
        </div>
        <div className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${colorMap[accent]}`}>
          <Icon className="h-4 w-4" />
        </div>
      </div>
      <div className="mt-3 flex items-center gap-1 text-xs">
        {up ? <ArrowUpRight className="h-3.5 w-3.5 text-emerald-500" /> : <ArrowDownRight className="h-3.5 w-3.5 text-rose-500" />}
        <span className={up ? "text-emerald-500" : "text-rose-500"}>{delta}</span>
      </div>
    </div>
  );
  return to ? <Link to={to}>{Body}</Link> : Body;
}

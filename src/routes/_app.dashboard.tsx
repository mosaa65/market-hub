import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/page-header";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import { money, num } from "@/lib/format";
import {
  ArrowUpRight, ArrowDownRight, DollarSign, ShoppingCart, Users, AlertTriangle,
} from "lucide-react";
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, BarChart, Bar, CartesianGrid,
} from "recharts";

export const Route = createFileRoute("/_app/dashboard")({
  head: () => ({ meta: [{ title: "Dashboard — Vortex ERP" }] }),
  component: DashboardPage,
});

function DashboardPage() {
  const { t } = useI18n();

  const { data: stats } = useQuery({
    queryKey: ["dashboard-stats"],
    queryFn: async () => {
      const since = new Date(Date.now() - 30 * 86400_000).toISOString();
      const [sales, customers, lowStock] = await Promise.all([
        supabase.from("sales_invoices").select("total, created_at, status").gte("created_at", since),
        supabase.from("customers").select("id", { count: "exact", head: true }).eq("is_active", true),
        supabase.from("products").select("id, name, min_stock, inventory(quantity)").limit(50),
      ]);
      const totalRev = (sales.data ?? []).reduce((a, b: any) => a + Number(b.total ?? 0), 0);
      const orderCount = (sales.data ?? []).length;
      return {
        revenue: totalRev,
        orders: orderCount,
        customers: customers.count ?? 0,
        alerts: 0,
      };
    },
  });

  const trend = Array.from({ length: 14 }).map((_, i) => ({
    day: `D${i + 1}`,
    sales: Math.round(800 + Math.sin(i / 2) * 350 + Math.random() * 300),
    orders: Math.round(8 + Math.cos(i / 2) * 4 + Math.random() * 3),
  }));

  return (
    <>
      <PageHeader
        title={t("dash.title")}
        subtitle={t("dash.subtitle")}
        actions={
          <button className="flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-xs font-medium text-muted-foreground hover:text-foreground transition">
            {t("common.today")}
          </button>
        }
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label={t("dash.revenue")} value={money(stats?.revenue ?? 0)} delta="+12.4%" up icon={DollarSign} accent="primary" />
        <StatCard label={t("dash.sales")} value={num(stats?.orders ?? 0)} delta="+4.1%" up icon={ShoppingCart} accent="chart-2" />
        <StatCard label={t("dash.customers")} value={num(stats?.customers ?? 0)} delta="+2" up icon={Users} accent="chart-3" />
        <StatCard label={t("dash.alerts")} value={num(stats?.alerts ?? 0)} delta="0" up={false} icon={AlertTriangle} accent="warning" />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-3 lg:grid-cols-3">
        <div className="panel-elevated lg:col-span-2 p-5">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-foreground">{t("dash.revenue_trend")}</h3>
              <p className="text-xs text-muted-foreground">{t("dash.last_14_days")}</p>
            </div>
            <span className="rounded-md border border-border bg-surface px-2 py-0.5 text-[10px] text-muted-foreground">DEMO</span>
          </div>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={trend}>
                <defs>
                  <linearGradient id="g1" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="oklch(0.62 0.21 260)" stopOpacity={0.4} />
                    <stop offset="100%" stopColor="oklch(0.62 0.21 260)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="oklch(1 0 0 / 0.05)" vertical={false} />
                <XAxis dataKey="day" stroke="oklch(0.62 0.015 270)" fontSize={11} tickLine={false} axisLine={false} />
                <YAxis stroke="oklch(0.62 0.015 270)" fontSize={11} tickLine={false} axisLine={false} />
                <Tooltip
                  contentStyle={{
                    background: "oklch(0.18 0.007 270)", border: "1px solid oklch(1 0 0 / 0.08)",
                    borderRadius: 8, fontSize: 12,
                  }}
                />
                <Area type="monotone" dataKey="sales" stroke="oklch(0.62 0.21 260)" strokeWidth={2} fill="url(#g1)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="panel-elevated p-5">
          <h3 className="text-sm font-semibold text-foreground">{t("dash.top_products")}</h3>
          <p className="text-xs text-muted-foreground">{t("dash.last_30_days")}</p>
          <div className="mt-4 h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={trend.slice(0, 6)}>
                <CartesianGrid stroke="oklch(1 0 0 / 0.05)" vertical={false} />
                <XAxis dataKey="day" stroke="oklch(0.62 0.015 270)" fontSize={11} tickLine={false} axisLine={false} />
                <YAxis stroke="oklch(0.62 0.015 270)" fontSize={11} tickLine={false} axisLine={false} />
                <Tooltip contentStyle={{ background: "oklch(0.18 0.007 270)", border: "1px solid oklch(1 0 0 / 0.08)", borderRadius: 8, fontSize: 12 }} />
                <Bar dataKey="orders" fill="oklch(0.7 0.18 180)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="mt-6 panel-elevated p-5">
        <h3 className="text-sm font-semibold text-foreground">{t("dash.recent_sales")}</h3>
        <p className="mt-1 text-xs text-muted-foreground">{t("dash.empty")}</p>
        <div className="mt-6 grid place-items-center py-10 text-sm text-muted-foreground">
          <div className="rounded-md border border-dashed border-border bg-surface px-4 py-3">
            {t("dash.no_invoices_hint")}
          </div>
        </div>
      </div>
    </>
  );
}

function StatCard({
  label, value, delta, up, icon: Icon, accent,
}: {
  label: string; value: string; delta: string; up: boolean;
  icon: typeof DollarSign; accent: "primary" | "chart-2" | "chart-3" | "warning";
}) {
  const colorMap: Record<string, string> = {
    primary: "text-primary bg-primary/10",
    "chart-2": "text-chart-2 bg-chart-2/10",
    "chart-3": "text-chart-3 bg-chart-3/10",
    warning: "text-warning bg-warning/10",
  };
  return (
    <div className="panel-elevated p-4 relative overflow-hidden">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
          <p className="mt-2 text-2xl font-semibold tracking-tight text-foreground">{value}</p>
        </div>
        <div className={`grid h-8 w-8 place-items-center rounded-md ${colorMap[accent]}`}>
          <Icon className="h-4 w-4" />
        </div>
      </div>
function StatCardInner() { return null; }

function StatCardOuter() { return null; }


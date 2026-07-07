import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
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
      const [salesRes, customersRes, productsRes] = await Promise.all([
        supabase.from("sales_invoices").select("id, invoice_number, total, created_at, status, customers(name)").gte("created_at", since).order("created_at", { ascending: false }).limit(12),
        supabase.from("customers").select("id", { count: "exact", head: true }).eq("is_active", true),
        supabase.from("products").select("id, name, min_stock, inventory(quantity)").limit(100),
      ]);

      const sales = (salesRes.data ?? []) as any[];
      const totalRev = sales.reduce((a, b: any) => a + Number(b.total ?? 0), 0);
      const orderCount = sales.length;
      const alerts = (productsRes.data ?? []).filter((p: any) => {
        const stock = Number((p.inventory?.[0]?.quantity ?? 0) || 0);
        return stock <= Number(p.min_stock ?? 0);
      }).length;

      const recentSales = sales.map((s: any) => ({
        id: s.id,
        invoice_number: s.invoice_number,
        total: Number(s.total ?? 0),
        created_at: s.created_at,
        customer: s.customers?.name ?? "Walk-in",
      }));

      return {
        revenue: totalRev,
        orders: orderCount,
        customers: customersRes.count ?? 0,
        alerts,
        recentSales,
        sales,
      };
    },
  });

  const trend = useMemo(() => {
    const sales = (stats?.sales ?? []) as any[];
    return Array.from({ length: 14 }).map((_, i) => {
      const day = new Date();
      day.setDate(day.getDate() - (13 - i));
      const key = day.toISOString().slice(0, 10);
      const daySales = sales.filter((s: any) => s.created_at?.slice(0, 10) === key);
      return {
        day: day.toLocaleDateString("en", { month: "short", day: "numeric" }),
        sales: daySales.reduce((sum: number, s: any) => sum + Number(s.total ?? 0), 0),
        orders: daySales.length,
      };
    });
  }, [stats]);

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
        <p className="mt-1 text-xs text-muted-foreground">{t("dash.last_30_days")}</p>
        <div className="mt-4 space-y-2">
          {(stats?.recentSales ?? []).length > 0 ? (
            (stats?.recentSales ?? []).map((sale: any) => (
              <div key={sale.id} className="flex items-center justify-between rounded-lg border border-border bg-surface/70 px-3 py-2">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-foreground">{sale.invoice_number}</div>
                  <div className="truncate text-xs text-muted-foreground">{sale.customer}</div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-semibold text-foreground">{money(sale.total)}</div>
                  <div className="text-[11px] text-muted-foreground">{new Date(sale.created_at).toLocaleDateString()}</div>
                </div>
              </div>
            ))
          ) : (
            <div className="grid place-items-center rounded-lg border border-dashed border-border bg-surface px-4 py-10 text-sm text-muted-foreground">
              {t("dash.no_invoices_hint")}
            </div>
          )}
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
  const { t } = useI18n();
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
      <div className="mt-3 flex items-center gap-1 text-xs">
        {up ? <ArrowUpRight className="h-3.5 w-3.5 text-success" /> : <ArrowDownRight className="h-3.5 w-3.5 text-destructive" />}
        <span className={up ? "text-success" : "text-destructive"}>{delta}</span>
        <span className="text-muted-foreground">{t("dash.vs_last_period")}</span>
      </div>
    </div>
  );
}




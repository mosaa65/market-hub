import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/page-header";
import { useI18n } from "@/lib/i18n";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { money, num } from "@/lib/format";
import {
  AlertTriangle,
  PackageX,
  Users,
  Truck,
  Bell,
  CheckCircle2,
  Search,
  ArrowUpRight,
  Filter,
  RefreshCw,
  ShieldAlert,
} from "lucide-react";
import { VortexMetricCard } from "@/components/vortex-ui/finance/vortex-metric-card";
import { formatLuxuryDate } from "@/lib/format-preferences";

export const Route = createFileRoute("/_app/notifications")({
  head: () => ({ meta: [{ title: "Notifications — Vortex ERP" }] }),
  component: NotificationsPage,
});

interface AlertItem {
  id: string;
  kind: "out" | "low" | "debt_c" | "debt_s";
  title: string;
  sub: string;
  meta?: string;
  severity: "danger" | "warn" | "info";
  actionUrl: string;
  actionLabel: string;
}

function NotificationsPage() {
  const { t, lang } = useI18n();
  const isAr = lang === "ar";
  const [activeTab, setActiveTab] = useState<"all" | "danger" | "stock" | "finance">("all");
  const [searchQuery, setSearchQuery] = useState("");

  // Ultra-fast cached React Query with 60s stale time
  const {
    data: alerts = [],
    isLoading,
    isRefetching,
    refetch,
  } = useQuery({
    queryKey: ["vortex-system-notifications", lang],
    staleTime: 60_000,
    gcTime: 300_000,
    queryFn: async (): Promise<AlertItem[]> => {
      const [prodsRes, invRes, custsRes, suppsRes] = await Promise.all([
        supabase
          .from("products")
          .select("id,name,name_ar,min_stock")
          .eq("is_active", true)
          .limit(300),
        supabase.from("inventory").select("product_id,quantity"),
        supabase
          .from("customers")
          .select("id,name,balance,credit_limit")
          .gt("balance", 0)
          .order("balance", { ascending: false })
          .limit(50),
        supabase
          .from("suppliers")
          .select("id,name,balance")
          .gt("balance", 0)
          .order("balance", { ascending: false })
          .limit(50),
      ]);

      const stock = new Map<string, number>();
      (invRes.data ?? []).forEach((i: any) =>
        stock.set(i.product_id, (stock.get(i.product_id) ?? 0) + Number(i.quantity)),
      );

      const items: AlertItem[] = [];

      // Stock alerts
      (prodsRes.data ?? []).forEach((p: any) => {
        const q = stock.get(p.id) ?? 0;
        const min = Number(p.min_stock ?? 0);
        const name = isAr ? (p.name_ar ?? p.name) : p.name;
        if (q <= 0) {
          items.push({
            id: `out-${p.id}`,
            kind: "out",
            title: name,
            sub: isAr ? "نفد رصيد المخزون تماماً (0 متوفر)" : "Completely out of stock (0 on hand)",
            severity: "danger",
            actionUrl: "/inventory",
            actionLabel: isAr ? "طلب توريد" : "Order stock",
          });
        } else if (q <= min && min > 0) {
          items.push({
            id: `low-${p.id}`,
            kind: "low",
            title: name,
            sub: isAr
              ? `الكمية الحالية (${num(q)}) أقل من أو تساوي حد الأمان (${num(min)})`
              : `Quantity (${q}) ≤ safety limit (${min})`,
            severity: "warn",
            actionUrl: "/inventory",
            actionLabel: isAr ? "معاينة المخزون" : "Check stock",
          });
        }
      });

      // Customer debts
      (custsRes.data ?? []).forEach((c: any) => {
        const over = Number(c.credit_limit) > 0 && Number(c.balance) > Number(c.credit_limit);
        items.push({
          id: `cust-${c.id}`,
          kind: "debt_c",
          title: c.name,
          sub: over
            ? isAr
              ? `تجاوز الحد الائتماني المسموح (${money(Number(c.credit_limit))})`
              : `Exceeded credit limit (${money(Number(c.credit_limit))})`
            : isAr
              ? "مستحقات ذمم مدينة غير مسددة"
              : "Outstanding customer debt",
          meta: money(Number(c.balance)),
          severity: over ? "danger" : "info",
          actionUrl: "/debts",
          actionLabel: isAr ? "تحصيل الآن" : "Collect",
        });
      });

      // Supplier payables
      (suppsRes.data ?? []).forEach((s: any) => {
        items.push({
          id: `supp-${s.id}`,
          kind: "debt_s",
          title: s.name,
          sub: isAr ? "مستحقات للمورد واجبة السداد" : "Payable balance due to supplier",
          meta: money(Number(s.balance)),
          severity: "warn",
          actionUrl: "/settlements",
          actionLabel: isAr ? "سداد المورد" : "Settle",
        });
      });

      return items;
    },
  });

  const counts = useMemo(() => {
    return {
      total: alerts.length,
      danger: alerts.filter((a) => a.severity === "danger").length,
      stock: alerts.filter((a) => a.kind === "out" || a.kind === "low").length,
      finance: alerts.filter((a) => a.kind === "debt_c" || a.kind === "debt_s").length,
    };
  }, [alerts]);

  const filteredAlerts = useMemo(() => {
    return alerts.filter((alert) => {
      // Tab filter
      if (activeTab === "danger" && alert.severity !== "danger") return false;
      if (activeTab === "stock" && alert.kind !== "out" && alert.kind !== "low") return false;
      if (activeTab === "finance" && alert.kind !== "debt_c" && alert.kind !== "debt_s")
        return false;

      // Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        return (
          alert.title.toLowerCase().includes(q) ||
          alert.sub.toLowerCase().includes(q) ||
          (alert.meta && alert.meta.toLowerCase().includes(q))
        );
      }
      return true;
    });
  }, [alerts, activeTab, searchQuery]);

  return (
    <div className="space-y-6 pb-12">
      <PageHeader
        title={t("notifications.title")}
        subtitle={
          isAr
            ? "مركز التنبيهات الذكي لرصد المخزون الحرج والذمم المالية المستحقة"
            : "Smart alert hub for critical stock and outstanding balances"
        }
        actions={
          <button
            onClick={() => refetch()}
            disabled={isRefetching}
            className="inline-flex h-9 items-center gap-1.5 rounded-full border border-border/80 bg-card px-3.5 text-xs font-semibold text-foreground hover:bg-surface-2 transition shadow-xs active:scale-95 disabled:opacity-50"
          >
            <RefreshCw
              className={`size-3.5 text-muted-foreground ${isRefetching ? "animate-spin" : ""}`}
            />
            <span>{isAr ? "تحديث التنبيهات" : "Refresh"}</span>
          </button>
        }
      />

      {/* KPI Cards Grid - Mobile 2-cols */}
      <div className="grid grid-cols-2 gap-2.5 sm:gap-4 lg:grid-cols-4">
        <div onClick={() => setActiveTab("danger")} className="cursor-pointer">
          <VortexMetricCard
            title={isAr ? "تنبيهات حرجة" : "Critical Alerts"}
            value={num(counts.danger)}
            subtitle={isAr ? "تحتاج تدخل فوري" : "Requires urgent action"}
            badge={isAr ? "عاجل" : "Urgent"}
            currency=""
            icon={<ShieldAlert className="size-5" />}
            iconClassName="bg-rose-500/10 text-rose-600 dark:text-rose-400"
            highlight={activeTab === "danger"}
          />
        </div>

        <div onClick={() => setActiveTab("stock")} className="cursor-pointer">
          <VortexMetricCard
            title={isAr ? "نواقص المخزون" : "Stock Warnings"}
            value={num(counts.stock)}
            subtitle={isAr ? "أصناف نفدت أو قاربت" : "Low or out of stock"}
            currency=""
            icon={<PackageX className="size-5" />}
            iconClassName="bg-amber-500/10 text-amber-600 dark:text-amber-400"
            highlight={activeTab === "stock"}
          />
        </div>

        <div onClick={() => setActiveTab("finance")} className="cursor-pointer">
          <VortexMetricCard
            title={isAr ? "الذمم والديون" : "Financial Debts"}
            value={num(counts.finance)}
            subtitle={isAr ? "مستحقات عملاء وموردين" : "Receivables & payables"}
            currency=""
            icon={<Users className="size-5" />}
            iconClassName="bg-primary/10 text-primary"
            highlight={activeTab === "finance"}
          />
        </div>

        <div onClick={() => setActiveTab("all")} className="cursor-pointer">
          <VortexMetricCard
            title={isAr ? "إجمالي التنبيهات" : "Total Alerts"}
            value={num(counts.total)}
            subtitle={isAr ? "جميع الإخطارات النشطة" : "All active notices"}
            currency=""
            icon={<Bell className="size-5" />}
            iconClassName="bg-cyan-500/10 text-cyan-600 dark:text-cyan-400"
            highlight={activeTab === "all"}
          />
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 rounded-2xl border border-border/80 bg-card p-3 shadow-xs">
        {/* Tabs */}
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            onClick={() => setActiveTab("all")}
            className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold transition-all ${
              activeTab === "all"
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:bg-surface-2 hover:text-foreground"
            }`}
          >
            <span>{isAr ? "الكل" : "All"}</span>
            <span className="rounded-full bg-black/10 dark:bg-white/10 px-1.5 py-0.2 text-[10px] font-mono">
              {num(counts.total)}
            </span>
          </button>

          <button
            onClick={() => setActiveTab("danger")}
            className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold transition-all ${
              activeTab === "danger"
                ? "bg-rose-600 text-white shadow-sm"
                : "text-muted-foreground hover:bg-surface-2 hover:text-foreground"
            }`}
          >
            <span>{isAr ? "حرجة وعاجلة" : "Critical"}</span>
            {counts.danger > 0 && (
              <span className="rounded-full bg-rose-500/20 text-rose-500 dark:text-rose-300 px-1.5 py-0.2 text-[10px] font-mono">
                {num(counts.danger)}
              </span>
            )}
          </button>

          <button
            onClick={() => setActiveTab("stock")}
            className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold transition-all ${
              activeTab === "stock"
                ? "bg-amber-600 text-white shadow-sm"
                : "text-muted-foreground hover:bg-surface-2 hover:text-foreground"
            }`}
          >
            <span>{isAr ? "المخزون" : "Stock"}</span>
            <span className="rounded-full bg-black/10 dark:bg-white/10 px-1.5 py-0.2 text-[10px] font-mono">
              {num(counts.stock)}
            </span>
          </button>

          <button
            onClick={() => setActiveTab("finance")}
            className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold transition-all ${
              activeTab === "finance"
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:bg-surface-2 hover:text-foreground"
            }`}
          >
            <span>{isAr ? "المالية والديون" : "Finance"}</span>
            <span className="rounded-full bg-black/10 dark:bg-white/10 px-1.5 py-0.2 text-[10px] font-mono">
              {num(counts.finance)}
            </span>
          </button>
        </div>

        {/* Quick Search */}
        <div className="relative min-w-[200px] sm:min-w-[260px]">
          <Search className="absolute start-3 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={isAr ? "بحث في التنبيهات..." : "Search alerts..."}
            className="w-full rounded-xl border border-border/80 bg-surface-2/60 ps-8 pe-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/30 transition"
          />
        </div>
      </div>

      {/* Notifications List Container */}
      <div className="overflow-hidden rounded-3xl border border-border/80 bg-card shadow-sm">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-3">
            <RefreshCw className="size-6 animate-spin text-primary" />
            <span className="text-xs font-medium">
              {isAr ? "جاري فحص مؤشرات النظام والتنبيهات..." : "Checking system alerts..."}
            </span>
          </div>
        ) : filteredAlerts.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="grid size-14 place-items-center rounded-2xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 mb-3 shadow-inner">
              <CheckCircle2 className="size-7" />
            </div>
            <h3 className="text-base font-bold text-foreground">
              {isAr ? "لا توجد تنبيهات في هذا القسم" : "All clear in this section"}
            </h3>
            <p className="mt-1 text-xs text-muted-foreground max-w-sm">
              {isAr
                ? "كافة مؤشرات المخزون والذمم المالية ضمن الحدود الطبيعية المستقرة."
                : "All stock and receivables indicators are operating within normal limits."}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-border/60">
            {filteredAlerts.map((alert) => {
              const isDanger = alert.severity === "danger";
              const isWarn = alert.severity === "warn";

              return (
                <div
                  key={alert.id}
                  className="group flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 sm:p-4 hover:bg-surface-2/50 transition-all duration-150"
                >
                  <div className="flex items-start gap-3 min-w-0 flex-1">
                    {/* Severity Icon */}
                    <div
                      className={`grid size-10 shrink-0 place-items-center rounded-2xl shadow-xs transition-transform duration-200 group-hover:scale-105 ${
                        isDanger
                          ? "bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20"
                          : isWarn
                            ? "bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20"
                            : "bg-primary/10 text-primary border border-primary/20"
                      }`}
                    >
                      {alert.kind === "out" ? (
                        <PackageX className="size-5" />
                      ) : alert.kind === "low" ? (
                        <AlertTriangle className="size-5" />
                      ) : alert.kind === "debt_c" ? (
                        <Users className="size-5" />
                      ) : (
                        <Truck className="size-5" />
                      )}
                    </div>

                    {/* Alert Text Details */}
                    <div className="min-w-0 flex-1 space-y-0.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs sm:text-sm font-bold text-foreground truncate">
                          {alert.title}
                        </span>
                        <span
                          className={`rounded-full px-2 py-0.5 text-[9px] sm:text-[10px] font-bold ${
                            isDanger
                              ? "bg-rose-500/15 text-rose-600 dark:text-rose-400"
                              : isWarn
                                ? "bg-amber-500/15 text-amber-700 dark:text-amber-300"
                                : "bg-primary/15 text-primary"
                          }`}
                        >
                          {alert.kind === "out"
                            ? isAr
                              ? "نفاد مخزون"
                              : "Out of stock"
                            : alert.kind === "low"
                              ? isAr
                                ? "حد أمان"
                                : "Low stock"
                              : alert.kind === "debt_c"
                                ? isAr
                                  ? "ذمم عملاء"
                                  : "Customer Debt"
                                : isAr
                                  ? "ذمم موردين"
                                  : "Supplier Payable"}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground leading-relaxed">{alert.sub}</p>
                    </div>
                  </div>

                  {/* Right side: Amount Meta & Action Button */}
                  <div className="flex items-center justify-between sm:justify-end gap-3 pt-2 sm:pt-0 border-t sm:border-t-0 border-border/40 shrink-0">
                    {alert.meta && (
                      <span className="font-mono font-bold text-xs sm:text-sm text-foreground bg-surface-2 px-2.5 py-1 rounded-xl border border-border/70">
                        {alert.meta}
                      </span>
                    )}

                    <Link
                      to={alert.actionUrl}
                      className="inline-flex h-8 items-center gap-1.5 rounded-xl border border-border/80 bg-surface px-3 text-xs font-semibold text-foreground hover:bg-primary hover:text-primary-foreground hover:border-primary transition-all active:scale-95 shadow-xs"
                    >
                      <span>{alert.actionLabel}</span>
                      <ArrowUpRight className="size-3.5" />
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

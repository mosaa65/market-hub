/**
 * /milling/performance — تقرير أداء قسم الطحن الشهري (V4).
 *
 * المعتمد من المالك (rebuild-plan-v2-product-count.md §8 V4):
 *   • إيراد أجور الطحن: من مستندات خدمة الطحن وفواتيرها المرتبطة (بلا COGS).
 *   • الكميات المطحونة: من دفتر الأمانات (MILLING kg_out) شهرياً.
 *   • مصروفات القسم: من وحدة المصروفات (أجور/مستلزمات تعبئة/غاز/صيانة) شهرياً.
 *   • صافي القسم = إيراد الأجور − مصروفات القسم.
 *
 * مستوى العرض: بطاقات KPI + جدول شهري + تفصيل بالعملاء.
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import {
  BarChart3,
  ArrowLeft,
  Coins,
  Scale,
  Wallet,
  TrendingUp,
  Users,
  RefreshCw,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

/** نفس Escape hatch الموثّد في lib/milling/custody.ts — جداول الطحن خارج أنواع العميل الضيقة. */
const db = supabase as any;
import { PageHeader } from "@/components/page-header";
import { ModuleGuard } from "@/lib/modules";
import {
  MillingPanel,
  MillingSectionTitle,
  MillingSelect,
  MillingEmpty,
  fmtNum,
} from "@/components/milling/milling-ui";
import { getCompanyCurrencySymbol } from "@/lib/format";

export const Route = createFileRoute("/_app/milling/performance")({
  head: () => ({ meta: [{ title: "تقرير أداء قسم الطحن — فورتكس ERP" }] }),
  component: MillingPerformancePage,
});

interface CustomerOption {
  id: string;
  name: string;
}

interface DocRow {
  id: string;
  created_at: string;
  billing_basis: string | null;
  fee_quantity: number | null;
  fee_per_unit: number | null;
  customer_id: string | null;
  customers: { name: string } | null;
  sales_invoices: { total: number | null; discount: number | null } | null;
}

interface LedgerRow {
  kg_out: number | null;
  bags_out: number | null;
  created_at: string;
}

interface ExpenseRow {
  amount: number | null;
  expense_date: string | null;
  created_at: string;
  expense_categories: { name: string; name_ar: string } | null;
}

/** مفتاح الشهر YYYY-MM */
function monthKey(dateStr: string | null | undefined): string {
  return (dateStr || "").slice(0, 7);
}

function monthLabel(key: string): string {
  if (!/^\d{4}-\d{2}$/.test(key)) return key;
  const [y, m] = key.split("-").map(Number);
  const months = [
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
  return `${months[m - 1] ?? m} ${y}`;
}

interface MonthAgg {
  key: string;
  docCount: number;
  feeRevenue: number;
  milledKg: number;
  milledBags: number;
  expenses: number;
}

interface CustomerAgg {
  name: string;
  docCount: number;
  feeRevenue: number;
  milledKg: number;
}

function MillingPerformancePage() {
  const currency = useMemo(() => getCompanyCurrencySymbol(), []);
  // الافتراضي: آخر 12 شهراً
  const [monthsBack, setMonthsBack] = useState("12");
  const [customerFilter, setCustomerFilter] = useState("");

  const cutoff = useMemo(() => {
    const d = new Date();
    d.setMonth(d.getMonth() - (Number(monthsBack) || 12));
    return d.toISOString().slice(0, 10);
  }, [monthsBack]);

  const customers = useQuery({
    queryKey: ["milling", "perf-customers"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("customers")
        .select("id, name")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return (data ?? []) as CustomerOption[];
    },
  });

  // 1) مستندات خدمة الطحن + فواتير الأجور المرتبطة
  const docs = useQuery({
    queryKey: ["milling", "perf-docs", customerFilter],
    queryFn: async () => {
      let q = db
        .from("milling_service_documents")
        .select(
          `id, created_at, billing_basis, fee_quantity, fee_per_unit, customer_id,
           customers(name), sales_invoices(total, discount)`,
        )
        .gte("created_at", cutoff)
        .order("created_at", { ascending: true });
      if (customerFilter) q = q.eq("customer_id", customerFilter);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as unknown as DocRow[];
    },
  });

  // 2) الكميات المطحونة من دفتر الأمانات (حركات MILLING)
  const ledger = useQuery({
    queryKey: ["milling", "perf-ledger", customerFilter],
    queryFn: async () => {
      let q = db
        .from("custody_ledger")
        .select("kg_out, bags_out, created_at, customer_id")
        .eq("entry_type", "MILLING")
        .gte("created_at", cutoff);
      if (customerFilter) q = q.eq("customer_id", customerFilter);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as unknown as (LedgerRow & { customer_id: string })[];
    },
  });

  // 3) مصروفات القسم (كل المصروفات — القرار: مستهلكات القسم مصروفات)
  const expenses = useQuery({
    queryKey: ["milling", "perf-expenses"],
    queryFn: async () => {
      const { data, error } = await db
        .from("expenses")
        .select("amount, expense_date, created_at, expense_categories(name, name_ar)")
        .gte("created_at", cutoff)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as ExpenseRow[];
    },
  });

  const monthly = useMemo<MonthAgg[]>(() => {
    const map = new Map<string, MonthAgg>();
    const ensure = (key: string) => {
      let m = map.get(key);
      if (!m) {
        m = { key, docCount: 0, feeRevenue: 0, milledKg: 0, milledBags: 0, expenses: 0 };
        map.set(key, m);
      }
      return m;
    };

    for (const d of docs.data ?? []) {
      const m = ensure(monthKey(d.created_at));
      m.docCount += 1;
      const inv = d.sales_invoices;
      m.feeRevenue += Number(inv?.total ?? 0) - Number(inv?.discount ?? 0);
    }
    for (const r of ledger.data ?? []) {
      const m = ensure(monthKey(r.created_at));
      m.milledKg += Number(r.kg_out ?? 0);
      m.milledBags += Number(r.bags_out ?? 0);
    }
    for (const e of expenses.data ?? []) {
      const m = ensure(monthKey(e.expense_date || e.created_at));
      m.expenses += Number(e.amount ?? 0);
    }

    return [...map.values()].sort((a, b) => a.key.localeCompare(b.key));
  }, [docs.data, ledger.data, expenses.data]);

  const totals = useMemo(() => {
    const t = monthly.reduce(
      (acc, m) => ({
        docCount: acc.docCount + m.docCount,
        feeRevenue: acc.feeRevenue + m.feeRevenue,
        milledKg: acc.milledKg + m.milledKg,
        milledBags: acc.milledBags + m.milledBags,
        expenses: acc.expenses + m.expenses,
      }),
      { docCount: 0, feeRevenue: 0, milledKg: 0, milledBags: 0, expenses: 0 },
    );
    return { ...t, net: t.feeRevenue - t.expenses };
  }, [monthly]);

  const byCustomer = useMemo<CustomerAgg[]>(() => {
    const map = new Map<string, CustomerAgg>();
    for (const d of docs.data ?? []) {
      const name = d.customers?.name || "—";
      let c = map.get(name);
      if (!c) {
        c = { name, docCount: 0, feeRevenue: 0, milledKg: 0 };
        map.set(name, c);
      }
      c.docCount += 1;
      c.feeRevenue +=
        Number(d.sales_invoices?.total ?? 0) - Number(d.sales_invoices?.discount ?? 0);
    }
    for (const r of ledger.data ?? []) {
      // الربط بالاسم عبر docs إن وُجد، وإلا نتركه في "—"
    }
    return [...map.values()].sort((a, b) => b.feeRevenue - a.feeRevenue).slice(0, 10);
  }, [docs.data, ledger.data]);

  const isLoading = docs.isLoading || ledger.isLoading || expenses.isLoading;

  return (
    <ModuleGuard moduleId="milling_operations">
      <div className="mx-auto max-w-7xl space-y-4 p-4">
        <PageHeader
          title="تقرير أداء قسم الطحن"
          subtitle="إيراد أجور الطحن، الكميات المطحونة، ومصروفات القسم — شهرياً وبدون أي احتساب من سعة العبوة (V4)."
          actions={
            <div className="flex items-center gap-2">
              <MillingSelect
                value={monthsBack}
                onChange={(e) => setMonthsBack(e.target.value)}
                className="font-bold text-xs"
              >
                <option value="3">آخر 3 أشهر</option>
                <option value="6">آخر 6 أشهر</option>
                <option value="12">آخر 12 شهراً</option>
                <option value="36">آخر 3 سنوات</option>
              </MillingSelect>
              <MillingSelect
                value={customerFilter}
                onChange={(e) => setCustomerFilter(e.target.value)}
                className="font-bold text-xs"
              >
                <option value="">كل العملاء</option>
                {(customers.data ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </MillingSelect>
              <Link
                to="/milling/milling"
                className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-card px-3.5 py-2 text-xs font-bold text-foreground shadow-xs transition hover:bg-muted"
              >
                شاشة الطحن <ArrowLeft className="h-3.5 w-3.5" />
              </Link>
            </div>
          }
        />

        {isLoading ? (
          <MillingPanel>
            <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
              <RefreshCw className="h-4 w-4 animate-spin" />
              جارٍ جمع بيانات الأداء…
            </div>
          </MillingPanel>
        ) : monthly.length === 0 ? (
          <MillingPanel>
            <MillingEmpty
              title="لا توجد بيانات في الفترة"
              hint="لم تُسجل مستندات طحن أو مصروفات في الفترة المحددة."
            />
          </MillingPanel>
        ) : (
          <>
            {/* بطاقات KPI */}
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <KpiCard
                icon={<Coins className="h-4 w-4" />}
                label="إيراد أجور الطحن"
                value={`${fmtNum(totals.feeRevenue)} ${currency}`}
                tone="amber"
              />
              <KpiCard
                icon={<BarChart3 className="h-4 w-4" />}
                label="عدد مستندات الطحن"
                value={fmtNum(totals.docCount)}
                tone="blue"
              />
              <KpiCard
                icon={<Scale className="h-4 w-4" />}
                label="الكميات المطحونة"
                value={`${fmtNum(totals.milledKg)} كجم`}
                sub={`${fmtNum(totals.milledBags)} كيس`}
                tone="green"
              />
              <KpiCard
                icon={<Wallet className="h-4 w-4" />}
                label="مصروفات الفترة"
                value={`${fmtNum(totals.expenses)} ${currency}`}
                tone="rose"
              />
              <KpiCard
                icon={<TrendingUp className="h-4 w-4" />}
                label="صافي القسم (إيراد − مصروفات)"
                value={`${fmtNum(totals.net)} ${currency}`}
                tone={totals.net >= 0 ? "green" : "rose"}
              />
            </div>

            {/* الجدول الشهري */}
            <MillingPanel>
              <MillingSectionTitle
                icon={<BarChart3 className="h-4 w-4" />}
                title="الأداء الشهري"
                subtitle="إيراد الأجور من فواتير خدمة الطحن، والمصروفات من وحدة المصروفات"
              />
              <div className="overflow-x-auto p-4">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border text-muted-foreground">
                      <th className="py-2 text-right font-semibold">الشهر</th>
                      <th className="py-2 text-left font-semibold">المستندات</th>
                      <th className="py-2 text-left font-semibold">إيراد الأجور</th>
                      <th className="py-2 text-left font-semibold">كجم مطحون</th>
                      <th className="py-2 text-left font-semibold">أكياس مطحونة</th>
                      <th className="py-2 text-left font-semibold">المصروفات</th>
                      <th className="py-2 text-left font-semibold">الصافي</th>
                    </tr>
                  </thead>
                  <tbody>
                    {monthly.map((m) => {
                      const net = m.feeRevenue - m.expenses;
                      return (
                        <tr key={m.key} className="border-b border-border/50 hover:bg-muted/30">
                          <td className="py-2 text-right font-bold text-foreground">
                            {monthLabel(m.key)}
                          </td>
                          <td className="py-2 text-left tabular-nums">{fmtNum(m.docCount)}</td>
                          <td className="py-2 text-left tabular-nums text-amber-700 dark:text-amber-400">
                            {fmtNum(m.feeRevenue)}
                          </td>
                          <td className="py-2 text-left tabular-nums">{fmtNum(m.milledKg)}</td>
                          <td className="py-2 text-left tabular-nums">{fmtNum(m.milledBags)}</td>
                          <td className="py-2 text-left tabular-nums text-rose-700 dark:text-rose-400">
                            {fmtNum(m.expenses)}
                          </td>
                          <td
                            className={`py-2 text-left font-bold tabular-nums ${
                              net >= 0
                                ? "text-emerald-700 dark:text-emerald-400"
                                : "text-rose-700 dark:text-rose-400"
                            }`}
                          >
                            {fmtNum(net)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </MillingPanel>

            {/* تفصيل بالعملاء */}
            {!customerFilter && byCustomer.length > 0 && (
              <MillingPanel>
                <MillingSectionTitle
                  icon={<Users className="h-4 w-4" />}
                  title="أعلى العملاء بإيراد الأجور"
                  subtitle="أكبر 10 عملاء خلال الفترة"
                />
                <div className="grid gap-2 p-4 sm:grid-cols-2">
                  {byCustomer.map((c) => (
                    <div
                      key={c.name}
                      className="flex items-center justify-between rounded-xl border border-border/70 bg-card p-3 text-xs"
                    >
                      <div>
                        <span className="block font-bold text-foreground">{c.name}</span>
                        <span className="text-[11px] text-muted-foreground">
                          {fmtNum(c.docCount)} مستند
                        </span>
                      </div>
                      <span className="font-black tabular-nums text-amber-700 dark:text-amber-400">
                        {fmtNum(c.feeRevenue)} {currency}
                      </span>
                    </div>
                  ))}
                </div>
              </MillingPanel>
            )}
          </>
        )}
      </div>
    </ModuleGuard>
  );
}

function KpiCard({
  icon,
  label,
  value,
  sub,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  tone: "amber" | "blue" | "green" | "rose";
}) {
  const tones: Record<string, string> = {
    amber: "border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-300",
    blue: "border-blue-500/30 bg-blue-500/5 text-blue-700 dark:text-blue-300",
    green: "border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300",
    rose: "border-rose-500/30 bg-rose-500/5 text-rose-700 dark:text-rose-300",
  };
  return (
    <div className={`rounded-2xl border p-4 ${tones[tone]}`}>
      <div className="flex items-center gap-2 text-xs font-semibold opacity-80">
        {icon}
        <span>{label}</span>
      </div>
      <div className="mt-1 text-lg font-black tabular-nums">{value}</div>
      {sub && <div className="text-[11px] opacity-70 tabular-nums">{sub}</div>}
    </div>
  );
}

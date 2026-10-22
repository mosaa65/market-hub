import { ModuleGuard, useModules } from "@/lib/modules";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/page-header";
import { useI18n } from "@/lib/i18n";
import { supabase } from "@/integrations/supabase/client";
import { money } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { ActionButton } from "@/components/ui/action-button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Plus,
  TrendingUp,
  TrendingDown,
  Wallet,
  Receipt,
  Users,
  Truck,
  Eye,
  ArrowUpRight,
  CircleDollarSign,
  RefreshCw,
} from "lucide-react";
import { ExpenseFormDialog } from "@/components/expenses/expense-form";
import { ExpenseDetailDrawer } from "@/components/expenses/expense-detail-drawer";
import {
  ExpenseStatusBadge,
  ExpensePaymentBadge,
} from "@/components/expenses/expense-status-badge";
import { useExpenseLookups } from "@/hooks/use-expenses";
import { fetchUnifiedExpenseStats } from "@/lib/expenses/financial-bridge";
import type { ExpenseListRow } from "@/lib/expenses/types";

export const Route = createFileRoute("/_app/finance")({
  head: () => ({ meta: [{ title: "Finance — Vortex ERP" }] }),
  component: () => (
    <ModuleGuard moduleId="expenses">
      <FinancePage />
    </ModuleGuard>
  ),
});

interface Stats {
  salesTotal: number;
  salesPaid: number;
  purchasesTotal: number;
  purchasesPaid: number;
  receivables: number;
  payables: number;
  expensesTotal: number;
  cashIn: number;
  cashOut: number;
}

function FinancePage() {
  const { isModuleEnabled } = useModules();
  const { t, lang } = useI18n();
  const ar = lang === "ar";

  const [stats, setStats] = useState<Stats | null>(null);
  const [expenses, setExpenses] = useState<ExpenseListRow[]>([]);
  const [debtors, setDebtors] = useState<any[]>([]);
  const [creditors, setCreditors] = useState<any[]>([]);

  // Dialog and drawer states
  const [formOpen, setFormOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);

  const lookups = useExpenseLookups();

  const load = useCallback(async () => {
    const [sales, purchases, expRes, expenseStats, custs, supps] = await Promise.all([
      supabase
        .from("sales_invoices")
        .select("total,paid,payment_method")
        .order("created_at", { ascending: false })
        .limit(3000),
      supabase
        .from("purchase_invoices")
        .select("total,paid,payment_method")
        .order("created_at", { ascending: false })
        .limit(3000),
      (supabase as any).rpc("list_expenses", { p_limit: 50 }),
      fetchUnifiedExpenseStats(),
      supabase
        .from("customers")
        .select("id,name,balance")
        .gt("balance", 0)
        .order("balance", { ascending: false })
        .limit(20),
      supabase
        .from("suppliers")
        .select("id,name,balance")
        .gt("balance", 0)
        .order("balance", { ascending: false })
        .limit(20),
    ]);

    const s = sales.data ?? [];
    const p = purchases.data ?? [];
    const salesTotal = s.reduce((a, r: any) => a + Number(r.total || 0), 0);
    const salesPaid = s.reduce((a, r: any) => a + Number(r.paid || 0), 0);
    const purchasesTotal = p.reduce((a, r: any) => a + Number(r.total || 0), 0);
    const purchasesPaid = p.reduce((a, r: any) => a + Number(r.paid || 0), 0);

    // Accrual expense is recognized total; Cash out includes actual paid amount
    const expensesTotal = expenseStats.postedTotal;
    const expenseCashPaid = expenseStats.paidCashOut;

    setStats({
      salesTotal,
      salesPaid,
      purchasesTotal,
      purchasesPaid,
      receivables: salesTotal - salesPaid,
      payables: purchasesTotal - purchasesPaid + expenseStats.outstandingTotal,
      expensesTotal,
      cashIn: salesPaid,
      cashOut: purchasesPaid + expenseCashPaid,
    });

    setExpenses((expRes.data ?? []) as ExpenseListRow[]);
    setDebtors(custs.data ?? []);
    setCreditors(supps.data ?? []);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleOpenDetail = (id: string) => {
    setSelectedEntryId(id);
    setDetailOpen(true);
  };

  const netCash = useMemo(() => (stats ? stats.cashIn - stats.cashOut : 0), [stats]);
  const grossProfit = useMemo(() => (stats ? stats.salesTotal - stats.purchasesTotal : 0), [stats]);
  const netProfit = useMemo(() => grossProfit - (stats?.expensesTotal ?? 0), [grossProfit, stats]);

  return (
    <>
      <PageHeader
        title={t("finance.title")}
        subtitle={
          ar
            ? "الذمم، التدفق النقدي، المصروفات والأرباح الموحدة"
            : "Receivables, payables, cashflow and profit"
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Link to="/expenses">
              <ActionButton tone="outline" size="sm" icon={<Receipt />}>
                {ar ? "سجل المصروفات الكامل" : "Expense register"}
              </ActionButton>
            </Link>
            <ActionButton size="sm" icon={<Plus />} onClick={() => setFormOpen(true)}>
              {ar ? "مصروف جديد" : "New expense"}
            </ActionButton>
          </div>
        }
      />

      <div className="flex flex-col">
        <section className="order-2 mb-5 rounded-3xl border border-border/70 bg-gradient-to-br from-primary/[0.08] via-card to-card p-4 shadow-sm sm:p-5">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 text-sm font-bold text-foreground">
                <span className="grid size-8 place-items-center rounded-xl bg-primary/12 text-primary">
                  <CircleDollarSign className="size-4" />
                </span>
                {ar ? "ملخص الوضع المالي" : "Financial overview"}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {ar
                  ? "نظرة سريعة على حركة المنشأة وأهم الأرقام الحالية"
                  : "A quick view of the business cash and performance"}
              </p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="size-9 rounded-xl"
              onClick={() => void load()}
              title={ar ? "تحديث البيانات" : "Refresh data"}
            >
              <RefreshCw className="size-4" />
            </Button>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              icon={<TrendingUp className="h-4 w-4" />}
              label={ar ? "الإيرادات" : "Revenue"}
              value={money(stats?.salesTotal ?? 0)}
              tone="pos"
            />
            <StatCard
              icon={<Receipt className="h-4 w-4" />}
              label={ar ? "المصروفات المرحلة" : "Expenses"}
              value={money(stats?.expensesTotal ?? 0)}
              tone="neg"
            />
            <StatCard
              icon={<Wallet className="h-4 w-4" />}
              label={ar ? "صافي الربح" : "Net profit"}
              value={money(netProfit)}
              tone={netProfit >= 0 ? "pos" : "neg"}
            />
            <StatCard
              icon={<TrendingUp className="h-4 w-4" />}
              label={ar ? "صافي النقدية" : "Net cash"}
              value={money(netCash)}
              tone={netCash >= 0 ? "pos" : "neg"}
            />
          </div>
        </section>

        <div className="order-3 mb-6 grid grid-cols-2 gap-3 xl:grid-cols-4">
          <StatCard
            icon={<TrendingDown className="h-4 w-4" />}
            label={ar ? "المشتريات" : "Purchases"}
            value={money(stats?.purchasesTotal ?? 0)}
            tone="neg"
          />
          <StatCard
            icon={<Users className="h-4 w-4" />}
            label={ar ? "ذمم مدينة" : "Receivables"}
            value={money(stats?.receivables ?? 0)}
            tone="warn"
          />
          <StatCard
            icon={<Truck className="h-4 w-4" />}
            label={ar ? "ذمم دائنة شاملة" : "Payables"}
            value={money(stats?.payables ?? 0)}
            tone="warn"
          />
          <StatCard
            icon={<TrendingUp className="h-4 w-4" />}
            label={ar ? "النقد الداخل" : "Cash in"}
            value={money(stats?.cashIn ?? 0)}
            tone="pos"
          />
          <StatCard
            icon={<TrendingDown className="h-4 w-4" />}
            label={ar ? "النقد الخارج" : "Cash out"}
            value={money(stats?.cashOut ?? 0)}
            tone="neg"
          />
        </div>

        <Tabs defaultValue="expenses" className="order-1 mb-6">
          <TabsList className="mb-4 h-auto w-full justify-start gap-1 overflow-x-auto rounded-2xl border border-border/70 bg-muted/40 p-1">
            <TabsTrigger value="expenses">{ar ? "المصروفات" : "Expenses"}</TabsTrigger>
            {isModuleEnabled("payments") && (
              <TabsTrigger value="debtors">{ar ? "العملاء المدينون" : "Debtors"}</TabsTrigger>
            )}
            {isModuleEnabled("purchases") && (
              <TabsTrigger value="creditors">{ar ? "الموردون الدائنون" : "Creditors"}</TabsTrigger>
            )}
          </TabsList>

          <TabsContent value="expenses" className="mt-0">
            <Card className="overflow-hidden rounded-3xl border-border/70 shadow-sm">
              <CardHeader className="flex flex-row items-center justify-between gap-3 border-b border-border/60 py-4">
                <CardTitle className="text-base">
                  {ar ? "آخر المصروفات المسجلة" : "Recent expenses"}
                </CardTitle>
                <Link to="/expenses">
                  <Button variant="ghost" size="sm" className="text-xs">
                    {ar ? "عرض السجل التفصيلي" : "View full register"}
                    <ArrowUpRight className="h-3.5 w-3.5 ms-1" />
                  </Button>
                </Link>
              </CardHeader>
              <CardContent className="overflow-x-auto p-0">
                <Table className="min-w-[760px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead>{ar ? "المرجع" : "Reference"}</TableHead>
                      <TableHead>{ar ? "التاريخ" : "Date"}</TableHead>
                      <TableHead>{ar ? "التصنيف / الوصف" : "Category / Description"}</TableHead>
                      <TableHead>{ar ? "الحالة" : "Status"}</TableHead>
                      <TableHead>{ar ? "السداد" : "Settlement"}</TableHead>
                      <TableHead className="text-end">
                        {ar ? "المبلغ الإجمالي" : "Total amount"}
                      </TableHead>
                      <TableHead className="text-end">{ar ? "المتبقي" : "Remaining"}</TableHead>
                      <TableHead className="w-12"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {expenses.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                          {ar ? "لا توجد مصروفات مسجلة" : "No expenses yet"}
                        </TableCell>
                      </TableRow>
                    ) : (
                      expenses.map((e) => (
                        <TableRow
                          key={e.id}
                          className="cursor-pointer hover:bg-muted/50"
                          onClick={() => handleOpenDetail(e.id)}
                        >
                          <TableCell className="font-mono text-xs font-semibold text-primary">
                            {e.reference}
                          </TableCell>
                          <TableCell className="font-mono text-xs">{e.expense_date}</TableCell>
                          <TableCell>
                            <div className="font-medium text-xs">
                              {ar
                                ? e.primary_category_ar || e.primary_category || "—"
                                : e.primary_category || "—"}
                            </div>
                            {e.description ? (
                              <div className="text-[11px] text-muted-foreground truncate max-w-[240px]">
                                {e.description}
                              </div>
                            ) : null}
                          </TableCell>
                          <TableCell>
                            <ExpenseStatusBadge status={e.status} />
                          </TableCell>
                          <TableCell>
                            <ExpensePaymentBadge
                              paid={Number(e.paid_amount || 0)}
                              total={Number(e.total_amount || 0)}
                              status={e.status}
                            />
                          </TableCell>
                          <TableCell className="text-end font-mono font-medium">
                            {money(Number(e.total_amount || 0))}
                          </TableCell>
                          <TableCell className="text-end font-mono text-xs text-muted-foreground">
                            {Number(e.remaining_amount || 0) > 0.005 ? (
                              <span className="text-amber-600 font-semibold">
                                {money(Number(e.remaining_amount || 0))}
                              </span>
                            ) : (
                              <span className="text-emerald-600">—</span>
                            )}
                          </TableCell>
                          <TableCell onClick={(ev) => ev.stopPropagation()}>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="size-7"
                              onClick={() => handleOpenDetail(e.id)}
                              title={ar ? "معاينة المستند" : "View document"}
                            >
                              <Eye className="h-3.5 w-3.5" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="debtors">
            <BalanceTable
              rows={debtors}
              emptyMsg={ar ? "لا توجد ذمم مدينة" : "No outstanding debtors"}
              ar={ar}
            />
          </TabsContent>
          <TabsContent value="creditors">
            <BalanceTable
              rows={creditors}
              emptyMsg={ar ? "لا توجد ذمم دائنة" : "No outstanding creditors"}
              ar={ar}
            />
          </TabsContent>
        </Tabs>
      </div>

      {/* Unified Expense Form Dialog */}
      <ExpenseFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        lookups={lookups.data}
        onSaved={(id) => {
          void load();
          if (id) {
            setSelectedEntryId(id);
            setDetailOpen(true);
          }
        }}
      />

      {/* Unified Expense Detail Drawer */}
      <ExpenseDetailDrawer
        entryId={selectedEntryId}
        open={detailOpen}
        onOpenChange={(open) => {
          setDetailOpen(open);
          if (!open) setSelectedEntryId(null);
        }}
        onEdit={() => {
          setDetailOpen(false);
          setFormOpen(true);
        }}
      />
    </>
  );
}

function StatCard({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone: "pos" | "neg" | "warn";
}) {
  const color =
    tone === "pos" ? "text-emerald-500" : tone === "neg" ? "text-rose-500" : "text-amber-500";
  return (
    <Card className="rounded-2xl border-border/70 bg-card/80 shadow-none">
      <CardContent className="p-3.5 sm:p-4">
        <div className={`flex min-w-0 items-center gap-2 text-xs ${color}`}>
          {icon}
          <span className="truncate">{label}</span>
        </div>
        <div className="mt-2 truncate text-lg font-semibold font-mono sm:text-xl">{value}</div>
      </CardContent>
    </Card>
  );
}

function BalanceTable({ rows, emptyMsg, ar }: { rows: any[]; emptyMsg: string; ar: boolean }) {
  return (
    <Card className="overflow-hidden rounded-3xl border-border/70 shadow-sm">
      <CardContent className="overflow-x-auto p-0">
        <Table className="min-w-[460px]">
          <TableHeader>
            <TableRow>
              <TableHead>{ar ? "الاسم" : "Name"}</TableHead>
              <TableHead className="text-end">{ar ? "الرصيد" : "Balance"}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={2} className="text-center text-muted-foreground py-8">
                  {emptyMsg}
                </TableCell>
              </TableRow>
            ) : (
              rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>{r.name}</TableCell>
                  <TableCell className="text-end font-mono">{money(Number(r.balance))}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

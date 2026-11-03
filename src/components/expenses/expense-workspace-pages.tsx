import { useCallback, useRef, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { ArrowDownLeft, ArrowUpRight, ClipboardCheck, FileClock, FilePlus2, Landmark, ReceiptText, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { ExpenseDetailDrawer } from "@/components/expenses/expense-detail-drawer";
import { ExpenseFormDialog } from "@/components/expenses/expense-form";
import { ExpenseRegister } from "@/components/expenses/expense-register";
import { ExpenseSummaryCards } from "@/components/expenses/expense-summary-cards";
import { useExpenseList, useExpenseLookups, useExpenseRealtime, useExpenseReport, useExpenseSummary } from "@/hooks/use-expenses";
import { EMPTY_EXPENSE_FILTERS, startOfMonth, today, type ExpenseListFilters } from "@/lib/expenses/query-keys";
import type { ExpenseDetail, ExpenseListRow, ExpenseReportGroupBy } from "@/lib/expenses/types";
import { useI18n } from "@/lib/i18n";

type ExpenseWorkspaceSection = "dashboard" | "new" | "approvals" | "archive";
const expensePaths: Record<ExpenseWorkspaceSection, string> = {
  dashboard: "/expenses",
  new: "/expenses/new",
  approvals: "/expenses/approvals",
  archive: "/expenses/archive",
};

export function ExpenseWorkspaceNav({ active }: { active: ExpenseWorkspaceSection }) {
  const { lang } = useI18n();
  const isAr = lang === "ar";
  const items: { id: ExpenseWorkspaceSection; label: string; icon: typeof ReceiptText }[] = [
    { id: "dashboard", label: isAr ? "لوحة المصروفات" : "Dashboard", icon: ReceiptText },
    { id: "new", label: isAr ? "مصروف جديد" : "New expense", icon: FilePlus2 },
    { id: "approvals", label: isAr ? "الاعتمادات" : "Approvals", icon: ClipboardCheck },
    { id: "archive", label: isAr ? "الأرشيف والتقارير" : "Archive & reports", icon: FileClock },
  ];
  return (
    <nav aria-label={isAr ? "شاشات المصروفات" : "Expense screens"} className="mb-5 flex gap-2 overflow-x-auto rounded-2xl border border-border/70 bg-card/60 p-2">
      {items.map(({ id, label, icon: Icon }) => (
        <Link
          key={id}
          to={expensePaths[id] as any}
          aria-current={active === id ? "page" : undefined}
          className={`inline-flex min-h-10 shrink-0 items-center gap-2 rounded-xl px-3 text-xs font-semibold transition sm:px-4 sm:text-sm ${active === id ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}
        >
          <Icon className="size-4" aria-hidden="true" />
          {label}
        </Link>
      ))}
      <Link
        to={"/expenses/setup" as any}
        className="ms-auto inline-flex min-h-10 shrink-0 items-center gap-2 rounded-xl px-3 text-xs font-semibold text-muted-foreground hover:bg-muted hover:text-foreground sm:text-sm"
      >
        <Settings2 className="size-4" aria-hidden="true" />
        <span className="hidden sm:inline">{isAr ? "الإعدادات" : "Setup"}</span>
      </Link>
    </nav>
  );
}

export function ExpenseDashboardPage({
  create = false,
  initialCostCenterId,
  initialCategoryId,
}: {
  create?: boolean;
  initialCostCenterId?: string;
  initialCategoryId?: string;
}) {
  const { lang } = useI18n();
  const isAr = lang === "ar";
  const [formOpen, setFormOpen] = useState(create);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [editing, setEditing] = useState<ExpenseDetail | null>(null);
  const lookups = useExpenseLookups();
  const summary = useExpenseSummary(startOfMonth(), today(), null);
  const categoryReport = useExpenseReport("category", startOfMonth(), today());
  const realtime = useExpenseRealtime();

  const refresh = useCallback(() => {
    void summary.refetch();
    void categoryReport.refetch();
    realtime.refresh();
  }, [summary, categoryReport, realtime]);

  const chartTotal = Math.max(1, ...(categoryReport.data ?? []).map((row) => Number(row.total_amount)));

  return (
    <div className="space-y-5">
      <ExpenseWorkspaceNav active="dashboard" />
      <PageHeader
        title={isAr ? "لوحة المصروفات" : "Expense dashboard"}
        subtitle={isAr ? "تابع المصروفات والاعتمادات والمدفوعات من مكان واحد." : "Track expenses, approvals, and payments in one place."}
        actions={
          <Button onClick={() => { setEditing(null); setFormOpen(true); }}>
            <FilePlus2 className="me-1.5 size-4" />
            {isAr ? "تسجيل مصروف" : "Record expense"}
          </Button>
        }
      />

      <ExpenseSummaryCards summary={summary.data} loading={summary.isLoading} />
      {summary.error ? (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-destructive/25 bg-destructive/5 p-3 text-sm text-destructive">
          <span>{isAr ? "تعذر تحميل ملخص المصروفات." : "Could not load the expense summary."}</span>
          <Button variant="outline" size="sm" onClick={refresh}>{isAr ? "إعادة المحاولة" : "Retry"}</Button>
        </div>
      ) : null}

      <section className="grid gap-3 sm:grid-cols-3" aria-label={isAr ? "روابط سريعة" : "Quick links"}>
        <WorkspaceCard
          to={expensePaths.approvals}
          icon={ClipboardCheck}
          title={isAr ? "طلبات بانتظار الاعتماد" : "Awaiting approval"}
          value={String(summary.data?.pending_count ?? 0)}
          hint={isAr ? "افتح صندوق المراجعة واتخذ القرار" : "Open the review queue"}
          tone="amber"
        />
        <WorkspaceCard
          to={expensePaths.archive}
          icon={FileClock}
          title={isAr ? "المبالغ غير المسددة" : "Unsettled expenses"}
          value={String(summary.data?.unpaid_count ?? 0)}
          hint={isAr ? "تابع الذمم والدفعات الجزئية" : "Review payables and partial settlements"}
          tone="blue"
        />
        <WorkspaceCard
          to="/expenses/setup"
          icon={Landmark}
          title={isAr ? "إعداد الحسابات والتصنيفات" : "Accounts & categories"}
          value="›"
          hint={isAr ? "اربط التصنيفات بدليل الحسابات" : "Map categories to the ledger"}
          tone="slate"
        />
      </section>

      <section className="rounded-2xl border border-border/70 bg-card/70 p-4 sm:p-5">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-foreground">{isAr ? "المصروفات حسب التصنيف" : "Expenses by category"}</h2>
            <p className="mt-1 text-xs text-muted-foreground">{isAr ? "الشهر الحالي · من المصروفات المسجلة" : "Current month · from recorded expenses"}</p>
          </div>
          <Link to={expensePaths.archive as any} className="text-xs font-semibold text-primary hover:underline">
            {isAr ? "عرض الأرشيف والتقارير" : "Open archive & reports"}
            <ArrowUpRight className="ms-1 inline size-3.5" aria-hidden="true" />
          </Link>
        </div>
        {categoryReport.isLoading ? (
          <p className="py-6 text-center text-sm text-muted-foreground">{isAr ? "جارٍ تجهيز التقرير…" : "Loading report…"}</p>
        ) : categoryReport.error ? (
          <div role="alert" className="flex items-center justify-between gap-3 rounded-xl bg-muted/60 p-3 text-sm">
            <span>{isAr ? "تعذر تحميل تقرير التصنيفات." : "Could not load the category report."}</span>
            <Button variant="outline" size="sm" onClick={() => void categoryReport.refetch()}>{isAr ? "إعادة المحاولة" : "Retry"}</Button>
          </div>
        ) : categoryReport.data?.length ? (
          <div className="space-y-3">
            {categoryReport.data.slice(0, 7).map((row) => {
              const value = Number(row.total_amount);
              return (
                <div key={row.group_key} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5">
                  <div className="truncate text-xs font-medium text-foreground">{isAr ? row.label_ar || row.label : row.label}</div>
                  <div className="font-mono text-xs tabular-nums text-muted-foreground">{value.toLocaleString(isAr ? "ar" : "en-US", { maximumFractionDigits: 2 })}</div>
                  <div className="col-span-2 h-2 overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-primary/75" style={{ width: `${Math.max(3, (value / chartTotal) * 100)}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            {isAr ? "لا توجد مصروفات مسجلة خلال هذا الشهر." : "No expenses recorded this month."}
          </p>
        )}
      </section>

      <ExpenseFormDialog
        open={formOpen}
        initialCostCenterId={initialCostCenterId}
        initialCategoryId={initialCategoryId}
        onOpenChange={(open) => setFormOpen(open)}
        lookups={lookups.data}
        lookupsError={lookups.error}
        isLoadingLookups={lookups.isLoading}
        onRetryLookups={() => void lookups.refetch()}
        editing={editing}
        onSaved={(entryId) => {
          if (entryId) { setDetailId(entryId); setDetailOpen(true); }
        }}
      />
      <ExpenseDetailDrawer
        entryId={detailId}
        open={detailOpen}
        onOpenChange={(open) => { setDetailOpen(open); if (!open) setDetailId(null); }}
        onEdit={(detail) => { setEditing(detail); setFormOpen(true); }}
      />
    </div>
  );
}

export function ExpenseNewPage() {
  const { lang } = useI18n();
  const isAr = lang === "ar";
  const navigate = useNavigate();
  const lookups = useExpenseLookups();
  const saved = useRef(false);
  return (
    <div className="space-y-4">
      <ExpenseWorkspaceNav active="new" />
      <PageHeader title={isAr ? "تسجيل مصروف" : "Record an expense"} subtitle={isAr ? "أدخل المصروف الفعلي أو فاتورة المورد. الاعتماد والصرف والترحيل مراحل منفصلة." : "Record an incurred expense or supplier bill. Approval, payment, and posting are separate steps."} />
      <div className="rounded-xl border border-primary/20 bg-primary/5 px-4 py-3 text-sm text-muted-foreground">
        {isAr ? "الفاتورة الآجلة تثبت الالتزام عند اعتمادها، ثم تسجل الدفعات من تفاصيل المصروف. رقم فاتورة المورد يمنع تسجيل الفاتورة نفسها مرتين." : "An approved supplier bill recognizes the payable; record its payments from the expense details. Supplier invoice numbers are checked for duplicates."}
      </div>
      <ExpenseFormDialog
        open
        onOpenChange={(open) => {
          if (!open) {
            void navigate({ to: (saved.current ? "/expenses/archive" : "/expenses") as any });
            saved.current = false;
          }
        }}
        lookups={lookups.data}
        lookupsError={lookups.error}
        isLoadingLookups={lookups.isLoading}
        onRetryLookups={() => void lookups.refetch()}
        onSaved={(id) => { saved.current = Boolean(id); }}
      />
    </div>
  );
}

export function ExpenseQueuePage({ mode }: { mode: "approvals" | "archive" }) {
  const { lang } = useI18n();
  const isAr = lang === "ar";
  const navigate = useNavigate();
  const [filters, setFilters] = useState<ExpenseListFilters>(() => ({
    ...EMPTY_EXPENSE_FILTERS,
    status: mode === "approvals" ? ["SUBMITTED"] : [],
    dateFrom: mode === "approvals" ? null : startOfMonth(),
    dateTo: mode === "approvals" ? null : today(),
  }));
  const [formOpen, setFormOpen] = useState(false);
  const [editingDetail, setEditingDetail] = useState<ExpenseDetail | null>(null);
  const [openEntryId, setOpenEntryId] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [groupBy, setGroupBy] = useState<ExpenseReportGroupBy>("category");
  const lookups = useExpenseLookups();
  const summary = useExpenseSummary(filters.dateFrom, filters.dateTo, filters.warehouseId);
  const list = useExpenseList(filters);
  const report = useExpenseReport(groupBy, filters.dateFrom, filters.dateTo);
  const realtime = useExpenseRealtime();
  const refresh = useCallback(() => { void summary.refetch(); void list.refetch(); void report.refetch(); realtime.refresh(); }, [summary, list, report, realtime]);

  const labels: Record<ExpenseReportGroupBy, { ar: string; en: string }> = {
    category: { ar: "التصنيف", en: "Category" }, month: { ar: "الشهر", en: "Month" },
    warehouse: { ar: "المستودع", en: "Warehouse" }, cost_center: { ar: "مركز التكلفة", en: "Cost center" },
    project: { ar: "المشروع", en: "Project" }, payee: { ar: "المستفيد", en: "Payee" }, status: { ar: "الحالة", en: "Status" },
  };
  const pageTitle = mode === "approvals" ? (isAr ? "صندوق اعتماد المصروفات" : "Expense approvals") : (isAr ? "أرشيف وتقارير المصروفات" : "Expense archive & reports");
  const pageSubtitle = mode === "approvals" ? (isAr ? "راجع المصروفات المرسلة، وافق أو ارفض مع تسجيل السبب." : "Review submitted expenses and approve or reject with a reason.") : (isAr ? "ابحث في السجل، حلل الإنفاق، وراجع التسويات والقيود." : "Search the register, analyze spending, and review settlements and postings.");

  return (
    <div className="space-y-5">
      <ExpenseWorkspaceNav active={mode} />
      {mode === "archive" ? (
        <section className="rounded-2xl border border-border/70 bg-card/70 p-4">
          <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="font-semibold text-foreground">{isAr ? "ملخص تحليلي" : "Spending analysis"}</h2>
              <p className="mt-1 text-xs text-muted-foreground">{isAr ? "يتبع الفترة المحددة في مرشحات الأرشيف." : "Uses the period selected in the archive filters."}</p>
            </div>
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              {isAr ? "التجميع" : "Group by"}
              <select value={groupBy} onChange={(event) => setGroupBy(event.target.value as ExpenseReportGroupBy)} className="h-9 rounded-lg border border-input bg-background px-2 text-foreground">
                {(Object.keys(labels) as ExpenseReportGroupBy[]).map((key) => <option key={key} value={key}>{isAr ? labels[key].ar : labels[key].en}</option>)}
              </select>
            </label>
          </div>
          {report.data?.length ? (
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {report.data.slice(0, 9).map((row) => (
                <div key={row.group_key} className="flex min-w-0 items-center justify-between gap-3 rounded-xl border border-border/60 bg-surface/60 px-3 py-2.5">
                  <span className="truncate text-xs font-medium">{isAr ? row.label_ar || row.label : row.label}</span>
                  <span className="shrink-0 font-mono text-xs font-semibold tabular-nums">{Number(row.total_amount).toLocaleString(isAr ? "ar" : "en-US", { maximumFractionDigits: 2 })}</span>
                </div>
              ))}
            </div>
          ) : report.isLoading ? <p className="py-5 text-center text-xs text-muted-foreground">{isAr ? "جارٍ تحميل التقرير…" : "Loading report…"}</p> : <p className="py-5 text-center text-xs text-muted-foreground">{isAr ? "لا توجد بيانات في الفترة المختارة." : "No data in the selected period."}</p>}
        </section>
      ) : null}

      <ExpenseRegister
        title={pageTitle}
        subtitle={pageSubtitle}
        showSummary={mode === "archive"}
        totalCount={list.totalCount}
        rows={list.rows}
        summary={summary.data}
        summaryError={summary.error}
        lookups={lookups.data}
        filters={filters}
        onFiltersChange={setFilters}
        onRefresh={refresh}
        isLoading={list.isLoading}
        isFetching={list.isFetching}
        isFetchingNextPage={list.isFetchingNextPage}
        hasNextPage={Boolean(list.hasNextPage)}
        onLoadMore={() => void list.fetchNextPage()}
        error={list.error}
        onCreate={() => { setEditingDetail(null); setFormOpen(true); }}
        onOpen={(row: ExpenseListRow) => { setOpenEntryId(row.id); setDetailOpen(true); }}
        onEdit={(row: ExpenseListRow) => { setOpenEntryId(row.id); setDetailOpen(true); }}
        onPay={(row: ExpenseListRow) => { setOpenEntryId(row.id); setDetailOpen(true); }}
      />
      <ExpenseFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        lookups={lookups.data}
        lookupsError={lookups.error}
        isLoadingLookups={lookups.isLoading}
        onRetryLookups={() => void lookups.refetch()}
        editing={editingDetail}
        onSaved={(entryId) => { if (entryId) { setOpenEntryId(entryId); setDetailOpen(true); } }}
      />
      <ExpenseDetailDrawer
        entryId={openEntryId}
        open={detailOpen}
        onOpenChange={(open) => { setDetailOpen(open); if (!open) setOpenEntryId(null); }}
        onEdit={(detail) => { setEditingDetail(detail); setFormOpen(true); }}
      />
    </div>
  );
}

function WorkspaceCard({
  to, icon: Icon, title, value, hint, tone,
}: {
  to: string;
  icon: typeof ReceiptText;
  title: string;
  value: string;
  hint: string;
  tone: "amber" | "blue" | "slate";
}) {
  const tones = {
    amber: "border-amber-500/25 bg-amber-500/5 text-amber-700 dark:text-amber-300",
    blue: "border-blue-500/25 bg-blue-500/5 text-blue-700 dark:text-blue-300",
    slate: "border-border/70 bg-card/60 text-foreground",
  };
  return (
    <Link to={to as any} className={`group rounded-2xl border p-4 transition hover:-translate-y-0.5 hover:shadow-sm ${tones[tone]}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <span className="block truncate text-xs font-semibold">{title}</span>
          <span className="mt-2 block font-mono text-2xl font-bold tabular-nums">{value}</span>
        </div>
        <Icon className="size-5 shrink-0 opacity-75" aria-hidden="true" />
      </div>
      <span className="mt-2 flex items-center text-[11px] opacity-75">
        {hint}<ArrowDownLeft className="ms-1 size-3.5" aria-hidden="true" />
      </span>
    </Link>
  );
}

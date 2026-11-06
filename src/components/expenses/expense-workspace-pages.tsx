import { useCallback, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  ArrowDownLeft,
  ArrowUpRight,
  BookOpen,
  ClipboardCheck,
  FileClock,
  FilePlus2,
  Gauge,
  Landmark,
  ReceiptText,
  Settings2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { ExpenseDetailDrawer } from "@/components/expenses/expense-detail-drawer";
import { ExpenseFormDialog } from "@/components/expenses/expense-form";
import { ExpenseRegister } from "@/components/expenses/expense-register";
import { ExpenseSummaryCards } from "@/components/expenses/expense-summary-cards";
import {
  useExpenseList,
  useExpenseLookups,
  useExpenseRealtime,
  useExpenseReport,
  useExpenseSummary,
  useMillingServiceCostReport,
} from "@/hooks/use-expenses";
import {
  EMPTY_EXPENSE_FILTERS,
  startOfMonth,
  today,
  type ExpenseListFilters,
} from "@/lib/expenses/query-keys";
import type { ExpenseDetail, ExpenseListRow, ExpenseReportGroupBy } from "@/lib/expenses/types";
import { useI18n } from "@/lib/i18n";
import { getCompanyCurrencySymbol } from "@/lib/format";

type ExpenseWorkspaceSection =
  "dashboard" | "new" | "approvals" | "archive" | "service-costs" | "guide";
const expensePaths: Record<ExpenseWorkspaceSection, string> = {
  dashboard: "/expenses",
  new: "/expenses/new",
  approvals: "/expenses/approvals",
  archive: "/expenses/archive",
  "service-costs": "/expenses/service-costs",
  guide: "/expenses/guide",
};

export function ExpenseWorkspaceNav({ active }: { active: ExpenseWorkspaceSection }) {
  const { lang } = useI18n();
  const isAr = lang === "ar";
  const items: { id: ExpenseWorkspaceSection; label: string; icon: typeof ReceiptText }[] = [
    { id: "dashboard", label: isAr ? "لوحة المصروفات" : "Dashboard", icon: ReceiptText },
    { id: "new", label: isAr ? "مصروف جديد" : "New expense", icon: FilePlus2 },
    { id: "approvals", label: isAr ? "الاعتمادات" : "Approvals", icon: ClipboardCheck },
    { id: "archive", label: isAr ? "الأرشيف والتقارير" : "Archive & reports", icon: FileClock },
    { id: "service-costs", label: isAr ? "تكلفة خدمة الطحن" : "Milling service cost", icon: Gauge },
    { id: "guide", label: isAr ? "دليل المصروفات" : "Expense guide", icon: BookOpen },
  ];
  return (
    <nav
      aria-label={isAr ? "شاشات المصروفات" : "Expense screens"}
      className="mb-5 flex gap-2 overflow-x-auto rounded-2xl border border-border/70 bg-card/60 p-2"
    >
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

  const chartTotal = Math.max(
    1,
    ...(categoryReport.data ?? []).map((row) => Number(row.total_amount)),
  );

  return (
    <div className="space-y-5">
      <ExpenseWorkspaceNav active="dashboard" />
      <PageHeader
        title={isAr ? "لوحة المصروفات" : "Expense dashboard"}
        subtitle={
          isAr
            ? "تابع المصروفات والاعتمادات والمدفوعات من مكان واحد."
            : "Track expenses, approvals, and payments in one place."
        }
        actions={
          <Button
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
          >
            <FilePlus2 className="me-1.5 size-4" />
            {isAr ? "تسجيل مصروف" : "Record expense"}
          </Button>
        }
      />

      <ExpenseSummaryCards summary={summary.data} loading={summary.isLoading} />
      {summary.error ? (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-destructive/25 bg-destructive/5 p-3 text-sm text-destructive"
        >
          <span>{isAr ? "تعذر تحميل ملخص المصروفات." : "Could not load the expense summary."}</span>
          <Button variant="outline" size="sm" onClick={refresh}>
            {isAr ? "إعادة المحاولة" : "Retry"}
          </Button>
        </div>
      ) : null}

      <section
        className="grid gap-3 sm:grid-cols-3"
        aria-label={isAr ? "روابط سريعة" : "Quick links"}
      >
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
            <h2 className="text-base font-semibold text-foreground">
              {isAr ? "المصروفات حسب التصنيف" : "Expenses by category"}
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              {isAr
                ? "الشهر الحالي · من المصروفات المسجلة"
                : "Current month · from recorded expenses"}
            </p>
          </div>
          <Link
            to={expensePaths.archive as any}
            className="text-xs font-semibold text-primary hover:underline"
          >
            {isAr ? "عرض الأرشيف والتقارير" : "Open archive & reports"}
            <ArrowUpRight className="ms-1 inline size-3.5" aria-hidden="true" />
          </Link>
        </div>
        {categoryReport.isLoading ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            {isAr ? "جارٍ تجهيز التقرير…" : "Loading report…"}
          </p>
        ) : categoryReport.error ? (
          <div
            role="alert"
            className="flex items-center justify-between gap-3 rounded-xl bg-muted/60 p-3 text-sm"
          >
            <span>
              {isAr ? "تعذر تحميل تقرير التصنيفات." : "Could not load the category report."}
            </span>
            <Button variant="outline" size="sm" onClick={() => void categoryReport.refetch()}>
              {isAr ? "إعادة المحاولة" : "Retry"}
            </Button>
          </div>
        ) : categoryReport.data?.length ? (
          <div className="space-y-3">
            {categoryReport.data.slice(0, 7).map((row) => {
              const value = Number(row.total_amount);
              return (
                <div
                  key={row.group_key}
                  className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5"
                >
                  <div className="truncate text-xs font-medium text-foreground">
                    {isAr ? row.label_ar || row.label : row.label}
                  </div>
                  <div className="font-mono text-xs tabular-nums text-muted-foreground">
                    {value.toLocaleString(isAr ? "ar" : "en-US", { maximumFractionDigits: 2 })}
                  </div>
                  <div className="col-span-2 h-2 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary/75"
                      style={{ width: `${Math.max(3, (value / chartTotal) * 100)}%` }}
                    />
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
          if (entryId) {
            setDetailId(entryId);
            setDetailOpen(true);
          }
        }}
      />
      <ExpenseDetailDrawer
        entryId={detailId}
        open={detailOpen}
        onOpenChange={(open) => {
          setDetailOpen(open);
          if (!open) setDetailId(null);
        }}
        onEdit={(detail) => {
          setEditing(detail);
          setFormOpen(true);
        }}
      />
    </div>
  );
}

export function ExpenseNewPage({ initialCostCenterId }: { initialCostCenterId?: string }) {
  const { lang } = useI18n();
  const isAr = lang === "ar";
  const navigate = useNavigate();
  const lookups = useExpenseLookups();
  const saved = useRef(false);
  return (
    <div className="space-y-4">
      <ExpenseWorkspaceNav active="new" />
      <PageHeader
        title={isAr ? "تسجيل مصروف" : "Record an expense"}
        subtitle={
          isAr
            ? "أدخل المصروف الفعلي أو فاتورة المورد. الاعتماد والصرف والترحيل مراحل منفصلة."
            : "Record an incurred expense or supplier bill. Approval, payment, and posting are separate steps."
        }
      />
      <div className="rounded-xl border border-primary/20 bg-primary/5 px-4 py-3 text-sm text-muted-foreground">
        {isAr
          ? "الفاتورة الآجلة تثبت الالتزام عند اعتمادها، ثم تسجل الدفعات من تفاصيل المصروف. رقم فاتورة المورد يمنع تسجيل الفاتورة نفسها مرتين."
          : "An approved supplier bill recognizes the payable; record its payments from the expense details. Supplier invoice numbers are checked for duplicates."}
      </div>
      <ExpenseFormDialog
        open
        initialCostCenterId={initialCostCenterId}
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
        onSaved={(id) => {
          saved.current = Boolean(id);
        }}
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
  const refresh = useCallback(() => {
    void summary.refetch();
    void list.refetch();
    void report.refetch();
    realtime.refresh();
  }, [summary, list, report, realtime]);

  const labels: Record<ExpenseReportGroupBy, { ar: string; en: string }> = {
    category: { ar: "التصنيف", en: "Category" },
    month: { ar: "الشهر", en: "Month" },
    warehouse: { ar: "المستودع", en: "Warehouse" },
    cost_center: { ar: "مركز التكلفة", en: "Cost center" },
    project: { ar: "المشروع", en: "Project" },
    payee: { ar: "المستفيد", en: "Payee" },
    status: { ar: "الحالة", en: "Status" },
  };
  const pageTitle =
    mode === "approvals"
      ? isAr
        ? "صندوق اعتماد المصروفات"
        : "Expense approvals"
      : isAr
        ? "أرشيف وتقارير المصروفات"
        : "Expense archive & reports";
  const pageSubtitle =
    mode === "approvals"
      ? isAr
        ? "راجع المصروفات المرسلة، وافق أو ارفض مع تسجيل السبب."
        : "Review submitted expenses and approve or reject with a reason."
      : isAr
        ? "ابحث في السجل، حلل الإنفاق، وراجع التسويات والقيود."
        : "Search the register, analyze spending, and review settlements and postings.";

  return (
    <div className="space-y-5">
      <ExpenseWorkspaceNav active={mode} />
      {mode === "archive" ? (
        <section className="rounded-2xl border border-border/70 bg-card/70 p-4">
          <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="font-semibold text-foreground">
                {isAr ? "ملخص تحليلي" : "Spending analysis"}
              </h2>
              <p className="mt-1 text-xs text-muted-foreground">
                {isAr
                  ? "يتبع الفترة المحددة في مرشحات الأرشيف."
                  : "Uses the period selected in the archive filters."}
              </p>
            </div>
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              {isAr ? "التجميع" : "Group by"}
              <select
                value={groupBy}
                onChange={(event) => setGroupBy(event.target.value as ExpenseReportGroupBy)}
                className="h-9 rounded-lg border border-input bg-background px-2 text-foreground"
              >
                {(Object.keys(labels) as ExpenseReportGroupBy[]).map((key) => (
                  <option key={key} value={key}>
                    {isAr ? labels[key].ar : labels[key].en}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {report.data?.length ? (
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {report.data.slice(0, 9).map((row) => (
                <div
                  key={row.group_key}
                  className="flex min-w-0 items-center justify-between gap-3 rounded-xl border border-border/60 bg-surface/60 px-3 py-2.5"
                >
                  <span className="truncate text-xs font-medium">
                    {isAr ? row.label_ar || row.label : row.label}
                  </span>
                  <span className="shrink-0 font-mono text-xs font-semibold tabular-nums">
                    {Number(row.total_amount).toLocaleString(isAr ? "ar" : "en-US", {
                      maximumFractionDigits: 2,
                    })}
                  </span>
                </div>
              ))}
            </div>
          ) : report.isLoading ? (
            <p className="py-5 text-center text-xs text-muted-foreground">
              {isAr ? "جارٍ تحميل التقرير…" : "Loading report…"}
            </p>
          ) : (
            <p className="py-5 text-center text-xs text-muted-foreground">
              {isAr ? "لا توجد بيانات في الفترة المختارة." : "No data in the selected period."}
            </p>
          )}
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
        onCreate={() => {
          setEditingDetail(null);
          setFormOpen(true);
        }}
        onOpen={(row: ExpenseListRow) => {
          setOpenEntryId(row.id);
          setDetailOpen(true);
        }}
        onEdit={(row: ExpenseListRow) => {
          setOpenEntryId(row.id);
          setDetailOpen(true);
        }}
        onPay={(row: ExpenseListRow) => {
          setOpenEntryId(row.id);
          setDetailOpen(true);
        }}
      />
      <ExpenseFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        lookups={lookups.data}
        lookupsError={lookups.error}
        isLoadingLookups={lookups.isLoading}
        onRetryLookups={() => void lookups.refetch()}
        editing={editingDetail}
        onSaved={(entryId) => {
          if (entryId) {
            setOpenEntryId(entryId);
            setDetailOpen(true);
          }
        }}
      />
      <ExpenseDetailDrawer
        entryId={openEntryId}
        open={detailOpen}
        onOpenChange={(open) => {
          setDetailOpen(open);
          if (!open) setOpenEntryId(null);
        }}
        onEdit={(detail) => {
          setEditingDetail(detail);
          setFormOpen(true);
        }}
      />
    </div>
  );
}

export function ExpenseServiceCostingPage() {
  const { lang } = useI18n();
  const isAr = lang === "ar";
  const lookups = useExpenseLookups();
  const [dateFrom, setDateFrom] = useState(startOfMonth());
  const [dateTo, setDateTo] = useState(today());
  const [selectedCostCenterId, setSelectedCostCenterId] = useState("");
  const defaultCenter =
    lookups.data?.cost_centers.find((center) => center.code === "MILLING-SERVICE") ??
    lookups.data?.cost_centers.find((center) => center.name_ar === "خدمة الطحن");
  const costCenterId = selectedCostCenterId || defaultCenter?.id || null;
  const report = useMillingServiceCostReport(
    dateFrom || null,
    dateTo || null,
    costCenterId,
    Boolean(lookups.data),
  );
  const number = (value: number | string | null | undefined) => {
    if (value == null || value === "") return "—";
    return Number(value).toLocaleString(isAr ? "ar" : "en-US", { maximumFractionDigits: 2 });
  };
  const money = (value: number | string | null | undefined) =>
    value == null || value === "" ? "—" : `${number(value)} ${getCompanyCurrencySymbol()}`;
  const row = report.data;

  return (
    <div className="space-y-5">
      <ExpenseWorkspaceNav active="service-costs" />
      <PageHeader
        title={isAr ? "تكلفة خدمة الطحن" : "Milling service costing"}
        subtitle={
          isAr
            ? "قارن تقدير تكلفة صنف الخدمة بالمصروفات المرحلة وكميات الطحن الفعلية في الفترة."
            : "Compare the service-item estimate with posted expenses and processed milling quantities for the period."
        }
      />

      <section className="grid gap-3 rounded-2xl border border-border/70 bg-card/70 p-4 sm:grid-cols-3">
        <label className="space-y-1.5 text-xs font-semibold text-muted-foreground">
          {isAr ? "من تاريخ" : "From"}
          <input
            type="date"
            value={dateFrom}
            max={dateTo || undefined}
            onChange={(event) => setDateFrom(event.target.value)}
            className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm font-normal text-foreground"
          />
        </label>
        <label className="space-y-1.5 text-xs font-semibold text-muted-foreground">
          {isAr ? "إلى تاريخ" : "To"}
          <input
            type="date"
            value={dateTo}
            min={dateFrom || undefined}
            onChange={(event) => setDateTo(event.target.value)}
            className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm font-normal text-foreground"
          />
        </label>
        <label className="space-y-1.5 text-xs font-semibold text-muted-foreground">
          {isAr ? "مركز التكلفة" : "Cost center"}
          <select
            value={costCenterId ?? ""}
            onChange={(event) => setSelectedCostCenterId(event.target.value)}
            className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm font-normal text-foreground"
          >
            <option value="">
              {isAr ? "خدمة الطحن (الافتراضي)" : "Milling service (default)"}
            </option>
            {(lookups.data?.cost_centers ?? []).map((center) => (
              <option key={center.id} value={center.id}>
                {isAr ? center.name_ar || center.name : center.name}
              </option>
            ))}
          </select>
        </label>
      </section>

      {report.isLoading ? (
        <p className="rounded-xl border bg-card p-5 text-center text-sm text-muted-foreground">
          {isAr ? "جارٍ احتساب التقرير…" : "Calculating report…"}
        </p>
      ) : null}
      {report.error ? (
        <div
          role="alert"
          className="rounded-xl border border-destructive/25 bg-destructive/5 p-4 text-sm text-destructive"
        >
          <p>
            {isAr
              ? "تعذر حساب التكلفة. تأكد من تطبيق ترحيل التقرير ومن وجود مركز خدمة الطحن."
              : "Could not calculate costs. Check that the report migration is applied and a milling service cost center exists."}
          </p>
          <Button
            variant="outline"
            size="sm"
            className="mt-3"
            onClick={() => void report.refetch()}
          >
            {isAr ? "إعادة المحاولة" : "Retry"}
          </Button>
        </div>
      ) : null}

      {row ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <CostMetric
              label={isAr ? "المصروف الفعلي المحمّل للمركز" : "Posted cost allocated to center"}
              value={money(row.expense_amount)}
              hint={
                isAr
                  ? `${number(row.expense_document_count)} مستند مصروف`
                  : `${number(row.expense_document_count)} expense documents`
              }
            />
            <CostMetric
              label={isAr ? "كمية الطحن" : "Processed quantity"}
              value={`${number(row.processed_kg)} ${isAr ? "كجم" : "kg"}`}
              hint={`${number(row.processed_bags)} ${isAr ? "كيس" : "bags"}`}
            />
            <CostMetric
              label={isAr ? "التكلفة الفعلية المتوسطة / كجم" : "Average actual cost / kg"}
              value={money(row.actual_cost_per_kg)}
              hint={isAr ? "مصروفات المركز ÷ الوزن المطحون" : "Center expenses ÷ processed weight"}
            />
            <CostMetric
              label={isAr ? "التكلفة الفعلية المتوسطة / كيس" : "Average actual cost / bag"}
              value={money(row.actual_cost_per_bag)}
              hint={isAr ? "مصروفات المركز ÷ الأكياس المطحونة" : "Center expenses ÷ processed bags"}
            />
            <CostMetric
              label={isAr ? "التكلفة التقديرية المسجلة" : "Captured estimated cost"}
              value={money(row.estimated_service_cost)}
              hint={
                isAr
                  ? "لقطة تكلفة الخدمة وقت استلام الحبوب"
                  : "Service-item cost snapshot at intake"
              }
            />
            <CostMetric
              label={isAr ? "التقديري / كيس" : "Estimate / bag"}
              value={money(row.estimated_cost_per_bag)}
              hint={`${isAr ? "مغطى من" : "Estimate covers"} ${number(row.estimate_covered_bags)} ${isAr ? "كيس" : "bags"}`}
            />
            <CostMetric
              label={isAr ? "التقديري / كجم" : "Estimate / kg"}
              value={money(row.estimated_cost_per_kg)}
              hint={`${isAr ? "مغطى من" : "Estimate covers"} ${number(row.estimate_covered_kg)} ${isAr ? "كجم" : "kg"}`}
            />
            <CostMetric
              label={isAr ? "فرق الفعلي عن التقديري / كيس" : "Actual vs estimate / bag"}
              value={
                row.actual_cost_per_bag == null || row.estimated_cost_per_bag == null
                  ? "—"
                  : money(Number(row.actual_cost_per_bag) - Number(row.estimated_cost_per_bag))
              }
              hint={
                isAr
                  ? "موجب: الفعلي أعلى من التقدير"
                  : "Positive means actual cost exceeds estimate"
              }
            />
            <CostMetric
              label={isAr ? "فرق الفعلي عن التقديري / كجم" : "Actual vs estimate / kg"}
              value={
                row.actual_cost_per_kg == null || row.estimated_cost_per_kg == null
                  ? "—"
                  : money(Number(row.actual_cost_per_kg) - Number(row.estimated_cost_per_kg))
              }
              hint={
                isAr
                  ? "موجب: الفعلي أعلى من التقدير"
                  : "Positive means actual cost exceeds estimate"
              }
            />
            <CostMetric
              label={isAr ? "إيراد المستندات المكتملة" : "Completed service invoices"}
              value={money(row.completed_invoice_revenue)}
              hint={`${number(row.completed_document_count)} ${isAr ? "مستند مكتمل" : "completed documents"}`}
            />
            <CostMetric
              label={
                isAr
                  ? "مساهمة الخدمة بعد المصروفات الموزعة"
                  : "Service contribution after allocated costs"
              }
              value={money(row.service_contribution_after_allocated_cost)}
              hint={
                isAr
                  ? "إيراد المستندات المسلّمة ناقص مصروفات المركز"
                  : "Delivered-ticket revenue less cost-center expenses"
              }
            />
          </div>
          <div className="rounded-2xl border border-border/70 bg-card/70 p-4 sm:p-5">
            <h2 className="font-semibold">
              {isAr ? "كيف تقرأ الأرقام؟" : "How to read this report"}
            </h2>
            <ul className="mt-2 list-disc space-y-1.5 ps-5 text-sm leading-6 text-muted-foreground">
              <li>
                {isAr
                  ? "التكلفة الفعلية = بنود المصروفات المرحلة المسندة إلى مركز خدمة الطحن، مع استبعاد ضريبة المدخلات القابلة للاسترداد."
                  : "Actual cost sums posted expense lines assigned to the milling service cost center and excludes recoverable input tax."}
              </li>
              <li>
                {isAr
                  ? "المتوسط لكل كيس أو كيلوجرام هو توزيع للفترة، وليس تكلفة دقيقة لكل عميل أو مستند. يلزم تسجيل ساعات/استهلاك كل عملية إذا أردت تكلفة خاصة بكل عملية."
                  : "Per-bag and per-kg figures are period averages, not exact costs for each customer ticket. Per-ticket costing needs metered usage or labor captured for each job."}
              </li>
              <li>
                {isAr
                  ? "التقدير مرتبط بتاريخ الاستلام، والمصروف الفعلي بتاريخ المصروف، وكمية الطحن بتاريخ تسجيل الطحن؛ لذلك قارن الفترات المكتملة بعد تسجيل عملياتها ومصروفاتها."
                  : "Estimates follow intake dates, expenses follow expense dates, and processed quantities follow milling dates. Compare closed periods after their tickets and expenses are recorded."}
              </li>
              <li>
                {isAr
                  ? "سعر التكلفة في صنف الخدمة تقديري للتحليل والتسعير؛ لا ينشئ قيدًا ولا يحل محل المصروفات الفعلية."
                  : "The service item's cost price is an analytical estimate for pricing; it creates no journal and does not replace actual expenses."}
              </li>
              <li>
                {isAr
                  ? "المساهمة التشغيلية للفترة تطرح مصروفات المركز من إيرادات فواتير الخدمة المكتملة فقط، ولا تشمل المصروفات العامة غير المسندة لهذا المركز."
                  : "Period contribution subtracts center costs from completed-service invoice revenue only; general expenses outside this center are excluded."}
              </li>
            </ul>
            <Link
              to="/expenses/new"
              search={{
                create: true,
                section: undefined,
                costCenterId: costCenterId ?? undefined,
                categoryId: undefined,
              }}
              className="mt-4 inline-flex items-center text-sm font-semibold text-primary hover:underline"
            >
              {isAr ? "تسجيل مصروف على مركز خدمة الطحن" : "Record a milling-service expense"}
              <ArrowUpRight className="ms-1 size-4" />
            </Link>
          </div>
        </>
      ) : null}
    </div>
  );
}

export function ExpenseGuidePage() {
  const { lang } = useI18n();
  const isAr = lang === "ar";
  return (
    <div className="space-y-5">
      <ExpenseWorkspaceNav active="guide" />
      <PageHeader
        title={isAr ? "دليل المصروفات" : "Expense guide"}
        subtitle={
          isAr
            ? "شرح عملي من تسجيل المستند إلى اعتماده وترحيله وسداده، مع مسار خاص لتكلفة أجور الطحن."
            : "A practical guide from entry through approval, posting and settlement, including milling-service costs."
        }
      />
      <GuideSection
        title={isAr ? "أولًا: جهّز الحسابات والتصنيفات" : "1. Set up accounts and categories"}
      >
        <p>
          {isAr
            ? "من إعدادات المصروفات أنشئ تصنيفًا واضحًا مثل أجور تشغيل أو كهرباء أو تعبئة، واربطه بحساب مصروف تحليلي قابل للترحيل. أنشئ مراكز تكلفة عند الحاجة. التصنيف يحدد نوع المصروف، والحساب يحدد مكان القيد، ومركز التكلفة يحدد النشاط الذي تحمّل المصروف."
            : "In Expense setup, create clear categories such as operating wages, electricity or packaging and map each to a postable expense account. Add cost centers as needed. Category describes the expense, the account controls the journal, and the cost center identifies the activity charged."}
        </p>
        <Link
          to="/expenses/setup"
          search={{
            section: "categories",
            create: false,
            costCenterId: undefined,
            categoryId: undefined,
          }}
          className="inline-flex items-center font-semibold text-primary hover:underline"
        >
          {isAr ? "فتح إعدادات المصروفات" : "Open expense setup"}
          <ArrowUpRight className="ms-1 size-4" />
        </Link>
      </GuideSection>
      <GuideSection title={isAr ? "ثانيًا: سجّل مصروفًا فعليًا" : "2. Record an incurred expense"}>
        <ol className="list-decimal space-y-2 ps-5">
          <li>
            {isAr
              ? "افتح مصروف جديد، واختر نوع المستند والمستفيد والمورد أو الموظف عند انطباقه."
              : "Open New expense, then choose the document type and the supplier or employee when applicable."}
          </li>
          <li>
            {isAr
              ? "أدخل البنود والتصنيفات والمبالغ والضريبة. اختر قابلية استرداد الضريبة فقط إذا كانت منشأتك مخولة بذلك، وارفق الفاتورة الأصلية."
              : "Enter lines, categories, amounts and tax. Mark tax recoverable only when your entity is entitled to recover it, and attach the source invoice."}
          </li>
          <li>
            {isAr
              ? "اختر مركز التكلفة للبنود المرتبطة بنشاط محدد. احفظ مسودة للمراجعة أو أرسلها للاعتماد."
              : "Assign a cost center to lines belonging to a specific activity. Save a draft or submit it for approval."}
          </li>
          <li>
            {isAr
              ? "بعد الاعتماد، رحّل المصروف لإثبات المصروف والالتزام، ثم سجّل الدفع الفعلي من تفاصيل المستند. الدفع الجزئي يبقي الرصيد المتبقي مفتوحًا."
              : "After approval, post the expense to recognize the expense and payable, then record actual payments from the document. Partial payment leaves the remaining payable open."}
          </li>
        </ol>
        <p className="rounded-lg bg-muted/50 p-3 text-sm font-medium">
          {isAr
            ? "الاعتماد وحده لا يخرج نقدًا ولا ينشئ قيدًا. الترحيل يثبت الاستحقاق، والدفع يسجل خروج النقد."
            : "Approval alone does not move cash or post a journal. Posting recognizes the payable; payment records the cash movement."}
        </p>
      </GuideSection>
      <GuideSection
        title={isAr ? "ثالثًا: مصروفات خدمة أجور الطحن" : "3. Milling-service expenses"}
      >
        <ol className="list-decimal space-y-2 ps-5">
          <li>
            {isAr
              ? "استخدم مركز التكلفة (خدمة الطحن). إن لم يظهر، أنشئه من إعدادات المصروفات بالرمز MILLING-SERVICE."
              : "Use the Milling service cost center. If it is missing, create it in Expense setup with code MILLING-SERVICE."}
          </li>
          <li>
            {isAr
              ? "سجّل حصة الطحن الفعلية من أجور العمال والطاقة والوقود والمستهلكات كمصروف، واربط كل بند بمركز خدمة الطحن. لا تحمّل عليه كامل إيجار المنشأة أو الإدارة؛ وزّع الجزء المتعلق بالخدمة فقط وبأساس ثابت."
              : "Record the actual share of milling wages, energy, fuel and consumables as expenses, assigning each line to the service center. Do not charge all premises rent or administration to it; allocate only the service-related share on a consistent basis."}
          </li>
          <li>
            {isAr
              ? "حبوب العميل أمانة وليست مخزون الشركة. هذه المصروفات تبقى مصروفات تشغيل خدمة، ولا تُرسمل على الحبوب أو المنتجات."
              : "Customer grain is custody, not company inventory. These are service operating costs and are not capitalized into the customer's grain or company products."}
          </li>
          <li>
            {isAr
              ? "افتح تحليل تكلفة خدمة الطحن. يقسم المصروفات المرحلة في المركز على كمية الطحن المنفذة في الفترة، ويعرض متوسط الكلفة لكل كيس ولكل كيلوجرام."
              : "Open Milling service cost to divide posted center expenses by processed quantities for the period and view average cost per bag and kilogram."}
          </li>
        </ol>
        <Link
          to="/expenses/service-costs"
          search={{
            create: false,
            section: undefined,
            costCenterId: undefined,
            categoryId: undefined,
          }}
          className="inline-flex items-center font-semibold text-primary hover:underline"
        >
          {isAr ? "فتح تحليل تكلفة خدمة الطحن" : "Open milling-service cost report"}
          <ArrowUpRight className="ms-1 size-4" />
        </Link>
      </GuideSection>
      <GuideSection
        title={
          isAr ? "سعر تكلفة صنف الخدمة: تقديري أم فعلي؟" : "Service-item cost: estimate or actual?"
        }
      >
        <p>
          {isAr
            ? "في بطاقة صنف أجور الطحن، سعر البيع هو أجرة الوحدة التي تُفوتر للعميل. أما سعر التكلفة فهو تقدير تكلفة الوحدة نفسها، ويجب أن تطابق وحدة الصنف أساس الفوترة: كيس أو كجم. سعر التكلفة لا ينشئ قيدًا ولا يسجل شراءً للخدمة."
            : "On the milling service item, sale price is the fee charged per billing unit. Its cost price estimates the cost of that same unit, so the service item's base unit must match billing by bag or kg. Cost price creates no journal and does not represent a purchase."}
        </p>
        <p>
          {isAr
            ? "عند استلام الحبوب تُحفظ لقطة من التقدير على المستند. بعد ذلك يحسب التقرير الفعلي من المصروفات المرحلة ومركز التكلفة. الفرق بينهما يساعد في ضبط التسعير؛ لا تعدّل التكلفة الفعلية يدويًا لمجرد مطابقة التقدير."
            : "At intake, the estimate is snapshotted on the service document. The actual report later derives cost from posted expenses and the cost center. Use the variance to improve pricing; do not overwrite actual cost merely to match the estimate."}
        </p>
      </GuideSection>
      <GuideSection title={isAr ? "حدود التقرير" : "Report limits"}>
        <p>
          {isAr
            ? "التكلفة لكل كيس/كجم حاليًا متوسط للفترة. لا تُنسب الكهرباء أو أجور العامل بدقة إلى فاتورة عميل بعينها ما لم تُسجل ساعات العمل أو استهلاك الطاقة لكل عملية. ربط المصروف بالمركز للتحليل، ولا يغيّر مخزون الأمانات. فاتورة الخدمة الحالية ترحّل إيرادها عند إصدارها؛ هذا التقرير لا يؤجل الإيراد حتى الطحن أو التسليم."
            : "Cost per bag/kg is a period average. Electricity and labor cannot be assigned precisely to one customer ticket without per-ticket hours or meter usage. The cost center is analytic and does not change custody inventory. The current service invoice posts revenue when issued; this report does not defer revenue until milling or delivery."}
        </p>
      </GuideSection>
    </div>
  );
}

function CostMetric({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="min-w-0 rounded-2xl border border-border/70 bg-card/70 p-4">
      <p className="text-xs font-semibold text-muted-foreground">{label}</p>
      <p className="mt-2 break-words font-mono text-xl font-bold tabular-nums sm:text-2xl">
        {value}
      </p>
      <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p>
    </div>
  );
}

function GuideSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3 rounded-2xl border border-border/70 bg-card/70 p-4 leading-7 text-sm text-muted-foreground sm:p-5">
      <h2 className="text-base font-semibold text-foreground">{title}</h2>
      {children}
    </section>
  );
}

function WorkspaceCard({
  to,
  icon: Icon,
  title,
  value,
  hint,
  tone,
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
    <Link
      to={to as any}
      className={`group rounded-2xl border p-4 transition hover:-translate-y-0.5 hover:shadow-sm ${tones[tone]}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <span className="block truncate text-xs font-semibold">{title}</span>
          <span className="mt-2 block font-mono text-2xl font-bold tabular-nums">{value}</span>
        </div>
        <Icon className="size-5 shrink-0 opacity-75" aria-hidden="true" />
      </div>
      <span className="mt-2 flex items-center text-[11px] opacity-75">
        {hint}
        <ArrowDownLeft className="ms-1 size-3.5" aria-hidden="true" />
      </span>
    </Link>
  );
}

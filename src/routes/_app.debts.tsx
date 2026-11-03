import {
  VortexMetricCard,
  VortexCollectionSheet,
  VortexDrawerDialog,
  VortexDateBadge,
} from "@/components/vortex-ui";
import { paymentMethodLabel } from "@/lib/payments/payment-methods";
import { QuickFilterBar } from "@/components/ui/quick-filter-bar";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { money } from "@/lib/format";
import { toSystemDigits } from "@/lib/format-preferences";
import type { ReactNode } from "react";

/**
 * شاشة الديون — تعرض الأرصدة **من الدفتر** لا من العمود المخزَّن.
 *
 * تغييرات المرحلة S7:
 *   - حذف printStatement() المكتوب يدويًا (كان قالبًا ثالثًا بمجاميع مختلفة)
 *   - استخدام useDebtsOverview() كمصدر واحد للأرصدة
 *   - زر «كشف حساب» ينقل مباشرة إلى مستند الكشف النهائي
 *
 * توحيد التصميم مع شاشة المنتجات — نظام السجلات الموحّد:
 *   - `RecordsToolbar`: بحث + فلترة + ترتيب + تبديل عرض (بطاقات / قائمة / جدول)
 *   - `RecordsFilterPanel` و`RecordsSortPanel`: نفس شيتات الفلترة والترتيب
 *   - `RecordsView` بثلاثة أوضاع: بطاقات، قائمة صفوف، جدول `DataTable` قابل للفرز
 *   - بقية العناصر من `vortex-ui` (بطاقات المؤشرات، درج التفاصيل، شارات التاريخ)
 */

import { ModuleGuard } from "@/lib/modules";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  ArrowUpRight,
  FileText,
  Phone,
  Users,
  UserCheck,
  Wallet,
} from "lucide-react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { useI18n } from "@/lib/i18n";
import { useDebtIndex } from "@/hooks/use-debts-overview";
import { StatementIntegrityBadge } from "@/components/statements/statement-integrity-badge";
import { WhatsAppButton } from "@/components/whatsapp-button";
import { debtReminderMessage } from "@/lib/whatsapp-templates";
import { Ltr } from "@/components/ltr-value";
import {
  applyFilters,
  type FilterDefinition,
  type FilterValues,
  type SortOption,
} from "@/components/ui/table-toolbar";
import type { DataTableColumn, DataTableSort } from "@/components/ui/data-table";
import { RecordsToolbar } from "@/components/ui/records-toolbar";
import { RecordsView, type RecordsViewMode } from "@/components/ui/records-view";
import { RecordsFilterPanel, RecordsSortPanel } from "@/components/ui/records-panels";
import { usePersistedViewMode } from "@/hooks/use-persisted-view-mode";

const debtsSearchSchema = z.object({
  customerId: z.string().optional(),
});

export const Route = createFileRoute("/_app/debts")({
  validateSearch: (search: Record<string, unknown>) => debtsSearchSchema.parse(search),
  head: () => ({ meta: [{ title: "ذمم العملاء — Market Hub" }] }),
  component: () => (
    <ModuleGuard moduleId="payments">
      <DebtsPage />
    </ModuleGuard>
  ),
});

interface Customer {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  balance: number;
  credit_limit: number;
  is_system?: boolean | null;
}
interface Invoice {
  id: string;
  invoice_number: string;
  total: number;
  paid: number;
  created_at: string;
  status: string;
}
interface Payment {
  id: string;
  amount: number;
  payment_date: string;
  payment_method: string;
  note: string | null;
  invoice_id: string | null;
  sales_invoices?: { invoice_number: string } | null;
}

/**
 * صف السجل — العميل + الرصيد المعتمد من الدفتر محسوبًا مرة واحدة، حتى لا
 * تحسب كل عارضة (بطاقة/صف/جدول) الرصيد بطريقتها.
 */
type DebtRow = Customer & {
  ledgerBalance: number;
  creditLimit: number;
  overLimit: boolean;
  hasGap: boolean;
  integrity: {
    ledgerBalance: number;
    cachedBalance: number | null;
    difference: number | null;
    hasGap: boolean;
  } | null;
};

/** شارة حالة موحّدة بلسان نظام التصميم (بدل الشارات المكتوبة يدوياً). */
function DebtStatusPill({
  tone,
  children,
}: {
  tone: "danger" | "warning" | "success";
  children: ReactNode;
}) {
  const styles = {
    danger: "border-rose-500/25 bg-rose-500/10 text-rose-600 dark:text-rose-400",
    warning: "border-amber-500/25 bg-amber-500/10 text-amber-600 dark:text-amber-400",
    success: "border-emerald-500/25 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  } as const;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[11px] font-bold",
        styles[tone],
      )}
    >
      <span className="size-1.5 rounded-full bg-current" />
      {children}
    </span>
  );
}

function DebtsPage() {
  const { t, lang } = useI18n();
  const navigate = useNavigate();
  const searchParams = Route.useSearch();
  const customerId = searchParams?.customerId;
  const isAr = lang === "ar";

  const [rows, setRows] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [quickFilter, setQuickFilter] = useState<"all" | "debt" | "over_limit">("debt");
  const [filters, setFilters] = useState<FilterValues>({});
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [sort, setSort] = useState<DataTableSort | null>(null);
  const [sortOpen, setSortOpen] = useState(false);
  const [viewMode, setViewMode] = usePersistedViewMode("debts", "cards");

  const [collectionCustomer, setCollectionCustomer] = useState<{
    id: string;
    name: string;
    phone: string | null;
    balance: number;
  } | null>(null);
  const [collectionOpen, setCollectionOpen] = useState(false);
  const [selected, setSelected] = useState<Customer | null>(null);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);

  // أرصدة مؤكَّدة من الدفتر — مصدر واحد لكل الشاشات
  const { index: ledgerIndex } = useDebtIndex("customer");

  async function load() {
    setLoading(true);
    const { data } = await supabase
      .from("customers")
      .select("id,name,phone,email,balance,credit_limit,is_system")
      .eq("is_active", true)
      .order("balance", { ascending: false });
    const list = ((data ?? []) as Customer[]).filter((customer) => !customer.is_system);
    setRows(list);
    setLoading(false);

    if (customerId) {
      let target = list.find((c) => c.id === customerId);
      if (!target) {
        const { data: c } = await supabase
          .from("customers")
          .select("id,name,phone,email,balance,credit_limit,is_system")
          .eq("id", customerId)
          .maybeSingle();
        if (c && !(c as Customer).is_system) target = c as Customer;
      }
      if (target) {
        void openDetail(target);
      }
    }
  }
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerId]);

  async function openDetail(c: Customer) {
    setSelected(c);
    const [inv, pay] = await Promise.all([
      supabase
        .from("sales_invoices")
        .select("id,invoice_number,total,paid,created_at,status")
        .eq("customer_id", c.id)
        .order("created_at", { ascending: false }),
      supabase
        .from("customer_payments")
        .select(
          "id,amount,payment_date,payment_method,note,invoice_id,sales_invoices(invoice_number)",
        )
        .eq("customer_id", c.id)
        .order("payment_date", { ascending: false }),
    ]);
    setInvoices((inv.data ?? []) as Invoice[]);
    setPayments((pay.data ?? []) as Payment[]);
  }

  /* ─── صفوف مشتقّة: الرصيد من الدفتر + الفلاتر + الترتيب + البحث ─── */

  const allRows = useMemo<DebtRow[]>(
    () =>
      rows.map((r) => {
        const ledgerRow = ledgerIndex.get(r.id);
        const ledgerBalance = ledgerRow ? ledgerRow.ledgerBalance : Number(r.balance);
        const creditLimit = Number(r.credit_limit);
        return {
          ...r,
          ledgerBalance,
          creditLimit,
          overLimit: creditLimit > 0 && ledgerBalance > creditLimit,
          hasGap: Boolean(ledgerRow?.hasGap),
          integrity: ledgerRow
            ? {
                ledgerBalance: ledgerRow.ledgerBalance,
                cachedBalance: ledgerRow.cachedBalance,
                difference: ledgerRow.difference,
                hasGap: ledgerRow.hasGap,
              }
            : null,
        };
      }),
    [rows, ledgerIndex],
  );

  /** تعريفات الفلترة المتقدمة — نفس عقد شاشة المنتجات. */
  const filterDefinitions = useMemo<FilterDefinition[]>(
    () => [
      {
        key: "status",
        label: isAr ? "الحالة" : "Status",
        type: "select",
        options: [
          { value: "debtor", label: t("debts.debtor") },
          { value: "clear", label: t("debts.clear") },
          { value: "over_limit", label: t("debts.filter.over_limit") },
        ],
      },
      {
        key: "has_phone",
        label: isAr ? "رقم الهاتف" : "Phone number",
        type: "boolean",
      },
      {
        key: "has_gap",
        label: isAr ? "فرق تسوية" : "Reconciliation gap",
        type: "boolean",
      },
      {
        key: "min_balance",
        label: isAr ? "أدنى رصيد" : "Minimum balance",
        type: "text",
        placeholder: "0",
      },
    ],
    [isAr, t],
  );

  const sortOptions = useMemo<SortOption[]>(
    () => [
      { value: "name", label: isAr ? "الاسم" : "Name" },
      { value: "balance", label: t("common.balance") },
      { value: "credit_limit", label: t("customers.credit_limit") },
    ],
    [isAr, t],
  );

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    let next = allRows;

    // شرائح سريعة
    if (quickFilter === "debt") next = next.filter((r) => r.ledgerBalance > 0);
    if (quickFilter === "over_limit") next = next.filter((r) => r.overLimit);

    // بحث نصي
    if (q) {
      next = next.filter(
        (r) =>
          r.name.toLowerCase().includes(q) ||
          (r.phone ?? "").includes(q) ||
          (r.email ?? "").toLowerCase().includes(q),
      );
    }

    // الفلترة المتقدمة
    next = applyFilters(next, filters, {
      status: (r) => (r.overLimit ? "over_limit" : r.ledgerBalance > 0 ? "debtor" : "clear"),
      has_phone: (r) => ((r.phone ?? "").trim() ? "true" : "false"),
      has_gap: (r) => (r.hasGap ? "true" : "false"),
    });

    // «أدنى رصيد» رقمي (أكبر من أو يساوي) وليس مساواة
    const minBalance = filters.min_balance;
    if (typeof minBalance === "string" && minBalance.trim() !== "") {
      const value = Number(minBalance);
      if (!Number.isNaN(value)) next = next.filter((r) => r.ledgerBalance >= value);
    }

    // الترتيب
    if (sort) {
      const dir = sort.direction === "desc" ? -1 : 1;
      next = [...next].sort((a, b) => {
        if (sort.key === "name") return a.name.localeCompare(b.name) * dir;
        if (sort.key === "credit_limit") return (a.creditLimit - b.creditLimit) * dir;
        return (a.ledgerBalance - b.ledgerBalance) * dir;
      });
    }

    return next;
  }, [allRows, search, quickFilter, filters, sort]);

  // مجاميع مشتقّة من نفس مصدر الصفوف — لا منطق مكرر
  const totals = useMemo(() => {
    let totalDebt = 0;
    let debtors = 0;
    let overLimit = 0;
    for (const r of allRows) {
      if (r.ledgerBalance > 0) {
        totalDebt = Math.round((totalDebt + r.ledgerBalance) * 100) / 100;
        debtors += 1;
        if (r.overLimit) overLimit += 1;
      }
    }
    return { totalDebt, debtors, overLimit };
  }, [allRows]);

  const countActiveFilters = (values: FilterValues) =>
    Object.values(values).filter((value) => {
      if (value == null) return false;
      if (typeof value === "string") return value !== "";
      return Boolean(value.from || value.to);
    }).length;

  // The catalogue, not a local map — same change as the payments screen.
  const pmLabel = (m: string) => paymentMethodLabel(m, isAr ? "ar" : "en");

  /** الرصيد المعتمد للعميل المحدد — من الدفتر لا من العمود المخزَّن */
  const selectedLedgerRow = selected ? ledgerIndex.get(selected.id) : undefined;
  const selectedLedgerBalance = selectedLedgerRow
    ? selectedLedgerRow.ledgerBalance
    : Number(selected?.balance ?? 0);
  const selectedIntegrity = selectedLedgerRow
    ? {
        ledgerBalance: selectedLedgerRow.ledgerBalance,
        cachedBalance: selectedLedgerRow.cachedBalance,
        difference: selectedLedgerRow.difference,
        hasGap: selectedLedgerRow.hasGap,
      }
    : null;

  /** ينتقل إلى شاشة كشف الحساب — بلا قالب محلي مكرر */
  function goStatement(customerIdToOpen: string) {
    void navigate({
      to: "/statements/$entityType",
      params: { entityType: "customer" },
      search: { customerId: customerIdToOpen } as never,
    });
  }

  /** يفتح شيت التحصيل الفوري — نفس الشيت المستخدم في بقية الشاشات. */
  function openCollection(customer: Customer, balance: number) {
    setCollectionCustomer({
      id: customer.id,
      name: customer.name,
      phone: customer.phone,
      balance,
    });
    setCollectionOpen(true);
  }

  const totalInvoiced = invoices.reduce((sum, i) => sum + Number(i.total), 0);
  const totalCollected = payments.reduce((sum, p) => sum + Number(p.amount), 0);
  const totalRemaining = invoices.reduce(
    (sum, i) => sum + Math.max(0, Number(i.total) - Number(i.paid)),
    0,
  );
  const ledgerSummary = selectedIntegrity
    ? [
        { label: isAr ? "رصيد الدفتر" : "Ledger", value: selectedIntegrity.ledgerBalance },
        {
          label: isAr ? "المخزَّن" : "Cached",
          value: Number(selectedIntegrity.cachedBalance ?? 0),
        },
        {
          label: isAr ? "الفرق" : "Difference",
          value: Number(selectedIntegrity.difference ?? 0),
        },
      ]
    : [];

  /* ───────── عارضات الصف الواحد — بطاقة / صف قائمة / أعمدة جدول ───────── */

  const initials = (name: string) => name.trim().slice(0, 2);

  const statusLabel = (r: DebtRow) =>
    r.overLimit
      ? t("debts.filter.over_limit")
      : r.ledgerBalance > 0
        ? t("debts.debtor")
        : t("debts.clear");

  const statusTone = (r: DebtRow) =>
    r.overLimit ? "danger" : r.ledgerBalance > 0 ? "warning" : "success";

  const balanceTone = (r: DebtRow) =>
    r.overLimit
      ? "text-rose-600 dark:text-rose-400"
      : r.ledgerBalance > 0
        ? "text-amber-600 dark:text-amber-400"
        : "text-muted-foreground";

  const renderCard = (r: DebtRow) => (
    <div
      className={cn(
        "card-mullak group relative flex h-full flex-col overflow-hidden rounded-2xl border border-r-4 p-3 transition-all duration-200 hover:shadow-md sm:p-4.5",
        r.overLimit
          ? "border-r-rose-500 hover:border-rose-500/60"
          : r.ledgerBalance > 0
            ? "border-r-amber-500 shadow-amber-500/5 hover:border-amber-500/60"
            : "border-r-emerald-500 shadow-emerald-500/5 hover:border-emerald-500/60",
      )}
    >
      <div className="mb-2 flex items-center justify-between gap-1.5">
        <div className="flex min-w-0 items-center gap-1.5">
          <div
            className={cn(
              "grid size-8 shrink-0 place-items-center rounded-xl border text-[10px] font-black uppercase",
              r.ledgerBalance > 0
                ? "border-amber-500/25 bg-amber-500/10 text-amber-600 dark:text-amber-400"
                : "border-emerald-500/25 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
            )}
          >
            {initials(r.name)}
          </div>
          <DebtStatusPill tone={statusTone(r)}>{statusLabel(r)}</DebtStatusPill>
        </div>
        {r.hasGap && r.integrity && <StatementIntegrityBadge integrity={r.integrity} />}
      </div>

      <h4
        className="mb-2 line-clamp-2 text-xs font-bold leading-snug text-foreground transition-colors group-hover:text-primary sm:text-sm"
        dir={isAr ? "rtl" : "ltr"}
      >
        {r.name}
      </h4>

      <div className="mb-2.5 flex flex-wrap items-center gap-1 text-[10px] text-muted-foreground">
        {r.phone && (
          <span className="inline-flex items-center gap-1 rounded-md border border-border/50 bg-surface-2/70 px-1.5 py-0.2 font-mono">
            <Phone className="size-2.5" />
            <Ltr>{r.phone}</Ltr>
          </span>
        )}
        <span className="inline-flex items-center gap-1 rounded-md border border-primary/20 bg-primary/10 px-1.5 py-0.2 font-semibold text-primary">
          {isAr ? "الحد:" : "Limit:"} {toSystemDigits(money(r.creditLimit))}
        </span>
      </div>

      <div className="mt-auto flex items-center justify-between gap-1.5 border-t border-border/60 pt-2">
        <div className="min-w-0">
          <p className="text-[9px] font-medium text-muted-foreground sm:text-[10px]">
            {t("debts.balance")}
          </p>
          <p
            className={cn(
              "truncate font-mono text-sm font-black tabular-nums sm:text-base",
              balanceTone(r),
            )}
          >
            <Ltr>{money(r.ledgerBalance)}</Ltr>
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {r.ledgerBalance > 0 && (
            <>
              <Button
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  openCollection(r, r.ledgerBalance);
                }}
                className="h-8 gap-1 rounded-full px-2.5 text-[11px] font-bold shadow-xs shadow-primary/20"
              >
                <Wallet className="size-3.5" />
                <span className="hidden sm:inline">{isAr ? "تحصيل" : "Collect"}</span>
              </Button>
              <WhatsAppButton
                phone={r.phone}
                message={debtReminderMessage({
                  name: r.name,
                  balance: money(r.ledgerBalance),
                  lang,
                })}
                className="inline-flex size-8 items-center justify-center rounded-full border border-emerald-500/30 bg-emerald-500/10 text-emerald-600 transition hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-40 dark:text-emerald-400"
              />
            </>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => void openDetail(r)}
            className="size-8 rounded-full border-border/80 p-0"
            title={t("debts.view")}
          >
            <ArrowUpRight className="size-3.5 text-muted-foreground" />
          </Button>
        </div>
      </div>
    </div>
  );

  const renderListRow = (r: DebtRow) => (
    <div
      className={cn(
        "card-mullak flex items-center gap-3 overflow-hidden rounded-2xl border border-s-4 px-3.5 py-3 transition-all duration-200 hover:shadow-md sm:px-4",
        r.overLimit
          ? "border-s-rose-500"
          : r.ledgerBalance > 0
            ? "border-s-amber-500"
            : "border-s-emerald-500",
      )}
    >
      <div
        className={cn(
          "grid size-10 shrink-0 place-items-center rounded-2xl border text-[11px] font-black uppercase",
          r.ledgerBalance > 0
            ? "border-amber-500/25 bg-amber-500/10 text-amber-600 dark:text-amber-400"
            : "border-emerald-500/25 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
        )}
      >
        {initials(r.name)}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-bold text-foreground">{r.name}</span>
          {r.hasGap && r.integrity && <StatementIntegrityBadge integrity={r.integrity} />}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1 font-mono">
            <Phone className="size-3 opacity-60" />
            <Ltr>{r.phone ?? "—"}</Ltr>
          </span>
          <span className="hidden sm:inline">
            {isAr ? "الحد الائتماني:" : "Credit limit:"}{" "}
            <span className="font-mono">{toSystemDigits(money(r.creditLimit))}</span>
          </span>
        </div>
      </div>

      <div className="hidden sm:block">
        <DebtStatusPill tone={statusTone(r)}>{statusLabel(r)}</DebtStatusPill>
      </div>

      <div className="min-w-[92px] text-end">
        <p className="text-[9px] text-muted-foreground sm:hidden">{t("debts.balance")}</p>
        <p className={cn("font-mono text-sm font-black tabular-nums", balanceTone(r))}>
          <Ltr>{money(r.ledgerBalance)}</Ltr>
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-1">
        {r.ledgerBalance > 0 && (
          <>
            <Button
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                openCollection(r, r.ledgerBalance);
              }}
              className="h-8 gap-1 rounded-full px-2.5 text-[11px] font-bold shadow-xs shadow-primary/20"
            >
              <Wallet className="size-3.5" />
              <span className="hidden md:inline">{isAr ? "تحصيل" : "Collect"}</span>
            </Button>
            <WhatsAppButton
              phone={r.phone}
              message={debtReminderMessage({
                name: r.name,
                balance: money(r.ledgerBalance),
                lang,
              })}
              className="hidden size-8 items-center justify-center rounded-full border border-emerald-500/30 bg-emerald-500/10 text-emerald-600 transition hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-40 sm:inline-flex dark:text-emerald-400"
            />
          </>
        )}
        <Button
          variant="outline"
          size="sm"
          onClick={() => void openDetail(r)}
          className="h-8 gap-1 rounded-full border-border/80 px-3 text-[11px] font-semibold"
        >
          {t("debts.view")}
          <ArrowUpRight className="size-3.5 text-muted-foreground" />
        </Button>
      </div>
    </div>
  );

  const columns: DataTableColumn<DebtRow>[] = [
    {
      key: "name",
      header: t("common.customer"),
      sortable: true,
      cell: (r) => (
        <div className="flex items-center gap-3">
          <div
            className={cn(
              "grid size-9 shrink-0 place-items-center rounded-2xl border text-[11px] font-black uppercase",
              r.ledgerBalance > 0
                ? "border-amber-500/25 bg-amber-500/10 text-amber-600 dark:text-amber-400"
                : "border-emerald-500/25 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
            )}
          >
            {initials(r.name)}
          </div>
          <div className="min-w-0">
            <span className="block truncate font-semibold text-foreground">{r.name}</span>
            <span className="block truncate text-[11px] text-muted-foreground">
              {r.email || (isAr ? "لا يوجد بريد" : "No email")}
            </span>
          </div>
        </div>
      ),
    },
    {
      key: "phone",
      header: t("common.phone"),
      hideBelow: "sm",
      cell: (r) => (
        <span className="inline-flex items-center gap-1.5 font-mono text-xs text-muted-foreground">
          <Phone className="size-3 opacity-60" />
          <Ltr>{r.phone ?? "—"}</Ltr>
        </span>
      ),
    },
    {
      key: "credit_limit",
      header: t("customers.credit_limit"),
      align: "end",
      sortable: true,
      hideBelow: "md",
      cell: (r) => (
        <span className="font-mono text-xs text-muted-foreground">
          <Ltr>{money(r.creditLimit)}</Ltr>
        </span>
      ),
    },
    {
      key: "balance",
      header: t("common.balance"),
      align: "end",
      sortable: true,
      cell: (r) => (
        <div className="flex items-center justify-end gap-1.5">
          {r.hasGap && r.integrity && <StatementIntegrityBadge integrity={r.integrity} />}
          <span className={cn("font-mono text-sm font-black tabular-nums", balanceTone(r))}>
            <Ltr>{money(r.ledgerBalance)}</Ltr>
          </span>
        </div>
      ),
    },
    {
      key: "status",
      header: t("common.status"),
      hideBelow: "sm",
      cell: (r) =>
        r.overLimit ? (
          <DebtStatusPill tone="danger">
            <AlertCircle className="size-3" />
            {t("debts.filter.over_limit")}
          </DebtStatusPill>
        ) : (
          <DebtStatusPill tone={statusTone(r)}>{statusLabel(r)}</DebtStatusPill>
        ),
    },
    {
      key: "actions",
      header: "",
      align: "end",
      cell: (r) => (
        <div className="flex items-center justify-end gap-1.5">
          {r.ledgerBalance > 0 && (
            <>
              <Button
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  openCollection(r, r.ledgerBalance);
                }}
                className="h-8 gap-1.5 rounded-full px-3 text-[11px] font-bold shadow-xs shadow-primary/20"
              >
                <Wallet className="size-3.5" />
                <span>{isAr ? "تحصيل" : "Collect"}</span>
              </Button>
              <WhatsAppButton
                phone={r.phone}
                message={debtReminderMessage({
                  name: r.name,
                  balance: money(r.ledgerBalance),
                  lang,
                })}
                className="inline-flex size-8 items-center justify-center rounded-full border border-emerald-500/30 bg-emerald-500/10 text-emerald-600 transition hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-40 dark:text-emerald-400"
              />
            </>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              void openDetail(r);
            }}
            className="h-8 gap-1 rounded-full border-border/80 px-3 text-[11px] font-semibold"
          >
            {t("debts.view")}
            <ArrowUpRight className="size-3.5 text-muted-foreground" />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title={t("debts.title")}
        subtitle={t("debts.subtitle")}
        actions={
          <Link
            to="/payments"
            className="flex h-10 items-center gap-1.5 rounded-full bg-primary px-4 text-xs font-semibold text-primary-foreground shadow-sm shadow-primary/20 hover:opacity-90"
          >
            <Wallet className="size-3.5" />
            {t("debts.record_payment")}
          </Link>
        }
      />

      {/* ─── Luxury Vortex Metric Cards ─── */}
      <div className="mb-5 grid grid-cols-1 gap-3.5 sm:grid-cols-3">
        <VortexMetricCard
          title={t("debts.total_debt")}
          value={totals.totalDebt}
          highlight
          icon={<Wallet className="size-5 text-amber-600 dark:text-amber-400" />}
          iconClassName="bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20"
          subtitle={
            isAr ? "إجمالي المبالغ المستحقة طرف العملاء" : "Total outstanding from customers"
          }
          onClick={() => setQuickFilter("debt")}
          className="cursor-pointer"
        />
        <VortexMetricCard
          title={t("debts.debtors")}
          value={totals.debtors}
          currency={isAr ? "عميل" : "customers"}
          icon={<UserCheck className="size-5 text-sky-600 dark:text-sky-400" />}
          iconClassName="bg-sky-500/10 text-sky-600 dark:text-sky-400 border border-sky-500/20"
          subtitle={isAr ? "عملاء عليهم أرصدة مدينة قائمة" : "Customers holding an open balance"}
          onClick={() => setQuickFilter("debt")}
          highlight={quickFilter === "debt"}
          className="cursor-pointer"
        />
        <VortexMetricCard
          title={t("debts.over_limit")}
          value={totals.overLimit}
          currency={isAr ? "حساب" : "accounts"}
          icon={<AlertTriangle className="size-5 text-rose-600 dark:text-rose-400" />}
          iconClassName="bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20"
          subtitle={
            isAr ? "حسابات تجاوزت الحد الائتماني المسموح" : "Accounts past their credit limit"
          }
          onClick={() => setQuickFilter("over_limit")}
          highlight={quickFilter === "over_limit"}
          className="cursor-pointer"
        />
      </div>

      {/* ─── شريط السجلات الموحّد: بحث + فلترة + ترتيب + عرض ─── */}
      <div className="pt-2 sm:pt-3.5">
        <RecordsToolbar
          searchValue={search}
          onSearchChange={setSearch}
          searchPlaceholder={t("debts.search_customer")}
          resultCount={filteredRows.length}
          searchLoading={loading}
          filterLabel={isAr ? "فلترة" : "Filter"}
          activeFilterCount={countActiveFilters(filters)}
          onFilterOpen={() => setFiltersOpen(true)}
          onClearFilters={() => {
            setFilters({});
            setSearch("");
            setQuickFilter("all");
          }}
          sortActive={Boolean(sort)}
          sortLabel={isAr ? "ترتيب" : "Sort"}
          onSortOpen={() => setSortOpen(true)}
          viewMode={viewMode as RecordsViewMode}
          onViewModeChange={setViewMode}
          action={
            <Button
              size="sm"
              variant="outline"
              onClick={() => void load()}
              disabled={loading}
              className="h-9 rounded-full border-border/80 px-3 text-xs font-medium"
            >
              {t("common.refresh")}
            </Button>
          }
        >
          {/* شرائح سريعة — تظهر في الأوضاع الثلاثة دائمًا */}
          <QuickFilterBar
            ariaLabel={t("debts.subtitle")}
            items={[
              { id: "all", label: t("debts.filter.all"), tone: "primary", count: allRows.length },
              {
                id: "debt",
                label: t("debts.filter.debtors"),
                tone: "warning",
                count: totals.debtors,
              },
              {
                id: "over_limit",
                label: t("debts.filter.over_limit"),
                tone: "danger",
                count: totals.overLimit,
              },
            ]}
            value={quickFilter}
            onChange={(id) => setQuickFilter(id as typeof quickFilter)}
          />
        </RecordsToolbar>

        <RecordsFilterPanel
          open={filtersOpen}
          onClose={() => setFiltersOpen(false)}
          definitions={filterDefinitions}
          values={filters}
          onSubmit={(next) => {
            setFilters(next);
            setFiltersOpen(false);
          }}
        />
        <RecordsSortPanel
          open={sortOpen}
          onClose={() => setSortOpen(false)}
          options={sortOptions}
          value={sort?.key ?? ""}
          onSubmit={(value) => {
            setSort(value ? { key: value, direction: sort?.direction ?? "asc" } : null);
            setSortOpen(false);
          }}
        />
      </div>

      {/* ─── عرض السجلات: بطاقات / قائمة / جدول ─── */}
      <RecordsView<DebtRow>
        rows={filteredRows}
        getRowId={(r) => r.id}
        viewMode={viewMode as RecordsViewMode}
        columns={columns}
        sort={sort}
        onSortChange={setSort}
        renderCard={renderCard}
        renderListRow={renderListRow}
        onRowClick={(r) => void openDetail(r)}
        loading={loading}
        empty={{
          icon: <Users className="size-8" />,
          title: isAr ? "لا توجد نتائج مطابقة" : "No matching results",
          description: isAr
            ? "جرّب تعديل كلمة البحث أو إعادة تعيين الفلاتر."
            : "Try a different search term or reset the filters.",
          action: (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setFilters({});
                setSearch("");
                setQuickFilter("all");
              }}
            >
              {t("records.filters.clear_all")}
            </Button>
          ),
        }}
        className="mt-3"
      />

      <VortexCollectionSheet
        open={collectionOpen}
        onOpenChange={setCollectionOpen}
        customer={collectionCustomer}
        onSuccess={() => {
          void load();
        }}
      />

      {/* ─── درج ملف العميل — نفس حاوية VortexDrawerDialog في كل الشاشات ─── */}
      <VortexDrawerDialog
        open={!!selected}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
        size="lg"
        title={selected?.name ?? ""}
        subtitle={`${t("debts.customer_record")} · ${selected?.phone ?? (isAr ? "بلا هاتف" : "No phone")}`}
        icon={<Users className="size-5" />}
        footer={
          selected ? (
            <div className="flex w-full flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-wrap items-center gap-2">
                {selectedLedgerBalance > 0 && (
                  <WhatsAppButton
                    phone={selected.phone}
                    label={isAr ? "تذكير واتساب" : "WhatsApp reminder"}
                    message={debtReminderMessage({
                      name: selected.name,
                      balance: money(selectedLedgerBalance),
                      lang,
                    })}
                    className="flex h-9 items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-4 text-xs font-semibold text-emerald-600 transition hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-40 dark:text-emerald-400"
                  />
                )}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => goStatement(selected.id)}
                  className="h-9 gap-1.5 rounded-full text-xs font-semibold"
                >
                  <FileText className="size-3.5 text-primary" />
                  {isAr ? "كشف حساب / PDF" : "Statement / PDF"}
                </Button>
              </div>
              <div className="flex items-center justify-end gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setSelected(null)}
                  className="h-9 rounded-full text-xs"
                >
                  {t("common.close")}
                </Button>
                {selectedLedgerBalance > 0 && (
                  <Button
                    size="sm"
                    onClick={() => openCollection(selected, selectedLedgerBalance)}
                    className="h-9 gap-1.5 rounded-full text-xs font-bold shadow-xs shadow-primary/20"
                  >
                    <Wallet className="size-3.5" />
                    {isAr ? "تحصيل دفعة" : "Record payment"}
                  </Button>
                )}
              </div>
            </div>
          ) : null
        }
      >
        {selected && (
          <div className="space-y-4">
            {/* ملخّص الرصيد */}
            <div className="relative overflow-hidden rounded-3xl border border-border/70 bg-gradient-to-br from-primary/5 via-card to-card p-5 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                    {t("debts.balance")}
                  </span>
                  <div
                    className={cn(
                      "font-mono text-3xl font-black tracking-tight",
                      selectedLedgerBalance > 0
                        ? "text-amber-600 dark:text-amber-400"
                        : "text-emerald-600 dark:text-emerald-400",
                    )}
                  >
                    <Ltr>{money(selectedLedgerBalance)}</Ltr>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <DebtStatusPill tone={selectedLedgerBalance > 0 ? "warning" : "success"}>
                      {selectedLedgerBalance > 0 ? t("debts.debtor") : t("debts.clear")}
                    </DebtStatusPill>
                    <span className="text-[11px] text-muted-foreground">
                      {isAr ? "الحد الائتماني:" : "Credit limit:"}{" "}
                      <span className="font-mono font-semibold text-foreground">
                        <Ltr>{money(Number(selected.credit_limit))}</Ltr>
                      </span>
                    </span>
                  </div>
                </div>
                <div className="grid size-12 shrink-0 place-items-center rounded-2xl border border-primary/20 bg-primary/10 text-primary">
                  <Wallet className="size-6" />
                </div>
              </div>
            </div>

            {selectedIntegrity?.hasGap && (
              <StatementIntegrityBadge integrity={selectedIntegrity} variant="panel" />
            )}

            {/* مؤشرات الملف */}
            <div className="grid grid-cols-3 gap-2.5">
              {[
                {
                  label: isAr ? "إجمالي الفواتير" : "Invoiced",
                  value: totalInvoiced,
                  tone: "text-foreground",
                },
                {
                  label: isAr ? "إجمالي التحصيل" : "Collected",
                  value: totalCollected,
                  tone: "text-emerald-600 dark:text-emerald-400",
                },
                {
                  label: t("debts.remaining"),
                  value: totalRemaining,
                  tone: "text-amber-600 dark:text-amber-400",
                },
              ].map((stat) => (
                <div
                  key={stat.label}
                  className="space-y-0.5 rounded-2xl border border-border/70 bg-card p-3.5"
                >
                  <span className="block text-[11px] font-bold text-muted-foreground">
                    {stat.label}
                  </span>
                  <p className={cn("font-mono text-base font-black", stat.tone)}>
                    <Ltr>{money(stat.value)}</Ltr>
                  </p>
                </div>
              ))}
            </div>

            {ledgerSummary.length > 0 && (
              <div className="grid grid-cols-3 gap-2 rounded-2xl border border-border/60 bg-muted/30 p-3 text-center text-[11px]">
                {ledgerSummary.map((item) => (
                  <div key={item.label}>
                    <span className="block font-medium text-muted-foreground">{item.label}</span>
                    <span className="font-mono font-bold text-foreground">
                      <Ltr>{money(item.value)}</Ltr>
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* الفواتير */}
            <section className="space-y-2">
              <div className="flex items-center justify-between">
                <h4 className="flex items-center gap-1.5 text-xs font-bold text-foreground">
                  <FileText className="size-3.5 text-primary" />
                  {t("debts.invoices")}
                </h4>
                <span className="rounded-md border border-border/50 bg-muted/50 px-2 py-0.5 font-mono text-[11px] font-bold text-muted-foreground">
                  {toSystemDigits(invoices.length)}
                </span>
              </div>
              {invoices.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-border/70 bg-card/50 py-8 text-center text-xs text-muted-foreground">
                  {t("debts.no_invoices")}
                </div>
              ) : (
                <div className="overflow-hidden rounded-2xl border border-border/70 bg-card">
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead className="border-b border-border/60 bg-muted/40 text-muted-foreground">
                        <tr>
                          <th className="px-3.5 py-2.5 text-start font-semibold">#</th>
                          <th className="px-3.5 py-2.5 text-start font-semibold">
                            {isAr ? "التاريخ" : "Date"}
                          </th>
                          <th className="px-3.5 py-2.5 text-end font-semibold">
                            {isAr ? "الإجمالي" : "Total"}
                          </th>
                          <th className="px-3.5 py-2.5 text-end font-semibold">
                            {isAr ? "المدفوع" : "Paid"}
                          </th>
                          <th className="px-3.5 py-2.5 text-end font-semibold">
                            {t("debts.remaining")}
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/40">
                        {invoices.map((i) => {
                          const rem = Number(i.total) - Number(i.paid);
                          return (
                            <tr key={i.id} className="transition-colors hover:bg-muted/20">
                              <td className="px-3.5 py-2.5 font-mono text-muted-foreground">
                                <Ltr>{i.invoice_number}</Ltr>
                              </td>
                              <td className="px-3.5 py-2.5">
                                <VortexDateBadge date={i.created_at} size="sm" showTime={false} />
                              </td>
                              <td className="px-3.5 py-2.5 text-end font-mono text-foreground">
                                <Ltr>{money(Number(i.total))}</Ltr>
                              </td>
                              <td className="px-3.5 py-2.5 text-end font-mono font-semibold text-emerald-600 dark:text-emerald-400">
                                <Ltr>{money(Number(i.paid))}</Ltr>
                              </td>
                              <td
                                className={cn(
                                  "px-3.5 py-2.5 text-end font-mono",
                                  rem > 0
                                    ? "font-bold text-amber-600 dark:text-amber-400"
                                    : "text-muted-foreground",
                                )}
                              >
                                <Ltr>{money(rem)}</Ltr>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </section>

            {/* التحصيلات */}
            <section className="space-y-2">
              <div className="flex items-center justify-between">
                <h4 className="flex items-center gap-1.5 text-xs font-bold text-foreground">
                  <Wallet className="size-3.5 text-emerald-600 dark:text-emerald-400" />
                  {t("debts.collections")}
                </h4>
                <span className="rounded-md border border-border/50 bg-muted/50 px-2 py-0.5 font-mono text-[11px] font-bold text-muted-foreground">
                  {toSystemDigits(payments.length)}
                </span>
              </div>
              {payments.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-border/70 bg-card/50 py-8 text-center text-xs text-muted-foreground">
                  {t("debts.no_collections")}
                </div>
              ) : (
                <div className="overflow-hidden rounded-2xl border border-border/70 bg-card">
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead className="border-b border-border/60 bg-muted/40 text-muted-foreground">
                        <tr>
                          <th className="px-3.5 py-2.5 text-start font-semibold">
                            {isAr ? "التاريخ" : "Date"}
                          </th>
                          <th className="px-3.5 py-2.5 text-start font-semibold">
                            {isAr ? "الفاتورة" : "Invoice"}
                          </th>
                          <th className="px-3.5 py-2.5 text-start font-semibold">
                            {isAr ? "الطريقة" : "Method"}
                          </th>
                          <th className="px-3.5 py-2.5 text-end font-semibold">
                            {isAr ? "المبلغ" : "Amount"}
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/40">
                        {payments.map((p) => (
                          <tr key={p.id} className="transition-colors hover:bg-muted/20">
                            <td className="px-3.5 py-2.5">
                              <VortexDateBadge date={p.payment_date} size="sm" showTime={false} />
                            </td>
                            <td className="px-3.5 py-2.5 font-mono text-muted-foreground">
                              <Ltr>{p.sales_invoices?.invoice_number ?? t("debts.on_account")}</Ltr>
                            </td>
                            <td className="px-3.5 py-2.5 text-muted-foreground">
                              {pmLabel(p.payment_method)}
                            </td>
                            <td className="px-3.5 py-2.5 text-end font-mono font-bold text-emerald-600 dark:text-emerald-400">
                              <Ltr>{money(Number(p.amount))}</Ltr>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </section>
          </div>
        )}
      </VortexDrawerDialog>
    </>
  );
}

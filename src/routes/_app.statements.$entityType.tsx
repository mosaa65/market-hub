/**
 * /statements/$entityType — شاشة كشف الحساب
 *
 * لكل نوع كشف مسار مستقل في القائمة الجانبية: العملاء، الموردون، والصندوق/البنك.
 * التقارير التشغيلية لها قسم مستقل تماماً تحت /reports ولا تُعرض هنا.
 */

import { ModuleGuard } from "@/lib/modules";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { z } from "zod";
import {
  FileSpreadsheet,
  Loader2,
  Printer,
  Eye,
  Share2,
  ArrowDownUp,
  ArrowUp,
  ArrowDown,
  ChevronsUpDown,
} from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { useI18n } from "@/lib/i18n";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useStatement } from "@/hooks/use-statement";
import { useStatementSettings } from "@/lib/statements/settings";
import { printStatementDocument } from "@/lib/statements/print";
import { exportStatementToCsv, statementFilename } from "@/lib/statements/export";
import { Ltr } from "@/components/ltr-value";
import { fmtAmount, fmtOrDash } from "@/lib/statements/format";
import { directionLabel } from "@/lib/statements/format";
import { paymentMethodLabel as paymentMethodLabelFromCatalog } from "@/lib/payments/payment-methods";
import { kindLabel } from "@/lib/statements/engine";
import {
  DEFAULT_COMPANY_INFO,
  resolveCurrencySymbol,
  type StatementCompanyInfo,
} from "@/lib/statements/company";
import {
  StatementIntegrityBadge,
  SourceBadge,
} from "@/components/statements/statement-integrity-badge";
import { CASH_ENTITY_ID } from "@/lib/statements/adapters/cash";
import type {
  StatementFieldKey,
  StatementTransaction,
} from "@/lib/statements/types";
import {
  ReportFilterMenu,
  type ReportFilterPreset,
  type ReportFilterValues,
} from "@/components/statements/report-filter-menu";
import { ColumnVisibilityMenu } from "@/components/statements/column-visibility-menu";
import { StatementEntryDetails } from "@/components/statements/entry-details";
import { money } from "@/lib/format";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { DocumentShareDialog } from "@/components/communication";
import { statementToContext } from "@/lib/communication";
import {
  DEFAULT_REPORT_PREFERENCES,
  getReportPreferences,
  saveReportPreferences,
} from "@/lib/statements/local-storage";
import { reportTypeForEntity, type ReportType } from "@/lib/statements/report-registry";
import { SearchInput } from "@/components/ui/search-input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { VortexDateBadge } from "@/components/vortex-ui";
import {
  CustomerFormDialog,
  type CustomerRecord,
} from "@/components/contacts/customer-form-dialog";
import {
  SupplierFormDialog,
  type SupplierRecord,
} from "@/components/contacts/supplier-form-dialog";

const accountStatementSearchSchema = z.object({
  customerId: z.string().optional(),
  entityId: z.string().optional(),
});

const statementParamsSchema = z.object({
  entityType: z.enum(["customer", "supplier", "cash"]),
});

export const Route = createFileRoute("/_app/statements/$entityType")({
  parseParams: (params) => statementParamsSchema.parse(params),
  validateSearch: (search: Record<string, unknown>) => accountStatementSearchSchema.parse(search),
  head: () => ({ meta: [{ title: "كشوفات الحسابات — Vortex ERP" }] }),
  component: () => (
    <ModuleGuard moduleId="payments">
      <StatementPage />
    </ModuleGuard>
  ),
});

interface PartyOption {
  id: string;
  name: string;
  phone?: string | null;
  balance?: number;
}

function periodPresets() {
  const today = new Date();
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  const startOfYear = new Date(today.getFullYear(), 0, 1);
  const daysAgo = (n: number) => {
    const d = new Date(today);
    d.setDate(d.getDate() - n);
    return d;
  };
  return [
    { key: "all", ar: "الكل", en: "All", from: "", to: "" },
    { key: "m30", ar: "30 يوم", en: "30d", from: iso(daysAgo(30)), to: iso(today) },
    { key: "m90", ar: "90 يوم", en: "90d", from: iso(daysAgo(90)), to: iso(today) },
    { key: "ytd", ar: "هذه السنة", en: "YTD", from: iso(startOfYear), to: iso(today) },
    { key: "month", ar: "هذا الشهر", en: "This month", from: iso(startOfMonth), to: iso(today) },
  ];
}

export function StatementPage() {
  const { t, lang } = useI18n();
  const ar = lang === "ar";
  const searchParams = Route.useSearch();
  const { entityType: partyType } = Route.useParams();
  const { settings } = useStatementSettings();
  const savedPreferences = useMemo(() => getReportPreferences(), []);

  // مسار كل نوع كشف هو مصدر الحقيقة؛ لا تختلط الأنواع في شاشة واحدة.
  const [partyId, setPartyId] = useState<string>(
    searchParams.entityId ?? searchParams.customerId ?? savedPreferences.entityId ?? "",
  );
  const [partyList, setPartyList] = useState<PartyOption[]>([]);
  const [loadingParties, setLoadingParties] = useState(false);
  const [detailEntry, setDetailEntry] = useState<StatementTransaction | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [customerFormOpen, setCustomerFormOpen] = useState(false);
  const [supplierFormOpen, setSupplierFormOpen] = useState(false);

  // ── البحث والفرز في جدول كشف الحساب ──
  const [tableSearch, setTableSearch] = useState("");
  const [sortField, setSortField] = useState<"date" | "debit" | "credit" | "balance">("date");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const [sortMenuOpen, setSortMenuOpen] = useState(false);

  // ── خيارات الفلترة والفترة ──
  const [from, setFrom] = useState(savedPreferences.from);
  const [to, setTo] = useState(savedPreferences.to);
  const [activePreset, setActivePreset] = useState(savedPreferences.preset);
  const [includeZero, setIncludeZero] = useState(
    savedPreferences.includeZeroRows || settings.includeZeroRowsDefault,
  );
  const [visibleColumns, setVisibleColumns] = useState<Record<StatementFieldKey, boolean>>({
    index: true,
    date: true,
    reference: true,
    kind: true,
    description: true,
    debit: true,
    credit: true,
    balance: true,
    paymentMethod: true,
    ...savedPreferences.visibleColumns,
  });

  useEffect(() => {
    saveReportPreferences({
      reportType: reportTypeForEntity(partyType),
      entityType: partyType,
      entityId: partyId,
      from,
      to,
      preset: activePreset,
      includeZeroRows: includeZero,
      visibleColumns,
    });
  }, [partyType, partyId, from, to, activePreset, includeZero, visibleColumns]);

  // جلب أطراف الحسابات
  useEffect(() => {
    let cancelled = false;

    async function loadParties() {
      if (partyType === "cash") {
        setPartyList([]);
        setPartyId(CASH_ENTITY_ID);
        return;
      }

      setLoadingParties(true);
      setPartyId("");
      setDetailEntry(null);
      const table = partyType === "customer" ? "customers" : "suppliers";
      const { data } = await supabase
        .from(table)
        .select("id, name, phone, balance")
        .eq("is_active", true)
        .order("name")
        .limit(1000);

      if (cancelled) return;
      const list = (data ?? []) as PartyOption[];
      setPartyList(list);
      setLoadingParties(false);

      const deepLink =
        partyType === "customer"
          ? (searchParams.customerId ?? searchParams.entityId)
          : searchParams.entityId;
      if (deepLink && list.some((p) => p.id === deepLink)) setPartyId(deepLink);
      else if (list.length > 0) setPartyId(list[0].id);
    }

    void loadParties();
    return () => {
      cancelled = true;
    };
  }, [partyType]);

  // استدعاء محرك كشف الحساب
  const { result, layout, company, isLoading, hasSourceData, derived, refetch } = useStatement({
    entityType: partyType,
    entityId: partyId,
    from: from || null,
    to: to || null,
    includeZeroRows: includeZero,
    enabled: Boolean(partyId),
  });

  const currencySymbol = useMemo(
    () =>
      resolveCurrencySymbol(
        settings.currencySymbolOverride,
        company?.currencySymbol ?? DEFAULT_COMPANY_INFO.currencySymbol,
      ),
    [settings.currencySymbolOverride, company?.currencySymbol],
  );

  const totalDebit = result?.totalDebit ?? 0;
  const totalCredit = result?.totalCredit ?? 0;
  const closingBalance = result?.closingBalance ?? 0;
  const rawRows = result?.transactions ?? [];

  // تصفية وفرز الحركات
  const statementRows = useMemo(() => {
    let rows = [...rawRows];

    if (tableSearch.trim()) {
      const q = tableSearch.toLowerCase().trim();
      rows = rows.filter((r) => {
        const ref = (r.reference || "").toLowerCase();
        const desc = (r.description || "").toLowerCase();
        const kind = kindLabel(r.kind, partyType, lang).toLowerCase();
        const pm = String(r.meta?.paymentMethod ?? "").toLowerCase();
        const deb = String(r.debit ?? "");
        const cred = String(r.credit ?? "");
        return (
          ref.includes(q) ||
          desc.includes(q) ||
          kind.includes(q) ||
          pm.includes(q) ||
          deb.includes(q) ||
          cred.includes(q)
        );
      });
    }

    rows.sort((a, b) => {
      if (sortField === "date") {
        const t1 = new Date(a.occurredAt).getTime();
        const t2 = new Date(b.occurredAt).getTime();
        return sortDirection === "asc" ? t1 - t2 : t2 - t1;
      }
      if (sortField === "debit") {
        const v1 = a.debit ?? 0;
        const v2 = b.debit ?? 0;
        return sortDirection === "asc" ? v1 - v2 : v2 - v1;
      }
      if (sortField === "credit") {
        const v1 = a.credit ?? 0;
        const v2 = b.credit ?? 0;
        return sortDirection === "asc" ? v1 - v2 : v2 - v1;
      }
      if (sortField === "balance") {
        return sortDirection === "asc"
          ? a.runningBalance - b.runningBalance
          : b.runningBalance - a.runningBalance;
      }
      return 0;
    });

    return rows;
  }, [rawRows, tableSearch, sortField, sortDirection, partyType, lang]);

  const toggleSort = (field: "date" | "debit" | "credit" | "balance") => {
    if (sortField === field) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDirection("desc");
    }
  };

  const filterPresets: ReportFilterPreset[] = periodPresets().map((preset) => ({
    key: preset.key,
    label: ar ? preset.ar : preset.en,
    from: preset.from,
    to: preset.to,
  }));

  const filterValues: ReportFilterValues = {
    from,
    to,
    preset: activePreset,
    includeZeroRows: includeZero,
  };

  function updateFilterValues(next: ReportFilterValues) {
    setActivePreset(next.preset);
    setFrom(next.from);
    setTo(next.to);
    setIncludeZero(next.includeZeroRows);
  }

  function resetOptions() {
    setActivePreset("all");
    setFrom("");
    setTo("");
    setIncludeZero(settings.includeZeroRowsDefault);
  }

  function handlePrintPDF() {
    if (!result || !layout || !company) return;
    printStatementDocument({
      result,
      layout,
      lang,
      currencySymbol,
      company: company as StatementCompanyInfo,
      includeOpeningRow: layout.showOpeningRow,
    });
  }

  function handleExportCsv() {
    if (!result || !layout) return;
    exportStatementToCsv({
      result,
      layout,
      lang,
      filename: statementFilename(result, lang),
      currencySymbol,
    });
    toast.success(ar ? "تم تصدير الملف (CSV)" : "File exported (CSV)");
  }

  const activeParty = useMemo(
    () => partyList.find((p) => p.id === partyId) ?? null,
    [partyList, partyId],
  );

  const shareContext = useMemo(() => {
    if (!result) return null;
    return statementToContext(result);
  }, [result]);

  function handleShareStatement() {
    if (!result) return;
    if (partyType === "cash") {
      toast.info(
        ar
          ? "مشاركة كشف الصندوق غير متاحة — اختر حساب عميل أو مورد."
          : "Treasury statement sharing is not available — select a customer or supplier.",
      );
      return;
    }
    if (statementRows.length === 0) {
      toast.warning(
        ar
          ? "لا توجد أي حركات مالية في هذه الفترة لمشاركتها"
          : "No transactions in this period to share",
      );
      return;
    }
    setShareOpen(true);
  }

  const alignClass = (align: "start" | "center" | "end") =>
    align === "end" ? "text-end" : align === "center" ? "text-center" : "text-start";

  const columns = (layout?.columns ?? []).filter((column) => visibleColumns[column.key]);
  const columnOptions = (layout?.columns ?? []).map((column) => ({
    key: column.key,
    label: column.label,
  }));

  const renderCell = (row: StatementTransaction, key: StatementFieldKey): React.ReactNode => {
    switch (key) {
      case "index":
        return <Ltr className="font-mono text-xs text-muted-foreground">{row.index}</Ltr>;
      case "date":
        return <VortexDateBadge date={row.occurredAt} size="sm" showWeekday={false} />;
      case "kind":
        return (
          <span className="text-xs font-semibold">{kindLabel(row.kind, partyType, lang)}</span>
        );
      case "reference":
        return (
          <Ltr className="font-mono text-xs text-primary font-medium">{row.reference ?? "—"}</Ltr>
        );
      case "description":
        return <span className="text-xs text-muted-foreground">{row.description ?? "—"}</span>;
      case "debit":
        return <Ltr className="font-mono text-rose-500 font-bold">{fmtOrDash(row.debit)}</Ltr>;
      case "credit":
        return <Ltr className="font-mono text-emerald-500 font-bold">{fmtOrDash(row.credit)}</Ltr>;
      case "balance":
        return (
          <Ltr className="font-mono font-bold text-foreground">{fmtAmount(row.runningBalance)}</Ltr>
        );
      case "paymentMethod": {
        const rawPm = String(row.meta?.paymentMethod ?? "")
          .trim()
          .toLowerCase();
        const breakdown = String(row.meta?.paymentBreakdown ?? "").trim();
        const pmLabel = paymentMethodLabelFromCatalog(rawPm, ar ? "ar" : "en");
        return (
          <span
            className={`text-xs ${rawPm ? "font-medium text-foreground" : "text-muted-foreground"}`}
            title={breakdown || undefined}
          >
            {pmLabel}
            {breakdown && (
              <span className="block text-[10px] font-normal text-muted-foreground">
                {breakdown}
              </span>
            )}
          </span>
        );
      }
      default:
        return "—";
    }
  };

  return (
    <>
      <PageHeader
        title={
          ar
            ? partyType === "customer"
              ? "كشف حساب العملاء"
              : partyType === "supplier"
                ? "كشف حساب الموردين"
                : "كشف الصندوق والبنك"
            : partyType === "customer"
              ? "Customer Statements"
              : partyType === "supplier"
                ? "Supplier Statements"
                : "Cash & Bank Statement"
        }
        subtitle={
          ar
            ? "حركات الحساب والرصيد المتسلسل مع الطباعة والتصدير والمشاركة"
            : "Account movements and running balance with printing, export, and sharing"
        }
        actions={
          <div className="flex items-center gap-2">
            <>
                <Button
                  onClick={handleShareStatement}
                  variant="outline"
                  size="sm"
                  disabled={!result || partyType === "cash"}
                  className="h-8 gap-1.5 text-xs text-primary border-primary/30 hover:bg-primary/10 rounded-xl"
                >
                  <Share2 className="h-3.5 w-3.5" />
                  {ar ? "مشاركة الكشف" : "Share"}
                </Button>
                <Button
                  onClick={handleExportCsv}
                  variant="outline"
                  size="sm"
                  disabled={!result}
                  className="h-8 gap-1.5 text-xs text-emerald-500 border-emerald-500/30 hover:bg-emerald-500/10 rounded-xl"
                >
                  <FileSpreadsheet className="h-3.5 w-3.5" />
                  {ar ? "تصدير CSV" : "CSV"}
                </Button>
                <Button
                  onClick={handlePrintPDF}
                  size="sm"
                  disabled={!result}
                  className="h-8 gap-1.5 text-xs bg-primary rounded-xl"
                >
                  <Printer className="h-3.5 w-3.5" />
                  {ar ? "طباعة PDF فاخر" : "Print PDF"}
                </Button>
            </>
          </div>
        }
      />

      <div className="space-y-4">
          {/* بطاقة اختيار الحساب النظيفة والمرتبة بقوائم منسدلة */}
          <div className="panel-elevated p-3.5 sm:p-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2.5">
              {/* قائمة منسدلة لاختيار الطرف */}
              {partyType !== "cash" && (
                <Select value={partyId} onValueChange={setPartyId}>
                  <SelectTrigger className="h-9 w-48 sm:w-64 text-xs font-medium bg-surface rounded-xl border-border/80 shadow-sm">
                    <SelectValue
                      placeholder={
                        loadingParties
                          ? t("common.loading")
                          : ar
                            ? "اختر الحساب..."
                            : "Select account..."
                      }
                    />
                  </SelectTrigger>
                  <SelectContent className="max-h-[300px]">
                    {partyList.length > 0 ? (
                      partyList.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          <div className="flex w-full items-center justify-between gap-4 text-xs">
                            <span className="truncate font-medium">{p.name}</span>
                            {p.balance !== undefined && (
                              <span className="font-mono text-[11px] text-muted-foreground">
                                {money(Number(p.balance))}
                              </span>
                            )}
                          </div>
                        </SelectItem>
                      ))
                    ) : (
                      <div className="space-y-2 p-2 text-center">
                        <p className="text-xs text-muted-foreground">
                          {loadingParties
                            ? t("common.loading")
                            : ar
                              ? partyType === "customer"
                                ? "لا يوجد عملاء حتى الآن"
                                : "لا يوجد موردون حتى الآن"
                              : partyType === "customer"
                                ? "No customers yet"
                                : "No suppliers yet"}
                        </p>
                        {!loadingParties && (
                          <Button
                            type="button"
                            size="sm"
                            className="h-8 w-full rounded-xl text-xs"
                            onClick={() => {
                              setCustomerFormOpen(partyType === "customer");
                              setSupplierFormOpen(partyType === "supplier");
                            }}
                          >
                            {ar
                              ? partyType === "customer"
                                ? "إضافة عميل"
                                : "إضافة مورد"
                              : partyType === "customer"
                                ? "Add customer"
                                : "Add supplier"}
                          </Button>
                        )}
                      </div>
                    )}
                  </SelectContent>
                </Select>
              )}
            </div>

            {/* المجاميع المالية المدمجة */}
            {result && (
              <div className="flex flex-wrap items-center gap-4 sm:gap-6 bg-surface-2/60 px-3.5 py-1.5 rounded-xl border border-border/60">
                <div className="text-end">
                  <span className="text-[10px] text-muted-foreground block">
                    {ar ? "إجمالي المدين (له)" : "Total Debit"}
                  </span>
                  <span className="font-bold font-mono text-rose-500 text-xs sm:text-sm">
                    <Ltr>{money(totalDebit)}</Ltr>
                  </span>
                </div>

                <div className="h-6 w-px bg-border/60 hidden sm:block" />

                <div className="text-end">
                  <span className="text-[10px] text-muted-foreground block">
                    {ar ? "إجمالي الدائن (عليه)" : "Total Credit"}
                  </span>
                  <span className="font-bold font-mono text-emerald-500 text-xs sm:text-sm">
                    <Ltr>{money(totalCredit)}</Ltr>
                  </span>
                </div>

                <div className="h-6 w-px bg-border/60 hidden sm:block" />

                <div className="text-end">
                  <span className="text-[10px] text-muted-foreground block">
                    {ar ? "الرصيد المتبقي" : "Net Balance"}
                  </span>
                  <span className="font-bold font-mono text-primary text-sm sm:text-base">
                    <Ltr>{money(closingBalance)}</Ltr>
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* شريط الأدوات الموحد: البحث + الفرز + الفلاتر + الأعمدة */}
          <div className="flex flex-wrap items-center justify-between gap-2.5">
            <div className="flex-1 min-w-[220px] max-w-md">
              <SearchInput
                value={tableSearch}
                onValueChange={setTableSearch}
                placeholder={
                  ar
                    ? "ابحث في حركات الكشف (رقم الفاتورة، السند، البيان...) (/)"
                    : "Search statement records... (/)"
                }
                resultCountText={
                  statementRows.length !== rawRows.length
                    ? `${statementRows.length}/${rawRows.length}`
                    : String(statementRows.length)
                }
                enableSlashShortcut
                containerClassName="w-full"
              />
            </div>

            <div className="flex items-center gap-2">
              {/* قائمة الفرز المنسدلة */}
              <Popover open={sortMenuOpen} onOpenChange={setSortMenuOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant={
                      sortField !== "date" || sortDirection !== "desc" ? "default" : "outline"
                    }
                    size="sm"
                    className={cn(
                      "h-8 gap-1.5 px-2.5 text-xs rounded-xl",
                      sortField !== "date" && "bg-primary text-primary-foreground",
                    )}
                  >
                    <ArrowDownUp className="h-3.5 w-3.5" />
                    <span>{ar ? "ترتيب" : "Sort"}</span>
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-[200px] p-1.5">
                  <div className="border-b border-border/60 px-2 py-1.5 text-xs font-semibold">
                    {ar ? "خيارات الترتيب" : "Sort options"}
                  </div>
                  <div className="space-y-0.5 pt-1 text-xs">
                    <button
                      type="button"
                      onClick={() => {
                        setSortField("date");
                        setSortDirection("desc");
                        setSortMenuOpen(false);
                      }}
                      className={cn(
                        "flex w-full items-center justify-between rounded-md px-2 py-1.5 transition hover:bg-surface-2",
                        sortField === "date" &&
                          sortDirection === "desc" &&
                          "font-semibold text-primary",
                      )}
                    >
                      <span>{ar ? "التاريخ: الأحدث أولاً" : "Date: Newest"}</span>
                      {sortField === "date" && sortDirection === "desc" && "✓"}
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setSortField("date");
                        setSortDirection("asc");
                        setSortMenuOpen(false);
                      }}
                      className={cn(
                        "flex w-full items-center justify-between rounded-md px-2 py-1.5 transition hover:bg-surface-2",
                        sortField === "date" &&
                          sortDirection === "asc" &&
                          "font-semibold text-primary",
                      )}
                    >
                      <span>{ar ? "التاريخ: الأقدم أولاً" : "Date: Oldest"}</span>
                      {sortField === "date" && sortDirection === "asc" && "✓"}
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setSortField("debit");
                        setSortDirection("desc");
                        setSortMenuOpen(false);
                      }}
                      className={cn(
                        "flex w-full items-center justify-between rounded-md px-2 py-1.5 transition hover:bg-surface-2",
                        sortField === "debit" &&
                          sortDirection === "desc" &&
                          "font-semibold text-primary",
                      )}
                    >
                      <span>{ar ? "المدين: الأكبر أولاً" : "Debit: Highest"}</span>
                      {sortField === "debit" && sortDirection === "desc" && "✓"}
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setSortField("credit");
                        setSortDirection("desc");
                        setSortMenuOpen(false);
                      }}
                      className={cn(
                        "flex w-full items-center justify-between rounded-md px-2 py-1.5 transition hover:bg-surface-2",
                        sortField === "credit" &&
                          sortDirection === "desc" &&
                          "font-semibold text-primary",
                      )}
                    >
                      <span>{ar ? "الدائن: الأكبر أولاً" : "Credit: Highest"}</span>
                      {sortField === "credit" && sortDirection === "desc" && "✓"}
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setSortField("balance");
                        setSortDirection("desc");
                        setSortMenuOpen(false);
                      }}
                      className={cn(
                        "flex w-full items-center justify-between rounded-md px-2 py-1.5 transition hover:bg-surface-2",
                        sortField === "balance" &&
                          sortDirection === "desc" &&
                          "font-semibold text-primary",
                      )}
                    >
                      <span>{ar ? "الرصيد: الأكبر أولاً" : "Balance: Highest"}</span>
                      {sortField === "balance" && sortDirection === "desc" && "✓"}
                    </button>
                  </div>
                </PopoverContent>
              </Popover>

              <ReportFilterMenu
                values={filterValues}
                presets={filterPresets}
                onChange={updateFilterValues}
                onReset={resetOptions}
                labels={{
                  trigger: ar ? "تصفية الكشف" : "Filter statement",
                  title: ar ? "تصفية الكشف" : "Statement filters",
                  date: ar ? "التاريخ والفترة" : "Date and period",
                  period: ar ? "الفترة" : "Period",
                  options: ar ? "خيارات إضافية" : "More options",
                  includeZeroRows: ar ? "إظهار الفواتير المسددة" : "Include settled",
                  reset: ar ? "إعادة ضبط الفلاتر" : "Reset filters",
                  back: ar ? "رجوع" : "Back",
                  from: ar ? "من" : "From",
                  to: ar ? "إلى" : "To",
                }}
              />

              <ColumnVisibilityMenu
                columns={columnOptions}
                visible={visibleColumns}
                onChange={(key, value) =>
                  setVisibleColumns((current) => ({ ...current, [key]: value }))
                }
                label={ar ? "الأعمدة" : "Columns"}
                title={ar ? "إظهار أعمدة الكشف" : "Visible columns"}
              />
            </div>
          </div>

          {result?.integrity.hasGap && (
            <StatementIntegrityBadge integrity={result.integrity} variant="panel" />
          )}
          {from && to && from > to && (
            <div className="rounded-xl border border-amber-500/40 bg-amber-500/5 px-3.5 py-2 text-[11px] text-amber-700">
              {ar
                ? "تاريخ البداية بعد تاريخ النهاية — سيظهر الكشف فارغًا."
                : "Start date is after end date — the statement will be empty."}
            </div>
          )}

          {/* ═══ الجدول الموحد لكشف الحساب ═══ */}
          <div className="panel-elevated p-0 overflow-hidden rounded-2xl border border-border/70 shadow-sm">
            <div className="p-3.5 flex flex-wrap items-center justify-between gap-2 border-b border-border/60">
              <div className="flex items-center gap-2">
                <SourceBadge derived={derived} hasSourceData={hasSourceData} />
                {result && (
                  <span className="text-[11px] text-muted-foreground font-medium">
                    {statementRows.length} {ar ? "حركة معروضة" : "entries shown"}
                  </span>
                )}
              </div>
              <span className="text-[11px] text-muted-foreground">
                {result ? directionLabel(result.direction, result.entityType, lang) : ""}
              </span>
            </div>

            <div className="overflow-x-auto">
              <Table>
                <TableHeader className="bg-surface-2/60">
                  <TableRow>
                    {columns.map((col) => {
                      const isSortableCol = ["date", "debit", "credit", "balance"].includes(
                        col.key,
                      );
                      const isActiveSort = sortField === col.key;

                      return (
                        <TableHead
                          key={col.key}
                          onClick={() => {
                            if (isSortableCol) {
                              toggleSort(col.key as "date" | "debit" | "credit" | "balance");
                            }
                          }}
                          className={cn(
                            col.key === "debit" && "text-end text-rose-500 font-semibold",
                            col.key === "credit" && "text-end text-emerald-500 font-semibold",
                            col.key === "balance" && "text-end font-semibold",
                            isSortableCol && "cursor-pointer hover:bg-surface-3 transition-colors",
                            alignClass(col.align),
                          )}
                          style={col.width ? { width: col.width } : undefined}
                        >
                          <div
                            className={cn(
                              "inline-flex items-center gap-1.5",
                              col.align === "end" && "justify-end w-full",
                            )}
                          >
                            <span>{col.label}</span>
                            {isSortableCol &&
                              (isActiveSort ? (
                                sortDirection === "asc" ? (
                                  <ArrowUp className="h-3 w-3 text-primary" />
                                ) : (
                                  <ArrowDown className="h-3 w-3 text-primary" />
                                )
                              ) : (
                                <ChevronsUpDown className="h-3 w-3 opacity-40" />
                              ))}
                          </div>
                        </TableHead>
                      );
                    })}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow>
                      <TableCell
                        colSpan={Math.max(columns.length, 1)}
                        className="py-12 text-center"
                      >
                        <Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" />
                      </TableCell>
                    </TableRow>
                  ) : !partyId ? (
                    <TableRow>
                      <TableCell
                        colSpan={Math.max(columns.length, 1)}
                        className="py-12 text-center text-muted-foreground text-xs"
                      >
                        {ar ? "اختر حسابًا لعرض الكشف" : "Select an account to view the statement"}
                      </TableCell>
                    </TableRow>
                  ) : statementRows.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={Math.max(columns.length, 1)}
                        className="py-12 text-center text-muted-foreground text-xs"
                      >
                        {tableSearch
                          ? ar
                            ? "لا توجد نتائج مطابقة لبحثك في هذا الكشف"
                            : "No matching records found"
                          : ar
                            ? "لا توجد حركات حسابية مسجلة لهذه الفترة"
                            : "No statement records for this period"}
                      </TableCell>
                    </TableRow>
                  ) : (
                    <>
                      {layout?.showOpeningRow && !tableSearch && (
                        <TableRow className="bg-surface/70 hover:bg-surface/70">
                          {columns.map((col) => {
                            let content: React.ReactNode = "—";
                            if (col.key === "index")
                              content = (
                                <span className="font-mono text-xs text-muted-foreground">—</span>
                              );
                            else if (col.key === "kind")
                              content = (
                                <span className="text-xs font-medium italic text-muted-foreground">
                                  {kindLabel("opening", partyType, lang)}
                                </span>
                              );
                            else if (col.key === "description")
                              content = (
                                <span className="text-xs italic text-muted-foreground">
                                  {ar ? "رصيد ما قبل بداية الفترة" : "Balance before period start"}
                                </span>
                              );
                            else if (col.key === "date")
                              content = result?.period.from ? (
                                <VortexDateBadge
                                  date={result.period.from}
                                  size="sm"
                                  showWeekday={false}
                                />
                              ) : (
                                <span className="text-xs text-muted-foreground">—</span>
                              );
                            else if (col.key === "balance")
                              content = (
                                <span className="font-mono text-xs font-bold">
                                  <Ltr>{fmtAmount(result?.openingBalance ?? 0)}</Ltr>
                                </span>
                              );
                            return (
                              <TableCell key={col.key} className={alignClass(col.align)}>
                                {content}
                              </TableCell>
                            );
                          })}
                        </TableRow>
                      )}

                      {statementRows.map((row) => (
                        <TableRow
                          key={row.id}
                          className="cursor-pointer hover:bg-surface-2/60 transition-colors"
                          onClick={() => setDetailEntry(row)}
                          title={ar ? "عرض تفاصيل القيد" : "View entry details"}
                        >
                          {columns.map((col) => (
                            <TableCell key={col.key} className={alignClass(col.align)}>
                              {renderCell(row, col.key)}
                            </TableCell>
                          ))}
                        </TableRow>
                      ))}
                    </>
                  )}

                  {statementRows.length > 0 && (
                    <TableRow className="border-t-2 border-border font-bold bg-surface-2/50">
                      {columns.map((col) => {
                        let content: React.ReactNode = "";
                        if (col.key === "kind")
                          content = (
                            <span className="text-xs">{ar ? "الإجمالي الكلي:" : "Total:"}</span>
                          );
                        else if (col.key === "debit")
                          content = (
                            <span className="font-mono text-rose-500 font-bold">
                              <Ltr>{money(totalDebit)}</Ltr>
                            </span>
                          );
                        else if (col.key === "credit")
                          content = (
                            <span className="font-mono text-emerald-500 font-bold">
                              <Ltr>{fmtOrDash(totalCredit)}</Ltr>
                            </span>
                          );
                        else if (col.key === "balance")
                          content = (
                            <span className="font-mono text-primary text-sm font-bold">
                              <Ltr>{money(closingBalance)}</Ltr>
                            </span>
                          );
                        return (
                          <TableCell key={col.key} className={cn(alignClass(col.align), "text-xs")}>
                            {content}
                          </TableCell>
                        );
                      })}
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>

            {statementRows.length > 0 && (
              <div className="p-3.5 flex flex-wrap items-center justify-between gap-2 border-t border-border/60 text-[11px] text-muted-foreground">
                <span>
                  {ar ? "الرصيد الختامي" : "Closing balance"}:{" "}
                  <b className="font-mono text-foreground font-bold">
                    {money(closingBalance)} {currencySymbol}
                  </b>
                </span>
              </div>
            )}
          </div>
      </div>

      {/* تفاصيل القيد المنبثقة */}
      <StatementEntryDetails
        entry={detailEntry}
        entityType={partyType}
        onClose={() => setDetailEntry(null)}
      />

      {/* نافذة مشاركة الكشف */}
      {shareContext && activeParty && (
        <DocumentShareDialog
          open={shareOpen}
          onClose={() => setShareOpen(false)}
          title={ar ? "مشاركة كشف الحساب" : "Share Statement"}
          documentType="statement"
          customer={{
            id: activeParty.id,
            name: activeParty.name,
            phone: activeParty.phone ?? null,
            balance: Number(activeParty.balance ?? closingBalance),
            hasLedgerActivity: statementRows.length > 0,
          }}
          statement={shareContext}
          onPrintPdf={handlePrintPDF}
          onExportExcel={handleExportCsv}
        />
      )}

      <CustomerFormDialog
        open={customerFormOpen}
        onClose={() => setCustomerFormOpen(false)}
        onSaved={(record: CustomerRecord) => {
          setPartyList((current) => [...current, record]);
          setPartyId(record.id);
          setCustomerFormOpen(false);
        }}
      />
      <SupplierFormDialog
        open={supplierFormOpen}
        onClose={() => setSupplierFormOpen(false)}
        onSaved={(record: SupplierRecord) => {
          setPartyList((current) => [...current, record]);
          setPartyId(record.id);
          setSupplierFormOpen(false);
        }}
      />
    </>
  );
}

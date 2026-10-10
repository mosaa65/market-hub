/**
 * /account-statement — كشف حساب تفصيلي (عميل / مورد)
 *
 * ⚠️ شاشة واحدة فقط — بنفس التصميم السابق:
 *   شريط الاختيار (نوع الحساب + الحساب + المجاميع) ثم جدول الحركات.
 *
 * أُضيف شريط خيارات مضغوط فوق الجدول (الفترة · القالب · إظهار المسددة)
 * بدل إنشاء شاشة منشئ كشف منفصلة.
 *
 * كل الأرقام تأتي من Statement Engine — لا منطق حسابي هنا.
 * عند تغيير أي خيار، يُعاد الحساب في مكانه بلا انتقال لأي شاشة أخرى.
 */

import { ModuleGuard } from "@/lib/modules";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { z } from "zod";
import {
  FileSpreadsheet,
  Loader2,
  Printer,
  UserCheck,
  Building2,
  Wallet,
  ClipboardList,
  Eye,
  Share2,
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
  StatementEntityType,
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
import { ReportPickerDialog } from "@/components/statements/report-picker-dialog";
import { DocumentShareDialog } from "@/components/communication";
import { statementToContext } from "@/lib/communication";
import { PurchasesReport } from "@/components/statements/purchases-report";
import { OperationalReports } from "@/components/statements/operational-reports";
import { DebtsReport } from "@/components/statements/debts-report";
import { ProfitSalesReport } from "@/components/statements/profit-sales-report";
import {
  DEFAULT_REPORT_PREFERENCES,
  getReportPreferences,
  saveReportPreferences,
} from "@/lib/statements/local-storage";
import {
  reportDefinition,
  reportTypeForEntity,
  type ReportType,
} from "@/lib/statements/report-registry";

const accountStatementSearchSchema = z.object({
  customerId: z.string().optional(),
  entityType: z.string().optional(),
  entityId: z.string().optional(),
});

export const Route = createFileRoute("/_app/account-statement")({
  validateSearch: (search: Record<string, unknown>) => accountStatementSearchSchema.parse(search),
  head: () => ({ meta: [{ title: "كشف حساب — Market Hub" }] }),
  component: () => (
    <ModuleGuard moduleId="payments">
      <AccountStatementPage />
    </ModuleGuard>
  ),
});

interface PartyOption {
  id: string;
  name: string;
  phone?: string | null;
  balance?: number;
}

/** نطاقات جاهزة للفترة — تُبنى محليًا بلا استعلام */
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

function AccountStatementPage() {
  const { t, lang } = useI18n();
  const ar = lang === "ar";
  const searchParams = Route.useSearch();
  const { settings } = useStatementSettings();
  const savedPreferences = useMemo(() => getReportPreferences(), []);

  // ── نوع الكشف والحساب والجهة ──
  const [reportType, setReportType] = useState<ReportType>(
    savedPreferences.reportType ?? DEFAULT_REPORT_PREFERENCES.reportType,
  );
  const [reportPickerOpen, setReportPickerOpen] = useState(false);
  const [partyType, setPartyType] = useState<StatementEntityType>(
    (searchParams.entityType as StatementEntityType) || savedPreferences.entityType || "customer",
  );
  const [partyId, setPartyId] = useState<string>(
    searchParams.entityId ?? searchParams.customerId ?? savedPreferences.entityId ?? "",
  );
  const [partyList, setPartyList] = useState<PartyOption[]>([]);
  const [loadingParties, setLoadingParties] = useState(false);
  /** الحركة المفتوحة في لوحة «تفاصيل القيد» */
  const [detailEntry, setDetailEntry] = useState<StatementTransaction | null>(null);
  /** نافذة مشاركة كشف الحساب (PDF / Excel / واتساب) */
  const [shareOpen, setShareOpen] = useState(false);

  // ── الخيارات (مضغوطة داخل نفس الشاشة) ──
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

  // حفظ الاختيارات محليًا: هذه تفضيلات واجهة فقط، وليست مصدرًا للبيانات المالية.
  useEffect(() => {
    saveReportPreferences({
      reportType,
      entityType: partyType,
      entityId: partyId,
      from,
      to,
      preset: activePreset,
      includeZeroRows: includeZero,
      visibleColumns,
    });
  }, [reportType, partyType, partyId, from, to, activePreset, includeZero, visibleColumns]);

  // ── جلب الجهات حسب النوع ──
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [partyType]);

  // ── المحرّك: كل الأرقام من هنا ──
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

  // مجاميع العرض — من النتيجة، لا حساب هنا
  const totalDebit = result?.totalDebit ?? 0;
  const totalCredit = result?.totalCredit ?? 0;
  const closingBalance = result?.closingBalance ?? 0;
  const statementRows = result?.transactions ?? [];

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

  // جهة الكشف الحالية (عميل / مورد) — تُستخدم لمشاركة الملخص عبر واتساب
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

  function handleReportSelect(nextType: ReportType) {
    const definition = reportDefinition(nextType);
    if (!definition.implemented || !definition.entityType) {
      setReportType(nextType);
      saveReportPreferences({ reportType: nextType });
      toast.info(
        ar
          ? "تم حفظ اختيار الكشف، وسيتم تنفيذ مصدر بياناته في المرحلة التالية."
          : "The report choice was saved and its data source will be implemented in the next phase.",
      );
      return;
    }
    setReportType(nextType);
    setPartyType(definition.entityType);
    setDetailEntry(null);
    saveReportPreferences({ reportType: nextType, entityType: definition.entityType });
  }

  const partyTabs: { type: StatementEntityType; label: string; icon: typeof UserCheck }[] = [
    { type: "customer", label: ar ? "حسابات العملاء" : "Customers", icon: UserCheck },
    { type: "supplier", label: ar ? "حسابات الموردين" : "Suppliers", icon: Building2 },
    { type: "cash", label: ar ? "الصندوق والبنك" : "Treasury", icon: Wallet },
  ];

  const alignClass = (align: "start" | "center" | "end") =>
    align === "end" ? "text-end" : align === "center" ? "text-center" : "text-start";

  const columns = (layout?.columns ?? []).filter((column) => visibleColumns[column.key]);
  const columnOptions = (layout?.columns ?? []).map((column) => ({
    key: column.key,
    label: column.label,
  }));

  /**
   * محتوى خلية واحدة — نفس المنطق يُستخدم في الجدول وفي بطاقة الهاتف،
   * حتى لا تتباعد الواجهتان. لا حساب مالي هنا: كل الأرقام تأتي من الـ Engine.
   */
  const renderCell = (row: StatementTransaction, key: StatementFieldKey): React.ReactNode => {
    switch (key) {
      case "index":
        return <Ltr className="font-mono text-xs text-muted-foreground">{row.index}</Ltr>;
      case "date":
        return (
          <Ltr className="text-xs text-muted-foreground">
            {new Date(row.occurredAt).toLocaleString(ar ? "ar-YE" : "en-GB")}
          </Ltr>
        );
      case "kind":
        return (
          <span className="text-xs font-semibold">{kindLabel(row.kind, partyType, lang)}</span>
        );
      case "reference":
        return <Ltr className="font-mono text-xs text-primary">{row.reference ?? "—"}</Ltr>;
      case "description":
        return <span className="text-xs text-muted-foreground">{row.description ?? "—"}</span>;
      case "debit":
        return <Ltr className="font-mono text-rose-500">{fmtOrDash(row.debit)}</Ltr>;
      case "credit":
        return <Ltr className="font-mono text-emerald-500">{fmtOrDash(row.credit)}</Ltr>;
      case "balance":
        return <Ltr className="font-mono font-bold">{fmtAmount(row.runningBalance)}</Ltr>;
      case "paymentMethod": {
        const rawPm = String(row.meta?.paymentMethod ?? "")
          .trim()
          .toLowerCase();
        const breakdown = String(row.meta?.paymentBreakdown ?? "").trim();
        // The catalogue, not a local map. This map knew seven values and would
        // have rendered anything else — including every method a business
        // creates — as its raw English key.
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
        title={ar ? "مركز الكشوفات" : "Reports center"}
        subtitle={
          ar
            ? "اختر نوع الكشف واعرض بياناته من الجداول التشغيلية المناسبة"
            : "Choose a report and view data from its operational source"
        }
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setReportPickerOpen(true)}
              className="gap-1.5"
            >
              <ClipboardList className="h-4 w-4" />
              {ar ? "فتح كشف آخر" : "Open another report"}
            </Button>
            {["customer-account", "supplier-account", "cash-account"].includes(reportType) && (
              <>
                <Button
                  onClick={handleShareStatement}
                  variant="outline"
                  disabled={!result || partyType === "cash"}
                  className="gap-2 text-primary border-primary/30 hover:bg-primary/10"
                >
                  <Share2 className="h-4 w-4" />
                  {ar ? "مشاركة الكشف" : "Share statement"}
                </Button>
                <Button
                  onClick={handleExportCsv}
                  variant="outline"
                  disabled={!result}
                  className="gap-2 text-emerald-500 border-emerald-500/30 hover:bg-emerald-500/10"
                >
                  <FileSpreadsheet className="h-4 w-4" />
                  {ar ? "تصدير CSV" : "Export CSV"}
                </Button>
                <Button onClick={handlePrintPDF} disabled={!result} className="gap-2 bg-primary">
                  <Printer className="h-4 w-4" />
                  {ar ? "طباعة PDF فاخر" : "Print PDF"}
                </Button>
              </>
            )}
          </div>
        }
      />

      <div className="mb-3 flex items-center gap-2 text-xs text-muted-foreground">
        <span className="rounded-full border-primary/20 bg-primary/5 px-2.5 py-1 text-primary">
          {ar ? reportDefinition(reportType).title.ar : reportDefinition(reportType).title.en}
        </span>
        {!reportDefinition(reportType).implemented && (
          <span>{ar ? "مصدر البيانات قيد التنفيذ" : "Data source is planned"}</span>
        )}
      </div>

      {reportType === "purchases" ? (
        <PurchasesReport
          from={from}
          to={to}
          ar={ar}
          onBack={() => handleReportSelect("customer-account")}
          filterValues={filterValues}
          filterPresets={filterPresets}
          onFilterChange={updateFilterValues}
          onFilterReset={resetOptions}
        />
      ) : reportType === "debts" ? (
        <DebtsReport ar={ar} onBack={() => handleReportSelect("customer-account")} />
      ) : reportType === "profit-sales" ? (
        <ProfitSalesReport
          from={from}
          to={to}
          ar={ar}
          onBack={() => handleReportSelect("customer-account")}
          filterValues={filterValues}
          filterPresets={filterPresets}
          onFilterChange={updateFilterValues}
          onFilterReset={resetOptions}
        />
      ) : ["sales-invoices", "returns", "expenses", "inventory-movements", "product"].includes(
          reportType,
        ) ? (
        <OperationalReports
          type={
            reportType as
              "sales-invoices" | "returns" | "expenses" | "inventory-movements" | "product"
          }
          from={from}
          to={to}
          ar={ar}
          onBack={() => handleReportSelect("customer-account")}
          filterValues={filterValues}
          filterPresets={filterPresets}
          onFilterChange={updateFilterValues}
          onFilterReset={resetOptions}
        />
      ) : (
        <div className="space-y-4">
          {/* ═══ شريط الاختيار (كما كان) ═══ */}
          <div className="panel-elevated p-4 flex flex-wrap items-center justify-between gap-4">
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-2 border border-border p-1 rounded-lg bg-surface-2">
                {partyTabs.map((tab) => {
                  const Icon = tab.icon;
                  return (
                    <Button
                      key={tab.type}
                      variant={partyType === tab.type ? "default" : "ghost"}
                      size="sm"
                      onClick={() => {
                        setPartyType(tab.type);
                        setReportType(reportTypeForEntity(tab.type));
                      }}
                      className="gap-2 text-xs"
                    >
                      <Icon className="h-4 w-4" />
                      {tab.label}
                    </Button>
                  );
                })}
              </div>

              {partyType !== "cash" && (
                <Select value={partyId} onValueChange={setPartyId}>
                  <SelectTrigger className="w-64">
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
                  <SelectContent>
                    {partyList.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            {/* المجاميع — عمود واحد على الهاتف حتى لا تُضغط الأرقام */}
            {result && (
              <div className="grid w-full grid-cols-1 gap-2 sm:flex sm:w-auto sm:items-center sm:gap-6">
                <div className="flex items-center justify-between gap-3 sm:block sm:text-end">
                  <span className="text-xs text-muted-foreground">
                    {ar ? "إجمالي المدين (له):" : "Total Debit:"}{" "}
                  </span>
                  <span className="font-bold font-mono text-rose-500 text-sm block">
                    <Ltr>{money(totalDebit)}</Ltr>
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3 border-t border-border/60 pt-2 sm:border-0 sm:pt-0 sm:block sm:text-end">
                  <span className="text-xs text-muted-foreground">
                    {ar ? "إجمالي الدائن (عليه):" : "Total Credit:"}{" "}
                  </span>
                  <span className="font-bold font-mono text-emerald-500 text-sm block">
                    <Ltr>{money(totalCredit)}</Ltr>
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3 border-t border-border/60 pt-2 sm:border-0 sm:pt-0 sm:block sm:text-end sm:border-r sm:pr-6">
                  <span className="text-xs text-muted-foreground">
                    {ar ? "الرصيد المتبقي الحالي:" : "Net Balance:"}{" "}
                  </span>
                  <span className="font-bold font-mono text-primary text-base block">
                    <Ltr>{money(closingBalance)}</Ltr>
                  </span>
                </div>
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2">
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

          {/* ═══ تنبيهات ═══ */}
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

          {/* ═══ جدول الكشف (نفس التصميم السابق) ═══ */}
          <div className="panel-elevated p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <SourceBadge derived={derived} hasSourceData={hasSourceData} />
                {result && (
                  <span className="text-[11px] text-muted-foreground">
                    {result.countedRows} {ar ? "حركة" : "entries"}
                  </span>
                )}
              </div>
              <span className="text-[11px] text-muted-foreground">
                {result ? directionLabel(result.direction, result.entityType, lang) : ""}
              </span>
            </div>

            <div className="mb-2 text-[11px] text-muted-foreground">
              {result ? `${ar ? "الفترة" : "Period"}: ${result.period.label}` : ""}
            </div>
            {/* ═══ الجدول والبطاقات — ترتيب مختلف حسب المقاس ═══
                على الهاتف تظهر البطاقات أولًا (order-1) والجدول مخفي،
                وعلى سطح المكتب يظهر الجدول أولًا والبطاقات مخفية. */}
            <div className="flex flex-col">
              {/* ═══ الجدول — Desktop ≥ 768px فقط ═══ */}
              <div className="order-2 hidden overflow-x-auto md:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      {columns.map((col) => (
                        <TableHead
                          key={col.key}
                          className={cn(
                            col.key === "debit" && "text-end text-rose-500 font-semibold",
                            col.key === "credit" && "text-end text-emerald-500 font-semibold",
                            col.key === "balance" && "text-end font-semibold",
                            alignClass(col.align),
                          )}
                          style={col.width ? { width: col.width } : undefined}
                        >
                          {col.label}
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {isLoading ? (
                      <TableRow>
                        <TableCell
                          colSpan={Math.max(columns.length, 1)}
                          className="py-8 text-center"
                        >
                          <Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" />
                        </TableCell>
                      </TableRow>
                    ) : !partyId ? (
                      <TableRow>
                        <TableCell
                          colSpan={Math.max(columns.length, 1)}
                          className="py-12 text-center text-muted-foreground"
                        >
                          {ar
                            ? "اختر حسابًا لعرض الكشف"
                            : "Select an account to view the statement"}
                        </TableCell>
                      </TableRow>
                    ) : statementRows.length === 0 ? (
                      <TableRow>
                        <TableCell
                          colSpan={Math.max(columns.length, 1)}
                          className="py-12 text-center text-muted-foreground"
                        >
                          {ar
                            ? "لا توجد حركات حسابية مسجلة لهذه الفترة"
                            : "No statement records for this period"}
                          {result && Math.abs(result.openingBalance) > 0.005 && (
                            <div className="mt-1 text-[11px]">
                              {ar
                                ? `يوجد رصيد سابق بمقدار ${fmtAmount(result.openingBalance)}`
                                : `Opening balance carried: ${fmtAmount(result.openingBalance)}`}
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                    ) : (
                      <>
                        {/* سطر الرصيد الافتتاحي */}
                        {layout?.showOpeningRow && (
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
                                    {ar
                                      ? "رصيد ما قبل بداية الفترة"
                                      : "Balance before period start"}
                                  </span>
                                );
                              else if (col.key === "date")
                                content = (
                                  <span className="font-mono text-xs text-muted-foreground">
                                    <Ltr>{result?.period.from ?? "—"}</Ltr>
                                  </span>
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
                            className="cursor-pointer hover:bg-surface-2/60"
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

                    {/* سطر الإجماليات — كما كان */}
                    {statementRows.length > 0 && (
                      <TableRow className="border-t-2 border-border font-bold bg-surface-2/50">
                        {columns.map((col) => {
                          let content: React.ReactNode = "";
                          if (col.key === "kind")
                            content = (
                              <span className="text-sm">{ar ? "الإجمالي الكلي:" : "Total:"}</span>
                            );
                          else if (col.key === "debit")
                            content = (
                              <span className="font-mono text-rose-500">
                                <Ltr>{money(totalDebit)}</Ltr>
                              </span>
                            );
                          else if (col.key === "credit")
                            content = (
                              <span className="font-mono text-emerald-500">
                                <Ltr>{fmtOrDash(totalCredit)}</Ltr>
                              </span>
                            );
                          else if (col.key === "balance")
                            content = (
                              <span className="font-mono text-primary text-base">
                                <Ltr>{money(closingBalance)}</Ltr>
                              </span>
                            );
                          return (
                            <TableCell
                              key={col.key}
                              className={cn(alignClass(col.align), "text-sm")}
                            >
                              {content}
                            </TableCell>
                          );
                        })}
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>

              {/* ═══ Mobile Statement Cards — < 768px فقط ═══
                نفس الحقول ونفس الأرقام، مع احترام Column Visibility.
                النقر على البطاقة يفتح نفس لوحة تفاصيل القيد. */}
              <div className="order-1 space-y-2.5 md:hidden">
                {isLoading ? (
                  <div className="grid place-items-center rounded-xl border border-border/70 py-10">
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  </div>
                ) : !partyId ? (
                  <div className="rounded-xl border border-border/70 py-10 text-center text-xs text-muted-foreground">
                    {ar ? "اختر حسابًا لعرض الكشف" : "Select an account to view the statement"}
                  </div>
                ) : statementRows.length === 0 ? (
                  <div className="rounded-xl border border-border/70 py-10 text-center text-xs text-muted-foreground">
                    <div>
                      {ar
                        ? "لا توجد حركات حسابية مسجلة لهذه الفترة"
                        : "No statement records for this period"}
                    </div>
                    {result && Math.abs(result.openingBalance) > 0.005 && (
                      <div className="mt-1 text-[11px]">
                        {ar
                          ? `يوجد رصيد سابق بمقدار ${fmtAmount(result.openingBalance)}`
                          : `Opening balance carried: ${fmtAmount(result.openingBalance)}`}
                      </div>
                    )}
                  </div>
                ) : (
                  <>
                    {/* الرصيد الافتتاحي — لا يختفي على الهاتف */}
                    {layout?.showOpeningRow && (
                      <div className="rounded-xl border border-primary/25 bg-primary/5 p-3.5">
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <div className="text-xs font-semibold text-foreground">
                              {ar ? "الرصيد الافتتاحي" : "Opening balance"}
                            </div>
                            <div className="mt-0.5 text-[11px] italic text-muted-foreground">
                              {ar ? "رصيد ما قبل بداية الفترة" : "Balance before period start"}
                              {result?.period.from ? ` · ${result.period.from}` : ""}
                            </div>
                          </div>
                          <span className="shrink-0 font-mono text-sm font-bold text-primary">
                            <Ltr>{fmtAmount(result?.openingBalance ?? 0)}</Ltr>
                          </span>
                        </div>
                      </div>
                    )}

                    {statementRows.map((row) => {
                      const paymentMethod =
                        visibleColumns.paymentMethod &&
                        String(row.meta?.paymentMethod ?? "").trim();
                      return (
                        <button
                          key={row.id}
                          type="button"
                          data-qa="statement-card"
                          onClick={() => setDetailEntry(row)}
                          className="w-full rounded-xl border border-border/80 bg-surface p-3.5 text-start transition active:bg-surface-2/60"
                        >
                          {/* رأس البطاقة: نوع الحركة + التاريخ + المرجع */}
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5">
                                {visibleColumns.index && (
                                  <span className="font-mono text-[10px] text-muted-foreground">
                                    <Ltr>#{row.index}</Ltr>
                                  </span>
                                )}
                                <span className="truncate text-xs font-semibold text-foreground">
                                  {kindLabel(row.kind, partyType, lang)}
                                </span>
                              </div>
                              {visibleColumns.date && (
                                <div className="mt-0.5 text-[11px] text-muted-foreground">
                                  <Ltr>
                                    {new Date(row.occurredAt).toLocaleString(
                                      ar ? "ar-YE" : "en-GB",
                                    )}
                                  </Ltr>
                                </div>
                              )}
                            </div>
                            {visibleColumns.reference && row.reference && (
                              <span className="shrink-0 font-mono text-xs text-primary">
                                <Ltr>{row.reference}</Ltr>
                              </span>
                            )}
                          </div>

                          {/* البيان / الوصف */}
                          {visibleColumns.description && row.description && (
                            <div className="mt-2 line-clamp-2 text-[11px] text-muted-foreground">
                              {row.description}
                            </div>
                          )}

                          {/* مدين / دائن — شبكة بدل صف أفقي ضيق */}
                          {(visibleColumns.debit || visibleColumns.credit) && (
                            <div className="mt-2.5 grid grid-cols-2 gap-2 border-t border-border/60 pt-2.5">
                              {visibleColumns.debit && (
                                <div>
                                  <div className="text-[10px] text-muted-foreground">
                                    {ar ? "مدين" : "Debit"}
                                  </div>
                                  <div className="font-mono text-xs font-semibold text-rose-500">
                                    <Ltr>{fmtOrDash(row.debit)}</Ltr>
                                  </div>
                                </div>
                              )}
                              {visibleColumns.credit && (
                                <div>
                                  <div className="text-[10px] text-muted-foreground">
                                    {ar ? "دائن" : "Credit"}
                                  </div>
                                  <div className="font-mono text-xs font-semibold text-emerald-500">
                                    <Ltr>{fmtOrDash(row.credit)}</Ltr>
                                  </div>
                                </div>
                              )}
                            </div>
                          )}

                          {/* الرصيد الجاري */}
                          {visibleColumns.balance && (
                            <div className="mt-2 flex items-center justify-between gap-2 rounded-lg bg-surface-2/50 px-2.5 py-1.5">
                              <span className="text-[11px] text-muted-foreground">
                                {ar ? "الرصيد الجاري" : "Running balance"}
                              </span>
                              <span className="font-mono text-xs font-bold text-foreground">
                                <Ltr>{fmtAmount(row.runningBalance)}</Ltr>
                              </span>
                            </div>
                          )}

                          {/* طريقة الدفع + زر التفاصيل */}
                          <div className="mt-2.5 flex items-center justify-between gap-2 border-t border-border/60 pt-2.5">
                            <span className="truncate text-[11px] text-muted-foreground">
                              {paymentMethod
                                ? `${ar ? "طريقة الدفع" : "Payment"}: ${renderCell(row, "paymentMethod")}`
                                : ""}
                            </span>
                            <span className="inline-flex shrink-0 items-center gap-1 text-[11px] font-medium text-primary">
                              <Eye className="h-3.5 w-3.5" />
                              {ar ? "عرض التفاصيل" : "View details"}
                            </span>
                          </div>
                        </button>
                      );
                    })}

                    {/* الإجماليات — عمودان على الهاتف */}
                    <div className="rounded-xl border border-border/80 bg-surface-2/50 p-3.5">
                      <div className="mb-2 text-xs font-bold text-foreground">
                        {ar ? "الإجمالي الكلي" : "Total"}
                      </div>
                      <div className="grid grid-cols-2 gap-2.5">
                        <div>
                          <div className="text-[10px] text-muted-foreground">
                            {ar ? "إجمالي المدين" : "Total debit"}
                          </div>
                          <div className="font-mono text-sm font-semibold text-rose-500">
                            <Ltr>{money(totalDebit)}</Ltr>
                          </div>
                        </div>
                        <div>
                          <div className="text-[10px] text-muted-foreground">
                            {ar ? "إجمالي الدائن" : "Total credit"}
                          </div>
                          <div className="font-mono text-sm font-semibold text-emerald-500">
                            <Ltr>{fmtOrDash(totalCredit)}</Ltr>
                          </div>
                        </div>
                        <div className="col-span-2 border-t border-border/60 pt-2">
                          <div className="text-[10px] text-muted-foreground">
                            {ar ? "الرصيد الحالي" : "Closing balance"}
                          </div>
                          <div className="font-mono text-base font-bold text-primary">
                            <Ltr>{money(closingBalance)}</Ltr>
                          </div>
                        </div>
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* تذييل الجدول */}
            {statementRows.length > 0 && (
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-3 text-[11px] text-muted-foreground">
                <span>
                  {ar ? "الرصيد الختامي" : "Closing balance"}:{" "}
                  <b className="font-mono text-foreground">
                    {money(closingBalance)} {currencySymbol}
                  </b>
                </span>
                <button type="button" onClick={refetch} className="text-primary hover:underline">
                  {ar ? "تحديث" : "Refresh"}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* تفاصيل القيد — تُفتح بالنقر على أي حركة */}
      <StatementEntryDetails
        entry={detailEntry}
        entityType={partyType}
        onClose={() => setDetailEntry(null)}
      />
      <ReportPickerDialog
        open={reportPickerOpen}
        selected={reportType}
        onOpenChange={setReportPickerOpen}
        onSelect={handleReportSelect}
        ar={ar}
      />

      {/* مشاركة كشف الحساب (واتساب / PDF / Excel) */}
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
    </>
  );
}

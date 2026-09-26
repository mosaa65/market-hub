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
import { FileSpreadsheet, Loader2, Printer, UserCheck, Building2, Wallet, ClipboardList } from "lucide-react";
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
import { fmtAmount, fmtOrDash } from "@/lib/statements/format";
import { directionLabel } from "@/lib/statements/format";
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
        .order("name");

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

  function handleExportExcel() {
    if (!result || !layout) return;
    exportStatementToCsv({
      result,
      layout,
      lang,
      filename: statementFilename(result, lang),
      currencySymbol,
    });
    toast.success(ar ? "تم تصدير الملف" : "File exported");
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

  return (
    <>
      <PageHeader
        title={ar ? "مركز الكشوفات" : "Reports center"}
        subtitle={
          ar
            ? "تاختر نوع الكشف واعرض بياناته من الجداول التشغيلية المناسبة"
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
            <Button
              onClick={handleExportExcel}
              variant="outline"
              disabled={!result}
              className="gap-2 text-emerald-500 border-emerald-500/30 hover:bg-emerald-500/10"
            >
              <FileSpreadsheet className="h-4 w-4" />
              {ar ? "تصدير Excel" : "Export Excel"}
            </Button>
            <Button onClick={handlePrintPDF} disabled={!result} className="gap-2 bg-primary">
              <Printer className="h-4 w-4" />
              {ar ? "طباعة PDF فاخر" : "Print PDF"}
            </Button>
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
      ) : ["sales-invoices", "returns", "expenses", "inventory-movements", "product"].includes(reportType) ? (
        <OperationalReports
          type={reportType as "sales-invoices" | "returns" | "expenses" | "inventory-movements" | "product"}
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

          {/* المجاميع — كما كانت */}
          {result && (
            <div className="flex items-center gap-6">
              <div className="text-end">
                <span className="text-xs text-muted-foreground">
                  {ar ? "إجمالي المدين (له):" : "Total Debit:"}{" "}
                </span>
                <span className="font-bold font-mono text-rose-500 text-sm block">
                  {money(totalDebit)}
                </span>
              </div>
              <div className="text-end">
                <span className="text-xs text-muted-foreground">
                  {ar ? "إجمالي الدائن (عليه):" : "Total Credit:"}{" "}
                </span>
                <span className="font-bold font-mono text-emerald-500 text-sm block">
                  {money(totalCredit)}
                </span>
              </div>
              <div className="text-end border-r pr-6 border-border">
                <span className="text-xs text-muted-foreground">
                  {ar ? "الرصيد المتبقي الحالي:" : "Net Balance:"}{" "}
                </span>
                <span className="font-bold font-mono text-primary text-base block">
                  {money(closingBalance)}
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
          <div className="overflow-x-auto">
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
                    <TableCell colSpan={Math.max(columns.length, 1)} className="py-8 text-center">
                      <Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" />
                    </TableCell>
                  </TableRow>
                ) : !partyId ? (
                  <TableRow>
                    <TableCell
                      colSpan={Math.max(columns.length, 1)}
                      className="py-12 text-center text-muted-foreground"
                    >
                      {ar ? "اختر حسابًا لعرض الكشف" : "Select an account to view the statement"}
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
                                {ar ? "رصيد ما قبل بداية الفترة" : "Balance before period start"}
                              </span>
                            );
                          else if (col.key === "date")
                            content = (
                              <span className="font-mono text-xs text-muted-foreground">
                                {result?.period.from ?? "—"}
                              </span>
                            );
                          else if (col.key === "balance")
                            content = (
                              <span className="font-mono text-xs font-bold">
                                {fmtAmount(result?.openingBalance ?? 0)}
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
                        {columns.map((col) => {
                          let content: React.ReactNode = "—";
                          switch (col.key) {
                            case "index":
                              content = (
                                <span className="font-mono text-xs text-muted-foreground">
                                  {row.index}
                                </span>
                              );
                              break;
                            case "date":
                              content = (
                                <span className="text-xs text-muted-foreground">
                                  {new Date(row.occurredAt).toLocaleString(ar ? "ar-YE" : "en-GB")}
                                </span>
                              );
                              break;
                            case "kind":
                              content = (
                                <span className="text-xs font-semibold">
                                  {kindLabel(row.kind, partyType, lang)}
                                </span>
                              );
                              break;
                            case "reference":
                              content = (
                                <span className="font-mono text-xs text-primary">
                                  {row.reference ?? "—"}
                                </span>
                              );
                              break;
                            case "description":
                              content = (
                                <span className="text-xs text-muted-foreground">
                                  {row.description ?? "—"}
                                </span>
                              );
                              break;
                            case "debit":
                              content = (
                                <span className="font-mono text-rose-500">
                                  {fmtOrDash(row.debit)}
                                </span>
                              );
                              break;
                            case "credit":
                              content = (
                                <span className="font-mono text-emerald-500">
                                  {fmtOrDash(row.credit)}
                                </span>
                              );
                              break;
                            case "balance":
                              content = (
                                <span className="font-mono font-bold">
                                  {fmtAmount(row.runningBalance)}
                                </span>
                              );
                              break;
                            case "paymentMethod":
                              content = (
                                <span className="text-xs text-muted-foreground">
                                  {String(row.meta?.paymentMethod ?? "—")}
                                </span>
                              );
                              break;
                          }
                          return (
                            <TableCell key={col.key} className={alignClass(col.align)}>
                              {content}
                            </TableCell>
                          );
                        })}
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
                          <span className="font-mono text-rose-500">{money(totalDebit)}</span>
                        );
                      else if (col.key === "credit")
                        content = (
                          <span className="font-mono text-emerald-500">
                            {fmtOrDash(totalCredit)}
                          </span>
                        );
                      else if (col.key === "balance")
                        content = (
                          <span className="font-mono text-primary text-base">
                            {money(closingBalance)}
                          </span>
                        );
                      return (
                        <TableCell key={col.key} className={cn(alignClass(col.align), "text-sm")}>
                          {content}
                        </TableCell>
                      );
                    })}
                  </TableRow>
                )}
              </TableBody>
            </Table>
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
    </>
  );
}

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
  Calendar,
  ChevronDown,
  FileSpreadsheet,
  Filter,
  Loader2,
  Printer,
  RotateCcw,
  UserCheck,
  Building2,
  Wallet,
} from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { useI18n } from "@/lib/i18n";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
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
import { TEMPLATE_ORDER, templateLabel } from "@/lib/statements/templates";
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
import type { StatementEntityType, StatementTemplateId } from "@/lib/statements/types";
import { money } from "@/lib/format";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

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

  // ── نوع الحساب والجهة ──
  const [partyType, setPartyType] = useState<StatementEntityType>(
    (searchParams.entityType as StatementEntityType) || "customer",
  );
  const [partyId, setPartyId] = useState<string>("");
  const [partyList, setPartyList] = useState<PartyOption[]>([]);
  const [loadingParties, setLoadingParties] = useState(false);

  // ── الخيارات (مضغوطة داخل نفس الشاشة) ──
  const [optionsOpen, setOptionsOpen] = useState(true);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [activePreset, setActivePreset] = useState("all");
  const [includeZero, setIncludeZero] = useState(settings.includeZeroRowsDefault);
  const [templateId, setTemplateId] = useState<StatementTemplateId>(settings.defaultTemplate);

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
    templateId,
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

  const selectedParty = partyList.find((p) => p.id === partyId) ?? null;

  // مجاميع العرض — من النتيجة، لا حساب هنا
  const totalDebit = result?.totalDebit ?? 0;
  const totalCredit = result?.totalCredit ?? 0;
  const closingBalance = result?.closingBalance ?? 0;
  const statementRows = result?.transactions ?? [];

  function applyPreset(key: string) {
    setActivePreset(key);
    const preset = periodPresets().find((p) => p.key === key);
    if (!preset) return;
    setFrom(preset.from);
    setTo(preset.to);
  }

  function resetOptions() {
    setActivePreset("all");
    setFrom("");
    setTo("");
    setIncludeZero(settings.includeZeroRowsDefault);
    setTemplateId(settings.defaultTemplate);
  }

  const optionsDirty =
    activePreset !== "all" ||
    includeZero !== settings.includeZeroRowsDefault ||
    templateId !== settings.defaultTemplate;

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

  const partyTabs: { type: StatementEntityType; label: string; icon: typeof UserCheck }[] = [
    { type: "customer", label: ar ? "حسابات العملاء" : "Customers", icon: UserCheck },
    { type: "supplier", label: ar ? "حسابات الموردين" : "Suppliers", icon: Building2 },
    { type: "cash", label: ar ? "الصندوق والبنك" : "Treasury", icon: Wallet },
  ];

  const alignClass = (align: "start" | "center" | "end") =>
    align === "end" ? "text-end" : align === "center" ? "text-center" : "text-start";

  const columns = layout?.columns ?? [];

  return (
    <>
      <PageHeader
        title={ar ? "كشف حساب تفصيلي (عميل / مورد)" : "Account Statement"}
        subtitle={
          ar
            ? "تتبع وحساب الأرصدة التراكمية والفواتير والتحصيلات خطوة بخطوة"
            : "Live customer & supplier account statement with running balance"
        }
        actions={
          <div className="flex items-center gap-2">
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
                    onClick={() => setPartyType(tab.type)}
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

        {/* ═══ شريط الخيارات المضغوط (جديد — داخل نفس الشاشة) ═══ */}
        <div className="panel-elevated">
          <button
            type="button"
            onClick={() => setOptionsOpen((v) => !v)}
            className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-start"
          >
            <span className="flex items-center gap-2 text-xs font-semibold">
              <Filter className="h-3.5 w-3.5 text-primary" />
              {ar ? "خيارات الكشف" : "Statement options"}
              {result && (
                <span className="font-normal text-muted-foreground">· {result.period.label}</span>
              )}
              {optionsDirty && (
                <span className="rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                  {ar ? "مُعدَّلة" : "modified"}
                </span>
              )}
            </span>
            <ChevronDown
              className={cn(
                "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
                optionsOpen && "rotate-180",
              )}
            />
          </button>

          {optionsOpen && (
            <div className="flex flex-wrap items-end gap-3 border-t border-border/60 px-4 py-3">
              {/* نطاقات جاهزة */}
              <div className="flex flex-col gap-1">
                <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  {ar ? "الفترة" : "Period"}
                </span>
                <div className="flex flex-wrap gap-1">
                  {periodPresets().map((p) => (
                    <button
                      key={p.key}
                      type="button"
                      onClick={() => applyPreset(p.key)}
                      className={cn(
                        "rounded-full border px-2.5 py-1 text-[11px] font-medium transition",
                        activePreset === p.key
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border/80 text-muted-foreground hover:bg-surface-2 hover:text-foreground",
                      )}
                    >
                      {ar ? p.ar : p.en}
                    </button>
                  ))}
                </div>
              </div>

              {/* من / إلى */}
              <div className="flex flex-col gap-1">
                <span className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  <Calendar className="h-3 w-3" />
                  {ar ? "من" : "From"}
                </span>
                <Input
                  type="date"
                  value={from}
                  onChange={(e) => {
                    setFrom(e.target.value);
                    setActivePreset("custom");
                  }}
                  className="h-8 w-[140px] text-xs"
                />
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  {ar ? "إلى" : "To"}
                </span>
                <Input
                  type="date"
                  value={to}
                  onChange={(e) => {
                    setTo(e.target.value);
                    setActivePreset("custom");
                  }}
                  className="h-8 w-[140px] text-xs"
                />
              </div>

              {/* القالب */}
              <div className="flex flex-col gap-1">
                <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  {ar ? "القالب" : "Template"}
                </span>
                <Select
                  value={templateId}
                  onValueChange={(v) => setTemplateId(v as StatementTemplateId)}
                >
                  <SelectTrigger className="h-8 w-[150px] text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TEMPLATE_ORDER.map((id) => (
                      <SelectItem key={id} value={id}>
                        {templateLabel(id, lang)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* إظهار المسددة */}
              <label className="flex h-8 cursor-pointer items-center gap-2 rounded-lg border border-border/80 bg-surface/60 px-3">
                <Checkbox
                  checked={includeZero}
                  onCheckedChange={(v) => setIncludeZero(Boolean(v))}
                  className="h-3.5 w-3.5"
                />
                <span className="text-[11px]">
                  {ar ? "إظهار الفواتير المسددة" : "Include settled"}
                </span>
              </label>

              {/* إعادة الضبط */}
              <Button
                variant="ghost"
                size="sm"
                onClick={resetOptions}
                disabled={!optionsDirty}
                className="h-8 gap-1.5 text-[11px] text-muted-foreground"
              >
                <RotateCcw className="h-3 w-3" />
                {ar ? "إعادة الضبط" : "Reset"}
              </Button>
            </div>
          )}
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
                      <TableRow key={row.id} className="hover:bg-surface-2/60">
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
    </>
  );
}

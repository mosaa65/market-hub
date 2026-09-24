/**
 * StatementDocument — مستند الكشف النهائي (شاشة)
 *
 * ⚠️ قرار إلزامي (Phase 8): هذا هو **أول شاشة** تظهر بعد «إنشاء الكشف».
 * لا شاشة معاينة وسيطة. المستند يطابق ما سيُطبع في PDF.
 *
 * يحتوي: ترويسة المنشأة + هوية Inama Soft · بيانات الجهة · الملخص
 *        · شارة فرق التسوية · جدول الحركات · الإجماليات · التوقيعات · التذييل
 */

import { useState } from "react";
import { ArrowRight, Download, Loader2, Printer, RefreshCw, Settings2, Share2 } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { StatementSummaryCards } from "./statement-summary-cards";
import { StatementTransactionsTable } from "./statement-transactions-table";
import { StatementIntegrityBadge, SourceBadge } from "./statement-integrity-badge";
import { StatementExportDialog } from "./statement-export-dialog";
import { printStatementDocument } from "@/lib/statements/print";
import {
  exportStatementToCsv,
  statementFilename,
  statementTextSummary,
} from "@/lib/statements/export";
import { fmtMoney } from "@/lib/statements/format";
import { INAMA_SOFT_BRAND } from "@/lib/statements/company";
import type { StatementCompanyInfo } from "@/lib/statements/company";
import type { StatementLayout, StatementResult, StatementTemplateId } from "@/lib/statements/types";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export interface StatementDocumentProps {
  result: StatementResult | null;
  layout: StatementLayout | null;
  company: StatementCompanyInfo | null;
  currencySymbol: string;
  templateId: StatementTemplateId;
  onTemplateChange: (id: StatementTemplateId) => void;
  /** حالة الجلب */
  isLoading: boolean;
  hasSourceData: boolean;
  derived: boolean;
  /** إجراءات */
  onRefetch: () => void;
  /** مسار العودة لتعديل الفلاتر */
  filtersLink: { to: string; search?: Record<string, unknown> };
}

export function StatementDocument({
  result,
  layout,
  company,
  currencySymbol,
  templateId,
  onTemplateChange,
  isLoading,
  hasSourceData,
  derived,
  onRefetch,
  filtersLink,
}: StatementDocumentProps) {
  const { lang } = useI18n();
  const ar = lang === "ar";
  const [exportOpen, setExportOpen] = useState(false);

  if (isLoading || !result || !layout) {
    return (
      <div className="panel-elevated grid place-items-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        <p className="mt-3 text-xs text-muted-foreground">
          {ar ? "جارٍ بناء الكشف من دفتر الحساب..." : "Building statement from the ledger..."}
        </p>
      </div>
    );
  }

  const entity = result.entity;
  const logoUrl = company?.logoUrl ?? INAMA_SOFT_BRAND.logoUrl;
  const companyName = company?.name ?? INAMA_SOFT_BRAND.softwareName;

  function handlePrint() {
    if (!result || !layout || !company) return;
    printStatementDocument({
      result,
      layout,
      lang,
      currencySymbol,
      company,
      includeOpeningRow: layout.showOpeningRow,
    });
  }

  function handleCsv() {
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

  async function handleShare() {
    if (!result || !layout) return;
    const text = statementTextSummary(result, layout, lang);
    try {
      if (navigator.share) {
        await navigator.share({ title: layout.title, text });
      } else {
        await navigator.clipboard.writeText(text);
        toast.success(ar ? "تم نسخ ملخص الكشف" : "Statement summary copied");
      }
    } catch {
      // إلغاء المستخدم لمشاركة — لا نُظهر خطأ
    }
  }

  return (
    <div className="space-y-4">
      {/* ── شريط الإجراءات ── */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Link to={filtersLink.to} search={filtersLink.search as never}>
            <Button variant="outline" size="sm" className="gap-1.5 text-xs">
              <ArrowRight className="h-3.5 w-3.5 rtl:rotate-180" />
              {ar ? "تعديل الفلاتر" : "Edit filters"}
            </Button>
          </Link>
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5 text-xs text-muted-foreground"
            onClick={onRefetch}
          >
            <RefreshCw className="h-3.5 w-3.5" />
            {ar ? "تحديث" : "Refresh"}
          </Button>
          <SourceBadge derived={derived} hasSourceData={hasSourceData} />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={handleCsv}>
            <Download className="h-3.5 w-3.5" />
            {ar ? "CSV" : "CSV"}
          </Button>
          <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={handleShare}>
            <Share2 className="h-3.5 w-3.5" />
            {ar ? "مشاركة" : "Share"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 text-xs"
            onClick={() => setExportOpen(true)}
          >
            <Settings2 className="h-3.5 w-3.5" />
            {ar ? "خيارات التصدير" : "Export options"}
          </Button>
          <Button size="sm" className="gap-1.5 text-xs" onClick={handlePrint}>
            <Printer className="h-3.5 w-3.5" />
            {ar ? "طباعة / PDF" : "Print / PDF"}
          </Button>
        </div>
      </div>

      {/* ── المستند ── */}
      <div className="panel-elevated overflow-hidden">
        {/* ترويسة المنشأة + Inama Soft */}
        <div className="flex flex-wrap items-start justify-between gap-4 border-b-2 border-foreground/80 px-5 py-4">
          <div className="flex items-start gap-3">
            {layout.header.showLogo && (
              <img
                src={logoUrl}
                alt={companyName}
                className="h-13 w-13 h-[52px] w-[52px] shrink-0 rounded-xl border border-border/70 bg-white object-contain p-1"
                onError={(e) => {
                  const img = e.currentTarget;
                  if (img.src !== INAMA_SOFT_BRAND.logoUrl) img.src = INAMA_SOFT_BRAND.logoUrl;
                }}
              />
            )}
            <div className="min-w-0">
              <h2 className="text-xl font-bold leading-tight">{companyName}</h2>
              {layout.header.showLegalName && company?.legalName && (
                <div className="text-[11px] text-muted-foreground">{company.legalName}</div>
              )}
              <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-muted-foreground">
                {layout.header.showAddress && company?.address && <span>{company.address}</span>}
                {layout.header.showPhone && company?.phone && (
                  <>
                    {layout.header.showAddress && company?.address && (
                      <span className="opacity-40">·</span>
                    )}
                    <span dir="ltr">{company.phone}</span>
                  </>
                )}
                {layout.header.showTaxNumber && company?.taxNumber && (
                  <>
                    <span className="opacity-40">·</span>
                    <span>
                      {ar ? "الرقم الضريبي" : "Tax"}: <span dir="ltr">{company.taxNumber}</span>
                    </span>
                  </>
                )}
              </div>
              {layout.header.customLine && (
                <div className="mt-0.5 text-[10px] text-muted-foreground">
                  {layout.header.customLine}
                </div>
              )}
            </div>
          </div>

          <div className="text-end">
            <h3 className="text-lg font-bold text-amber-600">{layout.title}</h3>
            <div className="text-[10px] text-muted-foreground">{layout.subtitle}</div>
            <div className="mt-1 inline-block rounded-md border border-border bg-surface px-2.5 py-1 font-mono text-[10px]">
              {result.period.label}
            </div>
            <div className="mt-1 text-[10px] text-muted-foreground">
              {ar ? "تاريخ الإصدار" : "Issued"}:{" "}
              {new Date(result.generatedAt).toLocaleDateString(ar ? "ar-YE" : "en-GB")}
            </div>
          </div>
        </div>

        <div className="space-y-4 p-5">
          {/* بيانات الجهة + الملخص */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)]">
            {entity && (
              <div className="rounded-2xl border border-border/80 bg-white/40">
                <div className="border-b border-border/70 bg-surface/70 px-3.5 py-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  {ar ? "بيانات الحساب" : "Account details"}
                </div>
                <div className="space-y-1 p-3.5 text-xs">
                  <EntityRow label={ar ? "الاسم" : "Name"} value={entity.name} strong />
                  {entity.phone && (
                    <EntityRow label={ar ? "الهاتف" : "Phone"} value={entity.phone} />
                  )}
                  {entity.email && (
                    <EntityRow label={ar ? "البريد" : "Email"} value={entity.email} />
                  )}
                  {entity.address && (
                    <EntityRow label={ar ? "العنوان" : "Address"} value={entity.address} />
                  )}
                  {entity.creditLimit !== null && entity.creditLimit > 0 && (
                    <EntityRow
                      label={ar ? "الحد الائتماني" : "Credit limit"}
                      value={fmtMoney(entity.creditLimit, currencySymbol)}
                    />
                  )}
                  <EntityRow
                    label={ar ? "نوع الحساب" : "Account type"}
                    value={
                      entity.type === "supplier"
                        ? ar
                          ? "مورد"
                          : "Supplier"
                        : entity.type === "cash"
                          ? ar
                            ? "صندوق / بنك"
                            : "Cash / Bank"
                          : ar
                            ? "عميل"
                            : "Customer"
                    }
                  />
                </div>
              </div>
            )}

            <div className="space-y-2.5">
              <StatementSummaryCards result={result} currencySymbol={currencySymbol} />
              {result.entityType === "cash" && (
                <div className="rounded-xl border border-border/70 bg-surface/50 px-3.5 py-2 text-[11px] text-muted-foreground">
                  {ar
                    ? "كشف الخزينة يجمع: تحصيلات العملاء (وارد) · سداد الموردين والمصروفات (صادر)."
                    : "Treasury statement aggregates: collections (in) · supplier payments and expenses (out)."}
                </div>
              )}
            </div>
          </div>

          {/* شارة فرق التسوية — قرار المستخدم #1 */}
          <StatementIntegrityBadge integrity={result.integrity} variant="panel" />

          <Separator />

          {/* جدول الحركات */}
          <StatementTransactionsTable result={result} layout={layout} />

          {/* التذييل */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/70 pt-3 text-[10px] text-muted-foreground">
            <div className="max-w-md space-y-0.5">
              {layout.footerNote && <div>{layout.footerNote}</div>}
              <div>
                {INAMA_SOFT_BRAND.softwareName} · {INAMA_SOFT_BRAND.name}
              </div>
            </div>
            {layout.showBrandFooter && (
              <div className="flex items-center gap-2">
                <img
                  src={INAMA_SOFT_BRAND.logoUrl}
                  alt={INAMA_SOFT_BRAND.name}
                  className="h-5 w-5 object-contain"
                />
                <div className="leading-tight">
                  <div className="font-semibold text-foreground/80">{INAMA_SOFT_BRAND.name}</div>
                  <div>
                    {ar ? "هاتف" : "Tel"}: <span dir="ltr">{INAMA_SOFT_BRAND.phone}</span> ·{" "}
                    {INAMA_SOFT_BRAND.website}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <StatementExportDialog
        open={exportOpen}
        onOpenChange={setExportOpen}
        result={result}
        layout={layout}
        company={company}
        currencySymbol={currencySymbol}
        templateId={templateId}
        onTemplateChange={onTemplateChange}
      />
    </div>
  );
}

function EntityRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn("truncate text-end", strong ? "font-semibold" : "")}>{value}</span>
    </div>
  );
}

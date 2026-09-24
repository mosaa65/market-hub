/**
 * StatementExportDialog — لوحة تصدير الكشف (Report Builder مبسّط)
 *
 * بدل زر «Export» الغامض: تُفصح اللوحة عن
 *   ماذا سيصدر · لمن · لأي فترة · أي قالب · أي حقول · بأي صيغة.
 *
 * يُعيد استخدام:
 *   - exportStatementToCsv / exportStatementToHtmlTable (تغليف exportToCSV الموجود)
 *   - printStatementDocument (قالب الطباعة المستقل)
 */

import { useMemo, useState } from "react";
import { Download, FileSpreadsheet, Printer, FileText, Check } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { STATEMENT_TEMPLATES, TEMPLATE_ORDER, templateLabel } from "@/lib/statements/templates";
import {
  exportStatementToCsv,
  exportStatementToHtmlTable,
  statementFilename,
} from "@/lib/statements/export";
import { printStatementDocument } from "@/lib/statements/print";
import { fmtAmount } from "@/lib/statements/format";
import type {
  StatementFieldKey,
  StatementLayout,
  StatementResult,
  StatementTemplateId,
} from "@/lib/statements/types";
import type { StatementCompanyInfo } from "@/lib/statements/company";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

interface StatementExportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  result: StatementResult | null;
  layout: StatementLayout | null;
  company: StatementCompanyInfo | null;
  currencySymbol: string;
  /** تغيير القالب مباشرة من اللوحة */
  templateId: StatementTemplateId;
  onTemplateChange: (id: StatementTemplateId) => void;
}

type ExportFormat = "print" | "csv" | "html";

export function StatementExportDialog({
  open,
  onOpenChange,
  result,
  layout,
  company,
  currencySymbol,
  templateId,
  onTemplateChange,
}: StatementExportDialogProps) {
  const { lang } = useI18n();
  const ar = lang === "ar";
  const [format, setFormat] = useState<ExportFormat>("print");

  // الأعمدة المسموحة بالقالب المختار — تُستخدم لتوضيح ما سيصدَّر فعلًا
  const allowedFields = useMemo<StatementFieldKey[]>(
    () => STATEMENT_TEMPLATES[templateId]?.allowedFields ?? [],
    [templateId],
  );

  const exportedColumns = useMemo(
    () => (layout ? layout.columns.filter((c) => allowedFields.includes(c.key)) : []),
    [layout, allowedFields],
  );

  if (!result || !layout) return null;

  const filename = statementFilename(result, lang);
  const entityName = result.entity?.name ?? (ar ? "حساب غير محدد" : "Unspecified account");

  function handleExport() {
    if (!result || !layout) return;
    if (!company) {
      toast.error(ar ? "بيانات المنشأة لم تُحمَّل بعد" : "Company profile not loaded yet");
      return;
    }

    if (format === "print") {
      printStatementDocument({
        result,
        layout,
        lang,
        currencySymbol,
        company,
        includeOpeningRow: layout.showOpeningRow,
      });
      toast.success(ar ? "تم فتح الكشف للطباعة" : "Statement opened for printing");
    } else if (format === "csv") {
      exportStatementToCsv({ result, layout, lang, filename, currencySymbol });
      toast.success(ar ? "تم تصدير الملف" : "File exported");
    } else {
      exportStatementToHtmlTable({ result, layout, lang, filename, currencySymbol });
      toast.success(ar ? "تم فتح جدول التصدير" : "Export table opened");
    }
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Download className="h-4 w-4 text-primary" />
            {ar ? "تصدير الكشف" : "Export statement"}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {ar
              ? "راجع ما سيتم تصديره قبل التأكيد — الكشف نفسه هو ما سيُطبع، بلا شاشة معاينة وسيطة."
              : "Review exactly what will be exported before confirming."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3.5 text-sm">
          {/* ماذا سيصدر */}
          <section className="rounded-2xl border border-border/80 bg-surface/50 p-3.5">
            <Row label={ar ? "ما سيُصدَّر" : "What"} value={layout.title} />
            <Row label={ar ? "الجهة" : "Party"} value={entityName} />
            <Row label={ar ? "الفترة" : "Period"} value={result.period.label} />
            <Row
              label={ar ? "عدد الحركات" : "Entries"}
              value={`${result.countedRows}${ar ? " حركة" : ""}`}
            />
            <Row
              label={ar ? "الرصيد الختامي" : "Closing"}
              value={`${fmtAmount(result.closingBalance)} ${currencySymbol}`}
              strong
            />
          </section>

          {/* القالب */}
          <section className="space-y-1.5">
            <Label>{ar ? "القالب" : "Template"}</Label>
            <Select
              value={templateId}
              onValueChange={(v) => onTemplateChange(v as StatementTemplateId)}
            >
              <SelectTrigger className="h-9">
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
          </section>

          {/* الأعمدة */}
          <section className="space-y-1.5">
            <Label>
              {ar ? "الأعمدة المضمّنة" : "Included columns"}{" "}
              <span className="text-[10px] text-muted-foreground">
                ({ar ? "تُضبط من الإعدادات" : "configured in Settings"})
              </span>
            </Label>
            <div className="flex flex-wrap gap-1.5">
              {exportedColumns.map((c) => (
                <span
                  key={c.key}
                  className="inline-flex items-center gap-1 rounded-full border border-primary/25 bg-primary/5 px-2 py-0.5 text-[10px] text-primary"
                >
                  <Check className="h-2.5 w-2.5" />
                  {c.label}
                </span>
              ))}
            </div>
          </section>

          <Separator />

          {/* الصيغة */}
          <section className="space-y-1.5">
            <Label>{ar ? "صيغة التصدير" : "Format"}</Label>
            <div className="grid grid-cols-3 gap-2">
              <FormatButton
                active={format === "print"}
                onClick={() => setFormat("print")}
                icon={Printer}
                label={ar ? "طباعة A4 / PDF" : "Print A4 / PDF"}
              />
              <FormatButton
                active={format === "csv"}
                onClick={() => setFormat("csv")}
                icon={FileSpreadsheet}
                label={ar ? "CSV / Excel" : "CSV / Excel"}
              />
              <FormatButton
                active={format === "html"}
                onClick={() => setFormat("html")}
                icon={FileText}
                label={ar ? "جدول HTML" : "HTML table"}
              />
            </div>
            <p className="pt-0.5 text-[11px] text-muted-foreground">
              {format === "print"
                ? ar
                  ? "يُفتح الكشف النهائي مباشرة في نافذة الطباعة (قابل للحفظ كـ PDF)."
                  : "Opens the final statement directly in the print dialog."
                : format === "csv"
                  ? ar
                    ? "ملف CSV بترميز UTF-8 يفتح في Excel بالعربية بشكل صحيح."
                    : "UTF-8 CSV that opens correctly in Excel."
                  : ar
                    ? "يُفتح الجدول في نافذة جديدة قابلة للنسخ والطباعة."
                    : "Opens a printable HTML table in a new window."}
            </p>
          </section>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {ar ? "إلغاء" : "Cancel"}
          </Button>
          <Button onClick={handleExport} className="gap-1.5">
            <Download className="h-4 w-4" />
            {ar ? "تصدير" : "Export"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------

function Label({ children }: { children: React.ReactNode }) {
  return <div className="text-xs font-medium text-muted-foreground">{children}</div>;
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-0.5 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn("truncate text-end", strong ? "font-mono font-bold" : "font-medium")}>
        {value}
      </span>
    </div>
  );
}

function FormatButton({
  active,
  onClick,
  icon: Icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex flex-col items-center gap-1.5 rounded-xl border px-2 py-3 text-[11px] font-medium transition-all",
        active
          ? "border-primary bg-primary/10 text-primary ring-1 ring-primary/30"
          : "border-border/80 text-muted-foreground hover:bg-surface-2 hover:text-foreground",
      )}
    >
      <Icon className="h-4 w-4" />
      <span className="text-center leading-tight">{label}</span>
    </button>
  );
}

/** خيار إظهار الحركات المسددة كليًا — يُستخدم في منشئ الكشف والمستند */
export function IncludeZeroRowsToggle({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  const { lang } = useI18n();
  const ar = lang === "ar";
  return (
    <label className="flex cursor-pointer items-center gap-2 text-xs">
      <Checkbox checked={checked} onCheckedChange={(v) => onChange(Boolean(v))} />
      <span>{ar ? "إظهار الفواتير المسددة كليًا" : "Include fully settled invoices"}</span>
    </label>
  );
}

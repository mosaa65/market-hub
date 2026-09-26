import { FileSpreadsheet, Printer } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { statementPrintStyles } from "@/lib/statements/print-styles";
import {
  STATEMENT_COMPANY,
  loadStatementCompany,
  type StatementCompanyInfo,
} from "@/lib/statements/company";
import { openStatementPrintWindow } from "@/lib/statements/print";

export interface LuxuryReportHeader {
  label: string;
  align?: "start" | "center" | "end";
}

export interface LuxuryReportOptions {
  title: string;
  subtitle?: string;
  periodLabel?: string;
  headers: Array<LuxuryReportHeader | string>;
  rows: (string | number)[][];
  totalsRow?: {
    label: string;
    values: Record<number, string | number>;
  };
  summaryCards?: Array<{ label: string; value: string }>;
  notesText?: string;
  currencySymbol?: string;
  ar: boolean;
  company?: StatementCompanyInfo;
}

export function exportReportToExcel(
  filename: string,
  headers: string[],
  rows: (string | number)[][],
  ar = true,
): void {
  const csvContent =
    "\ufeff" +
    [headers, ...rows]
      .map((row) =>
        row
          .map((value) => {
            const str = String(value ?? "");
            return `"${str.replace(/"/g, '""')}"`;
          })
          .join(","),
      )
      .join("\r\n");

  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  const cleanName = filename.trim().replace(/[\\/:*?"<>|]/g, "_") || (ar ? "كشف_البيانات" : "report");
  link.download = `${cleanName}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
  toast.success(ar ? "تم تصدير ملف Excel بنجاح" : "Excel file exported successfully");
}

/** اسم متوافق مع الاستخدامات السابقة */
export const exportReportRows = (
  filename: string,
  headers: string[],
  rows: (string | number)[][],
): void => {
  exportReportToExcel(filename, headers, rows, true);
};

export async function printLuxuryReport(options: LuxuryReportOptions): Promise<void> {
  const {
    title,
    subtitle,
    periodLabel,
    headers,
    rows,
    totalsRow,
    summaryCards,
    notesText,
    currencySymbol = "﷼",
    ar,
  } = options;

  let company = options.company;
  if (!company) {
    try {
      company = await loadStatementCompany();
    } catch {
      company = STATEMENT_COMPANY;
    }
  }

  const lang = ar ? "ar" : "en";
  const now = new Date();
  const issueDate = now.toLocaleDateString(ar ? "ar-YE" : "en-GB");

  const normalizedHeaders: LuxuryReportHeader[] = headers.map((h) =>
    typeof h === "string" ? { label: h, align: "center" } : h,
  );

  // رأس الجدول
  const thCells = [
    `<th style="width:40px;text-align:center;">#</th>`,
    ...normalizedHeaders.map((h) => {
      const align = h.align === "end" ? (ar ? "left" : "right") : h.align === "start" ? (ar ? "right" : "left") : "center";
      return `<th style="text-align:${align};">${escapeHtml(h.label)}</th>`;
    }),
  ].join("");

  // صفوف البيانات
  const bodyRows = rows.map((row, idx) => {
    const cells = row.map((cell, cIdx) => {
      const headerDef = normalizedHeaders[cIdx];
      const align = headerDef?.align === "end" ? (ar ? "left" : "right") : headerDef?.align === "start" ? (ar ? "right" : "left") : "center";
      const isNum = headerDef?.align === "end";
      return `<td class="${isNum ? "num" : ""}" style="text-align:${align};">${escapeHtml(String(cell ?? "—"))}</td>`;
    });
    return `<tr><td class="num" style="text-align:center;">${idx + 1}</td>${cells.join("")}</tr>`;
  }).join("");

  // صف الإجمالي النهائي
  let grandTotalRow = "";
  if (totalsRow) {
    const totalCells = normalizedHeaders.map((_, cIdx) => {
      const val = totalsRow.values[cIdx];
      return `<td style="text-align:${ar ? "left" : "right"};">${val !== undefined ? escapeHtml(String(val)) : ""}</td>`;
    });
    // أول خانة مع الترقيم
    grandTotalRow = `<tr class="grand-total">
      <td colspan="2" style="text-align:${ar ? "right" : "left"};font-weight:700;">${escapeHtml(totalsRow.label)}</td>
      ${totalCells.slice(1).join("")}
    </tr>`;
  }

  // بطاقات الملخص إن وجدت
  let summaryCardsHtml = "";
  if (summaryCards && summaryCards.length > 0) {
    summaryCardsHtml = `
    <div class="luxury-cards">
      ${summaryCards
        .map(
          (c) => `
        <div class="luxury-card">
          <div class="lc-label">${escapeHtml(c.label)}</div>
          <div class="lc-val">${escapeHtml(c.value)}</div>
        </div>`,
        )
        .join("")}
    </div>`;
  }

  const logoUrl = company.logoUrl || "/inama-soft-logo.ico";

  const html = `<!doctype html>
<html dir="${ar ? "rtl" : "ltr"}" lang="${lang}">
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(title)}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800&family=Amiri:wght@400;700&family=IBM+Plex+Mono:wght@400;600&display=swap" rel="stylesheet">
  <style>${statementPrintStyles(lang)}</style>
</head>
<body>
  <div class="page">
    <!-- Header -->
    <div class="rpt-head legacy-head">
      <div class="legacy-brand">
        <img class="co-logo" src="${escapeHtml(logoUrl)}" alt="Inama Soft" />
        <div class="legacy-brand-name">Inama Soft</div>
      </div>
      <div class="rpt-title legacy-title">
        <h2>${escapeHtml(title)}</h2>
        <div class="sub">${escapeHtml(subtitle || (ar ? "كشف تفصيلي" : "Detailed Report"))}</div>
        <div class="period">${escapeHtml(periodLabel || (ar ? "كل الفترات" : "All periods"))}</div>
      </div>
      <div class="legacy-branch">
        <b>${ar ? "الفرع الرئيسي" : "Main Branch"}</b>
        <span>${escapeHtml(company.name)}</span>
        ${company.phone ? `<span dir="ltr">${escapeHtml(company.phone)}</span>` : ""}
        <small>${ar ? "تاريخ الإصدار" : "Issued"}: ${escapeHtml(issueDate)}</small>
      </div>
    </div>

    ${summaryCardsHtml}

    <!-- Table -->
    <table class="luxury-report-table">
      <thead>
        <tr>${thCells}</tr>
      </thead>
      <tbody>
        ${bodyRows || `<tr><td colspan="${normalizedHeaders.length + 1}" style="text-align:center;padding:24px;color:var(--muted);">${ar ? "لا توجد بيانات مطابقة" : "No matching records"}</td></tr>`}
        ${grandTotalRow}
      </tbody>
    </table>

    <div class="legacy-currency">
      ${ar ? "العملة" : "Currency"}: ${escapeHtml(currencySymbol)}
    </div>

    <!-- Notes -->
    <div class="notes">
      <b>${ar ? "ملاحظات" : "Notes"}:</b> ${escapeHtml(
        notesText ||
          ".....................................................................................................",
      )}
    </div>

    <!-- Signatures -->
    <div class="sigs">
      <div class="sig">
        <div class="pad"></div>
        <div class="line">${ar ? "المدير العام" : "General Manager"}</div>
      </div>
      <div class="sig">
        <div class="pad"></div>
        <div class="line">${ar ? "المحاسب المسؤول" : "Accountant in Charge"}</div>
      </div>
      <div class="sig">
        <div class="pad"></div>
        <div class="line">${ar ? "المراجع والمدقق" : "Auditor"}</div>
      </div>
    </div>

    <!-- Footer -->
    <div class="rpt-foot">
      <div>
        <div>${ar ? "هذا الكشف أنشئ من النظام ويمكن حفظه كملف PDF من نافذة الطباعة." : "This statement was generated by the system and can be saved as PDF."}</div>
        <div style="font-weight:600;margin-top:2px;">Market Hub · Inama Soft</div>
      </div>
      <div class="brand">
        <div class="brand-txt" style="text-align:${ar ? "right" : "left"};">
          <b>Inama Soft</b>
          <div>Mousa Gamil Al-Awadhi - Ibb, Yemen</div>
          <div dir="ltr">inma-soft.vercel.app &nbsp; +967 772 217 218</div>
        </div>
        <img src="/inama-soft-logo.ico" alt="Inama Soft" />
      </div>
    </div>
  </div>
</body>
</html>`;

  openStatementPrintWindow(html);
}

/** طباعة متوافقة مع الاستدعاءات القديمة ولكن بالقالب الفاخر الموحد */
export function printReportRows(
  title: string,
  headers: string[],
  rows: string[][],
  ar: boolean,
): void {
  void printLuxuryReport({
    title,
    headers,
    rows,
    ar,
  });
}

export function ReportRowDetails({
  open,
  onOpenChange,
  title,
  values,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  values: Array<[string, string]>;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="space-y-1 rounded-lg border-border p-3">
          {values.map(([label, value]) => (
            <div
              key={label}
              className="flex justify-between gap-4 border-b border-border/50 py-2 text-xs last:border-0"
            >
              <span className="text-muted-foreground">{label}</span>
              <span className="text-end font-medium">{value || "—"}</span>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function ReportOutputButtons({
  ar,
  onExport,
  onPrint,
  disabled = false,
}: {
  ar: boolean;
  onExport: () => void;
  onPrint: () => void;
  disabled?: boolean;
}) {
  return (
    <>
      <Button
        onClick={onExport}
        variant="outline"
        size="sm"
        disabled={disabled}
        className="gap-2 text-emerald-500 border-emerald-500/30 hover:bg-emerald-500/10"
      >
        <FileSpreadsheet className="h-4 w-4" />
        {ar ? "تصدير Excel" : "Export Excel"}
      </Button>
      <Button
        onClick={onPrint}
        size="sm"
        disabled={disabled}
        className="gap-2 bg-primary hover:bg-primary/90 text-primary-foreground"
      >
        <Printer className="h-4 w-4" />
        {ar ? "طباعة PDF فاخر" : "Print PDF"}
      </Button>
    </>
  );
}

function escapeHtml(value: string): string {
  return String(value).replace(
    /[&<>'"]/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char] ?? char,
  );
}

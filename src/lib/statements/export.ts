/**
 * Statement Export — CSV / HTML table للكشوف
 *
 * يُعيد استخدام exportToCSV الموجودة في src/lib/excel-export.ts بلا تعديل.
 * لا يكرر منطق التنسيق: يستخدم format.ts الموحّد.
 */

import { exportToCSV, exportToHTMLTable } from "@/lib/excel-export";
import { cellValue, esc, fmtAmount } from "./format";
import { kindLabel } from "./engine";
import type { StatementLayout, StatementResult } from "./types";

export interface StatementExportOptions {
  result: StatementResult;
  layout: StatementLayout;
  lang: "ar" | "en";
  /** اسم الملف بلا امتداد */
  filename: string;
  currencySymbol?: string;
}

function buildColumns(
  result: StatementResult,
  layout: StatementLayout,
  lang: "ar" | "en",
): { key: string; header: string; format?: "money" | "number" | "text" }[] {
  return layout.columns.map((c) => ({
    key: c.key,
    header: c.label,
    format: c.format === "money" ? "money" : c.format === "number" ? "number" : "text",
  }));
}

function buildRows(
  result: StatementResult,
  layout: StatementLayout,
  lang: "ar" | "en",
): Record<string, string | number>[] {
  const rows: Record<string, string | number>[] = [];

  if (layout.showOpeningRow) {
    const opening: Record<string, string | number> = {};
    for (const c of layout.columns) {
      if (c.key === "date") opening[c.key] = result.period.from ?? "";
      else if (c.key === "kind") opening[c.key] = kindLabel("opening", result.entityType, lang);
      else if (c.key === "description")
        opening[c.key] = lang === "ar" ? "رصيد ما قبل بداية الفترة" : "Balance before period start";
      else if (c.key === "balance") opening[c.key] = result.openingBalance;
      else if (c.key === "debit" || c.key === "credit") opening[c.key] = "";
      else opening[c.key] = "";
    }
    rows.push(opening);
  }

  for (const row of result.transactions) {
    const out: Record<string, string | number> = {};
    for (const c of layout.columns) {
      if (c.format === "money") {
        out[c.key] = Math.abs(
          Number(cellValue(row, c, result.entityType, lang).replace(/[^\d.-]/g, "")) || 0,
        );
        // نستخدم القيم الرقمية الحقيقية لا النص المنسّق حتى يقرأها Excel كأرقام
        if (c.key === "debit") out[c.key] = row.debit;
        else if (c.key === "credit") out[c.key] = row.credit;
        else if (c.key === "balance") out[c.key] = row.runningBalance;
      } else if (c.key === "index") {
        out[c.key] = row.index;
      } else {
        out[c.key] = cellValue(row, c, result.entityType, lang);
      }
    }
    rows.push(out);
  }

  return rows;
}

function buildTotalsRow(
  result: StatementResult,
  layout: StatementLayout,
  lang: "ar" | "en",
): Record<string, string | number> {
  const totals: Record<string, string | number> = {};
  for (const c of layout.columns) {
    if (c.key === "kind") totals[c.key] = lang === "ar" ? "الإجمالي" : "Total";
    else if (c.key === "debit") totals[c.key] = result.totalDebit;
    else if (c.key === "credit") totals[c.key] = result.totalCredit;
    else if (c.key === "balance") totals[c.key] = result.closingBalance;
    else totals[c.key] = "";
  }
  return totals;
}

function buildTitle(result: StatementResult, layout: StatementLayout, lang: "ar" | "en"): string {
  const entityName = result.entity?.name ?? "";
  const parts = [layout.title, entityName, result.period.label].filter(Boolean);
  return parts.join(" — ");
}

/** تصدير الكشف إلى CSV (UTF-8 BOM — يفتح في Excel بالعربية سليمًا) */
export function exportStatementToCsv(options: StatementExportOptions): void {
  const { result, layout, lang, filename, currencySymbol } = options;
  exportToCSV({
    filename,
    title: buildTitle(result, layout, lang),
    currency: currencySymbol ?? "﷼",
    columns: buildColumns(result, layout, lang),
    rows: buildRows(result, layout, lang),
    totalsRow: layout.showTotalsRow ? buildTotalsRow(result, layout, lang) : undefined,
    rtl: lang === "ar",
  });
}

/** تصدير الكشف إلى جدول HTML (قابل للطباعة والنسخ) */
export function exportStatementToHtmlTable(options: StatementExportOptions): void {
  const { result, layout, lang, filename, currencySymbol } = options;
  exportToHTMLTable({
    filename,
    title: buildTitle(result, layout, lang),
    currency: currencySymbol ?? "﷼",
    columns: buildColumns(result, layout, lang),
    rows: buildRows(result, layout, lang),
    totalsRow: layout.showTotalsRow ? buildTotalsRow(result, layout, lang) : undefined,
    rtl: lang === "ar",
  });
}

/** اسم ملف آمن للكشف */
export function statementFilename(result: StatementResult, lang: "ar" | "en"): string {
  const name = (result.entity?.name ?? (lang === "ar" ? "حساب" : "account"))
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, "_")
    .slice(0, 40);
  const period =
    result.period.from && result.period.to ? `${result.period.from}_${result.period.to}` : "all";
  return `statement_${name}_${period}`;
}

/** نص ملخص للاستخدام في تنبيهات النسخ */
export function statementTextSummary(
  result: StatementResult,
  layout: StatementLayout,
  lang: "ar" | "en",
): string {
  const ar = lang === "ar";
  const lines = [
    `${layout.title}${result.entity ? ` — ${result.entity.name}` : ""}`,
    `${ar ? "الفترة" : "Period"}: ${result.period.label}`,
    `${ar ? "الرصيد الافتتاحي" : "Opening"}: ${fmtAmount(result.openingBalance)}`,
    `${ar ? "إجمالي المدين" : "Total debit"}: ${fmtAmount(result.totalDebit)}`,
    `${ar ? "إجمالي الدائن" : "Total credit"}: ${fmtAmount(result.totalCredit)}`,
    `${ar ? "الرصيد الختامي" : "Closing"}: ${fmtAmount(result.closingBalance)}`,
  ];
  return lines.join("\n");
}

export { esc };

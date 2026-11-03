/**
 * Vortex ERP — محرك تصدير CSV الآمن والمتوافق مع برامج الجداول
 * المرحلة 7: REP-027
 *
 * الميزات:
 * 1. تضمين UTF-8 BOM لمنع تشوه الأحرف العربية في Microsoft Excel.
 * 2. ترتيب الأعمدة وفق اتجاه RTL لتبدأ الجداول من اليمين بشكل طبيعي.
 * 3. حماية الخلايا الرقمية لتظل أرقاماً حسابية قابلة للجمع بالمعادلات.
 * 4. تضمين ملخص المؤشرات المطبقة أعلى التقرير.
 */

import type { ReportExportPayload } from "./types";
import type { ReportColumnDefinition } from "../types";

/**
 * Excel treats cells that begin with these characters as formulas.  Reports
 * contain user-entered names, notes and document references, so preserving the
 * text verbatim would allow a CSV formula to execute when the file is opened.
 */
function protectCsvFormula(value: string): string {
  return /^[\t\r\n ]*[=+\-@]/.test(value) ? `'${value}` : value;
}

function escapeCsvCell(val: unknown): string {
  if (val === undefined || val === null) return '""';
  const str = protectCsvFormula(String(val));
  if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return `"${str}"`;
}

export function generateReportCSV(payload: ReportExportPayload): string {
  const { definition, rows, metrics, appliedFilters, currencySymbol = "ر.س" } = payload;
  const lines: string[] = [];

  // 1. ترويسة التقرير
  lines.push(escapeCsvCell(definition.titleAr));
  lines.push(escapeCsvCell(`تاريخ الاستخراج: ${new Date().toLocaleString("ar-SA")}`));

  if (appliedFilters.startDate || appliedFilters.endDate) {
    const from = appliedFilters.startDate || "البداية";
    const to = appliedFilters.endDate || "الآن";
    lines.push(escapeCsvCell(`الفترة: من ${from} إلى ${to}`));
  }
  lines.push('""'); // سطر فارغ

  // 2. بطاقات المؤشرات الملخصة
  if (definition.metrics.length > 0) {
    lines.push(escapeCsvCell("--- ملخص ومؤشرات الأداء ---"));
    for (const metric of definition.metrics) {
      const val = metrics[metric.key];
      const valText = val !== undefined ? String(val) : "—";
      lines.push(`${escapeCsvCell(metric.labelAr)},${escapeCsvCell(valText)}`);
    }
    lines.push('""'); // سطر فارغ
  }

  // 3. الأعمدة المرئية والقابلة للتصدير (معكوسة لـ RTL لتناسب القراءة العربية في الإكسل)
  const exportableCols: ReportColumnDefinition[] = definition.columns.filter(
    (c) => c.exportable !== false,
  );
  const rtlCols = [...exportableCols].reverse();

  // ترويسات الأعمدة
  const headerRow = rtlCols
    .map((col) => {
      let header = col.labelAr;
      if (col.unit) header += ` (${col.unit})`;
      else if (col.dataType === "money") header += ` (${currencySymbol})`;
      return escapeCsvCell(header);
    })
    .join(",");
  lines.push(headerRow);

  // 4. أسطر البيانات
  for (const row of rows) {
    const rowLine = rtlCols
      .map((col) => {
        const val = row[col.key];
        if (
          col.dataType === "money" ||
          col.dataType === "quantity" ||
          col.dataType === "percentage"
        ) {
          const numeric = Number(val);
          return Number.isFinite(numeric) ? String(numeric) : "0";
        }
        return escapeCsvCell(val);
      })
      .join(",");
    lines.push(rowLine);
  }

  // 5. سطر الإجماليات الختامي
  const hasAggregates = rtlCols.some((c) => c.aggregate && c.aggregate !== "none");
  if (hasAggregates && rows.length > 0) {
    const totalsCells = rtlCols.map((col, idx) => {
      if (col.aggregate === "sum") {
        const sum = rows.reduce((acc, r) => acc + (Number(r[col.key]) || 0), 0);
        return String(Number(sum.toFixed(3)));
      }
      if (col.aggregate === "avg") {
        const sum = rows.reduce((acc, r) => acc + (Number(r[col.key]) || 0), 0);
        return String(Number((sum / rows.length).toFixed(2)));
      }
      if (col.aggregate === "count") {
        return String(rows.length);
      }
      // أول عمود من اليسار أو اليمين نضع فيه "الإجمالي"
      if (idx === rtlCols.length - 1) {
        return escapeCsvCell("الإجمالي العام");
      }
      return '""';
    });
    lines.push(totalsCells.join(","));
  }

  // إضافة UTF-8 BOM (\uFEFF) في بداية الملف لضمان قراءة العربية في Excel
  return `\uFEFF${lines.join("\r\n")}`;
}

export function downloadReportCSV(payload: ReportExportPayload, filename?: string): void {
  const content = generateReportCSV(payload);
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");
  const fname = filename || `${payload.definition.id}-${new Date().toISOString().slice(0, 10)}.csv`;

  link.href = URL.createObjectURL(blob);
  link.setAttribute("download", fname);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(link.href);
}

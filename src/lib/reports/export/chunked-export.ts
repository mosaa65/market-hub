/**
 * Vortex ERP — محرك التصدير على دفعات (Chunked Export)
 * المرحلة 7: REP-030
 *
 * الهدف: تجنب تجميد المتصفح (Main Thread Freeze) عند تصدير تقارير
 * تحتوي آلاف السجلات، عبر:
 * 1. تقسيم الصفوف إلى دفعات (chunks) بحجم محسوب.
 * 2. إتاحة الفرصة للمتصفح لرسم الإطارات بين الدفعات (Yield to event loop).
 * 3. تحديث شريط التقدم (onProgress) ليطلع المستخدم على نسبة الإنجاز.
 * 4. دعم الإلغاء (AbortSignal) دون تعليق الواجهة.
 *
 * لا يعيد حساب أي مبلغ أو رصيد — يستخدم القيم الجاهزة من مزود البيانات
 * (التزاماً بقاعدة "منع إعادة حساب المبالغ في محرك التصدير").
 */

import type { ReportExportPayload } from "./types";

export const DEFAULT_CHUNK_SIZE = 500;

export interface ChunkedExportOptions {
  /** عدد الصفوف في كل دفعة. القيمة الافتراضية 500. */
  chunkSize?: number;
  /** يُستدعى بعد كل دفعة مع نسبة الإنجاز 0..1. */
  onProgress?: (progress: number, processedRows: number, totalRows: number) => void;
  /** إشارة إلغاء اختيارية. */
  signal?: AbortSignal;
}

export class ExportAbortedError extends Error {
  constructor() {
    super("تم إلغاء عملية التصدير بواسطة المستخدم.");
    this.name = "ExportAbortedError";
  }
}

function escapeCsvCell(value: unknown): string {
  if (value === undefined || value === null) return '""';
  let text = String(value);
  // Match the safe non-chunked exporter: text beginning with a spreadsheet
  // formula operator must not become executable when opened in Excel.
  if (/^[\t\r\n ]*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

/**
 * تنفيذ عملية ثقيلة على دفعات مع إتاحة الفرصة لواجهة المتصفح.
 * الدالة تعمل بشكل متزامن (async) وترجع النتيجة النهائية للمعالج.
 */
export async function runChunkedExport<T>(
  items: readonly T[],
  processor: (chunk: T[], chunkIndex: number) => void,
  options: ChunkedExportOptions = {},
): Promise<void> {
  const chunkSize = Math.max(1, options.chunkSize ?? DEFAULT_CHUNK_SIZE);
  const total = items.length;
  if (total === 0) {
    options.onProgress?.(1, 0, 0);
    return;
  }

  for (let start = 0; start < total; start += chunkSize) {
    if (options.signal?.aborted) throw new ExportAbortedError();
    const end = Math.min(start + chunkSize, total);
    processor(items.slice(start, end) as T[], Math.floor(start / chunkSize));
    options.onProgress?.(end / total, end, total);
    // نمنح المتصفح فرصة لرسم الإطارات وتحديث شريط التقدم.
    if (end < total) await yieldToMainThread();
  }
}

/** إتاحة الفرصة للمتصفح لمعالجة الأحداث قبل الدفعة التالية. */
export function yieldToMainThread(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
      window.requestAnimationFrame(() => resolve());
    } else {
      setTimeout(resolve, 0);
    }
  });
}

/**
 * بناء سطور CSV على دفعات ثم تحويلها إلى Blob مع UTF-8 BOM.
 * يحافظ على نفس ترتيب الأعمدة والمحتوى الناتج من `generateReportCSV`.
 */
export async function generateReportCSVChunked(
  payload: ReportExportPayload,
  options: ChunkedExportOptions = {},
): Promise<string> {
  const { definition, rows, metrics, appliedFilters, currencySymbol = "ر.س" } = payload;
  const parts: string[] = [];

  const cell = escapeCsvCell;

  parts.push(cell(definition.titleAr));
  parts.push(cell(`تاريخ الاستخراج: ${new Date().toLocaleString("ar-SA")}`));
  if (appliedFilters.startDate || appliedFilters.endDate) {
    const from = appliedFilters.startDate || "البداية";
    const to = appliedFilters.endDate || "الآن";
    parts.push(cell(`الفترة: من ${from} إلى ${to}`));
  }
  parts.push('""');

  if (definition.metrics.length > 0) {
    parts.push(cell("--- ملخص ومؤشرات الأداء ---"));
    for (const metric of definition.metrics) {
      const val = metrics[metric.key];
      parts.push(`${cell(metric.labelAr)},${cell(val !== undefined ? String(val) : "—")}`);
    }
    parts.push('""');
  }

  const exportableCols = definition.columns.filter((c) => c.exportable !== false);
  const rtlCols = [...exportableCols].reverse();

  parts.push(
    rtlCols
      .map((col) => {
        let header = col.labelAr;
        if (col.unit) header += ` (${col.unit})`;
        else if (col.dataType === "money") header += ` (${currencySymbol})`;
        return cell(header);
      })
      .join(","),
  );

  const aggregateSums = new Map<string, number>();
  await runChunkedExport(
    rows,
    (chunk) => {
      for (const row of chunk) {
        for (const col of rtlCols) {
          if (col.aggregate === "sum" || col.aggregate === "avg") {
            aggregateSums.set(
              col.key,
              (aggregateSums.get(col.key) ?? 0) + (Number(row[col.key]) || 0),
            );
          }
        }
        parts.push(
          rtlCols
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
              return cell(val);
            })
            .join(","),
        );
      }
    },
    options,
  );

  const hasAggregates = rtlCols.some((c) => c.aggregate && c.aggregate !== "none");
  if (hasAggregates && rows.length > 0) {
    const totals = rtlCols.map((col, idx) => {
      if (col.aggregate === "sum") {
        const sum = aggregateSums.get(col.key) ?? 0;
        return String(Number(sum.toFixed(3)));
      }
      if (col.aggregate === "avg") {
        const sum = aggregateSums.get(col.key) ?? 0;
        return String(Number((sum / rows.length).toFixed(2)));
      }
      if (col.aggregate === "count") return String(rows.length);
      if (idx === rtlCols.length - 1) return cell("الإجمالي العام");
      return '""';
    });
    parts.push(totals.join(","));
  }

  return `\uFEFF${parts.join("\r\n")}`;
}

/** تنزيل CSV على دفعات (يستدعى من الواجهة فقط). */
export async function downloadReportCSVChunked(
  payload: ReportExportPayload,
  filename?: string,
  options: ChunkedExportOptions = {},
): Promise<void> {
  const content = await generateReportCSVChunked(payload, options);
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const fname = filename || `${payload.definition.id}-${new Date().toISOString().slice(0, 10)}.csv`;

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.setAttribute("download", fname);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

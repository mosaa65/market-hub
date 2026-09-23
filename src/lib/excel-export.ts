/**
 * Excel / CSV Export Module for Vortex ERP
 *
 * Lightweight CSV export with full Arabic support and RTL column ordering.
 * Uses UTF-8 BOM for proper Arabic rendering in Excel.
 *
 * Architecture designed so a future XLSX library (e.g. ExcelJS, SheetJS)
 * can be dropped in by simply replacing the internal `generateFile` method.
 */

export interface ExportColumn {
  key: string;
  header: string;
  format?: "money" | "number" | "text";
}

export interface ExportOptions {
  filename: string;
  sheetName?: string;
  title?: string;
  columns: ExportColumn[];
  rows: Record<string, string | number | null | undefined>[];
  totalsRow?: Record<string, string | number>;
  currency?: string;
  rtl?: boolean;
}

/**
 * Export data as CSV file with Arabic support.
 * Uses UTF-8 BOM to ensure Excel opens the file with correct encoding.
 */
export function exportToCSV(options: ExportOptions) {
  const { columns, rows, totalsRow, filename, currency = "﷼" } = options;

  const formatCell = (val: string | number | null | undefined, col: ExportColumn): string => {
    if (val == null || val === "") return "";
    if (col.format === "money" && typeof val === "number") {
      return `${new Intl.NumberFormat("ar-YE", { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(val)} ${currency}`;
    }
    if (col.format === "number" && typeof val === "number") {
      return new Intl.NumberFormat("ar-YE").format(val);
    }
    // Escape double quotes for CSV
    return String(val).replace(/"/g, '""');
  };

  const csvLines: string[] = [];

  // Title row
  if (options.title) {
    csvLines.push(`"${options.title.replace(/"/g, '""')}"`);
    csvLines.push(""); // Empty line after title
  }

  // Header row
  csvLines.push(columns.map((c) => `"${c.header.replace(/"/g, '""')}"`).join(","));

  // Data rows
  for (const row of rows) {
    csvLines.push(columns.map((c) => `"${formatCell(row[c.key], c)}"`).join(","));
  }

  // Totals row
  if (totalsRow) {
    csvLines.push(""); // Empty separator
    csvLines.push(columns.map((c) => `"${formatCell(totalsRow[c.key], c)}"`).join(","));
  }

  // UTF-8 BOM + CSV content
  const BOM = "\uFEFF";
  const csvContent = BOM + csvLines.join("\r\n");
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });

  // Download
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `${filename}.csv`;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  setTimeout(() => {
    URL.revokeObjectURL(link.href);
    document.body.removeChild(link);
  }, 100);
}

/**
 * Export data as a formatted HTML table that opens in a new window.
 * This provides a richer Excel-compatible export when pasted or opened in Excel.
 * The user can also print directly from this view.
 */
export function exportToHTMLTable(options: ExportOptions) {
  const { columns, rows, totalsRow, title, currency = "﷼" } = options;
  const rtl = options.rtl ?? true;

  const formatCell = (val: string | number | null | undefined, col: ExportColumn): string => {
    if (val == null || val === "") return "";
    if (col.format === "money" && typeof val === "number") {
      return `${new Intl.NumberFormat("ar-YE", { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(val)} ${currency}`;
    }
    if (col.format === "number" && typeof val === "number") {
      return new Intl.NumberFormat("ar-YE").format(val);
    }
    return String(val);
  };

  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  const headerCells = columns.map((c) => `<th>${esc(c.header)}</th>`).join("");
  const bodyRows = rows
    .map(
      (row) =>
        `<tr>${columns.map((c) => `<td>${esc(formatCell(row[c.key], c))}</td>`).join("")}</tr>`,
    )
    .join("");
  const totalsHtml = totalsRow
    ? `<tr class="total">${columns.map((c) => `<td>${esc(formatCell(totalsRow[c.key], c))}</td>`).join("")}</tr>`
    : "";

  const html = `<!doctype html><html dir="${rtl ? "rtl" : "ltr"}" lang="${rtl ? "ar" : "en"}"><head><meta charset="utf-8">
<title>${esc(title ?? options.filename)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: 'Segoe UI', Tahoma, Arial, sans-serif; font-size: 13px; padding: 20px; background: #f5f5f5; }
  h1 { font-size: 20px; margin-bottom: 12px; }
  table { width: 100%; border-collapse: collapse; background: #fff; box-shadow: 0 2px 8px rgba(0,0,0,.1); }
  th { background: #1a1a2e; color: #fff; padding: 10px 12px; font-size: 12px; white-space: nowrap; }
  td { padding: 8px 12px; border-bottom: 1px solid #eee; }
  tr:nth-child(even) { background: #fafafa; }
  .total td { background: #1a1a2e; color: #fff; font-weight: 700; }
  .actions { margin-bottom: 12px; }
  .actions button { padding: 8px 16px; margin: 0 4px; border: none; border-radius: 4px; cursor: pointer; font-size: 13px; }
  .btn-print { background: #b8935a; color: #fff; }
  .btn-copy { background: #333; color: #fff; }
</style></head><body>
<div class="actions">
  <button class="btn-print" onclick="window.print()">🖨️ ${rtl ? "طباعة" : "Print"}</button>
  <button class="btn-copy" onclick="copyTable()">📋 ${rtl ? "نسخ الجدول" : "Copy Table"}</button>
</div>
${title ? `<h1>${esc(title)}</h1>` : ""}
<table id="export-table">
  <thead><tr>${headerCells}</tr></thead>
  <tbody>${bodyRows}${totalsHtml}</tbody>
</table>
<script>
function copyTable() {
  const table = document.getElementById('export-table');
  const range = document.createRange();
  range.selectNode(table);
  window.getSelection().removeAllRanges();
  window.getSelection().addRange(range);
  document.execCommand('copy');
  window.getSelection().removeAllRanges();
  alert('${rtl ? "تم نسخ الجدول!" : "Table copied!"}');
}
</script>
</body></html>`;

  const w = window.open("", "_blank", "width=1000,height=700");
  if (w) {
    w.document.open();
    w.document.write(html);
    w.document.close();
  }
}

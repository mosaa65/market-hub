/**
 * Generic A4 report print document.
 *
 * Reusable for any report screen (Top products, Sales, Payment mix, Low
 * stock, …). It only renders what it is given — it never queries data and
 * never recalculates figures; the caller passes already-computed rows.
 *
 * Design rules enforced here:
 *  - A4 with real print margins (not preview-only padding).
 *  - RTL for Arabic, LTR for English.
 *  - Light, paper-appropriate colours regardless of the app's dark mode,
 *    because the printed page must stay readable on white paper.
 *  - Numeric cells are LTR-isolated so signs/separators never mirror.
 *  - `tr` and section blocks avoid breaking across pages, and the table
 *    header repeats on every printed page.
 */

import { openPrintWindow } from "./print-window";
import { renderUniversalFooter, UNIVERSAL_FOOTER_CSS } from "@/lib/printing/footer";
import { getCachedCompanyProfile } from "@/lib/printing/company-profile";

export interface PrintTableColumn {
  /** Machine key, used only to look values up in the row object. */
  key: string;
  /** Human label, already translated. */
  label: string;
  align?: "start" | "center" | "end";
  numeric?: boolean;
}

export type PrintRow = Record<string, string | number | null | undefined>;

export interface PrintSection {
  title: string;
  /** Optional one-line note under the section title. */
  note?: string;
  columns: PrintTableColumn[];
  rows: PrintRow[];
  totals?: PrintRow;
  emptyLabel: string;
  /** Label placed in the leading (span) cell of the totals row. */
  totalsLabel?: string;
  /** Leading cells the totals row spans before the numeric columns. */
  totalsSpan?: number;
}

export interface PrintKpi {
  label: string;
  value: string;
  tone?: "pos" | "neg";
}

export interface ReportPrintOptions {
  lang: "ar" | "en";
  title: string;
  subtitle?: string;
  /** Pre-formatted period label. */
  period?: string;
  generatedAt?: string;
  systemName?: string;
  companyName?: string;
  kpis?: PrintKpi[];
  sections: PrintSection[];
  footerNote?: string;
}

function esc(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** U+061C reverses the minus sign of negative Arabic-formatted numbers. */
export function stripArabicLetterMark(value: unknown): string {
  return String(value ?? "").replace(/\u061C/g, "");
}

function alignStyle(align: PrintTableColumn["align"], lang: "ar" | "en"): string {
  if (align === "center") return "text-align:center";
  if (align === "end") return `text-align:${lang === "ar" ? "left" : "right"}`;
  return `text-align:${lang === "ar" ? "right" : "left"}`;
}

function cellValue(row: PrintRow, key: string): string {
  const v = row[key];
  if (v === null || v === undefined || v === "") return "—";
  // Arabic locales prefix negatives with U+061C (Arabic Letter Mark), a strong
  // RTL character that drags the minus sign to the wrong end of an LTR cell.
  // Stripping it keeps "-450.50" reading left-to-right on paper.
  return String(v).replace(/\u061C/g, "");
}

function cell(row: PrintRow, col: PrintTableColumn, lang: "ar" | "en"): string {
  const style = alignStyle(col.align, lang);
  if (col.numeric) {
    return `<td class="num" style="${style}" dir="ltr">${esc(cellValue(row, col.key))}</td>`;
  }
  return `<td style="${style}">${esc(cellValue(row, col.key))}</td>`;
}

export function reportPrintStyles(lang: "ar" | "en"): string {
  return `
@page { size: A4 portrait; margin: 14mm 12mm 16mm; }
* { box-sizing: border-box; }
:root {
  --ink:#111827; --gold:#b8935a; --line:#d8d4c9; --muted:#5f5b52;
  --surface:#f6f4ee; --pos:#047857; --neg:#b91c1c;
}
html, body {
  margin:0; padding:0; background:#fff; color:var(--ink);
  font-family:'Cairo','Segoe UI',Tahoma,sans-serif; font-size:11px; line-height:1.5;
  -webkit-print-color-adjust:exact; print-color-adjust:exact;
}
.page { width:100%; max-width:186mm; margin:0 auto; padding:0; }

/* Header — once per document, never repeated inside the body */
.rpt-head { display:flex; justify-content:space-between; align-items:flex-start; gap:16px;
  padding-bottom:9px; border-bottom:2px solid var(--ink); }
.rpt-head .who .sys { font-weight:800; font-size:13px; }
.rpt-head .who .co { font-size:10px; color:var(--muted); }
.rpt-head .meta { text-align:${lang === "ar" ? "left" : "right"}; font-size:10px; color:var(--muted); }
.rpt-head .meta h2 { margin:0; font-size:17px; color:var(--gold); }
.rpt-head .meta .period { display:inline-block; margin-top:3px; padding:2px 8px;
  border:1px solid var(--line); background:var(--surface); border-radius:5px;
  font-family:'IBM Plex Mono',monospace; direction:ltr; unicode-bidi:isolate; }
.rpt-head .meta .stamp { margin-top:3px; font-size:9.5px; }

h3.sec { margin:14px 0 5px; font-size:12.5px; color:var(--gold); }
p.note { margin:0 0 6px; font-size:9.5px; color:var(--muted); }

.kpis { display:flex; flex-wrap:wrap; gap:7px; margin:12px 0 4px; }
.kpi { flex:1 1 130px; min-width:120px; border:1px solid var(--line); border-radius:6px;
  background:#fff; padding:6px 9px; page-break-inside:avoid; break-inside:avoid; }
.kpi .k { font-size:9px; color:var(--muted); }
.kpi .v { font-family:'IBM Plex Mono',monospace; font-size:12.5px; font-weight:700; margin-top:2px;
  direction:ltr; unicode-bidi:isolate; text-align:${lang === "ar" ? "left" : "right"}; }
.kpi .v.pos { color:var(--pos); }
.kpi .v.neg { color:var(--neg); }

section { page-break-inside:auto; }
table { width:100%; border-collapse:collapse; margin-bottom:6px; }
thead { display:table-header-group; }
tfoot { display:table-footer-group; }
tr { page-break-inside:avoid; break-inside:avoid; }
th { background:var(--ink); color:#fff; padding:6px 7px; font-size:10px; font-weight:700;
  text-align:${lang === "ar" ? "right" : "left"}; white-space:nowrap; }
td { padding:5px 7px; border-bottom:1px solid var(--line); font-size:10.5px; vertical-align:top; }
td.num { font-family:'IBM Plex Mono',monospace; white-space:nowrap; }
tbody tr:nth-child(even) td { background:rgba(246,244,238,.6); }
tr.totals td { background:var(--ink); color:#fff; font-weight:700; }
tr.totals td.num { color:#fff; }
td.empty { text-align:center; padding:16px; color:var(--muted); }

.rpt-foot { margin-top:14px; padding-top:8px; border-top:1px solid var(--line);
  display:flex; justify-content:space-between; gap:14px; font-size:9px; color:var(--muted); }
.rpt-foot .sys { font-weight:700; color:var(--ink); }

/* Screen preview mirrors paper without depending on the app's theme */
@media screen {
  body { background:#e9e5dc; padding:16px 0; }
  .page { background:#fff; padding:14mm 12mm; box-shadow:0 10px 40px rgba(0,0,0,.18); }
}
`;
}

export function buildReportHtml(options: ReportPrintOptions): string {
  const { lang, title, subtitle, period, generatedAt, kpis, sections, footerNote } = options;
  const company = getCachedCompanyProfile();
  // Company Profile is the single source of company identity — the report never
  // invents a name of its own.
  const systemName = options.systemName ?? company.name;
  const rtl = lang === "ar";

  const kpiHtml =
    kpis && kpis.length
      ? `<div class="kpis">${kpis
          .map(
            (k) =>
              `<div class="kpi"><div class="k">${esc(k.label)}</div><div class="v ${
                k.tone ?? ""
              }">${esc(k.value)}</div></div>`,
          )
          .join("")}</div>`
      : "";

  const sectionHtml = sections
    .map((s) => {
      const head = s.columns
        .map((c) => `<th style="${alignStyle(c.align, lang)}">${esc(c.label)}</th>`)
        .join("");
      const body = s.rows.length
        ? s.rows.map((r) => `<tr>${s.columns.map((c) => cell(r, c, lang)).join("")}</tr>`).join("")
        : `<tr><td class="empty" colspan="${s.columns.length}">${esc(s.emptyLabel)}</td></tr>`;
      const span = s.totalsSpan ?? Math.max(0, s.columns.length - 1);
      const totals = s.totals
        ? `<tfoot><tr class="totals"><td colspan="${span}" style="${alignStyle(
            "start",
            lang,
          )}">${esc(s.totalsLabel ?? "")}</td>${s.columns
            .slice(span)
            .map((c) => {
              const raw = (s.totals ?? {})[c.key];
              const text =
                raw === null || raw === undefined || raw === ""
                  ? ""
                  : String(raw).replace(/\u061C/g, "");
              return c.numeric
                ? `<td class="num" style="${alignStyle(c.align, lang)}" dir="ltr">${esc(text)}</td>`
                : `<td style="${alignStyle(c.align, lang)}">${esc(text)}</td>`;
            })
            .join("")}</tr></tfoot>`
        : "";
      return `<section>
        <h3 class="sec">${esc(s.title)}</h3>
        ${s.note ? `<p class="note">${esc(s.note)}</p>` : ""}
        <table><thead><tr>${head}</tr></thead><tbody>${body}</tbody>${totals}</table>
      </section>`;
    })
    .join("");

  return `<!doctype html><html dir="${lang === "ar" ? "rtl" : "ltr"}" lang="${lang}">
<head><meta charset="utf-8">
<title>${esc(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700&family=IBM+Plex+Mono:wght@400;700&display=swap" rel="stylesheet">
<style>${reportPrintStyles(lang)}${UNIVERSAL_FOOTER_CSS}</style>
</head>
<body><div class="page">
  <div class="rpt-head">
    <div class="who">
      <div class="sys">${esc(systemName)}</div>
      ${options.companyName ? `<div class="co">${esc(options.companyName)}</div>` : ""}
      ${subtitle ? `<div class="co">${esc(subtitle)}</div>` : ""}
    </div>
    <div class="meta">
      <h2>${esc(title)}</h2>
      ${period ? `<div class="period">${esc(period)}</div>` : ""}
      ${generatedAt ? `<div class="stamp">${esc(generatedAt)}</div>` : ""}
    </div>
  </div>
  ${kpiHtml}
  ${sectionHtml}
  <div class="rpt-foot">
    <div>${esc(footerNote ?? "")}</div>
    <div class="sys">${esc(systemName)}</div>
  </div>
  ${renderUniversalFooter(company, rtl, true)}
</div></body></html>`;
}

export function printReportDocument(options: ReportPrintOptions): void {
  openPrintWindow(buildReportHtml(options));
}

/**
 * Statement Print Template — الأجزاء الختامية (ديون · توقيعات · تذييل) + نقطة الدخول
 *
 * ⚠️ لا يحسب أي رقم. يستهلك StatementResult + StatementLayout فقط.
 */

import type {
  StatementCompanyInfo,
  StatementPrintOptions,
  DebtsSummaryRow,
} from "./print-sections";
import {
  alignStyle,
  renderEntityAndSummary,
  renderHeader,
  renderIntegrityWarning,
  renderLegacyStatementTable,
  renderTransactionsTable,
} from "./print-sections";
import { statementPrintStyles } from "./print-styles";
import { esc, fmtAmount, fmtDate } from "./format";
import { STATEMENT_COMPANY } from "./company";

export type { StatementPrintOptions, DebtsSummaryRow, StatementCompanyInfo };

// ---------------------------------------------------------------------------
// Debts summary table (كشف الديون)
// ---------------------------------------------------------------------------

function ageChip(days: number | null | undefined, lang: "ar" | "en"): string {
  if (days === null || days === undefined) return "—";
  const cls = days <= 30 ? "age-ok" : days <= 90 ? "age-warn" : "age-bad";
  const text = lang === "ar" ? `${days} يوم` : `${days}d`;
  return `<span class="age-chip ${cls}">${esc(text)}</span>`;
}

function renderDebtsTable(
  rows: DebtsSummaryRow[],
  lang: "ar" | "en",
  currencySymbol: string,
): string {
  const ar = lang === "ar";
  const headers: { label: string; align: "start" | "center" | "end" }[] = [
    { label: "#", align: "center" },
    { label: ar ? "الجهة" : "Party", align: "start" },
    { label: ar ? "الهاتف" : "Phone", align: "start" },
    { label: ar ? "إجمالي المديونية" : "Total debt", align: "end" },
    { label: ar ? "المدفوع" : "Paid", align: "end" },
    { label: ar ? "المتبقي" : "Remaining", align: "end" },
    { label: ar ? "آخر حركة" : "Last movement", align: "start" },
    { label: ar ? "عمر الدين" : "Age", align: "center" },
  ];

  const head = headers.map((h) => `<th${alignStyle(h.align, lang)}>${esc(h.label)}</th>`).join("");

  const body = rows
    .map(
      (r, i) => `<tr>
        <td class="num"${alignStyle("center", lang)}>${i + 1}</td>
        <td${alignStyle("start", lang)}>${esc(r.party)}</td>
        <td class="num"${alignStyle("start", lang)}>${esc(r.phone ?? "—")}</td>
        <td class="num"${alignStyle("end", lang)}>${fmtAmount(r.total)}</td>
        <td class="num credit"${alignStyle("end", lang)}>${fmtAmount(r.paid)}</td>
        <td class="num balance"${alignStyle("end", lang)}>${fmtAmount(r.remaining)}</td>
        <td class="num"${alignStyle("start", lang)}>${esc(
          r.lastMovement ? fmtDate(r.lastMovement, lang) : "—",
        )}</td>
        <td${alignStyle("center", lang)}>${ageChip(r.ageDays, lang)}</td>
      </tr>`,
    )
    .join("");

  const totals = rows.reduce(
    (acc, r) => ({
      total: acc.total + r.total,
      paid: acc.paid + r.paid,
      remaining: acc.remaining + r.remaining,
    }),
    { total: 0, paid: 0, remaining: 0 },
  );

  const totalsRow = rows.length
    ? `<tr class="totals">
        <td colspan="3"${alignStyle("start", lang)}>${ar ? "الإجمالي" : "Total"}</td>
        <td class="num"${alignStyle("end", lang)}>${fmtAmount(totals.total)}</td>
        <td class="num"${alignStyle("end", lang)}>${fmtAmount(totals.paid)}</td>
        <td class="num"${alignStyle("end", lang)}>${fmtAmount(totals.remaining)}</td>
        <td></td><td></td>
      </tr>`
    : "";

  return `<table>
    <thead><tr>${head}</tr></thead>
    <tbody>
      ${body || `<tr><td class="empty" colspan="8">${ar ? "لا توجد مديونيات مستحقة" : "No outstanding debts"}</td></tr>`}
      ${totalsRow}
    </tbody>
  </table>
  <div style="margin-top:6px;font-size:9.5px;color:var(--muted)">
    ${ar ? "العملة" : "Currency"}: ${esc(currencySymbol)}
  </div>`;
}

// ---------------------------------------------------------------------------
// Signatures + Footer
// ---------------------------------------------------------------------------

function renderSignatures(lang: "ar" | "en"): string {
  const ar = lang === "ar";
  const labels = ar
    ? ["المراجع والمدقق", "المحاسب المسؤول", "المدير العام"]
    : ["Auditor", "Accountant", "General Manager"];
  return `
  <div class="sigs">
    ${labels
      .map(
        (label) =>
          `<div class="sig"><div class="pad"></div><div class="line">${esc(label)}</div></div>`,
      )
      .join("")}
  </div>`;
}

/**
 * التذييل: نص التذييل + هوية Inama Soft (الشعار · الاسم · الهاتف · الموقع).
 * قرار المستخدم #6: نستخدم /inama-soft-logo.ico الموجود.
 */
function renderFooter(
  layout: StatementPrintOptions["layout"],
  company: StatementCompanyInfo,
  lang: "ar" | "en",
  extraFooter?: string,
): string {
  const ar = lang === "ar";
  const brandBlock = layout.showBrandFooter
    ? `<div class="brand">
        <div class="brand-txt" style="text-align:${ar ? "right" : "left"};">
          <b>${esc(company.brand.name)}</b>
          <div>Mousa Gamil Al-Awadhi - Ibb, Yemen</div>
          <div dir="ltr">${esc(company.brand.website)} &nbsp; ${esc(company.brand.phone)}</div>
        </div>
        <img src="${esc(company.brand.logoUrl)}" alt="${esc(company.brand.name)}" />
      </div>`
    : `<div class="pagenum">${esc(company.brand.softwareName)}</div>`;

  return `
  <div class="rpt-foot">
    <div>
      ${
        layout.footerNote &&
        !layout.footerNote.includes("الطباعة") &&
        !layout.footerNote.includes("print dialog")
          ? `<div>${esc(layout.footerNote)}</div>`
          : ""
      }
      ${extraFooter ? `<div>${esc(extraFooter)}</div>` : ""}
      <div style="font-weight:600;margin-top:2px;">Market Hub · ${esc(company.brand.name)}</div>
    </div>
    ${brandBlock}
  </div>`;
}

// ---------------------------------------------------------------------------
// Main builder
// ---------------------------------------------------------------------------

export function buildStatementHtml(options: StatementPrintOptions): string {
  const {
    result,
    layout,
    lang,
    currencySymbol,
    includeOpeningRow = true,
    titleOverride,
    debtsSummary,
    extraFooter,
  } = options;

  const company = options.company ?? STATEMENT_COMPANY;
  const title = titleOverride?.trim() || layout.title;
  const isDebtsMode = Array.isArray(debtsSummary);

  const body = isDebtsMode
    ? renderDebtsTable(debtsSummary as DebtsSummaryRow[], lang, currencySymbol)
    : renderLegacyStatementTable(result, lang, currencySymbol, includeOpeningRow);

  return `<!doctype html><html dir="${lang === "ar" ? "rtl" : "ltr"}" lang="${lang}">
<head><meta charset="utf-8">
<title>${esc(title)}${result.entity ? ` — ${esc(result.entity.name)}` : ""}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800&family=Amiri:wght@400;700&family=IBM+Plex+Mono:wght@400;600&display=swap" rel="stylesheet">
<style>${statementPrintStyles(lang)}</style>
</head>
<body>
<div class="page">
  ${renderHeader(layout, company, title, result.period.label, result.generatedAt, lang)}
  ${isDebtsMode ? "" : renderIntegrityWarning(result, lang)}
  ${body}
  ${
    layout.showNotes
      ? `<div class="notes"><b>${lang === "ar" ? "ملاحظات" : "Notes"}:</b> ${esc(
          layout.notesText ||
            ".....................................................................................................",
        )}</div>`
      : ""
  }
  ${layout.showSignatures ? renderSignatures(lang) : ""}
  ${renderFooter(layout, company, lang, extraFooter)}
</div></body></html>`;
}

// ---------------------------------------------------------------------------
// Window management — نفس منطق fallback الموجود في pdf.ts (iframe عند الحجب)
// ---------------------------------------------------------------------------

export function openStatementPrintWindow(html: string): void {
  if (typeof window === "undefined") return;

  // الطباعة داخل إطار مخفي تمنع فتح نافذة about:blank إضافية،
  // وتُظهر نافذة الطباعة مباشرة من زر المستخدم.
  const iframe = document.createElement("iframe");
  iframe.setAttribute("title", "print");
  iframe.style.cssText =
    "position:fixed;inset:0;width:1px;height:1px;border:0;opacity:0;pointer-events:none";
  document.body.appendChild(iframe);
  const cw = iframe.contentWindow;
  if (!cw) {
    iframe.remove();
    return;
  }
  iframe.onload = () => {
    cw.focus();
    cw.print();
    window.setTimeout(() => iframe.remove(), 1000);
  };
  cw.document.open();
  cw.document.write(html);
  cw.document.close();
}

/** بناء وطباعة الكشف في خطوة واحدة */
export function printStatementDocument(options: StatementPrintOptions): void {
  openStatementPrintWindow(buildStatementHtml(options));
}

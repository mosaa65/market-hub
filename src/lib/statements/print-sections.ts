/**
 * Statement Print Template — قالب طباعة مستقل للكشوف
 *
 * قرار المستخدم #5: قالب جديد مستقل (لا توسيع printReport).
 * السبب: الكشوف تحتاج سطر الرصيد الافتتاحي، ملخصًا رباعيًا، دلالة الرصيد
 * حسب نوع الجهة، وتذييل هوية Inama Soft — وكلها لا تناسب printReport العام.
 *
 * ⚠️ لا يحسب أي رقم. يستهلك StatementResult + StatementLayout فقط.
 * ⚠️ صفر تغيير في قاعدة البيانات.
 */

import type { StatementCompanyInfo } from "./company";
import { STATEMENT_COMPANY } from "./company";
import { directionLabel, esc, fmtAmount, fmtDate, fmtMoney, fmtOrDash } from "./format";
import { kindLabel } from "./engine";
import { statementPrintStyles } from "./print-styles";
import type { StatementLayout, StatementResult } from "./types";

export type { StatementCompanyInfo };

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface DebtsSummaryRow {
  /** اسم الجهة */
  party: string;
  phone?: string | null;
  /** إجمالي المديونية */
  total: number;
  /** المدفوع */
  paid: number;
  /** المتبقي */
  remaining: number;
  /** تاريخ آخر حركة */
  lastMovement?: string | null;
  /** عمر الدين بالأيام */
  ageDays?: number | null;
}

export interface StatementPrintOptions {
  result: StatementResult;
  layout: StatementLayout;
  lang: "ar" | "en";
  /** رمز العملة — يُمرَّر صريحًا لتجنب كاش localStorage في نافذة جديدة */
  currencySymbol: string;
  company?: StatementCompanyInfo;
  /** إظهار رصيد افتتاحي كسطر أول */
  includeOpeningRow?: boolean;
  /** عنوان مخصص يُطغى على عنوان القالب */
  titleOverride?: string;
  /** كشف الديون: جدول مجمّع بدل حركات */
  debtsSummary?: DebtsSummaryRow[];
  /** نص إضافي في التذييل */
  extraFooter?: string;
}

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------

function renderHeader(
  layout: StatementLayout,
  company: StatementCompanyInfo,
  title: string,
  periodLabel: string,
  generatedAt: string,
  lang: "ar" | "en",
): string {
  const ar = lang === "ar";
  const logoBlock = layout.header.showLogo
    ? company.logoUrl
      ? `<img class="co-logo" src="${esc(company.logoUrl)}" alt="${esc(company.name)}" />`
      : `<div class="co-logo-fallback">${esc((company.name || "-").trim().charAt(0))}</div>`
    : "";

  const lines: string[] = [];
  if (layout.header.showAddress && company.address) lines.push(esc(company.address));
  if (layout.header.showPhone && company.phone) {
    lines.push(`${ar ? "هاتف" : "Tel"}: <span dir="ltr">${esc(company.phone)}</span>`);
  }
  if (layout.header.showTaxNumber && company.taxNumber) {
    lines.push(
      `${ar ? "الرقم الضريبي" : "Tax No"}: <span dir="ltr">${esc(company.taxNumber)}</span>`,
    );
  }
  if (layout.header.customLine) lines.push(esc(layout.header.customLine));

  return `
  <div class="rpt-head">
    <div class="co">
      ${logoBlock}
      <div>
        <h1 class="co-name">${esc(company.name)}</h1>
        ${
          layout.header.showLegalName && company.legalName
            ? `<div class="co-legal">${esc(company.legalName)}</div>`
            : ""
        }
        ${lines.length ? `<div class="co-lines">${lines.join(" · ")}</div>` : ""}
      </div>
    </div>
    <div class="rpt-title">
      <h2>${esc(title)}</h2>
      <div class="sub">${esc(layout.subtitle)}</div>
      <div class="period">${esc(periodLabel)}</div>
      <div class="stamp">${ar ? "تاريخ الإصدار" : "Issued"}: ${esc(fmtDate(generatedAt, lang))}</div>
    </div>
  </div>`;
}

// ---------------------------------------------------------------------------
// Entity + Summary
// ---------------------------------------------------------------------------

function renderEntityAndSummary(
  result: StatementResult,
  currencySymbol: string,
  lang: "ar" | "en",
): string {
  const ar = lang === "ar";
  const entity = result.entity;
  if (!entity) return "";

  const rows: { k: string; v: string }[] = [{ k: ar ? "الاسم" : "Name", v: entity.name }];
  if (entity.phone) rows.push({ k: ar ? "الهاتف" : "Phone", v: entity.phone });
  if (entity.email) rows.push({ k: ar ? "البريد" : "Email", v: entity.email });
  if (entity.address) rows.push({ k: ar ? "العنوان" : "Address", v: entity.address });
  if (entity.creditLimit !== null && entity.creditLimit > 0) {
    rows.push({
      k: ar ? "الحد الائتماني" : "Credit limit",
      v: fmtMoney(entity.creditLimit, currencySymbol),
    });
  }
  rows.push({
    k: ar ? "نوع الحساب" : "Account type",
    v:
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
            : "Customer",
  });

  return `
  <div class="meta-grid">
    <div class="box">
      <div class="box-h">${ar ? "بيانات الحساب" : "Account Details"}</div>
      <div class="box-b">
        ${rows
          .map(
            (r) =>
              `<div class="kv"><span class="k">${esc(r.k)}</span><span class="v">${esc(r.v)}</span></div>`,
          )
          .join("")}
      </div>
    </div>
    <div class="box">
      <div class="box-h">${ar ? "ملخص الفترة" : "Period Summary"}</div>
      <div class="sum-grid">
        <div class="sum">
          <div class="sk">${ar ? "الرصيد الافتتاحي" : "Opening balance"}</div>
          <div class="sv">${fmtAmount(result.openingBalance)}</div>
        </div>
        <div class="sum">
          <div class="sk">${ar ? "عدد الحركات" : "Entries"}</div>
          <div class="sv">${result.countedRows}</div>
        </div>
        <div class="sum">
          <div class="sk">${ar ? "إجمالي المدين" : "Total debit"}</div>
          <div class="sv debit">${fmtAmount(result.totalDebit)}</div>
        </div>
        <div class="sum">
          <div class="sk">${ar ? "إجمالي الدائن" : "Total credit"}</div>
          <div class="sv credit">${fmtAmount(result.totalCredit)}</div>
        </div>
        <div class="sum sum-final">
          <div class="sk">${ar ? "الرصيد الختامي" : "Closing balance"}</div>
          <div class="sv">${fmtMoney(result.closingBalance, currencySymbol)}</div>
          <div class="dir">${esc(directionLabel(result.direction, result.entityType, lang))}</div>
        </div>
      </div>
    </div>
  </div>`;
}

// ---------------------------------------------------------------------------
// Integrity warning — قرار المستخدم #1: شارة تحذير واضحة
// ---------------------------------------------------------------------------

function renderIntegrityWarning(result: StatementResult, lang: "ar" | "en"): string {
  if (!result.integrity.hasGap) return "";
  const ar = lang === "ar";
  const diff = fmtAmount(Math.abs(result.integrity.difference ?? 0));
  const ledger = fmtAmount(result.integrity.ledgerBalance);
  const cached = fmtAmount(result.integrity.cachedBalance ?? 0);

  return `
  <div class="warn">
    <span>&#9888;</span>
    <div>
      <b>${
        ar
          ? "تنبيه تسوية: يوجد فرق بين رصيد الدفتر والرصيد المخزَّن"
          : "Reconciliation warning: ledger and cached balance differ"
      }</b>
      ${
        ar
          ? `رصيد الدفتر المُحتسب <span dir="ltr">${ledger}</span> مقابل الرصيد المخزَّن <span dir="ltr">${cached}</span> — الفرق <span dir="ltr">${diff}</span>. السبب المرجّح: مرتجعات أو تسويات لم تُقيَّد في دفتر العميل. يُنصح بمراجعة تقرير المطابقة قبل الاعتماد على الرصيد المخزَّن.`
          : `Ledger ${ledger} vs cached ${cached} — difference ${diff}. Likely unposted returns or adjustments.`
      }
    </div>
  </div>`;
}

// ---------------------------------------------------------------------------
// Transactions table
// ---------------------------------------------------------------------------

function alignStyle(align: "start" | "center" | "end", lang: "ar" | "en"): string {
  // في RTL قيمة "end" تعني بصريًا اليسار — نستخدم text-align صريحًا
  if (align === "center") return ' style="text-align:center"';
  if (align === "end") return ` style="text-align:${lang === "ar" ? "left" : "right"}"`;
  return ` style="text-align:${lang === "ar" ? "right" : "left"}"`;
}

function cellClass(key: string): string {
  switch (key) {
    case "debit":
      return "num debit";
    case "credit":
      return "num credit";
    case "balance":
      return "num balance";
    case "index":
    case "date":
    case "reference":
      return "num";
    default:
      return "";
  }
}

function cellText(
  column: { key: string },
  row: StatementResult["transactions"][number],
  entityType: StatementResult["entityType"],
  lang: "ar" | "en",
): string {
  switch (column.key) {
    case "index":
      return String(row.index);
    case "date":
      return fmtDate(row.occurredAt, lang);
    case "reference":
      return row.reference ?? "—";
    case "kind":
      return kindLabel(row.kind, entityType, lang);
    case "description":
      return row.description ?? "—";
    case "debit":
      return fmtOrDash(row.debit);
    case "credit":
      return fmtOrDash(row.credit);
    case "balance":
      return fmtAmount(row.runningBalance);
    case "paymentMethod":
      return String(row.meta?.paymentMethod ?? "—");
    default:
      return "—";
  }
}

function renderTransactionsTable(
  result: StatementResult,
  layout: StatementLayout,
  lang: "ar" | "en",
  includeOpeningRow: boolean,
): string {
  const ar = lang === "ar";
  const columns = layout.columns;

  const headCells = columns
    .map((c) => `<th${alignStyle(c.align, lang)}>${esc(c.label)}</th>`)
    .join("");

  const openingRow =
    includeOpeningRow && layout.showOpeningRow
      ? `<tr class="opening">${columns
          .map((c) => {
            let text = "—";
            if (c.key === "kind") text = kindLabel("opening", result.entityType, lang);
            else if (c.key === "description")
              text = ar ? "رصيد ما قبل بداية الفترة" : "Balance before period start";
            else if (c.key === "date")
              text = result.period.from ? fmtDate(`${result.period.from}T00:00:00Z`, lang) : "—";
            else if (c.key === "balance") text = fmtAmount(result.openingBalance);
            return `<td class="${cellClass(c.key)}"${alignStyle(c.align, lang)}>${esc(text)}</td>`;
          })
          .join("")}</tr>`
      : "";

  const bodyRows = result.transactions
    .map(
      (row) =>
        `<tr>${columns
          .map(
            (c) =>
              `<td class="${cellClass(c.key)}"${alignStyle(c.align, lang)}>${esc(
                cellText(c, row, result.entityType, lang),
              )}</td>`,
          )
          .join("")}</tr>`,
    )
    .join("");

  const empty = result.transactions.length
    ? ""
    : `<tr><td class="empty" colspan="${columns.length}">${
        ar
          ? "لا توجد حركات مسجَّلة خلال الفترة المحددة"
          : "No movements recorded in the selected period"
      }</td></tr>`;

  const totalsRow = layout.showTotalsRow
    ? `<tr class="totals">${columns
        .map((c) => {
          const style = alignStyle(c.align, lang);
          switch (c.key) {
            case "kind":
              return `<td${style}>${ar ? "الإجمالي" : "Total"}</td>`;
            case "debit":
              return `<td class="num debit"${style}>${fmtAmount(result.totalDebit)}</td>`;
            case "credit":
              return `<td class="num credit"${style}>${fmtAmount(result.totalCredit)}</td>`;
            case "balance":
              return `<td class="num balance"${style}>${fmtAmount(result.closingBalance)}</td>`;
            default:
              return `<td${style}></td>`;
          }
        })
        .join("")}</tr>`
    : "";

  return `<table><thead><tr>${headCells}</tr></thead><tbody>${openingRow}${bodyRows}${totalsRow}</tbody></table>`;
}

export {
  renderHeader,
  renderEntityAndSummary,
  renderIntegrityWarning,
  renderTransactionsTable,
  alignStyle,
};

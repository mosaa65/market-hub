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
  <div class="rpt-head legacy-head">
    <div class="legacy-brand">
      ${logoBlock}
      <div class="legacy-brand-name">${esc(company.brand.name)}</div>
    </div>
    <div class="rpt-title legacy-title">
      <h2>${esc(title || (ar ? "كشف حساب" : "Account Statement"))}</h2>
      <div class="sub">${esc(layout.subtitle)}</div>
      <div class="period">${esc(periodLabel)}</div>
    </div>
    <div class="legacy-branch">
      <b>${ar ? "الفرع الرئيسي" : "Main Branch"}</b>
      ${company.name ? `<span>${esc(company.name)}</span>` : ""}
      ${layout.header.showPhone && company.phone ? `<span dir="ltr">${esc(company.phone)}</span>` : ""}
      <small>${ar ? "تاريخ الإصدار" : "Issued"}: ${esc(fmtDate(generatedAt, lang))}</small>
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

function renderLegacyStatementTable(
  result: StatementResult,
  lang: "ar" | "en",
  currencySymbol: string,
  includeOpeningRow: boolean,
): string {
  const ar = lang === "ar";
  const headers = ar
    ? ["#", "البيان", "نوع المستند", "تاريخ المستند", "مدين", "دائن", "رصيد مدين", "رصيد دائن"]
    : [
        "#",
        "Description",
        "Document type",
        "Document date",
        "Debit",
        "Credit",
        "Debit balance",
        "Credit balance",
      ];
  const header = headers.map((h, i) => `<th class="legacy-col-${i}">${esc(h)}</th>`).join("");
  const rows: string[] = [];
  let currentMonth = "";
  let monthDebit = 0;
  let monthCredit = 0;
  let monthLastBalance = 0;
  let index = 0;

  const monthLabel = (key: string) => {
    const [year, month] = key.split("-");
    return ar ? `إجمالي ${year}/${Number(month)}` : `Total ${year}/${Number(month)}`;
  };
  const flushMonth = () => {
    if (!currentMonth) return;
    rows.push(`<tr class="month-total">
      <td colspan="4">${esc(monthLabel(currentMonth))}</td>
      <td>${fmtAmount(monthDebit)}</td>
      <td>${fmtAmount(monthCredit)}</td>
      <td>${monthLastBalance >= 0 ? fmtAmount(monthLastBalance) : "0.00"}</td>
      <td>${monthLastBalance < 0 ? fmtAmount(Math.abs(monthLastBalance)) : "0.00"}</td>
    </tr>`);
    monthDebit = 0;
    monthCredit = 0;
  };
  const addRow = (
    description: string,
    kind: string,
    date: string,
    debit: number,
    credit: number,
    balance: number,
    rowClass = "",
  ) => {
    rows.push(`<tr class="${rowClass}">
      <td>${rowClass ? "" : ++index}</td>
      <td class="legacy-description">${esc(description)}</td>
      <td>${esc(kind)}</td>
      <td dir="ltr">${esc(date)}</td>
      <td class="debit">${debit ? fmtAmount(debit) : "0.00"}</td>
      <td class="credit">${credit ? fmtAmount(credit) : "0.00"}</td>
      <td class="balance-debit">${balance >= 0 ? fmtAmount(balance) : "0.00"}</td>
      <td class="balance-credit">${balance < 0 ? fmtAmount(Math.abs(balance)) : "0.00"}</td>
    </tr>`);
  };

  if (includeOpeningRow) {
    const openingDate = result.period.from ? fmtDate(`${result.period.from}T00:00:00Z`, lang) : "—";
    addRow(
      ar ? "رصيد أول المدة" : "Opening balance",
      kindLabel("opening", result.entityType, lang),
      openingDate,
      0,
      0,
      result.openingBalance,
      "opening",
    );
  }

  for (const row of result.transactions) {
    const month = row.occurredAt.slice(0, 7);
    if (currentMonth && month !== currentMonth) flushMonth();
    currentMonth = month;
    monthDebit += row.debit;
    monthCredit += row.credit;
    monthLastBalance = row.runningBalance;
    addRow(
      row.description || kindLabel(row.kind, result.entityType, lang),
      kindLabel(row.kind, result.entityType, lang),
      fmtDate(row.occurredAt, lang),
      row.debit,
      row.credit,
      row.runningBalance,
    );
  }
  flushMonth();

  if (!result.transactions.length) {
    rows.push(
      `<tr><td colspan="8" class="empty">${ar ? "لا توجد حركات خلال الفترة المحددة" : "No movements in the selected period"}</td></tr>`,
    );
  }

  rows.push(`<tr class="grand-total">
    <td colspan="4">${ar ? "الإجمالي النهائي" : "Grand total"}</td>
    <td>${fmtAmount(result.totalDebit)}</td>
    <td>${fmtAmount(result.totalCredit)}</td>
    <td>${result.closingBalance >= 0 ? fmtAmount(result.closingBalance) : "0.00"}</td>
    <td>${result.closingBalance < 0 ? fmtAmount(Math.abs(result.closingBalance)) : "0.00"}</td>
  </tr>`);

  return `<table class="legacy-statement-table"><thead><tr>${header}</tr></thead><tbody>${rows.join("")}</tbody></table>
  <div class="legacy-currency">${ar ? "العملة" : "Currency"}: ${esc(currencySymbol)}</div>`;
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
  renderLegacyStatementTable,
  renderTransactionsTable,
  alignStyle,
};

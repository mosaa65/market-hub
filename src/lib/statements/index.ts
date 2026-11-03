/**
 * Statement Engine — نقطة الدخول الموحّدة
 *
 * كل شاشة يجب أن تستورد من هنا فقط. لا تستورد engine أو adapters مباشرة
 * حتى تبقى نقطة واحدة يمكن تتبّعها واختبارها.
 */

export * from "./types";
export {
  buildStatement,
  balanceAsOf,
  buildAging,
  buildPeriodLabel,
  compareEntries,
  dayKey,
  entriesRange,
  kindLabel,
  round2,
  DECIMALS,
  EPSILON,
} from "./engine";
export type { AgingBuckets, AgingResult, AgingRow, BuildStatementOptions } from "./engine";

export { loadStatementSource, SUPPORTED_ENTITY_TYPES, UNSUPPORTED_ENTITY_TYPES } from "./adapters";
export type { LoadedStatement, StatementPartyOption } from "./adapters";
export { CASH_ENTITY_ID } from "./adapters/cash";
export { SUPPLIER_PAID_TAG_AR, SUPPLIER_PAID_TAG_EN } from "./adapters/supplier";

export {
  getStatementSettings,
  saveStatementSettings,
  resetStatementSettings,
  useStatementSettings,
  resolveFieldLabel,
  visibleFields,
  DEFAULT_STATEMENT_SETTINGS,
  DEFAULT_FIELD_LABELS,
} from "./settings";
export type { StatementSettings, StatementFieldSetting } from "./settings";

export {
  STATEMENT_TEMPLATES,
  TEMPLATE_ORDER,
  resolveStatementLayout,
  defaultTemplateFor,
  templateLabel,
  availableFieldsForTemplate,
} from "./templates";

export { loadDebtsOverview } from "./debts";
export type { DebtRow, DebtsOverview } from "./debts";

export {
  loadStatementCompany,
  resolveCurrencySymbol,
  INAMA_SOFT_BRAND,
  STATEMENT_COMPANY,
} from "./company";
export type { StatementCompanyInfo } from "./company";

export { buildStatementHtml, printStatementDocument, openStatementPrintWindow } from "./print";
export type { StatementPrintOptions, DebtsSummaryRow } from "./print";

export {
  exportStatementToCsv,
  exportStatementToHtmlTable,
  statementFilename,
  statementTextSummary,
} from "./export";
export type { StatementExportOptions } from "./export";

export {
  cellValue,
  directionLabel,
  directionTone,
  esc,
  fmtAmount,
  fmtDate,
  fmtDateTime,
  fmtMoney,
  fmtOrDash,
  paymentMethodLabel,
  rowCountLabel,
} from "./format";

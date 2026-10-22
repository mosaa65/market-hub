import { toSystemDigits } from "./format-preferences";
import { getCurrencySymbol } from "./currencies";
import {
  getCachedCompanyProfile,
  patchCompanyProfileCache,
  clearCompanyProfileCache,
  type CompanyProfile,
} from "./printing/company-profile";

/**
 * حقول العملة فقط — تُقرأ من Company Profile المركزي.
 * لم يعد هذا الملف يقرأ `localStorage` بنفسه: القراءة المباشرة للكاش
 * ممنوعة، والمصدر الوحيد هو `printing/company-profile.ts`.
 */
type CompanyCurrency = Pick<CompanyProfile, "currency">;

function readCompanyCurrency(): CompanyCurrency {
  return { currency: getCachedCompanyProfile().currency };
}

/** يُبقي الكاش متزامنًا مع Company Profile — من نفس الـ accessor المركزي. */
export function setCompanySettingsCache(settings: CompanyCurrency | null | undefined) {
  if (!settings) {
    clearCompanyProfileCache();
    return;
  }
  patchCompanyProfileCache({ currency: settings.currency });
}

export function getCompanyCurrencySymbol(): string {
  const settings = readCompanyCurrency();
  const locale = typeof navigator !== "undefined" ? navigator.language : "ar-YE";
  return getCurrencySymbol(settings.currency || "YER", locale);
}

export function money(n: number, currency?: string, locale?: string) {
  const settings = readCompanyCurrency();
  const currencyCode = currency || settings.currency || "YER";
  const resolvedLocale =
    locale || (typeof navigator !== "undefined" ? navigator.language : "ar-YE");
  const symbol = getCurrencySymbol(currencyCode, resolvedLocale);

  const base = new Intl.NumberFormat(resolvedLocale, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(n);
  return toSystemDigits(`${base} ${symbol}`);
}

export function num(n: number, locale = "en-US") {
  return toSystemDigits(new Intl.NumberFormat(locale).format(n));
}

/**
 * Money for dense table cells: always grouped with thousands separators, always
 * two decimals, no currency symbol (the column header carries the unit).
 *
 * IMPORTANT: this is display-only. The stored value is untouched — formatting
 * never round-trips back into the database.
 *
 * Examples: 12500 → "12,500.00"  ·  1234567.5 → "1,234,567.50"
 */
export function moneyCell(n: number | string | null | undefined, locale = "en-US"): string {
  const value = typeof n === "string" ? Number(n) : n;
  if (value == null || !Number.isFinite(value)) return "—";
  return toSystemDigits(
    new Intl.NumberFormat(locale, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
      useGrouping: true,
    }).format(value),
  );
}

/**
 * Grouped integer for quantities/counts (no decimals).
 * Example: 12500 → "12,500"
 */
export function qtyCell(n: number | string | null | undefined, locale = "en-US"): string {
  const value = typeof n === "string" ? Number(n) : n;
  if (value == null || !Number.isFinite(value)) return "—";
  return toSystemDigits(
    new Intl.NumberFormat(locale, { maximumFractionDigits: 3, useGrouping: true }).format(value),
  );
}

/**
 * Currency with grouping — the full-form alternative to `money()`.
 * Example: 12500 → "12,500.00 ر.ي"
 */
export function moneyGrouped(n: number, locale?: string) {
  const settings = readCompanyCurrency();
  const resolvedLocale =
    locale || (typeof navigator !== "undefined" ? navigator.language : "ar-YE");
  const symbol = getCurrencySymbol(settings.currency || "YER", resolvedLocale);
  const base = new Intl.NumberFormat(resolvedLocale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    useGrouping: true,
  }).format(n);
  return toSystemDigits(`${base} ${symbol}`);
}

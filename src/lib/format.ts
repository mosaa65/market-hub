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
  // Numeric glyphs are a user preference, not a browser-language preference.
  // Format from Latin digits first, then let `toSystemDigits` apply the company's
  // selected digit style. Otherwise an Arabic browser locale leaks eastern
  // digits even when the user selected Latin digits in Settings.
  const numberLocale = locale || "en-US";
  const symbolLocale = typeof navigator !== "undefined" ? navigator.language : "ar-YE";
  const symbol = getCurrencySymbol(currencyCode, symbolLocale);

  const base = new Intl.NumberFormat(numberLocale, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(n);
  return toSystemDigits(`${base} ${symbol}`);
}

export function num(n: number, locale = "en-US") {
  return toSystemDigits(new Intl.NumberFormat(locale).format(n));
}

/**
 * دالة مركزية لتنسيق الأعداد الصحيحة والإحصائيات (أعداد العملاء، الموردين، الفواتير، الموظفين).
 * لا تضع رمز العملة أبداً.
 * مثال: 1520 → "1,520"
 */
export function formatCount(n: number | string | null | undefined, locale = "en-US"): string {
  const value = typeof n === "string" ? Number(n) : n;
  if (value == null || !Number.isFinite(value)) return "0";
  return toSystemDigits(
    new Intl.NumberFormat(locale, { maximumFractionDigits: 0, useGrouping: true }).format(value),
  );
}

/**
 * دالة مركزية لتنسيق كميات الأصناف والمخزون.
 * لا تضع رمز عملة، وتدعم إلحاق اسم الوحدة (كيس، كرتون، قطعة).
 * تزيل الأصفار الزائدة بعد الفاصلة في حال كان الرقم صحيحاً.
 */
export function formatQuantity(
  n: number | string | null | undefined,
  unit?: string | null,
  options?: { maxDecimals?: number; locale?: string },
): string {
  const value = typeof n === "string" ? Number(n) : n;
  if (value == null || !Number.isFinite(value)) return "0" + (unit ? ` ${unit}` : "");
  const maxDecimals = options?.maxDecimals ?? (Number.isInteger(value) ? 0 : 3);
  const locale = options?.locale ?? "en-US";
  const formatted = new Intl.NumberFormat(locale, {
    minimumFractionDigits: 0,
    maximumFractionDigits: maxDecimals,
    useGrouping: true,
  }).format(value);
  const result = toSystemDigits(formatted);
  return unit ? `${result} ${unit}` : result;
}

/**
 * دالة مركزية لتنسيق النسب المئوية.
 * مثال: 15.5 → "15.5%"
 */
export function formatPercent(
  n: number | string | null | undefined,
  decimals = 1,
  locale = "en-US",
): string {
  const value = typeof n === "string" ? Number(n) : n;
  if (value == null || !Number.isFinite(value)) return "0%";
  const formatted = new Intl.NumberFormat(locale, {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals,
  }).format(value);
  return `${toSystemDigits(formatted)}%`;
}

/**
 * يفصل القيمة الرقمية عن رمز العملة إن كان الرمز مدمجاً مسبقاً داخل النص.
 * يمنع تكرار الرمز في بطاقات الملخصات.
 */
export function splitAmountAndCurrency(
  input: string | number,
  fallbackCurrency?: string,
): { amount: string; currency: string | null } {
  if (typeof input === "number") {
    return {
      amount: new Intl.NumberFormat("en-US", {
        minimumFractionDigits: Number.isInteger(input) ? 0 : 2,
        maximumFractionDigits: 2,
        useGrouping: true,
      }).format(input),
      currency: fallbackCurrency || null,
    };
  }
  const str = String(input).trim();
  // Match common currency words/symbols: ر.ي, YER, USD, $, ريال, etc.
  const currencyMatch = str.match(/(?:ر\.?ي|YER|USD|\$|ريال|SAR|EUR)/i);
  if (currencyMatch) {
    const symbol = currencyMatch[0];
    const cleaned = str.replace(symbol, "").trim();
    return { amount: cleaned, currency: symbol };
  }
  return { amount: str, currency: fallbackCurrency || null };
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
  const numberLocale = locale || "en-US";
  const symbolLocale = typeof navigator !== "undefined" ? navigator.language : "ar-YE";
  const symbol = getCurrencySymbol(settings.currency || "YER", symbolLocale);
  const base = new Intl.NumberFormat(numberLocale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    useGrouping: true,
  }).format(n);
  return toSystemDigits(`${base} ${symbol}`);
}

const COMPANY_SETTINGS_CACHE_KEY = "company_settings_cache";

type CompanySettingsCache = {
  currency?: string;
  currency_symbol?: string;
};

function readCompanySettingsCache(): CompanySettingsCache {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(COMPANY_SETTINGS_CACHE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function setCompanySettingsCache(settings: CompanySettingsCache | null | undefined) {
  if (typeof window === "undefined") return;
  if (!settings) {
    window.localStorage.removeItem(COMPANY_SETTINGS_CACHE_KEY);
    return;
  }
  window.localStorage.setItem(COMPANY_SETTINGS_CACHE_KEY, JSON.stringify(settings));
}

export function money(n: number, currency?: string, locale?: string) {
  const settings = readCompanySettingsCache();
  const currencyCode = currency || settings.currency || "YER";
  const resolvedLocale =
    locale || (typeof navigator !== "undefined" ? navigator.language : "ar-YE");
  const symbol = settings.currency_symbol?.trim() || "﷼";

  const base = new Intl.NumberFormat(resolvedLocale, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(n);
  return `${base} ${symbol}`;
}

export function num(n: number, locale = "en-US") {
  return new Intl.NumberFormat(locale).format(n);
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
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    useGrouping: true,
  }).format(value);
}

/**
 * Grouped integer for quantities/counts (no decimals).
 * Example: 12500 → "12,500"
 */
export function qtyCell(n: number | string | null | undefined, locale = "en-US"): string {
  const value = typeof n === "string" ? Number(n) : n;
  if (value == null || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 3, useGrouping: true }).format(
    value,
  );
}

/**
 * Currency with grouping — the full-form alternative to `money()`.
 * Example: 12500 → "12,500.00 ﷼"
 */
export function moneyGrouped(n: number, locale?: string) {
  const settings = readCompanySettingsCache();
  const resolvedLocale =
    locale || (typeof navigator !== "undefined" ? navigator.language : "ar-YE");
  const symbol = settings.currency_symbol?.trim() || "﷼";
  const base = new Intl.NumberFormat(resolvedLocale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    useGrouping: true,
  }).format(n);
  return `${base} ${symbol}`;
}

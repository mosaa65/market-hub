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
  const currencyCode = currency || settings.currency || "USD";
  const resolvedLocale = locale || (typeof navigator !== "undefined" ? navigator.language : "en-US");
  const symbol = settings.currency_symbol?.trim();

  if (symbol) {
    const base = new Intl.NumberFormat(resolvedLocale, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(n);
    return `${symbol}${base}`;
  }

  return new Intl.NumberFormat(resolvedLocale, {
    style: "currency",
    currency: currencyCode,
    maximumFractionDigits: 2,
  }).format(n);
}

export function num(n: number, locale = "en-US") {
  return new Intl.NumberFormat(locale).format(n);
}

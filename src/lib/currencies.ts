export interface CurrencyOption {
  code: string;
  name: string;
  symbol: string;
  flag: string;
}

const COUNTRY_BY_CURRENCY: Record<string, string | null> = {
  EUR: "EU",
  XAF: "CM",
  XOF: "SN",
  XCD: "AG",
  XPF: "PF",
  XCG: "CW",
  XDR: null,
  XAU: null,
  XAG: null,
  XPT: null,
  XPD: null,
  XBA: null,
  XBB: null,
  XBC: null,
  XBD: null,
  XSU: null,
  XTS: null,
  XUA: null,
  XXX: null,
};

const FALLBACK_CURRENCIES = [
  "AED",
  "AUD",
  "BHD",
  "CAD",
  "CHF",
  "CNY",
  "EGP",
  "EUR",
  "GBP",
  "INR",
  "JOD",
  "JPY",
  "KWD",
  "OMR",
  "QAR",
  "SAR",
  "USD",
  "YER",
];

function getCountryCode(currency: string): string | null {
  if (Object.prototype.hasOwnProperty.call(COUNTRY_BY_CURRENCY, currency)) {
    return COUNTRY_BY_CURRENCY[currency];
  }
  return /^[A-Z]{3}$/.test(currency) ? currency.slice(0, 2) : null;
}

function flagEmoji(countryCode: string | null): string {
  if (!countryCode || !/^[A-Z]{2}$/.test(countryCode)) return "🌐";

  return Array.from(countryCode)
    .map((letter) => String.fromCodePoint(letter.charCodeAt(0) + 127397))
    .join("");
}

export function getCurrencySymbol(currency: string, locale = "ar-YE"): string {
  if (currency === "YER") return "ر.ي";

  try {
    const symbol = new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      currencyDisplay: "narrowSymbol",
    })
      .formatToParts(0)
      .find((part) => part.type === "currency")
      ?.value.replace(/[\u061c\u200e\u200f]/g, "")
      .trim();

    return symbol || currency;
  } catch {
    return currency;
  }
}

export function getCurrencyOptions(language: string): CurrencyOption[] {
  const locale = language === "ar" ? "ar-YE" : "en";
  const codes =
    typeof Intl.supportedValuesOf === "function"
      ? Intl.supportedValuesOf("currency")
      : FALLBACK_CURRENCIES;
  const displayNames = new Intl.DisplayNames([locale], { type: "currency" });

  return [...new Set([...codes, "YER"])]
    .map((code) => ({
      code,
      name: displayNames.of(code) || code,
      symbol: getCurrencySymbol(code, locale),
      flag: flagEmoji(getCountryCode(code)),
    }))
    .sort((left, right) => {
      if (left.code === "YER") return -1;
      if (right.code === "YER") return 1;
      return left.name.localeCompare(right.name, locale);
    });
}

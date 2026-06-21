export function money(n: number, currency = "USD", locale = "en-US") {
  return new Intl.NumberFormat(locale, { style: "currency", currency, maximumFractionDigits: 2 }).format(n);
}
export function num(n: number, locale = "en-US") {
  return new Intl.NumberFormat(locale).format(n);
}

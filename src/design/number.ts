/**
 * Market Hub Design System — numeric, currency and digit-normalization utilities.
 *
 * Design intent (see DESIGN_AUDIT.md §6 and the task requirements #9/#10/#11):
 *
 *  - The **stored** value is always a plain JS `number` (or `null`).
 *  - The **displayed** value is a formatted, localized string.
 *  - Arabic-Indic digits written by the user are transliterated to ASCII **only** for
 *    numeric/currency/percent/quantity fields. Text-like fields (SKU, barcode, phone,
 *    email, codes) are NEVER normalized, because normalization there would corrupt data.
 */

/* ---------- Digit normalization ---------- */

const ARABIC_INDIC = "٠١٢٣٤٥٦٧٨٩"; // U+0660..U+0669
const EXTENDED_ARABIC_INDIC = "۰۱۲۳۴۵۶۷۸۹"; // U+06F0..U+06F9

/**
 * Convert Arabic-Indic (٠١٢٣) and Extended Arabic-Indic (۰۱۲۳) digits to ASCII.
 * Safe on any string; leaves non-digit characters untouched.
 */
export function toAsciiDigits(input: string): string {
  let out = "";
  for (const ch of input) {
    const ai = ARABIC_INDIC.indexOf(ch);
    if (ai > -1) {
      out += String(ai);
      continue;
    }
    const eai = EXTENDED_ARABIC_INDIC.indexOf(ch);
    if (eai > -1) {
      out += String(eai);
      continue;
    }
    out += ch;
  }
  return out;
}

/** Strip everything that is not a digit, an ASCII/Arabic decimal separator or a minus. */
export function sanitizeNumericString(raw: string): string {
  const ascii = toAsciiDigits(raw);
  // Normalize Arabic decimal separator (٫ U+066B) and Arabic thousands (٬ U+066C).
  const normalized = ascii.replace(/\u066B/g, ".").replace(/\u066C/g, "");
  // Keep digits, one dot, one leading minus.
  const cleaned = normalized.replace(/[^0-9.-]/g, "");
  const negative = cleaned.startsWith("-");
  const body = cleaned.replace(/-/g, "");
  const [head, ...rest] = body.split(".");
  const joined = rest.length ? `${head}.${rest.join("")}` : head;
  return negative ? `-${joined}` : joined;
}

/** Keep only digits (for integer-ish fields: quantities, counts, barcode-typed numbers). */
export function sanitizeIntegerString(raw: string, allowNegative = false): string {
  const ascii = toAsciiDigits(raw);
  const cleaned = ascii.replace(allowNegative ? /[^0-9-]/g : /[^0-9]/g, "");
  if (!allowNegative) return cleaned;
  const negative = cleaned.startsWith("-");
  return (negative ? "-" : "") + cleaned.replace(/-/g, "");
}

/* ---------- Parsing ---------- */

/**
 * Parse a user-typed numeric string into a number.
 * Returns `null` for an empty or non-numeric value (never `NaN`).
 */
export function parseNumber(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  const cleaned = sanitizeNumericString(String(raw));
  if (cleaned === "" || cleaned === "-" || cleaned === "." || cleaned === "-.") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** Parse an integer, ignoring a fractional part the user may have typed. */
export function parseInt10(raw: string | null | undefined): number | null {
  const n = parseNumber(raw);
  if (n == null) return null;
  return Math.trunc(n);
}

/* ---------- Clamping ---------- */

export interface NumericBounds {
  min?: number;
  max?: number;
}

export function clampNumber(value: number, { min, max }: NumericBounds): number {
  let out = value;
  if (min != null && out < min) out = min;
  if (max != null && out > max) out = max;
  return out;
}

/* ---------- Formatting ---------- */

/**
 * Format a number for display inside an input (no currency symbol, no grouping by
 * default so the user can keep editing it).
 */
export function formatNumberInput(
  value: number | null,
  {
    decimals = 2,
    grouping = false,
    locale = "en-US",
  }: { decimals?: number; grouping?: boolean; locale?: string } = {},
): string {
  if (value == null) return "";
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals,
    useGrouping: grouping,
  }).format(value);
}

/**
 * Group the integer part with thousands separators while the user types, preserving
 * the fractional part verbatim so the caret does not jump on every keystroke.
 */
export function groupWhileTyping(raw: string, separator = ","): string {
  const cleaned = sanitizeNumericString(raw);
  if (cleaned === "") return "";
  const negative = cleaned.startsWith("-");
  const body = negative ? cleaned.slice(1) : cleaned;
  const [intPart, fracPart] = body.split(".");
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, separator);
  const withFrac = fracPart != null ? `${grouped}.${fracPart.slice(0, 2)}` : grouped;
  return (negative ? "-" : "") + withFrac;
}

/** Remove grouping separators before storing. */
export function ungroup(value: string): string {
  return sanitizeNumericString(value.replace(/,/g, ""));
}

/* ---------- Phone ---------- */

/**
 * Phone numbers are identifiers, not quantities: Arabic digits are normalized
 * (users legitimately type ٠٧…), but no decimal logic is applied.
 */
export function sanitizePhone(raw: string): string {
  return toAsciiDigits(raw).replace(/[^\d+\-\s()]/g, "");
}

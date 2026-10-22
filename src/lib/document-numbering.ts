/**
 * Central Document Numbering Engine — frontend counterpart.
 *
 * This file is the SINGLE place the UI learns how a document number is built.
 * It intentionally mirrors the SQL implementation in
 * `supabase/migrations/20261210000000_central_document_numbering_engine.sql`
 * (`fn_format_document_number`) so the live preview in Settings shows exactly
 * what the database will produce.
 *
 * It NEVER allocates a number. Allocation is atomic and server-side only.
 */

export type DocumentNumberingSection =
  | "sales"
  | "purchase"
  | "inventory"
  | "production"
  | "milling"
  | "receipts"
  | "payments"
  | "finance"
  | "general";

export type NumberingDatePart = "none" | "year" | "year_month" | "full";

export type NumberingResetPolicy = "never" | "yearly" | "monthly" | "daily";

export type NumberingScope = "global" | "company" | "branch" | "pos";

export interface DocumentNumberingRow {
  id: string;
  document_type: string;
  scope: NumberingScope;
  scope_id: string | null;
  section: string;
  label_ar: string;
  label_en: string;
  prefix: string;
  separator: string;
  format_tokens: string;
  padding: number;
  date_part: NumberingDatePart;
  reset_policy: NumberingResetPolicy;
  current_value: number;
  is_active: boolean;
}

/** Tokens the engine understands. Order matters only for the UI palette. */
export const NUMBERING_TOKENS = [
  { token: "{PREFIX}", labelAr: "البادئة", labelEn: "Prefix" },
  { token: "{YYYY}", labelAr: "السنة (4)", labelEn: "Year (4)" },
  { token: "{YY}", labelAr: "السنة (2)", labelEn: "Year (2)" },
  { token: "{MM}", labelAr: "الشهر", labelEn: "Month" },
  { token: "{DD}", labelAr: "اليوم", labelEn: "Day" },
  { token: "{SEQ}", labelAr: "التسلسل", labelEn: "Sequence" },
] as const;

/**
 * Padding options. 0 means "no padding at all" — the engine never forces
 * leading zeros unless the admin explicitly asks for them.
 */
export const PADDING_OPTIONS = [0, 2, 3, 4, 5, 6, 7, 8] as const;

/**
 * Ready-made formats. These are pure presets over the token system — there is
 * no separate "period" logic hidden behind them.
 */
export interface NumberingPreset {
  id: string;
  labelAr: string;
  labelEn: string;
  format: string;
}

export const NUMBERING_PRESETS: NumberingPreset[] = [
  { id: "seq", labelAr: "تسلسل فقط", labelEn: "Sequence only", format: "{SEQ}" },
  {
    id: "prefix_seq",
    labelAr: "بادئة + تسلسل",
    labelEn: "Prefix + sequence",
    format: "{PREFIX}-{SEQ}",
  },
  {
    id: "ym_seq",
    labelAr: "سنة-شهر + تسلسل",
    labelEn: "Year-Month + sequence",
    format: "{YYYY}-{MM}-{SEQ}",
  },
  {
    id: "ymd_seq",
    labelAr: "سنة-شهر-يوم + تسلسل",
    labelEn: "Year-Month-Day + sequence",
    format: "{YYYY}-{MM}-{DD}-{SEQ}",
  },
  {
    id: "prefix_ym_seq",
    labelAr: "بادئة + سنة-شهر + تسلسل",
    labelEn: "Prefix + year-month + sequence",
    format: "{PREFIX}-{YYYY}-{MM}-{SEQ}",
  },
  {
    id: "prefix_ymd_seq",
    labelAr: "بادئة + سنة-شهر-يوم + تسلسل",
    labelEn: "Prefix + year-month-day + sequence",
    format: "{PREFIX}-{YYYY}-{MM}-{DD}-{SEQ}",
  },
  {
    id: "prefix_compact_seq",
    labelAr: "بادئة + سنةشهر مضغوط + تسلسل",
    labelEn: "Prefix + compact year-month + sequence",
    format: "{PREFIX}-{YYYY}{MM}-{SEQ}",
  },
];

/** Date shortcuts are presets over the tokens, not a parallel code path. */
export const DATE_PART_PRESETS: { id: NumberingDatePart; labelAr: string; labelEn: string }[] = [
  { id: "none", labelAr: "بدون تاريخ", labelEn: "No date" },
  { id: "year", labelAr: "YYYY", labelEn: "YYYY" },
  { id: "year_month", labelAr: "YYYY-MM", labelEn: "YYYY-MM" },
  { id: "full", labelAr: "YYYY-MM-DD", labelEn: "YYYY-MM-DD" },
];

const pad2 = (n: number) => String(n).padStart(2, "0");

/** Split a format string into the ordered list of parts (tokens + literals). */
export function parseFormatParts(format: string): string[] {
  if (!format) return [];
  return format.match(/\{[A-Z]+\}|[^{}]+/g) ?? [];
}

/** True when the format actually consumes a given token. */
export function formatHasToken(format: string, token: string): boolean {
  return parseFormatParts(format).includes(token);
}

/** Apply a date preset by rewriting the date tokens inside a format string. */
export function applyDatePreset(format: string, datePart: NumberingDatePart): string {
  const dateTokens = ["{YYYY}", "{YY}", "{MM}", "{DD}"];
  const parts = parseFormatParts(format).filter((p) => !dateTokens.includes(p));

  const insert: string[] =
    datePart === "year"
      ? ["{YYYY}"]
      : datePart === "year_month"
        ? ["{YYYY}", "-", "{MM}"]
        : datePart === "full"
          ? ["{YYYY}", "-", "{MM}", "-", "{DD}"]
          : [];

  if (insert.length === 0) return parts.join("");

  const seqIndex = parts.indexOf("{SEQ}");
  if (seqIndex === -1) return [...parts, "-", ...insert].join("");
  return [...parts.slice(0, seqIndex), "-", ...insert, "-", ...parts.slice(seqIndex)].join("");
}

/** Detect which preset (if any) a format matches, so the preset picker works. */
export function detectPreset(format: string): string | null {
  const normalised = format.replace(/\s+/g, "");
  const match = NUMBERING_PRESETS.find((p) => p.format.replace(/\s+/g, "") === normalised);
  return match ? match.id : null;
}

export interface FormatOptions {
  prefix: string;
  format: string;
  padding: number;
  separator?: string;
  at?: Date;
}

/**
 * Pure formatter — the TypeScript twin of the SQL function.
 *
 *   {SEQ}                        prefix INV, seq 1   -> "INV-1"
 *   {PREFIX}-{SEQ}               seq 125            -> "INV-125"
 *   {YYYY}-{MM}-{DD}-{SEQ}       seq 125            -> "2026-10-08-125"
 */
export function formatDocumentNumber(sequence: number, options: FormatOptions): string {
  const { prefix = "", format = "{SEQ}", padding = 0, separator = "-" } = options;
  const at = options.at ?? new Date();

  const seqText =
    padding > 0 && String(sequence).length < padding
      ? String(sequence).padStart(padding, "0")
      : String(sequence);

  let result = format;
  result = result.split("{PREFIX}").join(prefix);
  result = result.split("{YYYY}").join(String(at.getFullYear()));
  result = result.split("{YY}").join(pad2(at.getFullYear() % 100));
  result = result.split("{MM}").join(pad2(at.getMonth() + 1));
  result = result.split("{DD}").join(pad2(at.getDate()));
  result = result.split("{SEQ}").join(seqText);

  // Collapse runs of the separator (an unused date token leaves one behind)
  // and trim the edges, exactly like the SQL implementation.
  if (separator) {
    const escaped = separator.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    result = result.replace(new RegExp(`${escaped}{2,}`, "g"), separator);
    result = result.replace(new RegExp(`^${escaped}+|${escaped}+$`, "g"), "");
  }

  result = result.trim();
  return result || seqText;
}

export type NumberingFormatSource = Pick<
  DocumentNumberingRow,
  "prefix" | "format_tokens" | "padding" | "separator"
>;

/** Build a live preview for one configuration row. */
export function previewDocumentNumber(
  row: NumberingFormatSource,
  sequence: number,
  at: Date = new Date(),
): string {
  return formatDocumentNumber(sequence, {
    prefix: row.prefix,
    format: row.format_tokens,
    padding: row.padding,
    separator: row.separator,
    at,
  });
}

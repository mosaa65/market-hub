/**
 * Sanity checks for the shared Document Numbering formatter.
 *
 * These mirror the scenarios required for the numbering engine so the pure
 * formatting contract can be verified without a database. The atomic
 * allocation half (no duplicates) is enforced in SQL by `nextval()`.
 *
 * Run:  npx tsx scripts/verify-document-numbering.ts
 */
import {
  applyDatePreset,
  formatDocumentNumber,
  previewDocumentNumber,
  type DocumentNumberingRow,
} from "../src/lib/document-numbering";

let failures = 0;

function check(label: string, actual: unknown, expected: unknown) {
  const ok = actual === expected;
  if (!ok) failures += 1;
  const mark = ok ? "PASS" : "FAIL";
  console.log(
    `[${mark}] ${label}  ->  ${String(actual)}${ok ? "" : `  (expected ${String(expected)})`}`,
  );
}

const at = new Date(2026, 9, 8); // 2026-10-08

const row = (over: Partial<DocumentNumberingRow>): DocumentNumberingRow => ({
  id: "x",
  document_type: "sales_invoice",
  scope: "global",
  scope_id: null,
  section: "sales",
  label_ar: "",
  label_en: "",
  prefix: "INV",
  separator: "-",
  format_tokens: "{PREFIX}-{SEQ}",
  padding: 0,
  date_part: "none",
  reset_policy: "never",
  current_value: 0,
  is_active: true,
  ...over,
});

console.log("── Document numbering formatter checks ──");

// Test 1: SEQ = 1, Padding = 0 -> INV-1
check("T1 seq=1 padding=0", previewDocumentNumber(row({ padding: 0 }), 1, at), "INV-1");

// Test 2: SEQ = 125, Padding = 0 -> INV-125
check("T2 seq=125 padding=0", previewDocumentNumber(row({ padding: 0 }), 125, at), "INV-125");

// Test 3: YYYY-MM-DD + SEQ -> 2026-10-08-125 (no prefix in the format)
check(
  "T3 date tokens",
  previewDocumentNumber(row({ format_tokens: "{YYYY}-{MM}-{DD}-{SEQ}", prefix: "INV" }), 125, at),
  "2026-10-08-125",
);

// Padding variations
check("padding=4", previewDocumentNumber(row({ padding: 4 }), 125, at), "INV-0125");
check("padding=6", previewDocumentNumber(row({ padding: 6 }), 125, at), "INV-000125");
check("padding=0 never pads", previewDocumentNumber(row({ padding: 0 }), 1, at), "INV-1");

// Sequence must stay independent from presentation
check(
  "custom order",
  previewDocumentNumber(row({ format_tokens: "{SEQ}-{YYYY}", padding: 3 }), 7, at),
  "007-2026",
);

// Separator support
check(
  "custom separator",
  previewDocumentNumber(
    row({ separator: "/", format_tokens: "{PREFIX}/{YYYY}/{SEQ}", padding: 2 }),
    5,
    at,
  ),
  "INV/2026/05",
);

// Date presets are presets over tokens, not separate logic
check(
  "date preset full",
  applyDatePreset("{PREFIX}-{SEQ}", "full"),
  "{PREFIX}--{YYYY}-{MM}-{DD}-{SEQ}",
);

// Empty template must still yield the raw number (never an empty string)
check("empty format", formatDocumentNumber(42, { prefix: "", format: "", padding: 0 }), "42");

// Stability: the same inputs always produce the same output (numbers are frozen
// on the document row, so re-formatting history is deterministic).
const frozen = "INV-0125";
check(
  "frozen number stays",
  formatDocumentNumber(125, { prefix: "INV", format: "{PREFIX}-{SEQ}", padding: 4 }),
  frozen,
);

console.log(
  failures === 0 ? "\nAll document numbering checks passed." : `\n${failures} check(s) failed.`,
);

if (failures > 0) process.exit(1);

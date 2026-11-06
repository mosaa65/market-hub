/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * Market Hub ERP - Arabic Voice Normalizer
 * High-performance text cleanup, spoken punctuation conversion, and numeral handling.
 */

const EASTERN_TO_ASCII_DIGITS: Record<string, string> = {
  "٠": "0",
  "١": "1",
  "٢": "2",
  "٣": "3",
  "٤": "4",
  "٥": "5",
  "٦": "6",
  "٧": "7",
  "٨": "8",
  "٩": "9",
};

/**
 * Spoken punctuation and command phrases mapped to their typed symbols.
 */
const SPOKEN_PUNCTUATION: [RegExp, string][] = [
  [/\s*(?:فاصلة|فاصله)\s*/gi, "، "],
  [/\s*(?:نقطة|نقطه)\s*/gi, ". "],
  [/\s*(?:علامة استفهام|علامه استفهام)\s*/gi, "؟ "],
  [/\s*(?:علامة تعجب|علامه تعجب)\s*/gi, "! "],
  [/\s*(?:نقطتين فوق بعض|نقطتان فوق بعض)\s*/gi, ": "],
  [/\s*(?:شرطة|شرطه|خط)\s*/gi, " - "],
  [/\s*(?:سطر جديد|انزل سطر|فقرة جديدة)\s*/gi, "\n"],
];

/**
 * Transliterates Eastern Arabic numerals (٠-٩) into Western ASCII digits (0-9).
 */
export function normalizeDigitsToAscii(text: string): string {
  if (!text) return "";
  return text.replace(/[٠-٩]/g, (digit) => EASTERN_TO_ASCII_DIGITS[digit] ?? digit);
}

/**
 * Normalizes speech-to-text transcript:
 * - Replaces spoken punctuation commands
 * - Normalizes redundant spaces
 * - Trims edges
 * - Keeps standard Arabic letters, numbers, and legitimate punctuation
 */
export function normalizeArabicSpeechTranscript(
  text: string,
  options: {
    convertPunctuation?: boolean;
    asciiDigits?: boolean;
    trim?: boolean;
  } = {},
): string {
  if (!text) return "";

  const { convertPunctuation = true, asciiDigits = false, trim = true } = options;

  let cleaned = text;

  if (convertPunctuation) {
    for (const [pattern, replacement] of SPOKEN_PUNCTUATION) {
      cleaned = cleaned.replace(pattern, replacement);
    }
  }

  if (asciiDigits) {
    cleaned = normalizeDigitsToAscii(cleaned);
  }

  // Clean multiple sequential spaces and newlines
  cleaned = cleaned
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n/g, "\n")
    .replace(/\s+([،.؟!:])/g, "$1");

  return trim ? cleaned.trim() : cleaned;
}

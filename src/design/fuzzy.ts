/**
 * Market Hub — fuzzy search utilities (Arabic + English aware).
 *
 * Requirement: search across the whole system should be forgiving — typing
 * "فلتر زيت" should match "فلتر زيت المحرك", "oil fltr" should match
 * "Oil Filter", and Arabic diacritics / letter variants should not cause misses.
 *
 * Why hand-written rather than a library:
 *  - the app must stay dependency-light and work offline on a POS terminal
 *  - the Arabic normalisation rules needed here (hamza forms, ta marbuta,
 *    tatweel, diacritics) are the part libraries usually get wrong for real data
 *  - our datasets are small enough (hundreds to low thousands of rows) that a
 *    linear scan with a prebuilt normalised index is instant
 *
 * The index is built once per dataset and reused for every keystroke.
 */

/* ---------- Normalisation ---------- */

/** Arabic diacritics (tashkeel) + tatweel. */
const ARABIC_DIACRITICS =
  /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06DC\u06DF-\u06E8\u06EA-\u06ED\u0640]/g;

/** Arabic-Indic and Extended Arabic-Indic digits → ASCII. */
const AR_DIGITS = /[\u0660-\u0669\u06F0-\u06F9]/g;

function normalizeDigits(input: string): string {
  return input.replace(AR_DIGITS, (d) => {
    const code = d.charCodeAt(0);
    if (code >= 0x0660 && code <= 0x0669) return String(code - 0x0660);
    return String(code - 0x06f0);
  });
}

/**
 * Reduce a string to a comparable form:
 *  - lowercase
 *  - strip Arabic diacritics and tatweel
 *  - fold hamza/alef variants:  أ إ آ ٱ → ا
 *  - fold alef maqsura / ya:    ى → ي
 *  - fold ta marbuta / ha:      ة → ه
 *  - fold waw variants
 *  - fold Arabic digits to ASCII
 *  - collapse whitespace
 *  - strip punctuation that would otherwise break token matching
 */
export function normalizeForSearch(input: string | null | undefined): string {
  if (!input) return "";
  return normalizeDigits(String(input))
    .toLowerCase()
    .replace(ARABIC_DIACRITICS, "")
    .replace(/[أإآٱٲٳ]/g, "ا")
    .replace(/[ىئ]/g, "ي")
    .replace(/ؤ/g, "و")
    .replace(/ة/g, "ه")
    .replace(/گ/g, "ك")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Split normalised text into searchable tokens. */
export function tokenize(input: string | null | undefined): string[] {
  const normalized = normalizeForSearch(input);
  if (!normalized) return [];
  return normalized.split(" ").filter(Boolean);
}

/* ---------- Index ---------- */

export interface SearchIndex<T> {
  /** The indexed items, in original order. */
  items: T[];
  /** Normalised haystack per item (joined fields). */
  normalized: string[];
  /** Token list per item. */
  tokens: string[][];
}

/**
 * Build a reusable search index over the fields you want to search.
 * Build it inside a `useMemo`, keyed on the source array.
 */
export function buildSearchIndex<T>(
  items: T[],
  fields: (item: T) => (string | number | null | undefined)[],
): SearchIndex<T> {
  const normalized: string[] = [];
  const tokens: string[][] = [];

  for (const item of items) {
    const joined = fields(item)
      .filter((f) => f != null && f !== "")
      .map((f) => String(f))
      .join(" ");
    const norm = normalizeForSearch(joined);
    normalized.push(norm);
    tokens.push(norm ? norm.split(" ") : []);
  }

  return { items, normalized, tokens };
}

/* ---------- Matching ---------- */

export interface FuzzyMatchOptions {
  /** Minimum score to consider a match (0–1). Default 0.6 for single tokens. */
  threshold?: number;
  /** Require every query token to match something (default true). */
  requireAll?: boolean;
}

export interface ScoredMatch<T> {
  item: T;
  score: number;
  /** Which part matched — useful for highlighting. */
  reason: "field" | "token-prefix" | "token" | "fuzzy";
}

/**
 * Levenshtein distance with an early-exit band — enough for typo tolerance on
 * short product names without the cost of a full matrix.
 */
export function levenshtein(a: string, b: string, maxDistance = 3): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  if (Math.abs(a.length - b.length) > maxDistance) return maxDistance + 1;

  let prev = new Array<number>(b.length + 1);
  let curr = new Array<number>(b.length + 1);

  for (let j = 0; j <= b.length; j++) prev[j] = j;

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    let rowMin = curr[0];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
      if (curr[j] < rowMin) rowMin = curr[j];
    }
    if (rowMin > maxDistance) return maxDistance + 1;
    const swap = prev;
    prev = curr;
    curr = swap;
  }

  return prev[b.length];
}

/** Similarity in 0–1 derived from edit distance. */
function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  // Allow roughly one typo per 4 characters.
  const allowed = Math.max(1, Math.floor(maxLen / 4));
  const distance = levenshtein(a, b, allowed);
  if (distance > allowed) return 0;
  return 1 - distance / maxLen;
}

/**
 * Score one query token against one item's tokens.
 * Prefers exact > prefix > substring > fuzzy, so the best matches float up.
 */
function scoreToken(queryToken: string, itemTokens: string[], itemNormalized: string): number {
  if (!queryToken) return 1;

  // Whole-string substring: cheap and catches multi-word partials.
  if (itemNormalized.includes(queryToken)) {
    // Stronger if it starts a token.
    return itemTokens.some((t) => t.startsWith(queryToken)) ? 1 : 0.92;
  }

  let best = 0;
  for (const token of itemTokens) {
    if (token === queryToken) return 1;
    if (token.startsWith(queryToken)) {
      // Longer query relative to token = better match.
      best = Math.max(best, 0.85 + 0.15 * (queryToken.length / token.length));
      continue;
    }
    if (token.includes(queryToken)) {
      best = Math.max(best, 0.75);
      continue;
    }
    // Typo tolerance only makes sense for reasonably long tokens.
    if (queryToken.length >= 4) {
      const sim = similarity(queryToken, token);
      if (sim > 0) best = Math.max(best, 0.6 + 0.3 * sim);
    }
  }
  return best;
}

/**
 * Fuzzy-match a query against a prebuilt index.
 *
 * Returns matches ordered by score (desc), then by original order for stability.
 */
export function fuzzySearch<T>(
  index: SearchIndex<T>,
  query: string,
  options: FuzzyMatchOptions = {},
): ScoredMatch<T>[] {
  const { requireAll = true, threshold = 0.6 } = options;

  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) {
    return index.items.map((item) => ({ item, score: 1, reason: "field" as const }));
  }

  const results: ScoredMatch<T>[] = [];

  for (let i = 0; i < index.items.length; i++) {
    const itemTokens = index.tokens[i];
    const normalized = index.normalized[i];

    let total = 0;
    let matchedAll = true;
    let bestReason: ScoredMatch<T>["reason"] = "fuzzy";

    for (const qt of queryTokens) {
      const score = scoreToken(qt, itemTokens, normalized);
      if (score <= 0) {
        matchedAll = false;
        if (requireAll) break;
      }
      total += score;
      if (score >= 1) bestReason = "field";
      else if (score >= 0.85) bestReason = "token-prefix";
      else if (score >= 0.7) bestReason = "token";
    }

    if (requireAll && !matchedAll) continue;

    const average = total / queryTokens.length;
    if (average < threshold) continue;

    results.push({ item: index.items[i], score: average, reason: bestReason });
  }

  return results
    .map((match, originalIndex) => ({ match, originalIndex }))
    .sort((a, b) => b.match.score - a.match.score || a.originalIndex - b.originalIndex)
    .map(({ match }) => match);
}

/* ---------- Highlighting helper ---------- */

export interface HighlightSegment {
  text: string;
  match: boolean;
}

/**
 * Split a string into matched/unmatched segments for rendering highlights.
 * Works on the *original* text so the user sees their own spelling.
 */
export function highlightMatches(text: string, query: string): HighlightSegment[] {
  if (!text) return [];
  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) return [{ text, match: false }];

  // Build a boolean mask over the original characters by normalising
  // character-by-character so indices stay aligned.
  const normalizedChars: string[] = [];
  for (const ch of text) {
    const norm = normalizeForSearch(ch);
    normalizedChars.push(norm);
  }

  const mask = new Array<boolean>(text.length).fill(false);
  const chars = [...text];

  for (const qt of queryTokens) {
    // Find the token in the normalised character stream.
    for (let start = 0; start < normalizedChars.length; start++) {
      let acc = "";
      for (let end = start; end < normalizedChars.length && acc.length < qt.length + 4; end++) {
        acc += normalizedChars[end];
        if (acc === qt) {
          for (let k = start; k <= end; k++) mask[k] = true;
          start = end;
          break;
        }
        if (acc.length > qt.length + 2) break;
      }
    }
  }

  const segments: HighlightSegment[] = [];
  let buffer = "";
  let bufferMatch = mask[0] ?? false;

  for (let i = 0; i < chars.length; i++) {
    const isMatch = mask[i];
    if (isMatch !== bufferMatch) {
      if (buffer) segments.push({ text: buffer, match: bufferMatch });
      buffer = "";
      bufferMatch = isMatch;
    }
    buffer += chars[i];
  }
  if (buffer) segments.push({ text: buffer, match: bufferMatch });

  return segments;
}

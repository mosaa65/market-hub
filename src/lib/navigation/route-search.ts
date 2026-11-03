/**
 * Route Search — بحث موحّد في سجل الواجهات (Route Registry).
 *
 * يدعم:
 *   - البحث بالعربية والإنجليزية.
 *   - تطبيع النص العربي (أ/إ/آ → ا، ة → ه، ى → ي، إزالة التشكيل).
 *   - المرادفات (keywords) المضمّنة في كل عنصر.
 *   - الترتيب حسب جودة المطابقة (عنوان > وصف > كلمة مفتاحية).
 */

import {
  getVisibleRoutes,
  type RouteRegistryFilters,
  type RouteSearchEntry,
} from "./route-registry";

/** تطبيع النص للبحث التسامحي (عربي وإنجليزي). */
export function normalizeSearchText(text: string): string {
  return (text || "")
    .toLowerCase()
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/[\u064B-\u065F]/g, "")
    .trim();
}

export interface RouteSearchHit {
  entry: RouteSearchEntry;
  score: number;
}

/**
 * ترتيب المطابقة:
 *   3 = تطابق تام في العنوان
 *   2 = العنوان يبدأ بالنص
 *   1 = العنوان يحتوي النص
 *   0.5 = الوصف/الكلمة المفتاحية تحتوي النص
 */
function scoreEntry(entry: RouteSearchEntry, needle: string, isAr: boolean): number {
  if (!needle) return 0;
  const title = normalizeSearchText(isAr ? entry.titleAr : entry.titleEn);
  const otherTitle = normalizeSearchText(isAr ? entry.titleEn : entry.titleAr);
  const description = normalizeSearchText(isAr ? entry.descriptionAr : entry.descriptionEn);
  const keywords = entry.keywords.map(normalizeSearchText);

  // تطابق تام في العنوان أو كلمة مفتاحية مُنتقاة = أقوى إشارة.
  if (title === needle || otherTitle === needle) return 3;
  if (keywords.some((k) => k === needle)) return 2.8;
  if (title.startsWith(needle) || otherTitle.startsWith(needle)) return 2.5;
  if (title.includes(needle) || otherTitle.includes(needle)) return 2;
  if (keywords.some((k) => k.includes(needle))) return 1.2;
  if (description.includes(needle)) return 0.8;
  if (normalizeSearchText(entry.path).includes(needle)) return 0.6;
  return 0;
}

/**
 * البحث في الواجهات المرئية فقط.
 * @param query نص البحث
 * @param isAr لغة العرض (تؤثر على ترتيب العنوان الأساسي)
 * @param filters عوامل التصفية (modules/permissions/milling mode)
 */
export function searchRoutes(
  query: string,
  isAr: boolean,
  filters: RouteRegistryFilters = {},
): RouteSearchEntry[] {
  const entries = getVisibleRoutes(filters);
  const needle = normalizeSearchText(query);
  if (!needle) return entries;
  return entries
    .map<RouteSearchHit>((entry) => ({ entry, score: scoreEntry(entry, needle, isAr) }))
    .filter((hit) => hit.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((hit) => hit.entry);
}

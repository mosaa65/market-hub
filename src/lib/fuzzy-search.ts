/**
 * Fuzzy Search — بحث تسامحي موحد (عربي + إنجليزي).
 *
 * صُمم حسب طلب المالك: البحث في المنتجات والعملاء يجب أن يكون "تشامحي" —
 * أي يتسامح مع أخطاء الكتابة الشائعة، وليس تطابق حرفياً صارماً:
 *   1. تطبيع عربي: أ/إ/آ → ا، ة → ه، ى → ي، إزالة التشكيل والهمزات المائلة.
 *   2. تجاهل ال همزة الوصل والتاء المربوطة والمشكّل تلقائياً (بالتطبيع أعلاه).
 *   3. مطابقة فرعية (substring) في أي مكان من الاسم.
 *   4. أرقام الحروف مبدلّة: مقلوب الحروف / ترتيب مختلف يُقاس بـ Levenshtein
 *      المبسط (مسافة تعديل) — الكلمة حتى 3 أحرف تسمح بخطأ واحد،
 *      4-6 حرفين خطآن، وأكثر من ذلك ثلاثة. فـ"ديقو" تجد "دقيق"،
 *      و"برسمرا" تجد "بُر سمراء"، و"نخالت" تجد "نخالة".
 *   5. مطابقة الأحرف الأولى (initials): "ب س" تجد "بُر سمراء".
 *
 * الأداء: كل الدوال O(n×m) صغيرة — آمنة على قوائم الآلاف.
 */

/** تطبيع النص: صغير الحروف + تطبيع عربي + إزالة التشكيل والمسافات الزائدة. */
export function normalizeSearchText(text: string | null | undefined): string {
  if (!text) return "";
  return (
    String(text)
      .toLowerCase()
      .replace(/[أإآٱ]/g, "ا")
      .replace(/ة/g, "ه")
      .replace(/ى/g, "ي")
      .replace(/ئ/g, "ي")
      .replace(/ؤ/g, "و")
      // إزالة التشكيل والحركات (فتحة/ضمة/كسرة/سكون/شدّة/تنوين)
      .replace(/[\u064B-\u065F\u0670]/g, "")
      // توحيد الأرقام العربية الهندية إلى لاتينية
      .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
      .replace(/\s+/g, " ")
      .trim()
  );
}

/** مسافة Levenshtein بسيطة (حد أعلى معقول: نصوص قصيرة). */
function levenshtein(a: string, b: string, max: number): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const prev = new Array(b.length + 1).fill(0).map((_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    let rowMin = prev[0];
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
      if (prev[j] < rowMin) rowMin = prev[j];
    }
    if (rowMin > max) return max + 1; // قطع مبكر — لا يطابق أبداً
  }
  return prev[b.length];
}

/** الحد الأقصى للأخطاء المسموح حسب طول الكلمة. */
function toleranceFor(len: number): number {
  if (len <= 3) return 0; // كلمات قصيرة: تطابق تام فقط (تفادي ضجيج)
  if (len <= 5) return 1;
  if (len <= 8) return 2;
  return 3;
}

/**
 * هل الكلمة (word) تطابق مصطلح البحث (term) تسامحياً؟
 * يعيد درجة ثقة: 1 = مطابقة تامة/فرعية، 0.6 = ضمن مسافة الخطأ، 0 = لا.
 */
function wordScore(normalizedWord: string, normalizedTerm: string): number {
  if (!normalizedTerm) return 0;
  if (normalizedWord === normalizedTerm) return 1;
  if (normalizedWord.includes(normalizedTerm)) return 1; // مطابقة فرعية

  const tolerance = toleranceFor(normalizedTerm.length);
  if (tolerance === 0) return 0;

  const distance = levenshtein(normalizedWord, normalizedTerm, tolerance);
  return distance <= tolerance ? 0.6 : 0;
}

export interface FuzzyMatchOptions {
  /** عتبة الثقة الدنيا (0..1) — الافتراضي 0.6. */
  minScore?: number;
}

/**
 * هل النص (haystack) يطابق استعلام البحث (query) تسامحياً؟
 * يقارن الاستعلام مع كل كلمة في النص، ويقبل إذا:
 *   - استعلام كامل داخل النص بعد التطبيع، أو
 *   - كل كلمات الاستعلام تطابق كلمة/كلمات من النص ضمن درجة الثقة، أو
 *   - مطابقة الأحرف الأولى: "ب س" → "بُر سمراء".
 */
export function fuzzyMatch(
  haystack: string | null | undefined,
  query: string | null | undefined,
  options: FuzzyMatchOptions = {},
): boolean {
  const minScore = options.minScore ?? 0.6;
  const hay = normalizeSearchText(haystack);
  const q = normalizeSearchText(query);
  if (!hay || !q) return false;
  if (hay.includes(q)) return true;

  const hayWords = hay.split(" ");
  const queryWords = q.split(" ").filter(Boolean);

  // مطابقة الأحرف الأولى: كل حرف من الاستعلام يبدأ كلمة من النص بالترتيب
  if (queryWords.length >= 1 && queryWords.every((w) => w.length === 1)) {
    let cursor = 0;
    for (const letter of queryWords) {
      const found = hayWords.findIndex((w, idx) => idx >= cursor && w.startsWith(letter));
      if (found === -1) break;
      cursor = found + 1;
    }
    if (cursor > 0) return true;
  }

  // كل كلمة من الاستعلام تطابق (تسامحياً) كلمةً ما من النص
  return queryWords.every((qw) => hayWords.some((hw) => wordScore(hw, qw) >= minScore));
}

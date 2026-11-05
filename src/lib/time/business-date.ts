/**
 * التواريخ التشغيلية — مصدر واحد للتاريخ المحلي للمنشأة.
 *
 * ⚠️ القاعدة: لا تستخدم `new Date().toISOString().slice(0, 10)` كتاريخ مستند.
 *
 * `toISOString()` يحوّل إلى UTC. منشأتنا تعمل بتوقيت Asia/Aden (UTC+3)، فبين
 * منتصف الليل والثالثة صباحًا يعيد UTC **تاريخ الأمس** — فيُسجَّل تحصيل اليوم
 * بتاريخ الغد/الأمس، ويختلف ترتيب الحركات في كشف الحساب عن وقوعها الفعلي،
 * وقد تقع في فترة مالية مختلفة.
 *
 * استخدم:
 *   todayKey()        تاريخ معاملة يُرسل للخادم (YYYY-MM-DD)
 *   toDateKey(date)   نفس الصيغة لأي تاريخ
 *   nowIso()          لحظة كاملة (ISO) عند الحاجة للوقت الفعلي
 *   dateOnlyIso(ymd)  تحويل تاريخ بلا وقت إلى ISO ثابت عند العرض
 */

/** المنطقة الزمنية المحاسبية للنظام — مطابقة لـ business_timezone() في قاعدة البيانات. */
export const BUSINESS_TIME_ZONE = "Asia/Aden";

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * مفتاح اليوم (YYYY-MM-DD) بالتوقيت المحلي للجهاز — وهو توقيت المنشأة عمليًا.
 * لا يمرّ عبر UTC، فلا يزحف يومًا عند الطرفين.
 */
export function toDateKey(date: Date): string {
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** تاريخ اليوم للاستخدام في نماذج المستندات. */
export function todayKey(): string {
  return toDateKey(new Date());
}

/** لحظة كاملة بالـ ISO — للطوابع الزمنية، لا لتواريخ المستندات. */
export function nowIso(): string {
  return new Date().toISOString();
}

/**
 * تاريخ بلا وقت (YYYY-MM-DD) → ISO عند منتصف الليل UTC.
 * يُستخدم للعرض فقط: يمنع انزياح اليوم الذي يحدث عند تمرير تاريخ مجرّد
 * إلى منسّق يتعامل معه كطابع زمني ويحوّله إلى التوقيت المحلي.
 */
export function dateOnlyIso(value: string | null | undefined): string {
  if (!value) return "";
  const key = /^\d{4}-\d{2}-\d{2}/.exec(value)?.[0] ?? "";
  return key ? `${key}T00:00:00Z` : value;
}

/**
 * تاريخ المعاملة الفعلي لسجل فاتورة (مبيعات أو مشتريات).
 *
 * المرحلة الثالثة: السجل يحمل تاريخين — `created_at` (لحظة الإدخال) و
 * `business_date` (اليوم الذي اختاره المستخدم). كل تصفية أو تقرير يجب أن
 * يقرأ هذا الحقل، لا `created_at`، وإلا ظهر كشف الأمس في تقرير اليوم.
 *
 * السجلات القديمة (قبل الترحيل) لا تحمل business_date، فتعود إلى created_at.
 */
export function transactionDate(row: {
  business_date?: string | null;
  created_at?: string | null;
}): string {
  const business = row.business_date;
  if (business) return dateOnlyIso(business);
  return row.created_at ?? "";
}

/** مفتاح اليوم (YYYY-MM-DD) لتاريخ المعاملة — للمقارنة والتصفية. */
export function transactionDayKey(row: {
  business_date?: string | null;
  created_at?: string | null;
}): string {
  const value = transactionDate(row);
  return /^\d{4}-\d{2}-\d{2}/.exec(value)?.[0] ?? "";
}

/** هل التاريخ المجرّد قبل اليوم التشغيلي؟ */
export function isPastDay(value: string | null | undefined): boolean {
  if (!value) return false;
  const key = /^\d{4}-\d{2}-\d{2}/.exec(value)?.[0] ?? "";
  return key !== "" && key < todayKey();
}

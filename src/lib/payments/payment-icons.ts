/**
 * أيقونات طرق الدفع.
 *
 * المصدر الوحيد للحقيقة هو `public.payment_methods.icon_key` في القاعدة، وهو
 * **مفتاح نصي** لا مسار ولا رابط. هذا الملف يحوّل المفتاح إلى ملف SVG داخل
 * `public/payment-icons/`.
 *
 * ── لماذا حلّ غير متزامن؟ ────────────────────────────────────────────────────
 * الأيقونات ملفات ثابتة (static assets) تُخدَم مباشرةً من المسار العام، فلا حاجة
 * إلى طلب شبكة لقراءة السجل. التعيين مكتوب هنا مرة واحدة، ومُطابَق مع
 * `public/payment-icons/manifest.json` ومع مفاتيح `icon_key` في البذرة
 * `supabase/seeds/01_system/08_payment_methods.sql`.
 *
 * ── مفتاح مجهول ──────────────────────────────────────────────────────────────
 * يعود إلى `generic.svg`. لا رمي خطأ ولا صورة مكسورة: طريقة دفع أضافها المطوّر
 * بمفتاح جديد ولم يُضف ملفه بعد يجب أن تظهر بأيقونة عامة، لا أن تُفرغ الشاشة.
 */

/** المسار العام الذي تُخدَم منه الأيقونات. */
export const PAYMENT_ICON_BASE = "/payment-icons";

/**
 * مفتاح `icon_key` → اسم الملف.
 *
 * يجب أن يبقى مُطابقاً لـ `public/payment-icons/manifest.json`. عند إضافة مفتاح
 * في القاعدة، أضفه هنا وهناك.
 */
export const PAYMENT_ICONS: Record<string, string> = {
  cash: "cash.svg",
  credit: "credit.svg",
  "bank-transfer": "bank-transfer.svg",
  kuraimi: "kuraimi.svg",
  bank: "bank.svg",
  "mobile-money": "mobile-money.svg",
  // الشعار الرسمي لمحفظة جيب (شركة الأهدل المالية) — ملف traced vector،
  // مفتاحه `jaib` ويُطابق `payment_methods.icon_key` للصف `jaib`.
  jaib: "jaib.svg",
  wallet: "wallet.svg",
  card: "card.svg",
  split: "split.svg",
  generic: "generic.svg",
};

/**
 * يحوّل `icon_key` إلى رابط الملف. مفتاح فارغ أو مجهول يعود إلى `generic.svg`.
 *
 * @param iconKey قيمة `public.payment_methods.icon_key`
 */
export function paymentIconUrl(iconKey?: string | null): string {
  const key = (iconKey ?? "").trim().toLowerCase();
  const file = PAYMENT_ICONS[key] ?? PAYMENT_ICONS.generic;
  return `${PAYMENT_ICON_BASE}/${file}`;
}

/**
 * يحوّل قيمة `payment_method` المخزّنة (قيمة الـENUM) إلى مفتاح أيقونة.
 *
 * هذه خريطة **رجعية فقط**: للفواتير القديمة التي خزّنت قيمة الـENUM ولم تحمل
 * `icon_key` الكتالوج. الشاشة الحديثة تقرأ `icon_key` من الكتالوج مباشرةً.
 */
export function paymentIconUrlFromStoredValue(stored?: string | null): string {
  switch ((stored ?? "").trim().toLowerCase()) {
    case "cash":
      return paymentIconUrl("cash");
    case "card":
      return paymentIconUrl("card");
    case "bank_transfer":
      return paymentIconUrl("bank-transfer");
    case "mobile_money":
      return paymentIconUrl("mobile-money");
    case "cheque":
      return paymentIconUrl("bank-transfer");
    case "credit":
      return paymentIconUrl("credit");
    case "split":
      return paymentIconUrl("split");
    default:
      return paymentIconUrl("generic");
  }
}

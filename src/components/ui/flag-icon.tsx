import { cn } from "@/lib/utils";

interface FlagIconProps {
  /** ISO 3166-1 alpha-2 country code (e.g. "YE", "SA", "US") */
  code: string;
  /** Optional emoji fallback if no drawing exists for the code */
  emoji?: string;
  /** CSS size class — defaults to "size-5" */
  size?: string;
  className?: string;
}

/**
 * أعلام الدول بدون أي طلب شبكة.
 *
 * ما كان قبل: وسم <img> يشير إلى flagcdn.com. أي حجب للموقع أو انقطاع في
 * الشبكة — وهو حال كثير من الشبكات هنا — ينتج علماً مكسوراً بجانب رقم الهاتف
 * وفي منتقي رمز العملة. تلك صورة صغيرة لا تستحق رحلة إلى الخارج، ونتيجتها
 * حين تفشل أيقونة مستطيلة مكسورة في واجهة عربية.
 *
 * الترتيب: الإيموجي الوطني أولاً (يظهر ملوّناً في معظم الأنظمة)، ثم حرفا
 * الدولة إن لم يوجد إيموجي.
 */
export function FlagIcon({ code, emoji, size = "size-5", className }: FlagIconProps) {
  const upper = (code || "").toUpperCase();
  const valid = /^[A-Z]{2}$/.test(upper);

  // Regional indicator symbols: "YE" → 🇾🇪
  const derived = valid
    ? String.fromCodePoint(...[...upper].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65))
    : null;

  return (
    <span
      className={cn(
        "inline-flex items-center justify-center overflow-hidden leading-none",
        size,
        className,
      )}
      title={valid ? upper : undefined}
      aria-hidden="true"
    >
      <span className="text-[0.95em] leading-none">{emoji || derived || "🌐"}</span>
    </span>
  );
}

/**
 * Extracts the country code from a currency code.
 * Most ISO 4217 currency codes share the first 2 letters with
 * the ISO 3166-1 country code (e.g. USD → US, YER → YE, SAR → SA).
 */
const CURRENCY_TO_COUNTRY: Record<string, string> = {
  EUR: "eu",
  XAF: "cm",
  XOF: "sn",
  XCD: "ag",
  XPF: "pf",
};

export function currencyToCountryCode(currencyCode: string): string | null {
  if (CURRENCY_TO_COUNTRY[currencyCode]) return CURRENCY_TO_COUNTRY[currencyCode];
  if (/^[A-Z]{3}$/.test(currencyCode)) return currencyCode.slice(0, 2).toLowerCase();
  return null;
}

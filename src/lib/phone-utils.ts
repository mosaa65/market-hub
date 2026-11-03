import { COUNTRIES, Country, DEFAULT_COUNTRY } from "./country-data";

/**
 * تحويل رقم الهاتف ورمز الدولة إلى صيغة قياسية E.164 (مثال: +967771234567)
 */
export function formatPhoneE164(
  phone: string,
  countryCode: string = DEFAULT_COUNTRY.dialCode,
): string {
  const cleaned = phone.replace(/[^\d+]/g, "");
  if (cleaned.startsWith("+")) {
    return cleaned;
  }
  const cleanDialCode = countryCode.startsWith("+") ? countryCode : `+${countryCode}`;
  const cleanNumber = cleaned.replace(/^0+/, "");
  return `${cleanDialCode}${cleanNumber}`;
}

/**
 * تحويل رقم الهاتف أو الهاتف الدولي إلى بريد إلكتروني داخلي متوافق مع Supabase Auth
 * مثال: 967771234567@vortex.local أو 771234567@vortex.local
 */
export function phoneToAuthEmail(phoneE164OrDigits: string): string {
  const cleanDigits = phoneE164OrDigits.replace(/\D/g, "");
  return `${cleanDigits}@vortex.local`;
}

/**
 * التحقق من صحة رقم الهاتف
 */
export function isValidPhone(phone: string): boolean {
  if (!phone || phone.trim().length === 0) return false;
  const cleaned = phone.replace(/\D/g, "");
  return cleaned.length >= 7 && cleaned.length <= 15;
}

/**
 * تنسيق الهاتف للعرض في الواجهة
 */
export function formatPhoneDisplay(phone: string): string {
  if (!phone) return "";
  const cleaned = phone.trim();
  return cleaned;
}

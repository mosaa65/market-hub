/**
 * مساعدات واتساب — فتح محادثة برسالة جاهزة عبر رابط wa.me.
 *
 * تم تحديث هذا الملف ليرتبط مباشرة بالنواة المركزية الموحدة للمراسلات
 * (src/lib/communication/phone.ts)، مع الحفاظ على التوافق الرجعي الكامل
 * لجميع الشاشات التي تستورده حالياً.
 */

import {
  normalizeWhatsAppPhone as normalizeUnified,
  buildWhatsAppLink as buildUnified,
  openWhatsAppDirect,
} from "./communication/phone";

/**
 * يحوّل رقم الجوال إلى صيغة دولية قياسية بأرقام فقط (مثل 96777xxxxxxx أو 9665xxxxxxxx).
 * يدعم: الأرقام المحلية مع/بدون صفر، الأرقام الدولية، والأرقام العربية-الهندية.
 * يعيد null إذا كان الرقم غير صالح.
 */
export function normalizeWhatsAppPhone(raw: string | null | undefined): string | null {
  return normalizeUnified(raw);
}

/**
 * يبني رابط wa.me مع نص جاهز. يعيد null إذا كان الرقم غير صالح.
 * لا يعيد أبداً رابطاً فارغاً بلا مستلم.
 */
export function buildWhatsAppLink(
  phone: string | null | undefined,
  message: string,
): string | null {
  return buildUnified(phone, message);
}

/**
 * يفتح واتساب في تبويب جديد برسالة جاهزة. يعيد false إذا كان الرقم غير صالح.
 */
export function openWhatsApp(phone: string | null | undefined, message: string): boolean {
  return openWhatsAppDirect(phone, message);
}

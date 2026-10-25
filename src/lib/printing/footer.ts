import type { CompanyProfile } from "./company-profile";

const esc = (value: unknown) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/**
 * الفوتر الموحّد للمستندات المطبوعة (كشوف، تقارير، وأي مستند غير الفاتورة).
 *
 * يعيد بيانات المنشأة الحقيقية من Company Profile — لا اسم شركة ولا رقم
 * تواصل ثابت في الكود. يُبنى من: نص التذييل، أرقام التواصل، البريد، العنوان.
 */
export function renderUniversalFooter(
  company: CompanyProfile,
  rtl = true,
  compact = false,
): string {
  const contact = company.phone || company.contacts.join(" · ");
  const rows = [
    company.name ? `<div class="footer-name">${esc(company.name)}</div>` : "",
    contact ? `<div class="footer-contact">${esc(contact)}</div>` : "",
    company.email ? `<div class="footer-email">${esc(company.email)}</div>` : "",
    !compact && company.address ? `<div class="footer-address">${esc(company.address)}</div>` : "",
  ].filter(Boolean);
  // A profile with no company data renders nothing rather than an empty frame.
  if (rows.length === 0) return "";
  return `<footer class="universal-footer" dir="${rtl ? "rtl" : "ltr"}">${rows.join("")}</footer>`;
}

export const UNIVERSAL_FOOTER_CSS = `.universal-footer{margin-top:auto;padding-top:8px;border-top:1px solid #9ca3af;text-align:center;color:#4b5563;font-size:9px;line-height:1.45;break-inside:avoid;page-break-inside:avoid}.universal-footer .footer-name{font-weight:700;color:#111827}.universal-footer .footer-contact{direction:ltr;unicode-bidi:isolate;font-weight:700}.universal-footer .footer-email,.universal-footer .footer-address{white-space:pre-wrap}`;

/**
 * عبارة حقوق منفّذ البرنامج — **لا تُطبع في الفواتير**.
 *
 * النص ثابت هنا للتوثيق فقط، والقيمة الفارغة هي حارس إضافي: حتى لو أعاد
 * أحدهم استدعاء `renderInvoiceRightsFooter()` في قالب، فلن يطبع شيئًا.
 */
export const COMPANY_RIGHTS_TEXT = "تطوير وبرمجة إنما سوفت | 772217218 - 784795104";

/** سطر الحقوق — معطّل في الفواتير بقرار المالك. */
export function renderInvoiceRightsFooter(): string {
  return "";
}

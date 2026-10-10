import type { CompanyProfile } from "./company-profile";
import { SUPPORT_CONTACT_LINE, companyCreditLine } from "@/lib/company-credit";

/**
 * إعادة تصدير عبارة الاعتماد من وحدة الفوتر.
 * القوالب التي تبني تذييلها بنفسها (كالصور الحرارية) تستوردها من هنا بدل
 * وحدة الاعتماد، فلا تحمل ملفات `lib/templates` أي اسم مؤسسة ثابت.
 */
export { companyCreditLine };

const esc = (value: unknown) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/**
 * الفوتر الموحد — يُستخدم في كل القوالب والممرات (فواتير، سندات، كشوفات،
 * تقارير، مخزون، تحويلات، مطحنة، حراري، PDF، معاينة).
 *
 * الأرقام تأتي من Company Profile، ومع غيابها تُعرض أرقام الدعم الموثقة
 * (784795104 · 772217218) كـ fallback صريح — لا يُكتب اسم شركة ثابت هنا.
 */
export function renderUniversalFooter(
  company: CompanyProfile,
  rtl = true,
  compact = false,
): string {
  const contact =
    company.footerContact || company.contacts.join(" · ") || company.phone || SUPPORT_CONTACT_LINE;
  return `<footer class="universal-footer" dir="${rtl ? "rtl" : "ltr"}">
    ${company.name ? `<div class="footer-company">${esc(company.name)}</div>` : ""}
    ${company.footerText ? `<div class="footer-note">${esc(company.footerText)}</div>` : ""}
    <div class="footer-contact">${esc(contact)}</div>
    ${company.email ? `<div class="footer-email">${esc(company.email)}</div>` : ""}
    ${!compact && company.address ? `<div class="footer-address">${esc(company.address)}</div>` : ""}
    <div class="footer-credit">${esc(companyCreditLine())}</div>
  </footer>`;
}

export const UNIVERSAL_FOOTER_CSS = `.universal-footer{margin-top:auto;padding-top:8px;border-top:1px solid var(--print-line,#9ca3af);text-align:center;color:var(--print-muted,#4b5563);font-size:9px;line-height:1.45;break-inside:avoid}.universal-footer .footer-company{font-weight:800}.universal-footer .footer-note{font-weight:600}.universal-footer .footer-contact{direction:ltr;unicode-bidi:isolate;font-weight:700}.universal-footer .footer-email,.universal-footer .footer-address{white-space:pre-wrap}.universal-footer .footer-credit{margin-top:3px;padding-top:3px;border-top:1px dotted var(--print-line,#9ca3af);font-weight:700;break-inside:avoid}@media print{.universal-footer{break-inside:avoid}}`;

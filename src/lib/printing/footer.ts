import type { CompanyProfile } from "./company-profile";
export function renderUniversalFooter(
  _company: CompanyProfile,
  _rtl = true,
  _compact = false,
): string {
  return "";
}

export const UNIVERSAL_FOOTER_CSS = "";

export const COMPANY_RIGHTS_TEXT = "تطوير وبرمجة إنما سوفت | 772217218 - 784795104";

export function renderInvoiceRightsFooter(): string {
  return `<footer dir="rtl" style="margin-top:8px;padding-top:4px;border-top:1px solid #d1d5db;text-align:center;color:#475569;font:600 8.5px/1.4 Arial,sans-serif;break-inside:avoid;page-break-inside:avoid"><span>تطوير وبرمجة إنما سوفت</span><bdi dir="ltr" style="unicode-bidi:isolate;white-space:nowrap"> | 772217218 - 784795104</bdi></footer>`;
}

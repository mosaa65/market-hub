import type { InvoiceDoc } from "./pdf";
import {
  InvoiceLabels,
  InvoiceTemplateId,
  renderInvoiceHTML,
  UnifiedInvoiceData,
  DEFAULT_BRANDING,
} from "./templates";

export type { InvoiceLabels as Labels };
export type InvoiceTemplate = InvoiceTemplateId;

export function printInvoice(
  doc: InvoiceDoc | UnifiedInvoiceData,
  template: InvoiceTemplate,
  labels: InvoiceLabels,
  rtl: boolean,
) {
  // Ensure default branding is present
  const fullDoc: UnifiedInvoiceData = {
    ...doc,
    brandingText: doc.brandingText || DEFAULT_BRANDING,
  };

  const html = renderInvoiceHTML(template, fullDoc, labels, rtl);

  // Always use a hidden iframe — never open a new tab/window
  const iframe = document.createElement("iframe");
  iframe.style.cssText =
    "position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;border:0;visibility:hidden;";
  document.body.appendChild(iframe);

  const cw = iframe.contentWindow!;
  cw.document.open();
  cw.document.write(html);
  cw.document.close();

  // Wait for fonts / images to load then print silently
  const delay = template === "elegant" ? 600 : 300;
  setTimeout(() => {
    try {
      cw.focus();
      cw.print();
    } finally {
      // Remove iframe after the print dialog is dismissed
      setTimeout(() => {
        try {
          document.body.removeChild(iframe);
        } catch {
          /* already removed */
        }
      }, 2000);
    }
  }, delay);
}

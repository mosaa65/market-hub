import type { InvoiceDoc } from "./pdf";
import {
  InvoiceLabels,
  InvoiceTemplateId,
  UnifiedInvoiceData,
  getPrintSettings,
} from "./templates";
import { printUnifiedDocument } from "./printing";

export type { InvoiceLabels as Labels };
export type InvoiceTemplate = InvoiceTemplateId;

export function printInvoice(
  doc: InvoiceDoc | UnifiedInvoiceData,
  template: InvoiceTemplate,
  labels: InvoiceLabels,
  rtl: boolean,
) {
  // Honour the existing legacy off switch while the unified store migrates.
  if (getPrintSettings().printMode === "off") return;

  // Company identity comes from Company Profile — never from a constant here.
  const fullDoc = doc as UnifiedInvoiceData;

  // Route invoices through the shared engine; the document snapshot is reused.
  void printUnifiedDocument({
    doc: fullDoc,
    documentType: fullDoc.docType ?? "customer_invoice",
    templateId: template,
    labels,
    rtl,
  });
}

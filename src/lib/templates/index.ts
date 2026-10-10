import {
  InvoiceTemplateId,
  PrintTemplateMeta,
  TemplateRenderer,
  UnifiedDocumentData,
  InvoiceLabels,
  DocumentType,
  PrintJobItem,
  CustomFieldOptions,
  PrintProfile,
} from "./types";
import {
  PAPER_PROFILES,
  paperCss,
  paperProfileForLegacySize,
  type PaperProfileId,
} from "./paper-profiles";
import { renderThermalTemplate } from "./thermal";
import { renderThermalMillingTemplate } from "./thermal-milling";
import { renderThermalQrTemplate } from "./thermal-qr";
import { renderMillingCleanTemplate } from "./milling-clean";
import { renderStandardTemplate } from "./standard";
import { renderElegantTemplate } from "./elegant";
import { renderInventoryThermalTemplate, renderInventoryStandardTemplate } from "./inventory";
import { getPrintSettings } from "./settings-store";
import { renderFormalTemplate } from "@/lib/printing/formal";

export * from "./types";
export * from "./settings-store";
export * from "./paper-profiles";
export { renderThermalTemplate } from "./thermal";
export { renderThermalMillingTemplate } from "./thermal-milling";
export { renderThermalQrTemplate } from "./thermal-qr";
export { renderMillingCleanTemplate } from "./milling-clean";
export { renderStandardTemplate } from "./standard";
export { renderElegantTemplate } from "./elegant";
export { renderInventoryThermalTemplate, renderInventoryStandardTemplate } from "./inventory";
export { renderFormalTemplate } from "@/lib/printing/formal";
export { numberToArabicWords } from "./tafqeet";

interface RegisteredTemplate {
  meta: PrintTemplateMeta;
  renderer: TemplateRenderer;
}

const templateRegistry = new Map<InvoiceTemplateId, RegisteredTemplate>();

/**
 * Register a new print template dynamically for any document type
 */
export function registerTemplate(meta: PrintTemplateMeta, renderer: TemplateRenderer): void {
  templateRegistry.set(meta.id, { meta, renderer });
}

/**
 * Get registered template renderer
 */
export function getTemplateRenderer(
  id: InvoiceTemplateId,
  docType?: DocumentType,
): TemplateRenderer {
  // If document is an inventory document and default thermal/standard requested, use specialized inventory layout
  if (docType === "inventory_document") {
    if (id === "thermal") return renderInventoryThermalTemplate;
    if (id === "standard" || id === "elegant" || id === "unified-modern")
      return renderInventoryStandardTemplate;
  }
  if (id === "thermal-milling") return renderThermalMillingTemplate;
  if (id === "thermal-qr") return renderThermalQrTemplate;
  if (id === "milling-clean") return renderMillingCleanTemplate;
  if (id === "formal")
    return (doc, labels, rtl, options) => renderFormalTemplate(doc, labels, rtl, options);

  const registered = templateRegistry.get(id);
  if (registered) {
    return registered.renderer;
  }

  // Default customer invoice fallbacks
  switch (id) {
    case "thermal-milling":
      return renderThermalMillingTemplate;
    case "thermal-qr":
      return renderThermalQrTemplate;
    case "milling-clean":
      return renderMillingCleanTemplate;
    case "thermal":
      return renderThermalTemplate;
    case "elegant":
      return renderElegantTemplate;
    case "unified-modern":
      return renderStandardTemplate;
    case "formal":
      return (doc, labels, rtl, options) => renderFormalTemplate(doc, labels, rtl, options);
    case "standard":
    default:
      return renderStandardTemplate;
  }
}

/**
 * Get list of all available print templates
 */
export function getAvailableTemplates(): PrintTemplateMeta[] {
  return Array.from(templateRegistry.values()).map((t) => t.meta);
}

export function getTemplateMeta(id: InvoiceTemplateId): PrintTemplateMeta | undefined {
  return templateRegistry.get(id)?.meta;
}

export function getCompatibleTemplates(
  documentType: DocumentType,
  paperProfileId?: PaperProfileId,
): PrintTemplateMeta[] {
  return getAvailableTemplates().filter((template) => {
    const supportsDocument =
      !template.supportedDocTypes || template.supportedDocTypes.includes(documentType);
    const supportsPaper =
      !paperProfileId || template.supportedPaperProfiles.includes(paperProfileId);
    return supportsDocument && supportsPaper;
  });
}

export function resolvePrintProfile(
  documentType: DocumentType,
  templateId?: InvoiceTemplateId,
  paperProfileId?: PaperProfileId,
): PrintProfile {
  const settings = getPrintSettings();
  const requestedTemplate =
    templateId ||
    (documentType === "inventory_document"
      ? settings.defaultInventoryTemplate
      : settings.defaultCustomerTemplate);
  const legacyPaper = paperProfileForLegacySize(settings.paperSize);
  const requested = templateRegistry.get(requestedTemplate);
  const compatible = getCompatibleTemplates(documentType);
  const template =
    requested &&
    (!requested.meta.supportedDocTypes || requested.meta.supportedDocTypes.includes(documentType))
      ? requested.meta
      : compatible[0] || templateRegistry.get("thermal")!.meta;
  const storedPaper =
    documentType === "inventory_document"
      ? settings.defaultInventoryPaperProfile
      : settings.defaultCustomerPaperProfile;
  const requestedPaper =
    paperProfileId ||
    storedPaper ||
    (template.supportedPaperProfiles.includes(legacyPaper)
      ? legacyPaper
      : template.supportedPaperProfiles[0]);
  const resolvedPaper = template.supportedPaperProfiles.includes(requestedPaper)
    ? requestedPaper
    : template.supportedPaperProfiles[0];

  return { documentType, templateId: template.id, paperProfileId: resolvedPaper };
}

const ALL_SUPPORTED_DOC_TYPES: DocumentType[] = [
  "customer_invoice",
  "purchase_invoice",
  "sales_return",
  "purchase_return",
  "stock_transfer",
  "stock_receipt",
  "stock_issue",
  "payment_receipt",
  "quotation",
  "delivery_note",
  "inventory_document",
];

// Register built-in default templates
registerTemplate(
  {
    id: "thermal-milling",
    // الاسم المؤسسي المعروض — يُحفظ المعرّف "thermal-milling" كما هو
    // لأن الإعدادات والمخازن والتجاوزات المحفوظة تعتمد عليه.
    nameAr: "قالب الإيصال الحراري الاحترافي",
    nameEn: "Professional Thermal Receipt",
    category: "thermal",
    paperSize: "80mm",
    supportedPaperProfiles: ["thermal-80", "thermal-58"],
    supportedDocTypes: ALL_SUPPORTED_DOC_TYPES,
  },
  renderThermalMillingTemplate,
);

registerTemplate(
  {
    id: "thermal",
    nameAr: "قالب إيصال نقطة البيع",
    nameEn: "Point-of-Sale Receipt",
    category: "thermal",
    paperSize: "80mm",
    supportedPaperProfiles: ["thermal-80", "thermal-58"],
    supportedDocTypes: ALL_SUPPORTED_DOC_TYPES,
  },
  renderThermalTemplate,
);

registerTemplate(
  {
    id: "thermal-qr",
    nameAr: "قالب الإيصال مع باركود و QR",
    nameEn: "Thermal QR & Barcode",
    category: "thermal",
    paperSize: "80mm",
    supportedPaperProfiles: ["thermal-80", "thermal-58"],
    supportedDocTypes: ALL_SUPPORTED_DOC_TYPES,
  },
  renderThermalQrTemplate,
);

registerTemplate(
  {
    id: "milling-clean",
    nameAr: "قالب الفاتورة الرسمية المبسطة",
    nameEn: "Simplified Official Invoice",
    category: "standard",
    paperSize: "A4",
    supportedPaperProfiles: ["a4", "a5"],
    supportedDocTypes: ALL_SUPPORTED_DOC_TYPES,
  },
  renderMillingCleanTemplate,
);

registerTemplate(
  {
    id: "standard",
    nameAr: "قالب مؤسسي قياسي",
    nameEn: "Standard Corporate",
    category: "standard",
    paperSize: "A4",
    supportedPaperProfiles: ["a4", "a5"],
    supportedDocTypes: ALL_SUPPORTED_DOC_TYPES,
  },
  renderStandardTemplate,
);

registerTemplate(
  {
    id: "elegant",
    nameAr: "قالب تنفيذي فاخر",
    nameEn: "Executive Luxury",
    category: "standard",
    paperSize: "A4",
    supportedPaperProfiles: ["a4", "a5"],
    supportedDocTypes: ALL_SUPPORTED_DOC_TYPES,
  },
  renderElegantTemplate,
);

registerTemplate(
  {
    id: "formal",
    nameAr: "قالب رسمي معتمد",
    nameEn: "Formal Corporate",
    category: "standard",
    paperSize: "A4",
    supportedPaperProfiles: ["a4", "a5"],
    supportedDocTypes: ALL_SUPPORTED_DOC_TYPES,
  },
  (doc, labels, rtl, options) => renderFormalTemplate(doc, labels, rtl, options),
);

/**
 * Render document HTML string given document type, template ID, and customization options
 */
export function renderDocumentHTML(
  doc: UnifiedDocumentData,
  templateId?: InvoiceTemplateId,
  labels?: Partial<InvoiceLabels>,
  rtl = true,
  options?: CustomFieldOptions,
  paperProfileId?: PaperProfileId,
): string {
  const settings = getPrintSettings();
  const effectiveTemplateId =
    templateId ||
    (doc.docType === "inventory_document"
      ? settings.defaultInventoryTemplate
      : settings.defaultCustomerTemplate);

  const mergedLabels: InvoiceLabels = {
    invoice: rtl ? "فاتورة مبيعات" : "Invoice",
    date: rtl ? "التاريخ" : "Date",
    billTo: rtl ? "العميل" : "Bill To",
    warehouse: rtl ? "المستودع" : "Warehouse",
    payment: rtl ? "طريقة الدفع" : "Payment Method",
    status: rtl ? "الحالة" : "Status",
    product: rtl ? "المنتج" : "Product",
    qty: rtl ? "الكمية" : "Qty",
    price: rtl ? "السعر" : "Price",
    total: rtl ? "الإجمالي" : "Total",
    subtotal: rtl ? "المجموع الفرعي" : "Subtotal",
    tax: rtl ? "الضريبة" : "Tax",
    discount: rtl ? "الخصم" : "Discount",
    grandTotal: rtl ? "الإجمالي النهائي" : "Grand Total",
    paid: rtl ? "المدفوع" : "Paid",
    balance: rtl ? "المتبقي" : "Balance",
    thanks: rtl ? "شكرًا لتعاملكم معنا" : "Thank you for your business",
    poweredBy: "",
    ...labels,
  };

  // Precedence: legacy settings (defaults) → document snapshot → explicit
  // caller options. The caller must always win, otherwise a preview that
  // disables the footer cannot honour its own request.
  const mergedOptions: CustomFieldOptions = {
    ...settings,
    ...doc.options,
    ...options,
  };

  const profile = resolvePrintProfile(
    doc.docType || "customer_invoice",
    effectiveTemplateId,
    paperProfileId,
  );
  const renderer = getTemplateRenderer(profile.templateId, doc.docType);
  const html = renderer(doc, mergedLabels, rtl, mergedOptions);
  return html
    .replace(
      "</head>",
      `<style data-print-profile="${profile.paperProfileId}">${paperCss(PAPER_PROFILES[profile.paperProfileId])}</style></head>`,
    )
    .replace(/\s+onload="[^"]*"/gi, "");
}

/**
 * Backward compatible renderInvoiceHTML
 */
export function renderInvoiceHTML(
  firstArg: InvoiceTemplateId | UnifiedDocumentData,
  secondArg?: UnifiedDocumentData | InvoiceTemplateId,
  labels?: Partial<InvoiceLabels>,
  rtl = true,
  options?: CustomFieldOptions,
): string {
  if (typeof firstArg === "string") {
    // Legacy signature: renderInvoiceHTML(templateId, doc, labels, rtl)
    const templateId = firstArg;
    const doc = secondArg as UnifiedDocumentData;
    return renderDocumentHTML(doc, templateId, labels, rtl, options);
  } else {
    // New signature: renderInvoiceHTML(doc, templateId, labels, rtl, options)
    const doc = firstArg;
    const templateId = secondArg as InvoiceTemplateId;
    return renderDocumentHTML(doc, templateId, labels, rtl, options);
  }
}

/**
 * Dispatch a single document print task via a hidden iframe
 */
export function printDocument(
  doc: UnifiedDocumentData,
  templateId?: InvoiceTemplateId,
  labels?: Partial<InvoiceLabels>,
  rtl = true,
  options?: CustomFieldOptions,
  paperProfileId?: PaperProfileId,
): void {
  // Respect the global "no printing" mode unless the caller forces a print
  const settings = getPrintSettings();
  if (settings.printMode === "off") {
    return;
  }

  const html = renderDocumentHTML(doc, templateId, labels, rtl, options, paperProfileId);

  const iframe = document.createElement("iframe");
  iframe.style.cssText =
    "position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;border:0;visibility:hidden;";
  document.body.appendChild(iframe);

  const cw = iframe.contentWindow!;
  cw.document.open();
  cw.document.write(html);
  cw.document.close();

  const delay = templateId === "elegant" ? 550 : 250;
  setTimeout(() => {
    try {
      cw.focus();
      cw.print();
    } finally {
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

/**
 * Multi-Document Print Job Manager:
 * Print multiple documents sequentially (e.g. Customer Invoice + Inventory Document)
 */
export function printJob(items: PrintJobItem[], labels?: Partial<InvoiceLabels>, rtl = true): void {
  if (!items || items.length === 0) return;

  const settings = getPrintSettings();
  if (settings.printMode === "off") return;

  // Honour the per-document auto-print switches so the print job matches the
  // configured architecture (customer invoice and/or inventory document).
  const allowed = items.filter((item) => {
    const isInventory = item.doc.docType === "inventory_document";
    return isInventory ? settings.autoPrintInventoryDocument : settings.autoPrintCustomerInvoice;
  });

  if (allowed.length === 0) return;

  allowed.forEach((item, index) => {
    setTimeout(() => {
      printDocument(item.doc, item.templateId, labels, rtl);
    }, index * 1000);
  });
}

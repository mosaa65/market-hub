import {
  InvoiceTemplateId,
  PrintTemplateMeta,
  TemplateRenderer,
  UnifiedInvoiceData,
  InvoiceLabels,
} from "./types";
import { renderThermalTemplate } from "./thermal";
import { renderStandardTemplate } from "./standard";
import { renderElegantTemplate } from "./elegant";

export * from "./types";
export { renderThermalTemplate } from "./thermal";
export { renderStandardTemplate } from "./standard";
export { renderElegantTemplate } from "./elegant";

interface RegisteredTemplate {
  meta: PrintTemplateMeta;
  renderer: TemplateRenderer;
}

const templateRegistry = new Map<InvoiceTemplateId, RegisteredTemplate>();

/**
 * Register a new print template dynamically
 */
export function registerTemplate(meta: PrintTemplateMeta, renderer: TemplateRenderer): void {
  templateRegistry.set(meta.id, { meta, renderer });
}

/**
 * Get registered template renderer
 */
export function getTemplateRenderer(id: InvoiceTemplateId): TemplateRenderer {
  const registered = templateRegistry.get(id);
  if (registered) {
    return registered.renderer;
  }
  // Default fallbacks
  switch (id) {
    case "thermal":
      return renderThermalTemplate;
    case "elegant":
      return renderElegantTemplate;
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

// Register built-in default templates
registerTemplate(
  {
    id: "thermal",
    nameAr: "حراري (POS 80mm)",
    nameEn: "Thermal (POS 80mm)",
    category: "thermal",
    paperSize: "80mm",
  },
  renderThermalTemplate,
);

registerTemplate(
  {
    id: "standard",
    nameAr: "قياسي (A4)",
    nameEn: "Standard (A4)",
    category: "standard",
    paperSize: "A4",
  },
  renderStandardTemplate,
);

registerTemplate(
  {
    id: "elegant",
    nameAr: "أنيق (A4)",
    nameEn: "Elegant (A4)",
    category: "standard",
    paperSize: "A4",
  },
  renderElegantTemplate,
);

/**
 * Render invoice HTML string given a template ID
 */
export function renderInvoiceHTML(
  templateId: InvoiceTemplateId,
  doc: UnifiedInvoiceData,
  labels: InvoiceLabels,
  rtl: boolean,
): string {
  const renderer = getTemplateRenderer(templateId);
  return renderer(doc, labels, rtl);
}

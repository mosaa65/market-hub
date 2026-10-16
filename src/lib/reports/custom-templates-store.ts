import type { ReportDefinition, ReportDomain, ReportViewTemplateType } from "./types";
import { ReportRegistry } from "./registry";

export interface CustomReportTemplate {
  id: string;
  name: string;
  domain: ReportDomain;
  baseReportId: string;
  groupBy: "product" | "customer" | "branch" | "warehouse" | "payment_method";
  secondaryFilter?: {
    key: string;
    value: string;
    label: string;
  };
  viewTemplate: ReportViewTemplateType;
  visibleColumns?: string[];
  description?: string;
  createdAt: string;
}

const STORAGE_KEY = "vortex_custom_report_templates";

export function getCustomTemplates(domain?: ReportDomain): CustomReportTemplate[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: CustomReportTemplate[] = JSON.parse(raw);
    if (domain) {
      return parsed.filter((t) => t.domain === domain);
    }
    return parsed;
  } catch (err) {
    console.error("Failed to read custom templates:", err);
    return [];
  }
}

export function saveCustomTemplate(
  data: Omit<CustomReportTemplate, "id" | "createdAt">,
): CustomReportTemplate {
  const current = getCustomTemplates();
  const newTemplate: CustomReportTemplate = {
    ...data,
    id: `custom-tpl-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    createdAt: new Date().toISOString(),
  };

  const updated = [newTemplate, ...current];
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  } catch (err) {
    console.error("Failed to save custom template:", err);
  }
  return newTemplate;
}

export function deleteCustomTemplate(id: string): void {
  const current = getCustomTemplates();
  const updated = current.filter((t) => t.id !== id);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  } catch (err) {
    console.error("Failed to delete custom template:", err);
  }
}

/**
 * يحول القالب المخصص إلى ReportDefinition كامل متوافق مع النظام
 */
export function customTemplateToReportDefinition(tpl: CustomReportTemplate): ReportDefinition {
  const baseReport = ReportRegistry.get(tpl.baseReportId) || ReportRegistry.getAll()[0];

  const columns = baseReport.columns.map((col) => {
    if (tpl.visibleColumns && tpl.visibleColumns.length > 0) {
      return {
        ...col,
        defaultVisible: tpl.visibleColumns.includes(col.key),
      };
    }
    return col;
  });

  // أي قالب مخصص يجمع عدة طرق يعتبر قالباً تجميعياً افتراضياً
  const viewTemplate: ReportViewTemplateType =
    tpl.viewTemplate === "detailed_table" || tpl.viewTemplate === "chart"
      ? tpl.viewTemplate
      : "grouped";

  const def: ReportDefinition & { customGroupBy?: string; isCustomMultiMethod?: boolean } = {
    ...baseReport,
    id: tpl.id,
    titleAr: tpl.name,
    titleEn: tpl.name,
    descriptionAr: tpl.description || `قالب مخصص: ${tpl.name}`,
    viewTemplate,
    columns,
    customGroupBy: tpl.groupBy,
    isCustomMultiMethod: true,
  };

  return def;
}

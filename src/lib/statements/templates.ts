/**
 * Statement Templates — وصف القوالب لا حسابها
 *
 * ⚠️ قاعدة صارمة: القالب لا يحسب أي رقم. يستهلك StatementResult فقط
 * ويُنتج StatementLayout (أعمدة + تسميات + أعلام إظهار/إخفاء).
 *
 * قرار المستخدم #5: قالب طباعة مستقل (statement-print) لا توسيع printReport.
 */

import type {
  StatementColumn,
  StatementEntityType,
  StatementFieldKey,
  StatementLayout,
  StatementResult,
  StatementTemplateId,
} from "./types";
import { resolveFieldLabel, visibleFields, type StatementSettings } from "./settings";

// ---------------------------------------------------------------------------
// تعريفات القوالب — أي تعديل هنا لا يمسّ الحساب إطلاقًا
// ---------------------------------------------------------------------------

interface TemplateDefinition {
  id: StatementTemplateId;
  titleKey: keyof StatementSettings["reportTitles"];
  subtitleAr: string;
  subtitleEn: string;
  /** الأعمدة المسموحة بهذا القالب — تُفلتر بحسب إعدادات المستخدم */
  allowedFields: StatementFieldKey[];
  showOpeningRow: boolean;
  showSummaryCards: boolean;
  showSignatures: boolean;
  showTotalsRow: boolean;
  showNotes: boolean;
  showBrandFooter: boolean;
  /** القوالب المخصّصة لأنواع جهات معيّنة */
  entityHints?: StatementEntityType[];
}

export const STATEMENT_TEMPLATES: Record<StatementTemplateId, TemplateDefinition> = {
  detailed: {
    id: "detailed",
    titleKey: "customer",
    subtitleAr: "كشف حركة حساب تفصيلي",
    subtitleEn: "Detailed Account Movement Statement",
    allowedFields: [
      "index",
      "date",
      "reference",
      "kind",
      "description",
      "debit",
      "credit",
      "balance",
      "paymentMethod",
    ],
    showOpeningRow: true,
    showSummaryCards: true,
    showSignatures: true,
    showTotalsRow: true,
    showNotes: true,
    showBrandFooter: true,
  },
  compact: {
    id: "compact",
    titleKey: "customer",
    subtitleAr: "كشف حساب مختصر",
    subtitleEn: "Compact Account Statement",
    allowedFields: ["date", "reference", "description", "debit", "credit", "balance"],
    showOpeningRow: true,
    showSummaryCards: false,
    showSignatures: false,
    showTotalsRow: true,
    showNotes: false,
    showBrandFooter: true,
  },
  customer: {
    id: "customer",
    titleKey: "customer",
    subtitleAr: "كشف حساب عميل تفصيلي",
    subtitleEn: "Customer Detailed Statement",
    allowedFields: [
      "index",
      "date",
      "reference",
      "kind",
      "description",
      "debit",
      "credit",
      "balance",
      "paymentMethod",
    ],
    showOpeningRow: true,
    showSummaryCards: true,
    showSignatures: true,
    showTotalsRow: true,
    showNotes: true,
    showBrandFooter: true,
    entityHints: ["customer"],
  },
  supplier: {
    id: "supplier",
    titleKey: "supplier",
    subtitleAr: "كشف حساب مورد تفصيلي",
    subtitleEn: "Supplier Detailed Statement",
    allowedFields: [
      "index",
      "date",
      "reference",
      "kind",
      "description",
      "debit",
      "credit",
      "balance",
      "paymentMethod",
    ],
    showOpeningRow: true,
    showSummaryCards: true,
    showSignatures: true,
    showTotalsRow: true,
    showNotes: true,
    showBrandFooter: true,
    entityHints: ["supplier"],
  },
  debts: {
    id: "debts",
    titleKey: "debts",
    subtitleAr: "كشف الديون والمستحقات",
    subtitleEn: "Outstanding Debts Statement",
    allowedFields: ["index", "date", "reference", "description", "debit", "credit", "balance"],
    showOpeningRow: false,
    showSummaryCards: true,
    showSignatures: false,
    showTotalsRow: true,
    showNotes: false,
    showBrandFooter: true,
  },
};

export const TEMPLATE_ORDER: StatementTemplateId[] = [
  "detailed",
  "compact",
  "customer",
  "supplier",
  "debts",
];

/** عرض كل عمود + محاذاته */
const COLUMN_META: Record<
  StatementFieldKey,
  Pick<StatementColumn, "align" | "format" | "width">
> = {
  index: { align: "center", format: "number", width: "42px" },
  date: { align: "start", format: "text", width: "92px" },
  reference: { align: "start", format: "text", width: "110px" },
  kind: { align: "start", format: "text", width: "118px" },
  description: { align: "start", format: "text" },
  debit: { align: "end", format: "money", width: "110px" },
  credit: { align: "end", format: "money", width: "110px" },
  balance: { align: "end", format: "money", width: "118px" },
  paymentMethod: { align: "start", format: "text", width: "96px" },
};

export interface ResolveLayoutOptions {
  result: StatementResult;
  settings: StatementSettings;
  templateId?: StatementTemplateId;
  lang: "ar" | "en";
}

/**
 * دمج نتيجة الكشف + إعدادات المستخدم + تعريف القالب → وصف عرض جاهز.
 * لا حساب مالي هنا مطلقًا.
 */
export function resolveStatementLayout(options: ResolveLayoutOptions): StatementLayout {
  const { result, settings, lang } = options;
  const templateId = options.templateId ?? settings.defaultTemplate;
  const template = STATEMENT_TEMPLATES[templateId] ?? STATEMENT_TEMPLATES.detailed;

  // 1) نأخذ الحقول المرئية من إعدادات المستخدم بترتيبها المخصص
  const userFields = visibleFields(settings);

  // 2) نُبقي منها ما هو مسموح به في هذا القالب
  const columns: StatementColumn[] = userFields
    .filter((f) => template.allowedFields.includes(f.key))
    .map((f) => ({
      key: f.key,
      label: resolveFieldLabel(settings, f.key, lang),
      ...COLUMN_META[f.key],
    }));

  // 3) ضمان أن الأعمدة المالية الأساسية موجودة دائمًا حتى لا يفقد الكشف معناه
  const essentials: StatementFieldKey[] = ["debit", "credit", "balance"];
  for (const key of essentials) {
    if (!columns.some((c) => c.key === key)) {
      columns.push({
        key,
        label: resolveFieldLabel(settings, key, lang),
        ...COLUMN_META[key],
      });
    }
  }

  const titleOverride = settings.reportTitles[template.titleKey]?.trim();
  const defaultTitle =
    lang === "ar"
      ? (titleOverride ?? STATEMENT_TEMPLATES.detailed.titleKey)
      : (titleOverride ?? "Account Statement");

  return {
    templateId,
    title: defaultTitle || (lang === "ar" ? "كشف حساب" : "Account Statement"),
    subtitle: lang === "ar" ? template.subtitleAr : template.subtitleEn,
    columns,
    showOpeningRow: template.showOpeningRow,
    showSummaryCards: template.showSummaryCards,
    showSignatures: template.showSignatures && settings.footer.showSignatures,
    showTotalsRow: template.showTotalsRow && settings.footer.showTotals,
    showNotes: template.showNotes && settings.footer.showNotes,
    showBrandFooter: template.showBrandFooter && settings.footer.showBrandFooter,
    header: settings.header,
    notesText: settings.footer.notesText,
    footerNote: settings.footer.footerNote || "",
  };
}

/**
 * حسم القالب الافتراضي بحسب نوع الجهة عند عدم اختيار المستخدم.
 * عميل → customer · مورد → supplier · صندوق → detailed
 */
export function defaultTemplateFor(entityType: StatementEntityType): StatementTemplateId {
  if (entityType === "customer") return "customer";
  if (entityType === "supplier") return "supplier";
  return "detailed";
}

/** تسمية قالب جاهزة للعرض في القوائم */
export function templateLabel(id: StatementTemplateId, lang: "ar" | "en"): string {
  const arLabels: Record<StatementTemplateId, string> = {
    detailed: "مفصّل (افتراضي)",
    compact: "مختصر",
    customer: "كشف عميل",
    supplier: "كشف مورد",
    debts: "كشف ديون",
  };
  const enLabels: Record<StatementTemplateId, string> = {
    detailed: "Detailed (default)",
    compact: "Compact",
    customer: "Customer",
    supplier: "Supplier",
    debts: "Debts",
  };
  return (lang === "ar" ? arLabels : enLabels)[id];
}

/**
 * الأعمدة القابلة للإظهار/الإخفاء داخل قالب معيّن — تُستخدم في لوحة
 * التصدير والإعدادات لتوضيح ما سيظهر فعلًا.
 */
export function availableFieldsForTemplate(
  templateId: StatementTemplateId,
  lang: "ar" | "en",
): { key: StatementFieldKey; label: string }[] {
  const template = STATEMENT_TEMPLATES[templateId] ?? STATEMENT_TEMPLATES.detailed;
  return template.allowedFields.map((key) => ({
    key,
    label: resolveFieldLabel(DEFAULT_SETTINGS_FOR_LABELS, key, lang),
  }));
}

/** إعدادات افتراضية ثابتة للتسميات فقط (لتجنب استيراد دائري) */
import { DEFAULT_STATEMENT_SETTINGS } from "./settings";
const DEFAULT_SETTINGS_FOR_LABELS = DEFAULT_STATEMENT_SETTINGS;

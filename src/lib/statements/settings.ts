/**
 * Statement Customization Settings
 *
 * آلية الحفظ تُعيد استخدام النمط الموجود في src/lib/catalog-modules.ts حرفيًا:
 *   localStorage (فوري)  ←→  company_settings.catalog_modules (عمود jsonb موجود)
 *
 * ⚠️ لا نُضيف عمودًا جديدًا. نضيف مفتاح `statements` داخل حاوية JSON قائمة،
 * وهو استخدام مشروع لنوع jsonb حر بلا أي تغيير Schema.
 *
 * قرار المستخدم #3: نعم — استخدام catalog_modules كحاوية.
 */

import { useEffect, useState } from "react";
import { untypedTable } from "./untyped";
import type { StatementFieldKey, StatementTemplateId } from "./types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StatementFieldSetting {
  key: StatementFieldKey;
  /** التسمية المخصصة — فارغة تعني استخدام التسمية الافتراضية */
  label: string;
  visible: boolean;
}

export interface StatementSettings {
  version: 1;
  defaultTemplate: StatementTemplateId;
  /** ترتيب الأعمدة — مصدر الحقيقة للترتيب */
  fields: StatementFieldSetting[];
  reportTitles: {
    customer: string;
    supplier: string;
    cash: string;
    debts: string;
    aging: string;
  };
  header: {
    showLogo: boolean;
    showLegalName: boolean;
    showTaxNumber: boolean;
    showAddress: boolean;
    showPhone: boolean;
    customLine: string;
  };
  footer: {
    showTotals: boolean;
    showClosingBalance: boolean;
    showSignatures: boolean;
    showNotes: boolean;
    showGeneratedStamp: boolean;
    showBrandFooter: boolean;
    notesText: string;
    footerNote: string;
  };
  /** تجاوز رمز العملة — فارغ يعني استخدام company_settings.currency_symbol */
  currencySymbolOverride: string;
  includeZeroRowsDefault: boolean;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

export const DEFAULT_FIELD_LABELS: Record<StatementFieldKey, { ar: string; en: string }> = {
  index: { ar: "#", en: "#" },
  date: { ar: "التاريخ", en: "Date" },
  reference: { ar: "المرجع", en: "Reference" },
  kind: { ar: "نوع العملية", en: "Type" },
  description: { ar: "البيان", en: "Description" },
  debit: { ar: "مدين", en: "Debit" },
  credit: { ar: "دائن", en: "Credit" },
  balance: { ar: "الرصيد", en: "Balance" },
  paymentMethod: { ar: "طريقة الدفع", en: "Method" },
};

export const DEFAULT_STATEMENT_SETTINGS: StatementSettings = {
  version: 1,
  defaultTemplate: "detailed",
  fields: [
    { key: "index", label: "", visible: true },
    { key: "date", label: "", visible: true },
    { key: "reference", label: "", visible: true },
    { key: "kind", label: "", visible: true },
    { key: "description", label: "", visible: true },
    { key: "debit", label: "", visible: true },
    { key: "credit", label: "", visible: true },
    { key: "balance", label: "", visible: true },
    { key: "paymentMethod", label: "", visible: false },
  ],
  reportTitles: {
    customer: "كشف حساب عميل",
    supplier: "كشف حساب مورد",
    cash: "كشف حركة الصندوق والبنك",
    debts: "كشف الديون والمستحقات",
    aging: "كشف أعمار الديون",
  },
  header: {
    showLogo: true,
    showLegalName: true,
    showTaxNumber: true,
    showAddress: true,
    showPhone: true,
    customLine: "",
  },
  footer: {
    showTotals: true,
    showClosingBalance: true,
    showSignatures: true,
    showNotes: true,
    showGeneratedStamp: true,
    showBrandFooter: true,
    notesText: "",
    footerNote: "",
  },
  currencySymbolOverride: "",
  includeZeroRowsDefault: false,
};

// ---------------------------------------------------------------------------
// Storage — نفس نمط catalog-modules.ts
// ---------------------------------------------------------------------------

const STORAGE_KEY = "vortex_statement_settings_v1";
const EVENT_NAME = "vortex_statement_settings_changed";

/** الحاوية الموجودة في قاعدة البيانات — لا عمود جديد */
const CLOUD_CONTAINER_COLUMN = "catalog_modules" as const;
const CLOUD_CONTAINER_KEY = "statements" as const;

function normalize(raw: unknown): StatementSettings {
  if (!raw || typeof raw !== "object") return DEFAULT_STATEMENT_SETTINGS;
  const partial = raw as Partial<StatementSettings>;

  // دمج الأعمدة مع الحفاظ على أي حقل جديد أضفناه مستقبلًا
  const incomingFields = Array.isArray(partial.fields) ? partial.fields : [];
  const mergedFields: StatementFieldSetting[] = [];
  for (const def of DEFAULT_STATEMENT_SETTINGS.fields) {
    const found = incomingFields.find((f) => f && f.key === def.key);
    mergedFields.push({
      key: def.key,
      label: typeof found?.label === "string" ? found.label : def.label,
      visible: typeof found?.visible === "boolean" ? found.visible : def.visible,
    });
  }
  // أضف أي حقل مخصص لم نعرفه (حماية من فقدان الإعدادات)
  for (const extra of incomingFields) {
    if (extra && !mergedFields.some((f) => f.key === extra.key)) {
      mergedFields.push({
        key: extra.key,
        label: extra.label ?? "",
        visible: extra.visible ?? true,
      });
    }
  }

  return {
    version: 1,
    defaultTemplate: partial.defaultTemplate ?? DEFAULT_STATEMENT_SETTINGS.defaultTemplate,
    fields: mergedFields,
    reportTitles: { ...DEFAULT_STATEMENT_SETTINGS.reportTitles, ...(partial.reportTitles ?? {}) },
    header: { ...DEFAULT_STATEMENT_SETTINGS.header, ...(partial.header ?? {}) },
    footer: { ...DEFAULT_STATEMENT_SETTINGS.footer, ...(partial.footer ?? {}) },
    currencySymbolOverride:
      partial.currencySymbolOverride ?? DEFAULT_STATEMENT_SETTINGS.currencySymbolOverride,
    includeZeroRowsDefault:
      partial.includeZeroRowsDefault ?? DEFAULT_STATEMENT_SETTINGS.includeZeroRowsDefault,
  };
}

/** القراءة المتزامنة (SSR-safe) */
export function getStatementSettings(): StatementSettings {
  if (typeof window === "undefined") return DEFAULT_STATEMENT_SETTINGS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_STATEMENT_SETTINGS;
    return normalize(JSON.parse(raw));
  } catch {
    return DEFAULT_STATEMENT_SETTINGS;
  }
}

/** الحفظ: محلي فوري + مزامنة سحابية داخل عمود JSONB موجود */
export function saveStatementSettings(next: StatementSettings): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: next }));
    void syncSettingsToCloud(next);
  } catch (err) {
    console.error("Failed to save statement settings:", err);
  }
}

export function resetStatementSettings(): StatementSettings {
  const defaults = { ...DEFAULT_STATEMENT_SETTINGS };
  saveStatementSettings(defaults);
  return defaults;
}

async function readCloudContainer(): Promise<Record<string, unknown>> {
  const { data } = await untypedTable<Record<string, unknown>>("company_settings")
    .select(CLOUD_CONTAINER_COLUMN)
    .eq("id", 1)
    .maybeSingle();
  const container = data?.[CLOUD_CONTAINER_COLUMN];
  return container && typeof container === "object" ? (container as Record<string, unknown>) : {};
}

/**
 * المزامنة السحابية: نقرأ العمود الحالي أولًا ثم ندمج مفتاحنا — حتى لا نمحو
 * إعدادات catalog modules الخاصة بالمستخدم.
 * نستخدم واجهة غير مُقيَّدة بالأنواع لأن العمود catalog_modules موجود في
 * قاعدة البيانات لكنه غير معرّف في types.ts المولَّد.
 */
async function syncSettingsToCloud(settings: StatementSettings): Promise<void> {
  try {
    const container = await readCloudContainer();
    await untypedTable<Record<string, unknown>>("company_settings")
      .update({ [CLOUD_CONTAINER_COLUMN]: { ...container, [CLOUD_CONTAINER_KEY]: settings } })
      .eq("id", 1);
  } catch {
    // الصمت مقصود: الحفظ المحلي نجح بالفعل، والفشل السحابي لا يجب أن يُعطّل المستخدم
  }
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useStatementSettings() {
  const [settings, setSettings] = useState<StatementSettings>(() => getStatementSettings());

  useEffect(() => {
    const handler = (e: Event) => {
      const custom = e as CustomEvent<StatementSettings>;
      setSettings(custom.detail ? normalize(custom.detail) : getStatementSettings());
    };
    window.addEventListener(EVENT_NAME, handler);
    window.addEventListener("storage", handler);
    return () => {
      window.removeEventListener(EVENT_NAME, handler);
      window.removeEventListener("storage", handler);
    };
  }, []);

  // القراءة الأولية من السحابة لمزامنة الأجهزة
  useEffect(() => {
    void readCloudContainer().then(
      (container) => {
        const remote = container[CLOUD_CONTAINER_KEY];
        if (!remote) return;
        const normalized = normalize(remote);
        setSettings(normalized);
        if (typeof window !== "undefined") {
          window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
        }
      },
      () => {},
    );
  }, []);

  const update = (patch: Partial<StatementSettings>) => {
    const next = normalize({ ...settings, ...patch });
    setSettings(next);
    saveStatementSettings(next);
  };

  const setFieldLabel = (key: StatementFieldKey, label: string) => {
    const fields = settings.fields.map((f) => (f.key === key ? { ...f, label } : f));
    update({ fields });
  };

  const setFieldVisible = (key: StatementFieldKey, visible: boolean) => {
    const fields = settings.fields.map((f) => (f.key === key ? { ...f, visible } : f));
    update({ fields });
  };

  /** ترتيب جديد للأعمدة — يُستخدم مع السحب والإفلات أو أزرار التحريك */
  const setFieldOrder = (keys: StatementFieldKey[]) => {
    const byKey = new Map(settings.fields.map((f) => [f.key, f]));
    const ordered: StatementFieldSetting[] = [];
    for (const key of keys) {
      const found = byKey.get(key);
      if (found) {
        ordered.push(found);
        byKey.delete(key);
      }
    }
    // أي حقل لم يُذكر في الترتيب يبقى في النهاية
    for (const remaining of byKey.values()) ordered.push(remaining);
    update({ fields: ordered });
  };

  const moveField = (key: StatementFieldKey, direction: -1 | 1) => {
    const keys = settings.fields.map((f) => f.key);
    const index = keys.indexOf(key);
    if (index < 0) return;
    const target = index + direction;
    if (target < 0 || target >= keys.length) return;
    [keys[index], keys[target]] = [keys[target], keys[index]];
    setFieldOrder(keys);
  };

  return { settings, update, setFieldLabel, setFieldVisible, setFieldOrder, moveField };
}

/** تسمية حقل نهائية: المخصص ← الافتراضي حسب اللغة */
export function resolveFieldLabel(
  settings: StatementSettings,
  key: StatementFieldKey,
  lang: "ar" | "en",
): string {
  const custom = settings.fields.find((f) => f.key === key)?.label?.trim();
  if (custom) return custom;
  return DEFAULT_FIELD_LABELS[key][lang];
}

export function visibleFields(settings: StatementSettings): StatementFieldSetting[] {
  return settings.fields.filter((f) => f.visible);
}

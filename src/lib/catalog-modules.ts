import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * تخصيص الفهرس.
 *
 * ما كان هنا قبل: خمسة قوالب جاهزة (قطع غيار، بقالة، تجزئة، مطحنة، مخصص)
 * مع مفاتيح توافق مركبات ودرجات جودة وبلدان منشأ وماركات. لا شيء منها مُهيّأ
 * في هذا النظام، فوجوده في الإعدادات وعدٌ لا يُوفى: زر يُظهر تبويباً لا
 * محتوى له. أُبقي الأبعاد الثلاثة التي يملكها الفهرس فعلاً، ولا شيء غيرها.
 */
export interface CatalogModulesConfig {
  enableUnits: boolean; // الوحدات والعبوات
  enableGrainGrades: boolean; // درجات وأصناف الحبوب
  enablePackagingBags: boolean; // مستلزمات التعبئة والتغليف

  /**
   * تفعيل الباركود و QR فعلياً في الكاشير والفاتورة المطبوعة.
   * كان هذا المفتاح يُحفظ في `company_settings.barcode_enabled` دون أن يقرأه
   * أي مسار تشغيلي، فيبدو التفعيل بلا أثر. الآن هو مصدر الحقيقة للحالة،
   * ويكتب أيضاً في `company_settings` للتوافق مع الأجهزة الأخرى.
   */
  enableBarcode: boolean;

  /**
   * أبعاد不属于 مطحنة: ماركات وموديلات المركبات وتوافق القطع (قطع غيار)،
   * وبلدان المنشأ ودرجات الجودة والعلامات التجارية (بقالة).
   *
   * ما زالت موجودة في النوع لأن شاشات الكاشير ونقاط البيع تشترطها في كودها،
   * لكنها مُقفلة دائماً ولا تُعرض في الإعدادات ولا في الفهرس: بيانات هذه
   * المنشأة لا تحتويها أصلاً. من أراد البحث بها فعلياً يُشغّلها هنا، وإلا
   * بقيت حقولاً فارغة أمام العامل.
   */
  enableMakesAndModels?: boolean;
  enableOrigins?: boolean;
  enableQualityGrades?: boolean;
  enableBrands?: boolean;
}

const STORAGE_KEY = "vortex_catalog_modules_v1";
const EVENT_NAME = "vortex_catalog_modules_changed";

export const DEFAULT_CATALOG_CONFIG: CatalogModulesConfig = {
  enableUnits: true,
  enableGrainGrades: true,
  enablePackagingBags: true,
  enableBarcode: true,
  enableMakesAndModels: false,
  enableOrigins: false,
  enableQualityGrades: false,
  enableBrands: false,
};

const LEGACY_FLAGS = [
  "enableMakesAndModels",
  "enableOrigins",
  "enableQualityGrades",
  "enableBrands",
] as const;

/**
 * يقرأ إعداداً قديماً احتوى مفاتيح القوالب ويتجاهلها. الإعداد القديم يجب أن
 * يُترجم لا أن يُقرأ حرفياً، وإلا بقي مفتاح لا وجود له في الواجهة.
 */
function coerceConfig(raw: unknown): CatalogModulesConfig | null {
  if (typeof raw !== "object" || raw === null) return null;
  const source = raw as Record<string, unknown>;
  const pick = (key: keyof CatalogModulesConfig): boolean | undefined =>
    typeof source[key] === "boolean" ? (source[key] as boolean) : undefined;

  const units = pick("enableUnits");
  const grades = pick("enableGrainGrades");
  const bags = pick("enablePackagingBags");
  // `barcodeEnabled` اسم تاريخي مبكر — يُقرأ للترحيل فقط.
  const barcode = pick("enableBarcode") ?? (source.barcodeEnabled === true ? true : undefined);
  if (units === undefined && grades === undefined && bags === undefined && barcode === undefined)
    return null;

  const config: CatalogModulesConfig = {
    enableUnits: units ?? DEFAULT_CATALOG_CONFIG.enableUnits,
    enableGrainGrades: grades ?? DEFAULT_CATALOG_CONFIG.enableGrainGrades,
    enablePackagingBags: bags ?? DEFAULT_CATALOG_CONFIG.enablePackagingBags,
    enableBarcode: barcode ?? DEFAULT_CATALOG_CONFIG.enableBarcode,
  };
  // القوالب القديمة (قطع غيار / بقالة) لم تعد موجودة، فلا يجوز أن يعيد
  // إحياء أبعادها عبر قيمة مخزّنة من زمن القوالب.
  for (const flag of LEGACY_FLAGS) config[flag] = false;
  return config;
}

export function getCatalogModulesConfig(): CatalogModulesConfig {
  if (typeof window === "undefined") return { ...DEFAULT_CATALOG_CONFIG };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_CATALOG_CONFIG };
    const coerced = coerceConfig(JSON.parse(raw));
    if (coerced) return coerced;

    // إن بقي الإعداد القديم على القرص، امسحه: لم يبق له معنى.
    localStorage.removeItem(STORAGE_KEY);
    return { ...DEFAULT_CATALOG_CONFIG };
  } catch {
    return { ...DEFAULT_CATALOG_CONFIG };
  }
}

export function saveCatalogModulesConfig(config: CatalogModulesConfig): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
    window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: config }));

    void supabase
      .from("company_settings")
      .update({
        catalog_modules: config,
        // مزامنة علم الباركود مع عمود المنشأة المحفوظ ليكون المصدر
        // متسقاً على كل الأجهزة (كان يُحفظ ولا يُقرأ).
        barcode_enabled: config.enableBarcode,
      } as any)
      .eq("id", 1)
      .then(
        () => {},
        () => {},
      );
  } catch (err) {
    console.error("Failed to save catalog modules config:", err);
  }
}

export function useCatalogModules() {
  const [config, setConfigState] = useState<CatalogModulesConfig>(() => getCatalogModulesConfig());

  useEffect(() => {
    const handler = (e: Event) => {
      const customEvent = e as CustomEvent<CatalogModulesConfig>;
      if (customEvent.detail) {
        setConfigState(customEvent.detail);
      } else {
        setConfigState(getCatalogModulesConfig());
      }
    };
    window.addEventListener(EVENT_NAME, handler);
    window.addEventListener("storage", handler);
    return () => {
      window.removeEventListener(EVENT_NAME, handler);
      window.removeEventListener("storage", handler);
    };
  }, []);

  // الإعداد يُخزَّن في القاعدة أيضاً ليصل إلى الأجهزة الأخرى.
  useEffect(() => {
    supabase
      .from("company_settings")
      .select("catalog_modules, barcode_enabled" as any)
      .eq("id", 1)
      .maybeSingle()
      .then(({ data, error }) => {
        if (error || !data) return;
        const row = data as any;
        const remote = coerceConfig({
          ...(row.catalog_modules as Record<string, unknown> | null),
          // علم المنشأة القديم يشارك في الترحيل حين لا يوجد المفتاح الأحدث.
          barcodeEnabled: row.barcode_enabled,
        });
        if (!remote) return;
        setConfigState(remote);
        if (typeof window !== "undefined") {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(remote));
        }
      });
  }, []);

  const updateConfig = (updates: Partial<CatalogModulesConfig>) => {
    const next: CatalogModulesConfig = { ...config, ...updates };
    for (const flag of LEGACY_FLAGS) next[flag] = false;
    setConfigState(next);
    saveCatalogModulesConfig(next);
  };

  const isTabEnabled = (
    tab:
      | "categories"
      | "units"
      | "grain_grades"
      | "packaging_bags"
      // أبعاد مغلقة: تقبلها الدالة لتبقى الشاشات الأخرى متوافقة، لكنها لا
      // تُدرج في شريط التبويبات أبداً.
      | "brands"
      | "origins"
      | "qualities"
      | "makes"
      | "models",
  ): boolean => {
    switch (tab) {
      case "categories":
        return true; // التصنيف بنية أساسية، لا يُخفى
      case "units":
        return config.enableUnits;
      case "grain_grades":
        return config.enableGrainGrades;
      case "packaging_bags":
        return config.enablePackagingBags;
      default:
        return false; // بُعد مغلق: لا بيانات له في هذه المنشأة
    }
  };

  return { config, updateConfig, isTabEnabled };
}

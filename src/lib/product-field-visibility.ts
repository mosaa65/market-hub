/**
 * تخصيص إظهار حقول المنتجات.
 *
 * ثلاث أسطح مستقلة، لأن الحاجة مختلفة في كل واحد:
 *   view   — شاشة المنتجات (شبكة / قائمة / جدول)
 *   detail — لوحة تفاصيل المنتج
 *   form   — فورم الإضافة والتعديل
 *
 * القرار يُحفظ محلياً لكل مستخدم: إعدادات العرض تخص جهازه ولا تخصّل
 * بقية من يعملون على نفس المنشأة.
 */
export type ProductFieldKey =
  | "nameAr"
  | "nameEn"
  | "category"
  | "role"
  | "sku"
  | "barcode"
  | "shelf"
  | "brand"
  | "unit"
  | "cost"
  | "minStock"
  | "packageWeight"
  | "tax"
  | "status";

export type ProductFieldSurface = "view" | "detail" | "form";

export interface ProductFieldOption {
  key: ProductFieldKey;
  labelAr: string;
  labelEn: string;
  /** حقول لا يمكن إخفاؤها: إزالتها تجعل الواجهة بلا معنى. */
  locked?: boolean;
}

export const PRODUCT_FIELDS: ProductFieldOption[] = [
  { key: "nameAr", labelAr: "الاسم بالعربية", labelEn: "Arabic name", locked: true },
  { key: "nameEn", labelAr: "الاسم بالإنجليزية", labelEn: "English name" },
  { key: "category", labelAr: "التصنيف", labelEn: "Category" },
  { key: "role", labelAr: "الدور (مادة خام/منتج نهائي/خدمة)", labelEn: "Role" },
  { key: "sku", labelAr: "رمز الصنف SKU", labelEn: "SKU" },
  { key: "barcode", labelAr: "الباركود", labelEn: "Barcode" },
  { key: "shelf", labelAr: "موقع الرف", labelEn: "Shelf location" },
  { key: "brand", labelAr: "العلامة التجارية", labelEn: "Brand" },
  { key: "unit", labelAr: "وحدة القياس", labelEn: "Unit" },
  { key: "cost", labelAr: "سعر التكلفة", labelEn: "Cost price" },
  { key: "minStock", labelAr: "حد الطلب الأدنى", labelEn: "Min stock" },
  { key: "packageWeight", labelAr: "سعة العبوة (كجم)", labelEn: "Package size (kg)" },
  { key: "tax", labelAr: "نسبة الضريبة", labelEn: "Tax rate" },
  { key: "status", labelAr: "الحالة", labelEn: "Status" },
];

export type ProductFieldVisibility = Record<ProductFieldKey, boolean>;

/**
 * الافتراضي مقصود: الاسم العربي وال分类 والدور والسعر أساسيوف짜ل للقراءة
 * السريعة؛ أما الاسم الإنجليزي والـ SKU والباركود وموقع الرف فهي حقول
 * إدخال/بحث لا عرض، فلا تشغل مساحة على البطاقة إلا بمن يطلبها.
 */
export const DEFAULT_PRODUCT_FIELD_VISIBILITY: Record<ProductFieldSurface, ProductFieldVisibility> =
  {
    view: {
      nameAr: true,
      nameEn: false,
      category: true,
      role: true,
      sku: false,
      barcode: false,
      shelf: false,
      brand: true,
      unit: true,
      cost: true,
      minStock: true,
      packageWeight: true,
      tax: false,
      status: true,
    },
    detail: {
      nameAr: true,
      nameEn: false,
      category: true,
      role: true,
      sku: false,
      barcode: false,
      shelf: false,
      brand: true,
      unit: true,
      cost: true,
      minStock: true,
      packageWeight: true,
      tax: true,
      status: true,
    },
    form: {
      nameAr: true,
      nameEn: true,
      category: true,
      role: true,
      sku: true,
      barcode: true,
      shelf: true,
      brand: true,
      unit: true,
      cost: true,
      minStock: true,
      packageWeight: true,
      tax: true,
      status: true,
    },
  };

const STORAGE_KEY = "market-hub:product-fields:v1";

const isSurface = (value: unknown): value is ProductFieldSurface =>
  value === "view" || value === "detail" || value === "form";

function readStored(): Record<ProductFieldSurface, ProductFieldVisibility> | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;

    const result = {} as Record<ProductFieldSurface, ProductFieldVisibility>;
    for (const surface of ["view", "detail", "form"] as const) {
      const stored = (parsed as Record<string, unknown>)[surface];
      const fallback = DEFAULT_PRODUCT_FIELD_VISIBILITY[surface];
      const merged = { ...fallback };
      if (typeof stored === "object" && stored !== null) {
        for (const option of PRODUCT_FIELDS) {
          const value = (stored as Record<string, unknown>)[option.key];
          if (typeof value === "boolean" && !(option.locked && !value)) {
            merged[option.key] = value;
          }
        }
      }
      merged.nameAr = true;
      result[surface] = merged;
    }
    return result;
  } catch {
    return null;
  }
}

function writeStored(state: Record<ProductFieldSurface, ProductFieldVisibility>) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // التخزين ممتلئ أو محظور: التخصيص يبقى لهذه الجلسة فقط.
  }
}

export function loadProductFieldVisibility(): Record<ProductFieldSurface, ProductFieldVisibility> {
  return (
    readStored() ?? {
      view: { ...DEFAULT_PRODUCT_FIELD_VISIBILITY.view },
      detail: { ...DEFAULT_PRODUCT_FIELD_VISIBILITY.detail },
      form: { ...DEFAULT_PRODUCT_FIELD_VISIBILITY.form },
    }
  );
}

export function saveProductFieldVisibility(
  state: Record<ProductFieldSurface, ProductFieldVisibility>,
) {
  writeStored(state);
}

export function resetProductFieldVisibility(): Record<ProductFieldSurface, ProductFieldVisibility> {
  const fresh = {
    view: { ...DEFAULT_PRODUCT_FIELD_VISIBILITY.view },
    detail: { ...DEFAULT_PRODUCT_FIELD_VISIBILITY.detail },
    form: { ...DEFAULT_PRODUCT_FIELD_VISIBILITY.form },
  };
  writeStored(fresh);
  return fresh;
}

export { isSurface };

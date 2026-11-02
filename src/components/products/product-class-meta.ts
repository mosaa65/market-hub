/**
 * product-class-meta — how an item class looks, in one place.
 *
 * الملف منفصل عن `ProductPicker` عن قصد: قاعدة React Refresh في هذا المشروع
 * تمنع تصدير غير المكوّنات من ملف مكوّن. وهذه القيم يحتاجها أكثر من موضع —
 * المنتقي والشارات خارج المنتقي ونموذج إضافة المنتج.
 */

import { Factory, Package, Tag, Wheat, type LucideIcon } from "lucide-react";

export interface ProductClassTone {
  label: string;
  icon: LucideIcon;
  /** خلفية أيقونة العائلة. */
  iconClass: string;
  /** شارة صغيرة بجانب الاسم. */
  chipClass: string;
  /** خلفية الصف النشط في القائمة. */
  activeClass: string;
}

export const PRODUCT_CLASS_TONES: Record<string, ProductClassTone> = {
  RAW_MATERIAL: {
    label: "حبوب خام",
    icon: Wheat,
    iconClass: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
    chipClass: "bg-amber-500/12 text-amber-700 dark:text-amber-300",
    activeClass: "border-amber-500/40 bg-amber-500/[0.07]",
  },
  FINISHED_GOOD: {
    label: "منتج نهائي",
    icon: Factory,
    iconClass: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
    chipClass: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300",
    activeClass: "border-emerald-500/40 bg-emerald-500/[0.07]",
  },
  BY_PRODUCT: {
    label: "ناتج ثانوي",
    icon: Package,
    iconClass: "bg-sky-500/15 text-sky-600 dark:text-sky-400",
    chipClass: "bg-sky-500/12 text-sky-700 dark:text-sky-300",
    activeClass: "border-sky-500/40 bg-sky-500/[0.07]",
  },
  TRADED_GOOD: {
    label: "منتج تجاري",
    icon: Tag,
    iconClass: "bg-violet-500/15 text-violet-600 dark:text-violet-400",
    chipClass: "bg-violet-500/12 text-violet-700 dark:text-violet-300",
    activeClass: "border-violet-500/40 bg-violet-500/[0.07]",
  },
};

export const FALLBACK_CLASS_TONE: ProductClassTone = {
  label: "صنف",
  icon: Package,
  iconClass: "bg-muted text-muted-foreground",
  chipClass: "bg-muted text-muted-foreground",
  activeClass: "border-primary/40 bg-primary/[0.06]",
};

export function productClassTone(itemClass: string | null | undefined): ProductClassTone {
  return (itemClass && PRODUCT_CLASS_TONES[itemClass]) || FALLBACK_CLASS_TONE;
}

/** شارة التصنيف: تُستخدم خارج المنتقي (جداول، رؤوس، تقارير). */
export function productClassBadgeClass(itemClass: string | null | undefined): string {
  return productClassTone(itemClass).chipClass;
}

export function productClassLabel(itemClass: string | null | undefined): string {
  return productClassTone(itemClass).label;
}

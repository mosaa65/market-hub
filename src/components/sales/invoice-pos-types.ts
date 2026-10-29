import type { SellableProduct } from "@/lib/sales-invoice";

/**
 * سطر الفاتورة أثناء التحرير (قبل الإصدار).
 *
 * `key` ثابت لكل سطر حتى يبقى تركيز المفاتيح والتركيب على السطر الصحيح بعد
 * إعادة الترتيب أو الحذف — الاعتماد على فهرس المصفوفة يجعل الأسهم تقفز إلى
 * سطر آخر بعد أي تحريك.
 */
export interface PosCartLine {
  key: string;
  product: SellableProduct;
  quantity: string;
  unitPrice: string;
  /** مواصفات البيع المطحنية — تُطبع تحت اسم البند. */
  spec?: import("@/routes/_app.sales-invoice").ProductSpec;
}

let lineSequence = 0;
export function newLineKey(): string {
  lineSequence += 1;
  return `line-${Date.now().toString(36)}-${lineSequence}`;
}

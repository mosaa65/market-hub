import type { SellableProduct } from "@/lib/sales-invoice";

/**
 * مواصفات بيع المطحنة (درجة • نوع طحن • كيس • حجم) — وصفية فقط.
 *
 * نفس المنتج يُباع بأشكال عدة، فيبقى صفًا واحدًا في الكتالوج وتنتقل المواصفة
 * مع سطر البيع وتُطبع تحته. لا تفصل مخزونًا ولا تُنشئ منتجًا وهميًا.
 */
export interface ProductSpec {
  grainOrGrade: string;
  millingType: string;
  bagType: string;
  bagSizeKg: string;
}

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
  /**
   * وحدة البيع المختارة لهذا السطر (كيس/شوال/كيلو…)، أو `null` للوحدة
   * الأساسية. تُطبع في المستند وتُرسَل إلى المحرك كـ `uom_id` لتحويل الكمية
   * بنفس عامل التحويل المخزَّن — بلا حساب محلي مزدوج.
   */
  uomId?: string | null;
  /** عامل التحويل للوحدة الأساسية (1 للوحدة الأساسية). */
  uomFactor?: number;
  /** اسم الوحدة كما يُعرض في البند والطباعة. */
  uomLabel?: string | null;
  /** خطوة الزيادة المسموحة في هذه الوحدة (من `product_uoms`). */
  quantityStep?: number;
  /**
   * هل يُسمح بتعديل السعر يدويًا؟ وحدة البيع لها سعر من الكتالوج، وسعرها
   * الافتراضي يُعاد ضبطه تلقائيًا عند تغيير الوحدة — فلا يُخلط سعر وحدة بسعر
   * وحدة أخرى بالخطأ.
   */
  priceEditable?: boolean;
  /** مواصفات البيع المطحنية — تُطبع تحت اسم البند. */
  spec?: ProductSpec;
}

let lineSequence = 0;
export function newLineKey(): string {
  lineSequence += 1;
  return `line-${Date.now().toString(36)}-${lineSequence}`;
}

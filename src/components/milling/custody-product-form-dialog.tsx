/**
 * CustodyProductFormDialog — إضافة / تعديل أصناف الأمانات (حبوب خام أو نواتج طحن).
 *
 * مكوّن مبسّط مخصص للمطحنة فقط — يُحرِّر فقط الحقول ذات الصلة بعمليات الأمانات
 * بدلاً من صفحة المنتجات المعقدة (`/products`). عند الحفظ يُدرَج المنتج في
 * جدول `products` مع `is_custody_item = true` ويُنعَش الاستعلام المناسب.
 */
/**
 * CustodyProductFormDialog — غلاف توافقي حول `ProductFormDialog` الموحّد.
 *
 * كان هذا ملفًا مستقلًّا بأربعة حقول وصندوق حوار خاص، فيختلف شكل الصنف بين
 * الاستلام والطحن والتسليم وصفحة المنتجات. النسخة الحالية لا ترسم شيئًا
 * بنفسها: تمرّر السياق فقط، فيبقى المنتج الواحد في نموذج واحد.
 *
 * الاسم والخصائص القديمة باقية عن قصد: عشرات المواضع تستورد هذا المكوّن،
 * وتغيير كل استدعاء في دفعة واحدة يخلط تعديل التصميم بتعديل الاستيرادات.
 * الشاشات الجديدة تستورد `ProductFormDialog` مباشرة.
 */
import {
  ProductFormDialog,
  type ProductClass,
  type ProductFormValues,
} from "@/components/products/product-form-dialog";

type ItemClassOption = Extract<ProductClass, "RAW_MATERIAL" | "FINISHED_GOOD" | "BY_PRODUCT">;

export type CustodyProductFormData = ProductFormValues;

export interface CustodyProductFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** القيمة الافتراضية لنوع الصنف عند الإنشاء الجديد. */
  defaultClass?: ItemClassOption;
  /** بيانات صنف موجود للتعديل — إن كان فارغاً يُنشأ صنف جديد. */
  editing?: (Partial<CustodyProductFormData> & { id: string }) | null;
  /** يُستدعى بعد الحفظ بنجاح مع معرّف المنتج المُنشأ/المُعدَّل. */
  onSaved?: (productId: string) => void;
}

export function CustodyProductFormDialog({
  open,
  onOpenChange,
  defaultClass = "RAW_MATERIAL",
  editing,
  onSaved,
}: CustodyProductFormDialogProps) {
  return (
    <ProductFormDialog
      open={open}
      onOpenChange={onOpenChange}
      mode="custody"
      defaultClass={defaultClass}
      editing={editing ?? null}
      onSaved={onSaved}
    />
  );
}

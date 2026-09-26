import {
  AtSign,
  Barcode,
  Boxes,
  Calendar,
  CircleDollarSign,
  Clock,
  FileText,
  Hash,
  KeyRound,
  MapPin,
  Package,
  Palette,
  Percent,
  Phone,
  Search,
  ShieldCheck,
  Tag,
  TextCursorInput,
  Truck,
  User,
  Warehouse,
  type LucideIcon,
} from "lucide-react";

/**
 * Default field icons.
 *
 * Requirement: form fields should carry an icon. Rather than forcing every call
 * site to choose one, `FormField` can infer a sensible default from the field's
 * semantic kind, labels, or name. An explicit `icon` always wins.
 *
 * This keeps the whole system visually consistent: every input has an icon, and
 * an author only has to think about it when the default is wrong.
 */
export type FieldKind =
  | "text"
  | "name"
  | "email"
  | "phone"
  | "password"
  | "number"
  | "integer"
  | "currency"
  | "percent"
  | "date"
  | "time"
  | "search"
  | "barcode"
  | "sku"
  | "address"
  | "notes"
  | "quantity"
  | "unit"
  | "category"
  | "brand"
  | "supplier"
  | "customer"
  | "warehouse"
  | "product"
  | "tax"
  | "code"
  | "color";

const KIND_ICONS: Record<FieldKind, LucideIcon> = {
  text: TextCursorInput,
  name: User,
  email: AtSign,
  phone: Phone,
  password: KeyRound,
  number: Hash,
  integer: Hash,
  currency: CircleDollarSign,
  percent: Percent,
  date: Calendar,
  time: Clock,
  search: Search,
  barcode: Barcode,
  sku: Barcode,
  address: MapPin,
  notes: FileText,
  quantity: Boxes,
  unit: Boxes,
  category: Tag,
  brand: Palette,
  supplier: Truck,
  customer: User,
  warehouse: Warehouse,
  product: Package,
  tax: Percent,
  code: ShieldCheck,
  color: Palette,
};

/** The generic fallback: a neutral text-field icon. */
export const DEFAULT_FIELD_ICON = TextCursorInput;

/**
 * Infer a field kind from a set of hints (the field `name`, its `label`, its
 * placeholder, and the HTML input type).
 *
 * Deliberately keyword-based and bilingual, because the app mixes Arabic and
 * English labels freely.
 */
export function inferFieldKind(hints: {
  name?: string;
  label?: string;
  placeholder?: string;
  type?: string;
}): FieldKind {
  const type = (hints.type ?? "").toLowerCase();
  if (type === "email") return "email";
  if (type === "tel" || type === "phone") return "phone";
  if (type === "password") return "password";
  if (type === "date" || type === "datetime-local") return "date";
  if (type === "time") return "time";
  if (type === "search") return "search";
  if (type === "currency") return "currency";
  if (type === "percent") return "percent";
  if (type === "integer") return "integer";
  if (type === "number" || type === "decimal") return "number";

  const haystack = [hints.name, hints.label, hints.placeholder]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  const has = (...words: string[]) => words.some((w) => haystack.includes(w));

  if (has("barcode", "باركود", "الباركود")) return "barcode";
  if (has("sku", "رمز المنتج", "الرمز")) return "sku";
  if (has("email", "البريد", "ايميل", "إيميل")) return "email";
  if (has("phone", "mobile", "هاتف", "جوال", "الهاتف", "الجوال")) return "phone";
  if (has("password", "كلمة المرور", "كلمه المرور")) return "password";
  if (has("price", "cost", "amount", "total", "salary", "balance", "paid", "سعر", "السعر", "تكلفة", "التكلفة", "مبلغ", "المبلغ", "الاجمالي", "الإجمالي", "رصيد", "الرصيد", "مدفوع"))
    return "currency";
  if (has("tax", "discount", "rate %", "ضريبة", "الضريبة", "خصم", "الخصم", "نسبة")) return "percent";
  if (has("quantity", "qty", "stock", "min", "count", "الكمية", "كمية", "المخزون", "الحد الأدنى", "العدد"))
    return "quantity";
  if (has("unit", "الوحدة", "وحدة")) return "unit";
  if (has("category", "التصنيف", "الفئة")) return "category";
  if (has("brand", "الماركة", "العلامة")) return "brand";
  if (has("supplier", "vendor", "المورد", "مورد")) return "supplier";
  if (has("customer", "client", "العميل", "عميل")) return "customer";
  if (has("warehouse", "store", "المستودع", "المخزن")) return "warehouse";
  if (has("product", "item", "المنتج", "منتج", "الصنف")) return "product";
  if (has("date", "expiry", "التاريخ", "تاريخ", "الانتهاء")) return "date";
  if (has("address", "location", "city", "العنوان", "الموقع", "المدينة", "موقع الرف")) return "address";
  if (has("note", "description", "remark", "ملاحظة", "ملاحظات", "الوصف")) return "notes";
  if (has("code", "serial", "الرمز", "الكود")) return "code";
  if (has("name", "اسم", "الاسم")) return "name";
  if (has("color", "colour", "اللون")) return "color";

  return "text";
}

/** Resolve the icon component for a field kind. */
export function fieldIcon(kind: FieldKind): LucideIcon {
  return KIND_ICONS[kind] ?? DEFAULT_FIELD_ICON;
}

/**
 * Convenience: infer the kind and return the icon component in one call.
 * Returns `null` when an explicit icon was already supplied by the caller.
 */
export function resolveFieldIcon(props: {
  explicit?: React.ReactNode;
  name?: string;
  label?: string;
  placeholder?: string;
  type?: string;
}): React.ReactNode | null {
  if (props.explicit) return props.explicit;
  const kind = inferFieldKind(props);
  const Icon = fieldIcon(kind);
  return <Icon />;
}
import type { LucideIcon } from "lucide-react";
import {
  AtSign,
  Barcode,
  Boxes,
  Calendar,
  CircleDollarSign,
  CreditCard,
  FileText,
  Globe,
  Hash,
  Image,
  KeyRound,
  Layers,
  Lock,
  Mail,
  MapPin,
  Package,
  Percent,
  Phone,
  Ruler,
  Search,
  ShieldCheck,
  Tag,
  Truck,
  Type,
  User,
  Users,
  Warehouse,
} from "lucide-react";

/**
 * Field icons — the single place that decides which icon a form field shows.
 *
 * Requirement: every form field in the app should carry a meaningful icon, and
 * when a page does not supply one there must still be a sensible default so the
 * system looks uniform rather than half-decorated.
 *
 * Resolution order:
 *   1. an explicit `icon` passed by the page (highest priority)
 *   2. a keyword match on the field's semantic `kind`
 *   3. a keyword match on the field's label / placeholder text (AR + EN)
 *   4. `DEFAULT_FIELD_ICON` — so a field is never icon-less
 *
 * Matching is substring-based and bilingual, because the same field is labelled
 * "اسم المنتج" in Arabic and "Product name" in English.
 */

/** Explicit semantic kinds a caller can pass instead of relying on label matching. */
export type FieldIconKind =
  | "text"
  | "email"
  | "password"
  | "phone"
  | "url"
  | "search"
  | "number"
  | "currency"
  | "percent"
  | "quantity"
  | "date"
  | "time"
  | "code"
  | "sku"
  | "barcode"
  | "name"
  | "person"
  | "customer"
  | "supplier"
  | "product"
  | "category"
  | "brand"
  | "unit"
  | "warehouse"
  | "address"
  | "notes"
  | "image"
  | "role"
  | "card";

const KIND_ICONS: Record<FieldIconKind, LucideIcon> = {
  text: Type,
  email: Mail,
  password: Lock,
  phone: Phone,
  url: Globe,
  search: Search,
  number: Hash,
  currency: CircleDollarSign,
  percent: Percent,
  quantity: Boxes,
  date: Calendar,
  time: Calendar,
  code: KeyRound,
  sku: Tag,
  barcode: Barcode,
  name: Tag,
  person: User,
  customer: Users,
  supplier: Truck,
  product: Package,
  category: Layers,
  brand: ShieldCheck,
  unit: Ruler,
  warehouse: Warehouse,
  address: MapPin,
  notes: FileText,
  image: Image,
  role: ShieldCheck,
  card: CreditCard,
};

/** Used when nothing else matches, so no field is ever icon-less. */
export const DEFAULT_FIELD_ICON: LucideIcon = Type;

/**
 * Keyword → icon, checked against the field's label/placeholder/name.
 * Order matters: earlier entries win.
 */
const KEYWORD_ICONS: { test: RegExp; icon: LucideIcon }[] = [
  // Contact / identity
  { test: /بريد|ايميل|إيميل|email|e-mail/i, icon: Mail },
  { test: /هاتف|جوال|موبايل|رقم الهاتف|phone|mobile|tel/i, icon: Phone },
  { test: /كلمة المرور|كلمه المرور|password|passcode/i, icon: Lock },
  { test: /العنوان|عنوان|address|location|city|مدينة|منطقة/i, icon: MapPin },
  { test: /الموقع|رابط|website|url|link/i, icon: Globe },

  // People & parties
  { test: /عميل|عملاء|customer|client/i, icon: Users },
  { test: /مورد|موردين|supplier|vendor/i, icon: Truck },
  { test: /المستخدم|مستخدم|user|employee|موظف/i, icon: User },
  { test: /الدور|الصلاحية|role|permission|صلاحيات/i, icon: ShieldCheck },

  // Catalog
  { test: /منتج|منتجات|product|item|صنف/i, icon: Package },
  { test: /فئة|فئات|تصنيف|category|section/i, icon: Layers },
  { test: /علامة|ماركة|brand|manufacturer/i, icon: ShieldCheck },
  { test: /وحدة|وحدات|unit|uom|measure/i, icon: Ruler },
  { test: /مستودع|مخزن|warehouse|store/i, icon: Warehouse },
  { test: /الباركود|باركود|barcode/i, icon: Barcode },
  { test: /sku|الرمز|كود|code|رمز/i, icon: Tag },
  { test: /بلد المنشأ|المنشأ|origin|country|دولة/i, icon: Globe },
  { test: /درجة الجودة|الجودة|quality|grade/i, icon: ShieldCheck },
  { test: /موقع الرف|الرف|shelf|rack|bin/i, icon: Boxes },

  // Money
  { test: /السعر|سعر|price|selling|بيع/i, icon: CircleDollarSign },
  { test: /التكلفة|تكلفة|cost|purchase price/i, icon: CircleDollarSign },
  { test: /الضريبة|ضريبة|tax|vat/i, icon: Percent },
  { test: /خصم|discount/i, icon: Percent },
  { test: /العملة|currency/i, icon: CircleDollarSign },
  { test: /بطاقة|card/i, icon: CreditCard },
  { test: /الرصيد|رصيد|balance|credit limit|حد الائتمان/i, icon: CircleDollarSign },

  // Quantities & dates
  { test: /الكمية|كمية|quantity|qty|count|العدد/i, icon: Boxes },
  { test: /الحد الأدنى|حد أدنى|min stock|minimum|reorder/i, icon: Boxes },
  { test: /التاريخ|تاريخ|date|expiry|انتهاء|الصلاحية/i, icon: Calendar },
  { test: /الوقت|وقت|time|hour/i, icon: Calendar },

  // Misc
  { test: /ملاحظة|ملاحظات|note|description|وصف|comment|بيان/i, icon: FileText },
  { test: /صورة|شعار|image|logo|photo|avatar/i, icon: Image },
  { test: /بحث|search|query/i, icon: Search },
  { test: /كلمة السر|secret|token|api key/i, icon: KeyRound },
];

export interface ResolveFieldIconOptions {
  /** Explicit semantic kind — bypasses label matching. */
  kind?: FieldIconKind;
  /** The field's label, placeholder or name, used for keyword matching. */
  label?: string;
  /** Explicit override supplied by the page; wins over everything. */
  icon?: LucideIcon;
}

/**
 * Decide which icon a field should show. Never returns undefined.
 */
export function resolveFieldIcon(options: ResolveFieldIconOptions = {}): LucideIcon {
  const { kind, label, icon } = options;

  if (icon) return icon;
  if (kind) return KIND_ICONS[kind];

  if (label) {
    for (const { test, icon: matched } of KEYWORD_ICONS) {
      if (test.test(label)) return matched;
    }
  }

  return DEFAULT_FIELD_ICON;
}

/** All available kickens, exported for tooling/galleries. */
export const FIELD_ICON_KINDS = Object.keys(KIND_ICONS) as FieldIconKind[];

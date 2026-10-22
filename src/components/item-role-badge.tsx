/**
 * Market-Hub ERP — How an item's role is shown, in one place.
 *
 * WHY THIS EXISTS
 * ---------------
 * The data model already separates what a thing IS from what it DOES:
 *
 *   item_nature        GOOD | SERVICE        — is it sellable stock or a service
 *   inventory_policy   TRACKED | UNTRACKED | CUSTOMER_OWNED
 *   item_class         RAW_MATERIAL | FINISHED_GOOD | BY_PRODUCT |
 *                      SERVICE | NON_STOCK_ITEM  — what role it plays
 *
 * A mill's operator does not think in those words. They think "grain", "flour",
 * "bran", "milling fee", "sack". Reading raw enum codes in a table is how a
 * column ends up ignored, and then the operator cannot tell a sack of wheat from
 * a sack of flour at a glance — which is the one distinction that matters most
 * on a screen full of milled goods.
 *
 * So each class gets a colour and an Arabic name, and both the products and
 * inventory screens use these badges. The colour is not decoration: it is how
 * the eye separates raw grain from finished flour without reading a word.
 *
 * THE FOUR ROLES THAT MATTER ON A MILL FLOOR
 *   RAW_MATERIAL    ماكينة     grain received, waiting to be milled
 *   FINISHED_GOOD   منتجات نهائية  flour the mill sells
 *   BY_PRODUCT      نواتج     bran and semolina — produced BY milling
 *   SERVICE         خدمات      the milling fee itself, and sacks sold
 *   NON_STOCK_ITEM  مستهلكات    consumables that are not the product
 */
import type { ReactNode } from "react";

export type ItemClass =
  "RAW_MATERIAL" | "FINISHED_GOOD" | "BY_PRODUCT" | "SERVICE" | "NON_STOCK_ITEM";

export interface ItemRoleStyle {
  labelAr: string;
  labelEn: string;
  /** Tailwind classes. Kept literal so the JIT compiler can see them. */
  chip: string;
  dot: string;
  /** A short glyph so the distinction survives a narrow column. */
  mark: string;
}

export const ITEM_ROLE_STYLES: Record<ItemClass, ItemRoleStyle> = {
  RAW_MATERIAL: {
    labelAr: "مادة خام",
    labelEn: "Raw material",
    chip: "bg-amber-500/15 text-amber-600 border-amber-500/30 dark:text-amber-300",
    dot: "bg-amber-500",
    mark: "◆",
  },
  FINISHED_GOOD: {
    labelAr: "منتج نهائي",
    labelEn: "Finished good",
    chip: "bg-emerald-500/15 text-emerald-600 border-emerald-500/30 dark:text-emerald-300",
    dot: "bg-emerald-500",
    mark: "●",
  },
  BY_PRODUCT: {
    labelAr: "ناتج طحن",
    labelEn: "By-product",
    chip: "bg-orange-500/15 text-orange-600 border-orange-500/30 dark:text-orange-300",
    dot: "bg-orange-500",
    mark: "◐",
  },
  SERVICE: {
    labelAr: "خدمة",
    labelEn: "Service",
    chip: "bg-violet-500/15 text-violet-600 border-violet-500/30 dark:text-violet-300",
    dot: "bg-violet-500",
    mark: "◇",
  },
  NON_STOCK_ITEM: {
    labelAr: "مستهلكات",
    labelEn: "Non-stock",
    chip: "bg-slate-500/15 text-slate-600 border-slate-500/30 dark:text-slate-300",
    dot: "bg-slate-500",
    mark: "○",
  },
};

/**
 * The role to display. Falls back through the two columns that are always
 * present so a legacy product saved before item_class existed still gets a
 * sensible colour rather than a blank.
 */
export function resolveItemClass(
  itemClass: string | null | undefined,
  itemNature: string | null | undefined,
  inventoryPolicy: string | null | undefined,
): ItemClass {
  if (itemClass && itemClass in ITEM_ROLE_STYLES) return itemClass as ItemClass;
  if (itemNature === "SERVICE") return "SERVICE";
  if (inventoryPolicy === "CUSTOMER_OWNED") return "RAW_MATERIAL";
  return "FINISHED_GOOD";
}

export function itemRoleStyle(
  itemClass: string | null | undefined,
  itemNature?: string | null,
  inventoryPolicy?: string | null,
  isRtl = true,
): ItemRoleStyle {
  const s = ITEM_ROLE_STYLES[resolveItemClass(itemClass, itemNature, inventoryPolicy)];
  return { ...s, labelAr: s.labelAr, labelEn: s.labelEn };
}

export function itemRoleLabel(
  itemClass: string | null | undefined,
  itemNature?: string | null,
  inventoryPolicy?: string | null,
  isRtl = true,
): string {
  const s = ITEM_ROLE_STYLES[resolveItemClass(itemClass, itemNature, inventoryPolicy)];
  return isRtl ? s.labelAr : s.labelEn;
}

/** The coloured role badge used in table cells and cards. */
export function ItemRoleBadge({
  itemClass,
  itemNature,
  inventoryPolicy,
  isRtl = true,
  compact = false,
}: {
  itemClass?: string | null;
  itemNature?: string | null;
  inventoryPolicy?: string | null;
  isRtl?: boolean;
  compact?: boolean;
}): ReactNode {
  const style = ITEM_ROLE_STYLES[resolveItemClass(itemClass, itemNature, inventoryPolicy)];
  const label = isRtl ? style.labelAr : style.labelEn;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold whitespace-nowrap ${style.chip}`}
      title={label}
    >
      <span className="text-[9px] leading-none">{style.mark}</span>
      {/*
        على البطاقات يُرسَل compact لتوفير المساحة، لكن إخفاء النص تماماً
        يترك رمزاً ملوّناً لا يُعرف معناه إلا بتمرير المؤشر. الرمز يبقى،
        والنص يظهر على الشاشات العرضية حيث تسمح المساحة بالقراءة.
      */}
      <span className={compact ? "hidden sm:inline" : undefined}>{label}</span>
    </span>
  );
}

/** A bare colour dot, for dense tables where a full chip would crowd the row. */
export function ItemRoleDot({
  itemClass,
  itemNature,
  inventoryPolicy,
  isRtl = true,
}: {
  itemClass?: string | null;
  itemNature?: string | null;
  inventoryPolicy?: string | null;
  isRtl?: boolean;
}): ReactNode {
  const style = ITEM_ROLE_STYLES[resolveItemClass(itemClass, itemNature, inventoryPolicy)];
  return (
    <span
      className={`inline-block h-2 w-2 shrink-0 rounded-full ${style.dot}`}
      title={isRtl ? style.labelAr : style.labelEn}
    />
  );
}

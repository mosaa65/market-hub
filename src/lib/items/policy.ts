/**
 * Market-Hub ERP — Item model & inventory policy (client-side mirror).
 *
 * This module is the browser's single source of truth for the separated policy
 * axes described in `Market-Hub_Product_Inventory_Service_Design.docx`:
 *
 *     item_nature      GOOD | SERVICE
 *     inventory_policy TRACKED | UNTRACKED | CUSTOMER_OWNED
 *     tracking         NONE | BATCH | SERIAL
 *     costing_method   MOVING_AVERAGE | FIFO | STANDARD | NONE
 *     is_sellable / is_purchasable
 *
 * It mirrors `public.item_stock_effect()` and `public.item_line_type()` so the
 * UI can predict — and explain — what the server will do, without duplicating
 * the *decision*. The server remains authoritative: the sales and purchase
 * engines re-derive the effect at posting time. This module exists so the user
 * sees the truth before they commit, not so the client can decide it.
 *
 * Design rules encoded here (see section 18 of the design document):
 *   #1  Product type is not inventory policy.
 *   #2  A SERVICE is not a way to switch stock off.
 *   #3  There is no "unlimited stock"; there is TRACKED or UNTRACKED.
 *   #4  A sale does not always reduce stock.
 *   #5  A purchase does not always increase stock.
 */

/* ------------------------------------------------------------------ types */

export type ItemNature = "GOOD" | "SERVICE";

export type InventoryPolicy = "TRACKED" | "UNTRACKED" | "CUSTOMER_OWNED";

export type ItemTracking = "NONE" | "BATCH" | "SERIAL";

export type CostingMethod = "MOVING_AVERAGE" | "FIFO" | "STANDARD" | "NONE";

export type ItemStatus = "ACTIVE" | "INACTIVE" | "ARCHIVED";

export type OwnerType = "COMPANY" | "CUSTOMER" | "SUPPLIER" | "OTHER";

/** What the stock engine will do to inventory for one document line. */
export type StockEffect = "STOCK_ISSUE" | "STOCK_RECEIPT" | "NONE";

/** How a posted invoice line is classified for reporting. */
export type InvoiceLineType =
  "STOCKED_GOOD" | "UNTRACKED_GOOD" | "SERVICE" | "CUSTOMER_OWNED_GOOD" | "AD_HOC_SERVICE";

/** The policy-bearing subset of a product row. */
export interface ItemPolicy {
  item_nature: ItemNature;
  inventory_policy: InventoryPolicy;
  tracking: ItemTracking;
  costing_method: CostingMethod;
  is_sellable: boolean;
  is_purchasable: boolean;
}

/** A per-company override. `null` means "inherit from the item". */
export interface CompanyItemPolicy {
  company_id: number;
  item_id: string;
  inventory_policy: InventoryPolicy | null;
  costing_method: CostingMethod | null;
  default_cost: number | null;
  default_sale_price: number | null;
  tax_rate: number | null;
  is_active: boolean;
}

/* -------------------------------------------------------------- defaults */

/** Matches the database defaults, so a product without explicit policy reads
 *  exactly as the existing schema already behaved: a normal sellable good. */
export const DEFAULT_ITEM_POLICY: ItemPolicy = {
  item_nature: "GOOD",
  inventory_policy: "TRACKED",
  tracking: "NONE",
  costing_method: "MOVING_AVERAGE",
  is_sellable: true,
  is_purchasable: true,
};

/** Policy for a service: never tracked, never valued, and by design never
 *  purchasable as stock (it can still be bought as an expense — see below). */
export const SERVICE_ITEM_POLICY: ItemPolicy = {
  item_nature: "SERVICE",
  inventory_policy: "UNTRACKED",
  tracking: "NONE",
  costing_method: "NONE",
  is_sellable: true,
  is_purchasable: false,
};

/** A physical good the business has chosen not to track. This is the correct
 *  answer to "flour we sell without managing bags", NOT the SERVICE nature. */
export const UNTRACKED_GOOD_ITEM_POLICY: ItemPolicy = {
  item_nature: "GOOD",
  inventory_policy: "UNTRACKED",
  tracking: "NONE",
  costing_method: "NONE",
  is_sellable: true,
  is_purchasable: true,
};

/* -------------------------------------------------- effective policy read */

/**
 * Resolves the effective policy for an item, applying the company override
 * first — exactly like `public.item_effective_policy()`.
 */
export function resolveEffectivePolicy(
  item: ItemPolicy,
  companyOverride?: Partial<CompanyItemPolicy> | null,
): ItemPolicy {
  if (!companyOverride) return item;

  return {
    ...item,
    inventory_policy: companyOverride.inventory_policy ?? item.inventory_policy,
    costing_method: companyOverride.costing_method ?? item.costing_method,
  };
}

/* -------------------------------------------------------- effect resolver */

/**
 * The one question the document engines ask.
 *
 * `direction` is 'out' for a sale and 'in' for a purchase. Returns exactly what
 * the database will do, so the UI never has to assume.
 */
export function itemStockEffect(
  policy: ItemPolicy,
  direction: "in" | "out",
  companyOverride?: Partial<CompanyItemPolicy> | null,
): StockEffect {
  const effective = resolveEffectivePolicy(policy, companyOverride);

  // A SERVICE never moves company stock in either direction.
  if (effective.item_nature === "SERVICE") return "NONE";

  // Only a TRACKED good moves stock. An UNTRACKED good is sold and purchased
  // with no inventory effect, and CUSTOMER_OWNED material is never company
  // stock, so a normal sale or purchase never touches it.
  if (effective.inventory_policy !== "TRACKED") return "NONE";

  return direction === "out" ? "STOCK_ISSUE" : "STOCK_RECEIPT";
}

/** The invoice line classification the server will record. */
export function itemLineType(
  policy: ItemPolicy,
  options: { isAdHoc?: boolean; companyOverride?: Partial<CompanyItemPolicy> | null } = {},
): InvoiceLineType {
  if (options.isAdHoc) return "AD_HOC_SERVICE";
  if (policy.item_nature === "SERVICE") return "SERVICE";

  const effective = resolveEffectivePolicy(policy, options.companyOverride);

  switch (effective.inventory_policy) {
    case "TRACKED":
      return "STOCKED_GOOD";
    case "CUSTOMER_OWNED":
      return "CUSTOMER_OWNED_GOOD";
    default:
      return "UNTRACKED_GOOD";
  }
}

/* --------------------------------------------------- policy validity rules */

export interface PolicyValidationResult {
  valid: boolean;
  errors: string[];
  /** Advisory only — shown to the user, never blocks the save. */
  warnings: string[];
}

/**
 * Mirrors the database CHECK constraints and `approve_item_policy_change()` so
 * the form can explain a rejection before the user hits save. The server still
 * enforces all of this; this is purely for a better message.
 */
export function validateItemPolicy(policy: ItemPolicy): PolicyValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (policy.item_nature === "SERVICE" && policy.inventory_policy !== "UNTRACKED") {
    errors.push("الخدمة لا يمكن أن تكون متتبعة مخزنيًا. الخدمة تُباع كعمل، لا كرصيد.");
  }

  if (policy.inventory_policy === "TRACKED" && policy.costing_method === "NONE") {
    errors.push("الصنف المتتبع يحتاج طريقة تقييم غير NONE.");
  }

  if (policy.inventory_policy === "UNTRACKED" && policy.tracking !== "NONE") {
    errors.push("الصنف غير المتتبع لا يمكن أن يطلب تتبع دفعات أو أرقام تسلسلية.");
  }

  if (policy.costing_method === "NONE" && policy.inventory_policy !== "UNTRACKED") {
    errors.push("طريقة التكلفة NONE صحيحة فقط للصنف غير المتتبع.");
  }

  if (!policy.is_sellable && !policy.is_purchasable) {
    errors.push("يجب أن يكون الصنف قابلًا للبيع أو الشراء أو كليهما.");
  }

  if (policy.item_nature === "SERVICE" && policy.is_purchasable) {
    warnings.push(
      "شراء الخدمة يُسجَّل كمصروف أو خدمة، ولن يزيد المخزون بأي حال. التأشير هنا يعني أنها تظهر في شاشة المشتريات.",
    );
  }

  if (policy.item_nature === "GOOD" && policy.inventory_policy === "UNTRACKED") {
    warnings.push("هذا صنف مادي غير متتبع: سيظهر في الفواتير لكن لن يُدار له رصيد أو تقييم مخزني.");
  }

  return { valid: errors.length === 0, errors, warnings };
}

/* ------------------------------------------------------------- UI labels */

export const ITEM_NATURE_LABELS: Record<ItemNature, { ar: string; en: string }> = {
  GOOD: { ar: "سلعة", en: "Good" },
  SERVICE: { ar: "خدمة", en: "Service" },
};

export const INVENTORY_POLICY_LABELS: Record<InventoryPolicy, { ar: string; en: string }> = {
  TRACKED: { ar: "متتبع مخزنيًا", en: "Tracked" },
  UNTRACKED: { ar: "غير متتبع مخزنيًا", en: "Untracked" },
  CUSTOMER_OWNED: { ar: "مملوك للعميل", en: "Customer-owned" },
};

export const TRACKING_LABELS: Record<ItemTracking, { ar: string; en: string }> = {
  NONE: { ar: "بدون", en: "None" },
  BATCH: { ar: "دفعات", en: "Batch" },
  SERIAL: { ar: "أرقام تسلسلية", en: "Serial" },
};

export const COSTING_METHOD_LABELS: Record<CostingMethod, { ar: string; en: string }> = {
  MOVING_AVERAGE: { ar: "المتوسط المتحرك", en: "Moving average" },
  FIFO: { ar: "الوارد أولًا صادر أولًا (FIFO)", en: "FIFO" },
  STANDARD: { ar: "التكلفة القياسية", en: "Standard cost" },
  NONE: { ar: "بدون تقييم", en: "None" },
};

export const LINE_TYPE_LABELS: Record<InvoiceLineType, { ar: string; en: string }> = {
  STOCKED_GOOD: { ar: "سلعة مخزنية", en: "Stocked good" },
  UNTRACKED_GOOD: { ar: "سلعة غير متتبعة", en: "Untracked good" },
  SERVICE: { ar: "خدمة", en: "Service" },
  CUSTOMER_OWNED_GOOD: { ar: "مادة مملوكة للعميل", en: "Customer-owned good" },
  AD_HOC_SERVICE: { ar: "خدمة مخصصة", en: "Ad-hoc service" },
};

/** A short, plain-language sentence describing what a policy means in practice. */
export function describeItemPolicy(policy: ItemPolicy, lang: string): string {
  const ar = lang === "ar";
  const effective = policy;
  const effect = itemStockEffect(effective, "out");

  if (effective.item_nature === "SERVICE") {
    return ar
      ? "خدمة: تظهر كسطر خدمة في الفاتورة، ولا يوجد لها رصيد أو تقييم مخزني."
      : "Service: appears as a service line, with no stock balance or valuation.";
  }

  if (effective.inventory_policy === "TRACKED") {
    return ar
      ? `سلعة متتبعة: تُخصم من المخزون عند البيع (${effect})، وتُقيَّم حسب طريقة التكلفة المختارة.`
      : `Tracked good: deducted from stock on sale (${effect}) and valued by the chosen costing method.`;
  }

  if (effective.inventory_policy === "CUSTOMER_OWNED") {
    return ar
      ? "مادة مملوكة للعميل: تُحفظ في موقعنا لكنها لا تدخل في قيمة مخزون الشركة."
      : "Customer-owned material: held at our location but excluded from company stock valuation.";
  }

  return ar
    ? "سلعة مادية غير متتبعة: تظهر في الفواتير بدون إدارة رصيد مخزني."
    : "Untracked physical good: appears on invoices with no stock balance managed.";
}

/* --------------------------------------------------- guided wizard helpers */

/** Which questions the guided item form must ask, given the answers so far. */
export interface WizardStep {
  nature: ItemNature | null;
  trackInventory: boolean | null;
  usedFor: "sell" | "purchase" | "both" | null;
}

/**
 * The guided creation flow from design section 16:
 *   1. What kind of item is it?        GOOD | SERVICE
 *   2. Do you want to track stock?     yes | no      (goals only)
 *   3. Is it used for sale, purchase, or both?
 *
 * This turns the answers into a policy the database will accept.
 */
export function policyFromWizard(step: WizardStep): ItemPolicy {
  if (step.nature === "SERVICE") {
    return {
      ...SERVICE_ITEM_POLICY,
      is_sellable: step.usedFor === "sell" || step.usedFor === "both" || step.usedFor === null,
      is_purchasable: step.usedFor === "purchase" || step.usedFor === "both",
    };
  }

  const base = step.trackInventory ? DEFAULT_ITEM_POLICY : UNTRACKED_GOOD_ITEM_POLICY;

  return {
    ...base,
    is_sellable: step.usedFor === "sell" || step.usedFor === "both" || step.usedFor === null,
    is_purchasable: step.usedFor === "purchase" || step.usedFor === "both" || step.usedFor === null,
  };
}

/** Fields that must be hidden when stock is not tracked (design section 16). */
export function visibleItemFields(policy: ItemPolicy) {
  const tracks = policy.inventory_policy === "TRACKED";
  return {
    warehouse: tracks,
    openingStock: tracks,
    costingMethod: tracks,
    batchSerial: tracks && policy.tracking !== "NONE",
    minStock: tracks,
    referenceCost: true, // always useful, never a purchase record
    uom: true,
  };
}

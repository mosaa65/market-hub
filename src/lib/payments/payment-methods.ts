/**
 * المصدر المركزي لطرق الدفع في الواجهة (Developer Payment Catalog — client side).
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * Before this module, each screen carried its own union type, its own label map
 * and its own icon switch. `_app.pos.tsx` offered five options, `_app.purchases.tsx`
 * four buttons, the returns screens a Radix Select whose `bank` value did not
 * even exist in the database ENUM. Adding بنك الكريمي meant editing eight files.
 *
 * Now every screen reads from here. Two rules keep it that way:
 *
 *   1. A screen never writes a payment method label, icon, or option list.
 *      It asks this module, or the `usePaymentMethods` hook which merges the
 *      tenant's own settings on top of these definitions.
 *
 *   2. The identity of a method is its stable string `id`. Codes that reach the
 *      database come from `legacyValue`, never from guessing.
 *
 * RELATIONSHIP TO THE DATABASE
 * ----------------------------
 * `PAYMENT_METHOD_CATALOG` mirrors the rows seeded by
 * `supabase/migrations/20261206000000_payment_methods_catalog.sql`. It is the
 * FALLBACK and the ICON REGISTRY: the app renders instantly from it, before the
 * catalogue query resolves and if that query ever fails. The database remains
 * the authority for which methods exist, are active, and are enabled for this
 * business.
 *
 * ICONS
 * -----
 * `iconKey` is a KEY, not a URL. It resolves to a lucide-react component that is
 * already in the bundle, so a payment icon costs zero network requests, is
 * identical in light and dark mode, and cannot fail to load. The fallback chain
 * is: iconKey -> ledger-kind default -> wallet.
 */

import {
  Banknote,
  Building2,
  Coins,
  CreditCard,
  Landmark,
  Smartphone,
  Wallet,
  type LucideIcon,
} from "lucide-react";

/* ==========================================================================
   Contexts — the sections of the system that offer a payment method
   ========================================================================== */

/**
 * A context is where a payment method can be chosen. Adding one is a two-step
 * change: add the id here, and add it to the migration's CHECK constraint plus
 * the developers' `allowed_contexts`. Nothing else in the codebase enumerates
 * contexts, so nothing else needs touching.
 */
export const PAYMENT_CONTEXTS = [
  "pos",
  "sales",
  "purchases",
  "expenses",
  "customer_collection",
  "sales_returns",
  "purchase_returns",
] as const;

export type PaymentContext = (typeof PAYMENT_CONTEXTS)[number];

/** Arabic/English name of each context, used by the settings screen. */
export const PAYMENT_CONTEXT_LABELS: Record<PaymentContext, { ar: string; en: string }> = {
  pos: { ar: "نقطة البيع POS", en: "Point of Sale" },
  sales: { ar: "المبيعات", en: "Sales" },
  purchases: { ar: "المشتريات", en: "Purchases" },
  expenses: { ar: "المصروفات", en: "Expenses" },
  customer_collection: { ar: "تحصيل العملاء", en: "Customer Collection" },
  sales_returns: { ar: "مرتجعات المبيعات", en: "Sales Returns" },
  purchase_returns: { ar: "مرتجعات المشتريات", en: "Purchase Returns" },
};

export function isPaymentContext(value: string): value is PaymentContext {
  return (PAYMENT_CONTEXTS as readonly string[]).includes(value);
}

/* ==========================================================================
   Ledger kind — which pot the money lands in
   ========================================================================== */

/**
 * The account family a method settles into. This exists so the posting engine
 * can branch on a *kind* instead of listing ENUM values:
 *
 *   before:  payment_method IN ('bank_transfer','card','mobile_money') -> bank
 *   after:   ledger_kind IN ('BANK','WALLET','CARD')                   -> bank
 *
 * Otherwise adding بنك الكريمي would post to the cash drawer, silently
 * overstating the till and understating the bank.
 */
export type LedgerKind = "CASH" | "BANK" | "WALLET" | "CARD" | "CREDIT" | "OTHER";

/** The `public.payment_method` values a document may store. */
export type LegacyPaymentValue =
  "cash" | "card" | "bank_transfer" | "credit" | "mobile_money" | "split";

/* ==========================================================================
   The developer catalogue
   ========================================================================== */

export interface PaymentMethodDefinition {
  /** Stable identity. Never translated, never reordered, never reused. */
  id: string;
  nameAr: string;
  /** Optional English name, for a future bilingual document. */
  nameEn?: string;
  /** Key resolved by `paymentMethodIcon()`. Not a URL. */
  iconKey: string;
  /** Developer-level availability. A tenant cannot change this. */
  isActive: boolean;
  /** Default presentation order across all businesses. */
  sortOrder: number;
  /** Contexts the developers allow. A tenant may narrow, never widen. */
  allowedContexts: readonly PaymentContext[];
  ledgerKind: LedgerKind;
  /** Future accounting hook: the account this method should post to. */
  defaultAccountCode?: string;
  /** `credit` / آجل — nothing is collected now. */
  isCreditTerm?: boolean;
  /** Requires a transfer / wallet reference number to be captured. */
  requiresReference?: boolean;
  /**
   * The ENUM value a document stores for this method. This is the ONLY
   * sanctioned way a catalogue id becomes a database value.
   */
  legacyValue: LegacyPaymentValue;
}

const ALL_CONTEXTS: readonly PaymentContext[] = PAYMENT_CONTEXTS;

/**
 * The methods the developers ship, mirroring the migration's seed.
 * Array order is cosmetic; `sortOrder` is what the app sorts by.
 */
export const PAYMENT_METHOD_CATALOG: readonly PaymentMethodDefinition[] = [
  {
    id: "cash",
    nameAr: "نقداً",
    nameEn: "Cash",
    iconKey: "cash",
    isActive: true,
    sortOrder: 10,
    allowedContexts: ALL_CONTEXTS,
    ledgerKind: "CASH",
    defaultAccountCode: "1101",
    legacyValue: "cash",
  },
  {
    id: "credit",
    nameAr: "آجل",
    nameEn: "Credit",
    iconKey: "credit",
    isActive: true,
    sortOrder: 20,
    // آجل on a purchase means "we owe the supplier"; offering it while
    // collecting cash from a customer is meaningless.
    allowedContexts: ["pos", "sales", "purchases", "sales_returns", "purchase_returns"],
    ledgerKind: "CREDIT",
    defaultAccountCode: "1211",
    isCreditTerm: true,
    legacyValue: "credit",
  },
  {
    id: "bank_transfer",
    nameAr: "تحويل بنكي",
    nameEn: "Bank transfer",
    iconKey: "bank-transfer",
    isActive: true,
    sortOrder: 30,
    allowedContexts: ["pos", "sales", "purchases", "expenses", "customer_collection"],
    ledgerKind: "BANK",
    defaultAccountCode: "1111",
    requiresReference: true,
    legacyValue: "bank_transfer",
  },
  {
    id: "kuraimi_bank",
    nameAr: "بنك الكريمي",
    nameEn: "Al-Kuraimi Bank",
    iconKey: "kuraimi",
    isActive: true,
    sortOrder: 40,
    allowedContexts: ["pos", "sales", "purchases", "expenses", "customer_collection"],
    ledgerKind: "BANK",
    defaultAccountCode: "1111",
    requiresReference: true,
    legacyValue: "bank_transfer",
  },
  {
    id: "yemen_kuwait_bank",
    nameAr: "بنك اليمن الدولي",
    nameEn: "Yemen International Bank",
    iconKey: "bank",
    isActive: true,
    sortOrder: 50,
    allowedContexts: ["pos", "sales", "purchases", "expenses", "customer_collection"],
    ledgerKind: "BANK",
    defaultAccountCode: "1121",
    requiresReference: true,
    legacyValue: "bank_transfer",
  },
  {
    id: "jawali",
    nameAr: "جوالي",
    nameEn: "Jawali",
    iconKey: "mobile-money",
    isActive: true,
    sortOrder: 60,
    allowedContexts: ["pos", "sales", "purchases", "expenses", "customer_collection"],
    ledgerKind: "WALLET",
    requiresReference: true,
    legacyValue: "mobile_money",
  },
  {
    id: "jaib",
    nameAr: "جيب",
    nameEn: "Jaib Wallet",
    iconKey: "wallet",
    isActive: true,
    sortOrder: 70,
    allowedContexts: ["pos", "sales", "purchases", "expenses", "customer_collection"],
    ledgerKind: "WALLET",
    requiresReference: true,
    legacyValue: "mobile_money",
  },
  {
    id: "floosak",
    nameAr: "فلوسك",
    nameEn: "Floosak",
    iconKey: "wallet",
    isActive: true,
    sortOrder: 80,
    allowedContexts: ["pos", "sales", "purchases", "expenses", "customer_collection"],
    ledgerKind: "WALLET",
    requiresReference: true,
    legacyValue: "mobile_money",
  },
  {
    id: "one_cash",
    nameAr: "ون كاش",
    nameEn: "One Cash",
    iconKey: "wallet",
    isActive: true,
    sortOrder: 90,
    allowedContexts: ["pos", "sales", "purchases", "expenses", "customer_collection"],
    ledgerKind: "WALLET",
    requiresReference: true,
    legacyValue: "mobile_money",
  },
  {
    id: "card",
    nameAr: "بطاقة / شبكة",
    nameEn: "Card",
    iconKey: "card",
    isActive: true,
    sortOrder: 100,
    allowedContexts: ["pos", "sales", "purchases", "expenses", "customer_collection"],
    ledgerKind: "CARD",
    defaultAccountCode: "1111",
    legacyValue: "card",
  },
  {
    id: "mobile_money",
    nameAr: "محفظة إلكترونية",
    nameEn: "Mobile money",
    iconKey: "mobile-money",
    isActive: true,
    sortOrder: 110,
    allowedContexts: ["pos", "sales", "purchases", "expenses", "customer_collection"],
    ledgerKind: "WALLET",
    requiresReference: true,
    legacyValue: "mobile_money",
  },
  {
    // Not a tender the operator picks — it is what an invoice records when the
    // cashier split the payment across several methods. It lives in the
    // catalogue so historic split invoices get a name and an icon from the same
    // registry as everything else.
    id: "split",
    nameAr: "دفع بأكثر من طريقة",
    nameEn: "Split payment",
    iconKey: "split",
    isActive: true,
    sortOrder: 900,
    allowedContexts: ["pos", "sales"],
    ledgerKind: "OTHER",
    legacyValue: "split",
  },
];

/** Index for O(1) lookups. Built once at module load. */
const CATALOG_BY_ID = new Map<string, PaymentMethodDefinition>(
  PAYMENT_METHOD_CATALOG.map((m) => [m.id, m]),
);

/**
 * Index by the ENUM value a document stores, for labelling historic records.
 * The lowest `sortOrder` wins, so the canonical method represents a shared
 * legacy value: a document that merely says `bank_transfer` is labelled
 * "تحويل بنكي" and not "بنك الكريمي".
 */
const CATALOG_BY_LEGACY = new Map<string, PaymentMethodDefinition>();
for (const method of PAYMENT_METHOD_CATALOG) {
  const existing = CATALOG_BY_LEGACY.get(method.legacyValue);
  if (!existing || method.sortOrder < existing.sortOrder) {
    CATALOG_BY_LEGACY.set(method.legacyValue, method);
  }
}

export function getPaymentMethodDefinition(id: string): PaymentMethodDefinition | undefined {
  return CATALOG_BY_ID.get(id);
}

/**
 * The ENUM value a document must store for a catalogue id. An unknown id falls
 * back to itself, which is what the database already expects for the `split`
 * case and is the only honest answer for a value we do not recognise.
 */
export function toLegacyPaymentValue(id: string): LegacyPaymentValue {
  return CATALOG_BY_ID.get(id)?.legacyValue ?? (id as LegacyPaymentValue);
}

/** The catalogue id that represents an ENUM value found on an old document. */
export function toCatalogId(legacy: string | null | undefined): string | undefined {
  if (!legacy) return undefined;
  return CATALOG_BY_LEGACY.get(legacy)?.id;
}

/* ==========================================================================
   Icons — one registry, resolved locally, with a fallback chain
   ========================================================================== */

/**
 * iconKey -> component. Every entry is a small lucide icon already in the
 * bundle. There is deliberately no code path that loads an icon from a URL or
 * from storage: the customer never supplies an icon, and an icon can never 404.
 */
const ICON_REGISTRY: Record<string, LucideIcon> = {
  cash: Banknote,
  "bank-transfer": Landmark,
  bank: Building2,
  kuraimi: Landmark,
  "mobile-money": Smartphone,
  wallet: Wallet,
  card: CreditCard,
  credit: Coins,
  split: Coins,
  generic: Wallet,
};

/** Fallback by ledger kind, so a new method with an unknown key still looks right. */
const LEDGER_KIND_ICON: Record<LedgerKind, LucideIcon> = {
  CASH: Banknote,
  BANK: Landmark,
  WALLET: Wallet,
  CARD: CreditCard,
  CREDIT: Coins,
  OTHER: Wallet,
};

/**
 * Resolve the icon for a method. `iconKey` is tried first; if a future
 * migration introduces a key this build does not know, the ledger kind decides,
 * and the generic wallet is the last resort. Never throws, never renders empty.
 */
export function paymentMethodIcon(iconKey: string, ledgerKind?: LedgerKind): LucideIcon {
  return (
    ICON_REGISTRY[iconKey] ??
    (ledgerKind ? LEDGER_KIND_ICON[ledgerKind] : undefined) ??
    ICON_REGISTRY.generic
  );
}

/**
 * Tone class for an icon, derived from the ledger kind rather than from a
 * hand-written switch per screen. Keeps light and dark mode correct without a
 * second set of literals.
 */
export function paymentMethodIconTone(ledgerKind: LedgerKind | undefined): string {
  switch (ledgerKind) {
    case "CASH":
      return "text-emerald-600 dark:text-emerald-400";
    case "BANK":
      return "text-indigo-600 dark:text-indigo-400";
    case "WALLET":
      return "text-sky-600 dark:text-sky-400";
    case "CARD":
      return "text-blue-600 dark:text-blue-400";
    case "CREDIT":
      return "text-amber-600 dark:text-amber-400";
    default:
      return "text-muted-foreground";
  }
}

/* ==========================================================================
   Labels — for read-only display of historic documents
   ========================================================================== */

/**
 * The name of a payment value found on a stored document.
 *
 * Accepts EITHER a catalogue id or a raw ENUM value, because callers deal with
 * both: a settings screen has ids, a sales table has whatever the invoice
 * stored. An unrecognised value is returned verbatim rather than replaced with
 * a dash — a payment method we do not know about is information, not an error.
 */
export function paymentMethodLabel(
  value: string | null | undefined,
  lang: "ar" | "en" = "ar",
): string {
  if (!value) return "—";

  // A split sale stores 'split'; its tender breakdown lives in the note.
  if (value === "split") {
    return lang === "ar" ? "دفع بأكثر من طريقة" : "Split payment";
  }

  const def = CATALOG_BY_ID.get(value) ?? CATALOG_BY_LEGACY.get(value);
  if (!def) return value;

  return lang === "ar" ? def.nameAr : (def.nameEn ?? def.nameAr);
}

/**
 * Split detection, which used to be re-implemented inside the sales screen.
 * A split sale is either recorded as 'split', or as a single method whose note
 * carries the tender breakdown.
 */
export function isSplitPaymentValue(
  value: string | null | undefined,
  note?: string | null,
): boolean {
  if (value === "split") return true;
  if (!note) return false;
  return note.includes("[دفع مجزأ:") || note.includes("[Split:");
}

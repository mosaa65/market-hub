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
  Bitcoin,
  Building2,
  Coins,
  CreditCard,
  FileCheck2,
  Globe,
  HandCoins,
  Landmark,
  Layers,
  PiggyBank,
  Receipt,
  Scale,
  ScrollText,
  Smartphone,
  Store,
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
  "cash" | "card" | "bank_transfer" | "credit" | "mobile_money" | "split" | "cheque";

/**
 * A business's own wording and icon for a catalogue method, keyed by catalogue
 * id.
 *
 * Deliberately a plain lookup and not the full resolved row: a screen that only
 * has a stored ENUM value (a report, a printed invoice) still needs to render
 * the business's name, and it cannot join a catalogue it never loaded.
 */
export interface PaymentMethodOverride {
  nameAr: string;
  nameEn?: string;
  iconKey: string;
}

export type PaymentMethodOverrides = Record<string, PaymentMethodOverride>;

/**
 * The values a BUSINESS may bind a method it creates to.
 *
 * `split` is excluded on purpose: it means "this invoice was settled by more
 * than one method" and is written by the split engine, not chosen by an
 * operator. `credit` is excluded because آجل is the absence of a payment, and a
 * tenant-created method is a way of collecting one.
 */
export const TENANT_SELECTABLE_LEGACY_VALUES: readonly LegacyPaymentValue[] = [
  "cash",
  "card",
  "bank_transfer",
  "mobile_money",
  "cheque",
];

/**
 * The catalogue row a tenant may edit freely. Mirrors the migration's
 * `payment_methods.is_system`: a developer row may be renamed and re-iconed,
 * never re-pointed; a tenant row may be edited and removed.
 */
export interface PaymentMethodProvenance {
  isSystem: boolean;
  /** A developer row whose label no longer matches the shipped Arabic name. */
  isRenamed?: boolean;
}

/**
 * The catalogue REPLACES its developer definition once the database answers.
 * Exported so the hook's doc comment can point at a type rather than scrub the
 * difference in prose.
 */
export type PaymentMethodSource = "database" | "fallback";

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
    // A cheque clears through the bank, so it settles as `bank_transfer` while
    // keeping its own name and icon. It shipped in the migration seed from the
    // start (`20261208000000` section 1) — its absence here meant a database
    // that had the migration applied showed "شيك" with no label and no icon.
    id: "cheque",
    nameAr: "شيك",
    nameEn: "Cheque",
    // The applied database seed uses `bank-transfer`; keep it aligned until a
    // forward migration deliberately changes the stored icon key.
    iconKey: "bank-transfer",
    isActive: true,
    sortOrder: 120,
    allowedContexts: ["pos", "sales", "purchases", "expenses", "customer_collection"],
    ledgerKind: "BANK",
    defaultAccountCode: "1111",
    requiresReference: true,
    legacyValue: "cheque",
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

/** The developer definition of a method, ignoring any tenant override. */
export function getShippedPaymentMethod(id: string): PaymentMethodDefinition | undefined {
  return CATALOG_BY_ID.get(id);
}

/**
 * Is this an id the developers shipped, as opposed to one a business created?
 * The settings screen uses it to decide whether to offer Delete (tenant) or
 * only Disable (developer).
 */
export function isShippedPaymentMethod(id: string): boolean {
  return CATALOG_BY_ID.has(id);
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

/* ============================================================================
   Icons — one registry, resolved locally, with a fallback chain
   ============================================================================ */

/**
 * iconKey -> bundled component. Tenant-provided URLs and uploads are never
 * accepted. Locally supplied Yemeni wallet SVGs are selected through the
 * separate method-id asset registry below, only for positively identified brands.
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
  cheque: FileCheck2,
  exchange: Scale,
  "exchange-house": Store,
  "digital-wallet": Bitcoin,
  savings: PiggyBank,
  transfer: Globe,
  share: Layers,
  contract: ScrollText,
  invoice: Receipt,
  agent: HandCoins,
  generic: Wallet,
};

/** Only confidently identified, checked-in Yemeni wallet assets are registered by stable method id. */
export const PAYMENT_METHOD_ICON_ASSETS = {
  floosak: { src: "/yemeni_wallet_icons_svg/floosak.svg", alt: "Floosak" },
  one_cash: { src: "/yemeni_wallet_icons_svg/one-cash.svg", alt: "One Cash" },
  jaib: { src: "/yemeni_wallet_icons_svg/jaib.svg", alt: "Jaib" },
} as const;

export function paymentMethodIconAsset(methodId?: string | null) {
  return methodId
    ? PAYMENT_METHOD_ICON_ASSETS[methodId as keyof typeof PAYMENT_METHOD_ICON_ASSETS]
    : undefined;
}

/**
 * The icon keys the settings screen offers when a business creates or re-icons a
 * method. Every entry is already in the bundle, so this list is a convenience
 * over `ICON_REGISTRY`, never a second source of truth: a key the database
 * holds but this build does not know still resolves through the fallback chain
 * in `paymentMethodIcon`.
 */
export const PAYMENT_ICON_CHOICES: readonly { key: string; labelAr: string; labelEn: string }[] = [
  { key: "cash", labelAr: "نقد", labelEn: "Cash" },
  { key: "bank", labelAr: "بنك", labelEn: "Bank" },
  { key: "bank-transfer", labelAr: "حوالة", labelEn: "Transfer" },
  { key: "kuraimi", labelAr: "مبنى بنكي", labelEn: "Bank building" },
  { key: "cheque", labelAr: "شيك", labelEn: "Cheque" },
  { key: "card", labelAr: "بطاقة", labelEn: "Card" },
  { key: "wallet", labelAr: "محفظة", labelEn: "Wallet" },
  { key: "mobile-money", labelAr: "هاتف/محفظة", labelEn: "Mobile wallet" },
  { key: "digital-wallet", labelAr: "محفظة رقمية", labelEn: "Digital wallet" },
  { key: "savings", labelAr: "توفير", labelEn: "Savings" },
  { key: "exchange", labelAr: "صرافة", labelEn: "Exchange" },
  { key: "exchange-house", labelAr: "شركة صرافة", labelEn: "Exchange house" },
  { key: "transfer", labelAr: "تحويل دولي", labelEn: "International" },
  { key: "share", labelAr: "تجميع", labelEn: "Aggregate" },
  { key: "contract", labelAr: "عقد", labelEn: "Contract" },
  { key: "invoice", labelAr: "فاتورة", labelEn: "Invoice" },
  { key: "agent", labelAr: "وكيل", labelEn: "Agent" },
  { key: "credit", labelAr: "آجل", labelEn: "Credit" },
  { key: "generic", labelAr: "عام", labelEn: "Generic" },
];

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
 *
 * `overrides` is the tenant's own naming layer. A business that renamed
 * بنك الكريمي to «حوالات صنعاء» must see its own word in every table, report
 * and printed document — otherwise the same money would read differently on two
 * screens. Keyed by catalogue id, so it survives a shared stored value: two
 * business methods may both resolve to `bank_transfer` while the generic
 * «تحويل بنكي» keeps its own row untouched.
 *
 * Signature note: the extra parameters are tolerated rather than required.
 * React Query calls a `queryFn` with a context object, and callers in this
 * project pass label helpers directly into memoized pipelines, so this function
 * accepts being invoked with arguments it does not want.
 */
export function paymentMethodLabel(
  value: string | null | undefined,
  lang: "ar" | "en" = "ar",
  overrides?: PaymentMethodOverrides | null,
): string {
  if (!value) return "—";

  // A split sale stores 'split'; its tender breakdown lives in the note.
  if (value === "split") {
    return lang === "ar" ? "دفع بأكثر من طريقة" : "Split payment";
  }

  // A catalogue id is checked first: an override is keyed by id, and an id is
  // also what the settings screen hands in. Falling back to the legacy index
  // keeps a raw ENUM value from an old document working.
  const byId = CATALOG_BY_ID.get(value);
  const override = overrides?.[value] ?? (byId ? overrides?.[byId.id] : undefined);
  if (override) {
    return lang === "ar" ? override.nameAr : (override.nameEn ?? override.nameAr);
  }

  const def = byId ?? CATALOG_BY_LEGACY.get(value);
  if (!def) return value;

  return lang === "ar" ? def.nameAr : (def.nameEn ?? def.nameAr);
}

/**
 * The name to render for a stored document value, preferring the tenant's own
 * wording when the method it belongs to has one.
 *
 * This is the function a table cell, a report or a print template should call.
 * It exists because a stored value alone cannot identify which of two methods
 * sharing it the operator actually used — the caller must pass the catalogue id
 * when it knows it (a settings row, a picker) and accept the generic name when
 * it does not (a historic invoice that never recorded the institution).
 */
export function paymentMethodDisplayName(
  value: string | null | undefined,
  lang: "ar" | "en",
  overrides?: PaymentMethodOverrides | null,
): string {
  return paymentMethodLabel(value, lang, overrides);
}

/**
 * Is this method showing a name or an icon the business chose, rather than the
 * one the developers shipped?
 *
 * Used by the settings screen to show "معدّلة" and offer a reset. Compared
 * against the developer catalogue rather than against a stored copy, so the
 * comparison stays correct after a migration improves a shipped label.
 */
export function hasAuthoredIdentity(method: {
  id: string;
  nameAr: string;
  nameEn?: string;
  iconKey: string;
}): boolean {
  const shipped = CATALOG_BY_ID.get(method.id);
  if (!shipped) return true; // a tenant-created method is authored by definition
  return (
    shipped.nameAr !== method.nameAr ||
    (shipped.nameEn ?? "") !== (method.nameEn ?? "") ||
    shipped.iconKey !== method.iconKey
  );
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

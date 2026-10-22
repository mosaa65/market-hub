/**
 * POS payment fields — the right-hand column's "how was this paid" block.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * THE LAYOUT CONTRACT
 * ════════════════════════════════════════════════════════════════════════════
 * The field column is narrow (a third of the cart on a desktop, the full width
 * of a phone in landscape). Three controls squeezed into one row — method,
 * paid, discount — produced 8px type and labels that the method icon sat on
 * top of. So the block is stacked, once and for all:
 *
 *   أ) طريقة الدفع  (full row — a deliberate choice, not a leftover cell)
 *   ب) المرجع / الإشعار  (only when the method needs one, full row)
 *   ج) المبلغ المدفوع · الخصم  (the two amounts, side by side below)
 *
 * ════════════════════════════════════════════════════════════════════════════
 * WHY THE METHOD IS A DIALOG, NOT A <select>
 * ════════════════════════════════════════════════════════════════════════════
 * A method is not enough information to post a payment: نقدًا must name a
 * cashbox, تحويل بنكي a bank account, محفظة a wallet. A native <select> closes
 * the moment it is clicked, so choosing "محفظة" used to lock the form before
 * the operator could say WHICH wallet — and the only way back was to reopen
 * the whole thing.
 *
 * The dialog here keeps the form OPEN: the tender type is chosen in the header,
 * and the available cashboxes / banks / wallets of the system are listed
 * underneath as pickable cards. One click on a card is the payment method.
 * A method that needs no second decision (بطاقة، شيك، آجل) is one click in the
 * list and the dialog closes with that method selected.
 *
 * Every list is read from the live treasury hooks, so the counter only ever
 * offers accounts that exist: `useCashboxes` → الصناديق, and
 * `useCompanyBankAccounts` → البنوك (kind = BANK) و المحافظ (kind = WALLET).
 * With nothing configured yet, the known Yemeni wallets still appear (an
 * operator can take the money before the chart of accounts is filled in) —
 * flagged as غير مرتبط بحساب rather than silently posted to a default.
 */

import { useMemo, useState, type ReactNode } from "react";
import {
  Banknote,
  Check,
  ChevronDown,
  CreditCard,
  FileCheck2,
  Landmark,
  Layers,
  Smartphone,
  Wallet,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { money } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { AmountInput } from "@/components/commerce/amount-input";
import { PaymentMethodIcon } from "@/components/ui/payment-method/payment-method-icon";
import { paymentMethodIconAsset } from "@/lib/payments/payment-methods";
import type {
  ResolvedPaymentMethod,
} from "@/hooks/use-payment-methods";
import type {
  Cashbox,
  CompanyBankAccount,
  PaymentSettlementSelection,
} from "@/lib/payments/treasury-types";

/* ────────────────────────────── tender kinds ────────────────────────────── */

export type PosTenderKind = "CASH" | "BANK" | "WALLET" | "CARD" | "CHEQUE" | "CREDIT";

const TENDER_KINDS: Array<{
  id: PosTenderKind;
  labelAr: string;
  labelEn: string;
  icon: typeof Banknote;
  iconClassName: string;
  activeClassName: string;
}> = [
    {
      id: "CASH",
      labelAr: "نقدًا",
      labelEn: "Cash",
      icon: Banknote,
      iconClassName: "text-emerald-600",
      activeClassName: "border-emerald-500 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    },
    {
      id: "BANK",
      labelAr: "بنك",
      labelEn: "Bank",
      icon: Landmark,
      iconClassName: "text-indigo-600",
      activeClassName: "border-indigo-500 bg-indigo-500/10 text-indigo-700 dark:text-indigo-300",
    },
    {
      id: "WALLET",
      labelAr: "محفظة",
      labelEn: "Wallet",
      icon: Smartphone,
      iconClassName: "text-sky-600",
      activeClassName: "border-sky-500 bg-sky-500/10 text-sky-700 dark:text-sky-300",
    },
    {
      id: "CARD",
      labelAr: "شبكة",
      labelEn: "Card",
      icon: CreditCard,
      iconClassName: "text-violet-600",
      activeClassName: "border-violet-500 bg-violet-500/10 text-violet-700 dark:text-violet-300",
    },
    {
      id: "CHEQUE",
      labelAr: "شيك",
      labelEn: "Cheque",
      icon: FileCheck2,
      iconClassName: "text-amber-600",
      activeClassName: "border-amber-500 bg-amber-500/10 text-amber-700 dark:text-amber-300",
    },
    {
      id: "CREDIT",
      labelAr: "آجل",
      labelEn: "Credit",
      icon: Layers,
      iconClassName: "text-slate-600",
      activeClassName: "border-slate-500 bg-slate-500/10 text-slate-700 dark:text-slate-300",
    },
  ];

/** Known Yemeni wallets, kept for businesses whose chart of accounts is not yet linked. */
const KNOWN_WALLETS = [
  { id: "jaib", labelAr: "محفظة جيب", labelEn: "Jaib Wallet", match: "جيب" },
  { id: "floosak", labelAr: "محفظة فلوسك", labelEn: "Floosak", match: "فلوسك" },
  { id: "one_cash", labelAr: "محفظة ون كاش", labelEn: "One Cash", match: "كاش" },
  { id: "jawali", labelAr: "محفظة جوالي", labelEn: "Jawali", match: "جوالي" },
] as const;

/** The wallet id a company account represents, by name — the catalogue's convention. */
function walletIdForAccount(account: CompanyBankAccount | undefined): string {
  if (!account) return "jawali";
  const name = `${account.name_ar} ${account.name_en ?? ""} ${account.bank_name ?? ""}`;
  if (name.includes("جيب") || /jaib/i.test(name)) return "jaib";
  if (name.includes("فلوسك") || /floosak/i.test(name)) return "floosak";
  if (name.includes("ون كاش") || /one ?cash/i.test(name)) return "one_cash";
  return "jawali";
}

function bankMethodIdForAccount(
  account: CompanyBankAccount | undefined,
  banks: readonly ResolvedPaymentMethod[],
): string {
  if (!account) return "bank_transfer";
  const name = `${account.name_ar} ${account.bank_name ?? ""}`;
  const named = banks.find(
    (method) =>
      method.ledgerKind === "BANK" &&
      method.id !== "bank_transfer" &&
      (name.includes(method.nameAr) || (method.nameEn ? name.includes(method.nameEn) : false)),
  );
  if (named) return named.id;
  if (name.includes("كريمي") || /kuraimi/i.test(name)) return "kuraimi_bank";
  return "bank_transfer";
}

/** The tender kind a catalogue method belongs to. */
export function tenderKindOf(method: ResolvedPaymentMethod | undefined): PosTenderKind {
  if (!method) return "CASH";
  if (method.isCreditTerm || method.ledgerKind === "CREDIT") return "CREDIT";
  if (method.ledgerKind === "BANK") return "BANK";
  if (method.ledgerKind === "WALLET") return "WALLET";
  if (method.legacyValue === "cash") return "CASH";
  if (method.legacyValue === "card") return "CARD";
  if (method.legacyValue === "cheque") return "CHEQUE";
  return "CASH";
}

/* ───────────────────────────── payment method field ─────────────────────── */

export interface PosMethodFieldProps {
  methods: ResolvedPaymentMethod[];
  settlement: PaymentSettlementSelection;
  onChange: (next: PaymentSettlementSelection) => void;
  holdsCashboxes: Cashbox[];
  defaultCashbox?: Cashbox;
  banks: CompanyBankAccount[];
  defaultBank?: CompanyBankAccount;
  wallets: CompanyBankAccount[];
  defaultWallet?: CompanyBankAccount;
  isSplit: boolean;
  splitCount: number;
  onOpenSplit: () => void;
  disabled?: boolean;
}

export function PosMethodField({
  methods,
  settlement,
  onChange,
  holdsCashboxes,
  defaultCashbox,
  banks,
  defaultBank,
  wallets,
  defaultWallet,
  isSplit,
  splitCount,
  onOpenSplit,
  disabled = false,
}: PosMethodFieldProps) {
  const { lang } = useI18n();
  const isAr = lang === "ar";
  const [open, setOpen] = useState(false);

  const selected = methods.find((method) => method.id === settlement.paymentMethodId);
  const activeKind: PosTenderKind = isSplit
    ? "CASH"
    : tenderKindOf(selected ?? methods.find((method) => method.id === "cash"));
  const kindMeta = TENDER_KINDS.find((kind) => kind.id === activeKind) ?? TENDER_KINDS[0];
  const KindIcon = kindMeta.icon;

  // The account shown on the closed field, resolved the same way the dialog
  // resolves it, so what the cashier reads is what will be posted.
  const receiverName = useMemo(() => {
    if (activeKind === "CASH") {
      const box = holdsCashboxes.find((b) => b.id === settlement.cashboxId) ?? defaultCashbox;
      return box?.name_ar ?? (isAr ? "الصندوق الرئيسي" : "Main till");
    }
    if (activeKind === "BANK") {
      const bank = banks.find((b) => b.id === settlement.bankAccountId) ?? defaultBank;
      return bank?.name_ar ?? (isAr ? "تحويل بنكي" : "Bank transfer");
    }
    if (activeKind === "WALLET") {
      const account = wallets.find((w) => w.id === settlement.bankAccountId) ?? defaultWallet;
      if (account) return account.name_ar;
      const known = KNOWN_WALLETS.find((w) => w.id === settlement.paymentMethodId);
      return known ? (isAr ? known.labelAr : known.labelEn) : isAr ? "محفظة" : "Wallet";
    }
    if (activeKind === "CHEQUE") return isAr ? "شيك بنكي" : "Bank cheque";
    if (activeKind === "CREDIT") return isAr ? "ذمة على العميل" : "Customer credit";
    return isAr ? "شبكة / بطاقة" : "Card";
  }, [
    activeKind,
    settlement,
    holdsCashboxes,
    defaultCashbox,
    banks,
    defaultBank,
    wallets,
    defaultWallet,
    isAr,
  ]);

  function commit(next: PaymentSettlementSelection) {
    onChange(next);
    setOpen(false);
  }

  function chooseCashbox(box: Cashbox) {
    commit({
      ...settlement,
      method: "cash",
      paymentMethodId: "cash",
      cashboxId: box.id,
      cashboxName: box.name_ar,
      chartAccountId: box.account_id,
      bankAccountId: null,
      bankAccountName: null,
    });
  }

  function chooseBank(account: CompanyBankAccount) {
    commit({
      ...settlement,
      method: "bank_transfer",
      paymentMethodId: bankMethodIdForAccount(account, methods),
      bankAccountId: account.id,
      bankAccountName: account.name_ar,
      chartAccountId: account.account_id,
      cashboxId: null,
      cashboxName: null,
    });
  }

  function chooseWallet(account: CompanyBankAccount) {
    const id = walletIdForAccount(account);
    commit({
      ...settlement,
      method: "mobile_money",
      paymentMethodId: id,
      bankAccountId: account.id,
      bankAccountName: account.name_ar,
      chartAccountId: account.account_id,
      cashboxId: null,
      cashboxName: null,
    });
  }

  function chooseWalletWithoutAccount(id: string) {
    const known = KNOWN_WALLETS.find((wallet) => wallet.id === id)!;
    commit({
      ...settlement,
      method: "mobile_money",
      paymentMethodId: id,
      bankAccountName: isAr ? known.labelAr : known.labelEn,
      bankAccountId: null,
      cashboxId: null,
      cashboxName: null,
    });
  }

  function choosePlainMethod(method: ResolvedPaymentMethod) {
    commit({
      ...settlement,
      method: method.legacyValue,
      paymentMethodId: method.id,
      cashboxId: null,
      cashboxName: null,
      bankAccountId: null,
      bankAccountName: null,
      chartAccountId: null,
    });
  }

  return (
    <>
      {/* Closed field: one line, always readable, never squeezed by the amounts. */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          if (isSplit) onOpenSplit();
          else setOpen(true);
        }}
        aria-haspopup="dialog"
        aria-label={isAr ? "طريقة الدفع" : "Payment method"}
        className={cn(
          "flex min-h-10 w-full min-w-0 items-center gap-2 rounded-xl border px-2.5 py-1.5 text-start transition",
          "outline-none focus-visible:ring-2 focus-visible:ring-primary/30 disabled:opacity-50",
          isSplit
            ? "border-primary/50 bg-primary/10 text-primary"
            : "border-border/80 bg-background hover:border-primary/40 hover:bg-primary/[0.03]",
        )}
      >
        {isSplit ? (
          <span className="grid size-6 shrink-0 place-items-center rounded-lg bg-primary/15 text-primary">
            <Layers className="size-3.5" />
          </span>
        ) : (
          <span
            className={cn(
              "grid size-6 shrink-0 place-items-center rounded-lg bg-muted",
              kindMeta.iconClassName,
            )}
          >
            <KindIcon className="size-3.5" />
          </span>
        )}
        <span className="flex min-w-0 flex-1 flex-col leading-tight">
          <span className="truncate text-[12px] font-bold text-foreground">
            {isSplit
              ? isAr
                ? "دفع مجزأ على عدة طرق"
                : "Split payment"
              : isAr
                ? kindMeta.labelAr
                : kindMeta.labelEn}
          </span>
          <span className="truncate text-[10px] font-medium text-muted-foreground">
            {isSplit
              ? isAr
                ? `${splitCount} طرق · اضغط للتعديل`
                : `${splitCount} methods · tap to edit`
              : receiverName}
          </span>
        </span>
        <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
      </button>

      {open && (
        <PosMethodDialog
          methods={methods}
          initialKind={activeKind}
          selected={settlement}
          onClose={() => setOpen(false)}
          onCashbox={chooseCashbox}
          onBank={chooseBank}
          onWallet={chooseWallet}
          onWalletWithoutAccount={chooseWalletWithoutAccount}
          onMethod={choosePlainMethod}
          holdsCashboxes={holdsCashboxes}
          defaultCashbox={defaultCashbox}
          banks={banks}
          wallets={wallets}
        />
      )}
    </>
  );
}

/* ───────────────────────────── the dialog body ──────────────────────────── */

interface PosMethodDialogProps {
  methods: ResolvedPaymentMethod[];
  initialKind: PosTenderKind;
  selected: PaymentSettlementSelection;
  onClose: () => void;
  onCashbox: (box: Cashbox) => void;
  onBank: (account: CompanyBankAccount) => void;
  onWallet: (account: CompanyBankAccount) => void;
  onWalletWithoutAccount: (walletId: string) => void;
  onMethod: (method: ResolvedPaymentMethod) => void;
  holdsCashboxes: Cashbox[];
  defaultCashbox?: Cashbox;
  banks: CompanyBankAccount[];
  wallets: CompanyBankAccount[];
}

function ChoiceCard({
  active,
  onClick,
  icon,
  title,
  subtitle,
  tone = "primary",
}: {
  active: boolean;
  onClick: () => void;
  icon: ReactNode;
  title: string;
  subtitle?: string | null;
  tone?: "primary" | "emerald" | "indigo" | "sky";
}) {
  const activeTone = {
    primary: "border-primary/60 bg-primary/[0.07] ring-primary/20",
    emerald: "border-emerald-500/60 bg-emerald-500/[0.07] ring-emerald-500/20",
    indigo: "border-indigo-500/60 bg-indigo-500/[0.07] ring-indigo-500/20",
    sky: "border-sky-500/60 bg-sky-500/[0.07] ring-sky-500/20",
  }[tone];

  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      className={cn(
        "flex min-h-12 w-full min-w-0 items-center gap-2.5 rounded-xl border px-2.5 py-2 text-start transition",
        "outline-none focus-visible:ring-2 focus-visible:ring-primary/30",
        active
          ? cn(activeTone, "ring-1")
          : "border-border/70 bg-card hover:border-primary/40 hover:bg-muted/40",
      )}
    >
      <span className="grid size-7 shrink-0 place-items-center overflow-hidden rounded-lg bg-muted/60">
        {icon}
      </span>
      <span className="flex min-w-0 flex-1 flex-col leading-tight">
        <span className="truncate text-[12px] font-bold text-foreground">{title}</span>
        {subtitle ? (
          <span className="truncate font-mono text-[10px] text-muted-foreground">{subtitle}</span>
        ) : null}
      </span>
      {active ? <Check className="size-3.5 shrink-0 text-primary" /> : null}
    </button>
  );
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <p className="px-0.5 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
      {children}
    </p>
  );
}

function PosMethodDialog({
  methods,
  initialKind,
  selected,
  onClose,
  onCashbox,
  onBank,
  onWallet,
  onWalletWithoutAccount,
  onMethod,
  holdsCashboxes,
  defaultCashbox,
  banks,
  wallets,
}: PosMethodDialogProps) {
  const { lang } = useI18n();
  const isAr = lang === "ar";
  const [kind, setKind] = useState<PosTenderKind>(initialKind);

  // A tender type is only offered when the business enabled at least one
  // method of that type for the POS.
  const available = useMemo(() => {
    const kinds = new Set<PosTenderKind>();
    for (const method of methods) kinds.add(tenderKindOf(method));
    return TENDER_KINDS.filter((tender) => kinds.has(tender.id));
  }, [methods]);

  const plainMethods = useMemo(
    () =>
      methods.filter((method) => {
        const methodKind = tenderKindOf(method);
        return methodKind === "CARD" || methodKind === "CHEQUE" || methodKind === "CREDIT";
      }),
    [methods],
  );

  const orderedCashboxes = useMemo(() => {
    const list = [...holdsCashboxes];
    list.sort((a, b) => Number(b.is_default) - Number(a.is_default));
    return list;
  }, [holdsCashboxes]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={isAr ? "اختيار طريقة الدفع" : "Choose payment method"}
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-2 backdrop-blur-[2px] sm:items-center"
      onClick={onClose}
    >
      <div
        dir={isAr ? "rtl" : "ltr"}
        onClick={(event) => event.stopPropagation()}
        className="flex max-h-[92dvh] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-border/80 bg-surface shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-2 border-b border-border/70 bg-gradient-to-r from-primary/[0.06] to-transparent px-3 py-2.5">
          <div className="min-w-0">
            <h2 className="text-sm font-bold text-foreground">
              {isAr ? "طريقة الدفع" : "Payment method"}
            </h2>
            <p className="text-[11px] text-muted-foreground">
              {isAr
                ? "اختر النوع ثم الحساب المستلم — يبقى النموذج مفتوحاً حتى التأكيد"
                : "Pick the type, then the receiving account"}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={isAr ? "إغلاق" : "Close"}
            className="shrink-0 rounded-lg px-2 py-1 text-[11px] font-semibold text-muted-foreground transition hover:bg-muted hover:text-foreground"
          >
            {isAr ? "إغلاق" : "Close"}
          </button>
        </div>

        {/* Tender types */}
        <div className="grid grid-cols-3 gap-1.5 border-b border-border/60 px-3 py-2">
          {available.map((tender) => {
            const Icon = tender.icon;
            const active = tender.id === kind;
            return (
              <button
                key={tender.id}
                type="button"
                aria-pressed={active}
                onClick={() => setKind(tender.id)}
                className={cn(
                  "flex min-h-9 items-center justify-center gap-1.5 rounded-xl border px-1 text-[11px] font-bold transition",
                  active
                    ? tender.activeClassName
                    : "border-border/60 bg-background text-muted-foreground hover:border-primary/30 hover:text-foreground",
                )}
              >
                <Icon className={cn("size-3.5 shrink-0", !active && tender.iconClassName)} />
                <span className="truncate">{isAr ? tender.labelAr : tender.labelEn}</span>
              </button>
            );
          })}
        </div>

        {/* Accounts of the chosen type */}
        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2.5">
          {kind === "CASH" && (
            <div className="space-y-1.5">
              <SectionLabel>{isAr ? "الصناديق النقدية" : "Cashboxes"}</SectionLabel>
              <div role="radiogroup" className="grid gap-1.5 sm:grid-cols-2">
                {orderedCashboxes.length === 0 && (
                  <ChoiceCard
                    active
                    onClick={() =>
                      onMethod({
                        id: "cash",
                        nameAr: "نقدًا",
                        nameEn: "Cash",
                        iconKey: "cash",
                        ledgerKind: "CASH",
                        legacyValue: "cash",
                      } as ResolvedPaymentMethod)
                    }
                    icon={<Wallet className="size-4 text-emerald-600" />}
                    title={isAr ? "الصندوق الرئيسي" : "Main till"}
                    subtitle={isAr ? "بدون صندوق مُعرّف" : "No cashbox configured"}
                    tone="emerald"
                  />
                )}
                {orderedCashboxes.map((box) => (
                  <ChoiceCard
                    key={box.id}
                    active={selected.cashboxId === box.id && selected.method === "cash"}
                    onClick={() => onCashbox(box)}
                    icon={<Wallet className="size-4 text-emerald-600" />}
                    title={box.name_ar}
                    subtitle={[box.code, box.is_default ? (isAr ? "افتراضي" : "Default") : null]
                      .filter(Boolean)
                      .join(" · ")}
                    tone="emerald"
                  />
                ))}
              </div>
              {holdsCashboxes.length === 1 && holdsCashboxes[0].id === defaultCashbox?.id ? null : (
                <p className="px-0.5 text-[10px] text-muted-foreground">
                  {isAr
                    ? "المبلغ سيُودَع في الصندوق المحدد ويُظهر في تقرير الصندوق."
                    : "The amount is posted to the selected till."}
                </p>
              )}
            </div>
          )}

          {kind === "BANK" && (
            <div className="space-y-1.5">
              <SectionLabel>{isAr ? "الحسابات البنكية المتاحة" : "Available bank accounts"}</SectionLabel>
              <div role="radiogroup" className="grid gap-1.5 sm:grid-cols-2">
                {banks.length === 0 && (
                  <ChoiceCard
                    active={selected.method === "bank_transfer" && !selected.bankAccountId}
                    onClick={() =>
                      onMethod({
                        id: "bank_transfer",
                        nameAr: "تحويل بنكي",
                        nameEn: "Bank transfer",
                        iconKey: "bank-transfer",
                        ledgerKind: "BANK",
                        legacyValue: "bank_transfer",
                        requiresReference: true,
                      } as ResolvedPaymentMethod)
                    }
                    icon={<Landmark className="size-4 text-indigo-600" />}
                    title={isAr ? "تحويل بنكي (عام)" : "Bank transfer"}
                    subtitle={isAr ? "بدون حساب بنكي مُعرّف" : "No bank account configured"}
                    tone="indigo"
                  />
                )}
                {banks.map((account) => (
                  <ChoiceCard
                    key={account.id}
                    active={selected.bankAccountId === account.id && selected.method === "bank_transfer"}
                    onClick={() => onBank(account)}
                    icon={<Landmark className="size-4 text-indigo-600" />}
                    title={account.name_ar}
                    subtitle={account.account_number || account.bank_name || null}
                    tone="indigo"
                  />
                ))}
              </div>
            </div>
          )}

          {kind === "WALLET" && (
            <div className="space-y-1.5">
              <SectionLabel>{isAr ? "المحافظ الإلكترونية المتاحة" : "Available wallets"}</SectionLabel>
              <div role="radiogroup" className="grid gap-1.5 sm:grid-cols-2">
                {wallets.map((account) => {
                  const walletId = walletIdForAccount(account);
                  const asset = paymentMethodIconAsset(walletId);
                  return (
                    <ChoiceCard
                      key={account.id}
                      active={selected.bankAccountId === account.id}
                      onClick={() => onWallet(account)}
                      icon={
                        asset ? (
                          <img src={asset.src} alt={asset.alt} className="size-5 object-contain" />
                        ) : (
                          <Smartphone className="size-4 text-sky-600" />
                        )
                      }
                      title={account.name_ar}
                      subtitle={
                        account.account_number || (isAr ? "حساب محفظة" : "Wallet account")
                      }
                      tone="sky"
                    />
                  );
                })}

                {/* A wallet the business has not linked to an account yet still
                    has to be selectable — the cash was received either way. */}
                {KNOWN_WALLETS.filter(
                  (wallet) => !wallets.some((account) => walletIdForAccount(account) === wallet.id),
                ).map((wallet) => {
                  const asset = paymentMethodIconAsset(wallet.id);
                  return (
                    <ChoiceCard
                      key={wallet.id}
                      active={selected.paymentMethodId === wallet.id && !selected.bankAccountId}
                      onClick={() => onWalletWithoutAccount(wallet.id)}
                      icon={
                        asset ? (
                          <img src={asset.src} alt={asset.alt} className="size-5 object-contain" />
                        ) : (
                          <Smartphone className="size-4 text-sky-600" />
                        )
                      }
                      title={isAr ? wallet.labelAr : wallet.labelEn}
                      subtitle={isAr ? "غير مرتبط بحساب" : "Not linked to an account"}
                      tone="sky"
                    />
                  );
                })}
              </div>
            </div>
          )}

          {(kind === "CARD" || kind === "CHEQUE" || kind === "CREDIT") && (
            <div className="space-y-1.5">
              <SectionLabel>{isAr ? "اختر طريقة الدفع" : "Choose the method"}</SectionLabel>
              <div role="radiogroup" className="grid gap-1.5">
                {(plainMethods.filter((method) => tenderKindOf(method) === kind).length > 0
                  ? plainMethods.filter((method) => tenderKindOf(method) === kind)
                  : methods.filter((method) => tenderKindOf(method) === kind)
                ).map((method) => (
                  <ChoiceCard
                    key={method.id}
                    active={selected.paymentMethodId === method.id}
                    onClick={() => onMethod(method)}
                    icon={
                      <PaymentMethodIcon
                        iconKey={method.iconKey}
                        methodId={method.id}
                        ledgerKind={method.ledgerKind}
                        className="size-4"
                      />
                    }
                    title={isAr ? method.nameAr : (method.nameEn ?? method.nameAr)}
                    subtitle={
                      method.isCreditTerm
                        ? isAr
                          ? "لا يُحصَّل مبلغ الآن"
                          : "Nothing collected now"
                        : null
                    }
                  />
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="border-t border-border/70 bg-muted/30 px-3 py-2 text-center text-[10px] text-muted-foreground">
          {isAr
            ? "اختيار النوع فقط لا يغلق النموذج — اضغط على الحساب المستلم لإتمام الاختيار."
            : "Choosing a type keeps the form open — pick the account to confirm."}
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────── paid & discount fields ─────────────────────── */

export interface PosAmountsRowProps {
  paidLabel: string;
  discountLabel: string;
  paid: string;
  onPaidChange: (value: string) => void;
  discount: string;
  onDiscountChange: (value: string) => void;
  isSplit: boolean;
  splitPaidTotal: number;
  isOverpaid: boolean;
  onEditSplit: () => void;
  paidDisabled?: boolean;
}

export function PosAmountsRow({
  paidLabel,
  discountLabel,
  paid,
  onPaidChange,
  discount,
  onDiscountChange,
  isSplit,
  splitPaidTotal,
  isOverpaid,
  onEditSplit,
  paidDisabled = false,
}: PosAmountsRowProps) {
  const { lang } = useI18n();
  const isAr = lang === "ar";
  const fieldClass =
    "h-10 min-w-0 rounded-xl border border-border/80 bg-background px-2.5 text-xs font-bold outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-60";

  return (
    <div className="grid min-w-0 grid-cols-2 items-start gap-2">
      <div className="flex min-w-0 flex-col gap-1">
        <span className="truncate text-[10px] font-bold text-muted-foreground">{paidLabel}</span>
        {isSplit ? (
          <button
            type="button"
            onClick={onEditSplit}
            className="flex h-10 min-w-0 items-center justify-between gap-1 rounded-xl border border-primary/40 bg-primary/[0.06] px-2.5 text-start font-mono text-xs font-bold text-primary transition hover:bg-primary/10"
            title={isAr ? "تعديل توزيع الدفعات" : "Edit payment allocation"}
          >
            <span className="truncate">{money(splitPaidTotal)}</span>
            <ChevronDown className="size-3.5 shrink-0" />
          </button>
        ) : (
          <AmountInput
            label={paidLabel}
            dir={isAr ? "rtl" : "ltr"}
            value={paid}
            onValueChange={onPaidChange}
            disabled={paidDisabled}
            invalid={isOverpaid}
            data-form-nav
            placeholder="0.00"
            className={fieldClass}
          />
        )}
      </div>

      <div className="flex min-w-0 flex-col gap-1">
        <span className="truncate text-[10px] font-bold text-muted-foreground">{discountLabel}</span>
        <AmountInput
          label={discountLabel}
          dir={isAr ? "rtl" : "ltr"}
          value={discount}
          onValueChange={onDiscountChange}
          data-form-nav
          placeholder="0.00"
          className={fieldClass}
        />
      </div>
    </div>
  );
}

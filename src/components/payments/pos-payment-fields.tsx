/**
 * POS payment fields — the cart column's "how was this paid" block.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * THE LAYOUT CONTRACT
 * ════════════════════════════════════════════════════════════════════════════
 * The field column is narrow (a third of the screen on desktop, the full width
 * of a phone in landscape). Three controls squeezed into one row — method,
 * paid, discount — produced 8px type and labels the method icon sat on top of.
 * So the block is stacked, once and for all:
 *
 *   أ) طريقة الدفع            full row — a deliberate choice, not a leftover cell
 *   ب) المبلغ المدفوع · الخصم   the two amounts, side by side, BELOW the method
 *
 * ════════════════════════════════════════════════════════════════════════════
 * WHY THE METHOD IS A DIALOG AND NOT A <select>
 * ════════════════════════════════════════════════════════════════════════════
 * A method alone is not enough to post a payment: نقدًا must name a cashbox,
 * تحويل بنكي a bank account, محفظة a wallet. A native <select> closes the
 * instant it is clicked, so picking "محفظة" used to lock the form before the
 * operator could say WHICH wallet. `PosMethodDialog` keeps the form open and
 * lists the system's own cashboxes / banks / wallets as pickable cards — one
 * click is the payment method.
 */

import { useState } from "react";
import {
  Banknote,
  ChevronDown,
  CreditCard,
  FileCheck2,
  Landmark,
  Layers,
  Smartphone,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { money } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { AmountInput } from "@/components/commerce/amount-input";
import type { ResolvedPaymentMethod } from "@/hooks/use-payment-methods";
import type { CompanyBankAccount, PaymentSettlementSelection } from "@/lib/payments/treasury-types";
import { PosMethodDialog } from "./pos-method-dialog";

/* ────────────────────────────── tender kinds ────────────────────────────── */

export type PosTenderKind = "CASH" | "BANK" | "WALLET" | "CARD" | "CHEQUE" | "CREDIT";

export const TENDER_KINDS: Array<{
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

/** A company wallet account paired with the catalogue wallet it represents. */
export interface WalletAccountChoice {
  account: CompanyBankAccount;
  walletId: string;
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
  isSplit: boolean;
  splitCount: number;
  onOpenSplit: () => void;
  disabled?: boolean;
}

export function PosMethodField({
  methods,
  settlement,
  onChange,
  isSplit,
  splitCount,
  onOpenSplit,
  disabled = false,
}: PosMethodFieldProps) {
  const { lang } = useI18n();
  const isAr = lang === "ar";
  const [open, setOpen] = useState(false);

  const selected = methods.find((method) => method.id === settlement.paymentMethodId);
  const kind: PosTenderKind = tenderKindOf(selected);
  const kindMeta = TENDER_KINDS.find((entry) => entry.id === kind) ?? TENDER_KINDS[0];
  const KindIcon = kindMeta.icon;

  // The receiving account as it will be posted. `settlement` carries the name
  // chosen in the dialog, so the closed field never has to re-resolve it.
  const receiver =
    settlement.cashboxName ||
    settlement.bankAccountName ||
    (kind === "CREDIT"
      ? isAr
        ? "ذمة على العميل"
        : "Customer credit"
      : kind === "CARD"
        ? isAr
          ? "شبكة / بطاقة"
          : "Card"
        : kind === "CHEQUE"
          ? isAr
            ? "شيك بنكي"
            : "Bank cheque"
          : isAr
            ? "بدون حساب محدد"
            : "No account selected");

  return (
    <>
      <button
        type="button"
        disabled={disabled}
        onClick={() => (isSplit ? onOpenSplit() : setOpen(true))}
        aria-haspopup="dialog"
        aria-label={isAr ? "طريقة الدفع" : "Payment method"}
        className={cn(
          "flex min-h-11 w-full min-w-0 items-center gap-2 rounded-xl border px-2.5 py-1.5 text-start transition",
          "outline-none focus-visible:ring-2 focus-visible:ring-primary/30 disabled:opacity-50",
          isSplit
            ? "border-primary/50 bg-primary/10 text-primary"
            : "border-border/80 bg-background hover:border-primary/40 hover:bg-primary/[0.03]",
        )}
      >
        <span
          className={cn(
            "grid size-7 shrink-0 place-items-center rounded-lg",
            isSplit ? "bg-primary/15 text-primary" : cn("bg-muted", kindMeta.iconClassName),
          )}
        >
          {isSplit ? <Layers className="size-3.5" /> : <KindIcon className="size-3.5" />}
        </span>
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
              : receiver}
          </span>
        </span>
        <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
      </button>

      {open && (
        <PosMethodDialog
          methods={methods}
          settlement={settlement}
          initialKind={kind}
          onClose={() => setOpen(false)}
          onSettlementChange={onChange}
        />
      )}
    </>
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

import { useMemo } from "react";
import {
  Banknote,
  Check,
  ChevronDown,
  CreditCard,
  FileCheck2,
  Landmark,
  Smartphone,
  Wallet,
  Layers,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";
import { useCashboxes } from "@/hooks/use-cashboxes";
import { useCompanyBankAccounts } from "@/hooks/use-company-bank-accounts";
import { paymentMethodIconAsset } from "@/lib/payments/payment-methods";
import type { PaymentSettlementSelection } from "@/lib/payments/treasury-types";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";

export type PaymentCategory = "CASH" | "BANK" | "WALLET" | "CARD" | "CHEQUE" | "CREDIT";

/** المحافظ اليمنية الأساسية المستقلة المعتمدة */
export const KNOWN_WALLETS = [
  { id: "jaib", nameAr: "محفظة جيب", nameEn: "Jaib Wallet", hintAr: "شركة الأهدل المالية" },
  { id: "floosak", nameAr: "محفظة فلوسك", nameEn: "Floosak", hintAr: "بنك اليمن والكويت" },
  { id: "one_cash", nameAr: "محفظة ون كاش", nameEn: "One Cash", hintAr: "محفظة ون كاش" },
  { id: "jawali", nameAr: "محفظة جوالي", nameEn: "Jawali", hintAr: "يمن موبايل" },
] as const;

const CHANNEL_TONE: Record<PaymentCategory, { text: string; soft: string }> = {
  CASH: { text: "text-emerald-700", soft: "bg-emerald-500/10" },
  BANK: { text: "text-indigo-700", soft: "bg-indigo-500/10" },
  WALLET: { text: "text-sky-700", soft: "bg-sky-500/10" },
  CARD: { text: "text-violet-700", soft: "bg-violet-500/10" },
  CHEQUE: { text: "text-amber-700", soft: "bg-amber-500/10" },
  CREDIT: { text: "text-slate-700", soft: "bg-slate-500/10" },
};

export interface CompactPaymentSelectorProps {
  category: PaymentCategory;
  onCategoryChange: (cat: PaymentCategory) => void;
  settlement: PaymentSettlementSelection;
  onSettlementChange: (next: PaymentSettlementSelection) => void;
  includeCredit?: boolean;
  disabled?: boolean;
  className?: string;
  reference?: string;
  onReferenceChange?: (ref: string) => void;
}

export function CompactPaymentSelector({
  category,
  onCategoryChange,
  settlement,
  onSettlementChange,
  includeCredit = true,
  disabled = false,
  className,
  reference,
  onReferenceChange,
}: CompactPaymentSelectorProps) {
  const { lang } = useI18n();
  const isAr = lang === "ar";

  const { activeCashboxes, defaultCashbox } = useCashboxes();
  const { banks, defaultBank, wallets, defaultWallet } = useCompanyBankAccounts();

  // قنوات السداد — أيقونة + اسم النوع
  const channels = useMemo(() => {
    const list: Array<{
      id: PaymentCategory;
      labelAr: string;
      labelEn: string;
      icon: typeof Banknote;
    }> = [
      { id: "CASH", labelAr: "نقدًا", labelEn: "Cash", icon: Banknote },
      { id: "BANK", labelAr: "بنك", labelEn: "Bank", icon: Landmark },
      { id: "WALLET", labelAr: "محفظة", labelEn: "Wallet", icon: Smartphone },
      { id: "CARD", labelAr: "شبكة", labelEn: "Card", icon: CreditCard },
      { id: "CHEQUE", labelAr: "شيك", labelEn: "Cheque", icon: FileCheck2 },
    ];
    if (includeCredit) {
      list.push({ id: "CREDIT", labelAr: "آجل", labelEn: "Credit", icon: Layers });
    }
    return list;
  }, [includeCredit]);

  const currentChannel = channels.find((c) => c.id === category) ?? channels[0];

  // الجهة المستلمة الحالية (صندوق / بنك / محفظة محددة)
  const currentSubEntity = useMemo(() => {
    if (category === "CASH") {
      const box = activeCashboxes.find((c) => c.id === settlement.cashboxId) || defaultCashbox;
      return {
        title: box?.name_ar || (isAr ? "الصندوق الرئيسي" : "Main Till"),
        iconAsset: null as { src: string; alt: string } | null,
      };
    }
    if (category === "BANK") {
      const b = banks.find((acc) => acc.id === settlement.bankAccountId) || defaultBank;
      return {
        title: b?.name_ar || (isAr ? "بنك الكريمي" : "Al-Kuraimi Bank"),
        iconAsset: null as { src: string; alt: string } | null,
      };
    }
    if (category === "WALLET") {
      // المحافظ لها اسم معياري ثابت — لا نعرض اسم الحساب المحاسبي الطويل
      const known = KNOWN_WALLETS.find((kw) => kw.id === settlement.paymentMethodId);
      if (known) {
        return {
          title: isAr ? known.nameAr : known.nameEn,
          iconAsset: paymentMethodIconAsset(known.id) ?? null,
        };
      }
      return {
        title: isAr ? KNOWN_WALLETS[0].nameAr : KNOWN_WALLETS[0].nameEn,
        iconAsset: paymentMethodIconAsset(KNOWN_WALLETS[0].id) ?? null,
      };
    }
    if (category === "CHEQUE") {
      return {
        title: settlement.cheque?.bankName || (isAr ? "شيك بنكي" : "Cheque"),
        iconAsset: null as { src: string; alt: string } | null,
      };
    }
    return null;
  }, [category, settlement, activeCashboxes, defaultCashbox, banks, defaultBank, isAr]);

  const handleChannelSelect = (cat: PaymentCategory) => {
    onCategoryChange(cat);
    const next: PaymentSettlementSelection = { ...settlement };

    if (cat === "CASH") {
      const box =
        activeCashboxes.find((c) => c.id === settlement.cashboxId) ||
        defaultCashbox ||
        activeCashboxes[0];
      next.method = "cash";
      next.paymentMethodId = "cash";
      next.cashboxId = box?.id || null;
      next.cashboxName = box?.name_ar || null;
      next.chartAccountId = box?.account_id || null;
      next.bankAccountId = null;
      next.bankAccountName = null;
    } else if (cat === "BANK") {
      const b = banks.find((acc) => acc.id === settlement.bankAccountId) || defaultBank || banks[0];
      next.method = "bank_transfer";
      next.paymentMethodId = b?.bank_name?.includes("كريمي") ? "kuraimi_bank" : "bank_transfer";
      next.bankAccountId = b?.id || null;
      next.bankAccountName = b?.name_ar || null;
      next.chartAccountId = b?.account_id || null;
      next.cashboxId = null;
      next.cashboxName = null;
    } else if (cat === "WALLET") {
      // نحافظ على المحفظة المختارة مسبقاً، وإلا المحفظة الافتراضية
      const w = wallets.find((acc) => acc.id === settlement.bankAccountId) || defaultWallet;
      const walletId =
        settlement.paymentMethodId && KNOWN_WALLETS.some((k) => k.id === settlement.paymentMethodId)
          ? settlement.paymentMethodId
          : w
            ? w.name_ar.includes("جيب")
              ? "jaib"
              : w.name_ar.includes("فلوسك")
                ? "floosak"
                : w.name_ar.includes("كاش")
                  ? "one_cash"
                  : "jawali"
            : "jaib";
      const kw = KNOWN_WALLETS.find((k) => k.id === walletId)!;

      next.method = "mobile_money";
      next.paymentMethodId = walletId;
      next.bankAccountId = w?.id || null;
      next.bankAccountName = isAr ? kw.nameAr : kw.nameEn;
      next.chartAccountId = w?.account_id || null;
      next.cashboxId = null;
      next.cashboxName = null;
    } else if (cat === "CARD") {
      next.method = "card";
      next.paymentMethodId = "card";
      next.cashboxId = null;
      next.cashboxName = null;
      next.bankAccountId = null;
      next.bankAccountName = null;
    } else if (cat === "CHEQUE") {
      next.method = "cheque";
      next.paymentMethodId = "cheque";
      next.cashboxId = null;
      next.cashboxName = null;
      next.bankAccountId = null;
      next.bankAccountName = null;
    } else if (cat === "CREDIT") {
      next.method = "credit";
      next.paymentMethodId = "credit";
      next.cashboxId = null;
      next.cashboxName = null;
      next.bankAccountId = null;
      next.bankAccountName = null;
    }

    onSettlementChange(next);
  };

  const tone = CHANNEL_TONE[category];
  const CurrentIcon = currentChannel.icon;

  return (
    <div className={cn("flex items-center gap-1.5", className)}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild disabled={disabled}>
          <button
            type="button"
            aria-label={isAr ? "طريقة الدفع" : "Payment method"}
            className="flex h-8.5 w-full min-w-0 items-center justify-between gap-2 rounded-xl border border-border/80 bg-background px-2.5 text-xs font-semibold shadow-2xs outline-none transition hover:border-primary/40 hover:bg-muted/30"
          >
            <div className="flex min-w-0 items-center gap-2">
              <span
                className={cn(
                  "grid size-5 shrink-0 place-items-center rounded-lg",
                  tone.soft,
                  tone.text,
                )}
              >
                <CurrentIcon className="size-3.5" />
              </span>
              <span className="shrink-0 font-bold">
                {isAr ? currentChannel.labelAr : currentChannel.labelEn}
              </span>
              {currentSubEntity && (
                <>
                  <span className="shrink-0 text-muted-foreground/50">·</span>
                  <span className="truncate text-[11px] font-medium text-muted-foreground">
                    {currentSubEntity.title}
                  </span>
                </>
              )}
            </div>
            <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
          </button>
        </DropdownMenuTrigger>

        <DropdownMenuContent
          align="start"
          className="w-60 rounded-2xl border-border/80 p-1.5 shadow-xl"
        >
          <DropdownMenuLabel className="px-2 py-1.5 text-[10px] font-semibold text-muted-foreground">
            {isAr ? "اختر طريقة الدفع" : "Choose payment method"}
          </DropdownMenuLabel>
          <DropdownMenuSeparator className="my-1" />

          {/* 1) نوع الطريقة (نقد، بنك، محفظة، شبكة، شيك، آجل) */}
          {channels.map((c) => {
            const Icon = c.icon;
            const isActive = c.id === category;
            return (
              <DropdownMenuItem
                key={c.id}
                onClick={() => handleChannelSelect(c.id)}
                className={cn(
                  "flex items-center justify-between gap-2 rounded-xl px-2.5 py-1.5 text-xs",
                  isActive && "bg-primary/10 font-bold text-primary",
                )}
              >
                <div className="flex items-center gap-2">
                  <Icon className="size-4 shrink-0" />
                  <span>{isAr ? c.labelAr : c.labelEn}</span>
                </div>
                {isActive && <Check className="size-3.5 shrink-0" />}
              </DropdownMenuItem>
            );
          })}

          {/* 2) المحافظ المتوفرة — تظهر مباشرة في نفس القائمة */}
          {category === "WALLET" && (
            <>
              <DropdownMenuSeparator className="my-1" />
              <DropdownMenuLabel className="px-2 py-1.5 text-[10px] font-semibold text-muted-foreground">
                {isAr ? "المحافظ المتوفرة" : "Available wallets"}
              </DropdownMenuLabel>
              {KNOWN_WALLETS.map((kw) => {
                const linkedAccount = wallets.find((w) =>
                  kw.id === "jaib"
                    ? w.name_ar.includes("جيب")
                    : kw.id === "floosak"
                      ? w.name_ar.includes("فلوسك")
                      : kw.id === "one_cash"
                        ? w.name_ar.includes("كاش")
                        : w.name_ar.includes("جوالي"),
                );
                const asset = paymentMethodIconAsset(kw.id);
                const isChosen = settlement.paymentMethodId === kw.id;

                return (
                  <DropdownMenuItem
                    key={kw.id}
                    onClick={() =>
                      onSettlementChange({
                        ...settlement,
                        method: "mobile_money",
                        paymentMethodId: kw.id,
                        bankAccountId: linkedAccount?.id || null,
                        bankAccountName: isAr ? kw.nameAr : kw.nameEn,
                        chartAccountId: linkedAccount?.account_id || null,
                      })
                    }
                    className={cn(
                      "flex items-center justify-between gap-2 rounded-xl px-2.5 py-1.5 text-xs",
                      isChosen && "bg-sky-500/10 font-bold text-sky-900 dark:text-sky-200",
                    )}
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      {asset ? (
                        <img
                          src={asset.src}
                          alt={asset.alt}
                          className="size-4 shrink-0 object-contain"
                        />
                      ) : (
                        <Smartphone className="size-4 shrink-0 text-sky-600" />
                      )}
                      <span className="truncate">{isAr ? kw.nameAr : kw.nameEn}</span>
                      {linkedAccount?.is_default && (
                        <Badge variant="outline" className="px-1 py-0 text-[9px]">
                          {isAr ? "افتراضي" : "Default"}
                        </Badge>
                      )}
                    </div>
                    {isChosen && <Check className="size-3.5 shrink-0 text-sky-600" />}
                  </DropdownMenuItem>
                );
              })}
            </>
          )}

          {/* 3) الحسابات البنكية */}
          {category === "BANK" && (
            <>
              <DropdownMenuSeparator className="my-1" />
              <DropdownMenuLabel className="px-2 py-1.5 text-[10px] font-semibold text-muted-foreground">
                {isAr ? "الحسابات البنكية" : "Bank accounts"}
              </DropdownMenuLabel>
              {banks.length > 0 ? (
                banks.map((b) => {
                  const isChosen = settlement.bankAccountId === b.id;
                  return (
                    <DropdownMenuItem
                      key={b.id}
                      onClick={() =>
                        onSettlementChange({
                          ...settlement,
                          method: "bank_transfer",
                          bankAccountId: b.id,
                          bankAccountName: b.name_ar,
                          paymentMethodId: b.bank_name?.includes("كريمي")
                            ? "kuraimi_bank"
                            : "bank_transfer",
                          chartAccountId: b.account_id,
                        })
                      }
                      className={cn(
                        "flex items-center justify-between gap-2 rounded-xl px-2.5 py-1.5 text-xs",
                        isChosen &&
                          "bg-indigo-500/10 font-bold text-indigo-900 dark:text-indigo-200",
                      )}
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <Landmark className="size-4 shrink-0 text-indigo-600" />
                        <div className="flex min-w-0 flex-col leading-tight">
                          <span className="truncate">{b.name_ar}</span>
                          {b.account_number && (
                            <span className="font-mono text-[10px] text-muted-foreground">
                              {b.account_number}
                            </span>
                          )}
                        </div>
                      </div>
                      {isChosen && <Check className="size-3.5 shrink-0 text-indigo-600" />}
                    </DropdownMenuItem>
                  );
                })
              ) : (
                <DropdownMenuItem
                  onClick={() =>
                    onSettlementChange({
                      ...settlement,
                      method: "bank_transfer",
                      paymentMethodId: "kuraimi_bank",
                      bankAccountName: isAr ? "بنك الكريمي" : "Al-Kuraimi Bank",
                    })
                  }
                  className="flex items-center gap-2 rounded-xl px-2.5 py-1.5 text-xs"
                >
                  <Landmark className="size-4 shrink-0 text-indigo-600" />
                  <span>{isAr ? "بنك الكريمي" : "Al-Kuraimi Bank"}</span>
                </DropdownMenuItem>
              )}
            </>
          )}

          {/* 4) الصناديق النقدية */}
          {category === "CASH" && (
            <>
              <DropdownMenuSeparator className="my-1" />
              <DropdownMenuLabel className="px-2 py-1.5 text-[10px] font-semibold text-muted-foreground">
                {isAr ? "الصناديق" : "Cashboxes"}
              </DropdownMenuLabel>
              {activeCashboxes.length > 0 ? (
                activeCashboxes.map((box) => {
                  const isChosen = settlement.cashboxId === box.id;
                  return (
                    <DropdownMenuItem
                      key={box.id}
                      onClick={() =>
                        onSettlementChange({
                          ...settlement,
                          method: "cash",
                          paymentMethodId: "cash",
                          cashboxId: box.id,
                          cashboxName: box.name_ar,
                          chartAccountId: box.account_id,
                        })
                      }
                      className={cn(
                        "flex items-center justify-between gap-2 rounded-xl px-2.5 py-1.5 text-xs",
                        isChosen &&
                          "bg-emerald-500/10 font-bold text-emerald-900 dark:text-emerald-200",
                      )}
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <Wallet className="size-4 shrink-0 text-emerald-600" />
                        <span className="truncate">{box.name_ar}</span>
                      </div>
                      {isChosen && <Check className="size-3.5 shrink-0 text-emerald-600" />}
                    </DropdownMenuItem>
                  );
                })
              ) : (
                <DropdownMenuItem
                  onClick={() =>
                    onSettlementChange({
                      ...settlement,
                      method: "cash",
                      paymentMethodId: "cash",
                      cashboxName: isAr ? "الصندوق الرئيسي" : "Main Till",
                    })
                  }
                  className="flex items-center gap-2 rounded-xl px-2.5 py-1.5 text-xs"
                >
                  <Wallet className="size-4 shrink-0 text-emerald-600" />
                  <span>{isAr ? "الصندوق الرئيسي" : "Main Till"}</span>
                </DropdownMenuItem>
              )}
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* حقل المرجع للحوالة / المحفظة */}
      {(category === "BANK" || category === "WALLET") && onReferenceChange && (
        <input
          type="text"
          disabled={disabled}
          value={reference ?? ""}
          onChange={(e) => onReferenceChange(e.target.value)}
          placeholder={
            category === "WALLET"
              ? isAr
                ? "رقم إشعار المحفظة..."
                : "Wallet ref..."
              : isAr
                ? "رقم مرجع الحوالة..."
                : "Transfer ref..."
          }
          className="h-8.5 w-[38%] shrink-0 rounded-xl border border-input/80 bg-background px-2.5 text-[11px] outline-none transition focus:border-primary focus:ring-1 focus:ring-primary/20"
        />
      )}
    </div>
  );
}

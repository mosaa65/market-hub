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
  { id: "jaib", nameAr: "جيب (الأهدل)", nameEn: "Jaib Wallet", hintAr: "شركة الأهدل المالية" },
  { id: "floosak", nameAr: "فلوسك", nameEn: "Floosak", hintAr: "بنك اليمن والكويت" },
  { id: "one_cash", nameAr: "ون كاش", nameEn: "One Cash", hintAr: "محفظة ون كاش" },
  { id: "jawali", nameAr: "جوالي", nameEn: "Jawali", hintAr: "يمن موبايل" },
] as const;

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

  // الفئات المتاحة كأزرار أنيقة وموفرة للمساحة
  const categories = useMemo(() => {
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
      list.push({ id: "CREDIT", labelAr: "آجل", labelEn: "Credit", icon: Wallet });
    }
    return list;
  }, [includeCredit]);

  // الاسم الحالي للجهة المحددة (صندوق، بنك، أو المحفظة المحددة)
  const currentSubEntity = useMemo(() => {
    if (category === "CASH") {
      const box = activeCashboxes.find((c) => c.id === settlement.cashboxId) || defaultCashbox;
      return {
        title: box?.name_ar || (isAr ? "الصندوق الرئيسي" : "Main Till"),
        iconAsset: null,
      };
    }
    if (category === "BANK") {
      const b = banks.find((acc) => acc.id === settlement.bankAccountId) || defaultBank;
      return {
        title: b?.name_ar || (isAr ? "بنك الكريمي" : "Al-Kuraimi Bank"),
        iconAsset: null,
      };
    }
    if (category === "WALLET") {
      // البحث أولاً في حسابات الشركة المسجلة
      const w = wallets.find((acc) => acc.id === settlement.bankAccountId);
      if (w) {
        const catId = w.name_ar.includes("جيب")
          ? "jaib"
          : w.name_ar.includes("فلوسك")
            ? "floosak"
            : w.name_ar.includes("كاش")
              ? "one_cash"
              : "jawali";
        return {
          title: w.name_ar,
          iconAsset: paymentMethodIconAsset(catId),
        };
      }
      // إن لم يكن مرتبطاً بـ bankAccountId، اعتمد على paymentMethodId
      if (settlement.paymentMethodId === "jaib") {
        return { title: isAr ? "محفظة جيب" : "Jaib", iconAsset: paymentMethodIconAsset("jaib") };
      }
      if (settlement.paymentMethodId === "floosak") {
        return {
          title: isAr ? "محفظة فلوسك" : "Floosak",
          iconAsset: paymentMethodIconAsset("floosak"),
        };
      }
      if (settlement.paymentMethodId === "one_cash") {
        return {
          title: isAr ? "محفظة ون كاش" : "One Cash",
          iconAsset: paymentMethodIconAsset("one_cash"),
        };
      }
      if (settlement.paymentMethodId === "jawali") {
        return { title: isAr ? "محفظة جوالي" : "Jawali", iconAsset: null };
      }
      // المحفظة الافتراضية
      if (defaultWallet) {
        const catId = defaultWallet.name_ar.includes("جيب")
          ? "jaib"
          : defaultWallet.name_ar.includes("فلوسك")
            ? "floosak"
            : defaultWallet.name_ar.includes("كاش")
              ? "one_cash"
              : "jawali";
        return {
          title: defaultWallet.name_ar,
          iconAsset: paymentMethodIconAsset(catId),
        };
      }
      // القيمة التلقائية الافتراضية
      return { title: isAr ? "محفظة جيب" : "Jaib", iconAsset: paymentMethodIconAsset("jaib") };
    }
    if (category === "CHEQUE") {
      return {
        title: settlement.cheque?.bankName || (isAr ? "شيك بنكي" : "Cheque"),
        iconAsset: null,
      };
    }
    return null;
  }, [
    category,
    settlement,
    activeCashboxes,
    defaultCashbox,
    banks,
    defaultBank,
    wallets,
    defaultWallet,
    isAr,
  ]);

  const handleCategoryClick = (cat: PaymentCategory) => {
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
      // عند الضغط على محفظة: تحديد المحفظة الافتراضية بدقة
      const w =
        wallets.find((acc) => acc.id === settlement.bankAccountId) || defaultWallet || wallets[0];
      const preferredWalletId = w
        ? w.name_ar.includes("جيب")
          ? "jaib"
          : w.name_ar.includes("فلوسك")
            ? "floosak"
            : w.name_ar.includes("كاش")
              ? "one_cash"
              : "jawali"
        : settlement.paymentMethodId &&
            ["jaib", "floosak", "one_cash", "jawali"].includes(settlement.paymentMethodId)
          ? settlement.paymentMethodId
          : "jaib";

      next.method = "mobile_money";
      next.paymentMethodId = preferredWalletId;
      next.bankAccountId = w?.id || null;
      next.bankAccountName =
        w?.name_ar ||
        (preferredWalletId === "jaib"
          ? "محفظة جيب"
          : preferredWalletId === "floosak"
            ? "محفظة فلوسك"
            : preferredWalletId === "one_cash"
              ? "محفظة ون كاش"
              : "محفظة جوالي");
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

  return (
    <div className={cn("space-y-1.5", className)}>
      {/* ── السطر الأول: أزرار قنوات السداد (نقد، بنك، محفظة، شبكة، شيك، آجل) ── */}
      <div className="flex items-center gap-1 p-0.5 rounded-xl bg-surface-2/70 border border-border/80 shadow-2xs">
        {categories.map((c) => {
          const isSelected = category === c.id;
          const Icon = c.icon;
          return (
            <button
              key={c.id}
              type="button"
              disabled={disabled}
              onClick={() => handleCategoryClick(c.id)}
              className={cn(
                "flex-1 min-w-0 flex items-center justify-center gap-1.5 rounded-lg py-1.5 px-1.5 text-[11px] font-bold transition-all select-none",
                isSelected
                  ? c.id === "CASH"
                    ? "bg-emerald-600 text-white shadow-xs"
                    : c.id === "BANK"
                      ? "bg-indigo-600 text-white shadow-xs"
                      : c.id === "WALLET"
                        ? "bg-sky-600 text-white shadow-xs"
                        : "bg-primary text-primary-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
              )}
            >
              <Icon className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{isAr ? c.labelAr : c.labelEn}</span>
            </button>
          );
        })}
      </div>

      {/* ── السطر الثاني: القائمة المنسدلة للجهة المحددة بدقة واحترافية ── */}
      {(category === "BANK" || category === "WALLET" || category === "CASH") && (
        <div className="flex items-center gap-1.5 animate-in fade-in-50 duration-150">
          <DropdownMenu>
            <DropdownMenuTrigger asChild disabled={disabled}>
              <button
                type="button"
                className={cn(
                  "flex-1 flex items-center justify-between gap-1.5 h-8.5 rounded-xl border px-2.5 text-xs font-semibold transition outline-none shadow-2xs",
                  category === "BANK" &&
                    "border-indigo-500/30 bg-indigo-500/10 text-indigo-950 dark:text-indigo-200 hover:bg-indigo-500/15",
                  category === "WALLET" &&
                    "border-sky-500/30 bg-sky-500/10 text-sky-950 dark:text-sky-200 hover:bg-sky-500/15",
                  category === "CASH" &&
                    "border-emerald-500/30 bg-emerald-500/10 text-emerald-950 dark:text-emerald-200 hover:bg-emerald-500/15",
                )}
              >
                <div className="flex items-center gap-2 truncate">
                  {category === "BANK" && <Landmark className="h-4 w-4 text-indigo-600 shrink-0" />}
                  {category === "CASH" && (
                    <Banknote className="h-4 w-4 text-emerald-600 shrink-0" />
                  )}
                  {category === "WALLET" &&
                    (currentSubEntity?.iconAsset ? (
                      <img
                        src={currentSubEntity.iconAsset.src}
                        alt={currentSubEntity.iconAsset.alt}
                        className="h-4 w-4 object-contain shrink-0 rounded-xs"
                      />
                    ) : (
                      <Smartphone className="h-4 w-4 text-sky-600 shrink-0" />
                    ))}
                  <span className="truncate font-bold text-xs">{currentSubEntity?.title}</span>
                </div>
                <div className="flex items-center gap-1 shrink-0 text-muted-foreground/80">
                  <span className="text-[10px] hidden sm:inline">
                    {category === "WALLET"
                      ? isAr
                        ? "تغيير المحفظة"
                        : "Change"
                      : isAr
                        ? "تغيير"
                        : "Change"}
                  </span>
                  <ChevronDown className="h-3.5 w-3.5 opacity-70" />
                </div>
              </button>
            </DropdownMenuTrigger>

            <DropdownMenuContent
              align="start"
              className="w-64 p-1.5 rounded-2xl shadow-xl border border-border/80"
            >
              {/* خيارات المحافظ المستقلة (جيب، فلوسك، ون كاش، جوالي) */}
              {category === "WALLET" && (
                <>
                  <DropdownMenuLabel className="text-[11px] text-muted-foreground font-semibold px-2 py-1.5 flex items-center justify-between">
                    <span>{isAr ? "اختر المحفظة المستلمة" : "Select Receiving Wallet"}</span>
                    <Badge variant="secondary" className="text-[9px] px-1.5 py-0 h-4">
                      {isAr ? "محافظ فورية" : "E-Wallets"}
                    </Badge>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator className="my-1" />

                  {/* قائمة المحافظ المتاحة سواء من حسابات المنشأة أو المحافظ الوطنية المعتمدة */}
                  {KNOWN_WALLETS.map((kw) => {
                    // البحث عما إذا كان هناك حساب بنكي مخصص لهذه المحفظة
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
                    const isChosen =
                      (settlement.bankAccountId &&
                        linkedAccount?.id === settlement.bankAccountId) ||
                      settlement.paymentMethodId === kw.id;

                    return (
                      <DropdownMenuItem
                        key={kw.id}
                        onClick={() => {
                          onSettlementChange({
                            ...settlement,
                            method: "mobile_money",
                            paymentMethodId: kw.id,
                            bankAccountId: linkedAccount?.id || null,
                            bankAccountName: linkedAccount?.name_ar || kw.nameAr,
                            chartAccountId: linkedAccount?.account_id || null,
                          });
                        }}
                        className={cn(
                          "flex items-center justify-between gap-2 px-2.5 py-2 rounded-xl cursor-pointer text-xs transition",
                          isChosen && "bg-sky-500/15 font-bold text-sky-950 dark:text-sky-200",
                        )}
                      >
                        <div className="flex items-center gap-2.5 truncate">
                          <div className="h-6 w-6 rounded-lg bg-surface flex items-center justify-center p-0.5 border border-border/60 shrink-0">
                            {asset ? (
                              <img
                                src={asset.src}
                                alt={asset.alt}
                                className="h-full w-full object-contain"
                              />
                            ) : (
                              <Smartphone className="h-4 w-4 text-sky-600" />
                            )}
                          </div>
                          <div className="flex flex-col truncate leading-tight">
                            <span className="font-semibold text-xs truncate">
                              {linkedAccount?.name_ar || (isAr ? kw.nameAr : kw.nameEn)}
                            </span>
                            <span className="text-[10px] text-muted-foreground truncate">
                              {kw.hintAr}
                            </span>
                          </div>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          {linkedAccount?.is_default && (
                            <Badge
                              variant="outline"
                              className="text-[9px] px-1 py-0 border-sky-400 text-sky-700"
                            >
                              {isAr ? "افتراضي" : "Default"}
                            </Badge>
                          )}
                          {isChosen && <Check className="h-4 w-4 text-sky-600 shrink-0" />}
                        </div>
                      </DropdownMenuItem>
                    );
                  })}
                </>
              )}

              {/* خيارات الحسابات البنكية */}
              {category === "BANK" && (
                <>
                  <DropdownMenuLabel className="text-[11px] text-muted-foreground font-semibold px-2 py-1.5 flex items-center justify-between">
                    <span>{isAr ? "اختر الحساب البنكي" : "Select Bank Account"}</span>
                    <Badge variant="secondary" className="text-[9px] px-1.5 py-0 h-4">
                      {isAr ? "بنوك" : "Banks"}
                    </Badge>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator className="my-1" />
                  {banks.length > 0 ? (
                    banks.map((b) => {
                      const isChosen = settlement.bankAccountId === b.id;
                      return (
                        <DropdownMenuItem
                          key={b.id}
                          onClick={() => {
                            onSettlementChange({
                              ...settlement,
                              method: "bank_transfer",
                              bankAccountId: b.id,
                              bankAccountName: b.name_ar,
                              paymentMethodId: b.bank_name?.includes("كريمي")
                                ? "kuraimi_bank"
                                : "bank_transfer",
                              chartAccountId: b.account_id,
                            });
                          }}
                          className={cn(
                            "flex items-center justify-between gap-2 px-2.5 py-2 rounded-xl cursor-pointer text-xs transition",
                            isChosen &&
                              "bg-indigo-500/15 font-bold text-indigo-950 dark:text-indigo-200",
                          )}
                        >
                          <div className="flex items-center gap-2 truncate">
                            <Landmark className="h-4 w-4 text-indigo-600 shrink-0" />
                            <div className="flex flex-col truncate leading-tight">
                              <span className="font-semibold text-xs truncate">{b.name_ar}</span>
                              {b.account_number && (
                                <span className="text-[10px] text-muted-foreground font-mono">
                                  {b.account_number}
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            {b.is_default && (
                              <Badge
                                variant="outline"
                                className="text-[9px] px-1 py-0 border-indigo-400 text-indigo-700"
                              >
                                {isAr ? "افتراضي" : "Default"}
                              </Badge>
                            )}
                            {isChosen && <Check className="h-4 w-4 text-indigo-600 shrink-0" />}
                          </div>
                        </DropdownMenuItem>
                      );
                    })
                  ) : (
                    <DropdownMenuItem
                      onClick={() => {
                        onSettlementChange({
                          ...settlement,
                          method: "bank_transfer",
                          paymentMethodId: "kuraimi_bank",
                          bankAccountName: isAr ? "بنك الكريمي" : "Al-Kuraimi Bank",
                        });
                      }}
                      className="px-2.5 py-2 text-xs"
                    >
                      <Landmark className="h-4 w-4 text-indigo-600 ms-1 me-2" />
                      <span>{isAr ? "بنك الكريمي (حساب تجاري)" : "Al-Kuraimi Bank"}</span>
                    </DropdownMenuItem>
                  )}
                </>
              )}

              {/* خيارات الصناديق النقدية */}
              {category === "CASH" && (
                <>
                  <DropdownMenuLabel className="text-[11px] text-muted-foreground font-semibold px-2 py-1.5 flex items-center justify-between">
                    <span>{isAr ? "اختر الصندوق المستلم" : "Select Cashbox"}</span>
                    <Badge variant="secondary" className="text-[9px] px-1.5 py-0 h-4">
                      {isAr ? "نقد" : "Cash"}
                    </Badge>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator className="my-1" />
                  {activeCashboxes.length > 0 ? (
                    activeCashboxes.map((box) => {
                      const isChosen = settlement.cashboxId === box.id;
                      return (
                        <DropdownMenuItem
                          key={box.id}
                          onClick={() => {
                            onSettlementChange({
                              ...settlement,
                              method: "cash",
                              paymentMethodId: "cash",
                              cashboxId: box.id,
                              cashboxName: box.name_ar,
                              chartAccountId: box.account_id,
                            });
                          }}
                          className={cn(
                            "flex items-center justify-between gap-2 px-2.5 py-2 rounded-xl cursor-pointer text-xs transition",
                            isChosen &&
                              "bg-emerald-500/15 font-bold text-emerald-950 dark:text-emerald-200",
                          )}
                        >
                          <div className="flex items-center gap-2 truncate">
                            <Banknote className="h-4 w-4 text-emerald-600 shrink-0" />
                            <span className="font-semibold text-xs truncate">{box.name_ar}</span>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            {box.is_default && (
                              <Badge
                                variant="outline"
                                className="text-[9px] px-1 py-0 border-emerald-400 text-emerald-700"
                              >
                                {isAr ? "افتراضي" : "Default"}
                              </Badge>
                            )}
                            {isChosen && <Check className="h-4 w-4 text-emerald-600 shrink-0" />}
                          </div>
                        </DropdownMenuItem>
                      );
                    })
                  ) : (
                    <DropdownMenuItem
                      onClick={() => {
                        onSettlementChange({
                          ...settlement,
                          method: "cash",
                          paymentMethodId: "cash",
                          cashboxName: isAr ? "الصندوق الرئيسي" : "Main Till",
                        });
                      }}
                      className="px-2.5 py-2 text-xs"
                    >
                      <Banknote className="h-4 w-4 text-emerald-600 ms-1 me-2" />
                      <span>{isAr ? "الصندوق الرئيسي" : "Main Till"}</span>
                    </DropdownMenuItem>
                  )}
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* حقل رقم المرجع للحوالة أو إشعار المحفظة */}
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
              className="h-8.5 flex-1 min-w-[110px] rounded-xl border border-input/80 bg-background px-2.5 text-xs outline-none focus:border-primary focus:ring-1 focus:ring-primary/20 transition"
            />
          )}
        </div>
      )}
    </div>
  );
}

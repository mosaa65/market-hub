import { useEffect, useMemo } from "react";
import {
  Banknote,
  Building2,
  Calendar,
  Check,
  CreditCard,
  FileCheck2,
  Landmark,
  Smartphone,
  Tag,
  Wallet,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";
import {
  usePaymentMethodsForContext,
  type ResolvedPaymentMethod,
} from "@/hooks/use-payment-methods";
import { useCashboxes } from "@/hooks/use-cashboxes";
import { useCompanyBankAccounts } from "@/hooks/use-company-bank-accounts";
import {
  paymentMethodIcon,
  paymentMethodIconAsset,
  type PaymentContext,
} from "@/lib/payments/payment-methods";
import type { PaymentSettlementSelection } from "@/lib/payments/treasury-types";
import { Badge } from "@/components/ui/badge";

export interface DynamicPaymentSelectorProps {
  context: PaymentContext;
  value: string;
  onChange: (method: string) => void;
  settlement: PaymentSettlementSelection;
  onSettlementChange: (next: PaymentSettlementSelection) => void;
  includeCredit?: boolean;
  disabled?: boolean;
  className?: string;
  compact?: boolean;
}

export function DynamicPaymentSelector({
  context,
  value,
  onChange,
  settlement,
  onSettlementChange,
  includeCredit = true,
  disabled = false,
  className,
  compact = false,
}: DynamicPaymentSelectorProps) {
  const { lang } = useI18n();
  const isAr = lang === "ar";

  const { methods, isLoading: methodsLoading } = usePaymentMethodsForContext(context, {
    includeCredit,
    includeSplit: false,
  });

  const { activeCashboxes, defaultCashbox, isLoading: cashboxesLoading } = useCashboxes();
  const {
    banks,
    wallets,
    defaultBank,
    defaultWallet,
    isLoading: banksLoading,
  } = useCompanyBankAccounts();

  // Primary methods classification
  const currentMethod = methods.find((m) => m.id === value || m.legacyValue === value);
  const currentKind = currentMethod?.ledgerKind ?? "CASH";

  // Ensure smart defaults are populated once loaded
  useEffect(() => {
    let changed = false;
    const next: PaymentSettlementSelection = { ...settlement, method: value };

    if (currentKind === "CASH") {
      if (!next.cashboxId && defaultCashbox) {
        next.cashboxId = defaultCashbox.id;
        next.cashboxName = defaultCashbox.name_ar;
        next.chartAccountId = defaultCashbox.account_id;
        changed = true;
      }
    } else if (currentKind === "WALLET") {
      if (!next.bankAccountId && defaultWallet) {
        next.bankAccountId = defaultWallet.id;
        next.bankAccountName = defaultWallet.name_ar;
        next.chartAccountId = defaultWallet.account_id;
        changed = true;
      }
      if (!next.paymentMethodId && currentMethod?.id) {
        next.paymentMethodId = currentMethod.id;
        changed = true;
      }
    } else if (currentKind === "BANK") {
      if (!next.bankAccountId && defaultBank) {
        next.bankAccountId = defaultBank.id;
        next.bankAccountName = defaultBank.name_ar;
        next.chartAccountId = defaultBank.account_id;
        changed = true;
      }
      if (!next.paymentMethodId && currentMethod?.id) {
        next.paymentMethodId = currentMethod.id;
        changed = true;
      }
    }

    if (changed) {
      onSettlementChange(next);
    }
  }, [value, currentKind, defaultCashbox, defaultWallet, defaultBank]);

  // Handle tier-1 selection click
  const handleSelectPrimary = (m: ResolvedPaymentMethod) => {
    onChange(m.legacyValue);

    const chosenCashbox =
      m.ledgerKind === "CASH"
        ? activeCashboxes.find((c) => c.id === settlement.cashboxId) || defaultCashbox
        : null;
    const chosenBank =
      m.ledgerKind === "WALLET"
        ? wallets.find((w) => w.id === settlement.bankAccountId) || defaultWallet
        : m.ledgerKind === "BANK"
          ? banks.find((b) => b.id === settlement.bankAccountId) || defaultBank
          : null;

    const next: PaymentSettlementSelection = {
      method: m.legacyValue,
      paymentMethodId: m.id,
      cashboxId: chosenCashbox?.id || null,
      cashboxName: chosenCashbox?.name_ar || null,
      bankAccountId: chosenBank?.id || null,
      bankAccountName: chosenBank?.name_ar || null,
      chartAccountId: chosenCashbox?.account_id || chosenBank?.account_id || null,
      reference: settlement.reference || "",
      cheque:
        m.legacyValue === "cheque"
          ? settlement.cheque || {
              chequeNumber: "",
              bankName: "",
              dueDate: new Date().toISOString().slice(0, 10),
            }
          : null,
    };

    onSettlementChange(next);
  };

  // Primary tender categories to present to cashier/user
  const primaryButtons = useMemo(() => {
    // Unique list by canonical behavior
    const map = new Map<string, ResolvedPaymentMethod>();
    for (const m of methods) {
      const key = m.legacyValue;
      if (!map.has(key)) {
        map.set(key, m);
      }
    }
    return Array.from(map.values());
  }, [methods]);

  if (compact) {
    const accountOptions =
      currentKind === "CASH"
        ? activeCashboxes.map((account) => ({
            id: account.id,
            name: account.name_ar,
            code: account.account?.code,
            accountId: account.account_id,
            kind: "CASH",
          }))
        : currentKind === "BANK"
          ? banks.map((account) => ({
              id: account.id,
              name: account.name_ar,
              code: account.account?.code,
              accountId: account.account_id,
              kind: "BANK",
            }))
          : currentKind === "WALLET"
            ? wallets.map((account) => ({
                id: account.id,
                name:
                  currentMethod?.id === "jaib" && /الأهدل|الاهدل/i.test(account.name_ar)
                    ? "جيب"
                    : account.name_ar,
                code: account.account?.code,
                accountId: account.account_id,
                kind: "WALLET",
              }))
            : [];
    const selectedAccountId =
      currentKind === "CASH" ? settlement.cashboxId : settlement.bankAccountId;

    return (
      <div className={cn("grid min-w-0 gap-2 sm:grid-cols-2", className)}>
        <section className="min-w-0 rounded-xl border border-border/70 bg-card p-2">
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <span className="text-[10px] font-bold text-foreground">
              {isAr ? "طريقة الدفع" : "Payment method"}
            </span>
            <span className="text-[9px] text-muted-foreground">
              {methodsLoading ? "..." : `${primaryButtons.length}`}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-1">
            {primaryButtons.map((m) => {
              const selected = value === m.legacyValue || settlement.paymentMethodId === m.id;
              const Icon = paymentMethodIcon(m.iconKey, m.ledgerKind);
              return (
                <button
                  key={m.id}
                  type="button"
                  disabled={disabled}
                  onClick={() => handleSelectPrimary(m)}
                  className={cn(
                    "flex min-h-11 items-center gap-1.5 rounded-lg border px-2 text-start text-[10px] font-semibold transition",
                    selected
                      ? "border-primary bg-primary/10 text-primary ring-1 ring-primary/20"
                      : "border-border/70 bg-background text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Icon className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{isAr ? m.nameAr : (m.nameEn ?? m.nameAr)}</span>
                  {selected && <Check className="ms-auto h-3 w-3 shrink-0" />}
                </button>
              );
            })}
          </div>
        </section>

        <section className="min-w-0 rounded-xl border border-border/70 bg-card p-2">
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <span className="text-[10px] font-bold text-foreground">
              {isAr ? "الحساب المرتبط" : "Linked account"}
            </span>
            <span className="text-[9px] text-muted-foreground">
              {accountOptions.length ? (isAr ? "من الدليل" : "Ledger") : "—"}
            </span>
          </div>
          {currentKind === "CREDIT" ? (
            <div className="flex min-h-11 items-center rounded-lg border border-violet-500/20 bg-violet-500/10 px-2 text-[10px] font-semibold text-violet-700 dark:text-violet-300">
              {isAr ? "تُرحّل إلى ذمم العميل" : "Posted to customer receivables"}
            </div>
          ) : accountOptions.length === 0 ? (
            <div className="flex min-h-11 items-center rounded-lg border border-amber-500/20 bg-amber-500/10 px-2 text-[10px] font-semibold text-amber-700 dark:text-amber-300">
              {isAr ? "لا يوجد حساب نشط مرتبط من شجرة الحسابات" : "No active ledger-linked account"}
            </div>
          ) : (
            <div className="grid max-h-28 grid-cols-1 gap-1 overflow-y-auto">
              {accountOptions.map((account) => {
                const selected = selectedAccountId === account.id;
                return (
                  <button
                    key={account.id}
                    type="button"
                    disabled={disabled}
                    onClick={() =>
                      onSettlementChange({
                        ...settlement,
                        ...(currentKind === "CASH"
                          ? { cashboxId: account.id, cashboxName: account.name }
                          : { bankAccountId: account.id, bankAccountName: account.name }),
                        chartAccountId: account.accountId,
                      })
                    }
                    className={cn(
                      "flex min-h-11 items-center justify-between gap-2 rounded-lg border px-2 text-start transition",
                      selected
                        ? "border-emerald-500 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300"
                        : "border-border/70 bg-background text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <span className="min-w-0 truncate text-[10px] font-semibold">
                      {account.name}
                    </span>
                    <span className="flex shrink-0 items-center gap-1 text-[9px] text-muted-foreground">
                      {account.code ?? "—"}
                      {selected && <Check className="h-3 w-3 text-emerald-600" />}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
          {currentKind !== "CREDIT" && settlement.chartAccountId && (
            <p className="mt-1 text-[9px] font-medium text-emerald-600 dark:text-emerald-400">
              {isAr ? "مرتبط بحساب دليل الحسابات" : "Validated against chart of accounts"}
            </p>
          )}
        </section>
      </div>
    );
  }

  return (
    <div className={cn("space-y-2.5", className)}>
      {/* ── Level 1: Primary Tender Buttons ── */}
      <div
        className={cn(
          "grid gap-1.5",
          primaryButtons.length <= 4 ? "grid-cols-4" : "grid-cols-3 sm:grid-cols-6",
        )}
      >
        {primaryButtons.map((m) => {
          const isSelected = value === m.legacyValue;
          const Icon = paymentMethodIcon(m.iconKey, m.ledgerKind);
          const label = isAr ? m.nameAr : (m.nameEn ?? m.nameAr);

          return (
            <button
              key={m.id}
              type="button"
              disabled={disabled}
              onClick={() => handleSelectPrimary(m)}
              className={cn(
                "flex flex-col items-center justify-center gap-1 rounded-xl p-2 text-center transition-all",
                "border focus:outline-none focus:ring-2 focus:ring-primary/20",
                isSelected
                  ? "border-primary bg-primary/10 text-primary font-bold shadow-xs ring-1 ring-primary/30"
                  : "border-border/70 bg-card hover:bg-muted/50 text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span className="text-[11px] leading-tight truncate w-full">{label}</span>
            </button>
          );
        })}
      </div>

      {/* ── Level 2: Dynamic Settlement Sub-Entities ── */}
      <div className="rounded-xl border border-border/70 bg-muted/20 p-2.5 space-y-2 text-xs animate-in fade-in duration-200">
        {/* CASE A: CASH -> Cashbox Selection */}
        {currentKind === "CASH" && (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-[11px] text-muted-foreground">
              <span className="flex items-center gap-1 font-medium">
                <Banknote className="h-3.5 w-3.5 text-emerald-600" />
                {isAr ? "الصندوق المستلم للنقدية:" : "Receiving Cashbox:"}
              </span>
              {defaultCashbox && (
                <span className="text-[10px] text-muted-foreground/80">
                  {isAr
                    ? `(الافتراضي: ${defaultCashbox.name_ar})`
                    : `(Default: ${defaultCashbox.name_ar})`}
                </span>
              )}
            </div>

            {activeCashboxes.length <= 1 ? (
              <div className="flex items-center justify-between rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-emerald-800 dark:text-emerald-300 font-medium">
                <span>
                  {defaultCashbox ? defaultCashbox.name_ar : isAr ? "الصندوق الرئيسي" : "Main Till"}
                </span>
                <Badge
                  variant="outline"
                  className="border-emerald-500/40 text-[10px] bg-emerald-500/20"
                >
                  {isAr ? "نشط" : "Active"}
                </Badge>
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                {activeCashboxes.map((box) => {
                  const isChosen = settlement.cashboxId === box.id;
                  return (
                    <button
                      key={box.id}
                      type="button"
                      disabled={disabled}
                      onClick={() =>
                        onSettlementChange({
                          ...settlement,
                          cashboxId: box.id,
                          cashboxName: box.name_ar,
                          chartAccountId: box.account_id,
                        })
                      }
                      className={cn(
                        "flex items-center justify-between gap-1.5 rounded-lg border px-2.5 py-1.5 text-start transition",
                        isChosen
                          ? "border-emerald-600 bg-emerald-500/15 text-emerald-900 dark:text-emerald-200 font-bold shadow-2xs"
                          : "border-border/80 bg-background text-muted-foreground hover:text-foreground",
                      )}
                    >
                      <span className="truncate">{box.name_ar}</span>
                      {isChosen && <Check className="h-3.5 w-3.5 shrink-0 text-emerald-600" />}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* CASE B: WALLET -> Specific Wallet Selection + Transaction Ref */}
        {currentKind === "WALLET" && (
          <div className="space-y-2">
            <label className="block text-[11px] font-medium text-muted-foreground">
              {isAr ? "اختر المحفظة المستلمة:" : "Select Receiving Wallet:"}
            </label>

            {/* Wallet Pills with SVG Icons */}
            <div className="flex flex-wrap gap-1.5">
              {/* Shipped/Registered Wallets */}
              {methods
                .filter((m) => m.ledgerKind === "WALLET")
                .map((w) => {
                  const isChosen = settlement.paymentMethodId === w.id;
                  const asset = paymentMethodIconAsset(w.id);

                  return (
                    <button
                      key={w.id}
                      type="button"
                      disabled={disabled}
                      onClick={() => {
                        const matchedAcc = wallets.find(
                          (acc) =>
                            acc.bank_name.includes(w.nameAr) || acc.name_ar.includes(w.nameAr),
                        );
                        onSettlementChange({
                          ...settlement,
                          paymentMethodId: w.id,
                          bankAccountId: matchedAcc?.id || settlement.bankAccountId,
                          bankAccountName: w.nameAr,
                          chartAccountId: matchedAcc?.account_id || settlement.chartAccountId,
                        });
                      }}
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-semibold transition",
                        isChosen
                          ? "border-sky-500 bg-sky-500/15 text-sky-950 dark:text-sky-200 shadow-2xs ring-1 ring-sky-500/30"
                          : "border-border/80 bg-background text-muted-foreground hover:text-foreground hover:bg-muted/40",
                      )}
                    >
                      {asset ? (
                        <img src={asset.src} alt={asset.alt} className="h-4 w-4 object-contain" />
                      ) : (
                        <Smartphone className="h-4 w-4 text-sky-600" />
                      )}
                      <span>{isAr ? w.nameAr : (w.nameEn ?? w.nameAr)}</span>
                      {isChosen && <Check className="h-3 w-3 text-sky-600 shrink-0" />}
                    </button>
                  );
                })}
            </div>

            {/* Transaction Reference */}
            <div className="pt-1">
              <input
                type="text"
                disabled={disabled}
                value={settlement.reference ?? ""}
                onChange={(e) => onSettlementChange({ ...settlement, reference: e.target.value })}
                placeholder={
                  isAr
                    ? "رقم عملية التحويل / الإشعار الإلكتروني..."
                    : "Wallet transaction reference..."
                }
                className="h-9 w-full rounded-xl border border-input/80 bg-background px-3 text-xs outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
              />
            </div>
          </div>
        )}

        {/* CASE C: BANK TRANSFER -> Company Bank Selection + Reference */}
        {currentKind === "BANK" && value !== "cheque" && (
          <div className="space-y-2">
            <div className="space-y-1">
              <label className="text-[11px] font-medium text-muted-foreground flex items-center gap-1">
                <Landmark className="h-3.5 w-3.5 text-indigo-600" />
                {isAr ? "الحساب البنكي المودع فيه:" : "Deposited Bank Account:"}
              </label>

              {banks.length === 0 ? (
                <div className="rounded-lg border border-indigo-500/20 bg-indigo-500/10 p-2 text-[11px] text-indigo-700 dark:text-indigo-300">
                  {isAr ? "بنك الكريمي (الحساب الافتراضي)" : "Al-Kuraimi Bank (Default)"}
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                  {banks.map((b) => {
                    const isChosen = settlement.bankAccountId === b.id;
                    return (
                      <button
                        key={b.id}
                        type="button"
                        disabled={disabled}
                        onClick={() =>
                          onSettlementChange({
                            ...settlement,
                            bankAccountId: b.id,
                            bankAccountName: b.name_ar,
                            chartAccountId: b.account_id,
                          })
                        }
                        className={cn(
                          "flex items-center justify-between gap-1 rounded-lg border px-2.5 py-1.5 text-start transition",
                          isChosen
                            ? "border-indigo-600 bg-indigo-500/15 text-indigo-900 dark:text-indigo-200 font-bold shadow-2xs"
                            : "border-border/80 bg-background text-muted-foreground hover:text-foreground",
                        )}
                      >
                        <div className="truncate">
                          <p className="truncate font-semibold">{b.name_ar}</p>
                          {b.account_number && (
                            <p className="text-[10px] text-muted-foreground/80 font-mono truncate">
                              {b.account_number}
                            </p>
                          )}
                        </div>
                        {isChosen && <Check className="h-3.5 w-3.5 text-indigo-600 shrink-0" />}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Transfer Reference */}
            <div>
              <input
                type="text"
                disabled={disabled}
                value={settlement.reference ?? ""}
                onChange={(e) => onSettlementChange({ ...settlement, reference: e.target.value })}
                placeholder={
                  isAr
                    ? "رقم مرجع الحوالة البنكية / إشعار الإيداع..."
                    : "Bank transfer reference number..."
                }
                className="h-9 w-full rounded-xl border border-input/80 bg-background px-3 text-xs outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
              />
            </div>
          </div>
        )}

        {/* CASE D: CHEQUE -> Cheque Details */}
        {value === "cheque" && (
          <div className="space-y-2">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold text-amber-700 dark:text-amber-400">
              <FileCheck2 className="h-4 w-4" />
              <span>
                {isAr
                  ? "بيانات الشيك (أوراق قبض برسم التحصيل):"
                  : "Cheque Details (Under Collection):"}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] text-muted-foreground mb-0.5 block">
                  {isAr ? "رقم الشيك:" : "Cheque Number:"}
                </label>
                <input
                  type="text"
                  disabled={disabled}
                  value={settlement.cheque?.chequeNumber ?? settlement.chequeNumber ?? ""}
                  onChange={(e) =>
                    onSettlementChange({
                      ...settlement,
                      chequeNumber: e.target.value,
                      cheque: {
                        chequeNumber: e.target.value,
                        bankName: settlement.cheque?.bankName ?? settlement.chequeBank ?? "",
                        dueDate:
                          settlement.cheque?.dueDate ??
                          settlement.chequeDueDate ??
                          new Date().toISOString().slice(0, 10),
                        drawerName: settlement.cheque?.drawerName ?? settlement.chequeDrawer ?? "",
                      },
                    })
                  }
                  placeholder={isAr ? "مثال: 789456" : "e.g. 789456"}
                  className="h-8 w-full rounded-lg border border-input/80 bg-background px-2 text-xs outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500/20"
                />
              </div>

              <div>
                <label className="text-[10px] text-muted-foreground mb-0.5 block">
                  {isAr ? "البنك المسحوب عليه:" : "Drawn Bank:"}
                </label>
                <input
                  type="text"
                  disabled={disabled}
                  value={settlement.cheque?.bankName ?? settlement.chequeBank ?? ""}
                  onChange={(e) =>
                    onSettlementChange({
                      ...settlement,
                      chequeBank: e.target.value,
                      cheque: {
                        chequeNumber:
                          settlement.cheque?.chequeNumber ?? settlement.chequeNumber ?? "",
                        bankName: e.target.value,
                        dueDate:
                          settlement.cheque?.dueDate ??
                          settlement.chequeDueDate ??
                          new Date().toISOString().slice(0, 10),
                        drawerName: settlement.cheque?.drawerName ?? settlement.chequeDrawer ?? "",
                      },
                    })
                  }
                  placeholder={isAr ? "مثال: بنك التضامن الإسلامي" : "e.g. Tadhamon Bank"}
                  className="h-8 w-full rounded-lg border border-input/80 bg-background px-2 text-xs outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500/20"
                />
              </div>

              <div>
                <label className="text-[10px] text-muted-foreground mb-0.5 block">
                  {isAr ? "تاريخ استحقاق الشيك:" : "Due Date:"}
                </label>
                <input
                  type="date"
                  disabled={disabled}
                  value={
                    settlement.cheque?.dueDate ??
                    settlement.chequeDueDate ??
                    new Date().toISOString().slice(0, 10)
                  }
                  onChange={(e) =>
                    onSettlementChange({
                      ...settlement,
                      chequeDueDate: e.target.value,
                      cheque: {
                        chequeNumber:
                          settlement.cheque?.chequeNumber ?? settlement.chequeNumber ?? "",
                        bankName: settlement.cheque?.bankName ?? settlement.chequeBank ?? "",
                        dueDate: e.target.value,
                        drawerName: settlement.cheque?.drawerName ?? settlement.chequeDrawer ?? "",
                      },
                    })
                  }
                  className="h-8 w-full rounded-lg border border-input/80 bg-background px-2 text-xs outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500/20"
                />
              </div>

              <div>
                <label className="text-[10px] text-muted-foreground mb-0.5 block">
                  {isAr ? "اسم الساحب (اختياري):" : "Drawer (Optional):"}
                </label>
                <input
                  type="text"
                  disabled={disabled}
                  value={settlement.cheque?.drawerName ?? settlement.chequeDrawer ?? ""}
                  onChange={(e) =>
                    onSettlementChange({
                      ...settlement,
                      chequeDrawer: e.target.value,
                      cheque: {
                        chequeNumber:
                          settlement.cheque?.chequeNumber ?? settlement.chequeNumber ?? "",
                        bankName: settlement.cheque?.bankName ?? settlement.chequeBank ?? "",
                        dueDate:
                          settlement.cheque?.dueDate ??
                          settlement.chequeDueDate ??
                          new Date().toISOString().slice(0, 10),
                        drawerName: e.target.value,
                      },
                    })
                  }
                  placeholder={isAr ? "اسم صاحب الحساب أو الشركة" : "Account holder name"}
                  className="h-8 w-full rounded-lg border border-input/80 bg-background px-2 text-xs outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500/20"
                />
              </div>
            </div>
          </div>
        )}

        {/* CASE E: CARD -> Terminal or reference */}
        {currentKind === "CARD" && (
          <div className="flex items-center justify-between text-[11px] text-blue-700 dark:text-blue-300">
            <span className="flex items-center gap-1.5">
              <CreditCard className="h-4 w-4" />
              {isAr ? "الدفع عبر جهاز الشبكة / بطاقة الصراف (مدى)" : "POS Terminal / Debit Card"}
            </span>
            <Badge variant="outline" className="border-blue-500/40 text-[10px]">
              {isAr ? "تسوية بنكية مباشرة" : "Direct Settlement"}
            </Badge>
          </div>
        )}

        {/* CASE F: CREDIT -> On Account Notification */}
        {currentKind === "CREDIT" && (
          <div className="flex items-center justify-between text-[11px] text-amber-700 dark:text-amber-400">
            <span>
              {isAr
                ? "تسجيل مديونية مؤجلة في حساب ذمم العميل"
                : "Record outstanding balance on customer account"}
            </span>
            <Badge variant="outline" className="border-amber-500/40 text-[10px]">
              {isAr ? "آجل (ذمم)" : "On Account"}
            </Badge>
          </div>
        )}
      </div>
    </div>
  );
}

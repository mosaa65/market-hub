import React, { useState, useEffect, useMemo } from "react";
import {
  Banknote,
  HandCoins,
  Landmark,
  Smartphone,
  CheckCircle2,
  AlertCircle,
  RotateCcw,
  Layers,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { AmountInput } from "@/components/ui/amount-input";
import { money } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export interface SplitPaymentValues {
  cash: number;
  credit: number;
  bank_transfer: number;
  mobile_money: number;
  bankReference?: string;
  walletReference?: string;
}

export interface SplitPaymentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  total: number;
  initialValues?: Partial<SplitPaymentValues>;
  isCreditAllowed?: boolean;
  creditBlockReason?: string | null;
  /**
   * Which tender cards to show. Defaults to all four. A collection screen passes
   * `["cash", "bank_transfer", "mobile_money"]` because a receipt can never
   * CREATE a debt — hiding آجل here removes the whole class of "collected 500,
   * booked 500 as a new receivable" mistakes.
   */
  methods?: readonly SplitMethodKey[];
  onConfirm: (values: SplitPaymentValues) => void;
}

export type SplitMethodKey = "cash" | "credit" | "bank_transfer" | "mobile_money";

const DEFAULT_SPLIT_METHODS: readonly SplitMethodKey[] = [
  "cash",
  "credit",
  "bank_transfer",
  "mobile_money",
];

export function SplitPaymentDialog({
  open,
  onOpenChange,
  total,
  initialValues,
  isCreditAllowed = true,
  creditBlockReason,
  methods = DEFAULT_SPLIT_METHODS,
  onConfirm,
}: SplitPaymentDialogProps) {
  const { lang } = useI18n();
  const isAr = lang === "ar";
  const showCash = methods.includes("cash");
  const showCredit = methods.includes("credit") && isCreditAllowed;
  const showBank = methods.includes("bank_transfer");
  const showWallet = methods.includes("mobile_money");
  const cardCols = methods.length <= 1 ? "sm:grid-cols-1" : "sm:grid-cols-2";

  const [cash, setCash] = useState<number>(0);
  const [credit, setCredit] = useState<number>(0);
  const [bank, setBank] = useState<number>(0);
  const [wallet, setWallet] = useState<number>(0);
  const [bankRef, setBankRef] = useState<string>("");
  const [walletRef, setWalletRef] = useState<string>("");

  // Sync state whenever the dialog opens
  useEffect(() => {
    if (open) {
      const initCash = initialValues?.cash ?? 0;
      const initCredit = initialValues?.credit ?? 0;
      const initBank = initialValues?.bank_transfer ?? 0;
      const initWallet = initialValues?.mobile_money ?? 0;

      // If all zero and we have a total, pre-fill cash by default for convenience
      if (initCash === 0 && initCredit === 0 && initBank === 0 && initWallet === 0 && total > 0) {
        setCash(total);
        setCredit(0);
        setBank(0);
        setWallet(0);
      } else {
        setCash(initCash);
        setCredit(initCredit);
        setBank(initBank);
        setWallet(initWallet);
      }
      setBankRef(initialValues?.bankReference ?? "");
      setWalletRef(initialValues?.walletReference ?? "");
    }
  }, [open, total, initialValues]);

  const allocatedTotal = useMemo(() => {
    return Math.round(((cash || 0) + (credit || 0) + (bank || 0) + (wallet || 0)) * 100) / 100;
  }, [cash, credit, bank, wallet]);

  const remaining = useMemo(() => {
    return Math.round((total - allocatedTotal) * 100) / 100;
  }, [total, allocatedTotal]);

  const isBalanced = Math.abs(remaining) < 0.005;
  const isOverpaid = remaining < -0.005;

  // Credit validation
  const creditError =
    credit > 0 && !isCreditAllowed
      ? creditBlockReason ||
        (isAr ? "العميل النقدي لا يمكنه الشراء بالآجل" : "Cash customer cannot carry credit")
      : null;

  const canConfirm = isBalanced && !creditError;

  const handleReset = () => {
    setCash(0);
    setCredit(0);
    setBank(0);
    setWallet(0);
    setBankRef("");
    setWalletRef("");
  };

  const handleAllocateRemaining = (target: "cash" | "credit" | "bank" | "wallet") => {
    if (remaining <= 0) return;
    if (target === "cash") setCash((prev) => Math.round((prev + remaining) * 100) / 100);
    else if (target === "credit") {
      if (!isCreditAllowed) return;
      setCredit((prev) => Math.round((prev + remaining) * 100) / 100);
    } else if (target === "bank") setBank((prev) => Math.round((prev + remaining) * 100) / 100);
    else if (target === "wallet") setWallet((prev) => Math.round((prev + remaining) * 100) / 100);
  };

  const handleSubmit = () => {
    if (!canConfirm) return;
    onConfirm({
      cash: Math.max(0, cash),
      credit: Math.max(0, credit),
      bank_transfer: Math.max(0, bank),
      mobile_money: Math.max(0, wallet),
      bankReference: bankRef.trim() || undefined,
      walletReference: walletRef.trim() || undefined,
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] w-[calc(100vw-1.5rem)] max-w-2xl overflow-y-auto rounded-3xl p-4 sm:p-6 shadow-2xl border border-primary/20 bg-background/98 backdrop-blur-xl transition-all">
        {/* Header */}
        <DialogHeader className="border-b border-border/70 pb-3">
          <div className="flex items-center gap-2.5">
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary border border-primary/20">
              <Layers className="h-5 w-5" />
            </div>
            <div>
              <DialogTitle className="text-base sm:text-lg font-extrabold text-foreground">
                {isAr ? "الدفع المجزأ (أكثر من طريقة)" : "Split Payment (Multiple Methods)"}
              </DialogTitle>
              <p className="text-xs text-muted-foreground mt-0.5">
                {isAr
                  ? "توزيع المبلغ على طرق الدفع الأربع مع الترحيل والوزن المحاسبي المتطابق."
                  : "Allocate the invoice total across the 4 payment methods with balanced ledger posting."}
              </p>
            </div>
          </div>
        </DialogHeader>

        {/* 4 Core Payment Method Allocation Cards */}
        <div className={cn("grid-cols-1 gap-3.5 my-3", cardCols)}>
          {/* 1. Cash Card */}
          {showCash && (
            <div className="rounded-2xl border border-emerald-500/25 bg-emerald-500/[0.03] p-3.5 space-y-2.5 transition hover:border-emerald-500/40">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="grid h-7 w-7 place-items-center rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-700 dark:text-emerald-300">
                    <Banknote className="h-4 w-4" strokeWidth={2.5} />
                  </div>
                  <div>
                    <span className="text-xs font-bold text-foreground block leading-tight">
                      {isAr ? "نقدًا" : "Cash"}
                    </span>
                    <span className="text-[10px] text-muted-foreground font-mono">
                      {isAr ? "الصندوق الرئيسي (1101)" : "Till (1101)"}
                    </span>
                  </div>
                </div>
                {remaining > 0 && (
                  <button
                    type="button"
                    onClick={() => handleAllocateRemaining("cash")}
                    className="text-[10px] font-bold text-emerald-700 dark:text-emerald-300 hover:underline bg-emerald-500/10 px-2 py-0.5 rounded-md"
                  >
                    +{money(remaining)}
                  </button>
                )}
              </div>
              <div>
                <label className="text-[11px] font-semibold text-muted-foreground block mb-1">
                  {isAr ? "المبلغ المدفوع نقدًا:" : "Cash Amount:"}
                </label>
                <AmountInput
                  min={0}
                  placeholder="0.00"
                  value={cash === 0 ? null : cash}
                  onValueChange={(val) => setCash(val == null ? 0 : Number(val))}
                  className="h-10 text-xs sm:text-sm font-bold border-emerald-500/30 focus:border-emerald-500"
                />
              </div>
            </div>
          )}

          {/* 2. Credit Card */}
          {showCredit && (
            <div
              className={cn(
                "rounded-2xl border p-3.5 space-y-2.5 transition",
                creditError
                  ? "border-destructive/40 bg-destructive/5"
                  : "border-amber-500/25 bg-amber-500/[0.03] hover:border-amber-500/40",
              )}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="grid h-7 w-7 place-items-center rounded-lg bg-amber-500/15 border border-amber-500/30 text-amber-700 dark:text-amber-300">
                    <HandCoins className="h-4 w-4" strokeWidth={2.5} />
                  </div>
                  <div>
                    <span className="text-xs font-bold text-foreground block leading-tight">
                      {isAr ? "آجل (ذمم)" : "Credit (Receivables)"}
                    </span>
                    <span className="text-[10px] text-muted-foreground font-mono">
                      {isAr ? "ذمم العملاء (1211)" : "Debtors (1211)"}
                    </span>
                  </div>
                </div>
                {remaining > 0 && isCreditAllowed && (
                  <button
                    type="button"
                    onClick={() => handleAllocateRemaining("credit")}
                    className="text-[10px] font-bold text-amber-700 dark:text-amber-300 hover:underline bg-amber-500/10 px-2 py-0.5 rounded-md"
                  >
                    +{money(remaining)}
                  </button>
                )}
              </div>
              <div>
                <label className="text-[11px] font-semibold text-muted-foreground block mb-1">
                  {isAr ? "المبلغ المتبقي كآجل:" : "Credit Amount:"}
                </label>
                <AmountInput
                  min={0}
                  disabled={!isCreditAllowed}
                  placeholder={
                    isCreditAllowed
                      ? "0.00"
                      : isAr
                        ? "معطل للعميل النقدي"
                        : "Disabled for cash customer"
                  }
                  value={credit === 0 ? null : credit}
                  onValueChange={(val) => setCredit(val == null ? 0 : Number(val))}
                  className="h-10 text-xs sm:text-sm font-bold border-amber-500/30 focus:border-amber-500 disabled:opacity-60"
                />
                {creditError && (
                  <p className="text-[10px] text-destructive font-bold mt-1">{creditError}</p>
                )}
              </div>
            </div>
          )}

          {/* 3. Bank Card */}
          {showBank && (
            <div className="rounded-2xl border border-indigo-500/25 bg-indigo-500/[0.03] p-3.5 space-y-2.5 transition hover:border-indigo-500/40">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="grid h-7 w-7 place-items-center rounded-lg bg-indigo-500/15 border border-indigo-500/30 text-indigo-700 dark:text-indigo-300">
                    <Landmark className="h-4 w-4" strokeWidth={2.5} />
                  </div>
                  <div>
                    <span className="text-xs font-bold text-foreground block leading-tight">
                      {isAr ? "بنك" : "Bank"}
                    </span>
                    <span className="text-[10px] text-muted-foreground font-mono">
                      {isAr ? "البنوك (1111)" : "Bank Account (1111)"}
                    </span>
                  </div>
                </div>
                {remaining > 0 && (
                  <button
                    type="button"
                    onClick={() => handleAllocateRemaining("bank")}
                    className="text-[10px] font-bold text-indigo-700 dark:text-indigo-300 hover:underline bg-indigo-500/10 px-2 py-0.5 rounded-md"
                  >
                    +{money(remaining)}
                  </button>
                )}
              </div>
              <div className="space-y-2">
                <div>
                  <label className="text-[11px] font-semibold text-muted-foreground block mb-1">
                    {isAr ? "المبلغ عبر البنك:" : "Bank Amount:"}
                  </label>
                  <AmountInput
                    min={0}
                    placeholder="0.00"
                    value={bank === 0 ? null : bank}
                    onValueChange={(val) => setBank(val == null ? 0 : Number(val))}
                    className="h-10 text-xs sm:text-sm font-bold border-indigo-500/30 focus:border-indigo-500"
                  />
                </div>
                {bank > 0 && (
                  <input
                    type="text"
                    value={bankRef}
                    onChange={(e) => setBankRef(e.target.value)}
                    placeholder={
                      isAr
                        ? "رقم الحوالة البنكية / المرجع (اختياري)..."
                        : "Bank reference (optional)..."
                    }
                    className="h-8 w-full rounded-xl border border-indigo-500/20 bg-background px-3 text-[11px] font-medium outline-none focus:border-indigo-500"
                  />
                )}
              </div>
            </div>
          )}

          {/* 4. Mobile Money Card */}
          {showWallet && (
            <div className="rounded-2xl border border-sky-500/25 bg-sky-500/[0.03] p-3.5 space-y-2.5 transition hover:border-sky-500/40">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="grid h-7 w-7 place-items-center rounded-lg bg-sky-500/15 border border-sky-500/30 text-sky-700 dark:text-sky-300">
                    <Smartphone className="h-4 w-4" strokeWidth={2.5} />
                  </div>
                  <div>
                    <span className="text-xs font-bold text-foreground block leading-tight">
                      {isAr ? "محفظة إلكترونية" : "E-Wallet"}
                    </span>
                    <span className="text-[10px] text-muted-foreground font-mono">
                      {isAr ? "المحافظ (1131)" : "E-Wallets (1131)"}
                    </span>
                  </div>
                </div>
              </div>
              {remaining > 0 && (
                <button
                  type="button"
                  onClick={() => handleAllocateRemaining("wallet")}
                  className="text-[10px] font-bold text-sky-700 dark:text-sky-300 hover:underline bg-sky-500/10 px-2 py-0.5 rounded-md"
                >
                  +{money(remaining)}
                </button>
              )}
              <div className="space-y-2">
                <div>
                  <label className="text-[11px] font-semibold text-muted-foreground block mb-1">
                    {isAr ? "المبلغ عبر المحفظة:" : "Wallet Amount:"}
                  </label>
                  <AmountInput
                    min={0}
                    placeholder="0.00"
                    value={wallet === 0 ? null : wallet}
                    onValueChange={(val) => setWallet(val == null ? 0 : Number(val))}
                    className="h-10 text-xs sm:text-sm font-bold border-sky-500/30 focus:border-sky-500"
                  />
                </div>
                {wallet > 0 && (
                  <input
                    type="text"
                    value={walletRef}
                    onChange={(e) => setWalletRef(e.target.value)}
                    placeholder={
                      isAr ? "رقم عملية المحفظة (اختياري)..." : "Wallet transaction reference..."
                    }
                    className="h-8 w-full rounded-xl border border-sky-500/20 bg-background px-3 text-[11px] font-medium outline-none focus:border-sky-500"
                  />
                )}
              </div>
            </div>
          )}
        </div>
        <div className="rounded-2xl border border-border/70 bg-surface/90 p-3 sm:p-4 space-y-2">
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="border-e border-border/60 pe-2">
              <span className="text-[11px] font-semibold text-muted-foreground block">
                {isAr ? "إجمالي الفاتورة" : "Invoice Total"}
              </span>
              <span className="text-sm sm:text-base font-black font-mono text-foreground">
                {money(total)}
              </span>
            </div>
            <div className="border-e border-border/60 pe-2">
              <span className="text-[11px] font-semibold text-muted-foreground block">
                {isAr ? "إجمالي الموزع" : "Total Allocated"}
              </span>
              <span className="text-sm sm:text-base font-black font-mono text-primary">
                {money(allocatedTotal)}
              </span>
            </div>
            <div>
              <span className="text-[11px] font-semibold text-muted-foreground block">
                {isAr ? "الفارق" : "Difference"}
              </span>
              <span
                className={cn(
                  "text-sm sm:text-base font-black font-mono",
                  isBalanced
                    ? "text-emerald-600 dark:text-emerald-400"
                    : isOverpaid
                      ? "text-destructive"
                      : "text-amber-600 dark:text-amber-400",
                )}
              >
                {money(remaining)}
              </span>
            </div>
          </div>

          {/* Status Message */}
          <div className="pt-2 border-t border-border/50 flex items-center justify-between text-xs">
            {isBalanced ? (
              <div className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400 font-bold">
                <CheckCircle2 className="h-4 w-4 shrink-0" />
                <span>
                  {isAr ? "المبالغ متطابقة ومتوازنة محاسبياً ✓" : "Amounts perfectly balanced ✓"}
                </span>
              </div>
            ) : isOverpaid ? (
              <div className="flex items-center gap-1.5 text-destructive font-bold">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>
                  {isAr
                    ? `تجاوز إجمالي الفاتورة بمقدار ${money(Math.abs(remaining))}`
                    : `Exceeds invoice by ${money(Math.abs(remaining))}`}
                </span>
              </div>
            ) : (
              <div className="flex items-center gap-1.5 text-amber-600 dark:text-amber-400 font-bold">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>
                  {isAr
                    ? `متبقي للتوزيع: ${money(remaining)}`
                    : `Remaining to allocate: ${money(remaining)}`}
                </span>
              </div>
            )}

            <button
              type="button"
              onClick={handleReset}
              className="inline-flex items-center gap-1 text-[11px] font-semibold text-muted-foreground hover:text-foreground transition"
            >
              <RotateCcw className="h-3 w-3" />
              <span>{isAr ? "تصفير" : "Reset"}</span>
            </button>
          </div>
        </div>

        {/* Footer Actions */}
        <DialogFooter className="mt-2 flex flex-row items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="h-9 px-4 rounded-xl border border-border bg-background text-xs font-semibold text-foreground hover:bg-muted transition"
          >
            {isAr ? "إلغاء" : "Cancel"}
          </button>
          <button
            type="button"
            disabled={!canConfirm}
            onClick={handleSubmit}
            className="h-9 px-5 rounded-xl bg-primary text-xs font-bold text-primary-foreground shadow-sm hover:bg-primary/90 disabled:opacity-40 transition"
          >
            {isAr ? "تأكيد واعتماد الدفع المجزأ" : "Confirm Split Payment"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

import { useMemo } from "react";
import {
  Plus,
  Trash2,
  Landmark,
  Smartphone,
  Banknote,
  AlertCircle,
  CheckCircle2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { money } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import type { Cashbox, CompanyBankAccount, SplitTenderLine } from "@/lib/payments/treasury-types";
import { Button } from "@/components/ui/button";

export interface SplitPaymentsManagerProps {
  total: number;
  lines: SplitTenderLine[];
  onChange: (lines: SplitTenderLine[]) => void;
  activeCashboxes: Cashbox[];
  defaultCashbox?: Cashbox;
  banks: CompanyBankAccount[];
  defaultBank?: CompanyBankAccount;
  wallets: CompanyBankAccount[];
  defaultWallet?: CompanyBankAccount;
  currency?: string;
  disabled?: boolean;
  className?: string;
}

export function SplitPaymentsManager({
  total,
  lines,
  onChange,
  activeCashboxes,
  defaultCashbox,
  banks,
  defaultBank,
  wallets,
  defaultWallet,
  currency = "YER",
  disabled = false,
  className,
}: SplitPaymentsManagerProps) {
  const { lang } = useI18n();
  const isAr = lang === "ar";

  const totalAllocated = useMemo(
    () => Math.round(lines.reduce((s, l) => s + (Number(l.amount) || 0), 0) * 100) / 100,
    [lines],
  );

  const remaining = Math.round(Math.max(0, total - totalAllocated) * 100) / 100;
  const isOverpaid = totalAllocated > total;
  const isFullyAllocated = totalAllocated === total && total > 0;

  const handleAddLine = (category: "CASH" | "BANK" | "WALLET") => {
    const nextAmount = remaining > 0 ? remaining : 0;
    let newLine: SplitTenderLine;

    if (category === "CASH") {
      const box = defaultCashbox || activeCashboxes[0];
      newLine = {
        id: crypto.randomUUID(),
        category: "CASH",
        method: "cash",
        paymentMethodId: "cash",
        amount: nextAmount,
        cashboxId: box?.id || null,
        cashboxName: box?.name_ar || (isAr ? "الصندوق الرئيسي" : "Main Till"),
        reference: "",
      };
    } else if (category === "BANK") {
      const bank = defaultBank || banks[0];
      newLine = {
        id: crypto.randomUUID(),
        category: "BANK",
        method: "bank_transfer",
        paymentMethodId: bank?.bank_name.includes("كريمي") ? "kuraimi_bank" : "bank_transfer",
        amount: nextAmount,
        bankAccountId: bank?.id || null,
        bankAccountName: bank?.name_ar || (isAr ? "تحويل بنكي" : "Bank Transfer"),
        reference: "",
      };
    } else {
      const wallet = defaultWallet || wallets[0];
      newLine = {
        id: crypto.randomUUID(),
        category: "WALLET",
        method: "mobile_money",
        paymentMethodId: wallet?.name_ar.includes("جوالي")
          ? "jawali"
          : wallet?.name_ar.includes("جيب")
            ? "jaib"
            : "mobile_money",
        amount: nextAmount,
        bankAccountId: wallet?.id || null,
        bankAccountName: wallet?.name_ar || (isAr ? "محفظة إلكترونية" : "E-Wallet"),
        reference: "",
      };
    }

    onChange([...lines, newLine]);
  };

  const handleUpdateLine = (id: string, patch: Partial<SplitTenderLine>) => {
    onChange(lines.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  };

  const handleRemoveLine = (id: string) => {
    onChange(lines.filter((l) => l.id !== id));
  };

  return (
    <div
      className={cn("space-y-3 rounded-2xl border border-border/80 bg-surface/70 p-3.5", className)}
    >
      {/* رأس إدارة التجزئة */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 pb-2.5">
        <div>
          <span className="text-xs font-bold text-foreground">
            {isAr ? "توزيع الدفع المجزأ متعدد الوسائل" : "Split Tender Breakdown"}
          </span>
          <p className="text-[11px] text-muted-foreground">
            {isAr
              ? "سدد الفاتورة بأكثر من وسيلة (نقد، بنك، محفظة) مع توجيه كل جزء لحسابه المالي."
              : "Pay using multiple tenders with direct ledger posting per account."}
          </p>
        </div>

        {/* أزرار إضافة الدفعات */}
        <div className="flex items-center gap-1.5">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={disabled}
            onClick={() => handleAddLine("CASH")}
            className="h-8 gap-1 rounded-xl text-xs font-semibold text-emerald-700 hover:bg-emerald-500/10 border-emerald-500/30"
          >
            <Banknote className="h-3.5 w-3.5" />
            <span>{isAr ? "+ نقدًا" : "+ Cash"}</span>
          </Button>

          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={disabled}
            onClick={() => handleAddLine("BANK")}
            className="h-8 gap-1 rounded-xl text-xs font-semibold text-indigo-700 hover:bg-indigo-500/10 border-indigo-500/30"
          >
            <Landmark className="h-3.5 w-3.5" />
            <span>{isAr ? "+ بنك" : "+ Bank"}</span>
          </Button>

          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={disabled}
            onClick={() => handleAddLine("WALLET")}
            className="h-8 gap-1 rounded-xl text-xs font-semibold text-sky-700 hover:bg-sky-500/10 border-sky-500/30"
          >
            <Smartphone className="h-3.5 w-3.5" />
            <span>{isAr ? "+ محفظة" : "+ Wallet"}</span>
          </Button>
        </div>
      </div>

      {/* قائمة أسطر التجزئة */}
      {lines.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border py-6 text-center text-xs text-muted-foreground">
          {isAr
            ? "لم تُضف أي دفعة بعد. اختر (+ نقدًا، + بنك، أو + محفظة) لبدء توزيع السداد."
            : "No split payments added yet. Click one of the buttons above to begin."}
        </div>
      ) : (
        <div className="space-y-2">
          {lines.map((line, index) => {
            const isCash = line.category === "CASH";
            const isBank = line.category === "BANK";
            const isWallet = line.category === "WALLET";

            return (
              <div
                key={line.id}
                className={cn(
                  "flex flex-col sm:flex-row items-stretch sm:items-center gap-2 rounded-xl border p-2.5 transition",
                  isCash && "border-emerald-500/30 bg-emerald-500/5",
                  isBank && "border-indigo-500/30 bg-indigo-500/5",
                  isWallet && "border-sky-500/30 bg-sky-500/5",
                )}
              >
                {/* الشارة والنوع */}
                <div className="flex items-center gap-1.5 sm:w-28 shrink-0">
                  {isCash && <Banknote className="h-4 w-4 text-emerald-600 shrink-0" />}
                  {isBank && <Landmark className="h-4 w-4 text-indigo-600 shrink-0" />}
                  {isWallet && <Smartphone className="h-4 w-4 text-sky-600 shrink-0" />}
                  <span className="text-xs font-bold truncate">
                    {isCash
                      ? isAr
                        ? "نقدًا"
                        : "Cash"
                      : isBank
                        ? isAr
                          ? "بنكي"
                          : "Bank"
                        : isAr
                          ? "محفظة"
                          : "Wallet"}
                  </span>
                  <span className="text-[10px] text-muted-foreground font-mono">#{index + 1}</span>
                </div>

                {/* الحساب المستلم / الصندوق */}
                <div className="flex-1 min-w-[140px]">
                  {isCash ? (
                    <select
                      value={line.cashboxId || ""}
                      disabled={disabled}
                      onChange={(e) => {
                        const box = activeCashboxes.find((c) => c.id === e.target.value);
                        handleUpdateLine(line.id, {
                          cashboxId: e.target.value,
                          cashboxName: box?.name_ar || null,
                        });
                      }}
                      className="h-8 w-full rounded-lg border border-border/80 bg-background px-2 text-xs font-medium outline-none"
                    >
                      {activeCashboxes.map((box) => (
                        <option key={box.id} value={box.id}>
                          {box.name_ar} {box.is_default ? (isAr ? "(افتراضي)" : "(Default)") : ""}
                        </option>
                      ))}
                    </select>
                  ) : isBank ? (
                    <select
                      value={line.bankAccountId || ""}
                      disabled={disabled}
                      onChange={(e) => {
                        const bank = banks.find((b) => b.id === e.target.value);
                        handleUpdateLine(line.id, {
                          bankAccountId: e.target.value,
                          bankAccountName: bank?.name_ar || null,
                          paymentMethodId: bank?.bank_name.includes("كريمي")
                            ? "kuraimi_bank"
                            : "bank_transfer",
                        });
                      }}
                      className="h-8 w-full rounded-lg border border-border/80 bg-background px-2 text-xs font-medium outline-none"
                    >
                      {banks.length === 0 && (
                        <option value="">
                          {isAr ? "بنك الكريمي (افتراضي)" : "Al-Kuraimi (Default)"}
                        </option>
                      )}
                      {banks.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name_ar} {b.account_number ? `(${b.account_number})` : ""}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <select
                      value={line.bankAccountId || ""}
                      disabled={disabled}
                      onChange={(e) => {
                        const wallet = wallets.find((w) => w.id === e.target.value);
                        handleUpdateLine(line.id, {
                          bankAccountId: e.target.value,
                          bankAccountName: wallet?.name_ar || null,
                          paymentMethodId: wallet?.name_ar.includes("جوالي")
                            ? "jawali"
                            : wallet?.name_ar.includes("جيب")
                              ? "jaib"
                              : "mobile_money",
                        });
                      }}
                      className="h-8 w-full rounded-lg border border-border/80 bg-background px-2 text-xs font-medium outline-none"
                    >
                      {wallets.length === 0 && (
                        <option value="">
                          {isAr ? "محفظة جوالي (افتراضي)" : "Jawali (Default)"}
                        </option>
                      )}
                      {wallets.map((w) => (
                        <option key={w.id} value={w.id}>
                          {w.name_ar}
                        </option>
                      ))}
                    </select>
                  )}
                </div>

                {/* المبلغ */}
                <div className="w-32 shrink-0">
                  <div className="relative">
                    <input
                      type="number"
                      min={0}
                      step="any"
                      dir="ltr"
                      disabled={disabled}
                      value={line.amount === 0 ? "" : line.amount}
                      onChange={(e) =>
                        handleUpdateLine(line.id, {
                          amount: Math.max(0, Number(e.target.value) || 0),
                        })
                      }
                      placeholder="0.00"
                      className="h-8 w-full rounded-lg border border-border/80 bg-background pe-7 ps-2 text-xs font-mono font-bold outline-none focus:border-primary"
                    />
                    <span className="pointer-events-none absolute end-2 top-2 text-[10px] text-muted-foreground">
                      {currency}
                    </span>
                  </div>
                </div>

                {/* المرجع / الإشعار */}
                {!isCash && (
                  <div className="flex-1 min-w-[120px]">
                    <input
                      type="text"
                      disabled={disabled}
                      value={line.reference || ""}
                      onChange={(e) => handleUpdateLine(line.id, { reference: e.target.value })}
                      placeholder={isAr ? "رقم المرجع / الحوالة" : "Reference no."}
                      className="h-8 w-full rounded-lg border border-border/80 bg-background px-2 text-xs outline-none focus:border-primary"
                    />
                  </div>
                )}

                {/* زر الحذف */}
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => handleRemoveLine(line.id)}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* شريط الملخص المالي الفوري */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border/70 bg-surface-2/60 px-3 py-2 text-xs">
        <div className="flex items-center gap-4">
          <div>
            <span className="text-muted-foreground">{isAr ? "مطلوب سداده: " : "Required: "}</span>
            <strong className="font-mono">{money(total)}</strong>
          </div>
          <div>
            <span className="text-muted-foreground">
              {isAr ? "إجمالي الموزع: " : "Allocated: "}
            </span>
            <strong
              className={cn(
                "font-mono font-bold",
                isOverpaid ? "text-destructive" : "text-emerald-600",
              )}
            >
              {money(totalAllocated)}
            </strong>
          </div>
          {remaining > 0 && (
            <div>
              <span className="text-muted-foreground">
                {isAr ? "المتبقي كدين: " : "Remaining debt: "}
              </span>
              <strong className="font-mono text-amber-600">{money(remaining)}</strong>
            </div>
          )}
        </div>

        <div>
          {isOverpaid && (
            <div className="flex items-center gap-1 font-bold text-destructive text-[11px]">
              <AlertCircle className="h-3.5 w-3.5" />
              <span>{isAr ? "الموزع يتجاوز إجمالي الفاتورة!" : "Over total amount!"}</span>
            </div>
          )}
          {isFullyAllocated && (
            <div className="flex items-center gap-1 font-semibold text-emerald-600 text-[11px]">
              <CheckCircle2 className="h-3.5 w-3.5" />
              <span>{isAr ? "تم توزيع كامل المبلغ بدقة" : "Fully balanced"}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

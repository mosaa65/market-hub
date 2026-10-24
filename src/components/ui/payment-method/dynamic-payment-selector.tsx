import React, { useMemo } from "react";
import {
  Banknote,
  HandCoins,
  Landmark,
  Smartphone,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";
import type { PaymentContext } from "@/lib/payments/payment-methods";
import type { PaymentSettlementSelection } from "@/lib/payments/treasury-types";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";

export type CorePaymentMethodId = "cash" | "credit" | "bank_transfer" | "mobile_money";

export interface CorePaymentMethodConfig {
  id: CorePaymentMethodId;
  nameAr: string;
  nameEn: string;
  icon: LucideIcon;
  iconColor: string;
  badgeBg: string;
  accountCode: string;
  accountNameAr: string;
  accountNameEn: string;
}

export const CORE_PAYMENT_METHODS: readonly CorePaymentMethodConfig[] = [
  {
    id: "cash",
    nameAr: "نقدًا",
    nameEn: "Cash",
    icon: Banknote,
    iconColor: "text-emerald-600 dark:text-emerald-400",
    badgeBg: "bg-emerald-500/15 border-emerald-500/30 text-emerald-700 dark:text-emerald-300",
    accountCode: "1101",
    accountNameAr: "الصندوق",
    accountNameEn: "Cash Till",
  },
  {
    id: "credit",
    nameAr: "آجل",
    nameEn: "Credit",
    icon: HandCoins,
    iconColor: "text-amber-600 dark:text-amber-400",
    badgeBg: "bg-amber-500/15 border-amber-500/30 text-amber-700 dark:text-amber-300",
    accountCode: "1211",
    accountNameAr: "ذمم",
    accountNameEn: "Receivables",
  },
  {
    id: "bank_transfer",
    nameAr: "بنك",
    nameEn: "Bank",
    icon: Landmark,
    iconColor: "text-indigo-600 dark:text-indigo-400",
    badgeBg: "bg-indigo-500/15 border-indigo-500/30 text-indigo-700 dark:text-indigo-300",
    accountCode: "1111",
    accountNameAr: "البنوك",
    accountNameEn: "Banks",
  },
  {
    id: "mobile_money",
    nameAr: "محفظة إلكترونية",
    nameEn: "E-Wallet",
    icon: Smartphone,
    iconColor: "text-sky-600 dark:text-sky-400",
    badgeBg: "bg-sky-500/15 border-sky-500/30 text-sky-700 dark:text-sky-300",
    accountCode: "1131",
    accountNameAr: "المحافظ الإلكترونية",
    accountNameEn: "E-Wallets",
  },
] as const;

export function normalizeCoreMethodId(value: string | null | undefined): CorePaymentMethodId {
  if (!value) return "cash";
  const norm = value.trim().toLowerCase();
  if (norm === "cash") return "cash";
  if (norm === "credit") return "credit";
  if (norm === "bank" || norm === "bank_transfer" || norm === "card" || norm === "cheque" || norm.includes("bank") || norm === "kuraimi_bank" || norm === "yemen_kuwait_bank") {
    return "bank_transfer";
  }
  if (norm === "mobile_money" || norm === "wallet" || norm === "jawali" || norm === "jaib" || norm === "floosak" || norm === "one_cash") {
    return "mobile_money";
  }
  return "cash";
}

export interface DynamicPaymentSelectorProps {
  context?: PaymentContext;
  value: string;
  onChange: (method: string) => void;
  settlement?: PaymentSettlementSelection;
  onSettlementChange?: (next: PaymentSettlementSelection) => void;
  includeCredit?: boolean;
  disabled?: boolean;
  className?: string;
  compact?: boolean;
  showReference?: boolean;
  ensureIds?: (string | null | undefined)[];
  allowedLegacyValues?: readonly string[];
  placeholder?: string;
}

export function DynamicPaymentSelector({
  value,
  onChange,
  settlement,
  onSettlementChange,
  includeCredit = true,
  disabled = false,
  className,
  showReference = false,
}: DynamicPaymentSelectorProps) {
  const { lang } = useI18n();
  const isAr = lang === "ar";

  const currentId = normalizeCoreMethodId(value);
  const currentConfig = useMemo(() => {
    return CORE_PAYMENT_METHODS.find((m) => m.id === currentId) ?? CORE_PAYMENT_METHODS[0];
  }, [currentId]);

  const visibleMethods = useMemo(() => {
    if (includeCredit) return CORE_PAYMENT_METHODS;
    return CORE_PAYMENT_METHODS.filter((m) => m.id !== "credit");
  }, [includeCredit]);

  const handleSelect = (nextId: string) => {
    const validatedId = normalizeCoreMethodId(nextId);
    onChange(validatedId);

    if (onSettlementChange) {
      const targetConfig = CORE_PAYMENT_METHODS.find((m) => m.id === validatedId) ?? CORE_PAYMENT_METHODS[0];
      const nextSettlement: PaymentSettlementSelection = {
        ...(settlement || { method: validatedId }),
        method: validatedId,
        paymentMethodId: validatedId,
        bankAccountName: validatedId === "bank_transfer" || validatedId === "mobile_money" ? targetConfig.nameAr : null,
        cashboxName: validatedId === "cash" ? "الصندوق الرئيسي" : null,
      };
      onSettlementChange(nextSettlement);
    }
  };

  const IconComponent = currentConfig.icon;

  return (
    <div className={cn("min-w-0 w-full space-y-1.5", className)}>
      <Select
        value={currentId}
        onValueChange={handleSelect}
        disabled={disabled}
      >
        <SelectTrigger
          className="h-10 sm:h-11 w-full rounded-xl border border-border/80 bg-background px-3 font-bold text-xs sm:text-sm text-foreground shadow-2xs transition-colors hover:bg-muted/30 focus:border-primary focus:ring-2 focus:ring-primary/20"
        >
          <div className="flex items-center gap-2.5 truncate">
            <div className={cn("grid h-6 w-6 shrink-0 place-items-center rounded-lg border", currentConfig.badgeBg)}>
              <IconComponent className={cn("h-3.5 w-3.5 shrink-0", currentConfig.iconColor)} strokeWidth={2.5} />
            </div>
            <span className="font-bold text-foreground text-xs sm:text-sm leading-none truncate">
              {isAr ? currentConfig.nameAr : currentConfig.nameEn}
            </span>
            <span className="text-[10px] font-semibold text-muted-foreground/80 shrink-0">
              ({isAr ? currentConfig.accountNameAr : currentConfig.accountCode})
            </span>
          </div>
        </SelectTrigger>

        <SelectContent className="rounded-xl border border-border/80 bg-popover p-1.5 shadow-lg">
          {visibleMethods.map((m) => {
            const ItemIcon = m.icon;
            const isSelected = m.id === currentId;
            return (
              <SelectItem
                key={m.id}
                value={m.id}
                className={cn(
                  "flex cursor-pointer items-center justify-between gap-3 rounded-lg px-2.5 py-2 text-xs sm:text-sm font-bold transition my-0.5",
                  isSelected ? "bg-muted/80 text-primary font-black" : "hover:bg-muted/60 text-foreground"
                )}
              >
                <div className="flex items-center gap-2.5">
                  <div className={cn("grid h-7 w-7 shrink-0 place-items-center rounded-lg border", m.badgeBg)}>
                    <ItemIcon className={cn("h-4 w-4 shrink-0", m.iconColor)} strokeWidth={2.5} />
                  </div>
                  <span className="font-bold text-foreground text-xs sm:text-sm">
                    {isAr ? m.nameAr : m.nameEn}
                  </span>
                  <span className="text-[11px] font-medium text-muted-foreground">
                    ({isAr ? m.accountNameAr : m.accountCode})
                  </span>
                </div>
              </SelectItem>
            );
          })}
        </SelectContent>
      </Select>

      {/* حقل مرجع إضافي اختياري للبنك أو المحفظة */}
      {showReference && (currentId === "bank_transfer" || currentId === "mobile_money") && (
        <div className="pt-1">
          <input
            type="text"
            disabled={disabled}
            value={settlement?.reference ?? ""}
            onChange={(e) =>
              onSettlementChange?.({
                ...(settlement || { method: currentId }),
                method: currentId,
                reference: e.target.value,
              })
            }
            placeholder={
              currentId === "bank_transfer"
                ? isAr
                  ? "رقم الحوالة البنكية / الإشعار..."
                  : "Bank transfer reference..."
                : isAr
                  ? "رقم عملية المحفظة الإلكترونية..."
                  : "Wallet transaction reference..."
            }
            className="h-8 w-full rounded-xl border border-input/80 bg-background px-3 text-xs font-semibold text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
          />
        </div>
      )}
    </div>
  );
}

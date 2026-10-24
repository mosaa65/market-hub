/**
 * PaymentMethodPicker — المكوّن الموحّد لاختيار طريقة الدفع.
 * يوجّه مباشرة إلى مكون DynamicPaymentSelector المعتمد ذي الطرق الأربع.
 */

import React from "react";
import { cn } from "@/lib/utils";
import {
  DynamicPaymentSelector,
  type DynamicPaymentSelectorProps,
} from "./dynamic-payment-selector";
import { PaymentMethodIcon } from "./payment-method-icon";
import {
  isSplitPaymentValue,
  paymentMethodLabel,
} from "@/lib/payments/payment-methods";
import { usePaymentMethods } from "@/hooks/use-payment-methods";

export interface PaymentMethodPickerProps extends Partial<DynamicPaymentSelectorProps> {
  value: string | null;
  onChange: (methodId: string) => void;
  ensureIds?: (string | null | undefined)[];
  allowedLegacyValues?: readonly string[];
  className?: string;
  ariaLabel?: string;
  placeholder?: string;
  "data-form-nav"?: boolean;
}

export function PaymentMethodPicker({
  context = "sales",
  value,
  onChange,
  includeCredit = true,
  disabled = false,
  className,
  ...props
}: PaymentMethodPickerProps) {
  return (
    <DynamicPaymentSelector
      context={context}
      value={value || "cash"}
      onChange={onChange}
      includeCredit={includeCredit}
      disabled={disabled}
      className={className}
      {...props}
    />
  );
}

/**
 * Chip للقراءة فقط يعرض أيقونة واسم طريقة الدفع على البطاقات وسجلات الفواتير.
 */
export function PaymentMethodChip({
  value,
  note,
  lang = "ar",
  className,
  methodId,
}: {
  value: string | null | undefined;
  note?: string | null;
  lang?: "ar" | "en";
  className?: string;
  methodId?: string | null;
}) {
  const { methods } = usePaymentMethods();

  const isSplit =
    value === "split" ||
    ((value === null || value === undefined) && isSplitPaymentValue(value, note));

  const method =
    methods.find((m) => methodId && m.id === methodId) ??
    methods.find((m) => m.id === value) ??
    methods.find((m) => m.legacyValue === value);

  const label = isSplit
    ? lang === "ar"
      ? "دفع بأكثر من طريقة"
      : "Split payment"
    : method
      ? lang === "ar"
        ? method.nameAr
        : (method.nameEn ?? method.nameAr)
      : paymentMethodLabel(value, lang);

  return (
    <span className={cn("inline-flex items-center gap-1.5 text-xs font-bold", className)}>
      <PaymentMethodIcon
        iconKey={isSplit ? "split" : (method?.iconKey ?? "cash")}
        methodId={methodId ?? method?.id}
        ledgerKind={isSplit ? "OTHER" : method?.ledgerKind}
        className="h-3.5 w-3.5"
      />
      <span className="font-bold">{label}</span>
    </span>
  );
}

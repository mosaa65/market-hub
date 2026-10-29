"use client";

import { usePaymentMethodsForContext } from "@/hooks/use-payment-methods";
import type { PaymentContext } from "@/lib/payments/payment-methods";
import type { PaymentSettlementSelection } from "@/lib/payments/treasury-types";
import { PaymentMethodSelect } from "./payment-method-select";

/**
 * DynamicPaymentSelector — غلاف توافق خلفي حول `PaymentMethodSelect`.
 *
 * كان هذا المكوّن يعرض شبكة أزرار لكل طريقة ثم لوحة ثانية للصندوق/البنك/المرجع
 * تحت كل زر، فكان يأخذ نصف الشاشة قبل كتابة أي مبلغ، ويختلف شكله عن منتقي نقطة
 * البيع. الإصدار الحالي لم يعد يرسم شيئًا بنفسه: كل الشاشات (المبيعات، نقطة
 * البيع، المصروفات، المرتجعات) ترسم الآن **نفس الحقل الأحادي السطر** مع قائمة
 * منسدلة تُفتح عند الحاجة.
 *
 * بقاء الملف والاسم قصدًا: عشرات الشاشات تستورده، وتغيير كل نداء في دفعة واحدة
 * يخلط تعديل التصميم بتعديل الاستيرادات. الشاشات الجديدة تستورد
 * `PaymentMethodSelect` مباشرة.
 */
export interface DynamicPaymentSelectorProps {
  context: PaymentContext;
  value: string;
  onChange: (method: string) => void;
  settlement: PaymentSettlementSelection;
  onSettlementChange: (next: PaymentSettlementSelection) => void;
  includeCredit?: boolean;
  disabled?: boolean;
  className?: string;
  /** محفوظ للتوافق: الغلاف الآن أحادي السطر دائمًا. */
  compact?: boolean;
  label?: string;
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
  label,
}: DynamicPaymentSelectorProps) {
  const { methods, isLoading } = usePaymentMethodsForContext(context, { includeCredit });

  return (
    <PaymentMethodSelect
      context={context}
      methods={methods}
      loading={isLoading}
      value={value}
      onChange={(method) => onChange(method.legacyValue)}
      settlement={settlement}
      onSettlementChange={onSettlementChange}
      includeCredit={includeCredit}
      disabled={disabled}
      className={className}
      label={label}
    />
  );
}

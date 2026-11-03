import * as React from "react";
import {
  type CommunicationEventType,
  type CustomerContext,
  type InvoiceContext,
  type PaymentContext,
} from "@/lib/communication";
import {
  VortexUnifiedOperationModal,
  type UnifiedVoucherData,
} from "@/components/vortex-ui/finance/vortex-unified-operation-modal";

export interface OperationSuccessModalProps {
  open: boolean;
  onClose: () => void;
  operationId?: string;
  title: string;
  subtitle?: string;
  amount?: number;
  currency?: string;
  referenceNumber?: string;
  customer?: CustomerContext | null;
  invoice?: InvoiceContext | null;
  payment?: PaymentContext | null;
  eventType?: CommunicationEventType;
  onPrint?: () => void;
  onViewDocument?: () => void;
  soundEnabled?: boolean;
  // Extra unified metadata
  partyType?: "customer" | "supplier";
  paymentMethod?: string;
  cashboxName?: string | null;
  bankAccountName?: string | null;
  remainingBalance?: number | null;
  notes?: string | null;
}

/**
 * OperationSuccessModal — النواة الموحدة لعرض تفاصيل السند المنبثق
 * بعد إتمام أي عملية (مبيعات، نقاط بيع، مشتريات، تحصيل، سندات).
 * تجمع بين الأناقة الفائقة وشارة الصح المتحركة وصوت الرنين
 * وخيارات المشاركة عبر واتساب و SMS ونسخ النص والطباعة.
 */
export function OperationSuccessModal({
  open,
  onClose,
  operationId,
  title,
  subtitle,
  amount,
  currency,
  referenceNumber,
  customer,
  invoice,
  payment,
  onPrint,
  onViewDocument,
  partyType = "customer",
  paymentMethod,
  cashboxName,
  bankAccountName,
  remainingBalance,
  notes,
}: OperationSuccessModalProps) {
  const voucherData: UnifiedVoucherData | null = React.useMemo(() => {
    if (!open) return null;
    const resolvedAmount =
      amount ??
      (typeof invoice?.totalAmount === "number" ? invoice.totalAmount : undefined) ??
      (typeof payment?.amount === "number" ? payment.amount : undefined) ??
      0;

    const resolvedRef =
      referenceNumber ||
      invoice?.invoiceNumber ||
      payment?.receiptNumber ||
      (operationId ? String(operationId).slice(-6) : undefined);

    return {
      operationId: operationId || resolvedRef,
      type: payment ? "payment" : invoice ? "invoice" : "general",
      title,
      subtitle,
      amount: resolvedAmount,
      currency,
      referenceNumber: resolvedRef,
      partyName: customer?.name,
      partyPhone: customer?.phone,
      partyType,
      paymentMethod:
        paymentMethod ||
        (payment?.method ? String(payment.method) : undefined),
      cashboxName,
      bankAccountName,
      remainingBalance:
        remainingBalance !== undefined
          ? remainingBalance
          : customer?.balance !== undefined
            ? customer.balance
            : invoice?.remaining !== undefined
              ? invoice.remaining
              : null,
      notes: notes || payment?.notes,
    };
  }, [
    open,
    amount,
    invoice,
    payment,
    referenceNumber,
    operationId,
    title,
    subtitle,
    currency,
    customer,
    partyType,
    paymentMethod,
    cashboxName,
    bankAccountName,
    remainingBalance,
    notes,
  ]);

  return (
    <VortexUnifiedOperationModal
      open={open}
      onClose={onClose}
      data={voucherData}
      onPrint={onPrint}
      onViewDocument={onViewDocument}
    />
  );
}

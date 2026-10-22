"use client";

import * as React from "react";
import { useState, useMemo } from "react";
import {
  CheckCircle2,
  MessageCircle,
  Send,
  Copy,
  Receipt,
  User,
  Check,
  Sparkles,
  Edit3,
  RefreshCw,
  Phone,
  CalendarDays,
} from "lucide-react";
import { VortexDrawerDialog } from "../form/vortex-drawer-dialog";
import { VortexTransactionDetailContent } from "./vortex-transaction-detail-sheet";
import { money } from "@/lib/format";
import { toSystemDigits } from "@/lib/format-preferences";
import { cn } from "@/lib/utils";
import { useFinancialPosting } from "@/hooks/use-financial-posting";
import { usePaymentMethodsForContext } from "@/hooks/use-payment-methods";
import { PaymentMethodPicker } from "@/components/ui/payment-method";
import { DynamicPaymentSelector } from "@/components/ui/payment-method/dynamic-payment-selector";
import { AmountInput } from "@/components/ui/amount-input";
import type { PaymentSettlementSelection } from "@/lib/payments/treasury-types";
import { paymentMethodLabel, requiresPaymentReference } from "@/lib/payments/payment-methods";

/** Catalogue id from the business's configured payment-method list. */
export type PaymentMethod = string;
type CollectionMode = "receivable" | "advance";

export interface CollectionCustomer {
  id: string;
  name: string;
  phone?: string | null;
  balance: number;
}

export interface CollectionReceipt {
  receiptNumber: string;
  customerName: string;
  customerPhone?: string;
  amount: number;
  remainingBalance: number;
  method: PaymentMethod;
  collectionMode: CollectionMode;
  date: string;
  paymentDate: string;
  notes?: string;
  cashboxName?: string | null;
  bankAccountName?: string | null;
}

export interface VortexCollectionSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customer: CollectionCustomer | null;
  onSuccess?: (receipt: CollectionReceipt) => void;
  /** Kept for legacy callers that own their own posting workflow. */
  onSavePayment?: (data: {
    customerId: string;
    amount: number;
    method: PaymentMethod;
    collectionMode?: CollectionMode;
    paymentDate?: string;
    reference?: string;
    cashboxId?: string | null;
    bankAccountId?: string | null;
    notes?: string;
  }) => Promise<{ receiptNumber: string }>;
  /** A preselected invoice may be supplied by the sales screen without changing the old sheet UI. */
  initialInvoiceId?: string | null;
  invoices?: Array<{ id: string; total: number; paid: number }>;
}

type MessageTemplateType = "official" | "reminder" | "short";

export function VortexCollectionSheet({
  open,
  onOpenChange,
  customer,
  onSuccess,
  onSavePayment,
  initialInvoiceId,
}: VortexCollectionSheetProps) {
  const { postPayment, isPosting } = useFinancialPosting();
  const [amount, setAmount] = useState<string>("");
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [settlement, setSettlement] = useState<PaymentSettlementSelection>({
    method: "cash",
    paymentMethodId: "cash",
  });
  const [collectionMode, setCollectionMode] = useState<CollectionMode>("receivable");
  const [paymentDate, setPaymentDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [reference, setReference] = useState<string>("");
  const [notes, setNotes] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [receipt, setReceipt] = useState<CollectionReceipt | null>(null);
  const [copied, setCopied] = useState(false);

  // Message customization state
  const [selectedTemplate, setSelectedTemplate] = useState<MessageTemplateType>("official");
  const [customMessage, setCustomMessage] = useState<string>("");
  const [isEditingMessage, setIsEditingMessage] = useState(false);

  React.useEffect(() => {
    if (customer && customer.balance > 0) {
      setAmount(String(customer.balance));
    } else {
      setAmount("");
    }
    setCollectionMode("receivable");
    setPaymentDate(new Date().toISOString().slice(0, 10));
    setReference("");
    setNotes("");
    setReceipt(null);
    setIsEditingMessage(false);
    setSelectedTemplate("official");
  }, [customer, open]);

  const currentBalance = customer?.balance || 0;
  const payAmount = parseFloat(amount) || 0;
  const remaining = Math.max(0, currentBalance - payAmount);
  const balanceAfterPayment = currentBalance - payAmount;
  const isOverpayment = collectionMode === "receivable" && payAmount > currentBalance;
  const { methods: paymentMethods } = usePaymentMethodsForContext("customer_collection", {
    includeCredit: false,
  });
  const selectedPaymentMethod = paymentMethods.find((item) => item.id === method);
  const needsReference =
    selectedPaymentMethod?.requiresReference ?? requiresPaymentReference(method);

  React.useEffect(() => {
    if (paymentMethods.length > 0 && !paymentMethods.some((item) => item.id === method)) {
      setMethod(paymentMethods[0].id);
    }
  }, [method, paymentMethods]);

  React.useEffect(() => {
    if (!needsReference) setReference("");
  }, [needsReference]);

  const labelForMethod = (methodId: string) => {
    const configuredMethod = paymentMethods.find((item) => item.id === methodId);
    return configuredMethod?.nameAr || paymentMethodLabel(methodId, "ar");
  };

  const methodLabel = labelForMethod(receipt?.method || method);
  const referenceLabel =
    selectedPaymentMethod?.legacyValue === "cheque"
      ? "رقم الشيك"
      : selectedPaymentMethod?.ledgerKind === "WALLET"
        ? "رقم عملية المحفظة"
        : "رقم الحوالة / المرجع";

  const buildTemplateMessage = (r: CollectionReceipt, tpl: MessageTemplateType) => {
    const formattedAmount = money(r.amount);
    const formattedRemaining = money(r.remainingBalance);
    const destination = r.bankAccountName
      ? ` (${r.bankAccountName})`
      : r.cashboxName
        ? ` (${r.cashboxName})`
        : "";
    const mLabel = labelForMethod(r.method) + destination;
    const balanceLine =
      r.collectionMode === "advance"
        ? "💳 تم تسجيل دفعة مقدمة مستقلة على حساب العميل."
        : r.remainingBalance > 0
          ? "📊 الرصيد المتبقي: " + formattedRemaining
          : "✅ تم سداد كامل الرصيد المستحق.";

    if (tpl === "official") {
      const parts = [
        "*سند قبض إلكتروني - فورتيكس ERP*",
        "--------------------------------",
        "👤 العميل: " + r.customerName,
        "💵 المبلغ المستلم: " + formattedAmount,
        "💳 طريقة الدفع: " + mLabel,
        "🔖 رقم السند: #" + r.receiptNumber,
        "📅 التاريخ: " + r.date,
        balanceLine,
        "--------------------------------",
        "شكراً لتعاملكم معنا ونسعد بخدمتكم دائماً.",
      ];
      return parts.join("\n");
    }

    if (tpl === "reminder") {
      const parts = [
        "مرحباً " + r.customerName + "،",
        "تم بنجاح تسجيل دفعة بقيمة " + formattedAmount + " برقم سند #" + r.receiptNumber + ".",
        r.collectionMode === "advance"
          ? "تم تسجيل الدفعة كمبلغ مقدم مستقل على حسابكم."
          : r.remainingBalance > 0
            ? "نود تذكيركم بأن الرصيد المتبقي على حسابكم هو: " + formattedRemaining + "."
            : "حسابكم الآن مسدد بالكامل.",
        "شاكرين لكم حسن تعاونكم.",
      ];
      return parts.join("\n");
    }

    return (
      "تم استلام " +
      formattedAmount +
      " من " +
      r.customerName +
      " بموجب سند #" +
      r.receiptNumber +
      " بتاريخ " +
      r.date +
      (r.collectionMode === "advance"
        ? ". تم تسجيلها كدفعة مقدمة."
        : ". المتبقي: " + formattedRemaining) +
      ". شكراً لكم."
    );
  };

  const handleTemplateChange = (tpl: MessageTemplateType) => {
    setSelectedTemplate(tpl);
    if (receipt) {
      setCustomMessage(buildTemplateMessage(receipt, tpl));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const effectiveReference = (settlement.reference || reference).trim();
    if (!customer || payAmount <= 0 || isOverpayment || (needsReference && !effectiveReference))
      return;

    const trimmedReference = effectiveReference;
    const trimmedNotes = notes.trim();
    const receiptNotes = [
      trimmedReference ? `مرجع: ${trimmedReference}` : null,
      trimmedNotes || null,
    ]
      .filter(Boolean)
      .join(" | ");

    try {
      setIsSubmitting(true);
      const res = onSavePayment
        ? await onSavePayment({
            customerId: customer.id,
            amount: payAmount,
            method: settlement.paymentMethodId || method,
            collectionMode,
            paymentDate,
            reference: trimmedReference || undefined,
            cashboxId: settlement.cashboxId || null,
            bankAccountId: settlement.bankAccountId || null,
            notes: receiptNotes || undefined,
          })
        : await postPayment({
            partyId: customer.id,
            partyType: "customer",
            type: "customer_collection",
            amount: payAmount,
            method: settlement.paymentMethodId || method,
            paymentMethodId: settlement.paymentMethodId || method,
            cashboxId: settlement.cashboxId || null,
            bankAccountId: settlement.bankAccountId || null,
            chequeNumber: settlement.chequeNumber || settlement.cheque?.chequeNumber || null,
            chequeBank: settlement.chequeBank || settlement.cheque?.bankName || null,
            chequeDueDate: settlement.chequeDueDate || settlement.cheque?.dueDate || null,
            chequeDrawer: settlement.chequeDrawer || settlement.cheque?.drawerName || null,
            invoiceId: collectionMode === "advance" ? null : (initialInvoiceId ?? null),
            paymentDate,
            reference: trimmedReference || null,
            note: trimmedNotes || null,
            collectionMode,
          });

      const displayDate = new Date(`${paymentDate}T12:00:00`).toLocaleDateString("ar-YE", {
        year: "numeric",
        month: "short",
        day: "numeric",
      });

      const newReceipt: CollectionReceipt = {
        receiptNumber: res?.receiptNumber || String(Date.now()).slice(-6),
        customerName: customer.name,
        customerPhone: customer.phone || undefined,
        amount: payAmount,
        remainingBalance: collectionMode === "advance" ? balanceAfterPayment : remaining,
        method,
        collectionMode,
        date: toSystemDigits(displayDate),
        paymentDate,
        notes: receiptNotes || undefined,
        cashboxName: settlement.cashboxName || null,
        bankAccountName: settlement.bankAccountName || null,
      };

      setReceipt(newReceipt);
      setCustomMessage(buildTemplateMessage(newReceipt, "official"));
      onSuccess?.(newReceipt);
    } finally {
      setIsSubmitting(false);
    }
  };

  const activeMessageText =
    customMessage || (receipt ? buildTemplateMessage(receipt, selectedTemplate) : "");
  // The former success screen stays here temporarily for the message-template
  // state, but the user is now shown the shared voucher-details body instead.
  // NOTE: typed explicitly as boolean (not a bare aliased const) so TypeScript's
  // aliased-condition narrowing doesn't narrow `receipt` to `never` inside the
  // `receipt ?` branch below (which made every `receipt.x` access inside the
  // legacy block report `never`).
  const showLegacyReceiptScreen: boolean = !receipt;
  const shareWhatsApp = () => {
    if (!receipt) return;
    const text = encodeURIComponent(activeMessageText);
    const phone = (receipt.customerPhone || "").replace(/\D/g, "");
    const url = phone ? `https://wa.me/${phone}?text=${text}` : `https://wa.me/?text=${text}`;
    window.open(url, "_blank");
  };

  const shareSMS = () => {
    if (!receipt) return;
    const text = encodeURIComponent(activeMessageText);
    const phone = (receipt.customerPhone || "").replace(/\D/g, "");
    window.open(`sms:${phone}?body=${text}`, "_blank");
  };

  const copyReceiptText = () => {
    navigator.clipboard.writeText(activeMessageText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (!customer) return null;

  return (
    <VortexDrawerDialog
      open={open}
      onOpenChange={onOpenChange}
      size="md"
      title={
        receipt ? (
          <div className="flex items-center gap-2">
            <span>تفاصيل السند المالي</span>
            <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-bold text-primary border border-primary/20">
              #{toSystemDigits(receipt.receiptNumber)}
            </span>
          </div>
        ) : (
          "سند قبض وتحصيل فوري"
        )
      }
      subtitle={
        receipt
          ? receipt.collectionMode === "advance"
            ? "تفاصيل دفعة مقدمة مسجلة على حساب العميل"
            : "تفاصيل سند القبض المسجل"
          : `العميل: ${customer.name} (الرصيد الحالي: ${money(currentBalance)})`
      }
      eyebrow="التحصيل المالي الذكي"
      icon={
        <div className="grid size-10 place-items-center rounded-2xl bg-foreground text-background shadow-md">
          {receipt ? (
            <CheckCircle2 className="size-5 text-emerald-400" />
          ) : (
            <Receipt className="size-5" />
          )}
        </div>
      }
    >
      {receipt ? (
        /* ─── Receipt Success & Message Review Screen ─── */
        <>
          <VortexTransactionDetailContent
            transaction={{
              id: receipt.receiptNumber,
              type: "payment",
              title:
                receipt.collectionMode === "advance" ? "دفعة مقدمة للعميل" : "سند قبض تحصيل عميل",
              amount: receipt.amount,
              date: receipt.paymentDate,
              customerName: receipt.customerName,
              customerPhone: receipt.customerPhone,
              referenceNumber: receipt.receiptNumber,
              method: methodLabel,
              notes: receipt.notes,
              remainingBalance: receipt.remainingBalance,
            }}
          />
          {showLegacyReceiptScreen && (
            <div className="space-y-4 py-2">
              {/* Summary Box */}
              <div className="rounded-3xl border border-emerald-500/30 bg-emerald-500/5 p-4 text-center space-y-1.5 backdrop-blur-sm">
                <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">
                  المبلغ المستلم
                </span>
                <div className="text-3xl font-black text-foreground font-mono">
                  {money(receipt.amount)}
                </div>
                <div className="flex flex-wrap items-center justify-center gap-2 pt-1 text-xs text-muted-foreground">
                  <span className="font-semibold">سند رقم: #{receipt.receiptNumber}</span>
                  <span>•</span>
                  <span>طريقة الدفع: {methodLabel}</span>
                  <span>•</span>
                  <span className="font-semibold text-foreground">
                    {receipt.collectionMode === "advance"
                      ? "دفعة مقدمة مستقلة"
                      : `المتبقي: ${money(receipt.remainingBalance)}`}
                  </span>
                </div>
              </div>

              {/* Interactive Message Review & Customization Box */}
              <div className="rounded-2xl border border-border/80 bg-card p-4 space-y-3 shadow-xs">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-foreground">
                    <Sparkles className="size-4 text-primary" />
                    <span>مراجعة وتخصيص نص الإشعار</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsEditingMessage(!isEditingMessage)}
                    className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary hover:underline cursor-pointer"
                  >
                    <Edit3 className="size-3" />
                    <span>{isEditingMessage ? "معاينة الرسالة" : "تعديل النص"}</span>
                  </button>
                </div>

                {/* Template Selector Chips */}
                <div className="flex flex-wrap gap-1.5">
                  {[
                    { id: "official" as const, label: "سند رسمي متكامل" },
                    { id: "reminder" as const, label: "إشعار وتذكير بالمتبقي" },
                    { id: "short" as const, label: "شكر موجز" },
                  ].map((tpl) => (
                    <button
                      key={tpl.id}
                      type="button"
                      onClick={() => handleTemplateChange(tpl.id)}
                      className={cn(
                        "rounded-xl px-2.5 py-1 text-[11px] font-bold transition cursor-pointer",
                        selectedTemplate === tpl.id
                          ? "bg-primary text-primary-foreground shadow-xs"
                          : "bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground",
                      )}
                    >
                      {tpl.label}
                    </button>
                  ))}
                </div>

                {/* Message Area */}
                {isEditingMessage ? (
                  <textarea
                    value={customMessage}
                    onChange={(e) => setCustomMessage(e.target.value)}
                    rows={5}
                    className="w-full rounded-xl border border-border bg-background p-3 text-xs leading-relaxed text-foreground font-sans focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                    placeholder="اكتب أو عدل نص الرسالة هنا..."
                    dir="rtl"
                  />
                ) : (
                  <div className="relative rounded-xl border border-border/70 bg-muted/30 p-3.5 text-xs leading-relaxed text-foreground whitespace-pre-wrap font-sans select-all">
                    {activeMessageText}
                  </div>
                )}

                {receipt.customerPhone ? (
                  <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                    <Phone className="size-3 text-emerald-500" />
                    <span>رقم هاتف العميل المسجل:</span>
                    <span className="font-mono font-bold text-foreground" dir="ltr">
                      {receipt.customerPhone}
                    </span>
                  </div>
                ) : (
                  <div className="text-[11px] text-amber-500 font-semibold">
                    ⚠️ العميل ليس لديه رقم هاتف مسجل، سيتم فتح نافذة الإرسال لاختيار جهة الاتصال
                    يدوياً.
                  </div>
                )}
              </div>

              {/* Action Buttons for WhatsApp & SMS */}
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={shareWhatsApp}
                    className="h-12 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs sm:text-sm flex items-center justify-center gap-2 shadow-md shadow-emerald-600/20 active:scale-98 transition cursor-pointer"
                  >
                    <MessageCircle className="size-4" />
                    <span>إرسال عبر واتساب</span>
                  </button>

                  <button
                    type="button"
                    onClick={shareSMS}
                    className="h-12 rounded-2xl bg-sky-600 hover:bg-sky-700 text-white font-bold text-xs sm:text-sm flex items-center justify-center gap-2 shadow-md shadow-sky-600/20 active:scale-98 transition cursor-pointer"
                  >
                    <Send className="size-4" />
                    <span>إرسال رسالة SMS</span>
                  </button>
                </div>

                <button
                  type="button"
                  onClick={copyReceiptText}
                  className="w-full h-11 rounded-2xl border border-border bg-card text-foreground font-bold text-xs flex items-center justify-center gap-2 hover:bg-muted transition cursor-pointer"
                >
                  {copied ? (
                    <Check className="size-4 text-emerald-500" />
                  ) : (
                    <Copy className="size-4" />
                  )}
                  <span>{copied ? "تم نسخ نص الإشعار بنجاح" : "نسخ نص الإشعار للحافظة"}</span>
                </button>
              </div>

              <div className="pt-2">
                <button
                  type="button"
                  onClick={() => onOpenChange(false)}
                  className="w-full h-12 rounded-2xl bg-foreground text-background font-bold text-xs sm:text-sm shadow-md hover:opacity-95 transition cursor-pointer"
                >
                  إتمام وإغلاق النافذة
                </button>
              </div>
            </div>
          )}
        </>
      ) : (
        /* ─── Collection Input Form ─── */
        <form onSubmit={handleSubmit} className="space-y-4 py-2">
          {/* Balance card */}
          <div className="flex items-center justify-between p-3.5 rounded-2xl bg-muted/60 border border-border/60">
            <div className="flex items-center gap-2.5">
              <div className="grid size-9 place-items-center rounded-xl bg-card text-foreground border">
                <User className="size-4 text-primary" />
              </div>
              <div>
                <span className="block text-xs font-bold text-foreground">{customer.name}</span>
                <span className="text-[11px] text-muted-foreground font-mono">
                  {customer.phone || "بدون رقم هاتف"}
                </span>
              </div>
            </div>
            <div className="text-end">
              <span className="block text-[10px] text-muted-foreground font-semibold">
                الرصيد المستحق
              </span>
              <span className="text-sm font-black font-mono text-rose-600 dark:text-rose-400">
                {money(currentBalance)}
              </span>
            </div>
          </div>

          <div className="rounded-2xl border border-border/70 bg-card p-2">
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setCollectionMode("receivable")}
                className={cn(
                  "rounded-xl px-3 py-2 text-xs font-bold transition",
                  collectionMode === "receivable"
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:bg-muted",
                )}
              >
                تحصيل مستحق
              </button>
              <button
                type="button"
                onClick={() => {
                  setCollectionMode("advance");
                  setAmount("");
                }}
                className={cn(
                  "rounded-xl px-3 py-2 text-xs font-bold transition",
                  collectionMode === "advance"
                    ? "bg-emerald-600 text-white shadow-sm"
                    : "text-muted-foreground hover:bg-muted",
                )}
              >
                دفعة مقدمة
              </button>
            </div>
            <p className="px-1 pt-2 text-[11px] text-muted-foreground">
              {collectionMode === "advance"
                ? "تُسجل كرصيد مقدم مستقل ولا تُوزع تلقائياً على الفواتير الحالية."
                : "يُمنع تجاوز الرصيد المستحق، وتُوزع الدفعة العامة من الأقدم إلى الأحدث."}
            </p>
          </div>

          {/* Amount input */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-foreground">
                {collectionMode === "advance" ? "قيمة الدفعة المقدمة" : "المبلغ المحصل"}
              </label>
              {collectionMode === "receivable" && currentBalance > 0 && (
                <button
                  type="button"
                  onClick={() => setAmount(String(currentBalance))}
                  className="text-[11px] font-bold text-primary hover:underline cursor-pointer"
                >
                  سداد كامل المستحق ({money(currentBalance)})
                </button>
              )}
            </div>
            <div className="relative">
              <AmountInput
                min={0.01}
                value={toNumberOrNull(amount)}
                onValueChange={(v) => setAmount(v == null ? "" : String(v))}
                placeholder="0.00"
                aria-label={collectionMode === "advance" ? "قيمة الدفعة المقدمة" : "المبلغ المحصل"}
                wordsClassName="text-xs"
                containerClassName="[&_input]:h-12 [&_input]:rounded-2xl [&_input]:bg-card [&_input]:text-base [&_input]:font-black"
              />
            </div>
            {payAmount > 0 && collectionMode === "receivable" && (
              <div className="text-[11px] text-muted-foreground flex justify-between px-1">
                <span>المتبقي بعد التحصيل:</span>
                <span className="font-bold font-mono text-foreground">{money(remaining)}</span>
              </div>
            )}
            {payAmount > 0 && collectionMode === "advance" && (
              <div className="text-[11px] text-emerald-700 dark:text-emerald-400 flex justify-between px-1">
                <span>رصيد العميل بعد الدفعة:</span>
                <span className="font-bold font-mono">{money(balanceAfterPayment)}</span>
              </div>
            )}
          </div>

          {/* Payment Method Selector */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-foreground">طريقة الدفع ومصدر التحصيل</label>
            <DynamicPaymentSelector
              context="customer_collection"
              value={method}
              onChange={setMethod}
              settlement={settlement}
              onSettlementChange={setSettlement}
              includeCredit={false}
              className="w-full"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-bold text-foreground">تاريخ السند</label>
            <div className="relative">
              <CalendarDays className="pointer-events-none absolute start-4 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <input
                type="date"
                value={paymentDate}
                max={new Date().toISOString().slice(0, 10)}
                onChange={(e) => setPaymentDate(e.target.value)}
                required
                className="w-full h-11 rounded-2xl border border-border bg-card ps-11 pe-4 text-xs font-medium text-foreground focus:border-primary focus:outline-none transition"
              />
            </div>
          </div>

          {needsReference && (
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-foreground">{referenceLabel}</label>
              <input
                type="text"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                placeholder={referenceLabel}
                required
                className="w-full h-11 rounded-2xl border border-border bg-card px-4 text-xs font-medium text-foreground focus:border-primary focus:outline-none transition"
              />
            </div>
          )}

          {/* Notes */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-foreground">ملاحظات (اختياري)</label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="تفاصيل إضافية عن سند القبض..."
              className="w-full h-11 rounded-2xl border border-border bg-card px-4 text-xs font-medium text-foreground focus:border-primary focus:outline-none transition"
            />
          </div>

          {/* Submit */}
          <div className="pt-3">
            <button
              type="submit"
              disabled={isSubmitting || isPosting || payAmount <= 0 || isOverpayment}
              className="w-full h-12 rounded-2xl bg-foreground text-background font-bold text-xs sm:text-sm flex items-center justify-center gap-2 shadow-lg shadow-foreground/15 hover:opacity-95 active:scale-98 transition disabled:opacity-50 cursor-pointer"
            >
              {isSubmitting || isPosting ? "جاري الحفظ..." : "تأكيد وإصدار السند فوراً"}
            </button>
          </div>
        </form>
      )}
    </VortexDrawerDialog>
  );
}

/**
 * حالة النموذج تحتفظ بالمبلغ كسلسلة، بينما `AmountInput` يعمل بقيمة
 * `number | null`. النص الفارغ أو غير الرقمي يصبح null بدل NaN.
 */
function toNumberOrNull(value: string | number | null | undefined): number | null {
  if (value == null) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed.replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

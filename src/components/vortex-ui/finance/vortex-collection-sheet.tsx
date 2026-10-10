"use client";

import * as React from "react";
import { useState, useMemo, useEffect } from "react";
import {
  Banknote,
  CheckCircle2,
  Copy,
  Check,
  Sparkles,
  Edit3,
  RefreshCw,
  Calendar,
  CreditCard,
  FileText,
  Wallet,
  Hash,
} from "lucide-react";
import { VortexDrawerDialog } from "../form/vortex-drawer-dialog";
import { money } from "@/lib/format";
import { toSystemDigits } from "@/lib/format-preferences";
import { cn } from "@/lib/utils";
import { WhatsAppIcon } from "@/components/whatsapp-icon";
import {
  buildUnifiedContext,
  renderMessage,
  playSuccessChime,
  buildWhatsAppLink,
  isValidWhatsAppPhone,
} from "@/lib/communication";
import { useFinancialPosting, type PaymentMethodType } from "@/hooks/use-financial-posting";
import { PaymentMethodPicker } from "@/components/ui/payment-method";
import { paymentMethodLabel } from "@/lib/payments/payment-methods";

export type PaymentMethod = PaymentMethodType;

export interface CollectionCustomer {
  id: string;
  name: string;
  phone?: string | null;
  balance: number;
  type?: "customer" | "supplier";
}

export interface CollectionReceipt {
  receiptNumber: string;
  customerName: string;
  customerPhone?: string;
  amount: number;
  remainingBalance: number;
  method: PaymentMethod;
  date: string;
  notes?: string;
  reference?: string;
  invoiceId?: string;
}

export interface VortexCollectionSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customer: CollectionCustomer | null;
  partyType?: "customer" | "supplier";
  invoices?: Array<{ id: string; invoiceNumber?: string; total: number; paid: number }>;
  onSuccess?: (receipt: CollectionReceipt) => void;
  onSavePayment?: (data: {
    customerId: string;
    amount: number;
    method: PaymentMethod;
    notes?: string;
    reference?: string;
    date?: string;
    invoiceId?: string;
    accountId?: string;
  }) => Promise<{ receiptNumber: string }>;
}

type MessageTemplateType = "official" | "reminder" | "short";

export function VortexCollectionSheet({
  open,
  onOpenChange,
  customer,
  partyType = "customer",
  invoices = [],
  onSuccess,
  onSavePayment,
}: VortexCollectionSheetProps) {
  const { postPayment, isPosting: isHookPosting } = useFinancialPosting();
  const [amount, setAmount] = useState<string>("");
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [notes, setNotes] = useState<string>("");
  const [reference, setReference] = useState<string>("");
  const [paymentDate, setPaymentDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string>("");
  const [accountId, setAccountId] = useState<string>("main_drawer");

  const [saving, setSaving] = useState(false);
  const [successReceipt, setSuccessReceipt] = useState<CollectionReceipt | null>(null);
  const [copied, setCopied] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<MessageTemplateType>("official");
  const [customMessage, setCustomMessage] = useState<string>("");
  const [isEditingMessage, setIsEditingMessage] = useState(false);

  useEffect(() => {
    if (open) {
      setAmount("");
      setMethod("cash");
      setNotes("");
      setReference("");
      setPaymentDate(new Date().toISOString().slice(0, 10));
      setSelectedInvoiceId("");
      setAccountId("main_drawer");
      setSuccessReceipt(null);
      setCopied(false);
      setSelectedTemplate("official");
      setCustomMessage("");
      setIsEditingMessage(false);
    }
  }, [open, customer]);

  const numAmount = parseFloat(amount) || 0;
  const currentBalance = customer?.balance || 0;
  const remaining = Math.max(0, currentBalance - numAmount);
  const isValidAmount = numAmount > 0;

  const quickAmounts = useMemo(() => {
    if (!currentBalance || currentBalance <= 0) return [];
    const full = Math.round(currentBalance);
    const half = Math.round(currentBalance / 2);
    const quarter = Math.round(currentBalance / 4);
    return [
      { label: "كامل المبلغ", val: full },
      { label: "النصف", val: half },
      { label: "الربع", val: quarter },
    ].filter((o) => o.val > 0);
  }, [currentBalance]);

  const handleSubmit = async () => {
    if (!customer || !isValidAmount) return;
    setSaving(true);
    try {
      let receiptNum = "";

      if (onSavePayment) {
        const res = await onSavePayment({
          customerId: customer.id,
          amount: numAmount,
          method,
          notes: notes || undefined,
          reference: reference || undefined,
          date: paymentDate,
          invoiceId: selectedInvoiceId || undefined,
          accountId,
        });
        receiptNum = res.receiptNumber;
      } else {
        const res = await postPayment({
          partyId: customer.id,
          partyType: customer.type || partyType,
          amount: numAmount,
          method: method as PaymentMethodType,
          invoiceId: selectedInvoiceId || null,
          paymentDate,
          reference: reference || null,
          accountId: accountId || null,
          note: notes || null,
        });
        receiptNum = res.receiptNumber;
      }

      const receipt: CollectionReceipt = {
        receiptNumber: receiptNum || String(Date.now()).slice(-6),
        customerName: customer.name,
        customerPhone: customer.phone || undefined,
        amount: numAmount,
        remainingBalance: remaining,
        method,
        date: paymentDate,
        notes,
        reference,
        invoiceId: selectedInvoiceId || undefined,
      };

      setSuccessReceipt(receipt);
      playSuccessChime();
      onSuccess?.(receipt);
    } catch (e) {
      console.error("Save payment error:", e);
    } finally {
      setSaving(false);
    }
  };

  const messageContext = useMemo(() => {
    if (!successReceipt) return null;
    return buildUnifiedContext({
      event: "payment_received",
      customer: {
        id: customer?.id || "temp",
        name: successReceipt.customerName,
        phone: successReceipt.customerPhone || null,
        balance: successReceipt.remainingBalance,
      },
      payment: {
        id: successReceipt.receiptNumber,
        receiptNumber: successReceipt.receiptNumber,
        amount: successReceipt.amount,
        remainingBalance: successReceipt.remainingBalance,
        method: successReceipt.method,
        date: successReceipt.date,
      },
    });
  }, [successReceipt, customer]);

  const generatedMessage = useMemo(() => {
    if (!messageContext) return "";
    // المحرك يُنتج RenderedMessage بغض النظر عن الحدث المُختار في السياق؛
    // مفتاح القالب هنا يحدّد نصّ الواتساب فقط (إيصال أو تذكير بدين).
    const rendered = renderMessage({
      ...messageContext,
      event:
        selectedTemplate === "official"
          ? ("payment_received" as const)
          : ("payment_request" as const),
    });
    return rendered.text;
  }, [messageContext, selectedTemplate]);

  const activeMessage = isEditingMessage ? customMessage : generatedMessage;

  const handleCopyMessage = async () => {
    if (!activeMessage) return;
    await navigator.clipboard.writeText(activeMessage);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleWhatsAppShare = () => {
    if (!activeMessage) return;
    const phone = successReceipt?.customerPhone;
    if (phone && isValidWhatsAppPhone(phone)) {
      // buildWhatsAppLink قد تُعيد null حين يكون الرقم غير صالح للواتساب.
      window.open(
        buildWhatsAppLink(phone, activeMessage) ||
          `https://wa.me/?text=${encodeURIComponent(activeMessage)}`,
        "_blank",
      );
    } else {
      window.open(`https://wa.me/?text=${encodeURIComponent(activeMessage)}`, "_blank");
    }
  };

  return (
    <VortexDrawerDialog
      open={open}
      onOpenChange={onOpenChange}
      title={
        successReceipt
          ? "تم التحصيل بنجاح"
          : partyType === "supplier"
            ? "سند صرف مورد"
            : "سند تحصيل عميل"
      }
      description={
        successReceipt
          ? `رقم السند: ${toSystemDigits(successReceipt.receiptNumber)}`
          : customer
            ? `الطرف: ${customer.name}`
            : undefined
      }
      className="max-w-lg"
    >
      {successReceipt ? (
        <div className="space-y-5 py-2">
          <div className="flex flex-col items-center justify-center py-4 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/50 rounded-2xl text-center">
            <div className="w-14 h-14 rounded-full bg-emerald-500 text-white flex items-center justify-center mb-3 shadow-lg shadow-emerald-500/20 animate-in zoom-in-50 duration-300">
              <Check className="w-8 h-8 stroke-[3]" />
            </div>
            <div className="text-2xl font-black text-emerald-700 dark:text-emerald-400">
              {toSystemDigits(money(successReceipt.amount))}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              تم توثيق السند وترحيله للدفتر المحاسبي
            </p>
          </div>

          <div className="bg-card border rounded-xl p-4 space-y-2.5 text-sm">
            <div className="flex justify-between items-center text-muted-foreground text-xs">
              <span>الطرف المستفيد</span>
              <span className="font-semibold text-foreground">{successReceipt.customerName}</span>
            </div>
            <div className="flex justify-between items-center text-muted-foreground text-xs">
              <span>طريقة الدفع</span>
              <span className="font-medium text-foreground">
                {paymentMethodLabel(successReceipt.method, "ar")}
              </span>
            </div>
            {successReceipt.reference && (
              <div className="flex justify-between items-center text-muted-foreground text-xs">
                <span>المرجع</span>
                <span className="font-medium text-foreground">{successReceipt.reference}</span>
              </div>
            )}
            <div className="flex justify-between items-center text-muted-foreground text-xs pt-1 border-t">
              <span>الرصيد المتبقي</span>
              <span className="font-bold text-foreground">
                {toSystemDigits(money(successReceipt.remainingBalance))}
              </span>
            </div>
          </div>

          <div className="bg-muted/40 border rounded-xl p-3.5 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold flex items-center gap-1.5 text-primary">
                <Sparkles className="w-3.5 h-3.5" />
                رسالة الإشعار الذكية
              </span>
              <div className="flex items-center gap-1 bg-background border rounded-lg p-0.5 text-[11px]">
                <button
                  type="button"
                  onClick={() => {
                    setSelectedTemplate("official");
                    setIsEditingMessage(false);
                  }}
                  className={cn(
                    "px-2 py-0.5 rounded",
                    selectedTemplate === "official" &&
                      "bg-primary text-primary-foreground font-medium",
                  )}
                >
                  رسمي
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedTemplate("reminder");
                    setIsEditingMessage(false);
                  }}
                  className={cn(
                    "px-2 py-0.5 rounded",
                    selectedTemplate === "reminder" &&
                      "bg-primary text-primary-foreground font-medium",
                  )}
                >
                  موجز
                </button>
              </div>
            </div>

            {isEditingMessage ? (
              <textarea
                value={customMessage}
                onChange={(e) => setCustomMessage(e.target.value)}
                rows={3}
                className="w-full text-xs p-2 rounded-lg border bg-background resize-none focus:outline-none focus:ring-1 focus:ring-primary"
              />
            ) : (
              <p className="text-xs text-muted-foreground whitespace-pre-wrap bg-background/80 p-2.5 rounded-lg border leading-relaxed">
                {activeMessage}
              </p>
            )}

            <div className="flex items-center gap-2 pt-1">
              <button
                type="button"
                onClick={handleWhatsAppShare}
                className="flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-medium transition-colors"
              >
                <WhatsAppIcon className="w-4 h-4 fill-white" />
                إرسال واتساب
              </button>
              <button
                type="button"
                onClick={handleCopyMessage}
                className="flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg border bg-background hover:bg-muted text-xs font-medium transition-colors"
              >
                {copied ? (
                  <Check className="w-4 h-4 text-emerald-500" />
                ) : (
                  <Copy className="w-4 h-4" />
                )}
                {copied ? "تم النسخ" : "نسخ"}
              </button>
              <button
                type="button"
                onClick={() => {
                  if (!isEditingMessage) setCustomMessage(generatedMessage);
                  setIsEditingMessage(!isEditingMessage);
                }}
                className="p-2 rounded-lg border bg-background hover:bg-muted text-muted-foreground"
                title="تعديل الرسالة"
              >
                <Edit3 className="w-4 h-4" />
              </button>
            </div>
          </div>

          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="w-full py-2.5 rounded-xl border bg-background hover:bg-muted text-sm font-semibold transition-colors"
          >
            إغلاق
          </button>
        </div>
      ) : (
        <div className="space-y-4 py-1">
          {customer && (
            <div className="bg-muted/40 border rounded-xl p-3.5 flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground">الرصيد المستحق حالياً</p>
                <p className="text-lg font-black text-foreground mt-0.5">
                  {toSystemDigits(money(customer.balance))}
                </p>
              </div>
              <div className="text-right">
                <p className="text-xs text-muted-foreground">المتبقي بعد السند</p>
                <p className="text-sm font-bold text-emerald-600 dark:text-emerald-400 mt-0.5">
                  {toSystemDigits(money(remaining))}
                </p>
              </div>
            </div>
          )}

          {quickAmounts.length > 0 && (
            <div className="flex gap-2">
              {quickAmounts.map((q) => (
                <button
                  key={q.label}
                  type="button"
                  onClick={() => setAmount(String(q.val))}
                  className="flex-1 py-1.5 px-2 rounded-lg border text-xs font-medium hover:border-primary hover:bg-primary/5 transition-all text-center"
                >
                  <span className="block text-muted-foreground text-[10px]">{q.label}</span>
                  <span className="font-bold">{toSystemDigits(money(q.val))}</span>
                </button>
              ))}
            </div>
          )}

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
              <Banknote className="w-3.5 h-3.5 text-primary" />
              المبلغ المدفوع
            </label>
            <input
              type="number"
              step="any"
              min="0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              className="w-full text-xl font-bold p-3 rounded-xl border bg-background focus:outline-none focus:ring-2 focus:ring-primary/30"
              autoFocus
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                <CreditCard className="w-3.5 h-3.5 text-primary" />
                طريقة الدفع
              </label>
              {/*
                One picker instead of a four-option <select>. The collection
                context is its own scope, so a business that takes only cash
                and بنك الكريمي from customers sees exactly those two here.
              */}
              <PaymentMethodPicker
                context="customer_collection"
                value={method}
                onChange={setMethod}
                ensureIds={[method]}
                ariaLabel="طريقة الدفع"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                <Wallet className="w-3.5 h-3.5 text-primary" />
                الصندوق / الحساب
              </label>
              <select
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
                className="w-full text-xs p-2.5 rounded-xl border bg-background focus:outline-none focus:ring-1 focus:ring-primary"
              >
                <option value="main_drawer">الصندوق الرئيسي (الخزينة)</option>
                <option value="bank_account">الحساب البنكي المعتمد</option>
              </select>
            </div>
          </div>

          {invoices.length > 0 && (
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                <FileText className="w-3.5 h-3.5 text-primary" />
                ربط بفاتورة محددة (اختياري)
              </label>
              <select
                value={selectedInvoiceId}
                onChange={(e) => setSelectedInvoiceId(e.target.value)}
                className="w-full text-xs p-2 rounded-xl border bg-background focus:outline-none focus:ring-1 focus:ring-primary"
              >
                <option value="">توزيع آلي على الفواتير المستحقة (الأقدم فالأحدث)</option>
                {invoices.map((inv) => (
                  <option key={inv.id} value={inv.id}>
                    فاتورة #{inv.invoiceNumber || inv.id.slice(0, 6)} - المتبقي:{" "}
                    {toSystemDigits(money(inv.total - inv.paid))}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5 text-primary" />
                تاريخ السند
              </label>
              <input
                type="date"
                value={paymentDate}
                onChange={(e) => setPaymentDate(e.target.value)}
                className="w-full text-xs p-2 rounded-xl border bg-background focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                <Hash className="w-3.5 h-3.5 text-primary" />
                رقم المرجع / الحوالة
              </label>
              <input
                type="text"
                placeholder="اختياري"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                className="w-full text-xs p-2 rounded-xl border bg-background focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
              <FileText className="w-3.5 h-3.5 text-primary" />
              ملاحظات
            </label>
            <input
              type="text"
              placeholder="أي تفاصيل أو ملاحظات..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full text-xs p-2.5 rounded-xl border bg-background focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>

          <div className="pt-2 flex gap-2">
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!isValidAmount || saving || isHookPosting}
              className="flex-1 py-3 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground text-sm font-bold flex items-center justify-center gap-2 shadow-sm transition-all disabled:opacity-50"
            >
              {saving || isHookPosting ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  جاري تسجيل السند...
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-4 h-4" />
                  تسجيل وترحيل السند
                </>
              )}
            </button>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="py-3 px-4 rounded-xl border hover:bg-muted text-sm font-medium transition-colors"
            >
              إلغاء
            </button>
          </div>
        </div>
      )}
    </VortexDrawerDialog>
  );
}

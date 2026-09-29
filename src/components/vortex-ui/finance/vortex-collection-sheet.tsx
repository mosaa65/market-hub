"use client";

import * as React from "react";
import { useState, useMemo } from "react";
import {
  Banknote,
  CreditCard,
  Building2,
  FileCheck,
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
} from "lucide-react";
import { VortexDrawerDialog } from "../form/vortex-drawer-dialog";
import { money } from "@/lib/format";
import { toSystemDigits } from "@/lib/format-preferences";
import { cn } from "@/lib/utils";

export type PaymentMethod = "cash" | "card" | "transfer" | "cheque";

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
  date: string;
  notes?: string;
}

export interface VortexCollectionSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customer: CollectionCustomer | null;
  onSuccess?: (receipt: CollectionReceipt) => void;
  onSavePayment: (data: {
    customerId: string;
    amount: number;
    method: PaymentMethod;
    notes?: string;
  }) => Promise<{ receiptNumber: string }>;
}

type MessageTemplateType = "official" | "reminder" | "short";

export function VortexCollectionSheet({
  open,
  onOpenChange,
  customer,
  onSuccess,
  onSavePayment,
}: VortexCollectionSheetProps) {
  const [amount, setAmount] = useState<string>("");
  const [method, setMethod] = useState<PaymentMethod>("cash");
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
    setNotes("");
    setReceipt(null);
    setIsEditingMessage(false);
    setSelectedTemplate("official");
  }, [customer, open]);

  const currentBalance = customer?.balance || 0;
  const payAmount = parseFloat(amount) || 0;
  const remaining = Math.max(0, currentBalance - payAmount);

  const paymentMethods = [
    { id: "cash", label: "نقداً (كاش)", icon: Banknote },
    { id: "card", label: "بطاقة مدى / شبكة", icon: CreditCard },
    { id: "transfer", label: "حوالة بنكية", icon: Building2 },
    { id: "cheque", label: "شيك مصرفي", icon: FileCheck },
  ] as const;

  const methodLabel =
    paymentMethods.find((m) => m.id === (receipt?.method || method))?.label || "نقداً";

  const buildTemplateMessage = (r: CollectionReceipt, tpl: MessageTemplateType) => {
    const formattedAmount = money(r.amount);
    const formattedRemaining = money(r.remainingBalance);
    const mLabel = paymentMethods.find((m) => m.id === r.method)?.label || "نقداً";

    if (tpl === "official") {
      const parts = [
        "*سند قبض إلكتروني - فورتيكس ERP*",
        "--------------------------------",
        "👤 العميل: " + r.customerName,
        "💵 المبلغ المستلم: " + formattedAmount,
        "💳 طريقة الدفع: " + mLabel,
        "🔖 رقم السند: #" + r.receiptNumber,
        "📅 التاريخ: " + r.date,
        r.remainingBalance > 0
          ? "📊 الرصيد المتبقي: " + formattedRemaining
          : "✅ تم سداد كامل الرصيد المستحق.",
        "--------------------------------",
        "شكراً لتعاملكم معنا ونسعد بخدمتكم دائماً.",
      ];
      return parts.join("\n");
    }

    if (tpl === "reminder") {
      const parts = [
        "مرحباً " + r.customerName + "،",
        "تم بنجاح تسجيل دفعة بقيمة " + formattedAmount + " برقم سند #" + r.receiptNumber + ".",
        r.remainingBalance > 0
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
      ". المتبقي: " +
      formattedRemaining +
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
    if (!customer || payAmount <= 0) return;

    try {
      setIsSubmitting(true);
      const res = await onSavePayment({
        customerId: customer.id,
        amount: payAmount,
        method,
        notes: notes.trim() || undefined,
      });

      const today = new Date().toLocaleDateString("ar-SA", {
        year: "numeric",
        month: "short",
        day: "numeric",
      });

      const newReceipt: CollectionReceipt = {
        receiptNumber: res.receiptNumber || String(Date.now()).slice(-6),
        customerName: customer.name,
        customerPhone: customer.phone || undefined,
        amount: payAmount,
        remainingBalance: remaining,
        method,
        date: toSystemDigits(today),
        notes: notes.trim() || undefined,
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
      title={receipt ? "تم تسجيل سند القبض بنجاح" : "سند قبض وتحصيل فوري"}
      subtitle={
        receipt
          ? "تم حفظ السند في السجلات ويمكنك مراجعة وإرسال الإشعار فوراً"
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
                المتبقي: {money(receipt.remainingBalance)}
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
                ⚠️ العميل ليس لديه رقم هاتف مسجل، سيتم فتح نافذة الإرسال لاختيار جهة الاتصال يدوياً.
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
              {copied ? <Check className="size-4 text-emerald-500" /> : <Copy className="size-4" />}
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

          {/* Amount input */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-foreground">المبلغ المحصل</label>
              {currentBalance > 0 && (
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
              <input
                type="number"
                step="any"
                min="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                required
                className="w-full h-12 rounded-2xl border border-border bg-card px-4 text-base font-black font-mono text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 transition"
              />
            </div>
            {payAmount > 0 && (
              <div className="text-[11px] text-muted-foreground flex justify-between px-1">
                <span>المتبقي بعد التحصيل:</span>
                <span className="font-bold font-mono text-foreground">{money(remaining)}</span>
              </div>
            )}
          </div>

          {/* Payment Method Selector */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-foreground">طريقة الدفع</label>
            <div className="grid grid-cols-2 gap-2">
              {paymentMethods.map((m) => {
                const Icon = m.icon;
                const isSelected = method === m.id;
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setMethod(m.id)}
                    className={cn(
                      "flex items-center gap-2 h-11 px-3 rounded-2xl border text-xs font-bold transition cursor-pointer",
                      isSelected
                        ? "border-primary bg-primary/10 text-primary font-black shadow-sm"
                        : "border-border bg-card text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <Icon
                      className={cn(
                        "size-4",
                        isSelected ? "text-primary" : "text-muted-foreground",
                      )}
                    />
                    <span>{m.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Notes */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-foreground">
              ملاحظات أو رقم المرجع (اختياري)
            </label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="رقم الحوالة، أو مرجع الشيك، أو تفاصيل الإيصال..."
              className="w-full h-11 rounded-2xl border border-border bg-card px-4 text-xs font-medium text-foreground focus:border-primary focus:outline-none transition"
            />
          </div>

          {/* Submit */}
          <div className="pt-3">
            <button
              type="submit"
              disabled={isSubmitting || payAmount <= 0}
              className="w-full h-12 rounded-2xl bg-foreground text-background font-bold text-xs sm:text-sm flex items-center justify-center gap-2 shadow-lg shadow-foreground/15 hover:opacity-95 active:scale-98 transition disabled:opacity-50 cursor-pointer"
            >
              {isSubmitting ? "جاري الحفظ..." : "تأكيد وإصدار السند فوراً"}
            </button>
          </div>
        </form>
      )}
    </VortexDrawerDialog>
  );
}

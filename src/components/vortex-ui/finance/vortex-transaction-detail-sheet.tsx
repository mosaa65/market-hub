"use client";

import * as React from "react";
import {
  Receipt,
  CheckCircle2,
  Calendar,
  User,
  CreditCard,
  MessageCircle,
  Send,
  Copy,
  Check
} from "lucide-react";
import { VortexDrawerDialog } from "../form/vortex-drawer-dialog";
import { VortexDateBadge } from "../display/vortex-date-badge";
import { formatSystemNumber, toSystemDigits } from "@/lib/format-preferences";

export interface VortexTransactionDetailSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  transaction: {
    id: string;
    type: "payment" | "invoice" | "debt";
    title: string;
    amount: number;
    date: string;
    customerName: string;
    customerPhone?: string | null;
    referenceNumber?: string;
    method?: string;
    notes?: string;
    remainingBalance?: number;
  } | null;
}

export function VortexTransactionDetailSheet({
  open,
  onOpenChange,
  transaction,
}: VortexTransactionDetailSheetProps) {
  const [copied, setCopied] = React.useState(false);

  if (!transaction) return null;

  const isPayment = transaction.type === "payment";

  const generateMessage = () => {
    return `مرحباً أستاذ/ة ${transaction.customerName}،
إشعار بعملية: ${transaction.title}
المبلغ: ${formatSystemNumber(transaction.amount, { currency: "ر.س" })}
رقم المرجع: #${transaction.referenceNumber || transaction.id.slice(-6)}
التاريخ: ${transaction.date}
${transaction.remainingBalance !== undefined ? `المتبقي في الحساب: ${formatSystemNumber(transaction.remainingBalance, { currency: "ر.س" })}` : ""}
شاكرين لكم ومقدرين حسن تعاونكم.`;
  };

  const shareWhatsApp = () => {
    const text = encodeURIComponent(generateMessage());
    const phone = (transaction.customerPhone || "").replace(/\D/g, "");
    const url = phone ? `https://wa.me/${phone}?text=${text}` : `https://wa.me/?text=${text}`;
    window.open(url, "_blank");
  };

  const shareSMS = () => {
    const text = encodeURIComponent(generateMessage());
    const phone = (transaction.customerPhone || "").replace(/\D/g, "");
    window.open(`sms:${phone}?body=${text}`, "_blank");
  };

  const copyText = () => {
    navigator.clipboard.writeText(generateMessage());
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <VortexDrawerDialog
      open={open}
      onOpenChange={onOpenChange}
      size="md"
      title={
        <div className="flex items-center gap-2">
          <span>تفاصيل السند المالي</span>
          <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-bold text-primary border border-primary/20">
            #{toSystemDigits(transaction.referenceNumber || transaction.id.slice(-6))}
          </span>
        </div>
      }
      subtitle={transaction.title}
      icon={
        <div className="grid size-10 place-items-center rounded-2xl bg-foreground text-background shadow-md">
          {isPayment ? <CheckCircle2 className="size-5 text-emerald-500" /> : <Receipt className="size-5" />}
        </div>
      }
    >
      <div className="space-y-4 py-2">
        <div className="rounded-3xl border border-border/80 bg-gradient-to-br from-card via-card to-muted/40 p-5 text-center space-y-1.5 shadow-sm">
          <span className="text-xs font-bold text-muted-foreground">قيمة العملية</span>
          <div className="text-3xl sm:text-4xl font-black text-foreground font-mono tracking-tight">
            {formatSystemNumber(transaction.amount)}{" "}
            <span className="text-sm font-bold text-muted-foreground">ر.س</span>
          </div>
          <div className="pt-2">
            <VortexDateBadge date={transaction.date} showWeekday size="sm" />
          </div>
        </div>

        <div className="rounded-2xl border border-border/70 bg-card p-4 space-y-3">
          <div className="flex items-center justify-between text-xs pb-2 border-b border-border/50">
            <span className="text-muted-foreground flex items-center gap-1.5 font-bold">
              <User className="size-3.5 text-primary" /> الطرف المعني:
            </span>
            <span className="font-bold text-foreground">{transaction.customerName}</span>
          </div>

          <div className="flex items-center justify-between text-xs pb-2 border-b border-border/50">
            <span className="text-muted-foreground flex items-center gap-1.5 font-bold">
              <CreditCard className="size-3.5 text-primary" /> طريقة السداد:
            </span>
            <span className="font-bold text-foreground">{transaction.method || "نقداً (كاش)"}</span>
          </div>

          {transaction.remainingBalance !== undefined && (
            <div className="flex items-center justify-between text-xs pb-2 border-b border-border/50">
              <span className="text-muted-foreground font-bold">الرصيد المتبقي:</span>
              <span className="font-mono font-bold text-rose-600 dark:text-rose-400">
                {formatSystemNumber(transaction.remainingBalance, { currency: "ر.س" })}
              </span>
            </div>
          )}

          {transaction.notes && (
            <div className="text-xs pt-1">
              <span className="text-muted-foreground font-bold block mb-1">ملاحظات:</span>
              <p className="rounded-xl bg-muted/60 p-2 text-foreground font-medium">{transaction.notes}</p>
            </div>
          )}
        </div>

        <div className="space-y-2 pt-1">
          <label className="text-xs font-bold text-foreground block">مشاركة السند والإشعار</label>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={shareWhatsApp}
              className="h-12 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs sm:text-sm flex items-center justify-center gap-2 shadow-md shadow-emerald-600/20 active:scale-98 transition cursor-pointer"
            >
              <MessageCircle className="size-4" />
              <span>واتساب للعميل</span>
            </button>

            <button
              type="button"
              onClick={shareSMS}
              className="h-12 rounded-2xl bg-sky-600 hover:bg-sky-700 text-white font-bold text-xs sm:text-sm flex items-center justify-center gap-2 shadow-md shadow-sky-600/20 active:scale-98 transition cursor-pointer"
            >
              <Send className="size-4" />
              <span>رسالة SMS</span>
            </button>
          </div>

          <button
            type="button"
            onClick={copyText}
            className="w-full h-11 rounded-2xl border border-border bg-card text-foreground font-bold text-xs flex items-center justify-center gap-2 hover:bg-muted transition cursor-pointer"
          >
            {copied ? <Check className="size-4 text-emerald-500" /> : <Copy className="size-4" />}
            <span>{copied ? "تم نسخ نص الإشعار" : "نسخ نص الإشعار كاملاً"}</span>
          </button>
        </div>
      </div>
    </VortexDrawerDialog>
  );
}

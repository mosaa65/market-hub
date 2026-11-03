"use client";

import * as React from "react";
import {
  Check,
  CheckCircle2,
  Printer,
  FileText,
  MessageCircle,
  Send,
  Copy,
  Receipt,
  User,
  CreditCard,
  Landmark,
  X,
} from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { VortexDateBadge } from "../display/vortex-date-badge";
import { WhatsAppIcon } from "@/components/whatsapp-icon";
import { formatSystemNumber, toSystemDigits } from "@/lib/format-preferences";
import { useCompanyCurrency } from "@/hooks/use-company-currency";
import { useI18n } from "@/lib/i18n";
import { money } from "@/lib/format";
import {
  useVoucherSettings,
  buildVoucherMessage,
} from "@/lib/settings/voucher-settings-store";

export interface UnifiedVoucherData {
  id?: string;
  operationId?: string;
  type?: "payment" | "invoice" | "purchase" | "debt" | "general";
  title: string;
  subtitle?: string;
  amount: number;
  currency?: string;
  referenceNumber?: string;
  date?: string;
  partyName?: string;
  partyPhone?: string | null;
  partyType?: "customer" | "supplier";
  paymentMethod?: string;
  cashboxName?: string | null;
  bankAccountName?: string | null;
  remainingBalance?: number | null;
  notes?: string | null;
  companyName?: string | null;
}

export interface VortexUnifiedOperationModalProps {
  open: boolean;
  onClose: () => void;
  data: UnifiedVoucherData | null;
  onPrint?: () => void;
  onViewDocument?: () => void;
}

export function VortexUnifiedOperationModal({
  open,
  onClose,
  data,
  onPrint,
  onViewDocument,
}: VortexUnifiedOperationModalProps) {
  const { lang } = useI18n();
  const isAr = lang === "ar";
  const { currencySymbol } = useCompanyCurrency();
  const { settings, playChime } = useVoucherSettings();

  const [copied, setCopied] = React.useState(false);
  const soundTriggeredRef = React.useRef<string | null>(null);
  const autoPrintedRef = React.useRef<string | null>(null);

  // Play chime once per unique operation
  React.useEffect(() => {
    if (!open || !data || !settings.soundEnabled) return;
    const opKey = data.operationId || data.referenceNumber || data.id || `${data.title}-${data.amount}`;
    if (soundTriggeredRef.current !== opKey) {
      soundTriggeredRef.current = opKey;
      const timer = setTimeout(() => {
        playChime();
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [open, data, settings.soundEnabled, playChime]);

  // Reset states on modal close
  React.useEffect(() => {
    if (!open) {
      soundTriggeredRef.current = null;
      autoPrintedRef.current = null;
      setCopied(false);
    }
  }, [open]);

  // Auto-print if enabled in settings
  React.useEffect(() => {
    if (!open || !data || !settings.autoPrintOnSuccess || !onPrint) return;
    const opKey = data.operationId || data.referenceNumber || data.id || `${data.title}-${data.amount}`;
    if (autoPrintedRef.current !== opKey) {
      autoPrintedRef.current = opKey;
      const timer = setTimeout(() => {
        onPrint();
      }, 350);
      return () => clearTimeout(timer);
    }
  }, [open, data, settings.autoPrintOnSuccess, onPrint]);

  if (!data) return null;

  const currency = data.currency || currencySymbol;
  const rawDate = data.date || new Date().toISOString().split("T")[0];

  // Professional custody-delivery style message built behind the scenes
  const activeMessageText = buildVoucherMessage(
    {
      companyName: data.companyName,
      partyName: data.partyName || (isAr ? "العميل الكريم" : "Valued Customer"),
      partyType: data.partyType,
      operationType: data.type,
      operationTitle: data.title,
      amount: data.amount,
      currency,
      referenceNumber: data.referenceNumber,
      date: rawDate,
      paymentMethod: data.paymentMethod,
      treasury: data.cashboxName || data.bankAccountName,
      remainingBalance: data.remainingBalance,
      notes: data.notes,
    },
    settings.defaultTemplate,
    isAr,
  );

  const cleanPhone = (data.partyPhone || "").replace(/\D/g, "");
  const hasPhone = Boolean(cleanPhone && cleanPhone.length >= 6);

  const shareWhatsApp = () => {
    const text = encodeURIComponent(activeMessageText);
    const url = cleanPhone ? `https://wa.me/${cleanPhone}?text=${text}` : `https://wa.me/?text=${text}`;
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const shareSMS = () => {
    const text = encodeURIComponent(activeMessageText);
    window.open(`sms:${cleanPhone}?body=${text}`, "_blank");
  };

  const copyText = () => {
    void navigator.clipboard.writeText(activeMessageText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="md"
      dismissible={true}
      hideClose={false}
      className="overflow-hidden border-border/80 bg-background/95 backdrop-blur-2xl shadow-2xl p-0 max-w-lg"
    >
      <div className="relative max-h-[90vh] overflow-y-auto px-5 py-6 sm:px-6 space-y-4 text-start">
        {/* Top Celebration Badge & Title */}
        <div className="flex flex-col items-center justify-center text-center space-y-2 pt-1 pb-1">
          <div className="relative flex items-center justify-center">
            <div className="absolute -inset-2.5 rounded-full bg-emerald-500/20 blur-md animate-pulse" />
            <div className="relative flex size-16 items-center justify-center rounded-full bg-gradient-to-tr from-emerald-600 to-emerald-400 text-white shadow-lg shadow-emerald-500/30 transition-transform duration-300 scale-100 animate-in zoom-in-75">
              <Check className="size-9 stroke-[3] animate-in zoom-in-50 duration-200" />
            </div>
          </div>

          <div className="space-y-1">
            <div className="flex items-center justify-center gap-2">
              <h2 className="text-xl font-black tracking-tight text-foreground">{data.title}</h2>
              {data.referenceNumber && (
                <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-bold text-primary border border-primary/20 font-mono">
                  #{toSystemDigits(data.referenceNumber)}
                </span>
              )}
            </div>
            {data.subtitle && (
              <p className="text-xs text-muted-foreground max-w-xs mx-auto leading-relaxed">
                {data.subtitle}
              </p>
            )}
          </div>
        </div>

        {/* Big Amount & Date Card */}
        <div className="rounded-3xl border border-border/80 bg-gradient-to-br from-card via-card to-muted/40 p-5 text-center space-y-1.5 shadow-xs">
          <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
            {isAr ? "قيمة العملية" : "Transaction Amount"}
          </span>
          <div className="text-3xl sm:text-4xl font-black text-foreground font-mono tracking-tight">
            {formatSystemNumber(data.amount)}{" "}
            <span className="text-sm font-bold text-muted-foreground">{currency}</span>
          </div>
          <div className="pt-2 flex items-center justify-center gap-2">
            <VortexDateBadge date={rawDate} showWeekday size="sm" />
          </div>
        </div>

        {/* Detailed Breakdown Card (Same exact elegant structure as Collection Form) */}
        <div className="rounded-2xl border border-border/70 bg-card p-4 space-y-3 shadow-xs">
          {data.partyName && (
            <div className="flex items-center justify-between text-xs pb-2 border-b border-border/50">
              <span className="text-muted-foreground flex items-center gap-1.5 font-bold">
                <User className="size-3.5 text-primary" />
                <span>
                  {data.partyType === "supplier"
                    ? isAr
                      ? "المورد:"
                      : "Supplier:"
                    : isAr
                      ? "الطرف المعني:"
                      : "Customer:"}
                </span>
              </span>
              <span className="font-bold text-foreground">{data.partyName}</span>
            </div>
          )}

          {data.paymentMethod && (
            <div className="flex items-center justify-between text-xs pb-2 border-b border-border/50">
              <span className="text-muted-foreground flex items-center gap-1.5 font-bold">
                <CreditCard className="size-3.5 text-primary" />
                <span>{isAr ? "طريقة السداد:" : "Payment Method:"}</span>
              </span>
              <span className="font-bold text-foreground">{data.paymentMethod}</span>
            </div>
          )}

          {settings.showTreasuryAccount && (data.cashboxName || data.bankAccountName) && (
            <div className="flex items-center justify-between text-xs pb-2 border-b border-border/50">
              <span className="text-muted-foreground flex items-center gap-1.5 font-bold">
                <Landmark className="size-3.5 text-primary" />
                <span>{isAr ? "الحساب المالي / الخزينة:" : "Treasury / Account:"}</span>
              </span>
              <span className="font-bold text-foreground">
                {data.cashboxName || data.bankAccountName}
              </span>
            </div>
          )}

          {settings.showRemainingBalance &&
            data.remainingBalance !== undefined &&
            data.remainingBalance !== null && (
              <div className="flex items-center justify-between text-xs pb-2 border-b border-border/50">
                <span className="text-muted-foreground font-bold">
                  {isAr ? "الرصيد المتبقي:" : "Remaining Balance:"}
                </span>
                <span className="font-mono font-bold text-rose-600 dark:text-rose-400">
                  {formatSystemNumber(data.remainingBalance, { currency })}
                </span>
              </div>
            )}

          {data.notes && (
            <div className="text-xs pt-1">
              <span className="text-muted-foreground font-bold block mb-1">
                {isAr ? "ملاحظات:" : "Notes:"}
              </span>
              <p className="rounded-xl bg-muted/60 p-2 text-foreground font-medium text-start">
                {data.notes}
              </p>
            </div>
          )}
        </div>

        {/* Communication & Sharing Actions (Direct WhatsApp, SMS, Copy - No textarea clutter) */}
        <div className="space-y-2 pt-1">
          <label className="text-xs font-bold text-foreground block">
            {isAr ? "مشاركة السند والإشعار" : "Share Voucher & Notice"}
          </label>
          <div className="grid grid-cols-2 gap-2">
            {settings.showWhatsAppButton && (
              <button
                type="button"
                onClick={shareWhatsApp}
                className="h-12 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs sm:text-sm flex items-center justify-center gap-2 shadow-md shadow-emerald-600/20 active:scale-98 transition cursor-pointer"
              >
                <WhatsAppIcon className="size-4 shrink-0" />
                <span>
                  {data.partyType === "supplier"
                    ? isAr
                      ? "واتساب للمورد"
                      : "WhatsApp Supplier"
                    : isAr
                      ? "واتساب للعميل"
                      : "WhatsApp Customer"}
                </span>
              </button>
            )}

            {settings.showSmsButton && (
              <button
                type="button"
                onClick={shareSMS}
                disabled={!hasPhone}
                className={`h-12 rounded-2xl font-bold text-xs sm:text-sm flex items-center justify-center gap-2 transition cursor-pointer ${
                  hasPhone
                    ? "bg-sky-600 hover:bg-sky-700 text-white shadow-md shadow-sky-600/20 active:scale-98"
                    : "bg-muted text-muted-foreground border border-border/80 cursor-not-allowed opacity-60"
                }`}
              >
                <Send className="size-4" />
                <span>{isAr ? "رسالة SMS" : "SMS"}</span>
              </button>
            )}
          </div>

          {settings.showCopyButton && (
            <button
              type="button"
              onClick={copyText}
              className="w-full h-11 rounded-2xl border border-border bg-card text-foreground font-bold text-xs flex items-center justify-center gap-2 hover:bg-muted transition cursor-pointer"
            >
              {copied ? <Check className="size-4 text-emerald-500" /> : <Copy className="size-4" />}
              <span>
                {copied
                  ? isAr
                    ? "تم نسخ نص الإشعار بنجاح!"
                    : "Copied to clipboard!"
                  : isAr
                    ? "نسخ نص الإشعار كاملاً"
                    : "Copy Full Notice Text"}
              </span>
            </button>
          )}

          {/* Document Operations: Print, View & Close */}
          <div className="flex items-center gap-2 pt-1">
            {onPrint && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onPrint}
                className="flex-1 rounded-xl text-xs font-semibold gap-1.5 h-10 border-border/90"
              >
                <Printer className="size-3.5" />
                <span>{isAr ? "طباعة" : "Print"}</span>
              </Button>
            )}

            {onViewDocument && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onViewDocument}
                className="flex-1 rounded-xl text-xs font-semibold gap-1.5 h-10 border-border/90"
              >
                <FileText className="size-3.5" />
                <span>{isAr ? "المستند" : "Document"}</span>
              </Button>
            )}

            <Button
              type="button"
              variant="default"
              size="sm"
              onClick={onClose}
              className="flex-1 rounded-xl text-xs font-bold h-10 bg-foreground text-background hover:opacity-90"
            >
              {isAr ? "إتمام وإغلاق" : "Done / Close"}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

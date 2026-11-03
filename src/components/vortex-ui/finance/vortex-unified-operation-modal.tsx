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
  Sparkles,
  Edit3,
  Phone,
  AlertCircle,
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
  type VoucherTemplateId,
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
  const [isEditingMessage, setIsEditingMessage] = React.useState(false);
  const [customMessage, setCustomMessage] = React.useState("");
  const [selectedTemplate, setSelectedTemplate] = React.useState<VoucherTemplateId>(
    settings.defaultTemplate,
  );

  const soundTriggeredRef = React.useRef<string | null>(null);
  const autoPrintedRef = React.useRef<string | null>(null);

  // Synchronize default template with settings
  React.useEffect(() => {
    setSelectedTemplate(settings.defaultTemplate);
  }, [settings.defaultTemplate]);

  // Reset custom message when data changes
  React.useEffect(() => {
    if (data) {
      setCustomMessage("");
      setIsEditingMessage(false);
    }
  }, [data]);

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

  // Reset sound state on close
  React.useEffect(() => {
    if (!open) {
      soundTriggeredRef.current = null;
      autoPrintedRef.current = null;
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

  const generatedMessage = buildVoucherMessage(
    {
      partyName: data.partyName || (isAr ? "العميل الكريم" : "Valued Customer"),
      partyType: data.partyType,
      operationTitle: data.title,
      amount: data.amount,
      currency,
      referenceNumber: data.referenceNumber,
      date: rawDate,
      treasury: data.cashboxName || data.bankAccountName,
      remainingBalance: data.remainingBalance,
      notes: data.notes,
    },
    selectedTemplate,
    isAr,
  );

  const activeMessageText = customMessage || generatedMessage;

  const handleTemplateChange = (tpl: VoucherTemplateId) => {
    setSelectedTemplate(tpl);
    setCustomMessage("");
  };

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
        {/* Top Celebration Badge & Header */}
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
            {isAr ? "قيمة العملية والمبلغ المسجل" : "Transaction Amount"}
          </span>
          <div className="text-3xl sm:text-4xl font-black text-foreground font-mono tracking-tight">
            {formatSystemNumber(data.amount)}{" "}
            <span className="text-sm font-bold text-muted-foreground">{currency}</span>
          </div>
          <div className="pt-2 flex items-center justify-center gap-2">
            <VortexDateBadge date={rawDate} showWeekday size="sm" />
          </div>
        </div>

        {/* Detailed Breakdown Card */}
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
                      ? "الطرف المعني / العميل:"
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
                <span>{isAr ? "طريقة الدفع / السداد:" : "Payment Method:"}</span>
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

        {/* Message Review & Template Selector */}
        <div className="rounded-2xl border border-border/80 bg-card p-4 space-y-3 shadow-xs">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-xs font-bold text-foreground">
              <Sparkles className="size-4 text-primary" />
              <span>{isAr ? "نص إشعار وسند العملية" : "Voucher Notice Text"}</span>
            </div>
            <button
              type="button"
              onClick={() => setIsEditingMessage(!isEditingMessage)}
              className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary hover:underline cursor-pointer"
            >
              <Edit3 className="size-3" />
              <span>
                {isEditingMessage
                  ? isAr
                    ? "معاينة الرسالة"
                    : "Preview"
                  : isAr
                    ? "تعديل النص"
                    : "Edit Text"}
              </span>
            </button>
          </div>

          {/* Template Chips */}
          <div className="flex flex-wrap gap-1.5">
            {[
              { id: "official" as const, label: isAr ? "سند رسمي متكامل" : "Official Voucher" },
              { id: "reminder" as const, label: isAr ? "إشعار وتذكير بالمتبقي" : "Reminder" },
              { id: "short" as const, label: isAr ? "شكر موجز" : "Short Thank You" },
            ].map((tpl) => (
              <button
                key={tpl.id}
                type="button"
                onClick={() => handleTemplateChange(tpl.id)}
                className={`rounded-xl px-2.5 py-1 text-[11px] font-bold transition cursor-pointer ${
                  selectedTemplate === tpl.id
                    ? "bg-primary text-primary-foreground shadow-xs"
                    : "bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground"
                }`}
              >
                {tpl.label}
              </button>
            ))}
          </div>

          {/* Message Content / Textarea */}
          {isEditingMessage ? (
            <textarea
              value={customMessage || generatedMessage}
              onChange={(e) => setCustomMessage(e.target.value)}
              rows={4}
              className="w-full rounded-xl border border-border bg-background p-3 text-xs leading-relaxed text-foreground font-sans focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
              placeholder={isAr ? "اكتب أو عدل نص الرسالة هنا..." : "Edit message here..."}
              dir={isAr ? "rtl" : "ltr"}
            />
          ) : (
            <div className="relative rounded-xl border border-border/70 bg-muted/30 p-3 text-xs leading-relaxed text-foreground whitespace-pre-wrap font-sans select-all text-start">
              {activeMessageText}
            </div>
          )}

          {data.partyPhone ? (
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
              <Phone className="size-3 text-emerald-500" />
              <span>{isAr ? "رقم الهاتف المسجل:" : "Registered Phone:"}</span>
              <span className="font-mono font-bold text-foreground" dir="ltr">
                {data.partyPhone}
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 text-[11px] text-amber-500 font-semibold">
              <AlertCircle className="size-3.5 shrink-0" />
              <span>
                {isAr
                  ? "لا يوجد رقم هاتف مسجل للطرف المعني (يمكن فتح واتساب لاختيار جهة الاتصال يدويًا)."
                  : "No phone registered. Opening WhatsApp will let you choose a recipient."}
              </span>
            </div>
          )}
        </div>

        {/* Communication & Sharing Actions */}
        <div className="space-y-2 pt-1">
          <div className="grid grid-cols-2 gap-2">
            {settings.showWhatsAppButton && (
              <button
                type="button"
                onClick={shareWhatsApp}
                className="h-11 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-md shadow-emerald-600/20 active:scale-98 transition cursor-pointer"
              >
                <WhatsAppIcon className="size-4 shrink-0" />
                <span>{isAr ? "واتساب مباشر" : "WhatsApp"}</span>
              </button>
            )}

            {settings.showSmsButton && (
              <button
                type="button"
                onClick={shareSMS}
                disabled={!hasPhone}
                className={`h-11 rounded-xl font-bold text-xs flex items-center justify-center gap-2 transition cursor-pointer ${
                  hasPhone
                    ? "bg-sky-600 hover:bg-sky-700 text-white shadow-md shadow-sky-600/20 active:scale-98"
                    : "bg-muted text-muted-foreground border border-border/80 cursor-not-allowed opacity-60"
                }`}
              >
                <Send className="size-3.5" />
                <span>{isAr ? "رسالة SMS" : "SMS"}</span>
              </button>
            )}
          </div>

          {settings.showCopyButton && (
            <button
              type="button"
              onClick={copyText}
              className="w-full h-10 rounded-xl border border-border bg-card text-foreground font-bold text-xs flex items-center justify-center gap-2 hover:bg-muted transition cursor-pointer"
            >
              {copied ? <Check className="size-4 text-emerald-500" /> : <Copy className="size-3.5" />}
              <span>
                {copied
                  ? isAr
                    ? "تم نسخ نص الإشعار بنجاح!"
                    : "Copied to clipboard!"
                  : isAr
                    ? "نسخ نص الإشعار كاملاً للحافظة"
                    : "Copy Notice Text"}
              </span>
            </button>
          )}

          {/* Document Operations: Print & View */}
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
                <span>{isAr ? "طباعة السند / الفاتورة" : "Print Voucher"}</span>
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
                <span>{isAr ? "معاينة المستند" : "View Document"}</span>
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

import * as React from "react";
import { Check, Printer, FileText, X, AlertCircle } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { WhatsAppIcon } from "@/components/whatsapp-icon";
import { playSuccessChime } from "@/lib/communication/audio";
import {
  buildUnifiedContext,
  renderMessage,
  type CommunicationEventType,
  type CustomerContext,
  type InvoiceContext,
  type PaymentContext,
} from "@/lib/communication";
import { useI18n } from "@/lib/i18n";
import { money } from "@/lib/format";

export interface OperationSuccessModalProps {
  open: boolean;
  onClose: () => void;
  operationId?: string; // unique ID to guarantee sound triggers only once per operation
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
}

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
  eventType,
  onPrint,
  onViewDocument,
  soundEnabled = true,
}: OperationSuccessModalProps) {
  const { lang } = useI18n();
  const isAr = lang === "ar";
  const soundPlayedRef = React.useRef<string | null>(null);

  // Play chime once per operation
  React.useEffect(() => {
    if (!open || !soundEnabled) return;
    const currentOp = operationId || `${title}-${Date.now()}`;
    if (soundPlayedRef.current !== currentOp) {
      soundPlayedRef.current = currentOp;
      // Slight 40ms delay for visual synchronization with the check animation
      const timer = setTimeout(() => {
        playSuccessChime({ volume: 0.25 });
      }, 40);
      return () => clearTimeout(timer);
    }
  }, [open, operationId, soundEnabled, title]);

  // Reset sound state when modal closes
  React.useEffect(() => {
    if (!open) {
      soundPlayedRef.current = null;
    }
  }, [open]);

  // Determine appropriate communication event
  const resolvedEvent: CommunicationEventType =
    eventType ||
    (payment ? "payment_received" : invoice ? "invoice_created" : "general_customer_notice");

  // Render WhatsApp message via the unified Communication Engine
  const renderedMessage = React.useMemo(() => {
    if (!open) return null;
    const ctx = buildUnifiedContext({
      event: resolvedEvent,
      customer,
      invoice,
      payment,
      language: lang === "ar" ? "ar" : "en",
    });
    return renderMessage(ctx);
  }, [open, resolvedEvent, customer, invoice, payment, lang]);

  const handleWhatsAppClick = () => {
    if (!renderedMessage?.canSendWhatsApp || !renderedMessage.whatsAppUrl) return;
    window.open(renderedMessage.whatsAppUrl, "_blank", "noopener,noreferrer");
  };

  const hasPhone = Boolean(customer?.phone && customer.phone.trim().length > 0);
  const canSendWhatsApp = Boolean(renderedMessage?.canSendWhatsApp);

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      dismissible={true}
      hideClose={false}
      className="overflow-hidden border-border/80 bg-background/95 backdrop-blur-xl shadow-2xl"
    >
      <div className="flex flex-col items-center justify-center p-6 text-center space-y-4">
        {/* Animated Native-Style Checkmark */}
        <div className="relative flex items-center justify-center">
          <div className="absolute -inset-2 rounded-full bg-emerald-500/20 blur-md animate-pulse" />
          <div className="relative flex size-18 items-center justify-center rounded-full bg-gradient-to-tr from-emerald-600 to-emerald-400 text-white shadow-lg shadow-emerald-500/30 transition-transform duration-300 scale-100 animate-in zoom-in-75">
            <Check className="size-10 stroke-[3] animate-in zoom-in-50 duration-200" />
          </div>
        </div>

        {/* Title and Subtitle */}
        <div className="space-y-1">
          <h2 className="text-xl font-extrabold tracking-tight text-foreground">{title}</h2>
          {subtitle && (
            <p className="text-xs text-muted-foreground max-w-[280px] mx-auto leading-relaxed">
              {subtitle}
            </p>
          )}
        </div>

        {/* Key Details Card */}
        {(amount !== undefined || referenceNumber || customer) && (
          <div className="w-full rounded-2xl border border-border/60 bg-muted/30 p-3.5 space-y-2 text-xs">
            {amount !== undefined && (
              <div className="flex items-center justify-between font-medium">
                <span className="text-muted-foreground">{isAr ? "المبلغ:" : "Amount:"}</span>
                <span className="font-mono text-base font-bold text-foreground">
                  {money(amount)} {currency || ""}
                </span>
              </div>
            )}
            {referenceNumber && (
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">
                  {isAr ? "رقم المرجع:" : "Reference #:"}
                </span>
                <span className="font-mono font-semibold text-foreground">#{referenceNumber}</span>
              </div>
            )}
            {customer?.name && (
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">{isAr ? "العميل:" : "Customer:"}</span>
                <span className="font-medium text-foreground">{customer.name}</span>
              </div>
            )}
          </div>
        )}

        {/* Phone Number Warning if missing */}
        {!hasPhone && customer && (
          <div className="flex items-center gap-2 rounded-xl bg-amber-500/10 border border-amber-500/20 px-3 py-2 text-start text-[11px] text-amber-500 dark:text-amber-400 w-full">
            <AlertCircle className="size-4 shrink-0" />
            <span>
              {isAr
                ? "هذا العميل لا يوجد لديه رقم هاتف مسجل في النظام."
                : "This customer has no phone number registered in the system."}
            </span>
          </div>
        )}

        {/* Actions Section */}
        <div className="w-full space-y-2 pt-2">
          {/* Primary Recommended WhatsApp Action */}
          {customer && (
            <button
              type="button"
              disabled={!canSendWhatsApp}
              onClick={handleWhatsAppClick}
              title={
                !canSendWhatsApp
                  ? isAr
                    ? "لا يمكن الإرسال لعدم وجود رقم هاتف صالح"
                    : "Cannot send: No valid phone number"
                  : isAr
                    ? "إرسال عبر واتساب"
                    : "Send via WhatsApp"
              }
              className={`flex w-full items-center justify-center gap-2 rounded-xl py-3 text-xs font-bold transition shadow-sm active:scale-[0.98] ${
                canSendWhatsApp
                  ? "bg-emerald-600 hover:bg-emerald-700 text-white shadow-emerald-500/20"
                  : "bg-muted text-muted-foreground border border-border/80 cursor-not-allowed opacity-60"
              }`}
            >
              <WhatsAppIcon className="size-4 shrink-0" />
              <span>
                {resolvedEvent === "payment_received"
                  ? isAr
                    ? "إرسال إيصال السداد للعميل عبر واتساب"
                    : "Send Payment Receipt via WhatsApp"
                  : resolvedEvent === "invoice_created"
                    ? isAr
                      ? "إرسال الفاتورة للعميل عبر واتساب"
                      : "Send Invoice via WhatsApp"
                    : isAr
                      ? "مراسلة العميل عبر واتساب"
                      : "Message Customer via WhatsApp"}
              </span>
            </button>
          )}

          {/* Secondary Actions (Print / Document / Close) */}
          <div className="flex items-center gap-2 pt-1">
            {onPrint && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onPrint}
                className="flex-1 rounded-xl text-xs font-semibold gap-1.5 h-9"
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
                className="flex-1 rounded-xl text-xs font-semibold gap-1.5 h-9"
              >
                <FileText className="size-3.5" />
                <span>{isAr ? "المستند" : "Document"}</span>
              </Button>
            )}

            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onClose}
              className="flex-1 rounded-xl text-xs font-bold h-9 text-muted-foreground hover:text-foreground"
            >
              {isAr ? "إغلاق" : "Close"}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

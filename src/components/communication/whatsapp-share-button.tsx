import * as React from "react";
import { WhatsAppIcon } from "@/components/whatsapp-icon";
import { AlertCircle } from "lucide-react";
import {
  isValidWhatsAppPhone,
  buildUnifiedContext,
  renderMessage,
  type CommunicationEventType,
  type CustomerContext,
  type InvoiceContext,
  type PaymentContext,
} from "@/lib/communication";
import { useI18n } from "@/lib/i18n";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

export interface WhatsAppShareButtonProps {
  customer?: CustomerContext | null;
  invoice?: InvoiceContext | null;
  payment?: PaymentContext | null;
  eventType: CommunicationEventType;
  label?: string;
  className?: string;
  showWarningText?: boolean;
  size?: "sm" | "md" | "lg";
}

export function WhatsAppShareButton({
  customer,
  invoice,
  payment,
  eventType,
  label,
  className = "",
  showWarningText = false,
  size = "md",
}: WhatsAppShareButtonProps) {
  const { lang } = useI18n();
  const isAr = lang === "ar";

  const hasPhone = Boolean(customer?.phone && customer.phone.trim().length > 0);
  const isValidPhone = isValidWhatsAppPhone(customer?.phone);
  const canSend = hasPhone && isValidPhone;

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!canSend) return;

    const ctx = buildUnifiedContext({
      event: eventType,
      customer,
      invoice,
      payment,
      language: isAr ? "ar" : "en",
    });

    const rendered = renderMessage(ctx);
    if (rendered.canSendWhatsApp && rendered.whatsAppUrl) {
      window.open(rendered.whatsAppUrl, "_blank", "noopener,noreferrer");
    }
  };

  const warningMsg = !hasPhone
    ? isAr
      ? "هذا العميل لا يوجد لديه رقم هاتف مسجل في النظام"
      : "This customer has no phone number registered in the system"
    : !isValidPhone
      ? isAr
        ? "رقم الهاتف المسجل غير صالح للإرسال"
        : "The registered phone number is invalid for WhatsApp"
      : "";

  const sizeClass =
    size === "sm"
      ? "h-7 text-[11px] px-2.5"
      : size === "lg"
        ? "h-10 text-sm px-4"
        : "h-8 text-xs px-3";

  const buttonElement = (
    <button
      type="button"
      disabled={!canSend}
      onClick={handleClick}
      aria-label={label || (isAr ? "مشاركة عبر واتساب" : "Share via WhatsApp")}
      className={
        className ||
        `inline-flex items-center justify-center gap-1.5 rounded-full font-bold transition active:scale-95 ${sizeClass} ${
          canSend
            ? "border border-emerald-500/30 bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20 shadow-xs"
            : "border border-border/80 bg-muted/50 text-muted-foreground/50 cursor-not-allowed opacity-60"
        }`
      }
    >
      <WhatsAppIcon className="size-3.5 shrink-0" />
      {label && <span>{label}</span>}
    </button>
  );

  return (
    <div className="inline-flex flex-col gap-1 items-start">
      {showWarningText && !canSend && (
        <div className="flex items-center gap-1.5 text-[11px] text-amber-500 dark:text-amber-400 font-medium">
          <AlertCircle className="size-3 shrink-0" />
          <span>{warningMsg}</span>
        </div>
      )}

      {!canSend ? (
        <TooltipProvider delayDuration={150}>
          <Tooltip>
            <TooltipTrigger asChild>{buttonElement}</TooltipTrigger>
            <TooltipContent
              side="top"
              className="text-xs text-rose-500 dark:text-rose-400 bg-popover border-border"
            >
              <p>{warningMsg}</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ) : (
        buttonElement
      )}
    </div>
  );
}

import * as React from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { WhatsAppIcon } from "@/components/whatsapp-icon";
import {
  FileText,
  FileSpreadsheet,
  Printer,
  BadgeAlert,
  Send,
  Receipt,
  MessageSquare,
  AlertCircle,
} from "lucide-react";
import {
  getAvailableCustomerActions,
  renderMessage,
  buildUnifiedContext,
  openWhatsAppDirect,
  type ActionDescriptor,
  type CustomerContext,
  type InvoiceContext,
} from "@/lib/communication";
import { useI18n } from "@/lib/i18n";
import { money } from "@/lib/format";

export interface CustomerCommunicationMenuProps {
  customer: CustomerContext;
  currentInvoice?: InvoiceContext | null;
  onSelectStatementPdf?: () => void;
  onSelectStatementExcel?: () => void;
  trigger?: React.ReactNode;
  align?: "start" | "end" | "center";
}

export function CustomerCommunicationMenu({
  customer,
  currentInvoice,
  onSelectStatementPdf,
  onSelectStatementExcel,
  trigger,
  align = "end",
}: CustomerCommunicationMenuProps) {
  const { lang } = useI18n();
  const isAr = lang === "ar";

  const actions = React.useMemo(() => {
    return getAvailableCustomerActions({
      customer,
      currentInvoice,
    });
  }, [customer, currentInvoice]);

  const hasPhone = Boolean(customer.phone && customer.phone.trim().length > 0);
  const hasDebt = (customer.balance ?? 0) > 0;

  const handleActionClick = (action: ActionDescriptor) => {
    if (!action.enabled) return;

    if (action.key === "statement_export_pdf") {
      onSelectStatementPdf?.();
      return;
    }

    if (action.key === "statement_export_excel") {
      onSelectStatementExcel?.();
      return;
    }

    let eventType:
      | "payment_request"
      | "debt_reminder"
      | "statement_share"
      | "invoice_share"
      | "general_customer_notice" = "general_customer_notice";
    if (action.key === "payment_request") eventType = "payment_request";
    else if (action.key === "debt_reminder") eventType = "debt_reminder";
    else if (action.key === "statement_share") eventType = "statement_share";
    else if (action.key === "invoice_share") eventType = "invoice_share";

    const ctx = buildUnifiedContext({
      event: eventType,
      customer,
      invoice: currentInvoice,
      language: isAr ? "ar" : "en",
    });

    const rendered = renderMessage(ctx);
    if (rendered.canSendWhatsApp && rendered.whatsAppUrl) {
      window.open(rendered.whatsAppUrl, "_blank", "noopener,noreferrer");
    }
  };

  const getActionIcon = (key: ActionDescriptor["key"]) => {
    switch (key) {
      case "payment_request":
        return <BadgeAlert className="size-4 text-amber-500 shrink-0" />;
      case "debt_reminder":
        return <Receipt className="size-4 text-rose-500 shrink-0" />;
      case "statement_share":
        return <WhatsAppIcon className="size-4 text-emerald-500 shrink-0" />;
      case "statement_export_pdf":
        return <Printer className="size-4 text-sky-500 shrink-0" />;
      case "statement_export_excel":
        return <FileSpreadsheet className="size-4 text-emerald-600 shrink-0" />;
      case "invoice_share":
        return <FileText className="size-4 text-indigo-500 shrink-0" />;
      default:
        return <MessageSquare className="size-4 text-muted-foreground shrink-0" />;
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {trigger || (
          <button
            type="button"
            className="flex items-center gap-1.5 rounded-full bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border border-emerald-500/25 px-2.5 py-1 text-xs font-bold transition active:scale-95"
            title={isAr ? "إجراءات التواصل والمراسلة" : "Communication actions"}
          >
            <WhatsAppIcon className="size-3.5" />
            <span>{isAr ? "مراسلة" : "Message"}</span>
          </button>
        )}
      </DropdownMenuTrigger>

      <DropdownMenuContent align={align} className="w-64 p-1.5 space-y-1">
        <DropdownMenuLabel className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">
          <div className="flex items-center justify-between">
            <span>{customer.name}</span>
            {hasDebt && (
              <span className="font-mono text-[11px] font-bold text-rose-500">
                {money(customer.balance)}
              </span>
            )}
          </div>
          {!hasPhone && (
            <div className="mt-1 flex items-center gap-1 text-[10px] text-amber-500 dark:text-amber-400">
              <AlertCircle className="size-3" />
              <span>{isAr ? "لا يوجد رقم هاتف مسجل" : "No phone number registered"}</span>
            </div>
          )}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />

        {actions.map((action) => (
          <DropdownMenuItem
            key={action.key}
            disabled={!action.enabled}
            onClick={() => handleActionClick(action)}
            className={`flex items-start gap-2.5 p-2 rounded-lg cursor-pointer transition ${
              !action.enabled ? "opacity-50 cursor-not-allowed" : "hover:bg-muted/70"
            }`}
          >
            {getActionIcon(action.key)}
            <div className="flex-1 space-y-0.5">
              <div className="text-xs font-semibold text-foreground flex items-center justify-between">
                <span>{isAr ? action.labelAr : action.labelEn}</span>
                {action.isPrimary && (
                  <span className="text-[9px] bg-primary/15 text-primary px-1.5 py-0.5 rounded font-bold">
                    {isAr ? "أساسي" : "Primary"}
                  </span>
                )}
              </div>
              <p className="text-[10px] text-muted-foreground leading-tight">
                {!action.enabled
                  ? (isAr ? action.disabledReasonAr : action.disabledReasonEn) ||
                    (isAr ? action.descriptionAr : action.descriptionEn)
                  : isAr
                    ? action.descriptionAr
                    : action.descriptionEn}
              </p>
            </div>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

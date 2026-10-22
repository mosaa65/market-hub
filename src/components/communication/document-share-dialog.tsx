import * as React from "react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { WhatsAppIcon } from "@/components/whatsapp-icon";
import {
  FileText,
  FileSpreadsheet,
  Printer,
  Share2,
  Download,
  AlertCircle,
  CheckCircle2,
} from "lucide-react";
import {
  shareDocumentWithCustomer,
  canShareFiles,
  buildUnifiedContext,
  renderMessage,
  type CustomerContext,
  type InvoiceContext,
  type StatementContext,
} from "@/lib/communication";
import { useI18n } from "@/lib/i18n";
import { toast } from "sonner";

export interface DocumentShareDialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  documentType: "invoice" | "statement" | "milling_document";
  customer?: CustomerContext | null;
  invoice?: InvoiceContext | null;
  statement?: StatementContext | null;
  millingDocumentNumber?: string | null;
  millingStatus?: string | null;
  onPrintPdf?: () => void;
  onExportExcel?: () => void;
  documentBlob?: Blob;
  filename?: string;
}

export function DocumentShareDialog({
  open,
  onClose,
  title,
  documentType,
  customer,
  invoice,
  statement,
  millingDocumentNumber,
  millingStatus,
  onPrintPdf,
  onExportExcel,
  documentBlob,
  filename,
}: DocumentShareDialogProps) {
  const { lang } = useI18n();
  const isAr = lang === "ar";
  const [isSharing, setIsSharing] = React.useState(false);

  const eventType =
    documentType === "milling_document"
      ? "milling_document_share"
      : documentType === "invoice"
        ? "invoice_share"
        : "statement_share";

  const messageContext = React.useMemo(() => {
    return buildUnifiedContext({
      event: eventType,
      customer,
      invoice,
      statement,
      millingDocumentNumber,
      millingStatus,
      language: isAr ? "ar" : "en",
    });
  }, [eventType, customer, invoice, statement, millingDocumentNumber, millingStatus, isAr]);

  const rendered = React.useMemo(() => {
    return renderMessage(messageContext);
  }, [messageContext]);

  const handleShareWhatsApp = async () => {
    try {
      setIsSharing(true);
      const res = await shareDocumentWithCustomer({
        title,
        text: rendered.text,
        recipientPhone: customer?.phone,
        file: documentBlob,
        filename: filename || `${documentType}.pdf`,
      });

      if (res.status === "opened" || res.status === "shared") {
        toast.success(res.message || (isAr ? "تم تجهيز المشاركة" : "Share dispatched"));
      } else if (res.status === "ready") {
        toast.info(res.message || (isAr ? "تم تنزيل المستند" : "Document downloaded"));
      }
    } catch {
      toast.error(isAr ? "تعذرت المشاركة" : "Failed to share document");
    } finally {
      setIsSharing(false);
    }
  };

  const hasPhone = Boolean(customer?.phone && customer.phone.trim().length > 0);
  const nativeSupported = canShareFiles();

  return (
    <Modal open={open} onClose={onClose} size="sm" title={title} className="p-1">
      <div className="p-5 space-y-4 text-xs">
        {/* Document Info Card */}
        <div className="rounded-2xl border border-border bg-muted/30 p-3.5 space-y-2">
          <div className="flex items-center justify-between font-semibold">
            <span className="text-muted-foreground">{isAr ? "الجهة / العميل:" : "Customer:"}</span>
            <span className="text-foreground">{customer?.name || "—"}</span>
          </div>
          {millingDocumentNumber && (
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">
                {isAr ? "مستند الطحن:" : "Milling Doc #:"}
              </span>
              <span className="font-mono font-bold text-foreground">#{millingDocumentNumber}</span>
            </div>
          )}
          {invoice?.invoiceNumber && (
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">{isAr ? "رقم الفاتورة:" : "Invoice #:"}</span>
              <span className="font-mono font-bold text-foreground">#{invoice.invoiceNumber}</span>
            </div>
          )}
          {statement?.periodLabel && (
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">{isAr ? "الفترة:" : "Period:"}</span>
              <span className="font-medium text-foreground">{statement.periodLabel}</span>
            </div>
          )}
        </div>

        {/* Warning if no phone */}
        {!hasPhone && (
          <div className="flex items-center gap-2 rounded-xl bg-amber-500/10 border border-amber-500/20 px-3 py-2 text-amber-500 dark:text-amber-400">
            <AlertCircle className="size-4 shrink-0" />
            <span>
              {isAr
                ? "هذا العميل لا يمتلك رقم هاتف، يمكنك تنزيل أو طباعة المستند."
                : "No phone registered for this customer. You can download or print."}
            </span>
          </div>
        )}

        {/* WhatsApp Sharing Button */}
        <button
          type="button"
          disabled={!hasPhone || isSharing}
          onClick={handleShareWhatsApp}
          className={`flex w-full items-center justify-center gap-2 rounded-xl py-3 font-bold transition shadow-sm ${
            hasPhone
              ? "bg-emerald-600 hover:bg-emerald-700 text-white shadow-emerald-500/20"
              : "bg-muted text-muted-foreground cursor-not-allowed opacity-60 border border-border"
          }`}
        >
          <WhatsAppIcon className="size-4 shrink-0" />
          <span>
            {nativeSupported
              ? isAr
                ? "مشاركة المستند المباشرة (Web Share / واتساب)"
                : "Share Document Directly (Web Share / WhatsApp)"
              : isAr
                ? "إرسال ملخص عبر واتساب"
                : "Send Summary via WhatsApp"}
          </span>
        </button>

        {/* Export & Print Options */}
        <div className="grid grid-cols-2 gap-2 pt-1">
          {onPrintPdf && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onPrintPdf}
              className="rounded-xl gap-1.5 h-10 font-semibold"
            >
              <Printer className="size-4 text-sky-500" />
              <span>{isAr ? "طباعة / PDF" : "Print / PDF"}</span>
            </Button>
          )}

          {onExportExcel && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onExportExcel}
              className="rounded-xl gap-1.5 h-10 font-semibold"
            >
              <FileSpreadsheet className="size-4 text-emerald-500" />
              <span>{isAr ? "تصدير إكسل (Excel)" : "Export Excel"}</span>
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}

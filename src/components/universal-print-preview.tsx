import { LuxuryPrintPreviewModal, type LuxuryPaperFormat } from "./luxury-print-preview-modal";
import type { PrintRequest } from "@/lib/printing";

export { LuxuryPrintPreviewModal };
export type { LuxuryPaperFormat };

interface UniversalPrintPreviewProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  request: PrintRequest;
  title?: string;
  rtl?: boolean;
  /** يُستدعى عند طلب «تحميل PDF»؛ إن لم يُمرَّر يُطبع المستند كبديل. */
  onDownloadPdf?: () => void;
  /** يُستدعى عند طلب «مشاركة»؛ إن لم يُمرَّر يُخفى الزر. */
  onShare?: () => void;
}

export function UniversalPrintPreview({
  open,
  onOpenChange,
  request,
  title,
  rtl,
}: UniversalPrintPreviewProps) {
  return (
    <LuxuryPrintPreviewModal
      open={open}
      onClose={() => onOpenChange(false)}
      request={request}
      doc={request.doc}
      documentType={request.documentType}
      title={title}
      rtl={rtl}
    />
  );
}

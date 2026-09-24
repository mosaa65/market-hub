import { useState, useMemo } from "react";
import {
  DocumentType,
  InvoiceTemplateId,
  UnifiedDocumentData,
  renderDocumentHTML,
  printDocument,
  getPrintSettings,
} from "@/lib/templates";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Printer, Eye, ScrollText, Sparkles, Layers, Check } from "lucide-react";

const SAMPLE_CUSTOMER_INVOICE: UnifiedDocumentData = {
  docType: "customer_invoice",
  title: "فاتورة مبيعات",
  number: "INV-2026-0042",
  date: new Date().toLocaleDateString("ar-YE"),
  partyLabel: "العميل",
  partyName: "شركة الأمل للتجارة والخدمات",
  partyPhone: "771234567",
  partyVat: "300123456700003",
  warehouse: "المستودع الرئيسي",
  payment: "نقداً (Cash)",
  status: "مدفوعة",
  lines: [
    { product: "مرفاع زيت هيدروليكي 3 طن", qty: 2, unit: "حبة", price: 150, total: 300, code: "HYD-3T" },
    { product: "طقم مفاتيح رينج 12 قطعة", qty: 5, unit: "طقم", price: 45, total: 225, code: "RNG-12" },
    { product: "زيت محرك سوبر 15W-40 4L", qty: 4, unit: "جالون", price: 28, total: 112, code: "OIL-15W40" },
  ],
  subtotal: 637,
  tax: 95.55,
  discount: 32.55,
  total: 700,
  paid: 700,
  balance: 0,
  currency: "USD",
  company: {
    name: "مؤسسة فورتكس للتجارة والمحركات",
    address: "صنعاء - شارع الستين - جوار الغرفة التجارية",
    phone: "01-234567 / 772217218",
    vat: "100987654",
  },
  brandingText: "Powered by Inama Soft - 772217218",
};

const SAMPLE_INVENTORY_DOC: UnifiedDocumentData = {
  docType: "inventory_document",
  title: "إذن صرف مبيعات مخزني",
  number: "STK-2026-0089",
  relatedRef: "INV-2026-0042",
  date: new Date().toLocaleDateString("ar-YE"),
  movementType: "صرف مبيعات (Sales Issue)",
  warehouse: "المستودع الرئيسي - قسم المعدات",
  operatorName: "أحمد يونس (أمناء المخازن)",
  notes: "تم تجهيز وتسليم الاصناف بحالة ممتازة وبحضور السائق.",
  lines: [
    { product: "مرفاع زيت هيدروليكي 3 طن", qty: 2, unit: "حبة", code: "HYD-3T", note: " رف A-14" },
    { product: "طقم مفاتيح رينج 12 قطعة", qty: 5, unit: "طقم", code: "RNG-12", note: "رف B-02" },
    { product: "زيت محرك سوبر 15W-40 4L", qty: 4, unit: "جالون", code: "OIL-15W40", note: "كرتون أصل" },
  ],
  company: {
    name: "مؤسسة فورتكس للتجارة والمحركات",
    address: "صنعاء - شارع الستين",
  },
  brandingText: "Powered by Inama Soft - 772217218",
};

interface PrintPreviewModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customDoc?: UnifiedDocumentData;
}

export function PrintPreviewModal({ open, onOpenChange, customDoc }: PrintPreviewModalProps) {
  const settings = getPrintSettings();
  const [docType, setDocType] = useState<DocumentType>(customDoc?.docType || "customer_invoice");
  const [templateId, setTemplateId] = useState<InvoiceTemplateId>(
    customDoc?.docType === "inventory_document"
      ? settings.defaultInventoryTemplate
      : settings.defaultCustomerTemplate,
  );

  const doc = useMemo(() => {
    if (customDoc) return customDoc;
    return docType === "inventory_document" ? SAMPLE_INVENTORY_DOC : SAMPLE_CUSTOMER_INVOICE;
  }, [customDoc, docType]);

  const previewHtml = useMemo(() => {
    return renderDocumentHTML(doc, templateId, undefined, true);
  }, [doc, templateId]);

  function handlePrint() {
    printDocument(doc, templateId);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl h-[90vh] flex flex-col p-0 overflow-hidden bg-background">
        <DialogHeader className="p-4 border-b flex flex-row items-center justify-between space-y-0">
          <DialogTitle className="flex items-center gap-2 text-lg font-bold">
            <Eye className="h-5 w-5 text-primary" />
            معاينة الفواتير والطباعة التفاعلية (Live Print Preview)
          </DialogTitle>
          <Button onClick={handlePrint} className="gap-1.5 rounded-full px-5">
            <Printer className="h-4 w-4" />
            طباعة المستند
          </Button>
        </DialogHeader>

        {/* Toolbar Controls */}
        <div className="flex flex-wrap items-center justify-between gap-3 p-3 bg-muted/40 border-b text-xs">
          {/* Document Type Selector */}
          <div className="flex items-center gap-2">
            <span className="font-semibold text-muted-foreground">نوع المستند:</span>
            <div className="inline-flex rounded-lg border bg-background p-1 gap-1">
              <button
                type="button"
                onClick={() => {
                  setDocType("customer_invoice");
                  setTemplateId(settings.defaultCustomerTemplate);
                }}
                className={`flex items-center gap-1 px-3 py-1 rounded-md text-xs font-medium transition ${
                  docType === "customer_invoice"
                    ? "bg-primary text-primary-foreground shadow"
                    : "hover:bg-muted"
                }`}
              >
                <ScrollText className="h-3.5 w-3.5" />
                فاتورة العميل
              </button>
              <button
                type="button"
                onClick={() => {
                  setDocType("inventory_document");
                  setTemplateId(settings.defaultInventoryTemplate);
                }}
                className={`flex items-center gap-1 px-3 py-1 rounded-md text-xs font-medium transition ${
                  docType === "inventory_document"
                    ? "bg-primary text-primary-foreground shadow"
                    : "hover:bg-muted"
                }`}
              >
                <Layers className="h-3.5 w-3.5" />
                مستند المخزون
              </button>
            </div>
          </div>

          {/* Template Selector */}
          <div className="flex items-center gap-2">
            <span className="font-semibold text-muted-foreground">القالب:</span>
            <div className="inline-flex rounded-lg border bg-background p-1 gap-1">
              <button
                type="button"
                onClick={() => setTemplateId("thermal")}
                className={`px-3 py-1 rounded-md text-xs font-medium transition ${
                  templateId === "thermal" ? "bg-amber-500 text-white shadow" : "hover:bg-muted"
                }`}
              >
                حراري (80mm)
              </button>
              <button
                type="button"
                onClick={() => setTemplateId("standard")}
                className={`px-3 py-1 rounded-md text-xs font-medium transition ${
                  templateId === "standard" ? "bg-blue-600 text-white shadow" : "hover:bg-muted"
                }`}
              >
                قياسي (A4)
              </button>
              {docType === "customer_invoice" && (
                <button
                  type="button"
                  onClick={() => setTemplateId("elegant")}
                  className={`flex items-center gap-1 px-3 py-1 rounded-md text-xs font-medium transition ${
                    templateId === "elegant"
                      ? "bg-gradient-to-r from-yellow-600 to-amber-600 text-white shadow"
                      : "hover:bg-muted"
                  }`}
                >
                  <Sparkles className="h-3 w-3" />
                  فاخر Gold
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Live Iframe Preview Frame */}
        <div className="flex-1 bg-slate-200/60 dark:bg-slate-900/60 p-4 overflow-auto flex justify-center">
          <iframe
            title="Print Preview Frame"
            srcDoc={previewHtml}
            className="w-full max-w-[850px] min-h-[750px] border-0 shadow-2xl rounded-lg bg-white"
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}

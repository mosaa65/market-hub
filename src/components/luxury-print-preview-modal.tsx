import React, { useState, useMemo, useEffect } from "react";
import {
  Printer,
  X,
  CheckCircle2,
  FileText,
  Sparkles,
  Download,
  Share2,
  ZoomIn,
  ZoomOut,
  Maximize2,
  ShieldCheck,
  Scale,
  QrCode,
  Check,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { WhatsAppIcon } from "@/components/whatsapp-icon";
import {
  renderUnifiedDocument,
  printUnifiedDocument,
  PRINT_PAPERS,
  PRINTING_LABELS,
  type PrintRequest,
  type PrintPaperId,
  type PrintTheme,
  type PrintingDocumentType,
} from "@/lib/printing";
import type { UnifiedDocumentData, InvoiceTemplateId } from "@/lib/templates";

export type LuxuryPaperFormat = PrintPaperId;
import type { InvoiceDoc } from "@/lib/pdf";
import { toast } from "sonner";

export type PrintMethodType = "thermal" | "page";

export interface LuxuryPrintPreviewModalProps {
  open: boolean;
  onClose: () => void;
  /** Document data in either UnifiedDocumentData or legacy InvoiceDoc format */
  doc?: UnifiedDocumentData | InvoiceDoc | null;
  /** Full PrintRequest if available */
  request?: PrintRequest | null;
  documentType?: PrintingDocumentType;
  title?: string;
  defaultFormat?: string;
  rtl?: boolean;
  onPrintSuccess?: () => void;
  customerPhone?: string | null;
  customerName?: string | null;
}

/** Converts an InvoiceDoc to UnifiedDocumentData if needed */
function toUnifiedData(
  input: UnifiedDocumentData | InvoiceDoc | null | undefined,
  docType: PrintingDocumentType = "customer_invoice",
): UnifiedDocumentData {
  if (!input) {
    return {
      docType,
      title: "مستند",
      number: "—",
      date: new Date().toLocaleDateString("ar-YE"),
      lines: [],
    };
  }

  const raw = input as any;
  if ("partyName" in raw || "partyLabel" in raw) {
    return {
      docType,
      ...raw,
    };
  }

  return {
    docType,
    title: raw.title || "فاتورة مبيعات",
    number: raw.number || "—",
    date: raw.date || new Date().toLocaleDateString("ar-YE"),
    partyLabel: raw.partyLabel || "العميل",
    partyName: raw.partyName || "",
    partyPhone: raw.partyPhone || "",
    warehouse: raw.warehouse || "",
    payment: raw.payment || "",
    status: raw.status || "",
    subtotal: raw.subtotal,
    tax: raw.tax,
    discount: raw.discount,
    total: raw.total,
    paid: raw.paid,
    balance: raw.balance,
    notes: raw.notes || raw.terms,
    lines: (raw.lines || []).map((l: any) => ({
      product: l.product || l.name || "",
      qty: Number(l.qty || l.quantity || 1),
      unit: l.unit || "",
      price: Number(l.price || l.unit_price || 0),
      total: Number(l.total || Number(l.qty || 1) * Number(l.price || 0)),
      code: l.code || l.sku,
    })),
    company: raw.company,
    currency: raw.currency || "ر.ي",
  };
}

export function LuxuryPrintPreviewModal({
  open,
  onClose,
  doc,
  request,
  documentType = "customer_invoice",
  title,
  defaultFormat,
  rtl = true,
  onPrintSuccess,
  customerPhone,
  customerName,
}: LuxuryPrintPreviewModalProps) {
  // Determine initial print method (thermal vs page)
  const initialMethod: PrintMethodType = useMemo(() => {
    if (defaultFormat === "thermal-58" || defaultFormat === "thermal-80") return "thermal";
    if (
      defaultFormat &&
      (defaultFormat.includes("a4") ||
        defaultFormat.includes("a5") ||
        defaultFormat === "standard" ||
        defaultFormat === "elegant" ||
        defaultFormat === "formal")
    )
      return "page";
    if (request?.paperId === "thermal-58" || request?.paperId === "thermal-80") return "thermal";
    if (request?.paperId === "a4" || request?.paperId === "a5") return "page";
    if (request?.templateId?.startsWith("thermal")) return "thermal";
    return "thermal"; // Default cashier preference
  }, [defaultFormat, request]);

  const [printMethod, setPrintMethod] = useState<PrintMethodType>(initialMethod);

  // Initial template selection per method
  const initialTemplateId: InvoiceTemplateId = useMemo(() => {
    if (request?.templateId) return request.templateId;
    if (initialMethod === "thermal") {
      return "thermal-milling"; // Default to the admired modern milling counter template
    }
    return "milling-clean"; // Default to the admired clean milling A4/A5 template
  }, [request?.templateId, initialMethod]);

  const [activeTemplate, setActiveTemplate] = useState<InvoiceTemplateId>(initialTemplateId);

  // Initial paper size per method
  const initialPaperId: PrintPaperId = useMemo(() => {
    if (request?.paperId) return request.paperId;
    if (defaultFormat === "thermal-58") return "thermal-58";
    if (defaultFormat === "a5") return "a5";
    return initialMethod === "thermal" ? "thermal-80" : "a4";
  }, [request?.paperId, defaultFormat, initialMethod]);

  const [activePaper, setActivePaper] = useState<PrintPaperId>(initialPaperId);
  const [zoomLevel, setZoomLevel] = useState<number>(100);
  const [isPrinting, setIsPrinting] = useState(false);

  useEffect(() => {
    if (open) {
      setPrintMethod(initialMethod);
      setActiveTemplate(initialTemplateId);
      setActivePaper(initialPaperId);
      setZoomLevel(100);
    }
  }, [open, initialMethod, initialTemplateId, initialPaperId]);

  // When switching method, adjust template and paper to match the method
  const handleMethodChange = (newMethod: PrintMethodType) => {
    setPrintMethod(newMethod);
    if (newMethod === "thermal") {
      setActiveTemplate("thermal-milling");
      setActivePaper("thermal-80");
    } else {
      setActiveTemplate("milling-clean");
      setActivePaper("a4");
    }
  };

  const unifiedDoc = useMemo(() => {
    if (request?.doc) return request.doc;
    return toUnifiedData(doc, documentType);
  }, [request, doc, documentType]);

  // Derive active theme from chosen template
  const activeTheme: PrintTheme = useMemo(() => {
    if (activeTemplate === "elegant") return "luxury";
    if (activeTemplate === "formal") return "formal";
    return "standard";
  }, [activeTemplate]);

  // Construct active print request
  const activeRequest: PrintRequest = useMemo(() => {
    return {
      doc: unifiedDoc,
      documentType,
      rtl,
      paperId: activePaper,
      templateId: activeTemplate,
      theme: activeTheme,
      labels: request?.labels,
    };
  }, [unifiedDoc, documentType, rtl, activePaper, activeTemplate, activeTheme, request]);

  // Generate HTML preview without window.print() auto-run
  const previewHtml = useMemo(() => {
    try {
      const html = renderUnifiedDocument(activeRequest);
      return html
        .replace(/\s+onload="[^"]*"/gi, "")
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "");
    } catch (err) {
      console.error("Failed to render print preview HTML:", err);
      return `<div style="padding:20px;color:red;font-family:sans-serif;">تعذر إنشاء المعاينة.</div>`;
    }
  }, [activeRequest]);

  if (!open) return null;

  const handlePrint = async () => {
    setIsPrinting(true);
    try {
      await printUnifiedDocument(activeRequest);
      toast.success("تم إرسال المستند للطباعة بنجاح");
      if (onPrintSuccess) onPrintSuccess();
    } catch (err: any) {
      toast.error(err.message || "حدث خطأ أثناء إرسال أمر الطباعة");
    } finally {
      setIsPrinting(false);
    }
  };

  const handleWhatsAppShare = () => {
    const phone = customerPhone || unifiedDoc.partyPhone || "";
    const cleanPhone = phone.replace(/[^0-9]/g, "");

    const msg = `مرحباً ${customerName || unifiedDoc.partyName || "عزيزنا العميل"}،\nمرفق تفاصيل ${unifiedDoc.title || "الفاتورة"} رقم: ${unifiedDoc.number}\nالإجمالي: ${unifiedDoc.total ? Number(unifiedDoc.total).toLocaleString() : "0"} ${unifiedDoc.currency || "ر.ي"}\nشكراً لتعاملكم معنا.`;

    const url = cleanPhone
      ? `https://wa.me/${cleanPhone}?text=${encodeURIComponent(msg)}`
      : `https://wa.me/?text=${encodeURIComponent(msg)}`;

    window.open(url, "_blank", "noopener,noreferrer");
  };

  const modalTitle = title || unifiedDoc.title || PRINTING_LABELS[rtl ? "ar" : "en"].preview;

  // Configuration for container sizing
  const isThermal = printMethod === "thermal";
  const containerWidth = isThermal
    ? activePaper === "thermal-58"
      ? "w-[310px]"
      : "w-[390px]"
    : activePaper === "a5"
      ? "w-full max-w-[590px]"
      : "w-full max-w-[850px]";

  const iframeMinHeight = isThermal
    ? activePaper === "thermal-58"
      ? "690px"
      : "760px"
    : activePaper === "a5"
      ? "820px"
      : "1150px";

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-2 sm:p-4 overflow-y-auto animate-in fade-in duration-200"
    >
      <div className="relative w-full max-w-5xl rounded-3xl border border-border/80 bg-card shadow-2xl overflow-hidden flex flex-col h-[95vh] max-h-[980px]">
        {/* ── Modal Header ── */}
        <div className="flex flex-col border-b border-border/80 px-4 sm:px-6 py-3 bg-muted/40 gap-3 shrink-0">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="p-2.5 rounded-2xl bg-primary/10 text-primary shrink-0">
                <Printer className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm sm:text-base font-bold text-foreground truncate">
                    {modalTitle}
                  </h3>
                  <span className="font-mono text-xs font-semibold px-2 py-0.5 rounded-lg bg-surface-2 border border-border/60 text-muted-foreground">
                    #{unifiedDoc.number}
                  </span>
                </div>
                <p className="text-[11px] text-muted-foreground truncate">
                  {unifiedDoc.partyName
                    ? `الطرف: ${unifiedDoc.partyName}`
                    : "معاينة المستند المباشرة والقوالب المعتمدة"}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {/* Zoom Controls */}
              <div className="hidden sm:flex items-center gap-0.5 rounded-xl bg-surface-2/80 p-0.5 border border-border/60 shadow-xs">
                <button
                  type="button"
                  onClick={() => setZoomLevel((z) => Math.max(60, z - 15))}
                  className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-surface transition-colors"
                  title="تصغير"
                >
                  <ZoomOut className="h-3.5 w-3.5" />
                </button>
                <span className="text-[10px] font-mono px-1 font-semibold text-muted-foreground">
                  {zoomLevel}%
                </span>
                <button
                  type="button"
                  onClick={() => setZoomLevel((z) => Math.min(150, z + 15))}
                  className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-surface transition-colors"
                  title="تكبير"
                >
                  <ZoomIn className="h-3.5 w-3.5" />
                </button>
                {zoomLevel !== 100 && (
                  <button
                    type="button"
                    onClick={() => setZoomLevel(100)}
                    className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-surface transition-colors"
                    title="استعادة 100%"
                  >
                    <Maximize2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>

              <button
                type="button"
                onClick={onClose}
                className="p-2 rounded-xl text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
          </div>

          {/* ── Hierarchy Selector Bar: Method ➔ Template ➔ Paper Size ── */}
          <div className="flex flex-wrap items-center justify-between gap-2.5 pt-1 border-t border-border/50">
            {/* Step 1: Print Method (Thermal vs Page) */}
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-bold text-muted-foreground shrink-0 hidden sm:inline">
                نوع الطباعة:
              </span>
              <div className="flex items-center rounded-2xl bg-surface-2/90 p-1 border border-border/70 shadow-xs">
                <button
                  type="button"
                  onClick={() => handleMethodChange("thermal")}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                    printMethod === "thermal"
                      ? "bg-primary text-primary-foreground shadow-xs"
                      : "text-muted-foreground hover:text-foreground hover:bg-surface"
                  }`}
                >
                  <Printer className="h-3.5 w-3.5" />
                  <span>طباعة حرارية</span>
                </button>

                <button
                  type="button"
                  onClick={() => handleMethodChange("page")}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                    printMethod === "page"
                      ? "bg-primary text-primary-foreground shadow-xs"
                      : "text-muted-foreground hover:text-foreground hover:bg-surface"
                  }`}
                >
                  <FileText className="h-3.5 w-3.5" />
                  <span>صفحات (A4 / A5)</span>
                </button>
              </div>
            </div>

            {/* Step 2: Templates corresponding to chosen method */}
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-xs font-bold text-muted-foreground shrink-0 hidden sm:inline">
                القالب:
              </span>
              <div className="flex items-center rounded-2xl bg-surface-2/90 p-1 border border-border/70 shadow-xs flex-wrap gap-0.5">
                {isThermal ? (
                  <>
                    <button
                      type="button"
                      onClick={() => setActiveTemplate("thermal-milling")}
                      className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-bold transition-all ${
                        activeTemplate === "thermal-milling"
                          ? "bg-primary text-primary-foreground shadow-xs"
                          : "text-muted-foreground hover:text-foreground hover:bg-surface"
                      }`}
                    >
                      <Scale className="h-3 w-3 text-amber-300" />
                      <span>كاونتر المطحنة الأنيق</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setActiveTemplate("thermal")}
                      className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-bold transition-all ${
                        activeTemplate === "thermal"
                          ? "bg-primary text-primary-foreground shadow-xs"
                          : "text-muted-foreground hover:text-foreground hover:bg-surface"
                      }`}
                    >
                      <span>الكاشير القياسي</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setActiveTemplate("thermal-qr")}
                      className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-bold transition-all ${
                        activeTemplate === "thermal-qr"
                          ? "bg-primary text-primary-foreground shadow-xs"
                          : "text-muted-foreground hover:text-foreground hover:bg-surface"
                      }`}
                    >
                      <QrCode className="h-3 w-3 text-emerald-400" />
                      <span>باركود و QR</span>
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => setActiveTemplate("milling-clean")}
                      className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-bold transition-all ${
                        activeTemplate === "milling-clean"
                          ? "bg-primary text-primary-foreground shadow-xs"
                          : "text-muted-foreground hover:text-foreground hover:bg-surface"
                      }`}
                    >
                      <Scale className="h-3 w-3 text-amber-300" />
                      <span>الكاونتر المبسط والأنيق</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setActiveTemplate("standard")}
                      className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-bold transition-all ${
                        activeTemplate === "standard"
                          ? "bg-primary text-primary-foreground shadow-xs"
                          : "text-muted-foreground hover:text-foreground hover:bg-surface"
                      }`}
                    >
                      <span>قياسي مؤسسي</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setActiveTemplate("elegant")}
                      className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-bold transition-all ${
                        activeTemplate === "elegant"
                          ? "bg-primary text-primary-foreground shadow-xs"
                          : "text-muted-foreground hover:text-foreground hover:bg-surface"
                      }`}
                    >
                      <Sparkles className="h-3 w-3 text-amber-300" />
                      <span>تنفيذي فاخر</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setActiveTemplate("formal")}
                      className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-bold transition-all ${
                        activeTemplate === "formal"
                          ? "bg-primary text-primary-foreground shadow-xs"
                          : "text-muted-foreground hover:text-foreground hover:bg-surface"
                      }`}
                    >
                      <ShieldCheck className="h-3 w-3 text-sky-400" />
                      <span>رسمي معتمد</span>
                    </button>
                  </>
                )}
              </div>
            </div>

            {/* Step 3: Paper Size corresponding to chosen method */}
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-bold text-muted-foreground shrink-0 hidden sm:inline">
                المقاس:
              </span>
              <div className="flex items-center rounded-2xl bg-surface-2/90 p-1 border border-border/70 shadow-xs">
                {isThermal ? (
                  <>
                    <button
                      type="button"
                      onClick={() => setActivePaper("thermal-80")}
                      className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                        activePaper === "thermal-80"
                          ? "bg-primary text-primary-foreground shadow-xs"
                          : "text-muted-foreground hover:text-foreground hover:bg-surface"
                      }`}
                    >
                      80 مم
                    </button>

                    <button
                      type="button"
                      onClick={() => setActivePaper("thermal-58")}
                      className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                        activePaper === "thermal-58"
                          ? "bg-primary text-primary-foreground shadow-xs"
                          : "text-muted-foreground hover:text-foreground hover:bg-surface"
                      }`}
                    >
                      58 مم
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => setActivePaper("a4")}
                      className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                        activePaper === "a4"
                          ? "bg-primary text-primary-foreground shadow-xs"
                          : "text-muted-foreground hover:text-foreground hover:bg-surface"
                      }`}
                    >
                      A4 (كاملة)
                    </button>

                    <button
                      type="button"
                      onClick={() => setActivePaper("a5")}
                      className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                        activePaper === "a5"
                          ? "bg-primary text-primary-foreground shadow-xs"
                          : "text-muted-foreground hover:text-foreground hover:bg-surface"
                      }`}
                    >
                      A5 (نصف صفحة)
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* ── Scrollable Preview Canvas ── */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 bg-slate-200/70 dark:bg-slate-950/90 flex justify-center items-start">
          <div
            className={`transition-all duration-200 ${containerWidth} flex flex-col items-center`}
            style={{
              transform: zoomLevel !== 100 ? `scale(${zoomLevel / 100})` : undefined,
              transformOrigin: "top center",
            }}
          >
            {/* Paper Simulation Frame */}
            <div
              className={`w-full bg-white text-slate-950 rounded-2xl shadow-2xl border border-slate-300 dark:border-slate-800 overflow-hidden relative ${
                isThermal ? "p-2 sm:p-3" : "p-0"
              }`}
            >
              {isThermal && (
                <div className="w-full flex justify-between items-center px-4 py-1.5 border-b border-dashed border-slate-300 text-[10px] text-slate-400 font-mono mb-2">
                  <span>✂️ قص الورقة</span>
                  <span>{activePaper === "thermal-80" ? "حراري 80 مم" : "حراري 58 مم"}</span>
                </div>
              )}

              {/* Sandboxed iframe rendering exact printable HTML */}
              <iframe
                title={modalTitle}
                srcDoc={previewHtml}
                className="w-full border-0 bg-white"
                style={{
                  height: iframeMinHeight,
                  minHeight: iframeMinHeight,
                }}
                sandbox="allow-same-origin"
              />

              {isThermal && (
                <div className="w-full text-center py-2 border-t border-dashed border-slate-300 text-[10px] text-slate-400 font-mono mt-2">
                  <span>┈┈┈ نهاية الإيصال ┈┈┈</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── Modal Footer Toolbar ── */}
        <div className="flex flex-wrap items-center justify-between border-t border-border/80 px-4 sm:px-6 py-3.5 bg-muted/40 gap-3 shrink-0">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
            <span className="hidden sm:inline">معاينة حية ومطابقة لمخرجات الطابعة بنسبة 100%</span>
            <span className="sm:hidden">معاينة مطابقة للطباعة</span>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onClose}
              className="rounded-xl h-10 px-4"
            >
              إغلاق
            </Button>

            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleWhatsAppShare}
              className="rounded-xl h-10 px-3.5 gap-1.5 text-emerald-600 dark:text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/10"
              title="مشاركة الفاتورة عبر واتساب"
            >
              <WhatsAppIcon className="h-4 w-4 shrink-0" />
              <span className="text-xs font-bold">واتساب</span>
            </Button>

            <Button
              type="button"
              disabled={isPrinting}
              onClick={handlePrint}
              className="rounded-xl h-10 px-5 gap-2 bg-primary text-primary-foreground font-bold shadow-md hover:bg-primary/90"
            >
              <Printer className="h-4 w-4" />
              <span>
                طباعة الآن (
                {isThermal
                  ? activePaper === "thermal-80"
                    ? "80 مم"
                    : "58 مم"
                  : activePaper === "a4"
                    ? "A4"
                    : "A5"}
                )
              </span>
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

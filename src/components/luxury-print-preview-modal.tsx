import React, { useState, useMemo, useEffect, useRef } from "react";
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
  PenLine,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { WhatsAppIcon } from "@/components/whatsapp-icon";
import {
  renderUnifiedDocument,
  printUnifiedDocument,
  getUnifiedPrintSettings,
  PRINT_PAPERS,
  PRINTING_LABELS,
  type PrintRequest,
  type PrintPaperId,
  type PrintTheme,
  type PrintingDocumentType,
} from "@/lib/printing";
import type { UnifiedDocumentData, InvoiceTemplateId } from "@/lib/templates";
// import html2pdf from "html2pdf.js"; // Prevent SSR evaluation

export type LuxuryPaperFormat = PrintPaperId;
import type { InvoiceDoc } from "@/lib/pdf";
import { toast } from "sonner";

export type PrintMethodType = "thermal" | "page";

export interface LuxuryPrintPreviewModalProps {
  open: boolean;
  onClose?: () => void;
  onOpenChange?: (open: boolean) => void;
  /** Document data in either UnifiedDocumentData or legacy InvoiceDoc format */
  doc?: UnifiedDocumentData | InvoiceDoc | null;
  document?: UnifiedDocumentData | InvoiceDoc | null;
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
      docType: docType as any,
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
    docType: docType as any,
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
  onOpenChange,
  doc,
  document,
  request,
  documentType = "customer_invoice",
  title,
  defaultFormat,
  rtl = true,
  onPrintSuccess,
  customerPhone,
  customerName,
}: LuxuryPrintPreviewModalProps) {
  const activeDoc = document ?? doc;
  const handleModalClose = () => {
    if (onClose) onClose();
    if (onOpenChange) onOpenChange(false);
  };
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
    const settings = request?.settings ?? getUnifiedPrintSettings();
    const docType = documentType ?? request?.documentType ?? "customer_invoice";
    const deptOverride = settings.overrides[docType];
    if (deptOverride?.templateId) return deptOverride.templateId;
    if (initialMethod === "thermal") {
      return "thermal-milling"; // Default to the admired modern milling counter template
    }
    return "elegant"; // Default to executive luxury A4/A5 template
  }, [request?.templateId, request?.settings, request?.documentType, documentType, initialMethod]);

  const [activeTemplate, setActiveTemplate] = useState<InvoiceTemplateId>(initialTemplateId);

  // Initial paper size per method
  const initialPaperId: PrintPaperId = useMemo(() => {
    if (request?.paperId) return request.paperId;
    const settings = request?.settings ?? getUnifiedPrintSettings();
    const docType = documentType ?? request?.documentType ?? "customer_invoice";
    const deptOverride = settings.overrides[docType];
    if (deptOverride?.paperId) return deptOverride.paperId;
    if (defaultFormat === "thermal-58") return "thermal-58";
    if (defaultFormat === "a5") return "a5";
    return initialMethod === "thermal" ? "thermal-80" : "a4";
  }, [
    request?.paperId,
    request?.settings,
    request?.documentType,
    documentType,
    defaultFormat,
    initialMethod,
  ]);

  const [activePaper, setActivePaper] = useState<PrintPaperId>(initialPaperId);
  // الباركود/QR يتبعان إعدادات قسم المستند الفعلي، لا قيمة ثابتة. القيمة تصل
  // من `request` (الذي يبنيها المحرك من الإعدادات + overrides) فتظهر المعاينة
  // والطباعة بنفس الحالة التي اختارها المستخدم في الإعدادات.
  const [showBarcode, setShowBarcode] = useState<boolean>(request?.showBarcode ?? true);
  const [showQrCode, setShowQrCode] = useState<boolean>(request?.showQrCode ?? true);
  const [showSignatures, setShowSignatures] = useState<boolean>(
    request?.showSignatures ??
      request?.settings?.overrides[documentType]?.showSignatures ??
      request?.settings?.showSignatures ??
      false,
  );
  const [zoomLevel, setZoomLevel] = useState<number>(100);
  const [isPrinting, setIsPrinting] = useState(false);
  const previewFrameRef = useRef<HTMLIFrameElement>(null);
  const [previewContentHeight, setPreviewContentHeight] = useState<number | null>(null);

  useEffect(() => {
    if (open) {
      setPrintMethod(initialMethod);
      setActiveTemplate(initialTemplateId);
      setActivePaper(initialPaperId);
      setShowBarcode(request?.showBarcode ?? true);
      setShowQrCode(request?.showQrCode ?? true);
      setShowSignatures(
        request?.showSignatures ??
          request?.settings?.overrides[documentType]?.showSignatures ??
          request?.settings?.showSignatures ??
          false,
      );
      setPreviewContentHeight(null);
      setZoomLevel(100);
    }
  }, [
    open,
    initialMethod,
    initialTemplateId,
    initialPaperId,
    request?.showBarcode,
    request?.showQrCode,
    request?.showSignatures,
    request?.settings,
    documentType,
  ]);

  const syncPreviewHeight = () => {
    const frameDocument = previewFrameRef.current?.contentDocument;
    if (!frameDocument) return;
    const contentHeight = Math.max(
      frameDocument.body.scrollHeight,
      frameDocument.documentElement.scrollHeight,
      Number.parseInt(iframeMinHeight, 10),
    );
    setPreviewContentHeight(contentHeight);
  };

  // When switching method, adjust template and paper to match the method
  const handleMethodChange = (newMethod: PrintMethodType) => {
    setPrintMethod(newMethod);
    const settings = request?.settings ?? getUnifiedPrintSettings();
    const docType = documentType ?? request?.documentType ?? "customer_invoice";
    const deptOverride = settings.overrides[docType];

    if (newMethod === "thermal") {
      setActiveTemplate(
        deptOverride?.templateId?.startsWith("thermal")
          ? deptOverride.templateId
          : "thermal-milling",
      );
      setActivePaper(
        deptOverride?.paperId?.startsWith("thermal") ? deptOverride.paperId : "thermal-80",
      );
    } else {
      setActiveTemplate(
        deptOverride?.templateId && !deptOverride.templateId.startsWith("thermal")
          ? deptOverride.templateId
          : "elegant",
      );
      setActivePaper(
        deptOverride?.paperId && !deptOverride.paperId.startsWith("thermal")
          ? deptOverride.paperId
          : "a4",
      );
    }
  };

  const unifiedDoc = useMemo(() => {
    if (request?.doc) return request.doc;
    return toUnifiedData(activeDoc, documentType);
  }, [request, activeDoc, documentType]);

  // Derive active theme from chosen template
  const activeTheme: PrintTheme = useMemo(() => {
    if (activeTemplate === "elegant") return "luxury";
    if (activeTemplate === "formal") return "formal";
    return "standard";
  }, [activeTemplate]);

  // Construct active print request
  const activeRequest: PrintRequest = useMemo(() => {
    const unifiedSettings = request?.settings ?? getUnifiedPrintSettings();
    const customColor =
      request?.accentColor ??
      (activeTheme === "luxury"
        ? unifiedSettings.luxuryAccentColor
        : unifiedSettings.standardAccentColor) ??
      undefined;

    return {
      doc: {
        ...unifiedDoc,
        options: {
          ...unifiedDoc.options,
          showBarcode,
          showQrCode,
          showSignatures,
          ...(customColor ? { accentColor: customColor } : {}),
        },
      },
      documentType,
      rtl,
      paperId: activePaper,
      templateId: activeTemplate,
      theme: activeTheme,
      accentColor: customColor,
      settings: unifiedSettings,
      // تجاوز صريح: القالب يطبّق `doc.options` بعد options المحرك، فتمرّر
      // القيمتين داخل اللقطة لتفوز دائماً في المعاينة والطباعة.
      showBarcode,
      showQrCode,
      showSignatures,
      labels: request?.labels,
    };
  }, [
    unifiedDoc,
    documentType,
    rtl,
    activePaper,
    activeTemplate,
    activeTheme,
    showBarcode,
    showQrCode,
    showSignatures,
    request,
  ]);

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

  const [isSharingPdf, setIsSharingPdf] = useState(false);

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

  const handlePdfShare = async () => {
    setIsSharingPdf(true);
    try {
      const { default: html2pdf } = await import("html2pdf.js");
      const previewDocument = previewFrameRef.current?.contentDocument;
      if (!previewDocument?.body) {
        throw new Error(
          rtl ? "تعذر الوصول إلى معاينة المستند." : "The document preview is unavailable.",
        );
      }

      await previewDocument.fonts?.ready;
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      await Promise.all(
        Array.from(previewDocument.images).map((image) => {
          if (image.complete) return Promise.resolve();
          return new Promise<void>((resolve) => {
            image.addEventListener("load", () => resolve(), { once: true });
            image.addEventListener("error", () => resolve(), { once: true });
          });
        }),
      );

      const paper = PRINT_PAPERS[activePaper];
      const contentHeightMm = Math.max(
        paper.heightMm ?? 0,
        (previewDocument.documentElement.scrollHeight * 25.4) / 96,
      );
      const fileName = `${(unifiedDoc.number || "document").replace(/[^\p{L}\p{N}_-]/gu, "_")}.pdf`;
      const pdfOptions = {
        margin: 0,
        filename: fileName,
        image: { type: "jpeg", quality: 0.98 },
        html2canvas: {
          scale: 2,
          useCORS: true,
          allowTaint: false,
          backgroundColor: "#ffffff",
          logging: false,
        },
        jsPDF: {
          unit: "mm",
          format: paper.heightMm ? activePaper : [paper.widthMm, contentHeightMm],
          orientation: "portrait",
          compress: true,
        },
        pagebreak: { mode: ["css", "legacy"], avoid: ["tr", ".signatures-row"] },
      };

      const blob = (await (html2pdf() as any)
        .set(pdfOptions)
        .from(previewDocument.body)
        .outputPdf("blob")) as Blob;
      const file = new File([blob], fileName, { type: "application/pdf" });

      if (
        navigator.share &&
        typeof navigator.canShare === "function" &&
        navigator.canShare({ files: [file] })
      ) {
        await navigator.share({
          title: `${unifiedDoc.title || "مستند"} ${unifiedDoc.number}`,
          text: `مرفق ملف PDF الخاص بـ ${unifiedDoc.title || "المستند"} رقم: ${unifiedDoc.number}`,
          files: [file],
        });
        toast.success("تم فتح نافذة المشاركة بنجاح");
      } else {
        // Fallback: تنزيل ملف الـ PDF مباشرة للمستخدم
        const url = URL.createObjectURL(blob);
        const a = window.document.createElement("a");
        a.href = url;
        a.download = fileName;
        window.document.body.appendChild(a);
        a.click();
        window.document.body.removeChild(a);
        URL.revokeObjectURL(url);
        toast.success("تم تجهيز وتحميل ملف الـ PDF بنجاح، يمكنك مشاركته الآن.");
      }
    } catch (err: any) {
      if (err.name !== "AbortError") {
        console.error("PDF share error:", err);
        toast.error("تعذر مشاركة ملف الـ PDF: " + (err.message || "خطأ غير متوقع"));
      }
    } finally {
      setIsSharingPdf(false);
    }
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
      ? "830px"
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
                      <span>الإيصال الحراري الاحترافي</span>
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
                      <span>إيصال نقطة البيع</span>
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
                      onClick={() => setActiveTemplate("milling-master")}
                      className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-bold transition-all ${
                        activeTemplate === "milling-master"
                          ? "bg-primary text-primary-foreground shadow-xs"
                          : "text-muted-foreground hover:text-foreground hover:bg-surface"
                      }`}
                    >
                      <Scale className="h-3 w-3 text-amber-400" />
                      <span>خدمات وسندات المطحنة</span>
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
                      onClick={() => setActiveTemplate("standard")}
                      className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-bold transition-all ${
                        activeTemplate === "standard"
                          ? "bg-primary text-primary-foreground shadow-xs"
                          : "text-muted-foreground hover:text-foreground hover:bg-surface"
                      }`}
                    >
                      <span>قياسي مضغوط</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setActiveTemplate("milling-clean")}
                      className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-bold transition-all ${
                        activeTemplate === "milling-clean"
                          ? "bg-primary text-primary-foreground shadow-xs"
                          : "text-muted-foreground hover:text-foreground hover:bg-surface"
                      }`}
                    >
                      <span>مبسط كلاسيكي</span>
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

            {/* Step 4: Quick Barcode & QR Code Toggles */}
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-bold text-muted-foreground shrink-0 hidden sm:inline">
                الترميز:
              </span>
              <div className="flex items-center rounded-2xl bg-surface-2/90 p-1 border border-border/70 shadow-xs gap-1">
                <button
                  type="button"
                  onClick={() => setShowBarcode((prev) => !prev)}
                  className={`px-2.5 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1 ${
                    showBarcode
                      ? "bg-primary/20 text-primary border border-primary/30"
                      : "text-muted-foreground hover:text-foreground line-through opacity-60"
                  }`}
                  title="تفعيل / إلغاء تفعيل الباركود"
                >
                  <span>|||| الباركود</span>
                </button>

                <button
                  type="button"
                  onClick={() => setShowQrCode((prev) => !prev)}
                  className={`px-2.5 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1 ${
                    showQrCode
                      ? "bg-primary/20 text-primary border border-primary/30"
                      : "text-muted-foreground hover:text-foreground line-through opacity-60"
                  }`}
                  title="تفعيل / إلغاء تفعيل الـ QR code"
                >
                  <QrCode className="h-3.5 w-3.5" />
                  <span>QR</span>
                </button>
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
                ref={previewFrameRef}
                title={modalTitle}
                srcDoc={previewHtml}
                onLoad={syncPreviewHeight}
                className="w-full border-0 bg-white"
                style={{
                  height: previewContentHeight ?? iframeMinHeight,
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
              disabled={isSharingPdf}
              onClick={handlePdfShare}
              className="rounded-xl h-10 px-3.5 gap-1.5 text-sky-600 dark:text-sky-400 border-sky-500/30 hover:bg-sky-500/10"
              title="مشاركة أو تنزيل ملف PDF معتمد"
            >
              <Share2 className="h-4 w-4 shrink-0" />
              <span className="text-xs font-bold">
                {isSharingPdf ? "جارٍ التجهيز…" : "مشاركة PDF"}
              </span>
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

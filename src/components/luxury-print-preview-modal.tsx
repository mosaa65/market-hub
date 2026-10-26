import React, { useState, useMemo, useEffect, useRef } from "react";
import {
  Printer,
  X,
  CheckCircle2,
  FileText,
  Sparkles,
  Share2,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Scale,
  QrCode,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { WhatsAppIcon } from "@/components/whatsapp-icon";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { useCompanyCurrency } from "@/hooks/use-company-currency";
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

/** Converts any input format to safe UnifiedDocumentData */
function toUnifiedData(
  input: UnifiedDocumentData | InvoiceDoc | null | undefined,
  docType: PrintingDocumentType = "customer_invoice",
): UnifiedDocumentData {
  if (!input) {
    return {
      docType: docType as any,
      title: "مستند",
      number: "—",
      date: new Date().toISOString(),
      lines: [],
    };
  }

  const raw = input as any;
  const rawLines = Array.isArray(raw.lines) ? raw.lines : [];
  const safeLines = rawLines.map((l: any) => ({
    product: String(l?.product || l?.name || l?.item_name || "صنف"),
    qty: Number(l?.qty ?? l?.quantity ?? 1),
    unit: l?.unit ? String(l.unit) : "",
    price: Number(l?.price ?? l?.unit_price ?? 0),
    total: Number(l?.total ?? (Number(l?.qty ?? l?.quantity ?? 1) * Number(l?.price ?? l?.unit_price ?? 0))),
    code: l?.code || l?.sku,
    note: l?.note,
    previousQty: l?.previousQty,
    remainingQty: l?.remainingQty,
  }));

  return {
    docType: raw.docType || docType,
    title: raw.title || "فاتورة مبيعات",
    number: raw.number || raw.invoice_number || raw.document_number || "—",
    date: raw.date || raw.created_at || new Date().toISOString(),
    partyLabel: raw.partyLabel || "العميل",
    partyName: raw.partyName || raw.customer_name || raw.customer?.name || "",
    partyPhone: raw.partyPhone || raw.customer_phone || raw.customer?.phone || "",
    warehouse: raw.warehouse || raw.warehouse_name || "",
    payment: raw.payment || raw.payment_method || "",
    status: raw.status || "",
    subtotal: raw.subtotal !== undefined ? Number(raw.subtotal) : undefined,
    tax: raw.tax !== undefined ? Number(raw.tax) : undefined,
    discount: raw.discount !== undefined ? Number(raw.discount) : undefined,
    total: raw.total !== undefined ? Number(raw.total) : 0,
    paid: raw.paid !== undefined ? Number(raw.paid) : undefined,
    balance: raw.balance !== undefined ? Number(raw.balance) : undefined,
    notes: raw.notes || raw.note || raw.terms,
    lines: safeLines,
    company: raw.company,
    currency: raw.currency || "ر.ي",
    options: raw.options,
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
  const { user } = useAuth();
  const { companyProfile } = useCompanyCurrency();
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
  const [showBarcode, setShowBarcode] = useState(request?.showBarcode ?? true);
  const [showQrCode, setShowQrCode] = useState(request?.showQrCode ?? false);
  const [showSignatures, setShowSignatures] = useState(
    request?.showSignatures ??
      request?.settings?.overrides[documentType]?.showSignatures ??
      request?.settings?.showSignatures ??
      false,
  );
  const [mobileMenu, setMobileMenu] = useState<"method" | "template" | "paper" | "codes" | null>(
    null,
  );
  const [zoomLevel, setZoomLevel] = useState(100);
  const [isPrinting, setIsPrinting] = useState(false);
  const [isSharingPdf, setIsSharingPdf] = useState(false);
  const [profileSellerName, setProfileSellerName] = useState("");
  const previewFrameRef = useRef<HTMLIFrameElement>(null);
  const [previewContentHeight, setPreviewContentHeight] = useState<number | null>(null);

  useEffect(() => {
    if (!open || !user?.id) return;
    let active = true;
    void supabase
      .from("profiles")
      .select("full_name")
      .eq("id", user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (active) setProfileSellerName(data?.full_name?.trim() || "");
      });
    return () => {
      active = false;
    };
  }, [open, user?.id]);

  useEffect(() => {
    if (!open) return;
    setPrintMethod(initialMethod);
    setActiveTemplate(initialTemplateId);
    setActivePaper(initialPaperId);
    setShowBarcode(request?.showBarcode ?? true);
    setShowQrCode(request?.showQrCode ?? false);
    setShowSignatures(
      request?.showSignatures ??
        request?.settings?.overrides[documentType]?.showSignatures ??
        request?.settings?.showSignatures ??
        false,
    );
    setPreviewContentHeight(null);
    setZoomLevel(100);
    setMobileMenu(null);
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

  const iframeMinHeight =
    printMethod === "thermal" ? "120px" : activePaper === "a5" ? "830px" : "1150px";

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
      return;
    }

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
  };

  const unifiedDoc = useMemo(() => {
    const source = request?.doc ?? toUnifiedData(activeDoc, documentType);
    const metadataName =
      user?.user_metadata?.full_name ||
      user?.user_metadata?.name ||
      user?.email?.split("@")[0] ||
      "";
    return {
      ...source,
      operatorName: source.operatorName || profileSellerName || metadataName || undefined,
    };
  }, [request, activeDoc, documentType, profileSellerName, user]);

  const activeTheme: PrintTheme = useMemo(() => {
    if (activeTemplate === "elegant") return "luxury";
    if (activeTemplate === "formal") return "formal";
    return "standard";
  }, [activeTemplate]);

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

  const previewHtml = useMemo(() => {
    try {
      return renderUnifiedDocument(activeRequest)
        .replace(/\s+onload="[^"]*"/gi, "")
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "");
    } catch (error) {
      console.error("Failed to render print preview HTML:", error);
      return `<div style="padding:20px;color:red;font-family:sans-serif;">تعذر إنشاء المعاينة.</div>`;
    }
  }, [activeRequest, companyProfile]);

  const isThermal = printMethod === "thermal";
  const containerWidth = isThermal
    ? activePaper === "thermal-58"
      ? "w-[310px]"
      : "w-[390px]"
    : activePaper === "a5"
      ? "w-full max-w-[590px]"
      : "w-full max-w-[850px]";
  const modalTitle = title || unifiedDoc.title || PRINTING_LABELS[rtl ? "ar" : "en"].preview;

  const handlePrint = async () => {
    setIsPrinting(true);
    try {
      await printUnifiedDocument(activeRequest);
      toast.success("تم إرسال المستند للطباعة بنجاح");
      onPrintSuccess?.();
    } catch (error) {
      const message = error instanceof Error ? error.message : "حدث خطأ أثناء إرسال أمر الطباعة";
      toast.error(message);
    } finally {
      setIsPrinting(false);
    }
  };

  const handleWhatsAppShare = () => {
    const phone = customerPhone || unifiedDoc.partyPhone || "";
    const cleanPhone = phone.replace(/[^0-9]/g, "");
    const message = `مرحباً ${customerName || unifiedDoc.partyName || "عزيزنا العميل"}،\nمرفق تفاصيل ${unifiedDoc.title || "الفاتورة"} رقم: ${unifiedDoc.number}\nالإجمالي: ${unifiedDoc.total ? Number(unifiedDoc.total).toLocaleString() : "0"} ${unifiedDoc.currency || "ر.ي"}\nشكراً لتعاملكم معنا.`;
    const url = cleanPhone
      ? `https://wa.me/${cleanPhone}?text=${encodeURIComponent(message)}`
      : `https://wa.me/?text=${encodeURIComponent(message)}`;
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
        const url = URL.createObjectURL(blob);
        const anchor = window.document.createElement("a");
        anchor.href = url;
        anchor.download = fileName;
        window.document.body.appendChild(anchor);
        anchor.click();
        window.document.body.removeChild(anchor);
        URL.revokeObjectURL(url);
        toast.success("تم تجهيز وتحميل ملف الـ PDF بنجاح، يمكنك مشاركته الآن.");
      }
    } catch (error) {
      if (!(error instanceof Error) || error.name !== "AbortError") {
        const message = error instanceof Error ? error.message : "خطأ غير متوقع";
        console.error("PDF share error:", error);
        toast.error(`تعذر مشاركة ملف الـ PDF: ${message}`);
      }
    } finally {
      setIsSharingPdf(false);
    }
  };

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-0 md:p-4 animate-in fade-in duration-200"
    >
      <div className="relative flex h-[100dvh] max-h-[980px] w-full max-w-7xl flex-col overflow-hidden rounded-none border border-border/80 bg-card shadow-2xl md:h-[95vh] md:rounded-2xl">
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden md:flex-row" dir="ltr">
          <section
            className="flex min-h-0 min-w-0 flex-1 flex-col bg-slate-200/70 dark:bg-slate-950/90"
            aria-label="معاينة الفاتورة"
          >
            <div
              className="flex shrink-0 items-center justify-between border-b border-border/50 px-3 py-2"
              dir="rtl"
            >
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                <span>معاينة مباشرة</span>
              </div>
              <div className="flex items-center gap-1 rounded-lg border border-border/60 bg-card/80 p-0.5">
                <button
                  type="button"
                  onClick={() => setZoomLevel((z) => Math.max(60, z - 15))}
                  className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                  title="تصغير"
                >
                  <ZoomOut className="h-4 w-4" />
                </button>
                <span className="min-w-10 text-center font-mono text-[11px] text-muted-foreground">
                  {zoomLevel}%
                </span>
                <button
                  type="button"
                  onClick={() => setZoomLevel((z) => Math.min(150, z + 15))}
                  className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                  title="تكبير"
                >
                  <ZoomIn className="h-4 w-4" />
                </button>
                {zoomLevel !== 100 && (
                  <button
                    type="button"
                    onClick={() => setZoomLevel(100)}
                    className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                    title="استعادة 100%"
                  >
                    <Maximize2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-auto p-3 sm:p-6">
              <div
                className={`mx-auto transition-all duration-200 ${containerWidth}`}
                style={{
                  transform: zoomLevel !== 100 ? `scale(${zoomLevel / 100})` : undefined,
                  transformOrigin: "top center",
                }}
              >
                <div
                  className={`relative w-full overflow-hidden border border-slate-300 bg-white text-slate-950 shadow-xl dark:border-slate-800 ${isThermal ? "rounded-lg p-2 sm:p-3" : "rounded-sm"}`}
                >
                  {isThermal && (
                    <div className="mb-2 flex w-full items-center justify-between border-b border-dashed border-slate-300 px-3 py-1.5 font-mono text-[10px] text-slate-400">
                      <span>قص الورقة</span>
                      <span>{activePaper === "thermal-80" ? "حراري 80 مم" : "حراري 58 مم"}</span>
                    </div>
                  )}
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
                    <div className="mt-2 w-full border-t border-dashed border-slate-300 py-2 text-center font-mono text-[10px] text-slate-400">
                      نهاية الإيصال
                    </div>
                  )}
                </div>
              </div>
            </div>
          </section>

          <aside
            className="flex max-h-[42%] shrink-0 flex-col overflow-hidden border-t border-border/80 bg-card md:max-h-none md:w-[310px] md:border-l md:border-t-0"
            dir="rtl"
          >
            <header className="flex shrink-0 items-center justify-between gap-2 border-b border-border/70 px-3 py-2.5 md:px-4 md:py-3">
              <div className="flex min-w-0 items-center gap-2.5">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <Printer className="size-4.5" />
                </span>
                <div className="min-w-0">
                  <h3 className="truncate text-sm font-bold text-foreground">{modalTitle}</h3>
                  <p className="truncate text-[11px] text-muted-foreground">
                    #{unifiedDoc.number}
                    {unifiedDoc.partyName ? ` · ${unifiedDoc.partyName}` : ""}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={handleModalClose}
                aria-label="إغلاق نافذة الطباعة"
                className="shrink-0 rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <X className="size-5" />
              </button>
            </header>

            <div className="shrink-0 space-y-2 border-b border-border/70 px-3 py-2 md:hidden">
              <div className="grid grid-cols-4 gap-2">
                {(
                  [
                    ["method", Printer, "نوع الطباعة"],
                    ["template", Sparkles, "القالب"],
                    ["paper", FileText, "مقاس الورق"],
                    ["codes", QrCode, "الباركود ورمز QR"],
                  ] as const
                ).map(([menu, Icon, label]) => (
                  <button
                    key={menu}
                    type="button"
                    aria-label={label}
                    aria-expanded={mobileMenu === menu}
                    title={label}
                    onClick={() => setMobileMenu((current) => (current === menu ? null : menu))}
                    className={`flex size-11 items-center justify-center rounded-full border transition-colors ${mobileMenu === menu ? "border-primary bg-primary/10 text-primary" : "border-border bg-background text-muted-foreground hover:text-foreground"}`}
                  >
                    <Icon className="size-4.5" />
                  </button>
                ))}
              </div>

              {mobileMenu && (
                <div className="rounded-xl border border-border bg-background p-2 shadow-lg animate-in fade-in slide-in-from-bottom-1 duration-150">
                  {mobileMenu === "method" && (
                    <div className="grid grid-cols-2 gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant={isThermal ? "default" : "outline"}
                        onClick={() => handleMethodChange("thermal")}
                        className="h-9 rounded-lg"
                      >
                        حراري
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant={!isThermal ? "default" : "outline"}
                        onClick={() => handleMethodChange("page")}
                        className="h-9 rounded-lg"
                      >
                        صفحات A4 / A5
                      </Button>
                    </div>
                  )}
                  {mobileMenu === "template" && (
                    <div className="grid grid-cols-2 gap-2">
                      {(isThermal
                        ? [
                            { id: "thermal-milling", label: "إيصال احترافي" },
                            { id: "thermal", label: "نقطة البيع" },
                            { id: "thermal-qr", label: "باركود و QR" },
                          ]
                        : [
                            { id: "milling-master", label: "خدمات المطحنة" },
                            { id: "elegant", label: "تنفيذي فاخر" },
                            { id: "standard", label: "قياسي مضغوط" },
                            { id: "milling-clean", label: "مبسط كلاسيكي" },
                          ]
                      ).map((template) => (
                        <Button
                          key={template.id}
                          type="button"
                          size="sm"
                          variant={activeTemplate === template.id ? "default" : "outline"}
                          onClick={() => setActiveTemplate(template.id as InvoiceTemplateId)}
                          className="h-9 rounded-lg text-xs"
                        >
                          {template.label}
                        </Button>
                      ))}
                    </div>
                  )}
                  {mobileMenu === "paper" && (
                    <div className="grid grid-cols-2 gap-2">
                      {(isThermal
                        ? [
                            { id: "thermal-80", label: "80 مم" },
                            { id: "thermal-58", label: "58 مم" },
                          ]
                        : [
                            { id: "a4", label: "A4 كاملة" },
                            { id: "a5", label: "A5 نصف صفحة" },
                          ]
                      ).map((paper) => (
                        <Button
                          key={paper.id}
                          type="button"
                          size="sm"
                          variant={activePaper === paper.id ? "default" : "outline"}
                          onClick={() => setActivePaper(paper.id as PrintPaperId)}
                          className="h-9 rounded-lg"
                        >
                          {paper.label}
                        </Button>
                      ))}
                    </div>
                  )}
                  {mobileMenu === "codes" && (
                    <div className="grid grid-cols-2 gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant={showBarcode ? "default" : "outline"}
                        aria-pressed={showBarcode}
                        onClick={() => setShowBarcode((value) => !value)}
                        className="h-9 rounded-lg"
                      >
                        الباركود {showBarcode ? "مفعّل" : "متوقف"}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant={showQrCode ? "default" : "outline"}
                        aria-pressed={showQrCode}
                        onClick={() => setShowQrCode((value) => !value)}
                        className="h-9 rounded-lg"
                      >
                        QR {showQrCode ? "مفعّل" : "متوقف"}
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="hidden min-h-0 flex-1 space-y-4 overflow-y-auto p-4 md:block">
              <section className="space-y-2">
                <h4 className="text-xs font-bold text-muted-foreground">نوع الطباعة</h4>
                <div className="grid grid-cols-2 gap-1 rounded-lg bg-muted/70 p-1">
                  <button
                    type="button"
                    onClick={() => handleMethodChange("thermal")}
                    className={`flex items-center justify-center gap-1.5 rounded-md px-2 py-2 text-xs font-semibold transition-colors ${printMethod === "thermal" ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-background"}`}
                  >
                    <Printer className="h-3.5 w-3.5" /> حراري
                  </button>
                  <button
                    type="button"
                    onClick={() => handleMethodChange("page")}
                    className={`flex items-center justify-center gap-1.5 rounded-md px-2 py-2 text-xs font-semibold transition-colors ${printMethod === "page" ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-background"}`}
                  >
                    <FileText className="h-3.5 w-3.5" /> صفحات
                  </button>
                </div>
              </section>

              <section className="space-y-2">
                <h4 className="text-xs font-bold text-muted-foreground">القالب</h4>
                <div className="space-y-1">
                  {(isThermal
                    ? [
                        {
                          id: "thermal-milling",
                          label: "الإيصال الحراري الاحترافي",
                          icon: <Scale className="h-4 w-4" />,
                        },
                        { id: "thermal", label: "إيصال نقطة البيع" },
                        {
                          id: "thermal-qr",
                          label: "باركود و QR",
                          icon: <QrCode className="h-4 w-4" />,
                        },
                      ]
                    : [
                        {
                          id: "milling-master",
                          label: "خدمات وسندات المطحنة",
                          icon: <Scale className="h-4 w-4" />,
                        },
                        {
                          id: "elegant",
                          label: "تنفيذي فاخر",
                          icon: <Sparkles className="h-4 w-4" />,
                        },
                        { id: "standard", label: "قياسي مضغوط" },
                        { id: "milling-clean", label: "مبسط كلاسيكي" },
                      ]
                  ).map((template) => (
                    <button
                      key={template.id}
                      type="button"
                      onClick={() => setActiveTemplate(template.id as InvoiceTemplateId)}
                      className={`flex w-full items-center gap-2 rounded-md border px-3 py-2 text-right text-xs font-medium transition-colors ${activeTemplate === template.id ? "border-primary/40 bg-primary/10 text-primary" : "border-transparent text-foreground hover:bg-muted"}`}
                    >
                      {template.icon}
                      <span>{template.label}</span>
                    </button>
                  ))}
                </div>
              </section>

              <section className="space-y-2">
                <h4 className="text-xs font-bold text-muted-foreground">مقاس الورق</h4>
                <div className="grid grid-cols-2 gap-1 rounded-lg bg-muted/70 p-1">
                  {(isThermal
                    ? [
                        { id: "thermal-80", label: "80 مم" },
                        { id: "thermal-58", label: "58 مم" },
                      ]
                    : [
                        { id: "a4", label: "A4 كاملة" },
                        { id: "a5", label: "A5 نصف صفحة" },
                      ]
                  ).map((paper) => (
                    <button
                      key={paper.id}
                      type="button"
                      onClick={() => setActivePaper(paper.id as PrintPaperId)}
                      className={`rounded-md px-2 py-2 text-xs font-semibold transition-colors ${activePaper === paper.id ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
                    >
                      {paper.label}
                    </button>
                  ))}
                </div>
              </section>

              <section className="space-y-2">
                <h4 className="text-xs font-bold text-muted-foreground">محتوى الفاتورة</h4>
                <button
                  type="button"
                  onClick={() => setShowBarcode((prev) => !prev)}
                  aria-pressed={showBarcode}
                  className={`flex w-full items-center justify-between rounded-md border px-3 py-2 text-xs font-medium transition-colors ${showBarcode ? "border-primary/30 bg-primary/5 text-foreground" : "border-border text-muted-foreground"}`}
                >
                  <span>الباركود</span>
                  <span className="text-[11px]">{showBarcode ? "مفعّل" : "متوقف"}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setShowQrCode((prev) => !prev)}
                  aria-pressed={showQrCode}
                  className={`flex w-full items-center justify-between rounded-md border px-3 py-2 text-xs font-medium transition-colors ${showQrCode ? "border-primary/30 bg-primary/5 text-foreground" : "border-border text-muted-foreground"}`}
                >
                  <span className="flex items-center gap-2">
                    <QrCode className="h-3.5 w-3.5" /> رمز QR
                  </span>
                  <span className="text-[11px]">{showQrCode ? "مفعّل" : "متوقف"}</span>
                </button>
              </section>
            </div>

            <div className="hidden shrink-0 space-y-2 border-t border-border/80 bg-muted/30 p-3 md:block">
              <Button
                type="button"
                disabled={isPrinting}
                onClick={handlePrint}
                className="h-10 w-full gap-2 rounded-md font-bold"
              >
                <Printer className="h-4 w-4" />
                <span>
                  طباعة الآن (
                  {isThermal
                    ? activePaper === "thermal-80"
                      ? "80 مم"
                      : "58 مم"
                    : activePaper.toUpperCase()}
                  )
                </span>
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={isSharingPdf}
                onClick={handlePdfShare}
                className="h-9 w-full justify-start gap-2 rounded-md"
              >
                <Share2 className="h-4 w-4 text-sky-600" />
                <span>{isSharingPdf ? "جارٍ تجهيز PDF…" : "مشاركة أو تنزيل PDF"}</span>
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={handleWhatsAppShare}
                className="h-9 w-full justify-start gap-2 rounded-md text-emerald-700 hover:text-emerald-800"
              >
                <WhatsAppIcon className="h-4 w-4" />
                <span>مشاركة عبر واتساب</span>
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={handleModalClose}
                className="h-9 w-full rounded-md text-muted-foreground"
              >
                إغلاق
              </Button>
            </div>

            <div
              className="grid shrink-0 grid-cols-[minmax(0,1fr)_48px_48px] items-center gap-2 border-t border-border/80 bg-card px-3 py-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom))] md:hidden"
              dir="rtl"
            >
              <button
                type="button"
                disabled={isPrinting}
                onClick={handlePrint}
                aria-label={`طباعة الآن ${isThermal ? (activePaper === "thermal-80" ? "80 مم" : "58 مم") : activePaper.toUpperCase()}`}
                title={`طباعة الآن (${isThermal ? (activePaper === "thermal-80" ? "80 مم" : "58 مم") : activePaper.toUpperCase()})`}
                className="flex h-12 min-w-0 items-center justify-center gap-2 rounded-2xl bg-foreground px-3 text-background shadow-lg shadow-foreground/15 transition hover:opacity-95 active:scale-[0.98] disabled:opacity-50"
              >
                <Printer className="size-5 shrink-0" />
                <span className="truncate text-xs font-bold">
                  {isPrinting
                    ? "جارٍ الطباعة…"
                    : `طباعة الآن (${isThermal ? (activePaper === "thermal-80" ? "80 مم" : "58 مم") : activePaper.toUpperCase()})`}
                </span>
              </button>
              <button
                type="button"
                disabled={isSharingPdf}
                onClick={handlePdfShare}
                aria-label={isSharingPdf ? "جارٍ تجهيز ملف PDF" : "مشاركة أو تنزيل PDF"}
                title={isSharingPdf ? "جارٍ تجهيز PDF" : "مشاركة أو تنزيل PDF"}
                className="flex size-12 items-center justify-center rounded-full border border-border bg-background text-sky-700 transition hover:bg-muted active:scale-[0.98] disabled:opacity-50"
              >
                <Share2 className="size-5" />
              </button>
              <button
                type="button"
                onClick={handleWhatsAppShare}
                aria-label="مشاركة عبر واتساب"
                title="مشاركة عبر واتساب"
                className="flex size-12 items-center justify-center rounded-full border border-emerald-600/25 bg-emerald-600/5 text-emerald-700 transition hover:bg-emerald-600/10 active:scale-[0.98]"
              >
                <WhatsAppIcon className="size-5" />
              </button>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}

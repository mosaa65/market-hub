import React, { useState, useMemo } from "react";
import {
  Printer,
  X,
  CheckCircle2,
  Scale,
  FileText,
  Check,
  Copy,
  ZoomIn,
  ZoomOut,
  Smartphone,
  Share2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { WhatsAppIcon } from "@/components/whatsapp-icon";
import { getCachedCompanyProfile } from "@/lib/printing/company-profile";
import type { MillingDocumentDetails } from "@/lib/milling";
import type { UnifiedDocumentData } from "@/lib/templates/types";
import { getPrintSettings, renderDocumentHTML } from "@/lib/templates";
import { toast } from "sonner";

export type MillingTicketStage = "intake" | "milled" | "delivery" | "unified";
export type ThermalWidth = "80mm" | "58mm";

export interface UnifiedTicketPrintData {
  stage?: MillingTicketStage;
  ticketNumber: string;
  invoiceNumber?: string;
  customerName: string;
  customerPhone?: string;
  warehouseName?: string;
  createdAt: string;

  // Grain & Intake info
  grainType?: string;
  millingTypeLabel?: string;
  bagCount?: number;
  bagSizeKg?: number;
  totalWeightKg?: number;
  bagsSourceLabel?: string;

  // Outputs / Deliveries
  items?: Array<{
    name: string;
    bags: number;
    bagSizeKg?: number;
    kg: number;
    previousBags?: number;
    previousKg?: number;
    remainingBags?: number;
    remainingKg?: number;
    note?: string;
  }>;

  // Loss (milling stage)
  lossKg?: number;

  // Financial Breakdown
  millingFeeTotal?: number;
  packagingTotal?: number;
  discount?: number;
  grandTotal: number;
  paidAmount: number;
  remainingAmount: number;
  paymentMethodLabel?: string;

  // Company and Notes
  notes?: string;
  companyName?: string;
  companyPhone?: string;
  companyAddress?: string;
}

export interface UnifiedPrintModalProps {
  open: boolean;
  onClose: () => void;
  data?: UnifiedTicketPrintData | null;
  details?: MillingDocumentDetails | null;
  doc?: UnifiedDocumentData | null;
  stage?: MillingTicketStage;
}

/**
 * تحويل تفاصيل مستند المطحنة MillingDocumentDetails إلى هيكل تذكرة الطباعة.
 */
export function documentDetailsToTicketData(
  details: MillingDocumentDetails,
  stage: MillingTicketStage = "intake",
): UnifiedTicketPrintData {
  const company = getCachedCompanyProfile();
  const inv = details.sales_invoices;
  const subtotal = Number(inv?.subtotal ?? 0);
  const discount = Number(inv?.discount ?? 0);
  const grandTotal = Number(inv?.total ?? Math.max(0, subtotal - discount));
  const paidAmount = Number(inv?.paid ?? 0);
  const remainingAmount = Math.max(0, grandTotal - paidAmount);

  const grain = details.intakeGrain;
  const bagCount = grain?.bagsReceived || 0;
  const totalWeightKg = grain?.kgReceived || 0;
  const bagSizeKg =
    grain?.packageWeightKg ||
    (bagCount > 0 && totalWeightKg > 0 ? Math.round(totalWeightKg / bagCount) : 50);

  const items = (details.outputsSummary ?? []).map((out) => ({
    name: out.nameAr,
    bags: stage === "delivery" ? out.bagsDelivered || 0 : out.bagsProduced || 0,
    bagSizeKg:
      out.bagsProduced > 0 && out.kgProduced > 0
        ? Math.round(out.kgProduced / out.bagsProduced)
        : 50,
    kg: stage === "delivery" ? out.kgDelivered || 0 : out.kgProduced || 0,
    previousBags: out.bagsProduced,
    previousKg: out.kgProduced,
    remainingBags: out.bagsRemaining,
    remainingKg: out.kgRemaining,
  }));

  const paymentMethodLabel =
    inv?.payment_method === "cash"
      ? "نقداً"
      : inv?.payment_method === "credit"
        ? "آجل"
        : inv?.payment_method === "card"
          ? "بطاقة/شبكة"
          : inv?.payment_method === "bank_transfer"
            ? "تحويل بنكي"
            : inv?.payment_method === "mobile_money"
              ? "محفظة إلكترونية"
              : "نقداً";

  return {
    stage:
      stage ||
      (details.status === "DELIVERED"
        ? "delivery"
        : details.status === "PROCESSED"
          ? "milled"
          : "intake"),
    ticketNumber: details.document_number,
    invoiceNumber: inv?.invoice_number || undefined,
    customerName: details.customers?.name || "عميل أمانة",
    customerPhone: details.customers?.phone || undefined,
    warehouseName: details.warehouses?.name_ar || details.warehouses?.name || "المستودع الرئيسي",
    createdAt: details.received_at || new Date().toISOString(),
    grainType: grain?.nameAr || "—",
    // P1-5: لا نختلق «طحن ناعم قياسي» ولا «أكياس العميل» — تُعرض فقط إن سجّلها
    // المستند. القيم الافتراضية القديمة كانت تظهر في إعادة الطباعة كأنها بيانات.
    millingTypeLabel: (details as { milling_type?: string | null }).milling_type || undefined,
    bagCount,
    bagSizeKg,
    totalWeightKg,
    bagsSourceLabel: undefined,
    items,
    millingFeeTotal: subtotal || grandTotal,
    packagingTotal: 0,
    discount,
    grandTotal,
    paidAmount,
    remainingAmount,
    paymentMethodLabel,
    notes: (details as any).notes || undefined,
    companyName: company.legalName || company.name || undefined,
    companyAddress: company.address || undefined,
    companyPhone: company.phone || company.contacts[0] || undefined,
  };
}

/**
 * تحويل UnifiedDocumentData إلى هيكل تذكرة المطحنة عند استخدامه من قوالب أخرى.
 */
export function unifiedDocToTicketData(doc: UnifiedDocumentData): UnifiedTicketPrintData {
  const company = getCachedCompanyProfile();
  const subtotal = Number(doc.subtotal ?? doc.total ?? 0);
  const discount = Number(doc.discount ?? 0);
  const grandTotal = Number(doc.total ?? Math.max(0, subtotal - discount));
  const paidAmount = Number(doc.paid ?? 0);
  const remainingAmount = Number(doc.balance ?? Math.max(0, grandTotal - paidAmount));

  const grainLine = doc.lines.find(
    (l) => l.product.includes("حبوب") || l.product.includes("قمح") || l.price === 0,
  );
  const serviceLine = doc.lines.find(
    (l) => l.product.includes("أجور") || l.product.includes("طحن") || (l.price && l.price > 0),
  );

  const bagCount = grainLine?.qty || serviceLine?.qty || 1;
  const bagSizeKg = grainLine?.remainingKg ? Math.round(grainLine.remainingKg / bagCount) : 50;
  const totalWeightKg = grainLine?.currentKg || bagCount * bagSizeKg;

  const isDelivery = doc.docType === "delivery_note";

  return {
    stage: isDelivery ? "delivery" : "intake",
    ticketNumber: doc.number,
    invoiceNumber: doc.relatedRef?.replace(/[^0-9A-Za-z-]/g, "") || undefined,
    customerName: doc.partyName || "عميل أمانة",
    customerPhone: doc.partyPhone || undefined,
    warehouseName: doc.warehouse || "المستودع الرئيسي",
    createdAt: doc.date || new Date().toISOString(),
    grainType: grainLine?.product.replace(/حبوب مستلمة:?\s*/, "") || "—",
    millingTypeLabel: undefined,
    bagCount,
    bagSizeKg,
    totalWeightKg,
    bagsSourceLabel: undefined,
    items: doc.lines.map((l) => ({
      name: l.product,
      bags: l.qty,
      bagSizeKg: l.remainingKg && l.qty ? Math.round(l.remainingKg / l.qty) : 50,
      kg: l.currentKg || l.qty * 50,
      previousBags: l.previousQty,
      previousKg: l.previousKg,
      remainingBags: l.remainingQty,
      remainingKg: l.remainingKg,
      note: l.note,
    })),
    millingFeeTotal: subtotal,
    packagingTotal: 0,
    discount,
    grandTotal,
    paidAmount,
    remainingAmount,
    paymentMethodLabel: doc.payment || "نقداً",
    notes: doc.notes,
    companyName:
      doc.company?.legalName ||
      doc.company?.name ||
      company.legalName ||
      company.name ||
      undefined,
    companyAddress: doc.company?.address || company.address || undefined,
    companyPhone: doc.company?.phone || company.phone || company.contacts[0] || undefined,
  };
}

export function UnifiedPrintModal({
  open,
  onClose,
  data: initialData,
  details,
  doc,
  stage = "intake",
}: UnifiedPrintModalProps) {
  const [paperFormat, setPaperFormat] = useState<"thermal" | "a4" | "a5">("thermal");
  const [thermalWidth, setThermalWidth] = useState<ThermalWidth>("80mm");
  const [a4Zoom, setA4Zoom] = useState<number>(100);
  const [copied, setCopied] = useState<boolean>(false);
  const [isPrinting, setIsPrinting] = useState<boolean>(false);

  const company = getCachedCompanyProfile();

  const data: UnifiedTicketPrintData | null = useMemo(() => {
    if (initialData) {
      return {
        ...initialData,
        companyName:
          initialData.companyName || company.legalName || company.name || undefined,
        companyAddress: initialData.companyAddress || company.address || undefined,
        companyPhone: initialData.companyPhone || company.phone || company.contacts[0] || undefined,
      };
    }
    if (details) return documentDetailsToTicketData(details, stage);
    if (doc) return unifiedDocToTicketData(doc);
    return null;
  }, [initialData, details, doc, stage, company]);
  const previewHtml = useMemo(
    () => (data ? renderMillingWithUnifiedTemplate(data, paperFormat, thermalWidth) : ""),
    [data, paperFormat, thermalWidth],
  );

  if (!open || !data) return null;

  const currentStage = data.stage || stage;
  const isDelivery = currentStage === "delivery";
  const isMilled = currentStage === "milled";
  const isIntake = !isDelivery && !isMilled;

  const handlePrint = () => {
    setIsPrinting(true);
    printUnifiedTicket(data, paperFormat, thermalWidth);
    setTimeout(() => setIsPrinting(false), 800);
  };

  const handleCopyTicket = () => {
    navigator.clipboard.writeText(data.ticketNumber);
    setCopied(true);
    toast.success(`تم نسخ الرقم: ${data.ticketNumber}`);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleWhatsAppShare = () => {
    const bagSize =
      data.bagSizeKg ||
      (data.bagCount && data.totalWeightKg ? Math.round(data.totalWeightKg / data.bagCount) : 50);

    const phone = (data.customerPhone || "").replace(/[^0-9]/g, "");

    let msg = `*${data.companyName || ""}*\n`;
    msg += `━━━━━━━━━━━━━━━\n`;
    if (isDelivery) {
      msg += `📄 *سند تسليم نواتج أمانات*\n`;
      msg += `🔢 رقم السند: ${data.ticketNumber}\n`;
      msg += `👤 العميل: ${data.customerName}\n`;
      msg += `📅 التاريخ: ${new Date(data.createdAt).toLocaleDateString("ar-EG")}\n`;
      if (data.items && data.items.length > 0) {
        msg += `📦 *النواتج المسلمة:*\n`;
        data.items.forEach((it) => {
          msg += `• ${it.name}: ${it.bags} كيس (${it.kg.toLocaleString()} كجم)\n`;
          if (it.remainingBags !== undefined) {
            msg += `  (المتبقي طرفنا: ${it.remainingBags} كيس)\n`;
          }
        });
      }
    } else if (isMilled) {
      msg += `⚙️ *سند طحن وتشغيل أمانات*\n`;
      msg += `🔢 رقم السند: ${data.ticketNumber}\n`;
      msg += `👤 العميل: ${data.customerName}\n`;
      msg += `🌾 الحبوب: ${data.grainType} (${data.bagCount} كيس — ${(data.totalWeightKg || 0).toLocaleString()} كجم)\n`;
    } else {
      msg += `🧾 *فاتورة وإيصال استلام وطحن*\n`;
      msg += `🔢 رقم الفاتورة: ${data.ticketNumber}\n`;
      if (data.invoiceNumber) msg += `📋 فاتورة رسمية: #${data.invoiceNumber}\n`;
      msg += `👤 العميل: ${data.customerName}\n`;
      msg += `📅 التاريخ: ${new Date(data.createdAt).toLocaleDateString("ar-EG")}\n`;
      msg += `🌾 نوع الحبوب: ${data.grainType || "قمح بلدي"}\n`;
      msg += `⚖️ الأكياس والوزن: ${data.bagCount} كيس × ${bagSize} كجم (${(data.totalWeightKg || 0).toLocaleString()} كجم)\n`;
      msg += `💰 الإجمالي المستحق: ${data.grandTotal.toLocaleString()} ر.ي\n`;
      msg += `💵 المدفوع: ${data.paidAmount.toLocaleString()} ر.ي\n`;
      if (data.remainingAmount > 0) {
        msg += `⚠️ المتبقي ذمة: ${data.remainingAmount.toLocaleString()} ر.ي\n`;
      }
    }
    msg += `━━━━━━━━━━━━━━━\n`;
    msg += `شكراً لتعاملكم معنا — نسعد بخدمتكم دائماً ✨`;

    const url = phone
      ? `https://wa.me/${phone}?text=${encodeURIComponent(msg)}`
      : `https://wa.me/?text=${encodeURIComponent(msg)}`;

    window.open(url, "_blank");
  };

  const badgeTitle = isDelivery
    ? "سند تسليم نواتج أمانات"
    : isMilled
      ? "سند تشغيل وطحن أمانات"
      : "فاتورة وإيصال طحن فوري";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-0 sm:p-4 overflow-hidden animate-in fade-in duration-200">
      <div className="relative w-full h-full sm:h-auto sm:max-h-[94vh] max-w-4xl sm:rounded-3xl border-0 sm:border border-border/80 bg-card shadow-2xl flex flex-col overflow-hidden">
        {/* Header المتكيف بالكامل للجوال واللابتوب */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 border-b border-border/80 px-4 sm:px-6 py-3.5 bg-muted/40 shrink-0">
          {/* عنوان المستند والأيقونة ورقم السند */}
          <div className="flex items-center justify-between sm:justify-start gap-3">
            <div className="flex items-center gap-2.5">
              <div className="p-2 sm:p-2.5 rounded-2xl bg-amber-500/15 text-amber-600 dark:text-amber-400 shrink-0">
                <Scale className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-sm sm:text-base font-black text-foreground tracking-tight flex items-center gap-2">
                  <span>
                    {isDelivery ? "سند تسليم نواتج المطحنة" : "فاتورة وإيصال الطحن الموحد"}
                  </span>
                </h3>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <span className="text-[11px] text-muted-foreground font-mono font-bold">
                    {data.ticketNumber}
                  </span>
                  <button
                    type="button"
                    onClick={handleCopyTicket}
                    title="نسخ الرقم"
                    className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                  >
                    {copied ? (
                      <Check className="h-3 w-3 text-emerald-600" />
                    ) : (
                      <Copy className="h-3 w-3" />
                    )}
                  </button>
                </div>
              </div>
            </div>

            {/* زر الإغلاق السريع في الشاشات الصغيرة */}
            <button
              type="button"
              onClick={onClose}
              className="sm:hidden p-2 rounded-xl text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-colors"
              aria-label="إغلاق"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* محدد القوالب والأحجام (Segmented Switcher) */}
          <div className="flex items-center justify-between sm:justify-end gap-2">
            <div className="flex items-center p-1 rounded-2xl bg-muted/80 border border-border/70 shadow-xs">
              <button
                type="button"
                onClick={() => setPaperFormat("thermal")}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                  paperFormat === "thermal"
                    ? "bg-background text-foreground shadow-xs scale-[1.02]"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Smartphone className="h-3.5 w-3.5" />
                <span>طابعة حرارية</span>
              </button>
              <button
                type="button"
                onClick={() => setPaperFormat("a4")}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                  paperFormat === "a4"
                    ? "bg-background text-foreground shadow-xs scale-[1.02]"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <FileText className="h-3.5 w-3.5" />
                <span>صفحة رسمية (A4)</span>
              </button>
              <button
                type="button"
                onClick={() => setPaperFormat("a5")}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                  paperFormat === "a5"
                    ? "bg-background text-foreground shadow-xs scale-[1.02]"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <FileText className="h-3.5 w-3.5" />
                <span>A5</span>
              </button>
            </div>

            {/* أدوات إضافية للأحجام أو التكبير */}
            {paperFormat === "thermal" ? (
              <div className="hidden sm:flex items-center p-1 rounded-xl bg-muted/60 border border-border/60 text-[11px] font-bold">
                <button
                  type="button"
                  onClick={() => setThermalWidth("80mm")}
                  className={`px-2 py-0.5 rounded-lg transition-all ${
                    thermalWidth === "80mm"
                      ? "bg-background text-foreground shadow-xs"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  80مم
                </button>
                <button
                  type="button"
                  onClick={() => setThermalWidth("58mm")}
                  className={`px-2 py-0.5 rounded-lg transition-all ${
                    thermalWidth === "58mm"
                      ? "bg-background text-foreground shadow-xs"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  58مم
                </button>
              </div>
            ) : (
              <div className="hidden sm:flex items-center gap-1 bg-muted/60 p-1 rounded-xl border border-border/60">
                <button
                  type="button"
                  onClick={() => setA4Zoom((z) => Math.max(60, z - 15))}
                  className="p-1 rounded text-muted-foreground hover:text-foreground"
                  title="تصغير"
                >
                  <ZoomOut className="h-3.5 w-3.5" />
                </button>
                <span className="text-[10px] font-mono font-bold px-1">{a4Zoom}%</span>
                <button
                  type="button"
                  onClick={() => setA4Zoom((z) => Math.min(140, z + 15))}
                  className="p-1 rounded text-muted-foreground hover:text-foreground"
                  title="تكبير"
                >
                  <ZoomIn className="h-3.5 w-3.5" />
                </button>
              </div>
            )}

            {/* زر الإغلاق للشاشات الكبيرة */}
            <button
              type="button"
              onClick={onClose}
              className="hidden sm:inline-flex p-2 rounded-xl text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-colors"
              aria-label="إغلاق"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* نفس مستند HTML الموحد يُستخدم في المعاينة والطباعة، بما يشمل الباركود وQR وملف المنشأة. */}
        <div className="flex-1 min-h-0 overflow-auto p-3 sm:p-6 bg-slate-950/5 dark:bg-slate-900/30">
          <div className="mx-auto flex justify-center">
            <iframe
              title="معاينة طباعة مستند المطحنة"
              srcDoc={previewHtml}
              className="max-w-full rounded-xl border border-slate-200 bg-white shadow-xl"
              style={{
                width: paperFormat !== "thermal" ? (paperFormat === "a5" ? "560px" : "760px") : thermalWidth === "58mm" ? "260px" : "340px",
                height: paperFormat !== "thermal" ? `${Math.round((paperFormat === "a5" ? 790 : 1050) * a4Zoom / 100)}px` : "820px",
              }}
              sandbox="allow-same-origin"
            />
          </div>
        </div>

        {/* الشريط السفلي الاحترافي للأزرار والإجراءات السريعة (Footer Actions) */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/80 px-4 sm:px-6 py-3.5 bg-card/95 backdrop-blur-xs shrink-0">
          {/* رسالة التأكيد والتحقق */}
          <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
            <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
            <span className="hidden sm:inline">
              تم تسجيل العملية وإصدار الفاتورة وتحديث الإيرادات بنجاح
            </span>
            <span className="sm:hidden">تم التوثيق وتحديث الإيرادات</span>
          </div>

          {/* أزرار الإجراءات الفورية */}
          <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
            {/* زر المشاركة عبر واتساب بلمسة واحدة */}
            <Button
              type="button"
              variant="outline"
              onClick={handleWhatsAppShare}
              className="rounded-xl px-3.5 py-2 text-xs font-bold gap-1.5 border-emerald-500/30 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/10 active:scale-95 transition-all shadow-xs"
              title="إرسال الفاتورة عبر واتساب"
            >
              <WhatsAppIcon className="h-4 w-4" />
              <span className="hidden xs:inline">واتساب</span>
            </Button>

            {/* زر الإغلاق */}
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              className="rounded-xl px-4 py-2 text-xs font-bold active:scale-95 transition-all"
            >
              إغلاق
            </Button>

            {/* زر الطباعة الفورية البارز مع أنيميشن ولمسة أنيقة */}
            <Button
              type="button"
              onClick={handlePrint}
              disabled={isPrinting}
              className="rounded-xl px-5 py-2 text-xs font-black gap-2 bg-primary text-primary-foreground shadow-md shadow-primary/20 hover:bg-primary/95 active:scale-95 transition-all"
            >
              <Printer className="h-4 w-4 shrink-0" />
              <span>
                طباعة فورية ({paperFormat === "thermal" ? thermalWidth.replace("mm", " مم") : paperFormat.toUpperCase()})
              </span>
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Use the shared invoice renderer for mill documents so paper, barcode/QR,
 * company profile and the rights footer follow the same print settings as invoices. */
export function renderMillingWithUnifiedTemplate(
  data: UnifiedTicketPrintData,
  paper: "thermal" | "a4" | "a5",
  thermalWidth: ThermalWidth = "80mm",
): string {
  const settings = getPrintSettings();
  const isDelivery = data.stage === "delivery";
  const isMilled = data.stage === "milled";
  const lines = data.items?.length
    ? data.items.map((item) => ({
        product: item.name, qty: item.bags, unit: "كيس",
        previousQty: item.previousBags, remainingQty: item.remainingBags,
        previousKg: item.previousKg, remainingKg: item.remainingKg, currentKg: item.kg, note: item.note,
      }))
    : [{
        product: data.grainType || (isMilled ? "عملية طحن" : "حبوب مستلمة"),
        qty: data.bagCount || 0, unit: "كيس",
        currentKg: data.totalWeightKg,
      }];
  const doc: UnifiedDocumentData = {
    docType: isDelivery ? "delivery_note" : "customer_invoice",
    title: isDelivery ? "سند تسليم نواتج المطحنة" : isMilled ? "سند طحن وتشغيل" : "فاتورة طحن",
    number: data.ticketNumber, relatedRef: data.invoiceNumber, date: data.createdAt,
    partyLabel: "العميل", partyName: data.customerName || undefined, partyPhone: data.customerPhone,
    warehouse: data.warehouseName, movementType: data.grainType,
    payment: data.paymentMethodLabel, subtotal: data.millingFeeTotal ?? data.grandTotal,
    discount: data.discount, total: data.grandTotal, paid: data.paidAmount, balance: data.remainingAmount,
    currency: "ر.ي", notes: data.notes, lines,
    company: { name: data.companyName, legalName: data.companyName, address: data.companyAddress, phone: data.companyPhone },
    options: {
      showBarcode: settings.showBarcode !== false, showQrCode: settings.showQrCode !== false,
      showSignatures: settings.showSignatures === true, showCompanyInfo: settings.showCompanyInfo !== false,
      showLogo: settings.showLogo !== false,
    },
  };
  const profileId = paper === "a4" ? "a4" : paper === "a5" ? "a5" : thermalWidth === "58mm" ? "thermal-58" : "thermal-80";
  return renderDocumentHTML(
    doc, "standard", { invoice: doc.title, billTo: "العميل", thanks: "تمت العملية بنجاح" }, true,
    { ...doc.options, paperSize: paper === "a4" ? "A4" : paper === "a5" ? "A5" : thermalWidth }, profileId,
  );
}

/**
 * دالة الطباعة السريعة غير الحاجبة عبر Hidden Iframe.
 */
export function printUnifiedTicket(
  data: UnifiedTicketPrintData,
  paper: "thermal" | "a4" | "a5",
  thermalWidth: ThermalWidth = "80mm",
): void {
  const iframe = document.createElement("iframe");
  iframe.style.position = "fixed";
  iframe.style.right = "0";
  iframe.style.bottom = "0";
  iframe.style.width = "0";
  iframe.style.height = "0";
  iframe.style.border = "0";
  document.body.appendChild(iframe);

  const doc = iframe.contentWindow?.document;
  if (!doc) return;

  const html = renderMillingWithUnifiedTemplate(data, paper, thermalWidth);

  doc.open();
  doc.write(html);
  doc.close();

  iframe.contentWindow?.focus();
  setTimeout(() => {
    iframe.contentWindow?.print();
    setTimeout(() => {
      if (document.body.contains(iframe)) {
        document.body.removeChild(iframe);
      }
    }, 1500);
  }, 250);
}

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
  Maximize2,
  Smartphone,
  Monitor,
  Share2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { WhatsAppIcon } from "@/components/whatsapp-icon";
import { getCachedCompanyProfile } from "@/lib/printing/company-profile";
import { numberToArabicWords } from "@/lib/templates/tafqeet";
import { generateBarcodeSvg, generateQrCodeSvg } from "@/lib/printing/barcode-qr";
import type { MillingDocumentDetails } from "@/lib/milling";
import type { UnifiedDocumentData } from "@/lib/templates/types";
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
    companyName: company.legalName || company.name || "مطحنة الحبوب الحديثة",
    companyAddress: company.address || "المركز الرئيسي",
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
      "مطحنة الحبوب الحديثة",
    companyAddress: doc.company?.address || company.address || "المركز الرئيسي",
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
  const [paperFormat, setPaperFormat] = useState<"thermal" | "a4">("thermal");
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
          initialData.companyName || company.legalName || company.name || "مطحنة الحبوب الحديثة",
        companyAddress: initialData.companyAddress || company.address || "المركز الرئيسي",
        companyPhone: initialData.companyPhone || company.phone || company.contacts[0] || undefined,
      };
    }
    if (details) return documentDetailsToTicketData(details, stage);
    if (doc) return unifiedDocToTicketData(doc);
    return null;
  }, [initialData, details, doc, stage, company]);

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

    let msg = `*${data.companyName || "مطحنة الحبوب الحديثة"}*\n`;
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

  const qrPayload = [
    `مطحنة: ${data.companyName || "المطحنة الحديثة"}`,
    `رقم: ${data.ticketNumber}`,
    `العميل: ${data.customerName}`,
    `التاريخ: ${new Date(data.createdAt).toLocaleDateString("ar-EG")}`,
    `الإجمالي: ${data.grandTotal} ر.ي`,
  ].join("\n");

  const qrSvg = generateQrCodeSvg(qrPayload, 84);
  const barcodeSvg = generateBarcodeSvg(data.ticketNumber, 32);

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

        {/* مساحة المعاينة التفاعلية المرنة (Scrollable Preview Canvas) */}
        <div className="flex-1 overflow-y-auto p-3 sm:p-6 bg-slate-950/5 dark:bg-slate-900/30 flex justify-center items-start">
          {paperFormat === "thermal" ? (
            /* بطاقة الإيصال الحراري الواقعية الأنيقة (Thermal Receipt Card) */
            <div
              className={`bg-white text-slate-900 rounded-3xl p-5 sm:p-6 shadow-xl border border-slate-200/90 font-sans text-xs space-y-4 my-2 transition-all ${
                thermalWidth === "58mm" ? "w-[260px]" : "w-[340px] max-w-full"
              }`}
            >
              {/* ترويسة المنشأة والشعار */}
              <div className="text-center space-y-1 border-b border-dashed border-slate-300 pb-3">
                <div className="text-base sm:text-lg font-black tracking-tight text-slate-950">
                  {data.companyName || "مطحنة الحبوب الحديثة"}
                </div>
                <div className="text-[11px] text-slate-600">
                  {data.companyAddress || "المركز الرئيسي"}
                </div>
                {data.companyPhone && (
                  <div className="text-[11px] font-mono text-slate-700 font-semibold">
                    هاتف: {data.companyPhone}
                  </div>
                )}
                <div className="mt-2 inline-block rounded-full bg-slate-950 text-white px-3.5 py-1 text-[10.5px] font-black tracking-wide shadow-xs">
                  {badgeTitle}
                </div>
              </div>

              {/* بيانات السند والفاتورة والعميل */}
              <div className="space-y-1.5 text-[11px] border-b border-dashed border-slate-300 pb-3">
                <div className="flex justify-between items-center">
                  <span className="text-slate-500 font-medium">
                    {isDelivery ? "رقم السند:" : "رقم الفاتورة:"}
                  </span>
                  <span className="font-black font-mono text-slate-900 text-xs">
                    {data.ticketNumber}
                  </span>
                </div>
                {data.invoiceNumber && isIntake && (
                  <div className="flex justify-between items-center">
                    <span className="text-slate-500 font-medium">فاتورة المبيعات:</span>
                    <span className="font-mono font-bold text-slate-800">
                      #{data.invoiceNumber}
                    </span>
                  </div>
                )}
                <div className="flex justify-between items-center">
                  <span className="text-slate-500 font-medium">التاريخ:</span>
                  <span className="font-semibold text-slate-700">
                    {new Date(data.createdAt).toLocaleDateString("ar-EG")}{" "}
                    {new Date(data.createdAt).toLocaleTimeString("ar-EG", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-slate-500 font-medium">العميل:</span>
                  <span className="font-black text-slate-950">{data.customerName}</span>
                </div>
                {data.customerPhone && (
                  <div className="flex justify-between items-center">
                    <span className="text-slate-500 font-medium">الهاتف:</span>
                    <span className="font-mono font-bold text-slate-800">{data.customerPhone}</span>
                  </div>
                )}
              </div>

              {/* تفاصيل عملية الطحن أو الاستلام أو التسليم */}
              {isIntake ? (
                /* الاستلام والأكياس والسعة (حل مشكلة 20 كيس سعة 50 والإجمالي) */
                <div className="space-y-2 border-b border-dashed border-slate-300 pb-3">
                  <div className="font-black text-slate-900 text-[11.5px] flex items-center justify-between">
                    <span>تفاصيل عملية الطحن:</span>
                    <span className="text-[10px] bg-amber-100 text-amber-800 px-2 py-0.5 rounded-md font-bold">
                      أمانة عينية
                    </span>
                  </div>
                  <div className="bg-slate-50/90 p-3 rounded-2xl border border-slate-200/80 space-y-1.5 text-[11px]">
                    <div className="flex justify-between items-center">
                      <span className="text-slate-600">نوع الحبوب:</span>
                      <span className="font-black text-slate-950">{data.grainType}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-slate-600">درجة الطحن:</span>
                      <span className="font-bold text-amber-700">
                        {data.millingTypeLabel || "حسب الاتفاق"}
                      </span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-slate-600">الكمية والأكياس:</span>
                      <span className="font-black text-slate-900 font-mono">
                        {data.bagCount} كيس × {data.bagSizeKg || 50} كجم
                      </span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-slate-600">الوزن الصافي:</span>
                      <span className="font-black text-slate-950 font-mono text-xs">
                        {(data.totalWeightKg || 0).toLocaleString()} كجم
                      </span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-slate-600">مصدر الأكياس:</span>
                      <span className="font-bold text-slate-800">
                        {data.bagsSourceLabel || "أكياس العميل"}
                      </span>
                    </div>
                  </div>
                </div>
              ) : isDelivery ? (
                /* شاشة تسليم نواتج الأمانات */
                <div className="space-y-2 border-b border-dashed border-slate-300 pb-3">
                  <div className="font-black text-slate-900 text-[11.5px]">
                    تفاصيل نواتج الطحن المسلمة:
                  </div>
                  <div className="space-y-2">
                    {(data.items && data.items.length > 0
                      ? data.items
                      : [
                          {
                            name: data.grainType || "نواتج طحن",
                            bags: data.bagCount || 0,
                            kg: data.totalWeightKg || 0,
                            previousBags: data.bagCount,
                            remainingBags: 0,
                          },
                        ]
                    ).map((it, idx) => (
                      <div
                        key={idx}
                        className="bg-slate-50 p-2.5 rounded-2xl border border-slate-200/80 space-y-1.5 text-[11px]"
                      >
                        <div className="flex justify-between items-center font-black text-slate-900">
                          <span>{it.name}</span>
                          <span className="text-emerald-700 font-mono">
                            {it.bags} كيس ({it.kg.toLocaleString()} كجم)
                          </span>
                        </div>
                        {it.previousBags !== undefined && (
                          <div className="flex justify-between text-[10.5px] text-slate-600 pt-1 border-t border-slate-200">
                            <span>السابق: {it.previousBags} كيس</span>
                            <span className="text-amber-800 font-black">
                              المتبقي طرفنا: {it.remainingBags ?? 0} كيس
                            </span>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                /* شاشة الطحن والتشغيل */
                <div className="space-y-2 border-b border-dashed border-slate-300 pb-3">
                  <div className="font-black text-slate-900 text-[11.5px]">
                    تفاصيل الحبوب المطحونة والنواتج:
                  </div>
                  <div className="bg-slate-50 p-2.5 rounded-2xl border border-slate-200/80 space-y-1 text-[11px]">
                    <div className="flex justify-between font-black text-slate-900">
                      <span>الحبوب المستهلكة:</span>
                      <span className="font-mono">
                        {data.bagCount} كيس ({data.totalWeightKg?.toLocaleString()} كجم)
                      </span>
                    </div>
                  </div>
                  {data.items && data.items.length > 0 && (
                    <div className="space-y-1.5 mt-1">
                      <div className="text-[10.5px] font-bold text-slate-600">
                        النواتج المستخرجة:
                      </div>
                      {data.items.map((it, idx) => (
                        <div
                          key={idx}
                          className="flex justify-between text-[11px] bg-slate-50/70 p-2 rounded-xl border border-slate-100"
                        >
                          <span className="font-bold text-slate-900">{it.name}</span>
                          <span className="font-black font-mono text-emerald-700">
                            {it.bags} كيس ({it.kg.toLocaleString()} كجم)
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                  {data.lossKg !== undefined && data.lossKg > 0 && (
                    <div className="flex justify-between text-[11px] text-rose-700 font-bold px-1 pt-1">
                      <span>الفاقد التشغيلي:</span>
                      <span className="font-mono">{data.lossKg} كجم</span>
                    </div>
                  )}
                </div>
              )}

              {/* التفاصيل المالية الواضحة */}
              {(!isDelivery || (data.remainingAmount > 0 && isDelivery)) && (
                <div className="space-y-1.5 text-[11px] border-b border-dashed border-slate-300 pb-3">
                  {data.millingFeeTotal !== undefined && (
                    <div className="flex justify-between text-slate-600">
                      <span>أجرة خدمة الطحن:</span>
                      <span className="font-mono font-bold text-slate-900">
                        {data.millingFeeTotal.toLocaleString()} ر.ي
                      </span>
                    </div>
                  )}
                  {data.packagingTotal !== undefined && data.packagingTotal > 0 && (
                    <div className="flex justify-between text-slate-600">
                      <span>مستلزمات تعبئة وأكياس:</span>
                      <span className="font-mono font-bold text-slate-900">
                        {data.packagingTotal.toLocaleString()} ر.ي
                      </span>
                    </div>
                  )}
                  {(data.discount || 0) > 0 && (
                    <div className="flex justify-between text-emerald-700 font-semibold">
                      <span>الخصم الممنوح:</span>
                      <span className="font-mono">-{data.discount?.toLocaleString()} ر.ي</span>
                    </div>
                  )}
                  <div className="flex justify-between pt-1.5 border-t border-slate-300 text-sm font-black text-slate-950">
                    <span>الإجمالي المستحق:</span>
                    <span className="font-mono text-base font-black">
                      {data.grandTotal.toLocaleString()} ر.ي
                    </span>
                  </div>
                  <div className="flex justify-between text-slate-700 font-semibold">
                    <span>المدفوع ({data.paymentMethodLabel || "نقداً"}):</span>
                    <span className="font-mono font-black text-emerald-700">
                      {data.paidAmount.toLocaleString()} ر.ي
                    </span>
                  </div>
                  {data.remainingAmount > 0 && (
                    <div className="flex justify-between text-rose-700 font-bold bg-rose-50 px-2 py-1 rounded-lg border border-rose-200">
                      <span>المتبقي ذمة:</span>
                      <span className="font-mono font-black">
                        {data.remainingAmount.toLocaleString()} ر.ي
                      </span>
                    </div>
                  )}
                </div>
              )}

              {/* الباركود و QR Code المعاينة */}
              <div className="flex items-center justify-between gap-2 pt-1 border-b border-dashed border-slate-300 pb-3">
                <div
                  className="shrink-0 flex items-center justify-center p-1 bg-white border border-slate-200 rounded-xl"
                  dangerouslySetInnerHTML={{ __html: qrSvg }}
                />
                <div
                  className="flex-1 flex flex-col items-center justify-center overflow-hidden"
                  dangerouslySetInnerHTML={{ __html: barcodeSvg }}
                />
              </div>

              {/* التذييل النهائي */}
              <div className="text-center pt-1 text-[10.5px] text-slate-600 space-y-1">
                <p className="font-medium">
                  {isDelivery
                    ? "تم تسليم نواتج الأمانات للعميل بحالة ممتازة بموجب إذن الصرف المعتمد."
                    : isMilled
                      ? "تم إتمام عملية الطحن وإثبات النواتج في حساب أمانات العميل."
                      : "تم استلام الحبوب وطحنها وتسليم النواتج بحالة ممتازة."}
                </p>
                <p className="font-black text-slate-950 text-xs">
                  شكرًا لتعاملكم معنا — نسعد بخدمتكم دائماً
                </p>
              </div>
            </div>
          ) : (
            /* معاينة الصفحة الرسمية الفاخرة (A4 / A5 Official Sheet) */
            <div
              style={{ transform: `scale(${a4Zoom / 100})`, transformOrigin: "top center" }}
              className="w-full max-w-[760px] bg-white text-slate-900 rounded-3xl p-6 sm:p-10 shadow-xl border border-slate-200 font-sans space-y-6 my-2 transition-transform duration-150"
            >
              {/* ترويسة الصفحة الرسمية المعتمدة */}
              <div className="flex justify-between items-start border-b-2 border-slate-900 pb-6">
                <div>
                  <h2 className="text-2xl font-black text-slate-950 tracking-tight">
                    {data.companyName || "مطحنة الحبوب المتقدمة"}
                  </h2>
                  <p className="text-xs text-slate-600 mt-1 font-medium">
                    {data.companyAddress || "صنعاء — المركز الرئيسي"}
                  </p>
                  {data.companyPhone && (
                    <p className="text-xs text-slate-600 font-mono mt-0.5">
                      هاتف: {data.companyPhone}
                    </p>
                  )}
                </div>
                <div className="text-left space-y-1">
                  <div className="inline-block rounded-xl bg-amber-500/15 text-amber-800 border border-amber-300 px-3.5 py-1 text-xs font-black">
                    {isDelivery
                      ? "سند تسليم نواتج أمانات"
                      : isMilled
                        ? "سند طحن وتشغيل أمانات"
                        : "فاتورة وسند طحن وتسليم"}
                  </div>
                  <p className="text-sm font-mono font-black text-slate-950 tracking-wider">
                    {data.ticketNumber}
                  </p>
                  <p className="text-xs text-slate-500 font-medium">
                    {new Date(data.createdAt).toLocaleDateString("ar-EG")}
                  </p>
                </div>
              </div>

              {/* بيانات العميل والمستودع */}
              <div className="grid grid-cols-2 gap-4 bg-slate-50 p-4 rounded-2xl border border-slate-200/80 text-xs">
                <div>
                  <span className="text-slate-500 font-medium">اسم العميل:</span>
                  <span className="font-black text-slate-950 ms-2">{data.customerName}</span>
                </div>
                <div>
                  <span className="text-slate-500 font-medium">رقم الهاتف:</span>
                  <span className="font-mono font-bold text-slate-900 ms-2">
                    {data.customerPhone || "—"}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 font-medium">المستودع:</span>
                  <span className="font-bold text-slate-900 ms-2">
                    {data.warehouseName || "المستودع الرئيسي"}
                  </span>
                </div>
                {data.invoiceNumber && (
                  <div>
                    <span className="text-slate-500 font-medium">فاتورة المبيعات:</span>
                    <span className="font-mono font-black text-slate-900 ms-2">
                      #{data.invoiceNumber}
                    </span>
                  </div>
                )}
              </div>

              {/* جدول البنود الرسمي */}
              {isDelivery ? (
                <div className="border border-slate-200 rounded-2xl overflow-hidden shadow-xs">
                  <table className="w-full text-xs text-right">
                    <thead className="bg-slate-100 text-slate-800 font-black border-b border-slate-200">
                      <tr>
                        <th className="p-3">ناتج الطحن</th>
                        <th className="p-3 text-center">الرصيد السابق</th>
                        <th className="p-3 text-center">الكمية المسلمة</th>
                        <th className="p-3 text-center">الوزن المسلم</th>
                        <th className="p-3 text-center">الرصيد المتبقي</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {(data.items && data.items.length > 0
                        ? data.items
                        : [
                            {
                              name: data.grainType || "نواتج طحن",
                              bags: data.bagCount || 0,
                              kg: data.totalWeightKg || 0,
                              previousBags: data.bagCount,
                              remainingBags: 0,
                            },
                          ]
                      ).map((it, idx) => (
                        <tr key={idx} className={idx % 2 === 1 ? "bg-slate-50/50" : ""}>
                          <td className="p-3 font-black text-slate-950">{it.name}</td>
                          <td className="p-3 text-center font-mono text-slate-600">
                            {it.previousBags ?? "—"} كيس
                          </td>
                          <td className="p-3 text-center font-mono font-black text-emerald-700">
                            {it.bags} كيس
                          </td>
                          <td className="p-3 text-center font-mono font-black text-slate-900">
                            {it.kg.toLocaleString()} كجم
                          </td>
                          <td className="p-3 text-center font-mono text-amber-800 font-black">
                            {it.remainingBags ?? 0} كيس
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="border border-slate-200 rounded-2xl overflow-hidden shadow-xs">
                  <table className="w-full text-xs text-right">
                    <thead className="bg-slate-100 text-slate-800 font-black border-b border-slate-200">
                      <tr>
                        <th className="p-3">نوع الحبوب</th>
                        <th className="p-3">درجة ونوع الطحن</th>
                        <th className="p-3 text-center">الكمية والأكياس</th>
                        <th className="p-3 text-center">الوزن الصافي</th>
                        <th className="p-3">الأكياس المستخدمة</th>
                        <th className="p-3 text-left">المبلغ</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      <tr>
                        <td className="p-3 font-black text-slate-950">{data.grainType}</td>
                        <td className="p-3 text-amber-700 font-bold">
                          {data.millingTypeLabel || "—"}
                        </td>
                        <td className="p-3 text-center font-mono font-black">
                          {data.bagCount} كيس ({data.bagSizeKg || 50} كجم)
                        </td>
                        <td className="p-3 text-center font-mono font-black text-slate-950">
                          {(data.totalWeightKg || 0).toLocaleString()} كجم
                        </td>
                        <td className="p-3 font-medium text-slate-700">{data.bagsSourceLabel}</td>
                        <td className="p-3 text-left font-mono font-black text-slate-950">
                          {(data.millingFeeTotal || 0).toLocaleString()} ر.ي
                        </td>
                      </tr>
                      {data.packagingTotal !== undefined && data.packagingTotal > 0 && (
                        <tr>
                          <td colSpan={5} className="p-3 text-slate-600 font-medium">
                            مستلزمات تعبئة وأكياس المطحنة
                          </td>
                          <td className="p-3 text-left font-mono font-black">
                            {data.packagingTotal.toLocaleString()} ر.ي
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}

              {/* صندوق الحسابات والتفقيط */}
              {(!isDelivery || data.remainingAmount > 0) && (
                <div className="flex flex-col sm:flex-row justify-between items-start gap-4 pt-2">
                  <div className="max-w-xs space-y-1 text-xs">
                    <p className="font-bold text-slate-700">المبلغ كتابةً:</p>
                    <p className="bg-slate-50 p-2.5 rounded-xl border border-slate-200 text-slate-900 font-semibold leading-relaxed">
                      فقط {numberToArabicWords(data.grandTotal, "ريال يمني")} لا غير.
                    </p>
                  </div>
                  <div className="w-full sm:w-72 space-y-2 text-xs">
                    <div className="flex justify-between text-slate-600">
                      <span>المجموع الإجمالي:</span>
                      <span className="font-mono font-bold text-slate-900">
                        {(
                          (data.millingFeeTotal || 0) + (data.packagingTotal || 0)
                        ).toLocaleString()}{" "}
                        ر.ي
                      </span>
                    </div>
                    {(data.discount || 0) > 0 && (
                      <div className="flex justify-between text-emerald-700 font-bold">
                        <span>الخصم:</span>
                        <span className="font-mono">-{data.discount?.toLocaleString()} ر.ي</span>
                      </div>
                    )}
                    <div className="flex justify-between text-sm font-black text-slate-950 border-t-2 border-slate-900 pt-2">
                      <span>الصافي المطلوب:</span>
                      <span className="font-mono text-base font-black">
                        {data.grandTotal.toLocaleString()} ر.ي
                      </span>
                    </div>
                    <div className="flex justify-between text-emerald-700 font-bold">
                      <span>المدفوع:</span>
                      <span className="font-mono font-black">
                        {data.paidAmount.toLocaleString()} ر.ي
                      </span>
                    </div>
                    {data.remainingAmount > 0 && (
                      <div className="flex justify-between text-rose-700 font-bold">
                        <span>المتبقي ذمة:</span>
                        <span className="font-mono font-black">
                          {data.remainingAmount.toLocaleString()} ر.ي
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* التوقيعات الرسمية */}
              <div className="grid grid-cols-2 gap-8 pt-8 border-t border-slate-200 text-xs text-center text-slate-600 font-bold">
                <div className="space-y-8">
                  <p>توقيع مستلم الحبوب / النواتج</p>
                  <p className="border-b border-dashed border-slate-300 w-48 mx-auto"></p>
                </div>
                <div className="space-y-8">
                  <p>مشرف صالة المطحنة / الكاشير</p>
                  <p className="border-b border-dashed border-slate-300 w-48 mx-auto"></p>
                </div>
              </div>
            </div>
          )}
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
                طباعة فورية ({paperFormat === "thermal" ? thermalWidth.replace("mm", " مم") : "A4"})
              </span>
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * دالة الطباعة السريعة غير الحاجبة عبر Hidden Iframe.
 */
export function printUnifiedTicket(
  data: UnifiedTicketPrintData,
  paper: "thermal" | "a4",
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

  const html = paper === "thermal" ? renderThermalHtml(data, thermalWidth) : renderA4Html(data);

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

function renderThermalHtml(d: UnifiedTicketPrintData, width: ThermalWidth = "80mm"): string {
  const isDelivery = d.stage === "delivery";
  const isMilled = d.stage === "milled";
  const isIntake = !isDelivery && !isMilled;
  const bagSize =
    d.bagSizeKg || (d.bagCount && d.totalWeightKg ? Math.round(d.totalWeightKg / d.bagCount) : 50);

  const badgeTitle = isDelivery
    ? "سند تسليم نواتج أمانات"
    : isMilled
      ? "سند تشغيل وطحن أمانات"
      : "فاتورة وإيصال طحن فوري";

  const qrPayload = [
    `مطحنة: ${d.companyName || "المطحنة الحديثة"}`,
    `رقم: ${d.ticketNumber}`,
    `العميل: ${d.customerName}`,
    `التاريخ: ${new Date(d.createdAt).toLocaleDateString("ar-EG")}`,
    `الإجمالي: ${d.grandTotal} ر.ي`,
  ].join("\n");

  const qrSvg = generateQrCodeSvg(qrPayload, width === "58mm" ? 72 : 84);
  const barcodeSvg = generateBarcodeSvg(d.ticketNumber, width === "58mm" ? 28 : 34);

  const paperWidth = width === "58mm" ? "58mm" : "80mm";
  const bodyWidth = width === "58mm" ? "52mm" : "72mm";
  const fontSize = width === "58mm" ? "11px" : "12px";

  return `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="utf-8" />
  <title>فاتورة وإيصال طحن ${d.ticketNumber}</title>
  <style>
    @page { size: ${paperWidth} auto; margin: 0; }
    * { box-sizing: border-box; }
    body {
      font-family: system-ui, -apple-system, 'Segoe UI', Tahoma, sans-serif;
      width: ${bodyWidth};
      margin: 0 auto;
      padding: 10px 4px;
      font-size: ${fontSize};
      color: #000;
      background: #fff;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .center { text-align: center; }
    .bold { font-weight: bold; }
    .dashed { border-bottom: 1px dashed #444; margin: 8px 0; }
    .flex { display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; }
    .badge {
      display: inline-block;
      border: 1px solid #000;
      padding: 2px 10px;
      border-radius: 99px;
      font-weight: 800;
      font-size: 11px;
      margin: 4px 0;
      background: #000;
      color: #fff;
    }
    .box {
      background: #f3f4f6;
      border: 1px solid #e5e7eb;
      border-radius: 8px;
      padding: 6px 8px;
      margin: 6px 0;
    }
  </style>
</head>
<body>
  <div class="center">
    <div style="font-size: 16px; font-weight: 900;">${d.companyName || "مطحنة الحبوب الحديثة"}</div>
    <div style="font-size: 11px; color: #444;">${d.companyAddress || "المركز الرئيسي"}</div>
    ${d.companyPhone ? `<div style="font-size: 11px; font-weight: bold;">هاتف: ${d.companyPhone}</div>` : ""}
    <div class="badge">${badgeTitle}</div>
  </div>

  <div class="dashed"></div>
  <div class="flex"><span>${isDelivery ? "رقم السند:" : "رقم الفاتورة:"}</span><span class="bold" style="font-family: monospace;">${d.ticketNumber}</span></div>
  ${d.invoiceNumber && isIntake ? `<div class="flex"><span>فاتورة المبيعات:</span><span style="font-family: monospace;">#${d.invoiceNumber}</span></div>` : ""}
  <div class="flex"><span>التاريخ:</span><span>${new Date(d.createdAt).toLocaleDateString("ar-EG")} ${new Date(d.createdAt).toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit" })}</span></div>
  <div class="flex"><span>العميل:</span><span class="bold">${d.customerName}</span></div>
  ${d.customerPhone ? `<div class="flex"><span>الهاتف:</span><span style="font-family: monospace;">${d.customerPhone}</span></div>` : ""}
  <div class="dashed"></div>

  ${
    isIntake
      ? `
  <div class="bold" style="margin-bottom: 4px;">تفاصيل عملية الطحن:</div>
  <div class="box">
    <div class="flex"><span>نوع الحبوب:</span><span class="bold">${d.grainType || "قمح بلدي محلي"}</span></div>
    <div class="flex"><span>درجة الطحن:</span><span class="bold" style="color: #b45309;">${d.millingTypeLabel || "طحن ناعم قياسي"}</span></div>
    <div class="flex"><span>الكمية والأكياس:</span><span class="bold">${d.bagCount} كيس × ${bagSize} كجم</span></div>
    <div class="flex"><span>الوزن الصافي:</span><span class="bold">${(d.totalWeightKg || 0).toLocaleString()} كجم</span></div>
    <div class="flex"><span>مصدر الأكياس:</span><span>${d.bagsSourceLabel || "أكياس العميل"}</span></div>
  </div>`
      : isDelivery
        ? `
  <div class="bold" style="margin-bottom: 4px;">تفاصيل نواتج الطحن المسلمة:</div>
  ${(d.items && d.items.length > 0
    ? d.items
    : [
        {
          name: d.grainType || "نواتج طحن",
          bags: d.bagCount || 0,
          kg: d.totalWeightKg || 0,
          previousBags: d.bagCount,
          remainingBags: 0,
        },
      ]
  )
    .map(
      (it) => `
  <div class="box">
    <div class="flex"><span class="bold">${it.name}</span><span class="bold" style="color: #059669;">${it.bags} كيس (${it.kg.toLocaleString()} كجم)</span></div>
    ${
      it.previousBags !== undefined
        ? `<div class="flex" style="font-size: 10px; color: #555; border-top: 1px dashed #ccc; padding-top: 3px; margin-top: 3px;">
            <span>السابق: ${it.previousBags} كيس</span>
            <span style="color: #b45309; font-weight: bold;">المتبقي: ${it.remainingBags ?? 0} كيس</span>
           </div>`
        : ""
    }
  </div>`,
    )
    .join("")}`
        : `
  <div class="bold" style="margin-bottom: 4px;">تفاصيل الحبوب المطحونة والنواتج:</div>
  <div class="box">
    <div class="flex"><span>الحبوب المستهلكة:</span><span class="bold">${d.bagCount} كيس (${(d.totalWeightKg || 0).toLocaleString()} كجم)</span></div>
  </div>
  ${
    d.items
      ? d.items
          .map(
            (it) => `
    <div class="flex" style="padding: 2px 4px;"><span>${it.name}:</span><span class="bold">${it.bags} كيس (${it.kg} كجم)</span></div>`,
          )
          .join("")
      : ""
  }`
  }

  ${
    !isDelivery || (d.remainingAmount > 0 && isDelivery)
      ? `
  <div class="dashed"></div>
  ${d.millingFeeTotal !== undefined ? `<div class="flex"><span>أجرة خدمة الطحن:</span><span class="bold" style="font-family: monospace;">${d.millingFeeTotal.toLocaleString()} ر.ي</span></div>` : ""}
  ${d.packagingTotal !== undefined && d.packagingTotal > 0 ? `<div class="flex"><span>قيمة الأكياس:</span><span class="bold" style="font-family: monospace;">${d.packagingTotal.toLocaleString()} ر.ي</span></div>` : ""}
  ${(d.discount || 0) > 0 ? `<div class="flex" style="color: #059669;"><span>الخصم:</span><span style="font-family: monospace;">-${d.discount?.toLocaleString()} ر.ي</span></div>` : ""}
  <div class="dashed"></div>
  <div class="flex" style="font-size: 14px; font-weight: 900;"><span>الإجمالي المستحق:</span><span style="font-family: monospace;">${d.grandTotal.toLocaleString()} ر.ي</span></div>
  <div class="flex"><span>المدفوع (${d.paymentMethodLabel || "نقداً"}):</span><span class="bold" style="color: #059669; font-family: monospace;">${d.paidAmount.toLocaleString()} ر.ي</span></div>
  ${d.remainingAmount > 0 ? `<div class="flex" style="color: #dc2626; font-weight: bold;"><span>المتبقي ذمة:</span><span style="font-family: monospace;">${d.remainingAmount.toLocaleString()} ر.ي</span></div>` : ""}`
      : ""
  }

  <div class="dashed"></div>
  <div class="flex" style="justify-content: space-around; margin: 8px 0;">
    <div>${qrSvg}</div>
    <div style="text-align: center;">${barcodeSvg}</div>
  </div>

  <div class="dashed"></div>
  <div class="center" style="font-size: 10px; margin-top: 6px; color: #444;">
    <div>${
      isDelivery
        ? "تم تسليم نواتج الأمانات للعميل بحالة ممتازة بموجب إذن الصرف المعتمد."
        : isMilled
          ? "تم إتمام عملية الطحن وإثبات النواتج في حساب أمانات العميل."
          : "تم استلام الحبوب وطحنها وتسليم النواتج بحالة ممتازة."
    }</div>
    <div style="font-weight: bold; margin-top: 4px; color: #000;">شكراً لتعاملكم معنا — نسعد بخدمتكم دائماً</div>
  </div>
</body>
</html>`;
}

function renderA4Html(d: UnifiedTicketPrintData): string {
  const isDelivery = d.stage === "delivery";
  const isMilled = d.stage === "milled";
  const bagSize =
    d.bagSizeKg || (d.bagCount && d.totalWeightKg ? Math.round(d.totalWeightKg / d.bagCount) : 50);

  return `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="utf-8" />
  <title>فاتورة وسند طحن ${d.ticketNumber}</title>
  <style>
    @page { size: A4 portrait; margin: 15mm; }
    * { box-sizing: border-box; }
    body { font-family: system-ui, -apple-system, sans-serif; font-size: 13px; color: #1e293b; padding: 10px; background: #fff; }
    .header { display: flex; justify-content: space-between; border-bottom: 2px solid #0f172a; padding-bottom: 15px; }
    .box { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px; margin: 15px 0; }
    table { width: 100%; border-collapse: collapse; margin: 15px 0; }
    th { background: #f1f5f9; text-align: right; padding: 9px; border: 1px solid #cbd5e1; font-weight: bold; }
    td { padding: 9px; border: 1px solid #cbd5e1; }
    .flex { display: flex; justify-content: space-between; }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <h1 style="margin: 0; font-size: 22px;">${d.companyName || "مطحنة الحبوب المتقدمة"}</h1>
      <p style="margin: 4px 0 0 0; color: #64748b;">${d.companyAddress || "صنعاء — المركز الرئيسي"}</p>
      ${d.companyPhone ? `<p style="margin: 2px 0 0 0; color: #64748b;">هاتف: ${d.companyPhone}</p>` : ""}
    </div>
    <div style="text-align: left;">
      <h3 style="margin: 0; color: #b45309;">${isDelivery ? "سند تسليم نواتج أمانات" : isMilled ? "سند طحن وتشغيل أمانات" : "فاتورة وسند طحن وتسليم"}</h3>
      <p style="margin: 4px 0; font-weight: bold; font-family: monospace;">${d.ticketNumber}</p>
      <p style="margin: 0; color: #64748b;">${new Date(d.createdAt).toLocaleDateString("ar-EG")}</p>
    </div>
  </div>

  <div class="box">
    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
      <div><strong>العميل:</strong> ${d.customerName}</div>
      <div><strong>الهاتف:</strong> ${d.customerPhone || "—"}</div>
      <div><strong>المستودع:</strong> ${d.warehouseName || "المستودع الرئيسي"}</div>
      ${d.invoiceNumber ? `<div><strong>فاتورة المبيعات:</strong> #${d.invoiceNumber}</div>` : ""}
    </div>
  </div>

  ${
    isDelivery
      ? `
  <table>
    <thead>
      <tr>
        <th>ناتج الطحن</th>
        <th style="text-align: center;">الرصيد السابق</th>
        <th style="text-align: center;">الكمية المسلمة</th>
        <th style="text-align: center;">الوزن المسلم</th>
        <th style="text-align: center;">الرصيد المتبقي</th>
      </tr>
    </thead>
    <tbody>
      ${(d.items && d.items.length > 0
        ? d.items
        : [
            {
              name: d.grainType || "نواتج طحن",
              bags: d.bagCount || 0,
              kg: d.totalWeightKg || 0,
              previousBags: d.bagCount,
              remainingBags: 0,
            },
          ]
      )
        .map(
          (it) => `
        <tr>
          <td><strong>${it.name}</strong></td>
          <td style="text-align: center;">${it.previousBags ?? "—"} كيس</td>
          <td style="text-align: center; font-weight: bold; color: #059669;">${it.bags} كيس</td>
          <td style="text-align: center; font-weight: bold;">${it.kg.toLocaleString()} كجم</td>
          <td style="text-align: center; color: #b45309; font-weight: bold;">${it.remainingBags ?? 0} كيس</td>
        </tr>`,
        )
        .join("")}
    </tbody>
  </table>`
      : `
  <table>
    <thead>
      <tr>
        <th>نوع الحبوب</th>
        <th>درجة الطحن</th>
        <th style="text-align: center;">الكمية والأكياس</th>
        <th style="text-align: center;">الوزن الصافي</th>
        <th>مصدر الأكياس</th>
        <th style="text-align: left;">المبلغ</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td><strong>${d.grainType || "قمح بلدي"}</strong></td>
        <td>${d.millingTypeLabel || "طحن ناعم قياسي"}</td>
        <td style="text-align: center;">${d.bagCount} كيس (${bagSize} كجم)</td>
        <td style="text-align: center;"><strong>${(d.totalWeightKg || 0).toLocaleString()} كجم</strong></td>
        <td>${d.bagsSourceLabel || "أكياس العميل"}</td>
        <td style="text-align: left; font-weight: bold;">${(d.millingFeeTotal || 0).toLocaleString()} ر.ي</td>
      </tr>
      ${
        d.packagingTotal !== undefined && d.packagingTotal > 0
          ? `
      <tr>
        <td colspan="5">مستلزمات تعبئة وأكياس المطحنة</td>
        <td style="text-align: left; font-weight: bold;">${d.packagingTotal.toLocaleString()} ر.ي</td>
      </tr>`
          : ""
      }
    </tbody>
  </table>`
  }

  ${
    !isDelivery || d.remainingAmount > 0
      ? `
  <div style="display: flex; justify-content: flex-end; margin-top: 15px;">
    <div style="width: 280px;">
      <div class="flex"><span>المجموع:</span><span>${((d.millingFeeTotal || 0) + (d.packagingTotal || 0)).toLocaleString()} ر.ي</span></div>
      ${(d.discount || 0) > 0 ? `<div class="flex" style="color: green;"><span>الخصم:</span><span>-${d.discount?.toLocaleString()} ر.ي</span></div>` : ""}
      <div class="flex" style="font-size: 16px; font-weight: bold; border-top: 1px solid #000; padding-top: 6px; margin-top: 6px;">
        <span>الصافي المطلوب:</span><span>${d.grandTotal.toLocaleString()} ر.ي</span>
      </div>
      <div class="flex" style="color: green;"><span>المدفوع:</span><span>${d.paidAmount.toLocaleString()} ر.ي</span></div>
      ${d.remainingAmount > 0 ? `<div class="flex" style="color: red; font-weight: bold;"><span>المتبقي:</span><span>${d.remainingAmount.toLocaleString()} ر.ي</span></div>` : ""}
    </div>
  </div>`
      : ""
  }

  <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 40px; margin-top: 60px; text-align: center; color: #64748b;">
    <div>
      <p>توقيع مستلم الحبوب المطحونة</p>
      <div style="border-bottom: 1px dashed #cbd5e1; width: 180px; margin: 30px auto 0;"></div>
    </div>
    <div>
      <p>مشرف صالة المطحنة / الكاشير</p>
      <div style="border-bottom: 1px dashed #cbd5e1; width: 180px; margin: 30px auto 0;"></div>
    </div>
  </div>
</body>
</html>`;
}

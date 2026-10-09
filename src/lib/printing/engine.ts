import {
  renderDocumentHTML,
  type InvoiceLabels,
  type UnifiedDocumentData,
  type InvoiceTemplateId,
} from "@/lib/templates";
import { getCachedCompanyProfile } from "./company-profile";
import { PRINT_PAPERS, paperCss, type PrintOrientation, type PrintPaperId } from "./paper";
import { renderFormalTemplate } from "./formal";
import { normalizeTheme, type PrintTheme } from "./themes";
import { getUnifiedPrintSettings, type PrintMethod, type UnifiedPrintSettings } from "./settings";
import type { PrintingDocumentType } from "./document-types";
import { openPrintWindow } from "@/lib/print/print-window";
import {
  adapterFromTransport,
  registerPrintAdapters,
  transportForMethod,
  type PrintAdapterContext,
} from "./adapters";
import {
  getPrintTransport,
  printWithFallback,
  type PrintResult,
  type PrintTransportId,
} from "./transports";
import { buildEscPosBytes } from "./escpos";
import { renderThermalEscPos } from "./thermal-escpos";

export interface PrintRequest {
  doc: UnifiedDocumentData;
  documentType?: PrintingDocumentType;
  labels?: Partial<InvoiceLabels>;
  rtl?: boolean;
  templateId?: InvoiceTemplateId;
  theme?: PrintTheme;
  paperId?: PrintPaperId;
  orientation?: PrintOrientation;
  copies?: number;
  method?: PrintMethod;
  settings?: UnifiedPrintSettings;
}

function labelsFor(rtl: boolean, labels?: Partial<InvoiceLabels>): InvoiceLabels {
  return {
    invoice: rtl ? "المستند" : "Document",
    date: rtl ? "التاريخ" : "Date",
    billTo: rtl ? "الطرف" : "Party",
    warehouse: rtl ? "المستودع" : "Warehouse",
    payment: rtl ? "طريقة الدفع" : "Payment",
    status: rtl ? "الحالة" : "Status",
    product: rtl ? "الصنف" : "Item",
    qty: rtl ? "الكمية" : "Qty",
    price: rtl ? "السعر" : "Price",
    total: rtl ? "الإجمالي" : "Total",
    subtotal: rtl ? "المجموع الفرعي" : "Subtotal",
    tax: rtl ? "الضريبة" : "Tax",
    discount: rtl ? "الخصم" : "Discount",
    grandTotal: rtl ? "الإجمالي النهائي" : "Grand total",
    paid: rtl ? "المدفوع" : "Paid",
    balance: rtl ? "المتبقي" : "Balance",
    thanks: rtl ? "شكرًا لتعاملكم معنا" : "Thank you",
    poweredBy: "",
    notes: rtl ? "ملاحظات" : "Notes",
    ...labels,
  };
}

export function renderUnifiedDocument(request: PrintRequest): string {
  const settings = request.settings ?? getUnifiedPrintSettings();
  const type = request.documentType ?? request.doc.docType ?? "customer_invoice";
  const override = settings.overrides[type];
  const rtl = request.rtl ?? true;
  const paperId = request.paperId ?? override?.paperId ?? settings.paperId;
  const orientation = request.orientation ?? override?.orientation ?? settings.orientation;
  const theme = normalizeTheme(request.theme ?? override?.theme ?? settings.theme);
  const profile = PRINT_PAPERS[paperId];
  const labels = labelsFor(rtl, request.labels);
  const effectiveTemplateId =
    request.templateId ??
    override?.templateId ??
    (theme === "formal" ? "formal" : theme === "luxury" ? "elegant" : "standard");

  const customOptions = {
    showFooter: settings.footerEnabled,
    showBarcode: override?.showBarcode ?? settings.showBarcode ?? true,
    showQrCode: override?.showQrCode ?? settings.showQrCode ?? true,
    ...request.doc.options,
  };

  const html =
    effectiveTemplateId === "formal"
      ? renderFormalTemplate(
          request.doc,
          labels,
          rtl,
          customOptions,
          getCachedCompanyProfile(),
        )
      : renderDocumentHTML(
          request.doc,
          effectiveTemplateId,
          labels,
          rtl,
          customOptions,
          paperId,
        );
  return html
    .replace(
      "</head>",
      `<style data-unified-print="true">${paperCss(profile, orientation)}</style></head>`,
    )
    .replace(/<body([^>]*)>/i, "<body>");
}

/**
 * الـ adapters الثلاثة — كل واحد يُبنى من الـ transport المقابل، فلا تتكرر
 * جداول القدرات ولا الأسماء.
 *
 * - `browser` → Browser Print عبر iframe مخفي (`openPrintWindow`).
 * - `pdf` → نفس الآلية، ويُطلب من المستخدم «حفظ كـ PDF».
 * - `thermal` → **ليس ESC/POS**: المتصفح مع ملف ورق حراري (٥٨/٨٠ ملم).
 *
 * نقل ESC/POS المباشر موجود في `transports.ts` لكنه لا يُختار من الإعدادات
 * لأن إرساله يتطلب Local Print Agent غير متاح في المتصفح.
 */
const ADAPTERS = [
  adapterFromTransport("browser"),
  adapterFromTransport("pdf"),
  {
    ...adapterFromTransport("browser"),
    id: "thermal" as const,
    nameAr: "حراري عبر المتصفح (٥٨/٨٠ ملم)",
    nameEn: "Thermal via browser (58/80 mm)",
  },
];

registerPrintAdapters(ADAPTERS);

/**
 * طباعة موحدة — تُرجع نتيجة النقل حتى تعرف الصفحة ما حدث فعلًا
 * (نجاح / سقوط إلى المتصفح / حاجة إلى وكيل محلي).
 *
 * التوافق الرجعي: من لا يقرأ النتيجة يعمل كما كان (fire-and-forget).
 */
export async function printUnifiedDocument(
  request: PrintRequest,
  context?: PrintAdapterContext,
): Promise<PrintResult> {
  const settings = request.settings ?? getUnifiedPrintSettings();
  const type = request.documentType ?? request.doc.docType ?? "customer_invoice";
  const override = settings.overrides[type];
  const method = request.method ?? settings.method;
  const adapter = ADAPTERS.find((a) => a.id === method);
  if (!adapter) return { ok: false, copiesSent: 0, reason: "transport_error" };

  const html = renderUnifiedDocument(request);
  const resolvedCopies = request.copies ?? override?.copies ?? settings.copies;
  const copies = adapter.capabilities.supportsCopies
    ? Math.max(1, Math.min(20, resolvedCopies))
    : 1;

  const transportId = transportForMethod(method);
  const result = await printWithFallback(
    transportId,
    { output: { html }, copies, title: request.doc?.title },
    context,
  );
  return result;
}

/**
 * طباعة مباشرة عبر ESC/POS.
 *
 * تُولّد البايتات فعليًا، ثم تُرسلها إن وُجد `context.agent`؛ وإلا تُرجع
 * `agent_required` **دون أن تطبع شيئًا**. لا يوجد أي مسار وهمي.
 */
export async function printEscPos(
  request: PrintRequest,
  context?: PrintAdapterContext,
): Promise<PrintResult> {
  const settings = request.settings ?? getUnifiedPrintSettings();
  const type = request.documentType ?? request.doc.docType ?? "customer_invoice";
  const override = settings.overrides[type];
  const resolvedCopies = request.copies ?? override?.copies ?? settings.copies;
  const copies = Math.max(1, Math.min(20, resolvedCopies));
  const escpos = renderThermalEscPos(request);
  const transport = getPrintTransport("escpos");
  return transport.print({ output: { escpos }, copies, title: request.doc?.title }, context);
}

/** يبني بايتات ESC/POS لمستند موحد — بلا أي اتصال (للاختبار والتشخيص). */
export function buildEscPosForRequest(request: PrintRequest): Uint8Array {
  return buildEscPosBytes(renderThermalEscPos(request));
}

/** هل نقل ESC/POS قابل للاستخدام الآن؟ */
export function isEscPosAvailable(context?: PrintAdapterContext): boolean {
  return Boolean(context?.agent);
}

export type { PrintTransportId };

export function shouldPreview(settings = getUnifiedPrintSettings()): boolean {
  return settings.preview;
}

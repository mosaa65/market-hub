/**
 * Print Adapters — تجريد طرق الطباعة على مستوى الإعدادات والمحرك.
 *
 * ملاحظة معمارية: هذا الملف **واجهة رقيقة** فوق \`transports.ts\`.
 * الفصل مقصود:
 *   • \`transports.ts\` = كيف يخرج المستند فعلًا (browser / pdf / escpos) + الحدود.
 *   • \`adapters.ts\`  = كيف تختار الإعدادات والمحرك النقل المناسب.
 *
 * لا توجد جداول قدرات مكررة: \`capabilities\` تُقرأ من الـ transport نفسه.
 * إضافة نقل جديد = ملف واحد في \`transports.ts\` + قيمة في \`PrintMethod\`.
 */

import type { PrintRequest } from "./engine";
import type { PrintMethod } from "./settings";
import {
  getPrintTransport,
  type PrintTransport,
  type PrintTransportContext,
  type PrintTransportId,
  type PrintResult,
} from "./transports";

/** سياق التنفيذ — يُمرَّر من الصفحة إن كان لديها وكيل طباعة محلي. */
export type PrintAdapterContext = PrintTransportContext;

export interface PrintAdapterCapabilities {
  supportsCopies: boolean;
  supportsPreview: boolean;
  supportsPaperProfiles: boolean;
  supportsDirectOutput: boolean;
  supportsPaperCut: boolean;
  supportsNativeBarcode: boolean;
}

export interface PrintAdapter {
  id: PrintMethod;
  nameAr: string;
  nameEn: string;
  capabilities: PrintAdapterCapabilities;
  /**
   * ينفّذ الإخراج. \`html\` هو نفس HTML الذي عُرض في المعاينة.
   */
  print(
    request: PrintRequest,
    html: string,
    copies: number,
    context?: PrintAdapterContext,
  ): Promise<PrintResult> | PrintResult;
}

/** يُبني الـ adapter من الـ transport — مصدر واحد للقدرات والأسماء. */
export function adapterFromTransport(id: PrintTransportId): PrintAdapter {
  const transport: PrintTransport = getPrintTransport(id);
  return {
    id: id as PrintMethod,
    nameAr: transport.nameAr,
    nameEn: transport.nameEn,
    capabilities: transport.capabilities,
    print: (request, html, copies, context) =>
      transport.print({ output: { html }, copies, title: request.doc?.title }, context),
  };
}

/**
 * خريطة الأوصاف لعرضها في الإعدادات.
 * القدرات تأتي من الـ transports، فلا تنفصل عنها أبدًا.
 */
export const PRINT_ADAPTER_META: Record<
  PrintMethod,
  { nameAr: string; nameEn: string; capabilities: PrintAdapterCapabilities }
> = {
  browser: {
    nameAr: getPrintTransport("browser").nameAr,
    nameEn: getPrintTransport("browser").nameEn,
    capabilities: getPrintTransport("browser").capabilities,
  },
  pdf: {
    nameAr: getPrintTransport("pdf").nameAr,
    nameEn: getPrintTransport("pdf").nameEn,
    capabilities: getPrintTransport("pdf").capabilities,
  },
  thermal: {
    // "thermal" في الإعدادات = متصفح + ملف ورق حراري. ليس ESC/POS.
    nameAr: "حراري عبر المتصفح (٥٨/٨٠ ملم)",
    nameEn: "Thermal via browser (58/80 mm)",
    capabilities: getPrintTransport("browser").capabilities,
  },
};

/**
 * خريطة اختيار النقل من طريقة الطباعة في الإعدادات.
 * \`thermal\` يستخدم المتصفح مع ملف الورق الحراري — لا ESC/POS.
 */
export function transportForMethod(method: PrintMethod): PrintTransportId {
  if (method === "pdf") return "pdf";
  return "browser";
}

const registry = new Map<PrintMethod, PrintAdapter>();

/** يُملأ من \`engine.ts\` عند التحميل — يمنع دورة استيراد. */
export function registerPrintAdapters(adapters: PrintAdapter[]): void {
  for (const adapter of adapters) registry.set(adapter.id, adapter);
}

export function getPrintAdapter(id: PrintMethod): PrintAdapter | undefined {
  return registry.get(id);
}

export function getRegisteredPrintAdapters(): PrintAdapter[] {
  return Array.from(registry.values());
}

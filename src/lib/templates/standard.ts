/**
 * Standard / Elegant templates — نمطا «قياسي» و«فاخر».
 *
 * لم يعودا قالبَي HTML مستقلين: كلاهما يستدعي القالب الموحد
 * (`renderUnifiedLayout`) بثيم مختلف فقط. هذا يمنع تكرار نفس الـ HTML
 * بين standard وelegant (كانا ~1700 سطر متطابق تقريبًا).
 *
 * `elegant` مُبقى كـ alias للتوافق مع البيانات القديمة المحفوظة
 * (settings-store / overrides) — القيمة تُطبَّع عبر `normalizeTheme`.
 */

import type { UnifiedDocumentData, InvoiceLabels, CustomFieldOptions } from "./types";
import { renderUnifiedLayout, type UnifiedLayoutOptions } from "./unified-layout";

export function renderStandardTemplate(
  doc: UnifiedDocumentData,
  L: InvoiceLabels,
  rtl: boolean,
  options?: UnifiedLayoutOptions,
): string {
  return renderUnifiedLayout(doc, L, rtl, { ...options, theme: "standard" });
}

/** alias قديم — نفس الـ layout بثيم «فاخر». */
export function renderElegantTemplate(
  doc: UnifiedDocumentData,
  L: InvoiceLabels,
  rtl: boolean,
  options?: UnifiedLayoutOptions,
): string {
  return renderUnifiedLayout(doc, L, rtl, { ...options, theme: "luxury" });
}

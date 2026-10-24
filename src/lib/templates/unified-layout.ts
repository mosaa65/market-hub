/**
 * Unified Layout — منظومة الفواتير والمستندات الورقية (A4 / A5).
 *
 * قالبان احترافيان متميزان هيكلياً ووظيفياً لتلبية المعايير التجارية الرسمية:
 * 1. القالب التنفيذي الفاخر (Executive Luxury - `elegant`):
 *    - ترويسة متقنة ثلاثية الأركان (معلومات المنشأة يميناً، أيقونة الشعار بالمنتصف، المستند والتحقق يساراً)
 *    - بطاقات معلومات مفصلة للعميل والمعاملة
 *    - رمز QR والباركود في موضعهما الضريبي السليم (زاوية المستند وليس في منتصف الهيدر)
 *    - جدول أصناف أنيق مع تسطير وتقسيم بصري مريح
 *    - ملخص مالي وتفقيط واضح
 *    - مساحات توقيع رسمية معتمدة وختم رسمي خالٍ من الرسومات اليدوية الوهمية
 *
 * 2. القالب القياسي العملي المضغوط (Compact Commercial - `standard`):
 *    - تصميم عالي الكثافة للمحلات والمعاملات التجارية اليومية
 *    - هيدر مدمج وشريط عميل موحد يوفر 40% من المساحة الرأسية
 *    - جدول أصناف ذو كثافة عالية يستوعب أكبر عدد من البنود في الصفحة الواحدة
 *    - استغلال اقتصادي للورق والحبر
 *
 * كلاهما يدعم A4 و A5 بدقة مع المحافظة على الفوتر الموحد وهوية المنشأة.
 */

import {
  UnifiedDocumentData,
  InvoiceLabels,
  escapeHtml,
  formatMoney,
  DEFAULT_COMPANY_LOGO,
  CustomFieldOptions,
} from "./types";
import { numberToArabicWords } from "./tafqeet";
import { PRINT_THEMES, deriveThemeTokens, type PrintTheme } from "@/lib/printing/themes";
import { renderInvoiceRightsFooter } from "@/lib/printing/footer";
import { getCachedCompanyProfile, type CompanyProfile } from "@/lib/printing/company-profile";
import { generateBarcodeSvg, generateQrCodeSvg } from "@/lib/printing/barcode-qr";
import { getUnifiedPrintSettings } from "@/lib/printing/settings";
import { formatPrintedDateTime } from "@/lib/printing/date-time";
import type { PaperProfileId } from "./paper-profiles";

export { formatPrintedDateTime };

export interface UnifiedLayoutOptions extends CustomFieldOptions {
  /** نمط المستند — يغيّر الهيكل والسمة البصرية (standard / luxury / formal). */
  theme?: PrintTheme;
  /** بيانات الشركة؛ إن لم تُمرَّر تُقرأ من كاش Company Profile. */
  company?: CompanyProfile;
  /** مقاس الورق الحالي للمستند لضبط الأبعاد والهوامش ونسب الخطوط (A4 / A5) */
  paperProfileId?: PaperProfileId | string;
  /** لون التمييز المخصص للنمط التنفيذي الفاخر */
  luxuryAccentColor?: string | null;
  /** لون التمييز المخصص للنمط المؤسسي القياسي */
  standardAccentColor?: string | null;
}

function themeCss(
  theme: PrintTheme,
  rtl: boolean,
  customAccent?: string | null,
  isA5 = false,
): string {
  const t = deriveThemeTokens(theme, customAccent);
  const isLuxury = theme === "luxury";

  // مقاييس متجاوبة ودقيقة بين أحجام A4 و A5 لمنع الانقسام وتداخل الخطوط
  const baseFontSize = isA5 ? "9px" : "11px";
  const baseLineHeight = isA5 ? "1.36" : "1.45";
  const containerPadding = isA5 ? "4mm 6mm" : "8mm 10mm";
  const containerMinHeight = isA5 ? "200mm" : "282mm";
  const headerPadding = isA5 ? "6px 8px" : "10px 14px";
  const logoBoxSize = isA5 ? "54px" : "76px";
  const companyTitleSize = isA5 ? "13.5px" : "17.5px";
  const companySubtitleSize = isA5 ? "8px" : "9.5px";
  const invoiceTitleSize = isA5 ? "14px" : "18px";
  const cardPadding = isA5 ? "6px 8px" : "8px 12px";
  const cardLabelSize = isA5 ? "7.5px" : "8.5px";
  const cardValueSize = isA5 ? "10px" : "11.5px";
  const tableThPadding = isA5 ? "5px 6px" : "7px 10px";
  const tableTdPadding = isA5 ? "4.5px 6px" : "6.5px 10px";
  const notesPadding = isA5 ? "6px 8px" : "9px 12px";
  const totalsPadding = isA5 ? "6px 8px" : "9px 12px";
  const totalAmountSize = isA5 ? "13px" : "16px";
  const corporateLogoBoxSize = isA5 ? "46px" : "60px";

  const primaryAccent = t.accent;
  const softAccent = t.accentSoft;

  return `
    :root {
      --print-accent: ${t.accent};
      --print-accent-soft: ${t.accentSoft};
      --print-ink: ${t.ink};
      --print-muted: ${t.muted};
      --print-line: ${t.line};
      --print-surface: ${t.surface};
      --print-radius: ${t.radius};
    }
    *, *::before, *::after {
      box-sizing: border-box;
    }
    html, body {
      margin: 0; padding: 0;
      background: #ffffff;
      color: var(--print-ink);
      font-family: 'Cairo', 'Tajawal', system-ui, -apple-system, sans-serif;
      font-size: ${baseFontSize};
      line-height: ${baseLineHeight};
      direction: ${rtl ? "rtl" : "ltr"};
      text-align: ${rtl ? "right" : "left"};
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }

    @page {
      size: ${isA5 ? "A5 portrait" : "A4 portrait"};
      margin: ${isA5 ? "4mm" : "6mm"};
    }

    /* الحاوية الرئيسية للورقة */
    .page-container {
      width: 100%;
      max-width: 100%;
      box-sizing: border-box;
      background: #ffffff;
      position: relative;
      padding: ${containerPadding};
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      min-height: ${containerMinHeight};
    }

    /* ══════════════════════════════════════════════════════════════
       1. القالب التنفيذي الفاخر (Executive Luxury)
       ترويسة ثلاثية الأركان متوازنة: اليمين عربي، المنتصف شعار، اليسار إنجليزي والمستند
       ══════════════════════════════════════════════════════════════ */
    .luxury-header-wrap {
      border-bottom: 2px solid var(--print-accent);
      padding-bottom: ${headerPadding};
      margin-bottom: ${isA5 ? "8px" : "12px"};
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .luxury-header-grid {
      display: grid;
      grid-template-columns: 1.2fr auto 1.2fr;
      align-items: center;
      gap: ${isA5 ? "8px" : "14px"};
    }
    .luxury-header-right {
      display: flex;
      flex-direction: column;
      gap: 2px;
      text-align: right;
      direction: rtl;
    }
    .luxury-brand-title {
      font-size: ${companyTitleSize};
      font-weight: 900;
      color: var(--print-accent);
      margin: 0;
      line-height: 1.2;
    }
    .luxury-brand-sub {
      font-size: ${companySubtitleSize};
      font-weight: 700;
      color: var(--print-muted);
      margin-bottom: 2px;
    }
    .luxury-meta-line {
      display: flex;
      align-items: center;
      gap: 5px;
      font-size: ${isA5 ? "8px" : "9.5px"};
      color: var(--print-muted);
      font-weight: 600;
      line-height: 1.35;
    }
    .luxury-meta-line b {
      color: var(--print-ink);
    }

    /* الشعار في المنتصف دون أي مزاحمة لـ QR أو الباركود */
    .luxury-header-center {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 0 4px;
    }
    .luxury-document-meta {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 2px;
      margin-top: 4px;
      text-align: center;
    }
    .invoice-document-heading {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 3px;
      margin: ${isA5 ? "-2px 0 7px" : "-3px 0 10px"};
      text-align: center;
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .invoice-document-heading h2 {
      margin: 0;
      color: var(--print-accent);
      font-size: ${isA5 ? "14px" : "18px"};
      font-weight: 900;
      line-height: 1.25;
    }
    .invoice-document-meta {
      display: flex;
      align-items: center;
      justify-content: center;
      flex-wrap: wrap;
      gap: 5px 10px;
      color: var(--print-muted);
      font-size: ${isA5 ? "8px" : "9.5px"};
      font-weight: 700;
    }
    .invoice-document-number {
      direction: ltr;
      unicode-bidi: isolate;
      color: var(--print-ink);
      font-family: ui-monospace, 'Courier New', monospace;
    }
    .luxury-logo-box {
      width: ${logoBoxSize};
      height: ${logoBoxSize};
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
      flex-shrink: 0;
    }
    .luxury-logo-box img {
      max-width: 100%;
      max-height: 100%;
      object-fit: contain;
    }

    /* بيانات المستند والتحقق الضريبي في الجهة اليسرى */
    .luxury-header-left {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: ${isA5 ? "8px" : "12px"};
    }
    .luxury-doc-meta-col {
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 2.5px;
      text-align: left;
    }
    .luxury-inv-badge-title {
      font-size: ${invoiceTitleSize};
      font-weight: 900;
      color: var(--print-accent);
      letter-spacing: 0.5px;
      text-transform: uppercase;
      margin: 0;
      line-height: 1.15;
    }
    .luxury-inv-num-pill {
      background: var(--print-accent);
      color: #ffffff;
      padding: ${isA5 ? "2px 7px" : "3px 10px"};
      border-radius: 4px;
      font-family: ui-monospace, 'Courier New', monospace;
      font-size: ${isA5 ? "9.5px" : "11.5px"};
      font-weight: 800;
      letter-spacing: 0.5px;
      direction: ltr;
      unicode-bidi: isolate;
    }
    .luxury-inv-date-line {
      font-size: ${isA5 ? "8px" : "9.5px"};
      color: var(--print-muted);
      font-weight: 600;
      display: flex;
      gap: 4px;
    }
    .luxury-qr-box {
      width: ${isA5 ? "44px" : "56px"};
      height: ${isA5 ? "44px" : "56px"};
      padding: 2px;
      background: #ffffff;
      border: 1px solid var(--print-line);
      border-radius: 6px;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }
    .invoice-code-markers-bottom {
      display: flex;
      justify-content: center;
      align-items: center;
      gap: ${isA5 ? "10px" : "14px"};
      margin: ${isA5 ? "5px 0 2px" : "8px 0 3px"};
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .invoice-barcode-bottom > svg {
      width: auto;
      max-width: min(220px, 70vw);
      max-height: ${isA5 ? "30px" : "36px"};
    }
    .invoice-qr-bottom {
      display: flex;
      width: ${isA5 ? "34px" : "42px"};
      height: ${isA5 ? "34px" : "42px"};
      flex: 0 0 auto;
      align-items: center;
      justify-content: center;
      overflow: hidden;
      border: 1px solid var(--print-line);
      border-radius: 4px;
      background: #fff;
      padding: 2px;
    }
    .invoice-qr-bottom svg {
      display: block;
      width: 100%;
      height: 100%;
    }

    /* ══════════════════════════════════════════════════════════════
       2. القالب القياسي العملي المضغوط (Compact Commercial)
       تصميم عالي الكثافة للمحلات والتجارة اليومية
       ══════════════════════════════════════════════════════════════ */
    .corporate-header-wrap {
      border-bottom: 2px solid var(--print-accent);
      padding-bottom: ${isA5 ? "5px" : "8px"};
      margin-bottom: ${isA5 ? "6px" : "10px"};
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .corporate-header-grid {
      display: grid;
      grid-template-columns: 1fr auto 1fr;
      align-items: center;
      gap: ${isA5 ? "7px" : "12px"};
    }
    .corporate-brand-block {
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 2px;
      min-width: 0;
      text-align: right;
      direction: rtl;
    }
    .corporate-center-block { display:flex; flex-direction:column; align-items:center; gap:3px; min-width:0; text-align:center; }
    .corporate-english-block { display:flex; flex-direction:column; align-items:flex-start; gap:2px; min-width:0; text-align:left; direction:ltr; }
    .corporate-logo-box {
      width: ${corporateLogoBoxSize};
      height: ${corporateLogoBoxSize};
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }
    .corporate-logo-box img {
      max-width: 100%;
      max-height: 100%;
      object-fit: contain;
    }
    .corporate-brand-name {
      font-size: ${isA5 ? "12px" : "15px"};
      font-weight: 900;
      color: var(--print-accent);
      margin: 0;
      line-height: 1.2;
    }
    .corporate-brand-details {
      font-size: ${isA5 ? "7.5px" : "9px"};
      color: var(--print-muted);
      font-weight: 600;
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }
    .corporate-doc-block {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 3px;
      text-align: left;
      min-width: 0;
    }
    .corporate-doc-info {
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 2px;
    }
    .corporate-inv-title {
      font-size: ${isA5 ? "13px" : "16px"};
      font-weight: 900;
      color: var(--print-accent);
      margin: 0;
      letter-spacing: 0.3px;
    }
    .corporate-inv-meta {
      font-size: ${isA5 ? "8px" : "9.5px"};
      font-weight: 700;
      color: var(--print-muted);
    }

    /* الشريط الموحد المضغوط للعميل والدفع في القالب القياسي */
    .party-info-compact-bar {
      background: var(--print-surface);
      border: 1px solid var(--print-line);
      border-radius: 4px;
      padding: ${isA5 ? "4px 7px" : "6px 10px"};
      margin-bottom: ${isA5 ? "6px" : "10px"};
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 6px;
      font-size: ${isA5 ? "8px" : "9.5px"};
      break-inside: avoid;
    }
    .party-compact-item {
      display: flex;
      gap: 4px;
      align-items: center;
    }
    .party-compact-item b {
      color: var(--print-ink);
    }
    .party-compact-item span {
      color: var(--print-muted);
    }

    /* ══════════════════════════════════════════════════════════════
       بطاقات العميل والمعاملة في القالب التنفيذي
       ══════════════════════════════════════════════════════════════ */
    .party-info-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: ${isA5 ? "6px" : "10px"};
      margin-bottom: ${isA5 ? "8px" : "12px"};
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .party-card {
      background: var(--print-surface);
      border: 1px solid var(--print-line);
      border-radius: 6px;
      padding: ${cardPadding};
    }
    .party-card-title {
      font-size: ${cardLabelSize};
      font-weight: 800;
      color: var(--print-accent);
      text-transform: uppercase;
      letter-spacing: 0.4px;
      margin-bottom: 4px;
      padding-bottom: 3px;
      border-bottom: 1px dashed var(--print-line);
      display: flex;
      align-items: center;
      gap: 4px;
    }
    .party-card-name {
      font-size: ${cardValueSize};
      font-weight: 900;
      color: var(--print-ink);
      margin-bottom: 3px;
    }
    .party-card-row {
      display: flex;
      justify-content: space-between;
      font-size: ${isA5 ? "8px" : "9.5px"};
      color: var(--print-muted);
      line-height: 1.4;
    }
    .party-card-row b {
      color: var(--print-ink);
      font-weight: 700;
    }

    /* ══════════════════════════════════════════════════════════════
       جدول البنود المنظم
       ══════════════════════════════════════════════════════════════ */
    .table-container {
      width: 100%;
      margin-bottom: ${isA5 ? "8px" : "12px"};
      flex-grow: 1;
    }
    table.items-table {
      width: 100%;
      border-collapse: collapse;
      border: 1px solid var(--print-line);
    }
    table.items-table thead {
      display: table-header-group;
    }
    table.items-table tr {
      break-inside: avoid;
      page-break-inside: avoid;
    }
    table.items-table th {
      background: var(--print-accent);
      color: #ffffff;
      padding: ${tableThPadding};
      font-size: ${isA5 ? "8.5px" : "10px"};
      font-weight: 800;
      text-align: ${rtl ? "right" : "left"};
      border: 1px solid var(--print-accent);
      letter-spacing: 0.2px;
    }
    table.items-table td {
      padding: ${tableTdPadding};
      border: 1px solid var(--print-line);
      font-size: ${isA5 ? "8px" : "9.5px"};
      vertical-align: middle;
      color: var(--print-ink);
    }
    table.items-table tbody tr:nth-child(even) {
      background: ${softAccent};
    }
    .col-idx { width: 4%; text-align: center !important; font-weight: 700; color: var(--print-muted); }
    .col-desc { width: 46%; font-weight: 700; }
    .col-qty { width: 14%; text-align: center !important; }
    .col-price { width: 16%; text-align: ${rtl ? "left" : "right"} !important; }
    .col-total { width: 20%; text-align: ${rtl ? "left" : "right"} !important; font-weight: 800; }
    .prod-name { font-weight: 800; color: var(--print-ink); }
    .prod-code { font-size: ${isA5 ? "7px" : "8px"}; color: var(--print-muted); font-family: ui-monospace, monospace; }

    /* ══════════════════════════════════════════════════════════════
       القسم السفلي: التفقيط والإجماليات
       ══════════════════════════════════════════════════════════════ */
    .bottom-section-grid {
      display: grid;
      grid-template-columns: 1.15fr 0.85fr;
      gap: ${isA5 ? "8px" : "12px"};
      margin-bottom: ${isA5 ? "8px" : "12px"};
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .left-side-box {
      display: flex;
      flex-direction: column;
      gap: ${isA5 ? "5px" : "8px"};
    }
    .tafqeet-box {
      background: ${softAccent};
      border: 1px solid var(--print-line);
      border-radius: 5px;
      padding: ${isA5 ? "4px 7px" : "6px 10px"};
      font-size: ${isA5 ? "8px" : "9.5px"};
      color: var(--print-ink);
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .tafqeet-box b {
      color: var(--print-accent);
      font-weight: 800;
    }
    .thanks-notes-card {
      background: var(--print-surface);
      border: 1px solid var(--print-line);
      border-radius: 5px;
      padding: ${notesPadding};
    }
    .thanks-title {
      font-size: ${isA5 ? "8px" : "9.5px"};
      font-weight: 800;
      color: var(--print-accent);
      margin-bottom: 3px;
    }
    .notes-content-text {
      font-size: ${isA5 ? "7.5px" : "9px"};
      color: var(--print-muted);
      line-height: 1.4;
      white-space: pre-wrap;
    }

    /* كارد الإجماليات */
    .totals-card {
      background: var(--print-surface);
      border: 1px solid var(--print-line);
      border-radius: 6px;
      padding: ${totalsPadding};
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .totals-row {
      display: flex;
      justify-content: space-between;
      font-size: ${isA5 ? "8.5px" : "10px"};
      color: var(--print-muted);
      font-weight: 600;
    }
    .discount-row {
      color: #b91c1c;
      font-weight: 700;
    }
    .grand-total-highlight-banner {
      background: var(--print-accent);
      color: #ffffff;
      padding: ${isA5 ? "5px 8px" : "8px 12px"};
      border-radius: 5px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin: 4px 0;
    }
    .grand-total-highlight-banner .gt-label {
      font-size: ${isA5 ? "9.5px" : "11px"};
      font-weight: 900;
    }
    .grand-total-highlight-banner .gt-amount {
      font-size: ${totalAmountSize};
      font-weight: 900;
      direction: ltr;
      unicode-bidi: isolate;
      font-family: system-ui, sans-serif;
    }

    /* ══════════════════════════════════════════════════════════════
       التوقيعات والاعتماد الرسمي (خالٍ من الرسومات اليدوية الوهمية)
       ══════════════════════════════════════════════════════════════ */
    .signatures-row {
      display: grid;
      grid-template-columns: 1fr 1fr 1fr;
      gap: ${isA5 ? "8px" : "14px"};
      margin-top: ${isA5 ? "6px" : "10px"};
      margin-bottom: ${isA5 ? "6px" : "10px"};
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .sig-box {
      border: 1px solid var(--print-line);
      border-radius: 5px;
      padding: ${isA5 ? "5px 6px" : "8px 10px"};
      text-align: center;
      background: #ffffff;
      min-height: ${isA5 ? "44px" : "58px"};
      display: flex;
      flex-direction: column;
      justify-content: space-between;
    }
    .sig-title {
      font-size: ${isA5 ? "8px" : "9.5px"};
      font-weight: 800;
      color: var(--print-accent);
      margin-bottom: 2px;
    }
    .sig-line {
      border-bottom: 1px dotted var(--print-muted);
      margin: auto 8px 3px 8px;
    }
    .sig-caption {
      font-size: ${isA5 ? "7px" : "8px"};
      color: var(--print-muted);
    }
    .stamp-box-area {
      border: 1px dashed var(--print-line);
      border-radius: 4px;
      height: ${isA5 ? "28px" : "36px"};
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: ${isA5 ? "7px" : "8px"};
      color: var(--print-muted);
      margin-top: 2px;
    }

    .num-isolated {
      direction: ltr !important;
      unicode-bidi: isolate !important;
      font-family: system-ui, -apple-system, sans-serif;
    }


  `;
}

export function renderUnifiedLayout(
  doc: UnifiedDocumentData,
  L: InvoiceLabels,
  rtl = true,
  options?: UnifiedLayoutOptions,
): string {
  const theme: PrintTheme = options?.theme ?? "standard";
  const isA5 = options?.paperProfileId === "a5";
  const isLuxury = theme === "luxury";
  const companyTitleSize = isA5 ? "13.5px" : "17.5px";
  const unifiedSettings = getUnifiedPrintSettings();
  const customAccent =
    options?.accentColor ??
    doc.options?.accentColor ??
    (isLuxury
      ? (options?.luxuryAccentColor ?? unifiedSettings.luxuryAccentColor)
      : (options?.standardAccentColor ?? unifiedSettings.standardAccentColor)) ??
    null;
  const c = doc.currency ?? "ر.ي";
  const esc = escapeHtml;
  const money = (n?: number) => formatMoney(n ?? 0, c);
  const company = options?.company ?? getCachedCompanyProfile();
  const rawLogo =
    doc.company?.logo || (doc.company as Record<string, any>)?.logo_url || company.logoUrl;
  const logoUrl =
    rawLogo &&
    typeof rawLogo === "string" &&
    rawLogo.trim().length > 0 &&
    !rawLogo.includes("inama-soft-logo.ico")
      ? rawLogo.trim()
      : DEFAULT_COMPANY_LOGO;

  const opts = {
    showLogo: true,
    showCompanyInfo: true,
    showCustomerInfo: true,
    showDocNumberDate: true,
    showMovementInfo: true,
    showFinancialDetails: true,
    showPaymentInfo: true,
    showNotes: true,
    showSignatures: false,
    showFooter: false,
    showBarcode: true,
    showQrCode: unifiedSettings.showQrCode,
    ...doc.options,
    ...options,
  };

  const qrPayload = [
    `Seller: ${company.name || "Company"}`,
    `Invoice: ${doc.number}`,
    `Date: ${formatPrintedDateTime(doc.date)}`,
    `Total: ${doc.total || 0} ${c}`,
  ].join("\n");

  const barcodeSvg =
    opts.showBarcode !== false && doc.number ? generateBarcodeSvg(doc.number, isA5 ? 14 : 18) : "";
  const qrSvg = opts.showQrCode !== false ? generateQrCodeSvg(qrPayload, isA5 ? 40 : 50) : "";

  const companyName =
    company.name || doc.company?.name || company.arabicName || doc.company?.arabicName || "";
  const arabicName = company.arabicName || doc.company?.arabicName || "";
  const englishName = company.englishName || doc.company?.englishName || "";
  const companyAddress = company.address || doc.company?.address || "";
  const companyPhone = company.phone || doc.company?.phone || "";
  const companyVat = company.taxNumber || doc.company?.vat || "";
  const companyEmail = company.email || doc.company?.email || "";

  const lines = doc.lines || [];
  const rows = lines
    .map((l, i) => {
      const itemPrice = l.price ?? 0;
      const itemTotal = l.total ?? l.qty * itemPrice;
      return `
    <tr>
      <td class="col-idx">${i + 1}</td>
      <td class="col-desc">
        <div class="prod-name">${esc(l.product)}</div>
      </td>
      <td class="col-qty num-isolated">${l.qty} ${l.unit ? esc(l.unit) : rtl ? "حبة" : ""}</td>
      <td class="col-price num-isolated">${money(itemPrice)}</td>
      <td class="col-total num-isolated">${money(itemTotal)}</td>
    </tr>`;
    })
    .join("");

  const quantitiesByUnit = new Map<string, number>();
  for (const line of lines) {
    const unit = line.unit ?? "";
    quantitiesByUnit.set(unit, (quantitiesByUnit.get(unit) ?? 0) + Number(line.qty || 0));
  }
  const quantitySummary = Array.from(quantitiesByUnit.entries())
    .map(([unit, quantity]) => `${quantity}${unit ? ` ${esc(unit)}` : ""}`)
    .join(" · ");
  const itemsTotal = lines.reduce(
    (sum, line) => sum + (line.total ?? Number(line.qty || 0) * Number(line.price ?? 0)),
    0,
  );
  const itemsSummaryRow = lines.length
    ? `<tr class="items-summary-row"><td colspan="2">${rtl ? "إجمالي الأصناف" : "Items total"}</td><td class="col-qty num-isolated">${quantitySummary}</td><td class="col-price">—</td><td class="col-total num-isolated">${money(itemsTotal)}</td></tr>`
    : "";

  const numColumns = 5;

  return `<!doctype html>
<html dir="${rtl ? "rtl" : "ltr"}" lang="${rtl ? "ar" : "en"}">
<head>
  <meta charset="utf-8">
  <title>${esc(doc.title || (rtl ? "فاتورة مبيعات" : "Sales Invoice"))} - ${esc(doc.number)}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800;900&family=Tajawal:wght@500;700;800&display=swap" rel="stylesheet">
  <style>${themeCss(theme, rtl, customAccent, isA5)}</style>
</head>
<body>

<div class="page-container">
  <div>
    ${
      isLuxury
        ? `<!-- ══════════ ترويسة القالب التنفيذي الفاخر ══════════ -->
    <header class="luxury-header-wrap">
      <div class="luxury-header-grid">
        <!-- اليمين: بيانات المنشأة بالعربية -->
        <div class="luxury-header-right">
          ${opts.showCompanyInfo ? `<h1 class="luxury-brand-title">${esc(arabicName || companyName)}</h1>` : ""}
          ${opts.showCompanyInfo && companyName && companyName !== arabicName ? `<div class="luxury-brand-sub">${esc(companyName)}</div>` : ""}
          ${opts.showCompanyInfo && companyAddress ? `<div class="luxury-meta-line"><span><b>العنوان:</b> ${esc(companyAddress)}</span></div>` : ""}
          ${opts.showCompanyInfo && companyVat ? `<div class="luxury-meta-line"><span><b>الرقم الضريبي:</b> <span dir="ltr">${esc(companyVat)}</span></span></div>` : ""}
          ${opts.showCompanyInfo && companyPhone ? `<div class="luxury-meta-line"><span><b>الهاتف:</b> <span dir="ltr">${esc(companyPhone)}</span></span></div>` : ""}
        </div>

        <!-- المنتصف: الشعار -->
        <div class="luxury-header-center">
          ${
            opts.showLogo
              ? `
          <div class="luxury-logo-box">
            <img src="${esc(logoUrl)}" alt="Logo" onerror="this.onerror=null; this.src='${DEFAULT_COMPANY_LOGO}';" />
          </div>`
              : "<div></div>"
          }
        </div>

        <!-- اليسار: بيانات المنشأة الإنجليزية -->
        <div class="luxury-header-left">
          <div class="luxury-doc-meta-col">
            ${opts.showCompanyInfo && englishName ? `<div style="font-weight: 800; font-size: ${companyTitleSize}; color: var(--print-accent);">${esc(englishName)}</div>` : ""}
            ${opts.showCompanyInfo && companyVat ? `<div class="luxury-meta-line"><b>Tax ID:</b> <span dir="ltr">${esc(companyVat)}</span></div>` : ""}
            ${opts.showCompanyInfo && companyPhone ? `<div class="luxury-meta-line"><b>Phone:</b> <span dir="ltr">${esc(companyPhone)}</span></div>` : ""}
            ${opts.showCompanyInfo && companyEmail ? `<div class="luxury-meta-line"><b>Email:</b> <span dir="ltr">${esc(companyEmail)}</span></div>` : ""}
            ${qrSvg ? `<div class="luxury-qr-box" style="margin-top: 6px;">${qrSvg}</div>` : ""}
          </div>
        </div>
      </div>
    </header>

    <section class="invoice-document-heading">
      <h2>${esc(doc.title || (rtl ? "فاتورة مبيعات نقدية" : "Cash Sales Invoice"))}</h2>
      <div class="invoice-document-meta">
        ${opts.showDocNumberDate ? `<span class="invoice-document-number">${esc(doc.number)}</span>` : ""}
        ${opts.showDocNumberDate ? `<span dir="ltr">${rtl ? "التاريخ والوقت:" : "Date &amp; time:"} ${esc(formatPrintedDateTime(doc.date))}</span>` : ""}
      </div>
    </section>

    <!-- ══════════ بطاقات العميل وبيانات الحركة والدفع ══════════ -->
    <div class="party-info-grid" style="display:${opts.showCustomerInfo || opts.showPaymentInfo || opts.showMovementInfo ? "grid" : "none"}">
      <!-- بطاقة العميل (فاتورة إلى / Invoice To) -->
      <div class="party-card">
        ${opts.showCustomerInfo ? `<div class="party-card-title"><span>${esc(doc.partyLabel || L.billTo)}</span></div>` : ""}
        ${opts.showCustomerInfo ? `<div class="party-card-name">${esc(doc.partyName || (rtl ? "عميل نقدي عام" : "General Customer"))}</div>` : ""}
        ${opts.showCustomerInfo && doc.partyPhone ? `<div class="party-card-row"><span>الهاتف:</span> <span dir="ltr">${esc(doc.partyPhone)}</span></div>` : ""}
        ${opts.showCustomerInfo && doc.partyVat ? `<div class="party-card-row"><span>الرقم الضريبي:</span> <span dir="ltr">${esc(doc.partyVat)}</span></div>` : ""}
        ${opts.showCustomerInfo && doc.partyAddress ? `<div class="party-card-row"><span>العنوان:</span> <span>${esc(doc.partyAddress)}</span></div>` : ""}
      </div>

      <!-- بطاقة بيانات الفاتورة وطريقة الدفع (Payment Details) -->
      <div class="party-card">
        ${
          opts.showPaymentInfo || opts.showMovementInfo
            ? `<div class="party-card-title">
          <span>بيانات وطريقة الدفع (Payment Details)</span>
        </div>`
            : ""
        }
        ${
          opts.showPaymentInfo
            ? `<div class="party-card-row">
          <span>طريقة الدفع:</span>
          <b>${esc(doc.payment || (rtl ? "نقداً" : "Cash"))}</b>
        </div>`
            : ""
        }
        ${
          opts.showPaymentInfo
            ? `<div class="party-card-row">
          <span>حالة الفاتورة:</span>
          <b>${esc(doc.status || (rtl ? "مدفوعة بالكامل" : "Paid"))}</b>
        </div>`
            : ""
        }
        ${
          opts.showMovementInfo && doc.warehouse
            ? `
        <div class="party-card-row">
          <span>المستودع:</span>
          <span>${esc(doc.warehouse)}</span>
          ${doc.destinationWarehouse ? ` ➔ <span>${esc(doc.destinationWarehouse)}</span>` : ""}
        </div>`
            : ""
        }
        ${opts.showMovementInfo && doc.operatorName ? `<div class="party-card-row"><span>${rtl ? "البائع / المستخدم:" : "Sold by:"}</span> <span>${esc(doc.operatorName)}</span></div>` : ""}
      </div>
    </div>`
        : `<!-- ══════════ ترويسة القالب القياسي العملي المضغوط ══════════ -->
    <header class="corporate-header-wrap">
      <div class="corporate-header-grid">
        <!-- اليمين: بيانات المنشأة بالعربية -->
        <div class="corporate-brand-block">
          ${opts.showCompanyInfo ? `<h1 class="corporate-brand-name">${esc(arabicName || companyName)}</h1>` : ""}
          ${opts.showCompanyInfo && companyName && companyName !== arabicName ? `<div class="corporate-brand-details">${esc(companyName)}</div>` : ""}
          ${opts.showCompanyInfo && companyVat ? `<div class="corporate-brand-details">الرقم الضريبي: <b dir="ltr">${esc(companyVat)}</b></div>` : ""}
          ${opts.showCompanyInfo && companyPhone ? `<div class="corporate-brand-details">الهاتف: <b dir="ltr">${esc(companyPhone)}</b></div>` : ""}
          ${opts.showCompanyInfo && companyAddress ? `<div class="corporate-brand-details">${esc(companyAddress)}</div>` : ""}
        </div>

        <!-- المنتصف: الشعار فقط -->
        <div class="corporate-center-block">
          ${opts.showLogo ? `<div class="corporate-logo-box"><img src="${esc(logoUrl)}" alt="Logo" onerror="this.onerror=null; this.src='${DEFAULT_COMPANY_LOGO}';" /></div>` : ""}
        </div>

        <!-- اليسار: بيانات المنشأة الإنجليزية -->
        <div class="corporate-doc-block">
          ${qrSvg && !isLuxury ? `<div class="luxury-qr-box" style="margin-bottom: 6px;">${qrSvg}</div>` : ""}
          ${opts.showCompanyInfo && englishName ? `<div class="corporate-brand-name" dir="ltr">${esc(englishName)}</div>` : ""}
          ${opts.showCompanyInfo && companyVat ? `<div class="corporate-brand-details" dir="ltr">Tax ID: ${esc(companyVat)}</div>` : ""}
          ${opts.showCompanyInfo && companyPhone ? `<div class="corporate-brand-details" dir="ltr">Phone: ${esc(companyPhone)}</div>` : ""}
          ${opts.showCompanyInfo && companyEmail ? `<div class="corporate-brand-details" dir="ltr">${esc(companyEmail)}</div>` : ""}
        </div>
      </div>
    </header>

    <section class="invoice-document-heading">
      <h2>${esc(doc.title || (rtl ? "فاتورة مبيعات نقدية" : "Cash Sales Invoice"))}</h2>
      <div class="invoice-document-meta">
        ${opts.showDocNumberDate ? `<span class="invoice-document-number">${esc(doc.number)}</span>` : ""}
        ${opts.showDocNumberDate ? `<span dir="ltr">${rtl ? "التاريخ والوقت:" : "Date &amp; time:"} ${esc(formatPrintedDateTime(doc.date))}</span>` : ""}
      </div>
    </section>

    <!-- شريط العميل الموحد المضغوط لتوفير المساحة الرأسية للأصناف -->
    <div class="party-info-compact-bar" style="display:${opts.showCustomerInfo || opts.showPaymentInfo || opts.showMovementInfo ? "flex" : "none"}">
      <div class="party-compact-item">
        ${opts.showCustomerInfo ? `<span>${esc(doc.partyLabel || L.billTo)}:</span>` : ""}
        ${opts.showCustomerInfo ? `<b>${esc(doc.partyName || (rtl ? "عميل نقدي عام" : "General Customer"))}</b>` : ""}
      </div>
      ${opts.showCustomerInfo && doc.partyPhone ? `<div class="party-compact-item"><span>الهاتف:</span> <b dir="ltr">${esc(doc.partyPhone)}</b></div>` : ""}
      ${
        opts.showPaymentInfo
          ? `<div class="party-compact-item">
        <span>الدفع:</span>
        <b>${esc(doc.payment || (rtl ? "نقداً" : "Cash"))}</b>
      </div>`
          : ""
      }
      ${
        opts.showPaymentInfo
          ? `<div class="party-compact-item">
        <span>الحالة:</span>
        <b>${esc(doc.status || (rtl ? "مدفوعة" : "Paid"))}</b>
      </div>`
          : ""
      }
      ${opts.showMovementInfo && doc.operatorName ? `<div class="party-compact-item"><span>${rtl ? "البائع:" : "Sold by:"}</span> <b>${esc(doc.operatorName)}</b></div>` : ""}
      ${opts.showMovementInfo && doc.warehouse ? `<div class="party-compact-item"><span>المستودع:</span> <b>${esc(doc.warehouse)}</b></div>` : ""}
    </div>`
    }

    <!-- ══════════ جدول البنود المنظم ══════════ -->
    <div class="table-container">
      <table class="items-table">
        <thead>
          <tr>
            <th class="col-idx">${rtl ? "م" : "#"}</th>
            <th class="col-desc">${L.product}</th>
            <th class="col-qty">${L.qty}</th>
            <th class="col-price">${L.price}</th>
            <th class="col-total">${L.total}</th>
          </tr>
        </thead>
        <tbody>
          ${rows || `<tr><td colspan="${numColumns}" style="text-align:center; padding: 14px; color: var(--print-muted);">${rtl ? "لا توجد بنود مسجلة" : "No items"}</td></tr>`}
          ${itemsSummaryRow}
        </tbody>
      </table>
    </div>

    <!-- ══════════ القسم السفلي: التفقيط، الملاحظات، والإجماليات ══════════ -->
    <div class="bottom-section-grid">
      <div class="left-side-box">
        ${
          opts.showFinancialDetails
            ? `
        <div class="tafqeet-box">
          <span><b>المبلغ كتابةً:</b> ${esc(numberToArabicWords(doc.total ?? 0, doc.currency))}</span>
        </div>`
            : ""
        }

        ${
          opts.showNotes
            ? `<div class="thanks-notes-card">
          <div class="thanks-title">
            <span>${opts.showNotes && doc.notes ? (rtl ? "ملاحظات وشروط الفاتورة" : "Terms & Notes") : rtl ? "شكرًا لتعاملكم معنا" : "Thank You For Your Business"}</span>
          </div>
          <div class="notes-content-text">${esc(doc.notes || (rtl ? "نشكركم على اختياركم، البضاعة المباعة ترد وتستبدل وفق الشروط والأنظمة المعتمدة." : "We appreciate your business."))}</div>
        </div>`
            : ""
        }
          ${opts.showFooter ? `<footer class="universal-footer">${rtl ? "شكرًا لتعاملكم معنا" : "Thank you for your business"}</footer>` : ""}
      </div>

      <!-- كارد الإجماليات مع مستطيل الإجمالي البارز -->
      ${
        opts.showFinancialDetails
          ? `<div class="totals-card">
        <div class="totals-row">
          <span>${L.subtotal}:</span>
          <span class="num-isolated" style="font-weight: 700;">${money(doc.subtotal)}</span>
        </div>
        ${
          doc.discount
            ? `
        <div class="totals-row discount-row">
          <span>${L.discount}:</span>
          <span class="num-isolated">- ${money(doc.discount)}</span>
        </div>`
            : ""
        }
        ${
          doc.tax
            ? `
        <div class="totals-row">
          <span>${L.tax}:</span>
          <span class="num-isolated">+ ${money(doc.tax)}</span>
        </div>`
            : ""
        }

        <!-- مستطيل الإجمالي البارز -->
        <div class="grand-total-highlight-banner">
          <span class="gt-label">${L.grandTotal}</span>
          <span class="gt-amount">${money(doc.total)}</span>
        </div>

        ${
          doc.paid !== undefined
            ? `
        <div class="totals-row" style="margin-top: 3px;">
          <span>${L.paid}:</span>
          <span class="num-isolated" style="font-weight: 700;">${money(doc.paid)}</span>
        </div>
        <div class="totals-row">
          <span>${L.balance}:</span>
          <span class="num-isolated" style="font-weight: 700; color: ${(doc.total ?? 0) - doc.paid > 0 ? "#b91c1c" : "#047857"};">${money((doc.total ?? 0) - doc.paid)}</span>
        </div>`
            : ""
        }
      </div>`
          : ""
      }
    </div>

    <!-- التوقيعات والاعتماد الرسمي المعتمد -->
    ${
      opts.showSignatures
        ? `
    <div class="signatures-row">
      <div class="sig-box">
        <div class="sig-title">${rtl ? "توقيع المستلم" : "Recipient Signature"}</div>
        <div class="sig-line"></div>
        <div class="sig-caption">${rtl ? "الاسم: ......................................." : "Name: ......................................."}</div>
      </div>
      <div class="sig-box">
        <div class="sig-title">${rtl ? "المحاسب / المعتمد" : "Authorized"}</div>
        <div class="sig-line"></div>
        <div class="sig-caption">${rtl ? "التوقيع: ...................................." : "Signature: ...................................."}</div>
      </div>
      <div class="sig-box">
        <div class="sig-title">${rtl ? "الختم الرسمي" : "Official Stamp"}</div>
        <div class="stamp-box-area">
          <span>${rtl ? "موضع الختم المعتمد" : "Stamp Area"}</span>
        </div>
      </div>
    </div>`
        : ""
    }
      ${barcodeSvg || qrSvg ? `<div class="invoice-code-markers-bottom">${barcodeSvg ? `<div class="invoice-barcode-bottom">${barcodeSvg}</div>` : ""}${qrSvg ? `<div class="invoice-qr-bottom">${qrSvg}</div>` : ""}</div>` : ""}
  </div>

  ${renderInvoiceRightsFooter()}

</div>

</body>
</html>`;
}

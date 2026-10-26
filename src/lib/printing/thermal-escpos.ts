/**
 * Thermal ESC/POS Mapper — تحويل `PrintRequest` إلى مستند ESC/POS نصي.
 *
 * هذا هو "mapper" الطباعة الحرارية المباشرة: **بيانات فقط**.
 * لا HTML، ولا CSS، ولا اتصال بطابعة، ولا معرفة بأوامر ESC/POS نفسها
 * (تلك مسؤولية `escpos.ts`).
 *
 * المستندات المدعومة بنفس المسار: فواتير المبيعات، المشتريات، المرتجعات،
 * سندات القبض/الصرف، مستندات المخزون والتحويلات، مستندات المطحنة،
 * والتذاكر اليومية — لأنها كلها تصل هنا على شكل `UnifiedDocumentData`.
 */

import type { PrintRequest } from "./engine";
import { getCachedCompanyProfile, type CompanyProfile } from "./company-profile";
import { COMPANY_RIGHTS_TEXT } from "./footer";
import { PRINT_PAPERS } from "./paper";
import { getDocumentTypeMeta, type PrintingDocumentType } from "./document-types";
import {
  columnsForWidthMm,
  FONT_SIZE,
  separator,
  type EscPosDocument,
  type EscPosBlock,
} from "./escpos";

/** حقول لا تُطبع على إيصال حراري: الأسعار (عند إخفائها) وملاحظات داخلية. */
export interface ThermalEscPosOptions {
  /** إظهار الأسعار والإجماليات. */
  showPrices?: boolean;
  /** إظهار بيانات العميل. */
  showCustomer?: boolean;
  /** إظهار الشعار (اسم الشركة كنص — لا صور: طباعة الصور تحتاج GS v 0). */
  showLogo?: boolean;
  /** إظهار الفوتر الموحد. */
  showFooter?: boolean;
  /** إظهار فواصل البنود. */
  showDividers?: boolean;
  /** بيانات الشركة — تُقرأ من Company Profile إن لم تُمرَّر. */
  company?: CompanyProfile;
}

const DEFAULTS: Required<Omit<ThermalEscPosOptions, "company">> = {
  showPrices: true,
  showCustomer: true,
  showLogo: true,
  showFooter: true,
  showDividers: true,
};

function money(value: number | undefined, currency: string | undefined, show: boolean): string {
  if (!show) return "";
  const amount = Number(value ?? 0).toFixed(2);
  return currency ? `${amount} ${currency}` : amount;
}

/** سطر "عنوان: قيمة" مع محاذاة يمينية للقيمة في عمودين. */
function kvLine(label: string, value: string, columns: number): string {
  const text = `${label}: ${value}`;
  if (text.length <= columns) return text;
  // اسم طويل: ننزل بالقيمة إلى سطر تالٍ بدل قطعها.
  return `${label}:\n${value}`;
}

/**
 * يبني مستند ESC/POS من طلب طباعة موحد.
 *
 * @param request طلب الطباعة (نفس المستند المستخدم في المعاينة والطباعة).
 */
export function renderThermalEscPos(
  request: PrintRequest,
  options: ThermalEscPosOptions = {},
): EscPosDocument {
  const settings = request.settings;
  const opts = { ...DEFAULTS, ...options };
  const company = options.company ?? getCachedCompanyProfile();
  const doc = request.doc;
  const rtl = request.rtl ?? true;

  const paperId = request.paperId ?? settings?.paperId ?? "thermal-80";
  const profile = PRINT_PAPERS[paperId] ?? PRINT_PAPERS["thermal-80"];
  const columns = columnsForWidthMm(profile.widthMm);

  const docType: PrintingDocumentType = request.documentType ?? doc.docType ?? "customer_invoice";
  const meta = getDocumentTypeMeta(docType);
  const docTitle = doc.title || (rtl ? meta.nameAr : meta.nameEn);
  const currency = doc.currency ?? company.currency;

  const blocks: EscPosBlock[] = [];
  const divider = opts.showDividers ? separator("-", columns) : "";

  // ── الترويسة: اسم الشركة من Company Profile ────────────────────────────
  const companyName = doc.company?.name || company.name || "";
  if (opts.showLogo && companyName) {
    blocks.push({ text: companyName, align: "center", bold: true, size: FONT_SIZE.double });
  }
  const address = doc.company?.address || company.address;
  if (address) blocks.push({ text: address, align: "center" });
  const phone = doc.company?.phone || company.phone || company.contacts.join(" · ");
  if (phone) blocks.push({ text: phone, align: "center" });
  const tax = doc.company?.vat || company.taxNumber;
  if (tax) blocks.push({ text: `${rtl ? "الرقم الضريبي" : "Tax ID"}: ${tax}`, align: "center" });

  if (divider) blocks.push({ text: divider, align: "center" });

  // ── نوع المستند ورقمه وتاريخه ─────────────────────────────────────────
  blocks.push({ text: docTitle, align: "center", bold: true });
  blocks.push({ text: `#${doc.number}`, align: "center" });
  blocks.push({ text: `${rtl ? "التاريخ" : "Date"}: ${doc.date}`, align: "center" });

  // ── الطرف ──────────────────────────────────────────────────────────────
  if (opts.showCustomer && doc.partyName) {
    if (divider) blocks.push({ text: divider, align: "center" });
    blocks.push({
      text: kvLine(doc.partyLabel || (rtl ? "العميل" : "Customer"), doc.partyName, columns),
    });
    if (doc.partyPhone) {
      blocks.push({ text: kvLine(rtl ? "هاتف" : "Tel", doc.partyPhone, columns) });
    }
  }

  // ── بيانات الحركة (مستودع / تحويل / مشغّل) ────────────────────────────
  if (doc.warehouse) {
    blocks.push({ text: kvLine(rtl ? "المستودع" : "Warehouse", doc.warehouse, columns) });
  }
  if (doc.destinationWarehouse) {
    blocks.push({
      text: kvLine(rtl ? "إلى" : "To", doc.destinationWarehouse, columns),
    });
  }
  if (doc.movementType) {
    blocks.push({ text: kvLine(rtl ? "نوع الحركة" : "Movement", doc.movementType, columns) });
  }
  if (doc.operatorName) {
    blocks.push({ text: kvLine(rtl ? "المنفذ" : "Operator", doc.operatorName, columns) });
  }
  if (doc.payment) {
    blocks.push({ text: kvLine(rtl ? "الدفع" : "Payment", doc.payment, columns) });
  }

  // ── البنود: كل بند اسم + تفاصيل ثم فاصل خفيف ─────────────────────────
  if (divider) blocks.push({ text: divider, align: "center" });
  if (doc.lines.length === 0) {
    blocks.push({ text: rtl ? "لا توجد عناصر" : "No items", align: "center" });
  } else {
    doc.lines.forEach((line, index) => {
      const qty = `${line.qty}${line.unit ? ` ${line.unit}` : ""}`;
      const price = money(line.price, currency, opts.showPrices);
      const total = money(line.total ?? line.qty * (line.price ?? 0), currency, opts.showPrices);

      // السطر الأول: رقم البند والاسم بخط عريض.
      blocks.push({ text: `${index + 1}. ${line.product}`, bold: true });
      // سطر التفاصيل: كود، كمية، سعر، إجمالي.
      const details: string[] = [];
      if (line.code) details.push(line.code);
      details.push(qty);
      if (price) details.push(`× ${price}`);
      if (total) details.push(`= ${total}`);
      blocks.push({ text: details.join("  ") });
      if (line.note) blocks.push({ text: line.note });

      // فاصل خفيف بين البنود — يوفّر الورق والحبر.
      if (opts.showDividers && index < doc.lines.length - 1) {
        blocks.push({ text: separator(".", columns), align: "center" });
      }
    });
  }

  // ── الإجماليات ─────────────────────────────────────────────────────────
  if (opts.showPrices) {
    if (divider) blocks.push({ text: divider, align: "center" });
    const subtotal = money(doc.subtotal, currency, true);
    if (subtotal) {
      blocks.push({ text: `${rtl ? "المجموع الفرعي" : "Subtotal"}: ${subtotal}`, align: "right" });
    }
    if (doc.discount) {
      blocks.push({
        text: `${rtl ? "الخصم" : "Discount"}: -${money(doc.discount, currency, true)}`,
        align: "right",
      });
    }
    if (doc.tax) {
      blocks.push({
        text: `${rtl ? "الضريبة" : "Tax"}: +${money(doc.tax, currency, true)}`,
        align: "right",
      });
    }
    blocks.push({
      text: `${rtl ? "الإجمالي" : "Total"}: ${money(doc.total, currency, true)}`,
      align: "right",
      bold: true,
      size: FONT_SIZE.wide,
    });
    if (doc.paid !== undefined) {
      blocks.push({
        text: `${rtl ? "المدفوع" : "Paid"}: ${money(doc.paid, currency, true)}`,
        align: "right",
      });
      blocks.push({
        text: `${rtl ? "المتبقي" : "Balance"}: ${money((doc.total ?? 0) - doc.paid, currency, true)}`,
        align: "right",
      });
    }
  }

  // ── الملاحظات ──────────────────────────────────────────────────────────
  if (doc.notes) {
    if (divider) blocks.push({ text: divider, align: "center" });
    blocks.push({ text: `${rtl ? "ملاحظات" : "Notes"}: ${doc.notes}` });
  }

  // ── التوقيعات (نصية على الإيصال الحراري) ──────────────────────────────
  if (divider) blocks.push({ text: divider, align: "center" });
  blocks.push({ text: rtl ? "توقيع المستلم" : "Recipient signature" });
  // خط توقيع ممتد — ليس فاصل بنود، فلا يخضع لـ showDividers.
  blocks.push({ text: "_".repeat(columns), align: "center" });

  // ── فوتر المنشأة (يُطبع فقط عند showFooter) — نفس سياسة القوالب الورقية ──
  if (opts.showFooter) {
    if (divider) blocks.push({ text: divider, align: "center" });
    const thanks = rtl ? "شكراً لتعاملكم معنا" : "Thank you for your business";
    blocks.push({ text: thanks, align: "center" });
    const footerContact = company.phone || company.contacts.join(" · ");
    if (footerContact) blocks.push({ text: footerContact, align: "center", bold: true });
      if (company.email) blocks.push({ text: company.email, align: "center" });
    }
    // ── حقوق النظام (تظهر دائماً — حقوق المنصة ليست خياراً للمنشأة) ──────
    if (divider) blocks.push({ text: divider, align: "center" });
    blocks.push({ text: COMPANY_RIGHTS_TEXT, align: "center" });
    return { columns, blocks, cut: true, feedBeforeCut: 3 };
}

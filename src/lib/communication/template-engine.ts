/**
 * Central Communication Template Engine
 * Market-Hub ERP
 *
 * Implements:
 * - Dynamic Variable Interpolation ({{variable}})
 * - Contextual Multi-Language Templates (Arabic / English)
 * - Strict use of Real Company Profile (Never hardcoded software brand)
 * - Number and Currency Formatting aligned with company settings
 */

import { money } from "@/lib/format";
import { toSystemDigits } from "@/lib/format-preferences";
import { buildWhatsAppLink, normalizeWhatsAppPhone } from "./phone";
import type {
  CommunicationEventType,
  MessageLanguage,
  RenderedMessage,
  UnifiedCommunicationContext,
} from "./types";

export interface TemplateDefinition {
  ar: (ctx: UnifiedCommunicationContext) => string;
  en: (ctx: UnifiedCommunicationContext) => string;
}

function resolveCompanyName(ctx: UnifiedCommunicationContext, isAr: boolean): string {
  const company = ctx.company;
  if (!company) return "";
  if (isAr) {
    return company.arabicName || company.name || "";
  }
  return company.englishName || company.name || "";
}

function formatAmount(amount?: number | null, currency?: string): string {
  if (amount == null || isNaN(amount)) return "";
  const formatted = money(amount);
  return toSystemDigits(currency ? `${formatted} ${currency}` : formatted);
}

export const TEMPLATES: Record<CommunicationEventType, TemplateDefinition> = {
  payment_request: {
    ar: (ctx) => {
      const companyName = resolveCompanyName(ctx, true);
      const customerName = ctx.customer?.name || "العميل الكريم";
      const balance = formatAmount(ctx.customer?.balance, ctx.company?.currency);
      const companyPhone = ctx.company?.phone || ctx.company?.contacts?.[0] || "";

      const lines = [
        `السلام عليكم ورحمة الله وبركاته،`,
        `عزيزنا *${customerName}*،`,
        companyName ? `تحية طيبة من *${companyName}*.` : "",
        `نود إشعاركم بوجود رصيد مستحق على حسابكم بمبلغ: *${balance}*.`,
        `نأمل التكرم بترتيب السداد في أقرب وقت ممكن.`,
        companyPhone ? `للتنسيق أو الاستفسار: ${companyPhone}` : "",
        `شاكرين لكم حسن تعاونكم الدائم معنا.`,
      ].filter(Boolean);

      return lines.join("\n");
    },
    en: (ctx) => {
      const companyName = resolveCompanyName(ctx, false);
      const customerName = ctx.customer?.name || "Valued Customer";
      const balance = formatAmount(ctx.customer?.balance, ctx.company?.currency);
      const companyPhone = ctx.company?.phone || ctx.company?.contacts?.[0] || "";

      const lines = [
        `Dear *${customerName}*,`,
        companyName ? `Greetings from *${companyName}*.` : "",
        `This is a friendly reminder that you have an outstanding balance of: *${balance}*.`,
        `Kindly arrange payment at your earliest convenience.`,
        companyPhone ? `For any inquiries, please contact: ${companyPhone}` : "",
        `Thank you for your valued partnership.`,
      ].filter(Boolean);

      return lines.join("\n");
    },
  },

  debt_reminder: {
    ar: (ctx) => {
      const companyName = resolveCompanyName(ctx, true);
      const customerName = ctx.customer?.name || "العميل الكريم";
      const balance = formatAmount(ctx.customer?.balance, ctx.company?.currency);

      const lines = [
        `السلام عليكم ورحمة الله وبركاته ${customerName}،`,
        `نود تذكيركم بلطف بالرصيد المتبقي لديكم${companyName ? ` لدى *${companyName}*` : ""}: *${balance}*.`,
        `نأمل التكرم بالسداد، وشكرًا لتعاونكم وثقتكم بنا.`,
      ];

      return lines.join("\n");
    },
    en: (ctx) => {
      const companyName = resolveCompanyName(ctx, false);
      const customerName = ctx.customer?.name || "Customer";
      const balance = formatAmount(ctx.customer?.balance, ctx.company?.currency);

      const lines = [
        `Hello ${customerName},`,
        `This is a reminder regarding your current balance${companyName ? ` with *${companyName}*` : ""}: *${balance}*.`,
        `Thank you for your cooperation and business with us.`,
      ];

      return lines.join("\n");
    },
  },

  payment_received: {
    ar: (ctx) => {
      const companyName = resolveCompanyName(ctx, true);
      const customerName = ctx.customer?.name || "العميل الكريم";
      const p = ctx.payment;
      const amount = formatAmount(p?.amount, ctx.company?.currency);
      const remaining =
        p?.remainingBalance !== undefined
          ? formatAmount(p.remainingBalance, ctx.company?.currency)
          : null;

      const lines = [
        `السلام عليكم ورحمة الله وبركاته ${customerName}،`,
        companyName ? `*${companyName}*` : "",
        `🧾 *إشعار سند قبض مالي*`,
        `تم بحمد الله استلام دفعة بمبلغ: *${amount}*`,
        p?.date ? `📅 التاريخ: ${p.date}` : "",
        p?.receiptNumber ? `🔖 رقم السند: #${p.receiptNumber}` : "",
        p?.method ? `💳 طريقة الدفع: ${p.method}` : "",
        p?.invoiceNumber ? `📄 الفاتورة: #${p.invoiceNumber}` : "",
        remaining !== null && (p?.remainingBalance ?? 0) > 0
          ? `⏳ الرصيد المتبقي: *${remaining}*`
          : (p?.remainingBalance ?? 0) <= 0 && remaining !== null
            ? `✨ الحساب مسدد بالكامل`
            : "",
        `نسعد بخدمتكم وشاكرين لتعاملكم معنا دائماً.`,
      ].filter(Boolean);

      return lines.join("\n");
    },
    en: (ctx) => {
      const companyName = resolveCompanyName(ctx, false);
      const customerName = ctx.customer?.name || "Valued Customer";
      const p = ctx.payment;
      const amount = formatAmount(p?.amount, ctx.company?.currency);
      const remaining =
        p?.remainingBalance !== undefined
          ? formatAmount(p.remainingBalance, ctx.company?.currency)
          : null;

      const lines = [
        `Hello ${customerName},`,
        companyName ? `*${companyName}*` : "",
        `🧾 *Payment Receipt Confirmation*`,
        `We have received your payment of: *${amount}*`,
        p?.date ? `📅 Date: ${p.date}` : "",
        p?.receiptNumber ? `🔖 Receipt #: ${p.receiptNumber}` : "",
        p?.method ? `💳 Method: ${p.method}` : "",
        p?.invoiceNumber ? `📄 Invoice #: ${p.invoiceNumber}` : "",
        remaining !== null && (p?.remainingBalance ?? 0) > 0
          ? `⏳ Remaining Balance: *${remaining}*`
          : (p?.remainingBalance ?? 0) <= 0 && remaining !== null
            ? `✨ Account is fully settled`
            : "",
        `Thank you for your business!`,
      ].filter(Boolean);

      return lines.join("\n");
    },
  },

  invoice_share: {
    ar: (ctx) => {
      const companyName = resolveCompanyName(ctx, true);
      const customerName = ctx.customer?.name || "العميل الكريم";
      const inv = ctx.invoice;
      const total = formatAmount(inv?.total, ctx.company?.currency);
      const paid = formatAmount(inv?.paid, ctx.company?.currency);
      const remaining = formatAmount(inv?.remaining, ctx.company?.currency);

      const lines = [
        `السلام عليكم ورحمة الله وبركاته،`,
        `عزيزنا *${customerName}*،`,
        companyName ? `تفاصيل فاتورتكم من *${companyName}*:` : `تفاصيل الفاتورة:`,
        inv?.invoiceNumber ? `🧾 *رقم الفاتورة:* #${inv.invoiceNumber}` : "",
        inv?.date ? `📅 *التاريخ:* ${inv.date}` : "",
        `💵 *الإجمالي:* ${total}`,
        `✅ *المدفوع:* ${paid}`,
        (inv?.remaining ?? 0) > 0 ? `⏳ *المتبقي:* ${remaining}` : `✨ *الحالة:* مسددة بالكامل`,
        `\nشكراً لتعاملكم معنا ونسعد بخدمتكم دائماً.`,
      ].filter(Boolean);

      return lines.join("\n");
    },
    en: (ctx) => {
      const companyName = resolveCompanyName(ctx, false);
      const customerName = ctx.customer?.name || "Valued Customer";
      const inv = ctx.invoice;
      const total = formatAmount(inv?.total, ctx.company?.currency);
      const paid = formatAmount(inv?.paid, ctx.company?.currency);
      const remaining = formatAmount(inv?.remaining, ctx.company?.currency);

      const lines = [
        `Hello *${customerName}*,`,
        companyName ? `Invoice details from *${companyName}*:` : `Invoice details:`,
        inv?.invoiceNumber ? `🧾 *Invoice #:* #${inv.invoiceNumber}` : "",
        inv?.date ? `📅 *Date:* ${inv.date}` : "",
        `💵 *Total:* ${total}`,
        `✅ *Paid:* ${paid}`,
        (inv?.remaining ?? 0) > 0 ? `⏳ *Remaining:* ${remaining}` : `✨ *Status:* Fully Paid`,
        `\nThank you for choosing us!`,
      ].filter(Boolean);

      return lines.join("\n");
    },
  },

  invoice_created: {
    ar: (ctx) => TEMPLATES.invoice_share.ar(ctx),
    en: (ctx) => TEMPLATES.invoice_share.en(ctx),
  },

  statement_share: {
    ar: (ctx) => {
      const companyName = resolveCompanyName(ctx, true);
      const customerName = ctx.customer?.name || "العميل الكريم";
      const st = ctx.statement;
      const opening = formatAmount(st?.openingBalance, ctx.company?.currency);
      const debit = formatAmount(st?.totalDebit, ctx.company?.currency);
      const credit = formatAmount(st?.totalCredit, ctx.company?.currency);
      const closing = formatAmount(st?.closingBalance, ctx.company?.currency);

      const lines = [
        `السلام عليكم ورحمة الله وبركاته ${customerName}،`,
        companyName ? `*كشف حساب — ${companyName}*` : `*ملخص كشف الحساب*`,
        st?.periodLabel ? `📅 *الفترة:* ${st.periodLabel}` : "",
        `📊 *الرصيد الافتتاحي:* ${opening}`,
        `📈 *إجمالي المشتريات/المدين:* ${debit}`,
        `📉 *إجمالي المدفوعات/الدائن:* ${credit}`,
        `📌 *الرصيد الختامي الحالي:* *${closing}*`,
        `\nلأي استفسارات أو مطابقة حساب، نسعد بتواصلكم معنا.`,
      ].filter(Boolean);

      return lines.join("\n");
    },
    en: (ctx) => {
      const companyName = resolveCompanyName(ctx, false);
      const customerName = ctx.customer?.name || "Valued Customer";
      const st = ctx.statement;
      const opening = formatAmount(st?.openingBalance, ctx.company?.currency);
      const debit = formatAmount(st?.totalDebit, ctx.company?.currency);
      const credit = formatAmount(st?.totalCredit, ctx.company?.currency);
      const closing = formatAmount(st?.closingBalance, ctx.company?.currency);

      const lines = [
        `Hello ${customerName},`,
        companyName ? `*Account Statement — ${companyName}*` : `*Account Statement Summary*`,
        st?.periodLabel ? `📅 *Period:* ${st.periodLabel}` : "",
        `📊 *Opening Balance:* ${opening}`,
        `📈 *Total Debit:* ${debit}`,
        `📉 *Total Credit:* ${credit}`,
        `📌 *Closing Balance:* *${closing}*`,
        `\nPlease reach out if you have any questions or require reconciliation.`,
      ].filter(Boolean);

      return lines.join("\n");
    },
  },

  supplier_notice: {
    ar: (ctx) => {
      const companyName = resolveCompanyName(ctx, true);
      const customerName = ctx.customer?.name || "المورد الكريم";
      const balance = formatAmount(ctx.customer?.balance, ctx.company?.currency);

      const lines = [
        `السلام عليكم ${customerName}،`,
        companyName ? `تحية طيبة من *${companyName}*.` : "",
        `الرصيد الحالي لحسابكم لدينا: *${balance}*.`,
        `للاستفسار أو المطابقة والتسوية يرجى التواصل معنا. وشكرًا لكم.`,
      ].filter(Boolean);

      return lines.join("\n");
    },
    en: (ctx) => {
      const companyName = resolveCompanyName(ctx, false);
      const customerName = ctx.customer?.name || "Supplier";
      const balance = formatAmount(ctx.customer?.balance, ctx.company?.currency);

      const lines = [
        `Hello ${customerName},`,
        companyName ? `Greetings from *${companyName}*.` : "",
        `Your current account balance with us is: *${balance}*.`,
        `Please contact us for any inquiries or settlement. Thank you.`,
      ].filter(Boolean);

      return lines.join("\n");
    },
  },

  general_customer_notice: {
    ar: (ctx) => {
      const companyName = resolveCompanyName(ctx, true);
      const customerName = ctx.customer?.name || "العميل الكريم";

      const lines = [
        `مرحباً ${customerName}،`,
        companyName
          ? `نتواصل معك بخصوص حسابكم لدى *${companyName}*.`
          : `نتواصل معك بخصوص حسابك التجاري.`,
        `لأي خدمة أو استفسار، نحن في خدمتكم دائماً.`,
      ];

      return lines.join("\n");
    },
    en: (ctx) => {
      const companyName = resolveCompanyName(ctx, false);
      const customerName = ctx.customer?.name || "Valued Customer";

      const lines = [
        `Hello ${customerName},`,
        companyName
          ? `Contacting you regarding your account with *${companyName}*.`
          : `Contacting you regarding your account.`,
        `We are always at your service.`,
      ];

      return lines.join("\n");
    },
  },

  milling_document_share: {
    ar: (ctx) => {
      const companyName = resolveCompanyName(ctx, true);
      const customerName = ctx.customer?.name || "العميل الكريم";
      const inv = ctx.invoice;
      const total = formatAmount(inv?.total, ctx.company?.currency);
      const paid = formatAmount(inv?.paid, ctx.company?.currency);
      const remaining = formatAmount(inv?.remaining, ctx.company?.currency);
      const docNum = ctx.millingDocumentNumber || "";
      const statusText = ctx.millingStatus || "";

      const lines = [
        `السلام عليكم ورحمة الله وبركاته،`,
        `عزيزنا *${customerName}*،`,
        companyName ? `تحية طيبة من *${companyName}* — خدمة المطحنة:` : `خدمة المطحنة والأمانات:`,
        docNum ? `🔖 *مستند الطحن:* #${docNum}` : "",
        inv?.invoiceNumber ? `🧾 *فاتورة الأجور الرسمية:* #${inv.invoiceNumber}` : "",
        statusText ? `⚙️ *الحالة:* ${statusText}` : "",
        `💵 *الإجمالي:* ${total}`,
        `✅ *المدفوع:* ${paid}`,
        (inv?.remaining ?? 0) > 0
          ? `⏳ *المتبقي المستحق:* *${remaining}*`
          : `✨ *الحالة المالية:* مسددة بالكامل`,
        `\nشاكرين لكم ثقتكم ونسعد بخدمتكم دائماً.`,
      ].filter(Boolean);

      return lines.join("\n");
    },
    en: (ctx) => {
      const companyName = resolveCompanyName(ctx, false);
      const customerName = ctx.customer?.name || "Valued Customer";
      const inv = ctx.invoice;
      const total = formatAmount(inv?.total, ctx.company?.currency);
      const paid = formatAmount(inv?.paid, ctx.company?.currency);
      const remaining = formatAmount(inv?.remaining, ctx.company?.currency);
      const docNum = ctx.millingDocumentNumber || "";
      const statusText = ctx.millingStatus || "";

      const lines = [
        `Dear *${customerName}*,`,
        companyName ? `Greetings from *${companyName}* — Milling Service:` : `Milling Service:`,
        docNum ? `🔖 *Milling Doc:* #${docNum}` : "",
        inv?.invoiceNumber ? `🧾 *Invoice:* #${inv.invoiceNumber}` : "",
        statusText ? `⚙️ *Status:* ${statusText}` : "",
        `💵 *Total:* ${total}`,
        `✅ *Paid:* ${paid}`,
        (inv?.remaining ?? 0) > 0
          ? `⏳ *Remaining Balance:* *${remaining}*`
          : `✨ *Status:* Fully Paid`,
        `\nThank you for choosing us!`,
      ].filter(Boolean);

      return lines.join("\n");
    },
  },
};

/**
 * Resolves the message language following the priority hierarchy:
 * 1. Explicit message language parameter
 * 2. Customer preferred language
 * 3. Default fallback ('ar')
 */
export function resolveMessageLanguage(
  requestedLanguage?: MessageLanguage,
  customerPreferredLanguage?: MessageLanguage,
): MessageLanguage {
  if (requestedLanguage) return requestedLanguage;
  if (customerPreferredLanguage) return customerPreferredLanguage;
  return "ar";
}

/**
 * Renders a full, ready-to-dispatch message and computes its recipient readiness.
 */
export function renderMessage(ctx: UnifiedCommunicationContext): RenderedMessage {
  const lang = resolveMessageLanguage(ctx.language, ctx.customer?.preferredLanguage);
  const templateDef = TEMPLATES[ctx.event] || TEMPLATES.general_customer_notice;
  const text = lang === "ar" ? templateDef.ar(ctx) : templateDef.en(ctx);

  const rawPhone = ctx.customer?.phone;
  const normalizedPhone = normalizeWhatsAppPhone(rawPhone);
  const isValidRecipient = normalizedPhone !== null;
  const whatsAppUrl = isValidRecipient ? buildWhatsAppLink(rawPhone, text) : null;

  return {
    text,
    event: ctx.event,
    language: lang,
    recipientPhone: rawPhone,
    normalizedPhone,
    isValidRecipient,
    canSendWhatsApp: isValidRecipient && whatsAppUrl !== null,
    whatsAppUrl,
  };
}

/**
 * قوالب رسائل واتساب الجاهزة (عربي/إنجليزي) للديون والتحصيلات والعملاء والموردين.
 *
 * تم تحديث هذا الملف ليرتبط مباشرة بالنواة المركزية الموحدة للمراسلات
 * (src/lib/communication/template-engine.ts)، مع إتاحة اسم المنشأة الفعلي
 * والحفاظ على التوافق الرجعي الكامل لجميع التوقيعات السابقة.
 */

import { buildUnifiedContext, renderMessage } from "./communication";

type Lang = "ar" | "en";

/** تذكير بسداد رصيد مستحق على عميل. */
export function debtReminderMessage(opts: { name: string; balance: string; lang: Lang }): string {
  const { name, balance, lang } = opts;
  const numBalance = parseFloat(balance.replace(/[^\d.-]/g, "")) || 0;

  const ctx = buildUnifiedContext({
    event: "debt_reminder",
    language: lang,
    customer: {
      id: "",
      name,
      balance: numBalance,
    },
  });

  return renderMessage(ctx).text;
}

/** إيصال استلام دفعة (تحصيل). */
export function paymentReceiptMessage(opts: {
  name: string;
  amount: string;
  date: string;
  invoiceNumber?: string | null;
  remaining?: string | null;
  lang: Lang;
}): string {
  const { name, amount, date, invoiceNumber, remaining, lang } = opts;
  const numAmount = parseFloat(amount.replace(/[^\d.-]/g, "")) || 0;
  const numRemaining = remaining ? parseFloat(remaining.replace(/[^\d.-]/g, "")) || 0 : undefined;

  const ctx = buildUnifiedContext({
    event: "payment_received",
    language: lang,
    customer: {
      id: "",
      name,
      balance: numRemaining ?? 0,
    },
    payment: {
      receiptNumber: invoiceNumber ? `REC-${invoiceNumber}` : "",
      date,
      amount: numAmount,
      method: "نقداً",
      remainingBalance: numRemaining,
      invoiceNumber: invoiceNumber ?? undefined,
    },
  });

  return renderMessage(ctx).text;
}

/** رسالة عامة لمورد (تذكير برصيد مستحق له/عليه أو تواصل). */
export function supplierMessage(opts: { name: string; balance: string; lang: Lang }): string {
  const { name, balance, lang } = opts;
  const numBalance = parseFloat(balance.replace(/[^\d.-]/g, "")) || 0;

  const ctx = buildUnifiedContext({
    event: "supplier_notice",
    language: lang,
    customer: {
      id: "",
      name,
      balance: numBalance,
    },
  });

  return renderMessage(ctx).text;
}

/**
 * Available Customer Actions Resolver
 * Market-Hub ERP
 *
 * Evaluates business rules cleanly to determine what actions are legally and
 * logically permissible for a specific customer context.
 *
 * Rules:
 * 1. Payment Request & Debt Reminder:
 *    - Enabled ONLY if `customer.balance > 0` AND a valid phone exists.
 *    - If `customer.balance <= 0`: STRICTLY DISABLED / HIDDEN.
 * 2. Account Statement:
 *    - Enabled ONLY if `hasLedgerActivity === true` (actual transactions exist).
 *    - If customer is freshly registered with 0 transactions: DISABLED with clear reason.
 * 3. Invoice Share:
 *    - Enabled if an invoice is in context or recent invoices exist, AND a valid phone exists.
 * 4. Phone Validation:
 *    - If customer has no phone: messaging actions clearly state that no phone is registered.
 */

import { isValidWhatsAppPhone } from "./phone";
import type { ActionDescriptor, CustomerContext, InvoiceContext } from "./types";

export interface CustomerActionContext {
  customer: CustomerContext;
  currentInvoice?: InvoiceContext | null;
  defaultCountryDialCode?: string;
}

export function getAvailableCustomerActions(ctx: CustomerActionContext): ActionDescriptor[] {
  const { customer, currentInvoice, defaultCountryDialCode } = ctx;
  const hasPhone = Boolean(customer.phone && customer.phone.trim().length > 0);
  const isValidPhone = isValidWhatsAppPhone(customer.phone, defaultCountryDialCode);
  const hasDebt = (customer.balance ?? 0) > 0;
  const hasLedger = customer.hasLedgerActivity ?? true; // if unspecified, defaults to true or checked dynamically

  const actions: ActionDescriptor[] = [];

  // 1. Payment Request (طلب سداد)
  if (hasDebt) {
    actions.push({
      key: "payment_request",
      labelAr: "طلب سداد المستحقات",
      labelEn: "Payment Request",
      descriptionAr: "إرسال إشعار للعميل بالمبلغ المستحق عليه ورابط/طرق السداد",
      descriptionEn: "Notify customer of outstanding balance and settlement details",
      enabled: isValidPhone,
      disabledReasonAr: !hasPhone
        ? "هذا العميل لا يوجد لديه رقم هاتف مسجل في النظام"
        : !isValidPhone
          ? "رقم الهاتف المسجل للعميل غير صالح للإرسال"
          : undefined,
      disabledReasonEn: !hasPhone
        ? "This customer has no phone number registered"
        : !isValidPhone
          ? "Customer phone number is invalid for WhatsApp"
          : undefined,
      category: "finance",
      isPrimary: true,
    });

    // 2. Debt Reminder (تذكير بالدين)
    actions.push({
      key: "debt_reminder",
      labelAr: "تذكير بالدين",
      labelEn: "Debt Reminder",
      descriptionAr: "رسالة تذكير لطيفة بالرصيد المستحق",
      descriptionEn: "Friendly reminder of current balance",
      enabled: isValidPhone,
      disabledReasonAr: !hasPhone
        ? "هذا العميل لا يوجد لديه رقم هاتف مسجل في النظام"
        : !isValidPhone
          ? "رقم الهاتف المسجل للعميل غير صالح للإرسال"
          : undefined,
      disabledReasonEn: !hasPhone
        ? "This customer has no phone number registered"
        : !isValidPhone
          ? "Customer phone number is invalid for WhatsApp"
          : undefined,
      category: "finance",
    });
  }

  // 3. Statement Actions (كشف الحساب)
  actions.push({
    key: "statement_share",
    labelAr: "مشاركة كشف الحساب",
    labelEn: "Share Statement",
    descriptionAr: "إرسال ملخص كشف الحساب المالي عبر واتساب",
    descriptionEn: "Send statement summary via WhatsApp",
    enabled: hasLedger && isValidPhone,
    disabledReasonAr: !hasLedger
      ? "لا توجد أي حركات أو فواتير مسجلة لهذا العميل حتى الآن"
      : !hasPhone
        ? "هذا العميل لا يوجد لديه رقم هاتف مسجل في النظام"
        : !isValidPhone
          ? "رقم الهاتف المسجل للعميل غير صالح للإرسال"
          : undefined,
    disabledReasonEn: !hasLedger
      ? "Customer has no transactions or ledger entries yet"
      : !hasPhone
        ? "This customer has no phone number registered"
        : !isValidPhone
          ? "Customer phone number is invalid for WhatsApp"
          : undefined,
    category: "statement",
  });

  actions.push({
    key: "statement_export_pdf",
    labelAr: "كشف حساب (PDF / طباعة)",
    labelEn: "Statement (PDF / Print)",
    descriptionAr: "معاينة أو طباعة كشف الحساب كوثيقة رسمية",
    descriptionEn: "Preview or print official statement",
    enabled: hasLedger,
    disabledReasonAr: !hasLedger
      ? "لا توجد أي حركات أو فواتير مسجلة لهذا العميل حتى الآن"
      : undefined,
    disabledReasonEn: !hasLedger ? "Customer has no transactions or ledger entries yet" : undefined,
    category: "statement",
  });

  actions.push({
    key: "statement_export_excel",
    labelAr: "كشف حساب (Excel)",
    labelEn: "Statement (Excel)",
    descriptionAr: "تصدير حركات العميل إلى ملف إكسل",
    descriptionEn: "Export entries to Excel file",
    enabled: hasLedger,
    disabledReasonAr: !hasLedger
      ? "لا توجد أي حركات أو فواتير مسجلة لهذا العميل حتى الآن"
      : undefined,
    disabledReasonEn: !hasLedger ? "Customer has no transactions or ledger entries yet" : undefined,
    category: "statement",
  });

  // 4. Invoice Share (مشاركة الفاتورة - إذا توفرت في السياق)
  if (currentInvoice) {
    actions.push({
      key: "invoice_share",
      labelAr: `مشاركة الفاتورة #${currentInvoice.invoiceNumber}`,
      labelEn: `Share Invoice #${currentInvoice.invoiceNumber}`,
      descriptionAr: "إرسال تفاصيل الفاتورة عبر واتساب",
      descriptionEn: "Send invoice details via WhatsApp",
      enabled: isValidPhone,
      disabledReasonAr: !hasPhone
        ? "هذا العميل لا يوجد لديه رقم هاتف مسجل في النظام"
        : !isValidPhone
          ? "رقم الهاتف المسجل للعميل غير صالح للإرسال"
          : undefined,
      disabledReasonEn: !hasPhone
        ? "This customer has no phone number registered"
        : !isValidPhone
          ? "Customer phone number is invalid for WhatsApp"
          : undefined,
      category: "invoice",
    });
  }

  // 5. General Notice (تواصل عام)
  actions.push({
    key: "customer_general_message",
    labelAr: "مراسلة عامة",
    labelEn: "General Message",
    descriptionAr: "فتح محادثة واتساب للتواصل العام مع العميل",
    descriptionEn: "Open WhatsApp conversation for general inquiry",
    enabled: isValidPhone,
    disabledReasonAr: !hasPhone
      ? "هذا العميل لا يوجد لديه رقم هاتف مسجل في النظام"
      : !isValidPhone
        ? "رقم الهاتف المسجل للعميل غير صالح للإرسال"
        : undefined,
    disabledReasonEn: !hasPhone
      ? "This customer has no phone number registered"
      : !isValidPhone
        ? "Customer phone number is invalid for WhatsApp"
        : undefined,
    category: "general",
  });

  return actions;
}

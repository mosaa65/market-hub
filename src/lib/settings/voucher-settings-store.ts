"use client";

import * as React from "react";
import { playSuccessChime } from "@/lib/communication/audio";
import { money } from "@/lib/format";

export type VoucherTemplateId = "official" | "short" | "reminder";

export interface PostOperationVoucherSettings {
  /** تشغيل صوت الرنين الاحتفالي عند نجاح العملية */
  soundEnabled: boolean;
  /** مستوى صوت الرنين (0.1 إلى 1.0) */
  soundVolume: number;
  /** إظهار نافذة تفاصيل السند المنبثقة تلقائياً بعد كل عملية */
  autoShowVoucher: boolean;
  /** تشغيل الطباعة التلقائية فور ظهور السند */
  autoPrintOnSuccess: boolean;
  /** قالب نص الإشعار والسند الافتراضي */
  defaultTemplate: VoucherTemplateId;
  /** إظهار زر واتساب في السند */
  showWhatsAppButton: boolean;
  /** إظهار زر رسالة SMS في السند */
  showSmsButton: boolean;
  /** إظهار زر نسخ نص الإشعار للحافظة */
  showCopyButton: boolean;
  /** إظهار تفاصيل الرصيد المتبقي في السند */
  showRemainingBalance: boolean;
  /** إظهار اسم الخزينة أو الحساب البنكي */
  showTreasuryAccount: boolean;
}

export const DEFAULT_VOUCHER_SETTINGS: PostOperationVoucherSettings = {
  soundEnabled: true,
  soundVolume: 0.4,
  autoShowVoucher: true,
  autoPrintOnSuccess: false,
  defaultTemplate: "official",
  showWhatsAppButton: true,
  showSmsButton: true,
  showCopyButton: true,
  showRemainingBalance: true,
  showTreasuryAccount: true,
};

const STORAGE_KEY = "vortex_post_operation_voucher_settings";
const SETTINGS_EVENT = "vortex_voucher_settings_updated";

export function getVoucherSettings(): PostOperationVoucherSettings {
  if (typeof window === "undefined") return DEFAULT_VOUCHER_SETTINGS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_VOUCHER_SETTINGS;
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_VOUCHER_SETTINGS, ...parsed };
  } catch {
    return DEFAULT_VOUCHER_SETTINGS;
  }
}

export function saveVoucherSettings(
  partial: Partial<PostOperationVoucherSettings>,
): PostOperationVoucherSettings {
  const current = getVoucherSettings();
  const next = { ...current, ...partial };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent(SETTINGS_EVENT, { detail: next }));
    }
  } catch (err) {
    console.error("Failed to save voucher settings:", err);
  }
  return next;
}

export function resetVoucherSettings(): PostOperationVoucherSettings {
  try {
    localStorage.removeItem(STORAGE_KEY);
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent(SETTINGS_EVENT, { detail: DEFAULT_VOUCHER_SETTINGS }));
    }
  } catch (err) {
    console.error("Failed to reset voucher settings:", err);
  }
  return DEFAULT_VOUCHER_SETTINGS;
}

export function useVoucherSettings(): {
  settings: PostOperationVoucherSettings;
  updateSettings: (partial: Partial<PostOperationVoucherSettings>) => void;
  resetSettings: () => void;
  playChime: () => void;
} {
  const [settings, setSettings] = React.useState<PostOperationVoucherSettings>(getVoucherSettings);

  React.useEffect(() => {
    setSettings(getVoucherSettings());

    const handleUpdate = (e: Event) => {
      const custom = e as CustomEvent<PostOperationVoucherSettings>;
      if (custom.detail) {
        setSettings(custom.detail);
      } else {
        setSettings(getVoucherSettings());
      }
    };

    window.addEventListener(SETTINGS_EVENT, handleUpdate);
    window.addEventListener("storage", handleUpdate);
    return () => {
      window.removeEventListener(SETTINGS_EVENT, handleUpdate);
      window.removeEventListener("storage", handleUpdate);
    };
  }, []);

  const updateSettings = React.useCallback((partial: Partial<PostOperationVoucherSettings>) => {
    const updated = saveVoucherSettings(partial);
    setSettings(updated);
  }, []);

  const resetSettings = React.useCallback(() => {
    const def = resetVoucherSettings();
    setSettings(def);
  }, []);

  const playChime = React.useCallback(() => {
    if (settings.soundEnabled) {
      playSuccessChime({ volume: settings.soundVolume });
    }
  }, [settings.soundEnabled, settings.soundVolume]);

  return { settings, updateSettings, resetSettings, playChime };
}

export interface VoucherMessageContext {
  companyName?: string | null;
  partyName: string;
  partyType?: "customer" | "supplier";
  operationType?: "payment" | "invoice" | "purchase" | "debt" | "general";
  operationTitle: string;
  amount: number;
  currency?: string;
  referenceNumber?: string;
  date?: string;
  paymentMethod?: string | null;
  treasury?: string | null;
  remainingBalance?: number | null;
  notes?: string | null;
}

/**
 * بناء رسالة السند المالي بشكل احترافي ومرتب تماماً مثل صفحة تسليم الأمانات
 * ومصمم بحسب نوع السند (مبيعات، مشتريات، تحصيل، صرف).
 */
export function buildVoucherMessage(
  data: VoucherMessageContext,
  templateId: VoucherTemplateId = "official",
  isAr = true,
): string {
  const cur = data.currency || (isAr ? "ر.ي" : "YER");
  const formattedAmount = `${money(data.amount)} ${cur}`.trim();
  const ref = data.referenceNumber ? `#${data.referenceNumber}` : "";
  const companyTitle = data.companyName ? `*${data.companyName}*\n` : "";

  // 1. Short Template (شكر موجز)
  if (templateId === "short") {
    if (isAr) {
      let msg = companyTitle ? `${companyTitle}━━━━━━━━━━━━━━━\n` : "";
      msg += `🧾 *${data.operationTitle}*\n`;
      if (ref) msg += `🔢 رقم السند/المرجع: ${ref}\n`;
      msg += `👤 الطرف المعني: ${data.partyName}\n`;
      msg += `💰 المبلغ: ${formattedAmount}\n`;
      msg += `━━━━━━━━━━━━━━━\n`;
      msg += `شكراً لتعاملكم معنا — نسعد بخدمتكم دائماً ✨`;
      return msg;
    }
    let msg = companyTitle ? `${companyTitle}━━━━━━━━━━━━━━━\n` : "";
    msg += `🧾 *${data.operationTitle}*\n`;
    if (ref) msg += `🔢 Reference: ${ref}\n`;
    msg += `👤 Party: ${data.partyName}\n`;
    msg += `💰 Amount: ${formattedAmount}\n`;
    msg += `━━━━━━━━━━━━━━━\n`;
    msg += `Thank you for choosing our business ✨`;
    return msg;
  }

  // 2. Reminder Template (إشعار وتذكير بالرصيد المتبقي)
  if (templateId === "reminder") {
    if (isAr) {
      let msg = companyTitle ? `${companyTitle}━━━━━━━━━━━━━━━\n` : "";
      msg += `⚠️ *إشعار مالي وتذكير بالحساب*\n`;
      if (ref) msg += `🔢 رقم العملية: ${ref}\n`;
      msg += `👤 العميل: ${data.partyName}\n`;
      if (data.date) msg += `📅 التاريخ: ${data.date}\n`;
      msg += `💰 المبلغ المسجل: ${formattedAmount}\n`;
      if (data.paymentMethod) msg += `💳 طريقة السداد: ${data.paymentMethod}\n`;
      if (data.treasury) msg += `🏛️ الخزينة/الحساب: ${data.treasury}\n`;
      if (data.remainingBalance !== undefined && data.remainingBalance !== null) {
        if (data.remainingBalance > 0) {
          msg += `📊 الرصيد المتبقي ذمة: ${money(data.remainingBalance)} ${cur}\n`;
        } else {
          msg += `✅ تم تصفية كامل الرصيد المستحق (0 ${cur})\n`;
        }
      }
      msg += `━━━━━━━━━━━━━━━\n`;
      msg += `شاكرين التزامكم الدائم وحسن تعاونكم ✨`;
      return msg;
    }
    let msg = companyTitle ? `${companyTitle}━━━━━━━━━━━━━━━\n` : "";
    msg += `⚠️ *Account Notice & Balance Update*\n`;
    if (ref) msg += `🔢 Reference: ${ref}\n`;
    msg += `👤 Account: ${data.partyName}\n`;
    if (data.date) msg += `📅 Date: ${data.date}\n`;
    msg += `💰 Amount: ${formattedAmount}\n`;
    if (data.remainingBalance !== undefined && data.remainingBalance !== null) {
      msg += `📊 Remaining Balance: ${money(data.remainingBalance)} ${cur}\n`;
    }
    msg += `━━━━━━━━━━━━━━━\n`;
    msg += `Thank you for your cooperation ✨`;
    return msg;
  }

  // 3. Official Comprehensive (سند رسمي متكامل - مثل صفحة تسليم الأمانات تماماً)
  if (isAr) {
    const isPurchase = data.operationType === "purchase" || data.partyType === "supplier";
    const isPayment = data.operationType === "payment";

    let iconTitle = "📄 *سند وإشعار مالي معتمد*";
    if (isPurchase) iconTitle = "📦 *إشعار فاتورة توريد ومشتريات*";
    else if (isPayment) iconTitle = "📄 *سند قبض وتحصيل مالي*";
    else if (data.operationType === "invoice") iconTitle = "🧾 *فاتورة مبيعات إلكترونية معتمدة*";

    let msg = companyTitle ? `${companyTitle}━━━━━━━━━━━━━━━\n` : "";
    msg += `${iconTitle}\n`;
    if (ref) msg += `🔢 رقم السند/الفاتورة: ${ref}\n`;
    msg += `👤 ${data.partyType === "supplier" ? "المورد" : "العميل"}: ${data.partyName}\n`;
    if (data.date) msg += `📅 التاريخ: ${data.date}\n`;
    msg += `💰 ${isPurchase ? "إجمالي التوريد" : isPayment ? "المبلغ المحصل" : "إجمالي الفاتورة"}: ${formattedAmount}\n`;
    if (data.paymentMethod) msg += `💳 طريقة السداد: ${data.paymentMethod}\n`;
    if (data.treasury) msg += `🏛️ الخزينة/الحساب المالي: ${data.treasury}\n`;
    if (data.remainingBalance !== undefined && data.remainingBalance !== null) {
      if (data.remainingBalance > 0) {
        msg += `⚠️ الرصيد المتبقي ذمة: ${money(data.remainingBalance)} ${cur}\n`;
      } else {
        msg += `✅ الرصيد المتبقي: 0 ${cur} (مسدد بالكامل)\n`;
      }
    }
    if (data.notes) msg += `📝 ملاحظات: ${data.notes}\n`;
    msg += `━━━━━━━━━━━━━━━\n`;
    msg += `شكراً لتعاملكم معنا — نسعد بخدمتكم دائماً ✨`;
    return msg;
  }

  let msg = companyTitle ? `${companyTitle}━━━━━━━━━━━━━━━\n` : "";
  msg += `📄 *${data.operationTitle}*\n`;
  if (ref) msg += `🔢 Reference/Receipt: ${ref}\n`;
  msg += `👤 Party: ${data.partyName}\n`;
  if (data.date) msg += `📅 Date: ${data.date}\n`;
  msg += `💰 Amount: ${formattedAmount}\n`;
  if (data.paymentMethod) msg += `💳 Payment: ${data.paymentMethod}\n`;
  if (data.treasury) msg += `🏛️ Account: ${data.treasury}\n`;
  if (data.remainingBalance !== undefined && data.remainingBalance !== null) {
    msg += `📊 Remaining Balance: ${money(data.remainingBalance)} ${cur}\n`;
  }
  if (data.notes) msg += `📝 Notes: ${data.notes}\n`;
  msg += `━━━━━━━━━━━━━━━\n`;
  msg += `Thank you for your business ✨`;
  return msg;
}

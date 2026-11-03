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
  soundVolume: 0.25,
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
  partyName: string;
  partyType?: "customer" | "supplier";
  operationTitle: string;
  amount: number;
  currency?: string;
  referenceNumber?: string;
  date?: string;
  treasury?: string | null;
  remainingBalance?: number | null;
  notes?: string | null;
}

/**
 * بناء رسالة السند المالي بحسب القالب المختار
 */
export function buildVoucherMessage(
  data: VoucherMessageContext,
  templateId: VoucherTemplateId = "official",
  isAr = true,
): string {
  const cur = data.currency || "";
  const formattedAmount = `${money(data.amount)} ${cur}`.trim();
  const ref = data.referenceNumber ? `#${data.referenceNumber}` : "";

  if (templateId === "short") {
    if (isAr) {
      return `أستاذ/ة ${data.partyName}،
تم بنجاح تسجيل ${data.operationTitle} بمبلغ ${formattedAmount}${ref ? ` (مرجع: ${ref})` : ""}.
شاكرين حسن تعاملكم معنا.`;
    }
    return `Dear ${data.partyName},
Your ${data.operationTitle} of ${formattedAmount}${ref ? ` (Ref: ${ref})` : ""} has been processed successfully.
Thank you for your business.`;
  }

  if (templateId === "reminder") {
    if (isAr) {
      return `أستاذ/ة ${data.partyName}،
تم تسجيل ${data.operationTitle} بمبلغ ${formattedAmount}${ref ? ` (سند رقم: ${ref})` : ""}.
${
  data.remainingBalance !== undefined && data.remainingBalance !== null
    ? `نحيطكم علماً بأن الرصيد المتبقي بحسابكم هو: ${money(data.remainingBalance)} ${cur}\n`
    : ""
}شاكرين التزامكم الدائم وحسن تعاونكم.`;
    }
    return `Dear ${data.partyName},
Your ${data.operationTitle} of ${formattedAmount}${ref ? ` (Receipt: ${ref})` : ""} has been recorded.
${
  data.remainingBalance !== undefined && data.remainingBalance !== null
    ? `Remaining account balance: ${money(data.remainingBalance)} ${cur}\n`
    : ""
}Thank you for your cooperation.`;
  }

  // Official (سند رسمي متكامل)
  if (isAr) {
    return `مرحباً أستاذ/ة ${data.partyName}،
إشعار بعملية: ${data.operationTitle}
المبلغ: ${formattedAmount}
${ref ? `رقم السند/المرجع: ${ref}\n` : ""}${data.date ? `التاريخ: ${data.date}\n` : ""}${
      data.treasury ? `الجهة/الوعاء: ${data.treasury}\n` : ""
    }${
      data.remainingBalance !== undefined && data.remainingBalance !== null
        ? `الرصيد المتبقي: ${money(data.remainingBalance)} ${cur}\n`
        : ""
    }${data.notes ? `ملاحظات: ${data.notes}\n` : ""}شاكرين لكم ومقدرين حسن تعاونكم.`;
  }

  return `Hello ${data.partyName},
Transaction notice: ${data.operationTitle}
Amount: ${formattedAmount}
${ref ? `Reference/Receipt: ${ref}\n` : ""}${data.date ? `Date: ${data.date}\n` : ""}${
    data.treasury ? `Treasury/Account: ${data.treasury}\n` : ""
  }${
    data.remainingBalance !== undefined && data.remainingBalance !== null
      ? `Remaining balance: ${money(data.remainingBalance)} ${cur}\n`
      : ""
  }${data.notes ? `Notes: ${data.notes}\n` : ""}Thank you for your business.`;
}

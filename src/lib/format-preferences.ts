"use client";

export type DigitStyle = "latin" | "arabic";

const DIGIT_PREFERENCE_KEY = "vortex_digit_preference";

export function getDigitPreference(): DigitStyle {
  if (typeof window === "undefined") return "latin";
  return (localStorage.getItem(DIGIT_PREFERENCE_KEY) as DigitStyle) || "latin";
}

export function setDigitPreference(style: DigitStyle): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(DIGIT_PREFERENCE_KEY, style);
  window.dispatchEvent(new Event("vortex_digit_preference_changed"));
}

export function toSystemDigits(input: number | string, forceStyle?: DigitStyle): string {
  const style = forceStyle || getDigitPreference();
  const str = String(input);
  if (style !== "arabic") return str;

  const arabicDigits = ["٠", "١", "٢", "٣", "٤", "٥", "٦", "٧", "٨", "٩"];
  return str.replace(/[0-9]/g, (w) => arabicDigits[+w]);
}

export function formatSystemNumber(
  value: number | string,
  options?: { decimals?: number; currency?: string }
): string {
  const num = typeof value === "string" ? parseFloat(value) || 0 : value;
  const formatted = num.toLocaleString("en-US", {
    minimumFractionDigits: options?.decimals ?? 2,
    maximumFractionDigits: options?.decimals ?? 2,
  });

  const converted = toSystemDigits(formatted);
  if (options?.currency) {
    return `${converted} ${options.currency}`;
  }
  return converted;
}

const ARABIC_MONTHS = [
  "يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو",
  "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"
];

const ARABIC_DAYS = [
  "الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"
];

export function formatLuxuryDate(
  dateInput: string | Date,
  options?: { showDayName?: boolean; showYear?: boolean }
): { day: string; month: string; year: string; weekday: string; full: string } {
  const d = typeof dateInput === "string" ? new Date(dateInput) : dateInput;
  if (isNaN(d.getTime())) {
    return { day: "--", month: "--", year: "----", weekday: "--", full: "--" };
  }

  const dayStr = toSystemDigits(d.getDate());
  const monthStr = ARABIC_MONTHS[d.getMonth()];
  const yearStr = toSystemDigits(d.getFullYear());
  const weekdayStr = ARABIC_DAYS[d.getDay()];

  let full = `${dayStr} ${monthStr}`;
  if (options?.showYear !== false) full += ` ${yearStr}`;
  if (options?.showDayName) full = `${weekdayStr}، ${full}`;

  return {
    day: dayStr,
    month: monthStr,
    year: yearStr,
    weekday: weekdayStr,
    full,
  };
}

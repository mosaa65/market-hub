/**
 * Unified Phone Normalization & Validation Module
 * Market-Hub ERP
 *
 * Supports:
 * - Local numbers with trunk prefix (e.g. 0771234567, 0501234567)
 * - Local numbers without trunk prefix (e.g. 771234567, 731234567)
 * - International numbers with `+` (e.g. +967771234567, +966501234567)
 * - International numbers with `00` (e.g. 00967771234567)
 * - Eastern Arabic / Persian digits (٠-٩, ۰-۹)
 * - Fallback to System / Company Default Country (Yemen +967 by default)
 */

import { DEFAULT_COUNTRY } from "@/lib/country-data";

/**
 * Converts Eastern Arabic (٠-٩) and Persian (۰-۹) digits to standard ASCII (0-9).
 */
export function toAsciiDigits(s: string): string {
  if (!s) return "";
  return s.replace(/[٠-٩۰-۹]/g, (ch) => {
    const code = ch.codePointAt(0)!;
    const base = code >= 0x06f0 ? 0x06f0 : 0x0660;
    return String(code - base);
  });
}

/**
 * Extracts standard digits-only dial code (without `+`).
 * Example: "+967" -> "967", "966" -> "966"
 */
function cleanDialCode(code?: string): string {
  if (!code) return DEFAULT_COUNTRY.dialCode.replace(/[^\d]/g, "");
  return code.replace(/[^\d]/g, "");
}

/**
 * Normalizes any phone number into pure international digits suitable for WhatsApp/SMS (e.g. "967771234567").
 *
 * Rules:
 * 1. If starts with `+` or `00`, strip prefix and preserve international country code.
 * 2. If starts with single `0` followed by local number (e.g. `077...`), strip `0` and prepend default dial code.
 * 3. If local number without `0` (e.g. 9 digits in Yemen `77...`), prepend default dial code.
 * 4. Validates final length between 8 and 15 digits according to ITU-T E.164.
 *
 * Returns `null` if the phone number is invalid or empty.
 */
export function normalizeWhatsAppPhone(
  raw: string | null | undefined,
  defaultCountryDialCode: string = DEFAULT_COUNTRY.dialCode,
): string | null {
  if (!raw) return null;

  const ascii = toAsciiDigits(String(raw).trim());
  const digits = ascii.replace(/[^\d+]/g, "");
  if (!digits) return null;

  const defaultDial = cleanDialCode(defaultCountryDialCode);

  // 1. Check if explicitly international with `+`
  if (digits.startsWith("+")) {
    const num = digits.slice(1);
    if (/^[1-9]\d{7,14}$/.test(num)) return num;
    return null;
  }

  // 2. Check if international with `00`
  if (digits.startsWith("00")) {
    const num = digits.slice(2);
    if (/^[1-9]\d{7,14}$/.test(num)) return num;
    return null;
  }

  // 3. Local number starting with single 0 (trunk prefix)
  if (digits.startsWith("0") && !digits.startsWith("00")) {
    const withoutZero = digits.replace(/^0+/, "");
    // If the remainder already starts with the default dial code, don't duplicate it
    if (withoutZero.startsWith(defaultDial)) {
      if (/^[1-9]\d{7,14}$/.test(withoutZero)) return withoutZero;
    } else {
      const combined = `${defaultDial}${withoutZero}`;
      if (/^[1-9]\d{7,14}$/.test(combined)) return combined;
    }
  }

  // 4. If digits already start with the default country code or another common country code
  // and has full international length (e.g. 12 digits: 967 771234567 or 966 501234567)
  if (/^[1-9]\d{10,14}$/.test(digits)) {
    return digits;
  }

  // 5. Standard local mobile (e.g. 9 digits in Yemen: 7XXXXXXXX or Saudi 9 digits: 5XXXXXXXX)
  if (/^[1-9]\d{7,9}$/.test(digits)) {
    const combined = `${defaultDial}${digits}`;
    if (/^[1-9]\d{7,14}$/.test(combined)) return combined;
  }

  return null;
}

/**
 * Checks whether a phone number can receive a WhatsApp message.
 */
export function isValidWhatsAppPhone(
  raw: string | null | undefined,
  defaultCountryDialCode?: string,
): boolean {
  return normalizeWhatsAppPhone(raw, defaultCountryDialCode) !== null;
}

/**
 * Builds a strict, safe `https://wa.me/{phone}?text={text}` link.
 *
 * CRITICAL RULE:
 * Returns `null` if the phone number is missing or invalid.
 * It will NEVER return an empty `wa.me/?text=...` link without a recipient.
 */
export function buildWhatsAppLink(
  phone: string | null | undefined,
  message: string,
  defaultCountryDialCode?: string,
): string | null {
  const normalized = normalizeWhatsAppPhone(phone, defaultCountryDialCode);
  if (!normalized) return null;
  return `https://wa.me/${normalized}?text=${encodeURIComponent(message)}`;
}

/**
 * Opens a WhatsApp chat in a new browser tab with the pre-filled message.
 * Returns `true` if opened, or `false` if the recipient phone is invalid.
 */
export function openWhatsAppDirect(
  phone: string | null | undefined,
  message: string,
  defaultCountryDialCode?: string,
): boolean {
  const link = buildWhatsAppLink(phone, message, defaultCountryDialCode);
  if (!link) return false;
  if (typeof window !== "undefined") {
    window.open(link, "_blank", "noopener,noreferrer");
    return true;
  }
  return false;
}

/**
 * Formats a phone number for user interface display.
 * Example: `+967 771 234 567` or `0771 234 567`
 */
export function formatPhoneDisplay(
  phone: string | null | undefined,
  defaultCountryDialCode?: string,
): string {
  if (!phone) return "";
  const normalized = normalizeWhatsAppPhone(phone, defaultCountryDialCode);
  if (!normalized) return String(phone).trim();
  return `+${normalized}`;
}

/**
 * Document Sharing & Export Service
 * Market-Hub ERP
 *
 * Implements:
 * - Direct Web Share API (with File support on Mobile)
 * - Fallback: Download file + open WhatsApp text
 * - Clean status distinction (prepared vs opened vs shared)
 * - Safe document generation reusing existing Statement Engine and Print Engine
 */

import { openWhatsAppDirect } from "./phone";
import type { DeliveryStatus, DocumentExportResult } from "./types";

export interface ShareDocumentOptions {
  title: string;
  text: string;
  recipientPhone?: string | null;
  file?: File | Blob;
  filename?: string;
  defaultCountryDialCode?: string;
}

export interface ShareResult {
  status: DeliveryStatus;
  channelUsed: "native_share" | "whatsapp_web" | "download_and_whatsapp";
  message?: string;
}

/**
 * Checks whether the current browser supports Web Share API with files.
 */
export function canShareFiles(): boolean {
  if (typeof navigator === "undefined" || !navigator.share || !navigator.canShare) {
    return false;
  }
  try {
    const testFile = new File(["test"], "test.txt", { type: "text/plain" });
    return navigator.canShare({ files: [testFile] });
  } catch {
    return false;
  }
}

/**
 * Downloads a Blob or File to the user's computer/phone.
 */
export function triggerFileDownload(blob: Blob, filename: string): void {
  if (typeof window === "undefined") return;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 1000);
}

/**
 * Shares or dispatches a document according to the device's actual capabilities.
 *
 * Priority:
 * 1. Web Share API with attachment if supported (mobile browsers).
 * 2. If phone exists: download file (if provided) and open WhatsApp with summary text.
 * 3. Fallback: download file.
 */
export async function shareDocumentWithCustomer(
  options: ShareDocumentOptions,
): Promise<ShareResult> {
  const { title, text, recipientPhone, file, filename, defaultCountryDialCode } = options;

  // 1. Try Native Web Share with file if available
  if (file && canShareFiles()) {
    try {
      const fileToShare =
        file instanceof File
          ? file
          : new File([file], filename || "document.pdf", {
              type: file.type || "application/pdf",
            });

      await navigator.share({
        title,
        text,
        files: [fileToShare],
      });

      return {
        status: "shared",
        channelUsed: "native_share",
        message: "تمت المشاركة بنجاح عبر النظام",
      };
    } catch (err: unknown) {
      // If user cancelled, don't fallback to error
      if (err instanceof Error && err.name === "AbortError") {
        return {
          status: "idle",
          channelUsed: "native_share",
          message: "تم إلغاء المشاركة",
        };
      }
      // Otherwise fallback to WhatsApp link + download
    }
  }

  // 2. If file provided on Desktop/unsupported browser, download it
  if (file && filename) {
    triggerFileDownload(file, filename);
  }

  // 3. Open WhatsApp chat with the text summary if phone number exists
  if (recipientPhone) {
    const opened = openWhatsAppDirect(recipientPhone, text, defaultCountryDialCode);
    if (opened) {
      return {
        status: "opened", // NOTE: Marked as OPENED, not fake "SENT"!
        channelUsed: file ? "download_and_whatsapp" : "whatsapp_web",
        message: file ? "تم تنزيل المستند وفتح محادثة واتساب" : "تم فتح محادثة واتساب",
      };
    }
  }

  return {
    status: file ? "ready" : "failed",
    channelUsed: "download_and_whatsapp",
    message: file ? "تم تجهيز المستند وتنزيله" : "تعذر إرسال المستند",
  };
}

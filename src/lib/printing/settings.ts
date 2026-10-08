import type { InvoiceTemplateId } from "@/lib/templates";
import type { PrintingDocumentType } from "./document-types";
import type { PrintOrientation, PrintPaperId } from "./paper";
import type { PrintTheme } from "./themes";

export type PrintBehavior = "ask" | "direct" | "off" | "default";
export type PrintMethod = "browser" | "pdf" | "thermal";

export interface DocumentPrintOverride {
  templateId?: InvoiceTemplateId;
  theme?: PrintTheme;
  paperId?: PrintPaperId;
  orientation?: PrintOrientation;
  copies?: number;
  method?: PrintMethod;
  behavior?: PrintBehavior;
}

export interface UnifiedPrintSettings {
  behavior: PrintBehavior;
  method: PrintMethod;
  preview: boolean;
  copies: number;
  paperId: PrintPaperId;
  orientation: PrintOrientation;
  theme: PrintTheme;
  footerEnabled: boolean;
  overrides: Partial<Record<PrintingDocumentType, DocumentPrintOverride>>;
}

export const PRINT_SETTINGS_KEY = "vortex_print_settings_v2";
export const DEFAULT_UNIFIED_PRINT_SETTINGS: UnifiedPrintSettings = {
  behavior: "default",
  method: "browser",
  preview: true,
  copies: 1,
  paperId: "thermal-80",
  orientation: "portrait",
  theme: "standard",
  footerEnabled: true,
  overrides: {},
};

function validCopies(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(1, Math.min(20, Math.round(n))) : 1;
}

export function normalizePrintSettings(
  raw: Partial<UnifiedPrintSettings> | null | undefined,
): UnifiedPrintSettings {
  const legacy = raw as Partial<UnifiedPrintSettings> & {
    printMode?: string;
    defaultCustomerTemplate?: string;
    paperSize?: string;
  };
  const behavior: PrintBehavior =
    legacy.behavior ??
    (legacy.printMode === "auto" ? "direct" : legacy.printMode === "off" ? "off" : "ask");
  const paperId =
    legacy.paperId ??
    (legacy.paperSize === "58mm" ? "thermal-58" : legacy.paperSize === "A4" ? "a4" : "thermal-80");
  return {
    ...DEFAULT_UNIFIED_PRINT_SETTINGS,
    ...raw,
    behavior,
    paperId,
    copies: validCopies(raw?.copies),
  };
}

export function getUnifiedPrintSettings(): UnifiedPrintSettings {
  if (typeof window === "undefined") return DEFAULT_UNIFIED_PRINT_SETTINGS;
  try {
    const raw = localStorage.getItem(PRINT_SETTINGS_KEY);
    if (raw) return normalizePrintSettings(JSON.parse(raw));
    return normalizePrintSettings(
      JSON.parse(localStorage.getItem("vortex_print_settings") ?? "null"),
    );
  } catch {
    return DEFAULT_UNIFIED_PRINT_SETTINGS;
  }
}

export function saveUnifiedPrintSettings(
  patch: Partial<UnifiedPrintSettings>,
): UnifiedPrintSettings {
  const next = normalizePrintSettings({ ...getUnifiedPrintSettings(), ...patch });
  if (typeof window !== "undefined") localStorage.setItem(PRINT_SETTINGS_KEY, JSON.stringify(next));
  return next;
}

/**
 * Persist the current user's device-level printing preference only after an
 * explicit save action. The settings store is intentionally local: printing
 * behavior belongs to the signed-in operator/device, not the whole company.
 */
export function commitPrintSettings(settings: UnifiedPrintSettings): UnifiedPrintSettings {
  const next = normalizePrintSettings(settings);
  if (typeof window !== "undefined") {
    localStorage.setItem(PRINT_SETTINGS_KEY, JSON.stringify(next));
    localStorage.setItem("vortex_print_settings", JSON.stringify(next));
  }
  return next;
}

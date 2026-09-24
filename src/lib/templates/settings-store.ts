import { PrintSettings } from "./types";

export const DEFAULT_PRINT_SETTINGS: PrintSettings = {
  defaultCustomerTemplate: "thermal",
  defaultInventoryTemplate: "thermal",
  paperSize: "80mm",
  autoPrintCustomerInvoice: true,
  autoPrintInventoryDocument: false,
  printMode: "ask",
  showLogo: true,
  showCompanyInfo: true,
  showCustomerInfo: true,
  showDocNumberDate: true,
  showMovementInfo: true,
  showFinancialDetails: true,
  showPaymentInfo: true,
  showNotes: true,
  showSignatures: true,
  showFooter: true,
  showBranding: true,
};

const STORAGE_KEY = "vortex_print_settings";

export function getPrintSettings(): PrintSettings {
  if (typeof window === "undefined") {
    return DEFAULT_PRINT_SETTINGS;
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      // Fallback to legacy keys if present
      const legacyTemplate = localStorage.getItem("pos_default_template") || "thermal";
      const legacyMode = localStorage.getItem("pos_print_mode") as any || "ask";
      return {
        ...DEFAULT_PRINT_SETTINGS,
        defaultCustomerTemplate: legacyTemplate,
        printMode: legacyMode === "auto" || legacyMode === "ask" || legacyMode === "off" ? legacyMode : "ask",
      };
    }
    const parsed = JSON.parse(raw);
    return {
      ...DEFAULT_PRINT_SETTINGS,
      ...parsed,
    };
  } catch (err) {
    console.error("Failed to parse print settings from localStorage:", err);
    return DEFAULT_PRINT_SETTINGS;
  }
}

export function savePrintSettings(settings: Partial<PrintSettings>): PrintSettings {
  const current = getPrintSettings();
  const updated: PrintSettings = {
    ...current,
    ...settings,
  };

  if (typeof window !== "undefined") {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      // Sync legacy keys for backward compatibility
      localStorage.setItem("pos_default_template", updated.defaultCustomerTemplate);
      localStorage.setItem("pos_print_mode", updated.printMode);
    } catch (err) {
      console.error("Failed to save print settings to localStorage:", err);
    }
  }

  return updated;
}

import { InvoiceTemplateId, PrintSettings } from "./types";
import { supabase } from "@/integrations/supabase/client";

export const DEFAULT_PRINT_SETTINGS: PrintSettings = {
  defaultCustomerTemplate: "thermal",
  defaultInventoryTemplate: "thermal",
  defaultCustomerPaperProfile: "thermal-80",
  defaultInventoryPaperProfile: "thermal-80",
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
  showChange: true,
};

const STORAGE_KEY = "vortex_print_settings";

// Legacy keys kept in sync for backward compatibility with older screens
const LEGACY_TEMPLATE_KEY = "pos_default_template";
const LEGACY_MODE_KEY = "pos_print_mode";

const VALID_TEMPLATES: InvoiceTemplateId[] = [
  "thermal",
  "standard",
  "elegant",
  "unified-modern",
  "formal",
];
const VALID_MODES = ["auto", "ask", "off"] as const;

function readLegacyTemplate(): InvoiceTemplateId | null {
  const raw = localStorage.getItem(LEGACY_TEMPLATE_KEY);
  return raw && VALID_TEMPLATES.includes(raw) ? raw : null;
}

function readLegacyMode(): PrintSettings["printMode"] | null {
  const raw = localStorage.getItem(LEGACY_MODE_KEY);
  return raw && (VALID_MODES as readonly string[]).includes(raw)
    ? (raw as PrintSettings["printMode"])
    : null;
}

/**
 * Keep the derived boolean in sync with the print mode so that the
 * "auto print customer invoice" switch and the print mode never contradict.
 */
function reconcileModeAndAutoPrint(settings: PrintSettings): PrintSettings {
  if (settings.printMode === "off") {
    return { ...settings, autoPrintCustomerInvoice: false };
  }
  if (settings.printMode === "auto" && settings.autoPrintCustomerInvoice === false) {
    // User explicitly enabled auto printing via the switch while mode was "ask"
    return settings;
  }
  return settings;
}

export function getPrintSettings(): PrintSettings {
  if (typeof window === "undefined") {
    return DEFAULT_PRINT_SETTINGS;
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const legacyTemplate = readLegacyTemplate();
    const legacyMode = readLegacyMode();

    if (!raw) {
      // No unified settings yet — hydrate from legacy keys if present
      const hydrated: PrintSettings = {
        ...DEFAULT_PRINT_SETTINGS,
        defaultCustomerTemplate: legacyTemplate ?? DEFAULT_PRINT_SETTINGS.defaultCustomerTemplate,
        defaultCustomerPaperProfile: DEFAULT_PRINT_SETTINGS.defaultCustomerPaperProfile,
        defaultInventoryPaperProfile: DEFAULT_PRINT_SETTINGS.defaultInventoryPaperProfile,
        printMode: legacyMode ?? DEFAULT_PRINT_SETTINGS.printMode,
      };
      return reconcileModeAndAutoPrint(hydrated);
    }

    const parsed = JSON.parse(raw) as Partial<PrintSettings>;
    const merged: PrintSettings = {
      ...DEFAULT_PRINT_SETTINGS,
      ...parsed,
    };

    // If the unified store is stale but legacy keys changed elsewhere,
    // the legacy value wins (it is what older screens write on save).
    if (legacyTemplate && legacyTemplate !== merged.defaultCustomerTemplate) {
      merged.defaultCustomerTemplate = legacyTemplate;
    }
    if (legacyMode && legacyMode !== merged.printMode) {
      merged.printMode = legacyMode;
    }

    return reconcileModeAndAutoPrint(merged);
  } catch (err) {
    console.error("Failed to parse print settings from localStorage:", err);
    return DEFAULT_PRINT_SETTINGS;
  }
}

export function savePrintSettings(settings: Partial<PrintSettings>): PrintSettings {
  const current = getPrintSettings();
  const merged: PrintSettings = {
    ...current,
    ...settings,
  };

  // Turning the auto-print switch off means the user wants to be asked;
  // turning print mode to "off" disables auto printing entirely.
  if (settings.autoPrintCustomerInvoice !== undefined && !("printMode" in settings)) {
    merged.printMode = settings.autoPrintCustomerInvoice ? "auto" : "ask";
  }

  const updated = reconcileModeAndAutoPrint(merged);

  if (typeof window !== "undefined") {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      // Sync legacy keys so older screens (settings page, POS) stay consistent
      localStorage.setItem(LEGACY_TEMPLATE_KEY, updated.defaultCustomerTemplate);
      localStorage.setItem(LEGACY_MODE_KEY, updated.printMode);

      // Sync to Supabase company_settings for server-wide persistence
      (supabase as any)
        .from("company_settings")
        .select("catalog_modules")
        .eq("id", 1)
        .maybeSingle()
        .then(({ data }: any) => {
          if (data) {
            const currentCatalog = (data.catalog_modules as Record<string, any>) || {};
            const updatedCatalog = { ...currentCatalog, printSettings: updated };
            return (supabase as any)
              .from("company_settings")
              .update({ catalog_modules: updatedCatalog })
              .eq("id", 1);
          }
        })
        .then(
          () => {},
          (err: any) => console.warn("[print-settings] Cloud sync warning:", err),
        );
    } catch (err) {
      console.error("Failed to save print settings:", err);
    }
  }

  return updated;
}

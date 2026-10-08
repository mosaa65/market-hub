export interface StockSettings {
  skuPrefix: string;
  stackPrefix: string;
  batchPrefix: string;
  stackCodeFormat: "prefix_number" | "prefix_year_number" | "prefix_date_number";
  autoGenerateSku: boolean;
  autoGenerateStackCode: boolean;
  defaultMinStock: number;
  allowNegativeStock: boolean;
  paddingDigits: number;
}

export const DEFAULT_STOCK_SETTINGS: StockSettings = {
  skuPrefix: "PRD-",
  stackPrefix: "STK-",
  batchPrefix: "BAT-",
  stackCodeFormat: "prefix_year_number",
  autoGenerateSku: true,
  autoGenerateStackCode: true,
  defaultMinStock: 10,
  allowNegativeStock: false,
  paddingDigits: 4,
};

const STORAGE_KEY = "vortex_stock_settings";

export function getStockSettings(): StockSettings {
  if (typeof window === "undefined") {
    return DEFAULT_STOCK_SETTINGS;
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_STOCK_SETTINGS;
    const parsed = JSON.parse(raw);
    return {
      ...DEFAULT_STOCK_SETTINGS,
      ...parsed,
    };
  } catch (err) {
    console.error("Failed to parse stock settings:", err);
    return DEFAULT_STOCK_SETTINGS;
  }
}

export function saveStockSettings(patch: Partial<StockSettings>): StockSettings {
  const current = getStockSettings();
  const merged: StockSettings = {
    ...current,
    ...patch,
  };
  if (typeof window !== "undefined") {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
    } catch (err) {
      console.error("Failed to save stock settings:", err);
    }
  }
  return merged;
}

export function generateStackCode(seqNumber: number = 1, settings?: Partial<StockSettings>): string {
  const cfg = { ...getStockSettings(), ...settings };
  const prefix = (cfg.stackPrefix || "STK-").trim();
  const paddedSeq = String(seqNumber).padStart(cfg.paddingDigits || 4, "0");
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");

  switch (cfg.stackCodeFormat) {
    case "prefix_year_number":
      return `${prefix}${year}-${paddedSeq}`;
    case "prefix_date_number":
      return `${prefix}${year}${month}-${paddedSeq}`;
    case "prefix_number":
    default:
      return `${prefix}${paddedSeq}`;
  }
}

export function generateSkuCode(seqNumber: number = 100, settings?: Partial<StockSettings>): string {
  const cfg = { ...getStockSettings(), ...settings };
  const prefix = (cfg.skuPrefix || "PRD-").trim();
  const paddedSeq = String(seqNumber).padStart(cfg.paddingDigits || 4, "0");
  return `${prefix}${paddedSeq}`;
}

import { useEffect, useState, useSyncExternalStore } from "react";

export type BusinessProfile = "spare_parts" | "grocery" | "retail" | "custom";

export interface CatalogModulesConfig {
  profile: BusinessProfile;
  enableMakesAndModels: boolean; // ماركات وموديلات المركبات وتوافق القطع
  enableOrigins: boolean;        // بلدان المنشأ
  enableQualityGrades: boolean;  // درجات الجودة (أصلي / تجاري / وكالة)
  enableBrands: boolean;         // العلامات التجارية
  enableUnits: boolean;          // الوحدات
}

const STORAGE_KEY = "vortex_catalog_modules_v1";
const EVENT_NAME = "vortex_catalog_modules_changed";

export const DEFAULT_PROFILES: Record<BusinessProfile, CatalogModulesConfig> = {
  spare_parts: {
    profile: "spare_parts",
    enableMakesAndModels: true,
    enableOrigins: true,
    enableQualityGrades: true,
    enableBrands: true,
    enableUnits: true,
  },
  grocery: {
    profile: "grocery",
    enableMakesAndModels: false,
    enableOrigins: false,
    enableQualityGrades: false,
    enableBrands: true,
    enableUnits: true,
  },
  retail: {
    profile: "retail",
    enableMakesAndModels: false,
    enableOrigins: true,
    enableQualityGrades: false,
    enableBrands: true,
    enableUnits: true,
  },
  custom: {
    profile: "custom",
    enableMakesAndModels: true,
    enableOrigins: true,
    enableQualityGrades: true,
    enableBrands: true,
    enableUnits: true,
  },
};

export function getCatalogModulesConfig(): CatalogModulesConfig {
  if (typeof window === "undefined") return DEFAULT_PROFILES.spare_parts;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_PROFILES.spare_parts;
    const parsed = JSON.parse(raw);
    return {
      ...DEFAULT_PROFILES.spare_parts,
      ...parsed,
    };
  } catch {
    return DEFAULT_PROFILES.spare_parts;
  }
}

export function saveCatalogModulesConfig(config: CatalogModulesConfig): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
    window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: config }));
  } catch (err) {
    console.error("Failed to save catalog modules config:", err);
  }
}

export function useCatalogModules() {
  const [config, setConfigState] = useState<CatalogModulesConfig>(() => getCatalogModulesConfig());

  useEffect(() => {
    const handler = (e: Event) => {
      const customEvent = e as CustomEvent<CatalogModulesConfig>;
      if (customEvent.detail) {
        setConfigState(customEvent.detail);
      } else {
        setConfigState(getCatalogModulesConfig());
      }
    };
    window.addEventListener(EVENT_NAME, handler);
    window.addEventListener("storage", handler);
    return () => {
      window.removeEventListener(EVENT_NAME, handler);
      window.removeEventListener("storage", handler);
    };
  }, []);

  const updateConfig = (updates: Partial<CatalogModulesConfig>) => {
    const next: CatalogModulesConfig = {
      ...config,
      ...updates,
      profile: updates.profile ?? "custom",
    };
    setConfigState(next);
    saveCatalogModulesConfig(next);
  };

  const setProfile = (profile: BusinessProfile) => {
    const preset = DEFAULT_PROFILES[profile];
    setConfigState(preset);
    saveCatalogModulesConfig(preset);
  };

  const isTabEnabled = (tab: "categories" | "brands" | "units" | "origins" | "qualities" | "makes" | "models"): boolean => {
    switch (tab) {
      case "categories":
        return true; // Always enabled
      case "brands":
        return config.enableBrands;
      case "units":
        return config.enableUnits;
      case "origins":
        return config.enableOrigins;
      case "qualities":
        return config.enableQualityGrades;
      case "makes":
      case "models":
        return config.enableMakesAndModels;
      default:
        return true;
    }
  };

  return {
    config,
    updateConfig,
    setProfile,
    isTabEnabled,
  };
}

/**
 * Market-Hub ERP — Milling Operational Mode Management.
 *
 * Controls whether the application acts as:
 * 1. 'none'          - General enterprise/store (Supermarket, retail). Completely hides all milling features.
 * 2. 'simplified'    - Simplified mill: Direct intake, milling, single-screen billing & delivery, basic expenses.
 * 3. 'manufacturing' - Industrial mill: Production orders, BOM recipes, joint costing, work-in-progress ledger.
 * 4. 'hybrid'        - Dual-track: Both simplified express counter AND industrial production active simultaneously.
 *
 * Configurable strictly by Super Admin (Owner / Manager).
 */

import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type MillingMode = "none" | "simplified";
/** @deprecated الأوضاع القديمة — تُقرأ كـ 'simplified' للتوافق فقط. */
export type LegacyMillingMode = "manufacturing" | "hybrid";

export interface MillingModeConfig {
  mode: MillingMode;
  updatedAt?: string;
}

const STORAGE_KEY = "vortex_milling_mode_v1";
const EVENT_NAME = "vortex_milling_mode_changed";

export const MILLING_MODES: {
  id: MillingMode;
  titleAr: string;
  titleEn: string;
  badgeAr: string;
  badgeEn: string;
  descriptionAr: string;
  descriptionEn: string;
  suitableForAr: string;
}[] = [
  {
    id: "none",
    titleAr: "منشأة تجارية عامة (سوبرماركت / تجزئة ومبيعات)",
    titleEn: "General Business (Supermarket / Retail / Wholesale)",
    badgeAr: "بدون مطحنة",
    badgeEn: "General ERP",
    descriptionAr:
      "إخفاء كافة أقسام وشاشات وعمليات المطحنة تماماً. يعمل النظام كبرنامج ERP وسوبرماركت ومبيعات عامة نظيف.",
    descriptionEn:
      "Completely hides all flour mill and toll processing modules from the sidebar, search, and navigation.",
    suitableForAr:
      "السوبرماركت، محلات المواد الغذائية، التجزئة، قطع الغيار، والمؤسسات التجارية العامة.",
  },
  {
    id: "simplified",
    titleAr: "مطحنة — الخطة المبسطة (خدمي وتجاري مباشر)",
    titleEn: "Flour Mill — Simplified Workflow (Direct Service & Retail)",
    badgeAr: "موصى به للمطاحن العادية",
    badgeEn: "Recommended for Standard Mills",
    descriptionAr:
      "واجهة موحدة تجمع الاستلام، الطحن، الفوترة الفورية، والتسليم في شاشة واحدة منظمة، مع المبيعات والمصروفات العادية بدون تعقيد أوامر تصنيع.",
    descriptionEn:
      "Unified single-screen express counter for intake, milling, billing, and customer custody without production complexity.",
    suitableForAr:
      "أغلب المطاحن التجارية، مطاحن الحبوب المحلية، واستقبال الزبائن لطحن أكياسهم نقداً وتخزين أمانات التجار.",
  },
];

export function getMillingMode(): MillingMode {
  if (typeof window === "undefined") return "simplified";
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const mode = (raw && normalizeMode(raw)) || null;
    if (mode) {
      return mode;
    }
    return "simplified";
  } catch {
    return "simplified";
  }
}

/** القيم القديمة (قبل التبسيط) تُطابَق على الوضع المبسط. */
function normalizeMode(raw: string): MillingMode | null {
  if (raw === "none" || raw === "simplified") return raw;
  // 'manufacturing' و'hybrid' — أوضاع أُلغيت: تُقرأ كـ 'simplified'.
  if (raw === "manufacturing" || raw === "hybrid") return "simplified";
  return null;
}

export function saveMillingMode(mode: MillingMode): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, mode);
    window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: mode }));

    // Sync to Supabase company_settings catalog_modules
    (supabase as any)
      .from("company_settings")
      .select("catalog_modules")
      .eq("id", 1)
      .maybeSingle()
      .then(({ data }: any) => {
        const currentCatalog = (data?.catalog_modules as Record<string, any>) || {};
        const updated = { ...currentCatalog, millingMode: mode };
        return (supabase as any)
          .from("company_settings")
          .update({ catalog_modules: updated } as any)
          .eq("id", 1);
      })
      .then(
        () => {},
        (err: any) => console.error("Could not sync milling mode to cloud:", err),
      );
  } catch (err) {
    console.error("Failed to save milling mode:", err);
  }
}

export function useMillingMode() {
  const [mode, setModeState] = useState<MillingMode>(() => getMillingMode());

  useEffect(() => {
    // 1. Initial sync from remote DB if available
    (supabase as any)
      .from("company_settings")
      .select("catalog_modules")
      .eq("id", 1)
      .maybeSingle()
      .then(({ data }: any) => {
        const remoteMode = normalizeMode((data?.catalog_modules as any)?.millingMode);
        if (remoteMode) {
          if (remoteMode !== mode) {
            localStorage.setItem(STORAGE_KEY, remoteMode);
            setModeState(remoteMode);
          }
        }
      });

    // 2. Listen to local changes
    const handler = (e: Event) => {
      const customEvent = e as CustomEvent<MillingMode>;
      if (customEvent.detail) {
        setModeState(customEvent.detail);
      } else {
        setModeState(getMillingMode());
      }
    };

    window.addEventListener(EVENT_NAME, handler);
    return () => window.removeEventListener(EVENT_NAME, handler);
  }, []);

  const isMillingActive = mode === "simplified";

  return {
    mode,
    setMode: saveMillingMode,
    isMillingActive,
  };
}

/**
 * Checks if a specific path or nav item is allowed under the current milling mode.
 * بعد التبسيط: سؤال واحد فقط — هل المطحنة مفعّلة؟ (ق7)
 */
export function isRouteVisibleByMillingMode(pathname: string, mode: MillingMode): boolean {
  const clean = pathname.replace(/^\/_app/, "").replace(/\/$/, "");

  if (mode === "none") {
    if (clean === "/milling" || clean.startsWith("/milling/")) return false;
    return true;
  }

  // simplified: كل شاشات المطحنة المبسطة ظاهرة.
  return true;
}

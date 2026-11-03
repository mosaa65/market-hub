/**
 * سياق الوحدات — وحدة مستقلة عن تنفيذ الـ Provider.
 *
 * لماذا ملف منفصل؟ عند التحديث الحار (HMR) لملف `modules.tsx` يُعاد تقييم
 * الملف فيتكون كائن سياق React جديد، فتبقى الصفحات المحمّلة سابقاً (تقسيم
 * `tsr-split` للمسارات) مرتبطة بالكائن القديم بينما الـ Provider يوفر الجديد
 * → «useModules must be used within a ModulesProvider» رغم وجود الـ Provider.
 * بوضع السياق في ملف لا يتغير أبداً يبقى الكائن واحداً للجميع.
 */
import { createContext, useContext } from "react";
import type { PlatformModule, PlatformPlan, PlatformPlanId, QuotaCheckResult } from "@/lib/modules";

export interface ModulesContextType {
  currentPlanId: PlatformPlanId;
  currentPlan: PlatformPlan;
  plans: PlatformPlan[];
  modules: PlatformModule[];
  enabledModules: Set<string>;
  extraModules: string[];
  isModuleEnabled: (moduleId?: string) => boolean;
  isRouteEnabled: (pathname: string) => boolean;
  getRequiredModuleForRoute: (pathname: string) => PlatformModule | undefined;
  setPlan: (planId: PlatformPlanId) => Promise<boolean>;
  toggleExtraModule: (moduleId: string) => Promise<boolean>;
  resetToDefault: () => Promise<boolean>;
  isLoading: boolean;
  checkQuota: (
    resource: "users" | "warehouses" | "products",
    currentCount: number,
  ) => QuotaCheckResult;
}

export const ModulesContext = createContext<ModulesContextType | null>(null);

export function useModules(): ModulesContextType {
  const ctx = useContext(ModulesContext);
  if (!ctx) {
    throw new Error("useModules must be used within a ModulesProvider");
  }
  return ctx;
}

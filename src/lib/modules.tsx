/* eslint-disable react-refresh/only-export-components -- يصدّر ModuleGuard مع منظومة الوحدات والثوابت عمداً */
import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import { Lock, Sparkles, ArrowUpRight, CheckCircle2, ShieldAlert } from "lucide-react";
import { Link } from "@tanstack/react-router";

export type ModuleCategory = "core" | "module" | "addon" | "enterprise";
export type PlatformPlanId = "starter" | "professional" | "enterprise";

export interface PlatformModule {
  id: string;
  name: { ar: string; en: string };
  description: { ar: string; en: string };
  category: ModuleCategory;
  dependencies: string[];
  navItems: string[];
  routes: string[];
}

export interface PlatformPlan {
  id: PlatformPlanId;
  name: { ar: string; en: string };
  description: { ar: string; en: string };
  modules: string[];
  maxUsers: number;
  maxWarehouses: number;
  maxProducts: number | null;
  priceMonthly: number;
  recommendedBadge?: { ar: string; en: string };
}

// Built-in catalog of system modules
export const SYSTEM_MODULES: PlatformModule[] = [
  {
    id: "core",
    name: { ar: "النظام الأساسي", en: "Core ERP" },
    description: {
      ar: "المنتجات، المبيعات الأساسية، العملاء، المخزون، الإعدادات",
      en: "Products, Sales, Customers, Inventory, Settings",
    },
    category: "core",
    dependencies: [],
    navItems: [
      "/dashboard",
      "/products",
      "/catalog",
      "/inventory",
      "/sales",
      "/customers",
      "/settings",
      "/notifications",
      "/users",
    ],
    routes: [
      "/_app/dashboard",
      "/_app/products",
      "/_app/catalog",
      "/_app/inventory",
      "/_app/sales",
      "/_app/customers",
      "/_app/settings",
      "/_app/notifications",
      "/_app/users",
    ],
  },
  {
    id: "pos",
    name: { ar: "نقطة البيع السريعة (POS)", en: "Point of Sale (POS)" },
    description: {
      ar: "واجهة الكاشير السريعة مع دعم الباركود والطباعة الحرارية",
      en: "Fast cashier checkout interface with thermal printing",
    },
    category: "module",
    dependencies: ["core"],
    navItems: ["/pos"],
    routes: ["/_app/pos"],
  },
  {
    id: "purchases",
    name: { ar: "المشتريات والموردون", en: "Purchases & Suppliers" },
    description: {
      ar: "فواتير المشتريات، حسابات الموردين، وإدخال بضائع المخازن",
      en: "Purchase orders, vendor accounts and stock receiving",
    },
    category: "module",
    dependencies: ["core"],
    navItems: ["/purchases", "/suppliers"],
    routes: ["/_app/purchases", "/_app/suppliers"],
  },
  {
    id: "returns",
    name: { ar: "إدارة المرتجعات", en: "Returns Management" },
    description: {
      ar: "مرتجعات المبيعات والمشتريات وتسوية الذمم تلقائياً",
      en: "Customer and supplier returns with automatic balances adjustment",
    },
    category: "module",
    dependencies: ["core"],
    navItems: ["/sales-returns", "/purchase-returns"],
    routes: ["/_app/sales-returns", "/_app/purchase-returns"],
  },
  {
    id: "payments",
    name: { ar: "التحصيلات والديون وكشف الحساب", en: "Receivables & Payments" },
    description: {
      ar: "سندات القبض، متابعة الذمم والديون، وكشف حساب تفصيلي للعميل",
      en: "Receipt vouchers, receivables tracking and customer statements",
    },
    category: "module",
    dependencies: ["core"],
    navItems: ["/payments", "/debts", "/account-statement"],
    routes: ["/_app/payments", "/_app/debts", "/_app/account-statement"],
  },
  {
    id: "expenses",
    name: { ar: "المصروفات والمالية", en: "Expenses & Cashflow" },
    description: {
      ar: "تسجيل المصروفات التشغيلية والإدارية والتدفق المالي",
      en: "Track operational expenses and basic cashflow",
    },
    category: "module",
    dependencies: ["core"],
    navItems: ["/finance"],
    routes: ["/_app/finance"],
  },
  {
    id: "multi_warehouse",
    name: { ar: "تعدد المستودعات والتحويلات", en: "Multi-Warehouse & Transfers" },
    description: {
      ar: "إدارة فروع ومستودعات متعددة والتحويلات المخزنية بينها",
      en: "Multiple warehouses and inter-branch stock transfers",
    },
    category: "addon",
    dependencies: ["core"],
    navItems: ["/warehouses", "/transfers"],
    routes: ["/_app/warehouses", "/_app/transfers"],
  },
  {
    id: "barcode",
    name: { ar: "الباركود والملصقات", en: "Barcode & Labels" },
    description: {
      ar: "توليد ملصقات الباركود والطباعة والقراءة بالماسح والكاميرا",
      en: "Barcode generation, thermal barcode printing and scanning",
    },
    category: "addon",
    dependencies: ["core"],
    navItems: ["/barcodes"],
    routes: ["/_app/barcodes"],
  },
  {
    id: "loyalty",
    name: { ar: "برنامج ولاء العملاء", en: "Loyalty Program" },
    description: {
      ar: "منح نقاط عند الشراء ومكافأة العملاء واستبدال النقاط",
      en: "Customer reward points and redemption program",
    },
    category: "addon",
    dependencies: ["core"],
    navItems: ["/loyalty"],
    routes: ["/_app/loyalty"],
  },
  {
    id: "batches",
    name: { ar: "الدفعات وتواريخ الصلاحية", en: "Batch & Expiry Tracking" },
    description: {
      ar: "تتبع أرقام التشغيلات (Lot/Batch) وتواريخ انتهاء الصلاحية",
      en: "Lot tracking and shelf-life expiration alerts",
    },
    category: "addon",
    dependencies: ["core"],
    navItems: ["/batches"],
    routes: ["/_app/batches"],
  },
  {
    id: "advanced_accounting",
    name: { ar: "المحاسبة المتقدمة والتقارير الختامية", en: "Advanced Accounting" },
    description: {
      ar: "دفتر اليومية، ميزان المراجعة، قائمة الدخل، والميزانية العمومية",
      en: "Daily Journal, Trial Balance, Income Statement, and Balance Sheet",
    },
    category: "enterprise",
    dependencies: ["core", "expenses"],
    navItems: ["/daily-journal", "/trial-balance", "/income-statement", "/balance-sheet"],
    routes: [
      "/_app/daily-journal",
      "/_app/trial-balance",
      "/_app/income-statement",
      "/_app/balance-sheet",
    ],
  },
  {
    id: "analytics",
    name: { ar: "التحليلات المتقدمة والتقارير", en: "Advanced Analytics" },
    description: {
      ar: "رسوم بيانية تفاعلية، تحليل الربحية، والتقارير التشغيلية الموسعة",
      en: "In-depth visual charts, profitability insights and analytical reports",
    },
    category: "enterprise",
    dependencies: ["core"],
    navItems: ["/analytics", "/reports"],
    routes: ["/_app/analytics", "/_app/reports"],
  },
  {
    id: "audit",
    name: { ar: "سجل تدقيق العمليات (Audit Logs)", en: "Audit Trail Viewer" },
    description: {
      ar: "مراقبة كافة الحركات الإدارية والمالية مع هوية المستخدم والوقت",
      en: "Complete operational activity and security audit trail",
    },
    category: "enterprise",
    dependencies: ["core"],
    navItems: ["/audit"],
    routes: ["/_app/audit"],
  },
];

// Built-in plans definition
export const SYSTEM_PLANS: PlatformPlan[] = [
  {
    id: "starter",
    name: { ar: "الباقة الأساسية", en: "Starter Plan" },
    description: {
      ar: "للأنشطة الصغيرة: مبيعات ومخزون مبسط ومستودع واحد",
      en: "Essential single-location sales, products and inventory",
    },
    modules: ["core"],
    maxUsers: 1,
    maxWarehouses: 1,
    maxProducts: 500,
    priceMonthly: 0,
  },
  {
    id: "professional",
    name: { ar: "الباقة الاحترافية", en: "Professional Plan" },
    description: {
      ar: "للمتاجر ومحلات التجزئة: نقطة بيع، مشتريات، تحصيلات ومصروفات",
      en: "For growing stores: POS, purchases, returns, payments & expenses",
    },
    modules: ["core", "pos", "purchases", "returns", "payments", "expenses"],
    maxUsers: 5,
    maxWarehouses: 1,
    maxProducts: 5000,
    priceMonthly: 29,
    recommendedBadge: { ar: "الأكثر طلباً", en: "Most Popular" },
  },
  {
    id: "enterprise",
    name: { ar: "باقة المؤسسات المتكاملة", en: "Enterprise Suite" },
    description: {
      ar: "نظام ERP متكامل يشمل كافة الوحدات والمستودعات والمحاسبة والتحليلات",
      en: "Full ERP power: multi-warehouse, accounting, analytics, loyalty and audit",
    },
    modules: [
      "core",
      "pos",
      "purchases",
      "returns",
      "payments",
      "expenses",
      "multi_warehouse",
      "barcode",
      "loyalty",
      "batches",
      "advanced_accounting",
      "analytics",
      "audit",
    ],
    maxUsers: 50,
    maxWarehouses: 20,
    maxProducts: null,
    priceMonthly: 99,
  },
];

export interface QuotaCheckResult {
  allowed: boolean;
  limit: number | null;
  current: number;
  message?: { ar: string; en: string };
}

interface ModulesContextType {
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

const ModulesContext = createContext<ModulesContextType | null>(null);

const STORAGE_KEY_PLAN = "vortex_active_plan";
const STORAGE_KEY_EXTRAS = "vortex_extra_modules";

export function ModulesProvider({ children }: { children: React.ReactNode }) {
  const [currentPlanId, setCurrentPlanId] = useState<PlatformPlanId>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem(STORAGE_KEY_PLAN) as PlatformPlanId;
      if (saved && ["starter", "professional", "enterprise"].includes(saved)) {
        return saved;
      }
    }
    // Default to enterprise so existing apps continue to have all features open
    return "enterprise";
  });

  const [extraModules, setExtraModules] = useState<string[]>(() => {
    if (typeof window !== "undefined") {
      try {
        const saved = localStorage.getItem(STORAGE_KEY_EXTRAS);
        return saved ? JSON.parse(saved) : [];
      } catch {
        return [];
      }
    }
    return [];
  });

  const [isLoading, setIsLoading] = useState(true);

  // Load from Supabase (with graceful offline / fallback behavior)
  const refreshFromRemote = async () => {
    try {
      const { data, error } = await (supabase as any)
        .from("tenant_subscriptions")
        .select("plan_id, extra_modules, disabled_modules, status")
        .eq("tenant_id", "default")
        .maybeSingle();

      if (!error && data && data.plan_id) {
        const remotePlan = data.plan_id as PlatformPlanId;
        const remoteExtras = Array.isArray(data.extra_modules) ? data.extra_modules : [];
        setCurrentPlanId(remotePlan);
        setExtraModules(remoteExtras);
        if (typeof window !== "undefined") {
          localStorage.setItem(STORAGE_KEY_PLAN, remotePlan);
          localStorage.setItem(STORAGE_KEY_EXTRAS, JSON.stringify(remoteExtras));
        }
      }
    } catch {
      // Gracefully silent: fallback to local state/enterprise
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void refreshFromRemote();
  }, []);

  const currentPlan = useMemo<PlatformPlan>(() => {
    const found = SYSTEM_PLANS.find((p) => p.id === currentPlanId);
    if (found) return found;
    // Never allow an undefined plan: look up the safe built-in fallback by id
    // instead of by array index, which would return undefined if the list changes.
    const fallback = SYSTEM_PLANS.find((p) => p.id === "enterprise") ?? SYSTEM_PLANS[0];
    if (!fallback) {
      // Absolute last resort so consumers reading `currentPlan.name` never crash.
      return {
        id: "starter" as PlatformPlanId,
        name: { ar: "الباقة الأساسية", en: "Starter Plan" },
        description: { ar: "", en: "" },
        modules: ["core"],
        maxUsers: 1,
        maxWarehouses: 1,
        maxProducts: 500,
        priceMonthly: 0,
      };
    }
    return fallback;
  }, [currentPlanId]);

  const enabledModules = useMemo(() => {
    const set = new Set<string>(["core"]);
    // Modules from current active plan
    for (const m of currentPlan.modules) {
      set.add(m);
    }
    // Extra modules purchased/enabled
    for (const m of extraModules) {
      set.add(m);
    }
    return set;
  }, [currentPlan, extraModules]);

  const isModuleEnabled = (moduleId?: string): boolean => {
    if (!moduleId || moduleId === "core") return true;
    return enabledModules.has(moduleId);
  };

  const getRequiredModuleForRoute = (pathname: string): PlatformModule | undefined => {
    const clean = pathname.replace(/^\/_app/, "").replace(/\/$/, "");
    for (const m of SYSTEM_MODULES) {
      if (m.id === "core") continue;
      const matched = m.navItems.some((nav) => nav === clean || pathname === nav);
      if (matched) return m;
    }
    return undefined;
  };

  const isRouteEnabled = (pathname: string): boolean => {
    const req = getRequiredModuleForRoute(pathname);
    if (!req) return true;
    return isModuleEnabled(req.id);
  };

  const setPlan = async (newPlanId: PlatformPlanId): Promise<boolean> => {
    setCurrentPlanId(newPlanId);
    if (typeof window !== "undefined") {
      localStorage.setItem(STORAGE_KEY_PLAN, newPlanId);
    }
    try {
      await (supabase as any).from("tenant_subscriptions").upsert({
        tenant_id: "default",
        plan_id: newPlanId,
        extra_modules: extraModules,
        status: "active",
        updated_at: new Date().toISOString(),
      });
    } catch {
      // Handled via local storage
    }
    return true;
  };

  const toggleExtraModule = async (moduleId: string): Promise<boolean> => {
    const updated = extraModules.includes(moduleId)
      ? extraModules.filter((m) => m !== moduleId)
      : [...extraModules, moduleId];
    setExtraModules(updated);
    if (typeof window !== "undefined") {
      localStorage.setItem(STORAGE_KEY_EXTRAS, JSON.stringify(updated));
    }
    try {
      await (supabase as any).from("tenant_subscriptions").upsert({
        tenant_id: "default",
        plan_id: currentPlanId,
        extra_modules: updated,
        status: "active",
        updated_at: new Date().toISOString(),
      });
    } catch {
      // Handled via local storage
    }
    return true;
  };

  const resetToDefault = async (): Promise<boolean> => {
    return setPlan("enterprise");
  };

  const checkQuota = (
    resource: "users" | "warehouses" | "products",
    currentCount: number,
  ): QuotaCheckResult => {
    let limit: number | null = null;
    let nameAr = "";
    let nameEn = "";

    if (resource === "users") {
      limit = currentPlan.maxUsers;
      nameAr = "المستخدمين";
      nameEn = "users";
    } else if (resource === "warehouses") {
      limit = currentPlan.maxWarehouses;
      nameAr = "المستودعات";
      nameEn = "warehouses";
    } else if (resource === "products") {
      limit = currentPlan.maxProducts;
      nameAr = "المنتجات";
      nameEn = "products";
    }

    if (limit === null) {
      return { allowed: true, limit: null, current: currentCount };
    }

    const allowed = currentCount < limit;
    return {
      allowed,
      limit,
      current: currentCount,
      message: allowed
        ? undefined
        : {
            ar: `وصلت إلى الحد الأقصى المسموح به لـ ${nameAr} في ${currentPlan.name.ar} (${limit}). يرجى الترقية للمتابعة.`,
            en: `You have reached the maximum allowed ${nameEn} on the ${currentPlan.name.en} (${limit}). Please upgrade to add more.`,
          },
    };
  };

  return (
    <ModulesContext.Provider
      value={{
        currentPlanId,
        currentPlan,
        plans: SYSTEM_PLANS,
        modules: SYSTEM_MODULES,
        enabledModules,
        extraModules,
        isModuleEnabled,
        isRouteEnabled,
        getRequiredModuleForRoute,
        setPlan,
        toggleExtraModule,
        resetToDefault,
        isLoading,
        checkQuota,
      }}
    >
      {children}
    </ModulesContext.Provider>
  );
}

export function useModules() {
  const ctx = useContext(ModulesContext);
  if (!ctx) {
    throw new Error("useModules must be used within a ModulesProvider");
  }
  return ctx;
}

/**
 * Premium Upgrade Prompt & Feature Locked Banner
 */
export function ModuleLockedBanner({ moduleId }: { moduleId: string }) {
  const { lang, dir } = useI18n();
  const isAr = lang === "ar";
  const { modules, currentPlan, plans, toggleExtraModule, setPlan } = useModules();

  const mod = modules.find((m) => m.id === moduleId) || {
    id: moduleId,
    name: { ar: "هذه الميزة", en: "This Feature" },
    description: {
      ar: "هذه الوحدة غير مفعّلة في باقتك الحالية.",
      en: "This module is not enabled in your current plan.",
    },
    category: "module" as ModuleCategory,
    dependencies: [],
    navItems: [],
    routes: [],
  };

  const targetPlan =
    plans.find((p) => p.modules.includes(moduleId)) ??
    plans.find((p) => p.id === "enterprise") ??
    plans[0];

  return (
    <div className="flex min-h-[70vh] items-center justify-center p-4">
      <div className="relative w-full max-w-xl overflow-hidden rounded-2xl border border-border/80 bg-surface-1/90 p-8 shadow-2xl backdrop-blur-xl transition-all">
        {/* Decorative background glow */}
        <div className="pointer-events-none absolute -top-24 -end-24 h-64 w-64 rounded-full bg-primary/15 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-24 -start-24 h-64 w-64 rounded-full bg-amber-500/10 blur-3xl" />

        <div className="relative z-10 flex flex-col items-center text-center">
          {/* Badge */}
          <div className="mb-4 inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-xs font-semibold text-amber-500">
            <Lock className="h-3.5 w-3.5" />
            <span>
              {mod.category === "addon"
                ? isAr
                  ? "إضافة اختيارية (Add-on)"
                  : "Optional Add-on"
                : mod.category === "enterprise"
                  ? isAr
                    ? "باقة المؤسسات (Enterprise)"
                    : "Enterprise Suite"
                  : isAr
                    ? "باقة متقدمة"
                    : "Advanced Plan"}
            </span>
          </div>

          {/* Module Title */}
          <h2 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
            {isAr ? mod.name.ar : mod.name.en}
          </h2>

          <p className="mt-3 max-w-md text-sm text-muted-foreground leading-relaxed">
            {isAr ? mod.description.ar : mod.description.en}
          </p>

          {/* Current plan status notice */}
          <div className="mt-6 w-full rounded-xl border border-border/60 bg-surface-2/60 p-4 text-start">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">
                {isAr ? "باقتك الحالية:" : "Current plan:"}
              </span>
              <span className="font-semibold text-foreground">
                {isAr ? currentPlan.name.ar : currentPlan.name.en}
              </span>
            </div>
            <div className="mt-2 flex items-center justify-between text-xs">
              <span className="text-muted-foreground">{isAr ? "متاحة ضمن:" : "Available in:"}</span>
              <span className="font-semibold text-primary">
                {isAr ? targetPlan.name.ar : targetPlan.name.en}
              </span>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="mt-6 flex w-full flex-col sm:flex-row gap-3">
            <button
              type="button"
              onClick={() => void toggleExtraModule(moduleId)}
              className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-primary to-primary/85 px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/20 transition hover:brightness-110 active:scale-[0.98]"
            >
              <Sparkles className="h-4 w-4" />
              <span>{isAr ? "تفعيل هذه الإضافة فوراً" : "Enable as Add-on"}</span>
            </button>

            <button
              type="button"
              onClick={() => void setPlan("enterprise")}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-border/80 bg-surface-2 px-4 py-2.5 text-sm font-semibold text-foreground transition hover:bg-surface-3 active:scale-[0.98]"
            >
              <span>{isAr ? "الترقية للمؤسسات" : "Upgrade to Enterprise"}</span>
              <ArrowUpRight className="h-4 w-4" />
            </button>
          </div>

          <p className="mt-4 text-[11px] text-muted-foreground/80">
            {isAr
              ? "يمكنك دائماً تعديل باقاتك وتفعيل الإضافات من صفحة الإعدادات."
              : "You can manage subscriptions and add-ons anytime from Settings."}
          </p>
        </div>
      </div>
    </div>
  );
}

/**
 * Route / Component Guard for Modules
 */
export function ModuleGuard({
  moduleId,
  children,
  fallback,
  showLockedBanner = true,
}: {
  moduleId: string;
  children: React.ReactNode;
  fallback?: React.ReactNode;
  showLockedBanner?: boolean;
}) {
  const { isModuleEnabled } = useModules();

  if (isModuleEnabled(moduleId)) {
    return <>{children}</>;
  }

  if (fallback) {
    return <>{fallback}</>;
  }

  if (showLockedBanner) {
    return <ModuleLockedBanner moduleId={moduleId} />;
  }

  return null;
}

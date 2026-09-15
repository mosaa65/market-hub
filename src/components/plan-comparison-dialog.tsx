import React from "react";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/lib/auth";
import { useModules, PlatformPlanId } from "@/lib/modules";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Check,
  X,
  Sparkles,
  HelpCircle,
  Zap,
  Crown,
  ShieldCheck,
  Layers,
  ArrowRight,
} from "lucide-react";
import { toast } from "sonner";

interface FeatureRow {
  name: { ar: string; en: string };
  category: string;
  starter: boolean | string;
  professional: boolean | string;
  enterprise: boolean | string;
  tooltip?: { ar: string; en: string };
}

const COMPARISON_FEATURES: FeatureRow[] = [
  // Limits
  {
    name: { ar: "عدد المستخدمين المسموح", en: "User Accounts Limit" },
    category: "limits",
    starter: "1",
    professional: "5",
    enterprise: "50",
  },
  {
    name: { ar: "عدد المستودعات والفروع", en: "Warehouses & Branches" },
    category: "limits",
    starter: "1",
    professional: "1",
    enterprise: "20",
  },
  {
    name: { ar: "حد المنتجات", en: "Products Limit" },
    category: "limits",
    starter: "500",
    professional: "5,000",
    enterprise: "غير محدود",
  },
  // Core
  {
    name: { ar: "إدارة المنتجات والتصنيفات", en: "Products & Categories" },
    category: "core",
    starter: true,
    professional: true,
    enterprise: true,
  },
  {
    name: { ar: "إدارة العملاء", en: "Customers Management" },
    category: "core",
    starter: true,
    professional: true,
    enterprise: true,
  },
  {
    name: { ar: "فواتير المبيعات الأساسية", en: "Standard Sales Invoices" },
    category: "core",
    starter: true,
    professional: true,
    enterprise: true,
  },
  {
    name: { ar: "إدارة المخزون المحلي", en: "Single-Location Inventory" },
    category: "core",
    starter: true,
    professional: true,
    enterprise: true,
  },
  // Operations
  {
    name: { ar: "نقطة البيع السريعة (POS)", en: "High-Speed Point of Sale (POS)" },
    category: "ops",
    starter: false,
    professional: true,
    enterprise: true,
  },
  {
    name: { ar: "المشتريات وإدارة الموردين", en: "Purchases & Supplier Accounts" },
    category: "ops",
    starter: false,
    professional: true,
    enterprise: true,
  },
  {
    name: { ar: "إدارة مرتجعات البيع والشراء", en: "Sales & Purchase Returns" },
    category: "ops",
    starter: false,
    professional: true,
    enterprise: true,
  },
  // Finance
  {
    name: { ar: "سندات القبض ومتابعة الديون", en: "Receivables & Debt Tracking" },
    category: "finance",
    starter: false,
    professional: true,
    enterprise: true,
  },
  {
    name: { ar: "كشف حساب العميل التفصيلي", en: "Customer Account Statement" },
    category: "finance",
    starter: false,
    professional: true,
    enterprise: true,
  },
  {
    name: { ar: "تسجيل المصروفات والتدفق المالي", en: "Expenses & Cashflow" },
    category: "finance",
    starter: false,
    professional: true,
    enterprise: true,
  },
  // Add-ons
  {
    name: { ar: "تعدد المستودعات والتحويلات", en: "Multi-Warehouse & Transfers" },
    category: "addons",
    starter: "إضافة",
    professional: "إضافة",
    enterprise: true,
  },
  {
    name: { ar: "طباعة وقراءة الباركود", en: "Barcode Printing & Camera Scanner" },
    category: "addons",
    starter: "إضافة",
    professional: "إضافة",
    enterprise: true,
  },
  {
    name: { ar: "برنامج مكافآت ونقاط الولاء", en: "Customer Loyalty & Rewards" },
    category: "addons",
    starter: "إضافة",
    professional: "إضافة",
    enterprise: true,
  },
  {
    name: { ar: "أرقام التشغيلات وتواريخ الصلاحية", en: "Batch Tracking & Shelf-Life Expiry" },
    category: "addons",
    starter: "إضافة",
    professional: "إضافة",
    enterprise: true,
  },
  // Enterprise
  {
    name: { ar: "المحاسبة المتقدمة (4 تقارير ختامية)", en: "Advanced Accounting (4 Financial Reports)" },
    category: "enterprise",
    starter: false,
    professional: false,
    enterprise: true,
  },
  {
    name: { ar: "التحليلات المتقدمة والربحية", en: "Advanced Analytics & Charts" },
    category: "enterprise",
    starter: false,
    professional: false,
    enterprise: true,
  },
  {
    name: { ar: "سجل تدقيق الأمان والعمليات", en: "Security & Operational Audit Trail" },
    category: "enterprise",
    starter: false,
    professional: false,
    enterprise: true,
  },
];

export function PlanComparisonDialog({ trigger }: { trigger?: React.ReactNode }) {
  const { lang } = useI18n();
  const isAr = lang === "ar";
  const { currentPlanId, plans, setPlan } = useModules();
  const { isPlatformAdmin } = useAuth();
  const [open, setOpen] = React.useState(false);
  const [loadingPlan, setLoadingPlan] = React.useState<string | null>(null);

  const handleSelect = async (planId: PlatformPlanId) => {
    if (planId === currentPlanId) return;
    if (!isPlatformAdmin) {
      toast.info(
        isAr
          ? "لطلب ترقية الباقة وتفعيل الميزات فوراً، يرجى التواصل مع الإدارة: mousa.mc13@gmail.com"
          : "To request plan upgrade, contact platform admin: mousa.mc13@gmail.com",
        { duration: 5000 }
      );
      setOpen(false);
      return;
    }
    setLoadingPlan(planId);
    try {
      await setPlan(planId);
      toast.success(
        isAr
          ? `تم تحديث الباقة بنجاح إلى: ${planId === "starter" ? "الأساسية" : planId === "professional" ? "الاحترافية" : "المؤسسات"}`
          : `Plan updated to ${planId.toUpperCase()}`
      );
      setOpen(false);
    } catch {
      toast.error(isAr ? "تعذر تغيير الباقة" : "Failed to change plan");
    } finally {
      setLoadingPlan(null);
    }
  };

  const renderValue = (val: boolean | string) => {
    if (val === true) {
      return (
        <div className="flex items-center justify-center">
          <div className="grid h-5 w-5 place-items-center rounded-full bg-emerald-500/15 text-emerald-500">
            <Check className="h-3.5 w-3.5 stroke-[3]" />
          </div>
        </div>
      );
    }
    if (val === false) {
      return (
        <div className="flex items-center justify-center">
          <div className="grid h-5 w-5 place-items-center rounded-full bg-muted/60 text-muted-foreground/40">
            <X className="h-3 w-3 stroke-[2]" />
          </div>
        </div>
      );
    }
    if (val === "إضافة") {
      return (
        <div className="flex items-center justify-center">
          <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-500">
            {isAr ? "إضافة" : "Add-on"}
          </span>
        </div>
      );
    }
    return (
      <span className="font-semibold text-xs text-foreground font-mono">
        {val === "غير محدود" ? (isAr ? "غير محدود" : "Unlimited") : val}
      </span>
    );
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger || (
          <Button variant="outline" size="sm" className="rounded-full gap-1.5 text-xs font-semibold">
            <Sparkles className="h-3.5 w-3.5 text-primary" />
            <span>{isAr ? "مقارنة تفصيلية بين الباقات" : "Compare All Plans"}</span>
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col p-0 overflow-hidden bg-surface-1 border-border/80">
        <DialogHeader className="p-6 pb-4 border-b border-border/60">
          <div className="flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-xl bg-primary/10 text-primary">
              <Layers className="h-4 w-4" />
            </span>
            <div>
              <DialogTitle className="text-xl font-bold">
                {isAr ? "جدول المقارنة الشامل لباقات Vortex ERP" : "Vortex ERP Plans Comparison Matrix"}
              </DialogTitle>
              <p className="text-xs text-muted-foreground mt-0.5">
                {isAr
                  ? "اختر الباقة المناسبة لحجم أعمالك، ويمكنك الترقية أو إضافة موديولات منفصلة في أي وقت."
                  : "Compare feature coverage and scale your system as your business expands."}
              </p>
            </div>
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto p-6 pt-2">
          {/* Plan Header Cards */}
          <div className="grid grid-cols-4 gap-2 mb-4 sticky top-0 bg-surface-1/95 backdrop-blur-md py-3 z-20 border-b border-border/60">
            <div className="flex items-end pb-2">
              <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
                {isAr ? "الميزات والقدرات" : "Features & Limits"}
              </span>
            </div>

            {plans.map((p) => {
              const isCurrent = p.id === currentPlanId;
              return (
                <div
                  key={p.id}
                  className={`rounded-2xl p-3 border text-center transition ${
                    isCurrent
                      ? "border-primary bg-primary/10 shadow-sm ring-1 ring-primary/40"
                      : "border-border/60 bg-surface-2/60"
                  }`}
                >
                  <div className="text-xs font-bold text-foreground">
                    {isAr ? p.name.ar : p.name.en}
                  </div>
                  <div className="mt-1 text-sm font-extrabold text-foreground">
                    {p.priceMonthly === 0
                      ? isAr ? "مجاناً" : "Free"
                      : `$${p.priceMonthly}/${isAr ? "شهر" : "mo"}`}
                  </div>
                  <Button
                    size="sm"
                    disabled={isCurrent || loadingPlan === p.id}
                    onClick={() => void handleSelect(p.id)}
                    className={`mt-2 w-full h-7 text-[11px] rounded-full font-semibold ${
                      isCurrent
                        ? "bg-primary/20 text-primary hover:bg-primary/20 cursor-default"
                        : "bg-primary text-primary-foreground hover:opacity-90"
                    }`}
                  >
                    {isCurrent
                      ? isAr ? "الباقة الحالية" : "Current"
                      : isAr ? "ترقية للباقة" : "Switch"}
                  </Button>
                </div>
              );
            })}
          </div>

          {/* Feature Matrix Rows */}
          <div className="space-y-1">
            {COMPARISON_FEATURES.map((feat, idx) => (
              <div
                key={idx}
                className="grid grid-cols-4 items-center gap-2 px-3 py-2.5 rounded-xl text-xs hover:bg-surface-2/60 transition border-b border-border/30 last:border-0"
              >
                <div className="font-medium text-foreground pe-2">
                  {isAr ? feat.name.ar : feat.name.en}
                </div>
                <div className="text-center">{renderValue(feat.starter)}</div>
                <div className="text-center">{renderValue(feat.professional)}</div>
                <div className="text-center">{renderValue(feat.enterprise)}</div>
              </div>
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

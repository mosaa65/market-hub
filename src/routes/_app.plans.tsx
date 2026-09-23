import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import {
  Crown,
  Check,
  Sparkles,
  Zap,
  Shield,
  HelpCircle,
  Layers,
  Package,
  Users,
  Boxes,
  ArrowRight,
  CheckCircle2,
  Mail,
  Phone,
  ExternalLink,
} from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/lib/auth";
import { useModules, PlatformPlanId } from "@/lib/modules";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { PlanComparisonDialog } from "@/components/plan-comparison-dialog";

export const Route = createFileRoute("/_app/plans")({
  head: () => ({ meta: [{ title: "باقات واشتراكات النظام — Vortex ERP Plans" }] }),
  component: PlansShowcasePage,
});

function PlansShowcasePage() {
  const { lang } = useI18n();
  const isAr = lang === "ar";
  const { isPlatformAdmin, isPlatformSuperadmin, hasRole } = useAuth();
  const canEditPlan = isPlatformAdmin || isPlatformSuperadmin || hasRole("owner");
  const { currentPlanId, plans, setPlan } = useModules();
  const [loadingPlan, setLoadingPlan] = useState<string | null>(null);

  const handlePlanAction = async (planId: PlatformPlanId) => {
    if (planId === currentPlanId) return;

    if (canEditPlan) {
      setLoadingPlan(planId);
      try {
        await setPlan(planId);
        toast.success(
          isAr
            ? `تم تحديث الباقة بنجاح إلى: ${planId === "starter" ? "الأساسية" : planId === "professional" ? "الاحترافية" : "المؤسسات"}`
            : `Plan activated: ${planId.toUpperCase()}`,
        );
      } catch {
        toast.error(isAr ? "تعذر تغيير الباقة" : "Failed to change plan");
      } finally {
        setLoadingPlan(null);
      }
    } else {
      // Regular user / tenant owner upgrade request
      toast.info(
        isAr
          ? "لطلب ترقية الباقة وتفعيل الميزات فوراً، يرجى التواصل مع الدعم: mousa.mc13@gmail.com"
          : "To request plan upgrade, please contact support: mousa.mc13@gmail.com",
        { duration: 6000 },
      );
    }
  };

  return (
    <div className="space-y-8 pb-12">
      <PageHeader
        title={isAr ? "باقات واشتراكات نظام فورتيكس ERP" : "Vortex ERP Plans & Subscriptions"}
        subtitle={
          isAr
            ? "اختر الباقة المناسبة لحجم نشاطك التجاري. يمكنك الترقية أو إضافة ميزات مستقلة في أي وقت."
            : "Choose the ideal plan for your business scale. Upgrade or add custom modules anytime."
        }
        actions={
          <PlanComparisonDialog
            trigger={
              <Button variant="outline" className="gap-2 rounded-full border-primary/40 text-xs">
                <Sparkles className="h-4 w-4 text-primary" />
                <span>{isAr ? "جدول مقارنة الباقات الكامل" : "Full Plan Comparison Matrix"}</span>
              </Button>
            }
          />
        }
      />

      {/* Pricing Cards Grid - Mobile Friendly */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 lg:gap-8 items-stretch">
        {plans.map((p) => {
          const isCurrent = p.id === currentPlanId;
          const isPro = p.id === "professional";
          const isEnterprise = p.id === "enterprise";

          return (
            <div
              key={p.id}
              className={cn(
                "relative flex flex-col justify-between rounded-3xl p-6 sm:p-8 transition-all duration-300",
                "border backdrop-blur-xl",
                isCurrent
                  ? "border-primary bg-gradient-to-b from-primary/15 via-surface/90 to-surface shadow-2xl ring-2 ring-primary/40"
                  : isPro
                    ? "border-emerald-500/40 bg-gradient-to-b from-emerald-500/10 via-surface/80 to-surface shadow-xl hover:border-emerald-500/60"
                    : "border-border/70 bg-surface/70 hover:border-border hover:bg-surface/90 shadow-md",
              )}
            >
              {/* Badges */}
              <div className="absolute -top-3.5 inset-x-0 flex justify-center">
                {isCurrent && (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-primary px-3.5 py-1 text-xs font-bold text-primary-foreground shadow-md">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    <span>{isAr ? "باقتك النشطة حالياً" : "Current Active Plan"}</span>
                  </span>
                )}
                {!isCurrent && p.recommendedBadge && (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-gradient-to-r from-amber-500 to-amber-600 px-3.5 py-1 text-xs font-bold text-white shadow-md">
                    <Sparkles className="h-3.5 w-3.5" />
                    <span>{isAr ? p.recommendedBadge.ar : p.recommendedBadge.en}</span>
                  </span>
                )}
                {!isCurrent && isEnterprise && (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-gradient-to-r from-purple-600 to-indigo-600 px-3.5 py-1 text-xs font-bold text-white shadow-md">
                    <Crown className="h-3.5 w-3.5" />
                    <span>{isAr ? "حلول متقدمة وشاملة" : "Enterprise Grade"}</span>
                  </span>
                )}
              </div>

              <div>
                {/* Header */}
                <div className="mt-2 text-center sm:text-start">
                  <h3 className="text-xl sm:text-2xl font-bold tracking-tight text-foreground">
                    {isAr ? p.name.ar : p.name.en}
                  </h3>
                  <p className="mt-2 text-xs sm:text-sm text-muted-foreground leading-relaxed min-h-[40px]">
                    {isAr ? p.description.ar : p.description.en}
                  </p>
                </div>

                {/* Price Display */}
                <div className="mt-6 flex items-baseline justify-center sm:justify-start gap-1 pb-6 border-b border-border/60">
                  <span className="text-4xl sm:text-5xl font-extrabold tracking-tight text-foreground font-mono">
                    ${p.priceMonthly}
                  </span>
                  <span className="text-xs sm:text-sm text-muted-foreground font-medium">
                    / {isAr ? "شهرياً" : "month"}
                  </span>
                </div>

                {/* Capacity Limits List */}
                <div className="mt-6 space-y-3 text-xs sm:text-sm">
                  <div className="flex items-center justify-between text-muted-foreground">
                    <span className="flex items-center gap-2">
                      <Users className="h-4 w-4 text-primary" />
                      <span>{isAr ? "عدد المستخدمين المصرحين" : "Authorized Users"}</span>
                    </span>
                    <span className="font-bold text-foreground font-mono">{p.maxUsers}</span>
                  </div>

                  <div className="flex items-center justify-between text-muted-foreground">
                    <span className="flex items-center gap-2">
                      <Boxes className="h-4 w-4 text-cyan-500" />
                      <span>{isAr ? "عدد الفروع والمستودعات" : "Warehouses / Branches"}</span>
                    </span>
                    <span className="font-bold text-foreground font-mono">{p.maxWarehouses}</span>
                  </div>

                  <div className="flex items-center justify-between text-muted-foreground">
                    <span className="flex items-center gap-2">
                      <Package className="h-4 w-4 text-amber-500" />
                      <span>{isAr ? "الحد الأقصى للمنتجات" : "Product Catalog Limit"}</span>
                    </span>
                    <span className="font-bold text-foreground font-mono">
                      {p.maxProducts
                        ? p.maxProducts.toLocaleString()
                        : isAr
                          ? "غير محدود"
                          : "Unlimited"}
                    </span>
                  </div>
                </div>

                {/* Feature Highlights */}
                <div className="mt-6 pt-6 border-t border-border/50">
                  <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                    {isAr ? "أبرز الميزات المضمنة:" : "Included Highlights:"}
                  </div>
                  <ul className="space-y-2 text-xs sm:text-sm">
                    {p.modules.map((modId) => (
                      <li key={modId} className="flex items-center gap-2.5">
                        <div className="grid h-4 w-4 shrink-0 place-items-center rounded-full bg-emerald-500/15 text-emerald-500">
                          <Check className="h-2.5 w-2.5 stroke-[3]" />
                        </div>
                        <span className="text-foreground/90 font-medium">
                          {modId === "core" &&
                            (isAr
                              ? "إدارة المبيعات والمنتجات والمخزون"
                              : "Sales, Inventory & Products")}
                          {modId === "pos" &&
                            (isAr
                              ? "نقطة بيع سريعة (POS) والباركود"
                              : "Point of Sale (POS) & Scanning")}
                          {modId === "purchases" &&
                            (isAr ? "إدارة المشتريات والموردين" : "Purchases & Vendor Accounts")}
                          {modId === "returns" &&
                            (isAr ? "مرتجعات المبيعات والمشتريات" : "Sales & Purchase Returns")}
                          {modId === "payments" &&
                            (isAr ? "سندات القبض وكشوفات الحساب" : "Customer Ledger & Debt Rules")}
                          {modId === "expenses" &&
                            (isAr ? "المصروفات التشغيلية والمالية" : "Operational Expenses")}
                          {modId === "multi_warehouse" &&
                            (isAr
                              ? "تعدد الفروع والتحويلات المخزنية"
                              : "Multi-warehouse & Transfers")}
                          {modId === "barcode" &&
                            (isAr ? "تصميم وطباعة ملصقات الباركود" : "Barcode Labels Designer")}
                          {modId === "loyalty" &&
                            (isAr ? "برنامج نقاط ومكافآت الولاء" : "Loyalty Points & Rewards")}
                          {modId === "batches" &&
                            (isAr
                              ? "تتبع الدفعات وتواريخ الصلاحية"
                              : "Batch & Expiry Date Tracking")}
                          {modId === "advanced_accounting" &&
                            (isAr
                              ? "المحاسبة المتقدمة وميزان المراجعة"
                              : "Journal, Trial Balance & Statements")}
                          {modId === "analytics" &&
                            (isAr
                              ? "التحليلات المتقدمة والتقارير الذكية"
                              : "Advanced Analytics & Insights")}
                          {modId === "audit" &&
                            (isAr
                              ? "سجل التدقيق وتتبع العمليات"
                              : "Platform Audit & Security Logs")}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              {/* Action Button */}
              <div className="mt-8 pt-4">
                {isCurrent ? (
                  <Button
                    disabled
                    className="w-full rounded-2xl bg-primary/20 text-primary border border-primary/30 font-semibold cursor-default"
                  >
                    {isAr ? "أنت مشترك بهذه الباقة حالياً" : "Current Active Plan"}
                  </Button>
                ) : (
                  <Button
                    onClick={() => void handlePlanAction(p.id)}
                    disabled={loadingPlan === p.id}
                    className={cn(
                      "w-full rounded-2xl font-bold py-6 text-sm transition-all duration-300 shadow-md",
                      isPro
                        ? "bg-gradient-to-r from-emerald-500 to-teal-600 text-white hover:brightness-110 shadow-emerald-500/20"
                        : isEnterprise
                          ? "bg-gradient-to-r from-purple-600 to-indigo-600 text-white hover:brightness-110 shadow-purple-500/20"
                          : "bg-surface-2 hover:bg-surface-3 text-foreground border border-border",
                    )}
                  >
                    {loadingPlan === p.id ? (
                      <span className="flex items-center gap-2">
                        <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                        <span>{isAr ? "جاري التفعيل..." : "Activating..."}</span>
                      </span>
                    ) : canEditPlan ? (
                      isAr ? (
                        "تفعيل هذه الباقة فوراً"
                      ) : (
                        "Activate This Plan"
                      )
                    ) : isAr ? (
                      "طلب ترقية لهذه الباقة"
                    ) : (
                      "Request Upgrade"
                    )}
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Support / Custom Inquiries Banner */}
      <div className="rounded-3xl border border-primary/25 bg-gradient-to-r from-primary/10 via-surface/80 to-surface p-6 sm:p-8">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-6">
          <div className="space-y-2 text-center sm:text-start">
            <h4 className="text-lg font-bold text-foreground">
              {isAr
                ? "هل تحتاج ميزات مخصصة أو باقة مصممة خصيصاً لمؤسستك؟"
                : "Need custom enterprise features or SLA?"}
            </h4>
            <p className="text-xs sm:text-sm text-muted-foreground max-w-xl">
              {isAr
                ? "يمكنك طلب إضافة وحدات محددة دون الحاجة لترقية الباقة كاملة، أو الحصول على دعم مخصص ونقل بياناتك."
                : "You can license specific add-on modules independently, or request customized ERP integrations."}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <a
              href="mailto:mousa.mc13@gmail.com?subject=طلب ترقية باقة Vortex ERP"
              className="inline-flex items-center gap-2 rounded-2xl bg-primary px-5 py-3 text-xs font-bold text-primary-foreground shadow-lg hover:brightness-110 transition"
            >
              <Mail className="h-4 w-4" />
              <span>{isAr ? "تواصل مع الإدارة" : "Contact Sales / Admin"}</span>
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { useI18n } from "@/lib/i18n";
import { useModules, PlatformPlanId } from "@/lib/modules";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  Crown, Sparkles, CheckCircle2, Boxes, Layers, ScanBarcode, Gift,
  CalendarClock, Truck, RotateCcw, HandCoins, Wallet, BarChart3,
  History, BookOpen, ShieldCheck,
} from "lucide-react";

export function SubscriptionSettingsCard() {
  const { lang } = useI18n();
  const isAr = lang === "ar";
  const {
    currentPlanId,
    currentPlan,
    plans,
    modules,
    extraModules,
    isModuleEnabled,
    setPlan,
    toggleExtraModule,
  } = useModules();

  const [switching, setSwitching] = useState<string | null>(null);

  const handlePlanSelect = async (planId: PlatformPlanId) => {
    if (planId === currentPlanId) return;
    setSwitching(planId);
    try {
      await setPlan(planId);
      toast.success(
        isAr
          ? `تم تفعيل ${planId === "starter" ? "الباقة الأساسية" : planId === "professional" ? "الباقة الاحترافية" : "باقة المؤسسات"} بنجاح`
          : `Plan switched to ${planId.toUpperCase()} successfully`
      );
    } catch {
      toast.error(isAr ? "حدث خطأ أثناء تغيير الباقة" : "Error changing plan");
    } finally {
      setSwitching(null);
    }
  };

  const getModuleIcon = (id: string) => {
    switch (id) {
      case "pos": return <ScanBarcode className="h-4 w-4 text-emerald-500" />;
      case "purchases": return <Truck className="h-4 w-4 text-blue-500" />;
      case "returns": return <RotateCcw className="h-4 w-4 text-rose-500" />;
      case "payments": return <HandCoins className="h-4 w-4 text-amber-500" />;
      case "expenses": return <Wallet className="h-4 w-4 text-indigo-500" />;
      case "multi_warehouse": return <Boxes className="h-4 w-4 text-cyan-500" />;
      case "barcode": return <ScanBarcode className="h-4 w-4 text-violet-500" />;
      case "loyalty": return <Gift className="h-4 w-4 text-pink-500" />;
      case "batches": return <CalendarClock className="h-4 w-4 text-orange-500" />;
      case "advanced_accounting": return <BookOpen className="h-4 w-4 text-teal-500" />;
      case "analytics": return <BarChart3 className="h-4 w-4 text-sky-500" />;
      case "audit": return <History className="h-4 w-4 text-purple-500" />;
      default: return <Layers className="h-4 w-4 text-primary" />;
    }
  };

  return (
    <Card className="lg:col-span-2 border-primary/40 bg-gradient-to-br from-primary/5 via-surface to-surface-2/80 shadow-lg">
      <CardHeader>
        <CardTitle className="text-base flex items-center justify-between">
          <span className="flex items-center gap-2">
            <Crown className="h-5 w-5 text-amber-500" />
            {isAr ? "إدارة باقة النظام والوحدات (Packaging & Modules)" : "Subscription & Modules Packaging"}
          </span>
          <div className="flex items-center gap-2">
            <Link
              to="/platform-admin"
              className="inline-flex items-center gap-1.5 rounded-full bg-surface-2/90 border border-border/80 px-3 py-1 text-xs font-medium text-foreground hover:bg-surface-3 transition shadow-xs"
            >
              <ShieldCheck className="h-3.5 w-3.5 text-amber-500" />
              <span>{isAr ? "لوحة إدارة المنصة" : "Platform Admin"}</span>
            </Link>
            <span className="inline-flex items-center gap-1 rounded-full bg-primary/15 text-primary border border-primary/30 px-3 py-0.5 text-xs font-bold">
              <Sparkles className="h-3 w-3" />
              {isAr ? currentPlan.name.ar : currentPlan.name.en}
            </span>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Plans Selector */}
        <div>
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
            {isAr ? "اختر الباقة الحالية للنظام" : "Select Active Platform Plan"}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {plans.map((p) => {
              const active = p.id === currentPlanId;
              return (
                <div
                  key={p.id}
                  onClick={() => void handlePlanSelect(p.id)}
                  className={`relative cursor-pointer rounded-2xl border p-4 transition-all ${
                    active
                      ? "border-primary bg-primary/10 shadow-md ring-1 ring-primary/40"
                      : "border-border/80 bg-surface/60 hover:border-border hover:bg-surface"
                  }`}
                >
                  {p.recommendedBadge && (
                    <span className="absolute -top-2.5 end-3 rounded-full bg-gradient-to-r from-amber-500 to-orange-500 px-2.5 py-0.5 text-[10px] font-bold text-white shadow">
                      {isAr ? p.recommendedBadge.ar : p.recommendedBadge.en}
                    </span>
                  )}
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-sm text-foreground">
                      {isAr ? p.name.ar : p.name.en}
                    </span>
                    {active ? (
                      <CheckCircle2 className="h-4 w-4 text-primary" />
                    ) : (
                      <span className="h-4 w-4 rounded-full border border-border" />
                    )}
                  </div>
                  <p className="mt-1.5 text-xs text-muted-foreground leading-relaxed line-clamp-2">
                    {isAr ? p.description.ar : p.description.en}
                  </p>
                  <div className="mt-3 pt-2 border-t border-border/50 flex items-center justify-between text-[11px] text-muted-foreground">
                    <span>
                      {isAr ? "المستودعات:" : "Warehouses:"} {p.maxWarehouses}
                    </span>
                    <span>
                      {p.priceMonthly === 0
                        ? isAr ? "مجاناً" : "Free"
                        : `$${p.priceMonthly}/${isAr ? "شهر" : "mo"}`}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Modular Features Toggle */}
        <div className="pt-2 border-t border-border/60">
          <div className="flex items-center justify-between mb-3">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {isAr ? "الوحدات والإضافات الاختيارية (Modules & Add-ons)" : "Modules & Add-ons Management"}
              </div>
              <div className="text-[11px] text-muted-foreground mt-0.5">
                {isAr
                  ? "تتحكم هذه المفاتيح بما يظهر في القوائم والشاشات لجميع المستخدمين. يمكنك تشغيل أي ميزة كـ Add-on حتى لو لم تكن مضمنة في باقتك الأساسية."
                  : "These toggles control navigation and access across the ERP. You can enable any module as an individual add-on."}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
            {modules
              .filter((m) => m.id !== "core")
              .map((m) => {
                const inBasePlan = currentPlan.modules.includes(m.id);
                const enabled = isModuleEnabled(m.id);
                const isExtra = extraModules.includes(m.id);

                return (
                  <div
                    key={m.id}
                    className="flex items-center justify-between gap-3 p-3 rounded-xl border border-border/60 bg-surface/70 transition hover:bg-surface"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-surface-2 border border-border/50">
                        {getModuleIcon(m.id)}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-semibold text-foreground truncate">
                            {isAr ? m.name.ar : m.name.en}
                          </span>
                          {inBasePlan && (
                            <span className="rounded-full bg-emerald-500/15 text-emerald-500 text-[9px] font-medium px-1.5 py-0.2">
                              {isAr ? "ضمن الباقة" : "In Plan"}
                            </span>
                          )}
                          {isExtra && !inBasePlan && (
                            <span className="rounded-full bg-amber-500/15 text-amber-500 text-[9px] font-medium px-1.5 py-0.2">
                              {isAr ? "إضافة نشطة" : "Add-on"}
                            </span>
                          )}
                        </div>
                        <div className="text-[10px] text-muted-foreground truncate max-w-[240px]">
                          {isAr ? m.description.ar : m.description.en}
                        </div>
                      </div>
                    </div>

                    <Switch
                      checked={enabled}
                      disabled={inBasePlan}
                      onCheckedChange={() => void toggleExtraModule(m.id)}
                      title={inBasePlan ? (isAr ? "مضمنة في باقتك الحالية" : "Included in current plan") : undefined}
                    />
                  </div>
                );
              })}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

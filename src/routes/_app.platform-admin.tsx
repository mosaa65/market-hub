import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  ShieldCheck, Crown, Layers, Sparkles, CheckCircle2, Lock,
  RefreshCw, SlidersHorizontal, Users, Boxes, Activity, ArrowRight,
  TrendingUp, AlertCircle, Search, ExternalLink,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/lib/auth";
import { useModules, SYSTEM_PLANS, SYSTEM_MODULES, PlatformPlanId } from "@/lib/modules";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/platform-admin")({
  head: () => ({ meta: [{ title: "لوحة إدارة المنصة — Vortex Platform Admin" }] }),
  component: PlatformAdminPage,
});

function PlatformAdminPage() {
  const { lang } = useI18n();
  const isAr = lang === "ar";
  const { user } = useAuth();
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

  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<"overview" | "modules" | "plans" | "audit">("overview");
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(false);

  const loadAuditLogs = async () => {
    setLoadingLogs(true);
    try {
      const { data } = await (supabase as any)
        .from("platform_audit_logs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(50);
      setAuditLogs(data || []);
    } catch {
      // silent
    } finally {
      setLoadingLogs(false);
    }
  };

  useEffect(() => {
    if (activeTab === "audit") {
      void loadAuditLogs();
    }
  }, [activeTab]);

  // Mock / Remote tenant stats
  const stats = useMemo(() => {
    return {
      activeModulesCount: modules.filter((m) => isModuleEnabled(m.id)).length,
      totalModulesCount: modules.length,
      currentPlanName: isAr ? currentPlan.name.ar : currentPlan.name.en,
      planMaxWarehouses: currentPlan.maxWarehouses,
      planMaxUsers: currentPlan.maxUsers,
      planPrice: currentPlan.priceMonthly,
    };
  }, [modules, isModuleEnabled, currentPlan, isAr]);

  const handleToggleExtra = async (moduleId: string) => {
    await toggleExtraModule(moduleId);
    try {
      await (supabase as any).from("platform_audit_logs").insert({
        action: `TOGGLE_ADDON_${moduleId.toUpperCase()}`,
        target_tenant_id: "default",
        payload: { module_id: moduleId, enabled: !extraModules.includes(moduleId) },
      });
    } catch {}
  };

  const handlePlanChange = async (planId: PlatformPlanId) => {
    setLoading(true);
    try {
      await setPlan(planId);
      try {
        await (supabase as any).from("platform_audit_logs").insert({
          action: `PLAN_UPGRADE_${planId.toUpperCase()}`,
          target_tenant_id: "default",
          payload: { previous_plan: currentPlanId, new_plan: planId },
        });
      } catch {}
      toast.success(
        isAr
          ? `تم تحديث باقة المستأجر بنجاح إلى: ${planId.toUpperCase()}`
          : `Tenant plan updated to: ${planId.toUpperCase()}`
      );
    } catch {
      toast.error(isAr ? "حدث خطأ أثناء تحديث الباقة" : "Error updating plan");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={isAr ? "لوحة إدارة المنصة والباقات (Platform Administration)" : "Platform Administration & Licensing"}
        subtitle={
          isAr
            ? "التحكم المركزي في باقات المستأجرين، تراخيص الوحدات، وإدارة الـ Add-ons على مستوى المنصة."
            : "Centralized licensing, tenant plan allocations, and platform module entitlements."
        }
        actions={
          <div className="inline-flex items-center gap-2 rounded-full border border-amber-500/30 bg-amber-500/10 px-3.5 py-1.5 text-xs font-semibold text-amber-500">
            <ShieldCheck className="h-4 w-4" />
            <span>{isAr ? "صلاحيات إدارة المنصة (Superadmin)" : "Platform Superadmin Mode"}</span>
          </div>
        }
      />

      {/* KPI Overview Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="border-primary/30 bg-gradient-to-br from-primary/10 to-surface">
          <CardContent className="p-5 flex items-center justify-between">
            <div>
              <div className="text-xs text-muted-foreground">{isAr ? "الباقة الفعالة" : "Active Plan"}</div>
              <div className="mt-1 text-2xl font-bold text-foreground">{stats.currentPlanName}</div>
              <div className="mt-0.5 text-[11px] text-primary">
                ${stats.planPrice} / {isAr ? "شهر" : "month"}
              </div>
            </div>
            <div className="grid h-12 w-12 place-items-center rounded-2xl bg-primary/20 text-primary">
              <Crown className="h-6 w-6" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/70 bg-surface">
          <CardContent className="p-5 flex items-center justify-between">
            <div>
              <div className="text-xs text-muted-foreground">{isAr ? "الوحدات النشطة" : "Active Modules"}</div>
              <div className="mt-1 text-2xl font-bold text-foreground">
                {stats.activeModulesCount} <span className="text-sm font-normal text-muted-foreground">/ {stats.totalModulesCount}</span>
              </div>
              <div className="mt-0.5 text-[11px] text-emerald-500">
                {Math.round((stats.activeModulesCount / stats.totalModulesCount) * 100)}% {isAr ? "مفعل" : "enabled"}
              </div>
            </div>
            <div className="grid h-12 w-12 place-items-center rounded-2xl bg-emerald-500/10 text-emerald-500">
              <Layers className="h-6 w-6" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/70 bg-surface">
          <CardContent className="p-5 flex items-center justify-between">
            <div>
              <div className="text-xs text-muted-foreground">{isAr ? "سقف الفروع والمستودعات" : "Max Warehouses"}</div>
              <div className="mt-1 text-2xl font-bold text-foreground">{stats.planMaxWarehouses}</div>
              <div className="mt-0.5 text-[11px] text-muted-foreground">
                {stats.planMaxWarehouses > 1 ? (isAr ? "متعدد المستودعات" : "Multi-location") : (isAr ? "مستودع واحد" : "Single warehouse")}
              </div>
            </div>
            <div className="grid h-12 w-12 place-items-center rounded-2xl bg-cyan-500/10 text-cyan-500">
              <Boxes className="h-6 w-6" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/70 bg-surface">
          <CardContent className="p-5 flex items-center justify-between">
            <div>
              <div className="text-xs text-muted-foreground">{isAr ? "سقف المستخدمين" : "User Seat Limit"}</div>
              <div className="mt-1 text-2xl font-bold text-foreground">{stats.planMaxUsers}</div>
              <div className="mt-0.5 text-[11px] text-muted-foreground">
                {isAr ? "مستخدم مصرح به" : "Authorized seats"}
              </div>
            </div>
            <div className="grid h-12 w-12 place-items-center rounded-2xl bg-violet-500/10 text-violet-500">
              <Users className="h-6 w-6" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tabs Navigation */}
      <div className="flex items-center gap-2 border-b border-border pb-2">
        <button
          onClick={() => setActiveTab("overview")}
          className={`rounded-xl px-4 py-2 text-xs font-semibold transition ${
            activeTab === "overview"
              ? "bg-primary text-primary-foreground shadow-sm"
              : "text-muted-foreground hover:bg-surface hover:text-foreground"
          }`}
        >
          {isAr ? "تخصيص باقة المستأجر" : "Tenant Plan Allocations"}
        </button>
        <button
          onClick={() => setActiveTab("modules")}
          className={`rounded-xl px-4 py-2 text-xs font-semibold transition ${
            activeTab === "modules"
              ? "bg-primary text-primary-foreground shadow-sm"
              : "text-muted-foreground hover:bg-surface hover:text-foreground"
          }`}
        >
          {isAr ? "سجل الوحدات الكامل (Module Registry)" : "Module Registry"}
        </button>
        <button
          onClick={() => setActiveTab("plans")}
          className={`rounded-xl px-4 py-2 text-xs font-semibold transition ${
            activeTab === "plans"
              ? "bg-primary text-primary-foreground shadow-sm"
              : "text-muted-foreground hover:bg-surface hover:text-foreground"
          }`}
        >
          {isAr ? "تعريف الباقات والأسعار" : "Plan Tiers & Pricing"}
        </button>
        <button
          onClick={() => setActiveTab("audit")}
          className={`rounded-xl px-4 py-2 text-xs font-semibold transition ${
            activeTab === "audit"
              ? "bg-primary text-primary-foreground shadow-sm"
              : "text-muted-foreground hover:bg-surface hover:text-foreground"
          }`}
        >
          {isAr ? "سجل تدقيق المنصة (Platform Audit)" : "Platform Audit Trail"}
        </button>
      </div>

      {/* Tab 1: Tenant Allocation & Plan Control */}
      {activeTab === "overview" && (
        <div className="space-y-6">
          <Card className="border-border/80 bg-surface/80">
            <CardHeader>
              <CardTitle className="text-base flex items-center justify-between">
                <span>{isAr ? "تبديل الباقة المعتمدة للمستأجر" : "Switch Active Tenant Plan"}</span>
                <Badge variant="outline" className="font-mono text-xs">
                  Tenant ID: default
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {plans.map((p) => {
                  const active = p.id === currentPlanId;
                  return (
                    <div
                      key={p.id}
                      onClick={() => void handlePlanChange(p.id)}
                      className={`cursor-pointer rounded-2xl border p-5 transition-all ${
                        active
                          ? "border-primary bg-primary/10 shadow-lg ring-1 ring-primary"
                          : "border-border/70 bg-surface/50 hover:border-border hover:bg-surface"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-base text-foreground">
                          {isAr ? p.name.ar : p.name.en}
                        </span>
                        {active && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-primary text-primary-foreground px-2 py-0.5 text-[10px] font-bold">
                            <CheckCircle2 className="h-3 w-3" /> {isAr ? "مفعّلة حالياً" : "Current"}
                          </span>
                        )}
                      </div>
                      <p className="mt-2 text-xs text-muted-foreground leading-relaxed">
                        {isAr ? p.description.ar : p.description.en}
                      </p>
                      <div className="mt-4 pt-3 border-t border-border/60 flex items-center justify-between text-xs font-mono">
                        <span className="text-muted-foreground">{isAr ? "الوحدات:" : "Modules:"} {p.modules.length}</span>
                        <span className="font-bold text-foreground">${p.priceMonthly}/mo</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          {/* Add-on Entitlements Switcher */}
          <Card className="border-border/80 bg-surface/80">
            <CardHeader>
              <CardTitle className="text-base flex items-center justify-between">
                <span>{isAr ? "إدارة التراخيص الإضافية الممنوحة (Add-on Entitlements)" : "Add-on Entitlements Override"}</span>
                <span className="text-xs text-muted-foreground">
                  {extraModules.length} {isAr ? "إضافات مفعلة خارج الباقة" : "extra add-ons active"}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {modules
                  .filter((m) => m.id !== "core")
                  .map((m) => {
                    const inBase = currentPlan.modules.includes(m.id);
                    const enabled = isModuleEnabled(m.id);
                    const isExtra = extraModules.includes(m.id);

                    return (
                      <div
                        key={m.id}
                        className="flex items-center justify-between p-3.5 rounded-xl border border-border/60 bg-surface-2/50"
                      >
                        <div className="min-w-0 pe-2">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-xs text-foreground truncate">
                              {isAr ? m.name.ar : m.name.en}
                            </span>
                          </div>
                          <div className="text-[10px] text-muted-foreground truncate mt-0.5">
                            {inBase
                              ? (isAr ? "مضمنة في الباقة الأساسية" : "Included in Base Plan")
                              : isExtra
                              ? (isAr ? "مرخصة كإضافة مستقلة" : "Granted as Add-on")
                              : (isAr ? "غير مفعلة" : "Not Enabled")}
                          </div>
                        </div>

                        <Switch
                          checked={enabled}
                          disabled={inBase}
                          onCheckedChange={() => void handleToggleExtra(m.id)}
                        />
                      </div>
                    );
                  })}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Tab 2: Module Registry */}
      {activeTab === "modules" && (
        <Card className="border-border/80 bg-surface">
          <CardHeader>
            <CardTitle className="text-base">
              {isAr ? "سجل كافة وحدات نظام فورتيكس ERP" : "All Vortex ERP Platform Modules"}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border bg-surface-2/40 text-start text-muted-foreground uppercase">
                    <th className="p-3 font-semibold">{isAr ? "الوحدة" : "Module ID"}</th>
                    <th className="p-3 font-semibold">{isAr ? "الاسم العربي / الإنجليزي" : "Display Names"}</th>
                    <th className="p-3 font-semibold">{isAr ? "التصنيف" : "Category"}</th>
                    <th className="p-3 font-semibold">{isAr ? "التبعيات" : "Dependencies"}</th>
                    <th className="p-3 font-semibold">{isAr ? "المسارات المحمية" : "Guarded Routes"}</th>
                    <th className="p-3 text-end font-semibold">{isAr ? "الحالة الحالية" : "Current Status"}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {modules.map((m) => {
                    const active = isModuleEnabled(m.id);
                    return (
                      <tr key={m.id} className="hover:bg-surface-2/30 transition">
                        <td className="p-3 font-mono font-bold text-foreground">{m.id}</td>
                        <td className="p-3">
                          <div className="font-semibold text-foreground">{m.name.ar}</div>
                          <div className="text-[11px] text-muted-foreground">{m.name.en}</div>
                        </td>
                        <td className="p-3">
                          <span
                            className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${
                              m.category === "core"
                                ? "bg-blue-500/15 text-blue-500"
                                : m.category === "module"
                                ? "bg-emerald-500/15 text-emerald-500"
                                : m.category === "addon"
                                ? "bg-amber-500/15 text-amber-500"
                                : "bg-purple-500/15 text-purple-500"
                            }`}
                          >
                            {m.category}
                          </span>
                        </td>
                        <td className="p-3 text-muted-foreground font-mono">
                          {m.dependencies.length ? m.dependencies.join(", ") : "—"}
                        </td>
                        <td className="p-3 text-muted-foreground font-mono">
                          {m.navItems.join(", ")}
                        </td>
                        <td className="p-3 text-end">
                          {active ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 text-emerald-500 px-2 py-0.5 text-[10px] font-semibold">
                              <CheckCircle2 className="h-3 w-3" /> {isAr ? "نشطة" : "Active"}
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 rounded-full bg-muted text-muted-foreground px-2 py-0.5 text-[10px]">
                              <Lock className="h-3 w-3" /> {isAr ? "معطلة" : "Locked"}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Tab 3: Plans & Pricing */}
      {activeTab === "plans" && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {plans.map((p) => (
            <Card key={p.id} className="border-border/80 bg-surface flex flex-col justify-between">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-lg">{isAr ? p.name.ar : p.name.en}</CardTitle>
                  <span className="font-mono text-xl font-bold text-primary">
                    ${p.priceMonthly}
                    <span className="text-xs text-muted-foreground font-normal">/mo</span>
                  </span>
                </div>
                <p className="text-xs text-muted-foreground mt-1">{isAr ? p.description.ar : p.description.en}</p>
              </CardHeader>
              <CardContent className="space-y-4 flex-1">
                <div className="space-y-2 text-xs">
                  <div className="flex justify-between border-b border-border/50 py-1.5">
                    <span className="text-muted-foreground">{isAr ? "المستخدمين المسموحين:" : "Max Users:"}</span>
                    <span className="font-semibold text-foreground">{p.maxUsers}</span>
                  </div>
                  <div className="flex justify-between border-b border-border/50 py-1.5">
                    <span className="text-muted-foreground">{isAr ? "المستودعات:" : "Max Warehouses:"}</span>
                    <span className="font-semibold text-foreground">{p.maxWarehouses}</span>
                  </div>
                  <div className="flex justify-between border-b border-border/50 py-1.5">
                    <span className="text-muted-foreground">{isAr ? "المنتجات القصوى:" : "Max Products:"}</span>
                    <span className="font-semibold text-foreground">{p.maxProducts ? p.maxProducts : (isAr ? "غير محدود" : "Unlimited")}</span>
                  </div>
                </div>

                <div>
                  <div className="text-xs font-semibold mb-2">{isAr ? "الوحدات المضمنة:" : "Included Modules:"}</div>
                  <div className="flex flex-wrap gap-1">
                    {p.modules.map((mid) => (
                      <Badge key={mid} variant="secondary" className="text-[10px] font-mono">
                        {mid}
                      </Badge>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Tab 4: Platform Audit Logs */}
      {activeTab === "audit" && (
        <Card className="border-border/80 bg-surface">
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-base">
                {isAr ? "سجل تدقيق عمليات المنصة والتراخيص" : "Platform Audit Trail & Entitlement Logs"}
              </CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">
                {isAr
                  ? "توثيق شامل لكافة تغييرات الباقات، وتعديلات التراخيص على مستوى النظام."
                  : "Immutable log of subscription changes, add-on overrides and super-admin operations."}
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void loadAuditLogs()}
              disabled={loadingLogs}
              className="rounded-full gap-1.5 text-xs"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loadingLogs ? "animate-spin" : ""}`} />
              <span>{isAr ? "تحديث السجل" : "Refresh"}</span>
            </Button>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border/80 bg-surface-2/60 text-muted-foreground">
                    <th className="p-3 text-start font-medium">{isAr ? "الوقت" : "Timestamp"}</th>
                    <th className="p-3 text-start font-medium">{isAr ? "الحدث / الإجراء" : "Action"}</th>
                    <th className="p-3 text-start font-medium">{isAr ? "المستأجر" : "Target Tenant"}</th>
                    <th className="p-3 text-start font-medium">{isAr ? "التفاصيل" : "Payload"}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {auditLogs.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="p-8 text-center text-muted-foreground">
                        {loadingLogs
                          ? (isAr ? "جاري تحميل سجلات التدقيق..." : "Loading audit logs...")
                          : (isAr ? "لا توجد سجلات تدقيق سابقة حتى الآن" : "No platform audit entries yet")}
                      </td>
                    </tr>
                  ) : (
                    auditLogs.map((log) => (
                      <tr key={log.id} className="hover:bg-surface-2/40 transition">
                        <td className="p-3 font-mono text-[11px] text-muted-foreground">
                          {new Date(log.created_at).toLocaleString()}
                        </td>
                        <td className="p-3">
                          <Badge variant="outline" className="font-mono text-[10px] uppercase">
                            {log.action}
                          </Badge>
                        </td>
                        <td className="p-3 font-mono text-[11px]">
                          {log.target_tenant_id || "default"}
                        </td>
                        <td className="p-3 font-mono text-[11px] text-muted-foreground max-w-xs truncate">
                          {JSON.stringify(log.payload ?? {})}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

import { useState, useEffect, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { QuantityInput } from "@/components/ui/quantity-input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Boxes, Check, Hash, Layers, Scale, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { COSTING_METHOD_LABELS, type CostingMethod } from "@/lib/items";
import {
  getStockSettings,
  saveStockSettings,
  generateStackCode,
  generateSkuCode,
  type StockSettings,
} from "@/lib/stock-settings";

interface StockSettingsSectionProps {
  canEdit?: boolean;
  lang?: string;
}

export function StockSettingsSection({ canEdit = true, lang = "ar" }: StockSettingsSectionProps) {
  const isAr = lang === "ar";
  const queryClient = useQueryClient();
  const [settings, setSettings] = useState<StockSettings>(() => getStockSettings());
  const [isSaving, setIsSaving] = useState(false);
  const [savedSnapshot, setSavedSnapshot] = useState(() => getStockSettings());
  const [costingMethod, setCostingMethod] = useState<CostingMethod>("MOVING_AVERAGE");
  const [savedCostingMethod, setSavedCostingMethod] = useState<CostingMethod>("MOVING_AVERAGE");
  const [costingLoadState, setCostingLoadState] = useState<"loading" | "ready" | "error">("loading");
  const [costingSaveState, setCostingSaveState] = useState<"idle" | "saving">("idle");

  const isDirty = useMemo(
    () => JSON.stringify(settings) !== JSON.stringify(savedSnapshot),
    [settings, savedSnapshot],
  );

  useEffect(() => {
    const s = getStockSettings();
    setSettings(s);
    setSavedSnapshot(s);
  }, []);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const { data, error } = await (supabase as any)
          .from("company_costing_settings")
          .select("costing_method")
          .eq("id", 1)
          .maybeSingle();
        if (!active) return;
        if (error) {
          setCostingLoadState("error");
          return;
        }
        const method = (data?.costing_method ?? "MOVING_AVERAGE") as CostingMethod;
        setCostingMethod(method);
        setSavedCostingMethod(method);
        setCostingLoadState("ready");
      } catch {
        if (active) setCostingLoadState("error");
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  function handleSave() {
    if (!canEdit || !isDirty) return;
    setIsSaving(true);
    try {
      const saved = saveStockSettings(settings);
      setSettings(saved);
      setSavedSnapshot(saved);
      toast.success(
        isAr
          ? "تم حفظ إعدادات المخزون والرموز (Stacks) بنجاح"
          : "Stock & Stacks settings saved successfully",
      );
    } finally {
      setIsSaving(false);
    }
  }

  async function saveCostingMethod() {
    if (!canEdit || costingLoadState !== "ready" || costingSaveState === "saving") return;
    if (costingMethod !== "MOVING_AVERAGE") {
      toast.error(
        isAr
          ? "طريقة التقييم هذه غير مدعومة بالكامل حاليًا. اختر المتوسط المرجح المتحرك حتى يكتمل ربط FIFO والتكلفة المعيارية بالمحاسبة."
          : "This valuation method is not fully supported yet. Choose moving weighted average until FIFO and standard costing are integrated with accounting.",
      );
      return;
    }
    if (costingMethod === savedCostingMethod) return;
    setCostingSaveState("saving");
    try {
      const { error } = await (supabase as any).rpc("set_company_costing_method", {
        _method: costingMethod,
        _source: "stock_settings",
        _notes: "Changed from company stock settings",
      });
      if (error) throw error;
      setSavedCostingMethod(costingMethod);
      await queryClient.invalidateQueries({ queryKey: ["company-costing-method"] });
      toast.success(isAr ? "تم حفظ طريقة تقييم المخزون" : "Inventory valuation method saved");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toast.error(message || (isAr ? "تعذر حفظ طريقة تقييم المخزون" : "Could not save valuation method"));
    } finally {
      setCostingSaveState("idle");
    }
  }

  const previewStackCode = useMemo(() => generateStackCode(1, settings), [settings]);
  const previewSkuCode = useMemo(() => generateSkuCode(101, settings), [settings]);

  return (
    <div className="space-y-6">
      <Card className="overflow-hidden rounded-3xl border border-border/80 bg-card shadow-sm">
        <CardHeader className="border-b border-border/80 bg-muted/30 pb-4">
          <div className="flex items-center gap-2.5">
            <div className="rounded-2xl bg-primary/10 p-2 text-primary">
              <Scale className="h-5 w-5" />
            </div>
            <div>
              <CardTitle className="text-base font-bold">
                {isAr ? "طريقة تقييم المخزون للمنشأة" : "Company inventory valuation"}
              </CardTitle>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {isAr
                  ? "إعداد مركزي يحدد تكلفة المخزون وحركة تكلفة المبيعات للأصناف المخزنية."
                  : "A central setting for inventory value and cost of sales across tracked items."}
              </p>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4 pt-5">
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
            <div className="space-y-1.5">
              <Label>{isAr ? "طريقة التقييم" : "Valuation method"}</Label>
              <select
                value={costingMethod}
                onChange={(event) => setCostingMethod(event.target.value as CostingMethod)}
                disabled={!canEdit || costingLoadState !== "ready" || costingSaveState === "saving"}
                className="h-10 w-full rounded-xl border border-input bg-background px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:opacity-60"
              >
                <option value="MOVING_AVERAGE">
                  {COSTING_METHOD_LABELS.MOVING_AVERAGE[isAr ? "ar" : "en"]}
                </option>
                <option value="FIFO" disabled={savedCostingMethod !== "FIFO"}>
                  {COSTING_METHOD_LABELS.FIFO[isAr ? "ar" : "en"]}
                  {isAr ? " — غير متاح كتقييم تكلفة بعد" : " — not available for cost valuation yet"}
                </option>
                <option value="STANDARD" disabled={savedCostingMethod !== "STANDARD"}>
                  {COSTING_METHOD_LABELS.STANDARD[isAr ? "ar" : "en"]}
                  {isAr ? " — غير مكتمل محاسبيًا" : " — accounting integration incomplete"}
                </option>
              </select>
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                {isAr
                  ? "المتوسط المرجح المتحرك يعيد حساب تكلفة الوحدة عند كل استلام: (قيمة الرصيد + قيمة الاستلام) ÷ (كمية الرصيد + كمية الاستلام). تغيّر التكلفة لا يغيّر سعر البيع تلقائيًا؛ التسعير سياسة مستقلة."
                  : "Moving weighted average recalculates unit cost on each receipt: (current inventory value + receipt value) ÷ (current quantity + receipt quantity). Cost changes do not automatically change sales prices; pricing is separate."}
              </p>
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                {isAr
                  ? "FIFO كتقييم تكلفة يصرف القيمة من أقدم طبقات الاستلام. أما FIFO أو FEFO في إعداد الدفعات فيحددان أي دفعة تُصرف، ولا يغيران تقييم التكلفة. التكلفة المعيارية تستخدم تكلفة معتمدة ثابتة وتتطلب تسجيل فرق سعر الشراء الفعلي في حسابات الفروقات."
                  : "FIFO cost valuation issues value from the oldest receipt-cost layers. FIFO or FEFO batch dispatch only selects which batch is issued; it does not change cost valuation. Standard cost uses an approved fixed cost and requires purchase price variances to be posted to variance accounts."}
              </p>
            </div>
            {canEdit && (
              <Button
                type="button"
                onClick={saveCostingMethod}
                disabled={
                  costingLoadState !== "ready" ||
                  costingSaveState === "saving" ||
                  costingMethod === savedCostingMethod
                }
              >
                <Check className="h-4 w-4" />
                {costingSaveState === "saving"
                  ? isAr ? "جارٍ الحفظ..." : "Saving..."
                  : isAr ? "حفظ طريقة التقييم" : "Save valuation method"}
              </Button>
            )}
          </div>
          {costingLoadState === "loading" && (
            <p className="text-xs text-muted-foreground">{isAr ? "جارٍ تحميل إعداد المنشأة..." : "Loading company setting..."}</p>
          )}
          {costingLoadState === "error" && (
            <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
              {isAr ? "تعذر قراءة طريقة التقييم المركزية. لم يتم تعديلها." : "Could not read the central valuation method. It was not changed."}
            </p>
          )}
          {(costingMethod === "FIFO" || costingMethod === "STANDARD") && (
            <p role="alert" className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-xs leading-relaxed text-amber-700 dark:text-amber-300">
              {isAr
                ? "الإعداد المحفوظ يشير إلى طريقة غير مكتملة في محرك المخزون والمحاسبة. لا تعتمد عليها قبل التحويل إلى المتوسط المرجح المتحرك وإكمال دعم طبقات FIFO أو فروقات التكلفة المعيارية."
                : "The saved method is not fully implemented in inventory and accounting. Do not rely on it until switched to moving weighted average and FIFO layers or standard cost variances are completed."}
            </p>
          )}
        </CardContent>
      </Card>

      <Card className="rounded-3xl border border-border/80 bg-card shadow-sm overflow-hidden">
        <CardHeader className="bg-muted/30 border-b border-border/80 pb-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-2xl bg-amber-500/10 text-amber-500">
                <Boxes className="h-5 w-5" />
              </div>
              <div>
                <CardTitle className="text-base font-bold">
                  {isAr ? "إعدادات المخزون والرموز (Stock & Stacks)" : "Stock & Stacks Settings"}
                </CardTitle>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {isAr
                    ? "التحكم في بادئات رموز الأصناف والمكدسات (Stacks)، ترقيم الدفعات، والحد الأدنى للمخزون"
                    : "Configure SKU prefixes, Stack codes, batch numbering, and stock thresholds"}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 rounded-2xl bg-surface-2 px-3 py-1.5 border border-border/60">
              <Sparkles className="h-4 w-4 text-amber-500" />
              <span className="text-xs font-semibold text-muted-foreground">
                {isAr ? "معاينة الرمز الحالي:" : "Current Sample:"}
              </span>
              <span className="font-mono text-xs font-bold text-primary">{previewStackCode}</span>
            </div>
          </div>
        </CardHeader>

        <CardContent className="pt-6 space-y-6">
          {/* Section 1: Code Prefixes & Formats */}
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-xs font-bold text-foreground">
              <Layers className="h-4 w-4 text-primary" />
              <span>
                {isAr ? "بادئات وقواعد رموز المخزون والـ Stacks" : "Stock & Stack Code Prefixes"}
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* SKU Prefix */}
              <div className="space-y-1.5 rounded-2xl border border-border/70 bg-surface/60 p-4">
                <Label className="text-xs font-bold text-foreground">
                  {isAr ? "بادئة رمز المنتج (SKU Prefix)" : "SKU Prefix"}
                </Label>
                <Input
                  value={settings.skuPrefix}
                  disabled={!canEdit}
                  onChange={(e) => setSettings({ ...settings, skuPrefix: e.target.value })}
                  placeholder="PRD-"
                  className="h-10 rounded-xl font-mono text-xs font-bold"
                />
                <p className="text-[11px] text-muted-foreground">
                  {isAr ? "مثال الرمز الناتج:" : "Sample output:"}{" "}
                  <span className="font-mono font-bold text-foreground">{previewSkuCode}</span>
                </p>
              </div>

              {/* Stack Prefix */}
              <div className="space-y-1.5 rounded-2xl border border-border/70 bg-surface/60 p-4">
                <Label className="text-xs font-bold text-foreground">
                  {isAr ? "بادئة رمز المكدس (Stack Prefix)" : "Stack Code Prefix"}
                </Label>
                <Input
                  value={settings.stackPrefix}
                  disabled={!canEdit}
                  onChange={(e) => setSettings({ ...settings, stackPrefix: e.target.value })}
                  placeholder="STK-"
                  className="h-10 rounded-xl font-mono text-xs font-bold"
                />
                <p className="text-[11px] text-muted-foreground">
                  {isAr ? "مثال الرمز الناتج:" : "Sample output:"}{" "}
                  <span className="font-mono font-bold text-foreground">{previewStackCode}</span>
                </p>
              </div>

              {/* Batch Prefix */}
              <div className="space-y-1.5 rounded-2xl border border-border/70 bg-surface/60 p-4">
                <Label className="text-xs font-bold text-foreground">
                  {isAr ? "بادئة رمز التشغيلة (Batch Prefix)" : "Batch Code Prefix"}
                </Label>
                <Input
                  value={settings.batchPrefix}
                  disabled={!canEdit}
                  onChange={(e) => setSettings({ ...settings, batchPrefix: e.target.value })}
                  placeholder="BAT-"
                  className="h-10 rounded-xl font-mono text-xs font-bold"
                />
                <p className="text-[11px] text-muted-foreground">
                  {isAr ? "مثال الرمز الناتج:" : "Sample output:"}{" "}
                  <span className="font-mono font-bold text-foreground">
                    {settings.batchPrefix}2026-0001
                  </span>
                </p>
              </div>
            </div>

            {/* Stack Code Format & Padding */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
              <div className="space-y-1.5 rounded-2xl border border-border/70 bg-surface/60 p-4">
                <Label className="text-xs font-bold text-foreground">
                  {isAr ? "نمط صيغة رمز الـ Stack" : "Stack Code Format"}
                </Label>
                <select
                  value={settings.stackCodeFormat}
                  disabled={!canEdit}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      stackCodeFormat: e.target.value as StockSettings["stackCodeFormat"],
                    })
                  }
                  className="h-10 w-full rounded-xl border border-input bg-background px-3 text-xs font-medium outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:opacity-60"
                >
                  <option value="prefix_year_number">
                    {isAr
                      ? "بادئة + سنة + تسلسل (STK-2026-0001)"
                      : "Prefix + Year + Seq (STK-2026-0001)"}
                  </option>
                  <option value="prefix_date_number">
                    {isAr
                      ? "بادئة + سنة وشهر + تسلسل (STK-202610-0001)"
                      : "Prefix + YearMonth + Seq (STK-202610-0001)"}
                  </option>
                  <option value="prefix_number">
                    {isAr ? "بادئة + تسلسل مباشر (STK-0001)" : "Prefix + Seq Only (STK-0001)"}
                  </option>
                </select>
              </div>

              <div className="space-y-1.5 rounded-2xl border border-border/70 bg-surface/60 p-4">
                <Label className="text-xs font-bold text-foreground">
                  {isAr ? "عدد أرقام الحشو للتسلسل (Padding Digits)" : "Sequence Padding Digits"}
                </Label>
                <select
                  value={settings.paddingDigits}
                  disabled={!canEdit}
                  onChange={(e) =>
                    setSettings({ ...settings, paddingDigits: Number(e.target.value) })
                  }
                  className="h-10 w-full rounded-xl border border-input bg-background px-3 text-xs font-medium outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:opacity-60 font-mono"
                >
                  <option value={3}>{isAr ? "3 أرقام (001)" : "3 Digits (001)"}</option>
                  <option value={4}>{isAr ? "4 أرقام (0001)" : "4 Digits (0001)"}</option>
                  <option value={5}>{isAr ? "5 أرقام (00001)" : "5 Digits (00001)"}</option>
                  <option value={6}>{isAr ? "6 أرقام (000001)" : "6 Digits (000001)"}</option>
                </select>
              </div>
            </div>
          </div>

          {/* Section 2: Automation & Stock Rules */}
          <div className="space-y-4 border-t border-border/60 pt-5">
            <div className="flex items-center gap-2 text-xs font-bold text-foreground">
              <Hash className="h-4 w-4 text-primary" />
              <span>
                {isAr ? "قواعد توليد الرموز وحدود المخزون" : "Auto-Generation & Stock Rules"}
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="flex items-center justify-between p-4 rounded-2xl border border-border/70 bg-surface/60">
                <div className="space-y-0.5 me-2">
                  <div className="text-xs font-bold text-foreground">
                    {isAr ? "التوليد التلقائي لرمز المنتج (Auto SKU)" : "Auto-generate SKU Code"}
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    {isAr
                      ? "تأليف رمز تلقائي عند إضافة منتج جديد إذا ترك الحقل فارغاً"
                      : "Automatically create SKU when field is left blank"}
                  </div>
                </div>
                <Switch
                  checked={settings.autoGenerateSku}
                  onCheckedChange={(val) => setSettings({ ...settings, autoGenerateSku: val })}
                  disabled={!canEdit}
                />
              </div>

              <div className="flex items-center justify-between p-4 rounded-2xl border border-border/70 bg-surface/60">
                <div className="space-y-0.5 me-2">
                  <div className="text-xs font-bold text-foreground">
                    {isAr ? "التوليد التلقائي لرمز الـ Stack" : "Auto-generate Stack Code"}
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    {isAr
                      ? "إنشاء رمز تسلسلي للمكدس أو التشغيلة فور استلام الشحنة"
                      : "Generate sequence stack code on batch receipt"}
                  </div>
                </div>
                <Switch
                  checked={settings.autoGenerateStackCode}
                  onCheckedChange={(val) =>
                    setSettings({ ...settings, autoGenerateStackCode: val })
                  }
                  disabled={!canEdit}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5 rounded-2xl border border-border/70 bg-surface/60 p-4">
                <Label className="text-xs font-bold text-foreground">
                  {isAr
                    ? "حد التنبيه الافتراضي للمخزون"
                    : "Default minimum stock alert threshold"}
                </Label>
                <QuantityInput
                  decimals={3}
                  min={0}
                  value={settings.defaultMinStock}
                  disabled={!canEdit}
                  onValueChange={(v) => setSettings({ ...settings, defaultMinStock: v ?? 0 })}
                  aria-label={isAr ? "حد التنبيه الافتراضي للمخزون" : "Default minimum stock alert threshold"}
                  className="h-10 text-xs font-bold"
                />
                <p className="text-[11px] text-muted-foreground">
                  {isAr
                    ? "يُستخدم عند إنشاء سلعة مخزنية جديدة بوحدة قياسها؛ ويظهر تنبيه النقص عند وصول الرصيد إلى هذا الحد أو أقل."
                    : "Used for new tracked goods in their stock unit. A low-stock alert appears when quantity reaches or falls below this value."}
                </p>
              </div>

              <div className="flex items-center justify-between p-4 rounded-2xl border border-border/70 bg-surface/60">
                <div className="space-y-0.5 me-2">
                  <div className="text-xs font-bold text-foreground">
                    {isAr ? "السماح بالرصيد بالسالب" : "Allow Negative Stock Balance"}
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    {isAr
                      ? "إمكانية إتمام حركات الصرف والبيع حتى لو كان المخزون المتاح صفر"
                      : "Allow outgoing movements when available quantity is zero"}
                  </div>
                </div>
                <Switch
                  checked={settings.allowNegativeStock}
                  onCheckedChange={(val) => setSettings({ ...settings, allowNegativeStock: val })}
                  disabled={!canEdit}
                />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {canEdit && (
        <div className="sticky bottom-4 z-30 flex items-center justify-between gap-3 rounded-2xl border border-primary/30 bg-background/95 px-4 py-3 shadow-xl backdrop-blur">
          <span className="text-xs text-muted-foreground">
            {isDirty
              ? isAr
                ? "لديك تغييرات غير محفوظة في إعدادات المخزون والـ Stacks"
                : "You have unsaved changes in Stock & Stacks Settings"
              : isAr
                ? "جميع إعدادات المخزون والرموز محفوظة"
                : "All stock settings are saved"}
          </span>
          <Button type="button" onClick={handleSave} disabled={!isDirty || isSaving}>
            <Check className="h-4 w-4" />
            {isSaving
              ? isAr
                ? "جارٍ الحفظ..."
                : "Saving..."
              : isAr
                ? "حفظ إعدادات المخزون والرموز"
                : "Save Stock Settings"}
          </Button>
        </div>
      )}
    </div>
  );
}

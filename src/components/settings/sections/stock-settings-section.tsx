import { useState, useEffect, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Boxes, Check, Hash, Layers, ShieldAlert, Sparkles } from "lucide-react";
import { toast } from "sonner";
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
  const [settings, setSettings] = useState<StockSettings>(() => getStockSettings());
  const [isSaving, setIsSaving] = useState(false);
  const [savedSnapshot, setSavedSnapshot] = useState(() => getStockSettings());

  const isDirty = useMemo(
    () => JSON.stringify(settings) !== JSON.stringify(savedSnapshot),
    [settings, savedSnapshot],
  );

  useEffect(() => {
    const s = getStockSettings();
    setSettings(s);
    setSavedSnapshot(s);
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

  const previewStackCode = useMemo(() => generateStackCode(1, settings), [settings]);
  const previewSkuCode = useMemo(() => generateSkuCode(101, settings), [settings]);

  return (
    <div className="space-y-6">
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
              <span>{isAr ? "بادئات وقواعد رموز المخزون والـ Stacks" : "Stock & Stack Code Prefixes"}</span>
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
                    {isAr ? "بادئة + سنة + تسلسل (STK-2026-0001)" : "Prefix + Year + Seq (STK-2026-0001)"}
                  </option>
                  <option value="prefix_date_number">
                    {isAr ? "بادئة + سنة وشهر + تسلسل (STK-202610-0001)" : "Prefix + YearMonth + Seq (STK-202610-0001)"}
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
              <span>{isAr ? "قواعد توليد الرموز وحدود المخزون" : "Auto-Generation & Stock Rules"}</span>
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
                  {isAr ? "حد التنبيه الافتراضي لأدنى مخزون (Default Min Stock)" : "Default Minimum Stock Level"}
                </Label>
                <Input
                  type="number"
                  min={0}
                  value={settings.defaultMinStock}
                  disabled={!canEdit}
                  onChange={(e) =>
                    setSettings({ ...settings, defaultMinStock: Number(e.target.value) })
                  }
                  className="h-10 rounded-xl font-mono text-xs font-bold"
                />
                <p className="text-[11px] text-muted-foreground">
                  {isAr
                    ? "العدد الأدنى الذي يُرسل عنده النظام إشعار نقص المخزون"
                    : "Threshold triggers low stock alerts when quantity dips below"}
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
                  onCheckedChange={(val) =>
                    setSettings({ ...settings, allowNegativeStock: val })
                  }
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

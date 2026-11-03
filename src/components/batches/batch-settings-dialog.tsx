import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Settings2,
  ShieldAlert,
  CalendarClock,
  Layers,
  ShoppingBag,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  Check,
  Scale,
} from "lucide-react";
import {
  useBatchSettings,
  type BatchDispatchStrategy,
  type BatchSettings,
} from "@/hooks/use-batch-settings";
import { useI18n } from "@/lib/i18n";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface BatchSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface ReconcileItem {
  product_id: string;
  warehouse_id: string;
  batch_qty: number;
  inventory_qty: number;
  difference: number;
  product_name?: string;
  warehouse_name?: string;
}

export function BatchSettingsDialog({ open, onOpenChange }: BatchSettingsDialogProps) {
  const { lang } = useI18n();
  const isAr = lang === "ar";
  const { settings, saveSettings, isSaving } = useBatchSettings();

  const [form, setForm] = useState<BatchSettings>(settings);
  const [reconciling, setReconciling] = useState(false);
  const [reconcileResults, setReconcileResults] = useState<ReconcileItem[] | null>(null);

  useEffect(() => {
    if (open) {
      setForm(settings);
      setReconcileResults(null);
    }
  }, [open, settings]);

  const handleSave = async () => {
    try {
      await saveSettings(form);
      toast.success(isAr ? "تم حفظ إعدادات الدفعات بنجاح" : "Batch settings saved successfully");
      onOpenChange(false);
    } catch (err: any) {
      toast.error(err?.message || (isAr ? "فشل حفظ الإعدادات" : "Failed to save settings"));
    }
  };

  const runReconciliation = async () => {
    setReconciling(true);
    setReconcileResults(null);
    try {
      const { data, error } = await supabase.rpc("reconcile_batches_with_inventory" as any, {});
      if (error) throw error;

      const items = (data as ReconcileItem[]) || [];

      // If items exist, optionally fetch names
      if (items.length > 0) {
        const productIds = Array.from(new Set(items.map((i) => i.product_id)));
        const warehouseIds = Array.from(new Set(items.map((i) => i.warehouse_id)));

        const [pRes, wRes] = await Promise.all([
          supabase.from("products").select("id, name, name_ar").in("id", productIds),
          supabase.from("warehouses").select("id, name, name_ar").in("id", warehouseIds),
        ]);

        const pMap = new Map(
          (pRes.data ?? []).map((p) => [p.id, isAr ? p.name_ar || p.name : p.name]),
        );
        const wMap = new Map(
          (wRes.data ?? []).map((w) => [w.id, isAr ? w.name_ar || w.name : w.name]),
        );

        const enriched = items.map((i) => ({
          ...i,
          product_name: pMap.get(i.product_id) || i.product_id.slice(0, 8),
          warehouse_name: wMap.get(i.warehouse_id) || i.warehouse_id.slice(0, 8),
        }));
        setReconcileResults(enriched);
      } else {
        setReconcileResults([]);
      }
    } catch (e: any) {
      toast.error(e?.message || (isAr ? "فشل فحص المطابقة" : "Audit check failed"));
    } finally {
      setReconciling(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto p-0 gap-0 border-border bg-background shadow-2xl">
        <DialogHeader className="p-6 pb-4 border-b border-border/80 bg-muted/20">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary border border-primary/20">
              <Settings2 className="size-5" />
            </div>
            <div>
              <DialogTitle className="text-lg font-bold text-foreground">
                {isAr ? "إعدادات الدفعات وتواريخ الصلاحية" : "Batch & Expiry Settings"}
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground mt-0.5">
                {isAr
                  ? "تخصيص سياسة الصرف في نقطة البيع، وضوابط الصلاحية، والمزامنة مع المخزون"
                  : "Configure POS dispatch policy, expiry controls, and inventory sync"}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="p-6 space-y-6">
          {/* 1. Dispatch Strategy */}
          <div className="rounded-xl border border-border/80 bg-surface/50 p-4 space-y-3">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <Layers className="size-4 text-primary" />
                  <span className="text-sm font-semibold text-foreground">
                    {isAr ? "طريقة الصرف الآلي في نقطة البيع" : "POS Dispatch Strategy"}
                  </span>
                  <Badge
                    variant="outline"
                    className="text-[10px] font-mono border-primary/30 text-primary"
                  >
                    {form.dispatch_strategy}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {isAr
                    ? "هذا هو الترتيب العام لأصناف الدفعات التي تستخدم إعداد الشركة. يمكن تخصيص FEFO أو FIFO أو الاختيار اليدوي من تفاصيل كل منتج."
                    : "This is the default for batch-tracked products that inherit company settings. FEFO, FIFO, or manual dispatch can be set per product."}
                </p>
              </div>

              <div className="w-48 shrink-0">
                <Select
                  value={form.dispatch_strategy}
                  onValueChange={(val) =>
                    setForm((f) => ({ ...f, dispatch_strategy: val as BatchDispatchStrategy }))
                  }
                >
                  <SelectTrigger className="h-9 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="FEFO" className="text-xs">
                      {isAr ? "FEFO (الأقرب انتهاءً أولاً)" : "FEFO (First Expired First Out)"}
                    </SelectItem>
                    <SelectItem value="FIFO" className="text-xs">
                      {isAr ? "FIFO (الأقدم وروداً أولاً)" : "FIFO (First In First Out)"}
                    </SelectItem>
                    <SelectItem value="MANUAL" className="text-xs">
                      {isAr ? "يدوي (اختيار الكاشير)" : "Manual (Cashier Choice)"}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          {/* 2. Controls Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
            {/* Prevent Expired Sales */}
            <div className="rounded-xl border border-border/80 bg-surface/50 p-4 flex items-start justify-between gap-3">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <ShieldAlert className="size-4 text-rose-500" />
                  <span className="text-xs font-semibold text-foreground">
                    {isAr ? "منع بيع الدفعات المنتهية" : "Block Expired Sales"}
                  </span>
                </div>
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  {isAr
                    ? "رفض إتمام الفاتورة نهائياً إذا كانت الدفعة المحددة أو المتاحة منتهية الصلاحية."
                    : "Strictly reject sales invoices containing expired batches."}
                </p>
              </div>
              <Switch
                checked={form.prevent_selling_expired}
                onCheckedChange={(checked) =>
                  setForm((f) => ({ ...f, prevent_selling_expired: checked }))
                }
              />
            </div>

            {/* Warning Window */}
            <div className="rounded-xl border border-border/80 bg-surface/50 p-4 flex items-start justify-between gap-3">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <CalendarClock className="size-4 text-amber-500" />
                  <span className="text-xs font-semibold text-foreground">
                    {isAr ? "نافذة التنبيه قبل الانتهاء" : "Expiry Warning Window"}
                  </span>
                </div>
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  {isAr
                    ? "عدد الأيام لاعتبار الدفعة قريبة الانتهاء وإظهارها في شريط التنبيهات."
                    : "Days before expiry to flag batches as expiring soon."}
                </p>
              </div>
              <div className="w-24 shrink-0">
                <Select
                  value={String(form.warning_days)}
                  onValueChange={(val) => setForm((f) => ({ ...f, warning_days: Number(val) }))}
                >
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="15" className="text-xs">
                      {isAr ? "15 يوماً" : "15 days"}
                    </SelectItem>
                    <SelectItem value="30" className="text-xs">
                      {isAr ? "30 يوماً" : "30 days"}
                    </SelectItem>
                    <SelectItem value="60" className="text-xs">
                      {isAr ? "60 يوماً" : "60 days"}
                    </SelectItem>
                    <SelectItem value="90" className="text-xs">
                      {isAr ? "90 يوماً" : "90 days"}
                    </SelectItem>
                    <SelectItem value="180" className="text-xs">
                      {isAr ? "180 يوماً" : "180 days"}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Enforce on Purchase */}
            <div className="rounded-xl border border-border/80 bg-surface/50 p-4 flex items-start justify-between gap-3">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <ShoppingBag className="size-4 text-emerald-500" />
                  <span className="text-xs font-semibold text-foreground">
                    {isAr ? "إلزام الدفعة عند الشراء" : "Enforce on Purchase"}
                  </span>
                </div>
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  {isAr
                    ? "رقم الدفعة مطلوب عند شراء صنف يتتبع الدفعات؛ تاريخ الانتهاء اختياري."
                    : "A batch number is required when purchasing a batch-tracked item; expiry date is optional."}
                </p>
              </div>
              <Switch checked disabled aria-label={isAr ? "رقم الدفعة إلزامي" : "Batch number required"} />
            </div>

            {/* Auto-Sync Inventory */}
            <div className="rounded-xl border border-border/80 bg-surface/50 p-4 flex items-start justify-between gap-3">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <RefreshCw className="size-4 text-cyan-500" />
                  <span className="text-xs font-semibold text-foreground">
                    {isAr ? "المزامنة التلقائية مع المخزون" : "Auto-Sync with Inventory"}
                  </span>
                </div>
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  {isAr
                    ? "تحديث المخزون العام تلقائياً عند إضافة أو تعديل أو حذف أي دفعة."
                    : "Automatically update general stock balance when batches are added or changed."}
                </p>
              </div>
              <Switch
                checked={form.auto_sync_inventory}
                onCheckedChange={(checked) =>
                  setForm((f) => ({ ...f, auto_sync_inventory: checked }))
                }
              />
            </div>
          </div>

          {/* 3. Reconciliation & Audit Section */}
          <div className="rounded-xl border border-border/80 bg-muted/10 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <div className="flex items-center gap-2">
                  <Scale className="size-4 text-primary" />
                  <span className="text-xs font-semibold text-foreground">
                    {isAr ? "مطابقة أرصدة الدفعات مع المخزون العام" : "Batches vs Stock Audit"}
                  </span>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  {isAr
                    ? "فحص أي تفاوت بين مجموع أرصدة الدفعات ورصيد المخزون الفعلي في المستودعات"
                    : "Check for discrepancies between batch quantities and physical stock."}
                </p>
              </div>

              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 text-xs gap-1.5"
                onClick={runReconciliation}
                disabled={reconciling}
              >
                <RefreshCw className={`size-3.5 ${reconciling ? "animate-spin" : ""}`} />
                <span>{isAr ? "فحص المطابقة" : "Run Audit"}</span>
              </Button>
            </div>

            {/* Reconciliation Results */}
            {reconcileResults !== null && (
              <div className="mt-3 pt-3 border-t border-border/60">
                {reconcileResults.length === 0 ? (
                  <div className="flex items-center gap-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 px-3 py-2 text-xs text-emerald-500">
                    <CheckCircle2 className="size-4 shrink-0" />
                    <span>
                      {isAr
                        ? "جميع أرصدة الدفعات مطابقة تماماً للمخزون العام بنسبة 100%!"
                        : "All batch balances match general stock perfectly!"}
                    </span>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 rounded-lg bg-amber-500/10 border border-amber-500/20 px-3 py-2 text-xs text-amber-500">
                      <AlertCircle className="size-4 shrink-0" />
                      <span>
                        {isAr
                          ? `تم العثور على ${reconcileResults.length} صنف به تفاوت بين الدفعات والمخزون:`
                          : `Found ${reconcileResults.length} item(s) with stock discrepancies:`}
                      </span>
                    </div>

                    <div className="max-h-40 overflow-y-auto rounded-lg border border-border bg-surface text-xs divide-y divide-border/60">
                      {reconcileResults.map((item, idx) => (
                        <div key={idx} className="p-2.5 flex items-center justify-between gap-2">
                          <div>
                            <div className="font-semibold text-foreground">{item.product_name}</div>
                            <div className="text-[10px] text-muted-foreground">
                              {item.warehouse_name}
                            </div>
                          </div>
                          <div className="text-end font-mono">
                            <div>
                              {isAr ? "الدفعات: " : "Batches: "}
                              <span className="font-bold">{item.batch_qty}</span> |{" "}
                              {isAr ? "المخزون: " : "Stock: "}
                              <span className="font-bold">{item.inventory_qty}</span>
                            </div>
                            <div
                              className={
                                item.difference > 0
                                  ? "text-emerald-500 text-[11px]"
                                  : "text-rose-500 text-[11px]"
                              }
                            >
                              {isAr ? "الفارق: " : "Diff: "}
                              {item.difference > 0 ? `+${item.difference}` : item.difference}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="p-4 px-6 border-t border-border/80 bg-muted/20 flex items-center justify-between gap-3">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onOpenChange(false)}
            className="text-xs"
          >
            {isAr ? "إلغاء" : "Cancel"}
          </Button>

          <Button
            type="button"
            size="sm"
            onClick={handleSave}
            disabled={isSaving}
            className="text-xs gap-1.5"
          >
            {isSaving ? (
              <span>{isAr ? "جاري الحفظ..." : "Saving..."}</span>
            ) : (
              <>
                <Check className="size-3.5" />
                <span>{isAr ? "حفظ الإعدادات" : "Save Settings"}</span>
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

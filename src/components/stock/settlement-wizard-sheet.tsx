/**
 * SettlementWizardSheet — معالج التسويات الجردية (Step Wizard)
 *
 * يستبدل نموذج الإدخال المباشر بست خطوات واضحة:
 *   1. اختيار المستودع
 *   2. تحديد الأصناف
 *   3. عرض الرصيد الدفتري
 *   4. إدخال الرصيد الفعلي
 *   5. عرض الفروقات
 *   6. مراجعة واعتماد التسوية
 *
 * الفكرة: كل خطوة في Sheet/Drawer متجاوب، والفروقات تُعرض بوضوح قبل الاعتماد.
 * منطق الحفظ مطابق تمامًا لما كان في StockAdjustmentDialog:
 *   inventory upsert + stock_movements insert — بلا أي تغيير في الـ backend.
 */

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  ClipboardCheck,
  Plus,
  Scale,
  Search,
  Trash2,
  TrendingDown,
  TrendingUp,
  TriangleAlert,
  Warehouse as WarehouseIcon,
} from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { VortexDrawerDialog } from "@/components/vortex-ui";
import { FormField } from "@/components/ui/form-field";
import { FieldInput, NumberInput } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/feedback";
import { StatusBadge } from "@/components/ui/status-badge";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/lib/auth";
import { money } from "@/lib/format";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type ProductItem = {
  id: string;
  name: string;
  name_ar: string | null;
  sku: string | null;
  barcode: string | null;
  cost_price: number;
};

type WarehouseItem = {
  id: string;
  name: string;
  name_ar: string | null;
  code: string | null;
  is_default: boolean;
};

/** سطر تسوية واحد: صنف + رصيد دفتري + رصيد فعلي مُدخل */
type DraftLine = {
  product_id: string;
  name: string;
  sku: string | null;
  cost_price: number;
  ledgerQty: number;
  /** null = لم يُدخل الجرد الفعلي بعد */
  actualQty: number | null;
};

const REASONS = [
  { value: "shortfall", ar: "عجز جردي", en: "Stock Shortfall" },
  { value: "surplus", ar: "فائض جردي", en: "Stock Surplus" },
  { value: "damaged", ar: "تلف / كسر", en: "Damaged / Broken" },
  { value: "expiry", ar: "انتهاء صلاحية", en: "Expired Product" },
  { value: "stocktake", ar: "تسوية جرد دوري", en: "Periodic Stocktake" },
  { value: "other", ar: "سبب آخر", en: "Other Reason" },
] as const;

export const SETTLEMENT_STEPS = [
  { ar: "المستودع", en: "Warehouse" },
  { ar: "الأصناف", en: "Items" },
  { ar: "الرصيد الدفتري", en: "Book balance" },
  { ar: "الجرد الفعلي", en: "Actual count" },
  { ar: "الفروقات", en: "Differences" },
  { ar: "المراجعة والاعتماد", en: "Review & post" },
] as const;

export interface SettlementWizardSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
  initialProductId?: string;
  initialWarehouseId?: string;
}

export function SettlementWizardSheet({
  open,
  onOpenChange,
  onSaved,
  initialProductId,
  initialWarehouseId,
}: SettlementWizardSheetProps) {
  const { t, lang } = useI18n();
  const { user } = useAuth();
  const isAr = lang === "ar";

  const [step, setStep] = useState(0);
  const [warehouseId, setWarehouseId] = useState(initialWarehouseId ?? "");
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [reason, setReason] = useState<string>("");
  const [unitCost, setUnitCost] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const [search, setSearch] = useState("");
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const products = useQuery<ProductItem[]>({
    queryKey: ["products_adjustment_list"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("id, name, name_ar, sku, barcode, cost_price")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return (data ?? []) as ProductItem[];
    },
  });

  const warehouses = useQuery<WarehouseItem[]>({
    queryKey: ["warehouses_adjustment"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("warehouses")
        .select("id, name, name_ar, code, is_default")
        .eq("is_active", true)
        .order("is_default", { ascending: false });
      if (error) throw error;
      return (data ?? []) as WarehouseItem[];
    },
  });

  // اختيار افتراضي للمستودع
  useEffect(() => {
    if (!warehouseId && warehouses.data?.length) setWarehouseId(warehouses.data[0].id);
  }, [warehouses.data, warehouseId]);

  /** الرصيد الدفتري لكل صنف في المستودع المختار */
  const ledgerQuery = useQuery<Record<string, number>>({
    queryKey: ["settlement-ledger", warehouseId, lines.map((l) => l.product_id).join(",")],
    queryFn: async () => {
      if (!warehouseId || lines.length === 0) return {};
      const { data, error } = await supabase
        .from("inventory")
        .select("product_id,quantity")
        .eq("warehouse_id", warehouseId);
      if (error) throw error;
      const map: Record<string, number> = {};
      for (const row of data ?? []) map[row.product_id as string] = Number(row.quantity ?? 0);
      return map;
    },
    enabled: Boolean(warehouseId) && lines.length > 0,
  });

  /** مزامنة الرصيد الدفتري داخل المسودات عند وصول البيانات */
  useEffect(() => {
    if (!ledgerQuery.data) return;
    setLines((prev) =>
      prev.map((l) =>
        ledgerQuery.data[l.product_id] !== undefined &&
        ledgerQuery.data[l.product_id] !== l.ledgerQty
          ? { ...l, ledgerQty: ledgerQuery.data[l.product_id] }
          : l,
      ),
    );
  }, [ledgerQuery.data]);

  // صنف واحد مُثبَّت مسبقاً (استدعاء من شاشة المخزون)
  useEffect(() => {
    if (!initialProductId || !products.data) return;
    const p = products.data.find((x) => x.id === initialProductId);
    if (!p) return;
    setLines((prev) =>
      prev.some((l) => l.product_id === p.id)
        ? prev
        : [
            ...prev,
            {
              product_id: p.id,
              name: isAr ? p.name_ar || p.name : p.name,
              sku: p.sku,
              cost_price: Number(p.cost_price ?? 0),
              ledgerQty: 0,
              actualQty: null,
            },
          ],
    );
  }, [initialProductId, products.data, isAr]);

  // تكلفة الوحدة الافتراضية = تكلفة أول صنف
  useEffect(() => {
    if (unitCost == null && lines[0]) setUnitCost(Number(lines[0].cost_price ?? 0));
  }, [lines, unitCost]);

  const warehouseItems = warehouses.data ?? [];
  const selectedWarehouse = warehouseItems.find((w) => w.id === warehouseId) ?? null;
  const warehouseLabel = (w: WarehouseItem | null) =>
    !w ? "—" : isAr ? w.name_ar || w.name : w.name || w.name_ar || "—";

  const filteredProducts = useMemo(() => {
    const pool = products.data ?? [];
    const q = search.trim().toLowerCase();
    if (!q) return pool;
    return pool.filter((p) =>
      [p.name, p.name_ar, p.sku, p.barcode].some((v) => (v ?? "").toLowerCase().includes(q)),
    );
  }, [products.data, search]);

  function addProduct(p: ProductItem) {
    setLines((prev) =>
      prev.some((l) => l.product_id === p.id)
        ? prev
        : [
            ...prev,
            {
              product_id: p.id,
              name: isAr ? p.name_ar || p.name : p.name,
              sku: p.sku,
              cost_price: Number(p.cost_price ?? 0),
              ledgerQty: Number(ledgerQuery.data?.[p.id] ?? 0),
              actualQty: null,
            },
          ],
    );
    setSearch("");
  }

  function removeProduct(id: string) {
    setLines((prev) => prev.filter((l) => l.product_id !== id));
  }

  /** الفروقات — جوهر الخطوة 5 */
  const differences = useMemo(() => {
    return lines
      .map((l) => {
        const actual = l.actualQty;
        const valid = actual != null && actual >= 0 && Number.isFinite(actual);
        const diff = valid ? actual - l.ledgerQty : 0;
        return {
          ...l,
          actualQty: actual,
          valid,
          diff,
          state: !valid
            ? ("pending" as const)
            : Math.abs(diff) < 0.0001
              ? ("match" as const)
              : diff < 0
                ? ("shortage" as const)
                : ("surplus" as const),
        };
      })
      .filter((d) => d.valid);
  }, [lines]);

  const resolved = differences.filter((d) => d.state !== "match");
  const summary = useMemo(() => {
    const netQty = resolved.reduce((s, d) => s + d.diff, 0);
    const cost = Number(unitCost ?? 0);
    return {
      shortages: resolved.filter((d) => d.state === "shortage").length,
      surpluses: resolved.filter((d) => d.state === "surplus").length,
      netQty,
      netValue: netQty * cost,
      shortageQty: resolved
        .filter((d) => d.state === "shortage")
        .reduce((s, d) => s + Math.abs(d.diff), 0),
      surplusQty: resolved.filter((d) => d.state === "surplus").reduce((s, d) => s + d.diff, 0),
    };
  }, [resolved, unitCost]);

  const canGoNext = (() => {
    switch (step) {
      case 0:
        return Boolean(warehouseId);
      case 1:
        return lines.length > 0;
      case 2:
        return lines.length > 0;
      case 3:
        return lines.length > 0 && lines.every((l) => l.actualQty != null && l.actualQty >= 0);
      case 4:
        return resolved.length > 0;
      case 5:
        return resolved.length > 0 && Boolean(reason);
      default:
        return false;
    }
  })();

  function reset() {
    setStep(0);
    setLines([]);
    setReason("");
    setNote("");
    setUnitCost(null);
    setSearch("");
    setReasonError(null);
    if (!initialWarehouseId) setWarehouseId("");
  }

  async function submit() {
    if (saving) return;
    if (!warehouseId) return toast.error(isAr ? "يرجى تحديد المستودع" : "Select a warehouse");
    if (!reason) {
      setReasonError(isAr ? "السبب إجباري للتسوية" : "A reason is required");
      return toast.error(isAr ? "يرجى اختيار سبب التسوية" : "Please select a reason");
    }
    if (resolved.length === 0) {
      return toast.error(
        isAr
          ? "لا توجد فروقات مطابقة للاعتماد — أدخل جرداً فعلياً مختلفاً عن الرصيد الدفتري"
          : "No differences to post — enter an actual count that differs from the book balance",
      );
    }

    setSaving(true);
    try {
      for (const line of resolved) {
        const actual = line.actualQty as number;
        const { error: invErr } = await supabase.from("inventory").upsert(
          {
            product_id: line.product_id,
            warehouse_id: warehouseId,
            quantity: actual,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "product_id,warehouse_id" },
        );
        if (invErr) throw invErr;

        const { error: mvErr } = await supabase.from("stock_movements").insert({
          product_id: line.product_id,
          warehouse_id: warehouseId,
          movement_type: "adjustment",
          quantity: line.diff,
          unit_cost: Number(unitCost ?? 0),
          note: note.trim() || null,
          adjustment_reason: reason,
          created_by: user?.id ?? null,
        } as never);
        if (mvErr) throw mvErr;
      }

      toast.success(
        isAr
          ? `تم اعتماد ${resolved.length} تسوية بنجاح`
          : `${resolved.length} adjustment(s) posted successfully`,
      );
      reset();
      onOpenChange(false);
      onSaved();
    } catch (err: any) {
      toast.error(err?.message ?? (isAr ? "فشل تنفيذ التسوية" : "Failed to post adjustment"));
    } finally {
      setSaving(false);
    }
  }

  const stepTitle = isAr ? SETTLEMENT_STEPS[step].ar : SETTLEMENT_STEPS[step].en;

  return (
    <VortexDrawerDialog
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      dismissible={!saving}
      eyebrow={isAr ? "تسوية جردية" : "Stock settlement"}
      icon={<Scale className="h-5 w-5" />}
      title={isAr ? "معالج التسوية الجردية" : "Stock settlement wizard"}
      subtitle={`${isAr ? "الخطوة" : "Step"} ${step + 1} / ${SETTLEMENT_STEPS.length} — ${stepTitle}`}
      bodyClassName="space-y-4"
      footer={
        <div className="flex w-full items-center justify-between gap-2">
          <Button
            type="button"
            variant="outline"
            className="rounded-xl"
            disabled={step === 0 || saving}
            onClick={() => setStep((s) => Math.max(0, s - 1))}
          >
            <ArrowRight className="size-4 rtl:rotate-180" />
            {isAr ? "السابق" : "Back"}
          </Button>

          <span className="truncate font-mono text-xs text-muted-foreground">
            {summary.netQty !== 0
              ? `${summary.netQty > 0 ? "+" : ""}${summary.netQty.toFixed(2)}`
              : "—"}
          </span>

          {step < SETTLEMENT_STEPS.length - 1 ? (
            <Button
              type="button"
              disabled={!canGoNext}
              onClick={() => setStep((s) => s + 1)}
              className="rounded-xl bg-primary font-semibold text-primary-foreground"
            >
              {isAr ? "التالي" : "Next"}
              <ArrowLeft className="size-4 rtl:rotate-180" />
            </Button>
          ) : (
            <Button
              type="button"
              loading={saving}
              disabled={!canGoNext}
              onClick={submit}
              className="rounded-xl bg-primary font-semibold text-primary-foreground"
            >
              <ClipboardCheck className="size-4" />
              {isAr ? "اعتماد التسوية" : "Post adjustment"}
            </Button>
          )}
        </div>
      }
    >
      <Stepper current={step} />

      {/* ─── Step 1: warehouse ─── */}
      {step === 0 && (
        <div className="space-y-3">
          <p className="text-caption text-muted-foreground">
            {isAr
              ? "اختر المستودع الذي تم الجرد فيه. كل الرصيد والفروقات التالية محسوبة له."
              : "Choose the warehouse that was counted. All balances below relate to it."}
          </p>
          {warehouses.isLoading ? (
            <RowSkeletons count={3} />
          ) : warehouseItems.length === 0 ? (
            <EmptyState
              icon={<WarehouseIcon className="size-4" />}
              title={isAr ? "لا توجد مستودعات" : "No warehouses"}
              description={
                isAr
                  ? "أضف مستودعاً من شاشة المستودعات قبل إجراء تسوية."
                  : "Add a warehouse before running a settlement."
              }
            />
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {warehouseItems.map((w) => {
                const active = w.id === warehouseId;
                return (
                  <button
                    key={w.id}
                    type="button"
                    onClick={() => setWarehouseId(w.id)}
                    className={cn(
                      "flex items-center justify-between gap-3 rounded-xl border p-3 text-start transition",
                      active
                        ? "border-primary bg-primary/5 ring-2 ring-primary/20"
                        : "border-border/80 hover:bg-muted/50",
                    )}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-foreground">
                        {warehouseLabel(w)}
                      </span>
                      <span className="block text-[11px] text-muted-foreground">
                        {w.code ?? "—"}
                      </span>
                    </span>
                    {active && <Check className="size-4 shrink-0 text-primary" />}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ─── Step 2: items ─── */}
      {step === 1 && (
        <div className="space-y-3">
          <FormField label={isAr ? "ابحث عن الصنف" : "Search item"} showIcon={false}>
            {(p) => (
              <FieldInput
                {...p}
                type="search"
                value={search}
                onValueChange={setSearch}
                placeholder={isAr ? "الاسم أو SKU أو الباركود" : "Name, SKU or barcode"}
                icon={<Search className="size-4" />}
              />
            )}
          </FormField>

          {lines.length > 0 && (
            <div className="rounded-xl border-border/70">
              <p className="border-b border-border/60 px-3 py-2 text-[11px] font-semibold text-muted-foreground">
                {isAr ? "الأصناف المختارة" : "Selected items"} ({lines.length})
              </p>
              <ul>
                {lines.map((l) => (
                  <li
                    key={l.product_id}
                    className="flex items-center justify-between gap-2 border-b border-border/40 px-3 py-2 last:border-0"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm text-foreground">{l.name}</span>
                      <span className="block text-[11px] text-muted-foreground">
                        {l.sku ?? "—"}
                      </span>
                    </span>
                    <button
                      type="button"
                      onClick={() => removeProduct(l.product_id)}
                      aria-label={t("common.delete")}
                      className="shrink-0 rounded-lg p-1 text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="max-h-60 overflow-y-auto rounded-xl border-border/70 p-1">
            {filteredProducts.length === 0 ? (
              <EmptyState
                icon={<Search className="size-4" />}
                title={isAr ? "لا توجد نتائج" : "No results"}
                description={isAr ? "جرّب اسماً آخر." : "Try another name."}
              />
            ) : (
              filteredProducts.map((p) => {
                const picked = lines.some((l) => l.product_id === p.id);
                return (
                  <button
                    key={p.id}
                    type="button"
                    disabled={picked}
                    onClick={() => addProduct(p)}
                    className="flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-start transition hover:bg-accent disabled:opacity-45"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-foreground">
                        {isAr ? p.name_ar || p.name : p.name}
                      </span>
                      <span className="block truncate text-[11px] text-muted-foreground">
                        {p.sku ?? "—"}
                      </span>
                    </span>
                    {picked ? (
                      <Check className="size-4 shrink-0 text-primary" />
                    ) : (
                      <Plus className="size-4 shrink-0 text-muted-foreground" />
                    )}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* ─── Step 3: book balance ─── */}
      {step === 2 && (
        <div className="space-y-3">
          <p className="text-caption text-muted-foreground">
            {isAr
              ? `الرصيد الدفتري في ${warehouseLabel(selectedWarehouse)} كما هو مسجَّل في النظام.`
              : `Book balance in ${warehouseLabel(selectedWarehouse)} as recorded by the system.`}
          </p>
          {ledgerQuery.isLoading ? (
            <RowSkeletons count={lines.length || 3} />
          ) : (
            <div className="overflow-hidden rounded-xl border-border/70">
              <table className="w-full text-sm">
                <thead className="bg-surface-2/60 text-[11px] uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-start">{isAr ? "الصنف" : "Item"}</th>
                    <th className="px-3 py-2 text-start">SKU</th>
                    <th className="px-3 py-2 text-end">
                      {isAr ? "الرصيد الدفتري" : "Book balance"}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l) => (
                    <tr key={l.product_id} className="border-t border-border/60">
                      <td className="px-3 py-2 text-foreground">{l.name}</td>
                      <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                        {l.sku ?? "—"}
                      </td>
                      <td className="px-3 py-2 text-end font-mono font-semibold text-foreground">
                        {l.ledgerQty.toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ─── Step 4: actual count ─── */}
      {step === 3 && (
        <div className="space-y-2">
          <p className="text-caption text-muted-foreground">
            {isAr
              ? "أدخل الكمية المحصورة فعلياً على الرف لكل صنف."
              : "Enter the quantity physically counted on the shelf for each item."}
          </p>
          {lines.map((l) => (
            <div
              key={l.product_id}
              className="flex flex-col gap-2 rounded-xl border-border/70 bg-surface/60 p-3 sm:flex-row sm:items-end"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">{l.name}</p>
                <p className="text-[11px] text-muted-foreground">
                  {isAr ? "الرصيد الدفتري" : "Book balance"}:{" "}
                  <span className="font-mono">{l.ledgerQty.toFixed(2)}</span>
                </p>
              </div>
              <FormField label={isAr ? "الجرد الفعلي" : "Actual count"} className="sm:w-44">
                {(p) => (
                  <NumberInput
                    {...p}
                    decimal
                    min={0}
                    value={l.actualQty}
                    onValueChange={(v) =>
                      setLines((prev) =>
                        prev.map((x) =>
                          x.product_id === l.product_id ? { ...x, actualQty: v } : x,
                        ),
                      )
                    }
                    placeholder="0.00"
                    className="text-center font-mono text-base"
                  />
                )}
              </FormField>
            </div>
          ))}
        </div>
      )}

      {/* ─── Step 5: differences ─── */}
      {step === 4 && (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2">
            <StatTile
              tone="danger"
              label={isAr ? "عجز" : "Shortage"}
              value={`${summary.shortages}`}
              sub={`${summary.shortageQty.toFixed(2)} ${isAr ? "وحدة" : "units"}`}
            />
            <StatTile
              tone="success"
              label={isAr ? "فائض" : "Surplus"}
              value={`${summary.surpluses}`}
              sub={`${summary.surplusQty.toFixed(2)} ${isAr ? "وحدة" : "units"}`}
            />
            <StatTile
              tone={summary.netQty < 0 ? "danger" : summary.netQty > 0 ? "success" : "neutral"}
              label={isAr ? "صافي الفرق" : "Net"}
              value={`${summary.netQty > 0 ? "+" : ""}${summary.netQty.toFixed(2)}`}
              sub={money(summary.netValue)}
            />
          </div>

          {resolved.length === 0 ? (
            <EmptyState
              tone="info"
              icon={<CheckCircle2 className="size-4" />}
              title={isAr ? "لا توجد فروقات" : "No differences"}
              description={
                isAr
                  ? "الجرد الفعلي مطابق تماماً للرصيد الدفتري لكل الأصناف."
                  : "The physical count matches the book balance for every item."
              }
            />
          ) : (
            <ul className="space-y-1.5">
              {resolved.map((d) => (
                <li
                  key={d.product_id}
                  className={cn(
                    "flex items-center justify-between gap-3 rounded-xl border p-3",
                    d.state === "shortage"
                      ? "border-rose-500/30 bg-rose-500/5"
                      : "border-emerald-500/30 bg-emerald-500/5",
                  )}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-foreground">
                      {d.name}
                    </span>
                    <span className="block text-[11px] text-muted-foreground">
                      {isAr ? "الدفتري" : "Book"} {d.ledgerQty.toFixed(2)} ·{" "}
                      {isAr ? "الفعلي" : "Actual"} {(d.actualQty as number).toFixed(2)}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    <StatusBadge tone={d.state === "shortage" ? "danger" : "success"}>
                      {d.state === "shortage" ? (
                        <TrendingDown className="size-3" />
                      ) : (
                        <TrendingUp className="size-3" />
                      )}
                      {d.diff > 0 ? "+" : ""}
                      {d.diff.toFixed(2)}
                    </StatusBadge>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* ─── Step 6: review & post ─── */}
      {step === 5 && (
        <div className="space-y-3">
          <div className="rounded-xl border-border/70 bg-surface-2/40 p-3 text-sm">
            <ReviewRow
              label={isAr ? "المستودع" : "Warehouse"}
              value={warehouseLabel(selectedWarehouse)}
            />
            <ReviewRow label={isAr ? "عدد الأصناف" : "Items"} value={`${resolved.length}`} />
            <ReviewRow
              label={isAr ? "صافي الفرق" : "Net difference"}
              value={`${summary.netQty > 0 ? "+" : ""}${summary.netQty.toFixed(2)}`}
            />
            <ReviewRow
              label={isAr ? "القيمة التقديرية" : "Estimated value"}
              value={money(summary.netValue)}
            />
          </div>

          <FormField label={isAr ? "سبب التسوية *" : "Adjustment reason *"} error={reasonError}>
            {() => (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {REASONS.map((r) => (
                  <button
                    key={r.value}
                    type="button"
                    onClick={() => {
                      setReason(r.value);
                      setReasonError(null);
                    }}
                    className={cn(
                      "rounded-xl border px-3 py-2 text-xs font-semibold transition",
                      reason === r.value
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border/80 text-muted-foreground hover:bg-muted hover:text-foreground",
                    )}
                  >
                    {isAr ? r.ar : r.en}
                  </button>
                ))}
              </div>
            )}
          </FormField>

          <FormField
            label={isAr ? "تكلفة الوحدة للتسوية" : "Unit cost for adjustment"}
            hint={isAr ? "تُستخدم في إثبات القيد المحاسبي." : "Used for the accounting entry."}
          >
            {(p) => (
              <NumberInput
                {...p}
                decimal
                min={0}
                value={unitCost}
                onValueChange={setUnitCost}
                className="font-mono"
              />
            )}
          </FormField>

          <FormField label={isAr ? "ملاحظات وتفاصيل إضافية" : "Notes & details"}>
            {(p) => (
              <Textarea
                {...p}
                rows={3}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={isAr ? "مبرر التسوية..." : "Adjustment justification…"}
              />
            )}
          </FormField>

          {resolved.length > 0 && (
            <p className="flex items-start gap-1.5 rounded-xl border-amber-500/30 bg-amber-500/5 p-3 text-[11px] text-amber-700 dark:text-amber-300">
              <TriangleAlert className="mt-px size-3.5 shrink-0" />
              <span>
                {isAr
                  ? " movements التسوية غير قابلة للحذف؛ أي تصحيح لاحق يتم بتسوية عكسية موثقة."
                  : "Settlement movements are append-only; corrections require a new reversing entry."}
              </span>
            </p>
          )}
        </div>
      )}
    </VortexDrawerDialog>
  );
}

/* ------------------------------------------------------------------ */
/*  Small local presentational pieces                                  */
/* ------------------------------------------------------------------ */

function Stepper({ current }: { current: number }) {
  const { lang } = useI18n();
  const isAr = lang === "ar";
  return (
    <ol className="flex items-center gap-1 overflow-x-auto pb-1">
      {SETTLEMENT_STEPS.map((s, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <li key={s.en} className="flex shrink-0 items-center gap-1">
            <span
              className={cn(
                "grid size-6 shrink-0 place-items-center rounded-full border text-[10px] font-bold transition",
                active
                  ? "border-primary bg-primary text-primary-foreground"
                  : done
                    ? "border-primary/40 bg-primary/10 text-primary"
                    : "border-border/80 text-muted-foreground",
              )}
            >
              {done ? <Check className="size-3" /> : i + 1}
            </span>
            <span
              className={cn(
                "whitespace-nowrap text-[10px] font-medium",
                active ? "text-foreground" : "text-muted-foreground",
              )}
            >
              {isAr ? s.ar : s.en}
            </span>
            {i < SETTLEMENT_STEPS.length - 1 && (
              <span className="mx-0.5 h-px w-3 shrink-0 bg-border sm:w-5" />
            )}
          </li>
        );
      })}
    </ol>
  );
}

function StatTile({
  tone,
  label,
  value,
  sub,
}: {
  tone: "danger" | "success" | "neutral";
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border p-3 text-center",
        tone === "danger"
          ? "border-rose-500/30 bg-rose-500/5"
          : tone === "success"
            ? "border-emerald-500/30 bg-emerald-500/5"
            : "border-border/70",
      )}
    >
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p
        className={cn(
          "mt-1 font-mono text-lg font-bold",
          tone === "danger"
            ? "text-rose-600 dark:text-rose-400"
            : tone === "success"
              ? "text-emerald-600 dark:text-emerald-400"
              : "text-foreground",
        )}
      >
        {value}
      </p>
      <p className="text-[10px] text-muted-foreground">{sub}</p>
    </div>
  );
}

function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="font-mono text-sm font-semibold text-foreground">{value}</span>
    </div>
  );
}

function RowSkeletons({ count }: { count: number }) {
  return (
    <ul className="space-y-2">
      {Array.from({ length: Math.max(3, count) }).map((_, i) => (
        <li key={i} className="h-14 animate-pulse rounded-xl bg-muted/50" />
      ))}
    </ul>
  );
}

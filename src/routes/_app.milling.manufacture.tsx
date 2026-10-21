/**
 * /milling/manufacture — زر التصنيع الذكي المطور (طحن منتجات المنشأة).
 *
 * وثيقة الماستر بلان الشاملة (DOC-MILLING-ERP-MASTER-2026-V2-AUDITED):
 * 1. مدخلات الحبوب بالأكياس وسعة الكيس أو بالكيلو مع الرصيد اللحظي.
 * 2. الفاقد التشغيلي المرن والاختياري (إدخال يدوي أو احتساب تلقائي عند تركه فارغاً).
 * 3. المساعد الذكي المقترح ⚡ لحساب الأكياس بنقرة واحدة (اختياري).
 * 4. توزيع التكلفة النسبي حسب القيمة البيعية مع عرض تكلفة الكيس وهامش الربح.
 * 5. فحص وتحققات تمنع التجاوزات والأخطاء المحاسبية.
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import {
  Factory,
  Plus,
  Trash2,
  ArrowLeft,
  Info,
  Package,
  AlertTriangle,
  CheckCircle2,
  TrendingDown,
  PieChart,
  Warehouse as WarehouseIcon,
  Layers,
  Sparkles,
  Zap,
  TrendingUp,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/page-header";
import { ModuleGuard } from "@/lib/modules";
import { supabase } from "@/integrations/supabase/client";
import { translateRpcError } from "@/lib/errors/rpc-errors";
import {
  smartManufacture,
  fetchGrainItems,
  fetchOutputItems,
  type ProductOption,
} from "@/lib/milling";
import {
  MillingPanel,
  MillingSectionTitle,
  MillingField,
  MillingInput,
  MillingSelect,
  MillingTextarea,
  Mono,
  fmtNum,
} from "@/components/milling/milling-ui";
import { QuantityInput } from "@/components/ui/quantity-input";
import { BagWeightInput } from "@/components/milling/bag-weight-input";

export const Route = createFileRoute("/_app/milling/manufacture")({
  head: () => ({ meta: [{ title: "التصنيع الذكي وطحن منتجات المنشأة — فورتكس ERP" }] }),
  component: SmartManufacturePage,
});

interface WarehouseOption {
  id: string;
  name_ar: string | null;
  name: string;
  is_default: boolean | null;
}

interface OutputLine {
  itemId: string;
  packageType: "bulk" | "50" | "25" | "10" | "5" | "custom";
  customPackageKg?: string;
  bagsCount?: string;
  qty: string; // Net weight in kg
}

export function SmartManufacturePage() {
  const qc = useQueryClient();
  const [warehouseId, setWarehouseId] = useState("");
  const [grainItemId, setGrainItemId] = useState("");
  const [grainBags, setGrainBags] = useState("");
  const [grainCapacityKg, setGrainCapacityKg] = useState("50");
  const [grainQty, setGrainQty] = useState("");
  const [batchRef, setBatchRef] = useState("");
  const [notes, setNotes] = useState("");
  const [manualWasteKg, setManualWasteKg] = useState("");

  const [outputs, setOutputs] = useState<OutputLine[]>([
    { itemId: "", packageType: "50", bagsCount: "", qty: "" },
  ]);

  // مستودعات النظام
  const warehouses = useQuery({
    queryKey: ["milling", "warehouses"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("warehouses")
        .select("id, name, name_ar, is_default")
        .eq("is_active", true)
        .order("is_default", { ascending: false });
      if (error) throw error;
      return (data ?? []) as WarehouseOption[];
    },
  });

  // تحديد المستودع الافتراضي تلقائياً
  useEffect(() => {
    if (warehouseId) return;
    const list = warehouses.data ?? [];
    const preferred = list.find((w) => w.is_default) ?? list[0];
    if (preferred) setWarehouseId(preferred.id);
  }, [warehouses.data, warehouseId]);

  // قائمة أصناف الحبوب المتاحة
  const grainItems = useQuery({
    queryKey: ["milling", "grain-items"],
    queryFn: fetchGrainItems,
  });

  // قائمة النواتج المتاحة
  const outputItems = useQuery({
    queryKey: ["milling", "output-items"],
    queryFn: fetchOutputItems,
  });

  const allItems = [...(grainItems.data ?? []), ...(outputItems.data ?? [])];
  const selectedGrain = grainItems.data?.find((g) => g.id === grainItemId);

  // تحديث سعة كيس القمح تلقائياً عند تغيير الصنف
  useEffect(() => {
    if (selectedGrain?.package_weight_kg) {
      setGrainCapacityKg(String(selectedGrain.package_weight_kg));
    }
  }, [selectedGrain]);

  // الرصيد المخزني المتاح للقمح في المستودع المختار
  const grainStockQuery = useQuery({
    queryKey: ["milling", "grain-stock", warehouseId, grainItemId],
    queryFn: async () => {
      if (!warehouseId || !grainItemId) return 0;
      const { data, error } = await supabase
        .from("inventory")
        .select("quantity")
        .eq("warehouse_id", warehouseId)
        .eq("product_id", grainItemId)
        .maybeSingle();

      if (error) {
        console.error("Error fetching grain stock:", error);
        return 0;
      }
      return Number(data?.quantity ?? 0);
    },
    enabled: Boolean(warehouseId && grainItemId),
  });

  const availableStock = grainStockQuery.data ?? 0;
  const numGrainQty = Number(grainQty) || 0;
  const isOverStock = availableStock > 0 && numGrainQty > availableStock;

  // احتساب إجمالي النواتج بالكجم
  const totalOutputKg = useMemo(() => {
    return outputs.reduce((sum, l) => sum + (Number(l.qty) || 0), 0);
  }, [outputs]);

  // معالجة الفاقد التشغيلي المرن: إدخال يدوي أو احتساب تلقائي
  const hasManualWaste = manualWasteKg.trim() !== "";
  const parsedManualWaste = Number(manualWasteKg) || 0;
  const autoWasteKg = Math.max(0, numGrainQty - totalOutputKg);
  const effectiveWasteKg = hasManualWaste ? parsedManualWaste : autoWasteKg;

  const isOutputsOverGrain = numGrainQty > 0 && totalOutputKg > numGrainQty;
  const isOutputsPlusWasteOverGrain =
    numGrainQty > 0 && hasManualWaste && totalOutputKg + parsedManualWaste > numGrainQty + 0.001;

  const wastePercent = numGrainQty > 0 ? (effectiveWasteKg / numGrainQty) * 100 : 0;
  const yieldPercent = numGrainQty > 0 ? (totalOutputKg / numGrainQty) * 100 : 0;

  // أسعار البيع والتكلفة
  const priceOf = (id: string) => allItems.find((p) => p.id === id)?.sale_price ?? 0;
  const costOfGrain = selectedGrain?.cost_price ?? selectedGrain?.sale_price ?? 0;
  const totalInputCost = numGrainQty * costOfGrain;

  // إجمالي قيمة النواتج بسعر البيع (أساس التوزيع النسبي)
  const totalOutputValue = useMemo(() => {
    return outputs.reduce((s, l) => s + (Number(l.qty) || 0) * priceOf(l.itemId), 0);
  }, [outputs, allItems]);

  // تكلفة الفاقد التشغيلي
  const wasteCost = Math.round(effectiveWasteKg * costOfGrain * 100) / 100;
  // التكلفة الصافية الموزعة على النواتج
  const allocatableCost = Math.max(0, totalInputCost - (hasManualWaste ? wasteCost : 0));

  // معالجة تغيير نوع التعبئة أو عدد الأكياس
  const handlePackageChange = (
    idx: number,
    packageType: OutputLine["packageType"],
    customKg?: string,
  ) => {
    setOutputs((prev) =>
      prev.map((line, i) => {
        if (i !== idx) return line;
        let bagWeight = 0;
        if (packageType === "50") bagWeight = 50;
        else if (packageType === "25") bagWeight = 25;
        else if (packageType === "10") bagWeight = 10;
        else if (packageType === "5") bagWeight = 5;
        else if (packageType === "custom") bagWeight = Number(customKg) || 0;

        const bags = Number(line.bagsCount) || 0;
        const newQty =
          packageType === "bulk" ? line.qty : bags > 0 ? String(bags * bagWeight) : line.qty;

        return {
          ...line,
          packageType,
          customPackageKg: customKg !== undefined ? customKg : line.customPackageKg,
          qty: newQty,
        };
      }),
    );
  };

  const handleBagsCountChange = (idx: number, bagsCount: string) => {
    setOutputs((prev) =>
      prev.map((line, i) => {
        if (i !== idx) return line;
        let bagWeight = 0;
        if (line.packageType === "50") bagWeight = 50;
        else if (line.packageType === "25") bagWeight = 25;
        else if (line.packageType === "10") bagWeight = 10;
        else if (line.packageType === "5") bagWeight = 5;
        else if (line.packageType === "custom") bagWeight = Number(line.customPackageKg) || 0;

        const bags = Number(bagsCount) || 0;
        const calculatedQty = bagWeight > 0 && bags > 0 ? String(bags * bagWeight) : line.qty;

        return {
          ...line,
          bagsCount,
          qty: bagWeight > 0 ? calculatedQty : line.qty,
        };
      }),
    );
  };

  // المساعد الذكي المقترح ⚡ لحساب الأكياس بنقرة واحدة
  const canSuggestBags = useMemo(() => {
    if (numGrainQty <= 0) return false;
    const remainingKg = Math.max(0, numGrainQty - (hasManualWaste ? parsedManualWaste : 0));
    return remainingKg > 0 && outputs.some((l) => l.itemId && l.packageType !== "bulk");
  }, [numGrainQty, hasManualWaste, parsedManualWaste, outputs]);

  const handleSmartSuggestBags = () => {
    const remainingKg = Math.max(0, numGrainQty - (hasManualWaste ? parsedManualWaste : 0));
    if (remainingKg <= 0) return;

    if (outputs.length === 1) {
      const line = outputs[0];
      let bagWeight = 50;
      if (line.packageType === "50") bagWeight = 50;
      else if (line.packageType === "25") bagWeight = 25;
      else if (line.packageType === "10") bagWeight = 10;
      else if (line.packageType === "5") bagWeight = 5;
      else if (line.packageType === "custom") bagWeight = Number(line.customPackageKg) || 50;

      const suggestedBags = Math.floor(remainingKg / bagWeight);
      if (suggestedBags > 0) {
        setOutputs([
          {
            ...line,
            bagsCount: String(suggestedBags),
            qty: String(suggestedBags * bagWeight),
          },
        ]);
        toast.success(`تم اقتراح ${suggestedBags} كيس سعة ${bagWeight} كجم.`);
      }
    } else {
      toast.info("اقتراح الأكياس التلقائي السريع يملأ السطر الأول بالكمية المتاحة.");
      const line = outputs[0];
      let bagWeight = 50;
      if (line.packageType === "50") bagWeight = 50;
      else if (line.packageType === "25") bagWeight = 25;
      else if (line.packageType === "10") bagWeight = 10;
      else if (line.packageType === "5") bagWeight = 5;
      else if (line.packageType === "custom") bagWeight = Number(line.customPackageKg) || 50;

      const suggestedBags = Math.floor(remainingKg / bagWeight);
      if (suggestedBags > 0) {
        setOutputs((prev) =>
          prev.map((l, i) =>
            i === 0
              ? {
                  ...l,
                  bagsCount: String(suggestedBags),
                  qty: String(suggestedBags * bagWeight),
                }
              : l,
          ),
        );
      }
    }
  };

  // تنفيذ عملية التصنيع
  const submit = useMutation({
    mutationFn: () => {
      const fullNotes = [
        batchRef ? `تشغيلة: ${batchRef.trim()}` : "",
        hasManualWaste ? `فاقد مدخل يدوياً: ${parsedManualWaste} كجم` : "",
        notes ? notes.trim() : "",
      ]
        .filter(Boolean)
        .join(" — ");

      return smartManufacture({
        warehouseId,
        grainItemId,
        grainQty: numGrainQty,
        outputs: outputs.map((l) => ({ itemId: l.itemId, qty: Number(l.qty) || 0 })),
        notes: fullNotes || undefined,
      });
    },
    onSuccess: (res) => {
      if (!res.ok) {
        toast.error(res.message || "تعذر تنفيذ التصنيع.");
        return;
      }
      toast.success(`تم التصنيع وترحيل القيود بنجاح — مستند ${res.data ?? ""}`);
      setGrainQty("");
      setGrainBags("");
      setBatchRef("");
      setOutputs([{ itemId: "", packageType: "50", bagsCount: "", qty: "" }]);
      setManualWasteKg("");
      setNotes("");
      void qc.invalidateQueries({ queryKey: ["milling"] });
      void qc.invalidateQueries({ queryKey: ["inventory"] });
    },
    // P1-4: كل خطأ RPC يمر بطبقة الترجمة الموحدة قبل العرض.
    onError: (err) => toast.error(translateRpcError(err, "ar", "تعذر تنفيذ التصنيع.")),
  });

  // شروط تفعيل زر التنفيذ
  const canSubmit = Boolean(
    warehouseId &&
    grainItemId &&
    numGrainQty > 0 &&
    !isOverStock &&
    !isOutputsOverGrain &&
    !isOutputsPlusWasteOverGrain &&
    outputs.length > 0 &&
    outputs.every((l) => l.itemId && (Number(l.qty) || 0) > 0) &&
    totalOutputValue > 0,
  );

  return (
    <ModuleGuard moduleId="milling_operations">
      <div className="mx-auto max-w-5xl space-y-5 p-3 sm:p-5">
        <PageHeader
          title="التصنيع الذكي وطحن منتجات المنشأة"
          subtitle="تحويل مخزون الحبوب (القمح) إلى منتجات تامة ونواتج جانبية بتكلفة موزعة آلياً حسب القيمة النسبية."
          actions={
            <div className="flex items-center gap-2">
              <Link
                to="/milling/consumables"
                className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-surface px-3 py-2 text-xs font-bold text-foreground transition hover:bg-muted"
              >
                صرف مستهلكات تشغيلية <ArrowLeft className="h-3.5 w-3.5" />
              </Link>
            </div>
          }
        />

        {/* تنبيه الإيضاح المحاسبي المريح */}
        <div className="flex items-start gap-2.5 rounded-2xl border border-sky-500/20 bg-sky-500/10 p-3.5 text-xs font-medium text-sky-800 dark:text-sky-200">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-sky-600 dark:text-sky-400" />
          <p className="leading-relaxed">
            <strong>نظام التوزيع النسبي المعتمد:</strong> يتم خصم القمح من المخزون بتكلفته الفعلية،
            وتُوزع التكلفة بالكامل على النواتج بحسب نسبة القيمة السوقية لكل منتج (دقيق، سميد،
            نخالة)، مع إثبات الفاقد التشغيلي في دفتر الأستاذ العام (حـ/ 5921).
          </p>
        </div>

        {/* ─── اللوحة الأولى: مدخلات القمح والمستودع ─── */}
        <MillingPanel>
          <MillingSectionTitle
            icon={<WarehouseIcon className="h-4 w-4 text-amber-500" />}
            title="1. مدخلات المادة الخام (القمح / الحبوب)"
            subtitle="حدد المستودع ونوع القمح والكمية بالأكياس أو الوزن المباشر"
          />
          <div className="space-y-4 p-4 sm:p-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <MillingField label="مستودع السحب *">
                <MillingSelect value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
                  <option value="">اختر المخزن…</option>
                  {(warehouses.data ?? []).map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name_ar || w.name} {w.is_default ? "★ (الرئيسي)" : ""}
                    </option>
                  ))}
                </MillingSelect>
              </MillingField>

              <MillingField label="صنف الحبوب (القمح) *">
                <MillingSelect value={grainItemId} onChange={(e) => setGrainItemId(e.target.value)}>
                  <option value="">اختر الصنف…</option>
                  {(grainItems.data ?? []).map((g: ProductOption) => (
                    <option key={g.id} value={g.id}>
                      {g.name_ar || g.name} ({g.sku})
                    </option>
                  ))}
                </MillingSelect>
              </MillingField>
            </div>

            {/* محول الأكياس والسعة المشترك لمدخلات القمح */}
            <BagWeightInput
              label="كمية القمح المراد طحنها (أكياس أو كجم)"
              bags={grainBags}
              capacityKg={grainCapacityKg}
              totalKg={grainQty}
              defaultCapacity={selectedGrain?.package_weight_kg || 50}
              onChange={(val) => {
                setGrainBags(val.bags > 0 ? String(val.bags) : "");
                setGrainCapacityKg(String(val.capacityKg));
                setGrainQty(val.totalKg > 0 ? String(val.totalKg) : "");
              }}
            />

            {/* شريط حالة الرصيد المخزني الفعلي */}
            {grainItemId && warehouseId && (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border/70 bg-surface/80 p-3 text-xs">
                <div className="flex flex-wrap items-center gap-2">
                  <Package className="h-4 w-4 text-muted-foreground" />
                  <span>
                    الرصيد المتاح بالمخزن:{" "}
                    <strong className={availableStock > 0 ? "text-foreground" : "text-rose-500"}>
                      <Mono>{fmtNum(availableStock)}</Mono> كجم
                    </strong>
                  </span>
                  {Number(grainCapacityKg) > 0 && availableStock > 0 && (
                    <span className="text-muted-foreground">
                      (يعادل تقريباً{" "}
                      <Mono>{(availableStock / Number(grainCapacityKg)).toFixed(1)}</Mono> كيس سعة{" "}
                      {grainCapacityKg} كجم)
                    </span>
                  )}
                  {selectedGrain?.cost_price && selectedGrain.cost_price > 0 && (
                    <span className="text-muted-foreground">
                      · متوسط التكلفة: <Mono>{fmtNum(selectedGrain.cost_price)}</Mono>
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  {availableStock > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        const cap = Number(grainCapacityKg) || 50;
                        setGrainQty(String(availableStock));
                        setGrainBags(String((availableStock / cap).toFixed(2)));
                      }}
                      className="rounded-lg border border-border bg-surface px-2.5 py-1 text-[11px] font-bold text-primary transition hover:bg-muted active:scale-95"
                    >
                      تعبئة كامل الرصيد المتاح
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* تحذير تجاوز الرصيد المتاح */}
            {isOverStock && (
              <div className="flex items-center gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs font-semibold text-rose-700 dark:text-rose-300">
                <AlertTriangle className="h-4 w-4 shrink-0 text-rose-500" />
                <span>
                  تنبيه: الكمية المدخلة (<Mono>{grainQty}</Mono> كجم) أكبر من الرصيد المتوفر في
                  المخزن (<Mono>{fmtNum(availableStock)}</Mono> كجم)! يرجى تقليل الكمية.
                </span>
              </div>
            )}
          </div>
        </MillingPanel>

        {/* ─── اللوحة الثانية: النواتج وتعبئة الأكياس ─── */}
        <MillingPanel>
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/70 p-4">
            <MillingSectionTitle
              icon={<Factory className="h-4 w-4 text-emerald-500" />}
              title="2. المنتجات والنواتج المستخرجة"
              subtitle="أضف الأصناف الناتجة مع تحديد الأكياس وسعاتها أو الأوزان المباشرة"
            />
            <div className="flex items-center gap-2">
              {canSuggestBags && (
                <button
                  type="button"
                  onClick={handleSmartSuggestBags}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs font-bold text-amber-700 dark:text-amber-300 transition hover:bg-amber-500/20 active:scale-95"
                  title="اقتراح حساب الأكياس بناءً على القمح المدخل"
                >
                  <Zap className="h-3.5 w-3.5 text-amber-500" />
                  <span>⚡ اقتراح حساب الأكياس</span>
                </button>
              )}
              <button
                type="button"
                onClick={() =>
                  setOutputs((o) => [
                    ...o,
                    { itemId: "", packageType: "50", bagsCount: "", qty: "" },
                  ])
                }
                className="inline-flex items-center gap-1.5 rounded-xl border border-primary/30 bg-primary/10 px-3 py-1.5 text-xs font-bold text-primary transition hover:bg-primary/20 active:scale-95"
              >
                <Plus className="h-3.5 w-3.5" /> إضافة سطر ناتج
              </button>
            </div>
          </div>

          <div className="space-y-3.5 p-4 sm:p-5">
            {outputs.map((line, idx) => {
              const selectedProd = outputItems.data?.find((p) => p.id === line.itemId);
              const lineQtyNum = Number(line.qty) || 0;
              const salePrice = selectedProd?.sale_price ?? 0;
              const lineValue = lineQtyNum * salePrice;
              const valueRatio = totalOutputValue > 0 ? (lineValue / totalOutputValue) * 100 : 0;

              // تكلفة الكيلو الموزعة
              const estimatedUnitCostKg =
                lineQtyNum > 0 && totalOutputValue > 0 && allocatableCost > 0
                  ? (allocatableCost * (lineValue / totalOutputValue)) / lineQtyNum
                  : 0;

              // سعة الكيس الحالية للسطر
              let bagCapacity = 0;
              if (line.packageType === "50") bagCapacity = 50;
              else if (line.packageType === "25") bagCapacity = 25;
              else if (line.packageType === "10") bagCapacity = 10;
              else if (line.packageType === "5") bagCapacity = 5;
              else if (line.packageType === "custom")
                bagCapacity = Number(line.customPackageKg) || 0;

              const estimatedBagCost = estimatedUnitCostKg * bagCapacity;
              const bagSalePrice = salePrice * bagCapacity;
              const marginPerBag = bagSalePrice - estimatedBagCost;
              const marginPercent = bagSalePrice > 0 ? (marginPerBag / bagSalePrice) * 100 : 0;

              return (
                <div
                  key={idx}
                  className="rounded-2xl border border-border/80 bg-surface/50 p-3 sm:p-4 space-y-3 transition hover:border-border"
                >
                  <div className="grid gap-3 sm:grid-cols-[1.5fr_1.2fr_1fr_40px] items-start">
                    {/* اختيار صنف الناتج */}
                    <div>
                      <label className="mb-1 block text-[11px] font-semibold text-muted-foreground">
                        صنف الناتج *
                      </label>
                      <MillingSelect
                        value={line.itemId}
                        onChange={(e) => {
                          const val = e.target.value;
                          const prod = outputItems.data?.find((p) => p.id === val);
                          setOutputs((o) =>
                            o.map((l, i) =>
                              i === idx
                                ? {
                                    ...l,
                                    itemId: val,
                                    packageType:
                                      prod?.package_weight_kg === 50
                                        ? "50"
                                        : prod?.package_weight_kg === 25
                                          ? "25"
                                          : prod?.package_weight_kg === 10
                                            ? "10"
                                            : prod?.package_weight_kg === 5
                                              ? "5"
                                              : "50",
                                  }
                                : l,
                            ),
                          );
                        }}
                      >
                        <option value="">اختر الناتج…</option>
                        {(outputItems.data ?? []).map((p: ProductOption) => (
                          <option key={p.id} value={p.id}>
                            {p.name_ar || p.name} — سعر بيع {fmtNum(p.sale_price)}/كجم
                          </option>
                        ))}
                      </MillingSelect>
                    </div>

                    {/* نمط التعبئة (سائب أو أكياس معيارية) */}
                    <div>
                      <label className="mb-1 block text-[11px] font-semibold text-muted-foreground">
                        نوع التعبئة والسعة
                      </label>
                      <select
                        className="h-10 w-full rounded-xl border border-border bg-surface px-2.5 text-xs font-semibold text-foreground outline-none transition focus:border-primary/60"
                        value={line.packageType}
                        onChange={(e) =>
                          handlePackageChange(idx, e.target.value as OutputLine["packageType"])
                        }
                      >
                        <option value="50">كيس 50 كجم</option>
                        <option value="25">كيس 25 كجم</option>
                        <option value="10">كيس 10 كجم</option>
                        <option value="5">كيس 5 كجم</option>
                        <option value="custom">سعة كيس مخصصة</option>
                        <option value="bulk">سائب (كجم مباشر)</option>
                      </select>
                    </div>

                    {/* الكمية والوزن */}
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="text-[11px] font-semibold text-muted-foreground">
                          {line.packageType === "bulk" ? "الكمية (كجم) *" : "عدد الأكياس *"}
                        </label>
                        {line.packageType !== "bulk" && (
                          <span className="text-[10px] text-muted-foreground">
                            = <Mono>{line.qty || "0"}</Mono> كجم
                          </span>
                        )}
                      </div>

                      {line.packageType === "bulk" ? (
                        <QuantityInput
                          decimals={3}
                          min={0}
                          emptyAsZero
                          unit="kg"
                          placeholder="كجم"
                          aria-label="الكمية كجم"
                          value={line.qty ? Number(line.qty) : null}
                          onValueChange={(v) =>
                            setOutputs((o) =>
                              o.map((l, i) =>
                                i === idx ? { ...l, qty: v == null ? "" : String(v) } : l,
                              ),
                            )
                          }
                        />
                      ) : (
                        <div className="space-y-1.5">
                          <QuantityInput
                            decimals={0}
                            min={0}
                            emptyAsZero
                            placeholder="عدد الأكياس"
                            aria-label="عدد الأكياس"
                            value={line.bagsCount ? Number(line.bagsCount) : null}
                            onValueChange={(v) =>
                              handleBagsCountChange(idx, v == null ? "" : String(v))
                            }
                          />
                          {line.packageType === "custom" && (
                            <QuantityInput
                              decimals={3}
                              min={0}
                              emptyAsZero
                              unit="kg"
                              placeholder="وزن الكيس كجم"
                              aria-label="وزن الكيس كجم"
                              value={line.customPackageKg ? Number(line.customPackageKg) : null}
                              onValueChange={(v) =>
                                handlePackageChange(idx, "custom", v == null ? "" : String(v))
                              }
                            />
                          )}
                        </div>
                      )}
                    </div>

                    {/* زر حذف السطر */}
                    <div className="pt-6 flex justify-end">
                      <button
                        type="button"
                        disabled={outputs.length === 1}
                        onClick={() => setOutputs((o) => o.filter((_, i) => i !== idx))}
                        className="grid h-10 w-10 place-items-center rounded-xl text-rose-500 transition hover:bg-rose-500/10 disabled:opacity-30"
                        aria-label="حذف السطر"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>

                  {/* ملخص السطر المالي والنسبي وهامش الربح */}
                  {lineQtyNum > 0 && selectedProd && (
                    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/50 pt-2 text-[11px] text-muted-foreground">
                      <div className="flex flex-wrap items-center gap-3">
                        <span>
                          القيمة الإجمالية:{" "}
                          <strong>
                            <Mono>{fmtNum(lineValue)}</Mono>
                          </strong>
                        </span>
                        <span>
                          نسبة القيمة:{" "}
                          <strong>
                            <Mono>{valueRatio.toFixed(1)}%</Mono>
                          </strong>
                        </span>
                        {estimatedUnitCostKg > 0 && (
                          <span className="text-emerald-600 dark:text-emerald-400 font-semibold">
                            تكلفة الكيلو: <Mono>{fmtNum(estimatedUnitCostKg)}</Mono>
                          </span>
                        )}
                      </div>
                      {bagCapacity > 0 && estimatedBagCost > 0 && (
                        <div className="flex items-center gap-2">
                          <span className="text-foreground font-semibold">
                            تكلفة الكيس ({bagCapacity} كجم):{" "}
                            <Mono className="text-amber-600 dark:text-amber-400 font-bold">
                              {fmtNum(estimatedBagCost)}
                            </Mono>
                          </span>
                          <span
                            className={cn(
                              "font-bold px-1.5 py-0.5 rounded",
                              marginPerBag >= 0
                                ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                                : "bg-rose-500/15 text-rose-700 dark:text-rose-300",
                            )}
                            title="هامش الربح المتوقع لكل كيس"
                          >
                            هامش: <Mono>{fmtNum(marginPerBag)}</Mono> ({marginPercent.toFixed(1)}%)
                          </span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </MillingPanel>

        {/* ─── اللوحة الثالثة: الفاقد التشغيلي المرن وتوازن الطحن ─── */}
        <MillingPanel>
          <MillingSectionTitle
            icon={<TrendingDown className="h-4 w-4 text-rose-500" />}
            title="3. الفاقد التشغيلي المرن وحساب التوازن"
            subtitle="يمكن إدخال الفاقد يدوياً أو تركه فارغاً لاحتسابه تلقائياً من الفرق"
          />
          <div className="p-4 sm:p-5 space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <MillingField
                label="الفاقد التشغيلي اليدوي (كجم)"
                hint="اختياري — اتركه فارغاً ليقوم النظام بحساب الفاقد آلياً"
              >
                <QuantityInput
                  min={0}
                  decimals={2}
                  unit="kg"
                  placeholder={`تلقائي (${fmtNum(autoWasteKg)} كجم)`}
                  aria-label="الفاقد التشغيلي اليدوي (كلجم)"
                  value={manualWasteKg === "" ? null : Number(manualWasteKg)}
                  onValueChange={(v) => setManualWasteKg(v == null ? "" : String(v))}
                />
              </MillingField>

              <div className="rounded-xl border border-border/70 bg-surface/80 p-3 text-xs flex flex-col justify-center">
                <span className="text-muted-foreground">حالة الفاقد المعتمد:</span>
                <p className="mt-1 font-bold text-foreground">
                  {hasManualWaste ? "محدد يدوياً من المستخدم" : "محسوب تلقائياً من فرق الأوزان"}
                  {" — "}
                  <Mono className="text-rose-600 dark:text-rose-400 font-black">
                    {fmtNum(effectiveWasteKg)} كجم
                  </Mono>
                  {numGrainQty > 0 && ` (${wastePercent.toFixed(1)}%)`}
                </p>
              </div>
            </div>

            {/* بطاقات توازن الطحن */}
            <div className="grid gap-3 sm:grid-cols-4 pt-2">
              <div className="rounded-xl border border-border/80 bg-surface/70 p-3 space-y-1">
                <span className="text-xs text-muted-foreground flex items-center gap-1.5">
                  <Layers className="h-3.5 w-3.5 text-amber-500" /> إجمالي القمح المدخل
                </span>
                <p className="text-lg font-black text-foreground">
                  <Mono>{fmtNum(numGrainQty)}</Mono>{" "}
                  <span className="text-xs font-normal">كجم</span>
                </p>
              </div>

              <div className="rounded-xl border border-border/80 bg-surface/70 p-3 space-y-1">
                <span className="text-xs text-muted-foreground flex items-center gap-1.5">
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" /> إجمالي النواتج
                </span>
                <p className="text-lg font-black text-foreground">
                  <Mono>{fmtNum(totalOutputKg)}</Mono>{" "}
                  <span className="text-xs font-normal">كجم</span>
                </p>
              </div>

              <div className="rounded-xl border border-border/80 bg-surface/70 p-3 space-y-1">
                <span className="text-xs text-muted-foreground flex items-center gap-1.5">
                  <TrendingDown className="h-3.5 w-3.5 text-rose-500" /> الفاقد التشغيلي
                </span>
                <p className="text-lg font-black text-rose-600 dark:text-rose-400">
                  <Mono>{fmtNum(effectiveWasteKg)}</Mono>{" "}
                  <span className="text-xs font-semibold text-muted-foreground">
                    ({wastePercent.toFixed(1)}%)
                  </span>
                </p>
              </div>

              <div className="rounded-xl border border-border/80 bg-surface/70 p-3 space-y-1">
                <span className="text-xs text-muted-foreground flex items-center gap-1.5">
                  <PieChart className="h-3.5 w-3.5 text-sky-500" /> نسبة الاستخلاص (Yield)
                </span>
                <p className="text-lg font-black text-foreground">
                  <Mono>{yieldPercent.toFixed(1)}%</Mono>
                </p>
              </div>
            </div>

            {/* تنبيهات أمان الأوزان */}
            {isOutputsOverGrain && (
              <div className="flex items-center gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs font-bold text-rose-700 dark:text-rose-300">
                <AlertTriangle className="h-4 w-4 shrink-0 text-rose-500" />
                <span>
                  خطأ في الأوزان: إجمالي وزن النواتج المستخرجة (<Mono>{fmtNum(totalOutputKg)}</Mono>{" "}
                  كجم) أكبر من كمية القمح المطحون (<Mono>{fmtNum(numGrainQty)}</Mono> كجم)! لا يمكن
                  أن تزيد النواتج عن المدخلات.
                </span>
              </div>
            )}

            {isOutputsPlusWasteOverGrain && (
              <div className="flex items-center gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs font-bold text-rose-700 dark:text-rose-300">
                <AlertTriangle className="h-4 w-4 shrink-0 text-rose-500" />
                <span>
                  تنبيه: مجموع النواتج (<Mono>{fmtNum(totalOutputKg)}</Mono> كجم) مع الفاقد اليدوي (
                  <Mono>{fmtNum(parsedManualWaste)}</Mono> كجم) يتجاوز وزن القمح المدخل (
                  <Mono>{fmtNum(numGrainQty)}</Mono> كجم)! يرجى ضبط الفاقد أو كميات النواتج.
                </span>
              </div>
            )}
          </div>
        </MillingPanel>

        {/* ─── اللوحة الرابعة: العرض المالي الذكي والتسعير للمالك ─── */}
        {totalOutputValue > 0 && totalInputCost > 0 && (
          <div className="rounded-2xl border border-border/80 bg-surface/70 p-4 sm:p-5 space-y-3">
            <div className="flex items-center justify-between border-b border-border/60 pb-3">
              <div className="flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-emerald-500" />
                <h3 className="text-sm font-bold text-foreground">
                  ملخص التكلفة والتسعير وهوامش الربح المتوقعة
                </h3>
              </div>
              <span className="text-xs text-muted-foreground">
                إجمالي تكلفة المادة الخام:{" "}
                <strong className="text-foreground">
                  <Mono>{fmtNum(totalInputCost)}</Mono>
                </strong>
              </span>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 pt-1">
              {outputs.map((line, i) => {
                const prod = outputItems.data?.find((p) => p.id === line.itemId);
                if (!prod || !Number(line.qty)) return null;

                const lineQty = Number(line.qty);
                const lineVal = lineQty * (prod.sale_price ?? 0);
                const unitCostKg =
                  allocatableCost > 0
                    ? (allocatableCost * (lineVal / totalOutputValue)) / lineQty
                    : 0;

                let bagWeight = 0;
                if (line.packageType === "50") bagWeight = 50;
                else if (line.packageType === "25") bagWeight = 25;
                else if (line.packageType === "10") bagWeight = 10;
                else if (line.packageType === "5") bagWeight = 5;
                else if (line.packageType === "custom")
                  bagWeight = Number(line.customPackageKg) || 0;

                const costPerBag = unitCostKg * bagWeight;
                const salePerBag = (prod.sale_price ?? 0) * bagWeight;
                const profitPerBag = salePerBag - costPerBag;

                return (
                  <div
                    key={i}
                    className="rounded-xl border border-border/60 bg-surface/60 p-3 space-y-2 text-xs"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-foreground">{prod.name_ar || prod.name}</span>
                      <span className="text-[10px] text-muted-foreground">
                        {line.packageType !== "bulk" ? `سعة ${bagWeight} كجم` : "سائب"}
                      </span>
                    </div>

                    <div className="space-y-1 text-[11px]">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">تكلفة الكيلو:</span>
                        <strong>
                          <Mono>{fmtNum(unitCostKg)}</Mono>
                        </strong>
                      </div>
                      {bagWeight > 0 && (
                        <>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">تكلفة الكيس التقديرية:</span>
                            <strong className="text-amber-600 dark:text-amber-400">
                              <Mono>{fmtNum(costPerBag)}</Mono>
                            </strong>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">سعر بيع الكيس:</span>
                            <strong>
                              <Mono>{fmtNum(salePerBag)}</Mono>
                            </strong>
                          </div>
                          <div className="flex justify-between border-t border-border/40 pt-1">
                            <span className="text-muted-foreground">هامش ربح الكيس:</span>
                            <strong
                              className={profitPerBag >= 0 ? "text-emerald-600" : "text-rose-600"}
                            >
                              <Mono>{fmtNum(profitPerBag)}</Mono>
                            </strong>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ─── اللوحة الخامسة: رقم التشغيلة والملاحظات ─── */}
        <MillingPanel>
          <div className="p-4 sm:p-5 space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <MillingField label="رقم الدفعة / التشغيلة" hint="اختياري للربط والتتبع">
                <MillingInput
                  placeholder="مثال: BATCH-2026-10-A"
                  value={batchRef}
                  onChange={(e) => setBatchRef(e.target.value)}
                />
              </MillingField>

              <MillingField label="ملاحظات تشغيلية" hint="اختيارية">
                <MillingTextarea
                  placeholder="مثال: تشغيل صباحي — فحص نقاوة 98%..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                />
              </MillingField>
            </div>

            {/* زر الاعتماد والتنفيذ */}
            <div className="pt-2 border-t border-border/70 flex flex-col sm:flex-row items-center justify-between gap-3">
              <div className="text-xs text-muted-foreground">
                {totalOutputValue > 0 && (
                  <span>
                    إجمالي القيمة السوقية للنواتج:{" "}
                    <strong className="text-foreground">
                      <Mono>{fmtNum(totalOutputValue)}</Mono>
                    </strong>
                  </span>
                )}
              </div>

              <button
                type="button"
                disabled={!canSubmit || submit.isPending}
                onClick={() => submit.mutate()}
                className="w-full sm:w-auto min-w-[200px] flex items-center justify-center gap-2 rounded-xl bg-amber-500 px-6 py-3 text-sm font-bold text-white shadow-md shadow-amber-500/20 transition hover:bg-amber-600 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Sparkles className="h-4 w-4" />
                {submit.isPending
                  ? "جارٍ تسجيل التصنيع والحركات…"
                  : "تنفيذ أمر التصنيع وترحيل القيود"}
              </button>
            </div>
          </div>
        </MillingPanel>
      </div>
    </ModuleGuard>
  );
}

/**
 * /milling/milling — شاشة الطحن والتشغيل الفاخرة.
 *
 * اختيار رصيد حبوب العميل → إمكانية طحن دفعة جزئية والإبقاء على دفعة (لا تُعد فاقداً)
 * → إدخال النواتج المستخرجة بدقة العبوات (50، 25، 10 كجم) → حقل مخصص للفاقد الفعلي
 * مع مطابقة الحبوب المطحونة والنواتج والفاقد لمنع الأخطاء في البيانات.
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, useMemo } from "react";
import {
  Cog,
  ArrowLeft,
  Plus,
  Trash2,
  Wheat,
  Scale,
  CheckCircle2,
  AlertCircle,
  Sparkles,
  RefreshCw,
  Check,
  Package,
  Layers,
  ArrowRight,
} from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
import { ModuleGuard } from "@/lib/modules";
import { supabase } from "@/integrations/supabase/client";
import {
  custodyMillingMulti,
  fetchCustodyBalances,
  fetchOutputItems,
  fetchGrainTypes,
  custodyVoucherToDoc,
  buildCustodyVoucher,
  type CustodyLine,
  type ProductOption,
  type GrainType,
} from "@/lib/milling";
import { LuxuryPrintPreviewModal } from "@/components/luxury-print-preview-modal";
import { UnifiedPrintModal } from "@/components/milling/unified-print-modal";
import { MillingDocumentsBoard } from "@/components/milling/milling-documents-board";
import { CustodyAdjustmentPanel } from "@/components/milling/custody-adjustment-panel";
import type { UnifiedDocumentData } from "@/lib/templates/types";
import {
  MillingPanel,
  MillingSectionTitle,
  MillingField,
  MillingInput,
  MillingSelect,
  MillingTextarea,
  MillingEmpty,
  Mono,
  fmtNum,
} from "@/components/milling/milling-ui";
import { QuantityInput } from "@/components/ui/quantity-input";

export const Route = createFileRoute("/_app/milling/milling")({
  head: () => ({ meta: [{ title: "عمليات الطحن ونواتج الأمانات — فورتكس ERP" }] }),
  component: MillingMillPage,
});

interface CustomerOption {
  id: string;
  name: string;
  phone?: string | null;
}

interface WarehouseOption {
  id: string;
  name_ar: string | null;
  name: string;
  is_default?: boolean;
}

function MillingMillPage() {
  const qc = useQueryClient();
  const [customerId, setCustomerId] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [grains, setGrains] = useState<CustodyLine[]>([{ itemId: "", bags: 0, kg: 0 }]);
  const [outputs, setOutputs] = useState<CustodyLine[]>([{ itemId: "", bags: 0, kg: 0 }]);

  // حقل الفاقد التشغيلي الفعلي أثناء الطحن — وزن فيزيائي يدوي فقط (V2: بلا سعات)
  const [lossKg, setLossKg] = useState("");
  const [lossBags, setLossBags] = useState("");
  const [notes, setNotes] = useState("");

  // E6/M5: نوع الحبة المرجعي (grain_types) — يعبّئ الفاقد والنواتج الافتراضية
  const [grainTypeId, setGrainTypeId] = useState("");

  // معاينة وطباعة سند الطحن الفاخر
  const [printDoc, setPrintDoc] = useState<UnifiedDocumentData | null>(null);
  const [isPrintModalOpen, setIsPrintModalOpen] = useState(false);

  const customers = useQuery({
    queryKey: ["milling", "customers"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("customers")
        .select("id, name, phone")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return (data ?? []) as CustomerOption[];
    },
  });

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

  // المستودع الافتراضي
  useEffect(() => {
    if (warehouseId) return;
    const list = warehouses.data ?? [];
    const preferred = list.find((w) => w.is_default) ?? list[0];
    if (preferred) setWarehouseId(preferred.id);
  }, [warehouses.data, warehouseId]);

  const outputItems = useQuery({
    queryKey: ["milling", "output-items"],
    queryFn: fetchOutputItems,
  });

  // E6/M5: الأنواع المرجعية للحبوب — قائمة مستقلة عن كتالوج الشراء
  const grainTypes = useQuery({
    queryKey: ["milling", "grain-types"],
    queryFn: fetchGrainTypes,
  });

  const balances = useQuery({
    queryKey: ["milling", "balances", customerId, warehouseId],
    queryFn: () => fetchCustodyBalances(customerId || undefined, warehouseId || undefined),
    enabled: Boolean(customerId && warehouseId),
  });

  // أرصدة الحبوب الخام فقط
  const grainBalances = (balances.data ?? []).filter(
    (b) => b.item_class === "RAW_MATERIAL" && (b.bags_balance > 0 || b.kg_balance > 0),
  );
  // أرصدة النواتج الجاهزة للتسليم (E9) — كل غير الحبوب الخام
  const readyOutputBalances = (balances.data ?? []).filter(
    (b) => b.item_class !== "RAW_MATERIAL" && (b.bags_balance > 0 || b.kg_balance > 0),
  );
  const selectedCustomer = (customers.data ?? []).find((c) => c.id === customerId);

  // ── أدوات أسطر الحبوب المطحونة (تعدد الأصناف في عملية واحدة) ──
  function changeGrainItem(idx: number, itemId: string) {
    setGrains((g) => g.map((l, i) => (i !== idx ? l : { ...l, itemId })));
  }
  function changeGrainBags(idx: number, bags: number) {
    setGrains((g) => g.map((l, i) => (i !== idx ? l : { ...l, bags })));
  }
  function changeGrainKg(idx: number, kg: number) {
    setGrains((g) => g.map((l, i) => (i !== idx ? l : { ...l, kg })));
  }
  function addGrainLine() {
    setGrains((g) => [...g, { itemId: "", bags: 0, kg: 0 }]);
  }
  function removeGrainLine(idx: number) {
    setGrains((g) => (g.length > 1 ? g.filter((_, i) => i !== idx) : g));
  }
  /** طحن كامل رصيد سطر محدد */
  function handleMillAllForLine(idx: number) {
    const line = grains[idx];
    if (!line.itemId) return;
    const b = grainBalances.find((x) => x.item_id === line.itemId);
    if (!b) return;
    setGrains((g) =>
      g.map((l, i) =>
        i !== idx ? l : { ...l, bags: Number(b.bags_balance), kg: Number(b.kg_balance) },
      ),
    );
  }

  // V2: لا خريطة سعات ولا حساب تلقائي — كل الأوزان إدخال يدوي فيزيائي.

  // E6/M5: النوع المرجعي المختار
  const selectedGrainType = useMemo(
    () => (grainTypes.data ?? []).find((t) => t.id === grainTypeId) ?? null,
    [grainTypes.data, grainTypeId],
  );

  /**
   * E6/M5: تغيير نوع الحبة المرجعي.
   * يعبّئ تلقائياً:
   *  - الفاقد الافتراضي = الوزن المطحون × نسبة الفاقد الافتراضية للنوع
   *  - سطور النواتج الافتراضية (لمنتجات موجودة في كتالوج النواتج)، كلٍّ بنسبته
   * كل القيم تبقى قابلة للتعديل يدوياً بعد التعبئة (طبيعة كل طرقة حجر).
   */
  function changeGrainType(id: string) {
    setGrainTypeId(id);
    const type = (grainTypes.data ?? []).find((t) => t.id === id);
    if (!type) return;

    const milledKg = grains.reduce((s, g) => s + (Number(g.kg) || 0), 0);

    // 1) الفاقد الافتراضي من نسبة النوع (بوحدة كجم من المطحون)
    if (type.default_loss_rate_pct > 0 && milledKg > 0) {
      setLossKg(String(Math.round(((milledKg * type.default_loss_rate_pct) / 100) * 100) / 100));
    }

    // 2) النواتج الافتراضية: أطابق نسب النوع مع أصناف النواتج الفعلية بالاسم
    const map = type.default_output_map ?? [];
    if (map.length > 0) {
      const outputsPool = outputItems.data ?? [];
      const prefilled = map
        .map((g) => {
          const match =
            (g.product_id && outputsPool.find((p) => p.id === g.product_id)) ||
            outputsPool.find(
              (p) =>
                (p.name_ar && g.label && p.name_ar.includes(g.label)) ||
                (p.name && g.label && p.name.toLowerCase().includes(g.label.toLowerCase())),
            );
          if (!match) return null;
          const kg = milledKg > 0 ? Math.round(((milledKg * g.ratio) / 100) * 100) / 100 : 0;
          return { itemId: match.id, bags: 0, kg };
        })
        .filter((l): l is CustodyLine => l !== null);
      if (prefilled.length > 0) setOutputs(prefilled);
    }
  }

  // تغيير سطر الناتج — بلا أي اشتقاق من السعة
  function changeLineItem(idx: number, itemId: string) {
    setOutputs((o) => o.map((l, i) => (i !== idx ? l : { ...l, itemId })));
  }

  function changeLineBags(idx: number, bags: number) {
    setOutputs((o) => o.map((l, i) => (i !== idx ? l : { ...l, bags })));
  }

  function changeLineKg(idx: number, kg: number) {
    setOutputs((o) => o.map((l, i) => (i !== idx ? l : { ...l, kg })));
  }

  // الفاقد: أكياس ووزن مستقلان — بلا ضرب بسعة
  function handleLossBagsChange(v: string) {
    setLossBags(v);
  }

  // الحسابات الرياضية للمطابقة والتحقق — الإجماليات عبر كل أسطر الحبوب
  const currentMilledKg = grains.reduce((s, g) => s + (Number(g.kg) || 0), 0);
  const currentMilledBags = grains.reduce((s, g) => s + (Number(g.bags) || 0), 0);

  const totalProducedKg = useMemo(() => {
    return outputs.reduce((sum, o) => sum + (Number(o.kg) || 0), 0);
  }, [outputs]);

  const totalProducedBags = useMemo(() => {
    return outputs.reduce((sum, o) => sum + (Number(o.bags) || 0), 0);
  }, [outputs]);

  const actualLossKg = Number(lossKg) || 0;
  const totalOutputsWithLossKg = totalProducedKg + actualLossKg;
  const discrepancyKg = Math.round((currentMilledKg - totalOutputsWithLossKg) * 1000) / 1000;
  /**
   * E8: المطابقة «تامة» فقط عند صفر فرق حقيقي. الفروق داخل ربع كيلو
   * تعبئة تُعرض كـ«مطابقة بتقريب» — رسالة صادقة بلا تضليل، ولا تُدخل
   * كفاقد مقيّد تلقائياً.
   */
  const FILL_TOLERANCE_KG = 0.25;
  const isExactMatch = discrepancyKg === 0;
  const isRoundedMatch = !isExactMatch && Math.abs(discrepancyKg) <= FILL_TOLERANCE_KG;

  // تجاوز الرصيد: يُفحص لكل سطر حبوب على حدة
  const overGrainLine = grains.find((g) => {
    if (!g.itemId) return false;
    const b = grainBalances.find((x) => x.item_id === g.itemId);
    if (!b) return false;
    return (Number(g.bags) || 0) > b.bags_balance || (Number(g.kg) || 0) > b.kg_balance;
  });
  const canSubmit = Boolean(
    customerId &&
    warehouseId &&
    !overGrainLine &&
    grains.some((g) => g.itemId && (g.bags > 0 || g.kg > 0)) &&
    outputs.some((o) => o.itemId && (o.bags > 0 || o.kg > 0)),
  );
  const submit = useMutation({
    mutationFn: () => {
      const lossNote = actualLossKg > 0 ? `[فاقد تشغيلي مقيّد: ${actualLossKg} كجم]` : "";
      const combinedNotes = [notes.trim(), lossNote].filter(Boolean).join(" — ");
      return custodyMillingMulti({
        customerId,
        warehouseId,
        grains: grains.filter((g) => g.itemId && (g.bags > 0 || g.kg > 0)),
        outputs,
        notes: combinedNotes || undefined,
      });
    },
    onSuccess: async (res) => {
      if (!res.ok) {
        toast.error(res.message || "تعذر تسجيل الطحن.");
        return;
      }

      const docNumber = res.data ?? "";
      toast.success(`تم تسجيل الطحن بنجاح — سند #${docNumber}`);

      // تجهيز سند الطحن للطباعة الفاخرة
      if (docNumber) {
        try {
          const voucher = await buildCustodyVoucher(docNumber as string);
          if (voucher) {
            const uDoc = custodyVoucherToDoc(voucher);
            setPrintDoc(uDoc);
            setIsPrintModalOpen(true);
          }
        } catch (e) {
          console.error("Failed to build voucher:", e);
        }
      }

      setGrains([{ itemId: "", bags: 0, kg: 0 }]);
      setOutputs([{ itemId: "", bags: 0, kg: 0 }]);
      setLossKg("");
      setLossBags("");
      setNotes("");

      void qc.invalidateQueries({ queryKey: ["milling"] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "خطأ غير متوقع"),
  });

  return (
    <ModuleGuard moduleId="milling_operations">
      <div className="mx-auto max-w-7xl space-y-4 p-4">
        {/* شريط رأس الصفحة */}
        <PageHeader
          title="تسجيل عمليات الطحن ونواتج الأمانات"
          subtitle="صادر حبوب العميل المستهلكة + وارد النواتج المعبأة مع ضبط الفاقد ومطابقة الأوزان."
          actions={
            <div className="flex items-center gap-2">
              <Link
                to="/milling/delivery"
                className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-3.5 py-2 text-xs font-bold text-primary-foreground shadow-xs transition hover:bg-primary/90"
              >
                شاشة التسليم <ArrowLeft className="h-3.5 w-3.5" />
              </Link>
              <Link
                to="/milling/customer-statement"
                className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-card px-3.5 py-2 text-xs font-bold text-foreground shadow-xs transition hover:bg-muted"
              >
                كشف الحساب
              </Link>
            </div>
          }
        />

        {/* جسم الشاشة: عمود التسجيل (7 أعمدة) + عمود أرصدة الحبوب والملخص (5 أعمدة) */}
        <div className="grid gap-4 lg:grid-cols-12">
          {/* العمود الأيمن (7 أعمدة): عملية الطحن */}
          <MillingPanel className="lg:col-span-7 space-y-4">
            <MillingSectionTitle
              icon={<Cog className="h-4 w-4" />}
              title="تسجيل عملية الطحن"
              subtitle="طحن كامل أو جزئي (دفعة) مع تثبيت المتبقي باسم العميل"
            />

            <div className="space-y-4 p-4">
              {/* العميل والمستودع */}
              <div className="grid gap-3 sm:grid-cols-2">
                <MillingField label="صاحب الأمانة (العميل) *">
                  <MillingSelect
                    value={customerId}
                    onChange={(e) => {
                      setCustomerId(e.target.value);
                      setGrains([{ itemId: "", bags: 0, kg: 0 }]);
                    }}
                    className="font-bold text-xs"
                  >
                    <option value="">اختر العميل…</option>
                    {(customers.data ?? []).map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} {c.phone ? `(${c.phone})` : ""}
                      </option>
                    ))}
                  </MillingSelect>
                </MillingField>

                <MillingField label="المستودع / الصالة *">
                  <MillingSelect
                    value={warehouseId}
                    onChange={(e) => setWarehouseId(e.target.value)}
                    className="font-bold text-xs"
                  >
                    <option value="">اختر المستودع…</option>
                    {(warehouses.data ?? []).map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name_ar || w.name}
                      </option>
                    ))}
                  </MillingSelect>
                </MillingField>
              </div>

              {/* أسطر الحبوب المطحونة — صنف مستقل لكل سطر من رصيد أمانات العميل */}
              <div className="rounded-2xl border border-border/80 bg-surface-2/30 p-3.5 space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold text-foreground flex items-center gap-1.5">
                    <Wheat className="h-4 w-4 text-amber-500" />
                    <span>الحبوب الخام المستهلكة في الطحن</span>
                  </h4>
                  <button
                    type="button"
                    onClick={addGrainLine}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs font-bold text-amber-700 dark:text-amber-300 hover:bg-amber-500/20 transition-colors"
                  >
                    <Plus className="h-3.5 w-3.5" /> إضافة صنف حبوب آخر
                  </button>
                </div>
                {grains.map((line, idx) => {
                  const b = line.itemId
                    ? grainBalances.find((x) => x.item_id === line.itemId)
                    : undefined;
                  const isOver =
                    b && ((line.bags || 0) > b.bags_balance || (line.kg || 0) > b.kg_balance);
                  const remBags = b ? Math.max(0, b.bags_balance - (line.bags || 0)) : 0;
                  const remKg = b ? Math.max(0, b.kg_balance - (line.kg || 0)) : 0;
                  return (
                    <div
                      key={idx}
                      className={`space-y-2 rounded-xl border p-3 ${
                        isOver ? "border-rose-500/50 bg-rose-500/5" : "border-border/70 bg-card/70"
                      }`}
                    >
                      <div className="grid grid-cols-[1fr_auto] items-center gap-2">
                        <MillingSelect
                          value={line.itemId}
                          onChange={(e) => changeGrainItem(idx, e.target.value)}
                          className="font-bold text-xs"
                        >
                          <option value="">اختر صنف الحبوب من رصيد العميل…</option>
                          {grainBalances.map((g) => (
                            <option key={g.item_id} value={g.item_id}>
                              {g.name_ar} — رصيد متبقٍ: {fmtNum(g.bags_balance)} كيس (
                              {fmtNum(g.kg_balance)} كجم)
                            </option>
                          ))}
                        </MillingSelect>
                        <div className="flex items-center gap-1">
                          {b && (
                            <button
                              type="button"
                              onClick={() => handleMillAllForLine(idx)}
                              className="rounded-lg bg-amber-500/10 px-2 py-1 text-[11px] font-bold text-amber-700 dark:text-amber-300 hover:bg-amber-500/20"
                            >
                              طحن الكل
                            </button>
                          )}
                          <button
                            type="button"
                            disabled={grains.length === 1}
                            onClick={() => removeGrainLine(idx)}
                            className="grid h-8 w-8 place-items-center rounded-lg text-rose-500 hover:bg-rose-500/10 disabled:opacity-30"
                            aria-label="حذف السطر"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 items-center">
                        <div>
                          <span className="block text-[11px] font-semibold text-muted-foreground mb-1">
                            الأكياس المطحونة:
                          </span>
                          <QuantityInput
                            decimals={0}
                            min={0}
                            emptyAsZero
                            placeholder="0"
                            aria-label="الأكياس المطحونة"
                            value={line.bags || null}
                            onValueChange={(v) => changeGrainBags(idx, v ?? 0)}
                            className="font-bold text-amber-600 dark:text-amber-400"
                          />
                        </div>
                        <div>
                          <span className="block text-[11px] font-semibold text-muted-foreground mb-1">
                            الوزن المطحون (كجم):
                          </span>
                          <QuantityInput
                            decimals={2}
                            min={0}
                            emptyAsZero
                            placeholder="0.00"
                            aria-label="الوزن المطحون (كجم)"
                            value={line.kg || null}
                            onValueChange={(v) => changeGrainKg(idx, v ?? 0)}
                            className="font-bold"
                          />
                        </div>
                        <div className="rounded-lg bg-muted/40 p-2 text-center text-xs">
                          <span className="block text-[10px] text-muted-foreground">
                            الرصيد المتاح:
                          </span>
                          <span className="font-bold text-foreground">
                            {b ? `${fmtNum(b.bags_balance)} كيس` : "—"}
                          </span>
                          <span className="block text-[10px] text-muted-foreground">
                            {b ? `(${fmtNum(b.kg_balance)} كجم)` : ""}
                          </span>
                        </div>
                        <div className="rounded-lg bg-blue-500/10 p-2 text-center text-xs">
                          <span className="block text-[10px] text-blue-700 dark:text-blue-300 font-semibold">
                            المتبقي بعد الطحن:
                          </span>
                          <span className="font-black text-blue-700 dark:text-blue-300">
                            {b ? `${fmtNum(remBags)} كيس` : "—"}
                          </span>
                          <span className="block text-[10px] text-blue-700/80 dark:text-blue-300/80">
                            {b ? `(${fmtNum(remKg)} كجم)` : ""}
                          </span>
                        </div>
                      </div>

                      {isOver && (
                        <div className="flex items-center gap-1.5 rounded-lg bg-rose-500/10 px-2.5 py-1 text-xs font-bold text-rose-600 dark:text-rose-300">
                          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                          <span>
                            الكمية المطلوبة أكبر من رصيد الحبوب المتاح! الحد الأقصى:{" "}
                            {fmtNum(b.bags_balance)} كيس / {fmtNum(b.kg_balance)} كجم.
                          </span>
                        </div>
                      )}
                    </div>
                  );
                })}

                {/* شريط إجماليات الحبوب والنواتج */}
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-muted/60 p-3 text-xs">
                  <div className="flex items-center gap-3">
                    <span>
                      حبوب مطحونة:{" "}
                      <strong className="text-foreground">{fmtNum(currentMilledBags)}</strong> كيس (
                      {fmtNum(currentMilledKg)} كجم)
                    </span>
                    <span>•</span>
                    <span>
                      إجمالي النواتج:{" "}
                      <strong className="text-foreground">{fmtNum(totalProducedBags)}</strong> كيس (
                      {fmtNum(totalProducedKg)} كجم)
                    </span>
                    <span>•</span>
                    <span className="text-muted-foreground">
                      الفاقد المقيّد: {fmtNum(actualLossKg)} كجم
                    </span>
                  </div>
                  <span
                    className={`rounded-lg px-2 py-0.5 font-black tabular-nums ${
                      discrepancyKg === 0
                        ? "bg-emerald-500/10 text-emerald-600"
                        : Math.abs(discrepancyKg) <= FILL_TOLERANCE_KG
                          ? "bg-amber-500/10 text-amber-600"
                          : "bg-rose-500/10 text-rose-600"
                    }`}
                  >
                    فرق المطابقة: {discrepancyKg} كجم
                  </span>
                </div>
              </div>

              {/* النواتج المستخرجة */}
              <div className="space-y-3 rounded-2xl border border-border/80 bg-surface-2/30 p-3.5">
                <div>
                  <h4 className="text-xs font-bold text-foreground">النواتج المستخرجة المعبأة</h4>
                  <p className="text-[11px] text-muted-foreground">
                    حدد الصنف، عدد الأكياس والوزن المستخرج (دقيق 50، 25، 10 كجم، نخالة، سميد…).
                  </p>
                  {outputItems.data && outputItems.data.length === 0 && (
                    <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-2.5 py-1.5 text-[11px]">
                      <span className="font-semibold text-amber-700 dark:text-amber-300">
                        لا توجد منتجات نواتج أمانات بعد!
                      </span>
                      <Link
                        to="/milling/products"
                        search={undefined as never}
                        className="inline-flex items-center gap-1 rounded-lg bg-amber-500 px-2 py-1 font-bold text-white hover:bg-amber-600"
                      >
                        أضف ناتجاً من «أصناف الأمانات» ←
                      </Link>
                    </div>
                  )}
                </div>

                {/* ترويسة أعمدة النواتج للشاشات المتوسطة والكبيرة */}
                <div className="hidden sm:grid sm:grid-cols-[1fr_90px_110px_36px] gap-2 px-3 py-1.5 text-[11px] font-bold text-muted-foreground bg-muted/50 rounded-xl">
                  <div>صنف الناتج المستخرج (دقيق / نخالة / سميد)</div>
                  <div className="text-center">الأكياس</div>
                  <div className="text-center">الوزن (كجم)</div>
                  <div className="text-center">حذف</div>
                </div>

                {outputs.map((line, idx) => (
                  <div
                    key={idx}
                    className="grid grid-cols-[1fr_80px_100px_36px] sm:grid-cols-[1fr_90px_110px_36px] items-center gap-2 rounded-xl border border-border/70 bg-card p-2.5"
                  >
                    <MillingSelect
                      value={line.itemId}
                      onChange={(e) => changeLineItem(idx, e.target.value)}
                      className="font-bold text-xs"
                    >
                      <option value="">اختر الناتج (دقيق / نخالة / سميد)…</option>
                      {(outputItems.data ?? []).map((g: ProductOption) => (
                        <option key={g.id} value={g.id}>
                          {g.name_ar || g.name}{" "}
                          {g.package_weight_kg ? `(${g.package_weight_kg} كجم)` : ""}
                        </option>
                      ))}
                    </MillingSelect>

                    <QuantityInput
                      decimals={0}
                      min={0}
                      emptyAsZero
                      placeholder="0"
                      aria-label="أكياس الناتج"
                      value={line.bags || null}
                      onValueChange={(v) => changeLineBags(idx, v ?? 0)}
                      className="font-bold text-emerald-600 dark:text-emerald-400"
                    />

                    <QuantityInput
                      decimals={2}
                      min={0}
                      emptyAsZero
                      placeholder="0.00"
                      aria-label="وزن الناتج كجم"
                      value={line.kg || null}
                      onValueChange={(v) => changeLineKg(idx, v ?? 0)}
                      className="font-bold"
                    />

                    <button
                      type="button"
                      disabled={outputs.length === 1}
                      onClick={() => setOutputs((o) => o.filter((_, i) => i !== idx))}
                      className="grid h-8 w-8 place-items-center rounded-lg text-rose-500 hover:bg-rose-500/10 disabled:opacity-30"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}

                {/* زر إضافة سطر ناتج جديد موحد في الأسفل */}
                <button
                  type="button"
                  onClick={() => setOutputs((o) => [...o, { itemId: "", bags: 0, kg: 0 }])}
                  className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border border-dashed border-emerald-500/40 bg-emerald-500/[0.04] hover:bg-emerald-500/[0.09] text-xs font-bold text-emerald-700 dark:text-emerald-300 transition-all active:scale-[0.99]"
                >
                  <Plus className="h-4 w-4" />
                  <span>إضافة سطر ناتج جديد</span>
                </button>
              </div>

              {/* قسم الفاقد التشغيلي الفعلي أثناء الطحن */}
              <div className="rounded-2xl border border-amber-500/25 bg-amber-500/5 p-3.5 space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold text-foreground flex items-center gap-1.5">
                    <Scale className="h-4 w-4 text-amber-600" />
                    <span>الفاقد التشغيلي الفعلي للطحن (اختياري)</span>
                  </h4>
                  <span className="text-[11px] text-muted-foreground">
                    الفاقد الحقيقي المتطاير أثناء الطحن
                  </span>
                </div>

                <div className="grid gap-2.5 sm:grid-cols-2">
                  <MillingField label="أكياس الفاقد" hint="اختياري — بلا احتساب تلقائي">
                    <QuantityInput
                      decimals={0}
                      min={0}
                      placeholder="0"
                      aria-label="أكياس الفاقد"
                      value={lossBags === "" ? null : Number(lossBags)}
                      onValueChange={(v) => handleLossBagsChange(v == null ? "" : String(v))}
                    />
                  </MillingField>

                  <MillingField label="وزن الفاقد (كجم)">
                    <QuantityInput
                      decimals={2}
                      min={0}
                      placeholder="0.00"
                      aria-label="وزن الفاقد (كجم)"
                      value={lossKg === "" ? null : Number(lossKg)}
                      onValueChange={(v) => setLossKg(v == null ? "" : String(v))}
                      className="font-bold text-amber-700 dark:text-amber-300"
                    />
                  </MillingField>
                </div>

                {/* لوحة المطابقة والتوازن */}
                <div className="rounded-xl border border-border/80 bg-background/80 p-3 text-xs space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">وزن الحبوب المطحونة:</span>
                    <span className="font-bold text-foreground">{fmtNum(currentMilledKg)} كجم</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">
                      مجموع النواتج ({fmtNum(totalProducedKg)} كجم) + الفاقد ({fmtNum(actualLossKg)}{" "}
                      كجم):
                    </span>
                    <span className="font-bold text-foreground">
                      {fmtNum(totalOutputsWithLossKg)} كجم
                    </span>
                  </div>

                  {currentMilledKg > 0 && (
                    <div className="pt-1 border-t border-border/60">
                      {discrepancyKg === 0 ? (
                        <div className="flex items-center gap-1.5 font-bold text-emerald-600 dark:text-emerald-400">
                          <CheckCircle2 className="h-4 w-4" />
                          <span>✓ مطابقة تامة: النواتج والفاقد تعادل الحبوب المطحونة تماماً.</span>
                        </div>
                      ) : isRoundedMatch ? (
                        <div className="flex items-center gap-1.5 font-semibold text-sky-600 dark:text-sky-400">
                          <CheckCircle2 className="h-4 w-4" />
                          <span>
                            ✓ مطابقة بتقريب التعبئة: فرق {fmtNum(Math.abs(discrepancyKg))} كجم
                            {discrepancyKg > 0 ? " (فاقد صغير غير مسجّل)" : " (زيادة نواتج صغيرة)"}.
                          </span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5 font-semibold text-amber-600 dark:text-amber-400">
                          <AlertCircle className="h-4 w-4" />
                          <span>
                            الفارق غير المحتسب: {fmtNum(Math.abs(discrepancyKg))} كجم{" "}
                            {discrepancyKg > 0 ? "(نقص/فاقد إضافي)" : "(زيادة نواتج)"}.
                          </span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              <MillingField label="ملاحظات الطحن والتشغيل" hint="اختيارية">
                <MillingTextarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="مثال: طحن ناعم درجة أولى — آلة الطحن رقم 2"
                />
              </MillingField>

              <button
                type="button"
                disabled={!canSubmit || submit.isPending}
                onClick={() => submit.mutate()}
                className="w-full inline-flex items-center justify-center gap-2 rounded-2xl bg-amber-500 py-3.5 px-4 text-sm font-black text-white shadow-md transition hover:bg-amber-600 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {submit.isPending ? (
                  <>
                    <RefreshCw className="h-4 w-4 animate-spin" />
                    جارٍ تسجيل الطحن وإصدار السند…
                  </>
                ) : (
                  <>
                    <Check className="h-5 w-5" />
                    تسجيل نواتج الطحن وإصدار السند
                  </>
                )}
              </button>
            </div>
          </MillingPanel>

          {/* العمود الأيسر (5 أعمدة): أرصدة الحبوب الخام المتاحة */}
          <MillingPanel className="lg:col-span-5 flex flex-col justify-between">
            <div>
              <MillingSectionTitle
                icon={<Wheat className="h-4 w-4" />}
                title="أرصدة الحبوب الخام المودعة"
                subtitle="الحبوب المتوفرة باسم العميل والجاهزة للطحن"
              />

              <div className="space-y-3 p-4">
                {!customerId || !warehouseId ? (
                  <MillingEmpty
                    title="اختر العميل والمستودع"
                    hint="حدد العميل لعرض أرصدة حبوبه الخام الجاهزة للطحن."
                  />
                ) : grainBalances.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-border p-6 text-center space-y-2">
                    <Wheat className="h-8 w-8 mx-auto text-muted-foreground" />
                    <h5 className="font-bold text-sm text-foreground">لا توجد حبوب خام مودعة</h5>
                    <p className="text-xs text-muted-foreground">
                      سجل استلام حبوب للعميل من كاونتر الاستلام لتظهر هنا.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    {grainBalances.map((b) => (
                      <div
                        key={b.item_id}
                        className={`rounded-xl border p-3 transition-colors ${
                          grains.some((g) => g.itemId === b.item_id)
                            ? "border-amber-500 bg-amber-500/10 shadow-xs"
                            : "border-border/70 bg-card hover:border-border"
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div>
                            <span className="font-bold text-xs text-foreground block">
                              {b.name_ar}
                            </span>
                            <span className="text-[11px] text-muted-foreground">حبوب خام</span>
                          </div>
                          <div className="text-end">
                            <span className="font-black text-sm text-amber-600 dark:text-amber-400 block">
                              {fmtNum(b.bags_balance)} كيس
                            </span>
                            <span className="text-[11px] font-mono text-muted-foreground">
                              {fmtNum(b.kg_balance)} كجم
                            </span>
                          </div>
                        </div>
                      </div>
                    ))}

                    {/* E9: النواتج الجاهزة للتسليم — منفصلة تماماً عن الحبوب الخام */}
                    {readyOutputBalances.length > 0 && (
                      <div className="pt-2">
                        <div className="mb-2 flex items-center gap-1.5 text-xs font-bold text-emerald-600 dark:text-emerald-400">
                          <Package className="h-3.5 w-3.5" />
                          نواتج جاهزة للتسليم (باسم العميل)
                        </div>
                        <div className="space-y-2">
                          {readyOutputBalances.map((b) => (
                            <div
                              key={b.item_id}
                              className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3"
                            >
                              <div className="flex items-center justify-between">
                                <div>
                                  <span className="font-bold text-xs text-foreground block">
                                    {b.name_ar}
                                  </span>
                                  <span className="text-[11px] text-muted-foreground">
                                    ناتج جاهز
                                  </span>
                                </div>
                                <div className="text-end">
                                  <span className="font-black text-sm text-emerald-600 dark:text-emerald-400 block">
                                    {fmtNum(b.bags_balance)} كيس
                                  </span>
                                  <span className="text-[11px] font-mono text-muted-foreground">
                                    {fmtNum(b.kg_balance)} كجم
                                  </span>
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

            <div className="p-4 border-t border-border/70 bg-muted/20 rounded-b-2xl">
              <div className="flex items-start gap-2.5 text-xs text-muted-foreground">
                <Layers className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
                <div>
                  <strong className="text-foreground block">مرونة تشغيل الدفعات:</strong>
                  يمكن طحن جزء من الحبوب المستلمة وترك الباقي لموعد لاحق دون أي فاقد، ويتم توثيق
                  النواتج المستخرجة فوراً وتصبح جاهزة للتسليم.
                </div>
              </div>
            </div>
          </MillingPanel>
        </div>

        {/* سجل عمليات الطحن: المستندات الموحدة (استلام+فاتورة+طحن) بزاوية المطحون */}
        <MillingDocumentsBoard focus="milling" title="سجل عمليات الطحن" />

        {/* E5: تسويات الأمانات — الإدخال الموثّق الوحيد للحبوب/النواتج المنفصلة */}
        <CustodyAdjustmentPanel
          customerId={customerId}
          warehouseId={warehouseId}
          items={[
            ...(grainBalances.map((b) => ({
              id: b.item_id,
              name: b.name_ar,
              name_ar: b.name_ar,
              item_class: b.item_class,
            })) as any),
            ...((outputItems.data ?? []) as any),
          ]}
        />

        {/* نافذة معاينة وطباعة سند الطحن الفاخر */}
        {printDoc && (
          <UnifiedPrintModal
            open={isPrintModalOpen}
            onClose={() => {
              setIsPrintModalOpen(false);
              setPrintDoc(null);
            }}
            doc={printDoc}
            stage="milled"
          />
        )}
      </div>
    </ModuleGuard>
  );
}

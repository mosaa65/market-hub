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
  custodyMilling,
  fetchCustodyBalances,
  fetchOutputItems,
  capacityKgOf,
  custodyVoucherToDoc,
  buildCustodyVoucher,
  type CustodyLine,
  type ProductOption,
} from "@/lib/milling";
import { LuxuryPrintPreviewModal } from "@/components/luxury-print-preview-modal";
import { UnifiedPrintModal } from "@/components/milling/unified-print-modal";
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
  const [grainItemId, setGrainItemId] = useState("");
  const [bagsOut, setBagsOut] = useState("");
  const [kgOut, setKgOut] = useState("");
  const [kgOutAuto, setKgOutAuto] = useState(false);
  const [outputs, setOutputs] = useState<CustodyLine[]>([{ itemId: "", bags: 0, kg: 0 }]);
  const [autoKgLines, setAutoKgLines] = useState<Set<number>>(new Set());

  // حقل الفاقد التشغيلي الفعلي أثناء الطحن
  const [lossKg, setLossKg] = useState("");
  const [lossBags, setLossBags] = useState("");
  const [lossPackageKg, setLossPackageKg] = useState("50");
  const [notes, setNotes] = useState("");

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

  const balances = useQuery({
    queryKey: ["milling", "balances", customerId, warehouseId],
    queryFn: () => fetchCustodyBalances(customerId || undefined, warehouseId || undefined),
    enabled: Boolean(customerId && warehouseId),
  });

  // أرصدة الحبوب الخام فقط
  const grainBalances = (balances.data ?? []).filter(
    (b) => b.item_class === "RAW_MATERIAL" && (b.bags_balance > 0 || b.kg_balance > 0),
  );
  const selectedGrain = grainBalances.find((b) => b.item_id === grainItemId);
  const selectedCustomer = (customers.data ?? []).find((c) => c.id === customerId);

  // خريطة سعة العبوات
  const capacityMap = useQuery({
    queryKey: ["milling", "capacity-map"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("id, package_weight_kg")
        .eq("is_active", true)
        .limit(2000);
      if (error) throw error;
      const m = new Map<string, number | null>();
      for (const r of (data ?? []) as { id: string; package_weight_kg: number | null }[]) {
        m.set(r.id, capacityKgOf(r));
      }
      return m;
    },
  });
  const cap = (itemId: string) => capacityMap.data?.get(itemId) ?? null;
  const grainCapacity = grainItemId ? cap(grainItemId) : null;

  // تغيير أكياس الحبوب المستهلكة
  function changeBagsOut(v: string) {
    setBagsOut(v);
    const n = Number(v) || 0;
    if (grainCapacity && (kgOutAuto || kgOut === "")) {
      setKgOut(n > 0 ? String(n * grainCapacity) : "");
      setKgOutAuto(n > 0);
    }
  }

  function changeKgOut(v: string) {
    setKgOut(v);
    setKgOutAuto(false);
  }

  // طحن كامل رصيد الحبوب المتاح
  function handleMillAllGrain() {
    if (!selectedGrain) return;
    setBagsOut(String(selectedGrain.bags_balance));
    setKgOut(String(selectedGrain.kg_balance));
    setKgOutAuto(false);
  }

  // تغيير سطر الناتج
  function changeLineItem(idx: number, itemId: string) {
    const c = cap(itemId);
    setOutputs((o) =>
      o.map((l, i) => {
        if (i !== idx) return l;
        const n = Number(l.bags) || 0;
        const auto = autoKgLines.has(idx) || l.kg === 0;
        const kg = c && auto && n > 0 ? n * c : l.kg;
        return { ...l, itemId, kg };
      }),
    );
    if (c) setAutoKgLines((s) => new Set(s).add(idx));
  }

  function changeLineBags(idx: number, bags: number) {
    setOutputs((o) =>
      o.map((l, i) => {
        if (i !== idx) return l;
        const c = cap(l.itemId);
        const auto = autoKgLines.has(idx) || l.kg === 0;
        if (c && auto) return { ...l, bags, kg: bags > 0 ? bags * c : 0 };
        return { ...l, bags };
      }),
    );
  }

  function changeLineKg(idx: number, kg: number) {
    setOutputs((o) => o.map((l, i) => (i === idx ? { ...l, kg } : l)));
    setAutoKgLines((s) => {
      const n = new Set(s);
      n.delete(idx);
      return n;
    });
  }

  // تغيير الفاقد بالأكياس
  function handleLossBagsChange(v: string) {
    setLossBags(v);
    const bags = Number(v) || 0;
    const pkg = Number(lossPackageKg) || 50;
    if (bags > 0) {
      setLossKg(String(bags * pkg));
    }
  }

  // الحسابات الرياضية للمطابقة والتحقق
  const currentMilledKg = Number(kgOut) || 0;
  const currentMilledBags = Number(bagsOut) || 0;

  const totalProducedKg = useMemo(() => {
    return outputs.reduce((sum, o) => sum + (Number(o.kg) || 0), 0);
  }, [outputs]);

  const totalProducedBags = useMemo(() => {
    return outputs.reduce((sum, o) => sum + (Number(o.bags) || 0), 0);
  }, [outputs]);

  const actualLossKg = Number(lossKg) || 0;
  const totalOutputsWithLossKg = totalProducedKg + actualLossKg;
  const discrepancyKg = Math.round((currentMilledKg - totalOutputsWithLossKg) * 1000) / 1000;

  // رصيد الحبوب المتبقي كحبوب خام (لم تُطحن)
  const remainingRawBags = selectedGrain
    ? Math.max(0, selectedGrain.bags_balance - currentMilledBags)
    : 0;
  const remainingRawKg = selectedGrain
    ? Math.max(0, selectedGrain.kg_balance - currentMilledKg)
    : 0;

  const isOverRawBalance = selectedGrain
    ? currentMilledBags > selectedGrain.bags_balance || currentMilledKg > selectedGrain.kg_balance
    : false;

  const canSubmit = Boolean(
    customerId &&
    warehouseId &&
    grainItemId &&
    !isOverRawBalance &&
    (currentMilledBags > 0 || currentMilledKg > 0) &&
    outputs.some((o) => o.itemId && (o.bags > 0 || o.kg > 0)),
  );

  const submit = useMutation({
    mutationFn: () => {
      const lossNote = actualLossKg > 0 ? `[فاقد تشغيلي مقيّد: ${actualLossKg} كجم]` : "";
      const combinedNotes = [notes.trim(), lossNote].filter(Boolean).join(" — ");

      return custodyMilling({
        customerId,
        warehouseId,
        grainItemId,
        bagsOut: currentMilledBags,
        kgOut: currentMilledKg,
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

      setBagsOut("");
      setKgOut("");
      setKgOutAuto(false);
      setOutputs([{ itemId: "", bags: 0, kg: 0 }]);
      setAutoKgLines(new Set());
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
                      setGrainItemId("");
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

              {/* اختيار الحبوب والكمية المطحونة في هذه الدفعة */}
              <div className="rounded-2xl border border-border/80 bg-surface-2/30 p-3.5 space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold text-foreground flex items-center gap-1.5">
                    <Wheat className="h-4 w-4 text-amber-500" />
                    <span>الحبوب الخام المستهلكة في الطحن</span>
                  </h4>
                  {selectedGrain && (
                    <button
                      type="button"
                      onClick={handleMillAllGrain}
                      className="rounded-lg bg-amber-500/10 px-2 py-0.5 text-[11px] font-bold text-amber-700 dark:text-amber-300 hover:bg-amber-500/20"
                    >
                      طحن كامل الرصيد
                    </button>
                  )}
                </div>

                <MillingField label="صنف الحبوب المراد طحنها *">
                  <MillingSelect
                    value={grainItemId}
                    onChange={(e) => {
                      setGrainItemId(e.target.value);
                      setBagsOut("");
                      setKgOut("");
                    }}
                    className="font-bold text-xs"
                  >
                    <option value="">اختر صنف الحبوب من رصيد العميل…</option>
                    {grainBalances.map((b) => (
                      <option key={b.item_id} value={b.item_id}>
                        {b.name_ar} — رصيد متبقٍ: {fmtNum(b.bags_balance)} كيس (
                        {fmtNum(b.kg_balance)} كجم)
                      </option>
                    ))}
                  </MillingSelect>
                </MillingField>

                <div className="grid gap-3 sm:grid-cols-2">
                  <MillingField
                    label="الأكياس المطحونة بهذه الدفعة"
                    hint={
                      selectedGrain
                        ? `الرصيد المتاح: ${fmtNum(selectedGrain.bags_balance)} كيس`
                        : undefined
                    }
                  >
                    <QuantityInput
                      decimals={0}
                      min={0}
                      placeholder="0 كيس"
                      aria-label="الأكياس المطحونة بهذه الدفعة"
                      value={bagsOut === "" ? null : Number(bagsOut)}
                      onValueChange={(v) => changeBagsOut(v == null ? "" : String(v))}
                      className="font-bold text-amber-600 dark:text-amber-400"
                    />
                  </MillingField>

                  <MillingField
                    label="الوزن المطحون (كجم)"
                    hint={
                      grainCapacity
                        ? `محسوب تلقائياً (${grainCapacity} كجم/كيس) — قابل للتعديل`
                        : "أدخل الوزن الفعلي"
                    }
                  >
                    <QuantityInput
                      decimals={2}
                      min={0}
                      unit="kg"
                      placeholder="0.00 كجم"
                      aria-label="الوزن المطحون (كجم)"
                      value={kgOut === "" ? null : Number(kgOut)}
                      onValueChange={(v) => changeKgOut(v == null ? "" : String(v))}
                      className="font-bold"
                    />
                  </MillingField>
                </div>

                {/* مؤشر رصيد الحبوب المتبقي كحبوب خام (لم تُطحن) */}
                {selectedGrain && (
                  <div className="rounded-xl border border-blue-500/20 bg-blue-500/5 p-2.5 text-xs flex flex-wrap items-center justify-between gap-2">
                    <span className="text-blue-900 dark:text-blue-200">
                      <strong>المتبقي كحبوب خام لم تُطحن:</strong> {fmtNum(remainingRawBags)} كيس (
                      {fmtNum(remainingRawKg)} كجم)
                    </span>
                    <span className="text-[11px] font-semibold text-blue-700 dark:text-blue-300">
                      ✓ يبقى في رصيد العميل العيني ولا يُسجل كفاقد.
                    </span>
                  </div>
                )}
              </div>

              {/* النواتج المستخرجة */}
              <div className="space-y-3 rounded-2xl border border-border/80 bg-surface-2/30 p-3.5">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="text-xs font-bold text-foreground">النواتج المستخرجة المعبأة</h4>
                    <p className="text-[11px] text-muted-foreground">
                      حدد الصنف، عدد الأكياس والوزن المستخرج (دقيق 50، 25، 10 كجم، نخالة، سميد…)
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setOutputs((o) => [...o, { itemId: "", bags: 0, kg: 0 }])}
                    className="inline-flex items-center gap-1 rounded-xl border border-border bg-card px-2.5 py-1 text-xs font-bold text-foreground shadow-xs hover:bg-muted"
                  >
                    <Plus className="h-3.5 w-3.5" /> سطر ناتج آخر
                  </button>
                </div>

                {outputs.map((line, idx) => (
                  <div
                    key={idx}
                    className="grid grid-cols-[1fr_80px_100px_36px] items-center gap-2 rounded-xl border border-border/70 bg-card p-2.5"
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
                      placeholder="أكياس"
                      aria-label="أكياس الناتج"
                      value={line.bags || null}
                      onValueChange={(v) => changeLineBags(idx, v ?? 0)}
                      className="font-bold text-emerald-600 dark:text-emerald-400"
                    />

                    <QuantityInput
                      decimals={2}
                      min={0}
                      emptyAsZero
                      placeholder="كجم"
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

                <div className="grid gap-2.5 sm:grid-cols-3">
                  <MillingField label="سعة العبوة (كجم)">
                    <MillingSelect
                      value={lossPackageKg}
                      onChange={(e) => {
                        setLossPackageKg(e.target.value);
                        if (lossBags) {
                          setLossKg(String((Number(lossBags) || 0) * Number(e.target.value)));
                        }
                      }}
                      className="text-xs"
                    >
                      <option value="50">كيس 50 كجم</option>
                      <option value="25">كيس 25 كجم</option>
                      <option value="10">كيس 10 كجم</option>
                      <option value="5">كيس 5 كجم</option>
                    </MillingSelect>
                  </MillingField>

                  <MillingField label="أكياس الفاقد">
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
                      unit="kg"
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
                          b.item_id === grainItemId
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

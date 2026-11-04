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
  UserPlus,
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
  capacityKgOf,
  type CustodyLine,
  type ProductOption,
  type GrainType,
} from "@/lib/milling";
import { MillingDocumentsBoard } from "@/components/milling/milling-documents-board";
import { CustodyAdjustmentPanel } from "@/components/milling/custody-adjustment-panel";
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
import { ProductPicker } from "@/components/products/product-picker";
import { ProductLinesEditor } from "@/components/products/product-lines-editor";
import { QuickAddButton } from "@/components/ui/quick-add-button";
import { QuickProductDialog } from "@/components/milling/quick-product-dialog";
import { PartyPicker } from "@/components/commerce/party-picker";
import { CustomerFormDialog } from "@/components/contacts/customer-form-dialog";
import { useI18n } from "@/lib/i18n";
import { WarehouseBadge } from "@/components/ui/warehouse-badge";

export const Route = createFileRoute("/_app/milling/milling")({
  head: () => ({ meta: [{ title: "عمليات الطحن ونواتج الأمانات — فورتكس ERP" }] }),
  component: MillingMillPage,
});

interface CustomerOption {
  id: string;
  name: string;
  phone?: string | null;
  balance?: number | null;
  is_system?: boolean | null;
}

interface WarehouseOption {
  id: string;
  name_ar: string | null;
  name: string;
  is_default?: boolean;
}

function MillingMillPage() {
  const qc = useQueryClient();
  const { lang } = useI18n();
  const [customerId, setCustomerId] = useState("");
  const [newCustomerOpen, setNewCustomerOpen] = useState(false);
  const [warehouseId, setWarehouseId] = useState("");
  const [grains, setGrains] = useState<CustodyLine[]>([{ itemId: "", bags: 0, kg: 0 }]);
  const [outputs, setOutputs] = useState<CustodyLine[]>([{ itemId: "", bags: 0, kg: 0 }]);
  /** نافذة إضافة ناتج جديد — تُركَّب على `document.body` فتعلو الكاونتر. */
  const [quickOutputOpen, setQuickOutputOpen] = useState(false);

  // حقل الفاقد التشغيلي الفعلي أثناء الطحن — وزن فيزيائي يدوي فقط (V2: بلا سعات)
  const [lossKg, setLossKg] = useState("");
  const [lossBags, setLossBags] = useState("");
  const [notes, setNotes] = useState("");

  // E6/M5: نوع الحبة المرجعي (grain_types) — يعبّئ الفاقد والنواتج الافتراضية
  const [grainTypeId, setGrainTypeId] = useState("");

  const customers = useQuery({
    queryKey: ["milling", "customers"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("customers")
        .select("id, name, phone, balance, is_system")
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
  // ── أدوات أسطر الحبوب المطحونة مع الحساب التلقائي الذكي للوزن ──
  function changeGrainItem(idx: number, itemId: string) {
    setGrains((g) =>
      g.map((l, i) => {
        if (i !== idx) return l;
        const b = grainBalances.find((x) => x.item_id === itemId);
        const unitWeight =
          b && Number(b.bags_balance) > 0
            ? Number(b.kg_balance) / Number(b.bags_balance)
            : capacityKgOf(b as any) || 0;
        const autoKg =
          l.bags > 0 && unitWeight > 0 ? Math.round(l.bags * unitWeight * 100) / 100 : l.kg;
        return { ...l, itemId, kg: autoKg };
      }),
    );
  }

  function changeGrainBags(idx: number, bags: number) {
    setGrains((g) =>
      g.map((l, i) => {
        if (i !== idx) return l;
        const b = grainBalances.find((x) => x.item_id === l.itemId);
        const unitWeight =
          b && Number(b.bags_balance) > 0
            ? Number(b.kg_balance) / Number(b.bags_balance)
            : capacityKgOf(b as any) || 0;
        const autoKg =
          bags > 0 && unitWeight > 0
            ? Math.round(bags * unitWeight * 100) / 100
            : bags === 0
              ? 0
              : l.kg;
        return { ...l, bags, kg: autoKg };
      }),
    );
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
          const cap = capacityKgOf(match) || 0;
          const bags = cap > 0 && kg > 0 ? Math.round(kg / cap) : 0;
          return { itemId: match.id, bags, kg };
        })
        .filter((l): l is CustodyLine => l !== null);
      if (prefilled.length > 0) setOutputs(prefilled);
    }
  }

  // تغيير سطر الناتج — مع احتساب تلقائي للوزن من سعة العبوة (أكياس × سعة)
  function changeLineItem(idx: number, itemId: string) {
    setOutputs((o) =>
      o.map((l, i) => {
        if (i !== idx) return l;
        const item = (outputItems.data ?? []).find((p: ProductOption) => p.id === itemId);
        const cap = capacityKgOf(item) || 0;
        const autoKg = l.bags > 0 && cap > 0 ? Math.round(l.bags * cap * 100) / 100 : l.kg;
        return { ...l, itemId, kg: autoKg };
      }),
    );
  }

  function changeLineBags(idx: number, bags: number) {
    setOutputs((o) =>
      o.map((l, i) => {
        if (i !== idx) return l;
        const item = (outputItems.data ?? []).find((p: ProductOption) => p.id === l.itemId);
        const cap = capacityKgOf(item) || 0;
        const autoKg =
          bags > 0 && cap > 0 ? Math.round(bags * cap * 100) / 100 : bags === 0 ? 0 : l.kg;
        return { ...l, bags, kg: autoKg };
      }),
    );
  }

  function changeLineKg(idx: number, kg: number) {
    setOutputs((o) => o.map((l, i) => (i !== idx ? l : { ...l, kg })));
  }

  // الفاقد: احتساب تلقائي ذكي
  function handleLossBagsChange(v: string) {
    setLossBags(v);
    const b = Number(v) || 0;
    if (b > 0 && (!lossKg || Number(lossKg) === 0)) {
      const milledKg = grains.reduce((s, g) => s + (Number(g.kg) || 0), 0);
      const milledBags = grains.reduce((s, g) => s + (Number(g.bags) || 0), 0);
      const avgBag = milledBags > 0 ? milledKg / milledBags : 50;
      setLossKg(String(Math.round(b * avgBag * 100) / 100));
    }
  }

  /** زر ذكي: تعبئة الفاقد التشغيلي تلقائياً من الفارق غير الموزون لمطابقة 100% */
  function handleAutoFillLossFromDiscrepancy() {
    const unallocated = Math.max(0, currentMilledKg - totalProducedKg);
    setLossKg(String(Math.round(unallocated * 100) / 100));
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

  // نتحقق من مجموع السطور لكل صنف، حتى لا يتجاوز تكرار الصنف الرصيد المتاح.
  const overGrainLine = grains.find((g, idx) => {
    if (!g.itemId) return false;
    const b = grainBalances.find((x) => x.item_id === g.itemId);
    if (!b) return false;
    const sameItem = grains.filter((candidate) => candidate.itemId === g.itemId);
    const totalBags = sameItem.reduce((sum, line) => sum + (Number(line.bags) || 0), 0);
    const totalKg = sameItem.reduce((sum, line) => sum + (Number(line.kg) || 0), 0);
    return (
      idx === grains.findIndex((candidate) => candidate.itemId === g.itemId) &&
      (totalBags > b.bags_balance || totalKg > b.kg_balance)
    );
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
      toast.success(
        docNumber
          ? `تم تسجيل عملية الطحن بنجاح — مرجع داخلي #${docNumber}`
          : "تم تسجيل عملية الطحن بنجاح.",
      );

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
      <div dir="rtl" className="mx-auto w-full max-w-[1480px] space-y-5 px-3 py-4 sm:px-5 lg:px-7">
        {/* واجهة تشغيل داخلية بلا إيحاءات إصدار فواتير أو سندات للعميل */}
        <PageHeader
          title="تشغيل الطحن"
          subtitle="معالجة داخلية لأمانات العملاء: صرف الحبوب، تسجيل النواتج، ومراجعة الرصيد."
          actions={
            <div className="flex items-center gap-2">
              <Link
                to="/milling/delivery"
                className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-primary-foreground shadow-sm transition hover:bg-primary/90"
              >
                التسليم <ArrowLeft className="h-4 w-4" />
              </Link>
              <Link
                to="/milling/customer-statement"
                className="inline-flex min-h-11 items-center justify-center rounded-xl border border-border bg-card px-4 py-2.5 text-sm font-bold text-foreground shadow-sm transition hover:bg-muted"
              >
                كشف الحساب
              </Link>
            </div>
          }
        />

        {/* مسار العمل: بيانات العملية أولاً، ثم الأرصدة المساعدة على الشاشات الواسعة */}
        <div className="grid min-w-0 gap-5 xl:grid-cols-12">
          <MillingPanel className="min-w-0 space-y-4 overflow-hidden xl:col-span-8">
            <MillingSectionTitle
              icon={<Cog className="h-4 w-4" />}
              title="تسجيل عملية الطحن"
              subtitle="طحن كامل أو جزئي (دفعة) مع تثبيت المتبقي باسم العميل"
            />

            <div className="space-y-4 p-4">
              {/* العميل والمستودع — المستودع شارة، لا حقل يزاحم العميل */}
              <div className="space-y-2">
                <MillingField label="صاحب الأمانة (العميل) *">
                  <div className="flex min-w-0 flex-1 items-center gap-1.5">
                    <PartyPicker
                      options={customers.data ?? []}
                      value={customerId}
                      onChange={(nextId) => {
                        setCustomerId(nextId);
                        setGrains([{ itemId: "", bags: 0, kg: 0 }]);
                      }}
                      lang={lang}
                      label={lang === "ar" ? "العميل" : "Customer"}
                      emptyLabel={lang === "ar" ? "اختر العميل…" : "Select customer…"}
                      kind="customer"
                      className="h-10 min-w-0 flex-1 rounded-2xl border-primary/20 bg-primary/[0.035] text-xs hover:border-primary/50 hover:bg-primary/[0.07]"
                    />
                    <button
                      type="button"
                      onClick={() => setNewCustomerOpen(true)}
                      className="grid size-9 shrink-0 place-items-center rounded-full border border-primary/25 bg-primary/10 text-primary shadow-sm transition hover:border-primary/40 hover:bg-primary/15 active:scale-95 cursor-pointer"
                      title={lang === "ar" ? "إضافة عميل جديد" : "Add customer"}
                      aria-label={lang === "ar" ? "إضافة عميل جديد" : "Add customer"}
                    >
                      <UserPlus className="h-4 w-4" />
                    </button>
                  </div>
                </MillingField>

                <WarehouseBadge
                  value={warehouseId}
                  onChange={setWarehouseId}
                  required
                  warehouses={(warehouses.data ?? []).map((w) => ({
                    id: w.id,
                    nameAr: w.name_ar || w.name,
                  }))}
                />
              </div>

              {/* أسطر الحبوب المطحونة — صنف مستقل لكل سطر من رصيد أمانات العميل */}
              <div className="rounded-2xl border border-border/80 bg-surface-2/30 p-3.5 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h4 className="flex items-center gap-2 text-sm font-bold text-foreground">
                    <Wheat className="h-4 w-4 text-amber-500" />
                    <span>الحبوب المستهلكة</span>
                  </h4>
                  <span className="rounded-full bg-amber-500/10 px-3 py-1 text-xs font-bold text-amber-700 dark:text-amber-300">
                    {fmtNum(currentMilledKg)} كجم · {fmtNum(currentMilledBags)} كيس
                  </span>
                </div>
                <ProductLinesEditor
                  lines={grains.map((line) => ({
                    itemId: line.itemId,
                    bags: line.bags || 0,
                    kg: line.kg || 0,
                  }))}
                  onChange={(index, patch) => {
                    if (patch.itemId !== undefined) changeGrainItem(index, patch.itemId);
                    if (patch.bags !== undefined) changeGrainBags(index, patch.bags);
                    if (patch.kg !== undefined) changeGrainKg(index, patch.kg);
                  }}
                  onAdd={addGrainLine}
                  onRemove={removeGrainLine}
                  items={grainBalances.map((g) => ({
                    id: g.item_id,
                    nameAr: g.name_ar,
                    sku: g.sku,
                    item_class: g.item_class,
                    balanceKg: g.kg_balance,
                    balanceBags: g.bags_balance,
                  }))}
                  classes={["RAW_MATERIAL"]}
                  placeholder="اختر صنف الحبوب من رصيد العميل…"
                  bagsLabel="أكياس مطحونة"
                  kgLabel="الوزن المطحون (كجم)"
                  onFillAll={handleMillAllForLine}
                  fillAllLabel="طحن الكل"
                  addLabel="إضافة صنف حبوب"
                  ariaLabel="الحبوب المستهلكة"
                  metrics={(_index, line) => {
                    const balance = line.itemId
                      ? grainBalances.find((x) => x.item_id === line.itemId)
                      : undefined;
                    if (!balance) return [];
                    const overBags = line.bags > balance.bags_balance;
                    const overKg = line.kg > balance.kg_balance;
                    return [
                      {
                        key: "available",
                        label: "المتاح",
                        value: balance.bags_balance,
                        unit: "كيس",
                        secondary: `(${fmtNum(balance.kg_balance)} كجم)`,
                        isOver: overBags || overKg,
                      },
                      {
                        key: "remaining",
                        label: "المتبقي",
                        value: Math.max(0, balance.bags_balance - line.bags),
                        unit: "كيس",
                        secondary: `(${fmtNum(Math.max(0, balance.kg_balance - line.kg))} كجم)`,
                        tone: "primary",
                      },
                    ];
                  }}
                />

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
              <div className="space-y-3 rounded-2xl border border-border/80 bg-surface-2/30 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <h4 className="text-xs font-bold text-foreground">النواتج المستخرجة المعبأة</h4>
                    <p className="text-[11px] text-muted-foreground">
                      حدد الصنف، عدد الأكياس والوزن المستخرج (دقيق 50، 25، 10 كجم، نخالة، سميد…).
                    </p>
                  </div>
                  {/*
                    إضافة ناتج من داخل الشاشة: زرّ دائريّ بأيقونة يفتح نافذة
                    منبثقة فوق الكاونتر. قبل ذلك كان الطريق الوحيد مغادرة
                    الكاونتر إلى «أصناف الأمانات» وترك المستند مفتوحًا تكتشف
                    لاحقًا أنه فقد سياقه.
                  */}
                  <QuickAddButton
                    label="إضافة صنف ناتج جديد"
                    icon={Plus}
                    tone="emerald"
                    size="sm"
                    onClick={() => setQuickOutputOpen(true)}
                  />
                </div>
                {outputItems.data && outputItems.data.length === 0 && (
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-2.5 py-1.5 text-[11px]">
                    <span className="font-semibold text-amber-700 dark:text-amber-300">
                      لا توجد أصناف نواتج بعد — أضف واحدًا لتسجيل النواتج.
                    </span>
                  </div>
                )}

                {/*
                  لا ترويسة أعمدة هنا: المحرّر الموحّد يعرض تسمية كل رقم فوقه
                  داخل السطر نفسه. الترويسة الخارجية كانت تصف شبكة قديمة
                  (صنف / أكياس / وزن / حذف) لم تعد موجودة.
                */}

                <ProductLinesEditor
                  lines={outputs.map((line) => ({
                    itemId: line.itemId,
                    bags: line.bags || 0,
                    kg: line.kg || 0,
                  }))}
                  onChange={(index, patch) => {
                    if (patch.itemId !== undefined) changeLineItem(index, patch.itemId);
                    if (patch.bags !== undefined) changeLineBags(index, patch.bags);
                    if (patch.kg !== undefined) changeLineKg(index, patch.kg);
                  }}
                  onAdd={() => setOutputs((o) => [...o, { itemId: "", bags: 0, kg: 0 }])}
                  onRemove={(index) => setOutputs((o) => o.filter((_, i) => i !== index))}
                  items={(outputItems.data ?? []).map((g: ProductOption) => ({
                    id: g.id,
                    nameAr: g.name_ar || g.name,
                    sku: g.sku,
                    item_class: g.item_class,
                    package_weight_kg: g.package_weight_kg,
                  }))}
                  classes={["FINISHED_GOOD", "BY_PRODUCT"]}
                  placeholder="اختر الناتج (دقيق / نخالة / سميد)…"
                  bagsLabel="أكياس الناتج"
                  kgLabel="وزن الناتج (كجم)"
                  addLabel="إضافة سطر ناتج جديد"
                  ariaLabel="النواتج المستخرجة"
                />
              </div>

              {/* الفاقد والمطابقة تفاصيل مساعدة وليست حقولاً مهيمنة على التشغيل */}
              <details className="group rounded-2xl border border-border bg-card">
                <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 rounded-2xl px-4 py-3 transition hover:bg-muted/40 [&::-webkit-details-marker]:hidden">
                  <span className="flex min-w-0 items-center gap-2 text-sm font-bold">
                    <Scale className="h-4 w-4 shrink-0 text-amber-600" />
                    <span>الفاقد ومطابقة الأوزان</span>
                  </span>
                  <span
                    className={`shrink-0 rounded-full px-3 py-1 text-xs font-bold ${Math.abs(discrepancyKg) <= FILL_TOLERANCE_KG ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "bg-amber-500/10 text-amber-700 dark:text-amber-300"}`}
                  >
                    {currentMilledKg > 0
                      ? `الفرق ${fmtNum(Math.abs(discrepancyKg))} كجم`
                      : "اختياري"}
                  </span>
                </summary>
                <div className="space-y-3 border-t border-border p-3 sm:p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h4 className="text-xs font-bold text-foreground flex items-center gap-1.5">
                      <Scale className="h-4 w-4 text-amber-600" />
                      <span>الفاقد التشغيلي الفعلي للطحن (اختياري)</span>
                    </h4>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={handleAutoFillLossFromDiscrepancy}
                        disabled={currentMilledKg <= 0 || currentMilledKg <= totalProducedKg}
                        className="inline-flex items-center gap-1 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-[11px] font-bold text-amber-700 dark:text-amber-300 hover:bg-amber-500/20 disabled:opacity-40 transition-colors shadow-xs"
                        title="احتساب وتعبئة الفاقد تلقائياً من الفارق بين الحبوب المطحونة والنواتج"
                      >
                        <Sparkles className="h-3 w-3 text-amber-500" />
                        <span>احتساب الفاقد من الفارق تلقائياً</span>
                      </button>
                      <span className="text-[11px] text-muted-foreground hidden sm:inline">
                        الفاقد المتطاير أثناء الطحن
                      </span>
                    </div>
                  </div>
                  <div className="grid gap-2.5 sm:grid-cols-2">
                    <MillingField label="أكياس الفاقد" hint="اختياري — يحسب الوزن تلقائياً">
                      <QuantityInput
                        decimals={0}
                        min={0}
                        placeholder="0"
                        aria-label="أكياس الفاقد"
                        value={lossBags === "" ? null : Number(lossBags)}
                        onValueChange={(v) => handleLossBagsChange(v == null ? "" : String(v))}
                      />
                    </MillingField>

                    <MillingField label="وزن الفاقد (كجم)" hint="قابل للتعديل اليدوي">
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
                      <span className="font-bold text-foreground">
                        {fmtNum(currentMilledKg)} كجم
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">
                        مجموع النواتج ({fmtNum(totalProducedKg)} كجم) + الفاقد (
                        {fmtNum(actualLossKg)} كجم):
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
                            <span>
                              ✓ مطابقة تامة: النواتج والفاقد تعادل الحبوب المطحونة تماماً.
                            </span>
                          </div>
                        ) : isRoundedMatch ? (
                          <div className="flex items-center gap-1.5 font-semibold text-sky-600 dark:text-sky-400">
                            <CheckCircle2 className="h-4 w-4" />
                            <span>
                              ✓ مطابقة بتقريب التعبئة: فرق {fmtNum(Math.abs(discrepancyKg))} كجم
                              {discrepancyKg > 0
                                ? " (فاقد صغير غير مسجّل)"
                                : " (زيادة نواتج صغيرة)"}
                              .
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
                  </div>{" "}
                </div>
              </details>

              <MillingField label="ملاحظة داخلية" hint="اختيارية">
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
                    جارٍ حفظ العملية…
                  </>
                ) : (
                  <>
                    <Check className="h-5 w-5" />
                    حفظ عملية الطحن
                  </>
                )}
              </button>
            </div>
          </MillingPanel>

          {/* أرصدة مساعدة، تظهر بمحاذاة النموذج على الشاشات الواسعة */}
          <MillingPanel className="min-w-0 flex flex-col justify-between xl:col-span-4">
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

        {/* أدوات التشغيل والسجل خارج مسار تسجيل العملية لتقليل ازدحام الشاشة */}
        <details className="group rounded-2xl border border-border bg-card">
          <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-bold transition hover:bg-muted/40 [&::-webkit-details-marker]:hidden">
            <span>سجل عمليات الطحن</span>
            <span className="text-xs font-medium text-muted-foreground">عرض عند الحاجة</span>
          </summary>
          <div className="border-t border-border p-3 sm:p-4">
            <MillingDocumentsBoard focus="milling" title="سجل عمليات الطحن" />
          </div>
        </details>

        <details className="group rounded-2xl border border-border bg-card">
          <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-bold transition hover:bg-muted/40 [&::-webkit-details-marker]:hidden">
            <span>تسويات الأمانات</span>
            <span className="text-xs font-medium text-muted-foreground">أداة إدارية منفصلة</span>
          </summary>
          <div className="border-t border-border p-3 sm:p-4">
            <CustodyAdjustmentPanel
              customerId={customerId}
              warehouseId={warehouseId}
              items={[
                ...grainBalances.map((b) => ({
                  id: b.item_id,
                  sku: "",
                  name: b.name_ar ?? "صنف بدون اسم",
                  name_ar: b.name_ar,
                  item_class: b.item_class,
                  sale_price: 0,
                  package_weight_kg: null,
                })),
                ...(outputItems.data ?? []),
              ]}
            />
          </div>
        </details>

        {/* إضافة ناتج — نافذة منبثقة فوق الشاشة، لا نافذة تُقصّ داخل اللوحة. */}
        <QuickProductDialog
          open={quickOutputOpen}
          onOpenChange={setQuickOutputOpen}
          mode="custody"
          defaultClass="FINISHED_GOOD"
          classes={["FINISHED_GOOD", "BY_PRODUCT"]}
          onSaved={(productId) => {
            const emptyIdx = outputs.findIndex((o) => !o.itemId);
            if (emptyIdx >= 0) {
              setOutputs((current) =>
                current.map((line, i) => (i === emptyIdx ? { ...line, itemId: productId } : line)),
              );
            } else {
              setOutputs((current) => [...current, { itemId: productId, bags: 0, kg: 0 }]);
            }
          }}
        />
        {/* نافذة إضافة عميل جديد سريعاً دون مغادرة شاشة الطحن */}
        <CustomerFormDialog
          open={newCustomerOpen}
          onClose={() => setNewCustomerOpen(false)}
          hint={
            lang === "ar"
              ? "سيتم اختيار العميل تلقائياً فور حفظه لتنفيذ الطحن."
              : "Customer will be selected automatically."
          }
          onSaved={(newCust) => {
            void qc.invalidateQueries({ queryKey: ["milling", "customers"] });
            setCustomerId(newCust.id);
            setGrains([{ itemId: "", bags: 0, kg: 0 }]);
            setNewCustomerOpen(false);
            toast.success(
              lang === "ar"
                ? `تمت إضافة واختيار العميل: ${newCust.name}`
                : `Customer selected: ${newCust.name}`,
            );
          }}
        />
      </div>
    </ModuleGuard>
  );
}

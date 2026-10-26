/**
 * /milling/delivery — واجهة تسليم الأمانات ونواتج الطحن الفاخرة.
 *
 * رصيد العميل العيني → إدخال الكميات المسلمة (دفعات أو كاملة) → أسطر DELIVERY في custody_ledger.
 * حساب الرصيد السابق والمسلم والمتبقي تلقائياً مع إصدار سند تسليم رسمي عبر محرك القوالب الموحد
 * وقالب قسم خدمات العملاء والتسليم (milling-master أو النمط المعتمد) مع دعم المشاركة والطباعة الفاخرة.
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
  Truck,
  Plus,
  Trash2,
  PackageCheck,
  CheckCircle2,
  AlertCircle,
  Clock,
  Printer,
  Share2,
  User,
  Building2,
  ShieldCheck,
  Sparkles,
  RefreshCw,
  Check,
  Scale,
} from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
import { ModuleGuard } from "@/lib/modules";
import { supabase } from "@/integrations/supabase/client";
import {
  custodyDelivery,
  fetchCustodyBalances,
  buildCustodyDeliveryDoc,
  type CustodyLine,
  type CustodyBalance,
} from "@/lib/milling";
import { LuxuryPrintPreviewModal } from "@/components/luxury-print-preview-modal";
import { UnifiedPrintModal } from "@/components/milling/unified-print-modal";
import { MillingDocumentsBoard } from "@/components/milling/milling-documents-board";
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

export const Route = createFileRoute("/_app/milling/delivery")({
  head: () => ({ meta: [{ title: "تسليم نواتج الأمانات — فورتكس ERP" }] }),
  component: MillingDeliveryPage,
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

function MillingDeliveryPage() {
  const qc = useQueryClient();
  const [customerId, setCustomerId] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [lines, setLines] = useState<CustodyLine[]>([{ itemId: "", bags: 0, kg: 0 }]);
  const [driverName, setDriverName] = useState("");
  const [vehicleNumber, setVehicleNumber] = useState("");
  const [notes, setNotes] = useState("");

  // حالة معاينة وطباعة الفاتورة الفاخرة
  const [deliveryPrintDoc, setDeliveryPrintDoc] = useState<UnifiedDocumentData | null>(null);
  const [isPrintModalOpen, setIsPrintModalOpen] = useState(false);

  // جلب العملاء
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

  // جلب المخازن
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

  // أرصدة أمانات العميل المتاحة
  const balances = useQuery({
    queryKey: ["milling", "balances", customerId, warehouseId],
    queryFn: () => fetchCustodyBalances(customerId || undefined, warehouseId || undefined),
    enabled: Boolean(customerId && warehouseId),
  });

  // النواتج والحبوب المتاحة للتسليم (أي صنف رصيده أكبر من صفر)
  const available = (balances.data ?? []).filter(
    (b) => Number(b.bags_balance) > 0 || Number(b.kg_balance) > 0,
  );

  // V2: لا خريطة سعات ولا اشتقاق كجم — الأكياس والوزن إدخال يدوي مستقل (كما في شاشة الطحن).

  const selectedCustomer = (customers.data ?? []).find((c) => c.id === customerId);
  const selectedWarehouse = (warehouses.data ?? []).find((w) => w.id === warehouseId);
  const warehouseName = selectedWarehouse?.name_ar || selectedWarehouse?.name || "المستودع الرئيسي";

  function balanceFor(itemId: string): CustodyBalance | undefined {
    return available.find((b) => b.item_id === itemId);
  }

  function changeLineItem(idx: number, itemId: string) {
    setLines((l) => l.map((x, i) => (i !== idx ? x : { ...x, itemId })));
  }

  function changeLineBags(idx: number, bags: number) {
    setLines((l) => l.map((x, i) => (i !== idx ? x : { ...x, bags })));
  }

  function changeLineKg(idx: number, kg: number) {
    setLines((l) => l.map((x, i) => (i === idx ? { ...x, kg } : x)));
  }

  // تسليم كامل رصيد سطر محدد بنقرة واحدة
  function handleDeliverAllForLine(idx: number) {
    const line = lines[idx];
    if (!line?.itemId) return;
    const b = balanceFor(line.itemId);
    if (!b) return;
    setLines((l) =>
      l.map((x, i) =>
        i === idx ? { ...x, bags: Number(b.bags_balance), kg: Number(b.kg_balance) } : x,
      ),
    );
  }

  // تسليم كل الأرصدة المتاحة للعميل بنقرة واحدة
  function handleDeliverAllAvailable() {
    if (available.length === 0) return;
    const newLines = available.map((b) => ({
      itemId: b.item_id,
      bags: Number(b.bags_balance),
      kg: Number(b.kg_balance),
    }));
    setLines(newLines);
  }

  // التحقق من تجاوز الكمية المتاحة
  const hasOverdeliver = lines.some((l) => {
    if (!l.itemId) return false;
    const b = balanceFor(l.itemId);
    if (!b) return false;
    return l.bags > b.bags_balance || l.kg > b.kg_balance;
  });

  const canSubmit = Boolean(
    customerId &&
    warehouseId &&
    !hasOverdeliver &&
    lines.some((l) => l.itemId && (l.bags > 0 || l.kg > 0)),
  );

  // إرسال عملية التسليم
  const submit = useMutation({
    mutationFn: () => {
      const combinedNotes = [
        driverName.trim() ? `المستلم / السائق: ${driverName.trim()}` : "",
        vehicleNumber.trim() ? `المركبة: ${vehicleNumber.trim()}` : "",
        notes.trim() ? notes.trim() : "",
      ]
        .filter(Boolean)
        .join(" | ");

      return custodyDelivery({
        customerId,
        warehouseId,
        lines,
        notes: combinedNotes || undefined,
      });
    },
    onSuccess: async (res) => {
      if (!res.ok) {
        toast.error(res.message || "تعذر تسجيل التسليم.");
        return;
      }

      const docNumber = (res.data as string) || `DEL-${Date.now().toString().slice(-6)}`;
      toast.success(`تم تسجيل التسليم بنجاح — سند رقم #${docNumber}`);

      // تجهيز بيانات سند التسليم الفاخر مع توضيح الكميات السابقة، المسلمة، والمتبقية
      const deliveryLinesPayload = lines
        .filter((l) => l.itemId && (l.bags > 0 || l.kg > 0))
        .map((l) => {
          const b = balanceFor(l.itemId);
          const prevBags = Number(b?.bags_balance ?? l.bags);
          const prevKg = Number(b?.kg_balance ?? l.kg);
          const delBags = Number(l.bags ?? 0);
          const delKg = Number(l.kg ?? 0);
          const remBags = Math.max(0, prevBags - delBags);
          const remKg = Math.max(0, prevKg - delKg);

          return {
            itemName: b?.name_ar || "صنف ناتج",
            previousBags: prevBags,
            previousKg: prevKg,
            deliveredBags: delBags,
            deliveredKg: delKg,
            remainingBags: remBags,
            remainingKg: remKg,
            unit: delBags > 0 ? "كيس" : "كجم",
            note:
              driverName || vehicleNumber
                ? `${driverName ? `السائق: ${driverName}` : ""} ${vehicleNumber ? `(${vehicleNumber})` : ""}`.trim()
                : undefined,
          };
        });

      const combinedNotes = [
        driverName.trim() ? `المستلم: ${driverName.trim()}` : "",
        vehicleNumber.trim() ? `رقم المركبة: ${vehicleNumber.trim()}` : "",
        notes.trim() ? notes.trim() : "",
      ]
        .filter(Boolean)
        .join(" — ");

      const uDoc = buildCustodyDeliveryDoc({
        docNumber,
        customerName: selectedCustomer?.name || "عميل أمانة",
        customerPhone: selectedCustomer?.phone,
        warehouseName,
        lines: deliveryLinesPayload,
        notes: combinedNotes || undefined,
      });

      setDeliveryPrintDoc(uDoc);
      setIsPrintModalOpen(true);

      // تفريغ النموذج
      setLines([{ itemId: "", bags: 0, kg: 0 }]);
      setDriverName("");
      setVehicleNumber("");
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
          title="تسليم نواتج الأمانات"
          subtitle="صرف وخروج نواتج الطحن والأمانات العينية للعميل مع احتساب الأرصدة المتبقية وسند تسليم رسمي."
          actions={
            <div className="flex items-center gap-2">
              <Link
                to="/milling/customer-statement"
                className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-card px-3.5 py-2 text-xs font-bold text-foreground shadow-xs transition hover:bg-muted"
              >
                كشف حساب الأمانات
              </Link>
              <Link
                to="/milling/intake"
                className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-card px-3.5 py-2 text-xs font-bold text-foreground shadow-xs transition hover:bg-muted"
              >
                كاونتر الاستلام
              </Link>
            </div>
          }
        />

        {/* جسم الشاشة: عمود إدخال التسليم + عمود الرصيد المتبقي */}
        <div className="grid gap-4 lg:grid-cols-12">
          {/* العمود الأيمن (7 أعمدة): نموذج التسليم */}
          <MillingPanel className="lg:col-span-7 space-y-4">
            <MillingSectionTitle
              icon={<Truck className="h-4 w-4" />}
              title="نموذج صرف وتسليم الأمانات"
              subtitle="تسجيل صرف كلي أو جزئي (دفعات) مع تحديث فوري للمتبقي"
              action={
                available.length > 0 ? (
                  <button
                    type="button"
                    onClick={handleDeliverAllAvailable}
                    className="inline-flex items-center gap-1 rounded-lg bg-emerald-500/10 px-2.5 py-1 text-xs font-bold text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/20"
                  >
                    <Sparkles className="h-3 w-3" />
                    تسليم كامل الرصيد المتاح
                  </button>
                ) : undefined
              }
            />

            <div className="space-y-4 p-4">
              {/* العميل والمستودع */}
              <div className="grid gap-3 sm:grid-cols-2">
                <MillingField label="العميل صاحب الأمانة *">
                  <MillingSelect
                    value={customerId}
                    onChange={(e) => {
                      setCustomerId(e.target.value);
                      setLines([{ itemId: "", bags: 0, kg: 0 }]);
                    }}
                    className="font-bold text-xs"
                  >
                    <option value="">اختر العميل المستلم…</option>
                    {(customers.data ?? []).map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} {c.phone ? `(${c.phone})` : ""}
                      </option>
                    ))}
                  </MillingSelect>
                </MillingField>

                <MillingField label="المستودع المصروف منه *">
                  <MillingSelect
                    value={warehouseId}
                    onChange={(e) => setWarehouseId(e.target.value)}
                    className="font-bold text-xs"
                  >
                    <option value="">اختر المستودع…</option>
                    {(warehouses.data ?? []).map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name_ar || w.name} {w.is_default ? "★ (الافتراضي)" : ""}
                      </option>
                    ))}
                  </MillingSelect>
                </MillingField>
              </div>

              {/* جدول أسطر التسليم */}
              <div className="space-y-3 rounded-2xl border border-border/80 bg-surface-2/30 p-3.5">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="text-xs font-bold text-foreground">
                      الأصناف والكميات المراد تسليمها
                    </h4>
                    <p className="text-[11px] text-muted-foreground">
                      يمكن التسليم على دفعات متفرقة، وسيظهر المتبقي في الفاتورة والسجل.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setLines((l) => [...l, { itemId: "", bags: 0, kg: 0 }])}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-primary/30 bg-primary/10 px-3 py-1.5 text-xs font-bold text-primary hover:bg-primary/20 transition-colors"
                  >
                    <Plus className="h-3.5 w-3.5" /> إضافة صنف آخر للتسليم
                  </button>
                </div>

                {lines.map((line, idx) => {
                  const b = line.itemId ? balanceFor(line.itemId) : undefined;
                  const remBags = b ? Math.max(0, b.bags_balance - (Number(line.bags) || 0)) : 0;
                  const remKg = b ? Math.max(0, b.kg_balance - (Number(line.kg) || 0)) : 0;
                  const isOver = b && (line.bags > b.bags_balance || line.kg > b.kg_balance);

                  return (
                    <div
                      key={idx}
                      className={`space-y-2 rounded-xl border p-3 transition-colors ${
                        isOver ? "border-rose-500/50 bg-rose-500/5" : "border-border/70 bg-card/70"
                      }`}
                    >
                      <div className="grid grid-cols-[1fr_auto] items-center gap-2">
                        <MillingSelect
                          value={line.itemId}
                          onChange={(e) => changeLineItem(idx, e.target.value)}
                          className="font-bold text-xs"
                        >
                          <option value="">اختر ناتج الطحن أو الأمانة…</option>
                          {available.map((item) => (
                            <option key={item.item_id} value={item.item_id}>
                              {item.name_ar} — رصيد متبقٍ: {fmtNum(item.bags_balance)} كيس (
                              {fmtNum(item.kg_balance)} كجم)
                            </option>
                          ))}
                        </MillingSelect>

                        <div className="flex items-center gap-1">
                          {b && (
                            <button
                              type="button"
                              onClick={() => handleDeliverAllForLine(idx)}
                              className="rounded-lg bg-emerald-500/10 px-2 py-1 text-[11px] font-bold text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/20"
                              title="تسليم كامل الكمية المتاحة لهذا الصنف"
                            >
                              تسليم الكل
                            </button>
                          )}
                          <button
                            type="button"
                            disabled={lines.length === 1}
                            onClick={() => setLines((l) => l.filter((_, i) => i !== idx))}
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
                            الأكياس المسلمة:
                          </span>
                          <QuantityInput
                            decimals={0}
                            min={0}
                            emptyAsZero
                            placeholder="0"
                            aria-label="الأكياس المسلمة"
                            value={line.bags || null}
                            onValueChange={(v) => changeLineBags(idx, v ?? 0)}
                            className="font-bold text-emerald-600 dark:text-emerald-400"
                          />
                        </div>

                        <div>
                          <span className="block text-[11px] font-semibold text-muted-foreground mb-1">
                            الوزن المسلّم (كجم):
                          </span>
                          <QuantityInput
                            decimals={2}
                            min={0}
                            emptyAsZero
                            placeholder="0.00"
                            aria-label="الوزن المسلّم (كجم)"
                            value={line.kg || null}
                            onValueChange={(v) => changeLineKg(idx, v ?? 0)}
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

                        <div className="rounded-lg bg-amber-500/10 p-2 text-center text-xs">
                          <span className="block text-[10px] text-amber-700 dark:text-amber-300 font-semibold">
                            المتبقي بعد الصرف:
                          </span>
                          <span className="font-black text-amber-700 dark:text-amber-300">
                            {b ? `${fmtNum(remBags)} كيس` : "—"}
                          </span>
                          <span className="block text-[10px] text-amber-700/80 dark:text-amber-300/80">
                            {b ? `(${fmtNum(remKg)} كجم)` : ""}
                          </span>
                        </div>
                      </div>

                      {/* رسالة التحذير في حال تجاوز الكمية المتاحة */}
                      {isOver && (
                        <div className="flex items-center gap-1.5 rounded-lg bg-rose-500/10 px-2.5 py-1 text-xs font-bold text-rose-600 dark:text-rose-300">
                          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                          <span>
                            تنبيه: الكمية المطلوبة تسليمها أكبر من رصيد العميل المتبقي! الحد الأقصى:{" "}
                            {fmtNum(b.bags_balance)} كيس / {fmtNum(b.kg_balance)} كجم.
                          </span>
                        </div>
                      )}
                    </div>
                  );
                })}

                {/* زر إضافة صنف آخر للتسليم في الأسفل */}
                <button
                  type="button"
                  onClick={() => setLines((l) => [...l, { itemId: "", bags: 0, kg: 0 }])}
                  className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border border-dashed border-primary/30 bg-primary/[0.04] hover:bg-primary/[0.08] text-xs font-bold text-primary transition-all active:scale-[0.99]"
                >
                  <Plus className="h-4 w-4" />
                  <span>إضافة صنف آخر للتسليم</span>
                </button>
              </div>ed-lg bg-amber-500/10 p-2 text-center text-xs">
                          <span className="block text-[10px] text-amber-700 dark:text-amber-300 font-semibold">
                            المتبقي بعد التسليم:
                          </span>
                          <span className="font-black text-amber-700 dark:text-amber-300">
                            {b ? `${fmtNum(remBags)} كيس` : "—"}
                          </span>
                          <span className="block text-[10px] text-amber-700/80 dark:text-amber-300/80">
                            {b ? `(${fmtNum(remKg)} كجم)` : ""}
                          </span>
                        </div>
                      </div>

                      {/* رسالة التحذير في حال تجاوز الكمية المتاحة */}
                      {isOver && (
                        <div className="flex items-center gap-1.5 rounded-lg bg-rose-500/10 px-2.5 py-1 text-xs font-bold text-rose-600 dark:text-rose-300">
                          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                          <span>
                            تنبيه: الكمية المطلوبة تسليمها أكبر من رصيد العميل المتبقي! الحد الأقصى:{" "}
                            {fmtNum(b.bags_balance)} كيس / {fmtNum(b.kg_balance)} كجم.
                          </span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* بيانات المستلم والسائق والملاحظات */}
              <div className="grid gap-3 sm:grid-cols-2">
                <MillingField label="اسم المستلم أو السائق" hint="اختياري">
                  <MillingInput
                    value={driverName}
                    onChange={(e) => setDriverName(e.target.value)}
                    placeholder="مثال: محمد علي السلمي"
                  />
                </MillingField>

                <MillingField label="رقم المركبة أو لوحة الشاحنة" hint="اختياري">
                  <MillingInput
                    value={vehicleNumber}
                    onChange={(e) => setVehicleNumber(e.target.value)}
                    placeholder="مثال: نقل 4859 / أ ب ج"
                  />
                </MillingField>
              </div>

              <MillingField label="ملاحظات التسليم الإضافية" hint="تظهر في سند التسليم الرسمي">
                <MillingTextarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="مثال: تسليم دفعة أولى من أصل 50 كيساً — الباقي يُسلم غداً…"
                />
              </MillingField>

              {/* زر اعتماد التسليم الكبير */}
              <button
                type="button"
                disabled={!canSubmit || submit.isPending}
                onClick={() => submit.mutate()}
                className="w-full inline-flex items-center justify-center gap-2 rounded-2xl bg-emerald-600 py-3.5 px-4 text-sm font-black text-white shadow-md transition hover:bg-emerald-700 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {submit.isPending ? (
                  <>
                    <RefreshCw className="h-4 w-4 animate-spin" />
                    جارٍ تسجيل الصرف وإصدار سند التسليم…
                  </>
                ) : (
                  <>
                    <Check className="h-5 w-5" />
                    تأكيد التسليم وطباعة سند التسليم المعتمد
                  </>
                )}
              </button>
            </div>
          </MillingPanel>

          {/* العمود الأيسر (5 أعمدة): بطاقة رصيد الأمانات الجاهزة للتسليم */}
          <MillingPanel className="lg:col-span-5 flex flex-col justify-between">
            <div>
              <MillingSectionTitle
                icon={<PackageCheck className="h-4 w-4" />}
                title="أرصدة الأمانات المتاحة"
                subtitle="ما هو مودع باسم العميل في المستودع المختار"
                action={
                  selectedCustomer ? (
                    <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-bold text-emerald-700 dark:text-emerald-300">
                      رصيد معتمد
                    </span>
                  ) : undefined
                }
              />

              <div className="space-y-3 p-4">
                {!customerId || !warehouseId ? (
                  <MillingEmpty
                    title="حدد العميل والمستودع"
                    hint="اختر العميل والمستودع لعرض الأمانات ونواتج الطحن الجاهزة للتسليم."
                  />
                ) : balances.isLoading ? (
                  <div className="flex items-center justify-center py-10 text-xs text-muted-foreground">
                    <RefreshCw className="h-4 w-4 animate-spin me-2" /> جارٍ جلب أرصدة الأمانات…
                  </div>
                ) : available.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-border p-6 text-center space-y-2">
                    <div className="grid h-10 w-10 mx-auto place-items-center rounded-full bg-muted text-muted-foreground">
                      <PackageCheck className="h-5 w-5" />
                    </div>
                    <h5 className="font-bold text-sm text-foreground">لا توجد أمانات متبقية</h5>
                    <p className="text-xs text-muted-foreground">
                      تم تسليم كامل النواتج والحبوب لهذا العميل، أو لم يتم تسجيل طحن بعد.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    {available.map((b) => (
                      <div
                        key={b.item_id}
                        className="rounded-xl border border-border/70 bg-card p-3 shadow-2xs hover:border-emerald-500/40 transition-colors"
                      >
                        <div className="flex items-center justify-between">
                          <div>
                            <span className="font-bold text-xs text-foreground block">
                              {b.name_ar}
                            </span>
                            <span className="text-[11px] text-muted-foreground">
                              {b.item_class === "RAW_MATERIAL" ? "حبوب خام" : "ناتج طحن معبأ"}
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
                )}
              </div>
            </div>

            {/* بطاقة معلومات وسندات التسليم الموحدة في الأسفل */}
            <div className="p-4 border-t border-border/70 bg-muted/20 rounded-b-2xl">
              <div className="flex items-start gap-2.5 text-xs text-muted-foreground">
                <ShieldCheck className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
                <div>
                  <strong className="text-foreground block">سند تسليم رسمي معتمد:</strong>
                  يتم توثيق كل حركة تسليم برقم تسلسلي، مع طباعة ومشاركة تفاصيل الدفعة المسلمة
                  والمتبقي باسم العميل عبر واتساب وPDF فوراً.
                </div>
              </div>
            </div>
          </MillingPanel>
        </div>

        {/* سجل التسليم والصرف: المستندات الموحدة بزاوية المُسلَّم والمتبقي في الأمانة */}
        <MillingDocumentsBoard focus="delivery" title="سجل التسليم والصرف" />

        {/* نافذة المعاينة والطباعة الفاخرة المعتمدة لسند التسليم الموحد */}
        {deliveryPrintDoc && (
          <UnifiedPrintModal
            open={isPrintModalOpen}
            onClose={() => {
              setIsPrintModalOpen(false);
              setDeliveryPrintDoc(null);
            }}
            doc={deliveryPrintDoc}
            stage="delivery"
          />
        )}
      </div>
    </ModuleGuard>
  );
}

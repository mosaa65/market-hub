/**
 * قسم تسويات الأمانات (E5) — الإدخال الموثّق الوحيد لحبوب/نواتج منفصلة.
 *
 * كل تعديل يمر إلزامياً عبر RPC `custody_adjustment` مع **سبب إلزامي**،
 * والمحرك يمنع الرصيد أن ينخفض عن الصفر. لا حركة بلا مصدر في دفتر الأمانات.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { SlidersHorizontal, Plus, Minus, Check, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { custodyAdjustment } from "@/lib/milling/custody";
import {
  MillingPanel,
  MillingSectionTitle,
  MillingField,
  MillingSelect,
  MillingTextarea,
} from "@/components/milling/milling-ui";
import { QuantityInput } from "@/components/ui/quantity-input";
import type { ProductOption } from "@/lib/milling/custody";

const PRESET_REASONS = [
  "تصحيح خطأ إدخال وزن",
  "إعادة حبوب من العميل إضافياً",
  "عجز مكتشف بالجرد",
  "زيادة مكتشفة بالجرد",
  "تسوية فرق تعبئة معتمد من المسؤول",
];

export function CustodyAdjustmentPanel({
  customerId,
  warehouseId,
  items,
}: {
  customerId: string;
  warehouseId: string;
  /** أصناف مؤهلة للتعديل: حبوب خام + نواتج (نمرر قائمتين مدموجتين من الشاشة). */
  items: ProductOption[];
}) {
  const qc = useQueryClient();
  const [itemId, setItemId] = useState("");
  const [bagsDelta, setBagsDelta] = useState("0");
  const [kgDelta, setKgDelta] = useState("0");
  const [reason, setReason] = useState("");

  const adj = useMutation({
    mutationFn: () =>
      custodyAdjustment({
        customerId,
        warehouseId,
        itemId,
        bagsDelta: Number(bagsDelta) || 0,
        kgDelta: Number(kgDelta) || 0,
        reason,
      }),
    onSuccess: (r) => {
      if (!r.ok) return toast.error(r.message);
      toast.success(`تم تسجيل التسوية (${r.id ? "سند " + String(r.id).slice(0, 8) : "موثق"})`);
      setBagsDelta("0");
      setKgDelta("0");
      setReason("");
      void qc.invalidateQueries({ queryKey: ["custody"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "فشل تسجيل التسوية"),
  });

  const direction = (Number(bagsDelta) || 0) > 0 || (Number(kgDelta) || 0) > 0 ? "add" : "sub";
  const valid =
    Boolean(customerId && warehouseId && itemId) &&
    ((Number(bagsDelta) || 0) !== 0 || (Number(kgDelta) || 0) !== 0) &&
    reason.trim().length >= 3;

  return (
    <MillingPanel className="rounded-2xl border border-border/70 bg-card">
      <MillingSectionTitle
        icon={<SlidersHorizontal className="h-4 w-4" />}
        title="تسويات الأمانات (إدخال موثّق)"
        subtitle="إضافة أو خصم حبوب/نواتج منفصلة بسبب إلزامي — تسوية جرد أو تصحيح"
      />
      <div className="grid gap-3 p-4 sm:grid-cols-2">
        <MillingField label="الصنف المُعدَّل *" hint="حبوب خام أو ناتج">
          <MillingSelect value={itemId} onChange={(e) => setItemId(e.target.value)}>
            <option value="">اختر الصنف…</option>
            {items.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name_ar || i.name} ({i.item_class === "RAW_MATERIAL" ? "حبوب" : "ناتج"})
              </option>
            ))}
          </MillingSelect>
        </MillingField>

        <MillingField label="الاتجاه" hint="محدد بإشارة الكميات">
          <div className="flex items-center gap-2 rounded-xl border border-border bg-background px-3 py-2 text-xs">
            {direction === "add" ? (
              <>
                <Plus className="size-4 text-emerald-600" />
                <span className="font-bold text-emerald-600">إضافة إلى أمانة العميل</span>
              </>
            ) : (
              <>
                <Minus className="size-4 text-rose-600" />
                <span className="font-bold text-rose-600">خصم من أمانة العميل</span>
              </>
            )}
          </div>
        </MillingField>

        <MillingField label="فرق الأكياس" hint="موجب = إضافة، سالب = خصم">
          <QuantityInput
            value={bagsDelta === "" ? null : Number(bagsDelta)}
            onValueChange={(v) => setBagsDelta(v == null ? "0" : String(v))}
            decimals={0}
          />
        </MillingField>

        <MillingField label="فرق الكجم" hint="موجب = إضافة، سالب = خصم">
          <QuantityInput
            value={kgDelta === "" ? null : Number(kgDelta)}
            onValueChange={(v) => setKgDelta(v == null ? "0" : String(v))}
            decimals={3}
          />
        </MillingField>

        <MillingField label="سبب التسوية (إلزامي) *" hint="سطر توثيق يظهر في سند CA-…">
          <MillingTextarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            placeholder="مثال: عجز مكتشف بالجرد — 2 كجم"
          />
        </MillingField>

        <div className="flex flex-wrap items-end gap-1.5">
          {PRESET_REASONS.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setReason(r)}
              className="rounded-full border border-border px-2.5 py-1 text-[11px] text-muted-foreground transition hover:border-amber-500/50 hover:text-foreground"
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-border/60 p-3">
        <div className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-500" />
          كل تسوية تُنشئ سند CA-… مرقّماً وتُقيَّد في سجل التدقيق — لا تُعدَّل الأرصدة يدوياً.
        </div>
        <button
          type="button"
          disabled={!valid || adj.isPending}
          onClick={() => adj.mutate()}
          className="inline-flex items-center gap-1.5 rounded-xl bg-amber-500 px-4 py-2 text-xs font-black text-white shadow-sm transition hover:bg-amber-600 disabled:opacity-40"
        >
          {adj.isPending ? (
            <Check className="size-4 animate-pulse" />
          ) : (
            <Check className="size-4" />
          )}
          تسجيل التسوية
        </button>
      </div>
    </MillingPanel>
  );
}

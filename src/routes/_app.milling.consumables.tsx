/**
 * /milling/consumables — فاتورة صرف مستهلكات داخلي (خطوة 7 — ق4).
 *
 * تُصرف الأكياس/الخيط/الزيت من مخزن المستهلكات بحركة مخزون حقيقية، فلا يبقى
 * رصيد وهمي في النظام بعد أن نُفدت في الواقع.
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { PackageMinus, Plus, Trash2, ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
import { ModuleGuard } from "@/lib/modules";
import { supabase } from "@/integrations/supabase/client";
import { consumeInternalSupplies, fetchConsumableItems, type ProductOption } from "@/lib/milling";
import { translateRpcError } from "@/lib/errors/rpc-errors";
import {
  MillingPanel,
  MillingSectionTitle,
  MillingField,
  MillingSelect,
  MillingTextarea,
  fmtNum,
} from "@/components/milling/milling-ui";
import { QuantityInput } from "@/components/ui/quantity-input";

export const Route = createFileRoute("/_app/milling/consumables")({
  head: () => ({ meta: [{ title: "صرف مستهلكات داخلي — فورتكس ERP" }] }),
  component: ConsumablesPage,
});

interface WarehouseOption {
  id: string;
  name_ar: string | null;
  name: string;
  is_default: boolean | null;
}

interface IssueLine {
  itemId: string;
  qty: string;
}

function ConsumablesPage() {
  const qc = useQueryClient();
  const [warehouseId, setWarehouseId] = useState("");
  const [lines, setLines] = useState<IssueLine[]>([{ itemId: "", qty: "" }]);
  const [notes, setNotes] = useState("");

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

  /* المستودع الافتراضي يُحدد تلقائياً — لا يختاره المستخدم كل مرة (المصدر: warehouses.is_default). */
  useEffect(() => {
    if (warehouseId) return;
    const list = warehouses.data ?? [];
    const preferred = list.find((w) => w.is_default) ?? list[0];
    if (preferred) setWarehouseId(preferred.id);
  }, [warehouses.data, warehouseId]);

  const consumables = useQuery({
    queryKey: ["milling", "consumable-items"],
    queryFn: fetchConsumableItems,
  });

  const submit = useMutation({
    mutationFn: () =>
      consumeInternalSupplies({
        warehouseId,
        lines: lines.map((l) => ({ itemId: l.itemId, qty: Number(l.qty) || 0 })),
        notes: notes || undefined,
      }),
    onSuccess: (res) => {
      if (!res.ok) {
        toast.error(res.message || "تعذر تنفيذ الصرف.");
        return;
      }
      toast.success(`تم الصرف — مستند ${res.data ?? ""}`);
      setLines([{ itemId: "", qty: "" }]);
      setNotes("");
      void qc.invalidateQueries({ queryKey: ["milling"] });
    },
    // P1-4: كل خطأ RPC يمر بطبقة الترجمة الموحدة قبل العرض.
    onError: (err) => toast.error(translateRpcError(err, "ar", "تعذر تنفيذ الصرف.")),
  });

  const canSubmit = Boolean(warehouseId && lines.some((l) => l.itemId && Number(l.qty) > 0));

  return (
    <ModuleGuard moduleId="milling_operations">
      <div className="mx-auto max-w-4xl space-y-4 p-4">
        <PageHeader
          title="صرف مستهلكات داخلي"
          subtitle="أكياس وخيط وزيت تُصرف من مخزن المستهلكات — الكمية تُنقص من المخزون بدقة."
          actions={
            <Link
              to="/milling/manufacture"
              className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-surface-1 px-3 py-2 text-xs font-bold text-foreground hover:bg-muted"
            >
              التصنيع الذكي <ArrowLeft className="h-3.5 w-3.5" />
            </Link>
          }
        />

        <MillingPanel>
          <MillingSectionTitle
            icon={<PackageMinus className="h-4 w-4" />}
            title="مستند الصرف"
            subtitle="سطر لكل مستهلك يُصرف — المحرك يرفض لو المخزون لا يكفي"
          />
          <div className="space-y-4 p-4">
            <MillingField label="المخزن *">
              <MillingSelect value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
                <option value="">اختر المخزن…</option>
                {(warehouses.data ?? []).map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name_ar || w.name}
                  </option>
                ))}
              </MillingSelect>
            </MillingField>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-muted-foreground">
                  المستهلكات المصروفة
                </label>
                <button
                  type="button"
                  onClick={() => setLines((l) => [...l, { itemId: "", qty: "" }])}
                  className="inline-flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-[11px] font-bold text-foreground hover:bg-muted"
                >
                  <Plus className="h-3 w-3" /> سطر آخر
                </button>
              </div>
              {lines.map((line, idx) => (
                <div key={idx} className="grid grid-cols-[1fr_110px_36px] items-center gap-2">
                  <MillingSelect
                    value={line.itemId}
                    onChange={(e) =>
                      setLines((l) =>
                        l.map((x, i) => (i === idx ? { ...x, itemId: e.target.value } : x)),
                      )
                    }
                  >
                    <option value="">اختر المستهلك…</option>
                    {(consumables.data ?? []).map((p: ProductOption) => (
                      <option key={p.id} value={p.id}>
                        {p.name_ar || p.name}
                      </option>
                    ))}
                  </MillingSelect>
                  <QuantityInput
                    decimals={3}
                    min={0}
                    emptyAsZero
                    placeholder="الكمية"
                    aria-label="الكمية"
                    value={line.qty ? Number(line.qty) : null}
                    onValueChange={(v) =>
                      setLines((l) =>
                        l.map((x, i) =>
                          i === idx ? { ...x, qty: v == null ? "" : String(v) } : x,
                        ),
                      )
                    }
                  />
                  <button
                    type="button"
                    disabled={lines.length === 1}
                    onClick={() => setLines((l) => l.filter((_, i) => i !== idx))}
                    className="grid h-9 w-9 place-items-center rounded-lg text-rose-500 hover:bg-rose-500/10 disabled:opacity-30"
                    aria-label="حذف السطر"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>

            <MillingField label="ملاحظات" hint="اختيارية — سبب الصرف أو العملية المرتبطة.">
              <MillingTextarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="مثال: 160 كيس لتعبئة دفعة طحن"
              />
            </MillingField>

            <button
              type="button"
              disabled={!canSubmit || submit.isPending}
              onClick={() => submit.mutate()}
              className="w-full rounded-xl bg-amber-500 px-4 py-2.5 text-sm font-bold text-white shadow-xs transition hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submit.isPending ? "جارٍ التنفيذ…" : "تنفيذ الصرف"}
            </button>
          </div>
        </MillingPanel>
      </div>
    </ModuleGuard>
  );
}

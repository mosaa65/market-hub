/**
 * /milling/manufacture — التحويل الداخلي (تحويل مخزون بعدّ المنتجات).
 *
 * النموذج المعتمد من المالك (rebuild-plan-v2-product-count.md):
 *   • كل منتج وحدة عدّ مستقلة — «دقيق أبيض كيس 50 كجم» منتج، و«كيس 25» منتج منفصل.
 *   • الكمية في كل حقل = عدد من وحدة المنتج. لا كجم ولا سعات ولا نسب في أي عملية.
 *   • التحويل: منتج مصدر × كمية → نواتج (منتج × كمية) + فاقد اختياري بوحدات.
 *   • الشرط الوحيد: النواتج + الفاقد = كمية المصدر.
 *   • لا توزيع تكلفة ولا هوامش ولا قيود — سعر وتكلفة كل منتج ثابتة يدوياً.
 *   • مستلزمات التعبئة مصروفات فقط — لا صرف مستهلكات من هنا.
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeftRight,
  ArrowLeft,
  Plus,
  Trash2,
  Info,
  Package,
  AlertTriangle,
  CheckCircle2,
  Warehouse as WarehouseIcon,
} from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
import { ModuleGuard } from "@/lib/modules";
import { supabase } from "@/integrations/supabase/client";
import { translateRpcError } from "@/lib/errors/rpc-errors";
import { convertStock } from "@/lib/milling/custody";
import type { ProductOption } from "@/lib/milling/custody";
import {
  MillingPanel,
  MillingSectionTitle,
  MillingField,
  MillingSelect,
  MillingTextarea,
  Mono,
  fmtNum,
} from "@/components/milling/milling-ui";
import { QuantityInput } from "@/components/ui/quantity-input";

export const Route = createFileRoute("/_app/milling/manufacture")({
  head: () => ({ meta: [{ title: "التحويل الداخلي — تحويل المخزون بعدّ المنتجات — فورتكس ERP" }] }),
  component: StockConversionPage,
});

interface WarehouseOption {
  id: string;
  name_ar: string | null;
  name: string;
  is_default: boolean | null;
}

interface OutputLine {
  itemId: string;
  qty: string;
}

export function StockConversionPage() {
  const qc = useQueryClient();
  const [warehouseId, setWarehouseId] = useState("");
  const [sourceItemId, setSourceItemId] = useState("");
  const [sourceQty, setSourceQty] = useState<string>("");
  const [lossQty, setLossQty] = useState<string>("0");
  const [batchRef, setBatchRef] = useState("");
  const [notes, setNotes] = useState("");
  const [outputs, setOutputs] = useState<OutputLine[]>([{ itemId: "", qty: "" }]);

  // المستودعات
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

  useEffect(() => {
    if (warehouseId) return;
    const list = warehouses.data ?? [];
    const preferred = list.find((w) => w.is_default) ?? list[0];
    if (preferred) setWarehouseId(preferred.id);
  }, [warehouses.data, warehouseId]);

  // كل المنتجات النشطة: أي منتج يمكن أن يكون مصدراً أو ناتجاً
  const allProducts = useQuery({
    queryKey: ["milling", "all-products"],
    queryFn: async (): Promise<ProductOption[]> => {
      const { data, error } = await supabase
        .from("products")
        .select("id, sku, name, name_ar, item_class, sale_price, cost_price, package_weight_kg")
        .eq("is_active", true)
        .order("item_class")
        .order("name_ar");
      if (error) throw error;
      return (data ?? []) as unknown as ProductOption[];
    },
  });

  const selectedSource = allProducts.data?.find((p) => p.id === sourceItemId);

  // الرصيد المخزني المتاح للمصدر في المستودع المختار (بوحدة المنتج)
  const sourceStockQuery = useQuery({
    queryKey: ["milling", "source-stock", warehouseId, sourceItemId],
    queryFn: async () => {
      if (!warehouseId || !sourceItemId) return 0;
      const { data, error } = await supabase
        .from("inventory")
        .select("quantity")
        .eq("warehouse_id", warehouseId)
        .eq("product_id", sourceItemId)
        .maybeSingle();
      if (error) return 0;
      return Number(data?.quantity ?? 0);
    },
    enabled: Boolean(warehouseId && sourceItemId),
  });

  const availableStock = sourceStockQuery.data ?? 0;
  const numSourceQty = Number(sourceQty) || 0;
  const numLossQty = Number(lossQty) || 0;
  const isOverStock = numSourceQty > availableStock;

  const totalOutputQty = useMemo(
    () => outputs.reduce((sum, l) => sum + (Number(l.qty) || 0), 0),
    [outputs],
  );

  /**
   * القاعدة الوحيدة (قرار المالك): النواتج + الفاقد = كمية المصدر.
   * الفاقد اختياري — يعبّر عن الفرق فقط، بوحدات، بلا أي حساب كجم.
   */
  const remainder = numSourceQty - totalOutputQty - numLossQty;
  const isBalanced = remainder === 0;
  const outputsValid =
    outputs.length > 0 && outputs.every((l) => l.itemId && (Number(l.qty) || 0) > 0);

  const submit = useMutation({
    mutationFn: () => {
      const fullNotes = [
        batchRef ? `تشغيلة: ${batchRef.trim()}` : "",
        numLossQty > 0 ? `فاقد: ${numLossQty} وحدة` : "",
        notes ? notes.trim() : "",
      ]
        .filter(Boolean)
        .join(" — ");

      return convertStock({
        warehouseId,
        sourceItemId,
        sourceQty: numSourceQty,
        outputs: outputs.map((l) => ({ itemId: l.itemId, qty: Number(l.qty) || 0 })),
        lossQty: numLossQty,
        notes: fullNotes || undefined,
      });
    },
    onSuccess: (res) => {
      if (!res.ok) {
        toast.error(res.message || "تعذر تنفيذ التحويل.");
        return;
      }
      toast.success(`تم التحويل بنجاح — مستند ${res.data ?? ""}`);
      setSourceQty("");
      setLossQty("0");
      setBatchRef("");
      setOutputs([{ itemId: "", qty: "" }]);
      setNotes("");
      void qc.invalidateQueries({ queryKey: ["milling"] });
      void qc.invalidateQueries({ queryKey: ["inventory"] });
    },
    onError: (err) => toast.error(translateRpcError(err, "ar", "تعذر تنفيذ التحويل.")),
  });

  const canSubmit = Boolean(
    warehouseId && sourceItemId && numSourceQty > 0 && !isOverStock && isBalanced && outputsValid,
  );

  const unitName = (p?: ProductOption | null) =>
    p ? `(${p.sku || "—"}${p.package_weight_kg ? ` · ${p.package_weight_kg} كجم` : ""})` : "";

  return (
    <ModuleGuard moduleId="milling_operations">
      <div className="mx-auto max-w-5xl space-y-5 p-3 sm:p-5">
        <PageHeader
          title="التحويل الداخلي — تحويل المخزون بعدّ المنتجات"
          subtitle="منتج مصدر × كمية ← منتجات ناتجة × كميات، مع فاقد اختياري بوحدات. لا نسب ولا أوزان ولا تسعير."
          actions={
            <Link
              to="/milling/milling"
              className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-surface px-3 py-2 text-xs font-bold text-foreground transition hover:bg-muted"
            >
              خدمة طحن الغير <ArrowLeft className="h-3.5 w-3.5" />
            </Link>
          }
        />

        {/* إيضاح النموذج المعتمد */}
        <div className="flex items-start gap-2.5 rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-3.5 text-xs font-medium text-emerald-800 dark:text-emerald-200">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
          <p className="leading-relaxed">
            <strong>عدّ المنتجات:</strong> كل منتج وحدة مستقلة — الكمية تعني «عدد من هذا المنتج»
            أياً كانت وحدته (كيس، لتر، حبة، كرتون). الوحدة وسعة العبوة تفاصيل وصفية فقط. لا يوجد أي
            تسعير أو هامش بعد التحويل — سعر كل منتج ثابت. مستلزمات التعبئة تسجل كمصروفات، لا من هنا.
          </p>
        </div>

        {/* ─── اللوحة الأولى: المصدر والمستودع ─── */}
        <MillingPanel>
          <MillingSectionTitle
            icon={<WarehouseIcon className="h-4 w-4 text-amber-500" />}
            title="1. منتج المصدر والمستودع"
            subtitle="حدد المستودع والمنتج المُحوَّل وكميته بعدّ الوحدات"
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

              <MillingField label="منتج المصدر *">
                <MillingSelect
                  value={sourceItemId}
                  onChange={(e) => setSourceItemId(e.target.value)}
                >
                  <option value="">اختر المنتج…</option>
                  {(allProducts.data ?? []).map((p: ProductOption) => (
                    <option key={p.id} value={p.id}>
                      {p.name_ar || p.name} {unitName(p)}
                    </option>
                  ))}
                </MillingSelect>
              </MillingField>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <MillingField label="الكمية المُحوَّلة (عدد الوحدات) *">
                <QuantityInput
                  value={sourceQty === "" ? null : Number(sourceQty)}
                  onValueChange={(v) => setSourceQty(v == null ? "" : String(v))}
                  decimals={0}
                  unit="وحدة"
                />
              </MillingField>

              <MillingField label="مرجع التشغيلة" hint="اختياري">
                <MillingTextarea
                  value={batchRef}
                  onChange={(e) => setBatchRef(e.target.value)}
                  rows={1}
                  placeholder="مثال: تشغيلة صباحية"
                />
              </MillingField>
            </div>

            {/* شريط الرصيد الفعلي بوحدة المنتج */}
            {sourceItemId && warehouseId && (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border/70 bg-surface/80 p-3 text-xs">
                <div className="flex flex-wrap items-center gap-2">
                  <Package className="h-4 w-4 text-muted-foreground" />
                  <span>
                    الرصيد المتاح:{" "}
                    <strong className={availableStock > 0 ? "text-foreground" : "text-rose-500"}>
                      <Mono>{fmtNum(availableStock)}</Mono> وحدة
                    </strong>
                  </span>
                  {selectedSource?.cost_price ? (
                    <span className="text-muted-foreground">
                      · تكلفة الوحدة (ثابتة يدوياً):{" "}
                      <Mono>{fmtNum(selectedSource.cost_price)}</Mono>
                    </span>
                  ) : null}
                </div>
                {availableStock > 0 && (
                  <button
                    type="button"
                    onClick={() => setSourceQty(String(Math.floor(availableStock)))}
                    className="rounded-lg border border-border bg-surface px-2.5 py-1 text-[11px] font-bold text-primary transition hover:bg-muted active:scale-95"
                  >
                    تعبئة كامل الرصيد المتاح
                  </button>
                )}
              </div>
            )}

            {isOverStock && (
              <div className="flex items-center gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs font-semibold text-rose-700 dark:text-rose-300">
                <AlertTriangle className="h-4 w-4 shrink-0 text-rose-500" />
                <span>
                  تنبيه: الكمية المطلوبة (<Mono>{fmtNum(numSourceQty)}</Mono> وحدة) أكبر من الرصيد
                  المتاح (<Mono>{fmtNum(availableStock)}</Mono> وحدة)!
                </span>
              </div>
            )}
          </div>
        </MillingPanel>

        {/* ─── اللوحة الثانية: النواتج والفاقد ─── */}
        <MillingPanel>
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/70 p-4">
            <MillingSectionTitle
              icon={<ArrowLeftRight className="h-4 w-4 text-emerald-500" />}
              title="2. المنتجات الناتجة والفاقد"
              subtitle="أضف أي منتجات ناتجة بكمياتها (عدد الوحدات) — والفاقد اختياري يغطي الفرق"
            />
            <button
              type="button"
              onClick={() => setOutputs((o) => [...o, { itemId: "", qty: "" }])}
              className="inline-flex items-center gap-1.5 rounded-xl border border-primary/30 bg-primary/10 px-3 py-1.5 text-xs font-bold text-primary transition hover:bg-primary/20 active:scale-95"
            >
              <Plus className="h-3.5 w-3.5" /> إضافة سطر ناتج
            </button>
          </div>

          <div className="space-y-3.5 p-4 sm:p-5">
            {outputs.map((line, idx) => (
              <div
                key={idx}
                className="rounded-2xl border border-border/80 bg-surface/50 p-3 sm:p-4 transition hover:border-border"
              >
                <div className="grid gap-3 sm:grid-cols-[1.5fr_1fr_40px] items-start">
                  <MillingField label="منتج الناتج *">
                    <MillingSelect
                      value={line.itemId}
                      onChange={(e) =>
                        setOutputs((o) =>
                          o.map((l, i) => (i === idx ? { ...l, itemId: e.target.value } : l)),
                        )
                      }
                    >
                      <option value="">اختر المنتج…</option>
                      {(allProducts.data ?? []).map((p: ProductOption) => (
                        <option key={p.id} value={p.id}>
                          {p.name_ar || p.name} {unitName(p)}
                        </option>
                      ))}
                    </MillingSelect>
                  </MillingField>

                  <MillingField label="الكمية (عدد الوحدات) *">
                    <QuantityInput
                      value={line.qty === "" ? null : Number(line.qty)}
                      onValueChange={(v) =>
                        setOutputs((o) =>
                          o.map((l, i) =>
                            i === idx ? { ...l, qty: v == null ? "" : String(v) } : l,
                          ),
                        )
                      }
                      decimals={0}
                      unit="وحدة"
                    />
                  </MillingField>

                  <button
                    type="button"
                    onClick={() => setOutputs((o) => o.filter((_, i) => i !== idx))}
                    disabled={outputs.length === 1}
                    className="mt-6 grid h-9 w-9 place-items-center rounded-xl border border-rose-500/30 bg-rose-500/10 text-rose-600 transition hover:bg-rose-500/20 disabled:opacity-30"
                    title="حذف السطر"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}

            {/* الفاقد الاختياري + لوحة التوازن */}
            <div className="grid gap-4 sm:grid-cols-2">
              <MillingField label="الفاقد (اختياري)" hint="عدد الوحدات التي تختفي — يمثل الفرق">
                <QuantityInput
                  value={lossQty === "" ? null : numLossQty}
                  onValueChange={(v) => setLossQty(v == null ? "0" : String(v))}
                  decimals={0}
                  unit="وحدة"
                />
              </MillingField>

              <div className="rounded-xl border border-border/80 bg-background/80 p-3 text-xs space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">مجموع النواتج:</span>
                  <span className="font-bold">
                    <Mono>{fmtNum(totalOutputQty)}</Mono> وحدة
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">الفرق المتبقي من المصدر:</span>
                  <span
                    className={
                      isBalanced
                        ? "font-bold text-emerald-600 dark:text-emerald-400"
                        : "font-bold text-amber-600 dark:text-amber-400"
                    }
                  >
                    <Mono>{fmtNum(Math.abs(remainder))}</Mono> وحدة
                    {remainder > 0
                      ? " (أضفها كفاقد أو ناتج)"
                      : remainder < 0
                        ? " (تجاوز المصدر!)"
                        : " ✓"}
                  </span>
                </div>
                {isBalanced && numSourceQty > 0 && (
                  <div className="flex items-center gap-1.5 border-t border-border/60 pt-1 font-bold text-emerald-600 dark:text-emerald-400">
                    <CheckCircle2 className="h-4 w-4" />
                    <span>
                      ✓ متوازن: {fmtNum(totalOutputQty)} + {fmtNum(numLossQty)} ={" "}
                      {fmtNum(numSourceQty)}
                    </span>
                  </div>
                )}
              </div>
            </div>

            <MillingField label="ملاحظات التحويل" hint="اختيارية">
              <MillingTextarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="مثال: تحويل دفعة الصباح — آلة رقم 2"
              />
            </MillingField>
          </div>
        </MillingPanel>

        {/* زر التنفيذ */}
        <div className="sticky bottom-4 z-10">
          <button
            type="button"
            disabled={!canSubmit || submit.isPending}
            onClick={() => submit.mutate()}
            className="w-full inline-flex items-center justify-center gap-2 rounded-2xl bg-emerald-600 py-3.5 px-4 text-sm font-black text-white shadow-lg transition hover:bg-emerald-700 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submit.isPending ? (
              "جارٍ تنفيذ التحويل…"
            ) : (
              <>
                <CheckCircle2 className="h-5 w-5" />
                تنفيذ التحويل وتحديث المخزون
              </>
            )}
          </button>
        </div>
      </div>
    </ModuleGuard>
  );
}

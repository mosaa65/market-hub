import React, { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import {
  PackagePlus,
  Plus,
  Pencil,
  Search,
  Check,
  Copy,
  Boxes,
  Tag,
  DollarSign,
  TrendingUp,
} from "lucide-react";
import { toast } from "sonner";
import { VortexDrawerDialog } from "@/components/vortex-ui";
import { AmountInput } from "@/components/ui/amount-input";
import { QuantityInput } from "@/components/ui/quantity-input";

const db = supabase as any;

export interface PackagingBagItem {
  id: string;
  sku: string;
  name: string | null;
  name_ar: string;
  sale_price: number;
  cost_price: number;
  is_active: boolean;
  unit_id: string | null;
  /** سعة العبوة بالكيلوجرام (مثال: كيس 50 كجم) — مصدرها هنا فقط. */
  package_weight_kg: number | null;
  unit?: { id: string; name: string; name_ar: string | null; short_name: string } | null;
}

interface UnitOption {
  id: string;
  name: string;
  name_ar: string | null;
  short_name: string;
}

export function PackagingBagsCatalogView() {
  const { lang } = useI18n();
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<PackagingBagItem | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Form states
  const [formNameAr, setFormNameAr] = useState("");
  const [formSku, setFormSku] = useState("");
  const [formSalePrice, setFormSalePrice] = useState(500);
  const [formCostPrice, setFormCostPrice] = useState(350);
  const [formIsActive, setFormIsActive] = useState(true);
  const [formUnitId, setFormUnitId] = useState("");
  const [formWeightKg, setFormWeightKg] = useState("");

  // A packaging item is a real stock item: without a unit its balance has no
  // meaning, and the form used to allow saving one anyway.
  const { data: units = [] } = useQuery({
    queryKey: ["catalog", "units"],
    queryFn: async () => {
      const { data, error } = await db
        .from("units")
        .select("id, name, name_ar, short_name")
        .order("name_ar");
      if (error) throw error;
      return (data || []) as UnitOption[];
    },
  });

  // Fetch packaging items from products table
  const { data: bags = [], isLoading } = useQuery({
    queryKey: ["catalog", "packaging-bags"],
    queryFn: async () => {
      const { data, error } = await db
        .from("products")
        .select(
          "id, sku, name, name_ar, sale_price, cost_price, is_active, unit_id, package_weight_kg, unit:units!products_unit_id_fkey(id, name, name_ar, short_name)",
        )
        .ilike("sku", "PKG-%")
        .order("sku");
      if (error) throw error;
      return (data || []) as PackagingBagItem[];
    },
  });

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return bags;
    return bags.filter((b) =>
      [b.name_ar, b.sku, b.name].some((v) => (v ?? "").toLowerCase().includes(s)),
    );
  }, [bags, q]);

  // The metrics below used to be hard-coded numbers ("+150 ر.ي (30%)") that had
  // nothing to do with the items on screen. They are computed now, so the card
  // answers what the packaging actually costs instead of asserting a figure the
  // user never entered.
  const metrics = useMemo(() => {
    const priced = bags.filter((b) => Number(b.sale_price) > 0);
    const sack = bags.find((b) => b.sku === "PKG-BAG-50");
    const avgMargin = priced.length
      ? priced.reduce((sum, b) => sum + (Number(b.sale_price) - Number(b.cost_price)), 0) /
        priced.length
      : 0;
    const avgPct = priced.length
      ? priced.reduce(
          (sum, b) =>
            sum +
            (Number(b.sale_price) ? (1 - Number(b.cost_price) / Number(b.sale_price)) * 100 : 0),
          0,
        ) / priced.length
      : 0;
    return { sackPrice: sack ? Number(sack.sale_price) : null, avgMargin, avgPct };
  }, [bags]);

  const handleEdit = (b: PackagingBagItem) => {
    setEditing(b);
    setFormNameAr(b.name_ar || b.name || "");
    setFormSku(b.sku);
    setFormSalePrice(Number(b.sale_price) || 0);
    setFormCostPrice(Number(b.cost_price) || 0);
    setFormIsActive(b.is_active);
    setFormUnitId(b.unit_id ?? "");
    setFormWeightKg(b.package_weight_kg != null ? String(b.package_weight_kg) : "");
    setDialogOpen(true);
  };

  const handleCreate = () => {
    setEditing(null);
    setFormNameAr("");
    setFormSku("PKG-");
    setFormSalePrice(500);
    setFormCostPrice(350);
    setFormIsActive(true);
    // كيس جديد؛ وحدة القياس مطلوبة، لذا نُعِدّ أول وحدة.
    setFormUnitId(units[0]?.id ?? "");
    setFormWeightKg("");
    setDialogOpen(true);
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!formNameAr.trim()) throw new Error("اسم المستلزم مطلوب");
      if (!formSku.trim()) throw new Error("كود الصنف (SKU) مطلوب");
      if (!formUnitId) throw new Error("وحدة القياس مطلوبة — بدونها لا معنى لرصيد المخزون");

      // Find category for packaging
      const { data: cat } = await db
        .from("categories")
        .select("id")
        .ilike("name_ar", "%تعبئة%")
        .maybeSingle();

      const payload = {
        name_ar: formNameAr.trim(),
        // The English name is left empty on purpose: writing the Arabic into
        // it is what made every item list its name twice.
        name: null,
        sku: formSku.trim().toUpperCase(),
        sale_price: formSalePrice,
        cost_price: formCostPrice,
        is_active: formIsActive,
        category_id: cat?.id || null,
        unit_id: formUnitId,
        // سعة العبوة الرسمية بالكجم — تُستخدم في الطحن لاحتساب الوزن الإجمالي
        // تلقائياً (أكياس × السعة)، ولا تُدخل في أي مكان آخر.
        package_weight_kg:
          formWeightKg.trim() !== "" && Number(formWeightKg) > 0 ? Number(formWeightKg) : null,
        // مادة تعبئة مخزنية (المواصفة §8): تُشترى وتُخزَّن وتُستهلك، لكنها
        // ليست منتجاً نهائياً للبيع في نقاط البيع. NON_STOCK_ITEM كان يوهم
        // النظام بأنها تُستهلك بلا رصيد — والرصيد الحقيقي موجود للمخزون.
        item_class: "PACKAGING",
        is_sellable: false,
        is_purchasable: true,
      };

      if (editing) {
        const { error } = await db.from("products").update(payload).eq("id", editing.id);
        if (error) throw error;
      } else {
        const { error } = await db.from("products").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success(editing ? "تم تعديل المستلزم بنجاح" : "تمت إضافة المستلزم بنجاح");
      setDialogOpen(false);
      qc.invalidateQueries({ queryKey: ["catalog", "packaging-bags"] });
      qc.invalidateQueries({ queryKey: ["milling"] });
      qc.invalidateQueries({ queryKey: ["products"] });
    },
    onError: (err: any) => {
      toast.error(err.message || "فشل الحفظ");
    },
  });

  const copyText = (val: string, id: string) => {
    navigator.clipboard.writeText(val);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1500);
  };

  return (
    <div className="space-y-5">
      {/* Search and Action */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative max-w-sm flex-1">
          <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="بحث في المستلزمات، كود الصنف، السعر..."
            className="w-full rounded-2xl border border-border bg-card pr-9 pl-4 py-2.5 text-xs focus:ring-2 focus:ring-primary/20"
          />
        </div>

        <button
          type="button"
          onClick={handleCreate}
          className="inline-flex items-center gap-2 rounded-2xl bg-primary hover:bg-primary/90 px-4 py-2.5 text-xs font-bold text-primary-foreground shadow-md transition active:scale-95"
        >
          <Plus className="h-4 w-4" />
          <span>إضافة مستلزم تعبئة جديد</span>
        </button>
      </div>

      {/* Metric Cards */}
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-border/70 bg-card p-4 shadow-2xs">
          <div className="flex items-center gap-3">
            <span className="p-2.5 rounded-xl bg-primary/10 text-primary">
              <PackagePlus className="h-5 w-5" />
            </span>
            <div>
              <p className="text-[11px] font-medium text-muted-foreground">
                عدد المستلزمات المسجلة
              </p>
              <p className="text-xl font-black text-foreground">{bags.length}</p>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-border/70 bg-card p-4 shadow-2xs">
          <div className="flex items-center gap-3">
            <span className="p-2.5 rounded-xl bg-amber-500/10 text-amber-600">
              <DollarSign className="h-5 w-5" />
            </span>
            <div>
              <p className="text-[11px] font-medium text-muted-foreground">سعر الشوال (50 كجم)</p>
              <p className="text-xl font-black font-mono text-foreground">
                {metrics.sackPrice != null
                  ? `${metrics.sackPrice.toLocaleString()} ر.ي`
                  : lang === "ar"
                    ? "غير مسجّل"
                    : "not set"}
              </p>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-border/70 bg-card p-4 shadow-2xs">
          <div className="flex items-center gap-3">
            <span className="p-2.5 rounded-xl bg-emerald-500/10 text-emerald-600">
              <TrendingUp className="h-5 w-5" />
            </span>
            <div>
              <p className="text-[11px] font-medium text-muted-foreground">متوسط هامش الربح</p>
              <p className="text-xl font-black font-mono text-emerald-600">
                {`+${Math.round(metrics.avgMargin).toLocaleString()} ر.ي (${Math.round(metrics.avgPct)}%)`}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-right text-xs">
            <thead>
              <tr className="border-b border-border bg-muted/40 font-bold text-muted-foreground">
                <th className="px-4 py-3.5">المستلزم</th>
                <th className="px-4 py-3.5">كود الصنف (SKU)</th>
                <th className="px-4 py-3.5">الوحدة</th>
                <th className="px-4 py-3.5">سعة العبوة (كجم)</th>
                <th className="px-4 py-3.5">سعر البيع للزبون</th>
                <th className="px-4 py-3.5">سعر التكلفة</th>
                <th className="px-4 py-3.5">هامش الربح</th>
                <th className="px-4 py-3.5">الحالة</th>
                <th className="px-4 py-3.5 text-center">الإجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {isLoading && (
                <tr>
                  <td colSpan={9} className="px-4 py-12 text-center text-muted-foreground">
                    جارٍ التحميل...
                  </td>
                </tr>
              )}

              {!isLoading && filtered.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-12 text-center text-muted-foreground">
                    لا توجد مستلزمات مسجلة.
                  </td>
                </tr>
              )}

              {filtered.map((b) => {
                const margin = Math.max(0, Number(b.sale_price || 0) - Number(b.cost_price || 0));
                return (
                  <tr key={b.id} className="transition-colors hover:bg-muted/30">
                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-3">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary font-bold">
                          <PackagePlus className="h-4 w-4" />
                        </div>
                        <span className="font-bold text-foreground">{b.name_ar || b.name}</span>
                      </div>
                    </td>

                    <td className="px-4 py-3.5">
                      <span className="inline-flex rounded-lg border border-border/80 bg-muted/50 px-2 py-0.5 font-mono text-[11px] font-bold text-foreground">
                        {b.sku}
                      </span>
                    </td>

                    <td className="px-4 py-3.5">
                      <span className="inline-flex items-center gap-1 rounded-lg border border-border/80 bg-muted/50 px-2 py-0.5 text-[11px] font-bold text-foreground">
                        {b.unit?.short_name || <span className="text-amber-600">غير محدّدة</span>}
                      </span>
                    </td>

                    <td className="px-4 py-3.5">
                      {b.package_weight_kg ? (
                        <span className="inline-flex rounded-lg border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 font-mono text-[11px] font-bold text-amber-600">
                          {b.package_weight_kg} كجم
                        </span>
                      ) : (
                        <span className="text-[11px] text-muted-foreground">—</span>
                      )}
                    </td>

                    <td className="px-4 py-3.5 font-bold font-mono text-foreground">
                      {Number(b.sale_price).toLocaleString()} ر.ي
                    </td>

                    <td className="px-4 py-3.5 font-mono text-muted-foreground">
                      {Number(b.cost_price).toLocaleString()} ر.ي
                    </td>

                    <td className="px-4 py-3.5 font-mono text-emerald-600 font-bold">
                      +{margin.toLocaleString()} ر.ي
                    </td>

                    <td className="px-4 py-3.5">
                      {b.is_active ? (
                        <span className="inline-flex items-center gap-1 text-emerald-600 font-bold text-[11px]">
                          <Check className="h-3 w-3" /> نشط
                        </span>
                      ) : (
                        <span className="text-muted-foreground text-[11px]">معطل</span>
                      )}
                    </td>

                    <td className="px-4 py-3.5 text-center">
                      <div className="inline-flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => copyText(b.name_ar || b.name || "", b.id)}
                          className="grid h-8 w-8 place-items-center rounded-xl border border-border bg-card text-muted-foreground hover:bg-muted"
                          title="نسخ الاسم"
                        >
                          {copiedId === b.id ? (
                            <Check className="h-3.5 w-3.5 text-emerald-500" />
                          ) : (
                            <Copy className="h-3.5 w-3.5" />
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleEdit(b)}
                          className="grid h-8 w-8 place-items-center rounded-xl border border-border bg-card text-muted-foreground hover:bg-muted"
                          title="تعديل السعر والمواصفات"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Edit Dialog */}
      <VortexDrawerDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        title={editing ? "تعديل مستلزم تعبئة" : "إضافة مستلزم تعبئة"}
      >
        <div className="space-y-4 p-4 text-xs">
          <div className="space-y-1.5">
            <label className="font-bold text-foreground">اسم المستلزم بالعربية *</label>
            <input
              type="text"
              value={formNameAr}
              onChange={(e) => setFormNameAr(e.target.value)}
              placeholder="مثال: كيس تعبئة 50 كجم"
              className="w-full rounded-xl border border-border bg-background px-3 py-2"
            />
          </div>

          <div className="space-y-1.5">
            <label className="font-bold text-foreground">كود الصنف (SKU) *</label>
            <input
              type="text"
              value={formSku}
              onChange={(e) => setFormSku(e.target.value)}
              placeholder="مثال: PKG-BAG-50"
              className="w-full rounded-xl border border-border bg-background px-3 py-2 font-mono uppercase"
            />
          </div>

          <div className="space-y-1.5">
            <label className="font-bold text-foreground">وحدة القياس *</label>
            <select
              value={formUnitId}
              onChange={(e) => setFormUnitId(e.target.value)}
              className="w-full rounded-xl border border-border bg-background px-3 py-2"
            >
              <option value="">— اختر الوحدة —</option>
              {units.map((u) => (
                <option key={u.id} value={u.id}>
                  {lang === "ar" ? u.name_ar || u.name : u.name} ({u.short_name})
                </option>
              ))}
            </select>
            <p className="text-[10px] text-muted-foreground">
              بدون وحدة لا معنى لرصيد المخزون، ولا يمكن تسجيل حركة على هذا الصنف.
            </p>
          </div>

          <div className="space-y-1.5">
            <label className="font-bold text-foreground">سعة العبوة (كجم)</label>
            <QuantityInput
              value={formWeightKg === "" ? null : Number(formWeightKg)}
              onValueChange={(v) => setFormWeightKg(v == null ? "" : String(v))}
              decimals={3}
              min={0}
              unit="kg"
              placeholder="مثال: 50 أو 25"
            />
            <p className="text-[10px] text-muted-foreground">
              تُستخدم في شاشات الطحن لاحتساب الوزن الإجمالي تلقائياً (عدد الأكياس × السعة). اتركها
              فارغة للصنف غير المعبأ (خيط، زيت…).
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label className="font-bold text-foreground">سعر البيع للزبون (ر.ي) *</label>
              <AmountInput
                value={formSalePrice}
                onValueChange={(v) => setFormSalePrice(v ?? 0)}
                min={0}
                showInWords={false}
              />
            </div>

            <div className="space-y-1.5">
              <label className="font-bold text-foreground">سعر التكلفة للمطحنة (ر.ي)</label>
              <AmountInput
                value={formCostPrice}
                onValueChange={(v) => setFormCostPrice(v ?? 0)}
                min={0}
                showInWords={false}
              />
            </div>
          </div>

          <div className="flex items-center gap-2 pt-2">
            <input
              type="checkbox"
              id="isBagActive"
              checked={formIsActive}
              onChange={(e) => setFormIsActive(e.target.checked)}
              className="rounded border-border"
            />
            <label htmlFor="isBagActive" className="text-xs font-semibold text-foreground">
              صنف نشط ومتاح في كاونتر الطحن والمبيعات
            </label>
          </div>

          <div className="flex items-center justify-end gap-2 pt-4 border-t border-border">
            <button
              type="button"
              onClick={() => setDialogOpen(false)}
              className="px-4 py-2 rounded-xl border border-border text-muted-foreground hover:bg-muted"
            >
              إلغاء
            </button>
            <button
              type="button"
              disabled={saveMutation.isPending}
              onClick={() => saveMutation.mutate()}
              className="px-5 py-2 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground font-bold"
            >
              {saveMutation.isPending ? "جارٍ الحفظ..." : "حفظ التغييرات"}
            </button>
          </div>
        </div>
      </VortexDrawerDialog>
    </div>
  );
}

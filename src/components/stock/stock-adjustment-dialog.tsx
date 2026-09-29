import { useState, useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";
import {
  X,
  Scale,
  Warehouse,
  Package,
  TrendingDown,
  TrendingUp,
  CheckCircle2,
  Search,
} from "lucide-react";

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

interface StockAdjustmentDialogProps {
  initialProductId?: string;
  initialWarehouseId?: string;
  onClose: () => void;
  onSaved: () => void;
}

export function StockAdjustmentDialog({
  initialProductId,
  initialWarehouseId,
  onClose,
  onSaved,
}: StockAdjustmentDialogProps) {
  const { lang } = useI18n();
  const { user } = useAuth();
  const isAr = lang === "ar";

  const [selectedWarehouseId, setSelectedWarehouseId] = useState<string>(initialWarehouseId || "");
  const [selectedProductId, setSelectedProductId] = useState<string>(initialProductId || "");
  const [productSearch, setProductSearch] = useState("");
  const [actualQtyStr, setActualQtyStr] = useState<string>("");
  const [unitCostStr, setUnitCostStr] = useState<string>("");
  const [reason, setReason] = useState<string>("");
  const [reasonError, setReasonError] = useState<boolean>(false);
  const [note, setNote] = useState<string>("");
  const [saving, setSaving] = useState<boolean>(false);

  // 1. Fetch Warehouses
  const { data: warehouses = [] } = useQuery<WarehouseItem[]>({
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

  // Auto select default warehouse if not selected
  useEffect(() => {
    if (!selectedWarehouseId && warehouses.length > 0) {
      setSelectedWarehouseId(warehouses[0].id);
    }
  }, [warehouses, selectedWarehouseId]);

  // 2. Fetch Products
  const { data: products = [] } = useQuery<ProductItem[]>({
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

  // Filter products by search
  const filteredProducts = useMemo(() => {
    const q = productSearch.trim().toLowerCase();
    if (!q) return products;
    return products.filter((p) => {
      const name = `${p.name} ${p.name_ar ?? ""} ${p.sku ?? ""} ${p.barcode ?? ""}`.toLowerCase();
      return name.includes(q);
    });
  }, [products, productSearch]);

  const selectedProduct = useMemo(
    () => products.find((p) => p.id === selectedProductId) ?? null,
    [products, selectedProductId],
  );

  // Update default unit cost when selected product changes
  useEffect(() => {
    if (selectedProduct) {
      setUnitCostStr(String(selectedProduct.cost_price ?? 0));
    }
  }, [selectedProduct]);

  // 3. Fetch Current System Balance for selected Product + Warehouse
  const { data: systemQty = 0, isLoading: isLoadingStock } = useQuery<number>({
    queryKey: ["inventory_balance_check", selectedProductId, selectedWarehouseId],
    queryFn: async () => {
      if (!selectedProductId || !selectedWarehouseId) return 0;
      const { data, error } = await supabase
        .from("inventory")
        .select("quantity")
        .eq("product_id", selectedProductId)
        .eq("warehouse_id", selectedWarehouseId)
        .maybeSingle();
      if (error) throw error;
      return Number(data?.quantity ?? 0);
    },
    enabled: Boolean(selectedProductId && selectedWarehouseId),
  });

  // Initialize actual count string when systemQty finishes loading or product changes
  useEffect(() => {
    if (selectedProductId && selectedWarehouseId && !isLoadingStock) {
      setActualQtyStr(String(systemQty));
    }
  }, [selectedProductId, selectedWarehouseId, systemQty, isLoadingStock]);

  // Calculated Difference
  const actualQty = Number(actualQtyStr);
  const isActualValid = actualQtyStr.trim() !== "" && !isNaN(actualQty) && actualQty >= 0;
  const difference = isActualValid ? actualQty - systemQty : 0;
  const isMatching = isActualValid && Math.abs(difference) < 0.0001;
  const isShortage = isActualValid && difference < -0.0001;
  const isSurplus = isActualValid && difference > 0.0001;

  // Auto suggest reason based on surplus/shortage
  useEffect(() => {
    if (isSurplus && !reason) setReason("surplus");
    if (isShortage && !reason) setReason("shortfall");
  }, [isSurplus, isShortage, reason]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!selectedWarehouseId) {
      toast.error(isAr ? "يرجى تحديد المستودع" : "Please select a warehouse");
      return;
    }
    if (!selectedProductId) {
      toast.error(isAr ? "يرجى تحديد المنتج" : "Please select a product");
      return;
    }
    if (!isActualValid) {
      toast.error(isAr ? "يرجى إدخال كمية جرد فعلي صحيحة" : "Please enter a valid actual count");
      return;
    }
    if (isMatching) {
      toast.error(
        isAr
          ? "رصيد الجرد الفعلي مطابق لرصيد النظام، لا توجد فروقات للتسوية"
          : "Actual count matches system balance, no adjustment needed",
      );
      return;
    }
    if (!reason) {
      setReasonError(true);
      toast.error(isAr ? "يرجى اختيار سبب التسوية" : "Please select an adjustment reason");
      return;
    }

    setSaving(true);
    try {
      // 1. Update/Upsert the inventory table with the EXACT actual physical count
      const { error: invErr } = await supabase.from("inventory").upsert(
        {
          product_id: selectedProductId,
          warehouse_id: selectedWarehouseId,
          quantity: actualQty,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "product_id,warehouse_id" },
      );

      if (invErr) throw invErr;

      // 2. Log the stock movement for the difference (positive for surplus, negative for shortage)
      const { error: mvErr } = await supabase.from("stock_movements").insert({
        product_id: selectedProductId,
        warehouse_id: selectedWarehouseId,
        movement_type: "adjustment",
        quantity: difference,
        unit_cost: Number(unitCostStr) || 0,
        note: note.trim() || null,
        adjustment_reason: reason,
        created_by: user?.id ?? null,
      } as any);

      if (mvErr) throw mvErr;

      toast.success(
        isAr
          ? `تم اعتماد التسوية الجردية بنجاح (${difference > 0 ? "+" : ""}${difference.toFixed(2)})`
          : `Stock adjustment recorded successfully (${difference > 0 ? "+" : ""}${difference.toFixed(2)})`,
      );

      onSaved();
    } catch (err: any) {
      console.error("Adjustment failed:", err);
      toast.error(err.message || (isAr ? "فشل تنفيذ التسوية" : "Failed to apply adjustment"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto"
      onClick={onClose}
    >
      <form
        onSubmit={handleSubmit}
        onClick={(e) => e.stopPropagation()}
        className="panel-elevated w-full max-w-lg overflow-hidden my-8 rounded-3xl border border-border/80 bg-surface shadow-xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border/80 px-6 py-4 bg-muted/20">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-2xl bg-sky-500/10 text-sky-500">
              <Scale className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-foreground">
                {isAr ? "تسوية مخزنية (جرد فعلي)" : "Stock Adjustment (Physical Count)"}
              </h2>
              <p className="text-xs text-muted-foreground">
                {isAr
                  ? "مقارنة الجرد الفعلي على الرف برصيد النظام واحتساب الفرق"
                  : "Reconcile shelf count with system balance and calculate difference"}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid h-8 w-8 place-items-center rounded-full text-muted-foreground hover:bg-accent transition"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Content */}
        <div className="space-y-4 p-6 text-sm">
          {/* Warehouse Selection */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-foreground flex items-center gap-1.5">
              <Warehouse className="h-3.5 w-3.5 text-sky-500" />
              {isAr ? "المستودع" : "Warehouse"}
            </label>
            <select
              value={selectedWarehouseId}
              onChange={(e) => setSelectedWarehouseId(e.target.value)}
              className="h-10 w-full rounded-xl border border-border bg-surface px-3 text-sm text-foreground outline-none focus:border-primary"
              disabled={Boolean(initialWarehouseId)}
            >
              <option value="">{isAr ? "اختر المستودع..." : "Select Warehouse..."}</option>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {isAr ? w.name_ar || w.name : w.name || w.name_ar} {w.code ? `(${w.code})` : ""}
                </option>
              ))}
            </select>
          </div>

          {/* Product Selection */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-foreground flex items-center gap-1.5">
              <Package className="h-3.5 w-3.5 text-sky-500" />
              {isAr ? "المنتج / الصنف" : "Product / Item"}
            </label>
            {initialProductId && selectedProduct ? (
              <div className="flex items-center justify-between rounded-xl border border-border bg-muted/20 p-3">
                <div>
                  <div className="font-semibold text-foreground">
                    {isAr ? selectedProduct.name_ar || selectedProduct.name : selectedProduct.name}
                  </div>
                  <div className="text-xs font-mono text-muted-foreground">
                    SKU: {selectedProduct.sku || "—"}
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="relative">
                  <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground rtl:right-3 rtl:left-auto" />
                  <input
                    type="text"
                    value={productSearch}
                    onChange={(e) => setProductSearch(e.target.value)}
                    placeholder={
                      isAr ? "بحث بالاسم أو SKU أو الباركود..." : "Search name, SKU or barcode..."
                    }
                    className="h-10 w-full rounded-xl border border-border bg-surface px-9 text-sm outline-none focus:border-primary"
                  />
                </div>
                <select
                  size={4}
                  value={selectedProductId}
                  onChange={(e) => setSelectedProductId(e.target.value)}
                  className="w-full rounded-xl border border-border bg-surface p-1 text-sm text-foreground outline-none focus:border-primary"
                >
                  {filteredProducts.length === 0 && (
                    <option disabled className="p-2 text-center text-muted-foreground">
                      {isAr ? "لا توجد نتائج مطابقة" : "No matching products"}
                    </option>
                  )}
                  {filteredProducts.map((p) => (
                    <option key={p.id} value={p.id} className="rounded-lg p-2 hover:bg-accent">
                      {isAr ? p.name_ar || p.name : p.name} {p.sku ? `(${p.sku})` : ""}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {selectedProduct && selectedWarehouseId && (
            <>
              {/* Balance & Physical Count Grid */}
              <div className="grid grid-cols-2 gap-3 pt-2">
                {/* System Balance Card */}
                <div className="rounded-2xl border border-border bg-muted/30 p-3.5 space-y-1">
                  <span className="text-[11px] font-medium text-muted-foreground block">
                    {isAr ? "رصيد النظام الحالي" : "System Balance"}
                  </span>
                  <div className="text-xl font-bold font-mono text-foreground">
                    {isLoadingStock ? "..." : systemQty.toFixed(2)}
                  </div>
                  <span className="text-[10px] text-muted-foreground block">
                    {isAr ? "المقيد دفترياً في المستودع" : "Registered in ledger"}
                  </span>
                </div>

                {/* Actual Count Input */}
                <div className="rounded-2xl border border-primary/30 bg-primary/5 p-3.5 space-y-1">
                  <label className="text-[11px] font-semibold text-primary block">
                    {isAr ? "الجرد الفعلي (على الرف) *" : "Actual Shelf Count *"}
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={actualQtyStr}
                    onChange={(e) => setActualQtyStr(e.target.value)}
                    className="h-9 w-full rounded-lg border border-primary/40 bg-surface px-2.5 font-mono text-lg font-bold outline-none focus:ring-2 focus:ring-primary/20"
                    placeholder="0.00"
                    required
                  />
                  <span className="text-[10px] text-muted-foreground block">
                    {isAr ? "الكمية المحصورة فعلياً" : "Physically counted quantity"}
                  </span>
                </div>
              </div>

              {/* Status & Difference Card */}
              {isActualValid && (
                <div
                  className={`rounded-2xl border p-4 transition-all ${
                    isMatching
                      ? "border-sky-500/30 bg-sky-500/10 text-sky-600 dark:text-sky-300"
                      : isShortage
                        ? "border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-300"
                        : "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 font-semibold text-sm">
                      {isMatching && <CheckCircle2 className="h-4 w-4" />}
                      {isShortage && <TrendingDown className="h-4 w-4 text-rose-500" />}
                      {isSurplus && <TrendingUp className="h-4 w-4 text-emerald-500" />}
                      <span>
                        {isMatching && (isAr ? "الرصيد مطابق والجرد سليم" : "Stock is matching")}
                        {isShortage && (isAr ? "عجز جردي (Stock Shortage)" : "Stock Shortage")}
                        {isSurplus && (isAr ? "فائض جردي (Stock Surplus)" : "Stock Surplus")}
                      </span>
                    </div>

                    <div className="font-mono text-base font-extrabold">
                      {difference > 0 ? `+${difference.toFixed(2)}` : difference.toFixed(2)}
                    </div>
                  </div>

                  <p className="mt-1 text-xs opacity-90">
                    {isMatching &&
                      (isAr
                        ? "الجرد الفعلي يطابق تماماً رصيد النظام، لن يتم إنشاء حركة تسوية غير ضرورية."
                        : "Actual count matches system balance. No adjustment record will be created.")}
                    {isShortage &&
                      (isAr
                        ? `سيتم تخفيض رصيد المستودع بمقدار (${Math.abs(difference).toFixed(2)}) ليصل تماماً إلى الجرد الفعلي (${actualQty.toFixed(2)}).`
                        : `Stock balance will be reduced by (${Math.abs(difference).toFixed(2)}) to equal shelf count (${actualQty.toFixed(2)}).`)}
                    {isSurplus &&
                      (isAr
                        ? `سيتم زيادة رصيد المستودع بمقدار (+${difference.toFixed(2)}) ليصل تماماً إلى الجرد الفعلي (${actualQty.toFixed(2)}).`
                        : `Stock balance will be increased by (+${difference.toFixed(2)}) to equal shelf count (${actualQty.toFixed(2)}).`)}
                  </p>
                </div>
              )}

              {/* Adjustment Reason & Unit Cost */}
              {!isMatching && isActualValid && (
                <div className="space-y-3 pt-1">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <label className="text-xs font-semibold text-foreground">
                        {isAr ? "سبب التسوية *" : "Adjustment Reason *"}
                      </label>
                      <select
                        value={reason}
                        onChange={(e) => {
                          setReason(e.target.value);
                          if (e.target.value) setReasonError(false);
                        }}
                        className={`h-10 w-full rounded-xl border bg-surface px-3 text-xs outline-none ${
                          reasonError ? "border-rose-500" : "border-border"
                        }`}
                      >
                        <option value="">{isAr ? "حدد سبب التسوية..." : "Select reason..."}</option>
                        <option value="shortfall">{isAr ? "عجز جردي" : "Stock Shortfall"}</option>
                        <option value="surplus">{isAr ? "فائض جردي" : "Stock Surplus"}</option>
                        <option value="damaged">
                          {isAr ? "تلف سوء تخزين / كسر" : "Damaged / Broken"}
                        </option>
                        <option value="expiry">{isAr ? "انتهاء صلاحية" : "Expired Product"}</option>
                        <option value="stocktake">
                          {isAr ? "تسوية جرد دوري" : "Periodic Stocktake"}
                        </option>
                        <option value="other">
                          {isAr ? "سبب آخر (اذكره في الملاحظات)" : "Other Reason"}
                        </option>
                      </select>
                      {reasonError && (
                        <span className="text-[11px] text-rose-500 block">
                          {isAr ? "السبب إجباري للتسوية" : "Reason is required"}
                        </span>
                      )}
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-xs font-semibold text-foreground">
                        {isAr ? "تكلفة الوحدة للتسوية" : "Unit Cost for Adjustment"}
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={unitCostStr}
                        onChange={(e) => setUnitCostStr(e.target.value)}
                        className="h-10 w-full rounded-xl border border-border bg-surface px-3 font-mono text-xs outline-none"
                      />
                    </div>
                  </div>

                  {/* Notes */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-foreground">
                      {isAr ? "ملاحظات وتفاصيل إضافية" : "Notes & Details"}
                    </label>
                    <textarea
                      rows={2}
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      placeholder={
                        isAr
                          ? "اكتب أي تفاصيل أو مبررات إضافية للتسوية..."
                          : "Write additional details or justification..."
                      }
                      className="w-full rounded-xl border border-border bg-surface p-3 text-xs outline-none resize-none"
                    />
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-between border-t border-border/80 bg-muted/20 px-6 py-3.5">
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 items-center rounded-xl border border-border bg-surface px-4 text-xs font-semibold text-muted-foreground hover:text-foreground transition"
          >
            {isAr ? "إلغاء" : "Cancel"}
          </button>

          <button
            type="submit"
            disabled={
              saving || !selectedProductId || !selectedWarehouseId || !isActualValid || isMatching
            }
            className="flex h-9 items-center gap-2 rounded-xl bg-primary px-5 text-xs font-bold text-primary-foreground shadow-sm hover:opacity-90 transition disabled:opacity-40"
          >
            {saving ? (
              <span>{isAr ? "جاري الاعتماد..." : "Saving..."}</span>
            ) : (
              <>
                <Scale className="h-4 w-4" />
                <span>{isAr ? "اعتماد التسوية الجردية" : "Apply Adjustment"}</span>
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}

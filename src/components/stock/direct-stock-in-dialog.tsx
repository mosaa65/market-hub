import { useState, useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";
import {
  X,
  PackagePlus,
  Warehouse,
  Package,
  Search,
  Truck,
  FileText,
  DollarSign,
  ArrowUpRight,
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

type SupplierItem = {
  id: string;
  name: string;
  phone: string | null;
};

interface DirectStockInDialogProps {
  initialProductId?: string;
  initialWarehouseId?: string;
  onClose: () => void;
  onSaved: () => void;
}

export function DirectStockInDialog({
  initialProductId,
  initialWarehouseId,
  onClose,
  onSaved,
}: DirectStockInDialogProps) {
  const { lang } = useI18n();
  const { user } = useAuth();
  const isAr = lang === "ar";

  const [selectedWarehouseId, setSelectedWarehouseId] = useState<string>(initialWarehouseId || "");
  const [selectedProductId, setSelectedProductId] = useState<string>(initialProductId || "");
  const [productSearch, setProductSearch] = useState("");
  const [incomingQtyStr, setIncomingQtyStr] = useState<string>("");
  const [unitCostStr, setUnitCostStr] = useState<string>("");
  const [supplierId, setSupplierId] = useState<string>("");
  const [reference, setReference] = useState<string>("");
  const [note, setNote] = useState<string>("");
  const [saving, setSaving] = useState<boolean>(false);

  // 1. Fetch Warehouses
  const { data: warehouses = [] } = useQuery<WarehouseItem[]>({
    queryKey: ["warehouses_direct_in"],
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
    queryKey: ["products_direct_in_list"],
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

  // 3. Fetch Suppliers
  const { data: suppliers = [] } = useQuery<SupplierItem[]>({
    queryKey: ["suppliers_direct_in_list"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("suppliers")
        .select("id, name, phone")
        .order("name");
      if (error) throw error;
      return (data ?? []) as SupplierItem[];
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

  // 4. Fetch Current System Balance for selected Product + Warehouse
  const { data: systemQty = 0, isLoading: isLoadingStock } = useQuery<number>({
    queryKey: ["inventory_direct_in_balance", selectedProductId, selectedWarehouseId],
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

  const incomingQty = Number(incomingQtyStr);
  const isValidQty = incomingQtyStr.trim() !== "" && !isNaN(incomingQty) && incomingQty > 0;
  const newTotalQty = systemQty + (isValidQty ? incomingQty : 0);

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
    if (!isValidQty) {
      toast.error(
        isAr ? "يرجى إدخال كمية واردة أكبر من صفر" : "Please enter a valid incoming quantity > 0",
      );
      return;
    }

    setSaving(true);
    try {
      // 1. Update/Upsert the inventory table with the NEW Total Quantity (current + incoming)
      const { error: invErr } = await supabase.from("inventory").upsert(
        {
          product_id: selectedProductId,
          warehouse_id: selectedWarehouseId,
          quantity: newTotalQty,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "product_id,warehouse_id" },
      );

      if (invErr) throw invErr;

      // 2. Log the stock movement as 'purchase' (incoming stock receipt)
      const noteText = note.trim()
        ? note.trim()
        : isAr
          ? "توريد مخزني مباشر (إدخال كمية)"
          : "Direct stock receipt";

      const { error: mvErr } = await supabase.from("stock_movements").insert({
        product_id: selectedProductId,
        warehouse_id: selectedWarehouseId,
        movement_type: "purchase",
        quantity: incomingQty,
        unit_cost: Number(unitCostStr) || 0,
        reference: reference.trim() || null,
        note: noteText,
        created_by: user?.id ?? null,
      } as any);

      if (mvErr) throw mvErr;

      toast.success(
        isAr
          ? `تم توريد الكمية الجديدة بنجاح (+${incomingQty.toFixed(2)}) أصبح الرصيد (${newTotalQty.toFixed(2)})`
          : `Direct stock in recorded (+${incomingQty.toFixed(2)}), new balance (${newTotalQty.toFixed(2)})`,
      );

      onSaved();
    } catch (err: any) {
      console.error("Direct stock in failed:", err);
      toast.error(
        err.message || (isAr ? "فشل عملية التوريد المخزني" : "Failed to record stock in"),
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-3 sm:p-4 overflow-y-auto"
      onClick={onClose}
    >
      <form
        onSubmit={handleSubmit}
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[90dvh] w-full max-w-lg lg:max-w-4xl flex-col rounded-3xl border border-border/80 bg-surface shadow-2xl overflow-hidden transition-all"
      >
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-border/80 px-6 py-4 bg-emerald-500/10">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-2xl bg-emerald-500/20 text-emerald-600 dark:text-emerald-400">
              <PackagePlus className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-foreground">
                {isAr ? "إدخال مخزني مباشر (توريد بضاعة)" : "Direct Stock In (Receiving Stock)"}
              </h2>
              <p className="text-xs text-muted-foreground">
                {isAr
                  ? "إضافة كميات واردة جديدة للمستودع مباشرة دون الحاجة لفاتورة مشتريات معقدة"
                  : "Add new incoming inventory stock directly without formal purchase invoices"}
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
        <div className="flex-1 overflow-y-auto space-y-4 p-6 text-sm custom-scrollbar">
          {/* Warehouse Selection */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-foreground flex items-center gap-1.5">
              <Warehouse className="h-3.5 w-3.5 text-emerald-500" />
              {isAr ? "المستودع الهدف *" : "Target Warehouse *"}
            </label>
            <select
              value={selectedWarehouseId}
              onChange={(e) => setSelectedWarehouseId(e.target.value)}
              className="h-10 w-full rounded-xl border border-border bg-surface px-3 text-sm text-foreground outline-none focus:border-emerald-500"
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
              <Package className="h-3.5 w-3.5 text-emerald-500" />
              {isAr ? "المنتج / الصنف *" : "Product / Item *"}
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
                    className="h-10 w-full rounded-xl border border-border bg-surface px-9 text-sm outline-none focus:border-emerald-500"
                  />
                </div>
                <select
                  size={4}
                  value={selectedProductId}
                  onChange={(e) => setSelectedProductId(e.target.value)}
                  className="w-full rounded-xl border border-border bg-surface p-1 text-sm text-foreground outline-none focus:border-emerald-500"
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
              {/* Quantities & Calculation Card */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
                {/* Current Stock */}
                <div className="rounded-2xl border border-border bg-muted/30 p-3 space-y-1">
                  <span className="text-[11px] font-medium text-muted-foreground block">
                    {isAr ? "الرصيد الحالي" : "Current Stock"}
                  </span>
                  <div className="text-lg font-bold font-mono text-foreground">
                    {isLoadingStock ? "..." : systemQty.toFixed(2)}
                  </div>
                </div>

                {/* Incoming Qty Input */}
                <div className="rounded-2xl border border-emerald-500/40 bg-emerald-500/10 p-3 space-y-1">
                  <label className="text-[11px] font-bold text-emerald-600 dark:text-emerald-300 block">
                    {isAr ? "الكمية الواردة *" : "Incoming Qty *"}
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    value={incomingQtyStr}
                    onChange={(e) => setIncomingQtyStr(e.target.value)}
                    className="h-8 w-full rounded-lg border border-emerald-500/50 bg-surface px-2 font-mono text-base font-extrabold outline-none focus:ring-2 focus:ring-emerald-500/20"
                    placeholder="+0.00"
                    autoFocus
                    required
                  />
                </div>

                {/* New Total Balance */}
                <div className="rounded-2xl border border-sky-500/30 bg-sky-500/10 p-3 space-y-1">
                  <span className="text-[11px] font-medium text-sky-600 dark:text-sky-300 block">
                    {isAr ? "الرصيد الكلي الجديد" : "New Total Stock"}
                  </span>
                  <div className="text-lg font-bold font-mono text-sky-700 dark:text-sky-200">
                    {newTotalQty.toFixed(2)}
                  </div>
                </div>
              </div>

              {/* Unit Cost & Supplier */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-foreground flex items-center gap-1">
                    <DollarSign className="h-3.5 w-3.5 text-muted-foreground" />
                    {isAr ? "تكلفة شراء الوارد للقطعة" : "Unit Purchase Cost"}
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={unitCostStr}
                    onChange={(e) => setUnitCostStr(e.target.value)}
                    className="h-10 w-full rounded-xl border border-border bg-surface px-3 font-mono text-xs outline-none focus:border-emerald-500"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-foreground flex items-center gap-1">
                    <Truck className="h-3.5 w-3.5 text-muted-foreground" />
                    {isAr ? "المورد (اختياري)" : "Supplier (Optional)"}
                  </label>
                  <select
                    value={supplierId}
                    onChange={(e) => setSupplierId(e.target.value)}
                    className="h-10 w-full rounded-xl border border-border bg-surface px-3 text-xs outline-none focus:border-emerald-500"
                  >
                    <option value="">
                      {isAr ? "بدون تحديد مورد (توريد مباشر)" : "No Supplier (Direct In)"}
                    </option>
                    {suppliers.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} {s.phone ? `(${s.phone})` : ""}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Reference & Notes */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-foreground flex items-center gap-1">
                    <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                    {isAr ? "رقم السند / المرجع (اختياري)" : "Reference No (Optional)"}
                  </label>
                  <input
                    type="text"
                    value={reference}
                    onChange={(e) => setReference(e.target.value)}
                    placeholder={isAr ? "مثال: سند استلام #102" : "e.g. Receipt #102"}
                    className="h-10 w-full rounded-xl border border-border bg-surface px-3 text-xs outline-none focus:border-emerald-500"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-foreground">
                    {isAr ? "ملاحظات وتفاصيل التوريد" : "Notes & Details"}
                  </label>
                  <input
                    type="text"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder={
                      isAr ? "مثال: بضاعة جديدة مسلّمة للمخزن" : "e.g. Received new stock shipment"
                    }
                    className="h-10 w-full rounded-xl border border-border bg-surface px-3 text-xs outline-none focus:border-emerald-500"
                  />
                </div>
              </div>
            </>
          )}
        </div>

        {/* Footer Actions */}
        <div className="flex shrink-0 items-center justify-between border-t border-border/80 bg-muted/20 px-6 py-3.5">
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 items-center rounded-xl border border-border bg-surface px-4 text-xs font-semibold text-muted-foreground hover:text-foreground transition"
          >
            {isAr ? "إلغاء" : "Cancel"}
          </button>

          <button
            type="submit"
            disabled={saving || !selectedProductId || !selectedWarehouseId || !isValidQty}
            className="flex h-9 items-center gap-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 px-5 text-xs font-bold text-white shadow-sm transition disabled:opacity-40"
          >
            {saving ? (
              <span>{isAr ? "جاري التوريد..." : "Saving..."}</span>
            ) : (
              <>
                <ArrowUpRight className="h-4 w-4" />
                <span>{isAr ? "اعتماد التوريد والمخزون" : "Confirm Stock In"}</span>
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}

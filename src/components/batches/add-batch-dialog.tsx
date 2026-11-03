import { useState, useEffect, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AmountInput } from "@/components/ui/amount-input";
import { QuantityInput } from "@/components/ui/quantity-input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SearchInput } from "@/components/ui/search-input";
import {
  Plus,
  Package,
  Warehouse,
  Calendar,
  Layers,
  DollarSign,
  FileText,
  AlertCircle,
  RefreshCw,
  Check,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import { toast } from "sonner";
import { useBatchSettings } from "@/hooks/use-batch-settings";

interface ProductOption {
  id: string;
  name: string;
  name_ar: string | null;
  sku: string | null;
  tracking: string;
  cost_price?: number;
}

interface WarehouseOption {
  id: string;
  name: string;
  name_ar: string | null;
}

interface AddBatchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
  hasMultiWarehouse?: boolean;
}

export function AddBatchDialog({
  open,
  onOpenChange,
  onSaved,
  hasMultiWarehouse = false,
}: AddBatchDialogProps) {
  const { lang, t } = useI18n();
  const isAr = lang === "ar";
  const { settings } = useBatchSettings();

  const [products, setProducts] = useState<ProductOption[]>([]);
  const [warehouses, setWarehouses] = useState<WarehouseOption[]>([]);
  const [loadingOptions, setLoadingOptions] = useState(false);
  const [saving, setSaving] = useState(false);

  const [productSearch, setProductSearch] = useState("");
  const [onlyTracked, setOnlyTracked] = useState(false);

  const [form, setForm] = useState({
    product_id: "",
    warehouse_id: "",
    batch_number: "",
    expiry_date: "",
    quantity: "" as string | number,
    unit_cost: "" as string | number,
    note: "",
    sync_inventory: true,
  });

  // Load products and warehouses on mount
  useEffect(() => {
    if (!open) return;
    setLoadingOptions(true);
    Promise.all([
      supabase
        .from("products")
        .select("id, name, name_ar, sku, tracking, cost_price")
        .eq("is_active", true)
        .order("name"),
      supabase.from("warehouses").select("id, name, name_ar").eq("is_active", true).order("name"),
    ])
      .then(([pRes, wRes]) => {
        const prodList = (pRes.data ?? []) as unknown as ProductOption[];
        const whList = (wRes.data ?? []) as WarehouseOption[];
        setProducts(prodList);
        setWarehouses(whList);

        if (whList.length > 0 && !form.warehouse_id) {
          setForm((f) => ({ ...f, warehouse_id: whList[0].id }));
        }
      })
      .catch((err) => {
        toast.error(err?.message || (isAr ? "فشل تحميل البيانات" : "Failed to load options"));
      })
      .finally(() => setLoadingOptions(false));
  }, [open, isAr]);

  // Set default sync_inventory based on settings
  useEffect(() => {
    if (open) {
      setForm((f) => ({
        ...f,
        sync_inventory: settings.auto_sync_inventory,
      }));
    }
  }, [open, settings.auto_sync_inventory]);

  // Selected product metadata
  const selectedProduct = useMemo(
    () => products.find((p) => p.id === form.product_id),
    [products, form.product_id],
  );

  // When product changes, prefill unit cost if available
  const handleProductSelect = (pId: string) => {
    const prod = products.find((p) => p.id === pId);
    setForm((f) => ({
      ...f,
      product_id: pId,
      unit_cost: prod?.cost_price ?? f.unit_cost,
    }));
  };

  // Filtered product list for searchable picker
  const filteredProducts = useMemo(() => {
    let list = products;
    if (onlyTracked) {
      list = list.filter((p) => p.tracking === "BATCH");
    }
    const q = productSearch.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (p) =>
        (p.name && p.name.toLowerCase().includes(q)) ||
        (p.name_ar && p.name_ar.includes(q)) ||
        (p.sku && p.sku.toLowerCase().includes(q)),
    );
  }, [products, productSearch, onlyTracked]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!form.product_id) {
      return toast.error(isAr ? "يرجى اختيار المنتج" : "Please select a product");
    }
    if (!form.warehouse_id) {
      return toast.error(isAr ? "يرجى اختيار المستودع" : "Please select a warehouse");
    }
    if (!form.batch_number || !form.batch_number.trim()) {
      return toast.error(isAr ? "يرجى إدخال رقم الدفعة" : "Please enter batch number");
    }

    const qty = Number(form.quantity);
    if (isNaN(qty) || qty <= 0) {
      return toast.error(
        isAr ? "الكمية يجب أن تكون أكبر من صفر" : "Quantity must be greater than zero",
      );
    }

    const cost = Number(form.unit_cost || 0);
    if (isNaN(cost) || cost < 0) {
      return toast.error(
        isAr ? "تكلفة الوحدة لا يمكن أن تكون سالبة" : "Unit cost cannot be negative",
      );
    }

    if (!form.expiry_date && selectedProduct?.tracking === "BATCH") {
      // Warning if tracked item has no expiry date
      toast.warning(
        isAr
          ? "تنبيه: الصنف يتبع الدفعات ولم يتم تحديد تاريخ انتهاء"
          : "Note: Product is batch-tracked but no expiry date was provided",
      );
    }

    setSaving(true);
    try {
      const { data, error } = await supabase.rpc("save_product_batch" as any, {
        p_product_id: form.product_id,
        p_warehouse_id: form.warehouse_id,
        p_batch_number: form.batch_number.trim(),
        p_expiry_date: form.expiry_date || null,
        p_quantity: qty,
        p_unit_cost: cost,
        p_note: form.note.trim() || null,
        p_sync_inventory: form.sync_inventory,
      });

      if (error) throw error;

      toast.success(
        isAr ? "تم حفظ الدفعة بنجاح وتحديث المخزون" : "Batch recorded and stock updated",
      );
      onSaved();
      onOpenChange(false);
    } catch (err: any) {
      toast.error(err?.message || (isAr ? "فشل حفظ الدفعة" : "Failed to record batch"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[92vh] overflow-y-auto p-0 gap-0 border-border bg-background shadow-2xl">
        <form onSubmit={handleSubmit}>
          <DialogHeader className="p-6 pb-4 border-b border-border/80 bg-muted/20">
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary border border-primary/20">
                <Plus className="size-5" />
              </div>
              <div>
                <DialogTitle className="text-lg font-bold text-foreground">
                  {isAr ? "تسجيل دفعة جديدة للمخزون" : "Record New Batch"}
                </DialogTitle>
                <DialogDescription className="text-xs text-muted-foreground mt-0.5">
                  {isAr
                    ? "إضافة دفعة تشغيلية جديدة برقم تتبع وتاريخ صلاحية مع مزامنة الرصيد"
                    : "Add a new batch with number, expiry date and synchronized inventory"}
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <div className="p-6 space-y-5">
            {/* 1. Product Selection with Search */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                  <Package className="size-3.5 text-primary" />
                  <span>{isAr ? "المنتج المستهدف *" : "Target Product *"}</span>
                </label>

                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-muted-foreground">
                    {isAr ? "أصناف الدفعات فقط" : "Tracked only"}
                  </span>
                  <Switch
                    checked={onlyTracked}
                    onCheckedChange={setOnlyTracked}
                    className="scale-75 origin-end"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <SearchInput
                  value={productSearch}
                  onValueChange={setProductSearch}
                  placeholder={
                    isAr ? "بحث عن الصنف بالاسم أو الباركود SKU..." : "Search by name or SKU..."
                  }
                  className="h-9 text-xs"
                />

                <Select value={form.product_id} onValueChange={handleProductSelect}>
                  <SelectTrigger className="h-10 text-xs bg-surface">
                    <SelectValue
                      placeholder={
                        loadingOptions
                          ? isAr
                            ? "جاري تحميل المنتجات..."
                            : "Loading products..."
                          : isAr
                            ? "اختر المنتج من القائمة..."
                            : "Select product..."
                      }
                    />
                  </SelectTrigger>
                  <SelectContent className="max-h-60">
                    {filteredProducts.length === 0 ? (
                      <div className="p-3 text-center text-xs text-muted-foreground">
                        {isAr ? "لا توجد منتجات مطابقة للبحث" : "No matching products"}
                      </div>
                    ) : (
                      filteredProducts.map((p) => (
                        <SelectItem key={p.id} value={p.id} className="text-xs py-2">
                          <div className="flex items-center justify-between gap-3 w-full">
                            <span className="font-medium text-foreground">
                              {isAr ? p.name_ar || p.name : p.name || p.name_ar}
                            </span>
                            <div className="flex items-center gap-1.5 shrink-0">
                              {p.sku && (
                                <span className="font-mono text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                                  {p.sku}
                                </span>
                              )}
                              {p.tracking === "BATCH" && (
                                <Badge
                                  variant="outline"
                                  className="text-[9px] px-1 py-0 border-primary/30 text-primary"
                                >
                                  {isAr ? "تتبع دفعات" : "BATCH"}
                                </Badge>
                              )}
                            </div>
                          </div>
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
              </div>

              {selectedProduct && (
                <div className="rounded-lg bg-surface border border-border/80 p-2.5 flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">
                      {isAr ? "المنتج المحدد:" : "Selected:"}
                    </span>
                    <span className="font-semibold text-foreground">
                      {isAr
                        ? selectedProduct.name_ar || selectedProduct.name
                        : selectedProduct.name}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-muted-foreground">
                      {isAr ? "سياسة التتبع: " : "Tracking: "}
                      <span className="font-semibold text-foreground">
                        {selectedProduct.tracking}
                      </span>
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* 2. Warehouse Selection */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                <Warehouse className="size-3.5 text-primary" />
                <span>{isAr ? "المستودع *" : "Warehouse *"}</span>
              </label>

              <Select
                value={form.warehouse_id}
                onValueChange={(val) => setForm((f) => ({ ...f, warehouse_id: val }))}
              >
                <SelectTrigger className="h-10 text-xs bg-surface">
                  <SelectValue placeholder={isAr ? "اختر المستودع..." : "Select warehouse..."} />
                </SelectTrigger>
                <SelectContent>
                  {warehouses.map((w) => (
                    <SelectItem key={w.id} value={w.id} className="text-xs">
                      {isAr ? w.name_ar || w.name : w.name || w.name_ar}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* 3. Batch Number & Expiry Date */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                  <Layers className="size-3.5 text-primary" />
                  <span>{isAr ? "رقم الدفعة / التشغيلة *" : "Batch Number *"}</span>
                </label>
                <Input
                  value={form.batch_number}
                  onChange={(e) => setForm({ ...form, batch_number: e.target.value })}
                  placeholder={isAr ? "مثال: BATCH-2026-A1" : "e.g. BATCH-2026-A1"}
                  className="h-10 text-xs font-mono"
                  required
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                  <Calendar className="size-3.5 text-primary" />
                  <span>{isAr ? "تاريخ انتهاء الصلاحية" : "Expiry Date"}</span>
                </label>
                <Input
                  type="date"
                  value={form.expiry_date}
                  onChange={(e) => setForm({ ...form, expiry_date: e.target.value })}
                  className="h-10 text-xs font-mono"
                />
              </div>
            </div>

            {/* 4. Quantity & Unit Cost */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                  <Package className="size-3.5 text-primary" />
                  <span>{isAr ? "الكمية *" : "Quantity *"}</span>
                </label>
                <QuantityInput
                  value={form.quantity === "" ? null : Number(form.quantity)}
                  onValueChange={(v) => setForm({ ...form, quantity: v == null ? "" : String(v) })}
                  decimals={3}
                  min={0.001}
                  placeholder="0"
                  aria-label={isAr ? "الكمية" : "Quantity"}
                  className="h-10 text-xs"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                  <DollarSign className="size-3.5 text-primary" />
                  <span>{isAr ? "تكلفة الوحدة" : "Unit Cost"}</span>
                </label>
                <AmountInput
                  value={form.unit_cost === "" ? null : Number(form.unit_cost)}
                  onValueChange={(v) => setForm({ ...form, unit_cost: v == null ? "" : String(v) })}
                  min={0}
                  showInWords={false}
                  className="h-10 text-xs"
                />
              </div>
            </div>

            {/* 5. Notes */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                <FileText className="size-3.5 text-primary" />
                <span>{isAr ? "ملاحظات الدفعة" : "Notes"}</span>
              </label>
              <Input
                value={form.note}
                onChange={(e) => setForm({ ...form, note: e.target.value })}
                placeholder={
                  isAr
                    ? "أي معلومات أو مرجع فحص مخبري أو ملاحظات إضافية..."
                    : "Any lab tests, references or notes..."
                }
                className="h-10 text-xs"
              />
            </div>

            {/* 6. Inventory Sync Switch */}
            <div className="rounded-xl border border-primary/20 bg-primary/5 p-3.5 flex items-start justify-between gap-3">
              <div className="space-y-0.5">
                <div className="flex items-center gap-2">
                  <RefreshCw className="size-3.5 text-primary" />
                  <span className="text-xs font-bold text-foreground">
                    {isAr ? "مزامنة الرصيد مع المخزون العام فوراً" : "Sync With General Stock"}
                  </span>
                </div>
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  {isAr
                    ? "عند التفعيل، سيتم ترحيل الكمية كحركة واردة بالمخزون العام وحساب التكلفة تلقائياً."
                    : "When enabled, stock movement and ledger entries will be created immediately."}
                </p>
              </div>

              <Switch
                checked={form.sync_inventory}
                onCheckedChange={(checked) => setForm({ ...form, sync_inventory: checked })}
              />
            </div>
          </div>

          <DialogFooter className="p-4 px-6 border-t border-border/80 bg-muted/20 flex items-center justify-between gap-3">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onOpenChange(false)}
              className="text-xs"
            >
              {isAr ? "إلغاء" : "Cancel"}
            </Button>

            <Button
              type="submit"
              size="sm"
              disabled={saving}
              className="text-xs gap-1.5 px-5 font-bold"
            >
              {saving ? (
                <span>{isAr ? "جاري الحفظ والترحيل..." : "Saving..."}</span>
              ) : (
                <>
                  <Check className="size-3.5" />
                  <span>{isAr ? "تسجيل الدفعة" : "Save Batch"}</span>
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

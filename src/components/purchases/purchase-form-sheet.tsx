/**
 * PurchaseFormSheet — نموذج إدخال فاتورة مشتريات (Sheet/Drawer متجاوب)
 *
 * يستبدل الـ Dialog القديم المزدحم. مضبوط على:
 *   - Tabs: بيانات المورد/المستودع · الأصناف · الخصم والضريبة والدفع · الملاحظات
 *   - إدخال سريع لعدد كبير من الأصناف (بحث + إضافة بنقرة + تعديل الكمية بالسهم)
 *   - ملخص ثابت (Subtotal / Tax / Discount / Total) في كل التبويبات
 *   - Responsive: Dialog على الشاشات الكبيرة، Bottom Sheet على الجوال
 *
 * منطق العمل (RPC `create_purchase`) لم يُمسّ إطلاقًا.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Building2,
  Calculator,
  CreditCard,
  Minus,
  Package,
  Plus,
  Search,
  ShoppingCart,
  Trash2,
  TriangleAlert,
  Warehouse,
} from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { VortexDrawerDialog } from "@/components/vortex-ui";
import { FormField } from "@/components/ui/form-field";
import { FieldInput, NumberInput } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { StatusBadge } from "@/components/ui/status-badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/feedback";
import { money } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { toast } from "sonner";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface PurchaseProduct {
  id: string;
  name: string;
  name_ar: string | null;
  sku: string | null;
  barcode: string | null;
  cost_price: number;
  tax_rate: number;
}

export interface PurchaseSupplier {
  id: string;
  name: string;
}

export interface PurchaseWarehouse {
  id: string;
  name: string;
  name_ar: string | null;
}

export interface CartLine {
  product_id: string;
  name: string;
  unit_cost: number;
  tax_rate: number;
  quantity: number;
}

type PaymentMethod = "cash" | "card" | "bank_transfer" | "credit";

const PAYMENT_METHODS: PaymentMethod[] = ["cash", "card", "bank_transfer", "credit"];

export interface PurchaseFormSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void | Promise<void>;
  /** المستودعات可选 — خارج وضع تعدد المستودعات يُمرَّر مستودع واحد. */
  warehouses: PurchaseWarehouse[];
  hasMultiWarehouse: boolean;
}

/* ------------------------------------------------------------------ */
/*  Totals — derived only from the cart lines; no stored state.        */
/* ------------------------------------------------------------------ */

function purchaseTotals(cart: CartLine[], discount: number) {
  const subtotal = cart.reduce((s, l) => s + l.unit_cost * l.quantity, 0);
  const taxTotal = cart.reduce(
    (s, l) => s + l.unit_cost * l.quantity * ((Number(l.tax_rate) || 0) / 100),
    0,
  );
  const total = Math.max(0, subtotal + taxTotal - (Number(discount) || 0));
  return { subtotal, taxTotal, total };
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function PurchaseFormSheet({
  open,
  onOpenChange,
  onSaved,
  warehouses: warehousesProp,
  hasMultiWarehouse,
}: PurchaseFormSheetProps) {
  const { t, lang } = useI18n();
  const isAr = lang === "ar";

  const [products, setProducts] = useState<PurchaseProduct[]>([]);
  const [suppliers, setSuppliers] = useState<PurchaseSupplier[]>([]);
  const [warehouses, setWarehouses] = useState<PurchaseWarehouse[]>(warehousesProp);

  const [warehouseId, setWarehouseId] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [supplierError, setSupplierError] = useState<string | null>(null);
  const [warehouseError, setWarehouseError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [stockMap, setStockMap] = useState<Record<string, number>>({});
  const [cart, setCart] = useState<CartLine[]>([]);

  const [discount, setDiscount] = useState<number | null>(null);
  const [paid, setPaid] = useState<number | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("bank_transfer");
  const [note, setNote] = useState("");

  const [catalogueLoading, setCatalogueLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  const productLabel = useMemo(
    () => (p: Pick<PurchaseProduct, "name" | "name_ar"> | null | undefined) =>
      !p ? "—" : isAr ? p.name_ar || p.name : p.name || p.name_ar || "—",
    [isAr],
  );

  const warehouseLabel = (w: PurchaseWarehouse | null | undefined) =>
    !w ? "—" : isAr ? w.name_ar || w.name : w.name || w.name_ar || "—";

  /* ── Load catalogue once when the sheet opens ── */
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setCatalogueLoading(true);
    void (async () => {
      const [ps, ss, ws] = await Promise.all([
        supabase
          .from("products")
          .select("id,name_ar,sku,barcode,cost_price,tax_rate")
          .eq("is_active", true)
          .order("name")
          .limit(500),
        supabase.from("suppliers").select("id,name").eq("is_active", true).order("name"),
        supabase.from("warehouses").select("id,name_ar").eq("is_active", true).order("name"),
      ]);
      if (cancelled) return;
      setProducts((ps.data ?? []) as PurchaseProduct[]);
      setSuppliers((ss.data ?? []) as PurchaseSupplier[]);
      const resolvedWarehouses = (ws.data ?? []) as PurchaseWarehouse[];
      setWarehouses(resolvedWarehouses);
      setWarehouseId((current) => current || resolvedWarehouses[0]?.id || "");
      setSupplierId((current) => current || (ss.data ?? [])[0]?.id || "");
      setCatalogueLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  /* ── Available stock for the selected warehouse ── */
  useEffect(() => {
    if (!warehouseId) {
      setStockMap({});
      return;
    }
    let cancelled = false;
    void (async () => {
      const { data } = await supabase
        .from("inventory")
        .select("product_id,quantity")
        .eq("warehouse_id", warehouseId);
      if (cancelled) return;
      const next: Record<string, number> = {};
      for (const row of data ?? []) next[row.product_id] = Number(row.quantity ?? 0);
      setStockMap(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [warehouseId]);

  const searchResults = useMemo(() => {
    const q = search.trim().toLowerCase();
    const pool = q
      ? products.filter((p) =>
          [p.name, p.name_ar, p.sku, p.barcode].some((v) => (v ?? "").toLowerCase().includes(q)),
        )
      : products;
    return pool.slice(0, 40);
  }, [products, search]);

  const { subtotal, taxTotal, total } = useMemo(
    () => purchaseTotals(cart, discount ?? 0),
    [cart, discount],
  );

  /* ── Cart operations ── */
  function addToCart(p: PurchaseProduct) {
    setCart((prev) => {
      const idx = prev.findIndex((l) => l.product_id === p.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx], quantity: next[idx].quantity + 1 };
        return next;
      }
      return [
        ...prev,
        {
          product_id: p.id,
          name: productLabel(p),
          unit_cost: Number(p.cost_price) || 0,
          tax_rate: Number(p.tax_rate ?? 0),
          quantity: 1,
        },
      ];
    });
    if (warehouseId && Number(stockMap[p.id] ?? 0) === 0) {
      toast.info(
        isAr
          ? "سيُضاف هذا المنتج كإضافة جديدة إلى مخزون المستودع المحدد"
          : "This product will be added as new stock in the selected warehouse.",
      );
    }
  }

  function updateLine(pid: string, patch: Partial<CartLine>) {
    setCart((c) => c.map((l) => (l.product_id === pid ? { ...l, ...patch } : l)));
  }

  function removeLine(pid: string) {
    setCart((c) => c.filter((l) => l.product_id !== pid));
  }

  function resetForm() {
    setCart([]);
    setSearch("");
    setDiscount(null);
    setPaid(null);
    setNote("");
  }

  /* ── Validation + submit (Business logic untouched) ── */
  const invalidLine = cart.find(
    (line) =>
      !Number.isFinite(line.quantity) ||
      line.quantity <= 0 ||
      !Number.isFinite(line.unit_cost) ||
      line.unit_cost < 0 ||
      !Number.isFinite(line.tax_rate) ||
      line.tax_rate < 0,
  );

  const canSubmit = !saving && cart.length > 0 && !!warehouseId && !!supplierId && !invalidLine;

  async function submit() {
    if (saving) return;
    if (!warehouseId || !supplierId) {
      setWarehouseError(!warehouseId ? t("purchases.select_ws") : null);
      setSupplierError(!supplierId ? t("purchases.select_ws") : null);
      return toast.error(t("purchases.select_ws"));
    }
    if (cart.length === 0) return toast.error(t("purchases.add_items"));
    if (invalidLine) {
      return toast.error(
        isAr
          ? "يجب أن تكون الكمية والتكلفة والضريبة أرقامًا صحيحة غير سالبة"
          : "Quantity, cost and tax must be valid non-negative numbers.",
      );
    }

    setSaving(true);
    try {
      const { error } = await supabase.rpc("create_purchase", {
        _warehouse_id: warehouseId,
        _supplier_id: supplierId,
        _payment_method: paymentMethod,
        _paid: paymentMethod === "credit" ? 0 : (paid ?? total),
        _discount: Number(discount ?? 0),
        _note: (note || null) as never,
        _items: cart.map((l) => ({
          product_id: l.product_id,
          quantity: Number(l.quantity),
          unit_cost: Number(l.unit_cost),
          tax_rate: Number(l.tax_rate),
        })),
      });
      if (error) throw error;
      toast.success(t("purchases.recorded"));
      resetForm();
      onOpenChange(false);
      await onSaved();
    } catch (e: any) {
      toast.error(e?.message ?? t("common.failed"));
    } finally {
      setSaving(false);
    }
  }

  const pmKey = (m: PaymentMethod) => (m === "bank_transfer" ? t("pos.pm.bank") : t(`pos.pm.${m}`));

  /* ── Totals block, reused in the sheet footer summary ── */
  const totalsBlock = (
    <div className="space-y-1.5 rounded-xl border-border/70 bg-surface-2/40 p-3 text-sm">
      <SummaryRow label={t("common.subtotal")} value={money(subtotal)} />
      <SummaryRow label={t("common.tax")} value={money(taxTotal)} />
      <SummaryRow label={t("common.discount")} value={`− ${money(Number(discount ?? 0))}`} />
      <div className="mt-1.5 flex items-center justify-between border-t border-border/60 pt-2">
        <span className="text-xs font-semibold text-muted-foreground">{t("common.total")}</span>
        <span className="font-mono text-lg font-bold text-foreground">{money(total)}</span>
      </div>
    </div>
  );

  return (
    <VortexDrawerDialog
      open={open}
      onOpenChange={onOpenChange}
      size="xl"
      eyebrow={isAr ? "المشتريات" : "Purchases"}
      icon={<ShoppingCart className="h-5 w-5" />}
      title={t("purchases.new_po")}
      subtitle={
        isAr ? "أضف الأصناف، ثم راجع الإجماليات قبل الحفظ" : "Add items, review totals, then save"
      }
      bodyClassName="flex flex-col gap-4"
      footer={
        <div className="flex w-full items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <StatusBadge tone="info">
              {cart.length} {t("purchases.items")}
            </StatusBadge>
            <span className="truncate font-mono text-sm font-bold text-foreground">
              {money(total)}
            </span>
            {cart.length > 0 && (
              <button
                type="button"
                onClick={resetForm}
                className="shrink-0 rounded-full border-border/80 px-2.5 py-1 text-[10px] font-semibold text-muted-foreground transition hover:bg-muted hover:text-foreground"
              >
                {isAr ? "مسح" : "Clear"}
              </button>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button
              type="button"
              variant="outline"
              className="rounded-xl"
              onClick={() => onOpenChange(false)}
              disabled={saving}
            >
              {t("common.cancel")}
            </Button>
            <Button
              type="button"
              onClick={submit}
              loading={saving}
              disabled={!canSubmit}
              className="rounded-xl bg-primary font-semibold text-primary-foreground"
            >
              {t("purchases.save")}
            </Button>
          </div>
        </div>
      }
    >
      <Tabs defaultValue="items" className="flex flex-col gap-4">
        <TabsList className="w-full justify-start overflow-x-auto rounded-xl p-1">
          <TabsTrigger value="items" className="rounded-lg text-xs">
            <Package className="me-1.5 h-3.5 w-3.5" />
            {t("purchases.items")}
          </TabsTrigger>
          <TabsTrigger value="parties" className="rounded-lg text-xs">
            <Building2 className="me-1.5 h-3.5 w-3.5" />
            {isAr ? "المورد والمستودع" : "Supplier & Warehouse"}
          </TabsTrigger>
          <TabsTrigger value="payment" className="rounded-lg text-xs">
            <CreditCard className="me-1.5 h-3.5 w-3.5" />
            {isAr ? "الدفع والضرائب" : "Payment & Tax"}
          </TabsTrigger>
          <TabsTrigger value="notes" className="rounded-lg text-xs">
            {isAr ? "ملاحظات" : "Notes"}
          </TabsTrigger>
        </TabsList>

        {/* ─── Tab: items ─── */}
        <TabsContent value="items" className="mt-0 space-y-3">
          <div className="grid gap-3 lg:grid-cols-2">
            {/* Picker */}
            <div className="flex flex-col gap-2">
              <FormField label={t("purchases.search_products")} showIcon={false}>
                {(p) => (
                  <FieldInput
                    {...p}
                    ref={searchRef}
                    type="search"
                    value={search}
                    onValueChange={setSearch}
                    placeholder={isAr ? "الاسم أو SKU أو الباركود" : "Name, SKU or barcode"}
                    icon={<Search className="size-4" />}
                  />
                )}
              </FormField>

              <div className="max-h-72 overflow-y-auto rounded-xl border-border/70 p-1">
                {catalogueLoading ? (
                  <p className="px-3 py-6 text-center text-xs text-muted-foreground">
                    {t("common.loading")}
                  </p>
                ) : searchResults.length === 0 ? (
                  <EmptyState
                    icon={<Search className="size-4" />}
                    title={isAr ? "لا توجد نتائج" : "No results"}
                    description={
                      isAr ? "جرّب اسماً آخر أو كود صنف." : "Try another name or item code."
                    }
                  />
                ) : (
                  searchResults.map((p) => {
                    const available = Number(stockMap[p.id] ?? 0);
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => addToCart(p)}
                        className="flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-start transition hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-foreground">
                            {productLabel(p)}
                          </span>
                          <span className="block truncate text-[11px] text-muted-foreground">
                            {p.sku ?? "—"}
                            {p.barcode ? ` · ${p.barcode}` : ""}
                          </span>
                        </span>
                        <span className="shrink-0 text-end">
                          <span className="block text-xs font-mono text-foreground">
                            {money(Number(p.cost_price))}
                          </span>
                          <span
                            className={`block text-[10px] ${
                              available === 0
                                ? "text-amber-600 dark:text-amber-400"
                                : "text-muted-foreground"
                            }`}
                          >
                            {isAr ? `المخزون: ${available}` : `Stock: ${available}`}
                          </span>
                        </span>
                      </button>
                    );
                  })
                )}
              </div>
            </div>

            {/* Cart */}
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <p className="text-label text-muted-foreground">
                  {t("purchases.items")} ({cart.length})
                </p>
              </div>

              {cart.length === 0 ? (
                <div className="rounded-xl border-dashed border-border/70">
                  <EmptyState
                    icon={<ShoppingCart className="size-4" />}
                    title={t("purchases.click_to_add")}
                    description={
                      isAr
                        ? "اختر الصنف من القائمة لإضافته، أو ابحث بالباركود."
                        : "Pick an item from the list, or search by barcode."
                    }
                  />
                </div>
              ) : (
                <ul className="max-h-72 space-y-2 overflow-y-auto pe-1">
                  {cart.map((l) => (
                    <li
                      key={l.product_id}
                      className="rounded-xl border-border/70 bg-surface/60 p-2.5"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                          {l.name}
                        </span>
                        <button
                          type="button"
                          onClick={() => removeLine(l.product_id)}
                          aria-label={t("common.delete")}
                          className="shrink-0 rounded-lg p-1 text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>

                      <div className="mt-2 grid-cols-3 gap-2">
                        <div>
                          <span className="mb-1 block text-[10px] font-semibold uppercase text-muted-foreground">
                            {t("common.qty")}
                          </span>
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => updateLine(l.product_id, { quantity: l.quantity - 1 })}
                              aria-label="-"
                              className="grid size-7 shrink-0 place-items-center rounded-lg border-border text-muted-foreground transition hover:bg-muted hover:text-foreground"
                            >
                              <Minus className="h-3 w-3" />
                            </button>
                            <NumberInput
                              containerClassName="min-w-0 flex-1"
                              className="text-center"
                              value={l.quantity}
                              onValueChange={(v) =>
                                updateLine(l.product_id, { quantity: Number(v ?? 0) })
                              }
                            />
                            <button
                              type="button"
                              onClick={() => updateLine(l.product_id, { quantity: l.quantity + 1 })}
                              aria-label="+"
                              className="grid size-7 shrink-0 place-items-center rounded-lg border-border text-muted-foreground transition hover:bg-muted hover:text-foreground"
                            >
                              <Plus className="h-3 w-3" />
                            </button>
                          </div>
                        </div>

                        <div>
                          <span className="mb-1 block text-[10px] font-semibold uppercase text-muted-foreground">
                            {t("common.cost")}
                          </span>
                          <NumberInput
                            decimal
                            className="text-end"
                            value={l.unit_cost}
                            onValueChange={(v) =>
                              updateLine(l.product_id, { unit_cost: Number(v ?? 0) })
                            }
                          />
                        </div>

                        <div>
                          <span className="mb-1 block text-[10px] font-semibold uppercase text-muted-foreground">
                            {t("purchases.tax_pct")}
                          </span>
                          <NumberInput
                            decimal
                            suffix="%"
                            className="text-end"
                            value={l.tax_rate}
                            onValueChange={(v) =>
                              updateLine(l.product_id, { tax_rate: Number(v ?? 0) })
                            }
                          />
                        </div>
                      </div>

                      <p className="mt-1.5 text-end font-mono text-xs text-muted-foreground">
                        {money(l.unit_cost * l.quantity)}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <div className="lg:hidden">{totalsBlock}</div>
        </TabsContent>

        {/* ─── Tab: supplier + warehouse ─── */}
        <TabsContent value="parties" className="mt-0 space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField label={t("common.supplier")} required error={supplierError}>
              {(p) => (
                <FieldInput
                  {...p}
                  list="vortex-purchase-suppliers"
                  value={suppliers.find((s) => s.id === supplierId)?.name ?? ""}
                  onValueChange={(v) => {
                    const match = suppliers.find((s) => s.name === v);
                    if (match) {
                      setSupplierId(match.id);
                      setSupplierError(null);
                    }
                  }}
                  placeholder={isAr ? "اسم المورد" : "Supplier name"}
                  icon={<Building2 className="size-4" />}
                />
              )}
            </FormField>
            <datalist id="vortex-purchase-suppliers">
              {suppliers.map((s) => (
                <option key={s.id} value={s.name} />
              ))}
            </datalist>

            {hasMultiWarehouse && (
              <FormField label={t("common.warehouse")} required error={warehouseError}>
                {(p) => (
                  <FieldInput
                    {...p}
                    list="vortex-purchase-warehouses"
                    value={warehouses.find((w) => w.id === warehouseId)?.name ?? ""}
                    onValueChange={(v) => {
                      const match = warehouses.find((w) => warehouseLabel(w) === v);
                      if (match) {
                        setWarehouseId(match.id);
                        setWarehouseError(null);
                      }
                    }}
                    placeholder={isAr ? "اسم المستودع" : "Warehouse name"}
                    icon={<Warehouse className="size-4" />}
                  />
                )}
              </FormField>
            )}
            <datalist id="vortex-purchase-warehouses">
              {warehouses.map((w) => (
                <option key={w.id} value={warehouseLabel(w)} />
              ))}
            </datalist>
          </div>

          <p className="text-caption text-muted-foreground">
            {isAr
              ? "المخزون المتاح في هذه القائمة يخص المستودع المحدد فقط."
              : "The listed stock belongs to the selected warehouse only."}
          </p>

          <div className="hidden lg:block">{totalsBlock}</div>
        </TabsContent>

        {/* ─── Tab: payment & tax ─── */}
        <TabsContent value="payment" className="mt-0 grid gap-3 lg:grid-cols-2">
          <div className="space-y-3">
            <div>
              <p className="mb-1.5 text-label text-muted-foreground">{t("sales.payment")}</p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {PAYMENT_METHODS.map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setPaymentMethod(m)}
                    className={`h-9 rounded-xl border text-xs font-semibold transition ${
                      paymentMethod === m
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border/80 text-muted-foreground hover:bg-muted hover:text-foreground"
                    }`}
                  >
                    {pmKey(m)}
                  </button>
                ))}
              </div>
            </div>

            {paymentMethod !== "credit" && (
              <FormField
                label={isAr ? "المدفوع" : "Paid amount"}
                hint={t("purchases.paid_default", total.toFixed(2))}
              >
                {(p) => (
                  <NumberInput
                    {...p}
                    decimal
                    value={paid}
                    onValueChange={(v) => setPaid(v)}
                    placeholder={total.toFixed(2)}
                  />
                )}
              </FormField>
            )}

            <FormField label={t("common.discount")}>
              {(p) => (
                <NumberInput
                  {...p}
                  decimal
                  value={discount}
                  onValueChange={(v) => setDiscount(v)}
                  placeholder="0"
                />
              )}
            </FormField>
          </div>

          <div className="hidden lg:block">{totalsBlock}</div>
          <div className="lg:hidden">{totalsBlock}</div>
        </TabsContent>

        {/* ─── Tab: notes ─── */}
        <TabsContent value="notes" className="mt-0 space-y-3">
          <FormField label={isAr ? "ملاحظات الفاتورة" : "Invoice notes"}>
            {(p) => (
              <Textarea
                {...p}
                rows={5}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={t("purchases.note_optional")}
              />
            )}
          </FormField>
          <div className="hidden lg:block">{totalsBlock}</div>
        </TabsContent>
      </Tabs>

      {invalidLine && (
        <p className="flex items-center gap-1.5 text-[11px] font-medium text-destructive">
          <TriangleAlert className="size-3.5 shrink-0" />
          {isAr
            ? `سطر «${invalidLine.name} يحتاج إلى كمية وتكلفة وضريبة صحيحة.`
            : `Line "${invalidLine.name}" needs a valid quantity, cost and tax.`}
        </p>
      )}

      {!invalidLine && cart.length > 0 && (
        <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <Calculator className="size-3.5 shrink-0" />
          {isAr
            ? "الإجمالي محسوب من مجموع بنود الفاتورة فقط."
            : "The total is derived from the invoice lines only."}
        </p>
      )}
    </VortexDrawerDialog>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono text-foreground">{value}</span>
    </div>
  );
}

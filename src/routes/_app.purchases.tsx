import { ModuleGuard, useModules } from "@/lib/modules";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { ShoppingCart, Plus, Search, Eye, X, Loader2, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { useI18n } from "@/lib/i18n";
import { money } from "@/lib/format";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/purchases")({
  head: () => ({ meta: [{ title: "Purchases — Vortex ERP" }] }),
  component: () => (
    <ModuleGuard moduleId="purchases">
      <PurchasesPage />
    </ModuleGuard>
  ),
});

interface Invoice {
  id: string;
  invoice_number: string;
  status: string;
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  paid: number;
  payment_method: string;
  created_at: string;
  suppliers: { name: string } | null;
  warehouses: { name: string; name_ar: string | null } | null;
}
interface Line {
  id: string;
  quantity: number;
  unit_cost: number;
  tax: number;
  total: number;
  products: { name: string; sku: string | null } | null;
}
interface Product {
  id: string;
  name: string;
  name_ar: string | null;
  sku: string | null;
  barcode: string | null;
  cost_price: number;
  tax_rate: number;
  unit?: { short_name?: string | null; name?: string | null; name_ar?: string | null } | null;
  category?: { name?: string | null; name_ar?: string | null } | null;
  inventory?: { warehouse_id: string; quantity: number }[] | null;
}
interface Supplier {
  id: string;
  name: string;
}
interface Warehouse {
  id: string;
  name: string;
  name_ar: string | null;
}
interface CartLine {
  product_id: string;
  name: string;
  unit_cost: number;
  tax_rate: number;
  quantity: number;
}

function PurchasesPage() {
  const { isModuleEnabled } = useModules();
  const hasMultiWarehouse = isModuleEnabled("multi_warehouse");
  const { t, lang } = useI18n();
  const whName = (w?: { name: string; name_ar: string | null } | null) =>
    !w ? "—" : lang === "ar" ? w.name_ar || w.name : w.name || w.name_ar || "—";
  const [rows, setRows] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Invoice | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [creating, setCreating] = useState(false);
  const productLabel = (p?: Pick<Product, "name" | "name_ar"> | null) => (!p ? "—" : lang === "ar" ? (p.name_ar || p.name) : (p.name || p.name_ar || "—"));

  async function load() {
    setLoading(true);
    const { data } = await supabase
      .from("purchase_invoices")
      .select(
        "id,invoice_number,status,subtotal,discount,tax,total,paid,payment_method,created_at,suppliers(name),warehouses(name,name_ar)",
      )
      .order("created_at", { ascending: false })
      .limit(200);
    setRows((data ?? []) as any);
    setLoading(false);
  }
  useEffect(() => {
    void load();
  }, []);

  async function openInvoice(inv: Invoice) {
    setSelected(inv);
    const { data } = await supabase
      .from("purchase_invoice_items")
      .select("id,quantity,unit_cost,tax,total,products(name,sku)")
      .eq("invoice_id", inv.id);
    setLines((data ?? []) as any);
  }

  const filtered = rows.filter(
    (r) =>
      !search ||
      r.invoice_number.toLowerCase().includes(search.toLowerCase()) ||
      (r.suppliers?.name ?? "").toLowerCase().includes(search.toLowerCase()),
  );

  const statusColor = (s: string) =>
    s === "paid"
      ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
      : s === "partial"
        ? "bg-amber-500/10 text-amber-400 border-amber-500/20"
        : s === "cancelled"
          ? "bg-red-500/10 text-red-400 border-red-500/20"
          : "bg-muted text-muted-foreground border-border";

  const pmLabel = (m: string) => {
    const map: Record<string, string> = {
      cash: t("pos.pm.cash"),
      card: t("pos.pm.card"),
      bank_transfer: t("pos.pm.bank"),
      bank: t("pos.pm.bank"),
      credit: t("pos.pm.credit"),
    };
    return map[m] ?? m;
  };
  const statusLabel = (s: string) => {
    const map: Record<string, string> = {
      paid: t("sales.status.paid"),
      partial: t("sales.status.partial"),
      unpaid: t("sales.status.unpaid"),
      cancelled: t("sales.status.cancelled"),
    };
    return map[s] ?? s;
  };

  return (
    <>
      <PageHeader
        title={t("purchases.title")}
        subtitle={t("purchases.subtitle")}
        actions={
          <button
            onClick={() => setCreating(true)}
            className="flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            <Plus className="h-4 w-4" /> {t("purchases.new")}
          </button>
        }
      />
      <div className="panel-elevated p-4">
        <div className="relative mb-4">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground rtl:left-auto rtl:right-3" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("purchases.search")}
            className="h-10 w-full rounded-md border border-input bg-surface pl-9 pr-3 text-sm rtl:pl-3 rtl:pr-9 focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20"
          />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs uppercase tracking-wide text-muted-foreground">
              <tr className="border-b border-border">
                <th className="px-3 py-2 text-start font-medium">{t("purchases.po")}</th>
                <th className="px-3 py-2 text-start font-medium">{t("common.date")}</th>
                <th className="px-3 py-2 text-start font-medium">{t("common.supplier")}</th>
                {hasMultiWarehouse && (
                  <th className="px-3 py-2 text-start font-medium">{t("common.warehouse")}</th>
                )}
                <th className="px-3 py-2 text-start font-medium">{t("sales.payment")}</th>
                <th className="px-3 py-2 text-start font-medium">{t("common.status")}</th>
                <th className="px-3 py-2 text-end font-medium">{t("common.total")}</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td
                    colSpan={hasMultiWarehouse ? 8 : 7}
                    className="py-10 text-center text-muted-foreground"
                  >
                    {t("common.loading")}
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td
                    colSpan={hasMultiWarehouse ? 8 : 7}
                    className="py-12 text-center text-muted-foreground"
                  >
                    <ShoppingCart className="mx-auto mb-2 h-8 w-8 opacity-50" />
                    {t("purchases.no_purchases")}
                  </td>
                </tr>
              ) : (
                filtered.map((r) => (
                  <tr key={r.id} className="border-b border-border/50 hover:bg-surface-2/50">
                    <td className="px-3 py-2.5 font-mono text-xs">{r.invoice_number}</td>
                    <td className="px-3 py-2.5 text-muted-foreground">
                      {new Date(r.created_at).toLocaleString()}
                    </td>
                    <td className="px-3 py-2.5">{r.suppliers?.name ?? "—"}</td>
                    {hasMultiWarehouse && (
                      <td className="px-3 py-2.5 text-muted-foreground">{whName(r.warehouses)}</td>
                    )}
                    <td className="px-3 py-2.5 text-muted-foreground">
                      {pmLabel(r.payment_method)}
                    </td>
                    <td className="px-3 py-2.5">
                      <span
                        className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] ${statusColor(r.status)}`}
                      >
                        {statusLabel(r.status)}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-end font-semibold">{money(Number(r.total))}</td>
                    <td className="px-3 py-2.5 text-end">
                      <button
                        onClick={() => openInvoice(r)}
                        className="rounded p-1.5 text-muted-foreground hover:bg-surface-2 hover:text-foreground"
                      >
                        <Eye className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {selected && (
        <ViewDialog
          invoice={selected}
          lines={lines}
          onClose={() => setSelected(null)}
          pmLabel={pmLabel}
          statusLabel={statusLabel}
          hasMultiWarehouse={hasMultiWarehouse}
        />
      )}
      {creating && (
        <CreateDialog
          onClose={() => setCreating(false)}
          onDone={() => {
            setCreating(false);
            void load();
          }}
          hasMultiWarehouse={hasMultiWarehouse}
        />
      )}
    </>
  );
}

function ViewDialog({
  invoice,
  lines,
  onClose,
  pmLabel,
  statusLabel,
  hasMultiWarehouse,
}: {
  invoice: Invoice;
  lines: Line[];
  onClose: () => void;
  pmLabel: (m: string) => string;
  statusLabel: (s: string) => string;
  hasMultiWarehouse?: boolean;
}) {
  const { t, lang } = useI18n();
  const wh = invoice.warehouses;
  const whLabel = !wh ? "—" : lang === "ar" ? wh.name_ar || wh.name : wh.name || wh.name_ar || "—";
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-background/80 backdrop-blur-sm p-4">
      <div className="panel-elevated w-full max-w-2xl p-6">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h3 className="font-mono text-lg font-semibold">{invoice.invoice_number}</h3>
            <p className="text-xs text-muted-foreground">
              {new Date(invoice.created_at).toLocaleString()}
            </p>
          </div>
          <button onClick={onClose} className="rounded p-1 hover:bg-surface-2">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="mb-4 grid grid-cols-2 gap-3 text-sm">
          <Field label={t("common.supplier")} value={invoice.suppliers?.name ?? "—"} />
          {hasMultiWarehouse && <Field label={t("common.warehouse")} value={whLabel} />}
          <Field label={t("sales.payment")} value={pmLabel(invoice.payment_method)} />
          <Field label={t("common.status")} value={statusLabel(invoice.status)} />
        </div>
        <div className="overflow-hidden rounded-md border border-border">
          <table className="w-full text-sm">
            <thead className="bg-surface text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-start">{t("common.product")}</th>
                <th className="px-3 py-2 text-end">{t("common.qty")}</th>
                <th className="px-3 py-2 text-end">{t("common.cost")}</th>
                <th className="px-3 py-2 text-end">{t("common.total")}</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.id} className="border-t border-border">
                  <td className="px-3 py-2">{l.products?.name ?? "—"}</td>
                  <td className="px-3 py-2 text-end">{l.quantity}</td>
                  <td className="px-3 py-2 text-end">{money(Number(l.unit_cost))}</td>
                  <td className="px-3 py-2 text-end font-medium">{money(Number(l.total))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-4 space-y-1 text-sm">
          <Row label={t("common.subtotal")} value={money(Number(invoice.subtotal))} />
          <Row label={t("common.tax")} value={money(Number(invoice.tax))} />
          <Row label={t("common.discount")} value={money(Number(invoice.discount))} />
          <Row label={t("common.total")} value={money(Number(invoice.total))} bold />
          <Row label={t("common.paid")} value={money(Number(invoice.paid))} />
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={() => window.print()}
            className="h-9 rounded-md border border-border px-4 text-sm hover:bg-surface-2"
          >
            {t("common.print")}
          </button>
          <button
            onClick={onClose}
            className="h-9 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            {t("common.close")}
          </button>
        </div>
      </div>
    </div>
  );
}

function CreateDialog({
  onClose,
  onDone,
  hasMultiWarehouse,
}: {
  onClose: () => void;
  onDone: () => void;
  hasMultiWarehouse?: boolean;
}) {
  const { t, lang } = useI18n();
  const [products, setProducts] = useState<Product[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [warehouseId, setWarehouseId] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [search, setSearch] = useState("");
  const [stockMap, setStockMap] = useState<Record<string, number>>({});
  const [cart, setCart] = useState<CartLine[]>([]);
  const [paid, setPaid] = useState("");
  const [discount, setDiscount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "card" | "bank_transfer" | "credit">(
    "bank_transfer",
  );
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);
  const productLabel = (p?: Pick<Product, "name" | "name_ar"> | null) =>
    !p ? "—" : lang === "ar" ? (p.name_ar || p.name) : (p.name || p.name_ar || "—");
  const lowStockSuggestions = useMemo(
    () =>
      products
        .filter((p) => Number(stockMap[p.id] ?? 0) <= 10)
        .slice(0, 6),
    [products, stockMap],
  );

  useEffect(() => {
    void (async () => {
      const [{ data: ps }, { data: ss }, { data: ws }] = await Promise.all([
        supabase
          .from("products")
          .select(
            "id,name,name_ar,sku,barcode,cost_price,tax_rate,unit:units(short_name,name,name_ar),category:categories(name,name_ar),inventory(warehouse_id,quantity)",
          )
          .eq("is_active", true)
          .order("name")
          .limit(500),
        supabase.from("suppliers").select("id,name").eq("is_active", true).order("name"),
        supabase.from("warehouses").select("id,name,name_ar").eq("is_active", true).order("name"),
      ]);
      setProducts((ps ?? []) as Product[]);
      setSuppliers(ss ?? []);
      setWarehouses(ws ?? []);
      if (ws?.[0]) setWarehouseId(ws[0].id);
      if (ss?.[0]) setSupplierId(ss[0].id);
    })();
  }, []);

  useEffect(() => {
    if (!warehouseId) {
      setStockMap({});
      return;
    }
    void (async () => {
      const { data, error } = await supabase.from("inventory").select("product_id,quantity").eq("warehouse_id", warehouseId);
      if (error) return;
      const next: Record<string, number> = {};
      for (const row of data ?? []) {
        next[row.product_id] = Number(row.quantity ?? 0);
      }
      setStockMap(next);
    })();
  }, [warehouseId]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (q
      ? products.filter((p) =>
          [p.name, p.name_ar, p.sku, p.barcode].some((value) =>
            (value ?? "").toLowerCase().includes(q),
          ),
        )
      : products
    ).slice(0, 30);
  }, [products, search]);

  function addToCart(p: Product) {
    const available = Number(stockMap[p.id] ?? 0);
    setCart((prev) => {
      const idx = prev.findIndex((l) => l.product_id === p.id);
      if (idx >= 0) {
        const n = [...prev];
        const nextQty = n[idx].quantity + 1;
        n[idx] = { ...n[idx], quantity: nextQty };
        return n;
      }
      return [
        ...prev,
        {
          product_id: p.id,
          name: productLabel(p),
          unit_cost: Number(p.cost_price),
          tax_rate: Number(p.tax_rate ?? 0),
          quantity: 1,
        },
      ];
    });
    if (available === 0 && warehouseId) {
      toast.info(
        lang === "ar"
          ? "سيتم إضافة هذا المنتج كإضافة جديدة إلى المخزون في المستودع المحدد"
          : "This product will be added as a new stock entry in the selected warehouse.",
      );
    }
  }

  function clearCart() {
    setCart([]);
    setPaid("");
    setDiscount("");
  }

  function update(pid: string, patch: Partial<CartLine>) {
    setCart((c) => c.map((l) => (l.product_id === pid ? { ...l, ...patch } : l)));
  }

  const subtotal = cart.reduce((s, l) => s + l.unit_cost * l.quantity, 0);
  const taxTotal = cart.reduce((s, l) => s + l.unit_cost * l.quantity * (l.tax_rate / 100), 0);
  const discountN = Number(discount || 0);
  const total = Math.max(0, subtotal + taxTotal - discountN);
  const paidN = Number(paid || 0);

  async function submit() {
    if (!warehouseId || !supplierId) return toast.error(t("purchases.select_ws"));
    if (cart.length === 0) return toast.error(t("purchases.add_items"));

    const invalidLine = cart.find((line) => !Number.isFinite(line.quantity) || line.quantity <= 0 || !Number.isFinite(line.unit_cost) || line.unit_cost < 0 || !Number.isFinite(line.tax_rate) || line.tax_rate < 0);
    if (invalidLine) {
      return toast.error(lang === "ar" ? "يجب أن تكون الكمية والسعر والضريبة أرقامًا صحيحة وموجبة" : "Quantity, cost, and tax must be valid positive numbers.");
    }

    setLoading(true);
    try {
      const { error } = await supabase.rpc("create_purchase", {
        _warehouse_id: warehouseId,
        _supplier_id: supplierId,
        _payment_method: paymentMethod,
        _paid: paymentMethod === "credit" ? 0 : paidN || total,
        _discount: discountN,
        _note: (note || null) as any,
        _items: cart.map((l) => ({
          product_id: l.product_id,
          quantity: Number(l.quantity),
          unit_cost: Number(l.unit_cost),
          tax_rate: Number(l.tax_rate),
        })),
      });
      if (error) throw error;
      toast.success(t("purchases.recorded"));
      onDone();
    } catch (e: any) {
      toast.error(e.message ?? t("common.failed"));
    } finally {
      setLoading(false);
    }
  }

  const pmKey = (m: string) => (m === "bank_transfer" ? t("pos.pm.bank") : t(`pos.pm.${m}`));

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-background/80 backdrop-blur-sm p-4">
      <div className="panel-elevated flex max-h-[90vh] w-full max-w-4xl flex-col p-6">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold">{t("purchases.new_po")}</h3>
          <button onClick={onClose} className="rounded p-1 hover:bg-surface-2">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mb-3 grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">
              {t("common.supplier")} *
            </label>
            <select
              value={supplierId}
              onChange={(e) => setSupplierId(e.target.value)}
              className="h-9 w-full rounded-md border border-input bg-surface px-2 text-sm"
            >
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">
              {t("common.warehouse")} *
            </label>
            <select
              value={warehouseId}
              onChange={(e) => setWarehouseId(e.target.value)}
              className="h-9 w-full rounded-md border border-input bg-surface px-2 text-sm"
            >
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {lang === "ar" ? w.name_ar || w.name : w.name || w.name_ar || ""}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="mb-3 flex items-center justify-between gap-2 rounded-xl border border-border/70 bg-surface/80 px-3 py-2 text-[11px] text-muted-foreground">
          <div className="flex items-center gap-2">
            <span className="inline-flex rounded-full bg-primary/10 px-2 py-1 font-medium text-primary">
              {cart.length} {t("purchases.items")}
            </span>
            <span>{money(total)}</span>
          </div>
          {cart.length > 0 && (
            <button
              type="button"
              onClick={clearCart}
              className="rounded-md border border-border px-2 py-1 text-[10px] font-medium hover:bg-surface-2"
            >
              {lang === "ar" ? "مسح السلة" : "Clear cart"}
            </button>
          )}
        </div>

        <div className="grid flex-1 grid-cols-1 gap-4 overflow-hidden md:grid-cols-2">
          <div className="flex flex-col overflow-hidden">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("purchases.search_products")}
              className="mb-2 h-9 rounded-md border border-input bg-surface px-3 text-sm"
            />
            {!search && lowStockSuggestions.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-1.5">
                {lowStockSuggestions.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => addToCart(p)}
                    className="inline-flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-[10px] font-medium text-amber-700 dark:text-amber-300"
                  >
                    {productLabel(p)}
                    <span className="font-mono">({Number(stockMap[p.id] ?? 0)})</span>
                  </button>
                ))}
              </div>
            )}
            <div className="flex-1 overflow-y-auto space-y-1 pr-1">
              {filtered.map((p) => {
                const available = Number(stockMap[p.id] ?? 0);
                return (
                  <button
                    key={p.id}
                    onClick={() => addToCart(p)}
                    className="flex w-full items-center justify-between gap-3 rounded border border-border bg-surface px-3 py-2 text-sm hover:border-ring hover:bg-surface-2"
                  >
                    <div className="min-w-0 flex-1 text-start">
                      <div className="truncate font-medium">{productLabel(p)}</div>
                      <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                        <span>{p.sku ?? "—"}</span>
                        {p.barcode && <span className="font-mono">{p.barcode}</span>}
                      </div>
                    </div>
                    <div className="text-end">
                      <div className="text-xs text-muted-foreground">{money(Number(p.cost_price))}</div>
                      <div className="text-[10px] text-muted-foreground">
                        {lang === "ar" ? `المخزون: ${available}` : `Stock: ${available}`}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex flex-col overflow-hidden">
            <div className="mb-2 text-xs font-medium text-muted-foreground">
              {t("purchases.items")} ({cart.length})
            </div>
            <div className="flex-1 overflow-y-auto space-y-2 pr-1">
              {cart.length === 0 ? (
                <div className="grid place-items-center py-10 text-sm text-muted-foreground">
                  {t("purchases.click_to_add")}
                </div>
              ) : (
                cart.map((l) => (
                  <div key={l.product_id} className="rounded border border-border bg-surface p-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="truncate text-sm font-medium">{l.name}</div>
                      <button
                        onClick={() =>
                          setCart((c) => c.filter((x) => x.product_id !== l.product_id))
                        }
                        className="text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <div className="mt-2 grid grid-cols-3 gap-1">
                      <NumberInput
                        label={t("common.qty")}
                        value={l.quantity}
                        onChange={(v) => update(l.product_id, { quantity: v })}
                      />
                      <NumberInput
                        label={t("common.cost")}
                        value={l.unit_cost}
                        onChange={(v) => update(l.product_id, { unit_cost: v })}
                        step={0.01}
                      />
                      <NumberInput
                        label={t("purchases.tax_pct")}
                        value={l.tax_rate}
                        onChange={(v) => update(l.product_id, { tax_rate: v })}
                      />
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3 border-t border-border pt-3 text-sm">
          <div className="space-y-2">
            <div className="grid grid-cols-4 gap-1">
              {(["cash", "card", "bank_transfer", "credit"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setPaymentMethod(m)}
                  className={`h-8 rounded-md border text-xs transition ${paymentMethod === m ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-surface-2"}`}
                >
                  {pmKey(m)}
                </button>
              ))}
            </div>
            {paymentMethod !== "credit" && (
              <input
                type="number"
                value={paid}
                onChange={(e) => setPaid(e.target.value)}
                placeholder={t("purchases.paid_default", total.toFixed(2))}
                className="h-9 w-full rounded-md border border-input bg-surface px-2 text-sm"
              />
            )}
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t("purchases.note_optional")}
              className="h-9 w-full rounded-md border border-input bg-surface px-2 text-sm"
            />
          </div>
          <div className="space-y-1.5">
            <Row label={t("common.subtotal")} value={money(subtotal)} />
            <Row label={t("common.tax")} value={money(taxTotal)} />
            <div className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground">{t("common.discount")}</span>
              <input
                type="number"
                value={discount}
                onChange={(e) => setDiscount(e.target.value)}
                placeholder="0"
                className="h-7 w-24 rounded border border-border bg-surface px-2 text-end text-xs"
              />
            </div>
            <Row label={t("common.total")} value={money(total)} bold />
            <button
              onClick={submit}
              disabled={loading || cart.length === 0}
              className="mt-1 flex h-10 w-full items-center justify-center gap-2 rounded-md bg-primary text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              {loading && <Loader2 className="h-4 w-4 animate-spin" />}
              {t("purchases.save")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function NumberInput({
  label,
  value,
  onChange,
  step = 1,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
}) {
  return (
    <div>
      <label className="block text-[10px] uppercase text-muted-foreground">{label}</label>
      <input
        type="number"
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-7 w-full rounded border border-border bg-surface px-1.5 text-xs"
      />
    </div>
  );
}
function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="capitalize">{value}</p>
    </div>
  );
}
function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div
      className={`flex items-center justify-between ${bold ? "text-base font-semibold" : "text-muted-foreground"}`}
    >
      <span>{label}</span>
      <span className={bold ? "text-foreground" : ""}>{value}</span>
    </div>
  );
}

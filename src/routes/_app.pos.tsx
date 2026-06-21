import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Search, Plus, Minus, Trash2, ScanBarcode, Loader2, X, Printer } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import { money } from "@/lib/format";
import { PageHeader } from "@/components/page-header";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/pos")({
  head: () => ({ meta: [{ title: "POS — Vortex ERP" }] }),
  component: POSPage,
});

interface Product {
  id: string;
  sku: string | null;
  barcode: string | null;
  name: string;
  name_ar: string | null;
  sale_price: number;
  tax_rate: number;
  image_url: string | null;
}
interface CartLine {
  product_id: string;
  name: string;
  unit_price: number;
  tax_rate: number;
  quantity: number;
}
interface Warehouse { id: string; name: string }
interface Customer { id: string; name: string }

function POSPage() {
  const { t, lang } = useI18n();
  const [products, setProducts] = useState<Product[]>([]);
  const [stockMap, setStockMap] = useState<Record<string, number>>({});
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [warehouseId, setWarehouseId] = useState<string>("");
  const [customerId, setCustomerId] = useState<string>("");
  const [search, setSearch] = useState("");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [paid, setPaid] = useState<string>("");
  const [discount, setDiscount] = useState<string>("");
  const [paymentMethod, setPaymentMethod] = useState<"cash"|"card"|"bank"|"credit">("cash");
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);
  const [lastInvoice, setLastInvoice] = useState<{ id: string; number: string } | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => { void loadAll(); }, []);
  useEffect(() => { if (warehouseId) void loadStock(warehouseId); }, [warehouseId]);

  async function loadAll() {
    const [{ data: ws }, { data: cs }, { data: ps }] = await Promise.all([
      supabase.from("warehouses").select("id,name").eq("is_active", true).order("name"),
      supabase.from("customers").select("id,name").eq("is_active", true).order("name"),
      supabase.from("products").select("id,sku,barcode,name,name_ar,sale_price,tax_rate,image_url").eq("is_active", true).order("name").limit(500),
    ]);
    setWarehouses(ws ?? []);
    setCustomers(cs ?? []);
    setProducts(ps ?? []);
    if (ws?.[0]) setWarehouseId(ws[0].id);
  }
  async function loadStock(wid: string) {
    const { data } = await supabase.from("inventory").select("product_id,quantity").eq("warehouse_id", wid);
    const m: Record<string, number> = {};
    (data ?? []).forEach((r: any) => { m[r.product_id] = Number(r.quantity); });
    setStockMap(m);
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return products.slice(0, 60);
    return products.filter(p =>
      p.name.toLowerCase().includes(q) ||
      (p.name_ar ?? "").includes(q) ||
      (p.sku ?? "").toLowerCase().includes(q) ||
      (p.barcode ?? "").toLowerCase().includes(q)
    ).slice(0, 60);
  }, [products, search]);

  function addToCart(p: Product) {
    const stock = stockMap[p.id] ?? 0;
    setCart(prev => {
      const idx = prev.findIndex(l => l.product_id === p.id);
      if (idx >= 0) {
        const next = [...prev];
        if (next[idx].quantity + 1 > stock) { toast.error(`Max stock: ${stock}`); return prev; }
        next[idx] = { ...next[idx], quantity: next[idx].quantity + 1 };
        return next;
      }
      if (stock < 1) { toast.error("Out of stock"); return prev; }
      return [...prev, {
        product_id: p.id,
        name: lang === "ar" && p.name_ar ? p.name_ar : p.name,
        unit_price: Number(p.sale_price),
        tax_rate: Number(p.tax_rate ?? 0),
        quantity: 1,
      }];
    });
  }

  function setQty(pid: string, qty: number) {
    const stock = stockMap[pid] ?? 0;
    if (qty < 1) return setCart(c => c.filter(l => l.product_id !== pid));
    if (qty > stock) { toast.error(`Max stock: ${stock}`); return; }
    setCart(c => c.map(l => l.product_id === pid ? { ...l, quantity: qty } : l));
  }

  function handleScan(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter") return;
    const q = search.trim();
    if (!q) return;
    const exact = products.find(p => p.barcode === q || p.sku === q);
    if (exact) { addToCart(exact); setSearch(""); return; }
    if (filtered.length === 1) { addToCart(filtered[0]); setSearch(""); }
  }

  const subtotal = cart.reduce((s, l) => s + l.unit_price * l.quantity, 0);
  const taxTotal = cart.reduce((s, l) => s + l.unit_price * l.quantity * (l.tax_rate / 100), 0);
  const discountN = Number(discount || 0);
  const total = Math.max(0, subtotal + taxTotal - discountN);
  const paidN = Number(paid || 0);
  const change = Math.max(0, paidN - total);

  async function checkout() {
    if (!warehouseId) return toast.error("Select a warehouse");
    if (cart.length === 0) return toast.error("Cart is empty");
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc("create_sale", {
        _warehouse_id: warehouseId,
        _customer_id: (customerId || null) as any,
        _payment_method: paymentMethod,
        _paid: paymentMethod === "credit" ? 0 : (paidN || total),
        _discount: discountN,
        _note: (note || null) as any,
        _items: cart.map(l => ({
          product_id: l.product_id,
          quantity: l.quantity,
          unit_price: l.unit_price,
          tax_rate: l.tax_rate,
        })),
      });
      if (error) throw error;
      const invoiceId = data as string;
      const { data: inv } = await supabase.from("sales_invoices").select("invoice_number").eq("id", invoiceId).maybeSingle();
      setLastInvoice({ id: invoiceId, number: inv?.invoice_number ?? "" });
      toast.success(`Sale complete — ${inv?.invoice_number ?? ""}`);
      setCart([]); setPaid(""); setDiscount(""); setNote("");
      await loadStock(warehouseId);
      searchRef.current?.focus();
    } catch (err: any) {
      toast.error(err.message ?? "Checkout failed");
    } finally { setLoading(false); }
  }

  return (
    <>
      <PageHeader
        title={t("pos.title")}
        subtitle="Scan, click, checkout. Stock auto-decrements on each sale."
        actions={
          <div className="flex items-center gap-2">
            <select value={warehouseId} onChange={e => setWarehouseId(e.target.value)} className="h-9 rounded-md border border-input bg-surface px-2 text-sm">
              {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </div>
        }
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_420px]">
        {/* Product grid */}
        <div className="panel-elevated p-4">
          <div className="relative mb-4">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground rtl:left-auto rtl:right-3" />
            <input
              ref={searchRef}
              value={search}
              onChange={e => setSearch(e.target.value)}
              onKeyDown={handleScan}
              placeholder="Search or scan barcode..."
              className="h-10 w-full rounded-md border border-input bg-surface pl-9 pr-3 text-sm rtl:pl-3 rtl:pr-9 focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20"
              autoFocus
            />
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4 max-h-[calc(100vh-280px)] overflow-y-auto pr-1">
            {filtered.map(p => {
              const stock = stockMap[p.id] ?? 0;
              const low = stock <= 0;
              return (
                <button
                  key={p.id}
                  onClick={() => addToCart(p)}
                  disabled={low}
                  className="group relative flex flex-col items-start gap-1 rounded-lg border border-border bg-surface p-3 text-start transition hover:border-ring hover:bg-surface-2 disabled:opacity-40"
                >
                  <div className="line-clamp-2 text-sm font-medium">{lang === "ar" && p.name_ar ? p.name_ar : p.name}</div>
                  <div className="text-[11px] text-muted-foreground">{p.sku ?? "—"}</div>
                  <div className="mt-1 flex w-full items-center justify-between">
                    <span className="text-sm font-semibold text-primary">{money(Number(p.sale_price))}</span>
                    <span className={`text-[10px] ${low ? "text-destructive" : "text-muted-foreground"}`}>{stock}</span>
                  </div>
                </button>
              );
            })}
            {filtered.length === 0 && (
              <div className="col-span-full grid place-items-center py-12 text-sm text-muted-foreground">
                <ScanBarcode className="mb-2 h-8 w-8 opacity-50" />
                No products match
              </div>
            )}
          </div>
        </div>

        {/* Cart */}
        <div className="panel-elevated flex flex-col p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold">Cart ({cart.length})</h2>
            {cart.length > 0 && (
              <button onClick={() => setCart([])} className="text-xs text-muted-foreground hover:text-destructive">
                Clear
              </button>
            )}
          </div>

          <div className="mb-3">
            <select value={customerId} onChange={e => setCustomerId(e.target.value)} className="h-9 w-full rounded-md border border-input bg-surface px-2 text-sm">
              <option value="">Walk-in customer</option>
              {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>

          <div className="flex-1 space-y-2 overflow-y-auto max-h-[40vh]">
            {cart.length === 0 ? (
              <div className="grid place-items-center py-10 text-sm text-muted-foreground">Empty</div>
            ) : cart.map(l => (
              <div key={l.product_id} className="rounded-md border border-border bg-surface p-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{l.name}</div>
                    <div className="text-[11px] text-muted-foreground">{money(l.unit_price)} × {l.quantity}</div>
                  </div>
                  <button onClick={() => setQty(l.product_id, 0)} className="rounded p-1 text-muted-foreground hover:bg-surface-2 hover:text-destructive">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
                <div className="mt-2 flex items-center justify-between">
                  <div className="flex items-center gap-1">
                    <button onClick={() => setQty(l.product_id, l.quantity - 1)} className="grid h-6 w-6 place-items-center rounded border border-border hover:bg-surface-2"><Minus className="h-3 w-3" /></button>
                    <input
                      type="number"
                      value={l.quantity}
                      onChange={e => setQty(l.product_id, Number(e.target.value))}
                      className="h-6 w-12 rounded border border-border bg-surface text-center text-xs"
                    />
                    <button onClick={() => setQty(l.product_id, l.quantity + 1)} className="grid h-6 w-6 place-items-center rounded border border-border hover:bg-surface-2"><Plus className="h-3 w-3" /></button>
                  </div>
                  <span className="text-sm font-semibold">{money(l.unit_price * l.quantity * (1 + l.tax_rate / 100))}</span>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-4 space-y-2 border-t border-border pt-3 text-sm">
            <Row label="Subtotal" value={money(subtotal)} />
            <Row label="Tax" value={money(taxTotal)} />
            <div className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground">Discount</span>
              <input type="number" value={discount} onChange={e => setDiscount(e.target.value)} placeholder="0" className="h-7 w-24 rounded border border-border bg-surface px-2 text-end text-xs" />
            </div>
            <Row label="Total" value={money(total)} bold />
          </div>

          <div className="mt-3 grid grid-cols-4 gap-1">
            {(["cash","card","bank","credit"] as const).map(m => (
              <button key={m} onClick={() => setPaymentMethod(m)} className={`h-8 rounded-md border text-xs capitalize transition ${paymentMethod === m ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-surface-2"}`}>{m}</button>
            ))}
          </div>

          {paymentMethod !== "credit" && (
            <div className="mt-2 flex items-center gap-2">
              <input type="number" value={paid} onChange={e => setPaid(e.target.value)} placeholder={`Paid (default ${total.toFixed(2)})`} className="h-9 flex-1 rounded-md border border-input bg-surface px-2 text-sm" />
              {paidN > 0 && change > 0 && <span className="text-xs text-muted-foreground">Change: {money(change)}</span>}
            </div>
          )}

          <button
            onClick={checkout}
            disabled={loading || cart.length === 0}
            className="mt-3 flex h-11 items-center justify-center gap-2 rounded-md bg-primary text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
          >
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            Checkout · {money(total)}
          </button>
        </div>
      </div>

      {lastInvoice && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-background/80 backdrop-blur-sm p-4">
          <div className="panel-elevated w-full max-w-sm p-6">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold">Sale completed</h3>
              <button onClick={() => setLastInvoice(null)} className="rounded p-1 hover:bg-surface-2"><X className="h-4 w-4" /></button>
            </div>
            <p className="text-sm text-muted-foreground">Invoice number</p>
            <p className="mb-4 font-mono text-lg">{lastInvoice.number}</p>
            <div className="flex gap-2">
              <button onClick={() => window.print()} className="flex h-9 flex-1 items-center justify-center gap-2 rounded-md border border-border text-sm hover:bg-surface-2">
                <Printer className="h-4 w-4" /> Print
              </button>
              <button onClick={() => setLastInvoice(null)} className="h-9 flex-1 rounded-md bg-primary text-sm font-medium text-primary-foreground hover:opacity-90">New sale</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className={`flex items-center justify-between ${bold ? "text-base font-semibold" : "text-muted-foreground"}`}>
      <span>{label}</span>
      <span className={bold ? "text-foreground" : ""}>{value}</span>
    </div>
  );
}

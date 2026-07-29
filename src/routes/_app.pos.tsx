import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Search, Plus, Minus, Trash2, ScanBarcode, Loader2, X, Printer, Sparkles, ScrollText, FileDown, Filter, Warehouse, ChevronDown } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import { money } from "@/lib/format";
import { PageHeader } from "@/components/page-header";
import { toast } from "sonner";
import { printInvoice, type InvoiceTemplate } from "@/lib/invoice-print";
import { generateInvoicePDF, type InvoiceDoc } from "@/lib/pdf";
import { BarcodeScanner } from "@/components/barcode-scanner";

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
  category_id?: string | null;
  brand_id?: string | null;
  unit_id?: string | null;
  unit?: { short_name: string; name_ar: string | null; name: string } | null;
  category?: { name: string; name_ar: string | null } | null;
  brand?: { name: string; name_ar: string | null } | null;
}
interface CartLine {
  product_id: string;
  name: string;
  unit_price: number;
  tax_rate: number;
  quantity: number;
}
interface Warehouse { id: string; name: string; name_ar: string | null }
interface Customer { id: string; name: string }
interface MetaOption { id: string; name: string; name_ar: string | null; short_name?: string }

function POSPage() {
  const { t, lang } = useI18n();
  const [products, setProducts] = useState<Product[]>([]);
  const [stockMap, setStockMap] = useState<Record<string, number>>({});
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [categories, setCategories] = useState<MetaOption[]>([]);
  const [brands, setBrands] = useState<MetaOption[]>([]);
  const [units, setUnits] = useState<MetaOption[]>([]);
  const [warehouseId, setWarehouseId] = useState<string>("");
  const [customerId, setCustomerId] = useState<string>("");
  const [search, setSearch] = useState("");
  const [filterOpen, setFilterOpen] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState("");
  const [selectedBrand, setSelectedBrand] = useState("");
  const [selectedUnit, setSelectedUnit] = useState("");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [paid, setPaid] = useState<string>("");
  const [discount, setDiscount] = useState<string>("");
  const [paymentMethod, setPaymentMethod] = useState<"cash"|"card"|"bank_transfer"|"credit">("cash");
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);
  const [lastInvoice, setLastInvoice] = useState<{ id: string; number: string } | null>(null);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [hardwareScannerActive, setHardwareScannerActive] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const scanHandlerRef = useRef<(code: string) => void>(() => undefined);

  useEffect(() => { void loadAll(); }, []);
  useEffect(() => { if (warehouseId) void loadStock(warehouseId); }, [warehouseId]);

  useEffect(() => {
    const channel = supabase.channel("pos-live-meta");
    const tables = ["categories", "brands", "units", "products", "warehouses", "customers"] as const;

    tables.forEach(table => {
      channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table },
        () => { void loadAll(); }
      );
    });

    channel.subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, []);

  async function loadAll() {
    const [{ data: ws }, { data: cs }, { data: ps }, { data: cats }, { data: brs }, { data: uns }] = await Promise.all([
      supabase.from("warehouses").select("id,name,name_ar").eq("is_active", true).order("name"),
      supabase.from("customers").select("id,name").eq("is_active", true).order("name"),
      supabase.from("products").select("id,sku,barcode,name,name_ar,sale_price,tax_rate,image_url,category_id,brand_id,unit_id,unit:units(short_name,name,name_ar),category:categories(name,name_ar),brand:brands(name,name_ar)").eq("is_active", true).order("name").limit(500),
      supabase.from("categories").select("id,name,name_ar").order("name"),
      supabase.from("brands").select("id,name,name_ar").order("name"),
      supabase.from("units").select("id,name,name_ar,short_name").order("name"),
    ]);

    setWarehouses(ws ?? []);
    setCustomers(cs ?? []);
    setProducts(ps as any ?? []);
    setCategories(cats ?? []);
    setBrands(brs ?? []);
    setUnits(uns ?? []);

    if (!warehouseId && ws && ws.length > 0) setWarehouseId(ws[0].id);
  }

  async function loadStock(whId: string) {
    const { data } = await supabase.from("inventory").select("product_id,quantity").eq("warehouse_id", whId);
    const map: Record<string, number> = {};
    (data ?? []).forEach(r => { map[r.product_id] = Number(r.quantity); });
    setStockMap(map);
  }

  const filtered = useMemo(() => {
    return products.filter(p => {
      const q = search.trim().toLowerCase();
      const matchesSearch =
        !q ||
        p.name.toLowerCase().includes(q) ||
        (p.name_ar ?? "").includes(q) ||
        (p.sku ?? "").toLowerCase().includes(q) ||
        (p.barcode ?? "").toLowerCase().includes(q);

      const matchesCat = !selectedCategory || p.category_id === selectedCategory;
      const matchesBrand = !selectedBrand || p.brand_id === selectedBrand;
      const matchesUnit = !selectedUnit || p.unit_id === selectedUnit;

      return matchesSearch && matchesCat && matchesBrand && matchesUnit;
    });
  }, [products, search, selectedCategory, selectedBrand, selectedUnit]);

  function addToCart(p: Product) {
    const stock = stockMap[p.id] ?? 0;
    if (stock <= 0) return toast.error(`${p.name} ${t("pos.out_of_stock")}`);
    const name = lang === "ar" && p.name_ar ? p.name_ar : p.name;
    setCart(c => {
      const existing = c.find(l => l.product_id === p.id);
      if (existing) {
        if (existing.quantity >= stock) { toast.error(`${t("pos.max_stock")}: ${stock}`); return c; }
        return c.map(l => l.product_id === p.id ? { ...l, quantity: l.quantity + 1 } : l);
      }
      return [...c, { product_id: p.id, name, unit_price: Number(p.sale_price), tax_rate: Number(p.tax_rate ?? 0), quantity: 1 }];
    });
  }

  function setQty(pid: string, qty: number) {
    const stock = stockMap[pid] ?? 0;
    if (qty < 1) return setCart(c => c.filter(l => l.product_id !== pid));
    if (qty > stock) { toast.error(`${t("pos.max_stock")}: ${stock}`); return; }
    setCart(c => c.map(l => l.product_id === pid ? { ...l, quantity: qty } : l));
  }

  function handleScan(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter") return;
    const q = search.trim();
    if (!q) return;
    handleCode(q);
  }

  function handleCode(code: string) {
    const q = code.trim();
    if (!q) return;
    const exact = products.find(p => p.barcode === q || p.sku === q);
    if (exact) { addToCart(exact); confirmScan(); setSearch(""); return; }
    const partial = products.filter(p =>
      p.name.toLowerCase().includes(q.toLowerCase()) ||
      (p.name_ar ?? "").includes(q) ||
      (p.sku ?? "").toLowerCase().includes(q.toLowerCase()) ||
      (p.barcode ?? "").toLowerCase().includes(q.toLowerCase())
    );
    if (partial.length === 1) { addToCart(partial[0]); confirmScan(); setSearch(""); return; }
    toast.error(lang === "ar" ? `لم يُعثر على منتج للباركود: ${q}` : `No product for: ${q}`);
  }

  function confirmScan() {
    navigator.vibrate?.(35);
  }

  scanHandlerRef.current = handleCode;

  useEffect(() => {
    const handleGlobalShortcuts = (e: KeyboardEvent) => {
      if (e.key === "F2") {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (e.key === "F4") {
        e.preventDefault();
        setScannerOpen(v => !v);
      } else if (e.key === "F9" || (e.ctrlKey && e.key === "Enter")) {
        e.preventDefault();
        if (cart.length > 0 && !loading) {
          void checkout();
        }
      }
    };
    window.addEventListener("keydown", handleGlobalShortcuts);
    return () => window.removeEventListener("keydown", handleGlobalShortcuts);
  }, [cart, loading, warehouseId, customerId, paymentMethod, paid, discount]);

  const subtotal = cart.reduce((s, l) => s + l.unit_price * l.quantity, 0);
  const taxTotal = cart.reduce((s, l) => s + l.unit_price * l.quantity * (l.tax_rate / 100), 0);
  const discountN = Number(discount || 0);
  const total = Math.max(0, subtotal + taxTotal - discountN);
  const paidN = Number(paid || 0);
  const change = Math.max(0, paidN - total);

  async function checkout() {
    if (!warehouseId) return toast.error(t("pos.select_warehouse"));
    if (cart.length === 0) return toast.error(t("pos.cart_empty"));
    if (paymentMethod === "credit" && !customerId) return toast.error(lang === "ar" ? "يرجى اختيار عميل للبيع الآجل" : "Please select a customer for credit sale");

    setLoading(true);
    try {
      const { data, error } = await supabase.rpc("create_sale", {
        _warehouse_id: warehouseId,
        _customer_id: (customerId || null) as any,
        _payment_method: paymentMethod,
        _paid: paymentMethod === "credit" ? (paid ? Number(paid) : 0) : (paidN || total),
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
      toast.success(`${t("pos.sale_complete")} — ${inv?.invoice_number ?? ""}`);
      setCart([]); setPaid(""); setDiscount(""); setNote("");
      await loadStock(warehouseId);
      searchRef.current?.focus();
    } catch (err: any) {
      toast.error(err.message ?? t("pos.checkout_failed"));
    } finally { setLoading(false); }
  }

  const selectClassName = "h-9 w-full appearance-none rounded-md border border-input bg-surface px-3 text-xs outline-none focus:border-ring focus:ring-2 focus:ring-ring/20";

  return (
    <>
      <PageHeader title={t("pos.title")} subtitle={t("pos.subtitle")} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_420px]">
        {/* Product grid */}
        <div className="order-2 panel-elevated p-4 lg:order-1">
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <div className="flex min-w-0 flex-1 items-center gap-2 rounded-full border border-input bg-surface px-3 h-10 shadow-sm">
              <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
              <input
                ref={searchRef}
                value={search}
                onChange={e => setSearch(e.target.value)}
                onKeyDown={handleScan}
                placeholder={`${t("pos.search_or_scan")} (F2)`}
                className="w-full flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                autoFocus
              />
              <kbd className="hidden sm:inline-block rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground">F2</kbd>
            </div>

            <button
              type="button"
              onClick={() => setFilterOpen(v => !v)}
              className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-full border border-border bg-surface px-3 text-sm text-muted-foreground transition hover:border-ring hover:text-foreground"
            >
              <Filter className="h-4 w-4" />
              <span className="hidden sm:inline">{t("common.filter")}</span>
            </button>

            <button
              type="button"
              onClick={() => setScannerOpen(true)}
              className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-primary/30 bg-primary/10 text-primary transition hover:bg-primary/20"
              title={lang === "ar" ? "قراءة الباركود بالكاميرا (F4)" : "Scan with camera (F4)"}
            >
              <ScanBarcode className="h-4 w-4" />
            </button>

            <div className="relative shrink-0">
              <select
                value={warehouseId}
                onChange={e => setWarehouseId(e.target.value)}
                className="h-10 appearance-none rounded-full border border-amber-500/30 bg-amber-500/10 pl-9 pr-8 text-xs font-semibold text-amber-600 dark:text-amber-300 outline-none hover:bg-amber-500/20 rtl:pl-8 rtl:pr-9"
              >
                {warehouses.map(w => <option key={w.id} value={w.id}>{lang === "ar" ? (w.name_ar || w.name) : (w.name || w.name_ar)}</option>)}
              </select>
              <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-amber-700 dark:text-amber-300" />
            </div>
          </div>

          {filterOpen && (
            <div className="mb-4 rounded-[28px] border border-border bg-surface/90 p-3 shadow-sm">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm font-semibold">{t("pos.filters")}</div>
                <button type="button" onClick={() => { setSelectedCategory(""); setSelectedBrand(""); setSelectedUnit(""); }} className="text-xs text-muted-foreground hover:text-foreground">
                  {t("common.reset")}
                </button>
              </div>
              <div className="grid gap-2 md:grid-cols-3">
                <label className="grid gap-1.5 text-xs text-muted-foreground">
                  <span>{t("common.categories")}</span>
                  <div className="relative">
                    <select value={selectedCategory} onChange={(e) => setSelectedCategory(e.target.value)} className={selectClassName}>
                      <option value="">{t("common.all")}</option>
                      {categories.map(c => <option key={c.id} value={c.id}>{lang === "ar" ? (c.name_ar || c.name) : (c.name || c.name_ar || "")}</option>)}
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  </div>
                </label>
                <label className="grid gap-1.5 text-xs text-muted-foreground">
                  <span>{t("common.brands")}</span>
                  <div className="relative">
                    <select value={selectedBrand} onChange={(e) => setSelectedBrand(e.target.value)} className={selectClassName}>
                      <option value="">{t("common.all")}</option>
                      {brands.map(b => <option key={b.id} value={b.id}>{lang === "ar" ? (b.name_ar || b.name) : (b.name || b.name_ar || "")}</option>)}
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  </div>
                </label>
                <label className="grid gap-1.5 text-xs text-muted-foreground">
                  <span>{t("common.units")}</span>
                  <div className="relative">
                    <select value={selectedUnit} onChange={(e) => setSelectedUnit(e.target.value)} className={selectClassName}>
                      <option value="">{t("common.all")}</option>
                      {units.map(u => <option key={u.id} value={u.id}>{lang === "ar" ? (u.name_ar || u.short_name || u.name) : (u.short_name || u.name || u.name_ar || "")}</option>)}
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  </div>
                </label>
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4 max-h-[calc(100vh-280px)] overflow-y-auto pr-1">
            {filtered.map(p => {
              const stock = stockMap[p.id] ?? 0;
              const low = stock <= 0;
              const catLabel = lang === "ar" ? (p.category?.name_ar || p.category?.name) : (p.category?.name || p.category?.name_ar);
              const unitLabel = lang === "ar" ? (p.unit?.name_ar || p.unit?.short_name) : (p.unit?.short_name || p.unit?.name_ar);
              return (
                <button
                  key={p.id}
                  onClick={() => addToCart(p)}
                  disabled={low}
                  className="group relative flex flex-col items-start gap-1 rounded-xl border border-border bg-surface p-3 text-start transition hover:border-ring hover:bg-surface-2 disabled:opacity-40"
                >
                  <div className="line-clamp-2 text-sm font-medium">{lang === "ar" && p.name_ar ? p.name_ar : p.name}</div>
                  <div className="flex flex-wrap items-center gap-1 text-[10px] text-muted-foreground">
                    {catLabel && <span className="rounded-full bg-surface-2 px-1.5 py-0.5">{catLabel}</span>}
                    {unitLabel && <span className="rounded-full bg-surface-2 px-1.5 py-0.5">{unitLabel}</span>}
                  </div>
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
                {t("pos.no_products")}
              </div>
            )}
          </div>
        </div>

        {/* Cart Panel */}
        <div className="order-1 flex max-h-[62vh] flex-col overflow-hidden panel-elevated p-4 lg:order-2 lg:max-h-none">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold">{t("pos.cart")} <span className="rounded-full bg-primary/10 px-2 py-0.5 text-primary font-mono">{cart.length}</span></h2>
            {cart.length > 0 && (
              <button onClick={() => setCart([])} className="text-xs text-muted-foreground hover:text-destructive">
                {t("pos.clear")}
              </button>
            )}
          </div>

          <div className="mb-3">
            <select value={customerId} onChange={e => setCustomerId(e.target.value)} className="h-9 w-full rounded-md border border-input bg-surface px-2 text-sm">
              <option value="">{t("pos.walkin")}</option>
              {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>

          <div className="flex-1 space-y-2 overflow-y-auto max-h-[24vh] lg:max-h-[40vh]">
            {cart.length === 0 ? (
              <div className="grid place-items-center py-10 text-sm text-muted-foreground">{t("pos.empty_cart")}</div>
            ) : cart.map(l => (
              <div key={l.product_id} className="rounded-md border border-border bg-surface p-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{l.name}</div>
                    <div className="text-[11px] text-muted-foreground font-mono">{money(l.unit_price)} × {l.quantity}</div>
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
                      className="h-6 w-12 rounded border border-border bg-surface text-center text-xs font-mono"
                    />
                    <button onClick={() => setQty(l.product_id, l.quantity + 1)} className="grid h-6 w-6 place-items-center rounded border border-border hover:bg-surface-2"><Plus className="h-3 w-3" /></button>
                  </div>
                  <span className="text-sm font-semibold font-mono">{money(l.unit_price * l.quantity * (1 + l.tax_rate / 100))}</span>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-4 space-y-2 border-t border-border pt-3 text-sm">
            <Row label={t("pos.subtotal")} value={money(subtotal)} />
            <Row label={t("pos.tax")} value={money(taxTotal)} />
            <div className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground">{t("pos.discount")}</span>
              <input type="number" value={discount} onChange={e => setDiscount(e.target.value)} placeholder="0" className="h-7 w-24 rounded border border-border bg-surface px-2 text-end text-xs font-mono" />
            </div>
            <Row label={t("pos.total")} value={money(total)} bold />
          </div>

          <div className="mt-3 grid grid-cols-4 gap-1">
            {(["cash","card","bank_transfer","credit"] as const).map(m => (
              <button key={m} onClick={() => setPaymentMethod(m)} className={`h-8 rounded-md border text-xs transition font-medium ${paymentMethod === m ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-surface-2"}`}>
                {t(`pm.${m}`)}
              </button>
            ))}
          </div>

          {paymentMethod !== "credit" && (
            <div className="mt-2 flex items-center gap-2">
              <input type="number" value={paid} onChange={e => setPaid(e.target.value)} placeholder={`${t("pos.paid")} (${total.toFixed(0)})`} className="h-9 flex-1 rounded-md border border-input bg-surface px-2 text-sm font-mono" />
              {paidN > 0 && change > 0 && <span className="text-xs text-muted-foreground font-mono">{t("pos.change")}: {money(change)}</span>}
            </div>
          )}

          <button
            onClick={checkout}
            disabled={loading || cart.length === 0}
            className="mt-3 flex h-11 items-center justify-between px-4 rounded-md bg-primary text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
          >
            <div className="flex items-center gap-2">
              {loading && <Loader2 className="h-4 w-4 animate-spin" />}
              <span>{t("pos.checkout")}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="font-mono font-bold text-base">{money(total)}</span>
              <kbd className="hidden sm:inline-block rounded bg-primary-foreground/20 px-1.5 py-0.5 text-[10px] font-mono text-primary-foreground">F9</kbd>
            </div>
          </button>
        </div>
      </div>

      <BarcodeScanner
        open={scannerOpen}
        onClose={() => setScannerOpen(false)}
        continuous
        onDetected={handleCode}
      />
    </>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className={`flex justify-between ${bold ? "font-bold text-base" : "text-muted-foreground"}`}>
      <span>{label}</span>
      <span className="font-mono">{value}</span>
    </div>
  );
}

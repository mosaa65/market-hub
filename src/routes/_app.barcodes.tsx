import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import JsBarcode from "jsbarcode";
import { Printer, Barcode as BarcodeIcon, Search, Camera, Plus, Wand2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { useI18n } from "@/lib/i18n";
import { toast } from "sonner";
import { money } from "@/lib/format";
import { BarcodeScanner } from "@/components/barcode-scanner";

export const Route = createFileRoute("/_app/barcodes")({
  head: () => ({ meta: [{ title: "Barcode Labels — Vortex ERP" }] }),
  component: BarcodesPage,
});

interface Product {
  id: string; name: string; name_ar: string | null;
  sku: string | null; barcode: string | null;
  sale_price: number;
}

type LayoutKey = "a4-4x10" | "a4-3x8" | "a4-2x5" | "roll-50";
const LAYOUTS: Record<LayoutKey, { cols: number; rows: number; label: string; labelAr: string; w: string; h: string }> = {
  "a4-4x10": { cols: 4, rows: 10, label: "A4 · 40 labels (4×10)", labelAr: "A4 · 40 ملصق (4×10)", w: "45mm", h: "25mm" },
  "a4-3x8": { cols: 3, rows: 8, label: "A4 · 24 labels (3×8)", labelAr: "A4 · 24 ملصق (3×8)", w: "63mm", h: "35mm" },
  "a4-2x5": { cols: 2, rows: 5, label: "A4 · 10 labels (2×5)", labelAr: "A4 · 10 ملصق (2×5)", w: "95mm", h: "50mm" },
  "roll-50": { cols: 1, rows: 1, label: "Roll · 50×30mm single", labelAr: "لفة · 50×30مم منفرد", w: "50mm", h: "30mm" },
};

function randomEAN13(): string {
  let base = "";
  for (let i = 0; i < 12; i++) base += Math.floor(Math.random() * 10);
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(base[i]) * (i % 2 === 0 ? 1 : 3);
  const check = (10 - (sum % 10)) % 10;
  return base + check;
}

function BarcodesPage() {
  const { lang } = useI18n();
  const [products, setProducts] = useState<Product[]>([]);
  const [productId, setProductId] = useState("");
  const [search, setSearch] = useState("");
  const [copies, setCopies] = useState(12);
  const [format, setFormat] = useState<"CODE128" | "EAN13" | "CODE39">("CODE128");
  const [layout, setLayout] = useState<LayoutKey>("a4-4x10");
  const [showPrice, setShowPrice] = useState(true);
  const [showName, setShowName] = useState(true);
  const [showCompany, setShowCompany] = useState(false);
  const [companyName, setCompanyName] = useState("");
  const [scannerOpen, setScannerOpen] = useState(false);
  const previewRef = useRef<HTMLDivElement>(null);

  async function loadProducts() {
    const { data } = await supabase.from("products").select("id,name,name_ar,sku,barcode,sale_price").eq("is_active", true).order("name").limit(1000);
    setProducts((data ?? []) as any);
  }
  useEffect(() => {
    loadProducts();
    supabase.from("company_settings").select("trade_name,legal_name").limit(1).maybeSingle().then(({ data }) => {
      const nm = (data as any)?.trade_name || (data as any)?.legal_name;
      if (nm) setCompanyName(nm);
    });
  }, []);

  const product = useMemo(() => products.find(p => p.id === productId), [products, productId]);
  const displayName = product ? (lang === "ar" ? (product.name_ar || product.name) : (product.name || product.name_ar || "")) : "";
  const code = product?.barcode || product?.sku || product?.id.slice(0, 12) || "";

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return products.slice(0, 50);
    return products.filter(p =>
      p.name.toLowerCase().includes(q) ||
      (p.name_ar ?? "").includes(q) ||
      (p.sku ?? "").toLowerCase().includes(q) ||
      (p.barcode ?? "").toLowerCase().includes(q)
    ).slice(0, 50);
  }, [products, search]);

  // Render barcodes into svg elements
  useEffect(() => {
    if (!product || !previewRef.current) return;
    const svgs = previewRef.current.querySelectorAll<SVGElement>("svg[data-barcode]");
    svgs.forEach(svg => {
      svg.innerHTML = "";
      try {
        JsBarcode(svg, code, {
          format,
          displayValue: true,
          fontSize: 11,
          height: layout === "roll-50" ? 45 : 36,
          margin: 2,
          width: format === "CODE39" ? 1.2 : 1.5,
          background: "#ffffff",
          lineColor: "#000000",
        });
      } catch {
        try { JsBarcode(svg, code, { format: "CODE128", displayValue: true, fontSize: 11, height: 36 }); }
        catch { /* ignore */ }
      }
    });
  }, [product, code, copies, format, showPrice, showName, showCompany, layout]);

  async function assignRandomBarcode() {
    if (!product) return;
    const newCode = randomEAN13();
    const { error } = await supabase.from("products").update({ barcode: newCode }).eq("id", product.id);
    if (error) return toast.error(error.message);
    toast.success(lang === "ar" ? `تم إنشاء باركود: ${newCode}` : `Generated: ${newCode}`);
    await loadProducts();
  }

  async function assignScannedBarcode(scanned: string) {
    if (!product) { toast.error(lang === "ar" ? "اختر منتجاً أولاً" : "Select a product first"); return; }
    const { error } = await supabase.from("products").update({ barcode: scanned }).eq("id", product.id);
    if (error) return toast.error(error.message);
    toast.success(lang === "ar" ? `تم ربط الباركود: ${scanned}` : `Barcode assigned: ${scanned}`);
    await loadProducts();
  }

  function print() {
    const node = previewRef.current;
    if (!node) return;
    const win = window.open("", "_blank", "width=900,height=1000");
    if (!win) return;
    const L = LAYOUTS[layout];
    win.document.write(`<!doctype html><html><head><title>Barcode labels</title>
      <style>
        @page { size: A4; margin: 6mm; }
        * { box-sizing: border-box; }
        body { font-family: ui-sans-serif, system-ui, -apple-system; margin: 0; background: white; color: #000; }
        .sheet { display: grid; grid-template-columns: repeat(${L.cols}, 1fr); gap: 2mm; }
        .lbl {
          width: 100%; height: ${L.h};
          padding: 2mm; text-align: center; page-break-inside: avoid;
          display: flex; flex-direction: column; align-items: center; justify-content: center;
          border: 0.4mm dashed #ccc; background: #fff;
        }
        .co { font-size: 8px; color: #555; margin-bottom: 1px; letter-spacing: 0.5px; }
        .nm { font-size: 9px; font-weight: 600; margin-bottom: 1px; max-height: 2.4em; overflow: hidden; line-height: 1.2; }
        .pr { font-size: 11px; font-weight: 700; margin-top: 1px; }
        svg { max-width: 100%; height: auto; display: block; }
        @media print { .lbl { border-color: transparent; } }
      </style></head><body>${node.outerHTML}</body></html>`);
    win.document.close();
    setTimeout(() => { win.focus(); win.print(); }, 300);
  }

  const L = LAYOUTS[layout];

  return (
    <>
      <PageHeader
        title={lang === "ar" ? "طباعة الباركود" : "Barcode Labels"}
        subtitle={lang === "ar" ? "توليد وطباعة ملصقات الباركود بأحجام متعددة" : "Generate and print barcode labels in multiple sizes"}
        actions={
          <div className="flex items-center gap-2">
            <button
              onClick={() => setScannerOpen(true)}
              className="grid h-10 w-10 place-items-center rounded-full border border-primary/30 bg-primary/10 text-primary hover:bg-primary/20"
              title={lang === "ar" ? "قراءة باركود بالكاميرا" : "Scan barcode"}
            >
              <Camera className="h-4 w-4" />
            </button>
            <button
              disabled={!product}
              onClick={print}
              className="flex h-10 items-center gap-1.5 rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-40 transition"
            >
              <Printer className="h-4 w-4" /> {lang === "ar" ? "طباعة" : "Print"}
            </button>
          </div>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[360px_1fr]">
        {/* Config panel */}
        <div className="panel-elevated p-4 space-y-4">
          {/* Search */}
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground rtl:left-auto rtl:right-3" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={lang === "ar" ? "ابحث بالاسم أو الرمز..." : "Search by name or SKU..."}
              className="h-10 w-full rounded-full border border-input bg-surface pl-9 pr-3 text-sm rtl:pl-3 rtl:pr-9 focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20"
            />
          </div>

          {/* Products list */}
          <div className="max-h-64 space-y-1 overflow-y-auto pr-1">
            {filtered.map(p => {
              const nm = lang === "ar" ? (p.name_ar || p.name) : (p.name || p.name_ar || "");
              const active = productId === p.id;
              return (
                <button
                  key={p.id}
                  onClick={() => setProductId(p.id)}
                  className={`w-full rounded-xl border p-2.5 text-start transition ${active ? "border-primary bg-primary/5" : "border-border hover:border-ring/40 hover:bg-surface-2"}`}
                >
                  <div className="text-sm font-medium truncate">{nm}</div>
                  <div className="mt-1 flex items-center justify-between text-[11px] text-muted-foreground">
                    <span className="font-mono truncate">{p.barcode || p.sku || "—"}</span>
                    <span>{money(Number(p.sale_price))}</span>
                  </div>
                </button>
              );
            })}
            {filtered.length === 0 && (
              <div className="py-6 text-center text-xs text-muted-foreground">{lang === "ar" ? "لا توجد نتائج" : "No results"}</div>
            )}
          </div>

          {product && (
            <>
              <div className="rounded-xl border border-border bg-surface p-3">
                <div className="text-[11px] text-muted-foreground mb-1">{lang === "ar" ? "الباركود الحالي" : "Current barcode"}</div>
                <div className="font-mono text-sm">{product.barcode || <span className="text-muted-foreground italic">{lang === "ar" ? "لا يوجد" : "not set"}</span>}</div>
                <div className="mt-2 flex gap-2">
                  <button onClick={assignRandomBarcode} className="flex-1 flex items-center justify-center gap-1 rounded-full border border-border bg-surface-2 px-3 py-1.5 text-xs hover:bg-surface">
                    <Wand2 className="h-3 w-3" /> {lang === "ar" ? "توليد EAN-13" : "Generate EAN-13"}
                  </button>
                </div>
              </div>

              {/* Layout */}
              <div>
                <label className="text-xs font-medium mb-1.5 block">{lang === "ar" ? "التنسيق" : "Layout"}</label>
                <div className="grid grid-cols-2 gap-1.5">
                  {(Object.keys(LAYOUTS) as LayoutKey[]).map(k => (
                    <button
                      key={k}
                      onClick={() => setLayout(k)}
                      className={`rounded-xl border p-2 text-[10px] text-start transition ${layout === k ? "border-primary bg-primary/5" : "border-border hover:border-ring/40"}`}
                    >
                      {lang === "ar" ? LAYOUTS[k].labelAr : LAYOUTS[k].label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Format & copies */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs font-medium mb-1.5 block">{lang === "ar" ? "النوع" : "Format"}</label>
                  <select value={format} onChange={(e) => setFormat(e.target.value as any)} className="h-9 w-full rounded-full border border-input bg-surface px-3 text-xs">
                    <option value="CODE128">CODE128</option>
                    <option value="EAN13">EAN-13</option>
                    <option value="CODE39">CODE39</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium mb-1.5 block">{lang === "ar" ? "النسخ" : "Copies"}</label>
                  <input
                    type="number" min={1} max={400} value={copies}
                    onChange={(e) => setCopies(Math.min(400, Math.max(1, Number(e.target.value))))}
                    className="h-9 w-full rounded-full border border-input bg-surface px-3 text-xs"
                  />
                </div>
              </div>

              {/* Toggles */}
              <div className="space-y-2 rounded-xl border border-border p-3">
                <ToggleRow label={lang === "ar" ? "إظهار اسم المنتج" : "Show product name"} value={showName} onChange={setShowName} />
                <ToggleRow label={lang === "ar" ? "إظهار السعر" : "Show price"} value={showPrice} onChange={setShowPrice} />
                <ToggleRow label={lang === "ar" ? "إظهار اسم المتجر" : "Show store name"} value={showCompany} onChange={setShowCompany} />
                {showCompany && (
                  <input
                    value={companyName} onChange={(e) => setCompanyName(e.target.value)}
                    placeholder={lang === "ar" ? "اسم المتجر" : "Store name"}
                    className="h-8 w-full rounded-full border border-input bg-surface px-3 text-xs mt-1"
                  />
                )}
              </div>
            </>
          )}
        </div>

        {/* Preview */}
        <div className="panel-elevated p-4">
          {!product ? (
            <div className="grid place-items-center py-24 text-center text-muted-foreground">
              <div className="grid h-16 w-16 place-items-center rounded-2xl bg-primary/10 text-primary mb-3">
                <BarcodeIcon className="h-8 w-8" />
              </div>
              <div className="text-sm">{lang === "ar" ? "اختر منتجاً لبدء المعاينة" : "Select a product to preview labels"}</div>
              <div className="mt-1 text-xs">{lang === "ar" ? "أو استخدم زر الكاميرا لقراءة باركود موجود" : "Or scan an existing barcode with the camera"}</div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>{lang === "ar" ? "المعاينة" : "Preview"} · {L.w} × {L.h}</span>
                <span className="font-mono">{code}</span>
              </div>
              <div className="rounded-xl border border-border bg-white p-3 overflow-x-auto">
                <div
                  ref={previewRef}
                  className="sheet"
                  style={{ display: "grid", gridTemplateColumns: `repeat(${L.cols}, 1fr)`, gap: "2mm" }}
                >
                  {Array.from({ length: copies }).map((_, i) => (
                    <div
                      key={i}
                      className="lbl"
                      style={{
                        width: "100%", height: L.h, padding: "2mm", textAlign: "center",
                        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                        border: "0.4mm dashed #ccc", background: "#fff", color: "#000",
                      }}
                    >
                      {showCompany && companyName && <div className="co" style={{ fontSize: 8, color: "#555", marginBottom: 1, letterSpacing: 0.5 }}>{companyName}</div>}
                      {showName && <div className="nm" style={{ fontSize: 9, fontWeight: 600, marginBottom: 1, maxHeight: "2.4em", overflow: "hidden", lineHeight: 1.2 }}>{displayName}</div>}
                      <svg data-barcode />
                      {showPrice && <div className="pr" style={{ fontSize: 11, fontWeight: 700, marginTop: 1 }}>{money(Number(product.sale_price))}</div>}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <BarcodeScanner
        open={scannerOpen}
        onClose={() => setScannerOpen(false)}
        onDetected={(scanned) => {
          // If product selected → assign; otherwise search
          if (product) {
            assignScannedBarcode(scanned);
          } else {
            const match = products.find(p => p.barcode === scanned || p.sku === scanned);
            if (match) { setProductId(match.id); toast.success(lang === "ar" ? "تم اختيار المنتج" : "Product selected"); }
            else { setSearch(scanned); toast(lang === "ar" ? `الباركود ${scanned} غير مرتبط` : `${scanned} not linked to any product`); }
          }
        }}
      />
    </>
  );
}

function ToggleRow({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center justify-between text-xs cursor-pointer">
      <span>{label}</span>
      <button
        type="button"
        onClick={() => onChange(!value)}
        className={`relative h-5 w-9 rounded-full transition ${value ? "bg-primary" : "bg-surface-2"}`}
      >
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-background transition-all ${value ? "left-4" : "left-0.5"}`} />
      </button>
    </label>
  );
}

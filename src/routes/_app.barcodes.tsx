import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import JsBarcode from "jsbarcode";
import { Printer, Barcode as BarcodeIcon } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/_app/barcodes")({
  head: () => ({ meta: [{ title: "Barcode Labels — Vortex ERP" }] }),
  component: BarcodesPage,
});

interface Product { id: string; name: string; sku: string | null; barcode: string | null; price: number; }

function BarcodesPage() {
  const { t } = useI18n();
  const [products, setProducts] = useState<Product[]>([]);
  const [productId, setProductId] = useState("");
  const [search, setSearch] = useState("");
  const [copies, setCopies] = useState(12);
  const [format, setFormat] = useState<"CODE128" | "EAN13">("CODE128");
  const [showPrice, setShowPrice] = useState(true);
  const sheetRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    supabase.from("products").select("id,name,sku,barcode,price").eq("is_active", true).order("name").limit(500)
      .then(({ data }) => setProducts((data ?? []) as any));
  }, []);

  const product = products.find(p => p.id === productId);
  const code = product?.barcode || product?.sku || product?.id.slice(0, 12) || "";

  useEffect(() => {
    if (!product || !sheetRef.current) return;
    const svgs = sheetRef.current.querySelectorAll<SVGElement>("svg[data-barcode]");
    svgs.forEach(svg => {
      try {
        JsBarcode(svg, code, {
          format, displayValue: true, fontSize: 12, height: 40, margin: 4, width: 1.6,
        });
      } catch {
        try { JsBarcode(svg, code, { format: "CODE128", displayValue: true, fontSize: 12, height: 40 }); } catch { /* ignore */ }
      }
    });
  }, [product, code, copies, format, showPrice]);

  const filtered = products.filter(p =>
    !search || p.name.toLowerCase().includes(search.toLowerCase()) || (p.sku ?? "").toLowerCase().includes(search.toLowerCase())
  ).slice(0, 50);

  function print() {
    const node = sheetRef.current; if (!node) return;
    const win = window.open("", "_blank", "width=900,height=1000"); if (!win) return;
    win.document.write(`<!doctype html><html><head><title>Labels</title><style>
      @page { size: A4; margin: 8mm; }
      body { font-family: ui-sans-serif, system-ui; margin: 0; }
      .sheet { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; }
      .lbl { border: 1px dashed #ccc; padding: 6px; text-align: center; page-break-inside: avoid; }
      .lbl .name { font-size: 10px; font-weight: 600; margin-bottom: 2px; }
      .lbl .price { font-size: 11px; font-weight: 700; margin-top: 2px; }
      svg { max-width: 100%; height: auto; }
    </style></head><body>${node.outerHTML}</body></html>`);
    win.document.close();
    setTimeout(() => { win.focus(); win.print(); }, 250);
  }

  return (
    <>
      <PageHeader
        title={t("barcodes.title")}
        subtitle={t("barcodes.subtitle")}
        actions={<Button disabled={!product} onClick={print}><Printer className="h-4 w-4 me-1" />{t("common.print")}</Button>}
      />

      <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
        <Card>
          <CardContent className="p-4 space-y-3">
            <div className="grid gap-1.5">
              <Label>{t("common.search")}</Label>
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("barcodes.name_or_sku")} />
            </div>
            <div className="grid gap-1.5">
              <Label>{t("common.product")}</Label>
              <Select value={productId} onValueChange={setProductId}>
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>{filtered.map(p => <SelectItem key={p.id} value={p.id}>{p.name}{p.sku ? ` · ${p.sku}` : ""}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="grid gap-1.5">
                <Label>{t("barcodes.copies")}</Label>
                <Input type="number" min={1} max={200} value={copies} onChange={(e) => setCopies(Math.min(200, Math.max(1, Number(e.target.value))))} />
              </div>
              <div className="grid gap-1.5">
                <Label>{t("barcodes.format")}</Label>
                <Select value={format} onValueChange={(v) => setFormat(v as any)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="CODE128">CODE128</SelectItem>
                    <SelectItem value="EAN13">EAN-13</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={showPrice} onChange={(e) => setShowPrice(e.target.checked)} className="h-4 w-4 rounded border-border" />
              {t("barcodes.show_price")}
            </label>
            {product && (
              <div className="rounded-md border border-border p-3 text-xs">
                <div className="font-medium">{product.name}</div>
                <div className="font-mono text-muted-foreground mt-1">{code}</div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            {!product ? (
              <div className="py-20 text-center text-muted-foreground">
                <BarcodeIcon className="mx-auto mb-2 h-10 w-10 opacity-40" />
                {t("barcodes.pick_product")}
              </div>
            ) : (
              <div ref={sheetRef} className="sheet grid grid-cols-4 gap-2" style={{ background: "white", color: "black", padding: "8px", borderRadius: 6 }}>
                {Array.from({ length: copies }).map((_, i) => (
                  <div key={i} className="lbl" style={{ border: "1px dashed #ccc", padding: 6, textAlign: "center" }}>
                    <div className="name" style={{ fontSize: 10, fontWeight: 600 }}>{product.name}</div>
                    <svg data-barcode />
                    {showPrice && <div className="price" style={{ fontSize: 11, fontWeight: 700 }}>{Number(product.price).toFixed(2)}</div>}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}

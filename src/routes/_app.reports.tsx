import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/page-header";
import { useI18n } from "@/lib/i18n";
import { supabase } from "@/integrations/supabase/client";
import { money } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Download, Calendar } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/_app/reports")({
  head: () => ({ meta: [{ title: "Reports — Vortex ERP" }] }),
  component: ReportsPage,
});

function defaultRange() {
  const to = new Date();
  const from = new Date(); from.setDate(from.getDate() - 30);
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

function ReportsPage() {
  const { t, lang } = useI18n();
  const [range, setRange] = useState(defaultRange());
  const [sales, setSales] = useState<any[]>([]);
  const [purchases, setPurchases] = useState<any[]>([]);
  const [topProducts, setTopProducts] = useState<any[]>([]);
  const [lowStock, setLowStock] = useState<any[]>([]);
  const [byMethod, setByMethod] = useState<Record<string, number>>({});

  async function load() {
    const fromTs = `${range.from}T00:00:00`;
    const toTs = `${range.to}T23:59:59`;

    const [salesRes, purchRes, itemsRes, prodRes, invRes] = await Promise.all([
      supabase.from("sales_invoices").select("id,invoice_number,total,paid,payment_method,status,created_at,customer_id").gte("created_at", fromTs).lte("created_at", toTs).order("created_at", { ascending: false }),
      supabase.from("purchase_invoices").select("id,invoice_number,total,paid,status,created_at,supplier_id").gte("created_at", fromTs).lte("created_at", toTs).order("created_at", { ascending: false }),
      supabase.from("sales_invoice_items").select("product_id,quantity,total,invoice_id,sales_invoices!inner(created_at)").gte("sales_invoices.created_at", fromTs).lte("sales_invoices.created_at", toTs),
      supabase.from("products").select("id,name,name_ar,min_stock,sale_price"),
      supabase.from("inventory").select("product_id,quantity"),
    ]);

    setSales(salesRes.data ?? []);
    setPurchases(purchRes.data ?? []);

    // Aggregate top products
    const map = new Map<string, { qty: number; total: number }>();
    (itemsRes.data ?? []).forEach((it: any) => {
      const cur = map.get(it.product_id) ?? { qty: 0, total: 0 };
      cur.qty += Number(it.quantity);
      cur.total += Number(it.total);
      map.set(it.product_id, cur);
    });
    const prodMap = new Map((prodRes.data ?? []).map((p: any) => [p.id, p]));
    const tops = Array.from(map.entries())
      .map(([pid, v]) => ({ ...v, product: prodMap.get(pid) }))
      .sort((a, b) => b.total - a.total).slice(0, 10);
    setTopProducts(tops);

    // Payment method split
    const methods: Record<string, number> = {};
    (salesRes.data ?? []).forEach((s: any) => { methods[s.payment_method] = (methods[s.payment_method] ?? 0) + Number(s.paid); });
    setByMethod(methods);

    // Low stock: aggregate inventory per product, compare to min_stock
    const stockMap = new Map<string, number>();
    (invRes.data ?? []).forEach((i: any) => { stockMap.set(i.product_id, (stockMap.get(i.product_id) ?? 0) + Number(i.quantity)); });
    const low = (prodRes.data ?? [])
      .map((p: any) => ({ ...p, stock: stockMap.get(p.id) ?? 0 }))
      .filter((p: any) => p.stock <= Number(p.min_stock ?? 0))
      .sort((a: any, b: any) => a.stock - b.stock).slice(0, 20);
    setLowStock(low);
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [range.from, range.to]);

  const salesTotal = sales.reduce((a, r) => a + Number(r.total), 0);
  const salesPaid = sales.reduce((a, r) => a + Number(r.paid), 0);
  const purchasesTotal = purchases.reduce((a, r) => a + Number(r.total), 0);
  const grossProfit = salesTotal - purchasesTotal;

  function exportCSV(name: string, rows: any[], headers: string[]) {
    if (rows.length === 0) return;
    const csv = [headers.join(",")].concat(rows.map((r) => headers.map((h) => JSON.stringify(r[h] ?? "")).join(","))).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `${name}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <PageHeader
        title={t("reports.title")}
        subtitle={lang === "ar" ? "تحليلات الأداء، الأكثر مبيعاً، التدفق النقدي" : "Performance analytics, top sellers, cashflow"}
        actions={
          <div className="flex items-center gap-2">
            <Calendar className="h-4 w-4 text-muted-foreground" />
            <Input type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} className="w-auto" />
            <span className="text-muted-foreground">→</span>
            <Input type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} className="w-auto" />
          </div>
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <Kpi label={lang === "ar" ? "إجمالي المبيعات" : "Total sales"} value={money(salesTotal)} sub={`${sales.length} ${lang === "ar" ? "فاتورة" : "invoices"}`} />
        <Kpi label={lang === "ar" ? "المحصّل" : "Collected"} value={money(salesPaid)} sub={lang === "ar" ? "نقد + بنك" : "Cash + bank"} />
        <Kpi label={lang === "ar" ? "تكلفة المشتريات" : "Purchase cost"} value={money(purchasesTotal)} sub={`${purchases.length} PO`} />
        <Kpi label={lang === "ar" ? "إجمالي الربح" : "Gross profit"} value={money(grossProfit)} sub={grossProfit >= 0 ? "✓" : "−"} tone={grossProfit >= 0 ? "pos" : "neg"} />
      </div>

      <Tabs defaultValue="top">
        <TabsList>
          <TabsTrigger value="top">{lang === "ar" ? "الأكثر مبيعاً" : "Top products"}</TabsTrigger>
          <TabsTrigger value="sales">{lang === "ar" ? "المبيعات" : "Sales log"}</TabsTrigger>
          <TabsTrigger value="payments">{lang === "ar" ? "طرق الدفع" : "Payment mix"}</TabsTrigger>
          <TabsTrigger value="low">{lang === "ar" ? "مخزون منخفض" : "Low stock"}</TabsTrigger>
        </TabsList>

        <TabsContent value="top">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">{lang === "ar" ? "أعلى 10 منتجات" : "Top 10 products"}</CardTitle>
              <Button size="sm" variant="outline" onClick={() => exportCSV("top-products", topProducts.map((t) => ({ name: t.product?.name, qty: t.qty, total: t.total })), ["name", "qty", "total"])}><Download className="h-4 w-4 me-1" />CSV</Button>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader><TableRow><TableHead>{lang === "ar" ? "المنتج" : "Product"}</TableHead><TableHead className="text-end">{lang === "ar" ? "الكمية" : "Qty"}</TableHead><TableHead className="text-end">{lang === "ar" ? "الإيراد" : "Revenue"}</TableHead></TableRow></TableHeader>
                <TableBody>
                  {topProducts.length === 0 ? <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground py-8">{lang === "ar" ? "لا توجد بيانات" : "No data"}</TableCell></TableRow>
                    : topProducts.map((tp, i) => (
                      <TableRow key={i}>
                        <TableCell>{lang === "ar" ? (tp.product?.name_ar ?? tp.product?.name) : tp.product?.name}</TableCell>
                        <TableCell className="text-end font-mono">{tp.qty}</TableCell>
                        <TableCell className="text-end font-mono">{money(tp.total)}</TableCell>
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="sales">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">{lang === "ar" ? "سجل المبيعات" : "Sales log"}</CardTitle>
              <Button size="sm" variant="outline" onClick={() => exportCSV("sales", sales, ["invoice_number", "created_at", "total", "paid", "payment_method", "status"])}><Download className="h-4 w-4 me-1" />CSV</Button>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader><TableRow><TableHead>#</TableHead><TableHead>{lang === "ar" ? "التاريخ" : "Date"}</TableHead><TableHead>{lang === "ar" ? "الحالة" : "Status"}</TableHead><TableHead className="text-end">{lang === "ar" ? "الإجمالي" : "Total"}</TableHead></TableRow></TableHeader>
                <TableBody>
                  {sales.length === 0 ? <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-8">{lang === "ar" ? "لا توجد بيانات" : "No data"}</TableCell></TableRow>
                    : sales.slice(0, 50).map((s) => (
                      <TableRow key={s.id}>
                        <TableCell className="font-mono text-xs">{s.invoice_number}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{new Date(s.created_at).toLocaleString()}</TableCell>
                        <TableCell><Badge variant={s.status === "paid" ? "default" : "secondary"}>{s.status}</Badge></TableCell>
                        <TableCell className="text-end font-mono">{money(Number(s.total))}</TableCell>
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="payments">
          <Card>
            <CardHeader><CardTitle className="text-base">{lang === "ar" ? "توزيع طرق الدفع" : "Payment method distribution"}</CardTitle></CardHeader>
            <CardContent className="p-6 space-y-3">
              {Object.entries(byMethod).length === 0 ? <div className="text-muted-foreground text-center py-8">{lang === "ar" ? "لا توجد بيانات" : "No data"}</div> :
                Object.entries(byMethod).map(([m, v]) => {
                  const total = Object.values(byMethod).reduce((a, b) => a + b, 0);
                  const pct = total > 0 ? (v / total) * 100 : 0;
                  return (
                    <div key={m}>
                      <div className="flex justify-between text-sm mb-1"><span className="capitalize">{m}</span><span className="font-mono">{money(v)} <span className="text-muted-foreground">({pct.toFixed(1)}%)</span></span></div>
                      <div className="h-2 bg-muted rounded overflow-hidden"><div className="h-full bg-primary" style={{ width: `${pct}%` }} /></div>
                    </div>
                  );
                })}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="low">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">{lang === "ar" ? "منتجات تحت الحد الأدنى" : "Below minimum stock"}</CardTitle>
              <Button size="sm" variant="outline" onClick={() => exportCSV("low-stock", lowStock.map((p) => ({ name: p.name, stock: p.stock, min_stock: p.min_stock })), ["name", "stock", "min_stock"])}><Download className="h-4 w-4 me-1" />CSV</Button>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader><TableRow><TableHead>{lang === "ar" ? "المنتج" : "Product"}</TableHead><TableHead className="text-end">{lang === "ar" ? "المتاح" : "On hand"}</TableHead><TableHead className="text-end">{lang === "ar" ? "الحد الأدنى" : "Min"}</TableHead></TableRow></TableHeader>
                <TableBody>
                  {lowStock.length === 0 ? <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground py-8">{lang === "ar" ? "كل المخزون بحالة جيدة" : "All stock above minimum"}</TableCell></TableRow>
                    : lowStock.map((p) => (
                      <TableRow key={p.id}>
                        <TableCell>{lang === "ar" ? (p.name_ar ?? p.name) : p.name}</TableCell>
                        <TableCell className="text-end font-mono text-rose-500">{p.stock}</TableCell>
                        <TableCell className="text-end font-mono text-muted-foreground">{p.min_stock}</TableCell>
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </>
  );
}

function Kpi({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "pos" | "neg" }) {
  const color = tone === "pos" ? "text-emerald-500" : tone === "neg" ? "text-rose-500" : "";
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className={`mt-2 text-xl font-semibold font-mono ${color}`}>{value}</div>
        {sub && <div className="text-xs text-muted-foreground mt-1">{sub}</div>}
      </CardContent>
    </Card>
  );
}

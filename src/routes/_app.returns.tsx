import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/page-header";
import { useI18n } from "@/lib/i18n";
import { supabase } from "@/integrations/supabase/client";
import { money } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Plus, Trash2, RotateCcw } from "lucide-react";

export const Route = createFileRoute("/_app/returns")({
  head: () => ({ meta: [{ title: "Returns — Vortex ERP" }] }),
  component: ReturnsPage,
});

interface Line { product_id: string; name: string; quantity: number; unit_price: number; tax_rate: number; }

function ReturnsPage() {
  const { t, lang } = useI18n();
  const [tab, setTab] = useState<"sales" | "purchases">("sales");
  const [salesReturns, setSalesReturns] = useState<any[]>([]);
  const [purchaseReturns, setPurchaseReturns] = useState<any[]>([]);

  const whName = (w?: { name: string; name_ar?: string | null } | null) => !w ? "—" : lang === "ar" ? (w.name_ar || w.name) : (w.name || w.name_ar || "—");
  async function load() {
    const [sr, pr] = await Promise.all([
      supabase.from("sales_returns").select("*, customers(name), warehouses(name,name_ar)").order("created_at", { ascending: false }).limit(100),
      supabase.from("purchase_returns").select("*, suppliers(name), warehouses(name,name_ar)").order("created_at", { ascending: false }).limit(100),
    ]);
    setSalesReturns(sr.data ?? []);
    setPurchaseReturns(pr.data ?? []);
  }
  useEffect(() => { load(); }, []);

  return (
    <>
      <PageHeader
        title={lang === "ar" ? "المرتجعات" : "Returns"}
        subtitle={lang === "ar" ? "مرتجعات المبيعات والمشتريات" : "Sales and purchase returns"}
        actions={
          tab === "sales"
            ? <NewSalesReturn onSaved={load} />
            : <NewPurchaseReturn onSaved={load} />
        }
      />

      <Tabs value={tab} onValueChange={(v) => setTab(v as any)}>
        <TabsList>
          <TabsTrigger value="sales">{lang === "ar" ? "مرتجعات المبيعات" : "Sales returns"}</TabsTrigger>
          <TabsTrigger value="purchases">{lang === "ar" ? "مرتجعات المشتريات" : "Purchase returns"}</TabsTrigger>
        </TabsList>

        <TabsContent value="sales">
          <Card><CardContent className="p-0">
            <Table>
              <TableHeader><TableRow>
                <TableHead>#</TableHead><TableHead>{lang === "ar" ? "التاريخ" : "Date"}</TableHead>
                <TableHead>{lang === "ar" ? "العميل" : "Customer"}</TableHead>
                <TableHead>{lang === "ar" ? "المستودع" : "Warehouse"}</TableHead>
                <TableHead className="text-end">{lang === "ar" ? "الإجمالي" : "Total"}</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {salesReturns.length === 0 ? <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">{lang === "ar" ? "لا توجد مرتجعات" : "No returns"}</TableCell></TableRow>
                  : salesReturns.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-mono text-xs">{r.return_number}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{new Date(r.created_at).toLocaleString()}</TableCell>
                      <TableCell>{r.customers?.name ?? "—"}</TableCell>
                      <TableCell>{whName(r.warehouses)}</TableCell>
                      <TableCell className="text-end font-mono">{money(Number(r.total))}</TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="purchases">
          <Card><CardContent className="p-0">
            <Table>
              <TableHeader><TableRow>
                <TableHead>#</TableHead><TableHead>{lang === "ar" ? "التاريخ" : "Date"}</TableHead>
                <TableHead>{lang === "ar" ? "المورد" : "Supplier"}</TableHead>
                <TableHead>{lang === "ar" ? "المستودع" : "Warehouse"}</TableHead>
                <TableHead className="text-end">{lang === "ar" ? "الإجمالي" : "Total"}</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {purchaseReturns.length === 0 ? <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">{lang === "ar" ? "لا توجد مرتجعات" : "No returns"}</TableCell></TableRow>
                  : purchaseReturns.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-mono text-xs">{r.return_number}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{new Date(r.created_at).toLocaleString()}</TableCell>
                      <TableCell>{r.suppliers?.name ?? "—"}</TableCell>
                      <TableCell>{whName(r.warehouses)}</TableCell>
                      <TableCell className="text-end font-mono">{money(Number(r.total))}</TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          </CardContent></Card>
        </TabsContent>
      </Tabs>
    </>
  );
}

function NewSalesReturn({ onSaved }: { onSaved: () => void }) {
  const { t, lang } = useI18n();
  const [open, setOpen] = useState(false);
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [warehouseId, setWarehouseId] = useState("");
  const [customerId, setCustomerId] = useState<string>("");
  const [refundMethod, setRefundMethod] = useState("cash");
  const [note, setNote] = useState("");
  const [search, setSearch] = useState("");
  const [lines, setLines] = useState<Line[]>([]);

  useEffect(() => {
    if (!open) return;
    Promise.all([
      supabase.from("warehouses").select("id,name,name_ar").eq("is_active", true).order("name"),
      supabase.from("customers").select("id,name").eq("is_active", true).order("name"),
      supabase.from("products").select("id,name,name_ar,sku,sale_price,tax_rate").eq("is_active", true).order("name").limit(200),
    ]).then(([w, c, p]) => {
      setWarehouses(w.data ?? []);
      setCustomers(c.data ?? []);
      setProducts(p.data ?? []);
      if (!warehouseId && w.data?.[0]) setWarehouseId(w.data[0].id);
    });
  }, [open]);

  const filtered = useMemo(() =>
    products.filter((p) => !search || p.name.toLowerCase().includes(search.toLowerCase()) || p.sku?.toLowerCase().includes(search.toLowerCase())).slice(0, 8)
  , [products, search]);

  function addLine(p: any) {
    setLines((l) => {
      const ex = l.find((x) => x.product_id === p.id);
      if (ex) return l.map((x) => x.product_id === p.id ? { ...x, quantity: x.quantity + 1 } : x);
      return [...l, { product_id: p.id, name: p.name, quantity: 1, unit_price: Number(p.sale_price), tax_rate: Number(p.tax_rate ?? 0) }];
    });
    setSearch("");
  }

  const total = lines.reduce((a, l) => a + l.quantity * l.unit_price * (1 + l.tax_rate / 100), 0);

  async function save() {
    if (!warehouseId || lines.length === 0) { toast.error(t("common.fill_form")); return; }
    const { data, error } = await supabase.rpc("create_sales_return" as any, {
      _invoice_id: null, _warehouse_id: warehouseId, _customer_id: customerId || null,
      _refund_method: refundMethod, _note: note || null, _items: lines as any,
    });
    if (error) { toast.error(error.message); return; }
    toast.success(t("common.saved") || t("common.success"));
    setOpen(false); setLines([]); setNote(""); onSaved();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button><Plus className="h-4 w-4 me-1" />{lang === "ar" ? "مرتجع جديد" : "New return"}</Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl">
        <DialogHeader><DialogTitle>{lang === "ar" ? "مرتجع مبيعات" : "Sales return"}</DialogTitle></DialogHeader>
        <div className="grid gap-3">
          <div className="grid grid-cols-3 gap-3">
            <div className="grid gap-1.5"><Label>{lang === "ar" ? "المستودع" : "Warehouse"}</Label>
              <Select value={warehouseId} onValueChange={setWarehouseId}><SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{warehouses.map((w) => <SelectItem key={w.id} value={w.id}>{lang === "ar" ? (w.name_ar || w.name) : (w.name || w.name_ar || "")}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5"><Label>{lang === "ar" ? "العميل" : "Customer"}</Label>
              <Select value={customerId} onValueChange={setCustomerId}><SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>{customers.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5"><Label>{lang === "ar" ? "طريقة الاسترداد" : "Refund method"}</Label>
              <Select value={refundMethod} onValueChange={setRefundMethod}><SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="cash">Cash</SelectItem><SelectItem value="card">Card</SelectItem><SelectItem value="bank">Bank</SelectItem><SelectItem value="credit">Credit</SelectItem></SelectContent>
              </Select>
            </div>
          </div>
          <div className="relative">
            <Input placeholder={lang === "ar" ? "ابحث عن منتج" : "Search product"} value={search} onChange={(e) => setSearch(e.target.value)} />
            {search && filtered.length > 0 && (
              <div className="absolute z-10 mt-1 w-full rounded-md border border-border bg-popover shadow-lg max-h-60 overflow-auto">
                {filtered.map((p) => (
                  <button key={p.id} className="flex w-full items-center justify-between px-3 py-2 text-sm hover:bg-accent" onClick={() => addLine(p)}>
                    <span>{lang === "ar" ? (p.name_ar ?? p.name) : p.name}</span>
                    <span className="text-xs text-muted-foreground font-mono">{money(Number(p.sale_price))}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="border border-border rounded-md max-h-64 overflow-auto">
            <Table>
              <TableHeader><TableRow><TableHead>{lang === "ar" ? "المنتج" : "Product"}</TableHead><TableHead>Qty</TableHead><TableHead>Price</TableHead><TableHead className="text-end">Total</TableHead><TableHead></TableHead></TableRow></TableHeader>
              <TableBody>
                {lines.length === 0 ? <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-6">{lang === "ar" ? "أضف منتجات" : "Add products"}</TableCell></TableRow>
                  : lines.map((l, i) => (
                    <TableRow key={l.product_id}>
                      <TableCell className="text-sm">{l.name}</TableCell>
                      <TableCell><Input type="number" className="h-8 w-20" value={l.quantity} onChange={(e) => setLines(ls => ls.map((x,j) => j===i ? {...x, quantity: Number(e.target.value)} : x))} /></TableCell>
                      <TableCell><Input type="number" className="h-8 w-24" value={l.unit_price} onChange={(e) => setLines(ls => ls.map((x,j) => j===i ? {...x, unit_price: Number(e.target.value)} : x))} /></TableCell>
                      <TableCell className="text-end font-mono">{money(l.quantity * l.unit_price * (1 + l.tax_rate/100))}</TableCell>
                      <TableCell><Button size="icon" variant="ghost" onClick={() => setLines(ls => ls.filter((_,j) => j!==i))}><Trash2 className="h-4 w-4" /></Button></TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          </div>
          <Textarea placeholder={lang === "ar" ? "ملاحظات" : "Note"} rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          <div className="flex justify-between items-center text-lg font-semibold"><span>{lang === "ar" ? "الإجمالي" : "Total"}</span><span className="font-mono">{money(total)}</span></div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>{t("common.cancel")}</Button>
          <Button onClick={save} disabled={lines.length === 0}>{t("common.save")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function NewPurchaseReturn({ onSaved }: { onSaved: () => void }) {
  const { t, lang } = useI18n();
  const [open, setOpen] = useState(false);
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [warehouseId, setWarehouseId] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [refundMethod, setRefundMethod] = useState("cash");
  const [note, setNote] = useState("");
  const [search, setSearch] = useState("");
  const [lines, setLines] = useState<{ product_id: string; name: string; quantity: number; unit_cost: number; tax_rate: number }[]>([]);

  useEffect(() => {
    if (!open) return;
    Promise.all([
      supabase.from("warehouses").select("id,name,name_ar").eq("is_active", true).order("name"),
      supabase.from("suppliers").select("id,name").eq("is_active", true).order("name"),
      supabase.from("products").select("id,name,name_ar,sku,cost_price,tax_rate").eq("is_active", true).order("name").limit(200),
    ]).then(([w, s, p]) => {
      setWarehouses(w.data ?? []); setSuppliers(s.data ?? []); setProducts(p.data ?? []);
      if (!warehouseId && w.data?.[0]) setWarehouseId(w.data[0].id);
    });
  }, [open]);

  const filtered = useMemo(() =>
    products.filter((p) => !search || p.name.toLowerCase().includes(search.toLowerCase()) || p.sku?.toLowerCase().includes(search.toLowerCase())).slice(0, 8)
  , [products, search]);

  function addLine(p: any) {
    setLines((l) => {
      const ex = l.find((x) => x.product_id === p.id);
      if (ex) return l.map((x) => x.product_id === p.id ? { ...x, quantity: x.quantity + 1 } : x);
      return [...l, { product_id: p.id, name: p.name, quantity: 1, unit_cost: Number(p.cost_price), tax_rate: Number(p.tax_rate ?? 0) }];
    });
    setSearch("");
  }

  const total = lines.reduce((a, l) => a + l.quantity * l.unit_cost * (1 + l.tax_rate / 100), 0);

  async function save() {
    if (!warehouseId || !supplierId || lines.length === 0) { toast.error(t("common.fill_form")); return; }
    const { error } = await supabase.rpc("create_purchase_return" as any, {
      _invoice_id: null, _warehouse_id: warehouseId, _supplier_id: supplierId,
      _refund_method: refundMethod, _note: note || null, _items: lines as any,
    });
    if (error) { toast.error(error.message); return; }
    toast.success(t("common.saved") || t("common.success"));
    setOpen(false); setLines([]); setNote(""); onSaved();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button><Plus className="h-4 w-4 me-1" />{lang === "ar" ? "مرتجع جديد" : "New return"}</Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl">
        <DialogHeader><DialogTitle>{lang === "ar" ? "مرتجع مشتريات" : "Purchase return"}</DialogTitle></DialogHeader>
        <div className="grid gap-3">
          <div className="grid grid-cols-3 gap-3">
            <div className="grid gap-1.5"><Label>{lang === "ar" ? "المستودع" : "Warehouse"}</Label>
              <Select value={warehouseId} onValueChange={setWarehouseId}><SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{warehouses.map((w) => <SelectItem key={w.id} value={w.id}>{lang === "ar" ? (w.name_ar || w.name) : (w.name || w.name_ar || "")}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5"><Label>{lang === "ar" ? "المورد" : "Supplier"}</Label>
              <Select value={supplierId} onValueChange={setSupplierId}><SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>{suppliers.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5"><Label>{lang === "ar" ? "طريقة الاسترداد" : "Refund method"}</Label>
              <Select value={refundMethod} onValueChange={setRefundMethod}><SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="cash">Cash</SelectItem><SelectItem value="card">Card</SelectItem><SelectItem value="bank">Bank</SelectItem><SelectItem value="credit">Credit</SelectItem></SelectContent>
              </Select>
            </div>
          </div>
          <div className="relative">
            <Input placeholder={lang === "ar" ? "ابحث عن منتج" : "Search product"} value={search} onChange={(e) => setSearch(e.target.value)} />
            {search && filtered.length > 0 && (
              <div className="absolute z-10 mt-1 w-full rounded-md border border-border bg-popover shadow-lg max-h-60 overflow-auto">
                {filtered.map((p) => (
                  <button key={p.id} className="flex w-full items-center justify-between px-3 py-2 text-sm hover:bg-accent" onClick={() => addLine(p)}>
                    <span>{lang === "ar" ? (p.name_ar ?? p.name) : p.name}</span>
                    <span className="text-xs text-muted-foreground font-mono">{money(Number(p.cost_price))}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="border border-border rounded-md max-h-64 overflow-auto">
            <Table>
              <TableHeader><TableRow><TableHead>{lang === "ar" ? "المنتج" : "Product"}</TableHead><TableHead>Qty</TableHead><TableHead>Cost</TableHead><TableHead className="text-end">Total</TableHead><TableHead></TableHead></TableRow></TableHeader>
              <TableBody>
                {lines.length === 0 ? <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-6">{lang === "ar" ? "أضف منتجات" : "Add products"}</TableCell></TableRow>
                  : lines.map((l, i) => (
                    <TableRow key={l.product_id}>
                      <TableCell className="text-sm">{l.name}</TableCell>
                      <TableCell><Input type="number" className="h-8 w-20" value={l.quantity} onChange={(e) => setLines(ls => ls.map((x,j) => j===i ? {...x, quantity: Number(e.target.value)} : x))} /></TableCell>
                      <TableCell><Input type="number" className="h-8 w-24" value={l.unit_cost} onChange={(e) => setLines(ls => ls.map((x,j) => j===i ? {...x, unit_cost: Number(e.target.value)} : x))} /></TableCell>
                      <TableCell className="text-end font-mono">{money(l.quantity * l.unit_cost * (1 + l.tax_rate/100))}</TableCell>
                      <TableCell><Button size="icon" variant="ghost" onClick={() => setLines(ls => ls.filter((_,j) => j!==i))}><Trash2 className="h-4 w-4" /></Button></TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          </div>
          <Textarea placeholder={lang === "ar" ? "ملاحظات" : "Note"} rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          <div className="flex justify-between items-center text-lg font-semibold"><span>{lang === "ar" ? "الإجمالي" : "Total"}</span><span className="font-mono">{money(total)}</span></div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>{t("common.cancel")}</Button>
          <Button onClick={save} disabled={lines.length === 0}>{t("common.save")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

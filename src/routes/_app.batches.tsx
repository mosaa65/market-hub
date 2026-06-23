import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { CalendarClock, Plus, Trash2, AlertTriangle, Search } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/batches")({
  head: () => ({ meta: [{ title: "Batches & Expiry — Vortex ERP" }] }),
  component: BatchesPage,
});

interface Batch {
  id: string; product_id: string; warehouse_id: string;
  batch_number: string; expiry_date: string | null; quantity: number; unit_cost: number;
  products?: { name: string; name_ar: string | null; sku: string | null } | null;
  warehouses?: { name: string } | null;
}

function BatchesPage() {
  const { lang } = useI18n();
  const [rows, setRows] = useState<Batch[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const { data } = await supabase
      .from("product_batches")
      .select("*, products(name,name_ar,sku), warehouses(name)")
      .order("expiry_date", { ascending: true, nullsFirst: false });
    setRows((data ?? []) as any);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const soon = new Date(today); soon.setDate(today.getDate() + 30);

  const filtered = useMemo(() => rows.filter(r =>
    !search ||
    r.batch_number.toLowerCase().includes(search.toLowerCase()) ||
    (r.products?.name ?? "").toLowerCase().includes(search.toLowerCase()) ||
    (r.products?.sku ?? "").toLowerCase().includes(search.toLowerCase())
  ), [rows, search]);

  function status(exp: string | null) {
    if (!exp) return { label: lang === "ar" ? "بدون انتهاء" : "No expiry", cls: "bg-muted text-muted-foreground" };
    const d = new Date(exp);
    if (d < today) return { label: lang === "ar" ? "منتهي" : "Expired", cls: "bg-red-500/10 text-red-400 border-red-500/20" };
    if (d < soon) return { label: lang === "ar" ? "قريب الانتهاء" : "Expiring soon", cls: "bg-amber-500/10 text-amber-400 border-amber-500/20" };
    return { label: lang === "ar" ? "صالح" : "Valid", cls: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" };
  }

  async function remove(id: string) {
    if (!confirm(lang === "ar" ? "حذف الدفعة؟" : "Delete batch?")) return;
    const { error } = await supabase.from("product_batches").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success(lang === "ar" ? "تم الحذف" : "Deleted"); load();
  }

  const expiringCount = rows.filter(r => r.expiry_date && new Date(r.expiry_date) < soon).length;

  return (
    <>
      <PageHeader
        title={lang === "ar" ? "الدفعات وتواريخ الانتهاء" : "Batches & Expiry"}
        subtitle={lang === "ar" ? "تتبع المنتجات حسب الدفعة وتاريخ الصلاحية" : "Track inventory by batch and expiry date"}
        actions={<NewBatch onSaved={load} />}
      />

      {expiringCount > 0 && (
        <div className="mb-4 flex items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-sm text-amber-500">
          <AlertTriangle className="h-4 w-4" />
          {lang === "ar" ? `${expiringCount} دفعة قريبة الانتهاء أو منتهية` : `${expiringCount} batch(es) expired or expiring within 30 days`}
        </div>
      )}

      <Card>
        <CardContent className="p-4">
          <div className="relative mb-4">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground rtl:left-auto rtl:right-3" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder={lang === "ar" ? "ابحث بالدفعة أو المنتج" : "Search batch or product..."}
              className="pl-9 rtl:pl-3 rtl:pr-9" />
          </div>
          <Table>
            <TableHeader><TableRow>
              <TableHead>{lang === "ar" ? "الدفعة" : "Batch"}</TableHead>
              <TableHead>{lang === "ar" ? "المنتج" : "Product"}</TableHead>
              <TableHead>{lang === "ar" ? "المستودع" : "Warehouse"}</TableHead>
              <TableHead>{lang === "ar" ? "الكمية" : "Qty"}</TableHead>
              <TableHead>{lang === "ar" ? "تاريخ الانتهاء" : "Expiry"}</TableHead>
              <TableHead>{lang === "ar" ? "الحالة" : "Status"}</TableHead>
              <TableHead></TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {loading ? <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">…</TableCell></TableRow>
                : filtered.length === 0 ? <TableRow><TableCell colSpan={7} className="text-center py-12 text-muted-foreground">
                    <CalendarClock className="mx-auto mb-2 h-8 w-8 opacity-50" />
                    {lang === "ar" ? "لا توجد دفعات" : "No batches yet"}
                  </TableCell></TableRow>
                : filtered.map(r => {
                  const s = status(r.expiry_date);
                  return (
                    <TableRow key={r.id}>
                      <TableCell className="font-mono text-xs">{r.batch_number}</TableCell>
                      <TableCell>{lang === "ar" ? (r.products?.name_ar ?? r.products?.name) : r.products?.name}</TableCell>
                      <TableCell className="text-muted-foreground">{r.warehouses?.name}</TableCell>
                      <TableCell className="font-mono">{r.quantity}</TableCell>
                      <TableCell className="text-muted-foreground">{r.expiry_date ?? "—"}</TableCell>
                      <TableCell><Badge variant="outline" className={s.cls}>{s.label}</Badge></TableCell>
                      <TableCell className="text-end">
                        <Button size="icon" variant="ghost" onClick={() => remove(r.id)}><Trash2 className="h-4 w-4" /></Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </>
  );
}

function NewBatch({ onSaved }: { onSaved: () => void }) {
  const { lang } = useI18n();
  const [open, setOpen] = useState(false);
  const [products, setProducts] = useState<any[]>([]);
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [form, setForm] = useState({ product_id: "", warehouse_id: "", batch_number: "", expiry_date: "", quantity: 0, unit_cost: 0 });

  useEffect(() => {
    if (!open) return;
    Promise.all([
      supabase.from("products").select("id,name,sku").eq("is_active", true).order("name").limit(500),
      supabase.from("warehouses").select("id,name").eq("is_active", true).order("name"),
    ]).then(([p, w]) => { setProducts(p.data ?? []); setWarehouses(w.data ?? []); });
  }, [open]);

  async function save() {
    if (!form.product_id || !form.warehouse_id || !form.batch_number) {
      toast.error(lang === "ar" ? "أكمل البيانات" : "Fill required fields"); return;
    }
    const { error } = await supabase.from("product_batches").insert({
      ...form,
      expiry_date: form.expiry_date || null,
    });
    if (error) return toast.error(error.message);
    toast.success(lang === "ar" ? "تم الحفظ" : "Saved");
    setOpen(false); setForm({ product_id: "", warehouse_id: "", batch_number: "", expiry_date: "", quantity: 0, unit_cost: 0 });
    onSaved();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button><Plus className="h-4 w-4 me-1" />{lang === "ar" ? "دفعة جديدة" : "New batch"}</Button></DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>{lang === "ar" ? "دفعة جديدة" : "New batch"}</DialogTitle></DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5"><Label>{lang === "ar" ? "المنتج" : "Product"}</Label>
            <Select value={form.product_id} onValueChange={(v) => setForm({ ...form, product_id: v })}>
              <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent>{products.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5"><Label>{lang === "ar" ? "المستودع" : "Warehouse"}</Label>
            <Select value={form.warehouse_id} onValueChange={(v) => setForm({ ...form, warehouse_id: v })}>
              <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent>{warehouses.map(w => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5"><Label>{lang === "ar" ? "رقم الدفعة" : "Batch #"}</Label>
              <Input value={form.batch_number} onChange={(e) => setForm({ ...form, batch_number: e.target.value })} /></div>
            <div className="grid gap-1.5"><Label>{lang === "ar" ? "تاريخ الانتهاء" : "Expiry"}</Label>
              <Input type="date" value={form.expiry_date} onChange={(e) => setForm({ ...form, expiry_date: e.target.value })} /></div>
            <div className="grid gap-1.5"><Label>{lang === "ar" ? "الكمية" : "Quantity"}</Label>
              <Input type="number" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: Number(e.target.value) })} /></div>
            <div className="grid gap-1.5"><Label>{lang === "ar" ? "تكلفة الوحدة" : "Unit cost"}</Label>
              <Input type="number" value={form.unit_cost} onChange={(e) => setForm({ ...form, unit_cost: Number(e.target.value) })} /></div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>{lang === "ar" ? "إلغاء" : "Cancel"}</Button>
          <Button onClick={save}>{lang === "ar" ? "حفظ" : "Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

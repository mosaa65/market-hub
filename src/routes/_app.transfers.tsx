import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/page-header";
import { useI18n } from "@/lib/i18n";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { Plus, Trash2, ArrowRightLeft } from "lucide-react";

export const Route = createFileRoute("/_app/transfers")({
  head: () => ({ meta: [{ title: "Stock Transfers — Vortex ERP" }] }),
  component: TransfersPage,
});

function TransfersPage() {
  const { t, lang } = useI18n();
  const [list, setList] = useState<any[]>([]);

  const whName = (w?: { name: string; name_ar?: string | null } | null) => !w ? "—" : lang === "ar" ? (w.name_ar || w.name) : (w.name || w.name_ar || "—");
  async function load() {
    const { data } = await supabase.from("stock_transfers").select("*, from:warehouses!stock_transfers_from_warehouse_id_fkey(name,name_ar), to:warehouses!stock_transfers_to_warehouse_id_fkey(name,name_ar), stock_transfer_items(quantity)").order("created_at", { ascending: false }).limit(100);
    setList(data ?? []);
  }
  useEffect(() => { load(); }, []);

  return (
    <>
      <PageHeader
        title={lang === "ar" ? "تحويلات المخزون" : "Stock transfers"}
        subtitle={lang === "ar" ? "نقل البضائع بين المستودعات" : "Move goods between warehouses"}
        actions={<NewTransfer onSaved={load} />}
      />
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow>
              <TableHead>#</TableHead><TableHead>{lang === "ar" ? "التاريخ" : "Date"}</TableHead>
              <TableHead>{lang === "ar" ? "من" : "From"}</TableHead>
              <TableHead></TableHead>
              <TableHead>{lang === "ar" ? "إلى" : "To"}</TableHead>
              <TableHead className="text-end">{lang === "ar" ? "بنود" : "Items"}</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {list.length === 0 ? <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">{lang === "ar" ? "لا توجد تحويلات" : "No transfers"}</TableCell></TableRow>
                : list.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono text-xs">{r.transfer_number}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{new Date(r.created_at).toLocaleString()}</TableCell>
                    <TableCell>{whName(r.from)}</TableCell>
                    <TableCell><ArrowRightLeft className="h-4 w-4 text-muted-foreground" /></TableCell>
                    <TableCell>{whName(r.to)}</TableCell>
                    <TableCell className="text-end font-mono">{r.stock_transfer_items?.length ?? 0}</TableCell>
                  </TableRow>
                ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </>
  );
}

function NewTransfer({ onSaved }: { onSaved: () => void }) {
  const { t, lang } = useI18n();
  const [open, setOpen] = useState(false);
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [note, setNote] = useState("");
  const [search, setSearch] = useState("");
  const [lines, setLines] = useState<{ product_id: string; name: string; quantity: number }[]>([]);

  useEffect(() => {
    if (!open) return;
    Promise.all([
      supabase.from("warehouses").select("id,name").eq("is_active", true).order("name"),
      supabase.from("products").select("id,name,name_ar,sku").eq("is_active", true).order("name").limit(200),
    ]).then(([w, p]) => {
      setWarehouses(w.data ?? []); setProducts(p.data ?? []);
    });
  }, [open]);

  const filtered = useMemo(() =>
    products.filter((p) => !search || p.name.toLowerCase().includes(search.toLowerCase()) || p.sku?.toLowerCase().includes(search.toLowerCase())).slice(0, 8)
  , [products, search]);

  function addLine(p: any) {
    setLines((l) => {
      const ex = l.find((x) => x.product_id === p.id);
      if (ex) return l.map((x) => x.product_id === p.id ? { ...x, quantity: x.quantity + 1 } : x);
      return [...l, { product_id: p.id, name: p.name, quantity: 1 }];
    });
    setSearch("");
  }

  async function save() {
    if (!from || !to || from === to || lines.length === 0) { toast.error(lang === "ar" ? "تحقق من البيانات" : "Check the form"); return; }
    const { error } = await supabase.rpc("create_stock_transfer" as any, {
      _from: from, _to: to, _note: note || null, _items: lines as any,
    });
    if (error) { toast.error(error.message); return; }
    toast.success(lang === "ar" ? "تم التحويل" : "Transferred");
    setOpen(false); setLines([]); setNote(""); onSaved();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button><Plus className="h-4 w-4 me-1" />{lang === "ar" ? "تحويل جديد" : "New transfer"}</Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl">
        <DialogHeader><DialogTitle>{lang === "ar" ? "تحويل مخزون" : "Stock transfer"}</DialogTitle></DialogHeader>
        <div className="grid gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5"><Label>{lang === "ar" ? "من مستودع" : "From warehouse"}</Label>
              <Select value={from} onValueChange={setFrom}><SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>{warehouses.map((w) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5"><Label>{lang === "ar" ? "إلى مستودع" : "To warehouse"}</Label>
              <Select value={to} onValueChange={setTo}><SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>{warehouses.filter((w) => w.id !== from).map((w) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}</SelectContent>
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
                    <span className="text-xs text-muted-foreground font-mono">{p.sku}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="border border-border rounded-md max-h-64 overflow-auto">
            <Table>
              <TableHeader><TableRow><TableHead>{lang === "ar" ? "المنتج" : "Product"}</TableHead><TableHead>{lang === "ar" ? "الكمية" : "Quantity"}</TableHead><TableHead></TableHead></TableRow></TableHeader>
              <TableBody>
                {lines.length === 0 ? <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground py-6">{lang === "ar" ? "أضف منتجات" : "Add products"}</TableCell></TableRow>
                  : lines.map((l, i) => (
                    <TableRow key={l.product_id}>
                      <TableCell className="text-sm">{l.name}</TableCell>
                      <TableCell><Input type="number" className="h-8 w-24" value={l.quantity} onChange={(e) => setLines(ls => ls.map((x,j) => j===i ? {...x, quantity: Number(e.target.value)} : x))} /></TableCell>
                      <TableCell><Button size="icon" variant="ghost" onClick={() => setLines(ls => ls.filter((_,j) => j!==i))}><Trash2 className="h-4 w-4" /></Button></TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          </div>
          <Textarea placeholder={lang === "ar" ? "ملاحظات" : "Note"} rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>{t("common.cancel")}</Button>
          <Button onClick={save} disabled={lines.length === 0}>{t("common.save")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

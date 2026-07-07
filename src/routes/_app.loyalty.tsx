import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Gift, Plus, Search, Award } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/loyalty")({
  head: () => ({ meta: [{ title: "Loyalty — Vortex ERP" }] }),
  component: LoyaltyPage,
});

interface Customer { id: string; name: string; phone: string | null; loyalty_points: number; balance: number; }
interface Tx { id: string; customer_id: string; points: number; kind: string; note: string | null; created_at: string; }

function LoyaltyPage() {
  const { lang } = useI18n();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [tx, setTx] = useState<Tx[]>([]);
  const [search, setSearch] = useState("");

  async function load() {
    const [{ data: cs }, { data: ts }] = await Promise.all([
      supabase.from("customers").select("id,name,phone,loyalty_points,balance").order("loyalty_points", { ascending: false }),
      supabase.from("loyalty_transactions").select("*").order("created_at", { ascending: false }).limit(100),
    ]);
    setCustomers((cs ?? []) as any);
    setTx((ts ?? []) as any);
  }
  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => customers.filter(c =>
    !search || c.name.toLowerCase().includes(search.toLowerCase()) || (c.phone ?? "").includes(search)
  ), [customers, search]);

  const totalPoints = customers.reduce((s, c) => s + Number(c.loyalty_points || 0), 0);
  const topCount = customers.filter(c => Number(c.loyalty_points) > 0).length;

  return (
    <>
      <PageHeader
        title={lang === "ar" ? "نقاط الولاء" : "Loyalty program"}
        subtitle={lang === "ar" ? "إدارة نقاط العملاء (ربح / استبدال)" : "Manage customer points (earn / redeem)"}
        actions={<AdjustDialog customers={customers} onSaved={load} />}
      />

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3">
        <Card><CardContent className="p-4">
          <div className="text-xs text-muted-foreground">{lang === "ar" ? "إجمالي النقاط الموزعة" : "Total points outstanding"}</div>
          <div className="mt-1 text-2xl font-semibold flex items-center gap-2"><Award className="h-5 w-5 text-amber-500" />{totalPoints.toFixed(0)}</div>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="text-xs text-muted-foreground">{lang === "ar" ? "أعضاء فعّالون" : "Active members"}</div>
          <div className="mt-1 text-2xl font-semibold">{topCount}</div>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="text-xs text-muted-foreground">{lang === "ar" ? "حركات حديثة" : "Recent transactions"}</div>
          <div className="mt-1 text-2xl font-semibold">{tx.length}</div>
        </CardContent></Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <Card>
          <CardContent className="p-4">
            <div className="relative mb-4">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground rtl:left-auto rtl:right-3" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)}
                placeholder={lang === "ar" ? "ابحث عن عميل" : "Search customer"}
                className="pl-9 rtl:pl-3 rtl:pr-9" />
            </div>
            <Table>
              <TableHeader><TableRow>
                <TableHead>{lang === "ar" ? "العميل" : "Customer"}</TableHead>
                <TableHead>{lang === "ar" ? "الهاتف" : "Phone"}</TableHead>
                <TableHead className="text-end">{lang === "ar" ? "النقاط" : "Points"}</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {filtered.length === 0 ? <TableRow><TableCell colSpan={3} className="py-12 text-center text-muted-foreground">
                  <Gift className="mx-auto mb-2 h-8 w-8 opacity-50" />
                  {lang === "ar" ? "لا يوجد عملاء" : "No customers"}
                </TableCell></TableRow>
                : filtered.map(c => (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium">{c.name}</TableCell>
                    <TableCell className="text-muted-foreground">{c.phone ?? "—"}</TableCell>
                    <TableCell className="text-end font-mono font-semibold text-amber-500">{Number(c.loyalty_points).toFixed(0)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <h3 className="mb-3 text-sm font-semibold">{lang === "ar" ? "آخر الحركات" : "Recent activity"}</h3>
            <div className="space-y-2 max-h-[500px] overflow-y-auto">
              {tx.length === 0 ? <div className="text-sm text-muted-foreground">{lang === "ar" ? "لا توجد حركات" : "No activity"}</div>
              : tx.map(t => {
                const cust = customers.find(c => c.id === t.customer_id);
                return (
                  <div key={t.id} className="flex items-center justify-between rounded-md border border-border p-2 text-sm">
                    <div>
                      <div className="font-medium">{cust?.name ?? "—"}</div>
                      <div className="text-[10px] text-muted-foreground">{new Date(t.created_at).toLocaleString()}</div>
                    </div>
                    <Badge variant="outline" className={
                      t.kind === "earn" ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" :
                      t.kind === "redeem" ? "bg-red-500/10 text-red-400 border-red-500/20" :
                      "bg-muted text-muted-foreground"
                    }>
                      {t.kind === "redeem" ? "-" : "+"}{Math.abs(Number(t.points))}
                    </Badge>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  );
}

function AdjustDialog({ customers, onSaved }: { customers: Customer[]; onSaved: () => void }) {
  const { lang } = useI18n();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ customer_id: "", points: 10, kind: "earn", note: "" });

  async function save() {
    if (!form.customer_id || !form.points) { toast.error(t("common.fill_form")); return; }
    const { error } = await supabase.rpc("adjust_loyalty" as any, {
      _customer: form.customer_id, _points: form.points, _kind: form.kind, _note: form.note || null,
    });
    if (error) return toast.error(error.message);
    toast.success(t("common.updated"));
    setOpen(false); setForm({ customer_id: "", points: 10, kind: "earn", note: "" }); onSaved();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button><Plus className="h-4 w-4 me-1" />{lang === "ar" ? "تعديل نقاط" : "Adjust points"}</Button></DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>{lang === "ar" ? "تعديل نقاط الولاء" : "Adjust loyalty points"}</DialogTitle></DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5"><Label>{lang === "ar" ? "العميل" : "Customer"}</Label>
            <Select value={form.customer_id} onValueChange={(v) => setForm({ ...form, customer_id: v })}>
              <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent>{customers.map(c => <SelectItem key={c.id} value={c.id}>{c.name} ({Number(c.loyalty_points).toFixed(0)})</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5"><Label>{lang === "ar" ? "النوع" : "Kind"}</Label>
              <Select value={form.kind} onValueChange={(v) => setForm({ ...form, kind: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="earn">{lang === "ar" ? "ربح" : "Earn"}</SelectItem>
                  <SelectItem value="redeem">{lang === "ar" ? "استبدال" : "Redeem"}</SelectItem>
                  <SelectItem value="adjust">{lang === "ar" ? "تسوية" : "Adjust"}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5"><Label>{lang === "ar" ? "النقاط" : "Points"}</Label>
              <Input type="number" value={form.points} onChange={(e) => setForm({ ...form, points: Number(e.target.value) })} />
            </div>
          </div>
          <Textarea rows={2} placeholder={lang === "ar" ? "ملاحظات" : "Note"} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>{lang === "ar" ? "إلغاء" : "Cancel"}</Button>
          <Button onClick={save}>{lang === "ar" ? "حفظ" : "Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

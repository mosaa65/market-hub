import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { CalendarClock, Plus, Trash2, AlertTriangle, Search, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { useI18n } from "@/lib/i18n";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/batches")({
  head: () => ({ meta: [{ title: "Batches & Expiry — Vortex ERP" }] }),
  component: BatchesPage,
});

interface Batch {
  id: string; product_id: string; warehouse_id: string;
  batch_number: string; expiry_date: string | null; quantity: number; unit_cost: number;
  products?: { name: string; name_ar: string | null; sku: string | null } | null;
  warehouses?: { name: string; name_ar: string | null } | null;
}

function BatchesPage() {
  const { lang, t } = useI18n();
  const [rows, setRows] = useState<Batch[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);

  async function load() {
    setLoading(true);
    const { data } = await supabase
      .from("product_batches")
      .select("*, products(name,name_ar,sku), warehouses(name,name_ar)")
      .order("expiry_date", { ascending: true, nullsFirst: false });
    setRows((data ?? []) as any);
    setLoading(false);
  }
  useEffect(() => { void load(); }, []);

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const soon = new Date(today); soon.setDate(today.getDate() + 30);

  const filtered = useMemo(() => rows.filter(r =>
    !search ||
    r.batch_number.toLowerCase().includes(search.toLowerCase()) ||
    (r.products?.name ?? "").toLowerCase().includes(search.toLowerCase()) ||
    (r.products?.name_ar ?? "").includes(search) ||
    (r.products?.sku ?? "").toLowerCase().includes(search.toLowerCase())
  ), [rows, search]);

  function status(exp: string | null) {
    if (!exp) return { label: lang === "ar" ? "بدون انتهاء" : "No expiry", cls: "bg-muted text-muted-foreground border-border" };
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
      />

      {expiringCount > 0 && (
        <div className="mb-4 flex items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-sm text-amber-500">
          <AlertTriangle className="h-4 w-4" />
          {lang === "ar" ? `${expiringCount} دفعة قريبة الانتهاء أو منتهية` : `${expiringCount} batch(es) expired or expiring within 30 days`}
        </div>
      )}

      <div className="panel-elevated p-4">
        <div className="mb-4 flex items-center gap-2">
          <div className="flex h-10 flex-1 items-center gap-2 rounded-full border border-input bg-surface px-4 text-sm">
            <Search className="h-4 w-4 text-muted-foreground" />
            <input value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder={lang === "ar" ? "ابحث بالدفعة أو المنتج" : "Search batch or product..."}
              className="flex-1 bg-transparent outline-none placeholder:text-muted-foreground" />
          </div>
          <button onClick={() => setOpen(true)} className="flex h-10 shrink-0 items-center gap-1.5 rounded-full bg-primary px-4 text-xs font-semibold text-primary-foreground shadow-sm shadow-primary/20 hover:opacity-90 transition">
            <Plus className="h-3.5 w-3.5" /> <span className="hidden sm:inline">{lang === "ar" ? "دفعة جديدة" : "New batch"}</span>
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs uppercase tracking-wide text-muted-foreground">
              <tr className="border-b border-border">
                <th className="px-3 py-2 text-start font-medium">{lang === "ar" ? "الدفعة" : "Batch"}</th>
                <th className="px-3 py-2 text-start font-medium">{lang === "ar" ? "المنتج" : "Product"}</th>
                <th className="px-3 py-2 text-start font-medium">{lang === "ar" ? "المستودع" : "Warehouse"}</th>
                <th className="px-3 py-2 text-end font-medium">{lang === "ar" ? "الكمية" : "Qty"}</th>
                <th className="px-3 py-2 text-start font-medium">{lang === "ar" ? "تاريخ الانتهاء" : "Expiry"}</th>
                <th className="px-3 py-2 text-start font-medium">{lang === "ar" ? "الحالة" : "Status"}</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {loading ? <tr><td colSpan={7} className="py-10 text-center text-muted-foreground">…</td></tr>
                : filtered.length === 0 ? <tr><td colSpan={7} className="py-12 text-center text-muted-foreground">
                    <CalendarClock className="mx-auto mb-2 h-8 w-8 opacity-50" />
                    {lang === "ar" ? "لا توجد دفعات" : "No batches yet"}
                  </td></tr>
                : filtered.map(r => {
                  const s = status(r.expiry_date);
                  const wh = lang === "ar" ? (r.warehouses?.name_ar || r.warehouses?.name) : (r.warehouses?.name || r.warehouses?.name_ar);
                  const pn = lang === "ar" ? (r.products?.name_ar || r.products?.name) : (r.products?.name || r.products?.name_ar);
                  return (
                    <tr key={r.id} className="border-b border-border/50 hover:bg-surface-2/50">
                      <td className="px-3 py-2.5 font-mono text-xs">{r.batch_number}</td>
                      <td className="px-3 py-2.5">{pn}</td>
                      <td className="px-3 py-2.5 text-muted-foreground">{wh}</td>
                      <td className="px-3 py-2.5 text-end font-mono">{r.quantity}</td>
                      <td className="px-3 py-2.5 text-muted-foreground">{r.expiry_date ?? "—"}</td>
                      <td className="px-3 py-2.5"><span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] ${s.cls}`}>{s.label}</span></td>
                      <td className="px-3 py-2.5 text-end">
                        <button onClick={() => remove(r.id)} title={t("common.delete")} className="grid h-8 w-8 place-items-center rounded-full border border-destructive/30 bg-destructive/5 text-destructive hover:bg-destructive/10 transition ms-auto"><Trash2 className="h-3.5 w-3.5" /></button>
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      </div>

      {open && <NewBatchModal onClose={() => setOpen(false)} onSaved={() => { setOpen(false); load(); }} />}
    </>
  );
}

function NewBatchModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { lang, t } = useI18n();
  const [products, setProducts] = useState<any[]>([]);
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [form, setForm] = useState({ product_id: "", warehouse_id: "", batch_number: "", expiry_date: "", quantity: 0, unit_cost: 0 });

  useEffect(() => {
    Promise.all([
      supabase.from("products").select("id,name,name_ar,sku").eq("is_active", true).order("name").limit(500),
      supabase.from("warehouses").select("id,name,name_ar").eq("is_active", true).order("name"),
    ]).then(([p, w]) => { setProducts(p.data ?? []); setWarehouses(w.data ?? []); });
  }, []);

  async function save() {
    if (!form.product_id || !form.warehouse_id || !form.batch_number) {
      toast.error(lang === "ar" ? "أكمل البيانات" : "Fill required fields"); return;
    }
    const { error } = await supabase.from("product_batches").insert({ ...form, expiry_date: form.expiry_date || null });
    if (error) return toast.error(error.message);
    toast.success(lang === "ar" ? "تم الحفظ" : "Saved");
    onSaved();
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-background/80 backdrop-blur-sm p-4">
      <div className="panel-elevated w-full max-w-md p-6">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold">{lang === "ar" ? "دفعة جديدة" : "New batch"}</h3>
          <button onClick={onClose} className="rounded p-1 hover:bg-surface-2"><X className="h-4 w-4" /></button>
        </div>
        <div className="space-y-3">
          <Field label={lang === "ar" ? "المنتج" : "Product"}>
            <select value={form.product_id} onChange={e => setForm({ ...form, product_id: e.target.value })} className="h-9 w-full rounded-md border border-input bg-surface px-3 text-sm">
              <option value="">—</option>
              {products.map(p => <option key={p.id} value={p.id}>{lang === "ar" ? (p.name_ar || p.name) : (p.name || p.name_ar)}</option>)}
            </select>
          </Field>
          <Field label={lang === "ar" ? "المستودع" : "Warehouse"}>
            <select value={form.warehouse_id} onChange={e => setForm({ ...form, warehouse_id: e.target.value })} className="h-9 w-full rounded-md border border-input bg-surface px-3 text-sm">
              <option value="">—</option>
              {warehouses.map(w => <option key={w.id} value={w.id}>{lang === "ar" ? (w.name_ar || w.name) : (w.name || w.name_ar)}</option>)}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={lang === "ar" ? "رقم الدفعة" : "Batch #"}>
              <input value={form.batch_number} onChange={e => setForm({ ...form, batch_number: e.target.value })} className="h-9 w-full rounded-md border border-input bg-surface px-3 text-sm" />
            </Field>
            <Field label={lang === "ar" ? "تاريخ الانتهاء" : "Expiry"}>
              <input type="date" value={form.expiry_date} onChange={e => setForm({ ...form, expiry_date: e.target.value })} className="h-9 w-full rounded-md border border-input bg-surface px-3 text-sm" />
            </Field>
            <Field label={lang === "ar" ? "الكمية" : "Quantity"}>
              <input type="number" value={form.quantity} onChange={e => setForm({ ...form, quantity: Number(e.target.value) })} className="h-9 w-full rounded-md border border-input bg-surface px-3 text-sm" />
            </Field>
            <Field label={lang === "ar" ? "تكلفة الوحدة" : "Unit cost"}>
              <input type="number" value={form.unit_cost} onChange={e => setForm({ ...form, unit_cost: Number(e.target.value) })} className="h-9 w-full rounded-md border border-input bg-surface px-3 text-sm" />
            </Field>
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="h-9 rounded-md border border-border px-4 text-sm hover:bg-surface-2">{t("common.cancel")}</button>
          <button onClick={save} className="h-9 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90">{t("common.save")}</button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-medium text-muted-foreground">{label}</label>
      {children}
    </div>
  );
}

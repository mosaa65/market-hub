import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Building2, Plus, Search, Edit, Trash2, X, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { useI18n } from "@/lib/i18n";
import { money } from "@/lib/format";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/suppliers")({
  head: () => ({ meta: [{ title: "Suppliers — Vortex ERP" }] }),
  component: SuppliersPage,
});

interface Supplier {
  id: string; name: string; phone: string | null; email: string | null;
  address: string | null; balance: number; is_active: boolean; created_at: string;
}

function SuppliersPage() {
  const { t } = useI18n();
  const [rows, setRows] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [edit, setEdit] = useState<Partial<Supplier> | null>(null);

  async function load() {
    setLoading(true);
    const { data } = await supabase.from("suppliers").select("*").order("name");
    setRows((data ?? []) as Supplier[]);
    setLoading(false);
  }
  useEffect(() => { void load(); }, []);

  const filtered = rows.filter(r =>
    !search || r.name.toLowerCase().includes(search.toLowerCase()) ||
    (r.phone ?? "").includes(search) || (r.email ?? "").toLowerCase().includes(search.toLowerCase())
  );

  async function save() {
    if (!edit?.name?.trim()) return toast.error("Name required");
    const payload = {
      name: edit.name.trim(),
      phone: edit.phone || null,
      email: edit.email || null,
      address: edit.address || null,
      is_active: edit.is_active ?? true,
    };
    const { error } = edit.id
      ? await supabase.from("suppliers").update(payload).eq("id", edit.id)
      : await supabase.from("suppliers").insert(payload);
    if (error) return toast.error(error.message);
    toast.success(edit.id ? "Updated" : "Created");
    setEdit(null); await load();
  }
  async function remove(id: string) {
    if (!confirm("Delete this supplier?")) return;
    const { error } = await supabase.from("suppliers").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Deleted"); await load();
  }

  return (
    <>
      <PageHeader title={t("suppliers.title")} subtitle="Vendor directory with balances and contact info."
        actions={
          <button onClick={() => setEdit({})} className="flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:opacity-90">
            <Plus className="h-4 w-4" /> New supplier
          </button>
        }
      />
      <div className="panel-elevated p-4">
        <div className="relative mb-4">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground rtl:left-auto rtl:right-3" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search suppliers..."
            className="h-10 w-full rounded-md border border-input bg-surface pl-9 pr-3 text-sm rtl:pl-3 rtl:pr-9 focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20" />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs uppercase tracking-wide text-muted-foreground">
              <tr className="border-b border-border">
                <th className="px-3 py-2 text-start font-medium">Name</th>
                <th className="px-3 py-2 text-start font-medium">Phone</th>
                <th className="px-3 py-2 text-start font-medium">Email</th>
                <th className="px-3 py-2 text-end font-medium">Balance</th>
                <th className="px-3 py-2 text-start font-medium">Status</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {loading ? <tr><td colSpan={6} className="py-10 text-center text-muted-foreground">Loading…</td></tr>
              : filtered.length === 0 ? (
                <tr><td colSpan={6} className="py-12 text-center text-muted-foreground">
                  <Building2 className="mx-auto mb-2 h-8 w-8 opacity-50" />No suppliers yet
                </td></tr>
              ) : filtered.map(r => (
                <tr key={r.id} className="border-b border-border/50 hover:bg-surface-2/50">
                  <td className="px-3 py-2.5 font-medium">{r.name}</td>
                  <td className="px-3 py-2.5 text-muted-foreground">{r.phone ?? "—"}</td>
                  <td className="px-3 py-2.5 text-muted-foreground">{r.email ?? "—"}</td>
                  <td className="px-3 py-2.5 text-end font-mono">{money(Number(r.balance))}</td>
                  <td className="px-3 py-2.5">
                    <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] ${r.is_active ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-400" : "border-border bg-muted text-muted-foreground"}`}>
                      {r.is_active ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-end">
                    <div className="flex justify-end gap-1">
                      <button onClick={() => setEdit(r)} className="rounded p-1.5 text-muted-foreground hover:bg-surface-2 hover:text-foreground"><Edit className="h-4 w-4" /></button>
                      <button onClick={() => remove(r.id)} className="rounded p-1.5 text-muted-foreground hover:bg-surface-2 hover:text-destructive"><Trash2 className="h-4 w-4" /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {edit && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-background/80 backdrop-blur-sm p-4">
          <div className="panel-elevated w-full max-w-md p-6">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold">{edit.id ? "Edit supplier" : "New supplier"}</h3>
              <button onClick={() => setEdit(null)} className="rounded p-1 hover:bg-surface-2"><X className="h-4 w-4" /></button>
            </div>
            <div className="space-y-3">
              <Input label="Name *" value={edit.name ?? ""} onChange={v => setEdit({ ...edit, name: v })} />
              <Input label="Phone" value={edit.phone ?? ""} onChange={v => setEdit({ ...edit, phone: v })} />
              <Input label="Email" value={edit.email ?? ""} onChange={v => setEdit({ ...edit, email: v })} type="email" />
              <Input label="Address" value={edit.address ?? ""} onChange={v => setEdit({ ...edit, address: v })} />
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={edit.is_active ?? true} onChange={e => setEdit({ ...edit, is_active: e.target.checked })} className="h-4 w-4 rounded border-border" />
                Active
              </label>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setEdit(null)} className="h-9 rounded-md border border-border px-4 text-sm hover:bg-surface-2">Cancel</button>
              <button onClick={save} className="h-9 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90">Save</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Input({ label, value, onChange, type = "text" }: { label: string; value: string; onChange: (v: string) => void; type?: string }) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-medium text-muted-foreground">{label}</label>
      <input type={type} value={value} onChange={e => onChange(e.target.value)}
        className="h-9 w-full rounded-md border border-input bg-surface px-3 text-sm focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20" />
    </div>
  );
}

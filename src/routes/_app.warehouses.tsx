import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { PageHeader } from "@/components/page-header";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import { Boxes, Pencil, Plus, Search, Star, Trash2, X } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/warehouses")({
  head: () => ({ meta: [{ title: "Warehouses — Vortex ERP" }] }),
  component: WarehousesPage,
});

type Row = {
  id: string; name: string; name_ar: string | null; code: string | null;
  address: string | null; is_default: boolean; is_active: boolean;
};

function WarehousesPage() {
  const { t, lang } = useI18n();
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<Row | null>(null);
  const [open, setOpen] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["warehouses-admin"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("warehouses")
        .select("id, name, name_ar, code, address, is_default, is_active")
        .order("is_default", { ascending: false })
        .order("name");
      if (error) throw error;
      return (data ?? []) as Row[];
    },
  });

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return data ?? [];
    return (data ?? []).filter((r) =>
      [r.name, r.name_ar, r.code, r.address].some((x) => (x ?? "").toLowerCase().includes(s))
    );
  }, [data, q]);

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("warehouses").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success(t("common.deleted") || "Deleted"); qc.invalidateQueries({ queryKey: ["warehouses-admin"] }); qc.invalidateQueries({ queryKey: ["warehouses"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const setDefault = useMutation({
    mutationFn: async (id: string) => {
      await supabase.from("warehouses").update({ is_default: false }).neq("id", id);
      const { error } = await supabase.from("warehouses").update({ is_default: true, is_active: true }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["warehouses-admin"] }); qc.invalidateQueries({ queryKey: ["warehouses"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <>
      <PageHeader
        title={t("warehouses.title")}
        subtitle={t("warehouses.subtitle")}
      />

      <div className="panel-elevated overflow-hidden">
        <div className="flex items-center gap-2 border-b border-border p-3">
          <div className="flex h-10 flex-1 items-center gap-2 rounded-full border border-border bg-surface px-4 text-sm">
            <Search className="h-4 w-4 text-muted-foreground" />
            <input value={q} onChange={(e) => setQ(e.target.value)} className="flex-1 bg-transparent outline-none placeholder:text-muted-foreground" placeholder={t("common.search")} />
            <span className="hidden sm:inline text-[11px] text-muted-foreground tabular-nums">{filtered.length}</span>
          </div>
          <button onClick={() => { setEditing(null); setOpen(true); }} className="flex h-10 shrink-0 items-center gap-1.5 rounded-full bg-primary px-4 text-xs font-semibold text-primary-foreground shadow-sm shadow-primary/20 hover:opacity-90 transition">
            <Plus className="h-3.5 w-3.5" /> <span className="hidden sm:inline">{t("warehouses.new")}</span>
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-[11px] uppercase tracking-wider text-muted-foreground">
                <th className="px-4 py-2.5 text-start font-medium">{t("warehouses.name")}</th>
                <th className="px-4 py-2.5 text-start font-medium">{t("warehouses.code")}</th>
                <th className="px-4 py-2.5 text-start font-medium">{t("warehouses.address")}</th>
                <th className="px-4 py-2.5 text-end font-medium">{t("common.status")}</th>
                <th className="px-4 py-2.5 text-end font-medium">{t("common.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && Array.from({ length: 4 }).map((_, i) => (
                <tr key={i} className="border-b border-border/60"><td colSpan={5} className="px-4 py-3"><div className="h-4 w-full rounded shimmer" /></td></tr>
              ))}
              {!isLoading && filtered.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-16 text-center">
                  <div className="mx-auto grid h-10 w-10 place-items-center rounded-md bg-surface border border-border"><Boxes className="h-5 w-5 text-muted-foreground" /></div>
                  <p className="mt-3 text-sm text-foreground">{t("warehouses.empty")}</p>
                  <p className="text-xs text-muted-foreground">{t("warehouses.empty_hint")}</p>
                </td></tr>
              )}
              {filtered.map((r) => {
                const display = lang === "ar" ? (r.name_ar || r.name) : (r.name || r.name_ar || "—");
                const secondary = lang === "ar" ? r.name : r.name_ar;
                return (
                  <tr key={r.id} className="border-b border-border/60 hover:bg-accent/40 transition-colors">
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2 font-medium text-foreground">
                        {display}
                        {r.is_default && <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary"><Star className="h-3 w-3" />{t("warehouses.is_default")}</span>}
                      </div>
                      {secondary && <div className="text-[11px] text-muted-foreground">{secondary}</div>}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">{r.code ?? "—"}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">{r.address ?? "—"}</td>
                    <td className="px-4 py-2.5 text-end">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium ${r.is_active ? "bg-success/10 text-success" : "bg-muted text-muted-foreground"}`}>
                        {r.is_active ? t("common.active") : t("common.inactive")}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-end">
                      <div className="inline-flex items-center gap-1">
                        {!r.is_default && (
                          <button onClick={() => setDefault.mutate(r.id)} className="grid h-7 w-7 place-items-center rounded-md border border-border bg-surface text-muted-foreground hover:text-primary transition" title={t("warehouses.set_default")}>
                            <Star className="h-3.5 w-3.5" />
                          </button>
                        )}
                        <button onClick={() => { setEditing(r); setOpen(true); }} className="grid h-7 w-7 place-items-center rounded-md border border-border bg-surface text-muted-foreground hover:text-foreground transition" title={t("common.edit")}>
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button onClick={() => { if (confirm(`${t("common.delete")}?`)) remove.mutate(r.id); }} className="grid h-7 w-7 place-items-center rounded-md border border-border bg-surface text-muted-foreground hover:text-destructive transition" title={t("common.delete")}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {open && <WarehouseDialog initial={editing} onClose={() => setOpen(false)} onSaved={() => { setOpen(false); qc.invalidateQueries({ queryKey: ["warehouses-admin"] }); qc.invalidateQueries({ queryKey: ["warehouses"] }); }} />}
    </>
  );
}

const inputCls = "h-9 w-full rounded-md border border-border bg-surface px-3 text-sm text-foreground outline-none focus:border-primary/60 focus:ring-1 focus:ring-primary/30 transition";

function WarehouseDialog({ initial, onClose, onSaved }: { initial: Row | null; onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n();
  const [form, setForm] = useState({
    name: initial?.name ?? "",
    name_ar: initial?.name_ar ?? "",
    code: initial?.code ?? "",
    address: initial?.address ?? "",
    is_default: initial?.is_default ?? false,
    is_active: initial?.is_active ?? true,
  });
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name_ar.trim() && !form.name.trim()) { toast.error(t("catalog.name_required")); return; }
    setSaving(true);
    const payload = {
      name: (form.name.trim() || form.name_ar.trim()),
      name_ar: form.name_ar.trim() || null,
      code: form.code.trim() || null,
      address: form.address.trim() || null,
      is_default: form.is_default,
      is_active: form.is_active,
    };
    if (form.is_default) {
      await supabase.from("warehouses").update({ is_default: false }).neq("id", initial?.id ?? "00000000-0000-0000-0000-000000000000");
    }
    const { error } = initial
      ? await supabase.from("warehouses").update(payload).eq("id", initial.id)
      : await supabase.from("warehouses").insert(payload);
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success(t("common.saved") || "Saved");
    onSaved();
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
      <form onSubmit={submit} onClick={(e) => e.stopPropagation()} className="panel-elevated w-full max-w-lg overflow-hidden">
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="text-sm font-semibold text-foreground">{initial ? t("warehouses.edit") : t("warehouses.new")}</h2>
          <button type="button" onClick={onClose} className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground hover:bg-accent"><X className="h-4 w-4" /></button>
        </div>
        <div className="grid grid-cols-1 gap-3 p-5 sm:grid-cols-2">
          <Field label={`${t("warehouses.name_ar")} *`}>
            <input value={form.name_ar} onChange={(e) => setForm({ ...form, name_ar: e.target.value })} className={inputCls} dir="rtl" required />
          </Field>
          <Field label={t("warehouses.name")}>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputCls} />
          </Field>
          <Field label={t("warehouses.code")}>
            <input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} className={inputCls} />
          </Field>
          <Field label={t("common.status")}>
            <label className="flex h-9 items-center gap-2 rounded-md border border-border bg-surface px-3 text-sm">
              <input type="checkbox" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} />
              <span className="text-muted-foreground">{t("common.active")}</span>
            </label>
          </Field>
          <Field label={t("warehouses.address")} className="sm:col-span-2">
            <input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} className={inputCls} />
          </Field>
          <Field label={t("warehouses.is_default")} className="sm:col-span-2">
            <label className="flex h-9 items-center gap-2 rounded-md border border-border bg-surface px-3 text-sm">
              <input type="checkbox" checked={form.is_default} onChange={(e) => setForm({ ...form, is_default: e.target.checked })} />
              <span className="text-muted-foreground">{t("warehouses.set_default")}</span>
            </label>
          </Field>
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-border bg-surface/40 px-5 py-3">
          <button type="button" onClick={onClose} className="flex h-9 items-center rounded-md border border-border bg-surface px-3 text-xs font-medium text-muted-foreground hover:text-foreground transition">{t("common.cancel")}</button>
          <button type="submit" disabled={saving} className="flex h-9 items-center rounded-md bg-primary px-4 text-xs font-medium text-primary-foreground hover:opacity-90 transition disabled:opacity-50">{saving ? t("common.saving") : t("common.save")}</button>
        </div>
      </form>
    </div>
  );
}

function Field({ label, children, className = "" }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={`flex flex-col gap-1.5 ${className}`}>
      <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

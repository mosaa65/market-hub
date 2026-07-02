import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { PageHeader } from "@/components/page-header";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import { Layers, Pencil, Plus, Search, Trash2, X } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/catalog")({
  head: () => ({ meta: [{ title: "Catalog — Vortex ERP" }] }),
  component: CatalogPage,
});

type Tab = "categories" | "brands" | "units";

type Item = {
  id: string;
  name: string;
  name_ar: string | null;
  short_name?: string | null;
};

function CatalogPage() {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>("categories");

  const tabs: { key: Tab; label: string }[] = [
    { key: "categories", label: t("catalog.categories") },
    { key: "brands", label: t("catalog.brands") },
    { key: "units", label: t("catalog.units") },
  ];

  return (
    <>
      <PageHeader title={t("catalog.title")} subtitle={t("catalog.subtitle")} />
      <div className="mb-4 inline-flex items-center gap-1 rounded-md border border-border bg-surface p-1">
        {tabs.map((tt) => (
          <button
            key={tt.key}
            onClick={() => setTab(tt.key)}
            className={`h-8 rounded-[6px] px-3 text-xs font-medium transition ${tab === tt.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
          >
            {tt.label}
          </button>
        ))}
      </div>
      <CatalogTable tab={tab} />
    </>
  );
}

function CatalogTable({ tab }: { tab: Tab }) {
  const { t, lang } = useI18n();
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<Item | null>(null);
  const [open, setOpen] = useState(false);

  const table = tab === "categories" ? "categories" : tab === "brands" ? "brands" : "units";
  const cols = tab === "units" ? "id, name, name_ar, short_name" : "id, name, name_ar";

  const { data, isLoading } = useQuery({
    queryKey: ["catalog", tab],
    queryFn: async () => {
      const { data, error } = await supabase.from(table as "categories").select(cols).order("name");
      if (error) throw error;
      return (data ?? []) as unknown as Item[];
    },
  });

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return data ?? [];
    return (data ?? []).filter((r) => [r.name, r.name_ar, r.short_name].some((x) => (x ?? "").toLowerCase().includes(s)));
  }, [data, q]);

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from(table as "categories").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success(t("common.deleted") || "Deleted"); qc.invalidateQueries({ queryKey: ["catalog", tab] }); qc.invalidateQueries({ queryKey: ["products-meta"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const newLabel = tab === "categories" ? t("catalog.new_category") : tab === "brands" ? t("catalog.new_brand") : t("catalog.new_unit");

  return (
    <div className="panel-elevated overflow-hidden">
      <div className="flex items-center gap-2 border-b border-border p-3">
        <div className="flex h-9 flex-1 items-center gap-2 rounded-md border border-border bg-surface px-3 text-sm">
          <Search className="h-3.5 w-3.5 text-muted-foreground" />
          <input value={q} onChange={(e) => setQ(e.target.value)} className="flex-1 bg-transparent outline-none placeholder:text-muted-foreground" placeholder={t("common.search")} />
        </div>
        <span className="text-[11px] text-muted-foreground tabular-nums">{filtered.length}</span>
        <button onClick={() => { setEditing(null); setOpen(true); }} className="flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:opacity-90 transition">
          <Plus className="h-3.5 w-3.5" /> {newLabel}
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-[11px] uppercase tracking-wider text-muted-foreground">
              <th className="px-4 py-2.5 text-start font-medium">{t("catalog.name_ar")}</th>
              <th className="px-4 py-2.5 text-start font-medium">{t("catalog.name_en")}</th>
              {tab === "units" && <th className="px-4 py-2.5 text-start font-medium">{t("catalog.short_name")}</th>}
              <th className="px-4 py-2.5 text-end font-medium">{t("common.actions")}</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && Array.from({ length: 4 }).map((_, i) => (
              <tr key={i} className="border-b border-border/60"><td colSpan={tab === "units" ? 4 : 3} className="px-4 py-3"><div className="h-4 w-full rounded shimmer" /></td></tr>
            ))}
            {!isLoading && filtered.length === 0 && (
              <tr><td colSpan={tab === "units" ? 4 : 3} className="px-4 py-16 text-center">
                <div className="mx-auto grid h-10 w-10 place-items-center rounded-md bg-surface border border-border"><Layers className="h-5 w-5 text-muted-foreground" /></div>
                <p className="mt-3 text-sm text-foreground">{t("catalog.empty")}</p>
              </td></tr>
            )}
            {filtered.map((r) => (
              <tr key={r.id} className="border-b border-border/60 hover:bg-accent/40 transition-colors">
                <td className="px-4 py-2.5 font-medium text-foreground" dir="rtl">{r.name_ar || "—"}</td>
                <td className="px-4 py-2.5 text-muted-foreground">{r.name || "—"}</td>
                {tab === "units" && <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">{r.short_name ?? "—"}</td>}
                <td className="px-4 py-2.5 text-end">
                  <div className="inline-flex items-center gap-1">
                    <button onClick={() => { setEditing(r); setOpen(true); }} className="grid h-7 w-7 place-items-center rounded-md border border-border bg-surface text-muted-foreground hover:text-foreground transition" title={t("common.edit")}><Pencil className="h-3.5 w-3.5" /></button>
                    <button onClick={() => { if (confirm(t("catalog.confirm_delete"))) remove.mutate(r.id); }} className="grid h-7 w-7 place-items-center rounded-md border border-border bg-surface text-muted-foreground hover:text-destructive transition" title={t("common.delete")}><Trash2 className="h-3.5 w-3.5" /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {open && (
        <CatalogDialog
          tab={tab}
          initial={editing}
          onClose={() => setOpen(false)}
          onSaved={() => { setOpen(false); qc.invalidateQueries({ queryKey: ["catalog", tab] }); qc.invalidateQueries({ queryKey: ["products-meta"] }); }}
        />
      )}
    </div>
  );
}

const inputCls = "h-9 w-full rounded-md border border-border bg-surface px-3 text-sm text-foreground outline-none focus:border-primary/60 focus:ring-1 focus:ring-primary/30 transition";

function CatalogDialog({ tab, initial, onClose, onSaved }: { tab: Tab; initial: Item | null; onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n();
  const [form, setForm] = useState({
    name: initial?.name ?? "",
    name_ar: initial?.name_ar ?? "",
    short_name: initial?.short_name ?? "",
  });
  const [saving, setSaving] = useState(false);

  const editLabel = tab === "categories" ? (initial ? t("catalog.edit_category") : t("catalog.new_category"))
    : tab === "brands" ? (initial ? t("catalog.edit_brand") : t("catalog.new_brand"))
    : (initial ? t("catalog.edit_unit") : t("catalog.new_unit"));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name_ar.trim() && !form.name.trim()) { toast.error(t("catalog.name_required")); return; }
    setSaving(true);
    const table = tab === "categories" ? "categories" : tab === "brands" ? "brands" : "units";
    const payload: Record<string, unknown> = {
      name: (form.name.trim() || form.name_ar.trim()),
      name_ar: form.name_ar.trim() || null,
    };
    if (tab === "units") payload.short_name = form.short_name.trim() || form.name.trim().slice(0, 4) || "unit";
    const { error } = initial
      ? await supabase.from(table as "categories").update(payload).eq("id", initial.id)
      : await supabase.from(table as "categories").insert(payload);
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success(t("common.saved") || "Saved");
    onSaved();
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
      <form onSubmit={submit} onClick={(e) => e.stopPropagation()} className="panel-elevated w-full max-w-md overflow-hidden">
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="text-sm font-semibold text-foreground">{editLabel}</h2>
          <button type="button" onClick={onClose} className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground hover:bg-accent"><X className="h-4 w-4" /></button>
        </div>
        <div className="grid gap-3 p-5">
          <Field label={`${t("catalog.name_ar")} *`}>
            <input value={form.name_ar} onChange={(e) => setForm({ ...form, name_ar: e.target.value })} className={inputCls} dir="rtl" required />
          </Field>
          <Field label={t("catalog.name_en")}>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputCls} />
          </Field>
          {tab === "units" && (
            <Field label={t("catalog.short_name")}>
              <input value={form.short_name} onChange={(e) => setForm({ ...form, short_name: e.target.value })} className={inputCls} />
            </Field>
          )}
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

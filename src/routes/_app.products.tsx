import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { PageHeader } from "@/components/page-header";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import { Plus, Package, Search, Pencil, Trash2, X } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/products")({
  head: () => ({ meta: [{ title: "Products — Vortex ERP" }] }),
  component: ProductsPage,
});

type ProductRow = {
  id: string; name: string; name_ar: string | null; sku: string | null; barcode: string | null;
  sale_price: number; cost_price: number; tax_rate: number; min_stock: number;
  is_active: boolean; category_id: string | null; brand_id: string | null; unit_id: string | null;
  category?: { name: string; name_ar: string | null } | null;
  brand?: { name: string; name_ar: string | null } | null;
  unit?: { short_name: string; name_ar: string | null } | null;
};

function ProductsPage() {
  const { t, lang } = useI18n();
  const qc = useQueryClient();
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<ProductRow | null>(null);
  const [open, setOpen] = useState(false);

  const { data: products, isLoading } = useQuery({
    queryKey: ["products"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("id, name, name_ar, sku, barcode, sale_price, cost_price, tax_rate, min_stock, is_active, category_id, brand_id, unit_id, category:categories(name, name_ar), brand:brands(name, name_ar), unit:units(short_name, name_ar)")
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return (data ?? []) as unknown as ProductRow[];
    },
  });

  const { data: meta } = useQuery({
    queryKey: ["products-meta"],
    queryFn: async () => {
      const [c, b, u] = await Promise.all([
        supabase.from("categories").select("id, name, name_ar").order("name"),
        supabase.from("brands").select("id, name, name_ar").order("name"),
        supabase.from("units").select("id, name, name_ar, short_name").order("name"),
      ]);
      return { categories: c.data ?? [], brands: b.data ?? [], units: u.data ?? [] };
    },
  });

  const filtered = useMemo(() => {
    if (!products) return [];
    const q = query.trim().toLowerCase();
    if (!q) return products;
    return products.filter((p) =>
      [p.name, p.name_ar, p.sku, p.barcode].some((x) => (x ?? "").toLowerCase().includes(q))
    );
  }, [products, query]);

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("products").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success(t("products.deleted")); qc.invalidateQueries({ queryKey: ["products"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <>
      <PageHeader
        title={t("products.title")}
        subtitle={t("products.subtitle")}
      />

      <div className="panel-elevated overflow-hidden">
        <div className="flex items-center gap-2 border-b border-border p-3">
          <div className="flex h-10 flex-1 items-center gap-2 rounded-full border border-border bg-surface px-4 text-sm">
            <Search className="h-4 w-4 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="flex-1 bg-transparent outline-none placeholder:text-muted-foreground"
              placeholder={t("products.search")}
            />
            <span className="hidden sm:inline text-[11px] text-muted-foreground tabular-nums">{filtered.length}</span>
          </div>
          <button
            onClick={() => { setEditing(null); setOpen(true); }}
            className="flex h-10 shrink-0 items-center gap-1.5 rounded-full bg-primary px-4 text-xs font-semibold text-primary-foreground shadow-sm shadow-primary/20 hover:opacity-90 transition"
          >
            <Plus className="h-3.5 w-3.5" /> <span className="hidden sm:inline">{t("common.new")}</span>
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-[11px] uppercase tracking-wider text-muted-foreground">
                <th className="px-4 py-2.5 text-start font-medium">{t("products.product")}</th>
                <th className="px-4 py-2.5 text-start font-medium">{t("products.sku")}</th>
                <th className="px-4 py-2.5 text-start font-medium">{t("products.category")}</th>
                <th className="px-4 py-2.5 text-end font-medium">{t("common.cost")}</th>
                <th className="px-4 py-2.5 text-end font-medium">{t("common.price")}</th>
                <th className="px-4 py-2.5 text-end font-medium">{t("products.min")}</th>
                <th className="px-4 py-2.5 text-end font-medium">{t("common.status")}</th>
                <th className="px-4 py-2.5 text-end font-medium">{t("common.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && Array.from({ length: 6 }).map((_, i) => (
                <tr key={i} className="border-b border-border/60">
                  <td colSpan={8} className="px-4 py-3"><div className="h-4 w-full rounded shimmer" /></td>
                </tr>
              ))}
              {!isLoading && filtered.length === 0 && (
                <tr><td colSpan={8} className="px-4 py-16 text-center">
                  <div className="mx-auto grid h-10 w-10 place-items-center rounded-md bg-surface border border-border">
                    <Package className="h-5 w-5 text-muted-foreground" />
                  </div>
                  <p className="mt-3 text-sm text-foreground">{t("products.no_products")}</p>
                  <p className="text-xs text-muted-foreground">{t("products.empty_hint")}</p>
                </td></tr>
              )}
              {filtered.map((p) => {
                const primary = lang === "ar" ? (p.name_ar || p.name) : (p.name || p.name_ar || "—");
                const secondary = lang === "ar" ? p.name : p.name_ar;
                const catLabel = lang === "ar" ? (p.category?.name_ar || p.category?.name) : (p.category?.name || p.category?.name_ar);
                return (
                <tr key={p.id} className="border-b border-border/60 hover:bg-accent/40 transition-colors">
                  <td className="px-4 py-2.5">
                    <div className="font-medium text-foreground" dir={lang === "ar" ? "rtl" : "ltr"}>{primary}</div>
                    {secondary && <div className="text-[11px] text-muted-foreground" dir={lang === "ar" ? "ltr" : "rtl"}>{secondary}</div>}
                  </td>
                  <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">{p.sku ?? "—"}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">{catLabel ?? "—"}</td>
                  <td className="px-4 py-2.5 text-end font-mono">{Number(p.cost_price).toFixed(2)}</td>
                  <td className="px-4 py-2.5 text-end font-mono text-foreground">{Number(p.sale_price).toFixed(2)}</td>
                  <td className="px-4 py-2.5 text-end font-mono text-muted-foreground">{Number(p.min_stock)}</td>
                  <td className="px-4 py-2.5 text-end">
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium ${p.is_active ? "bg-success/10 text-success" : "bg-muted text-muted-foreground"}`}>
                      {p.is_active ? t("common.active") : t("common.inactive")}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-end">
                    <div className="inline-flex items-center gap-1">
                      <button
                        onClick={() => { setEditing(p); setOpen(true); }}
                        className="grid h-8 w-8 place-items-center rounded-full border border-border bg-surface text-muted-foreground hover:bg-surface-2 hover:text-foreground transition"
                        title={t("common.edit")}
                      ><Pencil className="h-3.5 w-3.5" /></button>
                      <button
                        onClick={() => { if (confirm(`${t("common.delete")} "${primary}"?`)) remove.mutate(p.id); }}
                        className="grid h-8 w-8 place-items-center rounded-full border border-destructive/30 bg-destructive/5 text-destructive hover:bg-destructive/10 transition"
                        title={t("common.delete")}
                      ><Trash2 className="h-3.5 w-3.5" /></button>
                    </div>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {open && (
        <ProductDialog
          initial={editing}
          meta={meta ?? { categories: [], brands: [], units: [] }}
          onClose={() => setOpen(false)}
          onSaved={() => { setOpen(false); qc.invalidateQueries({ queryKey: ["products"] }); }}
        />
      )}
    </>
  );
}

function ProductDialog({
  initial, meta, onClose, onSaved,
}: {
  initial: ProductRow | null;
  meta: {
    categories: { id: string; name: string; name_ar: string | null }[];
    brands: { id: string; name: string; name_ar: string | null }[];
    units: { id: string; name: string; name_ar: string | null; short_name: string }[];
  };
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t, lang } = useI18n();
  const [form, setForm] = useState({
    name: initial?.name ?? "",
    name_ar: initial?.name_ar ?? "",
    sku: initial?.sku ?? "",
    barcode: initial?.barcode ?? "",
    category_id: initial?.category_id ?? "",
    brand_id: initial?.brand_id ?? "",
    unit_id: initial?.unit_id ?? "",
    cost_price: initial?.cost_price?.toString() ?? "0",
    sale_price: initial?.sale_price?.toString() ?? "0",
    tax_rate: initial?.tax_rate?.toString() ?? "0",
    min_stock: initial?.min_stock?.toString() ?? "0",
    is_active: initial?.is_active ?? true,
  });
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name_ar.trim() && !form.name.trim()) { toast.error(t("products.name_required")); return; }
    setSaving(true);
    const payload = {
      // DB requires name NOT NULL; fall back to Arabic if English blank
      name: (form.name.trim() || form.name_ar.trim()),
      name_ar: form.name_ar.trim() || null,
      sku: form.sku.trim() || null,
      barcode: form.barcode.trim() || null,
      category_id: form.category_id || null,
      brand_id: form.brand_id || null,
      unit_id: form.unit_id || null,
      cost_price: Number(form.cost_price) || 0,
      sale_price: Number(form.sale_price) || 0,
      tax_rate: Number(form.tax_rate) || 0,
      min_stock: Number(form.min_stock) || 0,
      is_active: form.is_active,
    };
    const { error } = initial
      ? await supabase.from("products").update(payload).eq("id", initial.id)
      : await supabase.from("products").insert(payload);
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success(initial ? t("products.updated") : t("products.created"));
    onSaved();
  }

  const labelOf = (en: string, ar: string | null) => lang === "ar" ? (ar || en) : (en || ar || "");

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="panel-elevated w-full max-w-3xl overflow-hidden"
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="text-sm font-semibold text-foreground">{initial ? t("products.edit_product") : t("products.new_product")}</h2>
          <button type="button" onClick={onClose} className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground hover:bg-accent">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="grid grid-cols-1 gap-3 p-5 sm:grid-cols-2 lg:grid-cols-3 max-h-[70vh] overflow-y-auto">
          <Field label={`${t("products.name_ar")} *`}>
            <input value={form.name_ar} onChange={(e) => setForm({ ...form, name_ar: e.target.value })} className={inputCls} dir="rtl" required />
          </Field>
          <Field label={t("products.name_en")}>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputCls} />
          </Field>
          <Field label={t("products.category")}>
            <select value={form.category_id} onChange={(e) => setForm({ ...form, category_id: e.target.value })} className={inputCls}>
              <option value="">—</option>
              {meta.categories.map((c) => <option key={c.id} value={c.id}>{labelOf(c.name, c.name_ar)}</option>)}
            </select>
          </Field>
          <Field label={t("products.sku")}><input value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} className={inputCls} /></Field>
          <Field label={t("products.barcode")}><input value={form.barcode} onChange={(e) => setForm({ ...form, barcode: e.target.value })} className={inputCls} /></Field>
          <Field label={t("products.brand")}>
            <select value={form.brand_id} onChange={(e) => setForm({ ...form, brand_id: e.target.value })} className={inputCls}>
              <option value="">—</option>
              {meta.brands.map((b) => <option key={b.id} value={b.id}>{labelOf(b.name, b.name_ar)}</option>)}
            </select>
          </Field>
          <Field label={t("products.unit")}>
            <select value={form.unit_id} onChange={(e) => setForm({ ...form, unit_id: e.target.value })} className={inputCls}>
              <option value="">—</option>
              {meta.units.map((u) => <option key={u.id} value={u.id}>{labelOf(u.name, u.name_ar)} ({u.short_name})</option>)}
            </select>
          </Field>
          <Field label={t("common.cost")}><input type="number" step="0.01" value={form.cost_price} onChange={(e) => setForm({ ...form, cost_price: e.target.value })} className={inputCls} /></Field>
          <Field label={t("common.price")}><input type="number" step="0.01" value={form.sale_price} onChange={(e) => setForm({ ...form, sale_price: e.target.value })} className={inputCls} /></Field>
          <Field label={t("products.tax_rate")}><input type="number" step="0.01" value={form.tax_rate} onChange={(e) => setForm({ ...form, tax_rate: e.target.value })} className={inputCls} /></Field>
          <Field label={t("products.min")}><input type="number" step="0.01" value={form.min_stock} onChange={(e) => setForm({ ...form, min_stock: e.target.value })} className={inputCls} /></Field>
          <Field label={t("common.status")}>
            <label className="flex h-9 items-center gap-2 rounded-md border border-border bg-surface px-3 text-sm">
              <input type="checkbox" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} />
              <span className="text-muted-foreground">{t("common.active")}</span>
            </label>
          </Field>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border bg-surface/40 px-5 py-3">
          <button type="button" onClick={onClose} className="flex h-9 items-center rounded-md border border-border bg-surface px-3 text-xs font-medium text-muted-foreground hover:text-foreground transition">
            {t("common.cancel")}
          </button>
          <button type="submit" disabled={saving} className="flex h-9 items-center rounded-md bg-primary px-4 text-xs font-medium text-primary-foreground hover:opacity-90 transition disabled:opacity-50">
            {saving ? t("common.saving") : initial ? t("common.save") : t("products.new_product")}
          </button>
        </div>
      </form>
    </div>
  );
}

const inputCls = "h-9 w-full rounded-md border border-border bg-surface px-3 text-sm text-foreground outline-none focus:border-primary/60 focus:ring-1 focus:ring-primary/30 transition";

function Field({ label, children, className = "" }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={`flex flex-col gap-1.5 ${className}`}>
      <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

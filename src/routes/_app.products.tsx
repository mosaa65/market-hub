import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/page-header";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import { useCatalogModules } from "@/lib/catalog-modules";
import { CatalogModulesDialog } from "@/components/catalog-modules-dialog";
import { Plus, Package, Search, Pencil, Trash2, X, SlidersHorizontal } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/products")({
  head: () => ({ meta: [{ title: "المنتجات — فورتيكس ERP" }] }),
  component: ProductsPage,
});

type ProductRow = {
  id: string;
  name: string;
  name_ar: string | null;
  sku: string | null;
  barcode: string | null;
  sale_price: number;
  cost_price: number;
  tax_rate: number;
  min_stock: number;
  shelf_location: string | null;
  origin_id: string | null;
  quality_grade_id: string | null;
  is_active: boolean;
  category_id: string | null;
  brand_id: string | null;
  unit_id: string | null;
  category?: { name: string; name_ar: string | null } | null;
  brand?: { name: string; name_ar: string | null } | null;
  unit?: { short_name: string; name_ar: string | null } | null;
};

function ProductsPage() {
  const { t, lang } = useI18n();
  const { config } = useCatalogModules();
  const qc = useQueryClient();
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<ProductRow | null>(null);
  const [open, setOpen] = useState(false);
  const [modulesDialogOpen, setModulesDialogOpen] = useState(false);

  const { data: products, isLoading } = useQuery({
    queryKey: ["products"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select(
          "id, name, name_ar, sku, barcode, sale_price, cost_price, tax_rate, min_stock, shelf_location, origin_id, quality_grade_id, is_active, category_id, brand_id, unit_id, category:categories(name, name_ar), brand:brands(name, name_ar), unit:units(short_name, name_ar)"
        )
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return (data ?? []) as unknown as ProductRow[];
    },
  });

  const { data: meta } = useQuery({
    queryKey: ["products-meta"],
    queryFn: async () => {
      const [c, b, u, origins, qualities, models] = await Promise.all([
        supabase.from("categories").select("id, name, name_ar").order("name"),
        supabase.from("brands").select("id, name, name_ar").order("name"),
        supabase.from("units").select("id, name, name_ar, short_name").order("name"),
        (supabase as any).from("countries_of_origin").select("id,code,name,name_ar").order("name"),
        (supabase as any).from("quality_grades").select("id,code,name,name_ar,sort_order").order("sort_order"),
        (supabase as any).from("vehicle_models").select("id,name,name_ar,vehicle_makes(name,name_ar)").order("name"),
      ]);
      return {
        categories: c.data ?? [],
        brands: b.data ?? [],
        units: u.data ?? [],
        origins: origins.data ?? [],
        qualities: qualities.data ?? [],
        models: models.data ?? [],
      };
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
    onSuccess: () => {
      toast.success(lang === "ar" ? "تم حذف المنتج بنجاح" : t("products.deleted"));
      qc.invalidateQueries({ queryKey: ["products"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const profileLabel =
    config.profile === "spare_parts"
      ? (lang === "ar" ? "قطع غيار ومركبات" : "Spare Parts")
      : config.profile === "grocery"
      ? (lang === "ar" ? "مواد غذائية وبقالة" : "Grocery")
      : config.profile === "retail"
      ? (lang === "ar" ? "تجارة عامة" : "General Retail")
      : (lang === "ar" ? "تخصيص مخصص" : "Custom");

  return (
    <>
      <PageHeader
        title={t("products.title")}
        subtitle={t("products.subtitle")}
        actions={
          <button
            type="button"
            onClick={() => setModulesDialogOpen(true)}
            className="flex h-10 items-center gap-2 rounded-full border border-border/80 bg-surface px-4 text-xs font-semibold text-muted-foreground shadow-xs transition hover:border-primary/40 hover:text-foreground active:scale-95"
          >
            <SlidersHorizontal className="h-3.5 w-3.5 text-primary" />
            <span>{lang === "ar" ? "تخصيص نمط النشاط" : "Industry Profile"}</span>
            <span className="rounded-full bg-primary/10 text-primary px-2 py-0.5 text-[10px] font-bold">
              {profileLabel}
            </span>
          </button>
        }
      />

      <div className="panel-elevated overflow-hidden rounded-3xl border border-border/80 bg-surface/90 shadow-sm">
        <div className="flex flex-wrap items-center gap-2 border-b border-border/70 p-3.5">
          <div className="flex h-10 flex-1 items-center gap-2 rounded-full border border-border bg-surface px-4 text-sm shadow-2xs">
            <Search className="h-4 w-4 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="flex-1 bg-transparent outline-none placeholder:text-muted-foreground text-sm"
              placeholder={t("products.search")}
            />
            <span className="hidden sm:inline text-[11px] text-muted-foreground tabular-nums">
              {filtered.length}
            </span>
          </div>

          <button
            onClick={() => {
              setEditing(null);
              setOpen(true);
            }}
            className="flex h-10 shrink-0 items-center gap-1.5 rounded-full bg-primary px-4 text-xs font-semibold text-primary-foreground shadow-sm shadow-primary/20 hover:opacity-90 transition active:scale-95"
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
                {config.enableBrands && (
                  <th className="px-4 py-2.5 text-start font-medium">{t("products.brand")}</th>
                )}
                <th className="px-4 py-2.5 text-start font-medium">{lang === "ar" ? "موقع الرف" : "Shelf"}</th>
                <th className="px-4 py-2.5 text-end font-medium">{t("common.cost")}</th>
                <th className="px-4 py-2.5 text-end font-medium">{t("common.price")}</th>
                <th className="px-4 py-2.5 text-end font-medium">{t("products.min")}</th>
                <th className="px-4 py-2.5 text-end font-medium">{t("common.status")}</th>
                <th className="px-4 py-2.5 text-end font-medium">{t("common.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {isLoading &&
                Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i} className="border-b border-border/60">
                    <td colSpan={config.enableBrands ? 10 : 9} className="px-4 py-3">
                      <div className="h-4 w-full rounded shimmer" />
                    </td>
                  </tr>
                ))}
              {!isLoading && filtered.length === 0 && (
                <tr>
                  <td colSpan={config.enableBrands ? 10 : 9} className="px-4 py-16 text-center">
                    <div className="mx-auto grid h-10 w-10 place-items-center rounded-2xl bg-surface border border-border">
                      <Package className="h-5 w-5 text-muted-foreground" />
                    </div>
                    <p className="mt-3 text-sm text-foreground">{t("products.no_products")}</p>
                    <p className="text-xs text-muted-foreground">{t("products.empty_hint")}</p>
                  </td>
                </tr>
              )}
              {filtered.map((p) => {
                const primary = lang === "ar" ? p.name_ar || p.name : p.name || p.name_ar || "—";
                const secondary = lang === "ar" ? p.name : p.name_ar;
                const catLabel =
                  lang === "ar" ? p.category?.name_ar || p.category?.name : p.category?.name || p.category?.name_ar;
                const brandLabel =
                  lang === "ar" ? p.brand?.name_ar || p.brand?.name : p.brand?.name || p.brand?.name_ar;

                return (
                  <tr key={p.id} className="border-b border-border/60 hover:bg-accent/40 transition-colors">
                    <td className="px-4 py-2.5">
                      <div className="font-medium text-foreground" dir={lang === "ar" ? "rtl" : "ltr"}>
                        {primary}
                      </div>
                      {secondary && (
                        <div
                          className="text-[11px] text-muted-foreground"
                          dir={lang === "ar" ? "ltr" : "rtl"}
                        >
                          {secondary}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">{p.sku ?? "—"}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">{catLabel ?? "—"}</td>
                    {config.enableBrands && (
                      <td className="px-4 py-2.5 text-muted-foreground">{brandLabel ?? "—"}</td>
                    )}
                    <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">
                      {p.shelf_location ?? "—"}
                    </td>
                    <td className="px-4 py-2.5 text-end font-mono">{Number(p.cost_price).toFixed(2)}</td>
                    <td className="px-4 py-2.5 text-end font-mono text-foreground font-semibold">
                      {Number(p.sale_price).toFixed(2)}
                    </td>
                    <td className="px-4 py-2.5 text-end font-mono text-muted-foreground">
                      {Number(p.min_stock)}
                    </td>
                    <td className="px-4 py-2.5 text-end">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium ${
                          p.is_active ? "bg-success/10 text-success" : "bg-muted text-muted-foreground"
                        }`}
                      >
                        {p.is_active ? t("common.active") : t("common.inactive")}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-end">
                      <div className="inline-flex items-center gap-1">
                        <button
                          onClick={() => {
                            setEditing(p);
                            setOpen(true);
                          }}
                          className="grid h-8 w-8 place-items-center rounded-full border border-border bg-surface text-muted-foreground hover:bg-surface-2 hover:text-foreground transition active:scale-95"
                          title={t("common.edit")}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => {
                            if (confirm(lang === "ar" ? `هل أنت متأكد من حذف "${primary}"؟` : `${t("common.delete")} "${primary}"?`)) {
                              remove.mutate(p.id);
                            }
                          }}
                          className="grid h-8 w-8 place-items-center rounded-full border border-destructive/30 bg-destructive/5 text-destructive hover:bg-destructive/10 transition active:scale-95"
                          title={t("common.delete")}
                        >
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

      {open && (
        <ProductDialog
          initial={editing}
          meta={
            meta ?? {
              categories: [],
              brands: [],
              units: [],
              origins: [],
              qualities: [],
              models: [],
            }
          }
          onClose={() => setOpen(false)}
          onSaved={() => {
            setOpen(false);
            qc.invalidateQueries({ queryKey: ["products"] });
          }}
        />
      )}

      {/* Catalog Modules Customization Dialog */}
      <CatalogModulesDialog
        open={modulesDialogOpen}
        onClose={() => setModulesDialogOpen(false)}
      />
    </>
  );
}

function ProductDialog({
  initial,
  meta,
  onClose,
  onSaved,
}: {
  initial: ProductRow | null;
  meta: {
    categories: { id: string; name: string; name_ar: string | null }[];
    brands: { id: string; name: string; name_ar: string | null }[];
    units: { id: string; name: string; name_ar: string | null; short_name: string }[];
    origins: { id: string; code: string; name: string; name_ar: string }[];
    qualities: { id: string; name: string; name_ar: string }[];
    models: any[];
  };
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t, lang } = useI18n();
  const { config } = useCatalogModules();
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
    shelf_location: initial?.shelf_location ?? "",
    origin_id: initial?.origin_id ?? "",
    quality_grade_id: initial?.quality_grade_id ?? "",
    is_active: initial?.is_active ?? true,
  });
  const [saving, setSaving] = useState(false);
  const [compatibleModels, setCompatibleModels] = useState<string[]>([]);

  useEffect(() => {
    if (initial?.id && config.enableMakesAndModels) {
      (supabase as any)
        .from("product_compatibilities")
        .select("vehicle_model_id")
        .eq("product_id", initial.id)
        .then(({ data }: any) =>
          setCompatibleModels((data ?? []).map((r: any) => r.vehicle_model_id))
        );
    }
  }, [initial?.id, config.enableMakesAndModels]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name_ar.trim() && !form.name.trim()) {
      toast.error(lang === "ar" ? "اسم المنتج مطلوب" : t("products.name_required"));
      return;
    }
    setSaving(true);
    const payload = {
      name: form.name.trim() || form.name_ar.trim(),
      name_ar: form.name_ar.trim() || null,
      sku: form.sku.trim() || null,
      barcode: form.barcode.trim() || null,
      category_id: form.category_id || null,
      brand_id: config.enableBrands ? form.brand_id || null : null,
      unit_id: config.enableUnits ? form.unit_id || null : null,
      cost_price: Number(form.cost_price) || 0,
      sale_price: Number(form.sale_price) || 0,
      tax_rate: Number(form.tax_rate) || 0,
      min_stock: Number(form.min_stock) || 0,
      shelf_location: form.shelf_location.trim() || null,
      origin_id: config.enableOrigins ? form.origin_id || null : null,
      quality_grade_id: config.enableQualityGrades ? form.quality_grade_id || null : null,
      is_active: form.is_active,
    };
    const request: any = initial
      ? (supabase.from("products") as any).update(payload).eq("id", initial.id).select("id").single()
      : (supabase.from("products") as any).insert(payload).select("id").single();
    const { data, error } = await request;
    if (!error) {
      if (config.enableMakesAndModels) {
        await (supabase as any).from("product_compatibilities").delete().eq("product_id", data.id);
        if (compatibleModels.length) {
          await (supabase as any).from("product_compatibilities").insert(
            compatibleModels.map((vehicle_model_id) => ({ product_id: data.id, vehicle_model_id }))
          );
        }
      }
    }
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(
      lang === "ar"
        ? initial
          ? "تم تحديث المنتج بنجاح"
          : "تم إنشاء المنتج بنجاح"
        : initial
        ? t("products.updated")
        : t("products.created")
    );
    onSaved();
  }

  const labelOf = (en: string, ar: string | null) => (lang === "ar" ? ar || en : en || ar || "");

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-background/80 backdrop-blur-sm p-4 animate-in fade-in duration-150"
      onClick={onClose}
    >
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="panel-elevated w-full max-w-3xl rounded-3xl overflow-hidden border border-border/80 shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-border/70 px-6 py-3.5">
          <h2 className="text-sm font-bold text-foreground">
            {initial ? t("products.edit_product") : t("products.new_product")}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="grid h-7 w-7 place-items-center rounded-full text-muted-foreground hover:bg-surface-2 hover:text-foreground transition"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="grid grid-cols-1 gap-3.5 p-6 sm:grid-cols-2 lg:grid-cols-3 max-h-[70vh] overflow-y-auto custom-scrollbar">
          <Field label={`${t("products.name_ar")} *`}>
            <input
              value={form.name_ar}
              onChange={(e) => setForm({ ...form, name_ar: e.target.value })}
              className={inputCls}
              dir="rtl"
              required
            />
          </Field>
          <Field label={t("products.name_en")}>
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className={inputCls}
            />
          </Field>
          <Field label={t("products.category")}>
            <select
              value={form.category_id}
              onChange={(e) => setForm({ ...form, category_id: e.target.value })}
              className={inputCls}
            >
              <option value="">—</option>
              {meta.categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {labelOf(c.name, c.name_ar)}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t("products.sku")}>
            <input
              value={form.sku}
              onChange={(e) => setForm({ ...form, sku: e.target.value })}
              className={inputCls}
            />
          </Field>
          <Field label={t("products.barcode")}>
            <input
              value={form.barcode}
              onChange={(e) => setForm({ ...form, barcode: e.target.value })}
              className={inputCls}
            />
          </Field>
          <Field label={lang === "ar" ? "موقع الرف / المستودع" : "Shelf location"}>
            <input
              value={form.shelf_location}
              onChange={(e) => setForm({ ...form, shelf_location: e.target.value })}
              placeholder={lang === "ar" ? "مثال: رف A - 03" : "e.g. Shelf A - 03"}
              className={inputCls}
            />
          </Field>

          {/* Conditional Brand Field */}
          {config.enableBrands && (
            <Field label={t("products.brand")}>
              <select
                value={form.brand_id}
                onChange={(e) => setForm({ ...form, brand_id: e.target.value })}
                className={inputCls}
              >
                <option value="">—</option>
                {meta.brands.map((b) => (
                  <option key={b.id} value={b.id}>
                    {labelOf(b.name, b.name_ar)}
                  </option>
                ))}
              </select>
            </Field>
          )}

          {/* Conditional Origin Field */}
          {config.enableOrigins && (
            <Field label={lang === "ar" ? "بلد المنشأ" : "Country of origin"}>
              <select
                value={form.origin_id}
                onChange={(e) => setForm({ ...form, origin_id: e.target.value })}
                className={inputCls}
              >
                <option value="">—</option>
                {meta.origins.map((o) => (
                  <option key={o.id} value={o.id}>
                    {lang === "ar" ? o.name_ar : o.name} ({o.code})
                  </option>
                ))}
              </select>
            </Field>
          )}

          {/* Conditional Quality Grade Field */}
          {config.enableQualityGrades && (
            <Field label={lang === "ar" ? "درجة الجودة" : "Quality grade"}>
              <select
                value={form.quality_grade_id}
                onChange={(e) => setForm({ ...form, quality_grade_id: e.target.value })}
                className={inputCls}
              >
                <option value="">—</option>
                {meta.qualities.map((q) => (
                  <option key={q.id} value={q.id}>
                    {lang === "ar" ? q.name_ar : q.name}
                  </option>
                ))}
              </select>
            </Field>
          )}

          {/* Conditional Vehicle Fitment / Models */}
          {config.enableMakesAndModels && (
            <Field
              label={lang === "ar" ? "توافق المركبات والدراجات (متعدد)" : "Vehicle compatibility (multiple)"}
              className="sm:col-span-2 lg:col-span-3"
            >
              <div className="grid max-h-32 grid-cols-2 gap-1.5 overflow-y-auto rounded-2xl border border-border/80 bg-surface p-2.5 sm:grid-cols-3 custom-scrollbar">
                {meta.models.map((m: any) => (
                  <label
                    key={m.id}
                    className="flex items-center gap-2 rounded-xl px-2 py-1 text-xs hover:bg-surface-2 cursor-pointer transition"
                  >
                    <input
                      type="checkbox"
                      checked={compatibleModels.includes(m.id)}
                      onChange={(e) =>
                        setCompatibleModels((x) =>
                          e.target.checked ? [...x, m.id] : x.filter((id) => id !== m.id)
                        )
                      }
                      className="rounded border-border"
                    />
                    <span className="truncate">
                      {lang === "ar"
                        ? m.vehicle_makes?.name_ar || m.vehicle_makes?.name
                        : m.vehicle_makes?.name}{" "}
                      — {lang === "ar" ? m.name_ar || m.name : m.name}
                    </span>
                  </label>
                ))}
              </div>
            </Field>
          )}

          {/* Conditional Unit Field */}
          {config.enableUnits && (
            <Field label={t("products.unit")}>
              <select
                value={form.unit_id}
                onChange={(e) => setForm({ ...form, unit_id: e.target.value })}
                className={inputCls}
              >
                <option value="">—</option>
                {meta.units.map((u) => (
                  <option key={u.id} value={u.id}>
                    {labelOf(u.name, u.name_ar)} ({u.short_name})
                  </option>
                ))}
              </select>
            </Field>
          )}

          <Field label={t("common.cost")}>
            <input
              type="number"
              step="0.01"
              value={form.cost_price}
              onChange={(e) => setForm({ ...form, cost_price: e.target.value })}
              className={inputCls}
            />
          </Field>
          <Field label={t("common.price")}>
            <input
              type="number"
              step="0.01"
              value={form.sale_price}
              onChange={(e) => setForm({ ...form, sale_price: e.target.value })}
              className={inputCls}
            />
          </Field>
          <Field label={t("products.tax_rate")}>
            <input
              type="number"
              step="0.01"
              value={form.tax_rate}
              onChange={(e) => setForm({ ...form, tax_rate: e.target.value })}
              className={inputCls}
            />
          </Field>
          <Field label={t("products.min")}>
            <input
              type="number"
              step="0.01"
              value={form.min_stock}
              onChange={(e) => setForm({ ...form, min_stock: e.target.value })}
              className={inputCls}
            />
          </Field>
          <Field label={t("common.status")}>
            <label className="flex h-10 items-center gap-2 rounded-2xl border border-border bg-surface px-3.5 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={form.is_active}
                onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
                className="rounded border-border"
              />
              <span className="text-muted-foreground text-xs font-medium">{t("common.active")}</span>
            </label>
          </Field>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border/70 bg-surface/40 px-6 py-3.5">
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 items-center rounded-full border border-border bg-surface px-4 text-xs font-medium text-muted-foreground hover:text-foreground transition"
          >
            {t("common.cancel")}
          </button>
          <button
            type="submit"
            disabled={saving}
            className="flex h-9 items-center rounded-full bg-primary px-5 text-xs font-semibold text-primary-foreground hover:opacity-90 transition disabled:opacity-50 active:scale-95"
          >
            {saving ? t("common.saving") : initial ? t("common.save") : t("products.new_product")}
          </button>
        </div>
      </form>
    </div>
  );
}

const inputCls =
  "h-10 w-full rounded-2xl border border-border bg-surface px-3.5 text-sm text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition";

function Field({
  label,
  children,
  className = "",
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={`flex flex-col gap-1.5 ${className}`}>
      <span className="text-[11px] font-semibold tracking-wider text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

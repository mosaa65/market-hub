import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/page-header";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import { useCatalogModules } from "@/lib/catalog-modules";
import { CatalogModulesDialog } from "@/components/catalog-modules-dialog";
import {
  Layers,
  Pencil,
  Plus,
  Search,
  Trash2,
  X,
  SlidersHorizontal,
  Car,
  ChevronDown,
} from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/catalog")({
  head: () => ({ meta: [{ title: "الفهرس — فورتيكس ERP" }] }),
  component: CatalogPage,
});

type Tab = "categories" | "brands" | "units" | "origins" | "qualities" | "makes" | "models";

type Item = {
  id: string;
  name: string;
  name_ar: string | null;
  short_name?: string | null;
  code?: string | null;
  sort_order?: number | null;
  make_id?: string | null;
  vehicle_makes?: { id: string; name: string; name_ar: string | null } | null;
};

function CatalogPage() {
  const { t, lang } = useI18n();
  const { isTabEnabled, config } = useCatalogModules();
  const [modulesDialogOpen, setModulesDialogOpen] = useState(false);

  const allTabs: { key: Tab; label: string }[] = [
    { key: "categories", label: t("catalog.categories") },
    { key: "brands", label: t("catalog.brands") },
    { key: "units", label: t("catalog.units") },
    { key: "origins", label: lang === "ar" ? "بلدان المنشأ" : "Origins" },
    { key: "qualities", label: lang === "ar" ? "درجات الجودة" : "Quality Grades" },
    { key: "makes", label: lang === "ar" ? "ماركات المركبات" : "Vehicle Makes" },
    { key: "models", label: lang === "ar" ? "موديلات المركبات" : "Vehicle Models" },
  ];

  // Only show tabs that are enabled by the current business profile
  const availableTabs = useMemo(() => {
    return allTabs.filter((tab) => isTabEnabled(tab.key));
  }, [allTabs, isTabEnabled]);

  const [tab, setTab] = useState<Tab>("categories");

  // If current tab is disabled, switch to first available tab
  useEffect(() => {
    if (!isTabEnabled(tab) && availableTabs.length > 0) {
      setTab(availableTabs[0].key);
    }
  }, [tab, isTabEnabled, availableTabs]);

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
        title={t("catalog.title")}
        subtitle={
          lang === "ar"
            ? "إدارة التصنيفات، العلامات التجارية، والوحدات مع إمكانية تخصيص الأبعاد وفق نشاطك"
            : "Manage categories, brands, units, and configure catalog dimensions for your industry"
        }
        actions={
          <button
            type="button"
            onClick={() => setModulesDialogOpen(true)}
            className="flex h-10 items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-4 text-xs font-semibold text-primary shadow-xs transition hover:bg-primary/20 active:scale-95"
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
            <span>{lang === "ar" ? "تخصيص نشاط الفهرسة" : "Customize Catalog"}</span>
            <span className="rounded-full bg-primary/20 px-2 py-0.5 text-[10px] font-bold">
              {profileLabel}
            </span>
          </button>
        }
      />

      {/* Tabs list with responsive wrapping */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex flex-wrap items-center gap-1 rounded-2xl border border-border/80 bg-surface/90 p-1 shadow-xs">
          {availableTabs.map((tt) => (
            <button
              key={tt.key}
              onClick={() => setTab(tt.key)}
              className={`h-8 rounded-xl px-3.5 text-xs font-semibold transition-all duration-150 ${
                tab === tt.key
                  ? "bg-primary text-primary-foreground shadow-xs shadow-primary/20"
                  : "text-muted-foreground hover:bg-surface-2 hover:text-foreground"
              }`}
            >
              {tt.label}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={() => setModulesDialogOpen(true)}
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary transition"
        >
          <SlidersHorizontal className="h-3 w-3" />
          <span>{lang === "ar" ? "تفعيل أو إلغاء أقسام الفهرس" : "Toggle Catalog Sections"}</span>
        </button>
      </div>

      <CatalogTable tab={tab} />

      {/* Catalog Modules Customization Dialog */}
      <CatalogModulesDialog
        open={modulesDialogOpen}
        onClose={() => setModulesDialogOpen(false)}
      />
    </>
  );
}

function CatalogTable({ tab }: { tab: Tab }) {
  const { t, lang } = useI18n();
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<Item | null>(null);
  const [open, setOpen] = useState(false);
  const [filterMakeId, setFilterMakeId] = useState<string>("");

  const table =
    tab === "categories"
      ? "categories"
      : tab === "brands"
      ? "brands"
      : tab === "units"
      ? "units"
      : tab === "origins"
      ? "countries_of_origin"
      : tab === "qualities"
      ? "quality_grades"
      : tab === "makes"
      ? "vehicle_makes"
      : "vehicle_models";

  const cols =
    tab === "units"
      ? "id, name, name_ar, short_name"
      : tab === "origins"
      ? "id, name, name_ar, code"
      : tab === "qualities"
      ? "id, name, name_ar, code, sort_order"
      : tab === "models"
      ? "id, name, name_ar, make_id, vehicle_makes(id, name, name_ar)"
      : "id, name, name_ar";

  const { data, isLoading } = useQuery({
    queryKey: ["catalog", tab],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from(table)
        .select(cols)
        .order(tab === "qualities" ? "sort_order" : "name");
      if (error) throw error;
      return (data ?? []) as unknown as Item[];
    },
  });

  // Query makes for model filtering
  const { data: makesList = [] } = useQuery({
    queryKey: ["vehicle-makes-filter"],
    enabled: tab === "models",
    queryFn: async () => {
      const { data } = await (supabase as any).from("vehicle_makes").select("id, name, name_ar").order("name");
      return (data ?? []) as { id: string; name: string; name_ar: string | null }[];
    },
  });

  const filtered = useMemo(() => {
    let list = data ?? [];
    if (tab === "models" && filterMakeId) {
      list = list.filter((r) => r.make_id === filterMakeId);
    }
    const s = q.trim().toLowerCase();
    if (!s) return list;
    return list.filter((r) =>
      [
        r.name,
        r.name_ar,
        r.short_name,
        r.code,
        r.vehicle_makes?.name,
        r.vehicle_makes?.name_ar,
      ].some((x) => (x ?? "").toLowerCase().includes(s))
    );
  }, [data, q, tab, filterMakeId]);

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).from(table).delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(lang === "ar" ? "تم الحذف بنجاح" : t("common.deleted") || "Deleted");
      qc.invalidateQueries({ queryKey: ["catalog", tab] });
      qc.invalidateQueries({ queryKey: ["products-meta"] });
      qc.invalidateQueries({ queryKey: ["pos-live-meta"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const newLabel =
    tab === "categories"
      ? t("catalog.new_category")
      : tab === "brands"
      ? t("catalog.new_brand")
      : tab === "units"
      ? t("catalog.new_unit")
      : tab === "origins"
      ? (lang === "ar" ? "إضافة دولة منشأ" : "Add Origin")
      : tab === "qualities"
      ? (lang === "ar" ? "إضافة درجة جودة" : "Add Quality Grade")
      : tab === "makes"
      ? (lang === "ar" ? "إضافة ماركة مركبة" : "Add Vehicle Make")
      : (lang === "ar" ? "إضافة موديل مركبة" : "Add Vehicle Model");

  return (
    <div className="panel-elevated overflow-hidden rounded-3xl border border-border/80 bg-surface/90 shadow-sm">
      <div className="flex flex-wrap items-center gap-2 border-b border-border/70 p-3.5">
        <div className="flex h-10 flex-1 items-center gap-2 rounded-full border border-border bg-surface px-4 text-sm shadow-2xs">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="flex-1 bg-transparent outline-none placeholder:text-muted-foreground text-sm"
            placeholder={lang === "ar" ? "بحث في القائمة..." : t("common.search")}
          />
          <span className="hidden sm:inline text-[11px] text-muted-foreground tabular-nums">
            {filtered.length}
          </span>
        </div>

        {tab === "models" && makesList.length > 0 && (
          <div className="relative shrink-0">
            <select
              value={filterMakeId}
              onChange={(e) => setFilterMakeId(e.target.value)}
              className="h-10 appearance-none rounded-full border border-border bg-surface pl-8 pr-8 text-xs font-medium text-foreground outline-none hover:border-primary/40 focus:border-primary rtl:pl-8 rtl:pr-8"
            >
              <option value="">{lang === "ar" ? "كل الماركات" : "All Makes"}</option>
              {makesList.map((m) => (
                <option key={m.id} value={m.id}>
                  {lang === "ar" ? m.name_ar || m.name : m.name}
                </option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          </div>
        )}

        <button
          onClick={() => {
            setEditing(null);
            setOpen(true);
          }}
          className="flex h-10 shrink-0 items-center gap-1.5 rounded-full bg-primary px-4 text-xs font-semibold text-primary-foreground shadow-sm shadow-primary/20 hover:opacity-90 transition active:scale-95"
        >
          <Plus className="h-3.5 w-3.5" /> <span className="hidden sm:inline">{newLabel}</span>
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-[11px] uppercase tracking-wider text-muted-foreground">
              <th className="px-4 py-2.5 text-start font-medium">{t("catalog.name_ar")}</th>
              <th className="px-4 py-2.5 text-start font-medium">{t("catalog.name_en")}</th>
              {tab === "models" && (
                <th className="px-4 py-2.5 text-start font-medium">{lang === "ar" ? "الماركة التابعة" : "Make"}</th>
              )}
              {tab === "units" && (
                <th className="px-4 py-2.5 text-start font-medium">{t("catalog.short_name")}</th>
              )}
              {(tab === "origins" || tab === "qualities") && (
                <th className="px-4 py-2.5 text-start font-medium">{lang === "ar" ? "الكود" : "Code"}</th>
              )}
              {tab === "qualities" && (
                <th className="px-4 py-2.5 text-start font-medium">{lang === "ar" ? "الترتيب" : "Sort Order"}</th>
              )}
              <th className="px-4 py-2.5 text-end font-medium">{t("common.actions")}</th>
            </tr>
          </thead>
          <tbody>
            {isLoading &&
              Array.from({ length: 4 }).map((_, i) => (
                <tr key={i} className="border-b border-border/60">
                  <td colSpan={tab === "models" || tab === "qualities" ? 5 : 4} className="px-4 py-3">
                    <div className="h-4 w-full rounded shimmer" />
                  </td>
                </tr>
              ))}
            {!isLoading && filtered.length === 0 && (
              <tr>
                <td colSpan={tab === "models" || tab === "qualities" ? 5 : 4} className="px-4 py-16 text-center">
                  <div className="mx-auto grid h-10 w-10 place-items-center rounded-2xl bg-surface border border-border">
                    <Layers className="h-5 w-5 text-muted-foreground" />
                  </div>
                  <p className="mt-3 text-sm text-foreground">{t("catalog.empty")}</p>
                </td>
              </tr>
            )}
            {filtered.map((r) => (
              <tr key={r.id} className="border-b border-border/60 hover:bg-accent/40 transition-colors">
                <td className="px-4 py-2.5 font-medium text-foreground" dir="rtl">
                  {r.name_ar || "—"}
                </td>
                <td className="px-4 py-2.5 text-muted-foreground">{r.name || "—"}</td>

                {tab === "models" && (
                  <td className="px-4 py-2.5 text-xs">
                    <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-0.5 font-medium text-primary border border-primary/20">
                      <Car className="h-3 w-3" />
                      {lang === "ar"
                        ? r.vehicle_makes?.name_ar || r.vehicle_makes?.name || "—"
                        : r.vehicle_makes?.name || r.vehicle_makes?.name_ar || "—"}
                    </span>
                  </td>
                )}

                {tab === "units" && (
                  <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">
                    {r.short_name ?? "—"}
                  </td>
                )}

                {(tab === "origins" || tab === "qualities") && (
                  <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">
                    <span className="rounded bg-surface-2 px-1.5 py-0.5 font-bold">
                      {r.code ?? "—"}
                    </span>
                  </td>
                )}

                {tab === "qualities" && (
                  <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">
                    {r.sort_order ?? 0}
                  </td>
                )}

                <td className="px-4 py-2.5 text-end">
                  <div className="inline-flex items-center gap-1">
                    <button
                      onClick={() => {
                        setEditing(r);
                        setOpen(true);
                      }}
                      className="grid h-8 w-8 place-items-center rounded-full border border-border bg-surface text-muted-foreground hover:bg-surface-2 hover:text-foreground transition active:scale-95"
                      title={t("common.edit")}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => {
                        if (confirm(lang === "ar" ? "هل أنت متأكد من الحذف؟" : t("catalog.confirm_delete"))) {
                          remove.mutate(r.id);
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
            ))}
          </tbody>
        </table>
      </div>

      {open && (
        <CatalogDialog
          tab={tab}
          initial={editing}
          onClose={() => setOpen(false)}
          onSaved={() => {
            setOpen(false);
            qc.invalidateQueries({ queryKey: ["catalog", tab] });
            qc.invalidateQueries({ queryKey: ["products-meta"] });
            qc.invalidateQueries({ queryKey: ["pos-live-meta"] });
          }}
        />
      )}
    </div>
  );
}

const inputCls =
  "h-10 w-full rounded-2xl border border-border bg-surface px-3.5 text-sm text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition";

function CatalogDialog({
  tab,
  initial,
  onClose,
  onSaved,
}: {
  tab: Tab;
  initial: Item | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t, lang } = useI18n();
  const [form, setForm] = useState({
    name: initial?.name ?? "",
    name_ar: initial?.name_ar ?? "",
    short_name: initial?.short_name ?? "",
    code: initial?.code ?? "",
    sort_order: initial?.sort_order?.toString() ?? "0",
    make_id: initial?.make_id ?? "",
  });

  const { data: makes = [] } = useQuery({
    queryKey: ["vehicle-makes-dialog"],
    enabled: tab === "models",
    queryFn: async () =>
      ((await (supabase as any).from("vehicle_makes").select("id,name,name_ar").order("name")).data ?? []),
  });
  const [saving, setSaving] = useState(false);

  const editLabel =
    tab === "categories"
      ? initial
        ? t("catalog.edit_category")
        : t("catalog.new_category")
      : tab === "brands"
      ? initial
        ? t("catalog.edit_brand")
        : t("catalog.new_brand")
      : tab === "units"
      ? initial
        ? t("catalog.edit_unit")
        : t("catalog.new_unit")
      : tab === "origins"
      ? initial
        ? (lang === "ar" ? "تعديل بلد المنشأ" : "Edit Origin")
        : (lang === "ar" ? "إضافة بلد منشأ" : "New Origin")
      : tab === "qualities"
      ? initial
        ? (lang === "ar" ? "تعديل درجة الجودة" : "Edit Quality Grade")
        : (lang === "ar" ? "إضافة درجة جودة" : "New Quality Grade")
      : tab === "makes"
      ? initial
        ? (lang === "ar" ? "تعديل ماركة المركبة" : "Edit Vehicle Make")
        : (lang === "ar" ? "إضافة ماركة مركبة" : "New Vehicle Make")
      : initial
      ? (lang === "ar" ? "تعديل موديل المركبة" : "Edit Vehicle Model")
      : (lang === "ar" ? "إضافة موديل مركبة" : "New Vehicle Model");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name_ar.trim() && !form.name.trim()) {
      toast.error(lang === "ar" ? "الاسم مطلوب" : t("catalog.name_required"));
      return;
    }
    setSaving(true);
    const table =
      tab === "categories"
        ? "categories"
        : tab === "brands"
        ? "brands"
        : tab === "units"
        ? "units"
        : tab === "origins"
        ? "countries_of_origin"
        : tab === "qualities"
        ? "quality_grades"
        : tab === "makes"
        ? "vehicle_makes"
        : "vehicle_models";

    const base = {
      name: form.name.trim() || form.name_ar.trim(),
      name_ar: form.name_ar.trim() || null,
    };
    const baseCode =
      form.code.trim().toUpperCase() ||
      form.name
        .trim()
        .replace(/[^A-Za-z0-9]/g, "")
        .slice(0, tab === "origins" ? 2 : 20)
        .toUpperCase();

    const payload =
      tab === "units"
        ? { ...base, short_name: form.short_name.trim() || form.name.trim().slice(0, 4) || "unit" }
        : tab === "origins"
        ? { ...base, code: baseCode }
        : tab === "qualities"
        ? { ...base, code: baseCode, sort_order: Number(form.sort_order) || 0 }
        : tab === "models"
        ? { ...base, make_id: form.make_id }
        : base;

    const q: any = supabase.from(table as "categories");
    const { error } = initial ? await q.update(payload).eq("id", initial.id) : await q.insert(payload);
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(lang === "ar" ? "تم الحفظ بنجاح" : t("common.saved") || "Saved");
    onSaved();
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-background/80 backdrop-blur-sm p-4 animate-in fade-in duration-150"
      onClick={onClose}
    >
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="panel-elevated w-full max-w-md rounded-3xl overflow-hidden border border-border/80 shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-border/70 px-5 py-3.5">
          <h2 className="text-sm font-bold text-foreground">{editLabel}</h2>
          <button
            type="button"
            onClick={onClose}
            className="grid h-7 w-7 place-items-center rounded-full text-muted-foreground hover:bg-surface-2 hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="grid gap-3.5 p-5">
          <Field label={`${t("catalog.name_ar")} *`}>
            <input
              value={form.name_ar}
              onChange={(e) => setForm({ ...form, name_ar: e.target.value })}
              className={inputCls}
              dir="rtl"
              required
            />
          </Field>
          <Field label={t("catalog.name_en")}>
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className={inputCls}
            />
          </Field>
          {tab === "units" && (
            <Field label={t("catalog.short_name")}>
              <input
                value={form.short_name}
                onChange={(e) => setForm({ ...form, short_name: e.target.value })}
                className={inputCls}
                placeholder="مثال: حبة، كرتون، PCS"
              />
            </Field>
          )}
          {(tab === "origins" || tab === "qualities") && (
            <Field label={lang === "ar" ? "الكود التعريفي" : "Code"}>
              <input
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value })}
                className={inputCls}
                placeholder={tab === "origins" ? "JP, CN, TW" : "GENUINE, OEM, PREM"}
              />
            </Field>
          )}
          {tab === "qualities" && (
            <Field label={lang === "ar" ? "ترتيب الأهمية (الأصلي = 1)" : "Sort Order"}>
              <input
                type="number"
                min="0"
                value={form.sort_order}
                onChange={(e) => setForm({ ...form, sort_order: e.target.value })}
                className={inputCls}
              />
            </Field>
          )}
          {tab === "models" && (
            <Field label={lang === "ar" ? "الماركة التابعة لها *" : "Vehicle Make *"}>
              <select
                required
                value={form.make_id}
                onChange={(e) => setForm({ ...form, make_id: e.target.value })}
                className={inputCls}
              >
                <option value="">{lang === "ar" ? "اختر الماركة" : "Select Make"}</option>
                {makes.map((m: any) => (
                  <option key={m.id} value={m.id}>
                    {lang === "ar" ? m.name_ar || m.name : m.name}
                  </option>
                ))}
              </select>
            </Field>
          )}
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-border/70 bg-surface/40 px-5 py-3.5">
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
            {saving ? t("common.saving") : t("common.save")}
          </button>
        </div>
      </form>
    </div>
  );
}

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

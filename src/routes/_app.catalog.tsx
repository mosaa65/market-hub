import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/page-header";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import { useCatalogModules } from "@/lib/catalog-modules";
import { CatalogModulesDialog } from "@/components/catalog-modules-dialog";
import { VortexMetricCard, VortexDrawerDialog } from "@/components/vortex-ui";
import {
  Layers,
  FolderTree,
  Tag,
  Scale,
  Globe,
  Award,
  Car,
  Plus,
  Pencil,
  Trash2,
  Copy,
  Download,
  SlidersHorizontal,
  ChevronDown,
  Boxes,
  Check,
  CheckCircle2,
} from "lucide-react";
import { toast } from "sonner";
import { QuantityInput } from "@/components/ui/quantity-input";
import { RecordsToolbar } from "@/components/ui/records-toolbar";
import { RecordsView } from "@/components/ui/records-view";
import { PrimaryAction } from "@/components/ui/primary-action";
import { type DataTableColumn, type DataTableSort } from "@/components/ui/data-table";
import { usePersistedViewMode } from "@/hooks/use-persisted-view-mode";
import { useBreakpoint } from "@/design/breakpoints";

export const Route = createFileRoute("/_app/catalog")({
  head: () => ({ meta: [{ title: "الفهرس والتصنيفات — فورتيكس ERP" }] }),
  component: CatalogPage,
});

/** كل أبعاد الفهرس قابلة للعرض من خلال إعداد النشاط. */
type Tab = "categories" | "units" | "brands" | "origins" | "qualities" | "makes" | "models";

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

const TAB_ICONS: Record<Tab, any> = {
  categories: FolderTree,
  units: Scale,
  brands: Tag,
  origins: Globe,
  qualities: Award,
  makes: Car,
  models: Boxes,
};

function CatalogPage() {
  const { t, lang } = useI18n();
  const { isTabEnabled } = useCatalogModules();
  const [modulesDialogOpen, setModulesDialogOpen] = useState(false);

  const allTabs = useMemo<{ key: Tab; label: string; icon: any }[]>(
    () => [
      { key: "categories", label: t("catalog.categories") || "التصنيفات", icon: FolderTree },
      { key: "brands", label: lang === "ar" ? "العلامات التجارية" : "Brands", icon: Tag },
      { key: "units", label: t("catalog.units") || "وحدات القياس", icon: Scale },
      { key: "origins", label: lang === "ar" ? "بلدان المنشأ" : "Origins", icon: Globe },
      { key: "qualities", label: lang === "ar" ? "درجات الجودة" : "Quality grades", icon: Award },
      { key: "makes", label: lang === "ar" ? "ماركات المركبات" : "Vehicle makes", icon: Car },
      { key: "models", label: lang === "ar" ? "موديلات المركبات" : "Vehicle models", icon: Boxes },
    ],
    [lang, t],
  );

  // Show dimensions enabled independently in the catalogue settings.
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

  // Overview counts for top metrics
  const { data: stats } = useQuery({
    queryKey: ["catalog-metrics-overview"],
    queryFn: async () => {
      const [cats, brands, units] = await Promise.all([
        supabase.from("categories").select("id", { count: "exact", head: true }),
        supabase.from("brands").select("id", { count: "exact", head: true }),
        supabase.from("units").select("id", { count: "exact", head: true }),
      ]);
      return {
        categories: cats.count ?? 0,
        brands: brands.count ?? 0,
        units: units.count ?? 0,
      };
    },
  });

  return (
    <div className="space-y-4 pb-12">
      <PageHeader
        title={lang === "ar" ? "فهرس المنتجات والأبعاد" : t("catalog.title")}
        subtitle={
          lang === "ar"
            ? "إدارة التصنيفات وأبعاد المنتجات بحسب نشاط منشأتك"
            : "Manage product categories and dimensions for your business"
        }
        actions={
          <button
            type="button"
            onClick={() => setModulesDialogOpen(true)}
            className="flex h-10 items-center gap-2 rounded-2xl border border-primary/30 bg-primary/10 px-4 text-xs font-semibold text-primary shadow-xs transition hover:bg-primary/20 active:scale-95"
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
            <span>{lang === "ar" ? "تخصيص نشاط الفهرسة" : "Customize Catalog"}</span>
          </button>
        }
      />

      {/* Same KPI surface used by the products screen. */}
      <div className="grid grid-cols-2 gap-2.5 sm:gap-4 lg:grid-cols-4">
        <VortexMetricCard
          title={lang === "ar" ? "إجمالي التصنيفات" : "Total categories"}
          value={stats?.categories ?? 0}
          type="count"
          currency={false}
          icon={<FolderTree className="size-5" />}
          iconClassName="bg-primary/10 text-primary border border-primary/20"
          badge={lang === "ar" ? "الفهرس" : "Catalog"}
          subtitle={lang === "ar" ? "تصنيف شجري للمنتجات" : "Product categories"}
          onClick={() => setTab("categories")}
          highlight={tab === "categories"}
          className="cursor-pointer"
        />
        <VortexMetricCard
          title={lang === "ar" ? "العلامات التجارية" : "Brands"}
          value={stats?.brands ?? 0}
          type="count"
          currency={false}
          icon={<Tag className="size-5" />}
          iconClassName="bg-blue-500/10 text-blue-500 border border-blue-500/20"
          badge={lang === "ar" ? "علامة" : "Brand"}
          subtitle={lang === "ar" ? "العلامات المسجلة للمنتجات" : "Registered product brands"}
          onClick={() => setTab("brands")}
          highlight={tab === "brands"}
          className="cursor-pointer"
        />
        <VortexMetricCard
          title={lang === "ar" ? "وحدات القياس" : "Measurement units"}
          value={stats?.units ?? 0}
          type="count"
          currency={false}
          icon={<Scale className="size-5" />}
          iconClassName="bg-emerald-500/10 text-emerald-500 border border-emerald-500/20"
          badge={lang === "ar" ? "وحدة" : "Unit"}
          subtitle={lang === "ar" ? "كجم، طن، شوال، كيس، قطعة" : "kg, tonne, sack, bag, piece"}
          onClick={() => setTab("units")}
          highlight={tab === "units"}
          className="cursor-pointer"
        />
        <VortexMetricCard
          title={lang === "ar" ? "الأقسام المفعّلة" : "Enabled sections"}
          value={availableTabs.length}
          type="count"
          currency={false}
          icon={<Layers className="size-5" />}
          iconClassName="bg-amber-500/10 text-amber-500 border border-amber-500/20"
          badge={lang === "ar" ? "نشط" : "Active"}
          subtitle={lang === "ar" ? "أبعاد الفهرسة الظاهرة" : "Visible catalogue dimensions"}
        />
      </div>

      {/* Tab bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/70 pb-3">
        <div className="flex flex-wrap items-center gap-1.5 rounded-2xl border border-border/70 bg-card/60 p-1.5 shadow-xs backdrop-blur-md">
          {availableTabs.map((tt) => {
            const Icon = tt.icon;
            const isActive = tab === tt.key;
            return (
              <button
                key={tt.key}
                type="button"
                onClick={() => setTab(tt.key)}
                className={`flex h-9 items-center gap-2 rounded-xl px-3.5 text-xs font-semibold transition-all duration-200 active:scale-95 ${
                  isActive
                    ? "bg-primary text-primary-foreground shadow-sm shadow-primary/25"
                    : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                <span>{tt.label}</span>
              </button>
            );
          })}
        </div>

        <button
          type="button"
          onClick={() => setModulesDialogOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-xl border border-border/60 bg-muted/30 px-3 py-1.5 text-xs text-muted-foreground transition hover:border-primary/40 hover:text-foreground"
        >
          <SlidersHorizontal className="h-3 w-3 text-primary" />
          <span>{lang === "ar" ? "ضبط وتخصيص الأقسام" : "Manage Sections"}</span>
        </button>
      </div>

      <CatalogTable tab={tab} />

      {/* Catalog Modules Customization Dialog */}
      <CatalogModulesDialog open={modulesDialogOpen} onClose={() => setModulesDialogOpen(false)} />
    </div>
  );
}

function CatalogTable({ tab }: { tab: Tab }) {
  const { t, lang } = useI18n();
  const qc = useQueryClient();
  const breakpoint = useBreakpoint();
  const tableUsesHorizontalScroll =
    breakpoint === "xs" || breakpoint === "sm" || breakpoint === "md";
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<Item | null>(null);
  const [open, setOpen] = useState(false);
  const [filterMakeId, setFilterMakeId] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [viewMode, setViewMode] = usePersistedViewMode("catalog", "cards");
  const [sort, setSort] = useState<DataTableSort | null>(null);

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
                : tab === "models"
                  ? "vehicle_models"
                  : "quality_grades";

  const cols =
    tab === "units"
      ? "id, name, name_ar, short_name"
      : tab === "qualities"
        ? "id, name, name_ar, code, sort_order"
        : tab === "origins"
          ? "id, name, name_ar, code"
          : tab === "models"
            ? "id, name, name_ar, make_id, vehicle_makes(id, name, name_ar)"
            : "id, name, name_ar";

  const { data, isLoading, isFetching, error, refetch } = useQuery({
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

  const { data: makesList = [] } = useQuery({
    queryKey: ["vehicle-makes-filter"],
    enabled: tab === "models",
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("vehicle_makes")
        .select("id, name, name_ar")
        .order("name");
      return (data ?? []) as { id: string; name: string; name_ar: string | null }[];
    },
  });

  const filtered = useMemo(() => {
    let list = data ?? [];
    if (tab === "models" && filterMakeId) list = list.filter((r) => r.make_id === filterMakeId);
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
      ].some((x) => (x ?? "").toLowerCase().includes(s)),
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
      qc.invalidateQueries({ queryKey: ["catalog-metrics-overview"] });
      qc.invalidateQueries({ queryKey: ["products-meta"] });
      qc.invalidateQueries({ queryKey: ["products"] });
      qc.invalidateQueries({ queryKey: ["pos-live-meta"] });
      qc.invalidateQueries({ queryKey: ["vehicle-makes-filter"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const newLabel =
    tab === "categories"
      ? t("catalog.new_category") || "إضافة تصنيف"
      : tab === "brands"
        ? t("catalog.new_brand") || "إضافة علامة تجارية"
        : tab === "units"
          ? t("catalog.new_unit") || "إضافة وحدة قياس"
          : tab === "origins"
            ? lang === "ar"
              ? "إضافة دولة منشأ"
              : "Add Origin"
            : tab === "qualities"
              ? lang === "ar"
                ? "إضافة درجة جودة"
                : "Add Quality Grade"
              : tab === "makes"
                ? lang === "ar"
                  ? "إضافة ماركة مركبة"
                  : "Add Vehicle Make"
                : tab === "models"
                  ? lang === "ar"
                    ? "إضافة موديل مركبة"
                    : "Add Vehicle Model"
                  : lang === "ar"
                    ? "إضافة درجة حبوب"
                    : "Add Grain Grade";

  const tabTitle =
    tab === "categories"
      ? lang === "ar"
        ? "قائمة التصنيفات"
        : "Categories"
      : tab === "units"
        ? lang === "ar"
          ? "وحدات القياس"
          : "Measurement Units"
        : tab === "brands"
          ? lang === "ar"
            ? "العلامات التجارية"
            : "Brands"
          : tab === "origins"
            ? lang === "ar"
              ? "بلدان المنشأ"
              : "Origins"
            : tab === "qualities"
              ? lang === "ar"
                ? "درجات الجودة"
                : "Quality grades"
              : tab === "makes"
                ? lang === "ar"
                  ? "ماركات المركبات"
                  : "Vehicle makes"
                : tab === "models"
                  ? lang === "ar"
                    ? "موديلات المركبات"
                    : "Vehicle models"
                  : lang === "ar"
                    ? "درجات وأنواع الحبوب"
                    : "Grain Grades";

  // Export current list to CSV
  const handleExportCsv = () => {
    if (!filtered || filtered.length === 0) {
      toast.error(lang === "ar" ? "لا توجد بيانات للتصدير" : "No data to export");
      return;
    }
    const headers = [
      lang === "ar" ? "الاسم العربي" : "Arabic Name",
      lang === "ar" ? "الاسم اللاتيني" : "Latin Name",
      ...(tab === "units" ? [lang === "ar" ? "الرمز المختصر" : "Short Code"] : []),
    ];

    const rows = filtered.map((item) => [
      `"${(item.name_ar || "").replace(/"/g, '""')}"`,
      `"${(item.name || "").replace(/"/g, '""')}"`,
      ...(tab === "units" ? [`"${(item.short_name || "").replace(/"/g, '""')}"`] : []),
    ]);

    const csvContent = "" + [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `catalog-${tab}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(lang === "ar" ? "تم تصدير ملف CSV بنجاح" : "Exported CSV successfully");
  };

  const copyText = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    toast.success(lang === "ar" ? "تم النسخ للحافظة" : "Copied to clipboard");
    setTimeout(() => setCopiedId(null), 2000);
  };

  const itemName = (item: Item) =>
    lang === "ar" ? item.name_ar || item.name || "—" : item.name || item.name_ar || "—";
  const itemSecondaryName = (item: Item) =>
    lang === "ar" ? item.name || item.name_ar || "—" : item.name_ar || item.name || "—";
  const itemDetail = (item: Item) => {
    if (tab === "units") return item.short_name || "—";
    if (tab === "models") {
      return lang === "ar"
        ? item.vehicle_makes?.name_ar || item.vehicle_makes?.name || "—"
        : item.vehicle_makes?.name || item.vehicle_makes?.name_ar || "—";
    }
    if (tab === "origins" || tab === "qualities") return item.code || "—";
    return "—";
  };

  const openEditor = (item: Item | null = null) => {
    setEditing(item);
    setOpen(true);
  };

  const requestDelete = (item: Item) => {
    if (confirm(lang === "ar" ? "هل أنت متأكد من حذف هذا العنصر؟" : t("catalog.confirm_delete"))) {
      remove.mutate(item.id);
    }
  };

  const sorted = (() => {
    if (!sort) return filtered;
    const direction = sort.direction === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const aValue =
        sort.key === "details"
          ? itemDetail(a)
          : sort.key === "name"
            ? itemName(a)
            : itemSecondaryName(a);
      const bValue =
        sort.key === "details"
          ? itemDetail(b)
          : sort.key === "name"
            ? itemName(b)
            : itemSecondaryName(b);
      return String(aValue).localeCompare(String(bValue), lang === "ar" ? "ar" : "en") * direction;
    });
  })();

  const columns: DataTableColumn<Item>[] = [
    {
      key: "name",
      header: lang === "ar" ? "الاسم" : "Name",
      sortable: true,
      width: "w-[280px]",
      sortValue: itemName,
      cell: (item) => <CatalogIdentity name={itemName(item)} />,
    },
    {
      key: "secondary",
      header: lang === "ar" ? "الاسم اللاتيني" : "Arabic name",
      sortable: true,
      width: "w-[220px]",
      sortValue: itemSecondaryName,
      cell: (item) => (
        <span className="font-mono text-xs text-muted-foreground">{itemSecondaryName(item)}</span>
      ),
    },
    ...(tab === "units" || tab === "models" || tab === "origins" || tab === "qualities"
      ? [
          {
            key: "details",
            header:
              tab === "units"
                ? lang === "ar"
                  ? "الرمز المختصر"
                  : "Short code"
                : tab === "models"
                  ? lang === "ar"
                    ? "الماركة التابعة"
                    : "Make"
                  : lang === "ar"
                    ? "الكود"
                    : "Code",
            sortable: true,
            width: "w-[180px]",
            sortValue: itemDetail,
            cell: (item: Item) => <CatalogDetail value={itemDetail(item)} tab={tab} />,
          } satisfies DataTableColumn<Item>,
        ]
      : []),
    {
      key: "actions",
      header: t("common.actions"),
      width: "w-[150px]",
      align: "end",
      cell: (item) => (
        <CatalogRecordActions
          item={item}
          copied={copiedId === item.id}
          isRtl={lang === "ar"}
          onCopy={copyText}
          onEdit={openEditor}
          onDelete={requestDelete}
        />
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <RecordsToolbar
        searchValue={q}
        onSearchChange={setQ}
        searchPlaceholder={lang === "ar" ? `ابحث في ${tabTitle}` : `Search ${tabTitle}`}
        resultCount={sorted.length}
        searchLoading={isFetching && !isLoading}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        end={
          <button
            type="button"
            onClick={handleExportCsv}
            disabled={sorted.length === 0}
            className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-border/80 bg-card px-3 text-xs font-semibold text-muted-foreground shadow-xs transition hover:bg-muted hover:text-foreground disabled:opacity-40 active:scale-95"
          >
            <Download className="size-3.5" />
            <span>{lang === "ar" ? "تصدير" : "Export"}</span>
          </button>
        }
        action={
          <PrimaryAction
            label={newLabel}
            icon={<Plus className="size-4" />}
            onClick={() => openEditor()}
          />
        }
      >
        {tab === "models" && makesList.length > 0 ? (
          <div className="flex items-center gap-2">
            <label className="sr-only" htmlFor="catalog-make-filter">
              {lang === "ar" ? "تصفية الماركة" : "Filter by make"}
            </label>
            <div className="relative">
              <select
                id="catalog-make-filter"
                value={filterMakeId}
                onChange={(e) => setFilterMakeId(e.target.value)}
                className="h-10 appearance-none rounded-xl border border-border/80 bg-card px-3 pe-9 text-xs font-medium text-foreground outline-none transition hover:border-primary/50 focus:border-primary focus:ring-2 focus:ring-primary/20"
              >
                <option value="">{lang === "ar" ? "جميع الماركات" : "All makes"}</option>
                {makesList.map((make) => (
                  <option key={make.id} value={make.id}>
                    {lang === "ar" ? make.name_ar || make.name : make.name}
                  </option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute end-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            </div>
          </div>
        ) : null}
      </RecordsToolbar>

      <RecordsView<Item>
        rows={sorted}
        getRowId={(item) => item.id}
        viewMode={viewMode}
        loading={isLoading}
        refreshing={isFetching && !isLoading}
        error={error}
        onRetry={() => void refetch()}
        columns={columns}
        sort={sort}
        onSortChange={setSort}
        minWidth={860}
        horizontalScroll={tableUsesHorizontalScroll}
        renderCard={(item) => (
          <CatalogCard
            item={item}
            name={itemName(item)}
            secondaryName={itemSecondaryName(item)}
            detail={itemDetail(item)}
            tab={tab}
            copied={copiedId === item.id}
            isRtl={lang === "ar"}
            onCopy={copyText}
            onEdit={openEditor}
            onDelete={requestDelete}
          />
        )}
        renderListRow={(item) => (
          <CatalogListRow
            item={item}
            name={itemName(item)}
            secondaryName={itemSecondaryName(item)}
            detail={itemDetail(item)}
            tab={tab}
            copied={copiedId === item.id}
            isRtl={lang === "ar"}
            onCopy={copyText}
            onEdit={openEditor}
            onDelete={requestDelete}
          />
        )}
        empty={{
          icon: <Layers className="size-8" />,
          title: q
            ? lang === "ar"
              ? "لا توجد نتائج مطابقة لبحثك"
              : "No matching results"
            : lang === "ar"
              ? "لا توجد عناصر بعد"
              : "No items yet",
          description:
            lang === "ar"
              ? "أضف عنصراً جديداً أو غيّر عبارة البحث."
              : "Add a new item or change the search phrase.",
          action: <PrimaryAction label={newLabel} icon={<Plus />} onClick={() => openEditor()} />,
        }}
      />

      {/* Vortex Luxury Dialog */}
      {open && (
        <CatalogSheetDialog
          open={open}
          tab={tab}
          initial={editing}
          onClose={() => setOpen(false)}
          onSaved={() => {
            setOpen(false);
            qc.invalidateQueries({ queryKey: ["catalog", tab] });
            qc.invalidateQueries({ queryKey: ["catalog-metrics-overview"] });
            qc.invalidateQueries({ queryKey: ["products-meta"] });
            qc.invalidateQueries({ queryKey: ["products"] });
            qc.invalidateQueries({ queryKey: ["pos-live-meta"] });
          }}
        />
      )}
    </div>
  );
}

function CatalogIdentity({ name }: { name: string }) {
  const initial = name.trim().charAt(0) || "?";
  return (
    <div className="flex min-w-0 items-center gap-3">
      <div className="grid size-9 shrink-0 place-items-center rounded-xl border border-primary/20 bg-primary/10 text-xs font-bold text-primary">
        {initial}
      </div>
      <span className="truncate font-semibold text-foreground">{name}</span>
    </div>
  );
}

function CatalogDetail({ value, tab }: { value: string; tab: Tab }) {
  if (tab === "models") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-xl border border-primary/20 bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary">
        <Car className="size-3" />
        {value}
      </span>
    );
  }
  return (
    <span className="inline-flex rounded-lg border border-border/80 bg-muted/50 px-2.5 py-0.5 font-mono text-xs font-bold text-foreground">
      {value}
    </span>
  );
}

interface CatalogRecordActionProps {
  item: Item;
  copied: boolean;
  isRtl: boolean;
  onCopy: (text: string, id: string) => void;
  onEdit: (item: Item) => void;
  onDelete: (item: Item) => void;
}

function CatalogRecordActions({
  item,
  copied,
  isRtl,
  onCopy,
  onEdit,
  onDelete,
}: CatalogRecordActionProps) {
  const controlClass =
    "grid size-8 place-items-center rounded-xl border border-border/60 bg-card text-muted-foreground transition hover:bg-muted hover:text-foreground active:scale-95";
  return (
    <div className="inline-flex items-center gap-1.5">
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onCopy(item.name_ar || item.name || "", item.id);
        }}
        className={controlClass}
        title={isRtl ? "نسخ الاسم" : "Copy name"}
        aria-label={isRtl ? "نسخ الاسم" : "Copy name"}
      >
        {copied ? <Check className="size-3.5 text-emerald-500" /> : <Copy className="size-3.5" />}
      </button>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onEdit(item);
        }}
        className={controlClass}
        title={isRtl ? "تعديل" : "Edit"}
        aria-label={isRtl ? "تعديل" : "Edit"}
      >
        <Pencil className="size-3.5" />
      </button>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onDelete(item);
        }}
        className="grid size-8 place-items-center rounded-xl border border-destructive/20 bg-destructive/10 text-destructive transition hover:bg-destructive/20 active:scale-95"
        title={isRtl ? "حذف" : "Delete"}
        aria-label={isRtl ? "حذف" : "Delete"}
      >
        <Trash2 className="size-3.5" />
      </button>
    </div>
  );
}

interface CatalogRecordProps extends CatalogRecordActionProps {
  name: string;
  secondaryName: string;
  detail: string;
  tab: Tab;
}

function CatalogCard({ item, name, secondaryName, detail, tab, ...actions }: CatalogRecordProps) {
  return (
    <div className="card-mullak group relative flex h-full flex-col justify-between rounded-2xl p-3 transition-all duration-200 hover:border-primary/40 hover:shadow-md sm:p-4">
      <div className="flex min-w-0 items-start justify-between gap-2">
        <CatalogIdentity name={name} />
        <CatalogRecordActions item={item} {...actions} />
      </div>
      <div className="mt-4 space-y-2 border-t border-border/60 pt-3">
        <p className="truncate font-mono text-xs text-muted-foreground">{secondaryName}</p>
        {detail !== "—" ? <CatalogDetail value={detail} tab={tab} /> : null}
      </div>
    </div>
  );
}

function CatalogListRow({
  item,
  name,
  secondaryName,
  detail,
  tab,
  ...actions
}: CatalogRecordProps) {
  return (
    <div className="card-mullak flex flex-col gap-3 rounded-2xl border p-3.5 transition hover:border-primary/40 hover:shadow-sm sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <CatalogIdentity name={name} />
        <span className="hidden font-mono text-xs text-muted-foreground sm:inline">
          {secondaryName}
        </span>
        {detail !== "—" ? <CatalogDetail value={detail} tab={tab} /> : null}
      </div>
      <CatalogRecordActions item={item} {...actions} />
    </div>
  );
}

function CatalogSheetDialog({
  open,
  tab,
  initial,
  onClose,
  onSaved,
}: {
  open: boolean;
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
      (await (supabase as any).from("vehicle_makes").select("id,name,name_ar").order("name"))
        .data ?? [],
  });

  const [saving, setSaving] = useState(false);

  const editLabel =
    tab === "categories"
      ? initial
        ? t("catalog.edit_category") || "تعديل التصنيف"
        : t("catalog.new_category") || "إضافة تصنيف جديد"
      : tab === "brands"
        ? initial
          ? "تعديل العلامة التجارية"
          : "إضافة علامة تجارية"
        : tab === "units"
          ? initial
            ? t("catalog.edit_unit") || "تعديل وحدة القياس"
            : t("catalog.new_unit") || "إضافة وحدة قياس"
          : tab === "origins"
            ? initial
              ? "تعديل دولة المنشأ"
              : "إضافة دولة منشأ"
            : tab === "qualities"
              ? initial
                ? "تعديل درجة الجودة"
                : "إضافة درجة جودة"
              : tab === "makes"
                ? initial
                  ? "تعديل ماركة المركبة"
                  : "إضافة ماركة مركبة"
                : tab === "models"
                  ? initial
                    ? "تعديل موديل المركبة"
                    : "إضافة موديل مركبة"
                  : initial
                    ? lang === "ar"
                      ? "تعديل درجة الحبوب"
                      : "Edit Grain Grade"
                    : lang === "ar"
                      ? "إضافة درجة حبوب"
                      : "New Grain Grade";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name_ar.trim() && !form.name.trim()) {
      toast.error(lang === "ar" ? "الاسم مطلوب" : t("catalog.name_required"));
      return;
    }
    if (tab === "models" && !form.make_id) {
      toast.error(lang === "ar" ? "اختر ماركة المركبة أولاً" : "Select a vehicle make first");
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
        : tab === "qualities"
          ? { ...base, code: baseCode, sort_order: Number(form.sort_order) || 0 }
          : tab === "origins"
            ? { ...base, code: baseCode }
            : tab === "models"
              ? { ...base, make_id: form.make_id }
              : base;

    const q: any = supabase.from(table as "categories");
    const { error } = initial
      ? await q.update(payload).eq("id", initial.id)
      : await q.insert(payload);
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(lang === "ar" ? "تم الحفظ بنجاح" : t("common.saved") || "Saved");
    onSaved();
  }

  const TabIcon = TAB_ICONS[tab] || Boxes;

  return (
    <VortexDrawerDialog
      open={open}
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
      title={editLabel}
      subtitle={
        lang === "ar"
          ? "يتم تطبيق هذا العنصر فوراً في تعريفات المنتجات، الفواتير، ونقطة البيع"
          : "Changes will reflect instantly across inventory, invoices, and POS"
      }
      eyebrow={lang === "ar" ? "إدارة الفهرس الموحد" : "Catalog Management"}
      icon={<TabIcon className="h-5 w-5" />}
      size="md"
      footer={
        <div className="flex w-full items-center justify-end gap-2.5">
          <button
            type="button"
            onClick={onClose}
            className="flex h-10 items-center rounded-xl border border-border/80 bg-card px-4 text-xs font-semibold text-muted-foreground transition hover:bg-muted hover:text-foreground"
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={submit}
            className="flex h-10 items-center gap-1.5 rounded-xl bg-primary px-5 text-xs font-semibold text-primary-foreground shadow-sm shadow-primary/25 transition hover:opacity-90 disabled:opacity-50 active:scale-95"
          >
            {saving ? (
              t("common.saving")
            ) : (
              <>
                <CheckCircle2 className="h-4 w-4" />
                <span>
                  {initial
                    ? lang === "ar"
                      ? "تحديث العنصر"
                      : "Update"
                    : lang === "ar"
                      ? "إضافة للعرض"
                      : "Create"}
                </span>
              </>
            )}
          </button>
        </div>
      }
    >
      <form onSubmit={submit} className="space-y-4 py-2">
        <div>
          <label className="mb-1.5 block text-xs font-bold text-foreground">
            {t("catalog.name_ar") || "الاسم بالعربية"} <span className="text-destructive">*</span>
          </label>
          <input
            value={form.name_ar}
            onChange={(e) => setForm({ ...form, name_ar: e.target.value })}
            className="h-11 w-full rounded-xl border border-border/80 bg-background px-3.5 text-sm text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
            dir="rtl"
            placeholder={
              tab === "categories"
                ? "مثال: زيوت ومحركات، فلاتر، إطارات..."
                : tab === "brands"
                  ? "مثال: تويوتا، نيسان، بوش..."
                  : tab === "units"
                    ? "مثال: حبة، درزن، كرتون، لتر..."
                    : "أدخل الاسم بالعربية"
            }
            required
          />
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-bold text-foreground">
            {t("catalog.name_en") || "الاسم باللاتينية / English Name"}
          </label>
          <input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="h-11 w-full rounded-xl border border-border/80 bg-background px-3.5 font-mono text-sm text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
            placeholder="e.g. Engine Oil, Toyota, Box"
          />
        </div>

        {tab === "units" && (
          <div>
            <label className="mb-1.5 block text-xs font-bold text-foreground">
              {t("catalog.short_name") || "الرمز المختصر للوحدة"}
            </label>
            <input
              value={form.short_name}
              onChange={(e) => setForm({ ...form, short_name: e.target.value })}
              className="h-11 w-full rounded-xl border border-border/80 bg-background px-3.5 text-sm text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
              placeholder="مثال: حبة، كرتون، PCS، KG"
            />
          </div>
        )}

        {tab === "models" && (
          <div>
            <label className="mb-1.5 block text-xs font-bold text-foreground">
              {lang === "ar" ? "ماركة المركبة" : "Vehicle Make"}{" "}
              <span className="text-destructive">*</span>
            </label>
            <select
              value={form.make_id}
              onChange={(e) => setForm({ ...form, make_id: e.target.value })}
              className="h-11 w-full rounded-xl border border-border/80 bg-background px-3.5 text-sm text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
              required
            >
              <option value="">{lang === "ar" ? "اختر الماركة" : "Select a make"}</option>
              {makes.map((make: { id: string; name: string; name_ar: string | null }) => (
                <option key={make.id} value={make.id}>
                  {lang === "ar" ? make.name_ar || make.name : make.name}
                </option>
              ))}
            </select>
          </div>
        )}

        {(tab === "origins" || tab === "qualities") && (
          <div>
            <label className="mb-1.5 block text-xs font-bold text-foreground">
              {lang === "ar" ? "الكود التعريفي المختصر" : "Short Code"}
            </label>
            <input
              value={form.code}
              onChange={(e) => setForm({ ...form, code: e.target.value })}
              className="h-11 w-full rounded-xl border border-border/80 bg-background px-3.5 font-mono text-sm uppercase text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
              placeholder={tab === "origins" ? "SA, YE, TR" : "G1, G2, G3"}
            />
          </div>
        )}

        {tab === "qualities" && (
          <div>
            <label className="mb-1.5 block text-xs font-bold text-foreground">
              {lang === "ar" ? "ترتيب الأهمية" : "Sort Order"}
            </label>
            <QuantityInput
              value={form.sort_order === "" ? null : Number(form.sort_order)}
              onValueChange={(v) => setForm({ ...form, sort_order: v == null ? "" : String(v) })}
              decimals={0}
              min={0}
              containerClassName="[&_input]:h-11 [&_input]:rounded-xl"
            />
          </div>
        )}
      </form>
    </VortexDrawerDialog>
  );
}

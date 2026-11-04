/**
 * /milling/products — إدارة أصناف الأمانات (حبوب خام + نواتج طحن).
 *
 * صفحة مخصصة لقسم المطحنة — تعرض فقط المنتجات المعلّمة
 * `is_custody_item = true` في تبويبين: حبوب خام ونواتج مطحونة.
 * الإضافة والتعديل عبر `CustodyProductFormDialog` المنبثق.
 *
 * التصميم: يطبّق **نفس التصميمات الموحّدة** المعتمدة في `/products` حرفياً:
 *   1. بطاقات مؤشرات VortexMetricCard أعلى الصفحة (قابلة للنقر كمرشّحات سريعة).
 *   2. شريط السجلات الموحّد RecordsToolbar (بحث + فلترة + ترتيب + عرض + أعمدة).
 *   3. ثلاثة أنماط عرض للسجلات: بطاقات / قائمة / جدول DataTable.
 *   4. الحالات المشتركة: RecordsSkeleton، RecordsEmpty، خطأ التحميل.
 *   5. نافذة تفاصيل جانبية Sheet بنفس هوية منتجات الكتالوج.
 *
 * أسباب الفصل عن `/products` (بيانات فقط، لا تصميم):
 *  - أصناف الأمانات معلّمة بعلم `is_custody_item` ولا تختلط مع المبيعات.
 *  - موظف المطحنة لا يحتاج باقي حقول كتالوج البيع.
 */
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import {
  Wheat,
  Factory,
  Package,
  Plus,
  Pencil,
  Power,
  Copy,
  Tag,
  Scale,
  Barcode,
  AlertTriangle,
  Layers,
  CheckCircle2,
  Boxes,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { ModuleGuard } from "@/lib/modules";
import { SegmentedTabs } from "@/components/ui/segmented-tabs";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";
import { useBreakpoint } from "@/design/breakpoints";
import { fuzzySearch, buildSearchIndex } from "@/design/fuzzy";
import { toSystemDigits } from "@/lib/format-preferences";
import { moneyCell, qtyCell } from "@/lib/format";

import { VortexMetricCard } from "@/components/vortex-ui";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { StatusBadge } from "@/components/ui/status-badge";
import { PrimaryAction } from "@/components/ui/primary-action";
import { quietChipClass } from "@/components/ui/action-button";
import { DataTable, type DataTableColumn, type DataTableSort } from "@/components/ui/data-table";
import { RecordsToolbar } from "@/components/ui/records-toolbar";
import { RecordsSkeleton, RecordsEmpty } from "@/components/ui/records-states";
import { RecordsFilterPanel, RecordsSortPanel } from "@/components/ui/records-panels";
import {
  applyFilters,
  type FilterDefinition,
  type FilterValues,
  type SortOption,
} from "@/components/ui/table-toolbar";
import { ItemRoleBadge, resolveItemClass } from "@/components/item-role-badge";
import { usePersistedViewMode } from "@/hooks/use-persisted-view-mode";
import { useColumnVisibility } from "@/hooks/use-column-visibility";
import { CUSTODY_PRODUCTS_COLUMNS } from "@/lib/records/registries";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import {
  CustodyProductFormDialog,
  type CustodyProductFormData,
} from "@/components/milling/custody-product-form-dialog";

/* ---------------------------------------------------------- route setup -- */

export const Route = createFileRoute("/_app/milling/products")({
  head: () => ({ meta: [{ title: "أصناف الأمانات — فورتكس ERP" }] }),
  component: CustodyProductsPage,
});

/* ------------------------------------------------------------ types -- */

interface CustodyProduct {
  id: string;
  sku: string;
  name: string | null;
  name_ar: string;
  item_class: string;
  item_nature?: string | null;
  inventory_policy?: string | null;
  is_active: boolean;
  package_weight_kg: number | null;
  sale_price: number;
  cost_price: number;
  min_stock: number | null;
  created_at: string;
}

type TabValue = "raw" | "output";
type QuickFilter = "all" | "active" | "inactive";

const RAW_CLASSES = ["RAW_MATERIAL"];
const OUTPUT_CLASSES = ["FINISHED_GOOD", "BY_PRODUCT"];

/* --------------------------------------------------------- component -- */

function CustodyProductsPage() {
  const db = supabase as any;
  const qc = useQueryClient();
  const { t, lang } = useI18n();
  const isAr = lang === "ar";
  const breakpoint = useBreakpoint();

  /* سياق عرض السجلات الموحّد — نفس الذي تستخدمه /products. */
  const tableUsesHorizontalScroll =
    breakpoint === "xs" || breakpoint === "sm" || breakpoint === "md";
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<FilterValues>({});
  const [sort, setSort] = useState<DataTableSort | null>(null);
  const [quickFilter, setQuickFilter] = useState<QuickFilter>("all");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const [viewMode, setViewMode] = usePersistedViewMode("milling-custody-products", "cards");
  const [detail, setDetail] = useState<CustodyProduct | null>(null);
  const [copiedSku, setCopiedSku] = useState<string | null>(null);

  const productColumns = useColumnVisibility("custody-products", CUSTODY_PRODUCTS_COLUMNS);
  const col = productColumns.visibility;

  const [tab, setTab] = useState<TabValue>("raw");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogDefaultClass, setDialogDefaultClass] = useState<
    "RAW_MATERIAL" | "FINISHED_GOOD" | "BY_PRODUCT"
  >("RAW_MATERIAL");
  const [editingProduct, setEditingProduct] = useState<
    (Partial<CustodyProductFormData> & { id: string }) | null
  >(null);

  /* ---- fetch custody products ---- */
  const {
    data: products = [],
    isLoading,
    isFetching,
    error,
    refetch,
  } = useQuery({
    queryKey: ["custody-products"],
    queryFn: async () => {
      const { data, error } = await db
        .from("products")
        .select(
          "id, sku, name, name_ar, item_class, item_nature, inventory_policy, is_active, package_weight_kg, sale_price, cost_price, min_stock, created_at",
        )
        .eq("is_custody_item", true)
        .order("item_class")
        .order("name_ar");
      if (error) throw error;
      return (data || []) as CustodyProduct[];
    },
  });

  /* ---- counts ---- */
  const rawCount = products.filter((p) => RAW_CLASSES.includes(p.item_class)).length;
  const outputCount = products.filter((p) => OUTPUT_CLASSES.includes(p.item_class)).length;
  const activeCount = products.filter((p) => p.is_active).length;
  const inactiveCount = products.length - activeCount;

  /* ---- rows for the active tab ---- */
  const tabRows = useMemo(
    () =>
      products.filter((p) =>
        tab === "raw" ? RAW_CLASSES.includes(p.item_class) : OUTPUT_CLASSES.includes(p.item_class),
      ),
    [products, tab],
  );

  /* ---- typo-tolerant, Arabic-normalised search (same as /products) ---- */
  const searchIndex = useMemo(
    () => buildSearchIndex(tabRows, (p) => [p.name, p.name_ar, p.sku]),
    [tabRows],
  );

  const searched = useMemo(() => {
    const q = query.trim();
    if (!q) return tabRows;
    return fuzzySearch(searchIndex, q, { threshold: 0.55, requireAll: true }).map((m) => m.item);
  }, [tabRows, query, searchIndex]);

  /* ---- structured filters (status / custody type) ---- */
  const filtered = useMemo(
    () =>
      applyFilters(searched, filters, {
        role: (p) => p.item_class ?? "",
        status: (p) => (p.is_active ? "active" : "inactive"),
      }),
    [searched, filters],
  );

  const displayRows = useMemo(() => {
    if (quickFilter === "active") return filtered.filter((p) => p.is_active);
    if (quickFilter === "inactive") return filtered.filter((p) => !p.is_active);
    return filtered;
  }, [filtered, quickFilter]);

  const sortedRows = useMemo(() => {
    if (!sort?.key) return displayRows;
    const direction = sort.direction === "desc" ? -1 : 1;
    const value = (p: CustodyProduct): string | number => {
      switch (sort.key) {
        case "package_weight_kg":
          return Number(p.package_weight_kg) || 0;
        case "created_at":
          return new Date(p.created_at).getTime() || 0;
        case "sku":
          return p.sku ?? "";
        case "role":
          return p.item_class ?? "";
        case "name":
        default:
          return (isAr ? p.name_ar || p.name : p.name || p.name_ar) ?? "";
      }
    };
    return [...displayRows].sort((a, b) => {
      const av = value(a);
      const bv = value(b);
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * direction;
      return String(av).localeCompare(String(bv), isAr ? "ar" : "en") * direction;
    });
  }, [displayRows, sort, isAr]);

  /* ---- toggle active mutation ---- */
  const toggleMutation = useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) => {
      const { error } = await db.from("products").update({ is_active: active }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_data, { active }) => {
      toast.success(
        active
          ? isAr
            ? "تم تفعيل الصنف بنجاح"
            : "Item activated"
          : isAr
            ? "تم تعطيل الصنف بنجاح"
            : "Item deactivated",
      );
      qc.invalidateQueries({ queryKey: ["custody-products"] });
      qc.invalidateQueries({ queryKey: ["milling"] });
    },
    onError: (err: any) =>
      toast.error(err?.message || (isAr ? "تعذر تغيير حالة الصنف" : "Failed to toggle status")),
  });

  /* ---- handlers ---- */
  const openNew = useCallback(() => {
    setEditingProduct(null);
    setDialogDefaultClass(tab === "raw" ? "RAW_MATERIAL" : "FINISHED_GOOD");
    setDialogOpen(true);
  }, [tab]);

  const handleEdit = (p: CustodyProduct) => {
    // الحقول الغائبة تُترك `undefined`، فيملأها النموذج الموحّد من القاعدة عند الحفظ.
    setEditingProduct({
      id: p.id,
      name_ar: p.name_ar,
      name_en: p.name,
      sku: p.sku,
      package_weight_kg: p.package_weight_kg,
      item_class: p.item_class as "RAW_MATERIAL" | "FINISHED_GOOD" | "BY_PRODUCT",
      is_active: p.is_active,
    });
    setDialogDefaultClass(p.item_class as any);
    setDialogOpen(true);
  };

  /* ---- class display helpers ---- */
  const classIcon = (cls: string) =>
    cls === "RAW_MATERIAL" ? Wheat : cls === "BY_PRODUCT" ? Package : Factory;
  const classLabel = (cls: string) =>
    cls === "RAW_MATERIAL"
      ? isAr
        ? "حبوب خام"
        : "Raw grain"
      : cls === "BY_PRODUCT"
        ? isAr
          ? "ناتج ثانوي"
          : "By-product"
        : isAr
          ? "ناتج طحن"
          : "Milled output";
  const classColor = (cls: string) =>
    cls === "RAW_MATERIAL"
      ? "text-amber-600 dark:text-amber-400 bg-amber-500/15 border-amber-500/20"
      : cls === "BY_PRODUCT"
        ? "text-orange-600 dark:text-orange-400 bg-orange-500/15 border-orange-500/20"
        : "text-emerald-600 dark:text-emerald-400 bg-emerald-500/15 border-emerald-500/20";

  const countActiveFilters = (values: FilterValues) =>
    Object.values(values).filter((value) => {
      if (value == null) return false;
      if (typeof value === "string") return value !== "";
      return Boolean(value.from || value.to);
    }).length;

  /* ---------------- filter + sort definitions (localized) ---------------- */
  const filterDefinitions = useMemo<FilterDefinition[]>(() => {
    const list: FilterDefinition[] = [
      {
        key: "status",
        label: isAr ? "الحالة" : "Status",
        type: "select",
        options: [
          { value: "active", label: t("common.active") },
          { value: "inactive", label: t("common.inactive") },
        ],
      },
    ];
    list.push({
      key: "role",
      label: isAr ? "نوع الأمانة" : "Custody type",
      type: "select",
      options:
        tab === "raw"
          ? [{ value: "RAW_MATERIAL", label: isAr ? "حبوب خام" : "Raw grain" }]
          : [
              { value: "FINISHED_GOOD", label: isAr ? "ناتج طحن" : "Milled output" },
              { value: "BY_PRODUCT", label: isAr ? "ناتج ثانوي" : "By-product" },
            ],
    });
    return list;
  }, [tab, isAr, t]);

  const sortOptions = useMemo<SortOption[]>(
    () => [
      { value: "", label: isAr ? "الافتراضي" : "Default" },
      { value: "name", label: isAr ? "الاسم" : "Name" },
      { value: "role", label: isAr ? "نوع الأمانة" : "Custody type" },
      { value: "package_weight_kg", label: isAr ? "سعة العبوة" : "Package weight" },
      { value: "sku", label: t("products.sku") },
    ],
    [isAr, t],
  );

  /* ---------------- columns (DataTable) ---------------- */
  const dataColumns = useMemo<DataTableColumn<CustodyProduct>[]>(() => {
    const cols: DataTableColumn<CustodyProduct>[] = [
      {
        key: "name",
        header: isAr ? "اسم الصنف" : "Item name",
        sortable: true,
        width: "w-[240px]",
        sortValue: (p) => (isAr ? p.name_ar || p.name : p.name || p.name_ar) ?? "",
        cell: (p) => {
          const primary = (isAr ? p.name_ar || p.name : p.name || p.name_ar) ?? "—";
          const other = isAr ? p.name : p.name_ar;
          const secondary =
            col.name_en && other && other.trim() && other.trim() !== primary.trim() ? other : null;
          return (
            <div className="flex flex-col py-0.5">
              <span
                className="font-semibold text-foreground text-sm leading-snug truncate"
                dir={isAr ? "rtl" : "ltr"}
              >
                {primary}
              </span>
              {secondary ? (
                <span
                  className="text-[11px] text-muted-foreground truncate"
                  dir={isAr ? "ltr" : "rtl"}
                >
                  {secondary}
                </span>
              ) : null}
            </div>
          );
        },
      },
    ];

    if (col.role) {
      cols.push({
        key: "role",
        header: isAr ? "نوع الأمانة" : "Custody type",
        sortable: true,
        width: "w-[150px]",
        sortValue: (p) => resolveItemClass(p.item_class, p.item_nature, p.inventory_policy),
        cell: (p) => (
          <ItemRoleBadge
            itemClass={p.item_class}
            itemNature={p.item_nature}
            inventoryPolicy={p.inventory_policy}
            isRtl={isAr}
          />
        ),
      });
    }

    if (col.package_weight_kg) {
      cols.push({
        key: "package_weight_kg",
        header: isAr ? "سعة العبوة" : "Package weight",
        align: "end",
        sortable: true,
        width: "w-[120px]",
        sortValue: (p) => Number(p.package_weight_kg) || 0,
        cell: (p) => (
          <span className="font-mono text-xs tabular-nums text-muted-foreground">
            {p.package_weight_kg ? `${qtyCell(p.package_weight_kg)} ${isAr ? "كجم" : "kg"}` : "—"}
          </span>
        ),
      });
    }

    if (col.sku) {
      cols.push({
        key: "sku",
        header: t("products.sku"),
        width: "w-[124px]",
        cell: (p) => (
          <span className="font-mono text-xs text-muted-foreground">{p.sku || "—"}</span>
        ),
      });
    }

    if (col.created_at) {
      cols.push({
        key: "created_at",
        header: isAr ? "تاريخ الإضافة" : "Created at",
        width: "w-[124px]",
        cell: (p) => (
          <span className="font-mono text-xs text-muted-foreground">
            {String(p.created_at ?? "").slice(0, 10) || "—"}
          </span>
        ),
      });
    }

    if (col.is_active) {
      cols.push({
        key: "is_active",
        header: t("common.status"),
        width: "w-[106px]",
        cell: (p) => (
          <StatusBadge tone={p.is_active ? "success" : "neutral"} dot>
            {p.is_active ? t("common.active") : t("common.inactive")}
          </StatusBadge>
        ),
      });
    }

    cols.push({
      key: "actions",
      header: t("common.actions"),
      align: "end",
      width: "w-[110px]",
      cell: (p) => (
        <div className="inline-flex items-center gap-1.5 pe-2">
          <IconButton
            size="sm"
            variant="outline"
            tooltip
            ariaLabel={t("common.edit")}
            icon={<Pencil />}
            round
            onClick={(event) => {
              event.stopPropagation();
              handleEdit(p);
            }}
          />
          <IconButton
            size="sm"
            variant="ghost"
            tooltip
            ariaLabel={
              p.is_active
                ? isAr
                  ? "تعطيل الصنف"
                  : "Deactivate"
                : isAr
                  ? "تفعيل الصنف"
                  : "Activate"
            }
            icon={
              <Power className={cn("text-emerald-500", !p.is_active && "text-muted-foreground")} />
            }
            round
            onClick={(event) => {
              event.stopPropagation();
              toggleMutation.mutate({ id: p.id, active: !p.is_active });
            }}
          />
        </div>
      ),
    });

    return cols;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [col, isAr, t]);

  /* ---- card markup — same design language as /products cards ---- */
  const renderCard = (p: CustodyProduct) => {
    const primary = (isAr ? p.name_ar || p.name : p.name || p.name_ar) ?? "—";
    const Icon = classIcon(p.item_class);
    return (
      <div
        className={cn(
          "card-mullak group relative overflow-hidden rounded-2xl p-3 sm:p-4.5 flex flex-col justify-between h-full border transition-all duration-200 hover:shadow-md",
          p.is_active
            ? "border-r-4 border-r-emerald-500 hover:border-primary/50 shadow-emerald-500/5"
            : "border-r-4 border-r-muted-foreground/40 hover:border-border",
        )}
      >
        {/* شارة النوع + الحالة + نسخ الرمز */}
        <div className="flex items-center justify-between gap-1.5 mb-2">
          <div className="flex items-center gap-1 min-w-0">
            {col.role && (
              <span
                className={cn(
                  "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] sm:text-[11px] font-semibold truncate max-w-[110px] sm:max-w-[140px]",
                  classColor(p.item_class),
                )}
              >
                <Tag className="size-2.5 sm:size-3 shrink-0" />
                <span className="truncate">{classLabel(p.item_class)}</span>
              </span>
            )}
          </div>

          <div className="flex items-center gap-1">
            {col.sku && p.sku ? (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  navigator.clipboard.writeText(p.sku);
                  setCopiedSku(p.id);
                  setTimeout(() => setCopiedSku(null), 2000);
                  toast.success(isAr ? "تم نسخ رمز الصنف" : "SKU copied");
                }}
                className="inline-flex items-center gap-1 rounded-md bg-surface-2 px-1.5 py-0.5 font-mono text-[9px] sm:text-[10px] text-muted-foreground border border-border/60 hover:text-primary transition"
                title={isAr ? "اضغط لنسخ الرمز" : "Click to copy SKU"}
              >
                <Barcode className="size-2.5 sm:size-3" />
                <span className="truncate max-w-[65px] sm:max-w-[85px]">{p.sku}</span>
              </button>
            ) : null}
            <span
              className={cn(
                "size-2 shrink-0 rounded-full",
                p.is_active
                  ? "bg-emerald-500 ring-2 ring-emerald-500/20"
                  : "bg-muted-foreground/40",
              )}
              title={p.is_active ? t("common.active") : t("common.inactive")}
            />
          </div>
        </div>

        {/* الاسم */}
        <div className="mb-2 flex items-start gap-2">
          <div
            className={cn(
              "grid size-9 shrink-0 place-items-center rounded-xl border",
              classColor(p.item_class),
            )}
          >
            <Icon className="size-4" />
          </div>
          <h4
            className="font-bold text-foreground text-xs sm:text-sm leading-snug line-clamp-2 group-hover:text-primary transition-colors pt-1.5"
            dir={isAr ? "rtl" : "ltr"}
          >
            {primary}
          </h4>
        </div>

        {/* سعة العبوة */}
        <div className="flex flex-wrap items-center gap-1 mb-2.5 text-[10px] text-muted-foreground">
          {col.package_weight_kg && p.package_weight_kg ? (
            <span className="inline-flex items-center gap-1 rounded-md bg-primary/10 text-primary border border-primary/20 px-2 py-0.5 text-[10px] font-bold font-mono">
              <Scale className="size-2.5" />
              {qtyCell(p.package_weight_kg)} {isAr ? "كجم" : "kg"}
            </span>
          ) : null}
        </div>

        {/* الحالة + الإجراءات */}
        <div className="pt-2 border-t border-border/60 flex items-center justify-between gap-1.5 mt-auto">
          <StatusBadge tone={p.is_active ? "success" : "neutral"} dot>
            {p.is_active ? t("common.active") : t("common.inactive")}
          </StatusBadge>
          <div className="flex items-center gap-1 shrink-0">
            <IconButton
              size="sm"
              variant="ghost"
              tooltip
              ariaLabel={
                p.is_active
                  ? isAr
                    ? "تعطيل الصنف"
                    : "Deactivate"
                  : isAr
                    ? "تفعيل الصنف"
                    : "Activate"
              }
              icon={
                <Power
                  className={cn(
                    "size-3.5",
                    p.is_active ? "text-emerald-500" : "text-muted-foreground",
                  )}
                />
              }
              round
              onClick={(event) => {
                event.stopPropagation();
                toggleMutation.mutate({ id: p.id, active: !p.is_active });
              }}
            />
            <IconButton
              size="sm"
              variant="outline"
              tooltip
              ariaLabel={t("common.edit")}
              icon={<Pencil className="size-3.5" />}
              round
              onClick={(event) => {
                event.stopPropagation();
                handleEdit(p);
              }}
            />
          </div>
        </div>
      </div>
    );
  };

  /* ---- list row markup — same design language as /products rows ---- */
  const renderListRow = (p: CustodyProduct) => {
    const primary = (isAr ? p.name_ar || p.name : p.name || p.name_ar) ?? "—";
    const Icon = classIcon(p.item_class);
    const barColor = p.is_active
      ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.4)]"
      : "bg-muted-foreground/30";

    return (
      <div className="card-mullak group relative flex flex-col md:flex-row md:items-center justify-between gap-3 p-3.5 sm:p-4 rounded-2xl border transition-all duration-200 hover:border-primary/50 hover:shadow-md">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <span aria-hidden className={cn("h-11 sm:h-12 w-1.5 shrink-0 rounded-full", barColor)} />
          <div
            className={cn(
              "grid size-11 shrink-0 place-items-center rounded-xl border transition-all group-hover:scale-105",
              classColor(p.item_class),
            )}
          >
            <Icon className="size-5" />
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h4
                className="font-bold text-foreground text-sm sm:text-base leading-snug truncate group-hover:text-primary transition-colors"
                dir={isAr ? "rtl" : "ltr"}
              >
                {primary}
              </h4>
              {col.role && (
                <span
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold shrink-0",
                    classColor(p.item_class),
                  )}
                >
                  <Tag className="size-2.5" />
                  <span>{classLabel(p.item_class)}</span>
                </span>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2 mt-1 text-[11px] text-muted-foreground">
              {col.sku && p.sku ? (
                <span className="inline-flex items-center gap-1 rounded-md bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] border border-border/50">
                  <Barcode className="size-2.5" />
                  <span>{p.sku}</span>
                </span>
              ) : null}
              {col.package_weight_kg && p.package_weight_kg ? (
                <span className="inline-flex items-center gap-1 rounded-md bg-surface-2 px-1.5 py-0.5 font-mono text-[10px]">
                  <Scale className="size-2.5" />
                  {qtyCell(p.package_weight_kg)} {isAr ? "كجم" : "kg"}
                </span>
              ) : null}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3 sm:gap-4 shrink-0 text-xs ps-4 md:ps-0">
          {col.is_active && (
            <StatusBadge tone={p.is_active ? "success" : "neutral"} dot>
              {p.is_active ? t("common.active") : t("common.inactive")}
            </StatusBadge>
          )}
        </div>

        <div className="flex items-center justify-between md:justify-end gap-3 pt-2 md:pt-0 border-t md:border-t-0 border-border/50 shrink-0 ps-4 md:ps-0">
          <div className="flex items-center gap-1">
            <IconButton
              size="sm"
              variant="ghost"
              tooltip
              ariaLabel={
                p.is_active
                  ? isAr
                    ? "تعطيل الصنف"
                    : "Deactivate"
                  : isAr
                    ? "تفعيل الصنف"
                    : "Activate"
              }
              icon={
                <Power
                  className={cn(
                    "size-3.5",
                    p.is_active ? "text-emerald-500" : "text-muted-foreground",
                  )}
                />
              }
              round
              onClick={(event) => {
                event.stopPropagation();
                toggleMutation.mutate({ id: p.id, active: !p.is_active });
              }}
            />
            <IconButton
              size="sm"
              variant="outline"
              tooltip
              ariaLabel={t("common.edit")}
              icon={<Pencil className="size-3.5" />}
              round
              onClick={(event) => {
                event.stopPropagation();
                handleEdit(p);
              }}
            />
          </div>
        </div>
      </div>
    );
  };

  const loadError = (
    <div className="card-mullak flex flex-col items-center justify-center space-y-3 p-12 text-center">
      <div className="grid size-14 place-items-center rounded-2xl bg-destructive/10 text-destructive">
        <AlertTriangle className="size-8" />
      </div>
      <h4 className="text-base font-bold text-foreground">
        {isAr ? "تعذر تحميل أصناف الأمانات" : "Unable to load custody items"}
      </h4>
      <p className="max-w-sm text-xs text-muted-foreground">
        {isAr
          ? "حدث خطأ أثناء تحميل الأصناف. حاول مرة أخرى."
          : "An error occurred while loading items. Please try again."}
      </p>
      <Button size="sm" variant="outline" onClick={() => void refetch()}>
        {isAr ? "إعادة المحاولة" : "Retry"}
      </Button>
    </div>
  );

  const emptyState = (
    <RecordsEmpty
      icon={<Package className="size-8" />}
      title={
        query
          ? isAr
            ? `لا توجد أصناف تطابق «${query}»`
            : `No items match "${query}"`
          : tab === "raw"
            ? isAr
              ? "لم تُضف أنواع حبوب بعد"
              : "No grain types yet"
            : isAr
              ? "لم تُضف نواتج طحن بعد"
              : "No milled outputs yet"
      }
      description={
        isAr
          ? "ابدأ بإضافة أول صنف أمانة من هذا التبويب."
          : "Start by adding the first custody item from this tab."
      }
      action={
        <Button size="sm" icon={<Plus />} onClick={openNew}>
          {t("common.new")}
        </Button>
      }
    />
  );

  return (
    <ModuleGuard moduleId="milling_operations">
      <div className="space-y-4 pb-12">
        <PageHeader
          title={isAr ? "أصناف الأمانات" : "Custody Items"}
          subtitle={
            isAr
              ? "الحبوب الخام ونواتج الطحن المستخدمة في عمليات الأمانات"
              : "Raw grain and milled outputs used across custody operations"
          }
          actions={
            <Button
              variant="primary"
              size="sm"
              icon={<Plus className="size-4" />}
              onClick={openNew}
              className="rounded-xl font-bold shadow-xs shadow-primary/20"
            >
              {t("common.new")}
            </Button>
          }
        />

        {/* ─── Luxury Vortex KPI Metrics Cards (2 columns on mobile, 4 on desktop) ─── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-4">
          <VortexMetricCard
            title={isAr ? "إجمالي الأصناف" : "Total Items"}
            value={toSystemDigits(products.length)}
            currency=""
            subtitle={isAr ? "في دليل الأمانات" : "in custody catalogue"}
            icon={<Package className="size-5" />}
            iconClassName="bg-primary/10 text-primary border border-primary/20"
            badge={isAr ? "الكتالوج" : "Catalog"}
            onClick={() => setQuickFilter("all")}
            highlight={quickFilter === "all"}
            className="cursor-pointer"
          />
          <VortexMetricCard
            title={isAr ? "أنواع الحبوب" : "Grain Types"}
            value={toSystemDigits(rawCount)}
            currency=""
            subtitle={isAr ? "حبوب خام مستلمة" : "raw grain received"}
            icon={<Wheat className="size-5" />}
            iconClassName="bg-amber-500/10 text-amber-500 border border-amber-500/20"
            badge={isAr ? "خام" : "Raw"}
            onClick={() => setTab("raw")}
            highlight={tab === "raw"}
            className="cursor-pointer"
          />
          <VortexMetricCard
            title={isAr ? "نواتج الطحن" : "Milled Outputs"}
            value={toSystemDigits(outputCount)}
            currency=""
            subtitle={isAr ? "جاهزة للتسليم" : "ready for delivery"}
            icon={<Factory className="size-5" />}
            iconClassName="bg-emerald-500/10 text-emerald-500 border border-emerald-500/20"
            badge={isAr ? "نواتج" : "Outputs"}
            onClick={() => setTab("output")}
            highlight={tab === "output"}
            className="cursor-pointer"
          />
          <VortexMetricCard
            title={isAr ? "الأصناف النشطة" : "Active Items"}
            value={toSystemDigits(activeCount)}
            currency=""
            subtitle={
              products.length > 0
                ? `${toSystemDigits(Math.round((activeCount / products.length) * 100))}% ${isAr ? "متاح للتشغيل" : "operational"}`
                : isAr
                  ? "متاح للتشغيل"
                  : "operational"
            }
            icon={
              inactiveCount > 0 ? (
                <Layers className="size-5" />
              ) : (
                <CheckCircle2 className="size-5" />
              )
            }
            iconClassName="bg-blue-500/10 text-blue-500 border border-blue-500/20"
            badge={
              inactiveCount > 0
                ? `${toSystemDigits(inactiveCount)} ${isAr ? "معطّل" : "off"}`
                : undefined
            }
            onClick={() => setQuickFilter("active")}
            highlight={quickFilter === "active"}
            className="cursor-pointer"
          />
        </div>

        {/* ─── تبويبات نوع الأمانة ─── */}
        <SegmentedTabs<TabValue>
          value={tab}
          onChange={setTab}
          ariaLabel="تبويبات أصناف الأمانات"
          items={[
            {
              value: "raw",
              label: isAr ? "الحبوب الخام" : "Raw grain",
              icon: <Wheat className="h-3.5 w-3.5" />,
              badge: (
                <span className="mr-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-300">
                  {rawCount}
                </span>
              ),
            },
            {
              value: "output",
              label: isAr ? "النواتج المطحونة" : "Milled outputs",
              icon: <Factory className="h-3.5 w-3.5" />,
              badge: (
                <span className="mr-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:text-emerald-300">
                  {outputCount}
                </span>
              ),
            },
          ]}
        />

        {/* ─── Unified records toolbar: search + filters + sort + view + columns ─── */}
        <div className="pt-2 sm:pt-3.5">
          <RecordsToolbar
            searchValue={query}
            onSearchChange={setQuery}
            searchPlaceholder={
              isAr ? "ابحث بالاسم أو الكود أو الرمز" : "Search by name, code or SKU"
            }
            resultCount={sortedRows.length}
            searchLoading={isFetching && !isLoading}
            filterLabel={isAr ? "فلترة" : "Filter"}
            activeFilterCount={countActiveFilters(filters)}
            onFilterOpen={() => setFiltersOpen(true)}
            onClearFilters={() => setFilters({})}
            sortActive={Boolean(sort)}
            sortLabel={isAr ? "ترتيب" : "Sort"}
            onSortOpen={() => setSortOpen(true)}
            viewMode={viewMode}
            onViewModeChange={setViewMode}
            columns={productColumns.available}
            columnVisibility={productColumns.visibility}
            onToggleColumn={productColumns.toggle}
            onResetColumns={productColumns.reset}
            action={
              <PrimaryAction
                label={isAr ? "صنف جديد" : "New item"}
                icon={<Plus className="size-4" />}
                onClick={openNew}
              />
            }
          >
            <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 scrollbar-x-none">
              {(
                [
                  { id: "all", label: isAr ? "الكل" : "All", count: tabRows.length },
                  { id: "active", label: isAr ? "النشطة" : "Active", count: activeCount },
                  {
                    id: "inactive",
                    label: isAr ? "غير النشطة" : "Inactive",
                    count: inactiveCount,
                  },
                ] as { id: QuickFilter; label: string; count: number }[]
              ).map((filter) => (
                <button
                  key={filter.id}
                  type="button"
                  onClick={() => setQuickFilter(filter.id)}
                  aria-pressed={quickFilter === filter.id}
                  className={quietChipClass(quickFilter === filter.id, "font-semibold")}
                >
                  <span>{filter.label}</span>
                  <span
                    className={cn(
                      "rounded-full px-1.5 py-0.5 text-[10px] font-mono",
                      quickFilter === filter.id
                        ? "bg-primary/18 text-primary"
                        : "bg-muted text-muted-foreground",
                    )}
                  >
                    {filter.count}
                  </span>
                </button>
              ))}
            </div>
          </RecordsToolbar>

          <RecordsFilterPanel
            open={filtersOpen}
            onClose={() => setFiltersOpen(false)}
            definitions={filterDefinitions}
            values={filters}
            onSubmit={(next) => {
              setFilters(next);
              setFiltersOpen(false);
            }}
          />
          <RecordsSortPanel
            open={sortOpen}
            onClose={() => setSortOpen(false)}
            options={sortOptions}
            value={sort?.key ?? ""}
            onSubmit={(value) => {
              setSort(value ? { key: value, direction: sort?.direction ?? "asc" } : null);
              setSortOpen(false);
            }}
          />
        </div>

        {/* ─── Main Records View: cards / list / table ─── */}
        {viewMode === "cards" ? (
          <div className="space-y-4">
            {isLoading ? (
              <RecordsSkeleton mode="cards" />
            ) : error && products.length === 0 ? (
              loadError
            ) : sortedRows.length === 0 ? (
              emptyState
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5 gap-2.5 sm:gap-4">
                {sortedRows.map((p) => (
                  <div
                    key={p.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => setDetail(p)}
                    onKeyDown={(e) => {
                      if (e.key !== "Enter" && e.key !== " ") return;
                      if (e.target !== e.currentTarget) return;
                      e.preventDefault();
                      setDetail(p);
                    }}
                    className="cursor-pointer rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                  >
                    {renderCard(p)}
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : viewMode === "list" ? (
          <div className="space-y-3">
            {isLoading ? (
              <RecordsSkeleton mode="list" />
            ) : error && products.length === 0 ? (
              loadError
            ) : sortedRows.length === 0 ? (
              emptyState
            ) : (
              <div className="space-y-2.5">
                {sortedRows.map((p) => (
                  <div
                    key={p.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => setDetail(p)}
                    onKeyDown={(e) => {
                      if (e.key !== "Enter" && e.key !== " ") return;
                      if (e.target !== e.currentTarget) return;
                      e.preventDefault();
                      setDetail(p);
                    }}
                    className="cursor-pointer rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                  >
                    {renderListRow(p)}
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="panel-elevated -mx-1 sm:mx-0 overflow-hidden rounded-2xl border border-border/70">
            <DataTable
              className="px-0"
              columns={dataColumns}
              rows={sortedRows}
              rowKey={(p) => p.id}
              loading={isLoading}
              initialLoading={isLoading}
              refreshing={isFetching && !isLoading}
              error={(error as Error) ?? null}
              onRetry={() => void refetch()}
              sort={sort}
              onSortChange={setSort}
              totalCount={sortedRows.length}
              minWidth={760}
              horizontalScroll={tableUsesHorizontalScroll}
              stickyHeader
              onRowClick={(p) => setDetail(p)}
              empty={{
                icon: <Package />,
                title: isAr ? "لا توجد أصناف" : "No items",
                description: isAr
                  ? "ابدأ بإضافة أول صنف أمانة."
                  : "Start by adding the first custody item.",
                action: (
                  <Button size="sm" icon={<Plus />} onClick={openNew}>
                    {t("common.new")}
                  </Button>
                ),
              }}
            />
          </div>
        )}

        {/* ─── Detail sheet — same identity as the products detail drawer ─── */}
        <Sheet
          open={Boolean(detail)}
          onOpenChange={(isOpen) => {
            if (!isOpen) setDetail(null);
          }}
        >
          <SheetContent
            side="left"
            className="w-full sm:max-w-md p-0 flex flex-col h-full bg-background/95 backdrop-blur-xl border-s border-border/80 shadow-2xl overflow-hidden"
            dir={isAr ? "rtl" : "ltr"}
          >
            {detail && (
              <>
                <div className="absolute -top-12 -right-12 size-48 rounded-full bg-primary/15 blur-3xl pointer-events-none" />
                <div className="shrink-0 p-5 sm:p-6 border-b border-border/60 bg-muted/20">
                  <div className="flex items-center gap-3.5 min-w-0">
                    <div
                      className={cn(
                        "grid size-13 shrink-0 place-items-center rounded-2xl border shadow-xs",
                        classColor(detail.item_class),
                      )}
                    >
                      {(() => {
                        const Icon = classIcon(detail.item_class);
                        return <Icon className="size-6 stroke-[2.2]" />;
                      })()}
                    </div>
                    <div className="min-w-0">
                      <SheetTitle className="text-lg font-black text-foreground tracking-tight leading-snug">
                        {(isAr ? detail.name_ar || detail.name : detail.name || detail.name_ar) ??
                          "—"}
                      </SheetTitle>
                      <div className="mt-1 flex items-center gap-2 flex-wrap">
                        <span
                          className={cn(
                            "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold",
                            classColor(detail.item_class),
                          )}
                        >
                          <Tag className="size-2.5" />
                          {classLabel(detail.item_class)}
                        </span>
                        <StatusBadge tone={detail.is_active ? "success" : "neutral"} dot>
                          {detail.is_active ? t("common.active") : t("common.inactive")}
                        </StatusBadge>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    <DetailTile
                      icon={<Scale className="size-4" />}
                      label={isAr ? "سعة العبوة" : "Package weight"}
                      value={
                        detail.package_weight_kg
                          ? `${qtyCell(detail.package_weight_kg)} ${isAr ? "كجم" : "kg"}`
                          : "—"
                      }
                    />
                    <DetailTile
                      icon={<Barcode className="size-4" />}
                      label={isAr ? "رمز الصنف" : "SKU"}
                      value={detail.sku || "—"}
                      mono
                    />
                    <DetailTile
                      icon={<Boxes className="size-4" />}
                      label={isAr ? "سعر البيع" : "Sale price"}
                      value={moneyCell(detail.sale_price)}
                    />
                    <DetailTile
                      icon={<Layers className="size-4" />}
                      label={isAr ? "تصنيف الصنف" : "Item class"}
                      value={classLabel(detail.item_class)}
                    />
                  </div>

                  <div className="flex items-center gap-2 pt-2">
                    <Button
                      size="sm"
                      variant="primary"
                      icon={<Pencil className="size-4" />}
                      onClick={() => {
                        handleEdit(detail);
                        setDetail(null);
                      }}
                    >
                      {t("common.edit")}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      icon={<Power className="size-4" />}
                      onClick={() =>
                        toggleMutation.mutate({ id: detail.id, active: !detail.is_active })
                      }
                    >
                      {detail.is_active
                        ? isAr
                          ? "تعطيل"
                          : "Deactivate"
                        : isAr
                          ? "تفعيل"
                          : "Activate"}
                    </Button>
                    {detail.sku ? (
                      <IconButton
                        size="md"
                        variant="ghost"
                        tooltip
                        ariaLabel={isAr ? "نسخ الرمز" : "Copy SKU"}
                        icon={copiedSku === detail.id ? <Copy /> : <CheckCircle2 />}
                        onClick={() => {
                          navigator.clipboard.writeText(detail.sku);
                          setCopiedSku(detail.id);
                          setTimeout(() => setCopiedSku(null), 2000);
                          toast.success(isAr ? "تم نسخ رمز الصنف" : "SKU copied");
                        }}
                      />
                    ) : null}
                  </div>
                </div>
              </>
            )}
          </SheetContent>
        </Sheet>

        {/* ─── Toast-ish progress for the status toggle ─── */}
        {toggleMutation.isPending && (
          <div className="pointer-events-none fixed bottom-4 start-4 z-40 inline-flex items-center gap-2 rounded-full border border-border/70 bg-background/85 px-3 py-1.5 text-[11px] text-muted-foreground shadow-sm backdrop-blur">
            <Loader2 className="size-3 animate-spin" />
            {isAr ? "جارِ التحديث…" : "Updating…"}
          </div>
        )}

        {/* ─── Dialog ─── */}
        <CustodyProductFormDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          defaultClass={dialogDefaultClass}
          editing={editingProduct}
        />
      </div>
    </ModuleGuard>
  );
}

/* --------------------------------------------------------- detail tile -- */

function DetailTile({
  icon,
  label,
  value,
  mono = false,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="card-mullak rounded-xl border border-border/60 p-3">
      <div className="flex items-center gap-1.5 text-[10px] font-semibold text-muted-foreground">
        {icon}
        <span>{label}</span>
      </div>
      <p
        className={cn(
          "mt-1 text-sm font-bold text-foreground truncate",
          mono && "font-mono text-xs",
        )}
      >
        {value}
      </p>
    </div>
  );
}

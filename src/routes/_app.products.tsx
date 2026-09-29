import {
  VortexDrawerDialog,
  VortexTextInput,
  VortexCurrencyInput,
  VortexNumberInput,
} from "@/components/vortex-ui";
import { useModules } from "@/lib/modules";
import { createFileRoute } from "@tanstack/react-router";
import { useInfiniteQuery, useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/page-header";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import { useCatalogModules } from "@/lib/catalog-modules";
import { CatalogModulesDialog } from "@/components/catalog-modules-dialog";
import { BarcodeScanner } from "@/components/barcode-scanner";
import { useKeyboardWedge } from "@/hooks/use-keyboard-wedge";
import {
  Plus,
  Package,
  Pencil,
  Trash2,
  SlidersHorizontal,
  Settings,
  ExternalLink,
  Power,
  Camera,
  ScanBarcode,
  LayoutGrid,
  List,
  TableProperties,
  Boxes,
  CheckCircle2,
  AlertTriangle,
  Layers,
  Tag,
  Barcode,
  MapPin,
  Sparkles,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import {
  deleteProductSafely,
  setProductActive,
  describeReferences,
  isHistoryOnly,
  type DeleteOutcome,
  type ReferenceCounts,
} from "@/lib/safety";
import { fuzzySearch, buildSearchIndex } from "@/design/fuzzy";
import { moneyCell, qtyCell } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { FieldInput, NumberInput, fieldSurfaceClass } from "@/components/ui/input";
import { FormField } from "@/components/ui/form-field";
import { FormActions, FormGrid, FormSection } from "@/components/ui/form-layout";
import { Modal, ConfirmDialog } from "@/components/ui/modal";
import { DataTable, type DataTableColumn, type DataTableSort } from "@/components/ui/data-table";
import {
  TableToolbar,
  ToolbarAction,
  applyFilters,
  type FilterDefinition,
  type FilterValues,
  type SortOption,
} from "@/components/ui/table-toolbar";
import { StatusBadge } from "@/components/ui/status-badge";
import { useBreakpoint } from "@/design/breakpoints";
import { useRealtimeTable } from "@/lib/realtime";
import { QUERY_KEYS } from "@/lib/query-keys";
import {
  DEFAULT_USER_ITEM_POLICY_PREFERENCES,
  readUserItemPolicyPreferences,
  saveUserItemPolicyPreferences,
  type UserItemPolicyPreferences,
} from "@/lib/items/user-policy-preferences";
import {
  COSTING_METHOD_LABELS,
  INVENTORY_POLICY_LABELS,
  ITEM_NATURE_LABELS,
  TRACKING_LABELS,
  type CostingMethod,
  type InventoryPolicy,
  type ItemNature,
  type ItemTracking,
} from "@/lib/items";

export const Route = createFileRoute("/_app/products")({
  head: () => ({ meta: [{ title: "المنتجات — فورتيكس ERP" }] }),
  validateSearch: (search: Record<string, unknown>) => ({
    barcode: typeof search.barcode === "string" ? search.barcode : undefined,
  }),
  component: ProductsPage,
});

const PRODUCTS_PAGE_SIZE = 50;

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
  origin?: { id: string; name: string; name_ar: string | null; code: string } | null;
  quality?: {
    id: string;
    name: string;
    name_ar: string | null;
    code: string;
    sort_order?: number;
  } | null;
  item_nature?: ItemNature;
  inventory_policy?: InventoryPolicy;
  tracking?: ItemTracking;
  costing_method?: CostingMethod;
  is_sellable?: boolean;
  is_purchasable?: boolean;
};

/** Neutral reference counts — used before the guard has answered. */
const EMPTY_COUNTS: ReferenceCounts = {
  salesItems: 0,
  purchaseItems: 0,
  salesReturns: 0,
  purchaseReturns: 0,
  transfers: 0,
  stockMovements: 0,
  inventoryRows: 0,
  compatibilities: 0,
  blockingTotal: 0,
  canDelete: false,
  hasHistory: false,
};

function ProductsPage() {
  const { checkQuota } = useModules();
  const { t, lang } = useI18n();
  const { config } = useCatalogModules();
  const { isModuleEnabled } = useModules();
  const { user, hasRole, isPlatformAdmin, isPlatformSuperadmin } = useAuth();
  const canViewCost =
    isPlatformAdmin ||
    isPlatformSuperadmin ||
    hasRole("owner") ||
    hasRole("manager") ||
    hasRole("accountant");
  const qc = useQueryClient();
  const searchParams = Route.useSearch();
  const breakpoint = useBreakpoint();
  const tableUsesHorizontalScroll =
    breakpoint === "xs" || breakpoint === "sm" || breakpoint === "md";
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<FilterValues>({});
  const [sort, setSort] = useState<DataTableSort | null>(null);
  const [editing, setEditing] = useState<ProductRow | null>(null);
  const [open, setOpen] = useState(false);
  const [prefillBarcode, setPrefillBarcode] = useState<string | undefined>(undefined);
  const [quickFilter, setQuickFilter] = useState<"all" | "active" | "inactive" | "low_stock">(
    "all",
  );
  const [viewMode, setViewMode] = useState<"grid" | "list" | "table">("grid");
  const [showFilters, setShowFilters] = useState(false);

  const [confirmDelete, setConfirmDelete] = useState<ProductRow | null>(null);
  /** Set when a delete was refused because the product has history. */
  const [blockedDelete, setBlockedDelete] = useState<{
    product: ProductRow | null;
    counts: ReferenceCounts;
  } | null>(null);

  const {
    data: productPages,
    isLoading,
    error,
    refetch,
    fetchNextPage,
    hasNextPage,
    isFetching,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: QUERY_KEYS.products,
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      const from = pageParam * PRODUCTS_PAGE_SIZE;
      const to = from + PRODUCTS_PAGE_SIZE - 1;
      // Keep the primary product query independent from optional catalog
      // relationships. A missing/incorrect foreign-key relationship must not
      // hide otherwise valid product rows from the catalogue.
      const { data: page, error: productError } = await (supabase.from("products") as any)
        .select(
          "id, name, name_ar, sku, barcode, sale_price, cost_price, tax_rate, min_stock, shelf_location, origin_id, quality_grade_id, is_active, category_id, brand_id, unit_id, created_at",
        )
        .order("created_at", { ascending: false })
        .range(from, to);

      if (productError) throw productError;

      const rows = (page ?? []) as ProductRow[];
      return { rows, hasMore: rows.length === PRODUCTS_PAGE_SIZE };
    },
    getNextPageParam: (lastPage, pages) => (lastPage.hasMore ? pages.length : undefined),
    // Data inserted from the CLI or another session must be fetched when the
    // products route becomes visible again, not only when realtime is enabled.
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
  });

  // The stream intentionally receives fifty rows at a time. The total must come
  // from the database separately so the number beside search never pretends that
  // the first page is the whole catalogue.
  const { data: productCount } = useQuery({
    queryKey: ["products", "count"],
    queryFn: async () => {
      const { count, error: countError } = await (supabase.from("products") as any).select("id", {
        count: "exact",
        head: true,
      });
      if (countError) throw countError;
      return count ?? 0;
    },
    staleTime: 30_000,
  });

  const products = useMemo(
    () => productPages?.pages.flatMap((page) => page.rows) ?? [],
    [productPages],
  );

  useRealtimeTable<ProductRow>(
    {
      table: "products",
      queryKey: QUERY_KEYS.products,
      debounceMs: 100,
    },
    qc,
  );

  useEffect(() => {
    if (!searchParams.barcode) return;
    setEditing(null);
    setPrefillBarcode(searchParams.barcode);
    setOpen(true);
  }, [searchParams.barcode]);

  const { data: meta } = useQuery({
    queryKey: ["products-meta"],
    queryFn: async () => {
      const [c, b, u, origins, qualities] = await Promise.all([
        supabase.from("categories").select("id, name, name_ar").order("name"),
        supabase.from("brands").select("id, name, name_ar").order("name"),
        supabase.from("units").select("id, name, name_ar, short_name").order("name"),
        (supabase as any)
          .from("countries_of_origin")
          .select("id, code, name, name_ar")
          .order("name"),
        (supabase as any)
          .from("quality_grades")
          .select("id, code, name, name_ar, sort_order")
          .order("sort_order"),
      ]);
      return {
        categories: c.data ?? [],
        brands: b.data ?? [],
        units: u.data ?? [],
        origins: origins.data ?? [],
        qualities: qualities.data ?? [],
      };
    },
  });

  // Typo-tolerant, Arabic-normalised search index (see `src/design/fuzzy.ts`).
  const searchIndex = useMemo(
    () => buildSearchIndex(products ?? [], (p) => [p.name, p.name_ar, p.sku, p.barcode]),
    [products],
  );

  const searched = useMemo(() => {
    if (!products) return [];
    const q = query.trim();
    if (!q) return products;
    return fuzzySearch(searchIndex, q, { threshold: 0.55, requireAll: true }).map((m) => m.item);
  }, [products, query, searchIndex]);

  // Structured filters, applied client-side over the rows already fetched.
  const filtered = useMemo(
    () =>
      applyFilters(searched, filters, {
        category: (p) => p.category_id ?? "",
        brand: (p) => p.brand_id ?? "",
        unit: (p) => p.unit_id ?? "",
        origin: (p) => p.origin_id ?? "",
        status: (p) => (p.is_active ? "active" : "inactive"),
      }),
    [searched, filters],
  );

  const displayRows = useMemo(() => {
    return filtered.filter((p) => {
      if (quickFilter === "active") return Boolean(p.is_active);
      if (quickFilter === "inactive") return !p.is_active;
      if (quickFilter === "low_stock") return p.min_stock != null && Number(p.min_stock) > 0;
      return true;
    });
  }, [filtered, quickFilter]);

  // Luxury KPI calculations
  const { totalProducts, activeCount, inactiveCount, lowStockCount, categoriesCount, brandsCount } =
    useMemo(() => {
      let active = 0;
      let inactive = 0;
      let lowStock = 0;
      for (const p of products) {
        if (p.is_active) active++;
        else inactive++;
        if (p.min_stock != null && Number(p.min_stock) > 0) lowStock++;
      }
      return {
        totalProducts: productCount ?? products.length,
        activeCount: active,
        inactiveCount: inactive,
        lowStockCount: lowStock,
        categoriesCount: meta?.categories?.length ?? 0,
        brandsCount: meta?.brands?.length ?? 0,
      };
    }, [products, productCount, meta]);

  /* ---------------- filter + sort definitions (localized) ---------------- */
  const productFilterDefinitions = useMemo<FilterDefinition[]>(() => {
    const defs: FilterDefinition[] = [
      {
        key: "status",
        label: lang === "ar" ? "الحالة" : "Status",
        type: "select",
        options: [
          { value: "active", label: t("common.active") },
          { value: "inactive", label: t("common.inactive") },
        ],
      },
    ];

    if (meta?.categories?.length) {
      defs.push({
        key: "category",
        label: t("products.category"),
        type: "select",
        options: meta.categories.map((c) => ({
          value: c.id,
          label: (lang === "ar" ? c.name_ar || c.name : c.name || c.name_ar) ?? c.name,
        })),
      });
    }
    if (config.enableBrands && meta?.brands?.length) {
      defs.push({
        key: "brand",
        label: t("products.brand"),
        type: "select",
        options: meta.brands.map((b) => ({
          value: b.id,
          label: (lang === "ar" ? b.name_ar || b.name : b.name || b.name_ar) ?? b.name,
        })),
      });
    }
    if (config.enableUnits && meta?.units?.length) {
      defs.push({
        key: "unit",
        label: t("products.unit"),
        type: "select",
        options: meta.units.map((u) => ({
          value: u.id,
          label: (lang === "ar" ? u.name_ar || u.name : u.name || u.name_ar) ?? u.name,
        })),
      });
    }
    if (config.enableOrigins && meta?.origins?.length) {
      defs.push({
        key: "origin",
        label: lang === "ar" ? "بلد المنشأ" : "Origin",
        type: "select",
        options: meta.origins.map(
          (o: { id: string; name: string; name_ar: string | null; code: string }) => ({
            value: o.id,
            label: `${o.name_ar || o.name} (${o.code})`,
          }),
        ),
      });
    }

    return defs;
  }, [meta, config, lang, t]);

  const productSortOptions = useMemo<SortOption[]>(
    () => [
      { value: "", label: lang === "ar" ? "الافتراضي (الأحدث)" : "Default (newest)" },
      { value: "name", label: lang === "ar" ? "الاسم" : "Name" },
      { value: "sku", label: t("products.sku") },
      { value: "sale_price", label: t("common.price") },
      ...(canViewCost ? [{ value: "cost_price", label: t("common.cost") }] : []),
      { value: "min_stock", label: t("products.min") },
    ],
    [lang, t, canViewCost],
  );

  /**
   * Guarded delete.
   *
   * A product referenced by an invoice, return, transfer or stock movement is
   * NEVER deleted — the schema cascades to `inventory`/`stock_movements`, so a
   * naive delete would silently destroy that history. Instead the UI offers to
   * deactivate (which only flips `is_active` on that one row).
   */
  const remove = useMutation({
    mutationFn: async (id: string) => {
      const outcome = await deleteProductSafely(id);
      if (outcome.status === "deleted") return outcome;
      // Signal the UI without throwing a raw Postgres error at the user.
      throw Object.assign(new Error("delete-blocked"), { outcome });
    },
    onSuccess: () => {
      toast.success(lang === "ar" ? "تم حذف المنتج بنجاح" : t("products.deleted"));
      qc.invalidateQueries({ queryKey: ["products"] });
    },
    onError: (e: Error & { outcome?: DeleteOutcome }) => {
      const outcome = e.outcome;
      if (outcome?.status === "blocked") {
        setBlockedDelete({ product: null, counts: outcome.counts });
        return;
      }
      if (outcome?.status === "forbidden") {
        toast.error(lang === "ar" ? "ليس لديك صلاحية حذف المنتجات" : "You cannot delete products");
        return;
      }
      toast.error(e.message);
    },
  });

  const label = (en?: string | null, ar?: string | null) =>
    (lang === "ar" ? ar || en : en || ar) ?? "—";

  /* ---------------- columns ---------------- */
  const columns = useMemo<DataTableColumn<ProductRow>[]>(() => {
    const cols: DataTableColumn<ProductRow>[] = [
      {
        key: "name",
        header: t("products.product"),
        sortable: true,
        width: "w-[240px]",
        sortValue: (p) => (lang === "ar" ? p.name_ar || p.name : p.name || p.name_ar) ?? "",
        cell: (p) => {
          const primary = lang === "ar" ? p.name_ar || p.name : p.name || p.name_ar || "—";
          const other = lang === "ar" ? p.name : p.name_ar;
          const secondary = other && other.trim() && other.trim() !== primary.trim() ? other : null;
          return (
            <div className="flex flex-col py-0.5">
              <span
                className="font-semibold text-foreground text-sm leading-snug truncate"
                dir={lang === "ar" ? "rtl" : "ltr"}
              >
                {primary}
              </span>
              {secondary ? (
                <span
                  className="text-[11px] text-muted-foreground truncate"
                  dir={lang === "ar" ? "ltr" : "rtl"}
                >
                  {secondary}
                </span>
              ) : null}
            </div>
          );
        },
      },
      {
        key: "category",
        header: t("products.category"),
        sortable: true,
        width: "w-[140px]",
        sortValue: (p) => label(p.category?.name, p.category?.name_ar),
        cell: (p) => (
          <span className="text-xs text-muted-foreground truncate block">
            {label(p.category?.name, p.category?.name_ar)}
          </span>
        ),
      },
    ];

    cols.push({
      key: "shelf_location",
      header: lang === "ar" ? "الرف" : "Shelf",
      width: "w-[110px]",
      cell: (p) => (
        <span className="font-mono text-xs text-muted-foreground">{p.shelf_location ?? "—"}</span>
      ),
    });

    if (canViewCost) {
      cols.push({
        key: "cost_price",
        header: t("common.cost"),
        align: "end",
        sortable: true,
        width: "w-[124px]",
        sortValue: (p) => Number(p.cost_price),
        cell: (p) => (
          <span className="font-mono text-xs tabular-nums text-muted-foreground">
            {moneyCell(p.cost_price)}
          </span>
        ),
      });
    }

    cols.push(
      {
        key: "sale_price",
        header: t("common.price"),
        align: "end",
        sortable: true,
        width: "w-[124px]",
        sortValue: (p) => Number(p.sale_price),
        cell: (p) => (
          <span className="font-mono text-xs font-bold tabular-nums text-foreground">
            {moneyCell(p.sale_price)}
          </span>
        ),
      },
      {
        key: "min_stock",
        header: t("products.min"),
        align: "end",
        sortable: true,
        width: "w-[96px]",
        sortValue: (p) => Number(p.min_stock),
        cell: (p) => (
          <span className="font-mono text-xs tabular-nums text-muted-foreground">
            {qtyCell(p.min_stock)}
          </span>
        ),
      },
      {
        key: "is_active",
        header: t("common.status"),
        width: "w-[106px]",
        cell: (p) => (
          <StatusBadge tone={p.is_active ? "success" : "neutral"} dot>
            {p.is_active ? t("common.active") : t("common.inactive")}
          </StatusBadge>
        ),
      },
      {
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
                setEditing(p);
                setPrefillBarcode(undefined);
                setOpen(true);
              }}
            />
            <IconButton
              size="sm"
              variant="danger"
              tooltip
              ariaLabel={t("common.delete")}
              icon={<Trash2 />}
              round
              onClick={(event) => {
                event.stopPropagation();
                setConfirmDelete(p);
              }}
            />
          </div>
        ),
      },
    );

    return cols;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config, canViewCost, lang, t]);

  const openNew = () => {
    const qCheck = checkQuota("products", productCount ?? products.length);
    if (!qCheck.allowed) {
      toast.error(lang === "ar" ? qCheck.message?.ar : qCheck.message?.en);
      return;
    }
    setEditing(null);
    setPrefillBarcode(undefined);
    setOpen(true);
  };

  return (
    <div className="space-y-4 pb-12">
      <PageHeader title={t("products.title")} subtitle={t("products.subtitle")} />

      {/* ─── Luxury Mullak KPI Metrics Cards ─── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {/* Card 1: Total Products */}
        <div className="card-mullak relative overflow-hidden p-4 sm:p-5 flex items-center justify-between group">
          <div className="min-w-0">
            <p className="text-[11px] sm:text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              {lang === "ar" ? "إجمالي المنتجات" : "Total Products"}
            </p>
            <h3 className="mt-1 font-mono text-xl sm:text-2xl font-bold tracking-tight text-foreground">
              {totalProducts.toLocaleString()}
            </h3>
            <span className="mt-1 inline-flex items-center gap-1 text-[10px] text-muted-foreground/80">
              <Sparkles className="size-3 text-primary" />
              {lang === "ar" ? "في الدليل والكتالوج" : "in catalogue"}
            </span>
          </div>
          <div className="grid size-12 shrink-0 place-items-center rounded-2xl bg-primary/10 text-primary border border-primary/20 shadow-sm group-hover:scale-105 transition-transform">
            <Package className="size-6" />
          </div>
          <div className="absolute -left-6 -top-6 size-20 rounded-full bg-primary/10 blur-xl pointer-events-none" />
        </div>

        {/* Card 2: Active Products */}
        <div className="card-mullak relative overflow-hidden p-4 sm:p-5 flex items-center justify-between group">
          <div className="min-w-0">
            <p className="text-[11px] sm:text-xs font-semibold text-emerald-500/90 uppercase tracking-wider">
              {lang === "ar" ? "المنتجات النشطة" : "Active Products"}
            </p>
            <h3 className="mt-1 font-mono text-xl sm:text-2xl font-bold tracking-tight text-emerald-400">
              {activeCount.toLocaleString()}
            </h3>
            <span className="mt-1 inline-flex items-center gap-1 text-[10px] text-emerald-500/80">
              <CheckCircle2 className="size-3" />
              {totalProducts > 0
                ? `${Math.round((activeCount / totalProducts) * 100)}% متاح للبيع`
                : "متاح للبيع"}
            </span>
          </div>
          <div className="grid size-12 shrink-0 place-items-center rounded-2xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 shadow-sm group-hover:scale-105 transition-transform">
            <CheckCircle2 className="size-6" />
          </div>
          <div className="absolute -left-6 -top-6 size-20 rounded-full bg-emerald-500/10 blur-xl pointer-events-none" />
        </div>

        {/* Card 3: Categories & Brands */}
        <div className="card-mullak relative overflow-hidden p-4 sm:p-5 flex items-center justify-between group">
          <div className="min-w-0">
            <p className="text-[11px] sm:text-xs font-semibold text-blue-500/90 uppercase tracking-wider">
              {lang === "ar" ? "التصنيفات والماركات" : "Categories & Brands"}
            </p>
            <h3 className="mt-1 font-mono text-xl sm:text-2xl font-bold tracking-tight text-blue-400">
              {categoriesCount}{" "}
              <span className="text-sm font-normal text-muted-foreground">/ {brandsCount}</span>
            </h3>
            <span className="mt-1 inline-flex items-center gap-1 text-[10px] text-blue-500/80">
              <Layers className="size-3" />
              {lang === "ar" ? "تصنيف وماركة مسجلة" : "taxonomy groups"}
            </span>
          </div>
          <div className="grid size-12 shrink-0 place-items-center rounded-2xl bg-blue-500/10 text-blue-400 border border-blue-500/20 shadow-sm group-hover:scale-105 transition-transform">
            <Layers className="size-6" />
          </div>
          <div className="absolute -left-6 -top-6 size-20 rounded-full bg-blue-500/10 blur-xl pointer-events-none" />
        </div>

        {/* Card 4: Min Stock Alerts */}
        <div className="card-mullak relative overflow-hidden p-4 sm:p-5 flex items-center justify-between group">
          <div className="min-w-0">
            <p className="text-[11px] sm:text-xs font-semibold text-amber-500/90 uppercase tracking-wider">
              {lang === "ar" ? "حد الطلب الأدنى" : "Stock Alerts"}
            </p>
            <h3 className="mt-1 font-mono text-xl sm:text-2xl font-bold tracking-tight text-amber-400">
              {lowStockCount.toLocaleString()}
            </h3>
            <span className="mt-1 inline-flex items-center gap-1 text-[10px] text-amber-500/80">
              <Boxes className="size-3" />
              {lang === "ar" ? "منتج محدد بحد أدنى" : "monitored items"}
            </span>
          </div>
          <div className="grid size-12 shrink-0 place-items-center rounded-2xl bg-amber-500/10 text-amber-400 border border-amber-500/20 shadow-sm group-hover:scale-105 transition-transform">
            <Boxes className="size-6" />
          </div>
          <div className="absolute -left-6 -top-6 size-20 rounded-full bg-amber-500/10 blur-xl pointer-events-none" />
        </div>
      </div>

      {/* ─── Luxury Sticky Toolbar: Search + Filters + Sort + View Toggle (Grid / List / Classic Table) + New Product ─── */}
      <div className="pt-2 sm:pt-3.5">
        <TableToolbar
          sticky
          search={{
            value: query,
            onValueChange: setQuery,
            placeholder: "ابحث في المنتجات",
            resultCount: productCount ?? displayRows.length,
          }}
          filters={{
            definitions: productFilterDefinitions,
            values: filters,
            onValueChange: setFilters,
          }}
          sort={{
            options: productSortOptions,
            value: sort?.key ?? "",
            onValueChange: (v) =>
              setSort(v ? { key: v, direction: sort?.direction ?? "asc" } : null),
            label: lang === "ar" ? "ترتيب" : "Sort",
          }}
          viewToggle={
            <ToolbarAction
              label={
                viewMode === "grid"
                  ? lang === "ar"
                    ? "شبكة"
                    : "Grid"
                  : viewMode === "list"
                    ? lang === "ar"
                      ? "قائمة"
                      : "List"
                    : lang === "ar"
                      ? "كلاسيكي"
                      : "Classic"
              }
              icon={
                viewMode === "grid" ? (
                  <LayoutGrid />
                ) : viewMode === "list" ? (
                  <List />
                ) : (
                  <TableProperties />
                )
              }
              onClick={() =>
                setViewMode((prev) =>
                  prev === "grid" ? "list" : prev === "list" ? "table" : "grid",
                )
              }
              tone="ghost"
            />
          }
          action={
            <ToolbarAction
              label={t("common.new")}
              icon={<Plus />}
              tone="primary"
              onClick={openNew}
            />
          }
        >
          {/* Luxury Quick Filter Pills (visible only when view is Grid) */}
          {viewMode === "grid" && (
            <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 scrollbar-x-none">
              <button
                type="button"
                onClick={() => {
                  void refetch();
                  void qc.refetchQueries({ queryKey: ["products", "count"], type: "active" });
                }}
                disabled={isFetching}
                className="inline-flex size-7 shrink-0 items-center justify-center rounded-full border-border/70 bg-surface/70 text-muted-foreground transition hover:bg-surface-2 hover:text-foreground disabled:opacity-50"
                aria-label={lang === "ar" ? "تحديث المنتجات" : "Refresh products"}
                title={lang === "ar" ? "تحديث المنتجات" : "Refresh products"}
              >
                <RefreshCw className={`size-3.5 ${isFetching ? "animate-spin" : ""}`} />
              </button>
              {[
                {
                  id: "all",
                  label: lang === "ar" ? "الكل" : "All",
                  count: productCount ?? products.length,
                },
                { id: "active", label: lang === "ar" ? "النشطة" : "Active", count: activeCount },
                {
                  id: "inactive",
                  label: lang === "ar" ? "غير النشطة" : "Inactive",
                  count: inactiveCount,
                },
                {
                  id: "low_stock",
                  label: lang === "ar" ? "تنبيه المخزون" : "Stock Alert",
                  count: lowStockCount,
                },
              ].map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setQuickFilter(f.id as any)}
                  className={`flex items-center gap-1.5 shrink-0 rounded-full px-3 py-1 text-xs font-bold transition border ${
                    quickFilter === f.id
                      ? "border-primary bg-primary text-primary-foreground shadow-xs shadow-primary/20"
                      : "border-border/70 bg-surface/70 text-muted-foreground hover:text-foreground hover:bg-surface-2"
                  }`}
                >
                  <span>{f.label}</span>
                  {f.count !== undefined && (
                    <span
                      className={`rounded-full px-1.5 py-0.2 text-[10px] font-mono ${
                        quickFilter === f.id
                          ? "bg-white/20 text-white"
                          : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {f.count}
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
        </TableToolbar>
      </div>

      {/* ─── Main Records View: Grid vs List (Mullak style) vs Classic Table ─── */}
      {viewMode === "grid" ? (
        <div className="space-y-4">
          {error ? (
            <div className="card-mullak p-8 text-center">
              <p className="text-sm font-semibold text-destructive">
                {lang === "ar" ? "تعذر تحميل المنتجات" : "Unable to load products"}
              </p>
              <p className="mt-2 text-xs text-muted-foreground" dir="ltr">
                {error instanceof Error ? error.message : String(error)}
              </p>
              <Button size="sm" variant="outline" className="mt-4" onClick={() => void refetch()}>
                {lang === "ar" ? "إعادة المحاولة" : "Retry"}
              </Button>
            </div>
          ) : isLoading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <div
                  key={i}
                  className="card-mullak h-44 animate-pulse bg-surface-2/40 rounded-2xl"
                />
              ))}
            </div>
          ) : displayRows.length === 0 ? (
            <div className="card-mullak p-12 text-center flex flex-col items-center justify-center space-y-3">
              <div className="grid size-14 place-items-center rounded-2xl bg-muted/30 text-muted-foreground">
                <Package className="size-8" />
              </div>
              <h4 className="text-base font-bold text-foreground">{t("products.no_products")}</h4>
              <p className="text-xs text-muted-foreground max-w-sm">{t("products.empty_hint")}</p>
              <Button size="sm" icon={<Plus />} onClick={openNew}>
                {t("common.new")}
              </Button>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3.5 sm:gap-4">
                {displayRows.map((p) => {
                  const primary = lang === "ar" ? p.name_ar || p.name : p.name || p.name_ar || "—";
                  const other = lang === "ar" ? p.name : p.name_ar;
                  const secondary =
                    other && other.trim() && other.trim() !== primary.trim() ? other : null;
                  const categoryName = label(p.category?.name, p.category?.name_ar);

                  return (
                    <div
                      key={p.id}
                      onClick={() => {
                        setEditing(p);
                        setPrefillBarcode(undefined);
                        setOpen(true);
                      }}
                      className={`card-mullak group relative overflow-hidden rounded-2xl p-4 sm:p-5 flex flex-col justify-between cursor-pointer border transition-all duration-200 ${
                        !p.is_active
                          ? "border-r-4 border-r-muted-foreground/40 hover:border-border"
                          : p.min_stock != null && Number(p.min_stock) > 0
                            ? "border-r-4 border-r-amber-500 hover:border-amber-500/60"
                            : "border-r-4 border-r-emerald-500 hover:border-primary/40"
                      }`}
                    >
                      {/* Top Badges Row */}
                      <div className="flex items-center justify-between gap-2 mb-2.5">
                        <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 border border-primary/20 px-2.5 py-0.5 text-[11px] font-semibold text-primary truncate max-w-[140px]">
                          <Tag className="size-3 shrink-0" />
                          <span className="truncate">
                            {categoryName || (lang === "ar" ? "عام" : "General")}
                          </span>
                        </span>

                        <div className="flex items-center gap-1.5">
                          {p.barcode ? (
                            <span className="inline-flex items-center gap-1 rounded-md bg-surface-2 px-2 py-0.5 font-mono text-[10px] text-muted-foreground border border-border/60">
                              <Barcode className="size-3" />
                              <span>{p.barcode}</span>
                            </span>
                          ) : p.sku ? (
                            <span className="rounded-md bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                              {p.sku}
                            </span>
                          ) : null}

                          <span
                            className={`size-2 rounded-full ${
                              !p.is_active
                                ? "bg-muted-foreground/40"
                                : p.min_stock != null && Number(p.min_stock) > 0
                                  ? "bg-amber-500 ring-2 ring-amber-500/20"
                                  : "bg-emerald-500 ring-2 ring-emerald-500/20"
                            }`}
                            title={p.is_active ? t("common.active") : t("common.inactive")}
                          />
                        </div>
                      </div>

                      {/* Product Title & Subtitle */}
                      <div className="mb-3">
                        <h4
                          className="font-bold text-foreground text-sm sm:text-base leading-snug line-clamp-2 group-hover:text-primary transition-colors"
                          dir={lang === "ar" ? "rtl" : "ltr"}
                        >
                          {primary}
                        </h4>
                        {secondary && (
                          <p
                            className="text-[11px] text-muted-foreground/80 line-clamp-1 mt-0.5"
                            dir={lang === "ar" ? "ltr" : "rtl"}
                          >
                            {secondary}
                          </p>
                        )}
                      </div>

                      {/* Attribute Pills: Brand, Unit, Shelf */}
                      <div className="flex flex-wrap items-center gap-1.5 mb-3.5 text-[11px] text-muted-foreground">
                        {p.brand && (
                          <span className="rounded-md bg-surface-2/70 px-2 py-0.5 border border-border/50">
                            {label(p.brand.name, p.brand.name_ar)}
                          </span>
                        )}
                        {p.unit && (
                          <span className="rounded-md bg-surface-2/70 px-2 py-0.5 border border-border/50">
                            {label(p.unit.short_name, p.unit.name_ar)}
                          </span>
                        )}
                        {p.shelf_location && (
                          <span className="inline-flex items-center gap-1 rounded-md bg-surface-2/70 px-2 py-0.5 border border-border/50 text-[10px]">
                            <MapPin className="size-2.5 text-muted-foreground" />
                            <span>{p.shelf_location}</span>
                          </span>
                        )}
                        {p.min_stock != null && Number(p.min_stock) > 0 && (
                          <span className="inline-flex items-center gap-1 rounded-md bg-amber-500/10 text-amber-500 border border-amber-500/20 px-2 py-0.5 text-[10px] font-mono">
                            <Boxes className="size-2.5" />
                            <span>{qtyCell(p.min_stock)}</span>
                          </span>
                        )}
                      </div>

                      {/* Price & Action Row */}
                      <div className="pt-3 border-t border-border/60 flex items-center justify-between gap-2 mt-auto">
                        <div>
                          <p className="text-[10px] text-muted-foreground font-medium">
                            {t("common.price")}
                          </p>
                          <p className="font-mono font-bold text-base sm:text-lg text-foreground tracking-tight">
                            {moneyCell(p.sale_price)}
                          </p>
                          {canViewCost && p.cost_price != null && (
                            <p className="text-[10px] font-mono text-muted-foreground/70">
                              {lang === "ar" ? "التكلفة: " : "Cost: "}
                              {moneyCell(p.cost_price)}
                            </p>
                          )}
                        </div>

                        {/* Quick Action Buttons */}
                        <div className="flex items-center gap-1 opacity-90 sm:opacity-0 group-hover:opacity-100 transition-opacity">
                          <IconButton
                            size="sm"
                            variant="outline"
                            tooltip
                            ariaLabel={t("common.edit")}
                            icon={<Pencil className="size-3.5" />}
                            round
                            onClick={(event) => {
                              event.stopPropagation();
                              setEditing(p);
                              setPrefillBarcode(undefined);
                              setOpen(true);
                            }}
                          />
                          <IconButton
                            size="sm"
                            variant="danger"
                            tooltip
                            ariaLabel={t("common.delete")}
                            icon={<Trash2 className="size-3.5" />}
                            round
                            onClick={(event) => {
                              event.stopPropagation();
                              setConfirmDelete(p);
                            }}
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Load More Button in Cards View */}
              {hasNextPage && (
                <div className="flex justify-center pt-4">
                  <button
                    onClick={() => void fetchNextPage()}
                    disabled={isFetchingNextPage}
                    className="flex items-center gap-2 rounded-2xl border border-border/80 bg-surface px-6 py-2.5 text-xs font-bold text-foreground shadow-sm hover:bg-surface-2 transition active:scale-95 disabled:opacity-50"
                  >
                    {isFetchingNextPage ? (
                      <>
                        <Loader2 className="size-4 animate-spin" />
                        <span>{lang === "ar" ? "جاري التحميل..." : "Loading more…"}</span>
                      </>
                    ) : (
                      <span>{lang === "ar" ? "عرض المزيد من المنتجات" : "Load more products"}</span>
                    )}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      ) : viewMode === "list" ? (
        /* ─── Luxury Mullak Row-Cards View (List with Right Accent Strip) ─── */
        <div className="space-y-3">
          {isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <div
                  key={i}
                  className="card-mullak h-20 animate-pulse bg-surface-2/40 rounded-2xl"
                />
              ))}
            </div>
          ) : displayRows.length === 0 ? (
            <div className="card-mullak p-12 text-center flex flex-col items-center justify-center space-y-3">
              <div className="grid size-14 place-items-center rounded-2xl bg-muted/30 text-muted-foreground">
                <Package className="size-8" />
              </div>
              <h4 className="text-base font-bold text-foreground">{t("products.no_products")}</h4>
              <p className="text-xs text-muted-foreground max-w-sm">{t("products.empty_hint")}</p>
              <Button size="sm" icon={<Plus />} onClick={openNew}>
                {t("common.new")}
              </Button>
            </div>
          ) : (
            <>
              <div className="space-y-2.5">
                {displayRows.map((p) => {
                  const primary = lang === "ar" ? p.name_ar || p.name : p.name || p.name_ar || "—";
                  const other = lang === "ar" ? p.name : p.name_ar;
                  const secondary =
                    other && other.trim() && other.trim() !== primary.trim() ? other : null;
                  const categoryName = label(p.category?.name, p.category?.name_ar);

                  const isLowStock = p.min_stock != null && Number(p.min_stock) > 0;
                  const barColor = !p.is_active
                    ? "bg-muted-foreground/30"
                    : isLowStock
                      ? "bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.5)]"
                      : "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.4)]";

                  return (
                    <div
                      key={p.id}
                      onClick={() => {
                        setEditing(p);
                        setPrefillBarcode(undefined);
                        setOpen(true);
                      }}
                      className="card-mullak group relative flex flex-col md:flex-row md:items-center justify-between gap-3 p-3.5 sm:p-4 rounded-2xl cursor-pointer border transition-all duration-200 hover:border-primary/50 hover:shadow-md"
                    >
                      {/* Right section: Colored Accent Bar + Avatar + Product Names & Tags */}
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        {/* Colored indicator bar on right (RTL indicator like Mullak) */}
                        <span
                          aria-hidden
                          className={`h-11 sm:h-12 w-1.5 shrink-0 rounded-full ${barColor}`}
                        />

                        {/* Product Icon Avatar */}
                        <div className="grid size-11 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary border border-primary/20 group-hover:bg-primary group-hover:text-primary-foreground group-hover:scale-105 transition-all">
                          <Package className="size-5" />
                        </div>

                        {/* Title & Metadata */}
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <h4
                              className="font-bold text-foreground text-sm sm:text-base leading-snug truncate group-hover:text-primary transition-colors"
                              dir={lang === "ar" ? "rtl" : "ltr"}
                            >
                              {primary}
                            </h4>
                            {categoryName && (
                              <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 border border-primary/20 px-2 py-0.5 text-[10px] font-semibold text-primary shrink-0">
                                <Tag className="size-2.5" />
                                <span>{categoryName}</span>
                              </span>
                            )}
                          </div>

                          <div className="flex flex-wrap items-center gap-2 mt-1 text-[11px] text-muted-foreground">
                            {secondary && (
                              <span
                                className="text-muted-foreground/80 truncate max-w-[200px]"
                                dir={lang === "ar" ? "ltr" : "rtl"}
                              >
                                {secondary}
                              </span>
                            )}
                            {p.brand && (
                              <span className="rounded-md bg-surface-2/80 px-2 py-0.5 border border-border/50 text-[10px]">
                                {label(p.brand.name, p.brand.name_ar)}
                              </span>
                            )}
                            {p.barcode ? (
                              <span className="inline-flex items-center gap-1 rounded-md bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground border border-border/50">
                                <Barcode className="size-2.5" />
                                <span>{p.barcode}</span>
                              </span>
                            ) : p.sku ? (
                              <span className="rounded-md bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                                {p.sku}
                              </span>
                            ) : null}
                          </div>
                        </div>
                      </div>

                      {/* Middle section: Shelf location, Min stock, Status */}
                      <div className="flex items-center gap-3 sm:gap-4 shrink-0 text-xs ps-4 md:ps-0">
                        {p.shelf_location && (
                          <div className="hidden sm:flex items-center gap-1 text-muted-foreground bg-surface-2/60 px-2.5 py-1 rounded-xl border border-border/40 text-[11px]">
                            <MapPin className="size-3 text-muted-foreground" />
                            <span className="font-mono">{p.shelf_location}</span>
                          </div>
                        )}

                        {isLowStock && (
                          <div className="flex items-center gap-1 text-amber-500 bg-amber-500/10 border border-amber-500/20 px-2.5 py-1 rounded-xl text-[11px] font-mono">
                            <Boxes className="size-3" />
                            <span>{qtyCell(p.min_stock)}</span>
                          </div>
                        )}

                        <StatusBadge tone={p.is_active ? "success" : "neutral"} dot>
                          {p.is_active ? t("common.active") : t("common.inactive")}
                        </StatusBadge>
                      </div>

                      {/* Left section: Price + Actions */}
                      <div className="flex items-center justify-between md:justify-end gap-3 pt-2 md:pt-0 border-t md:border-t-0 border-border/50 shrink-0 ps-4 md:ps-0">
                        <div className="text-start md:text-end">
                          <p className="font-mono font-bold text-base sm:text-lg text-foreground tracking-tight">
                            {moneyCell(p.sale_price)}
                          </p>
                          {canViewCost && p.cost_price != null && (
                            <p className="text-[10px] font-mono text-muted-foreground/70">
                              {lang === "ar" ? "التكلفة: " : "Cost: "}
                              {moneyCell(p.cost_price)}
                            </p>
                          )}
                        </div>

                        {/* Quick Action buttons */}
                        <div className="flex items-center gap-1">
                          <IconButton
                            size="sm"
                            variant="outline"
                            tooltip
                            ariaLabel={t("common.edit")}
                            icon={<Pencil className="size-3.5" />}
                            round
                            onClick={(event) => {
                              event.stopPropagation();
                              setEditing(p);
                              setPrefillBarcode(undefined);
                              setOpen(true);
                            }}
                          />
                          <IconButton
                            size="sm"
                            variant="danger"
                            tooltip
                            ariaLabel={t("common.delete")}
                            icon={<Trash2 className="size-3.5" />}
                            round
                            onClick={(event) => {
                              event.stopPropagation();
                              setConfirmDelete(p);
                            }}
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Load More Button in List View */}
              {hasNextPage && (
                <div className="flex justify-center pt-4">
                  <button
                    onClick={() => void fetchNextPage()}
                    disabled={isFetchingNextPage}
                    className="flex items-center gap-2 rounded-2xl border border-border/80 bg-surface px-6 py-2.5 text-xs font-bold text-foreground shadow-sm hover:bg-surface-2 transition active:scale-95 disabled:opacity-50"
                  >
                    {isFetchingNextPage ? (
                      <>
                        <Loader2 className="size-4 animate-spin" />
                        <span>{lang === "ar" ? "جاري التحميل..." : "Loading more…"}</span>
                      </>
                    ) : (
                      <span>{lang === "ar" ? "عرض المزيد من المنتجات" : "Load more products"}</span>
                    )}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      ) : (
        /* ─── Classic Table View: Original DataTable with column headers & full layout ─── */
        <div className="panel-elevated -mx-1 sm:mx-0 overflow-hidden rounded-2xl border border-border/70">
          <DataTable
            className="px-0"
            columns={columns}
            rows={displayRows}
            rowKey={(p) => p.id}
            loading={isLoading}
            initialLoading={isLoading}
            refreshing={isFetching && !isLoading && !isFetchingNextPage}
            error={(error as Error) ?? null}
            onRetry={() => refetch()}
            sort={sort}
            onSortChange={setSort}
            infinite
            hasMore={Boolean(hasNextPage)}
            onLoadMore={() => {
              if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
            }}
            loadingMore={isFetchingNextPage}
            pageSize={PRODUCTS_PAGE_SIZE}
            totalCount={productCount}
            minWidth={canViewCost ? 1050 : 930}
            horizontalScroll={tableUsesHorizontalScroll}
            stickyHeader
            onRowClick={(product) => {
              setEditing(product);
              setPrefillBarcode(undefined);
              setOpen(true);
            }}
            empty={{
              icon: <Package />,
              title: t("products.no_products"),
              description: t("products.empty_hint"),
              action: (
                <Button size="sm" icon={<Plus />} onClick={openNew}>
                  {t("common.new")}
                </Button>
              ),
            }}
          />
        </div>
      )}

      {open && (
        <ProductDialog
          initial={editing}
          initialBarcode={prefillBarcode}
          userId={user?.id ?? null}
          canViewCost={canViewCost}
          meta={
            meta ?? {
              categories: [],
              brands: [],
              units: [],
              origins: [],
              qualities: [],
            }
          }
          onClose={() => {
            setOpen(false);
            setPrefillBarcode(undefined);
          }}
          onSaved={() => {
            setOpen(false);
            setPrefillBarcode(undefined);
            // Refetch the first page so newly inserted rows are visible immediately.
            // `refetchType: "none"` only marked the cache stale and left the current
            // list unchanged when realtime was unavailable or not enabled.
            void qc.refetchQueries({ queryKey: QUERY_KEYS.products, type: "active" });
            void qc.refetchQueries({ queryKey: ["products", "count"], type: "active" });
            void qc.invalidateQueries({ queryKey: ["products-meta"] });
          }}
        />
      )}

      <ConfirmDialog
        open={confirmDelete != null}
        onClose={() => setConfirmDelete(null)}
        tone="danger"
        title={lang === "ar" ? "تأكيد الحذف" : t("common.delete")}
        description={
          confirmDelete ? (
            <>
              {lang === "ar"
                ? `هل أنت متأكد من حذف "${confirmDelete.name_ar || confirmDelete.name}"؟`
                : `Delete "${confirmDelete.name || confirmDelete.name_ar}"?`}
              <br />
              <span className="text-caption">
                {lang === "ar"
                  ? "لا يمكن التراجع عن هذا الإجراء."
                  : "This action cannot be undone."}
              </span>
            </>
          ) : null
        }
        confirmLabel={t("common.delete")}
        cancelLabel={t("common.cancel")}
        onConfirm={() => {
          if (confirmDelete) {
            setBlockedDelete({ product: confirmDelete, counts: EMPTY_COUNTS });
            remove.mutate(confirmDelete.id);
          }
          setConfirmDelete(null);
        }}
      />

      {/*
        Delete was refused: the product is referenced by documents and/or stock
        history. Explain exactly what references it and offer the safe action
        (deactivate) instead of destroying the audit trail.
      */}
      <Modal
        open={blockedDelete != null && blockedDelete.counts.blockingTotal > 0}
        onClose={() => setBlockedDelete(null)}
        size="md"
        mobile="sheet"
        title={lang === "ar" ? "لا يمكن حذف هذا المنتج" : "This product cannot be deleted"}
        eyebrow={lang === "ar" ? "محظور" : "Blocked"}
        footer={
          <div className="flex flex-col gap-2">
            <Button
              type="button"
              variant="primary"
              block
              icon={<Power />}
              onClick={async () => {
                const product = blockedDelete?.product;
                if (!product) return;
                const res = await setProductActive(product.id, !product.is_active);
                if (res.ok) {
                  toast.success(
                    product.is_active
                      ? lang === "ar"
                        ? "تم إيقاف تنشيط المنتج"
                        : "Product deactivated"
                      : lang === "ar"
                        ? "تم تنشيط المنتج"
                        : "Product activated",
                  );
                  qc.invalidateQueries({ queryKey: ["products"] });
                  setBlockedDelete(null);
                } else {
                  toast.error(res.message ?? "error");
                }
              }}
            >
              {blockedDelete?.product?.is_active
                ? lang === "ar"
                  ? "إيقاف التنشيط بدلًا من الحذف"
                  : "Deactivate instead"
                : lang === "ar"
                  ? "إعادة التنشيط"
                  : "Reactivate"}
            </Button>
            <Button type="button" variant="outline" block onClick={() => setBlockedDelete(null)}>
              {lang === "ar" ? "إغلاق" : "Close"}
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <p className="text-sm leading-6 text-muted-foreground">
            {lang === "ar"
              ? "هذا المنتج مرتبط بسجلات قائمة، ولذلك لا يمكن حذفه. يمكنك إيقاف تنشيطه لإخفانه من القوائم وعمليات البيع الجديدة، دون فقدان أي سجل تاريخي."
              : "This product is referenced by existing records, so it cannot be deleted. You can deactivate it to hide it from lists and new sales, without losing any historical record."}
          </p>

          <div className="rounded-[12px] border-border/60 bg-surface-2/50 p-3">
            <p className="mb-2 text-label text-muted-foreground">
              {lang === "ar" ? "مرتبط بـ" : "Referenced by"}
            </p>
            <ul className="space-y-1.5">
              {describeReferences(blockedDelete?.counts ?? EMPTY_COUNTS, lang).map((line) => (
                <li key={line} className="flex items-center gap-2 text-[13px]">
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-tone-warning-fg/70" />
                  <span dir="auto">{line}</span>
                </li>
              ))}
            </ul>
          </div>

          {blockedDelete && isHistoryOnly(blockedDelete.counts) ? (
            <p className="text-caption text-muted-foreground">
              {lang === "ar"
                ? "المرتبط هنا هو سجل مخزون فقط، وليس فواتير. حذفه سيمسح تاريخ المخزون، لذلك ننصح بإيقاف التنشيط."
                : "Only stock history references this product (no invoices). Deleting would erase that history, so deactivation is recommended."}
            </p>
          ) : null}
        </div>
      </Modal>

      {/* Catalog Modules Customization Dialog */}
    </div>
  );
}

function ProductDialog({
  initial,
  initialBarcode,
  userId,
  canViewCost = true,
  meta,
  onClose,
  onSaved,
}: {
  initial: ProductRow | null;
  initialBarcode?: string;
  userId: string | null;
  canViewCost?: boolean;
  meta: {
    categories: { id: string; name: string; name_ar: string | null }[];
    brands: { id: string; name: string; name_ar: string | null }[];
    units: { id: string; name: string; name_ar: string | null; short_name: string }[];
    origins: { id: string; code: string; name: string; name_ar: string }[];
    qualities: { id: string; name: string; name_ar: string; code?: string; sort_order?: number }[];
  };
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t, lang } = useI18n();
  const { config } = useCatalogModules();
  const { isModuleEnabled } = useModules();
  const [scannerOpen, setScannerOpen] = useState(false);
  /** Saved policy for this user (localStorage) — the baseline the form starts from. */
  const [baseline, setBaseline] = useState<UserItemPolicyPreferences>(() =>
    userId ? readUserItemPolicyPreferences(userId) : DEFAULT_USER_ITEM_POLICY_PREFERENCES,
  );
  /**
   * Policy settings are edited inline in this same form, behind the switch at the
   * top. Creating a product starts with them ON, so the product is created
   * instantly with the user's saved policy; turning the switch off restores the
   * saved baseline and leaves the product on the catalog defaults.
   */
  const [applyDefaults, setApplyDefaults] = useState(true);
  /** Draft policy: edited by the user, only persisted when they press Save. */
  const [policy, setPolicy] = useState<UserItemPolicyPreferences>(baseline);
  /** What the product will actually be created with (defaults vs. the draft). */
  const effectivePolicy: UserItemPolicyPreferences = applyDefaults ? policy : baseline;
  /**
   * The settings switch is an edit-time decision only. When changing an existing
   * product we show its stored policy as a read-only summary instead.
   */
  const settingsEditable = initial == null;
  const [form, setForm] = useState({
    name: initial?.name ?? "",
    name_ar: initial?.name_ar ?? "",
    sku: initial?.sku ?? "",
    barcode: initial?.barcode ?? initialBarcode ?? "",
    category_id: initial?.category_id ?? "",
    brand_id: initial?.brand_id ?? "",
    unit_id: initial?.unit_id ?? "",
    cost_price: initial?.cost_price?.toString() ?? "0",
    sale_price: initial?.sale_price?.toString() ?? "0",
    tax_rate: initial?.tax_rate?.toString() ?? "0",
    min_stock: initial?.min_stock?.toString() ?? "1",
    shelf_location: initial?.shelf_location ?? "",
    origin_id: initial?.origin_id ?? "",
    quality_grade_id: initial?.quality_grade_id ?? "",
    is_active: initial?.is_active ?? true,
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!initial && userId) {
      const stored = readUserItemPolicyPreferences(userId);
      setBaseline(stored);
      setPolicy(stored);
      setApplyDefaults(true);
    }
  }, [initial, userId]);

  useKeyboardWedge({
    onScan: (barcode) => {
      setForm((current) => ({ ...current, barcode }));
      toast.success(lang === "ar" ? "تمت قراءة الباركود" : "Barcode received", { duration: 1500 });
    },
    disabled: !isModuleEnabled("barcode") || scannerOpen,
  });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    if (!form.name_ar.trim() && !form.name.trim()) {
      toast.error(lang === "ar" ? "اسم المنتج مطلوب" : t("products.name_required"));
      return;
    }
    if (!effectivePolicy.is_sellable && !effectivePolicy.is_purchasable) {
      toast.error(
        lang === "ar"
          ? "يجب أن يكون المنتج متاحًا للبيع أو الشراء على الأقل."
          : "The product must be available for sales or purchases.",
      );
      setApplyDefaults(true);
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
      min_stock: Number(form.min_stock) || 1,
      shelf_location: form.shelf_location.trim() || null,
      origin_id: config.enableOrigins ? form.origin_id || null : null,
      quality_grade_id: config.enableQualityGrades ? form.quality_grade_id || null : null,
      is_active: form.is_active,
    };
    const request: any = initial
      ? (supabase.from("products") as any)
          .update(payload)
          .eq("id", initial.id)
          .select("id")
          .single()
      : (supabase.from("products") as any).insert(payload).select("id").single();
    const { error: writeError } = await request;
    setSaving(false);
    if (writeError) {
      const databaseError = writeError as { code?: string; message?: string };
      if (
        databaseError.code === "23505" ||
        /duplicate key|products_barcode_key/i.test(databaseError.message ?? "")
      ) {
        toast.error(
          lang === "ar"
            ? "هذا الباركود مستخدم لمنتج آخر بالفعل."
            : "This barcode is already used by another product.",
        );
        return;
      }
      toast.error(databaseError.message ?? "Unable to save the product.");
      return;
    }
    // Persist the policy for *this and future products* on an explicit save.
    if (!initial && userId) {
      saveUserItemPolicyPreferences(userId, policy);
      setBaseline(policy);
    }
    toast.success(
      lang === "ar"
        ? initial
          ? "تم تحديث المنتج"
          : applyDefaults
            ? "تم إنشاء المنتج وتطبيق الإعدادات المحفوظة"
            : "تم إنشاء المنتج بسياسات الفهرس الافتراضية"
        : initial
          ? "Product updated"
          : applyDefaults
            ? "Product created with your saved settings"
            : "Product created with the catalog default policy",
    );
    onSaved();
  }

  const labelOf = (en: string, ar: string | null) => (lang === "ar" ? ar || en : en || ar || "");

  return (
    <VortexDrawerDialog
      open={true}
      onOpenChange={(isOpen) => {
        if (!isOpen) onClose();
      }}
      size="lg"
      title={initial ? t("products.edit_product") : t("products.new_product")}
      description={
        initial
          ? lang === "ar"
            ? "تعديل تفاصيل المنتج والأسعار والمخزون"
            : "Edit product details, pricing, and stock"
          : lang === "ar"
            ? "إضافة منتج جديد وتحديد الأسعار والمخزون"
            : "Create a new product with pricing and stock"
      }
      footer={
        <div className="flex w-full items-center justify-end gap-3">
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            className="flex-1 sm:flex-initial min-w-[110px] rounded-xl font-medium"
          >
            {t("common.cancel")}
          </Button>
          <Button
            type="submit"
            form="product-form"
            loading={saving}
            className="flex-1 sm:flex-initial min-w-[140px] rounded-xl bg-primary font-semibold text-primary-foreground shadow-sm hover:bg-primary/90"
          >
            {t("common.save")}
          </Button>
        </div>
      }
    >
      <form id="product-form" onSubmit={submit} className="flex flex-col gap-6">
        <ProductSettingsSection
          editable={settingsEditable}
          enabled={applyDefaults}
          onEnabledChange={(next) => {
            setApplyDefaults(next);
            // Turning the switch back off restores the saved policy untouched.
            if (!next) setPolicy(baseline);
          }}
          policy={effectivePolicy}
          onPolicyChange={(next) => {
            setPolicy(next);
            setApplyDefaults(true);
          }}
        />

        <FormSection title={lang === "ar" ? "بيانات المنتج" : "Product details"}>
          <FormGrid cols={3}>
            <FormField label={t("products.name_ar")} required>
              {(p) => (
                <VortexTextInput
                  id={p.id}
                  aria-describedby={p["aria-describedby"]}
                  dir="rtl"
                  clearable
                  value={form.name_ar}
                  onChange={(e) => setForm({ ...form, name_ar: e.target.value })}
                  placeholder={
                    lang === "ar" ? "أدخل اسم المنتج بالعربية..." : "Product name in Arabic..."
                  }
                />
              )}
            </FormField>

            <FormField label={t("products.name_en")}>
              {(p) => (
                <VortexTextInput
                  id={p.id}
                  aria-describedby={p["aria-describedby"]}
                  dir="ltr"
                  clearable
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder={lang === "ar" ? "Product name in English..." : "Product name..."}
                />
              )}
            </FormField>

            <FormField label={t("products.category")}>
              {(p) => (
                <select
                  id={p.id}
                  aria-describedby={p["aria-describedby"]}
                  value={form.category_id}
                  onChange={(e) => setForm({ ...form, category_id: e.target.value })}
                  className={fieldSurfaceClass}
                >
                  <option value="">—</option>
                  {meta.categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {labelOf(c.name, c.name_ar)}
                    </option>
                  ))}
                </select>
              )}
            </FormField>

            <FormField
              label={t("products.sku")}
              hint={lang === "ar" ? "معرّف داخلي فريد" : "Unique internal identifier"}
            >
              {(p) => (
                <VortexTextInput
                  id={p.id}
                  aria-describedby={p["aria-describedby"]}
                  clearable
                  value={form.sku}
                  onChange={(e) => setForm({ ...form, sku: e.target.value })}
                  placeholder={lang === "ar" ? "مثال: PRD-001" : "e.g. PRD-001"}
                />
              )}
            </FormField>

            {isModuleEnabled("barcode") && (
              <FormField label={t("products.barcode")}>
                {(p) => (
                  <div className="flex items-center gap-2">
                    <VortexTextInput
                      id={p.id}
                      aria-describedby={p["aria-describedby"]}
                      dir="ltr"
                      clearable
                      value={form.barcode}
                      onChange={(e) => setForm({ ...form, barcode: e.target.value })}
                      placeholder="628100..."
                      className="min-w-0 flex-1"
                    />
                    <IconButton
                      type="button"
                      size="md"
                      variant="outline"
                      ariaLabel={
                        lang === "ar" ? "مسح الباركود بالكاميرا" : "Scan barcode with camera"
                      }
                      icon={<Camera />}
                      onClick={() => setScannerOpen(true)}
                    />
                  </div>
                )}
              </FormField>
            )}

            <FormField label={lang === "ar" ? "موقع الرف / المستودع" : "Shelf location"}>
              {(p) => (
                <VortexTextInput
                  id={p.id}
                  aria-describedby={p["aria-describedby"]}
                  clearable
                  value={form.shelf_location}
                  onChange={(e) => setForm({ ...form, shelf_location: e.target.value })}
                  placeholder={lang === "ar" ? "مثال: رف A - 03" : "e.g. Shelf A - 03"}
                />
              )}
            </FormField>
          </FormGrid>
        </FormSection>
        {/* Catalog attributes */}
        {(config.enableBrands ||
          config.enableOrigins ||
          config.enableQualityGrades ||
          config.enableUnits) && (
          <FormSection title={lang === "ar" ? "خصائص الفهرس" : "Catalog attributes"}>
            <FormGrid cols={3}>
              {config.enableBrands && (
                <FormField label={t("products.brand")}>
                  {(p) => (
                    <select
                      id={p.id}
                      aria-describedby={p["aria-describedby"]}
                      value={form.brand_id}
                      onChange={(e) => setForm({ ...form, brand_id: e.target.value })}
                      className={fieldSurfaceClass}
                    >
                      <option value="">—</option>
                      {meta.brands.map((b) => (
                        <option key={b.id} value={b.id}>
                          {labelOf(b.name, b.name_ar)}
                        </option>
                      ))}
                    </select>
                  )}
                </FormField>
              )}

              {config.enableOrigins && (
                <FormField label={lang === "ar" ? "بلد المنشأ" : "Country of origin"}>
                  {(p) => (
                    <select
                      id={p.id}
                      aria-describedby={p["aria-describedby"]}
                      value={form.origin_id}
                      onChange={(e) => setForm({ ...form, origin_id: e.target.value })}
                      className={fieldSurfaceClass}
                    >
                      <option value="">—</option>
                      {meta.origins.map((o) => (
                        <option key={o.id} value={o.id}>
                          {lang === "ar" ? o.name_ar : o.name} ({o.code})
                        </option>
                      ))}
                    </select>
                  )}
                </FormField>
              )}

              {config.enableQualityGrades && (
                <FormField label={lang === "ar" ? "درجة الجودة" : "Quality grade"}>
                  {(p) => (
                    <select
                      id={p.id}
                      aria-describedby={p["aria-describedby"]}
                      value={form.quality_grade_id}
                      onChange={(e) => setForm({ ...form, quality_grade_id: e.target.value })}
                      className={fieldSurfaceClass}
                    >
                      <option value="">—</option>
                      {meta.qualities.map((q) => (
                        <option key={q.id} value={q.id}>
                          {lang === "ar" ? q.name_ar : q.name}
                        </option>
                      ))}
                    </select>
                  )}
                </FormField>
              )}

              {config.enableUnits && (
                <FormField label={t("products.unit")}>
                  {(p) => (
                    <select
                      id={p.id}
                      aria-describedby={p["aria-describedby"]}
                      value={form.unit_id}
                      onChange={(e) => setForm({ ...form, unit_id: e.target.value })}
                      className={fieldSurfaceClass}
                    >
                      <option value="">—</option>
                      {meta.units.map((u) => (
                        <option key={u.id} value={u.id}>
                          {labelOf(u.name, u.name_ar)} ({u.short_name})
                        </option>
                      ))}
                    </select>
                  )}
                </FormField>
              )}
            </FormGrid>
          </FormSection>
        )}

        {/* Pricing & stock */}
        <FormSection title={lang === "ar" ? "التسعير والمخزون" : "Pricing & stock"}>
          <FormGrid cols={3}>
            {canViewCost && (
              <FormField
                label={t("common.cost")}
                hint={lang === "ar" ? "سعر الشراء" : "Purchase price"}
              >
                <VortexCurrencyInput
                  value={form.cost_price === "" ? 0 : Number(form.cost_price)}
                  onValueChange={(num) => setForm({ ...form, cost_price: String(num) })}
                  min={0}
                  currencySymbol="﷼"
                  placeholder="0.00"
                />
              </FormField>
            )}

            <FormField label={t("common.price")} required>
              {(p) => (
                <VortexCurrencyInput
                  id={p.id}
                  aria-describedby={p["aria-describedby"]}
                  value={form.sale_price === "" ? 0 : Number(form.sale_price)}
                  onValueChange={(num) => setForm({ ...form, sale_price: String(num) })}
                  min={0}
                  currencySymbol="﷼"
                  placeholder="0.00"
                />
              )}
            </FormField>

            <FormField label={t("products.tax_rate")}>
              {(p) => (
                <NumberInput
                  {...p}
                  value={form.tax_rate === "" ? null : Number(form.tax_rate)}
                  onValueChange={(v) => setForm({ ...form, tax_rate: v == null ? "" : String(v) })}
                  min={0}
                  max={100}
                  suffix="%"
                />
              )}
            </FormField>

            <FormField
              label={t("products.min")}
              hint={lang === "ar" ? "حد التنبيه للمخزون" : "Low-stock alert level"}
            >
              {(p) => (
                <NumberInput
                  {...p}
                  value={form.min_stock === "" ? null : Number(form.min_stock)}
                  onValueChange={(v) => setForm({ ...form, min_stock: v == null ? "" : String(v) })}
                  min={0}
                  decimal={false}
                />
              )}
            </FormField>

            <FormField label={t("common.status")}>
              {(p) => (
                <label
                  htmlFor={p.id}
                  className="flex h-9 cursor-pointer items-center gap-2 rounded-[10px] border-input bg-surface px-3 text-sm"
                >
                  <input
                    id={p.id}
                    type="checkbox"
                    checked={form.is_active}
                    onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
                    className="size-4 rounded border-border accent-[var(--primary)]"
                  />
                  <span className="text-xs font-medium text-muted-foreground">
                    {t("common.active")}
                  </span>
                </label>
              )}
            </FormField>
          </FormGrid>
        </FormSection>
      </form>

      <div
        className="flex items-center gap-1.5 text-caption text-muted-foreground"
        aria-live="polite"
      >
        <ScanBarcode className="size-3.5 text-primary" aria-hidden />
        <span>
          {lang === "ar"
            ? "يمكنك إدخال الباركود أو مسحه بالكاميرا أو قارئ USB."
            : "Enter, scan with the camera, or use a USB barcode reader."}
        </span>
      </div>

      <BarcodeScanner
        open={scannerOpen}
        onClose={() => setScannerOpen(false)}
        onDetected={(barcode) => setForm((current) => ({ ...current, barcode }))}
      />
    </VortexDrawerDialog>
  );
}

interface ProductSettingsSectionProps {
  /** Only a new product can change the policy; an existing one shows its own. */
  editable: boolean;
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
  policy: UserItemPolicyPreferences;
  onPolicyChange: (next: UserItemPolicyPreferences) => void;
}

/**
 * Product settings — product nature, inventory policy, counting, costing and usage.
 *
 * Inline in the product form instead of a second overlay: the policy is part of
 * the product being saved, so it must be visible and saved by the same button.
 * The switch turns the saved policy on for this product and every product added
 * afterwards; turning it off leaves the product on the catalog default policy.
 */
function ProductSettingsSection({
  editable,
  enabled,
  onEnabledChange,
  policy,
  onPolicyChange,
}: ProductSettingsSectionProps) {
  const { lang } = useI18n();
  const ar = lang === "ar";

  return (
    <section className="rounded-2xl border border-border/70 bg-surface/60">
      <div className="flex items-start justify-between gap-3 p-3.5">
        <div className="flex min-w-0 items-start gap-2.5">
          <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg border-primary/20 bg-primary/10 text-primary">
            <Settings className="size-4" />
          </span>
          <div className="space-y-0.5">
            <p className="text-sm font-semibold text-foreground">
              {ar ? "إعدادات المنتج" : "Product settings"}
            </p>
            <p className="text-caption leading-5 text-muted-foreground">
              {editable
                ? ar
                  ? "عند التفعيل يجب تطبيق هذه الإعدادات على هذا المنتج وعلى كل منتج يُضاف بعد الحفظ."
                  : "When enabled, these settings apply to this product and to every product added after saving."
                : ar
                  ? "الإعدادات المطبقة على هذا المنتج."
                  : "The settings applied to this product."}
            </p>
          </div>
        </div>

        {editable ? (
          <label className="flex shrink-0 cursor-pointer items-center gap-2 pt-1">
            <span className="text-xs font-medium text-muted-foreground">
              {enabled ? (ar ? "مفعّل" : "Enabled") : ar ? "غير مفعّل" : "Disabled"}
            </span>
            <span className="relative inline-flex">
              <input
                type="checkbox"
                role="switch"
                checked={enabled}
                onChange={(event) => onEnabledChange(event.target.checked)}
                aria-label={ar ? "تفعيل إعدادات المنتج" : "Enable product settings"}
                className="peer size-5 cursor-pointer appearance-none rounded-md border border-input bg-surface transition checked:border-primary checked:bg-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              />
              <CheckCircle2
                aria-hidden
                className="pointer-events-none absolute inset-0 m-auto size-3.5 text-primary-foreground opacity-0 peer-checked:opacity-100"
              />
            </span>
          </label>
        ) : (
          <span className="shrink-0 rounded-full border-border/60 bg-surface-2 px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
            {ar ? "مطبقة" : "Applied"}
          </span>
        )}
      </div>

      {editable && !enabled ? (
        <p className="mx-3.5 mb-3.5 rounded-xl border-border/60 bg-surface-2/60 p-3 text-xs leading-6 text-muted-foreground">
          {ar
            ? "تم إرجاع الإعدادات والسياسات إلى افتراضيات الفهرس. لن يتأثر أي منتج آخر."
            : "Settings and policies were reset to the catalog defaults. No other product is affected."}
        </p>
      ) : (
        <div className="space-y-5 border-t border-border/60 p-3.5">
          {!editable ? (
            <p className="rounded-xl border-border/60 bg-surface-2/60 p-3 text-xs leading-6 text-muted-foreground">
              {ar
                ? "تغيير سياسة منتج قائم يتم من شاشة سياسات الأصناف بعد اعتمادها، حتى لا تتغير حركات مخزون سابقة."
                : "Changing the policy of an existing product is done from the item policies screen once approved, so previous stock movements stay intact."}
            </p>
          ) : null}

          <SettingsChoice
            label={ar ? "طبيعة المنتج" : "Product nature"}
            value={policy.item_nature}
            disabled={!editable}
            options={[
              { value: "GOOD", label: ITEM_NATURE_LABELS.GOOD[ar ? "ar" : "en"] },
              { value: "SERVICE", label: ITEM_NATURE_LABELS.SERVICE[ar ? "ar" : "en"] },
            ]}
            onChange={(value) =>
              onPolicyChange({
                ...policy,
                item_nature: value as ItemNature,
                inventory_policy: value === "SERVICE" ? "UNTRACKED" : policy.inventory_policy,
                tracking: value === "SERVICE" ? "NONE" : policy.tracking,
                costing_method: value === "SERVICE" ? "NONE" : policy.costing_method,
              })
            }
          />

          {policy.item_nature === "GOOD" && (
            <SettingsChoice
              label={ar ? "سياسة المخزون" : "Inventory policy"}
              value={policy.inventory_policy}
              disabled={!editable}
              options={(["TRACKED", "UNTRACKED", "CUSTOMER_OWNED"] as InventoryPolicy[]).map(
                (value) => ({
                  value,
                  label: INVENTORY_POLICY_LABELS[value][ar ? "ar" : "en"],
                }),
              )}
              onChange={(value) =>
                onPolicyChange({
                  ...policy,
                  inventory_policy: value as InventoryPolicy,
                  tracking: value === "TRACKED" ? policy.tracking : "NONE",
                  costing_method: value === "TRACKED" ? policy.costing_method : "NONE",
                })
              }
            />
          )}

          {policy.item_nature === "GOOD" && policy.inventory_policy === "TRACKED" && (
            <div className="grid gap-4 sm:grid-cols-2">
              <SettingsChoice
                label={ar ? "التتبع الدقيق" : "Detailed tracking"}
                value={policy.tracking}
                disabled={!editable}
                options={(["NONE", "BATCH", "SERIAL"] as ItemTracking[]).map((value) => ({
                  value,
                  label: TRACKING_LABELS[value][ar ? "ar" : "en"],
                }))}
                onChange={(value) => onPolicyChange({ ...policy, tracking: value as ItemTracking })}
              />
              <SettingsChoice
                label={ar ? "طريقة التكلفة" : "Costing method"}
                value={policy.costing_method}
                disabled={!editable}
                options={(["MOVING_AVERAGE", "FIFO", "STANDARD"] as CostingMethod[]).map(
                  (value) => ({
                    value,
                    label: COSTING_METHOD_LABELS[value][ar ? "ar" : "en"],
                  }),
                )}
                onChange={(value) =>
                  onPolicyChange({ ...policy, costing_method: value as CostingMethod })
                }
              />
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <SettingsToggle
              label={ar ? "يظهر في المبيعات" : "Available for sales"}
              checked={policy.is_sellable}
              disabled={!editable}
              onChange={(checked) => onPolicyChange({ ...policy, is_sellable: checked })}
            />
            <SettingsToggle
              label={ar ? "يظهر في المشتريات" : "Available for purchases"}
              checked={policy.is_purchasable}
              disabled={!editable}
              onChange={(checked) => onPolicyChange({ ...policy, is_purchasable: checked })}
            />
          </div>

          <p className="rounded-xl border-primary/20 bg-primary/5 p-3 text-xs leading-6 text-muted-foreground">
            {policy.item_nature === "SERVICE"
              ? ar
                ? "الخدمة تظهر كسطر خدمة ولا تنشئ حركة مخزون."
                : "A service appears as a service line and never creates stock movements."
              : policy.inventory_policy === "TRACKED"
                ? ar
                  ? "السلعة المتتبعة تُخصم عند البيع وتزداد عند الشراء."
                  : "A tracked good is issued on sale and received on purchase."
                : policy.inventory_policy === "CUSTOMER_OWNED"
                  ? ar
                    ? "مادة مملوكة للعميل: تحفظ في موقعك ولا تدخل قيمة مخزون الشركة."
                    : "Customer-owned material is held at your site but excluded from company stock valuation."
                  : ar
                    ? "السلعة غير المتتبعة تظهر في الفواتير بلا رصيد مخزني."
                    : "An untracked good appears on invoices without a managed stock balance."}
          </p>
        </div>
      )}
    </section>
  );
}

function SettingsChoice({
  label,
  value,
  options,
  disabled = false,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <fieldset className="flex flex-col gap-2" disabled={disabled}>
      <legend className="text-xs font-semibold text-foreground">{label}</legend>
      <div className="grid gap-2 sm:grid-cols-2">
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={selected}
              disabled={disabled}
              onPointerDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
                if (disabled) return;
                onChange(option.value);
              }}
              onClick={(event) => event.stopPropagation()}
              className={`pointer-events-auto min-h-10 rounded-xl border px-3 py-2 text-start text-xs font-medium transition ${
                selected
                  ? "border-primary bg-primary/15 text-primary shadow-sm"
                  : "border-border bg-surface text-muted-foreground hover:border-primary/40 hover:text-foreground"
              } ${disabled ? "cursor-default opacity-70" : ""}`}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

function SettingsToggle({
  label,
  checked,
  disabled = false,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label
      className={`flex items-center gap-3 rounded-xl border-border bg-surface p-3 text-sm ${
        disabled ? "cursor-default opacity-70" : "cursor-pointer"
      }`}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        onClick={(event) => event.stopPropagation()}
        className="size-4 accent-[var(--primary)]"
      />
      <span>{label}</span>
    </label>
  );
}

/* Vehicle compatibility was intentionally removed from the product form.
  const [activeMakeId, setActiveMakeId] = useState<string>("all");
  const [search, setSearch] = useState<string>("");

  // Map of makeId -> stats
  const makeStats = useMemo(() => {
    const stats: Record<string, { total: number; selected: number }> = {};
    for (const m of models) {
      if (!stats[m.make_id]) stats[m.make_id] = { total: 0, selected: 0 };
      stats[m.make_id].total += 1;
      if (selectedModelIds.includes(m.id)) {
        stats[m.make_id].selected += 1;
      }
    }
    return stats;
  }, [models, selectedModelIds]);

  // Filtered models according to activeMakeId and search
  const filteredModels = useMemo(() => {
    const q = search.trim().toLowerCase();
    return models.filter((m) => {
      if (activeMakeId !== "all" && m.make_id !== activeMakeId) return false;
      if (!q) return true;
      const makeObj = makes.find((mk) => mk.id === m.make_id);
      const makeName = (makeObj?.name ?? "").toLowerCase();
      const makeNameAr = (makeObj?.name_ar ?? "").toLowerCase();
      const modelName = (m.name ?? "").toLowerCase();
      const modelNameAr = (m.name_ar ?? "").toLowerCase();
      return (
        makeName.includes(q) ||
        makeNameAr.includes(q) ||
        modelName.includes(q) ||
        modelNameAr.includes(q)
      );
    });
  }, [models, makes, activeMakeId, search]);

  const toggleModel = (id: string) => {
    if (selectedModelIds.includes(id)) {
      onChange(selectedModelIds.filter((x) => x !== id));
    } else {
      onChange([...selectedModelIds, id]);
    }
  };

  const selectAllInActive = () => {
    const idsToAdd = filteredModels.map((m) => m.id).filter((id) => !selectedModelIds.includes(id));
    onChange([...selectedModelIds, ...idsToAdd]);
  };

  const deselectAllInActive = () => {
    const idsToRemove = new Set(filteredModels.map((m) => m.id));
    onChange(selectedModelIds.filter((id) => !idsToRemove.has(id)));
  };

  const clearAll = () => {
    onChange([]);
  };

  const makeLookup = useMemo(() => new Map(makes.map((mk) => [mk.id, mk])), [makes]);
  const modelLookup = useMemo(() => new Map(models.map((m) => [m.id, m])), [models]);

  const allInActiveSelected =
    filteredModels.length > 0 && filteredModels.every((m) => selectedModelIds.includes(m.id));

  return (
    <div className="rounded-2xl border border-border/80 bg-surface/80 p-3 shadow-xs">
      { / * Header controls: Search & Quick actions * /}
      <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2 border-b border-border/60 pb-2.5">
        <div className="relative flex-1 min-w-[160px]">
          <Search className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground rtl:right-3 rtl:left-auto ltr:left-3 ltr:right-auto" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={
              lang === "ar" ? "ابحث عن ماركة (علامة) أو موديل..." : "Search make or model..."
            }
            className="h-8 w-full rounded-xl border border-border bg-surface px-8 text-xs text-foreground outline-none placeholder:text-muted-foreground focus:border-primary transition"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch("")}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground rtl:left-2.5 rtl:right-auto ltr:right-2.5 ltr:left-auto"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-1.5 text-xs">
          {filteredModels.length > 0 && (
            <button
              type="button"
              onClick={allInActiveSelected ? deselectAllInActive : selectAllInActive}
              className="inline-flex h-7 items-center gap-1 rounded-lg border border-border bg-surface px-2.5 text-[11px] font-medium text-foreground hover:bg-surface-2 transition active:scale-95"
            >
              {allInActiveSelected ? (
                <span>{lang === "ar" ? "إلغاء تحديد هذه المجموعة" : "Deselect Group"}</span>
              ) : (
                <span>{lang === "ar" ? "تحديد كل المعروض" : "Select All Shown"}</span>
              )}
            </button>
          )}

          {selectedModelIds.length > 0 && (
            <button
              type="button"
              onClick={clearAll}
              className="inline-flex h-7 items-center rounded-lg border border-destructive/20 bg-destructive/10 px-2 text-[11px] font-semibold text-destructive hover:bg-destructive/20 transition"
            >
              {lang === "ar" ? "مسح الكل" : "Clear"}
            </button>
          )}

          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-bold text-primary">
            {lang === "ar"
              ? `المحدد: ${selectedModelIds.length}`
              : `Selected: ${selectedModelIds.length}`}
          </span>
        </div>
      </div>

      { / * Makes Horizontal Filter Strip * /}
      <div className="mb-2.5 flex items-center gap-1.5 overflow-x-auto pb-1.5 custom-scrollbar">
        <button
          type="button"
          onClick={() => setActiveMakeId("all")}
          className={`shrink-0 rounded-xl px-3 py-1 text-xs font-semibold transition ${
            activeMakeId === "all"
              ? "bg-primary text-primary-foreground shadow-xs shadow-primary/20"
              : "border border-border/80 bg-surface text-muted-foreground hover:bg-surface-2 hover:text-foreground"
          }`}
        >
          {lang === "ar" ? "كل الماركات (العلامات)" : "All Makes"}
        </button>

        {makes.map((mk) => {
          const stats = makeStats[mk.id];
          const hasSelected = stats && stats.selected > 0;
          const makeLabel = lang === "ar" ? mk.name_ar || mk.name : mk.name;

          return (
            <button
              key={mk.id}
              type="button"
              onClick={() => setActiveMakeId(mk.id)}
              className={`shrink-0 inline-flex items-center gap-1.5 rounded-xl px-3 py-1 text-xs font-semibold transition ${
                activeMakeId === mk.id
                  ? "bg-primary text-primary-foreground shadow-xs shadow-primary/20"
                  : hasSelected
                    ? "border border-primary/40 bg-primary/10 text-primary hover:bg-primary/20"
                    : "border border-border/80 bg-surface text-muted-foreground hover:bg-surface-2 hover:text-foreground"
              }`}
            >
              <span>{makeLabel}</span>
              {hasSelected && (
                <span
                  className={`rounded-full px-1.5 py-0.2 text-[10px] font-bold ${
                    activeMakeId === mk.id
                      ? "bg-primary-foreground/20 text-primary-foreground"
                      : "bg-primary text-primary-foreground"
                  }`}
                >
                  {stats.selected}
                </span>
              )}
            </button>
          );
        })}
      </div>

      { / * Models Grid * /}
      <div className="grid max-h-44 grid-cols-2 gap-1.5 overflow-y-auto rounded-xl border border-border/70 bg-background/50 p-2 sm:grid-cols-3 custom-scrollbar">
        {filteredModels.length === 0 ? (
          <div className="col-span-full py-6 text-center text-xs text-muted-foreground">
            {models.length === 0 ? (
              <div className="flex flex-col items-center gap-1">
                <span>
                  {lang === "ar"
                    ? "لا توجد موديلات مضافة في جدول الفهرس بعد"
                    : "No models found in catalog table"}
                </span>
                <span className="text-[11px] text-primary">
                  {lang === "ar"
                    ? "يمكنك إضافة ماركات وموديلات من صفحة الفهرس"
                    : "You can add makes and models in the Catalog page"}
                </span>
              </div>
            ) : (
              <span>
                {lang === "ar"
                  ? "لا توجد نتائج مطابقة لبحثك أو لهذه الماركة"
                  : "No matching models for filter"}
              </span>
            )}
          </div>
        ) : (
          filteredModels.map((m) => {
            const isChecked = selectedModelIds.includes(m.id);
            const mk = makeLookup.get(m.make_id);
            const makeName = lang === "ar" ? mk?.name_ar || mk?.name : mk?.name;
            const modelName = lang === "ar" ? m.name_ar || m.name : m.name;

            return (
              <label
                key={m.id}
                className={`flex items-center gap-2 rounded-xl border px-2.5 py-1.5 text-xs cursor-pointer transition select-none ${
                  isChecked
                    ? "border-primary/50 bg-primary/10 text-foreground font-semibold shadow-2xs"
                    : "border-border/60 bg-surface/70 text-muted-foreground hover:border-border hover:bg-surface-2 hover:text-foreground"
                }`}
              >
                <input
                  type="checkbox"
                  checked={isChecked}
                  onChange={() => toggleModel(m.id)}
                  className="rounded border-border text-primary focus:ring-primary h-3.5 w-3.5"
                />
                <div className="min-w-0 flex-1 truncate">
                  <span className="text-[10px] text-muted-foreground font-normal">
                    {makeName} —{" "}
                  </span>
                  <span className="truncate">{modelName}</span>
                </div>
              </label>
            );
          })
        )}
      </div>

      { / * Selected Items Summary Tags (if any) * /}
      {selectedModelIds.length > 0 && (
        <div className="mt-2.5 flex flex-wrap items-center gap-1 border-t border-border/60 pt-2 text-[10px]">
          <span className="text-muted-foreground font-medium me-1">
            {lang === "ar" ? "الموديلات المتوافقة:" : "Compatible:"}
          </span>
          {selectedModelIds.slice(0, 8).map((id) => {
            const m = modelLookup.get(id);
            if (!m) return null;
            const mk = makeLookup.get(m.make_id);
            const makeLabel = lang === "ar" ? mk?.name_ar || mk?.name : mk?.name;
            const modelLabel = lang === "ar" ? m.name_ar || m.name : m.name;

            return (
              <span
                key={id}
                className="inline-flex items-center gap-1 rounded-md border border-primary/30 bg-primary/10 px-2 py-0.5 font-medium text-primary"
              >
                <span>
                  {makeLabel} {modelLabel}
                </span>
                <button type="button" onClick={() => toggleModel(id)} className="hover:opacity-75">
                  <X className="h-2.5 w-2.5" />
                </button>
              </span>
            );
          })}
          {selectedModelIds.length > 8 && (
            <span className="rounded-md bg-surface-2 px-1.5 py-0.5 text-muted-foreground font-semibold">
              +{selectedModelIds.length - 8} {lang === "ar" ? "آخرين" : "more"}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
*/

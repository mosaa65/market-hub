import { cn } from "@/lib/utils";
import {
  VortexDrawerDialog,
  VortexTextInput,
  VortexCurrencyInput,
  VortexNumberInput,
  VortexMetricCard,
} from "@/components/vortex-ui";
import { toSystemDigits } from "@/lib/format-preferences";
import { useModules } from "@/lib/modules";
import { createFileRoute } from "@tanstack/react-router";
import { useInfiniteQuery, useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
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
  Eye,
  Trash2,
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
  Check,
  DollarSign,
  TrendingUp,
  SlidersHorizontal,
  ShieldCheck,
  Percent,
  X,
  Copy,
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
import { getCompanyCurrencySymbol, moneyCell, qtyCell } from "@/lib/format";
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
import { ItemRoleBadge, resolveItemClass } from "@/components/item-role-badge";
import { ProductFieldSettings } from "@/components/products/product-field-settings";
import { useProductFieldVisibility } from "@/hooks/use-product-field-visibility";
import type { ProductFieldKey } from "@/lib/product-field-visibility";
import { useBreakpoint } from "@/design/breakpoints";
import { useRealtimeTable } from "@/lib/realtime";
import { registerRealtimeRowPatcher } from "@/lib/realtime";
import { productKeys } from "@/lib/query-keys";
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
  validateItemPolicy,
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
  /**
   * The role the item plays — raw grain, finished flour, a by-product, a
   * service or a consumable. Selected alongside item_nature so the screen can
   * colour-code the row instead of asking the reader to interpret enum codes.
   */
  item_class: string | null;
  category?: { name: string; name_ar: string | null } | null;
  brand?: { name: string; name_ar: string | null } | null;
  unit?: { name?: string; short_name: string; name_ar: string | null } | null;
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
  compatibilities?: { vehicle_model_id: string }[];
};

type ProductBaseRow = Omit<
  ProductRow,
  | "shelf_location"
  | "origin_id"
  | "quality_grade_id"
  | "category"
  | "brand"
  | "unit"
  | "origin"
  | "quality"
  | "compatibilities"
>;

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

type QuickFilter = "all" | "active" | "inactive" | "has_min_stock";

/*
 * Realtime row contract for products.
 *
 * A catalogue row carries joined display data (`category`, `unit`, `brand`) that
 * a raw `postgres_changes` payload does not contain. Merging a payload over a
 * row that is already in the stream is fine — the joins survive the spread.
 * *Inserting* a brand-new raw row is not: the new product would appear with no
 * category and no unit until the next refetch.
 *
 * Returning `null` for that case tells the shared hook to skip the patch and
 * reconcile from the server instead, which is the only way to get a complete
 * row. UPDATE and DELETE stay on the cheap path.
 */
registerRealtimeRowPatcher<ProductRow>("products", ({ eventType }) =>
  eventType === "INSERT" ? null : ({} as ProductRow),
);

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
  const [quickFilter, setQuickFilter] = useState<QuickFilter>("all");
  const [viewMode, setViewMode] = useState<"grid" | "list" | "table">("grid");
  const [selectedProductDetail, setSelectedProductDetail] = useState<ProductRow | null>(null);
  const [copiedBarcode, setCopiedBarcode] = useState<string | null>(null);
  const {
    visibility,
    isVisible: isFieldVisible,
    toggle: toggleField,
    reset: resetFields,
  } = useProductFieldVisibility();
  /** حقل واحد يُسأل عنه كثيراً؛ اختصار يمنع تكرار السطر الطويل في القوالب. */
  const show = (key: ProductFieldKey) => isFieldVisible("view", key);
  /** نفس الاختصار لسطح التفاصيل. */
  const showDetail = (key: ProductFieldKey) => isFieldVisible("detail", key);
  /** وللسطح الثالث: حقول الإدخال. */
  const showForm = (key: ProductFieldKey) => isFieldVisible("form", key);

  const toggleProductActiveMutation = useMutation({
    mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) => {
      const res = await setProductActive(id, isActive);
      if (!res.ok) throw new Error(res.message || "Failed to update status");
      return res;
    },
    onSuccess: (_, { isActive }) => {
      toast.success(
        isActive
          ? lang === "ar"
            ? "تم تفعيل المنتج بنجاح"
            : "Product activated"
          : lang === "ar"
            ? "تم تعطيل المنتج بنجاح"
            : "Product deactivated",
      );
      // Only the stream and its count changed. The taxonomy lookups
      // (categories/brands/units) are untouched by a status toggle and must not
      // be re-read for it.
      void qc.invalidateQueries({ queryKey: productKeys.list() });
      void qc.invalidateQueries({ queryKey: productKeys.count() });
    },
    onError: (err: any) => {
      toast.error(
        err.message || (lang === "ar" ? "تعذر تغيير حالة المنتج" : "Failed to toggle status"),
      );
    },
  });

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
    queryKey: productKeys.list(),
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      const from = pageParam * PRODUCTS_PAGE_SIZE;
      const to = from + PRODUCTS_PAGE_SIZE - 1;
      // Keep the catalogue read deliberately small and independent from optional
      // presentation metadata. A failed embed must never make valid products
      // disappear from the grid.
      const { data: page, error: productError } = await (supabase.from("products") as any)
        .select(
          "id, name, name_ar, sku, barcode, sale_price, cost_price, tax_rate, min_stock, is_active, category_id, brand_id, unit_id, item_nature, item_class, inventory_policy, tracking, costing_method, is_sellable, is_purchasable",
        )
        // `created_at` alone is not a total order: two products inserted in the
        // same millisecond (a bulk import, a sync) have no defined relative
        // order, so the database may return them differently for page 1 and
        // page 2 — duplicating one row and dropping another. `id` is the
        // tie-breaker that makes the ordering stable across pages.
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .range(from, to);

      if (productError) throw productError;

      const baseRows = ((page as ProductBaseRow[] | null) ?? []).map((product) => ({
        ...product,
        shelf_location: null,
        origin_id: null,
        quality_grade_id: null,
        category: null,
        brand: null,
        unit: null,
        origin: null,
        quality: null,
        compatibilities: [],
      })) as ProductRow[];
      const productIds = baseRows.map((product) => product.id);

      // These fields enrich cards and forms, but are not allowed to block the
      // base catalogue. They are fetched as SEPARATE reads on purpose: one
      // unreadable relation used to fail the whole embed, which silently blanked
      // the category, the unit and the shelf together — a product then looked
      // uncategorised and unit-less even though both were perfectly valid.
      //
      // Category and unit share a read because a card cannot be read without
      // them. Brand is isolated: it is optional in this catalogue, and it must
      // never be able to cost the category.
      //
      // Vehicle compatibility is deliberately NOT read here. It was fetched on
      // every page — a third parallel request carrying a row per model per
      // product — and nothing on the grid, the list, the table or the detail
      // drawer renders it (`compatibilities` is only ever defaulted to `[]`).
      // The field stays on `ProductRow` so a detail query can populate it when
      // a screen actually needs the data; paying for it on every catalogue page
      // does not.
      const [enrichmentResult, brandResult] = await Promise.all([
        productIds.length
          ? (supabase.from("products") as any)
              .select(
                // المفتاح مذكور صريحاً: للمنتج أربع علاقات مع units
                // (unit_id / base_uom_id / sales_uom_id / purchase_uom_id)،
                // و"unit:units(...)" يفشل بخطأ "more than one relationship"
                // لأن PostgREST لا يعرف أيها المقصود.
                "id, shelf_location, category:categories(name, name_ar), unit:units!products_unit_id_fkey(name, short_name, name_ar)",
              )
              .in("id", productIds)
          : Promise.resolve({ data: [], error: null } as any),

        // العلامة أيضاً مفتاحها صريح: brands ليست علاقة وحيدة للمنتج في المخطوطات
        // الوسيطة، والاعتماد على الاستدلال التلقائي هنا كان يُسقط العلامة بصمت.
        productIds.length
          ? (supabase.from("products") as any)
              .select("id, brand:brands!products_brand_id_fkey(name, name_ar)")
              .in("id", productIds)
          : Promise.resolve({ data: [], error: null } as any),
      ]);

      const enrichmentRows = enrichmentResult.data;
      const enrichmentError = enrichmentResult.error;
      const brandRows = brandResult.data;
      const brandError = brandResult.error;

      if (enrichmentError) {
        console.warn("[products] تعذّر جلب التصنيف/الوحدة:", enrichmentError.message);
      }
      if (brandError) {
        console.warn("[products] تعذّر جلب العلامة التجارية:", brandError.message);
      }

      const enrichmentByProduct = new Map<string, Partial<ProductRow>>(
        enrichmentError
          ? []
          : (enrichmentRows ?? []).map((product: ProductRow) => [product.id, product]),
      );
      const brandByProduct = new Map<string, ProductRow["brand"]>(
        brandError ? [] : (brandRows ?? []).map((row: ProductRow) => [row.id, row.brand ?? null]),
      );

      const rows = baseRows.map((product) => ({
        ...product,
        ...enrichmentByProduct.get(product.id),
        brand: brandByProduct.get(product.id) ?? null,
      }));
      return { rows, hasMore: rows.length === PRODUCTS_PAGE_SIZE };
    },
    getNextPageParam: (lastPage, pages) => (lastPage.hasMore ? pages.length : undefined),
  });

  // The stream intentionally receives fifty rows at a time. The total must come
  // from the database separately so the number beside search never pretends that
  // the first page is the whole catalogue.
  const { data: productCount } = useQuery({
    queryKey: productKeys.count(),
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
      queryKey: productKeys.list(),
      // Catalogue rows are enriched beyond the table (category, unit, brand are
      // joined in the query). Patching a raw payload is correct for rows already
      // in the stream and wrong for an INSERT of a product this screen has never
      // seen, so the shared patcher defers to reconciliation for inserts.
      debounceMs: 150,
    },
    qc,
  );

  useEffect(() => {
    if (!searchParams.barcode) return;
    // A barcode deep-link is also a creation entry point, so it must pass the
    // same quota/access check as the buttons rather than opening the form raw.
    openNew(searchParams.barcode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams.barcode]);

  const { data: meta } = useQuery({
    queryKey: productKeys.meta(),
    staleTime: 10 * 60 * 1000,
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
      /*
       * Named `has_min_stock`, not "low stock".
       *
       * This predicate is `min_stock > 0` — "a reorder threshold is
       * configured". It does NOT compare an available quantity against that
       * threshold, because the catalogue read carries no stock position. The
       * old label ("Stock Alert" / "Near or below min") claimed a comparison
       * that was never performed, so a product with 900 units on hand and a
       * threshold of 5 was reported as a stock alert.
       *
       * Getting a true low-stock count needs the stock engine
       * (`stock_positions`, as on the inventory screen) — a different query and
       * a different definition of ownership/warehouse. Until that is built,
       * the honest thing is to name what is actually computed.
       */
      if (quickFilter === "has_min_stock") return p.min_stock != null && Number(p.min_stock) > 0;
      return true;
    });
  }, [filtered, quickFilter]);

  const sortedRows = useMemo(() => {
    if (!sort?.key) return displayRows;

    const direction = sort.direction === "desc" ? -1 : 1;
    const value = (product: ProductRow): string | number => {
      switch (sort.key) {
        case "sale_price":
          return Number(product.sale_price) || 0;
        case "cost_price":
          return Number(product.cost_price) || 0;
        case "min_stock":
          return Number(product.min_stock) || 0;
        case "sku":
          return product.sku ?? "";
        case "name":
        default:
          return (
            (lang === "ar" ? product.name_ar || product.name : product.name || product.name_ar) ??
            ""
          );
      }
    };

    return [...displayRows].sort((a, b) => {
      const aValue = value(a);
      const bValue = value(b);
      if (typeof aValue === "number" && typeof bValue === "number") {
        return (aValue - bValue) * direction;
      }
      return String(aValue).localeCompare(String(bValue), lang === "ar" ? "ar" : "en") * direction;
    });
  }, [displayRows, sort, lang]);

  // Luxury KPI calculations
  const {
    totalProducts,
    activeCount,
    inactiveCount,
    hasMinStockCount,
    categoriesCount,
    brandsCount,
  } = useMemo(() => {
    let active = 0;
    let inactive = 0;
    let withMinStock = 0;
    for (const p of products) {
      if (p.is_active) active++;
      else inactive++;
      if (p.min_stock != null && Number(p.min_stock) > 0) withMinStock++;
    }
    return {
      totalProducts: productCount ?? products.length,
      activeCount: active,
      inactiveCount: inactive,
      hasMinStockCount: withMinStock,
      categoriesCount: meta?.categories?.length ?? 0,
      brandsCount: meta?.brands?.length ?? 0,
    };
  }, [products, productCount, meta]);

  /* ---------------- filter + sort definitions (localized) ---------------- */
  const productFilterDefinitions = useMemo<FilterDefinition[]>(() => {
    const definitions: FilterDefinition[] = [
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
      definitions.push({
        key: "category",
        label: t("products.category"),
        type: "select",
        options: meta.categories.map((category) => ({
          value: category.id,
          label:
            (lang === "ar"
              ? category.name_ar || category.name
              : category.name || category.name_ar) ?? category.name,
        })),
      });
    }
    if (config.enableBrands && meta?.brands?.length) {
      definitions.push({
        key: "brand",
        label: t("products.brand"),
        type: "select",
        options: meta.brands.map((brand) => ({
          value: brand.id,
          label:
            (lang === "ar" ? brand.name_ar || brand.name : brand.name || brand.name_ar) ??
            brand.name,
        })),
      });
    }
    if (config.enableUnits && meta?.units?.length) {
      definitions.push({
        key: "unit",
        label: t("products.unit"),
        type: "select",
        options: meta.units.map((unit) => ({
          value: unit.id,
          label:
            (lang === "ar" ? unit.name_ar || unit.name : unit.name || unit.name_ar) ?? unit.name,
        })),
      });
    }
    if (config.enableOrigins && meta?.origins?.length) {
      definitions.push({
        key: "origin",
        label: lang === "ar" ? "بلد المنشأ" : "Origin",
        type: "select",
        options: meta.origins.map(
          (origin: { id: string; name: string; name_ar: string | null; code: string }) => ({
            value: origin.id,
            label: `${origin.name_ar || origin.name} (${origin.code})`,
          }),
        ),
      });
    }

    return definitions;
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

  /**
   * التصنيف الفارغ لا يجب أن يُعرض كشرطة: يوهم بأن الصنف مربوط باسم غير
   * موجود. يعيد null ليقرر caller: «عام» في البطاقة، أو إخفاء السطر.
   */
  const categoryLabel = (category?: { name: string; name_ar: string | null } | null) => {
    const raw =
      lang === "ar" ? category?.name_ar || category?.name : category?.name || category?.name_ar;
    const text = raw?.trim();
    return text ? text : null;
  };

  const productLoadError = (
    <div className="card-mullak flex flex-col items-center justify-center space-y-3 p-12 text-center">
      <div className="grid size-14 place-items-center rounded-2xl bg-destructive/10 text-destructive">
        <AlertTriangle className="size-8" />
      </div>
      <h4 className="text-base font-bold text-foreground">
        {lang === "ar" ? "تعذر تحميل المنتجات" : "Unable to load products"}
      </h4>
      <p className="max-w-sm text-xs text-muted-foreground">
        {lang === "ar"
          ? "حدث خطأ أثناء تحميل المنتجات. حاول مرة أخرى."
          : "An error occurred while loading products. Please try again."}
      </p>
      <Button size="sm" variant="outline" onClick={() => void refetch()}>
        {lang === "ar" ? "إعادة المحاولة" : "Retry"}
      </Button>
    </div>
  );

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
          const secondary =
            show("nameEn") && other && other.trim() && other.trim() !== primary.trim()
              ? other
              : null;
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
    ];

    if (show("category")) {
      cols.push({
        key: "category",
        header: t("products.category"),
        sortable: true,
        width: "w-[140px]",
        sortValue: (p) => categoryLabel(p.category) ?? "",
        cell: (p) => (
          <span className="text-xs text-muted-foreground truncate block">
            {categoryLabel(p.category) ?? (lang === "ar" ? "بدون تصنيف" : "Uncategorized")}
          </span>
        ),
      });
    }

    if (show("role")) {
      cols.push({
        /*
         * The role column is what turns a list of products into something an
         * operator can scan. On a mill screen full of wheat and flour the
         * distinction that matters is not the SKU but whether the row is grain
         * waiting to be milled, a finished product, or a fee — and a colour
         * answers that before the text is read.
         */
        key: "role",
        header: lang === "ar" ? "الدور" : "Role",
        sortable: true,
        width: "w-[130px]",
        sortValue: (p) => resolveItemClass(p.item_class, p.item_nature, p.inventory_policy),
        cell: (p) => (
          <ItemRoleBadge
            itemClass={p.item_class}
            itemNature={p.item_nature}
            inventoryPolicy={p.inventory_policy}
            isRtl={lang === "ar"}
          />
        ),
      });
    }

    if (show("shelf")) {
      cols.push({
        key: "shelf_location",
        header: lang === "ar" ? "الرف" : "Shelf",
        width: "w-[110px]",
        cell: (p) => (
          <span className="font-mono text-xs text-muted-foreground">{p.shelf_location ?? "—"}</span>
        ),
      });
    }

    if (canViewCost && show("cost")) {
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
    );

    if (show("status")) {
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
    });

    return cols;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config, canViewCost, lang, t, visibility]);

  /*
   * The single entry point for creating a product.
   *
   * Every trigger must go through here — the toolbar action, the header
   * "Quick Add" button, a barcode deep-link and the empty-state button. They
   * used to call `setOpen(true)` directly, which bypassed the plan quota check
   * and let an account create past its limit through any of those paths.
   * Refusing *before* the form opens is the honest behaviour: the operator is
   * told why instead of filling in a form that cannot be saved.
   *
   * `barcode` seeds the barcode field for a scan-to-create flow.
   */
  const openNew = useCallback(
    (barcode?: string) => {
      const qCheck = checkQuota("products", productCount ?? products.length);
      if (!qCheck.allowed) {
        toast.error(lang === "ar" ? qCheck.message?.ar : qCheck.message?.en);
        return;
      }
      setEditing(null);
      setPrefillBarcode(barcode);
      setOpen(true);
    },
    [checkQuota, productCount, products.length, lang],
  );

  /* Stable load-more callback: `DataTable` holds it in a ref, but the identity
   * still changes per render unless it is memoised here. */
  const loadMoreProducts = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  /* Stable retry callback for the error state. */
  const retryProducts = useCallback(() => void refetch(), [refetch]);

  return (
    <div className="space-y-4 pb-12">
      <PageHeader
        title={t("products.title")}
        subtitle={t("products.subtitle")}
        actions={
          <div className="flex items-center gap-2">
            <ProductFieldSettings
              isVisible={isFieldVisible}
              toggle={toggleField}
              reset={resetFields}
              isRtl={lang === "ar"}
            />
            <Button
              variant="outline"
              size="sm"
              icon={<ScanBarcode className="size-4" />}
              onClick={() => openNew()}
              className="rounded-xl border-border/80 shadow-xs"
            >
              <span className="hidden sm:inline">
                {lang === "ar" ? "إضافة سريعة" : "Quick Add"}
              </span>
            </Button>
            <Button
              variant="primary"
              size="sm"
              icon={<Plus className="size-4" />}
              onClick={() => openNew()}
              className="rounded-xl font-bold shadow-xs shadow-primary/20"
            >
              {t("common.new")}
            </Button>
          </div>
        }
      />

      {/* ─── Luxury Vortex KPI Metrics Cards (2 columns on mobile, 4 on desktop) ─── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-4">
        <VortexMetricCard
          title={lang === "ar" ? "إجمالي المنتجات" : "Total Products"}
          value={toSystemDigits(totalProducts)}
          currency=""
          subtitle={lang === "ar" ? "في الدليل والكتالوج" : "in catalogue"}
          icon={<Package className="size-5" />}
          iconClassName="bg-primary/10 text-primary border border-primary/20"
          badge={lang === "ar" ? "الكتالوج" : "Catalog"}
          onClick={() => setQuickFilter("all")}
          highlight={quickFilter === "all"}
          className="cursor-pointer"
        />

        <VortexMetricCard
          title={lang === "ar" ? "المنتجات النشطة" : "Active Products"}
          value={toSystemDigits(activeCount)}
          currency=""
          subtitle={
            totalProducts > 0
              ? `${toSystemDigits(Math.round((activeCount / totalProducts) * 100))}% ${lang === "ar" ? "متاح للبيع" : "for sale"}`
              : lang === "ar"
                ? "متاح للبيع"
                : "for sale"
          }
          icon={<CheckCircle2 className="size-5" />}
          iconClassName="bg-emerald-500/10 text-emerald-500 border border-emerald-500/20"
          badge={lang === "ar" ? "نشط" : "Active"}
          onClick={() => setQuickFilter("active")}
          highlight={quickFilter === "active"}
          className="cursor-pointer"
        />

        <VortexMetricCard
          title={lang === "ar" ? "التصنيفات والماركات" : "Categories & Brands"}
          value={`${toSystemDigits(categoriesCount)} / ${toSystemDigits(brandsCount)}`}
          currency=""
          subtitle={lang === "ar" ? "مجموعة تصنيفية" : "Taxonomy groups"}
          icon={<Layers className="size-5" />}
          iconClassName="bg-blue-500/10 text-blue-500 border border-blue-500/20"
          badge={lang === "ar" ? "تصنيف" : "Taxonomy"}
          onClick={() => {}}
        />

        <VortexMetricCard
          title={lang === "ar" ? "له حد أدنى محدد" : "Has Reorder Threshold"}
          value={toSystemDigits(hasMinStockCount)}
          currency=""
          subtitle={lang === "ar" ? "منتجات لها حد إعادة الطلب" : "products with a min stock"}
          icon={<Boxes className="size-5" />}
          iconClassName="bg-amber-500/10 text-amber-500 border border-amber-500/20"
          badge={hasMinStockCount > 0 ? (lang === "ar" ? "محدد" : "Set") : undefined}
          onClick={() => setQuickFilter("has_min_stock")}
          highlight={quickFilter === "has_min_stock"}
          className="cursor-pointer"
        />
      </div>

      {/* ─── Original shared toolbar: search + filters + sort + view mode ─── */}
      <div className="pt-2 sm:pt-3.5">
        <TableToolbar
          sticky
          search={{
            value: query,
            onValueChange: setQuery,
            placeholder: lang === "ar" ? "ابحث في المنتجات" : "Search products",
            // The number beside search must be the MATCH count, not the
            // server-side catalogue total — those are different numbers and
            // showing the total made an empty search look like it had results.
            resultCount: sortedRows.length,
            loading: isFetching && !isLoading,
          }}
          filters={{
            definitions: productFilterDefinitions,
            values: filters,
            onValueChange: setFilters,
          }}
          sort={{
            options: productSortOptions,
            value: sort?.key ?? "",
            onValueChange: (value) =>
              setSort(value ? { key: value, direction: sort?.direction ?? "asc" } : null),
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
                setViewMode((previous) =>
                  previous === "grid" ? "list" : previous === "list" ? "table" : "grid",
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
              onClick={() => openNew()}
            />
          }
        >
          {viewMode === "grid" && (
            <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 scrollbar-x-none">
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
                  id: "has_min_stock",
                  label: lang === "ar" ? "له حد أدنى" : "Has threshold",
                  count: hasMinStockCount,
                },
              ].map((filter) => (
                <button
                  key={filter.id}
                  type="button"
                  onClick={() => setQuickFilter(filter.id as typeof quickFilter)}
                  className={`flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-bold transition ${
                    quickFilter === filter.id
                      ? "border-primary bg-primary text-primary-foreground shadow-xs shadow-primary/20"
                      : "border-border/70 bg-surface/70 text-muted-foreground hover:bg-surface-2 hover:text-foreground"
                  }`}
                >
                  <span>{filter.label}</span>
                  <span
                    className={`rounded-full px-1.5 py-0.2 text-[10px] font-mono ${
                      quickFilter === filter.id
                        ? "bg-white/20 text-white"
                        : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {filter.count}
                  </span>
                </button>
              ))}
            </div>
          )}
        </TableToolbar>
      </div>

      {/* ─── Main Records View: Grid (2 cols mobile!) vs List vs Classic Table ─── */}
      {viewMode === "grid" ? (
        <div className="space-y-4">
          {isLoading ? (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2.5 sm:gap-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <div
                  key={i}
                  className="card-mullak h-44 animate-pulse bg-surface-2/40 rounded-2xl"
                />
              ))}
            </div>
          ) : error && products.length === 0 ? (
            productLoadError
          ) : sortedRows.length === 0 ? (
            <div className="card-mullak p-12 text-center flex flex-col items-center justify-center space-y-3">
              <div className="grid size-14 place-items-center rounded-2xl bg-muted/30 text-muted-foreground">
                <Package className="size-8" />
              </div>
              <h4 className="text-base font-bold text-foreground">{t("products.no_products")}</h4>
              <p className="text-xs text-muted-foreground max-w-sm">{t("products.empty_hint")}</p>
              <Button size="sm" icon={<Plus />} onClick={() => openNew()}>
                {t("common.new")}
              </Button>
            </div>
          ) : (
            <>
              {/* 2 columns on mobile, 3 on tablet, 4 on desktop */}
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2.5 sm:gap-4">
                {sortedRows.map((p) => {
                  const primary = lang === "ar" ? p.name_ar || p.name : p.name || p.name_ar || "—";
                  const other = lang === "ar" ? p.name : p.name_ar;
                  const categoryName = categoryLabel(p.category);
                  const isLowStock = p.min_stock != null && Number(p.min_stock) > 0;

                  return (
                    <div
                      key={p.id}
                      onClick={() => {
                        setSelectedProductDetail(p);
                      }}
                      className={`card-mullak group relative overflow-hidden rounded-2xl p-3 sm:p-4.5 flex flex-col justify-between cursor-pointer border transition-all duration-200 hover:shadow-md ${
                        !p.is_active
                          ? "border-r-4 border-r-muted-foreground/40 hover:border-border"
                          : isLowStock
                            ? "border-r-4 border-r-amber-500 hover:border-amber-500/60 shadow-amber-500/5"
                            : "border-r-4 border-r-emerald-500 hover:border-primary/50 shadow-emerald-500/5"
                      }`}
                    >
                      {/* Top Badges Row */}
                      <div className="flex items-center justify-between gap-1.5 mb-2">
                        <div className="flex items-center gap-1 min-w-0">
                          {show("category") && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 border border-primary/20 px-2 py-0.5 text-[10px] sm:text-[11px] font-semibold text-primary truncate max-w-[110px] sm:max-w-[140px]">
                              <Tag className="size-2.5 sm:size-3 shrink-0" />
                              <span className="truncate">
                                {categoryName || (lang === "ar" ? "بدون تصنيف" : "Uncategorized")}
                              </span>
                            </span>
                          )}
                          {/* What role this item plays — grain waiting to be
                              milled, a finished product, a fee, a consumable.
                              On a mill screen this is the distinction that
                              matters, and the grid is the default view, so it
                              has to be readable here and not only in the table. */}
                          {show("role") && (
                            <ItemRoleBadge
                              itemClass={p.item_class}
                              itemNature={p.item_nature}
                              inventoryPolicy={p.inventory_policy}
                              isRtl={lang === "ar"}
                              compact
                            />
                          )}
                        </div>

                        <div className="flex items-center gap-1">
                          {show("barcode") && p.barcode ? (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                if (p.barcode) {
                                  navigator.clipboard.writeText(p.barcode);
                                  setCopiedBarcode(p.id);
                                  setTimeout(() => setCopiedBarcode(null), 2000);
                                  toast.success(
                                    lang === "ar" ? "تم نسخ الباركود" : "Barcode copied",
                                  );
                                }
                              }}
                              className="inline-flex items-center gap-1 rounded-md bg-surface-2 px-1.5 py-0.5 font-mono text-[9px] sm:text-[10px] text-muted-foreground border border-border/60 hover:text-primary transition"
                              title={lang === "ar" ? "اضغط لنسخ الباركود" : "Click to copy barcode"}
                            >
                              {copiedBarcode === p.id ? (
                                <Check className="size-2.5 text-emerald-500" />
                              ) : (
                                <Barcode className="size-2.5 sm:size-3" />
                              )}
                              <span className="truncate max-w-[65px] sm:max-w-[85px]">
                                {p.barcode}
                              </span>
                            </button>
                          ) : null}

                          <span
                            className={`size-2 shrink-0 rounded-full ${
                              !p.is_active
                                ? "bg-muted-foreground/40"
                                : isLowStock
                                  ? "bg-amber-500 ring-2 ring-amber-500/20"
                                  : "bg-emerald-500 ring-2 ring-emerald-500/20"
                            }`}
                            title={p.is_active ? t("common.active") : t("common.inactive")}
                          />
                        </div>
                      </div>

                      {/* Product Title & Subtitle */}
                      <div className="mb-2">
                        <h4
                          className="font-bold text-foreground text-xs sm:text-sm leading-snug line-clamp-2 group-hover:text-primary transition-colors"
                          dir={lang === "ar" ? "rtl" : "ltr"}
                        >
                          {primary}
                        </h4>
                      </div>

                      {/* Attribute Pills: Brand, Unit, Shelf */}
                      <div className="flex flex-wrap items-center gap-1 mb-2.5 text-[10px] text-muted-foreground">
                        {show("brand") && p.brand && (
                          <span className="rounded-md bg-surface-2/70 px-1.5 py-0.2 border border-border/50 truncate max-w-[90px]">
                            {label(p.brand.name, p.brand.name_ar)}
                          </span>
                        )}
                        {show("unit") && p.unit && (
                          <span className="inline-flex items-center gap-1 rounded-md bg-primary/10 text-primary border border-primary/20 px-2 py-0.5 text-[10px] font-bold">
                            <span>{p.unit.name_ar || p.unit.name || p.unit.short_name}</span>
                          </span>
                        )}
                        {show("shelf") && p.shelf_location && (
                          <span className="inline-flex items-center gap-1 rounded-md bg-surface-2/70 px-1.5 py-0.2 border border-border/50">
                            <MapPin className="size-2 text-muted-foreground" />
                            <span className="truncate max-w-[60px]">{p.shelf_location}</span>
                          </span>
                        )}
                        {show("minStock") && isLowStock && (
                          <span className="inline-flex items-center gap-1 rounded-md bg-amber-500/10 text-amber-500 border border-amber-500/20 px-1.5 py-0.2 font-mono">
                            <Boxes className="size-2" />
                            <span>{qtyCell(p.min_stock)}</span>
                          </span>
                        )}
                      </div>

                      {/* Price & Action Row */}
                      <div className="pt-2 border-t border-border/60 flex items-center justify-between gap-1.5 mt-auto">
                        <div className="min-w-0">
                          <p className="text-[9px] sm:text-[10px] text-muted-foreground font-medium">
                            {t("common.price")}
                          </p>
                          <p className="font-mono font-bold text-sm sm:text-base text-foreground tracking-tight truncate">
                            {moneyCell(p.sale_price)}
                          </p>
                          {canViewCost && show("cost") && p.cost_price != null && (
                            <p className="text-[9px] font-mono text-muted-foreground/70 truncate">
                              {lang === "ar" ? "التكلفة: " : "Cost: "}
                              {moneyCell(p.cost_price)}
                            </p>
                          )}
                        </div>

                        {/* Quick Action Buttons */}
                        <div className="flex items-center gap-1 shrink-0">
                          {/* Quick Toggle Active Status */}
                          <IconButton
                            size="sm"
                            variant="ghost"
                            tooltip
                            ariaLabel={
                              p.is_active
                                ? lang === "ar"
                                  ? "تعطيل المنتج"
                                  : "Deactivate"
                                : lang === "ar"
                                  ? "تفعيل المنتج"
                                  : "Activate"
                            }
                            icon={
                              <Power
                                className={`size-3.5 ${p.is_active ? "text-emerald-500" : "text-muted-foreground"}`}
                              />
                            }
                            round
                            onClick={(event) => {
                              event.stopPropagation();
                              toggleProductActiveMutation.mutate({
                                id: p.id,
                                isActive: !p.is_active,
                              });
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
          ) : error && products.length === 0 ? (
            productLoadError
          ) : sortedRows.length === 0 ? (
            <div className="card-mullak p-12 text-center flex flex-col items-center justify-center space-y-3">
              <div className="grid size-14 place-items-center rounded-2xl bg-muted/30 text-muted-foreground">
                <Package className="size-8" />
              </div>
              <h4 className="text-base font-bold text-foreground">{t("products.no_products")}</h4>
              <p className="text-xs text-muted-foreground max-w-sm">{t("products.empty_hint")}</p>
              <Button size="sm" icon={<Plus />} onClick={() => openNew()}>
                {t("common.new")}
              </Button>
            </div>
          ) : (
            <>
              <div className="space-y-2.5">
                {sortedRows.map((p) => {
                  const primary = lang === "ar" ? p.name_ar || p.name : p.name || p.name_ar || "—";
                  const other = lang === "ar" ? p.name : p.name_ar;
                  const secondary =
                    show("nameEn") && other && other.trim() && other.trim() !== primary.trim()
                      ? other
                      : null;
                  const categoryName = categoryLabel(p.category);

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
                        setSelectedProductDetail(p);
                      }}
                      className="card-mullak group relative flex flex-col md:flex-row md:items-center justify-between gap-3 p-3.5 sm:p-4 rounded-2xl cursor-pointer border transition-all duration-200 hover:border-primary/50 hover:shadow-md"
                    >
                      {/* Right section: Colored Accent Bar + Avatar + Product Names & Tags */}
                      <div className="flex items-center gap-3 min-w-0 flex-1">
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
                            {show("category") && categoryName && (
                              <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 border border-primary/20 px-2 py-0.5 text-[10px] font-semibold text-primary shrink-0">
                                <Tag className="size-2.5" />
                                <span>{categoryName}</span>
                              </span>
                            )}
                            {show("role") && (
                              <ItemRoleBadge
                                itemClass={p.item_class}
                                itemNature={p.item_nature}
                                inventoryPolicy={p.inventory_policy}
                                isRtl={lang === "ar"}
                                compact
                              />
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
                            {show("brand") && p.brand && (
                              <span className="rounded-md bg-surface-2/80 px-2 py-0.5 border border-border/50 text-[10px]">
                                {label(p.brand.name, p.brand.name_ar)}
                              </span>
                            )}
                            {show("barcode") && p.barcode ? (
                              <span className="inline-flex items-center gap-1 rounded-md bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground border border-border/50">
                                <Barcode className="size-2.5" />
                                <span>{p.barcode}</span>
                              </span>
                            ) : show("sku") && p.sku ? (
                              <span className="rounded-md bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                                {p.sku}
                              </span>
                            ) : null}
                          </div>
                        </div>
                      </div>

                      {/* Middle section: Shelf location, Min stock, Status */}
                      <div className="flex items-center gap-3 sm:gap-4 shrink-0 text-xs ps-4 md:ps-0">
                        {show("shelf") && p.shelf_location && (
                          <div className="hidden sm:flex items-center gap-1 text-muted-foreground bg-surface-2/60 px-2.5 py-1 rounded-xl border border-border/40 text-[11px]">
                            <MapPin className="size-3 text-muted-foreground" />
                            <span className="font-mono">{p.shelf_location}</span>
                          </div>
                        )}

                        {show("minStock") && isLowStock && (
                          <div className="flex items-center gap-1 text-amber-500 bg-amber-500/10 border border-amber-500/20 px-2.5 py-1 rounded-xl text-[11px] font-mono">
                            <Boxes className="size-3" />
                            <span>{qtyCell(p.min_stock)}</span>
                          </div>
                        )}

                        {show("status") && (
                          <StatusBadge tone={p.is_active ? "success" : "neutral"} dot>
                            {p.is_active ? t("common.active") : t("common.inactive")}
                          </StatusBadge>
                        )}
                      </div>

                      {/* Left section: Price + Actions */}
                      <div className="flex items-center justify-between md:justify-end gap-3 pt-2 md:pt-0 border-t md:border-t-0 border-border/50 shrink-0 ps-4 md:ps-0">
                        <div className="text-start md:text-end">
                          <p className="font-mono font-bold text-base sm:text-lg text-foreground tracking-tight">
                            {moneyCell(p.sale_price)}
                          </p>
                          {canViewCost && show("cost") && p.cost_price != null && (
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
                            variant="ghost"
                            tooltip
                            ariaLabel={lang === "ar" ? "عرض التفاصيل" : "View details"}
                            icon={<Eye className="size-3.5 text-primary" />}
                            round
                            onClick={(event) => {
                              event.stopPropagation();
                              setSelectedProductDetail(p);
                            }}
                          />
                          <IconButton
                            size="sm"
                            variant="ghost"
                            tooltip
                            ariaLabel={
                              p.is_active
                                ? lang === "ar"
                                  ? "تعطيل المنتج"
                                  : "Deactivate"
                                : lang === "ar"
                                  ? "تفعيل المنتج"
                                  : "Activate"
                            }
                            icon={
                              <Power
                                className={`size-3.5 ${p.is_active ? "text-emerald-500" : "text-muted-foreground"}`}
                              />
                            }
                            round
                            onClick={(event) => {
                              event.stopPropagation();
                              toggleProductActiveMutation.mutate({
                                id: p.id,
                                isActive: !p.is_active,
                              });
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
            rows={sortedRows}
            rowKey={(p) => p.id}
            loading={isLoading}
            initialLoading={isLoading}
            refreshing={isFetching && !isLoading && !isFetchingNextPage}
            error={(error as Error) ?? null}
            onRetry={retryProducts}
            sort={sort}
            onSortChange={setSort}
            infinite
            hasMore={Boolean(hasNextPage)}
            onLoadMore={loadMoreProducts}
            loadingMore={isFetchingNextPage}
            pageSize={PRODUCTS_PAGE_SIZE}
            totalCount={productCount}
            minWidth={canViewCost ? 1050 : 930}
            horizontalScroll={tableUsesHorizontalScroll}
            stickyHeader
            onRowClick={(product) => {
              setSelectedProductDetail(product);
            }}
            empty={{
              icon: <Package />,
              title: t("products.no_products"),
              description: t("products.empty_hint"),
              action: (
                <Button size="sm" icon={<Plus />} onClick={() => openNew()}>
                  {t("common.new")}
                </Button>
              ),
            }}
          />
        </div>
      )}

      {/* ─── Luxury Product Detail Sheet (Drawer) ─── */}
      {selectedProductDetail && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-end bg-black/65 backdrop-blur-xs animate-in fade-in duration-200"
          onClick={() => setSelectedProductDetail(null)}
        >
          <div
            className="h-full w-full max-w-lg border-s border-border/80 bg-background/95 backdrop-blur-md p-6 shadow-2xl overflow-y-auto animate-in slide-in-from-left duration-200"
            onClick={(e) => e.stopPropagation()}
            dir={lang === "ar" ? "rtl" : "ltr"}
          >
            {/* Ambient decorative blur */}
            <div className="absolute -top-10 -right-10 size-40 rounded-full bg-primary/20 blur-3xl pointer-events-none" />

            {/* Header */}
            <div className="flex items-start justify-between pb-4 border-b border-border/60">
              <div className="flex items-center gap-3.5">
                <div className="grid size-14 place-items-center rounded-2xl bg-primary/10 text-primary font-bold text-xl border border-primary/20 shadow-sm">
                  <Package className="size-6 text-primary" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-foreground">
                    {lang === "ar"
                      ? selectedProductDetail.name_ar || selectedProductDetail.name
                      : selectedProductDetail.name || selectedProductDetail.name_ar}
                  </h3>
                  {showDetail("nameEn") &&
                    (lang === "ar"
                      ? selectedProductDetail.name
                      : selectedProductDetail.name_ar) && (
                      <p
                        className="text-xs text-muted-foreground"
                        dir={lang === "ar" ? "ltr" : "rtl"}
                      >
                        {lang === "ar" ? selectedProductDetail.name : selectedProductDetail.name_ar}
                      </p>
                    )}
                  <div className="mt-0.5 flex items-center gap-2">
                    {showDetail("status") && (
                      <span
                        className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold ${
                          selectedProductDetail.is_active
                            ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-400"
                            : "border-border bg-muted text-muted-foreground"
                        }`}
                      >
                        {selectedProductDetail.is_active
                          ? t("common.active")
                          : t("common.inactive")}
                      </span>
                    )}
                    {showDetail("role") && (
                      <ItemRoleBadge
                        itemClass={selectedProductDetail.item_class}
                        itemNature={selectedProductDetail.item_nature}
                        inventoryPolicy={selectedProductDetail.inventory_policy}
                        isRtl={lang === "ar"}
                        compact
                      />
                    )}
                    {showDetail("sku") && selectedProductDetail.sku && (
                      <span className="font-mono text-xs text-muted-foreground">
                        SKU: {selectedProductDetail.sku}
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedProductDetail(null)}
                className="grid size-9 place-items-center rounded-full bg-surface-2 text-muted-foreground hover:text-foreground transition"
              >
                <X className="size-4" />
              </button>
            </div>

            {/* Financial Overview Cards */}
            <div className="mt-5 grid grid-cols-2 gap-3">
              <div className="rounded-2xl border border-border/70 bg-card p-4">
                <span className="text-[11px] font-bold text-muted-foreground block mb-1">
                  {lang === "ar" ? "سعر البيع" : "Sale Price"}
                </span>
                <span className="text-xl font-black font-mono text-foreground">
                  {moneyCell(selectedProductDetail.sale_price)}
                </span>
              </div>

              {canViewCost && showDetail("cost") && (
                <div className="rounded-2xl border border-border/70 bg-card p-4">
                  <span className="text-[11px] font-bold text-muted-foreground block mb-1">
                    {lang === "ar" ? "سعر التكلفة" : "Cost Price"}
                  </span>
                  <span className="text-xl font-black font-mono text-muted-foreground">
                    {selectedProductDetail.cost_price != null
                      ? moneyCell(selectedProductDetail.cost_price)
                      : "—"}
                  </span>
                </div>
              )}

              {showDetail("minStock") && (
                <div className="rounded-2xl border border-border/70 bg-card p-4">
                  <span className="text-[11px] font-bold text-muted-foreground block mb-1">
                    {lang === "ar" ? "حد أدنى المخزون" : "Min Stock Alert"}
                  </span>
                  <span className="text-lg font-black font-mono text-amber-500">
                    {qtyCell(selectedProductDetail.min_stock)}
                  </span>
                </div>
              )}

              {showDetail("tax") && (
                <div className="rounded-2xl border border-border/70 bg-card p-4">
                  <span className="text-[11px] font-bold text-muted-foreground block mb-1">
                    {lang === "ar" ? "الضريبة" : "Tax Rate"}
                  </span>
                  <span className="text-lg font-black font-mono text-foreground">
                    {selectedProductDetail.tax_rate ? `${selectedProductDetail.tax_rate}%` : "0%"}
                  </span>
                </div>
              )}
            </div>

            {/* Attribute & Specifications Grid */}
            <div className="mt-5 rounded-2xl border border-border/70 bg-card p-4 space-y-3 text-xs">
              {showDetail("category") && (
                <div className="flex items-center justify-between border-b border-border/40 pb-2">
                  <span className="text-muted-foreground">
                    {lang === "ar" ? "التصنيف" : "Category"}
                  </span>
                  <span className="font-semibold text-foreground">
                    {categoryLabel(selectedProductDetail.category) ??
                      (lang === "ar" ? "بدون تصنيف" : "Uncategorized")}
                  </span>
                </div>
              )}

              {showDetail("brand") && selectedProductDetail.brand && (
                <div className="flex items-center justify-between border-b border-border/40 pb-2">
                  <span className="text-muted-foreground">
                    {lang === "ar" ? "العلامة التجارية" : "Brand"}
                  </span>
                  <span className="font-semibold text-foreground">
                    {label(selectedProductDetail.brand.name, selectedProductDetail.brand.name_ar)}
                  </span>
                </div>
              )}

              {showDetail("unit") && selectedProductDetail.unit && (
                <div className="flex items-center justify-between border-b border-border/40 pb-2">
                  <span className="text-muted-foreground">
                    {lang === "ar" ? "وحدة القياس" : "Unit"}
                  </span>
                  <span className="font-semibold text-foreground">
                    {selectedProductDetail.unit.name_ar || selectedProductDetail.unit.name}
                  </span>
                </div>
              )}

              {showDetail("barcode") && selectedProductDetail.barcode && (
                <div className="flex items-center justify-between border-b border-border/40 pb-2">
                  <span className="text-muted-foreground">
                    {lang === "ar" ? "الباركود" : "Barcode"}
                  </span>
                  <div className="flex items-center gap-1.5 font-mono font-bold text-foreground">
                    <span>{selectedProductDetail.barcode}</span>
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard.writeText(selectedProductDetail.barcode!);
                        toast.success(lang === "ar" ? "تم نسخ الباركود" : "Barcode copied");
                      }}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <Copy className="size-3.5" />
                    </button>
                  </div>
                </div>
              )}

              {showDetail("shelf") && selectedProductDetail.shelf_location && (
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">
                    {lang === "ar" ? "موقع الرف" : "Shelf Location"}
                  </span>
                  <span className="font-mono text-foreground font-semibold">
                    {selectedProductDetail.shelf_location}
                  </span>
                </div>
              )}
            </div>

            {/* Quick Actions Footer */}
            <div className="mt-6 flex items-center gap-2 pt-4 border-t border-border/60">
              <Button
                variant="outline"
                className="flex-1 rounded-xl gap-2 font-bold"
                onClick={() => {
                  setEditing(selectedProductDetail);
                  setSelectedProductDetail(null);
                  setOpen(true);
                }}
              >
                <Pencil className="size-4" />
                <span>{t("common.edit")}</span>
              </Button>
              <Button
                variant="outline"
                className="rounded-xl gap-2 font-bold"
                onClick={() => {
                  toggleProductActiveMutation.mutate({
                    id: selectedProductDetail.id,
                    isActive: !selectedProductDetail.is_active,
                  });
                  setSelectedProductDetail({
                    ...selectedProductDetail,
                    is_active: !selectedProductDetail.is_active,
                  });
                }}
              >
                <Power
                  className={`size-4 ${
                    selectedProductDetail.is_active ? "text-emerald-500" : "text-muted-foreground"
                  }`}
                />
                <span>
                  {selectedProductDetail.is_active
                    ? lang === "ar"
                      ? "تعطيل"
                      : "Deactivate"
                    : lang === "ar"
                      ? "تفعيل"
                      : "Activate"}
                </span>
              </Button>
            </div>
          </div>
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
            // The list and its count changed. Taxonomy lookups are deliberately
            // NOT invalidated here: saving a product never adds a category, and
            // re-reading all five lookup tables on every save is pure waste.
            void qc.invalidateQueries({ queryKey: productKeys.all, refetchType: "active" });
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
  // إعدادات إظهار الحقول موحّدة عبر الشاشة والفورم: نفس المصدر، نفس الزر.
  const { isVisible: isFieldVisible } = useProductFieldVisibility();
  const showForm = (key: ProductFieldKey) => isFieldVisible("form", key);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<"general" | "pricing" | "specs" | "policy">("general");
  const policyFromProduct = (product: ProductRow): UserItemPolicyPreferences => ({
    item_nature: product.item_nature ?? "GOOD",
    inventory_policy: product.inventory_policy ?? "TRACKED",
    tracking: product.tracking ?? "NONE",
    costing_method: product.costing_method ?? "MOVING_AVERAGE",
    is_sellable: product.is_sellable ?? true,
    is_purchasable: product.is_purchasable ?? true,
  });
  const [policy, setPolicy] = useState<UserItemPolicyPreferences>(() =>
    initial
      ? policyFromProduct(initial)
      : userId
        ? readUserItemPolicyPreferences(userId)
        : DEFAULT_USER_ITEM_POLICY_PREFERENCES,
  );
  const [form, setForm] = useState({
    name: initial?.name ?? "",
    name_ar: initial?.name_ar ?? "",
    sku: initial?.sku ?? "",
    barcode: initial?.barcode ?? initialBarcode ?? "",
    category_id: initial?.category_id ?? "",
    brand_id: initial?.brand_id ?? "",
    unit_id: initial?.unit_id ?? "",
    cost_price: initial?.cost_price != null ? String(initial.cost_price) : "",
    sale_price: initial?.sale_price != null ? String(initial.sale_price) : "",
    tax_rate: initial?.tax_rate != null ? String(initial.tax_rate) : "",
    min_stock: initial?.min_stock != null ? String(initial.min_stock) : "",
    shelf_location: initial?.shelf_location ?? "",
    origin_id: initial?.origin_id ?? "",
    quality_grade_id: initial?.quality_grade_id ?? "",
    is_active: initial?.is_active ?? true,
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setPolicy(
      initial
        ? policyFromProduct(initial)
        : userId
          ? readUserItemPolicyPreferences(userId)
          : DEFAULT_USER_ITEM_POLICY_PREFERENCES,
    );
  }, [initial, userId]);

  useKeyboardWedge({
    onScan: (barcode) => {
      setForm((current) => ({ ...current, barcode }));
      toast.success(lang === "ar" ? "تمت قراءة الباركود" : "Barcode received", { duration: 1500 });
    },
    disabled: !isModuleEnabled("barcode") || scannerOpen,
  });

  const costNum = Number(form.cost_price) || 0;
  const saleNum = Number(form.sale_price) || 0;
  const profitNum = saleNum - costNum;
  const marginPercent = saleNum > 0 ? Math.round((profitNum / saleNum) * 100) : 0;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    if (!form.name_ar.trim()) {
      toast.error(
        lang === "ar"
          ? "اسم المنتج بالعربية مطلوب لظهوره بشكل صحيح في بطاقات النظام."
          : "An Arabic product name is required for the Yemen catalogue.",
      );
      setActiveTab("general");
      return;
    }
    const policyCheck = validateItemPolicy(policy);
    if (!policyCheck.valid) {
      toast.error(lang === "ar" ? policyCheck.errors[0] : "The selected item policy is not valid.");
      setActiveTab("policy");
      return;
    }
    setSaving(true);
    /*
     * `try/finally` is what actually guarantees the form unlocks.
     *
     * Before this, `setSaving(false)` ran after the awaited write and *before*
     * the error branch — so a rejected promise (offline, DNS failure, aborted
     * fetch) skipped it entirely and left the Save button spinning forever with
     * no way to retry except closing the drawer. `finally` runs on success, on a
     * returned PostgREST error, and on a thrown network error alike.
     */
    try {
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
        item_nature: policy.item_nature,
        inventory_policy: policy.inventory_policy,
        tracking: policy.tracking,
        costing_method: policy.costing_method,
        is_sellable: policy.is_sellable,
        is_purchasable: policy.is_purchasable,
      };
      const request: any = initial
        ? (supabase.from("products") as any)
            .update(payload)
            .eq("id", initial.id)
            .select("id")
            .single()
        : (supabase.from("products") as any).insert(payload).select("id").single();
      const { error: writeError } = await request;

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

      if (userId) saveUserItemPolicyPreferences(userId, policy);
      toast.success(
        lang === "ar"
          ? initial
            ? "تم تحديث المنتج وحفظ إعداداتك لهذا المستخدم"
            : "تم إنشاء المنتج وحفظ إعداداتك لهذا المستخدم"
          : initial
            ? "Product updated; your settings were saved for this user"
            : "Product created; your settings were saved for this user",
      );
      onSaved();
    } catch (unexpectedError) {
      // Never surface a raw stack or driver payload to the operator.
      console.error("[products] save failed", unexpectedError);
      toast.error(
        lang === "ar"
          ? "تعذّر الاتصال بالخادم أثناء الحفظ. تحقق من الاتصال ثم أعد المحاولة."
          : "Could not reach the server while saving. Check the connection and try again.",
      );
    } finally {
      setSaving(false);
    }
  }

  const labelOf = (en: string, ar: string | null) => (lang === "ar" ? ar || en : en || ar || "");
  const currentCategory = meta.categories.find((c) => c.id === form.category_id);

  return (
    <VortexDrawerDialog
      open={true}
      onOpenChange={(isOpen) => {
        if (!isOpen) onClose();
      }}
      size="xl"
      title={
        <div className="flex items-center gap-2">
          <span className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Package className="size-4" />
          </span>
          <span>{initial ? t("products.edit_product") : t("products.new_product")}</span>
        </div>
      }
      subtitle={
        initial
          ? lang === "ar"
            ? "تعديل مواصفات الصنف وهوامش التسعير والسياسات"
            : "Update product specs, margins, and policies"
          : lang === "ar"
            ? "تعريف صنف جديد بأسلوب بطاقة المكونات الأنيقة"
            : "Define a new catalog item with luxury details"
      }
      footer={
        <div className="flex w-full items-center justify-between gap-3 border-t border-border/40 pt-3">
          <div className="flex items-center gap-2">
            <label className="relative inline-flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={form.is_active}
                onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
                className="size-4 rounded border-border accent-primary"
              />
              <span className="text-xs font-semibold text-foreground/80">
                {form.is_active
                  ? lang === "ar"
                    ? "صنف نشط"
                    : "Active"
                  : lang === "ar"
                    ? "صنف معطل"
                    : "Inactive"}
              </span>
            </label>
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              className="min-w-[90px] rounded-xl text-xs font-medium"
            >
              {t("common.cancel")}
            </Button>
            <Button
              type="submit"
              form="product-form"
              loading={saving}
              className="min-w-[130px] rounded-xl bg-primary text-xs font-semibold text-primary-foreground shadow-sm hover:bg-primary/95"
            >
              <Check className="me-1 size-3.5" />
              {t("common.save")}
            </Button>
          </div>
        </div>
      }
    >
      <form id="product-form" onSubmit={submit} className="flex flex-col gap-5">
        {/* Luxury Product Showcase Card */}
        <div className="relative overflow-hidden rounded-2xl border border-border/60 bg-gradient-to-br from-card via-card/90 to-primary/5 p-4 shadow-xs sm:p-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0 flex-1 space-y-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center rounded-md bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
                  {currentCategory
                    ? labelOf(currentCategory.name, currentCategory.name_ar)
                    : lang === "ar"
                      ? "بدون تصنيف"
                      : "Uncategorized"}
                </span>
                {form.barcode && (
                  <span className="inline-flex items-center gap-1 rounded-md bg-muted/80 px-2 py-0.5 text-[11px] font-mono text-muted-foreground">
                    <Barcode className="size-3" />
                    {toSystemDigits(form.barcode)}
                  </span>
                )}
                <span
                  className={cn(
                    "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium",
                    form.is_active
                      ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                      : "bg-muted text-muted-foreground",
                  )}
                >
                  <span
                    className={cn(
                      "size-1.5 rounded-full",
                      form.is_active ? "bg-emerald-500" : "bg-muted-foreground",
                    )}
                  />
                  {form.is_active
                    ? lang === "ar"
                      ? "نشط"
                      : "Active"
                    : lang === "ar"
                      ? "معطل"
                      : "Inactive"}
                </span>
              </div>
              <h3 className="truncate text-base font-bold text-foreground sm:text-lg">
                {form.name_ar.trim() ||
                  form.name.trim() ||
                  (lang === "ar" ? "اسم المنتج الجديد..." : "New Product Name...")}
              </h3>
              {form.name_ar.trim() && form.name.trim() && (
                <p className="truncate text-xs text-muted-foreground">{form.name}</p>
              )}
            </div>

            {/* Live Financial Metrics preview */}
            {canViewCost && (
              <div className="flex items-center gap-3 rounded-xl border border-border/40 bg-background/80 p-3 backdrop-blur-xs">
                <div className="text-center sm:text-end">
                  <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                    {lang === "ar" ? "هامش الربح المتوقع" : "Expected Margin"}
                  </div>
                  <div className="flex items-center justify-center gap-1 font-mono text-sm font-bold text-foreground sm:justify-end">
                    <span
                      className={cn(
                        profitNum >= 0
                          ? "text-emerald-600 dark:text-emerald-400"
                          : "text-rose-600 dark:text-rose-400",
                      )}
                    >
                      {profitNum > 0 ? "+" : ""}
                      {toSystemDigits(profitNum.toFixed(2))} {getCompanyCurrencySymbol()}
                    </span>
                  </div>
                </div>
                <div
                  className={cn(
                    "flex flex-col items-center justify-center rounded-lg px-2.5 py-1 text-center font-mono text-xs font-bold",
                    profitNum >= 0
                      ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                      : "bg-rose-500/10 text-rose-700 dark:text-rose-300",
                  )}
                >
                  <span className="text-[10px] font-normal opacity-80">
                    {lang === "ar" ? "العائد" : "ROI"}
                  </span>
                  <span>{marginPercent}%</span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Sleek Segmented Tabs */}
        <div className="flex items-center gap-1.5 overflow-x-auto rounded-xl border border-border/50 bg-muted/30 p-1 text-xs">
          <button
            type="button"
            onClick={() => setActiveTab("general")}
            className={cn(
              "flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 font-medium transition-all duration-150 whitespace-nowrap",
              activeTab === "general"
                ? "bg-card text-foreground shadow-xs font-semibold"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Package className="size-3.5" />
            <span>{lang === "ar" ? "البيانات الأساسية" : "Basic Info"}</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("pricing")}
            className={cn(
              "flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 font-medium transition-all duration-150 whitespace-nowrap",
              activeTab === "pricing"
                ? "bg-card text-foreground shadow-xs font-semibold"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <DollarSign className="size-3.5" />
            <span>{lang === "ar" ? "التسعير والربحية" : "Pricing & Margins"}</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("specs")}
            className={cn(
              "flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 font-medium transition-all duration-150 whitespace-nowrap",
              activeTab === "specs"
                ? "bg-card text-foreground shadow-xs font-semibold"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Layers className="size-3.5" />
            <span>{lang === "ar" ? "المخزون والمواصفات" : "Stock & Specs"}</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("policy")}
            className={cn(
              "flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 font-medium transition-all duration-150 whitespace-nowrap",
              activeTab === "policy"
                ? "bg-card text-foreground shadow-xs font-semibold"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <SlidersHorizontal className="size-3.5" />
            <span>{lang === "ar" ? "طبيعة وسياسة الصنف" : "Policies"}</span>
          </button>
        </div>

        {/* Tab 1: General Info */}
        {activeTab === "general" && (
          <div className="space-y-4 pt-1">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
                      lang === "ar" ? "أدخل اسم الصنف بالعربية..." : "Arabic product name..."
                    }
                  />
                )}
              </FormField>

              {showForm("nameEn") && (
                <FormField label={t("products.name_en")}>
                  {(p) => (
                    <VortexTextInput
                      id={p.id}
                      aria-describedby={p["aria-describedby"]}
                      dir="ltr"
                      clearable
                      value={form.name}
                      onChange={(e) => setForm({ ...form, name: e.target.value })}
                      placeholder={
                        lang === "ar" ? "English product name..." : "English product name..."
                      }
                    />
                  )}
                </FormField>
              )}
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {showForm("category") && (
                <FormField label={t("products.category")}>
                  {(p) => (
                    <select
                      id={p.id}
                      aria-describedby={p["aria-describedby"]}
                      value={form.category_id}
                      onChange={(e) => setForm({ ...form, category_id: e.target.value })}
                      className={cn(fieldSurfaceClass, "text-sm font-medium")}
                    >
                      <option value="">
                        {lang === "ar" ? "اختر التصنيف..." : "Select category..."}
                      </option>
                      {meta.categories.map((c) => (
                        <option key={c.id} value={c.id}>
                          {labelOf(c.name, c.name_ar)}
                        </option>
                      ))}
                    </select>
                  )}
                </FormField>
              )}

              {showForm("sku") && (
                <FormField
                  label={t("products.sku")}
                  hint={lang === "ar" ? "معرّف الصنف الفريد" : "Unique SKU code"}
                >
                  {(p) => (
                    <VortexTextInput
                      id={p.id}
                      aria-describedby={p["aria-describedby"]}
                      clearable
                      value={form.sku}
                      onChange={(e) => setForm({ ...form, sku: e.target.value })}
                      placeholder="PRD-001"
                    />
                  )}
                </FormField>
              )}

              {showForm("shelf") && (
                <FormField label={lang === "ar" ? "موقع الرف / المستودع" : "Shelf location"}>
                  {(p) => (
                    <VortexTextInput
                      id={p.id}
                      aria-describedby={p["aria-describedby"]}
                      clearable
                      value={form.shelf_location}
                      onChange={(e) => setForm({ ...form, shelf_location: e.target.value })}
                      placeholder={lang === "ar" ? "رف A-12" : "Shelf A-12"}
                    />
                  )}
                </FormField>
              )}
            </div>

            {isModuleEnabled("barcode") && showForm("barcode") && (
              <FormField
                label={t("products.barcode")}
                hint={lang === "ar" ? "رمز الباركود للمسح السريع" : "Fast scan barcode"}
              >
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
                      className="min-w-0 flex-1 font-mono"
                    />
                    <IconButton
                      type="button"
                      size="md"
                      variant="outline"
                      ariaLabel={lang === "ar" ? "مسح الباركود بالكاميرا" : "Scan barcode"}
                      icon={<Camera className="size-4" />}
                      onClick={() => setScannerOpen(true)}
                    />
                  </div>
                )}
              </FormField>
            )}
          </div>
        )}

        {/* Tab 2: Pricing & Margins */}
        {activeTab === "pricing" && (
          <div className="space-y-4 pt-1">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField
                label={t("common.price")}
                required
                hint={lang === "ar" ? "سعر البيع النهائي للعميل" : "Retail sale price"}
              >
                {(p) => (
                  <VortexCurrencyInput
                    id={p.id}
                    aria-describedby={p["aria-describedby"]}
                    value={form.sale_price === "" ? null : Number(form.sale_price)}
                    onValueChange={(num) =>
                      setForm({ ...form, sale_price: num == null ? "" : String(num) })
                    }
                    min={0}
                    currencySymbol={getCompanyCurrencySymbol()}
                    placeholder="0.00"
                  />
                )}
              </FormField>

              {canViewCost && showForm("cost") && (
                <FormField
                  label={t("common.cost")}
                  hint={lang === "ar" ? "تكلفة الشراء الأساسية" : "Unit cost price"}
                >
                  <VortexCurrencyInput
                    value={form.cost_price === "" ? null : Number(form.cost_price)}
                    onValueChange={(num) =>
                      setForm({ ...form, cost_price: num == null ? "" : String(num) })
                    }
                    min={0}
                    currencySymbol={getCompanyCurrencySymbol()}
                    placeholder="0.00"
                  />
                </FormField>
              )}
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {showForm("tax") && (
                <FormField label={t("products.tax_rate")}>
                  {(p) => (
                    <NumberInput
                      {...p}
                      value={form.tax_rate === "" ? null : Number(form.tax_rate)}
                      onValueChange={(v) =>
                        setForm({ ...form, tax_rate: v == null ? "" : String(v) })
                      }
                      min={0}
                      max={100}
                      suffix="%"
                      placeholder="0"
                    />
                  )}
                </FormField>
              )}

              {config.enableUnits && showForm("unit") && (
                <FormField label={t("products.unit")}>
                  {(p) => (
                    <select
                      id={p.id}
                      aria-describedby={p["aria-describedby"]}
                      value={form.unit_id}
                      onChange={(e) => setForm({ ...form, unit_id: e.target.value })}
                      className={cn(fieldSurfaceClass, "text-sm font-medium")}
                    >
                      <option value="">
                        {lang === "ar" ? "اختر وحدة القياس..." : "Select unit..."}
                      </option>
                      {meta.units.map((u) => (
                        <option key={u.id} value={u.id}>
                          {labelOf(u.name, u.name_ar)}
                        </option>
                      ))}
                    </select>
                  )}
                </FormField>
              )}
            </div>
          </div>
        )}

        {/* Tab 3: Specs & Inventory */}
        {activeTab === "specs" && (
          <div className="space-y-4 pt-1">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {showForm("minStock") && (
                <FormField
                  label={t("products.min")}
                  hint={
                    lang === "ar"
                      ? "حد التنبيه عند وصول المخزون لهذه الكمية"
                      : "Low-stock alert threshold"
                  }
                >
                  {(p) => (
                    <NumberInput
                      {...p}
                      value={form.min_stock === "" ? null : Number(form.min_stock)}
                      onValueChange={(v) =>
                        setForm({ ...form, min_stock: v == null ? "" : String(v) })
                      }
                      min={0}
                      decimal={false}
                      placeholder="1"
                    />
                  )}
                </FormField>
              )}

              {config.enableBrands && showForm("brand") && (
                <FormField label={t("products.brand")}>
                  {(p) => (
                    <select
                      id={p.id}
                      aria-describedby={p["aria-describedby"]}
                      value={form.brand_id}
                      onChange={(e) => setForm({ ...form, brand_id: e.target.value })}
                      className={cn(fieldSurfaceClass, "text-sm font-medium")}
                    >
                      <option value="">
                        {lang === "ar" ? "اختر العلامة التجارية..." : "Select brand..."}
                      </option>
                      {meta.brands.map((b) => (
                        <option key={b.id} value={b.id}>
                          {labelOf(b.name, b.name_ar)}
                        </option>
                      ))}
                    </select>
                  )}
                </FormField>
              )}
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {config.enableOrigins && (
                <FormField label={lang === "ar" ? "بلد المنشأ" : "Country of origin"}>
                  {(p) => (
                    <select
                      id={p.id}
                      aria-describedby={p["aria-describedby"]}
                      value={form.origin_id}
                      onChange={(e) => setForm({ ...form, origin_id: e.target.value })}
                      className={cn(fieldSurfaceClass, "text-sm font-medium")}
                    >
                      <option value="">
                        {lang === "ar" ? "اختر بلد المنشأ..." : "Select origin..."}
                      </option>
                      {meta.origins.map((o) => (
                        <option key={o.id} value={o.id}>
                          {lang === "ar" ? o.name_ar : o.name}
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
                      className={cn(fieldSurfaceClass, "text-sm font-medium")}
                    >
                      <option value="">
                        {lang === "ar" ? "اختر درجة الجودة..." : "Select quality grade..."}
                      </option>
                      {meta.qualities.map((q) => (
                        <option key={q.id} value={q.id}>
                          {lang === "ar" ? q.name_ar : q.name}
                        </option>
                      ))}
                    </select>
                  )}
                </FormField>
              )}
            </div>
          </div>
        )}

        {/* Tab 4: Item Nature & Policies */}
        {activeTab === "policy" && (
          <div className="space-y-4 rounded-xl border border-border/60 bg-muted/20 p-4 pt-3">
            <div className="space-y-4">
              <SettingsChoice
                label={lang === "ar" ? "طبيعة الصنف" : "Item nature"}
                value={policy.item_nature}
                options={[
                  { value: "GOOD", label: ITEM_NATURE_LABELS.GOOD[lang === "ar" ? "ar" : "en"] },
                  {
                    value: "SERVICE",
                    label: ITEM_NATURE_LABELS.SERVICE[lang === "ar" ? "ar" : "en"],
                  },
                ]}
                onChange={(value) =>
                  setPolicy((current) => ({
                    ...current,
                    item_nature: value as ItemNature,
                    inventory_policy: value === "SERVICE" ? "UNTRACKED" : current.inventory_policy,
                    tracking: value === "SERVICE" ? "NONE" : current.tracking,
                    costing_method: value === "SERVICE" ? "NONE" : current.costing_method,
                  }))
                }
              />

              {policy.item_nature === "GOOD" && (
                <SettingsChoice
                  label={lang === "ar" ? "سياسة المخزون" : "Inventory policy"}
                  value={policy.inventory_policy}
                  options={(["TRACKED", "UNTRACKED", "CUSTOMER_OWNED"] as InventoryPolicy[]).map(
                    (value) => ({
                      value,
                      label: INVENTORY_POLICY_LABELS[value][lang === "ar" ? "ar" : "en"],
                    }),
                  )}
                  onChange={(value) =>
                    setPolicy((current) => ({
                      ...current,
                      inventory_policy: value as InventoryPolicy,
                      tracking: value === "TRACKED" ? current.tracking : "NONE",
                    }))
                  }
                />
              )}

              {policy.item_nature === "GOOD" && policy.inventory_policy === "TRACKED" && (
                <SettingsChoice
                  label={lang === "ar" ? "طريقة التتبع" : "Tracking method"}
                  value={policy.tracking}
                  options={(["NONE", "BATCH", "SERIAL"] as ItemTracking[]).map((value) => ({
                    value,
                    label: TRACKING_LABELS[value][lang === "ar" ? "ar" : "en"],
                  }))}
                  onChange={(value) =>
                    setPolicy((current) => ({
                      ...current,
                      tracking: value as ItemTracking,
                    }))
                  }
                />
              )}

              <div className="grid grid-cols-1 gap-2 pt-2 sm:grid-cols-2">
                <SettingsToggle
                  label={lang === "ar" ? "متاح للبيع" : "Available for sales"}
                  description={
                    lang === "ar"
                      ? "إظهار الصنف في نقطة البيع وفواتير المبيعات"
                      : "Show in sales & POS"
                  }
                  checked={policy.is_sellable}
                  onChange={(checked) => setPolicy((c) => ({ ...c, is_sellable: checked }))}
                />
                <SettingsToggle
                  label={lang === "ar" ? "متاح للشراء" : "Available for purchase"}
                  description={
                    lang === "ar"
                      ? "إظهار الصنف في فواتير المشتريات والتوريد"
                      : "Show in purchases & supply"
                  }
                  checked={policy.is_purchasable}
                  onChange={(checked) => setPolicy((c) => ({ ...c, is_purchasable: checked }))}
                />
              </div>
            </div>
          </div>
        )}
      </form>

      {scannerOpen && (
        <BarcodeScanner
          open={scannerOpen}
          onClose={() => setScannerOpen(false)}
          onDetected={(detected) => {
            setForm((c) => ({ ...c, barcode: detected }));
            setScannerOpen(false);
            toast.success(lang === "ar" ? "تم مسح الباركود بنجاح" : "Barcode scanned");
          }}
        />
      )}
    </VortexDrawerDialog>
  );
}

function SettingsChoice({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex flex-col gap-2">
      <span className="text-xs font-semibold text-foreground">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={fieldSurfaceClass}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function SettingsToggle({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  /** نص توضيحي تحت العنوان. اختياري — يخفيه ركن التبديل إن لم يُمرَّر. */
  description?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-xl border-border bg-surface p-3 text-sm">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-0.5 size-4 accent-[var(--primary)]"
      />
      <span>
        <span>{label}</span>
        {description && (
          <span className="mt-0.5 block text-[11px] text-muted-foreground">{description}</span>
        )}
      </span>
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

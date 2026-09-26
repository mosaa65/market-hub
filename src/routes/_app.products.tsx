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
  Search,
  Pencil,
  Trash2,
  X,
  SlidersHorizontal,
  ExternalLink,
  Power,
  Camera,
  ScanBarcode,
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
  compatibilities?: { vehicle_model_id: string }[];
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
  const { hasRole, isPlatformAdmin, isPlatformSuperadmin } = useAuth();
  const canViewCost =
    isPlatformAdmin ||
    isPlatformSuperadmin ||
    hasRole("owner") ||
    hasRole("manager") ||
    hasRole("accountant");
  const qc = useQueryClient();
  const searchParams = Route.useSearch();
  const breakpoint = useBreakpoint();
  const tableUsesHorizontalScroll = breakpoint === "xs" || breakpoint === "sm" || breakpoint === "md";
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<FilterValues>({});
  const [sort, setSort] = useState<DataTableSort | null>(null);
  const [editing, setEditing] = useState<ProductRow | null>(null);
  const [open, setOpen] = useState(false);
  const [prefillBarcode, setPrefillBarcode] = useState<string | undefined>(undefined);

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
      const { data: page, error: productError } = await (supabase.from("products") as any)
        .select(
          "id, name, name_ar, sku, barcode, sale_price, cost_price, tax_rate, min_stock, shelf_location, origin_id, quality_grade_id, is_active, category_id, brand_id, unit_id, category:categories(name, name_ar), brand:brands(name, name_ar), unit:units(short_name, name_ar), origin:countries_of_origin(id, name, name_ar, code), quality:quality_grades(id, name, name_ar, code, sort_order)",
        )
        .order("created_at", { ascending: false })
        .range(from, to);

      if (productError) throw productError;

      const productIds = ((page as ProductRow[] | null) ?? []).map((product) => product.id);
      const { data: compatibilityRows, error: compatibilityError } = productIds.length
        ? await (supabase as any)
            .from("product_compatibilities")
            .select("product_id, vehicle_model_id")
            .in("product_id", productIds)
        : { data: [], error: null };

      if (compatibilityError) throw compatibilityError;

      const compatibilityByProduct: Record<string, { vehicle_model_id: string }[]> = {};
      for (const compatibility of compatibilityRows ?? []) {
        (compatibilityByProduct[compatibility.product_id] ??= []).push({
          vehicle_model_id: compatibility.vehicle_model_id,
        });
      }

      const rows = (page ?? []).map((product: any) => ({
        ...product,
        compatibilities: compatibilityByProduct[product.id] ?? [],
      })) as ProductRow[];

      return { rows, hasMore: rows.length === PRODUCTS_PAGE_SIZE };
    },
    getNextPageParam: (lastPage, pages) => (lastPage.hasMore ? pages.length : undefined),
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

  useRealtimeTable<ProductRow>({
    table: "products",
    queryKey: QUERY_KEYS.products,
    debounceMs: 100,
  }, qc);

  useEffect(() => {
    if (!searchParams.barcode) return;
    setEditing(null);
    setPrefillBarcode(searchParams.barcode);
    setOpen(true);
  }, [searchParams.barcode]);

  const { data: meta } = useQuery({
    queryKey: ["products-meta"],
    queryFn: async () => {
      const [c, b, u, origins, qualities, vMakes, vModels] = await Promise.all([
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
        (supabase as any).from("vehicle_makes").select("id, name, name_ar").order("name"),
        (supabase as any).from("vehicle_models").select("id, name, name_ar, make_id").order("name"),
      ]);
      return {
        categories: c.data ?? [],
        brands: b.data ?? [],
        units: u.data ?? [],
        origins: origins.data ?? [],
        qualities: qualities.data ?? [],
        makes: vMakes.data ?? [],
        models: vModels.data ?? [],
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
            <div className="min-w-[190px]">
              <div className="font-semibold text-foreground" dir={lang === "ar" ? "rtl" : "ltr"}>
                {primary}
              </div>
              {secondary ? (
                <div
                  className="text-[11px] text-muted-foreground"
                  dir={lang === "ar" ? "ltr" : "rtl"}
                >
                  {secondary}
                </div>
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
          <span className="text-muted-foreground">
            {label(p.category?.name, p.category?.name_ar)}
          </span>
        ),
      },
    ];

    cols.push({
      key: "shelf_location",
      header: lang === "ar" ? "موقع الرف" : "Shelf",
      width: "w-[120px]",
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
          <span className="font-mono text-[13px] tabular-nums">{moneyCell(p.cost_price)}</span>
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
          <span className="font-mono text-[13px] font-semibold tabular-nums text-foreground">
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
          <span className="font-mono text-[13px] tabular-nums text-muted-foreground">
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
        width: "w-[78px]",
        cell: (p) => (
          <div className="inline-flex items-center gap-0.5">
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
  }, [config, canViewCost, lang, t, meta?.models, meta?.makes]);

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
    <>
      <PageHeader title={t("products.title")} subtitle={t("products.subtitle")} />

      <div className="panel-elevated -mx-1 sm:mx-0">
        <DataTable
          className="px-0"
          columns={columns}
          rows={filtered}
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
          minWidth={canViewCost ? 900 : 780}
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
          toolbar={
            <TableToolbar
              search={{
                value: query,
                onValueChange: setQuery,
                placeholder: t("products.search"),
                resultCount: productCount ?? filtered.length,
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
              action={
                <ToolbarAction
                  label={t("common.new")}
                  icon={<Plus />}
                  tone="primary"
                  onClick={openNew}
                />
              }
            />
          }
        />
      </div>

      {open && (
        <ProductDialog
          initial={editing}
          initialBarcode={prefillBarcode}
          canViewCost={canViewCost}
          meta={
            meta ?? {
              categories: [],
              brands: [],
              units: [],
              origins: [],
              qualities: [],
              makes: [],
              models: [],
            }
          }
          onClose={() => {
            setOpen(false);
            setPrefillBarcode(undefined);
          }}
          onSaved={() => {
            setOpen(false);
            setPrefillBarcode(undefined);
            // Mark cached pages stale without tearing down the visible list.
            // Realtime applies the row-level event immediately, and navigation
            // performs the eventual background refresh.
            qc.invalidateQueries({ queryKey: QUERY_KEYS.products, refetchType: "none" });
            qc.invalidateQueries({ queryKey: ["products", "count"] });
            qc.invalidateQueries({ queryKey: ["products-meta"] });
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
    </>
  );
}

function ProductDialog({
  initial,
  initialBarcode,
  canViewCost = true,
  meta,
  onClose,
  onSaved,
}: {
  initial: ProductRow | null;
  initialBarcode?: string;
  canViewCost?: boolean;
  meta: {
    categories: { id: string; name: string; name_ar: string | null }[];
    brands: { id: string; name: string; name_ar: string | null }[];
    units: { id: string; name: string; name_ar: string | null; short_name: string }[];
    origins: { id: string; code: string; name: string; name_ar: string }[];
    qualities: { id: string; name: string; name_ar: string; code?: string; sort_order?: number }[];
    makes: { id: string; name: string; name_ar: string | null }[];
    models: { id: string; name: string; name_ar: string | null; make_id: string }[];
  };
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t, lang } = useI18n();
  const { config } = useCatalogModules();
  const { isModuleEnabled } = useModules();
  const [scannerOpen, setScannerOpen] = useState(false);
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
  // The row already carries its compatibility ids. Reusing them avoids a second
  // asynchronous request that could finish late and accidentally clear links on
  // save — especially important for the shared production database.
  const [compatibleModels, setCompatibleModels] = useState<string[]>(
    () => initial?.compatibilities?.map((compatibility) => compatibility.vehicle_model_id) ?? [],
  );

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
    const { data, error } = await request;
    let writeError = error;
    if (!writeError && config.enableMakesAndModels) {
      const savedProductId = data.id;
      const previouslySelected = new Set(
        initial?.compatibilities?.map((compatibility) => compatibility.vehicle_model_id) ?? [],
      );
      const nextSelected = new Set(compatibleModels);
      const toAdd = [...nextSelected].filter((id) => !previouslySelected.has(id));
      const toRemove = [...previouslySelected].filter((id) => !nextSelected.has(id));

      // Insert before removing. A failed request can therefore leave an extra
      // compatibility at worst, never erase an existing production record.
      if (toAdd.length) {
        const { error: insertError } = await (supabase as any)
          .from("product_compatibilities")
          .insert(toAdd.map((vehicle_model_id) => ({ product_id: savedProductId, vehicle_model_id })));
        writeError = insertError;
      }
      if (!writeError && toRemove.length) {
        const { error: deleteError } = await (supabase as any)
          .from("product_compatibilities")
          .delete()
          .eq("product_id", savedProductId)
          .in("vehicle_model_id", toRemove);
        writeError = deleteError;
      }
    }
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
    toast.success(
      lang === "ar"
        ? initial
          ? "تم تحديث المنتج بنجاح"
          : "تم إنشاء المنتج بنجاح"
        : initial
          ? t("products.updated")
          : t("products.created"),
    );
    onSaved();
  }

  const labelOf = (en: string, ar: string | null) => (lang === "ar" ? ar || en : en || ar || "");

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={initial ? t("products.edit_product") : t("products.new_product")}
      eyebrow={initial ? t("common.edit") : t("common.new")}
      footer={
        <FormActions
          sticky={false}
          fullWidth
          className="border-t-0 pt-0"
          cancel={
            <Button type="button" variant="outline" onClick={onClose}>
              {t("common.cancel")}
            </Button>
          }
          submit={
            <Button type="submit" form="product-form" loading={saving}>
              {t("common.save")}
            </Button>
          }
        />
      }
    >
      <form id="product-form" onSubmit={submit} className="flex flex-col gap-6">
        <FormSection title={lang === "ar" ? "بيانات المنتج" : "Product details"}>
          <FormGrid cols={3}>
            <FormField label={t("products.name_ar")} required>
              {(p) => (
                <FieldInput
                  {...p}
                  dir="rtl"
                  value={form.name_ar}
                  onValueChange={(v) => setForm({ ...form, name_ar: v })}
                />
              )}
            </FormField>

            <FormField label={t("products.name_en")}>
              {(p) => (
                <FieldInput
                  {...p}
                  dir="ltr"
                  value={form.name}
                  onValueChange={(v) => setForm({ ...form, name: v })}
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
                <FieldInput
                  {...p}
                  value={form.sku}
                  onValueChange={(v) => setForm({ ...form, sku: v })}
                />
              )}
            </FormField>

            {isModuleEnabled("barcode") && (
              <FormField label={t("products.barcode")}>
                {(p) => (
                  <div className="flex items-center gap-2">
                    <FieldInput
                      {...p}
                      dir="ltr"
                      value={form.barcode}
                      onValueChange={(v) => setForm({ ...form, barcode: v })}
                      containerClassName="min-w-0 flex-1"
                    />
                    <IconButton
                      type="button"
                      size="md"
                      variant="outline"
                      ariaLabel={lang === "ar" ? "مسح الباركود بالكاميرا" : "Scan barcode with camera"}
                      icon={<Camera />}
                      onClick={() => setScannerOpen(true)}
                    />
                  </div>
                )}
              </FormField>
            )}

            <FormField label={lang === "ar" ? "موقع الرف / المستودع" : "Shelf location"}>
              {(p) => (
                <FieldInput
                  {...p}
                  value={form.shelf_location}
                  onValueChange={(v) => setForm({ ...form, shelf_location: v })}
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
          config.enableUnits ||
          config.enableMakesAndModels) && (
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

              {config.enableMakesAndModels && (
                <FormField
                  span="full"
                  label={
                    lang === "ar"
                      ? "توافق المركبات والدراجات (من جدول الفهرس)"
                      : "Vehicle compatibility (from catalog)"
                  }
                  hint={
                    lang === "ar"
                      ? "اختر الطرازات المتوافقة مع هذا المنتج"
                      : "Select the vehicle models this product fits"
                  }
                >
                  <VehicleCompatibilityPicker
                    makes={meta.makes}
                    models={meta.models}
                    selectedModelIds={compatibleModels}
                    onChange={setCompatibleModels}
                    lang={lang}
                  />
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
                <NumberInput
                  value={form.cost_price === "" ? null : Number(form.cost_price)}
                  onValueChange={(v) =>
                    setForm({ ...form, cost_price: v == null ? "" : String(v) })
                  }
                  min={1}
                  suffix="﷼"
                />
              </FormField>
            )}

            <FormField label={t("common.price")} required>
              {(p) => (
                <NumberInput
                  {...p}
                  value={form.sale_price === "" ? null : Number(form.sale_price)}
                  onValueChange={(v) =>
                    setForm({ ...form, sale_price: v == null ? "" : String(v) })
                  }
                  min={0}
                  suffix="﷼"
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

      <div className="flex items-center gap-1.5 text-caption text-muted-foreground" aria-live="polite">
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
    </Modal>
  );
}

interface VehicleCompatibilityPickerProps {
  makes: { id: string; name: string; name_ar: string | null }[];
  models: { id: string; name: string; name_ar: string | null; make_id: string }[];
  selectedModelIds: string[];
  onChange: (ids: string[]) => void;
  lang: string;
}

function VehicleCompatibilityPicker({
  makes,
  models,
  selectedModelIds,
  onChange,
  lang,
}: VehicleCompatibilityPickerProps) {
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
      {/* Header controls: Search & Quick actions */}
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

      {/* Makes Horizontal Filter Strip */}
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

      {/* Models Grid */}
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

      {/* Selected Items Summary Tags (if any) */}
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

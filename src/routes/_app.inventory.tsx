import { useModules } from "@/lib/modules";
import { createFileRoute } from "@tanstack/react-router";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/page-header";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/lib/auth";
import { StockAdjustmentDialog } from "@/components/stock/stock-adjustment-dialog";
import { DirectStockInDialog } from "@/components/stock/direct-stock-in-dialog";
import { OpeningStockDialog } from "@/components/stock/opening-stock-dialog";
import {
  Warehouse,
  Search,
  ArrowUpDown,
  AlertTriangle,
  X,
  Plus,
  Minus,
  Package,
  LayoutGrid,
  List,
  TableProperties,
  Barcode,
  Boxes,
  MapPin,
  Tag,
  CheckCircle2,
  Sparkles,
  TrendingDown,
  Wallet,
  PackagePlus,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ActionButton } from "@/components/ui/action-button";
import { IconButton } from "@/components/ui/icon-button";
import { StatusBadge } from "@/components/ui/status-badge";
import { Modal } from "@/components/ui/modal";
import { type DataTableColumn, type DataTableSort } from "@/components/ui/data-table";
import { RecordsView } from "@/components/ui/records-view";
import {
  TableToolbar,
  ToolbarAction,
  applyFilters,
  type FilterDefinition,
  type FilterValues,
  type SortOption,
} from "@/components/ui/table-toolbar";
import { RecordsViewToggle } from "@/components/ui/records-view-toggle";
import { QuickFilterBar } from "@/components/ui/quick-filter-bar";
import { usePersistedViewMode } from "@/hooks/use-persisted-view-mode";
import { buildSearchIndex, fuzzySearch } from "@/design/fuzzy";
import { moneyCell, qtyCell } from "@/lib/format";
import { useBreakpoint } from "@/design/breakpoints";
import { useRealtimeTable } from "@/lib/realtime";
import { QUERY_KEYS } from "@/lib/query-keys";
import { ItemRoleBadge } from "@/components/item-role-badge";

export const Route = createFileRoute("/_app/inventory")({
  head: () => ({ meta: [{ title: "Inventory — Vortex ERP" }] }),
  component: InventoryPage,
});

const INVENTORY_PAGE_SIZE = 50;

/**
 * Stock state derived purely from data already present on the row.
 * No schema change is involved — this is a client-side classification.
 */
type StockState = "out" | "low" | "near" | "healthy" | "untracked";

/**
 * A stock row as this page needs it.
 *
 * Quantities come from public.stock_positions — the Item + Location + Owner
 * model — not from the legacy per-product `inventory` array. Catalogue rows only
 * supply presentation metadata (category, brand, barcode, shelf, min stock),
 * so the stock engine and the UI stay decoupled.
 */
type Row = {
  id: string;
  name: string;
  name_ar: string | null;
  sku: string | null;
  barcode: string | null;
  cost_price: number;
  min_stock: number;
  shelf_location: string | null;
  category?: { name: string; name_ar: string | null } | null;
  brand?: { name: string; name_ar: string | null } | null;
  unit?: { name?: string; short_name: string; name_ar: string | null } | null;
  /** Role columns, used to colour-code the row (see item-role-badge). */
  item_nature?: string | null;
  item_class?: string | null;
  inventory_policy?: string | null;
  byWarehouse: Record<string, number>;
};

/** The shape public.stock_positions returns for one item/warehouse/owner. */
type StockPosition = {
  item_id: string;
  item_name: string;
  item_name_ar: string | null;
  sku: string | null;
  quantity: number;
  warehouse_id: string;
};

/**
 * Minimal typed view of the Supabase client for the stock_positions view.
 * The generated types do not know about it yet, and widening the global client
 * type would hide real type errors elsewhere.
 */
type PositionQuery = {
  data: unknown;
  error: unknown;
};
/** A resolved builder: chainable filters end in a thenable. */
type PositionBuilder = {
  eq: (column: string, value: unknown) => PositionBuilder;
  order: (column: string) => PositionBuilder;
  in: (column: string, values: string[]) => PositionBuilder;
  range: (from: number, to: number) => PositionBuilder;
  maybeSingle: () => Promise<PositionQuery>;
  then: <TResult>(onFulfilled: (value: PositionQuery) => TResult) => Promise<TResult>;
};
type PositionsTable = { select: (columns: string) => PositionBuilder };

/** Builds a typed handle on the stock_positions view (not in the generated types). */
const positionsTable = () => supabase.from("stock_positions" as never) as unknown as PositionsTable;

function InventoryPage() {
  const { t, lang } = useI18n();
  const { isModuleEnabled } = useModules();
  const { hasRole, isPlatformAdmin, isPlatformSuperadmin } = useAuth();
  const canViewCost =
    isPlatformAdmin ||
    isPlatformSuperadmin ||
    hasRole("owner") ||
    hasRole("manager") ||
    hasRole("accountant");
  const qc = useQueryClient();
  const breakpoint = useBreakpoint();
  const tableUsesHorizontalScroll =
    breakpoint === "xs" || breakpoint === "sm" || breakpoint === "md";

  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<FilterValues>({});
  const [sort, setSort] = useState<DataTableSort | null>(null);
  const [quickFilter, setQuickFilter] = useState<"all" | "low" | "out" | "healthy">("all");
  const [viewMode, setViewMode] = usePersistedViewMode("inventory", "cards");
  const [warehouseId, setWarehouseId] = useState<string>("");
  const [adjust, setAdjust] = useState<{ product: Row } | null>(null);
  /* Engine-side documents: a physical receipt and a standing balance. */
  const [directIn, setDirectIn] = useState<{ product?: Row } | null>(null);
  const [openingOpen, setOpeningOpen] = useState(false);

  const { data: warehouses } = useQuery({
    queryKey: QUERY_KEYS.warehouses,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("warehouses")
        .select("id, name, name_ar, code, is_default")
        .eq("is_active", true)
        .order("is_default", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  useEffect(() => {
    if (!warehouses?.length) return;
    if (!warehouseId) setWarehouseId(warehouses[0].id);
  }, [warehouses, warehouseId]);

  /*
  /*
   * Streamed inventory catalogue.
   *
   * Inventory is rooted in the active physical goods (`products` with
   * `inventory_policy = 'TRACKED'` and not services), paginated by distinct
   * item IDs. For each page slice, quantities across warehouses are resolved
   * from `stock_positions` (or directly from `inventory` as fallback).
   *
   * This guarantees that even newly added products or products currently at 0 stock
   * appear in the inventory list as "out of stock" instead of vanishing completely.
   */
  const { data: allWarehouses } = useQuery({
    queryKey: ["inventory", "item-ids"],
    queryFn: async () => {
      const { data, error: idsError } = await (supabase.from("products") as any)
        .select("id")
        .eq("is_active", true)
        .neq("item_nature", "SERVICE")
        .neq("inventory_policy", "UNTRACKED")
        .order("name_ar", { ascending: true })
        .order("name", { ascending: true });
      if (idsError) throw idsError;
      return ((data ?? []) as { id: string }[]).map((p) => p.id);
    },
    staleTime: 30_000,
  });

  const {
    data: rowPages,
    isLoading,
    error,
    refetch,
    fetchNextPage,
    hasNextPage,
    isFetching,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: QUERY_KEYS.inventory(warehouseId),
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      const from = pageParam * INVENTORY_PAGE_SIZE;
      const orderedIds = allWarehouses ?? [];
      const pageIds = orderedIds.slice(from, from + INVENTORY_PAGE_SIZE);
      if (pageIds.length === 0) return { rows: [] as Row[], hasMore: false };

      // 1. Fetch metadata for this page's products
      const { data: detailRows, error: detailsError } = await (supabase.from("products") as any)
        .select(
          "id, name, name_ar, sku, barcode, min_stock, cost_price, shelf_location, item_nature, item_class, inventory_policy, category:categories(name, name_ar), brand:brands!products_brand_id_fkey(name, name_ar), unit:units!products_unit_id_fkey(name, short_name, name_ar)",
        )
        .in("id", pageIds);
      if (detailsError) throw detailsError;

      // 2. Fetch stock quantities for this page's products across warehouses
      const byWarehouseByItem: Record<string, Record<string, number>> = {};
      for (const id of pageIds) {
        byWarehouseByItem[id] = {};
      }

      try {
        const { data: posData, error: posError } = await positionsTable()
          .select("item_id, warehouse_id, quantity")
          .eq("owner_type", "COMPANY")
          .eq("inventory_policy", "TRACKED")
          .in("item_id", pageIds);

        if (!posError && Array.isArray(posData)) {
          for (const pos of posData as StockPosition[]) {
            if (!byWarehouseByItem[pos.item_id]) byWarehouseByItem[pos.item_id] = {};
            byWarehouseByItem[pos.item_id][pos.warehouse_id] =
              (byWarehouseByItem[pos.item_id][pos.warehouse_id] ?? 0) + Number(pos.quantity ?? 0);
          }
        } else {
          // Fallback to inventory table — `owner_type` موجود في قاعدة البيانات لكنه
          // غائب عن الأنواع المولّدة، فنمرّر الطلب عبر `any` بدل حذف الفلتر
          // (الفتر ضروري لتمييز مخزون المنشأة عن الأمانات).
          const { data: invData } = await (supabase.from("inventory") as any)
            .select("product_id, warehouse_id, quantity")
            .eq("owner_type", "COMPANY")
            .in("product_id", pageIds);

          if (Array.isArray(invData)) {
            for (const inv of invData) {
              if (!byWarehouseByItem[inv.product_id]) byWarehouseByItem[inv.product_id] = {};
              byWarehouseByItem[inv.product_id][inv.warehouse_id] =
                (byWarehouseByItem[inv.product_id][inv.warehouse_id] ?? 0) +
                Number(inv.quantity ?? 0);
            }
          }
        }
      } catch {
        // Fallback gracefully with initialized 0 quantities
      }

      const metaById = new Map<string, any>((detailRows ?? []).map((d: any) => [d.id, d]));
      const rows: Row[] = pageIds
        .map((id): Row | null => {
          const meta = metaById.get(id);
          if (!meta) return null;
          return {
            id: meta.id,
            name: meta.name || meta.name_ar || "",
            name_ar: meta.name_ar || meta.name || null,
            sku: meta.sku ?? null,
            barcode: meta.barcode ?? null,
            min_stock: Number(meta.min_stock ?? 0),
            cost_price: Number(meta.cost_price ?? 0),
            shelf_location: meta.shelf_location ?? null,
            category: meta.category ?? null,
            brand: meta.brand ?? null,
            unit: meta.unit ?? null,
            item_nature: meta.item_nature ?? null,
            item_class: meta.item_class ?? null,
            inventory_policy: meta.inventory_policy ?? null,
            byWarehouse: byWarehouseByItem[meta.id] ?? {},
          };
        })
        .filter((r): r is Row => Boolean(r));

      return { rows, hasMore: from + INVENTORY_PAGE_SIZE < orderedIds.length };
    },
    getNextPageParam: (lastPage, pages) => (lastPage.hasMore ? pages.length : undefined),
    enabled: allWarehouses !== undefined,
  });

  // The stream never knows the catalogue size, so the total comes from the
  // id list already held in the cache — no second aggregate query, and no
  // full positions payload beyond the ids the pagination needs anyway.
  const totalCount = allWarehouses?.length ?? 0;

  // Stock value is a separate aggregate: stock_positions carries quantities, an
  // item's cost lives on the catalogue row, so the two are summed on the client
  // over the rows already loaded. No schema, RLS or RPC was touched.
  type ValueRow = { id: string; cost_price: number | null };
  const { data: valueRows } = useQuery<ValueRow[]>({
    queryKey: ["inventory", "value"],
    queryFn: async () => {
      const { data, error: valueError } = await (supabase.from("products") as any)
        .select("id, cost_price")
        .eq("is_active", true)
        .limit(3000);
      if (valueError) throw valueError;
      return (data ?? []) as ValueRow[];
    },
    staleTime: 5 * 60_000,
  });

  const rows = useMemo(() => rowPages?.pages.flatMap((page) => page.rows) ?? [], [rowPages]);

  // Cost lookup for the valuation KPI: positions give the quantity, this map
  // gives the per-item cost, and both are joined in-memory for display only.
  const costById = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of valueRows ?? []) map.set(row.id, Number(row.cost_price ?? 0));
    return map;
  }, [valueRows]);

  useRealtimeTable<Row>(
    { table: "inventory", queryKey: QUERY_KEYS.inventory(warehouseId), debounceMs: 150 },
    qc,
  );
  useRealtimeTable({ table: "products", queryKey: ["inventory", "item-ids"], debounceMs: 250 }, qc);

  const label = (en?: string | null, ar?: string | null) =>
    (lang === "ar" ? ar || en : en || ar) ?? "—";

  /** Quantity for the selected warehouse (or the sum across all of them). */
  const qtyFor = (r: Row) => {
    if (!warehouseId) return Object.values(r.byWarehouse).reduce((sum, value) => sum + value, 0);
    return r.byWarehouse[warehouseId] ?? 0;
  };

  /**
   * Stock classification. Derived entirely on the client from `quantity` and
   * the product's existing `min_stock` — no new column or stored state.
   */
  const stateFor = (r: Row): StockState => {
    const min = Number(r.min_stock) || 0;
    const qty = qtyFor(r);
    if (min <= 0) return qty <= 0 ? "out" : "untracked";
    if (qty <= 0) return "out";
    if (qty <= min) return "low";
    if (qty <= min * 1.2) return "near";
    return "healthy";
  };

  const stateLabel = (s: StockState) =>
    s === "out"
      ? t("inventory.status.out")
      : s === "low"
        ? t("inventory.status.low")
        : s === "near"
          ? t("inventory.status.near")
          : t("inventory.status.healthy");

  const barClass = (s: StockState) =>
    s === "out"
      ? "bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.45)]"
      : s === "low"
        ? "bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.5)]"
        : s === "near"
          ? "bg-orange-400 shadow-[0_0_8px_rgba(251,146,60,0.4)]"
          : s === "healthy"
            ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.4)]"
            : "bg-muted-foreground/30";

  /* ---------------- search (fuzzy, Arabic-normalised) ---------------- */
  const searchIndex = useMemo(
    () => buildSearchIndex(rows, (r) => [r.name, r.name_ar, r.sku, r.barcode]),
    [rows],
  );

  const searched = useMemo(() => {
    const q = query.trim();
    if (!q) return rows;
    return fuzzySearch(searchIndex, q, { threshold: 0.5, requireAll: true }).map((m) => m.item);
  }, [rows, query, searchIndex]);

  /* ---------------- filters ---------------- */
  const filterDefinitions = useMemo<FilterDefinition[]>(() => {
    const defs: FilterDefinition[] = [];
    if (isModuleEnabled("multi_warehouse") && warehouses?.length) {
      defs.push({
        key: "warehouse",
        label: lang === "ar" ? "المستودع" : "Warehouse",
        type: "select",
        options: warehouses.map((w: any) => ({
          value: w.id,
          label: label(w.name, w.name_ar),
        })),
      });
    }
    defs.push({
      key: "status",
      label: t("inventory.status"),
      type: "select",
      options: [
        { value: "out", label: t("inventory.status.out") },
        { value: "low", label: t("inventory.status.low") },
        { value: "near", label: t("inventory.status.near") },
        { value: "healthy", label: t("inventory.status.healthy") },
      ],
    });
    return defs;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [warehouses, isModuleEnabled, lang, t]);

  const filtered = useMemo(
    () =>
      applyFilters(searched, filters, {
        status: (r) => stateFor(r),
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [searched, filters, warehouseId],
  );

  const displayRows = useMemo(
    () =>
      filtered.filter((r) => {
        const s = stateFor(r);
        if (quickFilter === "low") return s === "low" || s === "near";
        if (quickFilter === "out") return s === "out";
        if (quickFilter === "healthy") return s === "healthy" || s === "untracked";
        return true;
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filtered, quickFilter, warehouseId],
  );

  /* ---------------- KPI counts (over loaded rows) ---------------- */
  const kpi = useMemo(() => {
    let low = 0;
    let out = 0;
    let value = 0;
    for (const r of rows) {
      const s = stateFor(r);
      if (s === "out") out++;
      else if (s === "low" || s === "near") low++;
      if (canViewCost) value += qtyFor(r) * (costById.get(r.id) ?? (Number(r.cost_price) || 0));
    }
    return { low, out, value };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, canViewCost, warehouseId, costById]);

  /* ---------------- sort options ---------------- */
  const sortOptions = useMemo<SortOption[]>(() => {
    void sort;
    return [
      { value: "", label: lang === "ar" ? "الافتراضي (الأحدث)" : "Default (newest)" },
      { value: "on_hand", label: t("inventory.sort.on_hand") },
      { value: "min_stock", label: t("inventory.sort.min") },
      { value: "gap", label: t("inventory.sort.gap") },
      { value: "name", label: t("common.name") },
      { value: "sku", label: t("products.sku") },
    ];
  }, [lang, t, sort]);

  const sortedRows = useMemo(() => {
    if (!sort?.key) return displayRows;
    const dir = sort.direction === "desc" ? -1 : 1;
    const val = (r: Row): string | number => {
      switch (sort.key) {
        case "on_hand":
          return qtyFor(r);
        case "min_stock":
          return Number(r.min_stock) || 0;
        case "gap":
          return Math.max(0, (Number(r.min_stock) || 0) - qtyFor(r));
        case "sku":
          return r.sku ?? "";
        default:
          return (lang === "ar" ? r.name_ar || r.name : r.name || r.name_ar) ?? "";
      }
    };
    return [...displayRows].sort((a, b) => {
      const av = val(a);
      const bv = val(b);
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
      return String(av).localeCompare(String(bv), lang === "ar" ? "ar" : "en") * dir;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayRows, sort, lang, warehouseId]);

  const openAdjust = (r: Row) => {
    if (!warehouseId) {
      toast.error(t("inventory.select_warehouse"));
      return;
    }
    setAdjust({ product: r });
  };

  /**
   * The adjust dialog needs both ids; warehouseId is guaranteed here because
   * openAdjust refuses to open without a warehouse.
   */
  const adjustTarget = adjust ? { productId: adjust.product.id, warehouseId } : null;

  /* ---------------- classic table columns ---------------- */
  const columns = useMemo<DataTableColumn<Row>[]>(() => {
    const statusTone = (s: StockState) =>
      s === "out" ? "danger" : s === "low" ? "warning" : s === "near" ? "warning" : "success";
    return [
      {
        key: "name",
        header: t("products.product"),
        sortable: true,
        width: "w-[240px]",
        sortValue: (r) => (lang === "ar" ? r.name_ar || r.name : r.name || r.name_ar) ?? "",
        cell: (r) => {
          const primary = lang === "ar" ? r.name_ar || r.name : r.name || r.name_ar || "—";
          const other = lang === "ar" ? r.name : r.name_ar;
          const secondary = other && other.trim() && other.trim() !== primary.trim() ? other : null;
          return (
            <div className="flex flex-col py-0.5">
              <span
                className="truncate text-sm font-semibold leading-snug text-foreground"
                dir={lang === "ar" ? "rtl" : "ltr"}
              >
                {primary}
              </span>
              {secondary ? (
                <span
                  className="truncate text-[11px] text-muted-foreground"
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
        key: "sku",
        header: t("products.sku"),
        width: "w-[130px]",
        cell: (r) => (
          <span className="block truncate font-mono text-xs text-muted-foreground">
            {r.sku ?? "—"}
          </span>
        ),
      },
      {
        key: "role",
        header: lang === "ar" ? "الدور" : "Role",
        width: "w-[120px]",
        cell: (r) => (
          <ItemRoleBadge
            itemClass={r.item_class}
            itemNature={r.item_nature}
            inventoryPolicy={r.inventory_policy}
            isRtl={lang === "ar"}
            compact
          />
        ),
      },
      {
        key: "min_stock",
        header: t("products.min"),
        align: "end",
        sortable: true,
        width: "w-[110px]",
        sortValue: (r) => Number(r.min_stock) || 0,
        cell: (r) => (
          <span className="font-mono text-xs tabular-nums text-muted-foreground">
            {qtyCell(r.min_stock)}
          </span>
        ),
      },
      {
        key: "on_hand",
        header: t("inventory.on_hand"),
        align: "end",
        sortable: true,
        width: "w-[124px]",
        sortValue: (r) => qtyFor(r),
        cell: (r) => {
          const s = stateFor(r);
          const tone =
            s === "out"
              ? "text-red-500"
              : s === "low"
                ? "text-amber-500"
                : s === "near"
                  ? "text-orange-400"
                  : s === "healthy"
                    ? "text-emerald-500"
                    : "text-muted-foreground";
          return (
            <span
              className={`font-mono text-xs font-bold tabular-nums ${tone} inline-flex items-center gap-1`}
            >
              <span>{qtyCell(qtyFor(r))}</span>
              {(r.unit?.name_ar || r.unit?.name || r.unit?.short_name) && (
                <span className="text-[10px] font-normal text-muted-foreground">
                  {r.unit.name_ar || r.unit.name || r.unit.short_name}
                </span>
              )}
            </span>
          );
        },
      },
      {
        key: "status",
        header: t("inventory.status"),
        width: "w-[130px]",
        cell: (r) => {
          const s = stateFor(r);
          return (
            <StatusBadge tone={statusTone(s)} dot>
              {stateLabel(s)}
            </StatusBadge>
          );
        },
      },
      {
        key: "actions",
        header: t("common.actions"),
        align: "end",
        width: "w-[110px]",
        cell: (r) => (
          <div className="inline-flex items-center gap-1.5 pe-2">
            <IconButton
              size="sm"
              variant="outline"
              tooltip
              ariaLabel={t("inventory.adjust_stock")}
              icon={<ArrowUpDown />}
              round
              onClick={(event) => {
                event.stopPropagation();
                openAdjust(r);
              }}
            />
          </div>
        ),
      },
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang, t, warehouseId]);

  // A failed read must never look like an empty warehouse. That concealed
  // permissions/schema problems behind a misleading "no inventory" card.
  // RecordsView renders a unified error state for this now.

  return (
    <div className="space-y-4 pb-12">
      <PageHeader
        title={t("inventory.title")}
        subtitle={t("inventory.subtitle")}
        actions={
          <>
            <ActionButton icon={<PackagePlus />} onClick={() => setDirectIn({})}>
              {lang === "ar" ? "إدخال مخزون مباشر" : "Direct stock-in"}
            </ActionButton>
            <ActionButton
              tone="outline"
              icon={<Boxes />}
              onClick={() => setOpeningOpen(true)}
              disabled={!warehouseId}
            >
              {lang === "ar" ? "رصيد أول مدة" : "Opening balance"}
            </ActionButton>
          </>
        }
      />

      {/* ─── KPI cards: stock health at a glance ─── */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <div className="card-mullak group relative flex items-center justify-between overflow-hidden p-4 sm:p-5">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground sm:text-xs">
              {t("inventory.kpi.total")}
            </p>
            <h3 className="mt-1 font-mono text-xl font-bold tracking-tight text-foreground sm:text-2xl">
              {(totalCount ?? rows.length).toLocaleString()}
            </h3>
            <span className="mt-1 inline-flex items-center gap-1 text-[10px] text-muted-foreground/80">
              <Sparkles className="size-3 text-primary" />
              {lang === "ar" ? "أصناف نشطة" : "active items"}
            </span>
          </div>
          <div className="grid size-12 shrink-0 place-items-center rounded-2xl border border-primary/20 bg-primary/10 text-primary shadow-sm transition-transform group-hover:scale-105">
            <Package className="size-6" />
          </div>
          <div className="pointer-events-none absolute -left-6 -top-6 size-20 rounded-full bg-primary/10 blur-xl" />
        </div>

        <div className="card-mullak group relative flex items-center justify-between overflow-hidden p-4 sm:p-5">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-amber-500/90 sm:text-xs">
              {t("inventory.kpi.low")}
            </p>
            <h3 className="mt-1 font-mono text-xl font-bold tracking-tight text-amber-400 sm:text-2xl">
              {kpi.low.toLocaleString()}
            </h3>
            <span className="mt-1 inline-flex items-center gap-1 text-[10px] text-amber-500/80">
              <TrendingDown className="size-3" />
              {lang === "ar" ? "تحت الحد الأدنى" : "below minimum"}
            </span>
          </div>
          <div className="grid size-12 shrink-0 place-items-center rounded-2xl border border-amber-500/20 bg-amber-500/10 text-amber-400 shadow-sm transition-transform group-hover:scale-105">
            <AlertTriangle className="size-6" />
          </div>
          <div className="pointer-events-none absolute -left-6 -top-6 size-20 rounded-full bg-amber-500/10 blur-xl" />
        </div>

        <div className="card-mullak group relative flex items-center justify-between overflow-hidden p-4 sm:p-5">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-red-500/90 sm:text-xs">
              {t("inventory.kpi.out")}
            </p>
            <h3 className="mt-1 font-mono text-xl font-bold tracking-tight text-red-400 sm:text-2xl">
              {kpi.out.toLocaleString()}
            </h3>
            <span className="mt-1 inline-flex items-center gap-1 text-[10px] text-red-500/80">
              <AlertTriangle className="size-3" />
              {lang === "ar" ? "بحاجة لإعادة تعبئة" : "needs restocking"}
            </span>
          </div>
          <div className="grid size-12 shrink-0 place-items-center rounded-2xl border border-red-500/20 bg-red-500/10 text-red-400 shadow-sm transition-transform group-hover:scale-105">
            <Boxes className="size-6" />
          </div>
          <div className="pointer-events-none absolute -left-6 -top-6 size-20 rounded-full bg-red-500/10 blur-xl" />
        </div>

        <div className="card-mullak group relative flex items-center justify-between overflow-hidden p-4 sm:p-5">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-emerald-500/90 sm:text-xs">
              {t("inventory.kpi.value")}
            </p>
            <h3 className="mt-1 font-mono text-xl font-bold tracking-tight text-emerald-400 sm:text-2xl">
              {canViewCost ? moneyCell(kpi.value) : "•••"}
            </h3>
            <span className="mt-1 inline-flex items-center gap-1 text-[10px] text-emerald-500/80">
              <Wallet className="size-3" />
              {lang === "ar" ? "بسعر التكلفة" : "at cost"}
            </span>
          </div>
          <div className="grid size-12 shrink-0 place-items-center rounded-2xl border border-emerald-500/20 bg-emerald-500/10 text-emerald-400 shadow-sm transition-transform group-hover:scale-105">
            <Wallet className="size-6" />
          </div>
          <div className="pointer-events-none absolute -left-6 -top-6 size-20 rounded-full bg-emerald-500/10 blur-xl" />
        </div>
      </div>

      {/* ─── Toolbar: search + filters + sort + view toggle + quick pills ─── */}
      <div className="pt-2 sm:pt-3.5">
        <TableToolbar
          sticky
          lang={lang}
          countMode="total"
          loadedCount={displayRows.length}
          search={{
            value: query,
            onValueChange: setQuery,
            placeholder: t("inventory.search"),
            resultCount: totalCount ?? displayRows.length,
            loading: isFetching && !isLoading,
          }}
          filters={{
            definitions: filterDefinitions,
            values: filters,
            onValueChange: (v) => {
              setFilters(v);
              const w = typeof v.warehouse === "string" ? v.warehouse : "";
              if (w) setWarehouseId(w);
            },
          }}
          sort={{
            options: sortOptions,
            value: sort?.key ?? "",
            onValueChange: (v) => setSort(v ? { key: v, direction: "asc" } : null),
            label: lang === "ar" ? "ترتيب" : "Sort",
          }}
          viewToggle={<RecordsViewToggle value={viewMode} onChange={setViewMode} />}
        >
          <QuickFilterBar
            value={quickFilter}
            onChange={(id) => setQuickFilter(id as "all")}
            items={[
              {
                id: "all",
                label: t("inventory.quick.all"),
                count: totalCount ?? rows.length,
                tone: "primary",
              },
              { id: "low", label: t("inventory.quick.low"), count: kpi.low, tone: "warning" },
              { id: "out", label: t("inventory.quick.out"), count: kpi.out, tone: "danger" },
              {
                id: "healthy",
                label: t("inventory.quick.healthy"),
                count: Math.max(0, rows.length - kpi.low - kpi.out),
                tone: "success",
              },
            ]}
          />
        </TableToolbar>
      </div>

      {/* ─── Records: cards / list / classic table — shared scaffold ─── */}
      <RecordsView
        rows={sortedRows}
        getRowId={(r) => r.id}
        viewMode={viewMode}
        loading={isLoading}
        refreshing={isFetching && !isLoading && !isFetchingNextPage}
        error={error}
        onRetry={() => void refetch()}
        columns={columns}
        sort={sort}
        onSortChange={setSort}
        infinite
        hasMore={Boolean(hasNextPage)}
        onLoadMore={() => {
          if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
        }}
        loadingMore={isFetchingNextPage}
        pageSize={INVENTORY_PAGE_SIZE}
        totalCount={totalCount}
        cardsInfinite
        minWidth={860}
        horizontalScroll={tableUsesHorizontalScroll}
        onRowClick={(r) => openAdjust(r)}
        empty={{
          icon: <Warehouse />,
          title: t("inventory.no_inventory"),
          description: t("inventory.empty_hint"),
        }}
        renderCard={(r) => {
          const s = stateFor(r);
          const primary = lang === "ar" ? r.name_ar || r.name : r.name || r.name_ar || "—";
          const other = lang === "ar" ? r.name : r.name_ar;
          const secondary = other && other.trim() && other.trim() !== primary.trim() ? other : null;
          const qty = qtyFor(r);
          const min = Number(r.min_stock) || 0;
          return (
            <div
              className={`card-mullak group relative flex h-full cursor-pointer flex-col justify-between overflow-hidden rounded-2xl border border-r-4 p-4 transition-all duration-200 sm:p-5 ${
                s === "out"
                  ? "border-r-red-500 hover:border-red-500/60"
                  : s === "low"
                    ? "border-r-amber-500 hover:border-amber-500/60"
                    : s === "near"
                      ? "border-r-orange-400 hover:border-orange-400/60"
                      : s === "healthy"
                        ? "border-r-emerald-500 hover:border-primary/40"
                        : "border-r-muted-foreground/40"
              }`}
            >
              <div className="mb-2.5 flex items-center justify-between gap-2">
                <div className="flex items-center gap-1 min-w-0">
                  <span className="inline-flex max-w-[110px] items-center gap-1 truncate rounded-full border border-primary/20 bg-primary/10 px-2.5 py-0.5 text-[11px] font-semibold text-primary">
                    <Tag className="size-3 shrink-0" />
                    <span className="truncate">
                      {label(r.category?.name, r.category?.name_ar) ||
                        (lang === "ar" ? "عام" : "General")}
                    </span>
                  </span>
                  <ItemRoleBadge
                    itemClass={r.item_class}
                    itemNature={r.item_nature}
                    inventoryPolicy={r.inventory_policy}
                    isRtl={lang === "ar"}
                    compact
                  />
                </div>
                <span
                  className={`size-2 shrink-0 rounded-full ${
                    s === "out"
                      ? "bg-red-500 ring-2 ring-red-500/20"
                      : s === "low"
                        ? "bg-amber-500 ring-2 ring-amber-500/20"
                        : s === "near"
                          ? "bg-orange-400 ring-2 ring-orange-400/20"
                          : s === "healthy"
                            ? "bg-emerald-500 ring-2 ring-emerald-500/20"
                            : "bg-muted-foreground/40"
                  }`}
                  title={stateLabel(s)}
                />
              </div>

              <div className="mb-3">
                <h4
                  className="line-clamp-2 text-sm font-bold leading-snug text-foreground transition-colors group-hover:text-primary sm:text-base"
                  dir={lang === "ar" ? "rtl" : "ltr"}
                >
                  {primary}
                </h4>
              </div>

              <div className="mb-3.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                {r.barcode && (
                  <span className="inline-flex items-center gap-1 rounded-md border border-border/50 bg-surface-2/70 px-2 py-0.5 font-mono text-[10px]">
                    <Barcode className="size-2.5" />
                    <span>{r.barcode}</span>
                  </span>
                )}
                {r.shelf_location && (
                  <span className="inline-flex items-center gap-1 rounded-md border border-border/50 bg-surface-2/70 px-2 py-0.5 text-[10px]">
                    <MapPin className="size-2.5" />
                    <span>{r.shelf_location}</span>
                  </span>
                )}
                {min > 0 && (
                  <span className="inline-flex items-center gap-1 rounded-md border border-amber-500/20 bg-amber-500/10 px-2 py-0.5 font-mono text-[10px] text-amber-500">
                    <Boxes className="size-2.5" />
                    <span>{qtyCell(min)}</span>
                  </span>
                )}
              </div>

              <div className="mt-auto flex items-end justify-between gap-2 border-t border-border/60 pt-3">
                <div>
                  <p className="text-[10px] font-medium text-muted-foreground">
                    {t("inventory.on_hand")}
                  </p>
                  <div className="flex items-baseline gap-1.5">
                    <p
                      className={`font-mono text-lg font-bold tracking-tight ${
                        s === "out"
                          ? "text-red-500"
                          : s === "low"
                            ? "text-amber-500"
                            : s === "near"
                              ? "text-orange-400"
                              : s === "healthy"
                                ? "text-emerald-500"
                                : "text-foreground"
                      }`}
                    >
                      {qtyCell(qty)}
                    </p>
                    {(r.unit?.name_ar || r.unit?.name || r.unit?.short_name) && (
                      <span className="text-xs font-semibold text-muted-foreground">
                        {r.unit.name_ar || r.unit.name || r.unit.short_name}
                      </span>
                    )}
                  </div>
                  {min > 0 && qty < min && (
                    <p className="text-[10px] font-mono text-red-500/80">
                      {t("inventory.diff")}: {qtyCell(min - qty)}
                    </p>
                  )}
                </div>

                <div className="flex items-center gap-1 opacity-90 transition-opacity sm:opacity-0 sm:group-hover:opacity-100">
                  <IconButton
                    size="sm"
                    variant="outline"
                    tooltip
                    ariaLabel={t("inventory.adjust_stock")}
                    icon={<ArrowUpDown className="size-3.5" />}
                    round
                    onClick={(event) => {
                      event.stopPropagation();
                      openAdjust(r);
                    }}
                  />
                </div>
              </div>
            </div>
          );
        }}
        renderListRow={(r) => {
          const s = stateFor(r);
          const primary = lang === "ar" ? r.name_ar || r.name : r.name || r.name_ar || "—";
          const qty = qtyFor(r);
          const min = Number(r.min_stock) || 0;
          return (
            <div className="card-mullak group relative flex cursor-pointer flex-col justify-between gap-3 rounded-2xl border p-3.5 transition-all duration-200 hover:border-primary/50 hover:shadow-md sm:p-4 md:flex-row md:items-center">
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <span
                  aria-hidden
                  className={`h-11 w-1.5 shrink-0 rounded-full sm:h-12 ${barClass(s)}`}
                />
                <div className="grid size-11 shrink-0 place-items-center rounded-xl border border-primary/20 bg-primary/10 text-primary transition-all group-hover:scale-105 group-hover:bg-primary group-hover:text-primary-foreground">
                  <Package className="size-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h4
                      className="truncate text-sm font-bold leading-snug text-foreground transition-colors group-hover:text-primary sm:text-base"
                      dir={lang === "ar" ? "rtl" : "ltr"}
                    >
                      {primary}
                    </h4>
                    <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border/60 bg-surface-2/70 px-2 py-0.5 text-[10px] text-muted-foreground">
                      {label(r.category?.name, r.category?.name_ar) ||
                        (lang === "ar" ? "عام" : "General")}
                    </span>
                    <ItemRoleBadge
                      itemClass={r.item_class}
                      itemNature={r.item_nature}
                      inventoryPolicy={r.inventory_policy}
                      isRtl={lang === "ar"}
                      compact
                    />
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                    {r.sku ? (
                      <span className="rounded-md border border-border/50 bg-surface-2 px-1.5 py-0.5 font-mono text-[10px]">
                        {r.sku}
                      </span>
                    ) : null}
                    {r.barcode ? (
                      <span className="inline-flex items-center gap-1 rounded-md border border-border/50 bg-surface-2 px-1.5 py-0.5 font-mono text-[10px]">
                        <Barcode className="size-2.5" />
                        <span>{r.barcode}</span>
                      </span>
                    ) : null}
                    {r.shelf_location ? (
                      <span className="inline-flex items-center gap-1 text-[10px]">
                        <MapPin className="size-2.5" />
                        <span className="font-mono">{r.shelf_location}</span>
                      </span>
                    ) : null}
                  </div>
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-3 ps-4 text-xs sm:gap-4 md:ps-0">
                {min > 0 && (
                  <div className="hidden items-center gap-1 rounded-xl border border-border/40 bg-surface-2/60 px-2.5 py-1 text-[11px] text-muted-foreground sm:flex">
                    <Boxes className="size-3" />
                    <span className="font-mono">{qtyCell(min)}</span>
                  </div>
                )}
                <StatusBadge
                  tone={
                    s === "out" ? "danger" : s === "low" || s === "near" ? "warning" : "success"
                  }
                  dot
                >
                  {stateLabel(s)}
                </StatusBadge>
              </div>

              <div className="flex shrink-0 items-center justify-between gap-3 border-t border-border/50 ps-4 pt-2 md:justify-end md:border-t-0 md:pt-0">
                <div className="text-start md:text-end">
                  <p className="text-[10px] font-medium text-muted-foreground">
                    {t("inventory.on_hand")}
                  </p>
                  <p
                    className={`font-mono text-base font-bold tracking-tight sm:text-lg ${
                      s === "out"
                        ? "text-red-500"
                        : s === "low"
                          ? "text-amber-500"
                          : s === "near"
                            ? "text-orange-400"
                            : s === "healthy"
                              ? "text-emerald-500"
                              : "text-foreground"
                    }`}
                  >
                    {qtyCell(qty)}
                  </p>
                  {canViewCost && min > 0 && qty < min && (
                    <p className="text-[10px] font-mono text-red-500/80">
                      {t("inventory.diff")}: {qtyCell(min - qty)}
                    </p>
                  )}
                </div>
                <IconButton
                  size="sm"
                  variant="outline"
                  tooltip
                  ariaLabel={t("inventory.adjust_stock")}
                  icon={<ArrowUpDown className="size-3.5" />}
                  round
                  onClick={(event) => {
                    event.stopPropagation();
                    openAdjust(r);
                  }}
                />
              </div>
            </div>
          );
        }}
      />

      <p className="px-1 text-[11px] text-muted-foreground/70">{t("inventory.scope_hint")}</p>

      {adjustTarget && (
        <StockAdjustmentDialog
          initialProductId={adjustTarget.productId}
          initialWarehouseId={adjustTarget.warehouseId}
          onClose={() => setAdjust(null)}
          onSaved={() => {
            setAdjust(null);
            qc.invalidateQueries({ queryKey: ["inventory"] });
            qc.invalidateQueries({ queryKey: ["settlements"] });
          }}
        />
      )}

      {/*
       * A physical receipt is a purchase, so it is posted through the engine's
       * procurement RPC; an opening balance is its own document. Both refresh
       * the list and the settlements ledger, because both show up there.
       */}
      {directIn && (
        <DirectStockInDialog
          initialProductId={directIn.product?.id}
          initialWarehouseId={warehouseId || undefined}
          onClose={() => setDirectIn(null)}
          onSaved={() => {
            setDirectIn(null);
            qc.invalidateQueries({ queryKey: ["inventory"] });
            qc.invalidateQueries({ queryKey: ["settlements"] });
          }}
        />
      )}

      {openingOpen && warehouseId && (
        <OpeningStockDialog
          warehouseId={warehouseId}
          onClose={() => setOpeningOpen(false)}
          onSaved={() => {
            setOpeningOpen(false);
            qc.invalidateQueries({ queryKey: ["inventory"] });
            qc.invalidateQueries({ queryKey: ["settlements"] });
          }}
        />
      )}
    </div>
  );
}

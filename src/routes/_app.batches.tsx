import { ModuleGuard, useModules } from "@/lib/modules";
import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CalendarClock,
  LayoutGrid,
  List,
  PackageX,
  Plus,
  ShieldCheck,
  TableProperties,
  Trash2,
  X,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { useI18n } from "@/lib/i18n";
import { toast } from "sonner";
import { VortexMetricCard } from "@/components/vortex-ui";
import { IconButton } from "@/components/ui/icon-button";
import { RecordsView, type RecordsViewMode } from "@/components/ui/records-view";
import {
  TableToolbar,
  ToolbarAction,
  type FilterDefinition,
  type FilterValues,
  type SortOption,
} from "@/components/ui/table-toolbar";
import { type DataTableColumn, type DataTableSort } from "@/components/ui/data-table";
import { useBreakpoint } from "@/design/breakpoints";
import { useRealtimeTable } from "@/lib/realtime";

export const Route = createFileRoute("/_app/batches")({
  head: () => ({ meta: [{ title: "Batches & Expiry — Vortex ERP" }] }),
  component: () => (
    <ModuleGuard moduleId="batches">
      <BatchesPage />
    </ModuleGuard>
  ),
});

interface Batch {
  id: string;
  product_id: string;
  warehouse_id: string;
  batch_number: string;
  expiry_date: string | null;
  quantity: number;
  unit_cost: number;
  products?: { name: string; name_ar: string | null; sku: string | null } | null;
  warehouses?: { name: string; name_ar: string | null } | null;
}

type ViewMode = RecordsViewMode;
type ExpiryState = "expired" | "soon" | "valid" | "none";
type QuickFilter = "all" | ExpiryState;

function BatchesPage() {
  const { isModuleEnabled } = useModules();
  const hasMultiWarehouse = isModuleEnabled("multi_warehouse");
  const { lang, t } = useI18n();
  const isRtl = lang === "ar";
  const qc = useQueryClient();
  const breakpoint = useBreakpoint();
  const tableUsesHorizontalScroll =
    breakpoint === "xs" || breakpoint === "sm" || breakpoint === "md";

  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<FilterValues>({});
  const [sortKey, setSortKey] = useState<string>("expiry_asc");
  const [sort, setSort] = useState<DataTableSort | null>(null);
  const [quickFilter, setQuickFilter] = useState<QuickFilter>("all");
  const [viewMode, setViewMode] = useState<ViewMode>("cards");
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  /*
   * Batches now flow through the shared QueryClient. The read is unchanged —
   * same table, same joins, same 500-row cap and expiry ordering — but sign-out
   * now drops it, Realtime can invalidate it, and a save/delete re-reads exactly
   * this key instead of calling a local `load()`.
   */
  const {
    data: rows = [],
    isLoading,
    isFetching,
    error,
    refetch,
  } = useQuery({
    queryKey: ["batches"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("product_batches")
        .select("*, products(name,name_ar,sku), warehouses(name,name_ar)")
        .order("expiry_date", { ascending: true, nullsFirst: false })
        .limit(500);
      if (error) throw error;
      return (data ?? []) as Batch[];
    },
    staleTime: 60_000,
  });

  useRealtimeTable<Batch>(
    { table: "product_batches", queryKey: ["batches"], mode: "invalidate", debounceMs: 150 },
    qc,
  );

  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);
  const soon = useMemo(() => {
    const d = new Date(today);
    d.setDate(today.getDate() + 30);
    return d;
  }, [today]);

  const productLabel = useCallback(
    (r: Batch) =>
      isRtl ? r.products?.name_ar || r.products?.name : r.products?.name || r.products?.name_ar,
    [isRtl],
  );
  const warehouseLabel = useCallback(
    (r: Batch) =>
      isRtl
        ? r.warehouses?.name_ar || r.warehouses?.name
        : r.warehouses?.name || r.warehouses?.name_ar,
    [isRtl],
  );

  const expiryState = useCallback(
    (exp: string | null): ExpiryState => {
      if (!exp) return "none";
      const d = new Date(exp);
      if (d < today) return "expired";
      if (d < soon) return "soon";
      return "valid";
    },
    [today, soon],
  );

  const statusMeta = useCallback(
    (state: ExpiryState) => {
      switch (state) {
        case "expired":
          return {
            label: t("batches.status.expired"),
            cls: "bg-red-500/10 text-red-400 border-red-500/20",
          };
        case "soon":
          return {
            label: t("batches.status.soon"),
            cls: "bg-amber-500/10 text-amber-400 border-amber-500/20",
          };
        case "valid":
          return {
            label: t("batches.status.valid"),
            cls: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
          };
        default:
          return {
            label: t("batches.status.none"),
            cls: "bg-muted text-muted-foreground border-border",
          };
      }
    },
    [t],
  );

  /* ---------------- search + filter + quick chips ---------------- */
  const searched = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.batch_number.toLowerCase().includes(q) ||
        (r.products?.name ?? "").toLowerCase().includes(q) ||
        (r.products?.name_ar ?? "").includes(search) ||
        (r.products?.sku ?? "").toLowerCase().includes(q),
    );
  }, [rows, search]);

  const filterDefinitions: FilterDefinition[] = useMemo(() => {
    const defs: FilterDefinition[] = [
      {
        key: "expiry_state",
        label: isRtl ? "حالة الصلاحية" : "Expiry status",
        type: "select",
        options: [
          { value: "valid", label: t("batches.status.valid") },
          { value: "soon", label: t("batches.status.soon") },
          { value: "expired", label: t("batches.status.expired") },
          { value: "none", label: t("batches.status.none") },
        ],
      },
    ];
    if (hasMultiWarehouse) {
      const whOptions = Array.from(
        new Map(
          rows
            .filter((r) => r.warehouse_id)
            .map((r) => [
              r.warehouse_id,
              { value: r.warehouse_id, label: warehouseLabel(r) ?? "—" },
            ]),
        ).values(),
      );
      if (whOptions.length) {
        defs.push({
          key: "warehouse_id",
          label: isRtl ? "المستودع" : "Warehouse",
          type: "select",
          options: whOptions,
        });
      }
    }
    defs.push({
      key: "expiry_date",
      label: isRtl ? "تاريخ الانتهاء" : "Expiry date",
      type: "date-range",
    });
    return defs;
  }, [rows, hasMultiWarehouse, isRtl, t, warehouseLabel]);

  const filtered = useMemo(() => {
    return searched.filter((r) => {
      const state = expiryState(r.expiry_date);
      if (filters.expiry_state && filters.expiry_state !== state) return false;
      if (filters.warehouse_id && r.warehouse_id !== filters.warehouse_id) return false;
      if (filters.expiry_date && typeof filters.expiry_date === "object") {
        if (!r.expiry_date) return false;
        const t0 = new Date(r.expiry_date).getTime();
        if (filters.expiry_date.from && t0 < new Date(filters.expiry_date.from).getTime())
          return false;
        if (filters.expiry_date.to) {
          const to = new Date(filters.expiry_date.to);
          to.setHours(23, 59, 59, 999);
          if (t0 > to.getTime()) return false;
        }
      }
      if (quickFilter !== "all" && state !== quickFilter) return false;
      return true;
    });
  }, [searched, filters, quickFilter, expiryState]);

  /* ---------------- KPI counts ---------------- */
  const counts = useMemo(() => {
    let expired = 0;
    let soonCount = 0;
    let valid = 0;
    let none = 0;
    for (const r of rows) {
      switch (expiryState(r.expiry_date)) {
        case "expired":
          expired++;
          break;
        case "soon":
          soonCount++;
          break;
        case "valid":
          valid++;
          break;
        default:
          none++;
      }
    }
    return { expired, soon: soonCount, valid, none, atRisk: expired + soonCount };
  }, [rows, expiryState]);

  /* ---------------- sort ---------------- */
  const sortOptions: SortOption[] = useMemo(
    () => [
      { value: "expiry_asc", label: isRtl ? "الأقرب انتهاءً" : "Expiry (soonest)" },
      { value: "expiry_desc", label: isRtl ? "الأبعد انتهاءً" : "Expiry (latest)" },
      { value: "product_asc", label: isRtl ? "المنتج" : "Product" },
      { value: "qty_desc", label: isRtl ? "الكمية (الأعلى)" : "Quantity (high)" },
      { value: "batch_asc", label: isRtl ? "رقم الدفعة" : "Batch number" },
    ],
    [isRtl],
  );

  const sortedRows = useMemo(() => {
    const list = [...filtered];
    if (sort) {
      const dir = sort.direction === "asc" ? 1 : -1;
      switch (sort.key) {
        case "batch":
          return list.sort((a, b) => a.batch_number.localeCompare(b.batch_number) * dir);
        case "product":
          return list.sort(
            (a, b) => (productLabel(a) ?? "").localeCompare(productLabel(b) ?? "", "ar") * dir,
          );
        case "quantity":
          return list.sort((a, b) => (Number(a.quantity) - Number(b.quantity)) * dir);
        case "expiry":
          return list.sort((a, b) => expiryTime(a) - expiryTime(b));
        default:
          break;
      }
    }
    switch (sortKey) {
      case "expiry_desc":
        return list.sort((a, b) => expiryTime(b) - expiryTime(a));
      case "product_asc":
        return list.sort((a, b) =>
          (productLabel(a) ?? "").localeCompare(productLabel(b) ?? "", isRtl ? "ar" : "en"),
        );
      case "qty_desc":
        return list.sort((a, b) => Number(b.quantity) - Number(a.quantity));
      case "batch_asc":
        return list.sort((a, b) => a.batch_number.localeCompare(b.batch_number));
      default:
        return list.sort((a, b) => expiryTime(a) - expiryTime(b));
    }
  }, [filtered, sort, sortKey, productLabel, isRtl]);

  /* ---------------- delete ---------------- */
  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("product_batches").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(t("common.deleted"));
      qc.invalidateQueries({ queryKey: ["batches"] });
      qc.invalidateQueries({ queryKey: ["inventory"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const removeRow = useCallback(
    (id: string) => {
      if (deleting) return;
      if (!confirm(t("common.confirm_delete"))) return;
      setDeleting(id);
      remove.mutate(id, { onSettled: () => setDeleting(null) });
    },
    [deleting, remove, t],
  );

  /* ---------------- classic table columns ---------------- */
  const columns = useMemo<DataTableColumn<Batch>[]>(() => {
    const cols: DataTableColumn<Batch>[] = [
      {
        key: "batch",
        header: t("batches.batch"),
        sortable: true,
        width: "w-[150px]",
        sortValue: (r) => r.batch_number,
        cell: (r) => <span className="font-mono text-xs">{r.batch_number}</span>,
      },
      {
        key: "product",
        header: isRtl ? "المنتج" : "Product",
        sortable: true,
        width: "w-[240px]",
        sortValue: (r) => productLabel(r) ?? "",
        cell: (r) => (
          <div className="py-0.5">
            <div className="truncate text-foreground">{productLabel(r) ?? "—"}</div>
            {r.products?.sku && (
              <div className="font-mono text-[11px] text-muted-foreground">{r.products.sku}</div>
            )}
          </div>
        ),
      },
    ];
    if (hasMultiWarehouse) {
      cols.push({
        key: "warehouse",
        header: isRtl ? "المستودع" : "Warehouse",
        width: "w-[180px]",
        cell: (r) => <span className="text-muted-foreground">{warehouseLabel(r) ?? "—"}</span>,
      });
    }
    cols.push(
      {
        key: "quantity",
        header: isRtl ? "الكمية" : "Qty",
        sortable: true,
        align: "end",
        width: "w-[110px]",
        sortValue: (r) => Number(r.quantity),
        cell: (r) => <span className="font-mono text-xs tabular-nums">{r.quantity}</span>,
      },
      {
        key: "expiry",
        header: t("batches.expiry"),
        sortable: true,
        width: "w-[140px]",
        sortValue: (r) => expiryTime(r),
        cell: (r) => (
          <span className="font-mono text-xs text-muted-foreground">{r.expiry_date ?? "—"}</span>
        ),
      },
      {
        key: "status",
        header: isRtl ? "الحالة" : "Status",
        width: "w-[130px]",
        cell: (r) => {
          const meta = statusMeta(expiryState(r.expiry_date));
          return (
            <span
              className={`inline-flex whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] ${meta.cls}`}
            >
              {meta.label}
            </span>
          );
        },
      },
      {
        key: "actions",
        header: "",
        align: "end",
        width: "w-[80px]",
        cell: (r) => (
          <IconButton
            size="sm"
            variant="danger"
            tooltip
            ariaLabel={t("common.delete")}
            icon={<Trash2 className="size-3.5" />}
            round
            loading={deleting === r.id}
            onClick={() => removeRow(r.id)}
          />
        ),
      },
    );
    return cols;
  }, [
    t,
    isRtl,
    hasMultiWarehouse,
    productLabel,
    warehouseLabel,
    statusMeta,
    expiryState,
    removeRow,
    deleting,
  ]);

  const rendererProps = (r: Batch) => ({
    row: r,
    isRtl,
    productLabel,
    warehouseLabel,
    statusMeta,
    state: expiryState(r.expiry_date),
    hasMultiWarehouse,
    onDelete: removeRow,
    deleting: deleting === r.id,
    deleteLabel: t("common.delete"),
  });

  const hasActiveCriteria = Boolean(search.trim()) || Object.keys(filters).length > 0;

  return (
    <div className="space-y-4 pb-12">
      <PageHeader title={t("batches.title")} subtitle={t("batches.subtitle")} />

      {counts.atRisk > 0 && (
        <div className="flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/5 px-3.5 py-2.5 text-sm text-amber-500">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {isRtl
            ? `${counts.atRisk} دفعة قريبة الانتهاء أو منتهية`
            : `${counts.atRisk} batch(es) expired or expiring within 30 days`}
        </div>
      )}

      {/* ─── KPI cards ─── */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <VortexMetricCard
          title={isRtl ? "إجمالي الدفعات" : "Total batches"}
          value={rows.length}
          subtitle={isRtl ? "المحمّلة حالياً" : "Currently loaded"}
          icon={<CalendarClock className="size-5" />}
          tone="info"
        />
        <VortexMetricCard
          title={t("batches.status.valid")}
          value={counts.valid}
          subtitle={isRtl ? "صالح للاستخدام" : "Safe to use"}
          icon={<ShieldCheck className="size-5" />}
          tone="success"
          highlight={quickFilter === "valid"}
          onClick={() => setQuickFilter("valid")}
        />
        <VortexMetricCard
          title={t("batches.status.soon")}
          value={counts.soon}
          subtitle={isRtl ? "خلال 30 يوماً" : "Within 30 days"}
          icon={<AlertTriangle className="size-5" />}
          tone="warning"
          highlight={quickFilter === "soon"}
          onClick={() => setQuickFilter("soon")}
        />
        <VortexMetricCard
          title={t("batches.status.expired")}
          value={counts.expired}
          subtitle={isRtl ? "تجاوزت الصلاحية" : "Past expiry"}
          icon={<PackageX className="size-5" />}
          tone="danger"
          highlight={quickFilter === "expired"}
          onClick={() => setQuickFilter("expired")}
        />
      </div>

      {/* ─── Standard VORTEX TableToolbar ─── */}
      <TableToolbar
        sticky
        lang={lang}
        search={{
          value: search,
          onValueChange: setSearch,
          placeholder: t("batches.search"),
          resultCount: filtered.length,
          loading: isFetching && !isLoading,
        }}
        filters={{ definitions: filterDefinitions, values: filters, onValueChange: setFilters }}
        sort={{
          options: sortOptions,
          value: sortKey,
          onValueChange: (value) => {
            setSortKey(value);
            setSort(null);
          },
          label: isRtl ? "ترتيب" : "Sort",
        }}
        viewToggle={
          <ToolbarAction
            label={
              viewMode === "cards"
                ? isRtl
                  ? "بطاقات"
                  : "Cards"
                : viewMode === "list"
                  ? isRtl
                    ? "قائمة"
                    : "List"
                  : isRtl
                    ? "كلاسيكي"
                    : "Classic"
            }
            icon={
              viewMode === "cards" ? (
                <LayoutGrid />
              ) : viewMode === "list" ? (
                <List />
              ) : (
                <TableProperties />
              )
            }
            onClick={() =>
              setViewMode((prev) =>
                prev === "cards" ? "list" : prev === "list" ? "table" : "cards",
              )
            }
            tone="ghost"
          />
        }
        action={
          <ToolbarAction
            label={t("batches.new")}
            icon={<Plus />}
            tone="primary"
            onClick={() => setOpen(true)}
          />
        }
      >
        <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
          {(
            [
              { id: "all", label: isRtl ? "الكل" : "All", count: rows.length },
              { id: "valid", label: t("batches.status.valid"), count: counts.valid },
              { id: "soon", label: t("batches.status.soon"), count: counts.soon },
              { id: "expired", label: t("batches.status.expired"), count: counts.expired },
            ] as const
          ).map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setQuickFilter(f.id)}
              className={`flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-bold transition ${
                quickFilter === f.id
                  ? "border-primary bg-primary text-primary-foreground shadow-xs shadow-primary/20"
                  : "border-border/70 bg-surface/70 text-muted-foreground hover:bg-surface-2 hover:text-foreground"
              }`}
            >
              <span>{f.label}</span>
              <span
                className={`rounded-full px-1.5 font-mono text-[10px] ${
                  quickFilter === f.id ? "bg-white/20 text-white" : "bg-muted text-muted-foreground"
                }`}
              >
                {f.count}
              </span>
            </button>
          ))}
        </div>
      </TableToolbar>

      {/* ─── Records: cards / list / classic table — shared scaffold ─── */}
      <RecordsView<Batch>
        rows={sortedRows}
        getRowId={(r) => r.id}
        viewMode={viewMode}
        loading={isLoading}
        refreshing={isFetching && !isLoading}
        error={error}
        onRetry={() => void refetch()}
        columns={columns}
        sort={sort}
        onSortChange={setSort}
        minWidth={hasMultiWarehouse ? 980 : 800}
        horizontalScroll={tableUsesHorizontalScroll}
        renderCard={(r) => <BatchCard {...rendererProps(r)} />}
        renderListRow={(r) => <BatchListRow {...rendererProps(r)} />}
        empty={{
          icon: <CalendarClock />,
          title: hasActiveCriteria
            ? isRtl
              ? "لا توجد دفعات مطابقة"
              : "No matching batches"
            : t("batches.no_batches"),
          description: hasActiveCriteria
            ? isRtl
              ? "جرّب تعديل البحث أو الفلاتر."
              : "Try adjusting your search or filters."
            : isRtl
              ? "سجّل دفعة جديدة لتتبع تواريخ الصلاحية."
              : "Record a batch to start tracking expiry dates.",
          action: (
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="mt-2 inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-xs font-bold text-primary-foreground shadow-sm transition hover:bg-primary/90 active:scale-95"
            >
              <Plus className="size-4" />
              <span>{t("batches.new")}</span>
            </button>
          ),
        }}
      />

      {open && (
        <NewBatchModal
          onClose={() => setOpen(false)}
          onSaved={() => {
            setOpen(false);
            qc.invalidateQueries({ queryKey: ["batches"] });
          }}
          hasMultiWarehouse={hasMultiWarehouse}
        />
      )}
    </div>
  );
}

/** Timestamp of a batch's expiry, with `null` sorted last. */
function expiryTime(r: Batch): number {
  if (!r.expiry_date) return Number.POSITIVE_INFINITY;
  const value = new Date(r.expiry_date).getTime();
  return Number.isNaN(value) ? Number.POSITIVE_INFINITY : value;
}

/* ------------------------------------------------------------------ */
/*  Batch renderers                                                    */
/* ------------------------------------------------------------------ */

interface BatchRendererProps {
  row: Batch;
  isRtl: boolean;
  productLabel: (r: Batch) => string | null | undefined;
  warehouseLabel: (r: Batch) => string | null | undefined;
  statusMeta: (state: ExpiryState) => { label: string; cls: string };
  state: ExpiryState;
  hasMultiWarehouse: boolean;
  onDelete: (id: string) => void;
  deleting: boolean;
  deleteLabel: string;
}

function BatchRowActions({
  row,
  onDelete,
  deleting,
  deleteLabel,
}: Pick<BatchRendererProps, "row" | "onDelete" | "deleting" | "deleteLabel">) {
  return (
    <div className="flex shrink-0 items-center" onClick={(event) => event.stopPropagation()}>
      <IconButton
        size="sm"
        variant="danger"
        tooltip
        ariaLabel={deleteLabel}
        icon={<Trash2 className="size-3.5" />}
        round
        loading={deleting}
        onClick={() => onDelete(row.id)}
      />
    </div>
  );
}

function BatchCard({
  row: r,
  isRtl,
  productLabel,
  warehouseLabel,
  statusMeta,
  state,
  hasMultiWarehouse,
  onDelete,
  deleting,
  deleteLabel,
}: BatchRendererProps) {
  const meta = statusMeta(state);
  const barClass =
    state === "expired"
      ? "bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.4)]"
      : state === "soon"
        ? "bg-amber-500 shadow-[0_0_10px_rgba(245,158,11,0.3)]"
        : state === "valid"
          ? "bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.3)]"
          : "bg-muted-foreground/40";

  return (
    <div className="card-mullak group relative flex h-full flex-col justify-between rounded-2xl p-3 transition-all duration-200 hover:shadow-md sm:p-4.5">
      <div className="flex items-start gap-2.5">
        <span aria-hidden className={`h-12 w-1.5 shrink-0 rounded-full ${barClass}`} />
        <div className="grid size-11 shrink-0 place-items-center rounded-2xl border border-primary/20 bg-primary/10 text-primary transition-transform group-hover:scale-105">
          <CalendarClock className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <span className="block truncate font-mono text-xs font-bold text-foreground">
            {r.batch_number}
          </span>
          <div className="truncate text-[11px] text-muted-foreground">{productLabel(r) ?? "—"}</div>
          <span
            className={`mt-1 inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[9px] font-bold ${meta.cls}`}
          >
            <span className={`size-1.5 rounded-full ${barClass}`} />
            {meta.label}
          </span>
        </div>
      </div>

      <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
        <span className="inline-flex items-center gap-1 font-mono">
          {isRtl ? "الكمية:" : "Qty:"} {r.quantity}
        </span>
        <span className="inline-flex items-center gap-1 font-mono">
          {isRtl ? "الانتهاء:" : "Expiry:"} {r.expiry_date ?? "—"}
        </span>
        {hasMultiWarehouse && (
          <span className="col-span-2 truncate">
            {isRtl ? "المستودع: " : "Warehouse: "}
            {warehouseLabel(r) ?? "—"}
          </span>
        )}
      </div>

      <div className="mt-3 flex items-center justify-end border-t border-border/60 pt-2.5">
        <BatchRowActions
          row={r}
          onDelete={onDelete}
          deleting={deleting}
          deleteLabel={deleteLabel}
        />
      </div>
    </div>
  );
}

function BatchListRow({
  row: r,
  isRtl,
  productLabel,
  warehouseLabel,
  statusMeta,
  state,
  hasMultiWarehouse,
  onDelete,
  deleting,
  deleteLabel,
}: BatchRendererProps) {
  const meta = statusMeta(state);
  const barClass =
    state === "expired"
      ? "bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.45)]"
      : state === "soon"
        ? "bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.5)]"
        : state === "valid"
          ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.4)]"
          : "bg-muted-foreground/30";

  return (
    <div className="card-mullak group relative flex flex-col justify-between gap-3 rounded-2xl border p-3.5 transition-all duration-200 hover:border-primary/50 hover:shadow-md sm:p-4 md:flex-row md:items-center">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <span aria-hidden className={`h-11 w-1.5 shrink-0 rounded-full sm:h-12 ${barClass}`} />
        <div className="grid size-11 shrink-0 place-items-center rounded-xl border border-primary/20 bg-primary/10 text-primary transition-all group-hover:scale-105 group-hover:bg-primary group-hover:text-primary-foreground">
          <CalendarClock className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="truncate font-mono text-sm font-bold leading-snug text-foreground">
              {r.batch_number}
            </h4>
            <span
              className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[9px] font-bold ${meta.cls}`}
            >
              {meta.label}
            </span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
            <span className="truncate">{productLabel(r) ?? "—"}</span>
            {hasMultiWarehouse && <span className="truncate">— {warehouseLabel(r) ?? "—"}</span>}
          </div>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-4 border-t border-border/50 pt-2 ps-4 text-xs md:border-t-0 md:pt-0">
        <div className="text-end">
          <p className="font-mono text-base font-bold tracking-tight text-foreground">
            {r.quantity}
          </p>
          <p className="text-[10px] text-muted-foreground">{isRtl ? "الكمية" : "Qty"}</p>
        </div>
        <div className="text-end">
          <p className="font-mono text-[11px] text-muted-foreground">{r.expiry_date ?? "—"}</p>
          <p className="text-[10px] text-muted-foreground">{isRtl ? "الانتهاء" : "Expiry"}</p>
        </div>
        <BatchRowActions
          row={r}
          onDelete={onDelete}
          deleting={deleting}
          deleteLabel={deleteLabel}
        />
      </div>
    </div>
  );
}

function NewBatchModal({
  onClose,
  onSaved,
  hasMultiWarehouse,
}: {
  onClose: () => void;
  onSaved: () => void;
  hasMultiWarehouse?: boolean;
}) {
  const { lang, t } = useI18n();
  const [products, setProducts] = useState<any[]>([]);
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [form, setForm] = useState({
    product_id: "",
    warehouse_id: "",
    batch_number: "",
    expiry_date: "",
    quantity: 0,
    unit_cost: 0,
  });

  useEffect(() => {
    Promise.all([
      supabase
        .from("products")
        .select("id,name,name_ar,sku")
        .eq("is_active", true)
        .order("name")
        .limit(500),
      supabase.from("warehouses").select("id,name,name_ar").eq("is_active", true).order("name"),
    ]).then(([p, w]) => {
      setProducts(p.data ?? []);
      setWarehouses(w.data ?? []);
      if (w.data?.[0]) setForm((f) => ({ ...f, warehouse_id: f.warehouse_id || w.data[0].id }));
    });
  }, []);

  async function save() {
    if (!form.product_id || !form.warehouse_id || !form.batch_number) {
      toast.error(t("common.fill_form"));
      return;
    }
    const { error } = await supabase
      .from("product_batches")
      .insert({ ...form, expiry_date: form.expiry_date || null });
    if (error) return toast.error(error.message);
    toast.success(t("common.saved") || t("common.success"));
    onSaved();
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-background/80 backdrop-blur-sm p-4">
      <div className="panel-elevated w-full max-w-md p-6">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold">{lang === "ar" ? "دفعة جديدة" : "New batch"}</h3>
          <button onClick={onClose} className="rounded p-1 hover:bg-surface-2">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="space-y-3">
          <Field label={lang === "ar" ? "المنتج" : "Product"}>
            <select
              value={form.product_id}
              onChange={(e) => setForm({ ...form, product_id: e.target.value })}
              className="h-9 w-full rounded-md border border-input bg-surface px-3 text-sm"
            >
              <option value="">{lang === "ar" ? "اختر..." : "Select..."}</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {lang === "ar" ? p.name_ar || p.name : p.name || p.name_ar}
                </option>
              ))}
            </select>
          </Field>
          <Field label={lang === "ar" ? "المستودع" : "Warehouse"}>
            <select
              value={form.warehouse_id}
              onChange={(e) => setForm({ ...form, warehouse_id: e.target.value })}
              className="h-9 w-full rounded-md border border-input bg-surface px-3 text-sm"
            >
              <option value="">{lang === "ar" ? "اختر..." : "Select..."}</option>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {lang === "ar" ? w.name_ar || w.name : w.name || w.name_ar}
                </option>
              ))}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={lang === "ar" ? "رقم الدفعة" : "Batch #"}>
              <input
                value={form.batch_number}
                onChange={(e) => setForm({ ...form, batch_number: e.target.value })}
                className="h-9 w-full rounded-md border border-input bg-surface px-3 text-sm"
              />
            </Field>
            <Field label={lang === "ar" ? "تاريخ الانتهاء" : "Expiry"}>
              <input
                type="date"
                value={form.expiry_date}
                onChange={(e) => setForm({ ...form, expiry_date: e.target.value })}
                className="h-9 w-full rounded-md border border-input bg-surface px-3 text-sm"
              />
            </Field>
            <Field label={lang === "ar" ? "الكمية" : "Quantity"}>
              <input
                type="number"
                value={form.quantity}
                onChange={(e) => setForm({ ...form, quantity: Number(e.target.value) })}
                className="h-9 w-full rounded-md border border-input bg-surface px-3 text-sm"
              />
            </Field>
            <Field label={lang === "ar" ? "تكلفة الوحدة" : "Unit cost"}>
              <input
                type="number"
                value={form.unit_cost}
                onChange={(e) => setForm({ ...form, unit_cost: Number(e.target.value) })}
                className="h-9 w-full rounded-md border border-input bg-surface px-3 text-sm"
              />
            </Field>
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="h-9 rounded-md border border-border px-4 text-sm hover:bg-surface-2"
          >
            {t("common.cancel")}
          </button>
          <button
            onClick={save}
            className="h-9 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            {t("common.save")}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-medium text-muted-foreground">{label}</label>
      {children}
    </div>
  );
}

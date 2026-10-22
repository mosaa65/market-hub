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
  Settings2,
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
import { RecordsViewToggle } from "@/components/ui/records-view-toggle";
import { usePersistedViewMode } from "@/hooks/use-persisted-view-mode";
import { QuickFilterBar } from "@/components/ui/quick-filter-bar";
import { PrimaryAction } from "@/components/ui/primary-action";
import { type DataTableColumn, type DataTableSort } from "@/components/ui/data-table";
import { useBreakpoint } from "@/design/breakpoints";
import { useRealtimeTable } from "@/lib/realtime";
import { useBatchSettings } from "@/hooks/use-batch-settings";
import { BatchSettingsDialog } from "@/components/batches/batch-settings-dialog";
import { AddBatchDialog } from "@/components/batches/add-batch-dialog";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_app/batches")({
  head: () => ({ meta: [{ title: "الدفعات وتواريخ الصلاحية — Vortex ERP" }] }),
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

function formatQty(val: number | string | null | undefined): string {
  if (val === null || val === undefined || val === "") return "0";
  const num = typeof val === "number" ? val : parseFloat(String(val));
  if (isNaN(num)) return "0";
  return num % 1 === 0 ? num.toString() : num.toFixed(3).replace(/\.?0+$/, "");
}

function getLocalDateString(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDaysToDateString(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() + days);
  return getLocalDateString(date);
}

function BatchesPage() {
  const { isModuleEnabled } = useModules();
  const hasMultiWarehouse = isModuleEnabled("multi_warehouse");
  const { lang, t } = useI18n();
  const isRtl = lang === "ar";
  const qc = useQueryClient();
  const breakpoint = useBreakpoint();
  const tableUsesHorizontalScroll =
    breakpoint === "xs" || breakpoint === "sm" || breakpoint === "md";

  const { settings } = useBatchSettings();

  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<FilterValues>({});
  const [sortKey, setSortKey] = useState<string>("expiry_asc");
  const [sort, setSort] = useState<DataTableSort | null>(null);
  const [quickFilter, setQuickFilter] = useState<QuickFilter>("all");
  const [viewMode, setViewMode] = usePersistedViewMode("batches", "cards");
  const [openAddDialog, setOpenAddDialog] = useState(false);
  const [openSettingsDialog, setOpenSettingsDialog] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  /*
   * Fetch batches without artificial 500 cap
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
        .order("expiry_date", { ascending: true, nullsFirst: false });
      if (error) throw error;
      return (data ?? []) as Batch[];
    },
    staleTime: 60_000,
  });

  useRealtimeTable<Batch>(
    { table: "product_batches", queryKey: ["batches"], mode: "invalidate", debounceMs: 150 },
    qc,
  );

  /*
   * Pure Calendar Date comparison: Timezone-safe & handles current day as expired
   */
  const todayStr = useMemo(() => getLocalDateString(), []);
  const soonLimitStr = useMemo(
    () => addDaysToDateString(todayStr, settings.warning_days || 30),
    [todayStr, settings.warning_days],
  );

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
      const expStr = exp.slice(0, 10);
      if (expStr <= todayStr) return "expired";
      if (expStr <= soonLimitStr) return "soon";
      return "valid";
    },
    [todayStr, soonLimitStr],
  );

  const statusMeta = useCallback(
    (state: ExpiryState) => {
      switch (state) {
        case "expired":
          return {
            label: isRtl ? "منتهي الصلاحية" : t("batches.status.expired"),
            cls: "bg-red-500/10 text-red-400 border-red-500/20",
          };
        case "soon":
          return {
            label: isRtl ? "قريب الانتهاء" : t("batches.status.soon"),
            cls: "bg-amber-500/10 text-amber-400 border-amber-500/20",
          };
        case "valid":
          return {
            label: isRtl ? "صالح للاستخدام" : t("batches.status.valid"),
            cls: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
          };
        default:
          return {
            label: isRtl ? "غير محدد" : t("batches.status.none"),
            cls: "bg-muted text-muted-foreground border-border",
          };
      }
    },
    [t, isRtl],
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
          { value: "valid", label: isRtl ? "صالح للاستخدام" : t("batches.status.valid") },
          { value: "soon", label: isRtl ? "قريب الانتهاء" : t("batches.status.soon") },
          { value: "expired", label: isRtl ? "منتهي الصلاحية" : t("batches.status.expired") },
          { value: "none", label: isRtl ? "بدون تاريخ" : t("batches.status.none") },
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
        const expStr = r.expiry_date.slice(0, 10);
        if (filters.expiry_date.from && expStr < filters.expiry_date.from.slice(0, 10))
          return false;
        if (filters.expiry_date.to && expStr > filters.expiry_date.to.slice(0, 10)) return false;
      }
      if (quickFilter !== "all" && state !== quickFilter) return false;
      return true;
    });
  }, [searched, filters, quickFilter, expiryState]);

  /* ---------------- Precise DB KPIs or local aggregation ---------------- */
  const { data: dbKpis } = useQuery({
    queryKey: ["batch-kpis", settings.warning_days],
    queryFn: async () => {
      try {
        const { data, error } = await supabase.rpc("get_batch_kpis" as any, {
          p_warning_days: settings.warning_days || 30,
        });
        if (!error && data) {
          return data as {
            total: number;
            expired: number;
            soon: number;
            valid: number;
            none: number;
            at_risk: number;
          };
        }
      } catch {
        // fallback
      }
      return null;
    },
    staleTime: 60_000,
  });

  const counts = useMemo(() => {
    if (dbKpis) {
      return {
        total: Number(dbKpis.total),
        expired: Number(dbKpis.expired),
        soon: Number(dbKpis.soon),
        valid: Number(dbKpis.valid),
        none: Number(dbKpis.none),
        atRisk: Number(dbKpis.at_risk),
      };
    }
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
    return {
      total: rows.length,
      expired,
      soon: soonCount,
      valid,
      none,
      atRisk: expired + soonCount,
    };
  }, [dbKpis, rows, expiryState]);

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
          return list.sort((a, b) => (expiryTime(a) - expiryTime(b)) * dir);
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

  /* ---------------- delete with inventory sync ---------------- */
  const remove = useMutation({
    mutationFn: async (id: string) => {
      try {
        const { error } = await supabase.rpc("delete_product_batch" as any, {
          p_batch_id: id,
          p_sync_inventory: settings.auto_sync_inventory,
        });
        if (!error) return;
      } catch {
        // Fallback
      }
      const { error } = await supabase.from("product_batches").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(isRtl ? "تم حذف الدفعة بنجاح وتعديل المخزون" : t("common.deleted"));
      qc.invalidateQueries({ queryKey: ["batches"] });
      qc.invalidateQueries({ queryKey: ["batch-kpis"] });
      qc.invalidateQueries({ queryKey: ["inventory"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const removeRow = useCallback(
    (id: string) => {
      if (deleting) return;
      if (
        !confirm(
          isRtl ? "هل أنت متأكد من حذف هذه الدفعة وتحديث المخزون؟" : t("common.confirm_delete"),
        )
      )
        return;
      setDeleting(id);
      remove.mutate(id, { onSettled: () => setDeleting(null) });
    },
    [deleting, remove, t, isRtl],
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
        cell: (r) => (
          <span className="font-mono text-xs font-bold text-foreground">{r.batch_number}</span>
        ),
      },
      {
        key: "product",
        header: isRtl ? "المنتج" : "Product",
        sortable: true,
        width: "w-[240px]",
        sortValue: (r) => productLabel(r) ?? "",
        cell: (r) => (
          <div className="py-0.5">
            <div className="truncate font-medium text-foreground">{productLabel(r) ?? "—"}</div>
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
        cell: (r) => (
          <span className="font-mono text-xs font-semibold tabular-nums">
            {formatQty(r.quantity)}
          </span>
        ),
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
              className={`inline-flex whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] font-semibold ${meta.cls}`}
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
      <PageHeader
        title={isRtl ? "الدفعات وتواريخ الصلاحية" : t("batches.title")}
        subtitle={
          isRtl
            ? "إدارة وتتبع تشغيلات المنتجات، وتواريخ الانتهاء، وسياسات الصرف"
            : t("batches.subtitle")
        }
      />

      {counts.atRisk > 0 && (
        <div className="flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/5 px-3.5 py-2.5 text-sm text-amber-500">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {isRtl
            ? `${counts.atRisk} دفعة منتهية أو قريبة الانتهاء خلال ${settings.warning_days || 30} يوماً`
            : `${counts.atRisk} batch(es) expired or expiring within ${settings.warning_days || 30} days`}
        </div>
      )}

      {/* ─── KPI cards ─── */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <VortexMetricCard
          title={isRtl ? "إجمالي الدفعات" : "Total batches"}
          value={counts.total}
          subtitle={isRtl ? "إجمالي السجلات المسجلة" : "Total in system"}
          icon={<CalendarClock className="size-5" />}
          tone="info"
        />
        <VortexMetricCard
          title={isRtl ? "صالح للاستخدام" : t("batches.status.valid")}
          value={counts.valid}
          subtitle={isRtl ? "آمن للصرف والبيع" : "Safe to use"}
          icon={<ShieldCheck className="size-5" />}
          tone="success"
          highlight={quickFilter === "valid"}
          onClick={() => setQuickFilter("valid")}
        />
        <VortexMetricCard
          title={isRtl ? "قريب الانتهاء" : t("batches.status.soon")}
          value={counts.soon}
          subtitle={
            isRtl
              ? `خلال ${settings.warning_days || 30} يوماً`
              : `Within ${settings.warning_days || 30} days`
          }
          icon={<AlertTriangle className="size-5" />}
          tone="warning"
          highlight={quickFilter === "soon"}
          onClick={() => setQuickFilter("soon")}
        />
        <VortexMetricCard
          title={isRtl ? "منتهي الصلاحية" : t("batches.status.expired")}
          value={counts.expired}
          subtitle={isRtl ? "محظور من البيع" : "Past expiry"}
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
        viewToggle={<RecordsViewToggle value={viewMode} onChange={setViewMode} />}
        action={
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setOpenSettingsDialog(true)}
              className="h-9 gap-1.5 text-xs font-semibold"
            >
              <Settings2 className="size-4 text-muted-foreground" />
              <span>{isRtl ? "إعدادات الدفعات" : "Batch Settings"}</span>
            </Button>

            <PrimaryAction
              label={t("batches.new")}
              icon={<Plus />}
              onClick={() => setOpenAddDialog(true)}
            />
          </div>
        }
      >
        <QuickFilterBar
          value={quickFilter}
          onChange={(id) => setQuickFilter(id as QuickFilter)}
          items={[
            { id: "all", label: isRtl ? "الكل" : "All", count: counts.total, tone: "primary" },
            {
              id: "valid",
              label: isRtl ? "صالح" : t("batches.status.valid"),
              count: counts.valid,
              tone: "success",
            },
            {
              id: "soon",
              label: isRtl ? "قريب الانتهاء" : t("batches.status.soon"),
              count: counts.soon,
              tone: "warning",
            },
            {
              id: "expired",
              label: isRtl ? "منتهي" : t("batches.status.expired"),
              count: counts.expired,
              tone: "danger",
            },
          ]}
        />
      </TableToolbar>

      {/* ─── Records: cards / list / classic table ─── */}
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
              onClick={() => setOpenAddDialog(true)}
              className="mt-2 inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-xs font-bold text-primary-foreground shadow-sm transition hover:bg-primary/90 active:scale-95"
            >
              <Plus className="size-4" />
              <span>{t("batches.new")}</span>
            </button>
          ),
        }}
      />

      {/* Upgraded Add Batch Dialog */}
      <AddBatchDialog
        open={openAddDialog}
        onOpenChange={setOpenAddDialog}
        onSaved={() => {
          qc.invalidateQueries({ queryKey: ["batches"] });
          qc.invalidateQueries({ queryKey: ["batch-kpis"] });
          qc.invalidateQueries({ queryKey: ["inventory"] });
        }}
        hasMultiWarehouse={hasMultiWarehouse}
      />

      {/* Batch Settings Dialog */}
      <BatchSettingsDialog open={openSettingsDialog} onOpenChange={setOpenSettingsDialog} />
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
          {r.products?.sku && (
            <span className="font-mono text-[10px] text-muted-foreground/75">{r.products.sku}</span>
          )}
        </div>
        <span
          className={`shrink-0 whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] font-semibold ${meta.cls}`}
        >
          {meta.label}
        </span>
      </div>

      <div className="mt-4 flex items-center justify-between border-t border-border/60 pt-3 text-xs">
        <div className="min-w-0 flex-1 space-y-0.5">
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <span>{isRtl ? "الكمية:" : "Qty:"}</span>
            <span className="font-mono font-bold text-foreground">{formatQty(r.quantity)}</span>
          </div>
          {hasMultiWarehouse && r.warehouses && (
            <div className="truncate text-[10px] text-muted-foreground">{warehouseLabel(r)}</div>
          )}
        </div>

        <div className="flex items-center gap-2">
          <div className="text-end">
            <div className="font-mono text-[11px] text-muted-foreground">
              {r.expiry_date ?? "—"}
            </div>
          </div>
          <BatchRowActions
            row={r}
            onDelete={onDelete}
            deleting={deleting}
            deleteLabel={deleteLabel}
          />
        </div>
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

  return (
    <div className="card-mullak group flex items-center justify-between gap-3 rounded-xl p-3 transition hover:shadow-sm">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <div className="grid size-9 shrink-0 place-items-center rounded-xl border border-primary/20 bg-primary/10 text-primary">
          <CalendarClock className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs font-bold text-foreground">{r.batch_number}</span>
            <span
              className={`rounded-full border px-1.5 py-0.2 text-[9px] font-semibold ${meta.cls}`}
            >
              {meta.label}
            </span>
          </div>
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <span className="truncate">{productLabel(r) ?? "—"}</span>
            {r.products?.sku && <span className="font-mono text-[10px]">({r.products.sku})</span>}
            {hasMultiWarehouse && r.warehouses && (
              <span className="truncate text-[10px]">· {warehouseLabel(r)}</span>
            )}
          </div>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-4">
        <div className="text-end">
          <div className="font-mono text-xs font-bold text-foreground">{formatQty(r.quantity)}</div>
          <div className="font-mono text-[10px] text-muted-foreground">{r.expiry_date ?? "—"}</div>
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

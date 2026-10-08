import { ModuleGuard, useModules } from "@/lib/modules";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import { PageHeader } from "@/components/page-header";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import {
  Boxes,
  LayoutGrid,
  List,
  Pencil,
  Plus,
  Star,
  TableProperties,
  Trash2,
  Warehouse,
  X,
} from "lucide-react";
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
import { QUERY_KEYS } from "@/lib/query-keys";

export const Route = createFileRoute("/_app/warehouses")({
  head: () => ({ meta: [{ title: "المستودعات — فورتيكس ERP" }] }),
  component: () => (
    <ModuleGuard moduleId="multi_warehouse">
      <WarehousesPage />
    </ModuleGuard>
  ),
});

type Row = {
  id: string;
  name: string;
  name_ar: string | null;
  code: string | null;
  address: string | null;
  is_default: boolean;
  is_active: boolean;
};

type ViewMode = RecordsViewMode;
type QuickFilter = "all" | "active" | "inactive" | "default";

function WarehousesPage() {
  const { checkQuota } = useModules();
  const { t, lang } = useI18n();
  const isRtl = lang === "ar";
  const qc = useQueryClient();
  const breakpoint = useBreakpoint();
  const tableUsesHorizontalScroll =
    breakpoint === "xs" || breakpoint === "sm" || breakpoint === "md";

  const [q, setQ] = useState("");
  const [filters, setFilters] = useState<FilterValues>({});
  const [sortKey, setSortKey] = useState<string>("default_first");
  const [sort, setSort] = useState<DataTableSort | null>(null);
  const [quickFilter, setQuickFilter] = useState<QuickFilter>("all");
  const [viewMode, setViewMode] = useState<ViewMode>("cards");
  const [editing, setEditing] = useState<Row | null>(null);
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  /*
   * The warehouse directory now flows through the shared QueryClient instead of
   * an ad-hoc `useQuery` with a bespoke key, so sign-out drops it, Realtime can
   * patch it, and a save/delete invalidates exactly this key. The read itself is
   * unchanged: same table, same columns, same ordering.
   */
  const {
    data = [],
    isLoading,
    isFetching,
    error,
    refetch,
  } = useQuery({
    queryKey: QUERY_KEYS.warehouses,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("warehouses")
        .select("id, name, name_ar, code, address, is_default, is_active")
        .order("is_default", { ascending: false })
        .order("name");
      if (error) throw error;
      return (data ?? []) as Row[];
    },
    staleTime: 60_000,
  });

  /*
   * Rows are the raw table rows but the screen enriches the display (bilingual
   * name fallbacks, default/active tone). `invalidate` keeps a half-built row
   * from ever rendering, at the cost of one authoritative refetch per burst.
   */
  useRealtimeTable<Row>(
    { table: "warehouses", queryKey: QUERY_KEYS.warehouses, mode: "invalidate", debounceMs: 150 },
    qc,
  );

  const label = useCallback(
    (r: Row) => (isRtl ? r.name_ar || r.name : r.name || r.name_ar || "—"),
    [isRtl],
  );

  /* ---------------- search + filter + quick chips ---------------- */
  const searched = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return data;
    return data.filter((r) =>
      [r.name, r.name_ar, r.code, r.address].some((x) => (x ?? "").toLowerCase().includes(s)),
    );
  }, [data, q]);

  const filterDefinitions: FilterDefinition[] = useMemo(
    () => [
      {
        key: "is_active",
        label: isRtl ? "حالة المستودع" : "Status",
        type: "select",
        options: [
          { value: "true", label: isRtl ? "نشط فقط" : "Active only" },
          { value: "false", label: isRtl ? "غير نشط فقط" : "Inactive only" },
        ],
      },
      {
        key: "is_default",
        label: isRtl ? "المستودع الافتراضي" : "Default warehouse",
        type: "boolean",
      },
    ],
    [isRtl],
  );

  const filtered = useMemo(() => {
    return searched.filter((r) => {
      if (filters.is_active && String(r.is_active) !== filters.is_active) return false;
      if (filters.is_default === "true" && !r.is_default) return false;
      if (filters.is_default === "false" && r.is_default) return false;
      if (quickFilter === "active" && !r.is_active) return false;
      if (quickFilter === "inactive" && r.is_active) return false;
      if (quickFilter === "default" && !r.is_default) return false;
      return true;
    });
  }, [searched, filters, quickFilter]);

  /* ---------------- KPI ---------------- */
  const { activeCount, inactiveCount, defaultCount } = useMemo(() => {
    let active = 0;
    let inactive = 0;
    let isDefault = 0;
    for (const r of data) {
      if (r.is_active) active++;
      else inactive++;
      if (r.is_default) isDefault++;
    }
    return { activeCount: active, inactiveCount: inactive, defaultCount: isDefault };
  }, [data]);

  /* ---------------- sort ---------------- */
  const sortOptions: SortOption[] = useMemo(
    () => [
      { value: "default_first", label: isRtl ? "الافتراضي أولاً" : "Default first" },
      { value: "name_asc", label: isRtl ? "الاسم (أ - ي)" : "Name (A - Z)" },
      { value: "name_desc", label: isRtl ? "الاسم (ي - أ)" : "Name (Z - A)" },
      { value: "code_asc", label: isRtl ? "الرمز (أ - ي)" : "Code (A - Z)" },
      { value: "status", label: isRtl ? "الحالة" : "Status" },
    ],
    [isRtl],
  );

  const sortedRows = useMemo(() => {
    const list = [...filtered];
    const byName = (a: Row, b: Row) => label(a).localeCompare(label(b), isRtl ? "ar" : "en");

    // A column-header click (classic table) takes precedence over the preset.
    if (sort) {
      const dir = sort.direction === "asc" ? 1 : -1;
      switch (sort.key) {
        case "name":
          return list.sort((a, b) => byName(a, b) * dir);
        case "code":
          return list.sort((a, b) => (a.code ?? "").localeCompare(b.code ?? "") * dir);
        case "status":
          return list.sort((a, b) => (Number(a.is_active) - Number(b.is_active)) * dir);
        case "is_default":
          return list.sort((a, b) => (Number(a.is_default) - Number(b.is_default)) * dir);
        default:
          break;
      }
    }

    switch (sortKey) {
      case "name_asc":
        return list.sort(byName);
      case "name_desc":
        return list.sort((a, b) => byName(b, a));
      case "code_asc":
        return list.sort((a, b) => (a.code ?? "").localeCompare(b.code ?? ""));
      case "status":
        return list.sort((a, b) => Number(b.is_active) - Number(a.is_active));
      default:
        return list.sort((a, b) => Number(b.is_default) - Number(a.is_default) || byName(a, b));
    }
  }, [filtered, sort, sortKey, label, isRtl]);

  /* ---------------- mutations (unchanged behaviour) ---------------- */
  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("warehouses").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(t("common.deleted") || "Deleted");
      qc.invalidateQueries({ queryKey: QUERY_KEYS.warehouses });
      qc.invalidateQueries({ queryKey: ["warehouses-admin"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const setDefault = useMutation({
    mutationFn: async (id: string) => {
      await supabase.from("warehouses").update({ is_default: false }).neq("id", id);
      const { error } = await supabase
        .from("warehouses")
        .update({ is_default: true, is_active: true })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QUERY_KEYS.warehouses });
      qc.invalidateQueries({ queryKey: ["warehouses-admin"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  /* Stable per-row handlers so a card is not re-created on every parent render. */
  const openNew = useCallback(() => {
    const qCheck = checkQuota("warehouses", data.length);
    if (!qCheck.allowed) {
      toast.error(isRtl ? qCheck.message?.ar : qCheck.message?.en);
      return;
    }
    setEditing(null);
    setOpen(true);
  }, [checkQuota, data.length, isRtl]);

  const openEdit = useCallback((row: Row) => {
    setEditing(row);
    setOpen(true);
  }, []);

  const removeRow = useCallback(
    (id: string) => {
      if (deleting) return;
      if (!confirm(`${t("common.delete")}?`)) return;
      setDeleting(id);
      remove.mutate(id, { onSettled: () => setDeleting(null) });
    },
    [deleting, remove, t],
  );

  const handleSetDefault = useCallback((id: string) => setDefault.mutate(id), [setDefault]);

  /* ---------------- classic table columns ---------------- */
  const columns = useMemo<DataTableColumn<Row>[]>(
    () => [
      {
        key: "name",
        header: t("warehouses.name"),
        sortable: true,
        width: "w-[280px]",
        sortValue: (r) => label(r),
        cell: (r) => (
          <div className="py-0.5">
            <div className="flex items-center gap-2 font-medium text-foreground">
              <span className="truncate">{label(r)}</span>
              {r.is_default && (
                <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                  <Star className="h-3 w-3" />
                  {t("warehouses.is_default")}
                </span>
              )}
            </div>
            {(isRtl ? r.name : r.name_ar) && (
              <div className="text-[11px] text-muted-foreground">{isRtl ? r.name : r.name_ar}</div>
            )}
          </div>
        ),
      },
      {
        key: "code",
        header: t("warehouses.code"),
        sortable: true,
        width: "w-[140px]",
        sortValue: (r) => r.code ?? "",
        cell: (r) => (
          <span className="font-mono text-xs text-muted-foreground">{r.code ?? "—"}</span>
        ),
      },
      {
        key: "address",
        header: t("warehouses.address"),
        width: "w-[260px]",
        cell: (r) => (
          <span className="block truncate text-muted-foreground">{r.address ?? "—"}</span>
        ),
      },
      {
        key: "status",
        header: t("common.status"),
        sortable: true,
        align: "end",
        width: "w-[120px]",
        sortValue: (r) => Number(r.is_active),
        cell: (r) => (
          <span
            className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium ${r.is_active ? "bg-success/10 text-success" : "bg-muted text-muted-foreground"}`}
          >
            {r.is_active ? t("common.active") : t("common.inactive")}
          </span>
        ),
      },
      {
        key: "actions",
        header: t("common.actions"),
        align: "end",
        width: "w-[150px]",
        cell: (r) => (
          <div className="flex items-center justify-end gap-1">
            {!r.is_default && (
              <IconButton
                size="sm"
                variant="outline"
                tooltip
                ariaLabel={t("warehouses.set_default")}
                icon={<Star className="size-3.5" />}
                round
                onClick={() => handleSetDefault(r.id)}
              />
            )}
            <IconButton
              size="sm"
              variant="outline"
              tooltip
              ariaLabel={t("common.edit")}
              icon={<Pencil className="size-3.5" />}
              round
              onClick={() => openEdit(r)}
            />
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
          </div>
        ),
      },
    ],
    [t, label, isRtl, handleSetDefault, openEdit, removeRow, deleting],
  );

  const hasActiveCriteria = Boolean(q.trim()) || Object.keys(filters).length > 0;

  const rendererProps = (r: Row) => ({
    row: r,
    isRtl,
    label,
    onEdit: openEdit,
    onDelete: removeRow,
    onSetDefault: handleSetDefault,
    deleting: deleting === r.id,
    editLabel: t("common.edit"),
    deleteLabel: t("common.delete"),
    setDefaultLabel: t("warehouses.set_default"),
    defaultLabel: t("warehouses.is_default"),
    activeLabel: t("common.active"),
    inactiveLabel: t("common.inactive"),
  });

  return (
    <div className="space-y-4 pb-12">
      <PageHeader title={t("warehouses.title")} subtitle={t("warehouses.subtitle")} />

      {/* ─── KPI cards ─── */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <VortexMetricCard
          title={isRtl ? "إجمالي المستودعات" : "Total warehouses"}
          value={data.length}
          subtitle={isRtl ? "المحمّلة حالياً" : "Currently loaded"}
          icon={<Warehouse className="size-5" />}
          tone="info"
        />
        <VortexMetricCard
          title={isRtl ? "نشط" : "Active"}
          value={activeCount}
          subtitle={isRtl ? "جاهز للاستخدام" : "Ready to use"}
          icon={<Boxes className="size-5" />}
          tone="success"
          highlight={quickFilter === "active"}
          onClick={() => setQuickFilter("active")}
        />
        <VortexMetricCard
          title={isRtl ? "غير نشط" : "Inactive"}
          value={inactiveCount}
          subtitle={isRtl ? "موقوف مؤقتاً" : "Temporarily disabled"}
          icon={<Boxes className="size-5" />}
          tone="warning"
          highlight={quickFilter === "inactive"}
          onClick={() => setQuickFilter("inactive")}
        />
        <VortexMetricCard
          title={isRtl ? "الافتراضي" : "Default"}
          value={defaultCount}
          subtitle={isRtl ? "مستودع الترحيل الافتراضي" : "Default posting warehouse"}
          icon={<Star className="size-5" />}
          tone="default"
          highlight={quickFilter === "default"}
          onClick={() => setQuickFilter("default")}
        />
      </div>

      {/* ─── Standard VORTEX TableToolbar: search + filters + sort + view + add ─── */}
      <TableToolbar
        sticky
        lang={lang}
        search={{
          value: q,
          onValueChange: setQ,
          placeholder: isRtl
            ? "ابحث بالاسم أو الرمز أو العنوان..."
            : "Search by name, code or address…",
          resultCount: filtered.length,
          loading: isFetching && !isLoading,
        }}
        filters={{ definitions: filterDefinitions, values: filters, onValueChange: setFilters }}
        sort={{
          options: sortOptions,
          value: sortKey,
          onValueChange: (value) => {
            setSortKey(value);
            // A preset replaces whatever the table header had selected.
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
            label={t("warehouses.new")}
            icon={<Plus />}
            tone="primary"
            onClick={openNew}
          />
        }
      >
        <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
          {(
            [
              { id: "all", label: isRtl ? "الكل" : "All", count: data.length },
              { id: "active", label: isRtl ? "النشطة" : "Active", count: activeCount },
              { id: "inactive", label: isRtl ? "غير النشطة" : "Inactive", count: inactiveCount },
              { id: "default", label: isRtl ? "الافتراضي" : "Default", count: defaultCount },
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
      <RecordsView<Row>
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
        minWidth={1000}
        horizontalScroll={tableUsesHorizontalScroll}
        onRowClick={openEdit}
        renderCard={(r) => <WarehouseCard {...rendererProps(r)} />}
        renderListRow={(r) => <WarehouseListRow {...rendererProps(r)} />}
        empty={{
          icon: <Boxes />,
          title: hasActiveCriteria
            ? isRtl
              ? "لا توجد سجلات مطابقة"
              : "No matching warehouses"
            : t("warehouses.empty"),
          description: hasActiveCriteria
            ? isRtl
              ? "جرّب تعديل البحث أو الفلاتر."
              : "Try adjusting your search or filters."
            : t("warehouses.empty_hint"),
          action: (
            <button
              type="button"
              onClick={openNew}
              className="mt-2 inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-xs font-bold text-primary-foreground shadow-sm transition hover:bg-primary/90 active:scale-95"
            >
              <Plus className="size-4" />
              <span>{t("warehouses.new")}</span>
            </button>
          ),
        }}
      />

      {open && (
        <WarehouseDialog
          initial={editing}
          onClose={() => setOpen(false)}
          onSaved={() => {
            setOpen(false);
            qc.invalidateQueries({ queryKey: QUERY_KEYS.warehouses });
            qc.invalidateQueries({ queryKey: ["warehouses-admin"] });
          }}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Warehouse renderers                                                */
/* ------------------------------------------------------------------ */

interface WarehouseRendererProps {
  row: Row;
  isRtl: boolean;
  label: (r: Row) => string;
  onEdit: (row: Row) => void;
  onDelete: (id: string) => void;
  onSetDefault: (id: string) => void;
  deleting: boolean;
  editLabel: string;
  deleteLabel: string;
  setDefaultLabel: string;
  defaultLabel: string;
  activeLabel: string;
  inactiveLabel: string;
}

function WarehouseRowActions({
  row,
  onEdit,
  onDelete,
  onSetDefault,
  deleting,
  editLabel,
  deleteLabel,
  setDefaultLabel,
}: Pick<
  WarehouseRendererProps,
  | "row"
  | "onEdit"
  | "onDelete"
  | "onSetDefault"
  | "deleting"
  | "editLabel"
  | "deleteLabel"
  | "setDefaultLabel"
>) {
  return (
    <div className="flex shrink-0 items-center gap-1" onClick={(event) => event.stopPropagation()}>
      {!row.is_default && (
        <IconButton
          size="sm"
          variant="outline"
          tooltip
          ariaLabel={setDefaultLabel}
          icon={<Star className="size-3.5" />}
          round
          onClick={() => onSetDefault(row.id)}
        />
      )}
      <IconButton
        size="sm"
        variant="outline"
        tooltip
        ariaLabel={editLabel}
        icon={<Pencil className="size-3.5" />}
        round
        onClick={() => onEdit(row)}
      />
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

function WarehouseCard({
  row: r,
  isRtl,
  label,
  onEdit,
  onDelete,
  onSetDefault,
  deleting,
  editLabel,
  deleteLabel,
  setDefaultLabel,
  defaultLabel,
  activeLabel,
  inactiveLabel,
}: WarehouseRendererProps) {
  const secondary = isRtl ? r.name : r.name_ar;
  return (
    <div className="card-mullak group relative flex h-full flex-col justify-between rounded-2xl p-3 transition-all duration-200 hover:shadow-md sm:p-4.5">
      <div className="flex items-start gap-2.5">
        <span
          aria-hidden
          className={`h-12 w-1.5 shrink-0 rounded-full transition-all duration-300 ${
            r.is_active
              ? "bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.3)]"
              : "bg-muted-foreground/40"
          }`}
        />
        <div className="grid size-11 shrink-0 place-items-center rounded-2xl border border-primary/20 bg-primary/10 text-primary transition-transform group-hover:scale-105">
          <Warehouse className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <h4 className="truncate text-xs font-bold text-foreground transition-colors group-hover:text-primary sm:text-sm">
            {label(r)}
          </h4>
          <div className="mt-1 flex flex-wrap items-center gap-1">
            <span
              className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[9px] font-bold ${
                r.is_active
                  ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                  : "bg-muted text-muted-foreground border-border"
              }`}
            >
              <span
                className={`size-1.5 rounded-full ${r.is_active ? "bg-emerald-500" : "bg-muted-foreground/50"}`}
              />
              {r.is_active ? activeLabel : inactiveLabel}
            </span>
            {r.is_default && (
              <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-primary/25 bg-primary/10 px-2 py-0.5 text-[9px] font-bold text-primary">
                <Star className="size-2.5" />
                {defaultLabel}
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
        {r.code && (
          <span className="inline-flex items-center gap-1 font-mono">
            {isRtl ? "الرمز:" : "Code:"} {r.code}
          </span>
        )}
        {secondary && <span className="truncate">{secondary}</span>}
        {r.address && <span className="line-clamp-1 w-full">{r.address}</span>}
      </div>

      <div className="mt-3 flex items-center justify-end border-t border-border/60 pt-2.5">
        <WarehouseRowActions
          row={r}
          onEdit={onEdit}
          onDelete={onDelete}
          onSetDefault={onSetDefault}
          deleting={deleting}
          editLabel={editLabel}
          deleteLabel={deleteLabel}
          setDefaultLabel={setDefaultLabel}
        />
      </div>
    </div>
  );
}

function WarehouseListRow({
  row: r,
  isRtl,
  label,
  onEdit,
  onDelete,
  onSetDefault,
  deleting,
  editLabel,
  deleteLabel,
  setDefaultLabel,
  defaultLabel,
  activeLabel,
  inactiveLabel,
}: WarehouseRendererProps) {
  const secondary = isRtl ? r.name : r.name_ar;
  return (
    <div className="card-mullak group relative flex flex-col justify-between gap-3 rounded-2xl border p-3.5 transition-all duration-200 hover:border-primary/50 hover:shadow-md sm:p-4 md:flex-row md:items-center">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <span
          aria-hidden
          className={`h-11 w-1.5 shrink-0 rounded-full sm:h-12 ${
            r.is_active
              ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.4)]"
              : "bg-muted-foreground/30"
          }`}
        />
        <div className="grid size-11 shrink-0 place-items-center rounded-xl border border-primary/20 bg-primary/10 text-primary transition-all group-hover:scale-105 group-hover:bg-primary group-hover:text-primary-foreground">
          <Warehouse className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="truncate text-sm font-bold leading-snug text-foreground">{label(r)}</h4>
            <span
              className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[9px] font-bold ${
                r.is_active
                  ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                  : "bg-muted text-muted-foreground border-border"
              }`}
            >
              {r.is_active ? activeLabel : inactiveLabel}
            </span>
            {r.is_default && (
              <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-primary/25 bg-primary/10 px-2 py-0.5 text-[9px] font-bold text-primary">
                <Star className="size-2.5" />
                {defaultLabel}
              </span>
            )}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
            {r.code && <span className="font-mono">{r.code}</span>}
            {secondary && <span className="truncate">{secondary}</span>}
            {r.address && <span className="truncate">— {r.address}</span>}
          </div>
        </div>
      </div>

      <WarehouseRowActions
        row={r}
        onEdit={onEdit}
        onDelete={onDelete}
        onSetDefault={onSetDefault}
        deleting={deleting}
        editLabel={editLabel}
        deleteLabel={deleteLabel}
        setDefaultLabel={setDefaultLabel}
      />
    </div>
  );
}

const inputCls =
  "h-9 w-full rounded-md border border-border bg-surface px-3 text-sm text-foreground outline-none focus:border-primary/60 focus:ring-1 focus:ring-primary/30 transition";

function WarehouseDialog({
  initial,
  onClose,
  onSaved,
}: {
  initial: Row | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useI18n();
  const [form, setForm] = useState({
    name: initial?.name ?? "",
    name_ar: initial?.name_ar ?? "",
    code: initial?.code ?? "",
    address: initial?.address ?? "",
    is_default: initial?.is_default ?? false,
    is_active: initial?.is_active ?? true,
  });
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name_ar.trim() && !form.name.trim()) {
      toast.error(t("catalog.name_required"));
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim() || form.name_ar.trim(),
        name_ar: form.name_ar.trim() || null,
        code: form.code.trim() || null,
        address: form.address.trim() || null,
        is_default: form.is_default,
        is_active: form.is_active,
      };
      if (form.is_default) {
        await supabase
          .from("warehouses")
          .update({ is_default: false })
          .neq("id", initial?.id ?? "00000000-0000-0000-0000-000000000000");
      }
      const { error } = initial
        ? await supabase.from("warehouses").update(payload).eq("id", initial.id)
        : await supabase.from("warehouses").insert(payload);
      if (error) {
        toast.error(error.message);
        return;
      }
      toast.success(t("common.saved") || "Saved");
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="panel-elevated w-full max-w-lg overflow-hidden"
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="text-sm font-semibold text-foreground">
            {initial ? t("warehouses.edit") : t("warehouses.new")}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground hover:bg-accent"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="grid grid-cols-1 gap-3 p-5 sm:grid-cols-2">
          <Field label={`${t("warehouses.name_ar")} *`}>
            <input
              value={form.name_ar}
              onChange={(e) => setForm({ ...form, name_ar: e.target.value })}
              className={inputCls}
              dir="rtl"
              required
            />
          </Field>
          <Field label={t("warehouses.name")}>
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className={inputCls}
            />
          </Field>
          <Field label={t("warehouses.code")}>
            <input
              value={form.code}
              onChange={(e) => setForm({ ...form, code: e.target.value })}
              className={inputCls}
            />
          </Field>
          <Field label={t("common.status")}>
            <label className="flex h-9 items-center gap-2 rounded-md border border-border bg-surface px-3 text-sm">
              <input
                type="checkbox"
                checked={form.is_active}
                onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
              />
              <span className="text-muted-foreground">{t("common.active")}</span>
            </label>
          </Field>
          <Field label={t("warehouses.address")} className="sm:col-span-2">
            <input
              value={form.address}
              onChange={(e) => setForm({ ...form, address: e.target.value })}
              className={inputCls}
            />
          </Field>
          <Field label={t("warehouses.is_default")} className="sm:col-span-2">
            <label className="flex h-9 items-center gap-2 rounded-md border border-border bg-surface px-3 text-sm">
              <input
                type="checkbox"
                checked={form.is_default}
                onChange={(e) => setForm({ ...form, is_default: e.target.checked })}
              />
              <span className="text-muted-foreground">{t("warehouses.set_default")}</span>
            </label>
          </Field>
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-border bg-surface/40 px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 items-center rounded-md border border-border bg-surface px-3 text-xs font-medium text-muted-foreground hover:text-foreground transition"
          >
            {t("common.cancel")}
          </button>
          <button
            type="submit"
            disabled={saving}
            className="flex h-9 items-center rounded-md bg-primary px-4 text-xs font-medium text-primary-foreground hover:opacity-90 transition disabled:opacity-50"
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
      <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
  );
}

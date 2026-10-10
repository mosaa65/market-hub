import { ModuleGuard } from "@/lib/modules";
import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Building2,
  Plus,
  Pencil,
  Trash2,
  Wallet,
  LayoutGrid,
  List,
  TableProperties,
  Truck,
  PackageCheck,
  TrendingDown,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { useI18n } from "@/lib/i18n";
import { money } from "@/lib/format";
import { toSystemDigits } from "@/lib/format-preferences";
import { Ltr } from "@/components/ltr-value";
import { WhatsAppButton } from "@/components/whatsapp-button";
import { supplierMessage } from "@/lib/whatsapp-templates";
import {
  SupplierFormDialog,
  type SupplierRecord,
} from "@/components/contacts/supplier-form-dialog";
import { VortexMetricCard } from "@/components/vortex-ui";
import {
  TableToolbar,
  ToolbarAction,
  type FilterDefinition,
  type FilterValues,
  type SortOption,
} from "@/components/ui/table-toolbar";
import { type DataTableColumn, type DataTableSort } from "@/components/ui/data-table";
import { RecordsView, type RecordsViewMode } from "@/components/ui/records-view";
import { IconButton } from "@/components/ui/icon-button";
import { useBreakpoint } from "@/design/breakpoints";
import { useRealtimeTable } from "@/lib/realtime";
import { supplierKeys } from "@/lib/query-keys";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/suppliers")({
  head: () => ({ meta: [{ title: "الموردون — فورتيكس ERP" }] }),
  component: () => (
    <ModuleGuard moduleId="purchases">
      <SuppliersPage />
    </ModuleGuard>
  ),
});

type Supplier = SupplierRecord & {
  balance: number;
  is_active: boolean;
  created_at: string;
};

type ViewMode = RecordsViewMode;
type FilterType = "all" | "payable" | "advance" | "active";

function SuppliersPage() {
  const { t, lang } = useI18n();
  const isRtl = lang === "ar";
  const qc = useQueryClient();

  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState<FilterType>("all");
  const [filters, setFilters] = useState<FilterValues>({});
  const [sortKey, setSortKey] = useState<string>("name_asc");
  const [viewMode, setViewMode] = useState<ViewMode>("cards");
  const [edit, setEdit] = useState<Partial<Supplier> | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  /*
   * Column-header sorting for the classic table, kept separate from the
   * toolbar preset (`sortKey`). `filtered` decides precedence so a header
   * click always wins over a stale dropdown value.
   */
  const [sort, setSort] = useState<DataTableSort | null>(null);
  const breakpoint = useBreakpoint();
  const tableUsesHorizontalScroll =
    breakpoint === "xs" || breakpoint === "sm" || breakpoint === "md";

  /*
   * The directory is loaded through the shared QueryClient (it used to be a
   * `useState` + manual `load()`), which is what lets sign-out drop it, lets
   * Realtime patch it, and lets a save/edit invalidate exactly this key
   * instead of re-reading whatever happens to be mounted.
   *
   * The read itself is unchanged: same table, same ordering, same 1000-row cap
   * that the previous `.limit(1000)` used.
   */
  const {
    data: rows = [],
    isLoading: loading,
    isFetching,
    error: loadError,
    refetch: load,
  } = useQuery({
    queryKey: supplierKeys.list(),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("suppliers")
        .select("*")
        .order("name")
        .limit(1000);
      if (error) throw error;
      return (data ?? []) as Supplier[];
    },
    staleTime: 60_000,
  });

  /*
   * Live updates for the supplier ledger.
   *
   * `mode: "invalidate"` is deliberate: the rows here are the raw table rows,
   * but the screen sorts and filters them client-side and every row shows a
   * balance. Re-reading the key gives the authoritative list for one extra
   * request per burst, and a supplier row can never be displayed half-built.
   */
  useRealtimeTable<Supplier>(
    {
      table: "suppliers",
      queryKey: supplierKeys.list(),
      mode: "invalidate",
      debounceMs: 150,
    },
    qc,
  );

  const filtered = useMemo(() => {
    let list = rows.filter((r) => {
      if (search.trim()) {
        const q = search.trim().toLowerCase();
        const matches =
          (r.name ?? "").toLowerCase().includes(q) ||
          (r.phone ?? "").includes(q) ||
          (r.email ?? "").toLowerCase().includes(q) ||
          (r.address ?? "").toLowerCase().includes(q);
        if (!matches) return false;
      }

      const bal = Number(r.balance);
      if (filterType === "payable" && bal <= 0) return false;
      if (filterType === "advance" && bal >= 0) return false;
      if (filterType === "active" && !r.is_active) return false;

      if (filters.is_active && String(r.is_active) !== filters.is_active) return false;
      if (filters.balance_type) {
        if (filters.balance_type === "payable" && bal <= 0) return false;
        if (filters.balance_type === "advance" && bal >= 0) return false;
        if (filters.balance_type === "zero" && bal !== 0) return false;
      }
      if (filters.created_at && typeof filters.created_at === "object") {
        const rowTime = new Date(r.created_at).getTime();
        if (filters.created_at.from && rowTime < new Date(filters.created_at.from).getTime())
          return false;
        if (filters.created_at.to) {
          const toDate = new Date(filters.created_at.to);
          toDate.setHours(23, 59, 59, 999);
          if (rowTime > toDate.getTime()) return false;
        }
      }

      return true;
    });

    list = [...list].sort((a, b) => {
      const aBal = Number(a.balance);
      const bBal = Number(b.balance);

      // A column-header click (classic table) takes precedence over the preset.
      if (sort) {
        const dir = sort.direction === "asc" ? 1 : -1;
        switch (sort.key) {
          case "name":
            return (a.name ?? "").localeCompare(b.name ?? "", "ar") * dir;
          case "phone":
            return (a.phone ?? "").localeCompare(b.phone ?? "") * dir;
          case "email":
            return (a.email ?? "").localeCompare(b.email ?? "") * dir;
          case "balance":
            return (aBal - bBal) * dir;
          case "created_at":
            return (new Date(a.created_at).getTime() - new Date(b.created_at).getTime()) * dir;
          case "is_active":
            return (Number(a.is_active) - Number(b.is_active)) * dir;
          default:
            break;
        }
      }

      switch (sortKey) {
        case "name_asc":
          return (a.name ?? "").localeCompare(b.name ?? "", "ar");
        case "name_desc":
          return (b.name ?? "").localeCompare(a.name ?? "", "ar");
        case "balance_desc":
          return bBal - aBal;
        case "balance_asc":
          return aBal - bBal;
        case "date_desc":
          return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
        case "date_asc":
          return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
        default:
          return 0;
      }
    });

    return list;
  }, [rows, search, filterType, filters, sortKey, sort]);

  // Balance summaries — payable (we owe) vs advance (prepaid) vs settled.
  const { totalPayable, totalAdvance, activeCount, payableCount } = useMemo(() => {
    let payable = 0;
    let advance = 0;
    let active = 0;
    let owed = 0;
    for (const r of rows) {
      const bal = Number(r.balance);
      if (bal > 0) {
        payable += bal;
        owed++;
      } else if (bal < 0) {
        advance += Math.abs(bal);
      }
      if (r.is_active) active++;
    }
    return {
      totalPayable: payable,
      totalAdvance: advance,
      activeCount: active,
      payableCount: owed,
    };
  }, [rows]);

  /*
   * Open the form for editing.
   *
   * Memoised on purpose: the card/list renderers receive it as a prop, and an
   * inline arrow here would change identity on every render — re-rendering
   * every visible card on each keystroke in the search box.
   */
  const openEdit = useCallback((supplier: Supplier) => setEdit(supplier), []);

  /*
   * The delete guard is a ref-like latch, not `deleting` alone: the state
   * update is asynchronous, so two fast clicks on the same row could both pass
   * the check before either had set it.
   */
  const remove = useCallback(
    async (id: string) => {
      if (deleting) return;
      if (!confirm(t("suppliers.delete_confirm"))) return;
      setDeleting(id);
      try {
        const { error } = await supabase.from("suppliers").delete().eq("id", id);
        if (error) {
          toast.error(error.message);
          return;
        }
        toast.success(t("common.deleted"));
        // Only the supplier directory is affected — the lookups behind the
        // screen (warehouses, units, tax) must not be re-read for this.
        await qc.invalidateQueries({ queryKey: supplierKeys.all });
      } finally {
        setDeleting(null);
      }
    },
    [deleting, t, qc],
  );

  /* Stable per-row handlers so a card is not re-created on every parent render. */
  const removeRow = useCallback((id: string) => void remove(id), [remove]);

  const supplierFilterDefinitions: FilterDefinition[] = useMemo(
    () => [
      {
        key: "created_at",
        label: isRtl ? "تاريخ التسجيل" : "Registration Date",
        type: "date-range",
      },
      {
        key: "is_active",
        label: isRtl ? "حالة النشاط" : "Status",
        type: "select",
        options: [
          { value: "true", label: isRtl ? "نشط فقط" : "Active only" },
          { value: "false", label: isRtl ? "غير نشط فقط" : "Inactive only" },
        ],
      },
      {
        key: "balance_type",
        label: isRtl ? "حالة الرصيد" : "Balance Type",
        type: "select",
        options: [
          { value: "payable", label: isRtl ? "مستحق للمورد (له)" : "Payable (we owe)" },
          { value: "advance", label: isRtl ? "دفعة مقدمة (علينا)" : "Advance (prepaid)" },
          { value: "zero", label: isRtl ? "متزن (صفر)" : "Zero balance" },
        ],
      },
    ],
    [isRtl],
  );

  const supplierSortOptions: SortOption[] = useMemo(
    () => [
      { value: "name_asc", label: isRtl ? "الاسم (أ - ي)" : "Name (A - Z)" },
      { value: "name_desc", label: isRtl ? "الاسم (ي - أ)" : "Name (Z - A)" },
      { value: "balance_desc", label: isRtl ? "الأعلى رصيداً" : "Highest Balance" },
      { value: "balance_asc", label: isRtl ? "الأقل رصيداً" : "Lowest Balance" },
      { value: "date_desc", label: isRtl ? "الأحدث تسجيلاً" : "Newest Registered" },
      { value: "date_asc", label: isRtl ? "الأقدم تسجيلاً" : "Oldest Registered" },
    ],
    [isRtl],
  );

  // Status indicator (mirrors the customers "Mullak" signature colours).
  const getRecordIndicator = (supplier: Supplier) => {
    const bal = Number(supplier.balance);
    if (!supplier.is_active) {
      return {
        barClass: "bg-muted-foreground/40",
        label: isRtl ? "غير نشط" : "Inactive",
        toneClass: "bg-muted text-muted-foreground border-border",
      };
    }
    if (bal > 0) {
      return {
        barClass: "bg-amber-500 shadow-[0_0_10px_rgba(245,158,11,0.3)]",
        label: isRtl ? "مستحق للمورد" : "Payable",
        toneClass: "bg-amber-500/10 text-amber-400 border-amber-500/20",
      };
    }
    if (bal < 0) {
      return {
        barClass: "bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.3)]",
        label: isRtl ? "دفعة مقدمة" : "Advance",
        toneClass: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
      };
    }
    return {
      barClass: "bg-primary shadow-[0_0_10px_rgba(59,130,246,0.3)]",
      label: isRtl ? "خالص" : "Settled",
      toneClass: "bg-primary/10 text-primary border-primary/20",
    };
  };

  const whatsAppFor = (r: Supplier) =>
    supplierMessage({
      name: r.name,
      balance: money(Number(r.balance)),
      lang,
    });

  /*
   * Classic table columns.
   *
   * Same contract as the products/customers tables: each column is
   * independently sortable on its *displayed* value, values stay on one line
   * and truncate, and money is rendered through `<Ltr>` so a number never gets
   * mangled by bidi reordering inside an RTL layout.
   */
  const columns = useMemo<DataTableColumn<Supplier>[]>(() => {
    return [
      {
        key: "name",
        header: t("common.name"),
        sortable: true,
        width: "w-[260px]",
        sortValue: (r) => r.name ?? "",
        cell: (r) => {
          const meta = getRecordIndicator(r);
          return (
            <div className="flex items-center gap-3 py-0.5">
              <span aria-hidden className={`h-9 w-1.5 shrink-0 rounded-full ${meta.barClass}`} />
              <span className="grid size-9 shrink-0 place-items-center rounded-xl border border-primary/20 bg-primary/10 text-xs font-bold text-primary">
                {(r.name ?? "?").slice(0, 1)}
              </span>
              <div className="min-w-0">
                <span className="block truncate text-xs font-bold text-foreground">
                  {r.name || "—"}
                </span>
                {r.address && (
                  <span className="block truncate text-[10px] text-muted-foreground">
                    {r.address}
                  </span>
                )}
              </div>
            </div>
          );
        },
      },
      {
        key: "phone",
        header: t("common.phone"),
        sortable: true,
        width: "w-[180px]",
        sortValue: (r) => r.phone ?? "",
        cell: (r) =>
          r.phone ? (
            <div className="flex items-center gap-1.5" dir="ltr">
              <span className="truncate font-mono text-xs text-muted-foreground">
                {toSystemDigits(r.phone)}
              </span>
              <span onClick={(e) => e.stopPropagation()} className="shrink-0">
                <WhatsAppButton phone={r.phone} message={whatsAppFor(r)} />
              </span>
            </div>
          ) : (
            <span className="text-xs text-muted-foreground">—</span>
          ),
      },
      {
        key: "email",
        header: t("common.email"),
        sortable: true,
        width: "w-[200px]",
        sortValue: (r) => r.email ?? "",
        cell: (r) => (
          <Ltr className="block truncate text-xs text-muted-foreground">{r.email ?? "—"}</Ltr>
        ),
      },
      {
        key: "balance",
        header: t("common.balance"),
        align: "end",
        sortable: true,
        width: "w-[140px]",
        sortValue: (r) => Number(r.balance),
        cell: (r) => {
          const bal = Number(r.balance);
          return (
            <span
              className={`font-mono text-sm font-bold tabular-nums ${
                bal > 0 ? "text-amber-400" : bal < 0 ? "text-emerald-400" : "text-muted-foreground"
              }`}
            >
              <Ltr>{money(bal)}</Ltr>
            </span>
          );
        },
      },
      {
        key: "is_active",
        header: t("common.status"),
        sortable: true,
        width: "w-[130px]",
        sortValue: (r) => Number(r.is_active),
        cell: (r) => {
          const meta = getRecordIndicator(r);
          return (
            <span
              className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[10px] font-bold ${meta.toneClass}`}
            >
              <span className={`size-1.5 rounded-full ${meta.barClass}`} />
              {meta.label}
            </span>
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
              ariaLabel={t("common.edit")}
              icon={<Pencil />}
              round
              onClick={(event) => {
                event.stopPropagation();
                setEdit(r);
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
                void remove(r.id);
              }}
            />
          </div>
        ),
      },
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t, isRtl, lang, deleting]);

  return (
    <div className="space-y-5 pb-12">
      <PageHeader title={t("suppliers.title")} subtitle={t("suppliers.subtitle")} />

      {/* ─── Luxury Vortex KPI Metrics Cards (2 columns on mobile, 4 on desktop) ─── */}
      <div className="grid grid-cols-2 gap-2.5 sm:gap-4 lg:grid-cols-4">
        <VortexMetricCard
          title={isRtl ? "إجمالي الموردين" : "Total Suppliers"}
          value={toSystemDigits(rows.length.toString())}
          subtitle={`${toSystemDigits(activeCount.toString())} ${isRtl ? "مورد نشط" : "active"}`}
          icon={<Truck className="size-5" />}
          iconClassName="bg-primary/10 text-primary border border-primary/20"
          badge={isRtl ? "الدليل" : "Directory"}
          onClick={() => setFilterType("all")}
          highlight={filterType === "all"}
          className="cursor-pointer"
        />
        <VortexMetricCard
          title={isRtl ? "المبالغ المستحقة لهم" : "Payables (Owed)"}
          value={toSystemDigits(money(totalPayable))}
          subtitle={`${toSystemDigits(payableCount.toString())} ${isRtl ? "مورد له مبالغ" : "with balance"}`}
          icon={<Wallet className="size-5" />}
          iconClassName="bg-amber-500/10 text-amber-500 border border-amber-500/20"
          badge={isRtl ? "التزامات" : "Liabilities"}
          onClick={() => setFilterType("payable")}
          highlight={filterType === "payable"}
          className="cursor-pointer"
        />
        <VortexMetricCard
          title={isRtl ? "الدفعات المقدمة" : "Advances Paid"}
          value={toSystemDigits(money(totalAdvance))}
          subtitle={isRtl ? "مبالغ مدفوعة مقدماً" : "prepaid to vendors"}
          icon={<PackageCheck className="size-5" />}
          iconClassName="bg-emerald-500/10 text-emerald-500 border border-emerald-500/20"
          badge={isRtl ? "مقدماً" : "Prepaid"}
          onClick={() => setFilterType("advance")}
          highlight={filterType === "advance"}
          className="cursor-pointer"
        />
        <VortexMetricCard
          title={isRtl ? "صافي الموقف" : "Net Position"}
          value={toSystemDigits(money(totalPayable - totalAdvance))}
          subtitle={isRtl ? "الرصيد الصافي للدفتر" : "Net ledger position"}
          icon={<TrendingDown className="size-5" />}
          iconClassName="bg-sky-500/10 text-sky-500 border border-sky-500/20"
          badge={isRtl ? "الصافي" : "Net"}
        />
      </div>

      {/* ─── Standard VORTEX TableToolbar: Search + Filters + Sort + View T */}
      <TableToolbar
        sticky
        lang={lang}
        search={{
          value: search,
          onValueChange: setSearch,
          placeholder:
            lang === "ar"
              ? "ابحث بالاسم، رقم الهاتف، البريد أو العنوان..."
              : "Search by name, phone, email, address…",
          resultCount: filtered.length,
          loading: isFetching && !loading,
        }}
        filters={{
          definitions: supplierFilterDefinitions,
          values: filters,
          onValueChange: setFilters,
        }}
        sort={{
          options: supplierSortOptions,
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
            label={t("suppliers.new")}
            icon={<Plus />}
            tone="primary"
            onClick={() => setEdit({})}
          />
        }
      >
        <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 scrollbar-x-none">
          {[
            { id: "all", label: isRtl ? "الكل" : "All", count: rows.length },
            { id: "payable", label: isRtl ? "مستحق لهم" : "Payable", count: payableCount },
            { id: "advance", label: isRtl ? "دفعات مقدمة" : "Advance" },
            { id: "active", label: isRtl ? "النشطين" : "Active", count: activeCount },
          ].map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilterType(f.id as FilterType)}
              className={`flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-bold transition ${
                filterType === f.id
                  ? "border-primary bg-primary text-primary-foreground shadow-xs shadow-primary/20"
                  : "border-border/70 bg-surface/70 text-muted-foreground hover:bg-surface-2 hover:text-foreground"
              }`}
            >
              <span>{f.label}</span>
              {f.count !== undefined && (
                <span
                  className={`rounded-full px-1.5 py-0.2 text-[10px] font-mono ${
                    filterType === f.id
                      ? "bg-white/20 text-white"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  {toSystemDigits(f.count.toString())}
                </span>
              )}
            </button>
          ))}
        </div>
      </TableToolbar>

      {/* ─── Records: cards / list / classic table — shared scaffold ─── */}
      <RecordsView<Supplier>
        rows={filtered}
        getRowId={(r) => r.id}
        viewMode={viewMode}
        loading={loading}
        refreshing={isFetching && !loading}
        error={loadError}
        onRetry={() => void load()}
        columns={columns}
        sort={sort}
        onSortChange={setSort}
        minWidth={1260}
        horizontalScroll={tableUsesHorizontalScroll}
        onRowClick={openEdit}
        renderCard={(r) => (
          <SupplierCard
            supplier={r}
            isRtl={isRtl}
            meta={getRecordIndicator(r)}
            moneyOf={money}
            onEdit={openEdit}
            onDelete={removeRow}
            deleting={deleting === r.id}
            whatsAppMessage={whatsAppFor(r)}
            editLabel={t("common.edit")}
            deleteLabel={t("common.delete")}
          />
        )}
        renderListRow={(r) => (
          <SupplierListRow
            supplier={r}
            isRtl={isRtl}
            meta={getRecordIndicator(r)}
            moneyOf={money}
            onEdit={openEdit}
            onDelete={removeRow}
            deleting={deleting === r.id}
            whatsAppMessage={whatsAppFor(r)}
            editLabel={t("common.edit")}
            deleteLabel={t("common.delete")}
          />
        )}
        empty={{
          icon: <Building2 />,
          title: isRtl ? "لا توجد سجلات مطابقة" : "No matching suppliers",
          description: search
            ? isRtl
              ? `لا توجد نتائج تطابق "${search}". جرب البحث بكلمة أخرى.`
              : `No results found for "${search}".`
            : isRtl
              ? "ابدأ بتسجيل المورد الأول لمتابعة المشتريات والأرصدة."
              : "Register your first supplier to start tracking purchases and balances.",
          action: (
            <button
              type="button"
              onClick={() => setEdit({})}
              className="mt-2 inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-xs font-bold text-primary-foreground shadow-sm transition hover:bg-primary/90 active:scale-95"
            >
              <Plus className="size-4" />
              <span>{isRtl ? "إضافة مورد جديد الآن" : "Add New Supplier Now"}</span>
            </button>
          ),
        }}
      />

      <SupplierFormDialog
        open={edit !== null}
        initial={edit}
        onClose={() => setEdit(null)}
        onSavedComplete={() => void load()}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Supplier renderers                                                 */
/*                                                                     */
/*  These own the supplier's own fields, wording and permissions. The   */
/*  shared `RecordsView` only provides the grid/rows, the interaction   */
/*  contract and the states — it never learns what `balance` means.     */
/* ------------------------------------------------------------------ */

interface SupplierIndicator {
  barClass: string;
  label: string;
  toneClass: string;
}

interface SupplierRendererProps {
  supplier: Supplier;
  isRtl: boolean;
  meta: SupplierIndicator;
  moneyOf: (value: number) => string;
  onEdit: (supplier: Supplier) => void;
  onDelete: (id: string) => void;
  deleting: boolean;
  whatsAppMessage: string;
  editLabel: string;
  deleteLabel: string;
}

/**
 * Row actions shared by the card and the list row.
 *
 * They live in their own component so both presentations drive the *same*
 * handlers: a delete offered in one mode can never behave differently from the
 * other, and every control stops the click so it does not also open the record.
 */
function SupplierRowActions({
  supplier,
  onEdit,
  onDelete,
  deleting,
  whatsAppMessage,
  editLabel,
  deleteLabel,
}: Pick<
  SupplierRendererProps,
  "supplier" | "onEdit" | "onDelete" | "deleting" | "whatsAppMessage" | "editLabel" | "deleteLabel"
>) {
  return (
    <div className="flex shrink-0 items-center gap-1" onClick={(event) => event.stopPropagation()}>
      <span className="shrink-0">
        <WhatsAppButton phone={supplier.phone} message={whatsAppMessage} />
      </span>
      <IconButton
        size="sm"
        variant="outline"
        tooltip
        ariaLabel={editLabel}
        icon={<Pencil className="size-3.5" />}
        round
        onClick={() => onEdit(supplier)}
      />
      <IconButton
        size="sm"
        variant="danger"
        tooltip
        ariaLabel={deleteLabel}
        icon={<Trash2 className="size-3.5" />}
        round
        loading={deleting}
        onClick={() => onDelete(supplier.id)}
      />
    </div>
  );
}

/** Balance phrasing + colour, shared by both presentations. */
function balanceTone(balance: number): string {
  if (balance > 0) return "text-amber-400";
  if (balance < 0) return "text-emerald-400";
  return "text-muted-foreground";
}

function balanceLabel(balance: number, isRtl: boolean, suffix = false): string {
  const colon = suffix ? ":" : "";
  if (balance > 0) return (isRtl ? "مستحق له" : "Payable") + colon;
  if (balance < 0) return (isRtl ? "دفعة مقدمة" : "Advance") + colon;
  return (isRtl ? "الرصيد" : "Balance") + colon;
}

function SupplierCard({
  supplier: r,
  isRtl,
  meta,
  moneyOf,
  onEdit,
  onDelete,
  deleting,
  whatsAppMessage,
  editLabel,
  deleteLabel,
}: SupplierRendererProps) {
  const bal = Number(r.balance);

  return (
    <div className="card-mullak group relative flex h-full flex-col justify-between rounded-2xl p-3 transition-all duration-200 hover:shadow-md sm:p-4.5">
      <div className="flex items-start gap-2.5">
        <span
          aria-hidden
          className={`h-12 w-1.5 shrink-0 rounded-full transition-all duration-300 ${meta.barClass}`}
        />
        <div className="grid size-11 shrink-0 place-items-center rounded-2xl border border-primary/20 bg-primary/10 text-sm font-bold text-primary transition-transform group-hover:scale-105">
          {(r.name ?? "?").slice(0, 1)}
        </div>
        <div className="min-w-0 flex-1">
          <h4 className="truncate text-xs font-bold text-foreground transition-colors group-hover:text-primary sm:text-sm">
            {r.name || "—"}
          </h4>
          <span
            className={`mt-1 inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[9px] font-bold ${meta.toneClass}`}
          >
            <span className={`size-1.5 rounded-full ${meta.barClass}`} />
            {meta.label}
          </span>
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1 text-[10px] text-muted-foreground">
        {r.phone && (
          <span
            className="inline-flex max-w-[130px] items-center gap-1 truncate rounded-md border border-border/50 bg-surface-2/70 px-1.5 py-0.5"
            dir="ltr"
          >
            <span className="truncate font-mono">{toSystemDigits(r.phone)}</span>
          </span>
        )}
        {r.email && (
          <span className="inline-flex max-w-[130px] items-center gap-1 truncate rounded-md border border-border/50 bg-surface-2/70 px-1.5 py-0.5">
            <span className="truncate">{r.email}</span>
          </span>
        )}
      </div>

      <div className="mt-2.5 flex items-center justify-between gap-1.5 border-t border-border/60 pt-2">
        <div className="min-w-0">
          <p className="text-[9px] font-medium text-muted-foreground sm:text-[10px]">
            {balanceLabel(bal, isRtl)}
          </p>
          <p
            className={`truncate font-mono text-sm font-bold tracking-tight sm:text-base ${balanceTone(bal)}`}
          >
            <Ltr>{moneyOf(bal)}</Ltr>
          </p>
        </div>

        <SupplierRowActions
          supplier={r}
          onEdit={onEdit}
          onDelete={onDelete}
          deleting={deleting}
          whatsAppMessage={whatsAppMessage}
          editLabel={editLabel}
          deleteLabel={deleteLabel}
        />
      </div>
    </div>
  );
}

function SupplierListRow({
  supplier: r,
  isRtl,
  meta,
  moneyOf,
  onEdit,
  onDelete,
  deleting,
  whatsAppMessage,
  editLabel,
  deleteLabel,
}: SupplierRendererProps) {
  const bal = Number(r.balance);

  return (
    <div className="card-mullak group relative flex cursor-pointer flex-col justify-between gap-3 rounded-2xl border p-3.5 transition-all duration-200 hover:border-primary/50 hover:shadow-md sm:flex-row sm:items-center sm:p-4">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <span aria-hidden className={`h-11 w-1.5 shrink-0 rounded-full sm:h-12 ${meta.barClass}`} />
        <div className="grid size-11 shrink-0 place-items-center rounded-xl border border-primary/20 bg-primary/10 text-primary transition-all group-hover:scale-105 group-hover:bg-primary group-hover:text-primary-foreground">
          <Building2 className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="truncate text-sm font-bold text-foreground transition-colors group-hover:text-primary sm:text-base">
              {r.name || "—"}
            </h4>
            <span
              className={`shrink-0 rounded-full border px-2 py-0.5 text-[9px] font-bold ${meta.toneClass}`}
            >
              {meta.label}
            </span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
            {r.phone && (
              <span className="flex items-center gap-1 truncate font-mono" dir="ltr">
                <span className="truncate">{toSystemDigits(r.phone)}</span>
              </span>
            )}
            {r.email && (
              <span className="flex max-w-[180px] items-center gap-1 truncate">
                <span className="truncate">{r.email}</span>
              </span>
            )}
            {r.address && (
              <span className="flex max-w-[180px] items-center gap-1 truncate">
                <span className="truncate">{r.address}</span>
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between gap-4 border-t border-border/60 pt-2 sm:justify-end sm:border-t-0 sm:pt-0">
        <div className="min-w-0 text-start sm:min-w-[120px] sm:text-end">
          <div className="text-[10px] text-muted-foreground">{balanceLabel(bal, isRtl, true)}</div>
          <div className={`truncate font-mono text-sm font-bold sm:text-base ${balanceTone(bal)}`}>
            <Ltr>{moneyOf(bal)}</Ltr>
          </div>
        </div>

        <SupplierRowActions
          supplier={r}
          onEdit={onEdit}
          onDelete={onDelete}
          deleting={deleting}
          whatsAppMessage={whatsAppMessage}
          editLabel={editLabel}
          deleteLabel={deleteLabel}
        />
      </div>
    </div>
  );
}

import { PrimaryAction } from "@/components/ui/primary-action";
import { ModuleGuard } from "@/lib/modules";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
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
  Lock,
  Receipt,
  X,
  Phone,
  Mail,
  MapPin,
  ShoppingCart,
  FileText,
  CheckCircle2,
  Clock,
  Loader2,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { useI18n } from "@/lib/i18n";
import { money } from "@/lib/format";
import { toSystemDigits } from "@/lib/format-preferences";
import { Ltr } from "@/components/ltr-value";
import { WhatsAppButton } from "@/components/whatsapp-button";
import { WhatsAppIcon } from "@/components/whatsapp-icon";
import { supplierMessage } from "@/lib/whatsapp-templates";
import { buildWhatsAppLink } from "@/lib/whatsapp";
import {
  SupplierFormDialog,
  isSystemCashSupplierName,
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
import { RecordsViewToggle } from "@/components/ui/records-view-toggle";
import { usePersistedViewMode } from "@/hooks/use-persisted-view-mode";
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
  const [viewMode, setViewMode] = usePersistedViewMode("suppliers", "cards");
  const [edit, setEdit] = useState<Partial<Supplier> | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [selected, setSelected] = useState<Supplier | null>(null);
  const [activity, setActivity] = useState<
    { label: string; date: string; amount: number; kind: "purchase" | "payment" }[]
  >([]);
  const [detailTab, setDetailTab] = useState<"all" | "purchases" | "payments">("all");
  const [loadingActivity, setLoadingActivity] = useState(false);
  const navigate = useNavigate();

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
      /*
       * «مورد نقدي» شريك نظامي حقيقي (Essential Reference) تزرعه
       * seeds/01_system/09_essential_partners.sql — يظهر هنا كأي مورد لأن
       * النظام واحد: المشتريات الفورية المدفوعة حالاً تُسجَّل عليه فعلاً.
       * (ب1 في 05_خطة_التكامل_الشامل.md)
       */
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
      // P1-6: المورد النقدي كيان نظامي — لا يظهر في دليل الموردين.
      if ((r as { is_system?: boolean }).is_system) return false;
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
  const { totalPayable, totalAdvance, activeCount, payableCount, advanceCount } = useMemo(() => {
    let payable = 0;
    let advance = 0;
    let active = 0;
    let owed = 0;
    let adv = 0;
    for (const r of rows) {
      const bal = Number(r.balance);
      if (bal > 0) {
        payable += bal;
        owed++;
      } else if (bal < 0) {
        advance += Math.abs(bal);
        adv++;
      }
      if (r.is_active) active++;
    }
    return {
      totalPayable: payable,
      totalAdvance: advance,
      activeCount: active,
      payableCount: owed,
      advanceCount: adv,
    };
  }, [rows]);

  /*
   * Open the supplier detail drawer (like customers page).
   */
  const openSupplier = useCallback(
    async (supplier: Supplier) => {
      setSelected(supplier);
      setActivity([]);
      setDetailTab("all");
      setLoadingActivity(true);
      try {
        const [purchases, payments] = await Promise.all([
          supabase
            .from("purchases")
            .select("invoice_number,created_at,total")
            .eq("supplier_id", supplier.id)
            .order("created_at", { ascending: false })
            .limit(30),
          supabase
            .from("supplier_payments")
            .select("payment_date,amount,payment_method")
            .eq("supplier_id", supplier.id)
            .order("payment_date", { ascending: false })
            .limit(30),
        ]);

        setActivity(
          [
            ...(purchases.data ?? []).map((p) => ({
              label: `${isRtl ? "فاتورة شراء" : "Purchase Invoice"} ${p.invoice_number ?? ""}`,
              date: p.created_at,
              amount: Number(p.total),
              kind: "purchase" as const,
            })),
            ...(payments.data ?? []).map((p: any) => ({
              label: isRtl ? "سند صرف دفعة" : "Payment Voucher",
              date: p.payment_date,
              amount: Number(p.amount),
              kind: "payment" as const,
            })),
          ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()),
        );
      } catch (err) {
        console.error("Failed to load supplier activity", err);
      } finally {
        setLoadingActivity(false);
      }
    },
    [isRtl],
  );

  const detailStats = useMemo(() => {
    if (!selected) return null;
    const purchaseItems = activity.filter((a) => a.kind === "purchase");
    const paymentItems = activity.filter((a) => a.kind === "payment");
    const totalPurchases = purchaseItems.reduce((s, a) => s + a.amount, 0);
    const totalPayments = paymentItems.reduce((s, a) => s + a.amount, 0);
    const lastActivity = activity.length > 0 ? activity[0].date : null;
    return {
      purchaseItems,
      paymentItems,
      totalPurchases,
      totalPayments,
      purchaseCount: purchaseItems.length,
      paymentCount: paymentItems.length,
      lastActivity,
    };
  }, [selected, activity]);

  /*
   * Open the form for editing.
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
      const target = rows.find((s) => s.id === id);
      if (target && isSystemCashSupplierName(target.name)) {
        toast.error(
          lang === "ar"
            ? "لا يمكن حذف «المورد النقدي» — هذا حساب نظامي رسمي معتمد للمشتريات النقدية."
            : "Cannot delete Cash Supplier — this is an official system entity.",
        );
        return;
      }
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
    [deleting, t, qc, rows, lang],
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
            {isSystemCashSupplierName(r.name) ? (
              <span
                title={
                  isRtl
                    ? "مورد نظامي رسمي (نقدي) — محمي من التعديل والحذف"
                    : "Official system supplier (Cash) — protected"
                }
                className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-[10px] font-bold text-amber-700 dark:text-amber-300"
              >
                <Lock className="size-3" />
                {isRtl ? "مورد رسمي" : "Official"}
              </span>
            ) : (
              <>
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
              </>
            )}
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
        viewToggle={<RecordsViewToggle value={viewMode} onChange={setViewMode} />}
        action={
          <PrimaryAction
            label={t("suppliers.new")}
            icon={<Plus />}

            onClick={() => setEdit({})}
          />
        }
      >
        <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 scrollbar-x-none">
          {[
            {
              id: "all",
              label: isRtl ? "الكل" : "All",
              count: rows.length,
              activeClass:
                "border-primary bg-primary text-primary-foreground shadow-xs shadow-primary/20",
              inactiveClass:
                "border-border/70 bg-surface/70 text-muted-foreground hover:bg-surface-2 hover:text-foreground",
              activeBadge: "bg-white/20 text-white",
              inactiveBadge: "bg-muted text-muted-foreground",
            },
            {
              id: "payable",
              label: isRtl ? "مستحق لهم" : "Payable",
              count: payableCount,
              activeClass: "border-amber-500 bg-amber-500 text-white shadow-xs shadow-amber-500/25",
              inactiveClass:
                "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400 hover:bg-amber-500/20 hover:border-amber-500/60",
              activeBadge: "bg-white/25 text-white",
              inactiveBadge: "bg-amber-500/20 text-amber-700 dark:text-amber-300",
            },
            {
              id: "advance",
              label: isRtl ? "دفعات مقدمة" : "Advance",
              count: advanceCount,
              activeClass:
                "border-emerald-600 bg-emerald-600 text-white shadow-xs shadow-emerald-500/25",
              inactiveClass:
                "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20 hover:border-emerald-500/60",
              activeBadge: "bg-white/25 text-white",
              inactiveBadge: "bg-emerald-500/20 text-emerald-700 dark:text-emerald-300",
            },
            {
              id: "active",
              label: isRtl ? "النشطين" : "Active",
              count: activeCount,
              activeClass: "border-sky-500 bg-sky-500 text-white shadow-xs shadow-sky-500/25",
              inactiveClass:
                "border-sky-500/40 bg-sky-500/10 text-sky-600 dark:text-sky-400 hover:bg-sky-500/20 hover:border-sky-500/60",
              activeBadge: "bg-white/25 text-white",
              inactiveBadge: "bg-sky-500/20 text-sky-700 dark:text-sky-300",
            },
          ].map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilterType(f.id as FilterType)}
              className={`flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-bold transition cursor-pointer ${
                filterType === f.id ? f.activeClass : f.inactiveClass
              }`}
            >
              <span>{f.label}</span>
              {f.count !== undefined && (
                <span
                  className={`rounded-full px-1.5 py-0.2 text-[10px] font-mono ${
                    filterType === f.id ? f.activeBadge : f.inactiveBadge
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
        onRowClick={openSupplier}
        renderCard={(r) => (
          <SupplierCard
            supplier={r}
            isRtl={isRtl}
            meta={getRecordIndicator(r)}
            moneyOf={money}
            onEdit={openEdit}
            onDelete={removeRow}
            onSelect={openSupplier}
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
            onSelect={openSupplier}
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
              className="mt-2 inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-xs font-bold text-primary-foreground shadow-sm transition hover:bg-primary/90 active:scale-95 cursor-pointer"
            >
              <Plus className="size-4" />
              <span>{isRtl ? "إضافة مورد جديد الآن" : "Add New Supplier Now"}</span>
            </button>
          ),
        }}
      />

      {/* ─── Supplier Detail Sheet (Drawer) ─── */}
      {selected && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-end bg-black/65 backdrop-blur-xs animate-in fade-in duration-200"
          onClick={() => setSelected(null)}
        >
          <div
            className="h-full w-full max-w-lg border-s border-border/80 bg-background/95 backdrop-blur-md p-6 shadow-2xl overflow-y-auto animate-in slide-in-from-left duration-200 relative"
            onClick={(e) => e.stopPropagation()}
            dir={isRtl ? "rtl" : "ltr"}
          >
            {/* Ambient decorative blur */}
            <div className="absolute -top-10 -right-10 size-40 rounded-full bg-primary/20 blur-3xl pointer-events-none" />

            {/* Header with Close */}
            <div className="flex items-start justify-between pb-4 border-b border-border/60">
              <div className="flex items-center gap-3.5">
                <div className="grid size-14 place-items-center rounded-2xl bg-primary/10 text-primary font-bold text-xl border border-primary/20 shadow-sm">
                  <Building2 className="size-6" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-foreground">{selected.name}</h3>
                  <div className="mt-0.5 flex items-center gap-2">
                    <span
                      className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold ${
                        selected.is_active
                          ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-400"
                          : "border-border bg-muted text-muted-foreground"
                      }`}
                    >
                      {selected.is_active ? t("common.active") : t("common.inactive")}
                    </span>
                    <span className="text-xs text-muted-foreground font-mono">
                      {balanceLabel(Number(selected.balance), isRtl)}
                    </span>
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelected(null)}
                className="grid size-9 place-items-center rounded-full bg-surface-2 text-muted-foreground hover:text-foreground transition cursor-pointer"
              >
                <X className="size-4" />
              </button>
            </div>

            {/* Financial Overview Cards */}
            <div className="mt-5 grid grid-cols-2 gap-3">
              <MiniStat
                label={isRtl ? "الرصيد الدفتري" : "Ledger Balance"}
                value={money(Number(selected.balance))}
                color={
                  Number(selected.balance) > 0
                    ? "text-amber-400"
                    : Number(selected.balance) < 0
                      ? "text-emerald-400"
                      : undefined
                }
              />
              <MiniStat
                label={isRtl ? "حالة الرصيد" : "Balance Status"}
                value={balanceLabel(Number(selected.balance), isRtl)}
                color={
                  Number(selected.balance) > 0
                    ? "text-amber-400"
                    : Number(selected.balance) < 0
                      ? "text-emerald-400"
                      : "text-muted-foreground"
                }
              />
              {detailStats && (
                <>
                  <MiniStat
                    label={isRtl ? "إجمالي المشتريات" : "Total Purchases"}
                    value={money(detailStats.totalPurchases)}
                  />
                  <MiniStat
                    label={isRtl ? "إجمالي المدفوعات" : "Total Payments"}
                    value={money(detailStats.totalPayments)}
                    color="text-emerald-400"
                  />
                </>
              )}
            </div>

            {/* Quick Actions Strip */}
            <div className="mt-5 flex items-center gap-2 flex-wrap">
              {selected.phone && (
                <a
                  href={buildWhatsAppLink(selected.phone, whatsAppFor(selected)) ?? "#"}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 px-3.5 py-1.5 text-xs font-bold text-emerald-400 hover:bg-emerald-500/25 transition active:scale-95 cursor-pointer"
                >
                  <WhatsAppIcon className="size-3.5" />
                  <span>{isRtl ? "مراسلة واتساب" : "WhatsApp"}</span>
                </a>
              )}
              {selected.phone && (
                <a
                  href={`tel:${selected.phone}`}
                  className="flex items-center gap-1.5 rounded-full bg-sky-500/15 border border-sky-500/30 px-3.5 py-1.5 text-xs font-bold text-sky-400 hover:bg-sky-500/25 transition active:scale-95 cursor-pointer"
                >
                  <Phone className="size-3.5" />
                  <span>{isRtl ? "اتصال هاتفي" : "Call"}</span>
                </a>
              )}
              <DetailActionBtn
                icon={<Receipt className="size-3.5" />}
                label={isRtl ? "دفتر الأستاذ وسندات الصرف" : "Ledger & Vouchers"}
                onClick={() => {
                  void navigate({
                    to: "/supplier-ledger" as never,
                    search: { supplierId: selected.id } as never,
                  });
                }}
              />
              <DetailActionBtn
                icon={<FileText className="size-3.5" />}
                label={isRtl ? "كشف حساب المورد" : "Statement"}
                onClick={() => {
                  void navigate({
                    to: "/statements/$entityType" as never,
                    params: { entityType: "supplier" },
                    search: { entityId: selected.id } as never,
                  });
                }}
              />
              <DetailActionBtn
                icon={<ShoppingCart className="size-3.5" />}
                label={isRtl ? "فاتورة شراء جديدة" : "New Purchase"}
                onClick={() => {
                  void navigate({
                    to: "/purchase-pos" as never,
                    search: { supplierId: selected.id } as never,
                  });
                }}
              />
              {!isSystemCashSupplierName(selected.name) && (
                <>
                  <DetailActionBtn
                    icon={<Pencil className="size-3.5" />}
                    label={t("common.edit")}
                    onClick={() => {
                      setEdit(selected);
                      setSelected(null);
                    }}
                  />
                  <DetailActionBtn
                    icon={<Trash2 className="size-3.5" />}
                    label={t("common.delete")}
                    onClick={() => {
                      const id = selected.id;
                      setSelected(null);
                      void removeRow(id);
                    }}
                  />
                </>
              )}
            </div>

            {/* Contact & Profile Information Card */}
            <div className="mt-6 rounded-2xl border border-border/70 bg-surface/50 p-4 space-y-3">
              <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                {isRtl ? "معلومات التواصل والبيانات" : "Contact & Profile Information"}
              </h4>
              <div className="space-y-2 text-xs">
                {selected.phone ? (
                  <div className="flex items-center justify-between py-1 border-b border-border/40">
                    <span className="text-muted-foreground flex items-center gap-1.5">
                      <Phone className="size-3.5" />
                      {isRtl ? "رقم الهاتف" : "Phone"}
                    </span>
                    <span className="font-mono font-bold" dir="ltr">
                      {selected.phone}
                    </span>
                  </div>
                ) : null}
                {selected.email ? (
                  <div className="flex items-center justify-between py-1 border-b border-border/40">
                    <span className="text-muted-foreground flex items-center gap-1.5">
                      <Mail className="size-3.5" />
                      {isRtl ? "البريد الإلكتروني" : "Email"}
                    </span>
                    <span className="font-mono truncate max-w-[200px]" dir="ltr">
                      {selected.email}
                    </span>
                  </div>
                ) : null}
                {selected.address ? (
                  <div className="flex items-center justify-between py-1 border-b border-border/40">
                    <span className="text-muted-foreground flex items-center gap-1.5">
                      <MapPin className="size-3.5" />
                      {isRtl ? "العنوان" : "Address"}
                    </span>
                    <span className="truncate max-w-[200px]">{selected.address}</span>
                  </div>
                ) : null}
                <div className="flex items-center justify-between py-1">
                  <span className="text-muted-foreground flex items-center gap-1.5">
                    <Clock className="size-3.5" />
                    {isRtl ? "تاريخ التسجيل" : "Registered"}
                  </span>
                  <span className="font-mono text-muted-foreground">
                    {new Date(selected.created_at).toLocaleDateString()}
                  </span>
                </div>
              </div>
            </div>

            {/* Activity Timeline */}
            <div className="mt-6 space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  {isRtl ? "سجل المعاملات الأخيرة" : "Recent Activity"}
                </h4>
                {/* Tabs */}
                <div className="flex items-center gap-1 rounded-full border border-border/70 bg-surface/70 p-0.5 text-[11px]">
                  <button
                    type="button"
                    onClick={() => setDetailTab("all")}
                    className={`rounded-full px-2.5 py-0.5 font-bold transition cursor-pointer ${
                      detailTab === "all"
                        ? "bg-primary text-primary-foreground shadow-xs"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {isRtl ? "الكل" : "All"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setDetailTab("purchases")}
                    className={`rounded-full px-2.5 py-0.5 font-bold transition cursor-pointer ${
                      detailTab === "purchases"
                        ? "bg-primary text-primary-foreground shadow-xs"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {isRtl ? "المشتريات" : "Purchases"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setDetailTab("payments")}
                    className={`rounded-full px-2.5 py-0.5 font-bold transition cursor-pointer ${
                      detailTab === "payments"
                        ? "bg-primary text-primary-foreground shadow-xs"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {isRtl ? "المدفوعات" : "Payments"}
                  </button>
                </div>
              </div>

              {loadingActivity ? (
                <div className="rounded-2xl border border-border/60 bg-surface/40 p-8 text-center">
                  <Loader2 className="mx-auto size-6 animate-spin text-primary" />
                  <p className="mt-2 text-xs text-muted-foreground">
                    {isRtl ? "جارِ تحميل سجل المعاملات..." : "Loading activity..."}
                  </p>
                </div>
              ) : activity.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-border/70 p-6 text-center text-xs text-muted-foreground">
                  {isRtl
                    ? "لا توجد معاملات مسجلة لهذا المورد بعد."
                    : "No recorded transactions yet."}
                </div>
              ) : (
                <div className="space-y-2">
                  {activity
                    .filter((a) => {
                      if (detailTab === "purchases") return a.kind === "purchase";
                      if (detailTab === "payments") return a.kind === "payment";
                      return true;
                    })
                    .map((a, i) => (
                      <div
                        key={i}
                        className="flex items-center justify-between rounded-xl border border-border/60 bg-surface/60 p-3 text-xs"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <span
                            className={`grid size-7 shrink-0 place-items-center rounded-lg ${
                              a.kind === "purchase"
                                ? "bg-amber-500/10 text-amber-500"
                                : "bg-emerald-500/10 text-emerald-500"
                            }`}
                          >
                            {a.kind === "purchase" ? (
                              <ShoppingCart className="size-3.5" />
                            ) : (
                              <Wallet className="size-3.5" />
                            )}
                          </span>
                          <div className="min-w-0">
                            <p className="font-bold text-foreground truncate">{a.label}</p>
                            <p className="font-mono text-[10px] text-muted-foreground">
                              {new Date(a.date).toLocaleDateString()}
                            </p>
                          </div>
                        </div>
                        <span
                          className={`font-mono font-bold text-xs ${
                            a.kind === "purchase" ? "text-amber-500" : "text-emerald-500"
                          }`}
                        >
                          <Ltr>{money(a.amount)}</Ltr>
                        </span>
                      </div>
                    ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

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
  onSelect: (supplier: Supplier) => void;
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
  const navigate = useNavigate();
  const { lang } = useI18n();
  const isAr = lang === "ar";

  return (
    <div className="flex shrink-0 items-center gap-1" onClick={(event) => event.stopPropagation()}>
      <IconButton
        size="sm"
        variant="outline"
        tooltip
        ariaLabel={isAr ? "دفتر أستاذ المورد وسندات الصرف" : "Supplier Ledger & Vouchers"}
        icon={<Receipt className="size-3.5 text-primary" />}
        round
        onClick={() => {
          void (navigate as any)({
            to: "/_app/supplier-ledger",
            search: { supplierId: supplier.id },
          });
        }}
      />
      <span className="shrink-0">
        <WhatsAppButton phone={supplier.phone} message={whatsAppMessage} />
      </span>
      {isSystemCashSupplierName(supplier.name) ? (
        <span
          title="مورد نظامي رسمي (نقدي) — محمي من التعديل والحذف"
          className="grid size-8 place-items-center rounded-full border border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400"
        >
          <Lock className="size-3.5" />
        </span>
      ) : (
        <>
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
        </>
      )}
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
  onSelect,
  deleting,
  whatsAppMessage,
  editLabel,
  deleteLabel,
}: SupplierRendererProps) {
  const bal = Number(r.balance);

  return (
    <div
      onClick={() => onSelect(r)}
      className={`card-mullak group relative overflow-hidden rounded-2xl p-3 sm:p-4.5 flex flex-col justify-between cursor-pointer border transition-all duration-200 hover:shadow-md ${
        !r.is_active
          ? "border-r-4 border-r-muted-foreground/40 hover:border-border"
          : bal > 0
            ? "border-r-4 border-r-amber-500 hover:border-amber-500/60 shadow-amber-500/5"
            : bal < 0
              ? "border-r-4 border-r-emerald-500 hover:border-emerald-500/60 shadow-emerald-500/5"
              : "border-r-4 border-r-primary/50 hover:border-primary"
      }`}
    >
      <div>
        <div className="flex items-start justify-between gap-2 mb-2.5">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="grid size-11 shrink-0 place-items-center rounded-2xl bg-primary/10 text-primary font-bold text-sm border border-primary/20 shadow-xs group-hover:scale-105 transition-transform">
              {(r.name ?? "?").slice(0, 1)}
            </div>
            <div className="min-w-0">
              <h4 className="truncate text-sm font-bold text-foreground group-hover:text-primary transition-colors">
                {r.name || "—"}
              </h4>
              <span
                className={`mt-0.5 inline-flex rounded-full px-2 py-0.5 text-[9px] font-bold border shrink-0 ${meta.toneClass}`}
              >
                {meta.label}
              </span>
            </div>
          </div>
          <span
            className={`size-2 rounded-full mt-1.5 shrink-0 ${
              r.is_active ? "bg-emerald-500 ring-2 ring-emerald-500/20" : "bg-muted-foreground/40"
            }`}
            title={r.is_active ? (isRtl ? "نشط" : "Active") : isRtl ? "غير نشط" : "Inactive"}
          />
        </div>

        {/* Contact info badges */}
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          {r.phone && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                if (r.phone) {
                  navigator.clipboard.writeText(r.phone);
                  toast.success(isRtl ? "تم نسخ رقم الهاتف" : "Phone copied");
                }
              }}
              className="inline-flex items-center gap-1 rounded-md bg-surface-2/70 px-1.5 py-0.5 border border-border/50 text-[10px] font-mono hover:text-primary hover:border-primary/40 transition cursor-pointer"
              title={isRtl ? "اضغط لنسخ رقم الهاتف" : "Click to copy phone"}
              dir="ltr"
            >
              <Phone className="size-2.5 sm:size-3 text-muted-foreground shrink-0" />
              <span className="truncate">{toSystemDigits(r.phone)}</span>
            </button>
          )}
          {r.email && (
            <span
              className="inline-flex items-center gap-1 rounded-md bg-surface-2/70 px-1.5 py-0.5 border border-border/50 text-[10px] truncate max-w-[140px]"
              dir="ltr"
            >
              <Mail className="size-2.5 sm:size-3 text-muted-foreground shrink-0" />
              <span className="truncate">{r.email}</span>
            </span>
          )}
          {r.address && (
            <span className="inline-flex items-center gap-1 rounded-md bg-surface-2/60 px-1.5 py-0.5 border border-border/50 text-[10px] truncate max-w-[120px]">
              <MapPin className="size-2.5 sm:size-3 text-muted-foreground shrink-0" />
              <span className="truncate">{r.address}</span>
            </span>
          )}
        </div>
      </div>

      <div className="mt-4 pt-3 border-t border-border/50 flex items-center justify-between">
        <div>
          <span className="block text-[10px] text-muted-foreground">
            {balanceLabel(bal, isRtl)}
          </span>
          <span
            className={`font-mono text-sm sm:text-base font-bold tracking-tight ${balanceTone(bal)}`}
          >
            <Ltr>{moneyOf(bal)}</Ltr>
          </span>
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
  onSelect,
  deleting,
  whatsAppMessage,
  editLabel,
  deleteLabel,
}: SupplierRendererProps) {
  const bal = Number(r.balance);

  return (
    <div
      onClick={() => onSelect(r)}
      className="card-mullak group relative flex cursor-pointer flex-col justify-between gap-3 rounded-2xl border p-3.5 transition-all duration-200 hover:border-primary/50 hover:shadow-md sm:flex-row sm:items-center sm:p-4"
    >
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

/* ─── Drawer Helper Sub-components ─── */

function MiniStat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="rounded-2xl border border-border/60 bg-surface/60 p-3 text-center">
      <div className="text-[10px] font-medium text-muted-foreground">{label}</div>
      <div className={`font-mono text-sm font-bold mt-1 ${color ?? "text-foreground"}`}>
        <Ltr>{value}</Ltr>
      </div>
    </div>
  );
}

function DetailActionBtn({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-1.5 rounded-full border border-border/80 bg-surface px-3.5 py-1.5 text-xs font-bold text-muted-foreground hover:bg-surface-2 hover:text-foreground transition active:scale-95 cursor-pointer"
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

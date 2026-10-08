import { ModuleGuard, useModules } from "@/lib/modules";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState, useCallback } from "react";
import {
  ShoppingCart,
  Plus,
  Eye,
  X,
  Loader2,
  Trash2,
  LayoutGrid,
  List,
  TableProperties,
  Wallet,
  PackageCheck,
  TrendingDown,
  Clock,
  CheckCircle2,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { useI18n } from "@/lib/i18n";
import { money } from "@/lib/format";
import { toSystemDigits } from "@/lib/format-preferences";
import { Ltr } from "@/components/ltr-value";
import { printUnifiedDocument } from "@/lib/printing";
import { VortexMetricCard, VortexDateBadge } from "@/components/vortex-ui";
import {
  TableToolbar,
  ToolbarAction,
  type FilterDefinition,
  type FilterValues,
  type SortOption,
} from "@/components/ui/table-toolbar";
import { DataTable, type DataTableColumn, type DataTableSort } from "@/components/ui/data-table";
import { IconButton } from "@/components/ui/icon-button";
import { useBreakpoint } from "@/design/breakpoints";
import { toast } from "sonner";
import { PaymentMethodPicker } from "@/components/ui/payment-method";
import {
  getPaymentMethodDefinition,
  paymentMethodLabel,
} from "@/lib/payments/payment-methods";

export const Route = createFileRoute("/_app/purchases")({
  head: () => ({ meta: [{ title: "Purchases — Vortex ERP" }] }),
  component: () => (
    <ModuleGuard moduleId="purchases">
      <PurchasesPage />
    </ModuleGuard>
  ),
});

interface Invoice {
  id: string;
  invoice_number: string;
  status: string;
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  paid: number;
  payment_method: string;
  created_at: string;
  suppliers: { name: string } | null;
  warehouses: { name: string; name_ar: string | null } | null;
}

type ViewMode = "cards" | "list" | "table";
type StatusTab = "all" | "paid" | "partial" | "unpaid" | "cancelled";
interface Line {
  id: string;
  quantity: number;
  unit_cost: number;
  tax: number;
  total: number;
  products: { name: string; sku: string | null } | null;
}
interface Product {
  id: string;
  name: string;
  name_ar: string | null;
  sku: string | null;
  barcode: string | null;
  cost_price: number;
  tax_rate: number;
  unit?: { short_name?: string | null; name?: string | null; name_ar?: string | null } | null;
  category?: { name?: string | null; name_ar?: string | null } | null;
  inventory?: { warehouse_id: string; quantity: number }[] | null;
}
interface Supplier {
  id: string;
  name: string;
}
interface Warehouse {
  id: string;
  name: string;
  name_ar: string | null;
}
interface CartLine {
  product_id: string;
  name: string;
  unit_cost: number;
  tax_rate: number;
  quantity: number;
}

function PurchasesPage() {
  const { isModuleEnabled } = useModules();
  const hasMultiWarehouse = isModuleEnabled("multi_warehouse");
  const { t, lang } = useI18n();
  const isRtl = lang === "ar";
  const whName = (w?: { name: string; name_ar: string | null } | null) =>
    !w ? "—" : lang === "ar" ? w.name_ar || w.name : w.name || w.name_ar || "—";
  const [rows, setRows] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusTab, setStatusTab] = useState<StatusTab>("all");
  const [filters, setFilters] = useState<FilterValues>({});
  const [sortKey, setSortKey] = useState<string>("date_desc");
  const [viewMode, setViewMode] = useState<ViewMode>("cards");
  const [selected, setSelected] = useState<Invoice | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [creating, setCreating] = useState(false);

  /*
   * Column-header sorting for the classic table, kept separate from the
   * toolbar preset (`sortKey`). `filtered` decides precedence so a header
   * click always wins over a stale dropdown value.
   */
  const [sort, setSort] = useState<DataTableSort | null>(null);
  const breakpoint = useBreakpoint();
  const tableUsesHorizontalScroll =
    breakpoint === "xs" || breakpoint === "sm" || breakpoint === "md";

  const productLabel = (p?: Pick<Product, "name" | "name_ar"> | null) =>
    !p ? "—" : lang === "ar" ? p.name_ar || p.name : p.name || p.name_ar || "—";

  async function load() {
    setLoading(true);
    const { data } = await supabase
      .from("purchase_invoices")
      .select(
        "id,invoice_number,status,subtotal,discount,tax,total,paid,payment_method,created_at,suppliers(name),warehouses(name,name_ar)",
      )
      .order("created_at", { ascending: false })
      .limit(200);
    setRows((data ?? []) as any);
    setLoading(false);
  }
  useEffect(() => {
    void load();
  }, []);

  async function openInvoice(inv: Invoice) {
    setSelected(inv);
    const { data } = await supabase
      .from("purchase_invoice_items")
      .select("id,quantity,unit_cost,tax,total,products(name,sku)")
      .eq("invoice_id", inv.id);
    setLines((data ?? []) as any);
  }

  /*
   * Label helpers are declared before `filtered`/`columns` because both
   * `useMemo` dependency arrays reference them; a later declaration would put
   * them in the temporal dead zone during render. `pmLabel` is memoized so it
   * does not invalidate the filter memo on every render.
   */
  const pmLabel = useCallback(
    (m: string) => paymentMethodLabel(m, lang === "ar" ? "ar" : "en"),
    [lang],
  );
  const statusLabel = useCallback(
    (s: string) => {
      const map: Record<string, string> = {
        paid: t("sales.status.paid"),
        partial: t("sales.status.partial"),
        unpaid: t("sales.status.unpaid"),
        cancelled: t("sales.status.cancelled"),
      };
      return map[s] ?? s;
    },
    [t],
  );

  const purchaseFilterDefinitions: FilterDefinition[] = useMemo(
    () => [
      {
        key: "created_at",
        label: isRtl ? "تاريخ الفاتورة" : "Invoice Date",
        type: "date-range",
      },
      {
        key: "payment_method",
        label: isRtl ? "طريقة السداد" : "Payment Method",
        type: "select",
        options: [
          { value: "cash", label: t("pos.pm.cash") },
          { value: "card", label: t("pos.pm.card") },
          { value: "bank_transfer", label: t("pos.pm.bank") },
          { value: "credit", label: t("pos.pm.credit") },
        ],
      },
      {
        key: "status",
        label: t("common.status"),
        type: "select",
        options: [
          { value: "paid", label: t("sales.status.paid") },
          { value: "partial", label: t("sales.status.partial") },
          { value: "unpaid", label: t("sales.status.unpaid") },
          { value: "cancelled", label: t("sales.status.cancelled") },
        ],
      },
    ],
    [isRtl, t],
  );

  const purchaseSortOptions: SortOption[] = useMemo(
    () => [
      { value: "date_desc", label: isRtl ? "الأحدث تاريخاً" : "Newest Date" },
      { value: "date_asc", label: isRtl ? "الأقدم تاريخاً" : "Oldest Date" },
      { value: "total_desc", label: isRtl ? "الأعلى قيمة (الإجمالي)" : "Highest Total" },
      { value: "total_asc", label: isRtl ? "الأقل قيمة (الإجمالي)" : "Lowest Total" },
      { value: "remaining_desc", label: isRtl ? "الأعلى متبقي" : "Highest Due" },
      { value: "number_asc", label: isRtl ? "رقم الفاتورة" : "Invoice Number" },
    ],
    [isRtl],
  );

  const filtered = useMemo(() => {
    let list = rows.filter((r) => {
      // Status tab
      if (statusTab !== "all" && r.status !== statusTab) return false;

      // Search
      if (search.trim()) {
        const q = search.trim().toLowerCase();
        const matches =
          r.invoice_number.toLowerCase().includes(q) ||
          (r.suppliers?.name ?? "").toLowerCase().includes(q);
        if (!matches) return false;
      }

      // Toolbar filters
      if (filters.payment_method && r.payment_method !== filters.payment_method) return false;
      if (filters.status && r.status !== filters.status) return false;
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
      const aTotal = Number(a.total) || 0;
      const bTotal = Number(b.total) || 0;
      const aRem = Math.max(0, aTotal - (Number(a.paid) || 0));
      const bRem = Math.max(0, bTotal - (Number(b.paid) || 0));

      // A column-header click (classic table) takes precedence over the preset.
      if (sort) {
        const dir = sort.direction === "asc" ? 1 : -1;
        switch (sort.key) {
          case "invoice_number":
            return a.invoice_number.localeCompare(b.invoice_number) * dir;
          case "supplier":
            return (a.suppliers?.name ?? "").localeCompare(b.suppliers?.name ?? "", "ar") * dir;
          case "payment_method":
            return pmLabel(a.payment_method).localeCompare(pmLabel(b.payment_method), "ar") * dir;
          case "status":
            return a.status.localeCompare(b.status) * dir;
          case "created_at":
            return (new Date(a.created_at).getTime() - new Date(b.created_at).getTime()) * dir;
          case "total":
            return (aTotal - bTotal) * dir;
          case "paid":
            return ((Number(a.paid) || 0) - (Number(b.paid) || 0)) * dir;
          default:
            break;
        }
      }

      switch (sortKey) {
        case "date_desc":
          return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
        case "date_asc":
          return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
        case "total_desc":
          return bTotal - aTotal;
        case "total_asc":
          return aTotal - bTotal;
        case "remaining_desc":
          return bRem - aRem;
        case "number_asc":
          return a.invoice_number.localeCompare(b.invoice_number);
        default:
          return 0;
      }
    });

    return list;
  }, [rows, statusTab, search, filters, sortKey, sort, pmLabel]);

  // KPI metrics
  const metrics = useMemo(() => {
    let totalValue = 0;
    let totalPaid = 0;
    let paidCount = 0;
    let partialCount = 0;
    let unpaidCount = 0;
    let cancelledCount = 0;
    for (const r of rows) {
      if (r.status === "cancelled") {
        cancelledCount++;
        continue;
      }
      const total = Number(r.total) || 0;
      const paid = Number(r.paid) || 0;
      totalValue += total;
      totalPaid += paid;
      if (r.status === "paid") paidCount++;
      else if (r.status === "partial") partialCount++;
      else unpaidCount++;
    }
    const activeCount = paidCount + partialCount + unpaidCount;
    return {
      totalValue,
      totalPaid,
      totalPending: Math.max(0, totalValue - totalPaid),
      avgTicket: activeCount > 0 ? totalValue / activeCount : 0,
      paidCount,
      partialCount,
      unpaidCount,
      cancelledCount,
      totalCount: rows.length,
    };
  }, [rows]);

  const statusColor = (s: string) =>
    s === "paid"
      ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
      : s === "partial"
        ? "bg-amber-500/10 text-amber-400 border-amber-500/20"
        : s === "cancelled"
          ? "bg-red-500/10 text-red-400 border-red-500/20"
          : "bg-muted text-muted-foreground border-border";

  const statusBadge = (s: string) => (
    <span
      className={`inline-flex whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] font-bold ${statusColor(s)}`}
    >
      {statusLabel(s)}
    </span>
  );

  /*
   * Classic table columns.
   *
   * Same contract as the products/sales tables: each column is independently
   * sortable on its *displayed* value, values stay on one line and truncate,
   * and money is rendered through `<Ltr>` so a number never gets mangled by
   * bidi reordering inside an RTL layout.
   */
  const columns = useMemo<DataTableColumn<Invoice>[]>(() => {
    const cols: DataTableColumn<Invoice>[] = [
      {
        key: "invoice_number",
        header: t("purchases.po"),
        sortable: true,
        width: "w-[190px]",
        sortValue: (inv) => inv.invoice_number,
        cell: (inv) => (
          <div className="flex flex-col py-0.5">
            <span className="truncate font-mono text-xs font-bold text-foreground">
              {inv.invoice_number}
            </span>
            <VortexDateBadge date={inv.created_at} variant="subtle" size="sm" />
          </div>
        ),
      },
      {
        key: "supplier",
        header: t("common.supplier"),
        sortable: true,
        width: "w-[220px]",
        sortValue: (inv) => inv.suppliers?.name ?? "",
        cell: (inv) => {
          const name = inv.suppliers?.name ?? "—";
          return (
            <div className="flex items-center gap-2 py-0.5">
              <span className="grid size-7 shrink-0 place-items-center rounded-full bg-surface-2 text-[10px] font-bold text-muted-foreground">
                {name.slice(0, 1).toUpperCase()}
              </span>
              <span className="min-w-0 truncate text-xs font-medium text-foreground">{name}</span>
            </div>
          );
        },
      },
    ];

    if (hasMultiWarehouse) {
      cols.push({
        key: "warehouse",
        header: t("common.warehouse"),
        sortable: true,
        width: "w-[130px]",
        sortValue: (inv) => whName(inv.warehouses),
        cell: (inv) => (
          <span className="block truncate text-xs text-muted-foreground">
            {whName(inv.warehouses)}
          </span>
        ),
      });
    }

    cols.push(
      {
        key: "payment_method",
        header: t("sales.payment"),
        sortable: true,
        width: "w-[130px]",
        sortValue: (inv) => pmLabel(inv.payment_method),
        cell: (inv) => (
          <span className="inline-flex items-center whitespace-nowrap rounded-lg border border-border/80 bg-surface-2/60 px-2 py-0.5 text-[11px] text-muted-foreground">
            {pmLabel(inv.payment_method)}
          </span>
        ),
      },
      {
        key: "status",
        header: t("common.status"),
        sortable: true,
        width: "w-[110px]",
        sortValue: (inv) => inv.status,
        cell: (inv) => statusBadge(inv.status),
      },
      {
        key: "total",
        header: t("common.total"),
        align: "end",
        sortable: true,
        width: "w-[124px]",
        sortValue: (inv) => Number(inv.total) || 0,
        cell: (inv) => (
          <span className="font-mono text-xs font-bold tabular-nums text-foreground">
            <Ltr>{money(Number(inv.total) || 0)}</Ltr>
          </span>
        ),
      },
      {
        key: "paid",
        header: isRtl ? "المدفوع / المتبقي" : "Paid / Due",
        align: "end",
        sortable: true,
        width: "w-[140px]",
        sortValue: (inv) => Number(inv.paid) || 0,
        cell: (inv) => {
          const total = Number(inv.total) || 0;
          const paid = Number(inv.paid) || 0;
          const remaining = Math.max(0, total - paid);
          return (
            <div className="flex flex-col py-0.5">
              <span className="font-mono text-xs font-medium tabular-nums text-emerald-500">
                <Ltr>{money(paid)}</Ltr>
              </span>
              {remaining > 0 ? (
                <span className="font-mono text-[10px] font-semibold tabular-nums text-rose-500">
                  <Ltr>{money(remaining)}</Ltr>
                </span>
              ) : (
                <span className="text-[10px] text-muted-foreground">
                  {isRtl ? "خالص" : "Settled"}
                </span>
              )}
            </div>
          );
        },
      },
      {
        key: "actions",
        header: t("common.actions"),
        align: "end",
        width: "w-[110px]",
        cell: (inv) => (
          <div className="inline-flex items-center gap-1.5 pe-2">
            <IconButton
              size="sm"
              variant="outline"
              tooltip
              ariaLabel={isRtl ? "عرض التفاصيل" : "View details"}
              icon={<Eye />}
              round
              onClick={(event) => {
                event.stopPropagation();
                void openInvoice(inv);
              }}
            />
          </div>
        ),
      },
    );

    return cols;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRtl, hasMultiWarehouse, t]);

  return (
    <div className="space-y-5 pb-12">
      <PageHeader
        title={t("purchases.title")}
        subtitle={t("purchases.subtitle")}
        actions={
          <div className="flex items-center gap-2">
            <Link
              to="/purchase-pos"
              className="flex h-9 items-center gap-1.5 rounded-xl border border-primary/40 bg-primary/10 px-3 text-sm font-medium text-primary transition hover:bg-primary/20"
            >
              <ShoppingCart className="h-4 w-4" />{" "}
              {isRtl ? "نقطة المشتريات السريعة (POP)" : "Fast Purchase POS"}
            </Link>
            <button
              onClick={() => setCreating(true)}
              className="flex h-9 items-center gap-1.5 rounded-xl bg-primary px-3 text-sm font-bold text-primary-foreground shadow-xs shadow-primary/20 transition hover:opacity-90"
            >
              <Plus className="h-4 w-4" /> {t("purchases.new")}
            </button>
          </div>
        }
      />

      {/* ─── Luxury Vortex KPI Metrics Cards (2 columns on mobile, 4 on desktop) ─── */}
      <div className="grid grid-cols-2 gap-2.5 sm:gap-4 lg:grid-cols-4">
        <VortexMetricCard
          title={isRtl ? "إجمالي المشتريات" : "Total Purchases"}
          value={toSystemDigits(money(metrics.totalValue))}
          subtitle={`${toSystemDigits(metrics.totalCount.toString())} ${isRtl ? "فاتورة مسجلة" : "invoices"}`}
          icon={<ShoppingCart className="size-5" />}
          iconClassName="bg-primary/10 text-primary border border-primary/20"
          badge={isRtl ? "المشتريات" : "Purchases"}
          onClick={() => setStatusTab("all")}
          highlight={statusTab === "all"}
          className="cursor-pointer"
        />
        <VortexMetricCard
          title={isRtl ? "المبالغ المدفوعة" : "Paid to Vendors"}
          value={toSystemDigits(money(metrics.totalPaid))}
          subtitle={`${toSystemDigits(metrics.paidCount.toString())} ${isRtl ? "مسددة بالكامل" : "fully paid"}`}
          icon={<CheckCircle2 className="size-5" />}
          iconClassName="bg-blue-500/10 text-blue-500 border border-blue-500/20"
          badge={isRtl ? "مدفوع" : "Paid"}
          onClick={() => setStatusTab("paid")}
          highlight={statusTab === "paid"}
          className="cursor-pointer"
        />
        <VortexMetricCard
          title={isRtl ? "المتبقي والآجل" : "Outstanding & Due"}
          value={toSystemDigits(money(metrics.totalPending))}
          subtitle={`${toSystemDigits((metrics.unpaidCount + metrics.partialCount).toString())} ${isRtl ? "فواتير معلقة" : "pending invoices"}`}
          icon={<Clock className="size-5" />}
          iconClassName="bg-amber-500/10 text-amber-500 border border-amber-500/20"
          badge={isRtl ? "التزامات" : "Liabilities"}
          onClick={() => setStatusTab("unpaid")}
          highlight={statusTab === "unpaid"}
          className="cursor-pointer"
        />
        <VortexMetricCard
          title={isRtl ? "متوسط قيمة الفاتورة" : "Average Ticket"}
          value={toSystemDigits(money(metrics.avgTicket))}
          subtitle={isRtl ? "لكل عملية شراء نشطة" : "per active purchase"}
          icon={<TrendingDown className="size-5" />}
          iconClassName="bg-purple-500/10 text-purple-500 border border-purple-500/20"
          badge={isRtl ? "متوسط" : "Average"}
        />
      </div>

      {/* ─── Standard VORTEX TableToolbar: Search + Filters + Sort + View Toggle + Action ─── */}
      <TableToolbar
        sticky
        lang={isRtl ? "ar" : "en"}
        search={{
          value: search,
          onValueChange: setSearch,
          placeholder: isRtl
            ? "ابحث برقم الفاتورة أو اسم المورد..."
            : "Search PO number or supplier name...",
          resultCount: filtered.length,
        }}
        filters={{
          definitions: purchaseFilterDefinitions,
          values: filters,
          onValueChange: setFilters,
        }}
        sort={{
          options: purchaseSortOptions,
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
            label={isRtl ? "أمر شراء جديد" : "New Purchase"}
            icon={<Plus />}
            tone="primary"
            onClick={() => setCreating(true)}
          />
        }
      >
        {/* Quick Filter Tabs — visible in all view modes */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 scrollbar-x-none">
          {[
            { id: "all", label: isRtl ? "الكل" : "All", count: metrics.totalCount },
            { id: "paid", label: isRtl ? "مسددة" : "Paid", count: metrics.paidCount },
            { id: "partial", label: isRtl ? "دفع جزئي" : "Partial", count: metrics.partialCount },
            {
              id: "unpaid",
              label: isRtl ? "غير مسددة (آجلة)" : "Unpaid",
              count: metrics.unpaidCount,
            },
            {
              id: "cancelled",
              label: isRtl ? "ملغاة" : "Cancelled",
              count: metrics.cancelledCount,
            },
          ].map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setStatusTab(f.id as StatusTab)}
              className={`flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-bold transition ${
                statusTab === f.id
                  ? "border-primary bg-primary text-primary-foreground shadow-xs shadow-primary/20"
                  : "border-border/70 bg-surface/70 text-muted-foreground hover:bg-surface-2 hover:text-foreground"
              }`}
            >
              <span>{f.label}</span>
              <span
                className={`rounded-full px-1.5 py-0.2 text-[10px] font-mono ${
                  statusTab === f.id ? "bg-white/20 text-white" : "bg-muted text-muted-foreground"
                }`}
              >
                {toSystemDigits(f.count.toString())}
              </span>
            </button>
          ))}
        </div>
      </TableToolbar>

      {/* ─── Main Content: Cards Grid vs List vs Classic Table ─── */}
      {loading ? (
        <div className="card-mullak p-12 text-center">
          <div className="mx-auto size-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <p className="mt-3 text-sm text-muted-foreground">
            {isRtl ? "جارِ تحميل فواتير المشتريات..." : "Loading purchases…"}
          </p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="card-mullak flex flex-col items-center gap-3 p-12 text-center">
          <div className="grid size-16 place-items-center rounded-3xl border border-primary/20 bg-primary/10 text-primary shadow-sm">
            <ShoppingCart className="size-8" />
          </div>
          <h3 className="text-base font-bold text-foreground">
            {search || statusTab !== "all"
              ? isRtl
                ? "لا توجد فواتير مشتريات مطابقة"
                : "No matching purchase invoices"
              : t("purchases.no_purchases")}
          </h3>
          <p className="max-w-sm text-xs text-muted-foreground">
            {search || statusTab !== "all"
              ? isRtl
                ? "جرب تعديل خيارات البحث أو التصفية"
                : "Try adjusting your search query or filters"
              : isRtl
                ? "ابدأ بتسجيل أول أمر شراء من نقطة المشتريات."
                : "Start by recording your first purchase order."}
          </p>
          <Link
            to="/purchase-pos"
            className="mt-2 inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-xs font-bold text-primary-foreground shadow-sm transition hover:bg-primary/90 active:scale-95"
          >
            <ShoppingCart className="size-4" />
            <span>{isRtl ? "إنشاء أمر شراء الآن" : "Create Purchase Now"}</span>
          </Link>
        </div>
      ) : viewMode === "cards" ? (
        /* ─── Mullak Luxury Cards Grid — same 2-column mobile grid as products ─── */
        <div className="grid grid-cols-2 gap-2.5 sm:gap-4 md:grid-cols-3 lg:grid-cols-4">
          {filtered.map((inv) => {
            const total = Number(inv.total) || 0;
            const paid = Number(inv.paid) || 0;
            const remaining = Math.max(0, total - paid);
            const supplierName = inv.suppliers?.name ?? "—";

            return (
              <div
                key={inv.id}
                data-qa="purchase-card"
                onClick={() => void openInvoice(inv)}
                className="card-mullak group relative flex cursor-pointer flex-col justify-between overflow-hidden rounded-2xl p-3 transition-all duration-200 hover:shadow-md sm:p-4.5"
              >
                <div>
                  {/* Header: PO number + status */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <span className="block truncate font-mono text-sm font-bold text-foreground transition group-hover:text-primary">
                        {inv.invoice_number}
                      </span>
                      <div className="mt-1">
                        <VortexDateBadge date={inv.created_at} variant="subtle" size="sm" />
                      </div>
                    </div>
                    <div className="shrink-0">{statusBadge(inv.status)}</div>
                  </div>

                  {/* Supplier + payment */}
                  <div className="mt-3 flex items-center justify-between gap-2 border-t border-border/60 pt-2.5 text-xs">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <div className="grid size-6 shrink-0 place-items-center rounded-full bg-surface-2 text-[10px] font-bold">
                        {supplierName.slice(0, 1).toUpperCase()}
                      </div>
                      <div className="truncate font-medium text-foreground">{supplierName}</div>
                    </div>
                    <div className="inline-flex max-w-[45%] shrink-0 items-center gap-1 truncate rounded-lg border border-border/80 bg-surface-2/60 px-2 py-1 text-[11px] text-muted-foreground">
                      <span className="truncate">{pmLabel(inv.payment_method)}</span>
                    </div>
                  </div>

                  {hasMultiWarehouse && inv.warehouses && (
                    <div className="mt-2 truncate text-[11px] text-muted-foreground">
                      {isRtl ? "المستودع: " : "Warehouse: "}
                      {whName(inv.warehouses)}
                    </div>
                  )}

                  {/* Financial summary */}
                  <div className="mt-3 space-y-1.5 rounded-xl border border-border/60 bg-surface-2/40 p-2.5 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-muted-foreground">{t("common.total")}</span>
                      <span className="truncate font-mono text-sm font-bold text-foreground">
                        <Ltr>{money(total)}</Ltr>
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-muted-foreground">{t("common.paid")}</span>
                      <span className="truncate font-mono font-medium text-emerald-500">
                        <Ltr>{money(paid)}</Ltr>
                      </span>
                    </div>
                    {remaining > 0 && (
                      <div className="flex items-center justify-between gap-2 border-t border-border/40 pt-1.5 font-semibold text-rose-500">
                        <span>{isRtl ? "المتبقي" : "Due"}</span>
                        <span className="truncate font-mono">
                          <Ltr>{money(remaining)}</Ltr>
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Actions */}
                <div
                  className="mt-3.5 flex items-center justify-between gap-2 border-t border-border/60 pt-3"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="flex items-center gap-1.5">
                    <IconButton
                      size="sm"
                      variant="outline"
                      tooltip
                      ariaLabel={isRtl ? "عرض التفاصيل" : "View details"}
                      icon={<Eye className="size-3.5" />}
                      round
                      onClick={() => void openInvoice(inv)}
                    />
                  </div>
                  <span className="text-[10px] font-medium text-muted-foreground">
                    {isRtl ? "فاتورة مشتريات" : "Purchase"}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      ) : viewMode === "list" ? (
        /* ─── Luxury Mullak Row-Cards View (List with Accent Strip) ─── */
        <div className="space-y-2.5">
          {filtered.map((inv) => {
            const total = Number(inv.total) || 0;
            const paid = Number(inv.paid) || 0;
            const remaining = Math.max(0, total - paid);
            const supplierName = inv.suppliers?.name ?? "—";
            const barColor =
              inv.status === "paid"
                ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.4)]"
                : inv.status === "partial"
                  ? "bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.5)]"
                  : inv.status === "unpaid"
                    ? "bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.5)]"
                    : "bg-muted-foreground/30";

            return (
              <div
                key={inv.id}
                onClick={() => void openInvoice(inv)}
                className="card-mullak group relative flex cursor-pointer flex-col justify-between gap-3 rounded-2xl border p-3.5 transition-all duration-200 hover:border-primary/50 hover:shadow-md sm:flex-row sm:items-center sm:p-4"
              >
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <span
                    aria-hidden
                    className={`h-11 w-1.5 shrink-0 rounded-full sm:h-12 ${barColor}`}
                  />
                  <div className="grid size-11 shrink-0 place-items-center rounded-xl border border-primary/20 bg-primary/10 text-primary transition-all group-hover:scale-105 group-hover:bg-primary group-hover:text-primary-foreground">
                    <ShoppingCart className="size-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate font-mono text-sm font-bold text-foreground transition-colors group-hover:text-primary sm:text-base">
                        {inv.invoice_number}
                      </span>
                      <div className="shrink-0">{statusBadge(inv.status)}</div>
                      <div className="inline-flex items-center gap-1 truncate text-[11px] text-muted-foreground">
                        <span className="truncate">{pmLabel(inv.payment_method)}</span>
                      </div>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
                      <span className="truncate font-medium text-foreground">{supplierName}</span>
                      <VortexDateBadge date={inv.created_at} variant="subtle" size="sm" />
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between gap-4 border-t border-border/60 pt-2 sm:justify-end sm:border-t-0 sm:pt-0">
                  <div className="min-w-0 text-start sm:min-w-[120px] sm:text-end">
                    <div className="text-[10px] text-muted-foreground">
                      {isRtl ? "الإجمالي:" : "Total:"}
                    </div>
                    <div className="truncate font-mono text-sm font-bold text-foreground sm:text-base">
                      <Ltr>{money(total)}</Ltr>
                    </div>
                    {remaining > 0 ? (
                      <div className="truncate font-mono text-[10px] font-semibold text-rose-500">
                        {isRtl ? "متبقي: " : "Due: "}
                        <Ltr>{money(remaining)}</Ltr>
                      </div>
                    ) : (
                      <div className="text-[10px] font-medium text-emerald-500">
                        {isRtl ? "مدفوعة بالكامل" : "Fully paid"}
                      </div>
                    )}
                  </div>

                  <div
                    className="flex shrink-0 items-center gap-1"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <IconButton
                      size="sm"
                      variant="outline"
                      tooltip
                      ariaLabel={isRtl ? "عرض التفاصيل" : "View details"}
                      icon={<Eye className="size-3.5" />}
                      round
                      onClick={() => void openInvoice(inv)}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        /* ─── Classic Table View: same DataTable as products/sales ─── */
        <div className="panel-elevated -mx-1 overflow-hidden rounded-2xl border border-border/70 sm:mx-0">
          <DataTable
            className="px-0"
            columns={columns}
            rows={filtered}
            rowKey={(inv) => inv.id}
            loading={loading}
            initialLoading={loading}
            error={null}
            sort={sort}
            onSortChange={setSort}
            minWidth={hasMultiWarehouse ? 1120 : 980}
            horizontalScroll={tableUsesHorizontalScroll}
            stickyHeader
            onRowClick={(inv) => void openInvoice(inv)}
            empty={{
              icon: <ShoppingCart />,
              title: t("purchases.no_purchases"),
              description: isRtl
                ? "ابدأ بتسجيل أول أمر شراء من نقطة المشتريات."
                : "Start by recording your first purchase order.",
            }}
          />
        </div>
      )}

      {selected && (
        <ViewDialog
          invoice={selected}
          lines={lines}
          onClose={() => setSelected(null)}
          pmLabel={pmLabel}
          statusLabel={statusLabel}
          hasMultiWarehouse={hasMultiWarehouse}
        />
      )}
      {creating && (
        <CreateDialog
          onClose={() => setCreating(false)}
          onDone={() => {
            setCreating(false);
            void load();
          }}
          hasMultiWarehouse={hasMultiWarehouse}
        />
      )}
    </div>
  );
}

function ViewDialog({
  invoice,
  lines,
  onClose,
  pmLabel,
  statusLabel,
  hasMultiWarehouse,
}: {
  invoice: Invoice;
  lines: Line[];
  onClose: () => void;
  pmLabel: (m: string) => string;
  statusLabel: (s: string) => string;
  hasMultiWarehouse?: boolean;
}) {
  const { t, lang } = useI18n();
  const wh = invoice.warehouses;
  const whLabel = !wh ? "—" : lang === "ar" ? wh.name_ar || wh.name : wh.name || wh.name_ar || "—";
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-end bg-black/65 backdrop-blur-xs animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="h-full w-full max-w-2xl border-s border-border/80 bg-background/95 backdrop-blur-md p-6 shadow-2xl overflow-y-auto animate-in slide-in-from-left duration-200 relative flex flex-col justify-between"
        onClick={(e) => e.stopPropagation()}
        dir={lang === "ar" ? "rtl" : "ltr"}
      >
        <div className="absolute -top-12 -right-12 size-48 rounded-full bg-primary/20 blur-3xl pointer-events-none" />
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h3 className="font-mono text-lg font-semibold">{invoice.invoice_number}</h3>
            <p className="text-xs text-muted-foreground">
              {new Date(invoice.created_at).toLocaleString()}
            </p>
          </div>
          <button onClick={onClose} className="rounded p-1 hover:bg-surface-2">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="mb-4 grid grid-cols-2 gap-3 text-sm">
          <Field label={t("common.supplier")} value={invoice.suppliers?.name ?? "—"} />
          {hasMultiWarehouse && <Field label={t("common.warehouse")} value={whLabel} />}
          <Field label={t("sales.payment")} value={pmLabel(invoice.payment_method)} />
          <Field label={t("common.status")} value={statusLabel(invoice.status)} />
        </div>
        <div className="overflow-hidden rounded-md border border-border">
          <table className="w-full text-sm">
            <thead className="bg-surface text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-start">{t("common.product")}</th>
                <th className="px-3 py-2 text-end">{t("common.qty")}</th>
                <th className="px-3 py-2 text-end">{t("common.cost")}</th>
                <th className="px-3 py-2 text-end">{t("common.total")}</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.id} className="border-t border-border">
                  <td className="px-3 py-2">{l.products?.name ?? "—"}</td>
                  <td className="px-3 py-2 text-end">{l.quantity}</td>
                  <td className="px-3 py-2 text-end">{money(Number(l.unit_cost))}</td>
                  <td className="px-3 py-2 text-end font-medium">{money(Number(l.total))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-4 space-y-1 text-sm">
          <Row label={t("common.subtotal")} value={money(Number(invoice.subtotal))} />
          <Row label={t("common.tax")} value={money(Number(invoice.tax))} />
          <Row label={t("common.discount")} value={money(Number(invoice.discount))} />
          <Row label={t("common.total")} value={money(Number(invoice.total))} bold />
          <Row label={t("common.paid")} value={money(Number(invoice.paid))} />
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={() =>
              printUnifiedDocument({
                doc: {
                  docType: "purchase_invoice",
                  title: t("purchases.title"),
                  number: invoice.invoice_number,
                  date: new Date(invoice.created_at).toLocaleString(),
                  partyLabel: t("common.supplier"),
                  partyName: invoice.suppliers?.name ?? "",
                  warehouse: hasMultiWarehouse ? whLabel : undefined,
                  payment: pmLabel(invoice.payment_method),
                  status: statusLabel(invoice.status),
                  lines: lines.map((l) => ({
                    product: l.products?.name ?? "—",
                    qty: Number(l.quantity),
                    price: Number(l.unit_cost),
                    total: Number(l.total),
                  })),
                  subtotal: Number(invoice.subtotal),
                  tax: Number(invoice.tax),
                  discount: Number(invoice.discount),
                  total: Number(invoice.total),
                  paid: Number(invoice.paid),
                },
                documentType: "purchase_invoice",
                rtl: lang === "ar",
              })
            }
            className="h-9 rounded-md border border-border px-4 text-sm hover:bg-surface-2"
          >
            {t("common.print")}
          </button>
          <button
            onClick={onClose}
            className="h-9 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            {t("common.close")}
          </button>
        </div>
      </div>
    </div>
  );
}

function CreateDialog({
  onClose,
  onDone,
  hasMultiWarehouse,
}: {
  onClose: () => void;
  onDone: () => void;
  hasMultiWarehouse?: boolean;
}) {
  const { t, lang } = useI18n();
  const [products, setProducts] = useState<Product[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [warehouseId, setWarehouseId] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [search, setSearch] = useState("");
  const [stockMap, setStockMap] = useState<Record<string, number>>({});
  const [cart, setCart] = useState<CartLine[]>([]);
  const [paid, setPaid] = useState("");
  const [discount, setDiscount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<string>("bank_transfer");
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);
  const productLabel = (p?: Pick<Product, "name" | "name_ar"> | null) =>
    !p ? "—" : lang === "ar" ? p.name_ar || p.name : p.name || p.name_ar || "—";
  const lowStockSuggestions = useMemo(
    () => products.filter((p) => Number(stockMap[p.id] ?? 0) <= 10).slice(0, 6),
    [products, stockMap],
  );

  useEffect(() => {
    void (async () => {
      const [{ data: ps }, { data: ss }, { data: ws }] = await Promise.all([
        supabase
          .from("products")
          .select(
            "id,name,name_ar,sku,barcode,cost_price,tax_rate,unit:units!products_unit_id_fkey(short_name,name,name_ar),category:categories(name,name_ar),inventory!inventory_product_id_fkey(warehouse_id,quantity)",
          )
          .eq("is_active", true)
          .order("name")
          .limit(500),
        supabase.from("suppliers").select("id,name").eq("is_active", true).order("name"),
        supabase.from("warehouses").select("id,name,name_ar").eq("is_active", true).order("name"),
      ]);
      setProducts((ps ?? []) as Product[]);
      setSuppliers(ss ?? []);
      setWarehouses(ws ?? []);
      if (ws?.[0]) setWarehouseId(ws[0].id);
      if (ss?.[0]) setSupplierId(ss[0].id);
    })();
  }, []);

  useEffect(() => {
    if (!warehouseId) {
      setStockMap({});
      return;
    }
    void (async () => {
      const { data, error } = await supabase
        .from("inventory")
        .select("product_id,quantity")
        .eq("warehouse_id", warehouseId);
      if (error) return;
      const next: Record<string, number> = {};
      for (const row of data ?? []) {
        next[row.product_id] = Number(row.quantity ?? 0);
      }
      setStockMap(next);
    })();
  }, [warehouseId]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (
      q
        ? products.filter((p) =>
            [p.name, p.name_ar, p.sku, p.barcode].some((value) =>
              (value ?? "").toLowerCase().includes(q),
            ),
          )
        : products
    ).slice(0, 30);
  }, [products, search]);

  function addToCart(p: Product) {
    const available = Number(stockMap[p.id] ?? 0);
    setCart((prev) => {
      const idx = prev.findIndex((l) => l.product_id === p.id);
      if (idx >= 0) {
        const n = [...prev];
        const nextQty = n[idx].quantity + 1;
        n[idx] = { ...n[idx], quantity: nextQty };
        return n;
      }
      return [
        ...prev,
        {
          product_id: p.id,
          name: productLabel(p),
          unit_cost: Number(p.cost_price),
          tax_rate: Number(p.tax_rate ?? 0),
          quantity: 1,
        },
      ];
    });
    if (available === 0 && warehouseId) {
      toast.info(
        lang === "ar"
          ? "سيتم إضافة هذا المنتج كإضافة جديدة إلى المخزون في المستودع المحدد"
          : "This product will be added as a new stock entry in the selected warehouse.",
      );
    }
  }

  function clearCart() {
    setCart([]);
    setPaid("");
    setDiscount("");
  }

  function update(pid: string, patch: Partial<CartLine>) {
    setCart((c) => c.map((l) => (l.product_id === pid ? { ...l, ...patch } : l)));
  }

  const subtotal = cart.reduce((s, l) => s + l.unit_cost * l.quantity, 0);
  const taxTotal = cart.reduce((s, l) => s + l.unit_cost * l.quantity * (l.tax_rate / 100), 0);
  const discountN = Number(discount || 0);
  const total = Math.max(0, subtotal + taxTotal - discountN);
  const paidN = Number(paid || 0);

  async function submit() {
    if (loading) return;
    if (!warehouseId || !supplierId) return toast.error(t("purchases.select_ws"));
    if (cart.length === 0) return toast.error(t("purchases.add_items"));

    const invalidLine = cart.find(
      (line) =>
        !Number.isFinite(line.quantity) ||
        line.quantity <= 0 ||
        !Number.isFinite(line.unit_cost) ||
        line.unit_cost < 0 ||
        !Number.isFinite(line.tax_rate) ||
        line.tax_rate < 0,
    );
    if (invalidLine) {
      return toast.error(
        lang === "ar"
          ? "يجب أن تكون الكمية والسعر والضريبة أرقامًا صحيحة وموجبة"
          : "Quantity, cost, and tax must be valid positive numbers.",
      );
    }

    setLoading(true);
    try {
      const { error } = await supabase.rpc("create_purchase", {
        _warehouse_id: warehouseId,
        _supplier_id: supplierId,
        _payment_method: paymentMethod,
        _paid: paymentMethod === "credit" ? 0 : paidN || total,
        _discount: discountN,
        _note: (note || null) as any,
        _items: cart.map((l) => ({
          product_id: l.product_id,
          quantity: Number(l.quantity),
          unit_cost: Number(l.unit_cost),
          tax_rate: Number(l.tax_rate),
        })),
      });
      if (error) throw error;
      toast.success(t("purchases.recorded"));
      onDone();
    } catch (e: any) {
      toast.error(e.message ?? t("common.failed"));
    } finally {
      setLoading(false);
    }
  }

  const pmKey = (m: string) => paymentMethodLabel(m, lang === "ar" ? "ar" : "en");

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-background/80 backdrop-blur-sm p-4">
      <div className="panel-elevated flex max-h-[90vh] w-full max-w-4xl flex-col p-6">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold">{t("purchases.new_po")}</h3>
          <button onClick={onClose} className="rounded p-1 hover:bg-surface-2">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mb-3 grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">
              {t("common.supplier")} *
            </label>
            <select
              value={supplierId}
              onChange={(e) => setSupplierId(e.target.value)}
              className="h-9 w-full rounded-md border border-input bg-surface px-2 text-sm"
            >
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">
              {t("common.warehouse")} *
            </label>
            <select
              value={warehouseId}
              onChange={(e) => setWarehouseId(e.target.value)}
              className="h-9 w-full rounded-md border border-input bg-surface px-2 text-sm"
            >
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {lang === "ar" ? w.name_ar || w.name : w.name || w.name_ar || ""}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="mb-3 flex items-center justify-between gap-2 rounded-xl border border-border/70 bg-surface/80 px-3 py-2 text-[11px] text-muted-foreground">
          <div className="flex items-center gap-2">
            <span className="inline-flex rounded-full bg-primary/10 px-2 py-1 font-medium text-primary">
              {cart.length} {t("purchases.items")}
            </span>
            <span>{money(total)}</span>
          </div>
          {cart.length > 0 && (
            <button
              type="button"
              onClick={clearCart}
              className="rounded-md border border-border px-2 py-1 text-[10px] font-medium hover:bg-surface-2"
            >
              {lang === "ar" ? "مسح السلة" : "Clear cart"}
            </button>
          )}
        </div>

        <div className="grid flex-1 grid-cols-1 gap-4 overflow-hidden md:grid-cols-2">
          <div className="flex flex-col overflow-hidden">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("purchases.search_products")}
              className="mb-2 h-9 rounded-md border border-input bg-surface px-3 text-sm"
            />
            {!search && lowStockSuggestions.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-1.5">
                {lowStockSuggestions.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => addToCart(p)}
                    className="inline-flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-[10px] font-medium text-amber-700 dark:text-amber-300"
                  >
                    {productLabel(p)}
                    <span className="font-mono">({Number(stockMap[p.id] ?? 0)})</span>
                  </button>
                ))}
              </div>
            )}
            <div className="flex-1 overflow-y-auto space-y-1 pr-1">
              {filtered.map((p) => {
                const available = Number(stockMap[p.id] ?? 0);
                return (
                  <button
                    key={p.id}
                    onClick={() => addToCart(p)}
                    className="flex w-full items-center justify-between gap-3 rounded border border-border bg-surface px-3 py-2 text-sm hover:border-ring hover:bg-surface-2"
                  >
                    <div className="min-w-0 flex-1 text-start">
                      <div className="truncate font-medium">{productLabel(p)}</div>
                      <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                        <span>{p.sku ?? "—"}</span>
                        {p.barcode && <span className="font-mono">{p.barcode}</span>}
                      </div>
                    </div>
                    <div className="text-end">
                      <div className="text-xs text-muted-foreground">
                        {money(Number(p.cost_price))}
                      </div>
                      <div className="text-[10px] text-muted-foreground">
                        {lang === "ar" ? `المخزون: ${available}` : `Stock: ${available}`}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex flex-col overflow-hidden">
            <div className="mb-2 text-xs font-medium text-muted-foreground">
              {t("purchases.items")} ({cart.length})
            </div>
            <div className="flex-1 overflow-y-auto space-y-2 pr-1">
              {cart.length === 0 ? (
                <div className="grid place-items-center py-10 text-sm text-muted-foreground">
                  {t("purchases.click_to_add")}
                </div>
              ) : (
                cart.map((l) => (
                  <div key={l.product_id} className="rounded border border-border bg-surface p-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="truncate text-sm font-medium">{l.name}</div>
                      <button
                        onClick={() =>
                          setCart((c) => c.filter((x) => x.product_id !== l.product_id))
                        }
                        className="text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <div className="mt-2 grid grid-cols-3 gap-1">
                      <NumberInput
                        label={t("common.qty")}
                        value={l.quantity}
                        onChange={(v) => update(l.product_id, { quantity: v })}
                      />
                      <NumberInput
                        label={t("common.cost")}
                        value={l.unit_cost}
                        onChange={(v) => update(l.product_id, { unit_cost: v })}
                        step={0.01}
                      />
                      <NumberInput
                        label={t("purchases.tax_pct")}
                        value={l.tax_rate}
                        onChange={(v) => update(l.product_id, { tax_rate: v })}
                      />
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3 border-t border-border pt-3 text-sm">
          <div className="space-y-2">
            {/*
              طريقة دفع المشتريات — المكوّن الموحّد.

              These four hard-coded buttons were a fourth, independent copy of
              the payment-method list. The picker now offers whatever the
              business enabled for purchases, and آجل appears only because the
              catalogue allows it here.
            */}
            <PaymentMethodPicker
              context="purchases"
              value={paymentMethod}
              onChange={(method) => {
                setPaymentMethod(method);
                const definition = getPaymentMethodDefinition(method);
                if (definition?.isCreditTerm) setPaid("0");
              }}
              ensureIds={[paymentMethod]}
              ariaLabel={t("common.method")}
              lang={lang === "ar" ? "ar" : "en"}
            />
            {!(getPaymentMethodDefinition(paymentMethod)?.isCreditTerm ?? false) && (
              <input
                type="number"
                value={paid}
                onChange={(e) => setPaid(e.target.value)}
                placeholder={t("purchases.paid_default", total.toFixed(2))}
                className="h-9 w-full rounded-md border border-input bg-surface px-2 text-sm"
              />
            )}
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t("purchases.note_optional")}
              className="h-9 w-full rounded-md border border-input bg-surface px-2 text-sm"
            />
          </div>
          <div className="space-y-1.5">
            <Row label={t("common.subtotal")} value={money(subtotal)} />
            <Row label={t("common.tax")} value={money(taxTotal)} />
            <div className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground">{t("common.discount")}</span>
              <input
                type="number"
                value={discount}
                onChange={(e) => setDiscount(e.target.value)}
                placeholder="0"
                className="h-7 w-24 rounded border border-border bg-surface px-2 text-end text-xs"
              />
            </div>
            <Row label={t("common.total")} value={money(total)} bold />
            <button
              onClick={submit}
              disabled={loading || cart.length === 0}
              className="mt-1 flex h-10 w-full items-center justify-center gap-2 rounded-md bg-primary text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              {loading && <Loader2 className="h-4 w-4 animate-spin" />}
              {t("purchases.save")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function NumberInput({
  label,
  value,
  onChange,
  step = 1,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
}) {
  return (
    <div>
      <label className="block text-[10px] uppercase text-muted-foreground">{label}</label>
      <input
        type="number"
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-7 w-full rounded border border-border bg-surface px-1.5 text-xs"
      />
    </div>
  );
}
function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="capitalize">{value}</p>
    </div>
  );
}
function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div
      className={`flex items-center justify-between ${bold ? "text-base font-semibold" : "text-muted-foreground"}`}
    >
      <span>{label}</span>
      <span className={bold ? "text-foreground" : ""}>{value}</span>
    </div>
  );
}

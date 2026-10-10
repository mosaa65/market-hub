import { ModuleGuard, useModules } from "@/lib/modules";
import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/page-header";
import { useI18n } from "@/lib/i18n";
import { supabase } from "@/integrations/supabase/client";
import { money } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { PaymentMethodPicker } from "@/components/ui/payment-method";
import { paymentMethodLabel } from "@/lib/payments/payment-methods";
import { usePaymentMethodOverrides } from "@/hooks/use-payment-methods";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import {
  LayoutGrid,
  List,
  Plus,
  RotateCcw,
  TableProperties,
  Trash2,
  Truck,
  Wallet,
} from "lucide-react";
import { VortexMetricCard } from "@/components/vortex-ui";
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

export const Route = createFileRoute("/_app/purchase-returns")({
  head: () => ({ meta: [{ title: "مرتجعات المشتريات — Vortex ERP" }] }),
  component: () => (
    <ModuleGuard moduleId="returns">
      <PurchaseReturnsPage />
    </ModuleGuard>
  ),
});

interface Line {
  product_id: string;
  name: string;
  quantity: number;
  unit_cost: number;
  tax_rate: number;
}

interface PurchaseReturn {
  id: string;
  return_number: string;
  supplier_id: string | null;
  warehouse_id: string;
  subtotal: number;
  tax: number;
  total: number;
  refund_method: string | null;
  note: string | null;
  created_at: string;
  suppliers?: { name: string | null } | null;
  warehouses?: { name: string | null; name_ar: string | null } | null;
}

type ViewMode = RecordsViewMode;

function PurchaseReturnsPage() {
  const { isModuleEnabled } = useModules();
  const hasMultiWarehouse = isModuleEnabled("multi_warehouse");
  const { t, lang } = useI18n();
  const isRtl = lang === "ar";
  const qc = useQueryClient();
  // The business's own names for methods it renamed, keyed by catalogue id, so a
  // refund method reads the same here as it does at the till.
  const overrides = usePaymentMethodOverrides();
  const breakpoint = useBreakpoint();
  const tableUsesHorizontalScroll =
    breakpoint === "xs" || breakpoint === "sm" || breakpoint === "md";

  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<FilterValues>({});
  const [sortKey, setSortKey] = useState<string>("date_desc");
  const [sort, setSort] = useState<DataTableSort | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("cards");

  const whName = useCallback(
    (w?: { name: string | null; name_ar?: string | null } | null) =>
      !w ? "—" : (isRtl ? w.name_ar || w.name : w.name || w.name_ar) || "—",
    [isRtl],
  );

  /*
   * The returns ledger now flows through the shared QueryClient. The read is
   * unchanged — same table, same joins, same 100-row cap and newest-first order
   * — but a save can now invalidate exactly this key instead of a local load().
   */
  const {
    data: purchaseReturns = [],
    isLoading,
    isFetching,
    error,
    refetch,
  } = useQuery({
    queryKey: ["purchase-returns"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("purchase_returns")
        .select("*, suppliers(name), warehouses(name,name_ar)")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data ?? []) as PurchaseReturn[];
    },
    staleTime: 60_000,
  });

  /* ---------------- search + filter ---------------- */
  const searched = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return purchaseReturns;
    return purchaseReturns.filter(
      (r) =>
        r.return_number.toLowerCase().includes(q) ||
        (r.suppliers?.name ?? "").toLowerCase().includes(q) ||
        (r.note ?? "").toLowerCase().includes(q),
    );
  }, [purchaseReturns, search]);

  /**
   * A stored `refund_method` -> the name to show, read from the catalogue.
   *
   * The switch that used to be here was a third copy of the payment-method
   * labels. It knew only four values, it had a `bank` branch for a value the
   * ENUM does not contain, and anything else — `mobile_money`, `cheque`, a
   * wallet the business added — was printed as its raw English key. The
   * catalogue answers all of them, and `overrides` turns a renamed method into
   * the business's own word.
   */
  const refundLabel = useCallback(
    (method: string | null) => paymentMethodLabel(method ?? "cash", isRtl ? "ar" : "en", overrides),
    [isRtl, overrides],
  );

  const filterDefinitions: FilterDefinition[] = useMemo(() => {
    const defs: FilterDefinition[] = [];
    const supplierOptions = Array.from(
      new Map(
        purchaseReturns
          .filter((r) => r.supplier_id)
          .map((r) => [
            r.supplier_id,
            { value: r.supplier_id as string, label: r.suppliers?.name || "—" },
          ]),
      ).values(),
    );
    if (supplierOptions.length) {
      defs.push({
        key: "supplier_id",
        label: isRtl ? "المورد" : "Supplier",
        type: "select",
        options: supplierOptions,
      });
    }
    if (hasMultiWarehouse) {
      const whOptions = Array.from(
        new Map(
          purchaseReturns
            .filter((r) => r.warehouse_id)
            .map((r) => [r.warehouse_id, { value: r.warehouse_id, label: whName(r.warehouses) }]),
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
    const methodOptions = Array.from(
      new Set(purchaseReturns.map((r) => r.refund_method ?? "cash")),
    ).map((value) => ({ value, label: refundLabel(value) }));
    if (methodOptions.length) {
      defs.push({
        key: "refund_method",
        label: isRtl ? "طريقة الاسترداد" : "Refund method",
        type: "select",
        options: methodOptions,
      });
    }
    defs.push({
      key: "created_at",
      label: isRtl ? "تاريخ المرتجع" : "Return date",
      type: "date-range",
    });
    return defs;
  }, [purchaseReturns, hasMultiWarehouse, isRtl, whName, refundLabel]);

  const filtered = useMemo(() => {
    return searched.filter((r) => {
      if (filters.supplier_id && r.supplier_id !== filters.supplier_id) return false;
      if (filters.warehouse_id && r.warehouse_id !== filters.warehouse_id) return false;
      if (filters.refund_method && (r.refund_method ?? "cash") !== filters.refund_method)
        return false;
      if (filters.created_at && typeof filters.created_at === "object") {
        const rowTime = new Date(r.created_at).getTime();
        if (filters.created_at.from && rowTime < new Date(filters.created_at.from).getTime())
          return false;
        if (filters.created_at.to) {
          const to = new Date(filters.created_at.to);
          to.setHours(23, 59, 59, 999);
          if (rowTime > to.getTime()) return false;
        }
      }
      return true;
    });
  }, [searched, filters]);

  /* ---------------- KPI ---------------- */
  const { totalValue, thisMonthCount, monthValue } = useMemo(() => {
    let value = 0;
    let count = 0;
    let month = 0;
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);
    for (const r of purchaseReturns) {
      const total = Number(r.total) || 0;
      value += total;
      if (new Date(r.created_at).getTime() >= startOfMonth.getTime()) {
        count++;
        month += total;
      }
    }
    return { totalValue: value, thisMonthCount: count, monthValue: month };
  }, [purchaseReturns]);

  /* ---------------- sort ---------------- */
  const sortOptions: SortOption[] = useMemo(
    () => [
      { value: "date_desc", label: isRtl ? "الأحدث أولاً" : "Newest first" },
      { value: "date_asc", label: isRtl ? "الأقدم أولاً" : "Oldest first" },
      { value: "total_desc", label: isRtl ? "الإجمالي (الأعلى)" : "Total (high)" },
      { value: "total_asc", label: isRtl ? "الإجمالي (الأقل)" : "Total (low)" },
      { value: "number_asc", label: isRtl ? "رقم المرتجع" : "Return number" },
    ],
    [isRtl],
  );

  const sortedRows = useMemo(() => {
    const list = [...filtered];
    if (sort) {
      const dir = sort.direction === "asc" ? 1 : -1;
      switch (sort.key) {
        case "number":
          return list.sort((a, b) => a.return_number.localeCompare(b.return_number) * dir);
        case "total":
          return list.sort((a, b) => (Number(a.total) - Number(b.total)) * dir);
        case "date":
          return list.sort(
            (a, b) => (new Date(a.created_at).getTime() - new Date(b.created_at).getTime()) * dir,
          );
        default:
          break;
      }
    }
    switch (sortKey) {
      case "date_asc":
        return list.sort(
          (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
        );
      case "total_desc":
        return list.sort((a, b) => Number(b.total) - Number(a.total));
      case "total_asc":
        return list.sort((a, b) => Number(a.total) - Number(b.total));
      case "number_asc":
        return list.sort((a, b) => a.return_number.localeCompare(b.return_number));
      default:
        return list.sort(
          (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
        );
    }
  }, [filtered, sort, sortKey]);

  /* ---------------- classic table columns ---------------- */
  const columns = useMemo<DataTableColumn<PurchaseReturn>[]>(() => {
    const cols: DataTableColumn<PurchaseReturn>[] = [
      {
        key: "number",
        header: isRtl ? "رقم المرتجع" : "Return #",
        sortable: true,
        width: "w-[160px]",
        sortValue: (r) => r.return_number,
        cell: (r) => <span className="font-mono text-xs font-semibold">{r.return_number}</span>,
      },
      {
        key: "date",
        header: isRtl ? "التاريخ" : "Date",
        sortable: true,
        width: "w-[170px]",
        sortValue: (r) => new Date(r.created_at).getTime(),
        cell: (r) => (
          <span className="text-xs text-muted-foreground">
            {new Date(r.created_at).toLocaleString()}
          </span>
        ),
      },
      {
        key: "supplier",
        header: isRtl ? "المورد" : "Supplier",
        width: "w-[200px]",
        cell: (r) => <span>{r.suppliers?.name ?? "—"}</span>,
      },
    ];
    if (hasMultiWarehouse) {
      cols.push({
        key: "warehouse",
        header: isRtl ? "المستودع" : "Warehouse",
        width: "w-[180px]",
        cell: (r) => <span className="text-muted-foreground">{whName(r.warehouses)}</span>,
      });
    }
    cols.push(
      {
        key: "refund",
        header: isRtl ? "طريقة الاسترداد" : "Refund method",
        width: "w-[160px]",
        cell: (r) => (
          <span className="text-xs text-muted-foreground">{refundLabel(r.refund_method)}</span>
        ),
      },
      {
        key: "total",
        header: isRtl ? "الإجمالي" : "Total",
        sortable: true,
        align: "end",
        width: "w-[140px]",
        sortValue: (r) => Number(r.total),
        cell: (r) => (
          <span className="font-mono text-sm font-semibold">{money(Number(r.total))}</span>
        ),
      },
    );
    return cols;
  }, [isRtl, hasMultiWarehouse, whName, refundLabel]);

  const rendererProps = (r: PurchaseReturn) => ({
    row: r,
    isRtl,
    hasMultiWarehouse,
    warehouseName: whName(r.warehouses),
    refundLabel: refundLabel(r.refund_method),
  });

  const hasActiveCriteria = Boolean(search.trim()) || Object.keys(filters).length > 0;

  return (
    <div className="space-y-4 pb-12">
      <PageHeader
        title={isRtl ? "مرتجعات المشتريات" : "Purchase Returns"}
        subtitle={
          isRtl ? "سجل وأداء مرتجعات المشتريات إلى الموردين" : "Track supplier purchase returns"
        }
      />

      {/* ─── KPI cards ─── */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <VortexMetricCard
          title={isRtl ? "إجمالي المرتجعات" : "Total returns"}
          value={purchaseReturns.length}
          subtitle={isRtl ? "المحمّلة حالياً" : "Currently loaded"}
          icon={<RotateCcw className="size-5" />}
          tone="info"
        />
        <VortexMetricCard
          title={isRtl ? "قيمة المرتجعات" : "Returns value"}
          value={money(totalValue)}
          subtitle={isRtl ? "الإجمالي المُرجع للموردين" : "Total returned to suppliers"}
          icon={<Wallet className="size-5" />}
          tone="default"
        />
        <VortexMetricCard
          title={isRtl ? "هذا الشهر" : "This month"}
          value={thisMonthCount}
          subtitle={isRtl ? "عدد المرتجعات" : "Return documents"}
          icon={<Truck className="size-5" />}
          tone="success"
        />
        <VortexMetricCard
          title={isRtl ? "قيمة هذا الشهر" : "This month value"}
          value={money(monthValue)}
          subtitle={isRtl ? "إجمالي الشهر الحالي" : "Current month total"}
          icon={<Wallet className="size-5" />}
          tone="warning"
        />
      </div>

      {/* ─── Standard VORTEX TableToolbar ─── */}
      <TableToolbar
        sticky
        search={{
          value: search,
          onValueChange: setSearch,
          placeholder: isRtl
            ? "ابحث برقم المرتجع أو اسم المورد أو الملاحظة..."
            : "Search return #, supplier or note…",
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
          <NewPurchaseReturn
            onSaved={() => qc.invalidateQueries({ queryKey: ["purchase-returns"] })}
            hasMultiWarehouse={hasMultiWarehouse}
          />
        }
      />

      {/* ─── Records: cards / list / classic table — shared scaffold ─── */}
      <RecordsView<PurchaseReturn>
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
        minWidth={hasMultiWarehouse ? 1040 : 880}
        horizontalScroll={tableUsesHorizontalScroll}
        renderCard={(r) => <PurchaseReturnCard {...rendererProps(r)} />}
        renderListRow={(r) => <PurchaseReturnListRow {...rendererProps(r)} />}
        empty={{
          icon: <RotateCcw />,
          title: hasActiveCriteria
            ? isRtl
              ? "لا توجد مرتجعات مطابقة"
              : "No matching returns"
            : isRtl
              ? "لا توجد مرتجعات مشتريات"
              : "No purchase returns",
          description: hasActiveCriteria
            ? isRtl
              ? "جرّب تعديل البحث أو الفلاتر."
              : "Try adjusting your search or filters."
            : isRtl
              ? "سجّل مرتجع مشتريات جديداً لبدء التتبع."
              : "Record a new purchase return to start tracking.",
        }}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Purchase-return renderers                                          */
/* ------------------------------------------------------------------ */

interface PurchaseReturnRendererProps {
  row: PurchaseReturn;
  isRtl: boolean;
  hasMultiWarehouse: boolean;
  warehouseName: string;
  refundLabel: string;
}

function PurchaseReturnCard({
  row: r,
  isRtl,
  hasMultiWarehouse,
  warehouseName,
  refundLabel,
}: PurchaseReturnRendererProps) {
  return (
    <div className="card-mullak group relative flex h-full flex-col justify-between rounded-2xl p-3 transition-all duration-200 hover:shadow-md sm:p-4.5">
      <div className="flex items-start gap-2.5">
        <span
          aria-hidden
          className="h-12 w-1.5 shrink-0 rounded-full bg-primary shadow-[0_0_10px_rgba(59,130,246,0.3)]"
        />
        <div className="grid size-11 shrink-0 place-items-center rounded-2xl border border-primary/20 bg-primary/10 text-primary transition-transform group-hover:scale-105">
          <RotateCcw className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <span className="block truncate font-mono text-xs font-bold text-foreground">
            {r.return_number}
          </span>
          <div className="truncate text-[11px] text-muted-foreground">
            {r.suppliers?.name ?? "—"}
          </div>
          <span className="mt-1 inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[9px] font-bold text-muted-foreground">
            {refundLabel}
          </span>
        </div>
      </div>

      <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
        <span className="font-mono">{new Date(r.created_at).toLocaleDateString()}</span>
        {hasMultiWarehouse && <span className="truncate">{warehouseName}</span>}
      </div>

      <div className="mt-3 flex items-end justify-between border-t border-border/60 pt-2.5">
        <span className="text-[10px] text-muted-foreground">{isRtl ? "الإجمالي" : "Total"}</span>
        <span className="font-mono text-base font-bold text-primary">{money(Number(r.total))}</span>
      </div>
    </div>
  );
}

function PurchaseReturnListRow({
  row: r,
  isRtl,
  hasMultiWarehouse,
  warehouseName,
  refundLabel,
}: PurchaseReturnRendererProps) {
  return (
    <div className="card-mullak group relative flex flex-col justify-between gap-3 rounded-2xl border p-3.5 transition-all duration-200 hover:border-primary/50 hover:shadow-md sm:p-4 md:flex-row md:items-center">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <span
          aria-hidden
          className="h-11 w-1.5 shrink-0 rounded-full bg-primary shadow-[0_0_8px_rgba(59,130,246,0.3)] sm:h-12"
        />
        <div className="grid size-11 shrink-0 place-items-center rounded-xl border border-primary/20 bg-primary/10 text-primary transition-all group-hover:scale-105 group-hover:bg-primary group-hover:text-primary-foreground">
          <RotateCcw className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="truncate font-mono text-sm font-bold leading-snug text-foreground">
              {r.return_number}
            </h4>
            <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[9px] font-bold text-muted-foreground">
              {refundLabel}
            </span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
            <span className="truncate">{r.suppliers?.name ?? "—"}</span>
            {hasMultiWarehouse && <span className="truncate">— {warehouseName}</span>}
          </div>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-4 border-t border-border/50 pt-2 ps-4 text-xs md:border-t-0 md:pt-0">
        <span className="hidden font-mono text-[11px] text-muted-foreground sm:inline">
          {new Date(r.created_at).toLocaleString()}
        </span>
        <div className="text-end">
          <p className="font-mono text-base font-bold tracking-tight text-foreground">
            {money(Number(r.total))}
          </p>
          <p className="text-[10px] text-muted-foreground">{isRtl ? "الإجمالي" : "Total"}</p>
        </div>
      </div>
    </div>
  );
}

function NewPurchaseReturn({
  onSaved,
  hasMultiWarehouse,
}: {
  onSaved: () => void;
  hasMultiWarehouse?: boolean;
}) {
  const { t, lang } = useI18n();
  const [open, setOpen] = useState(false);
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [warehouseId, setWarehouseId] = useState("");
  const [supplierId, setSupplierId] = useState<string>("");
  const [refundMethod, setRefundMethod] = useState("cash");
  const [note, setNote] = useState("");
  const [search, setSearch] = useState("");
  const [supplierInvoiceId, setSupplierInvoiceId] = useState<string>("");
  const [supplierInvoices, setSupplierInvoices] = useState<any[]>([]);
  const [invoiceItems, setInvoiceItems] = useState<any[]>([]);
  const [lines, setLines] = useState<Line[]>([]);

  useEffect(() => {
    if (!open) return;
    Promise.all([
      supabase.from("warehouses").select("id,name,name_ar").eq("is_active", true).order("name"),
      supabase.from("suppliers").select("id,name").eq("is_active", true).order("name"),
      supabase
        .from("products")
        .select("id,name,name_ar,sku,cost_price,tax_rate")
        .eq("is_active", true)
        .order("name")
        .limit(200),
    ]).then(([w, s, p]) => {
      setWarehouses(w.data ?? []);
      setSuppliers(s.data ?? []);
      setProducts(p.data ?? []);
      if (!warehouseId && w.data?.[0]) setWarehouseId(w.data[0].id);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- مقصود: تحديد المستودع الافتراضي مرة واحدة عند الفتح
  }, [open]);

  useEffect(() => {
    if (!supplierId) {
      setSupplierInvoices([]);
      setSupplierInvoiceId("");
      setInvoiceItems([]);
      setLines([]);
      return;
    }
    void (async () => {
      const { data, error } = await supabase
        .from("purchase_invoices")
        .select(
          "id,invoice_number,total,created_at,purchase_invoice_items(quantity,unit_cost,tax_rate,product_id,products(id,name,name_ar,sku))",
        )
        .eq("supplier_id", supplierId)
        .order("created_at", { ascending: false });
      if (error) return;
      const rows = data ?? [];
      setSupplierInvoices(rows);
      const firstId = rows[0]?.id ?? "";
      setSupplierInvoiceId(firstId);
      const nextItems = (rows[0]?.purchase_invoice_items ?? []) as any[];
      setInvoiceItems(nextItems);
      const selectedItems = nextItems.map((item) => ({
        product_id: item.product_id ?? item.products?.id ?? "",
        name:
          lang === "ar"
            ? item.products?.name_ar || item.products?.name
            : item.products?.name || item.products?.name_ar,
        quantity: Math.min(1, Math.max(1, Number(item.quantity ?? 1))),
        max_quantity: Number(item.quantity ?? 9999),
        unit_cost: Number(item.unit_cost ?? 0),
        tax_rate: Number(item.tax_rate ?? 0),
      }));
      setLines(selectedItems.filter((item) => item.product_id));
    })();
  }, [supplierId, lang]);

  useEffect(() => {
    if (!supplierInvoiceId) {
      setInvoiceItems([]);
      setLines([]);
      return;
    }
    void (async () => {
      const { data, error } = await supabase
        .from("purchase_invoices")
        .select(
          "id,invoice_number,purchase_invoice_items(quantity,unit_cost,tax_rate,product_id,products(id,name,name_ar,sku))",
        )
        .eq("id", supplierInvoiceId)
        .maybeSingle();
      if (error || !data) return;
      const nextItems = (data.purchase_invoice_items ?? []) as any[];
      setInvoiceItems(nextItems);
      const selectedItems = nextItems.map((item) => ({
        product_id: item.product_id ?? item.products?.id ?? "",
        name:
          lang === "ar"
            ? item.products?.name_ar || item.products?.name
            : item.products?.name || item.products?.name_ar,
        quantity: Math.min(1, Math.max(1, Number(item.quantity ?? 1))),
        max_quantity: Number(item.quantity ?? 9999),
        unit_cost: Number(item.unit_cost ?? 0),
        tax_rate: Number(item.tax_rate ?? 0),
      }));
      setLines(selectedItems.filter((item) => item.product_id));
    })();
  }, [supplierInvoiceId, lang]);

  const filtered = useMemo(
    () =>
      products
        .filter(
          (p) =>
            !search ||
            p.name.toLowerCase().includes(search.toLowerCase()) ||
            (p.name_ar ?? "").includes(search) ||
            p.sku?.toLowerCase().includes(search.toLowerCase()),
        )
        .slice(0, 8),
    [products, search],
  );

  function addLine(p: any) {
    setLines((l) => {
      const ex = l.find((x) => x.product_id === p.id);
      if (ex) return l.map((x) => (x.product_id === p.id ? { ...x, quantity: x.quantity + 1 } : x));
      return [
        ...l,
        {
          product_id: p.id,
          name: lang === "ar" ? p.name_ar || p.name : p.name || p.name_ar,
          quantity: 1,
          unit_cost: Number(p.cost_price),
          tax_rate: Number(p.tax_rate ?? 0),
        },
      ];
    });
    setSearch("");
  }

  function removeLine(pid: string) {
    setLines((l) => l.filter((x) => x.product_id !== pid));
  }

  function updateQty(pid: string, qty: number) {
    if (qty < 1) return removeLine(pid);
    setLines((l) =>
      l.map((x) => {
        if (x.product_id !== pid) return x;
        const maxQ = (x as any).max_quantity;
        const validQty = typeof maxQ === "number" && maxQ > 0 ? Math.min(qty, maxQ) : qty;
        return { ...x, quantity: validQty };
      }),
    );
  }

  const total =
    Math.round(
      lines.reduce((a, l) => a + l.quantity * l.unit_cost * (1 + l.tax_rate / 100), 0) * 100,
    ) / 100;

  async function save() {
    if (!warehouseId || !supplierId || lines.length === 0) {
      toast.error(t("common.fill_form"));
      return;
    }
    const { error } = await supabase.rpc("create_purchase_return" as any, {
      _invoice_id: supplierInvoiceId || null,
      _warehouse_id: warehouseId,
      _supplier_id: supplierId,
      _refund_method: refundMethod,
      _note: note || null,
      _items: lines as any,
    });
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(
      lang === "ar" ? "تم تسجيل مرتجع المشتريات بنجاح" : "Purchase return recorded successfully",
    );
    setOpen(false);
    setLines([]);
    setNote("");
    onSaved();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="h-4 w-4 me-1" />
          {lang === "ar" ? "مرتجع مشتريات جديد" : "New Purchase Return"}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{lang === "ar" ? "إنشاء مرتجع مشتريات" : "New Purchase Return"}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div
            className={`grid grid-cols-1 ${hasMultiWarehouse ? "sm:grid-cols-3" : "sm:grid-cols-2"} gap-3`}
          >
            {hasMultiWarehouse && (
              <div className="grid gap-1.5">
                <Label>{lang === "ar" ? "المستودع" : "Warehouse"}</Label>
                <Select value={warehouseId} onValueChange={setWarehouseId}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {warehouses.map((w) => (
                      <SelectItem key={w.id} value={w.id}>
                        {lang === "ar" ? w.name_ar || w.name : w.name || w.name_ar}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="grid gap-1.5">
              <Label>{lang === "ar" ? "المورد" : "Supplier"}</Label>
              <Select value={supplierId} onValueChange={setSupplierId}>
                <SelectTrigger>
                  <SelectValue
                    placeholder={lang === "ar" ? "اختر المورد..." : "Select supplier..."}
                  />
                </SelectTrigger>
                <SelectContent>
                  {suppliers.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>{lang === "ar" ? "الفاتورة" : "Invoice"}</Label>
              <Select value={supplierInvoiceId} onValueChange={setSupplierInvoiceId}>
                <SelectTrigger>
                  <SelectValue
                    placeholder={lang === "ar" ? "اختر الفاتورة..." : "Select invoice..."}
                  />
                </SelectTrigger>
                <SelectContent>
                  {!supplierId && (
                    <div className="px-3 py-2 text-xs text-muted-foreground">
                      {lang === "ar" ? "اختر المورد أولاً" : "Choose a supplier first"}
                    </div>
                  )}
                  {supplierInvoices.map((inv) => (
                    <SelectItem key={inv.id} value={inv.id}>
                      {inv.invoice_number} · {money(Number(inv.total))}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>{lang === "ar" ? "طريقة الاسترداد" : "Refund method"}</Label>
              {/*
                الاسترداد ليس طريقة دفع، لكنه يستخدم نفس الكتالوج بنفس السياق
                المستقل، فالطرق المتاحة هنا هي ما فعّله العميل لقسم المرتجعات.

                This replaced a Radix Select whose "badge" option used value
                "bank" — a value the payment_method ENUM does not contain, so
                the return failed with a cast error.
              */}
              <PaymentMethodPicker
                context="purchase_returns"
                value={refundMethod}
                onChange={setRefundMethod}
                includeCredit
                ensureIds={[refundMethod]}
                ariaLabel={lang === "ar" ? "طريقة الاسترداد" : "Refund method"}
              />
            </div>
          </div>

          <div className="relative">
            <Label className="mb-1.5 block">
              {lang === "ar" ? "إضافة أصناف المرتجع" : "Add Return Items"}
            </Label>
            <Input
              placeholder={lang === "ar" ? "ابحث بالاسم أو الرمز..." : "Search product or SKU..."}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search && filtered.length > 0 && (
              <div className="absolute z-20 mt-1 w-full rounded-md border border-border bg-popover shadow-lg max-h-60 overflow-auto">
                {filtered.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className="flex w-full items-center justify-between px-3 py-2 text-sm hover:bg-accent text-start"
                    onClick={() => addLine(p)}
                  >
                    <span>{lang === "ar" ? p.name_ar || p.name : p.name || p.name_ar}</span>
                    <span className="font-mono text-xs text-muted-foreground">
                      {money(Number(p.cost_price))}
                    </span>
                  </button>
                ))}
              </div>
            )}
            {invoiceItems.length > 0 && !search && (
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {invoiceItems.map((item: any) => {
                  const productId = item.product_id ?? item.products?.id ?? "";
                  const label =
                    lang === "ar"
                      ? item.products?.name_ar || item.products?.name
                      : item.products?.name || item.products?.name_ar;
                  return (
                    <button
                      key={productId}
                      type="button"
                      onClick={() =>
                        addLine({
                          id: productId,
                          name: label,
                          sku: item.products?.sku,
                          cost_price: Number(item.unit_cost ?? 0),
                          tax_rate: Number(item.tax_rate ?? 0),
                        })
                      }
                      className="rounded-xl border border-border bg-surface px-3 py-2 text-left text-sm hover:border-primary/40 hover:bg-primary/5"
                    >
                      <div className="font-medium">{label}</div>
                      <div className="mt-1 flex items-center justify-between text-[11px] text-muted-foreground">
                        <span>{item.products?.sku ?? "—"}</span>
                        <span>
                          {item.quantity} {lang === "ar" ? "قطعة" : "pcs"}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {lines.length > 0 && (
            <div className="rounded-md border border-border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{lang === "ar" ? "المنتج" : "Product"}</TableHead>
                    <TableHead>{lang === "ar" ? "الكمية" : "Qty"}</TableHead>
                    <TableHead>{lang === "ar" ? "التكلفة" : "Cost"}</TableHead>
                    <TableHead className="text-end">
                      {lang === "ar" ? "الإجمالي" : "Total"}
                    </TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lines.map((l) => (
                    <TableRow key={l.product_id}>
                      <TableCell className="font-medium">{l.name}</TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          min={1}
                          value={l.quantity}
                          onChange={(e) => updateQty(l.product_id, parseInt(e.target.value) || 1)}
                          className="w-20 h-8"
                        />
                      </TableCell>
                      <TableCell className="font-mono">{money(l.unit_cost)}</TableCell>
                      <TableCell className="text-end font-mono font-semibold">
                        {money(l.quantity * l.unit_cost * (1 + l.tax_rate / 100))}
                      </TableCell>
                      <TableCell className="text-end">
                        <button
                          type="button"
                          onClick={() => removeLine(l.product_id)}
                          className="text-destructive hover:opacity-80"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          <div className="grid gap-1.5">
            <Label>{lang === "ar" ? "ملاحظات" : "Notes"}</Label>
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={lang === "ar" ? "سبب المرتجع..." : "Reason for return..."}
            />
          </div>

          <div className="flex items-center justify-between pt-2 border-t border-border">
            <div className="text-sm">
              <span className="text-muted-foreground">
                {lang === "ar" ? "إجمالي المرتجع:" : "Total Return:"}{" "}
              </span>
              <span className="text-lg font-bold font-mono text-primary">{money(total)}</span>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setOpen(false)}>
                {t("common.cancel")}
              </Button>
              <Button onClick={save}>{t("common.save")}</Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

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
import { QuantityInput } from "@/components/ui/quantity-input";
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
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { DynamicPaymentSelector } from "@/components/ui/payment-method/dynamic-payment-selector";
import type { PaymentSettlementSelection } from "@/lib/payments/treasury-types";
import { paymentMethodLabel } from "@/lib/payments/payment-methods";
import { usePaymentMethodOverrides } from "@/hooks/use-payment-methods";
import { PrimaryAction } from "@/components/ui/primary-action";
import { Loader2, Plus, Printer, RotateCcw, Search, Trash2, Truck, Wallet } from "lucide-react";
import { LuxuryPrintPreviewModal } from "@/components/luxury-print-preview-modal";
import type { UnifiedDocumentData } from "@/lib/templates";
import { translateRpcError } from "@/lib/errors/rpc-errors";
import { addReturnableQuantities, quantityIncrementDecimals } from "@/lib/invoice-returnable-quantities";
import { IconButton } from "@/components/ui/icon-button";
import { VortexMetricCard } from "@/components/vortex-ui";
import { RecordsView, type RecordsViewMode } from "@/components/ui/records-view";
import { RecordsViewToggle } from "@/components/ui/records-view-toggle";
import { usePersistedViewMode } from "@/hooks/use-persisted-view-mode";
import { useBreakpoint } from "@/design/breakpoints";
import {
  TableToolbar,
  type FilterDefinition,
  type FilterValues,
  type SortOption,
} from "@/components/ui/table-toolbar";
import { type DataTableColumn, type DataTableSort } from "@/components/ui/data-table";

export const Route = createFileRoute("/_app/sales-returns")({
  head: () => ({ meta: [{ title: "مرتجعات المبيعات — Vortex ERP" }] }),
  component: () => (
    <ModuleGuard moduleId="returns">
      <SalesReturnsPage />
    </ModuleGuard>
  ),
});

interface Line {
  invoice_item_id: string;
  product_id: string;
  name: string;
  quantity: number;
  max_quantity: number;
  uom_id: string | null;
  unit_label: string;
  quantity_step: number;
  unit_price: number;
  tax_per_unit: number;
}

interface SalesReturn {
  id: string;
  return_number: string;
  customer_id: string | null;
  warehouse_id: string | null;
  subtotal: number;
  tax: number;
  total: number;
  refund_method: string | null;
  note: string | null;
  created_at: string;
  customers?: { name: string | null } | null;
  warehouses?: { name: string | null; name_ar: string | null } | null;
}

function SalesReturnsPage() {
  const { isModuleEnabled } = useModules();
  const hasMultiWarehouse = isModuleEnabled("multi_warehouse");
  const { t, lang } = useI18n();
  const isRtl = lang === "ar";
  const qc = useQueryClient();
  const overrides = usePaymentMethodOverrides();
  const breakpoint = useBreakpoint();
  const tableUsesHorizontalScroll =
    breakpoint === "xs" || breakpoint === "sm" || breakpoint === "md";

  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<FilterValues>({});
  const [sortKey, setSortKey] = useState<string>("date_desc");
  const [sort, setSort] = useState<DataTableSort | null>(null);
  const [viewMode, setViewMode] = usePersistedViewMode("sales-returns", "cards");
  const [newReturnOpen, setNewReturnOpen] = useState(false);

  const whName = useCallback(
    (w?: { name: string | null; name_ar?: string | null } | null) =>
      !w ? "—" : (isRtl ? w.name_ar || w.name : w.name || w.name_ar) || "—",
    [isRtl],
  );

  const {
    data: salesReturns = [],
    isLoading,
    isFetching,
    error,
    refetch,
  } = useQuery({
    queryKey: ["sales-returns"],
    queryFn: async () => {
      const { data, error: qError } = await supabase
        .from("sales_returns")
        .select("*, customers(name), warehouses(name,name_ar)")
        .order("created_at", { ascending: false })
        .limit(100);
      if (qError) throw qError;
      return (data ?? []) as SalesReturn[];
    },
    staleTime: 60_000,
  });

  const refundLabel = useCallback(
    (method: string | null) => paymentMethodLabel(method ?? "cash", isRtl ? "ar" : "en", overrides),
    [isRtl, overrides],
  );

  const customerName = useCallback(
    (r: SalesReturn) => r.customers?.name ?? (isRtl ? "عميل نقدي" : "Walk-in"),
    [isRtl],
  );

  /* ---------------- search ---------------- */
  const searched = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return salesReturns;
    return salesReturns.filter(
      (r) =>
        r.return_number.toLowerCase().includes(q) ||
        (r.customers?.name ?? "").toLowerCase().includes(q) ||
        (r.note ?? "").toLowerCase().includes(q),
    );
  }, [salesReturns, search]);

  /* ---------------- filter ---------------- */
  const filterDefinitions: FilterDefinition[] = useMemo(() => {
    const defs: FilterDefinition[] = [];
    const customerOptions = Array.from(
      new Map(
        salesReturns
          .filter((r) => r.customer_id)
          .map((r) => [
            r.customer_id as string,
            { value: r.customer_id as string, label: r.customers?.name || "—" },
          ]),
      ).values(),
    );
    if (customerOptions.length) {
      defs.push({
        key: "customer_id",
        label: isRtl ? "العميل" : "Customer",
        type: "select",
        options: customerOptions,
      });
    }
    if (hasMultiWarehouse) {
      const whOptions = Array.from(
        new Map(
          salesReturns
            .filter((r) => r.warehouse_id)
            .map((r) => [
              r.warehouse_id as string,
              { value: r.warehouse_id as string, label: whName(r.warehouses) },
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
    const methodOptions = Array.from(
      new Set(salesReturns.map((r) => r.refund_method ?? "cash")),
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
  }, [salesReturns, hasMultiWarehouse, isRtl, whName, refundLabel]);

  const filtered = useMemo(() => {
    return searched.filter((r) => {
      if (filters.customer_id && r.customer_id !== filters.customer_id) return false;
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
    for (const r of salesReturns) {
      const total = Number(r.total) || 0;
      value += total;
      if (new Date(r.created_at).getTime() >= startOfMonth.getTime()) {
        count++;
        month += total;
      }
    }
    return { totalValue: value, thisMonthCount: count, monthValue: month };
  }, [salesReturns]);

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
  const columns = useMemo<DataTableColumn<SalesReturn>[]>(() => {
    const cols: DataTableColumn<SalesReturn>[] = [
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
        key: "customer",
        header: isRtl ? "العميل" : "Customer",
        width: "w-[200px]",
        cell: (r) => <span>{customerName(r)}</span>,
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
      {
        key: "actions",
        header: isRtl ? "طباعة" : "Print",
        align: "end",
        width: "w-[80px]",
        cell: (r) => (
          <IconButton
            size="sm"
            variant="outline"
            tooltip
            ariaLabel={isRtl ? "معاينة وطباعة الإشعار" : "Print return note"}
            icon={<Printer className="size-3.5" />}
            round
            onClick={(event) => {
              event.stopPropagation();
              void openReturnPrint(r);
            }}
          />
        ),
      },
    );
    return cols;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRtl, hasMultiWarehouse, whName, refundLabel, customerName]);

  const rendererProps = (r: SalesReturn) => ({
    row: r,
    isRtl,
    hasMultiWarehouse,
    warehouseName: whName(r.warehouses),
    refundLabel: refundLabel(r.refund_method),
    customerName: customerName(r),
    onPrint: () => void openReturnPrint(r),
  });

  const hasActiveCriteria = Boolean(search.trim()) || Object.keys(filters).length > 0;

  const [previewDoc, setPreviewDoc] = useState<UnifiedDocumentData | null>(null);

  async function openReturnPrint(r: SalesReturn) {
    const { data: items } = await supabase
      .from("sales_return_items")
      .select("quantity, unit_price, total, tax, entered_quantity, entered_unit_price, uom_id, products(name, name_ar, sku), uom:units!sales_return_items_uom_id_fkey(name,name_ar)")
      .eq("return_id", r.id);

    setPreviewDoc({
      docType: "sales_return",
      title: isRtl ? "إشعار دائن — مرتجع مبيعات" : "Sales Return Credit Note",
      number: r.return_number,
      date: r.created_at,
      partyLabel: isRtl ? "العميل" : "Customer",
      partyName: customerName(r),
      warehouse: hasMultiWarehouse ? whName(r.warehouses) : undefined,
      payment: refundLabel(r.refund_method),
      status: isRtl ? "معتمد ومسترد" : "Approved & Refunded",
      lines: (items || []).map((it: any) => ({
        product: (isRtl ? it.products?.name_ar : it.products?.name) || it.products?.name || "صنف",
        qty: Number(it.entered_quantity ?? it.quantity ?? 1),
        unit: it.uom?.name_ar || it.uom?.name || undefined,
        price: Number(it.entered_unit_price ?? it.unit_price ?? 0),
        total: Number(it.total ?? 0),
        tax: Number(it.tax ?? 0),
        code: it.products?.sku || undefined,
      })),
      subtotal: Number(r.subtotal || r.total || 0),
      tax: Number(r.tax || 0),
      discount: 0,
      total: Number(r.total || 0),
      paid: Number(r.total || 0),
      balance: 0,
      currency: "ر.ي",
      notes: r.note || undefined,
    });
  }

  return (
    <div className="space-y-4 pb-12">
      <PageHeader
        title={isRtl ? "مرتجعات المبيعات" : "Sales Returns"}
        subtitle={isRtl ? "سجل وأداء مرتجعات المبيعات والعملاء" : "Track customer sales returns"}
      />

      {/* ─── KPI cards ─── */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <VortexMetricCard
          title={isRtl ? "إجمالي المرتجعات" : "Total returns"}
          value={salesReturns.length}
          subtitle={isRtl ? "المحمّلة حالياً" : "Currently loaded"}
          icon={<RotateCcw className="size-5" />}
          tone="info"
        />
        <VortexMetricCard
          title={isRtl ? "قيمة المرتجعات" : "Returns value"}
          value={money(totalValue)}
          subtitle={isRtl ? "إجمالي المرتجعات من العملاء" : "Total refunded to customers"}
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
        lang={lang}
        search={{
          value: search,
          onValueChange: setSearch,
          placeholder: isRtl
            ? "ابحث برقم المرتجع أو اسم العميل أو الملاحظة..."
            : "Search return #, customer or note…",
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
          <PrimaryAction
            label={isRtl ? "مرتجع مبيعات جديد" : "New Sales Return"}
            icon={<Plus />}
            onClick={() => setNewReturnOpen(true)}
          />
        }
      />

      {/* ─── Records: cards / list / classic table — shared scaffold ─── */}
      <RecordsView<SalesReturn>
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
        renderCard={(r) => <SalesReturnCard {...rendererProps(r)} />}
        renderListRow={(r) => <SalesReturnListRow {...rendererProps(r)} />}
        empty={{
          icon: <RotateCcw />,
          title: hasActiveCriteria
            ? isRtl
              ? "لا توجد مرتجعات مطابقة"
              : "No matching returns"
            : isRtl
              ? "لا توجد مرتجعات مبيعات"
              : "No sales returns",
          description: hasActiveCriteria
            ? isRtl
              ? "جرّب تعديل البحث أو الفلاتر."
              : "Try adjusting your search or filters."
            : isRtl
              ? "سجّل مرتجع مبيعات جديداً لبدء التتبع."
              : "Record a new sales return to start tracking.",
          action: (
            <button
              type="button"
              onClick={() => setNewReturnOpen(true)}
              className="mt-2 inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-xs font-bold text-primary-foreground shadow-sm transition hover:bg-primary/90 active:scale-95"
            >
              <Plus className="size-4" />
              <span>{isRtl ? "إضافة مرتجع مبيعات جديد" : "Add New Sales Return"}</span>
            </button>
          ),
        }}
      />

      <NewSalesReturn
        open={newReturnOpen}
        onOpenChange={setNewReturnOpen}
        onSaved={() => qc.invalidateQueries({ queryKey: ["sales-returns"] })}
        hasMultiWarehouse={hasMultiWarehouse}
      />

      {previewDoc && (
        <LuxuryPrintPreviewModal
          open={Boolean(previewDoc)}
          onClose={() => setPreviewDoc(null)}
          doc={previewDoc}
          documentType="sales_return"
          title={isRtl ? "معاينة إشعار مرتجع المبيعات" : "Sales Return Print Preview"}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Sales-return renderers                                             */
/* ------------------------------------------------------------------ */

interface SalesReturnRendererProps {
  row: SalesReturn;
  isRtl: boolean;
  hasMultiWarehouse: boolean;
  warehouseName: string;
  refundLabel: string;
  customerName: string;
  onPrint: () => void;
}

function SalesReturnCard({
  row: r,
  isRtl,
  hasMultiWarehouse,
  warehouseName,
  refundLabel,
  customerName,
  onPrint,
}: SalesReturnRendererProps) {
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
          <div className="truncate text-[11px] text-muted-foreground">{customerName}</div>
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
        <div className="flex items-center gap-2">
          <span className="font-mono text-base font-bold text-primary">
            {money(Number(r.total))}
          </span>
          <IconButton
            size="sm"
            variant="outline"
            tooltip
            ariaLabel={isRtl ? "معاينة وطباعة الإشعار" : "Print return note"}
            icon={<Printer className="size-3.5" />}
            round
            onClick={(event) => {
              event.stopPropagation();
              onPrint();
            }}
          />
        </div>
      </div>
    </div>
  );
}

function SalesReturnListRow({
  row: r,
  isRtl,
  hasMultiWarehouse,
  warehouseName,
  refundLabel,
  customerName,
  onPrint,
}: SalesReturnRendererProps) {
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
            <span className="truncate">{customerName}</span>
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
        <IconButton
          size="sm"
          variant="outline"
          tooltip
          ariaLabel={isRtl ? "معاينة وطباعة الإشعار" : "Print return note"}
          icon={<Printer className="size-3.5" />}
          round
          onClick={(event) => {
            event.stopPropagation();
            onPrint();
          }}
        />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  New Sales Return dialog                                             */
/* ------------------------------------------------------------------ */

function NewSalesReturn({
  open,
  onOpenChange,
  onSaved,
  hasMultiWarehouse,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  onSaved: () => void;
  hasMultiWarehouse?: boolean;
}) {
  const { t, lang } = useI18n();
  const isAr = lang === "ar";
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [warehouseId, setWarehouseId] = useState("");
  const [customerId, setCustomerId] = useState<string>("");
  const [refundMethod, setRefundMethod] = useState("cash");
  const [settlement, setSettlement] = useState<PaymentSettlementSelection>({
    method: "cash",
    paymentMethodId: "cash",
  });
  const [note, setNote] = useState("");
  const [search, setSearch] = useState("");
  const [customerInvoiceId, setCustomerInvoiceId] = useState<string>("");
  const [invoiceDiscountFactor, setInvoiceDiscountFactor] = useState(1);
  const [customerInvoices, setCustomerInvoices] = useState<any[]>([]);
  const [invoiceItems, setInvoiceItems] = useState<any[]>([]);
  const [lines, setLines] = useState<Line[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    Promise.all([
      supabase.from("warehouses").select("id,name,name_ar").eq("is_active", true).order("name"),
      supabase.from("customers").select("id,name").eq("is_active", true).order("name"),
    ]).then(([w, c]) => {
      setWarehouses(w.data ?? []);
      setCustomers(c.data ?? []);
      if (!warehouseId && w.data?.[0]) setWarehouseId(w.data[0].id);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- مقصود: تحديد المستودع الافتراضي مرة واحدة عند الفتح
  }, [open]);

  useEffect(() => {
    if (!customerId) {
      setCustomerInvoices([]);
      setCustomerInvoiceId("");
      setInvoiceItems([]);
      setLines([]);
      return;
    }
    void (async () => {
      const { data, error } = await supabase
        .from("sales_invoices")
        .select(
          "id,invoice_number,total,subtotal,discount,created_at,sales_invoice_items(id,quantity,unit_price,base_unit_price,tax,product_id,uom_id,entered_quantity,entered_unit_price,uom_conversion_factor,uom_quantity_increment,products(id,name,name_ar,sku),uom:units!sales_invoice_items_uom_id_fkey(name,name_ar))",
        )
        .eq("customer_id", customerId)
        .order("created_at", { ascending: false });
      if (error) return;
      const rows = data ?? [];
      setCustomerInvoices(rows);
      const firstId = rows[0]?.id ?? "";
      setCustomerInvoiceId(firstId);
      const firstInvoice = rows[0];
      setInvoiceDiscountFactor(
        firstInvoice?.subtotal > 0
          ? 1 - Math.min(1, Number(firstInvoice.discount ?? 0) / Number(firstInvoice.subtotal))
          : 1,
      );
      const rawItems = (rows[0]?.sales_invoice_items ?? []) as any[];
      let nextItems = rawItems;
      if (firstId) {
        try {
          nextItems = await addReturnableQuantities("sales", firstId, rawItems);
        } catch (returnError) {
          toast.error(translateRpcError(returnError, isAr ? "ar" : "en"));
          return;
        }
      }
      setInvoiceItems(nextItems);
      setLines([]);
    })();
  }, [customerId, lang]);

  useEffect(() => {
    if (!customerInvoiceId) {
      setInvoiceItems([]);
      setLines([]);
      return;
    }
    void (async () => {
      const { data, error } = await supabase
        .from("sales_invoices")
        .select(
          "id,invoice_number,subtotal,discount,sales_invoice_items(id,quantity,unit_price,base_unit_price,tax,product_id,uom_id,entered_quantity,entered_unit_price,uom_conversion_factor,uom_quantity_increment,products(id,name,name_ar,sku),uom:units!sales_invoice_items_uom_id_fkey(name,name_ar))",
        )
        .eq("id", customerInvoiceId)
        .maybeSingle();
      if (error || !data) return;
      let nextItems: any[];
      try {
        nextItems = await addReturnableQuantities(
          "sales",
          customerInvoiceId,
          (data.sales_invoice_items ?? []) as any[],
        );
      } catch (returnError) {
        toast.error(translateRpcError(returnError, isAr ? "ar" : "en"));
        return;
      }
      setInvoiceItems(nextItems);
      setInvoiceDiscountFactor(
        Number(data.subtotal) > 0
          ? 1 - Math.min(1, Number(data.discount ?? 0) / Number(data.subtotal))
          : 1,
      );
      setLines([]);
    })();
  }, [customerInvoiceId, lang]);

  const filtered = useMemo(
    () =>
      invoiceItems
        .filter(
          (item) => {
            const p = item.products;
            if (!p || Number(item.returnable_entered_quantity ?? item.entered_quantity ?? item.quantity ?? 0) <= 0) return false;
            return (
            !search ||
            (p.name ?? "").toLowerCase().includes(search.toLowerCase()) ||
            (p.name_ar ?? "").includes(search) ||
            p.sku?.toLowerCase().includes(search.toLowerCase())
            );
          },
        )
        .slice(0, 8),
    [invoiceItems, search],
  );

  function addLine(item: any) {
    const p = item.products;
    if (!p || !item.id) return;
    setLines((l) => {
      const ex = l.find((x) => x.invoice_item_id === item.id);
      if (ex) return l.map((x) => (x.invoice_item_id === item.id ? { ...x, quantity: Math.min(x.max_quantity, x.quantity + x.quantity_step) } : x));
      const maxQuantity = Number(item.returnable_entered_quantity ?? item.entered_quantity ?? item.quantity ?? 9999);
      const quantityStep = Number(item.returnable_quantity_increment ?? item.uom_quantity_increment ?? 0.001);
      const initialQuantity = Math.min(maxQuantity, Math.ceil(1 / quantityStep) * quantityStep);
      return [
        ...l,
        {
          invoice_item_id: item.id,
          product_id: item.product_id ?? p.id,
          name: lang === "ar" ? p.name_ar || p.name : p.name || p.name_ar,
          quantity: initialQuantity,
          max_quantity: maxQuantity,
          uom_id: item.uom_id ?? null,
          unit_label: item.uom?.name_ar || item.uom?.name || (lang === "ar" ? "وحدة الفاتورة" : "Invoice unit"),
          quantity_step: quantityStep,
          unit_price: Number(item.entered_unit_price ?? item.unit_price ?? 0),
          tax_per_unit:
            (Number(item.tax ?? 0) / Math.max(Number(item.quantity ?? 0), 0.000001)) *
            Number(item.uom_conversion_factor ?? 1),
        },
      ];
    });
    setSearch("");
  }

  function removeLine(invoiceItemId: string) {
    setLines((l) => l.filter((x) => x.invoice_item_id !== invoiceItemId));
  }

  function updateQty(invoiceItemId: string, qty: number) {
    if (qty <= 0) return removeLine(invoiceItemId);
    setLines((l) =>
      l.map((x) => {
        if (x.invoice_item_id !== invoiceItemId) return x;
        const validQty = x.max_quantity > 0 ? Math.min(qty, x.max_quantity) : qty;
        return { ...x, quantity: validQty };
      }),
    );
  }

  const total =
    Math.round(
      lines.reduce((a, l) => a + l.quantity * (l.unit_price * invoiceDiscountFactor + l.tax_per_unit), 0) * 100,
    ) / 100;

  async function save() {
    if (saving) return;
    if (lines.some((line) => Math.abs(line.quantity / line.quantity_step - Math.round(line.quantity / line.quantity_step)) > 1e-7)) {
      toast.error(isAr ? "الكمية يجب أن تطابق خطوة الوحدة المسجلة في الفاتورة الأصلية" : "Quantity must follow the unit increment saved on the original invoice");
      return;
    }
    if (!warehouseId || lines.length === 0) {
      toast.error(t("common.fill_form"));
      return;
    }
    const { data: retData, error } = await supabase.rpc("create_sales_return" as any, {
      _invoice_id: customerInvoiceId || null,
      _warehouse_id: warehouseId,
      _customer_id: customerId || null,
      _refund_method: refundMethod,
      _note: note || null,
      _items: lines as any,
    });
    if (error) {
      // P1-4: رسالة واحدة مترجمة بدل نص PostgreSQL الإنجليزي.
      toast.error(translateRpcError(error, lang === "ar" ? "ar" : "en"));
      return;
    }
    const returnId = typeof retData === "string" ? retData : (retData as any)?.id;
    if (
      returnId &&
      (settlement.cashboxId ||
        settlement.bankAccountId ||
        settlement.paymentMethodId ||
        settlement.reference)
    ) {
      try {
        await (supabase as any)
          .from("sales_returns")
          .update({
            cashbox_id: settlement.cashboxId || null,
            bank_account_id: settlement.bankAccountId || null,
            payment_method_id: settlement.paymentMethodId || refundMethod || null,
            payment_reference: settlement.reference || null,
          })
          .eq("id", returnId);
      } catch (e) {
        console.warn("Could not set treasury settlement on sales_return:", e);
      }
    }
    toast.success(
      lang === "ar" ? "تم تسجيل مرتجع المبيعات بنجاح" : "Sales return recorded successfully",
    );
    onOpenChange(false);
    setLines([]);
    setNote("");
    onSaved();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button className="hidden">{lang === "ar" ? "إظهار" : "Show"}</Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{lang === "ar" ? "إنشاء مرتجع مبيعات" : "New Sales Return"}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div
            className={`grid grid-cols-1 ${
              hasMultiWarehouse ? "sm:grid-cols-4" : "sm:grid-cols-3"
            } gap-3`}
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
                        {isAr ? w.name_ar || w.name : w.name || w.name_ar}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="grid gap-1.5">
              <Label>{lang === "ar" ? "العميل" : "Customer"}</Label>
              <Select value={customerId} onValueChange={setCustomerId}>
                <SelectTrigger>
                  <SelectValue
                    placeholder={lang === "ar" ? "اختر العميل..." : "Select customer..."}
                  />
                </SelectTrigger>
                <SelectContent>
                  {customers.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>{lang === "ar" ? "الفاتورة" : "Invoice"}</Label>
              <Select value={customerInvoiceId} onValueChange={setCustomerInvoiceId}>
                <SelectTrigger>
                  <SelectValue
                    placeholder={lang === "ar" ? "اختر الفاتورة..." : "Select invoice..."}
                  />
                </SelectTrigger>
                <SelectContent>
                  {!customerId && (
                    <div className="px-3 py-2 text-xs text-muted-foreground">
                      {lang === "ar" ? "اختر العميل أولاً" : "Choose a customer first"}
                    </div>
                  )}
                  {customerInvoices.map((inv) => (
                    <SelectItem key={inv.id} value={inv.id}>
                      {inv.invoice_number} · {money(Number(inv.total))}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5 sm:col-span-2">
              <Label>{lang === "ar" ? "طريقة ومصدر الاسترداد" : "Refund method & source"}</Label>
              <DynamicPaymentSelector
                context="sales_returns"
                value={refundMethod}
                onChange={setRefundMethod}
                settlement={settlement}
                onSettlementChange={setSettlement}
                includeCredit
                compact
              />
            </div>
          </div>

          <div className="relative">
            <Label className="mb-1.5 block">
              {lang === "ar" ? "إضافة أصناف المرتجع" : "Add Return Items"}
            </Label>
            <div className="relative">
              <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder={lang === "ar" ? "ابحث بالاسم أو الرمز..." : "Search product or SKU..."}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="ps-9"
              />
            </div>
            {search && filtered.length > 0 && (
              <div className="absolute z-20 mt-1 w-full rounded-md border border-border bg-popover shadow-lg max-h-60 overflow-auto">
                {filtered.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className="flex w-full items-center justify-between px-3 py-2 text-sm hover:bg-accent text-start"
                    onClick={() => addLine(item)}
                  >
                    <span>{isAr ? item.products?.name_ar || item.products?.name : item.products?.name || item.products?.name_ar}</span>
                    <span className="font-mono text-xs text-muted-foreground">
                      {money(Number(item.entered_unit_price ?? item.unit_price ?? 0))}
                    </span>
                  </button>
                ))}
              </div>
            )}
            {invoiceItems.length > 0 && !search && (
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {invoiceItems.map((item: any) => {
                  const label =
                    lang === "ar"
                      ? item.products?.name_ar || item.products?.name
                      : item.products?.name || item.products?.name_ar;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => addLine(item)}
                      className="rounded-xl border border-border bg-surface px-3 py-2 text-left text-sm hover:border-primary/40 hover:bg-primary/5"
                    >
                      <div className="font-medium">{label}</div>
                      <div className="mt-1 flex items-center justify-between text-[11px] text-muted-foreground">
                        <span>{item.products?.sku ?? "—"}</span>
                        <span>
                          {Number(item.returnable_entered_quantity ?? item.entered_quantity ?? item.quantity)} {item.uom?.name_ar || item.uom?.name || (lang === "ar" ? "وحدة الفاتورة" : "Invoice unit")}
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
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-start font-semibold">
                      {lang === "ar" ? "المنتج" : "Product"}
                    </th>
                    <th className="px-3 py-2 text-start font-semibold">
                      {lang === "ar" ? "الكمية" : "Qty"}
                    </th>
                    <th className="px-3 py-2 text-start font-semibold">
                      {lang === "ar" ? "السعر" : "Price"}
                    </th>
                    <th className="px-3 py-2 text-end font-semibold">
                      {lang === "ar" ? "الإجمالي" : "Total"}
                    </th>
                    <th className="px-3 py-2 text-end"></th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l) => (
                    <tr key={l.invoice_item_id} className="border-t border-border/60">
                      <td className="px-3 py-2 font-medium">{l.name}<span className="ms-2 text-xs text-muted-foreground">{l.unit_label}</span></td>
                      <td className="px-3 py-2">
                        {/* الكمية المُوحّدة: أرقام في المنتصف، بلا عجلة ماوس. */}
                        <QuantityInput
                          decimals={quantityIncrementDecimals(l.quantity_step)}
                          displayDecimals={quantityIncrementDecimals(l.quantity_step)}
                          min={l.quantity_step}
                          aria-label={lang === "ar" ? "الكمية" : "Quantity"}
                          value={l.quantity}
                          onValueChange={(v) => updateQty(l.invoice_item_id, v == null ? l.quantity_step : v)}
                          className="h-8 w-20"
                        />
                      </td>
                      <td className="px-3 py-2 font-mono">{money(l.unit_price)}</td>
                      <td className="px-3 py-2 text-end font-mono font-semibold">
                        {money(l.quantity * (l.unit_price * invoiceDiscountFactor + l.tax_per_unit))}
                      </td>
                      <td className="px-3 py-2 text-end">
                        <button
                          type="button"
                          onClick={() => removeLine(l.invoice_item_id)}
                          className="text-destructive hover:opacity-80"
                          aria-label={lang === "ar" ? "حذف السطر" : "Remove line"}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
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
              <Button variant="outline" disabled={saving} onClick={() => onOpenChange(false)}>
                {t("common.cancel")}
              </Button>
              <Button onClick={save} disabled={saving} className="disabled:opacity-50">
                {saving && <Loader2 className="h-4 w-4 me-1.5 animate-spin" />}
                {saving ? (lang === "ar" ? "جاري الحفظ..." : "Saving...") : t("common.save")}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

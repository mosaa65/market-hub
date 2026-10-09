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
  Printer,
  Receipt,
  FileDown,
  Copy,
  Check,
  MessageSquare,
  RefreshCw,
  FileText,
  AlertCircle,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import { money } from "@/lib/format";
import { toSystemDigits } from "@/lib/format-preferences";
import { Ltr } from "@/components/ltr-value";
import { LuxuryPrintPreviewModal } from "@/components/luxury-print-preview-modal";
import { WhatsAppIcon } from "@/components/whatsapp-icon";
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
  note?: string | null;
  suppliers: { name: string; phone?: string | null } | null;
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
  products: { id?: string; name: string; name_ar?: string | null; sku: string | null } | null;
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
  const [loadingLines, setLoadingLines] = useState(false);
  const [creating, setCreating] = useState(false);
  const [copiedInvoiceId, setCopiedInvoiceId] = useState<string | null>(null);
  const [directPrintInvoice, setDirectPrintInvoice] = useState<Invoice | null>(null);
  const [directPrintLines, setDirectPrintLines] = useState<Line[]>([]);

  /*
   * Column-header sorting for the classic table, kept separate from the
   * toolbar preset (`sortKey`).
   */
  const [sort, setSort] = useState<DataTableSort | null>(null);
  const breakpoint = useBreakpoint();
  const tableUsesHorizontalScroll =
    breakpoint === "xs" || breakpoint === "sm" || breakpoint === "md";

  const copyInvoiceNumber = (invoiceNumber: string, id: string) => {
    navigator.clipboard.writeText(invoiceNumber);
    setCopiedInvoiceId(id);
    toast.success(isRtl ? "تم نسخ رقم الفاتورة" : "Invoice number copied");
    setTimeout(() => setCopiedInvoiceId(null), 2000);
  };

  const shareInvoiceWhatsApp = (inv: Invoice) => {
    const phone = inv.suppliers?.phone;
    if (!phone || !phone.trim()) {
      toast.warning(
        isRtl
          ? "هذا المورد لا يوجد لديه رقم هاتف مسجل في النظام"
          : "This supplier has no phone number registered",
      );
      return;
    }
    const remaining = Math.max(0, Number(inv.total) - Number(inv.paid));
    const text = isRtl
      ? `فاتورة مشتريات رقم ${inv.invoice_number}\nالمورد: ${inv.suppliers?.name || ""}\nالتاريخ: ${new Date(inv.created_at).toLocaleDateString("ar-YE")}\nالإجمالي: ${money(Number(inv.total))}\nالمدفوع: ${money(Number(inv.paid))}${remaining > 0 ? `\nالمتبقي: ${money(remaining)}` : ""}`
      : `Purchase Invoice #${inv.invoice_number}\nSupplier: ${inv.suppliers?.name || ""}\nTotal: ${money(Number(inv.total))}\nPaid: ${money(Number(inv.paid))}${remaining > 0 ? `\nRemaining: ${money(remaining)}` : ""}`;
    const clean = phone.replace(/[^\d+]/g, "");
    const target = clean.startsWith("+") ? clean.slice(1) : clean;
    window.open(`https://wa.me/${target}?text=${encodeURIComponent(text)}`, "_blank");
  };

  const shareInvoiceSms = (inv: Invoice) => {
    const phone = inv.suppliers?.phone;
    if (!phone || !phone.trim()) {
      toast.warning(
        isRtl
          ? "هذا المورد لا يوجد لديه رقم هاتف مسجل في النظام"
          : "This supplier has no phone number registered",
      );
      return;
    }
    const remaining = Math.max(0, Number(inv.total) - Number(inv.paid));
    const text = isRtl
      ? `فاتورة مشتريات #${inv.invoice_number} - المورد: ${inv.suppliers?.name || ""} - الإجمالي: ${money(Number(inv.total))} - المتبقي: ${money(remaining)}`
      : `Purchase #${inv.invoice_number} - Total: ${money(Number(inv.total))} - Due: ${money(remaining)}`;
    const clean = phone.replace(/[^\d+]/g, "");
    window.open(`sms:${clean}?body=${encodeURIComponent(text)}`, "_blank");
  };

  async function load() {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("purchase_invoices")
        .select(
          "id,invoice_number,status,subtotal,discount,tax,total,paid,payment_method,created_at,note,suppliers(name,phone),warehouses(name,name_ar)",
        )
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) {
        console.error("Error loading purchases:", error);
        toast.error(isRtl ? "تعذر تحميل فواتير المشتريات" : "Failed to load purchases");
      }
      setRows((data ?? []) as any);
    } catch (err) {
      console.error("Failed to load purchases:", err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function openInvoice(inv: Invoice) {
    setSelected(inv);
    setLoadingLines(true);
    try {
      const { data, error } = await supabase
        .from("purchase_invoice_items")
        .select("id,quantity,unit_cost,tax,total,products(id,name,name_ar,sku)")
        .eq("invoice_id", inv.id);
      if (error) {
        console.error("Error loading purchase items:", error);
      }
      setLines((data ?? []) as any);
    } catch (err) {
      console.error("Failed to load invoice items:", err);
      setLines([]);
    } finally {
      setLoadingLines(false);
    }
  }

  async function openDirectPrint(inv: Invoice) {
    setDirectPrintInvoice(inv);
    try {
      const { data } = await supabase
        .from("purchase_invoice_items")
        .select("id,quantity,unit_cost,tax,total,products(id,name,name_ar,sku)")
        .eq("invoice_id", inv.id);
      setDirectPrintLines((data ?? []) as any);
    } catch (err) {
      console.error("Failed to load print items:", err);
      setDirectPrintLines([]);
    }
  }

  const pmLabel = useCallback(
    (m: string) => {
      const map: Record<string, string> = {
        cash: t("pos.pm.cash"),
        card: t("pos.pm.card"),
        bank_transfer: t("pos.pm.bank"),
        bank: t("pos.pm.bank"),
        credit: t("pos.pm.credit"),
      };
      return map[m] ?? m;
    },
    [t],
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

  const statusBadge = (s: string) => {
    const map: Record<string, { bg: string; text: string; dot: string; label: string }> = {
      paid: {
        bg: "bg-emerald-500/10 border-emerald-500/30",
        text: "text-emerald-500",
        dot: "bg-emerald-500",
        label: t("sales.status.paid"),
      },
      partial: {
        bg: "bg-amber-500/10 border-amber-500/30",
        text: "text-amber-500",
        dot: "bg-amber-500",
        label: t("sales.status.partial"),
      },
      unpaid: {
        bg: "bg-rose-500/10 border-rose-500/30",
        text: "text-rose-500",
        dot: "bg-rose-500",
        label: t("sales.status.unpaid"),
      },
      cancelled: {
        bg: "bg-muted/40 border-border/80",
        text: "text-muted-foreground",
        dot: "bg-muted-foreground",
        label: t("sales.status.cancelled"),
      },
    };
    const c = map[s] ?? {
      bg: "bg-surface-2",
      text: "text-foreground",
      dot: "bg-foreground",
      label: s,
    };
    return (
      <span
        className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${c.bg} ${c.text}`}
      >
        <span className={`size-1.5 rounded-full ${c.dot}`} />
        <span>{c.label}</span>
      </span>
    );
  };

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
      { value: "date_desc", label: isRtl ? "الأحدث أولاً" : "Newest first" },
      { value: "date_asc", label: isRtl ? "الأقدم أولاً" : "Oldest first" },
      { value: "total_desc", label: isRtl ? "الأعلى قيمة" : "Highest value" },
      { value: "total_asc", label: isRtl ? "الأقل قيمة" : "Lowest value" },
    ],
    [isRtl],
  );

  const filtered = useMemo(() => {
    let list = rows;

    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((r) => {
        const invNum = r.invoice_number?.toLowerCase() || "";
        const sup = r.suppliers?.name?.toLowerCase() || "";
        const phone = r.suppliers?.phone?.toLowerCase() || "";
        const note = r.note?.toLowerCase() || "";
        return (
          invNum.includes(q) ||
          sup.includes(q) ||
          phone.includes(q) ||
          note.includes(q)
        );
      });
    }

    if (statusTab !== "all") {
      list = list.filter((r) => r.status === statusTab);
    }

    if (filters.status) {
      list = list.filter((r) => r.status === filters.status);
    }

    if (filters.payment_method) {
      list = list.filter((r) => r.payment_method === filters.payment_method);
    }

    if (filters.created_at && typeof filters.created_at === "object") {
      const { from, to } = filters.created_at as { from?: string; to?: string };
      if (from) {
        const fromDate = new Date(from).getTime();
        list = list.filter((r) => new Date(r.created_at).getTime() >= fromDate);
      }
      if (to) {
        const toDate = new Date(to).getTime();
        list = list.filter((r) => new Date(r.created_at).getTime() <= toDate);
      }
    }

    list = [...list].sort((a, b) => {
      if (sort) {
        const aVal = sort.key === "created_at" ? new Date(a.created_at).getTime() : (a as any)[sort.key];
        const bVal = sort.key === "created_at" ? new Date(b.created_at).getTime() : (b as any)[sort.key];
        if (aVal == null && bVal == null) return 0;
        if (aVal == null) return 1;
        if (bVal == null) return -1;
        const cmp = aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
        return sort.direction === "asc" ? cmp : -cmp;
      }

      switch (sortKey) {
        case "date_asc":
          return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
        case "total_desc":
          return Number(b.total) - Number(a.total);
        case "total_asc":
          return Number(a.total) - Number(b.total);
        case "date_desc":
        default:
          return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      }
    });

    return list;
  }, [rows, search, statusTab, filters, sort, sortKey]);

  const metrics = useMemo(() => {
    let totalValue = 0;
    let totalPaid = 0;
    let totalPending = 0;
    let paidCount = 0;
    let partialCount = 0;
    let unpaidCount = 0;
    let cancelledCount = 0;

    for (const r of rows) {
      const tot = Number(r.total) || 0;
      const pd = Number(r.paid) || 0;
      const rem = Math.max(0, tot - pd);

      if (r.status !== "cancelled") {
        totalValue += tot;
        totalPaid += pd;
        totalPending += rem;
      }

      if (r.status === "paid") paidCount++;
      else if (r.status === "partial") partialCount++;
      else if (r.status === "unpaid") unpaidCount++;
      else if (r.status === "cancelled") cancelledCount++;
    }

    const activeCount = rows.length - cancelledCount;
    const avgTicket = activeCount > 0 ? totalValue / activeCount : 0;

    return {
      totalCount: rows.length,
      totalValue,
      totalPaid,
      totalPending,
      paidCount,
      partialCount,
      unpaidCount,
      cancelledCount,
      avgTicket,
    };
  }, [rows]);

  const columns: DataTableColumn<Invoice>[] = useMemo(() => {
    const cols: DataTableColumn<Invoice>[] = [
      {
        key: "invoice_number",
        header: isRtl ? "رقم الفاتورة" : "Invoice #",
        sortable: true,
        width: "w-[170px]",
        sortValue: (inv) => inv.invoice_number,
        cell: (inv) => (
          <div className="flex items-center gap-1.5 font-mono text-xs font-bold text-foreground">
            <span>{inv.invoice_number}</span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                copyInvoiceNumber(inv.invoice_number, inv.id);
              }}
              className="rounded p-1 text-muted-foreground hover:text-foreground"
              title={isRtl ? "نسخ" : "Copy"}
            >
              {copiedInvoiceId === inv.id ? (
                <Check className="h-3 w-3 text-emerald-500" />
              ) : (
                <Copy className="h-3 w-3" />
              )}
            </button>
          </div>
        ),
      },
      {
        key: "created_at",
        header: isRtl ? "التاريخ والوقت" : "Date & Time",
        sortable: true,
        width: "w-[180px]",
        sortValue: (inv) => new Date(inv.created_at).getTime(),
        cell: (inv) => (
          <VortexDateBadge date={inv.created_at} variant="formal" size="sm" showTime />
        ),
      },
      {
        key: "supplier",
        header: t("common.supplier"),
        sortable: true,
        width: "w-[180px]",
        sortValue: (inv) => inv.suppliers?.name ?? "",
        cell: (inv) => (
          <div className="flex flex-col">
            <span className="truncate font-medium text-foreground">
              {inv.suppliers?.name ?? "—"}
            </span>
            {inv.suppliers?.phone && (
              <span className="dir-ltr truncate font-mono text-[10px] text-muted-foreground">
                {toSystemDigits(inv.suppliers.phone)}
              </span>
            )}
          </div>
        ),
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
          <span className="truncate text-xs text-muted-foreground">
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
        width: "w-[130px]",
        cell: (inv) => (
          <div className="inline-flex items-center gap-1 pe-2" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              disabled={!inv.suppliers?.phone}
              onClick={() => shareInvoiceWhatsApp(inv)}
              className={`rounded-lg p-1.5 transition ${
                inv.suppliers?.phone
                  ? "text-muted-foreground hover:bg-surface-2 hover:text-emerald-500 cursor-pointer"
                  : "text-muted-foreground/30 cursor-not-allowed opacity-50"
              }`}
              title={isRtl ? "واتساب للمورد" : "WhatsApp"}
            >
              <WhatsAppIcon className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => void openDirectPrint(inv)}
              className="rounded-lg p-1.5 text-muted-foreground hover:bg-surface-2 hover:text-foreground transition"
              title={isRtl ? "طباعة" : "Print"}
            >
              <Printer className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => void openInvoice(inv)}
              className="rounded-lg p-1.5 text-muted-foreground hover:bg-surface-2 hover:text-foreground transition"
              title={isRtl ? "عرض التفاصيل" : "View Details"}
            >
              <Eye className="h-4 w-4" />
            </button>
          </div>
        ),
      },
    );

    return cols;
  }, [isRtl, hasMultiWarehouse, t, copiedInvoiceId]);

  return (
    <div className="space-y-5 pb-12">
      {/* ─── Unified Top Header — Matches Sales and POS styling ─── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl sm:text-2xl font-black text-foreground tracking-tight">
              {t("purchases.title")}
            </h1>
            <span className="inline-flex items-center rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-semibold text-primary">
              {toSystemDigits(rows.length.toString())}
            </span>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            {t("purchases.subtitle") || (isRtl ? "إدارة وتتبع فواتير المشتريات والتوريد والموردين" : "Manage and track purchase invoices, supplies, and vendors")}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => void load()}
            disabled={loading}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-surface px-3 text-xs font-medium text-foreground hover:bg-surface-2 transition disabled:opacity-50"
            title={isRtl ? "تحديث الفواتير" : "Refresh"}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            <span className="hidden sm:inline">{isRtl ? "تحديث" : "Refresh"}</span>
          </button>

          <Link
            to="/purchase-pos"
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/10 px-3 text-xs font-semibold text-primary hover:bg-primary/20 transition"
          >
            <ShoppingCart className="h-3.5 w-3.5 text-primary" />
            <span>{isRtl ? "شراء سريع (POS)" : "Fast Purchase"}</span>
          </Link>

          <button
            type="button"
            onClick={() => setCreating(true)}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3.5 text-xs font-semibold text-primary-foreground shadow-sm hover:opacity-90 transition"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>{t("purchases.newInvoice") || (isRtl ? "فاتورة شراء جديدة" : "New Purchase")}</span>
          </button>
        </div>
      </div>

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
            ? "ابحث برقم الفاتورة، المورد، الهاتف..."
            : "Search PO number, supplier, phone...",
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
            label={isRtl ? "فاتورة شراء جديدة" : "New Purchase"}
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
        /* ─── 1 Column on Mobile, 2 on SM, 3 on LG, 4 on XL — spacious, breathable, high-end ─── */
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
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
                className="card-mullak group relative flex cursor-pointer flex-col justify-between overflow-hidden rounded-2xl p-3.5 transition-all duration-200 hover:shadow-md sm:p-4.5"
              >
                <div>
                  {/* Header: PO number + Copy + status */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1">
                        <span className="truncate font-mono text-sm font-bold text-foreground transition group-hover:text-primary">
                          {inv.invoice_number}
                        </span>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            copyInvoiceNumber(inv.invoice_number, inv.id);
                          }}
                          className="grid size-7 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-surface-2 hover:text-foreground transition"
                          aria-label={isRtl ? "نسخ رقم الفاتورة" : "Copy invoice number"}
                        >
                          {copiedInvoiceId === inv.id ? (
                            <Check className="h-3.5 w-3.5 text-emerald-500" />
                          ) : (
                            <Copy className="h-3.5 w-3.5" />
                          )}
                        </button>
                      </div>
                      <div className="mt-1">
                        <VortexDateBadge date={inv.created_at} variant="formal" size="sm" showTime />
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
                      <div className="min-w-0">
                        <div className="truncate font-medium text-foreground">{supplierName}</div>
                        {inv.suppliers?.phone && (
                          <div className="dir-ltr truncate font-mono text-[10px] text-muted-foreground">
                            {toSystemDigits(inv.suppliers.phone)}
                          </div>
                        )}
                      </div>
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
                        <span>{isRtl ? "المتبقي للمورد" : "Due to Supplier"}</span>
                        <span className="truncate font-mono">
                          <Ltr>{money(remaining)}</Ltr>
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Actions Footer */}
                <div
                  className="mt-3.5 flex items-center justify-between gap-2 border-t border-border/60 pt-3"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      disabled={!inv.suppliers?.phone}
                      onClick={() => shareInvoiceWhatsApp(inv)}
                      className={`grid size-8 place-items-center rounded-lg border transition ${
                        inv.suppliers?.phone
                          ? "border-border/70 text-muted-foreground hover:bg-surface-2 hover:text-emerald-500 cursor-pointer"
                          : "border-border/40 text-muted-foreground/30 cursor-not-allowed opacity-50"
                      }`}
                      title={
                        !inv.suppliers?.phone
                          ? isRtl
                            ? "هذا المورد لا يوجد لديه رقم هاتف مسجل"
                            : "No phone registered"
                          : isRtl
                            ? "مشاركة عبر واتساب"
                            : "Share via WhatsApp"
                      }
                    >
                      <WhatsAppIcon className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      disabled={!inv.suppliers?.phone}
                      onClick={() => shareInvoiceSms(inv)}
                      className={`grid size-8 place-items-center rounded-lg border transition ${
                        inv.suppliers?.phone
                          ? "border-border/70 text-muted-foreground hover:bg-surface-2 hover:text-blue-500 cursor-pointer"
                          : "border-border/40 text-muted-foreground/30 cursor-not-allowed opacity-50"
                      }`}
                      title={
                        !inv.suppliers?.phone
                          ? isRtl
                            ? "هذا المورد لا يوجد لديه رقم هاتف مسجل"
                            : "No phone registered"
                          : isRtl
                            ? "مشاركة عبر SMS"
                            : "Share via SMS"
                      }
                    >
                      <MessageSquare className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => void openInvoice(inv)}
                      className="grid size-8 place-items-center rounded-lg border border-border/70 text-muted-foreground transition hover:bg-surface-2 hover:text-foreground"
                      title={isRtl ? "عرض التفاصيل" : "View Details"}
                    >
                      <Eye className="h-4 w-4" />
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => void openDirectPrint(inv)}
                    className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-surface px-3 text-xs font-medium text-foreground transition hover:bg-surface-2"
                  >
                    <Printer className="h-3.5 w-3.5" />
                    <span>{isRtl ? "طباعة" : "Print"}</span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      ) : viewMode === "list" ? (
        /* ─── Luxury Row-Cards View (List with Accent Strip) ─── */
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
                    <Receipt className="size-5" />
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
                      {inv.suppliers?.phone && (
                        <span className="dir-ltr truncate font-mono text-muted-foreground/80">
                          {toSystemDigits(inv.suppliers.phone)}
                        </span>
                      )}
                      <VortexDateBadge date={inv.created_at} variant="formal" size="sm" showTime />
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
                    <button
                      type="button"
                      disabled={!inv.suppliers?.phone}
                      onClick={() => shareInvoiceWhatsApp(inv)}
                      className={`rounded-lg p-1.5 transition ${
                        inv.suppliers?.phone
                          ? "text-muted-foreground hover:bg-surface-2 hover:text-emerald-500 cursor-pointer"
                          : "text-muted-foreground/30 cursor-not-allowed opacity-50"
                      }`}
                      title={isRtl ? "واتساب للمورد" : "WhatsApp"}
                    >
                      <WhatsAppIcon className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      disabled={!inv.suppliers?.phone}
                      onClick={() => shareInvoiceSms(inv)}
                      className={`rounded-lg p-1.5 transition ${
                        inv.suppliers?.phone
                          ? "text-muted-foreground hover:bg-surface-2 hover:text-blue-500 cursor-pointer"
                          : "text-muted-foreground/30 cursor-not-allowed opacity-50"
                      }`}
                      title={isRtl ? "رسالة SMS" : "SMS"}
                    >
                      <MessageSquare className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => void openDirectPrint(inv)}
                      className="rounded-lg p-1.5 text-muted-foreground hover:bg-surface-2 hover:text-foreground transition"
                      title={isRtl ? "طباعة" : "Print"}
                    >
                      <Printer className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => void openInvoice(inv)}
                      className="rounded-lg p-1.5 text-muted-foreground hover:bg-surface-2 hover:text-foreground transition"
                      title={isRtl ? "تفاصيل" : "Details"}
                    >
                      <Eye className="h-4 w-4" />
                    </button>
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

      {/* ─── Luxury Invoice Details Drawer (Unified with Sales Drawer) ─── */}
      {selected && (
        <ViewDialog
          invoice={selected}
          lines={lines}
          loadingLines={loadingLines}
          onClose={() => setSelected(null)}
          pmLabel={pmLabel}
          statusLabel={statusLabel}
          hasMultiWarehouse={hasMultiWarehouse}
          onWhatsApp={() => shareInvoiceWhatsApp(selected)}
          onSms={() => shareInvoiceSms(selected)}
          copyInvoiceNumber={copyInvoiceNumber}
          copiedInvoiceId={copiedInvoiceId}
        />
      )}

      {/* Direct print modal when opened from card or table */}
      {directPrintInvoice && (
        <LuxuryPrintPreviewModal
          open={Boolean(directPrintInvoice)}
          onClose={() => setDirectPrintInvoice(null)}
          doc={{
            docType: "purchase_invoice",
            title: t("purchases.title") || "فاتورة مشتريات وتوريد",
            number: directPrintInvoice.invoice_number,
            date: new Date(directPrintInvoice.created_at).toLocaleString(lang === "ar" ? "ar-EG" : "en-US"),
            partyLabel: t("common.supplier") || "المورد",
            partyName: directPrintInvoice.suppliers?.name ?? "",
            partyPhone: directPrintInvoice.suppliers?.phone ?? "",
            warehouse: hasMultiWarehouse ? whName(directPrintInvoice.warehouses) : undefined,
            payment: pmLabel(directPrintInvoice.payment_method),
            status: statusLabel(directPrintInvoice.status),
            lines: directPrintLines.map((l) => ({
              product: l.products?.name_ar || l.products?.name || "—",
              qty: Number(l.quantity),
              price: Number(l.unit_cost),
              total: Number(l.total),
              code: l.products?.sku || undefined,
            })),
            subtotal: Number(directPrintInvoice.subtotal),
            tax: Number(directPrintInvoice.tax),
            discount: Number(directPrintInvoice.discount),
            total: Number(directPrintInvoice.total),
            paid: Number(directPrintInvoice.paid),
            balance: Math.max(0, Number(directPrintInvoice.total) - Number(directPrintInvoice.paid)),
          }}
          documentType="purchase_invoice"
          title={
            lang === "ar" ? "معاينة وطباعة فاتورة المشتريات" : "Purchase Invoice Print Preview"
          }
          defaultFormat="standard"
          customerName={directPrintInvoice.suppliers?.name ?? undefined}
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
  loadingLines,
  onClose,
  pmLabel,
  statusLabel,
  hasMultiWarehouse,
  onWhatsApp,
  onSms,
  copyInvoiceNumber,
  copiedInvoiceId,
}: {
  invoice: Invoice;
  lines: Line[];
  loadingLines: boolean;
  onClose: () => void;
  pmLabel: (m: string) => string;
  statusLabel: (s: string) => string;
  hasMultiWarehouse?: boolean;
  onWhatsApp: () => void;
  onSms: () => void;
  copyInvoiceNumber: (num: string, id: string) => void;
  copiedInvoiceId: string | null;
}) {
  const { t, lang } = useI18n();
  const isRtl = lang === "ar";
  const [previewOpen, setPreviewOpen] = useState(false);
  const wh = invoice.warehouses;
  const whLabel = !wh ? "—" : lang === "ar" ? wh.name_ar || wh.name : wh.name || wh.name_ar || "—";
  const supplierName = invoice.suppliers?.name ?? (isRtl ? "مورد عام" : "General Vendor");
  const remaining = Math.max(0, Number(invoice.total) - Number(invoice.paid));

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-end bg-black/65 backdrop-blur-xs animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="h-full w-full max-w-2xl border-s border-border/80 bg-background/95 backdrop-blur-md p-6 shadow-2xl overflow-y-auto animate-in slide-in-from-left duration-200 relative flex flex-col justify-between"
        onClick={(e) => e.stopPropagation()}
        dir={isRtl ? "rtl" : "ltr"}
      >
        {/* Ambient decorative glow */}
        <div className="absolute -top-12 -right-12 size-48 rounded-full bg-primary/20 blur-3xl pointer-events-none" />

        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-border/80 bg-surface-2/40 px-6 py-4 -mx-6 -mt-6 mb-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Receipt className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-mono text-lg font-bold text-foreground">
                  {invoice.invoice_number}
                </h3>
                <button
                  type="button"
                  onClick={() => copyInvoiceNumber(invoice.invoice_number, invoice.id)}
                  className="rounded p-1 text-muted-foreground hover:text-foreground"
                >
                  {copiedInvoiceId === invoice.id ? (
                    <Check className="h-3.5 w-3.5 text-emerald-500" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                </button>
              </div>
              <div className="mt-0.5">
                <VortexDateBadge date={invoice.created_at} variant="formal" showTime />
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="rounded-lg p-1.5 text-muted-foreground hover:bg-surface-2 hover:text-foreground"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto space-y-5">
          {/* Info Grid */}
          <div
            className={`grid gap-3 rounded-xl border border-border/80 bg-surface-2/30 p-4 text-xs ${
              hasMultiWarehouse ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-1 sm:grid-cols-3"
            }`}
          >
            <div>
              <span className="text-[10px] uppercase font-semibold text-muted-foreground">
                {isRtl ? "المورد" : "Supplier"}
              </span>
              <p className="mt-0.5 text-sm font-semibold text-foreground">
                {supplierName}
              </p>
              {invoice.suppliers?.phone && (
                <p className="text-[11px] text-muted-foreground dir-ltr font-mono">
                  {toSystemDigits(invoice.suppliers.phone)}
                </p>
              )}
            </div>

            {hasMultiWarehouse && (
              <div>
                <span className="text-[10px] uppercase font-semibold text-muted-foreground">
                  {isRtl ? "المستودع / الفرع" : "Warehouse"}
                </span>
                <p className="mt-0.5 text-sm font-semibold text-foreground">
                  {whLabel}
                </p>
              </div>
            )}

            <div>
              <span className="text-[10px] uppercase font-semibold text-muted-foreground">
                {isRtl ? "طريقة السداد" : "Payment Method"}
              </span>
              <p className="mt-0.5 text-sm font-medium text-foreground">
                {pmLabel(invoice.payment_method)}
              </p>
            </div>

            <div>
              <span className="text-[10px] uppercase font-semibold text-muted-foreground">
                {isRtl ? "حالة الفاتورة" : "Status"}
              </span>
              <p className="mt-0.5 text-sm font-semibold text-foreground">
                {statusLabel(invoice.status)}
              </p>
            </div>
          </div>

          {/* Note / Terms if present */}
          {invoice.note && (
            <div className="rounded-xl border border-border/80 bg-surface-2/40 p-3 text-xs text-muted-foreground">
              <span className="font-semibold text-foreground me-1">
                {isRtl ? "الملاحظات وشروط التوريد:" : "Note & Terms:"}
              </span>
              {invoice.note}
            </div>
          )}

          {/* Items Table */}
          <div>
            <h4 className="mb-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
              {isRtl ? "أصناف وبنود أمر الشراء" : "Purchase Items"}
            </h4>
            <div className="overflow-hidden rounded-xl border border-border">
              <table className="w-full text-xs">
                <thead className="bg-surface-2/70 text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2.5 text-start font-medium">
                      {isRtl ? "المنتج / الصنف" : "Item"}
                    </th>
                    <th className="px-3 py-2.5 text-center font-medium">
                      {isRtl ? "الكمية" : "Qty"}
                    </th>
                    <th className="px-3 py-2.5 text-end font-medium">
                      {isRtl ? "تكلفة الوحدة" : "Unit Cost"}
                    </th>
                    <th className="px-3 py-2.5 text-end font-medium">
                      {isRtl ? "الإجمالي" : "Total"}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {loadingLines ? (
                    <tr>
                      <td colSpan={4} className="py-6 text-center text-muted-foreground">
                        <RefreshCw className="mx-auto h-4 w-4 animate-spin mb-1 text-primary" />
                        {isRtl ? "جاري جلب تفاصيل البنود..." : "Loading items..."}
                      </td>
                    </tr>
                  ) : lines.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="py-6 text-center text-muted-foreground">
                        {isRtl ? "لا توجد بنود مسجلة لهذه الفاتورة" : "No items recorded"}
                      </td>
                    </tr>
                  ) : (
                    lines.map((l) => (
                      <tr key={l.id} className="hover:bg-surface-2/30">
                        <td className="px-3 py-2.5">
                          <div className="font-medium text-foreground">
                            {l.products?.name_ar || l.products?.name || "—"}
                          </div>
                          {l.products?.sku && (
                            <div className="text-[10px] font-mono text-muted-foreground">
                              SKU: {l.products.sku}
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          <span className="inline-block rounded-md bg-surface-2 px-2 py-0.5 font-mono font-semibold text-foreground">
                            {toSystemDigits(l.quantity.toString())}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-end font-mono">
                          {toSystemDigits(money(Number(l.unit_cost)))}
                        </td>
                        <td className="px-3 py-2.5 text-end font-mono font-semibold text-foreground">
                          {toSystemDigits(money(Number(l.total)))}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Financial Breakdown */}
          <div className="rounded-xl border border-border/80 bg-surface-2/30 p-4 text-xs space-y-1.5">
            <div className="flex justify-between text-muted-foreground">
              <span>{isRtl ? "المجموع الفرعي (قبل الضريبة):" : "Subtotal:"}</span>
              <span className="font-mono">
                {toSystemDigits(money(Number(invoice.subtotal)))}
              </span>
            </div>
            {Number(invoice.discount) > 0 && (
              <div className="flex justify-between text-emerald-500">
                <span>{isRtl ? "الخصم المكتسب:" : "Discount:"}</span>
                <span className="font-mono">
                  -{toSystemDigits(money(Number(invoice.discount)))}
                </span>
              </div>
            )}
            {Number(invoice.tax) > 0 && (
              <div className="flex justify-between text-muted-foreground">
                <span>{isRtl ? "ضريبة القيمة المضافة:" : "VAT / Tax:"}</span>
                <span className="font-mono">{toSystemDigits(money(Number(invoice.tax)))}</span>
              </div>
            )}
            <div className="flex justify-between border-t border-border pt-1.5 text-sm font-bold text-foreground">
              <span>{isRtl ? "الإجمالي الكلي:" : "Grand Total:"}</span>
              <span className="font-mono text-base">
                {toSystemDigits(money(Number(invoice.total)))}
              </span>
            </div>
            <div className="flex justify-between text-emerald-500 font-medium">
              <span>{isRtl ? "المسدد نقداً للمورد:" : "Paid:"}</span>
              <span className="font-mono">{toSystemDigits(money(Number(invoice.paid)))}</span>
            </div>
            {remaining > 0 && (
              <div className="flex justify-between text-rose-500 font-bold border-t border-border/60 pt-1 text-xs">
                <span>{isRtl ? "المتبقي (دين آجل للمورد):" : "Remaining Due:"}</span>
                <span className="font-mono">
                  {toSystemDigits(money(remaining))}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Modal Footer / Actions */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/80 bg-surface-2/40 px-6 py-4 -mx-6 -mb-6 mt-5">
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={!invoice.suppliers?.phone}
              onClick={onWhatsApp}
              title={
                !invoice.suppliers?.phone
                  ? isRtl
                    ? "هذا المورد لا يوجد لديه رقم هاتف مسجل في النظام"
                    : "This supplier has no phone number registered"
                  : isRtl
                    ? "مشاركة واتساب"
                    : "WhatsApp"
              }
              className={`inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold transition ${
                invoice.suppliers?.phone
                  ? "border border-emerald-500/30 bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20 cursor-pointer"
                  : "border border-border/60 bg-muted/40 text-muted-foreground/40 cursor-not-allowed opacity-50"
              }`}
            >
              <WhatsAppIcon className="h-4 w-4" />
              <span>{isRtl ? "واتساب للمورد" : "WhatsApp"}</span>
            </button>

            <button
              type="button"
              disabled={!invoice.suppliers?.phone}
              onClick={onSms}
              title={
                !invoice.suppliers?.phone
                  ? isRtl
                    ? "هذا المورد لا يوجد لديه رقم هاتف مسجل في النظام"
                    : "This supplier has no phone number registered"
                  : isRtl
                    ? "مشاركة عبر SMS"
                    : "SMS"
              }
              className={`inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold transition ${
                invoice.suppliers?.phone
                  ? "border border-blue-500/30 bg-blue-500/10 text-blue-500 hover:bg-blue-500/20 cursor-pointer"
                  : "border border-border/60 bg-muted/40 text-muted-foreground/40 cursor-not-allowed opacity-50"
              }`}
            >
              <MessageSquare className="h-4 w-4" />
              <span>{isRtl ? "رسالة SMS" : "SMS"}</span>
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPreviewOpen(true)}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-4 text-xs font-semibold text-primary-foreground shadow-sm hover:opacity-95 transition"
            >
              <Printer className="h-4 w-4" />
              <span>{isRtl ? "طباعة الفاتورة" : "Print"}</span>
            </button>

            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-9 items-center rounded-lg border border-border bg-surface px-4 text-xs font-medium text-foreground hover:bg-surface-2 transition"
            >
              {t("common.close")}
            </button>
          </div>
        </div>
      </div>

      {previewOpen && (
        <LuxuryPrintPreviewModal
          open={previewOpen}
          onClose={() => setPreviewOpen(false)}
          doc={{
            docType: "purchase_invoice",
            title: t("purchases.title") || "فاتورة مشتريات وتوريد",
            number: invoice.invoice_number,
            date: new Date(invoice.created_at).toLocaleString(lang === "ar" ? "ar-EG" : "en-US"),
            partyLabel: t("common.supplier") || "المورد",
            partyName: invoice.suppliers?.name ?? "",
            partyPhone: invoice.suppliers?.phone ?? "",
            warehouse: hasMultiWarehouse ? whLabel : undefined,
            payment: pmLabel(invoice.payment_method),
            status: statusLabel(invoice.status),
            lines: lines.map((l) => ({
              product: l.products?.name_ar || l.products?.name || "—",
              qty: Number(l.quantity),
              price: Number(l.unit_cost),
              total: Number(l.total),
              code: l.products?.sku || undefined,
            })),
            subtotal: Number(invoice.subtotal),
            tax: Number(invoice.tax),
            discount: Number(invoice.discount),
            total: Number(invoice.total),
            paid: Number(invoice.paid),
            balance: Math.max(0, Number(invoice.total) - Number(invoice.paid)),
          }}
          documentType="purchase_invoice"
          title={
            lang === "ar" ? "معاينة وطباعة فاتورة المشتريات" : "Purchase Invoice Print Preview"
          }
          defaultFormat="standard"
          customerName={invoice.suppliers?.name ?? undefined}
        />
      )}
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
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "card" | "bank_transfer" | "credit">(
    "bank_transfer",
  );
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

  const pmKey = (m: string) => (m === "bank_transfer" ? t("pos.pm.bank") : t(`pos.pm.${m}`));

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
            <div className="grid grid-cols-4 gap-1">
              {(["cash", "card", "bank_transfer", "credit"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setPaymentMethod(m)}
                  className={`h-8 rounded-md border text-xs transition ${paymentMethod === m ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-surface-2"}`}
                >
                  {pmKey(m)}
                </button>
              ))}
            </div>
            {paymentMethod !== "credit" && (
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

import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Receipt,
  Eye,
  X,
  FileDown,
  Printer,
  Sparkles,
  ScrollText,
  CheckCircle2,
  AlertCircle,
  XCircle,
  Plus,
  RefreshCw,
  Clock,
  LayoutGrid,
  List,
  TableProperties,
  Share2,
  Copy,
  Check,
  Phone,
  Building2,
  ChevronRight,
  TrendingUp,
  SlidersHorizontal,
  Calendar,
  Wallet,
  Loader2,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { useI18n } from "@/lib/i18n";
import { useModules } from "@/lib/modules";
import { money } from "@/lib/format";
import { toSystemDigits } from "@/lib/format-preferences";
import { generateInvoicePDF, type InvoiceDoc } from "@/lib/pdf";
import { LuxuryPrintPreviewModal } from "@/components/luxury-print-preview-modal";
import {
  VortexMetricCard,
  VortexSearchInput,
  VortexDateBadge,
  VortexFilterSheet,
  VortexFilterSection,
  VortexCollectionSheet,
  type PaymentMethod,
} from "@/components/vortex-ui";
import { toast } from "sonner";
import { WhatsAppIcon } from "@/components/whatsapp-icon";
import {
  buildUnifiedContext,
  renderMessage,
  buildWhatsAppLink,
  isValidWhatsAppPhone,
} from "@/lib/communication";
import {
  TableToolbar,
  ToolbarAction,
  type FilterDefinition,
  type FilterValues,
  type SortOption,
} from "@/components/ui/table-toolbar";
import { DataTable, type DataTableColumn, type DataTableSort } from "@/components/ui/data-table";
import { StatusBadge } from "@/components/ui/status-badge";
import { IconButton } from "@/components/ui/icon-button";
import { useBreakpoint } from "@/design/breakpoints";
import { useRealtimeTable } from "@/lib/realtime";
import { QUERY_KEYS } from "@/lib/query-keys";
import {
  isSplitPaymentValue,
  paymentMethodLabel,
  toLegacyPaymentValue,
} from "@/lib/payments/payment-methods";
import { PaymentMethodChip } from "@/components/ui/payment-method";

export const Route = createFileRoute("/_app/sales")({
  head: () => ({ meta: [{ title: "المبيعات والفواتير — فورتيكس ERP" }] }),
  component: SalesPage,
});

interface CustomerInfo {
  id?: string;
  name: string;
  phone?: string | null;
}

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
  note: string | null;
  created_at: string;
  customer_id: string | null;
  warehouse_id: string | null;
  customers: CustomerInfo | null;
  warehouses: { name: string; name_ar: string | null } | null;
}

interface Line {
  id: string;
  quantity: number;
  unit_price: number;
  tax: number;
  total: number;
  /** SERVICE = بند أجرة (طحن/تعبئة)، GOOD = بضاعة. يميّز بنود المطحنة
   *  التي لا يخصم منها مخزون عن بضاعة مخزنية. */
  line_type?: string | null;
  stock_effect?: string | null;
  products: { name: string; name_ar?: string | null; sku: string | null } | null;
}

type StatusTab = "all" | "paid" | "partial" | "unpaid" | "cancelled";
type ViewMode = "grid" | "list" | "table";

const INVOICES_PAGE_SIZE = 50;

export function SalesPage() {
  const { t, lang } = useI18n();
  const { isModuleEnabled } = useModules();
  const hasMultiWarehouse = isModuleEnabled("multi_warehouse");
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [search, setSearch] = useState("");
  const [statusTab, setStatusTab] = useState<StatusTab>("all");
  const [filters, setFilters] = useState<FilterValues>({});
  const [sortKey, setSortKey] = useState<string>("date_desc");
  const [viewMode, setViewMode] = useState<ViewMode>("grid");

  /*
   * Two sort channels on purpose. The toolbar's sort dropdown writes
   * `sortKey` (a preset), while the classic table lets the operator click a
   * column header, which writes `sort`. Precedence is decided in
   * `filteredRows` so a header click always wins over the stale preset.
   */
  const [sort, setSort] = useState<DataTableSort | null>(null);
  const breakpoint = useBreakpoint();
  const tableUsesHorizontalScroll =
    breakpoint === "xs" || breakpoint === "sm" || breakpoint === "md";

  // Filter Sheet State
  const [filterOpen, setFilterOpen] = useState(false);
  const [filterPaymentMethod, setFilterPaymentMethod] = useState<string>("all");
  const [filterDatePreset, setFilterDatePreset] = useState<string>("all");
  const [filterWarehouse, setFilterWarehouse] = useState<string>("all");
  const [minAmount, setMinAmount] = useState<string>("");
  const [maxAmount, setMaxAmount] = useState<string>("");

  // Selected & Details State
  const [selected, setSelected] = useState<Invoice | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [loadingLines, setLoadingLines] = useState(false);
  const [printDoc, setPrintDoc] = useState<InvoiceDoc | null>(null);
  const [copiedInvoiceId, setCopiedInvoiceId] = useState<string | null>(null);

  // Quick Collection Sheet State
  const [collectionOpen, setCollectionOpen] = useState(false);
  const [collectionTarget, setCollectionTarget] = useState<{
    invoiceId: string;
    customerId: string | null;
    customerName: string;
    phone?: string;
    balance: number;
  } | null>(null);

  const isRtl = lang === "ar";

  const whName = useCallback(
    (w: { name: string; name_ar: string | null } | null | undefined) =>
      !w ? undefined : lang === "ar" ? w.name_ar || w.name : w.name || w.name_ar || undefined,
    [lang],
  );

  // ─── Paginated / Infinite Streamed Data Fetching (Exact pattern from Products) ───
  const {
    data: invoicePages,
    isLoading: loading,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    refetch: load,
  } = useInfiniteQuery({
    queryKey: QUERY_KEYS.invoices,
    queryFn: async ({ pageParam = 0 }) => {
      const from = (pageParam as number) * INVOICES_PAGE_SIZE;
      const to = from + INVOICES_PAGE_SIZE - 1;

      const { data, error } = await supabase
        .from("sales_invoices")
        .select(
          "id,invoice_number,status,subtotal,discount,tax,total,paid,payment_method,note,created_at,customer_id,warehouse_id,milling_job_id,customers(id,name,phone),warehouses(name,name_ar)",
        )
        .order("created_at", { ascending: false })
        .range(from, to);

      if (error) {
        console.error("Failed to load sales invoices:", error);
        toast.error(isRtl ? "تعذر تحميل فواتير المبيعات" : "Failed to load sales invoices");
        throw error;
      }
      const pageRows = (data ?? []) as any as Invoice[];
      return { rows: pageRows, hasMore: pageRows.length === INVOICES_PAGE_SIZE };
    },
    getNextPageParam: (lastPage, pages) => (lastPage.hasMore ? pages.length : undefined),
    initialPageParam: 0,
    staleTime: 60_000,
  });

  // Total invoice count for accurate counters beside search
  const { data: totalInvoiceCount } = useQuery({
    queryKey: ["sales-invoices-total-count"],
    queryFn: async () => {
      const { count, error } = await supabase
        .from("sales_invoices")
        .select("id", { count: "exact", head: true });
      if (error) throw error;
      return count ?? 0;
    },
    staleTime: 30_000,
  });

  const rows = useMemo(
    () => invoicePages?.pages.flatMap((page) => page.rows) ?? [],
    [invoicePages],
  );

  // Sentinel for auto-updating/fetching next page when reaching the bottom
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!hasNextPage || isFetchingNextPage) return;
    const el = sentinelRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          void fetchNextPage();
        }
      },
      { rootMargin: "300px" },
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  useRealtimeTable<Invoice>(
    {
      table: "sales_invoices",
      queryKey: QUERY_KEYS.invoices,
      debounceMs: 100,
    },
    qc,
  );

  async function openInvoice(inv: Invoice) {
    setSelected(inv);
    setLoadingLines(true);
    try {
      const { data, error } = await supabase
        .from("sales_invoice_items")
        .select(
          "id,quantity,unit_price,tax,total,line_type,stock_effect,products(name,name_ar,sku)",
        )
        .eq("invoice_id", inv.id);

      if (!error) {
        setLines((data ?? []) as any);
      }
    } finally {
      setLoadingLines(false);
    }
  }

  async function openPrintPreview(inv: Invoice) {
    setSelected(inv);
    setLoadingLines(true);
    try {
      const { data, error } = await supabase
        .from("sales_invoice_items")
        .select(
          "id,quantity,unit_price,tax,total,line_type,stock_effect,products(name,name_ar,sku)",
        )
        .eq("invoice_id", inv.id);
      if (error) throw error;

      const invoiceLines = (data ?? []) as any as Line[];
      setLines(invoiceLines);
      const doc = await buildDoc(inv, invoiceLines);
      if (doc) setPrintDoc(doc);
    } catch {
      toast.error(
        isRtl ? "تعذر تحميل بنود الفاتورة للطباعة" : "Could not load invoice items for printing.",
      );
    } finally {
      setLoadingLines(false);
    }
  }

  const copyInvoiceNumber = (invNum: string, id: string) => {
    navigator.clipboard.writeText(invNum);
    setCopiedInvoiceId(id);
    toast.success(isRtl ? `تم نسخ رقم الفاتورة: ${invNum}` : `Invoice number copied: ${invNum}`);
    setTimeout(() => setCopiedInvoiceId(null), 2000);
  };

  const pmLabel = useCallback(
    (m: string, note?: string | null) => {
      // Split detection and naming both come from the catalogue module, so this
      // screen no longer keeps its own copy of either.
      if (isSplitPaymentValue(m, note)) {
        return paymentMethodLabel("split", isRtl ? "ar" : "en");
      }
      return paymentMethodLabel(m, isRtl ? "ar" : "en");
    },
    [isRtl],
  );
  const pmChip = (m: string, note?: string | null, className?: string) => (
    <PaymentMethodChip
      value={isSplitPaymentValue(m, note) ? "split" : m}
      note={note}
      lang={isRtl ? "ar" : "en"}
      className={className}
    />
  );

  const statusLabel = (s: string) => {
    const map: Record<string, string> = {
      paid: isRtl ? "مدفوعة بالكامل" : "Paid",
      partial: isRtl ? "دفع جزئي" : "Partial",
      unpaid: isRtl ? "غير مدفوعة (آجل)" : "Unpaid",
      cancelled: isRtl ? "ملغاة" : "Cancelled",
    };
    return map[s] ?? s;
  };

  const statusBadge = (s: string) => {
    switch (s) {
      case "paid":
        return (
          <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 text-xs font-medium text-emerald-500">
            <CheckCircle2 className="h-3 w-3" />
            {statusLabel(s)}
          </span>
        );
      case "partial":
        return (
          <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-0.5 text-xs font-medium text-amber-500">
            <Clock className="h-3 w-3" />
            {statusLabel(s)}
          </span>
        );
      case "unpaid":
        return (
          <span className="inline-flex items-center gap-1 rounded-full border border-rose-500/30 bg-rose-500/10 px-2.5 py-0.5 text-xs font-medium text-rose-500">
            <AlertCircle className="h-3 w-3" />
            {statusLabel(s)}
          </span>
        );
      case "cancelled":
        return (
          <span className="inline-flex items-center gap-1 rounded-full border border-red-500/30 bg-red-500/10 px-2.5 py-0.5 text-xs font-medium text-red-500">
            <XCircle className="h-3 w-3" />
            {statusLabel(s)}
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 rounded-full border border-border bg-surface-2 px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
            {s}
          </span>
        );
    }
  };

  // WhatsApp Message Generator via Unified Communication Engine
  const shareInvoiceWhatsApp = (inv: Invoice) => {
    const hasPhone = Boolean(inv.customers?.phone && inv.customers.phone.trim().length > 0);
    if (!hasPhone) {
      toast.warning(
        isRtl
          ? "هذا العميل لا يوجد لديه رقم هاتف مسجل في النظام"
          : "This customer has no phone number registered in the system",
      );
      return;
    }

    const remaining = Math.max(0, Number(inv.total) - Number(inv.paid));
    const ctx = buildUnifiedContext({
      event: "invoice_share",
      customer: {
        id: inv.customer_id || "",
        name: inv.customers?.name || (isRtl ? "العميل الكريم" : "Valued Customer"),
        phone: inv.customers?.phone,
        balance: remaining,
      },
      invoice: {
        id: inv.id,
        invoiceNumber: inv.invoice_number,
        date: new Date(inv.created_at).toLocaleDateString(isRtl ? "ar-YE" : "en-US"),
        subtotal: Number(inv.subtotal || inv.total),
        total: Number(inv.total),
        paid: Number(inv.paid),
        remaining,
      },
      language: isRtl ? "ar" : "en",
    });

    const rendered = renderMessage(ctx);
    if (rendered.canSendWhatsApp && rendered.whatsAppUrl) {
      window.open(rendered.whatsAppUrl, "_blank", "noopener,noreferrer");
    } else {
      toast.error(
        isRtl
          ? "رقم الهاتف المسجل للعميل غير صالح للإرسال"
          : "Customer phone number is invalid for WhatsApp",
      );
    }
  };

  // Quick Collect trigger
  const triggerQuickCollect = (inv: Invoice) => {
    const remaining = Math.max(0, Number(inv.total) - Number(inv.paid));
    setCollectionTarget({
      invoiceId: inv.id,
      customerId: inv.customer_id,
      customerName: inv.customers?.name || (isRtl ? "عميل نقدي" : "Walk-in"),
      phone: inv.customers?.phone || undefined,
      balance: remaining,
    });
    setCollectionOpen(true);
  };

  // Handle saving payment from collection sheet
  const handleSaveCollection = async (payment: {
    customerId: string;
    amount: number;
    method: PaymentMethod;
    notes?: string;
  }) => {
    if (!collectionTarget) throw new Error("No collection target selected");

    // This legacy write keeps the selected method's actual enum family instead
    // of coercing card and wallet payments to bank_transfer. It still cannot
    // retain provider identity or atomically post the invoice; those limitations
    // require the additive payment-id/account storage path planned for the DB.
    const dbMethod = toLegacyPaymentValue(payment.method);

    // 1. Record customer payment if customer exists
    if (collectionTarget.customerId) {
      const { error: pError } = await (supabase as any).from("customer_payments").insert({
        customer_id: collectionTarget.customerId,
        invoice_id: collectionTarget.invoiceId,
        amount: payment.amount,
        payment_method: dbMethod,
        note: payment.notes || null,
        payment_date: new Date().toISOString(),
      });
      if (pError) throw pError;
    }

    // 2. Update the sales invoice paid amount and status with 2-decimal precision & cap
    const inv = rows.find((r) => r.id === collectionTarget.invoiceId);
    if (inv) {
      const invTotal = Number(inv.total) || 0;
      const currentPaid = Number(inv.paid) || 0;
      const remaining = Math.max(0, Math.round((invTotal - currentPaid) * 100) / 100);
      const payAmt = Math.min(
        Number(payment.amount) || 0,
        remaining > 0 ? remaining : Number(payment.amount) || 0,
      );
      const newPaid = Math.min(invTotal, Math.round((currentPaid + payAmt) * 100) / 100);
      const newStatus = newPaid >= invTotal ? "paid" : newPaid > 0 ? "partial" : "unpaid";

      const { error: invErr } = await (supabase as any)
        .from("sales_invoices")
        .update({
          paid: newPaid,
          status: newStatus,
        })
        .eq("id", collectionTarget.invoiceId);

      if (invErr) {
        console.error("Failed to update invoice:", invErr);
        toast.error(isRtl ? "تعذر تحديث حالة الفاتورة" : "Failed to update invoice status");
        throw invErr;
      }
    }

    // 3. Keep customer balance consistent in customers table
    if (collectionTarget.customerId) {
      const { data: custData } = await supabase
        .from("customers")
        .select("balance")
        .eq("id", collectionTarget.customerId)
        .maybeSingle();

      if (custData) {
        const curBal = Number(custData.balance) || 0;
        const newBal = Math.round((curBal - Number(payment.amount)) * 100) / 100;
        await (supabase as any)
          .from("customers")
          .update({ balance: newBal })
          .eq("id", collectionTarget.customerId);
      }
    }

    toast.success(
      isRtl ? "تم تسجيل التحصيل وتحديث الفاتورة بنجاح" : "Payment collected successfully",
    );
    await load();
    return { receiptNumber: String(Date.now()).slice(-6) };
  };

  // Build Invoice Document for Print & PDF
  async function buildDoc(
    invoice: Invoice | null = selected,
    invoiceLines: Line[] = lines,
  ): Promise<InvoiceDoc | null> {
    if (!invoice) return null;
    const { data: cs } = await supabase.from("company_settings").select("*").limit(1).maybeSingle();
    return {
      title: isRtl ? "فاتورة مبيعات ضريبية" : "Tax Sales Invoice",
      number: invoice.invoice_number,
      date: new Date(invoice.created_at).toLocaleString(isRtl ? "ar-EG" : "en-US"),
      partyLabel: isRtl ? "العميل / المشترى:" : "Bill To:",
      partyName: invoice.customers?.name ?? (isRtl ? "عميل نقدي" : "Walk-in"),
      warehouse: hasMultiWarehouse ? (whName(invoice.warehouses) ?? undefined) : undefined,
      payment: pmLabel(invoice.payment_method, invoice.note),
      status: statusLabel(invoice.status),
      lines: invoiceLines.map((l) => ({
        product: l.products?.name_ar || l.products?.name || "—",
        qty: Number(l.quantity),
        price: Number(l.unit_price),
        total: Number(l.total),
      })),
      subtotal: Number(invoice.subtotal),
      tax: Number(invoice.tax),
      discount: Number(invoice.discount),
      total: Number(invoice.total),
      paid: Number(invoice.paid),
      company: cs
        ? {
            // Company Profile only — never invent a company name or phone.
            name: (cs as any).name || undefined,
            phone: (cs as any).phone || undefined,
            logo: (cs as any).logo_url || undefined,
            address: (cs as any).address || undefined,
            email: (cs as any).email || undefined,
            vat: (cs as any).tax_number || undefined,
            footerContact: (cs as any).footer_contact || undefined,
          }
        : undefined,
      currency:
        (cs as any)?.currency_symbol?.trim() || (cs as any)?.currency || (isRtl ? "ريال" : ""),
    };
  }

  async function doPDF() {
    const doc = await buildDoc();
    if (doc) generateInvoicePDF(doc);
  }

  // Calculate Metrics from Rows
  const metrics = useMemo(() => {
    let totalRevenue = 0;
    let totalPaid = 0;
    let totalPending = 0;
    let paidCount = 0;
    let partialCount = 0;
    let unpaidCount = 0;
    let cancelledCount = 0;

    rows.forEach((r) => {
      const tot = Number(r.total) || 0;
      const pd = Number(r.paid) || 0;
      const rem = Math.max(0, tot - pd);

      if (r.status !== "cancelled") {
        totalRevenue += tot;
        totalPaid += pd;
        totalPending += rem;
      }

      if (r.status === "paid") paidCount++;
      else if (r.status === "partial") partialCount++;
      else if (r.status === "unpaid") unpaidCount++;
      else if (r.status === "cancelled") cancelledCount++;
    });

    const activeInvoices = rows.filter((r) => r.status !== "cancelled").length;
    const avgTicket = activeInvoices > 0 ? totalRevenue / activeInvoices : 0;

    return {
      totalRevenue,
      totalPaid,
      totalPending,
      totalCount: rows.length,
      paidCount,
      partialCount,
      unpaidCount,
      cancelledCount,
      avgTicket,
    };
  }, [rows]);

  // Unique Warehouses for Filter
  const availableWarehouses = useMemo(() => {
    const map = new Map<string, string>();
    rows.forEach((r) => {
      if (r.warehouse_id && r.warehouses) {
        map.set(r.warehouse_id, whName(r.warehouses) || r.warehouses.name);
      }
    });
    return Array.from(map.entries());
  }, [rows, whName]);

  const salesFilterDefinitions: FilterDefinition[] = useMemo(() => {
    const defs: FilterDefinition[] = [
      {
        key: "created_at",
        label: isRtl ? "الفترة الزمنية (تاريخ الفاتورة)" : "Date Range",
        type: "date-range",
      },
      {
        key: "status",
        label: isRtl ? "حالة السداد" : "Payment Status",
        type: "select",
        options: [
          { value: "paid", label: isRtl ? "مسددة بالكامل" : "Fully Paid" },
          { value: "partial", label: isRtl ? "دفع جزئي" : "Partial Payment" },
          { value: "unpaid", label: isRtl ? "غير مسددة (آجلة)" : "Unpaid" },
          { value: "cancelled", label: isRtl ? "ملغاة" : "Cancelled" },
        ],
      },
      {
        key: "payment_method",
        label: isRtl ? "طريقة السداد" : "Payment Method",
        type: "select",
        options: [
          { value: "cash", label: isRtl ? "نقدي (كاش)" : "Cash" },
          { value: "card", label: isRtl ? "شبكة / بطاقة" : "Card" },
          { value: "bank_transfer", label: isRtl ? "تحويل بنكي" : "Bank Transfer" },
          { value: "split", label: isRtl ? "دفع مجزأ" : "Split Payment" },
        ],
      },
    ];

    if (hasMultiWarehouse && availableWarehouses.length > 0) {
      defs.push({
        key: "warehouse_id",
        label: isRtl ? "المستودع / المخزن" : "Warehouse",
        type: "select",
        options: availableWarehouses.map(([id, name]) => ({ value: id, label: name })),
      });
    }

    return defs;
  }, [isRtl, hasMultiWarehouse, availableWarehouses]);

  const salesSortOptions: SortOption[] = useMemo(
    () => [
      { value: "date_desc", label: isRtl ? "الأحدث تاريخاً" : "Newest Date" },
      { value: "date_asc", label: isRtl ? "الأقدم تاريخاً" : "Oldest Date" },
      { value: "total_desc", label: isRtl ? "الأعلى قيمة (الإجمالي)" : "Highest Total" },
      { value: "total_asc", label: isRtl ? "الأقل قيمة (الإجمالي)" : "Lowest Total" },
      { value: "remaining_desc", label: isRtl ? "الأعلى متبقي (الآجل)" : "Highest Due" },
      { value: "number_asc", label: isRtl ? "رقم الفاتورة" : "Invoice Number" },
    ],
    [isRtl],
  );

  /*
   * Classic table columns.
   *
   * Mirrors the products table: every column carries its own `sortValue` so a
   * header click sorts on the *displayed* value (localized customer name, the
   * translated payment label) rather than a raw database field the operator
   * cannot see. Cells stay on one line and let the long values truncate, which
   * is what keeps a dense finance table scannable.
   */
  const columns = useMemo<DataTableColumn<Invoice>[]>(() => {
    const cols: DataTableColumn<Invoice>[] = [
      {
        key: "invoice_number",
        header: isRtl ? "رقم الفاتورة" : "Invoice #",
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
        key: "customer",
        header: isRtl ? "العميل" : "Customer",
        sortable: true,
        width: "w-[220px]",
        sortValue: (inv) => inv.customers?.name ?? "",
        cell: (inv) => {
          const customerName = inv.customers?.name ?? (isRtl ? "عميل نقدي" : "Walk-in");
          return (
            <div className="flex items-center gap-2 py-0.5">
              <span className="grid size-7 shrink-0 place-items-center rounded-full bg-surface-2 text-[10px] font-bold text-muted-foreground">
                {customerName.slice(0, 1).toUpperCase()}
              </span>
              <div className="min-w-0">
                <span className="block truncate text-xs font-medium text-foreground">
                  {customerName}
                </span>
                {inv.customers?.phone && (
                  <span className="block truncate font-mono text-[10px] text-muted-foreground">
                    {toSystemDigits(inv.customers.phone)}
                  </span>
                )}
              </div>
            </div>
          );
        },
      },
    ];

    if (hasMultiWarehouse) {
      cols.push({
        key: "warehouse",
        header: isRtl ? "المستودع" : "Warehouse",
        sortable: true,
        width: "w-[130px]",
        sortValue: (inv) => whName(inv.warehouses) ?? "",
        cell: (inv) => (
          <span className="block truncate text-xs text-muted-foreground">
            {whName(inv.warehouses) ?? "—"}
          </span>
        ),
      });
    }

    cols.push(
      {
        key: "payment_method",
        header: isRtl ? "طريقة السداد" : "Payment",
        sortable: true,
        width: "w-[130px]",
        sortValue: (inv) => pmLabel(inv.payment_method, inv.note),
        cell: (inv) => (
          <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-lg border border-border/80 bg-surface-2/60 px-2 py-0.5 text-[11px] text-muted-foreground">
            <PaymentMethodChip
              value={
                isSplitPaymentValue(inv.payment_method, inv.note) ? "split" : inv.payment_method
              }
              note={inv.note}
              lang={isRtl ? "ar" : "en"}
              className="whitespace-nowrap rounded-lg border-border/80 bg-surface-2/60 px-2 py-0.5 text-[11px] text-muted-foreground"
            />
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
        header: isRtl ? "الإجمالي" : "Total",
        align: "end",
        sortable: true,
        width: "w-[124px]",
        sortValue: (inv) => Number(inv.total) || 0,
        cell: (inv) => (
          <span className="font-mono text-xs font-bold tabular-nums text-foreground">
            {toSystemDigits(money(Number(inv.total) || 0))}
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
                {toSystemDigits(money(paid))}
              </span>
              {remaining > 0 ? (
                <span className="font-mono text-[10px] font-semibold tabular-nums text-rose-500">
                  {toSystemDigits(money(remaining))}
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
        width: "w-[128px]",
        cell: (inv) => {
          const total = Number(inv.total) || 0;
          const paid = Number(inv.paid) || 0;
          const remaining = Math.max(0, total - paid);
          return (
            <div className="inline-flex items-center gap-1.5 pe-2">
              {remaining > 0 && inv.status !== "cancelled" && (
                <IconButton
                  size="sm"
                  variant="outline"
                  tooltip
                  ariaLabel={isRtl ? "تحصيل سريع" : "Quick Collect"}
                  icon={<Wallet />}
                  round
                  onClick={(event) => {
                    event.stopPropagation();
                    triggerQuickCollect(inv);
                  }}
                />
              )}
              <IconButton
                size="sm"
                variant="ghost"
                tooltip
                ariaLabel={isRtl ? "عرض التفاصيل" : "View details"}
                icon={<Eye />}
                round
                onClick={(event) => {
                  event.stopPropagation();
                  openInvoice(inv);
                }}
              />
            </div>
          );
        },
      },
    );

    return cols;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRtl, hasMultiWarehouse, t]);

  // Filter & Sort Rows
  const filteredRows = useMemo(() => {
    let list = rows.filter((r) => {
      // 1. Status Tab
      if (statusTab !== "all" && r.status !== statusTab) {
        return false;
      }

      // 2. Search query
      if (search.trim()) {
        const q = search.toLowerCase().trim();
        const invNum = r.invoice_number.toLowerCase();
        const custName = (r.customers?.name ?? "").toLowerCase();
        const custPhone = (r.customers?.phone ?? "").toLowerCase();
        const note = (r.note ?? "").toLowerCase();
        if (
          !invNum.includes(q) &&
          !custName.includes(q) &&
          !custPhone.includes(q) &&
          !note.includes(q)
        ) {
          return false;
        }
      }

      // 3. Payment Method filter (from toolbar or sheet)
      const activePm =
        (typeof filters.payment_method === "string" ? filters.payment_method : "") ||
        (filterPaymentMethod !== "all" ? filterPaymentMethod : "");
      if (activePm) {
        if (activePm === "split") {
          const isSplit = Boolean(
            r.note && (r.note.includes("[دفع مجزأ:") || r.note.includes("[Split:")),
          );
          if (!isSplit && r.payment_method !== "split") return false;
        } else if (r.payment_method !== activePm) {
          return false;
        }
      }

      // 4. Warehouse filter
      const activeWh =
        (typeof filters.warehouse_id === "string" ? filters.warehouse_id : "") ||
        (filterWarehouse !== "all" ? filterWarehouse : "");
      if (activeWh && r.warehouse_id !== activeWh) {
        return false;
      }

      // 5. Status filter from toolbar
      if (filters.status && r.status !== filters.status) {
        return false;
      }

      // 6. Min / Max amount
      const tot = Number(r.total) || 0;
      if (minAmount && tot < Number(minAmount)) return false;
      if (maxAmount && tot > Number(maxAmount)) return false;

      // 7. Date filter from toolbar
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

      // 8. Date preset filter from sheet
      if (filterDatePreset !== "all") {
        const rowDate = new Date(r.created_at);
        const now = new Date();
        if (filterDatePreset === "today") {
          if (rowDate.toDateString() !== now.toDateString()) return false;
        } else if (filterDatePreset === "last7") {
          const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
          if (rowDate < sevenDaysAgo) return false;
        } else if (filterDatePreset === "thisMonth") {
          if (
            rowDate.getMonth() !== now.getMonth() ||
            rowDate.getFullYear() !== now.getFullYear()
          ) {
            return false;
          }
        }
      }

      return true;
    });

    list = [...list].sort((a, b) => {
      const aTotal = Number(a.total) || 0;
      const bTotal = Number(b.total) || 0;
      const aRem = Math.max(0, aTotal - (Number(a.paid) || 0));
      const bRem = Math.max(0, bTotal - (Number(b.paid) || 0));

      /*
       * A column-header click (classic table) takes precedence over the
       * toolbar preset, so the two controls can never disagree about which
       * order the operator asked for.
       */
      if (sort) {
        const dir = sort.direction === "asc" ? 1 : -1;
        switch (sort.key) {
          case "invoice_number":
            return a.invoice_number.localeCompare(b.invoice_number) * dir;
          case "customer":
            return (a.customers?.name ?? "").localeCompare(b.customers?.name ?? "", "ar") * dir;
          case "payment_method":
            return (
              pmLabel(a.payment_method, a.note).localeCompare(
                pmLabel(b.payment_method, b.note),
                "ar",
              ) * dir
            );
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
  }, [
    rows,
    statusTab,
    search,
    filters,
    sortKey,
    filterPaymentMethod,
    filterWarehouse,
    minAmount,
    maxAmount,
    filterDatePreset,
    sort,
    pmLabel,
  ]);

  // Count active filters
  const activeFiltersCount = useMemo(() => {
    let count = 0;
    if (filterPaymentMethod !== "all") count++;
    if (filterDatePreset !== "all") count++;
    if (filterWarehouse !== "all") count++;
    if (minAmount) count++;
    if (maxAmount) count++;
    return count;
  }, [filterPaymentMethod, filterDatePreset, filterWarehouse, minAmount, maxAmount]);

  const clearAllFilters = () => {
    setFilterPaymentMethod("all");
    setFilterDatePreset("all");
    setFilterWarehouse("all");
    setMinAmount("");
    setMaxAmount("");
    setSearch("");
    setFilters({});
    setStatusTab("all");
  };

  return (
    <div className="space-y-6 pb-12">
      {/* Header & Quick Action Buttons */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <PageHeader
          title={isRtl ? "المبيعات والفواتير" : "Sales & Invoices"}
          subtitle={
            isRtl
              ? "متابعة فواتير المبيعات، المدفوعات، التحصيلات الفورية والطباعة الفاخرة"
              : "Track sales invoices, collections, payment statuses and luxury printing"
          }
        />
        <div className="flex items-center gap-2">
          <button
            onClick={() => void load()}
            disabled={loading}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-surface px-3 text-xs font-medium text-foreground transition hover:bg-surface-2 disabled:opacity-50"
            title={isRtl ? "تحديث البيانات" : "Refresh"}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin text-primary" : ""}`} />
            <span className="hidden sm:inline">{isRtl ? "تحديث" : "Refresh"}</span>
          </button>

          <Link
            to="/pos"
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3.5 text-xs font-semibold text-primary-foreground shadow-sm transition hover:opacity-95"
          >
            <Plus className="h-4 w-4" />
            <span>{isRtl ? "فاتورة جديدة (نقطة البيع)" : "New Invoice (POS)"}</span>
          </Link>
        </div>
      </div>

      {/* Vortex Metrics Cards - 2 Columns on Mobile, 4 on Desktop */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <VortexMetricCard
          title={isRtl ? "إجمالي المبيعات" : "Total Revenue"}
          value={toSystemDigits(money(metrics.totalRevenue))}
          subtitle={`${toSystemDigits(metrics.totalCount.toString())} ${isRtl ? "فاتورة مسجلة" : "invoices"}`}
          icon={<TrendingUp className="h-4 w-4 text-emerald-500" />}
          gradient="emerald"
        />
        <VortexMetricCard
          title={isRtl ? "المبالغ المحصلة" : "Collected Cash"}
          value={toSystemDigits(money(metrics.totalPaid))}
          subtitle={`${toSystemDigits(metrics.paidCount.toString())} ${isRtl ? "مسددة بالكامل" : "fully paid"}`}
          icon={<CheckCircle2 className="h-4 w-4 text-blue-500" />}
          gradient="blue"
        />
        <VortexMetricCard
          title={isRtl ? "المتبقي والآجل" : "Receivables & Due"}
          value={toSystemDigits(money(metrics.totalPending))}
          subtitle={`${toSystemDigits((metrics.unpaidCount + metrics.partialCount).toString())} ${isRtl ? "فواتير معلقة" : "pending invoices"}`}
          icon={<Clock className="h-4 w-4 text-amber-500" />}
          gradient="amber"
        />
        <VortexMetricCard
          title={isRtl ? "متوسط قيمة الفاتورة" : "Average Ticket"}
          value={toSystemDigits(money(metrics.avgTicket))}
          subtitle={isRtl ? "لكل عملية بيع نشطة" : "per active sale"}
          icon={<Receipt className="h-4 w-4 text-purple-500" />}
          gradient="purple"
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
            ? "البحث برقم الفاتورة، اسم العميل، رقم الهاتف أو الملاحظات..."
            : "Search invoice #, customer name, phone or notes...",
          resultCount: totalInvoiceCount ?? filteredRows.length,
        }}
        filters={{
          definitions: salesFilterDefinitions,
          values: filters,
          onValueChange: setFilters,
        }}
        sort={{
          options: salesSortOptions,
          value: sortKey,
          onValueChange: (value) => {
            setSortKey(value);
            // Switching to a preset means the operator no longer wants the
            // column-header order, so drop it rather than letting the table
            // keep sorting by a column the dropdown no longer shows.
            setSort(null);
          },
          label: isRtl ? "ترتيب" : "Sort",
        }}
        viewToggle={
          <ToolbarAction
            label={
              viewMode === "grid"
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
              viewMode === "grid" ? (
                <LayoutGrid />
              ) : viewMode === "list" ? (
                <List />
              ) : (
                <TableProperties />
              )
            }
            onClick={() =>
              setViewMode((prev) => (prev === "grid" ? "list" : prev === "list" ? "table" : "grid"))
            }
            tone="ghost"
          />
        }
        action={
          <ToolbarAction
            label={isRtl ? "فاتورة جديدة" : "New Invoice"}
            icon={<Plus />}
            tone="primary"
            onClick={() => void navigate({ to: "/pos" })}
          />
        }
      >
        {/* Quick Filter Tabs with custom dedicated colors for each status — Visible in ALL view modes */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 scrollbar-x-none">
          {[
            {
              id: "all",
              label: isRtl ? "الكل" : "All",
              count: totalInvoiceCount ?? rows.length,
              activeCls:
                "border-primary bg-primary text-primary-foreground shadow-xs shadow-primary/20",
              inactiveCls:
                "border-border/70 bg-surface/70 text-muted-foreground hover:bg-surface-2 hover:text-foreground",
              pillCls: "bg-muted text-muted-foreground",
            },
            {
              id: "paid",
              label: isRtl ? "مسددة" : "Paid",
              count: metrics.paidCount,
              activeCls:
                "border-emerald-600 bg-emerald-600 text-white shadow-xs shadow-emerald-600/20",
              inactiveCls:
                "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20",
              pillCls: "bg-emerald-500/20 text-emerald-600",
            },
            {
              id: "partial",
              label: isRtl ? "دفع جزئي" : "Partial",
              count: metrics.partialCount,
              activeCls: "border-amber-600 bg-amber-600 text-white shadow-xs shadow-amber-600/20",
              inactiveCls:
                "border-amber-500/30 bg-amber-500/10 text-amber-600 hover:bg-amber-500/20",
              pillCls: "bg-amber-500/20 text-amber-600",
            },
            {
              id: "unpaid",
              label: isRtl ? "غير مسددة (آجلة)" : "Unpaid",
              count: metrics.unpaidCount,
              activeCls: "border-rose-600 bg-rose-600 text-white shadow-xs shadow-rose-600/20",
              inactiveCls: "border-rose-500/30 bg-rose-500/10 text-rose-600 hover:bg-rose-500/20",
              pillCls: "bg-rose-500/20 text-rose-600",
            },
            {
              id: "cancelled",
              label: isRtl ? "ملغاة" : "Cancelled",
              count: metrics.cancelledCount,
              activeCls: "border-red-600 bg-red-600 text-white shadow-xs shadow-red-600/20",
              inactiveCls: "border-red-500/30 bg-red-500/10 text-red-500 hover:bg-red-500/20",
              pillCls: "bg-red-500/20 text-red-500",
            },
          ].map((f) => {
            const isSelected = statusTab === f.id;
            return (
              <button
                key={f.id}
                type="button"
                onClick={() => setStatusTab(f.id as StatusTab)}
                className={`flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-bold transition ${
                  isSelected ? f.activeCls : f.inactiveCls
                }`}
              >
                <span>{f.label}</span>
                <span
                  className={`rounded-full px-1.5 py-0.2 text-[10px] font-mono ${
                    isSelected ? "bg-white/20 text-white" : f.pillCls
                  }`}
                >
                  {toSystemDigits(f.count.toString())}
                </span>
              </button>
            );
          })}
        </div>
      </TableToolbar>

      {/* Main Content: Cards (Grid), List, or Classic Table View */}
      {loading ? (
        <div className="panel-elevated flex min-h-[300px] flex-col items-center justify-center gap-3 p-8 text-center text-muted-foreground">
          <RefreshCw className="h-8 w-8 animate-spin text-primary opacity-80" />
          <p className="text-sm">
            {isRtl ? "جاري تحميل بيانات المبيعات..." : "Loading sales data..."}
          </p>
        </div>
      ) : filteredRows.length === 0 ? (
        <div className="panel-elevated flex min-h-[300px] flex-col items-center justify-center gap-3 p-8 text-center text-muted-foreground">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-surface-2 text-muted-foreground">
            <Receipt className="h-8 w-8 opacity-60" />
          </div>
          <div>
            <h4 className="text-base font-semibold text-foreground">
              {isRtl ? "لا توجد فواتير مبيعات مطابقة" : "No matching sales invoices"}
            </h4>
            <p className="mt-1 text-xs text-muted-foreground">
              {search || activeFiltersCount > 0 || statusTab !== "all"
                ? isRtl
                  ? "جرب تعديل خيارات البحث أو التصفية"
                  : "Try adjusting your search query or filters"
                : isRtl
                  ? "يمكنك إنشاء أول فاتورة عبر نقطة البيع الآن"
                  : "Start creating invoices via the POS page"}
            </p>
          </div>
          <div className="mt-2 flex gap-2">
            {(search || activeFiltersCount > 0 || statusTab !== "all") && (
              <button
                onClick={clearAllFilters}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-surface px-3 text-xs hover:bg-surface-2"
              >
                <X className="h-3 w-3" />
                {isRtl ? "مسح التصفية" : "Clear filters"}
              </button>
            )}
            <Link
              to="/pos"
              className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground"
            >
              <Plus className="h-3 w-3" />
              {isRtl ? "إنشاء فاتورة الآن" : "Create Invoice"}
            </Link>
          </div>
        </div>
      ) : (
        <>
          {/* 1. Cards View (Grid Mode) — same 2-column mobile grid as products */}
          {viewMode === "grid" && (
            <div className="grid grid-cols-2 gap-2.5 sm:gap-4 md:grid-cols-3 lg:grid-cols-4">
              {filteredRows.map((inv) => {
                const total = Number(inv.total) || 0;
                const paid = Number(inv.paid) || 0;
                const remaining = Math.max(0, total - paid);
                const customerName = inv.customers?.name ?? (isRtl ? "عميل نقدي" : "Walk-in");

                return (
                  <div
                    key={inv.id}
                    data-qa="sales-card"
                    onClick={() => openInvoice(inv)}
                    className="card-mullak group relative flex cursor-pointer flex-col justify-between overflow-hidden rounded-2xl p-3 transition-all duration-200 hover:shadow-md sm:p-4.5"
                  >
                    <div>
                      {/* Header: Invoice # + Copy + Status */}
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
                            <VortexDateBadge date={inv.created_at} variant="subtle" size="sm" />
                          </div>
                        </div>
                        <div className="shrink-0">{statusBadge(inv.status)}</div>
                      </div>

                      {/* Customer + Payment method */}
                      <div className="mt-3 flex items-center justify-between gap-2 border-t border-border/60 pt-2.5 text-xs">
                        <div className="flex min-w-0 items-center gap-1.5">
                          <div className="grid size-6 shrink-0 place-items-center rounded-full bg-surface-2 text-[10px] font-bold">
                            {customerName.slice(0, 1).toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <div className="truncate font-medium text-foreground">
                              {customerName}
                            </div>
                            {inv.customers?.phone && (
                              <div className="dir-ltr truncate font-mono text-[10px] text-muted-foreground">
                                {toSystemDigits(inv.customers.phone)}
                              </div>
                            )}
                          </div>
                        </div>
                        <div className="inline-flex max-w-[45%] shrink-0 items-center gap-1 truncate rounded-lg border border-border/80 bg-surface-2/60 px-2 py-1 text-[11px] text-muted-foreground">
                          {pmChip(
                            inv.payment_method,
                            inv.note,
                            "max-w-[45%] shrink-0 truncate rounded-lg border-border/80 bg-surface-2/60 px-2 py-1 text-[11px] text-muted-foreground",
                          )}
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
                          <span className="text-muted-foreground">
                            {isRtl ? "إجمالي الفاتورة" : "Total"}
                          </span>
                          <span className="truncate font-mono text-sm font-bold text-foreground">
                            {toSystemDigits(money(total))}
                          </span>
                        </div>
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-muted-foreground">
                            {isRtl ? "المدفوع" : "Paid"}
                          </span>
                          <span className="truncate font-mono font-medium text-emerald-500">
                            {toSystemDigits(money(paid))}
                          </span>
                        </div>
                        {remaining > 0 && (
                          <div className="flex items-center justify-between gap-2 border-t border-border/40 pt-1.5 font-semibold text-rose-500">
                            <span>{isRtl ? "المتبقي (آجل)" : "Remaining Due"}</span>
                            <span className="truncate font-mono">
                              {toSystemDigits(money(remaining))}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Actions Row */}
                    <div
                      className="mt-3.5 flex items-center justify-between gap-2 border-t border-border/60 pt-3"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          disabled={!inv.customers?.phone}
                          onClick={() => shareInvoiceWhatsApp(inv)}
                          className={`grid size-8 place-items-center rounded-lg border transition ${
                            inv.customers?.phone
                              ? "border-border/70 text-muted-foreground hover:bg-surface-2 hover:text-emerald-500 cursor-pointer"
                              : "border-border/40 text-muted-foreground/30 cursor-not-allowed opacity-50"
                          }`}
                          title={
                            !inv.customers?.phone
                              ? isRtl
                                ? "هذا العميل لا يوجد لديه رقم هاتف مسجل في النظام"
                                : "This customer has no phone number registered"
                              : isRtl
                                ? "مشاركة عبر واتساب"
                                : "Share via WhatsApp"
                          }
                        >
                          <WhatsAppIcon className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => openInvoice(inv)}
                          className="grid size-8 place-items-center rounded-lg border border-border/70 text-muted-foreground transition hover:bg-surface-2 hover:text-foreground"
                          title={isRtl ? "عرض التفاصيل" : "View Details"}
                        >
                          <Eye className="h-4 w-4" />
                        </button>
                      </div>

                      {remaining > 0 && inv.status !== "cancelled" ? (
                        <button
                          type="button"
                          onClick={() => triggerQuickCollect(inv)}
                          className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-amber-500/10 px-3 text-xs font-semibold text-amber-500 transition hover:bg-amber-500/20"
                        >
                          <Wallet className="h-3.5 w-3.5" />
                          <span>{isRtl ? "تحصيل فوري" : "Collect"}</span>
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => void openPrintPreview(inv)}
                          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-surface px-3 text-xs font-medium text-foreground transition hover:bg-surface-2"
                        >
                          <Printer className="h-3.5 w-3.5" />
                          <span>{isRtl ? "طباعة" : "Print"}</span>
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* 2. List View (Luxury Row-Cards Mode) */}
          {viewMode === "list" && (
            <div className="space-y-2.5">
              {filteredRows.map((inv) => {
                const total = Number(inv.total) || 0;
                const paid = Number(inv.paid) || 0;
                const remaining = Math.max(0, total - paid);
                const customerName = inv.customers?.name ?? (isRtl ? "عميل نقدي" : "Walk-in");
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
                    onClick={() => openInvoice(inv)}
                    className="card-mullak group relative flex cursor-pointer flex-col justify-between gap-3 rounded-2xl border p-3.5 transition-all duration-200 hover:border-primary/50 hover:shadow-md sm:flex-row sm:items-center sm:p-4"
                  >
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <span
                        aria-hidden
                        className={`h-11 sm:h-12 w-1.5 shrink-0 rounded-full ${barColor}`}
                      />
                      <div className="grid size-11 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary border border-primary/20 group-hover:bg-primary group-hover:text-primary-foreground group-hover:scale-105 transition-all">
                        <Receipt className="size-5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="truncate font-mono text-sm font-bold text-foreground transition-colors group-hover:text-primary sm:text-base">
                            {inv.invoice_number}
                          </span>
                          <div className="shrink-0">{statusBadge(inv.status)}</div>
                          {pmChip(
                            inv.payment_method,
                            inv.note,
                            "truncate text-[11px] text-muted-foreground",
                          )}
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
                          <span className="truncate font-medium text-foreground">
                            {customerName}
                          </span>
                          {inv.customers?.phone && (
                            <span className="dir-ltr truncate font-mono text-muted-foreground/80">
                              {toSystemDigits(inv.customers.phone)}
                            </span>
                          )}
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
                          {toSystemDigits(money(total))}
                        </div>
                        {remaining > 0 ? (
                          <div className="truncate font-mono text-[10px] font-semibold text-rose-500">
                            {isRtl ? "متبقي: " : "Due: "}
                            {toSystemDigits(money(remaining))}
                          </div>
                        ) : (
                          <div className="text-[10px] font-medium text-emerald-500">
                            {isRtl ? "مدفوعة بالكامل" : "Fully paid"}
                          </div>
                        )}
                      </div>

                      <div
                        className="flex items-center gap-1 shrink-0"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {remaining > 0 && inv.status !== "cancelled" ? (
                          <button
                            type="button"
                            onClick={() => triggerQuickCollect(inv)}
                            className="inline-flex h-8 items-center gap-1 rounded-lg bg-amber-500/10 px-2.5 text-xs font-semibold text-amber-500 hover:bg-amber-500/20 transition"
                            title={isRtl ? "تحصيل سريع" : "Quick Collect"}
                          >
                            <Wallet className="h-3.5 w-3.5" />
                            <span className="hidden md:inline">{isRtl ? "تحصيل" : "Collect"}</span>
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => void openPrintPreview(inv)}
                            className="inline-flex h-8 items-center gap-1 rounded-lg border border-border bg-surface px-2.5 text-xs font-medium text-foreground hover:bg-surface-2 transition"
                            title={isRtl ? "طباعة" : "Print"}
                          >
                            <Printer className="h-3.5 w-3.5" />
                            <span className="hidden md:inline">{isRtl ? "طباعة" : "Print"}</span>
                          </button>
                        )}
                        <button
                          type="button"
                          disabled={!inv.customers?.phone}
                          onClick={() => shareInvoiceWhatsApp(inv)}
                          className={`rounded-lg p-1.5 transition ${
                            inv.customers?.phone
                              ? "text-muted-foreground hover:bg-surface-2 hover:text-emerald-500 cursor-pointer"
                              : "text-muted-foreground/30 cursor-not-allowed opacity-50"
                          }`}
                          title={
                            !inv.customers?.phone
                              ? isRtl
                                ? "لا يوجد رقم هاتف مسجل"
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
                          onClick={() => openInvoice(inv)}
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
          )}

          {/* 3. Classic Table View */}
          {viewMode === "table" && (
            <div className="panel-elevated -mx-1 sm:mx-0 overflow-hidden rounded-2xl border border-border/70">
              <DataTable
                className="px-0"
                columns={columns}
                rows={filteredRows}
                rowKey={(inv) => inv.id}
                loading={loading}
                initialLoading={loading}
                error={null}
                sort={sort}
                onSortChange={setSort}
                infinite
                hasMore={Boolean(hasNextPage)}
                onLoadMore={() => {
                  if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
                }}
                loadingMore={isFetchingNextPage}
                pageSize={INVOICES_PAGE_SIZE}
                totalCount={totalInvoiceCount}
                minWidth={hasMultiWarehouse ? 1120 : 980}
                horizontalScroll={tableUsesHorizontalScroll}
                stickyHeader
                onRowClick={(inv) => openInvoice(inv)}
                empty={{
                  icon: <Receipt />,
                  title: isRtl ? "لا توجد فواتير مبيعات مطابقة" : "No matching sales invoices",
                  description:
                    search || activeFiltersCount > 0 || statusTab !== "all"
                      ? isRtl
                        ? "جرب تعديل خيارات البحث أو التصفية"
                        : "Try adjusting your search query or filters"
                      : isRtl
                        ? "يمكنك إنشاء أول فاتورة عبر نقطة البيع الآن"
                        : "Start creating invoices via the POS page",
                }}
              />
            </div>
          )}

          {/* Infinite Scroll Sentinel & Auto-update when reaching bottom */}
          <div ref={sentinelRef} className="py-6 flex flex-col items-center justify-center gap-2">
            {isFetchingNextPage ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground font-medium animate-pulse">
                <Loader2 className="size-4 animate-spin text-primary" />
                <span>{isRtl ? "جاري تحميل المزيد من الفواتير..." : "Loading more invoices…"}</span>
              </div>
            ) : hasNextPage ? (
              <button
                type="button"
                onClick={() => void fetchNextPage()}
                className="flex items-center gap-2 rounded-2xl border border-border/80 bg-surface px-6 py-2.5 text-xs font-bold text-foreground shadow-sm hover:bg-surface-2 transition active:scale-95 cursor-pointer"
              >
                <span>{isRtl ? "عرض المزيد من الفواتير" : "Load more invoices"}</span>
              </button>
            ) : rows.length > 0 ? (
              <span className="text-[11px] text-muted-foreground/60 font-medium">
                {isRtl
                  ? `تم عرض جميع الفواتير المسجلة (${toSystemDigits(rows.length.toString())})`
                  : `All registered invoices loaded (${toSystemDigits(rows.length.toString())})`}
              </span>
            ) : null}
          </div>
        </>
      )}

      {/* Advanced Filter Sheet */}
      <VortexFilterSheet
        open={filterOpen}
        onOpenChange={setFilterOpen}
        title={isRtl ? "خيارات التصفية المتقدمة للفواتير" : "Advanced Invoices Filter"}
        activeFiltersCount={activeFiltersCount}
        onReset={clearAllFilters}
      >
        {/* Date Preset */}
        <VortexFilterSection title={isRtl ? "الفترة الزمنية" : "Time Period"}>
          <div className="grid grid-cols-2 gap-2 text-xs">
            {[
              { id: "all", label: isRtl ? "كل الأوقات" : "All Time" },
              { id: "today", label: isRtl ? "اليوم" : "Today" },
              { id: "last7", label: isRtl ? "آخر 7 أيام" : "Last 7 Days" },
              { id: "thisMonth", label: isRtl ? "هذا الشهر" : "This Month" },
            ].map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setFilterDatePreset(p.id)}
                className={`rounded-lg border px-3 py-2 text-center transition ${
                  filterDatePreset === p.id
                    ? "border-primary bg-primary/10 font-semibold text-primary"
                    : "border-border bg-surface text-muted-foreground hover:bg-surface-2"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </VortexFilterSection>

        {/* Payment Method */}
        <VortexFilterSection title={isRtl ? "طريقة السداد" : "Payment Method"}>
          <div className="grid grid-cols-2 gap-2 text-xs">
            {[
              { id: "all", label: isRtl ? "الكل" : "All" },
              { id: "cash", label: isRtl ? "نقداً" : "Cash" },
              { id: "card", label: isRtl ? "شبكة/بطاقة" : "Card" },
              { id: "bank_transfer", label: isRtl ? "تحويل بنكي" : "Bank Transfer" },
              { id: "credit", label: isRtl ? "آجل" : "Credit" },
              { id: "split", label: isRtl ? "دفع مجزأ" : "Split" },
            ].map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => setFilterPaymentMethod(m.id)}
                className={`rounded-lg border px-3 py-2 text-center transition ${
                  filterPaymentMethod === m.id
                    ? "border-primary bg-primary/10 font-semibold text-primary"
                    : "border-border bg-surface text-muted-foreground hover:bg-surface-2"
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
        </VortexFilterSection>

        {/* Warehouse Selector (if multi warehouse enabled) */}
        {hasMultiWarehouse && availableWarehouses.length > 0 && (
          <VortexFilterSection title={isRtl ? "المستودع / الفرع" : "Warehouse"}>
            <select
              value={filterWarehouse}
              onChange={(e) => setFilterWarehouse(e.target.value)}
              className="h-9 w-full rounded-lg border border-input bg-surface px-3 text-xs"
            >
              <option value="all">{isRtl ? "كل المستودعات" : "All Warehouses"}</option>
              {availableWarehouses.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          </VortexFilterSection>
        )}

        {/* Amount Range */}
        <VortexFilterSection title={isRtl ? "نطاق قيمة الفاتورة" : "Invoice Amount Range"}>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div>
              <label className="text-[10px] text-muted-foreground">
                {isRtl ? "من (الحد الأدنى)" : "Min"}
              </label>
              <input
                type="number"
                value={minAmount}
                onChange={(e) => setMinAmount(e.target.value)}
                placeholder="0"
                className="h-9 w-full rounded-lg border border-input bg-surface px-3 text-xs"
              />
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground">
                {isRtl ? "إلى (الحد الأقصى)" : "Max"}
              </label>
              <input
                type="number"
                value={maxAmount}
                onChange={(e) => setMaxAmount(e.target.value)}
                placeholder="0"
                className="h-9 w-full rounded-lg border border-input bg-surface px-3 text-xs"
              />
            </div>
          </div>
        </VortexFilterSection>
      </VortexFilterSheet>

      {/* Luxury Invoice Details Drawer */}
      {selected && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-end bg-black/65 backdrop-blur-xs animate-in fade-in duration-200"
          onClick={() => setSelected(null)}
        >
          <div
            className="h-full w-full max-w-2xl border-s border-border/80 bg-background/95 backdrop-blur-md p-6 shadow-2xl overflow-y-auto animate-in slide-in-from-left duration-200 relative flex flex-col justify-between"
            onClick={(e) => e.stopPropagation()}
            dir={isRtl ? "rtl" : "ltr"}
          >
            {/* Ambient decorative glow */}
            <div className="absolute -top-12 -right-12 size-48 rounded-full bg-primary/20 blur-3xl pointer-events-none" />
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-border/80 bg-surface-2/40 px-6 py-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <Receipt className="h-5 w-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-mono text-lg font-bold text-foreground">
                      {selected.invoice_number}
                    </h3>
                    <button
                      type="button"
                      onClick={() => copyInvoiceNumber(selected.invoice_number, selected.id)}
                      className="rounded p-1 text-muted-foreground hover:text-foreground"
                    >
                      {copiedInvoiceId === selected.id ? (
                        <Check className="h-3.5 w-3.5 text-emerald-500" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" />
                      )}
                    </button>
                  </div>
                  <div className="mt-0.5">
                    <VortexDateBadge date={selected.created_at} variant="subtle" />
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <div>{statusBadge(selected.status)}</div>
                <button
                  onClick={() => setSelected(null)}
                  className="rounded-lg p-1.5 text-muted-foreground hover:bg-surface-2 hover:text-foreground"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>

            {/* Modal Body */}
            <div className="flex-1 overflow-y-auto p-6 space-y-5">
              {/* Info Grid */}
              <div
                className={`grid gap-3 rounded-xl border border-border/80 bg-surface-2/30 p-4 text-xs ${
                  hasMultiWarehouse ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-1 sm:grid-cols-3"
                }`}
              >
                <div>
                  <span className="text-[10px] uppercase font-semibold text-muted-foreground">
                    {isRtl ? "العميل" : "Customer"}
                  </span>
                  <p className="mt-0.5 text-sm font-semibold text-foreground">
                    {selected.customers?.name ?? (isRtl ? "عميل نقدي" : "Walk-in")}
                  </p>
                  {selected.customers?.phone && (
                    <p className="text-[11px] text-muted-foreground dir-ltr">
                      {toSystemDigits(selected.customers.phone)}
                    </p>
                  )}
                </div>

                {hasMultiWarehouse && (
                  <div>
                    <span className="text-[10px] uppercase font-semibold text-muted-foreground">
                      {isRtl ? "المستودع / الفرع" : "Warehouse"}
                    </span>
                    <p className="mt-0.5 text-sm font-semibold text-foreground">
                      {whName(selected.warehouses) ?? "—"}
                    </p>
                  </div>
                )}

                <div>
                  <span className="text-[10px] uppercase font-semibold text-muted-foreground">
                    {isRtl ? "طريقة السداد" : "Payment Method"}
                  </span>
                  <div className="mt-0.5 text-sm font-medium text-foreground">
                    {pmChip(selected.payment_method, selected.note)}
                  </div>
                </div>

                <div>
                  <span className="text-[10px] uppercase font-semibold text-muted-foreground">
                    {isRtl ? "حالة السداد" : "Payment Status"}
                  </span>
                  <p className="mt-0.5 text-sm font-semibold text-foreground">
                    {statusLabel(selected.status)}
                  </p>
                </div>
              </div>

              {/* Note / Split details if present */}
              {selected.note && (
                <div className="rounded-xl border border-border/80 bg-surface-2/40 p-3 text-xs text-muted-foreground">
                  <span className="font-semibold text-foreground me-1">
                    {isRtl ? "الملاحظات وتفاصيل الدفع:" : "Note & Payment Details:"}
                  </span>
                  {selected.note}
                </div>
              )}

              {/* Items Table */}
              <div>
                <h4 className="mb-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  {isRtl ? "بنود الفاتورة والمنتجات" : "Invoice Items"}
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
                          {isRtl ? "سعر الوحدة" : "Unit Price"}
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
                              {/* الاسم العربي أولاً — أسماء المنتجات الإنجليزية
                                  كانت تظهر في واجهة عربية عند غياب name_ar. */}
                              <div className="font-medium text-foreground">
                                {l.products?.name_ar || l.products?.name || "—"}
                              </div>
                              {/* بند خدمة الطحن (line_type = SERVICE) لا يخصم مخزوناً؛
                                  إظهاره يمنع افتراض أنه بضاعة مخزنية. */}
                              {l.line_type === "SERVICE" && (
                                <div className="mt-0.5 text-[10px] font-bold text-amber-600 dark:text-amber-400">
                                  {isRtl
                                    ? "بند خدمة — لا يخصم مخزوناً"
                                    : "Service line — no stock impact"}
                                </div>
                              )}
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
                              {toSystemDigits(money(Number(l.unit_price)))}
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

              {/* Financial Totals Breakdown */}
              <div className="rounded-xl border border-border/80 bg-surface-2/30 p-4 text-xs space-y-1.5">
                <div className="flex justify-between text-muted-foreground">
                  <span>{isRtl ? "المجموع الفرعي (قبل الضريبة):" : "Subtotal:"}</span>
                  <span className="font-mono">
                    {toSystemDigits(money(Number(selected.subtotal)))}
                  </span>
                </div>
                {Number(selected.discount) > 0 && (
                  <div className="flex justify-between text-emerald-500">
                    <span>{isRtl ? "الخصم الممنوح:" : "Discount:"}</span>
                    <span className="font-mono">
                      -{toSystemDigits(money(Number(selected.discount)))}
                    </span>
                  </div>
                )}
                {Number(selected.tax) > 0 && (
                  <div className="flex justify-between text-muted-foreground">
                    <span>{isRtl ? "ضريبة القيمة المضافة:" : "VAT / Tax:"}</span>
                    <span className="font-mono">{toSystemDigits(money(Number(selected.tax)))}</span>
                  </div>
                )}
                <div className="flex justify-between border-t border-border pt-1.5 text-sm font-bold text-foreground">
                  <span>{isRtl ? "الإجمالي الكلي:" : "Grand Total:"}</span>
                  <span className="font-mono text-base">
                    {toSystemDigits(money(Number(selected.total)))}
                  </span>
                </div>
                <div className="flex justify-between text-emerald-500 font-medium">
                  <span>{isRtl ? "المسدد نقداً / مدفوع:" : "Paid:"}</span>
                  <span className="font-mono">{toSystemDigits(money(Number(selected.paid)))}</span>
                </div>
                {Math.max(0, Number(selected.total) - Number(selected.paid)) > 0 && (
                  <div className="flex justify-between text-rose-500 font-bold border-t border-border/60 pt-1 text-xs">
                    <span>{isRtl ? "المتبقي (دين آجل مستحق):" : "Remaining Due:"}</span>
                    <span className="font-mono">
                      {toSystemDigits(
                        money(Math.max(0, Number(selected.total) - Number(selected.paid))),
                      )}
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Modal Footer / Actions */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/80 bg-surface-2/40 px-6 py-4">
              <div className="flex items-center gap-2">
                {/* WhatsApp invoice share */}
                <div className="flex flex-col items-start gap-1">
                  {!selected.customers?.phone && (
                    <span className="flex items-center gap-1 text-[11px] text-amber-500 font-semibold">
                      <AlertCircle className="size-3" />
                      {isRtl
                        ? "هذا العميل لا يوجد لديه رقم هاتف مسجل في النظام."
                        : "This customer has no phone number registered in the system."}
                    </span>
                  )}
                  <button
                    type="button"
                    disabled={!selected.customers?.phone}
                    onClick={() => shareInvoiceWhatsApp(selected)}
                    title={
                      !selected.customers?.phone
                        ? isRtl
                          ? "هذا العميل لا يوجد لديه رقم هاتف مسجل في النظام"
                          : "This customer has no phone number registered"
                        : isRtl
                          ? "مشاركة واتساب"
                          : "WhatsApp"
                    }
                    className={`inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold transition ${
                      selected.customers?.phone
                        ? "border border-emerald-500/30 bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20 cursor-pointer"
                        : "border border-border/60 bg-muted/40 text-muted-foreground/40 cursor-not-allowed opacity-50"
                    }`}
                  >
                    <WhatsAppIcon className="h-4 w-4" />
                    <span>{isRtl ? "مشاركة واتساب" : "WhatsApp"}</span>
                  </button>
                </div>

                {/* PDF */}
                <button
                  type="button"
                  onClick={doPDF}
                  className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-surface px-3 text-xs font-medium text-foreground hover:bg-surface-2 transition"
                >
                  <FileDown className="h-4 w-4" />
                  <span>{isRtl ? "تحميل PDF" : "PDF"}</span>
                </button>
              </div>

              <div className="flex items-center gap-2">
                {/* Quick Collect Button if invoice has balance */}
                {Math.max(0, Number(selected.total) - Number(selected.paid)) > 0 &&
                  selected.status !== "cancelled" && (
                    <button
                      type="button"
                      onClick={() => {
                        triggerQuickCollect(selected);
                        setSelected(null);
                      }}
                      className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-amber-500 px-4 text-xs font-semibold text-amber-950 shadow-sm hover:bg-amber-400 transition"
                    >
                      <Wallet className="h-4 w-4" />
                      <span>{isRtl ? "تحصيل الدفعة الآن" : "Collect Payment"}</span>
                    </button>
                  )}

                <button
                  type="button"
                  onClick={async () => {
                    const doc = await buildDoc();
                    if (doc) setPrintDoc(doc);
                  }}
                  className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-4 text-xs font-semibold text-primary-foreground shadow-sm hover:opacity-95 transition"
                >
                  <Printer className="h-4 w-4" />
                  <span>{isRtl ? "طباعة الفاتورة" : "Print"}</span>
                </button>

                <button
                  type="button"
                  onClick={() => setSelected(null)}
                  className="h-9 rounded-lg border border-border bg-surface px-4 text-xs font-medium text-foreground hover:bg-surface-2 transition"
                >
                  {isRtl ? "إغلاق" : "Close"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Luxury Print Preview Modal */}
      {printDoc && (
        <LuxuryPrintPreviewModal
          open={Boolean(printDoc)}
          onClose={() => setPrintDoc(null)}
          doc={printDoc}
          documentType="customer_invoice"
          title={isRtl ? "معاينة وطباعة فاتورة المبيعات" : "Sales Invoice Print Preview"}
          customerPhone={selected?.customers?.phone || undefined}
          customerName={selected?.customers?.name || undefined}
        />
      )}

      {/* Vortex Collection Sheet for Quick Collection */}
      <VortexCollectionSheet
        open={collectionOpen}
        onOpenChange={setCollectionOpen}
        customer={
          collectionTarget
            ? {
                id: collectionTarget.customerId || "temp",
                name: collectionTarget.customerName,
                phone: collectionTarget.phone,
                balance: collectionTarget.balance,
              }
            : null
        }
        onSavePayment={handleSaveCollection}
        onSuccess={() => {
          void load();
        }}
      />
    </div>
  );
}

function TemplateCard({
  icon,
  title,
  desc,
  accent,
  onClick,
}: {
  icon: ReactNode;
  title: string;
  desc: string;
  accent: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group relative overflow-hidden rounded-xl border bg-gradient-to-br p-4 text-start transition hover:scale-[1.02] hover:shadow-lg ${accent}`}
    >
      <div className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-lg bg-background/70 backdrop-blur">
        {icon}
      </div>
      <div className="text-sm font-bold text-foreground">{title}</div>
      <div className="mt-1 text-xs text-muted-foreground leading-relaxed">{desc}</div>
    </button>
  );
}

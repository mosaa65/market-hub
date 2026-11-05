import { cn } from "@/lib/utils";
import { usePersistedViewMode } from "@/hooks/use-persisted-view-mode";
import { RecordsViewToggle } from "@/components/ui/records-view-toggle";
import { QuickFilterBar } from "@/components/ui/quick-filter-bar";
import { PrimaryAction } from "@/components/ui/primary-action";
import { InvoiceSectionTabs } from "@/components/invoices/invoice-section-tabs";
import type { RecordsViewMode } from "@/components/ui/records-view";
import { createFileRoute, Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Receipt,
  FileText,
  Eye,
  MessageSquare,
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
  List,
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
  Scale,
  ShoppingBag,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { AmountInput } from "@/components/ui/amount-input";
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
  VortexInvoiceDetailsSheet,
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
import { type DataTableColumn, type DataTableSort } from "@/components/ui/data-table";
import { RecordsView } from "@/components/ui/records-view";
import { StatusBadge } from "@/components/ui/status-badge";
import { IconButton } from "@/components/ui/icon-button";
import { useBreakpoint } from "@/design/breakpoints";
import { useRealtimeTable } from "@/lib/realtime";
import { QUERY_KEYS } from "@/lib/query-keys";
import {
  isSplitPaymentValue,
  PAYMENT_METHOD_CATALOG,
  paymentMethodLabel,
} from "@/lib/payments/payment-methods";
import { PaymentMethodChip } from "@/components/ui/payment-method";

export const Route = createFileRoute("/_app/sales")({
  validateSearch: (search: Record<string, unknown>): { customerId?: string } => ({
    customerId: typeof search.customerId === "string" ? search.customerId : undefined,
  }),
  head: () => ({ meta: [{ title: "المبيعات والفواتير — فورتيكس ERP" }] }),
  component: SalesPage,
});

interface CustomerInfo {
  id?: string;
  name: string;
  phone?: string | null;
  /** The seeded cash customer — a walk-in sale, not a named account. */
  is_system?: boolean | null;
}

/**
 * The party an invoice is addressed to.
 *
 * The screen used to invent a "عميل نقدي" label whenever `customer_id` was
 * null, which made a second cash customer that existed only in this list: the
 * sale could not be found on the real cash account's statement. The system cash
 * customer is now always linked, so the label is read from the invoice itself
 * and only falls back for genuinely unlinked historic rows (shown muted, so it
 * is obvious nobody's account holds them).
 */
const WALK_IN_FALLBACK = { ar: "عميل نقدي", en: "Walk-in" } as const;

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
  entered_quantity?: number | null;
  entered_unit_price?: number | null;
  uom_id?: string | null;
  uom_conversion_factor?: number | null;
  unit_price: number;
  tax: number;
  total: number;
  /** SERVICE = بند أجرة (طحن/تعبئة)، GOOD = بضاعة. يميّز بنود المطحنة
   *  التي لا يخصم منها مخزون عن بضاعة مخزنية. */
  line_type?: string | null;
  stock_effect?: string | null;
  products: { name: string; name_ar?: string | null; sku: string | null } | null;
}

type StatusTab = "all" | "paid" | "partial" | "unpaid" | "cancelled" | "cash";
/** Unified records vocabulary — `cards` (was "cards"), list, table. */
type ViewMode = RecordsViewMode;

const INVOICES_PAGE_SIZE = 50;

export function SalesPage() {
  const { customerId: searchCustomerId } = useSearch({ from: "/_app/sales" });
  const { t, lang } = useI18n();
  const { isModuleEnabled } = useModules();
  const hasMultiWarehouse = isModuleEnabled("multi_warehouse");
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [search, setSearch] = useState("");
  const [statusTab, setStatusTab] = useState<StatusTab>("all");
  const [filters, setFilters] = useState<FilterValues>({});
  const [sortKey, setSortKey] = useState<string>("date_desc");
  const [viewMode, setViewMode] = usePersistedViewMode("sales", "cards");

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

  /** Party name + whether it is the seeded cash party (walk-in). */
  const party = useCallback(
    (inv: Invoice): { name: string; isCash: boolean; isLinked: boolean } => {
      const linked = inv.customers;
      if (linked) {
        return {
          name: linked.name,
          isCash: Boolean(linked.is_system),
          isLinked: true,
        };
      }
      return {
        name: isRtl ? WALK_IN_FALLBACK.ar : WALK_IN_FALLBACK.en,
        isCash: true,
        isLinked: false,
      };
    },
    [isRtl],
  );

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
          "id,invoice_number,status,subtotal,discount,tax,total,paid,payment_method,note,created_at,customer_id,warehouse_id,customers(id,name,phone,is_system),warehouses(name,name_ar)",
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

  // Keep the sentinel near the viewport bottom for all three record modes.
  const setSentinelRef = (node: HTMLDivElement | null) => {
    sentinelRef.current = node;
  };

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
          "id,quantity,unit_price,tax,total,line_type,stock_effect,entered_quantity,entered_unit_price,uom_id,uom_conversion_factor,products(name,name_ar,sku),uom:units!sales_invoice_items_uom_id_fkey(name,name_ar)",
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
          "id,quantity,unit_price,tax,total,line_type,stock_effect,entered_quantity,entered_unit_price,uom_id,uom_conversion_factor,products(name,name_ar,sku),uom:units!sales_invoice_items_uom_id_fkey(name,name_ar)",
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

  const invoiceStatusMeta = (status: string) => {
    const labels: Record<string, string> = {
      draft: isRtl ? "مسودة" : "Draft",
      confirmed: isRtl ? "مؤكدة" : "Confirmed",
      paid: isRtl ? "مدفوعة بالكامل" : "Paid",
      partial: isRtl ? "دفع جزئي" : "Partial",
      unpaid: isRtl ? "غير مدفوعة (آجل)" : "Unpaid",
      cancelled: isRtl ? "ملغاة" : "Cancelled",
      returned: isRtl ? "مرتجعة" : "Returned",
      received: isRtl ? "مستلمة" : "Received",
      completed: isRtl ? "مكتملة" : "Completed",
    };
    const tones: Record<string, { badge: string; bar: string }> = {
      draft: {
        badge: "border-border bg-surface-2 text-muted-foreground",
        bar: "bg-slate-400",
      },
      confirmed: {
        badge: "border-sky-500/30 bg-sky-500/10 text-sky-600 dark:text-sky-400",
        bar: "bg-sky-500",
      },
      paid: {
        badge: "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
        bar: "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.4)]",
      },
      partial: {
        badge: "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400",
        bar: "bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.5)]",
      },
      unpaid: {
        badge: "border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-400",
        bar: "bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.5)]",
      },
      cancelled: {
        badge: "border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400",
        bar: "bg-red-500",
      },
      returned: {
        badge: "border-violet-500/30 bg-violet-500/10 text-violet-600 dark:text-violet-400",
        bar: "bg-violet-500",
      },
      received: {
        badge: "border-cyan-500/30 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300",
        bar: "bg-cyan-500",
      },
      completed: {
        badge: "border-teal-500/30 bg-teal-500/10 text-teal-700 dark:text-teal-300",
        bar: "bg-teal-500",
      },
    };
    return {
      label: labels[status] ?? status,
      ...(tones[status] ?? {
        badge: "border-border bg-surface-2 text-muted-foreground",
        bar: "bg-muted-foreground/30",
      }),
    };
  };

  const statusLabel = (status: string) => invoiceStatusMeta(status).label;

  const statusBadge = (status: string) => {
    const meta = invoiceStatusMeta(status);
    const Icon =
      status === "paid" || status === "completed" || status === "received"
        ? CheckCircle2
        : status === "partial" || status === "confirmed"
          ? Clock
          : status === "cancelled" || status === "returned"
            ? XCircle
            : status === "unpaid"
              ? AlertCircle
              : FileText;
    return (
      <span
        className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium ${meta.badge}`}
      >
        <Icon className="h-3 w-3" />
        {meta.label}
      </span>
    );
  };

  // WhatsApp Message Generator via Unified Communication Engine

  const shareInvoiceSms = (inv: Invoice) => {
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
    const text = isRtl
      ? `فاتورة مبيعات #${inv.invoice_number}\nالعميل: ${inv.customers?.name || "العميل الكريم"}\nالإجمالي: ${money(Number(inv.total))}\nالمدفوع: ${money(Number(inv.paid))}${remaining > 0 ? `\nالمتبقي: ${money(remaining)}` : ""}`
      : `Sales Invoice #${inv.invoice_number}\nTotal: ${money(Number(inv.total))}\nPaid: ${money(Number(inv.paid))}${remaining > 0 ? `\nDue: ${money(remaining)}` : ""}`;

    const clean = (inv.customers?.phone || "").replace(/[^\d+]/g, "");
    window.open(`sms:${clean}?body=${encodeURIComponent(text)}`, "_blank");
  };

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
        date: inv.created_at,
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
      customerName: party(inv).name,
      phone: inv.customers?.phone || undefined,
      balance: remaining,
    });
    setCollectionOpen(true);
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
      date: invoice.created_at,
      partyLabel: isRtl ? "العميل / المشترى:" : "Bill To:",
      partyName: party(invoice).name,
      warehouse: hasMultiWarehouse ? (whName(invoice.warehouses) ?? undefined) : undefined,
      payment: pmLabel(invoice.payment_method, invoice.note),
      status: statusLabel(invoice.status),
      lines: invoiceLines.map((l) => ({
        product: l.products?.name_ar || l.products?.name || "—",
        qty: Number(l.entered_quantity ?? l.quantity),
        unit: (l as any).uom?.name_ar || (l as any).uom?.name || undefined,
        price: Number(l.entered_unit_price ?? l.unit_price),
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
        //
        // الخيارات من الكتالوج، لا قائمة مكتوبة هنا.
        //
        // القائمة اليدوية كانت خمسة عناصر تُكتب بصيغة تخالف بقية الشاشات
        // («نقدي (كاش)» مقابل «نقدي»)، وتنسى الشيك تمامًا، فلا يمكن تصفية
        // الشيكات في سجل الفواتير أبدًا. المستند يخزّن قيمة `legacyValue`،
        // والخريطة منها إلى الاسم البشري موجودة في مكان واحد.
        options: Array.from(
          new Map(
            PAYMENT_METHOD_CATALOG.filter(
              (method) => method.id === "split" || method.legacyValue !== "split",
            ).map((method) => [
              method.legacyValue,
              {
                value: method.legacyValue,
                label: isRtl ? method.nameAr : (method.nameEn ?? method.nameAr),
              },
            ]),
          ).values(),
        ),
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
      { value: "cash_first", label: isRtl ? "البيع النقدي أولاً" : "Cash sales first" },
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
        sortValue: (inv) => party(inv).name,
        cell: (inv) => {
          const { name, isCash, isLinked } = party(inv);
          return (
            <div className="flex items-center gap-2 py-0.5">
              <span
                className={
                  isCash
                    ? "grid size-7 shrink-0 place-items-center rounded-full border border-primary/25 bg-primary/10 text-[10px] font-bold text-primary"
                    : "grid size-7 shrink-0 place-items-center rounded-full bg-surface-2 text-[10px] font-bold text-muted-foreground"
                }
              >
                {isCash ? <ShoppingBag className="size-3.5" /> : name.slice(0, 1).toUpperCase()}
              </span>
              <div className="min-w-0">
                <span
                  className={`block truncate text-xs ${isLinked ? "font-medium text-foreground" : "font-medium italic text-muted-foreground"}`}
                >
                  {name}
                </span>
                <span className="block truncate text-[10px] text-muted-foreground">
                  {isCash ? (isRtl ? "بيع نقدي" : "Cash sale") : (inv.customers?.phone ?? "")}
                </span>
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
      // 1. Status Tab — `cash` is a party segment, not an invoice status: it
      //    gathers every sale booked to the seeded cash customer, which is what
      //    an operator counting the day's walk-in takings actually needs.
      if (statusTab === "cash") {
        if (!party(r).isCash) return false;
      } else if (statusTab !== "all" && r.status !== statusTab) {
        return false;
      }

      // Customer filter from URL (e.g. from customer statement)
      if (searchCustomerId && r.customer_id !== searchCustomerId) {
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
            return party(a).name.localeCompare(party(b).name, "ar") * dir;
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
        case "cash_first":
          // Cash-party sales surface first; within each group the newest wins,
          // so the strip reads as "today's walk-in takings" at the top.
          return (
            Number(party(b).isCash) - Number(party(a).isCash) ||
            new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
          );
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
    party,
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
    searchCustomerId,
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
      <InvoiceSectionTabs kind="sales" active="list" />
      {/* ─── Unified Top Header & Quick Action Bar — Full width & responsive ─── */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between w-full">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl sm:text-2xl font-black text-foreground tracking-tight">
              {t("sales.title") || (isRtl ? "المبيعات والفواتير" : "Sales & Invoices")}
            </h1>
            <span className="inline-flex items-center rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-semibold text-primary">
              {toSystemDigits(
                totalInvoiceCount != null ? totalInvoiceCount.toString() : rows.length.toString(),
              )}
            </span>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            {t("sales.subtitle") ||
              (isRtl
                ? "متابعة فواتير المبيعات، المدفوعات، التحصيلات الفورية والطباعة الفاخرة"
                : "Track sales invoices, collections, payment statuses and luxury printing")}
          </p>
        </div>

        {/* Quick action buttons row */}
        <div className="flex w-full sm:w-auto items-center justify-end gap-2">
          {/* Main Action buttons */}
          <div className="flex items-center gap-1.5 sm:gap-2">
            {isModuleEnabled("milling_operations") && (
              <Link
                to="/milling/intake"
                className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 sm:px-3.5 text-xs font-semibold text-amber-700 dark:text-amber-300 shadow-xs transition hover:bg-amber-500/20"
                title={isRtl ? "استقبال وفواتير الطحن" : "Milling Desk"}
              >
                <Scale className="h-4 w-4 shrink-0 text-amber-600" />
                <span className="hidden xs:inline">
                  {isRtl ? "خدمات وفواتير الطحن" : "Milling Desk"}
                </span>
              </Link>
            )}
            <Link
              to="/sales-invoice/new"
              className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-primary px-3 sm:px-3.5 text-xs font-semibold text-primary-foreground shadow-xs transition hover:opacity-95"
              title={isRtl ? "إنشاء فاتورة مبيعات" : "Create sales invoice"}
            >
              <Plus className="h-4 w-4 shrink-0" />
              <span>
                {t("sales.new_invoice") || (isRtl ? "فاتورة مبيعات جديدة" : "New sales invoice")}
              </span>
            </Link>
          </div>
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
            ? "ابحث برقم الفاتورة، العميل، الهاتف... (/)"
            : "Search invoice #, customer, phone... (/)",
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
        viewToggle={<RecordsViewToggle value={viewMode} onChange={setViewMode} />}
        action={
          <PrimaryAction
            label={isRtl ? "فاتورة جديدة" : "New Invoice"}
            icon={<Plus />}

            onClick={() => void navigate({ to: "/pos" })}
          />
        }
      >
        {/* Quick Filter Tabs — the shared coloured strip, visible in ALL view modes */}
        <QuickFilterBar
          value={statusTab}
          onChange={(id) => setStatusTab(id as StatusTab)}
          items={[
            {
              id: "all",
              label: isRtl ? "الكل" : "All",
              count: totalInvoiceCount ?? rows.length,
              tone: "primary",
            },
            {
              id: "cash",
              label: isRtl ? "بيع نقدي" : "Cash sale",
              count: rows.filter((r) => party(r).isCash).length,
              tone: "info",
            },
            {
              id: "paid",
              label: isRtl ? "مسددة" : "Paid",
              count: metrics.paidCount,
              tone: "success",
            },
            {
              id: "partial",
              label: isRtl ? "دفع جزئي" : "Partial",
              count: metrics.partialCount,
              tone: "warning",
            },
            {
              id: "unpaid",
              label: isRtl ? "غير مسددة (آجلة)" : "Unpaid",
              count: metrics.unpaidCount,
              tone: "danger",
            },
            {
              id: "cancelled",
              label: isRtl ? "ملغاة" : "Cancelled",
              count: metrics.cancelledCount,
              tone: "danger",
            },
          ]}
        />
      </TableToolbar>

      {/* ─── Records: cards / list / classic table — shared scaffold ─── */}
      <RecordsView<Invoice>
        rows={filteredRows}
        getRowId={(inv) => inv.id}
        viewMode={viewMode}
        loading={loading}
        columns={columns}
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
        cardsInfinite
        minWidth={hasMultiWarehouse ? 1120 : 980}
        horizontalScroll={tableUsesHorizontalScroll}
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
          action: (
            <Link
              to="/sales-invoice/new"
              className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground"
            >
              <Plus className="h-3 w-3" />
              {isRtl ? "إنشاء فاتورة مبيعات" : "Create sales invoice"}
            </Link>
          ),
        }}
        renderCard={(inv) => {
          const total = Number(inv.total) || 0;
          const paid = Number(inv.paid) || 0;
          const remaining = Math.max(0, total - paid);
          const { name: customerName, isCash } = party(inv);

          return (
            <div
              data-qa="sales-card"
              className="card-mullak group relative flex h-full cursor-pointer flex-col justify-between overflow-hidden rounded-2xl p-3 transition-all duration-200 hover:shadow-md sm:p-4.5"
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
                    <div
                      className={
                        isCash
                          ? "grid size-6 shrink-0 place-items-center rounded-full border border-primary/25 bg-primary/10 text-primary"
                          : "grid size-6 shrink-0 place-items-center rounded-full bg-surface-2 text-[10px] font-bold"
                      }
                    >
                      {isCash ? (
                        <ShoppingBag className="size-3" />
                      ) : (
                        customerName.slice(0, 1).toUpperCase()
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1 truncate font-medium text-foreground">
                        <span className="truncate">{customerName}</span>
                        {isCash && (
                          <span className="shrink-0 rounded-full border border-primary/25 bg-primary/10 px-1.5 text-[9px] font-bold text-primary">
                            {isRtl ? "نقدي" : "Cash"}
                          </span>
                        )}
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
                    <span className="text-muted-foreground">{isRtl ? "المدفوع" : "Paid"}</span>
                    <span className="truncate font-mono font-medium text-emerald-500">
                      {toSystemDigits(money(paid))}
                    </span>
                  </div>
                  {remaining > 0 && (
                    <div className="flex items-center justify-between gap-2 border-t border-border/40 pt-1.5 font-semibold text-rose-500">
                      <span>{isRtl ? "المتبقي (آجل)" : "Remaining Due"}</span>
                      <span className="truncate font-mono">{toSystemDigits(money(remaining))}</span>
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
                    disabled={!inv.customers?.phone}
                    onClick={() => shareInvoiceSms(inv)}
                    className={`grid size-8 place-items-center rounded-lg border transition ${
                      inv.customers?.phone
                        ? "border-border/70 text-muted-foreground hover:bg-surface-2 hover:text-blue-500 cursor-pointer"
                        : "border-border/40 text-muted-foreground/30 cursor-not-allowed opacity-50"
                    }`}
                    title={
                      !inv.customers?.phone
                        ? isRtl
                          ? "هذا العميل لا يوجد لديه رقم هاتف مسجل في النظام"
                          : "This customer has no phone number registered"
                        : isRtl
                          ? "مشاركة عبر رسالة نصية SMS"
                          : "Share via SMS"
                    }
                  >
                    <MessageSquare className="h-4 w-4" />
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
        }}
        renderListRow={(inv) => {
          const total = Number(inv.total) || 0;
          const paid = Number(inv.paid) || 0;
          const remaining = Math.max(0, total - paid);
          const { name: customerName, isCash } = party(inv);
          const barColor = invoiceStatusMeta(inv.status).bar;

          return (
            <div className="card-mullak group relative flex cursor-pointer flex-col justify-between gap-3 rounded-2xl border p-3.5 transition-all duration-200 hover:border-primary/50 hover:shadow-md sm:flex-row sm:items-center sm:p-4">
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
                    <span
                      className={
                        isCash
                          ? "inline-flex items-center gap-1 truncate rounded-full border border-primary/25 bg-primary/10 px-2 py-0.5 text-[10px] font-bold text-primary"
                          : "truncate font-medium text-foreground"
                      }
                    >
                      {isCash && <ShoppingBag className="size-2.5" />}
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
                    disabled={!inv.customers?.phone}
                    onClick={() => shareInvoiceSms(inv)}
                    className={`rounded-lg p-1.5 transition ${
                      inv.customers?.phone
                        ? "text-muted-foreground hover:bg-surface-2 hover:text-blue-500 cursor-pointer"
                        : "text-muted-foreground/30 cursor-not-allowed opacity-50"
                    }`}
                    title={
                      !inv.customers?.phone
                        ? isRtl
                          ? "لا يوجد رقم هاتف مسجل"
                          : "No phone registered"
                        : isRtl
                          ? "مشاركة عبر رسالة SMS"
                          : "Share via SMS"
                    }
                  >
                    <MessageSquare className="h-4 w-4" />
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
        }}
      />

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
            {/*
              نفس خيارات الفلترة أعلاه — مشتقة من الكتالوج.
              كانت هنا قائمة ثانية مكتوبة يدويًا («نقداً»، «دفع مجزأ») تختلف
              عن القائمة الأولى في نفس الشاشة، وعن الأسماء المطبوعة على
              الفواتير. الآن المصدر واحد.
            */}
            {[
              { id: "all", label: isRtl ? "الكل" : "All" },
              ...Array.from(
                new Map(
                  PAYMENT_METHOD_CATALOG.map((method) => [
                    method.legacyValue,
                    {
                      id: method.legacyValue,
                      label: isRtl ? method.nameAr : (method.nameEn ?? method.nameAr),
                    },
                  ]),
                ).values(),
              ),
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
              <AmountInput
                min={0}
                showInWords={false}
                value={minAmount === "" ? null : Number(minAmount)}
                onValueChange={(v) => setMinAmount(v == null ? "" : String(v))}
                placeholder="0"
                aria-label={isRtl ? "الحد الأدنى" : "Min"}
                containerClassName="[&_input]:h-9 [&_input]:rounded-lg [&_input]:bg-surface [&_input]:text-xs"
              />
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground">
                {isRtl ? "إلى (الحد الأقصى)" : "Max"}
              </label>
              <AmountInput
                min={0}
                showInWords={false}
                value={maxAmount === "" ? null : Number(maxAmount)}
                onValueChange={(v) => setMaxAmount(v == null ? "" : String(v))}
                placeholder="0"
                aria-label={isRtl ? "الحد الأقصى" : "Max"}
                containerClassName="[&_input]:h-9 [&_input]:rounded-lg [&_input]:bg-surface [&_input]:text-xs"
              />
            </div>
          </div>
        </VortexFilterSection>
      </VortexFilterSheet>

      {/* ─── Luxury Invoice Details Sheet (Vortex UI) ─── */}
      <VortexInvoiceDetailsSheet
        open={Boolean(selected)}
        onOpenChange={(isOpen) => {
          if (!isOpen) setSelected(null);
        }}
        type="sale"
        invoice={
          selected
            ? {
                id: selected.id,
                invoice_number: selected.invoice_number,
                created_at: selected.created_at,
                status: selected.status,
                subtotal: selected.subtotal,
                discount: selected.discount,
                tax: selected.tax,
                total: selected.total,
                paid: selected.paid,
                payment_method: selected.payment_method,
                note: selected.note,
                warehouseName: whName(selected.warehouses),
              }
            : null
        }
        party={{
          name: selected?.customers?.name ?? (isRtl ? "عميل نقدي" : "Walk-in"),
          phone: selected?.customers?.phone,
          roleLabel: isRtl ? "العميل" : "Customer",
        }}
        items={lines.map((l) => ({
          id: l.id,
          name: l.products?.name || "—",
          name_ar: l.products?.name_ar,
          sku: l.products?.sku,
          quantity: l.entered_quantity ?? l.quantity,
          unit: (l as any).uom?.name_ar || (l as any).uom?.name || null,
          unitPrice: l.entered_unit_price ?? l.unit_price,
          total: l.total,
          line_type: l.line_type,
        }))}
        loadingItems={loadingLines}
        hasMultiWarehouse={hasMultiWarehouse}
        pmLabel={pmLabel}
        statusLabel={statusLabel}
        statusBadge={statusBadge}
        onPrint={async () => {
          const doc = await buildDoc();
          if (doc) setPrintDoc(doc);
        }}
        onWhatsApp={() => {
          if (selected) shareInvoiceWhatsApp(selected);
        }}
        onSms={() => {
          if (selected) shareInvoiceSms(selected);
        }}
        onPdf={doPDF}
        onQuickCollect={() => {
          if (selected) {
            triggerQuickCollect(selected);
            setSelected(null);
          }
        }}
        copyInvoiceNumber={copyInvoiceNumber}
        copiedInvoiceId={copiedInvoiceId}
      />

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
        initialInvoiceId={collectionTarget?.invoiceId}
        invoices={
          collectionTarget
            ? [{ id: collectionTarget.invoiceId, total: collectionTarget.balance, paid: 0 }]
            : []
        }
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

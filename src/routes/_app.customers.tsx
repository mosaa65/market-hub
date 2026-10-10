import { useModules } from "@/lib/modules";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Users,
  Plus,
  Search,
  Pencil,
  Trash2,
  X,
  MoreVertical,
  Wallet,
  AlertTriangle,
  FileText,
  ShoppingCart,
  Star,
  Receipt,
  Printer,
  CreditCard,
  Calendar,
  MapPin,
  Mail,
  User,
  Phone,
  CheckCircle2,
  Loader2,
  Sparkles,
  MessageSquareText,
  LayoutGrid,
  List,
  TableProperties,
  ChevronLeft,
  DollarSign,
  TrendingUp,
  ShieldCheck,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";
import { money } from "@/lib/format";
import { useDebtIndex } from "@/hooks/use-debts-overview";
import { StatementIntegrityBadge } from "@/components/statements/statement-integrity-badge";
import {
  VortexCollectionSheet,
  VortexMetricCard,
  type PaymentMethod,
} from "@/components/vortex-ui";
import { toLegacyPaymentValue } from "@/lib/payments/payment-methods";
import { toast } from "sonner";
import { WhatsAppIcon } from "@/components/whatsapp-icon";
import { Ltr } from "@/components/ltr-value";
import { CustomerCommunicationMenu } from "@/components/communication/customer-communication-menu";
import { buildUnifiedContext, renderMessage } from "@/lib/communication";
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
import { CustomerFormDialog } from "@/components/contacts/customer-form-dialog";

export const Route = createFileRoute("/_app/customers")({
  head: () => ({ meta: [{ title: "العملاء — فورتيكس ERP" }] }),
  component: CustomersPage,
});

interface Customer {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  credit_limit: number;
  balance: number;
  loyalty_points: number;
  is_active: boolean;
  created_at: string;
}

type FilterType = "all" | "debt" | "credit" | "active";
type ViewMode = "cards" | "list" | "table";

function handleCustomerSMS(customer: Customer, lang: "ar" | "en") {
  if (!customer.phone) return;
  const phone = customer.phone.replace(/[^\d+]/g, "");
  const ctx = buildUnifiedContext({
    event: Number(customer.balance) > 0 ? "debt_reminder" : "general_customer_notice",
    customer: {
      id: customer.id,
      name: customer.name,
      phone: customer.phone,
      balance: Number(customer.balance),
    },
    language: lang,
  });
  const text = renderMessage(ctx).text;
  window.open(`sms:${phone}?body=${encodeURIComponent(text)}`, "_blank");
}

function CustomersPage() {
  const { t, lang } = useI18n();
  const { isModuleEnabled } = useModules();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState<FilterType>("all");
  const [filters, setFilters] = useState<FilterValues>({});
  const [sortKey, setSortKey] = useState<string>("name_asc");
  const [viewMode, setViewMode] = useState<ViewMode>("cards");

  /*
   * Column-header sorting for the classic table, kept separate from the
   * toolbar preset (`sortKey`). `filtered` decides precedence so a header
   * click always wins over a stale dropdown value.
   */
  const [sort, setSort] = useState<DataTableSort | null>(null);
  const breakpoint = useBreakpoint();
  const tableUsesHorizontalScroll =
    breakpoint === "xs" || breakpoint === "sm" || breakpoint === "md";
  const [edit, setEdit] = useState<Partial<Customer> | null>(null);
  const [selected, setSelected] = useState<Customer | null>(null);
  const [collectionCustomer, setCollectionCustomer] = useState<Customer | null>(null);
  const [collectionOpen, setCollectionOpen] = useState(false);
  const [activity, setActivity] = useState<
    { label: string; date: string; amount: number; kind: "sale" | "payment" }[]
  >([]);
  const [menuOpen, setMenuOpen] = useState<string | null>(null);
  const [hoveredRow, setHoveredRow] = useState<string | null>(null);
  const [detailTab, setDetailTab] = useState<"all" | "invoices" | "payments">("all");
  const menuRef = useRef<HTMLDivElement>(null);

  // أرصدة مؤكَّدة من الدفتر
  const { index: ledgerIndex } = useDebtIndex("customer");

  const {
    data: rows = [],
    isLoading: loading,
    refetch: load,
  } = useQuery({
    queryKey: QUERY_KEYS.customers,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("customers")
        .select("*")
        .order("name")
        .limit(1000);
      if (error) throw error;
      return (data ?? []) as Customer[];
    },
    staleTime: 60_000,
  });

  useRealtimeTable<Customer>(
    {
      table: "customers",
      queryKey: QUERY_KEYS.customers,
      debounceMs: 100,
    },
    qc,
  );

  // Close menu on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(null);
      }
    }
    if (menuOpen) {
      document.addEventListener("mousedown", handleClick);
      return () => document.removeEventListener("mousedown", handleClick);
    }
  }, [menuOpen]);

  const customerFilterDefinitions: FilterDefinition[] = useMemo(
    () => [
      {
        key: "created_at",
        label: lang === "ar" ? "تاريخ التسجيل" : "Registration Date",
        type: "date-range",
      },
      {
        key: "is_active",
        label: lang === "ar" ? "حالة النشاط" : "Status",
        type: "select",
        options: [
          { value: "true", label: lang === "ar" ? "نشط فقط" : "Active only" },
          { value: "false", label: lang === "ar" ? "غير نشط فقط" : "Inactive only" },
        ],
      },
      {
        key: "debt_type",
        label: lang === "ar" ? "حالة الرصيد" : "Balance Type",
        type: "select",
        options: [
          { value: "debt", label: lang === "ar" ? "مدين (عليه مبالغ)" : "Debtor (owes)" },
          { value: "credit", label: lang === "ar" ? "دائن (له رصيد)" : "Creditor (advance)" },
          { value: "zero", label: lang === "ar" ? "متزن (صفر)" : "Zero balance" },
        ],
      },
      {
        key: "has_limit",
        label: lang === "ar" ? "الحد الائتماني" : "Credit Limit",
        type: "select",
        options: [
          { value: "yes", label: lang === "ar" ? "له حد ائتماني" : "Has credit limit" },
          { value: "no", label: lang === "ar" ? "بدون حد ائتماني" : "No credit limit" },
        ],
      },
    ],
    [lang],
  );

  const customerSortOptions: SortOption[] = useMemo(
    () => [
      { value: "name_asc", label: lang === "ar" ? "الاسم (أ - ي)" : "Name (A - Z)" },
      { value: "name_desc", label: lang === "ar" ? "الاسم (ي - أ)" : "Name (Z - A)" },
      { value: "debt_desc", label: lang === "ar" ? "الأعلى مديونية (عليه)" : "Highest Debt" },
      {
        value: "credit_desc",
        label: lang === "ar" ? "الأعلى رصيداً دائناً (له)" : "Highest Credit",
      },
      { value: "limit_desc", label: lang === "ar" ? "أعلى حد ائتماني" : "Highest Credit Limit" },
      {
        value: "points_desc",
        label: lang === "ar" ? "الأعلى نقاط ولاء" : "Highest Loyalty Points",
      },
      { value: "date_desc", label: lang === "ar" ? "الأحدث تسجيلاً" : "Newest Registered" },
      { value: "date_asc", label: lang === "ar" ? "الأقدم تسجيلاً" : "Oldest Registered" },
    ],
    [lang],
  );

  /*
   * Classic table columns.
   *
   * Same contract as the products table: each column is independently
   * sortable on its *displayed* value, values stay on one line and truncate,
   * and money is rendered through `<Ltr>` so a number never gets mangled by
   * bidi reordering inside an RTL layout.
   */
  const columns = useMemo<DataTableColumn<Customer>[]>(() => {
    const cols: DataTableColumn<Customer>[] = [
      {
        key: "name",
        header: t("common.name"),
        sortable: true,
        width: "w-[260px]",
        sortValue: (r) => r.name,
        cell: (r) => {
          const meta = getRecordIndicator(r);
          const limit = Number(r.credit_limit);
          return (
            <div className="flex items-center gap-3 py-0.5">
              <span aria-hidden className={`h-9 w-1.5 shrink-0 rounded-full ${meta.barClass}`} />
              <span className="grid size-9 shrink-0 place-items-center rounded-xl border border-primary/20 bg-primary/10 text-xs font-bold text-primary">
                {r.name.slice(0, 1)}
              </span>
              <div className="min-w-0">
                <span className="block truncate text-xs font-bold text-foreground">{r.name}</span>
                {limit > 0 && (
                  <span className="block truncate font-mono text-[10px] text-rose-400">
                    {lang === "ar" ? "حد الائتمان:" : "Credit:"} <Ltr>{money(limit)}</Ltr>
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
            <div
              className="flex items-center gap-1.5"
              dir="ltr"
              onClick={(e) => e.stopPropagation()}
            >
              <span className="truncate font-mono text-xs text-muted-foreground">{r.phone}</span>
              <CustomerCommunicationMenu
                customer={{
                  id: r.id,
                  name: r.name,
                  phone: r.phone,
                  balance: Number(r.balance),
                  hasLedgerActivity: Boolean(
                    ledgerIndex.get(r.id)?.lastMovementAt || Number(r.balance) !== 0,
                  ),
                }}
                onSelectStatementPdf={() => goStatement(r)}
                onSelectStatementExcel={() => goStatement(r)}
                trigger={
                  <button
                    type="button"
                    className="shrink-0 rounded-full p-1 text-emerald-400 transition hover:bg-emerald-500/10 hover:text-emerald-300"
                    title={lang === "ar" ? "إجراءات المراسلة والتواصل" : "Communication actions"}
                  >
                    <WhatsAppIcon className="size-3.5" />
                  </button>
                }
              />
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
        width: "w-[130px]",
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
        key: "credit_limit",
        header: lang === "ar" ? "حد الائتمان" : "Credit Limit",
        align: "end",
        sortable: true,
        width: "w-[124px]",
        sortValue: (r) => Number(r.credit_limit),
        cell: (r) => (
          <span className="font-mono text-xs tabular-nums text-muted-foreground">
            <Ltr>{money(Number(r.credit_limit))}</Ltr>
          </span>
        ),
      },
      {
        key: "loyalty_points",
        header: lang === "ar" ? "نقاط الولاء" : "Loyalty",
        align: "end",
        sortable: true,
        width: "w-[110px]",
        sortValue: (r) => Number(r.loyalty_points),
        cell: (r) => (
          <span className="font-mono text-xs tabular-nums text-muted-foreground">
            {Number(r.loyalty_points) || 0}
          </span>
        ),
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
        width: "w-[150px]",
        cell: (r) => (
          <div className="inline-flex items-center gap-1.5 pe-2">
            {isModuleEnabled("payments") && (
              <IconButton
                size="sm"
                variant="outline"
                tooltip
                ariaLabel={lang === "ar" ? "تحصيل دفعة" : "Collect payment"}
                icon={<Wallet />}
                round
                onClick={(event) => {
                  event.stopPropagation();
                  goPayment(r);
                }}
              />
            )}
            <IconButton
              size="sm"
              variant="outline"
              tooltip
              ariaLabel={lang === "ar" ? "كشف حساب" : "Statement"}
              icon={<FileText />}
              round
              onClick={(event) => {
                event.stopPropagation();
                goStatement(r);
              }}
            />
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

    return cols;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t, lang, ledgerIndex, isModuleEnabled]);

  const filtered = useMemo(() => {
    let list = rows.filter((r) => {
      // Search match
      if (search.trim()) {
        const q = search.trim().toLowerCase();
        const matches =
          r.name.toLowerCase().includes(q) ||
          (r.phone ?? "").includes(q) ||
          (r.email ?? "").toLowerCase().includes(q) ||
          (r.address ?? "").toLowerCase().includes(q);
        if (!matches) return false;
      }

      // Quick filter tabs
      const bal = Number(r.balance);
      if (filterType === "debt" && bal <= 0) return false;
      if (filterType === "credit" && bal >= 0) return false;
      if (filterType === "active" && !r.is_active) return false;

      // Advanced filters
      if (filters.is_active && String(r.is_active) !== filters.is_active) return false;
      if (filters.debt_type) {
        if (filters.debt_type === "debt" && bal <= 0) return false;
        if (filters.debt_type === "credit" && bal >= 0) return false;
        if (filters.debt_type === "zero" && bal !== 0) return false;
      }
      if (filters.has_limit) {
        const hasLimit = Number(r.credit_limit) > 0;
        if (filters.has_limit === "yes" && !hasLimit) return false;
        if (filters.has_limit === "no" && hasLimit) return false;
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

      /*
       * A column-header click (classic table) takes precedence over the
       * toolbar preset, so the two controls can never disagree about the
       * order the operator asked for.
       */
      if (sort) {
        const dir = sort.direction === "asc" ? 1 : -1;
        switch (sort.key) {
          case "name":
            return a.name.localeCompare(b.name, "ar") * dir;
          case "phone":
            return (a.phone ?? "").localeCompare(b.phone ?? "") * dir;
          case "email":
            return (a.email ?? "").localeCompare(b.email ?? "") * dir;
          case "balance":
            return (aBal - bBal) * dir;
          case "credit_limit":
            return (Number(a.credit_limit) - Number(b.credit_limit)) * dir;
          case "loyalty_points":
            return (Number(a.loyalty_points) - Number(b.loyalty_points)) * dir;
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
          return a.name.localeCompare(b.name, "ar");
        case "name_desc":
          return b.name.localeCompare(a.name, "ar");
        case "debt_desc":
          return Number(b.balance) - Number(a.balance);
        case "credit_desc":
          return Number(a.balance) - Number(b.balance);
        case "limit_desc":
          return Number(b.credit_limit) - Number(a.credit_limit);
        case "points_desc":
          return Number(b.loyalty_points) - Number(a.loyalty_points);
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

  // Balance summaries
  const { totalOwed, totalCredit, activeCount, debtCount } = useMemo(() => {
    let owed = 0;
    let credit = 0;
    let active = 0;
    let debts = 0;
    for (const r of rows) {
      const bal = Number(r.balance);
      if (bal > 0) {
        owed += bal;
        debts++;
      } else if (bal < 0) {
        credit += Math.abs(bal);
      }
      if (r.is_active) active++;
    }
    return {
      totalOwed: owed,
      totalCredit: credit,
      activeCount: active,
      debtCount: debts,
    };
  }, [rows]);

  const remove = useCallback(
    async (id: string) => {
      if (!confirm(t("common.confirm_delete"))) return;
      const { error } = await supabase.from("customers").delete().eq("id", id);
      if (error) return toast.error(error.message);
      toast.success(t("common.deleted"));
      await load();
    },
    [t],
  );

  async function openCustomer(customer: Customer) {
    setSelected(customer);
    setActivity([]);
    setDetailTab("all");
    const [sales, payments] = await Promise.all([
      supabase
        .from("sales_invoices")
        .select("invoice_number,created_at,total")
        .eq("customer_id", customer.id)
        .order("created_at", { ascending: false }),
      supabase
        .from("customer_payments")
        .select("payment_date,amount,sales_invoices(invoice_number)")
        .eq("customer_id", customer.id)
        .order("payment_date", { ascending: false }),
    ]);
    setActivity(
      [
        ...(sales.data ?? []).map((s) => ({
          label: `${lang === "ar" ? "فاتورة" : "Invoice"} ${s.invoice_number}`,
          date: s.created_at,
          amount: Number(s.total),
          kind: "sale" as const,
        })),
        ...(payments.data ?? []).map((p: any) => ({
          label: `${lang === "ar" ? "سداد" : "Payment"} ${p.sales_invoices?.invoice_number ?? ""}`,
          date: p.payment_date,
          amount: Number(p.amount),
          kind: "payment" as const,
        })),
      ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()),
    );
  }

  // ─── Quick actions navigation ───
  const goPayment = useCallback((c: Customer) => {
    setCollectionCustomer(c);
    setCollectionOpen(true);
  }, []);

  const handleSaveCollection = async (data: {
    customerId: string;
    amount: number;
    method: PaymentMethod;
    notes?: string;
  }) => {
    //
    // The map that used to sit here collapsed card and mobile_money onto
    // bank_transfer, so a wallet collection was recorded as a bank transfer and
    // the ledger credited the wrong account. The catalogue now answers directly.
    //
    const dbMethod = toLegacyPaymentValue(data.method);
    const receiptNumber = String(Date.now()).slice(-6);

    // Call official security-definer RPC record_customer_payment
    const { data: rpcRes, error: pError } = await (supabase as any).rpc("record_customer_payment", {
      _customer_id: data.customerId,
      _invoice_id: null,
      _amount: data.amount,
      _method: dbMethod,
      _payment_date: new Date().toISOString().slice(0, 10),
      _note: data.notes || null,
    });
    if (pError) throw pError;

    toast.success(lang === "ar" ? "تم تسجيل سند التحصيل بنجاح" : "Payment recorded successfully");
    await load();
    return { receiptNumber };
  };
  const goDebts = useCallback(
    (c: Customer) => {
      navigate({ to: "/debts", search: { customerId: c.id } as any });
    },
    [navigate],
  );
  const goPOS = useCallback(
    (c: Customer) => {
      navigate({ to: "/pos", search: { customerId: c.id } as any });
    },
    [navigate],
  );
  const goSales = useCallback(
    (c: Customer) => {
      navigate({ to: "/sales", search: { customerId: c.id } as any });
    },
    [navigate],
  );
  const goStatement = useCallback(
    (c: Customer) => {
      const hasMovement = Boolean(ledgerIndex.get(c.id)?.lastMovementAt || Number(c.balance) !== 0);
      if (!hasMovement) {
        toast.warning(
          lang === "ar"
            ? "لا توجد أي حركات مالية أو فواتير مسجلة لهذا العميل حتى الآن"
            : "No financial transactions recorded for this customer yet",
        );
        return;
      }
      void navigate({ to: "/account-statement", search: { customerId: c.id } as never });
    },
    [navigate, ledgerIndex, lang],
  );

  // ─── Keyboard shortcuts ───
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement
      )
        return;
      if (edit) return;

      const active = (hoveredRow ? rows.find((r) => r.id === hoveredRow) : null) || selected;

      switch (e.key) {
        case "F1":
          e.preventDefault();
          setEdit({});
          break;
        case "F2":
          if (active) {
            e.preventDefault();
            setEdit(active);
          } else {
            toast.info(
              lang === "ar"
                ? "حدد أو مرر المؤشر على عميل للتعديل (F2)"
                : "Select a customer to edit (F2)",
            );
          }
          break;
        case "F3":
          if (active) {
            e.preventDefault();
            goPayment(active);
          } else {
            toast.info(
              lang === "ar"
                ? "حدد عميلاً للتحصيل (F3)"
                : "Select a customer to collect payment (F3)",
            );
          }
          break;
        case "F4":
          if (active) {
            e.preventDefault();
            void remove(active.id);
          }
          break;
        case "F5":
          if (active) {
            e.preventDefault();
            goStatement(active);
          } else {
            toast.info(
              lang === "ar"
                ? "حدد عميلاً لكشف الحساب (F5)"
                : "Select a customer for statement (F5)",
            );
          }
          break;
        case "F6":
          if (active) {
            if (Number(active.balance) > 0) {
              e.preventDefault();
              goDebts(active);
            } else {
              toast.info(
                lang === "ar"
                  ? "هذا العميل ليس عليه ديون"
                  : "This customer has no outstanding debt",
              );
            }
          }
          break;
        case "Escape":
          setMenuOpen(null);
          setSelected(null);
          setEdit(null);
          break;
      }
    }
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [hoveredRow, selected, rows, edit, lang, goPayment, goDebts, goStatement, remove]);

  const detailStats = useMemo(() => {
    if (!selected) return null;
    const invoiceItems = activity.filter((a) => a.kind === "sale");
    const paymentItems = activity.filter((a) => a.kind === "payment");
    const totalPurchases = invoiceItems.reduce((s, a) => s + a.amount, 0);
    const totalPayments = paymentItems.reduce((s, a) => s + a.amount, 0);
    const lastActivity = activity.length > 0 ? activity[0].date : null;
    return {
      invoiceItems,
      paymentItems,
      totalPurchases,
      totalPayments,
      invoiceCount: invoiceItems.length,
      paymentCount: paymentItems.length,
      lastActivity,
    };
  }, [selected, activity]);

  const selectedLedgerRow = selected ? ledgerIndex.get(selected.id) : undefined;
  const selectedBalance = selectedLedgerRow
    ? selectedLedgerRow.ledgerBalance
    : Number(selected?.balance ?? 0);

  // Status indicators logic helper (Mullak signature)
  const getRecordIndicator = (customer: Customer) => {
    const bal = Number(customer.balance);
    const limit = Number(customer.credit_limit);
    if (!customer.is_active) {
      return {
        barClass: "bg-muted-foreground/40",
        label: lang === "ar" ? "غير نشط" : "Inactive",
        toneClass: "bg-muted text-muted-foreground border-border",
      };
    }
    if (limit > 0 && bal > limit) {
      return {
        barClass: "bg-rose-500 shadow-[0_0_10px_rgba(244,63,94,0.4)]",
        label: lang === "ar" ? "تجاوز الائتمان" : "Limit Exceeded",
        toneClass: "bg-rose-500/10 text-rose-400 border-rose-500/20",
      };
    }
    if (bal > 0) {
      return {
        barClass: "bg-amber-500 shadow-[0_0_10px_rgba(245,158,11,0.3)]",
        label: lang === "ar" ? "مستحق عليه" : "Owed",
        toneClass: "bg-amber-500/10 text-amber-400 border-amber-500/20",
      };
    }
    if (bal < 0) {
      return {
        barClass: "bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.3)]",
        label: lang === "ar" ? "رصيد دائن" : "Credit Balance",
        toneClass: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
      };
    }
    return {
      barClass: "bg-primary shadow-[0_0_10px_rgba(59,130,246,0.3)]",
      label: lang === "ar" ? "خالص" : "Settled",
      toneClass: "bg-primary/10 text-primary border-primary/20",
    };
  };

  return (
    <div className="space-y-5">
      <PageHeader title={t("customers.title")} subtitle={t("customers.subtitle")} />

      {/* ─── Standard VORTEX KPI Metric Cards (2 on Mobile, 4 on Desktop) ─── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-4">
        <VortexMetricCard
          title={lang === "ar" ? "إجمالي العملاء" : "Total Customers"}
          value={rows.length}
          subtitle={`${activeCount} ${lang === "ar" ? "عميل نشط" : "active"}`}
          icon={<Users className="size-4 text-primary" />}
          tone="default"
        />
        <VortexMetricCard
          title={lang === "ar" ? "المبالغ عليهم (ديون)" : "Receivables (Owed)"}
          value={money(totalOwed)}
          subtitle={`${debtCount} ${lang === "ar" ? "عميل عليه مبالغ" : "with debt"}`}
          icon={<Wallet className="size-4 text-amber-500" />}
          tone="warning"
        />
        <VortexMetricCard
          title={lang === "ar" ? "المبالغ لهم (رصيد دائن)" : "Credits (Advance)"}
          value={money(totalCredit)}
          subtitle={lang === "ar" ? "أرصدة مدفوعة مقدماً" : "prepaid credits"}
          icon={<CreditCard className="size-4 text-emerald-500" />}
          tone="success"
        />
        <VortexMetricCard
          title={lang === "ar" ? "صافي المستحقات" : "Net Receivables"}
          value={money(totalOwed - totalCredit)}
          subtitle={lang === "ar" ? "الرصيد الصافي للدفتر" : "Net ledger position"}
          icon={<DollarSign className="size-4 text-sky-500" />}
          tone={totalOwed - totalCredit >= 0 ? "warning" : "success"}
        />
      </div>

      {/* ─── Standard VORTEX TableToolbar: Search + Filters + Sort + View Toggle + New Customer ─── */}
      <TableToolbar
        sticky
        search={{
          value: search,
          onValueChange: setSearch,
          placeholder:
            lang === "ar"
              ? "ابحث بالاسم، رقم الهاتف، البريد أو العنوان..."
              : "Search by name, phone, email, address…",
          resultCount: filtered.length,
        }}
        filters={{
          definitions: customerFilterDefinitions,
          values: filters,
          onValueChange: setFilters,
        }}
        sort={{
          options: customerSortOptions,
          value: sortKey,
          onValueChange: (value) => {
            setSortKey(value);
            // A preset replaces whatever the table header had selected.
            setSort(null);
          },
          label: lang === "ar" ? "ترتيب" : "Sort",
        }}
        viewToggle={
          <ToolbarAction
            label={
              viewMode === "cards"
                ? lang === "ar"
                  ? "بطاقات"
                  : "Cards"
                : viewMode === "list"
                  ? lang === "ar"
                    ? "قائمة"
                    : "List"
                  : lang === "ar"
                    ? "جدول"
                    : "Table"
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
            label={lang === "ar" ? "عميل جديد" : "New Customer"}
            icon={<Plus />}
            tone="primary"
            onClick={() => setEdit({})}
          />
        }
      >
        <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 scrollbar-x-none">
          {[
            { id: "all", label: lang === "ar" ? "الكل" : "All", count: rows.length },
            { id: "debt", label: lang === "ar" ? "عليهم مبالغ" : "With Debt", count: debtCount },
            { id: "credit", label: lang === "ar" ? "لهم رصيد" : "With Credit" },
            { id: "active", label: lang === "ar" ? "النشطين" : "Active", count: activeCount },
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
                  {f.count}
                </span>
              )}
            </button>
          ))}
        </div>
      </TableToolbar>

      {/* ─── Main Content Display: Mullak Cards View vs Advanced Table View ─── */}
      {loading ? (
        <div className="card-mullak p-12 text-center">
          <Loader2 className="mx-auto size-8 animate-spin text-primary" />
          <p className="mt-3 text-sm text-muted-foreground">
            {lang === "ar" ? "جارِ تحميل سجلات العملاء..." : "Loading customers…"}
          </p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="card-mullak flex flex-col items-center gap-3 p-12 text-center">
          <div className="grid size-16 place-items-center rounded-3xl bg-primary/10 text-primary border border-primary/20 shadow-sm">
            <Users className="size-8" />
          </div>
          <h3 className="text-base font-bold text-foreground">
            {lang === "ar" ? "لا توجد سجلات مطابقة" : "No matching customers"}
          </h3>
          <p className="max-w-sm text-xs text-muted-foreground">
            {search
              ? lang === "ar"
                ? `لا توجد نتائج تطابق "${search}". جرب البحث بكلمة أخرى.`
                : `No results found for "${search}".`
              : lang === "ar"
                ? "ابدأ بتسجيل العميل الأول لإصدار الفواتير ومتابعة الأرصدة والديون."
                : "Register your first customer to start tracking invoices and balances."}
          </p>
          <button
            onClick={() => setEdit({})}
            className="mt-2 inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-xs font-bold text-primary-foreground shadow-sm hover:bg-primary/90 transition active:scale-95"
          >
            <Plus className="size-4" />
            <span>{lang === "ar" ? "إضافة عميل جديد الآن" : "Add New Customer Now"}</span>
          </button>
        </div>
      ) : viewMode === "cards" ? (
        /* ─── Mullak Luxury Cards Grid — same 2-column mobile grid as products ─── */
        <div className="grid grid-cols-2 gap-2.5 md:grid-cols-3 lg:grid-cols-4 sm:gap-4">
          {filtered.map((r, i) => {
            const meta = getRecordIndicator(r);
            const bal = Number(r.balance);
            const limit = Number(r.credit_limit);

            return (
              <div
                key={r.id}
                onMouseEnter={() => setHoveredRow(r.id)}
                onMouseLeave={() => setHoveredRow(null)}
                onClick={() => void openCustomer(r)}
                style={{ animationDelay: `${i * 30}ms` }}
                className="card-mullak group relative flex flex-col justify-between p-4 cursor-pointer animate-in fade-in slide-in-from-bottom-2 duration-200"
              >
                {/* Top Section: Colored Strip + Avatar + Name + Badges */}
                <div className="flex items-start gap-3">
                  {/* Mullak Signature: Rounded colored vertical bar on the right (RTL start) */}
                  <span
                    aria-hidden
                    className={`h-14 w-1.5 shrink-0 rounded-full transition-all duration-300 ${meta.barClass}`}
                  />

                  {/* Customer Avatar Squircle */}
                  <div className="grid size-12 shrink-0 place-items-center rounded-2xl bg-primary/10 text-primary font-bold text-base border border-primary/20 shadow-xs group-hover:scale-105 transition-transform">
                    {r.name.slice(0, 1)}
                  </div>

                  {/* Customer Information */}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-1">
                      <h4 className="truncate text-sm font-bold text-foreground group-hover:text-primary transition-colors">
                        {r.name}
                      </h4>
                      {/* Status Tag */}
                      <span
                        className={`rounded-full px-2 py-0.5 text-[9px] font-bold border shrink-0 ${meta.toneClass}`}
                      >
                        {meta.label}
                      </span>
                    </div>

                    {/* Contact & Extra Details */}
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                      {r.phone && (
                        <span className="flex items-center gap-1 font-mono" dir="ltr">
                          <Phone className="size-3 text-muted-foreground" />
                          {r.phone}
                        </span>
                      )}
                      {r.email && (
                        <span className="flex items-center gap-1 truncate max-w-[140px]">
                          <Mail className="size-3 text-muted-foreground" />
                          {r.email}
                        </span>
                      )}
                    </div>

                    {/* Credit limit / Loyalty pills */}
                    <div className="mt-2 flex items-center gap-1.5 flex-wrap">
                      {limit > 0 && (
                        <span className="rounded-lg bg-rose-500/10 border border-rose-500/20 px-2 py-0.5 text-[9px] font-mono font-medium text-rose-400 flex items-center gap-1">
                          <ShieldCheck className="size-2.5" />
                          {lang === "ar" ? "حد الائتمان:" : "Limit:"} <Ltr>{money(limit)}</Ltr>
                        </span>
                      )}
                      {Number(r.loyalty_points) > 0 && (
                        <span className="rounded-lg bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 text-[9px] font-mono font-medium text-amber-400 flex items-center gap-1">
                          <Star className="size-2.5 fill-amber-400 text-amber-400" />
                          <Ltr>{r.loyalty_points}</Ltr> {lang === "ar" ? "نقطة" : "pts"}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Balance & Actions Section */}
                <div className="mt-4 pt-3 border-t border-border/50 flex items-center justify-between">
                  {/* Financial Balance Status */}
                  <div>
                    <span className="block text-[10px] text-muted-foreground">
                      {bal > 0
                        ? lang === "ar"
                          ? "الرصيد المستحق (عليه)"
                          : "Outstanding Debt"
                        : bal < 0
                          ? lang === "ar"
                            ? "رصيد دائن (له)"
                            : "Credit Balance"
                          : lang === "ar"
                            ? "الرصيد الحالي"
                            : "Current Balance"}
                    </span>
                    <span
                      className={`font-mono text-base font-bold tracking-tight ${
                        bal > 0
                          ? "text-amber-400"
                          : bal < 0
                            ? "text-emerald-400"
                            : "text-muted-foreground"
                      }`}
                    >
                      <Ltr>{money(bal)}</Ltr>
                    </span>
                  </div>

                  {/* Action Buttons */}
                  <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                    {/* Communication Actions Menu */}
                    <CustomerCommunicationMenu
                      customer={{
                        id: r.id,
                        name: r.name,
                        phone: r.phone,
                        balance: bal,
                        hasLedgerActivity: Boolean(
                          ledgerIndex.get(r.id)?.lastMovementAt || bal !== 0,
                        ),
                      }}
                      onSelectStatementPdf={() => goStatement(r)}
                      onSelectStatementExcel={() => goStatement(r)}
                      trigger={
                        <button
                          type="button"
                          title={
                            lang === "ar" ? "إجراءات المراسلة والتواصل" : "Communication options"
                          }
                          className={`grid size-8 place-items-center rounded-full border transition active:scale-95 ${
                            r.phone
                              ? "bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 border-emerald-500/20"
                              : "bg-muted/40 text-muted-foreground/50 border-border/60"
                          }`}
                        >
                          <WhatsAppIcon className="size-3.5" />
                        </button>
                      }
                    />

                    {/* Quick Payment Button (F3) */}
                    {isModuleEnabled("payments") && (
                      <button
                        onClick={() => goPayment(r)}
                        title={lang === "ar" ? "تحصيل دفعة (F3)" : "Collect payment (F3)"}
                        className="flex h-8 items-center gap-1 rounded-full bg-primary/10 hover:bg-primary hover:text-primary-foreground border border-primary/20 px-2.5 text-[11px] font-bold text-primary transition active:scale-95"
                      >
                        <Wallet className="size-3" />
                        <span>{lang === "ar" ? "تحصيل" : "Pay"}</span>
                      </button>
                    )}

                    {/* Quick Statement Button (F5) */}
                    <button
                      onClick={() => goStatement(r)}
                      title={lang === "ar" ? "كشف حساب (F5)" : "Statement (F5)"}
                      className="grid size-8 place-items-center rounded-full bg-surface-2 hover:bg-surface-3 border border-border text-muted-foreground hover:text-foreground transition active:scale-95"
                    >
                      <FileText className="size-3.5" />
                    </button>

                    {/* Edit Button (F2) */}
                    <button
                      onClick={() => setEdit(r)}
                      title={lang === "ar" ? "تعديل (F2)" : "Edit (F2)"}
                      className="grid size-8 place-items-center rounded-full bg-surface-2 hover:bg-surface-3 border border-border text-muted-foreground hover:text-foreground transition active:scale-95"
                    >
                      <Pencil className="size-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : viewMode === "list" ? (
        /* ─── Luxury Mullak Row-Cards View (List with Right Accent Strip) ─── */
        <div className="space-y-2.5">
          {filtered.map((r) => {
            const meta = getRecordIndicator(r);
            const bal = Number(r.balance);
            const limit = Number(r.credit_limit);

            return (
              <div
                key={r.id}
                onClick={() => void openCustomer(r)}
                onMouseEnter={() => setHoveredRow(r.id)}
                onMouseLeave={() => setHoveredRow(null)}
                className="card-mullak group relative flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 sm:px-4 sm:py-3 cursor-pointer hover:border-primary/40 transition-all rounded-2xl"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span
                    aria-hidden
                    className={`h-10 w-1.5 shrink-0 rounded-full transition-all duration-300 ${meta.barClass}`}
                  />
                  <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary font-bold text-sm border border-primary/20">
                    {r.name.slice(0, 1)}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h4 className="font-bold text-foreground group-hover:text-primary transition-colors text-sm truncate">
                        {r.name}
                      </h4>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[9px] font-bold border shrink-0 ${meta.toneClass}`}
                      >
                        {meta.label}
                      </span>
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                      {r.phone && (
                        <span
                          className="flex items-center gap-1 truncate font-mono text-[11px]"
                          dir="ltr"
                        >
                          <Phone className="size-3 shrink-0 text-muted-foreground" />
                          <span className="truncate">{r.phone}</span>
                        </span>
                      )}
                      {r.email && (
                        <span className="flex max-w-[150px] items-center gap-1 truncate text-[11px]">
                          <Mail className="size-3 shrink-0 text-muted-foreground" />
                          <span className="truncate">{r.email}</span>
                        </span>
                      )}
                      {limit > 0 && (
                        <span className="truncate font-mono text-[10px] text-rose-400">
                          {lang === "ar" ? "الحد:" : "Limit:"} <Ltr>{money(limit)}</Ltr>
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between gap-4 border-t pt-2 border-border/50 sm:justify-end sm:border-t-0 sm:pt-0 shrink-0">
                  <div className="text-start sm:text-end">
                    <span className="block text-[10px] text-muted-foreground">
                      {bal > 0
                        ? lang === "ar"
                          ? "عليه"
                          : "Owed"
                        : bal < 0
                          ? lang === "ar"
                            ? "له"
                            : "Credit"
                          : lang === "ar"
                            ? "الرصيد"
                            : "Balance"}
                    </span>
                    <span
                      className={`font-mono text-sm sm:text-base font-bold tracking-tight ${
                        bal > 0
                          ? "text-amber-400"
                          : bal < 0
                            ? "text-emerald-400"
                            : "text-muted-foreground"
                      }`}
                    >
                      <Ltr>{money(bal)}</Ltr>
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                    {isModuleEnabled("payments") && (
                      <button
                        onClick={() => goPayment(r)}
                        title={`${lang === "ar" ? "تحصيل" : "Payment"} (F3)`}
                        className="flex h-8 items-center gap-1 rounded-lg border border-primary/20 bg-primary/10 px-2.5 text-xs font-semibold text-primary transition hover:bg-primary hover:text-primary-foreground active:scale-95"
                      >
                        <Wallet className="size-3.5" />
                        <span className="hidden md:inline">{lang === "ar" ? "تحصيل" : "Pay"}</span>
                      </button>
                    )}
                    <button
                      onClick={() => goStatement(r)}
                      title={`${lang === "ar" ? "كشف حساب" : "Statement"} (F5)`}
                      className="grid size-8 place-items-center rounded-lg border border-border bg-surface text-muted-foreground transition hover:bg-surface-2 hover:text-foreground"
                    >
                      <FileText className="size-3.5" />
                    </button>
                    <button
                      onClick={() => setEdit(r)}
                      title={`${lang === "ar" ? "تعديل" : "Edit"} (F2)`}
                      className="grid size-8 place-items-center rounded-lg border border-border bg-surface text-muted-foreground transition hover:bg-surface-2 hover:text-foreground"
                    >
                      <Pencil className="size-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        /* ─── Classic Table View: same DataTable as products (sortable headers) ─── */
        <div className="panel-elevated -mx-1 overflow-hidden rounded-2xl border border-border/70 sm:mx-0">
          <DataTable
            className="px-0"
            columns={columns}
            rows={filtered}
            rowKey={(r) => r.id}
            loading={loading}
            initialLoading={loading}
            error={null}
            sort={sort}
            onSortChange={setSort}
            minWidth={1260}
            horizontalScroll={tableUsesHorizontalScroll}
            stickyHeader
            onRowClick={(r) => void openCustomer(r)}
            rowProps={(r) => ({
              onMouseEnter: () => setHoveredRow(r.id),
              onMouseLeave: () => setHoveredRow(null),
            })}
            empty={{
              icon: <Users />,
              title: lang === "ar" ? "لا توجد سجلات مطابقة" : "No matching customers",
              description: search
                ? lang === "ar"
                  ? `لا توجد نتائج تطابق "${search}". جرب البحث بكلمة أخرى.`
                  : `No results found for "${search}".`
                : lang === "ar"
                  ? "ابدأ بتسجيل العميل الأول لإصدار الفواتير ومتابعة الأرصدة والديون."
                  : "Register your first customer to start tracking invoices and balances.",
              action: (
                <Button size="sm" icon={<Plus />} onClick={() => setEdit({})}>
                  {lang === "ar" ? "عميل جديد" : "New Customer"}
                </Button>
              ),
            }}
          />
        </div>
      )}

      {/* ─── Mullak-Style Customer Detail Sheet (Drawer) ─── */}
      {selected && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-end bg-black/65 backdrop-blur-xs animate-in fade-in duration-200"
          onClick={() => setSelected(null)}
        >
          <div
            className="h-full w-full max-w-lg border-s border-border/80 bg-background/95 backdrop-blur-md p-6 shadow-2xl overflow-y-auto animate-in slide-in-from-left duration-200"
            onClick={(e) => e.stopPropagation()}
            dir={lang === "ar" ? "rtl" : "ltr"}
          >
            {/* Ambient decorative blur */}
            <div className="absolute -top-10 -right-10 size-40 rounded-full bg-primary/20 blur-3xl pointer-events-none" />

            {/* Header with Close */}
            <div className="flex items-start justify-between pb-4 border-b border-border/60">
              <div className="flex items-center gap-3.5">
                <div className="grid size-14 place-items-center rounded-2xl bg-primary/10 text-primary font-bold text-xl border border-primary/20 shadow-sm">
                  {selected.name.slice(0, 1)}
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
                  </div>
                </div>
              </div>
              <button
                onClick={() => setSelected(null)}
                className="grid size-9 place-items-center rounded-full bg-surface-2 text-muted-foreground hover:text-foreground transition"
              >
                <X className="size-4" />
              </button>
            </div>

            {/* Financial Overview Cards */}
            <div className="mt-5 grid grid-cols-2 gap-3">
              <MiniStat
                label={lang === "ar" ? "الرصيد الدفتري" : "Ledger Balance"}
                value={money(selectedBalance)}
                color={
                  selectedBalance > 0
                    ? "text-amber-400"
                    : selectedBalance < 0
                      ? "text-emerald-400"
                      : undefined
                }
              />
              <MiniStat
                label={lang === "ar" ? "حد الائتمان" : "Credit Limit"}
                value={money(Number(selected.credit_limit))}
                color={Number(selected.credit_limit) > 0 ? "text-rose-400" : undefined}
              />
              {detailStats && (
                <>
                  <MiniStat
                    label={lang === "ar" ? "إجمالي المشتريات" : "Total Purchases"}
                    value={money(detailStats.totalPurchases)}
                  />
                  <MiniStat
                    label={lang === "ar" ? "إجمالي المدفوعات" : "Total Payments"}
                    value={money(detailStats.totalPayments)}
                    color="text-emerald-400"
                  />
                </>
              )}
            </div>

            {/* Quick Actions Strip */}
            <div className="mt-5 flex items-center gap-2 flex-wrap">
              <CustomerCommunicationMenu
                customer={{
                  id: selected.id,
                  name: selected.name,
                  phone: selected.phone,
                  balance: selectedBalance,
                  hasLedgerActivity: Boolean(
                    ledgerIndex.get(selected.id)?.lastMovementAt ||
                    selectedBalance !== 0 ||
                    activity.length > 0,
                  ),
                }}
                onSelectStatementPdf={() => goStatement(selected)}
                onSelectStatementExcel={() => goStatement(selected)}
                trigger={
                  <button
                    type="button"
                    className="flex items-center gap-1.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 px-3.5 py-1.5 text-xs font-bold text-emerald-400 hover:bg-emerald-500/25 transition active:scale-95 cursor-pointer"
                  >
                    <WhatsAppIcon className="size-3.5" />
                    <span>{lang === "ar" ? "إجراءات المراسلة" : "Messaging"}</span>
                  </button>
                }
              />
              {selected.phone && (
                <button
                  type="button"
                  onClick={() => handleCustomerSMS(selected, lang)}
                  className="flex items-center gap-1.5 rounded-full bg-sky-500/15 border border-sky-500/30 px-3.5 py-1.5 text-xs font-bold text-sky-400 hover:bg-sky-500/25 transition active:scale-95"
                >
                  <MessageSquareText className="size-3.5" />
                  <span>{lang === "ar" ? "رسالة نصية" : "Text message"}</span>
                </button>
              )}
              {isModuleEnabled("payments") && (
                <DetailActionBtn
                  icon={<Wallet className="size-3.5" />}
                  label={lang === "ar" ? "تحصيل دفعة" : "Payment"}
                  onClick={() => goPayment(selected)}
                />
              )}
              <DetailActionBtn
                icon={<FileText className="size-3.5" />}
                label={lang === "ar" ? "كشف حساب" : "Statement"}
                onClick={() => goStatement(selected)}
              />
              <DetailActionBtn
                icon={<ShoppingCart className="size-3.5" />}
                label={lang === "ar" ? "فاتورة جديدة" : "New Sale"}
                onClick={() => goPOS(selected)}
              />
            </div>

            {/* Activity Tabs */}
            <div className="mt-6 flex items-center gap-1 border-b border-border/80 pb-2">
              {(["all", "invoices", "payments"] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setDetailTab(tab)}
                  className={`rounded-full px-3 py-1 text-xs font-bold transition ${
                    detailTab === tab
                      ? "bg-primary text-primary-foreground shadow-xs"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {tab === "all"
                    ? (lang === "ar" ? "الكل" : "All") + ` (${activity.length})`
                    : tab === "invoices"
                      ? (lang === "ar" ? "فواتير" : "Invoices") +
                        ` (${detailStats?.invoiceCount ?? 0})`
                      : (lang === "ar" ? "دفعات" : "Payments") +
                        ` (${detailStats?.paymentCount ?? 0})`}
                </button>
              ))}
            </div>

            {/* Activity List */}
            <div className="mt-3 space-y-2 max-h-[350px] overflow-y-auto">
              {(() => {
                const items =
                  detailTab === "all"
                    ? activity
                    : detailTab === "invoices"
                      ? (detailStats?.invoiceItems ?? [])
                      : (detailStats?.paymentItems ?? []);

                return items.length === 0 ? (
                  <p className="py-8 text-center text-xs text-muted-foreground">
                    {lang === "ar" ? "لا توجد حركات مسجلة" : "No activity recorded"}
                  </p>
                ) : (
                  items.map((item, idx) => (
                    <div
                      key={idx}
                      className="flex items-center justify-between rounded-xl border border-border/60 bg-surface/60 p-3 text-xs"
                    >
                      <div className="flex items-center gap-2">
                        {item.kind === "sale" ? (
                          <div className="grid size-7 place-items-center rounded-lg bg-rose-500/10 text-rose-400">
                            <Receipt className="size-3.5" />
                          </div>
                        ) : (
                          <div className="grid size-7 place-items-center rounded-lg bg-emerald-500/10 text-emerald-400">
                            <CreditCard className="size-3.5" />
                          </div>
                        )}
                        <div>
                          <p className="font-bold text-foreground">{item.label}</p>
                          <p className="text-[10px] text-muted-foreground">
                            <Ltr>{new Date(item.date).toLocaleDateString()}</Ltr>
                          </p>
                        </div>
                      </div>
                      <span
                        className={`font-mono font-bold ${
                          item.kind === "sale" ? "text-rose-400" : "text-emerald-400"
                        }`}
                      >
                        <Ltr>
                          {item.kind === "sale" ? "+" : "−"} {money(item.amount)}
                        </Ltr>
                      </span>
                    </div>
                  ))
                );
              })()}
            </div>
          </div>
        </div>
      )}

      {/* ─── Customer form — shared with POS (same fields, validation & save) ─── */}
      <CustomerFormDialog
        open={edit !== null}
        initial={edit}
        onClose={() => setEdit(null)}
        onSavedComplete={() => void load()}
      />

      <VortexCollectionSheet
        open={collectionOpen}
        onOpenChange={setCollectionOpen}
        customer={collectionCustomer}
        onSavePayment={handleSaveCollection}
        onSuccess={() => void load()}
      />
    </div>
  );
}

/* ─── Sub-components ─── */

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
      onClick={onClick}
      className="flex items-center gap-1.5 rounded-full border border-border/80 bg-surface px-3.5 py-1.5 text-xs font-bold text-muted-foreground hover:bg-surface-2 hover:text-foreground transition active:scale-95"
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

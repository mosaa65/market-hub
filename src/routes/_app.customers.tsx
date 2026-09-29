import { useModules } from "@/lib/modules";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  MessageCircle,
  LayoutGrid,
  List,
  ChevronLeft,
  DollarSign,
  TrendingUp,
  ShieldCheck,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { useI18n } from "@/lib/i18n";
import { money } from "@/lib/format";
import { openWhatsApp } from "@/lib/whatsapp";
import { debtReminderMessage } from "@/lib/whatsapp-templates";
import { useDebtIndex } from "@/hooks/use-debts-overview";
import { StatementIntegrityBadge } from "@/components/statements/statement-integrity-badge";
import { VortexCollectionSheet, type PaymentMethod } from "@/components/vortex-ui";
import { toast } from "sonner";

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
type ViewMode = "cards" | "table";

function handleCustomerWhatsApp(customer: Customer, lang: "ar" | "en") {
  if (!customer.phone) return;
  const bal = Number(customer.balance);
  const msg =
    bal > 0
      ? debtReminderMessage({
          name: customer.name,
          balance: money(bal),
          lang,
        })
      : lang === "ar"
        ? `مرحباً ${customer.name}، نتواصل معك بخصوص حسابك في فورتكس ERP.`
        : `Hello ${customer.name}, contacting you regarding your account.`;
  openWhatsApp(customer.phone, msg);
}

function CustomersPage() {
  const { t, lang } = useI18n();
  const { isModuleEnabled } = useModules();
  const navigate = useNavigate();
  const [rows, setRows] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState<FilterType>("all");
  const [viewMode, setViewMode] = useState<ViewMode>("cards");
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
  const [saving, setSaving] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // أرصدة مؤكَّدة من الدفتر
  const { index: ledgerIndex } = useDebtIndex("customer");

  async function load() {
    setLoading(true);
    const { data } = await supabase.from("customers").select("*").order("name");
    setRows((data ?? []) as Customer[]);
    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, []);

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

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      // Search match
      const matchesSearch =
        !search ||
        r.name.toLowerCase().includes(search.toLowerCase()) ||
        (r.phone ?? "").includes(search) ||
        (r.email ?? "").toLowerCase().includes(search.toLowerCase());

      if (!matchesSearch) return false;

      // Filter tabs
      const bal = Number(r.balance);
      if (filterType === "debt") return bal > 0;
      if (filterType === "credit") return bal < 0;
      if (filterType === "active") return r.is_active;
      return true;
    });
  }, [rows, search, filterType]);

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

  async function save() {
    if (saving) return;
    if (!edit?.name?.trim()) return toast.error(t("common.required"));
    setSaving(true);
    const payload = {
      name: edit.name.trim(),
      phone: edit.phone || null,
      email: edit.email || null,
      address: edit.address || null,
      credit_limit: Number(edit.credit_limit ?? 0),
      is_active: edit.is_active ?? true,
    };
    const { error } = edit.id
      ? await supabase.from("customers").update(payload).eq("id", edit.id)
      : await supabase.from("customers").insert(payload);
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success(edit.id ? t("common.updated") : t("common.created"));
    setEdit(null);
    await load();
  }

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
    const dbMethodMap: Record<PaymentMethod, "cash" | "card" | "bank_transfer"> = {
      cash: "cash",
      card: "card",
      transfer: "bank_transfer",
      cheque: "bank_transfer",
    };
    const dbMethod = dbMethodMap[data.method] || "cash";
    const receiptNumber = String(Date.now()).slice(-6);

    const { error: pError } = await (supabase as any).from("customer_payments").insert({
      customer_id: data.customerId,
      amount: data.amount,
      payment_method: dbMethod,
      note: data.notes || null,
      payment_date: new Date().toISOString(),
    });
    if (pError) throw pError;

    // Update customer balance directly
    const currentCust = rows.find((r) => r.id === data.customerId) || collectionCustomer;
    if (currentCust) {
      const newBal = (Number(currentCust.balance) || 0) - data.amount;
      await (supabase as any)
        .from("customers")
        .update({ balance: newBal })
        .eq("id", data.customerId);
    }

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
      void navigate({ to: "/account-statement", search: { customerId: c.id } as never });
    },
    [navigate],
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

      {/* ─── Luxury Summary KPI Cards (Desktop & Mobile Responsive) ─── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {/* Card 1: Total Customers */}
        <div className="card-mullak relative overflow-hidden p-4 sm:p-5 flex items-center justify-between group">
          <div className="min-w-0">
            <p className="text-[11px] sm:text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              {lang === "ar" ? "إجمالي العملاء" : "Total Customers"}
            </p>
            <h3 className="mt-1 font-mono text-xl sm:text-2xl font-bold tracking-tight text-foreground">
              {rows.length}
            </h3>
            <span className="mt-1 inline-flex items-center gap-1 text-[10px] text-primary">
              <Users className="size-3" />
              {activeCount} {lang === "ar" ? "عميل نشط" : "active"}
            </span>
          </div>
          <div className="grid size-12 shrink-0 place-items-center rounded-2xl bg-primary/10 text-primary border border-primary/20 shadow-sm group-hover:scale-105 transition-transform">
            <Users className="size-6" />
          </div>
          <div className="absolute -left-6 -top-6 size-20 rounded-full bg-primary/10 blur-xl pointer-events-none" />
        </div>

        {/* Card 2: Total Owed (Receivables) */}
        <div className="card-mullak relative overflow-hidden p-4 sm:p-5 flex items-center justify-between group">
          <div className="min-w-0">
            <p className="text-[11px] sm:text-xs font-semibold text-amber-500/90 uppercase tracking-wider">
              {lang === "ar" ? "المبالغ عليهم (ديون)" : "Receivables (Owed)"}
            </p>
            <h3 className="mt-1 font-mono text-xl sm:text-2xl font-bold tracking-tight text-amber-400">
              {money(totalOwed)}
            </h3>
            <span className="mt-1 inline-flex items-center gap-1 text-[10px] text-amber-500/80">
              <AlertTriangle className="size-3" />
              {debtCount} {lang === "ar" ? "عميل عليه مبالغ" : "with debt"}
            </span>
          </div>
          <div className="grid size-12 shrink-0 place-items-center rounded-2xl bg-amber-500/10 text-amber-400 border border-amber-500/20 shadow-sm group-hover:scale-105 transition-transform">
            <Wallet className="size-6" />
          </div>
          <div className="absolute -left-6 -top-6 size-20 rounded-full bg-amber-500/10 blur-xl pointer-events-none" />
        </div>

        {/* Card 3: Total Credit (Payables / Advance) */}
        <div className="card-mullak relative overflow-hidden p-4 sm:p-5 flex items-center justify-between group">
          <div className="min-w-0">
            <p className="text-[11px] sm:text-xs font-semibold text-emerald-500/90 uppercase tracking-wider">
              {lang === "ar" ? "المبالغ لهم (رصيد دائن)" : "Credits (Advance)"}
            </p>
            <h3 className="mt-1 font-mono text-xl sm:text-2xl font-bold tracking-tight text-emerald-400">
              {money(totalCredit)}
            </h3>
            <span className="mt-1 inline-flex items-center gap-1 text-[10px] text-emerald-500/80">
              <CheckCircle2 className="size-3" />
              {lang === "ar" ? "أرصدة مدفوعة مقدماً" : "prepaid credits"}
            </span>
          </div>
          <div className="grid size-12 shrink-0 place-items-center rounded-2xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 shadow-sm group-hover:scale-105 transition-transform">
            <CreditCard className="size-6" />
          </div>
          <div className="absolute -left-6 -top-6 size-20 rounded-full bg-emerald-500/10 blur-xl pointer-events-none" />
        </div>

        {/* Card 4: Net Balance / Active Ratio */}
        <div className="card-mullak relative overflow-hidden p-4 sm:p-5 flex items-center justify-between group">
          <div className="min-w-0">
            <p className="text-[11px] sm:text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              {lang === "ar" ? "صافي المستحقات" : "Net Receivables"}
            </p>
            <h3
              className={`mt-1 font-mono text-xl sm:text-2xl font-bold tracking-tight ${totalOwed - totalCredit >= 0 ? "text-amber-400" : "text-emerald-400"}`}
            >
              {money(totalOwed - totalCredit)}
            </h3>
            <span className="mt-1 inline-flex items-center gap-1 text-[10px] text-muted-foreground">
              <TrendingUp className="size-3" />
              {lang === "ar" ? "الرصيد الصافي للدفتر" : "Net ledger position"}
            </span>
          </div>
          <div className="grid size-12 shrink-0 place-items-center rounded-2xl bg-surface-2 text-foreground border border-border/80 shadow-sm group-hover:scale-105 transition-transform">
            <DollarSign className="size-6 text-primary" />
          </div>
          <div className="absolute -left-6 -top-6 size-20 rounded-full bg-surface-3 blur-xl pointer-events-none" />
        </div>
      </div>

      {/* ─── Control Bar: Search + Filter Tabs + View Mode + New Customer Button ─── */}
      <div className="card-mullak p-3 sm:p-4">
        <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3">
          {/* Search Input */}
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute right-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={
                lang === "ar"
                  ? "ابحث بالاسم، رقم الهاتف، البريد..."
                  : "Search by name, phone, email…"
              }
              className="h-11 w-full rounded-2xl border border-border/80 bg-surface/80 px-4 pr-10 text-sm font-medium placeholder:text-muted-foreground/70 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 transition"
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="size-3.5" />
              </button>
            )}
          </div>

          {/* Filter Pills */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 lg:pb-0 scrollbar-x-none">
            {[
              { id: "all", label: lang === "ar" ? "الكل" : "All", count: rows.length },
              { id: "debt", label: lang === "ar" ? "عليهم مبالغ" : "With Debt", count: debtCount },
              { id: "credit", label: lang === "ar" ? "لهم رصيد" : "With Credit" },
              { id: "active", label: lang === "ar" ? "النشطين" : "Active", count: activeCount },
            ].map((f) => (
              <button
                key={f.id}
                onClick={() => setFilterType(f.id as FilterType)}
                className={`flex items-center gap-1.5 shrink-0 rounded-full px-3.5 py-1.5 text-xs font-bold transition border ${
                  filterType === f.id
                    ? "border-primary bg-primary text-primary-foreground shadow-sm shadow-primary/20"
                    : "border-border/70 bg-surface text-muted-foreground hover:text-foreground hover:bg-surface-2"
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

          {/* View Mode Toggle + Shortcuts Pill + New Customer */}
          <div className="flex items-center justify-between lg:justify-end gap-2.5">
            {/* View Mode Toggle (Cards vs Table) */}
            <div className="flex items-center rounded-2xl border border-border/80 bg-surface p-1">
              <button
                onClick={() => setViewMode("cards")}
                title={lang === "ar" ? "عرض البطاقات الفاخرة" : "Cards view"}
                className={`grid size-9 place-items-center rounded-xl transition ${
                  viewMode === "cards"
                    ? "bg-primary text-primary-foreground shadow-xs"
                    : "text-muted-foreground hover:text-foreground hover:bg-surface-2"
                }`}
              >
                <LayoutGrid className="size-4" />
              </button>
              <button
                onClick={() => setViewMode("table")}
                title={lang === "ar" ? "عرض الجدول المتقدم" : "Table view"}
                className={`grid size-9 place-items-center rounded-xl transition ${
                  viewMode === "table"
                    ? "bg-primary text-primary-foreground shadow-xs"
                    : "text-muted-foreground hover:text-foreground hover:bg-surface-2"
                }`}
              >
                <List className="size-4" />
              </button>
            </div>

            {/* Subtle Keyboard Shortcuts badge */}
            <div className="hidden xl:flex items-center gap-1.5 text-[10px] text-muted-foreground/80 bg-surface-2/60 px-2.5 py-2 rounded-xl border border-border/60">
              <span className="font-mono font-bold text-foreground">F1</span> جديد
              <span>·</span>
              <span className="font-mono font-bold text-foreground">F2</span> تعديل
              <span>·</span>
              <span className="font-mono font-bold text-foreground">F3</span> تحصيل
              <span>·</span>
              <span className="font-mono font-bold text-foreground">F5</span> كشف
            </div>

            {/* New Customer Button */}
            <button
              onClick={() => setEdit({})}
              className="flex h-11 items-center gap-2 rounded-2xl bg-primary px-4 sm:px-5 text-xs sm:text-sm font-bold text-primary-foreground shadow-md shadow-primary/25 hover:bg-primary/90 active:scale-95 transition"
            >
              <Plus className="size-4" />
              <span>{lang === "ar" ? "عميل جديد" : "New Customer"}</span>
            </button>
          </div>
        </div>
      </div>

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
        /* ─── Mullak Luxury Cards Grid ─── */
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3.5">
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
                          {lang === "ar" ? "حد الائتمان:" : "Limit:"} {money(limit)}
                        </span>
                      )}
                      {Number(r.loyalty_points) > 0 && (
                        <span className="rounded-lg bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 text-[9px] font-mono font-medium text-amber-400 flex items-center gap-1">
                          <Star className="size-2.5 fill-amber-400 text-amber-400" />
                          {r.loyalty_points} {lang === "ar" ? "نقطة" : "pts"}
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
                      {money(bal)}
                    </span>
                  </div>

                  {/* Action Buttons */}
                  <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                    {/* Direct WhatsApp Button */}
                    {r.phone && (
                      <button
                        onClick={() => handleCustomerWhatsApp(r, lang)}
                        title={lang === "ar" ? "مراسلة عبر واتساب" : "Message on WhatsApp"}
                        className="grid size-8 place-items-center rounded-full bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 border border-emerald-500/20 transition active:scale-95"
                      >
                        <MessageCircle className="size-3.5" />
                      </button>
                    )}

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
      ) : (
        /* ─── Advanced Desktop Table View (with Mullak Row Accents) ─── */
        <div className="card-mullak overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface-2/40 text-[11px] uppercase tracking-wider text-muted-foreground border-b border-border/80">
                <tr>
                  <th className="px-4 py-3.5 text-start font-bold">{t("common.name")}</th>
                  <th className="px-4 py-3.5 text-start font-bold">{t("common.phone")}</th>
                  <th className="px-4 py-3.5 text-start font-bold">{t("common.email")}</th>
                  <th className="px-4 py-3.5 text-end font-bold">{t("common.balance")}</th>
                  <th className="px-4 py-3.5 text-start font-bold">{t("common.status")}</th>
                  <th className="px-4 py-3.5 text-end font-bold">
                    {lang === "ar" ? "الإجراءات" : "Actions"}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {filtered.map((r) => {
                  const meta = getRecordIndicator(r);
                  const bal = Number(r.balance);
                  const limit = Number(r.credit_limit);

                  return (
                    <tr
                      key={r.id}
                      onClick={() => void openCustomer(r)}
                      onMouseEnter={() => setHoveredRow(r.id)}
                      onMouseLeave={() => setHoveredRow(null)}
                      className={`cursor-pointer transition-colors ${
                        hoveredRow === r.id ? "bg-surface-2/70" : "hover:bg-surface-2/40"
                      }`}
                    >
                      {/* Name with colored indicator & avatar */}
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <span
                            aria-hidden
                            className={`h-9 w-1.5 shrink-0 rounded-full ${meta.barClass}`}
                          />
                          <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary font-bold text-xs border border-primary/20">
                            {r.name.slice(0, 1)}
                          </div>
                          <div className="min-w-0">
                            <span className="font-bold text-foreground block truncate">
                              {r.name}
                            </span>
                            {limit > 0 && (
                              <span className="text-[10px] text-rose-400 font-mono block">
                                {lang === "ar" ? "حد الائتمان:" : "Credit:"} {money(limit)}
                              </span>
                            )}
                          </div>
                        </div>
                      </td>

                      {/* Phone */}
                      <td className="px-4 py-3 text-muted-foreground font-mono text-xs" dir="ltr">
                        {r.phone ? (
                          <div className="flex items-center justify-end gap-1.5">
                            <span>{r.phone}</span>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleCustomerWhatsApp(r, lang);
                              }}
                              className="text-emerald-400 hover:text-emerald-300"
                              title="واتساب"
                            >
                              <MessageCircle className="size-3.5" />
                            </button>
                          </div>
                        ) : (
                          "—"
                        )}
                      </td>

                      {/* Email */}
                      <td className="px-4 py-3 text-muted-foreground text-xs">{r.email ?? "—"}</td>

                      {/* Balance */}
                      <td className="px-4 py-3 text-end">
                        <span
                          className={`font-mono font-bold text-sm ${
                            bal > 0
                              ? "text-amber-400"
                              : bal < 0
                                ? "text-emerald-400"
                                : "text-muted-foreground"
                          }`}
                        >
                          {money(bal)}
                        </span>
                      </td>

                      {/* Status */}
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[10px] font-bold ${meta.toneClass}`}
                        >
                          <span className={`size-1.5 rounded-full ${meta.barClass}`} />
                          {meta.label}
                        </span>
                      </td>

                      {/* Actions */}
                      <td className="px-4 py-3 text-end" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-1.5">
                          {isModuleEnabled("payments") && (
                            <button
                              onClick={() => goPayment(r)}
                              title={`${lang === "ar" ? "تحصيل" : "Payment"} (F3)`}
                              className="h-7 px-2.5 rounded-lg bg-primary/10 hover:bg-primary hover:text-primary-foreground border border-primary/20 text-xs font-semibold text-primary transition active:scale-95"
                            >
                              {lang === "ar" ? "تحصيل" : "Pay"}
                            </button>
                          )}
                          <button
                            onClick={() => goStatement(r)}
                            title={`${lang === "ar" ? "كشف حساب" : "Statement"} (F5)`}
                            className="grid size-7 place-items-center rounded-lg border border-border bg-surface text-muted-foreground hover:bg-surface-2 hover:text-foreground transition"
                          >
                            <FileText className="size-3.5" />
                          </button>
                          <button
                            onClick={() => setEdit(r)}
                            title={`${t("common.edit")} (F2)`}
                            className="grid size-7 place-items-center rounded-lg border border-border bg-surface text-muted-foreground hover:bg-surface-2 hover:text-foreground transition"
                          >
                            <Pencil className="size-3.5" />
                          </button>
                          <button
                            onClick={() => void remove(r.id)}
                            title={`${t("common.delete")} (F4)`}
                            className="grid size-7 place-items-center rounded-lg border border-destructive/30 bg-destructive/5 text-destructive hover:bg-destructive/15 transition"
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
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
              {selected.phone && (
                <button
                  onClick={() => handleCustomerWhatsApp(selected, lang)}
                  className="flex items-center gap-1.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 px-3.5 py-1.5 text-xs font-bold text-emerald-400 hover:bg-emerald-500/25 transition active:scale-95"
                >
                  <MessageCircle className="size-3.5" />
                  <span>واتساب</span>
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
                            {new Date(item.date).toLocaleDateString()}
                          </p>
                        </div>
                      </div>
                      <span
                        className={`font-mono font-bold ${
                          item.kind === "sale" ? "text-rose-400" : "text-emerald-400"
                        }`}
                      >
                        {item.kind === "sale" ? "+" : "−"}
                        {money(item.amount)}
                      </span>
                    </div>
                  ))
                );
              })()}
            </div>
          </div>
        </div>
      )}

      {/* ─── Mullak-Style Edit / New Customer Sheet ─── */}
      {edit && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm p-0 sm:items-center sm:p-4 animate-in fade-in duration-200"
          onClick={() => !saving && setEdit(null)}
        >
          <div
            className="w-full max-w-lg rounded-t-3xl sm:rounded-3xl border border-border/80 bg-background/95 backdrop-blur-md p-6 sm:p-7 shadow-2xl max-h-[92vh] overflow-y-auto animate-in slide-in-from-bottom-6 sm:zoom-in-95 duration-200"
            onClick={(e) => e.stopPropagation()}
            dir={lang === "ar" ? "rtl" : "ltr"}
          >
            {/* Sheet Header with Luxury Badge */}
            <div className="flex items-start justify-between pb-5 border-b border-border/60">
              <div className="flex items-center gap-3.5">
                <div className="grid size-12 place-items-center rounded-2xl bg-primary/10 text-primary border border-primary/20 shadow-sm">
                  <User className="size-6" />
                </div>
                <div>
                  <h3 className="text-lg font-bold tracking-tight text-foreground">
                    {edit.id
                      ? lang === "ar"
                        ? "تعديل بيانات العميل"
                        : "Edit Customer Profile"
                      : lang === "ar"
                        ? "إضافة عميل جديد"
                        : "New Customer Registration"}
                  </h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {lang === "ar"
                      ? "سجل البيانات الأساسية ومعلومات التواصل والحد الائتماني"
                      : "Fill in identity, contact info, and credit terms"}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setEdit(null)}
                className="grid size-9 place-items-center rounded-full bg-surface-2 text-muted-foreground hover:text-foreground transition"
              >
                <X className="size-4" />
              </button>
            </div>

            {/* Form Fields Divided into Sections */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void save();
              }}
              className="mt-6 space-y-5"
            >
              {/* Section 1: Identity */}
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  <Sparkles className="size-3.5 text-primary" />
                  <span>{lang === "ar" ? "البيانات الأساسية" : "Primary Information"}</span>
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-foreground">
                    {t("common.name")} <span className="text-rose-500">*</span>
                  </label>
                  <div className="relative">
                    <User className="pointer-events-none absolute right-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                    <input
                      required
                      value={edit.name ?? ""}
                      onChange={(e) => setEdit({ ...edit, name: e.target.value })}
                      placeholder={
                        lang === "ar" ? "اسم العميل أو المؤسسة" : "Customer or Company Name"
                      }
                      className="h-11 w-full rounded-2xl border border-border/80 bg-surface/80 px-4 pr-10 text-sm font-medium placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 transition"
                    />
                  </div>
                </div>
              </div>

              {/* Section 2: Contact Information */}
              <div className="space-y-3 pt-2">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  <Phone className="size-3.5 text-primary" />
                  <span>{lang === "ar" ? "بيانات الاتصال والتواصل" : "Contact Details"}</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-foreground">
                      {t("common.phone")}
                    </label>
                    <div className="relative">
                      <Phone className="pointer-events-none absolute right-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                      <input
                        dir="ltr"
                        value={edit.phone ?? ""}
                        onChange={(e) => setEdit({ ...edit, phone: e.target.value })}
                        placeholder="+966 5x xxx xxxx"
                        className="h-11 w-full rounded-2xl border border-border/80 bg-surface/80 px-4 pr-10 text-sm font-medium placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 transition text-right"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-foreground">
                      {t("common.email")}
                    </label>
                    <div className="relative">
                      <Mail className="pointer-events-none absolute right-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                      <input
                        type="email"
                        dir="ltr"
                        value={edit.email ?? ""}
                        onChange={(e) => setEdit({ ...edit, email: e.target.value })}
                        placeholder="customer@domain.com"
                        className="h-11 w-full rounded-2xl border border-border/80 bg-surface/80 px-4 pr-10 text-sm font-medium placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 transition text-right"
                      />
                    </div>
                  </div>
                </div>

                <div>
                  <label className="mb-1.5 block text-xs font-medium text-foreground">
                    {lang === "ar" ? "العنوان أو المدينة" : "Address"}
                  </label>
                  <div className="relative">
                    <MapPin className="pointer-events-none absolute right-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                    <input
                      value={edit.address ?? ""}
                      onChange={(e) => setEdit({ ...edit, address: e.target.value })}
                      placeholder={
                        lang === "ar" ? "المدينة، الحي، الشارع" : "City, District, Street"
                      }
                      className="h-11 w-full rounded-2xl border border-border/80 bg-surface/80 px-4 pr-10 text-sm font-medium placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 transition"
                    />
                  </div>
                </div>
              </div>

              {/* Section 3: Financial Terms & Status */}
              <div className="space-y-3 pt-2">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  <Wallet className="size-3.5 text-primary" />
                  <span>{lang === "ar" ? "الحد الائتماني والحالة" : "Credit & Status"}</span>
                </div>

                <div>
                  <label className="mb-1.5 block text-xs font-medium text-foreground">
                    {lang === "ar" ? "حد الائتمان المسموح" : "Credit Limit"}
                  </label>
                  <div className="relative">
                    <input
                      type="number"
                      dir="ltr"
                      min={0}
                      step="any"
                      value={edit.credit_limit ?? 0}
                      onChange={(e) => setEdit({ ...edit, credit_limit: Number(e.target.value) })}
                      className="h-11 w-full rounded-2xl border border-border/80 bg-surface/80 px-4 text-sm font-mono font-medium focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 transition text-right"
                    />
                  </div>
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    {lang === "ar"
                      ? "أقصى مبلغ يمكن للعميل شراؤه بالآجل قبل إيقاف الفواتير."
                      : "Maximum allowable credit before blocking future credit sales."}
                  </p>
                </div>

                {/* Active Switch Toggle */}
                <div className="flex items-center justify-between rounded-2xl border border-border/70 bg-surface/60 p-3.5">
                  <div>
                    <p className="text-xs font-bold text-foreground">
                      {lang === "ar" ? "حالة تفعيل العميل" : "Customer Active Status"}
                    </p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      {lang === "ar"
                        ? "العميل النشط يظهر تلقائياً في شاشات البيع ونقاط البيع"
                        : "Active customers appear in POS and sales invoices"}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setEdit({ ...edit, is_active: !(edit.is_active ?? true) })}
                    className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                      (edit.is_active ?? true) ? "bg-primary" : "bg-muted"
                    }`}
                  >
                    <span
                      className={`pointer-events-none inline-block size-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                        (edit.is_active ?? true) ? "translate-x-5" : "translate-x-0"
                      }`}
                    />
                  </button>
                </div>
              </div>

              {/* Form Action Buttons */}
              <div className="flex items-center justify-end gap-3 pt-4 border-t border-border/60">
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => setEdit(null)}
                  className="h-11 px-5 rounded-2xl border border-border/80 bg-surface text-xs font-bold text-muted-foreground hover:text-foreground hover:bg-surface-2 transition active:scale-95"
                >
                  {t("common.cancel")}
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="flex h-11 items-center gap-2 rounded-2xl bg-primary px-6 text-xs font-bold text-primary-foreground shadow-md shadow-primary/25 hover:bg-primary/90 transition active:scale-95 disabled:opacity-50"
                >
                  {saving ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <CheckCircle2 className="size-4" />
                  )}
                  <span>{edit.id ? t("common.save_changes") : t("common.create")}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Sub-components ─── */

function MiniStat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="rounded-2xl border border-border/60 bg-surface/60 p-3 text-center">
      <div className="text-[10px] font-medium text-muted-foreground">{label}</div>
      <div className={`font-mono text-sm font-bold mt-1 ${color ?? "text-foreground"}`}>
        {value}
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

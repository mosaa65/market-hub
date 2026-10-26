import { ModuleGuard } from "@/lib/modules";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowUpRight,
  BookOpen,
  CalendarDays,
  CheckCircle2,
  CircleDollarSign,
  FileText,
  Loader2,
  Plus,
  ReceiptText,
  Search,
  User,
  Users,
  Wallet,
  X,
} from "lucide-react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { useI18n } from "@/lib/i18n";
import { money } from "@/lib/format";
import { paymentMethodLabel, requiresPaymentReference } from "@/lib/payments/payment-methods";
import {
  PaymentMethodPicker,
  DynamicPaymentSelector,
  SplitPaymentDialog,
} from "@/components/ui/payment-method";
import type { SplitPaymentValues } from "@/components/ui/payment-method";
import { buildSplitTenders } from "@/lib/payments/split-tenders";
import { AmountInput } from "@/components/ui/amount-input";
import type { PaymentSettlementSelection } from "@/lib/payments/treasury-types";
import { usePaymentMethodsForContext } from "@/hooks/use-payment-methods";
import { useCashboxes } from "@/hooks/use-cashboxes";
import { useCompanyBankAccounts } from "@/hooks/use-company-bank-accounts";
import { toast } from "sonner";
import { WhatsAppButton } from "@/components/whatsapp-button";
import { debtReminderMessage } from "@/lib/whatsapp-templates";
import {
  VortexDateBadge,
  VortexMetricCard,
  VortexTransactionDetailSheet,
  VortexSearchInput,
} from "@/components/vortex-ui";

const paymentsSearchSchema = z.object({
  customerId: z.string().optional(),
});

export const Route = createFileRoute("/_app/payments")({
  validateSearch: (search: Record<string, unknown>) => paymentsSearchSchema.parse(search),
  head: () => ({ meta: [{ title: "Customer Payments — Vortex ERP" }] }),
  component: () => (
    <ModuleGuard moduleId="payments">
      <PaymentsPage />
    </ModuleGuard>
  ),
});

interface Customer {
  id: string;
  name: string;
  phone: string | null;
  balance: number;
}
interface Invoice {
  id: string;
  invoice_number: string;
  total: number;
  paid: number;
  created_at: string;
  status: string;
}
interface Payment {
  id: string;
  amount: number;
  payment_date: string;
  payment_method: string;
  note: string | null;
  invoice_id: string | null;
  cashbox_id?: string | null;
  bank_account_id?: string | null;
  payment_method_id?: string | null;
  payment_reference?: string | null;
  sales_invoices?: { invoice_number: string } | null;
}

function PaymentsPage() {
  const { t, lang } = useI18n();
  const navigate = useNavigate();
  const searchParams = Route.useSearch();
  const customerId = searchParams?.customerId;
  const [customerSearch, setCustomerSearch] = useState("");
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [selected, setSelected] = useState<Customer | null>(null);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [invoiceId, setInvoiceId] = useState<string>("");
  const [amount, setAmount] = useState("");
  /**
   * A CATALOGUE ID, held as a plain string.
   *
   * This used to be the union `"cash" | "card" | "bank_transfer"` and was sent
   * to `record_customer_payment` unconverted — so the collection screen could
   * only ever take three kinds of money, never a wallet, and had no way to name
   * بنك الكريمي. The picker now decides what exists and the database validates
   * that exact id before converting it to the value stored on the payment.
   */
  const [method, setMethod] = useState<string>("cash");
  const [settlement, setSettlement] = useState<PaymentSettlementSelection>({
    method: "cash",
    paymentMethodId: "cash",
  });
  // الوعاء المالي لكل صندوق/حساب — يُستخدم في جدول الحركات لعرض الوجهة بجانب طريقة الدفع.
  const { activeCashboxes } = useCashboxes();
  const { banks, wallets } = useCompanyBankAccounts();
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [saving, setSaving] = useState(false);
  const [paymentFormOpen, setPaymentFormOpen] = useState(false);
  const [selectedTx, setSelectedTx] = useState<any>(null);
  // التحصيل المجزأ: سند قبض واحد على أكثر من طريقة. آجل مُستبعد نهائياً —
  // سند القبض يحصّل ديناً قائماً ولا ينشئ ديناً جديداً.
  const [splitOpen, setSplitOpen] = useState(false);
  const [splitValues, setSplitValues] = useState<SplitPaymentValues>({
    cash: 0,
    credit: 0,
    bank_transfer: 0,
    mobile_money: 0,
  });
  const COLLECTION_SPLIT_METHODS = ["cash", "bank_transfer", "mobile_money"] as const;
  const { methods: collectionMethods } = usePaymentMethodsForContext("customer_collection", {
    includeCredit: false,
  });
  const selectedMethod = collectionMethods.find((item) => item.id === method);
  const needsReference = selectedMethod?.requiresReference ?? requiresPaymentReference(method);
  const referenceLabel =
    selectedMethod?.legacyValue === "cheque"
      ? lang === "ar"
        ? "رقم الشيك"
        : "Cheque number"
      : selectedMethod?.ledgerKind === "WALLET"
        ? lang === "ar"
          ? "رقم عملية المحفظة"
          : "Wallet transaction reference"
        : lang === "ar"
          ? "رقم الحوالة / المرجع"
          : "Transfer / payment reference";

  useEffect(() => {
    if (collectionMethods.length > 0 && !collectionMethods.some((item) => item.id === method)) {
      setMethod(collectionMethods[0].id);
    }
  }, [collectionMethods, method]);

  useEffect(() => {
    if (!needsReference) setReference("");
  }, [needsReference]);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("customers")
        .select("id,name,phone,balance")
        .eq("is_active", true)
        .order("name")
        .limit(200);
      // استثناء العميل النقدي من سندات تحصيل الذمم
      const list = ((data ?? []) as Customer[]).filter(
        (c) => c.name !== "عميل نقدي" && !(c as any).is_system,
      );
      setCustomers(list);
      if (customerId) {
        let target = list.find((c) => c.id === customerId);
        if (!target) {
          const { data: c } = await supabase
            .from("customers")
            .select("id,name,phone,balance")
            .eq("id", customerId)
            .maybeSingle();
          if (c) target = c as Customer;
        }
        if (target) {
          void loadCustomer(target);
        }
      }
    })();
  }, [customerId]);

  const filteredCustomers = useMemo(() => {
    const q = customerSearch.trim().toLowerCase();
    if (!q) return customers.slice(0, 50);
    return customers
      .filter((c) => c.name.toLowerCase().includes(q) || (c.phone ?? "").includes(q))
      .slice(0, 50);
  }, [customers, customerSearch]);

  async function loadCustomer(c: Customer) {
    setSelected(c);
    setPaymentFormOpen(false);
    setInvoiceId("");
    setAmount("");
    setReference("");
    setNote("");

    let invData: any[] = [];
    let payData: any[] = [];

    try {
      const [inv, pay] = await Promise.all([
        supabase
          .from("sales_invoices")
          .select("id,invoice_number,total,paid,created_at,status")
          .eq("customer_id", c.id)
          .order("created_at", { ascending: false }),
        (supabase.from as any)("customer_payments")
          .select(
            "id,amount,payment_date,payment_method,note,invoice_id,cashbox_id,bank_account_id,payment_method_id,payment_reference,sales_invoices(invoice_number)",
          )
          .eq("customer_id", c.id)
          .order("payment_date", { ascending: false })
          .limit(50),
      ]);
      invData = inv.data ?? [];
      payData = pay.data ?? [];
    } catch {
      const [inv, pay] = await Promise.all([
        supabase
          .from("sales_invoices")
          .select("id,invoice_number,total,paid,created_at,status")
          .eq("customer_id", c.id)
          .order("created_at", { ascending: false }),
        (supabase.from as any)("customer_payments")
          .select(
            "id,amount,payment_date,payment_method,note,invoice_id,sales_invoices(invoice_number)",
          )
          .eq("customer_id", c.id)
          .order("payment_date", { ascending: false })
          .limit(50),
      ]);
      invData = inv.data ?? [];
      payData = pay.data ?? [];
    }

    setInvoices(invData as Invoice[]);
    setPayments(payData as Payment[]);
  }

  async function refresh() {
    if (!selected) return;
    const { data: c } = await supabase
      .from("customers")
      .select("id,name,phone,balance")
      .eq("id", selected.id)
      .maybeSingle();
    if (c) {
      setSelected(c as Customer);
      setCustomers((prev) => prev.map((x) => (x.id === c.id ? (c as Customer) : x)));
    }
    await loadCustomer(selected);
  }

  const outstanding = invoices.filter((i) => Number(i.total) - Number(i.paid) > 0.001);
  const selectedInvoice = outstanding.find((i) => i.id === invoiceId);
  const remaining = selectedInvoice
    ? Number(selectedInvoice.total) - Number(selectedInvoice.paid)
    : 0;

  // مبلغ التحصيل القابل للتحصيل: متبقي الفاتورة المختارة أو رصيد العميل كاملاً.
  const collectibleAmount = selectedInvoice
    ? remaining
    : Math.max(Number(selected?.balance ?? 0), 0);
  const splitResult = buildSplitTenders(
    {
      cash: splitValues.cash,
      bank_transfer: splitValues.bank_transfer,
      mobile_money: splitValues.mobile_money,
    },
    collectibleAmount,
  );
  const isSplitCollection = splitResult.tenders.length > 1;

  async function submit() {
    if (saving || !selected) return;

    // ── تحصيل مجزأ: دفعة واحدة موزعة على أكثر من طريقة ──
    if (isSplitCollection) {
      const payable = collectibleAmount;
      if (!splitResult.balanced) {
        return toast.error(
          lang === "ar"
            ? "مجموع توزيع التحصيل لا يطابق المبلغ المستحق"
            : "The split total does not match the amount due",
        );
      }
      if (splitResult.allocated > payable + 0.01) {
        return toast.error(
          t("payments.exceeds_remaining") ||
            (lang === "ar" ? "المبلغ يتجاوز المتبقي" : "Amount exceeds remaining"),
        );
      }

      setSaving(true);
      try {
        const { error } = await supabase.rpc("record_customer_payment_splits" as any, {
          _customer_id: selected.id,
          _invoice_id: invoiceId || null,
          _amount: splitResult.allocated,
          _payment_date: date,
          _note: note.trim() || null,
          _splits: splitResult.tenders.map((line) => ({
            method: line.method,
            methodId: line.method,
            amount: line.amount,
            reference:
              line.method === "bank_transfer"
                ? splitValues.bankReference
                : line.method === "mobile_money"
                  ? splitValues.walletReference
                  : undefined,
          })),
        });
        if (error) throw error;

        setSelectedTx({
          id: `REC-${String(Date.now()).slice(-6)}`,
          type: "payment",
          title: lang === "ar" ? "سند قبض مجزأ" : "Split receipt",
          amount: splitResult.allocated,
          date,
          customerName: selected.name,
          customerPhone: selected.phone,
          referenceNumber: splitValues.bankReference || splitValues.walletReference || undefined,
          method: splitResult.tenders.map((line) => pmLabel(line.method)).join(" + "),
          notes: note.trim() || undefined,
          remainingBalance: Math.max(Number(selected.balance) - splitResult.allocated, 0),
        });
        setPaymentFormOpen(false);
        setSplitValues({ cash: 0, credit: 0, bank_transfer: 0, mobile_money: 0 });
        setNote("");
        await refresh();
      } catch (e: any) {
        toast.error(e.message ?? t("common.failed"));
      } finally {
        setSaving(false);
      }
      return;
    }

    const amt = Number(amount);
    if (!amt || amt <= 0)
      return toast.error(
        t("payments.invalid_amount") || (lang === "ar" ? "أدخل مبلغ صحيح" : "Enter a valid amount"),
      );
    const payableAmount = selectedInvoice ? remaining : Math.max(Number(selected.balance), 0);
    if (amt > payableAmount + 0.01)
      return toast.error(
        t("payments.exceeds_remaining") ||
          (lang === "ar" ? "المبلغ يتجاوز المتبقي" : "Amount exceeds remaining"),
      );
    if (needsReference && !reference.trim()) {
      return toast.error(
        lang === "ar" ? "أدخل رقم الحوالة أو المرجع" : "Enter the payment reference",
      );
    }
    setSaving(true);
    try {
      const paymentNote = [
        reference.trim() ? `مرجع: ${reference.trim()}` : null,
        note.trim() || null,
      ]
        .filter(Boolean)
        .join(" | ");

      let error: any = null;
      try {
        const res = await supabase.rpc("record_customer_payment" as any, {
          _customer_id: selected.id,
          _invoice_id: invoiceId || null,
          _amount: amt,
          // The RPC validates this exact catalogue id (including its enabled
          // state and allowed context), then stores its legacy ENUM value.
          _method: settlement.paymentMethodId || method,
          _payment_date: date,
          _note: paymentNote || null,
          _cashbox_id: settlement.cashboxId || null,
          _bank_account_id: settlement.bankAccountId || null,
          _payment_method_id: settlement.paymentMethodId || null,
          _cheque_number: settlement.chequeNumber || settlement.cheque?.chequeNumber || null,
          _cheque_bank: settlement.chequeBank || settlement.cheque?.bankName || null,
          _cheque_due_date: settlement.chequeDueDate || settlement.cheque?.dueDate || null,
          _cheque_drawer: settlement.chequeDrawer || settlement.cheque?.drawerName || null,
        });
        error = res.error;
      } catch {
        const res = await supabase.rpc("record_customer_payment" as any, {
          _customer_id: selected.id,
          _invoice_id: invoiceId || null,
          _amount: amt,
          _method: settlement.paymentMethodId || method,
          _payment_date: date,
          _note: paymentNote || null,
        });
        error = res.error;
      }

      if (error) throw error;
      const receiptNumber = selectedInvoice
        ? `REC-${selectedInvoice.invoice_number}`
        : `REC-${String(Date.now()).slice(-6)}`;
      const resolvedMethodLabel = settlement.bankAccountName
        ? `${pmLabel(method)} (${settlement.bankAccountName})`
        : settlement.cashboxName
          ? `${pmLabel(method)} (${settlement.cashboxName})`
          : pmLabel(method);
      setSelectedTx({
        id: receiptNumber,
        type: "payment",
        title: selectedInvoice ? "سند قبض تحصيل فاتورة" : "سند قبض بتوزيع تلقائي",
        amount: amt,
        date,
        customerName: selected.name,
        customerPhone: selected.phone,
        referenceNumber: settlement.reference || receiptNumber,
        method: resolvedMethodLabel,
        cashboxName: settlement.cashboxName,
        bankAccountName: settlement.bankAccountName,
        notes: paymentNote || undefined,
        remainingBalance: Math.max(Number(selected.balance) - amt, 0),
      });
      setPaymentFormOpen(false);
      setAmount("");
      setReference("");
      setNote("");
      await refresh();
    } catch (e: any) {
      toast.error(e.message ?? t("common.failed"));
    } finally {
      setSaving(false);
    }
  }

  /** الانتقال إلى شاشة كشف الحساب — بلا منطق حسابي محلي */
  function goStatement(customerId: string) {
    void navigate({
      to: "/statements/$entityType",
      params: { entityType: "customer" },
      search: { customerId } as never,
    });
  }

  /** الانتقال إلى دفتر أستاذ العميل — نفس وجهة الكشف الشامل. */
  function goLedger(customerId: string) {
    void navigate({
      to: "/statements/$entityType",
      params: { entityType: "customer" },
      search: { customerId, tab: "ledger" } as never,
    });
  }

  function beginPayment(invoice?: Invoice) {
    setInvoiceId(invoice?.id ?? "");
    setAmount(invoice ? String(Number(invoice.total) - Number(invoice.paid)) : "");
    setPaymentFormOpen(true);
  }

  // The catalogue, not a local map: a map defaulted everything it did not know
  // to the raw key, and it did not know mobile_money or a tenant-created method.
  const pmLabel = (m: string) => paymentMethodLabel(m, lang === "ar" ? "ar" : "en");

  return (
    <>
      <PageHeader
        title={lang === "ar" ? "تحصيل دفعات العملاء" : "Customer Payments"}
        subtitle={
          lang === "ar"
            ? "اختر عميلاً، راجع مستحقاته، ثم سجّل الدفعة."
            : "Pick a customer, review what they owe, then record the payment."
        }
      />

      <div className="grid grid-cols-1 items-start gap-3 sm:gap-4 lg:grid-cols-[minmax(300px,360px)_minmax(0,1fr)]">
        {/* ══ القسم الأول: دليل العملاء ══ */}
        <aside className="panel-elevated overflow-hidden p-0 lg:sticky lg:top-4">
          <div className="border-b border-border/70 px-3.5 py-3">
            <div className="mb-2.5 flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2">
                <div className="grid size-8 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
                  <Users className="size-4" />
                </div>
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-foreground">
                    {lang === "ar" ? "دليل العملاء" : "Customer directory"}
                  </div>
                  <div className="truncate text-[11px] text-muted-foreground">
                    {lang === "ar"
                      ? "اختر عميلاً لبدء التحصيل"
                      : "Pick a customer to start collecting"}
                  </div>
                </div>
              </div>
              <span className="shrink-0 rounded-full bg-surface-2 px-2 py-0.5 font-mono text-[10px] font-medium text-muted-foreground tabular-nums">
                {filteredCustomers.length}
              </span>
            </div>
            <VortexSearchInput
              value={customerSearch}
              onValueChange={setCustomerSearch}
              placeholder={
                lang === "ar" ? "ابحث بالاسم أو رقم الهاتف..." : "Search customer or phone..."
              }
              resultCount={filteredCustomers.length}
              className="w-full"
            />
          </div>
          <div className="max-h-[calc(100vh-260px)] space-y-1.5 overflow-y-auto p-2.5 max-lg:max-h-[42vh]">
            {filteredCustomers.length === 0 ? (
              <div className="grid place-items-center gap-2 py-8 text-center">
                <Search className="size-5 text-muted-foreground/50" />
                <div className="text-xs text-muted-foreground">
                  {lang === "ar" ? "لا يوجد عميل مطابق" : "No matching customer"}
                </div>
              </div>
            ) : (
              filteredCustomers.map((c) => {
                const active = selected?.id === c.id;
                const hasBalance = Number(c.balance) > 0;
                return (
                  <button
                    key={c.id}
                    onClick={() => loadCustomer(c)}
                    className={`group flex w-full items-center gap-2.5 rounded-xl border px-2.5 py-2 text-start transition-colors duration-200 ${active ? "border-primary/40 bg-primary/[0.08]" : "border-border/60 bg-card hover:border-border hover:bg-accent/40"}`}
                  >
                    <div
                      className={`grid size-8 shrink-0 place-items-center rounded-xl text-xs font-bold ${active ? "bg-primary text-primary-foreground" : "bg-surface-2 text-muted-foreground"}`}
                    >
                      {c.name.trim().slice(0, 1).toUpperCase() || <User className="size-3.5" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] font-semibold text-foreground">
                        {c.name}
                      </div>
                      <div className="truncate font-mono text-[11px] text-muted-foreground">
                        {c.phone ?? "—"}
                      </div>
                    </div>
                    <span
                      className={`shrink-0 rounded-lg border px-1.5 py-1 text-end ${hasBalance ? "border-amber-500/20 bg-amber-500/10 text-amber-600 dark:text-amber-400" : "border-border/60 bg-surface-2 text-muted-foreground"}`}
                    >
                      <span className="block text-[9px] font-medium opacity-70">
                        {hasBalance
                          ? lang === "ar"
                            ? "مستحق"
                            : "Due"
                          : lang === "ar"
                            ? "خالص"
                            : "Settled"}
                      </span>
                      <span className="block font-mono text-[11px] font-bold tabular-nums">
                        {money(Number(c.balance))}
                      </span>
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </aside>

        {/* ══ القسم الثاني: مساحة عمل العميل المحدد ══ */}
        {!selected ? (
          <section className="panel-elevated relative min-h-[420px] overflow-hidden p-5 sm:p-8">
            <div className="mx-auto flex max-w-xl flex-col items-center pt-4 text-center sm:pt-8">
              <div className="grid size-16 place-items-center rounded-2xl bg-primary/10 text-primary">
                <Wallet className="size-7" />
              </div>
              <div className="mt-4 text-base font-bold tracking-tight text-foreground sm:text-lg">
                {lang === "ar" ? "مركز تحصيل دفعات العملاء" : "Customer payment centre"}
              </div>
              <div className="mt-1.5 max-w-md text-xs leading-6 text-muted-foreground sm:text-sm">
                {lang === "ar"
                  ? "اختر عميلاً من الدليل، ثم راجع مستحقاته وسجّل الدفعة من مساحة عمل واحدة واضحة."
                  : "Choose a customer, review their outstanding amounts, then record the payment from one clear workspace."}
              </div>
            </div>
            <div className="mx-auto mt-8 grid max-w-3xl gap-2.5 sm:grid-cols-3">
              {[
                {
                  icon: <Users className="size-4" />,
                  title: lang === "ar" ? "1. اختر العميل" : "1. Pick customer",
                  text: lang === "ar" ? "ابحث بالاسم أو الهاتف" : "Search by name or phone",
                },
                {
                  icon: <ReceiptText className="size-4" />,
                  title: lang === "ar" ? "2. راجع الفواتير" : "2. Review invoices",
                  text:
                    lang === "ar"
                      ? "حدّد فاتورة أو وزّع تلقائياً"
                      : "Select an invoice or allocate automatically",
                },
                {
                  icon: <CircleDollarSign className="size-4" />,
                  title: lang === "ar" ? "3. رحّل الدفعة" : "3. Post payment",
                  text:
                    lang === "ar" ? "اختر الطريقة وأصدر السند" : "Choose method and issue receipt",
                },
              ].map((step) => (
                <div
                  key={step.title}
                  className="rounded-xl border border-border/70 bg-surface-2/40 p-3 text-start"
                >
                  <div className="mb-2.5 grid size-8 place-items-center rounded-xl bg-primary/10 text-primary">
                    {step.icon}
                  </div>
                  <div className="text-xs font-semibold text-foreground">{step.title}</div>
                  <div className="mt-0.5 text-[11px] leading-5 text-muted-foreground">
                    {step.text}
                  </div>
                </div>
              ))}
            </div>
          </section>
        ) : (
          <main className="space-y-3 sm:space-y-4">
            {/* شريط السياق المالي */}
            <div className="grid grid-cols-2 gap-2.5 sm:gap-4 lg:grid-cols-4">
              <VortexMetricCard
                title={lang === "ar" ? "العميل" : "Customer"}
                value={selected.name}
                subtitle={selected.phone ?? "—"}
                icon={<User className="size-4 text-primary" />}
                tone="default"
              />
              <VortexMetricCard
                title={lang === "ar" ? "إجمالي المستحق" : "Total due"}
                value={money(Number(selected.balance))}
                subtitle={
                  Number(selected.balance) > 0
                    ? lang === "ar"
                      ? "مطلوب تحصيله"
                      : "Awaiting collection"
                    : lang === "ar"
                      ? "لا يوجد مستحق"
                      : "Nothing due"
                }
                icon={<Wallet className="size-4 text-amber-500" />}
                tone={Number(selected.balance) > 0 ? "warning" : "success"}
              />
              <VortexMetricCard
                title={lang === "ar" ? "فواتير مستحقة" : "Open invoices"}
                value={outstanding.length}
                subtitle={lang === "ar" ? "بحاجة إلى تحصيل" : "Waiting to be collected"}
                icon={<ReceiptText className="size-4 text-sky-500" />}
                tone="info"
              />
              <VortexMetricCard
                title={lang === "ar" ? "آخر تحصيلات" : "Recent receipts"}
                value={payments.length}
                subtitle={lang === "ar" ? "سندات قبض مسجلة" : "recorded receipts"}
                icon={<CircleDollarSign className="size-4 text-emerald-500" />}
                tone="success"
              />
            </div>

            {/* شريط الإجراءات: أدوات العميل + سند جديد */}
            <section className="panel-elevated flex flex-wrap items-center justify-between gap-2 p-2.5 sm:p-3">
              <div className="flex items-center gap-1.5">
                {/* أيقونات الوصول السريع: كشف الحساب ثم دفتر الأستاذ */}
                <button
                  type="button"
                  onClick={() => goStatement(selected.id)}
                  title={lang === "ar" ? "كشف الحساب" : "Account statement"}
                  className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-border/70 bg-surface-2/60 px-3 text-xs font-medium text-foreground transition hover:border-primary/30 hover:text-primary"
                >
                  <FileText className="size-3.5" />
                  <span>{lang === "ar" ? "كشف الحساب" : "Statement"}</span>
                </button>
                <button
                  type="button"
                  onClick={() => goLedger(selected.id)}
                  title={lang === "ar" ? "دفتر الأستاذ" : "Customer ledger"}
                  className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-border/70 bg-surface-2/60 px-3 text-xs font-medium text-foreground transition hover:border-primary/30 hover:text-primary"
                >
                  <BookOpen className="size-3.5" />
                  <span>{lang === "ar" ? "دفتر الأستاذ" : "Ledger"}</span>
                </button>
              </div>
              <div className="flex items-center gap-2">
                {Number(selected.balance) > 0 && (
                  <WhatsAppButton
                    phone={selected.phone}
                    label={lang === "ar" ? "تذكير واتساب" : "WhatsApp reminder"}
                    message={debtReminderMessage({
                      name: selected.name,
                      balance: money(Number(selected.balance)),
                      lang,
                    })}
                    className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-border/70 bg-surface-2/60 px-3 text-xs font-medium text-foreground transition hover:border-emerald-500/40 hover:text-emerald-600 disabled:cursor-not-allowed disabled:opacity-40"
                  />
                )}
                <button
                  type="button"
                  onClick={() => beginPayment()}
                  className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-primary px-3.5 text-xs font-semibold text-primary-foreground shadow-xs transition hover:opacity-95"
                >
                  <Plus className="size-4" />
                  {lang === "ar" ? "سند قبض جديد" : "New receipt"}
                </button>
              </div>
            </section>

            <div>
              {/* منطقة تسجيل الدفعة */}
              {paymentFormOpen && (
                <section className="panel-elevated mb-3 overflow-hidden p-0 sm:mb-4">
                  {/* رأس قسم السند — يظهر داخل الصفحة بدل النافذة المنبثقة */}
                  <div className="flex items-center justify-between gap-2 border-b border-border/70 px-3.5 py-2.5">
                    <div className="flex min-w-0 items-center gap-2">
                      <div className="grid size-8 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
                        <Wallet className="size-4" />
                      </div>
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-foreground">
                          {selectedInvoice
                            ? lang === "ar"
                              ? `تحصيل فاتورة #${selectedInvoice.invoice_number}`
                              : `Collect invoice #${selectedInvoice.invoice_number}`
                            : lang === "ar"
                              ? "سند قبض جديد"
                              : "New receipt"}
                        </div>
                        <div className="truncate text-[11px] text-muted-foreground">
                          {selectedInvoice
                            ? `${lang === "ar" ? "المتبقي" : "Remaining"}: ${money(remaining)}`
                            : lang === "ar"
                              ? "توزيع تلقائي على أقدم الفواتير المستحقة"
                              : "Applied automatically to oldest outstanding invoices"}
                        </div>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <span className="hidden max-w-[140px] truncate rounded-full bg-surface-2 px-2 py-0.5 text-[10px] font-medium text-muted-foreground sm:inline">
                        {selected.name}
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          setPaymentFormOpen(false);
                          setInvoiceId("");
                          setAmount("");
                        }}
                        title={lang === "ar" ? "إغلاق" : "Close"}
                        aria-label={lang === "ar" ? "إغلاق" : "Close"}
                        className="grid size-7 place-items-center rounded-lg border-border/70 bg-surface-2/60 text-muted-foreground transition hover:border-destructive/30 hover:text-destructive"
                      >
                        <X className="size-3.5" />
                      </button>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 gap-3 p-3.5 sm:grid-cols-2">
                    <div>
                      <div className="mb-1.5 flex items-center justify-between gap-2">
                        <label className="text-xs font-semibold text-muted-foreground">
                          {lang === "ar" ? "المبلغ المحصل" : "Collected amount"}
                        </label>
                        {selectedInvoice && (
                          <button
                            type="button"
                            onClick={() => setAmount(String(remaining))}
                            className="text-[11px] font-bold text-primary hover:underline"
                          >
                            {lang === "ar" ? "سداد كامل" : "Full payment"}
                          </button>
                        )}
                      </div>
                      {/* المبلغ المُوحّد: فاصلة آلاف + تفقيط تحت الرقم. */}
                      <AmountInput
                        min={0}
                        value={isSplitCollection ? splitResult.allocated : toNumberOrNull(amount)}
                        onValueChange={(v) => {
                          if (isSplitCollection) return;
                          setAmount(v == null ? "" : String(v));
                        }}
                        disabled={isSplitCollection}
                        placeholder="0.00"
                        aria-label={lang === "ar" ? "المبلغ المحصل" : "Collected amount"}
                        wordsClassName="text-xs"
                        containerClassName="[&_input]:h-10 [&_input]:rounded-xl [&_input]:border-input [&_input]:text-base [&_input]:font-bold"
                      />
                      {Number(amount) > 0 && (
                        <div className="mt-1.5 flex justify-between px-1 text-[11px] text-muted-foreground">
                          <span>
                            {lang === "ar" ? "المتبقي بعد التحصيل" : "Remaining after payment"}
                          </span>
                          <span className="font-mono font-bold text-foreground">
                            {money(
                              Math.max(
                                (selectedInvoice ? remaining : Number(selected.balance)) -
                                  Number(amount),
                                0,
                              ),
                            )}
                          </span>
                        </div>
                      )}
                    </div>
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <label className="text-xs font-semibold text-muted-foreground">
                          {lang === "ar"
                            ? "طريقة الدفع والتوجيه المالي"
                            : "Payment method & settlement"}
                        </label>
                        <button
                          type="button"
                          onClick={() => setSplitOpen(true)}
                          className="rounded-lg border-border/70 bg-surface-2 px-2 py-0.5 text-[11px] font-semibold text-foreground transition hover:border-primary/30 hover:text-primary"
                        >
                          {lang === "ar" ? "دفع مجزأ" : "Split"}
                        </button>
                      </div>
                      <DynamicPaymentSelector
                        context="customer_collection"
                        value={method}
                        onChange={(methodId) => {
                          setMethod(methodId);
                          setReference("");
                        }}
                        settlement={settlement}
                        onSettlementChange={(next) => {
                          setSettlement(next);
                          if (next.reference) setReference(next.reference);
                        }}
                        includeCredit={false}
                      />
                      {isSplitCollection && (
                        <button
                          type="button"
                          onClick={() => setSplitOpen(true)}
                          className="flex w-full items-center justify-between gap-2 rounded-xl border-primary/25 bg-primary/[0.06] px-2.5 py-1.5 text-[11px] font-semibold text-primary"
                        >
                          <span className="truncate">
                            {lang === "ar"
                              ? `تحصيل مجزأ · ${splitResult.tenders.length} طرق`
                              : `Split collection · ${splitResult.tenders.length} tenders`}
                          </span>
                          <span className="shrink-0 font-mono">{money(splitResult.allocated)}</span>
                        </button>
                      )}
                    </div>
                    <Field label={lang === "ar" ? "تاريخ السند" : "Receipt date"}>
                      <div className="relative">
                        <CalendarDays className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                        <input
                          type="date"
                          value={date}
                          onChange={(e) => setDate(e.target.value)}
                          className="h-10 w-full rounded-xl border border-input bg-surface/70 ps-10 pe-3 text-sm focus-visible:border-primary/60 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/10"
                        />
                      </div>
                    </Field>
                    <Field label={lang === "ar" ? "ملاحظات" : "Notes"}>
                      <input
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        placeholder={lang === "ar" ? "ملاحظة اختيارية" : "Optional note"}
                        className="h-10 w-full rounded-xl border border-input bg-surface/70 px-3 text-sm focus-visible:border-primary/60 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/10"
                      />
                    </Field>
                  </div>
                  <div className="flex items-center justify-between gap-2 border-t border-border/70 px-3.5 py-2.5">
                    <span className="hidden text-[11px] text-muted-foreground sm:block">
                      {lang === "ar"
                        ? "تحقق من المبلغ وطريقة الدفع قبل الترحيل"
                        : "Review amount and method before posting"}
                    </span>
                    <button
                      onClick={submit}
                      disabled={saving}
                      className="inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-xl bg-primary px-4 text-xs font-semibold text-primary-foreground shadow-xs transition hover:opacity-95 disabled:opacity-60 sm:w-auto"
                    >
                      {saving ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <Plus className="size-4" />
                      )}
                      {lang === "ar" ? "تسجيل وترحيل الدفعة" : "Record and post payment"}
                    </button>
                  </div>
                </section>
              )}

              {/* الفواتير المستحقة */}
              <section className="panel-elevated overflow-hidden p-0">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/70 px-3.5 py-3">
                  <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                    {lang === "ar" ? "الفواتير المستحقة" : "Outstanding invoices"}
                    <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-medium text-muted-foreground tabular-nums">
                      {outstanding.length}
                    </span>
                  </h3>
                  <div className="flex items-center gap-2">
                    <span className="hidden text-[11px] text-muted-foreground sm:inline">
                      {lang === "ar"
                        ? "حدّد فاتورة لفتح التحصيل"
                        : "Select an invoice to start collection"}
                    </span>
                    {Number(selected.balance) > 0 && !paymentFormOpen && (
                      <button
                        type="button"
                        onClick={() => beginPayment()}
                        className="inline-flex h-8 items-center gap-1 rounded-lg border border-primary/25 bg-primary/10 px-2.5 text-[11px] font-semibold text-primary transition hover:bg-primary hover:text-primary-foreground"
                      >
                        {lang === "ar" ? "تحصيل تلقائي" : "Automatic collection"}
                      </button>
                    )}
                  </div>
                </div>
                {outstanding.length === 0 ? (
                  <div className="grid place-items-center gap-2 py-6 text-center">
                    <CheckCircle2 className="size-5 text-emerald-600 dark:text-emerald-400" />
                    <div className="text-xs text-muted-foreground">
                      {lang === "ar"
                        ? "لا توجد فواتير مستحقة لهذا العميل"
                        : "No outstanding invoices for this customer"}
                    </div>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full border-collapse text-[13px]">
                      <thead>
                        <tr className="border-b border-border bg-surface/60">
                          <th className="h-9 px-2.5 text-start text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                            #
                          </th>
                          <th className="h-9 px-2.5 text-start text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                            {lang === "ar" ? "التاريخ" : "Date"}
                          </th>
                          <th className="h-9 px-2.5 text-end text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                            {lang === "ar" ? "الإجمالي" : "Total"}
                          </th>
                          <th className="h-9 px-2.5 text-end text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                            {lang === "ar" ? "المدفوع" : "Paid"}
                          </th>
                          <th className="h-9 px-2.5 text-end text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                            {lang === "ar" ? "المتبقي" : "Remaining"}
                          </th>
                          <th className="h-9 px-2.5"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {outstanding.map((i) => {
                          const rem = Number(i.total) - Number(i.paid);
                          const isSelected = invoiceId === i.id;
                          return (
                            <tr
                              key={i.id}
                              className={`border-b border-border/60 transition-colors duration-150 ${isSelected ? "bg-primary/[0.07]" : "hover:bg-accent/40"}`}
                            >
                              <td className="px-2.5 py-2 font-mono text-xs whitespace-nowrap">
                                {i.invoice_number}
                              </td>
                              <td className="px-2.5 py-2 font-mono text-xs text-muted-foreground whitespace-nowrap">
                                {new Date(i.created_at).toLocaleDateString()}
                              </td>
                              <td className="px-2.5 py-2 text-end font-mono text-xs tabular-nums text-muted-foreground">
                                {money(Number(i.total))}
                              </td>
                              <td className="px-2.5 py-2 text-end font-mono text-xs tabular-nums text-emerald-600 dark:text-emerald-400">
                                {money(Number(i.paid))}
                              </td>
                              <td className="px-2.5 py-2 text-end font-mono text-xs font-bold tabular-nums text-amber-600 dark:text-amber-400">
                                {money(rem)}
                              </td>
                              <td className="px-2.5 py-2 text-end whitespace-nowrap">
                                <button
                                  onClick={() => beginPayment(i)}
                                  className={`inline-flex h-7 items-center gap-1 rounded-lg border px-2 text-[11px] font-semibold transition ${isSelected ? "border-primary/40 bg-primary/15 text-primary" : "border-border/70 bg-surface-2 text-foreground hover:border-primary/30 hover:text-primary"}`}
                                >
                                  {isSelected && <CheckCircle2 className="size-3" />}
                                  {isSelected
                                    ? lang === "ar"
                                      ? "قيد التحصيل"
                                      : "Collecting"
                                    : lang === "ar"
                                      ? "تحصيل"
                                      : "Collect"}
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            </div>

            {/* آخر التحصيلات */}
            <section className="panel-elevated overflow-hidden p-0">
              <div className="border-b border-border/70 px-3.5 py-3">
                <h3 className="text-sm font-semibold text-foreground">
                  {lang === "ar" ? "آخر التحصيلات" : "Recent collections"}
                </h3>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  {lang === "ar" ? "اضغط على أي صف لعرض السند" : "Tap any row to open the receipt"}
                </p>
              </div>
              {payments.length === 0 ? (
                <div className="py-6 text-center text-xs text-muted-foreground">
                  {lang === "ar"
                    ? "لم تُسجل تحصيلات لهذا العميل بعد"
                    : "No collections recorded for this customer yet"}
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-[13px]">
                    <thead>
                      <tr className="border-b border-border bg-surface/60">
                        <th className="h-9 px-2.5 text-start text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                          {lang === "ar" ? "التاريخ" : "Date"}
                        </th>
                        <th className="h-9 px-2.5 text-start text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                          {lang === "ar" ? "الفاتورة" : "Invoice"}
                        </th>
                        <th className="h-9 px-2.5 text-start text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                          {lang === "ar" ? "الطريقة" : "Method"}
                        </th>
                        <th className="h-9 px-2.5 text-start text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                          {lang === "ar" ? "ملاحظة" : "Note"}
                        </th>
                        <th className="h-9 px-2.5 text-end text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                          {lang === "ar" ? "المبلغ" : "Amount"}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {payments.map((p) => {
                        const destinationName =
                          (p.cashbox_id &&
                            activeCashboxes.find((c) => c.id === p.cashbox_id)?.name_ar) ||
                          (p.bank_account_id &&
                            [...banks, ...wallets].find((b) => b.id === p.bank_account_id)
                              ?.name_ar);
                        const displayMethod = destinationName
                          ? `${pmLabel(p.payment_method)} (${destinationName})`
                          : pmLabel(p.payment_method);

                        return (
                          <tr
                            key={p.id}
                            onClick={() => {
                              setSelectedTx({
                                id: p.id,
                                type: "payment",
                                title: `سند تحصيل #${p.id.slice(-6)}`,
                                amount: Number(p.amount),
                                date: p.payment_date,
                                customerName: selected.name,
                                customerPhone: selected.phone,
                                referenceNumber: p.payment_reference || p.id.slice(-6),
                                method: displayMethod,
                                cashboxName: p.cashbox_id
                                  ? activeCashboxes.find((c) => c.id === p.cashbox_id)?.name_ar
                                  : undefined,
                                bankAccountName: p.bank_account_id
                                  ? [...banks, ...wallets].find((b) => b.id === p.bank_account_id)
                                      ?.name_ar
                                  : undefined,
                                notes: p.note || undefined,
                                remainingBalance: Number(selected.balance),
                              });
                            }}
                            className="min-h-[44px] cursor-pointer border-b border-border/60 transition-colors duration-150 hover:bg-accent/40"
                          >
                            <td className="px-2.5 py-2 whitespace-nowrap">
                              <VortexDateBadge date={p.payment_date} size="sm" />
                            </td>
                            <td className="px-2.5 py-2 font-mono text-xs whitespace-nowrap">
                              <span className="rounded-md bg-surface-2 px-1.5 py-0.5 text-muted-foreground">
                                {p.sales_invoices?.invoice_number ??
                                  (lang === "ar" ? "على الحساب" : "On account")}
                              </span>
                            </td>
                            <td className="px-2.5 py-2">
                              <span className="inline-block max-w-[180px] truncate rounded-md border border-border/60 bg-surface-2 px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                                {displayMethod}
                              </span>
                            </td>
                            <td className="max-w-[220px] truncate px-2.5 py-2 text-xs text-muted-foreground/80">
                              {p.note ?? "—"}
                            </td>
                            <td className="px-2.5 py-2 text-end font-mono text-xs font-bold tabular-nums text-emerald-600 dark:text-emerald-400 whitespace-nowrap">
                              <div className="flex items-center justify-end gap-1.5">
                                <span>{money(Number(p.amount))}</span>
                                <ArrowUpRight className="size-3.5 opacity-60" />
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </main>
        )}
      </div>

      <VortexTransactionDetailSheet
        open={!!selectedTx}
        onOpenChange={(op) => !op && setSelectedTx(null)}
        transaction={selectedTx}
      />

      {/* التحصيل المجزأ: آجل مُستبعد لأن سند القبض لا ينشئ ديناً. */}
      <SplitPaymentDialog
        open={splitOpen}
        onOpenChange={setSplitOpen}
        total={collectibleAmount}
        initialValues={splitValues}
        methods={COLLECTION_SPLIT_METHODS}
        isCreditAllowed={false}
        onConfirm={(values) => {
          setSplitValues(values);
          const tenders = buildSplitTenders(
            {
              cash: values.cash,
              credit: 0,
              bank_transfer: values.bank_transfer,
              mobile_money: values.mobile_money,
            },
            selectedInvoice ? remaining : Math.max(Number(selected?.balance ?? 0), 0),
          );
          if (tenders.tenders.length <= 1) {
            // طريقة واحدة = سند مفرد، لا تجزئة: يُمرّر المبلغ والمصدر للمسار العادي.
            setAmount(String(tenders.paid));
            if (tenders.tenders[0]) setMethod(tenders.tenders[0].method);
            toast.info(
              lang === "ar"
                ? "طريقة واحدة مختارة — سيُسجّل سنداً مفرداً"
                : "A single tender was chosen — recorded as a normal receipt",
            );
            return;
          }
          setAmount(String(tenders.paid));
        }}
      />
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-medium text-muted-foreground">{label}</label>
      {children}
    </div>
  );
}

/** جسر التحويل بين سلسلة النموذج وقيمة `AmountInput` (`number | null`). */
function toNumberOrNull(value: string | number | null | undefined): number | null {
  if (value == null) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed.replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

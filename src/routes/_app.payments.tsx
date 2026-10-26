import { ModuleGuard } from "@/lib/modules";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowUpRight,
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
  Layers,
} from "lucide-react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { useI18n } from "@/lib/i18n";
import { money } from "@/lib/format";
import { paymentMethodLabel, requiresPaymentReference } from "@/lib/payments/payment-methods";
import { PaymentMethodPicker, DynamicPaymentSelector } from "@/components/ui/payment-method";
import { AmountInput } from "@/components/ui/amount-input";
import { SplitPaymentDialog, type SplitPaymentValues } from "@/components/ui/payment-method/split-payment-dialog";
import type { PaymentSettlementSelection } from "@/lib/payments/treasury-types";
import { usePaymentMethodsForContext } from "@/hooks/use-payment-methods";
import { useCashboxes } from "@/hooks/use-cashboxes";
import { useCompanyBankAccounts } from "@/hooks/use-company-bank-accounts";
import { toast } from "sonner";
import { WhatsAppButton } from "@/components/whatsapp-button";
import { debtReminderMessage } from "@/lib/whatsapp-templates";
import {
  VortexDateBadge,
  VortexDrawerDialog,
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
  is_system?: boolean | null;
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
  const [splitCollectionOpen, setSplitCollectionOpen] = useState(false);
  const [splitCollectionValues, setSplitCollectionValues] = useState<SplitPaymentValues>({
    cash: 0,
    credit: 0,
    bank_transfer: 0,
    mobile_money: 0,
  });
  const [isSplitCollection, setIsSplitCollection] = useState(false);
  const [selectedTx, setSelectedTx] = useState<any>(null);
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
        .select("id,name,phone,balance,is_system")
        .eq("is_active", true)
        .order("name")
        .limit(200);
      const list = ((data ?? []) as Customer[]).filter((customer) => !customer.is_system);
      setCustomers(list);
      if (customerId) {
        let target = list.find((c) => c.id === customerId);
        if (!target) {
          const { data: c } = await supabase
            .from("customers")
            .select("id,name,phone,balance,is_system")
            .eq("id", customerId)
            .maybeSingle();
          if (c && !(c as Customer).is_system) target = c as Customer;
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
    setIsSplitCollection(false);
    setSplitCollectionValues({ cash: 0, credit: 0, bank_transfer: 0, mobile_money: 0 });
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

  async function submit() {
    if (saving || !selected) return;
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
    if (!isSplitCollection && needsReference && !reference.trim()) {
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
      if (isSplitCollection) {
        const splitRows = [
          { method: "cash", methodId: "cash", amount: splitCollectionValues.cash },
          {
            method: "bank_transfer",
            methodId: "bank_transfer",
            amount: splitCollectionValues.bank_transfer,
            reference: splitCollectionValues.bankReference,
          },
          {
            method: "mobile_money",
            methodId: "mobile_money",
            amount: splitCollectionValues.mobile_money,
            reference: splitCollectionValues.walletReference,
          },
        ].filter((line) => line.amount > 0);
        if (splitRows.length < 2) {
          setSaving(false);
          return toast.error(
            lang === "ar"
              ? "أدخل مبلغًا في طريقتين على الأقل، واستخدم طريقة واحدة للدفع المفرد"
              : "Enter amounts for at least two tenders; use single payment for one tender",
          );
        }
        const res = await (supabase.rpc as any)("record_customer_payment_splits", {
          _customer_id: selected.id,
          _invoice_id: invoiceId || null,
          _amount: amt,
          _payment_date: date,
          _note: paymentNote || null,
          _splits: splitRows,
        });
        error = res.error;
      } else {
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
        method: isSplitCollection
          ? lang === "ar"
            ? "دفع بأكثر من طريقة"
            : "Split payment"
          : resolvedMethodLabel,
        cashboxName: settlement.cashboxName,
        bankAccountName: settlement.bankAccountName,
        notes: paymentNote || undefined,
        remainingBalance: Math.max(Number(selected.balance) - amt, 0),
      });
      setPaymentFormOpen(false);
      setAmount("");
      setReference("");
      setNote("");
      setIsSplitCollection(false);
      setSplitCollectionValues({ cash: 0, credit: 0, bank_transfer: 0, mobile_money: 0 });
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

  function beginPayment(invoice?: Invoice) {
    setInvoiceId(invoice?.id ?? "");
    setAmount(invoice ? String(Number(invoice.total) - Number(invoice.paid)) : "");
    setIsSplitCollection(false);
    setSplitCollectionValues({ cash: 0, credit: 0, bank_transfer: 0, mobile_money: 0 });
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

      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[300px_minmax(0,1fr)] xl:grid-cols-[330px_minmax(0,1fr)]">
        {/* دليل العملاء */}
        <aside className="panel-elevated overflow-hidden border-primary/15 bg-primary/[0.025] p-0 shadow-md shadow-primary/[0.06] lg:sticky lg:top-4">
          <div className="border-b border-primary/10 bg-primary/[0.045] p-4">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="grid h-9 w-9 place-items-center rounded-xl bg-primary text-primary-foreground shadow-sm shadow-primary/25">
                  <Users className="h-4 w-4" />
                </div>
                <div>
                  <div className="text-sm font-black">
                    {lang === "ar" ? "دليل العملاء" : "Customer directory"}
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    {lang === "ar"
                      ? "اختر عميلاً لبدء التحصيل"
                      : "Pick a customer to start collecting"}
                  </div>
                </div>
              </div>
              <span className="rounded-full border border-primary/15 bg-card px-2 py-1 font-mono text-[10px] font-bold text-primary tabular-nums">
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
          <div className="max-h-[calc(100vh-250px)] space-y-1.5 overflow-y-auto bg-primary/[0.015] p-3 pe-2 max-lg:max-h-[45vh]">
            {filteredCustomers.length === 0 ? (
              <div className="grid place-items-center gap-2 py-8 text-center">
                <Search className="h-6 w-6 text-muted-foreground/50" />
                <div className="text-sm text-muted-foreground">
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
                    className={`group flex min-h-[70px] w-full items-center gap-3 rounded-2xl border p-3 text-start transition-all duration-200 ${active ? "border-primary/35 bg-primary/[0.1] shadow-md shadow-primary/[0.1]" : "border-primary/[0.06] bg-card/80 hover:border-primary/20 hover:bg-primary/[0.045]"}`}
                  >
                    <div
                      className={`grid h-10 w-10 shrink-0 place-items-center rounded-2xl text-sm font-black transition-transform group-hover:scale-105 ${active ? "bg-primary text-primary-foreground shadow-sm shadow-primary/30" : "bg-surface-2 text-muted-foreground"}`}
                    >
                      {c.name.trim().slice(0, 1).toUpperCase() || <User className="h-4 w-4" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-bold">{c.name}</div>
                      <div className="text-[11px] text-muted-foreground">{c.phone ?? "—"}</div>
                    </div>
                    <span
                      className={`shrink-0 rounded-xl px-2 py-1.5 text-end ${hasBalance ? "bg-amber-500/10 text-amber-600 dark:text-amber-400" : "bg-muted/60 text-muted-foreground"}`}
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
                      <span className="block font-mono text-xs font-bold tabular-nums">
                        {money(Number(c.balance))}
                      </span>
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </aside>

        {/* Detail */}
        {!selected ? (
          <section className="panel-elevated relative min-h-[520px] overflow-hidden border-primary/15 bg-card p-6 sm:p-8">
            <div className="absolute inset-x-0 top-0 h-1.5 bg-primary" />
            <div className="mx-auto flex max-w-xl flex-col items-center pt-8 text-center sm:pt-14">
              <div className="grid h-20 w-20 place-items-center rounded-3xl bg-primary/10 text-primary shadow-lg shadow-primary/10">
                <Wallet className="h-9 w-9" />
              </div>
              <div className="mt-5 text-xl font-black tracking-tight text-foreground">
                {lang === "ar" ? "مركز تحصيل دفعات العملاء" : "Customer payment centre"}
              </div>
              <div className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">
                {lang === "ar"
                  ? "اختر عميلاً من الدليل، ثم راجع مستحقاته وسجّل الدفعة من مساحة عمل واحدة واضحة."
                  : "Choose a customer, review their outstanding amounts, then record the payment from one clear workspace."}
              </div>
            </div>
            <div className="mx-auto mt-10 grid max-w-3xl gap-3 sm:grid-cols-3">
              {[
                {
                  icon: <Users className="h-5 w-5" />,
                  title: lang === "ar" ? "1. اختر العميل" : "1. Pick customer",
                  text: lang === "ar" ? "ابحث بالاسم أو الهاتف" : "Search by name or phone",
                },
                {
                  icon: <ReceiptText className="h-5 w-5" />,
                  title: lang === "ar" ? "2. راجع الفواتير" : "2. Review invoices",
                  text:
                    lang === "ar"
                      ? "حدّد فاتورة أو وزّع تلقائياً"
                      : "Select an invoice or allocate automatically",
                },
                {
                  icon: <CircleDollarSign className="h-5 w-5" />,
                  title: lang === "ar" ? "3. رحّل الدفعة" : "3. Post payment",
                  text:
                    lang === "ar" ? "اختر الطريقة وأصدر السند" : "Choose method and issue receipt",
                },
              ].map((step) => (
                <div
                  key={step.title}
                  className="rounded-2xl border border-border/70 bg-surface-2/40 p-4 text-start"
                >
                  <div className="mb-4 grid h-9 w-9 place-items-center rounded-xl bg-primary/10 text-primary">
                    {step.icon}
                  </div>
                  <div className="text-sm font-bold">{step.title}</div>
                  <div className="mt-1 text-xs leading-5 text-muted-foreground">{step.text}</div>
                </div>
              ))}
            </div>
          </section>
        ) : (
          <main className="space-y-5">
            {/* شريط السياق المالي */}
            <section className="relative grid overflow-hidden rounded-[var(--radius-panel)] bg-primary grid-cols-1 items-center gap-4 p-5 text-primary-foreground shadow-lg shadow-primary/20 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_auto_auto]">
              <div className="pointer-events-none absolute -end-16 -top-20 h-52 w-52 rounded-full border-[28px] border-white/10" />
              <div className="pointer-events-none absolute -bottom-24 start-[35%] h-40 w-40 rounded-full bg-white/[0.06]" />
              <div className="relative flex items-center gap-3">
                <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl border border-white/15 bg-white/15 text-white shadow-sm backdrop-blur">
                  <User className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <div className="text-xs text-white/70">
                    {lang === "ar" ? "العميل" : "Customer"}
                  </div>
                  <div className="truncate text-xl font-black tracking-tight">{selected.name}</div>
                  <div className="text-xs text-white/75">{selected.phone ?? "—"}</div>
                </div>
              </div>
              <div className="relative rounded-2xl border border-white/15 bg-white/10 px-5 py-3 text-end shadow-sm backdrop-blur">
                <div className="text-[10px] uppercase text-white/70">
                  {lang === "ar" ? "إجمالي المستحق الآن" : "Total due now"}
                </div>
                <div className="font-mono text-2xl font-black tabular-nums text-white">
                  {money(Number(selected.balance))}
                </div>
              </div>
              <div className="relative flex items-center gap-2">
                {Number(selected.balance) > 0 && (
                  <WhatsAppButton
                    phone={selected.phone}
                    label={lang === "ar" ? "تذكير واتساب" : "WhatsApp reminder"}
                    message={debtReminderMessage({
                      name: selected.name,
                      balance: money(Number(selected.balance)),
                      lang,
                    })}
                    className="flex h-10 flex-1 items-center justify-center gap-1.5 rounded-xl border border-white/15 bg-white/15 px-4 text-xs font-medium text-white transition hover:bg-white/25 disabled:cursor-not-allowed disabled:opacity-40 lg:flex-none"
                  />
                )}
                <button
                  type="button"
                  onClick={() => goStatement(selected.id)}
                  className="flex h-10 flex-1 items-center justify-center gap-1.5 rounded-xl border border-white/15 bg-white/10 px-4 text-xs font-medium text-white/90 transition-colors hover:bg-white/20 hover:text-white lg:flex-none"
                >
                  <FileText className="h-3.5 w-3.5" />
                  {lang === "ar" ? "كشف الحساب" : "Statement"}
                </button>
              </div>
            </section>

            <div>
              {/* منطقة تسجيل الدفعة */}
              {paymentFormOpen && (
                <VortexDrawerDialog
                  open={paymentFormOpen}
                  onOpenChange={(open) => {
                    setPaymentFormOpen(open);
                    if (!open) {
                      setInvoiceId("");
                      setAmount("");
                    }
                  }}
                  size="lg"
                  eyebrow={lang === "ar" ? "سند قبض جديد" : "New receipt"}
                  title={
                    selectedInvoice
                      ? lang === "ar"
                        ? "تحصيل فاتورة"
                        : "Invoice collection"
                      : lang === "ar"
                        ? "تحصيل تلقائي"
                        : "Automatic collection"
                  }
                  subtitle={
                    selectedInvoice
                      ? lang === "ar"
                        ? `سداد الفاتورة #${selectedInvoice.invoice_number}`
                        : `Payment for invoice #${selectedInvoice.invoice_number}`
                      : lang === "ar"
                        ? "توزيع الدفعة من الأقدم إلى الأحدث"
                        : "Allocate payment from oldest to newest"
                  }
                  icon={<Wallet className="h-5 w-5" />}
                  className="border-primary/30 shadow-primary/20"
                  bodyClassName="bg-primary/[0.025]"
                >
                  <div className="mb-4 flex items-center justify-between gap-3 rounded-2xl border border-primary/15 bg-primary/[0.06] p-3 text-xs">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-primary/15 bg-card text-primary shadow-sm">
                        <ReceiptText className="h-4 w-4" />
                      </div>
                      <div className="min-w-0">
                        <span className="block truncate font-bold text-foreground">
                          {selectedInvoice
                            ? `#${selectedInvoice.invoice_number}`
                            : lang === "ar"
                              ? "توزيع تلقائي"
                              : "Automatic allocation"}
                        </span>
                        <span className="block text-[11px] text-muted-foreground">
                          {selectedInvoice
                            ? `${lang === "ar" ? "المتبقي" : "Remaining"}: ${money(remaining)}`
                            : lang === "ar"
                              ? "تُوزع على أقدم الفواتير المستحقة"
                              : "Applied to oldest outstanding invoices"}
                        </span>
                      </div>
                    </div>
                    <span className="shrink-0 rounded-full bg-primary/10 px-2.5 py-1 text-[10px] font-bold text-primary">
                      {lang === "ar" ? "سند جديد" : "New receipt"}
                    </span>
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div>
                      <div className="mb-1.5 flex items-center justify-between gap-2">
                        <label className="text-xs font-bold text-foreground">
                          {lang === "ar" ? "المبلغ المحصل" : "Collected amount"}
                        </label>
                        {selectedInvoice && (
                          <button
                            type="button"
                            onClick={() => {
                              setAmount(String(remaining));
                              setIsSplitCollection(false);
                            }}
                            className="text-[11px] font-bold text-primary hover:underline"
                          >
                            {lang === "ar" ? "سداد كامل" : "Full payment"}
                          </button>
                        )}
                      </div>
                      {/* المبلغ المُوحّد: فاصلة آلاف + تفقيط تحت الرقم. */}
                      <AmountInput
                        min={0}
                        value={toNumberOrNull(amount)}
                        onValueChange={(v) => {
                          setAmount(v == null ? "" : String(v));
                          setIsSplitCollection(false);
                        }}
                        placeholder="0.00"
                        aria-label={lang === "ar" ? "المبلغ المحصل" : "Collected amount"}
                        wordsClassName="text-xs"
                        containerClassName="[&_input]:h-11 [&_input]:rounded-xl [&_input]:border-primary/20 [&_input]:text-base [&_input]:font-black"
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
                      <label className="text-xs font-semibold text-muted-foreground">
                        {lang === "ar"
                          ? "طريقة الدفع والتوجيه المالي"
                          : "Payment method & settlement"}
                      </label>
                      <DynamicPaymentSelector
                        context="customer_collection"
                        value={method}
                        onChange={(methodId) => {
                          setMethod(methodId);
                          setReference("");
                          setIsSplitCollection(false);
                        }}
                        settlement={settlement}
                        onSettlementChange={(next) => {
                          setSettlement(next);
                          if (next.reference) setReference(next.reference);
                        }}
                        includeCredit={false}
                      />
                      <button
                        type="button"
                        onClick={() => setSplitCollectionOpen(true)}
                        disabled={!Number(amount) || saving}
                        className="mt-2 inline-flex min-h-9 items-center gap-2 rounded-xl border border-primary/25 bg-primary/[0.04] px-3 text-xs font-semibold text-primary hover:bg-primary/10 disabled:opacity-40"
                      >
                        <Layers className="size-4" />
                        {lang === "ar" ? "تجزئة التحصيل" : "Split collection"}
                      </button>
                      {isSplitCollection && (
                        <p className="mt-1 text-[11px] font-medium text-primary">
                          {lang === "ar" ? "تم اختيار توزيع التحصيل على عدة طرق" : "Multiple collection tenders selected"}
                        </p>
                      )}
                    </div>
                    <Field label={lang === "ar" ? "تاريخ السند" : "Receipt date"}>
                      <div className="relative">
                        <CalendarDays className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                        <input
                          type="date"
                          value={date}
                          onChange={(e) => setDate(e.target.value)}
                          className="h-11 w-full rounded-xl border border-primary/20 bg-card ps-10 pe-3 text-sm focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20"
                        />
                      </div>
                    </Field>
                    <Field label={lang === "ar" ? "ملاحظات" : "Notes"}>
                      <input
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        className="h-11 w-full rounded-xl border border-primary/20 bg-card px-3 text-sm focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20"
                      />
                    </Field>
                  </div>
                  <div className="mt-5 flex items-center justify-between gap-3 border-t border-primary/10 pt-4">
                    <span className="hidden text-xs text-muted-foreground sm:block">
                      {lang === "ar"
                        ? "تحقق من المبلغ وطريقة الدفع قبل الترحيل"
                        : "Review amount and method before posting"}
                    </span>
                    <button
                      onClick={submit}
                      disabled={saving}
                      className="flex h-11 w-full items-center justify-center gap-1.5 rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground shadow-sm shadow-primary/20 hover:opacity-90 disabled:opacity-60 sm:w-auto"
                    >
                      {saving ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Plus className="h-4 w-4" />
                      )}
                      {lang === "ar" ? "تسجيل وترحيل الدفعة" : "Record and post payment"}
                    </button>
                  </div>
                </VortexDrawerDialog>
              )}

              {/* الفواتير المستحقة */}
              <section className="panel-elevated overflow-hidden border-primary/15 bg-primary/[0.02] p-0 shadow-sm shadow-primary/[0.04]">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-primary/15 bg-primary/[0.07] px-5 py-4">
                  <h3 className="flex items-center gap-2 text-sm font-bold">
                    {lang === "ar" ? "الفواتير المستحقة" : "Outstanding invoices"}
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground tabular-nums">
                      {outstanding.length}
                    </span>
                  </h3>
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-muted-foreground">
                      {lang === "ar"
                        ? "حدّد فاتورة لفتح التحصيل"
                        : "Select an invoice to start collection"}
                    </span>
                    {Number(selected.balance) > 0 && !paymentFormOpen && (
                      <button
                        type="button"
                        onClick={() => beginPayment()}
                        className="rounded-xl border border-primary/20 bg-primary/10 px-3 py-1.5 text-[11px] font-bold text-primary transition hover:bg-primary hover:text-primary-foreground"
                      >
                        {lang === "ar" ? "تحصيل تلقائي" : "Automatic collection"}
                      </button>
                    )}
                  </div>
                </div>
                {outstanding.length === 0 ? (
                  <div className="grid place-items-center gap-2 py-6 text-center">
                    <CheckCircle2 className="h-6 w-6 text-emerald-600 dark:text-emerald-400" />
                    <div className="text-sm text-muted-foreground">
                      {lang === "ar"
                        ? "لا توجد فواتير مستحقة لهذا العميل"
                        : "No outstanding invoices for this customer"}
                    </div>
                  </div>
                ) : (
                  <div className="overflow-x-auto p-2">
                    <table className="w-full text-sm">
                      <thead className="text-xs uppercase text-muted-foreground">
                        <tr className="border-b border-primary/10 bg-primary/[0.05]">
                          <th className="rounded-t-xl px-3 py-2 text-start font-medium">#</th>
                          <th className="px-3 py-2 text-start font-medium">
                            {lang === "ar" ? "التاريخ" : "Date"}
                          </th>
                          <th className="px-3 py-2 text-end font-medium">
                            {lang === "ar" ? "الإجمالي" : "Total"}
                          </th>
                          <th className="px-3 py-2 text-end font-medium">
                            {lang === "ar" ? "المدفوع" : "Paid"}
                          </th>
                          <th className="px-3 py-2 text-end font-medium">
                            {lang === "ar" ? "المتبقي" : "Remaining"}
                          </th>
                          <th className="rounded-t-xl px-3 py-2"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {outstanding.map((i) => {
                          const rem = Number(i.total) - Number(i.paid);
                          const isSelected = invoiceId === i.id;
                          return (
                            <tr
                              key={i.id}
                              className={`border-b border-primary/[0.08] transition-colors ${isSelected ? "bg-primary/[0.12] shadow-sm" : "bg-card/45 hover:bg-primary/[0.05]"}`}
                            >
                              <td className="px-3 py-2 font-mono text-xs">{i.invoice_number}</td>
                              <td className="px-3 py-2 text-muted-foreground">
                                {new Date(i.created_at).toLocaleDateString()}
                              </td>
                              <td className="px-3 py-2 text-end font-mono tabular-nums text-muted-foreground">
                                {money(Number(i.total))}
                              </td>
                              <td className="px-3 py-2 text-end font-mono tabular-nums text-emerald-600 dark:text-emerald-400">
                                {money(Number(i.paid))}
                              </td>
                              <td className="px-3 py-2 text-end font-mono font-bold tabular-nums text-amber-600 dark:text-amber-400">
                                {money(rem)}
                              </td>
                              <td className="px-3 py-2 text-end">
                                <button
                                  onClick={() => beginPayment(i)}
                                  className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs transition ${isSelected ? "border-primary/40 bg-primary/15 font-medium text-primary" : "border-primary/30 bg-primary/10 text-primary hover:bg-primary/20"}`}
                                >
                                  {isSelected && <CheckCircle2 className="h-3.5 w-3.5" />}
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
            <section className="panel-elevated overflow-hidden border-primary/15 bg-primary/[0.02] p-0 shadow-sm shadow-primary/[0.04]">
              <div className="border-b border-primary/15 bg-primary/[0.07] px-5 py-4">
                <h3 className="text-sm font-bold">
                  {lang === "ar" ? "آخر التحصيلات" : "Recent collections"}
                </h3>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  {lang === "ar" ? "اضغط على أي صف لعرض السند" : "Tap any row to open the receipt"}
                </p>
              </div>
              {payments.length === 0 ? (
                <div className="py-6 text-center text-sm text-muted-foreground">
                  {lang === "ar"
                    ? "لم تُسجل تحصيلات لهذا العميل بعد"
                    : "No collections recorded for this customer yet"}
                </div>
              ) : (
                <div className="overflow-x-auto p-2">
                  <table className="w-full text-sm">
                    <thead className="text-xs uppercase text-muted-foreground">
                      <tr className="border-b border-border">
                        <th className="px-3 py-2 text-start font-medium">
                          {lang === "ar" ? "التاريخ" : "Date"}
                        </th>
                        <th className="px-3 py-2 text-start font-medium">
                          {lang === "ar" ? "الفاتورة" : "Invoice"}
                        </th>
                        <th className="px-3 py-2 text-start font-medium">
                          {lang === "ar" ? "الطريقة" : "Method"}
                        </th>
                        <th className="px-3 py-2 text-start font-medium">
                          {lang === "ar" ? "ملاحظة" : "Note"}
                        </th>
                        <th className="px-3 py-2 text-end font-medium">
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
                            className="min-h-[56px] cursor-pointer border-b border-border/50 transition-all hover:bg-surface-2/60 hover:shadow-sm hover:outline hover:outline-1 hover:outline-border/60"
                          >
                            <td className="px-3 py-2">
                              <VortexDateBadge date={p.payment_date} size="sm" />
                            </td>
                            <td className="px-3 py-2 font-mono text-xs">
                              <span className="rounded-full bg-muted/70 px-2 py-0.5 text-muted-foreground">
                                {p.sales_invoices?.invoice_number ??
                                  (lang === "ar" ? "على الحساب" : "On account")}
                              </span>
                            </td>
                            <td className="px-3 py-2">
                              <span className="rounded-full border border-border/60 bg-surface-2 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                                {displayMethod}
                              </span>
                            </td>
                            <td className="px-3 py-2 max-w-[220px] truncate text-xs text-muted-foreground/80">
                              {p.note ?? "—"}
                            </td>
                            <td className="px-3 py-2 text-end font-mono font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
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
      <SplitPaymentDialog
        open={splitCollectionOpen}
        onOpenChange={setSplitCollectionOpen}
        total={Number(amount) || 0}
        initialValues={splitCollectionValues}
        methods={["cash", "bank_transfer", "mobile_money"]}
        isCreditAllowed={false}
        onConfirm={(values) => {
          setSplitCollectionValues(values);
          setAmount(
            String(
              Math.round(
                (values.cash + values.bank_transfer + values.mobile_money) * 100,
              ) / 100,
            ),
          );
          setIsSplitCollection(true);
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

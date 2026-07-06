import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Search, Plus, Wallet, X, Loader2, User } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { useI18n } from "@/lib/i18n";
import { money } from "@/lib/format";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/payments")({
  head: () => ({ meta: [{ title: "Customer Payments — Vortex ERP" }] }),
  component: PaymentsPage,
});

interface Customer { id: string; name: string; phone: string | null; balance: number }
interface Invoice { id: string; invoice_number: string; total: number; paid: number; created_at: string; status: string }
interface Payment { id: string; amount: number; payment_date: string; payment_method: string; note: string | null; invoice_id: string | null; sales_invoices?: { invoice_number: string } | null }

function PaymentsPage() {
  const { t, lang } = useI18n();
  const [customerSearch, setCustomerSearch] = useState("");
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [selected, setSelected] = useState<Customer | null>(null);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [invoiceId, setInvoiceId] = useState<string>("");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<"cash" | "card" | "bank_transfer">("cash");
  const [note, setNote] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("customers").select("id,name,phone,balance").eq("is_active", true).order("name").limit(200);
      setCustomers((data ?? []) as Customer[]);
    })();
  }, []);

  const filteredCustomers = useMemo(() => {
    const q = customerSearch.trim().toLowerCase();
    if (!q) return customers.slice(0, 50);
    return customers.filter(c => c.name.toLowerCase().includes(q) || (c.phone ?? "").includes(q)).slice(0, 50);
  }, [customers, customerSearch]);

  async function loadCustomer(c: Customer) {
    setSelected(c);
    setInvoiceId("");
    setAmount("");
    setNote("");
    const [inv, pay] = await Promise.all([
      supabase.from("sales_invoices").select("id,invoice_number,total,paid,created_at,status").eq("customer_id", c.id).order("created_at", { ascending: false }),
      (supabase.from as any)("customer_payments").select("id,amount,payment_date,payment_method,note,invoice_id,sales_invoices(invoice_number)").eq("customer_id", c.id).order("payment_date", { ascending: false }).limit(50),
    ]);
    setInvoices((inv.data ?? []) as Invoice[]);
    setPayments((pay.data ?? []) as Payment[]);
  }

  async function refresh() {
    if (!selected) return;
    const { data: c } = await supabase.from("customers").select("id,name,phone,balance").eq("id", selected.id).maybeSingle();
    if (c) {
      setSelected(c as Customer);
      setCustomers(prev => prev.map(x => x.id === c.id ? (c as Customer) : x));
    }
    await loadCustomer(selected);
  }

  const outstanding = invoices.filter(i => Number(i.total) - Number(i.paid) > 0.001);
  const selectedInvoice = outstanding.find(i => i.id === invoiceId);
  const remaining = selectedInvoice ? Number(selectedInvoice.total) - Number(selectedInvoice.paid) : 0;

  async function submit() {
    if (!selected) return;
    const amt = Number(amount);
    if (!amt || amt <= 0) return toast.error(lang === "ar" ? "أدخل مبلغ صحيح" : "Enter a valid amount");
    if (selectedInvoice && amt > remaining + 0.01) return toast.error(lang === "ar" ? "المبلغ يتجاوز المتبقي" : "Amount exceeds remaining");
    setSaving(true);
    try {
      const { error } = await supabase.rpc("record_customer_payment" as any, {
        _customer_id: selected.id,
        _invoice_id: invoiceId || null,
        _amount: amt,
        _method: method,
        _payment_date: date,
        _note: note || null,
      });
      if (error) throw error;
      toast.success(lang === "ar" ? "تم تسجيل الدفعة" : "Payment recorded");
      await refresh();
    } catch (e: any) {
      toast.error(e.message ?? "Failed");
    } finally { setSaving(false); }
  }

  const pmLabel = (m: string) => m === "cash" ? (lang === "ar" ? "نقدي" : "Cash") : m === "card" ? (lang === "ar" ? "بطاقة" : "Card") : m === "bank_transfer" ? (lang === "ar" ? "تحويل بنكي" : "Bank") : m;

  return (
    <>
      <PageHeader
        title={lang === "ar" ? "تحصيل دفعات العملاء" : "Customer Payments"}
        subtitle={lang === "ar" ? "اختر عميلاً وسجّل دفعة على الفواتير المستحقة" : "Pick a customer and record payments against outstanding invoices"}
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[320px_1fr]">
        {/* Customer list */}
        <div className="panel-elevated p-3">
          <div className="mb-3 flex h-10 items-center gap-2 rounded-full border border-input bg-surface px-4 text-sm">
            <Search className="h-4 w-4 text-muted-foreground" />
            <input value={customerSearch} onChange={e => setCustomerSearch(e.target.value)}
              placeholder={lang === "ar" ? "ابحث عن عميل..." : "Search customer…"}
              className="flex-1 bg-transparent outline-none placeholder:text-muted-foreground" />
          </div>
          <div className="max-h-[70vh] space-y-1 overflow-y-auto pr-1">
            {filteredCustomers.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">{lang === "ar" ? "لا نتائج" : "No results"}</div>
            ) : filteredCustomers.map(c => {
              const active = selected?.id === c.id;
              return (
                <button key={c.id} onClick={() => loadCustomer(c)} className={`flex w-full items-center gap-2.5 rounded-lg border p-2.5 text-start transition ${active ? "border-primary/40 bg-primary/5" : "border-transparent hover:bg-surface-2"}`}>
                  <div className="grid h-8 w-8 place-items-center rounded-full bg-surface-2 text-muted-foreground"><User className="h-4 w-4" /></div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{c.name}</div>
                    <div className="text-[11px] text-muted-foreground">{c.phone ?? "—"}</div>
                  </div>
                  <div className={`shrink-0 font-mono text-xs ${Number(c.balance) > 0 ? "text-amber-500" : "text-muted-foreground"}`}>{money(Number(c.balance))}</div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Detail */}
        {!selected ? (
          <div className="panel-elevated grid place-items-center p-10 text-center text-muted-foreground">
            <div>
              <Wallet className="mx-auto mb-2 h-10 w-10 opacity-40" />
              <div>{lang === "ar" ? "اختر عميلاً لعرض فواتيره المستحقة" : "Pick a customer to see outstanding invoices"}</div>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Summary */}
            <div className="panel-elevated flex flex-wrap items-center justify-between gap-3 p-4">
              <div>
                <div className="text-xs uppercase text-muted-foreground">{lang === "ar" ? "العميل" : "Customer"}</div>
                <div className="text-lg font-semibold">{selected.name}</div>
                <div className="text-xs text-muted-foreground">{selected.phone ?? "—"}</div>
              </div>
              <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-2 text-end">
                <div className="text-[10px] uppercase text-amber-500">{lang === "ar" ? "الرصيد الحالي" : "Current balance"}</div>
                <div className="font-mono text-lg font-semibold text-amber-500">{money(Number(selected.balance))}</div>
              </div>
            </div>

            {/* Record payment */}
            <div className="panel-elevated p-4">
              <h3 className="mb-3 text-sm font-semibold">{lang === "ar" ? "تسجيل دفعة" : "Record payment"}</h3>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <Field label={lang === "ar" ? "الفاتورة (اختياري)" : "Invoice (optional)"}>
                  <select value={invoiceId} onChange={e => {
                    setInvoiceId(e.target.value);
                    const inv = outstanding.find(i => i.id === e.target.value);
                    if (inv) setAmount(String(Number(inv.total) - Number(inv.paid)));
                  }} className="h-9 w-full rounded-md border border-input bg-surface px-2 text-sm">
                    <option value="">{lang === "ar" ? "دفعة عامة على الحساب" : "General on account"}</option>
                    {outstanding.map(i => (
                      <option key={i.id} value={i.id}>{i.invoice_number} — {money(Number(i.total) - Number(i.paid))}</option>
                    ))}
                  </select>
                </Field>
                <Field label={lang === "ar" ? "المبلغ" : "Amount"}>
                  <input type="number" step="0.01" value={amount} onChange={e => setAmount(e.target.value)}
                    className="h-9 w-full rounded-md border border-input bg-surface px-3 text-sm font-mono" />
                </Field>
                <Field label={lang === "ar" ? "طريقة الدفع" : "Method"}>
                  <select value={method} onChange={e => setMethod(e.target.value as any)} className="h-9 w-full rounded-md border border-input bg-surface px-2 text-sm">
                    <option value="cash">{lang === "ar" ? "نقدي" : "Cash"}</option>
                    <option value="card">{lang === "ar" ? "بطاقة" : "Card"}</option>
                    <option value="bank_transfer">{lang === "ar" ? "تحويل بنكي" : "Bank"}</option>
                  </select>
                </Field>
                <Field label={lang === "ar" ? "التاريخ" : "Date"}>
                  <input type="date" value={date} onChange={e => setDate(e.target.value)}
                    className="h-9 w-full rounded-md border border-input bg-surface px-3 text-sm" />
                </Field>
                <div className="sm:col-span-2">
                  <Field label={lang === "ar" ? "ملاحظة" : "Note"}>
                    <input value={note} onChange={e => setNote(e.target.value)}
                      className="h-9 w-full rounded-md border border-input bg-surface px-3 text-sm" />
                  </Field>
                </div>
              </div>
              <div className="mt-4 flex justify-end">
                <button onClick={submit} disabled={saving}
                  className="flex h-10 items-center gap-1.5 rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground shadow-sm shadow-primary/20 hover:opacity-90 disabled:opacity-60">
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                  {lang === "ar" ? "حفظ الدفعة" : "Save payment"}
                </button>
              </div>
            </div>

            {/* Outstanding invoices */}
            <div className="panel-elevated p-4">
              <h3 className="mb-3 text-sm font-semibold">{lang === "ar" ? "الفواتير المستحقة" : "Outstanding invoices"} <span className="text-muted-foreground">({outstanding.length})</span></h3>
              {outstanding.length === 0 ? (
                <div className="py-6 text-center text-sm text-muted-foreground">{lang === "ar" ? "لا فواتير مستحقة" : "No outstanding invoices"}</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-xs uppercase text-muted-foreground">
                      <tr className="border-b border-border">
                        <th className="px-3 py-2 text-start font-medium">#</th>
                        <th className="px-3 py-2 text-start font-medium">{lang === "ar" ? "التاريخ" : "Date"}</th>
                        <th className="px-3 py-2 text-end font-medium">{lang === "ar" ? "الإجمالي" : "Total"}</th>
                        <th className="px-3 py-2 text-end font-medium">{lang === "ar" ? "المدفوع" : "Paid"}</th>
                        <th className="px-3 py-2 text-end font-medium">{lang === "ar" ? "المتبقي" : "Remaining"}</th>
                        <th className="px-3 py-2"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {outstanding.map(i => {
                        const rem = Number(i.total) - Number(i.paid);
                        return (
                          <tr key={i.id} className="border-b border-border/50 hover:bg-surface-2/40">
                            <td className="px-3 py-2 font-mono text-xs">{i.invoice_number}</td>
                            <td className="px-3 py-2 text-muted-foreground">{new Date(i.created_at).toLocaleDateString()}</td>
                            <td className="px-3 py-2 text-end font-mono">{money(Number(i.total))}</td>
                            <td className="px-3 py-2 text-end font-mono text-emerald-500">{money(Number(i.paid))}</td>
                            <td className="px-3 py-2 text-end font-mono font-semibold text-amber-500">{money(rem)}</td>
                            <td className="px-3 py-2 text-end">
                              <button onClick={() => { setInvoiceId(i.id); setAmount(String(rem)); }}
                                className="rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs text-primary hover:bg-primary/20">
                                {lang === "ar" ? "تحديد" : "Select"}
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Payment history */}
            <div className="panel-elevated p-4">
              <h3 className="mb-3 text-sm font-semibold">{lang === "ar" ? "سجل التحصيلات" : "Payment history"}</h3>
              {payments.length === 0 ? (
                <div className="py-6 text-center text-sm text-muted-foreground">{lang === "ar" ? "لا يوجد تحصيلات" : "No payments"}</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-xs uppercase text-muted-foreground">
                      <tr className="border-b border-border">
                        <th className="px-3 py-2 text-start font-medium">{lang === "ar" ? "التاريخ" : "Date"}</th>
                        <th className="px-3 py-2 text-start font-medium">{lang === "ar" ? "الفاتورة" : "Invoice"}</th>
                        <th className="px-3 py-2 text-start font-medium">{lang === "ar" ? "الطريقة" : "Method"}</th>
                        <th className="px-3 py-2 text-start font-medium">{lang === "ar" ? "ملاحظة" : "Note"}</th>
                        <th className="px-3 py-2 text-end font-medium">{lang === "ar" ? "المبلغ" : "Amount"}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {payments.map(p => (
                        <tr key={p.id} className="border-b border-border/50">
                          <td className="px-3 py-2 text-muted-foreground">{p.payment_date}</td>
                          <td className="px-3 py-2 font-mono text-xs">{p.sales_invoices?.invoice_number ?? (lang === "ar" ? "على الحساب" : "On account")}</td>
                          <td className="px-3 py-2 text-muted-foreground">{pmLabel(p.payment_method)}</td>
                          <td className="px-3 py-2 max-w-[220px] truncate text-muted-foreground">{p.note ?? "—"}</td>
                          <td className="px-3 py-2 text-end font-mono font-semibold text-emerald-500">{money(Number(p.amount))}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
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

import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Search, Users, X, AlertCircle, Printer } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { useI18n } from "@/lib/i18n";
import { money } from "@/lib/format";

export const Route = createFileRoute("/_app/debts")({
  head: () => ({ meta: [{ title: "Customer Debts — Vortex ERP" }] }),
  component: DebtsPage,
});

interface Customer { id: string; name: string; phone: string | null; email: string | null; balance: number; credit_limit: number }
interface Invoice { id: string; invoice_number: string; total: number; paid: number; created_at: string; status: string }
interface Payment { id: string; amount: number; payment_date: string; payment_method: string; note: string | null; invoice_id: string | null; sales_invoices?: { invoice_number: string } | null }

function DebtsPage() {
  const { t, lang } = useI18n();
  const [rows, setRows] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "debt" | "over_limit">("debt");
  const [selected, setSelected] = useState<Customer | null>(null);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);

  async function load() {
    setLoading(true);
    const { data } = await supabase.from("customers").select("id,name,phone,email,balance,credit_limit").eq("is_active", true).order("balance", { ascending: false });
    setRows((data ?? []) as Customer[]);
    setLoading(false);
  }
  useEffect(() => { void load(); }, []);

  async function openDetail(c: Customer) {
    setSelected(c);
    const [inv, pay] = await Promise.all([
      supabase.from("sales_invoices").select("id,invoice_number,total,paid,created_at,status").eq("customer_id", c.id).order("created_at", { ascending: false }),
      (supabase.from as any)("customer_payments").select("id,amount,payment_date,payment_method,note,invoice_id,sales_invoices(invoice_number)").eq("customer_id", c.id).order("payment_date", { ascending: false }),
    ]);
    setInvoices((inv.data ?? []) as Invoice[]);
    setPayments((pay.data ?? []) as Payment[]);
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter(r => {
      if (filter === "debt" && Number(r.balance) <= 0) return false;
      if (filter === "over_limit" && (Number(r.credit_limit) <= 0 || Number(r.balance) <= Number(r.credit_limit))) return false;
      if (!q) return true;
      return r.name.toLowerCase().includes(q) || (r.phone ?? "").includes(q) || (r.email ?? "").toLowerCase().includes(q);
    });
  }, [rows, search, filter]);

  const totals = useMemo(() => {
    const totalDebt = rows.reduce((s, r) => s + Math.max(Number(r.balance), 0), 0);
    const debtors = rows.filter(r => Number(r.balance) > 0).length;
    const overLimit = rows.filter(r => Number(r.credit_limit) > 0 && Number(r.balance) > Number(r.credit_limit)).length;
    return { totalDebt, debtors, overLimit };
  }, [rows]);

  const pmLabel = (m: string) => m === "cash" ? t("pos.pm.cash") : m === "card" ? t("pos.pm.card") : m === "bank_transfer" ? t("pos.pm.bank") : m;

  function printStatement() {
    if (!selected) return;
    const rtl = lang === "ar";
    const esc = (value: string | number | null | undefined) => String(value ?? "—").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
    const date = (value: string) => new Date(value).toLocaleDateString(rtl ? "ar-SA" : "en-GB");
    const invoiceRows = invoices.map(i => `<tr><td>${esc(date(i.created_at))}</td><td dir="ltr">${esc(i.invoice_number)}</td><td>${esc(money(Number(i.total)))}</td><td>${esc(money(Number(i.paid)))}</td><td class="balance">${esc(money(Number(i.total) - Number(i.paid)))}</td></tr>`).join("");
    const paymentRows = payments.map(p => `<tr><td>${esc(date(p.payment_date))}</td><td dir="ltr">${esc(p.sales_invoices?.invoice_number ?? (rtl ? "دفعة على الحساب" : "On account"))}</td><td>${esc(pmLabel(p.payment_method))}</td><td class="paid">${esc(money(Number(p.amount)))}</td></tr>`).join("");
    const popup = window.open("", "_blank", "noopener,noreferrer");
    if (!popup) return;
    popup.document.write(`<!doctype html><html lang="${rtl ? "ar" : "en"}" dir="${rtl ? "rtl" : "ltr"}"><head><meta charset="utf-8"><title>${rtl ? "كشف حساب" : "Account statement"} — ${esc(selected.name)}</title><style>
      @page { size: A4; margin: 14mm; } * { box-sizing: border-box; } body { font-family: Tahoma, Arial, sans-serif; color:#172033; font-size:12px; } .top { display:flex; justify-content:space-between; gap:24px; border-bottom:3px solid #2563eb; padding-bottom:14px; } h1 { margin:0 0 5px; font-size:24px; } .muted { color:#667085; } .summary { display:grid; grid-template-columns:repeat(3,1fr); gap:10px; margin:20px 0; } .card { border:1px solid #dbe3ef; border-radius:10px; padding:11px; background:#f8fafc; } .card b { display:block; font-size:17px; margin-top:4px; } h2 { font-size:14px; margin:22px 0 8px; } table { width:100%; border-collapse:collapse; } th { background:#1e293b; color:white; font-weight:600; } th,td { padding:8px; border:1px solid #dbe3ef; text-align:${rtl ? "right" : "left"}; } tr:nth-child(even) { background:#f8fafc; } .balance { color:#b45309; font-weight:700; } .paid { color:#047857; font-weight:700; } .foot { margin-top:24px; padding-top:10px; border-top:1px solid #dbe3ef; color:#667085; font-size:10px; } @media print { .no-print { display:none; } }
    </style></head><body><div class="top"><div><h1>${rtl ? "كشف حساب عميل" : "Customer account statement"}</h1><div class="muted">${rtl ? "تاريخ الإصدار" : "Issued"}: ${esc(new Date().toLocaleDateString(rtl ? "ar-SA" : "en-GB"))}</div></div><div><b>${esc(selected.name)}</b><div class="muted">${esc(selected.phone)} ${selected.email ? `· ${esc(selected.email)}` : ""}</div></div></div><div class="summary"><div class="card"><span class="muted">${rtl ? "الرصيد المستحق" : "Outstanding balance"}</span><b>${esc(money(Number(selected.balance)))}</b></div><div class="card"><span class="muted">${rtl ? "الحد الائتماني" : "Credit limit"}</span><b>${esc(money(Number(selected.credit_limit)))}</b></div><div class="card"><span class="muted">${rtl ? "إجمالي الفواتير" : "Invoices"}</span><b>${esc(invoices.length)}</b></div></div><h2>${rtl ? "الفواتير" : "Invoices"}</h2><table><thead><tr><th>${rtl ? "التاريخ" : "Date"}</th><th>${rtl ? "رقم الفاتورة" : "Invoice"}</th><th>${rtl ? "الإجمالي" : "Total"}</th><th>${rtl ? "المدفوع" : "Paid"}</th><th>${rtl ? "المتبقي" : "Balance"}</th></tr></thead><tbody>${invoiceRows || `<tr><td colspan="5">${rtl ? "لا توجد فواتير" : "No invoices"}</td></tr>`}</tbody></table><h2>${rtl ? "الدفعات والتحصيلات" : "Payments and collections"}</h2><table><thead><tr><th>${rtl ? "التاريخ" : "Date"}</th><th>${rtl ? "الفاتورة" : "Invoice"}</th><th>${rtl ? "طريقة الدفع" : "Method"}</th><th>${rtl ? "المبلغ" : "Amount"}</th></tr></thead><tbody>${paymentRows || `<tr><td colspan="4">${rtl ? "لا توجد دفعات" : "No payments"}</td></tr>`}</tbody></table><div class="foot">${rtl ? "هذا الكشف مُنشأ من النظام ويمكن حفظه كملف PDF من نافذة الطباعة." : "This statement was generated by the system and can be saved as PDF from the print dialog."}</div><script>window.onload=()=>setTimeout(()=>window.print(),200)<\/script></body></html>`);
    popup.document.close();
  }

  return (
    <>
      <PageHeader
        title={t("debts.title")}
        subtitle={t("debts.subtitle")}
        actions={
          <Link to="/payments" className="flex h-10 items-center gap-1.5 rounded-full bg-primary px-4 text-xs font-semibold text-primary-foreground shadow-sm shadow-primary/20 hover:opacity-90">
            {t("debts.record_payment")}
          </Link>
        }
      />

      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <SumCard label={t("debts.total_debt")} value={money(totals.totalDebt)} tone="warn" />
        <SumCard label={t("debts.debtors")} value={String(totals.debtors)} tone="info" />
        <SumCard label={t("debts.over_limit")} value={String(totals.overLimit)} tone="neg" />
      </div>

      <div className="panel-elevated p-4">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <div className="flex h-10 flex-1 min-w-[220px] items-center gap-2 rounded-full border border-input bg-surface px-4 text-sm">
            <Search className="h-4 w-4 text-muted-foreground" />
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder={t("debts.search_customer")}
              className="flex-1 bg-transparent outline-none placeholder:text-muted-foreground" />
          </div>
          <div className="flex rounded-full border border-input bg-surface p-1 text-xs">
            {(["debt", "over_limit", "all"] as const).map(f => (
              <button key={f} onClick={() => setFilter(f)}
                className={`rounded-full px-3 py-1.5 transition ${filter === f ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>
                {f === "debt" ? t("debts.filter.debtors") : f === "over_limit" ? t("debts.filter.over_limit") : t("debts.filter.all")}
              </button>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs uppercase text-muted-foreground">
              <tr className="border-b border-border">
                <th className="px-3 py-2 text-start font-medium">{t("common.customer")}</th>
                <th className="px-3 py-2 text-start font-medium">{t("common.phone")}</th>
                <th className="px-3 py-2 text-end font-medium">{t("customers.credit_limit")}</th>
                <th className="px-3 py-2 text-end font-medium">{t("common.balance")}</th>
                <th className="px-3 py-2 text-start font-medium">{t("common.status")}</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {loading ? <tr><td colSpan={6} className="py-10 text-center text-muted-foreground">{t("common.loading")}</td></tr>
              : filtered.length === 0 ? (
                <tr><td colSpan={6} className="py-12 text-center text-muted-foreground">
                  <Users className="mx-auto mb-2 h-8 w-8 opacity-50" />{lang === "ar" ? "لا نتائج" : "No results"}
                </td></tr>
              ) : filtered.map(r => {
                const bal = Number(r.balance);
                const lim = Number(r.credit_limit);
                const over = lim > 0 && bal > lim;
                return (
                  <tr key={r.id} className="border-b border-border/50 hover:bg-surface-2/40 cursor-pointer" onClick={() => openDetail(r)}>
                    <td className="px-3 py-2.5 font-medium">{r.name}</td>
                    <td className="px-3 py-2.5 text-muted-foreground">{r.phone ?? "—"}</td>
                    <td className="px-3 py-2.5 text-end font-mono text-muted-foreground">{money(lim)}</td>
                    <td className={`px-3 py-2.5 text-end font-mono font-semibold ${bal > 0 ? (over ? "text-rose-500" : "text-amber-500") : "text-muted-foreground"}`}>{money(bal)}</td>
                    <td className="px-3 py-2.5">
                      {over ? <span className="inline-flex items-center gap-1 rounded-full border border-rose-500/30 bg-rose-500/10 px-2 py-0.5 text-[10px] text-rose-500"><AlertCircle className="h-3 w-3" />{t("debts.filter.over_limit")}</span>
                       : bal > 0 ? <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] text-amber-500">{t("debts.debtor")}</span>
                       : <span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-[10px] text-emerald-500">{t("debts.clear")}</span>}
                    </td>
                    <td className="px-3 py-2.5 text-end">
                      <button className="rounded-full border border-border bg-surface px-3 py-1 text-xs text-muted-foreground hover:bg-surface-2">{t("debts.view")}</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {selected && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-background/80 backdrop-blur-sm p-4">
          <div className="panel-elevated flex max-h-[90vh] w-full max-w-3xl flex-col p-6">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <div className="text-xs uppercase text-muted-foreground">{t("debts.customer_record")}</div>
                <h3 className="text-lg font-semibold">{selected.name}</h3>
                <div className="text-xs text-muted-foreground">{selected.phone ?? "—"} · {selected.email ?? "—"}</div>
              </div>
              <div className="text-end">
                <div className="text-[10px] uppercase text-muted-foreground">{t("debts.balance")}</div>
                <div className="font-mono text-xl font-semibold text-amber-500">{money(Number(selected.balance))}</div>
              </div>
              <button onClick={() => setSelected(null)} className="rounded p-1 hover:bg-surface-2"><X className="h-4 w-4" /></button>
            </div>

            <div className="flex-1 space-y-4 overflow-y-auto">
              <div>
                <h4 className="mb-2 text-sm font-semibold">{t("debts.invoices")}</h4>
                {invoices.length === 0 ? (
                  <div className="rounded border border-border py-6 text-center text-sm text-muted-foreground">{t("debts.no_invoices")}</div>
                ) : (
                  <table className="w-full text-sm">
                    <thead className="text-xs text-muted-foreground"><tr className="border-b border-border">
                      <th className="py-1.5 text-start">#</th><th className="py-1.5 text-start">{lang === "ar" ? "التاريخ" : "Date"}</th>
                      <th className="py-1.5 text-end">{lang === "ar" ? "الإجمالي" : "Total"}</th>
                      <th className="py-1.5 text-end">{lang === "ar" ? "المدفوع" : "Paid"}</th>
                      <th className="py-1.5 text-end">{t("debts.remaining")}</th>
                    </tr></thead>
                    <tbody>
                      {invoices.map(i => {
                        const rem = Number(i.total) - Number(i.paid);
                        return (
                          <tr key={i.id} className="border-b border-border/40">
                            <td className="py-1.5 font-mono text-xs">{i.invoice_number}</td>
                            <td className="py-1.5 text-muted-foreground">{new Date(i.created_at).toLocaleDateString()}</td>
                            <td className="py-1.5 text-end font-mono">{money(Number(i.total))}</td>
                            <td className="py-1.5 text-end font-mono text-emerald-500">{money(Number(i.paid))}</td>
                            <td className={`py-1.5 text-end font-mono ${rem > 0 ? "text-amber-500 font-semibold" : "text-muted-foreground"}`}>{money(rem)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>

              <div>
                <h4 className="mb-2 text-sm font-semibold">{t("debts.collections")}</h4>
                {payments.length === 0 ? (
                  <div className="rounded border border-border py-6 text-center text-sm text-muted-foreground">{t("debts.no_collections")}</div>
                ) : (
                  <table className="w-full text-sm">
                    <thead className="text-xs text-muted-foreground"><tr className="border-b border-border">
                      <th className="py-1.5 text-start">{lang === "ar" ? "التاريخ" : "Date"}</th>
                      <th className="py-1.5 text-start">{lang === "ar" ? "الفاتورة" : "Invoice"}</th>
                      <th className="py-1.5 text-start">{lang === "ar" ? "الطريقة" : "Method"}</th>
                      <th className="py-1.5 text-end">{lang === "ar" ? "المبلغ" : "Amount"}</th>
                    </tr></thead>
                    <tbody>
                      {payments.map(p => (
                        <tr key={p.id} className="border-b border-border/40">
                          <td className="py-1.5 text-muted-foreground">{p.payment_date}</td>
                          <td className="py-1.5 font-mono text-xs">{p.sales_invoices?.invoice_number ?? t("debts.on_account")}</td>
                          <td className="py-1.5 text-muted-foreground">{pmLabel(p.payment_method)}</td>
                          <td className="py-1.5 text-end font-mono font-semibold text-emerald-500">{money(Number(p.amount))}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setSelected(null)} className="h-9 rounded-md border border-border px-4 text-sm hover:bg-surface-2">{t("common.close")}</button>
              <button onClick={printStatement} className="flex h-9 items-center gap-1.5 rounded-md border border-border px-4 text-sm hover:bg-surface-2"><Printer className="h-4 w-4" />{lang === "ar" ? "كشف حساب / PDF" : "Statement / PDF"}</button>
              <Link to="/payments" className="flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90">{lang === "ar" ? "تحصيل دفعة" : "Record payment"}</Link>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function SumCard({ label, value, tone }: { label: string; value: string; tone: "warn" | "neg" | "info" }) {
  const color = tone === "warn" ? "text-amber-500 border-amber-500/20 bg-amber-500/5" : tone === "neg" ? "text-rose-500 border-rose-500/20 bg-rose-500/5" : "text-primary border-primary/20 bg-primary/5";
  return (
    <div className={`rounded-xl border p-4 ${color}`}>
      <div className="text-[10px] uppercase">{label}</div>
      <div className="mt-1 font-mono text-2xl font-semibold">{value}</div>
    </div>
  );
}

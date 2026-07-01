import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { Receipt, Search, Eye, X, FileDown, Printer, Sparkles, ScrollText } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { useI18n } from "@/lib/i18n";
import { money } from "@/lib/format";
import { generateInvoicePDF, type InvoiceDoc } from "@/lib/pdf";
import { printInvoice, type InvoiceTemplate } from "@/lib/invoice-print";

export const Route = createFileRoute("/_app/sales")({
  head: () => ({ meta: [{ title: "Sales — Vortex ERP" }] }),
  component: SalesPage,
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
  customers: { name: string } | null;
  warehouses: { name: string } | null;
}
interface Line {
  id: string; quantity: number; unit_price: number; tax: number; total: number;
  products: { name: string; sku: string | null } | null;
}

function SalesPage() {
  const { t, lang } = useI18n();
  const [rows, setRows] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Invoice | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [printOpen, setPrintOpen] = useState(false);

  async function buildDoc(): Promise<InvoiceDoc | null> {
    if (!selected) return null;
    const { data: cs } = await supabase.from("company_settings").select("*").limit(1).maybeSingle();
    return {
      title: t("sales.invoice_doc"),
      number: selected.invoice_number,
      date: new Date(selected.created_at).toLocaleString(),
      partyLabel: t("sales.bill_to"),
      partyName: selected.customers?.name ?? t("pos.walkin"),
      warehouse: selected.warehouses?.name ?? undefined,
      payment: pmLabel(selected.payment_method),
      status: statusLabel(selected.status),
      lines: lines.map(l => ({ product: l.products?.name ?? "—", qty: Number(l.quantity), price: Number(l.unit_price), total: Number(l.total) })),
      subtotal: Number(selected.subtotal), tax: Number(selected.tax), discount: Number(selected.discount),
      total: Number(selected.total), paid: Number(selected.paid),
      company: cs ? { name: (cs as any).company_name, address: (cs as any).address, phone: (cs as any).phone, vat: (cs as any).vat_number } : undefined,
      currency: (cs as any)?.currency ?? "",
    };
  }

  async function doPrint(template: InvoiceTemplate) {
    const doc = await buildDoc();
    if (!doc) return;
    printInvoice(doc, template, {
      invoice: t("sales.invoice"), date: t("common.date"), billTo: t("sales.bill_to"),
      warehouse: t("common.warehouse"), payment: t("sales.payment"), status: t("common.status"),
      product: t("common.product"), qty: t("common.qty"), price: t("common.price"), total: t("common.total"),
      subtotal: t("common.subtotal"), tax: t("common.tax"), discount: t("common.discount"),
      grandTotal: t("common.total"), paid: t("common.paid"), balance: t("common.balance"),
      thanks: t("print.thanks"), poweredBy: t("print.powered"),
    }, lang === "ar");
    setPrintOpen(false);
  }

  async function doPDF() {
    const doc = await buildDoc();
    if (doc) generateInvoicePDF(doc);
  }

  async function load() {
    setLoading(true);
    const { data } = await supabase
      .from("sales_invoices")
      .select("id,invoice_number,status,subtotal,discount,tax,total,paid,payment_method,created_at,customers(name),warehouses(name)")
      .order("created_at", { ascending: false })
      .limit(200);
    setRows((data ?? []) as any);
    setLoading(false);
  }
  useEffect(() => { void load(); }, []);

  async function openInvoice(inv: Invoice) {
    setSelected(inv);
    const { data } = await supabase
      .from("sales_invoice_items")
      .select("id,quantity,unit_price,tax,total,products(name,sku)")
      .eq("invoice_id", inv.id);
    setLines((data ?? []) as any);
  }

  const filtered = rows.filter(r =>
    !search ||
    r.invoice_number.toLowerCase().includes(search.toLowerCase()) ||
    (r.customers?.name ?? "").toLowerCase().includes(search.toLowerCase())
  );

  const pmLabel = (m: string) => {
    const map: Record<string, string> = {
      cash: t("pos.pm.cash"), card: t("pos.pm.card"),
      bank_transfer: t("pos.pm.bank"), bank: t("pos.pm.bank"), credit: t("pos.pm.credit"),
    };
    return map[m] ?? m;
  };
  const statusLabel = (s: string) => {
    const map: Record<string, string> = {
      paid: t("sales.status.paid"), partial: t("sales.status.partial"),
      unpaid: t("sales.status.unpaid"), cancelled: t("sales.status.cancelled"),
    };
    return map[s] ?? s;
  };
  const statusColor = (s: string) =>
    s === "paid" ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" :
    s === "partial" ? "bg-amber-500/10 text-amber-400 border-amber-500/20" :
    s === "cancelled" ? "bg-red-500/10 text-red-400 border-red-500/20" :
    "bg-muted text-muted-foreground border-border";

  return (
    <>
      <PageHeader title={t("sales.title")} subtitle={t("sales.subtitle")} />
      <div className="panel-elevated p-4">
        <div className="relative mb-4">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground rtl:left-auto rtl:right-3" />
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder={t("sales.search")}
            className="h-10 w-full rounded-md border border-input bg-surface pl-9 pr-3 text-sm rtl:pl-3 rtl:pr-9 focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20"
          />
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs uppercase tracking-wide text-muted-foreground">
              <tr className="border-b border-border">
                <th className="px-3 py-2 text-start font-medium">{t("sales.invoice")}</th>
                <th className="px-3 py-2 text-start font-medium">{t("common.date")}</th>
                <th className="px-3 py-2 text-start font-medium">{t("common.customer")}</th>
                <th className="px-3 py-2 text-start font-medium">{t("common.warehouse")}</th>
                <th className="px-3 py-2 text-start font-medium">{t("sales.payment")}</th>
                <th className="px-3 py-2 text-start font-medium">{t("common.status")}</th>
                <th className="px-3 py-2 text-end font-medium">{t("common.total")}</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} className="py-10 text-center text-muted-foreground">{t("common.loading")}</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={8} className="py-12 text-center text-muted-foreground">
                  <Receipt className="mx-auto mb-2 h-8 w-8 opacity-50" />
                  {t("sales.no_sales")}
                </td></tr>
              ) : filtered.map(r => (
                <tr key={r.id} className="border-b border-border/50 hover:bg-surface-2/50">
                  <td className="px-3 py-2.5 font-mono text-xs">{r.invoice_number}</td>
                  <td className="px-3 py-2.5 text-muted-foreground">{new Date(r.created_at).toLocaleString()}</td>
                  <td className="px-3 py-2.5">{r.customers?.name ?? t("pos.walkin")}</td>
                  <td className="px-3 py-2.5 text-muted-foreground">{r.warehouses?.name ?? "—"}</td>
                  <td className="px-3 py-2.5 text-muted-foreground">{pmLabel(r.payment_method)}</td>
                  <td className="px-3 py-2.5">
                    <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] ${statusColor(r.status)}`}>{statusLabel(r.status)}</span>
                  </td>
                  <td className="px-3 py-2.5 text-end font-semibold">{money(Number(r.total))}</td>
                  <td className="px-3 py-2.5 text-end">
                    <button onClick={() => openInvoice(r)} className="rounded p-1.5 text-muted-foreground hover:bg-surface-2 hover:text-foreground">
                      <Eye className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {selected && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-background/80 backdrop-blur-sm p-4">
          <div className="panel-elevated w-full max-w-2xl p-6">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h3 className="font-mono text-lg font-semibold">{selected.invoice_number}</h3>
                <p className="text-xs text-muted-foreground">{new Date(selected.created_at).toLocaleString()}</p>
              </div>
              <button onClick={() => setSelected(null)} className="rounded p-1 hover:bg-surface-2"><X className="h-4 w-4" /></button>
            </div>
            <div className="mb-4 grid grid-cols-2 gap-3 text-sm">
              <Field label={t("common.customer")} value={selected.customers?.name ?? t("pos.walkin")} />
              <Field label={t("common.warehouse")} value={selected.warehouses?.name ?? "—"} />
              <Field label={t("sales.payment")} value={pmLabel(selected.payment_method)} />
              <Field label={t("common.status")} value={statusLabel(selected.status)} />
            </div>
            <div className="overflow-hidden rounded-md border border-border">
              <table className="w-full text-sm">
                <thead className="bg-surface text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-start">{t("common.product")}</th>
                    <th className="px-3 py-2 text-end">{t("common.qty")}</th>
                    <th className="px-3 py-2 text-end">{t("common.price")}</th>
                    <th className="px-3 py-2 text-end">{t("common.total")}</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map(l => (
                    <tr key={l.id} className="border-t border-border">
                      <td className="px-3 py-2">{l.products?.name ?? "—"}</td>
                      <td className="px-3 py-2 text-end">{l.quantity}</td>
                      <td className="px-3 py-2 text-end">{money(Number(l.unit_price))}</td>
                      <td className="px-3 py-2 text-end font-medium">{money(Number(l.total))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-4 space-y-1 text-sm">
              <Row label={t("common.subtotal")} value={money(Number(selected.subtotal))} />
              <Row label={t("common.tax")} value={money(Number(selected.tax))} />
              <Row label={t("common.discount")} value={money(Number(selected.discount))} />
              <Row label={t("common.total")} value={money(Number(selected.total))} bold />
              <Row label={t("common.paid")} value={money(Number(selected.paid))} />
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={doPDF} className="flex items-center gap-1.5 h-9 rounded-md border border-border px-4 text-sm hover:bg-surface-2">
                <FileDown className="h-4 w-4" /> {t("print.download_pdf")}
              </button>
              <button onClick={() => setPrintOpen(true)} className="flex items-center gap-1.5 h-9 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90">
                <Printer className="h-4 w-4" /> {t("common.print")}
              </button>
              <button onClick={() => setSelected(null)} className="h-9 rounded-md border border-border px-4 text-sm hover:bg-surface-2">{t("common.close")}</button>
            </div>
          </div>
        </div>
      )}

      {printOpen && selected && (
        <div className="fixed inset-0 z-[60] grid place-items-center bg-background/80 backdrop-blur-sm p-4" onClick={() => setPrintOpen(false)}>
          <div className="panel-elevated w-full max-w-2xl p-6" onClick={e => e.stopPropagation()}>
            <div className="mb-5 flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold">{t("print.title")}</h3>
                <p className="text-xs text-muted-foreground">{t("print.subtitle")}</p>
              </div>
              <button onClick={() => setPrintOpen(false)} className="rounded p-1 hover:bg-surface-2"><X className="h-4 w-4" /></button>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <TemplateCard
                icon={<ScrollText className="h-6 w-6" />}
                title={t("print.thermal")}
                desc={t("print.thermal_desc")}
                accent="from-amber-500/20 to-orange-500/10 border-amber-500/30"
                onClick={() => doPrint("thermal")}
              />
              <TemplateCard
                icon={<Printer className="h-6 w-6" />}
                title={t("print.standard")}
                desc={t("print.standard_desc")}
                accent="from-blue-500/20 to-indigo-500/10 border-blue-500/30"
                onClick={() => doPrint("standard")}
              />
              <TemplateCard
                icon={<Sparkles className="h-6 w-6" />}
                title={t("print.elegant")}
                desc={t("print.elegant_desc")}
                accent="from-yellow-500/20 via-amber-500/10 to-rose-500/10 border-yellow-500/40"
                onClick={() => doPrint("elegant")}
              />
            </div>
            <div className="mt-5 flex justify-end">
              <button onClick={doPDF} className="flex items-center gap-1.5 h-9 rounded-md border border-border px-4 text-sm hover:bg-surface-2">
                <FileDown className="h-4 w-4" /> {t("print.download_pdf")}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p>{value}</p>
    </div>
  );
}
function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className={`flex items-center justify-between ${bold ? "text-base font-semibold" : "text-muted-foreground"}`}>
      <span>{label}</span>
      <span className={bold ? "text-foreground" : ""}>{value}</span>
    </div>
  );
}

function TemplateCard({ icon, title, desc, accent, onClick }: { icon: React.ReactNode; title: string; desc: string; accent: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`group relative overflow-hidden rounded-lg border bg-gradient-to-br p-4 text-start transition hover:scale-[1.02] hover:shadow-lg ${accent}`}
    >
      <div className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-md bg-background/60 backdrop-blur">
        {icon}
      </div>
      <div className="font-semibold">{title}</div>
      <div className="mt-1 text-xs text-muted-foreground">{desc}</div>
    </button>
  );
}

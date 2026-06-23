import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Receipt, Search, Eye, X, FileDown } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { useI18n } from "@/lib/i18n";
import { money } from "@/lib/format";
import { generateInvoicePDF } from "@/lib/pdf";

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
  const { t } = useI18n();
  const [rows, setRows] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Invoice | null>(null);
  const [lines, setLines] = useState<Line[]>([]);

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

  const statusColor = (s: string) =>
    s === "paid" ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" :
    s === "partial" ? "bg-amber-500/10 text-amber-400 border-amber-500/20" :
    s === "cancelled" ? "bg-red-500/10 text-red-400 border-red-500/20" :
    "bg-muted text-muted-foreground border-border";

  return (
    <>
      <PageHeader title={t("sales.title")} subtitle="All sales invoices from POS and direct sales." />
      <div className="panel-elevated p-4">
        <div className="relative mb-4">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground rtl:left-auto rtl:right-3" />
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search invoice # or customer..."
            className="h-10 w-full rounded-md border border-input bg-surface pl-9 pr-3 text-sm rtl:pl-3 rtl:pr-9 focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20"
          />
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs uppercase tracking-wide text-muted-foreground">
              <tr className="border-b border-border">
                <th className="px-3 py-2 text-start font-medium">Invoice</th>
                <th className="px-3 py-2 text-start font-medium">Date</th>
                <th className="px-3 py-2 text-start font-medium">Customer</th>
                <th className="px-3 py-2 text-start font-medium">Warehouse</th>
                <th className="px-3 py-2 text-start font-medium">Payment</th>
                <th className="px-3 py-2 text-start font-medium">Status</th>
                <th className="px-3 py-2 text-end font-medium">Total</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} className="py-10 text-center text-muted-foreground">Loading…</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={8} className="py-12 text-center text-muted-foreground">
                  <Receipt className="mx-auto mb-2 h-8 w-8 opacity-50" />
                  No sales yet
                </td></tr>
              ) : filtered.map(r => (
                <tr key={r.id} className="border-b border-border/50 hover:bg-surface-2/50">
                  <td className="px-3 py-2.5 font-mono text-xs">{r.invoice_number}</td>
                  <td className="px-3 py-2.5 text-muted-foreground">{new Date(r.created_at).toLocaleString()}</td>
                  <td className="px-3 py-2.5">{r.customers?.name ?? "Walk-in"}</td>
                  <td className="px-3 py-2.5 text-muted-foreground">{r.warehouses?.name ?? "—"}</td>
                  <td className="px-3 py-2.5 capitalize text-muted-foreground">{r.payment_method}</td>
                  <td className="px-3 py-2.5">
                    <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] capitalize ${statusColor(r.status)}`}>{r.status}</span>
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
              <Field label="Customer" value={selected.customers?.name ?? "Walk-in"} />
              <Field label="Warehouse" value={selected.warehouses?.name ?? "—"} />
              <Field label="Payment" value={selected.payment_method} />
              <Field label="Status" value={selected.status} />
            </div>
            <div className="overflow-hidden rounded-md border border-border">
              <table className="w-full text-sm">
                <thead className="bg-surface text-xs text-muted-foreground">
                  <tr><th className="px-3 py-2 text-start">Product</th><th className="px-3 py-2 text-end">Qty</th><th className="px-3 py-2 text-end">Price</th><th className="px-3 py-2 text-end">Total</th></tr>
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
              <Row label="Subtotal" value={money(Number(selected.subtotal))} />
              <Row label="Tax" value={money(Number(selected.tax))} />
              <Row label="Discount" value={money(Number(selected.discount))} />
              <Row label="Total" value={money(Number(selected.total))} bold />
              <Row label="Paid" value={money(Number(selected.paid))} />
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={async () => {
                  const { data: cs } = await supabase.from("company_settings").select("*").limit(1).maybeSingle();
                  generateInvoicePDF({
                    title: "Sales Invoice",
                    number: selected.invoice_number,
                    date: new Date(selected.created_at).toLocaleString(),
                    partyLabel: "Bill To",
                    partyName: selected.customers?.name ?? "Walk-in",
                    warehouse: selected.warehouses?.name ?? undefined,
                    payment: selected.payment_method,
                    status: selected.status,
                    lines: lines.map(l => ({ product: l.products?.name ?? "—", qty: Number(l.quantity), price: Number(l.unit_price), total: Number(l.total) })),
                    subtotal: Number(selected.subtotal), tax: Number(selected.tax), discount: Number(selected.discount),
                    total: Number(selected.total), paid: Number(selected.paid),
                    company: cs ? { name: (cs as any).company_name, address: (cs as any).address, phone: (cs as any).phone, vat: (cs as any).vat_number } : undefined,
                    currency: (cs as any)?.currency ?? "",
                  });
                }}
                className="flex items-center gap-1.5 h-9 rounded-md border border-border px-4 text-sm hover:bg-surface-2"
              >
                <FileDown className="h-4 w-4" /> PDF
              </button>
              <button onClick={() => window.print()} className="h-9 rounded-md border border-border px-4 text-sm hover:bg-surface-2">Print</button>
              <button onClick={() => setSelected(null)} className="h-9 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90">Close</button>
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
      <p className="capitalize">{value}</p>
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

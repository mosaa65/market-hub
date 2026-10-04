import { ModuleGuard, useModules } from "@/lib/modules";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { ShoppingCart, Plus, Eye, Boxes, Package } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { useI18n } from "@/lib/i18n";
import { money } from "@/lib/format";
import { toast } from "sonner";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { EmptyState, LoadingState } from "@/components/ui/feedback";
import { StatusBadge, documentStatusTone } from "@/components/ui/status-badge";
import { VortexDrawerDialog } from "@/components/vortex-ui";
import { PurchaseFormSheet } from "@/components/purchases/purchase-form-sheet";

export const Route = createFileRoute("/_app/purchases")({
  head: () => ({ meta: [{ title: "Purchases — Vortex ERP" }] }),
  component: () => (
    <ModuleGuard moduleId="purchases">
      <PurchasesPage />
    </ModuleGuard>
  ),
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
  suppliers: { name: string } | null;
  warehouses: { name: string; name_ar: string | null } | null;
}
interface Line {
  id: string;
  quantity: number;
  unit_cost: number;
  tax: number;
  total: number;
  products: { name: string; sku: string | null } | null;
}

function PurchasesPage() {
  const { isModuleEnabled } = useModules();
  const hasMultiWarehouse = isModuleEnabled("multi_warehouse");
  const { t, lang } = useI18n();
  const whName = (w?: { name: string; name_ar: string | null } | null) =>
    !w ? "—" : lang === "ar" ? w.name_ar || w.name : w.name || w.name_ar || "—";
  const [rows, setRows] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Invoice | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [creating, setCreating] = useState(false);

  async function load() {
    setLoading(true);
    const { data } = await supabase
      .from("purchase_invoices")
      .select(
        "id,invoice_number,status,subtotal,discount,tax,total,paid,payment_method,created_at,suppliers(name),warehouses(name,name_ar)",
      )
      .order("created_at", { ascending: false })
      .limit(200);
    setRows((data ?? []) as any);
    setLoading(false);
  }
  useEffect(() => {
    void load();
  }, []);

  async function openInvoice(inv: Invoice) {
    setSelected(inv);
    const { data } = await supabase
      .from("purchase_invoice_items")
      .select("id,quantity,unit_cost,tax,total,products(name,sku)")
      .eq("invoice_id", inv.id);
    setLines((data ?? []) as any);
  }

  const filtered = rows.filter(
    (r) =>
      !search ||
      r.invoice_number.toLowerCase().includes(search.toLowerCase()) ||
      (r.suppliers?.name ?? "").toLowerCase().includes(search.toLowerCase()),
  );

  const pmLabel = (m: string) => {
    const map: Record<string, string> = {
      cash: t("pos.pm.cash"),
      card: t("pos.pm.card"),
      bank_transfer: t("pos.pm.bank"),
      bank: t("pos.pm.bank"),
      credit: t("pos.pm.credit"),
    };
    return map[m] ?? m;
  };
  const statusLabel = (s: string) => {
    const map: Record<string, string> = {
      paid: t("sales.status.paid"),
      partial: t("sales.status.partial"),
      unpaid: t("sales.status.unpaid"),
      cancelled: t("sales.status.cancelled"),
    };
    return map[s] ?? s;
  };

  const columns: DataTableColumn<Invoice>[] = useMemo(() => {
    const cols: DataTableColumn<Invoice>[] = [
      {
        key: "invoice_number",
        header: t("purchases.po"),
        cell: (r) => <span className="font-mono text-xs">{r.invoice_number}</span>,
        sortable: true,
      },
      {
        key: "created_at",
        header: t("common.date"),
        cell: (r) => (
          <span className="text-xs text-muted-foreground">
            {new Date(r.created_at).toLocaleString()}
          </span>
        ),
        hideBelow: "sm",
        sortable: true,
      },
      {
        key: "supplier",
        header: t("common.supplier"),
        cell: (r) => r.suppliers?.name ?? "—",
      },
    ];

    if (hasMultiWarehouse) {
      cols.push({
        key: "warehouse",
        header: t("common.warehouse"),
        cell: (r) => <span className="text-xs text-muted-foreground">{whName(r.warehouses)}</span>,
        hideBelow: "md",
      });
    }

    cols.push(
      {
        key: "payment_method",
        header: t("sales.payment"),
        cell: (r) => (
          <span className="text-xs text-muted-foreground">{pmLabel(r.payment_method)}</span>
        ),
        hideBelow: "lg",
      },
      {
        key: "status",
        header: t("common.status"),
        cell: (r) => (
          <StatusBadge tone={documentStatusTone(r.status)}>{statusLabel(r.status)}</StatusBadge>
        ),
      },
      {
        key: "total",
        header: t("common.total"),
        align: "end",
        cell: (r) => (
          <span className="font-mono font-semibold text-foreground">{money(Number(r.total))}</span>
        ),
        sortable: true,
        sortValue: (r) => Number(r.total),
      },
      {
        key: "actions",
        header: "",
        align: "end",
        cell: (r) => (
          <button
            type="button"
            onClick={() => void openInvoice(r)}
            aria-label={t("common.view")}
            className="rounded-lg p-1.5 text-muted-foreground transition hover:bg-muted hover:text-foreground"
          >
            <Eye className="size-4" />
          </button>
        ),
      },
    );

    return cols;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- pmLabel/statusLabel/whName are derived from t/lang
  }, [hasMultiWarehouse, t, lang]);

  return (
    <>
      <PageHeader
        title={t("purchases.title")}
        subtitle={t("purchases.subtitle")}
        actions={
          <div className="flex items-center gap-2">
            <Link
              to="/purchase-pos"
              className="flex h-9 items-center gap-1.5 rounded-xl border border-primary/40 bg-primary/10 px-3 text-sm font-medium text-primary transition hover:bg-primary/20"
            >
              <ShoppingCart className="h-4 w-4" />{" "}
              {lang === "ar" ? "نقطة المشتريات السريعة (POP)" : "Fast Purchase POS"}
            </Link>
            <button
              onClick={() => setCreating(true)}
              className="flex h-9 items-center gap-1.5 rounded-xl bg-primary px-3 text-sm font-medium text-primary-foreground transition hover:opacity-90"
            >
              <Plus className="h-4 w-4" /> {t("purchases.new")}
            </button>
          </div>
        }
      />

      <div className="panel-elevated p-4">
        <div className="relative mb-4">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("purchases.search")}
            className="h-10 w-full rounded-full border border-border bg-surface px-4 pe-10 text-sm transition focus:border-primary focus:outline-none focus:ring-4 focus:ring-primary/12"
          />
          <ShoppingCart className="pointer-events-none absolute end-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        </div>

        <DataTable
          columns={columns}
          rows={filtered}
          rowKey={(r) => r.id}
          loading={loading}
          initialLoading={loading}
          minWidth={720}
          toolbar={undefined}
          onRowClick={(r) => void openInvoice(r)}
          empty={{
            icon: <ShoppingCart className="size-5" />,
            title: search
              ? lang === "ar"
                ? "لا توجد فواتير مطابقة"
                : "No matching invoices"
              : t("purchases.no_purchases"),
            description:
              lang === "ar"
                ? "أنشئ أول فاتورة مشتريات عبر زر «مشتريات جديدة» بالأعلى."
                : "Create your first purchase invoice with the button above.",
            action: (
              <button
                onClick={() => setCreating(true)}
                className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-primary px-4 text-xs font-semibold text-primary-foreground transition hover:opacity-90"
              >
                <Plus className="h-4 w-4" /> {t("purchases.new")}
              </button>
            ),
          }}
        />
      </div>

      {selected && (
        <InvoiceDetailsSheet
          invoice={selected}
          lines={lines}
          open
          onOpenChange={(open) => {
            if (!open) setSelected(null);
          }}
          pmLabel={pmLabel}
          statusLabel={statusLabel}
          hasMultiWarehouse={hasMultiWarehouse}
        />
      )}

      <PurchaseFormSheet
        open={creating}
        onOpenChange={setCreating}
        onSaved={() => void load()}
        warehouses={[]}
        hasMultiWarehouse={hasMultiWarehouse}
      />
    </>
  );
}
function InvoiceDetailsSheet({
  invoice,
  lines,
  open,
  onOpenChange,
  pmLabel,
  statusLabel,
  hasMultiWarehouse,
}: {
  invoice: Invoice;
  lines: Line[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pmLabel: (m: string) => string;
  statusLabel: (s: string) => string;
  hasMultiWarehouse?: boolean;
}) {
  const { t, lang } = useI18n();
  const isAr = lang === "ar";
  const wh = invoice.warehouses;
  const whLabel = !wh ? "—" : isAr ? wh.name_ar || wh.name : wh.name || wh.name_ar || "—";

  return (
    <VortexDrawerDialog
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      eyebrow={t("purchases.po")}
      icon={<Package className="h-5 w-5" />}
      title={<span className="font-mono">{invoice.invoice_number}</span>}
      subtitle={new Date(invoice.created_at).toLocaleString()}
      bodyClassName="space-y-5"
      footer={
        <div className="flex w-full items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => window.print()}
            className="h-9 rounded-xl border-border px-4 text-xs font-semibold text-muted-foreground transition hover:bg-muted hover:text-foreground"
          >
            {t("common.print")}
          </button>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="h-9 rounded-xl bg-primary px-4 text-xs font-semibold text-primary-foreground transition hover:opacity-90"
          >
            {t("common.close")}
          </button>
        </div>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("common.supplier")} value={invoice.suppliers?.name ?? "—"} />
        {hasMultiWarehouse && <Field label={t("common.warehouse")} value={whLabel} />}
        <Field label={t("sales.payment")} value={pmLabel(invoice.payment_method)} />
        <div>
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {t("common.status")}
          </p>
          <div className="mt-1">
            <StatusBadge tone={documentStatusTone(invoice.status)}>
              {statusLabel(invoice.status)}
            </StatusBadge>
          </div>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border-border/70">
        {lines.length === 0 ? (
          <EmptyState
            icon={<Boxes className="size-4" />}
            title={isAr ? "لا توجد بنود" : "No line items"}
            description={
              isAr ? "لم تُسجَّل أصناف في هذه الفاتورة." : "No items were recorded on this invoice."
            }
          />
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-surface-2/60 text-[11px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-start">{t("common.product")}</th>
                <th className="px-3 py-2 text-end">{t("common.qty")}</th>
                <th className="px-3 py-2 text-end">{t("common.cost")}</th>
                <th className="px-3 py-2 text-end">{t("common.total")}</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.id} className="border-t border-border/60">
                  <td className="px-3 py-2 text-foreground">{l.products?.name ?? "—"}</td>
                  <td className="px-3 py-2 text-end font-mono text-muted-foreground">
                    {l.quantity}
                  </td>
                  <td className="px-3 py-2 text-end font-mono text-muted-foreground">
                    {money(Number(l.unit_cost))}
                  </td>
                  <td className="px-3 py-2 text-end font-mono font-semibold text-foreground">
                    {money(Number(l.total))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="space-y-1.5 rounded-xl border-border/70 bg-surface-2/40 p-3 text-sm">
        <Row label={t("common.subtotal")} value={money(Number(invoice.subtotal))} />
        <Row label={t("common.tax")} value={money(Number(invoice.tax))} />
        <Row label={t("common.discount")} value={money(Number(invoice.discount))} />
        <Row label={t("common.total")} value={money(Number(invoice.total))} bold />
        <Row label={t("common.paid")} value={money(Number(invoice.paid))} />
      </div>
    </VortexDrawerDialog>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="mt-0.5 text-sm font-medium capitalize text-foreground">{value}</p>
    </div>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div
      className={`flex items-center justify-between ${
        bold
          ? "mt-1.5 border-t border-border/60 pt-2 text-base font-semibold text-foreground"
          : "text-xs text-muted-foreground"
      }`}
    >
      <span>{label}</span>
      <span className={bold ? "font-mono" : "font-mono text-foreground"}>{value}</span>
    </div>
  );
}

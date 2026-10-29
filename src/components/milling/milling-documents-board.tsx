/**
 * لوحة سجلات مستندات خدمة الطحن الموحّدة — مكوّن مشترك بين شاشات الطحن والتسليم.
 *
 * المستند الواحد `milling_service_documents` يمثل العملية الكاملة:
 * استلام + فاتورة (RECEIVED) → طحن (PROCESSED) → تسليم (DELIVERED).
 * الشاشات المختلفة تُظهر نفس السجل من زاويتها:
 *   - شاشة الطحن تركز على: المُطحَن / النواتج / الفاقد (سجل عمليات الطحن).
 *   - شاشة التسليم تركز على: المتبقي في الأمانة / ما سُلّم (سجل التسليم والصرف).
 */
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Search, RotateCcw, Truck, Wrench, Inbox, FileText, ChevronDown } from "lucide-react";
import { fetchMillingDocuments, type MillingServiceDocument } from "@/lib/milling/custody";
import { formatFormalDateTime } from "@/lib/format-preferences";
import { money } from "@/lib/format";
import { cn } from "@/lib/utils";

export type MillingRecordsFocus = "milling" | "delivery";

const STATUS_META: Record<string, { label: string; tone: string; icon: typeof Inbox }> = {
  RECEIVED: {
    label: "مستلم و فوترة",
    tone: "bg-sky-500/15 text-sky-600 border-sky-500/30",
    icon: Inbox,
  },
  PROCESSED: {
    label: "مطحون — بانتظار التسليم",
    tone: "bg-amber-500/15 text-amber-600 border-amber-500/30",
    icon: Wrench,
  },
  DELIVERED: {
    label: "مُسلَّم ومغلق",
    tone: "bg-emerald-500/15 text-emerald-600 border-emerald-500/30",
    icon: Truck,
  },
};

const STATUS_FILTERS = [
  { value: "ALL", label: "الكل" },
  { value: "RECEIVED", label: "مستلمة" },
  { value: "PROCESSED", label: "مطحونة" },
  { value: "DELIVERED", label: "مُسلَّمة" },
] as const;

const BILLING_LABEL: Record<string, string> = {
  PER_BAG: "لكيس مُطحَن",
  PER_KG: "لكيلو مُطحَن",
};

/** صف واحد في السجل. */
function DocumentRow({
  doc,
  focus,
  onOpen,
}: {
  doc: MillingServiceDocument;
  focus: MillingRecordsFocus;
  onOpen?: (doc: MillingServiceDocument) => void;
}) {
  const meta = STATUS_META[doc.status] ?? STATUS_META.RECEIVED;
  const StatusIcon = meta.icon;
  const invoice = doc.sales_invoices;
  const feeInfo =
    doc.billing_basis && doc.fee_per_unit != null
      ? `${BILLING_LABEL[doc.billing_basis] ?? doc.billing_basis} · ${doc.fee_quantity ?? 0} × ${money(doc.fee_per_unit)}`
      : null;

  return (
    <tr
      className={cn(
        "border-b border-border/60 transition hover:bg-muted/50",
        onOpen && "cursor-pointer",
      )}
      onClick={() => onOpen?.(doc)}
    >
      <td className="px-3 py-2.5 whitespace-nowrap font-mono text-xs font-semibold">
        {doc.document_number || "—"}
      </td>
      <td className="px-3 py-2.5">
        <div className="font-semibold text-sm">{doc.customers?.name || "—"}</div>
        <div className="text-xs text-muted-foreground" dir="ltr">
          {doc.customers?.phone || ""}
        </div>
      </td>
      <td className="px-3 py-2.5 whitespace-nowrap text-xs text-muted-foreground">
        {formatFormalDateTime(doc.received_at).full}
      </td>
      {focus === "milling" ? (
        <td className="px-3 py-2.5 whitespace-nowrap">
          <span className="inline-flex items-center gap-1.5 text-xs">
            <Wrench className="size-3.5 text-amber-500" />
            {doc.processed_at ? formatFormalDateTime(doc.processed_at).full : "لم تُطحن بعد"}
          </span>
        </td>
      ) : (
        <td className="px-3 py-2.5 whitespace-nowrap">
          <span className="inline-flex items-center gap-1.5 text-xs">
            <Truck className="size-3.5 text-emerald-500" />
            {doc.delivered_at ? formatFormalDateTime(doc.delivered_at).full : "لم تُسلَّم بعد"}
          </span>
        </td>
      )}
      <td className="px-3 py-2.5 whitespace-nowrap">
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-bold",
            meta.tone,
          )}
        >
          <StatusIcon className="size-3" />
          {meta.label}
        </span>
      </td>
      {focus === "delivery" && (
        <>
          <td className="px-3 py-2.5 whitespace-nowrap text-xs">
            {feeInfo ? (
              <span className="text-muted-foreground">{feeInfo}</span>
            ) : (
              <span className="text-muted-foreground/50">—</span>
            )}
          </td>
          <td className="px-3 py-2.5 text-left whitespace-nowrap">
            {invoice ? (
              <div>
                <div className="font-mono text-xs font-semibold">{invoice.invoice_number}</div>
                <div className="text-xs">
                  {money(invoice.total)}{" "}
                  <span
                    className={cn(
                      "text-[11px]",
                      invoice.payment_status === "PAID" ? "text-emerald-600" : "text-amber-600",
                    )}
                  >
                    ({invoice.payment_status === "PAID" ? "مسدد" : "عليه متبقي"})
                  </span>
                </div>
              </div>
            ) : (
              <span className="text-muted-foreground/50 text-xs">—</span>
            )}
          </td>
        </>
      )}
    </tr>
  );
}

export function MillingDocumentsBoard({
  focus,
  title,
  onOpenDocument,
  defaultCustomerId,
}: {
  /** زاوية العرض: سجل عمليات الطحن أم سجل التسليم والصرف. */
  focus: MillingRecordsFocus;
  title: string;
  onOpenDocument?: (doc: MillingServiceDocument) => void;
  defaultCustomerId?: string;
}) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<string>("ALL");
  const [collapsed, setCollapsed] = useState(false);

  const docs = useQuery({
    queryKey: ["milling", "documents-board", focus],
    queryFn: () =>
      fetchMillingDocuments({
        status: status as any,
        search: search,
        customerId: defaultCustomerId,
      }),
  });

  const rows = docs.data ?? [];
  const counts = useMemo(() => {
    const c = { RECEIVED: 0, PROCESSED: 0, DELIVERED: 0 } as Record<string, number>;
    for (const d of rows) c[d.status] = (c[d.status] ?? 0) + 1;
    return c;
  }, [rows]);

  return (
    <section className="rounded-2xl border border-border/70 bg-card shadow-sm overflow-hidden">
      <header
        className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-border/60 cursor-pointer select-none"
        onClick={() => setCollapsed((v) => !v)}
      >
        <FileText className="size-4 text-amber-500" />
        <h2 className="font-black text-sm">{title}</h2>
        <span className="text-xs text-muted-foreground">
          {rows.length} مستنداً
          {counts.RECEIVED > 0 && ` · ${counts.RECEIVED} مستلمة`}
          {counts.PROCESSED > 0 && ` · ${counts.PROCESSED} مطحونة`}
          {counts.DELIVERED > 0 && ` · ${counts.DELIVERED} مُسلَّمة`}
        </span>
        <div className="ms-auto flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
          <div className="relative">
            <Search className="absolute start-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={
                focus === "milling"
                  ? "بحث برقم العملية / العميل…"
                  : "بحث برقم المستند / العميل / الفاتورة…"
              }
              className="w-56 rounded-xl border border-border bg-background py-1.5 ps-8 pe-3 text-xs focus:outline-none focus:ring-2 focus:ring-amber-500/40"
            />
          </div>
          <div className="flex rounded-xl border border-border overflow-hidden text-xs">
            {STATUS_FILTERS.map((f) => (
              <button
                key={f.value}
                type="button"
                onClick={() => setStatus(f.value)}
                className={cn(
                  "px-3 py-1.5 font-semibold transition",
                  status === f.value ? "bg-amber-500 text-white" : "bg-background hover:bg-muted",
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setCollapsed((v) => !v)}
            className="p-1.5 rounded-lg hover:bg-muted"
          >
            <ChevronDown className={cn("size-4 transition", collapsed && "-rotate-90")} />
          </button>
        </div>
      </header>

      {!collapsed && (
        <div className="overflow-x-auto">
          {docs.isLoading ? (
            <div className="p-6 text-center text-sm text-muted-foreground">جارٍ تحميل السجلات…</div>
          ) : rows.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">
              <RotateCcw className="mx-auto mb-2 size-6 opacity-40" />
              لا توجد مستندات مطابقة.
            </div>
          ) : (
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="bg-muted/60 text-xs text-muted-foreground">
                  <th className="px-3 py-2 text-start font-bold">المستند</th>
                  <th className="px-3 py-2 text-start font-bold">العميل</th>
                  <th className="px-3 py-2 text-start font-bold">الاستلام</th>
                  <th className="px-3 py-2 text-start font-bold">
                    {focus === "milling" ? "الطحن" : "التسليم"}
                  </th>
                  <th className="px-3 py-2 text-start font-bold">الحالة</th>
                  {focus === "delivery" && (
                    <>
                      <th className="px-3 py-2 text-start font-bold">أساس الأجور</th>
                      <th className="px-3 py-2 text-end font-bold">الفاتورة</th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody>
                {rows.map((d) => (
                  <DocumentRow key={d.id} doc={d} focus={focus} onOpen={onOpenDocument} />
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </section>
  );
}

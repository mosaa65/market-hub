/**
 * Market-Hub ERP — Sales invoice, two selling modes on one screen.
 *
 * WHY THIS SCREEN EXISTS SEPARATELY FROM THE POS
 * ----------------------------------------------
 * The POS is a cashier till: it is built around a barcode scanner, a product
 * grid, keyboard shortcuts and a thermal receipt, and every one of those
 * assumptions is about a KNOWN product moving off a shelf. A milling counter is
 * a different act — the customer arrives with grain and negotiates a fee — and
 * trying to serve it from the till means either creating a throwaway "service
 * product" for every ticket (which pollutes the catalogue and destroys margin
 * reporting) or asking the operator to pretend a negotiation is a scan.
 *
 * So the two modes here are deliberately not two skins on one form:
 *
 *   POS mode     sells a known product; the operator supplies only a quantity,
 *                and price, tax and stock effect come from the catalogue.
 *   Ticket mode  sells a negotiated service; the operator supplies the terms —
 *                grain, grade, sacks, fee basis, extraction — and the line is
 *                posted with no product id, which the engine already records as
 *                AD_HOC_SERVICE with stock effect NONE.
 *
 * WHAT A TICKET IS NOT
 * --------------------
 * A ticket here is a SERVICE SALE: the mill earns a grinding fee and transfers
 * no ownership of any stock. A customer who deposits grain and later collects
 * flour is custody, not a sale, and is handled by the milling desk with its own
 * documents. Posting custody through a sale would push customer grain into the
 * mill's revenue — the one outcome the custody design exists to prevent.
 */
import { ModuleGuard } from "@/lib/modules";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  ShoppingBag,
  Wrench,
  Plus,
  Trash2,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Search,
  X,
  Receipt,
  Warehouse as WarehouseIcon,
  User,
  Printer,
  RotateCcw,
  SlidersHorizontal,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { useI18n } from "@/lib/i18n";
import { useModules } from "@/lib/modules";
import { money } from "@/lib/format";
import { toSystemDigits } from "@/lib/format-preferences";
import { toast } from "sonner";
import { printInvoice, type InvoiceTemplate } from "@/lib/invoice-print";
import type { InvoiceDoc } from "@/lib/pdf";
import { OperationSuccessModal } from "@/components/communication";
import { LuxuryPrintPreviewModal } from "@/components/luxury-print-preview-modal";
import {
  createSalesInvoice,
  fetchSellableProducts,
  lineTotal,
  type InvoiceLine,
  type PaymentMethod,
  type SellableProduct,
  type ServiceLineInput,
} from "@/lib/sales-invoice";
import { MILLING_BAG_SIZES } from "@/components/milling/milling-terms-fields";
import { PaymentMethodPicker } from "@/components/ui/payment-method";
import {
  getPaymentMethodDefinition,
  paymentMethodLabel,
  toLegacyPaymentValue,
} from "@/lib/payments/payment-methods";

export const Route = createFileRoute("/_app/sales-invoice")({
  head: () => ({ meta: [{ title: "فاتورة المبيعات — فورتيكس ERP" }] }),
  component: () => (
    <ModuleGuard moduleId="core">
      <SalesInvoicePage />
    </ModuleGuard>
  ),
});

type Mode = "pos" | "ticket";

const MILLING_TYPES = [
  { value: "FLOUR_GRADE_1", ar: "دقيق نمرة 1 (فاخر)", en: "Flour grade 1" },
  { value: "FLOUR_GRADE_2", ar: "دقيق نمرة 2 (بر)", en: "Flour grade 2" },
  { value: "SEMOLINA", ar: "سمولينا", en: "Semolina" },
  { value: "BRAN", ar: "نخالة (ردة)", en: "Bran" },
] as const;

const FEE_BASES = [
  { value: "PER_BAG", ar: "لكل شوال", en: "Per sack" },
  { value: "PER_TON", ar: "لكل طن", en: "Per ton" },
  { value: "LUMP_SUM", ar: "مبلغ مقطوع", en: "Lump sum" },
] as const;

const BAG_SIZES = [50, 40, 25, 10] as const;

/** Free-form ticket terms. Kept as strings so the operator can type freely. */
interface TicketForm {
  customerName: string;
  customerId: string;
  customerPhone: string;
  grainType: string;
  grade: string;
  millingType: string;
  bagCount: string;
  bagSizeKg: string;
  bagSource: "CUSTOMER" | "MILL";
  bagType: string;
  bagCondition: string;
  feeBasis: string;
  feePerBag: string;
  feePerTon: string;
  lumpSum: string;
  expectedExtraction: string;
  allowedLoss: string;
  note: string;
}

const EMPTY_TICKET: TicketForm = {
  customerName: "",
  customerId: "",
  customerPhone: "",
  grainType: "",
  grade: "",
  millingType: "FLOUR_GRADE_1",
  bagCount: "",
  bagSizeKg: "50",
  bagSource: "CUSTOMER",
  bagType: "",
  bagCondition: "سليم",
  feeBasis: "PER_BAG",
  feePerBag: "",
  feePerTon: "",
  lumpSum: "",
  expectedExtraction: "",
  allowedLoss: "",
  note: "",
};
interface Warehouse {
  id: string;
  name: string;
  name_ar: string | null;
}

interface Customer {
  id: string;
  name: string;
  phone?: string | null;
  balance?: number;
  credit_limit?: number;
}

interface PosCartLine {
  product: SellableProduct;
  quantity: string;
  unitPrice: string;
  /** The sale specification chosen for this line, printed under it. */
  spec?: ProductSpec;
}

/**
 * The options a mill product can be sold in.
 *
 * A mill sells the same flour in a 10 kg bag and a 50 kg sack, and grinds to
 * different grades. The alternative to modelling that is creating a separate
 * product for every combination — "دقيق نمرة 1 شوال 50 كجم", "دقيق نمرة 1 كيس
 * 25 كجم" — which is exactly the catalogue pollution that makes margin reports
 * useless, and it means a new product for every future sack size.
 *
 * So the product stays one row and the SPECIFICATION travels with the sale
 * line. It is descriptive: it says what was sold, is printed on the invoice, and
 * does not fork stock or pricing into a phantom product.
 */
export interface ProductSpec {
  grainOrGrade: string;
  millingType: string;
  bagType: string;
  bagSizeKg: string;
}

const SPEC_MILLING_TYPES = [
  { value: "", ar: "بدون طحن (صنف جاهز)", en: "No milling (ready item)" },
  ...MILLING_TYPES.map((m) => ({ value: m.value, ar: m.ar, en: m.en })),
];

const SPEC_BAG_TYPES = [
  { value: "شوال", ar: "شوال", en: "Sack" },
  { value: "كيس", ar: "كيس", en: "Bag" },
  { value: "صندوق", ar: "صندوق", en: "Box" },
  { value: "بالك", ar: "بالك (جرّة)", en: "Bulk" },
];

/** Renders a chosen specification as one readable line for the invoice. */
function specLabel(spec: ProductSpec, isRtl: boolean): string {
  const milling = SPEC_MILLING_TYPES.find((m) => m.value === spec.millingType);
  return [
    spec.grainOrGrade.trim(),
    milling && milling.value ? (isRtl ? milling.ar : milling.en) : "",
    `${spec.bagType} ${spec.bagSizeKg} ${isRtl ? "كجم" : "kg"}`,
  ]
    .filter(Boolean)
    .join(" • ");
}

function SalesInvoicePage() {
  const { lang, t } = useI18n();
  const { isModuleEnabled } = useModules();
  const isRtl = lang === "ar";
  const hasMultiWarehouse = isModuleEnabled("multi_warehouse");

  const [mode, setMode] = useState<Mode>("pos");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [warehouseId, setWarehouseId] = useState("");
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [products, setProducts] = useState<SellableProduct[]>([]);

  //
  // Holds a CATALOGUE id (e.g. 'kuraimi_bank'), because that is what the picker
  // produces. It is converted to the stored ENUM value with toLegacyPaymentValue
  // at the point of submission, so the RPC contract never changes.
  //
  const [paymentMethod, setPaymentMethod] = useState<string>("cash");
  const [paid, setPaid] = useState("");
  const [discount, setDiscount] = useState("");
  const [note, setNote] = useState("");

  // POS mode
  const [cart, setCart] = useState<PosCartLine[]>([]);
  const [search, setSearch] = useState("");

  // Ticket mode
  const [ticket, setTicket] = useState<TicketForm>(EMPTY_TICKET);

  const [lastInvoice, setLastInvoice] = useState<{
    id: string;
    number: string;
    total: number;
    doc: InvoiceDoc;
  } | null>(null);
  const [successModalOpen, setSuccessModalOpen] = useState(false);
  const [luxuryPreviewOpen, setLuxuryPreviewOpen] = useState(false);

  const setT = <K extends keyof TicketForm>(key: K, value: TicketForm[K]) =>
    setTicket((current) => ({ ...current, [key]: value }));

  /* ------------------------------------------------------------ loading */

  async function load() {
    setLoading(true);
    try {
      const [wsRes, csRes] = await Promise.allSettled([
        supabase.from("warehouses").select("id,name,name_ar").eq("is_active", true).order("name"),
        supabase
          .from("customers")
          .select("id,name,phone,balance,credit_limit")
          .eq("is_active", true)
          .order("name"),
      ]);

      const ws = (wsRes.status === "fulfilled" ? wsRes.value.data : null) ?? [];
      const cs = (csRes.status === "fulfilled" ? csRes.value.data : null) ?? [];
      setWarehouses(ws as Warehouse[]);
      setCustomers(cs as Customer[]);
      setWarehouseId((current) =>
        ws.some((w: any) => w.id === current) ? current : ((ws[0] as any)?.id ?? ""),
      );
    } finally {
      setLoading(false);
    }
  }

  async function loadProducts(warehouse: string) {
    if (!warehouse) return;
    try {
      setProducts(await fetchSellableProducts(warehouse));
    } catch (err: any) {
      toast.error(err.message ?? (isRtl ? "تعذّر تحميل الأصناف" : "Failed to load products"));
      setProducts([]);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    void loadProducts(warehouseId);
    // loadProducts reads nothing but `warehouseId` and a module-level client,
    // so re-running it on a render-only change would refetch the catalogue for
    // nothing. It is listed here deliberately rather than silenced.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [warehouseId]);

  /* --------------------------------------------------------------- POS */

  const filteredProducts = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return products;
    return products.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        (p.sku ?? "").toLowerCase().includes(q) ||
        (p.barcode ?? "").toLowerCase().includes(q),
    );
  }, [products, search]);

  function addProduct(product: SellableProduct) {
    setCart((current) => {
      const existing = current.find((l) => l.product.id === product.id && !l.spec);
      if (existing) {
        return current.map((l) =>
          l.product.id === product.id && !l.spec
            ? { ...l, quantity: String(Number(l.quantity || 0) + 1) }
            : l,
        );
      }
      return [
        ...current,
        {
          product,
          quantity: "1",
          unitPrice: String(product.sale_price ?? 0),
        },
      ];
    });
  }

  /**
   * Lines are identified by position, not by product id. Once a product can
   * appear twice with different specifications, removing "the flour line" by id
   * would remove every flour line at once.
   */
  function removeLine(index: number) {
    setCart((current) => current.filter((_, i) => i !== index));
  }

  function updateSpec(index: number, spec: ProductSpec) {
    setCart((current) => current.map((l, i) => (i === index ? { ...l, spec } : l)));
  }

  /* ------------------------------------------------------------ ticket */

  const ticketQty = Math.max(0, Number(ticket.bagCount) || 0);
  const ticketFeePerUnit = (() => {
    switch (ticket.feeBasis) {
      case "PER_TON":
        return Number(ticket.feePerTon) || 0;
      case "LUMP_SUM":
        return Number(ticket.lumpSum) || 0;
      default:
        return Number(ticket.feePerBag) || 0;
    }
  })();

  // The fee the customer reads at the scale, before they leave the truck.
  const ticketFee =
    ticket.feeBasis === "PER_TON"
      ? Math.round(
          ((ticketQty * (Number(ticket.bagSizeKg) || 0)) / 1000) * ticketFeePerUnit * 100,
        ) / 100
      : ticket.feeBasis === "LUMP_SUM"
        ? ticketFeePerUnit
        : Math.round(ticketQty * ticketFeePerUnit * 100) / 100;

  const ticketDetail = useMemo(() => {
    const parts: string[] = [];
    if (ticket.grainType.trim()) parts.push(ticket.grainType.trim());
    if (ticket.grade.trim()) parts.push(`${isRtl ? "درجة" : "grade"}: ${ticket.grade.trim()}`);
    const milling = MILLING_TYPES.find((m) => m.value === ticket.millingType);
    if (milling) parts.push(isRtl ? milling.ar : milling.en);
    if (ticketQty > 0) {
      parts.push(
        `${toSystemDigits(String(ticketQty))} × ${toSystemDigits(ticket.bagSizeKg)} ${isRtl ? "كجم" : "kg"}`,
      );
    }
    parts.push(
      ticket.bagSource === "MILL"
        ? isRtl
          ? "أكياس المطحنة"
          : "mill bags"
        : isRtl
          ? "أكياس العميل"
          : "customer bags",
    );
    if (ticket.bagType.trim()) parts.push(ticket.bagType.trim());
    if (ticket.bagCondition.trim()) parts.push(ticket.bagCondition.trim());
    const basis = FEE_BASES.find((b) => b.value === ticket.feeBasis);
    if (basis) parts.push(isRtl ? basis.ar : basis.en);
    if (ticket.expectedExtraction.trim())
      parts.push(`${isRtl ? "استخلاص" : "extraction"}: ${ticket.expectedExtraction.trim()}%`);
    if (ticket.allowedLoss.trim())
      parts.push(`${isRtl ? "فاقد مسموح" : "allowed loss"}: ${ticket.allowedLoss.trim()}%`);
    return parts.join(" • ");
  }, [ticket, ticketQty, isRtl]);

  const ticketLineName = (() => {
    const milling = MILLING_TYPES.find((m) => m.value === ticket.millingType);
    const label = milling ? (isRtl ? milling.ar : milling.en) : isRtl ? "طحن" : "Milling";
    return isRtl ? `أجرة طحن — ${label}` : `Milling fee — ${label}`;
  })();

  /* ------------------------------------------------------------- totals */

  const customerId = mode === "ticket" ? ticket.customerId : "";

  const lines: InvoiceLine[] = useMemo(() => {
    if (mode === "pos") {
      return cart.map((l) => ({
        kind: "catalog" as const,
        product_id: l.product.id,
        // The specification rides on the line name so it is visible on the
        // printed invoice and in the register, rather than being lost the
        // moment the cashier closes the screen.
        name: l.spec ? `${l.product.name} — ${specLabel(l.spec, isRtl)}` : l.product.name,
        sku: l.product.sku,
        quantity: Number(l.quantity) || 0,
        unit_price: Number(l.unitPrice) || 0,
        tax_rate: Number(l.product.tax_rate) || 0,
        unit_label: null,
      }));
    }
    if (ticketFee <= 0 || ticketQty <= 0) return [];
    return [
      {
        kind: "service" as const,
        name: ticketLineName,
        quantity: ticketQty,
        unit_price: ticketFee / ticketQty,
        tax_rate: 0,
        detail: ticketDetail,
      } satisfies ServiceLineInput,
    ];
  }, [mode, cart, ticketFee, ticketQty, ticketDetail, ticketLineName, isRtl]);

  const subtotal = useMemo(
    () => Math.round(lines.reduce((s, l) => s + lineTotal(l), 0) * 100) / 100,
    [lines],
  );
  const discountN = Math.max(0, Number(discount) || 0);
  const total = Math.max(0, Math.round((subtotal - discountN) * 100) / 100);
  const effectivePaid =
    paymentMethod === "credit" ? 0 : Math.max(0, Math.min(Number(paid) || 0, total));
  const remaining = Math.max(0, Math.round((total - effectivePaid) * 100) / 100);

  /* ------------------------------------------------------------ submit */

  async function submit() {
    if (submitting) return;
    if (!warehouseId) {
      return toast.error(isRtl ? "يرجى اختيار المستودع أولاً" : "Select a warehouse first");
    }
    if (lines.length === 0) {
      return toast.error(
        mode === "pos"
          ? isRtl
            ? "أضف صنفاً واحداً على الأقل"
            : "Add at least one item"
          : isRtl
            ? "أدخل الكمية والأجرة قبل الإصدار"
            : "Enter the quantity and fee before posting",
      );
    }
    if (mode === "ticket" && !ticket.customerId) {
      return toast.error(
        isRtl
          ? "تذكرة الطحن تتطلب عميلاً مسجلاً"
          : "A milling ticket requires a registered customer",
      );
    }
    if (remaining > 0 && !customerId) {
      return toast.error(
        isRtl
          ? "يرجى اختيار العميل لتسجيل المبلغ المتبقي كدين آجل"
          : "Select a customer so the unpaid balance can be recorded as debt",
      );
    }

    setSubmitting(true);
    try {
      const result = await createSalesInvoice({
        warehouseId,
        customerId: customerId || null,
        paymentMethod: toLegacyPaymentValue(paymentMethod) as PaymentMethod,
        paid: effectivePaid,
        discount: discountN,
        // On a ticket the negotiated terms belong on the document, not only on
        // the line, so the receipt the customer keeps can be re-read later.
        note:
          [mode === "ticket" ? ticketDetail : "", note].filter(Boolean).join(" — ") || undefined,
        lines,
      });

      if (!result.ok) {
        toast.error(result.message ?? (isRtl ? "تعذّر إصدار الفاتورة" : "Failed to post invoice"));
        return;
      }

      const customerName =
        customers.find((c) => c.id === customerId)?.name ||
        ticket.customerName.trim() ||
        (isRtl ? "عميل نقدي" : "Walk-in");
      const warehouse = warehouses.find((w) => w.id === warehouseId);

      const doc: InvoiceDoc = {
        title:
          mode === "ticket"
            ? isRtl
              ? "فاتورة أجرة طحن"
              : "Milling Fee Invoice"
            : isRtl
              ? "فاتورة مبيعات"
              : "Sales Invoice",
        number: result.invoiceNumber ?? "",
        date: new Date().toLocaleString(isRtl ? "ar-EG" : "en-US"),
        partyLabel: isRtl ? "العميل" : "Bill To",
        partyName: customerName,
        warehouse: hasMultiWarehouse
          ? isRtl
            ? warehouse?.name_ar || warehouse?.name
            : warehouse?.name
          : undefined,
        payment: pmLabel(paymentMethod, isRtl),
        status:
          remaining > 0
            ? effectivePaid > 0
              ? isRtl
                ? "جزئي"
                : "Partial"
              : isRtl
                ? "آجل"
                : "Unpaid"
            : isRtl
              ? "مدفوع"
              : "Paid",
        subtotal,
        tax: 0,
        discount: discountN,
        total: result.total ?? total,
        paid: effectivePaid,
        lines: lines.map((l) => ({
          product: l.name,
          qty: Number(l.quantity),
          price: Number(l.unit_price),
          total: Math.round(lineTotal(l) * 100) / 100,
        })),
        company: undefined,
      };

      setLastInvoice({
        id: result.invoiceId ?? "",
        number: result.invoiceNumber ?? "",
        total: result.total ?? total,
        doc,
      });
      setSuccessModalOpen(true);

      // Reset the form but keep the warehouse and the mode, so a counter that
      // serves several customers in a row does not re-select them each time.
      setCart([]);
      setTicket((current) => ({
        ...EMPTY_TICKET,
        bagSizeKg: current.bagSizeKg,
        millingType: current.millingType,
      }));
      setPaid("");
      setDiscount("");
      setNote("");
      setSearch("");
    } catch (err: any) {
      toast.error(err.message ?? (isRtl ? "تعذّر إصدار الفاتورة" : "Failed to post invoice"));
    } finally {
      setSubmitting(false);
    }
  }

  function printLast(template: InvoiceTemplate) {
    if (!lastInvoice) return;
    printInvoice(
      lastInvoice.doc,
      template,
      {
        invoice: isRtl ? "فاتورة" : "Invoice",
        date: t("common.date"),
        billTo: isRtl ? "العميل" : "Bill To",
        warehouse: t("common.warehouse"),
        payment: isRtl ? "طريقة السداد" : "Payment",
        status: t("common.status"),
        product: isRtl ? "الصنف / البيان" : "Item",
        qty: t("common.qty"),
        price: t("common.price"),
        total: t("common.total"),
        subtotal: t("common.subtotal"),
        tax: t("common.tax"),
        discount: t("common.discount"),
        grandTotal: isRtl ? "الإجمالي الكلي" : "Grand Total",
        paid: isRtl ? "المسدد" : "Paid",
        balance: isRtl ? "المتبقي" : "Balance",
        thanks: isRtl ? "شكراً لتعاملكم معنا" : "Thank you for your business",
        poweredBy: "Vortex ERP",
      },
      isRtl,
    );
  }

  /* -------------------------------------------------------- render bits */

  const selectedCustomer = customers.find((c) => c.id === customerId) || null;

  const inputClass =
    "h-10 w-full rounded-xl border border-border/80 bg-surface px-3 text-sm text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20";

  return (
    <div className="space-y-5 pb-12">
      <PageHeader
        title={isRtl ? "فاتورة المبيعات" : "Sales Invoice"}
        subtitle={
          isRtl
            ? "وضعان مختلفان: بيع صنف من الكتالوج، أو تذكرة طحن بشروط يُتفاوض عليها في اللحظة"
            : "Two modes: a catalogue sale, or a milling ticket negotiated at the counter"
        }
        actions={
          <Link
            to="/sales"
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-surface px-3 text-xs font-medium text-foreground transition hover:bg-surface-2"
          >
            <Receipt className="h-3.5 w-3.5" />
            {isRtl ? "سجل الفواتير" : "Invoice register"}
          </Link>
        }
      />

      {/* Mode switch — the two acts, stated as two acts. */}
      <div className="grid grid-cols-2 gap-2 rounded-2xl border border-border/80 bg-surface-2/40 p-1.5">
        {(
          [
            {
              id: "pos" as Mode,
              icon: <ShoppingBag className="h-4 w-4" />,
              title: isRtl ? "بيع من الكتالوج" : "Catalogue sale",
              sub: isRtl ? "صنف معروف، الكمية فقط" : "Known product, quantity only",
            },
            {
              id: "ticket" as Mode,
              icon: <Wrench className="h-4 w-4" />,
              title: isRtl ? "تذكرة طحن (خدمة)" : "Milling ticket (service)",
              sub: isRtl ? "شروط يُتفاوض عليها" : "Negotiated terms",
            },
          ] as const
        ).map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => setMode(m.id)}
            className={`flex items-start gap-2.5 rounded-xl px-3.5 py-3 text-start transition ${
              mode === m.id
                ? "bg-surface shadow-sm ring-1 ring-primary/30"
                : "text-muted-foreground hover:bg-surface/60"
            }`}
          >
            <span
              className={`mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg ${
                mode === m.id ? "bg-primary/10 text-primary" : "bg-surface-2"
              }`}
            >
              {m.icon}
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-foreground">{m.title}</span>
              <span className="block truncate text-[11px] text-muted-foreground">{m.sub}</span>
            </span>
          </button>
        ))}
      </div>

      {lastInvoice && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3">
          <div className="flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 className="h-4 w-4" />
            <span className="font-semibold">
              {isRtl ? "آخر فاتورة" : "Last invoice"} #{lastInvoice.number}
            </span>
            <span className="font-mono">{toSystemDigits(money(lastInvoice.total))}</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => printLast("thermal")}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 text-xs font-medium hover:bg-surface-2"
            >
              <Printer className="h-3.5 w-3.5" />
              {isRtl ? "طباعة حرارية" : "Thermal"}
            </button>
            <button
              type="button"
              onClick={() => printLast("a4")}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 text-xs font-medium hover:bg-surface-2"
            >
              <Printer className="h-3.5 w-3.5" />
              A4
            </button>
            <button
              type="button"
              onClick={() => setLastInvoice(null)}
              className="rounded-lg p-1.5 text-muted-foreground hover:bg-surface hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[1fr_400px]">
        {/* ------------------------------------------------------ left pane */}
        <div className="order-2 space-y-4 lg:order-1">
          {loading ? (
            <div className="panel-elevated flex min-h-[240px] items-center justify-center gap-3 text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
              <span className="text-sm">{isRtl ? "جارٍ التحميل..." : "Loading..."}</span>
            </div>
          ) : mode === "pos" ? (
            <>
              <div className="panel-elevated rounded-2xl border border-border/80 bg-surface/90 p-3">
                <div className="flex items-center gap-2 rounded-full border border-input/80 bg-surface px-3.5 h-10 focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20">
                  <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder={isRtl ? "ابحث بالاسم أو الكود..." : "Search by name or code..."}
                    className="w-full flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                  />
                  {search && (
                    <button
                      type="button"
                      onClick={() => setSearch("")}
                      className="rounded-full p-1 text-muted-foreground hover:bg-surface-2"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {filteredProducts.length === 0 ? (
                  <div className="col-span-full rounded-2xl border border-border/80 bg-surface p-6 text-center text-sm text-muted-foreground">
                    {isRtl ? "لا توجد أصناف قابلة للبيع" : "No sellable products"}
                  </div>
                ) : (
                  filteredProducts.map((p) => {
                    const lowStock = p.on_hand <= 0;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => addProduct(p)}
                        className="group flex flex-col justify-between rounded-2xl border border-border/80 bg-surface p-3 text-start transition hover:border-primary/40 hover:shadow-sm"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <span className="line-clamp-2 text-sm font-medium text-foreground">
                            {p.name}
                          </span>
                          <Plus className="h-4 w-4 shrink-0 text-muted-foreground group-hover:text-primary" />
                        </div>
                        <div className="mt-2 flex items-center justify-between text-xs">
                          <span className="font-mono font-semibold text-foreground">
                            {toSystemDigits(money(p.sale_price))}
                          </span>
                          <span
                            className={`font-mono ${lowStock ? "text-rose-500" : "text-emerald-500"}`}
                          >
                            {isRtl ? "متاح: " : "On hand: "}
                            {toSystemDigits(String(p.on_hand))}
                          </span>
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </>
          ) : (
            /* ------------------------------------------------- ticket mode */
            <div className="panel-elevated space-y-4 rounded-2xl border border-border/80 bg-surface/90 p-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <Wrench className="h-4 w-4 text-violet-500" />
                {isRtl
                  ? "شروط الطحن — تُكتب بحرية على التذكرة"
                  : "Milling terms — free-form on the ticket"}
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label={isRtl ? "العميل المسجّل" : "Registered customer"} required>
                  <select
                    value={ticket.customerId}
                    onChange={(e) => {
                      const c = customers.find((x) => x.id === e.target.value);
                      setT("customerId", e.target.value);
                      setT("customerName", c?.name ?? "");
                      setT("customerPhone", c?.phone ?? "");
                    }}
                    className={inputClass}
                  >
                    <option value="">{isRtl ? "— اختر عميلاً —" : "— Select a customer —"}</option>
                    {customers.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                        {c.phone ? ` — ${c.phone}` : ""}
                      </option>
                    ))}
                  </select>
                </Field>

                <Field label={isRtl ? "اسم العميل (طباعة)" : "Customer name (printed)"}>
                  <input
                    value={ticket.customerName}
                    onChange={(e) => setT("customerName", e.target.value)}
                    className={inputClass}
                    placeholder={isRtl ? "كما سيظهر على السند" : "As it appears on the ticket"}
                  />
                </Field>

                <Field label={isRtl ? "نوع الحبوب" : "Grain type"}>
                  <input
                    value={ticket.grainType}
                    onChange={(e) => setT("grainType", e.target.value)}
                    className={inputClass}
                    placeholder={isRtl ? "قمح / ذرة / شعير..." : "Wheat / maize / barley..."}
                  />
                </Field>

                <Field label={isRtl ? "الدرجة" : "Grade"}>
                  <input
                    value={ticket.grade}
                    onChange={(e) => setT("grade", e.target.value)}
                    className={inputClass}
                    placeholder={isRtl ? "نمرة 1 / نمرة 2..." : "Grade 1 / Grade 2..."}
                  />
                </Field>

                <Field label={isRtl ? "نوع الطحن" : "Milling type"}>
                  <select
                    value={ticket.millingType}
                    onChange={(e) => setT("millingType", e.target.value)}
                    className={inputClass}
                  >
                    {MILLING_TYPES.map((m) => (
                      <option key={m.value} value={m.value}>
                        {isRtl ? m.ar : m.en}
                      </option>
                    ))}
                  </select>
                </Field>

                <Field label={isRtl ? "عدد الأكياس" : "Sack count"}>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={ticket.bagCount}
                    onChange={(e) => setT("bagCount", e.target.value)}
                    className={inputClass}
                    placeholder="0"
                  />
                </Field>

                <Field label={isRtl ? "سعة الكيس (كجم)" : "Bag size (kg)"}>
                  <select
                    value={ticket.bagSizeKg}
                    onChange={(e) => setT("bagSizeKg", e.target.value)}
                    className={inputClass}
                  >
                    {BAG_SIZES.map((s) => (
                      <option key={s} value={String(s)}>
                        {toSystemDigits(String(s))} {isRtl ? "كجم" : "kg"}
                      </option>
                    ))}
                  </select>
                </Field>

                <Field label={isRtl ? "مصدر الأكياس" : "Bag source"}>
                  <select
                    value={ticket.bagSource}
                    onChange={(e) => setT("bagSource", e.target.value as "CUSTOMER" | "MILL")}
                    className={inputClass}
                  >
                    <option value="CUSTOMER">{isRtl ? "أكياس العميل" : "Customer's bags"}</option>
                    <option value="MILL">{isRtl ? "أكياس المطحنة" : "Mill's bags"}</option>
                  </select>
                </Field>

                <Field label={isRtl ? "نوع الكيس" : "Bag type"}>
                  <input
                    value={ticket.bagType}
                    onChange={(e) => setT("bagType", e.target.value)}
                    className={inputClass}
                    placeholder={isRtl ? "خيش / بلاستيك..." : "Jute / plastic..."}
                  />
                </Field>

                <Field label={isRtl ? "حالة الكيس" : "Bag condition"}>
                  <input
                    value={ticket.bagCondition}
                    onChange={(e) => setT("bagCondition", e.target.value)}
                    className={inputClass}
                    placeholder={isRtl ? "سليم / ممزق..." : "Sound / torn..."}
                  />
                </Field>

                <Field label={isRtl ? "أساس الأجرة" : "Fee basis"}>
                  <select
                    value={ticket.feeBasis}
                    onChange={(e) => setT("feeBasis", e.target.value)}
                    className={inputClass}
                  >
                    {FEE_BASES.map((b) => (
                      <option key={b.value} value={b.value}>
                        {isRtl ? b.ar : b.en}
                      </option>
                    ))}
                  </select>
                </Field>

                {ticket.feeBasis === "PER_BAG" && (
                  <Field label={isRtl ? "الأجرة لكل شوال" : "Fee per sack"}>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={ticket.feePerBag}
                      onChange={(e) => setT("feePerBag", e.target.value)}
                      className={inputClass}
                      placeholder="0.00"
                    />
                  </Field>
                )}
                {ticket.feeBasis === "PER_TON" && (
                  <Field label={isRtl ? "الأجرة لكل طن" : "Fee per ton"}>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={ticket.feePerTon}
                      onChange={(e) => setT("feePerTon", e.target.value)}
                      className={inputClass}
                      placeholder="0.00"
                    />
                  </Field>
                )}
                {ticket.feeBasis === "LUMP_SUM" && (
                  <Field label={isRtl ? "مبلغ مقطوع" : "Lump sum"}>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={ticket.lumpSum}
                      onChange={(e) => setT("lumpSum", e.target.value)}
                      className={inputClass}
                      placeholder="0.00"
                    />
                  </Field>
                )}

                <Field label={isRtl ? "الاستخلاص المتوقع %" : "Expected extraction %"}>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="0.01"
                    value={ticket.expectedExtraction}
                    onChange={(e) => setT("expectedExtraction", e.target.value)}
                    className={inputClass}
                    placeholder="—"
                  />
                </Field>

                <Field label={isRtl ? "الفاقد المسموح %" : "Allowed loss %"}>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="0.01"
                    value={ticket.allowedLoss}
                    onChange={(e) => setT("allowedLoss", e.target.value)}
                    className={inputClass}
                    placeholder="—"
                  />
                </Field>
              </div>

              <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-[11px] leading-relaxed text-amber-700 dark:text-amber-300">
                <AlertCircle className="mb-1 inline h-3.5 w-3.5" />{" "}
                {isRtl
                  ? "هذه بيعة خدمة: المطحنة تتقاضى أجر الطحن ولا تنقل ملكية مخزون. العميل الذي يودع حبوبه ويستلم دقيقه أمانة تُدار من مكتب المطحنة بمستنداتها."
                  : "This is a service sale: the mill charges a grinding fee and transfers no stock ownership. Grain deposited and collected as flour is custody, handled by the milling desk with its own documents."}
              </div>
            </div>
          )}
        </div>

        {/* ----------------------------------------------------- right pane */}
        <div className="order-1 space-y-4 lg:order-2 lg:sticky lg:top-4">
          <div className="panel-elevated space-y-3 rounded-2xl border border-border/80 bg-surface/90 p-4">
            {hasMultiWarehouse && warehouses.length > 1 && (
              <Field label={t("common.warehouse")} icon={<WarehouseIcon className="h-3.5 w-3.5" />}>
                <select
                  value={warehouseId}
                  onChange={(e) => setWarehouseId(e.target.value)}
                  className={inputClass}
                >
                  {warehouses.map((w) => (
                    <option key={w.id} value={w.id}>
                      {isRtl ? w.name_ar || w.name : w.name}
                    </option>
                  ))}
                </select>
              </Field>
            )}

            {mode === "pos" ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs font-semibold text-muted-foreground">
                  <span>{isRtl ? "بنود الفاتورة" : "Invoice lines"}</span>
                  {cart.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setCart([])}
                      className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-rose-500"
                    >
                      <RotateCcw className="h-3 w-3" />
                      {isRtl ? "تفريغ" : "Clear"}
                    </button>
                  )}
                </div>

                {cart.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-border py-8 text-center text-xs text-muted-foreground">
                    {isRtl ? "اضغط صنفاً لإضافته" : "Tap a product to add it"}
                  </div>
                ) : (
                  cart.map((l, index) => (
                    <div
                      key={`${l.product.id}-${index}`}
                      className="rounded-xl border border-border/70 bg-surface-2/40 p-2.5"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="line-clamp-2 text-xs font-medium text-foreground">
                          {l.product.name}
                        </span>
                        <button
                          type="button"
                          onClick={() => removeLine(index)}
                          className="rounded p-0.5 text-muted-foreground hover:text-rose-500"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>

                      {/*
                       * The specification panel. One product, sold several
                       * ways: the mill's flour goes out as a 10 kg bag of fine
                       * grade and as a 50 kg sack of whole-grain without
                       * becoming two catalogue rows. The chosen spec rides on
                       * the sale line and prints under it.
                       */}
                      <div className="mt-2 rounded-lg border border-border/50 bg-surface/60 p-2">
                        <button
                          type="button"
                          onClick={() =>
                            updateSpec(index, {
                              grainOrGrade: l.spec?.grainOrGrade ?? "",
                              millingType: l.spec?.millingType ?? "",
                              bagType: l.spec?.bagType ?? "شوال",
                              bagSizeKg: l.spec?.bagSizeKg ?? "50",
                            })
                          }
                          className="flex w-full items-center justify-between text-[10px] font-semibold text-muted-foreground hover:text-foreground"
                        >
                          <span>
                            {l.spec
                              ? isRtl
                                ? `${l.spec.grainOrGrade || "—"} • ${specLabel(l.spec, isRtl)}`
                                : specLabel(l.spec, isRtl)
                              : isRtl
                                ? "خيارات البيع (حجم • نوع • كيس)"
                                : "Sale options (size • grade • bag)"}
                          </span>
                          <SlidersHorizontal className="h-3 w-3" />
                        </button>

                        {l.spec && (
                          <div className="mt-2 grid grid-cols-2 gap-1.5">
                            <input
                              value={l.spec.grainOrGrade}
                              onChange={(e) =>
                                updateSpec(index, { ...l.spec!, grainOrGrade: e.target.value })
                              }
                              placeholder={isRtl ? "الدرجة/النوع" : "Grade / type"}
                              className="h-7 w-full rounded-md border border-border bg-surface px-1.5 text-[10px] outline-none focus:border-primary"
                            />
                            <select
                              value={l.spec.millingType}
                              onChange={(e) =>
                                updateSpec(index, { ...l.spec!, millingType: e.target.value })
                              }
                              className="h-7 w-full rounded-md border border-border bg-surface px-1.5 text-[10px] outline-none focus:border-primary"
                            >
                              {SPEC_MILLING_TYPES.map((m) => (
                                <option key={m.value} value={m.value}>
                                  {isRtl ? m.ar : m.en}
                                </option>
                              ))}
                            </select>
                            <select
                              value={l.spec.bagType}
                              onChange={(e) =>
                                updateSpec(index, { ...l.spec!, bagType: e.target.value })
                              }
                              className="h-7 w-full rounded-md border border-border bg-surface px-1.5 text-[10px] outline-none focus:border-primary"
                            >
                              {SPEC_BAG_TYPES.map((b) => (
                                <option key={b.value} value={b.value}>
                                  {isRtl ? b.ar : b.en}
                                </option>
                              ))}
                            </select>
                            <select
                              value={l.spec.bagSizeKg}
                              onChange={(e) =>
                                updateSpec(index, { ...l.spec!, bagSizeKg: e.target.value })
                              }
                              className="h-7 w-full rounded-md border border-border bg-surface px-1.5 text-[10px] outline-none focus:border-primary"
                            >
                              {MILLING_BAG_SIZES.map((b) => (
                                <option key={b.kg} value={String(b.kg)}>
                                  {b.kg} {isRtl ? "كجم" : "kg"}
                                </option>
                              ))}
                            </select>
                          </div>
                        )}
                      </div>

                      <div className="mt-2 grid grid-cols-3 gap-1.5">
                        <label className="space-y-0.5">
                          <span className="block text-[10px] text-muted-foreground">
                            {t("common.qty")}
                          </span>
                          <input
                            type="number"
                            min="0"
                            step="1"
                            value={l.quantity}
                            onChange={(e) =>
                              setCart((current) =>
                                current.map((x, i) =>
                                  i === index ? { ...x, quantity: e.target.value } : x,
                                ),
                              )
                            }
                            className="h-8 w-full rounded-lg border border-border bg-surface px-2 text-xs outline-none focus:border-primary"
                          />
                        </label>
                        <label className="space-y-0.5">
                          <span className="block text-[10px] text-muted-foreground">
                            {t("common.price")}
                          </span>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={l.unitPrice}
                            onChange={(e) =>
                              setCart((current) =>
                                current.map((x, i) =>
                                  i === index ? { ...x, unitPrice: e.target.value } : x,
                                ),
                              )
                            }
                            className="h-8 w-full rounded-lg border border-border bg-surface px-2 text-xs outline-none focus:border-primary"
                          />
                        </label>
                        <div className="space-y-0.5">
                          <span className="block text-[10px] text-muted-foreground">
                            {t("common.total")}
                          </span>
                          <div className="flex h-8 items-center justify-end px-1 font-mono text-xs font-semibold">
                            {toSystemDigits(
                              money((Number(l.quantity) || 0) * (Number(l.unitPrice) || 0)),
                            )}
                          </div>
                        </div>
                      </div>
                      {Number(l.quantity) > Number(l.product.on_hand) && (
                        <div className="mt-1.5 flex items-center gap-1 text-[10px] text-amber-500">
                          <AlertCircle className="h-3 w-3" />
                          {isRtl
                            ? `الكمية تتجاوز المتاح (${toSystemDigits(String(l.product.on_hand))})`
                            : `Exceeds stock on hand (${toSystemDigits(String(l.product.on_hand))})`}
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            ) : (
              <div className="space-y-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">{isRtl ? "الكمية" : "Quantity"}</span>
                  <span className="font-mono">
                    {toSystemDigits(String(ticketQty))} × {toSystemDigits(ticket.bagSizeKg)}{" "}
                    {isRtl ? "كجم" : "kg"}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">{isRtl ? "الأجرة" : "Fee"}</span>
                  <span className="font-mono font-semibold">
                    {toSystemDigits(money(ticketFee))}
                  </span>
                </div>
                <div className="rounded-xl border border-border/70 bg-surface-2/40 p-2 text-[11px] leading-relaxed text-muted-foreground">
                  {ticketDetail || (isRtl ? "لم تُدخل شروط بعد" : "No terms entered yet")}
                </div>
              </div>
            )}

            <div className="h-px bg-border" />

            <div className="space-y-2">
              <Field label={isRtl ? "طريقة السداد" : "Payment method"}>
                {/*
                  The sales invoice form has its own context, so a business can
                  offer a different set here than at the till. The picker returns
                  a catalogue id; toLegacyPaymentValue converts it to the value
                  the RPC expects.
                */}
                <PaymentMethodPicker
                  context="sales"
                  value={paymentMethod}
                  onChange={(method) => {
                    setPaymentMethod(method);
                    const definition = getPaymentMethodDefinition(method);
                    if (definition?.isCreditTerm) setPaid("0");
                  }}
                  ensureIds={[paymentMethod]}
                  ariaLabel={isRtl ? "طريقة السداد" : "Payment method"}
                />
              </Field>

              <div className="grid grid-cols-2 gap-2">
                <Field label={t("common.discount")}>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={discount}
                    onChange={(e) => setDiscount(e.target.value)}
                    className={inputClass}
                    placeholder="0.00"
                  />
                </Field>
                <Field label={t("common.paid")}>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={paymentMethod === "credit" ? "0" : paid}
                    disabled={paymentMethod === "credit"}
                    onChange={(e) => setPaid(e.target.value)}
                    className={`${inputClass} disabled:opacity-60`}
                    placeholder="0.00"
                  />
                </Field>
              </div>

              <Field label={t("common.note")}>
                <input
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  className={inputClass}
                  placeholder={isRtl ? "ملاحظة على الفاتورة" : "Invoice note"}
                />
              </Field>
            </div>

            <div className="h-px bg-border" />

            <div className="space-y-1.5 text-sm">
              <Row label={t("common.subtotal")} value={toSystemDigits(money(subtotal))} />
              {discountN > 0 && (
                <Row
                  label={t("common.discount")}
                  value={`− ${toSystemDigits(money(discountN))}`}
                  muted
                />
              )}
              <div className="flex items-center justify-between border-t border-border pt-2 text-base font-bold">
                <span>{isRtl ? "الإجمالي" : "Total"}</span>
                <span className="font-mono text-primary">{toSystemDigits(money(total))}</span>
              </div>
              <Row label={t("common.paid")} value={toSystemDigits(money(effectivePaid))} muted />
              {remaining > 0 && (
                <div className="flex items-center justify-between text-xs font-semibold text-rose-500">
                  <span>{isRtl ? "المتبقي (آجل)" : "Remaining (credit)"}</span>
                  <span className="font-mono">{toSystemDigits(money(remaining))}</span>
                </div>
              )}
            </div>

            {remaining > 0 && !selectedCustomer && (
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-2 text-[11px] text-amber-700 dark:text-amber-300">
                {mode === "ticket"
                  ? isRtl
                    ? "اختر العميل المسجّل — تذكرة الطحن لا تكون نقدية."
                    : "Select the registered customer — a milling ticket cannot be a walk-in."
                  : isRtl
                    ? "سيُسجَّل المتبقي ديناً على العميل المختار."
                    : "The remainder will be recorded as customer debt."}
              </div>
            )}

            <button
              type="button"
              onClick={() => void submit()}
              disabled={submitting || lines.length === 0}
              className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary text-sm font-semibold text-primary-foreground shadow-sm transition hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <CheckCircle2 className="h-4 w-4" />
              )}
              {isRtl ? "إصدار الفاتورة" : "Post invoice"}
            </button>
          </div>

          {mode === "ticket" && selectedCustomer && (
            <div className="rounded-2xl border border-border/80 bg-surface/90 p-3 text-[11px]">
              <div className="flex items-center gap-1.5 font-semibold text-foreground">
                <User className="h-3.5 w-3.5" />
                {selectedCustomer.name}
              </div>
              <div className="mt-1.5 flex items-center justify-between text-muted-foreground">
                <span>{isRtl ? "الرصيد الحالي" : "Current balance"}</span>
                <span className="font-mono">
                  {toSystemDigits(money(Number(selectedCustomer.balance) || 0))}
                </span>
              </div>
              <div className="mt-1 flex items-center justify-between text-muted-foreground">
                <span>{isRtl ? "حد الائتمان" : "Credit limit"}</span>
                <span className="font-mono">
                  {toSystemDigits(money(Number(selectedCustomer.credit_limit) || 0))}
                </span>
              </div>
            </div>
          )}
        </div>
      </div>

      <OperationSuccessModal
        open={successModalOpen}
        onClose={() => setSuccessModalOpen(false)}
        title={isRtl ? "تم إصدار الفاتورة بنجاح" : "Invoice Issued Successfully"}
        subtitle={
          lastInvoice
            ? isRtl
              ? `فاتورة مبيعات #${lastInvoice.number}`
              : `Sales Invoice #${lastInvoice.number}`
            : undefined
        }
        amount={lastInvoice?.total}
        referenceNumber={lastInvoice?.number}
        customer={
          selectedCustomer
            ? {
                id: selectedCustomer.id,
                name: selectedCustomer.name,
                phone: selectedCustomer.phone,
                balance: Number(selectedCustomer.balance ?? 0),
              }
            : null
        }
        invoice={
          lastInvoice
            ? {
                id: lastInvoice.id,
                invoiceNumber: lastInvoice.number,
                date: new Date().toISOString().split("T")[0],
                subtotal: lastInvoice.total,
                total: lastInvoice.total,
                paid: Number(paid || 0),
                remaining: Math.max(0, lastInvoice.total - Number(paid || 0)),
              }
            : null
        }
        eventType="invoice_created"
        onPrint={() => setLuxuryPreviewOpen(true)}
      />

      {lastInvoice && (
        <LuxuryPrintPreviewModal
          open={luxuryPreviewOpen}
          onClose={() => setLuxuryPreviewOpen(false)}
          doc={lastInvoice.doc}
          documentType="customer_invoice"
          title={isRtl ? "معاينة وطباعة الفاتورة" : "Invoice Print Preview"}
          customerPhone={selectedCustomer?.phone || undefined}
          customerName={selectedCustomer?.name || undefined}
        />
      )}
    </div>
  );
}

function Field({
  label,
  children,
  required,
  icon,
}: {
  label: string;
  children: React.ReactNode;
  required?: boolean;
  icon?: React.ReactNode;
}) {
  return (
    <label className="block space-y-1">
      <span className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
        {icon}
        {label}
        {required && <span className="text-rose-500">*</span>}
      </span>
      {children}
    </label>
  );
}

function Row({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className={`font-mono ${muted ? "text-muted-foreground" : "text-foreground"}`}>
        {value}
      </span>
    </div>
  );
}

function pmLabel(method: string, isRtl: boolean): string {
  // Reads the catalogue instead of a local map, so a method added to the
  // catalogue is labelled correctly here without touching this file.
  return paymentMethodLabel(method, isRtl ? "ar" : "en");
}

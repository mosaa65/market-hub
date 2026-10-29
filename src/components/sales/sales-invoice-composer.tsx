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
import { useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  FileText,
  ArrowUpDown,
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
import { translateRpcError } from "@/lib/errors/rpc-errors";
import { OperationSuccessModal } from "@/components/communication";
import { AmountInput } from "@/components/ui/amount-input";
import { QuantityInput } from "@/components/ui/quantity-input";
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
import { usePaymentPanel } from "@/components/payments/payment-panel";
import { InvoiceProductFinder } from "@/components/sales/invoice-product-finder";
import { InvoiceLinesGrid, type UnitOption } from "@/components/sales/invoice-lines-grid";
import { InvoiceSummaryPanel } from "@/components/sales/invoice-summary-panel";
import { InvoiceStatusStrip } from "@/components/sales/invoice-status-strip";
import { newLineKey, type PosCartLine } from "@/components/sales/invoice-pos-types";
import { useCompanyCurrency } from "@/hooks/use-company-currency";
import { useFormNavigationScope } from "@/hooks/use-form-navigation";
import { DynamicPaymentSelector } from "@/components/ui/payment-method/dynamic-payment-selector";
import type { PaymentSettlementSelection } from "@/lib/payments/treasury-types";
import {
  getPaymentMethodDefinition,
  paymentMethodLabel,
  toLegacyPaymentValue,
} from "@/lib/payments/payment-methods";

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
  /** P1-6: the seeded cash customer, which must never carry debt. */
  is_system?: boolean | null;
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

/** أنماط الطحن التي قد يحملها بند بيع (وصفية فقط، لا تفصل مخزونًا). */
const MILLING_TYPES = [
  { value: "FLOUR_GRADE_1", ar: "دقيق نمرة 1 (فاخر)", en: "Flour grade 1" },
  { value: "FLOUR_GRADE_2", ar: "دقيق نمرة 2 (بر)", en: "Flour grade 2" },
  { value: "SEMOLINA", ar: "سمولينا", en: "Semolina" },
  { value: "BRAN", ar: "نخالة (ردة)", en: "Bran" },
] as const;

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

export function SalesInvoiceComposer() {
  const navigate = useNavigate();
  const { lang, t } = useI18n();
  const { isModuleEnabled } = useModules();
  const isRtl = lang === "ar";
  const hasMultiWarehouse = isModuleEnabled("multi_warehouse");

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [warehouseId, setWarehouseId] = useState("");
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [products, setProducts] = useState<SellableProduct[]>([]);
  /**
   * The seeded system cash customer (عميل نقدي, `customers.is_system`) — the one
   * party a walk-in sale is actually booked to.
   *
   * This screen used to leave the invoice with `customer_id = null` until the
   * operator picked someone, and the register then printed a made-up "عميل نقدي"
   * for it. That made a second, phantom cash customer that only existed in the
   * UI: the sale was invisible on the real cash account's statement, and any
   * remaining amount was refused because there was no customer to carry it.
   * The screen now uses the system row itself, selected by default, exactly as
   * the POS does.
   */
  const [cashCustomerId, setCashCustomerId] = useState("");
  const [customerId, setCustomerId] = useState("");

  //
  // Holds a CATALOGUE id (e.g. 'kuraimi_bank'), because that is what the picker
  // produces. It is converted to the stored ENUM value with toLegacyPaymentValue
  // at the point of submission, so the RPC contract never changes.
  const [paymentMethod, setPaymentMethod] = useState<string>("cash");
  const [settlement, setSettlement] = useState<PaymentSettlementSelection>({
    method: "cash",
    paymentMethodId: "cash",
  });
  const [paid, setPaid] = useState("");
  const [paymentReference, setPaymentReference] = useState("");
  const [paymentSplits, setPaymentSplits] = useState<
    { method: string; amount: number; payment_method_id: string; reference?: string }[]
  >([]);

  const [discount, setDiscount] = useState("");
  const [note, setNote] = useState("");
  /** تاريخ المستند — الافتراضي اليوم، ويمكن تعديله للفاتورة المؤجلة. */
  const [invoiceDate, setInvoiceDate] = useState(() => new Date().toISOString().slice(0, 10));

  // Document lines
  const [cart, setCart] = useState<PosCartLine[]>([]);
  const finderRef = useRef<HTMLDivElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const { currencySymbol } = useCompanyCurrency();
  /** آخر نسخة من `submit`، حتى يصل إليها اختصار Ctrl+Enter دون إعادة تسجيل. */
  const submitRef = useRef<(() => Promise<void> | Promise<unknown>) | null>(null);

  const [lastInvoice, setLastInvoice] = useState<{
    id: string;
    number: string;
    total: number;
    doc: InvoiceDoc;
  } | null>(null);
  const [successModalOpen, setSuccessModalOpen] = useState(false);
  const [luxuryPreviewOpen, setLuxuryPreviewOpen] = useState(false);

  /* ------------------------------------------------------------ loading */

  async function load() {
    setLoading(true);
    try {
      const [wsRes, csRes] = await Promise.allSettled([
        supabase.from("warehouses").select("id,name,name_ar").eq("is_active", true).order("name"),
        supabase
          .from("customers")
          .select("id,name,phone,balance,credit_limit,is_system")
          .eq("is_active", true)
          .order("name"),
      ]);

      const ws = (wsRes.status === "fulfilled" ? wsRes.value.data : null) ?? [];
      const cs = ((csRes.status === "fulfilled" ? csRes.value.data : null) ?? []) as Customer[];
      setWarehouses(ws as Warehouse[]);
      setCustomers(cs);
      const cash = cs.find((customer) => customer.is_system);
      if (cash) {
        setCashCustomerId(cash.id);
        // Default the party to the system cash customer without ever
        // overriding a customer the operator already chose.
        setCustomerId((current) => current || cash.id);
      }
      setWarehouseId((current) =>
        ws.some((w: any) => w.id === current) ? current : ((ws[0] as any)?.id ?? ""),
      );
    } finally {
      setLoading(false);
    }
  }

  const loadProducts = useCallback(
    async (warehouse: string) => {
      if (!warehouse) return;
      try {
        setProducts(await fetchSellableProducts(warehouse, isRtl ? "ar" : "en"));
      } catch (err: any) {
        toast.error(err.message ?? (isRtl ? "تعذّر تحميل الأصناف" : "Failed to load products"));
        setProducts([]);
      }
    },
    [isRtl],
  );

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    void loadProducts(warehouseId);
  }, [warehouseId, loadProducts]);

  /* --------------------------------------------------------------- POS */

  /**
   * Picking an item appends a document line — it never bumps a quantity.
   *
   * A formal invoice is a list of what was delivered; a repeat item is a repeat
   * line the operator can price or describe separately. Silently merging would
   * hide a line from the printed document and make the two entries impossible
   * to tell apart. The same product sold twice stays two lines.
   */
  const addProduct = useCallback((product: SellableProduct, requestedUomId?: string) => {
    const selectedUom =
      product.sale_uoms?.find((uom) => uom.unit_id === requestedUomId) ??
      product.sale_uoms?.find((uom) => uom.unit_id === product.default_sales_uom_id) ??
      product.sale_uoms?.find((uom) => uom.is_default_sale);
    setCart((current) => [
      ...current,
      {
        key: newLineKey(),
        product,
        quantity: "1",
        unitPrice: String(selectedUom?.sale_price ?? product.sale_price ?? 0),
        uomId: selectedUom?.unit_id ?? product.unit_id,
        uomFactor: selectedUom?.factor_to_base ?? 1,
        uomLabel: selectedUom?.label ?? product.base_unit_label,
        quantityStep: selectedUom?.quantity_increment ?? 0.001,
        // RPC sale prices are resolved from the per-unit catalogue setting;
        // do not present a manual override that the posting engine ignores.
        priceEditable: false,
      },
    ]);
  }, []);

  function changeLineUom(index: number, unitId: string | null) {
    const line = cart[index];
    if (!line) return;
    const unit = (line.product.sale_uoms ?? []).find((option) => option.unit_id === unitId);
    if (!unit) {
      // الوحدة الأساسية: السعر الأساسي وعامل 1.
      const baseUnit = (line.product.sale_uoms ?? []).find(
        (option) => option.unit_id === line.product.unit_id,
      );
      updateLine(index, {
        uomId: line.product.unit_id,
        uomFactor: baseUnit?.factor_to_base ?? 1,
        uomLabel: baseUnit?.label ?? line.product.base_unit_label,
        quantityStep: baseUnit?.quantity_increment ?? 0.001,
        unitPrice: String(baseUnit?.sale_price ?? line.product.sale_price ?? 0),
        priceEditable: false,
      });
      return;
    }
    const reservedByOtherLines = cart.reduce(
      (sum, other, otherIndex) =>
        otherIndex === index || other.product.id !== line.product.id
          ? sum
          : sum + (Number(other.quantity) || 0) * (other.uomFactor ?? 1),
      0,
    );
    const availableForLine = Math.max(0, line.product.on_hand - reservedByOtherLines);
    if ((Number(line.quantity) || 0) * unit.factor_to_base > availableForLine + 1e-9) {
      toast.error(
        isRtl
          ? "الكمية الحالية تتجاوز الرصيد المتاح بهذه الوحدة"
          : "The quantity exceeds the available stock in this unit.",
      );
      return;
    }
    updateLine(index, {
      uomId: unit.unit_id,
      uomFactor: unit.factor_to_base,
      uomLabel: unit.label,
      quantityStep: unit.quantity_increment,
      unitPrice: String(unit.sale_price),
      priceEditable: false,
    });
  }

  /** وحدات السطر: وحدات البيع المسجّلة + الأساسية، مع إبراز الحالية. */
  const unitOptionsFor = useCallback(
    (line: PosCartLine): UnitOption[] => {
      const base: UnitOption = {
        id: line.product.unit_id,
        label: line.product.base_unit_label || (isRtl ? "الوحدة الأساسية" : "Base unit"),
        factor: 1,
      };
      const sale = (line.product.sale_uoms ?? []).map((uom) => ({
        id: uom.unit_id,
        label: uom.label || uom.unit_id,
        factor: uom.factor_to_base,
      }));
      const all = [base, ...sale.filter((uom) => uom.id !== base.id)];
      const currentId = line.uomId ?? base.id;
      // الوحدة الحالية أولاً، فيظهر اسم الوحدة المختارة في أول القائمة دائمًا.
      return [
        ...all.filter((uom) => uom.id === currentId),
        ...all.filter((uom) => uom.id !== currentId),
      ];
    },
    [isRtl],
  );

  /**
   * Lines are identified by position, not by product id. Once a product can
   * appear twice with different specifications, removing "the flour line" by id
   * would remove every flour line at once.
   */
  function removeLine(index: number) {
    setCart((current) => current.filter((_, i) => i !== index));
  }

  function updateLine(index: number, patch: Partial<PosCartLine>) {
    setCart((current) => current.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  }

  /** Alt+↑/↓ — the order of lines is the order printed on the document. */
  function moveLine(index: number, direction: -1 | 1) {
    setCart((current) => {
      const target = index + direction;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  function updateSpec(index: number, spec: ProductSpec) {
    setCart((current) => current.map((l, i) => (i === index ? { ...l, spec } : l)));
  }

  /** يضع المؤشر في حقل البحث — أول ما يفعله المستخدم، وبعد كل بند. */
  const focusFinder = useCallback(() => {
    const input = finderRef.current?.querySelector("input");
    input?.focus();
    input?.select();
  }, []);

  /**
   * اختصارات المستند — تُسجّل على الشاشة فقط، فلا تتعارض مع الكاشير.
   *   F2          حقل البحث عن صنف
   *   Ctrl+Enter  إصدار الفاتورة
   */
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === "F2") {
        event.preventDefault();
        focusFinder();
        return;
      }
      if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        void submitRef.current?.();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [focusFinder]);

  /* ------------------------------------------------------------- totals */

  const lines: InvoiceLine[] = useMemo(
    () =>
      cart.map((l) => ({
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
        uom_id: l.uomId ?? null,
        unit_label: l.uomLabel ?? null,
      })),
    [cart, isRtl],
  );

  const subtotal = useMemo(
    () => Math.round(lines.reduce((s, l) => s + lineTotal(l), 0) * 100) / 100,
    [lines],
  );
  const discountN = Math.max(0, Number(discount) || 0);
  const total = Math.max(0, Math.round((subtotal - discountN) * 100) / 100);

  /**
   * The party the invoice is booked to — the selected party, defaulting to the
   * seeded system cash customer. It is what the submit path sends as
   * `customer_id` and what the shared payment rules evaluate (so the cash
   * customer is blocked from carrying debt).
   */
  const partyId = customerId;
  const selectedCustomer = customers.find((c) => c.id === partyId) || null;
  const isCashParty = Boolean(selectedCustomer?.is_system);

  // P1-4: the payment arithmetic is the shared panel's, not this screen's.
  const payment = usePaymentPanel({
    total,
    state: { method: paymentMethod, paidRaw: paid, customerId: partyId },
    customers,
  });
  const effectivePaid = payment.paid;
  const remaining = payment.remaining;

  /* ------------------------------------------------------------ submit */

  async function submit() {
    if (submitting) return;
    if (!warehouseId) {
      return toast.error(isRtl ? "يرجى اختيار المستودع أولاً" : "Select a warehouse first");
    }
    if (lines.length === 0) {
      return toast.error(isRtl ? "أضف بندًا واحدًا على الأقل" : "Add at least one line item");
    }
    if (cart.some((line) => {
      const quantity = Number(line.quantity) || 0;
      const increment = line.quantityStep || 0.001;
      return quantity <= 0 || Math.abs(quantity / increment - Math.round(quantity / increment)) > 1e-7;
    })) {
      return toast.error(isRtl ? "تحقق من الكمية؛ يجب أن تطابق خطوة الوحدة المحددة" : "Check the quantity; it must follow the selected unit increment");
    }
    if (remaining > 0 && !partyId) {
      return toast.error(
        isRtl
          ? "يرجى اختيار العميل لتسجيل المبلغ المتبقي كدين آجل"
          : "Select a customer so the unpaid balance can be recorded as debt",
      );
    }
    // The seeded cash customer is the walk-in party: it may settle any method
    // in full, but it can never carry a balance. On the cash party we simply
    // collect the whole amount in cash, so no debt is ever posted to it.
    if (remaining > 0 && isCashParty) {
      return toast.error(
        isRtl
          ? "العميل النقدي لا يحمل ديناً — حصّل كامل المبلغ أو اختر عميلاً مسجلاً"
          : "The cash customer cannot carry a balance — collect it in full or pick a registered customer",
      );
    }
    // The panel's rules (overpaid, debt on the cash customer, credit limit) are
    // the same ones the server enforces — fail here with the same sentence.
    if (!payment.isPayable) {
      return toast.error(
        payment.blockingReason ?? (isRtl ? "بيانات دفع غير صالحة" : "Invalid payment"),
      );
    }

    setSubmitting(true);
    try {
      const result = await createSalesInvoice({
        warehouseId,
        customerId: partyId || null,
        // تاريخ المستند كما اختاره المستخدم — وليس "الآن" دائمًا.
        saleDate: invoiceDate,
        paymentMethod: toLegacyPaymentValue(
          paymentSplits.length > 1 ? "split" : paymentMethod,
        ) as PaymentMethod,
        paid: effectivePaid,
        discount: discountN,
        paymentSplits: paymentSplits.length > 1 ? paymentSplits : null,
        // The settlement trail (split allocation, transfer reference) belongs on
        // the document, not only in a screen state, so the receipt the customer
        // keeps can be re-read later.
        note:
          [
            paymentSplits.length > 1
              ? `[${isRtl ? "الدفع بأكثر من طريقة" : "Split"}: ${paymentSplits
                  .map(
                    (line) =>
                      `${paymentMethodLabel(line.method, isRtl ? "ar" : "en")}: ${money(line.amount)}`,
                  )
                  .join(" | ")}]`
              : "",
            paymentReference.trim()
              ? `${isRtl ? "مرجع الحوالة" : "Transfer ref"}: ${paymentReference.trim()}`
              : "",
            note,
          ]
            .filter(Boolean)
            .join(" — ") || undefined,
        lines,
        cashboxId: settlement.cashboxId || null,
        bankAccountId: settlement.bankAccountId || null,
        paymentMethodId: settlement.paymentMethodId || null,
        paymentReference: settlement.reference || null,
        chequeNumber: settlement.chequeNumber || null,
        chequeBank: settlement.chequeBank || null,
        chequeDueDate: settlement.chequeDueDate || null,
        chequeDrawer: settlement.chequeDrawer || null,
      });

      if (!result.ok) {
        toast.error(result.message ?? (isRtl ? "تعذّر إصدار الفاتورة" : "Failed to post invoice"));
        return;
      }

      // The name on the document is the party actually booked on the invoice —
      // never a second, made-up "عميل نقدي" when the real cash row exists.
      const customerName = selectedCustomer?.name || (isRtl ? "عميل نقدي" : "Walk-in");
      const warehouse = warehouses.find((w) => w.id === warehouseId);

      const resolvedPaymentLabel =
        paymentSplits.length > 1
          ? isRtl
            ? "دفع بأكثر من طريقة"
            : "Split payment"
          : settlement.bankAccountName
            ? `${pmLabel(paymentMethod, isRtl)} (${settlement.bankAccountName})`
            : settlement.cashboxName
              ? `${pmLabel(paymentMethod, isRtl)} (${settlement.cashboxName})`
              : pmLabel(paymentMethod, isRtl);

      const doc: InvoiceDoc = {
        title: isRtl ? "فاتورة مبيعات" : "Sales Invoice",
        number: result.invoiceNumber ?? "",
        date: new Date().toISOString(),
        partyLabel: isRtl ? "العميل" : "Bill To",
        partyName: customerName,
        warehouse: hasMultiWarehouse
          ? isRtl
            ? warehouse?.name_ar || warehouse?.name
            : warehouse?.name
          : undefined,
        payment: resolvedPaymentLabel,
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
          // الوحدة تُطبع مع البيان: "5" بلا وحدة لا يعني شيئًا على المستند.
          product: l.kind === "catalog" && l.unit_label ? `${l.name} (${l.unit_label})` : l.name,
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
      setPaid("");
      setPaymentSplits([]);
      if (paymentSplits.length > 1) {
        setPaymentMethod("cash");
        setSettlement({ method: "cash", paymentMethodId: "cash" });
      }
      setDiscount("");
      setNote("");
      setPaymentReference("");
      // The party stays selected so a counter can serve the next sale at once,
      // and the cursor returns to the item search for the next document.
      focusFinder();
    } catch (err: any) {
      toast.error(
        translateRpcError(
          err,
          isRtl ? "ar" : "en",
          isRtl ? "تعذّر إصدار الفاتورة" : "Failed to post invoice",
        ),
      );
    } finally {
      setSubmitting(false);
    }
  }
  submitRef.current = submit;

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

  const inputClass =
    "h-10 w-full rounded-xl border border-border/80 bg-surface px-3 text-sm text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20";

  return (
    <div className="space-y-5 pb-12">
      <PageHeader
        title={isRtl ? "فاتورة المبيعات" : "Sales Invoice"}
        subtitle={
          isRtl
            ? "فاتورة مبيعات للسلع والخدمات العامة من الكتالوج"
            : "Sales invoice for catalogue goods and general services"
        }
        actions={
          <button
            type="button"
            onClick={() => void navigate({ to: "/sales" })}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-surface px-3 text-xs font-medium text-foreground transition hover:bg-surface-2"
          >
            <Receipt className="h-3.5 w-3.5" />
            {isRtl ? "سجل الفواتير" : "Invoice register"}
          </button>
        }
      />

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

      {/*
{/*
       * ════════════════════════════════════════════════════════════════════
       *  مساحة المستند — ارتفاع الشاشة، بلا تمرير للصفحة
       * ════════════════════════════════════════════════════════════════════
       *  من lg وأعلى: عمودان يملاّن بقية الشاشة (`100dvh − الترويسة`)، ويتمرّر
       *  داخلهما فقط: البنود في عمودها، ولوحة القرار في عمودها. فيبقى حقل
       *  البحث وزر الإصدار والإجمالي في العين دائمًا — لا يخرج شيء عن الشاشة.
       *
       *  شريط الحالة فوق البنود يحمل (البنود • المجموع • المدفوع • المتبقي)
       *  في صف واحد رقيق بدل أربع بطاقات تأكل رأس الصفحة.
       */}
      {/*
       * حاوية الأدوات: تلتقط الارتفاع الحقيقي المتبقي (الشاشة − الترويسة −
       * حشوة المحتوى) بدل تخمينه برقم ثابت. المحتوى بداخلها `flex-1` ويُمرَّر
       * داخليًا فقط، فالنموذج بأكمله يسع الشاشة مهما كان طول الجدول.
       */}
      <div className="flex min-h-0 flex-col lg:-my-6 lg:h-[min(100%,100dvh-4rem)]">
        <div
          ref={rootRef}
          data-form-nav-scope
          className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_360px] lg:overflow-hidden"
          /*
           * الارتفاع = املأ بقية الشاشة بدقة: لا رقم ثابت، والحاوية الأب `flex`
           * بارتفاع محدد (`lg:-my-6 lg:flex-1` أسفل)، فنضمن ألا يتجاوز المستند
           * حدود الشاشة مهما كان ارتفاع الترويسة أو كثافة المتصفح.
           */
          style={{ height: "100%", minHeight: 0 }}
        >
          {/* ───────────────────────────── عمود المستند */}
          <div className="order-2 flex min-w-0 flex-col gap-3 lg:order-1 lg:h-full">
            <InvoiceStatusStrip
              isRtl={isRtl}
              lineCount={cart.length}
              quantity={cart.reduce((sum, l) => sum + (Number(l.quantity) || 0), 0)}
              subtotal={subtotal}
              paid={effectivePaid}
              remaining={remaining}
              currencySymbol={currencySymbol}
              lastInvoiceNumber={lastInvoice?.number ?? null}
              onOpenLast={() => setLuxuryPreviewOpen(true)}
            />

            <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-border/80 bg-card shadow-sm">
              {/* ترويسة المستند */}
              <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border/70 bg-gradient-to-b from-muted/40 to-transparent px-3 py-2">
                <div className="flex items-center gap-2">
                  <span className="grid size-7 place-items-center rounded-lg border border-border/70 bg-surface text-primary">
                    <FileText className="size-3.5" />
                  </span>
                  <h2 className="text-xs font-bold text-foreground">
                    {isRtl ? "بنود المستند" : "Document lines"}
                  </h2>
                  <span className="rounded-full border border-border/70 bg-surface px-1.5 py-0.5 font-mono text-[10px] font-semibold text-muted-foreground">
                    {toSystemDigits(cart.length)}
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  {hasMultiWarehouse && warehouses.length > 1 && (
                    <select
                      value={warehouseId}
                      onChange={(e) => setWarehouseId(e.target.value)}
                      data-form-nav
                      aria-label={t("common.warehouse")}
                      className="rounded-md border border-border/70 bg-surface px-1.5 py-0.5 text-[11px] text-foreground outline-none focus:border-primary"
                    >
                      {warehouses.map((w) => (
                        <option key={w.id} value={w.id}>
                          {isRtl ? w.name_ar || w.name : w.name}
                        </option>
                      ))}
                    </select>
                  )}
                  {cart.length > 0 && (
                    <button
                      type="button"
                      tabIndex={-1}
                      onClick={() => setCart([])}
                      className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[10px] text-muted-foreground transition hover:bg-rose-500/10 hover:text-rose-500"
                    >
                      <RotateCcw className="size-3" />
                      {isRtl ? "تفريغ" : "Clear"}
                    </button>
                  )}
                </div>
              </div>

              {/* البحث + البنود — الجسم الوحيد الذي يتمرّر */}
              <div className="flex min-h-0 flex-1 flex-col gap-2.5 p-3">
                <div ref={finderRef} className="shrink-0">
                  <InvoiceProductFinder
                    products={products}
                    isRtl={isRtl}
                    disabled={loading}
                    onPick={addProduct}
                    onTabForward={() =>
                      // Tab من البحث يقفز إلى أول خلية كمية في الجدول مباشرة.
                      rootRef.current
                        ?.querySelector<HTMLInputElement>("[data-line-grid] input")
                        ?.focus()
                    }
                  />
                </div>

                <div
                  className="min-h-0 flex-1 overflow-y-auto overscroll-contain custom-scrollbar"
                  data-line-grid
                >
                  {loading ? (
                    <div className="flex min-h-[220px] items-center justify-center gap-3 rounded-xl border border-border/70 bg-surface/50 text-muted-foreground">
                      <Loader2 className="size-5 animate-spin text-primary" />
                      <span className="text-sm">
                        {isRtl ? "جارٍ تحميل الأصناف…" : "Loading items…"}
                      </span>
                    </div>
                  ) : (
                    <InvoiceLinesGrid
                      lines={cart}
                      isRtl={isRtl}
                      currencySymbol={currencySymbol}
                      onUpdate={updateLine}
                      unitOptionsFor={unitOptionsFor}
                      onUnitChange={changeLineUom}
                      onRemove={removeLine}
                      onMove={moveLine}
                      onAppend={focusFinder}
                      onRequestAdd={focusFinder}
                      onExitForward={() =>
                        // Enter بعد آخر بند: إلى عمود القرار (المدفوع) بلا فأرة.
                        rootRef.current
                          ?.querySelector<HTMLElement>("[data-summary-panel] [data-form-nav]")
                          ?.focus()
                      }
                    />
                  )}
                </div>

                <p className="flex shrink-0 flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[9px] text-muted-foreground">
                  <span className="inline-flex items-center gap-0.5">
                    <kbd className="rounded border border-border/70 bg-surface px-1">↑↓</kbd>
                    {isRtl ? "بين البنود" : "lines"}
                  </span>
                  <span className="inline-flex items-center gap-0.5">
                    <kbd className="rounded border border-border/70 bg-surface px-1">↵</kbd>
                    {isRtl ? "الخلية التالية" : "next cell"}
                  </span>
                  <span className="inline-flex items-center gap-0.5">
                    <kbd className="rounded border border-border/70 bg-surface px-1">Alt</kbd>
                    <ArrowUpDown className="size-2.5" />
                    {isRtl ? "ترتيب" : "reorder"}
                  </span>
                  <span className="inline-flex items-center gap-0.5">
                    <kbd className="rounded border border-border/70 bg-surface px-1">Tab</kbd>
                    {isRtl ? "إلى السداد" : "to payment"}
                  </span>
                </p>
              </div>
            </div>
          </div>

          {/* ───────────────────────────── لوحة القرار */}
          <div className="order-1 min-w-0 lg:order-2 lg:h-full lg:overflow-y-auto custom-scrollbar">
            <div data-summary-panel>
              <InvoiceSummaryPanel
                isRtl={isRtl}
                customers={customers}
                cashCustomerId={cashCustomerId}
                customerId={customerId}
                onCustomerChange={setCustomerId}
                paymentMethod={paymentMethod}
                onPaymentMethodChange={(method) => {
                  setPaymentSplits([]);
                  setPaymentMethod(method);
                  if (getPaymentMethodDefinition(method)?.isCreditTerm) setPaid("0");
                }}
                settlement={settlement}
                onSettlementChange={setSettlement}
                paid={paid}
                onPaidChange={setPaid}
                subtotal={subtotal}
                discount={discount}
                onDiscountChange={setDiscount}
                total={total}
                effectivePaid={effectivePaid}
                remaining={remaining}
                change={payment.change}
                currencySymbol={currencySymbol}
                date={invoiceDate}
                onDateChange={setInvoiceDate}
                warehouseLabel={
                  (warehouses.find((w) => w.id === warehouseId)?.name_ar ||
                    warehouses.find((w) => w.id === warehouseId)?.name ||
                    (isRtl ? "المستودع الرئيسي" : "Main warehouse")) as string
                }
                remainingError={
                  remaining > 0
                    ? payment.isPayable
                      ? isCashParty
                        ? isRtl
                          ? "العميل النقدي لا يحمل ديناً — حصّل كامل المبلغ أو اختر عميلاً مسجلاً."
                          : "The cash customer cannot carry a balance — collect in full or pick a registered customer."
                        : isRtl
                          ? "سيُسجَّل المتبقي ديناً على العميل المختار."
                          : "The remainder will be recorded as customer debt."
                      : (payment.blockingReason ?? null)
                    : null
                }
                lineCount={lines.length}
                submitting={submitting}
                canSubmit={lines.length > 0 && payment.isPayable}
                onSubmit={() => void submit()}
                note={note}
                onNoteChange={setNote}
              />
            </div>
          </div>
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
        onPrint={() => {
          setSuccessModalOpen(false);
          setLuxuryPreviewOpen(true);
        }}
        onViewDocument={() => {
          setSuccessModalOpen(false);
          setLuxuryPreviewOpen(true);
        }}
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

function pmLabel(method: string, isRtl: boolean): string {
  // Reads the catalogue instead of a local map, so a method added to the
  // catalogue is labelled correctly here without touching this file.
  return paymentMethodLabel(method, isRtl ? "ar" : "en");
}

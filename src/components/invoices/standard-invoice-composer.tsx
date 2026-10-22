import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  Check,
  Package,
  Plus,
  Search,
  ShoppingBag,
  Trash2,
  UserRound,
  Warehouse,
  Wallet,
  X,
  Printer,
  Phone,
  CreditCard,
  Building2,
  ScanBarcode,
  Layers,
  AlertTriangle,
  Sparkles,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { QuantityInput } from "@/components/ui/quantity-input";
import { AmountInput } from "@/components/ui/amount-input";
import { DynamicPaymentSelector } from "@/components/ui/payment-method/dynamic-payment-selector";
import type { PaymentSettlementSelection } from "@/lib/payments/treasury-types";
import { useFormNavigationScope } from "@/hooks/use-form-navigation";
import { InvoiceSectionTabs } from "@/components/invoices/invoice-section-tabs";
import { createSalesInvoice, type InvoiceLine } from "@/lib/sales-invoice";
import { toLegacyPaymentValue, paymentMethodLabel } from "@/lib/payments/payment-methods";
import { translateRpcError } from "@/lib/errors/rpc-errors";
import {
  CustomerFormDialog,
  type CustomerRecord,
} from "@/components/contacts/customer-form-dialog";
import {
  SupplierFormDialog,
  type SupplierRecord,
} from "@/components/contacts/supplier-form-dialog";
import { OperationSuccessModal } from "@/components/communication/operation-success-modal";
import { LuxuryPrintPreviewModal } from "@/components/luxury-print-preview-modal";
import { playSuccessChime } from "@/lib/communication/audio";
import type { InvoiceDoc } from "@/lib/pdf";
import { useI18n } from "@/lib/i18n";
import { money } from "@/lib/format";
import { toSystemDigits } from "@/lib/format-preferences";
import { toast } from "sonner";

type Kind = "sales" | "purchase";
type Party = {
  id: string;
  name: string;
  phone?: string | null;
  balance?: number | null;
  credit_limit?: number | null;
};
type WarehouseRow = { id: string; name: string; name_ar?: string | null };
type ProductRow = {
  id: string;
  name: string;
  name_ar: string | null;
  sku: string | null;
  barcode: string | null;
  unit_id: string | null;
  cost_price: number;
  sale_price: number;
  tax_rate: number;
  unit?: { short_name?: string | null; name?: string | null; name_ar?: string | null } | null;
};
type CartLine = { product: ProductRow; quantity: number; price: number; tax_rate: number };
type SavedInvoice = {
  id: string;
  number: string;
  total: number;
  paid: number;
  remaining: number;
  doc: InvoiceDoc;
};

const fieldClass =
  "h-11 rounded-xl border-border/80 bg-background shadow-sm focus-visible:ring-primary/25";

export function StandardInvoiceComposer({ kind }: { kind: Kind }) {
  const { lang } = useI18n();
  const ar = lang === "ar";
  const navigate = useNavigate();
  const scopeRef = useFormNavigationScope<HTMLDivElement>();
  const searchRef = useRef<HTMLInputElement>(null);
  const [parties, setParties] = useState<Party[]>([]);
  const [warehouses, setWarehouses] = useState<WarehouseRow[]>([]);
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [stockMap, setStockMap] = useState<Record<string, number>>({});
  const [partyId, setPartyId] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [search, setSearch] = useState("");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [settlement, setSettlement] = useState<PaymentSettlementSelection>({ method: "cash" });
  const [paid, setPaid] = useState<number | null>(null);
  const [discount, setDiscount] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [partyDialogOpen, setPartyDialogOpen] = useState(false);
  const [successOpen, setSuccessOpen] = useState(false);
  const [printOpen, setPrintOpen] = useState(false);
  const [savedInvoice, setSavedInvoice] = useState<SavedInvoice | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const sales = kind === "sales";
  const title = sales
    ? ar
      ? "فاتورة مبيعات جديدة"
      : "New sales invoice"
    : ar
      ? "فاتورة مشتريات جديدة"
      : "New purchase invoice";
  const partyTitle = sales ? (ar ? "العميل" : "Customer") : ar ? "المورد" : "Supplier";
  const currentDate = new Intl.DateTimeFormat(ar ? "ar-YE" : "en", { dateStyle: "medium" }).format(
    new Date(),
  );
  const label = (p: ProductRow) => (ar ? p.name_ar || p.name : p.name || p.name_ar || "—");
  const warehouseName = (w: WarehouseRow) =>
    ar ? w.name_ar || w.name : w.name || w.name_ar || "—";
  const unitName = (p: ProductRow) =>
    ar
      ? p.unit?.short_name || p.unit?.name_ar || p.unit?.name
      : p.unit?.short_name || p.unit?.name || p.unit?.name_ar;

  useEffect(() => {
    let live = true;
    setLoading(true);
    void Promise.all([
      sales
        ? supabase
            .from("customers")
            .select("id,name,phone,balance,credit_limit")
            .eq("is_active", true)
            .order("name")
            .limit(1000)
        : supabase
            .from("suppliers")
            .select("id,name,phone,balance")
            .eq("is_active", true)
            .order("name")
            .limit(1000),
      supabase
        .from("warehouses")
        .select("id,name,name_ar")
        .eq("is_active", true)
        .order("name")
        .limit(200),
      supabase
        .from("products")
        .select(
          "id,name,name_ar,sku,barcode,unit_id,cost_price,sale_price,tax_rate,unit:units!products_unit_id_fkey(short_name,name,name_ar)",
        )
        .eq("is_active", true)
        .order("name")
        .limit(1000),
    ]).then(([partyRes, whRes, productRes]) => {
      if (!live) return;
      if (partyRes.error || whRes.error || productRes.error) {
        toast.error(ar ? "تعذر تحميل بيانات الفاتورة" : "Could not load invoice data");
      }
      const partyRows = (partyRes.data ?? []) as Party[];
      const whRows = (whRes.data ?? []) as WarehouseRow[];
      setParties(partyRows);
      setWarehouses(whRows);
      setProducts((productRes.data ?? []) as ProductRow[]);
      setPartyId(partyRows[0]?.id ?? "");
      setWarehouseId(whRows[0]?.id ?? "");
      setLoading(false);
    });
    return () => {
      live = false;
    };
  }, [sales, ar]);

  useEffect(() => {
    if (!warehouseId) {
      setStockMap({});
      return;
    }
    let live = true;
    void supabase
      .from("inventory")
      .select("product_id,quantity")
      .eq("warehouse_id", warehouseId)
      .then(({ data, error }) => {
        if (!live || error) return;
        const next: Record<string, number> = {};
        for (const row of data ?? [])
          next[(row as any).product_id] = Number((row as any).quantity ?? 0);
        setStockMap(next);
      });
    return () => {
      live = false;
    };
  }, [warehouseId]);

  const results = useMemo(() => {
    const q = search.trim().toLocaleLowerCase();
    if (!q) return [];
    return products
      .filter((p) =>
        [p.name, p.name_ar, p.sku, p.barcode].some((v) =>
          (v ?? "").toLocaleLowerCase().includes(q),
        ),
      )
      .slice(0, 5);
  }, [products, search]);
  useEffect(() => setSelectedIndex(0), [search]);
  const subtotal = cart.reduce((s, l) => s + l.price * l.quantity, 0);
  const tax = cart.reduce(
    (s, l) => s + (l.price * l.quantity * (Number(l.product.tax_rate) || 0)) / 100,
    0,
  );
  const total = Math.max(0, subtotal + tax - (discount ?? 0));
  const credit = paymentMethod === "credit" || settlement.method === "credit";
  const effectivePaid = credit ? 0 : (paid ?? total);
  const remaining = Math.max(0, total - effectivePaid);
  const selectedParty = parties.find((p) => p.id === partyId);
  const selectedWarehouse = warehouses.find((w) => w.id === warehouseId);

  function addProduct(product: ProductRow) {
    setCart((previous) => {
      const found = previous.findIndex((line) => line.product.id === product.id);
      if (found >= 0)
        return previous.map((line, i) =>
          i === found ? { ...line, quantity: line.quantity + 1 } : line,
        );
      return [
        ...previous,
        {
          product,
          quantity: 1,
          price: Number(sales ? product.sale_price : product.cost_price) || 0,
          tax_rate: Number(product.tax_rate) || 0,
        },
      ];
    });
    setSearch("");
    searchRef.current?.focus();
  }

  async function submit() {
    if (!partyId || !warehouseId)
      return toast.error(
        ar
          ? `حدد ${partyTitle} والمستودع أولاً`
          : `Select a ${sales ? "customer" : "supplier"} and warehouse first`,
      );
    if (!cart.length)
      return toast.error(ar ? "أضف صنفاً واحداً على الأقل" : "Add at least one item");
    if (
      cart.some(
        (line) =>
          !Number.isFinite(line.quantity) ||
          line.quantity <= 0 ||
          !Number.isFinite(line.price) ||
          line.price < 0,
      )
    ) {
      return toast.error(ar ? "راجع الكمية والسعر في الأصناف" : "Check item quantities and prices");
    }
    if (discount && discount > subtotal + tax)
      return toast.error(
        ar ? "الخصم أكبر من قيمة الفاتورة" : "Discount cannot exceed invoice value",
      );
    if (
      sales &&
      cart.some(
        (line) =>
          Object.hasOwn(stockMap, line.product.id) &&
          line.quantity > (stockMap[line.product.id] ?? 0),
      )
    ) {
      return toast.error(
        ar
          ? "توجد كمية تتجاوز المتاح في المستودع المحدد"
          : "One or more quantities exceed stock in the selected warehouse",
      );
    }
    if (
      sales &&
      remaining > 0 &&
      selectedParty?.credit_limit &&
      Number(selectedParty.balance ?? 0) + remaining > selectedParty.credit_limit
    ) {
      toast.warning(
        ar
          ? "تنبيه: المبلغ المتبقي يتجاوز السقف الائتماني للعميل"
          : "Warning: the remaining balance exceeds the customer credit limit",
      );
    }
    setSaving(true);
    try {
      let invoiceId = "";
      let invoiceNumber = "";
      if (sales) {
        const lines: InvoiceLine[] = cart.map(({ product, quantity, price }) => ({
          kind: "catalog",
          product_id: product.id,
          name: label(product),
          sku: product.sku,
          quantity,
          unit_price: price,
          tax_rate: Number(product.tax_rate) || 0,
        }));
        const result = await createSalesInvoice({
          warehouseId,
          customerId: partyId,
          paymentMethod: paymentMethod as any,
          paid: credit ? 0 : (paid ?? total),
          discount: discount ?? 0,
          note,
          lines,
          cashboxId: settlement.cashboxId,
          bankAccountId: settlement.bankAccountId,
          paymentMethodId: settlement.paymentMethodId,
          paymentReference: settlement.reference || settlement.paymentReference,
          chequeNumber: settlement.chequeNumber,
          chequeBank: settlement.chequeBank,
          chequeDueDate: settlement.chequeDueDate,
          chequeDrawer: settlement.chequeDrawer,
        });
        if (!result.ok)
          throw new Error(
            translateRpcError(
              result.message,
              ar ? "ar" : "en",
              ar ? "تعذر إصدار الفاتورة" : "Failed to post invoice",
            ),
          );
        invoiceId = result.invoiceId ?? "";
        invoiceNumber = result.invoiceNumber ?? invoiceId.slice(0, 8);
        toast.success(
          ar
            ? `تم إنشاء فاتورة المبيعات ${invoiceNumber}`
            : `Sales invoice ${invoiceNumber} created`,
        );
      } else {
        const payload = {
          _warehouse_id: warehouseId,
          _supplier_id: partyId,
          _payment_method: toLegacyPaymentValue(paymentMethod),
          _paid: credit ? 0 : (paid ?? total),
          _discount: discount ?? 0,
          _note: note || null,
          _items: cart.map(({ product, quantity, price }) => ({
            product_id: product.id,
            quantity,
            unit_cost: price,
            tax_rate: Number(product.tax_rate) || 0,
          })),
        };
        const { data, error } = await (supabase.rpc as any)("create_purchase", payload);
        if (error)
          throw new Error(
            translateRpcError(
              error,
              ar ? "ar" : "en",
              ar ? "تعذر تسجيل فاتورة المشتريات" : "Failed to record purchase invoice",
            ),
          );
        if (
          settlement.cashboxId ||
          settlement.bankAccountId ||
          settlement.reference ||
          settlement.paymentMethodId
        ) {
          const { error: settlementError } = await (supabase.from("purchase_invoices") as any)
            .update({
              cashbox_id: settlement.cashboxId || null,
              bank_account_id: settlement.bankAccountId || null,
              payment_reference: settlement.reference || settlement.paymentReference || null,
              payment_method_id: settlement.paymentMethodId || paymentMethod,
            })
            .eq("id", data);
          if (settlementError)
            throw new Error(translateRpcError(settlementError, ar ? "ar" : "en"));
        }
        invoiceId = String(data ?? "");
        const { data: invoiceRow } = await (supabase.from("purchase_invoices") as any)
          .select("invoice_number")
          .eq("id", invoiceId)
          .maybeSingle();
        invoiceNumber = invoiceRow?.invoice_number ?? invoiceId.slice(0, 8);
        toast.success(
          ar
            ? `تم إنشاء فاتورة المشتريات ${invoiceNumber}`
            : `Purchase invoice ${invoiceNumber} created`,
        );
      }
      const doc: InvoiceDoc = {
        title,
        number: invoiceNumber,
        date: new Date().toISOString(),
        partyLabel: partyTitle,
        partyName: selectedParty?.name || "",
        partyPhone: selectedParty?.phone || undefined,
        warehouse: selectedWarehouse?.name,
        payment: paymentMethodLabel(paymentMethod, ar ? "ar" : "en"),
        status: credit
          ? ar
            ? "آجل"
            : "Credit"
          : remaining > 0
            ? ar
              ? "جزئي"
              : "Partial"
            : ar
              ? "مدفوع"
              : "Paid",
        lines: cart.map((line) => ({
          product: label(line.product),
          qty: line.quantity,
          price: line.price,
          total: line.quantity * line.price,
        })),
        subtotal,
        tax,
        discount: discount ?? 0,
        total,
        paid: effectivePaid,
        notes: note || undefined,
      };
      setSavedInvoice({
        id: invoiceId,
        number: invoiceNumber,
        total,
        paid: effectivePaid,
        remaining,
        doc,
      });
      setSuccessOpen(true);
    } catch (error: any) {
      toast.error(
        translateRpcError(
          error,
          ar ? "ar" : "en",
          ar ? "تعذر حفظ الفاتورة" : "Could not save invoice",
        ),
      );
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    const onShortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
        event.preventDefault();
        void submit();
      }
      if (event.key === "F2") {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onShortcut);
    return () => window.removeEventListener("keydown", onShortcut);
  });

  return (
    <div
      ref={scopeRef}
      data-form-nav-scope
      className="mx-auto max-w-7xl space-y-5 pb-10"
      dir={ar ? "rtl" : "ltr"}
    >
      <InvoiceSectionTabs kind={kind} active="create" />
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div
            className={`grid size-12 place-items-center rounded-2xl ${sales ? "bg-primary/10 text-primary" : "bg-amber-500/10 text-amber-600"}`}
          >
            {sales ? <ShoppingBag className="size-5" /> : <Package className="size-5" />}
          </div>
          <div>
            <p className="text-xs font-semibold text-muted-foreground">
              {sales ? (ar ? "المبيعات" : "SALES") : ar ? "المشتريات" : "PURCHASES"}
            </p>
            <h1 className="text-2xl font-black tracking-tight text-foreground">{title}</h1>
          </div>
        </div>
        <Button
          variant="outline"
          className="rounded-xl"
          onClick={() => void navigate({ to: sales ? "/sales" : "/purchases" })}
        >
          {ar ? <ArrowRight className="ms-2 size-4" /> : <ArrowLeft className="me-2 size-4" />}
          {ar ? "العودة للفواتير" : "Back to invoices"}
        </Button>
      </header>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-4">
          <div className="panel-elevated overflow-hidden rounded-2xl">
            <div className="flex items-center justify-between border-b border-border/70 bg-surface-2/30 px-5 py-4">
              <div className="flex items-center gap-2">
                <span className="grid size-8 place-items-center rounded-xl bg-primary/10 text-primary">
                  <CalendarDays className="size-4" />
                </span>
                <h2 className="font-bold">{ar ? "البيانات الأساسية" : "Invoice details"}</h2>
              </div>
              <span className="text-xs text-muted-foreground">
                {ar ? "تاريخ اليوم" : "Today"} · {currentDate}
              </span>
            </div>
            <div className="grid gap-4 p-5 sm:grid-cols-2 xl:grid-cols-3">
              <label className="space-y-1.5">
                <span className="flex items-center justify-between gap-2 text-xs font-semibold text-muted-foreground">
                  <span className="flex items-center gap-1.5">
                    <UserRound className="size-3.5" />
                    {partyTitle}
                  </span>
                  <button
                    type="button"
                    onClick={() => setPartyDialogOpen(true)}
                    className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-primary hover:bg-primary/10"
                  >
                    <Plus className="size-3.5" />
                    {ar ? "إضافة" : "Add"}
                  </button>
                </span>
                <select
                  data-form-nav
                  value={partyId}
                  onChange={(e) => setPartyId(e.target.value)}
                  className={`${fieldClass} w-full px-3 text-sm`}
                  disabled={loading}
                >
                  <option value="">{ar ? `اختر ${partyTitle}` : `Choose ${partyTitle}`}</option>
                  {parties.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                      {p.phone ? ` · ${p.phone}` : ""}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1.5">
                <span className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                  <Warehouse className="size-3.5" />
                  {ar ? "المستودع" : "Warehouse"}
                </span>
                <select
                  data-form-nav
                  value={warehouseId}
                  onChange={(e) => setWarehouseId(e.target.value)}
                  className={`${fieldClass} w-full px-3 text-sm`}
                  disabled={loading}
                >
                  <option value="">{ar ? "اختر المستودع" : "Choose warehouse"}</option>
                  {warehouses.map((w) => (
                    <option key={w.id} value={w.id}>
                      {warehouseName(w)}
                    </option>
                  ))}
                </select>
              </label>
              <div className="flex items-end">
                <div className="flex h-11 w-full items-center justify-between rounded-xl border border-dashed border-border px-3 text-xs text-muted-foreground">
                  <span>{ar ? "حالة الفاتورة" : "Invoice status"}</span>
                  <span className="rounded-full bg-emerald-500/10 px-2.5 py-1 font-bold text-emerald-600">
                    {ar ? "مسودة جديدة" : "New draft"}
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div className="panel-elevated overflow-hidden rounded-2xl">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/70 px-5 py-4">
              <div>
                <h2 className="font-bold">{ar ? "الأصناف والخدمات" : "Items & services"}</h2>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {ar
                    ? "ابحث بالاسم أو الرمز، ثم أضف الصنف إلى الفاتورة"
                    : "Search by name or code, then add items to the invoice"}
                </p>
              </div>
              <span className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-bold text-primary">
                {toSystemDigits(String(cart.length))} {ar ? "أصناف" : "items"}
              </span>
            </div>
            <div className="relative p-4 sm:p-5">
              <div className="relative">
                <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  ref={searchRef}
                  data-form-nav
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "ArrowDown") {
                      e.preventDefault();
                      setSelectedIndex((i) => (results.length ? (i + 1) % results.length : 0));
                    }
                    if (e.key === "ArrowUp") {
                      e.preventDefault();
                      setSelectedIndex((i) =>
                        results.length ? (i - 1 + results.length) % results.length : 0,
                      );
                    }
                    if (e.key === "Enter" && (results[selectedIndex] || results[0])) {
                      e.preventDefault();
                      addProduct(results[selectedIndex] || results[0]);
                    }
                    if (e.key === "Escape") setSearch("");
                  }}
                  placeholder={
                    ar ? "ابحث عن منتج، SKU أو باركود…" : "Search product, SKU or barcode…"
                  }
                  className="h-12 rounded-xl ps-10 pe-10"
                />
                {search && (
                  <button
                    type="button"
                    onClick={() => setSearch("")}
                    className="absolute end-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                  >
                    <X className="size-4" />
                  </button>
                )}
              </div>
              {search.trim() && (
                <div className="absolute inset-x-4 top-[72px] z-20 overflow-hidden rounded-xl border border-border bg-popover shadow-xl sm:inset-x-5">
                  {results.length ? (
                    results.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => addProduct(p)}
                        className={`flex w-full items-center justify-between gap-3 border-b border-border/60 px-4 py-3 text-start last:border-0 hover:bg-primary/5 ${results.indexOf(p) === selectedIndex ? "bg-primary/5" : ""}`}
                      >
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold">{label(p)}</div>
                          <div className="mt-0.5 text-[11px] text-muted-foreground">
                            {p.sku || p.barcode || (ar ? "بدون رمز" : "No code")}
                            {unitName(p) ? ` · ${unitName(p)}` : ""}
                          </div>
                        </div>
                        <span className="shrink-0 text-end">
                          <span className="block font-mono text-sm font-bold text-primary">
                            {money(Number(sales ? p.sale_price : p.cost_price))}
                          </span>
                          <span className="text-[10px] text-muted-foreground">
                            {ar
                              ? `المتاح ${toSystemDigits(String(stockMap[p.id] ?? 0))} · اضغط للإضافة`
                              : `${stockMap[p.id] ?? 0} available · click to add`}
                          </span>
                        </span>
                      </button>
                    ))
                  ) : (
                    <div className="px-4 py-5 text-center text-sm text-muted-foreground">
                      {ar
                        ? "لا توجد نتائج. جرّب اسماً أو رمزاً آخر."
                        : "No matches. Try another name or code."}
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="px-4 pb-4 sm:px-5 sm:pb-5">
              {cart.length === 0 ? (
                <div className="grid min-h-40 place-items-center rounded-xl border border-dashed border-border bg-surface-2/20 px-5 text-center">
                  <div>
                    <div className="mx-auto mb-2 grid size-10 place-items-center rounded-xl bg-primary/10 text-primary">
                      <ShoppingBag className="size-5" />
                    </div>
                    <p className="text-sm font-semibold">
                      {ar ? "ابدأ بإضافة صنف إلى الفاتورة" : "Start by adding an item"}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {ar
                        ? "اكتب اسم المنتج أو امسح الباركود في حقل البحث"
                        : "Type a product name or scan a barcode"}
                    </p>
                  </div>
                </div>
              ) : (
                <div className="overflow-x-auto rounded-xl border border-border/80">
                  <table className="w-full min-w-[680px] text-sm">
                    <thead className="bg-surface-2/50 text-[11px] font-semibold text-muted-foreground">
                      <tr>
                        <th className="px-4 py-3 text-start">{ar ? "الصنف" : "Item"}</th>
                        <th className="w-36 px-3 py-3 text-center">{ar ? "الكمية" : "Quantity"}</th>
                        <th className="w-40 px-3 py-3 text-center">
                          {sales
                            ? ar
                              ? "سعر البيع"
                              : "Unit price"
                            : ar
                              ? "تكلفة الوحدة"
                              : "Unit cost"}
                        </th>
                        <th className="w-32 px-4 py-3 text-end">{ar ? "الإجمالي" : "Amount"}</th>
                        <th className="w-12 px-2 py-3" />
                      </tr>
                    </thead>
                    <tbody>
                      {cart.map((line, i) => (
                        <tr key={line.product.id} className="border-t border-border/60">
                          <td className="px-4 py-3">
                            <div className="font-semibold">{label(line.product)}</div>
                            <div className="mt-0.5 text-[10px] text-muted-foreground">
                              {line.product.sku || line.product.barcode || "—"}
                              {unitName(line.product) ? ` · ${unitName(line.product)}` : ""}
                              {sales
                                ? ` · ${ar ? "المتاح" : "Stock"}: ${toSystemDigits(String(stockMap[line.product.id] ?? 0))}`
                                : ""}
                            </div>
                          </td>
                          <td className="px-3 py-2">
                            <QuantityInput
                              data-form-nav
                              decimals={2}
                              min={0.01}
                              value={line.quantity}
                              onValueChange={(v) =>
                                setCart((prev) =>
                                  prev.map((r, j) => (j === i ? { ...r, quantity: v ?? 1 } : r)),
                                )
                              }
                              className="h-9"
                            />
                          </td>
                          <td className="px-3 py-2">
                            <AmountInput
                              data-form-nav
                              value={line.price}
                              onValueChange={(v) =>
                                setCart((prev) =>
                                  prev.map((r, j) => (j === i ? { ...r, price: v ?? 0 } : r)),
                                )
                              }
                              className="h-9"
                            />
                          </td>
                          <td className="px-4 py-3 text-end font-mono font-bold tabular-nums">
                            {money(line.quantity * line.price)}
                          </td>
                          <td className="px-2 py-2">
                            <button
                              type="button"
                              onClick={() => setCart((prev) => prev.filter((_, j) => j !== i))}
                              className="grid size-8 place-items-center rounded-lg text-muted-foreground hover:bg-rose-500/10 hover:text-rose-600"
                              aria-label={ar ? "حذف الصنف" : "Remove item"}
                            >
                              <Trash2 className="size-4" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>

          <div className="panel-elevated rounded-2xl p-5">
            <div className="mb-4 flex items-center gap-2">
              <Wallet className="size-4 text-primary" />
              <h2 className="font-bold">{ar ? "السداد والملاحظات" : "Payment & notes"}</h2>
            </div>
            <div className="grid gap-5 lg:grid-cols-2">
              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-xs font-semibold text-muted-foreground">
                    {ar ? "طريقة الدفع" : "Payment method"}
                  </label>
                  <DynamicPaymentSelector
                    context={sales ? "sales" : "purchases"}
                    value={paymentMethod}
                    onChange={(v) => {
                      setPaymentMethod(v);
                      setSettlement((s) => ({ ...s, method: v }));
                      if (v === "credit") setPaid(0);
                    }}
                    settlement={settlement}
                    onSettlementChange={setSettlement}
                    includeCredit
                    compact
                  />
                </div>
                <label className="block space-y-1.5">
                  <span className="text-xs font-semibold text-muted-foreground">
                    {ar ? "المبلغ المدفوع" : "Amount paid"}
                  </span>
                  <AmountInput
                    data-form-nav
                    value={credit ? 0 : (paid ?? total)}
                    onValueChange={setPaid}
                    disabled={credit}
                    className="h-11 rounded-xl"
                  />
                  <span className="block text-[11px] text-muted-foreground">
                    {credit
                      ? ar
                        ? "البيع الآجل يسجل المبلغ كذمة على الطرف"
                        : "Credit records the balance as receivable/payable"
                      : ar
                        ? "يمكنك تعديل المبلغ لتسجيل دفعة جزئية"
                        : "Adjust to record a partial payment"}
                  </span>
                </label>
              </div>
              <label className="space-y-1.5">
                <span className="text-xs font-semibold text-muted-foreground">
                  {ar ? "ملاحظات الفاتورة" : "Invoice notes"}
                </span>
                <textarea
                  data-form-nav
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={5}
                  placeholder={ar ? "أضف ملاحظة اختيارية…" : "Add an optional note…"}
                  className="w-full resize-y rounded-xl border border-border/80 bg-background px-3 py-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary/25"
                />
              </label>
            </div>
          </div>
        </div>

        <aside className="h-fit space-y-4 xl:sticky xl:top-4">
          <div className="panel-elevated overflow-hidden rounded-2xl">
            <div className="border-b border-border/70 bg-surface-2/30 px-5 py-4">
              <h2 className="font-bold">{ar ? "ملخص الفاتورة" : "Invoice summary"}</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {ar ? "مراجعة المبالغ قبل الإصدار" : "Review totals before posting"}
              </p>
            </div>
            <div className="space-y-3 p-5">
              <SummaryRow
                label={ar ? "عدد الأصناف" : "Line items"}
                value={toSystemDigits(String(cart.length))}
              />
              <SummaryRow label={ar ? "المجموع الفرعي" : "Subtotal"} value={money(subtotal)} />
              <SummaryRow label={ar ? "الضريبة التقديرية" : "Estimated tax"} value={money(tax)} />
              <label className="flex items-center justify-between gap-3 text-sm">
                <span className="text-muted-foreground">{ar ? "الخصم" : "Discount"}</span>
                <AmountInput
                  data-form-nav
                  value={discount ?? 0}
                  onValueChange={setDiscount}
                  className="h-9 w-32 rounded-lg text-end"
                />
              </label>
              <div className="border-t border-border pt-4">
                <div className="flex items-end justify-between gap-3">
                  <span className="text-sm font-semibold">
                    {ar ? "الإجمالي المستحق" : "Amount due"}
                  </span>
                  <strong className="font-mono text-2xl font-black tabular-nums text-primary">
                    {money(total)}
                  </strong>
                </div>
                <p className="mt-1 text-end text-[10px] text-muted-foreground">
                  {ar ? "شامل الضريبة · العملة المحلية" : "Tax included · local currency"}
                </p>
              </div>
              <div className="rounded-xl border border-border/70 bg-surface-2/30 p-3">
                <SummaryRow
                  label={ar ? "المتبقي بعد السداد" : "Balance due"}
                  value={money(Math.max(0, total - (credit ? 0 : (paid ?? total))))}
                  strong
                />
              </div>
            </div>
          </div>
          <div className="panel rounded-2xl p-4">
            <div className="flex items-start gap-2.5">
              <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-emerald-500/10 text-emerald-600">
                <Check className="size-4" />
              </span>
              <div>
                <p className="text-xs font-bold">{ar ? "جاهزة للمراجعة" : "Ready to review"}</p>
                <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                  {ar
                    ? "تأكد من الطرف والمستودع والكميات قبل اعتماد الفاتورة."
                    : "Verify the party, warehouse and quantities before posting."}
                </p>
              </div>
            </div>
          </div>
          <Button
            data-form-nav
            onClick={() => void submit()}
            disabled={saving || loading}
            className="h-12 w-full rounded-xl text-sm font-bold shadow-md shadow-primary/15"
          >
            {saving ? (
              <span className="me-2 size-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
            ) : (
              <Plus className="me-2 size-4" />
            )}
            {sales
              ? ar
                ? "إصدار فاتورة المبيعات"
                : "Post sales invoice"
              : ar
                ? "اعتماد فاتورة المشتريات"
                : "Post purchase invoice"}
          </Button>
          <Button
            variant="ghost"
            onClick={() => void navigate({ to: sales ? "/sales" : "/purchases" })}
            className="w-full rounded-xl text-muted-foreground"
          >
            {ar ? "إلغاء والعودة" : "Cancel and return"}
          </Button>
        </aside>
      </section>
      {sales ? (
        <CustomerFormDialog
          open={partyDialogOpen}
          onClose={() => setPartyDialogOpen(false)}
          onSaved={(record: CustomerRecord) => {
            setParties((current) => [...current.filter((row) => row.id !== record.id), record]);
            setPartyId(record.id);
            setPartyDialogOpen(false);
          }}
          hint={
            ar
              ? "سيتم اختيار العميل الجديد لهذه الفاتورة"
              : "The new customer will be selected for this invoice"
          }
        />
      ) : (
        <SupplierFormDialog
          open={partyDialogOpen}
          onClose={() => setPartyDialogOpen(false)}
          onSaved={(record: SupplierRecord) => {
            setParties((current) => [...current.filter((row) => row.id !== record.id), record]);
            setPartyId(record.id);
            setPartyDialogOpen(false);
          }}
          hint={
            ar
              ? "سيتم اختيار المورد الجديد لهذه الفاتورة"
              : "The new supplier will be selected for this invoice"
          }
        />
      )}
      {savedInvoice && (
        <>
          <OperationSuccessModal
            open={successOpen}
            onClose={() => setSuccessOpen(false)}
            operationId={savedInvoice.id || savedInvoice.number}
            title={ar ? "تم إصدار الفاتورة بنجاح" : "Invoice created successfully"}
            subtitle={`${partyTitle}: ${selectedParty?.name || ""}`}
            amount={savedInvoice.total}
            referenceNumber={savedInvoice.number}
            customer={
              sales && selectedParty
                ? {
                    id: selectedParty.id,
                    name: selectedParty.name,
                    phone: selectedParty.phone,
                    balance: Number(selectedParty.balance ?? 0),
                    creditLimit: selectedParty.credit_limit ?? undefined,
                  }
                : null
            }
            invoice={{
              id: savedInvoice.id,
              invoiceNumber: savedInvoice.number,
              date: new Date().toISOString().slice(0, 10),
              subtotal,
              tax,
              discount: discount ?? 0,
              total: savedInvoice.total,
              paid: savedInvoice.paid,
              remaining: savedInvoice.remaining,
              linesCount: cart.length,
            }}
            eventType="invoice_created"
            onPrint={() => {
              setSuccessOpen(false);
              setPrintOpen(true);
            }}
            onViewDocument={() => {
              setSuccessOpen(false);
              setPrintOpen(true);
            }}
          />
          <LuxuryPrintPreviewModal
            open={printOpen}
            onClose={() => setPrintOpen(false)}
            doc={savedInvoice.doc}
            documentType={sales ? "customer_invoice" : "purchase_invoice"}
            title={ar ? "معاينة وطباعة الفاتورة" : "Invoice print preview"}
            customerPhone={sales ? selectedParty?.phone : undefined}
            customerName={selectedParty?.name}
          />
        </>
      )}
    </div>
  );
}

function SummaryRow({
  label,
  value,
  strong = false,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div
      className={`flex items-center justify-between gap-3 text-sm ${strong ? "font-bold text-foreground" : "text-muted-foreground"}`}
    >
      <span>{label}</span>
      <span className="font-mono tabular-nums">{value}</span>
    </div>
  );
}

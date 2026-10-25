/**
 * /milling/intake — استلام وفواتير (كاونتر المطحنة ونقطة الخدمة الموحدة).
 *
 * العميل + الحبوب + الأكياس + السعة اليدوية + الوزن (يدوي/مقترح)
 * + أجرة الطحن (أكياس × سعر الكيس) + الخصم + طريقة الدفع + المدفوع/الآجل
 * = مستند أمانة واحد + فاتورة مبيعات رسمية في نفس المعاملة الفورية.
 */
import { createFileRoute, useSearch, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, useMemo } from "react";
import {
  Scale,
  CheckCircle2,
  ReceiptText,
  Search,
  FileText,
  Clock,
  Sparkles,
  ChevronLeft,
  X,
  UserPlus,
  Printer,
  Share2,
  Check,
  CreditCard,
  Banknote,
  AlertCircle,
  Phone,
  Wallet,
  RefreshCw,
  ArrowRight,
  Plus,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
import { ModuleGuard } from "@/lib/modules";
import { CustomerFormDialog } from "@/components/contacts/customer-form-dialog";
import { LuxuryPrintPreviewModal } from "@/components/luxury-print-preview-modal";
import { UnifiedPrintModal } from "@/components/milling/unified-print-modal";
import { DocumentShareDialog } from "@/components/communication/document-share-dialog";
import { supabase } from "@/integrations/supabase/client";
import {
  createMillingServiceDocument,
  createMillingServiceDocumentMulti,
  fetchGrainItems,
  fetchServiceItem,
  fetchCustodyBalances,
  fetchMillingServiceDocument,
  fetchMillingDocumentDetails,
  buildMillingDocumentUnifiedDoc,
  type MillingServiceDocumentCreated,
  type ProductOption,
  type MillingServiceDocument,
  type MillingDocumentDetails,
} from "@/lib/milling";
import { PaymentPanel, usePaymentPanel } from "@/components/payments/payment-panel";
import { DynamicPaymentSelector } from "@/components/ui/payment-method/dynamic-payment-selector";
import { useFormNavigationScope } from "@/hooks/use-form-navigation";
import { AmountInput } from "@/components/ui/amount-input";
import { QuantityInput } from "@/components/ui/quantity-input";
import type { PaymentSettlementSelection } from "@/lib/payments/treasury-types";
import {
  getPaymentMethodDefinition,
  toLegacyPaymentValue,
  paymentMethodLabel,
} from "@/lib/payments/payment-methods";
import { MillingDocumentWorkflow } from "@/components/milling/milling-document-workflow";
import {
  MillingPanel,
  MillingSectionTitle,
  MillingField,
  MillingInput,
  MillingSelect,
  MillingTextarea,
  Pill,
  Mono,
  MillingEmpty,
  fmtNum,
} from "@/components/milling/milling-ui";
import { getCompanyCurrencySymbol } from "@/lib/format";
import type { UnifiedDocumentData } from "@/lib/templates/types";

export const Route = createFileRoute("/_app/milling/intake")({
  validateSearch: (search: Record<string, unknown>): { docId?: string } => ({
    docId: typeof search.docId === "string" ? search.docId : undefined,
  }),
  head: () => ({ meta: [{ title: "استلام وفواتير — فورتكس ERP" }] }),
  component: MillingIntakePage,
});

interface CustomerOption {
  id: string;
  name: string;
  phone?: string | null;
  balance?: number | null;
}

interface WarehouseOption {
  id: string;
  name_ar: string | null;
  name: string;
  is_default?: boolean;
}

const PRESET_CAPACITIES = [50, 40, 25, 20, 10];

function MillingIntakePage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { docId: initialDocId } = useSearch({ from: "/_app/milling/intake" });

  const currencySymbol = useMemo(() => getCompanyCurrencySymbol(), []);
  const formScopeRef = useFormNavigationScope<HTMLDivElement>();

  // الحقول الأساسية — تبدأ فارغة لتفادي إزعاج الـ 0
  const [customerId, setCustomerId] = useState("");
  const [quickCustomerOpen, setQuickCustomerOpen] = useState(false);
  const [warehouseId, setWarehouseId] = useState("");
  const [notes, setNotes] = useState("");

  /**
   * أسطر الاستلام: نوع حبوب مستقل لكل سطر (بر 50كجم ×10 + بر 25كجم ×10 + ...)
   * كل سطر: صنف + سعة الكيس + الأكياس + الوزن (محسوب آلياً من السعة).
   */
  const [lines, setLines] = useState<
    { itemId: string; capacityKg: string; bags: string; kg: string; kgAuto: boolean }[]
  >([{ itemId: "", capacityKg: "50", bags: "", kg: "", kgAuto: true }]);

  // الفاتورة والمالية
  const [feePerBag, setFeePerBag] = useState<string>("");
  const [servicePrice, setServicePrice] = useState("");
  const [discount, setDiscount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [settlement, setSettlement] = useState<PaymentSettlementSelection>({
    method: "cash",
    paymentMethodId: "cash",
  });
  const [paid, setPaid] = useState("");

  // المستند والطباعة
  const [createdDocument, setCreatedDocument] = useState<MillingServiceDocumentCreated | null>(
    null,
  );
  const [activeDetails, setActiveDetails] = useState<MillingDocumentDetails | null>(null);
  const [printDoc, setPrintDoc] = useState<UnifiedDocumentData | null>(null);
  const [printModalOpen, setPrintModalOpen] = useState(false);
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [showWorkflow, setShowWorkflow] = useState(false);

  // استعلام العملاء مع الهاتف والرصيد
  const customers = useQuery({
    queryKey: ["milling", "customers"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("customers")
        .select("id, name, phone, balance")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return (data ?? []) as CustomerOption[];
    },
  });

  const selectedCustomer = useMemo(
    () => (customers.data ?? []).find((c) => c.id === customerId),
    [customers.data, customerId],
  );

  // استعلام المستودعات
  const warehouses = useQuery({
    queryKey: ["milling", "warehouses"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("warehouses")
        .select("id, name, name_ar, is_default")
        .eq("is_active", true)
        .order("is_default", { ascending: false });
      if (error) throw error;
      return (data ?? []) as WarehouseOption[];
    },
  });

  // تحديد المستودع الافتراضي تلقائياً
  useEffect(() => {
    if (warehouseId) return;
    const list = warehouses.data ?? [];
    const preferred = list.find((w) => w.is_default) ?? list[0];
    if (preferred) setWarehouseId(preferred.id);
  }, [warehouses.data, warehouseId]);

  // استعلام أصناف الحبوب الخام
  const grainItems = useQuery({
    queryKey: ["milling", "grain-items"],
    queryFn: fetchGrainItems,
  });

  // استعلام صنف خدمة أجور الطحن
  const serviceItem = useQuery({
    queryKey: ["milling", "service-item"],
    queryFn: fetchServiceItem,
  });

  // ضبط السعر الافتراضي لطحن الكيس من صنف الخدمة
  useEffect(() => {
    if (!feePerBag && serviceItem.data) {
      const defaultRate = String(serviceItem.data.sale_price || 1000);
      setFeePerBag(defaultRate);
    }
  }, [serviceItem.data, feePerBag]);

  // رصيد أمانات العميل
  const balances = useQuery({
    queryKey: ["milling", "balances", customerId, warehouseId],
    queryFn: () => fetchCustodyBalances(customerId || undefined, warehouseId || undefined),
    enabled: Boolean(customerId && warehouseId),
  });

  // فتح مستند تلقائياً إذا كان ممرراً عبر الرابط ?docId=
  const loadedDocQuery = useQuery({
    queryKey: ["milling", "single-doc", initialDocId],
    queryFn: () => (initialDocId ? fetchMillingDocumentDetails(initialDocId) : null),
    enabled: Boolean(initialDocId),
  });

  useEffect(() => {
    if (loadedDocQuery.data) {
      const d = loadedDocQuery.data;
      setCreatedDocument({
        document_id: d.id,
        document_number: d.document_number,
        invoice_id: d.sales_invoice_id,
        invoice_number: d.sales_invoices?.invoice_number || "—",
      });
      setActiveDetails(d);
      setPrintDoc(buildMillingDocumentUnifiedDoc(d, "intake"));
    }
  }, [loadedDocQuery.data]);

  // احتساب الإجمالي التلقائي للأكياس والوزن وسعر الخدمة
  // ─ أدوات أسطر الاستلام (تعدد أنواع الحبوب في عملية واحدة) ─
  function updateLine(
    idx: number,
    patch: Partial<{
      itemId: string;
      capacityKg: string;
      bags: string;
      kg: string;
      kgAuto: boolean;
    }>,
  ) {
    setLines((ls) => ls.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  }

  function addLine() {
    setLines((ls) => [...ls, { itemId: "", capacityKg: "50", bags: "", kg: "", kgAuto: true }]);
  }

  function removeLine(idx: number) {
    setLines((ls) => (ls.length > 1 ? ls.filter((_, i) => i !== idx) : ls));
  }

  /** اختيار سعة الكيس لسطر: يعيد حساب الوزن آلياً */
  function setLineCapacity(idx: number, cap: string) {
    const line = lines[idx];
    const b = Number(line.bags) || 0;
    const c = Number(cap) || 0;
    updateLine(idx, {
      capacityKg: cap,
      kg: b > 0 && c > 0 ? String(b * c) : line.kg,
      kgAuto: true,
    });
  }

  /** تغيير الأكياس لسطر: وزن آلي + إعادة حساب أجور الخدمة */
  function setLineBags(idx: number, v: string) {
    const line = lines[idx];
    const b = Number(v) || 0;
    const c = Number(line.capacityKg) || 0;
    // أي تعديل على الكميات يلغي أي تجاوز يدوي سابق لإجمالي الأجور
    setServicePrice("");
    updateLine(idx, {
      bags: v,
      kg: c > 0 ? (b > 0 ? String(b * c) : "") : line.kg,
      kgAuto: true,
    });
  }

  /** تعديل الوزن يدوياً لسطر */
  function setLineKg(idx: number, v: string) {
    updateLine(idx, { kg: v, kgAuto: false });
  }

  // إجماليات العملية (كل الأسطر) — الأكياس والوزن
  const totalBags = useMemo(() => lines.reduce((s, l) => s + (Number(l.bags) || 0), 0), [lines]);
  const totalKg = useMemo(() => lines.reduce((s, l) => s + (Number(l.kg) || 0), 0), [lines]);

  // الحسابات المالية اللحظية (نمط الكاشير POS) — الإجمالي على مستوى العملية
  const bagCount = totalBags;
  const currentSubtotal = useMemo(() => {
    if (servicePrice !== "") return Number(servicePrice) || 0;
    const rate = Number(feePerBag) || 0;
    return bagCount > 0 ? bagCount * rate : 0;
  }, [servicePrice, feePerBag, bagCount]);

  const currentDiscount = Number(discount) || 0;
  const grandTotal = Math.max(0, currentSubtotal - currentDiscount);

  const payment = usePaymentPanel({
    total: grandTotal,
    state: { method: paymentMethod, paidRaw: paid, customerId },
    customers: customers.data ?? [],
  });
  const isCredit = payment.isCredit;
  const currentPaid = payment.paid;
  const remainingDue = payment.remaining;

  // مساعدة سريعة لتسديد كامل المبلغ أو جعله آجلاً
  function handlePayFull() {
    setPaid(String(grandTotal));
    if (paymentMethod === "credit") setPaymentMethod("cash");
  }

  function handleSetFullCredit() {
    setPaymentMethod("credit");
    setPaid("");
  }

  const isOverpaid = !isCredit && currentPaid > grandTotal;

  const canSubmit = Boolean(
    customerId &&
    warehouseId &&
    Boolean(serviceItem.data?.id) &&
    lines.some((l) => l.itemId && ((Number(l.bags) || 0) > 0 || (Number(l.kg) || 0) > 0)) &&
    payment.isPayable,
  );

  const submit = useMutation({
    mutationFn: async () => {
      if (!payment.isPayable) throw new Error(payment.blockingReason ?? "بيانات الدفع غير صالحة.");
      return createMillingServiceDocumentMulti({
        customerId,
        warehouseId,
        grains: lines
          .filter((l) => l.itemId && ((Number(l.bags) || 0) > 0 || (Number(l.kg) || 0) > 0))
          .map((l) => ({
            itemId: l.itemId,
            bags: Number(l.bags) || 0,
            kg: Number(l.kg) || 0,
          })),
        serviceItemId: serviceItem.data?.id ?? "",
        serviceTotal: currentSubtotal,
        discount: currentDiscount,
        paymentMethod: toLegacyPaymentValue(paymentMethod),
        paid: currentPaid,
        notes: notes.trim() || undefined,
      });
    },
    onSuccess: async (res) => {
      if (!res.ok) {
        toast.error(res.message || "تعذر تسجيل الاستلام.");
        return;
      }
      const created = res.data ?? null;
      setCreatedDocument(created);
      toast.success("تم تسجيل الاستلام وإصدار الفاتورة الرسمية بنجاح.");

      // تحميل التفاصيل فوراً لتجهيز الفاتورة الفاخرة للطباعة والمشاركة
      if (created?.document_id) {
        try {
          const details = await fetchMillingDocumentDetails(created.document_id);
          if (details) {
            setActiveDetails(details);
            const uDoc = buildMillingDocumentUnifiedDoc(details, "intake");
            setPrintDoc(uDoc);
            // فتح نافذة المعاينة والطباعة الفاخرة تلقائياً للسرعة
            setPrintModalOpen(true);
          }
        } catch (e) {
          console.error("Failed to load details for printing:", e);
        }
      }

      // تفريغ حقول العملية لتجهيز الاستلام التالي
      setLines([{ itemId: "", capacityKg: "50", bags: "", kg: "", kgAuto: true }]);
      setNotes("");
      setPaid("");
      setDiscount("");

      void qc.invalidateQueries({ queryKey: ["milling"] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "خطأ غير متوقع"),
  });

  // إعادة ضبط الكاونتر لاستلام جديد
  function handleResetCounter() {
    setCreatedDocument(null);
    setActiveDetails(null);
    setPrintDoc(null);
    setShowWorkflow(false);
    setLines([{ itemId: "", capacityKg: "50", bags: "", kg: "", kgAuto: true }]);
    setNotes("");
    setPaid("");
    setDiscount("");
  }

  return (
    <ModuleGuard moduleId="milling_operations">
      <div className="mx-auto max-w-7xl space-y-2.5 p-2 sm:p-3">
        {/* شريط العنوان المدمج لرفع المكونات للأعلى وإلغاء الفراغ */}
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-border/70 bg-surface/90 px-3.5 py-2 shadow-2xs">
          <div>
            <h1 className="text-sm sm:text-base font-extrabold tracking-tight text-foreground flex items-center gap-2">
              <Scale className="h-4.5 w-4.5 text-primary" />
              <span>استلام الأمانات وفاتورة الأجور</span>
            </h1>
            <p className="text-[11px] text-muted-foreground">
              استلام عدة أنواع حبوب في سند واحد مع فاتورة أجور رسمية موحدة ومحاسبة تلقائية.
            </p>
          </div>
        </div>

        {/* شريط الإشعار بالعملية النشطة بعد الحفظ أو الفتح */}
        {createdDocument && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-emerald-500 text-white shadow-xs">
                <CheckCircle2 className="h-5 w-5" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-bold text-foreground">
                    تم إنشاء المستند وفاتورة الخدمة بنجاح
                  </h3>
                  <span className="rounded-md bg-emerald-600/20 px-2 py-0.5 text-[11px] font-bold text-emerald-700 dark:text-emerald-300">
                    رسمي
                  </span>
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                  <span>
                    مستند الأمانة:{" "}
                    <Mono className="font-bold text-foreground">
                      {createdDocument.document_number}
                    </Mono>
                  </span>
                  <span>•</span>
                  <span>
                    الفاتورة الرسمية:{" "}
                    <Mono className="font-bold text-foreground">
                      #{createdDocument.invoice_number}
                    </Mono>
                  </span>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setPrintModalOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-3.5 py-2 text-xs font-bold text-primary-foreground shadow-xs transition hover:bg-primary/90"
              >
                <Printer className="h-4 w-4" />
                معاينة وطباعة سند الاستلام وفاتورة الأجور
              </button>

              <button
                type="button"
                onClick={() => setShareDialogOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-card px-3 py-2 text-xs font-bold text-foreground shadow-xs transition hover:bg-muted"
              >
                <Share2 className="h-4 w-4 text-emerald-600" />
                مشاركة واتساب
              </button>

              <button
                type="button"
                onClick={() => setShowWorkflow(!showWorkflow)}
                className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-card px-3 py-2 text-xs font-bold text-foreground shadow-xs transition hover:bg-muted"
              >
                <Clock className="h-4 w-4 text-amber-500" />
                {showWorkflow ? "إخفاء مسار الطحن" : "متابعة الطحن والتسليم"}
              </button>

              <button
                type="button"
                onClick={handleResetCounter}
                className="inline-flex items-center gap-1.5 rounded-xl border border-border/80 bg-muted/60 px-3 py-2 text-xs font-semibold text-muted-foreground transition hover:bg-muted hover:text-foreground"
                title="تفريغ الكاونتر وبدء استلام جديد"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                استلام جديد
              </button>
            </div>
          </div>
        )}

        {/* مسار الطحن والتسليم التكميلي عند الطلب */}
        {createdDocument && showWorkflow && (
          <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
            <MillingDocumentWorkflow
              document={createdDocument}
              onClose={() => setShowWorkflow(false)}
            />
          </div>
        )}

        {/* الكاونتر الرئيسي: شبكة استلام وحبوب (يمين) + سلة فواتير ودفع كاشير (يسار) */}
        <div className="grid gap-4 lg:grid-cols-12">
          {/* الجانب الأيمن: بيانات الاستلام وحبوب العميل (7 أعمدة) */}
          <MillingPanel className="lg:col-span-7">
            <MillingSectionTitle
              icon={<Scale className="h-4 w-4" />}
              title="بيانات استلام حبوب العميل"
              subtitle="تسجيل الأمانة العينية بدقة الأكياس والسعة والوزن التلقائي."
            />

            <div className="space-y-4 p-4">
              {/* العميل والمستودع */}
              <div className="grid gap-3 sm:grid-cols-2">
                <MillingField label="صاحب الأمانة / العميل *">
                  <div className="flex items-center gap-1.5">
                    <MillingSelect
                      value={customerId}
                      onChange={(e) => setCustomerId(e.target.value)}
                      className="flex-1 font-medium"
                    >
                      <option value="">اختر العميل…</option>
                      {(customers.data ?? []).map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name} {c.phone ? `(${c.phone})` : ""}
                        </option>
                      ))}
                    </MillingSelect>
                    <button
                      type="button"
                      onClick={() => setQuickCustomerOpen(true)}
                      className="inline-flex shrink-0 items-center gap-1 rounded-xl border border-primary/30 bg-primary/10 px-3 py-2 text-xs font-bold text-primary shadow-xs transition hover:bg-primary/20"
                      title="إضافة عميل جديد سريعاً دون مغادرة الكاونتر"
                    >
                      <UserPlus className="h-3.5 w-3.5" />
                      <span>جديد</span>
                    </button>
                  </div>
                </MillingField>

                <MillingField
                  label="المستودع *"
                  hint="المستودع الافتراضي محدد تلقائياً — بدّله عند الحاجة."
                >
                  <MillingSelect
                    value={warehouseId}
                    onChange={(e) => setWarehouseId(e.target.value)}
                  >
                    <option value="">اختر المستودع…</option>
                    {(warehouses.data ?? []).map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name_ar || w.name} {w.is_default ? "(الافتراضي)" : ""}
                      </option>
                    ))}
                  </MillingSelect>
                </MillingField>
              </div>

              {/* بطاقة معلومات العميل المختار (هاتف ورصيد حالي) */}
              {selectedCustomer && (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border/80 bg-surface-2/60 px-3.5 py-2 text-xs">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-foreground">{selectedCustomer.name}</span>
                    {selectedCustomer.phone && (
                      <span className="flex items-center gap-1 text-muted-foreground">
                        <Phone className="h-3 w-3 text-muted-foreground" />
                        <Mono className="[direction:ltr]">{selectedCustomer.phone}</Mono>
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-muted-foreground">رصيد الحساب المالي:</span>
                    <span
                      className={`font-bold tabular-nums ${
                        Number(selectedCustomer.balance ?? 0) > 0
                          ? "text-rose-600 dark:text-rose-400"
                          : "text-emerald-600 dark:text-emerald-400"
                      }`}
                    >
                      {fmtNum(Math.abs(Number(selectedCustomer.balance ?? 0)))} {currencySymbol}
                      {Number(selectedCustomer.balance ?? 0) > 0 ? " (عليه)" : " (له/خالص)"}
                    </span>
                  </div>
                </div>
              )}

              {/* أسطر الحبوب المستلمة — صنف مستقل لكل سطر */}
              <div className="space-y-2.5 rounded-2xl border border-border/80 bg-surface-2/30 p-3.5">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="text-xs font-bold text-foreground">أنواع الحبوب المستلمة</h4>
                    <p className="text-[11px] text-muted-foreground">
                      لكل نوع حبوب سطر مستقل: اختر الصنف، حدد السعة، ثم عدد الأكياس — الوزن يُحسب
                      آلياً.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={addLine}
                    className="inline-flex items-center gap-1 rounded-xl border border-primary/30 bg-primary/10 px-2.5 py-1 text-xs font-bold text-primary shadow-xs hover:bg-primary/20"
                  >
                    <Plus className="h-3.5 w-3.5" /> نوع حبوب آخر
                  </button>
                </div>

                {lines.map((line, idx) => (
                  <div
                    key={idx}
                    className="space-y-2 rounded-xl border border-border/70 bg-card/70 p-3"
                  >
                    <div className="grid grid-cols-[1fr_auto] items-center gap-2">
                      <MillingSelect
                        value={line.itemId}
                        onChange={(e) => updateLine(idx, { itemId: e.target.value })}
                        className="font-bold text-xs"
                      >
                        <option value="">اختر نوع الحبوب…</option>
                        {(grainItems.data ?? []).map((g: ProductOption) => (
                          <option key={g.id} value={g.id}>
                            {g.name_ar || g.name}
                          </option>
                        ))}
                      </MillingSelect>
                      <button
                        type="button"
                        disabled={lines.length === 1}
                        onClick={() => removeLine(idx)}
                        className="grid h-8 w-8 place-items-center rounded-lg text-rose-500 hover:bg-rose-500/10 disabled:opacity-30"
                        aria-label="حذف السطر"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>

                    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 items-center">
                      <div>
                        <span className="block text-[11px] font-semibold text-muted-foreground mb-1">
                          سعة الكيس:
                        </span>
                        <div className="flex items-center gap-1">
                          {PRESET_CAPACITIES.slice(0, 4).map((cap) => (
                            <button
                              key={cap}
                              type="button"
                              onClick={() => setLineCapacity(idx, String(cap))}
                              className={`rounded-lg px-2 py-1 text-[11px] font-bold transition ${
                                Number(line.capacityKg) === cap
                                  ? "bg-amber-500 text-white"
                                  : "border border-border bg-surface-2 hover:bg-muted"
                              }`}
                            >
                              {cap}
                            </button>
                          ))}
                          <QuantityInput
                            min={0}
                            decimals={1}
                            unit="kg"
                            placeholder="سعة"
                            aria-label="سعة الكيس المخصصة (كجم)"
                            value={line.capacityKg === "" ? null : Number(line.capacityKg)}
                            onValueChange={(v) => setLineCapacity(idx, v == null ? "" : String(v))}
                            className="w-20 font-bold text-[11px]"
                          />
                        </div>
                      </div>

                      <div>
                        <span className="block text-[11px] font-semibold text-muted-foreground mb-1">
                          عدد الأكياس:
                        </span>
                        <QuantityInput
                          min={0}
                          decimals={0}
                          placeholder="0"
                          aria-label="عدد الأكياس"
                          value={line.bags === "" ? null : Number(line.bags)}
                          onValueChange={(v) => setLineBags(idx, v == null ? "" : String(v))}
                          className="font-black text-primary"
                        />
                      </div>

                      <div className="col-span-2">
                        <span className="block text-[11px] font-semibold text-muted-foreground mb-1">
                          الوزن الإجمالي (كجم):
                        </span>
                        <QuantityInput
                          min={0}
                          decimals={2}
                          unit="kg"
                          placeholder="0.00"
                          aria-label="الوزن الإجمالي (كجم)"
                          value={line.kg === "" ? null : Number(line.kg)}
                          onValueChange={(v) => setLineKg(idx, v == null ? "" : String(v))}
                          className="font-bold"
                        />
                        {line.kgAuto && Number(line.bags) > 0 && Number(line.capacityKg) > 0 && (
                          <div className="mt-1 flex items-center gap-1 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
                            <CheckCircle2 className="h-3 w-3 shrink-0" />
                            {line.bags} كيس × {line.capacityKg} كجم = {fmtNum(Number(line.kg))} كجم
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}

                {/* شريط إجماليات الاستلام */}
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-muted/60 p-3 text-xs">
                  <div className="flex items-center gap-3">
                    <span>
                      أنواع الحبوب:{" "}
                      <strong className="text-foreground">
                        {lines.filter((l) => l.itemId).length}
                      </strong>
                    </span>
                    <span>•</span>
                    <span>
                      إجمالي الأكياس:{" "}
                      <strong className="text-foreground">{fmtNum(totalBags)}</strong>
                    </span>
                    <span>•</span>
                    <span>
                      إجمالي الوزن: <strong className="text-foreground">{fmtNum(totalKg)}</strong>{" "}
                      كجم
                    </span>
                  </div>
                  <span className="text-[11px] text-muted-foreground">
                    أجور الطحن تُحتسب على إجمالي الأكياس للعملية كلها
                  </span>
                </div>
              </div>

              {/* ملاحظات الاستلام */}
              <MillingField
                label="ملاحظات الاستلام"
                hint="اختيارية — رقم الشاحنة/القاطبة، اسم السائق، أو أي تفاصيل خاصة بالدفعة."
              >
                <MillingInput
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="مثال: شاحنة نقل رقم 4589 — تفريغ مستعجل"
                />
              </MillingField>

              {/* رصيد أمانات العميل المتبقي في هذا المخزن */}
              {customerId && warehouseId && (
                <div className="rounded-xl border border-border/80 bg-muted/30 p-3 space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-bold text-foreground">
                      رصيد أمانات العميل الحالي في هذا المستودع:
                    </span>
                    <span className="text-[11px] text-muted-foreground">مشتق من حركات السجل</span>
                  </div>
                  {(balances.data ?? []).filter((b) => b.bags_balance > 0 || b.kg_balance > 0)
                    .length === 0 ? (
                    <p className="text-xs text-muted-foreground italic">
                      لا يوجد رصيد أمانات سابق للعميل حالياً (أول استلام).
                    </p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {(balances.data ?? [])
                        .filter((b) => b.bags_balance > 0 || b.kg_balance > 0)
                        .map((b) => (
                          <div
                            key={b.item_id}
                            className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-2.5 py-1 text-xs"
                          >
                            <span className="font-semibold text-foreground">{b.name_ar}:</span>
                            <span className="font-bold text-primary">
                              {fmtNum(b.bags_balance)} كيس
                            </span>
                            <span className="text-muted-foreground">
                              ({fmtNum(b.kg_balance)} كجم)
                            </span>
                          </div>
                        ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </MillingPanel>

          {/* الجانب الأيسر: سلة الفاتورة والدفع بنمط الكاشير POS (5 أعمدة) */}
          <MillingPanel className="lg:col-span-5 flex flex-col justify-between">
            <div>
              <MillingSectionTitle
                icon={<ReceiptText className="h-4 w-4" />}
                title="فاتورة أجور الخدمة"
                subtitle="فاتورة مبيعات رسمية تُصدر وتُرحل آلياً مع المعاملة."
                action={
                  <span className="rounded-full bg-amber-500/10 px-2.5 py-1 text-[11px] font-bold text-amber-700 dark:text-amber-300">
                    كاونتر فوري
                  </span>
                }
              />

              <div className="space-y-4 p-4">
                {/* بند الخدمة وحساب سعر الكيس */}
                <div className="rounded-2xl border border-amber-500/25 bg-amber-500/5 p-3.5 space-y-3">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">بند الخدمة المعتمد:</span>
                    <span className="font-bold text-foreground">
                      {serviceItem.data?.name_ar || serviceItem.data?.name || "أجور طحن وتجهيز"}
                    </span>
                  </div>

                  {/* احتساب أجر الكيس × عدد الأكياس */}
                  <div className="grid gap-2.5 sm:grid-cols-2">
                    <MillingField label="أجر طحن الكيس الواحد" hint="سعر خدمة طحن الكيس الواحد">
                      {/* أجر الكيس سعر وحدة داخل الحساب — التفقيط يظهر مرة واحدة
                          تحت إجمالي أجور الخدمة أسفله، لا نكرره في الحقلين. */}
                      <AmountInput
                        min={0}
                        showInWords={false}
                        placeholder="1000"
                        aria-label="أجر طحن الكيس الواحد"
                        value={feePerBag === "" ? null : Number(feePerBag)}
                        onValueChange={(v) => setFeePerBag(v == null ? "" : String(v))}
                        className="font-bold"
                      />
                    </MillingField>

                    <MillingField
                      label="إجمالي أجور الخدمة"
                      hint={
                        bagCount > 0
                          ? `${bagCount} كيس × ${feePerBag || 0} = ${fmtNum(currentSubtotal)}`
                          : "المبلغ الإجمالي للخدمة"
                      }
                    >
                      <AmountInput
                        min={0}
                        placeholder="0.00"
                        aria-label="إجمالي أجور الخدمة"
                        value={currentSubtotal === 0 ? null : currentSubtotal}
                        onValueChange={(v) => setServicePrice(v == null ? "" : String(v))}
                        className="font-black text-amber-600 dark:text-amber-400"
                      />
                    </MillingField>
                  </div>

                  {/* ملخص عملية الحساب الذكية */}
                  {bagCount > 0 && Number(feePerBag) > 0 && (
                    <div className="flex items-center justify-between rounded-xl bg-background/80 px-3 py-2 text-xs font-semibold text-foreground border border-border/60">
                      <span className="text-muted-foreground">حسبة الخدمة:</span>
                      <div className="flex items-center gap-1.5">
                        <span className="font-bold text-foreground">{bagCount} كيس</span>
                        <span>×</span>
                        <span className="font-bold">{fmtNum(Number(feePerBag))}</span>
                        <span>=</span>
                        <span className="font-black text-amber-600 dark:text-amber-400 text-sm">
                          {fmtNum(currentSubtotal)} {currencySymbol}
                        </span>
                      </div>
                    </div>
                  )}
                </div>

                {/* الخصم الإجمالي */}
                <MillingField label="الخصم (إن وجد)">
                  <AmountInput
                    min={0}
                    placeholder="0.00"
                    aria-label="الخصم"
                    value={discount === "" ? null : Number(discount)}
                    onValueChange={(v) => setDiscount(v == null ? "" : String(v))}
                    className="font-medium"
                  />
                </MillingField>

                {/* بطاقة الصافي الإجمالي المميزة */}
                <div className="rounded-2xl bg-gradient-to-br from-primary/15 via-primary/5 to-surface-2 border border-primary/25 p-4 text-center">
                  <span className="text-xs font-semibold text-muted-foreground">
                    صافي الفاتورة الإجمالي
                  </span>
                  <div className="mt-1 flex items-baseline justify-center gap-1.5">
                    <span className="text-3xl font-black tabular-nums text-foreground">
                      {fmtNum(grandTotal)}
                    </span>
                    <span className="text-sm font-bold text-muted-foreground">
                      {currencySymbol}
                    </span>
                  </div>
                </div>

                {/* طريقة الدفع بنمط الكاشير */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-semibold text-muted-foreground">
                      طريقة السداد *
                    </label>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={handlePayFull}
                        className="rounded-lg bg-emerald-500/10 px-2 py-0.5 text-[11px] font-bold text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/20"
                      >
                        سداد كامل
                      </button>
                      <button
                        type="button"
                        onClick={handleSetFullCredit}
                        className="rounded-lg bg-purple-500/10 px-2 py-0.5 text-[11px] font-bold text-purple-700 dark:text-purple-300 hover:bg-purple-500/20"
                      >
                        آجل بالكامل
                      </button>
                    </div>
                  </div>

                  <DynamicPaymentSelector
                    context="sales"
                    value={paymentMethod}
                    onChange={(method) => {
                      setPaymentMethod(method);
                      if (getPaymentMethodDefinition(method)?.isCreditTerm) {
                        setPaid("");
                      }
                    }}
                    settlement={settlement}
                    onSettlementChange={setSettlement}
                    includeCredit
                    compact
                  />
                </div>

                {/* المدفوع والمتبقي */}
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-semibold text-muted-foreground">
                        المبلغ المستلم (المدفوع)
                      </label>
                      {!isCredit && grandTotal > 0 && (
                        <button
                          type="button"
                          onClick={handlePayFull}
                          className="rounded-lg bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/20"
                        >
                          تعبئة كامل المبلغ
                        </button>
                      )}
                    </div>
                    <div className="relative">
                      <AmountInput
                        min={0}
                        disabled={isCredit}
                        placeholder="0.00"
                        aria-label="المبلغ المستلم (المدفوع)"
                        value={isCredit ? null : paid === "" ? null : Number(paid)}
                        onValueChange={(v) => setPaid(v == null ? "" : String(v))}
                        className={`font-bold ${
                          isCredit
                            ? "cursor-not-allowed opacity-60"
                            : isOverpaid
                              ? "border-rose-500 text-rose-600 bg-rose-500/5"
                              : "text-emerald-600"
                        }`}
                      />
                    </div>
                    <span className="text-[11px] text-muted-foreground block">
                      {isCredit ? "معطّل لأن الطريقة آجلة" : "المبلغ المستلم كاش أو شبكة"}
                    </span>
                  </div>

                  <div className="space-y-1.5">
                    <label className="block text-xs font-semibold text-muted-foreground">
                      المتبقي كذمة آجلة
                    </label>
                    <div className="flex h-10 w-full items-center justify-between rounded-xl border border-border/80 bg-surface-2/70 px-3">
                      <span className="text-xs text-muted-foreground">المتبقي:</span>
                      <span
                        className={`text-sm font-black tabular-nums ${
                          remainingDue > 0
                            ? "text-rose-600 dark:text-rose-400"
                            : "text-emerald-600 dark:text-emerald-400"
                        }`}
                      >
                        {fmtNum(remainingDue)} {currencySymbol}
                      </span>
                    </div>
                    {remainingDue > 0 && (
                      <p className="text-[11px] font-semibold text-amber-600 dark:text-amber-400">
                        {selectedCustomer ? (
                          <>
                            سيرحل كذمة رسمية على حساب العميل:{" "}
                            <strong>{selectedCustomer.name}</strong>
                          </>
                        ) : (
                          "يجب اختيار عميل مسجل لتقييد الذمة الآجلة."
                        )}
                      </p>
                    )}
                  </div>
                </div>

                {/* تنبيه الخطأ في حال كان المدفوع أكبر من إجمالي الفاتورة */}
                {isOverpaid && (
                  <div className="flex items-center gap-2 rounded-xl bg-rose-500/10 p-3 text-xs font-bold text-rose-600 dark:text-rose-400 border border-rose-500/20">
                    <AlertCircle className="h-4 w-4 shrink-0" />
                    <span>
                      خطأ في الحساب: المبلغ المدفوع ({fmtNum(currentPaid)} {currencySymbol}) أكبر من
                      صافي الفاتورة المطلوبة ({fmtNum(grandTotal)} {currencySymbol})! يرجى تصحيح
                      المبلغ للمتابعة.
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* زر الاعتماد الكبير في أسفل بطاقة الكاشير */}
            <div className="p-4 border-t border-border/70">
              <button
                type="button"
                disabled={!canSubmit || submit.isPending}
                onClick={() => submit.mutate()}
                className="w-full inline-flex items-center justify-center gap-2 rounded-2xl bg-amber-500 py-3.5 px-4 text-sm font-black text-white shadow-md transition hover:bg-amber-600 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {submit.isPending ? (
                  <>
                    <RefreshCw className="h-4 w-4 animate-spin" />
                    جارٍ إصدار الفاتورة وتأكيد الاستلام…
                  </>
                ) : (
                  <>
                    <Check className="h-5 w-5" />
                    تسجيل الاستلام وإصدار الفاتورة الرسمية
                  </>
                )}
              </button>
            </div>
          </MillingPanel>
        </div>

        {/* سند الاستلام وفاتورة الأجور — القالب الموحد المعتمد */}
        {(activeDetails || printDoc) && (
          <UnifiedPrintModal
            open={printModalOpen}
            onClose={() => setPrintModalOpen(false)}
            details={activeDetails}
            doc={printDoc}
            stage="intake"
          />
        )}

        {/* نافذة المشاركة الفورية عبر واتساب */}
        <DocumentShareDialog
          open={shareDialogOpen}
          onClose={() => setShareDialogOpen(false)}
          title="مشاركة سند الاستلام وفاتورة الأجور"
          documentType="milling_document"
          millingDocumentNumber={createdDocument?.document_number || ""}
          customer={
            selectedCustomer
              ? {
                  id: selectedCustomer.id,
                  name: selectedCustomer.name,
                  phone: selectedCustomer.phone || undefined,
                  balance: Number(selectedCustomer.balance ?? 0),
                }
              : activeDetails?.customers
                ? {
                    id: activeDetails.customer_id,
                    name: activeDetails.customers.name,
                    phone: activeDetails.customers.phone || undefined,
                    balance: 0,
                  }
                : undefined
          }
          invoice={
            createdDocument?.invoice_number
              ? {
                  id: createdDocument.invoice_id,
                  invoiceNumber: createdDocument.invoice_number,
                  date: new Date().toISOString(),
                  subtotal:
                    currentSubtotal ||
                    Number(activeDetails?.sales_invoices?.subtotal ?? grandTotal),
                  total: grandTotal || Number(activeDetails?.sales_invoices?.total ?? 0),
                  paid: currentPaid || Number(activeDetails?.sales_invoices?.paid ?? 0),
                  remaining: remainingDue,
                  status: remainingDue === 0 ? "paid" : "partial",
                }
              : undefined
          }
        />

        {/* نافذة إضافة عميل جديد سريعاً دون مغادرة الكاونتر */}
        <CustomerFormDialog
          open={quickCustomerOpen}
          onClose={() => setQuickCustomerOpen(false)}
          hint="سيتم اختيار العميل تلقائياً فور حفظه لتكملة الاستلام فوراً."
          onSaved={(newCust) => {
            void qc.invalidateQueries({ queryKey: ["milling", "customers"] });
            setCustomerId(newCust.id);
            setQuickCustomerOpen(false);
            toast.success(`تمت إضافة واختيار العميل: ${newCust.name}`);
          }}
        />
      </div>
    </ModuleGuard>
  );
}

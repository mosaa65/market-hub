/**
 * /milling/intake — استلام وفواتير (كاونتر المطحنة ونقطة الخدمة الموحدة).
 *
 * العميل + الحبوب + الأكياس + السعة + الوزن التلقائي
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
  fetchGrainItems,
  fetchServiceItem,
  fetchCustodyBalances,
  fetchMillingServiceDocument,
  fetchMillingDocumentDetails,
  buildMillingDocumentUnifiedDoc,
  capacityKgOf,
  type MillingServiceDocumentCreated,
  type ProductOption,
  type MillingServiceDocument,
  type MillingDocumentDetails,
} from "@/lib/milling";
import { PaymentPanel, usePaymentPanel } from "@/components/payments/payment-panel";
import { useFormNavigationScope } from "@/hooks/use-form-navigation";
import { toLegacyPaymentValue, paymentMethodLabel } from "@/lib/payments/payment-methods";
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
import { translateRpcError } from "@/lib/errors/rpc-errors";
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
  credit_limit?: number | null;
  /** P1-6: the seeded cash customer, which must never carry debt. */
  is_system?: boolean | null;
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

  // الحقول الأساسية — تبدأ فارغة لتفادي إزعاج الـ 0
  // Keyboard-only operation: arrows/Enter walk the intake form and the payment
  // block in reading order, so the counter needs no mouse.
  const formScopeRef = useFormNavigationScope<HTMLDivElement>();
  const [customerId, setCustomerId] = useState("");
  const [quickCustomerOpen, setQuickCustomerOpen] = useState(false);
  const [warehouseId, setWarehouseId] = useState("");
  const [itemId, setItemId] = useState("");
  const [capacityKg, setCapacityKg] = useState<string>("50");
  const [bags, setBags] = useState("");
  const [kg, setKg] = useState("");
  const [kgAuto, setKgAuto] = useState(true);
  const [notes, setNotes] = useState("");

  // الفاتورة والمالية
  const [feePerBag, setFeePerBag] = useState<string>("");
  const [servicePrice, setServicePrice] = useState("");
  const [discount, setDiscount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("cash");
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
        .select("id, name, phone, balance, credit_limit, is_system")
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

  // قائمة العملاء لحساب الدفع المشترك (ذمة/حد ائتمان) — دفعة واحدة.
  const customerList = customers.data ?? [];

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
  const selectedGrainItem = useMemo(
    () => (grainItems.data ?? []).find((g) => g.id === itemId),
    [grainItems.data, itemId],
  );

  // عند تغيير صنف الحبوب: ملء سعة الكيس تلقائياً إن وجدت
  function handleGrainItemChange(newId: string) {
    setItemId(newId);
    const item = (grainItems.data ?? []).find((g) => g.id === newId);
    if (item && item.package_weight_kg && item.package_weight_kg > 0) {
      const capStr = String(item.package_weight_kg);
      setCapacityKg(capStr);
      const bagCount = Number(bags) || 0;
      if (bagCount > 0 && kgAuto) {
        setKg(String(bagCount * item.package_weight_kg));
      }
    }
  }

  // اختيار سعة الكيس من الأزرار السريعة
  function handleSelectCapacity(cap: number) {
    const capStr = String(cap);
    setCapacityKg(capStr);
    const bagCount = Number(bags) || 0;
    if (bagCount > 0 && (kgAuto || kg === "")) {
      setKg(String(bagCount * cap));
      setKgAuto(true);
    }
  }

  // عند تغيير عدد الأكياس (المحدد الأساسي)
  function handleBagsChange(v: string) {
    setBags(v);
    const bagCount = Number(v) || 0;
    const cap = Number(capacityKg) || 0;

    // 1. حساب الوزن الإجمالي تلقائياً
    if (cap > 0 && (kgAuto || kg === "" || Number(kg) === 0)) {
      setKg(bagCount > 0 ? String(bagCount * cap) : "");
      setKgAuto(true);
    }

    // 2. حساب إجمالي خدمة الطحن تلقائياً (أكياس × سعر الكيس)
    const rate = Number(feePerBag) || 0;
    if (rate > 0) {
      const calculatedSubtotal = bagCount > 0 ? bagCount * rate : rate;
      setServicePrice(bagCount > 0 ? String(calculatedSubtotal) : "");
    }
  }

  // عند تعديل سعر طحن الكيس الواحد
  function handleFeePerBagChange(v: string) {
    setFeePerBag(v);
    const rate = Number(v) || 0;
    const bagCount = Number(bags) || 0;
    if (rate > 0) {
      const calculatedSubtotal = bagCount > 0 ? bagCount * rate : rate;
      setServicePrice(String(calculatedSubtotal));
    }
  }

  // عند تعديل الوزن يدوياً
  function handleKgChange(v: string) {
    setKg(v);
    setKgAuto(false);
  }

  // الحسابات المالية اللحظية (نمط الكاشير POS)
  const bagCount = Number(bags) || 0;
  const currentSubtotal = useMemo(() => {
    if (servicePrice !== "") return Number(servicePrice) || 0;
    const rate = Number(feePerBag) || 0;
    return bagCount > 0 ? bagCount * rate : rate;
  }, [servicePrice, feePerBag, bagCount]);

  const currentDiscount = Number(discount) || 0;
  const grandTotal = Math.max(0, currentSubtotal - currentDiscount);

  const isCredit = paymentMethod === "credit";

  // P1-4: the payment arithmetic is the shared panel's — the same rules the
  // till and the invoice form use. Milling no longer has its own copy.
  const payment = usePaymentPanel({
    total: grandTotal,
    state: { method: paymentMethod, paidRaw: paid, customerId },
    customers: customerList,
  });
  const currentPaid = payment.paid;
  const remainingDue = payment.remaining;
  const isOverpaid = payment.isOverpaid;

  const canSubmit = Boolean(
    customerId &&
    warehouseId &&
    itemId &&
    Boolean(serviceItem.data?.id) &&
    (bagCount > 0 || Number(kg) > 0) &&
    payment.isPayable,
  );

  const submit = useMutation({
    mutationFn: async () => {
      // The shared payment rules are also the server's rules — block here with
      // the same sentence instead of letting the RPC fail with a raw error.
      if (!payment.isPayable) {
        throw new Error(payment.blockingReason ?? "بيانات الدفع غير صالحة.");
      }
      return createMillingServiceDocument({
        customerId,
        warehouseId,
        grainItemId: itemId,
        bags: bagCount,
        kg: Number(kg) || 0,
        serviceItemId: serviceItem.data?.id ?? "",
        serviceUnitPrice: currentSubtotal,
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
            // P1-3: الطبع يتبع إعداد الطباعة الموحد (تلقائي / اسأل / إيقاف)
            // لا قرار ثابت داخل الشاشة. «تلقائي» يطبع مباشرة، و«اسأل» يفتح
            // المعاينة، و«إيقاف» لا يفتح شيئاً.
            const { getPrintSettings, printDocument } = await import("@/lib/templates");
            const settings = getPrintSettings();
            if (settings.printMode === "auto") {
              printDocument(
                uDoc,
                settings.defaultCustomerTemplate,
                undefined,
                true,
                undefined,
                settings.defaultCustomerPaperProfile,
              );
            } else if (settings.printMode === "ask") {
              setPrintModalOpen(true);
            }
          }
        } catch (e) {
          console.error("Failed to load details for printing:", e);
        }
      }

      // تفريغ حقول العملية لتجهيز الاستلام التالي
      setItemId("");
      setBags("");
      setKg("");
      setKgAuto(true);
      setNotes("");
      setPaid("");
      setDiscount("");
      setServicePrice("");

      void qc.invalidateQueries({ queryKey: ["milling"] });
    },
    onError: (err) => toast.error(translateRpcError(err, "ar", "خطأ غير متوقع")),
  });

  // إعادة ضبط الكاونتر لاستلام جديد
  function handleResetCounter() {
    setCreatedDocument(null);
    setActiveDetails(null);
    setPrintDoc(null);
    setShowWorkflow(false);
    setItemId("");
    setBags("");
    setKg("");
    setKgAuto(true);
    setNotes("");
    setPaid("");
    setDiscount("");
    setServicePrice("");
  }

  return (
    <ModuleGuard moduleId="milling_operations">
      <div className="mx-auto max-w-7xl space-y-4 p-4">
        {/* شريط العنوان الرسمي */}
        <PageHeader
          title="استلام وفواتير"
          subtitle="تسجيل استلام حبوب العميل وإصدار فاتورة أجور الطحن الرسمية في معاملة واحدة سريعة وموحدة."
        />

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
                معاينة وطباعة الفاتورة الفاخرة
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
        <div ref={formScopeRef} data-form-nav-scope className="grid gap-4 lg:grid-cols-12">
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
                      autoFocus
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

              {/* نوع الحبوب المستلمة */}
              <MillingField
                label="نوع الحبوب المستلمة *"
                hint="قائمة الحبوب الخام المعرفة في النظام — تُملأ سعة العبوة تلقائياً إن وجدت."
              >
                <MillingSelect
                  value={itemId}
                  onChange={(e) => handleGrainItemChange(e.target.value)}
                  className="font-medium"
                >
                  <option value="">اختر نوع الحبوب…</option>
                  {(grainItems.data ?? []).map((g: ProductOption) => (
                    <option key={g.id} value={g.id}>
                      {g.name_ar || g.name}
                      {g.package_weight_kg ? ` — سعة كيس ${g.package_weight_kg} كجم` : ""}
                    </option>
                  ))}
                </MillingSelect>
              </MillingField>

              {/* سعة الكيس (الوحدات المتاحة للاختيار السريع + مخصص) */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-muted-foreground">
                    سعة الكيس / العبوة (كجم)
                  </label>
                  <span className="text-[11px] text-muted-foreground">
                    اختر السعة المتوفرة أو أدخل سعة مخصصة
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {PRESET_CAPACITIES.map((cap) => {
                    const isSelected = Number(capacityKg) === cap;
                    return (
                      <button
                        key={cap}
                        type="button"
                        onClick={() => handleSelectCapacity(cap)}
                        className={`rounded-xl px-3 py-1.5 text-xs font-bold transition ${
                          isSelected
                            ? "bg-amber-500 text-white shadow-xs"
                            : "border border-border bg-surface-2 text-foreground hover:bg-muted"
                        }`}
                      >
                        {cap} كجم
                      </button>
                    );
                  })}
                  <div className="relative ms-auto w-28">
                    <MillingInput
                      type="number"
                      min={1}
                      step="0.5"
                      placeholder="سعة مخصصة"
                      value={capacityKg}
                      onChange={(e) => {
                        setCapacityKg(e.target.value);
                        const n = Number(e.target.value) || 0;
                        const b = Number(bags) || 0;
                        if (n > 0 && b > 0 && kgAuto) {
                          setKg(String(b * n));
                        }
                      }}
                      className="text-center font-bold"
                    />
                    <span className="pointer-events-none absolute start-2 top-2.5 text-[11px] text-muted-foreground">
                      كجم
                    </span>
                  </div>
                </div>
              </div>

              {/* عدد الأكياس والوزن الإجمالي */}
              <div className="grid gap-3 sm:grid-cols-2">
                <MillingField
                  label="عدد الأكياس *"
                  hint="المحدد الأساسي لعمليات الاستلام وأجور الطحن"
                >
                  <MillingInput
                    type="number"
                    min={0}
                    inputMode="numeric"
                    placeholder="0"
                    value={bags}
                    onChange={(e) => handleBagsChange(e.target.value)}
                    className="text-lg font-black text-primary"
                  />
                </MillingField>

                <MillingField
                  label="الوزن الإجمالي (كجم)"
                  hint={
                    Number(capacityKg) > 0
                      ? `محسوب آلياً (${capacityKg} كجم/كيس) — وقابل للتعديل حسب الميزان`
                      : "أدخل الوزن الإجمالي بالكيلوجرام"
                  }
                >
                  <div className="space-y-1">
                    <MillingInput
                      type="number"
                      min={0}
                      step="0.01"
                      inputMode="decimal"
                      placeholder="0.00"
                      value={kg}
                      onChange={(e) => handleKgChange(e.target.value)}
                      className="font-bold"
                    />
                    {kgAuto && Number(bags) > 0 && Number(capacityKg) > 0 && (
                      <div className="flex items-center gap-1 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
                        <CheckCircle2 className="h-3 w-3 shrink-0" />
                        محسوب تلقائياً: {bags} كيس × {capacityKg} كجم = {fmtNum(Number(kg))} كجم
                      </div>
                    )}
                  </div>
                </MillingField>
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
                      <div className="relative">
                        <MillingInput
                          type="number"
                          min={0}
                          step="1"
                          placeholder="1000"
                          value={feePerBag}
                          onChange={(e) => handleFeePerBagChange(e.target.value)}
                          className="font-bold pe-12"
                        />
                        <span className="pointer-events-none absolute end-2.5 top-2.5 text-[11px] text-muted-foreground">
                          {currencySymbol}
                        </span>
                      </div>
                    </MillingField>

                    <MillingField
                      label="إجمالي أجور الخدمة"
                      hint={
                        bagCount > 0
                          ? `${bagCount} كيس × ${feePerBag || 0} = ${fmtNum(currentSubtotal)}`
                          : "المبلغ الإجمالي للخدمة"
                      }
                    >
                      <div className="relative">
                        <MillingInput
                          type="number"
                          min={0}
                          step="1"
                          placeholder="0.00"
                          value={servicePrice}
                          onChange={(e) => setServicePrice(e.target.value)}
                          className="font-black text-amber-600 dark:text-amber-400 pe-12"
                        />
                        <span className="pointer-events-none absolute end-2.5 top-2.5 text-[11px] text-muted-foreground">
                          {currencySymbol}
                        </span>
                      </div>
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
                  <div className="relative">
                    <MillingInput
                      type="number"
                      min={0}
                      step="1"
                      placeholder="0.00"
                      value={discount}
                      onChange={(e) => setDiscount(e.target.value)}
                      className="font-medium pe-12"
                    />
                    <span className="pointer-events-none absolute end-2.5 top-2.5 text-[11px] text-muted-foreground">
                      {currencySymbol}
                    </span>
                  </div>
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

                {/* P1-4: ONE payment block — the same rules as POS and the
                    sales invoice. The panel owns the method picker, the paid
                    field, the remaining line and the debt/customer guards. */}
                <PaymentPanel
                  context="sales"
                  total={grandTotal}
                  method={paymentMethod}
                  onMethodChange={setPaymentMethod}
                  paid={paid}
                  onPaidChange={setPaid}
                  customerId={customerId}
                  customers={customerList}
                  currency={currencySymbol}
                  autoMethod
                />
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

        {/* قالب فاتورة وإيصال المطحنة الأنيق المعتمد والمطابق لقالب الاستلام السريع */}
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
          title="مشاركة الفاتورة وسند الاستلام"
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
                  date: new Date().toLocaleDateString("ar-YE"),
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

/**
 * /milling/delivery — واجهة تسليم الأمانات ونواتج الطحن الفاخرة.
 *
 * رصيد العميل العيني → إدخال الكميات المسلمة (دفعات أو كاملة) → أسطر DELIVERY في custody_ledger.
 * حساب الرصيد السابق والمسلم والمتبقي تلقائياً مع إصدار سند تسليم رسمي عبر محرك القوالب الموحد
 * وقالب قسم خدمات العملاء والتسليم (milling-master أو النمط المعتمد) مع دعم المشاركة والطباعة الفاخرة.
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
  Truck,
  UserPlus,
  Plus,
  Trash2,
  PackageCheck,
  CheckCircle2,
  AlertCircle,
  User,
  Building2,
  ShieldCheck,
  Sparkles,
  RefreshCw,
  Check,
} from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
import { ModuleGuard } from "@/lib/modules";
import { supabase } from "@/integrations/supabase/client";
import {
  custodyDelivery,
  fetchCustodyBalances,
  buildCustodyDeliveryDoc,
  capacityKgOf,
  type CustodyLine,
  type CustodyBalance,
} from "@/lib/milling";
import { LuxuryPrintPreviewModal } from "@/components/luxury-print-preview-modal";
import { getUnifiedPrintSettings, printUnifiedDocument, type PrintRequest } from "@/lib/printing";
import { MillingDocumentsBoard } from "@/components/milling/milling-documents-board";
import type { UnifiedDocumentData } from "@/lib/templates/types";
import {
  MillingPanel,
  MillingSectionTitle,
  MillingField,
  MillingInput,
  MillingSelect,
  MillingTextarea,
  MillingEmpty,
  Mono,
  fmtNum,
} from "@/components/milling/milling-ui";
import { QuantityInput } from "@/components/ui/quantity-input";
import { ProductPicker } from "@/components/products/product-picker";
import { ProductLinesEditor } from "@/components/products/product-lines-editor";
import { QuickAddButton } from "@/components/ui/quick-add-button";
import { QuickProductDialog } from "@/components/milling/quick-product-dialog";
import { PartyPicker } from "@/components/commerce/party-picker";
import { CustomerFormDialog } from "@/components/contacts/customer-form-dialog";
import { useI18n } from "@/lib/i18n";
import { WarehouseBadge } from "@/components/ui/warehouse-badge";

export const Route = createFileRoute("/_app/milling/delivery")({
  head: () => ({ meta: [{ title: "تسليم نواتج الأمانات — فورتكس ERP" }] }),
  component: MillingDeliveryPage,
});

interface CustomerOption {
  id: string;
  name: string;
  phone?: string | null;
  balance?: number | null;
  is_system?: boolean | null;
}

interface WarehouseOption {
  id: string;
  name_ar: string | null;
  name: string;
  is_default?: boolean;
}

function MillingDeliveryPage() {
  const qc = useQueryClient();
  const { lang } = useI18n();
  const [customerId, setCustomerId] = useState("");
  const [newCustomerOpen, setNewCustomerOpen] = useState(false);
  const [warehouseId, setWarehouseId] = useState("");
  const [lines, setLines] = useState<CustodyLine[]>([{ itemId: "", bags: 0, kg: 0 }]);
  /** نافذة إضافة صنف جديد — منبثقة فوق الشاشة، لا تُقصّ داخل اللوحة. */
  const [quickItemOpen, setQuickItemOpen] = useState(false);
  const [notes, setNotes] = useState("");

  // حالة معاينة وطباعة الفاتورة الفاخرة
  const [deliveryPrintDoc, setDeliveryPrintDoc] = useState<UnifiedDocumentData | null>(null);
  const [isPrintModalOpen, setIsPrintModalOpen] = useState(false);

  // جلب العملاء
  const customers = useQuery({
    queryKey: ["milling", "customers"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("customers")
        .select("id, name, phone, balance, is_system")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return (data ?? []) as CustomerOption[];
    },
  });

  // جلب المخازن
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

  // المستودع الافتراضي
  useEffect(() => {
    if (warehouseId) return;
    const list = warehouses.data ?? [];
    const preferred = list.find((w) => w.is_default) ?? list[0];
    if (preferred) setWarehouseId(preferred.id);
  }, [warehouses.data, warehouseId]);

  // أرصدة أمانات العميل المتاحة
  const balances = useQuery({
    queryKey: ["milling", "balances", customerId, warehouseId],
    queryFn: () => fetchCustodyBalances(customerId || undefined, warehouseId || undefined),
    enabled: Boolean(customerId && warehouseId),
  });

  // النواتج والحبوب المتاحة للتسليم (أي صنف رصيده أكبر من صفر)
  const available = (balances.data ?? []).filter(
    (b) => Number(b.bags_balance) > 0 || Number(b.kg_balance) > 0,
  );

  // V2: لا خريطة سعات ولا اشتقاق كجم — الأكياس والوزن إدخال يدوي مستقل (كما في شاشة الطحن).

  const selectedCustomer = (customers.data ?? []).find((c) => c.id === customerId);
  const selectedWarehouse = (warehouses.data ?? []).find((w) => w.id === warehouseId);
  const warehouseName = selectedWarehouse?.name_ar || selectedWarehouse?.name || "المستودع الرئيسي";

  function balanceFor(itemId: string): CustodyBalance | undefined {
    return available.find((b) => b.item_id === itemId);
  }

  function changeLineItem(idx: number, itemId: string) {
    setLines((l) =>
      l.map((x, i) => {
        if (i !== idx) return x;
        const b = balanceFor(itemId);
        const unitWeight =
          b && Number(b.bags_balance) > 0
            ? Number(b.kg_balance) / Number(b.bags_balance)
            : capacityKgOf(b as any) || 0;
        const autoKg =
          x.bags > 0 && unitWeight > 0 ? Math.round(x.bags * unitWeight * 100) / 100 : x.kg;
        return { ...x, itemId, kg: autoKg };
      }),
    );
  }

  function changeLineBags(idx: number, bags: number) {
    setLines((l) =>
      l.map((x, i) => {
        if (i !== idx) return x;
        const b = balanceFor(x.itemId);
        const unitWeight =
          b && Number(b.bags_balance) > 0
            ? Number(b.kg_balance) / Number(b.bags_balance)
            : capacityKgOf(b as any) || 0;
        const autoKg =
          bags > 0 && unitWeight > 0
            ? Math.round(bags * unitWeight * 100) / 100
            : bags === 0
              ? 0
              : x.kg;
        return { ...x, bags, kg: autoKg };
      }),
    );
  }

  function changeLineKg(idx: number, kg: number) {
    setLines((l) => l.map((x, i) => (i === idx ? { ...x, kg } : x)));
  }

  // تسليم كامل رصيد سطر محدد بنقرة واحدة
  function handleDeliverAllForLine(idx: number) {
    const line = lines[idx];
    if (!line?.itemId) return;
    const b = balanceFor(line.itemId);
    if (!b) return;
    setLines((l) =>
      l.map((x, i) =>
        i === idx ? { ...x, bags: Number(b.bags_balance), kg: Number(b.kg_balance) } : x,
      ),
    );
  }

  // تسليم كل الأرصدة المتاحة للعميل بنقرة واحدة
  function handleDeliverAllAvailable() {
    if (available.length === 0) return;
    const newLines = available.map((b) => ({
      itemId: b.item_id,
      bags: Number(b.bags_balance),
      kg: Number(b.kg_balance),
    }));
    setLines(newLines);
  }

  // التحقق من تجاوز الكمية المتاحة
  const hasOverdeliver = lines.some((l) => {
    if (!l.itemId) return false;
    const b = balanceFor(l.itemId);
    if (!b) return false;
    return l.bags > b.bags_balance || l.kg > b.kg_balance;
  });

  const canSubmit = Boolean(
    customerId &&
    warehouseId &&
    !hasOverdeliver &&
    lines.some((l) => l.itemId && (l.bags > 0 || l.kg > 0)),
  );

  // إرسال عملية التسليم
  const submit = useMutation({
    mutationFn: () => {
      return custodyDelivery({
        customerId,
        warehouseId,
        lines,
        notes: notes.trim() || undefined,
      });
    },
    onSuccess: async (res) => {
      if (!res.ok) {
        toast.error(res.message || "تعذر تسجيل التسليم.");
        return;
      }

      const docNumber = (res.data as string) || `DEL-${Date.now().toString().slice(-6)}`;
      toast.success(`تم تسجيل التسليم بنجاح — سند رقم #${docNumber}`);

      // تجهيز بيانات سند التسليم الفاخر مع توضيح الكميات السابقة، المسلمة، والمتبقية
      const deliveryLinesPayload = lines
        .filter((l) => l.itemId && (l.bags > 0 || l.kg > 0))
        .map((l) => {
          const b = balanceFor(l.itemId);
          const prevBags = Number(b?.bags_balance ?? l.bags);
          const prevKg = Number(b?.kg_balance ?? l.kg);
          const delBags = Number(l.bags ?? 0);
          const delKg = Number(l.kg ?? 0);
          const remBags = Math.max(0, prevBags - delBags);
          const remKg = Math.max(0, prevKg - delKg);

          return {
            itemName: b?.name_ar || "صنف ناتج",
            previousBags: prevBags,
            previousKg: prevKg,
            deliveredBags: delBags,
            deliveredKg: delKg,
            remainingBags: remBags,
            remainingKg: remKg,
            unit: delBags > 0 ? "كيس" : "كجم",
          };
        });

      const uDoc = buildCustodyDeliveryDoc({
        docNumber,
        customerName: selectedCustomer?.name || "عميل أمانة",
        customerPhone: selectedCustomer?.phone,
        warehouseName,
        lines: deliveryLinesPayload,
        notes: notes.trim() || undefined,
      });

      setDeliveryPrintDoc(uDoc);

      const printSettings = getUnifiedPrintSettings();
      const printOverride = printSettings.overrides.delivery_note;
      const printBehavior = printOverride?.behavior ?? printSettings.behavior;

      const printRequest: PrintRequest = {
        documentType: "delivery_note",
        rtl: true,
        templateId: printOverride?.templateId || "milling-thermal",
        paperId: printOverride?.paperId || "thermal-80",
        method: printOverride?.method || "thermal",
        doc: uDoc,
      };

      if (printBehavior === "direct" || (printBehavior === "default" && !printSettings.preview)) {
        void printUnifiedDocument(printRequest);
      } else if (printBehavior !== "off") {
        setIsPrintModalOpen(true);
      }

      // تفريغ النموذج
      setLines([{ itemId: "", bags: 0, kg: 0 }]);
      setNotes("");

      void qc.invalidateQueries({ queryKey: ["milling"] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "خطأ غير متوقع"),
  });

  return (
    <ModuleGuard moduleId="milling_operations">
      <div className="mx-auto max-w-7xl space-y-4 p-4">
        {/* شريط رأس الصفحة */}
        <PageHeader
          title="تسليم نواتج الأمانات"
          subtitle="صرف وخروج نواتج الطحن والأمانات العينية للعميل مع احتساب الأرصدة المتبقية وسند تسليم رسمي."
          actions={
            <div className="flex items-center gap-2">
              <Link
                to="/milling/customer-statement"
                className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-card px-3.5 py-2 text-xs font-bold text-foreground shadow-xs transition hover:bg-muted"
              >
                كشف حساب الأمانات
              </Link>
              <Link
                to="/milling/intake"
                className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-card px-3.5 py-2 text-xs font-bold text-foreground shadow-xs transition hover:bg-muted"
              >
                كاونتر الاستلام
              </Link>
            </div>
          }
        />

        {/* جسم الشاشة: عمود إدخال التسليم + عمود الرصيد المتبقي */}
        <div className="grid gap-4 lg:grid-cols-12">
          {/* العمود الأيمن (7 أعمدة): نموذج التسليم */}
          <MillingPanel className="lg:col-span-7 space-y-4">
            <MillingSectionTitle
              icon={<Truck className="h-4 w-4" />}
              title="نموذج صرف وتسليم الأمانات"
              subtitle="تسجيل صرف كلي أو جزئي (دفعات) مع تحديث فوري للمتبقي"
              action={
                available.length > 0 ? (
                  <button
                    type="button"
                    onClick={handleDeliverAllAvailable}
                    className="inline-flex items-center gap-1 rounded-lg bg-emerald-500/10 px-2.5 py-1 text-xs font-bold text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/20"
                  >
                    <Sparkles className="h-3 w-3" />
                    تسليم كامل الرصيد المتاح
                  </button>
                ) : undefined
              }
            />

            <div className="space-y-4 p-4">
              {/* العميل والمستودع */}
              <div className="grid gap-3 sm:grid-cols-2">
                <MillingField label="العميل صاحب الأمانة *">
                  <div className="flex min-w-0 flex-1 items-center gap-1.5">
                    <PartyPicker
                      options={customers.data ?? []}
                      value={customerId}
                      onChange={(nextId) => {
                        setCustomerId(nextId);
                        setLines([{ itemId: "", bags: 0, kg: 0 }]);
                      }}
                      lang={lang}
                      label={lang === "ar" ? "العميل" : "Customer"}
                      emptyLabel={lang === "ar" ? "اختر العميل المستلم…" : "Select customer…"}
                      kind="customer"
                      className="h-10 min-w-0 flex-1 rounded-2xl border-primary/20 bg-primary/[0.035] text-xs hover:border-primary/50 hover:bg-primary/[0.07]"
                    />
                    <button
                      type="button"
                      onClick={() => setNewCustomerOpen(true)}
                      className="grid size-9 shrink-0 place-items-center rounded-full border border-primary/25 bg-primary/10 text-primary shadow-sm transition hover:border-primary/40 hover:bg-primary/15 active:scale-95 cursor-pointer"
                      title={lang === "ar" ? "إضافة عميل جديد" : "Add customer"}
                      aria-label={lang === "ar" ? "إضافة عميل جديد" : "Add customer"}
                    >
                      <UserPlus className="h-4 w-4" />
                    </button>
                  </div>
                </MillingField>

                <WarehouseBadge
                  value={warehouseId}
                  onChange={setWarehouseId}
                  required
                  warehouses={(warehouses.data ?? []).map((w) => ({
                    id: w.id,
                    nameAr: w.name_ar || w.name,
                    isDefault: Boolean(w.is_default),
                  }))}
                />
              </div>

              {/* جدول أسطر التسليم — نفس المحرّر الموحّد المستخدم في الاستلام والطحن */}
              <div className="space-y-3 rounded-2xl border border-border/80 bg-surface-2/30 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <h4 className="text-xs font-bold text-foreground">
                      الأصناف والكميات المراد تسليمها
                    </h4>
                    <p className="text-[11px] text-muted-foreground">
                      يمكن التسليم على دفعات متفرقة، وسيظهر المتبقي في الفاتورة والسجل.
                    </p>
                  </div>
                  <QuickAddButton
                    label="إضافة صنف جديد إلى دليل الأمانات"
                    icon={Plus}
                    tone="emerald"
                    size="sm"
                    onClick={() => setQuickItemOpen(true)}
                  />
                </div>

                <ProductLinesEditor
                  lines={lines.map((line) => ({
                    itemId: line.itemId,
                    bags: Number(line.bags) || 0,
                    kg: Number(line.kg) || 0,
                  }))}
                  onChange={(index, patch) => {
                    if (patch.itemId !== undefined) changeLineItem(index, patch.itemId);
                    if (patch.bags !== undefined) changeLineBags(index, patch.bags);
                    if (patch.kg !== undefined) changeLineKg(index, patch.kg);
                  }}
                  onAdd={() => setLines((l) => [...l, { itemId: "", bags: 0, kg: 0 }])}
                  onRemove={(index) => setLines((l) => l.filter((_, i) => i !== index))}
                  items={available.map((item) => ({
                    id: item.item_id,
                    nameAr: item.name_ar,
                    sku: item.sku,
                    item_class: item.item_class,
                    balanceKg: item.kg_balance,
                    balanceBags: item.bags_balance,
                  }))}
                  classes={["RAW_MATERIAL", "FINISHED_GOOD", "BY_PRODUCT"]}
                  placeholder="اختر ناتج الطحن أو الأمانة…"
                  bagsLabel="أكياس مسلّمة"
                  kgLabel="الوزن المسلّم (كجم)"
                  onFillAll={handleDeliverAllForLine}
                  fillAllLabel="تسليم الكل"
                  addLabel="إضافة صنف آخر للتسليم"
                  ariaLabel="الأصناف المراد تسليمها"
                  metrics={(_index, line) => {
                    const balance = line.itemId ? balanceFor(line.itemId) : undefined;
                    if (!balance) return [];
                    const overBags = line.bags > balance.bags_balance;
                    const overKg = line.kg > balance.kg_balance;
                    return [
                      {
                        key: "available",
                        label: "المتاح",
                        value: balance.bags_balance,
                        unit: "كيس",
                        secondary: `(${fmtNum(balance.kg_balance)} كجم)`,
                        isOver: overBags || overKg,
                      },
                      {
                        key: "remaining",
                        label: "المتبقي",
                        value: Math.max(0, balance.bags_balance - line.bags),
                        unit: "كيس",
                        secondary: `(${fmtNum(Math.max(0, balance.kg_balance - line.kg))} كجم)`,
                        tone: "success",
                      },
                    ];
                  }}
                />
              </div>

              <MillingField label="ملاحظات التسليم الإضافية" hint="تظهر في سند التسليم الرسمي">
                <MillingTextarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="مثال: تسليم دفعة أولى من أصل 50 كيساً — الباقي يُسلم غداً…"
                />
              </MillingField>

              {/* زر اعتماد التسليم الكبير */}
              <button
                type="button"
                disabled={!canSubmit || submit.isPending}
                onClick={() => submit.mutate()}
                className="w-full inline-flex items-center justify-center gap-2 rounded-2xl bg-emerald-600 py-3.5 px-4 text-sm font-black text-white shadow-md transition hover:bg-emerald-700 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {submit.isPending ? (
                  <>
                    <RefreshCw className="h-4 w-4 animate-spin" />
                    جارٍ تسجيل الصرف وإصدار سند التسليم…
                  </>
                ) : (
                  <>
                    <Check className="h-5 w-5" />
                    تأكيد التسليم وطباعة سند التسليم المعتمد
                  </>
                )}
              </button>
            </div>
          </MillingPanel>

          {/* العمود الأيسر (5 أعمدة): بطاقة رصيد الأمانات الجاهزة للتسليم */}
          <MillingPanel className="lg:col-span-5 flex flex-col justify-between">
            <div>
              <MillingSectionTitle
                icon={<PackageCheck className="h-4 w-4" />}
                title="أرصدة الأمانات المتاحة"
                subtitle="ما هو مودع باسم العميل في المستودع المختار"
                action={
                  selectedCustomer ? (
                    <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-bold text-emerald-700 dark:text-emerald-300">
                      رصيد معتمد
                    </span>
                  ) : undefined
                }
              />

              <div className="space-y-3 p-4">
                {!customerId || !warehouseId ? (
                  <MillingEmpty
                    title="حدد العميل والمستودع"
                    hint="اختر العميل والمستودع لعرض الأمانات ونواتج الطحن الجاهزة للتسليم."
                  />
                ) : balances.isLoading ? (
                  <div className="flex items-center justify-center py-10 text-xs text-muted-foreground">
                    <RefreshCw className="h-4 w-4 animate-spin me-2" /> جارٍ جلب أرصدة الأمانات…
                  </div>
                ) : available.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-border p-6 text-center space-y-2">
                    <div className="grid h-10 w-10 mx-auto place-items-center rounded-full bg-muted text-muted-foreground">
                      <PackageCheck className="h-5 w-5" />
                    </div>
                    <h5 className="font-bold text-sm text-foreground">لا توجد أمانات متبقية</h5>
                    <p className="text-xs text-muted-foreground">
                      تم تسليم كامل النواتج والحبوب لهذا العميل، أو لم يتم تسجيل طحن بعد.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    {available.map((b) => (
                      <div
                        key={b.item_id}
                        className="rounded-xl border border-border/70 bg-card p-3 shadow-2xs hover:border-emerald-500/40 transition-colors"
                      >
                        <div className="flex items-center justify-between">
                          <div>
                            <span className="font-bold text-xs text-foreground block">
                              {b.name_ar}
                            </span>
                            <span className="text-[11px] text-muted-foreground">
                              {b.item_class === "RAW_MATERIAL" ? "حبوب خام" : "ناتج طحن معبأ"}
                            </span>
                          </div>
                          <div className="text-end">
                            <span className="font-black text-sm text-emerald-600 dark:text-emerald-400 block">
                              {fmtNum(b.bags_balance)} كيس
                            </span>
                            <span className="text-[11px] font-mono text-muted-foreground">
                              {fmtNum(b.kg_balance)} كجم
                            </span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* بطاقة معلومات وسندات التسليم الموحدة في الأسفل */}
            <div className="p-4 border-t border-border/70 bg-muted/20 rounded-b-2xl">
              <div className="flex items-start gap-2.5 text-xs text-muted-foreground">
                <ShieldCheck className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
                <div>
                  <strong className="text-foreground block">سند تسليم رسمي معتمد:</strong>
                  يتم توثيق كل حركة تسليم برقم تسلسلي، مع طباعة ومشاركة تفاصيل الدفعة المسلمة
                  والمتبقي باسم العميل عبر واتساب وPDF فوراً.
                </div>
              </div>
            </div>
          </MillingPanel>
        </div>

        {/* سجل التسليم والصرف: المستندات الموحدة بزاوية المُسلَّم والمتبقي في الأمانة */}
        <MillingDocumentsBoard focus="delivery" title="سجل التسليم والصرف" />

        {/* نافذة المعاينة والطباعة الفاخرة المعتمدة لسند التسليم الموحد */}
        {deliveryPrintDoc && (
          <LuxuryPrintPreviewModal
            open={isPrintModalOpen}
            onClose={() => {
              setIsPrintModalOpen(false);
              setDeliveryPrintDoc(null);
            }}
            doc={deliveryPrintDoc}
            documentType="delivery_note"
            title="معاينة وطباعة سند تسليم نواتج الأمانة"
            customerName={selectedCustomer?.name || undefined}
            customerPhone={selectedCustomer?.phone || undefined}
          />
        )}

        {/* إضافة صنف — منبثقة على `document.body`، تعلو الكاونتر ولا تُقصّ معه. */}
        <QuickProductDialog
          open={quickItemOpen}
          onOpenChange={setQuickItemOpen}
          mode="custody"
          defaultClass="FINISHED_GOOD"
          classes={["FINISHED_GOOD", "BY_PRODUCT", "RAW_MATERIAL"]}
          onSaved={(productId) => {
            const emptyIdx = lines.findIndex((l) => !l.itemId);
            if (emptyIdx >= 0) {
              setLines((current) =>
                current.map((line, i) => (i === emptyIdx ? { ...line, itemId: productId } : line)),
              );
            } else {
              setLines((current) => [...current, { itemId: productId, bags: 0, kg: 0 }]);
            }
          }}
        />
        {/* نافذة إضافة عميل جديد سريعاً دون مغادرة شاشة التسليم */}
        <CustomerFormDialog
          open={newCustomerOpen}
          onClose={() => setNewCustomerOpen(false)}
          hint={
            lang === "ar"
              ? "سيتم اختيار العميل تلقائياً فور حفظه لتسليم أمانته فوراً."
              : "Customer will be selected automatically."
          }
          onSaved={(newCust) => {
            void qc.invalidateQueries({ queryKey: ["milling", "customers"] });
            setCustomerId(newCust.id);
            setLines([{ itemId: "", bags: 0, kg: 0 }]);
            setNewCustomerOpen(false);
            toast.success(
              lang === "ar"
                ? `تمت إضافة واختيار العميل: ${newCust.name}`
                : `Customer selected: ${newCust.name}`,
            );
          }}
        />
      </div>
    </ModuleGuard>
  );
}

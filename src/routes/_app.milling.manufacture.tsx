import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  CheckCircle2,
  Plus,
  RotateCcw,
  Trash2,
  Warehouse as WarehouseIcon,
} from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
import { ModuleGuard } from "@/lib/modules";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { translateRpcError } from "@/lib/errors/rpc-errors";
import {
  MillingField,
  MillingInput,
  MillingPanel,
  MillingSectionTitle,
  MillingSelect,
  fmtNum,
} from "@/components/milling/milling-ui";
import {
  createAndPostProductionOrder,
  loadProductionLookups,
  reverseProductionOrder,
  type ProductionExpenseInput,
  type ProductionLossInput,
  type ProductionMaterialInput,
  type ProductionOutputInput,
  type ProductionProduct,
} from "@/lib/production/production-orders";

export const Route = createFileRoute("/_app/milling/manufacture")({
  head: () => ({ meta: [{ title: "تصنيع منتجات المنشأة — فورتكس ERP" }] }),
  component: CompanyProductionPage,
});

type MaterialDraft = { productId: string; quantity: string; uomId: string; batchId: string };
type OutputDraft = {
  productId: string;
  quantity: string;
  uomId: string;
  allocationValue: string;
  batchNumber: string;
  expiryDate: string;
};
type ExpenseDraft = { expenseLineId: string; amount: string; basis: string; note: string };
type LossDraft = { type: "NORMAL" | "ABNORMAL"; quantity: string; uomId: string; reason: string };

const blankMaterial = (): MaterialDraft => ({
  productId: "",
  quantity: "",
  uomId: "",
  batchId: "",
});
const blankOutput = (): OutputDraft => ({
  productId: "",
  quantity: "",
  uomId: "",
  allocationValue: "",
  batchNumber: "",
  expiryDate: "",
});
const localDate = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};

export function CompanyProductionPage() {
  const qc = useQueryClient();
  const db = supabase as any;
  const { hasRole } = useAuth();
  const query = useQuery({ queryKey: ["company-production"], queryFn: loadProductionLookups });
  const data = query.data;

  const [warehouseId, setWarehouseId] = useState("");
  const [costCenterId, setCostCenterId] = useState("");
  const [productionDate, setProductionDate] = useState(localDate);
  const [notes, setNotes] = useState("");
  const [materials, setMaterials] = useState<MaterialDraft[]>([blankMaterial()]);
  const [outputs, setOutputs] = useState<OutputDraft[]>([blankOutput()]);
  const [expenses, setExpenses] = useState<ExpenseDraft[]>([]);
  const [losses, setLosses] = useState<LossDraft[]>([]);

  useEffect(() => {
    if (!data) return;
    if (!warehouseId)
      setWarehouseId(data.warehouses.find((w) => w.is_default)?.id ?? data.warehouses[0]?.id ?? "");
    if (!costCenterId && data.centers.length === 1) setCostCenterId(data.centers[0].id);
  }, [data, warehouseId, costCenterId]);

  const products = data?.products ?? [];
  const materialProducts = products.filter((p) =>
    ["RAW_MATERIAL", "PACKAGING", "FINISHED_GOOD", "BY_PRODUCT"].includes(p.item_class ?? ""),
  );
  const outputProducts = products.filter(
    (p) => p.is_sellable && ["FINISHED_GOOD", "BY_PRODUCT"].includes(p.item_class ?? ""),
  );
  const massUnits = data?.units.filter((u) => u.dimension_code === "MASS") ?? [];
  const kiloUnit =
    massUnits.find((u) => ["kg", "كجم", "كيلوجرام"].includes(u.short_name.toLowerCase())) ??
    massUnits[0];
  const unitById = useMemo(
    () => new Map((data?.units ?? []).map((unit) => [unit.id, unit])),
    [data?.units],
  );

  const getUomChoices = (product: ProductionProduct | undefined) => {
    if (!product || !data) return [];
    const baseId = product.base_uom_id ?? product.unit_id;
    const allowed = product.uoms.filter((u) => u.is_active);
    if (allowed.length) {
      return allowed.map((uom) => ({
        id: uom.unit_id,
        factor: Number(uom.factor_to_base),
        label: unitLabel(unitById.get(uom.unit_id)),
        isBase: uom.is_base,
      }));
    }
    const baseUnit = baseId ? unitById.get(baseId) : undefined;
    return [{ id: baseId ?? "", factor: 1, label: unitLabel(baseUnit), isBase: true }];
  };

  const unitLabel = (unit?: { name_ar: string | null; short_name: string } | null) =>
    unit?.name_ar || unit?.short_name || "وحدة الأساس";
  const selectedUom = (product: ProductionProduct | undefined, uomId: string) => {
    const choices = getUomChoices(product);
    return (
      choices.find((choice) => choice.id === uomId) ??
      choices.find((choice) => choice.isBase) ??
      choices[0]
    );
  };
  const availableQuantity = (productId: string) => {
    if (!data || !warehouseId) return 0;
    const inventory = data.inventory.find(
      (i) => i.product_id === productId && i.warehouse_id === warehouseId,
    );
    return Number(inventory?.quantity ?? 0);
  };
  const availableBatches = (productId: string) =>
    (data?.batches ?? []).filter(
      (batch) => batch.product_id === productId && batch.warehouse_id === warehouseId,
    );

  const selectedProducts = materials.map((line) => products.find((p) => p.id === line.productId));
  const selectedOutputs = outputs.map((line) => products.find((p) => p.id === line.productId));
  const estimatedMaterialMass = materials.reduce((sum, line, index) => {
    const product = selectedProducts[index];
    const qty = Number(line.quantity) || 0;
    if (!product || qty <= 0) return sum;
    const uom = selectedUom(product, line.uomId);
    const baseQty = qty * Number(uom?.factor ?? 1);
    const baseUnit = unitById.get(product.base_uom_id ?? product.unit_id ?? "");
    const kg =
      baseUnit?.dimension_code === "MASS" && baseUnit.factor_to_reference
        ? (baseQty * Number(baseUnit.factor_to_reference)) /
          Number(kiloUnit?.factor_to_reference ?? 1000)
        : product.package_weight_kg
          ? baseQty * Number(product.package_weight_kg)
          : null;
    return kg === null ? Number.NaN : sum + kg;
  }, 0);
  const estimatedOutputMass = outputs.reduce((sum, line, index) => {
    const product = selectedOutputs[index];
    const qty = Number(line.quantity) || 0;
    if (!product || qty <= 0) return sum;
    const uom = selectedUom(product, line.uomId);
    const baseQty = qty * Number(uom?.factor ?? 1);
    const baseUnit = unitById.get(product.base_uom_id ?? product.unit_id ?? "");
    const kg =
      baseUnit?.dimension_code === "MASS" && baseUnit.factor_to_reference
        ? (baseQty * Number(baseUnit.factor_to_reference)) /
          Number(kiloUnit?.factor_to_reference ?? 1000)
        : product.package_weight_kg
          ? baseQty * Number(product.package_weight_kg)
          : null;
    return kg === null ? Number.NaN : sum + kg;
  }, 0);

  const expenseSources = (data?.expenseSources ?? []).filter(
    (source) =>
      source.cost_center_id === costCenterId &&
      Number(source.available_amount) > 0,
  );
  const estimatedConversionCost = expenses.reduce(
    (sum, line) => sum + (Number(line.amount) || 0),
    0,
  );

  const submit = useMutation({
    mutationFn: async () => {
      const cleanMaterials: ProductionMaterialInput[] = materials.map((line) => ({
        product_id: line.productId,
        quantity: Number(line.quantity),
        uom_id: line.uomId || null,
        batch_id: line.batchId || null,
      }));
      const cleanOutputs: ProductionOutputInput[] = outputs.map((line) => ({
        product_id: line.productId,
        quantity: Number(line.quantity),
        uom_id: line.uomId || null,
        allocation_value_per_base: Number(line.allocationValue) || 0,
        batch_number: line.batchNumber.trim() || null,
        expiry_date: line.expiryDate || null,
      }));
      const cleanExpenses: ProductionExpenseInput[] = expenses
        .filter((line) => line.expenseLineId && Number(line.amount) > 0)
        .map((line) => ({
          expense_line_id: line.expenseLineId,
          amount: Number(line.amount),
          basis: line.basis.trim(),
          note: line.note.trim() || null,
        }));
      const cleanLosses: ProductionLossInput[] = losses
        .filter((line) => Number(line.quantity) > 0)
        .map((line) => ({
          loss_type: line.type,
          quantity: Number(line.quantity),
          uom_id: line.uomId,
          reason: line.reason.trim(),
        }));

      return createAndPostProductionOrder({
        warehouse_id: warehouseId,
        cost_center_id: costCenterId,
        production_date: productionDate,
        notes: notes.trim() || null,
        materials: cleanMaterials,
        outputs: cleanOutputs,
        expenses: cleanExpenses,
        losses: cleanLosses,
      });
    },
    onSuccess: async (orderId) => {
      const { data: order } = await db
        .from("production_orders")
        .select("order_number")
        .eq("id", orderId)
        .maybeSingle();
      toast.success(`تم ترحيل تشغيلة الإنتاج ${order?.order_number ?? ""}`);
      setMaterials([blankMaterial()]);
      setOutputs([blankOutput()]);
      setExpenses([]);
      setLosses([]);
      setNotes("");
      await qc.invalidateQueries({ queryKey: ["company-production"] });
      await qc.invalidateQueries({ queryKey: ["inventory"] });
      await qc.invalidateQueries({ queryKey: ["milling"] });
    },
    onError: (error) => toast.error(translateRpcError(error, "ar", "تعذر ترحيل تشغيلة الإنتاج.")),
  });

  const expenseCategoryEligibility = useMutation({
    mutationFn: async (input: { categoryId: string; eligible: boolean }) => {
      const { error } = await db.rpc("set_production_expense_category_eligibility", {
        p_category_id: input.categoryId,
        p_eligible: input.eligible,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      toast.success("تم تحديث أهلية تصنيف المصروف للإنتاج");
      await qc.invalidateQueries({ queryKey: ["company-production"] });
    },
    onError: (error) =>
      toast.error(translateRpcError(error, "ar", "تعذر تحديث أهلية تصنيف المصروف.")),
  });

  const productionReversal = useMutation({
    mutationFn: (input: { orderId: string; reason: string }) =>
      reverseProductionOrder(input.orderId, input.reason),
    onSuccess: async (_orderId, input) => {
      toast.success(`تم عكس تشغيلة الإنتاج: ${input.reason}`);
      await qc.invalidateQueries({ queryKey: ["company-production"] });
      await qc.invalidateQueries({ queryKey: ["inventory"] });
      await qc.invalidateQueries({ queryKey: ["milling"] });
    },
    onError: (error) =>
      toast.error(translateRpcError(error, "ar", "تعذر عكس التشغيلة. قد تكون لها حركات مخزون لاحقة.")),
  });

  const formValid = Boolean(
    warehouseId &&
    costCenterId &&
    productionDate &&
    materials.length > 0 &&
    materials.every((line) => line.productId && Number(line.quantity) > 0) &&
    outputs.length > 0 &&
    outputs.every((line) => line.productId && Number(line.quantity) > 0) &&
    (outputs.length < 2 || outputs.every((line) => Number(line.allocationValue) > 0)) &&
    expenses.every(
      (line) => !line.expenseLineId || (Number(line.amount) > 0 && line.basis.trim().length >= 3),
    ) &&
    losses.every(
      (line) => !Number(line.quantity) || (line.uomId && line.reason.trim().length >= 3),
    ),
  );

  if (query.isLoading)
    return <div className="p-6 text-sm text-muted-foreground">جارٍ تحميل بيانات التصنيع…</div>;
  if (query.error) {
    return (
      <ModuleGuard moduleId="milling_operations">
        <div className="mx-auto max-w-5xl p-4">
          <PageHeader
            title="تصنيع منتجات المنشأة"
            subtitle="تعذر تحميل إعدادات المستودعات أو المنتجات أو الوحدات."
          />
          <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-700">
            {String(query.error)}
          </div>
        </div>
      </ModuleGuard>
    );
  }

  const updateMaterial = (index: number, values: Partial<MaterialDraft>) =>
    setMaterials((current) =>
      current.map((line, i) => (i === index ? { ...line, ...values } : line)),
    );
  const updateOutput = (index: number, values: Partial<OutputDraft>) =>
    setOutputs((current) =>
      current.map((line, i) => (i === index ? { ...line, ...values } : line)),
    );
  const productOption = (product: ProductionProduct) =>
    `${product.name_ar}${product.sku ? ` · ${product.sku}` : ""}`;

  return (
    <ModuleGuard moduleId="milling_operations">
      <div className="mx-auto max-w-7xl space-y-5 p-3 sm:p-5">
        <PageHeader
          title="تصنيع منتجات المنشأة"
          subtitle="أنشئ تشغيلة تنقل التكلفة الفعلية للمواد والتكاليف الصناعية المؤهلة إلى مخزون المنتجات الناتجة."
          actions={
            <Link
              to="/milling/milling"
              className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-surface px-3 py-2 text-xs font-bold text-foreground hover:bg-muted"
            >
              خدمة طحن حبوب العملاء <ArrowLeft className="h-3.5 w-3.5" />
            </Link>
          }
        />

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-2xl border border-border/70 bg-surface-1/80 p-4">
            <p className="text-xs font-semibold text-muted-foreground">تكلفة المواد التقديرية</p>
            <p className="mt-1 text-sm font-bold">يحددها محرك متوسط تكلفة المخزون عند الصرف</p>
          </div>
          <div className="rounded-2xl border border-border/70 bg-surface-1/80 p-4">
            <p className="text-xs font-semibold text-muted-foreground">تكاليف التحويل المحددة</p>
            <p className="mt-1 text-lg font-black tabular-nums">
              {fmtNum(estimatedConversionCost)} <span className="text-xs font-semibold">ر.ي</span>
            </p>
          </div>
          <div className="rounded-2xl border border-border/70 bg-surface-1/80 p-4">
            <p className="text-xs font-semibold text-muted-foreground">مكافئ الكتلة المدخل</p>
            <p className="mt-1 text-sm font-bold">
              {Number.isFinite(estimatedMaterialMass) && Number.isFinite(estimatedOutputMass)
                ? `${fmtNum(estimatedMaterialMass)} كجم مواد خام ← ${fmtNum(estimatedOutputMass)} كجم نواتج`
                : "يظهر عند توفر وزن العبوة أو وحدة كتلية للصنف"}
            </p>
          </div>
        </div>

        <MillingPanel>
          <MillingSectionTitle
            icon={<WarehouseIcon className="h-4 w-4" />}
            title="بيانات التشغيلة"
            subtitle="لكل عملية تصنيع رقم مستقل ومركز تكلفة تحليلي."
          />
          <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-4">
            <MillingField label="المستودع">
              <MillingSelect
                value={warehouseId}
                onChange={(event) => setWarehouseId(event.target.value)}
              >
                <option value="">اختر المستودع</option>
                {data?.warehouses.map((warehouse) => (
                  <option key={warehouse.id} value={warehouse.id}>
                    {warehouse.name_ar || warehouse.name}
                  </option>
                ))}
              </MillingSelect>
            </MillingField>
            <MillingField label="مركز التكلفة">
              <MillingSelect
                value={costCenterId}
                onChange={(event) => setCostCenterId(event.target.value)}
              >
                <option value="">اختر مركز التكلفة</option>
                {data?.centers.map((center) => (
                  <option key={center.id} value={center.id}>
                    {center.name_ar || center.name}
                  </option>
                ))}
              </MillingSelect>
            </MillingField>
            <MillingField label="تاريخ الإنتاج">
              <MillingInput
                type="date"
                value={productionDate}
                onChange={(event) => setProductionDate(event.target.value)}
              />
            </MillingField>
            <MillingField label="ملاحظات التشغيل">
              <MillingInput
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                placeholder="اختياري"
              />
            </MillingField>
          </div>
        </MillingPanel>

        {(hasRole("owner") || hasRole("manager")) && (
          <MillingPanel>
            <MillingSectionTitle
              title="تصنيفات المصروف المؤهلة للتصنيع"
              subtitle="كل التصنيفات تبدأ غير مؤهلة. فعّل فقط أجور الإنتاج والطاقة والتعبئة أو المصروف الصناعي المحدد. تبقى الإدارية والبيعية خارج المخزون، ويلزم أن يطابق مركز المصروف مركز التشغيلة."
            />
            <div className="grid gap-2 p-4 sm:grid-cols-2 xl:grid-cols-3">
              {(data?.expenseCategories ?? []).map((category) => (
                <label
                  key={category.id}
                  className="flex cursor-pointer items-center gap-3 rounded-xl border border-border/60 p-3 text-sm"
                >
                  <input
                    type="checkbox"
                    checked={category.production_cost_eligible}
                    disabled={expenseCategoryEligibility.isPending}
                    onChange={(event) =>
                      expenseCategoryEligibility.mutate({
                        categoryId: category.id,
                        eligible: event.target.checked,
                      })
                    }
                    className="size-4 accent-primary"
                  />
                  <span>{category.name_ar || category.name}</span>
                  <span className="ms-auto text-[10px] text-muted-foreground">
                    {category.production_cost_eligible ? "مؤهل" : "غير مؤهل"}
                  </span>
                </label>
              ))}
              {!data?.expenseCategories.length && (
                <p className="text-xs text-muted-foreground">لا توجد تصنيفات مصروفات نشطة.</p>
              )}
            </div>
          </MillingPanel>
        )}

        <MillingPanel>
          <MillingSectionTitle
            title="المواد المصروفة إلى الإنتاج"
            subtitle="تُصرف من مخزون المنشأة بوحدة الصنف الأساسية، وتخصم الدفعات وفق سياسة الصنف أو تحددها يدوياً."
            action={
              <button
                type="button"
                onClick={() => setMaterials((current) => [...current, blankMaterial()])}
                className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-2 text-xs font-bold"
              >
                <Plus className="h-4 w-4" /> إضافة مادة
              </button>
            }
          />
          <div className="space-y-3 p-4">
            {materials.map((line, index) => {
              const product = products.find((item) => item.id === line.productId);
              const uoms = getUomChoices(product);
              const uom = selectedUom(product, line.uomId);
              const batches = availableBatches(line.productId);
              const stock = availableQuantity(line.productId);
              return (
                <div
                  key={index}
                  className="grid gap-3 rounded-xl border border-border/60 p-3 sm:grid-cols-2 xl:grid-cols-[2fr_1fr_1fr_1.4fr_auto]"
                >
                  <MillingField label="المادة / الصنف">
                    <MillingSelect
                      value={line.productId}
                      onChange={(event) =>
                        updateMaterial(index, {
                          productId: event.target.value,
                          uomId: "",
                          batchId: "",
                        })
                      }
                    >
                      <option value="">اختر المادة</option>
                      {materialProducts.map((item) => (
                        <option key={item.id} value={item.id}>
                          {productOption(item)}
                        </option>
                      ))}
                    </MillingSelect>
                    {product && (
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        المتاح: {fmtNum(stock)}{" "}
                        {unitLabel(unitById.get(product.base_uom_id ?? product.unit_id ?? ""))}
                      </p>
                    )}
                  </MillingField>
                  <MillingField label="الكمية المدخلة">
                    <MillingInput
                      type="number"
                      min="0"
                      step="0.001"
                      value={line.quantity}
                      onChange={(event) => updateMaterial(index, { quantity: event.target.value })}
                    />
                  </MillingField>
                  <MillingField label="وحدة الصرف">
                    <MillingSelect
                      value={line.uomId || uom?.id || ""}
                      onChange={(event) => updateMaterial(index, { uomId: event.target.value })}
                    >
                      {uoms.map((choice) => (
                        <option key={choice.id} value={choice.id}>
                          {choice.label}
                          {choice.isBase ? " (الأساس)" : ` × ${fmtNum(choice.factor)}`}
                        </option>
                      ))}
                    </MillingSelect>
                  </MillingField>
                  {product?.tracking === "BATCH" ? (
                    <MillingField
                      label="دفعة الصرف"
                      hint="حدد الدفعة عند اتباع سياسة MANUAL؛ وإلا يتبع الصرف استراتيجية FIFO/FEFO."
                    >
                      <MillingSelect
                        value={line.batchId}
                        onChange={(event) => updateMaterial(index, { batchId: event.target.value })}
                      >
                        <option value="">تلقائي حسب السياسة</option>
                        {batches.map((batch) => (
                          <option key={batch.id} value={batch.id}>
                            {batch.batch_number} · {fmtNum(Number(batch.quantity))}
                            {batch.expiry_date ? ` · ${batch.expiry_date}` : ""}
                          </option>
                        ))}
                      </MillingSelect>
                    </MillingField>
                  ) : (
                    <div className="flex items-end text-[11px] text-muted-foreground">
                      قيمة الصرف تسجل من تكلفة المخزون الحالية.
                    </div>
                  )}
                  <div className="flex items-end justify-end">
                    <button
                      type="button"
                      aria-label="حذف المادة"
                      onClick={() =>
                        setMaterials((current) =>
                          current.length > 1
                            ? current.filter((_, i) => i !== index)
                            : [blankMaterial()],
                        )
                      }
                      className="rounded-full p-2 text-muted-foreground hover:bg-rose-500/10 hover:text-rose-600"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </MillingPanel>

        <MillingPanel>
          <MillingSectionTitle
            title="النواتج المستلمة في المخزون"
            subtitle="التكلفة الموزعة تُستلم عبر محرك تقييم المخزون؛ الصنف المتتبع بالدفعات ينشئ دفعة إنتاج مرتبطة بالتشغيلة."
            action={
              <button
                type="button"
                onClick={() => setOutputs((current) => [...current, blankOutput()])}
                className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-2 text-xs font-bold"
              >
                <Plus className="h-4 w-4" /> إضافة ناتج
              </button>
            }
          />
          <div className="space-y-3 p-4">
            {outputs.map((line, index) => {
              const product = products.find((item) => item.id === line.productId);
              const uoms = getUomChoices(product);
              const uom = selectedUom(product, line.uomId);
              return (
                <div
                  key={index}
                  className="grid gap-3 rounded-xl border border-border/60 p-3 sm:grid-cols-2 xl:grid-cols-[2fr_1fr_1fr_1.3fr_1fr_1fr_auto]"
                >
                  <MillingField label="المنتج الناتج">
                    <MillingSelect
                      value={line.productId}
                      onChange={(event) =>
                        updateOutput(index, { productId: event.target.value, uomId: "" })
                      }
                    >
                      <option value="">اختر الناتج</option>
                      {outputProducts.map((item) => (
                        <option key={item.id} value={item.id}>
                          {productOption(item)}
                        </option>
                      ))}
                    </MillingSelect>
                  </MillingField>
                  <MillingField label="الكمية الناتجة">
                    <MillingInput
                      type="number"
                      min="0"
                      step="0.001"
                      value={line.quantity}
                      onChange={(event) => updateOutput(index, { quantity: event.target.value })}
                    />
                  </MillingField>
                  <MillingField label="وحدة الناتج">
                    <MillingSelect
                      value={line.uomId || uom?.id || ""}
                      onChange={(event) => updateOutput(index, { uomId: event.target.value })}
                    >
                      {uoms.map((choice) => (
                        <option key={choice.id} value={choice.id}>
                          {choice.label}
                          {choice.isBase ? " (الأساس)" : ` × ${fmtNum(choice.factor)}`}
                        </option>
                      ))}
                    </MillingSelect>
                  </MillingField>
                  <MillingField
                    label="قيمة بيع تقديرية لوحدة الأساس"
                    hint={
                      outputs.length > 1
                        ? "للتوزيع النسبي لتكلفة الناتج المشترك فقط."
                        : "تستخدم فقط عند توزيع تكلفة عدة نواتج."
                    }
                  >
                    <MillingInput
                      type="number"
                      min="0"
                      step="0.0001"
                      value={line.allocationValue}
                      onChange={(event) =>
                        updateOutput(index, { allocationValue: event.target.value })
                      }
                    />
                  </MillingField>
                  {product?.tracking === "BATCH" ? (
                    <>
                      <MillingField label="رقم دفعة الناتج">
                        <MillingInput
                          value={line.batchNumber}
                          onChange={(event) =>
                            updateOutput(index, { batchNumber: event.target.value })
                          }
                          placeholder="تلقائي عند تركه فارغاً"
                        />
                      </MillingField>
                      <MillingField label="تاريخ الانتهاء">
                        <MillingInput
                          type="date"
                          value={line.expiryDate}
                          onChange={(event) =>
                            updateOutput(index, { expiryDate: event.target.value })
                          }
                        />
                      </MillingField>
                    </>
                  ) : (
                    <div className="flex items-end text-[11px] text-muted-foreground">
                      لا توجد دفعة لهذا الصنف.
                    </div>
                  )}
                  <div className="flex items-end justify-end">
                    <button
                      type="button"
                      aria-label="حذف الناتج"
                      onClick={() =>
                        setOutputs((current) =>
                          current.length > 1
                            ? current.filter((_, i) => i !== index)
                            : [blankOutput()],
                        )
                      }
                      className="rounded-full p-2 text-muted-foreground hover:bg-rose-500/10 hover:text-rose-600"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </MillingPanel>

        <MillingPanel>
          <MillingSectionTitle
            title="تكاليف التحويل المؤهلة"
            subtitle="حمّل أجور العمالة والطاقة والتعبئة المرتبطة بالإنتاج من مصروف مرحّل، بالقيمة الصافية دون ضريبة المدخلات."
            action={
              <button
                type="button"
                disabled={!expenseSources.length || !data?.canAllocateExpenses}
                onClick={() =>
                  setExpenses((current) => [
                    ...current,
                    { expenseLineId: "", amount: "", basis: "", note: "" },
                  ])
                }
                className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-2 text-xs font-bold disabled:opacity-50"
              >
                <Plus className="h-4 w-4" /> تخصيص مصروف
              </button>
            }
          />
          <div className="space-y-3 p-4">
            {expenseSources.length === 0 && (
              <p className="text-xs text-muted-foreground">
                {data?.canAllocateExpenses
                  ? "لا توجد بنود مصروف مرحّلة متاحة لمركز التكلفة المحدد."
                  : "تحتاج صلاحية مالية لعرض المصروفات وتخصيصها."}{" "}
                المصروفات العامة والإدارية لا تُرسمل تلقائياً.
              </p>
            )}
            {expenses.map((line, index) => {
              const source = expenseSources.find(
                (item) => item.expense_line_id === line.expenseLineId,
              );
              return (
                <div
                  key={index}
                  className="grid gap-3 rounded-xl border border-border/60 p-3 sm:grid-cols-2 xl:grid-cols-[2fr_1fr_1.5fr_1.5fr_auto]"
                >
                  <MillingField label="مصدر المصروف">
                    <MillingSelect
                      value={line.expenseLineId}
                      onChange={(event) => {
                        const selected = expenseSources.find(
                          (item) => item.expense_line_id === event.target.value,
                        );
                        setExpenses((current) =>
                          current.map((item, i) =>
                            i === index
                              ? {
                                  ...item,
                                  expenseLineId: event.target.value,
                                  amount: selected
                                    ? String(selected.available_amount)
                                    : item.amount,
                                }
                              : item,
                          ),
                        );
                      }}
                    >
                      <option value="">اختر بنداً مرحّلاً</option>
                      {expenseSources.map((item) => (
                        <option key={item.expense_line_id} value={item.expense_line_id}>
                          {item.reference} · {item.category_name} · متاح{" "}
                          {fmtNum(Number(item.available_amount))}
                        </option>
                      ))}
                    </MillingSelect>
                    {source && (
                      <span className="mt-1 block text-[11px] text-muted-foreground">
                        {source.description} · صافي البند {fmtNum(Number(source.net_amount))}
                      </span>
                    )}
                  </MillingField>
                  <MillingField label="المبلغ المحمل">
                    <MillingInput
                      type="number"
                      min="0"
                      step="0.01"
                      max={source?.available_amount}
                      value={line.amount}
                      onChange={(event) =>
                        setExpenses((current) =>
                          current.map((item, i) =>
                            i === index ? { ...item, amount: event.target.value } : item,
                          ),
                        )
                      }
                    />
                  </MillingField>
                  <MillingField label="أساس التوزيع">
                    <MillingInput
                      value={line.basis}
                      onChange={(event) =>
                        setExpenses((current) =>
                          current.map((item, i) =>
                            i === index ? { ...item, basis: event.target.value } : item,
                          ),
                        )
                      }
                      placeholder="مثال: ساعات تشغيل الماكينة"
                    />
                  </MillingField>
                  <MillingField label="ملاحظة">
                    <MillingInput
                      value={line.note}
                      onChange={(event) =>
                        setExpenses((current) =>
                          current.map((item, i) =>
                            i === index ? { ...item, note: event.target.value } : item,
                          ),
                        )
                      }
                      placeholder="اختياري"
                    />
                  </MillingField>
                  <div className="flex items-end justify-end">
                    <button
                      type="button"
                      aria-label="حذف تخصيص المصروف"
                      onClick={() =>
                        setExpenses((current) => current.filter((_, i) => i !== index))
                      }
                      className="rounded-full p-2 text-muted-foreground hover:bg-rose-500/10 hover:text-rose-600"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </MillingPanel>

        <MillingPanel>
          <MillingSectionTitle
            title="الفاقد الإنتاجي"
            subtitle="سجل الفاقد بوحدة كتلية؛ الطبيعي يُحمّل على المنتجات الجيدة، وغير الطبيعي يذهب إلى مصروف الفاقد."
            action={
              <button
                type="button"
                disabled={!massUnits.length}
                onClick={() =>
                  setLosses((current) => [
                    ...current,
                    { type: "NORMAL", quantity: "", uomId: kiloUnit?.id ?? "", reason: "" },
                  ])
                }
                className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-2 text-xs font-bold disabled:opacity-50"
              >
                <Plus className="h-4 w-4" /> إضافة فاقد
              </button>
            }
          />
          {losses.length > 0 && (
            <div className="space-y-3 p-4">
              {losses.map((line, index) => (
                <div
                  key={index}
                  className="grid gap-3 rounded-xl border border-border/60 p-3 sm:grid-cols-2 xl:grid-cols-[1fr_1fr_1fr_2fr_auto]"
                >
                  <MillingField label="تصنيف الفاقد">
                    <MillingSelect
                      value={line.type}
                      onChange={(event) =>
                        setLosses((current) =>
                          current.map((item, i) =>
                            i === index
                              ? { ...item, type: event.target.value as LossDraft["type"] }
                              : item,
                          ),
                        )
                      }
                    >
                      <option value="NORMAL">طبيعي</option>
                      <option value="ABNORMAL">غير طبيعي</option>
                    </MillingSelect>
                  </MillingField>
                  <MillingField label="الكمية">
                    <MillingInput
                      type="number"
                      min="0"
                      step="0.001"
                      value={line.quantity}
                      onChange={(event) =>
                        setLosses((current) =>
                          current.map((item, i) =>
                            i === index ? { ...item, quantity: event.target.value } : item,
                          ),
                        )
                      }
                    />
                  </MillingField>
                  <MillingField label="وحدة الكتلة">
                    <MillingSelect
                      value={line.uomId}
                      onChange={(event) =>
                        setLosses((current) =>
                          current.map((item, i) =>
                            i === index ? { ...item, uomId: event.target.value } : item,
                          ),
                        )
                      }
                    >
                      {massUnits.map((unit) => (
                        <option key={unit.id} value={unit.id}>
                          {unit.name_ar || unit.short_name}
                        </option>
                      ))}
                    </MillingSelect>
                  </MillingField>
                  <MillingField label="سبب الفاقد">
                    <MillingInput
                      value={line.reason}
                      onChange={(event) =>
                        setLosses((current) =>
                          current.map((item, i) =>
                            i === index ? { ...item, reason: event.target.value } : item,
                          ),
                        )
                      }
                      placeholder="يُطلب عند تسجيل الفاقد"
                    />
                  </MillingField>
                  <div className="flex items-end justify-end">
                    <button
                      type="button"
                      aria-label="حذف الفاقد"
                      onClick={() => setLosses((current) => current.filter((_, i) => i !== index))}
                      className="rounded-full p-2 text-muted-foreground hover:bg-rose-500/10 hover:text-rose-600"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </MillingPanel>

        <div className="flex flex-col gap-3 rounded-2xl border border-amber-500/25 bg-amber-500/5 p-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="max-w-3xl text-xs leading-relaxed text-muted-foreground">
            عند الترحيل تُحفظ التشغيلة وحركات المخزون والدفعات وقيود اليومية معاً. لا تدخل حبوب
            العميل أو أجرة طحنه هنا؛ مسار الأمانة والخدمة مستقل.
          </p>
          <button
            type="button"
            disabled={!formValid || submit.isPending}
            onClick={() => submit.mutate()}
            className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-bold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
          >
            <CheckCircle2 className="h-4 w-4" />{" "}
            {submit.isPending ? "جارٍ ترحيل التشغيلة…" : "ترحيل تشغيلة الإنتاج"}
          </button>
        </div>

        <MillingPanel>
          <MillingSectionTitle
            title="تشغيلات الإنتاج المسجلة"
            subtitle="قيمة المخزون المنتج تبقى مرتبطة بحركة استلامه. يمكن عكس التشغيلة إذا لم يكن للناتج رصيد سابق ولم تقع حركات لاحقة على المدخلات أو النواتج."
          />
          <div className="overflow-x-auto p-3">
            <table className="w-full min-w-[760px] text-start text-xs">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className="p-2">رقم التشغيلة</th>
                  <th className="p-2">التاريخ</th>
                  <th className="p-2">الحالة</th>
                  <th className="p-2">المواد</th>
                  <th className="p-2">التحويل</th>
                  <th className="p-2">إجمالي التكلفة</th>
                  <th className="p-2">تكلفة النواتج</th>
                  {(hasRole("owner") || hasRole("manager") || hasRole("accountant")) && (
                    <th className="p-2">الإجراء</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {(data?.orders ?? []).map((order) => (
                  <tr key={order.id} className="border-b border-border/50">
                    <td className="p-2 font-mono">{order.order_number}</td>
                    <td className="p-2">{order.production_date}</td>
                    <td
                      className="p-2"
                      title={order.reversal_reason ?? undefined}
                    >
                      {order.status === "POSTED"
                        ? "مرحّلة"
                        : order.status === "REVERSED"
                          ? "معكوسة"
                          : order.status === "CANCELLED"
                            ? "ملغاة"
                            : order.status}
                    </td>
                    <td className="p-2">{fmtNum(Number(order.material_cost))}</td>
                    <td className="p-2">{fmtNum(Number(order.conversion_cost))}</td>
                    <td className="p-2 font-bold">{fmtNum(Number(order.total_cost))}</td>
                    <td className="p-2">{fmtNum(Number(order.output_cost))}</td>
                    {(hasRole("owner") || hasRole("manager") || hasRole("accountant")) && (
                      <td className="p-2">
                        {order.status === "POSTED" && (
                          <button
                            type="button"
                            disabled={productionReversal.isPending}
                            title="عكس التشغيلة قبل الحركات اللاحقة"
                            aria-label={`عكس تشغيلة الإنتاج ${order.order_number}`}
                            onClick={() => {
                              const reason = window.prompt(
                                `سبب عكس تشغيلة الإنتاج ${order.order_number}`,
                              );
                              if (reason?.trim()) {
                                productionReversal.mutate({ orderId: order.id, reason: reason.trim() });
                              }
                            }}
                            className="inline-flex size-8 items-center justify-center rounded-full text-muted-foreground hover:bg-amber-500/10 hover:text-amber-700 disabled:opacity-50"
                          >
                            <RotateCcw className="size-4" />
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
                {!data?.orders.length && (
                  <tr>
                    <td
                      colSpan={
                        hasRole("owner") || hasRole("manager") || hasRole("accountant") ? 8 : 7
                      }
                      className="p-8 text-center text-muted-foreground"
                    >
                      لا توجد تشغيلات إنتاج مسجلة.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </MillingPanel>
      </div>
    </ModuleGuard>
  );
}

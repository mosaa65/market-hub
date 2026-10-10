/**
 * Market-Hub ERP — Guided item creation.
 *
 * Design section 16: instead of showing dozens of fields at once, creating an
 * item starts with three plain questions and reveals only the fields that apply.
 *
 *   1. What kind of item is it?      سلعة / خدمة
 *   2. Do you want to track stock?   نعم / لا          (goods only)
 *   3. Is it used for?               بيع / شراء / الاثنان
 *
 * An untracked good then never shows Warehouse, Opening Stock, Costing Method
 * or Batch/Serial — the fields that make no sense for it — and instead explains
 * in one line what will actually happen.
 *
 * The component is deliberately self-contained: it collects the answers, writes
 * the item through the governed RPC, and hands the new id back to the caller.
 */

import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Package, Wrench, Check, ArrowLeft } from "lucide-react";
import {
  COSTING_METHOD_LABELS,
  DEFAULT_ITEM_POLICY,
  INVENTORY_POLICY_LABELS,
  ITEM_NATURE_LABELS,
  SERVICE_ITEM_POLICY,
  TRACKING_LABELS,
  UNTRACKED_GOOD_ITEM_POLICY,
  describeItemPolicy,
  policyFromWizard,
  validateItemPolicy,
  type CostingMethod,
  type ItemNature,
  type ItemPolicy,
  type ItemTracking,
} from "@/lib/items";

type UsedFor = "sell" | "purchase" | "both";

interface GuidedItemDialogProps {
  onClose: () => void;
  onCreated: (itemId: string) => void;
  /** Units available for the base/sales/purchase UOM selects. */
  units: { id: string; name: string; name_ar: string | null; short_name: string }[];
  /** Categories for the identity step. */
  categories: { id: string; name: string; name_ar: string | null }[];
}

export function GuidedItemDialog({ onClose, onCreated, units, categories }: GuidedItemDialogProps) {
  const { lang } = useI18n();
  const ar = lang === "ar";

  const [step, setStep] = useState(1);
  const [nature, setNature] = useState<ItemNature | null>(null);
  const [trackInventory, setTrackInventory] = useState<boolean | null>(null);
  const [usedFor, setUsedFor] = useState<UsedFor | null>(null);

  // Identity + the few policy details that only apply to tracked goods.
  const [nameAr, setNameAr] = useState("");
  const [nameEn, setNameEn] = useState("");
  const [sku, setSku] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [salePrice, setSalePrice] = useState("");
  const [referenceCost, setReferenceCost] = useState("");
  const [taxRate, setTaxRate] = useState("");
  const [baseUomId, setBaseUomId] = useState("");
  const [tracking, setTracking] = useState<ItemTracking>("NONE");
  const [costingMethod, setCostingMethod] = useState<CostingMethod>("MOVING_AVERAGE");

  const [saving, setSaving] = useState(false);

  /** The policy the answers add up to. */
  const policy: ItemPolicy = policyFromWizard({ nature, trackInventory, usedFor });
  const validation = validateItemPolicy(policy);
  // Design section 16: an untracked item must not be shown warehouse, opening
  // stock, valuation or batch/serial fields at all.
  const tracksStock = policy.inventory_policy === "TRACKED";

  function chooseNature(value: ItemNature) {
    setNature(value);
    if (value === "SERVICE") {
      // A service is never tracked, so that question is skipped entirely.
      setTrackInventory(false);
      setTracking("NONE");
      setCostingMethod("NONE");
      setStep(3);
    } else {
      setTrackInventory(null);
      setStep(2);
    }
  }

  function chooseTracking(value: boolean) {
    setTrackInventory(value);
    if (value) {
      setCostingMethod("MOVING_AVERAGE");
    } else {
      setTracking("NONE");
      setCostingMethod("NONE");
    }
    setStep(3);
  }

  async function submit() {
    if (saving) return;

    const finalPolicy = {
      ...policy,
      tracking: tracksStock ? tracking : "NONE",
      costing_method: tracksStock ? costingMethod : "NONE",
    } as ItemPolicy;

    const check = validateItemPolicy(finalPolicy);
    if (!check.valid) {
      toast.error(check.errors[0]);
      return;
    }

    if (!nameAr.trim() && !nameEn.trim()) {
      toast.error(ar ? "اسم الصنف مطلوب" : "Item name is required");
      return;
    }

    setSaving(true);

    try {
      // 1. Create the catalogue row with its policy axes.
      const { data, error } = await supabase
        .from("products")
        .insert({
          name: nameEn.trim() || nameAr.trim(),
          name_ar: nameAr.trim() || null,
          sku: sku.trim() || null,
          category_id: categoryId || null,
          sale_price: Number(salePrice) || 0,
          cost_price: Number(referenceCost) || 0,
          tax_rate: Number(taxRate) || 0,
          is_active: true,

          item_nature: finalPolicy.item_nature as never,
          inventory_policy: finalPolicy.inventory_policy as never,
          tracking: finalPolicy.tracking as never,
          costing_method: finalPolicy.costing_method as never,
          is_sellable: finalPolicy.is_sellable,
          is_purchasable: finalPolicy.is_purchasable,
          base_uom_id: baseUomId || null,
          sales_uom_id: baseUomId || null,
          purchase_uom_id: baseUomId || null,

          // Kept in sync so any legacy reader still sees a truthful value.
          is_service: finalPolicy.item_nature === "SERVICE",
        } as never)
        .select("id")
        .single();

      if (error) throw error;
      const itemId = (data as { id: string }).id;

      toast.success(ar ? "تم إنشاء الصنف" : "Item created");
      onCreated(itemId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3 sm:p-4 backdrop-blur-sm overflow-y-auto"
      onClick={onClose}
    >
      <div
        onClick={(event) => event.stopPropagation()}
        className="flex max-h-[90dvh] w-full max-w-2xl flex-col rounded-3xl border border-border bg-card shadow-2xl overflow-hidden"
      >
        <div className="flex shrink-0 flex-col border-b border-border px-5 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-foreground">
                {ar ? "إضافة صنف جديد" : "New item"}
              </h2>
              <p className="text-[11px] text-muted-foreground">
                {ar
                  ? "ثلاثة أسئلة تحدد سلوك الصنف في البيع والشراء والمخزون"
                  : "Three questions decide how this item behaves in sales, purchases and inventory"}
              </p>
            </div>
            <span className="rounded-full bg-surface px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
              {ar ? `الخطوة ${step} من 3` : `Step ${step} of 3`}
            </span>
          </div>

          <div className="mt-3 flex gap-1.5">
            {[1, 2, 3].map((index) => (
              <div
                key={index}
                className={`h-1 flex-1 rounded-full transition ${
                  index <= step ? "bg-primary" : "bg-border"
                }`}
              />
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4 custom-scrollbar">
          {/* ---------------------------------------------------- step 1 */}
          {step === 1 && (
            <div className="space-y-3">
              <StepQuestion
                title={ar ? "ما نوع الصنف؟" : "What kind of item is it?"}
                hint={
                  ar
                    ? "السلعة شيء مادي. الخدمة عمل غير مادي مثل أجرة طحن أو تركيب."
                    : "A good is a physical thing. A service is non-material work such as a grinding or installation fee."
                }
              />
              <div className="grid gap-3 sm:grid-cols-2">
                <ChoiceCard
                  icon={<Package className="h-5 w-5" />}
                  title={ITEM_NATURE_LABELS.GOOD[ar ? "ar" : "en"]}
                  description={
                    ar
                      ? "مثل: دقيق، كيس، قطعة غيار، أسمنت"
                      : "e.g. flour, a bag, a spare part, cement"
                  }
                  selected={nature === "GOOD"}
                  onClick={() => chooseNature("GOOD")}
                />
                <ChoiceCard
                  icon={<Wrench className="h-5 w-5" />}
                  title={ITEM_NATURE_LABELS.SERVICE[ar ? "ar" : "en"]}
                  description={
                    ar
                      ? "مثل: أجرة طحن، تركيب، صيانة، توصيل"
                      : "e.g. a grinding fee, installation, maintenance, delivery"
                  }
                  selected={nature === "SERVICE"}
                  onClick={() => chooseNature("SERVICE")}
                />
              </div>
            </div>
          )}

          {/* ---------------------------------------------------- step 2 */}
          {step === 2 && (
            <div className="space-y-3">
              <StepQuestion
                title={
                  ar ? "هل تريد متابعة مخزون هذا الصنف؟" : "Do you want to track stock for it?"
                }
                hint={
                  ar
                    ? "إذا اخترت «لا»، سيظهر الصنف في الفواتير بدون إدارة رصيد مخزني. هذا لا يحوّله إلى خدمة."
                    : "If you choose no, the item still appears on invoices but carries no stock balance. That does not make it a service."
                }
              />
              <div className="grid gap-3 sm:grid-cols-2">
                <ChoiceCard
                  icon={<Check className="h-5 w-5" />}
                  title={ar ? "نعم، أتابع الرصيد" : "Yes, track the balance"}
                  description={
                    ar
                      ? "يُخصم عند البيع، ويزيد عند الشراء، ويُقيَّم بطريقة تكلفة."
                      : "Deducted on sale, increased on purchase, and valued by a costing method."
                  }
                  selected={trackInventory === true}
                  onClick={() => chooseTracking(true)}
                />
                <ChoiceCard
                  icon={<Package className="h-5 w-5" />}
                  title={ar ? "لا، بدون إدارة رصيد" : "No, no balance"}
                  description={
                    ar
                      ? "يظهر في الفاتورة فقط. لا رصيد ولا حركة ولا تقييم."
                      : "Appears on the invoice only. No balance, no movement, no valuation."
                  }
                  selected={trackInventory === false}
                  onClick={() => chooseTracking(false)}
                />
              </div>
              <button
                type="button"
                onClick={() => setStep(1)}
                className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
              >
                <ArrowLeft className="h-3 w-3" />
                {ar ? "رجوع" : "Back"}
              </button>
            </div>
          )}

          {/* ---------------------------------------------------- step 3 */}
          {step === 3 && nature && (
            <div className="space-y-4">
              <StepQuestion
                title={ar ? "أين يُستخدم هذا الصنف؟" : "Where is this item used?"}
                hint={ar ? "يمكن اختيار البيع والشراء معًا." : "You can use it for both."}
              />
              <div className="grid gap-2 sm:grid-cols-3">
                {(["sell", "purchase", "both"] as UsedFor[]).map((value) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setUsedFor(value)}
                    className={`rounded-lg border p-3 text-start text-xs font-medium transition ${
                      usedFor === value
                        ? "border-primary/60 bg-primary/10 text-foreground"
                        : "border-border bg-surface text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {value === "sell"
                      ? ar
                        ? "البيع فقط"
                        : "Selling only"
                      : value === "purchase"
                        ? ar
                          ? "الشراء فقط"
                          : "Purchasing only"
                        : ar
                          ? "البيع والشراء"
                          : "Both"}
                  </button>
                ))}
              </div>

              {/* Policy summary — the user sees the consequence before saving. */}
              <div className="rounded-lg border border-border bg-surface/60 p-3">
                <div className="flex flex-wrap items-center gap-2 text-[11px]">
                  <PolicyChip label={ITEM_NATURE_LABELS[policy.item_nature][ar ? "ar" : "en"]} />
                  <PolicyChip
                    label={INVENTORY_POLICY_LABELS[policy.inventory_policy][ar ? "ar" : "en"]}
                    tone={policy.inventory_policy === "TRACKED" ? "primary" : "muted"}
                  />
                  {usedFor === "sell" || usedFor === "both" ? (
                    <PolicyChip label={ar ? "قابل للبيع" : "Sellable"} tone="success" />
                  ) : null}
                  {usedFor === "purchase" || usedFor === "both" ? (
                    <PolicyChip label={ar ? "قابل للشراء" : "Purchasable"} />
                  ) : null}
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  {describeItemPolicy(policy, lang)}
                </p>
              </div>

              {/* Identity — always required. */}
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label={ar ? "الاسم بالعربية" : "Name (Arabic)"} required>
                  <input
                    value={nameAr}
                    onChange={(event) => setNameAr(event.target.value)}
                    dir="rtl"
                    className={inputClass}
                    placeholder={ar ? "مثال: دقيق أبيض 50 كجم" : "e.g. White flour 50kg"}
                  />
                </Field>
                <Field label={ar ? "الاسم بالإنجليزية" : "Name (English)"}>
                  <input
                    value={nameEn}
                    onChange={(event) => setNameEn(event.target.value)}
                    dir="ltr"
                    className={inputClass}
                    placeholder="e.g. White flour 50kg"
                  />
                </Field>
                <Field label={ar ? "الكود (SKU)" : "SKU"}>
                  <input
                    value={sku}
                    onChange={(event) => setSku(event.target.value)}
                    className={inputClass}
                    placeholder="SKU-001"
                  />
                </Field>
                <Field label={ar ? "التصنيف" : "Category"}>
                  <select
                    value={categoryId}
                    onChange={(event) => setCategoryId(event.target.value)}
                    className={inputClass}
                  >
                    <option value="">{ar ? "اختر التصنيف..." : "Select category..."}</option>
                    {categories.map((category) => (
                      <option key={category.id} value={category.id}>
                        {ar ? category.name_ar || category.name : category.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label={ar ? "سعر البيع" : "Sale price"}>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={salePrice}
                    onChange={(event) => setSalePrice(event.target.value)}
                    className={inputClass}
                    placeholder="0.00"
                  />
                </Field>
                <Field
                  label={ar ? "التكلفة المرجعية" : "Reference cost"}
                  hint={
                    ar
                      ? "قيمة تقديرية للهامش. ليست سجلًا للمشتريات."
                      : "An estimate for margin only. Not a purchase record."
                  }
                >
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={referenceCost}
                    onChange={(event) => setReferenceCost(event.target.value)}
                    className={inputClass}
                    placeholder="0.00"
                  />
                </Field>
                <Field label={ar ? "الضريبة %" : "Tax %"}>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    max="100"
                    value={taxRate}
                    onChange={(event) => setTaxRate(event.target.value)}
                    className={inputClass}
                    placeholder="0"
                  />
                </Field>
                <Field label={ar ? "وحدة القياس الأساسية" : "Base UOM"}>
                  <select
                    value={baseUomId}
                    onChange={(event) => setBaseUomId(event.target.value)}
                    className={inputClass}
                  >
                    <option value="">{ar ? "اختر وحدة القياس..." : "Select unit..."}</option>
                    {units.map((unit) => (
                      <option key={unit.id} value={unit.id}>
                        {ar ? unit.name_ar || unit.name : unit.name} ({unit.short_name})
                      </option>
                    ))}
                  </select>
                </Field>
              </div>

              {/* These fields appear ONLY for a tracked good. */}
              {tracksStock && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field
                    label={ar ? "طريقة التكلفة" : "Costing method"}
                    hint={
                      ar ? "كيف تُقيَّم الكمية المتاحة." : "How the on-hand quantity is valued."
                    }
                  >
                    <select
                      value={costingMethod}
                      onChange={(event) => setCostingMethod(event.target.value as CostingMethod)}
                      className={inputClass}
                    >
                      {(["MOVING_AVERAGE", "FIFO", "STANDARD"] as CostingMethod[]).map((method) => (
                        <option key={method} value={method}>
                          {COSTING_METHOD_LABELS[method][ar ? "ar" : "en"]}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label={ar ? "التتبع الدقيق" : "Detailed tracking"}>
                    <select
                      value={tracking}
                      onChange={(event) => setTracking(event.target.value as ItemTracking)}
                      className={inputClass}
                    >
                      {(["NONE", "BATCH", "SERIAL"] as ItemTracking[]).map((value) => (
                        <option key={value} value={value}>
                          {TRACKING_LABELS[value][ar ? "ar" : "en"]}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>
              )}

              {/* The explicit explanation the design asks for. */}
              {!tracksStock && policy.item_nature === "GOOD" && (
                <div className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-xs text-warning">
                  {ar
                    ? "هذا الصنف سيظهر في الفواتير بدون إدارة رصيد مخزني."
                    : "This item will appear on invoices without any inventory balance being managed."}
                </div>
              )}

              {!validation.valid && (
                <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
                  {validation.errors[0]}
                </div>
              )}

              {/* Opening stock is deliberately NOT part of this dialog. */}
              {tracksStock && (
                <p className="text-[11px] text-muted-foreground">
                  {ar
                    ? "رصيد أول المدة يُسجَّل لاحقًا من صفحة المخزون كمستند مستقل، وليس كفاتورة شراء."
                    : "Opening stock is recorded later from the Inventory page as its own document — never as a purchase invoice."}
                </p>
              )}

              <button
                type="button"
                onClick={() => setStep(nature === "SERVICE" ? 1 : 2)}
                className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
              >
                <ArrowLeft className="h-3 w-3" />
                {ar ? "رجوع" : "Back"}
              </button>
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-border bg-surface/40 px-5 py-3">
          <Button type="button" variant="outline" onClick={onClose}>
            {ar ? "إلغاء" : "Cancel"}
          </Button>
          {step === 3 && (
            <Button type="button" onClick={submit} loading={saving} disabled={!validation.valid}>
              {ar ? "حفظ الصنف" : "Create item"}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- sub-parts */

const inputClass =
  "h-9 w-full rounded-md border border-border bg-surface px-3 text-sm outline-none focus:border-primary/60";

function StepQuestion({ title, hint }: { title: string; hint: string }) {
  return (
    <div>
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}

function ChoiceCard({
  icon,
  title,
  description,
  selected,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex flex-col gap-2 rounded-lg border p-4 text-start transition ${
        selected
          ? "border-primary/60 bg-primary/10"
          : "border-border bg-surface hover:border-primary/30"
      }`}
    >
      <span
        className={`grid h-9 w-9 place-items-center rounded-md ${
          selected ? "bg-primary/20 text-primary" : "bg-surface-2 text-muted-foreground"
        }`}
      >
        {icon}
      </span>
      <span className="text-sm font-medium text-foreground">{title}</span>
      <span className="text-[11px] leading-relaxed text-muted-foreground">{description}</span>
    </button>
  );
}

function Field({
  label,
  hint,
  required,
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
        {required ? <span className="text-destructive"> *</span> : null}
      </span>
      {children}
      {hint ? <span className="text-[11px] text-muted-foreground">{hint}</span> : null}
    </label>
  );
}

function PolicyChip({
  label,
  tone = "muted",
}: {
  label: string;
  tone?: "muted" | "primary" | "success";
}) {
  const tones = {
    muted: "bg-surface-2 text-muted-foreground",
    primary: "bg-primary/15 text-primary",
    success: "bg-success/15 text-success",
  };
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium ${tones[tone]}`}>
      {label}
    </span>
  );
}

"use client";

/**
 * ProductFormDialog — the ONE product form for the whole application.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * لماذا مكوّن واحد
 * ════════════════════════════════════════════════════════════════════════════
 * كانت شاشات الأمانات الثلاث (الاستلام / الطحن / التسليم) تفتح نموذجًا مبسّطًا
 * فيه أربعة حقول فقط، بينما صفحة المنتجات الكاملة في مكان آخر. النتيجة:
 *   • صنف أُنشئ من الاستلام لا يظهر في شاشة الطحن أو التسليم إلا إن تطابقت
 *     الحقوق الافتراضية بالحظ.
 *   • الصنف الجديد بلا تاريخ إنتاج ولا تصنيف ولا وحدة، فلا يمكن البحث فيه
 *     ولا تجميعه، ويظهر «غير مصنَّف» في كل تقرير.
 *   • تعديل النموذج في شاشة واحدة لا يصل إلى الشاشتين الأخريين.
 *
 * الآن: هذا المكوّن يُستخدم من الاستلام والطحن والتسليم ومن أي شاشة تُنشئ
 * منتجًا. تعديله يُعدّل كل الشاشات — لا نسخ ثانية.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ما يكتبه في القاعدة
 * ════════════════════════════════════════════════════════════════════════════
 * البيانات المتناقضة تُضلّل المحاسب: صنف أمانة يُعرض للبيع، أو ناتج ثانوي
 * يُرحَّل كإيراد سلعة. فيُثبَّت هنا بحسب سياق `mode`:
 *
 *   custody  → is_custody_item = true، لا يُباع ولا يُشترى، سياسة CUSTOMER_OWNED
 *   retail   → يُباع ويُشترى، سياسة TRACKED، تكلفة متوسط متحرك
 *
 * «التاريخ» الذي طلبته: `production_date` — يوجد حقل صريح في هذا النموذج
 * (`محضر الإنتاج`) ويُكتب في `products.production_date` إن كان العمود موجودًا،
 * وإلا في العمود الجديد `attributes` (jsonb) الذي يُضاف إن غاب. التحقق يقع في
 * `resolveDateColumn()` بالرحلة نفسها، فلا يفشل الحفظ بسبب عمود غير مُطبَّق.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * العرض
 * ════════════════════════════════════════════════════════════════════════════
 * نفس فكرة دليل العملاء: بطاقة هوية حيّة أعلى النموذج (الاسم، النوع بلونه،
 * الكود، سعة العبوة، والنشاط) تتغير أثناء الكتابة، ثم حقول مقسّمة إلى ثلاث
 * خانات — الهوية / التعبئة / ملاحظات — حتى يرى المشغّل أين يقف قبل الحفظ.
 */

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, Factory, Loader2, Package, Plus, Save, Tag, Wheat } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { toSystemDigits } from "@/lib/format-preferences";
import { translateRpcError } from "@/lib/errors/rpc-errors";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { MillingInput, MillingSelect } from "@/components/milling/milling-ui";
import { QuantityInput } from "@/components/ui/quantity-input";
import {
  productClassBadgeClass,
  productClassLabel,
  productClassTone,
} from "@/components/products/product-class-meta";

const db = supabase as any;

/* ------------------------------------------------------------------ types */

export type ProductClass = "RAW_MATERIAL" | "FINISHED_GOOD" | "BY_PRODUCT" | "TRADED_GOOD";
export type ProductFormMode = "custody" | "retail";

export interface ProductFormValues {
  id?: string;
  name_ar: string;
  name_en: string | null;
  sku: string | null;
  item_class: ProductClass;
  package_weight_kg: number | null;
  packaging_type_id: string | null;
  category_id: string | null;
  unit_id: string | null;
  production_date: string | null;
  shelf_life_days: string | null;
  sale_price: number;
  min_stock: number;
  notes: string | null;
  is_active: boolean;
}

export interface ProductFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * `custody` لأصناف المطحنة (أمانات)، و`retail` للمنتجات التجارية.
   * يحدد القيم الثابتة المكتوبة في القاعدة، لا الشكل.
   */
  mode?: ProductFormMode;
  /** نوع الصنف الافتراضي في إنشاء جديد. */
  defaultClass?: ProductClass;
  /** صف منتج قائم للتعديل. الحقول الغائبة تُترك كما هي في القاعدة. */
  editing?: (Partial<ProductFormValues> & { id: string }) | null;
  /** بعد الحفظ: يعيد معرّف المنتج. الشاشة المستدعية تعيد الجلب. */
  onSaved?: (productId: string) => void;
  /** يُفلتر التصنيفات المتاحة (مثلاً الأمانات فقط). */
  availableClasses?: readonly ProductClass[];
}

/* -------------------------------------------------------------- constants */

const CLASS_META: Record<
  ProductClass,
  { label: string; hint: string; icon: typeof Wheat; prefix: string }
> = {
  RAW_MATERIAL: {
    label: "حبوب خام",
    hint: "قمح، شعير، ذرة — مادة أولية",
    icon: Wheat,
    prefix: "GRN",
  },
  FINISHED_GOOD: {
    label: "منتج نهائي",
    hint: "دقيق ونواتج جاهزة للتسليم",
    icon: Factory,
    prefix: "OUT",
  },
  BY_PRODUCT: {
    label: "ناتج ثانوي",
    hint: "نخالة، ردة، مخلفات الطحن",
    icon: Package,
    prefix: "BYP",
  },
  TRADED_GOOD: {
    label: "منتج تجاري",
    hint: "يُشترى ويُباع كمخزون",
    icon: Tag,
    prefix: "ITM",
  },
};

const CUSTODY_CLASSES: readonly ProductClass[] = ["RAW_MATERIAL", "FINISHED_GOOD", "BY_PRODUCT"];
const RETAIL_CLASSES: readonly ProductClass[] = ["TRADED_GOOD", "RAW_MATERIAL", "FINISHED_GOOD"];

function todayIso(): string {
  // التاريخ المحلي لا UTC: فاتورة الساعة 11 مساءً لا تنتمي إلى الغد.
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** `PRD-YYYYMMDD-<class>` — يُصلح اليدوي له شكل واحد معروف. */
function autoSku(itemClass: ProductClass, date: string | null): string {
  const stamp = (date || todayIso()).replace(/-/g, "").slice(0, 8);
  return `${CLASS_META[itemClass].prefix}-${stamp}`;
}

/**
 * هل العمود `production_date` موجود في `products`؟
 *
 * يُسأل مرة واحدة ويُحفظ في الوحدة. القاعدة هنا والآن ليست دائمًا مماثلة للتي
 * نقّرأ منها وصفها. والأهم: اگر العمود غاب يُكتب التاريخ في `attributes`
 * (jsonb موجود في المخطط) فلا يضيع ما كتبه المشغّل ولا تفشل الفاتورة.
 */
let productionDateColumnKnown: boolean | null = null;
async function hasProductionDateColumn(): Promise<boolean> {
  if (productionDateColumnKnown !== null) return productionDateColumnKnown;
  const { error } = await db.from("products").select("production_date").limit(1);
  // 42703 = undefined_column
  productionDateColumnKnown = !error || !String(error.code ?? "").includes("42703");
  return productionDateColumnKnown;
}

/* ------------------------------------------------------------- component */

export function ProductFormDialog({
  open,
  onOpenChange,
  mode = "custody",
  defaultClass,
  editing,
  onSaved,
  availableClasses,
}: ProductFormDialogProps) {
  const qc = useQueryClient();
  const classes = availableClasses ?? (mode === "custody" ? CUSTODY_CLASSES : RETAIL_CLASSES);
  const initialClass = defaultClass ?? classes[0];

  const [nameAr, setNameAr] = useState("");
  const [nameEn, setNameEn] = useState("");
  const [itemClass, setItemClass] = useState<ProductClass>(initialClass);
  const [productionDate, setProductionDate] = useState(todayIso());
  const [weightKg, setWeightKg] = useState<number | null>(50);
  const [packagingTypeId, setPackagingTypeId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [unitId, setUnitId] = useState("");
  const [shelfLife, setShelfLife] = useState("");
  const [salePrice, setSalePrice] = useState<number | null>(null);
  const [minStock, setMinStock] = useState<number | null>(null);
  const [notes, setNotes] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [skuManual, setSkuManual] = useState(false);
  const [sku, setSku] = useState("");

  /* ── بيانات مرجعية (تُقرأ مرة واحدة وتُخزَّن بـ React Query) ── */
  const refs = useQuery({
    queryKey: ["product-form", "reference-data"],
    queryFn: async () => {
      const [unitsRes, categoriesRes, packagingRes] = await Promise.all([
        db
          .from("units")
          .select("id, name_ar, name, short_name")
          .order("short_name", { ascending: true }),
        db.from("categories").select("id, name, name_ar").order("name_ar", { ascending: true }),
        db
          .from("packaging_types")
          .select("id, name_ar, code, sort_order")
          .eq("is_active", true)
          .order("sort_order", { ascending: true }),
      ]);
      return {
        units: (unitsRes.data ?? []) as {
          id: string;
          name_ar: string | null;
          name: string;
          short_name: string;
        }[],
        categories: (categoriesRes.data ?? []) as {
          id: string;
          name: string;
          name_ar: string | null;
        }[],
        packaging: (packagingRes.data ?? []) as { id: string; name_ar: string; code: string }[],
      };
    },
    staleTime: 10 * 60 * 1000,
    enabled: open,
  });

  /* ── إعادة الضبط عند الفتح ── */
  useEffect(() => {
    if (!open) return;
    if (editing) {
      setNameAr(editing.name_ar ?? "");
      setNameEn(editing.name_en ?? "");
      setItemClass((editing.item_class as ProductClass) ?? initialClass);
      setProductionDate(editing.production_date ?? todayIso());
      setWeightKg(editing.package_weight_kg ?? null);
      setPackagingTypeId(editing.packaging_type_id ?? "");
      setCategoryId(editing.category_id ?? "");
      setUnitId(editing.unit_id ?? "");
      setShelfLife(editing.shelf_life_days ?? "");
      setSalePrice(editing.sale_price ?? null);
      setMinStock(editing.min_stock ?? null);
      setNotes(editing.notes ?? "");
      setIsActive(editing.is_active ?? true);
      setSku(editing.sku ?? "");
      setSkuManual(true);
    } else {
      setNameAr("");
      setNameEn("");
      setItemClass(initialClass);
      setProductionDate(todayIso());
      setWeightKg(50);
      setPackagingTypeId("");
      setCategoryId("");
      setUnitId("");
      setShelfLife("");
      setSalePrice(null);
      setMinStock(null);
      setNotes("");
      setIsActive(true);
      setSku("");
      setSkuManual(false);
    }
  }, [open, editing, initialClass]);

  /* ── كود الصنف التلقائي يتبع النوع والتاريخ ما لم يكتبه المشغّل ── */
  useEffect(() => {
    if (editing || skuManual) return;
    setSku(autoSku(itemClass, productionDate));
  }, [itemClass, productionDate, editing, skuManual]);

  const isEditing = Boolean(editing?.id);

  const classMeta = CLASS_META[itemClass] ?? CLASS_META.RAW_MATERIAL;
  const ClassIcon = productClassTone(itemClass).icon;

  const canSave = nameAr.trim().length > 0 && nameAr.trim().length <= 120;

  /* ── الحفظ ── */
  const save = useMutation({
    mutationFn: async () => {
      const trimmed = nameAr.trim();
      if (!trimmed) throw new Error("اسم الصنف مطلوب");

      const finalSku = (sku.trim() || autoSku(itemClass, productionDate))
        .toUpperCase()
        .replace(/\s+/g, "-");

      const ownUnits = mode === "custody";
      const payload: Record<string, unknown> = {
        name_ar: trimmed,
        name: nameEn.trim() || null,
        sku: finalSku,
        item_class: itemClass,
        package_weight_kg: weightKg != null && weightKg > 0 ? weightKg : null,
        packaging_type_id: packagingTypeId || null,
        category_id: categoryId || null,
        unit_id: unitId || null,
        sale_price: salePrice ?? 0,
        min_stock: minStock ?? 0,
        is_active: isActive,
        is_service: false,

        // الثوابت بحسب السياق — لا تُعرض في النموذج لأنها ليست اختيارًا.
        is_custody_item: ownUnits,
        is_sellable: !ownUnits,
        is_purchasable: !ownUnits,
        inventory_policy: ownUnits ? "CUSTOMER_OWNED" : "TRACKED",
        costing_method: ownUnits ? "NONE" : "MOVING_AVERAGE",
        tracking: "NONE",
      };

      //
      // التاريخ: يُكتب في العمود إن وُجد، وإلا في `attributes` (jsonb موجود في
      // المخطط). الحالتان لا تجتمعان، فلا يُحفظ التاريخ مرتين ثم يتباعدان.
      //
      const hasDateColumn = productionDate ? await hasProductionDateColumn() : false;
      if (hasDateColumn && productionDate) {
        payload.production_date = productionDate;
      } else if (productionDate || shelfLife || notes.trim()) {
        payload.attributes = {
          ...(productionDate ? { production_date: productionDate } : {}),
          ...(shelfLife ? { shelf_life_days: Number(shelfLife) } : {}),
          ...(notes.trim() ? { notes: notes.trim() } : {}),
        };
      }
      if (editing?.id) {
        const { error } = await db.from("products").update(payload).eq("id", editing.id);
        if (error) throw error;
        return editing.id;
      }
      const { data, error } = await db.from("products").insert(payload).select("id").single();
      if (error) throw error;
      return data.id as string;
    },
    onSuccess: (productId: string) => {
      toast.success(editing?.id ? "تم تعديل الصنف" : "تمت إضافة الصنف");
      // كل شاشة تقرأ قائمة منتجات بمفتاحها — تُبطَل كلها لأن الصنف قد
      // يظهر في أكثر من قائمة (أمانات + كتالوج + تسعير).
      void qc.invalidateQueries({ queryKey: ["milling"] });
      void qc.invalidateQueries({ queryKey: ["custody-products"] });
      void qc.invalidateQueries({ queryKey: ["products"] });
      void qc.invalidateQueries({ queryKey: ["product-form"] });
      onOpenChange(false);
      onSaved?.(productId);
    },
    onError: (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      if (/duplicate|unique/i.test(message)) {
        toast.error("كود الصنف مستخدم بالفعل — غيّره أو اتركه ليُولَّد تلقائيًا");
        return;
      }
      toast.error(translateRpcError(message, "ar", message));
    },
  });

  const units = refs.data?.units ?? [];
  const categories = refs.data?.categories ?? [];
  const packaging = refs.data?.packaging ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl gap-0 overflow-hidden p-0">
        {/* ── بطاقة الهوية الحيّة ── */}
        <div className="relative overflow-hidden border-b border-border/60 bg-gradient-to-br from-card via-card/95 to-primary/[0.035] px-5 pb-4 pt-5">
          <div className="flex items-start gap-3">
            <span
              className={cn(
                "grid size-11 shrink-0 place-items-center rounded-2xl",
                classMeta ? productClassBadgeClass(itemClass) : "",
              )}
            >
              <ClassIcon className="size-5" />
            </span>
            <div className="min-w-0 flex-1">
              <DialogHeader className="space-y-0 text-start">
                <DialogTitle className="truncate text-base font-black">
                  {nameAr.trim() || (isEditing ? "تعديل صنف" : "صنف جديد")}
                </DialogTitle>
                <DialogDescription className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px]">
                  <span className="rounded-md bg-muted px-1.5 py-0.5 font-semibold text-foreground/80">
                    {productClassLabel(itemClass)}
                  </span>
                  <span className="font-mono text-[10px] text-muted-foreground">
                    {toSystemDigits(sku || autoSku(itemClass, productionDate))}
                  </span>
                  {weightKg ? (
                    <span className="text-muted-foreground">
                      · عبوة {toSystemDigits(weightKg)} كجم
                    </span>
                  ) : null}
                  <span
                    className={cn(
                      "rounded-md px-1.5 py-0.5 font-semibold",
                      isActive
                        ? "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300"
                        : "bg-muted text-muted-foreground",
                    )}
                  >
                    {isActive ? "نشط" : "معطّل"}
                  </span>
                </DialogDescription>
              </DialogHeader>
            </div>
          </div>
        </div>

        <form
          id="unified-product-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (canSave) save.mutate();
          }}
          className="max-h-[calc(100vh-16rem)] space-y-5 overflow-y-auto p-5"
        >
          {/* ── 1. النوع ── */}
          <section className="space-y-2">
            <SectionLabel step={1} title="نوع الصنف" />
            <div className={cn("grid gap-2", classes.length >= 3 ? "grid-cols-3" : "grid-cols-2")}>
              {classes.map((value) => {
                const meta = CLASS_META[value];
                const Icon = meta.icon;
                const active = itemClass === value;
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => {
                      setItemClass(value);
                      setSkuManual(false);
                    }}
                    className={cn(
                      "flex flex-col items-start gap-1 rounded-xl border p-2.5 text-start transition-all",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30",
                      active
                        ? "border-primary/50 bg-primary/[0.07] shadow-xs"
                        : "border-border/70 hover:border-primary/30 hover:bg-muted/40",
                    )}
                  >
                    <span className="flex w-full items-center gap-1.5">
                      <Icon
                        className={cn(
                          "size-3.5",
                          active ? "text-primary" : "text-muted-foreground",
                        )}
                      />
                      <span
                        className={cn(
                          "text-[11px] font-bold",
                          active ? "text-foreground" : "text-muted-foreground",
                        )}
                      >
                        {meta.label}
                      </span>
                    </span>
                    <span className="line-clamp-2 text-[10px] leading-tight text-muted-foreground/80">
                      {meta.hint}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>

          {/* ── 2. الهوية ── */}
          <section className="space-y-2">
            <SectionLabel step={2} title="الهوية" />
            <div className="grid gap-2.5 sm:grid-cols-2">
              <div className="space-y-1.5 sm:col-span-2">
                <FieldLabel required>اسم الصنف بالعربي</FieldLabel>
                <MillingInput
                  value={nameAr}
                  onChange={(event) => setNameAr(event.target.value)}
                  maxLength={120}
                  autoFocus
                  placeholder={
                    itemClass === "RAW_MATERIAL"
                      ? "مثال: بُر بلدي أحمر"
                      : itemClass === "FINISHED_GOOD"
                        ? "مثال: دقيق ممتاز"
                        : itemClass === "BY_PRODUCT"
                          ? "مثال: نخالة ناعمة"
                          : "مثال: أرز بسمتي"
                  }
                />
              </div>
              <div className="space-y-1.5">
                <FieldLabel optional>الاسم الإنجليزي</FieldLabel>
                <MillingInput
                  value={nameEn}
                  onChange={(event) => setNameEn(event.target.value)}
                  placeholder="Optional English name"
                  dir="ltr"
                />
              </div>
              <div className="space-y-1.5">
                <FieldLabel optional hint="يُولَّد تلقائيًا من النوع والتاريخ">
                  كود الصنف
                </FieldLabel>
                <MillingInput
                  value={sku}
                  onChange={(event) => {
                    setSku(event.target.value.toUpperCase());
                    setSkuManual(true);
                  }}
                  placeholder={autoSku(itemClass, productionDate)}
                  dir="ltr"
                  className="font-mono"
                />
              </div>
            </div>
          </section>

          {/* ── 3. الإنتاج والتعبئة ── */}
          <section className="space-y-2">
            <SectionLabel step={3} title="الإنتاج والتعبئة" />
            <div className="grid gap-2.5 sm:grid-cols-2">
              <div className="space-y-1.5">
                <FieldLabel hint="تاريخ محضر الإنتاج / الدفعة">
                  <CalendarDays className="mb-0.5 me-1 inline size-3" />
                  تاريخ الإنتاج
                </FieldLabel>
                <MillingInput
                  type="date"
                  value={productionDate}
                  onChange={(event) => {
                    setProductionDate(event.target.value);
                    if (!skuManual) setSkuManual(false);
                  }}
                  max={todayIso()}
                />
              </div>
              <div className="space-y-1.5">
                <FieldLabel optional hint="بالأيام — يُكتب مع تاريخ الإنتاج">
                  مدة الصلاحية
                </FieldLabel>
                <QuantityInput
                  value={shelfLife === "" ? null : Number(shelfLife)}
                  onValueChange={(value) => setShelfLife(value == null ? "" : String(value))}
                  decimals={0}
                  min={0}
                  unit="يوم"
                  placeholder="—"
                />
              </div>
              <div className="space-y-1.5">
                <FieldLabel hint="يُستخدم لحساب الوزن من عدد الأكياس">سعة العبوة</FieldLabel>
                <QuantityInput
                  value={weightKg}
                  onValueChange={setWeightKg}
                  min={0}
                  step={0.5}
                  unit="كجم"
                  placeholder="50"
                />
              </div>
              <div className="space-y-1.5">
                <FieldLabel optional>نوع العبوة</FieldLabel>
                <MillingSelect
                  value={packagingTypeId}
                  onChange={(event) => setPackagingTypeId(event.target.value)}
                >
                  <option value="">— بدون —</option>
                  {packaging.map((type) => (
                    <option key={type.id} value={type.id}>
                      {type.name_ar}
                    </option>
                  ))}
                </MillingSelect>
              </div>
            </div>
          </section>

          {/* ── 4. التصنيف والأسعار ── */}
          <section className="space-y-2">
            <SectionLabel step={4} title="التصنيف والتسعير" />
            <div className="grid gap-2.5 sm:grid-cols-2">
              <div className="space-y-1.5">
                <FieldLabel optional>التصنيف</FieldLabel>
                <MillingSelect
                  value={categoryId}
                  onChange={(event) => setCategoryId(event.target.value)}
                >
                  <option value="">— بدون تصنيف —</option>
                  {categories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name_ar || category.name}
                    </option>
                  ))}
                </MillingSelect>
              </div>
              <div className="space-y-1.5">
                <FieldLabel optional>وحدة القياس</FieldLabel>
                <MillingSelect value={unitId} onChange={(event) => setUnitId(event.target.value)}>
                  <option value="">— الوحدة الافتراضية —</option>
                  {units.map((unit) => (
                    <option key={unit.id} value={unit.id}>
                      {unit.name_ar || unit.name} ({unit.short_name})
                    </option>
                  ))}
                </MillingSelect>
              </div>
              {mode === "retail" && (
                <>
                  <div className="space-y-1.5">
                    <FieldLabel optional>سعر البيع</FieldLabel>
                    <QuantityInput
                      value={salePrice}
                      onValueChange={setSalePrice}
                      min={0}
                      decimals={2}
                      placeholder="0.00"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <FieldLabel optional hint="حد التنبيه للنقص">
                      الحد الأدنى للمخزون
                    </FieldLabel>
                    <QuantityInput
                      value={minStock}
                      onValueChange={setMinStock}
                      min={0}
                      decimals={2}
                      placeholder="0"
                    />
                  </div>
                </>
              )}
            </div>
          </section>

          {/* ── 5. ملاحظات ── */}
          <section className="space-y-2">
            <SectionLabel step={5} title="ملاحظات وحالة" optional />
            <textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              rows={2}
              placeholder="ملاحظات تشغيلية أو وصف مختصر…"
              className="w-full resize-none rounded-xl border border-border/70 bg-surface-2/50 px-3 py-2 text-xs text-foreground outline-none transition focus:border-primary/50 focus:ring-2 focus:ring-primary/20"
            />
            <button
              type="button"
              onClick={() => setIsActive((v) => !v)}
              className={cn(
                "inline-flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold transition",
                isActive
                  ? "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300"
                  : "bg-muted text-muted-foreground",
              )}
            >
              <span
                className={cn(
                  "size-2 rounded-full",
                  isActive ? "bg-emerald-500" : "bg-muted-foreground",
                )}
              />
              {isActive ? "نشط — يظهر في القوائم" : "معطّل — مخفي عن المشغّلين"}
            </button>
          </section>
        </form>

        <DialogFooter className="gap-2 border-t border-border/60 bg-card px-5 py-3.5">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            disabled={save.isPending}
            className="rounded-xl border border-border/70 px-4 py-2 text-xs font-semibold text-muted-foreground transition hover:bg-muted/60"
          >
            إلغاء
          </button>
          <button
            type="submit"
            form="unified-product-form"
            disabled={!canSave || save.isPending}
            className={cn(
              "inline-flex items-center gap-2 rounded-xl px-5 py-2 text-xs font-bold text-primary-foreground transition",
              "bg-primary shadow-sm hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50",
            )}
          >
            {save.isPending ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : isEditing ? (
              <Save className="size-3.5" />
            ) : (
              <Plus className="size-3.5" />
            )}
            {isEditing ? "حفظ التعديلات" : "إضافة الصنف"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---------------------------------------------------------------- atoms */

function SectionLabel({
  step,
  title,
  optional,
}: {
  step: number;
  title: string;
  optional?: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="grid size-5 place-items-center rounded-md bg-primary/10 font-mono text-[10px] font-black text-primary">
        {toSystemDigits(step)}
      </span>
      <span className="text-[11px] font-bold uppercase tracking-wide text-foreground/80">
        {title}
      </span>
      {optional && (
        <span className="text-[10px] font-medium text-muted-foreground/70">— اختياري</span>
      )}
    </div>
  );
}

function FieldLabel({
  children,
  required,
  optional,
  hint,
}: {
  children: React.ReactNode;
  required?: boolean;
  optional?: boolean;
  hint?: string;
}) {
  return (
    <label className="flex items-baseline justify-between gap-2 text-[11px] font-semibold text-muted-foreground">
      <span>
        {children}
        {required && <span className="ms-0.5 text-destructive">*</span>}
        {optional && <span className="ms-1 text-[10px] font-normal opacity-60">(اختياري)</span>}
      </span>
      {hint && (
        <span className="shrink-0 text-[10px] font-normal text-muted-foreground/60">{hint}</span>
      )}
    </label>
  );
}

"use client";

/**
 * QuickProductDialog — نموذج إضافة صنف مصغّر، منبثق فوق النموذج المفتوح.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * المشكلة التي يحلها
 * ════════════════════════════════════════════════════════════════════════════
 * شاشات الاستلام والطحن والتسليم تفتح «إضافة صنف» فوق الكاونتر نفسه. وكان
 * المكوّن المستخدم يبني نافذته على `Dialog`، وهو ممتاز — لكن زرّ الإضافة في
 * هذه الشاشات يُطلق من داخل منتقي الأصناف، والمنتقي يعيش داخل `MillingPanel`:
 *
 *     <MillingPanel className="overflow-hidden …">
 *
 * و`overflow-hidden` يُنشئ سياق قصّ (clipping context). كل نافذة تُبنى دون
 * خروج إلى `document.body` تُقصّ عند حدود اللوحة، فتظهر مقطوعة أو خلفها بدل
 * أن تعلوها. ولهذا كانت «تغطي» على الواجهة أو تختفي تحتها.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * القاعدة
 * ════════════════════════════════════════════════════════════════════════════
 *   1. كل نافذة تُركَّب عبر `createPortal` على `document.body` — لا داخل أي
 *      حاوية ذات `overflow` أو `transform` أو `filter`.
 *   2. طبقة `z-index` أعلى من المنتقي (المنتقي `z-50`): هذه `z-[70]`، والفرق
 *      يساوي طبقة واحدة منبثقة فوق أخرى — لا تكفي `z-50` لأن النافذة الأصلية
 *      قد تكون هي نفسها `z-50` فيرتبط الترتيب بترتيب الشجرة (DOM order).
 *   3. عند فتح نموذج ثانٍ فوق الأول، قفل التمرير يُحفظ ويُعاد: النموذج الأول
 *      قفل `body`، وإغلاق الثاني لا يجوز أن يفتح التمرير تحت الأول الذي ما
 *      زال مفتوحًا.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * لماذا لا نستخدم `ProductFormDialog` الكبير هنا
 * ════════════════════════════════════════════════════════════════════════════
 * ذاك نموذج كامل (خمس خطوات، بطاقة هوية، حقول تعبئة وتصنيف وتاريخ). في
 * الكاونتر يوقف المشغّل استلامًا جاريًا، والتوقف مكلفة — فالمطلوب ثلاثة حقول
 * تُكمل في ثوانٍ: النوع، الاسم، سعة العبوة. وبقية الحقول تُكمل لاحقًا من
 * «أصناف الأمانات» حيث الفورم الكامل. وحفظه يكتب في نفس الجدول بنفس ثوابت
 * سياق الأمانات، فلا يوجد صنف «ناقص» يمكن أن يظهر في تقرير.
 */

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Factory, Loader2, Package, Wheat, X } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { MillingInput } from "@/components/milling/milling-ui";
import { QuantityInput } from "@/components/ui/quantity-input";

const db = supabase as any;

/* ------------------------------------------------------------------ types */

export type QuickProductClass = "RAW_MATERIAL" | "FINISHED_GOOD" | "BY_PRODUCT";

export interface QuickProductDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** `custody` يكتب ثوابت الأمانات (لا يُباع، سياسة CUSTOMER_OWNED). */
  mode?: "custody" | "retail";
  /** التصنيف المبدئي؛ الشاشات تمرّر ما تعرفه: الاستلام → حبوب، الطحن → ناتج. */
  defaultClass?: QuickProductClass;
  /** التصنيفات المسموحة في هذه الشاشة. */
  classes?: readonly QuickProductClass[];
  onSaved?: (productId: string) => void;
}

/* -------------------------------------------------------------- constants */

const CLASS_META: Record<
  QuickProductClass,
  { label: string; hint: string; prefix: string; icon: typeof Wheat; tone: string }
> = {
  RAW_MATERIAL: {
    label: "حبوب خام",
    hint: "قمح، شعير، ذرة",
    prefix: "GRN",
    icon: Wheat,
    tone: "border-amber-500/50 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  },
  FINISHED_GOOD: {
    label: "منتج نهائي",
    hint: "دقيق جاهز",
    prefix: "OUT",
    icon: Factory,
    tone: "border-emerald-500/50 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  },
  BY_PRODUCT: {
    label: "ناتج ثانوي",
    hint: "نخالة، ردة",
    prefix: "BYP",
    icon: Package,
    tone: "border-sky-500/50 bg-sky-500/10 text-sky-700 dark:text-sky-300",
  },
};

const CUSTODY_CLASSES: readonly QuickProductClass[] = [
  "RAW_MATERIAL",
  "FINISHED_GOOD",
  "BY_PRODUCT",
];

/* ------------------------------------------------------------- component */

export function QuickProductDialog({
  open,
  onOpenChange,
  mode = "custody",
  defaultClass = "RAW_MATERIAL",
  classes = CUSTODY_CLASSES,
  onSaved,
}: QuickProductDialogProps) {
  const qc = useQueryClient();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const previousOverflow = useRef<string>("");

  const [nameAr, setNameAr] = useState("");
  const [itemClass, setItemClass] = useState<QuickProductClass>(defaultClass);
  const [weightKg, setWeightKg] = useState<number | null>(50);

  useEffect(() => {
    if (!open) return;
    setNameAr("");
    setItemClass(defaultClass);
    setWeightKg(50);
    // التركيز بعد الرسم: حقل الاسم هو ما يُكتب فيه أولًا دائمًا.
    const raf = requestAnimationFrame(() =>
      (document.getElementById("quick-product-name") as HTMLInputElement | null)?.focus(),
    );
    return () => cancelAnimationFrame(raf);
  }, [open, defaultClass]);

  /**
   * قفل التمرير بلطف.
   *
   * إن كان `body` مقفولًا أصلًا (نموذج آخر مفتوح خلفنا)، نحفظ القيمة ونعيدها
   * كما كانت عند الإغلاق. تجاوزها بـ«فتح» عند الإغلاق يترك خلفية الشاشة تتحرك
   * تحت النموذج الأول، وهو ما يجعل المشغّل يضيع مكانه.
   */
  useEffect(() => {
    if (!open) return;
    previousOverflow.current = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow.current;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onOpenChange(false);
        return;
      }
      if (event.key !== "Tab") return;
      // حبس التركيز داخل النافذة: لا يصل المفتاح إلى النموذج الذي تحتها.
      const focusables = panelRef.current?.querySelectorAll<HTMLElement>(
        'input, select, textarea, button:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (!focusables || focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [open, onOpenChange]);

  const save = useMutation({
    mutationFn: async () => {
      const trimmed = nameAr.trim();
      if (!trimmed) throw new Error("اسم الصنف مطلوب");

      const meta = CLASS_META[itemClass];
      const sku = `${meta.prefix}-${Date.now().toString(36).toUpperCase()}`.slice(0, 24);
      const ownUnits = mode === "custody";

      const payload: Record<string, unknown> = {
        name_ar: trimmed,
        sku,
        item_class: itemClass,
        package_weight_kg: weightKg != null && weightKg > 0 ? weightKg : null,
        is_active: true,
        is_service: false,
        is_custody_item: ownUnits,
        is_sellable: !ownUnits,
        is_purchasable: !ownUnits,
        inventory_policy: ownUnits ? "CUSTOMER_OWNED" : "TRACKED",
        costing_method: ownUnits ? "NONE" : "MOVING_AVERAGE",
        tracking: "NONE",
      };

      const { data, error } = await db.from("products").insert(payload).select("id").single();
      if (error) throw error;
      return data.id as string;
    },
    onSuccess: (productId: string) => {
      toast.success("أُضيف الصنف — جاهز للاستخدام");
      // كل قوائم الأصناف في النظام تُعاد، فلا يظهر الصنف في شاشة ويغيب عن أخرى.
      void qc.invalidateQueries({ queryKey: ["milling"] });
      void qc.invalidateQueries({ queryKey: ["custody-products"] });
      void qc.invalidateQueries({ queryKey: ["products"] });
      onOpenChange(false);
      onSaved?.(productId);
    },
    onError: (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      toast.error(message);
    },
  });

  if (!open || typeof document === "undefined") return null;

  const meta = CLASS_META[itemClass];

  return createPortal(
    <div
      className="fixed inset-0 z-[70] flex items-end justify-center bg-black/55 p-0 backdrop-blur-[2px] sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="quick-product-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onOpenChange(false);
      }}
    >
      <div
        ref={panelRef}
        className={cn(
          "w-full max-w-md overflow-hidden rounded-t-2xl border border-border/80 bg-card shadow-2xl",
          "animate-in slide-in-from-bottom-4 fade-in-0 duration-200",
          "sm:rounded-2xl sm:zoom-in-95",
        )}
      >
        {/* رأس */}
        <div className="flex items-start gap-2.5 border-b border-border/60 px-4 py-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-amber-500/15 text-amber-600 dark:text-amber-400">
            <meta.icon className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="quick-product-title" className="text-sm font-black text-foreground">
              صنف جديد
            </h2>
            <p className="text-[11px] text-muted-foreground">
              ثلاثة حقول فقط — أكمل الباقي لاحقًا من «أصناف الأمانات».
            </p>
          </div>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            aria-label="إغلاق"
            className="grid size-8 shrink-0 place-items-center rounded-lg text-muted-foreground transition hover:bg-muted hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (nameAr.trim()) save.mutate();
          }}
          className="space-y-3 p-4"
        >
          {/* النوع */}
          <div className="grid grid-cols-3 gap-1.5">
            {classes.map((value) => {
              const option = CLASS_META[value];
              const Icon = option.icon;
              const active = itemClass === value;
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => setItemClass(value)}
                  aria-pressed={active}
                  className={cn(
                    "flex flex-col items-center gap-1 rounded-xl border px-1 py-2 text-[11px] font-bold transition",
                    active
                      ? option.tone
                      : "border-border/70 text-muted-foreground hover:border-primary/30 hover:text-foreground",
                  )}
                >
                  <Icon className="size-3.5" />
                  {option.label}
                </button>
              );
            })}
          </div>

          {/* الاسم */}
          <div className="space-y-1">
            <label
              htmlFor="quick-product-name"
              className="text-[11px] font-semibold text-muted-foreground"
            >
              اسم الصنف <span className="text-destructive">*</span>
            </label>
            <MillingInput
              id="quick-product-name"
              value={nameAr}
              onChange={(event) => setNameAr(event.target.value)}
              maxLength={120}
              placeholder={
                itemClass === "RAW_MATERIAL"
                  ? "مثال: بر بلدي أحمر"
                  : itemClass === "FINISHED_GOOD"
                    ? "مثال: دقيق ممتاز"
                    : "مثال: نخالة ناعمة"
              }
            />
            <p className="text-[10px] text-muted-foreground/80">{meta.hint}</p>
          </div>

          {/* سعة العبوة */}
          <div className="space-y-1">
            <label className="text-[11px] font-semibold text-muted-foreground">
              سعة العبوة <span className="font-normal opacity-60">(كجم)</span>
            </label>
            <QuantityInput
              value={weightKg}
              onValueChange={setWeightKg}
              min={0}
              step={0.5}
              unit="كجم"
              placeholder="50"
            />
          </div>

          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              disabled={save.isPending}
              className="rounded-xl border border-border/70 px-3 py-2 text-xs font-semibold text-muted-foreground transition hover:bg-muted/60"
            >
              إلغاء
            </button>
            <button
              type="submit"
              disabled={!nameAr.trim() || save.isPending}
              className="inline-flex items-center gap-1.5 rounded-xl bg-amber-500 px-4 py-2 text-xs font-bold text-white shadow-sm transition hover:bg-amber-600 disabled:pointer-events-none disabled:opacity-50"
            >
              {save.isPending ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <meta.icon className="size-3.5" />
              )}
              إضافة
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}

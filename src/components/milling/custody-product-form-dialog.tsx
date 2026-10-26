/**
 * CustodyProductFormDialog — إضافة / تعديل أصناف الأمانات (حبوب خام أو نواتج طحن).
 *
 * مكوّن مبسّط مخصص للمطحنة فقط — يُحرِّر فقط الحقول ذات الصلة بعمليات الأمانات
 * بدلاً من صفحة المنتجات المعقدة (`/products`). عند الحفظ يُدرَج المنتج في
 * جدول `products` مع `is_custody_item = true` ويُنعَش الاستعلام المناسب.
 */
import { useState, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Wheat, Factory, Loader2, Package } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { MillingInput, MillingSelect } from "@/components/milling/milling-ui";
import { QuantityInput } from "@/components/ui/quantity-input";
import { cn } from "@/lib/utils";

/* ---------------------------------------------------------------- types -- */

type ItemClassOption = "RAW_MATERIAL" | "FINISHED_GOOD" | "BY_PRODUCT";

export interface CustodyProductFormData {
  id?: string;
  name_ar: string;
  sku: string;
  package_weight_kg: number | null;
  item_class: ItemClassOption;
  is_active: boolean;
}

export interface CustodyProductFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** القيمة الافتراضية لنوع الصنف عند الإنشاء الجديد. */
  defaultClass?: ItemClassOption;
  /** بيانات صنف موجود للتعديل — إن كان فارغاً يُنشأ صنف جديد. */
  editing?: CustodyProductFormData | null;
  /** يُستدعى بعد الحفظ بنجاح مع معرّف المنتج المُنشأ/المُعدَّل. */
  onSaved?: (productId: string) => void;
}

/* ----------------------------------------------------------- constants -- */

const CLASS_OPTIONS: { value: ItemClassOption; label: string; icon: typeof Wheat }[] = [
  { value: "RAW_MATERIAL", label: "حبوب خام (مواد أولية)", icon: Wheat },
  { value: "FINISHED_GOOD", label: "ناتج طحن (منتج نهائي)", icon: Factory },
  { value: "BY_PRODUCT", label: "ناتج ثانوي (نخالة / ردة)", icon: Package },
];

const SKU_PREFIXES: Record<ItemClassOption, string> = {
  RAW_MATERIAL: "GRN-",
  FINISHED_GOOD: "OUT-",
  BY_PRODUCT: "BYP-",
};

/* ------------------------------------------------------------ component -- */

export function CustodyProductFormDialog({
  open,
  onOpenChange,
  defaultClass = "RAW_MATERIAL",
  editing,
  onSaved,
}: CustodyProductFormDialogProps) {
  const qc = useQueryClient();
  const db = supabase as any;

  /* ---- form state ---- */
  const [nameAr, setNameAr] = useState("");
  const [sku, setSku] = useState("");
  const [weightKg, setWeightKg] = useState<number | null>(50);
  const [itemClass, setItemClass] = useState<ItemClassOption>(defaultClass);
  const [isActive, setIsActive] = useState(true);

  /* ---- reset on open/edit change ---- */
  useEffect(() => {
    if (!open) return;
    if (editing) {
      setNameAr(editing.name_ar || "");
      setSku(editing.sku || "");
      setWeightKg(editing.package_weight_kg != null ? editing.package_weight_kg : null);
      setItemClass(editing.item_class);
      setIsActive(editing.is_active);
    } else {
      setNameAr("");
      setSku(SKU_PREFIXES[defaultClass]);
      setWeightKg(50);
      setItemClass(defaultClass);
      setIsActive(true);
    }
  }, [open, editing, defaultClass]);

  /* ---- auto-prefix SKU when class changes (new items only) ---- */
  useEffect(() => {
    if (editing) return;
    const prefix = SKU_PREFIXES[itemClass];
    if (!sku.startsWith(prefix)) {
      setSku(prefix);
    }
  }, [itemClass, editing]);

  /* ---- save mutation ---- */
  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!nameAr.trim()) throw new Error("اسم الصنف مطلوب");

      // إنشاء كود صنف داخلي تلقائياً بدون إزعاج المستخدم به
      const autoSku =
        editing?.sku ||
        `${SKU_PREFIXES[itemClass]}${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).substring(2, 5).toUpperCase()}`;

      const payload: Record<string, unknown> = {
        name_ar: nameAr.trim(),
        name: null,
        sku: autoSku.trim().toUpperCase(),
        item_class: itemClass,
        is_custody_item: true,
        is_active: isActive,
        is_service: false,
        is_sellable: false,
        is_purchasable: false,
        status: "ACTIVE",
        inventory_policy: "TRACKED",
        package_weight_kg: weightKg != null && weightKg > 0 ? weightKg : null,
      };

      if (editing?.id) {
        const { error } = await db.from("products").update(payload).eq("id", editing.id);
        if (error) throw error;
        return editing.id as string;
      } else {
        const { data, error } = await db
          .from("products")
          .insert(payload)
          .select("id")
          .single();
        if (error) throw error;
        return data.id as string;
      }
    },
    onSuccess: (productId: string) => {
      toast.success(editing ? "تم تعديل الصنف بنجاح" : "تمت إضافة الصنف بنجاح");
      // إعادة جلب قوائم أصناف الأمانات
      qc.invalidateQueries({ queryKey: ["milling", "grain-items"] });
      qc.invalidateQueries({ queryKey: ["milling", "output-items"] });
      qc.invalidateQueries({ queryKey: ["milling"] });
      qc.invalidateQueries({ queryKey: ["custody-products"] });
      onOpenChange(false);
      onSaved?.(productId);
    },
    onError: (err: any) => {
      const msg = err?.message || "فشل الحفظ";
      // كود مكرر
      if (msg.includes("duplicate") || msg.includes("unique")) {
        toast.error("كود الصنف (SKU) مكرر — يرجى اختيار كود مختلف");
      } else {
        toast.error(msg);
      }
    },
  });

  const isNew = !editing?.id;
  const classOption = CLASS_OPTIONS.find((c) => c.value === itemClass) || CLASS_OPTIONS[0];
  const ClassIcon = classOption.icon;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <div className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-amber-500/15 text-amber-600 dark:text-amber-400">
              <ClassIcon className="h-4 w-4" />
            </div>
            {isNew ? "إضافة صنف أمانات" : "تعديل صنف أمانات"}
          </DialogTitle>
          <DialogDescription>
            {isNew
              ? "أضف نوع حبوب خام جديد أو ناتج طحن لاستخدامه في عمليات الأمانات"
              : `تعديل بيانات «${editing?.name_ar || ""}»`}
          </DialogDescription>
        </DialogHeader>

        <form
          id="custody-product-form"
          onSubmit={(e) => {
            e.preventDefault();
            saveMutation.mutate();
          }}
          className="space-y-4 py-2"
        >
          {/* ── نوع الصنف ── */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">نوع الصنف</label>
            <div className="grid grid-cols-3 gap-2">
              {CLASS_OPTIONS.map((opt) => {
                const Icon = opt.icon;
                const active = itemClass === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setItemClass(opt.value)}
                    className={cn(
                      "flex flex-col items-center gap-1.5 rounded-xl border p-3 text-xs transition-all duration-200",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                      active
                        ? "border-amber-500/60 bg-amber-500/10 text-amber-700 dark:text-amber-300 shadow-sm font-semibold"
                        : "border-border/60 text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                    )}
                  >
                    <Icon className="h-4 w-4" />
                    <span className="text-center leading-tight">
                      {opt.value === "RAW_MATERIAL"
                        ? "حبوب خام"
                        : opt.value === "FINISHED_GOOD"
                          ? "ناتج طحن"
                          : "ناتج ثانوي"}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* ── اسم الصنف ── */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              اسم الصنف بالعربي <span className="text-destructive">*</span>
            </label>
            <MillingInput
              value={nameAr}
              onChange={(e) => setNameAr(e.target.value)}
              placeholder={
                itemClass === "RAW_MATERIAL"
                  ? "مثال: بُر بلدي أحمر 50 كجم"
                  : itemClass === "FINISHED_GOOD"
                    ? "مثال: دقيق ممتاز 50 كجم"
                    : "مثال: نخالة ناعمة 25 كجم"
              }
              required
            />
          </div>

          {/* ── سعة العبوة بالكجم ── */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">سعة العبوة</label>
            <div className="flex items-center gap-2">
              <QuantityInput
                value={weightKg}
                onValueChange={setWeightKg}
                unit="كجم"
                min={0}
                step={0.5}
                className="flex-1"
              />
            </div>
            <p className="text-[10px] text-muted-foreground/70">
              وزن الكيس / العبوة — يُستخدم لحساب الوزن الإجمالي تلقائياً (أكياس × السعة)
            </p>
          </div>

          {/* ── حالة الصنف ── */}
          {editing && (
            <div className="flex items-center gap-3 rounded-xl border border-border/60 p-3">
              <label className="text-xs font-medium text-muted-foreground flex-1">
                حالة الصنف
              </label>
              <button
                type="button"
                onClick={() => setIsActive(!isActive)}
                className={cn(
                  "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all",
                  isActive
                    ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
                    : "bg-red-500/15 text-red-700 dark:text-red-400",
                )}
              >
                <span
                  className={cn(
                    "h-2 w-2 rounded-full",
                    isActive ? "bg-emerald-500" : "bg-red-500",
                  )}
                />
                {isActive ? "نشط" : "معطّل"}
              </button>
            </div>
          )}
        </form>

        <DialogFooter>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="rounded-xl border border-border/60 px-4 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/50"
          >
            إلغاء
          </button>
          <button
            type="submit"
            form="custody-product-form"
            disabled={saveMutation.isPending || !nameAr.trim()}
            className={cn(
              "flex items-center gap-2 rounded-xl px-5 py-2 text-xs font-semibold text-white transition-all",
              "bg-gradient-to-l from-amber-600 to-amber-500 hover:from-amber-500 hover:to-amber-400",
              "shadow-sm hover:shadow-md disabled:opacity-50 disabled:pointer-events-none",
            )}
          >
            {saveMutation.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <ClassIcon className="h-3.5 w-3.5" />
            )}
            {isNew ? "إضافة" : "حفظ التعديلات"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

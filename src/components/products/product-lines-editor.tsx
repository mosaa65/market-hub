"use client";

/**
 * ProductLinesEditor — the ONE quantity-line editor for intake, milling and
 * delivery.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * لماذا
 * ════════════════════════════════════════════════════════════════════════════
 * الشاشات الثلاث كانت ترسم نفس السطر بثلاث طرق مختلفة، كل منها متزاحم:
 *
 *   • الاستلام: جدول ١٢ عمودًا برأس مكرّر، والحقول الثلاثة داخل شبكة تُلغي
 *     زر الحذف على الجوال.
 *   • الطحن والتسليم: بطاقة بعمودين وثلاث بطاقات ملونة للسياق.
 *
 * والنتيجة أن قارئ الشاشة يرى نفس المعلومة بثلاث لغات بصرية، والمشغّل يتعلّم
 * ثلاث طرق لإدخال «عشرة أكياس». وهذا الملف يوحّدها.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * القاعدة البصرية
 * ════════════════════════════════════════════════════════════════════════════
 * كل سطر **صف واحد** بخُطّ من ستة أعمدة، والأرقام كلها في الصف الأفقي نفسه:
 *
 *   الصنف · الأكياس · الوزن · المتاح · المتبقي · الحذف
 *
 * لماذا صف واحد؟
 *   • البطاقة من مستويين تستهلك ~١٦٠px للسطر، فسطران يملآن الشاشة.
 *   • الصف الواحد ~٤٤px، فترى أربعة أسطر في نفس المساحة وتقارن الأرقام أفقيًا
 *     (وهذا ما تفعله فعلًا عند مطابقة الوزن مع المتاح).
 *   • على الجوال يبقى الصف صفًا: شريط الأرقام يمرر أفقيًّا بدل التفاف كل خلية
 *     إلى سطر ثانٍ، فلا يتضاعف الارتفاع ولا يضيع زر الحذف.
 *
 * زر «الكل» (طحن الكل / تسليم الكل) صار أيقونة صغيرة داخل حقل الصنف، فيبقى
 * متاحًا بضغطة واحدة ولا يشغل رأسًا منفصلًا.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * التحذير من التجاوز
 * ════════════════════════════════════════════════════════════════════════════
 * لا صندوق أحمر تحت السطر. الذي تجاوز الحد يُلوَّن هو الرقم المتجاوز نفسه.
 * صندوق التحذير كان يدفع كل سطر تالٍ للأسفل حين يظهر، فتتحرك الشاشة تحت يد
 * المشغّل وهو يكتب.
 */

import { Plus, Trash2, Wand2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { toSystemDigits } from "@/lib/format-preferences";
import { QuantityInput } from "@/components/ui/quantity-input";
import { ProductPicker, type ProductPickerItem } from "@/components/products/product-picker";

/* ------------------------------------------------------------------ types */

export interface ProductLineValue {
  itemId: string;
  bags: number;
  kg: number;
}

export interface ProductLineMetric {
  key: string;
  /** عنوان الخلية، قصير: «أكياس»، «كجم»، «متاح»، «متبقٍ». */
  label: string;
  /** القيمة المعروضة بجانب الحقل، أو الرقم المحسوب. */
  value?: number | null;
  /** الوحدة تُكتب صغيرة بعد الرقم: «كيس»، «كجم». */
  unit?: string;
  /** سطر ثانوي صغير (مثل الكجم مقابل الأكياس). */
  secondary?: string | null;
  /** الرقم الحالي تجاوز حدًّا — يُلوَّن ولا يضيف ارتفاعًا. */
  isOver?: boolean;
  /** إبراز خاص: «متبقٍ» بلون المحور، لا بلون تحذير. */
  tone?: "neutral" | "primary" | "warning" | "success";
}

export interface ProductLinesEditorProps<T extends ProductPickerItem> {
  lines: readonly ProductLineValue[];
  onChange: (index: number, patch: Partial<ProductLineValue>) => void;
  onAdd: () => void;
  /** يُستدعى عند «حذف» أعلى بطاقة السطر — تُعطَّل حين لا يبقى إلا سطر واحد. */
  onRemove: (index: number) => void;

  /** قائمة الأصناف القابلة للاختيار — تُمرَّر إلى `ProductPicker`. */
  items: readonly T[];
  /** فلتر التصنيفات المعروضة. */
  classes?: readonly string[];
  placeholder?: string;
  pickerLoading?: boolean;

  /** تسميات الحقلين الرقميين، تتغيّر بحسب السياق: مستلمة / مطحونة / مسلّمة. */
  bagsLabel?: string;
  kgLabel?: string;

  /**
   * زر «الكل» لكل سطر — «طحن كل الرصيد»، «تسليم الكل»، أو غير موجود.
   * يُعرض فقط حين يُمرَّر، فلا يظهر زر لا يفعل شيئًا في شاشة لا تعرفه.
   */
  onFillAll?: (index: number) => void;
  fillAllLabel?: string;

  /** الصفوف المحسوبة (متاح / متبقٍ) لكل سطر، مقاسة بالفهرس. */
  metrics?: (index: number, line: ProductLineValue) => ProductLineMetric[];

  /**
   * عمود خامس اختياري — «أجر السطر» في الاستلام وحده.
   *
   * @deprecated لم يعد يُرسم: أجرة الطحن تُحتسب على إجمالي العملية في بطاقة
   * أجور الخدمة، وتكرار الرقم في كل سطر كان يستهلك عمودًا كاملًا مقابل معلومة
   * موجودة أصلاً. تُقبل الخاصية للتوافق ولا تُرسم.
   */
  extraColumn?: {
    label: string;
    value: (index: number, line: ProductLineValue) => number;
    unit?: string;
  };

  /** نص زر الإضافة أسفل القائمة. */
  addLabel?: string;
  /** معرّف للوصولية. */
  ariaLabel?: string;
  className?: string;
  emptyHint?: string;
}

/* ------------------------------------------------------------- component */

export function ProductLinesEditor<T extends ProductPickerItem>({
  lines,
  onChange,
  onAdd,
  onRemove,
  items,
  classes,
  placeholder = "اختر الصنف…",
  pickerLoading,
  bagsLabel = "أكياس",
  kgLabel = "كجم",
  onFillAll,
  fillAllLabel = "الكل",
  metrics,
  addLabel = "إضافة سطر",
  ariaLabel = "أسطر الأصناف",
  className,
  emptyHint,
}: ProductLinesEditorProps<T>) {
  return (
    <div className={cn("space-y-1.5", className)} role="group" aria-label={ariaLabel}>
      {lines.length === 0 && emptyHint ? (
        <p className="rounded-xl border border-dashed border-border/70 px-3 py-6 text-center text-xs text-muted-foreground">
          {emptyHint}
        </p>
      ) : null}

      {lines.map((line, index) => {
        const overlay = metrics?.(index, line) ?? [];
        return (
          <div
            key={index}
            role="group"
            aria-label={`السطر ${index + 1}`}
            className={cn(
              "group flex items-center gap-1 rounded-xl border py-1 pe-1 ps-1.5 transition-colors",
              overlay.some((m) => m.isOver)
                ? "border-rose-400/60 bg-rose-500/[0.04]"
                : "border-border/70 bg-card/70 focus-within:border-primary/40",
            )}
          >
            {/* ── الصنف: المساحة الحرة ── */}
            <div className="flex min-w-0 flex-1 items-center gap-0.5">
              <ProductPicker
                value={line.itemId}
                items={items}
                classes={classes}
                loading={pickerLoading}
                onChange={(item) => onChange(index, { itemId: item.id })}
                placeholder={placeholder}
                ariaLabel={`${ariaLabel} — الصنف في السطر ${index + 1}`}
                className="min-w-0 flex-1"
              />

              {onFillAll ? (
                <button
                  type="button"
                  onClick={() => onFillAll(index)}
                  title={fillAllLabel}
                  aria-label={fillAllLabel}
                  className="grid size-7 shrink-0 place-items-center rounded-lg text-muted-foreground/70 transition hover:bg-primary/10 hover:text-primary"
                >
                  <Wand2 className="size-3.5" />
                </button>
              ) : null}
            </div>

            {/* ── الأرقام: شريط أفقي واحد (تمرير أفقي على الجوال) ── */}
            <div className="flex min-w-0 shrink-0 items-stretch overflow-x-auto scrollbar-x-none">
              <NumberCell label={bagsLabel} accent="primary" className="w-[62px] sm:w-[76px]">
                <QuantityInput
                  decimals={0}
                  min={0}
                  emptyAsZero
                  placeholder="0"
                  aria-label={bagsLabel}
                  value={line.bags || null}
                  onValueChange={(v) => onChange(index, { bags: v ?? 0 })}
                  className="h-8 border-0 bg-transparent px-1 text-center text-xs font-bold shadow-none"
                />
              </NumberCell>

              <NumberCell label={kgLabel} className="w-[74px] sm:w-[92px]">
                <QuantityInput
                  decimals={2}
                  min={0}
                  emptyAsZero
                  placeholder="0.00"
                  aria-label={kgLabel}
                  value={line.kg || null}
                  onValueChange={(v) => onChange(index, { kg: v ?? 0 })}
                  className="h-8 border-0 bg-transparent px-1 text-center text-xs font-bold shadow-none"
                />
              </NumberCell>

              {overlay.slice(0, 2).map((metric) => (
                <NumberCell
                  key={metric.key}
                  label={metric.label}
                  tone={metric.tone}
                  isOver={metric.isOver}
                  className="w-[68px] sm:w-[86px]"
                >
                  <ReadOnlyValue
                    value={metric.value}
                    unit={metric.unit}
                    secondary={metric.secondary}
                  />
                </NumberCell>
              ))}
            </div>

            {/* ── الحذف ── */}
            <button
              type="button"
              onClick={() => onRemove(index)}
              disabled={lines.length === 1}
              aria-label={`حذف السطر ${index + 1}`}
              title="حذف السطر"
              className="grid w-7 shrink-0 self-center place-items-center rounded-lg text-muted-foreground/60 transition hover:bg-rose-500/10 hover:text-rose-600 disabled:pointer-events-none disabled:opacity-25"
            >
              <Trash2 className="size-3.5" />
            </button>
          </div>
        );
      })}

      <button
        type="button"
        onClick={onAdd}
        className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-primary/30 bg-primary/[0.03] py-2 text-xs font-bold text-primary transition hover:bg-primary/[0.07] active:scale-[0.995]"
      >
        <Plus className="size-3.5" />
        {addLabel}
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ atoms */

function NumberCell({
  label,
  children,
  tone = "neutral",
  isOver,
  accent,
  className,
}: {
  label: string;
  children: React.ReactNode;
  tone?: ProductLineMetric["tone"];
  isOver?: boolean;
  accent?: "primary";
  className?: string;
}) {
  const labelTone = isOver
    ? "text-rose-600 dark:text-rose-400"
    : accent === "primary"
      ? "text-primary/80"
      : tone === "primary"
        ? "text-primary/80"
        : tone === "warning"
          ? "text-amber-600/90 dark:text-amber-400/90"
          : tone === "success"
            ? "text-emerald-600/90 dark:text-emerald-400/90"
            : "text-muted-foreground";

  return (
    <div
      className={cn(
        "flex min-w-0 shrink-0 flex-col justify-center px-1",
        // فواصل رأسية بين الخلايا بدل صناديق منفصلة.
        "[&:not(:first-child)]:border-s [&:not(:first-child)]:border-border/50",
        className,
      )}
    >
      <span className={cn("block truncate text-[8.5px] font-bold leading-tight", labelTone)}>
        {label}
      </span>
      {children}
    </div>
  );
}

function ReadOnlyValue({
  value,
  unit,
  secondary,
}: {
  value: number | null | undefined;
  unit?: string;
  secondary?: string | null;
}) {
  const missing = value == null;
  return (
    <div className="flex h-8 min-w-0 flex-col justify-center">
      <span className="block truncate text-center font-mono text-xs font-bold tabular-nums text-foreground">
        {missing ? "—" : toSystemDigits(value)}
        {!missing && unit ? (
          <span className="ms-0.5 font-sans text-[8px] font-medium opacity-60">{unit}</span>
        ) : null}
      </span>
      {secondary ? (
        <span className="block truncate text-center font-mono text-[8px] leading-tight text-muted-foreground/75">
          {secondary}
        </span>
      ) : null}
    </div>
  );
}

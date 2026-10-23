/**
 * AmountInput — الحقل المالي الموحد للنظام كامل.
 *
 * الاستبدال الرسمي لكل `<input type="number">` المستخدمة في حقول المبالغ:
 *
 *  1. **لا عجلة ماوس:** الإدخال يُعرض كـ `type="text"` مع `inputMode="decimal"`،
 *     لذلك المتصفح لا يطبق سلوك spinner/wheel الأصلي إطلاقًا.
 *  2. **فاصلة آلاف أثناء الكتابة:** "1250000" → "1,250,000" دون قفزة المؤشر،
 *     عبر `sanitizeNumericString` من `src/design/number.ts`.
 *  3. **أرقام عربية:** `١٢٣٤` و `۱۲۳۴` تُنقّى تلقائيًا إلى ASCII قبل التخزين.
 *  4. **ربط بالإعدادات الموحد:** رمز العملة يُقرأ من `company_settings`
 *     عبر `useCompanyCurrency()` — تغيير العملة في الإعدادات ينعكس هنا تلقائيًا.
 *
 * القيمة المخزّنة دائمًا `number | null`؛ النص المنسق للعرض فقط.
 */
import * as React from "react";
import { cn } from "@/lib/utils";
import { FieldInput, type FieldInputProps } from "./input";
import { parseNumber, sanitizeNumericString } from "@/design/number";
import { useCompanyCurrency } from "@/hooks/use-company-currency";
import { numberToArabicWords } from "@/lib/templates/tafqeet";

export interface AmountInputProps extends Omit<
  FieldInputProps,
  "type" | "value" | "onChange" | "onValueChange" | "inputMode" | "clearable"
> {
  /** القيمة الفعلية المخزنة: رقم أو null للحقل الفارغ. */
  value: number | null;
  onValueChange: (value: number | null) => void;
  /** عدد خانات الكسر المسموح (الافتراضي 2). 0 = أعداد صحيحة فقط. */
  decimals?: number;
  /** حدود تُطبق عند مغادرة الحقل. */
  min?: number;
  max?: number;
  /** كود العملة للتفقيط (الافتراضي يُقرأ من إعدادات المنشأة). */
  currency?: string;
  /** رمز العملة المعروض بجنب الحقل (الافتراضي يُقرأ من إعدادات المنشأة). */
  currencySymbol?: string;
  /** إظهار زر التفريغ (افتراضي true للحقل المالي). */
  clearable?: boolean;
  /** إظهار سطر التفقيط (المبلغ بالأحرف) تحت الحقل — افتراضي true. أوقفه في الحقول الكثيفة مثل صفوف بنود الفواتير. */
  showInWords?: boolean;
  /** كلاسات إضافية لسطر التفقيط. */
  wordsClassName?: string;
  /**
   * عند `false` يبقى المبلغ ظاهرًا حين يفقد الحقل التركيز، ويصبح الحقل فارغًا
   * بمجرد الكتابة فيه (بعد زر التفريغ) — يمنع تغطية زر × للرقم ومزاحمته.
   */
  showStoredValue?: boolean;
  /** تعطيل زر التفريغ نهائيًا في هذا الحقل. */
  hideClear?: boolean;
}

/** عدد الأرقام الصريحة داخل سلسلة نصية (لحفظ موضع المؤشر). */
function countDigits(s: string): number {
  let n = 0;
  for (const ch of s) if (ch >= "0" && ch <= "9") n += 1;
  return n;
}

/** إضافة فاصلة آلاف مع الحفاظ على الكسر كما كتبه المستخدم (بحد `decimals`). */
function groupTyped(raw: string, decimals: number): string {
  const cleaned = sanitizeNumericString(raw);
  if (!cleaned || cleaned === "-" || cleaned === ".") return cleaned === "" ? "" : cleaned;
  const negative = cleaned.startsWith("-");
  const body = negative ? cleaned.slice(1) : cleaned;
  const dot = body.indexOf(".");
  const intPart = dot === -1 ? body : body.slice(0, dot);
  const fracPart = dot === -1 ? "" : body.slice(dot + 1);
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  let frac = "";
  if (decimals > 0 && fracPart !== "") {
    frac = "." + fracPart.slice(0, decimals);
  } else if (decimals > 0 && dot !== -1 && fracPart === "") {
    frac = "."; // اترك النقطة مؤقتًا حتى يكمل المستخدم الكسر
  }
  return (negative ? "-" : "") + grouped + frac;
}

/** تنسيق قيمة نهائية للعرض (بعد مغادرة الحقل): فاصلة آلاف + كسر محدود. */
function formatStored(value: number, decimals: number): string {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: decimals,
    useGrouping: true,
  }).format(value);
}

/** هل هذا الرقم صالح لكسر سطر التفقيط؟ */
function hasAmount(value: number | null | undefined): value is number {
  return value != null && Number.isFinite(value);
}

/** إعادة ضبط المؤشر بعد التجميع بحيث يبقى بعد نفس الرقم الذي كان بعده. */
function restoreCaret(el: HTMLInputElement, digitsBefore: number) {
  const text = el.value;
  let seen = 0;
  let target = text.length;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch >= "0" && ch <= "9") {
      seen += 1;
      if (seen > digitsBefore) {
        target = i;
        break;
      }
    }
  }
  try {
    el.setSelectionRange(target, target);
  } catch {
    /* عناصر غير قابلة للتحديد — تجاهل */
  }
}

export const AmountInput = React.forwardRef<HTMLInputElement, AmountInputProps>(
  (
    {
      value,
      onValueChange,
      decimals = 2,
      min,
      max,
      currency,
      currencySymbol,
      clearable = true,
      showInWords = true,
      wordsClassName,
      showStoredValue = true,
      hideClear = false,
      containerClassName,
      className,
      ...props
    },
    ref,
  ) => {
    const { currency: settingsCurrency, currencySymbol: settingsSymbol } = useCompanyCurrency();
    const resolvedSymbol = currencySymbol ?? settingsSymbol;
    const resolvedCurrency = currency ?? settingsCurrency;

    const [text, setText] = React.useState(() =>
      value == null ? "" : formatStored(value, decimals),
    );
    const editing = React.useRef(false);
    const inputRef = React.useRef<HTMLInputElement | null>(null);
    const pendingCaret = React.useRef<number | null>(null);
    // آخر قيمة وصلت من الخارج (لمقارنة "تغيّر أم لا" دون إعادة إرسال).
    const valueRef = React.useRef(value);
    valueRef.current = value;

    // مزامنة من الخارج — لكن لا نُقاتل المستخدم أثناء الكتابة.
    React.useEffect(() => {
      if (editing.current) return;
      setText(hasAmount(value) ? formatStored(value, decimals) : "");
    }, [value, decimals]);

    // استعادة موضع المؤشر بعد إعادة الرسم بالنص المجمع.
    React.useLayoutEffect(() => {
      if (pendingCaret.current == null) return;
      const el = inputRef.current;
      if (el) restoreCaret(el, pendingCaret.current);
      pendingCaret.current = null;
    }, [text]);

    const wordsText =
      showInWords && hasAmount(value) ? numberToArabicWords(value, resolvedCurrency) : "";

    // المبلغ المخزّن يُعرض في المنتصف حين يكون الحقل غير محرَّر، ليقرأه المستخدم
    // كاملًا في وسط الحقل ولا يغطيه زر × أو رمز العملة.
    const otherChecking = props.readOnly || props.disabled;
    const canShowStored =
      showStoredValue && hasAmount(value) && text === "" && !otherChecking && !props.placeholder;
    const shownText = canShowStored ? formatStored(value, decimals) : text;
    const showClear = clearable && !hideClear && hasAmount(value);
    const hasAdornment = Boolean(resolvedSymbol) || showClear;

    const clamp = React.useCallback(
      (n: number | null): number | null => {
        if (n == null) return null;
        let out = n;
        if (min != null && out < min) out = min;
        if (max != null && out > max) out = max;
        // تقريب الكسر إلى `decimals` حتى لا تُخزَّن قيم مثل 0.30000000000000004
        const factor = 10 ** decimals;
        out = Math.round(out * factor) / factor;
        return out;
      },
      [min, max, decimals],
    );

    return (
      <div className={cn("relative w-full min-w-0", containerClassName)}>
        <FieldInput
          {...props}
          ref={(el) => {
            inputRef.current = el;
            if (typeof ref === "function") ref(el);
            else if (ref && typeof ref === "object")
              (ref as React.RefObject<HTMLInputElement>).current = el as HTMLInputElement;
          }}
          type="currency" // يعرض كنص DOM مع inputMode="decimal" — لا spinner ولا عجلة ماوس
          clearable={clearable && !hideClear}
          suffix={
            resolvedSymbol ? (
              <span
                aria-label={`العملة: ${resolvedSymbol}`}
                className="pointer-events-none inline-flex h-6 min-w-9 items-center justify-center rounded-full border border-primary/15 bg-primary/[0.08] px-2 text-[10px] font-bold tracking-wide text-primary/80 shadow-sm"
              >
                {resolvedSymbol}
              </span>
            ) : undefined
          }
          dir="ltr"
          className={cn(
            // في المنتصف + عزل اتجاه رقمي: لا يزاحم المبلغ رمز العملة ولا زر ×.
            "text-center font-semibold tabular-nums [unicode-bidi:isolate]",
            // طبقة العرض المستقلة ترسم النص عند عدم التحرير؛ أخفِ نص الإدخال تحتها.
            canShowStored && "text-transparent caret-transparent",
            className,
          )}
          value={shownText}
          onFocus={(e) => {
            editing.current = true;
            // أول كتابة بعد عرض المبلغ المخزّن تفرغ الحقل، فلا يغطي زر × أي رقم.
            if (canShowStored) {
              setText("");
              pendingCaret.current = 0;
            }
            props.onFocus?.(e);
          }}
          onBlur={(e) => {
            editing.current = false;
            // لم يكتب شيئًا بعد عرض المبلغ المخزّن: أبقِ القيمة كما هي.
            if (canShowStored) {
              props.onBlur?.(e);
              return;
            }
            const parsed = parseNumber(text);
            const bounded = clamp(parsed);
            setText(bounded == null ? "" : formatStored(bounded, decimals));
            props.onBlur?.(e);
            // لا نُرسل قيمة مطابقة للقيمة الحالية (منعًا لإعادة الرسم بلا داعٍ).
            const previous = valueRef.current;
            const unchanged =
              previous === bounded ||
              (previous != null && bounded != null && Math.abs(previous - bounded) < 1e-9);
            if (!unchanged) onValueChange(bounded);
          }}
          onChange={(e) => {
            // نلتقط موضع المؤشر قبل أن يعيد FieldInput التنقية
            const caret = e.target.selectionStart ?? undefined;
            if (caret != null) {
              pendingCaret.current = countDigits(e.target.value.slice(0, caret));
            }
          }}
          onValueChange={(next) => {
            const grouped = groupTyped(next, decimals);
            setText(grouped);
            if (grouped === "" || grouped === "-" || grouped === ".") {
              if (valueRef.current !== null) onValueChange(null);
              return;
            }
            const parsed = clamp(parseNumber(grouped));
            const previous = valueRef.current;
            const unchanged =
              previous === parsed ||
              (previous != null && parsed != null && Math.abs(previous - parsed) < 1e-9);
            if (!unchanged) onValueChange(parsed);
          }}
        />
        {/*
         * طبقة عرض مستقلة عن الإدخال: النص يبقى في منتصف الحقل تمامًا (بين رمز
         * العملة وزر ×، لا تحتهما) أثناء عدم التحرير، والمسافات الجانبية تُحجز
         * ديناميكيًا على مقاس الزخارف الفعلية فلا يتم قص المبلغ.
         */}
        {canShowStored ? (
          <span
            aria-hidden
            dir="ltr"
            className="pointer-events-none absolute inset-y-0 start-0 end-0 z-20 grid place-items-center text-center font-semibold tabular-nums text-foreground [unicode-bidi:isolate]"
            style={{ paddingInlineStart: 12, paddingInlineEnd: hasAdornment ? 44 : 12 }}
          >
            {shownText}
          </span>
        ) : null}
        {wordsText ? (
          <p
            dir="rtl"
            className={cn(
              "mt-1 text-[11px] leading-4 font-bold text-muted-foreground",
              wordsClassName,
            )}
          >
            {wordsText}
          </p>
        ) : null}
      </div>
    );
  },
);
AmountInput.displayName = "AmountInput";

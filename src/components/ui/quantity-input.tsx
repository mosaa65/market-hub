/**
 * QuantityInput — حقل الكميات الموحد للنظام كامل.
 *
 * البروتوكول المتفق عليه لحقول الأرقام في Market Hub:
 *
 *  1. **لا عجلة ماوس:** الإدخال `type="text"` مع `inputMode="decimal"`، لذلك
 *     المتصفح لا يطبق سلوك spinner/wheel الأصلي إطلاقًا (لا زيادة ولا نقصان
 *     عند تمرير المؤشر فوق الحقل).
 *  2. **أزرار الزيادة/النقصان تبقى كما هي** في شاشاتها (`QuantityStepper`،
 *     `VortexNumberInput`، أزرار POS...) — هذا المكون للحقل وحده، ويمكن تمرير
 *     `suffix` / `icon` لإبقاء الوحدة أو الرمز بجانب الكتابة.
 *  3. **فاصلة آلاف اختيارية** أثناء الكتابة (`groupThousands`) مع حفظ موضع
 *     المؤشر — مفيدة للكميات الكبيرة (الأكياس، الأكياس × 50).
 *  4. **أرقام عربية:** `١٢٣٤` و `۱۲۳۴` تُطهَّر تلقائيًا عبر `sanitizeNumericString`.
 *  5. **القيمة المخزّنة رقم `number | null`** ولا `NaN` أبدًا؛ التركيز يحدد
 *     النص والحفظ عند الخروج يحسم الكسر والحدود.
 *
 *   <QuantityInput
 *     value={qty}                 // number | null
 *     onValueChange={setQty}
 *     decimals={3}                // 0 = أعداد صحيحة فقط
 *     min={0}
 *     max={stock}
 *     unit="كجم"
 *     groupThousands
 *     liveParseDelay={250}        // live أثناء الكتابة (تحديث الإجماليات)
 *   />
 */
import * as React from "react";
import { cn } from "@/lib/utils";
import { FieldInput, type FieldInputProps } from "./input";
import { parseNumber, sanitizeNumericString } from "@/design/number";

export interface QuantityInputProps extends Omit<
  FieldInputProps,
  "type" | "value" | "onChange" | "onValueChange" | "inputMode"
> {
  /** القيمة الفعلية المخزنة: رقم أو null للحقل الفارغ. */
  value: number | null;
  /** تُستدعى بالقيمة المطهّرة: أثناء الكتابة (عبر `liveParseDelay`) وعند الخروج. */
  onValueChange: (value: number | null) => void;
  /** عدد خانات الكسر المسموح (الافتراضي 3). 0 = أعداد صحيحة فقط. */
  decimals?: number;
  /** حدود تُطبق عند الكتابة وعند مغادرة الحقل. */
  min?: number;
  max?: number;
  /** فاصلة آلاف أثناء الكتابة (1,234,567). الافتراضي false للحقول الكثيفة. */
  groupThousands?: boolean;
  /** خانات الكسر الظاهرة عند مغادرة الحقل (افتراضي = decimals). */
  displayDecimals?: number;
  /** التعامل مع الحقل الفارغ كصفر بدل null (مفيد في صفوف الفواتير). */
  emptyAsZero?: boolean;
  /** وحدة القياس تُعرض داخل الحقل (كجم، شوال، طن...). */
  unit?: string;
  /** تأخير تحديث القيمة الرقمية أثناء الكتابة بالمللي ثانية (افتراضي 250). */
  liveParseDelay?: number;
}

/** عدد الأرقام الصريحة داخل سلسلة نصية (لحفظ موضع المؤشر). */
function countDigits(s: string): number {
  let n = 0;
  for (const ch of s) if (ch >= "0" && ch <= "9") n += 1;
  return n;
}

/** تجميع آلاف مع الحفاظ على الكسر كما يكتبه المستخدم (بحد `decimals`). */
function groupTyped(raw: string, decimals: number): string {
  const cleaned = sanitizeNumericString(raw);
  if (!cleaned || cleaned === "-" || cleaned === ".") return cleaned;
  const negative = cleaned.startsWith("-");
  const body = negative ? cleaned.slice(1) : cleaned;
  const dot = body.indexOf(".");
  const intPart = dot === -1 ? body : body.slice(0, dot);
  const fracPart = dot === -1 ? "" : body.slice(dot + 1);
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  let frac = "";
  if (decimals > 0 && fracPart !== "") frac = "." + fracPart.slice(0, decimals);
  else if (decimals > 0 && dot !== -1 && fracPart === "") frac = ".";
  return (negative ? "-" : "") + grouped + frac;
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
    /* بعض المتصفحات لا تسمح بالتحديد أثناء التحويل — تجاهل */
  }
}

/** تقريب القيمة إلى عدد محدد من الخانات العشرية دون أخطاء الفاصلة العائمة. */
function roundTo(n: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(n * factor) / factor;
}

export const QuantityInput = React.forwardRef<HTMLInputElement, QuantityInputProps>(
  (
    {
      value,
      onValueChange,
      decimals = 3,
      min,
      max,
      groupThousands = false,
      displayDecimals,
      emptyAsZero = false,
      unit,
      liveParseDelay = 250,
      containerClassName,
      className,
      suffix,
      onBlur,
      onFocus,
      ...props
    },
    ref,
  ) => {
    const shownDecimals = displayDecimals ?? decimals;

    const formatStored = React.useCallback(
      (n: number | null): string => {
        if (n == null) return "";
        const fixed = roundTo(n, shownDecimals);
        return groupThousands
          ? new Intl.NumberFormat("en-US", {
              maximumFractionDigits: shownDecimals,
              useGrouping: true,
            }).format(fixed)
          : String(fixed);
      },
      [shownDecimals, groupThousands],
    );

    const clamp = React.useCallback(
      (n: number | null): number | null => {
        if (n == null) return emptyAsZero ? 0 : null;
        let out = n;
        if (min != null && out < min) out = min;
        if (max != null && out > max) out = max;
        return roundTo(out, decimals);
      },
      [min, max, decimals, emptyAsZero],
    );

    const [text, setText] = React.useState(() => formatStored(value));
    const editing = React.useRef(false);
    const inputRef = React.useRef<HTMLInputElement | null>(null);
    const pendingCaret = React.useRef<number | null>(null);
    const lastEmitted = React.useRef<number | null>(value);
    const parseTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

    // مزامنة من الخارج — لا نقاتل المستخدم أثناء الكتابة.
    React.useEffect(() => {
      if (editing.current) return;
      if (value === lastEmitted.current) return;
      lastEmitted.current = value;
      setText(formatStored(value));
    }, [value, formatStored]);

    // استعادة موضع المؤشر بعد إعادة الرسم بالنص المجمع.
    React.useLayoutEffect(() => {
      if (pendingCaret.current == null) return;
      const el = inputRef.current;
      if (el) restoreCaret(el, pendingCaret.current);
      pendingCaret.current = null;
    }, [text]);

    React.useEffect(
      () => () => {
        if (parseTimer.current) clearTimeout(parseTimer.current);
      },
      [],
    );

    const emit = (n: number | null) => {
      lastEmitted.current = n;
      onValueChange(n);
    };

    const commitValue = (raw: string) => {
      if (parseTimer.current) {
        clearTimeout(parseTimer.current);
        parseTimer.current = null;
      }
      const committed = clamp(parseNumber(raw));
      emit(committed);
      setText(formatStored(committed));
    };

    return (
      <FieldInput
        {...props}
        ref={(el) => {
          inputRef.current = el;
          if (typeof ref === "function") ref(el);
          else if (ref && typeof ref === "object")
            (ref as React.RefObject<HTMLInputElement>).current = el as HTMLInputElement;
        }}
        // لا spinner ولا استجابة لعجلة الماوس: DOM نصي + لوحة أرقام عشرية.
        type="decimal"
        dir="ltr"
        value={text}
        suffix={
          unit ? (
            <span className="pointer-events-none select-none text-[11px] font-semibold text-muted-foreground">
              {unit}
            </span>
          ) : (
            suffix
          )
        }
        // الرقم في منتصف الحقل (طلبات POS): لا يلتصق ببداية الحقل ولا بمؤخرة الوحدة.
        className={cn("text-center font-mono tabular-nums", className)}
        containerClassName={containerClassName}
        onFocus={(e) => {
          editing.current = true;
          onFocus?.(e);
        }}
        onBlur={(e) => {
          editing.current = false;
          commitValue(text);
          onBlur?.(e);
        }}
        onChange={(e) => {
          // التقاط موضع المؤشر قبل التنقية/التجميع.
          const caret = e.target.selectionStart ?? undefined;
          if (caret != null) {
            pendingCaret.current = countDigits(e.target.value.slice(0, caret));
          }
        }}
        onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
          if (e.key === "Enter") {
            commitValue((e.target as HTMLInputElement).value);
            (e.target as HTMLInputElement).blur();
          }
          props.onKeyDown?.(e);
        }}
        onValueChange={(next) => {
          const shown = groupThousands ? groupTyped(next, decimals) : sanitizeNumericString(next);
          setText(shown);

          // تحديث مؤجل للقيمة الرقمية: المستخدم يكتب "5." ولا نريد قفزًا في المؤشر.
          if (parseTimer.current) clearTimeout(parseTimer.current);
          const parsed = parseNumber(shown);
          parseTimer.current = setTimeout(() => {
            parseTimer.current = null;
            emit(clamp(parsed));
          }, liveParseDelay);
        }}
      />
    );
  },
);
QuantityInput.displayName = "QuantityInput";

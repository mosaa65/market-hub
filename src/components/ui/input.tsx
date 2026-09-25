import * as React from "react";
import { X } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  parseNumber,
  sanitizeIntegerString,
  sanitizeNumericString,
  sanitizePhone,
} from "@/design/number";
import type { FieldSize } from "@/design/styles";
import { useFieldContext } from "@/components/ui/form-field";

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";

export { Input };

/* ==================================================================== */
/*  Market Hub Design System — field family                             */
/*  (FieldInput, NumberInput, CurrencyInput, PercentInput, SearchInput)  */
/* ==================================================================== */

export type { FieldSize } from "@/design/styles";

export const fieldSizeClass: Record<FieldSize, string> = {
  sm: "h-8 px-3 text-[13px]",
  md: "h-9 px-3 text-sm",
  lg: "h-11 px-4 text-base sm:text-sm",
};

/** Shared visual recipe for every boxed control (input, select trigger, textarea). */
export const fieldSurfaceClass = cn(
  "w-full min-w-0 rounded-[12px] border-input bg-surface/70 backdrop-blur-sm text-foreground",
  "shadow-[inset_0_1px_0_0_oklch(1_0_0/0.04)]",
  "transition-[border-color,box-shadow,background-color] duration-200 ease-[cubic-bezier(0.32,0.72,0,1)]",
  "placeholder:text-muted-foreground",
  "hover:border-primary/25 hover:bg-surface",
  "focus:outline-none focus:border-primary/60 focus:bg-surface focus:ring-4 focus:ring-primary/10",
  "aria-[invalid=true]:border-destructive/70 aria-[invalid=true]:ring-4 aria-[invalid=true]:ring-destructive/10",
  "disabled:cursor-not-allowed disabled:opacity-50",
  "read-only:border-transparent read-only:bg-surface-2/50 read-only:text-muted-foreground",
);

/** Pill-shaped variant used by the global search bar. */
export const pillFieldSurfaceClass = cn(
  "w-full min-w-0 rounded-full border-border/60 bg-surface/50 backdrop-blur-xl text-foreground",
  "shadow-[inset_0_1px_0_0_oklch(1_0_0/0.05),0_1px_2px_0_oklch(0_0_0/0.12)]",
  "transition-[border-color,box-shadow,background-color] duration-200 ease-[cubic-bezier(0.32,0.72,0,1)]",
  "placeholder:text-muted-foreground hover:border-primary/30 hover:bg-surface/70",
  "focus:outline-none focus:border-primary/50 focus:bg-surface/80 focus:ring-4 focus:ring-primary/15",
  "disabled:cursor-not-allowed disabled:opacity-50",
);

// Backward-compatible alias kept for existing imports.
export const pillFieldSurface = pillFieldSurfaceClass;

/** Types whose value is a quantity/amount and is therefore digit-normalizable. */
const NUMERIC_TYPES = new Set(["number", "decimal", "currency", "percent", "integer"]);
const IDENTIFIER_TYPES = new Set(["tel", "phone"]);

export type NumericInputType = "number" | "decimal" | "currency" | "percent" | "integer";

export interface FieldInputProps extends Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  "size" | "prefix"
> {
  /** Semantic type. Numeric types get a numeric keypad + sanitisation. */
  type?: React.HTMLInputTypeAttribute | NumericInputType | "phone";
  size?: FieldSize;
  /** Icon rendered at the start edge (RTL-aware). */
  icon?: React.ReactNode;
  /** Trailing content rendered inside the field (unit, currency, spinner). */
  suffix?: React.ReactNode;
  /** Leading text rendered inside the field. */
  prefixText?: string;
  /** Show a clear button when a value is present. */
  clearable?: boolean;
  /** Fired with the *sanitised* string value. */
  onValueChange?: (value: string) => void;
  /** Marks the field invalid (set automatically by FormField). */
  invalid?: boolean;
  /** Class applied to the positioning wrapper. */
  containerClassName?: string;
}

/**
 * FieldInput — the single input primitive for the whole application.
 *
 *  - Numeric fields (`number`, `decimal`, `currency`, `percent`, `integer`):
 *      numeric keypad on mobile, invalid characters such as `12abc45` rejected,
 *      and Arabic-Indic digits (`١٢٣`) transliterated to ASCII.
 *  - Text-like fields (`text`, `sku`, `barcode`, `code`): never mutated, because
 *      normalising identifiers would corrupt stored data.
 *  - Phone fields: Arabic digits normalized; `+ - ( ) space` preserved.
 */
export const FieldInput = React.forwardRef<HTMLInputElement, FieldInputProps>(
  (
    {
      className,
      containerClassName,
      type = "text",
      size = "md",
      icon,
      suffix,
      prefixText,
      clearable = false,
      onValueChange,
      onChange,
      invalid,
      value,
      readOnly,
      ...props
    },
    ref,
  ) => {
    const inputRef = React.useRef<HTMLInputElement>(null);
    React.useImperativeHandle(ref, () => inputRef.current as HTMLInputElement);

    // When the field is rendered as a plain child of `FormField`, inherit the
    // id, aria wiring and icon from the field context. Explicit props still win,
    // so the render-prop style keeps working unchanged.
    const field = useFieldContext();
    const resolvedId = props.id ?? field?.id;
    const resolvedIcon = icon ?? field?.icon ?? null;
    const resolvedInvalid = invalid ?? field?.invalid;
    const resolvedDescribedBy = props["aria-describedby"] ?? field?.describedBy;
    const resolvedRequired = props["aria-required"] ?? field?.required;

    const isNumeric = NUMERIC_TYPES.has(type);
    const isIdentifier = IDENTIFIER_TYPES.has(type);
    const hasValue = value != null && String(value).length > 0;
    const showClear = clearable && !readOnly && hasValue;

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      if (!isNumeric && !isIdentifier) {
        onChange?.(e);
        onValueChange?.(e.target.value);
        return;
      }

      const raw = e.target.value;
      let next: string;
      if (type === "integer") next = sanitizeIntegerString(raw, true);
      else if (type === "phone" || type === "tel") next = sanitizePhone(raw);
      else next = sanitizeNumericString(raw);

      // Only rewrite the DOM when sanitisation actually changed something, so the
      // caret stays put during normal typing.
      if (next !== raw) e.target.value = next;
      onChange?.(e);
      onValueChange?.(next);
    };

    const handleClear = () => {
      const el = inputRef.current;
      if (!el) return;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(el, "");
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.focus();
      onValueChange?.("");
    };

    // Numeric fields render as text so we fully own sanitisation (type=number
    // silently discards invalid input and blocks Arabic-Indic digits).
    const domType = isNumeric ? "text" : type === "phone" ? "tel" : type;
    const inputMode: React.InputHTMLAttributes<HTMLInputElement>["inputMode"] = isNumeric
      ? type === "integer"
        ? "numeric"
        : "decimal"
      : isIdentifier
        ? "tel"
        : type === "email"
          ? "email"
          : type === "search"
            ? "search"
            : undefined;

    return (
      <div className={cn("group relative w-full min-w-0", containerClassName)}>
        {/*
         * Adornment layout.
         *
         * Numeric fields want LTR *digits* (so "4500" never renders as "0045")
         * but the field itself must keep the page direction, otherwise the
         * currency/percent suffix and the icon swap sides and overlap the value.
         *
         * Fix: keep the wrapper on the page direction and set LTR only on the
         * value via `unicode-bidi: plaintext`, which orders the digits correctly
         * without mirroring the surrounding adornments.
         */}
        <div className="relative flex w-full min-w-0 items-center">
          {resolvedIcon ? (
            <span
              aria-hidden
              className="pointer-events-none absolute inset-y-0 start-0 z-10 flex items-center ps-2"
            >
              {/*
               * Bordered icon chip.
               *
               * A soft circle with a hairline border reads as a deliberate
               * affordance rather than a stray glyph, and needs no extra spacing
               * gymnastics inside the field.
               */}
              <span className="grid size-6 place-items-center rounded-full border-border/60 bg-surface-2/60 text-muted-foreground transition-colors group-focus-within:border-primary/40 group-focus-within:bg-primary/10 group-focus-within:text-primary [&_svg]:size-3.5">
                {resolvedIcon}
              </span>
            </span>
          ) : null}

          {prefixText ? (
            <span className="pointer-events-none absolute inset-y-0 start-0 z-10 flex items-center ps-3 text-xs font-medium text-muted-foreground">
              {prefixText}
            </span>
          ) : null}

          <input
            ref={inputRef}
            id={resolvedId}
            type={domType}
            inputMode={inputMode}
            value={value}
            readOnly={readOnly}
            onChange={handleChange}
            aria-invalid={resolvedInvalid || undefined}
            aria-describedby={resolvedDescribedBy}
            aria-required={resolvedRequired || undefined}
            className={cn(
              fieldSizeClass[size],
              fieldSurfaceClass,
              isNumeric && "tabular-nums",
              // Digits read LTR without flipping the field's own direction.
              isNumeric && "[unicode-bidi:plaintext]",
              (resolvedIcon || prefixText) && "ps-10",
              (suffix || showClear) && "pe-10",
              className,
            )}
            {...props}
          />

          {(suffix || showClear) && (
            <span className="absolute inset-y-0 end-0 z-10 flex items-center gap-1 pe-3 [&_svg]:size-3.5">
              {suffix ? (
                <span className="text-xs font-medium text-muted-foreground tabular-nums">
                  {suffix}
                </span>
              ) : null}
              {showClear ? (
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={handleClear}
                  aria-label="Clear"
                  className="pointer-events-auto grid h-6 w-6 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-surface-3 hover:text-foreground"
                >
                  <X />
                </button>
              ) : null}
            </span>
          )}
        </div>
      </div>
    );
  },
);
FieldInput.displayName = "FieldInput";

export interface NumberInputProps extends Omit<
  FieldInputProps,
  "type" | "onValueChange" | "value" | "onChange"
> {
  value: number | null;
  onValueChange: (value: number | null) => void;
  min?: number;
  max?: number;
  /** Allow decimals (default true). */
  decimal?: boolean;
}

/** Numeric field that stores a real `number | null` instead of a raw string. */
export function NumberInput({
  value,
  onValueChange,
  min,
  max,
  decimal = true,
  ...props
}: NumberInputProps) {
  const [text, setText] = React.useState(() => (value == null ? "" : String(value)));
  const editing = React.useRef(false);

  // Sync from outside, but never fight the user while they are typing.
  React.useEffect(() => {
    if (editing.current) return;
    setText(value == null ? "" : String(value));
  }, [value]);

  return (
    <FieldInput
      {...props}
      type={decimal ? "decimal" : "integer"}
      value={text}
      onFocus={(e) => {
        editing.current = true;
        props.onFocus?.(e);
      }}
      onBlur={(e) => {
        editing.current = false;
        const parsed = parseNumber(text);
        const bounded = parsed == null ? null : clampNumber(parsed, min, max);
        onValueChange(bounded);
        setText(bounded == null ? "" : String(bounded));
        props.onBlur?.(e);
      }}
      onValueChange={(next) => {
        setText(next);
        if (next === "" || next === "-" || next === ".") {
          onValueChange(null);
          return;
        }
        onValueChange(parseNumber(next));
      }}
    />
  );
}

function clampNumber(value: number, min?: number, max?: number): number {
  let out = value;
  if (min != null && out < min) out = min;
  if (max != null && out > max) out = max;
  return out;
}

export interface CurrencyInputProps extends Omit<NumberInputProps, "suffix"> {
  /** Currency symbol rendered inside the field. Defaults to the configured company currency. */
  symbol?: string;
}

/** Money field: stores a number, shows the amount with a currency symbol. */
export function CurrencyInput({ symbol, ...props }: CurrencyInputProps) {
  // Default to the operator's configured currency symbol (falls back to ﷼ inside `money`).
  const resolved =
    symbol ??
    (typeof window !== "undefined"
      ? (() => {
          try {
            const raw = window.localStorage.getItem("company_settings_cache");
            const parsed = raw ? JSON.parse(raw) : null;
            return (parsed?.currency_symbol as string | undefined)?.trim() || "﷼";
          } catch {
            return "﷼";
          }
        })()
      : "﷼");

  return <NumberInput {...props} suffix={resolved} decimal />;
}

/** Percentage field, bounded to a sensible range (0–100 by default). */
export function PercentInput({ max = 100, min = 0, ...props }: NumberInputProps) {
  return <NumberInput {...props} min={min} max={max} suffix="%" decimal />;
}

import { useEffect, useRef, useState } from "react";
import { Minus, Plus } from "lucide-react";
import { cn } from "@/lib/utils";

export interface QuantityStepperProps {
  value: number;
  onCommit: (next: number | null) => void;
  max?: number;
  unbounded?: boolean;
  min?: number;
  step?: number;
  disabled?: boolean;
  ariaLabel?: string;
  className?: string;
  size?: "sm" | "md";
}

/**
 * تقريب الأرقام العشرية لمنع تشوهات الفاصلة العائمة (floating point epsilon)
 * مثل 1.0000000000000002 أو 1.001 عند الزيادة/النقصان.
 */
/**
 * تقريب وحساب خطوات الزيادة والنقصان بأعداد صحيحة (Integers).
 */
export function cleanAdd(val: number, step: number): number {
  const safeStep = Number.isFinite(step) && step >= 1 ? Math.round(step) : 1;
  // الزيادة بأعداد صحيحة دائماً
  if (Math.abs(val - Math.round(val)) < 1e-4) {
    return Math.round(val) + safeStep;
  }
  return Math.floor(val) + safeStep;
}

export function cleanSub(val: number, step: number, min: number): number {
  const safeStep = Number.isFinite(step) && step >= 1 ? Math.round(step) : 1;
  const safeMin = Number.isFinite(min) && min >= 1 ? Math.round(min) : 1;
  // إذا كانت الكمية الحالية 1 أو أقل، فالنقصان يوصل لـ 0 لحذف الصنف من السلة
  if (val <= safeMin || val <= 1) return 0;

  if (Math.abs(val - Math.round(val)) < 1e-4) {
    const next = Math.round(val) - safeStep;
    return next <= 0 ? 0 : next;
  }
  const next = Math.ceil(val) - safeStep;
  return next <= 0 ? 0 : next;
}

export function QuantityStepper({
  value,
  onCommit,
  max,
  unbounded = false,
  min = 1,
  step = 1,
  disabled = false,
  ariaLabel,
  className,
  size = "sm",
}: QuantityStepperProps) {
  const effectiveStep = Math.max(
    1,
    Math.round(Number.isFinite(step) && (step ?? 1) >= 1 ? (step ?? 1) : 1),
  );
  const effectiveMin = Math.max(
    1,
    Math.round(Number.isFinite(min) && (min ?? 1) >= 1 ? (min ?? 1) : 1),
  );

  const [text, setText] = useState(() => String(value));
  const editing = useRef(false);

  useEffect(() => {
    if (editing.current) return;
    setText(String(value));
  }, [value]);

  const ceiling = unbounded ? Number.POSITIVE_INFINITY : max;

  function commit(raw: string) {
    const trimmed = raw.trim();
    if (trimmed === "") {
      onCommit(null);
      return;
    }
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) {
      setText(String(value));
      return;
    }
    if (parsed <= 0) {
      onCommit(0);
      setText("0");
      return;
    }
    let next = parsed;
    if (ceiling != null && Number.isFinite(ceiling) && next > ceiling) next = ceiling;
    onCommit(next);
    setText(String(next));
  }

  const hClass = size === "md" ? "h-7.5" : "h-6.5";
  const btnClass = size === "md" ? "h-7.5 w-6.5" : "h-6.5 w-5.5";
  const digitCount = text.replace(/[^0-9]/g, "").length;
  const widthCh = Math.min(Math.max(digitCount + 1, 2), 6);

  return (
    <div
      className={cn(
        "inline-flex shrink-0 items-center overflow-hidden rounded-md border border-border/70 bg-background/90 shadow-2xs transition hover:border-primary/40 focus-within:border-primary focus-within:ring-1 focus-within:ring-primary/20",
        hClass,
        className,
      )}
    >
      <button
        type="button"
        disabled={disabled}
        onClick={() => onCommit(cleanSub(value, effectiveStep, effectiveMin))}
        aria-label="decrease"
        className={cn(
          btnClass,
          "grid place-items-center text-muted-foreground/80 hover:bg-muted hover:text-foreground active:scale-95 transition disabled:opacity-40",
        )}
      >
        <Minus className="h-2.5 w-2.5" />
      </button>

      <input
        type="text"
        inputMode="decimal"
        value={text}
        disabled={disabled}
        aria-label={ariaLabel}
        onFocus={(e) => {
          editing.current = true;
          e.currentTarget.select();
        }}
        onChange={(e) => setText(e.target.value)}
        onBlur={(e) => {
          editing.current = false;
          commit(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit((e.target as HTMLInputElement).value);
            (e.target as HTMLInputElement).blur();
          }
        }}
        className={cn(
          "h-full min-w-0 shrink-0 bg-transparent text-center font-mono font-bold tabular-nums text-foreground outline-none [unicode-bidi:plaintext] [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none",
          size === "md" ? "text-xs" : "text-[11px]",
        )}
        style={{ width: `${widthCh + 0.3}ch` }}
      />

      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          const next = cleanAdd(value, effectiveStep);
          if (!unbounded && ceiling != null && next > ceiling) return;
          onCommit(next);
        }}
        aria-label="increase"
        className={cn(
          btnClass,
          "grid place-items-center text-muted-foreground/80 hover:bg-muted hover:text-foreground active:scale-95 transition disabled:opacity-40",
        )}
      >
        <Plus className="h-2.5 w-2.5" />
      </button>
    </div>
  );
}

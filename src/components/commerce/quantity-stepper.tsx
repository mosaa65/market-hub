import { useEffect, useRef, useState } from "react";
import { Minus, Plus } from "lucide-react";
import { cn } from "@/lib/utils";

export interface QuantityStepperProps {
  value: number;
  onCommit: (next: number | null) => void;
  max?: number;
  unbounded?: boolean;
  min?: number;
  disabled?: boolean;
  ariaLabel?: string;
  className?: string;
  size?: "sm" | "md";
}

export function QuantityStepper({
  value,
  onCommit,
  max,
  unbounded = false,
  min = 1,
  disabled = false,
  ariaLabel,
  className,
  size = "sm",
}: QuantityStepperProps) {
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
    if (next < min) next = min;
    if (ceiling != null && Number.isFinite(ceiling) && next > ceiling) next = ceiling;
    onCommit(next);
    setText(String(next));
  }

  const hClass = size === "md" ? "h-8" : "h-7";
  const btnClass = size === "md" ? "h-8 w-7" : "h-7 w-6";
  // عرض الحقل يتمدد مع عدد أرقام الكمية (يبدأ من مقاس الكتلة المدمجة) فلا يُقصّ
  // الرقم في المنتصف ولا يتضخم الحقل لكمية من خانة واحدة.
  const digitCount = text.replace(/[^0-9]/g, "").length;
  const widthCh = Math.min(Math.max(digitCount + 1, 2), 7);

  return (
    <div
      className={cn(
        "inline-flex shrink-0 items-center overflow-hidden rounded-lg border border-border/80 bg-background/80 shadow-2xs transition hover:border-border focus-within:border-primary focus-within:ring-1 focus-within:ring-primary/25",
        hClass,
        className,
      )}
    >
      <button
        type="button"
        disabled={disabled}
        onClick={() => onCommit(value <= min ? 0 : value - 1)}
        aria-label="decrease"
        className={cn(
          btnClass,
          "grid place-items-center text-muted-foreground/80 hover:bg-muted hover:text-foreground active:scale-95 transition disabled:opacity-40",
        )}
      >
        <Minus className="h-3 w-3" />
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
          size === "md" ? "text-xs sm:text-sm" : "text-xs",
        )}
        style={{ width: `${widthCh + 0.5}ch` }}
      />

      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          const next = value + 1;
          if (!unbounded && ceiling != null && next > ceiling) return;
          onCommit(next);
        }}
        aria-label="increase"
        className={cn(
          btnClass,
          "grid place-items-center text-muted-foreground/80 hover:bg-muted hover:text-foreground active:scale-95 transition disabled:opacity-40",
        )}
      >
        <Plus className="h-3 w-3" />
      </button>
    </div>
  );
}

import { AmountInput } from "@/components/commerce/amount-input";
import { cn } from "@/lib/utils";

export interface PriceFieldProps {
  value: number;
  onChange: (next: number) => void;
  /** Marks the field visually when it differs from the product's default. */
  modified?: boolean;
  min?: number;
  disabled?: boolean;
  ariaLabel?: string;
  className?: string;
}

export function PriceField({
  value,
  onChange,
  modified = false,
  min = 0,
  disabled = false,
  ariaLabel,
  className,
}: PriceFieldProps) {
  return (
    <div className="relative inline-flex items-center min-w-0">
      <AmountInput
        value={String(value)}
        onValueChange={(next) => onChange(next === "" ? min : Number(next))}
        label={ariaLabel ?? "Price"}
        min={min}
        decimals={2}
        disabled={disabled}
        className={cn(
          "h-7 w-full min-w-[4.25rem] rounded-lg border px-2 text-center text-xs font-semibold outline-none transition focus:border-primary focus:ring-1 focus:ring-primary/25",
          modified
            ? "border-amber-500/60 bg-amber-500/10 text-amber-700 dark:text-amber-300"
            : "border-border/80 bg-background/80 hover:border-border focus:bg-background",
          className,
        )}
      />
    </div>
  );
}

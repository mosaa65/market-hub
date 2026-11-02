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
          "h-6.5 w-full min-w-[3.5rem] rounded-md border px-1.5 text-center font-mono text-[11px] font-semibold outline-none transition focus:border-primary focus:ring-1 focus:ring-primary/20",
          modified
            ? "border-amber-500/60 bg-amber-500/10 text-amber-700 dark:text-amber-300"
            : "border-border/70 bg-background/90 hover:border-primary/40 focus:bg-background text-foreground",
          className,
        )}
      />
    </div>
  );
}

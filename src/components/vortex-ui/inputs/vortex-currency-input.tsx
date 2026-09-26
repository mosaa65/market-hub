"use client";

import * as React from "react";
import { Coins, X } from "lucide-react";
import { cn } from "@/lib/utils";

export interface VortexCurrencyInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange"> {
  value: number | null | undefined;
  onValueChange: (val: number | null) => void;
  currencySymbol?: string;
  decimals?: number;
  min?: number;
  max?: number;
  showClear?: boolean;
}

/** Formats a numeric string or number with 3-digit comma grouping e.g. "1,250,000.50" */
function formatWithCommas(raw: string): string {
  if (!raw) return "";
  const parts = raw.split(".");
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  if (parts.length > 1) {
    return `${parts[0]}.${parts[1]}`;
  }
  return parts[0];
}

/** Strips all characters except digits and decimal point */
function cleanNumericInput(str: string): string {
  // Convert Arabic/Eastern digits to western if entered
  const western = str.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 1632));
  // Replace Arabic decimal separator '،' or ',' with dot if decimal
  return western.replace(/[^0-9.]/g, "");
}

export const VortexCurrencyInput = React.forwardRef<HTMLInputElement, VortexCurrencyInputProps>(
  (
    {
      value,
      onValueChange,
      currencySymbol = "﷼",
      decimals = 2,
      min = 0,
      max,
      showClear = true,
      className,
      disabled,
      placeholder = "0.00",
      ...props
    },
    ref
  ) => {
    const inputRef = React.useRef<HTMLInputElement | null>(null);
    const combinedRef = (node: HTMLInputElement | null) => {
      inputRef.current = node;
      if (typeof ref === "function") ref(node);
      else if (ref) (ref as React.MutableRefObject<HTMLInputElement | null>).current = node;
    };

    // Keep display text formatted
    const [displayVal, setDisplayVal] = React.useState<string>(() => {
      if (value == null || isNaN(value)) return "";
      return formatWithCommas(String(value));
    });

    const isFocused = React.useRef(false);

    // Sync from props when outside updates occur
    React.useEffect(() => {
      if (isFocused.current) return;
      if (value == null || isNaN(value)) {
        setDisplayVal("");
      } else {
        setDisplayVal(formatWithCommas(String(value)));
      }
    }, [value]);

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const el = e.target;
      const rawVal = el.value;
      const cursorStart = el.selectionStart ?? rawVal.length;

      // Clean input
      let cleaned = cleanNumericInput(rawVal);

      // Handle multiple dots
      const dotIndex = cleaned.indexOf(".");
      if (dotIndex !== -1) {
        cleaned =
          cleaned.substring(0, dotIndex + 1) +
          cleaned.substring(dotIndex + 1).replace(/\./g, "").slice(0, decimals);
      }

      // Compute number
      const numVal = cleaned ? parseFloat(cleaned) : null;
      if (numVal !== null && !isNaN(numVal)) {
        if (max !== undefined && numVal > max) return;
        onValueChange(numVal);
      } else {
        onValueChange(null);
      }

      // Format with commas
      const formatted = formatWithCommas(cleaned);
      setDisplayVal(formatted);

      // Restore cursor position smoothly
      requestAnimationFrame(() => {
        if (inputRef.current) {
          const addedChars = formatted.length - rawVal.length;
          const newPos = Math.max(0, cursorStart + addedChars);
          inputRef.current.setSelectionRange(newPos, newPos);
        }
      });
    };

    const handleClear = () => {
      setDisplayVal("");
      onValueChange(null);
      inputRef.current?.focus();
    };

    return (
      <div className="group relative flex items-center w-full">
        {/* Leading Currency Icon / Symbol */}
        <div className="pointer-events-none absolute start-3 z-10 flex items-center justify-center text-muted-foreground group-focus-within:text-primary transition-colors">
          <span className="flex items-center gap-1 text-xs font-bold px-1.5 py-0.5 rounded-md bg-muted/70 group-focus-within:bg-primary/10 border border-border/40 group-focus-within:border-primary/20">
            {currencySymbol}
          </span>
        </div>

        {/* Input Control */}
        <input
          ref={combinedRef}
          type="text"
          inputMode="decimal"
          dir="ltr"
          value={displayVal}
          onChange={handleInputChange}
          onFocus={() => {
            isFocused.current = true;
          }}
          onBlur={() => {
            isFocused.current = false;
            // Format on blur cleanly
            if (value != null && !isNaN(value)) {
              setDisplayVal(formatWithCommas(String(value)));
            }
          }}
          disabled={disabled}
          placeholder={placeholder}
          className={cn(
            "h-10 w-full rounded-xl border border-input/80 bg-background/70 backdrop-blur-md px-12 py-2 text-sm font-semibold tabular-nums text-foreground transition-all duration-200",
            "shadow-xs hover:border-primary/40 hover:bg-background/90",
            "focus:border-primary focus:bg-background focus:outline-none focus:ring-4 focus:ring-primary/15",
            "disabled:cursor-not-allowed disabled:opacity-50",
            className
          )}
          {...props}
        />

        {/* Clear Button */}
        {showClear && displayVal && !disabled && (
          <button
            type="button"
            tabIndex={-1}
            onClick={handleClear}
            className="absolute end-2.5 z-10 grid h-6 w-6 place-items-center rounded-lg text-muted-foreground transition-all hover:bg-muted hover:text-foreground"
            aria-label="مسح القيمة"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    );
  }
);
VortexCurrencyInput.displayName = "VortexCurrencyInput";

"use client";

import * as React from "react";
import { Plus, Minus, Hash } from "lucide-react";
import { cn } from "@/lib/utils";

export interface VortexNumberInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange"> {
  value: number | null | undefined;
  onValueChange: (val: number | null) => void;
  min?: number;
  max?: number;
  step?: number;
  decimals?: boolean;
  allowNegative?: boolean;
  showSteppers?: boolean;
  unit?: string;
}

export const VortexNumberInput = React.forwardRef<HTMLInputElement, VortexNumberInputProps>(
  (
    {
      value,
      onValueChange,
      min = 0,
      max,
      step = 1,
      decimals = false,
      allowNegative = false,
      showSteppers = true,
      unit,
      className,
      disabled,
      placeholder = "0",
      ...props
    },
    ref
  ) => {
    const [rawText, setRawText] = React.useState<string>(() => (value == null ? "" : String(value)));
    const isEditing = React.useRef(false);

    React.useEffect(() => {
      if (isEditing.current) return;
      setRawText(value == null ? "" : String(value));
    }, [value]);

    const updateValue = (num: number | null) => {
      if (num === null) {
        onValueChange(null);
        setRawText("");
        return;
      }
      let clamped = num;
      if (min !== undefined && clamped < min) clamped = min;
      if (max !== undefined && clamped > max) clamped = max;
      onValueChange(clamped);
      setRawText(String(clamped));
    };

    const handleStep = (delta: number) => {
      const current = value ?? 0;
      updateValue(current + delta);
    };

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      let text = e.target.value.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 1632));
      const allowed = decimals ? (allowNegative ? /^-?[0-9]*\.?[0-9]*$/ : /^[0-9]*\.?[0-9]*$/) : (allowNegative ? /^-?[0-9]*$/ : /^[0-9]*$/);

      if (text !== "" && !allowed.test(text)) return;
      setRawText(text);

      if (text === "" || text === "-") {
        onValueChange(null);
      } else {
        const parsed = decimals ? parseFloat(text) : parseInt(text, 10);
        if (!isNaN(parsed)) {
          if (max !== undefined && parsed > max) return;
          onValueChange(parsed);
        }
      }
    };

    return (
      <div className="group relative flex items-center w-full">
        <input
          ref={ref}
          type="text"
          inputMode={decimals ? "decimal" : "numeric"}
          dir="ltr"
          value={rawText}
          disabled={disabled}
          placeholder={placeholder}
          onChange={handleChange}
          onFocus={() => {
            isEditing.current = true;
          }}
          onBlur={() => {
            isEditing.current = false;
            if (rawText !== "" && rawText !== "-") {
              const parsed = decimals ? parseFloat(rawText) : parseInt(rawText, 10);
              updateValue(isNaN(parsed) ? null : parsed);
            }
          }}
          className={cn(
            "h-10 w-full rounded-xl border border-input/80 bg-background/70 backdrop-blur-md px-3.5 py-2 text-sm font-semibold tabular-nums text-foreground transition-all duration-200",
            "shadow-xs hover:border-primary/40 hover:bg-background/90",
            "focus:border-primary focus:bg-background focus:outline-none focus:ring-4 focus:ring-primary/15",
            showSteppers && "pe-20",
            unit && !showSteppers && "pe-12",
            className
          )}
          {...props}
        />

        {unit && (
          <span className={cn("pointer-events-none absolute text-xs font-medium text-muted-foreground select-none", showSteppers ? "end-16" : "end-3")}>
            {unit}
          </span>
        )}

        {showSteppers && !disabled && (
          <div className="absolute end-1.5 flex items-center gap-1">
            <button
              type="button"
              tabIndex={-1}
              onClick={() => handleStep(-step)}
              className="grid h-7 w-7 place-items-center rounded-lg border border-border/50 bg-muted/60 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:scale-95"
              aria-label="إنقاص"
            >
              <Minus className="h-3 w-3" />
            </button>
            <button
              type="button"
              tabIndex={-1}
              onClick={() => handleStep(step)}
              className="grid h-7 w-7 place-items-center rounded-lg border border-border/50 bg-muted/60 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:scale-95"
              aria-label="زيادة"
            >
              <Plus className="h-3 w-3" />
            </button>
          </div>
        )}
      </div>
    );
  }
);
VortexNumberInput.displayName = "VortexNumberInput";

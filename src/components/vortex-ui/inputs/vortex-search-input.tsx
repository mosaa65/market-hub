import * as React from "react";
import { Search, X, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { pillFieldSurface, FieldSize, fieldSize } from "@/design/styles";

export interface VortexSearchInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "size" | "onChange" | "value"> {
  value: string;
  onValueChange: (value: string) => void;
  size?: FieldSize;
  loading?: boolean;
  debounceMs?: number;
  resultCount?: number;
  enableSlashShortcut?: boolean;
}

export const VortexSearchInput = React.forwardRef<HTMLInputElement, VortexSearchInputProps>(
  (
    {
      className,
      value,
      onValueChange,
      size = "md",
      loading = false,
      debounceMs = 0,
      resultCount,
      enableSlashShortcut = true,
      placeholder = "بحث...",
      disabled,
      ...props
    },
    ref,
  ) => {
    const inputRef = React.useRef<HTMLInputElement | null>(null);
    const [localValue, setLocalValue] = React.useState(value);

    // Sync external value
    React.useEffect(() => {
      setLocalValue(value);
    }, [value]);

    // Handle debounce
    React.useEffect(() => {
      if (debounceMs <= 0) return;
      const timer = setTimeout(() => {
        if (localValue !== value) {
          onValueChange(localValue);
        }
      }, debounceMs);
      return () => clearTimeout(timer);
    }, [localValue, debounceMs, onValueChange, value]);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const val = e.target.value;
      setLocalValue(val);
      if (debounceMs <= 0) {
        onValueChange(val);
      }
    };

    const handleClear = () => {
      setLocalValue("");
      onValueChange("");
      inputRef.current?.focus();
    };

    // Keyboard shortcut /
    React.useEffect(() => {
      if (!enableSlashShortcut) return;
      const handleKeyDown = (e: KeyboardEvent) => {
        if (
          e.key === "/" &&
          document.activeElement?.tagName !== "INPUT" &&
          document.activeElement?.tagName !== "TEXTAREA"
        ) {
          e.preventDefault();
          inputRef.current?.focus();
        }
      };
      window.addEventListener("keydown", handleKeyDown);
      return () => window.removeEventListener("keydown", handleKeyDown);
    }, [enableSlashShortcut]);

    return (
      <div className="relative flex w-full items-center">
        <div className="pointer-events-none absolute start-3 flex items-center justify-center text-muted-foreground/60">
          <Search className="h-4 w-4" />
        </div>

        <input
          ref={(node) => {
            inputRef.current = node;
            if (typeof ref === "function") ref(node);
            else if (ref) (ref as React.MutableRefObject<HTMLInputElement | null>).current = node;
          }}
          type="search"
          value={localValue}
          onChange={handleChange}
          disabled={disabled}
          placeholder={placeholder}
          className={cn(
            pillFieldSurface,
            fieldSize[size],
            "ps-9 pe-14",
            className,
          )}
          {...props}
        />

        <div className="absolute end-2 flex items-center gap-1.5">
          {resultCount !== undefined && !loading && (
            <span className="hidden sm:inline-block rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-medium text-muted-foreground tabular-nums">
              {resultCount}
            </span>
          )}

          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
          ) : localValue.length > 0 && !disabled ? (
            <button
              type="button"
              onClick={handleClear}
              className="flex h-5 w-5 items-center justify-center rounded-full bg-muted/60 text-foreground/70 transition-colors hover:bg-primary hover:text-primary-foreground focus:outline-none"
              title="مسح البحث"
            >
              <X className="h-3 w-3" />
            </button>
          ) : enableSlashShortcut && !disabled ? (
            <kbd className="hidden sm:inline-flex h-5 items-center justify-center rounded border border-border/80 bg-surface-2 px-1.5 text-[10px] font-medium text-muted-foreground">
              /
            </kbd>
          ) : null}
        </div>
      </div>
    );
  },
);

VortexSearchInput.displayName = "VortexSearchInput";

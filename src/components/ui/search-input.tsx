import * as React from "react";
import { Search as SearchIcon, X } from "lucide-react";

import { cn } from "@/lib/utils";
import type { FieldSize } from "@/design/styles";

export interface SearchInputProps extends Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  "size" | "type" | "onChange"
> {
  value: string;
  onValueChange: (value: string) => void;
  /** Debounce in ms. Omit for immediate updates (fine for client-side filtering). */
  debounceMs?: number;
  /** Shows a spinner instead of the search icon while searching. */
  loading?: boolean;
  /** Result count rendered as a subtle suffix. */
  resultCount?: number;
  size?: FieldSize;
  containerClassName?: string;
  /** Focuses the field when the user presses `/` anywhere on the page. */
  enableSlashShortcut?: boolean;
}

const searchSize: Record<FieldSize, string> = {
  // `pe` reserves room for the clear button only; the `/` hint and result count
  // are hidden below `sm` so the placeholder text is never squeezed.
  sm: "h-8 ps-9 pe-9 text-[13px] sm:pe-14",
  md: "h-9 ps-10 pe-9 text-sm sm:pe-14",
  lg: "h-11 ps-11 pe-9 text-base sm:pe-14 sm:text-sm",
};

/**
 * SearchInput — the single search field for the whole system.
 *
 * Visual design (per requirements):
 *  - translucent pill surface that aligns with the toolbar controls
 *  - quiet translucent surface with a crisp input layer on top
 *  - the clear button is **tinted** (primary) rather than plain grey, so it is
 *    obviously interactive
 *  - icon warms to primary and a soft ring appears on focus
 *
 * Behaviour: icon/spinner, clear, optional debounce, `/` to focus, Escape to clear,
 * `role="searchbox"`, mobile-safe (no reserved space for the count).
 */
export const SearchInput = React.forwardRef<HTMLInputElement, SearchInputProps>(
  (
    {
      value,
      onValueChange,
      debounceMs,
      loading = false,
      resultCount,
      size = "md",
      className,
      containerClassName,
      enableSlashShortcut = false,
      placeholder,
      ...props
    },
    ref,
  ) => {
    const innerRef = React.useRef<HTMLInputElement>(null);
    React.useImperativeHandle(ref, () => innerRef.current as HTMLInputElement);

    const [local, setLocal] = React.useState(value);
    const [focused, setFocused] = React.useState(false);
    const [hovered, setHovered] = React.useState(false);

    React.useEffect(() => {
      setLocal(value);
    }, [value]);

    // Debounced propagation (only when a debounce is requested).
    React.useEffect(() => {
      if (!debounceMs) return;
      if (local === value) return;
      const id = window.setTimeout(() => onValueChange(local), debounceMs);
      return () => window.clearTimeout(id);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [local, debounceMs]);

    React.useEffect(() => {
      if (!enableSlashShortcut) return;
      const onKey = (e: KeyboardEvent) => {
        if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
        const target = e.target as HTMLElement | null;
        const tag = target?.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable) return;
        e.preventDefault();
        innerRef.current?.focus();
      };
      window.addEventListener("keydown", onKey);
      return () => window.removeEventListener("keydown", onKey);
    }, [enableSlashShortcut]);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      setLocal(e.target.value);
      if (!debounceMs) onValueChange(e.target.value);
    };

    const clear = () => {
      setLocal("");
      onValueChange("");
      innerRef.current?.focus();
    };

    const hasValue = local.length > 0;

    return (
      <div
        className={cn("group relative w-full min-w-0", containerClassName)}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        {/*
         * Glass surface as a background layer only.
         *
         * `backdrop-filter` on an element that overlaps the input blurs whatever
         * is painted beneath it — including the input's own text, which is what
         * made the placeholder look foggy. The blur is therefore applied to a
         * layer that sits *behind* the input (negative z-index), and the input
         * itself stays fully crisp on top.
         */}
        <span
          aria-hidden
          className={cn(
            "pointer-events-none absolute inset-0 -z-10 rounded-full border transition-all duration-200 ease-[cubic-bezier(0.32,0.72,0,1)]",
            "shadow-[inset_0_1px_0_0_oklch(1_0_0/0.07)] backdrop-blur-xl backdrop-saturate-150",
            focused
              ? "border-primary/45 bg-surface/90 shadow-[inset_0_1px_0_0_oklch(1_0_0/0.09),0_0_0_3px_oklch(0.62_0.21_260/0.14)]"
              : hovered
                ? "border-border bg-surface/80"
                : "border-border/70 bg-surface/65",
          )}
        />

        <span
          aria-hidden
          className={cn(
            "pointer-events-none absolute inset-y-0 start-0 z-10 flex items-center ps-3.5 transition-colors duration-200 [&_svg]:size-4",
            focused ? "text-primary" : "text-muted-foreground",
          )}
        >
          {loading ? (
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
          ) : (
            <SearchIcon />
          )}
        </span>

        <input
          ref={innerRef}
          type="search"
          role="searchbox"
          value={local}
          onChange={handleChange}
          onFocus={(e) => {
            setFocused(true);
            props.onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            props.onBlur?.(e);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape" && local) {
              e.stopPropagation();
              clear();
            }
            props.onKeyDown?.(e);
          }}
          placeholder={placeholder}
          className={cn(
            searchSize[size],
            "rounded-full border-0 bg-transparent text-foreground shadow-none",
            // The input sits on a translucent glass layer, so a 70%-opacity token
            // made the placeholder practically invisible. Full muted-foreground
            // keeps it readable in both themes.
            "placeholder:text-muted-foreground",
            "focus:outline-none focus:ring-0",
            "[&::-webkit-search-cancel-button]:hidden [&::-webkit-search-decoration]:hidden",
            className,
          )}
          {...props}
        />

        <span className="absolute inset-y-0 end-0 z-10 flex items-center gap-1.5 pe-2">
          {resultCount != null ? (
            <span className="pointer-events-none hidden text-[11px] tabular-nums text-muted-foreground sm:inline">
              {resultCount}
            </span>
          ) : null}

          {hasValue ? (
            <button
              type="button"
              onClick={clear}
              aria-label="مسح البحث"
              title="مسح البحث"
              className={cn(
                "grid h-6 w-6 place-items-center rounded-full transition-all duration-200 [&_svg]:size-3.5",
                "bg-primary/15 text-primary hover:bg-primary/25",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
                "active:scale-90",
              )}
            >
              <X />
            </button>
          ) : (
            <kbd
              aria-hidden
              className="pointer-events-none hidden items-center rounded-full border border-border/60 bg-background/50 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground/70 lg:inline-flex"
            >
              /
            </kbd>
          )}
        </span>
      </div>
    );
  },
);
SearchInput.displayName = "SearchInput";

import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * SegmentedTabs — the shared "segmented control" used by form shells, page
 * guides and settings panels.
 *
 * Before this, every surface re-implemented the same pill strip with slightly
 * different radii, shadows and active treatments (products form, page guide,
 * platform admin, notifications…). One control now owns the look:
 *
 *  - a muted track with a hairline border,
 *  - the active segment lifts on a `bg-card` pill with a soft shadow,
 *  - inactive segments are quiet muted text that warm on hover,
 *  - the strip scrolls horizontally on narrow screens (`whitespace-nowrap`).
 */
export interface SegmentedTabItem<T extends string> {
  value: T;
  label: string;
  icon?: React.ReactNode;
  /** Small badge rendered after the label (e.g. a count of missing fields). */
  badge?: React.ReactNode;
  disabled?: boolean;
}

export interface SegmentedTabsProps<T extends string> {
  value: T;
  onChange: (value: T) => void;
  items: SegmentedTabItem<T>[];
  className?: string;
  /** `aria-label` for the tablist. */
  ariaLabel?: string;
}

export function SegmentedTabs<T extends string>({
  value,
  onChange,
  items,
  className,
  ariaLabel,
}: SegmentedTabsProps<T>) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={cn(
        "flex items-center gap-1.5 overflow-x-auto rounded-2xl border border-border/60 bg-muted/40 p-1.5 text-xs custom-scrollbar",
        className,
      )}
    >
      {items.map((item) => {
        const active = item.value === value;
        return (
          <button
            key={item.value}
            type="button"
            role="tab"
            aria-selected={active}
            disabled={item.disabled}
            onClick={() => onChange(item.value)}
            className={cn(
              "min-h-10 flex flex-1 items-center justify-center gap-1.5 rounded-xl px-3 py-2 font-medium whitespace-nowrap transition-all duration-200",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
              "disabled:pointer-events-none disabled:opacity-50",
              active
                ? "bg-card text-foreground shadow-sm ring-1 ring-border/60 font-semibold"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {item.icon ? <span className="[&_svg]:size-3.5">{item.icon}</span> : null}
            <span>{item.label}</span>
            {item.badge != null ? item.badge : null}
          </button>
        );
      })}
    </div>
  );
}

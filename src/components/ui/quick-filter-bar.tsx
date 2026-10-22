import * as React from "react";

import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";
import { toSystemDigits } from "@/lib/format-preferences";

/**
 * QuickFilterBar — the ONE quick-filter strip for every records screen.
 *
 * Before this there were three competing chip styles (a primary-filled strip,
 * a solid-colour strip per tone, and a quiet colourless one), each hidden in
 * some view modes. This control owns one look and one contract:
 *
 *  - **Always coloured** — the "All" chip uses the primary tone, and every
 *    other chip carries its own semantic tone (success/warning/danger/info).
 *  - **Always visible** — in cards, list AND table mode alike. The strip is
 *    deliberately NOT allowed to know about the view mode; screens render it
 *    in `RecordsToolbar`'s children (or below it) in every mode.
 *  - **Exclusive selection** — radio-like chips with an "All" first chip; the
 *    single-button-rotates-through-states pattern is retired.
 *  - **Count badge on every chip**, in system digits.
 *
 * Selection is owned by the screen; the bar is presentation only.
 */
export type QuickFilterTone = "primary" | "success" | "warning" | "danger" | "info";

export interface QuickFilterItem {
  id: string;
  label: string;
  /** Live count shown in the badge; omit to hide the badge. */
  count?: number;
  /** Chip colour. `primary` for the "All" chip, semantic tones for the rest. */
  tone?: QuickFilterTone;
}

export interface QuickFilterBarProps {
  items: QuickFilterItem[];
  value: string;
  onChange: (id: string) => void;
  className?: string;
  ariaLabel?: string;
}

const activeClasses: Record<QuickFilterTone, string> = {
  primary: "border-primary bg-primary text-primary-foreground shadow-xs shadow-primary/20",
  success: "border-emerald-600 bg-emerald-600 text-white shadow-xs shadow-emerald-600/20",
  warning: "border-amber-600 bg-amber-600 text-white shadow-xs shadow-amber-600/20",
  danger: "border-rose-600 bg-rose-600 text-white shadow-xs shadow-rose-600/20",
  info: "border-sky-600 bg-sky-600 text-white shadow-xs shadow-sky-600/20",
};

const inactiveClasses: Record<QuickFilterTone, string> = {
  primary: "border-primary/30 bg-primary/10 text-primary hover:bg-primary/20",
  success: "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20",
  warning: "border-amber-500/30 bg-amber-500/10 text-amber-600 hover:bg-amber-500/20",
  danger: "border-rose-500/30 bg-rose-500/10 text-rose-600 hover:bg-rose-500/20",
  info: "border-sky-500/30 bg-sky-500/10 text-sky-600 hover:bg-sky-500/20",
};

const badgeClasses: Record<QuickFilterTone, { active: string; inactive: string }> = {
  primary: {
    active: "bg-primary-foreground/20 text-primary-foreground",
    inactive: "bg-primary/15 text-primary",
  },
  success: {
    active: "bg-white/20 text-white",
    inactive: "bg-emerald-500/15 text-emerald-600",
  },
  warning: {
    active: "bg-white/20 text-white",
    inactive: "bg-amber-500/15 text-amber-600",
  },
  danger: {
    active: "bg-white/20 text-white",
    inactive: "bg-rose-500/15 text-rose-600",
  },
  info: {
    active: "bg-white/20 text-white",
    inactive: "bg-sky-500/15 text-sky-600",
  },
};

export function QuickFilterBar({
  items,
  value,
  onChange,
  className,
  ariaLabel,
}: QuickFilterBarProps) {
  const { t } = useI18n();

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel ?? t("common.filter")}
      className={cn(
        "flex items-center gap-1.5 overflow-x-auto pb-0.5 custom-scrollbar scrollbar-x-none",
        className,
      )}
    >
      {items.map((item, index) => {
        const tone: QuickFilterTone = item.tone ?? (index === 0 ? "primary" : "primary");
        const selected = item.id === value;
        return (
          <button
            key={item.id}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(item.id)}
            className={cn(
              "flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 active:scale-95",
              selected ? activeClasses[tone] : inactiveClasses[tone],
            )}
          >
            <span>{item.label}</span>
            {item.count != null ? (
              <span
                className={cn(
                  "rounded-full px-1.5 py-0.5 font-mono text-[10px] leading-none",
                  selected ? badgeClasses[tone].active : badgeClasses[tone].inactive,
                )}
              >
                {toSystemDigits(String(item.count))}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

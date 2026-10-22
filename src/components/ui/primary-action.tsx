import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * PrimaryAction — the ONE presentation for a screen's main action button
 * (New Invoice, New Transfer, New Product…).
 *
 * Contract (plan §9 / axis 9):
 *
 *  - There is exactly ONE primary action per screen, rendered in the
 *    records toolbar row — never repeated as a second copy elsewhere
 *    (no floating FAB duplicate, no bottom duplicate).
 *  - It matches the toolbar's own controls (filter/sort/view) visually:
 *    circular on a phone, pill with label from `sm` up, glassy surface,
 *    primary tint to mark it as the main verb.
 *  - Operational-only screens (transfer, purchase invoice, return) use the
 *    same slot and the same component — the *place* is always the toolbar,
 *    regardless of what the verb is.
 */
export interface PrimaryActionProps {
  label: string;
  icon?: React.ReactNode;
  onClick?: () => void;
  type?: "button" | "submit";
  /** Renders a small count badge (rarely used for a primary action). */
  badge?: number;
  className?: string;
}

export function PrimaryAction({
  label,
  icon,
  onClick,
  type = "button",
  badge,
  className,
}: PrimaryActionProps) {
  return (
    <button
      type={type}
      onClick={onClick}
      aria-label={label}
      title={label}
      className={cn(
        "relative inline-flex size-10 shrink-0 items-center justify-center gap-1.5 rounded-full border border-primary/45 bg-primary/12 text-sm font-semibold text-primary shadow-[var(--shadow-control)] backdrop-blur-xl transition-[background-color,border-color,color,transform] duration-200",
        "hover:bg-primary/20 active:scale-95",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
        "sm:h-11 sm:w-auto sm:px-4",
        className,
      )}
    >
      {icon ? <span className="[&_svg]:size-4">{icon}</span> : null}
      <span className="hidden sm:inline">{label}</span>
      {badge != null && badge > 0 ? (
        <span className="absolute -end-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground ring-2 ring-surface sm:static sm:ring-0">
          {badge}
        </span>
      ) : null}
    </button>
  );
}

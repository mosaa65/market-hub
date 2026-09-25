import * as React from "react";

import { cn } from "@/lib/utils";
import { toneClasses, type Tone } from "@/design/styles";

export interface StatusBadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: Tone;
  /** Leading dot — useful for live/active states. */
  dot?: boolean;
  size?: "sm" | "md";
  icon?: React.ReactNode;
}

/**
 * StatusBadge — one status pill for the whole app.
 *
 * Replaces the ~8 hand-rolled status pills currently scattered across pages
 * (`bg-success/10 text-success`, `bg-muted text-muted-foreground`, …) and the
 * hard-coded palette colors that broke in light mode.
 */
export function StatusBadge({
  tone = "neutral",
  dot = false,
  size = "sm",
  icon,
  className,
  children,
  ...props
}: StatusBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border font-medium",
        size === "sm" ? "px-2 py-0.5 text-[11px]" : "px-2.5 py-1 text-xs",
        toneClasses[tone].badge,
        className,
      )}
      {...props}
    >
      {dot ? (
        <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", toneClasses[tone].bar)} />
      ) : null}
      {icon ? (
        <span className="shrink-0 [&_svg]:size-3" aria-hidden>
          {icon}
        </span>
      ) : null}
      {children}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  Semantic status helpers                                            */
/* ------------------------------------------------------------------ */

/** Map an `is_active`-style boolean to a tone + label pair. */
export function activeStatusTone(active: boolean | null | undefined): {
  tone: Tone;
  key: "common.active" | "common.inactive";
} {
  return active
    ? { tone: "success", key: "common.active" }
    : { tone: "neutral", key: "common.inactive" };
}

/**
 * Map a free-form document status string to a visual tone.
 *
 * IMPORTANT: this only *reads* whatever values already exist in the database
 * (see NON_UI_FINDINGS.md / DATABASE_CHANGE_NOTES.md — no status values are
 * changed, normalized or persisted by the UI).
 */
export function documentStatusTone(status: string | null | undefined): Tone {
  const s = (status ?? "").toLowerCase().trim();
  if (!s) return "neutral";
  if (
    [
      "paid",
      "completed",
      "complete",
      "posted",
      "approved",
      "active",
      "confirmed",
      "delivered",
      "received",
    ].includes(s)
  )
    return "success";
  if (
    [
      "pending",
      "partial",
      "partially_paid",
      "draft",
      "processing",
      "in_transit",
      "awaiting",
    ].includes(s)
  )
    return "warning";
  if (["cancelled", "canceled", "void", "rejected", "failed", "overdue", "expired"].includes(s))
    return "danger";
  if (["refunded", "returned", "return"].includes(s)) return "info";
  return "neutral";
}

/** Stock-level tone: out of stock / below minimum / healthy. */
export function stockTone(quantity: number, minStock?: number | null): Tone {
  if (quantity <= 0) return "danger";
  if (minStock != null && quantity <= minStock) return "warning";
  return "success";
}

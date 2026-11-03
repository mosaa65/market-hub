/* eslint-disable react-refresh/only-export-components -- يصدّر الأنماط مع المكوّن عمداً */
import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * ActionButton — the plan's unified primary/secondary action.
 *
 * The decision it implements (§2 and §9.3): a primary action is
 * **a coloured label plus a small round icon badge beside the text**. Before
 * this, each page assembled that by hand — and they drifted: three different
 * icon sizes, three different badge radii, some pages with the icon on the
 * start edge and some on the end, disabled states that only greyed the text.
 *
 * It is deliberately built on the same token vocabulary as `Button` (primary /
 * outline / ghost / danger), so a screen can migrate one action at a time and
 * the two never look like different design systems.
 *
 * Fixed states are part of the contract, not the caller's problem:
 *   - `loading` → spinner replaces the icon, the control is disabled and
 *     `aria-busy` is set, so a double-submit cannot happen.
 *   - `disabled` → the same geometry with a muted fill; the label never
 *     reflows because the icon badge keeps its size.
 *
 * @example
 * ```tsx
 * <ActionButton icon={<Plus />} tone="primary" onClick={openNew}>
 *   {t("common.new")}
 * </ActionButton>
 * ```
 */
const actionButtonVariants = cva(
  [
    "group/action inline-flex shrink-0 items-center gap-2 whitespace-nowrap",
    "rounded-xl text-sm font-semibold cursor-pointer select-none",
    "transition-[background-color,border-color,color,box-shadow,transform] duration-200",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
    "active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-55 disabled:active:scale-100",
  ].join(" "),
  {
    variants: {
      tone: {
        primary:
          "bg-primary text-primary-foreground shadow-[var(--shadow-control)] hover:bg-primary/90",
        outline:
          "border border-border/80 bg-surface text-foreground hover:border-primary/35 hover:bg-surface-2",
        ghost: "text-muted-foreground hover:bg-surface-2 hover:text-foreground",
        danger:
          "bg-destructive text-destructive-foreground shadow-[var(--shadow-control)] hover:bg-destructive/90",
      },
      size: {
        sm: "h-9 ps-1 pe-3 text-xs",
        md: "h-10 ps-1.5 pe-4 text-sm",
        lg: "h-11 ps-1.5 pe-5 text-sm",
      },
    },
    defaultVariants: { tone: "primary", size: "md" },
  },
);

/** The round icon badge sitting inside an action. */
const badgeVariants = cva(
  "grid shrink-0 place-items-center rounded-full transition-colors [&_svg]:size-4",
  {
    variants: {
      tone: {
        primary: "bg-white/20 text-primary-foreground",
        outline: "bg-primary/10 text-primary group-hover/action:bg-primary/16",
        ghost: "bg-surface-2 text-muted-foreground group-hover/action:text-foreground",
        danger: "bg-white/20 text-destructive-foreground",
      },
      size: {
        sm: "size-7",
        md: "size-8",
        lg: "size-8",
      },
    },
    defaultVariants: { tone: "primary", size: "md" },
  },
);

export interface ActionButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof actionButtonVariants> {
  /** Rendered inside the round badge on the leading edge. */
  icon?: React.ReactNode;
  /** Replaces the icon with a spinner and blocks interaction. */
  loading?: boolean;
  /** Hide the text and keep an icon-only square control (tight toolbars). */
  iconOnly?: boolean;
  /** Hover/focus hint. Do not rely on `title` alone for a collapsed control. */
  hint?: React.ReactNode;
}

export const ActionButton = React.forwardRef<HTMLButtonElement, ActionButtonProps>(
  (
    {
      className,
      tone = "primary",
      size = "md",
      icon,
      loading = false,
      iconOnly = false,
      disabled,
      children,
      ...props
    },
    ref,
  ) => {
    return (
      <button
        ref={ref}
        type={props.type ?? "button"}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        title={typeof props.hint === "string" ? props.hint : undefined}
        className={cn(
          actionButtonVariants({ tone, size }),
          // Icon-only keeps a square, tappable geometry.
          iconOnly && "gap-0 p-0",
          iconOnly && (size === "sm" ? "size-9" : size === "lg" ? "size-11" : "size-10"),
          className,
        )}
        {...props}
      >
        {!iconOnly ? (
          <span className={cn(badgeVariants({ tone, size }))} aria-hidden={!loading}>
            {loading ? <Loader2 className="animate-spin" /> : icon}
          </span>
        ) : loading ? (
          <Loader2 className="size-4 animate-spin" aria-hidden />
        ) : (
          <span className="[&_svg]:size-4" aria-hidden>
            {icon}
          </span>
        )}
        {!iconOnly ? children : null}
        {iconOnly ? <span className="sr-only">{children}</span> : null}
      </button>
    );
  },
);

ActionButton.displayName = "ActionButton";

/* ------------------------------------------------------------------ */
/*  Quiet state chips — one calm palette for active filters            */
/* ------------------------------------------------------------------ */

/**
 * The plan asks for "quiet, unified status colours" on filter chips and stock
 * segments (§9.3). Pages were using `bg-primary` fully saturated for a selected
 * chip, which made a filter row louder than the records it filters. This is the
 * shared recipe: a soft tinted pill with a readable label in both themes.
 */
export const QUIET_CHIP_CLASS =
  "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50";

export function quietChipClass(active: boolean, className?: string) {
  return cn(
    QUIET_CHIP_CLASS,
    active
      ? "border-primary/40 bg-primary/12 text-primary"
      : "border-border/70 bg-surface/60 text-muted-foreground hover:bg-surface-2 hover:text-foreground",
    className,
  );
}

export { actionButtonVariants, badgeVariants };

import * as React from "react";

import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Spinner } from "@/components/ui/feedback";
import type { Tone } from "@/design/styles";

export interface IconButtonProps extends Omit<
  React.ButtonHTMLAttributes<HTMLButtonElement>,
  "children"
> {
  /** The icon element to render. */
  icon: React.ReactNode;
  /**
   * Accessible name. Required — icon-only buttons must never rely on `title` alone,
   * because `title` is not a reliable accessible name for screen readers.
   */
  ariaLabel: string;
  size?: "sm" | "md" | "lg";
  variant?: "ghost" | "outline" | "solid" | "danger";
  tone?: Tone;
  loading?: boolean;
  /** Show a tooltip on hover/focus, using `ariaLabel` as its content. */
  tooltip?: boolean;
  /** Fully circular (used by table row actions). */
  round?: boolean;
}

const sizes = {
  sm: "h-8 w-8 rounded-lg [&_svg]:size-3.5",
  md: "h-9 w-9 rounded-[10px] [&_svg]:size-4",
  lg: "h-10 w-10 rounded-xl [&_svg]:size-4.5",
} as const;

/** Radius applied when `round` is set — overrides the size's own radius. */
const roundSize = {
  sm: "h-8 w-8",
  md: "h-9 w-9",
  lg: "h-10 w-10",
} as const;

const variants = {
  ghost: "text-muted-foreground hover:bg-accent hover:text-foreground",
  outline:
    "border border-border bg-surface text-muted-foreground hover:bg-accent hover:text-foreground",
  solid: "bg-primary text-primary-foreground hover:bg-primary/90",
  danger: "border border-destructive/25 bg-destructive/5 text-destructive hover:bg-destructive/10",
} as const;

/**
 * IconButton — one implementation for every icon-only action in the app
 * (table row actions, header controls, picker affordances).
 */
export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  (
    {
      icon,
      ariaLabel,
      size = "md",
      variant = "ghost",
      loading = false,
      tooltip = false,
      round = false,
      className,
      disabled,
      ...props
    },
    ref,
  ) => {
    const button = (
      <button
        ref={ref}
        type="button"
        aria-label={ariaLabel}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        className={cn(
          "inline-grid shrink-0 place-items-center transition-[background-color,border-color,color,opacity] duration-200",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
          "disabled:pointer-events-none disabled:opacity-50 disabled:cursor-not-allowed",
          round ? roundSize[size] : sizes[size],
          round && "rounded-full [&_svg]:size-4",
          variants[variant],
          className,
        )}
        {...props}
      >
        {loading ? <Spinner size={size === "sm" ? "sm" : "md"} /> : icon}
      </button>
    );

    if (!tooltip) return button;

    return (
      <TooltipProvider delayDuration={300}>
        <Tooltip>
          <TooltipTrigger asChild>{button}</TooltipTrigger>
          <TooltipContent side="top">{ariaLabel}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  },
);
IconButton.displayName = "IconButton";

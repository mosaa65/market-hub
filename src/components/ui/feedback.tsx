import * as React from "react";
import { Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { toneClasses, type Tone } from "@/design/styles";
import { Button } from "@/components/ui/button";

/* ------------------------------------------------------------------ */
/*  Spinner                                                            */
/* ------------------------------------------------------------------ */

export interface SpinnerProps extends React.HTMLAttributes<HTMLSpanElement> {
  size?: "sm" | "md" | "lg";
}

const spinnerSize = { sm: "h-3.5 w-3.5", md: "h-4 w-4", lg: "h-5 w-5" } as const;

export function Spinner({ className, size = "md", ...props }: SpinnerProps) {
  return (
    <Loader2
      aria-hidden
      className={cn("animate-spin text-current", spinnerSize[size], className)}
      {...(props as React.ComponentProps<typeof Loader2>)}
    />
  );
}

/* ------------------------------------------------------------------ */
/*  EmptyState                                                         */
/* ------------------------------------------------------------------ */

export interface EmptyStateProps {
  /** Icon rendered inside the tinted badge. */
  icon?: React.ReactNode;
  title: string;
  description?: string;
  /** Primary call to action (e.g. "New product"). */
  action?: React.ReactNode;
  /** Secondary, quieter hint below the action. */
  hint?: string;
  tone?: Tone;
  /** `inline` fits inside a table body / panel; `page` fills a page section. */
  variant?: "inline" | "page";
  className?: string;
}

/**
 * EmptyState — the single empty representation for tables, lists, pickers and
 * dashboards. Replaces the per-page `<td colSpan>` blocks found across the app.
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  hint,
  tone = "neutral",
  variant = "inline",
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center text-center",
        variant === "page" ? "gap-3 px-6 py-16" : "gap-2.5 px-6 py-12",
        className,
      )}
    >
      {icon ? (
        <div
          className={cn(
            "grid h-11 w-11 place-items-center rounded-2xl border [&_svg]:size-5",
            toneClasses[tone].badge,
          )}
        >
          {icon}
        </div>
      ) : null}

      <div className="space-y-1">
        <p className={cn("text-sm font-medium", variant === "page" ? "text-base" : "")}>{title}</p>
        {description ? (
          <p className="mx-auto max-w-sm text-xs leading-5 text-muted-foreground">{description}</p>
        ) : null}
      </div>

      {action ? <div className="mt-1">{action}</div> : null}
      {hint ? <p className="text-caption text-muted-foreground/70">{hint}</p> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  ErrorState                                                         */
/* ------------------------------------------------------------------ */

export interface ErrorStateProps {
  title?: string;
  description?: string;
  /** Retry handler. When provided, a retry button is rendered. */
  onRetry?: () => void;
  retryLabel?: string;
  className?: string;
}

/** Error boundary representation with an optional retry action. */
export function ErrorState({
  title = "Something went wrong",
  description,
  onRetry,
  retryLabel = "Retry",
  className,
}: ErrorStateProps) {
  return (
    <EmptyState
      tone="danger"
      variant="page"
      className={className}
      icon={<span className="text-base font-bold">!</span>}
      title={title}
      description={description}
      action={
        onRetry ? (
          <Button variant="outline" size="sm" onClick={onRetry}>
            {retryLabel}
          </Button>
        ) : undefined
      }
    />
  );
}

/* ------------------------------------------------------------------ */
/*  LoadingState                                                       */
/* ------------------------------------------------------------------ */

export interface LoadingStateProps {
  label?: string;
  className?: string;
}

/** Full-section loading indicator (use DataTableSkeleton for table bodies). */
export function LoadingState({ label, className }: LoadingStateProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn("flex flex-col items-center justify-center gap-2.5 px-6 py-14", className)}
    >
      <Spinner size="lg" className="text-muted-foreground" />
      {label ? <p className="text-xs text-muted-foreground">{label}</p> : null}
    </div>
  );
}

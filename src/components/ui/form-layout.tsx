import * as React from "react";

import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/*  FormGrid — responsive field layout                                 */
/* ------------------------------------------------------------------ */

export interface FormGridProps extends React.HTMLAttributes<HTMLDivElement> {
  /**
   * Column count on large screens. Tablets get one fewer, phones get one.
   * (Requirement #12: 3 → 2 → 1 by default, overridable per form.)
   */
  cols?: 1 | 2 | 3 | 4;
  /** Gap between fields. */
  gap?: "sm" | "md" | "lg";
}

const gridCols: Record<NonNullable<FormGridProps["cols"]>, string> = {
  1: "grid-cols-1",
  2: "grid-cols-1 sm:grid-cols-2",
  3: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3",
  4: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-4",
};

const gridGap = { sm: "gap-3", md: "gap-3.5", lg: "gap-5" } as const;

/**
 * FormGrid — the layout container for form fields.
 *
 * Not every form should collapse to one column: a 2-column pair (amount + currency)
 * is usually better left side-by-side on tablet. Use `span` on the field for that.
 */
export function FormGrid({ cols = 3, gap = "md", className, ...props }: FormGridProps) {
  return <div className={cn("grid", gridCols[cols], gridGap[gap], className)} {...props} />;
}

/* ------------------------------------------------------------------ */
/*  FormSection — visual grouping inside a form                        */
/* ------------------------------------------------------------------ */

export interface FormSectionProps extends React.HTMLAttributes<HTMLDivElement> {
  title?: string;
  description?: string;
  /** Right-aligned actions, rendered on the same row as the title. */
  actions?: React.ReactNode;
}

export function FormSection({
  title,
  description,
  actions,
  className,
  children,
  ...props
}: FormSectionProps) {
  return (
    <section className={cn("space-y-3.5", className)} {...props}>
      {title || actions ? (
        <div className="flex items-start justify-between gap-3 border-b border-border/60 pb-2.5">
          <div className="min-w-0 space-y-0.5">
            {title ? <h3 className="text-section truncate">{title}</h3> : null}
            {description ? (
              <p className="text-caption text-muted-foreground">{description}</p>
            ) : null}
          </div>
          {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  FormActions — canonical dialog / form footer                       */
/* ------------------------------------------------------------------ */

export interface FormActionsProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Cancel/secondary node. */
  cancel?: React.ReactNode;
  /** Submit/primary node. */
  submit?: React.ReactNode;
  /** Extra controls rendered at the start of the row (e.g. a delete button). */
  start?: React.ReactNode;
  /** Sticks the footer to the bottom of a scrollable dialog and adds safe-area padding. */
  sticky?: boolean;
  /**
   * Makes the actions span the full width of the form at every breakpoint
   * (each button takes an equal share). Default is full-width on mobile only.
   */
  fullWidth?: boolean;
}

export function FormActions({
  cancel,
  submit,
  start,
  sticky = true,
  fullWidth = false,
  className,
  children,
  ...props
}: FormActionsProps) {
  return (
    <div
      className={cn(
        "flex flex-col-reverse gap-2 border-t border-border/60 pt-4 sm:flex-row sm:items-center",
        start ? "sm:justify-between" : "sm:justify-end",
        sticky && "sticky bottom-0 z-10 bg-surface/95 pb-safe backdrop-blur-sm",
        className,
      )}
      {...props}
    >
      {start ? <div className="flex items-center gap-2">{start}</div> : null}
      <div
        className={cn(
          "flex flex-col-reverse gap-2",
          fullWidth ? "w-full sm:flex-row" : "sm:flex-row sm:items-center",
          // Every action takes an equal share of the row when full-width.
          fullWidth && "[&>*]:flex-1",
        )}
      >
        {cancel}
        {submit}
        {children}
      </div>
    </div>
  );
}

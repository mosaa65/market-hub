import * as React from "react";
import { Inbox, Table2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { EmptyState, Spinner } from "@/components/ui/feedback";
import { QueryErrorState } from "@/components/ui/connection";
import type { RecordsViewMode } from "@/components/ui/records-view";

/**
 * RecordsStates — the unified set of loading / empty / error presentations for
 * every records list, across cards, list, and table view modes.
 */

/** The unified cards grid — matches `RecordsView`'s default. */
export const UNIFIED_CARDS_GRID =
  "grid grid-cols-2 gap-2.5 sm:gap-4 md:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5";

/* ------------------------------------------------------------------ */
/*  Skeleton                                                           */
/* ------------------------------------------------------------------ */

export function RecordsSkeleton({
  mode,
  count,
  className,
}: {
  mode: RecordsViewMode;
  /** How many placeholders to draw; defaults to one screen's worth per mode. */
  count?: number;
  className?: string;
}) {
  if (mode === "table") {
    const rowCount = count ?? 7;
    return (
      <div
        role="status"
        aria-live="polite"
        className={cn(
          "w-full overflow-hidden rounded-2xl border border-border/70 bg-card/60 shadow-xs",
          className,
        )}
      >
        {/* Table Top Bar */}
        <div className="flex items-center justify-between border-b border-border/60 bg-muted/40 px-4 py-2.5">
          <div className="flex items-center gap-2">
            <Table2 className="h-4 w-4 text-primary" />
            <div className="h-3.5 w-28 rounded-md bg-surface-3/80 shimmer" />
          </div>
          <div className="h-4 w-16 rounded-full bg-surface-2/70 shimmer" />
        </div>

        {/* Realistic Table with matching columns and shimmer rows */}
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-right border-collapse">
            <thead>
              <tr className="border-b border-border/70 bg-surface-2/50 font-semibold text-foreground">
                <th className="py-2.5 px-4 text-start w-[240px]">
                  <div className="h-3 w-24 rounded bg-surface-3/80 shimmer" />
                </th>
                <th className="py-2.5 px-3 text-start w-[140px] hidden sm:table-cell">
                  <div className="h-3 w-16 rounded bg-surface-3/80 shimmer" />
                </th>
                <th className="py-2.5 px-3 text-start w-[130px] hidden md:table-cell">
                  <div className="h-3 w-16 rounded bg-surface-3/80 shimmer" />
                </th>
                <th className="py-2.5 px-3 text-center w-[110px]">
                  <div className="h-3 w-12 mx-auto rounded bg-surface-3/80 shimmer" />
                </th>
                <th className="py-2.5 px-3 text-end w-[130px]">
                  <div className="h-3 w-16 ms-auto rounded bg-surface-3/80 shimmer" />
                </th>
                <th className="py-2.5 px-4 text-end w-[100px]">
                  <div className="h-3 w-12 ms-auto rounded bg-surface-3/80 shimmer" />
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {Array.from({ length: rowCount }).map((_, r) => (
                <tr key={r} className="border-b border-border/40 transition-colors">
                  <td className="py-3 px-4 text-start">
                    <div className="space-y-1.5">
                      <div
                        className="h-3.5 rounded bg-surface-3/80 shimmer"
                        style={{ width: `${60 + ((r * 13) % 35)}%` }}
                      />
                      <div className="h-2.5 w-24 rounded bg-surface-2/60 shimmer" />
                    </div>
                  </td>
                  <td className="py-3 px-3 text-start hidden sm:table-cell">
                    <div className="h-3 w-20 rounded bg-surface-2/70 shimmer" />
                  </td>
                  <td className="py-3 px-3 text-start hidden md:table-cell">
                    <div className="h-3 w-16 rounded bg-surface-2/70 shimmer" />
                  </td>
                  <td className="py-3 px-3 text-center">
                    <div className="h-5 w-14 mx-auto rounded-full bg-surface-2/70 shimmer" />
                  </td>
                  <td className="py-3 px-3 text-end">
                    <div className="h-3.5 w-16 ms-auto rounded bg-surface-3/90 shimmer" />
                  </td>
                  <td className="py-3 px-4 text-end">
                    <div className="h-7 w-8 ms-auto rounded-lg bg-surface-2/60 shimmer" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <span className="sr-only">
          <Spinner /> Loading
        </span>
      </div>
    );
  }

  if (mode === "list") {
    const listCount = count ?? 6;
    return (
      <div role="status" aria-live="polite" className={cn("space-y-2.5", className)}>
        {Array.from({ length: listCount }).map((_, i) => (
          <div
            key={i}
            className="card-mullak flex items-center justify-between p-3 sm:p-3.5 rounded-xl border border-border/70 bg-card/60 shadow-xs"
          >
            <div className="flex items-center gap-3 min-w-0 flex-1">
              {/* Leading Icon/Thumbnail */}
              <div className="size-10 sm:size-11 shrink-0 rounded-xl bg-surface-3/80 shimmer aspect-square" />
              {/* Title & metadata */}
              <div className="space-y-1.5 flex-1 min-w-0">
                <div
                  className="h-4 rounded-md bg-surface-3/90 shimmer"
                  style={{ width: `${55 + ((i * 17) % 35)}%`, maxWidth: "320px" }}
                />
                <div className="flex items-center gap-2">
                  <div className="h-3 w-16 rounded-full bg-surface-2/70 shimmer" />
                  <div className="h-3 w-20 rounded-full bg-surface-2/60 shimmer" />
                </div>
              </div>
            </div>

            {/* Trailing Price/Metric & Action button */}
            <div className="flex items-center gap-3 shrink-0">
              <div className="text-end space-y-1">
                <div className="h-4 w-20 rounded-md bg-surface-3/90 shimmer" />
                <div className="h-2.5 w-12 rounded bg-surface-2/60 ms-auto shimmer" />
              </div>
              <div className="size-8 rounded-lg bg-surface-2/60 shimmer" />
            </div>
          </div>
        ))}
        <span className="sr-only">
          <Spinner /> Loading
        </span>
      </div>
    );
  }

  // Cards / Grid mode: simulates product / card layout with rich details
  const cardsCount = count ?? 8;
  return (
    <div role="status" aria-live="polite" className={cn(UNIFIED_CARDS_GRID, className)}>
      {Array.from({ length: cardsCount }).map((_, i) => (
        <div
          key={i}
          className="card-mullak flex flex-col justify-between p-3.5 sm:p-4 rounded-2xl border border-border/70 bg-card/60 shadow-xs overflow-hidden relative min-h-[220px]"
        >
          <div className="space-y-3">
            {/* Header: Category Badge & Barcode pill */}
            <div className="flex items-center justify-between gap-1.5">
              <div className="h-4.5 w-18 rounded-full bg-primary/10 border border-primary/20 shimmer" />
              <div className="h-4 w-12 rounded-md bg-surface-2/70 shimmer" />
            </div>

            {/* Thumbnail Box & Title */}
            <div className="flex items-start gap-2.5 pt-1">
              <div className="size-11 sm:size-12 shrink-0 rounded-xl bg-surface-3/80 shimmer aspect-square border border-border/50" />
              <div className="flex-1 space-y-1.5 pt-0.5">
                <div
                  className="h-3.5 rounded-md bg-surface-3/90 shimmer"
                  style={{ width: `${75 + ((i * 11) % 25)}%` }}
                />
                <div className="h-3 w-2/3 rounded-md bg-surface-2/70 shimmer" />
              </div>
            </div>

            {/* Attributes / Pills row */}
            <div className="flex flex-wrap items-center gap-1.5 pt-1">
              <div className="h-4 w-12 rounded-full bg-surface-2/60 shimmer" />
              <div className="h-4 w-14 rounded-full bg-surface-2/60 shimmer" />
              <div className="h-4 w-10 rounded-full bg-surface-2/60 shimmer" />
            </div>
          </div>

          {/* Footer: Price & Quick Action button */}
          <div className="mt-4 pt-2.5 border-t border-border/40 flex items-center justify-between">
            <div className="space-y-1">
              <div className="h-2.5 w-8 rounded bg-surface-2/60 shimmer" />
              <div className="h-4.5 w-20 rounded-md bg-surface-3/90 shimmer" />
            </div>
            <div className="h-7.5 w-14 rounded-xl bg-primary/10 border border-primary/20 shimmer" />
          </div>
        </div>
      ))}
      <span className="sr-only">
        <Spinner /> Loading
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Empty                                                              */
/* ------------------------------------------------------------------ */

export interface RecordsEmptyProps {
  title: string;
  description?: string;
  icon?: React.ReactNode;
  /** Usually the "New …" action, repeated inside the empty state. */
  action?: React.ReactNode;
  hint?: string;
  className?: string;
}

export function RecordsEmpty({
  title,
  description,
  icon,
  action,
  hint,
  className,
}: RecordsEmptyProps) {
  return (
    <EmptyState
      variant="page"
      icon={icon ?? <Inbox />}
      title={title}
      description={description}
      action={action}
      hint={hint}
      className={className}
    />
  );
}

/* ------------------------------------------------------------------ */
/*  Error                                                              */
/* ------------------------------------------------------------------ */

export function RecordsError({
  error,
  onRetry,
  className,
}: {
  error: unknown;
  onRetry?: () => void;
  className?: string;
}) {
  return <QueryErrorState error={error} onRetry={onRetry} className={className} />;
}

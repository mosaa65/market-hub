"use client";

import * as React from "react";
import { Inbox, Loader2, AlertCircle, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

export interface VortexColumn<T> {
  key: string;
  header: React.ReactNode;
  cell: (row: T, index: number) => React.ReactNode;
  align?: "start" | "end" | "center";
  className?: string;
  hideBelow?: "sm" | "md" | "lg";
  width?: string;
  sticky?: boolean;
  sortable?: boolean;
}

export interface VortexStreamingTableProps<T extends { id: string | number }> {
  columns: VortexColumn<T>[];
  rows: T[];
  isLoading?: boolean;
  error?: Error | null;
  onRetry?: () => void;
  /** Infinite scroll controls */
  fetchNextPage?: () => void;
  hasNextPage?: boolean;
  isFetchingNextPage?: boolean;
  /** Unique ID of the recently-updated/inserted row to flash-highlight. */
  highlightRowId?: string | number | null;
  emptyState?: React.ReactNode;
  onRowClick?: (row: T) => void;
  className?: string;
  rowClassName?: (row: T) => string | undefined;
  /** Rendered as extra content above the table (toolbar, filters). */
  toolbar?: React.ReactNode;
}

const hideClass: Record<string, string> = {
  sm: "hidden sm:table-cell",
  md: "hidden md:table-cell",
  lg: "hidden lg:table-cell",
};

export function VortexStreamingTable<T extends { id: string | number }>({
  columns,
  rows,
  isLoading,
  error,
  onRetry,
  fetchNextPage,
  hasNextPage,
  isFetchingNextPage,
  highlightRowId,
  emptyState,
  onRowClick,
  className,
  rowClassName,
  toolbar,
}: VortexStreamingTableProps<T>) {
  const scrollRef = React.useRef<HTMLDivElement | null>(null);

  // Intersection Observer triggers fetchNextPage when user scrolls near the bottom.
  const sentinelRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    if (!sentinelRef.current) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && hasNextPage && !isFetchingNextPage) {
            fetchNextPage?.();
          }
        }
      },
      { rootMargin: "320px 0px" }
    );
    if (sentinelRef.current) {
      observer.observe(sentinelRef.current);
    }
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage, rows.length]);

  // Empty / Loading / Error states
  if (isLoading) {
    return (
      <div className={cn("flex flex-col gap-2.5 rounded-2xl border border-border/60 bg-card/60 p-6", className)}>
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            className="h-10 animate-pulse rounded-xl bg-muted/50"
            style={{ animationDelay: `${i * 80}ms`, opacity: 1 - i * 0.15 }}
          />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-destructive/20 bg-destructive/5 p-8 text-center">
        <AlertCircle className="h-8 w-8 text-destructive" />
        <div>
          <p className="text-sm font-semibold text-destructive">تعذر تحميل البيانات</p>
          <p className="text-xs text-muted-foreground mt-1">{error.message}</p>
        </div>
        {onRetry && (
          <button
            onClick={onRetry}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border/50 bg-card px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            إعادة المحاولة
          </button>
        )}
      </div>
    );
  }

  if (!rows || rows.length === 0) {
    return (
      <div className={cn("rounded-2xl border border-dashed border-border/60 bg-card/40", className)}>
        {emptyState || (
          <div className="flex flex-col items-center justify-center gap-2 py-12">
            <Inbox className="h-8 w-8 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">لا توجد سجلات للعرض</p>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={cn("overflow-hidden rounded-2xl border border-border/60 bg-card/60", className)}>
      {toolbar}
      <div ref={scrollRef} className="relative overflow-x-auto">
        <table className="w-full caption-bottom text-sm">
          <thead>
            <tr className="border-b border-border/50 bg-muted/30">
              {columns.map((col, idx) => (
                <th
                  key={col.key}
                  className={cn(
                    "h-10 px-3 text-xs font-semibold text-muted-foreground whitespace-nowrap select-none",
                    col.align === "end" ? "text-end" : col.align === "center" ? "text-center" : "text-start",
                    col.hideBelow && hideClass[col.hideBelow],
                    col.className
                  )}
                  style={col.width ? { width: col.width } : undefined}
                >
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="[&_tr:last-child]:border-0">
            {rows.map((row, index) => (
              <tr
                key={String(row.id)}
                onClick={() => onRowClick?.(row)}
                className={cn(
                  "border-b border-border/40 transition-colors duration-200",
                  onRowClick && "cursor-pointer hover:bg-muted/40",
                  highlightRowId === row.id && "bg-primary/8 flash-row-update",
                  rowClassName?.(row)
                )}
              >
                {columns.map((col) => (
                  <td
                    key={col.key}
                    className={cn(
                      "px-3 py-2.5 align-middle whitespace-nowrap",
                      col.align === "end" ? "text-end" : col.align === "center" ? "text-center" : "text-start",
                      col.hideBelow && hideClass[col.hideBelow],
                      col.className
                    )}
                  >
                    {col.cell(row, index)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>

        {/* Infinite streaming sentinel */}
        <div ref={sentinelRef} className="flex h-16 items-center justify-center">
          {isFetchingNextPage ? (
            <span className="inline-flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              جلب المزيد من السجلات…
            </span>
          ) : hasNextPage ? (
            <span className="text-[11px] text-muted-foreground/50">مرر لأسفل لعرض المزيد</span>
          ) : (
            <span className="text-[11px] text-muted-foreground/40">وصلت لنهاية القائمة</span>
          )}
        </div>
      </div>
    </div>
  );
}

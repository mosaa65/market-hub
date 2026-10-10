import * as React from "react";
import { ChevronDown, Inbox, Loader2, RefreshCw } from "lucide-react";

import { cn } from "@/lib/utils";
import { DataTable, type DataTableColumn, type DataTableSort } from "@/components/ui/data-table";
import { EmptyState, Spinner } from "@/components/ui/feedback";
import { QueryErrorState } from "@/components/ui/connection";

/**
 * RecordsView — the shared "one record, three presentations" surface.
 *
 * A record list has three legitimate presentations and they must not drift:
 *
 *  - `cards` — scanning on a phone, two-up grid, one record per tile.
 *  - `list`  — dense rows, comparing several records at once.
 *  - `table` — columns, sorting, horizontal comparison.
 *
 * Before this component each screen re-implemented the toggle, the card markup,
 * the list markup and — crucially — a *different* set of loading/empty/error
 * states per mode. That is how the same page ended up showing a bespoke error
 * panel in one mode and a `DataTable` empty state in another.
 *
 * What this component owns: mode selection, the surrounding panel, and the
 * loading / refreshing / error / empty / load-more states **shared by all three
 * modes**.
 *
 * What it deliberately does NOT own: field names, money/date formatting,
 * permissions, and the record actions. Those arrive as typed renderers from the
 * screen that knows the domain — see `renderCard` / `renderListRow` / `columns`.
 * No Supabase, no query keys, no business rules live here.
 *
 * @see docs/STAGED_RECORDS_PAGE_UNIFICATION_PLAN_AR.md §4 Phase 3
 * @see docs/UNIFIED_RECORD_LISTS_AUDIT_AND_REPAIR_PLAN_AR.md §4
 */

/** The presentations a screen can offer. Only render what the screen supports. */
export type RecordsViewMode = "cards" | "list" | "table";

export interface RecordsViewEmpty {
  title: string;
  description?: string;
  icon?: React.ReactNode;
  /** Usually the "New …" action, repeated inside the empty state. */
  action?: React.ReactNode;
  /** Quieter hint below the action. */
  hint?: string;
}

export interface RecordsViewProps<T> {
  /** Rows for the currently selected mode. Ordering is the screen's decision. */
  rows: T[];
  /** Stable identity for React keys and for the table. */
  getRowId: (row: T) => string;

  /** Selected presentation. */
  viewMode: RecordsViewMode;

  /* ---- Table mode ---- */
  columns?: DataTableColumn<T>[];
  /** Controlled header sort. The screen owns the sorted `rows` it passes in. */
  sort?: DataTableSort | null;
  onSortChange?: (sort: DataTableSort | null) => void;

  /* ---- Cards / list modes ---- */
  /** Full card markup for one record. */
  renderCard?: (row: T, index: number) => React.ReactNode;
  /** Full list-row markup for one record. */
  renderListRow?: (row: T, index: number) => React.ReactNode;
  /** Class for the cards grid container (defaults to the 2-up mobile grid). */
  cardsGridClassName?: string;
  /** Class for the list container. */
  listClassName?: string;

  /* ---- Shared interaction ---- */
  /** Fired when the record body is activated (card/row click, table row click). */
  onRowClick?: (row: T) => void;

  /* ---- Shared states ---- */
  /** First load: renders skeletons/placeholder, never the empty state. */
  loading?: boolean;
  /** Background refetch: keeps rows visible and dims them. */
  refreshing?: boolean;
  error?: unknown;
  onRetry?: () => void;
  /** Shown when `rows` is empty and `loading` is false. */
  empty?: RecordsViewEmpty;

  /* ---- Shared pagination ---- */
  /** Table mode only: `DataTable` owns its own infinite-scroll binding. */
  infinite?: boolean;
  hasMore?: boolean;
  onLoadMore?: () => void;
  loadingMore?: boolean;
  pageSize?: number;
  /** Server-side total. Rendered as "N of M" so it is never read as a match count. */
  totalCount?: number;
  /** Infinite binding for cards/list, which `DataTable` does not manage. */
  cardsInfinite?: boolean;

  minWidth?: number;
  horizontalScroll?: boolean;
  className?: string;
  /** Extra `rowProps` for the table (`onMouseEnter` for keyboard shortcuts…). */
  tableRowProps?: React.ComponentProps<typeof DataTable<T>>["rowProps"];
}

const DEFAULT_CARDS_GRID = "grid grid-cols-2 gap-2.5 sm:gap-4 md:grid-cols-3 lg:grid-cols-4";

export function RecordsView<T>({
  rows,
  getRowId,
  viewMode,
  columns,
  sort = null,
  onSortChange,
  renderCard,
  renderListRow,
  cardsGridClassName = DEFAULT_CARDS_GRID,
  listClassName = "space-y-2.5",
  onRowClick,
  loading = false,
  refreshing = false,
  error = null,
  onRetry,
  empty,
  infinite = false,
  hasMore = false,
  onLoadMore,
  loadingMore = false,
  pageSize,
  totalCount,
  cardsInfinite = false,
  minWidth,
  horizontalScroll,
  className,
  tableRowProps,
}: RecordsViewProps<T>) {
  const isEmpty = !loading && !error && rows.length === 0;

  if (error) {
    return <QueryErrorState error={error} onRetry={onRetry} className={className} />;
  }

  if (isEmpty) {
    return (
      <EmptyState
        variant="page"
        icon={empty?.icon ?? <Inbox />}
        title={empty?.title ?? "—"}
        description={empty?.description}
        action={empty?.action}
        hint={empty?.hint}
        className={className}
      />
    );
  }

  if (viewMode === "cards" || viewMode === "list") {
    return (
      <div className={cn("min-w-0", className)}>
        {loading ? (
          <CardSkeletonGrid />
        ) : (
          <>
            <div className={refreshing ? "opacity-70 transition-opacity" : undefined}>
              {viewMode === "cards" ? (
                <div className={cardsGridClassName}>
                  {rows.map((row, index) => (
                    <RecordActivation
                      key={getRowId(row)}
                      onActivate={onRowClick ? () => onRowClick(row) : undefined}
                    >
                      {renderCard ? renderCard(row, index) : null}
                    </RecordActivation>
                  ))}
                </div>
              ) : (
                <div className={listClassName}>
                  {rows.map((row, index) => (
                    <RecordActivation
                      key={getRowId(row)}
                      onActivate={onRowClick ? () => onRowClick(row) : undefined}
                    >
                      {renderListRow ? renderListRow(row, index) : null}
                    </RecordActivation>
                  ))}
                </div>
              )}
            </div>

            {cardsInfinite ? (
              <LoadMoreFooter
                hasMore={hasMore}
                loadingMore={loadingMore}
                loadedCount={rows.length}
                onLoadMore={onLoadMore}
              />
            ) : null}
          </>
        )}
      </div>
    );
  }

  /* ---- table ---- */
  return (
    <div
      className={cn(
        "panel-elevated -mx-1 overflow-hidden rounded-2xl border border-border/70 sm:mx-0",
        className,
      )}
    >
      <DataTable
        className="px-0"
        columns={columns ?? []}
        rows={rows}
        rowKey={getRowId}
        loading={loading}
        initialLoading={loading}
        refreshing={refreshing}
        error={null}
        onRetry={onRetry}
        sort={sort}
        onSortChange={onSortChange}
        infinite={infinite}
        hasMore={hasMore}
        onLoadMore={onLoadMore}
        loadingMore={loadingMore}
        pageSize={pageSize}
        totalCount={totalCount}
        onRowClick={onRowClick}
        rowProps={tableRowProps}
        minWidth={minWidth}
        horizontalScroll={horizontalScroll}
        stickyHeader
        empty={{
          icon: empty?.icon,
          title: empty?.title ?? "—",
          description: empty?.description,
          action: empty?.action,
        }}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Activation wrapper — makes a card/row behave like a button          */
/* ------------------------------------------------------------------ */

/**
 * Keyboard-accessible activation for a card or list row.
 *
 * Cards used to be plain `<div onClick>`: reachable with a mouse, invisible to
 * the keyboard and to a screen reader. The wrapper keeps the visual markup of
 * the record untouched (the renderer owns it) and only adds the interaction
 * contract — a button role, `Enter`/`Space` handling, a visible focus ring.
 *
 * Action buttons inside the card keep working because they stop propagation and
 * are real `<button>` elements: the browser gives them the click first.
 */
function RecordActivation({
  onActivate,
  children,
}: {
  onActivate?: () => void;
  children: React.ReactNode;
}) {
  if (!onActivate) return <>{children}</>;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onActivate}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        // Never hijack Enter/Space that belongs to a nested control.
        if (event.target !== event.currentTarget) return;
        event.preventDefault();
        onActivate();
      }}
      className="cursor-pointer rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
    >
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Load-more footer for cards/list                                    */
/* ------------------------------------------------------------------ */

function LoadMoreFooter({
  hasMore,
  loadingMore,
  loadedCount,
  onLoadMore,
}: {
  hasMore: boolean;
  loadingMore: boolean;
  loadedCount: number;
  onLoadMore?: () => void;
}) {
  if (!onLoadMore || (!hasMore && loadedCount === 0)) return null;

  return (
    <div className="flex items-center justify-center gap-2 py-4">
      {loadingMore ? (
        <>
          <Loader2 className="size-4 animate-spin text-muted-foreground" aria-hidden />
          <span className="text-[11px] text-muted-foreground">جارٍ تحميل المزيد…</span>
        </>
      ) : hasMore ? (
        <button
          type="button"
          onClick={onLoadMore}
          className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-4 py-1.5 text-xs font-medium transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <ChevronDown className="size-3.5" aria-hidden />
          تحميل المزيد
        </button>
      ) : (
        <span className="text-[11px] text-muted-foreground/70">
          تم عرض جميع السجلات ({loadedCount})
        </span>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Loading placeholder                                                */
/* ------------------------------------------------------------------ */

function CardSkeletonGrid() {
  return (
    <div role="status" aria-live="polite" className={DEFAULT_CARDS_GRID}>
      {Array.from({ length: 8 }).map((_, index) => (
        <div key={index} className="card-mullak h-40 rounded-2xl bg-surface-2/40 shimmer" />
      ))}
      <span className="sr-only">
        <Spinner /> Loading
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Refresh affordance shared by the three modes                       */
/* ------------------------------------------------------------------ */

/** Compact "refreshing" hint a screen can place beside its own header. */
export function RecordsRefreshing({ label = "جارٍ التحديث…" }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
      <RefreshCw className="size-3 animate-spin" aria-hidden />
      {label}
    </span>
  );
}

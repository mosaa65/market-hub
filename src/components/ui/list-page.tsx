import * as React from "react";

import { cn } from "@/lib/utils";
import {
  DataTable,
  type DataTableColumn,
  type DataTableProps,
  type DataTableSort,
} from "@/components/ui/data-table";
import {
  TableToolbar,
  applyFilters,
  applySearch,
  type FilterValues,
  type TableToolbarProps,
} from "@/components/ui/table-toolbar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge, type StatusBadgeProps } from "@/components/ui/status-badge";

/**
 * ListPage — the scaffold for every list/CRUD page in Market Hub.
 *
 * It composes the whole list surface (toolbar + table + states + pagination) into
 * one component so a page only supplies *data and copy*, never layout.
 * This is what makes requirement #5 (central change) real: adjusting the toolbar
 * layout, table density or empty-state treatment here changes every list page.
 *
 * Usage:
 * ```tsx
 * <ListPage
 *   columns={columns}
 *   rows={filtered}
 *   rowKey={(r) => r.id}
 *   loading={isLoading}
 *   error={error}
 *   onRetry={refetch}
 *   mobileMode="scroll"
 *   search={{ value: query, onValueChange: setQuery, placeholder: t("customers.search") }}
 *   filters={{ definitions, values, onValueChange: setFilters }}
 *   action={<Button icon={<Plus />} onClick={openNew}>{t("common.new")}</Button>}
 *   empty={{ icon: <Users />, title: t("customers.empty") }}
 *   summary={<SummaryStrip items={[...]} />}
 * />
 * ```
 */
export interface ListPageProps<T> {
  columns: DataTableColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;

  loading?: boolean;
  error?: Error | null;
  onRetry?: () => void;

  sort?: DataTableSort | null;
  onSortChange?: (sort: DataTableSort | null) => void;

  /** Mobile strategy. Defaults to `scroll` — Market Hub always renders a table. */

  search?: TableToolbarProps["search"];
  filters?: TableToolbarProps["filters"];
  toolbarSort?: TableToolbarProps["sort"];
  /** Primary page action (usually "New …"). */
  action?: React.ReactNode;
  /** Extra toolbar controls (export, density…). */
  toolbarEnd?: React.ReactNode;

  empty?: DataTableProps<T>["empty"];

  /** Optional KPI / summary strip rendered above the table. */
  summary?: React.ReactNode;

  /** Row click → detail view. */
  onRowClick?: (row: T) => void;

  /** Infinite-scroll binding (50 rows at a time). */
  infinite?: boolean;
  hasMore?: boolean;
  onLoadMore?: () => void;
  loadingMore?: boolean;
  pageSize?: number;
  totalCount?: number;
  /** Legacy client-side paging for accounting tables. */
  paginate?: boolean;
  initialPageSize?: number;
  minWidth?: number;
  className?: string;
}

export function ListPage<T>({
  columns,
  rows,
  rowKey,
  loading = false,
  error = null,
  onRetry,
  sort = null,
  onSortChange,
  search,
  filters,
  toolbarSort,
  action,
  toolbarEnd,
  empty,
  summary,
  onRowClick,
  infinite = false,
  hasMore = false,
  onLoadMore,
  loadingMore = false,
  pageSize = 50,
  totalCount,
  paginate = false,
  initialPageSize = 25,
  minWidth,
  className,
}: ListPageProps<T>) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-4", className)}>
      {summary}

      <div className="panel-elevated overflow-hidden">
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={rowKey}
          loading={loading}
          error={error}
          onRetry={onRetry}
          sort={sort}
          onSortChange={onSortChange}
          empty={empty}
          onRowClick={onRowClick}
          infinite={infinite}
          hasMore={hasMore}
          onLoadMore={onLoadMore}
          loadingMore={loadingMore}
          pageSize={pageSize}
          totalCount={totalCount}
          paginate={paginate}
          initialPageSize={initialPageSize}
          minWidth={minWidth}
          toolbar={
            <TableToolbar
              search={search}
              filters={filters}
              sort={toolbarSort}
              action={action}
              end={toolbarEnd}
            />
          }
        />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  SummaryStrip — the KPI row above list pages                       */
/* ------------------------------------------------------------------ */

export interface SummaryItem {
  label: string;
  value: React.ReactNode;
  tone?: StatusBadgeProps["tone"];
  icon?: React.ReactNode;
}

export interface SummaryStripProps {
  items: SummaryItem[];
  className?: string;
  /** Optional trailing content (counts, hints). */
  end?: React.ReactNode;
}

/**
 * SummaryStrip — the balance/KPI bar used on customers, suppliers, inventory and
 * dashboard-style pages. Replaces the bespoke strips currently duplicated there.
 */
export function SummaryStrip({ items, className, end }: SummaryStripProps) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-between gap-3 rounded-[14px] border-border/60 bg-surface/60 px-3.5 py-2.5 backdrop-blur-sm",
        className,
      )}
    >
      <dl className="flex flex-wrap items-center gap-x-5 gap-y-2">
        {items.map((item, i) => (
          <React.Fragment key={item.label}>
            {i > 0 ? <span className="hidden h-4 w-px bg-border/60 sm:block" aria-hidden /> : null}
            <div className="flex items-center gap-2">
              {item.icon ? (
                <span className="[&_svg]:size-3.5 text-muted-foreground" aria-hidden>
                  {item.icon}
                </span>
              ) : (
                <StatusBadge
                  tone={item.tone ?? "neutral"}
                  dot
                  className="px-0 py-0 text-transparent"
                >
                  <span className="sr-only">{item.label}</span>
                </StatusBadge>
              )}
              <dt className="text-caption text-muted-foreground">{item.label}</dt>
              <dd className="text-xs font-semibold tabular-nums">{item.value}</dd>
            </div>
          </React.Fragment>
        ))}
      </dl>
      {end ? <div className="text-caption text-muted-foreground">{end}</div> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  PageSection — a titled panel used on dashboard/report pages        */
/* ------------------------------------------------------------------ */

export interface PageSectionProps {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
  /** Removes the inner padding (for tables and full-bleed content). */
  flush?: boolean;
  className?: string;
}

export function PageSection({
  title,
  description,
  actions,
  children,
  flush,
  className,
}: PageSectionProps) {
  return (
    <Card
      className={cn(
        "overflow-hidden rounded-[16px] border-border/80 bg-surface shadow-[var(--shadow-panel)]",
        className,
      )}
    >
      <CardHeader className="flex-row items-start justify-between gap-3 border-b border-border/60 p-4">
        <div className="min-w-0 space-y-0.5">
          <CardTitle className="text-section truncate">{title}</CardTitle>
          {description ? <p className="text-caption text-muted-foreground">{description}</p> : null}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </CardHeader>
      <CardContent className={cn("p-0", !flush && "p-4")}>{children}</CardContent>
    </Card>
  );
}

export { applyFilters, applySearch };
export type { FilterValues };

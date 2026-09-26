import * as React from "react";
import { ArrowDown, ArrowUp, ChevronDown, ChevronsUpDown, Inbox, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { EmptyState, Spinner } from "@/components/ui/feedback";
import { QueryErrorState, InlineRefreshing } from "@/components/ui/connection";

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */

export interface DataTableColumn<T> {
  /** Stable identifier; also used as the default sort accessor key. */
  key: string;
  /** Localized header label. */
  header: React.ReactNode;
  /** Cell renderer. */
  cell: (row: T, index: number) => React.ReactNode;
  align?: "start" | "end" | "center";
  /** Extra class applied to both header and body cells. */
  className?: string;
  /** Enables click-to-sort for this column. */
  sortable?: boolean;
  /** Value used for client-side sorting. Defaults to the raw field. */
  sortValue?: (row: T) => string | number | null | undefined;
  /** Hide the column entirely (e.g. permission-gated cost). */
  hidden?: boolean;
  /**
   * Hide this column below a viewport width, so a wide table fits a phone
   * without horizontal scrolling. CSS-only (a Tailwind responsive class), so it
   * costs no measurement and does not affect sticky positioning.
   *
   * - `sm`  → hidden under 640px
   * - `md`  → hidden under 768px
   * - `lg`  → hidden under 1024px
   */
  hideBelow?: "sm" | "md" | "lg";
  /** Tailwind width class, e.g. `w-32`. */
  width?: string;
  /** Allow wrapping (default: columns stay on one line). */
  wrap?: boolean;
  /** Pin this column while the table scrolls horizontally. */
  sticky?: boolean;
}

export interface DataTableSort {
  key: string;
  direction: "asc" | "desc";
}

export interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;

  loading?: boolean;
  /** True only for the very first load (renders skeletons). */
  initialLoading?: boolean;
  error?: Error | null;
  onRetry?: () => void;
  /** Background refetch: dims the body but keeps rows visible. */
  refreshing?: boolean;

  /** Controlled sort. */
  sort?: DataTableSort | null;
  onSortChange?: (sort: DataTableSort | null) => void;

  /** Rendered above the table (toolbar). */
  toolbar?: React.ReactNode;

  onRowClick?: (row: T) => void;

  empty?: {
    title: string;
    description?: string;
    icon?: React.ReactNode;
    action?: React.ReactNode;
  };

  /* ---- Infinite scroll ---- */
  /** Enables "load more as you scroll" behaviour. */
  infinite?: boolean;
  /** Whether more rows exist on the server. */
  hasMore?: boolean;
  /** Fired when the sentinel scrolls into view. */
  onLoadMore?: () => void;
  /** True while the next page is being fetched. */
  loadingMore?: boolean;
  /** Rows per page, used for the caption. 0 hides the caption. */
  pageSize?: number;
  /** Total row count when known (server-side count). */
  totalCount?: number;

  /* ---- Legacy client-side paging (accounting tables) ---- */
  paginate?: boolean;
  initialPageSize?: number;

  className?: string;
  scrollClassName?: string;
  stickyHeader?: boolean;
  /** Minimum table width before horizontal scrolling kicks in. */
  minWidth?: number;
  /**
   * Deliberate side-to-side scrolling for dense operational tables.  This is
   * opt-in: a scroll container and a vertically sticky table header cannot
   * share the same wrapper reliably, so callers should disable `stickyHeader`
   * for the compact layout when enabling it.
   */
  horizontalScroll?: boolean;
  /** Pin the first column while scrolling horizontally. */
  stickyFirstColumn?: boolean;

  /**
   * Offset from the top of the scrolling container at which the sticky toolbar
   * pins. Defaults to `0px`.
   *
   * This is deliberately **not** the app-header height: the app shell renders
   * the header as a flex sibling *above* `<main>`, and `<main>` is the element
   * that actually scrolls. A sticky element measures `top` from its nearest
   * scrolling ancestor, so `0` places the toolbar directly beneath the header.
   * Only override this for an embedded table with its own scroll parent.
   */
  stickyTop?: string;
}

const DEFAULT_PAGE_SIZE = 50;

/** Tailwind classes that hide a column below the given breakpoint. */
const HIDE_BELOW: Record<"sm" | "md" | "lg", string> = {
  sm: "hidden sm:table-cell",
  md: "hidden md:table-cell",
  lg: "hidden lg:table-cell",
};

/* ------------------------------------------------------------------ */
/*  Component                                                         */
/* ------------------------------------------------------------------ */

/**
 * DataTable — the single table implementation for Market Hub.
 *
 * Key decisions (per requirements):
 *  - **Always a real table, including on phones.** Records scroll horizontally
 *    rather than becoming stacked cards, so a dense ERP list stays scannable and
 *    column-aligned. `minWidth` keeps the numeric columns readable.
 *  - **Infinite scroll, no pagination arrows.** Rows arrive 50 at a time as the
 *    user reaches the bottom, with a subtle loading indicator. When everything is
 *    loaded the list simply ends.
 *  - **Full bleed.** No horizontal padding around the table, so rows fill the
 *    panel edge to edge.
 */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  loading = false,
  initialLoading,
  error = null,
  onRetry,
  refreshing = false,
  sort = null,
  onSortChange,
  toolbar,
  onRowClick,
  empty,
  infinite = false,
  hasMore = false,
  onLoadMore,
  loadingMore = false,
  pageSize = DEFAULT_PAGE_SIZE,
  totalCount,
  paginate = false,
  initialPageSize = 25,
  className,
  scrollClassName,
  stickyHeader = true,
  minWidth,
  horizontalScroll = false,
  stickyFirstColumn = false,
  stickyTop,
}: DataTableProps<T>) {
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const headerScrollRef = React.useRef<HTMLDivElement>(null);
  const sentinelRef = React.useRef<HTMLDivElement>(null);
  const toolbarRef = React.useRef<HTMLDivElement>(null);
  const panRef = React.useRef<{
    pointerId: number | null;
    startX: number;
    startY: number;
    startScrollLeft: number;
    panned: boolean;
  }>({ pointerId: null, startX: 0, startY: 0, startScrollLeft: 0, panned: false });
  const [page, setPage] = React.useState(1);

  /*
   * عجلة الفأرة فوق جدول قابل للتمرير الأفقي: المتصفح يستخدمها للتمرير الأفقي
   * فيتوقف التمرير الرأسي فوق السجلات. نُعيد توجيه التمرير الرأسي إلى أقرب سلف
   * قابل للتمرير عموديًا. الربط يحدث عبر callback ref — وليس useEffect عند
   * التحميل — لأن حاوية الجدول لا تُرسم أثناء حالة الهيكل (Skeleton) فيكون
   * الـ ref فارغًا وقت تشغيل أي تأثير مُهيّأ مرة واحدة.
   */
  const bodyWheelCleanupRef = React.useRef<(() => void) | null>(null);
  const headerWheelCleanupRef = React.useRef<(() => void) | null>(null);

  const wheelRedirectCleanup = (el: HTMLDivElement | null): (() => void) | null => {
    if (!el) return null;
    const onWheel = (event: WheelEvent) => {
      // لا تعترض إيماءات التكبير والتصغير (Ctrl + العجلة أو pinch-to-zoom في لوحة اللمس)
      if (event.ctrlKey || event.metaKey) return;
      if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
      event.preventDefault();
      // deltaMode 1 = خطوط، 2 = صفحات — نحوّلها إلى بكسل.
      const dy =
        event.deltaMode === 1
          ? event.deltaY * 16
          : event.deltaMode === 2
            ? event.deltaY * el.clientHeight
            : event.deltaY;
      let node: HTMLElement | null = el.parentElement;
      while (node) {
        if (node.scrollHeight > node.clientHeight + 1) {
          node.scrollTop += dy;
          // إذا بلغ هذا الحاويّ نهايته نُكمِل إلى سلفه (سلوك متسلسل طبيعي).
          if (
            (dy > 0 && node.scrollTop < node.scrollHeight - node.clientHeight - 1) ||
            (dy < 0 && node.scrollTop > 1)
          ) {
            return;
          }
        }
        node = node.parentElement;
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  };

  const setBodyScrollerRef = (el: HTMLDivElement | null) => {
    scrollRef.current = el;
    if (bodyWheelCleanupRef.current) {
      bodyWheelCleanupRef.current();
      bodyWheelCleanupRef.current = null;
    }
    bodyWheelCleanupRef.current = wheelRedirectCleanup(el);
  };

  const setHeaderScrollerRef = (el: HTMLDivElement | null) => {
    headerScrollRef.current = el;
    if (headerWheelCleanupRef.current) {
      headerWheelCleanupRef.current();
      headerWheelCleanupRef.current = null;
    }
    headerWheelCleanupRef.current = wheelRedirectCleanup(el);
  };

  /*
   * Sticky geometry: the toolbar height has to be known so the table header can
   * pin directly beneath it.
   *
   * The height is not constant — the filter-chips row appears and disappears, and
   * the toolbar wraps on narrow viewports — so it is written to the
   * `--ds-toolbar-h` custom property by a ResizeObserver rather than guessed. The
   * property is set directly on the DOM node (no React state), so the write can
   * never cause a render loop or lag a paint.
   *
   * This hook is declared here, with the other hooks, because it must run on
   * every render — the error branch below returns early.
   */
  const hasToolbar = Boolean(toolbar);
  React.useEffect(() => {
    const el = toolbarRef.current;
    if (!el) return;
    const host = el.parentElement;
    if (!host) return;

    const sync = () => host.style.setProperty("--ds-toolbar-h", `${el.offsetHeight}px`);
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    return () => ro.disconnect();
  }, [hasToolbar]);

  // Mobile shows the same table as desktop — every column, plain horizontal
  // scrolling, no pinned column and no hidden-column expander. Dense ERP lists
  // stay column-aligned and readable; panning is expected on a phone.
  const visibleColumns = React.useMemo(() => columns.filter((c) => !c.hidden), [columns]);

  const pinFirst = stickyFirstColumn;

  /* ---- sorting ---- */
  const sortedRows = React.useMemo(() => {
    if (!sort) return rows;
    const col = visibleColumns.find((c) => c.key === sort.key);
    if (!col) return rows;

    const valueOf = (row: T): string | number | null | undefined => {
      if (col.sortValue) return col.sortValue(row);
      const raw = (row as Record<string, unknown>)[col.key];
      if (raw == null) return null;
      if (typeof raw === "number" || typeof raw === "string") return raw;
      return String(raw);
    };

    const factor = sort.direction === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const av = valueOf(a);
      const bv = valueOf(b);
      // Nulls always sort last, whichever direction is active.
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * factor;
      return (
        String(av).localeCompare(String(bv), undefined, { numeric: true, sensitivity: "base" }) *
        factor
      );
    });
  }, [rows, sort, visibleColumns]);

  /* ---- legacy client-side paging (accounting tables only) ---- */
  const legacyPageRows = React.useMemo(() => {
    if (!paginate) return sortedRows;
    return sortedRows.slice(0, page * initialPageSize);
  }, [sortedRows, paginate, page, initialPageSize]);

  const displayRows = paginate ? legacyPageRows : sortedRows;

  const showSkeleton = initialLoading ?? loading;
  const showEmpty = !showSkeleton && displayRows.length === 0;

  /* ---- infinite scroll sentinel ---- */
  React.useEffect(() => {
    if (!infinite || !hasMore || !onLoadMore) return;
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const root = scrollRef.current;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && !loadingMore) onLoadMore();
      },
      // Begin loading slightly before the user actually reaches the bottom.
      {
        root: root && root.scrollHeight > root.clientHeight ? root : null,
        rootMargin: "480px 0px",
      },
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [infinite, hasMore, onLoadMore, loadingMore]);

  /* ---- error ---- */
  if (error) {
    return (
      <div className={cn("flex min-w-0 flex-col", className)}>
        {toolbar ? <div className="border-b border-border/60 px-3 py-2.5">{toolbar}</div> : null}
        <QueryErrorState error={error} onRetry={onRetry} />
      </div>
    );
  }

  const loadedCount = displayRows.length;

  /*
   * Sticky geometry.
   *
   * The toolbar and the table header both pin while the list scrolls. Their
   * containing block is `<main>` in the app shell, so `stickyTop` defaults to
   * `0px` — *not* the app-header height (the header is a flex sibling above
   * `<main>`, not the scroll container). The toolbar height measurement lives
   * with the other hooks at the top of the component.
   */
  const stickyOffset = stickyTop ?? "0px";
  const tableClassName = cn(
    "w-full border-collapse text-sm",
    minWidth || horizontalScroll ? "table-auto" : "table-fixed",
  );
  const tableStyle = minWidth ? { minWidth } : undefined;
  const detachedHeader = Boolean(horizontalScroll || minWidth) && stickyHeader;

  /*
   * توزيع الأعمدة متطابق بين جدول الرأس المفصول وجدول البيانات: نُصدر
   * <colgroup> واحدًا بنفس كلاسات العرض لكلا الجدولين. بدونه، يُحسب تخطيط
   * الجدول التلقائي (table-auto) من محتوى كل جدول على حدة — فتتباين أعمدة
   * الرأس عن أعمدة البيانات.
   */
  const colGroup = visibleColumns.length ? (
    <colgroup>
      {visibleColumns.map((c) => (
        <col
          key={c.key}
          className={cn(
            c.width,
            c.hideBelow === "sm" && "hidden sm:table-column",
            c.hideBelow === "md" && "hidden md:table-column",
            c.hideBelow === "lg" && "hidden lg:table-column",
          )}
        />
      ))}
    </colgroup>
  ) : null;

  /* مع min-width يبقى التخطيط تلقائيًا ليتسع المحتوى؛ مع ثبات الأعمدة
   * (كل الأعمدة عرضها محدد ببكسل) نستخدم table-fixed ليكون الجدولان متطابقين
   * تمامًا وعمودًا بعمود. */
  const allColsWidths =
    visibleColumns.length > 0 &&
    visibleColumns.every((c) => /w-\[[\d.]+px\]/.test(c.width ?? ""));
  const alignedTableClassName =
    minWidth && allColsWidths ? cn(tableClassName, "table-fixed") : tableClassName;

  const syncHorizontalScroll = (source: "header" | "body") => (event: React.UIEvent<HTMLDivElement>) => {
    const target = source === "header" ? scrollRef.current : headerScrollRef.current;
    if (target && target.scrollLeft !== event.currentTarget.scrollLeft) {
      target.scrollLeft = event.currentTarget.scrollLeft;
    }
  };

  // Native horizontal scrolling can be handed to the page's vertical scroller
  // on mobile browsers. Own only the horizontal gesture while `touch-pan-y`
  // preserves normal up/down scrolling outside and inside the table.
  const beginHorizontalPan = (event: React.PointerEvent<HTMLDivElement>) => {
    // اللمس على الجوال يدار أصلياً عبر المتصفح (native touch scroll & pinch zoom) دون اعتراض
    if (event.pointerType === "touch") return;
    if (!horizontalScroll) return;
    panRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startScrollLeft: event.currentTarget.scrollLeft,
      panned: false,
    };
    /* لا نلتقط المؤشر هنا: الالتقاط المبكر يمنع تمرير الصفحة العمودي الطبيعي
     * داخل الجدول. يُلتقط فقط عند ظهور نية أفقية واضحة في moveHorizontalPan. */
  };

  const moveHorizontalPan = (event: React.PointerEvent<HTMLDivElement>) => {
    const pan = panRef.current;
    if (!horizontalScroll || pan.pointerId !== event.pointerId) return;
    const dx = event.clientX - pan.startX;
    const dy = event.clientY - pan.startY;
    if (Math.abs(dx) <= Math.abs(dy)) return;

    // التقط المؤشر فقط عند تأكد النية الأفقية، حتى يبقى التمرير العمودي حُرًّا.
    if (!pan.panned) event.currentTarget.setPointerCapture?.(event.pointerId);
    pan.panned = true;
    // تحريك المحتوى مع حركة المؤشر بالسحب (سحب لليمين يكشف المحتوى لليسار)
    event.currentTarget.scrollLeft = pan.startScrollLeft - dx;
  };

  const endHorizontalPan = (event: React.PointerEvent<HTMLDivElement>) => {
    if (panRef.current.pointerId === event.pointerId) panRef.current.pointerId = null;
  };

  const suppressPanClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!panRef.current.panned) return;
    event.preventDefault();
    event.stopPropagation();
    panRef.current.panned = false;
  };

  return (
    <div
      className={cn("flex min-w-0 flex-col", className)}
      style={{ "--ds-sticky-top": stickyOffset } as React.CSSProperties}
    >
      {toolbar ? (
        <div
          ref={toolbarRef}
          className="sticky z-30 rounded-t-[var(--radius-panel)] rounded-b-none border-b border-border/60 bg-surface/90 backdrop-blur-xl"
          style={{ top: stickyOffset }}
        >
          <div className="px-3 py-2.5 sm:px-3.5">{toolbar}</div>
        </div>
      ) : null}

      {showSkeleton ? (
        <TableSkeleton columns={Math.min(visibleColumns.length, 7)} />
      ) : showEmpty ? (
        <EmptyState
          icon={empty?.icon ?? <Inbox />}
          title={empty?.title ?? "No records"}
          description={empty?.description}
          action={empty?.action}
        />
      ) : (
        <>
          {/* A horizontally scrollable element cannot also anchor a sticky table
           * header to the page. Keep an identical, scroll-synchronised header
           * outside the panning body: labels stay visible while the page scrolls
           * and the body retains natural two-axis touch gestures. */}
          {detachedHeader ? (
            <div
              className="sticky z-20 overflow-hidden rounded-b-[var(--radius-panel)] rounded-t-none border border-border bg-surface-2/85 shadow-[0_5px_14px_oklch(0_0_0/0.06)] backdrop-blur-xl"
              style={{ top: "calc(var(--ds-sticky-top,0px) + var(--ds-toolbar-h,0px))" }}
            >
              <div
                ref={setHeaderScrollerRef}
                onScroll={syncHorizontalScroll("header")}
                onPointerDown={beginHorizontalPan}
                onPointerMove={moveHorizontalPan}
                onPointerUp={endHorizontalPan}
                onPointerCancel={endHorizontalPan}
                onClickCapture={suppressPanClick}
                className="w-full overflow-x-auto overscroll-y-auto touch-manipulation [-webkit-overflow-scrolling:touch] scrollbar-x-none custom-scrollbar"
              >
                <table className={alignedTableClassName} style={tableStyle}>
                  {colGroup}
                  <TableHead
                    columns={visibleColumns}
                    sort={sort}
                    onSortChange={onSortChange}
                    pinFirst={pinFirst}
                  />
                </table>
              </div>
            </div>
          ) : null}
          <div
            ref={setBodyScrollerRef}
            onScroll={detachedHeader ? syncHorizontalScroll("body") : undefined}
            onPointerDown={beginHorizontalPan}
            onPointerMove={moveHorizontalPan}
            onPointerUp={endHorizontalPan}
            onPointerCancel={endHorizontalPan}
            onClickCapture={suppressPanClick}
            className={cn(
            /* The detached header above is synchronised with this body scroller,
             * so horizontal panning remains direct and its labels stay pinned to
             * the app's real vertical scrolling surface. */
            horizontalScroll || minWidth
              ? "w-full overflow-x-auto overscroll-y-auto touch-manipulation [-webkit-overflow-scrolling:touch] scrollbar-x-none custom-scrollbar"
              : "w-full overscroll-x-contain",
            refreshing && "opacity-70 transition-opacity",
            scrollClassName,
          )}
          >
          <table
            /* `table-layout: auto` with `w-full` lets the browser grow the table
             * past its container when a cell's content needs more room — on a
             * 390px phone the four remaining columns summed to 384px inside a
             * 344px container, pushing the table 17px off-screen and clipping
             * the row-action buttons (measured: `childWiderThanParent: true`).
             *
             * `table-fixed` makes the declared width authoritative so cells wrap
             * instead of expanding the table. It is applied from `sm` up only
             * when a `minWidth` is requested (wide accounting tables that are
             * *meant* to scroll); otherwise it applies at every width. */
            className={alignedTableClassName}
            style={tableStyle}
          >
            {colGroup}
            <TableHead
              columns={visibleColumns}
              sort={sort}
              onSortChange={onSortChange}
              pinFirst={pinFirst}
              sticky={stickyHeader && !detachedHeader}
              visuallyHidden={detachedHeader}
            />

            <tbody>
              {displayRows.map((row, index) => (
                <tr
                  key={rowKey(row)}
                  className={cn(
                    "border-b border-border/60 transition-colors duration-150 hover:bg-accent/40",
                    onRowClick && "cursor-pointer",
                  )}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                >
                  {visibleColumns.map((col) => {
                    const stickyCol = col.sticky ?? (pinFirst && col === visibleColumns[0]);
                    return (
                      <td
                        key={col.key}
                        className={cn(
                          "px-3 py-2.5 align-middle first:ps-4 last:pe-4",
                          /* On a phone, forced single-line cells are what push a
                           * wide table past the viewport. Let text wrap under
                           * `sm` and keep the single-line ERP look from `sm`
                           * up, where there is room for it. */
                          !col.wrap && "whitespace-normal sm:whitespace-nowrap",
                          col.align === "end"
                            ? "text-end"
                            : col.align === "center"
                              ? "text-center"
                              : "text-start",
                          col.className,
                          col.hideBelow && HIDE_BELOW[col.hideBelow],
                          stickyCol && "sticky start-0 z-10 bg-surface",
                        )}
                      >
                        {col.cell(row, index)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>

          {/* ---------- Infinite-scroll footer ---------- */}
          {infinite ? (
            <div ref={sentinelRef} className="flex items-center justify-center gap-2 py-4">
              {loadingMore ? (
                <>
                  <Loader2 className="size-4 animate-spin text-muted-foreground" aria-hidden />
                  <span className="text-[11px] text-muted-foreground">جارٍ تحميل المزيد…</span>
                </>
              ) : hasMore ? (
                <ChevronDown
                  className="size-4 animate-bounce text-muted-foreground/50"
                  aria-hidden
                />
              ) : loadedCount > 0 ? (
                <span className="text-[11px] text-muted-foreground/70">
                  تم عرض جميع السجلات ({loadedCount})
                </span>
              ) : null}
            </div>
          ) : null}

          {/* ---------- "Load more" for legacy paged tables ---------- */}
          {paginate && legacyPageRows.length < sortedRows.length ? (
            <div className="flex justify-center py-3">
              <button
                type="button"
                onClick={() => setPage((p) => p + 1)}
                className="rounded-full border border-border bg-surface px-4 py-1.5 text-xs font-medium transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                تحميل المزيد
              </button>
            </div>
          ) : null}
          </div>
        </>
      )}

      {/* ---------- Caption ---------- */}
      {!showSkeleton && !showEmpty && (pageSize > 0 || totalCount != null) ? (
        <div className="flex items-center justify-between gap-3 border-t border-border/60 px-4 py-1.5">
          <p className="text-[11px] tabular-nums text-muted-foreground">
            {totalCount != null ? `عرض ${loadedCount} من ${totalCount}` : `عرض ${loadedCount} سجل`}
          </p>
          {refreshing ? <InlineRefreshing /> : null}
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Skeleton                                                          */
/* ------------------------------------------------------------------ */

function TableHead<T>({
  columns,
  sort,
  onSortChange,
  pinFirst,
  sticky = false,
  visuallyHidden = false,
}: {
  columns: DataTableColumn<T>[];
  sort: DataTableSort | null;
  onSortChange?: (sort: DataTableSort | null) => void;
  pinFirst: boolean;
  sticky?: boolean;
  visuallyHidden?: boolean;
}) {
  const toggleSort = (column: DataTableColumn<T>) => {
    if (!column.sortable || !onSortChange) return;
    if (sort?.key !== column.key) return onSortChange({ key: column.key, direction: "asc" });
    if (sort.direction === "asc") return onSortChange({ key: column.key, direction: "desc" });
    onSortChange(null);
  };

  return (
    <thead
      className={cn(
        visuallyHidden && "sr-only",
        sticky &&
          "sticky z-20 bg-surface-2/70 backdrop-blur-md [top:calc(var(--ds-sticky-top,0px)+var(--ds-toolbar-h,0px))]",
        !sticky && !visuallyHidden && "bg-surface-2/50",
      )}
    >
      <tr className="border-b border-border">
        {columns.map((column, index) => {
          const active = sort?.key === column.key;
          const stickyColumn = column.sticky ?? (pinFirst && index === 0);
          return (
            <th
              key={column.key}
              scope="col"
              aria-sort={
                active
                  ? sort?.direction === "asc"
                    ? "ascending"
                    : "descending"
                  : column.sortable
                    ? "none"
                    : undefined
              }
              className={cn(
                "h-10 px-3 align-middle text-[11px] font-semibold uppercase tracking-wider text-muted-foreground first:rounded-s-xl first:ps-4 last:rounded-e-xl last:pe-4",
                "whitespace-normal sm:whitespace-nowrap",
                column.align === "end"
                  ? "text-end"
                  : column.align === "center"
                    ? "text-center"
                    : "text-start",
                column.width,
                column.className,
                column.hideBelow && HIDE_BELOW[column.hideBelow],
                stickyColumn && "sticky start-0 z-30 bg-surface-2",
              )}
            >
              {column.sortable && onSortChange ? (
                <button
                  type="button"
                  onClick={() => toggleSort(column)}
                  aria-label={typeof column.header === "string" ? `Sort by ${column.header}` : "Sort"}
                  className={cn(
                    "inline-flex items-center gap-1 rounded-sm transition-colors hover:text-foreground",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                    column.align === "end" && "flex-row-reverse",
                    active && "text-primary",
                  )}
                >
                  <span>{column.header}</span>
                  {active ? (
                    sort?.direction === "asc" ? (
                      <ArrowUp className="size-3" aria-hidden />
                    ) : (
                      <ArrowDown className="size-3" aria-hidden />
                    )
                  ) : (
                    <ChevronsUpDown className="size-3 opacity-40" aria-hidden />
                  )}
                </button>
              ) : (
                column.header
              )}
            </th>
          );
        })}
      </tr>
    </thead>
  );
}

function TableSkeleton({ columns }: { columns: number }) {
  return (
    <div role="status" aria-live="polite" className="flex flex-col">
      <div className="flex items-center gap-4 border-b border-border px-3 py-2.5">
        {Array.from({ length: columns }).map((_, i) => (
          <div key={i} className="shimmer h-3 flex-1 rounded" />
        ))}
      </div>
      {Array.from({ length: 8 }).map((_, r) => (
        <div key={r} className="flex items-center gap-4 border-b border-border/60 px-3 py-3">
          {Array.from({ length: columns }).map((_, c) => (
            <div key={c} className="shimmer h-4 flex-1 rounded" />
          ))}
        </div>
      ))}
      <span className="sr-only">
        <Spinner /> Loading
      </span>
    </div>
  );
}

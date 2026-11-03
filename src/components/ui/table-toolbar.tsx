import * as React from "react";
import { ArrowDownUp, Filter as FilterIcon, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { SearchInput } from "@/components/ui/search-input";
import { RecordsFilterPanel, RecordsSortPanel } from "@/components/ui/records-panels";

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */

export interface FilterOption {
  value: string;
  label: string;
}

export interface FilterDefinition {
  key: string;
  label: string;
  type: "select" | "date-range" | "text" | "boolean";
  options?: FilterOption[];
  placeholder?: string;
}

export type FilterValues = Record<string, string | { from?: string; to?: string } | undefined>;

export interface SortOption {
  value: string;
  label: string;
}

/**
 * Locale-aware copy for the toolbar's own controls.
 *
 * The toolbar renders generic chrome (filter, sort, apply, clear…). Those words
 * are not domain data, so a screen must not have to pass them — but they must
 * also not be hard-coded Arabic, or an English screen shows a mixed-language
 * panel. Screens with their own `t()` can override any string; everything else
 * follows `dir`.
 */
export interface TableToolbarLabels {
  filter?: string;
  sort?: string;
  /** Title of the filter panel. */
  filterTitle?: string;
  filterHint?: string;
  /** `{count}` is replaced with the number of applied filters. */
  filterApplied?: string;
  sortTitle?: string;
  sortHint?: string;
  apply?: string;
  clear?: string;
  clearAll?: string;
  /** `{label}` is replaced with the filter's label. */
  removeFilter?: string;
  all?: string;
  yes?: string;
  no?: string;
  sortOptionsLabel?: string;
  removeOptionLabel?: string;
  /** Accessible name for the clear-search button. */
  clearSearch?: string;
}

export const AR_TOOLBAR_LABELS: Required<TableToolbarLabels> = {
  filter: "فلترة",
  sort: "ترتيب",
  filterTitle: "تصفية النتائج",
  filterHint: "اختر المعايير لعرض سجلات محددة",
  filterApplied: "{count} تصفية مُطبّقة",
  sortTitle: "ترتيب النتائج",
  sortHint: "اختر الحقل الذي تريد الترتيب حسبه",
  apply: "تطبيق",
  clear: "مسح",
  clearAll: "مسح الكل",
  removeFilter: "إزالة {label}",
  all: "الكل",
  yes: "نعم",
  no: "لا",
  sortOptionsLabel: "خيارات الترتيب",
  removeOptionLabel: "تصفية ذكية",
  clearSearch: "مسح البحث",
};

export const EN_TOOLBAR_LABELS: Required<TableToolbarLabels> = {
  filter: "Filter",
  sort: "Sort",
  filterTitle: "Filter results",
  filterHint: "Choose criteria to narrow the records",
  filterApplied: "{count} filters applied",
  sortTitle: "Sort results",
  sortHint: "Choose the field to order by",
  apply: "Apply",
  clear: "Clear",
  clearAll: "Clear all",
  removeFilter: "Remove {label}",
  all: "All",
  yes: "Yes",
  no: "No",
  sortOptionsLabel: "Sort options",
  removeOptionLabel: "Smart filter",
  clearSearch: "Clear search",
};

/**
 * Resolves the toolbar's copy. `lang` is optional so a caller that already has
 * i18n can pass it; defaults to Arabic, which is the app's default direction.
 */
export function resolveToolbarLabels(
  lang?: string,
  overrides?: TableToolbarLabels,
): Required<TableToolbarLabels> {
  const base = lang === "en" ? EN_TOOLBAR_LABELS : AR_TOOLBAR_LABELS;
  return overrides ? { ...base, ...stripUndefined(overrides) } : base;
}

function stripUndefined(labels: TableToolbarLabels): TableToolbarLabels {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(labels)) {
    if (value !== undefined) result[key] = value;
  }
  return result as TableToolbarLabels;
}

function format(template: string, values: Record<string, string | number>): string {
  return Object.entries(values).reduce(
    (text, [key, value]) => text.replaceAll(`{${key}}`, String(value)),
    template,
  );
}

export interface TableToolbarProps {
  /** Search bindings. Omit to hide the search field. */
  search?: {
    value: string;
    onValueChange: (value: string) => void;
    placeholder?: string;
    dir?: "rtl" | "ltr";
    resultCount?: number;
    resultCountText?: string;
    debounceMs?: number;
    loading?: boolean;
    inputRef?: React.Ref<HTMLInputElement>;
    onKeyDown?: React.KeyboardEventHandler<HTMLInputElement>;
    autoFocus?: boolean;
  };
  /** Filter definitions + current values. */
  filters?: {
    definitions: FilterDefinition[];
    values: FilterValues;
    onValueChange: (values: FilterValues) => void;
  };
  /** Sort options + current selection (`""` = default order). */
  sort?: {
    options: SortOption[];
    value: string;
    onValueChange: (value: string) => void;
    label?: string;
  };
  /** Primary action, e.g. "منتج جديد". */
  action?: React.ReactNode;
  /** Extra controls next to the primary action. */
  end?: React.ReactNode;
  /** View toggle or custom slot beside search/filter/sort on all screens */
  viewToggle?: React.ReactNode;
  /** Sticks the toolbar to the top of the list while scrolling. */
  sticky?: boolean;
  className?: string;
  /** Children rendered inside the toolbar container (e.g. quick filter chips) */
  children?: React.ReactNode;
  /** Current UI language (`"ar"` default). Drives the generic control copy. */
  lang?: string;
  /** Per-string overrides for the generic control copy. */
  labels?: TableToolbarLabels;
  /**
   * What the number beside the search box means.
   *
   * - `"matching"` (default) — rows matching the current search/filters.
   * - `"total"` — the server-side total, shown as `shown/total`.
   *
   * Picking the wrong one is how a screen ends up claiming "1200" while the
   * search returned four rows. Screens that filter on the server should pass
   * `"matching"` with the server's matched count.
   */
  countMode?: "matching" | "total";
  /** Rows currently loaded into the view, used with `countMode="total"`. */
  loadedCount?: number;
}

/**
 * TableToolbar — one toolbar for every list page.
 *
 * Layout (per requirements):
 *  - Desktop/tablet: `[search ──────] [Filter] [Sort] [Add]` with labels.
 *  - Mobile: `[search ──] [⚙] [⇅] [+]` — compact, clearly separated controls
 *    remain on one reliable row beside the search field.
 *  - Filter and sort open their own panel: bottom sheet on mobile, a compact
 *    **start-anchored popover-style panel** on desktop (they need little space and
 *    should not cover the list).
 *  - Can stick to the top while the list scrolls.
 */
export function TableToolbar({
  search,
  filters,
  sort,
  action,
  end,
  viewToggle,
  sticky = false,
  className,
  children,
  lang,
  labels,
  countMode = "matching",
  loadedCount,
}: TableToolbarProps) {
  const [filterOpen, setFilterOpen] = React.useState(false);
  const [sortOpen, setSortOpen] = React.useState(false);

  const copy = React.useMemo(() => resolveToolbarLabels(lang, labels), [lang, labels]);

  const activeFilterCount = React.useMemo(() => {
    if (!filters) return 0;
    return Object.values(filters.values).filter((v) => {
      if (v == null) return false;
      if (typeof v === "string") return v !== "";
      return Boolean(v.from || v.to);
    }).length;
  }, [filters]);

  const hasFilters = Boolean(filters && filters.definitions.length > 0);
  const hasSort = Boolean(sort && sort.options.length > 0);

  /*
   * Number shown beside the search box.
   *
   * `matching` → the value the screen passed (rows matching its criteria).
   * `total`    → the server-side total, rendered `loaded/total` so a partially
   *              loaded catalogue can never be read as the match count.
   */
  const resultCountText =
    search?.resultCountText !== undefined
      ? search.resultCountText
      : search?.resultCount == null
        ? undefined
        : countMode === "total" && loadedCount != null
          ? `${loadedCount}/${search.resultCount}`
          : String(search.resultCount);

  return (
    <div
      className={cn(
        "flex flex-col gap-2",
        sticky && "sticky top-0 z-20 bg-background/45 backdrop-blur-xl",
        className,
      )}
    >
      <div className="flex items-center gap-1.5 sm:gap-2">
        {search ? (
          <SearchInput
            ref={search.inputRef}
            value={search.value}
            onValueChange={search.onValueChange}
            placeholder={search.placeholder}
            dir={search.dir}
            resultCountText={resultCountText}
            clearLabel={copy.clearSearch}
            debounceMs={search.debounceMs}
            loading={search.loading}
            enableSlashShortcut
            onKeyDown={search.onKeyDown}
            autoFocus={search.autoFocus}
            containerClassName="flex-1 min-w-0"
          />
        ) : (
          <div className="flex-1" />
        )}

        {hasFilters ? (
          <ToolbarAction
            label={filters!.definitions.length > 1 ? copy.filter : filters!.definitions[0].label}
            icon={<FilterIcon />}
            badge={activeFilterCount}
            active={filterOpen || activeFilterCount > 0}
            onClick={() => setFilterOpen(true)}
            controls="filter-panel"
          />
        ) : null}

        {hasSort ? (
          <ToolbarAction
            label={sort!.label ?? copy.sort}
            icon={<ArrowDownUp />}
            active={sortOpen || sort!.value !== ""}
            onClick={() => setSortOpen(true)}
            controls="sort-panel"
          />
        ) : null}

        {viewToggle}

        {end ? <div className="hidden items-center gap-2 lg:flex">{end}</div> : null}

        {action}
      </div>

      {hasFilters && activeFilterCount > 0 ? (
        <ActiveFilters
          definitions={filters!.definitions}
          values={filters!.values}
          copy={copy}
          onRemove={(key) => {
            const next = { ...filters!.values };
            delete next[key];
            filters!.onValueChange(next);
          }}
          onClearAll={() => filters!.onValueChange({})}
        />
      ) : null}

      {hasFilters ? (
        <FilterPanel
          open={filterOpen}
          onClose={() => setFilterOpen(false)}
          definitions={filters!.definitions}
          values={filters!.values}
          copy={copy}
          onSubmit={(v) => {
            filters!.onValueChange(v);
            setFilterOpen(false);
          }}
        />
      ) : null}

      {hasSort && sort ? (
        <SortPanel
          open={sortOpen}
          onClose={() => setSortOpen(false)}
          options={sort.options}
          value={sort.value}
          copy={copy}
          onSubmit={(v) => {
            sort.onValueChange(v);
            setSortOpen(false);
          }}
        />
      ) : null}

      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Toolbar action button — icons on phones, labelled circular controls from `sm`. */
/* ------------------------------------------------------------------ */

interface ToolbarActionProps {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  badge?: number;
  active?: boolean;
  controls?: string;
  /** `primary` receives a brighter translucent treatment for the main action. */
  tone?: "ghost" | "primary";
}

export function ToolbarAction({
  label,
  icon,
  onClick,
  badge = 0,
  active = false,
  controls,
  tone = "ghost",
}: ToolbarActionProps) {
  return (
    <button
      type="button"
      id={controls}
      onClick={onClick}
      aria-label={label}
      title={label}
      aria-haspopup={tone === "ghost" ? "dialog" : undefined}
      aria-expanded={tone === "ghost" ? active : undefined}
      className={cn(
        "relative inline-flex size-10 shrink-0 items-center justify-center gap-1.5 rounded-full border text-sm font-medium shadow-[var(--shadow-control)] backdrop-blur-xl transition-[background-color,border-color,color,box-shadow,transform] duration-200 sm:h-11 sm:w-auto sm:px-4",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 active:scale-95",
        tone === "primary"
          ? "border-primary/45 bg-primary/18 text-primary shadow-primary/15 hover:border-primary/60 hover:bg-primary/26"
          : active
            ? "border-primary/45 bg-primary/12 text-primary"
            : "border-border/70 bg-surface/55 text-muted-foreground hover:border-primary/30 hover:bg-surface/85 hover:text-foreground",
      )}
    >
      <span className="[&_svg]:size-4">{icon}</span>
      <span className="hidden sm:inline">{label}</span>
      {badge > 0 ? (
        <span className="absolute -end-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground ring-2 ring-surface sm:static sm:ring-0">
          {badge}
        </span>
      ) : null}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/*  Active filter chips                                               */
/* ------------------------------------------------------------------ */

interface ActiveFiltersProps {
  definitions: FilterDefinition[];
  values: FilterValues;
  copy: Required<TableToolbarLabels>;
  onRemove: (key: string) => void;
  onClearAll: () => void;
}

function ActiveFilters({ definitions, values, copy, onRemove, onClearAll }: ActiveFiltersProps) {
  const chips = definitions
    .map((def) => {
      const value = values[def.key];
      if (value == null || value === "") return null;
      let label = "";
      if (typeof value === "string") {
        label = def.options?.find((o) => o.value === value)?.label ?? value;
      } else {
        label = [value.from, value.to].filter(Boolean).join(" → ");
      }
      if (!label) return null;
      return { key: def.key, label: `${def.label}: ${label}` };
    })
    .filter(Boolean) as { key: string; label: string }[];

  if (chips.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {chips.map((chip) => (
        <span
          key={chip.key}
          className="inline-flex items-center gap-1 rounded-full border border-primary/25 bg-primary/10 py-0.5 pe-1 ps-2.5 text-[11px] font-medium text-primary"
        >
          {chip.label}
          <button
            type="button"
            onClick={() => onRemove(chip.key)}
            aria-label={format(copy.removeFilter, { label: chip.label })}
            className="grid h-4 w-4 place-items-center rounded-full transition-colors hover:bg-primary/25 [&_svg]:size-3"
          >
            <X />
          </button>
        </span>
      ))}
      <button
        type="button"
        onClick={onClearAll}
        className="rounded-full px-2 py-0.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-surface-3 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        {copy.clearAll}
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Filter panel                                                      */
/* ------------------------------------------------------------------ */

interface FilterPanelProps {
  open: boolean;
  onClose: () => void;
  definitions: FilterDefinition[];
  values: FilterValues;
  copy: Required<TableToolbarLabels>;
  onSubmit: (values: FilterValues) => void;
}

/**
 * المحور 10 — الترحيل الموحّد: لوحة الفلترة/الترتيب المحلية أُهملت وكل لوحات
 * TableToolbar تُفوَّض الآن إلى جلد الملاك «شيت الفلترة الجانبي المتقدم»
 * (RecordsFilterPanel / RecordsSortPanel) — فينتقل **كل شاشات النظام** التي
 * تستخدم TableToolbar دفعة واحدة، بلا أي تعديل على استدعاءاتها.
 */
function FilterPanel({ open, onClose, definitions, values, onSubmit }: FilterPanelProps) {
  return (
    <RecordsFilterPanel
      open={open}
      onClose={onClose}
      definitions={definitions}
      values={values}
      onSubmit={onSubmit}
    />
  );
}

function countActive(values: FilterValues): number {
  return Object.values(values).filter((v) => {
    if (v == null) return false;
    if (typeof v === "string") return v !== "";
    return Boolean(v.from || v.to);
  }).length;
}

/* ------------------------------------------------------------------ */
/*  Sort panel                                                        */
/* ------------------------------------------------------------------ */

interface SortPanelProps {
  open: boolean;
  onClose: () => void;
  options: SortOption[];
  value: string;
  copy: Required<TableToolbarLabels>;
  onSubmit: (value: string) => void;
}

function SortPanel({ open, onClose, options, value, onSubmit }: SortPanelProps) {
  return (
    <RecordsSortPanel
      open={open}
      onClose={onClose}
      options={options}
      value={value}
      onSubmit={onSubmit}
    />
  );
}

/* ------------------------------------------------------------------ */
/*  Filter/sort helper functions                                      */
/* ------------------------------------------------------------------ */

/**
 * Client-side filter helper.
 *
 * IMPORTANT: filtering happens entirely in the browser over rows already fetched
 * by the page. No query, endpoint or payload is changed.
 */
export function applyFilters<T>(
  rows: T[],
  values: FilterValues,
  accessors: Record<string, (row: T) => string | number | null | undefined>,
  options: { dateAccessors?: Record<string, (row: T) => string | null | undefined> } = {},
): T[] {
  const entries = Object.entries(values).filter(([, v]) => v != null && v !== "");
  if (entries.length === 0) return rows;

  return rows.filter((row) =>
    entries.every(([key, value]) => {
      if (typeof value !== "string") {
        const dateOf = options.dateAccessors?.[key];
        if (!dateOf) return true;
        const raw = dateOf(row);
        if (!raw) return false;
        const time = new Date(raw).getTime();
        if (Number.isNaN(time)) return false;
        const range = value ?? {};
        if (range.from && time < new Date(range.from).getTime()) return false;
        if (range.to) {
          const to = new Date(range.to);
          to.setHours(23, 59, 59, 999);
          if (time > to.getTime()) return false;
        }
        return true;
      }

      const accessor = accessors[key];
      if (!accessor) return true;
      const actual = accessor(row);
      return String(actual ?? "") === value;
    }),
  );
}

/** Simple substring search across fields. */
export function applySearch<T>(
  rows: T[],
  query: string,
  fields: (row: T) => (string | null | undefined)[],
): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter((row) => fields(row).some((f) => (f ?? "").toLowerCase().includes(q)));
}

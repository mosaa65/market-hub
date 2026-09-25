import * as React from "react";
import {
  ArrowDownUp,
  CalendarDays,
  Check,
  ChevronDown,
  Filter as FilterIcon,
  ListFilter,
  Search,
  ToggleLeft,
  X,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { SearchInput } from "@/components/ui/search-input";
import { Modal } from "@/components/ui/modal";

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

export interface TableToolbarProps {
  /** Search bindings. Omit to hide the search field. */
  search?: {
    value: string;
    onValueChange: (value: string) => void;
    placeholder?: string;
    resultCount?: number;
    debounceMs?: number;
    loading?: boolean;
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
  /** Sticks the toolbar to the top of the list while scrolling. */
  sticky?: boolean;
  className?: string;
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
  sticky = false,
  className,
}: TableToolbarProps) {
  const [filterOpen, setFilterOpen] = React.useState(false);
  const [sortOpen, setSortOpen] = React.useState(false);

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

  return (
    <div
      className={cn(
        "flex flex-col gap-2",
        sticky && "sticky top-0 z-20 bg-surface/95 backdrop-blur-md",
        className,
      )}
    >
      <div className="flex items-center gap-1.5 sm:gap-2">
        {search ? (
          <SearchInput
            value={search.value}
            onValueChange={search.onValueChange}
            placeholder={search.placeholder}
            resultCount={search.resultCount}
            debounceMs={search.debounceMs}
            loading={search.loading}
            enableSlashShortcut
            containerClassName="flex-1 min-w-0"
          />
        ) : (
          <div className="flex-1" />
        )}

        {hasFilters ? (
          <ToolbarAction
            label={filters!.definitions.length > 1 ? "فلترة" : filters!.definitions[0].label}
            icon={<FilterIcon />}
            badge={activeFilterCount}
            active={filterOpen || activeFilterCount > 0}
            onClick={() => setFilterOpen(true)}
            controls="filter-panel"
          />
        ) : null}

        {hasSort ? (
          <ToolbarAction
            label={sort!.label ?? "ترتيب"}
            icon={<ArrowDownUp />}
            active={sortOpen || sort!.value !== ""}
            onClick={() => setSortOpen(true)}
            controls="sort-panel"
          />
        ) : null}

        {end ? <div className="hidden items-center gap-2 lg:flex">{end}</div> : null}

        {action}
      </div>

      {hasFilters && activeFilterCount > 0 ? (
        <ActiveFilters
          definitions={filters!.definitions}
          values={filters!.values}
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
          onSubmit={(v) => {
            sort.onValueChange(v);
            setSortOpen(false);
          }}
        />
      ) : null}
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
  onRemove: (key: string) => void;
  onClearAll: () => void;
}

function ActiveFilters({ definitions, values, onRemove, onClearAll }: ActiveFiltersProps) {
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
            aria-label={`إزالة ${chip.label}`}
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
        مسح الكل
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
  onSubmit: (values: FilterValues) => void;
}

function FilterPanel({ open, onClose, definitions, values, onSubmit }: FilterPanelProps) {
  const [draft, setDraft] = React.useState<FilterValues>(values);

  React.useEffect(() => {
    if (open) setDraft(values);
  }, [open, values]);

  const activeCount = countActive(draft);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="تصفية النتائج"
      description={
        activeCount > 0 ? `${activeCount} تصفية مُطبّقة` : "اختر المعايير لعرض سجلات محددة"
      }
      size="sm"
      desktop="popover-start"
      sheetUntil="lg"
      eyebrow="تصفية ذكية"
      footer={
        <div className="flex w-full items-center gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => setDraft({})}
            disabled={activeCount === 0}
            className="flex-1"
            block={false}
          >
            مسح
          </Button>
          <Button type="button" onClick={() => onSubmit(draft)} className="flex-1" block={false}>
            تطبيق
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        {definitions.map((def) => (
          <FilterControl
            key={def.key}
            def={def}
            value={draft[def.key]}
            onChange={(v) => setDraft((d) => ({ ...d, [def.key]: v }))}
          />
        ))}
      </div>
    </Modal>
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
  onSubmit: (value: string) => void;
}

function SortPanel({ open, onClose, options, value, onSubmit }: SortPanelProps) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="ترتيب النتائج"
      description="اختر الحقل الذي تريد الترتيب حسبه"
      size="sm"
      desktop="popover-start"
      sheetUntil="lg"
      eyebrow="خيارات العرض"
    >
      <div className="flex flex-col gap-1" role="listbox" aria-label="خيارات الترتيب">
        {options.map((o) => {
          const selected = o.value === value;
          return (
            <button
              key={o.value}
              type="button"
              role="option"
              aria-selected={selected}
              onClick={() => onSubmit(o.value)}
              className={cn(
                "flex items-center justify-between gap-3 rounded-full border border-transparent px-3.5 py-2.5 text-start text-sm transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                selected
                  ? "border-primary/25 bg-primary/12 font-medium text-primary"
                  : "text-foreground hover:border-border/70 hover:bg-surface-2/70",
              )}
            >
              <span className="flex min-w-0 items-center gap-2.5 truncate">
                <span className="grid size-7 shrink-0 place-items-center rounded-full bg-surface-2 text-muted-foreground [&_svg]:size-3.5">
                  <ArrowDownUp />
                </span>
                <span className="truncate">{o.label}</span>
              </span>
              {selected ? <Check className="size-4 shrink-0" aria-hidden /> : null}
            </button>
          );
        })}
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/*  Filter control                                                    */
/* ------------------------------------------------------------------ */

interface FilterControlProps {
  def: FilterDefinition;
  value: FilterValues[string];
  onChange: (value: FilterValues[string]) => void;
}

const controlClass =
  "h-11 w-full rounded-full border border-border/70 bg-surface/55 px-4 text-sm text-foreground shadow-[inset_0_1px_0_0_oklch(1_0_0/0.06)] backdrop-blur-xl transition-[border-color,box-shadow,background-color] duration-200 placeholder:text-muted-foreground/70 hover:border-primary/30 hover:bg-surface/75 focus:border-primary/60 focus:bg-surface/85 focus:outline-none focus:ring-4 focus:ring-primary/12";

function filterIcon(type: FilterDefinition["type"]) {
  const Icon =
    type === "date-range" ? CalendarDays : type === "text" ? Search : type === "boolean" ? ToggleLeft : ListFilter;
  return <Icon className="size-3.5" aria-hidden />;
}

function FilterControl({ def, value, onChange }: FilterControlProps) {
  if (def.type === "select") {
    return (
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`filter-${def.key}`} className="flex items-center gap-1.5 text-label text-muted-foreground">
          <span className="grid size-5 place-items-center rounded-full bg-primary/10 text-primary">{filterIcon(def.type)}</span>
          {def.label}
        </label>
        <div className="relative">
          <select
            id={`filter-${def.key}`}
            value={typeof value === "string" ? value : ""}
            onChange={(e) => onChange(e.target.value || undefined)}
            className={`${controlClass} appearance-none pe-10`}
          >
            <option value="">الكل</option>
            {def.options?.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute inset-y-0 end-4 my-auto size-4 text-muted-foreground" aria-hidden />
        </div>
      </div>
    );
  }

  if (def.type === "boolean") {
    const current = typeof value === "string" ? value : "";
    return (
      <div className="flex flex-col gap-1.5">
        <span className="flex items-center gap-1.5 text-label text-muted-foreground">
          <span className="grid size-5 place-items-center rounded-full bg-primary/10 text-primary">{filterIcon(def.type)}</span>
          {def.label}
        </span>
        <div className="flex gap-1.5" role="radiogroup" aria-label={def.label}>
          {[
            { v: "", l: "الكل" },
            { v: "true", l: "نعم" },
            { v: "false", l: "لا" },
          ].map((opt) => {
            const selected = current === opt.v;
            return (
              <button
                key={opt.v}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => onChange(opt.v || undefined)}
                className={cn(
                  "h-10 flex-1 rounded-full border text-xs font-medium transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                  selected
                    ? "border-primary/45 bg-primary/12 text-primary"
                    : "border-border/70 bg-surface/60 text-muted-foreground hover:bg-surface hover:text-foreground",
                )}
              >
                {opt.l}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  if (def.type === "date-range") {
    const range = typeof value === "object" && value != null ? value : {};
    return (
      <div className="flex flex-col gap-1.5">
        <span className="flex items-center gap-1.5 text-label text-muted-foreground">
          <span className="grid size-5 place-items-center rounded-full bg-primary/10 text-primary">{filterIcon(def.type)}</span>
          {def.label}
        </span>
        <div className="grid grid-cols-2 gap-2">
          <input
            type="date"
            aria-label={`${def.label} من`}
            value={range.from ?? ""}
            onChange={(e) => onChange({ ...range, from: e.target.value || undefined })}
            className={controlClass}
          />
          <input
            type="date"
            aria-label={`${def.label} إلى`}
            value={range.to ?? ""}
            onChange={(e) => onChange({ ...range, to: e.target.value || undefined })}
            className={controlClass}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={`filter-${def.key}`} className="flex items-center gap-1.5 text-label text-muted-foreground">
        <span className="grid size-5 place-items-center rounded-full bg-primary/10 text-primary">{filterIcon(def.type)}</span>
        {def.label}
      </label>
      <input
        id={`filter-${def.key}`}
        value={typeof value === "string" ? value : ""}
        placeholder={def.placeholder}
        onChange={(e) => onChange(e.target.value || undefined)}
        className={controlClass}
      />
    </div>
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

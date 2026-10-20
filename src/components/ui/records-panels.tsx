import * as React from "react";
import {
  CalendarDays,
  Check,
  ChevronDown,
  ListFilter,
  RotateCcw,
  Search,
  ToggleLeft,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";
import { VortexFilterSheet, VortexFilterSection } from "@/components/vortex-ui";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { FilterDefinition, FilterValues, SortOption } from "@/components/ui/table-toolbar";

/**
 * Filter and sort panels shared by every records screen.
 *
 * Axis 10: BOTH panels now wear the «شيت الفلترة الجانبي المتقدم» skin — the
 * VortexFilterSheet chrome the operators already love (icon with a live count
 * badge, «N مفعل» pill, spring side sheet, swipe-to-dismiss) — replacing the
 * plain Modal they used before.
 *
 * Footer order is fixed by the plan: **Apply on the trailing (right) side as
 * a wide solid button with a check icon, Reset on the leading (left) side in
 * grey** — matching the gallery sheet exactly.
 *
 * Option presentation follows one rule:
 *  - ≤ 4 options → segment chips (the elegant boolean-check pattern);
 *  - > 4 options → a COLLAPSED dropdown list — closed by default, opens like
 *    any normal list when tapped (never an always-open wall of buttons).
 *
 * A **draft** still only commits on "Apply", so tapping through the controls
 * does not refetch five times.
 */

const controlClass =
  "h-11 w-full rounded-full border border-border/70 bg-surface/55 px-4 text-sm text-foreground shadow-[inset_0_1px_0_0_oklch(1_0_0/0.06)] backdrop-blur-xl transition-[border-color,box-shadow,background-color] duration-200 placeholder:text-muted-foreground/70 hover:border-primary/30 hover:bg-surface/75 focus:border-primary/60 focus:bg-surface/85 focus:outline-none focus:ring-4 focus:ring-primary/12";

function countActive(values: FilterValues): number {
  return Object.values(values).filter((value) => {
    if (value == null) return false;
    if (typeof value === "string") return value !== "";
    return Boolean(value.from || value.to);
  }).length;
}

function filterIcon(type: FilterDefinition["type"]) {
  const Icon =
    type === "date-range"
      ? CalendarDays
      : type === "text"
        ? Search
        : type === "boolean"
          ? ToggleLeft
          : ListFilter;
  return <Icon className="size-3.5" aria-hidden />;
}

export interface RecordsFilterPanelProps {
  open: boolean;
  onClose: () => void;
  definitions: FilterDefinition[];
  values: FilterValues;
  onSubmit: (values: FilterValues) => void;
  title?: string;
}

export function RecordsFilterPanel({
  open,
  onClose,
  definitions,
  values,
  onSubmit,
  title,
}: RecordsFilterPanelProps) {
  const { t } = useI18n();
  const [draft, setDraft] = React.useState<FilterValues>(values);

  // Re-seed on every open so the sheet always reflects what is applied.
  React.useEffect(() => {
    if (open) setDraft(values);
  }, [open, values]);

  const activeCount = countActive(draft);

  return (
    <VortexFilterSheet
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={title ?? t("common.filter")}
      activeFiltersCount={activeCount}
      onApply={() => onSubmit(draft)}
      onReset={() => {
        setDraft({});
        onSubmit({});
      }}
      applyLabel={t("records.apply")}
      resetLabel={t("records.filters.clear_all")}
    >
      <div className="flex flex-col gap-2">
        {definitions.map((definition) => (
          <VortexFilterSection
            key={definition.key}
            title={definition.label}
            icon={filterIcon(definition.type)}
          >
            <FilterControl
              def={definition}
              value={draft[definition.key]}
              onChange={(value) => setDraft((prev) => ({ ...prev, [definition.key]: value }))}
            />
          </VortexFilterSection>
        ))}
      </div>
    </VortexFilterSheet>
  );
}

/**
 * قائمة منسدلة مغلقة افتراضياً — تُفتح مثل أي ليست عادي عند الضغط، وتُغلق عند
 * الاختيار أو النقر خارجها. نفس حبة حقل الفورم (controlClass) فلا يختل التصميم.
 * يستخدم للفلاتر التي خياراتها كثيرة (> 4) بدل جدار أزرار مفتوح دائماً.
 */
function DropdownOptionList({
  options,
  current,
  onSelect,
  label,
}: {
  options: { value: string; label: string }[];
  current: string;
  onSelect: (value: string) => void;
  label: string;
}) {
  const [open, setOpen] = React.useState(false);
  const selected = options.find((option) => option.value === current);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-label={label}
          className={cn(
            controlClass,
            "flex cursor-pointer items-center justify-between gap-2 text-start",
          )}
        >
          <span className={cn("truncate", !selected && "text-muted-foreground/70")}>
            {selected?.label ?? label}
          </span>
          <ChevronDown
            className={cn(
              "size-4 shrink-0 text-muted-foreground transition-transform duration-200",
              open && "rotate-180",
            )}
            aria-hidden
          />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={6}
        className="w-[var(--radix-popover-trigger-width)] min-w-48 rounded-2xl border border-border/60 bg-popover/95 p-1.5 shadow-xl backdrop-blur-2xl"
      >
        <div
          className="flex max-h-64 flex-col gap-0.5 overflow-y-auto custom-scrollbar"
          role="listbox"
          aria-label={label}
        >
          {options.map((option) => {
            const isSelected = option.value === current;
            return (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={isSelected}
                onClick={() => {
                  onSelect(option.value);
                  setOpen(false);
                }}
                className={cn(
                  "flex items-center justify-between gap-3 rounded-xl border border-transparent px-3 py-2 text-start text-sm transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                  isSelected
                    ? "border-primary/25 bg-primary/10 font-medium text-primary"
                    : "text-foreground hover:border-border/60 hover:bg-surface-2/60",
                )}
              >
                <span className="truncate">{option.label}</span>
                {isSelected ? <Check className="size-4 shrink-0" aria-hidden /> : null}
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function FilterControl({
  def,
  value,
  onChange,
}: {
  def: FilterDefinition;
  value: FilterValues[string];
  onChange: (value: FilterValues[string]) => void;
}) {
  const { t } = useI18n();

  /** Segment chips — the elegant boolean-check pattern, for few options. */
  const optionChips = (
    options: { value: string; label: string }[],
    current: string,
    commit: (value: string) => void,
  ) => (
    <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={def.label}>
      {options.map((option) => {
        const selected = option.value === current;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => commit(option.value)}
            className={cn(
              "inline-flex h-9 items-center gap-1 rounded-full border px-3.5 text-xs font-medium transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
              selected
                ? "border-primary/45 bg-primary/12 text-primary"
                : "border-border/70 bg-surface/60 text-muted-foreground hover:bg-surface hover:text-foreground",
            )}
          >
            {selected ? <Check className="size-3" aria-hidden /> : null}
            {option.label}
          </button>
        );
      })}
    </div>
  );

  if (def.type === "select") {
    const current = typeof value === "string" ? value : "";
    const options = [{ value: "", label: t("common.all") }, ...(def.options ?? [])];
    // ≤ 4 options render as chips; more render as a collapsed dropdown list
    // (closed by default — opens like any normal list when tapped).
    return options.length <= 4 ? (
      optionChips(options, current, (v) => onChange(v || undefined))
    ) : (
      <DropdownOptionList
        options={options}
        current={current}
        onSelect={(v) => onChange(v || undefined)}
        label={def.label}
      />
    );
  }

  if (def.type === "boolean") {
    const current = typeof value === "string" ? value : "";
    return optionChips(
      [
        { value: "", label: t("common.all") },
        { value: "true", label: t("common.yes") },
        { value: "false", label: t("common.no") },
      ],
      current,
      (v) => onChange(v || undefined),
    );
  }

  if (def.type === "date-range") {
    const range = typeof value === "object" && value != null ? value : {};
    return (
      <div className="grid grid-cols-2 gap-2">
        <input
          type="date"
          aria-label={`${def.label} — ${t("common.from")}`}
          value={range.from ?? ""}
          onChange={(event) => onChange({ ...range, from: event.target.value || undefined })}
          className={controlClass}
        />
        <input
          type="date"
          aria-label={`${def.label} — ${t("common.to")}`}
          value={range.to ?? ""}
          onChange={(event) => onChange({ ...range, to: event.target.value || undefined })}
          className={controlClass}
        />
      </div>
    );
  }

  return (
    <input
      id={`filter-${def.key}`}
      value={typeof value === "string" ? value : ""}
      placeholder={def.placeholder}
      onChange={(event) => onChange(event.target.value || undefined)}
      className={controlClass}
    />
  );
}

/* ------------------------------------------------------------------ */
/*  Sort panel                                                        */
/* ------------------------------------------------------------------ */

export interface RecordsSortPanelProps {
  open: boolean;
  onClose: () => void;
  options: SortOption[];
  value: string;
  onSubmit: (value: string) => void;
  title?: string;
}

export function RecordsSortPanel({
  open,
  onClose,
  options,
  value,
  onSubmit,
  title,
}: RecordsSortPanelProps) {
  const { t, lang } = useI18n();

  /* Draft selection: tapping an option only moves the highlight — the sort
   * commits on "Apply", the same contract as the filter sheet. Reset applies
   * the default order immediately. */
  const [draft, setDraft] = React.useState(value);
  React.useEffect(() => {
    if (open) setDraft(value);
  }, [open, value]);

  const changed = draft !== value;
  const sortOptions = React.useMemo(
    () =>
      options.some((option) => option.value === "")
        ? options
        : [
            {
              value: "",
              label: lang === "ar" ? "الترتيب الافتراضي" : "Default order",
            },
            ...options,
          ],
    [options, lang],
  );

  return (
    <VortexFilterSheet
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={title ?? t("common.sort")}
      subtitle={changed ? undefined : t("common.sort")}
      activeFiltersCount={draft ? 1 : 0}
      onApply={() => onSubmit(draft)}
      onReset={() => {
        setDraft("");
        onSubmit("");
      }}
      applyLabel={t("records.apply")}
      resetLabel={t("records.filters.clear_all")}
    >
      <div className="flex flex-col gap-0.5" role="listbox" aria-label={t("common.sort")}>
        {sortOptions.map((option) => {
          const selected = option.value === draft;
          return (
            <button
              key={option.value}
              type="button"
              role="option"
              aria-selected={selected}
              onClick={() => setDraft(option.value)}
              className={cn(
                "flex items-center justify-between gap-3 rounded-xl border border-transparent px-3 py-2 text-start text-sm transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                selected
                  ? "border-primary/25 bg-primary/10 font-medium text-primary"
                  : "text-foreground hover:border-border/60 hover:bg-surface-2/60",
              )}
            >
              <span className="truncate">{option.label}</span>
              {selected ? <Check className="size-4 shrink-0" aria-hidden /> : null}
            </button>
          );
        })}
      </div>
    </VortexFilterSheet>
  );
}

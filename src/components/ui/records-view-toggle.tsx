import { LayoutGrid, List, TableProperties } from "lucide-react";

import { cn } from "@/lib/utils";
import type { RecordsViewMode } from "@/components/ui/records-view";
import { useI18n } from "@/lib/i18n";

/**
 * View-mode switcher — cards / list / table (plan §2).
 *
 * On mobile viewports (< sm), it renders a single, elegant cycling button that
 * rotates between the modes on each tap, preserving screen width for search and
 * action buttons. On tablet/desktop (>= sm), it expands into a full segmented
 * control displaying all available modes.
 */
export interface RecordsViewToggleProps {
  value: RecordsViewMode;
  onChange: (mode: RecordsViewMode) => void;
  /** Modes a screen does not support are not offered at all. */
  modes?: RecordsViewMode[];
  /** Render one icon-only circular control that advances to the next mode. */
  cycle?: boolean;
  className?: string;
}

const ICONS: Record<RecordsViewMode, typeof LayoutGrid> = {
  cards: LayoutGrid,
  list: List,
  table: TableProperties,
};

const LABEL_KEYS: Record<RecordsViewMode, string> = {
  cards: "records.view.cards",
  list: "records.view.list",
  table: "records.view.table",
};

export function RecordsViewToggle({
  value,
  onChange,
  modes = ["cards", "list", "table"],
  cycle = false,
  className,
}: RecordsViewToggleProps) {
  const { t } = useI18n();

  if (modes.length <= 1) return null;

  const currentIndex = modes.indexOf(value);
  const safeIndex = currentIndex >= 0 ? currentIndex : 0;
  const nextIndex = (safeIndex + 1) % modes.length;
  const nextMode = modes[nextIndex];

  const CurrentIcon = ICONS[value] || LayoutGrid;
  const currentLabel = t(LABEL_KEYS[value]) || value;
  const nextLabel = t(LABEL_KEYS[nextMode]) || nextMode;

  // Explicit compact mode: one icon-only circular control on every viewport.
  if (cycle) {
    return (
      <button
        type="button"
        onClick={() => onChange(nextMode)}
        aria-label={`${t("records.view.switch_hint")}: ${nextLabel}`}
        title={`${currentLabel} · ${nextLabel}`}
        className={cn(
          "grid size-9 shrink-0 place-items-center rounded-full border border-border/70 bg-surface/70 text-muted-foreground shadow-[var(--shadow-control)] transition hover:border-primary/40 hover:bg-primary/10 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 active:scale-95",
          className,
        )}
      >
        <CurrentIcon className="size-4" aria-hidden />
      </button>
    );
  }

  return (
    <>
      {/* Mobile single cycling button (< sm) */}
      <button
        type="button"
        onClick={() => onChange(nextMode)}
        aria-label={`${currentLabel} — ${t("records.view.switch_hint")}`}
        title={`${currentLabel} (انقر للتبديل إلى ${nextLabel})`}
        className={cn(
          "inline-flex sm:hidden shrink-0 h-9 items-center justify-center gap-1.5 rounded-full border border-border/80 bg-surface/80 px-2.5 text-xs font-semibold text-foreground shadow-[var(--shadow-control)] backdrop-blur-xl transition-all active:scale-95 hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
          className,
        )}
      >
        <CurrentIcon
          className="size-4 text-primary shrink-0 transition-transform duration-200"
          aria-hidden
        />
        <span className="text-[11px] font-bold text-foreground">{currentLabel}</span>
      </button>

      {/* Desktop/tablet segmented multi-button control (>= sm) */}
      <div
        role="group"
        aria-label={t("records.view.group")}
        title={t("records.view.switch_hint")}
        className={cn(
          "hidden sm:inline-flex shrink-0 items-center gap-0.5 rounded-full border border-border/70 bg-surface/55 p-0.5 shadow-[var(--shadow-control)] backdrop-blur-xl",
          className,
        )}
      >
        {modes.map((mode) => {
          const Icon = ICONS[mode];
          const selected = value === mode;
          const label = t(LABEL_KEYS[mode]);
          return (
            <button
              key={mode}
              type="button"
              onClick={() => onChange(mode)}
              aria-pressed={selected}
              aria-label={label}
              title={label}
              className={cn(
                "inline-flex h-9 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium transition-colors sm:h-10 sm:px-3.5",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                selected
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:bg-surface-2 hover:text-foreground",
              )}
            >
              <Icon className="size-4" aria-hidden />
              <span className="hidden lg:inline">{label}</span>
            </button>
          );
        })}
      </div>
    </>
  );
}

import { LayoutGrid, List, TableProperties } from "lucide-react";

import { cn } from "@/lib/utils";
import type { RecordsViewMode } from "@/components/ui/records-view";
import { useI18n } from "@/lib/i18n";

/**
 * View-mode switcher — cards / list / table, in one control (plan §2).
 *
 * Why a segmented control and not one cycling button: the previous control
 * showed the *current* mode and rotated on click, so reaching "table" from
 * "cards" took two presses and the user could never see that a third option
 * existed. A three-segment switch makes all presentations visible at once and
 * switches in a single press — which is the plan's "the choice is clear in the
 * page bar".
 *
 * Labels come from i18n so the control is identical on every screen.
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

  if (cycle) {
    const currentIndex = Math.max(0, modes.indexOf(value));
    const nextMode = modes[(currentIndex + 1) % modes.length] ?? value;
    const Icon = ICONS[value];
    const nextLabel = t(LABEL_KEYS[nextMode]);
    const currentLabel = t(LABEL_KEYS[value]);
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
        <Icon className="size-4" aria-hidden />
      </button>
    );
  }

  return (
    <div
      role="group"
      aria-label={t("records.view.group")}
      title={t("records.view.switch_hint")}
      className={cn(
        "inline-flex shrink-0 items-center gap-0.5 rounded-full border border-border/70 bg-surface/55 p-0.5 shadow-[var(--shadow-control)] backdrop-blur-xl",
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
  );
}

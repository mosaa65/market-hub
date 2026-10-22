import * as React from "react";
import { Check, Columns3, Lock, RotateCcw } from "lucide-react";

import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { ColumnDefinition, ColumnVisibility } from "@/lib/records/column-registry";
import { useI18n } from "@/lib/i18n";

/**
 * "Visible columns" — one picker for every records screen (plan §9.1).
 *
 * It is driven entirely by a `ColumnRegistry`, so a screen supplies data and
 * nothing else. Three behaviours are enforced here rather than trusted to the
 * caller:
 *
 *  - Essential columns render locked with a padlock and cannot be switched off,
 *    so "hide the name column" is not a state the app can reach.
 *  - Reset restores the registry defaults and clears the stored preference.
 *  - The panel is a Popover (not a modal), because choosing columns is a
 *    side-task: the list must stay visible while you toggle a field.
 */
export interface RecordsColumnPickerProps {
  columns: ColumnDefinition[];
  visibility: ColumnVisibility;
  onToggle: (key: string) => void;
  onReset: () => void;
  className?: string;
}

export function RecordsColumnPicker({
  columns,
  visibility,
  onToggle,
  onReset,
  className,
}: RecordsColumnPickerProps) {
  const { t, lang } = useI18n();
  const isAr = lang === "ar";
  const [open, setOpen] = React.useState(false);

  const groups = React.useMemo(() => {
    const map = new Map<string, ColumnDefinition[]>();
    for (const column of columns) {
      const key = isAr ? (column.groupAr ?? "") : (column.groupEn ?? "");
      const list = map.get(key) ?? [];
      list.push(column);
      map.set(key, list);
    }
    return Array.from(map.entries());
  }, [columns, isAr]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex size-10 shrink-0 items-center justify-center gap-1.5 rounded-full border text-sm font-medium shadow-[var(--shadow-control)] backdrop-blur-xl transition-colors sm:h-11 sm:w-auto sm:px-4",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 active:scale-95",
            open
              ? "border-primary/45 bg-primary/12 text-primary"
              : "border-border/70 bg-surface/55 text-muted-foreground hover:border-primary/30 hover:bg-surface/85 hover:text-foreground",
            className,
          )}
          aria-label={t("records.columns")}
          title={t("records.columns")}
          aria-haspopup="dialog"
          aria-expanded={open}
        >
          <Columns3 className="size-4" aria-hidden />
          <span className="hidden sm:inline">{t("records.columns")}</span>
        </button>
      </PopoverTrigger>

      <PopoverContent align="end" className="w-[19rem] p-0">
        <div className="flex items-center justify-between border-b border-border/60 px-3 py-2">
          <div className="min-w-0">
            <p className="text-xs font-bold">{t("records.columns.title")}</p>
            <p className="mt-0.5 truncate text-[10px] text-muted-foreground">
              {t("records.columns.hint")}
            </p>
          </div>
          <button
            type="button"
            onClick={onReset}
            className="inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-surface-2 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            <RotateCcw className="size-3" aria-hidden />
            {t("records.columns.reset")}
          </button>
        </div>

        <div className="max-h-[60vh] overflow-y-auto p-1.5 custom-scrollbar">
          {groups.map(([group, items]) => (
            <div key={group || "__default"} className="mb-2 last:mb-0">
              {group ? (
                <div className="px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                  {group}
                </div>
              ) : null}
              <div className="space-y-0.5">
                {items.map((column) => {
                  const visible = Boolean(visibility[column.key]);
                  const label = isAr ? column.labelAr : column.labelEn;
                  return (
                    <button
                      key={column.key}
                      type="button"
                      role="switch"
                      aria-checked={visible}
                      disabled={column.essential}
                      onClick={() => onToggle(column.key)}
                      title={column.essential ? t("records.columns.locked") : label}
                      className={cn(
                        "flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-start text-xs transition-colors",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                        column.essential
                          ? "cursor-default opacity-70"
                          : "hover:bg-surface-2 cursor-pointer",
                      )}
                    >
                      <span
                        className={cn(
                          "grid size-4 shrink-0 place-items-center rounded border transition-colors",
                          visible
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-border",
                        )}
                        aria-hidden
                      >
                        {visible ? <Check className="size-3" /> : null}
                      </span>
                      <span className="min-w-0 flex-1 truncate">{label}</span>
                      {column.essential ? (
                        <Lock className="size-3 shrink-0 text-muted-foreground/70" aria-hidden />
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

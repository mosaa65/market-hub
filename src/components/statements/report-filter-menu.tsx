import {
  Calendar,
  ChevronLeft,
  ChevronRight,
  Filter,
  RotateCcw,
  SlidersHorizontal,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export interface ReportFilterPreset {
  key: string;
  label: string;
  from: string;
  to: string;
}

export interface ReportFilterValues {
  from: string;
  to: string;
  preset: string;
  includeZeroRows: boolean;
}

interface ReportFilterMenuProps {
  values: ReportFilterValues;
  presets: ReportFilterPreset[];
  labels: {
    trigger: string;
    title: string;
    date: string;
    period: string;
    options: string;
    includeZeroRows: string;
    reset: string;
    back: string;
    from: string;
    to: string;
  };
  onChange: (values: ReportFilterValues) => void;
  onReset: () => void;
}

export function ReportFilterMenu({
  values,
  presets,
  labels,
  onChange,
  onReset,
}: ReportFilterMenuProps) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"main" | "date" | "options">("main");
  const update = (patch: Partial<ReportFilterValues>) => onChange({ ...values, ...patch });
  const viewTitle =
    view === "date" ? labels.date : view === "options" ? labels.options : labels.title;

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setView("main");
      }}
    >
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 gap-1.5 px-2.5 text-xs">
          <Filter className="h-3.5 w-3.5 text-primary" />
          {labels.trigger}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-auto min-w-[220px] max-w-[min(92vw,330px)] p-1.5">
        <div className="flex items-center gap-1 border-b border-border/60 px-2 py-1.5">
          {view !== "main" && (
            <button
              type="button"
              onClick={() => setView("main")}
              className="grid h-6 w-6 place-items-center rounded-md text-muted-foreground transition hover:bg-surface-2 hover:text-foreground"
              aria-label={labels.back}
            >
              <ChevronLeft className="h-3.5 w-3.5 rtl:rotate-180" />
            </button>
          )}
          <span className="flex-1 text-xs font-semibold">{viewTitle}</span>
          <SlidersHorizontal className="h-3.5 w-3.5 text-muted-foreground" />
        </div>

        <div className="relative overflow-hidden">
          {view === "main" && (
            <div className="animate-in fade-in slide-in-from-inline-start-1 duration-150 py-1">
              <MenuItem icon={<Calendar />} label={labels.date} onClick={() => setView("date")} />
              <MenuItem
                icon={<SlidersHorizontal />}
                label={labels.options}
                onClick={() => setView("options")}
              />
              <div className="my-1 border-t border-border/60" />
              <button
                type="button"
                onClick={onReset}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-start text-xs text-muted-foreground transition hover:bg-surface-2 hover:text-foreground"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                {labels.reset}
              </button>
            </div>
          )}

          {view === "date" && (
            <div className="animate-in fade-in slide-in-from-inline-end-1 space-y-2 p-2 duration-150">
              <div className="flex flex-wrap gap-1">
                {presets.map((preset) => (
                  <button
                    key={preset.key}
                    type="button"
                    onClick={() => update({ preset: preset.key, from: preset.from, to: preset.to })}
                    className={cn(
                      "rounded-full border px-2 py-1 text-[11px] transition",
                      values.preset === preset.key
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border/80 text-muted-foreground hover:bg-surface-2",
                    )}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <DateInput
                  label={labels.from}
                  value={values.from}
                  onChange={(from) => update({ from, preset: "custom" })}
                />
                <DateInput
                  label={labels.to}
                  value={values.to}
                  onChange={(to) => update({ to, preset: "custom" })}
                />
              </div>
            </div>
          )}

          {view === "options" && (
            <div className="animate-in fade-in slide-in-from-inline-end-1 p-2 duration-150">
              <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-xs transition hover:bg-surface-2">
                <input
                  type="checkbox"
                  checked={values.includeZeroRows}
                  onChange={(event) => update({ includeZeroRows: event.target.checked })}
                  className="h-3.5 w-3.5 rounded border-border"
                />
                {labels.includeZeroRows}
              </label>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function MenuItem({
  icon,
  label,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-start text-xs transition hover:bg-surface-2"
    >
      <span className="text-muted-foreground [&_svg]:h-3.5 [&_svg]:w-3.5">{icon}</span>
      <span className="flex-1">{label}</span>
      <ChevronRight className="h-3.5 w-3.5 text-muted-foreground rtl:rotate-180" />
    </button>
  );
}

function DateInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="space-y-1 text-[10px] text-muted-foreground">
      <span className="flex items-center gap-1">
        <Calendar className="h-3 w-3" />
        {label}
      </span>
      <Input
        type="date"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-7 w-full text-[11px]"
      />
    </label>
  );
}

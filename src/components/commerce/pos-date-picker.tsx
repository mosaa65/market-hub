import { useState } from "react";
import { CalendarDays, ChevronDown, Clock3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

interface PosDatePickerProps {
  value: string;
  onChange: (value: string) => void;
  lang: string;
  label: string;
}

function parseDate(value: string): Date | undefined {
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return undefined;
  return new Date(year, month - 1, day);
}

function formatDate(value: string, lang: string): string {
  const date = parseDate(value);
  return date
    ? new Intl.DateTimeFormat(lang === "ar" ? "ar" : "en", {
        day: "numeric",
        month: "short",
        year: "numeric",
      }).format(date)
    : value;
}

function formatLongDate(value: string, lang: string): string {
  const date = parseDate(value);
  return date
    ? new Intl.DateTimeFormat(lang === "ar" ? "ar" : "en", {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
      }).format(date)
    : value;
}

export function PosDatePicker({ value, onChange, lang, label }: PosDatePickerProps) {
  const [open, setOpen] = useState(false);
  const isArabic = lang === "ar";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          aria-label={label}
          aria-expanded={open}
          className="h-9 min-w-0 shrink-0 justify-start gap-2 rounded-full border-border/80 bg-surface px-2.5 text-xs font-medium shadow-2xs hover:border-primary/40 hover:bg-primary/5 sm:px-3"
        >
          <CalendarDays className="size-4 shrink-0 text-primary" />
          <span className="hidden max-w-32 truncate sm:inline">{formatDate(value, lang)}</span>
          <ChevronDown className="hidden size-3.5 shrink-0 opacity-50 sm:inline" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align={isArabic ? "end" : "start"}
        sideOffset={6}
        className="w-[min(21rem,calc(100vw-1rem))] overflow-hidden rounded-2xl border-border/70 bg-popover p-0 shadow-2xl"
      >
        <div className="flex items-center gap-3 border-b border-border/70 bg-primary/[0.035] px-4 py-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-xl border border-primary/15 bg-primary/10 text-primary">
            <CalendarDays className="size-4" />
          </span>
          <span className="min-w-0">
            <span className="block truncate text-xs font-semibold text-muted-foreground">
              {label}
            </span>
            <span className="block truncate text-sm font-bold text-foreground">
              {formatLongDate(value, lang)}
            </span>
          </span>
        </div>
        <Calendar
          mode="single"
          selected={parseDate(value)}
          onSelect={(date) => {
            if (!date) return;
            const year = date.getFullYear();
            const month = String(date.getMonth() + 1).padStart(2, "0");
            const day = String(date.getDate()).padStart(2, "0");
            onChange(`${year}-${month}-${day}`);
            setOpen(false);
          }}
          dir={isArabic ? "rtl" : "ltr"}
          initialFocus
          className="mx-auto p-3"
        />
        <div className="flex justify-end border-t border-border/70 px-3 py-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 gap-1.5 rounded-full px-3 text-xs font-semibold text-primary hover:bg-primary/10"
            onClick={() => {
              const today = new Date();
              const year = today.getFullYear();
              const month = String(today.getMonth() + 1).padStart(2, "0");
              const day = String(today.getDate()).padStart(2, "0");
              onChange(`${year}-${month}-${day}`);
              setOpen(false);
            }}
          >
            <Clock3 className="size-3.5" />
            {isArabic ? "اليوم" : "Today"}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

import { useState } from "react";
import { CalendarDays, ChevronDown } from "lucide-react";
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

function localDateValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
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
        className="w-[min(21rem,calc(100vw-1rem))] overflow-hidden rounded-2xl border-primary/20 bg-primary/[0.055] p-0 text-card-foreground shadow-2xl dark:border-primary/30 dark:bg-primary/[0.12]"
      >
        <div className="flex items-center gap-3 border-b border-primary/15 px-4 py-3 dark:border-primary/25">
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
          showOutsideDays={false}
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
          weekStartsOn={6}
          formatters={{
            formatWeekdayName: (date) =>
              new Intl.DateTimeFormat(isArabic ? "ar" : "en", { weekday: "long" }).format(date),
          }}
          classNames={{
            month: "flex w-full flex-col gap-2",
            month_caption: "flex h-8 w-full items-center justify-center px-8 text-sm font-bold",
            nav: "absolute inset-x-0 top-0 flex w-full items-center justify-between gap-1",
            weekdays: "flex border-b border-primary/10 pb-1 dark:border-primary/20",
            weekday:
              "flex-1 select-none rounded-md px-0 text-center text-[9px] font-semibold text-muted-foreground sm:text-[10px]",
            week: "mt-1 flex w-full",
            day_button:
              "mx-auto size-8 rounded-full text-xs transition-colors hover:bg-primary/10 data-[selected-single=true]:bg-primary data-[selected-single=true]:text-primary-foreground sm:size-9",
          }}
          initialFocus
          className="mx-auto w-full p-2.5"
        />
        <div className="flex items-center gap-1.5 border-t border-primary/15 px-2.5 py-2 dark:border-primary/25">
          {[
            { offset: 0, ar: "اليوم", en: "Today" },
            { offset: -1, ar: "أمس", en: "Yesterday" },
            { offset: -2, ar: "أول أمس", en: "2 days ago" },
          ].map((shortcut) => (
            <Button
              key={shortcut.offset}
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 flex-1 rounded-full border border-primary/15 bg-background/35 px-2 text-[11px] font-semibold text-primary hover:border-primary/30 hover:bg-primary/10"
              onClick={() => {
                const date = new Date();
                date.setDate(date.getDate() + shortcut.offset);
                onChange(localDateValue(date));
                setOpen(false);
              }}
            >
              {isArabic ? shortcut.ar : shortcut.en}
            </Button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

import { useState } from "react";
import { ar } from "date-fns/locale";
import { CalendarDays, ChevronDown, X } from "lucide-react";
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
  const isArabic = lang.toLowerCase().startsWith("ar");

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
        className="w-[min(21rem,calc(100vw-1rem))] overflow-hidden rounded-2xl border border-border/80 bg-card p-0 text-card-foreground shadow-2xl"
      >
        <div className="flex items-center gap-3 border-b border-border/70 bg-card px-4 py-2.5">
          <span className="grid size-9 shrink-0 place-items-center rounded-full border border-primary/15 bg-primary/10 text-primary">
            <CalendarDays className="size-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-xs font-semibold text-muted-foreground">
              {label}
            </span>
            <span className="block truncate text-sm font-bold text-foreground">
              {formatLongDate(value, lang)}
            </span>
          </span>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label={isArabic ? "إغلاق التقويم" : "Close calendar"}
            title={isArabic ? "إغلاق" : "Close"}
            className="grid size-8 shrink-0 place-items-center rounded-full border border-border/70 bg-card text-muted-foreground transition hover:border-primary/30 hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            <X className="size-4" />
          </button>
        </div>
        <Calendar
          mode="single"
          locale={isArabic ? ar : undefined}
          showOutsideDays={false}
          selected={parseDate(value)}
          onSelect={(date) => {
            if (!date) return;
            const year = date.getFullYear();
            const month = String(date.getMonth() + 1).padStart(2, "0");
            const day = String(date.getDate()).padStart(2, "0");
            onChange(`${year}-${month}-${day}`);
          }}
          dir={isArabic ? "rtl" : "ltr"}
          weekStartsOn={6}
          formatters={{
            formatWeekdayName: (date) =>
              new Intl.DateTimeFormat(isArabic ? "ar-SA" : "en", { weekday: "long" }).format(date),
          }}
          classNames={{
            root: "mx-auto w-full",
            month: "flex w-full flex-col gap-0",
            month_caption:
              "flex h-8 w-full items-center justify-center px-10 text-sm font-bold text-foreground",
            nav: "absolute inset-x-0 top-0 flex w-full items-center justify-between px-1",
            button_previous:
              "grid size-8 place-items-center rounded-full border border-border/70 bg-card text-foreground transition hover:border-primary/40 hover:bg-muted active:scale-95",
            button_next:
              "grid size-8 place-items-center rounded-full border border-border/70 bg-card text-foreground transition hover:border-primary/40 hover:bg-muted active:scale-95",
            weekdays: "grid grid-cols-7 border-b border-border/70 pb-1",
            weekday:
              "min-w-0 select-none px-0 text-center text-[9px] font-semibold text-muted-foreground sm:text-[10px]",
            week: "mt-0 grid grid-cols-7",
            day: "mx-auto grid size-8 place-items-center p-0",
            day_button:
              "grid size-8 place-items-center rounded-full text-xs font-medium transition-colors hover:bg-primary/10 data-[today=true]:border data-[today=true]:border-primary/40 data-[selected-single=true]:bg-primary data-[selected-single=true]:font-bold data-[selected-single=true]:text-primary-foreground",
          }}
          initialFocus
          className="mx-auto w-full bg-card px-3 py-1.5"
        />
        <div className="flex items-center gap-1.5 border-t border-border/70 bg-card px-2.5 py-1.5">
          {[
            { offset: 0, ar: "اليوم", en: "Today" },
            { offset: -1, ar: "أمس", en: "Yesterday" },
            { offset: -2, ar: "أول أمس", en: "2 days ago" },
          ].map((shortcut) => (
            <button
              key={shortcut.offset}
              type="button"
              className="h-8 flex-1 rounded-full border border-border/70 bg-card px-2 text-[11px] font-semibold text-primary transition hover:border-primary/35 hover:bg-muted active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              onClick={() => {
                const date = new Date();
                date.setDate(date.getDate() + shortcut.offset);
                onChange(localDateValue(date));
              }}
            >
              {isArabic ? shortcut.ar : shortcut.en}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

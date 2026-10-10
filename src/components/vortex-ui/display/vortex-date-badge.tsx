"use client";

import * as React from "react";
import { Calendar, Clock } from "lucide-react";
import { formatLuxuryDate, formatFormalDateTime } from "@/lib/format-preferences";
import { cn } from "@/lib/utils";

export interface VortexDateBadgeProps {
  date: string | Date;
  size?: "sm" | "md" | "lg";
  showWeekday?: boolean;
  showTime?: boolean;
  variant?: "default" | "subtle" | "outline" | "formal" | "minimal" | string;
  className?: string;
}

export function VortexDateBadge({
  date,
  size = "md",
  showWeekday = false,
  showTime = true,
  variant = "formal",
  className,
}: VortexDateBadgeProps) {
  // Formal/subtle fast official view (date + time)
  if (variant === "formal" || variant === "subtle" || variant === "minimal") {
    const { date: dateStr, time: timeStr } = formatFormalDateTime(date, { showTime: true });

    return (
      <div
        className={cn(
          "inline-flex items-center gap-1.5 font-mono text-muted-foreground whitespace-nowrap select-none",
          size === "sm" ? "text-[11px]" : size === "lg" ? "text-sm" : "text-xs",
          className,
        )}
      >
        <span className="inline-flex items-center gap-1 text-foreground/80 font-medium">
          <Calendar className="size-3 text-muted-foreground shrink-0 opacity-70" />
          <span>{dateStr}</span>
        </span>
        {showTime && timeStr !== "—" && (
          <>
            <span className="text-border shrink-0 select-none">•</span>
            <span className="inline-flex items-center gap-1 text-muted-foreground">
              <Clock className="size-2.5 text-muted-foreground shrink-0 opacity-70" />
              <span>{timeStr}</span>
            </span>
          </>
        )}
      </div>
    );
  }

  // Decorated luxury badge if explicitly requested
  const { day, month, year, weekday } = formatLuxuryDate(date, { showDayName: showWeekday });
  const { time: timeStr } = formatFormalDateTime(date, { showTime: true });

  return (
    <div
      className={cn(
        "inline-flex items-center gap-2 rounded-xl border border-border/70 bg-surface-2/40 px-2.5 py-1 text-xs shadow-xs select-none",
        size === "sm" && "px-2 py-0.5 text-[11px]",
        size === "lg" && "px-3.5 py-1.5 text-sm",
        className,
      )}
    >
      <Calendar className="size-3 text-primary shrink-0" />
      <div className="flex items-baseline gap-1 font-medium">
        {showWeekday && (
          <span className="text-muted-foreground text-[11px]">{weekday}،</span>
        )}
        <span className="text-foreground font-mono font-bold">{day}</span>
        <span className="text-primary font-medium">{month}</span>
        <span className="text-muted-foreground">{year}</span>
        {showTime && timeStr !== "—" && (
          <span className="text-muted-foreground text-[10px] font-mono border-s border-border ps-1.5 ms-1">
            {timeStr}
          </span>
        )}
      </div>
    </div>
  );
}

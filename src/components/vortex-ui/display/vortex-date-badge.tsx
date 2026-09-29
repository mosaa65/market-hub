"use client";

import * as React from "react";
import { Calendar } from "lucide-react";
import { formatLuxuryDate } from "@/lib/format-preferences";
import { cn } from "@/lib/utils";

export interface VortexDateBadgeProps {
  date: string | Date;
  size?: "sm" | "md" | "lg";
  showWeekday?: boolean;
  className?: string;
}

export function VortexDateBadge({
  date,
  size = "md",
  showWeekday = false,
  className,
}: VortexDateBadgeProps) {
  const { day, month, year, weekday } = formatLuxuryDate(date, { showDayName: showWeekday });

  return (
    <div
      className={cn(
        "inline-flex items-center gap-2 rounded-2xl border border-border/80 bg-muted/40 backdrop-blur-sm px-3 py-1.5 shadow-sm",
        size === "sm" && "px-2.5 py-1 text-xs rounded-xl",
        size === "lg" && "px-4 py-2 text-sm rounded-2xl",
        className
      )}
    >
      <div className="grid size-7 place-items-center rounded-xl bg-card border border-border/60 text-primary shadow-xs">
        <Calendar className="size-3.5" />
      </div>
      <div className="flex items-baseline gap-1.5 font-bold">
        {showWeekday && (
          <span className="text-muted-foreground font-medium text-[11px]">{weekday}،</span>
        )}
        <span className="text-foreground font-mono font-black">{day}</span>
        <span className="text-primary font-medium text-xs">{month}</span>
        <span className="text-muted-foreground font-normal text-[11px]">{year}</span>
      </div>
    </div>
  );
}

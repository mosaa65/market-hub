"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";

export interface VortexMetricCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon?: React.ReactNode;
  iconClassName?: string;
  trend?: {
    value: string | number;
    direction?: "up" | "down" | "neutral";
    isPositive?: boolean;
    label?: string;
  };
  highlight?: boolean;
  currency?: string;
  badge?: string;
  className?: string;
  onClick?: () => void;
}

export function VortexMetricCard({
  title,
  value,
  subtitle,
  icon,
  iconClassName = "bg-primary/10 text-primary",
  trend,
  highlight = false,
  currency = "ر.س",
  badge,
  className,
  onClick,
}: VortexMetricCardProps) {
  const isClickable = Boolean(onClick);

  return (
    <div
      onClick={onClick}
      role={isClickable ? "button" : undefined}
      tabIndex={isClickable ? 0 : undefined}
      className={cn(
        "group relative overflow-hidden rounded-2xl sm:rounded-3xl border bg-card p-3 sm:p-5 transition-all duration-200",
        highlight
          ? "border-primary/40 bg-gradient-to-br from-primary/5 via-card to-card shadow-lg shadow-primary/5"
          : "border-border/70 shadow-sm hover:border-border hover:shadow-md",
        isClickable && "cursor-pointer active:scale-[0.99]",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-2 sm:gap-3">
        <div className="min-w-0 flex-1 space-y-0.5 sm:space-y-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[11px] sm:text-xs font-semibold text-muted-foreground truncate">
              {title}
            </span>
            {badge && (
              <span className="rounded-full bg-primary/15 px-1.5 py-0.2 sm:px-2 sm:py-0.5 text-[9px] sm:text-[10px] font-bold text-primary">
                {badge}
              </span>
            )}
          </div>
          <div className="flex items-baseline gap-1 pt-0.5">
            <span className="text-base sm:text-2xl font-black tracking-tight text-foreground font-mono truncate">
              {typeof value === "number" ? value.toLocaleString("ar-SA") : value}
            </span>
            {currency && (
              <span className="text-[10px] sm:text-xs font-bold text-muted-foreground shrink-0">
                {currency}
              </span>
            )}
          </div>
        </div>

        {icon && (
          <div
            className={cn(
              "grid size-8 sm:size-11 shrink-0 place-items-center rounded-xl sm:rounded-2xl shadow-sm transition-transform duration-200 group-hover:scale-105",
              iconClassName,
            )}
          >
            {React.isValidElement(icon)
              ? React.cloneElement(icon as React.ReactElement<{ className?: string }>, {
                  className: cn("size-4 sm:size-5", (icon.props as any)?.className),
                })
              : typeof icon === "function" ||
                  (typeof icon === "object" && icon !== null && "$$typeof" in icon)
                ? React.createElement(icon as React.ComponentType<{ className?: string }>, {
                    className: "size-4 sm:size-5",
                  })
                : (icon as React.ReactNode)}
          </div>
        )}
      </div>

      {(subtitle || trend) && (
        <div className="mt-2 sm:mt-3 flex items-center justify-between text-xs pt-1.5 sm:pt-2 border-t border-border/40 gap-1">
          {trend ? (
            <div
              className={cn(
                "flex items-center gap-0.5 sm:gap-1 font-bold text-[10px] sm:text-[11px] shrink-0",
                trend.direction === "up" || trend.isPositive === true
                  ? "text-emerald-600 dark:text-emerald-400"
                  : trend.direction === "down" || trend.isPositive === false
                    ? "text-rose-600 dark:text-rose-400"
                    : "text-muted-foreground",
              )}
            >
              {(trend.direction === "up" || trend.isPositive === true) && (
                <TrendingUp className="size-3 sm:size-3.5" />
              )}
              {(trend.direction === "down" || trend.isPositive === false) && (
                <TrendingDown className="size-3 sm:size-3.5" />
              )}
              {trend.direction === "neutral" && <Minus className="size-3 sm:size-3.5" />}
              <span>{trend.value}</span>
              {trend.label && (
                <span className="hidden sm:inline font-normal text-muted-foreground">
                  ({trend.label})
                </span>
              )}
            </div>
          ) : (
            <div />
          )}

          {subtitle && (
            <span className="text-[10px] sm:text-[11px] text-muted-foreground font-medium truncate">
              {subtitle}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

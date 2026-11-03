"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { useCompanyCurrency } from "@/hooks/use-company-currency";

export interface VortexMetricCardProps {
  title?: string;
  label?: string;
  value: string | number;
  subtitle?: string;
  description?: string;
  icon?: React.ReactNode | React.ComponentType<{ className?: string }>;
  iconClassName?: string;
  tone?: "default" | "warning" | "success" | "danger" | "info" | string;
  variant?: "default" | "warning" | "success" | "danger" | "info" | string;
  trend?: {
    value: string | number;
    direction?: "up" | "down" | "neutral";
    isPositive?: boolean;
    label?: string;
  };
  highlight?: boolean;
  currency?: string;
  badge?: string;
  /** كان مستخدماً في شاشة المبيعات عبر الفرع المدموج لكن لم يكن معرَّفاً.
   *  صنف Tailwind لا يمكن بناؤه ديناميكياً، لذا يُطبّق عبر className. */
  gradient?: string;
  className?: string;
  onClick?: () => void;
}

const toneStyles: Record<string, string> = {
  warning: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20",
  success: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20",
  danger: "bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20",
  info: "bg-sky-500/10 text-sky-600 dark:text-sky-400 border border-sky-500/20",
  default: "bg-primary/10 text-primary",
};

export function VortexMetricCard({
  title,
  label,
  value,
  subtitle,
  description,
  icon,
  iconClassName,
  tone,
  variant,
  trend,
  highlight = false,
  currency,
  badge,
  // مقبول للتوافق مع الشاشات القديمة؛视觉效果 يمر عبر tone/variant.
  gradient: _gradient,
  className,
  onClick,
}: VortexMetricCardProps) {
  const { currencySymbol } = useCompanyCurrency();
  const isClickable = Boolean(onClick);
  const displayTitle = title ?? label ?? "";
  const displaySubtitle = subtitle ?? description;
  const appliedTone = tone ?? variant;
  const resolvedIconClass =
    iconClassName || (appliedTone && toneStyles[appliedTone]) || "bg-primary/10 text-primary";

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
              {displayTitle}
            </span>
            {badge && (
              <span className="rounded-full bg-primary/15 px-1.5 py-0.2 sm:px-2 sm:py-0.5 text-[9px] sm:text-[10px] font-bold text-primary">
                {badge}
              </span>
            )}
          </div>
          <div className="flex items-baseline gap-1 pt-0.5">
            <span className="text-base sm:text-2xl font-black tracking-tight text-foreground font-mono truncate">
              {typeof value === "number" ? value.toLocaleString("ar-YE") : value}
            </span>
            {(currency ?? currencySymbol) && (
              <span className="text-[10px] sm:text-xs font-bold text-muted-foreground shrink-0">
                {currency ?? currencySymbol}
              </span>
            )}
          </div>
        </div>

        {icon && (
          <div
            className={cn(
              "grid size-8 sm:size-11 shrink-0 place-items-center rounded-xl sm:rounded-2xl shadow-sm transition-transform duration-200 group-hover:scale-105",
              resolvedIconClass,
            )}
          >
            {React.isValidElement(icon)
              ? React.cloneElement(icon as React.ReactElement<{ className?: string }>, {
                  className: cn("size-4 sm:size-5", (icon.props as any)?.className),
                })
              : typeof icon === "function" ||
                  (typeof icon === "object" && icon !== null && "$$typeof" in icon)
                ? React.createElement(
                    icon as unknown as React.ComponentType<{ className?: string }>,
                    {
                      className: "size-4 sm:size-5",
                    },
                  )
                : (icon as React.ReactNode)}
          </div>
        )}
      </div>

      {(displaySubtitle || trend) && (
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

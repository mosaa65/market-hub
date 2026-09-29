"use client";

import * as React from "react";
import { Filter, RotateCcw, Check } from "lucide-react";
import { VortexDrawerDialog } from "./vortex-drawer-dialog";

export interface FilterSectionProps {
  id?: string;
  title: string;
  icon?: React.ReactNode;
  description?: string;
  children: React.ReactNode;
}

export function VortexFilterSection({
  title,
  icon,
  description,
  children,
}: FilterSectionProps) {
  return (
    <div className="space-y-2.5 pb-4 border-b border-border/60 last:border-b-0 last:pb-0">
      <div className="flex items-center justify-between">
        <label className="flex items-center gap-2 text-xs font-bold text-foreground">
          {icon && <span className="text-primary">{icon}</span>}
          <span>{title}</span>
        </label>
        {description && (
          <span className="text-[11px] text-muted-foreground">{description}</span>
        )}
      </div>
      <div>{children}</div>
    </div>
  );
}

export interface VortexFilterSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
  subtitle?: string;
  activeCount?: number;
  activeFiltersCount?: number;
  children: React.ReactNode;
  onApply?: () => void;
  onReset?: () => void;
  applyLabel?: string;
  resetLabel?: string;
  className?: string;
}

export function VortexFilterSheet({
  open,
  onOpenChange,
  title = "التصفية والفلاتر المتقدمة",
  subtitle = "تخصيص وترتيب البيانات بدقة عالية",
  activeCount,
  activeFiltersCount,
  children,
  onApply,
  onReset,
  applyLabel = "تطبيق الفلترة",
  resetLabel = "إعادة ضبط",
  className,
}: VortexFilterSheetProps) {
  const effectiveCount = activeFiltersCount ?? activeCount ?? 0;
  return (
    <VortexDrawerDialog
      open={open}
      onOpenChange={onOpenChange}
      size="md"
      className={className}
      icon={
        <div className="relative grid size-10 place-items-center rounded-2xl bg-foreground text-background shadow-md shadow-foreground/10">
          <Filter className="size-5" />
          {effectiveCount > 0 && (
            <span className="absolute -top-1 -left-1 flex size-5 items-center justify-center rounded-full bg-primary text-[10px] font-black text-primary-foreground ring-2 ring-background">
              {effectiveCount}
            </span>
          )}
        </div>
      }
      title={
        <div className="flex items-center gap-2">
          <span className="font-bold text-base sm:text-lg">{title}</span>
          {effectiveCount > 0 && (
            <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-semibold text-primary border border-primary/20">
              {effectiveCount} مفعل
            </span>
          )}
        </div>
      }
      subtitle={subtitle}
      footer={
        <div className="flex items-center gap-2 w-full pt-2">
          <button
            type="button"
            onClick={() => {
              onApply?.();
              onOpenChange(false);
            }}
            className="flex-1 h-12 rounded-2xl bg-foreground text-background font-bold text-xs sm:text-sm flex items-center justify-center gap-2 shadow-lg shadow-foreground/15 hover:opacity-95 active:scale-[0.98] transition cursor-pointer"
          >
            <Check className="size-4 text-primary" />
            <span>{applyLabel}</span>
          </button>
          <button
            type="button"
            onClick={() => {
              onReset?.();
              onOpenChange(false);
            }}
            className="h-12 px-4 rounded-2xl bg-muted/80 text-muted-foreground hover:text-foreground font-bold text-xs sm:text-sm flex items-center gap-1.5 transition active:scale-[0.98] cursor-pointer"
          >
            <RotateCcw className="size-3.5" />
            <span>{resetLabel}</span>
          </button>
        </div>
      }
    >
      <div className="space-y-5 py-2">{children}</div>
    </VortexDrawerDialog>
  );
}

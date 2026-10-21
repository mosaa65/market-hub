"use client";

import * as React from "react";
import { Filter, RotateCcw, Check } from "lucide-react";
import { VortexDrawerDialog } from "./vortex-drawer-dialog";
import { cn } from "@/lib/utils";

export interface FilterSectionProps {
  id?: string;
  title: string;
  icon?: React.ReactNode;
  description?: string;
  children: React.ReactNode;
}

export function VortexFilterSection({ title, icon, description, children }: FilterSectionProps) {
  return (
    <div className="space-y-2.5 pb-4 border-b border-border/60 last:border-b-0 last:pb-0">
      <div className="flex items-center justify-between">
        <label className="flex items-center gap-2.5 text-xs font-bold text-foreground">
          {icon && (
            <span className="flex size-8 shrink-0 aspect-square items-center justify-center rounded-full border border-border/80 bg-primary/10 text-primary [&_svg]:size-4">
              {icon}
            </span>
          )}
          <span>{title}</span>
        </label>
        {description && <span className="text-[11px] text-muted-foreground">{description}</span>}
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
  lang?: string;
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
  lang,
  className,
}: VortexFilterSheetProps) {
  const effectiveCount = activeFiltersCount ?? activeCount ?? 0;

  /* المحور 13 — التوزيع الذكي (Masonry / column-fill: balance):
   * * أعمدة CSS متعددة: تُرصّ الفلاتر عمودياً ثم **توازن** أطوال الأعمدة تلقائياً،
   *   فمثلاً 5 فلاتر => عمود فيه 3 وآخر فيه 2 حسب الطول الفعلي لكل فلتر،
   *   وليس تقسيماً جامداً (3 في صف وفلتر يتيم في صف آخر).
   * * 1 فلتر => عمود واحد فقط (لا يتوهم عمودين).
   * * كل فلتر يملأ عرض عموده كاملاً (w-full break-inside-avoid).
   * * الجوال: عمود واحد دائماً — كما هو دون أي تغيير.
   */
  const fieldCount = React.Children.toArray(children).length;
  const useMasonry = fieldCount > 1;

  return (
    <VortexDrawerDialog
      open={open}
      onOpenChange={onOpenChange}
      size="md"
      className={className}
      /* المحور 10: على الابتوب تنزلق اللوحة أنيقاً من يسار الشاشة لتوفير المساحة؛
       * الجوال يبقى Bottom Sheet كما هو دون أي تغيير. */
      desktopSide="left"
      icon={
        <div className="relative flex size-full items-center justify-center">
          <Filter className="size-4.5" />
          {effectiveCount > 0 && (
            <span className="absolute -top-1.5 -end-1.5 flex size-4.5 items-center justify-center rounded-full bg-primary text-[9px] font-black text-primary-foreground ring-2 ring-background">
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
      <div
        className={cn(
          useMasonry
            ? "columns-1 gap-x-5 [column-fill:balance] sm:columns-2 [&>*]:mb-4 [&>*]:w-full [&>*]:break-inside-avoid"
            : "space-y-2",
          "py-2",
        )}
      >
        {children}
      </div>
    </VortexDrawerDialog>
  );
}

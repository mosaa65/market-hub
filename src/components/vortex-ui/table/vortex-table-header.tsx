import * as React from "react";
import { Filter, ArrowUpDown, RefreshCw, Plus, Download, SlidersHorizontal, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { VortexSearchInput } from "@/components/vortex-ui/inputs/vortex-search-input";

export interface VortexTableHeaderProps {
  title?: string;
  subtitle?: string;
  searchValue: string;
  onSearchChange: (value: string) => void;
  searchPlaceholder?: string;
  isSearching?: boolean;
  totalCount?: number;
  activeFiltersCount?: number;
  onOpenFilters?: () => void;
  onClearFilters?: () => void;
  onRefresh?: () => void;
  isRefreshing?: boolean;
  onAddNew?: () => void;
  addNewLabel?: string;
  onExport?: () => void;
  extraActions?: React.ReactNode;
  className?: string;
}

export function VortexTableHeader({
  title,
  subtitle,
  searchValue,
  onSearchChange,
  searchPlaceholder = "بحث سريع...",
  isSearching = false,
  totalCount,
  activeFiltersCount = 0,
  onOpenFilters,
  onClearFilters,
  onRefresh,
  isRefreshing = false,
  onAddNew,
  addNewLabel = "إضافة جديد",
  onExport,
  extraActions,
  className,
}: VortexTableHeaderProps) {
  return (
    <div className={cn("flex flex-col gap-3 rounded-2xl border border-border/60 bg-surface/40 p-3.5 backdrop-blur-md shadow-xs sm:p-4", className)}>
      {/* Title & Primary Actions Row (if title supplied) */}
      {(title || onAddNew || extraActions) && (
        <div className="flex flex-wrap items-center justify-between gap-2.5">
          {title && (
            <div className="flex items-center gap-2.5">
              <h2 className="text-base font-semibold text-foreground sm:text-lg">{title}</h2>
              {totalCount !== undefined && (
                <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary tabular-nums">
                  {totalCount}
                </span>
              )}
              {subtitle && <span className="hidden text-xs text-muted-foreground md:inline-block">{subtitle}</span>}
            </div>
          )}

          <div className="flex items-center gap-2 ms-auto">
            {extraActions}
            {onExport && (
              <Button
                variant="outline"
                size="sm"
                onClick={onExport}
                className="gap-1.5 rounded-full border-border/80 text-xs font-medium shadow-2xs hover:bg-surface-2"
              >
                <Download className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="hidden sm:inline">تصدير</span>
              </Button>
            )}
            {onAddNew && (
              <Button
                size="sm"
                onClick={onAddNew}
                className="gap-1.5 rounded-full bg-primary text-xs font-semibold text-primary-foreground shadow-sm hover:bg-primary/90"
              >
                <Plus className="h-4 w-4" />
                <span>{addNewLabel}</span>
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Search & Filters Row */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5">
        <div className="flex-1 min-w-[220px] max-w-full sm:max-w-md">
          <VortexSearchInput
            value={searchValue}
            onValueChange={onSearchChange}
            placeholder={searchPlaceholder}
            loading={isSearching}
            resultCount={totalCount}
            size="md"
          />
        </div>

        <div className="flex items-center gap-2 overflow-x-auto pb-1 sm:pb-0">
          {onOpenFilters && (
            <Button
              variant={activeFiltersCount > 0 ? "secondary" : "outline"}
              size="sm"
              onClick={onOpenFilters}
              className={cn(
                "gap-1.5 rounded-full text-xs font-medium border-border/80 shadow-2xs transition-all",
                activeFiltersCount > 0 && "border-primary/40 bg-primary/10 text-primary font-semibold hover:bg-primary/20",
              )}
            >
              <SlidersHorizontal className="h-3.5 w-3.5" />
              <span>تصفية</span>
              {activeFiltersCount > 0 && (
                <span className="flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[10px] text-primary-foreground font-bold">
                  {activeFiltersCount}
                </span>
              )}
            </Button>
          )}

          {activeFiltersCount > 0 && onClearFilters && (
            <button
              type="button"
              onClick={onClearFilters}
              className="flex items-center gap-1 rounded-full px-2 py-1 text-xs text-muted-foreground hover:bg-surface-2 hover:text-foreground transition-colors"
              title="إعادة تعيين الفلاتر"
            >
              <X className="h-3.5 w-3.5" />
              <span>مسح الكل</span>
            </button>
          )}

          {onRefresh && (
            <Button
              variant="outline"
              size="icon"
              onClick={onRefresh}
              disabled={isRefreshing}
              className="h-8 w-8 rounded-full border-border/80 text-muted-foreground hover:text-foreground shadow-2xs"
              title="تحديث البيانات"
            >
              <RefreshCw className={cn("h-3.5 w-3.5", isRefreshing && "animate-spin text-primary")} />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

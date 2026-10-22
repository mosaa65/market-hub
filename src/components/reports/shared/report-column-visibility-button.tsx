import React, { useState } from "react";
import { SlidersHorizontal, CheckSquare, Square, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import type { ReportColumnDefinition } from "@/lib/reports/types";

export interface ReportColumnVisibilityButtonProps {
  columns?: ReportColumnDefinition[];
  columnVisibility?: Record<string, boolean>;
  onChangeVisibility?: (visibility: Record<string, boolean>) => void;
  onResetVisibility?: () => void;
  visibleCount?: number;
  totalCount?: number;
  className?: string;
  size?: "sm" | "default";
  onClick?: () => void;
}

export function ReportColumnVisibilityButton({
  columns,
  columnVisibility = {},
  onChangeVisibility,
  onResetVisibility,
  onClick,
  visibleCount,
  totalCount,
  className,
}: ReportColumnVisibilityButtonProps) {
  const [isOpen, setIsOpen] = useState(false);

  const effectiveTotalCount = totalCount !== undefined ? totalCount : columns?.length;
  const effectiveVisibleCount =
    visibleCount !== undefined
      ? visibleCount
      : columns
        ? columns.filter((c) =>
            columnVisibility[c.key] !== undefined
              ? columnVisibility[c.key]
              : c.defaultVisible !== false,
          ).length
        : undefined;

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsOpen(true);
    if (onClick) {
      onClick();
    }
  };

  const handleToggleColumn = (col: ReportColumnDefinition) => {
    if (col.essential) return;
    const currentVal =
      columnVisibility[col.key] !== undefined
        ? columnVisibility[col.key]
        : col.defaultVisible !== false;
    const newVal = !currentVal;
    if (onChangeVisibility) {
      onChangeVisibility({
        ...columnVisibility,
        [col.key]: newVal,
      });
    }
  };

  const handleReset = () => {
    if (onResetVisibility) {
      onResetVisibility();
    } else if (onChangeVisibility && columns) {
      const resetMap: Record<string, boolean> = {};
      columns.forEach((col) => {
        resetMap[col.key] = col.essential ? true : col.defaultVisible !== false;
      });
      onChangeVisibility(resetMap);
    }
  };

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={handleClick}
        className={`h-8 gap-1.5 border-border bg-card px-2.5 text-xs font-semibold text-foreground hover:bg-muted shadow-xs transition-colors ${className || ""}`}
        title="تخصيص الأعمدة المعروضة وإخفائها"
      >
        <SlidersHorizontal className="h-3.5 w-3.5 text-primary" />
        <span>الأعمدة</span>
        {effectiveVisibleCount !== undefined && (
          <Badge
            variant="secondary"
            className="h-4 min-w-4 px-1 text-[10px] font-mono bg-muted text-muted-foreground"
          >
            {effectiveTotalCount !== undefined
              ? `${effectiveVisibleCount}/${effectiveTotalCount}`
              : effectiveVisibleCount}
          </Badge>
        )}
      </Button>

      {columns && columns.length > 0 && (
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
          <DialogContent className="max-w-md p-4 text-xs">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-sm font-bold text-foreground">
                <SlidersHorizontal className="h-4 w-4 text-primary" />
                تخصيص الأعمدة المعروضة في التقرير
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground">
                حدد الأعمدة التي ترغب في إظهارها أو إخفائها من جدول التقرير.
              </DialogDescription>
            </DialogHeader>

            <div className="max-h-72 overflow-y-auto space-y-1 py-2 divide-y divide-border/40">
              {columns.map((col) => {
                const isVisible =
                  columnVisibility[col.key] !== undefined
                    ? columnVisibility[col.key]
                    : col.defaultVisible !== false;
                const isEssential = Boolean(col.essential);

                return (
                  <div
                    key={col.key}
                    onClick={() => handleToggleColumn(col)}
                    className={`flex items-center justify-between p-2.5 rounded-lg transition-colors select-none ${
                      isEssential
                        ? "bg-muted/40 opacity-70 cursor-not-allowed"
                        : "hover:bg-muted/80 cursor-pointer"
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      {isVisible ? (
                        <CheckSquare className="h-4 w-4 text-primary shrink-0" />
                      ) : (
                        <Square className="h-4 w-4 text-muted-foreground shrink-0" />
                      )}
                      <span className="font-medium text-foreground">
                        {col.labelAr || col.labelEn}
                      </span>
                    </div>
                    {isEssential ? (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-semibold">
                        أساسي
                      </span>
                    ) : (
                      <span className="text-[10px] font-mono text-muted-foreground">
                        {isVisible ? "معروض" : "مخفي"}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>

            <DialogFooter className="flex items-center justify-between gap-2 border-t border-border pt-3">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleReset}
                className="h-8 text-xs gap-1.5"
              >
                <RotateCcw className="h-3 w-3" />
                استعادة الافتراضي
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={() => setIsOpen(false)}
                className="h-8 text-xs font-semibold px-5"
              >
                إغلاق وحفظ
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}

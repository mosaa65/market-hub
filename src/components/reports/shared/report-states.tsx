import React from "react";
import { AlertCircle, FileSearch, RotateCcw, InboxIcon, SearchX } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ReportEmptyStateProps {
  title?: string;
  description?: string;
  onResetFilters?: () => void;
  context?: {
    hasAnyFilters?: boolean;
    hasRequiredFilter?: boolean;
    requiredFilterLabel?: string;
    isInitialLoad?: boolean;
  };
}

export function ReportEmptyState({
  title,
  description,
  onResetFilters,
  context,
}: ReportEmptyStateProps) {
  let displayTitle = title;
  let displayDescription = description;
  let Icon = FileSearch;

  if (context?.hasRequiredFilter === false && context?.requiredFilterLabel) {
    displayTitle = `يجب تحديد ${context.requiredFilterLabel} أولاً`;
    displayDescription = `هذا التقرير يتطلب اختيار ${context.requiredFilterLabel} لعرض وتتبع البيانات بدقة.`;
    Icon = AlertCircle;
  } else if (context && !context.hasAnyFilters) {
    displayTitle = displayTitle || "لا توجد سجلات مسجلة بعد في هذه الفترة";
    displayDescription = displayDescription || "قم بإدخال الفواتير والعمليات لتظهر في تحليلات التقرير تلقائياً.";
    Icon = InboxIcon;
  } else {
    displayTitle = displayTitle || "لا توجد بيانات تطابق الفلاتر المحددة";
    displayDescription = displayDescription || "جرّب توسيع النطاق الزمني أو تفريغ الفلاتر للبحث عن سجلات أخرى.";
    Icon = SearchX;
  }

  return (
    <div className="flex flex-col items-center justify-center p-12 text-center bg-slate-900/40 rounded-2xl border border-cyan-500/20 m-2">
      <div className="rounded-full bg-cyan-500/10 p-3.5 text-cyan-400 mb-3 border border-cyan-500/20 shadow-inner">
        <Icon className="h-6 w-6" />
      </div>
      <h3 className="text-sm font-bold text-foreground">{displayTitle}</h3>
      <p className="mt-1.5 text-xs text-muted-foreground max-w-sm">{displayDescription}</p>
      {onResetFilters && (
        <Button
          variant="outline"
          size="sm"
          onClick={onResetFilters}
          className="mt-4 gap-1.5 text-xs border-cyan-500/30 text-cyan-300 hover:bg-cyan-500/10"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          تفريغ وإعادة ضبط الفلاتر
        </Button>
      )}
    </div>
  );
}

interface ReportErrorStateProps {
  error: string;
  onRetry?: () => void;
}

export function ReportErrorState({ error, onRetry }: ReportErrorStateProps) {
  return (
    <div className="flex flex-col items-center justify-center p-12 text-center bg-destructive/5 border border-destructive/20 rounded-2xl m-2">
      <div className="rounded-full bg-destructive/10 p-3.5 text-destructive mb-3">
        <AlertCircle className="h-6 w-6" />
      </div>
      <h3 className="text-sm font-bold text-destructive">تعذر تحميل بيانات التقرير</h3>
      <p className="mt-1 text-xs text-muted-foreground max-w-md font-mono">{error}</p>
      {onRetry && (
        <Button
          variant="outline"
          size="sm"
          onClick={onRetry}
          className="mt-4 gap-1.5 text-xs border-destructive/40 hover:bg-destructive/10"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          إعادة المحاولة
        </Button>
      )}
    </div>
  );
}

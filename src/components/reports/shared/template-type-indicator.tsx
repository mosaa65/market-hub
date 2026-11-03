import React from "react";
import { Table2, Layers, BarChart3, Sparkles } from "lucide-react";
import type { ReportViewTemplateType } from "@/lib/reports/types";

export interface TemplateTypeIndicatorProps {
  currentView?: ReportViewTemplateType;
  onViewChange?: (view: ReportViewTemplateType) => void;
  isCustomMultiMethod?: boolean;
  className?: string;
}

export function TemplateTypeIndicator({
  currentView = "detailed_table",
  onViewChange,
  isCustomMultiMethod = false,
  className,
}: TemplateTypeIndicatorProps) {
  // توحيد نمط العرض إلى أحد القوالب الثلاثة
  const normalizedCurrent =
    currentView === "chart"
      ? "chart"
      : currentView === "grouped" || currentView === "grouped_ranking"
        ? "grouped"
        : "detailed_table";

  const items: {
    id: "detailed_table" | "grouped" | "chart";
    icon: React.ComponentType<{ className?: string }>;
    label: string;
    isGroupedCustom?: boolean;
  }[] = [
    {
      id: "detailed_table",
      icon: Table2,
      label: "قالب الجدول التفصيلي",
    },
    {
      id: "grouped",
      icon: Layers,
      label: isCustomMultiMethod ? "قالب تجميعي مخصص (متعدد الطرق)" : "قالب التجميع والتحليل",
      isGroupedCustom: isCustomMultiMethod,
    },
    {
      id: "chart",
      icon: BarChart3,
      label: "قالب الرسم البياني والمؤشرات",
    },
  ];

  return (
    <div
      className={`inline-flex items-center gap-1 rounded-lg border border-border bg-card p-0.5 shadow-2xs ${className || ""}`}
      role="group"
      aria-label="قوالب عرض التقارير"
    >
      {items.map((item) => {
        const isActive = normalizedCurrent === item.id;
        const Icon = item.icon;

        // تمييز أيقونة قالب التجميع عندما يكون قالباً مخصصاً متعدد الطرق
        const isDistinguishedCustom = item.id === "grouped" && item.isGroupedCustom;

        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onViewChange?.(item.id)}
            title={item.label}
            className={`relative flex h-7 w-7 items-center justify-center rounded-md transition-all duration-150 ${
              isActive
                ? isDistinguishedCustom
                  ? "bg-amber-500/20 text-amber-600 dark:text-amber-400 ring-1.5 ring-amber-500/60 font-bold shadow-xs scale-105"
                  : "bg-primary text-primary-foreground font-bold shadow-xs scale-105"
                : isDistinguishedCustom
                  ? "bg-amber-500/10 text-amber-600 dark:text-amber-400 hover:bg-amber-500/20 ring-1 ring-amber-500/30"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
          >
            <Icon className="h-3.5 w-3.5" />

            {/* تمييز بصري ظاهر لأيقونة التجميع المخصصة متعددة الطرق */}
            {isDistinguishedCustom && (
              <>
                <span className="absolute -top-0.5 -right-0.5 flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-500" />
                </span>
                <Sparkles className="absolute -bottom-0.5 -left-0.5 h-2 w-2 text-amber-500 pointer-events-none" />
              </>
            )}
          </button>
        );
      })}
    </div>
  );
}

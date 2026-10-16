import React, { useState, useEffect } from "react";
import type { ReportDefinition, ReportViewTemplateType } from "@/lib/reports/types";
import { DetailedTableTemplate } from "./templates/detailed-table-template";
import { GroupedRankingTemplate } from "./templates/grouped-ranking-template";
import { ChartReportTemplate } from "./templates/chart-report-template";

interface ReportTemplateRendererProps {
  definition: ReportDefinition;
  onSelectReport?: (reportId: string) => void;
  activeView?: ReportViewTemplateType;
  onViewChange?: (view: ReportViewTemplateType) => void;
}

/**
 * نقطة العرض المركزية للتقارير:
 * تدعم 3 قوالب عرض رئيسية فقط:
 * 1. قالب الجدول التفصيلي (detailed_table)
 * 2. قالب التجميع (grouped / grouped_ranking)
 * 3. قالب الرسم البياني (chart)
 * مع إمكانية التبديل اللحظي بينها عبر الأيقونات المصغرة،
 * وتمييز القوالب التجميعية المخصصة متعددة الطرق.
 */
export function ReportTemplateRenderer({
  definition,
  onSelectReport,
  activeView: controlledActiveView,
  onViewChange: controlledOnViewChange,
}: ReportTemplateRendererProps) {
  // تحديد القالب المبدئي من تعريف التقرير
  const getInitialView = (def: ReportDefinition): "detailed_table" | "grouped" | "chart" => {
    if (def.viewTemplate === "chart") return "chart";
    if (def.viewTemplate === "grouped" || def.viewTemplate === "grouped_ranking") {
      return "grouped";
    }
    // القوالب المخصصة تعتبر قوالب تجميعية متعددة الطرق
    if ((def as any).isCustomMultiMethod || def.id.startsWith("custom-")) {
      return "grouped";
    }
    return "detailed_table";
  };

  const [internalView, setInternalView] = useState<"detailed_table" | "grouped" | "chart">(() =>
    getInitialView(definition),
  );

  // تحديث القالب المختار عند تغيير التقرير
  useEffect(() => {
    setInternalView(getInitialView(definition));
  }, [definition.id, definition.viewTemplate]);

  const currentView = controlledActiveView || internalView;
  const handleViewChange = (newView: ReportViewTemplateType) => {
    const normalized: "detailed_table" | "grouped" | "chart" =
      newView === "chart"
        ? "chart"
        : newView === "grouped" || newView === "grouped_ranking"
          ? "grouped"
          : "detailed_table";

    setInternalView(normalized);
    controlledOnViewChange?.(normalized);
  };

  const isCustomMultiMethod = Boolean(
    (definition as any).isCustomMultiMethod ||
      definition.id.startsWith("custom-") ||
      (definition as any).customGroupBy,
  );

  switch (currentView) {
    case "grouped":
    case "grouped_ranking":
      return (
        <GroupedRankingTemplate
          definition={definition}
          onSelectReport={onSelectReport}
          currentView="grouped"
          onViewChange={handleViewChange}
          isCustomMultiMethod={isCustomMultiMethod}
        />
      );

    case "chart":
      return (
        <ChartReportTemplate
          definition={definition}
          onSelectReport={onSelectReport}
          currentView="chart"
          onViewChange={handleViewChange}
          isCustomMultiMethod={isCustomMultiMethod}
        />
      );

    case "detailed_table":
    default:
      return (
        <DetailedTableTemplate
          definition={definition}
          onSelectReport={onSelectReport}
          currentView="detailed_table"
          onViewChange={handleViewChange}
          isCustomMultiMethod={isCustomMultiMethod}
        />
      );
  }
}

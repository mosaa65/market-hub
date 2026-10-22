/**
 * Vortex ERP — مجمع مكونات وقوالب عرض التقارير والكشوفات
 * القوالب الثلاثة المعتمدة:
 * 1. قالب الجدول التفصيلي (detailed-table-template)
 * 2. قالب التجميع (grouped-ranking-template)
 * 3. قالب الرسم البياني (chart-report-template)
 */

export * from "./shared/report-header";
export * from "./shared/report-summary-deck";
export * from "./shared/report-filters-bar";
export * from "./shared/report-data-table";
export * from "./shared/report-pagination";
export * from "./shared/report-states";
export * from "./shared/domain-report-shell";
export * from "./shared/use-domain-report-selection";
export * from "./shared/template-type-indicator";
export * from "./shared/report-view-controls-bar";
export * from "./shared/report-template-selector";
export * from "./shared/report-template-creator-dialog";
export * from "./shared/report-column-visibility-button";

// القوالب الثلاثة المعتمدة
export * from "./templates/detailed-table-template";
export * from "./templates/grouped-ranking-template";
export * from "./templates/chart-report-template";

export * from "./report-template-renderer";

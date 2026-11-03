import React from "react";
import { createFileRoute } from "@tanstack/react-router";
import { ModuleGuard } from "@/lib/modules";
import { DomainReportShell } from "@/components/reports/shared/domain-report-shell";
import { ReportTemplateRenderer } from "@/components/reports/report-template-renderer";
import { ReportRegistry, REPORT_SUPPLIERS_PAYABLES } from "@/lib/reports/registry";
import { useDomainReportSelection } from "@/components/reports/shared/use-domain-report-selection";

export const Route = createFileRoute("/_app/reports/suppliers")({
  head: () => ({
    meta: [{ title: "تقارير الموردين والالتزامات التشغيلية — Vortex ERP" }],
  }),
  component: () => (
    <ModuleGuard moduleId="analytics">
      <ReportsSuppliersPage />
    </ModuleGuard>
  ),
});

function ReportsSuppliersPage() {
  const { activeReportId, selectReport } = useDomainReportSelection(
    "suppliers",
    "rep-suppliers-payables",
  );
  const reportDef = ReportRegistry.get(activeReportId) || REPORT_SUPPLIERS_PAYABLES;

  return (
    <DomainReportShell
      currentDomain="suppliers"
      activeReportId={activeReportId}
      onSelectReport={selectReport}
    >
      <ReportTemplateRenderer definition={reportDef} onSelectReport={selectReport} />
    </DomainReportShell>
  );
}

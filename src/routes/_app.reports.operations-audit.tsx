import React from "react";
import { createFileRoute } from "@tanstack/react-router";
import { ModuleGuard } from "@/lib/modules";
import { DomainReportShell } from "@/components/reports/shared/domain-report-shell";
import { ReportTemplateRenderer } from "@/components/reports/report-template-renderer";
import { ReportRegistry, REPORT_OPERATIONS_DAILY_AUDIT } from "@/lib/reports/registry";
import { useDomainReportSelection } from "@/components/reports/shared/use-domain-report-selection";

export const Route = createFileRoute("/_app/reports/operations-audit")({
  head: () => ({
    meta: [{ title: "تقارير الرقابة والعمليات اليومية — Vortex ERP" }],
  }),
  component: () => (
    <ModuleGuard moduleId="analytics">
      <ReportsOperationsAuditPage />
    </ModuleGuard>
  ),
});

function ReportsOperationsAuditPage() {
  const { activeReportId, selectReport } = useDomainReportSelection(
    "operations_audit",
    "rep-operations-daily-audit",
  );
  const reportDef = ReportRegistry.get(activeReportId) || REPORT_OPERATIONS_DAILY_AUDIT;

  return (
    <DomainReportShell
      currentDomain="operations_audit"
      activeReportId={activeReportId}
      onSelectReport={selectReport}
    >
      <ReportTemplateRenderer definition={reportDef} onSelectReport={selectReport} />
    </DomainReportShell>
  );
}

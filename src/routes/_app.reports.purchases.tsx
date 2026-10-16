import React from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { ModuleGuard } from '@/lib/modules';
import { DomainReportShell } from '@/components/reports/shared/domain-report-shell';
import { ReportTemplateRenderer } from '@/components/reports/report-template-renderer';
import { ReportRegistry, REPORT_PURCHASES_REGISTER } from '@/lib/reports/registry';
import { useDomainReportSelection } from '@/components/reports/shared/use-domain-report-selection';

export const Route = createFileRoute('/_app/reports/purchases')({
  head: () => ({
    meta: [{ title: 'تقارير المشتريات والتوريد — Vortex ERP' }],
  }),
  component: () => (
    <ModuleGuard moduleId="analytics">
      <ReportsPurchasesPage />
    </ModuleGuard>
  ),
});

function ReportsPurchasesPage() {
  const { activeReportId, selectReport } = useDomainReportSelection('purchases', 'rep-purchases-register');
  const reportDef = ReportRegistry.get(activeReportId) || REPORT_PURCHASES_REGISTER;

  return (
    <DomainReportShell
      currentDomain="purchases"
      activeReportId={activeReportId}
      onSelectReport={selectReport}
    >
      <ReportTemplateRenderer definition={reportDef} onSelectReport={selectReport} />
    </DomainReportShell>
  );
}

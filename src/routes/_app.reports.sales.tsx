import React from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { ModuleGuard } from '@/lib/modules';
import { DomainReportShell } from '@/components/reports/shared/domain-report-shell';
import { ReportTemplateRenderer } from '@/components/reports/report-template-renderer';
import { ReportRegistry, REPORT_SALES_PRODUCT } from '@/lib/reports/registry';
import { useDomainReportSelection } from '@/components/reports/shared/use-domain-report-selection';

export const Route = createFileRoute('/_app/reports/sales')({
  head: () => ({
    meta: [{ title: 'تقارير المبيعات ونقاط البيع — Vortex ERP' }],
  }),
  component: () => (
    <ModuleGuard moduleId="analytics">
      <ReportsSalesPage />
    </ModuleGuard>
  ),
});

function ReportsSalesPage() {
  const { activeReportId, selectReport } = useDomainReportSelection('sales', 'rep-sales-product');
  const reportDef = ReportRegistry.get(activeReportId) || REPORT_SALES_PRODUCT;

  return (
    <DomainReportShell
      currentDomain="sales"
      activeReportId={activeReportId}
      onSelectReport={selectReport}
    >
      <ReportTemplateRenderer definition={reportDef} onSelectReport={selectReport} />
    </DomainReportShell>
  );
}

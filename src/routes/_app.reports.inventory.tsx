import React from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { ModuleGuard } from '@/lib/modules';
import { DomainReportShell } from '@/components/reports/shared/domain-report-shell';
import { ReportTemplateRenderer } from '@/components/reports/report-template-renderer';
import { ReportRegistry, REPORT_INVENTORY_ITEM_CARD } from '@/lib/reports/registry';
import { useDomainReportSelection } from '@/components/reports/shared/use-domain-report-selection';

export const Route = createFileRoute('/_app/reports/inventory')({
  head: () => ({
    meta: [{ title: 'تقارير المخزون وحركة الأصناف — Vortex ERP' }],
  }),
  component: () => (
    <ModuleGuard moduleId="analytics">
      <ReportsInventoryPage />
    </ModuleGuard>
  ),
});

function ReportsInventoryPage() {
  const { activeReportId, selectReport } = useDomainReportSelection('inventory', 'rep-inventory-item-card');
  const reportDef = ReportRegistry.get(activeReportId) || REPORT_INVENTORY_ITEM_CARD;

  return (
    <DomainReportShell
      currentDomain="inventory"
      activeReportId={activeReportId}
      onSelectReport={selectReport}
    >
      <ReportTemplateRenderer definition={reportDef} onSelectReport={selectReport} />
    </DomainReportShell>
  );
}

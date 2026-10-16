/**
 * Vortex ERP — جسر تكامل أعمدة التقارير (Column Registry Bridge)
 * المرحلة 3: REP-014
 *
 * يربط تعريفات أعمدة التقارير بنظام ColumnRegistry المعتمد في المشروع،
 * لتمكين المستخدم من تخصيص الأعمدة، إخفائها، وحفظ التفضيلات تلقائياً.
 */

import type { ColumnDefinition, ColumnRegistry } from '@/lib/records/column-registry';
import type { ReportColumnDefinition } from '../types';

export function createReportColumnRegistry(
  reportId: string,
  columns: ReportColumnDefinition[]
): ColumnRegistry {
  const genericColumns: ColumnDefinition[] = columns.map((col) => ({
    key: col.key,
    labelAr: col.labelAr,
    labelEn: col.labelEn,
    essential: col.essential ?? false,
    defaultVisible: col.defaultVisible,
    groupAr: col.groupAr,
    groupEn: col.groupEn,
  }));

  return {
    id: `report:${reportId}`,
    columns: genericColumns,
  };
}

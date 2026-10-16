/**
 * Vortex ERP — عقود محركات التصدير والطباعة (Export & Print Contracts)
 * المرحلة 6 و 7
 */

import type { ReportDefinition } from '../types';

export interface ReportExportPayload {
  definition: ReportDefinition;
  rows: Record<string, any>[];
  metrics: Record<string, number>;
  appliedFilters: Record<string, any>;
  costBasisNotice?: 'ACTUAL' | 'REFERENCE_ONLY' | 'MIXED';
  currencySymbol?: string;
  dateRangeText?: string;
  titleAr?: string;
  comparison?: {
    metricLabelAr: string;
    currentValue: number;
    previousValue: number;
    absoluteDelta: number;
    percentChange: number | null;
  };
}

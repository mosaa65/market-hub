/**
 * Vortex ERP — عقود مزودات بيانات التقارير (Data Providers Contracts)
 * المرحلة 2: REP-007
 */

export interface ReportPaginationRequest {
  page: number;      // 1-indexed
  pageSize: number;  // عدد الصفوف في الصفحة (افتراضي 25 أو 50)
}

export interface ReportSortRequest {
  field: string;
  order: 'asc' | 'desc';
}

export interface ReportExecutionRequest<TFilter = Record<string, unknown>> {
  reportId: string;
  filters: TFilter;
  pagination?: ReportPaginationRequest;
  sort?: ReportSortRequest;
}

export interface ReportExecutionResult<TRow = Record<string, unknown>> {
  reportId: string;
  executedAt: string;
  totalRowCount: number;
  rows: TRow[];
  metrics: Record<string, number>;
  meta: {
    appliedFilters: Record<string, unknown>;
    costBasisNotice?: 'ACTUAL' | 'REFERENCE_ONLY' | 'MIXED';
    currencySymbol: string;
    page?: number;
    pageSize?: number;
    totalPages?: number;
  };
}

export interface IDataProvider<TFilter = Record<string, unknown>, TRow = Record<string, unknown>> {
  id: string;
  dataSourceName: string;
  execute(request: ReportExecutionRequest<TFilter>): Promise<ReportExecutionResult<TRow>>;
}

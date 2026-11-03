import { useState, useMemo, useEffect } from "react";
import type { ReportDefinition, ReportViewTemplateType } from "@/lib/reports/types";
import { SalesRegisterDataProvider } from "@/lib/reports/data-providers/sales-register";
import { PurchaseRegisterDataProvider } from "@/lib/reports/data-providers/purchase-register";
import { ReportHeader } from "../shared/report-header";
import { ReportFiltersBar } from "../shared/report-filters-bar";
import { ReportDataTable } from "../shared/report-data-table";
import { ReportPagination } from "../shared/report-pagination";
import { ReportEmptyState, ReportErrorState } from "../shared/report-states";
import { createReportColumnRegistry } from "@/lib/reports/registry/column-bridge";
import { defaultVisibility } from "@/lib/records/column-registry";
import { ReportExportDialog } from "../shared/report-export-dialog";
import type { ReportExportPayload } from "@/lib/reports/export/types";
import { useReportCompanyInfo } from "@/hooks/use-report-company-info";
import { generateDemoReportRows } from "@/lib/reports/demo-sample-data";
import { toast } from "sonner";

interface DetailedTableTemplateProps {
  definition: ReportDefinition;
  onPrint?: () => void;
  onExport?: () => void;
  onSelectReport?: (reportId: string) => void;
  currentView?: ReportViewTemplateType;
  onViewChange?: (view: ReportViewTemplateType) => void;
  isCustomMultiMethod?: boolean;
}

export function DetailedTableTemplate({
  definition,
  onPrint,
  onExport,
  onSelectReport,
  currentView = "detailed_table",
  onViewChange,
  isCustomMultiMethod,
}: DetailedTableTemplateProps) {
  const { companyName, currencySymbol } = useReportCompanyInfo();

  const [filters, setFilters] = useState<Record<string, any>>({
    startDate: new Date(new Date().getFullYear(), new Date().getMonth(), 1)
      .toISOString()
      .split("T")[0],
    endDate: new Date().toISOString().split("T")[0],
  });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [sortField, setSortField] = useState(definition.defaultSortField || "created_at");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">(definition.defaultSortOrder || "desc");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<any[]>([]);
  const [metrics, setMetrics] = useState<Record<string, number>>({});
  const [totalRowCount, setTotalRowCount] = useState(0);

  const [isExportDialogOpen, setIsExportDialogOpen] = useState(false);
  const [exportDialogMode, setExportDialogMode] = useState<"print" | "export">("print");

  const columnRegistry = useMemo(
    () => createReportColumnRegistry(definition.id, definition.columns),
    [definition.id, definition.columns],
  );

  const [columnVisibility, setColumnVisibility] = useState<Record<string, boolean>>(() =>
    defaultVisibility(columnRegistry),
  );

  // تحديث الأعمدة عند تغيير التقرير
  useEffect(() => {
    setColumnVisibility(
      defaultVisibility(createReportColumnRegistry(definition.id, definition.columns)),
    );
  }, [definition.id]);

  const dataProvider = useMemo(() => {
    if (definition.dataProviderId === "dp-purchase-register") {
      return new PurchaseRegisterDataProvider();
    }
    return new SalesRegisterDataProvider();
  }, [definition.dataProviderId]);

  async function fetchData(showFeedback = false) {
    setLoading(true);
    setError(null);
    try {
      const result = await dataProvider.execute({
        reportId: definition.id,
        filters,
        pagination: { page, pageSize },
        sort: { field: sortField, order: sortOrder },
      });

      if (result && result.rows) {
        setRows(result.rows);
        setMetrics(result.metrics || {});
        setTotalRowCount(result.totalRowCount ?? result.rows.length);
      } else {
        setRows([]);
        setMetrics({});
        setTotalRowCount(0);
      }

      if (showFeedback) {
        toast.success("تم تحديث بيانات التقرير بنجاح");
      }
    } catch (err: any) {
      setError(err?.message || "حدث خطأ أثناء تحميل بيانات التقرير");
      setRows([]);
      setMetrics({});
      setTotalRowCount(0);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchData(false);
  }, [filters, page, pageSize, sortField, sortOrder, definition.id]);

  const totalPages = Math.ceil(totalRowCount / pageSize) || 1;

  function handleSort(field: string) {
    if (sortField === field) {
      setSortOrder((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortOrder("desc");
    }
  }

  const exportPayload: ReportExportPayload = useMemo(
    () => ({
      definition,
      rows,
      metrics,
      appliedFilters: filters,
      currencySymbol,
    }),
    [definition, rows, metrics, filters, currencySymbol],
  );

  const handleOpenPrint = () => {
    if (onPrint) onPrint();
    else {
      setExportDialogMode("print");
      setIsExportDialogOpen(true);
    }
  };

  const handleOpenExport = () => {
    if (onExport) onExport();
    else {
      setExportDialogMode("export");
      setIsExportDialogOpen(true);
    }
  };

  const visibleColumns = useMemo(() => {
    return definition.columns.filter((c) => columnVisibility[c.key] !== false);
  }, [definition.columns, columnVisibility]);

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-card shadow-xs p-2 sm:p-3 overflow-hidden">
      <ReportHeader
        definition={definition}
        companyName={companyName}
        costBasisNotice={definition.costBasisNotice}
      />

      <ReportFiltersBar
        definition={definition}
        filters={definition.filters}
        values={filters}
        onChange={(k, v) => {
          setPage(1);
          setFilters((prev) => ({ ...prev, [k]: v }));
        }}
        onReset={() => setFilters({})}
        onPreview={() => fetchData(true)}
        columns={definition.columns}
        columnVisibility={columnVisibility}
        onChangeVisibility={setColumnVisibility}
        onResetVisibility={() => setColumnVisibility(defaultVisibility(columnRegistry))}
        onPrint={handleOpenPrint}
        onExport={handleOpenExport}
        currentTemplate={definition.viewTemplate}
        loading={loading}
        onSelectReport={onSelectReport}
        currentView={currentView}
        onViewChange={onViewChange}
        isCustomMultiMethod={isCustomMultiMethod}
        totalColumnsCount={definition.columns.length}
        visibleColumnsCount={visibleColumns.length}
        selectedDimensions={[]}
        onToggleDimension={(dimKey) => {
          onViewChange?.("grouped");
        }}
      />

      {error ? (
        <ReportErrorState error={error} onRetry={() => fetchData(true)} />
      ) : rows.length === 0 && !loading ? (
        <ReportEmptyState
          onResetFilters={() => setFilters({})}
          context={{
            hasAnyFilters: Object.keys(filters).some((k) => Boolean(filters[k])),
            hasRequiredFilter: true,
          }}
        />
      ) : (
        <ReportDataTable
          columns={visibleColumns}
          rows={rows}
          loading={loading}
          sortField={sortField}
          sortOrder={sortOrder}
          onSort={handleSort}
          currencySymbol={currencySymbol}
        />
      )}

      {totalRowCount > 0 && (
        <ReportPagination
          page={page}
          pageSize={pageSize}
          totalPages={totalPages}
          totalRowCount={totalRowCount}
          onPageChange={setPage}
          onPageSizeChange={(newSize) => {
            setPageSize(newSize);
            setPage(1);
          }}
        />
      )}

      <ReportExportDialog
        open={isExportDialogOpen}
        onOpenChange={setIsExportDialogOpen}
        payload={exportPayload}
        defaultMode={exportDialogMode}
      />
    </div>
  );
}

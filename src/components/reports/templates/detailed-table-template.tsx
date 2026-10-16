import React, { useState, useMemo, useEffect } from "react";
import { SlidersHorizontal, CheckSquare, Square, RotateCcw } from "lucide-react";
import type { ReportDefinition, ReportViewTemplateType } from "@/lib/reports/types";
import { SalesRegisterDataProvider } from "@/lib/reports/data-providers/sales-register";
import { PurchaseRegisterDataProvider } from "@/lib/reports/data-providers/purchase-register";
import { ReportHeader } from "../shared/report-header";
import { ReportSummaryDeck } from "../shared/report-summary-deck";
import { ReportFiltersBar } from "../shared/report-filters-bar";
import { ReportDataTable } from "../shared/report-data-table";
import { ReportPagination } from "../shared/report-pagination";
import { ReportEmptyState, ReportErrorState } from "../shared/report-states";
import { createReportColumnRegistry } from "@/lib/reports/registry/column-bridge";
import { defaultVisibility, resolveVisibility } from "@/lib/records/column-registry";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ReportExportDialog } from "../shared/report-export-dialog";
import type { ReportExportPayload } from "@/lib/reports/export/types";
import { useReportCompanyInfo } from "@/hooks/use-report-company-info";

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

  const [isColumnPickerOpen, setIsColumnPickerOpen] = useState(false);
  const [isExportDialogOpen, setIsExportDialogOpen] = useState(false);
  const [exportDialogMode, setExportDialogMode] = useState<"print" | "export">("print");

  const columnRegistry = useMemo(
    () => createReportColumnRegistry(definition.id, definition.columns),
    [definition.id, definition.columns],
  );
  const [columnVisibility, setColumnVisibility] = useState<Record<string, boolean>>(() =>
    defaultVisibility(columnRegistry),
  );

  const dataProvider = useMemo(() => {
    if (definition.dataProviderId === "dp-purchase-register") {
      return new PurchaseRegisterDataProvider();
    }
    return new SalesRegisterDataProvider();
  }, [definition.dataProviderId]);

  async function fetchData() {
    setLoading(true);
    setError(null);
    try {
      const result = await dataProvider.execute({
        reportId: definition.id,
        filters,
        pagination: { page, pageSize },
        sort: { field: sortField, order: sortOrder },
      });

      setRows(result.rows);
      setMetrics(result.metrics);
      setTotalRowCount(result.totalRowCount);
    } catch (err: any) {
      setError(err?.message || "تعذر تحميل بيانات التقرير");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchData();
  }, [filters, page, pageSize, sortField, sortOrder]);

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
        onPreview={fetchData}
        onOpenColumnPicker={() => setIsColumnPickerOpen(true)}
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
      />

      <ReportSummaryDeck
        metricsDefinitions={definition.metrics}
        metricsValues={metrics}
        currencySymbol={currencySymbol}
      />

      {error ? (
        <ReportErrorState error={error} onRetry={fetchData} />
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

      {/* حوار تخصيص ظهور الأعمدة وإخفائها */}
      <Dialog open={isColumnPickerOpen} onOpenChange={setIsColumnPickerOpen}>
        <DialogContent className="max-w-md p-4 text-xs">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm font-bold text-foreground">
              <SlidersHorizontal className="h-4 w-4 text-primary" />
              تخصيص الأعمدة المعروضة في التقرير
            </DialogTitle>
          </DialogHeader>

          <div className="max-h-60 overflow-y-auto space-y-1.5 py-2">
            {columnRegistry.columns.map((col) => {
              const isVisible = columnVisibility[col.key] !== false;
              const isEssential = col.essential;

              return (
                <div
                  key={col.key}
                  onClick={() => {
                    if (isEssential) return;
                    setColumnVisibility((prev) =>
                      resolveVisibility(columnRegistry, { ...prev, [col.key]: !isVisible }),
                    );
                  }}
                  className={`flex items-center justify-between p-2 rounded-lg transition-colors ${
                    isEssential
                      ? "bg-muted/40 opacity-70 cursor-not-allowed"
                      : "hover:bg-muted cursor-pointer"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    {isVisible ? (
                      <CheckSquare className="h-4 w-4 text-primary" />
                    ) : (
                      <Square className="h-4 w-4 text-muted-foreground" />
                    )}
                    <span className="font-medium text-foreground">{col.labelAr}</span>
                  </div>
                  {isEssential && (
                    <span className="text-[10px] text-muted-foreground">أساسي</span>
                  )}
                </div>
              );
            })}
          </div>

          <DialogFooter className="flex items-center justify-between gap-2 border-t border-border pt-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setColumnVisibility(defaultVisibility(columnRegistry))}
              className="h-7 text-xs gap-1"
            >
              <RotateCcw className="h-3 w-3" />
              استعادة الافتراضي
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => setIsColumnPickerOpen(false)}
              className="h-7 text-xs font-semibold px-4"
            >
              إغلاق وحفظ
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ReportExportDialog
        open={isExportDialogOpen}
        onOpenChange={setIsExportDialogOpen}
        payload={exportPayload}
        defaultMode={exportDialogMode}
      />
    </div>
  );
}

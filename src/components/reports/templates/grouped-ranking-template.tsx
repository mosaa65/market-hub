import { useState, useMemo, useEffect } from "react";
import type {
  ReportColumnDefinition,
  ReportDefinition,
  ReportViewTemplateType,
} from "@/lib/reports/types";
import {
  executeSalesGroupedReport,
  executePurchasesGroupedReport,
} from "@/lib/reports/report-execution.functions";
import { ReportHeader } from "../shared/report-header";
import { ReportFiltersBar } from "../shared/report-filters-bar";
import { ReportDimensionsBar } from "../shared/report-dimensions-bar";
import { ReportDataTable } from "../shared/report-data-table";
import { ReportPagination } from "../shared/report-pagination";
import { ReportEmptyState, ReportErrorState } from "../shared/report-states";
import { createReportColumnRegistry } from "@/lib/reports/registry/column-bridge";
import { defaultVisibility } from "@/lib/records/column-registry";
import { ReportExportDialog } from "../shared/report-export-dialog";
import type { ReportExportPayload } from "@/lib/reports/export/types";
import { useReportCompanyInfo } from "@/hooks/use-report-company-info";
import {
  getDomainDimensions,
  type ReportDimensionKey,
} from "@/lib/reports/registry/groupby-registry";
import { toast } from "sonner";

interface GroupedRankingTemplateProps {
  definition: ReportDefinition;
  onPrint?: () => void;
  onExport?: () => void;
  onSelectReport?: (reportId: string) => void;
  currentView?: ReportViewTemplateType;
  onViewChange?: (view: ReportViewTemplateType) => void;
  isCustomMultiMethod?: boolean;
}

export function GroupedRankingTemplate({
  definition,
  onPrint,
  onExport,
  onSelectReport,
  currentView = "grouped",
  onViewChange,
  isCustomMultiMethod,
}: GroupedRankingTemplateProps) {
  const { companyName, currencySymbol } = useReportCompanyInfo();

  const [filters, setFilters] = useState<Record<string, any>>({
    startDate: new Date(new Date().getFullYear(), new Date().getMonth(), 1)
      .toISOString()
      .split("T")[0],
    endDate: new Date().toISOString().split("T")[0],
  });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [sortField, setSortField] = useState(definition.defaultSortField || "net_sales");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">(definition.defaultSortOrder || "desc");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<Record<string, any>[]>([]);
  const [metrics, setMetrics] = useState<Record<string, number>>({});
  const [totalRowCount, setTotalRowCount] = useState(0);
  const [costBasisNotice, setCostBasisNotice] = useState<"ACTUAL" | "REFERENCE_ONLY" | "MIXED">(
    "ACTUAL",
  );

  const [isExportDialogOpen, setIsExportDialogOpen] = useState(false);
  const [exportDialogMode, setExportDialogMode] = useState<"print" | "export">("print");

  const defaultInitialDimension = useMemo<ReportDimensionKey>(() => {
    if (
      definition.id === "rep-customers-sales-turnover" ||
      definition.id === "rep-sales-customer"
    ) {
      return "customer";
    }
    if (definition.id === "rep-suppliers-payables" || definition.domain === "suppliers") {
      return "supplier";
    }
    if (definition.domain === "purchases" || definition.dataProviderId === "dp-purchase-register") {
      return "supplier";
    }
    if (definition.id === "rep-sales-branch") return "branch";
    if (definition.id === "rep-sales-warehouse") return "warehouse";
    if (definition.id === "rep-sales-payment-method") return "payment_method";
    return (definition as any).customGroupBy || "product";
  }, [definition.id, definition.domain, definition.dataProviderId]);

  const [selectedDimensions, setSelectedDimensions] = useState<ReportDimensionKey[]>([
    defaultInitialDimension,
  ]);

  // تحديث البعد عند تغير التقرير
  useEffect(() => {
    setSelectedDimensions([defaultInitialDimension]);
  }, [defaultInitialDimension]);

  // حساب الأعمدة الديناميكية: أعمدة الأبعاد المختارة أولاً، ثم أعمدة المؤشرات والحسابات
  const computedColumns = useMemo<ReportColumnDefinition[]>(() => {
    const domainDimensions = getDomainDimensions(definition.domain || "sales");
    const activeDimensionConfigs = domainDimensions.filter((d) =>
      selectedDimensions.includes(d.key),
    );
    const dimensionColumns = activeDimensionConfigs.flatMap((d) => d.columns);

    // استخراج أعمدة المقاييس الحسابية من تعريف التقرير
    const metricColumns = definition.columns.filter(
      (col) =>
        ![
          "customer_name",
          "product_name",
          "sku",
          "payment_method_name",
          "branch_name",
          "warehouse_name",
          "supplier_name",
        ].includes(col.key),
    );

    return [...dimensionColumns, ...metricColumns];
  }, [definition.columns, definition.domain, selectedDimensions]);

  const columnRegistry = useMemo(
    () => createReportColumnRegistry(definition.id, computedColumns),
    [definition.id, computedColumns],
  );

  const [columnVisibility, setColumnVisibility] = useState<Record<string, boolean>>(() =>
    defaultVisibility(columnRegistry),
  );

  // تحديث رؤية الأعمدة عند تغير الأعمدة المجمعة
  useEffect(() => {
    setColumnVisibility((prev) => {
      const next = defaultVisibility(columnRegistry);
      return { ...next, ...prev };
    });
  }, [columnRegistry]);

  async function fetchData(showFeedback = false) {
    setLoading(true);
    setError(null);
    try {
      const isPurchases =
        definition.dataProviderId === "dp-purchase-register" ||
        definition.domain === "purchases" ||
        definition.domain === "suppliers";

      const result = isPurchases
        ? await executePurchasesGroupedReport({
            data: {
              reportId: definition.id,
              filters,
              pagination: { page, pageSize },
              sort: { field: sortField, order: sortOrder },
              dimensions: selectedDimensions as Array<
                "supplier" | "product" | "warehouse" | "payment_method"
              >,
            },
          })
        : await executeSalesGroupedReport({
            data: {
              reportId: definition.id,
              filters,
              pagination: { page, pageSize },
              sort: { field: sortField, order: sortOrder },
              dimensions: selectedDimensions as Array<
                "product" | "customer" | "branch" | "warehouse" | "payment_method"
              >,
            },
          });

      if (result && result.rows) {
        setRows(result.rows);
        setMetrics(result.metrics || {});
        setTotalRowCount(result.totalRowCount ?? result.rows.length);
        if ((result as any).costBasisNotice) {
          setCostBasisNotice((result as any).costBasisNotice);
        }
      } else {
        setRows([]);
        setMetrics({});
        setTotalRowCount(0);
      }

      if (showFeedback) {
        toast.success("تم تحديث ومعاينة بيانات التقرير التجميعي بنجاح");
      }
    } catch (err: any) {
      setError(err?.message || "حدث خطأ أثناء تحميل بيانات التقرير التجميعي");
      setRows([]);
      setMetrics({});
      setTotalRowCount(0);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchData(false);
  }, [filters, page, pageSize, sortField, sortOrder, definition.id, selectedDimensions]);

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
    return computedColumns.filter((c) => columnVisibility[c.key] !== false);
  }, [computedColumns, columnVisibility]);

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-card shadow-xs p-2 sm:p-3 overflow-hidden">
      <ReportHeader
        definition={definition}
        companyName={companyName}
        costBasisNotice={costBasisNotice}
      />

      {/* ── شريط اختيار الأبعاد التجميعية المتعددة (العميل + المنتج + طريقة الدفع + الفرع ...) ── */}
      <ReportDimensionsBar
        domain={definition.domain || "sales"}
        selectedDimensions={selectedDimensions}
        onChangeDimensions={(dims) => {
          setSelectedDimensions(dims);
          setPage(1);
        }}
        onResetToDetailed={() => {
          onViewChange?.("detailed_table");
        }}
        disabled={loading}
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
        columns={computedColumns}
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
        totalColumnsCount={computedColumns.length}
        visibleColumnsCount={visibleColumns.length}
        selectedDimensions={selectedDimensions}
        onToggleDimension={(dimKey) => {
          if (selectedDimensions.includes(dimKey)) {
            setSelectedDimensions(selectedDimensions.filter((d) => d !== dimKey));
          } else {
            setSelectedDimensions([...selectedDimensions, dimKey]);
          }
          setPage(1);
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

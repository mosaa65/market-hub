import React, { useState, useMemo, useEffect } from "react";
import {
  BarChart,
  Bar,
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import {
  BarChart3,
  TrendingUp,
  PieChart as PieIcon,
  Sparkles,
  ArrowUpRight,
  Package,
} from "lucide-react";
import type { ReportDefinition, ReportViewTemplateType } from "@/lib/reports/types";
import { executeSalesGroupedReport } from "@/lib/reports/report-execution.functions";
import { ReportHeader } from "../shared/report-header";
import { ReportSummaryDeck } from "../shared/report-summary-deck";
import { ReportFiltersBar } from "../shared/report-filters-bar";
import { ReportEmptyState, ReportErrorState } from "../shared/report-states";
import { ReportExportDialog } from "../shared/report-export-dialog";
import type { ReportExportPayload } from "@/lib/reports/export/types";
import { useReportCompanyInfo } from "@/hooks/use-report-company-info";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface ChartReportTemplateProps {
  definition: ReportDefinition;
  onPrint?: () => void;
  onExport?: () => void;
  onSelectReport?: (reportId: string) => void;
  currentView?: ReportViewTemplateType;
  onViewChange?: (view: ReportViewTemplateType) => void;
  isCustomMultiMethod?: boolean;
}

const PALETTE = [
  "oklch(0.62 0.21 260)", // أزرق فيوليت
  "oklch(0.7 0.18 180)",  // تركواز
  "oklch(0.72 0.18 60)",  // برتقالي دافئ
  "oklch(0.68 0.2 340)",  // وردي توتي
  "oklch(0.75 0.15 140)", // أخضر عشبي
  "oklch(0.65 0.18 290)", // بنفسجي
  "oklch(0.6 0.16 220)",  // كحلي بحري
  "oklch(0.78 0.14 90)",  // ذهبي ليموني
];

const TOOLTIP_STYLE = {
  background: "var(--popover, #1e293b)",
  color: "var(--popover-foreground, #f8fafc)",
  border: "1px solid var(--border, #334155)",
  borderRadius: 12,
  fontSize: 12,
  padding: "8px 12px",
  boxShadow: "0 10px 25px -5px rgba(0,0,0,0.3)",
} as const;

export function ChartReportTemplate({
  definition,
  onPrint,
  onExport,
  onSelectReport,
  currentView = "chart",
  onViewChange,
  isCustomMultiMethod,
}: ChartReportTemplateProps) {
  const { companyName, currencySymbol } = useReportCompanyInfo();

  const [filters, setFilters] = useState<Record<string, any>>({
    startDate: new Date(new Date().getFullYear(), new Date().getMonth(), 1)
      .toISOString()
      .split("T")[0],
    endDate: new Date().toISOString().split("T")[0],
  });

  const [chartMode, setChartMode] = useState<"bar" | "area" | "pie">("bar");
  const [metricKey, setMetricKey] = useState<"net_sales" | "quantity" | "gross_margin">("net_sales");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<Record<string, any>[]>([]);
  const [metrics, setMetrics] = useState<Record<string, number>>({});
  const [costBasisNotice, setCostBasisNotice] = useState<"ACTUAL" | "REFERENCE_ONLY" | "MIXED">(
    "ACTUAL",
  );

  const [isExportDialogOpen, setIsExportDialogOpen] = useState(false);
  const [exportDialogMode, setExportDialogMode] = useState<"print" | "export">("print");

  const groupBy =
    definition.id === "rep-customers-sales-turnover" || definition.id === "rep-sales-customer"
      ? "customer"
      : definition.id === "rep-sales-branch"
        ? "branch"
        : definition.id === "rep-sales-warehouse"
          ? "warehouse"
          : definition.id === "rep-sales-payment-method"
            ? "payment_method"
            : (definition as any).customGroupBy || "product";

  async function fetchData() {
    setLoading(true);
    setError(null);
    try {
      const result = await executeSalesGroupedReport({
        data: {
          reportId: definition.id,
          filters,
          pagination: { page: 1, pageSize: 30 },
          sort: { field: metricKey, order: "desc" },
          groupBy,
        },
      });

      setRows(result.rows || []);
      setMetrics(result.metrics || {});
      if ((result as any).costBasisNotice) {
        setCostBasisNotice((result as any).costBasisNotice);
      }
    } catch (err: any) {
      setError(err?.message || "تعذر تحميل بيانات الرسم البياني");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchData();
  }, [filters, metricKey]);

  // تجهيز البيانات المناسبة للرسم البياني
  const chartData = useMemo(() => {
    if (!rows || rows.length === 0) return [];
    return rows.slice(0, 15).map((row, index) => {
      const name =
        row.entity_name ||
        row.product_name ||
        row.customer_name ||
        row.item_name ||
        row.branch_name ||
        row.name ||
        `عنصر ${index + 1}`;

      return {
        name: String(name),
        value: Number(row[metricKey]) || 0,
        quantity: Number(row.quantity || row.total_quantity || 0),
        net_sales: Number(row.net_sales || 0),
        gross_margin: Number(row.gross_margin || 0),
        raw: row,
      };
    });
  }, [rows, metricKey]);

  const totalChartValue = useMemo(() => {
    return chartData.reduce((acc, curr) => acc + (curr.value || 0), 0) || 1;
  }, [chartData]);

  const metricLabel = useMemo(() => {
    if (metricKey === "quantity") return "الكميات المباعة";
    if (metricKey === "gross_margin") return "هامش الربح";
    return "صافي المبيعات";
  }, [metricKey]);

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

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-card shadow-xs p-2 sm:p-3 overflow-hidden">
      <ReportHeader
        definition={definition}
        companyName={companyName}
        costBasisNotice={costBasisNotice}
      />

      <ReportFiltersBar
        definition={definition}
        filters={definition.filters}
        values={filters}
        onChange={(k, v) => setFilters((prev) => ({ ...prev, [k]: v }))}
        onReset={() => setFilters({})}
        onPreview={fetchData}
        onPrint={handleOpenPrint}
        onExport={handleOpenExport}
        currentTemplate={definition.viewTemplate}
        loading={loading}
        onSelectReport={onSelectReport}
        currentView={currentView}
        onViewChange={onViewChange}
        isCustomMultiMethod={isCustomMultiMethod}
        totalColumnsCount={definition.columns.length}
        visibleColumnsCount={definition.columns.length}
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
        <div className="flex flex-col gap-3">
          {/* ── شريط أدوات الرسم البياني واختيار نوع التمثيل والمقياس ── */}
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-muted/20 p-2">
            <div className="flex items-center gap-1">
              <span className="text-xs font-semibold text-foreground ml-2">نوع الرسم:</span>
              <Button
                type="button"
                variant={chartMode === "bar" ? "default" : "outline"}
                size="sm"
                onClick={() => setChartMode("bar")}
                className="h-7 px-2.5 text-xs gap-1"
              >
                <BarChart3 className="h-3.5 w-3.5" />
                <span>أعمدة ترتيبية</span>
              </Button>

              <Button
                type="button"
                variant={chartMode === "area" ? "default" : "outline"}
                size="sm"
                onClick={() => setChartMode("area")}
                className="h-7 px-2.5 text-xs gap-1"
              >
                <TrendingUp className="h-3.5 w-3.5" />
                <span>مساحي انسيابي</span>
              </Button>

              <Button
                type="button"
                variant={chartMode === "pie" ? "default" : "outline"}
                size="sm"
                onClick={() => setChartMode("pie")}
                className="h-7 px-2.5 text-xs gap-1"
              >
                <PieIcon className="h-3.5 w-3.5" />
                <span>توزيع دائري</span>
              </Button>
            </div>

            <div className="flex items-center gap-1.5">
              <span className="text-xs text-muted-foreground">المقياس المعروض:</span>
              <div className="flex items-center gap-1 rounded-md border border-border bg-card p-0.5">
                <button
                  type="button"
                  onClick={() => setMetricKey("net_sales")}
                  className={`px-2 py-0.5 text-[11px] rounded transition-colors ${
                    metricKey === "net_sales"
                      ? "bg-primary text-primary-foreground font-bold shadow-xs"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  صافي المبيعات
                </button>
                <button
                  type="button"
                  onClick={() => setMetricKey("quantity")}
                  className={`px-2 py-0.5 text-[11px] rounded transition-colors ${
                    metricKey === "quantity"
                      ? "bg-primary text-primary-foreground font-bold shadow-xs"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  الكمية
                </button>
                <button
                  type="button"
                  onClick={() => setMetricKey("gross_margin")}
                  className={`px-2 py-0.5 text-[11px] rounded transition-colors ${
                    metricKey === "gross_margin"
                      ? "bg-primary text-primary-foreground font-bold shadow-xs"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  هامش الربح
                </button>
              </div>
            </div>
          </div>

          {/* ── لوحة الرسم البياني الرئيسية ── */}
          <div className="rounded-xl border border-border bg-card p-4 shadow-xs">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-foreground flex items-center gap-2">
                  <BarChart3 className="h-4 w-4 text-primary" />
                  تحليل {metricLabel} ({chartData.length} عناصر رائدة)
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  تمثيل بياني تفاعلي مدعوم بقيم التقرير والفلاتر المطبقة
                </p>
              </div>

              {isCustomMultiMethod && (
                <Badge
                  variant="outline"
                  className="bg-amber-500/10 text-amber-600 border-amber-500/30 gap-1 text-[11px]"
                >
                  <Sparkles className="h-3 w-3" />
                  قالب تجميعي مخصص
                </Badge>
              )}
            </div>

            <div className="h-72 w-full pt-2">
              <ResponsiveContainer width="100%" height="100%">
                {chartMode === "bar" ? (
                  <BarChart data={chartData} margin={{ top: 10, right: 10, left: 10, bottom: 25 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                    <XAxis
                      dataKey="name"
                      fontSize={11}
                      stroke="currentColor"
                      className="text-muted-foreground"
                      tickLine={false}
                      interval={0}
                      tick={(props: any) => {
                        const { x, y, payload } = props;
                        const text = String(payload.value || "");
                        const truncated = text.length > 12 ? `${text.slice(0, 11)}…` : text;
                        return (
                          <g transform={`translate(${x},${y})`}>
                            <text
                              x={0}
                              y={0}
                              dy={12}
                              textAnchor="middle"
                              fill="currentColor"
                              fontSize={10}
                              className="fill-muted-foreground"
                            >
                              {truncated}
                            </text>
                          </g>
                        );
                      }}
                    />
                    <YAxis
                      fontSize={11}
                      stroke="currentColor"
                      className="text-muted-foreground"
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={(v) =>
                        metricKey === "quantity"
                          ? String(v)
                          : v >= 1000
                            ? `${(v / 1000).toFixed(0)}k`
                            : String(v)
                      }
                    />
                    <Tooltip
                      contentStyle={TOOLTIP_STYLE}
                      formatter={(val: any) => [
                        metricKey === "quantity"
                          ? `${Number(val).toLocaleString()} وحدة`
                          : `${Number(val).toLocaleString()} ${currencySymbol}`,
                        metricLabel,
                      ]}
                      labelFormatter={(label) => `العنصر: ${label}`}
                    />
                    <Bar
                      dataKey="value"
                      fill="var(--primary, #3b82f6)"
                      radius={[6, 6, 0, 0]}
                    >
                      {chartData.map((_, index) => (
                        <Cell key={`cell-${index}`} fill={PALETTE[index % PALETTE.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                ) : chartMode === "area" ? (
                  <AreaChart data={chartData} margin={{ top: 10, right: 10, left: 10, bottom: 25 }}>
                    <defs>
                      <linearGradient id="areaGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="var(--primary, #3b82f6)" stopOpacity={0.5} />
                        <stop offset="95%" stopColor="var(--primary, #3b82f6)" stopOpacity={0.0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                    <XAxis
                      dataKey="name"
                      fontSize={11}
                      stroke="currentColor"
                      className="text-muted-foreground"
                      tickLine={false}
                      interval={0}
                      tick={(props: any) => {
                        const { x, y, payload } = props;
                        const text = String(payload.value || "");
                        const truncated = text.length > 12 ? `${text.slice(0, 11)}…` : text;
                        return (
                          <g transform={`translate(${x},${y})`}>
                            <text
                              x={0}
                              y={0}
                              dy={12}
                              textAnchor="middle"
                              fill="currentColor"
                              fontSize={10}
                              className="fill-muted-foreground"
                            >
                              {truncated}
                            </text>
                          </g>
                        );
                      }}
                    />
                    <YAxis
                      fontSize={11}
                      stroke="currentColor"
                      className="text-muted-foreground"
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={(v) =>
                        metricKey === "quantity"
                          ? String(v)
                          : v >= 1000
                            ? `${(v / 1000).toFixed(0)}k`
                            : String(v)
                      }
                    />
                    <Tooltip
                      contentStyle={TOOLTIP_STYLE}
                      formatter={(val: any) => [
                        metricKey === "quantity"
                          ? `${Number(val).toLocaleString()} وحدة`
                          : `${Number(val).toLocaleString()} ${currencySymbol}`,
                        metricLabel,
                      ]}
                    />
                    <Area
                      type="monotone"
                      dataKey="value"
                      stroke="var(--primary, #3b82f6)"
                      strokeWidth={2.5}
                      fill="url(#areaGradient)"
                    />
                  </AreaChart>
                ) : (
                  <PieChart>
                    <Pie
                      data={chartData}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={95}
                      paddingAngle={2}
                    >
                      {chartData.map((_, index) => (
                        <Cell key={`pie-cell-${index}`} fill={PALETTE[index % PALETTE.length]} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={TOOLTIP_STYLE}
                      formatter={(val: any) => [
                        metricKey === "quantity"
                          ? `${Number(val).toLocaleString()} وحدة`
                          : `${Number(val).toLocaleString()} ${currencySymbol}`,
                        metricLabel,
                      ]}
                    />
                  </PieChart>
                )}
              </ResponsiveContainer>
            </div>
          </div>

          {/* ── جدول الترتيب والمساهمة المصغر المرافق للرسم البياني ── */}
          <div className="rounded-xl border border-border bg-card p-3 shadow-xs">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-bold text-foreground flex items-center gap-1.5">
                <ArrowUpRight className="h-3.5 w-3.5 text-primary" />
                جدول ترتيب العناصر وتوزيع النسب
              </span>
              <span className="text-[11px] text-muted-foreground">
                إجمالي العينة:{" "}
                <span className="font-mono font-semibold text-foreground">
                  {metricKey === "quantity"
                    ? `${totalChartValue.toLocaleString()} وحدة`
                    : `${totalChartValue.toLocaleString()} ${currencySymbol}`}
                </span>
              </span>
            </div>

            <div className="space-y-1.5">
              {chartData.slice(0, 8).map((item, i) => {
                const percent = Math.min(100, Math.round((item.value / totalChartValue) * 100));
                return (
                  <div
                    key={i}
                    className="flex items-center justify-between gap-3 p-2 rounded-lg bg-muted/20 border border-border/50 text-xs hover:bg-muted/40 transition-colors"
                  >
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <span
                        className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold"
                        style={{
                          backgroundColor: `${PALETTE[i % PALETTE.length]}25`,
                          color: PALETTE[i % PALETTE.length],
                        }}
                      >
                        {i + 1}
                      </span>
                      <span className="truncate font-medium text-foreground">{item.name}</span>
                    </div>

                    <div className="flex items-center gap-3 shrink-0">
                      <div className="w-24 hidden sm:block">
                        <div className="h-2 rounded-full bg-muted overflow-hidden">
                          <div
                            className="h-full rounded-full transition-all duration-300"
                            style={{
                              width: `${percent}%`,
                              backgroundColor: PALETTE[i % PALETTE.length],
                            }}
                          />
                        </div>
                      </div>

                      <span className="text-[11px] font-mono text-muted-foreground w-10 text-left">
                        {percent}%
                      </span>

                      <span className="font-mono font-bold text-foreground">
                        {metricKey === "quantity"
                          ? Number(item.value).toLocaleString()
                          : `${Number(item.value).toLocaleString()} ${currencySymbol}`}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
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

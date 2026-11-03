import { ArrowUpDown, ArrowUp, ArrowDown, Table2, Building2 } from "lucide-react";
import type { ReportColumnDefinition } from "@/lib/reports/types";
import { Ltr } from "@/components/ltr-value";
import { useReportCompanyInfo } from "@/hooks/use-report-company-info";

interface ReportDataTableProps {
  columns: ReportColumnDefinition[];
  rows: Record<string, any>[];
  sortField?: string;
  sortOrder?: "asc" | "desc";
  onSort?: (field: string) => void;
  loading?: boolean;
  currencySymbol?: string;
}

export function ReportDataTable({
  columns,
  rows,
  sortField,
  sortOrder,
  onSort,
  loading,
  currencySymbol = "ر.ي",
}: ReportDataTableProps) {
  const { companyName } = useReportCompanyInfo();
  const visibleColumns = columns;
  const hasAggregates = visibleColumns.some((col) => col.aggregate);

  function formatCellValue(val: any, col: ReportColumnDefinition) {
    if (val === undefined || val === null || val === "") {
      return <span className="text-muted-foreground/50">—</span>;
    }

    const unit = col.unit || currencySymbol;

    switch (col.dataType) {
      case "money": {
        const num = Number(val);
        if (isNaN(num)) return String(val);
        return (
          <Ltr>
            <span className="font-mono font-medium">
              {num.toLocaleString("en-US", {
                minimumFractionDigits: 0,
                maximumFractionDigits: 2,
              })}
            </span>{" "}
            <span className="text-[10px] text-muted-foreground">{unit}</span>
          </Ltr>
        );
      }
      case "percentage": {
        const num = Number(val);
        if (isNaN(num)) return String(val);
        return <Ltr className="font-mono">{num.toFixed(2)}%</Ltr>;
      }
      case "quantity": {
        const num = Number(val);
        if (isNaN(num)) return String(val);
        return (
          <Ltr>
            <span className="font-mono">{num.toLocaleString("en-US")}</span>{" "}
            {col.unit && <span className="text-[10px] text-muted-foreground">{col.unit}</span>}
          </Ltr>
        );
      }
      case "date": {
        const str = String(val);
        if (str.includes("T")) return str.split("T")[0];
        return str;
      }
      case "code":
        return <span className="font-mono text-xs">{String(val)}</span>;
      default:
        return String(val);
    }
  }

  function calculateAggregate(col: ReportColumnDefinition) {
    if (!col.aggregate) return "";

    const nums = rows.map((r) => Number(r[col.key]) || 0);

    if (col.aggregate === "sum") {
      const sum = nums.reduce((a, b) => a + b, 0);
      return formatCellValue(sum, col);
    }
    if (col.aggregate === "avg") {
      const avg = nums.length > 0 ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
      return formatCellValue(avg, col);
    }
    if (col.aggregate === "count") {
      return (
        <Ltr className="font-mono">
          {nums.length} <span className="text-[10px] text-muted-foreground">سجل</span>
        </Ltr>
      );
    }

    return "";
  }

  return (
    <div className="w-full overflow-hidden rounded-xl border border-border bg-card shadow-xs">
      {/* ── Table Top Bar بتنسيق ألوان النظام ── */}
      <div className="flex items-center justify-between border-b border-border bg-muted/40 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <Table2 className="h-4 w-4 text-primary" />
          <span className="text-xs sm:text-sm font-semibold tracking-tight text-foreground font-mono">
            جدول البيانات التفصيلية
          </span>
          <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground font-mono">
            {rows.length} سجل
          </span>
        </div>

        <div className="flex items-center gap-2">
          <Building2 className="h-4 w-4 text-primary" />
          <span className="text-xs sm:text-sm font-semibold text-foreground">{companyName}</span>
        </div>
      </div>

      {/* ── Responsive Table ── */}
      <div className="overflow-x-auto [scrollbar-width:thin]">
        <table className="w-full text-xs text-right border-collapse">
          <thead>
            <tr className="border-b border-border bg-muted/30 font-semibold text-foreground">
              {visibleColumns.map((col) => {
                const isSorted = sortField === col.key;
                const alignClass =
                  col.align === "left"
                    ? "text-left"
                    : col.align === "center"
                      ? "text-center"
                      : "text-right";

                return (
                  <th
                    key={col.key}
                    onClick={() => onSort?.(col.key)}
                    aria-sort={
                      isSorted ? (sortOrder === "asc" ? "ascending" : "descending") : "none"
                    }
                    className={`py-2.5 px-3 whitespace-nowrap select-none ${alignClass} ${
                      onSort ? "cursor-pointer hover:text-foreground transition-colors" : ""
                    }`}
                  >
                    <div
                      className={`inline-flex items-center gap-1.5 ${
                        col.align === "left" ? "flex-row-reverse" : ""
                      }`}
                    >
                      <span>{col.labelAr}</span>
                      {onSort && (
                        <span className="text-muted-foreground">
                          {isSorted ? (
                            sortOrder === "asc" ? (
                              <ArrowUp className="h-3 w-3 text-primary" />
                            ) : (
                              <ArrowDown className="h-3 w-3 text-primary" />
                            )
                          ) : (
                            <ArrowUpDown className="h-3 w-3 opacity-40" />
                          )}
                        </span>
                      )}
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>

          <tbody className="divide-y divide-border">
            {loading &&
              rows.length === 0 &&
              Array.from({ length: 6 }).map((_, rowIndex) => (
                <tr key={`skeleton-${rowIndex}`} className="animate-pulse">
                  {visibleColumns.map((column) => (
                    <td key={column.key} className="p-3">
                      <div className="h-4 min-w-20 rounded bg-muted" />
                    </td>
                  ))}
                </tr>
              ))}

            {rows.map((row, rIdx) => (
              <tr
                key={row.id || row.invoice_item_id || row.invoice_id || rIdx}
                className="hover:bg-muted/40 transition-colors"
              >
                {visibleColumns.map((col) => {
                  const alignClass =
                    col.align === "left"
                      ? "text-left font-mono"
                      : col.align === "center"
                        ? "text-center"
                        : "text-right";

                  return (
                    <td
                      key={col.key}
                      className={`py-2.5 px-3 whitespace-nowrap tabular-nums ${alignClass}`}
                    >
                      {formatCellValue(row[col.key], col)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>

          {hasAggregates && rows.length > 0 && (
            <tfoot>
              <tr className="border-t-2 border-border bg-muted/40 font-bold text-foreground">
                {visibleColumns.map((col, idx) => {
                  const alignClass =
                    col.align === "left"
                      ? "text-left font-mono"
                      : col.align === "center"
                        ? "text-center"
                        : "text-right";

                  return (
                    <td key={col.key} className={`py-2.5 px-3 whitespace-nowrap ${alignClass}`}>
                      {idx === 0 && !col.aggregate ? "الإجمالي" : calculateAggregate(col)}
                    </td>
                  );
                })}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}

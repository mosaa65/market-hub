import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ColumnVisibilityMenu } from "@/components/statements/column-visibility-menu";
import {
  ReportFilterMenu,
  type ReportFilterPreset,
  type ReportFilterValues,
} from "@/components/statements/report-filter-menu";
import type { StatementFieldKey } from "@/lib/statements/types";
import { money } from "@/lib/format";
import { ReportOutputButtons, ReportRowDetails, exportReportRows, printReportRows } from "@/components/statements/report-tools";

type PurchaseRow = {
  id: string;
  invoice_number: string;
  total: number | null;
  subtotal: number | null;
  discount: number | null;
  tax: number | null;
  paid: number | null;
  payment_method: string | null;
  status: string | null;
  created_at: string;
  suppliers: { name: string } | null;
  warehouses: { name: string; name_ar: string | null } | null;
};

export interface PurchasesReportProps {
  from: string;
  to: string;
  ar: boolean;
  onBack: () => void;
  filterValues: ReportFilterValues;
  filterPresets: ReportFilterPreset[];
  onFilterChange: (values: ReportFilterValues) => void;
  onFilterReset: () => void;
}

export function PurchasesReport({
  from,
  to,
  ar,
  onBack,
  filterValues,
  filterPresets,
  onFilterChange,
  onFilterReset,
}: PurchasesReportProps) {
  const [rows, setRows] = useState<PurchaseRow[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedRow, setSelectedRow] = useState<PurchaseRow | null>(null);
  const columns = [
    { key: "reference" as StatementFieldKey, label: ar ? "رقم الفاتورة" : "Invoice" },
    { key: "date" as StatementFieldKey, label: ar ? "التاريخ" : "Date" },
    { key: "description" as StatementFieldKey, label: ar ? "المورد" : "Supplier" },
    { key: "paymentMethod" as StatementFieldKey, label: ar ? "المستودع" : "Warehouse" },
    { key: "debit" as StatementFieldKey, label: ar ? "الإجمالي" : "Total" },
    { key: "credit" as StatementFieldKey, label: ar ? "المدفوع" : "Paid" },
    { key: "balance" as StatementFieldKey, label: ar ? "المتبقي" : "Remaining" },
    { key: "kind" as StatementFieldKey, label: ar ? "الحالة" : "Status" },
  ];
  const [visibleColumns, setVisibleColumns] = useState<Record<StatementFieldKey, boolean>>(() => {
    const defaults = Object.fromEntries(columns.map((column) => [column.key, true])) as Record<StatementFieldKey, boolean>;
    if (typeof window === "undefined") return defaults;
    try {
      return { ...defaults, ...(JSON.parse(window.localStorage.getItem("market_hub_report_columns_purchases_v1") ?? "{}") as Partial<Record<StatementFieldKey, boolean>>) };
    } catch {
      return defaults;
    }
  });

  useEffect(() => {
    if (typeof window !== "undefined") window.localStorage.setItem("market_hub_report_columns_purchases_v1", JSON.stringify(visibleColumns));
  }, [visibleColumns]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    let request = supabase
      .from("purchase_invoices")
      .select(
        "id,invoice_number,total,subtotal,discount,tax,paid,payment_method,status,created_at,suppliers(name),warehouses(name,name_ar)",
      )
      .order("created_at", { ascending: false });
    if (from) request = request.gte("created_at", `${from}T00:00:00`);
    if (to) request = request.lte("created_at", `${to}T23:59:59`);
    const result = await request;
    if (result.error) setError(result.error.message);
    setRows((result.data ?? []) as unknown as PurchaseRow[]);
    setLoading(false);
  }, [from, to]);

  useEffect(() => {
    void load();
  }, [load]);

  const filteredRows = useMemo(() => {
    const value = query.trim().toLowerCase();
    if (!value) return rows;
    return rows.filter(
      (row) =>
        row.invoice_number.toLowerCase().includes(value) ||
        (row.suppliers?.name ?? "").toLowerCase().includes(value),
    );
  }, [query, rows]);

  const total = filteredRows.reduce((sum, row) => sum + Number(row.total ?? 0), 0);
  const paid = filteredRows.reduce((sum, row) => sum + Number(row.paid ?? 0), 0);
  const outputHeaders = columns.filter((column) => visibleColumns[column.key]).map((column) => column.label);
  const outputRows = filteredRows.map((row) => {
    const values: Record<string, string> = {
      reference: row.invoice_number,
      date: new Date(row.created_at).toLocaleDateString(ar ? "ar-YE" : "en-GB"),
      description: row.suppliers?.name ?? "—",
      paymentMethod: ar ? row.warehouses?.name_ar || row.warehouses?.name || "—" : row.warehouses?.name || "—",
      debit: money(Number(row.total ?? 0)),
      credit: money(Number(row.paid ?? 0)),
      balance: money(Number(row.total ?? 0) - Number(row.paid ?? 0)),
      kind: row.status ?? "—",
    };
    return columns.filter((column) => visibleColumns[column.key]).map((column) => values[column.key]);
  });

  return (
    <div className="panel-elevated overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4">
        <div>
          <h2 className="text-sm font-semibold">{ar ? "كشف المشتريات" : "Purchases report"}</h2>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {ar ? "بيانات مباشرة من فواتير المشتريات" : "Live data from purchase invoices"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={ar ? "بحث برقم الفاتورة أو المورد" : "Search invoice or supplier"}
            className="h-8 w-56 text-xs"
          />
          <ReportFilterMenu
            values={filterValues}
            presets={filterPresets}
            onChange={onFilterChange}
            onReset={onFilterReset}
            labels={{
              trigger: ar ? "تصفية الكشف" : "Filter report",
              title: ar ? "تصفية الكشف" : "Report filters",
              date: ar ? "التاريخ والفترة" : "Date and period",
              period: ar ? "الفترة" : "Period",
              options: ar ? "خيارات إضافية" : "More options",
              includeZeroRows: ar ? "إظهار الفواتير المسددة" : "Include settled",
              reset: ar ? "إعادة ضبط الفلاتر" : "Reset filters",
              back: ar ? "رجوع" : "Back",
              from: ar ? "من" : "From",
              to: ar ? "إلى" : "To",
            }}
          />
          <ReportOutputButtons
            ar={ar}
            onExport={() => exportReportRows("market-hub-purchases", outputHeaders, outputRows)}
            onPrint={() => printReportRows(ar ? "كشف المشتريات" : "Purchases report", outputHeaders, outputRows, ar)}
          />
          <ColumnVisibilityMenu
            columns={columns}
            visible={visibleColumns}
            onChange={(key, value) => setVisibleColumns((current) => ({ ...current, [key]: value }))}
            label={ar ? "الأعمدة" : "Columns"}
            title={ar ? "إظهار أعمدة الكشف" : "Visible columns"}
          />
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={loading ? "animate-spin" : ""} />
            {ar ? "تحديث" : "Refresh"}
          </Button>
          <Button variant="ghost" size="sm" onClick={onBack}>
            {ar ? "العودة إلى كشف الحساب" : "Back to account"}
          </Button>
        </div>
      </div>

      {error && (
        <div className="border-b border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
          {error}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 border-b border-border p-4 sm:grid-cols-3">
        <Summary label={ar ? "عدد الفواتير" : "Invoices"} value={String(filteredRows.length)} />
        <Summary label={ar ? "الإجمالي" : "Total"} value={money(total)} />
        <Summary label={ar ? "المدفوع" : "Paid"} value={money(paid)} />
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-surface-2 text-muted-foreground">
            <tr>
              {columns.filter((column) => visibleColumns[column.key]).map((column) => (
                <Head key={column.key} align={column.key === "debit" || column.key === "credit" || column.key === "balance" ? "end" : "start"}>
                  {column.label}
                </Head>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={8} className="py-10 text-center">
                  <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                </td>
              </tr>
            ) : filteredRows.length === 0 ? (
              <tr>
                <td colSpan={8} className="py-10 text-center text-muted-foreground">
                  {ar ? "لا توجد بيانات" : "No data"}
                </td>
              </tr>
            ) : (
              filteredRows.map((row) => {
                const rowTotal = Number(row.total ?? 0);
                const rowPaid = Number(row.paid ?? 0);
                return (
                  <tr key={row.id} onClick={() => setSelectedRow(row)} className="cursor-pointer border-t border-border/60 hover:bg-surface-2/40" title={ar ? "عرض التفاصيل" : "View details"}>
                    {visibleColumns.reference && <td className="px-3 py-2 font-mono">{row.invoice_number}</td>}
                    {visibleColumns.date && <td className="px-3 py-2 text-muted-foreground">{new Date(row.created_at).toLocaleDateString(ar ? "ar-YE" : "en-GB")}</td>}
                    {visibleColumns.description && <td className="px-3 py-2">{row.suppliers?.name ?? "—"}</td>}
                    {visibleColumns.paymentMethod && <td className="px-3 py-2">{ar ? row.warehouses?.name_ar || row.warehouses?.name || "—" : row.warehouses?.name || "—"}</td>}
                    {visibleColumns.debit && <td className="px-3 py-2 text-end font-mono">{money(rowTotal)}</td>}
                    {visibleColumns.credit && <td className="px-3 py-2 text-end font-mono text-emerald-500">{money(rowPaid)}</td>}
                    {visibleColumns.balance && <td className="px-3 py-2 text-end font-mono text-amber-500">{money(rowTotal - rowPaid)}</td>}
                    {visibleColumns.kind && <td className="px-3 py-2">{row.status ?? "—"}</td>}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      <ReportRowDetails
        open={Boolean(selectedRow)}
        onOpenChange={(open) => !open && setSelectedRow(null)}
        title={ar ? "تفاصيل فاتورة المشتريات" : "Purchase invoice details"}
        values={selectedRow ? [
          [ar ? "رقم الفاتورة" : "Invoice", selectedRow.invoice_number],
          [ar ? "التاريخ" : "Date", new Date(selectedRow.created_at).toLocaleString(ar ? "ar-YE" : "en-GB")],
          [ar ? "المورد" : "Supplier", selectedRow.suppliers?.name ?? "—"],
          [ar ? "المستودع" : "Warehouse", ar ? selectedRow.warehouses?.name_ar || selectedRow.warehouses?.name || "—" : selectedRow.warehouses?.name || "—"],
          [ar ? "الإجمالي" : "Total", money(Number(selectedRow.total ?? 0))],
          [ar ? "المدفوع" : "Paid", money(Number(selectedRow.paid ?? 0))],
          [ar ? "المتبقي" : "Remaining", money(Number(selectedRow.total ?? 0) - Number(selectedRow.paid ?? 0))],
          [ar ? "الحالة" : "Status", selectedRow.status ?? "—"],
        ] : []}
      />
    </div>
  );
}

function Head({
  children,
  align = "start",
}: {
  children: React.ReactNode;
  align?: "start" | "end";
}) {
  return <th className={`px-3 py-2 text-${align} font-medium`}>{children}</th>;
}

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border-border/70 bg-surface/50 p-3">
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className="mt-1 font-mono text-sm font-semibold">{value}</div>
    </div>
  );
}

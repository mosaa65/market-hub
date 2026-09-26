import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { ColumnVisibilityMenu } from "@/components/statements/column-visibility-menu";
import { ReportShell, ReportSummary, ReportSummaryItem } from "@/components/statements/report-shell";
import {
  ReportFilterMenu,
  type ReportFilterPreset,
  type ReportFilterValues,
} from "@/components/statements/report-filter-menu";
import { money } from "@/lib/format";
import {
  ReportOutputButtons,
  ReportRowDetails,
  exportReportToExcel,
  printLuxuryReport,
} from "@/components/statements/report-tools";
import type { ReportType } from "@/lib/statements/report-registry";
import type { StatementFieldKey } from "@/lib/statements/types";

type AnyRow = Record<string, unknown>;

interface OperationalReportsProps {
  type: Extract<
    ReportType,
    "sales-invoices" | "returns" | "expenses" | "inventory-movements" | "product"
  >;
  from: string;
  to: string;
  ar: boolean;
  onBack: () => void;
  filterValues: ReportFilterValues;
  filterPresets: ReportFilterPreset[];
  onFilterChange: (values: ReportFilterValues) => void;
  onFilterReset: () => void;
}

export function OperationalReports({
  type,
  from,
  to,
  ar,
  onBack,
  filterValues,
  filterPresets,
  onFilterChange,
  onFilterReset,
}: OperationalReportsProps) {
  const [rows, setRows] = useState<AnyRow[]>([]);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [methodFilter, setMethodFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedRow, setSelectedRow] = useState<AnyRow | null>(null);
  const columnDefinitions = useMemo(() => reportColumns(type, ar), [type, ar]);
  const [visibleColumns, setVisibleColumns] = useState<Record<string, boolean>>(() => {
    if (typeof window === "undefined") return {};
    try {
      const raw = window.localStorage.getItem(`market_hub_report_columns_${type}_v1`);
      return raw ? (JSON.parse(raw) as Record<string, boolean>) : {};
    } catch {
      return {};
    }
  });

  useEffect(() => {
    const defaults = Object.fromEntries(columnDefinitions.map((column) => [column.key, true]));
    setVisibleColumns((current) => ({ ...defaults, ...current }));
  }, [columnDefinitions]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(`market_hub_report_columns_${type}_v1`, JSON.stringify(visibleColumns));
    } catch {
      // لا نعطل عرض الكشف عند تعذر التخزين المحلي.
    }
  }, [type, visibleColumns]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      let result: { data: unknown; error: { message: string } | null };
      if (type === "sales-invoices") {
        let request = supabase
          .from("sales_invoices")
          .select("*, customers(name), warehouses(name,name_ar)")
          .order("created_at", { ascending: false });
        if (from) request = request.gte("created_at", `${from}T00:00:00`);
        if (to) request = request.lte("created_at", `${to}T23:59:59`);
        result = await request;
      } else if (type === "expenses") {
        let request = supabase
          .from("expenses")
          .select("*, expense_categories(name,name_ar)")
          .order("expense_date", { ascending: false });
        if (from) request = request.gte("expense_date", from);
        if (to) request = request.lte("expense_date", to);
        result = await request;
      } else if (type === "inventory-movements" || type === "product") {
        let request = supabase
          .from("stock_movements")
          .select("*, products(name,name_ar,sku), warehouses(name,name_ar)")
          .order("created_at", { ascending: false });
        if (from) request = request.gte("created_at", `${from}T00:00:00`);
        if (to) request = request.lte("created_at", `${to}T23:59:59`);
        result = await request;
      } else {
        let salesRequest = supabase
          .from("sales_returns")
          .select("*, customers(name), warehouses(name,name_ar)")
          .order("created_at", { ascending: false });
        let purchasesRequest = supabase
          .from("purchase_returns")
          .select("*, suppliers(name), warehouses(name,name_ar)")
          .order("created_at", { ascending: false });
        if (from) {
          salesRequest = salesRequest.gte("created_at", `${from}T00:00:00`);
          purchasesRequest = purchasesRequest.gte("created_at", `${from}T00:00:00`);
        }
        if (to) {
          salesRequest = salesRequest.lte("created_at", `${to}T23:59:59`);
          purchasesRequest = purchasesRequest.lte("created_at", `${to}T23:59:59`);
        }
        const [sales, purchases] = await Promise.all([salesRequest, purchasesRequest]);
        const salesRows: AnyRow[] = ((sales.data ?? []) as AnyRow[]).map((row) => ({
          ...row,
          return_kind: "sales",
        }));
        const purchaseRows: AnyRow[] = ((purchases.data ?? []) as AnyRow[]).map((row) => ({
          ...row,
          return_kind: "purchases",
        }));
        const all = [...salesRows, ...purchaseRows].sort((a, b) =>
          String(b.created_at).localeCompare(String(a.created_at)),
        );
        result = { data: all, error: sales.error ?? purchases.error };
      }
      if (result.error) setError(result.error.message);
      setRows((result.data ?? []) as AnyRow[]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [from, to, type]);

  useEffect(() => {
    void load();
  }, [load]);

  const searchableRows = useMemo(
    () => rows.map((row) => ({ row, searchText: JSON.stringify(row).toLowerCase() })),
    [rows],
  );
  const filtered = useMemo(() => {
    const value = query.trim().toLowerCase();
    return searchableRows.filter(({ row, searchText }) => {
      const matchesQuery = !value || searchText.includes(value);
      const matchesStatus = statusFilter === "all" || String(row.status ?? "") === statusFilter || String(row.return_kind ?? "") === statusFilter;
      const matchesMethod = methodFilter === "all" || String(row.payment_method ?? "") === methodFilter;
      return matchesQuery && matchesStatus && matchesMethod;
    }).map(({ row }) => row);
  }, [methodFilter, query, searchableRows, statusFilter]);

  const title =
    type === "sales-invoices"
      ? ar
        ? "كشف فواتير العملاء"
        : "Customer invoices"
      : type === "expenses"
        ? ar
          ? "كشف المصروفات"
          : "Expenses"
        : type === "returns"
          ? ar
            ? "كشف المرتجعات"
            : "Returns"
          : type === "product"
            ? ar
              ? "كشف الصنف"
              : "Product statement"
            : ar
              ? "كشف حركة المخزون"
              : "Inventory movements";
  const amount = filtered.reduce(
    (sum, row) =>
      sum +
      Number(row.total ?? row.amount ?? Number(row.quantity ?? 0) * Number(row.unit_cost ?? 0)),
    0,
  );
  const outputHeaders = columnDefinitions.filter((column) => visibleColumns[column.key]).map((column) => column.label);
  const outputRows = filtered.map((row) => reportOutputRow(row, type, ar, visibleColumns));
  const outputTitle = title;

  return (
    <ReportShell
      title={title}
      subtitle={ar ? "بيانات مباشرة من الجداول التشغيلية" : "Live data from operational tables"}
      actions={
        <>
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={ar ? "بحث في الكشف" : "Search report"}
            className="h-8 w-48 text-xs"
          />
          {(type === "sales-invoices" || type === "returns") && (
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="h-8 rounded-md border-input bg-background px-2 text-xs">
              <option value="all">{ar ? "كل الحالات" : "All statuses"}</option>
              {type === "returns" ? <><option value="sales">{ar ? "مرتجعات المبيعات" : "Sales returns"}</option><option value="purchases">{ar ? "مرتجعات المشتريات" : "Purchase returns"}</option></> : <><option value="paid">{ar ? "مدفوعة" : "Paid"}</option><option value="pending">{ar ? "معلقة" : "Pending"}</option></>}
            </select>
          )}
          {(type === "sales-invoices" || type === "expenses" || type === "returns") && (
            <select value={methodFilter} onChange={(event) => setMethodFilter(event.target.value)} className="h-8 rounded-md border-input bg-background px-2 text-xs">
              <option value="all">{ar ? "كل طرق الدفع" : "All methods"}</option>
              <option value="cash">{ar ? "نقدي" : "Cash"}</option>
              <option value="card">{ar ? "بطاقة" : "Card"}</option>
              <option value="bank_transfer">{ar ? "تحويل بنكي" : "Bank transfer"}</option>
            </select>
          )}
          <ReportFilterMenu
            values={filterValues}
            presets={filterPresets}
            onChange={onFilterChange}
            onReset={onFilterReset}
            labels={{
              trigger: ar ? "تصفية الكشف" : "Filter report", title: ar ? "تصفية الكشف" : "Report filters", date: ar ? "التاريخ والفترة" : "Date and period", period: ar ? "الفترة" : "Period", options: ar ? "خيارات إضافية" : "More options", includeZeroRows: ar ? "إظهار الحركات المسددة" : "Include settled", reset: ar ? "إعادة ضبط الفلاتر" : "Reset filters", back: ar ? "رجوع" : "Back", from: ar ? "من" : "From", to: ar ? "إلى" : "To",
            }}
          />
          <ColumnVisibilityMenu columns={columnDefinitions} visible={visibleColumns as Record<StatementFieldKey, boolean>} onChange={(key, value) => setVisibleColumns((current) => ({ ...current, [key]: value }))} label={ar ? "الأعمدة" : "Columns"} title={ar ? "إظهار أعمدة الكشف" : "Visible columns"} />
          <ReportOutputButtons
            ar={ar}
            disabled={loading || filtered.length === 0}
            onExport={() =>
              exportReportToExcel(
                outputTitle.replace(/\s+/g, "_"),
                outputHeaders,
                outputRows,
                ar,
              )
            }
            onPrint={() => {
              const activeDefs = columnDefinitions.filter((c) => visibleColumns[c.key]);
              const amountColIdx = activeDefs.findIndex(
                (c) => c.key === "debit" || c.key === "balance" || c.key === "credit",
              );
              const totalsMap: Record<number, string> = {};
              if (amountColIdx >= 0 && amount > 0) {
                totalsMap[amountColIdx] = money(amount);
              }

              void printLuxuryReport({
                title: outputTitle,
                subtitle: ar
                  ? "بيانات تفصيلية من السجلات التشغيلية"
                  : "Detailed operational records",
                periodLabel:
                  from && to
                    ? ar
                      ? `الفترة من ${from} إلى ${to}`
                      : `Period ${from} to ${to}`
                    : ar
                      ? "كل الفترات"
                      : "All periods",
                headers: activeDefs.map((c) => ({
                  label: c.label,
                  align:
                    c.key === "debit" || c.key === "credit" || c.key === "balance"
                      ? "end"
                      : c.key === "date" || c.key === "reference" || c.key === "kind"
                        ? "center"
                        : "start",
                })),
                rows: outputRows,
                totalsRow:
                  amount > 0
                    ? {
                        label: ar ? "الإجمالي النهائي" : "Grand Total",
                        values: totalsMap,
                      }
                    : undefined,
                summaryCards: [
                  { label: ar ? "عدد السجلات" : "Records", value: String(filtered.length) },
                  { label: ar ? "إجمالي القيمة" : "Total Amount", value: money(amount) },
                ],
                ar,
              });
            }}
          />
        </>
      }
      error={error}
      loading={loading}
      onRefresh={() => void load()}
      onBack={onBack}
      refreshLabel={ar ? "تحديث" : "Refresh"}
      backLabel={ar ? "العودة" : "Back"}
    >
      <ReportSummary>
        <ReportSummaryItem label={ar ? "عدد السجلات" : "Records"} value={String(filtered.length)} />
        <ReportSummaryItem label={ar ? "القيمة" : "Amount"} value={money(amount)} />
        <ReportSummaryItem label={ar ? "الفترة" : "Period"} value={from || to ? `${from || "…"} — ${to || "…"}` : ar ? "كل الفترات" : "All periods"} />
      </ReportSummary>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-surface-2 text-muted-foreground">
            <tr>
              {columnDefinitions.filter((column) => visibleColumns[column.key]).map((column) => (
                <th key={column.key} className="px-3 py-2 text-start font-medium">
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={visibleColumnCount(columnDefinitions, visibleColumns)} className="py-10 text-center">
                  <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td
                  colSpan={visibleColumnCount(columnDefinitions, visibleColumns)}
                  className="py-10 text-center text-muted-foreground"
                >
                  {ar ? "لا توجد بيانات" : "No data"}
                </td>
              </tr>
            ) : (
              filtered.map((row, index) => (
                <ReportRow
                  key={String(row.id ?? index)}
                  row={row}
                  type={type}
                  ar={ar}
                  visibleColumns={visibleColumns}
                  onOpen={() => setSelectedRow(row)}
                />
              ))
            )}
          </tbody>
        </table>
      </div>
      <ReportRowDetails
        open={Boolean(selectedRow)}
        onOpenChange={(open) => !open && setSelectedRow(null)}
        title={title}
        values={selectedRow ? detailValues(selectedRow, type, ar) : []}
      />
    </ReportShell>
  );
}

type ReportColumn = { key: StatementFieldKey; label: string };

function reportColumns(type: OperationalReportsProps["type"], ar: boolean): ReportColumn[] {
  if (type === "sales-invoices") return [
    { key: "reference", label: ar ? "رقم الفاتورة" : "Invoice" },
    { key: "date", label: ar ? "التاريخ" : "Date" },
    { key: "description", label: ar ? "العميل" : "Customer" },
    { key: "debit", label: ar ? "الإجمالي" : "Total" },
    { key: "credit", label: ar ? "المدفوع" : "Paid" },
    { key: "balance", label: ar ? "المتبقي" : "Remaining" },
    { key: "kind", label: ar ? "الحالة" : "Status" },
  ];
  if (type === "expenses") return [
    { key: "date", label: ar ? "التاريخ" : "Date" },
    { key: "kind", label: ar ? "التصنيف" : "Category" },
    { key: "description", label: ar ? "البيان" : "Note" },
    { key: "debit", label: ar ? "المبلغ" : "Amount" },
    { key: "paymentMethod", label: ar ? "طريقة الدفع" : "Method" },
  ];
  if (type === "returns") return [
    { key: "reference", label: ar ? "رقم المرتجع" : "Return" },
    { key: "date", label: ar ? "التاريخ" : "Date" },
    { key: "kind", label: ar ? "النوع" : "Type" },
    { key: "description", label: ar ? "الجهة" : "Party" },
    { key: "paymentMethod", label: ar ? "المستودع" : "Warehouse" },
    { key: "debit", label: ar ? "الإجمالي" : "Total" },
  ];
  return [
    { key: "date", label: ar ? "التاريخ" : "Date" },
    { key: "description", label: ar ? "الصنف" : "Product" },
    { key: "reference", label: ar ? "المستودع" : "Warehouse" },
    { key: "kind", label: ar ? "نوع الحركة" : "Movement" },
    { key: "debit", label: ar ? "الكمية" : "Quantity" },
    { key: "credit", label: ar ? "التكلفة" : "Cost" },
    { key: "paymentMethod", label: ar ? "المرجع" : "Reference" },
  ];
}

function visibleColumnCount(columns: ReportColumn[], visible: Record<string, boolean>): number {
  return Math.max(columns.filter((column) => visible[column.key] !== false).length, 1);
}

function ReportRow({
  row,
  type,
  ar,
  visibleColumns,
  onOpen,
}: {
  row: AnyRow;
  type: OperationalReportsProps["type"];
  ar: boolean;
  visibleColumns: Record<string, boolean>;
  onOpen: () => void;
}) {
  const show = (key: StatementFieldKey) => visibleColumns[key] !== false;
  const relation = (value: unknown, arabic = false) => {
    const item = value as AnyRow | null;
    return arabic
      ? String(item?.name_ar ?? item?.name ?? "—")
      : String(item?.name ?? item?.name_ar ?? "—");
  };
  if (type === "sales-invoices") {
    const total = Number(row.total ?? 0);
    const paid = Number(row.paid ?? 0);
    return (
      <tr className="cursor-pointer border-t border-border/60 hover:bg-surface-2/40" onClick={onOpen} title={ar ? "عرض التفاصيل" : "View details"}>
        {show("reference") && <Cell mono>{String(row.invoice_number ?? "—")}</Cell>}
        {show("date") && <Cell>{formatDate(row.created_at, ar)}</Cell>}
        {show("description") && <Cell>{relation(row.customers)}</Cell>}
        {show("debit") && <Cell end mono>{money(total)}</Cell>}
        {show("credit") && <Cell end mono>{money(paid)}</Cell>}
        {show("balance") && <Cell end mono>{money(total - paid)}</Cell>}
        {show("kind") && <Cell>{String(row.status ?? "—")}</Cell>}
      </tr>
    );
  }
  if (type === "expenses")
    return (
      <tr className="cursor-pointer border-t border-border/60 hover:bg-surface-2/40" onClick={onOpen} title={ar ? "عرض التفاصيل" : "View details"}>
        {show("date") && <Cell>{formatDate(row.expense_date, ar)}</Cell>}
        {show("kind") && <Cell>{relation(row.expense_categories, ar)}</Cell>}
        {show("description") && <Cell>{String(row.note ?? "—")}</Cell>}
        {show("debit") && <Cell end mono>{money(Number(row.amount ?? 0))}</Cell>}
        {show("paymentMethod") && <Cell>{String(row.payment_method ?? "—")}</Cell>}
      </tr>
    );
  if (type === "returns")
    return (
      <tr className="cursor-pointer border-t border-border/60 hover:bg-surface-2/40" onClick={onOpen} title={ar ? "عرض التفاصيل" : "View details"}>
        {show("reference") && <Cell mono>{String(row.return_number ?? "—")}</Cell>}
        {show("date") && <Cell>{formatDate(row.created_at, ar)}</Cell>}
        {show("kind") && <Cell>{row.return_kind === "sales" ? (ar ? "مبيعات" : "Sales") : ar ? "مشتريات" : "Purchases"}</Cell>}
        {show("description") && <Cell>{relation(row.return_kind === "sales" ? row.customers : row.suppliers)}</Cell>}
        {show("paymentMethod") && <Cell>{relation(row.warehouses, ar)}</Cell>}
        {show("debit") && <Cell end mono>{money(Number(row.total ?? 0))}</Cell>}
      </tr>
    );
  return (
    <tr className="cursor-pointer border-t border-border/60 hover:bg-surface-2/40" onClick={onOpen} title={ar ? "عرض التفاصيل" : "View details"}>
      {show("date") && <Cell>{formatDate(row.created_at, ar)}</Cell>}
      {show("description") && <Cell>{relation(row.products, ar)}</Cell>}
      {show("reference") && <Cell>{relation(row.warehouses, ar)}</Cell>}
      {show("kind") && <Cell>{String(row.movement_type ?? "—")}</Cell>}
      {show("debit") && <Cell end mono>{String(row.quantity ?? "0")}</Cell>}
      {show("credit") && <Cell end mono>{money(Number(row.unit_cost ?? 0))}</Cell>}
      {show("paymentMethod") && <Cell mono>{String(row.reference ?? "—")}</Cell>}
    </tr>
  );
}

function detailValues(row: AnyRow, type: OperationalReportsProps["type"], ar: boolean): Array<[string, string]> {
  const relation = (value: unknown, arabic = false) => { const item = value as AnyRow | null; return arabic ? String(item?.name_ar ?? item?.name ?? "—") : String(item?.name ?? item?.name_ar ?? "—"); };
  return type === "sales-invoices"
    ? [[ar ? "رقم الفاتورة" : "Invoice", String(row.invoice_number ?? "—")], [ar ? "التاريخ" : "Date", formatDate(row.created_at, ar)], [ar ? "العميل" : "Customer", relation(row.customers, ar)], [ar ? "الإجمالي" : "Total", money(Number(row.total ?? 0))], [ar ? "المدفوع" : "Paid", money(Number(row.paid ?? 0))], [ar ? "المتبقي" : "Remaining", money(Number(row.total ?? 0) - Number(row.paid ?? 0))], [ar ? "الحالة" : "Status", String(row.status ?? "—")]]
    : type === "expenses"
      ? [[ar ? "التاريخ" : "Date", formatDate(row.expense_date, ar)], [ar ? "التصنيف" : "Category", relation(row.expense_categories, ar)], [ar ? "البيان" : "Note", String(row.note ?? "—")], [ar ? "المبلغ" : "Amount", money(Number(row.amount ?? 0))], [ar ? "طريقة الدفع" : "Method", String(row.payment_method ?? "—")]]
      : [[ar ? "التاريخ" : "Date", formatDate(row.created_at, ar)], [ar ? "الصنف" : "Product", relation(row.products, ar)], [ar ? "المستودع" : "Warehouse", relation(row.warehouses, ar)], [ar ? "النوع" : "Type", String(row.movement_type ?? row.return_kind ?? "—")], [ar ? "القيمة" : "Amount", money(Number(row.total ?? row.quantity ?? 0))], [ar ? "المرجع" : "Reference", String(row.reference ?? row.return_number ?? "—")]];
}

function reportOutputRow(row: AnyRow, type: OperationalReportsProps["type"], ar: boolean, visible: Record<string, boolean>): string[] {
  const show = (key: StatementFieldKey) => visible[key] !== false;
  const relation = (value: unknown, arabic = false) => { const item = value as AnyRow | null; return arabic ? String(item?.name_ar ?? item?.name ?? "—") : String(item?.name ?? item?.name_ar ?? "—"); };
  const values: Record<string, string> = { reference: String(row.invoice_number ?? row.return_number ?? row.reference ?? "—"), date: formatDate(row.created_at ?? row.expense_date, ar), description: relation(type === "sales-invoices" ? row.customers : type === "expenses" ? row.expense_categories : type === "returns" ? (row.return_kind === "sales" ? row.customers : row.suppliers) : row.products, ar), debit: money(Number(row.total ?? row.amount ?? row.quantity ?? 0)), credit: money(Number(row.paid ?? row.unit_cost ?? 0)), balance: money(Number(row.total ?? 0) - Number(row.paid ?? 0)), kind: String(row.status ?? row.movement_type ?? row.return_kind ?? "—"), paymentMethod: String(row.payment_method ?? row.reference ?? "—") };
  return ["reference", "date", "description", "debit", "credit", "balance", "kind", "paymentMethod"].filter((key) => show(key as StatementFieldKey)).map((key) => values[key]);
}

function Cell({
  children,
  end = false,
  mono = false,
}: {
  children: React.ReactNode;
  end?: boolean;
  mono?: boolean;
}) {
  return (
    <td className={`px-3 py-2 ${end ? "text-end" : ""} ${mono ? "font-mono" : ""}`}>{children}</td>
  );
}
function formatDate(value: unknown, ar: boolean) {
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString(ar ? "ar-YE" : "en-GB");
}

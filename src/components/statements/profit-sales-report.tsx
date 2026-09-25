import { useCallback, useEffect, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  ReportFilterMenu,
  type ReportFilterPreset,
  type ReportFilterValues,
} from "@/components/statements/report-filter-menu";
import { money } from "@/lib/format";

export interface ProfitSalesReportProps {
  from: string;
  to: string;
  ar: boolean;
  onBack: () => void;
  filterValues: ReportFilterValues;
  filterPresets: ReportFilterPreset[];
  onFilterChange: (values: ReportFilterValues) => void;
  onFilterReset: () => void;
}

export function ProfitSalesReport({
  from,
  to,
  ar,
  onBack,
  filterValues,
  filterPresets,
  onFilterChange,
  onFilterReset,
}: ProfitSalesReportProps) {
  const [data, setData] = useState({
    sales: 0,
    discounts: 0,
    returns: 0,
    netSales: 0,
    cost: 0,
    expenses: 0,
    gross: 0,
    net: 0,
    missingCostItems: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const fromTs = from ? `${from}T00:00:00` : undefined;
    const toTs = to ? `${to}T23:59:59` : undefined;
    try {
      let salesRequest = supabase
        .from("sales_invoices")
        .select("subtotal,discount,total,status")
        .not("status", "in", "(draft,cancelled)");
      let itemsRequest = supabase
        .from("sales_invoice_items")
        .select("quantity,products(cost_price),sales_invoices!inner(created_at,status)")
        .not("sales_invoices.status", "in", "(draft,cancelled)");
      let returnsRequest = supabase.from("sales_returns").select("total");
      let expensesRequest = supabase.from("expenses").select("amount");
      if (fromTs) {
        salesRequest = salesRequest.gte("created_at", fromTs);
        itemsRequest = itemsRequest.gte("sales_invoices.created_at", fromTs);
        returnsRequest = returnsRequest.gte("created_at", fromTs);
        expensesRequest = expensesRequest.gte("expense_date", from);

      }
      if (toTs) {
        salesRequest = salesRequest.lte("created_at", toTs);
        itemsRequest = itemsRequest.lte("sales_invoices.created_at", toTs);
        returnsRequest = returnsRequest.lte("created_at", toTs);
        expensesRequest = expensesRequest.lte("expense_date", to);

      }
      const [sales, items, returns, expenses] = await Promise.all([
        salesRequest,
        itemsRequest,
        returnsRequest,
        expensesRequest,
      ]);
      if (sales.error || items.error || returns.error || expenses.error)
        throw new Error(
          sales.error?.message ??
            items.error?.message ??
            returns.error?.message ??
            expenses.error?.message,
        );
      const salesRows = (sales.data ?? []) as Array<{
        subtotal: number | null;
        discount: number | null;
        total: number | null;
      }>;
      const salesTotal = salesRows.reduce(
        (sum, row) => sum + Number(row.subtotal ?? row.total ?? 0),
        0,
      );
      const discounts = salesRows.reduce((sum, row) => sum + Number(row.discount ?? 0), 0);
      const returnsTotal = (returns.data ?? []).reduce(
        (sum, row) => sum + Number((row as { total?: number }).total ?? 0),
        0,
      );
      const netSales = salesTotal - discounts - returnsTotal;
      let missingCostItems = 0;
      const cost = (items.data ?? []).reduce((sum, row) => {
        const item = row as unknown as {
          quantity: number | null;
          products: { cost_price: number | null } | null;
        };
        const quantity = Number(item.quantity ?? 0);
        const unitCost = Number(item.products?.cost_price ?? 0);
        if (quantity > 0 && unitCost <= 0) missingCostItems += 1;
        return sum + quantity * unitCost;
      }, 0);
      const expenseTotal = (expenses.data ?? []).reduce(
        (sum, row) => sum + Number((row as { amount?: number }).amount ?? 0),
        0,
      );
      const gross = netSales - cost;
      setData({
        sales: salesTotal,
        discounts,
        returns: returnsTotal,
        netSales,
        cost,
        expenses: expenseTotal,
        gross,
        net: gross - expenseTotal,
        missingCostItems,
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoading(false);
    }
  }, [from, to]);
  useEffect(() => {
    void load();
  }, [load]);
  return (
    <div className="panel-elevated overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4">
        <div>
          <h2 className="text-sm font-semibold">
            {ar ? "كشف الأرباح والمبيعات الأساسي" : "Basic profit and sales"}
          </h2>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {ar
              ? "تقدير تشغيلي وليس قائمة دخل محاسبية نهائية"
              : "Operational estimate, not a final accounting income statement"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
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
              includeZeroRows: ar ? "إظهار الحركات المسددة" : "Include settled",
              reset: ar ? "إعادة ضبط الفلاتر" : "Reset filters",
              back: ar ? "رجوع" : "Back",
              from: ar ? "من" : "From",
              to: ar ? "إلى" : "To",
            }}
          />
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={loading ? "animate-spin" : ""} />
            {ar ? "تحديث" : "Refresh"}
          </Button>
          <Button variant="ghost" size="sm" onClick={onBack}>
            {ar ? "العودة" : "Back"}
          </Button>
        </div>
      </div>
      {error && (
        <div className="border-b border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
          {error}
        </div>
      )}
      {loading ? (
        <div className="grid place-items-center py-16">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : (
        <>
          <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
            <Metric label={ar ? "إجمالي المبيعات" : "Sales"} value={data.sales} />
            <Metric label={ar ? "الخصومات" : "Discounts"} value={data.discounts} />
            <Metric label={ar ? "المرتجعات" : "Returns"} value={data.returns} />
            <Metric label={ar ? "صافي المبيعات" : "Net sales"} value={data.netSales} />
            <Metric label={ar ? "التكلفة" : "Cost"} value={data.cost} />
            <Metric label={ar ? "إجمالي الربح الأساسي" : "Basic gross profit"} value={data.gross} />
            <Metric label={ar ? "المصروفات" : "Expenses"} value={data.expenses} />
            <Metric label={ar ? "صافي النتيجة الأساسية" : "Basic net result"} value={data.net} />
          </div>
          <div className="border-t border-border px-4 py-3 text-[11px] text-muted-foreground">
            {data.missingCostItems > 0
              ? ar
                ? `تنبيه: ${data.missingCostItems} بندًا بلا تكلفة مسجلة؛ الربح تقديري وقد يكون أعلى من الواقع.`
                : `Warning: ${data.missingCostItems} item lines have no recorded cost; profit may be overstated.`
              : ar
                ? "تم خصم المرتجعات، وتصفية المصروفات حسب تاريخ المصروف، واستبعاد المسودات والملغاة."
                : "Returns are deducted, expenses use expense date, and drafts/cancelled invoices are excluded."}
          </div>
        </>
      )}
    </div>
  );
}
function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border-border/70 bg-surface/50 p-4">
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className="mt-2 font-mono text-lg font-semibold">{money(value)}</div>
    </div>
  );
}

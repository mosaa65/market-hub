import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { StatementEntityType, StatementFieldKey } from "@/lib/statements/types";
import { ColumnVisibilityMenu } from "@/components/statements/column-visibility-menu";
import { loadDebtsOverview, type DebtRow } from "@/lib/statements/debts";
import { money } from "@/lib/format";

export interface DebtsReportProps {
  ar: boolean;
  onBack: () => void;
}

const customerColumns: { key: StatementFieldKey; ar: string; en: string }[] = [
  { key: "description", ar: "العميل", en: "Customer" },
  { key: "debit", ar: "الرصيد المستحق لنا", en: "Receivable" },
  { key: "credit", ar: "الحد الائتماني", en: "Credit limit" },
  { key: "balance", ar: "أقدم دين", en: "Oldest debt" },
  { key: "date", ar: "آخر حركة", en: "Last movement" },
  { key: "reference", ar: "مصدر الرصيد", en: "Balance source" },
];

const supplierColumns: { key: StatementFieldKey; ar: string; en: string }[] = [
  { key: "description", ar: "المورد", en: "Supplier" },
  { key: "debit", ar: "الرصيد المستحق علينا", en: "Payable" },
  { key: "balance", ar: "أقدم مستحق", en: "Oldest payable" },
  { key: "date", ar: "آخر حركة", en: "Last movement" },
  { key: "reference", ar: "مصدر الرصيد", en: "Balance source" },
];

const columnsFor = (entityType: StatementEntityType) =>
  entityType === "supplier" ? supplierColumns : customerColumns;

export function DebtsReport({ ar, onBack }: DebtsReportProps) {
  const [entityType, setEntityType] = useState<"customer" | "supplier">(() => {
    if (typeof window === "undefined") return "customer";
    return window.localStorage.getItem("market_hub_debts_entity_v1") === "supplier" ? "supplier" : "customer";
  });
  const [rows, setRows] = useState<DebtRow[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const reportColumns = useMemo(() => columnsFor(entityType), [entityType]);
  const [visible, setVisible] = useState<Record<StatementFieldKey, boolean>>(() => {
    const defaults = Object.fromEntries(columnsFor("customer").map((column) => [column.key, true])) as Record<
      StatementFieldKey,
      boolean
    >;
    if (typeof window === "undefined") return defaults;
    try {
      return {
        ...defaults,
        ...JSON.parse(window.localStorage.getItem("market_hub_report_columns_debts_v1") ?? "{}"),
      };
    } catch {
      return defaults;
    }
  });

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem("market_hub_report_columns_debts_v1", JSON.stringify(visible));
      window.localStorage.setItem("market_hub_debts_entity_v1", entityType);
    }
  }, [entityType, visible]);

  useEffect(() => {
    const defaults = Object.fromEntries(reportColumns.map((column) => [column.key, true])) as Record<StatementFieldKey, boolean>;
    setVisible((current) => ({ ...defaults, ...current }));
  }, [reportColumns]);
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await loadDebtsOverview(entityType, ar ? "ar" : "en");
      setRows(result.rows);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [ar, entityType]);
  useEffect(() => {
    void load();
  }, [load]);
  const filtered = useMemo(() => {
    const value = query.trim().toLowerCase();
    return value
      ? rows.filter((row) => `${row.name} ${row.phone ?? ""}`.toLowerCase().includes(value))
      : rows;
  }, [query, rows]);
  const options = reportColumns.map((column) => ({ key: column.key, label: ar ? column.ar : column.en }));
  const visibleCount = Math.max(options.filter((column) => visible[column.key]).length, 1);

  return (
    <div className="panel-elevated overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4">
        <div>
          <h2 className="text-sm font-semibold">
            {entityType === "supplier" ? (ar ? "مستحقات الموردين" : "Supplier payables") : ar ? "ديون العملاء" : "Customer debts"}
          </h2>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {ar
              ? entityType === "supplier"
                ? "الرصيد مشتق من فواتير المشتريات والمرتجعات والمدفوع المرافق"
                : "الرصيد محسوب من دفتر حركة العميل وليس من الرصيد المخزن"
              : entityType === "supplier"
                ? "Derived from purchase invoices, returns and bundled payments"
                : "Calculated from the customer ledger, not cached balances"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <div className="flex rounded-md border-border bg-surface-2 p-0.5">
            <Button size="sm" variant={entityType === "customer" ? "default" : "ghost"} onClick={() => setEntityType("customer")}>
              {ar ? "ديون العملاء" : "Customer debts"}
            </Button>
            <Button size="sm" variant={entityType === "supplier" ? "default" : "ghost"} onClick={() => setEntityType("supplier")}>
              {ar ? "مستحقات الموردين" : "Supplier payables"}
            </Button>
          </div>
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={ar ? "بحث عن جهة" : "Search party"}
            className="h-8 w-44 text-xs"
          />
          <ColumnVisibilityMenu
            columns={options}
            visible={visible}
            onChange={(key, value) => setVisible((current) => ({ ...current, [key]: value }))}
            label={ar ? "الأعمدة" : "Columns"}
            title={ar ? "إظهار أعمدة الكشف" : "Visible columns"}
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
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-surface-2 text-muted-foreground">
            <tr>
              {options
                .filter((column) => visible[column.key])
                .map((column) => (
                  <th key={column.key} className="px-3 py-2 text-start font-medium">
                    {column.label}
                  </th>
                ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={visibleCount} className="py-10 text-center">
                  <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={visibleCount} className="py-10 text-center text-muted-foreground">
                  {ar ? "لا توجد بيانات" : "No data"}
                </td>
              </tr>
            ) : (
              filtered.map((row) => (
                <DebtRowView key={row.id} row={row} visible={visible} ar={ar} entityType={entityType} />
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function DebtRowView({
  row,
  visible,
  ar,
  entityType,
}: {
  row: DebtRow;
  visible: Record<StatementFieldKey, boolean>;
  ar: boolean;
  entityType: "customer" | "supplier";
}) {
  const cell = (key: StatementFieldKey, value: React.ReactNode, className = "") =>
    visible[key] ? <td className={`px-3 py-2 ${className}`}>{value}</td> : null;
  return (
    <tr className="border-t border-border/60">
      <>{cell("description", row.name)}</>
      <>{cell("debit", money(row.ledgerBalance), "text-end font-mono")}</>
      {entityType === "customer" && <>{cell("credit", row.creditLimit ? money(row.creditLimit) : "—", "text-end font-mono")}</>}
      <>
        {cell(
          "balance",
          row.oldestDebtDays === null ? "—" : `${row.oldestDebtDays} ${ar ? "يوم" : "days"}`,
          "text-end",
        )}
      </>
      <>
        {cell(
          "date",
          row.lastMovementAt
            ? new Date(row.lastMovementAt).toLocaleDateString(ar ? "ar-YE" : "en-GB")
            : "—",
        )}
      </>
      <>
        {cell(
          "reference",
          row.hasGap
            ? ar
              ? "دفتر مع فرق"
              : "Ledger with gap"
            : ar
              ? entityType === "supplier" ? "فواتير ومرتجعات المورد" : "دفتر العميل"
              : entityType === "supplier" ? "Supplier documents" : "Customer ledger",
        )}
      </>
    </tr>
  );
}

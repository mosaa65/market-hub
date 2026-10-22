import { ModuleGuard } from "@/lib/modules";
import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/page-header";
import { useI18n } from "@/lib/i18n";
import { supabase } from "@/integrations/supabase/client";
import { getCompanyCurrencySymbol, money } from "@/lib/format";
import { printReport } from "@/lib/pdf";
import { exportToCSV } from "@/lib/excel-export";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Printer, Scale, FileSpreadsheet } from "lucide-react";

/**
 * T-13: ميزان المراجعة من دفتر الأستاذ — لا من جداول تشغيلية.
 *
 * المصدر الوحيد: عرض `trial_balance` في القاعدة، وهو مشتق من سطور
 * journal_lines للقيود POSTED/REVERSED (العكس يقابل الأصل فيتصافران).
 * الأكواد هي أكواد دليل الحسابات الحقيقية (1101، 1211، 1311…) لا أكواد مُختلقة.
 */

export const Route = createFileRoute("/_app/trial-balance")({
  head: () => ({ meta: [{ title: "ميزان المراجعة — Vortex ERP" }] }),
  component: () => (
    <ModuleGuard moduleId="advanced_accounting">
      <TrialBalancePage />
    </ModuleGuard>
  ),
});

interface TrialBalanceRow {
  code: string;
  name_ar: string;
  account_type: string;
  total_debit: number;
  total_credit: number;
  balance: number;
  natural_balance: number;
}

function TrialBalancePage() {
  const { t, lang } = useI18n();
  const [rows, setRows] = useState<TrialBalanceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadTrialBalance = useCallback(async () => {
    setLoading(true);
    setError(null);

    const { data, error: qErr } = await supabase
      .from("trial_balance" as never)
      .select("code,name_ar,account_type,total_debit,total_credit,balance,natural_balance")
      .order("code", { ascending: true });

    if (qErr) {
      setError(qErr.message);
      setRows([]);
    } else {
      setRows((data ?? []) as unknown as TrialBalanceRow[]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadTrialBalance();
  }, [loadTrialBalance]);

  const totals = useMemo(() => {
    const totalDebit = rows.reduce((a, r) => a + Number(r.total_debit), 0);
    const totalCredit = rows.reduce((a, r) => a + Number(r.total_credit), 0);
    const difference = Math.abs(totalDebit - totalCredit);
    return { totalDebit, totalCredit, difference, isBalanced: difference < 0.005 };
  }, [rows]);

  function handlePrintPDF() {
    printReport({
      title: lang === "ar" ? "ميزان المراجعة المحاسبي" : "Trial Balance",
      subtitle: totals.isBalanced
        ? lang === "ar"
          ? "ميزان مراجعة متوازن ومطابق بالكامل"
          : "Balanced Trial Balance"
        : lang === "ar"
          ? "يوجد فارق تسوية في الأرصدة"
          : "Variance Detected",
      date: new Date().toLocaleDateString(lang === "ar" ? "ar-YE" : "en-US"),
      periodLabel:
        lang === "ar" ? "من دفتر الأستاذ — تراكمي" : "From the general ledger — cumulative",
      currency: getCompanyCurrencySymbol(),
      summaryCards: [
        {
          label: lang === "ar" ? "إجمالي المدين (Debit)" : "Total Debit",
          value: money(totals.totalDebit),
          color: "#f43f5e",
        },
        {
          label: lang === "ar" ? "إجمالي الدائن (Credit)" : "Total Credit",
          value: money(totals.totalCredit),
          color: "#10b981",
        },
        {
          label: lang === "ar" ? "فارق التسوية" : "Difference",
          value: money(totals.difference),
          color: totals.isBalanced ? "#10b981" : "#f59e0b",
        },
      ],
      columns: [
        { key: "code", header: lang === "ar" ? "رمز الحساب" : "Code" },
        { key: "name_ar", header: lang === "ar" ? "اسم الحساب المحاسبي" : "Account Name" },
        { key: "account_type", header: lang === "ar" ? "التصنيف" : "Type" },
        {
          key: "total_debit",
          header: lang === "ar" ? "أرصدة مدينة (Debit)" : "Debit",
          align: "right",
          format: "money",
        },
        {
          key: "total_credit",
          header: lang === "ar" ? "أرصدة دائنة (Credit)" : "Credit",
          align: "right",
          format: "money",
        },
        {
          key: "natural_balance",
          header: lang === "ar" ? "الرصيد الطبيعي" : "Balance",
          align: "right",
          format: "money",
        },
      ],
      rows: rows.map((r) => ({
        code: r.code,
        name_ar: r.name_ar,
        account_type: typeLabel(r.account_type),
        total_debit: Number(r.total_debit),
        total_credit: Number(r.total_credit),
        natural_balance: Number(r.natural_balance),
      })) as any,
      totalsRow: {
        code: "",
        name_ar: lang === "ar" ? "الإجمالي الكلي لميزان المراجعة" : "Grand Total",
        account_type: "",
        total_debit: totals.totalDebit,
        total_credit: totals.totalCredit,
      } as any,
      rtl: lang === "ar",
    });
  }

  function handleExportExcel() {
    exportToCSV({
      filename: `ميزان_المراجعة_${new Date().toISOString().slice(0, 10)}`,
      title: "ميزان المراجعة المحاسبي العام",
      currency: getCompanyCurrencySymbol(),
      columns: [
        { key: "code", header: "رمز الحساب" },
        { key: "name_ar", header: "اسم الحساب المحاسبي" },
        { key: "account_type", header: "تصنيف الحساب" },
        { key: "total_debit", header: "أرصدة مدينة (Debit)", format: "money" },
        { key: "total_credit", header: "أرصدة دائنة (Credit)", format: "money" },
        { key: "natural_balance", header: "الرصيد الطبيعي", format: "money" },
      ],
      rows: rows.map((r) => ({
        code: r.code,
        name_ar: r.name_ar,
        account_type: typeLabel(r.account_type),
        total_debit: Number(r.total_debit),
        total_credit: Number(r.total_credit),
        natural_balance: Number(r.natural_balance),
      })) as any,
      totalsRow: {
        code: "",
        name_ar: "الإجمالي الكلي لميزان المراجعة",
        account_type: "",
        total_debit: totals.totalDebit,
        total_credit: totals.totalCredit,
      } as any,
      rtl: lang === "ar",
    });
  }

  const typeLabel = (type: string) => {
    switch (type) {
      case "ASSET":
        return lang === "ar" ? "أصول" : "Asset";
      case "LIABILITY":
        return lang === "ar" ? "خصوم" : "Liability";
      case "EQUITY":
        return lang === "ar" ? "حقوق ملكية" : "Equity";
      case "REVENUE":
        return lang === "ar" ? "إيرادات" : "Revenue";
      case "EXPENSE":
        return lang === "ar" ? "مصروفات" : "Expense";
      default:
        return type;
    }
  };

  return (
    <>
      <PageHeader
        title={lang === "ar" ? "ميزان المراجعة المحاسبي" : "Trial Balance"}
        subtitle={
          lang === "ar"
            ? "مبني على القيود المرحّلة في دفتر الأستاذ — مصدر واحد للحقيقة"
            : "Built from posted journal entries — single source of truth"
        }
        actions={
          <div className="flex items-center gap-2">
            <Button
              onClick={handleExportExcel}
              variant="outline"
              className="gap-2 text-emerald-500 border-emerald-500/30 hover:bg-emerald-500/10"
            >
              <FileSpreadsheet className="h-4 w-4" />
              {lang === "ar" ? "تصدير Excel" : "Export Excel"}
            </Button>
            <Button onClick={handlePrintPDF} className="gap-2 bg-primary">
              <Printer className="h-4 w-4" />
              {lang === "ar" ? "طباعة PDF فاخر" : "Print PDF"}
            </Button>
          </div>
        }
      />

      <div className="space-y-4">
        {/* Verification Status Card */}
        <div
          className={`panel-elevated p-4 border-l-4 ${totals.isBalanced ? "border-l-emerald-500 bg-emerald-500/5" : "border-l-amber-500 bg-amber-500/5"}`}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Scale
                className={`h-6 w-6 ${totals.isBalanced ? "text-emerald-500" : "text-amber-500"}`}
              />
              <div>
                <h4 className="font-bold text-sm">
                  {totals.isBalanced
                    ? lang === "ar"
                      ? "✓ ميزان المراجعة متوازن ومطابق بالكامل"
                      : "Trial balance is fully balanced"
                    : lang === "ar"
                      ? "⚠️ يوجد فارق تسوية في الأرصدة التراكمية"
                      : "Trial balance variance detected"}
                </h4>
                <p className="text-xs text-muted-foreground">
                  {lang === "ar"
                    ? "إجمالي المدين يطابق إجمالي الدائن عبر الشجرة الحسابية"
                    : "Total debits equal total credits across all operational accounts"}
                </p>
              </div>
            </div>
            <div className="text-end">
              <div className="text-xs text-muted-foreground">
                {lang === "ar" ? "الفارق:" : "Difference:"}
              </div>
              <div className="font-mono font-bold text-sm">{money(totals.difference)}</div>
            </div>
          </div>
        </div>

        {/* Table */}
        <div className="panel-elevated p-4">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-24">{lang === "ar" ? "رمز الحساب" : "Code"}</TableHead>
                  <TableHead>{lang === "ar" ? "اسم الحساب المحاسبي" : "Account Name"}</TableHead>
                  <TableHead>{lang === "ar" ? "التصنيف" : "Type"}</TableHead>
                  <TableHead className="text-end text-rose-500 font-semibold">
                    {lang === "ar" ? "أرصدة مدينة (Debit)" : "Debit"}
                  </TableHead>
                  <TableHead className="text-end text-emerald-500 font-semibold">
                    {lang === "ar" ? "أرصدة دائنة (Credit)" : "Credit"}
                  </TableHead>
                  <TableHead className="text-end">{lang === "ar" ? "الرصيد" : "Balance"}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                      {t("common.loading")}
                    </TableCell>
                  </TableRow>
                ) : error ? (
                  <TableRow>
                    <TableCell colSpan={6} className="py-8 text-center text-rose-500 text-sm">
                      {error}
                    </TableCell>
                  </TableRow>
                ) : rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                      {lang === "ar"
                        ? "لا قيود مرحّلة بعد — الميزان فارغ لأن الدفتر فارغ"
                        : "No posted entries yet — the ledger is empty"}
                    </TableCell>
                  </TableRow>
                ) : (
                  rows.map((r) => (
                    <TableRow key={r.code} className="hover:bg-surface-2/60">
                      <TableCell className="font-mono text-xs font-bold text-primary">
                        {r.code}
                      </TableCell>
                      <TableCell className="font-medium text-xs">{r.name_ar}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {typeLabel(r.account_type)}
                      </TableCell>
                      <TableCell className="text-end font-mono text-rose-400">
                        {Number(r.total_debit) !== 0 ? money(Number(r.total_debit)) : "—"}
                      </TableCell>
                      <TableCell className="text-end font-mono text-emerald-400">
                        {Number(r.total_credit) !== 0 ? money(Number(r.total_credit)) : "—"}
                      </TableCell>
                      <TableCell className="text-end font-mono">
                        {money(Number(r.natural_balance))}
                      </TableCell>
                    </TableRow>
                  ))
                )}
                <TableRow className="border-t-2 border-border font-bold bg-surface-2/40">
                  <TableCell colSpan={3} className="text-end text-sm">
                    {lang === "ar" ? "الإجمالي الكلي لميزان المراجعة:" : "Grand Total:"}
                  </TableCell>
                  <TableCell className="text-end font-mono text-rose-500 text-base">
                    {money(totals.totalDebit)}
                  </TableCell>
                  <TableCell className="text-end font-mono text-emerald-500 text-base">
                    {money(totals.totalCredit)}
                  </TableCell>
                  <TableCell />
                </TableRow>
              </TableBody>
            </Table>
          </div>
        </div>
      </div>
    </>
  );
}

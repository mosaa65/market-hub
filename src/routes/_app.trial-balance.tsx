import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/page-header";
import { useI18n } from "@/lib/i18n";
import { supabase } from "@/integrations/supabase/client";
import { money } from "@/lib/format";
import { printReport } from "@/lib/pdf";
import { exportToCSV } from "@/lib/excel-export";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Printer, Scale, FileSpreadsheet } from "lucide-react";

export const Route = createFileRoute("/_app/trial-balance")({
  head: () => ({ meta: [{ title: "ميزان المراجعة — Vortex ERP" }] }),
  component: TrialBalancePage,
});

interface TrialBalanceAccount {
  accountCode: string;
  accountName: string;
  type: "asset" | "liability" | "equity" | "revenue" | "expense";
  debit: number;
  credit: number;
}

function TrialBalancePage() {
  const { t, lang } = useI18n();
  const [accounts, setAccounts] = useState<TrialBalanceAccount[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void loadTrialBalance();
  }, []);

  async function loadTrialBalance() {
    setLoading(true);
    const [sales, purchases, expenses, customers, suppliers, inv] = await Promise.all([
      supabase.from("sales_invoices").select("total,paid"),
      supabase.from("purchase_invoices").select("total,paid"),
      supabase.from("expenses").select("amount"),
      supabase.from("customers").select("balance"),
      supabase.from("suppliers").select("balance"),
      supabase.from("inventory").select("quantity,products(cost_price)"),
    ]);

    const salesTotal = (sales.data ?? []).reduce((a, r) => a + Number(r.total), 0);
    const salesPaidCash = (sales.data ?? []).reduce((a, r) => a + Number(r.paid), 0);

    const purchaseTotal = (purchases.data ?? []).reduce((a, r) => a + Number(r.total), 0);
    const purchasePaidCash = (purchases.data ?? []).reduce((a, r) => a + Number(r.paid), 0);

    const expensesTotal = (expenses.data ?? []).reduce((a, r) => a + Number(r.amount), 0);
    const receivables = (customers.data ?? []).reduce((a, c) => a + Math.max(0, Number(c.balance || 0)), 0);
    const payables = (suppliers.data ?? []).reduce((a, s) => a + Math.max(0, Number(s.balance || 0)), 0);
    const inventoryValuation = (inv.data ?? []).reduce((a, i: any) => a + (Number(i.quantity) * Number(i.products?.cost_price || 0)), 0);
    const netCashOnHand = Math.max(0, salesPaidCash - purchasePaidCash - expensesTotal);

    const result: TrialBalanceAccount[] = [
      {
        accountCode: "1010",
        accountName: lang === "ar" ? "حساب النقدية والصندوق" : "Cash & Treasury Fund",
        type: "asset",
        debit: netCashOnHand,
        credit: 0,
      },
      {
        accountCode: "1020",
        accountName: lang === "ar" ? "حساب الذمم المدينة (العملاء)" : "Accounts Receivable (Customers)",
        type: "asset",
        debit: receivables,
        credit: 0,
      },
      {
        accountCode: "1030",
        accountName: lang === "ar" ? "حساب تقييم المخزون السلعي" : "Merchandise Inventory",
        type: "asset",
        debit: inventoryValuation,
        credit: 0,
      },
      {
        accountCode: "2010",
        accountName: lang === "ar" ? "حساب الذمم الدائنة (الموردون)" : "Accounts Payable (Suppliers)",
        type: "liability",
        debit: 0,
        credit: payables,
      },
      {
        accountCode: "4010",
        accountName: lang === "ar" ? "إجمالي إيرادات المبيعات" : "Total Sales Revenue",
        type: "revenue",
        debit: 0,
        credit: salesTotal,
      },
      {
        accountCode: "5010",
        accountName: lang === "ar" ? "تكلفة المشتريات والبضاعة" : "Cost of Purchases & Goods",
        type: "expense",
        debit: purchaseTotal,
        credit: 0,
      },
      {
        accountCode: "5020",
        accountName: lang === "ar" ? "المصروفات التشغيلية والإدارية" : "Operating & Admin Expenses",
        type: "expense",
        debit: expensesTotal,
        credit: 0,
      },
    ];

    setAccounts(result);
    setLoading(false);
  }

  const totals = useMemo(() => {
    const totalDebit = accounts.reduce((a, r) => a + r.debit, 0);
    const totalCredit = accounts.reduce((a, r) => a + r.credit, 0);
    const difference = Math.abs(totalDebit - totalCredit);
    return { totalDebit, totalCredit, difference, isBalanced: difference < 1 };
  }, [accounts]);

  function handlePrintPDF() {
    printReport({
      title: lang === "ar" ? "ميزان المراجعة المحاسبي" : "Trial Balance",
      subtitle: totals.isBalanced ? (lang === "ar" ? "ميزان مراجعة متوازن ومطابق بالكامل" : "Balanced Trial Balance") : (lang === "ar" ? "يوجد فارق تسوية في الأرصدة" : "Variance Detected"),
      date: new Date().toLocaleDateString(lang === "ar" ? "ar-YE" : "en-US"),
      periodLabel: lang === "ar" ? "مطابقة أرصدة الشجرة الحسابية" : "General Ledger Verification",
      currency: "﷼",
      summaryCards: [
        { label: lang === "ar" ? "إجمالي المدين (Debit)" : "Total Debit", value: money(totals.totalDebit), color: "#f43f5e" },
        { label: lang === "ar" ? "إجمالي الدائن (Credit)" : "Total Credit", value: money(totals.totalCredit), color: "#10b981" },
        { label: lang === "ar" ? "فارق التسوية" : "Difference", value: money(totals.difference), color: totals.isBalanced ? "#10b981" : "#f59e0b" },
      ],
      columns: [
        { key: "accountCode", header: lang === "ar" ? "رمز الحساب" : "Code" },
        { key: "accountName", header: lang === "ar" ? "اسم الحساب المحاسبي" : "Account Name" },
        { key: "type", header: lang === "ar" ? "التصنيف" : "Type" },
        { key: "debit", header: lang === "ar" ? "أرصدة مدينة (Debit)" : "Debit", align: "right", format: "money" },
        { key: "credit", header: lang === "ar" ? "أرصدة دائنة (Credit)" : "Credit", align: "right", format: "money" },
      ],
      rows: accounts as any,
      totalsRow: {
        accountCode: "",
        accountName: lang === "ar" ? "الإجمالي الكلي لميزان المراجعة" : "Grand Total",
        type: "",
        debit: totals.totalDebit,
        credit: totals.totalCredit,
      } as any,
      rtl: lang === "ar",
    });
  }

  function handleExportExcel() {
    exportToCSV({
      filename: `ميزان_المراجعة_${new Date().toISOString().slice(0, 10)}`,
      title: "ميزان المراجعة المحاسبي العام",
      currency: "﷼",
      columns: [
        { key: "accountCode", header: "رمز الحساب" },
        { key: "accountName", header: "اسم الحساب المحاسبي" },
        { key: "type", header: "تصنيف الحساب" },
        { key: "debit", header: "أرصدة مدينة (Debit)", format: "money" },
        { key: "credit", header: "أرصدة دائنة (Credit)", format: "money" },
      ],
      rows: accounts as any,
      totalsRow: {
        accountCode: "",
        accountName: "الإجمالي الكلي لميزان المراجعة",
        type: "",
        debit: totals.totalDebit,
        credit: totals.totalCredit,
      } as any,
      rtl: lang === "ar",
    });
  }

  return (
    <>
      <PageHeader
        title={lang === "ar" ? "ميزان المراجعة المحاسبي" : "Trial Balance"}
        subtitle={lang === "ar" ? "مطابقة وتوازن الحسابات والذمم والأرصدة المدينة والدائنة" : "General ledger accounts verification & debit/credit balance statement"}
        actions={
          <div className="flex items-center gap-2">
            <Button onClick={handleExportExcel} variant="outline" className="gap-2 text-emerald-500 border-emerald-500/30 hover:bg-emerald-500/10">
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
        <div className={`panel-elevated p-4 border-l-4 ${totals.isBalanced ? "border-l-emerald-500 bg-emerald-500/5" : "border-l-amber-500 bg-amber-500/5"}`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Scale className={`h-6 w-6 ${totals.isBalanced ? "text-emerald-500" : "text-amber-500"}`} />
              <div>
                <h4 className="font-bold text-sm">
                  {totals.isBalanced
                    ? (lang === "ar" ? "✓ ميزان المراجعة متوازن ومطابق بالكامل" : "Trial balance is fully balanced")
                    : (lang === "ar" ? "⚠️ يوجد فارق تسوية في الأرصدة التراكمية" : "Trial balance variance detected")}
                </h4>
                <p className="text-xs text-muted-foreground">
                  {lang === "ar" ? "إجمالي المدين يطابق إجمالي الدائن عبر الشجرة الحسابية" : "Total debits equal total credits across all operational accounts"}
                </p>
              </div>
            </div>
            <div className="text-end">
              <div className="text-xs text-muted-foreground">{lang === "ar" ? "الفارق:" : "Difference:"}</div>
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
                  <TableHead className="text-end text-rose-500 font-semibold">{lang === "ar" ? "أرصدة مدينة (Debit)" : "Debit"}</TableHead>
                  <TableHead className="text-end text-emerald-500 font-semibold">{lang === "ar" ? "أرصدة دائنة (Credit)" : "Credit"}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                      {t("common.loading")}
                    </TableCell>
                  </TableRow>
                ) : (
                  accounts.map((acc) => (
                    <TableRow key={acc.accountCode} className="hover:bg-surface-2/60">
                      <TableCell className="font-mono text-xs font-bold text-primary">{acc.accountCode}</TableCell>
                      <TableCell className="font-medium text-xs">{acc.accountName}</TableCell>
                      <TableCell className="text-xs text-muted-foreground capitalize">{acc.type}</TableCell>
                      <TableCell className="text-end font-mono text-rose-400">
                        {acc.debit > 0 ? money(acc.debit) : "—"}
                      </TableCell>
                      <TableCell className="text-end font-mono text-emerald-400">
                        {acc.credit > 0 ? money(acc.credit) : "—"}
                      </TableCell>
                    </TableRow>
                  ))
                )}
                <TableRow className="border-t-2 border-border font-bold bg-surface-2/40">
                  <TableCell colSpan={3} className="text-end text-sm">
                    {lang === "ar" ? "الإجمالي الكلي لميزان المراجعة:" : "Grand Total:"}
                  </TableCell>
                  <TableCell className="text-end font-mono text-rose-500 text-base">{money(totals.totalDebit)}</TableCell>
                  <TableCell className="text-end font-mono text-emerald-500 text-base">{money(totals.totalCredit)}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        </div>
      </div>
    </>
  );
}

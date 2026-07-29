import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/page-header";
import { useI18n } from "@/lib/i18n";
import { supabase } from "@/integrations/supabase/client";
import { money } from "@/lib/format";
import { printFinancialStatement } from "@/lib/pdf";
import { exportToCSV } from "@/lib/excel-export";
import { Button } from "@/components/ui/button";
import { Printer, Landmark, Wallet, FileSpreadsheet } from "lucide-react";

export const Route = createFileRoute("/_app/balance-sheet")({
  head: () => ({ meta: [{ title: "الميزانية العمومية — Vortex ERP" }] }),
  component: BalanceSheetPage,
});

function BalanceSheetPage() {
  const { t, lang } = useI18n();
  const [loading, setLoading] = useState(true);
  const [bs, setBs] = useState({
    cashOnHand: 0,
    receivables: 0,
    inventoryValue: 0,
    totalAssets: 0,
    payables: 0,
    totalLiabilities: 0,
    equity: 0,
    totalLiabilitiesAndEquity: 0,
  });

  useEffect(() => {
    void loadBalanceSheet();
  }, []);

  async function loadBalanceSheet() {
    setLoading(true);
    const [sales, purchases, expenses, customers, suppliers, inv] = await Promise.all([
      supabase.from("sales_invoices").select("total,paid"),
      supabase.from("purchase_invoices").select("total,paid"),
      supabase.from("expenses").select("amount"),
      supabase.from("customers").select("balance"),
      supabase.from("suppliers").select("balance"),
      supabase.from("inventory").select("quantity,products(cost_price)"),
    ]);

    const salesPaidCash = (sales.data ?? []).reduce((a, r) => a + Number(r.paid), 0);
    const purchasePaidCash = (purchases.data ?? []).reduce((a, r) => a + Number(r.paid), 0);
    const expensesTotal = (expenses.data ?? []).reduce((a, r) => a + Number(r.amount), 0);

    const cashOnHand = Math.max(0, salesPaidCash - purchasePaidCash - expensesTotal);
    const receivables = (customers.data ?? []).reduce((a, c) => a + Math.max(0, Number(c.balance || 0)), 0);
    const inventoryValue = (inv.data ?? []).reduce((a, i: any) => a + (Number(i.quantity) * Number(i.products?.cost_price || 0)), 0);
    const totalAssets = cashOnHand + receivables + inventoryValue;

    const payables = (suppliers.data ?? []).reduce((a, s) => a + Math.max(0, Number(s.balance || 0)), 0);
    const totalLiabilities = payables;

    const equity = totalAssets - totalLiabilities;
    const totalLiabilitiesAndEquity = totalLiabilities + equity;

    setBs({
      cashOnHand,
      receivables,
      inventoryValue,
      totalAssets,
      payables,
      totalLiabilities,
      equity,
      totalLiabilitiesAndEquity,
    });
    setLoading(false);
  }

  function handlePrintPDF() {
    printFinancialStatement({
      title: lang === "ar" ? "الميزانية العمومية والمركز المالي" : "Balance Sheet Statement",
      subtitle: lang === "ar" ? "تجميع وتقييم الأصول مقابل الخصوم وحقوق الملكية للمؤسسة" : "Assets, Liabilities, and Owner's Equity",
      periodLabel: lang === "ar" ? `بتاريخ: ${new Date().toLocaleDateString("ar-YE")}` : `As of ${new Date().toLocaleDateString()}`,
      currency: "﷼",
      twoColumn: true,
      columnTitles: [
        lang === "ar" ? "الأصول والموجودات (Assets)" : "Assets",
        lang === "ar" ? "الخصوم وحقوق الملكية (Liabilities & Equity)" : "Liabilities & Equity",
      ],
      sections: [
        {
          title: lang === "ar" ? "الأصول المتداولة" : "Current Assets",
          items: [
            { label: lang === "ar" ? "النقدية بالصندوق والبنك" : "Cash & Bank Balances", value: bs.cashOnHand },
            { label: lang === "ar" ? "ذمم مدينة (حقوق لدى العملاء)" : "Accounts Receivable", value: bs.receivables },
            { label: lang === "ar" ? "مخزون البضائع والسلع (بالتكلفة)" : "Merchandise Inventory", value: bs.inventoryValue },
          ],
          total: { label: lang === "ar" ? "إجمالي الأصول (Total Assets)" : "Total Assets", value: bs.totalAssets, color: "#10b981" },
        },
        {
          title: lang === "ar" ? "أولاً: الخصوم (الالتزامات)" : "1. Liabilities",
          items: [
            { label: lang === "ar" ? "ذمم دائنة (مستحقات للموردين)" : "Accounts Payable", value: bs.payables, color: "#f43f5e" },
          ],
        },
        {
          title: lang === "ar" ? "ثانياً: حقوق الملكية" : "2. Owner's Equity",
          items: [
            { label: lang === "ar" ? "صافي حقوق الملكية ورأس المال" : "Owner's Net Equity", value: bs.equity, color: "#10b981" },
          ],
          total: { label: lang === "ar" ? "إجمالي الخصوم وحقوق الملكية" : "Total Liabilities & Equity", value: bs.totalLiabilitiesAndEquity, color: "#b8935a" },
        },
      ],
      rtl: lang === "ar",
    });
  }

  function handleExportExcel() {
    exportToCSV({
      filename: `الميزانية_العمومية_${new Date().toISOString().slice(0, 10)}`,
      title: "بيان الميزانية العمومية والمركز المالي",
      currency: "﷼",
      columns: [
        { key: "category", header: "التصنيف المحاسبي" },
        { key: "item", header: "بند الميزانية العمومية" },
        { key: "amount", header: "القيمة المالية بالريال اليمني", format: "money" },
      ],
      rows: [
        { category: "الأصول", item: "النقدية بالصندوق والبنك", amount: bs.cashOnHand },
        { category: "الأصول", item: "ذمم مدينة (حقوق لدى العملاء)", amount: bs.receivables },
        { category: "الأصول", item: "مخزون البضائع والسلع (بالتكلفة)", amount: bs.inventoryValue },
        { category: "الخصوم", item: "ذمم دائنة (مستحقات للموردين)", amount: bs.payables },
        { category: "حقوق الملكية", item: "صافي حقوق الملكية ورأس المال الأسمي", amount: bs.equity },
      ],
      totalsRow: {
        category: "التوازن",
        item: "إجمالي الأصول / إجمالي الخصوم وحقوق الملكية",
        amount: bs.totalAssets,
      },
      rtl: lang === "ar",
    });
  }

  return (
    <>
      <PageHeader
        title={lang === "ar" ? "الميزانية العمومية والمركز المالي" : "Balance Sheet Statement"}
        subtitle={lang === "ar" ? "تجميع وتقييم الأصول والخصوم وحقوق الملكية للمؤسسة" : "Assets, Liabilities, and Owner's Equity statement"}
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
        {/* Main Grid: Assets vs Liabilities & Equity */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* ASSETS */}
          <div className="panel-elevated p-6 space-y-4 border-t-4 border-t-emerald-500">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <h3 className="font-bold text-base flex items-center gap-2 text-emerald-400">
                <Wallet className="h-5 w-5" />
                {lang === "ar" ? "الأصول والموجودات (Assets)" : "Assets"}
              </h3>
              <span className="text-xs text-muted-foreground">{lang === "ar" ? "الموجودات الحالية" : "Current Assets"}</span>
            </div>

            <div className="space-y-3 text-sm">
              <div className="flex justify-between py-2 border-b border-border/40">
                <span>{lang === "ar" ? "النقدية بالصندوق والبنك" : "Cash & Bank Balances"}</span>
                <span className="font-mono font-semibold">{money(bs.cashOnHand)}</span>
              </div>
              <div className="flex justify-between py-2 border-b border-border/40">
                <span>{lang === "ar" ? "ذمم مدينة (حقوق لدى العملاء)" : "Accounts Receivable (Customers)"}</span>
                <span className="font-mono font-semibold">{money(bs.receivables)}</span>
              </div>
              <div className="flex justify-between py-2 border-b border-border/40">
                <span>{lang === "ar" ? "مخزون البضائع والسلع (بالتكلفة)" : "Merchandise Inventory"}</span>
                <span className="font-mono font-semibold">{money(bs.inventoryValue)}</span>
              </div>

              <div className="pt-4">
                <div className="flex justify-between py-3 px-4 rounded-xl bg-emerald-500/15 border border-emerald-500/30 font-bold text-base text-emerald-400">
                  <span>{lang === "ar" ? "إجمالي الأصول (Total Assets)" : "Total Assets"}</span>
                  <span className="font-mono">{money(bs.totalAssets)}</span>
                </div>
              </div>
            </div>
          </div>

          {/* LIABILITIES & EQUITY */}
          <div className="panel-elevated p-6 space-y-4 border-t-4 border-t-amber-500">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <h3 className="font-bold text-base flex items-center gap-2 text-amber-400">
                <Landmark className="h-5 w-5" />
                {lang === "ar" ? "الخصوم وحقوق الملكية (Liabilities & Equity)" : "Liabilities & Equity"}
              </h3>
              <span className="text-xs text-muted-foreground">{lang === "ar" ? "الالتزامات وحقوق التاجر" : "Claims & Equity"}</span>
            </div>

            <div className="space-y-3 text-sm">
              <div className="font-semibold text-xs text-muted-foreground uppercase">{lang === "ar" ? "أولاً: الخصوم (الالتزامات)" : "1. Liabilities"}</div>
              <div className="flex justify-between py-2 border-b border-border/40 text-rose-400">
                <span>{lang === "ar" ? "ذمم دائنة (مستحقات للموردين)" : "Accounts Payable (Suppliers)"}</span>
                <span className="font-mono font-semibold">{money(bs.payables)}</span>
              </div>

              <div className="pt-2 font-semibold text-xs text-muted-foreground uppercase">{lang === "ar" ? "ثانياً: حقوق الملكية" : "2. Owner's Equity"}</div>
              <div className="flex justify-between py-2 border-b border-border/40 text-emerald-400">
                <span>{lang === "ar" ? "صافي حقوق الملكية ورأس المال الأسمي" : "Owner's Net Equity"}</span>
                <span className="font-mono font-semibold">{money(bs.equity)}</span>
              </div>

              <div className="pt-4">
                <div className="flex justify-between py-3 px-4 rounded-xl bg-amber-500/15 border border-amber-500/30 font-bold text-base text-amber-400">
                  <span>{lang === "ar" ? "إجمالي الخصوم وحقوق الملكية" : "Total Liabilities & Equity"}</span>
                  <span className="font-mono">{money(bs.totalLiabilitiesAndEquity)}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

import { ModuleGuard } from "@/lib/modules";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/page-header";
import { useI18n } from "@/lib/i18n";
import { supabase } from "@/integrations/supabase/client";
import { money } from "@/lib/format";
import { printFinancialStatement } from "@/lib/pdf";
import { exportToCSV } from "@/lib/excel-export";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Printer, FileSpreadsheet } from "lucide-react";

export const Route = createFileRoute("/_app/income-statement")({
  head: () => ({ meta: [{ title: "قائمة الدخل والأرباح — Vortex ERP" }] }),
  component: () => (
    <ModuleGuard moduleId="advanced_accounting">
      <IncomeStatementPage />
    </ModuleGuard>
  ),
});

function defaultRange() {
  const to = new Date();
  const from = new Date();
  from.setMonth(from.getMonth() - 1);
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

function IncomeStatementPage() {
  const { t, lang } = useI18n();
  const [range, setRange] = useState(defaultRange());
  const [loading, setLoading] = useState(true);
  const [pnl, setPnl] = useState({
    salesTotal: 0,
    salesDiscounts: 0,
    netRevenue: 0,
    cogs: 0,
    grossProfit: 0,
    operatingExpenses: 0,
    netProfit: 0,
  });

  useEffect(() => {
    void loadIncomeStatement();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- loadIncomeStatement يقرأ range.from و range.to فقط في الاعتماديات
  }, [range.from, range.to]);

  async function loadIncomeStatement() {
    setLoading(true);
    const fromTs = `${range.from}T00:00:00`;
    const toTs = `${range.to}T23:59:59`;

    const [salesRes, itemsRes, expRes] = await Promise.all([
      supabase
        .from("sales_invoices")
        .select("total,subtotal,discount,tax")
        .gte("created_at", fromTs)
        .lte("created_at", toTs),
      supabase
        .from("sales_invoice_items")
        .select("quantity,unit_price,products(cost_price),sales_invoices!inner(created_at)")
        .gte("sales_invoices.created_at", fromTs)
        .lte("sales_invoices.created_at", toTs),
      supabase.from("expenses").select("amount").gte("created_at", fromTs).lte("created_at", toTs),
    ]);

    const sales = salesRes.data ?? [];
    const salesTotal = sales.reduce((a, r) => a + Number(r.subtotal), 0);
    const salesDiscounts = sales.reduce((a, r) => a + Number(r.discount), 0);
    const netRevenue = salesTotal - salesDiscounts;

    const cogs = (itemsRes.data ?? []).reduce((a, it: any) => {
      const cost = Number(it.products?.cost_price || 0);
      return a + Number(it.quantity) * cost;
    }, 0);

    const grossProfit = netRevenue - cogs;
    const operatingExpenses = (expRes.data ?? []).reduce((a, r) => a + Number(r.amount), 0);
    const netProfit = grossProfit - operatingExpenses;

    setPnl({
      salesTotal,
      salesDiscounts,
      netRevenue,
      cogs,
      grossProfit,
      operatingExpenses,
      netProfit,
    });
    setLoading(false);
  }

  function handlePrintPDF() {
    printFinancialStatement({
      title: lang === "ar" ? "قائمة الدخل والأرباح والخسائر" : "Income Statement (P&L)",
      subtitle:
        lang === "ar"
          ? "تقرير نتائج الأعمال التشغيلية للفترة المالية"
          : "Statement of Income & Expenses",
      periodLabel:
        lang === "ar"
          ? `الفترة من ${range.from} إلى ${range.to}`
          : `Period ${range.from} to ${range.to}`,
      currency: "﷼",
      sections: [
        {
          title: lang === "ar" ? "1. إيرادات المبيعات والنشاط" : "1. Sales Revenue",
          items: [
            {
              label: lang === "ar" ? "إجمالي إيرادات المبيعات" : "Gross Sales",
              value: pnl.salesTotal,
            },
            {
              label: lang === "ar" ? "يخصم: الخصومات الممنوحة" : "Less: Sales Discounts",
              value: pnl.salesDiscounts,
              color: "#f43f5e",
            },
          ],
          total: {
            label: lang === "ar" ? "صافي إيرادات المبيعات (Net Revenue)" : "Net Sales Revenue",
            value: pnl.netRevenue,
            color: "#b8935a",
          },
        },
        {
          title: lang === "ar" ? "2. تكلفة البضاعة المباعة (COGS)" : "2. Cost of Goods Sold",
          items: [
            {
              label: lang === "ar" ? "تكلفة شراء المنتجات المباعة" : "Cost of Products Sold",
              value: pnl.cogs,
              color: "#f43f5e",
            },
          ],
          total: {
            label: lang === "ar" ? "إجمالي الربح التشغيلي (Gross Profit)" : "Gross Profit",
            value: pnl.grossProfit,
            color: "#10b981",
          },
        },
        {
          title: lang === "ar" ? "3. المصروفات التشغيلية الإدارية" : "3. Operating Expenses",
          items: [
            {
              label: lang === "ar" ? "إجمالي المصروفات والنفقات" : "Operating Expenses",
              value: pnl.operatingExpenses,
              color: "#f43f5e",
            },
          ],
        },
      ],
      grandTotal: {
        label:
          lang === "ar" ? "صافي الربح / الخسارة النهائي (Net Profit)" : "Final Net Profit / Loss",
        value: pnl.netProfit,
        color: pnl.netProfit >= 0 ? "#10b981" : "#f43f5e",
      },
      rtl: lang === "ar",
    });
  }

  function handleExportExcel() {
    exportToCSV({
      filename: `قائمة_الدخل_${range.from}_إلى_${range.to}`,
      title: `قائمة الدخل والأرباح والخسائر للفترة ${range.from} - ${range.to}`,
      currency: "﷼",
      columns: [
        { key: "item", header: "بند قائمة الدخل" },
        { key: "amount", header: "المبلغ بالريال اليمني", format: "money" },
      ],
      rows: [
        { item: "إجمالي إيرادات المبيعات", amount: pnl.salesTotal },
        { item: "يخصم: الخصومات الممنوحة", amount: pnl.salesDiscounts },
        { item: "صافي إيرادات المبيعات (Net Revenue)", amount: pnl.netRevenue },
        { item: "تكلفة شراء المنتجات المباعة (COGS)", amount: pnl.cogs },
        { item: "إجمالي الربح التشغيلي (Gross Profit)", amount: pnl.grossProfit },
        { item: "إجمالي المصروفات والنفقات التشغيلية", amount: pnl.operatingExpenses },
      ],
      totalsRow: {
        item: "صافي الربح / الخسارة النهائي (Net Profit)",
        amount: pnl.netProfit,
      },
      rtl: lang === "ar",
    });
  }

  return (
    <>
      <PageHeader
        title={lang === "ar" ? "قائمة الدخل الأرباح والخسائر" : "Income Statement (P&L)"}
        subtitle={
          lang === "ar"
            ? "تحليل صافي المبيعات، تكلفة المبيعات، إجمالي وصافي الربح للفترة"
            : "Net sales, Cost of Goods Sold, and Net Profit analysis"
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
        {/* Date Filter */}
        <div className="panel-elevated p-4 flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="grid gap-1">
              <Label className="text-xs">{lang === "ar" ? "من تاريخ" : "From Date"}</Label>
              <Input
                type="date"
                value={range.from}
                onChange={(e) => setRange({ ...range, from: e.target.value })}
                className="h-9 w-40"
              />
            </div>
            <div className="grid gap-1">
              <Label className="text-xs">{lang === "ar" ? "إلى تاريخ" : "To Date"}</Label>
              <Input
                type="date"
                value={range.to}
                onChange={(e) => setRange({ ...range, to: e.target.value })}
                className="h-9 w-40"
              />
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className="text-end">
              <div className="text-xs text-muted-foreground">
                {lang === "ar" ? "صافي الربح للفترة:" : "Net Profit:"}
              </div>
              <div
                className={`text-xl font-bold font-mono ${pnl.netProfit >= 0 ? "text-emerald-500" : "text-rose-500"}`}
              >
                {money(pnl.netProfit)}
              </div>
            </div>
          </div>
        </div>

        {/* P&L Statement Grid */}
        <div className="panel-elevated p-6 max-w-3xl mx-auto space-y-6">
          <div className="border-b border-border pb-4 text-center">
            <h2 className="text-lg font-bold">
              {lang === "ar" ? "قائمة الدخل للفترة المالية" : "Statement of Income & Expenses"}
            </h2>
            <p className="text-xs text-muted-foreground mt-1">
              {lang === "ar"
                ? `الفترة من ${range.from} إلى ${range.to}`
                : `Period from ${range.from} to ${range.to}`}
            </p>
          </div>

          <div className="space-y-3 text-sm">
            {/* Section 1: Revenue */}
            <div className="font-semibold text-xs text-muted-foreground uppercase tracking-wider">
              {lang === "ar" ? "1. الإيرادات والمبيعات" : "1. Sales & Revenues"}
            </div>
            <div className="flex justify-between py-1.5 border-b border-border/40">
              <span>{lang === "ar" ? "إجمالي إيرادات المبيعات" : "Gross Sales Revenue"}</span>
              <span className="font-mono">{money(pnl.salesTotal)}</span>
            </div>
            <div className="flex justify-between py-1.5 border-b border-border/40 text-muted-foreground">
              <span>{lang === "ar" ? "يخصم: الخصومات الممنوحة" : "Less: Sales Discounts"}</span>
              <span className="font-mono text-rose-400">({money(pnl.salesDiscounts)})</span>
            </div>
            <div className="flex justify-between py-2 font-bold bg-surface-2/40 px-2 rounded-md">
              <span>
                {lang === "ar" ? "صافي إيرادات المبيعات (Net Revenue)" : "Net Sales Revenue"}
              </span>
              <span className="font-mono text-primary text-base">{money(pnl.netRevenue)}</span>
            </div>

            {/* Section 2: COGS */}
            <div className="pt-3 font-semibold text-xs text-muted-foreground uppercase tracking-wider">
              {lang === "ar" ? "2. تكلفة البضاعة المباعة" : "2. Cost of Goods Sold"}
            </div>
            <div className="flex justify-between py-1.5 border-b border-border/40 text-rose-400">
              <span>
                {lang === "ar" ? "تكلفة شراء المنتجات المباعة (COGS)" : "Cost of Products Sold"}
              </span>
              <span className="font-mono">({money(pnl.cogs)})</span>
            </div>
            <div className="flex justify-between py-2 font-bold bg-emerald-500/10 text-emerald-400 px-2 rounded-md border border-emerald-500/20">
              <span>
                {lang === "ar" ? "إجمالي الربح التشغيلي (Gross Profit)" : "Gross Operating Profit"}
              </span>
              <span className="font-mono text-base">{money(pnl.grossProfit)}</span>
            </div>

            {/* Section 3: Operating Expenses */}
            <div className="pt-3 font-semibold text-xs text-muted-foreground uppercase tracking-wider">
              {lang === "ar" ? "3. المصروفات التشغيلية الإدارية" : "3. Operating Expenses"}
            </div>
            <div className="flex justify-between py-1.5 border-b border-border/40 text-rose-400">
              <span>
                {lang === "ar" ? "إجمالي المصروفات والنفقات" : "Total Operating Expenses"}
              </span>
              <span className="font-mono">({money(pnl.operatingExpenses)})</span>
            </div>

            {/* Section 4: Net Profit */}
            <div className="pt-4">
              <div
                className={`flex justify-between py-3 px-4 rounded-xl border font-bold text-lg ${pnl.netProfit >= 0 ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-400" : "bg-rose-500/15 border-rose-500/40 text-rose-400"}`}
              >
                <span>
                  {lang === "ar"
                    ? "صافي الربح / الخسارة النهائي (Net Profit)"
                    : "Final Net Profit / Loss"}
                </span>
                <span className="font-mono">{money(pnl.netProfit)}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

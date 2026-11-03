import { ModuleGuard } from "@/lib/modules";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/page-header";
import { useI18n } from "@/lib/i18n";
import { supabase } from "@/integrations/supabase/client";
import { getCompanyCurrencySymbol, money } from "@/lib/format";
import { printFinancialStatement } from "@/lib/pdf";
import { exportToCSV } from "@/lib/excel-export";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Printer, FileSpreadsheet } from "lucide-react";

/**
 * T-14: قائمة الدخل من دفتر الأستاذ.
 *
 * المصدر الوحيد: سطور journal_lines للقيود POSTED مجمّعة حسب حسابات الدليل
 * الحقيقية (الإيرادات 4xxx، تكلفة المبيعات 5111، المصروفات 5xxx الأخرى).
 * المرتجعات مخصومة تلقائيًا لأن قيودها العكسية تُجمّع في نفس الحسابات.
 * الفترة تُفلتر على entry_date.
 */

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

interface LedgerAccountLine {
  code: string;
  name_ar: string;
  account_type: string;
  debit: number;
  credit: number;
}

function IncomeStatementPage() {
  const { t, lang } = useI18n();
  const [range, setRange] = useState(defaultRange());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pnl, setPnl] = useState({
    revenue: 0,
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
    setError(null);

    /*
     * سطور القيود المرحّلة داخل الفترة، مع الحساب. استعلام واحد على journal_lines
     * مع انضمام accounts وjournal_entries — بدل نداء RPC لكل بند مبيع (كان
     * Promise.all بمئات النداءات).
     */
    const { data, error: qErr } = await supabase
      .from("journal_lines" as never)
      .select(
        "debit,credit,accounts!inner(code,name_ar,account_type),journal_entries!inner(status,entry_date)",
      )
      .eq("journal_entries.status", "POSTED")
      .gte("journal_entries.entry_date", range.from)
      .lte("journal_entries.entry_date", range.to);

    if (qErr) {
      setError(qErr.message);
      setPnl({ revenue: 0, cogs: 0, grossProfit: 0, operatingExpenses: 0, netProfit: 0 });
      setLoading(false);
      return;
    }

    const byAccount = new Map<string, LedgerAccountLine>();
    for (const line of (data ?? []) as unknown as Array<{
      debit: number | null;
      credit: number | null;
      accounts: { code: string; name_ar: string; account_type: string };
    }>) {
      const code = line.accounts.code;
      const prev = byAccount.get(code) ?? {
        code,
        name_ar: line.accounts.name_ar,
        account_type: line.accounts.account_type,
        debit: 0,
        credit: 0,
      };
      prev.debit += Number(line.debit ?? 0);
      prev.credit += Number(line.credit ?? 0);
      byAccount.set(code, prev);
    }

    /*
     * الرصيد الطبيعي: الإيراد = الدائن − المدين؛ المصروف = المدين − الدائن.
     * 5111 تكلفة المبيعات تُفصَل عن باقي المصروفات (تشغيلية).
     */
    let revenue = 0;
    let cogs = 0;
    let operatingExpenses = 0;
    for (const acc of byAccount.values()) {
      if (acc.account_type === "REVENUE") {
        revenue += acc.credit - acc.debit;
      } else if (acc.account_type === "EXPENSE") {
        if (acc.code === "5111") {
          cogs += acc.debit - acc.credit;
        } else {
          operatingExpenses += acc.debit - acc.credit;
        }
      }
    }
    revenue = Math.round(revenue * 100) / 100;
    cogs = Math.round(cogs * 100) / 100;
    operatingExpenses = Math.round(operatingExpenses * 100) / 100;
    const grossProfit = revenue - cogs;
    const netProfit = grossProfit - operatingExpenses;

    setPnl({ revenue, cogs, grossProfit, operatingExpenses, netProfit });
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
      currency: getCompanyCurrencySymbol(),
      sections: [
        {
          title: lang === "ar" ? "1. الإيرادات" : "1. Revenue",
          items: [],
          total: {
            label:
              lang === "ar" ? "صافي الإيرادات (بعد المرتجعات)" : "Net Revenue (returns deducted)",
            value: pnl.revenue,
            color: "#b8935a",
          },
        },
        {
          title: lang === "ar" ? "2. تكلفة البضاعة المباعة (COGS)" : "2. Cost of Goods Sold",
          items: [],
          total: {
            label: lang === "ar" ? "إجمالي الربح" : "Gross Profit",
            value: pnl.grossProfit,
            color: "#10b981",
          },
        },
        {
          title: lang === "ar" ? "3. المصروفات التشغيلية" : "3. Operating Expenses",
          items: [],
          total: {
            label: lang === "ar" ? "إجمالي المصروفات" : "Total Operating Expenses",
            value: pnl.operatingExpenses,
            color: "#f43f5e",
          },
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
      currency: getCompanyCurrencySymbol(),
      columns: [
        { key: "item", header: "بند قائمة الدخل" },
        { key: "amount", header: "المبلغ بالعملة المحددة", format: "money" },
      ],
      rows: [
        {
          item: lang === "ar" ? "صافي الإيرادات (بعد المرتجعات)" : "Net Revenue",
          amount: pnl.revenue,
        },
        {
          item: lang === "ar" ? "تكلفة البضاعة المباعة (COGS)" : "Cost of Goods Sold",
          amount: pnl.cogs,
        },
        { item: lang === "ar" ? "إجمالي الربح" : "Gross Profit", amount: pnl.grossProfit },
        {
          item: lang === "ar" ? "المصروفات التشغيلية" : "Operating Expenses",
          amount: pnl.operatingExpenses,
        },
      ],
      totalsRow: {
        item:
          lang === "ar" ? "صافي الربح / الخسارة النهائي (Net Profit)" : "Final Net Profit / Loss",
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
              <span>
                {lang === "ar"
                  ? "صافي الإيرادات (بعد المرتجعات)"
                  : "Net Revenue (returns deducted)"}
              </span>
              <span className="font-mono">{money(pnl.revenue)}</span>
            </div>

            {/* Section 2: COGS */}
            <div className="pt-3 font-semibold text-xs text-muted-foreground uppercase tracking-wider">
              {lang === "ar" ? "2. تكلفة البضاعة المباعة" : "2. Cost of Goods Sold"}
            </div>
            <div className="flex justify-between py-1.5 border-b border-border/40 text-rose-400">
              <span>{lang === "ar" ? "تكلفة البضاعة المباعة (COGS)" : "Cost of Goods Sold"}</span>
              <span className="font-mono">({money(pnl.cogs)})</span>
            </div>
            <div className="flex justify-between py-2 font-bold bg-emerald-500/10 text-emerald-400 px-2 rounded-md border border-emerald-500/20">
              <span>{lang === "ar" ? "إجمالي الربح (Gross Profit)" : "Gross Profit"}</span>
              <span className="font-mono text-base">{money(pnl.grossProfit)}</span>
            </div>

            {/* Section 3: Operating Expenses */}
            <div className="pt-3 font-semibold text-xs text-muted-foreground uppercase tracking-wider">
              {lang === "ar" ? "3. المصروفات التشغيلية" : "3. Operating Expenses"}
            </div>
            <div className="flex justify-between py-1.5 border-b border-border/40 text-rose-400">
              <span>
                {lang === "ar" ? "إجمالي المصروفات التشغيلية" : "Total Operating Expenses"}
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

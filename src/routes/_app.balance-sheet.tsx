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
import { Printer, Landmark, Wallet, FileSpreadsheet } from "lucide-react";

/**
 * T-15: الميزانية العمومية من دفتر الأستاذ.
 *
 * المصدر الوحيد: عرض trial_balance (من journal_lines للقيود POSTED).
 * حقوق الملكية **مجموع فعلي من حسابات EQUITY في الدليل** (3111، 3911، 3921…)
 * لا الطرح المُشتق `assets − liabilities` الذي كان يجعل الميزانية متوازنة
 * بالتعريف. الفارق بين الطرفين يظهر كسطر «فارق غير مطابق» يحتاج تدقيقًا —
 * لا يُدفن في حقوق الملكية.
 * النقدية من الحسابات الفعلية (1101، 1111، 1131-1139) لا Math.max(0,...).
 *
 * T-18: أساس تقييم المخزون معروض صراحةً في الميزانية.
 * قيد المخزون في الدفتر يقابل 131x بالتكلفة التي رُحّل بها البيع/التسوية
 * (الطبقات الفعلية `item_cost_layers` عبر عرض `item_valuation`).
 * الفرق بين القيمة الدفترية وقيمة الطبقات الفعلية يُعرض كبند مطابقة منفصل
 * بدل أن يُدفن، وبجانبه أساس التقييم ACTUAL/REFERENCE_ONLY لكل صنف.
 */

export const Route = createFileRoute("/_app/balance-sheet")({
  head: () => ({ meta: [{ title: "الميزانية العمومية — Vortex ERP" }] }),
  component: () => (
    <ModuleGuard moduleId="advanced_accounting">
      <BalanceSheetPage />
    </ModuleGuard>
  ),
});

interface ValuationRow {
  product_id: string;
  sku: string | null;
  name_ar: string | null;
  on_hand_qty: number;
  valuation: number;
  actual_unit_cost: number;
  valuation_basis: string;
}

function BalanceSheetPage() {
  const { t, lang } = useI18n();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [valuation, setValuation] = useState<ValuationRow[]>([]);
  const [bs, setBs] = useState({
    cashOnHand: 0,
    receivables: 0,
    inventoryValue: 0,
    fixedAssets: 0,
    totalAssets: 0,
    payables: 0,
    accruedLiabilities: 0,
    vatPayable: 0,
    totalLiabilities: 0,
    capital: 0,
    retainedEarnings: 0,
    equity: 0,
    totalLiabilitiesAndEquity: 0,
    difference: 0,
    inventoryActualValue: 0,
    inventoryActualCount: 0,
    inventoryReferenceCount: 0,
    inventoryValuationGap: 0,
  });

  useEffect(() => {
    void loadBalanceSheet();
  }, []);

  async function loadBalanceSheet() {
    setLoading(true);
    setError(null);

    /* سطور القيود المرحّلة مجمّعة حسب الحساب — استعلام واحد. */
    const [{ data, error: qErr }, { data: valData }] = await Promise.all([
      supabase
        .from("trial_balance" as never)
        .select("code,name_ar,account_type,balance,natural_balance")
        .order("code"),
      /* T-18: طبقات التكلفة الفعلية لكل صنف — أساس التقييم وقيمته. */
      supabase
        .from("item_valuation" as never)
        .select("product_id,sku,name_ar,on_hand_qty,valuation,actual_unit_cost,valuation_basis")
        .gt("on_hand_qty", 0),
    ]);

    if (qErr) {
      setError(qErr.message);
      setLoading(false);
      return;
    }

    setValuation((valData ?? []) as unknown as ValuationRow[]);

    const rows = (data ?? []) as unknown as Array<{
      code: string;
      name_ar: string;
      account_type: string;
      balance: number;
      natural_balance: number;
    }>;

    const sumBy = (fn: (r: (typeof rows)[number]) => boolean) =>
      Math.round(rows.filter(fn).reduce((a, r) => a + Number(r.natural_balance), 0) * 100) / 100;

    /* الرصيد الطبيعي (natural_balance) موجب للأصول في الطرف المدين. */
    const cashOnHand = sumBy(
      (r) => r.account_type === "ASSET" && r.code >= "1101" && r.code <= "1139",
    );
    const receivables = sumBy((r) => r.code === "1211");
    const inventoryValue = sumBy(
      (r) => r.account_type === "ASSET" && r.code >= "1311" && r.code <= "1321",
    );
    const fixedAssets = sumBy(
      (r) => r.account_type === "ASSET" && r.code >= "1411" && r.code <= "1512",
    );
    const totalAssets = cashOnHand + receivables + inventoryValue + fixedAssets;

    const payables = sumBy((r) => r.code === "2111");
    const accruedLiabilities = sumBy((r) => r.code >= "2211" && r.code <= "2231");
    const vatPayable = sumBy((r) => r.code >= "2311" && r.code <= "2321");
    const totalLiabilities = payables + accruedLiabilities + vatPayable;

    /* حقوق الملكية: مجموع فعلي من حسابات EQUITY — لا مشتق. */
    const capital = sumBy((r) => r.code === "3111" || r.code === "3211");
    const retainedEarnings = sumBy((r) => r.code === "3911" || r.code === "3921");
    const equity = capital + retainedEarnings;
    const totalLiabilitiesAndEquity = totalLiabilities + equity;
    const difference = Math.round((totalAssets - totalLiabilitiesAndEquity) * 100) / 100;

    /* T-18: قيمة الطبقات الفعلية وأساس التقييم — تُعرض صراحةً لا تُدفن. */
    const valuationRows = (valData ?? []) as unknown as ValuationRow[];
    const inventoryActualValue =
      Math.round(
        valuationRows
          .filter((v) => v.valuation_basis === "ACTUAL")
          .reduce((a, v) => a + Number(v.valuation), 0) * 100,
      ) / 100;
    const inventoryActualCount = valuationRows.filter((v) => v.valuation_basis === "ACTUAL").length;
    const inventoryReferenceCount = valuationRows.filter(
      (v) => v.valuation_basis !== "ACTUAL",
    ).length;

    setBs({
      cashOnHand,
      receivables,
      inventoryValue,
      fixedAssets,
      totalAssets,
      payables,
      accruedLiabilities,
      vatPayable,
      totalLiabilities,
      capital,
      retainedEarnings,
      equity,
      totalLiabilitiesAndEquity,
      difference,
      inventoryActualValue,
      inventoryActualCount,
      inventoryReferenceCount,
      inventoryValuationGap: Math.round((inventoryValue - inventoryActualValue) * 100) / 100,
    });
    setLoading(false);
  }

  function handlePrintPDF() {
    printFinancialStatement({
      title: lang === "ar" ? "الميزانية العمومية والمركز المالي" : "Balance Sheet Statement",
      subtitle:
        lang === "ar"
          ? "تجميع وتقييم الأصول مقابل الخصوم وحقوق الملكية للمؤسسة"
          : "Assets, Liabilities, and Owner's Equity",
      periodLabel:
        lang === "ar"
          ? `بتاريخ: ${new Date().toLocaleDateString("ar-YE")}`
          : `As of ${new Date().toLocaleDateString()}`,
      currency: getCompanyCurrencySymbol(),
      twoColumn: true,
      columnTitles: [
        lang === "ar" ? "الأصول والموجودات (Assets)" : "Assets",
        lang === "ar" ? "الخصوم وحقوق الملكية (Liabilities & Equity)" : "Liabilities & Equity",
      ],
      sections: [
        {
          title: lang === "ar" ? "الأصول المتداولة" : "Current Assets",
          items: [
            {
              label: lang === "ar" ? "النقدية بالصندوق والبنوك والمحافظ" : "Cash, Banks & Wallets",
              value: bs.cashOnHand,
            },
            {
              label: lang === "ar" ? "ذمم مدينة (العملاء)" : "Accounts Receivable",
              value: bs.receivables,
            },
            {
              label: lang === "ar" ? "المخزون" : "Inventory",
              value: bs.inventoryValue,
            },
            {
              label: lang === "ar" ? "الأصول الثابتة والمؤجلة" : "Fixed & Deferred Assets",
              value: bs.fixedAssets,
            },
          ],
          total: {
            label: lang === "ar" ? "إجمالي الأصول (Total Assets)" : "Total Assets",
            value: bs.totalAssets,
            color: "#10b981",
          },
        },
        {
          title: lang === "ar" ? "أولاً: الخصوم (الالتزامات)" : "1. Liabilities",
          items: [
            {
              label: lang === "ar" ? "ذمم الموردين" : "Accounts Payable",
              value: bs.payables,
              color: "#f43f5e",
            },
            {
              label: lang === "ar" ? "قروض ومصروفات مستحقة" : "Loans & Accrued Liabilities",
              value: bs.accruedLiabilities,
            },
            {
              label: lang === "ar" ? "ضريبة القيمة المضافة المستحقة" : "VAT Payable",
              value: bs.vatPayable,
            },
          ],
        },
        {
          title: lang === "ar" ? "ثانياً: حقوق الملكية" : "2. Owner's Equity",
          items: [
            {
              label: lang === "ar" ? "رأس المال (ومسحوباته)" : "Capital (net of drawings)",
              value: bs.capital,
              color: "#10b981",
            },
            {
              label: lang === "ar" ? "الأرباح المحتجزة ونتيجة النشاط" : "Retained Earnings",
              value: bs.retainedEarnings,
            },
          ],
          total: {
            label: lang === "ar" ? "إجمالي الخصوم وحقوق الملكية" : "Total Liabilities & Equity",
            value: bs.totalLiabilitiesAndEquity,
            color: "#b8935a",
          },
        },
      ],
      rtl: lang === "ar",
    });
  }

  function handleExportExcel() {
    exportToCSV({
      filename: `الميزانية_العمومية_${new Date().toISOString().slice(0, 10)}`,
      title: "بيان الميزانية العمومية والمركز المالي",
      currency: getCompanyCurrencySymbol(),
      columns: [
        { key: "category", header: "التصنيف المحاسبي" },
        { key: "item", header: "بند الميزانية العمومية" },
        { key: "amount", header: "القيمة المالية بالعملة المحددة", format: "money" },
      ],
      rows: [
        { category: "الأصول", item: "النقدية بالصندوق والبنوك والمحافظ", amount: bs.cashOnHand },
        { category: "الأصول", item: "ذمم مدينة (العملاء)", amount: bs.receivables },
        { category: "الأصول", item: "المخزون", amount: bs.inventoryValue },
        { category: "الأصول", item: "الأصول الثابتة والمؤجلة", amount: bs.fixedAssets },
        { category: "الخصوم", item: "ذمم الموردين", amount: bs.payables },
        { category: "الخصوم", item: "قروض ومصروفات مستحقة", amount: bs.accruedLiabilities },
        { category: "الخصوم", item: "ضريبة القيمة المضافة المستحقة", amount: bs.vatPayable },
        { category: "حقوق الملكية", item: "رأس المال (ومسحوباته)", amount: bs.capital },
        {
          category: "حقوق الملكية",
          item: "الأرباح المحتجزة ونتيجة النشاط",
          amount: bs.retainedEarnings,
        },
      ],
      totalsRow: {
        category: "التوازن",
        item:
          bs.difference === 0
            ? "متوازنة — إجمالي الأصول = إجمالي الخصوم وحقوق الملكية"
            : `فارق غير مطابق: ${bs.difference} — يحتاج تدقيقًا`,
        amount: bs.totalAssets,
      },
      rtl: lang === "ar",
    });
  }

  return (
    <>
      <PageHeader
        title={lang === "ar" ? "الميزانية العمومية والمركز المالي" : "Balance Sheet Statement"}
        subtitle={
          lang === "ar"
            ? "تجميع وتقييم الأصول والخصوم وحقوق الملكية للمؤسسة"
            : "Assets, Liabilities, and Owner's Equity statement"
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
        {/* Main Grid: Assets vs Liabilities & Equity */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* ASSETS */}
          <div className="panel-elevated p-6 space-y-4 border-t-4 border-t-emerald-500">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <h3 className="font-bold text-base flex items-center gap-2 text-emerald-400">
                <Wallet className="h-5 w-5" />
                {lang === "ar" ? "الأصول والموجودات (Assets)" : "Assets"}
              </h3>
              <span className="text-xs text-muted-foreground">
                {lang === "ar" ? "الموجودات الحالية" : "Current Assets"}
              </span>
            </div>

            <div className="space-y-3 text-sm">
              <div className="flex justify-between py-2 border-b border-border/40">
                <span>
                  {lang === "ar" ? "النقدية بالصندوق والبنوك والمحافظ" : "Cash, Banks & Wallets"}
                </span>
                <span className="font-mono font-semibold">{money(bs.cashOnHand)}</span>
              </div>
              <div className="flex justify-between py-2 border-b border-border/40">
                <span>
                  {lang === "ar" ? "ذمم مدينة (العملاء)" : "Accounts Receivable (Customers)"}
                </span>
                <span className="font-mono font-semibold">{money(bs.receivables)}</span>
              </div>
              <div className="flex justify-between py-2 border-b border-border/40">
                <span>{lang === "ar" ? "المخزون" : "Inventory"}</span>
                <span className="font-mono font-semibold">{money(bs.inventoryValue)}</span>
              </div>
              <div className="flex justify-between py-2 border-b border-border/40">
                <span>{lang === "ar" ? "الأصول الثابتة والمؤجلة" : "Fixed & Deferred Assets"}</span>
                <span className="font-mono font-semibold">{money(bs.fixedAssets)}</span>
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
                {lang === "ar"
                  ? "الخصوم وحقوق الملكية (Liabilities & Equity)"
                  : "Liabilities & Equity"}
              </h3>
              <span className="text-xs text-muted-foreground">
                {lang === "ar" ? "الالتزامات وحقوق التاجر" : "Claims & Equity"}
              </span>
            </div>

            <div className="space-y-3 text-sm">
              <div className="font-semibold text-xs text-muted-foreground uppercase">
                {lang === "ar" ? "أولاً: الخصوم (الالتزامات)" : "1. Liabilities"}
              </div>
              <div className="flex justify-between py-2 border-b border-border/40 text-rose-400">
                <span>{lang === "ar" ? "ذمم الموردين" : "Accounts Payable (Suppliers)"}</span>
                <span className="font-mono font-semibold">{money(bs.payables)}</span>
              </div>
              <div className="flex justify-between py-2 border-b border-border/40 text-rose-400">
                <span>
                  {lang === "ar" ? "قروض ومصروفات مستحقة" : "Loans & Accrued Liabilities"}
                </span>
                <span className="font-mono font-semibold">{money(bs.accruedLiabilities)}</span>
              </div>
              <div className="flex justify-between py-2 border-b border-border/40 text-rose-400">
                <span>{lang === "ar" ? "ضريبة القيمة المضافة المستحقة" : "VAT Payable"}</span>
                <span className="font-mono font-semibold">{money(bs.vatPayable)}</span>
              </div>

              <div className="pt-2 font-semibold text-xs text-muted-foreground uppercase">
                {lang === "ar" ? "ثانياً: حقوق الملكية" : "2. Owner's Equity"}
              </div>
              <div className="flex justify-between py-2 border-b border-border/40 text-emerald-400">
                <span>{lang === "ar" ? "رأس المال (ومسحوباته)" : "Capital (net of drawings)"}</span>
                <span className="font-mono font-semibold">{money(bs.capital)}</span>
              </div>
              <div className="flex justify-between py-2 border-b border-border/40 text-emerald-400">
                <span>
                  {lang === "ar" ? "الأرباح المحتجزة ونتيجة النشاط" : "Retained Earnings"}
                </span>
                <span className="font-mono font-semibold">{money(bs.retainedEarnings)}</span>
              </div>

              <div className="pt-4">
                <div className="flex justify-between py-3 px-4 rounded-xl bg-amber-500/15 border border-amber-500/30 font-bold text-base text-amber-400">
                  <span>
                    {lang === "ar" ? "إجمالي الخصوم وحقوق الملكية" : "Total Liabilities & Equity"}
                  </span>
                  <span className="font-mono">{money(bs.totalLiabilitiesAndEquity)}</span>
                </div>
              </div>

              {bs.difference !== 0 && (
                <div className="pt-2">
                  <div className="flex justify-between py-3 px-4 rounded-xl bg-rose-500/15 border border-rose-500/40 font-bold text-sm text-rose-400">
                    <span>
                      {lang === "ar"
                        ? "⚠️ فارق غير مطابق — الأصول لا تساوي الخصوم وحقوق الملكية"
                        : "⚠️ Unbalanced — assets ≠ liabilities + equity"}
                    </span>
                    <span className="font-mono">{money(bs.difference)}</span>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* T-18: أساس تقييم المخزون — معروض صراحةً */}
        <div className="panel-elevated p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-2">
            <h3 className="font-semibold text-sm">
              {lang === "ar"
                ? "أساس تقييم المخزون (الطبقات الفعلية مقابل المرجعي)"
                : "Inventory valuation basis (actual layers vs reference)"}
            </h3>
            <span className="text-xs text-muted-foreground">
              {lang === "ar"
                ? "قيمة المخزون الدفترية مشتقة من قيود 131x المرحّلة"
                : "Book inventory value is derived from posted 131x entries"}
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
            <div className="rounded-xl border border-border/60 p-3">
              <div className="text-xs text-muted-foreground">
                {lang === "ar" ? "قيمة الطبقات الفعلية (ACTUAL)" : "Actual layer value (ACTUAL)"}
              </div>
              <div className="font-mono font-bold text-emerald-400">
                {money(bs.inventoryActualValue)}
              </div>
            </div>
            <div className="rounded-xl border border-border/60 p-3">
              <div className="text-xs text-muted-foreground">
                {lang === "ar" ? "الفارق عن القيمة الدفترية" : "Gap vs book value"}
              </div>
              <div
                className={`font-mono font-bold ${bs.inventoryValuationGap === 0 ? "text-emerald-400" : "text-amber-400"}`}
              >
                {money(bs.inventoryValuationGap)}
              </div>
            </div>
            <div className="rounded-xl border border-border/60 p-3">
              <div className="text-xs text-muted-foreground">
                {lang === "ar"
                  ? "أصناف بطبقات فعلية / مرجعية"
                  : "Items with actual / reference basis"}
              </div>
              <div className="font-mono font-bold">
                {bs.inventoryActualCount} / {bs.inventoryReferenceCount}
              </div>
            </div>
          </div>

          <p className="text-xs text-muted-foreground">
            {lang === "ar"
              ? bs.inventoryReferenceCount > 0
                ? `يوجد ${bs.inventoryReferenceCount} صنف بلا طبقات تكلفة فعلية (أساس REFERENCE_ONLY) — تُقيَّد بالتكلفة المرجعية حتى تنتج حركة تكلفة حقيقية، وتظهر هنا شفافيةً لا تُخفى.`
                : "كل الأصناف ذات رصيد لها طبقات تكلفة فعلية (ACTUAL) — لا فرق تقييم مفتوح."
              : bs.inventoryReferenceCount > 0
                ? `${bs.inventoryReferenceCount} item(s) have no actual cost layer yet (REFERENCE_ONLY basis) — valued at reference cost until a real cost movement occurs; shown here for transparency.`
                : "Every stocked item has actual cost layers (ACTUAL) — no open valuation gap."}
          </p>
        </div>
      </div>
    </>
  );
}

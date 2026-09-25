import { ModuleGuard } from "@/lib/modules";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/page-header";
import { useI18n } from "@/lib/i18n";
import { supabase } from "@/integrations/supabase/client";
import { money } from "@/lib/format";
import { printReport } from "@/lib/pdf";
import { exportToCSV } from "@/lib/excel-export";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Printer, Calendar, BookOpen, FileSpreadsheet } from "lucide-react";

export const Route = createFileRoute("/_app/daily-journal")({
  head: () => ({ meta: [{ title: "دفتر اليومية — Vortex ERP" }] }),
  component: () => (
    <ModuleGuard moduleId="advanced_accounting">
      <DailyJournalPage />
    </ModuleGuard>
  ),
});

interface JournalEntry {
  id: string;
  date: string;
  voucherNo: string;
  source: string;
  accountDebit: string;
  accountCredit: string;
  amount: number;
  note: string;
}

function DailyJournalPage() {
  const { t, lang } = useI18n();
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().slice(0, 10));
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    void loadJournal(selectedDate);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- loadJournal يعتمد فقط على selectedDate و lang المستقر
  }, [selectedDate]);

  async function loadJournal(dateStr: string) {
    setLoading(true);
    const start = `${dateStr}T00:00:00`;
    const end = `${dateStr}T23:59:59`;

    const journalList: JournalEntry[] = [];

    // 1. Sales
    const { data: sales } = await supabase
      .from("sales_invoices")
      .select("id,invoice_number,total,paid,payment_method,created_at,note,customers(name)")
      .gte("created_at", start)
      .lte("created_at", end);

    (sales ?? []).forEach((s) => {
      const isCredit = s.payment_method === "credit" || Number(s.paid) < Number(s.total);
      journalList.push({
        id: `SAL-${s.id.slice(0, 6)}`,
        date: s.created_at,
        voucherNo: s.invoice_number,
        source: lang === "ar" ? "قيد فاتورة مبيعات" : "Sales Entry",
        accountDebit: isCredit
          ? lang === "ar"
            ? `حـ/ العملاء (${s.customers?.name || "نقدي"})`
            : `Customer: ${s.customers?.name || "Walk-in"}`
          : lang === "ar"
            ? "حـ/ النقدية / البنك"
            : "Cash/Bank Account",
        accountCredit: lang === "ar" ? "حـ/ إيرادات المبيعات" : "Sales Revenue Account",
        amount: Number(s.total),
        note:
          s.note ||
          (lang === "ar"
            ? `إثبات مبيعات فاتورة ${s.invoice_number}`
            : `Sales Invoice ${s.invoice_number}`),
      });
    });

    // 2. Purchases
    const { data: purchases } = await supabase
      .from("purchase_invoices")
      .select("id,invoice_number,total,paid,created_at,note,suppliers(name)")
      .gte("created_at", start)
      .lte("created_at", end);

    (purchases ?? []).forEach((p) => {
      journalList.push({
        id: `PUR-${p.id.slice(0, 6)}`,
        date: p.created_at,
        voucherNo: p.invoice_number,
        source: lang === "ar" ? "قيد فاتورة مشتريات" : "Purchase Entry",
        accountDebit: lang === "ar" ? "حـ/ مخزون البضائع" : "Inventory Stock Account",
        accountCredit:
          lang === "ar"
            ? `حـ/ الموردين (${p.suppliers?.name || "مورد"})`
            : `Supplier: ${p.suppliers?.name || "Supplier"}`,
        amount: Number(p.total),
        note:
          p.note ||
          (lang === "ar"
            ? `إثبات مشتريات امر ${p.invoice_number}`
            : `Purchase Order ${p.invoice_number}`),
      });
    });

    // 3. Expenses
    const { data: exp } = await supabase
      .from("expenses")
      .select("id,amount,expense_date,note,created_at,expense_categories(name_ar,name)")
      .gte("created_at", start)
      .lte("created_at", end);

    (exp ?? []).forEach((e: any) => {
      const catName =
        lang === "ar"
          ? e.expense_categories?.name_ar || e.expense_categories?.name
          : e.expense_categories?.name || e.expense_categories?.name_ar;
      journalList.push({
        id: `EXP-${e.id.slice(0, 6)}`,
        date: e.created_at || `${e.expense_date}T12:00:00`,
        voucherNo: `EXP-${e.id.slice(0, 4)}`,
        source: lang === "ar" ? "قيد مصروف تشغيلي" : "Expense Entry",
        accountDebit:
          lang === "ar"
            ? `حـ/ مصروفات (${catName || "عامة"})`
            : `Expense (${catName || "General"})`,
        accountCredit: lang === "ar" ? "حـ/ الصندوق / الخزينة" : "Cash Fund",
        amount: Number(e.amount),
        note: e.note || (lang === "ar" ? "صرف مصروفات تشغيلية" : "Operating Expense Payment"),
      });
    });

    journalList.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    setEntries(journalList);
    setLoading(false);
  }

  const grandTotal = entries.reduce((a, e) => a + e.amount, 0);

  function handlePrintPDF() {
    printReport({
      title: lang === "ar" ? "دفتر اليومية العامة والقيود المحاسبية" : "Daily General Journal",
      subtitle:
        lang === "ar"
          ? `قيود وتصفية اليومية لتاريخ: ${selectedDate}`
          : `Journal Vouchers for Date: ${selectedDate}`,
      date: selectedDate,
      currency: "﷼",
      summaryCards: [
        {
          label: lang === "ar" ? "عدد قيود اليومية" : "Total Entries",
          value: String(entries.length),
        },
        {
          label: lang === "ar" ? "إجمالي توازن القيود" : "Journal Balanced Total",
          value: money(grandTotal),
          color: "#b8935a",
        },
      ],
      columns: [
        { key: "voucherNo", header: lang === "ar" ? "رقم السند/الفاتورة" : "Voucher #" },
        { key: "source", header: lang === "ar" ? "نوع القيد" : "Source" },
        { key: "accountDebit", header: lang === "ar" ? "الحساب المدين (من حـ/)" : "Debit Account" },
        {
          key: "accountCredit",
          header: lang === "ar" ? "الحساب الدائن (إلى حـ/)" : "Credit Account",
        },
        {
          key: "amount",
          header: lang === "ar" ? "المبلغ" : "Amount",
          align: "right",
          format: "money",
        },
        { key: "note", header: lang === "ar" ? "البيان والطلب" : "Note" },
      ],
      rows: entries as any,
      totalsRow: {
        voucherNo: "",
        source: lang === "ar" ? "إجمالي القيود" : "Total Journal",
        accountDebit: "",
        accountCredit: "",
        amount: grandTotal,
        note: "",
      } as any,
      rtl: lang === "ar",
    });
  }

  function handleExportExcel() {
    exportToCSV({
      filename: `دفتر_اليومية_${selectedDate}`,
      title: `دفتر اليومية العامة - ${selectedDate}`,
      currency: "﷼",
      columns: [
        { key: "voucherNo", header: "رقم السند/الفاتورة" },
        { key: "source", header: "نوع القيد" },
        { key: "accountDebit", header: "الحساب المدين (من حـ/)" },
        { key: "accountCredit", header: "الحساب الدائن (إلى حـ/)" },
        { key: "amount", header: "المبلغ", format: "money" },
        { key: "note", header: "البيان وتفاصيل القيد" },
      ],
      rows: entries as any,
      totalsRow: {
        voucherNo: "",
        source: "إجمالي القيود",
        accountDebit: "",
        accountCredit: "",
        amount: grandTotal,
        note: "",
      } as any,
      rtl: lang === "ar",
    });
  }

  return (
    <>
      <PageHeader
        title={lang === "ar" ? "دفتر اليومية العامة" : "Daily General Journal"}
        subtitle={
          lang === "ar"
            ? "سجل القيود المحاسبية التلقائية وحركات الخزينة والصندوق اليومية"
            : "Daily automated accounting journal vouchers"
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
        {/* Controls */}
        <div className="panel-elevated p-4 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Calendar className="h-5 w-5 text-primary" />
            <span className="text-sm font-semibold">
              {lang === "ar" ? "اختر اليومية:" : "Select Date:"}
            </span>
            <Input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="w-48"
            />
          </div>
          <div className="text-sm">
            <span className="text-muted-foreground">
              {lang === "ar" ? "إجمالي توازن القيود:" : "Journal Balanced Total:"}{" "}
            </span>
            <span className="font-bold font-mono text-primary text-base">{money(grandTotal)}</span>
          </div>
        </div>

        {/* Journal Entries Table */}
        <div className="panel-elevated p-4">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="font-semibold text-sm flex items-center gap-2">
              <BookOpen className="h-4 w-4 text-primary" />
              {lang === "ar" ? "جدول قيود اليومية المحاسبية" : "Accounting Journal Entries Table"}
            </h3>
            <span className="text-xs text-muted-foreground font-mono">{selectedDate}</span>
          </div>

          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">#</TableHead>
                  <TableHead>{lang === "ar" ? "الوقت" : "Time"}</TableHead>
                  <TableHead>{lang === "ar" ? "رقم السند/الفاتورة" : "Voucher #"}</TableHead>
                  <TableHead>{lang === "ar" ? "نوع القيد" : "Source"}</TableHead>
                  <TableHead className="text-rose-500 font-semibold">
                    {lang === "ar" ? "الحساب المدين (من حـ/)" : "Debit Account"}
                  </TableHead>
                  <TableHead className="text-emerald-500 font-semibold">
                    {lang === "ar" ? "الحساب الدائن (إلى حـ/)" : "Credit Account"}
                  </TableHead>
                  <TableHead className="text-end font-semibold">
                    {lang === "ar" ? "المبلغ" : "Amount"}
                  </TableHead>
                  <TableHead>{lang === "ar" ? "البيان والطلب" : "Note"}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={8} className="py-8 text-center text-muted-foreground">
                      {t("common.loading")}
                    </TableCell>
                  </TableRow>
                ) : entries.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="py-12 text-center text-muted-foreground">
                      {lang === "ar"
                        ? "لا توجد قيود اليومية لهذا اليوم"
                        : "No journal entries for this date"}
                    </TableCell>
                  </TableRow>
                ) : (
                  entries.map((e, idx) => (
                    <TableRow key={idx} className="hover:bg-surface-2/60">
                      <TableCell className="font-mono text-xs">{idx + 1}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {new Date(e.date).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </TableCell>
                      <TableCell className="font-mono text-xs font-semibold text-primary">
                        {e.voucherNo}
                      </TableCell>
                      <TableCell className="text-xs font-medium">{e.source}</TableCell>
                      <TableCell className="text-xs text-rose-400 font-semibold">
                        {e.accountDebit}
                      </TableCell>
                      <TableCell className="text-xs text-emerald-400 font-semibold">
                        {e.accountCredit}
                      </TableCell>
                      <TableCell className="text-end font-mono font-bold">
                        {money(e.amount)}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{e.note}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      </div>
    </>
  );
}

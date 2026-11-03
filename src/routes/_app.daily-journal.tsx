import { ModuleGuard } from "@/lib/modules";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/page-header";
import { useI18n } from "@/lib/i18n";
import { supabase } from "@/integrations/supabase/client";
import { getCompanyCurrencySymbol, money } from "@/lib/format";
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
import { formatJournalDateTime } from "@/lib/accounting/format-journal-date-time";

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
  occurredAt: string;
  voucherNo: string;
  source: string;
  accountDebit: string;
  accountCredit: string;
  amount: number;
  note: string;
}

/**
 * T-16: دفتر اليومية من القيود الفعلية (journal_entries + journal_lines
 * مع انضمام accounts) — لا من جداول تشغيلية ولا نصوص حسابية حُرّة.
 * كل قيد له رقم سند حقيقي (entry_number) وحسابان من الدليل.
 */
function DailyJournalPage() {
  const { t, lang } = useI18n();
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().slice(0, 10));
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void loadJournal(selectedDate);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- loadJournal يعتمد فقط على selectedDate و lang المستقر
  }, [selectedDate]);

  async function loadJournal(dateStr: string) {
    setLoading(true);
    setError(null);

    /* القيود المرحّلة بتاريخ اليوم، مع سطورها وحسابها. */
    const { data, error: qErr } = await supabase
      .from("journal_entries" as never)
      .select(
        "id,entry_number,entry_date,created_at,memo,source_type,journal_lines(debit,credit,memo,accounts(code,name_ar))",
      )
      .eq("entry_date", dateStr)
      .neq("status", "REVERSED")
      .order("created_at");

    if (qErr) {
      setError(qErr.message);
      setEntries([]);
      setLoading(false);
      return;
    }

    const sourceLabel = (s: string | null) => {
      switch (s) {
        case "sales_invoice":
          return lang === "ar" ? "فاتورة مبيعات" : "Sales Invoice";
        case "purchase_invoice":
          return lang === "ar" ? "فاتورة مشتريات" : "Purchase Invoice";
        case "expense":
          return lang === "ar" ? "مصروف" : "Expense";
        case "expense_payment":
          return lang === "ar" ? "سداد مصروف" : "Expense Payment";
        case "sales_return":
          return lang === "ar" ? "مرتجع مبيعات" : "Sales Return";
        case "purchase_return":
          return lang === "ar" ? "مرتجع مشتريات" : "Purchase Return";
        case "stock_adjustment":
          return lang === "ar" ? "تسوية مخزون" : "Stock Adjustment";
        case "customer_payment":
        case "customer_advance_payment":
          return lang === "ar" ? "تحصيل/دفعة من عميل" : "Customer Receipt";
        case "opening_balance":
          return lang === "ar" ? "رصيد افتتاحي" : "Opening Balance";
        case "journal_reversal":
          return lang === "ar" ? "عكس قيد" : "Entry Reversal";
        default:
          return lang === "ar" ? "قيد يدوي" : "Manual Entry";
      }
    };

    const journalList: JournalEntry[] = [];
    for (const e of (data ?? []) as unknown as Array<{
      id: string;
      entry_number: string;
      entry_date: string;
      created_at: string;
      memo: string;
      source_type: string | null;
      journal_lines: Array<{
        debit: number | null;
        credit: number | null;
        memo: string | null;
        accounts: { code: string; name_ar: string };
      }>;
    }>) {
      const debitLines = (e.journal_lines ?? []).filter((l) => Number(l.debit ?? 0) > 0);
      const creditLines = (e.journal_lines ?? []).filter((l) => Number(l.credit ?? 0) > 0);
      const accName = (l: { accounts: { code: string; name_ar: string } }) =>
        lang === "ar"
          ? `${l.accounts.name_ar} (${l.accounts.code})`
          : `${l.accounts.code} — ${l.accounts.name_ar}`;

      // عرض القيد المتوازن في صف واحد حتى لا يبدو طرفا المدين والدائن كأنهما قيدان.
      for (const dl of debitLines) {
        journalList.push({
          id: `${e.id}-D${journalList.length}`,
          date: e.entry_date,
          occurredAt: e.created_at,
          voucherNo: e.entry_number,
          source: sourceLabel(e.source_type),
          accountDebit: accName(dl),
          accountCredit: creditLines.length > 0 ? accName(creditLines[0]) : "—",
          amount: Number(dl.debit ?? 0),
          note: e.memo,
        });
      }
    }

    journalList.sort((a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime());
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
      currency: getCompanyCurrencySymbol(),
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
      currency: getCompanyCurrencySymbol(),
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
                        {formatJournalDateTime(e.occurredAt, lang)}
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

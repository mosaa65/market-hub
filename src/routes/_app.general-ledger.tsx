import { ModuleGuard } from "@/lib/modules";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/page-header";
import { useI18n } from "@/lib/i18n";
import { supabase } from "@/integrations/supabase/client";
import { getCompanyCurrencySymbol, money } from "@/lib/format";
import { printReport } from "@/lib/pdf";
import { exportToCSV } from "@/lib/excel-export";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Printer,
  Calendar,
  BookOpen,
  FileSpreadsheet,
  AlertTriangle,
  CheckCircle2,
} from "lucide-react";

/**
 * T-17: دفتر الأستاذ العام.
 *
 * المصدر الوحيد: journal_lines المرحّلة (قيود POSTED/REVERSED) مع انضمام accounts،
 * لحركة حساب واحد داخل فترة. لا نصوص حسابية حُرّة ولا معادلات متصفح.
 *
 * وبجانبه كشفا مطابقة/ترحيل حقيقيان:
 *  - customer_balance_reconciliation: الفرق بين رصيد الدفتر ورصيد العمود المخزَّن.
 *  - invoice_ledger_status: الفواتير التي لم تُرحَّل إلى الدليل بعد.
 * الفروق تُبرَز صراحةً — لا تُدفن.
 */

export const Route = createFileRoute("/_app/general-ledger")({
  head: () => ({ meta: [{ title: "دفتر الأستاذ العام — Vortex ERP" }] }),
  component: () => (
    <ModuleGuard moduleId="advanced_accounting">
      <GeneralLedgerPage />
    </ModuleGuard>
  ),
});

interface LedgerRow {
  id: string;
  entry_number: string;
  entry_date: string;
  source_type: string | null;
  memo: string | null;
  account_code: string;
  account_name: string;
  debit: number;
  credit: number;
  running: number;
}

interface ReconcileRow {
  customer_id: string;
  name: string;
  ledger_balance: number;
  legacy_balance: number;
  difference: number;
}

interface InvoiceStatusRow {
  invoice_id: string;
  invoice_number: string;
  invoice_status: string;
  total: number;
  ledger_state: string;
}

function GeneralLedgerPage() {
  const { t, lang } = useI18n();
  const today = new Date().toISOString().slice(0, 10);
  const firstOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1)
    .toISOString()
    .slice(0, 10);

  const [fromDate, setFromDate] = useState(firstOfMonth);
  const [toDate, setToDate] = useState(today);
  const [accountCode, setAccountCode] = useState<string>("");
  const [accounts, setAccounts] = useState<Array<{ code: string; name_ar: string }>>([]);
  const [rows, setRows] = useState<LedgerRow[]>([]);
  const [recon, setRecon] = useState<ReconcileRow[]>([]);
  const [notPosted, setNotPosted] = useState<InvoiceStatusRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void loadAccounts();
  }, []);

  useEffect(() => {
    void loadLedger();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- loadLedger يعتمد على الفترة/الحساب فقط
  }, [fromDate, toDate, accountCode]);

  async function loadAccounts() {
    const { data } = await supabase
      .from("accounts" as never)
      .select("code,name_ar")
      .eq("is_active", true)
      .order("code");
    setAccounts((data ?? []) as unknown as Array<{ code: string; name_ar: string }>);
  }

  async function loadLedger() {
    setLoading(true);
    setError(null);

    /* سطور القيود المرحّلة داخل الفترة، مع حسابها وبيانات القيد. */
    const q = supabase
      .from("journal_lines" as never)
      .select(
        "id,debit,credit,entry_id,account_id,accounts(code,name_ar),journal_entries!inner(entry_number,entry_date,status,source_type,memo)",
      )
      .neq("journal_entries.status", "DRAFT")
      .gte("journal_entries.entry_date", fromDate)
      .lte("journal_entries.entry_date", toDate);

    // الترشيح بالحساب يجري بعد الجلب لأن الانضمام يجلب كود الحساب لا رقمه.
    const { data, error: qErr } = await q;

    if (qErr) {
      setError(qErr.message);
      setRows([]);
      setLoading(false);
      return;
    }

    const mapped = (data ?? []) as unknown as Array<{
      id: string;
      debit: number | null;
      credit: number | null;
      accounts: { code: string; name_ar: string };
      journal_entries: {
        entry_number: string;
        entry_date: string;
        source_type: string | null;
        memo: string | null;
      };
    }>;

    const filtered = accountCode ? mapped.filter((l) => l.accounts?.code === accountCode) : mapped;

    filtered.sort((a, b) => {
      const da = new Date(a.journal_entries.entry_date).getTime();
      const db = new Date(b.journal_entries.entry_date).getTime();
      if (da !== db) return da - db;
      return a.journal_entries.entry_number.localeCompare(b.journal_entries.entry_number);
    });

    let running = 0;
    const out: LedgerRow[] = filtered.map((l) => {
      const debit = Number(l.debit ?? 0);
      const credit = Number(l.credit ?? 0);
      running += debit - credit;
      return {
        id: l.id,
        entry_number: l.journal_entries.entry_number,
        entry_date: l.journal_entries.entry_date,
        source_type: l.journal_entries.source_type,
        memo: l.journal_entries.memo,
        account_code: l.accounts?.code ?? "—",
        account_name: l.accounts?.name_ar ?? "—",
        debit,
        credit,
        running: Math.round(running * 100) / 100,
      };
    });

    setRows(out);
    setLoading(false);
  }

  useEffect(() => {
    void loadReconciliation();
  }, []);

  async function loadReconciliation() {
    const [reconRes, invoiceRes] = await Promise.all([
      supabase
        .from("customer_balance_reconciliation" as never)
        .select("customer_id,name,ledger_balance,legacy_balance,difference"),
      supabase
        .from("invoice_ledger_status" as never)
        .select("invoice_id,invoice_number,invoice_status,total,ledger_state")
        .eq("ledger_state", "NOT_POSTED"),
    ]);
    setRecon((reconRes.data ?? []) as unknown as ReconcileRow[]);
    setNotPosted((invoiceRes.data ?? []) as unknown as InvoiceStatusRow[]);
  }

  const totals = useMemo(() => {
    const debit = rows.reduce((a, r) => a + r.debit, 0);
    const credit = rows.reduce((a, r) => a + r.credit, 0);
    return { debit, credit, balance: Math.round((debit - credit) * 100) / 100 };
  }, [rows]);

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

  function handlePrintPDF() {
    printReport({
      title: lang === "ar" ? "دفتر الأستاذ العام" : "General Ledger",
      subtitle:
        lang === "ar"
          ? `حركة الحساب من ${fromDate} إلى ${toDate}`
          : `Account movement from ${fromDate} to ${toDate}`,
      date: toDate,
      currency: getCompanyCurrencySymbol(),
      summaryCards: [
        {
          label: lang === "ar" ? "إجمالي المدين" : "Total Debit",
          value: money(totals.debit),
        },
        {
          label: lang === "ar" ? "إجمالي الدائن" : "Total Credit",
          value: money(totals.credit),
        },
        {
          label: lang === "ar" ? "الرصيد" : "Balance",
          value: money(totals.balance),
          color: "#b8935a",
        },
      ],
      columns: [
        { key: "entry_number", header: lang === "ar" ? "رقم القيد" : "Entry #" },
        { key: "entry_date", header: lang === "ar" ? "التاريخ" : "Date" },
        { key: "account_name", header: lang === "ar" ? "الحساب" : "Account" },
        { key: "source_type", header: lang === "ar" ? "المصدر" : "Source" },
        { key: "debit", header: lang === "ar" ? "مدين" : "Debit", format: "money", align: "right" },
        {
          key: "credit",
          header: lang === "ar" ? "دائن" : "Credit",
          format: "money",
          align: "right",
        },
        {
          key: "running",
          header: lang === "ar" ? "الرصيد الجاري" : "Running",
          format: "money",
          align: "right",
        },
      ],
      rows: rows as any,
      rtl: lang === "ar",
    });
  }

  function handleExportExcel() {
    exportToCSV({
      filename: `دفتر_الأستاذ_العام_${fromDate}_${toDate}`,
      title: `دفتر الأستاذ العام - ${fromDate} إلى ${toDate}`,
      currency: getCompanyCurrencySymbol(),
      columns: [
        { key: "entry_number", header: "رقم القيد" },
        { key: "entry_date", header: "التاريخ" },
        { key: "account_code", header: "كود الحساب" },
        { key: "account_name", header: "اسم الحساب" },
        { key: "memo", header: "البيان" },
        { key: "debit", header: "مدين", format: "money" },
        { key: "credit", header: "دائن", format: "money" },
        { key: "running", header: "الرصيد الجاري", format: "money" },
      ],
      rows: rows as any,
      rtl: lang === "ar",
    });
  }

  return (
    <>
      <PageHeader
        title={lang === "ar" ? "دفتر الأستاذ العام" : "General Ledger"}
        subtitle={
          lang === "ar"
            ? "حركة حساب واحد من القيود المرحّلة، مع كشوف مطابقة الدفتر وحالة ترحيل الفواتير"
            : "Per-account movement from posted entries, with ledger reconciliation and invoice posting status"
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
        <div className="panel-elevated p-4 flex flex-wrap items-end gap-4">
          <div className="flex items-center gap-3">
            <Calendar className="h-5 w-5 text-primary" />
            <span className="text-sm font-semibold">{lang === "ar" ? "من:" : "From:"}</span>
            <Input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="w-44"
            />
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm font-semibold">{lang === "ar" ? "إلى:" : "To:"}</span>
            <Input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="w-44"
            />
          </div>
          <div className="flex items-center gap-3 min-w-64">
            <span className="text-sm font-semibold whitespace-nowrap">
              {lang === "ar" ? "الحساب:" : "Account:"}
            </span>
            <Select value={accountCode} onValueChange={setAccountCode}>
              <SelectTrigger className="w-72">
                <SelectValue placeholder={lang === "ar" ? "كل الحسابات" : "All accounts"} />
              </SelectTrigger>
              <SelectContent>
                {accounts.map((a) => (
                  <SelectItem key={a.code} value={a.code}>
                    {a.code} — {a.name_ar}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Reconciliation panels */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="panel-elevated p-4 space-y-3">
            <div className="flex items-center justify-between border-b border-border pb-2">
              <h3 className="font-semibold text-sm flex items-center gap-2">
                {recon.length > 0 ? (
                  <AlertTriangle className="h-4 w-4 text-rose-400" />
                ) : (
                  <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                )}
                {lang === "ar"
                  ? "مطابقة أرصدة العملاء (الدفتر مقابل العمود المخزَّن)"
                  : "Customer balance reconciliation (ledger vs stored)"}
              </h3>
              <Badge variant={recon.length > 0 ? "destructive" : "secondary"}>{recon.length}</Badge>
            </div>
            {recon.length === 0 ? (
              <p className="text-xs text-emerald-400">
                {lang === "ar"
                  ? "لا فروق — رصيد الدفتر يطابق الرصيد المخزَّن لكل عميل."
                  : "No differences — ledger matches the stored balance for every customer."}
              </p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{lang === "ar" ? "العميل" : "Customer"}</TableHead>
                      <TableHead className="text-end">
                        {lang === "ar" ? "رصيد الدفتر" : "Ledger"}
                      </TableHead>
                      <TableHead className="text-end">
                        {lang === "ar" ? "الرصيد المخزَّن" : "Stored"}
                      </TableHead>
                      <TableHead className="text-end">
                        {lang === "ar" ? "الفرق" : "Difference"}
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {recon.map((r) => (
                      <TableRow key={r.customer_id}>
                        <TableCell className="text-xs">{r.name}</TableCell>
                        <TableCell className="text-end font-mono text-xs">
                          {money(r.ledger_balance)}
                        </TableCell>
                        <TableCell className="text-end font-mono text-xs">
                          {money(r.legacy_balance)}
                        </TableCell>
                        <TableCell className="text-end font-mono text-xs text-rose-400 font-semibold">
                          {money(r.difference)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>

          <div className="panel-elevated p-4 space-y-3">
            <div className="flex items-center justify-between border-b border-border pb-2">
              <h3 className="font-semibold text-sm flex items-center gap-2">
                {notPosted.length > 0 ? (
                  <AlertTriangle className="h-4 w-4 text-amber-400" />
                ) : (
                  <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                )}
                {lang === "ar"
                  ? "فواتير نهائية لم تُرحَّل إلى الدليل بعد"
                  : "Final invoices not yet posted to the ledger"}
              </h3>
              <Badge variant={notPosted.length > 0 ? "destructive" : "secondary"}>
                {notPosted.length}
              </Badge>
            </div>
            {notPosted.length === 0 ? (
              <p className="text-xs text-emerald-400">
                {lang === "ar"
                  ? "كل الفواتير النهائية لها قيد أستاذ."
                  : "Every final invoice has a ledger entry."}
              </p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{lang === "ar" ? "رقم الفاتورة" : "Invoice #"}</TableHead>
                      <TableHead>{lang === "ar" ? "الحالة" : "Status"}</TableHead>
                      <TableHead className="text-end">
                        {lang === "ar" ? "الإجمالي" : "Total"}
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {notPosted.map((r) => (
                      <TableRow key={r.invoice_id}>
                        <TableCell className="font-mono text-xs">{r.invoice_number}</TableCell>
                        <TableCell className="text-xs">{r.invoice_status}</TableCell>
                        <TableCell className="text-end font-mono text-xs">
                          {money(r.total)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        </div>

        {/* Ledger table */}
        <div className="panel-elevated p-4">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="font-semibold text-sm flex items-center gap-2">
              <BookOpen className="h-4 w-4 text-primary" />
              {lang === "ar" ? "حركة الحساب (دفتر الأستاذ)" : "Account movement (General Ledger)"}
            </h3>
            <span className="text-xs text-muted-foreground font-mono">
              {fromDate} → {toDate}
            </span>
          </div>

          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">#</TableHead>
                  <TableHead>{lang === "ar" ? "التاريخ" : "Date"}</TableHead>
                  <TableHead>{lang === "ar" ? "رقم القيد" : "Entry #"}</TableHead>
                  <TableHead>{lang === "ar" ? "الحساب" : "Account"}</TableHead>
                  <TableHead>{lang === "ar" ? "المصدر" : "Source"}</TableHead>
                  <TableHead className="text-end text-rose-500 font-semibold">
                    {lang === "ar" ? "مدين" : "Debit"}
                  </TableHead>
                  <TableHead className="text-end text-emerald-500 font-semibold">
                    {lang === "ar" ? "دائن" : "Credit"}
                  </TableHead>
                  <TableHead className="text-end font-semibold">
                    {lang === "ar" ? "الرصيد الجاري" : "Running"}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={8} className="py-8 text-center text-muted-foreground">
                      {t("common.loading")}
                    </TableCell>
                  </TableRow>
                ) : rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="py-12 text-center text-muted-foreground">
                      {lang === "ar"
                        ? "لا توجد حركات مرحّلة في هذه الفترة"
                        : "No posted movements in this period"}
                    </TableCell>
                  </TableRow>
                ) : (
                  rows.map((r, idx) => (
                    <TableRow key={r.id} className="hover:bg-surface-2/60">
                      <TableCell className="font-mono text-xs">{idx + 1}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {r.entry_date}
                      </TableCell>
                      <TableCell className="font-mono text-xs font-semibold text-primary">
                        {r.entry_number}
                      </TableCell>
                      <TableCell className="text-xs">
                        {r.account_name} ({r.account_code})
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {sourceLabel(r.source_type)}
                      </TableCell>
                      <TableCell className="text-end font-mono text-xs text-rose-400">
                        {r.debit > 0 ? money(r.debit) : "—"}
                      </TableCell>
                      <TableCell className="text-end font-mono text-xs text-emerald-400">
                        {r.credit > 0 ? money(r.credit) : "—"}
                      </TableCell>
                      <TableCell className="text-end font-mono text-xs font-bold">
                        {money(r.running)}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          {rows.length > 0 && (
            <div className="mt-4 flex justify-end gap-8 text-sm font-bold border-t border-border pt-3">
              <span>
                {lang === "ar" ? "إجمالي المدين:" : "Total Debit:"}{" "}
                <span className="font-mono text-rose-400">{money(totals.debit)}</span>
              </span>
              <span>
                {lang === "ar" ? "إجمالي الدائن:" : "Total Credit:"}{" "}
                <span className="font-mono text-emerald-400">{money(totals.credit)}</span>
              </span>
              <span>
                {lang === "ar" ? "الرصيد:" : "Balance:"}{" "}
                <span className="font-mono text-primary">{money(totals.balance)}</span>
              </span>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

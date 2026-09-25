import { ModuleGuard } from "@/lib/modules";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import { PageHeader } from "@/components/page-header";
import { useI18n } from "@/lib/i18n";
import { supabase } from "@/integrations/supabase/client";
import { money } from "@/lib/format";
import { printUnifiedReport } from "@/lib/pdf";
import { exportToCSV } from "@/lib/excel-export";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
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
import { Printer, Download, UserCheck, Building2, Calendar, FileSpreadsheet } from "lucide-react";

const accountStatementSearchSchema = z.object({
  customerId: z.string().optional(),
});

export const Route = createFileRoute("/_app/account-statement")({
  validateSearch: (search: Record<string, unknown>) => accountStatementSearchSchema.parse(search),
  head: () => ({ meta: [{ title: "كشف حساب — Vortex ERP" }] }),
  component: () => (
    <ModuleGuard moduleId="payments">
      <AccountStatementPage />
    </ModuleGuard>
  ),
});

interface StatementItem {
  id: string;
  date: string;
  type: string;
  reference: string;
  debit: number;
  credit: number;
  balance: number;
  note: string;
}

function AccountStatementPage() {
  const { t, lang } = useI18n();
  const searchParams = Route.useSearch();
  const customerId = searchParams?.customerId;
  const [partyType, setPartyType] = useState<"customer" | "supplier">("customer");
  const [partyId, setPartyId] = useState<string>("");
  const [partyList, setPartyList] = useState<{ id: string; name: string; balance?: number }[]>([]);
  const [statement, setStatement] = useState<StatementItem[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (customerId) {
      setPartyType("customer");
    }
    void loadParties();
  }, [partyType, customerId]);

  useEffect(() => {
    if (partyId) void loadStatement();
  }, [partyId, partyType]);

  async function loadParties() {
    setPartyId("");
    setStatement([]);
    if (partyType === "customer") {
      const { data } = await supabase.from("customers").select("id, name, balance").order("name");
      const list = data ?? [];
      setPartyList(list);
      if (customerId && list.some((c) => c.id === customerId)) {
        setPartyId(customerId);
      } else if (list.length > 0) {
        setPartyId(list[0].id);
      }
    } else {
      const { data } = await supabase.from("suppliers").select("id, name, balance").order("name");
      setPartyList(data ?? []);
      if (data && data.length > 0) setPartyId(data[0].id);
    }
  }

  async function loadStatement() {
    if (!partyId) return;
    setLoading(true);

    const items: StatementItem[] = [];

    if (partyType === "customer") {
      const { data: sales } = await supabase
        .from("sales_invoices")
        .select(
          "id, invoice_number, total, created_at, note, sales_invoice_items(quantity,products(name,name_ar))",
        )
        .eq("customer_id", partyId)
        .order("created_at", { ascending: true });

      (sales ?? []).forEach((s) => {
        items.push({
          id: s.id,
          date: s.created_at,
          type: lang === "ar" ? "فاتورة مبيعات آجل" : "Credit Sale Invoice",
          reference: s.invoice_number,
          debit: Number(s.total),
          credit: 0,
          balance: 0,
          note:
            s.note ||
            (s.sales_invoice_items ?? [])
              .map(
                (line: any) =>
                  `${lang === "ar" ? line.products?.name_ar || line.products?.name : line.products?.name} × ${line.quantity}`,
              )
              .join("، ") ||
            (lang === "ar" ? "مبيعات للعميل" : "Customer sale"),
        });
      });

      const { data: payments } = await supabase
        .from("customer_payments")
        .select(
          "id, amount, payment_date, note, payment_method, invoice_id, sales_invoices(invoice_number)",
        )
        .eq("customer_id", partyId)
        .order("payment_date", { ascending: true });

      (payments ?? []).forEach((p: any) => {
        items.push({
          id: p.id,
          date: p.payment_date,
          type: lang === "ar" ? "سداد من العميل" : "Customer payment",
          reference: p.sales_invoices?.invoice_number ?? "—",
          debit: 0,
          credit: Number(p.amount),
          balance: 0,
          note:
            p.note ||
            (lang === "ar"
              ? `تحصيل ${p.payment_method === "cash" ? "نقدًا" : "دفعة"}`
              : `Payment (${p.payment_method})`),
        });
      });
    } else {
      const { data: purchases } = await supabase
        .from("purchase_invoices")
        .select(
          "id, invoice_number, total, paid, created_at, note, purchase_invoice_items(quantity,products(name,name_ar))",
        )
        .eq("supplier_id", partyId)
        .order("created_at", { ascending: true });

      (purchases ?? []).forEach((p: any) => {
        items.push({
          id: p.id,
          date: p.created_at,
          type: lang === "ar" ? "فاتورة مشتريات توريد" : "Purchase Invoice",
          reference: p.invoice_number,
          debit: Number(p.paid || 0),
          credit: Number(p.total),
          balance: 0,
          note:
            p.note ||
            (p.purchase_invoice_items ?? [])
              .map(
                (line: any) =>
                  `${lang === "ar" ? line.products?.name_ar || line.products?.name : line.products?.name} × ${line.quantity}`,
              )
              .join("، ") ||
            (lang === "ar" ? "توريد كميات بضائع ومواد غذائية" : "Purchase Order"),
        });
      });
    }

    items.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    // Calculate Running Balance
    let runningBalance = 0;
    const itemsWithBalance = items.map((item) => {
      runningBalance += item.debit - item.credit;
      return { ...item, balance: runningBalance };
    });

    setStatement(itemsWithBalance);
    setLoading(false);
  }

  const selectedParty = partyList.find((p) => p.id === partyId);
  const totalDebit = statement.reduce((a, i) => a + i.debit, 0);
  const totalCredit = statement.reduce((a, i) => a + i.credit, 0);
  const netBalance = totalDebit - totalCredit;

  function handlePrintPDF() {
    printUnifiedReport({
      title:
        lang === "ar"
          ? `كشف حساب تفصيلي — ${selectedParty?.name || ""}`
          : `Detailed Account Statement — ${selectedParty?.name || ""}`,
      subtitle:
        lang === "ar"
          ? `نوع الحساب: ${partyType === "customer" ? "عميل" : "مورد"}`
          : `Account Type: ${partyType}`,
      date: new Date().toLocaleDateString(lang === "ar" ? "ar-YE" : "en-US"),
      periodLabel: lang === "ar" ? "كشف حركة حقيقي ومباشر" : "Live Running Account Statement",
      currency: "﷼",
      summaryCards: [
        {
          label: lang === "ar" ? "إجمالي الحركات الحسابية" : "Total Movements",
          value: String(statement.length),
        },
        {
          label: lang === "ar" ? "إجمالي المدين (له)" : "Total Debit",
          value: money(totalDebit),
          color: "#f43f5e",
        },
        {
          label: lang === "ar" ? "إجمالي الدائن (عليه)" : "Total Credit",
          value: money(totalCredit),
          color: "#10b981",
        },
        {
          label: lang === "ar" ? "الرصيد المتبقي النهائى" : "Net Balance",
          value: money(netBalance),
          color: netBalance > 0 ? "#f43f5e" : "#10b981",
        },
      ],
      columns: [
        { key: "date", header: lang === "ar" ? "التاريخ والوقت" : "Date & Time" },
        { key: "type", header: lang === "ar" ? "نوع الحركة" : "Type" },
        { key: "reference", header: lang === "ar" ? "رقم المرجع" : "Ref #" },
        {
          key: "debit",
          header: lang === "ar" ? "مدين (له)" : "Debit",
          align: "right",
          format: "money",
        },
        {
          key: "credit",
          header: lang === "ar" ? "دائن (عليه)" : "Credit",
          align: "right",
          format: "money",
        },
        {
          key: "balance",
          header: lang === "ar" ? "الرصيد التراكمي" : "Balance",
          align: "right",
          format: "money",
        },
        { key: "note", header: lang === "ar" ? "البيان" : "Note" },
      ],
      rows: statement as any,
      totalsRow: {
        date: "",
        type: lang === "ar" ? "الإجمالي الكلي" : "Grand Total",
        reference: "",
        debit: totalDebit,
        credit: totalCredit,
        balance: netBalance,
        note: "",
      } as any,
      rtl: lang === "ar",
    });
  }

  function handleExportExcel() {
    exportToCSV({
      filename: `كشف_حساب_${selectedParty?.name || "الحساب"}_${new Date().toISOString().slice(0, 10)}`,
      title: `كشف حساب تفصيلي: ${selectedParty?.name || ""}`,
      currency: "﷼",
      columns: [
        { key: "date", header: "التاريخ والوقت" },
        { key: "type", header: "نوع الحركة" },
        { key: "reference", header: "رقم المرجع/الفاتورة" },
        { key: "debit", header: "مدين (له)", format: "money" },
        { key: "credit", header: "دائن (عليه)", format: "money" },
        { key: "balance", header: "الرصيد التراكمي", format: "money" },
        { key: "note", header: "البيان والتفاصيل" },
      ],
      rows: statement as any,
      totalsRow: {
        date: "",
        type: "الإجمالي الكلي",
        reference: "",
        debit: totalDebit,
        credit: totalCredit,
        balance: netBalance,
        note: "",
      } as any,
      rtl: lang === "ar",
    });
  }

  return (
    <>
      <PageHeader
        title={lang === "ar" ? "كشف حساب تفصيلي (عميل / مورد)" : "Account Statement"}
        subtitle={
          lang === "ar"
            ? "تتبع وحساب الأرصدة التراكمية والفواتير والتحصيلات خطوة بخطوة"
            : "Live customer & supplier account statement with running balance"
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
        {/* Selection Bar */}
        <div className="panel-elevated p-4 flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2 border border-border p-1 rounded-lg bg-surface-2">
              <Button
                variant={partyType === "customer" ? "default" : "ghost"}
                size="sm"
                onClick={() => setPartyType("customer")}
                className="gap-2 text-xs"
              >
                <UserCheck className="h-4 w-4" />
                {lang === "ar" ? "حسابات العملاء" : "Customers"}
              </Button>
              <Button
                variant={partyType === "supplier" ? "default" : "ghost"}
                size="sm"
                onClick={() => setPartyType("supplier")}
                className="gap-2 text-xs"
              >
                <Building2 className="h-4 w-4" />
                {lang === "ar" ? "حسابات الموردين" : "Suppliers"}
              </Button>
            </div>

            <Select value={partyId} onValueChange={setPartyId}>
              <SelectTrigger className="w-64">
                <SelectValue placeholder={lang === "ar" ? "اختر الحساب..." : "Select account..."} />
              </SelectTrigger>
              <SelectContent>
                {partyList.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {selectedParty && (
            <div className="flex items-center gap-6">
              <div className="text-end">
                <span className="text-xs text-muted-foreground">
                  {lang === "ar" ? "إجمالي المدين (له):" : "Total Debit:"}{" "}
                </span>
                <span className="font-bold font-mono text-rose-500 text-sm block">
                  {money(totalDebit)}
                </span>
              </div>
              <div className="text-end">
                <span className="text-xs text-muted-foreground">
                  {lang === "ar" ? "إجمالي الدائن (عليه):" : "Total Credit:"}{" "}
                </span>
                <span className="font-bold font-mono text-emerald-500 text-sm block">
                  {money(totalCredit)}
                </span>
              </div>
              <div className="text-end border-r pr-6 border-border">
                <span className="text-xs text-muted-foreground">
                  {lang === "ar" ? "الرصيد المتبقي الحالي:" : "Net Balance:"}{" "}
                </span>
                <span className="font-bold font-mono text-primary text-base block">
                  {money(netBalance)}
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Statement Table */}
        <div className="panel-elevated p-4">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">#</TableHead>
                  <TableHead>{lang === "ar" ? "التاريخ والوقت" : "Date & Time"}</TableHead>
                  <TableHead>{lang === "ar" ? "نوع الحركة" : "Type"}</TableHead>
                  <TableHead>{lang === "ar" ? "رقم المرجع" : "Ref #"}</TableHead>
                  <TableHead className="text-end text-rose-500 font-semibold">
                    {lang === "ar" ? "مدين (له)" : "Debit"}
                  </TableHead>
                  <TableHead className="text-end text-emerald-500 font-semibold">
                    {lang === "ar" ? "دائن (عليه)" : "Credit"}
                  </TableHead>
                  <TableHead className="text-end font-semibold">
                    {lang === "ar" ? "الرصيد التراكمي" : "Balance"}
                  </TableHead>
                  <TableHead>{lang === "ar" ? "البيان والتفاصيل" : "Note"}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={8} className="py-8 text-center text-muted-foreground">
                      {t("common.loading")}
                    </TableCell>
                  </TableRow>
                ) : statement.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="py-12 text-center text-muted-foreground">
                      {lang === "ar"
                        ? "لا توجد حركات حسابية مسجلة لهذا الحساب"
                        : "No statement records for this account"}
                    </TableCell>
                  </TableRow>
                ) : (
                  statement.map((item, idx) => (
                    <TableRow key={item.id} className="hover:bg-surface-2/60">
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {idx + 1}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {new Date(item.date).toLocaleString()}
                      </TableCell>
                      <TableCell className="text-xs font-semibold">{item.type}</TableCell>
                      <TableCell className="font-mono text-xs text-primary">
                        {item.reference}
                      </TableCell>
                      <TableCell className="text-end font-mono text-rose-500">
                        {item.debit > 0 ? money(item.debit) : "—"}
                      </TableCell>
                      <TableCell className="text-end font-mono text-emerald-500">
                        {item.credit > 0 ? money(item.credit) : "—"}
                      </TableCell>
                      <TableCell className="text-end font-mono font-bold">
                        {money(item.balance)}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{item.note}</TableCell>
                    </TableRow>
                  ))
                )}
                {statement.length > 0 && (
                  <TableRow className="border-t-2 border-border font-bold bg-surface-2/50">
                    <TableCell colSpan={4} className="text-end text-sm">
                      {lang === "ar" ? "الإجمالي الكلي:" : "Total:"}
                    </TableCell>
                    <TableCell className="text-end font-mono text-rose-500">
                      {money(totalDebit)}
                    </TableCell>
                    <TableCell className="text-end font-mono text-emerald-500">
                      {money(totalCredit)}
                    </TableCell>
                    <TableCell className="text-end font-mono text-primary text-base">
                      {money(netBalance)}
                    </TableCell>
                    <TableCell></TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      </div>
    </>
  );
}

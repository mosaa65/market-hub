import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/page-header";
import { useI18n } from "@/lib/i18n";
import { supabase } from "@/integrations/supabase/client";
import { money } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Plus, TrendingUp, TrendingDown, Wallet, Receipt, Users, Truck, Trash2 } from "lucide-react";

export const Route = createFileRoute("/_app/finance")({
  head: () => ({ meta: [{ title: "Finance — Vortex ERP" }] }),
  component: FinancePage,
});

interface Stats {
  salesTotal: number;
  salesPaid: number;
  purchasesTotal: number;
  purchasesPaid: number;
  receivables: number;
  payables: number;
  expensesTotal: number;
  cashIn: number;
  cashOut: number;
}

function FinancePage() {
  const { t, lang } = useI18n();
  const [stats, setStats] = useState<Stats | null>(null);
  const [expenses, setExpenses] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [debtors, setDebtors] = useState<any[]>([]);
  const [creditors, setCreditors] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ category_id: "", amount: "", payment_method: "cash", note: "", expense_date: new Date().toISOString().slice(0, 10) });

  async function load() {
    const [sales, purchases, exp, cats, custs, supps] = await Promise.all([
      supabase.from("sales_invoices").select("total,paid,payment_method"),
      supabase.from("purchase_invoices").select("total,paid,payment_method"),
      supabase.from("expenses").select("*, expense_categories(name,name_ar)").order("expense_date", { ascending: false }).limit(100),
      supabase.from("expense_categories").select("*").order("name"),
      supabase.from("customers").select("id,name,balance").gt("balance", 0).order("balance", { ascending: false }).limit(20),
      supabase.from("suppliers").select("id,name,balance").gt("balance", 0).order("balance", { ascending: false }).limit(20),
    ]);

    const s = sales.data ?? [];
    const p = purchases.data ?? [];
    const e = exp.data ?? [];
    const salesTotal = s.reduce((a, r: any) => a + Number(r.total), 0);
    const salesPaid = s.reduce((a, r: any) => a + Number(r.paid), 0);
    const purchasesTotal = p.reduce((a, r: any) => a + Number(r.total), 0);
    const purchasesPaid = p.reduce((a, r: any) => a + Number(r.paid), 0);
    const expensesTotal = e.reduce((a, r: any) => a + Number(r.amount), 0);

    setStats({
      salesTotal, salesPaid, purchasesTotal, purchasesPaid,
      receivables: salesTotal - salesPaid,
      payables: purchasesTotal - purchasesPaid,
      expensesTotal,
      cashIn: salesPaid,
      cashOut: purchasesPaid + expensesTotal,
    });
    setExpenses(e);
    setCategories(cats.data ?? []);
    setDebtors(custs.data ?? []);
    setCreditors(supps.data ?? []);
  }
  useEffect(() => { load(); }, []);

  async function saveExpense() {
    if (!form.category_id || !form.amount) { toast.error(lang === "ar" ? "أكمل البيانات" : "Fill the form"); return; }
    const { error } = await supabase.from("expenses").insert({
      category_id: form.category_id,
      amount: Number(form.amount),
      payment_method: form.payment_method as any,
      expense_date: form.expense_date,
      note: form.note || null,
    });
    if (error) { toast.error(error.message); return; }
    toast.success(lang === "ar" ? "تم الحفظ" : "Saved");
    setOpen(false);
    setForm({ category_id: "", amount: "", payment_method: "cash", note: "", expense_date: new Date().toISOString().slice(0, 10) });
    load();
  }

  async function delExpense(id: string) {
    if (!confirm(lang === "ar" ? "حذف المصروف؟" : "Delete expense?")) return;
    const { error } = await supabase.from("expenses").delete().eq("id", id);
    if (error) return toast.error(error.message);
    load();
  }

  const netCash = useMemo(() => (stats ? stats.cashIn - stats.cashOut : 0), [stats]);
  const grossProfit = useMemo(() => (stats ? stats.salesTotal - stats.purchasesTotal : 0), [stats]);
  const netProfit = useMemo(() => grossProfit - (stats?.expensesTotal ?? 0), [grossProfit, stats]);

  return (
    <>
      <PageHeader
        title={t("finance.title")}
        subtitle={lang === "ar" ? "الذمم، التدفق النقدي، المصروفات والأرباح" : "Receivables, payables, cashflow and profit"}
        actions={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button><Plus className="h-4 w-4 me-1" />{lang === "ar" ? "مصروف جديد" : "New expense"}</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>{lang === "ar" ? "إضافة مصروف" : "Add expense"}</DialogTitle></DialogHeader>
              <div className="grid gap-3">
                <div className="grid gap-1.5">
                  <Label>{lang === "ar" ? "الفئة" : "Category"}</Label>
                  <Select value={form.category_id} onValueChange={(v) => setForm({ ...form, category_id: v })}>
                    <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                    <SelectContent>
                      {categories.map((c) => (<SelectItem key={c.id} value={c.id}>{lang === "ar" ? (c.name_ar ?? c.name) : c.name}</SelectItem>))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="grid gap-1.5">
                    <Label>{lang === "ar" ? "المبلغ" : "Amount"}</Label>
                    <Input type="number" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
                  </div>
                  <div className="grid gap-1.5">
                    <Label>{lang === "ar" ? "التاريخ" : "Date"}</Label>
                    <Input type="date" value={form.expense_date} onChange={(e) => setForm({ ...form, expense_date: e.target.value })} />
                  </div>
                </div>
                <div className="grid gap-1.5">
                  <Label>{lang === "ar" ? "طريقة الدفع" : "Payment method"}</Label>
                  <Select value={form.payment_method} onValueChange={(v) => setForm({ ...form, payment_method: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="cash">Cash</SelectItem>
                      <SelectItem value="card">Card</SelectItem>
                      <SelectItem value="bank">Bank</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-1.5">
                  <Label>{lang === "ar" ? "ملاحظات" : "Note"}</Label>
                  <Textarea rows={2} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
                </div>
              </div>
              <DialogFooter>
                <Button variant="ghost" onClick={() => setOpen(false)}>{t("common.cancel")}</Button>
                <Button onClick={saveExpense}>{t("common.save")}</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <StatCard icon={<TrendingUp className="h-4 w-4" />} label={lang === "ar" ? "الإيرادات" : "Revenue"} value={money(stats?.salesTotal ?? 0)} tone="pos" />
        <StatCard icon={<TrendingDown className="h-4 w-4" />} label={lang === "ar" ? "المشتريات" : "Purchases"} value={money(stats?.purchasesTotal ?? 0)} tone="neg" />
        <StatCard icon={<Receipt className="h-4 w-4" />} label={lang === "ar" ? "المصروفات" : "Expenses"} value={money(stats?.expensesTotal ?? 0)} tone="neg" />
        <StatCard icon={<Wallet className="h-4 w-4" />} label={lang === "ar" ? "صافي الربح" : "Net profit"} value={money(netProfit)} tone={netProfit >= 0 ? "pos" : "neg"} />
        <StatCard icon={<Users className="h-4 w-4" />} label={lang === "ar" ? "ذمم مدينة" : "Receivables"} value={money(stats?.receivables ?? 0)} tone="warn" />
        <StatCard icon={<Truck className="h-4 w-4" />} label={lang === "ar" ? "ذمم دائنة" : "Payables"} value={money(stats?.payables ?? 0)} tone="warn" />
        <StatCard icon={<TrendingUp className="h-4 w-4" />} label={lang === "ar" ? "تدفق نقدي داخل" : "Cash in"} value={money(stats?.cashIn ?? 0)} tone="pos" />
        <StatCard icon={<TrendingDown className="h-4 w-4" />} label={lang === "ar" ? "صافي النقدية" : "Net cash"} value={money(netCash)} tone={netCash >= 0 ? "pos" : "neg"} />
      </div>

      <Tabs defaultValue="expenses">
        <TabsList>
          <TabsTrigger value="expenses">{lang === "ar" ? "المصروفات" : "Expenses"}</TabsTrigger>
          <TabsTrigger value="debtors">{lang === "ar" ? "العملاء المدينون" : "Debtors"}</TabsTrigger>
          <TabsTrigger value="creditors">{lang === "ar" ? "الموردون الدائنون" : "Creditors"}</TabsTrigger>
        </TabsList>

        <TabsContent value="expenses">
          <Card>
            <CardHeader><CardTitle className="text-base">{lang === "ar" ? "آخر المصروفات" : "Recent expenses"}</CardTitle></CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{lang === "ar" ? "التاريخ" : "Date"}</TableHead>
                    <TableHead>{lang === "ar" ? "الفئة" : "Category"}</TableHead>
                    <TableHead>{lang === "ar" ? "الطريقة" : "Method"}</TableHead>
                    <TableHead>{lang === "ar" ? "الملاحظة" : "Note"}</TableHead>
                    <TableHead className="text-end">{lang === "ar" ? "المبلغ" : "Amount"}</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {expenses.length === 0 ? (
                    <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">{lang === "ar" ? "لا توجد مصروفات" : "No expenses yet"}</TableCell></TableRow>
                  ) : expenses.map((e) => (
                    <TableRow key={e.id}>
                      <TableCell className="font-mono text-xs">{e.expense_date}</TableCell>
                      <TableCell>{lang === "ar" ? (e.expense_categories?.name_ar ?? e.expense_categories?.name) : e.expense_categories?.name}</TableCell>
                      <TableCell><Badge variant="outline" className="capitalize">{e.payment_method}</Badge></TableCell>
                      <TableCell className="max-w-[300px] truncate text-muted-foreground">{e.note}</TableCell>
                      <TableCell className="text-end font-mono">{money(Number(e.amount))}</TableCell>
                      <TableCell><Button size="icon" variant="ghost" onClick={() => delExpense(e.id)}><Trash2 className="h-4 w-4" /></Button></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="debtors">
          <BalanceTable rows={debtors} emptyMsg={lang === "ar" ? "لا توجد ذمم" : "No outstanding"} />
        </TabsContent>
        <TabsContent value="creditors">
          <BalanceTable rows={creditors} emptyMsg={lang === "ar" ? "لا توجد ذمم" : "No outstanding"} />
        </TabsContent>
      </Tabs>
    </>
  );
}

function StatCard({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: string; tone: "pos" | "neg" | "warn" }) {
  const color = tone === "pos" ? "text-emerald-500" : tone === "neg" ? "text-rose-500" : "text-amber-500";
  return (
    <Card>
      <CardContent className="p-4">
        <div className={`flex items-center gap-2 text-xs ${color}`}>{icon}<span>{label}</span></div>
        <div className="mt-2 text-xl font-semibold font-mono">{value}</div>
      </CardContent>
    </Card>
  );
}

function BalanceTable({ rows, emptyMsg }: { rows: any[]; emptyMsg: string }) {
  return (
    <Card>
      <CardContent className="p-0">
        <Table>
          <TableHeader><TableRow><TableHead>Name</TableHead><TableHead className="text-end">Balance</TableHead></TableRow></TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow><TableCell colSpan={2} className="text-center text-muted-foreground py-8">{emptyMsg}</TableCell></TableRow>
            ) : rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell>{r.name}</TableCell>
                <TableCell className="text-end font-mono">{money(Number(r.balance))}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

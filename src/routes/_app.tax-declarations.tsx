import { ModuleGuard } from "@/lib/modules";
import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { PageHeader } from "@/components/page-header";
import { useI18n } from "@/lib/i18n";
import { supabase } from "@/integrations/supabase/client";
import { money } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ReceiptText,
  Calculator,
  CreditCard,
  Loader2,
  CheckCircle2,
  AlertTriangle,
} from "lucide-react";

export const Route = createFileRoute("/_app/tax-declarations")({
  head: () => ({ meta: [{ title: "الإقرار والتسوية الضريبية — Vortex ERP" }] }),
  component: () => (
    <ModuleGuard moduleId="advanced_accounting">
      <TaxDeclarationsPage />
    </ModuleGuard>
  ),
});

interface TaxSettlement {
  id: string;
  period_number: string;
  start_date: string;
  end_date: string;
  total_taxable_sales: number;
  output_tax_amount: number;
  total_taxable_purchases: number;
  input_tax_amount: number;
  net_tax_payable: number;
  status: "DRAFT" | "SETTLED" | "PAID";
  settled_at: string | null;
  paid_at: string | null;
}

interface DeclarationData {
  start_date: string;
  end_date: string;
  taxable_sales: number;
  output_tax: number;
  taxable_purchases: number;
  input_tax: number;
  net_tax_payable: number;
}

function TaxDeclarationsPage() {
  const { t } = useI18n();
  const currentYear = new Date().getFullYear();
  const [startDate, setStartDate] = useState(`${currentYear}-01-01`);
  const [endDate, setEndDate] = useState(new Date().toISOString().slice(0, 10));

  const [declaration, setDeclaration] = useState<DeclarationData | null>(null);
  const [history, setHistory] = useState<TaxSettlement[]>([]);
  const [loading, setLoading] = useState(false);
  const [acting, setActing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // حوار اعتماد التسوية
  const [settleOpen, setSettleOpen] = useState(false);
  const [periodCode, setPeriodCode] = useState(
    `TAX-${currentYear}-M${String(new Date().getMonth() + 1).padStart(2, "0")}`,
  );
  const [settleDate, setSettleDate] = useState(new Date().toISOString().slice(0, 10));

  // حوار السداد
  const [payOpen, setPayOpen] = useState(false);
  const [payingSettlement, setPayingSettlement] = useState<TaxSettlement | null>(null);
  const [payAccount, setPayAccount] = useState("1101");
  const [payDate, setPayDate] = useState(new Date().toISOString().slice(0, 10));

  const fetchDeclaration = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: rpcErr } = await supabase.rpc(
      "generate_tax_declaration" as never,
      {
        p_start_date: startDate,
        p_end_date: endDate,
      } as never,
    );
    setLoading(false);
    if (rpcErr) {
      setError(rpcErr.message);
      setDeclaration(null);
      return;
    }
    setDeclaration(data as unknown as DeclarationData);
  }, [startDate, endDate]);

  const loadHistory = useCallback(async () => {
    const { data, error: qErr } = await supabase
      .from("tax_settlement_periods" as never)
      .select("*")
      .order("start_date", { ascending: false });
    if (!qErr && data) {
      setHistory(data as unknown as TaxSettlement[]);
    }
  }, []);

  useEffect(() => {
    void fetchDeclaration();
    void loadHistory();
  }, [fetchDeclaration, loadHistory]);

  const handleSettle = async () => {
    if (!periodCode) return;
    setActing(true);
    setError(null);
    const { error: rpcErr } = await supabase.rpc(
      "settle_tax_period" as never,
      {
        p_start_date: startDate,
        p_end_date: endDate,
        p_period_number: periodCode.trim(),
        p_settlement_date: settleDate,
      } as never,
    );
    setActing(false);
    if (rpcErr) {
      setError(rpcErr.message);
      return;
    }
    setSettleOpen(false);
    setNotice("تمت تسوية الفترة الضريبية وترحيل القيد بنجاح (2311 ↔ 1316 → 2321)");
    await fetchDeclaration();
    await loadHistory();
  };

  const handlePay = async () => {
    if (!payingSettlement) return;
    setActing(true);
    setError(null);
    const { error: rpcErr } = await supabase.rpc(
      "pay_tax_settlement" as never,
      {
        p_settlement_id: payingSettlement.id,
        p_payment_date: payDate,
        p_payment_account: payAccount,
      } as never,
    );
    setActing(false);
    if (rpcErr) {
      setError(rpcErr.message);
      return;
    }
    setPayOpen(false);
    setNotice("تم سداد الالتزام الضريبي لهيئة الضرائب بنجاح");
    await loadHistory();
  };

  return (
    <div className="container mx-auto p-4 space-y-4">
      <PageHeader
        title={t("nav.tax_declarations") || "الإقرار والتسوية الضريبية"}
        subtitle="حساب ضريبة القيمة المضافة، مطابقة المخرجات 2311 والمدخلات 1316، وسداد صافي الضريبة 2321"
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onClick={fetchDeclaration} disabled={loading}>
              {loading ? (
                <Loader2 className="ms-2 h-4 w-4 animate-spin" />
              ) : (
                <Calculator className="ms-2 h-4 w-4" />
              )}
              تحديث الإقرار
            </Button>
            <Button
              onClick={() => setSettleOpen(true)}
              disabled={
                !declaration || (declaration.output_tax === 0 && declaration.input_tax === 0)
              }
            >
              <CheckCircle2 className="ms-2 h-4 w-4" />
              اعتماد تسوية الفترة
            </Button>
          </div>
        }
      />

      {error && (
        <div className="rounded-md bg-destructive/10 text-destructive p-3 text-sm flex items-center gap-2">
          <AlertTriangle className="h-4 w-4" />
          <span>{error}</span>
        </div>
      )}
      {notice && (
        <div className="rounded-md bg-green-500/10 text-green-700 p-3 text-sm flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4" />
          <span>{notice}</span>
        </div>
      )}

      {/* Date Filter Card */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold">تحديد فترة الإقرار الضريبي</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 items-end">
            <div className="space-y-1">
              <Label>تاريخ البداية</Label>
              <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>تاريخ النهاية</Label>
              <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </div>
            <Button onClick={fetchDeclaration} disabled={loading}>
              احتساب الضريبة
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Declaration Summary Deck */}
      {declaration && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-xs text-muted-foreground">
                المبيعات الخاضعة للضريبة
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-xl font-bold">{money(declaration.taxable_sales)}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-xs text-muted-foreground">ضريبة المخرجات (2311)</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-xl font-bold text-amber-600">
                {money(declaration.output_tax)}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-xs text-muted-foreground">
                المشتريات الخاضعة للضريبة
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-xl font-bold">{money(declaration.taxable_purchases)}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-xs text-muted-foreground">ضريبة المدخلات (1316)</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-xl font-bold text-blue-600">{money(declaration.input_tax)}</div>
            </CardContent>
          </Card>
          <Card
            className={
              declaration.net_tax_payable > 0
                ? "border-destructive/40 bg-destructive/5"
                : "border-green-500/40 bg-green-500/5"
            }
          >
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-semibold">
                {declaration.net_tax_payable >= 0
                  ? "صافي الضريبة واجبة السداد (2321)"
                  : "رصيد ضريبة فائض مسترد (2321)"}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div
                className={`text-xl font-bold ${
                  declaration.net_tax_payable >= 0 ? "text-destructive" : "text-green-600"
                }`}
              >
                {money(Math.abs(declaration.net_tax_payable))}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* History Table */}
      <Card>
        <CardHeader>
          <CardTitle>سجل التسويات والإقرارات السابقة</CardTitle>
        </CardHeader>
        <CardContent>
          {history.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              لا توجد تسويات ضريبية سابقة مسجلة.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>كود الفترة</TableHead>
                    <TableHead>من</TableHead>
                    <TableHead>إلى</TableHead>
                    <TableHead>ضريبة المخرجات (2311)</TableHead>
                    <TableHead>ضريبة المدخلات (1316)</TableHead>
                    <TableHead>صافي المستحق (2321)</TableHead>
                    <TableHead>الحالة</TableHead>
                    <TableHead className="text-end">الإجراءات</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {history.map((h) => (
                    <TableRow key={h.id}>
                      <TableCell className="font-mono font-medium">{h.period_number}</TableCell>
                      <TableCell>{h.start_date}</TableCell>
                      <TableCell>{h.end_date}</TableCell>
                      <TableCell className="text-amber-600 font-semibold">
                        {money(h.output_tax_amount)}
                      </TableCell>
                      <TableCell className="text-blue-600 font-semibold">
                        {money(h.input_tax_amount)}
                      </TableCell>
                      <TableCell
                        className={`font-bold ${
                          h.net_tax_payable > 0 ? "text-destructive" : "text-green-600"
                        }`}
                      >
                        {money(h.net_tax_payable)}
                      </TableCell>
                      <TableCell>
                        {h.status === "PAID" ? (
                          <Badge className="bg-green-600">مسدد بالكامل</Badge>
                        ) : h.status === "SETTLED" ? (
                          <Badge variant="secondary">مقفلة / بانتظار السداد</Badge>
                        ) : (
                          <Badge variant="outline">مسودة</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-end">
                        {h.status === "SETTLED" && h.net_tax_payable > 0 && (
                          <Button
                            size="sm"
                            onClick={() => {
                              setPayingSettlement(h);
                              setPayOpen(true);
                            }}
                            disabled={acting}
                          >
                            <CreditCard className="h-3 w-3 ms-1" />
                            سداد للهيئة
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Dialog: Settle Tax Period */}
      <Dialog open={settleOpen} onOpenChange={setSettleOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>اعتماد التسوية الضريبية للفترة</DialogTitle>
            <DialogDescription>
              سيتم إنشاء قيد محاسبي مزدوج يقفل 2311 و 1316 ويرحل الصافي إلى حساب صافي الضريبة
              المستحقة 2321.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1">
              <Label>كود/رقم الفترة الضريبية</Label>
              <Input
                value={periodCode}
                onChange={(e) => setPeriodCode(e.target.value)}
                placeholder="TAX-2026-Q1"
              />
            </div>
            <div className="space-y-1">
              <Label>تاريخ قيد التسوية</Label>
              <Input
                type="date"
                value={settleDate}
                onChange={(e) => setSettleDate(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSettleOpen(false)}>
              إلغاء
            </Button>
            <Button onClick={handleSettle} disabled={acting}>
              {acting && <Loader2 className="ms-2 h-4 w-4 animate-spin" />}
              تأكيد وإقفال التسوية
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog: Pay Settlement */}
      <Dialog open={payOpen} onOpenChange={setPayOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>سداد الالتزام الضريبي</DialogTitle>
            <DialogDescription>
              تسجيل قيد سداد الضريبة (Dr 2321 / Cr نقدية أو بنك)
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="p-3 rounded-lg border bg-muted/40 text-sm space-y-1">
              <div>
                الفترة: <strong>{payingSettlement?.period_number}</strong>
              </div>
              <div>
                المبلغ المستحق السداد:{" "}
                <strong className="text-destructive font-bold">
                  {money(payingSettlement?.net_tax_payable || 0)}
                </strong>
              </div>
            </div>
            <div className="space-y-1">
              <Label>تاريخ السداد</Label>
              <Input type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>طريقة / حساب السداد</Label>
              <Select value={payAccount} onValueChange={setPayAccount}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1101">1101 — النقدية بالصندوق</SelectItem>
                  <SelectItem value="1111">1111 — الحساب البنكي</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPayOpen(false)}>
              إلغاء
            </Button>
            <Button onClick={handlePay} disabled={acting}>
              {acting && <Loader2 className="ms-2 h-4 w-4 animate-spin" />}
              تأكيد السداد وترحيل القيد
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default TaxDeclarationsPage;

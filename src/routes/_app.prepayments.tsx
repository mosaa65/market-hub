import { ModuleGuard } from "@/lib/modules";
import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/page-header";
import { useI18n } from "@/lib/i18n";
import { supabase } from "@/integrations/supabase/client";
import { money } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { AmountInput } from "@/components/ui/amount-input";
import { QuantityInput } from "@/components/ui/quantity-input";
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
import { CalendarRange, Plus, Play, Loader2, CheckCircle2, AlertTriangle } from "lucide-react";

export const Route = createFileRoute("/_app/prepayments")({
  head: () => ({ meta: [{ title: "المصروفات والإيرادات المقدمة — Vortex ERP" }] }),
  component: () => (
    <ModuleGuard moduleId="advanced_accounting">
      <PrepaymentsPage />
    </ModuleGuard>
  ),
});

interface PrepaymentContract {
  id: string;
  contract_number: string;
  contract_type: "PREPAID_EXPENSE" | "DEFERRED_EXPENSE" | "DEFERRED_REVENUE";
  title: string;
  total_amount: number;
  start_date: string;
  end_date: string;
  total_periods: number;
  balance_account_code: string;
  target_account_code: string;
  status: "DRAFT" | "ACTIVE" | "COMPLETED" | "CANCELLED";
  amortized_amount: number;
  remaining_amount: number;
  last_amortization_date: string | null;
}

const TYPE_LABELS: Record<string, string> = {
  PREPAID_EXPENSE: "مصروف مدفوع مقدماً (أصل 1511)",
  DEFERRED_EXPENSE: "مصروف مؤجل (أصل 1512)",
  DEFERRED_REVENUE: "إيراد مؤجل (التزام 2231)",
};

function PrepaymentsPage() {
  const { t } = useI18n();
  const [contracts, setContracts] = useState<PrepaymentContract[]>([]);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // حوار عقد جديد
  const [newOpen, setNewOpen] = useState(false);
  const [num, setNum] = useState("");
  const [type, setType] = useState<PrepaymentContract["contract_type"]>("PREPAID_EXPENSE");
  const [title, setTitle] = useState("");
  const [amountNum, setAmountNum] = useState<number | null>(null);
  const [periods, setPeriods] = useState("12");
  const [targetAccount, setTargetAccount] = useState("5313");

  // حوار تشغيل التوزيع
  const [amortOpen, setAmortOpen] = useState(false);
  const [selectedContractId, setSelectedContractId] = useState<string | null>(null);
  const [amortDate, setAmortDate] = useState(new Date().toISOString().slice(0, 10));

  const loadContracts = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: qErr } = await supabase
      .from("prepaid_and_deferred_contracts" as never)
      .select("*")
      .order("start_date", { ascending: false });
    if (qErr) {
      setError(qErr.message);
      setContracts([]);
    } else {
      setContracts((data ?? []) as unknown as PrepaymentContract[]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadContracts();
  }, [loadContracts]);

  const summary = useMemo(() => {
    const active = contracts.filter((c) => c.status === "ACTIVE");
    const prepaidRem = active
      .filter((c) => c.contract_type === "PREPAID_EXPENSE")
      .reduce((s, c) => s + Number(c.remaining_amount || 0), 0);
    const defRevRem = active
      .filter((c) => c.contract_type === "DEFERRED_REVENUE")
      .reduce((s, c) => s + Number(c.remaining_amount || 0), 0);
    const totalAmort = contracts.reduce((s, c) => s + Number(c.amortized_amount || 0), 0);
    return {
      activeCount: active.length,
      prepaidRem,
      defRevRem,
      totalAmort,
    };
  }, [contracts]);

  const handleCreate = async () => {
    if (!num || !title || amountNum == null || amountNum <= 0 || !periods) return;
    setActing(true);
    setError(null);
    const total = amountNum;
    const count = Number(periods);
    const balAccount =
      type === "PREPAID_EXPENSE" ? "1511" : type === "DEFERRED_EXPENSE" ? "1512" : "2231";

    const { error: insErr } = await supabase
      .from("prepaid_and_deferred_contracts" as never)
      .insert({
        contract_number: num.trim(),
        contract_type: type,
        title: title.trim(),
        total_amount: total,
        start_date: new Date().toISOString().slice(0, 10),
        end_date: new Date(Date.now() + count * 30 * 86400000).toISOString().slice(0, 10),
        total_periods: count,
        balance_account_code: balAccount,
        target_account_code: targetAccount,
        status: "DRAFT",
        amortized_amount: 0,
        remaining_amount: total,
      } as never);

    setActing(false);
    if (insErr) {
      setError(insErr.message);
      return;
    }
    setNewOpen(false);
    setNum("");
    setTitle("");
    setAmountNum(null);
    setNotice("تمت إضافة العقد كمسودة بنجاح");
    await loadContracts();
  };

  const handleActivate = async (id: string) => {
    setActing(true);
    setError(null);
    const { error: actErr } = await supabase.rpc(
      "activate_prepaid_contract" as never,
      { p_contract_id: id } as never,
    );
    setActing(false);
    if (actErr) {
      setError(actErr.message);
      return;
    }
    setNotice("تم تفعيل العقد بنجاح");
    await loadContracts();
  };

  const handleRunAmortization = async () => {
    setActing(true);
    setError(null);
    if (selectedContractId) {
      const { error: rpcErr } = await supabase.rpc(
        "run_contract_amortization" as never,
        {
          p_contract_id: selectedContractId,
          p_date: amortDate,
        } as never,
      );
      if (rpcErr) {
        setError(rpcErr.message);
        setActing(false);
        return;
      }
      setNotice("تم ترحيل قسط التوزيع الزمني بنجاح");
    } else {
      const { error: rpcErr } = await supabase.rpc(
        "run_batch_amortization" as never,
        { p_date: amortDate } as never,
      );
      if (rpcErr) {
        setError(rpcErr.message);
        setActing(false);
        return;
      }
      setNotice("تم توزيع أقساط جميع العقود النشطة بنجاح");
    }
    setActing(false);
    setAmortOpen(false);
    await loadContracts();
  };

  const statusBadge = (st: PrepaymentContract["status"]) => {
    switch (st) {
      case "ACTIVE":
        return <Badge className="bg-green-600">نشط</Badge>;
      case "DRAFT":
        return <Badge variant="secondary">مسودة</Badge>;
      case "COMPLETED":
        return <Badge className="bg-blue-600">مكتمل</Badge>;
      case "CANCELLED":
        return <Badge variant="destructive">ملغي</Badge>;
    }
  };

  return (
    <div className="container mx-auto p-4 space-y-4">
      <PageHeader
        title={t("nav.prepayments") || "المصروفات والإيرادات المقدمة"}
        subtitle="إدارة العقود الممتدة (إيجار، اشتراكات، خدمات) وتوزيعها آلياً على الفترات المحاسبية"
        actions={
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setSelectedContractId(null);
                setAmortOpen(true);
              }}
            >
              <Play className="ms-2 h-4 w-4" />
              توزيع الأقساط الدورية
            </Button>
            <Button onClick={() => setNewOpen(true)}>
              <Plus className="ms-2 h-4 w-4" />
              إضافة عقد جديد
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

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              العقود النشطة
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{summary.activeCount}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              متبقي المصروفات المقدمة (1511)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-amber-600">{money(summary.prepaidRem)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              متبقي الإيرادات المؤجلة (2231)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-blue-600">{money(summary.defRevRem)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              إجمالي ما تم استهلاكه
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">{money(summary.totalAmort)}</div>
          </CardContent>
        </Card>
      </div>

      {/* Contracts Table */}
      <Card>
        <CardHeader>
          <CardTitle>سجل العقود والمقدمات</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="py-8 text-center text-sm text-muted-foreground flex justify-center items-center gap-2">
              <Loader2 className="h-5 w-5 animate-spin" />
              <span>جارٍ تحميل العقود...</span>
            </div>
          ) : contracts.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              لا توجد عقود مقدمة أو مؤجلة مسجلة.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>رقم العقد</TableHead>
                    <TableHead>البيان</TableHead>
                    <TableHead>النوع</TableHead>
                    <TableHead>الإجمالي</TableHead>
                    <TableHead>الفترات</TableHead>
                    <TableHead>المستهلك</TableHead>
                    <TableHead>المتبقي</TableHead>
                    <TableHead>الحالة</TableHead>
                    <TableHead className="text-end">الإجراءات</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {contracts.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell className="font-mono font-medium">{c.contract_number}</TableCell>
                      <TableCell>{c.title}</TableCell>
                      <TableCell>{TYPE_LABELS[c.contract_type]}</TableCell>
                      <TableCell>{money(c.total_amount)}</TableCell>
                      <TableCell>{c.total_periods} شهر</TableCell>
                      <TableCell className="text-green-600 font-semibold">
                        {money(c.amortized_amount)}
                      </TableCell>
                      <TableCell className="text-amber-600 font-semibold">
                        {money(c.remaining_amount)}
                      </TableCell>
                      <TableCell>{statusBadge(c.status)}</TableCell>
                      <TableCell className="text-end space-x-1 space-x-reverse">
                        {c.status === "DRAFT" && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleActivate(c.id)}
                            disabled={acting}
                          >
                            تفعيل
                          </Button>
                        )}
                        {c.status === "ACTIVE" && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setSelectedContractId(c.id);
                              setAmortOpen(true);
                            }}
                            disabled={acting}
                          >
                            <Play className="h-3 w-3 ms-1" />
                            توزيع قسط
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

      {/* Dialog: Create Contract */}
      <Dialog open={newOpen} onOpenChange={setNewOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>إضافة عقد مقدم أو مؤجل</DialogTitle>
            <DialogDescription>تسجيل عقد جديد وتحديد شروط الاستهلاك الزمني</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>رقم العقد</Label>
                <Input
                  value={num}
                  onChange={(e) => setNum(e.target.value)}
                  placeholder="PPD-2026-01"
                />
              </div>
              <div className="space-y-1">
                <Label>نوع العقد</Label>
                <Select
                  value={type}
                  onValueChange={(v) => setType(v as PrepaymentContract["contract_type"])}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="PREPAID_EXPENSE">مصروف مدفوع مقدماً (1511)</SelectItem>
                    <SelectItem value="DEFERRED_EXPENSE">مصروف مؤجل (1512)</SelectItem>
                    <SelectItem value="DEFERRED_REVENUE">إيراد مؤجل (2231)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1">
              <Label>بيان العقد</Label>
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="مثال: إيجار المقر السنوي 2026"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>المبلغ الإجمالي</Label>
                <AmountInput value={amountNum} onValueChange={setAmountNum} decimals={2} />
              </div>
              <div className="space-y-1">
                <Label>عدد الفترات (شهور)</Label>
                <QuantityInput
                  decimals={0}
                  min={1}
                  max={120}
                  value={periods === "" ? null : Number(periods)}
                  onValueChange={(v) => setPeriods(v == null ? "" : String(v))}
                  placeholder="12"
                  aria-label="عدد الفترات (شهور)"
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label>الحساب المقابل الفعلي (مصروف أو إيراد)</Label>
              <Select value={targetAccount} onValueChange={setTargetAccount}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="5313">5313 — إيجارات</SelectItem>
                  <SelectItem value="5319">5319 — أتعاب مهنية واستشارات</SelectItem>
                  <SelectItem value="5511">5511 — مصروفات إدارية</SelectItem>
                  <SelectItem value="4311">4311 — إيراد الخدمات</SelectItem>
                  <SelectItem value="4911">4911 — إيرادات أخرى</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewOpen(false)}>
              إلغاء
            </Button>
            <Button onClick={handleCreate} disabled={acting}>
              {acting && <Loader2 className="ms-2 h-4 w-4 animate-spin" />}
              حفظ العقد
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog: Run Amortization */}
      <Dialog open={amortOpen} onOpenChange={setAmortOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {selectedContractId ? "توزيع قسط العقد المحدد" : "توزيع الأقساط لجميع العقود النشطة"}
            </DialogTitle>
            <DialogDescription>
              سيتم إنشاء القيود المحاسبية وتخفيض الأرصدة المقدمة تلقائياً
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1">
              <Label>تاريخ التوزيع / القسط</Label>
              <Input type="date" value={amortDate} onChange={(e) => setAmortDate(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAmortOpen(false)}>
              إلغاء
            </Button>
            <Button onClick={handleRunAmortization} disabled={acting}>
              {acting && <Loader2 className="ms-2 h-4 w-4 animate-spin" />}
              تأكيد التوزيع والترحيل
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default PrepaymentsPage;

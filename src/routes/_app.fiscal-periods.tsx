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
import { QuantityInput } from "@/components/ui/quantity-input";
import { Label } from "@/components/ui/label";
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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { CalendarRange, Lock, LockOpen, Loader2 } from "lucide-react";

/**
 * T-19: إدارة الفترات المالية — فتح سنة، عرض الفترات الشهرية، إقفال/فتح فترة،
 * وإقفال السنة المالية (T-20) الذي يصفّر 4xxx/5xxx في 3911.
 *
 * المصادر:
 * - جدول fiscal_periods (من مهاجرة 21).
 * - RPC: open_fiscal_year / set_period_status / close_fiscal_year.
 */

export const Route = createFileRoute("/_app/fiscal-periods")({
  head: () => ({ meta: [{ title: "الفترات المالية — Vortex ERP" }] }),
  component: () => (
    <ModuleGuard moduleId="advanced_accounting">
      <FiscalPeriodsPage />
    </ModuleGuard>
  ),
});

interface FiscalPeriod {
  id: string;
  code: string;
  fiscal_year: number;
  period_no: number;
  start_date: string;
  end_date: string;
  status: "OPEN" | "CLOSED";
}

interface YearSummary {
  year: number;
  total_debit: number;
  total_credit: number;
}

function FiscalPeriodsPage() {
  const { t } = useI18n();
  const [periods, setPeriods] = useState<FiscalPeriod[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // فتح سنة جديدة
  const [openYearOpen, setOpenYearOpen] = useState(false);
  const [openYearValue, setOpenYearValue] = useState(String(new Date().getFullYear() + 1));

  // إقفال سنة مالية (T-20)
  const [closeYear, setCloseYear] = useState<number | null>(null);
  const [closeConfirm, setCloseConfirm] = useState(false);

  const loadPeriods = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: qErr } = await supabase
      .from("fiscal_periods" as never)
      .select("id,code,fiscal_year,period_no,start_date,end_date,status")
      .order("start_date", { ascending: false });
    if (qErr) {
      setError(qErr.message);
      setPeriods([]);
    } else {
      setPeriods((data ?? []) as unknown as FiscalPeriod[]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadPeriods();
  }, [loadPeriods]);

  const years = useMemo(() => {
    const set = new Set<number>();
    periods.forEach((p) => set.add(p.fiscal_year));
    return [...set].sort((a, b) => b - a);
  }, [periods]);

  // رصيد كل سنة من trial_balance المقصوص على الفترة — نعرض هنا الإجماليات فقط
  // عبر الاستعلام المباشر من trial_balance (عرض مهاجرة 20) لكل سنة منفردة.
  const [yearSummaries, setYearSummaries] = useState<Record<number, YearSummary>>({});

  const loadYearSummary = useCallback(async (year: number) => {
    const start = `${year}-01-01`;
    const end = `${year}-12-31`;
    const { data, error: qErr } = await supabase
      .from("trial_balance" as never)
      .select("total_debit,total_credit")
      .gte("period_start", start)
      .lte("period_end", end);
    if (qErr) return;
    const rows = (data ?? []) as unknown as { total_debit: number; total_credit: number }[];
    setYearSummaries((prev) => ({
      ...prev,
      [year]: {
        year,
        total_debit: rows.reduce((a, r) => a + Number(r.total_debit ?? 0), 0),
        total_credit: rows.reduce((a, r) => a + Number(r.total_credit ?? 0), 0),
      },
    }));
  }, []);

  useEffect(() => {
    years.forEach((y) => void loadYearSummary(y));
  }, [years, loadYearSummary]);

  const doOpenYear = async () => {
    setBusy(true);
    setActionError(null);
    const year = Number(openYearValue);
    const { error: rpcErr } = await supabase.rpc(
      "open_fiscal_year" as never,
      {
        p_year: year,
      } as never,
    );
    setBusy(false);
    if (rpcErr) {
      setActionError(rpcErr.message);
      return;
    }
    setOpenYearOpen(false);
    await loadPeriods();
  };

  const togglePeriod = async (p: FiscalPeriod) => {
    setBusy(true);
    setActionError(null);
    const target = p.status === "OPEN" ? "CLOSED" : "OPEN";
    const { error: rpcErr } = await supabase.rpc(
      "set_period_status" as never,
      {
        p_period_id: p.id,
        p_status: target,
      } as never,
    );
    setBusy(false);
    if (rpcErr) {
      setActionError(rpcErr.message);
      return;
    }
    await loadPeriods();
  };

  const doCloseYear = async () => {
    if (closeYear == null) return;
    setBusy(true);
    setActionError(null);
    const { error: rpcErr } = await supabase.rpc(
      "close_fiscal_year" as never,
      {
        p_year: closeYear,
      } as never,
    );
    setBusy(false);
    setCloseConfirm(false);
    if (rpcErr) {
      setActionError(rpcErr.message);
      return;
    }
    setCloseYear(null);
    await loadPeriods();
  };

  const closedInYear = (year: number) =>
    periods.filter((p) => p.fiscal_year === year && p.status === "CLOSED").length;
  const allClosed = (year: number) => closedInYear(year) === 12;

  return (
    <div className="container mx-auto p-4 space-y-4">
      <PageHeader
        title={t("nav.fiscal_periods") || "الفترات المالية"}
        subtitle="إدارة السنوات والفترات المحاسبية — فتح سنة، إقفال فترة، وإقفال سنة مالية كاملة"
        actions={
          <>
            <Button variant="outline" onClick={() => setOpenYearOpen(true)}>
              <LockOpen className="ms-2 h-4 w-4" />
              فتح سنة مالية
            </Button>
          </>
        }
      />

      {error && (
        <div className="rounded-md bg-destructive/10 text-destructive px-4 py-2 text-sm">
          {error}
        </div>
      )}
      {actionError && (
        <div className="rounded-md bg-destructive/10 text-destructive px-4 py-2 text-sm">
          {actionError}
        </div>
      )}

      {years.map((year) => (
        <div key={year} className="space-y-2">
          <div className="flex items-center justify-between rounded-lg border p-3">
            <div className="flex items-center gap-3">
              <span className="text-lg font-bold">سنة {year}</span>
              <Badge variant={allClosed(year) ? "destructive" : "secondary"}>
                {closedInYear(year)}/12 فترة مقفلة
              </Badge>
              {yearSummaries[year] && (
                <span className="text-xs text-muted-foreground">
                  مدين {money(yearSummaries[year].total_debit)} / دائن{" "}
                  {money(yearSummaries[year].total_credit)}
                </span>
              )}
            </div>
            <Button
              variant="destructive"
              size="sm"
              disabled={busy}
              onClick={() => {
                setCloseYear(year);
                setCloseConfirm(true);
              }}
            >
              <Lock className="ms-2 h-4 w-4" />
              إقفال السنة المالية
            </Button>
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>الرمز</TableHead>
                <TableHead>الفترة</TableHead>
                <TableHead>من</TableHead>
                <TableHead>إلى</TableHead>
                <TableHead>الحالة</TableHead>
                <TableHead className="text-left">إجراء</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {periods
                .filter((p) => p.fiscal_year === year)
                .sort((a, b) => a.period_no - b.period_no)
                .map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-mono">{p.code}</TableCell>
                    <TableCell>الشهر {p.period_no}</TableCell>
                    <TableCell>{p.start_date}</TableCell>
                    <TableCell>{p.end_date}</TableCell>
                    <TableCell>
                      <Badge variant={p.status === "OPEN" ? "secondary" : "destructive"}>
                        {p.status === "OPEN" ? "مفتوحة" : "مقفلة"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-left">
                      <Button
                        size="sm"
                        variant={p.status === "OPEN" ? "outline" : "ghost"}
                        disabled={busy}
                        onClick={() => void togglePeriod(p)}
                      >
                        {p.status === "OPEN" ? (
                          <>
                            <Lock className="ms-1 h-3 w-3" /> إقفال
                          </>
                        ) : (
                          <>
                            <LockOpen className="ms-1 h-3 w-3" /> فتح
                          </>
                        )}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              {periods.filter((p) => p.fiscal_year === year).length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground">
                    لا فترات لهذه السنة
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      ))}

      {years.length === 0 && !loading && (
        <div className="rounded-lg border p-8 text-center text-muted-foreground">
          لا فترات مالية بعد. ابدأ بفتح سنة مالية — سيُنشأ لها 12 فترة شهرية.
        </div>
      )}

      {loading && (
        <div className="flex items-center justify-center gap-2 p-8 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> جارٍ التحميل…
        </div>
      )}

      {/* حوار فتح سنة جديدة */}
      <Dialog open={openYearOpen} onOpenChange={setOpenYearOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>فتح سنة مالية جديدة</DialogTitle>
            <DialogDescription>
              سيُنشأ 12 فترة شهرية (01…12). لا يُكتب أي قيد افتتاحي — أرصدة السنة الجديدة مشتقة
              تلقائيًا من القيود القائمة.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="fiscal-year-input">السنة</Label>
            <QuantityInput
              id="fiscal-year-input"
              decimals={0}
              min={2000}
              max={2100}
              value={openYearValue === "" ? null : Number(openYearValue)}
              onValueChange={(v) => setOpenYearValue(v == null ? "" : String(v))}
              placeholder="مثال: 2027"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpenYearOpen(false)}>
              إلغاء
            </Button>
            <Button onClick={() => void doOpenYear()} disabled={busy}>
              {busy && <Loader2 className="me-2 h-4 w-4 animate-spin" />}
              فتح السنة
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* تأكيد إقفال السنة (T-20) */}
      <AlertDialog open={closeConfirm} onOpenChange={setCloseConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>إقفال السنة المالية {closeYear}</AlertDialogTitle>
            <AlertDialogDescription>
              سيُنشأ قيد إقفال بتاريخ 31/12/{closeYear} يُصفّر كل حسابات الإيرادات (4xxx) والمصروفات
              (5xxx) ويرحّل صافي النتيجة إلى الأرباح المحتجزة (3911). لا يمكن التراجع إلا بعكس
              القيد. يجب ألا تكون فترة ديسمبر مقفلة، وأن تكون كل فترات السنة مقفلة قبل الإقفال.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction onClick={() => void doCloseYear()}>تأكيد الإقفال</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

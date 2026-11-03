import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Loader2, Lock, Unlock, AlertTriangle, CheckCircle2 } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/_app/fiscal-year-close")({
  head: () => ({ meta: [{ title: "إقفال السنة المالية — Vortex ERP" }] }),
  component: FiscalYearClosePage,
});

type Period = {
  id: string;
  fiscal_year: number;
  period_no: number;
  start_date: string;
  end_date: string;
  status: "OPEN" | "CLOSED";
  closed_at: string | null;
};

type YearSummary = {
  fiscal_year: number;
  total_debit: number;
  total_credit: number;
  entry_count: number;
};

function FiscalYearClosePage() {
  const { roles } = useAuth();
  const { t } = useI18n();
  const qc = useQueryClient();
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [years, setYears] = useState<number[]>([]);
  const [selectedYear, setSelectedYear] = useState<number | null>(null);
  const [periods, setPeriods] = useState<Period[]>([]);
  const [summary, setSummary] = useState<YearSummary | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");

  const canManage =
    roles?.includes("owner") || roles?.includes("manager") || roles?.includes("accountant");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data: allPeriods, error: pErr } = await supabase
        .from("fiscal_periods" as never)
        .select("id,fiscal_year,period_no,start_date,end_date,status,closed_at")
        .order("fiscal_year", { ascending: false })
        .order("period_no", { ascending: true });
      if (pErr) throw pErr;
      const list = (allPeriods ?? []) as unknown as Period[];
      setPeriods(list);
      const ys = Array.from(new Set(list.map((p) => p.fiscal_year))).sort((a, b) => b - a);
      setYears(ys);
      setSelectedYear((prev) => prev ?? ys[0] ?? null);

      if (selectedYear != null) {
        const { data: entries, error: entErr } = await (supabase as any)
          .from("journal_entries")
          .select("id,total_debit,total_credit")
          .eq("status", "POSTED")
          .gte("entry_date", `${selectedYear}-01-01`)
          .lte("entry_date", `${selectedYear}-12-31`);
        if (entErr) throw entErr;
        const rows = (entries ?? []) as {
          id: string;
          total_debit: number;
          total_credit: number;
        }[];
        setSummary({
          fiscal_year: selectedYear,
          total_debit: rows.reduce((s, r) => s + (Number(r.total_debit) || 0), 0),
          total_credit: rows.reduce((s, r) => s + (Number(r.total_credit) || 0), 0),
          entry_count: rows.length,
        });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [selectedYear]);

  useEffect(() => {
    void load();
  }, [load]);

  async function closeYear() {
    if (selectedYear == null) return;
    setActing(true);
    setError(null);
    setNotice(null);
    try {
      const { error: fnErr } = await supabase.rpc(
        "close_fiscal_year" as never,
        {
          p_year: selectedYear,
        } as never,
      );
      if (fnErr) throw fnErr;
      setNotice(`تم إقفال السنة المالية ${selectedYear} بنجاح`);
      setConfirmOpen(false);
      setConfirmText("");
      await qc.invalidateQueries();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setActing(false);
    }
  }

  async function openYear() {
    if (selectedYear == null) return;
    setActing(true);
    setError(null);
    setNotice(null);
    try {
      const { error: fnErr } = await supabase.rpc(
        "open_fiscal_year" as never,
        {
          p_year: selectedYear,
        } as never,
      );
      if (fnErr) throw fnErr;
      setNotice(`تم فتح السنة المالية ${selectedYear}`);
      await qc.invalidateQueries();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setActing(false);
    }
  }

  const yearPeriods = periods.filter((p) => p.fiscal_year === selectedYear);
  const allClosed = yearPeriods.length > 0 && yearPeriods.every((p) => p.status === "CLOSED");
  const balanced = summary ? Math.abs(summary.total_debit - summary.total_credit) < 0.01 : false;

  return (
    <div className="space-y-4 p-4">
      <div>
        <h1 className="text-2xl font-bold">{t("إقفال السنة المالية")}</h1>
        <p className="text-sm text-muted-foreground">
          {t("اختر السنة، تحقق من توازن القيود، ثم قم بالإقفال أو إعادة الفتح")}
        </p>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>{t("خطأ")}</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {notice && (
        <Alert>
          <CheckCircle2 className="h-4 w-4" />
          <AlertTitle>{t("تم")}</AlertTitle>
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{t("اختيار السنة المالية")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-2">
          {years.length === 0 && !loading && (
            <p className="text-sm text-muted-foreground">{t("لا توجد سنوات مالية معرفة")}</p>
          )}
          {years.map((y) => (
            <Button
              key={y}
              variant={selectedYear === y ? "default" : "outline"}
              size="sm"
              onClick={() => setSelectedYear(y)}
            >
              {y}
            </Button>
          ))}
        </CardContent>
      </Card>

      {selectedYear != null && (
        <Card>
          <CardHeader>
            <CardTitle>
              {t("ملخص السنة")} {selectedYear}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {loading ? (
              <div className="flex items-center gap-2 text-sm">
                <Loader2 className="h-4 w-4 animate-spin" /> {t("جارٍ التحميل...")}
              </div>
            ) : (
              <>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div className="rounded-lg border p-3">
                    <p className="text-xs text-muted-foreground">{t("إجمالي المدين")}</p>
                    <p className="text-lg font-semibold">
                      {summary?.total_debit.toLocaleString() ?? "0"}
                    </p>
                  </div>
                  <div className="rounded-lg border p-3">
                    <p className="text-xs text-muted-foreground">{t("إجمالي الدائن")}</p>
                    <p className="text-lg font-semibold">
                      {summary?.total_credit.toLocaleString() ?? "0"}
                    </p>
                  </div>
                  <div className="rounded-lg border p-3">
                    <p className="text-xs text-muted-foreground">{t("عدد القيود")}</p>
                    <p className="text-lg font-semibold">{summary?.entry_count ?? 0}</p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {balanced ? (
                    <Badge className="bg-green-600">
                      <CheckCircle2 className="h-3 w-3 me-1" /> {t("القيود متوازنة")}
                    </Badge>
                  ) : (
                    <Badge variant="destructive">
                      <AlertTriangle className="h-3 w-3 me-1" /> {t("القيود غير متوازنة")}
                    </Badge>
                  )}
                  {allClosed ? (
                    <Badge className="bg-green-600">
                      <Lock className="h-3 w-3 me-1" /> {t("جميع الفترات مقفلة")}
                    </Badge>
                  ) : (
                    <Badge variant="secondary">
                      <Unlock className="h-3 w-3 me-1" /> {t("توجد فترات مفتوحة")}
                    </Badge>
                  )}
                </div>

                <Separator />

                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-start text-muted-foreground">
                        <th className="p-2 text-start">{t("الفترة")}</th>
                        <th className="p-2 text-start">{t("من")}</th>
                        <th className="p-2 text-start">{t("إلى")}</th>
                        <th className="p-2 text-start">{t("الحالة")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {yearPeriods.map((p) => (
                        <tr key={p.id} className="border-b last:border-0">
                          <td className="p-2">{p.period_no}</td>
                          <td className="p-2">{p.start_date}</td>
                          <td className="p-2">{p.end_date}</td>
                          <td className="p-2">
                            <Badge variant={p.status === "CLOSED" ? "default" : "secondary"}>
                              {p.status === "CLOSED" ? t("مقفلة") : t("مفتوحة")}
                            </Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {canManage && (
                  <div className="flex flex-wrap gap-2">
                    {!allClosed && (
                      <Button onClick={() => setConfirmOpen(true)} disabled={!balanced || acting}>
                        {acting ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Lock className="h-4 w-4" />
                        )}
                        {t("إقفال السنة")}
                      </Button>
                    )}
                    {allClosed && (
                      <Button variant="outline" onClick={openYear} disabled={acting}>
                        {acting ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Unlock className="h-4 w-4" />
                        )}
                        {t("إعادة فتح السنة")}
                      </Button>
                    )}
                  </div>
                )}

                {confirmOpen && (
                  <div className="rounded-lg border border-destructive bg-destructive/10 p-4 space-y-3">
                    <p className="font-semibold text-destructive">
                      {t("تأكيد إقفال السنة")} {selectedYear}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {t(
                        "سيتم قفل جميع الفترات ولن يمكن إضافة قيود على هذه السنة إلا بعد إعادة الفتح. اكتب رقم السنة للتأكيد:",
                      )}
                    </p>
                    <Input
                      value={confirmText}
                      onChange={(e) => setConfirmText(e.target.value)}
                      placeholder={String(selectedYear)}
                    />
                    <div className="flex gap-2">
                      <Button
                        variant="destructive"
                        onClick={closeYear}
                        disabled={confirmText !== String(selectedYear) || acting}
                      >
                        {t("تأكيد الإقفال")}
                      </Button>
                      <Button variant="outline" onClick={() => setConfirmOpen(false)}>
                        {t("إلغاء")}
                      </Button>
                    </div>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
export default FiscalYearClosePage;

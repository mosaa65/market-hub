import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/page-header";
import { useI18n } from "@/lib/i18n";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { money } from "@/lib/format";
import { AlertTriangle, PackageX, Users, Truck } from "lucide-react";

export const Route = createFileRoute("/_app/notifications")({
  head: () => ({ meta: [{ title: "Notifications — Vortex ERP" }] }),
  component: NotificationsPage,
});

interface Alert { kind: "low" | "out" | "debt_c" | "debt_s"; title: string; sub: string; meta?: string; severity: "warn" | "danger" | "info" }

function NotificationsPage() {
  const { t, lang } = useI18n();
  const [alerts, setAlerts] = useState<Alert[]>([]);

  useEffect(() => {
    (async () => {
      const [prods, inv, custs, supps] = await Promise.all([
        supabase.from("products").select("id,name,name_ar,min_stock").eq("is_active", true),
        supabase.from("inventory").select("product_id,quantity"),
        supabase.from("customers").select("id,name,balance,credit_limit").gt("balance", 0).order("balance", { ascending: false }).limit(50),
        supabase.from("suppliers").select("id,name,balance").gt("balance", 0).order("balance", { ascending: false }).limit(50),
      ]);

      const stock = new Map<string, number>();
      (inv.data ?? []).forEach((i: any) => stock.set(i.product_id, (stock.get(i.product_id) ?? 0) + Number(i.quantity)));

      const out: Alert[] = [];
      (prods.data ?? []).forEach((p: any) => {
        const q = stock.get(p.id) ?? 0;
        const min = Number(p.min_stock ?? 0);
        const name = lang === "ar" ? (p.name_ar ?? p.name) : p.name;
        if (q <= 0) out.push({ kind: "out", title: name, sub: lang === "ar" ? "نفد المخزون" : "Out of stock", severity: "danger" });
        else if (q <= min && min > 0) out.push({ kind: "low", title: name, sub: lang === "ar" ? `الكمية ${q} ≤ الحد ${min}` : `${q} on hand ≤ min ${min}`, severity: "warn" });
      });

      (custs.data ?? []).forEach((c: any) => {
        const over = c.credit_limit > 0 && Number(c.balance) > Number(c.credit_limit);
        out.push({ kind: "debt_c", title: c.name, sub: lang === "ar" ? "ذمم مدينة" : "Outstanding receivable", meta: money(Number(c.balance)), severity: over ? "danger" : "info" });
      });
      (supps.data ?? []).forEach((s: any) => {
        out.push({ kind: "debt_s", title: s.name, sub: lang === "ar" ? "ذمم دائنة" : "Outstanding payable", meta: money(Number(s.balance)), severity: "info" });
      });

      setAlerts(out);
    })();
  }, [lang]);

  const groups = {
    danger: alerts.filter(a => a.severity === "danger"),
    warn: alerts.filter(a => a.severity === "warn"),
    info: alerts.filter(a => a.severity === "info"),
  };

  return (
    <>
      <PageHeader title={t("notifications.title")} subtitle={lang === "ar" ? "تنبيهات المخزون والذمم في الوقت الحقيقي" : "Live stock & receivables alerts"} />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-6">
        <Summary label={lang === "ar" ? "حرجة" : "Critical"} count={groups.danger.length} color="text-rose-500" />
        <Summary label={lang === "ar" ? "تحذيرات" : "Warnings"} count={groups.warn.length} color="text-amber-500" />
        <Summary label={lang === "ar" ? "إخطارات" : "Info"} count={groups.info.length} color="text-sky-500" />
      </div>
      <Card>
        <CardContent className="p-0 divide-y divide-border">
          {alerts.length === 0 ? <div className="text-center py-12 text-muted-foreground">{lang === "ar" ? "كل شيء بخير ✓" : "All clear ✓"}</div>
            : alerts.map((a, i) => (
              <div key={i} className="flex items-center gap-3 p-3">
                <div className={`grid h-9 w-9 place-items-center rounded-md ${
                  a.severity === "danger" ? "bg-rose-500/10 text-rose-500" :
                  a.severity === "warn" ? "bg-amber-500/10 text-amber-500" : "bg-sky-500/10 text-sky-500"}`}>
                  {a.kind === "out" ? <PackageX className="h-4 w-4" /> :
                   a.kind === "low" ? <AlertTriangle className="h-4 w-4" /> :
                   a.kind === "debt_c" ? <Users className="h-4 w-4" /> : <Truck className="h-4 w-4" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{a.title}</div>
                  <div className="text-xs text-muted-foreground">{a.sub}</div>
                </div>
                {a.meta && <Badge variant="outline" className="font-mono">{a.meta}</Badge>}
              </div>
            ))}
        </CardContent>
      </Card>
    </>
  );
}

function Summary({ label, count, color }: { label: string; count: number; color: string }) {
  return (
    <Card><CardContent className="p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`mt-1 text-2xl font-semibold ${color}`}>{count}</div>
    </CardContent></Card>
  );
}

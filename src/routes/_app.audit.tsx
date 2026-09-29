import { ModuleGuard } from "@/lib/modules";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { History, Search } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/lib/auth";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { useRealtimeTable } from "@/lib/realtime";
import { ChevronDown } from "lucide-react";

export const Route = createFileRoute("/_app/audit")({
  head: () => ({ meta: [{ title: "Audit Logs — Vortex ERP" }] }),
  component: () => (
    <ModuleGuard moduleId="audit">
      <AuditPage />
    </ModuleGuard>
  ),
});

interface Log {
  id: string;
  actor_id: string | null;
  action: "INSERT" | "UPDATE" | "DELETE";
  entity_type: string;
  entity_id: string | null;
  old_data: Record<string, unknown> | null;
  new_data: Record<string, unknown> | null;
  details: { message_key?: string; table?: string; record_id?: string } | null;
  created_at: string;
}

function AuditPage() {
  const { t, lang } = useI18n();
  const { hasRole } = useAuth();
  const allowed = hasRole("owner") || hasRole("manager");
  const [rows, setRows] = useState<Log[]>([]);
  const [search, setSearch] = useState("");
  const [profiles, setProfiles] = useState<Record<string, string>>({});

  const refreshActorNames = async (logs: Log[]) => {
    const ids = Array.from(new Set(logs.map((r) => r.actor_id).filter(Boolean))) as string[];
    if (!ids.length) return;
    const { data: ps } = await supabase.from("profiles").select("id,full_name").in("id", ids);
    setProfiles((current) => ({
      ...current,
      ...(ps ?? []).reduce<Record<string, string>>((map, profile: any) => {
        map[profile.id] = profile.full_name ?? "—";
        return map;
      }, {}),
    }));
  };

  useEffect(() => {
    if (!allowed) return;
    (async () => {
      const { data } = await supabase
        .from("system_activity_logs" as any)
        .select("*")
        .order("created_at", { ascending: false })
        .limit(500);
      const logs = (data ?? []) as Log[];
      setRows(logs);
      await refreshActorNames(logs);
    })();
  }, [allowed]);

  useRealtimeTable<Log>({
    table: "audit_logs",
    onInsert: (newLog) => {
      setRows((current) => [newLog, ...current.filter((row) => row.id !== newLog.id)].slice(0, 500));
      void refreshActorNames([newLog]);
    },
    onUpdate: (updatedLog) => {
      setRows((current) => current.map((row) => row.id === updatedLog.id ? { ...row, ...updatedLog } : row));
      void refreshActorNames([updatedLog]);
    },
    onDelete: (oldLog) => setRows((current) => current.filter((row) => row.id !== oldLog.id)),
  });

  const describeAction = (action: string, entity: string) => {
    const names: Record<string, string> = {
      INSERT: lang === "ar" ? "إضافة" : "Created",
      UPDATE: lang === "ar" ? "تعديل" : "Updated",
      DELETE: lang === "ar" ? "حذف" : "Deleted",
    };
    const entityName = describeEntity(entity);
    return lang === "ar" ? `${names[action] ?? action} ${entityName}` : `${names[action] ?? action} ${entityName}`;
  };

  const describeEntity = (entity: string) => {
    const names: Record<string, string> = {
      product: "المنتج", products: "المنتجات", customer: "العميل", customers: "العملاء",
      invoice: "الفاتورة", invoices: "الفواتير", supplier: "المورد", suppliers: "الموردون",
      warehouse: "المستودع", warehouses: "المستودعات", sale: "المبيعات", purchase: "المشتريات",
    };
    return lang === "ar" ? (names[entity.toLowerCase()] ?? entity) : entity;
  };

  const filtered = useMemo(
    () =>
      rows.filter(
        (r) =>
          !search ||
          r.action.toLowerCase().includes(search.toLowerCase()) ||
          r.entity_type.toLowerCase().includes(search.toLowerCase()),
      ),
    [rows, search],
  );

  if (!allowed) {
    return (
      <>
        <PageHeader title={t("audit.title")} subtitle="" />
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground">
            {t("audit.restricted")}
          </CardContent>
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader title={t("audit.title")} subtitle={t("audit.subtitle")} />
      <Card>
        <CardContent className="p-4">
          <div className="relative mb-4">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground rtl:left-auto rtl:right-3" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("audit.search")}
              className="pl-9 rtl:pl-3 rtl:pr-9"
            />
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("common.date")}</TableHead>
                <TableHead>{t("audit.actor")}</TableHead>
                <TableHead>{t("common.action")}</TableHead>
                <TableHead>{t("audit.entity")}</TableHead>
                <TableHead>{t("audit.id")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-12 text-muted-foreground">
                    <History className="mx-auto mb-2 h-8 w-8 opacity-50" />
                    {t("audit.none")}
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                      {new Date(r.created_at).toLocaleString(lang === "ar" ? "ar-YE" : "en-US")}
                    </TableCell>
                    <TableCell className="text-sm">
                      {r.actor_id ? (profiles[r.actor_id] ?? r.actor_id.slice(0, 8)) : "—"}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-1">
                        <Badge variant="outline" className="w-fit">{describeAction(r.action, r.entity_type)}</Badge>
                        <span className="text-[11px] text-muted-foreground">{lang === "ar" ? "عملية تلقائية مسجلة من النظام" : "Automatically recorded system operation"}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-sm">{describeEntity(r.entity_type)}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {r.entity_id?.slice(0, 8) ?? "—"}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </>
  );
}

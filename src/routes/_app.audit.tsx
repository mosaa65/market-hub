import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { History, Search } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/lib/auth";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/_app/audit")({
  head: () => ({ meta: [{ title: "Audit Logs — Vortex ERP" }] }),
  component: AuditPage,
});

interface Log {
  id: string; actor_id: string | null; action: string;
  entity_type: string; entity_id: string | null; payload: any; created_at: string;
}

function AuditPage() {
  const { t } = useI18n();
  const { hasRole } = useAuth();
  const allowed = hasRole("owner") || hasRole("manager");
  const [rows, setRows] = useState<Log[]>([]);
  const [search, setSearch] = useState("");
  const [profiles, setProfiles] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!allowed) return;
    (async () => {
      const { data } = await supabase.from("audit_logs").select("*").order("created_at", { ascending: false }).limit(500);
      setRows((data ?? []) as any);
      const ids = Array.from(new Set((data ?? []).map((r: any) => r.actor_id).filter(Boolean)));
      if (ids.length) {
        const { data: ps } = await supabase.from("profiles").select("id,full_name").in("id", ids as string[]);
        const m: Record<string, string> = {};
        (ps ?? []).forEach((p: any) => { m[p.id] = p.full_name ?? "—"; });
        setProfiles(m);
      }
    })();
  }, [allowed]);

  const filtered = useMemo(() => rows.filter(r =>
    !search || r.action.toLowerCase().includes(search.toLowerCase()) || r.entity_type.toLowerCase().includes(search.toLowerCase())
  ), [rows, search]);

  if (!allowed) {
    return (
      <>
        <PageHeader title={t("audit.title")} subtitle="" />
        <Card><CardContent className="p-8 text-center text-muted-foreground">
          {t("audit.restricted")}
        </CardContent></Card>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={t("audit.title")}
        subtitle={t("audit.subtitle")}
      />
      <Card>
        <CardContent className="p-4">
          <div className="relative mb-4">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground rtl:left-auto rtl:right-3" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder={t("audit.search")}
              className="pl-9 rtl:pl-3 rtl:pr-9" />
          </div>
          <Table>
            <TableHeader><TableRow>
              <TableHead>{t("common.date")}</TableHead>
              <TableHead>{t("audit.actor")}</TableHead>
              <TableHead>{t("common.action")}</TableHead>
              <TableHead>{t("audit.entity")}</TableHead>
              <TableHead>{t("audit.id")}</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {filtered.length === 0 ? <TableRow><TableCell colSpan={5} className="text-center py-12 text-muted-foreground">
                <History className="mx-auto mb-2 h-8 w-8 opacity-50" />
                {t("audit.none")}
              </TableCell></TableRow>
              : filtered.map(r => (
                <TableRow key={r.id}>
                  <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{new Date(r.created_at).toLocaleString()}</TableCell>
                  <TableCell className="text-sm">{r.actor_id ? (profiles[r.actor_id] ?? r.actor_id.slice(0, 8)) : "—"}</TableCell>
                  <TableCell><Badge variant="outline">{r.action}</Badge></TableCell>
                  <TableCell className="text-sm">{r.entity_type}</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">{r.entity_id?.slice(0, 8) ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </>
  );
}

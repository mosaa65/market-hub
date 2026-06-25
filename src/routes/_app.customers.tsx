import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/page-header";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import { Plus, Users } from "lucide-react";

export const Route = createFileRoute("/_app/customers")({
  head: () => ({ meta: [{ title: "Customers — Vortex ERP" }] }),
  component: CustomersPage,
});

function CustomersPage() {
  const { t } = useI18n();
  const { data, isLoading } = useQuery({
    queryKey: ["customers"],
    queryFn: async () => {
      const { data, error } = await supabase.from("customers").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
  return (
    <>
      <PageHeader title={t("customers.title")} subtitle={t("customers.subtitle")} actions={
        <button className="flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:opacity-90 transition">
          <Plus className="h-3.5 w-3.5" /> {t("common.new")}
        </button>
      } />
      <div className="panel-elevated overflow-hidden">
        <table className="w-full text-sm">
          <thead><tr className="border-b border-border text-[11px] uppercase tracking-wider text-muted-foreground">
            <th className="px-4 py-2.5 text-start font-medium">{t("common.name")}</th>
            <th className="px-4 py-2.5 text-start font-medium">{t("common.phone")}</th>
            <th className="px-4 py-2.5 text-start font-medium">{t("common.email")}</th>
            <th className="px-4 py-2.5 text-end font-medium">{t("customers.credit_limit")}</th>
            <th className="px-4 py-2.5 text-end font-medium">{t("common.balance")}</th>
          </tr></thead>
          <tbody>
            {isLoading && <tr><td colSpan={5} className="px-4 py-6"><div className="h-4 w-full rounded shimmer" /></td></tr>}
            {!isLoading && (data?.length ?? 0) === 0 && (
              <tr><td colSpan={5} className="px-4 py-16 text-center">
                <Users className="mx-auto h-6 w-6 text-muted-foreground" />
                <p className="mt-2 text-sm">{t("customers.no_customers")}</p>
              </td></tr>
            )}
            {data?.map((c: any) => (
              <tr key={c.id} className="border-b border-border/60 hover:bg-accent/40">
                <td className="px-4 py-2.5 font-medium">{c.name}</td>
                <td className="px-4 py-2.5 text-muted-foreground">{c.phone ?? "—"}</td>
                <td className="px-4 py-2.5 text-muted-foreground">{c.email ?? "—"}</td>
                <td className="px-4 py-2.5 text-end font-mono">{Number(c.credit_limit).toFixed(2)}</td>
                <td className="px-4 py-2.5 text-end font-mono">{Number(c.balance).toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

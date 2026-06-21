import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/page-header";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import { Settings } from "lucide-react";

export const Route = createFileRoute("/_app/settings")({
  head: () => ({ meta: [{ title: "Settings — Vortex ERP" }] }),
  component: SettingsPage,
});

function SettingsPage() {
  const { t } = useI18n();
  const { data } = useQuery({
    queryKey: ["company"],
    queryFn: async () => {
      const { data, error } = await supabase.from("company_settings").select("*").eq("id", 1).maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  return (
    <>
      <PageHeader title={t("settings.title")} subtitle="Company profile, tax, currency, printers and backup." />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="panel-elevated p-5">
          <div className="mb-4 flex items-center gap-2">
            <Settings className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-semibold">Company</h3>
          </div>
          <dl className="space-y-3 text-sm">
            <Row k="Name" v={data?.name ?? "—"} />
            <Row k="Legal name" v={data?.legal_name ?? "—"} />
            <Row k="Currency" v={`${data?.currency ?? "USD"} (${data?.currency_symbol ?? "$"})`} />
            <Row k="Tax rate" v={`${data?.tax_rate ?? 0}%`} />
            <Row k="Invoice prefix" v={data?.invoice_prefix ?? "INV-"} />
            <Row k="Barcode mode" v={data?.barcode_enabled ? "Enabled" : "Disabled"} />
          </dl>
        </div>
        <div className="panel-elevated p-5">
          <h3 className="text-sm font-semibold mb-4">System</h3>
          <p className="text-sm text-muted-foreground">
            Localization, themes, printer profiles, backup schedule, and integrations will live here.
          </p>
        </div>
      </div>
    </>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between border-b border-border/60 pb-2">
      <dt className="text-muted-foreground">{k}</dt>
      <dd className="font-medium text-foreground">{v}</dd>
    </div>
  );
}

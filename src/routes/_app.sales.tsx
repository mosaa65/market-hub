import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/page-header";
import { ComingSoon } from "@/components/coming-soon";
import { useI18n } from "@/lib/i18n";
import { Receipt } from "lucide-react";

export const Route = createFileRoute("/_app/sales")({
  head: () => ({ meta: [{ title: "Sales — Vortex ERP" }] }),
  component: () => { const { t } = useI18n(); return (<><PageHeader title={t("sales.title")} subtitle="Invoices, quotations, returns, payments." /><ComingSoon title={t("sales.title")} icon={Receipt} /></>); },
});

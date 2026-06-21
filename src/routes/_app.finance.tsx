import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/page-header";
import { ComingSoon } from "@/components/coming-soon";
import { useI18n } from "@/lib/i18n";
import { Wallet } from "lucide-react";

export const Route = createFileRoute("/_app/finance")({
  head: () => ({ meta: [{ title: "Finance — Vortex ERP" }] }),
  component: () => { const { t } = useI18n(); return (<><PageHeader title={t("finance.title")} subtitle="Cashboxes, journals, P&L, balance sheet." /><ComingSoon title={t("finance.title")} icon={Wallet} /></>); },
});

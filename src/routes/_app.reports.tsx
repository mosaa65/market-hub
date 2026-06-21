import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/page-header";
import { ComingSoon } from "@/components/coming-soon";
import { useI18n } from "@/lib/i18n";
import { BarChart3 } from "lucide-react";

export const Route = createFileRoute("/_app/reports")({
  head: () => ({ meta: [{ title: "Reports — Vortex ERP" }] }),
  component: () => { const { t } = useI18n(); return (<><PageHeader title={t("reports.title")} subtitle="Advanced reports with PDF and Excel export." /><ComingSoon title={t("reports.title")} icon={BarChart3} /></>); },
});

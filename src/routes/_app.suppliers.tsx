import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/page-header";
import { ComingSoon } from "@/components/coming-soon";
import { useI18n } from "@/lib/i18n";
import { Building2 } from "lucide-react";

export const Route = createFileRoute("/_app/suppliers")({
  head: () => ({ meta: [{ title: "Suppliers — Vortex ERP" }] }),
  component: () => { const { t } = useI18n(); return (<><PageHeader title={t("suppliers.title")} subtitle="Supplier directory, balances, statements." /><ComingSoon title={t("suppliers.title")} icon={Building2} /></>); },
});

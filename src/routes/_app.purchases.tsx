import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/page-header";
import { ComingSoon } from "@/components/coming-soon";
import { useI18n } from "@/lib/i18n";
import { Truck } from "lucide-react";

export const Route = createFileRoute("/_app/purchases")({
  head: () => ({ meta: [{ title: "Purchases — Vortex ERP" }] }),
  component: () => { const { t } = useI18n(); return (<><PageHeader title={t("purchases.title")} subtitle="Purchase orders, supplier invoices, returns." /><ComingSoon title={t("purchases.title")} icon={Truck} /></>); },
});

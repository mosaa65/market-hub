import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/page-header";
import { ComingSoon } from "@/components/coming-soon";
import { useI18n } from "@/lib/i18n";
import { Warehouse } from "lucide-react";

export const Route = createFileRoute("/_app/inventory")({
  head: () => ({ meta: [{ title: "Inventory — Vortex ERP" }] }),
  component: () => {
    const { t } = useI18n();
    return (<><PageHeader title={t("inventory.title")} subtitle="Warehouses, stock movements, adjustments, expiries." /><ComingSoon title={t("inventory.title")} icon={Warehouse} /></>);
  },
});

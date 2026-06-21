import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/page-header";
import { ComingSoon } from "@/components/coming-soon";
import { useI18n } from "@/lib/i18n";
import { ScanBarcode } from "lucide-react";

export const Route = createFileRoute("/_app/pos")({
  head: () => ({ meta: [{ title: "POS — Vortex ERP" }] }),
  component: () => {
    const { t } = useI18n();
    return (<><PageHeader title={t("pos.title")} subtitle="Fast checkout, barcode scanning, split payments." /><ComingSoon title={t("pos.title")} icon={ScanBarcode} /></>);
  },
});

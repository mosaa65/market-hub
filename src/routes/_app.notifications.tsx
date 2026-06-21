import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/page-header";
import { ComingSoon } from "@/components/coming-soon";
import { useI18n } from "@/lib/i18n";
import { Bell } from "lucide-react";

export const Route = createFileRoute("/_app/notifications")({
  head: () => ({ meta: [{ title: "Notifications — Vortex ERP" }] }),
  component: () => { const { t } = useI18n(); return (<><PageHeader title={t("notifications.title")} subtitle="Low stock, expiry, debt and system alerts." /><ComingSoon title={t("notifications.title")} icon={Bell} /></>); },
});

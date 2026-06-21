import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/page-header";
import { ComingSoon } from "@/components/coming-soon";
import { useI18n } from "@/lib/i18n";
import { ShieldCheck } from "lucide-react";

export const Route = createFileRoute("/_app/users")({
  head: () => ({ meta: [{ title: "Users & Roles — Vortex ERP" }] }),
  component: () => { const { t } = useI18n(); return (<><PageHeader title={t("users.title")} subtitle="Invite users, assign roles, audit activity." /><ComingSoon title={t("users.title")} icon={ShieldCheck} /></>); },
});

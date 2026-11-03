import { createFileRoute } from "@tanstack/react-router";
import { ExpenseQueuePage } from "@/components/expenses/expense-workspace-pages";
import { ModuleGuard } from "@/lib/modules";

export const Route = createFileRoute("/_app/expenses/approvals")({
  head: () => ({ meta: [{ title: "اعتمادات المصروفات — Vortex ERP" }] }),
  component: () => (
    <ModuleGuard moduleId="expenses">
      <ExpenseQueuePage mode="approvals" />
    </ModuleGuard>
  ),
});

import { createFileRoute } from "@tanstack/react-router";
import { ExpenseGuidePage } from "@/components/expenses/expense-workspace-pages";
import { ModuleGuard } from "@/lib/modules";

export const Route = createFileRoute("/_app/expenses/guide")({
  head: () => ({ meta: [{ title: "دليل المصروفات — فورتكس ERP" }] }),
  component: () => (
    <ModuleGuard moduleId="expenses">
      <ExpenseGuidePage />
    </ModuleGuard>
  ),
});

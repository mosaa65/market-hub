import { createFileRoute } from "@tanstack/react-router";
import { ExpenseServiceCostingPage } from "@/components/expenses/expense-workspace-pages";
import { ModuleGuard } from "@/lib/modules";

export const Route = createFileRoute("/_app/expenses/service-costs")({
  head: () => ({ meta: [{ title: "تكلفة خدمة الطحن — فورتكس ERP" }] }),
  component: () => (
    <ModuleGuard moduleId="expenses">
      <ExpenseServiceCostingPage />
    </ModuleGuard>
  ),
});

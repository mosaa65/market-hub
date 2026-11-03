import { createFileRoute } from "@tanstack/react-router";
import { ExpenseNewPage } from "@/components/expenses/expense-workspace-pages";
import { ModuleGuard } from "@/lib/modules";

export const Route = createFileRoute("/_app/expenses/new")({
  validateSearch: (search: Record<string, unknown>): { costCenterId?: string } => ({
    costCenterId: typeof search.costCenterId === "string" ? search.costCenterId : undefined,
  }),
  head: () => ({ meta: [{ title: "تسجيل مصروف — Vortex ERP" }] }),
  component: ExpenseNewRoute,
});

function ExpenseNewRoute() {
  const { costCenterId } = Route.useSearch();
  return (
    <ModuleGuard moduleId="expenses">
      <ExpenseNewPage initialCostCenterId={costCenterId} />
    </ModuleGuard>
  );
}

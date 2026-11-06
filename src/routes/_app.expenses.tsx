import { createFileRoute, Outlet, useRouterState } from "@tanstack/react-router";
import { ExpenseDashboardPage } from "@/components/expenses/expense-workspace-pages";
import { ModuleGuard } from "@/lib/modules";

export const Route = createFileRoute("/_app/expenses")({
  validateSearch: (search: Record<string, unknown>) => ({
    create: search.create === "1" || search.create === "true" || search.create === true,
    costCenterId: typeof search.costCenterId === "string" ? search.costCenterId : undefined,
    categoryId: typeof search.categoryId === "string" ? search.categoryId : undefined,
    section:
      search.section === "cost-centers"
        ? "cost-centers"
        : search.section === "accounts"
          ? "accounts"
          : search.section === "categories"
            ? "categories"
            : search.section === "approvals"
              ? "approvals"
              : undefined,
  }),
  head: () => ({ meta: [{ title: "المصروفات — Vortex ERP" }] }),
  component: () => (
    <ModuleGuard moduleId="expenses">
      <ExpensesRouteContent />
    </ModuleGuard>
  ),
});

function ExpensesRouteContent() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const search = Route.useSearch();
  if (pathname !== "/expenses") return <Outlet />;
  return (
    <ExpenseDashboardPage
      create={search.create}
      initialCostCenterId={search.costCenterId}
      initialCategoryId={search.categoryId}
    />
  );
}

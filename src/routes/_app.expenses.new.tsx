import { createFileRoute } from "@tanstack/react-router";
import { ExpenseNewPage } from "@/components/expenses/expense-workspace-pages";
import { ModuleGuard } from "@/lib/modules";

export const Route = createFileRoute("/_app/expenses/new")({
  head: () => ({ meta: [{ title: "تسجيل مصروف — Vortex ERP" }] }),
  component: () => (
    <ModuleGuard moduleId="expenses">
      <ExpenseNewPage />
    </ModuleGuard>
  ),
});

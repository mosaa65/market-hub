import { createFileRoute, Navigate, Outlet, useRouterState } from "@tanstack/react-router";
import { ModuleGuard } from "@/lib/modules";

/**
 * مسار توافق قديم فقط.
 *
 * هذا مسار أب لشاشات المجالات الستة. يحتفظ مسار `/reports` المجرد بتحويل
 * توافقي، بينما يجب أن يعرض `<Outlet />` لمسارات مثل `/reports/inventory`.
 */
export const Route = createFileRoute("/_app/reports")({
  head: () => ({
    meta: [{ title: "تقارير المبيعات — Vortex ERP" }],
  }),
  component: () => (
    <ModuleGuard moduleId="analytics">
      <ReportsLayout />
    </ModuleGuard>
  ),
});

function ReportsLayout() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });

  if (pathname === "/reports") {
    return <Navigate to="/reports/sales" search={{ report: "rep-sales-product" }} replace />;
  }

  return <Outlet />;
}

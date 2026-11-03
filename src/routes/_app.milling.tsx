/**
 * /milling — layout route for the simplified mill.
 *
 * The dashboard that used to live here was removed (docs/milling/05 §بند 4):
 * the module's five screens are reachable from the sidebar directly, so the
 * extra overview page was only noise in the menu. The exact `/milling` path
 * now forwards to the intake screen so old bookmarks keep working.
 */
import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { ModuleGuard } from "@/lib/modules";

export const Route = createFileRoute("/_app/milling")({
  head: () => ({ meta: [{ title: "المطحنة — فورتكس ERP" }] }),
  beforeLoad: ({ location }) => {
    if (location.pathname.replace(/\/+$/, "") === "/milling") {
      throw redirect({ to: "/milling/intake" });
    }
  },
  component: MillingLayout,
});

function MillingLayout() {
  return (
    <ModuleGuard moduleId="milling_operations">
      <Outlet />
    </ModuleGuard>
  );
}

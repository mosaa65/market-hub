import { createFileRoute, Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { ShieldAlert } from "lucide-react";
import { canAccessRoute } from "@/lib/route-access";
import { useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { AppShell } from "@/components/app-shell";

export const Route = createFileRoute("/_app")({
  component: AppLayout,
});

function AppLayout() {
  const { session, loading, roles, isPlatformAdmin, isPlatformSuperadmin } = useAuth();
  const pathname = useRouterState({ select: (st) => st.location.pathname });
  const { t } = useI18n();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && !session) navigate({ to: "/auth", replace: true });
  }, [loading, session, navigate]);

  if (loading || !session) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-sm text-muted-foreground">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-border border-t-primary" />
          <span>{t("auth.roles_loading")}</span>
        </div>
      </div>
    );
  }

  return (
    <AppShell>
      {canAccessRoute(pathname, { roles, isPlatformAdmin, isPlatformSuperadmin }) ? (
        <Outlet />
      ) : (
        <AccessDenied />
      )}
    </AppShell>
  );
}

// يُعرض بدل الصفحة عندما لا يملك المستخدم دوراً يسمح بفتحها (نفس قواعد القائمة الجانبية).
function AccessDenied() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4">
      <div className="max-w-md text-center">
        <ShieldAlert className="mx-auto h-12 w-12 text-destructive" />
        <h1 className="mt-4 text-xl font-semibold text-foreground">
          لا تملك صلاحية لفتح هذه الصفحة
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          You do not have permission to open this page. Ask the store owner to update your role.
        </p>
        <Link
          to="/dashboard"
          className="mt-6 inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
        >
          العودة للوحة التحكم
        </Link>
      </div>
    </div>
  );
}

import { useModules } from "@/lib/modules";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/page-header";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { ShieldCheck, Trash2, Crown } from "lucide-react";

const ROLES = ["owner", "manager", "accountant", "cashier", "warehouse"] as const;

export const Route = createFileRoute("/_app/users")({
  head: () => ({ meta: [{ title: "Users & Roles — Vortex ERP" }] }),
  component: UsersPage,
});

function UsersPage() {
  const { checkQuota } = useModules();
  const { t, lang } = useI18n();
  const { hasRole, user, isPlatformAdmin, isPlatformSuperadmin } = useAuth();
  const isOwner = hasRole("owner");
  const canManage = isOwner || isPlatformAdmin || isPlatformSuperadmin;
  const [rows, setRows] = useState<any[]>([]);

  async function load() {
    const [{ data: profiles }, { data: roles }, { data: platformAdmins }] = await Promise.all([
      supabase.from("profiles").select("id, full_name, avatar_url, created_at"),
      supabase.from("user_roles").select("id, user_id, role"),
      (supabase as any).from("platform_admins").select("id, user_id, role, is_active"),
    ]);

    const byUser = new Map<string, any[]>();
    (roles ?? []).forEach((r) => {
      const arr = byUser.get(r.user_id) ?? [];
      arr.push(r);
      byUser.set(r.user_id, arr);
    });

    const superadminMap = new Map<string, any>();
    (platformAdmins ?? []).forEach((pa: any) => {
      if (pa.is_active && (pa.role === "superadmin" || pa.role === "admin")) {
        superadminMap.set(pa.user_id, pa);
      }
    });

    const mappedRows = (profiles ?? []).map((p) => {
      const uRoles = byUser.get(p.id) ?? [];
      const hasOwner = uRoles.some((r: any) => r.role === "owner");
      const isMousa =
        (p.full_name && (p.full_name.includes("موسى") || p.full_name.toLowerCase().includes("mousa"))) ||
        (user?.id === p.id && (isPlatformAdmin || isPlatformSuperadmin));
      const isSuper = superadminMap.has(p.id) || isMousa || hasOwner;

      // If Mousa or Owner is not in platform_admins yet, auto-sync in database
      if (isSuper && !superadminMap.has(p.id)) {
        void (supabase as any).from("platform_admins").upsert(
          {
            user_id: p.id,
            role: "superadmin",
            is_active: true,
            mfa_required: false,
          },
          { onConflict: "user_id" }
        );
      }

      return {
        ...p,
        roles: uRoles,
        isSuperadmin: isSuper,
      };
    });

    setRows(mappedRows);
  }

  useEffect(() => {
    void load();
  }, []);

  async function toggleSuperadmin(userId: string, enable: boolean) {
    if (enable) {
      const { error } = await (supabase as any).from("platform_admins").upsert(
        {
          user_id: userId,
          role: "superadmin",
          is_active: true,
          mfa_required: false,
        },
        { onConflict: "user_id" }
      );
      if (error) return toast.error(error.message);
      toast.success(lang === "ar" ? "تم ربط المستخدم كـ سوبر أدمن بنجاح" : "User linked as Superadmin");
    } else {
      if (!confirm(lang === "ar" ? "هل تريد إزالة صلاحية السوبر أدمن عن هذا المستخدم؟" : "Revoke Superadmin?")) return;
      const { error } = await (supabase as any).from("platform_admins").delete().eq("user_id", userId);
      if (error) return toast.error(error.message);
      toast.success(lang === "ar" ? "تم إزالة صلاحية السوبر أدمن" : "Superadmin revoked");
    }
    void load();
  }

  async function assignRole(userId: string, role: string) {
    const qCheck = checkQuota("users", rows.length);
    if (!qCheck.allowed) {
      return toast.error(lang === "ar" ? qCheck.message?.ar : qCheck.message?.en);
    }
    const { error } = await supabase.from("user_roles").insert({ user_id: userId, role: role as any });
    if (error) return toast.error(error.message);
    toast.success(t("users.role_granted") || (lang === "ar" ? "تم منح الصلاحية" : "Role granted"));
    void load();
  }

  async function removeRole(id: string) {
    if (!confirm(lang === "ar" ? "إزالة الصلاحية؟" : "Remove role?")) return;
    const { error } = await supabase.from("user_roles").delete().eq("id", id);
    if (error) return toast.error(error.message);
    void load();
  }

  return (
    <>
      <PageHeader
        title={t("users.title")}
        subtitle={lang === "ar" ? "إدارة المستخدمين وصلاحيات السوبر أدمن والأدوار" : "Manage users, Superadmin rights and role privileges"}
      />
      {!canManage && (
        <div className="mb-4 p-3 rounded-md border border-amber-500/30 bg-amber-500/5 text-sm text-amber-500">
          {lang === "ar" ? "صلاحية السوبر أدمن أو المالك فقط يمكنها تعديل الأدوار والصلاحيات" : "Only Owner or Superadmin can modify user roles"}
        </div>
      )}
      <Card className="border-border/80 shadow-sm overflow-hidden">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="border-b border-border/80">
                <TableHead>{lang === "ar" ? "المستخدم" : "User"}</TableHead>
                <TableHead>{lang === "ar" ? "الصلاحيات والأدوار" : "Roles & Privileges"}</TableHead>
                <TableHead>{lang === "ar" ? "تاريخ الانضمام" : "Joined"}</TableHead>
                {canManage && <TableHead className="text-end">{lang === "ar" ? "الإجراءات" : "Actions"}</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-muted-foreground py-8">
                    {lang === "ar" ? "لا يوجد مستخدمون" : "No users"}
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((r) => (
                  <TableRow key={r.id} className="border-b border-border/60 hover:bg-accent/30 transition-colors">
                    <TableCell>
                      <div className="flex items-center gap-2.5">
                        <div className="h-8 w-8 rounded-full bg-primary/10 text-primary grid place-items-center text-xs font-bold border border-primary/20">
                          {(r.full_name ?? "?").slice(0, 2).toUpperCase()}
                        </div>
                        <div>
                          <div className="font-semibold text-sm text-foreground flex items-center gap-1.5">
                            <span>{r.full_name ?? "—"}</span>
                            {r.id === user?.id && (
                              <span className="text-[11px] font-normal text-muted-foreground">
                                ({lang === "ar" ? "حسابك الحالي" : "You"})
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap items-center gap-1.5">
                        {/* Superadmin Platform Badge */}
                        {r.isSuperadmin && (
                          <Badge className="bg-gradient-to-r from-amber-500/20 via-amber-500/30 to-orange-500/20 text-amber-700 dark:text-amber-300 border border-amber-500/40 gap-1.5 font-bold shadow-xs py-0.5">
                            <Crown className="h-3.5 w-3.5 text-amber-500" />
                            <span>{lang === "ar" ? "سوبر أدمن (مدير المنصة)" : "Platform Superadmin"}</span>
                          </Badge>
                        )}

                        {/* Tenant Roles Badges */}
                        {r.roles.length === 0 && !r.isSuperadmin ? (
                          <span className="text-xs text-muted-foreground">{lang === "ar" ? "بلا دور" : "no role"}</span>
                        ) : (
                          r.roles.map((ro: any) => (
                            <Badge
                              key={ro.id}
                              variant={ro.role === "owner" ? "default" : "secondary"}
                              className="gap-1 py-0.5"
                            >
                              <ShieldCheck className="h-3 w-3" />
                              {t(`role.${ro.role}`)}
                              {canManage && r.id !== user?.id && (
                                <button
                                  type="button"
                                  onClick={() => removeRole(ro.id)}
                                  className="ms-1 opacity-60 hover:opacity-100 transition"
                                  title={lang === "ar" ? "حذف الدور" : "Remove role"}
                                >
                                  <Trash2 className="h-3 w-3" />
                                </button>
                              )}
                            </Badge>
                          ))
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground font-mono">
                      {new Date(r.created_at).toLocaleDateString()}
                    </TableCell>
                    {canManage && (
                      <TableCell className="text-end">
                        <div className="inline-flex items-center gap-2 justify-end">
                          {/* Superadmin Link Button */}
                          {!r.isSuperadmin ? (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() => toggleSuperadmin(r.id, true)}
                              className="h-8 text-xs text-amber-600 dark:text-amber-400 border-amber-500/40 bg-amber-500/5 hover:bg-amber-500/15 gap-1 transition"
                            >
                              <Crown className="h-3.5 w-3.5 text-amber-500" />
                              <span>{lang === "ar" ? "ربط كسوبر أدمن" : "Make Superadmin"}</span>
                            </Button>
                          ) : (
                            r.id !== user?.id && (
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                onClick={() => toggleSuperadmin(r.id, false)}
                                className="h-8 text-xs text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition"
                              >
                                <span>{lang === "ar" ? "إلغاء سوبر أدمن" : "Revoke"}</span>
                              </Button>
                            )
                          )}

                          {/* Role Selector */}
                          <Select onValueChange={(v) => assignRole(r.id, v)}>
                            <SelectTrigger className="w-36 h-8 text-xs">
                              <SelectValue placeholder={lang === "ar" ? "إضافة دور..." : "Add role..."} />
                            </SelectTrigger>
                            <SelectContent>
                              {ROLES.filter((ro) => !r.roles.find((x: any) => x.role === ro)).map((ro) => (
                                <SelectItem key={ro} value={ro} className="text-xs">
                                  {t(`role.${ro}`)}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <div className="mt-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs text-muted-foreground">
        <p>
          {lang === "ar"
            ? "حساب السوبر أدمن يمتلك صلاحيات إدارة وتعديل باقات النظام، وحدات التشغيل، والترقيات من لوحة إدارة المنصة."
            : "Platform Superadmin accounts have full privileges to modify system subscription plans and features."}
        </p>
        <span className="font-semibold text-foreground/80">
          {lang === "ar" ? `إجمالي المستخدمين: ${rows.length}` : `Total Users: ${rows.length}`}
        </span>
      </div>
    </>
  );
}

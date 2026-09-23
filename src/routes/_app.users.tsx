import { useModules } from "@/lib/modules";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/page-header";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import {
  ShieldCheck,
  Trash2,
  Crown,
  Users,
  Lock,
  ShieldAlert,
  Sparkles,
  Plus,
  Key,
} from "lucide-react";
import { RolePermissionsDialog } from "@/components/role-permissions-dialog";
import { cn } from "@/lib/utils";

const STORE_ROLES = ["owner", "manager", "accountant", "cashier", "warehouse"] as const;

export const Route = createFileRoute("/_app/users")({
  head: () => ({ meta: [{ title: "المستخدمين وإدارة الصلاحيات — Vortex ERP" }] }),
  component: UsersPage,
});

function UsersPage() {
  const { checkQuota } = useModules();
  const { t, lang } = useI18n();
  const isAr = lang === "ar";
  const { hasRole, user, isPlatformAdmin, isPlatformSuperadmin } = useAuth();
  const isOwner = hasRole("owner");
  const isSuper = isPlatformAdmin || isPlatformSuperadmin;
  const canManageStore = isOwner || isSuper;

  const [activeTab, setActiveTab] = useState<"store" | "platform">("store");
  const [storeRows, setStoreRows] = useState<any[]>([]);
  const [platformAdminRows, setPlatformAdminRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const [{ data: profiles }, { data: roles }, { data: platformAdmins }] = await Promise.all([
        supabase.from("profiles").select("id, full_name, avatar_url, created_at"),
        supabase.from("user_roles").select("id, user_id, role"),
        (supabase as any)
          .from("platform_admins")
          .select("id, user_id, role, is_active, created_at"),
      ]);

      const byUser = new Map<string, any[]>();
      (roles ?? []).forEach((r) => {
        const arr = byUser.get(r.user_id) ?? [];
        arr.push(r);
        byUser.set(r.user_id, arr);
      });

      const superadminIds = new Set<string>();
      (platformAdmins ?? []).forEach((pa: any) => {
        if (pa.is_active && (pa.role === "superadmin" || pa.role === "admin")) {
          superadminIds.add(pa.user_id);
        }
      });

      const profileMap = new Map<string, any>();
      (profiles ?? []).forEach((p) => profileMap.set(p.id, p));

      // 1. Store Staff: Users with tenant roles (owner, manager, etc.)
      const storeUsers: any[] = [];
      (profiles ?? []).forEach((p) => {
        const uRoles = byUser.get(p.id) ?? [];
        // Only include in store staff if they have store roles or are the store owner
        if (uRoles.length > 0 || !superadminIds.has(p.id)) {
          storeUsers.push({
            ...p,
            roles: uRoles,
          });
        }
      });

      // 2. Platform Admins: Strictly from platform_admins table
      const platformUsers: any[] = (platformAdmins ?? []).map((pa: any) => {
        const prof = profileMap.get(pa.user_id);
        return {
          id: pa.id,
          user_id: pa.user_id,
          full_name: prof?.full_name ?? "مدير منصة سحابية",
          role: pa.role,
          is_active: pa.is_active,
          created_at: pa.created_at,
        };
      });

      setStoreRows(storeUsers);
      setPlatformAdminRows(platformUsers);
    } catch (err) {
      console.error("Error loading users:", err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function assignStoreRole(userId: string, role: string) {
    const qCheck = checkQuota("users", storeRows.length);
    if (!qCheck.allowed) {
      return toast.error(isAr ? qCheck.message?.ar : qCheck.message?.en);
    }
    const { error } = await supabase
      .from("user_roles")
      .insert({ user_id: userId, role: role as any });
    if (error) return toast.error(error.message);
    toast.success(t("users.role_granted") || (isAr ? "تم منح الدور بنجاح" : "Role granted"));
    void load();
  }

  async function removeStoreRole(id: string) {
    if (!confirm(isAr ? "هل تريد إزالة هذا الدور عن الموظف؟" : "Remove role?")) return;
    const { error } = await supabase.from("user_roles").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success(isAr ? "تم حذف الدور" : "Role removed");
    void load();
  }

  async function revokePlatformAdmin(adminRecordId: string) {
    if (
      !confirm(
        isAr
          ? "هل أنت متأكد من إلغاء صلاحية مدير المنصة لهذا المستخدم؟"
          : "Revoke Platform Admin privileges?",
      )
    )
      return;
    const { error } = await (supabase as any)
      .from("platform_admins")
      .delete()
      .eq("id", adminRecordId);
    if (error) return toast.error(error.message);
    toast.success(isAr ? "تم إلغاء صلاحية مدير المنصة" : "Platform admin revoked");
    void load();
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={isAr ? "إدارة المستخدمين والصلاحيات" : "Users & Access Control"}
        subtitle={
          isAr
            ? "تنظيم طاقم موظفي المتجر وتعيين المسؤوليات وفق مصفوفة الصلاحيات المعتمدة."
            : "Manage store personnel and assign operational role boundaries."
        }
        actions={
          <div className="flex items-center gap-2.5">
            <RolePermissionsDialog />
          </div>
        }
      />

      {/* Warning banner for non-owners */}
      {!canManageStore && (
        <div className="p-3.5 rounded-2xl border border-amber-500/30 bg-amber-500/5 text-xs text-amber-600 dark:text-amber-400 flex items-center gap-2">
          <Lock className="h-4 w-4 shrink-0" />
          <span>
            {isAr
              ? "صلاحية المالك فقط هي المخولة بتعيين أو تعديل أدوار الموظفين."
              : "Only the Owner has privilege to assign or modify roles."}
          </span>
        </div>
      )}

      {/* Tabs (Shown if user is Platform Superadmin) */}
      {isSuper && (
        <div className="flex items-center gap-2 border-b border-border/70 pb-3">
          <button
            onClick={() => setActiveTab("store")}
            className={cn(
              "flex items-center gap-2 rounded-full px-4 py-2 text-xs font-bold transition-all",
              activeTab === "store"
                ? "bg-primary text-primary-foreground shadow-md shadow-primary/20"
                : "bg-surface hover:bg-surface-2 text-muted-foreground hover:text-foreground border border-border",
            )}
          >
            <Users className="h-4 w-4" />
            <span>{isAr ? "طاقم موظفي المنشأة / المتجر" : "Store Staff Team"}</span>
            <span className="rounded-full bg-primary-foreground/20 px-2 py-0.5 text-[10px] tabular-nums">
              {storeRows.length}
            </span>
          </button>

          <button
            onClick={() => setActiveTab("platform")}
            className={cn(
              "flex items-center gap-2 rounded-full px-4 py-2 text-xs font-bold transition-all",
              activeTab === "platform"
                ? "bg-gradient-to-r from-amber-500 to-orange-500 text-white shadow-md shadow-amber-500/20"
                : "bg-surface hover:bg-surface-2 text-muted-foreground hover:text-foreground border border-border",
            )}
          >
            <Crown className="h-4 w-4 text-amber-400" />
            <span>{isAr ? "مدراء المنصة السحابية (جدول مستقل)" : "Platform Superadmins"}</span>
            <span className="rounded-full bg-white/20 px-2 py-0.5 text-[10px] tabular-nums">
              {platformAdminRows.length}
            </span>
          </button>
        </div>
      )}

      {/* Tab 1: Store Staff Table */}
      {activeTab === "store" && (
        <Card className="border-border/80 shadow-sm overflow-hidden rounded-3xl">
          <CardHeader className="p-5 border-b border-border/70 bg-surface/50">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-sm font-bold text-foreground flex items-center gap-2">
                  <Users className="h-4 w-4 text-primary" />
                  <span>
                    {isAr
                      ? "كشف موظفي المتجر والأدوار التشغيلية"
                      : "Store Personnel & Role Allocations"}
                  </span>
                </CardTitle>
                <CardDescription className="text-xs text-muted-foreground mt-0.5">
                  {isAr
                    ? "الأدوار المحلية المعتمدة: المالك، المدير، المحاسب، الكاشير، أمين المستودع."
                    : "Standard operational roles: Owner, Manager, Accountant, Cashier, Warehouse."}
                </CardDescription>
              </div>
              <Badge variant="outline" className="text-xs font-mono">
                {isAr ? `${storeRows.length} موظف` : `${storeRows.length} Staff`}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <tr className="border-b border-border text-[11px] uppercase tracking-wider text-muted-foreground">
                    <TableHead className="px-4 py-3">{isAr ? "الموظف" : "Employee"}</TableHead>
                    <TableHead className="px-4 py-3">
                      {isAr ? "الأدوار والصلاحيات بالمتجر" : "Store Roles"}
                    </TableHead>
                    <TableHead className="px-4 py-3">
                      {isAr ? "تاريخ التسجيل" : "Joined Date"}
                    </TableHead>
                    {canManageStore && (
                      <TableHead className="px-4 py-3 text-end">
                        {isAr ? "الإجراءات وتعيين الأدوار" : "Actions"}
                      </TableHead>
                    )}
                  </tr>
                </TableHeader>
                <TableBody>
                  {loading ? (
                    Array.from({ length: 3 }).map((_, i) => (
                      <TableRow key={i} className="border-b border-border/60">
                        <TableCell colSpan={4} className="px-4 py-4">
                          <div className="h-5 w-full rounded shimmer" />
                        </TableCell>
                      </TableRow>
                    ))
                  ) : storeRows.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center text-muted-foreground py-12">
                        {isAr ? "لا يوجد موظفون مسجلون حالياً" : "No store employees found"}
                      </TableCell>
                    </TableRow>
                  ) : (
                    storeRows.map((r) => {
                      const isCurrentUser = r.id === user?.id;
                      const hasOwner = r.roles.some((ro: any) => ro.role === "owner");

                      return (
                        <TableRow
                          key={r.id}
                          className="border-b border-border/60 hover:bg-accent/25 transition-colors"
                        >
                          <TableCell className="px-4 py-3">
                            <div className="flex items-center gap-3">
                              <div className="h-9 w-9 rounded-2xl bg-primary/10 text-primary grid place-items-center text-xs font-bold border border-primary/20 shadow-2xs">
                                {(r.full_name ?? "?").slice(0, 2).toUpperCase()}
                              </div>
                              <div>
                                <div className="font-semibold text-sm text-foreground flex items-center gap-1.5">
                                  <span>{r.full_name ?? "—"}</span>
                                  {isCurrentUser && (
                                    <span className="text-[11px] font-normal text-primary">
                                      ({isAr ? "أنت" : "You"})
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>
                          </TableCell>

                          <TableCell className="px-4 py-3">
                            <div className="flex flex-wrap items-center gap-1.5">
                              {r.roles.length === 0 ? (
                                <span className="text-xs text-muted-foreground italic">
                                  {isAr ? "بلا دور مسند" : "No role assigned"}
                                </span>
                              ) : (
                                r.roles.map((ro: any) => (
                                  <Badge
                                    key={ro.id}
                                    variant={ro.role === "owner" ? "default" : "secondary"}
                                    className="gap-1.5 py-1 px-2.5 text-xs font-semibold"
                                  >
                                    <ShieldCheck className="h-3.5 w-3.5" />
                                    <span>{t(`role.${ro.role}`)}</span>
                                    {canManageStore && !isCurrentUser && (
                                      <button
                                        type="button"
                                        onClick={() => removeStoreRole(ro.id)}
                                        className="ms-1 opacity-60 hover:opacity-100 hover:text-destructive transition"
                                        title={isAr ? "حذف هذا الدور" : "Remove role"}
                                      >
                                        <Trash2 className="h-3 w-3" />
                                      </button>
                                    )}
                                  </Badge>
                                ))
                              )}
                            </div>
                          </TableCell>

                          <TableCell className="px-4 py-3 text-xs text-muted-foreground font-mono">
                            {new Date(r.created_at).toLocaleDateString()}
                          </TableCell>

                          {canManageStore && (
                            <TableCell className="px-4 py-3 text-end">
                              <div className="inline-flex items-center gap-2 justify-end">
                                <Select onValueChange={(v) => assignStoreRole(r.id, v)}>
                                  <SelectTrigger className="w-36 h-8 text-xs rounded-xl">
                                    <SelectValue
                                      placeholder={isAr ? "إسناد دور جديد..." : "Add role..."}
                                    />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {STORE_ROLES.filter(
                                      (ro) => !r.roles.find((x: any) => x.role === ro),
                                    ).map((ro) => (
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
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Tab 2: Platform Admins Table (Superadmins Only) */}
      {isSuper && activeTab === "platform" && (
        <Card className="border-amber-500/40 shadow-sm overflow-hidden rounded-3xl bg-surface/90">
          <CardHeader className="p-5 border-b border-border/70 bg-gradient-to-r from-amber-500/10 via-transparent to-transparent">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-sm font-bold text-foreground flex items-center gap-2">
                  <Crown className="h-4.5 w-4.5 text-amber-500" />
                  <span>
                    {isAr
                      ? "مدراء المنصة السحابية (جدول platform_admins)"
                      : "Platform Superadmins Registry"}
                  </span>
                </CardTitle>
                <CardDescription className="text-xs text-muted-foreground mt-0.5">
                  {isAr
                    ? "هذا السجل منفصل تماماً عن موظفي المتاجر؛ يختص بالتحكم في الباقات وموديلات المنصة وتراخيص النظام."
                    : "Strictly isolated from store staff; manages SaaS subscription tiers and global platform capabilities."}
                </CardDescription>
              </div>
              <Badge className="bg-amber-500/20 text-amber-700 dark:text-amber-300 border-amber-500/40 text-xs font-semibold">
                SaaS Infrastructure
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <tr className="border-b border-border text-[11px] uppercase tracking-wider text-muted-foreground">
                    <TableHead className="px-4 py-3">
                      {isAr ? "مدير المنصة" : "Platform Admin"}
                    </TableHead>
                    <TableHead className="px-4 py-3">
                      {isAr ? "مستوى الصلاحية" : "Privilege Tier"}
                    </TableHead>
                    <TableHead className="px-4 py-3">
                      {isAr ? "تاريخ التعيين" : "Appointed"}
                    </TableHead>
                    <TableHead className="px-4 py-3 text-end">
                      {isAr ? "إجراءات" : "Actions"}
                    </TableHead>
                  </tr>
                </TableHeader>
                <TableBody>
                  {platformAdminRows.map((pa) => (
                    <TableRow
                      key={pa.id}
                      className="border-b border-border/60 hover:bg-accent/25 transition-colors"
                    >
                      <TableCell className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div className="h-9 w-9 rounded-2xl bg-amber-500/15 text-amber-600 dark:text-amber-400 grid place-items-center text-xs font-bold border border-amber-500/30">
                            <Crown className="h-4 w-4" />
                          </div>
                          <div>
                            <div className="font-semibold text-sm text-foreground flex items-center gap-1.5">
                              <span>{pa.full_name}</span>
                              {pa.user_id === user?.id && (
                                <span className="text-[11px] font-normal text-amber-500">
                                  ({isAr ? "أنت" : "You"})
                                </span>
                              )}
                            </div>
                            <div className="text-[11px] text-muted-foreground font-mono">
                              User ID: {pa.user_id.slice(0, 8)}...
                            </div>
                          </div>
                        </div>
                      </TableCell>

                      <TableCell className="px-4 py-3">
                        <Badge className="bg-amber-500/20 text-amber-700 dark:text-amber-300 border-amber-500/40 gap-1.5 font-bold py-1">
                          <Crown className="h-3.5 w-3.5 text-amber-500" />
                          <span>{isAr ? "سوبر أدمن المنصة" : "Platform Superadmin"}</span>
                        </Badge>
                      </TableCell>

                      <TableCell className="px-4 py-3 text-xs text-muted-foreground font-mono">
                        {new Date(pa.created_at).toLocaleDateString()}
                      </TableCell>

                      <TableCell className="px-4 py-3 text-end">
                        {pa.user_id !== user?.id && (
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            onClick={() => revokePlatformAdmin(pa.id)}
                            className="h-8 text-xs text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                          >
                            <span>{isAr ? "إلغاء الصلاحية" : "Revoke"}</span>
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Footer Instructions */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 p-4 rounded-2xl border border-border/70 bg-surface/60 text-xs text-muted-foreground">
        <div>
          <p className="font-semibold text-foreground">
            {isAr ? "ملاحظة أمنية حول إضافة الموظفين:" : "Staff Onboarding Notice:"}
          </p>
          <p className="mt-0.5">
            {isAr
              ? "لتسجيل موظف جديد: اطلب منه تسجيل الدخول عبر شاشة /auth أولاً، وسيظهر اسمه فوراً في هذا الكشف لإسناد دوره المناسب."
              : "To onboard a staff member: have them log in via /auth, then grant their specific role here."}
          </p>
        </div>
        <RolePermissionsDialog
          trigger={
            <Button
              variant="outline"
              size="sm"
              className="rounded-full text-xs gap-1.5 border-primary/30 shrink-0"
            >
              <Sparkles className="h-3.5 w-3.5 text-primary" />
              <span>{isAr ? "استعراض مصفوفة الصلاحيات" : "View Matrix"}</span>
            </Button>
          }
        />
      </div>
    </div>
  );
}

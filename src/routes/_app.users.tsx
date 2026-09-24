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
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  ShieldCheck,
  Trash2,
  Crown,
  Users,
  Lock,
  Sparkles,
  UserPlus,
  UserX,
  UserCheck,
  Copy,
  Check,
  KeyRound,
  Loader2,
} from "lucide-react";
import { RolePermissionsDialog } from "@/components/role-permissions-dialog";
import { cn } from "@/lib/utils";

const STORE_ROLES = ["owner", "manager", "accountant", "cashier", "warehouse"] as const;
type StoreRole = (typeof STORE_ROLES)[number];

/** Default role offered for a brand-new staff account. */
const DEFAULT_NEW_ROLE: StoreRole = "cashier";

/** Credentials shown exactly once after a successful provisioning. */
type IssuedCredentials = {
  email: string;
  password: string;
  full_name: string;
  role: string;
};

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

  // Create-user dialog state
  const [addOpen, setAddOpen] = useState(false);
  const [addName, setAddName] = useState("");
  const [addEmail, setAddEmail] = useState("");
  const [addPhone, setAddPhone] = useState("");
  const [addRole, setAddRole] = useState<StoreRole>(DEFAULT_NEW_ROLE);
  const [addSaving, setAddSaving] = useState(false);
  // Populated only on success; holds the one-time credentials for hand-off.
  const [issued, setIssued] = useState<IssuedCredentials | null>(null);
  const [copiedField, setCopiedField] = useState<"password" | "all" | null>(null);

  async function load() {
    setLoading(true);
    try {
      // The platform_admins table is admin-only at the RLS layer now. Non-admins
      // must not even attempt the query (it would return zero rows) and must not
      // receive any Super Admin data in the client payload.
      const [profilesRes, rolesRes, platformRes] = await Promise.all([
        supabase.from("profiles").select("id, full_name, avatar_url, created_at, is_active"),
        supabase.from("user_roles").select("id, user_id, role"),
        isSuper
          ? (supabase as any)
              .from("platform_admins")
              .select("id, user_id, role, is_active, created_at")
          : Promise.resolve({ data: [] as any[] }),
      ]);

      const profiles = profilesRes.data;
      const roles = rolesRes.data;
      const platformAdmins = platformRes.data;

      const byUser = new Map<string, any[]>();
      (roles ?? []).forEach((r) => {
        const arr = byUser.get(r.user_id) ?? [];
        arr.push(r);
        byUser.set(r.user_id, arr);
      });

      const profileMap = new Map<string, any>();
      (profiles ?? []).forEach((p) => profileMap.set(p.id, p));

      // 1. Store Staff: tenant users who hold at least one store role.
      //    Platform superadmins are never listed here, so the Super Admin
      //    identity is never exposed to unauthorised viewers.
      const storeUsers: any[] = [];
      (profiles ?? []).forEach((p) => {
        const uRoles = byUser.get(p.id) ?? [];
        // Accounts with no store role yet are deliberately not listed here:
        // store staff are created from this page, which provisions the role
        // atomically. A profile left without a role is a failed provisioning
        // attempt and must not be presented as a team member.
        if (uRoles.length === 0) return;
        storeUsers.push({ ...p, roles: uRoles });
      });

      // 2. Platform Admins: strictly from platform_admins table (admins only).
      const platformUsers: any[] = (platformAdmins ?? []).map((pa: any) => {
        const prof = profileMap.get(pa.user_id);
        return {
          id: pa.id,
          user_id: pa.user_id,
          full_name: prof?.full_name ?? (isAr ? "مسؤول منصة" : "Platform admin"),
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSuper]);

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

  // Account-level deactivation. The auth user, profile, roles and every
  // historical record are preserved untouched — only profiles.is_active flips.
  // Access is actually revoked by RLS (migration 20260918000200).
  async function setUserActive(userId: string, active: boolean) {
    if (userId === user?.id && !active) {
      return toast.error(
        isAr ? "لا يمكنك تعطيل حسابك الخاص." : "You cannot disable your own account.",
      );
    }
    if (
      !confirm(
        active
          ? isAr
            ? "إعادة تفعيل هذا المستخدم؟ سيستعيد وصوله بنفس الحساب وبياناته."
            : "Reactivate this user? They regain access with the same account."
          : isAr
            ? "تعطيل هذا المستخدم؟ سيتم إيقاف وصوله مع الاحتفاظ ببياناته وسجلاته بالكامل."
            : "Disable this user? Access is revoked but all data and history is kept.",
      )
    )
      return;

    const { error } = await supabase
      .from("profiles")
      .update({ is_active: active } as any)
      .eq("id", userId);

    if (error) return toast.error(error.message);
    toast.success(
      active
        ? isAr
          ? "تمت إعادة تفعيل المستخدم"
          : "User reactivated"
        : isAr
          ? "تم تعطيل المستخدم مع الاحتفاظ ببياناته"
          : "User disabled (data preserved)",
    );
    void load();
  }

  // Creates a BRAND-NEW staff account via the `admin-create-user` Edge
  // Function: Auth user + profile + store role are provisioned server-side.
  //
  // SECURITY: the browser never sees a service/secret key. The function
  // re-derives the caller's permissions from the database, validates the role
  // against a hard allow-list, and refuses platform/super admin tiers. The
  // quota check is repeated there too, so it cannot be bypassed by calling the
  // function directly (bypassing this dialog).
  async function createStoreUser() {
    const name = addName.trim();
    const email = addEmail.trim().toLowerCase();
    const phone = addPhone.trim();

    if (name.length < 2) {
      return toast.error(isAr ? "يرجى إدخال اسم المستخدم." : "Please enter the user's name.");
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
      return toast.error(
        isAr ? "يرجى إدخال بريد إلكتروني صحيح." : "Please enter a valid email address.",
      );
    }
    if (STORE_ROLES.indexOf(addRole) === -1) {
      return toast.error(isAr ? "الدور المحدد غير مسموح." : "The selected role is not allowed.");
    }

    setAddSaving(true);
    try {
      // The bearer token must be attached explicitly: without it the function
      // cannot tell who is calling and every request would be rejected.
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;
      if (!accessToken) {
        toast.error(isAr ? "انتهت جلسة الدخول. يرجى إعادة تسجيل الدخول." : "Session expired.");
        return;
      }

      const { data, error } = await supabase.functions.invoke("admin-create-user", {
        body: { email, full_name: name, phone, role: addRole, language: lang },
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (error) {
        // Supabase attaches the raw response body to `context` for non-2xx
        // replies; prefer the server's Arabic message over the generic one.
        let payload: any = data;
        const ctx = (error as any).context;
        if (!payload && ctx && typeof ctx.json === "function") {
          payload = await ctx.json().catch(() => null);
        }
        throw new Error(
          payload?.message ??
            (isAr ? "تعذر إنشاء المستخدم. يرجى المحاولة مرة أخرى." : "Failed to create user."),
        );
      }

      if (!data?.ok) {
        throw new Error(
          data?.message ??
            (isAr ? "تعذر إنشاء المستخدم. يرجى المحاولة مرة أخرى." : "Failed to create user."),
        );
      }

      // The password exists only in this response. It is never persisted, so
      // it is handed to the admin once and never fetched again.
      setIssued({
        email: data.email,
        password: data.password,
        full_name: data.full_name,
        role: data.role,
      });
      setCopiedField(null);
      toast.success(isAr ? "تم إنشاء حساب المستخدم بنجاح" : "User account created successfully");
      void load();
    } catch (err: any) {
      toast.error(err?.message ?? (isAr ? "تعذر إنشاء المستخدم" : "Failed to create user"));
    } finally {
      setAddSaving(false);
    }
  }

  /** Clears the one-time credentials and closes the create dialog. */
  function resetCreateDialog() {
    setIssued(null);
    setCopiedField(null);
    setAddName("");
    setAddEmail("");
    setAddPhone("");
    setAddRole(DEFAULT_NEW_ROLE);
  }

  async function copyToClipboard(text: string, field: "password" | "all") {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(field);
      toast.success(isAr ? "تم النسخ" : "Copied");
      setTimeout(() => setCopiedField(null), 2000);
    } catch {
      toast.error(isAr ? "تعذر النسخ تلقائيًا. انسخ البيانات يدويًا." : "Copy failed.");
    }
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
              <div className="flex items-center gap-2">
                {canManageStore && (
                  <Button
                    size="sm"
                    onClick={() => setAddOpen(true)}
                    className="rounded-full text-xs gap-1.5"
                  >
                    <UserPlus className="h-3.5 w-3.5" />
                    <span>{isAr ? "إضافة مستخدم" : "Add User"}</span>
                  </Button>
                )}
                <Badge variant="outline" className="text-xs font-mono">
                  {isAr ? `${storeRows.length} موظف` : `${storeRows.length} Staff`}
                </Badge>
              </div>
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
                    <TableHead className="px-4 py-3">{isAr ? "الحالة" : "Status"}</TableHead>
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
                        <TableCell colSpan={5} className="px-4 py-4">
                          <div className="h-5 w-full rounded shimmer" />
                        </TableCell>
                      </TableRow>
                    ))
                  ) : storeRows.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center text-muted-foreground py-12">
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
                                    {canManageStore && !isCurrentUser && !hasOwner && (
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

                          <TableCell className="px-4 py-3">
                            {r.is_active === false ? (
                              <Badge
                                variant="outline"
                                className="gap-1.5 py-1 px-2.5 text-xs font-semibold border-rose-500/40 text-rose-600 dark:text-rose-400"
                              >
                                <UserX className="h-3.5 w-3.5" />
                                <span>{isAr ? "معطّل" : "Disabled"}</span>
                              </Badge>
                            ) : (
                              <Badge
                                variant="outline"
                                className="gap-1.5 py-1 px-2.5 text-xs font-semibold border-emerald-500/40 text-emerald-600 dark:text-emerald-400"
                              >
                                <UserCheck className="h-3.5 w-3.5" />
                                <span>{isAr ? "نشط" : "Active"}</span>
                              </Badge>
                            )}
                          </TableCell>

                          <TableCell className="px-4 py-3 text-xs text-muted-foreground font-mono">
                            {new Date(r.created_at).toLocaleDateString()}
                          </TableCell>

                          {canManageStore && (
                            <TableCell className="px-4 py-3 text-end">
                              <div className="inline-flex items-center gap-2 justify-end">
                                {/* Owner rows are protected: no role removal and no
                                    disable, mirroring the existing ownership rule. */}
                                {!hasOwner &&
                                  !isCurrentUser &&
                                  (r.is_active === false ? (
                                    <Button
                                      type="button"
                                      size="sm"
                                      variant="outline"
                                      onClick={() => setUserActive(r.id, true)}
                                      className="h-8 text-xs gap-1.5 rounded-xl border-emerald-500/40 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/10"
                                    >
                                      <UserCheck className="h-3.5 w-3.5" />
                                      <span>{isAr ? "إعادة التفعيل" : "Reactivate"}</span>
                                    </Button>
                                  ) : (
                                    <Button
                                      type="button"
                                      size="sm"
                                      variant="ghost"
                                      onClick={() => setUserActive(r.id, false)}
                                      className="h-8 text-xs gap-1.5 rounded-xl text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                                    >
                                      <UserX className="h-3.5 w-3.5" />
                                      <span>{isAr ? "تعطيل المستخدم" : "Disable"}</span>
                                    </Button>
                                  ))}
                                {!hasOwner && (
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
                                )}
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
            {isAr ? "ملاحظة حول إضافة الموظفين:" : "Staff Onboarding Notice:"}
          </p>
          <p className="mt-0.5">
            {isAr
              ? "تُنشأ حسابات الموظفين من هنا مباشرة دون حاجة الموظف للتسجيل مسبقًا: أدخل اسمه وبريده ودوره، وسيُولَّد له حساب جاهز ومُفعّل مع كلمة مرور تُعرض لك مرة واحدة لتسليمها له. التعطيل يوقف وصول المستخدم فورًا مع الاحتفاظ بكل بياناته وسجلاته، ويمكن إعادة تفعيله في أي وقت."
              : "Staff accounts are created directly from here with no prior sign-up: enter a name, email and role, and an active account is provisioned with a password shown to you once for hand-off. Disabling revokes access immediately while keeping all data and history, and can be reversed anytime."}
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

      {/* Create-user dialog: provisions a new account server-side.
          It deliberately offers only store roles — no Platform/Super Admin. */}
      <Dialog
        open={addOpen}
        onOpenChange={(open) => {
          // Once the account exists, the one-time password lives only in this
          // dialog's state. Escape / outside-click / the X button must NOT be
          // able to discard it: they would leave a real account behind whose
          // password nobody knows. Closing is therefore allowed only through
          // the explicit "Done" button below while `issued` is set.
          if (!open && issued) return;
          setAddOpen(open);
          if (!open) resetCreateDialog();
        }}
      >
        <DialogContent
          className="max-w-md"
          onEscapeKeyDown={(e) => {
            if (issued) e.preventDefault();
          }}
          onPointerDownOutside={(e) => {
            if (issued) e.preventDefault();
          }}
          onInteractOutside={(e) => {
            if (issued) e.preventDefault();
          }}
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <UserPlus className="h-4 w-4 text-primary" />
              <span>
                {issued
                  ? isAr
                    ? "بيانات دخول المستخدم"
                    : "User Sign-in Credentials"
                  : isAr
                    ? "إضافة مستخدم جديد"
                    : "Add New User"}
              </span>
            </DialogTitle>
            <DialogDescription className="text-xs">
              {issued
                ? isAr
                  ? "انسخ بيانات الدخول وسلّمها للمستخدم. لن تُعرض كلمة المرور مرة أخرى."
                  : "Copy these credentials and hand them to the user. The password is not shown again."
                : isAr
                  ? "سيتم إنشاء الحساب ودوره في المتجر فورًا، ويستطيع المستخدم تسجيل الدخول بحسابه متى شاء."
                  : "The account and its store role are created immediately. The user can sign in whenever they are ready."}
            </DialogDescription>
          </DialogHeader>

          {issued ? (
            /* ---------- Success: one-time credentials ---------- */
            <div className="space-y-4 py-1">
              <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3 text-xs text-emerald-700 dark:text-emerald-400 flex items-start gap-2">
                <Check className="h-4 w-4 shrink-0 mt-0.5" />
                <span>
                  {isAr
                    ? "تم إنشاء الحساب بنجاح وإسناد الدور. سلّم البيانات التالية للمستخدم الآن."
                    : "Account created and role assigned. Hand the credentials below to the user now."}
                </span>
              </div>

              <div className="space-y-2.5 rounded-xl border border-border/70 bg-surface/60 p-3">
                <CredentialRow label={isAr ? "الاسم" : "Name"} value={issued.full_name} />
                <CredentialRow label={isAr ? "البريد الإلكتروني" : "Email"} value={issued.email} />
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[11px] font-semibold text-muted-foreground">
                    {isAr ? "كلمة المرور" : "Password"}
                  </span>
                  <div className="flex items-center gap-2">
                    <code className="rounded-lg bg-background px-2 py-1 font-mono text-xs text-foreground border border-border/70">
                      {issued.password}
                    </code>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-7 gap-1.5 rounded-lg px-2 text-[11px]"
                      onClick={() => void copyToClipboard(issued.password, "password")}
                    >
                      {copiedField === "password" ? (
                        <Check className="h-3 w-3" />
                      ) : (
                        <Copy className="h-3 w-3" />
                      )}
                      <span>{isAr ? "نسخ كلمة المرور" : "Copy password"}</span>
                    </Button>
                  </div>
                </div>
                <CredentialRow label={isAr ? "الدور" : "Role"} value={t(`role.${issued.role}`)} />
              </div>

              <Button
                type="button"
                variant="outline"
                className="w-full gap-2 rounded-xl text-xs"
                onClick={() =>
                  void copyToClipboard(
                    isAr
                      ? `بيانات الدخول إلى ${t("app.name")}:\nالبريد الإلكتروني: ${issued.email}\nكلمة المرور: ${issued.password}\nالرابط: ${window.location.origin}/auth`
                      : `Your ${t("app.name")} sign-in details:\nEmail: ${issued.email}\nPassword: ${issued.password}\nLink: ${window.location.origin}/auth`,
                    "all",
                  )
                }
              >
                {copiedField === "all" ? (
                  <Check className="h-3.5 w-3.5" />
                ) : (
                  <KeyRound className="h-3.5 w-3.5" />
                )}
                <span>{isAr ? "نسخ بيانات الدخول كاملة" : "Copy full sign-in details"}</span>
              </Button>
            </div>
          ) : (
            /* ---------- Form ---------- */
            <div className="space-y-4 py-1">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-foreground">
                  {isAr ? "الاسم الكامل" : "Full name"}
                </label>
                <Input
                  value={addName}
                  onChange={(e) => setAddName(e.target.value)}
                  placeholder={isAr ? "مثال: أحمد علي" : "e.g. Ahmed Ali"}
                  className="h-9 text-xs rounded-xl"
                  maxLength={120}
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-foreground">
                  {isAr ? "البريد الإلكتروني" : "Email"}
                </label>
                <Input
                  type="email"
                  value={addEmail}
                  onChange={(e) => setAddEmail(e.target.value)}
                  placeholder="user@example.com"
                  className="h-9 text-xs rounded-xl"
                  dir="ltr"
                  maxLength={255}
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-foreground">
                  {isAr ? "رقم الهاتف (اختياري)" : "Phone (optional)"}
                </label>
                <Input
                  type="tel"
                  value={addPhone}
                  onChange={(e) => setAddPhone(e.target.value)}
                  placeholder={isAr ? "7xxxxxxxx" : "7xxxxxxxx"}
                  className="h-9 text-xs rounded-xl"
                  dir="ltr"
                  maxLength={40}
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-foreground">
                  {isAr ? "الدور في المتجر" : "Store Role"}
                </label>
                <Select value={addRole} onValueChange={(v) => setAddRole(v as StoreRole)}>
                  <SelectTrigger className="w-full h-9 text-xs rounded-xl">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STORE_ROLES.map((ro) => (
                      <SelectItem key={ro} value={ro} className="text-xs">
                        {t(`role.${ro}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <p className="rounded-xl border border-border/70 bg-surface/60 p-3 text-[11px] leading-relaxed text-muted-foreground">
                {isAr
                  ? "يتم توليد كلمة مرور قوية تلقائيًا على السيرفر وتُعرض لك مرة واحدة فقط بعد الإنشاء. يبدأ الحساب نشطًا ويستطيع الدخول مباشرة من شاشة تسجيل الدخول."
                  : "A strong password is generated server-side and shown to you once after creation. The account starts active and can sign in immediately."}
              </p>
            </div>
          )}

          <DialogFooter className="gap-2">
            {issued ? (
              /* The only way out of the issued-credentials view: closes the
                 dialog and clears the password from memory in one step. */
              <Button
                size="sm"
                className="rounded-xl"
                onClick={() => {
                  setAddOpen(false);
                  resetCreateDialog();
                }}
              >
                {isAr ? "تم، إغلاق" : "Done"}
              </Button>
            ) : (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  className="rounded-xl"
                  onClick={() => setAddOpen(false)}
                >
                  {isAr ? "إلغاء" : "Cancel"}
                </Button>
                <Button
                  size="sm"
                  className="rounded-xl gap-1.5"
                  disabled={addSaving || !addName.trim() || !addEmail.trim()}
                  onClick={() => void createStoreUser()}
                >
                  {addSaving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  <span>
                    {addSaving
                      ? isAr
                        ? "جارٍ الإنشاء..."
                        : "Creating..."
                      : isAr
                        ? "إنشاء الحساب"
                        : "Create account"}
                  </span>
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Read-only label/value pair used in the one-time credentials panel. */
function CredentialRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-[11px] font-semibold text-muted-foreground">{label}</span>
      <code className="rounded-lg bg-background px-2 py-1 font-mono text-xs text-foreground border border-border/70 break-all">
        {value}
      </code>
    </div>
  );
}

import { useModules } from "@/lib/modules";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/page-header";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
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
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
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
  Search,
  Phone,
  Mail,
  Calendar,
  Eye,
  Pencil,
  Send,
  MessageCircle,
  Briefcase,
  Shield,
  Filter,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import { RolePermissionsDialog } from "@/components/role-permissions-dialog";
import { VortexMetricCard, VortexSearchInput, VortexDateBadge } from "@/components/vortex-ui";
import { toSystemDigits, formatLuxuryDate } from "@/lib/format-preferences";
import { cn } from "@/lib/utils";
import { CountrySelector } from "@/components/country-selector";
import { DEFAULT_COUNTRY, Country } from "@/lib/country-data";
import { formatPhoneE164, phoneToAuthEmail } from "@/lib/phone-utils";

const STORE_ROLES = ["owner", "manager", "accountant", "cashier", "warehouse"] as const;
type StoreRole = (typeof STORE_ROLES)[number];

const DEFAULT_NEW_ROLE: StoreRole = "cashier";

type IssuedCredentials = {
  email: string;
  password: string;
  full_name: string;
  role: string;
  phone?: string;
};

// Role styling & icons helper
function getRoleMeta(role: string) {
  switch (role) {
    case "owner":
      return {
        labelAr: "المالك",
        icon: Crown,
        badgeClass: "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30",
        colorClass: "text-amber-500",
      };
    case "manager":
      return {
        labelAr: "المدير",
        icon: ShieldCheck,
        badgeClass: "bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-500/30",
        colorClass: "text-blue-500",
      };
    case "accountant":
      return {
        labelAr: "المحاسب",
        icon: Briefcase,
        badgeClass:
          "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30",
        colorClass: "text-emerald-500",
      };
    case "cashier":
      return {
        labelAr: "الكاشير",
        icon: Sparkles,
        badgeClass: "bg-purple-500/15 text-purple-700 dark:text-purple-300 border-purple-500/30",
        colorClass: "text-purple-500",
      };
    case "warehouse":
      return {
        labelAr: "أمين المستودع",
        icon: Shield,
        badgeClass: "bg-orange-500/15 text-orange-700 dark:text-orange-300 border-orange-500/30",
        colorClass: "text-orange-500",
      };
    default:
      return {
        labelAr: role,
        icon: Shield,
        badgeClass: "bg-muted text-muted-foreground border-border",
        colorClass: "text-muted-foreground",
      };
  }
}

export const Route = createFileRoute("/_app/users")({
  head: () => ({ meta: [{ title: "إدارة المستخدمين والصلاحيات — Vortex ERP" }] }),
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

  // Search & Filter state
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  // User detail sheet state
  const [selectedUser, setSelectedUser] = useState<any | null>(null);

  // Create-user dialog state
  const [addOpen, setAddOpen] = useState(false);
  const [addName, setAddName] = useState("");
  const [addCountry, setAddCountry] = useState<Country>(DEFAULT_COUNTRY);
  const [addPhone, setAddPhone] = useState("");
  const [addEmail, setAddEmail] = useState("");
  const [addRole, setAddRole] = useState<StoreRole>(DEFAULT_NEW_ROLE);
  const [addPassword, setAddPassword] = useState("");
  const [addConfirmPassword, setAddConfirmPassword] = useState("");
  const [useGeneratedPassword, setUseGeneratedPassword] = useState(true);
  const [addSaving, setAddSaving] = useState(false);
  const [issued, setIssued] = useState<IssuedCredentials | null>(null);

  const [editOpen, setEditOpen] = useState(false);
  const [editUser, setEditUser] = useState<any | null>(null);
  const [editName, setEditName] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editLanguage, setEditLanguage] = useState("ar");
  const [editSaving, setEditSaving] = useState(false);
  const [copiedField, setCopiedField] = useState<"password" | "all" | null>(null);

  async function load() {
    setLoading(true);
    try {
      const [profilesRes, rolesRes, platformRes] = await Promise.all([
        supabase
          .from("profiles")
          .select("id, full_name, avatar_url, phone, language, created_at, is_active"),
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

      // Build the set of platform admin user IDs to exclude from store staff
      const platformAdminSet = new Set<string>();

      if (isSuper) {
        // Superadmin has full RLS read on platform_admins table
        (platformAdmins ?? []).forEach((pa: any) => {
          if (pa?.user_id) {
            platformAdminSet.add(pa.user_id);
          }
        });
      } else {
        // Non-platform admin (owner, manager, etc.): check candidate users via SECURITY DEFINER RPC
        // Collect candidates: users in profiles who hold at least one store role
        const candidateUserIds = (profiles ?? [])
          .filter((p) => (byUser.get(p.id) ?? []).length > 0)
          .map((p) => p.id);

        if (candidateUserIds.length > 0) {
          const rpcResults = await Promise.all(
            candidateUserIds.map(async (uid) => {
              try {
                const { data, error } = await (supabase as any).rpc("is_platform_admin", {
                  p_user_id: uid,
                });
                if (error) {
                  console.error(`[loadUsers] is_platform_admin RPC error for ${uid}:`, error);
                  return { uid, isPlatformAdmin: false };
                }
                return { uid, isPlatformAdmin: data === true };
              } catch (rpcErr) {
                console.error(`[loadUsers] is_platform_admin invoke failed for ${uid}:`, rpcErr);
                return { uid, isPlatformAdmin: false };
              }
            }),
          );

          rpcResults.forEach((res) => {
            if (res.isPlatformAdmin) {
              platformAdminSet.add(res.uid);
            }
          });
        }
      }

      const storeUsers: any[] = [];
      (profiles ?? []).forEach((p) => {
        if (platformAdminSet.has(p.id)) return;
        const uRoles = byUser.get(p.id) ?? [];
        if (uRoles.length === 0) return;
        storeUsers.push({ ...p, roles: uRoles });
      });

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
      toast.error(isAr ? "تعذر تحميل قائمة المستخدمين" : "Failed to load users");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [isSuper]);

  // Statistics calculation
  const stats = useMemo(() => {
    const total = storeRows.length;
    const active = storeRows.filter((r) => r.is_active !== false).length;
    const disabled = storeRows.filter((r) => r.is_active === false).length;
    const managers = storeRows.filter((r) =>
      r.roles.some((ro: any) => ro.role === "owner" || ro.role === "manager"),
    ).length;

    return { total, active, disabled, managers };
  }, [storeRows]);

  // Filtered staff rows
  const filteredStoreRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return storeRows.filter((r) => {
      // Text search
      if (q) {
        const name = (r.full_name || "").toLowerCase();
        const phone = (r.phone || "").toLowerCase();
        const rolesStr = (r.roles || [])
          .map((ro: any) => ro.role)
          .join(" ")
          .toLowerCase();
        const rolesArStr = (r.roles || []).map((ro: any) => getRoleMeta(ro.role).labelAr).join(" ");
        if (
          !name.includes(q) &&
          !phone.includes(q) &&
          !rolesStr.includes(q) &&
          !rolesArStr.includes(q)
        ) {
          return false;
        }
      }

      // Role filter
      if (roleFilter !== "all") {
        const has = r.roles.some((ro: any) => ro.role === roleFilter);
        if (!has) return false;
      }

      // Status filter
      if (statusFilter !== "all") {
        if (statusFilter === "active" && r.is_active === false) return false;
        if (statusFilter === "disabled" && r.is_active !== false) return false;
      }

      return true;
    });
  }, [storeRows, search, roleFilter, statusFilter]);

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
          ? "تمت إعادة تفعيل المستخدم بنجاح"
          : "User reactivated"
        : isAr
          ? "تم تعطيل المستخدم مع الاحتفاظ ببياناته"
          : "User disabled (data preserved)",
    );
    void load();
  }

  function openEditUser(row: any) {
    setEditUser(row);
    setEditName(row.full_name ?? "");
    setEditPhone(row.phone ?? "");
    setEditLanguage(row.language ?? "ar");
    setEditOpen(true);
  }

  async function saveEditUser() {
    if (!editUser) return;
    const name = editName.trim();
    const phone = editPhone.trim();

    if (name.length < 2) {
      return toast.error(isAr ? "يرجى إدخال اسم صحيح." : "Please enter a valid name.");
    }

    setEditSaving(true);
    try {
      const { error } = await supabase
        .from("profiles")
        .update({ full_name: name, phone: phone || null, language: editLanguage })
        .eq("id", editUser.id);

      if (error) throw error;
      toast.success(isAr ? "تم تحديث بيانات الموظف" : "Employee details updated");
      setEditOpen(false);
      setEditUser(null);
      void load();
    } catch (err: any) {
      toast.error(
        err?.message ?? (isAr ? "تعذر تحديث بيانات الموظف" : "Failed to update employee"),
      );
    } finally {
      setEditSaving(false);
    }
  }

  async function createStoreUser() {
    const name = addName.trim();
    const phoneInput = addPhone.trim();
    const customEmail = addEmail.trim().toLowerCase();
    const password = addPassword;
    const confirmPassword = addConfirmPassword;

    if (name.length < 2) {
      return toast.error(isAr ? "يرجى إدخال اسم المستخدم." : "Please enter the user's name.");
    }

    if (!phoneInput && !customEmail) {
      return toast.error(
        isAr
          ? "يرجى إدخال رقم الهاتف أو البريد الإلكتروني للموظف."
          : "Please enter the employee's phone number or email.",
      );
    }

    // Determine the authentication email and formatted phone
    let authEmail = "";
    let finalPhone = "";

    if (phoneInput) {
      finalPhone = formatPhoneE164(phoneInput, addCountry.dialCode);
      authEmail = phoneToAuthEmail(finalPhone);
    } else {
      authEmail = customEmail;
    }

    // If custom email provided and no phone, validate email syntax
    if (customEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(customEmail)) {
      return toast.error(
        isAr ? "يرجى إدخال بريد إلكتروني صحيح." : "Please enter a valid email address.",
      );
    }

    if (STORE_ROLES.indexOf(addRole) === -1) {
      return toast.error(isAr ? "الدور المحدد غير مسموح." : "The selected role is not allowed.");
    }
    if (!useGeneratedPassword) {
      if (password.length < 8) {
        return toast.error(
          isAr
            ? "كلمة المرور يجب أن تحتوي على 8 أحرف على الأقل."
            : "Password must be at least 8 characters.",
        );
      }
      if (password !== confirmPassword) {
        return toast.error(isAr ? "كلمتا المرور غير متطابقتين." : "Passwords do not match.");
      }
    }

    setAddSaving(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;
      if (!accessToken) {
        toast.error(isAr ? "انتهت جلسة الدخول. يرجى إعادة تسجيل الدخول." : "Session expired.");
        return;
      }

      console.log("[CreateUser] Invoking admin-create-user...", {
        email: authEmail,
        full_name: name,
        phone: finalPhone || phoneInput || null,
        role: addRole,
      });

      const { data, error } = await supabase.functions.invoke("admin-create-user", {
        body: {
          email: authEmail,
          full_name: name,
          phone: finalPhone || phoneInput || null,
          role: addRole,
          language: lang,
          ...(useGeneratedPassword ? {} : { password }),
        },
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      console.log("[CreateUser] Result:", { data, error });

      if (error) {
        let errorMsg = error.message;
        try {
          const ctx = (error as any).context;
          if (ctx && typeof ctx.json === "function") {
            const body = await ctx.json();
            if (body?.message) {
              errorMsg = body.message;
            } else if (body?.error && typeof body.error === "string") {
              errorMsg = body.error;
            }
          }
        } catch {
          // fallback to error.message
        }
        console.error("[CreateUser] invoke error detail:", error, errorMsg);
        throw new Error(
          errorMsg ||
            (isAr ? "تعذر إنشاء المستخدم. يرجى المحاولة مرة أخرى." : "Failed to create user."),
        );
      }

      if (!data?.ok) {
        throw new Error(
          data?.message ??
            (isAr ? "تعذر إنشاء المستخدم. يرجى المحاولة مرة أخرى." : "Failed to create user."),
        );
      }

      if (useGeneratedPassword) {
        setIssued({
          email: data.email,
          password: data.password,
          full_name: data.full_name,
          role: data.role,
          phone: finalPhone || phoneInput || undefined,
        });
        setCopiedField(null);
      } else {
        toast.success(isAr ? "تم إنشاء حساب المستخدم بنجاح" : "User account created successfully");
        setAddOpen(false);
        resetCreateDialog();
      }
      void load();
    } catch (err: any) {
      toast.error(err?.message ?? (isAr ? "تعذر إنشاء المستخدم" : "Failed to create user"));
    } finally {
      setAddSaving(false);
    }
  }

  function resetCreateDialog() {
    setIssued(null);
    setCopiedField(null);
    setAddName("");
    setAddCountry(DEFAULT_COUNTRY);
    setAddPhone("");
    setAddEmail("");
    setAddRole(DEFAULT_NEW_ROLE);
    setAddPassword("");
    setAddConfirmPassword("");
    setUseGeneratedPassword(true);
  }

  async function copyToClipboard(text: string, field: "password" | "all") {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(field);
      toast.success(isAr ? "تم النسخ بنجاح" : "Copied");
      setTimeout(() => setCopiedField(null), 2000);
    } catch {
      toast.error(isAr ? "تعذر النسخ تلقائيًا" : "Copy failed.");
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
    <div className="space-y-6 pb-12">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-foreground">
            {isAr ? "إدارة المستخدمين وطاقم العمل" : "Staff & Access Control"}
          </h1>
          <p className="text-xs sm:text-sm text-muted-foreground mt-1">
            {isAr
              ? "إدارة حسابات الموظفين وتعيين الأدوار التشغيلية والصلاحيات المعتمدة للمتجر"
              : "Manage staff accounts, assign operational roles, and enforce security policies"}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {canManageStore && (
            <RolePermissionsDialog
              showPlatformRole={isSuper}
              trigger={
                <Button
                  variant="outline"
                  size="sm"
                  className="rounded-2xl gap-2 h-10 px-3.5 border-border/80 hover:bg-muted text-xs font-semibold"
                >
                  <Sparkles className="size-4 text-primary" />
                  <span>{isAr ? "مصفوفة الصلاحيات" : "Permissions Matrix"}</span>
                </Button>
              }
            />
          )}

          {canManageStore && (
            <Button
              size="sm"
              onClick={() => setAddOpen(true)}
              className="rounded-2xl gap-2 h-10 px-4 text-xs font-bold shadow-md shadow-primary/20"
            >
              <UserPlus className="size-4" />
              <span>{isAr ? "إضافة موظف جديد" : "Add Staff"}</span>
            </Button>
          )}
        </div>
      </div>

      {/* Warning banner for non-owners */}
      {!canManageStore && (
        <div className="p-4 rounded-3xl border border-amber-500/30 bg-amber-500/5 text-xs text-amber-700 dark:text-amber-400 flex items-center gap-2.5">
          <Lock className="size-4 shrink-0 text-amber-500" />
          <span>
            {isAr
              ? "ملاحظة: صلاحية المالك والمدير المخول فقط هي التي تملك حق تعيين أو تعديل أدوار الموظفين."
              : "Notice: Only Owner and authorized Managers can modify staff role assignments."}
          </span>
        </div>
      )}

      {/* Top Metric Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <VortexMetricCard
          title={isAr ? "إجمالي طاقم العمل" : "Total Staff"}
          value={toSystemDigits(stats.total)}
          currency=""
          subtitle={isAr ? "موظف مسجل بالمنشأة" : "Registered store staff"}
          icon={<Users className="size-5" />}
          iconClassName="bg-primary/10 text-primary"
        />
        <VortexMetricCard
          title={isAr ? "الحسابات النشطة" : "Active Staff"}
          value={toSystemDigits(stats.active)}
          currency=""
          subtitle={isAr ? "جاهزون للعمل والدخول" : "Ready for operations"}
          icon={<UserCheck className="size-5" />}
          iconClassName="bg-emerald-500/10 text-emerald-600"
          highlight={stats.active > 0}
        />
        <VortexMetricCard
          title={isAr ? "الحسابات المعطلة" : "Disabled Staff"}
          value={toSystemDigits(stats.disabled)}
          currency=""
          subtitle={isAr ? "تم إيقاف وصولهم مؤقتاً" : "Access currently revoked"}
          icon={<UserX className="size-5" />}
          iconClassName={
            stats.disabled > 0 ? "bg-rose-500/10 text-rose-600" : "bg-muted text-muted-foreground"
          }
        />
        <VortexMetricCard
          title={isAr ? "القيادة والإدارة" : "Managers & Owners"}
          value={toSystemDigits(stats.managers)}
          currency=""
          subtitle={isAr ? "صلاحيات إدارية متقدمة" : "Elevated privileges"}
          icon={<Crown className="size-5" />}
          iconClassName="bg-amber-500/10 text-amber-600"
        />
      </div>

      {/* Superadmin Tab Navigation */}
      {isSuper && (
        <div className="flex items-center gap-2 border-b border-border/70 pb-3">
          <button
            onClick={() => setActiveTab("store")}
            className={cn(
              "flex items-center gap-2 rounded-2xl px-4 py-2 text-xs font-bold transition-all",
              activeTab === "store"
                ? "bg-primary text-primary-foreground shadow-sm"
                : "bg-card hover:bg-muted text-muted-foreground hover:text-foreground border border-border/70",
            )}
          >
            <Users className="size-4" />
            <span>{isAr ? "طاقم موظفي المنشأة" : "Store Staff Team"}</span>
            <span className="rounded-full bg-primary-foreground/20 px-2 py-0.5 text-[10px] font-mono">
              {toSystemDigits(storeRows.length)}
            </span>
          </button>

          <button
            onClick={() => setActiveTab("platform")}
            className={cn(
              "flex items-center gap-2 rounded-2xl px-4 py-2 text-xs font-bold transition-all",
              activeTab === "platform"
                ? "bg-gradient-to-r from-amber-500 to-orange-500 text-white shadow-sm"
                : "bg-card hover:bg-muted text-muted-foreground hover:text-foreground border border-border/70",
            )}
          >
            <Crown className="size-4 text-amber-200" />
            <span>{isAr ? "مدراء المنصة السحابية" : "Platform Superadmins"}</span>
            <span className="rounded-full bg-white/20 px-2 py-0.5 text-[10px] font-mono">
              {toSystemDigits(platformAdminRows.length)}
            </span>
          </button>
        </div>
      )}

      {/* Store Staff Tab View */}
      {activeTab === "store" && (
        <div className="space-y-4">
          {/* Search & Quick Filter Toolbar */}
          <div className="flex flex-col sm:flex-row items-center gap-3">
            <div className="w-full sm:flex-1">
              <VortexSearchInput
                value={search}
                onValueChange={setSearch}
                placeholder={
                  isAr
                    ? "ابحث بالاسم، الدور، أو رقم الهاتف..."
                    : "Search staff by name, role, or phone..."
                }
                className="w-full"
              />
            </div>

            {/* Quick role filter pills */}
            <div className="flex items-center gap-1.5 overflow-x-auto w-full sm:w-auto pb-1 sm:pb-0 scrollbar-none">
              <Button
                size="sm"
                variant={roleFilter === "all" ? "default" : "outline"}
                onClick={() => setRoleFilter("all")}
                className="rounded-full text-xs h-9 px-3 shrink-0"
              >
                {isAr ? "جميع الأدوار" : "All"}
              </Button>
              {STORE_ROLES.map((r) => {
                const meta = getRoleMeta(r);
                const Icon = meta.icon;
                return (
                  <Button
                    key={r}
                    size="sm"
                    variant={roleFilter === r ? "default" : "outline"}
                    onClick={() => setRoleFilter(r)}
                    className="rounded-full text-xs h-9 px-3 shrink-0 gap-1.5"
                  >
                    <Icon
                      className={cn(
                        "size-3.5",
                        roleFilter === r ? "text-primary-foreground" : meta.colorClass,
                      )}
                    />
                    <span>{meta.labelAr}</span>
                  </Button>
                );
              })}

              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-32 h-9 text-xs rounded-full border-border/80">
                  <SelectValue placeholder={isAr ? "الحالة" : "Status"} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all" className="text-xs">
                    {isAr ? "كل الحالات" : "All Status"}
                  </SelectItem>
                  <SelectItem value="active" className="text-xs">
                    {isAr ? "نشط فقط" : "Active only"}
                  </SelectItem>
                  <SelectItem value="disabled" className="text-xs">
                    {isAr ? "معطّل فقط" : "Disabled only"}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Staff Cards & Table List */}
          <Card className="rounded-3xl border border-border/70 shadow-sm overflow-hidden bg-card">
            <CardContent className="p-0">
              {loading ? (
                <div className="p-12 text-center space-y-3">
                  <Loader2 className="size-8 animate-spin mx-auto text-primary" />
                  <p className="text-xs text-muted-foreground">
                    {isAr ? "جارٍ تحميل طاقم العمل..." : "Loading staff..."}
                  </p>
                </div>
              ) : filteredStoreRows.length === 0 ? (
                <div className="p-16 text-center">
                  <div className="mx-auto mb-4 grid size-16 place-items-center rounded-3xl bg-muted/60 text-muted-foreground">
                    <Users className="size-8 opacity-60" />
                  </div>
                  <h3 className="text-base font-bold text-foreground mb-1">
                    {isAr ? "لا يوجد موظفون مطابقون" : "No matching staff"}
                  </h3>
                  <p className="text-xs text-muted-foreground max-w-sm mx-auto">
                    {isAr
                      ? "لم نجد أي موظف يطابق معايير البحث والفلترة المحددة حالياً."
                      : "No staff member matched your current search filters."}
                  </p>
                  {(search || roleFilter !== "all" || statusFilter !== "all") && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setSearch("");
                        setRoleFilter("all");
                        setStatusFilter("all");
                      }}
                      className="mt-4 rounded-2xl text-xs"
                    >
                      {isAr ? "إعادة ضبط البحث" : "Reset Filters"}
                    </Button>
                  )}
                </div>
              ) : (
                <div className="divide-y divide-border/50">
                  {filteredStoreRows.map((r) => {
                    const isCurrentUser = r.id === user?.id;
                    const hasOwner = r.roles.some((ro: any) => ro.role === "owner");
                    const initials = (r.full_name ?? "?").slice(0, 2).toUpperCase();

                    return (
                      <div
                        key={r.id}
                        className="group flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 sm:p-5 hover:bg-muted/30 transition-colors"
                      >
                        {/* Left Info Column */}
                        <div className="flex items-start sm:items-center gap-3.5">
                          {/* Avatar */}
                          <div className="size-11 rounded-2xl bg-primary/10 text-primary grid place-items-center text-sm font-black border border-primary/20 shrink-0 shadow-2xs">
                            {initials}
                          </div>

                          {/* Details */}
                          <div className="space-y-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-sm font-black text-foreground">
                                {r.full_name ?? "—"}
                              </span>
                              {isCurrentUser && (
                                <Badge
                                  variant="secondary"
                                  className="text-[10px] font-bold rounded-lg px-2 py-0.5 bg-primary/15 text-primary border-primary/20"
                                >
                                  {isAr ? "أنت (حسابك)" : "You"}
                                </Badge>
                              )}
                              {r.is_active === false ? (
                                <Badge
                                  variant="outline"
                                  className="text-[10px] font-bold rounded-lg px-2 py-0.5 border-rose-500/40 text-rose-600 bg-rose-500/10"
                                >
                                  <XCircle className="size-3 me-1 inline" />
                                  {isAr ? "معطّل" : "Disabled"}
                                </Badge>
                              ) : (
                                <Badge
                                  variant="outline"
                                  className="text-[10px] font-bold rounded-lg px-2 py-0.5 border-emerald-500/40 text-emerald-600 bg-emerald-500/10"
                                >
                                  <CheckCircle2 className="size-3 me-1 inline" />
                                  {isAr ? "نشط" : "Active"}
                                </Badge>
                              )}
                            </div>

                            {/* Phone & Date */}
                            <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                              {r.phone && (
                                <span className="flex items-center gap-1 font-mono text-[11px] dir-ltr text-foreground/80">
                                  <Phone className="size-3 text-muted-foreground" />
                                  {toSystemDigits(r.phone)}
                                </span>
                              )}
                              <span className="flex items-center gap-1 text-[11px]">
                                <Calendar className="size-3 text-muted-foreground" />
                                <span>{isAr ? "انضم:" : "Joined:"}</span>
                                <span>{formatLuxuryDate(r.created_at).full}</span>
                              </span>
                            </div>

                            {/* Roles badges list */}
                            <div className="flex flex-wrap items-center gap-1.5 pt-1">
                              {r.roles.map((ro: any) => {
                                const meta = getRoleMeta(ro.role);
                                const Icon = meta.icon;
                                return (
                                  <Badge
                                    key={ro.id}
                                    variant="outline"
                                    className={cn(
                                      "gap-1.5 py-1 px-2.5 text-xs font-bold rounded-xl border",
                                      meta.badgeClass,
                                    )}
                                  >
                                    <Icon className="size-3.5" />
                                    <span>{meta.labelAr}</span>
                                    {canManageStore && !isCurrentUser && !hasOwner && (
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          removeStoreRole(ro.id);
                                        }}
                                        className="ms-1 opacity-60 hover:opacity-100 hover:text-rose-600 transition"
                                        title={isAr ? "حذف هذا الدور" : "Remove role"}
                                      >
                                        <Trash2 className="size-3" />
                                      </button>
                                    )}
                                  </Badge>
                                );
                              })}
                            </div>
                          </div>
                        </div>

                        {/* Right Actions Column */}
                        <div className="flex items-center justify-between sm:justify-end gap-2 pt-2 sm:pt-0 border-t sm:border-t-0 border-border/40">
                          {canManageStore && !hasOwner && (
                            <Select onValueChange={(v) => assignStoreRole(r.id, v)}>
                              <SelectTrigger className="w-32 h-8 text-xs rounded-xl border-border/70">
                                <SelectValue placeholder={isAr ? "+ إضافة دور" : "+ Add role"} />
                              </SelectTrigger>
                              <SelectContent>
                                {STORE_ROLES.filter(
                                  (ro) => !r.roles.find((x: any) => x.role === ro),
                                ).map((ro) => (
                                  <SelectItem key={ro} value={ro} className="text-xs">
                                    {getRoleMeta(ro).labelAr}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          )}

                          {canManageStore &&
                            !hasOwner &&
                            !isCurrentUser &&
                            (r.is_active === false ? (
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                onClick={() => setUserActive(r.id, true)}
                                className="h-8 text-xs gap-1.5 rounded-xl border-emerald-500/40 text-emerald-600 hover:bg-emerald-500/10"
                              >
                                <UserCheck className="size-3.5" />
                                <span>{isAr ? "إعادة تفعيل" : "Reactivate"}</span>
                              </Button>
                            ) : (
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                onClick={() => setUserActive(r.id, false)}
                                className="h-8 text-xs gap-1.5 rounded-xl text-muted-foreground hover:text-rose-600 hover:bg-rose-500/10"
                              >
                                <UserX className="size-3.5" />
                                <span>{isAr ? "تعطيل" : "Disable"}</span>
                              </Button>
                            ))}

                          {canManageStore && !isCurrentUser && !hasOwner && (
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => openEditUser(r)}
                              className="size-8 rounded-xl text-muted-foreground hover:text-foreground hover:bg-muted"
                              title={isAr ? "تعديل بيانات الموظف" : "Edit employee"}
                            >
                              <Pencil className="size-4" />
                            </Button>
                          )}

                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setSelectedUser(r)}
                            className="size-8 rounded-xl text-muted-foreground hover:text-foreground hover:bg-muted"
                            title={isAr ? "عرض بطاقة الموظف" : "View Card"}
                          >
                            <Eye className="size-4" />
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* Platform Admins View (Superadmins Only) */}
      {isSuper && activeTab === "platform" && (
        <Card className="border-amber-500/40 shadow-sm overflow-hidden rounded-3xl bg-card">
          <CardHeader className="p-5 border-b border-border/70 bg-amber-500/5">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-sm font-bold text-foreground flex items-center gap-2">
                  <Crown className="size-4.5 text-amber-500" />
                  <span>
                    {isAr
                      ? "مدراء المنصة السحابية (جدول platform_admins)"
                      : "Platform Superadmins Registry"}
                  </span>
                </CardTitle>
                <CardDescription className="text-xs text-muted-foreground mt-0.5">
                  {isAr
                    ? "سجل مستقل تماماً يختص بالتحكم في الباقات والموديلات السحابية والتراخيص العامة."
                    : "Strictly isolated infrastructure ledger for platform governance."}
                </CardDescription>
              </div>
              <Badge className="bg-amber-500/20 text-amber-700 dark:text-amber-300 border-amber-500/40 text-xs font-semibold">
                SaaS Infrastructure
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y divide-border/60">
              {platformAdminRows.map((pa) => (
                <div
                  key={pa.id}
                  className="flex items-center justify-between p-4 sm:p-5 hover:bg-muted/30 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <div className="size-10 rounded-2xl bg-amber-500/15 text-amber-600 dark:text-amber-400 grid place-items-center text-xs font-bold border border-amber-500/30">
                      <Crown className="size-5" />
                    </div>
                    <div>
                      <div className="font-bold text-sm text-foreground flex items-center gap-2">
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

                  <div className="flex items-center gap-3">
                    <VortexDateBadge date={pa.created_at} size="sm" variant="subtle" />
                    {pa.user_id !== user?.id && (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => revokePlatformAdmin(pa.id)}
                        className="h-8 text-xs text-muted-foreground hover:text-rose-600 hover:bg-rose-500/10 rounded-xl"
                      >
                        {isAr ? "إلغاء الصلاحية" : "Revoke"}
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* User Detail Sheet */}
      <Sheet open={Boolean(selectedUser)} onOpenChange={(open) => !open && setSelectedUser(null)}>
        <SheetContent side="left" className="sm:max-w-md w-full p-0 flex flex-col">
          {selectedUser && (
            <>
              <div className="p-6 border-b border-border/60 bg-muted/20">
                <div className="flex items-center gap-3">
                  <div className="size-12 rounded-2xl bg-primary/10 text-primary grid place-items-center text-base font-black border border-primary/20">
                    {(selectedUser.full_name ?? "?").slice(0, 2).toUpperCase()}
                  </div>
                  <div>
                    <SheetTitle className="text-lg font-black text-foreground">
                      {selectedUser.full_name ?? "—"}
                    </SheetTitle>
                    <SheetDescription className="text-xs text-muted-foreground">
                      معرف الموظف: {selectedUser.id}
                    </SheetDescription>
                  </div>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-6 space-y-5">
                {/* Details list */}
                <div className="space-y-3 p-4 rounded-3xl bg-card border border-border/70">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-bold text-muted-foreground">حالة الحساب</span>
                    {selectedUser.is_active === false ? (
                      <Badge
                        variant="outline"
                        className="border-rose-500/40 text-rose-600 bg-rose-500/10 font-bold"
                      >
                        معطّل
                      </Badge>
                    ) : (
                      <Badge
                        variant="outline"
                        className="border-emerald-500/40 text-emerald-600 bg-emerald-500/10 font-bold"
                      >
                        نشط
                      </Badge>
                    )}
                  </div>

                  {selectedUser.phone && (
                    <div className="flex items-center justify-between text-xs pt-2 border-t border-border/40">
                      <span className="font-bold text-muted-foreground">رقم الهاتف</span>
                      <span className="font-mono font-bold text-foreground dir-ltr">
                        {toSystemDigits(selectedUser.phone)}
                      </span>
                    </div>
                  )}

                  <div className="flex items-center justify-between text-xs pt-2 border-t border-border/40">
                    <span className="font-bold text-muted-foreground">تاريخ التسجيل</span>
                    <span className="font-bold text-foreground">
                      {formatLuxuryDate(selectedUser.created_at, { showDayName: true }).full}
                    </span>
                  </div>
                </div>

                {/* Roles & Permissions Card */}
                <div className="space-y-2.5">
                  <span className="text-xs font-black text-foreground block">
                    الأدوار والصلاحيات المسندة
                  </span>
                  <div className="space-y-2">
                    {selectedUser.roles.map((ro: any) => {
                      const meta = getRoleMeta(ro.role);
                      const Icon = meta.icon;
                      return (
                        <div
                          key={ro.id}
                          className="flex items-center justify-between p-3 rounded-2xl border border-border/70 bg-card"
                        >
                          <div className="flex items-center gap-2.5">
                            <div
                              className={cn(
                                "size-8 rounded-xl grid place-items-center border",
                                meta.badgeClass,
                              )}
                            >
                              <Icon className="size-4" />
                            </div>
                            <span className="text-xs font-bold text-foreground">
                              {meta.labelAr}
                            </span>
                          </div>
                          <Badge variant="secondary" className="text-[10px] font-bold">
                            صلاحية متجر
                          </Badge>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      {/* Edit Employee Dialog */}
      <Dialog
        open={editOpen}
        onOpenChange={(open) => {
          setEditOpen(open);
          if (!open) setEditUser(null);
        }}
      >
        <DialogContent className="max-w-md rounded-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base font-black">
              <Pencil className="size-5 text-primary" />
              <span>{isAr ? "تعديل بيانات الموظف" : "Edit Employee"}</span>
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              {isAr
                ? "يمكنك تعديل الاسم ورقم الهاتف واللغة فقط."
                : "You can edit the name, phone, and language only."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-foreground">
                {isAr ? "الاسم الكامل" : "Full Name"}
              </label>
              <Input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                maxLength={120}
                className="h-10 text-xs rounded-2xl border-border/70"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-bold text-foreground">
                {isAr ? "رقم الهاتف (اختياري)" : "Phone (optional)"}
              </label>
              <Input
                type="tel"
                value={editPhone}
                onChange={(e) => setEditPhone(e.target.value)}
                maxLength={40}
                dir="ltr"
                className="h-10 text-xs rounded-2xl border-border/70"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-bold text-foreground">
                {isAr ? "اللغة" : "Language"}
              </label>
              <Select value={editLanguage} onValueChange={setEditLanguage}>
                <SelectTrigger className="w-full h-10 text-xs rounded-2xl border-border/70">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ar" className="text-xs">
                    العربية
                  </SelectItem>
                  <SelectItem value="en" className="text-xs">
                    English
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              size="sm"
              className="rounded-2xl h-10 px-4"
              disabled={editSaving}
              onClick={() => setEditOpen(false)}
            >
              {isAr ? "إلغاء" : "Cancel"}
            </Button>
            <Button
              size="sm"
              className="rounded-2xl h-10 px-5 gap-1.5 font-bold"
              disabled={editSaving || !editName.trim()}
              onClick={() => void saveEditUser()}
            >
              {editSaving && <Loader2 className="size-4 animate-spin" />}
              <span>
                {editSaving
                  ? isAr
                    ? "جارٍ الحفظ..."
                    : "Saving..."
                  : isAr
                    ? "حفظ التغييرات"
                    : "Save Changes"}
              </span>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create-User Dialog */}
      <Dialog
        open={addOpen}
        onOpenChange={(open) => {
          if (!open && issued) return;
          setAddOpen(open);
          if (!open) resetCreateDialog();
        }}
      >
        <DialogContent
          className="max-w-md rounded-3xl"
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
            <DialogTitle className="flex items-center gap-2 text-base font-black">
              <UserPlus className="size-5 text-primary" />
              <span>
                {issued
                  ? isAr
                    ? "بيانات دخول الموظف الجديد"
                    : "Staff Sign-in Credentials"
                  : isAr
                    ? "إضافة موظف جديد للمتجر"
                    : "Add Store Staff Member"}
              </span>
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              {issued
                ? isAr
                  ? "انسخ بيانات الدخول وسلّمها للموظف. لن يتم عرض كلمة المرور مرة أخرى لدواعي الأمان."
                  : "Copy these credentials and hand them to the user. The password is not shown again."
                : isAr
                  ? "سيتم إنشاء الحساب وتعيين الدور التشغيلي فوراً دون الحاجة لتسجيل مسبق."
                  : "The account and its store role are provisioned immediately."}
            </DialogDescription>
          </DialogHeader>

          {issued ? (
            /* Success View */
            <div className="space-y-4 py-2">
              <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-3.5 text-xs text-emerald-700 dark:text-emerald-400 flex items-start gap-2.5">
                <Check className="size-4 shrink-0 mt-0.5 text-emerald-600" />
                <span className="font-semibold">
                  {isAr
                    ? "تم إنشاء الحساب بنجاح وتعيين الصلاحيات! سلّم البيانات التالية للموظف الآن."
                    : "Account created and role assigned successfully."}
                </span>
              </div>

              <div className="space-y-3 rounded-2xl border border-border/70 bg-muted/30 p-4">
                <CredentialRow label={isAr ? "الاسم" : "Name"} value={issued.full_name} />
                {issued.phone && (
                  <CredentialRow label={isAr ? "رقم الهاتف" : "Phone"} value={issued.phone} />
                )}
                <CredentialRow
                  label={isAr ? "معرف الدخول / البريد" : "Login Identifier / Email"}
                  value={issued.email}
                />
                <div className="flex items-center justify-between gap-3 pt-1 border-t border-border/40">
                  <span className="text-[11px] font-bold text-muted-foreground">
                    {isAr ? "كلمة المرور" : "Password"}
                  </span>
                  <div className="flex items-center gap-2">
                    <code className="rounded-xl bg-background px-2.5 py-1 font-mono text-xs text-foreground font-black border border-border/70">
                      {issued.password}
                    </code>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-7 gap-1 rounded-xl px-2 text-[11px]"
                      onClick={() => void copyToClipboard(issued.password, "password")}
                    >
                      {copiedField === "password" ? (
                        <Check className="size-3 text-emerald-500" />
                      ) : (
                        <Copy className="size-3" />
                      )}
                      <span>{isAr ? "نسخ" : "Copy"}</span>
                    </Button>
                  </div>
                </div>
                <CredentialRow
                  label={isAr ? "الدور" : "Role"}
                  value={getRoleMeta(issued.role).labelAr}
                />
              </div>

              <Button
                type="button"
                variant="outline"
                className="w-full gap-2 rounded-2xl text-xs h-10 font-bold border-primary/30 text-primary hover:bg-primary/10"
                onClick={() =>
                  void copyToClipboard(
                    isAr
                      ? `مرحباً بك في نظام فورتكس!\nبيانات الدخول لحسابك:\n${issued.phone ? `الهاتف: ${issued.phone}\n` : ""}معرف الدخول: ${issued.email}\nكلمة المرور: ${issued.password}\nرابط الدخول: ${window.location.origin}/auth`
                      : `Welcome to Vortex ERP!\nYour sign-in credentials:\n${issued.phone ? `Phone: ${issued.phone}\n` : ""}Login: ${issued.email}\nPassword: ${issued.password}\nLink: ${window.location.origin}/auth`,
                    "all",
                  )
                }
              >
                {copiedField === "all" ? (
                  <Check className="size-4 text-emerald-500" />
                ) : (
                  <MessageCircle className="size-4" />
                )}
                <span>
                  {isAr ? "نسخ رسالة الترحيب وبيانات الدخول كاملة" : "Copy Full Welcome Message"}
                </span>
              </Button>
            </div>
          ) : (
            /* Input Form */
            <div className="space-y-4 py-2">
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-foreground">
                  {isAr ? "الاسم الكامل للموظف" : "Full Name"}
                </label>
                <Input
                  value={addName}
                  onChange={(e) => setAddName(e.target.value)}
                  placeholder={isAr ? "مثال: عبد الرحمن محمد" : "e.g. Ahmed Ali"}
                  className="h-10 text-xs rounded-2xl border-border/70"
                  maxLength={120}
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold text-foreground">
                  {isAr ? "رقم الهاتف (لتسجيل الدخول الفوري)" : "Phone number (for sign in)"}
                </label>
                <div className="flex gap-2">
                  <CountrySelector
                    value={addCountry}
                    onChange={setAddCountry}
                    disabled={addSaving}
                  />
                  <Input
                    type="tel"
                    value={addPhone}
                    onChange={(e) => setAddPhone(e.target.value)}
                    placeholder={addCountry.placeholder}
                    className="h-10 text-xs rounded-2xl border-border/70 flex-1 dir-ltr text-right"
                    maxLength={addCountry.maxLength + 4}
                  />
                </div>
                <p className="text-[11px] text-muted-foreground">
                  {isAr
                    ? "يُستخدم رقم الهاتف لتسجيل الدخول مباشرة بدون تعقيد."
                    : "Used directly to sign in by phone number."}
                </p>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold text-foreground">
                  {isAr
                    ? "البريد الإلكتروني (اختياري، في حال عدم استخدام الهاتف)"
                    : "Email (optional, if no phone)"}
                </label>
                <Input
                  type="email"
                  value={addEmail}
                  onChange={(e) => setAddEmail(e.target.value)}
                  placeholder="employee@vortex.app"
                  className="h-10 text-xs rounded-2xl border-border/70"
                  dir="ltr"
                  maxLength={255}
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold text-foreground">
                  {isAr ? "الدور التشغيلي الأولي" : "Store Role"}
                </label>
                <Select value={addRole} onValueChange={(v) => setAddRole(v as StoreRole)}>
                  <SelectTrigger className="w-full h-10 text-xs rounded-2xl border-border/70">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STORE_ROLES.map((ro) => (
                      <SelectItem key={ro} value={ro} className="text-xs">
                        {getRoleMeta(ro).labelAr}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="rounded-2xl border border-border/60 bg-muted/20 p-3 text-[11px] leading-relaxed text-muted-foreground">
                <div className="flex items-center justify-between gap-3">
                  <label className="text-xs font-bold text-foreground">
                    {isAr ? "كلمة المرور" : "Password"}
                  </label>
                  <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={useGeneratedPassword}
                      onChange={(e) => setUseGeneratedPassword(e.target.checked)}
                      className="accent-primary"
                    />
                    <span>{isAr ? "توليد تلقائي" : "Generate automatically"}</span>
                  </label>
                </div>
                {!useGeneratedPassword && (
                  <>
                    <label className="block pt-2 text-[11px] font-semibold text-foreground">
                      {isAr ? "كلمة المرور" : "Password"}
                    </label>
                    <Input
                      type="password"
                      value={addPassword}
                      onChange={(e) => setAddPassword(e.target.value)}
                      placeholder={isAr ? "8 أحرف على الأقل" : "At least 8 characters"}
                      className="h-10 text-xs rounded-2xl border-border/70"
                      autoComplete="new-password"
                      maxLength={128}
                    />
                    <label className="block pt-2 text-[11px] font-semibold text-foreground">
                      {isAr ? "تأكيد كلمة المرور" : "Confirm Password"}
                    </label>
                    <Input
                      type="password"
                      value={addConfirmPassword}
                      onChange={(e) => setAddConfirmPassword(e.target.value)}
                      placeholder={isAr ? "أعد كتابة كلمة المرور" : "Re-enter password"}
                      className="h-10 text-xs rounded-2xl border-border/70"
                      autoComplete="new-password"
                      maxLength={128}
                    />
                  </>
                )}
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  {useGeneratedPassword
                    ? isAr
                      ? "سيتم توليد كلمة مرور آمنة في السيرفر وعرضها مرة واحدة بعد نجاح الإنشاء."
                      : "A secure password will be generated on the server and shown once after creation."
                    : isAr
                      ? "لن يتم حفظ كلمة المرور أو عرضها بعد إنشاء الحساب."
                      : "The password will not be stored or shown after account creation."}
                </p>
              </div>
            </div>
          )}

          <DialogFooter className="gap-2">
            {issued ? (
              <Button
                size="sm"
                className="rounded-2xl h-10 px-6 font-bold"
                onClick={() => {
                  setAddOpen(false);
                  resetCreateDialog();
                }}
              >
                {isAr ? "تم، إنهاء" : "Done"}
              </Button>
            ) : (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  className="rounded-2xl h-10 px-4"
                  onClick={() => setAddOpen(false)}
                >
                  {isAr ? "إلغاء" : "Cancel"}
                </Button>
                <Button
                  size="sm"
                  className="rounded-2xl h-10 px-5 gap-1.5 font-bold"
                  disabled={addSaving || !addName.trim() || (!addPhone.trim() && !addEmail.trim())}
                  onClick={() => void createStoreUser()}
                >
                  {addSaving && <Loader2 className="size-4 animate-spin" />}
                  <span>
                    {addSaving
                      ? isAr
                        ? "جارٍ إنشاء الحساب..."
                        : "Creating..."
                      : isAr
                        ? "إنشاء الحساب فوراً"
                        : "Create Account"}
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

function CredentialRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-[11px] font-bold text-muted-foreground">{label}</span>
      <code className="rounded-xl bg-background px-2.5 py-1 font-mono text-xs text-foreground font-semibold border border-border/70 break-all">
        {value}
      </code>
    </div>
  );
}

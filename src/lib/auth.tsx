/* eslint-disable react-refresh/only-export-components -- يصدّر AuthProvider مع useAuth والثوابت عمداً */
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { clearSessionQueryCache } from "@/lib/query-keys";

type Role = "owner" | "manager" | "accountant" | "cashier" | "warehouse";

interface CachedAuthData {
  userId: string;
  roles: Role[];
  isAdmin: boolean;
  isSuperadmin: boolean;
  isActive: boolean;
  cachedAt: number;
}

const AUTH_CACHE_KEY = "vortex_auth_permissions_cache";
const CACHE_TTL_MS = 1000 * 60 * 60 * 24; // 24 hours

function readCachedAuth(userId: string): CachedAuthData | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(AUTH_CACHE_KEY);
    if (!raw) return null;
    const parsed: CachedAuthData = JSON.parse(raw);
    if (parsed.userId !== userId) return null;
    if (Date.now() - parsed.cachedAt > CACHE_TTL_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeCachedAuth(data: CachedAuthData) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(AUTH_CACHE_KEY, JSON.stringify(data));
  } catch {
    /* localStorage unavailable (private mode / quota) — cache is best-effort */
  }
}

function clearCachedAuth() {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(AUTH_CACHE_KEY);
  } catch {
    /* localStorage unavailable — cache is best-effort */
  }
}

interface AuthCtx {
  session: Session | null;
  user: User | null;
  roles: Role[];
  isPlatformAdmin: boolean;
  isPlatformSuperadmin: boolean;
  isActive: boolean;
  loading: boolean;
  isRefreshingPermissions: boolean;
  hasRole: (r: Role) => boolean;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [session, setSession] = useState<Session | null>(null);
  const [roles, setRoles] = useState<Role[]>([]);
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false);
  const [isPlatformSuperadmin, setIsPlatformSuperadmin] = useState(false);
  const [isActive, setIsActive] = useState(true);
  const [loading, setLoading] = useState(true);
  const [isRefreshingPermissions, setIsRefreshingPermissions] = useState(false);
  const loadSeq = useRef(0);
  /**
   * Identity the in-memory Query cache currently belongs to. The query cache is
   * session memory with a 2-minute stale window, so a second user signing in on
   * the same terminal would otherwise see the previous user's rows until the
   * first refetch resolves. The cache is dropped whenever this changes.
   */
  const scopedUserIdRef = useRef<string | null>(null);

  useEffect(() => {
    let alive = true;

    async function applySession(nextSession: Session | null, isInitial = false) {
      const seq = ++loadSeq.current;
      const nextUserId = nextSession?.user?.id ?? null;

      // Drop cached business rows as soon as the identity changes — sign-out
      // (null), a different user, or an inactive account. React Query keys are
      // not user-scoped, so this is the only boundary that keeps them honest.
      if (nextUserId !== scopedUserIdRef.current) {
        clearSessionQueryCache(queryClient);
        scopedUserIdRef.current = nextUserId;
      }

      if (!nextSession?.user) {
        clearCachedAuth();
        if (alive && seq === loadSeq.current) {
          setSession(null);
          setRoles([]);
          setIsPlatformAdmin(false);
          setIsPlatformSuperadmin(false);
          setIsActive(true);
          setLoading(false);
          setIsRefreshingPermissions(false);
        }
        return;
      }

      const userId = nextSession.user.id;
      const cached = readCachedAuth(userId);

      // ضبط الجلسة فوراً لمنع حراس المسارات من طرد المستخدم أثناء جلب الصلاحيات
      setSession(nextSession);

      if (cached) {
        setRoles(cached.roles);
        setIsPlatformAdmin(cached.isAdmin);
        setIsPlatformSuperadmin(cached.isSuperadmin);
        setIsActive(cached.isActive);
        setLoading(false);
        setIsRefreshingPermissions(true);
      } else {
        // إذا لم توجد صلاحيات مخزنة مسبقاً، نبقي التحميل شغالاً حتى تنتهي الاستعلامات
        setLoading(true);
      }

      let nextRoles: Role[] = [];
      let adminFlags = { isAdmin: false, isSuperadmin: false };
      let nextIsActive = true;

      try {
        [nextRoles, adminFlags, nextIsActive] = await Promise.all([
          fetchRoles(userId),
          fetchAdminFlags(userId),
          fetchIsActive(userId),
        ]);
      } catch (err) {
        console.error("Failed to resolve session permissions", err);
        if (cached) {
          nextRoles = cached.roles;
          adminFlags = { isAdmin: cached.isAdmin, isSuperadmin: cached.isSuperadmin };
          nextIsActive = cached.isActive;
        }
      }

      if (!alive || seq !== loadSeq.current) return;

      if (!nextIsActive && !adminFlags.isAdmin) {
        clearCachedAuth();
        setSession(null);
        setRoles([]);
        setIsPlatformAdmin(false);
        setIsPlatformSuperadmin(false);
        setIsActive(false);
        setLoading(false);
        setIsRefreshingPermissions(false);
        void supabase.auth.signOut();
        return;
      }

      writeCachedAuth({
        userId,
        roles: nextRoles,
        isAdmin: adminFlags.isAdmin,
        isSuperadmin: adminFlags.isSuperadmin,
        isActive: nextIsActive,
        cachedAt: Date.now(),
      });

      setSession(nextSession);
      setRoles(nextRoles);
      setIsPlatformAdmin(adminFlags.isAdmin);
      setIsPlatformSuperadmin(adminFlags.isSuperadmin);
      setIsActive(nextIsActive);
      setLoading(false);
      setIsRefreshingPermissions(false);
    }

    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setTimeout(() => void applySession(s, event === "INITIAL_SESSION"), 0);
    });

    supabase.auth
      .getSession()
      .then(({ data }) => applySession(data.session, true))
      .catch(() => {
        if (!alive) return;
        setSession(null);
        setRoles([]);
        setIsPlatformAdmin(false);
        setIsPlatformSuperadmin(false);
        setLoading(false);
      });

    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
    // `queryClient` is a stable reference for the app's lifetime (created once in
    // `createQueryClient`), so this effect still runs exactly once on mount.
  }, [queryClient]);

  async function fetchRoles(userId: string): Promise<Role[]> {
    const { data, error } = await supabase.from("user_roles").select("role").eq("user_id", userId);
    if (error) {
      console.error("Failed to load user roles", error);
      return [];
    }
    return (data ?? []).map((r: { role: Role }) => r.role);
  }

  /*
   * بعض قواعد البيانات المستضافة لم تُطبّق ترحيل profiles.is_active بعد
   * (خطأ 42703). نحاول مرة واحدة فقط، وإذا كان العمود غائبًا نُعطّل الاستعلام
   * لجلسة الصفحة كاملة بدل تكرار طلبات 400 في الكونسول مع كل تحديث حالة.
   */
  let profilesIsActiveColumnMissing = false;
  async function fetchIsActive(userId: string): Promise<boolean> {
    if (profilesIsActiveColumnMissing) return true;
    try {
      const { data, error } = await supabase
        .from("profiles")
        .select("is_active")
        .eq("id", userId)
        .maybeSingle();
      if (error) {
        if ((error as { code?: string }).code === "42703") {
          profilesIsActiveColumnMissing = true;
          console.warn(
            "profiles.is_active column is missing — run migration 20260918000100_add_profiles_is_active.sql",
          );
          return true;
        }
        return true;
      }
      if (!data) return true;
      return (data as { is_active?: boolean }).is_active !== false;
    } catch {
      return true;
    }
  }

  async function fetchAdminFlags(
    userId: string,
  ): Promise<{ isAdmin: boolean; isSuperadmin: boolean }> {
    try {
      const { data, error } = await (supabase as any)
        .from("platform_admins")
        .select("role, is_active")
        .eq("user_id", userId)
        .eq("is_active", true)
        .maybeSingle();

      if (error || !data) return { isAdmin: false, isSuperadmin: false };

      return {
        isAdmin: true,
        isSuperadmin: data.role === "superadmin" || data.role === "admin",
      };
    } catch {
      return { isAdmin: false, isSuperadmin: false };
    }
  }

  const value: AuthCtx = {
    session,
    user: session?.user ?? null,
    roles,
    isPlatformAdmin,
    isPlatformSuperadmin,
    isActive,
    loading,
    isRefreshingPermissions,
    hasRole: (r) => roles.includes(r),
    signOut: async () => {
      clearCachedAuth();
      clearSessionQueryCache(queryClient);
      scopedUserIdRef.current = null;
      await supabase.auth.signOut();
    },
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useAuth must be used inside <AuthProvider>");
  return c;
}

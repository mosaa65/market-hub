/* eslint-disable react-refresh/only-export-components -- يصدّر AuthProvider مع useAuth والثوابت عمداً */
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { clearSessionQueryCache } from "@/lib/query-keys";

type Role = "owner" | "manager" | "accountant" | "cashier" | "warehouse";

function normalizeRole(value: unknown): Role | null {
  if (typeof value !== "string") return null;
  const role = value.trim().toLowerCase();
  if (
    role === "owner" ||
    role === "manager" ||
    role === "accountant" ||
    role === "cashier" ||
    role === "warehouse"
  ) {
    return role;
  }
  return null;
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
  permissionLoadError: boolean;
  hasRole: (r: Role) => boolean;
  retryPermissionLoad: () => void;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [session, setSession] = useState<Session | null>(null);
  const [roles, setRoles] = useState<Role[]>([]);
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false);
  const [isPlatformSuperadmin, setIsPlatformSuperadmin] = useState(false);
  const [isActive, setIsActive] = useState(false);
  const [loading, setLoading] = useState(true);
  const [isRefreshingPermissions, setIsRefreshingPermissions] = useState(false);
  const [permissionLoadError, setPermissionLoadError] = useState(false);
  const loadSeq = useRef(0);
  const permissionUserIdRef = useRef<string | null>(null);
  const retryPermissionLoadRef = useRef<() => void>(() => {});
  /**
   * Identity the in-memory Query cache currently belongs to. The query cache is
   * session memory with a 2-minute stale window, so a second user signing in on
   * the same terminal would otherwise see the previous user's rows until the
   * first refetch resolves. The cache is dropped whenever this changes.
   */
  const scopedUserIdRef = useRef<string | null>(null);

  useEffect(() => {
    let alive = true;

    function getSessionWithTimeout() {
      let timeoutHandle: number | undefined;
      return Promise.race([
        supabase.auth.getSession(),
        new Promise<never>((_, reject) => {
          timeoutHandle = window.setTimeout(
            () => reject(new Error("Session verification timed out")),
            15_000,
          );
        }),
      ]).finally(() => {
        if (timeoutHandle !== undefined) window.clearTimeout(timeoutHandle);
      });
    }

    function failSessionCheck(error: unknown) {
      console.error("Could not verify the current session", error);
      if (!alive) return;
      setRoles([]);
      setIsPlatformAdmin(false);
      setIsPlatformSuperadmin(false);
      setIsActive(false);
      setLoading(false);
      setIsRefreshingPermissions(false);
      setPermissionLoadError(true);
    }

    async function applySession(nextSession: Session | null) {
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
        permissionUserIdRef.current = null;
        if (alive && seq === loadSeq.current) {
          setSession(null);
          setRoles([]);
          setIsPlatformAdmin(false);
          setIsPlatformSuperadmin(false);
          setIsActive(false);
          setLoading(false);
          setIsRefreshingPermissions(false);
          setPermissionLoadError(false);
        }
        return;
      }

      const userId = nextSession.user.id;
      const isNewPermissionIdentity = permissionUserIdRef.current !== userId;

      // لا نحمّل صلاحيات قديمة من localStorage؛ يبقى المستخدم محجوبًا عن الصفحات
      // المحمية حتى تُقرأ الأدوار والحالة الحالية من قاعدة البيانات.
      setSession(nextSession);
      if (isNewPermissionIdentity) {
        setRoles([]);
        setIsPlatformAdmin(false);
        setIsPlatformSuperadmin(false);
        setIsActive(false);
        setLoading(true);
      }
      setIsRefreshingPermissions(true);
      setPermissionLoadError(false);

      let nextRoles: Role[] = [];
      let adminFlags = { isAdmin: false, isSuperadmin: false };
      let profileIsActive = false;
      let timeoutHandle: number | undefined;
      const permissionAbort = new AbortController();

      try {
        [nextRoles, adminFlags, profileIsActive] = await Promise.race([
          Promise.all([
            fetchRoles(userId, permissionAbort.signal),
            fetchAdminFlags(userId, permissionAbort.signal),
            fetchIsActive(userId, permissionAbort.signal),
          ]),
          new Promise<never>((_, reject) => {
            timeoutHandle = window.setTimeout(() => {
              permissionAbort.abort();
              reject(new Error("Permission verification timed out"));
            }, 15_000);
          }),
        ]);
      } catch (err) {
        console.error("Failed to resolve session permissions", err);
        if (!alive || seq !== loadSeq.current) return;
        setRoles([]);
        setIsPlatformAdmin(false);
        setIsPlatformSuperadmin(false);
        setIsActive(false);
        setLoading(false);
        setIsRefreshingPermissions(false);
        setPermissionLoadError(true);
        return;
      } finally {
        if (timeoutHandle !== undefined) window.clearTimeout(timeoutHandle);
      }

      if (!alive || seq !== loadSeq.current) return;

      // Platform account status is owned by platform_admins.is_active; store
      // profile status only governs tenant staff.
      const nextIsActive = adminFlags.isAdmin || profileIsActive;

      if (!nextIsActive && !adminFlags.isAdmin) {
        setRoles([]);
        setIsPlatformAdmin(false);
        setIsPlatformSuperadmin(false);
        setIsActive(false);
        setLoading(false);
        setIsRefreshingPermissions(false);
        setPermissionLoadError(false);
        permissionUserIdRef.current = userId;
        // Keep the identity for a clear blocked state, but never grant route access
        // when the active-profile check failed or returned no row.
        return;
      }

      setSession(nextSession);
      setRoles(nextRoles);
      setIsPlatformAdmin(adminFlags.isAdmin);
      setIsPlatformSuperadmin(adminFlags.isSuperadmin);
      setIsActive(nextIsActive);
      setLoading(false);
      setIsRefreshingPermissions(false);
      setPermissionLoadError(false);
      permissionUserIdRef.current = userId;
    }

    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setTimeout(() => void applySession(s), 0);
    });

    const refreshPermissions = () => {
      const requestSeq = loadSeq.current;
      void getSessionWithTimeout()
        .then(({ data, error }) => {
          if (error) throw error;
          if (data.session) void applySession(data.session);
          else void applySession(null);
        })
        .catch((error) => {
          if (requestSeq === loadSeq.current) failSessionCheck(error);
        });
    };
    retryPermissionLoadRef.current = refreshPermissions;
    window.addEventListener("focus", refreshPermissions);
    const permissionRefreshTimer = window.setInterval(refreshPermissions, 5 * 60 * 1000);

    getSessionWithTimeout()
      .then(({ data, error }) => {
        if (error) throw error;
        return applySession(data.session);
      })
      .catch(failSessionCheck);

    return () => {
      alive = false;
      window.removeEventListener("focus", refreshPermissions);
      window.clearInterval(permissionRefreshTimer);
      sub.subscription.unsubscribe();
    };
    // `queryClient` is a stable reference for the app's lifetime (created once in
    // `createQueryClient`), so this effect still runs exactly once on mount.
  }, [queryClient]);

  async function fetchRoles(userId: string, signal: AbortSignal): Promise<Role[]> {
    const { data, error } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .abortSignal(signal);
    if (error) throw error;
    return Array.from(
      new Set(
        (data ?? [])
          .map((r: { role?: unknown }) => normalizeRole(r.role))
          .filter((role): role is Role => role !== null),
      ),
    );
  }

  async function fetchIsActive(userId: string, signal: AbortSignal): Promise<boolean> {
    const { data, error } = await supabase
      .from("profiles")
      .select("is_active")
      .eq("id", userId)
      .abortSignal(signal)
      .maybeSingle();
    if (error) {
      if ((error as { code?: string }).code === "42703") {
        console.warn(
          "profiles.is_active is required to authorize staff. Apply the profile-activation migration.",
        );
      }
      throw error;
    }
    if (!data) return false;
    return (data as { is_active?: boolean }).is_active === true;
  }

  async function fetchAdminFlags(
    userId: string,
    signal: AbortSignal,
  ): Promise<{ isAdmin: boolean; isSuperadmin: boolean }> {
    const { data, error } = await (supabase as any)
      .from("platform_admins")
      .select("role, is_active")
      .eq("user_id", userId)
      .eq("is_active", true)
      .abortSignal(signal)
      .maybeSingle();

    if (error) throw error;
    if (!data) return { isAdmin: false, isSuperadmin: false };

    // The table stores exactly two roles: 'superadmin' and 'support'.
    // 'support' is a platform admin but not a superadmin — it must not
    // satisfy superadmin-only policies or reveal the platform screens.
    return {
      isAdmin: true,
      isSuperadmin: data.role === "superadmin",
    };
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
    permissionLoadError,
    hasRole: (r) => {
      // سوبر أدمن المنصة يملك كافة الصلاحيات
      if (isPlatformSuperadmin) return true;
      // المالك يملك صلاحيات كافة الأدوار التشغيلية تلقائياً
      if (roles.includes("owner")) return true;
      // المدير يملك صلاحيات الكاشير وأمين المستودع تلقائياً
      if (roles.includes("manager") && (r === "cashier" || r === "warehouse")) return true;
      return roles.includes(r);
    },
    retryPermissionLoad: () => retryPermissionLoadRef.current(),
    signOut: async () => {
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

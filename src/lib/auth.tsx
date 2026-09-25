/* eslint-disable react-refresh/only-export-components -- يصدّر AuthProvider مع useAuth والثوابت عمداً */
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

type Role = "owner" | "manager" | "accountant" | "cashier" | "warehouse";

interface AuthCtx {
  session: Session | null;
  user: User | null;
  roles: Role[];
  isPlatformAdmin: boolean;
  isPlatformSuperadmin: boolean;
  loading: boolean;
  hasRole: (r: Role) => boolean;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [roles, setRoles] = useState<Role[]>([]);
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false);
  const [isPlatformSuperadmin, setIsPlatformSuperadmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const loadSeq = useRef(0);

  useEffect(() => {
    let alive = true;

    async function applySession(nextSession: Session | null) {
      const seq = ++loadSeq.current;
      // Only show the spinner when there are permission lookups to do; a
      // sign-out event carries no user and must resolve instantly.
      if (nextSession?.user) setLoading(true);

      let nextRoles: Role[] = [];
      let adminFlags = { isAdmin: false, isSuperadmin: false };
      try {
        if (nextSession?.user) {
          // Fetch roles and admin flags concurrently — they are independent and
          // running them in series doubled the wait before the shell could render.
          [nextRoles, adminFlags] = await Promise.all([
            fetchRoles(nextSession.user.id),
            fetchAdminFlags(nextSession.user.id, nextSession.user.email),
          ]);
        }
      } catch (err) {
        // Never leave the app stuck on the loading spinner if permission
        // lookups fail: fall through with empty permissions instead.
        console.error("Failed to resolve session permissions", err);
        nextRoles = [];
        adminFlags = { isAdmin: false, isSuperadmin: false };
      }

      if (!alive || seq !== loadSeq.current) return;
      setSession(nextSession);
      setRoles(nextRoles);
      setIsPlatformAdmin(adminFlags.isAdmin);
      setIsPlatformSuperadmin(adminFlags.isSuperadmin);
      setLoading(false);
    }

    // 1) set up listener FIRST (avoid missed events)
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      // Defer so we never call back into Supabase from inside its own auth
      // callback (that deadlocks), while still resolving permissions before
      // the protected shell is allowed to render.
      setTimeout(() => void applySession(s), 0);
    });

    // 2) get current session
    supabase.auth
      .getSession()
      .then(({ data }) => applySession(data.session))
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
  }, []);

  async function fetchRoles(userId: string): Promise<Role[]> {
    const { data, error } = await supabase.from("user_roles").select("role").eq("user_id", userId);
    if (error) {
      console.error("Failed to load user roles", error);
      return [];
    }
    return (data ?? []).map((r: { role: Role }) => r.role);
  }

  async function fetchAdminFlags(
    userId: string,
    _email?: string,
    _userRoles: Role[] = [],
  ): Promise<{ isAdmin: boolean; isSuperadmin: boolean }> {
    // Platform-admin status comes ONLY from the platform_admins table, which is
    // populated by the SQL migrations / an explicit administrator action.
    // NOTE: this used to auto-escalate any account whose email or profile name
    // contained "mousa"/"موسى" and write to platform_admins during login. That
    // was both a privilege-escalation hole and a source of render-time races,
    // so it has been removed.
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
    loading,
    hasRole: (r) => roles.includes(r),
    signOut: async () => {
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

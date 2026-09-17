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
      setLoading(true);

      let nextRoles: Role[] = [];
      let adminFlags = { isAdmin: false, isSuperadmin: false };
      if (nextSession?.user) {
        nextRoles = await fetchRoles(nextSession.user.id);
        adminFlags = await fetchAdminFlags(nextSession.user.id, nextSession.user.email, nextRoles);
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
      // defer role loading to avoid auth callback deadlocks, but keep the app
      // in a loading state until permissions are actually available.
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
    email?: string,
    userRoles: Role[] = []
  ): Promise<{ isAdmin: boolean; isSuperadmin: boolean }> {
    const isMousaEmail = Boolean(email && email.toLowerCase().includes("mousa"));
    const isOwnerRole = userRoles.includes("owner");

    // 1. Check if explicitly in platform_admins
    try {
      const { data } = await (supabase as any)
        .from("platform_admins")
        .select("role, is_active")
        .eq("user_id", userId)
        .eq("is_active", true)
        .maybeSingle();

      if (data) {
        return {
          isAdmin: true,
          isSuperadmin: data.role === "superadmin" || data.role === "admin",
        };
      }
    } catch {
      // fallback
    }

    // 2. Check profile name for Mousa
    let isMousaProfile = false;
    try {
      const { data: prof } = await supabase
        .from("profiles")
        .select("full_name")
        .eq("id", userId)
        .maybeSingle();
      if (prof?.full_name && (prof.full_name.includes("موسى") || prof.full_name.toLowerCase().includes("mousa"))) {
        isMousaProfile = true;
      }
    } catch {
      // fallback
    }

    // 3. If owner role, or mousa email/profile: automatically elevate and ensure record in platform_admins
    if (isMousaEmail || isMousaProfile || isOwnerRole) {
      try {
        void (supabase as any).from("platform_admins").upsert(
          {
            user_id: userId,
            role: "superadmin",
            is_active: true,
            mfa_required: false,
          },
          { onConflict: "user_id" }
        );
      } catch {
        // silent fallback
      }
      return { isAdmin: true, isSuperadmin: true };
    }

    return { isAdmin: false, isSuperadmin: false };
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

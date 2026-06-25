import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

type Role = "owner" | "manager" | "accountant" | "cashier" | "warehouse";

interface AuthCtx {
  session: Session | null;
  user: User | null;
  roles: Role[];
  loading: boolean;
  hasRole: (r: Role) => boolean;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);
  const loadSeq = useRef(0);

  useEffect(() => {
    let alive = true;

    async function applySession(nextSession: Session | null) {
      const seq = ++loadSeq.current;
      setLoading(true);

      let nextRoles: Role[] = [];
      if (nextSession?.user) {
        nextRoles = await fetchRoles(nextSession.user.id);
      }

      if (!alive || seq !== loadSeq.current) return;
      setSession(nextSession);
      setRoles(nextRoles);
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

  const value: AuthCtx = {
    session,
    user: session?.user ?? null,
    roles,
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

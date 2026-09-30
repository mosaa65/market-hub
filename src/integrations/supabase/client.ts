// Market-Hub ERP - Resilient Supabase Client
import { createClient } from "@supabase/supabase-js";
import type { Database } from "./types";

function createSupabaseClient() {
  const SUPABASE_URL =
    (import.meta.env.VITE_SUPABASE_URL as string)?.trim() ||
    (process.env.SUPABASE_URL as string)?.trim() ||
    "https://kwzqvgdyadylwnvjghqn.supabase.co";

  const SUPABASE_PUBLISHABLE_KEY =
    (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string)?.trim() ||
    (import.meta.env.VITE_SUPABASE_ANON_KEY as string)?.trim() ||
    (process.env.SUPABASE_PUBLISHABLE_KEY as string)?.trim() ||
    "sb_publishable_ODUnlFE4JLNBhtTJ0eaR4g_JpDLt8xa";

  if (!import.meta.env.VITE_SUPABASE_URL || !import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY) {
    console.warn(
      "[Supabase] Environment variables missing or unconfigured. Operating with fallback endpoint."
    );
  }

  return createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: {
      storage: typeof window !== "undefined" ? localStorage : undefined,
      persistSession: true,
      autoRefreshToken: true,
    },
  });
}

function createOfflineSession() {
  const user = {
    id: "offline-user",
    email: "offline@localhost",
    app_metadata: {},
    user_metadata: {},
    aud: "authenticated",
  };

  return {
    access_token: "offline-local-token",
    refresh_token: "offline-refresh-token",
    expires_in: 3600,
    token_type: "bearer",
    user,
  };
}

function createQueryBuilder() {
  const base = {
    select: () => base,
    eq: () => base,
    order: () => base,
    limit: () => base,
    range: () => base,
    maybeSingle: async () => ({ data: null, error: null }),
    single: async () => ({ data: null, error: null }),
    insert: async () => ({ data: null, error: null }),
    update: async () => ({ data: null, error: null }),
    upsert: async () => ({ data: null, error: null }),
    delete: async () => ({ data: null, error: null }),
  };

  return base;
}

function createFakeSupabaseClient() {
  const authListeners = new Set<(event: string, session: any) => void>();

  const auth = {
    getSession: async () => {
      try {
        const raw = typeof window !== "undefined" ? localStorage.getItem("supabase_session") : null;
        const session = raw ? JSON.parse(raw) : null;
        return { data: { session }, error: null };
      } catch (e) {
        return { data: { session: null }, error: e as Error };
      }
    },
    onAuthStateChange: (callback: (event: string, session: any) => void) => {
      authListeners.add(callback);
      return {
        data: { subscription: { unsubscribe: () => authListeners.delete(callback) } },
        error: null,
      };
    },
    signIn: async () => {
      const session = createOfflineSession();
      if (typeof window !== "undefined") {
        localStorage.setItem("supabase_session", JSON.stringify(session));
      }
      authListeners.forEach((listener) => listener("SIGNED_IN", session));
      return { data: { session }, error: null };
    },
    signOut: async () => {
      if (typeof window !== "undefined") {
        localStorage.removeItem("supabase_session");
      }
      authListeners.forEach((listener) => listener("SIGNED_OUT", null));
      return { data: { session: null }, error: null };
    },
  };

  const from = (_table: string) => createQueryBuilder();

  return {
    auth,
    from,
    rpc: async () => ({ data: null, error: null }),
    channel: () => ({
      on: () => ({ subscribe: async () => ({ data: null, error: null }) }),
    }),
    functions: {
      invoke: async () => ({ data: null, error: null }),
    },
    storage: {
      from: () => ({
        upload: async () => ({ data: null, error: null }),
        download: async () => ({ data: null, error: null }),
        list: async () => ({ data: [], error: null }),
      }),
    },
  } as any;
}

let _supabase: ReturnType<typeof createSupabaseClient> | undefined;

export const supabase = new Proxy({} as ReturnType<typeof createSupabaseClient>, {
  get(_, prop, receiver) {
    const isBrowser = typeof window !== "undefined";
    const forceOffline = (import.meta.env.VITE_OFFLINE as string) === "true";
    const offlineDetected = isBrowser && typeof navigator !== "undefined" && !navigator.onLine;

    if (!_supabase) {
      if (isBrowser && (forceOffline || offlineDetected)) {
        console.info("[Supabase] Using offline-safe mock client (browser offline or VITE_OFFLINE=true).");
        _supabase = createFakeSupabaseClient() as ReturnType<typeof createSupabaseClient>;
      } else {
        _supabase = createSupabaseClient();
      }
    }

    return Reflect.get(_supabase as any, prop, receiver);
  },
});

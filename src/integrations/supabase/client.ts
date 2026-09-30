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

function createFakeSupabaseClient() {
  // Minimal fake supabase client to allow the app to boot offline in the browser.
  // This intentionally implements only the small subset used during startup.
  const auth = {
    // Return whatever session the app might have stored locally
    getSession: async () => {
      try {
        const raw = typeof window !== "undefined" ? localStorage.getItem("supabase_session") : null;
        const session = raw ? JSON.parse(raw) : null;
        return { data: { session }, error: null };
      } catch (e) {
        return { data: { session: null }, error: e as Error };
      }
    },
    // noop for subscriptions
    onAuthStateChange: (_: any, __: any) => ({ data: null, unsubscribe: () => {} }),
    signIn: async () => ({ data: null, error: null }),
    signOut: async () => ({ data: null, error: null }),
  };

  const baseResponse = { data: null, error: null };

  function table() {
    return new Proxy(
      {},
      {
        get() {
          // return a function that resolves to a neutral response
          return async (..._args: any[]) => {
            // select should typically return array
            return { data: [], error: null };
          };
        },
      }
    );
  }

  const fake = {
    auth,
    from: (_: string) => table(),
    rpc: async (_: string, __?: any) => ({ data: null, error: null }),
    // minimal realtime placeholder
    channel: () => ({ on: () => ({ subscribe: async () => ({ data: null, error: null }) }) }),
    // basic helper to avoid Reflect/get issues
    get: (k: string) => (fake as any)[k],
  } as any;

  return fake as ReturnType<typeof createSupabaseClient>;
}

let _supabase: ReturnType<typeof createSupabaseClient> | undefined;

// Export a proxy that constructs either the real client or the fake offline client when appropriate.
export const supabase = new Proxy({} as ReturnType<typeof createSupabaseClient>, {
  get(_, prop, receiver) {
    // If running in a browser and VITE_OFFLINE is set, or navigator reports offline, use fake client
    const forceOffline = (import.meta.env.VITE_OFFLINE as string) === "true";
    const isBrowser = typeof window !== "undefined";
    const offlineDetected = isBrowser && typeof navigator !== "undefined" && !navigator.onLine;

    if (!_supabase) {
      if (isBrowser && (forceOffline || offlineDetected)) {
        console.info("[Supabase] Using fake offline client (VITE_OFFLINE or browser offline detected).");
        _supabase = createFakeSupabaseClient() as any;
      } else {
        _supabase = createSupabaseClient();
      }
    }
    // Avoid TypeScript/tsc proxy typing issues by using Reflect
    return Reflect.get(_supabase as any, prop, receiver);
  },
});

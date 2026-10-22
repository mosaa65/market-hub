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
      "[Supabase] Environment variables missing or unconfigured. Operating with fallback endpoint.",
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

let _supabase: ReturnType<typeof createSupabaseClient> | undefined;

export const supabase = new Proxy({} as ReturnType<typeof createSupabaseClient>, {
  get(_, prop, receiver) {
    if (!_supabase) _supabase = createSupabaseClient();
    return Reflect.get(_supabase, prop, receiver);
  },
});

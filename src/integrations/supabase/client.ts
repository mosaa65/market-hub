// Market-Hub ERP - Resilient Supabase Client
import { createClient } from "@supabase/supabase-js";
import type { Database } from "./types";
import { isPrivilegedSupabaseKey, parseSupabaseTarget, validateSupabaseTargetUrl } from "./target";

function createSupabaseClient() {
  const target = parseSupabaseTarget(import.meta.env.VITE_SUPABASE_TARGET as string | undefined);
  const SUPABASE_URL = validateSupabaseTargetUrl(
    target,
    (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? "",
  );
  const SUPABASE_PUBLISHABLE_KEY =
    (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined)?.trim() ||
    (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim() ||
    "";

  if (!SUPABASE_PUBLISHABLE_KEY || isPrivilegedSupabaseKey(SUPABASE_PUBLISHABLE_KEY)) {
    throw new Error(
      "Set VITE_SUPABASE_PUBLISHABLE_KEY to a publishable/anon key. Secret keys cannot be used in the browser.",
    );
  }

  return createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: {
      // حفظ الجلسة دائماً في localStorage — تبقى صالحة حتى بعد إغلاق المتصفح
      // وإعادة فتحه، وتُجَدَّد التوكنات تلقائياً في الخلفية دون انقطاع.
      storage: typeof window !== "undefined" ? localStorage : undefined,
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
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

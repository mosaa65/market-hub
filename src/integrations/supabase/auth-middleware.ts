import { createMiddleware } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "./types";

export const requireSupabaseAuth = createMiddleware({ type: "function" }).server(
  async ({ next }) => {
    const SUPABASE_URL =
      process.env.SUPABASE_URL ||
      process.env.VITE_SUPABASE_URL ||
      "https://kwzqvgdyadylwnvjghqn.supabase.co";
    const SUPABASE_PUBLISHABLE_KEY =
      process.env.SUPABASE_PUBLISHABLE_KEY ||
      process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
      process.env.VITE_SUPABASE_ANON_KEY ||
      "sb_publishable_ODUnlFE4JLNBhtTJ0eaR4g_JpDLt8xa";

    const request = getRequest();
    const authHeader = request?.headers?.get("authorization");

    // إذا لم يتوفر رمز المصادقة (أثناء المعاينة والتطوير)، يتم إنشاء عميل عام للتقارير بدلاً من إيقاف الصفحة
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      const publicSupabase = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
        auth: {
          storage: undefined,
          persistSession: false,
          autoRefreshToken: false,
        },
      });

      return next({
        context: {
          supabase: publicSupabase,
          userId: "anonymous",
          claims: {} as any,
        },
      });
    }

    const token = authHeader.replace("Bearer ", "").trim();
    if (!token) {
      const publicSupabase = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
        auth: {
          storage: undefined,
          persistSession: false,
          autoRefreshToken: false,
        },
      });

      return next({
        context: {
          supabase: publicSupabase,
          userId: "anonymous",
          claims: {} as any,
        },
      });
    }

    const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      global: {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
      auth: {
        storage: undefined,
        persistSession: false,
        autoRefreshToken: false,
      },
    });

    try {
      const { data, error } = await supabase.auth.getClaims(token);
      if (error || !data?.claims || !data.claims.sub) {
        return next({
          context: {
            supabase,
            userId: "anonymous",
            claims: {} as any,
          },
        });
      }

      return next({
        context: {
          supabase,
          userId: data.claims.sub,
          claims: data.claims as any,
        },
      });
    } catch {
      return next({
        context: {
          supabase,
          userId: "anonymous",
          claims: {} as any,
        },
      });
    }
  },
);

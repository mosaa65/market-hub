import { createMiddleware } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "./types";
import { isPrivilegedSupabaseKey, parseSupabaseTarget, validateSupabaseTargetUrl } from "./target";

function fail(statusCode: number, message: string): never {
  throw Object.assign(new Error(message), { statusCode, status: statusCode });
}

export const requireSupabaseAuth = createMiddleware({ type: "function" }).server(
  async ({ next }) => {
    let SUPABASE_URL: string;
    let SUPABASE_PUBLISHABLE_KEY: string;
    try {
      const target = parseSupabaseTarget(process.env.SUPABASE_TARGET);
      if (
        process.env.VITE_SUPABASE_TARGET &&
        parseSupabaseTarget(process.env.VITE_SUPABASE_TARGET) !== target
      ) {
        throw new Error("Client and server Supabase targets do not match.");
      }
      SUPABASE_URL = validateSupabaseTargetUrl(target, process.env.SUPABASE_URL ?? "");
      SUPABASE_PUBLISHABLE_KEY =
        process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || "";
      if (!SUPABASE_PUBLISHABLE_KEY || isPrivilegedSupabaseKey(SUPABASE_PUBLISHABLE_KEY)) {
        throw new Error(
          "Set SUPABASE_PUBLISHABLE_KEY to a publishable/anon key, never a secret key.",
        );
      }
    } catch (error) {
      return fail(
        503,
        error instanceof Error ? error.message : "Supabase server is not configured.",
      );
    }

    const request = getRequest();
    const authHeader = request?.headers?.get("authorization");
    const match = authHeader?.match(/^Bearer\s+(\S+)$/i);
    if (!match) return fail(401, "Authentication is required.");
    const token = match[1];

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
      if (
        error ||
        !data?.claims ||
        typeof data.claims.sub !== "string" ||
        data.claims.role !== "authenticated"
      ) {
        return fail(401, "The Supabase access token is invalid or expired.");
      }

      return next({
        context: {
          supabase,
          userId: data.claims.sub,
          claims: data.claims as any,
        },
      });
    } catch (error) {
      if (error && typeof error === "object" && "statusCode" in error) throw error;
      return fail(503, "Could not verify the Supabase access token.");
    }
  },
);

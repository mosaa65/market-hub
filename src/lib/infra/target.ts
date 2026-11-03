import { parseSupabaseTarget } from "@/integrations/supabase/target";

/** Local infrastructure commands may run only when Docker is explicitly selected. */
export function requireDockerInfrastructureTarget(): void {
  const target = parseSupabaseTarget(process.env.SUPABASE_TARGET);
  if (target !== "docker") {
    throw new Error("إدارة Docker والترحيلات المحلية متاحة فقط عند اختيار SUPABASE_TARGET=docker.");
  }
}

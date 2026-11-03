import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Central policy used by every sales entry point. The database remains the
 * authority; this hook only keeps the UI from blocking an explicitly allowed
 * sale before it reaches the atomic posting RPC.
 */
export function useNegativeSalesSetting() {
  return useQuery({
    queryKey: ["company-settings", "allow-negative-sales"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("company_settings")
        .select("allow_negative_sales")
        .eq("id", 1)
        .maybeSingle();
      if (error) throw error;
      return Boolean(data?.allow_negative_sales);
    },
    staleTime: 30_000,
  });
}

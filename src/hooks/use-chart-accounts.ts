import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface PostableAccount {
  id: string;
  code: string;
  name_ar: string;
  name_en?: string | null;
  account_type: string;
}

export function usePostableAssetAccounts() {
  return useQuery({
    queryKey: ["accounting", "postable-asset-accounts"],
    queryFn: async (): Promise<PostableAccount[]> => {
      const { data, error } = await (supabase as any)
        .from("accounts")
        .select("id, code, name_ar, name_en, account_type")
        .eq("is_postable", true)
        .order("code", { ascending: true });

      if (error) {
        console.warn("Could not fetch accounts:", error.message);
        return [];
      }

      const rows = (data ?? []) as PostableAccount[];
      // Filter primarily cash, bank, treasury accounts (codes starting with 11 or 12)
      return rows.filter((a) => a.account_type === "ASSET" || a.code.startsWith("1"));
    },
    staleTime: 10 * 60 * 1000,
  });
}

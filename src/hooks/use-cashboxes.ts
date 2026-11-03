import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Cashbox } from "@/lib/payments/treasury-types";

export const CASHBOXES_QUERY_KEY = ["treasury", "cashboxes"] as const;

const db = supabase as any;

export function useCashboxes() {
  const query = useQuery({
    queryKey: CASHBOXES_QUERY_KEY,
    queryFn: async (): Promise<Cashbox[]> => {
      try {
        const { data, error } = await db
          .from("cashboxes")
          .select("*, account:accounts(id, code, name_ar)")
          .order("is_default", { ascending: false })
          .order("name_ar", { ascending: true });

        if (error) {
          console.warn("Could not fetch cashboxes from db, falling back to empty:", error.message);
          return [];
        }

        return (data ?? []) as Cashbox[];
      } catch (err) {
        console.warn("Cashboxes table not yet ready or unreachable:", err);
        return [];
      }
    },
    staleTime: 5 * 60 * 1000,
  });

  const cashboxes = query.data ?? [];
  const activeCashboxes = cashboxes.filter((c) => c.is_active);
  const defaultCashbox = activeCashboxes.find((c) => c.is_default) ?? activeCashboxes[0];

  return {
    cashboxes,
    activeCashboxes,
    defaultCashbox,
    isLoading: query.isLoading,
    refetch: query.refetch,
  };
}

export interface CreateCashboxInput {
  name_ar: string;
  name_en?: string | null;
  code: string;
  account_id: string;
  warehouse_id?: string | null;
  is_default?: boolean;
  notes?: string | null;
}

export function useCreateCashbox() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: CreateCashboxInput) => {
      // If setting as default, unset other defaults first
      if (input.is_default) {
        await db
          .from("cashboxes")
          .update({ is_default: false })
          .neq("id", "00000000-0000-0000-0000-000000000000");
      }

      const { data, error } = await db
        .from("cashboxes")
        .insert([
          {
            name_ar: input.name_ar.trim(),
            name_en: input.name_en?.trim() || null,
            code: input.code.trim().toUpperCase(),
            account_id: input.account_id,
            warehouse_id: input.warehouse_id || null,
            is_default: input.is_default ?? false,
            notes: input.notes?.trim() || null,
          },
        ])
        .select()
        .single();

      if (error) throw error;
      return data as Cashbox;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: CASHBOXES_QUERY_KEY });
    },
  });
}

export function useUpdateCashbox() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      ...patch
    }: { id: string } & Partial<CreateCashboxInput> & { is_active?: boolean }) => {
      if (patch.is_default) {
        await db.from("cashboxes").update({ is_default: false }).neq("id", id);
      }

      const { data, error } = await db
        .from("cashboxes")
        .update({
          ...patch,
          updated_at: new Date().toISOString(),
        })
        .eq("id", id)
        .select()
        .single();

      if (error) throw error;
      return data as Cashbox;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: CASHBOXES_QUERY_KEY });
    },
  });
}

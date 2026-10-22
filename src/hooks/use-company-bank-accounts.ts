import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { CompanyBankAccount, BankAccountKind } from "@/lib/payments/treasury-types";

export const COMPANY_BANK_ACCOUNTS_QUERY_KEY = ["treasury", "company_bank_accounts"] as const;

const db = supabase as any;

export function useCompanyBankAccounts(kind?: BankAccountKind) {
  const query = useQuery({
    queryKey: [...COMPANY_BANK_ACCOUNTS_QUERY_KEY, kind ?? "ALL"],
    queryFn: async (): Promise<CompanyBankAccount[]> => {
      try {
        let q = db
          .from("company_bank_accounts")
          .select("*, account:accounts(id, code, name_ar)")
          .order("is_default", { ascending: false })
          .order("name_ar", { ascending: true });

        if (kind) {
          q = q.eq("kind", kind);
        }

        const { data, error } = await q;

        if (error) {
          console.warn("Could not fetch company bank accounts from db:", error.message);
          return [];
        }

        return (data ?? []) as CompanyBankAccount[];
      } catch (err) {
        console.warn("Company bank accounts table not yet ready:", err);
        return [];
      }
    },
    staleTime: 5 * 60 * 1000,
  });

  const accounts = query.data ?? [];
  const activeAccounts = accounts.filter((a) => a.is_active);
  const banks = activeAccounts.filter((a) => a.kind === "BANK");
  const wallets = activeAccounts.filter((a) => a.kind === "WALLET");
  // لا تخمين لبنك أو محفظة عشوائية؛ إما أن يكون الافتراضي صريحاً ومحدداً من الإعدادات، أو undefined
  const defaultBank = banks.find((b) => b.is_default);
  const defaultWallet = wallets.find((w) => w.is_default);

  return {
    accounts,
    activeAccounts,
    banks,
    wallets,
    defaultBank,
    defaultWallet,
    isLoading: query.isLoading,
    refetch: query.refetch,
  };
}

export interface CreateCompanyBankAccountInput {
  name_ar: string;
  name_en?: string | null;
  kind: BankAccountKind;
  bank_name: string;
  account_number?: string | null;
  iban?: string | null;
  currency?: string;
  account_id: string;
  is_default?: boolean;
  notes?: string | null;
}

export function useCreateCompanyBankAccount() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: CreateCompanyBankAccountInput) => {
      if (input.is_default) {
        await db.from("company_bank_accounts").update({ is_default: false }).eq("kind", input.kind);
      }

      const { data, error } = await db
        .from("company_bank_accounts")
        .insert([
          {
            name_ar: input.name_ar.trim(),
            name_en: input.name_en?.trim() || null,
            kind: input.kind,
            bank_name: input.bank_name.trim(),
            account_number: input.account_number?.trim() || null,
            iban: input.iban?.trim() || null,
            currency: input.currency?.trim() || "YER",
            account_id: input.account_id,
            is_default: input.is_default ?? false,
            notes: input.notes?.trim() || null,
          },
        ])
        .select()
        .single();

      if (error) throw error;
      return data as CompanyBankAccount;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: COMPANY_BANK_ACCOUNTS_QUERY_KEY });
    },
  });
}

export function useUpdateCompanyBankAccount() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      kind,
      ...patch
    }: { id: string; kind?: BankAccountKind } & Partial<CreateCompanyBankAccountInput> & {
        is_active?: boolean;
      }) => {
      if (patch.is_default && kind) {
        await db
          .from("company_bank_accounts")
          .update({ is_default: false })
          .eq("kind", kind)
          .neq("id", id);
      }

      const { data, error } = await db
        .from("company_bank_accounts")
        .update({
          ...patch,
          updated_at: new Date().toISOString(),
        })
        .eq("id", id)
        .select()
        .single();

      if (error) throw error;
      return data as CompanyBankAccount;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: COMPANY_BANK_ACCOUNTS_QUERY_KEY });
    },
  });
}

export function useSetDefaultTreasuryAccount() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, kind }: { id: string; kind?: BankAccountKind }) => {
      const { data, error } = await db.rpc("set_default_treasury_account", {
        p_id: id,
        p_kind: kind || null,
      });
      if (error) throw error;
      return data as CompanyBankAccount;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: COMPANY_BANK_ACCOUNTS_QUERY_KEY });
    },
  });
}

export function useClearDefaultTreasuryAccount() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (kind: BankAccountKind) => {
      const { data, error } = await db.rpc("clear_default_treasury_account", {
        p_kind: kind,
      });
      if (error) throw error;
      return data as number;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: COMPANY_BANK_ACCOUNTS_QUERY_KEY });
    },
  });
}

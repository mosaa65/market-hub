import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export type BatchDispatchStrategy = "FEFO" | "FIFO" | "MANUAL";

export interface BatchSettings {
  dispatch_strategy: BatchDispatchStrategy;
  prevent_selling_expired: boolean;
  warning_days: number;
  enforce_on_purchase: boolean;
  enforce_batch_selection_on_pos: boolean;
  auto_sync_inventory: boolean;
}

export const DEFAULT_BATCH_SETTINGS: BatchSettings = {
  dispatch_strategy: "FEFO",
  prevent_selling_expired: true,
  warning_days: 30,
  enforce_on_purchase: false,
  enforce_batch_selection_on_pos: false,
  auto_sync_inventory: true,
};

const LOCAL_STORAGE_KEY = "vortex_batch_settings";

export function getLocalBatchSettings(): BatchSettings {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (raw) {
      return { ...DEFAULT_BATCH_SETTINGS, ...JSON.parse(raw) };
    }
  } catch {
    // ignore json error
  }
  return DEFAULT_BATCH_SETTINGS;
}

export function setLocalBatchSettings(settings: BatchSettings) {
  try {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // ignore storage error
  }
}

export function useBatchSettings() {
  const qc = useQueryClient();

  const {
    data: settings = getLocalBatchSettings(),
    isLoading,
    isFetching,
  } = useQuery({
    queryKey: ["batch-settings"],
    queryFn: async (): Promise<BatchSettings> => {
      // 1. Try to fetch from company_settings.batch_settings
      const { data, error } = await supabase
        .from("company_settings")
        .select("batch_settings" as any)
        .limit(1)
        .maybeSingle();

      if (error) {
        // Fallback to local
        return getLocalBatchSettings();
      }

      const dbSettings = (data as any)?.batch_settings;
      if (dbSettings && typeof dbSettings === "object") {
        const merged: BatchSettings = {
          ...DEFAULT_BATCH_SETTINGS,
          ...dbSettings,
        };
        setLocalBatchSettings(merged);
        return merged;
      }

      return getLocalBatchSettings();
    },
    staleTime: 60_000,
  });

  const mutation = useMutation({
    mutationFn: async (updated: Partial<BatchSettings>) => {
      const merged: BatchSettings = {
        ...settings,
        ...updated,
      };

      // Save to localStorage immediately
      setLocalBatchSettings(merged);

      // Try RPC first, fallback to table update
      try {
        const { error: rpcErr } = await supabase.rpc("save_batch_settings" as any, {
          p_settings: merged,
        });
        if (!rpcErr) return merged;
      } catch {
        // RPC might not exist or failed, fallback to direct update
      }

      const { data: existing } = await supabase
        .from("company_settings")
        .select("id")
        .limit(1)
        .maybeSingle();

      if (existing?.id) {
        const { error } = await supabase
          .from("company_settings")
          .update({ batch_settings: merged } as any)
          .eq("id", existing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("company_settings")
          .insert({ batch_settings: merged } as any);
        if (error) throw error;
      }

      return merged;
    },
    onSuccess: (saved) => {
      qc.setQueryData(["batch-settings"], saved);
      qc.invalidateQueries({ queryKey: ["batch-settings"] });
    },
    onError: (e: any) => {
      toast.error(e?.message || "فشل حفظ إعدادات الدفعات");
    },
  });

  return {
    settings,
    isLoading,
    isFetching,
    saveSettings: mutation.mutateAsync,
    isSaving: mutation.isPending,
  };
}

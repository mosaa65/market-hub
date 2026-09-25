import { useEffect, useRef } from "react";
import type { QueryClient } from "@tanstack/react-query";
import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

export interface RealtimeTableConfig<T extends { id: string | number } = any> {
  table: string;
  schema?: string;
  queryKey?: readonly unknown[];
  onInsert?: (newItem: T, queryClient?: QueryClient) => void;
  onUpdate?: (updatedItem: T, queryClient?: QueryClient) => void;
  onDelete?: (oldItem: Partial<T>, queryClient?: QueryClient) => void;
  debounceMs?: number;
}

/**
 * Centrally updates a TanStack Query list cache without refetching the entire endpoint.
 */
export function updateQueryListCache<T extends { id: string | number }>(
  queryClient: QueryClient,
  queryKey: readonly unknown[],
  payload: RealtimePostgresChangesPayload<T>
) {
  queryClient.setQueryData(queryKey, (oldData: any) => {
    if (!oldData) return oldData;

    // Support array data directly
    if (Array.isArray(oldData)) {
      switch (payload.eventType) {
        case "INSERT": {
          const exists = oldData.some((item) => item.id === (payload.new as T).id);
          return exists ? oldData : [payload.new as T, ...oldData];
        }
        case "UPDATE": {
          return oldData.map((item) =>
            item.id === (payload.new as T).id ? { ...item, ...payload.new } : item
          );
        }
        case "DELETE": {
          return oldData.filter((item) => item.id !== (payload.old as Partial<T>).id);
        }
        default:
          return oldData;
      }
    }

    // Support paginated / envelope structure { data: [...], count: ... }
    if (oldData && Array.isArray(oldData.data)) {
      switch (payload.eventType) {
        case "INSERT": {
          const exists = oldData.data.some((item: any) => item.id === (payload.new as T).id);
          return {
            ...oldData,
            count: (oldData.count ?? oldData.data.length) + (exists ? 0 : 1),
            data: exists ? oldData.data : [payload.new as T, ...oldData.data],
          };
        }
        case "UPDATE": {
          return {
            ...oldData,
            data: oldData.data.map((item: any) =>
              item.id === (payload.new as T).id ? { ...item, ...payload.new } : item
            ),
          };
        }
        case "DELETE": {
          return {
            ...oldData,
            count: Math.max(0, (oldData.count ?? oldData.data.length) - 1),
            data: oldData.data.filter((item: any) => item.id !== (payload.old as Partial<T>).id),
          };
        }
        default:
          return oldData;
      }
    }

    return oldData;
  });
}

/**
 * Hook for granular table-level Realtime synchronization.
 * Prevents full-screen unmounting and executes updates strictly at the component/cache level.
 */
export function useRealtimeTable<T extends { id: string | number }>(
  config: RealtimeTableConfig<T>,
  queryClient?: QueryClient
) {
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    const channelName = `realtime-${config.table}-${Math.random().toString(36).substring(2, 7)}`;
    const channel = supabase.channel(channelName);

    channel.on(
      "postgres_changes",
      {
        event: "*",
        schema: config.schema ?? "public",
        table: config.table,
      },
      (payload: RealtimePostgresChangesPayload<T>) => {
        const handleEvent = () => {
          if (config.queryKey && queryClient) {
            updateQueryListCache(queryClient, config.queryKey, payload);
          }

          if (payload.eventType === "INSERT" && config.onInsert) {
            config.onInsert(payload.new as T, queryClient);
          } else if (payload.eventType === "UPDATE" && config.onUpdate) {
            config.onUpdate(payload.new as T, queryClient);
          } else if (payload.eventType === "DELETE" && config.onDelete) {
            config.onDelete(payload.old as Partial<T>, queryClient);
          }
        };

        if (config.debounceMs && config.debounceMs > 0) {
          if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
          debounceTimerRef.current = setTimeout(handleEvent, config.debounceMs);
        } else {
          handleEvent();
        }
      }
    );

    channel.subscribe();

    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      void supabase.removeChannel(channel);
    };
  }, [config.table, config.schema, config.debounceMs, queryClient]);
}

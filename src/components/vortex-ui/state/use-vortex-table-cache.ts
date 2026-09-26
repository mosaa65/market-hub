"use client";

import * as React from "react";
import { useQueryClient, type InfiniteData } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js";

interface UseVortexTableRealtimeOptions<T extends { id: string | number }> {
  table: string;
  queryKey: readonly unknown[];
  schema?: string;
  onRowChange?: (event: "INSERT" | "UPDATE" | "DELETE", row: Partial<T>) => void;
}

/**
 * Hook to handle real-time row-level updates inside TanStack Infinite Query cache
 * without refetching the whole list or causing full-table flicker.
 */
export function useVortexTableRealtime<T extends { id: string | number }>({
  table,
  queryKey,
  schema = "public",
  onRowChange,
}: UseVortexTableRealtimeOptions<T>) {
  const queryClient = useQueryClient();
  const [lastUpdatedId, setLastUpdatedId] = React.useState<string | number | null>(null);

  React.useEffect(() => {
    const channelName = `vortex-realtime-${table}-${Math.random().toString(36).substring(2, 7)}`;
    const channel = supabase.channel(channelName);

    channel.on(
      "postgres_changes",
      {
        event: "*",
        schema,
        table,
      },
      (payload: RealtimePostgresChangesPayload<T>) => {
        const event = payload.eventType;
        const newItem = payload.new as T;
        const oldItem = payload.old as Partial<T>;

        queryClient.setQueryData<InfiniteData<{ rows: T[]; nextCursor?: number }>>(
          queryKey,
          (oldData) => {
            if (!oldData || !Array.isArray(oldData.pages)) return oldData;

            if (event === "UPDATE" && newItem?.id) {
              setLastUpdatedId(newItem.id);
              setTimeout(() => setLastUpdatedId(null), 1500);

              return {
                ...oldData,
                pages: oldData.pages.map((page) => ({
                  ...page,
                  rows: Array.isArray(page.rows)
                    ? page.rows.map((row) => (row.id === newItem.id ? { ...row, ...newItem } : row))
                    : [],
                })),
              };
            }

            if (event === "INSERT" && newItem?.id) {
              setLastUpdatedId(newItem.id);
              setTimeout(() => setLastUpdatedId(null), 1500);

              const firstPage = oldData.pages[0];
              const exists = oldData.pages.some((p) => p.rows.some((r) => r.id === newItem.id));
              if (exists) return oldData;

              const updatedFirstPage = {
                ...firstPage,
                rows: [newItem, ...(firstPage?.rows ?? [])],
              };

              return {
                ...oldData,
                pages: [updatedFirstPage, ...oldData.pages.slice(1)],
              };
            }

            if (event === "DELETE" && oldItem?.id) {
              return {
                ...oldData,
                pages: oldData.pages.map((page) => ({
                  ...page,
                  rows: Array.isArray(page.rows)
                    ? page.rows.filter((row) => row.id !== oldItem.id)
                    : [],
                })),
              };
            }

            return oldData;
          }
        );

        onRowChange?.(event, event === "DELETE" ? oldItem : newItem);
      }
    );

    channel.subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [table, schema, queryKey, queryClient, onRowChange]);

  return { lastUpdatedId };
}

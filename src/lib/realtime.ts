import { useCallback, useEffect, useRef, useState } from "react";
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
  /**
   * How the event is folded back into the cache:
   *
   * - `"patch"` (default) — apply the single-row change to the cached shape.
   *   Cheapest, and correct for flat arrays and for infinite streams whose rows
   *   are the raw table rows.
   * - `"invalidate"` — drop the key and let the mounted query re-read from the
   *   server. Use it when the cached row shape is *enriched* beyond the table
   *   (joined display fields, computed columns); a raw payload patched into such
   *   a row would render a half-empty record until the next refetch.
   *
   * Both modes converge on the server's answer: `patch` is applied first so the
   * UI keeps its previous rows visible, never a skeleton.
   */
  mode?: "patch" | "invalidate";
}

/** Lifecycle of the underlying Supabase channel, for diagnostics and UI. */
export type RealtimeStatus = "connecting" | "subscribed" | "error" | "closed";

/**
 * Centrally updates a TanStack Query list cache without refetching the entire endpoint.
 *
 * Supported cache shapes: a plain array, an envelope `{ data, count }`, and a
 * TanStack `useInfiniteQuery` result whose pages are either `{ rows }` or raw
 * arrays.
 *
 * Unknown shapes are left untouched on purpose. `queryClient.setQueryData` turns
 * the cache `status` into `"success"`, so returning a mutated value for a shape
 * this function does not understand would mark a query as resolved while its
 * data is still the placeholder — the observer would then suppress the very
 * refetch that fixes it. Returning the same reference is a no-op.
 */
export function updateQueryListCache<T extends { id: string | number }>(
  queryClient: QueryClient,
  queryKey: readonly unknown[],
  payload: RealtimePostgresChangesPayload<T>,
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
            item.id === (payload.new as T).id ? { ...item, ...payload.new } : item,
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
              item.id === (payload.new as T).id ? { ...item, ...payload.new } : item,
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

    // Support TanStack `useInfiniteQuery` data without refetching every page.
    // A realtime product event only changes the row that arrived from Postgres;
    // joined display fields already cached for that row remain intact.
    if (oldData && Array.isArray(oldData.pages)) {
      const newItem = payload.new as T;
      const oldItem = payload.old as Partial<T>;
      const applyToRows = (rows: T[], pageIndex: number): T[] => {
        switch (payload.eventType) {
          case "INSERT":
            if (pageIndex !== 0 || rows.some((item) => item.id === newItem.id)) return rows;
            return [newItem, ...rows];
          case "UPDATE":
            return rows.map((item) => (item.id === newItem.id ? { ...item, ...newItem } : item));
          case "DELETE":
            return rows.filter((item) => item.id !== oldItem.id);
          default:
            return rows;
        }
      };

      const mappedPages = oldData.pages.map((page: any, pageIndex: number) => {
        if (Array.isArray(page?.rows)) {
          return { ...page, rows: applyToRows(page.rows, pageIndex) };
        }
        if (Array.isArray(page)) {
          return applyToRows(page, pageIndex);
        }
        return page;
      });

      // If no page matched a known shape, leave the cache untouched.
      if (mappedPages.every((page: any, index: number) => page === oldData.pages[index])) {
        return oldData;
      }

      return { ...oldData, pages: mappedPages };
    }

    return oldData;
  });
}

/* ------------------------------------------------------------------ */
/*  Typed row mappers                                                  */
/* ------------------------------------------------------------------ */

/**
 * Watchers that need to keep enriched fields on a row after a raw payload
 * arrives.
 *
 * The generic patcher merges the payload over the cached row. That is wrong for
 * a row carrying joined display data (a product's `category`/`unit`/`brand`, a
 * sales invoice's `customers`/`warehouses`) *only* when the event is an INSERT
 * that introduces a row the stream has never seen: there is nothing to merge
 * with, so the raw row is inserted with its joins missing.
 *
 * A per-table mapper can either return a patched row or `null`. Returning
 * `null` tells the hook to stop patching and reconcile from the server instead —
 * the honest answer when the payload is not enough to build a complete row.
 */
export type RealtimeRowMapper<T> = (params: {
  eventType: "INSERT" | "UPDATE" | "DELETE";
  /** The cached row, when one already exists for this id. */
  existing: T | undefined;
  /** The raw payload row (`new` for INSERT/UPDATE, `old` for DELETE). */
  incoming: Partial<T>;
}) => T | null;

/** Table → mapper. Register a table here instead of writing a bespoke hook. */
const ROW_PATCHERS: Record<string, RealtimeRowMapper<any>> = {};

/**
 * Registers a mapper for a table so `useRealtimeTable` knows whether an INSERT
 * payload is rich enough to insert directly. Called by the domain that owns the
 * row shape (see `_app.products.tsx`).
 */
export function registerRealtimeRowPatcher<T>(table: string, mapper: RealtimeRowMapper<T>): void {
  ROW_PATCHERS[table] = mapper;
}

/**
 * Whether an INSERT payload can be folded straight into the cached stream.
 * Without a registered mapper the payload is trusted as a complete row.
 */
export function canPatchRealtimeInsert<T extends { id: string | number }>(
  table: string,
  payload: T,
): boolean {
  const mapper = ROW_PATCHERS[table];
  if (!mapper) return true;
  return mapper({ eventType: "INSERT", existing: undefined, incoming: payload }) !== null;
}

/**
 * Hook for granular table-level Realtime synchronization.
 *
 * One policy, stated explicitly: **patch the cache, then reconcile from the
 * server.** An event is a reconciliation trigger, not a change log.
 *
 * - `patch` (default) folds the single changed row into the cached shape, then
 *   debounces one rate-limited refetch so joins, filters, sort order and the
 *   row count converge on the server's answer. Coalescing several events inside
 *   the window costs exactly one refetch — an event stream must never turn into
 *   a refetch storm on an infinite list.
 * - `invalidate` skips the patch (for rows enriched beyond the table) and
 *   schedules the same refetch.
 * - An INSERT whose payload cannot produce a complete row (a registered row
 *   patcher returns `null`) also degrades to `invalidate` rather than showing a
 *   half-empty record.
 * - On reconnect the hook refetches its key once, so changes missed while the
 *   socket was down are reconciled instead of silently lost.
 *
 * Returns the channel lifecycle so a screen can surface (and test) the
 * connection state instead of guessing.
 */
export function useRealtimeTable<T extends { id: string | number }>(
  config: RealtimeTableConfig<T>,
  queryClient?: QueryClient,
): { status: RealtimeStatus } {
  const [status, setStatus] = useState<RealtimeStatus>("connecting");
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const configRef = useRef(config);
  configRef.current = config;
  const queryClientRef = useRef(queryClient);
  queryClientRef.current = queryClient;

  /*
   * One refetch per burst. The timer is intentionally NOT cleared by the effect
   * cleanup on every render: it lives on a ref, survives re-renders, and is only
   * cancelled when the subscription itself is torn down.
   */
  const scheduleReconcile = useCallback((queryKey: readonly unknown[]) => {
    const client = queryClientRef.current;
    if (!client) return;
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(() => {
      debounceTimerRef.current = null;
      void client.invalidateQueries({ queryKey, refetchType: "active" });
    }, configRef.current.debounceMs ?? 0);
  }, []);

  const { table, schema } = config;

  useEffect(() => {
    const channelName = `realtime-${schema ?? "public"}-${table}`;
    const client = queryClientRef.current;
    const channel = supabase.channel(channelName);
    let cancelled = false;

    channel.on(
      "postgres_changes",
      {
        event: "*",
        schema: schema ?? "public",
        table,
      },
      (payload: RealtimePostgresChangesPayload<T>) => {
        const currentConfig = configRef.current;
        const queryKey = currentConfig.queryKey;

        if (queryKey && client) {
          const isInsert = payload.eventType === "INSERT";
          const patchable =
            currentConfig.mode !== "invalidate" &&
            (!isInsert || canPatchRealtimeInsert(table, payload.new as T));

          if (patchable) updateQueryListCache(client, queryKey, payload);
          // Reconciliation is what makes the cache trustworthy: the patch keeps
          // the current rows on screen, the refetch replaces them with the
          // server's version (joins, filters, ordering, count).
          scheduleReconcile(queryKey);
        }

        if (payload.eventType === "INSERT" && currentConfig.onInsert) {
          currentConfig.onInsert(payload.new as T, client);
        } else if (payload.eventType === "UPDATE" && currentConfig.onUpdate) {
          currentConfig.onUpdate(payload.new as T, client);
        } else if (payload.eventType === "DELETE" && currentConfig.onDelete) {
          currentConfig.onDelete(payload.old as Partial<T>, client);
        }
      },
    );

    // Channel lifecycle is reported rather than swallowed: a topic that never
    // subscribes is diagnosed instead of looking like "no events yet".
    channel.subscribe((channelStatus) => {
      if (cancelled) return;
      if (channelStatus === "SUBSCRIBED") setStatus("subscribed");
      else if (channelStatus === "CHANNEL_ERROR" || channelStatus === "TIMED_OUT")
        setStatus("error");
      else if (channelStatus === "CLOSED") setStatus("closed");
    });

    /*
     * Reconnect reconciliation. Realtime does not replay the events that fired
     * while the socket was down, and the QueryClient's own reconnect rule only
     * refetches queries that are already stale — so refetch the subscribed key
     * explicitly (skipping the very first connect, where the mount fetch covers
     * it).
     */
    const reconcileOnReconnect = () => {
      const currentConfig = configRef.current;
      const currentClient = queryClientRef.current;
      if (!currentConfig.queryKey || !currentClient) return;
      void currentClient.invalidateQueries({
        queryKey: currentConfig.queryKey,
        refetchType: "active",
      });
    };
    if (typeof window !== "undefined") {
      window.addEventListener("online", reconcileOnReconnect);
    }

    return () => {
      cancelled = true;
      if (typeof window !== "undefined") {
        window.removeEventListener("online", reconcileOnReconnect);
      }
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
      setStatus("closed");
      void supabase.removeChannel(channel);
    };
  }, [table, schema, scheduleReconcile]);

  return { status };
}

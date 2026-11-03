/**
 * Market-Hub ERP - Base Repository Abstraction Layer
 * Isolates UI components from direct Supabase calls, enabling transparent offline/online operation.
 */

import { supabase } from "@/integrations/supabase/client";
import { getOfflineStorageAdapter, IOfflineStorageAdapter } from "../storage-adapter";
import { globalSyncEngine, SyncEngine } from "../sync-engine";
import { SyncPriority } from "../types";

export abstract class BaseRepository<T extends { id: string }> {
  protected tableName: string;
  protected adapter: IOfflineStorageAdapter;
  protected syncEngine: SyncEngine;

  constructor(tableName: string) {
    this.tableName = tableName;
    this.adapter = getOfflineStorageAdapter();
    this.syncEngine = globalSyncEngine;
  }

  /**
   * Fetches all records: local cache when offline, remote with local fallback when online.
   */
  async getAll(filter?: (item: T) => boolean): Promise<T[]> {
    const isOnline = typeof navigator !== "undefined" ? navigator.onLine : true;

    if (isOnline) {
      try {
        const { data, error } = await supabase.from(this.tableName as any).select("*");
        if (!error && data) {
          // Update local cache in background
          for (const item of data as unknown as T[]) {
            await this.adapter.setItem(this.tableName, item.id, item);
          }
          return filter ? (data as unknown as T[]).filter(filter) : (data as unknown as T[]);
        }
      } catch {
        // Fallback to local store on network failure
      }
    }

    return this.adapter.getAll<T>(this.tableName, filter);
  }

  /**
   * Fetches a single record by ID.
   */
  async getById(id: string): Promise<T | null> {
    const isOnline = typeof navigator !== "undefined" ? navigator.onLine : true;

    if (isOnline) {
      try {
        const { data, error } = await supabase
          .from(this.tableName as any)
          .select("*")
          .eq("id", id)
          .single();
        if (!error && data) {
          const item = data as unknown as T;
          await this.adapter.setItem(this.tableName, item.id, item);
          return item;
        }
      } catch {
        // Fallback to local store
      }
    }

    return this.adapter.getItem<T>(this.tableName, id);
  }

  /**
   * Creates or enqueues creation of an entity.
   */
  async create(data: T, priority: SyncPriority = "medium"): Promise<T> {
    // Save to local storage immediately
    await this.adapter.setItem(this.tableName, data.id, data);

    // Enqueue in sync outbox
    await this.syncEngine.enqueue({
      entity_name: this.tableName,
      operation_type: "INSERT",
      payload: data,
      priority,
    });

    return data;
  }

  /**
   * Updates or enqueues update of an entity.
   */
  async update(
    id: string,
    updates: Partial<T>,
    priority: SyncPriority = "medium",
  ): Promise<T | null> {
    const existing = await this.getById(id);
    if (!existing) return null;

    const updated = { ...existing, ...updates };
    await this.adapter.setItem(this.tableName, id, updated);

    await this.syncEngine.enqueue({
      entity_name: this.tableName,
      operation_type: "UPDATE",
      payload: updated,
      priority,
    });

    return updated;
  }

  /**
   * Deletes or enqueues deletion of an entity.
   */
  async delete(id: string, priority: SyncPriority = "medium"): Promise<boolean> {
    await this.adapter.deleteItem(this.tableName, id);

    await this.syncEngine.enqueue({
      entity_name: this.tableName,
      operation_type: "DELETE",
      payload: { id },
      priority,
    });

    return true;
  }
}

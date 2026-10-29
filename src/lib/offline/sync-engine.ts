/**
 * Market-Hub ERP - Sync Engine Core Orchestrator
 * Manages Outbox execution, network transitions, priority queueing, and idempotency guarantees.
 */

import { supabase } from "@/integrations/supabase/client";
import { getOfflineStorageAdapter, IOfflineStorageAdapter } from "./storage-adapter";
import { OutboxEnvelope, SyncEngineStatus, SyncPriority, SyncStatus } from "./types";
import { getOrCreateDeviceId, generateIdempotencyKey, generateUUIDv7 } from "./idempotency";

type SyncListener = (status: SyncEngineStatus) => void;

export class SyncEngine {
  private adapter: IOfflineStorageAdapter;
  private isSyncing = false;
  private isOnline = typeof navigator !== "undefined" ? navigator.onLine : true;
  private pendingCount = 0;
  private conflictedCount = 0;
  private rejectedCount = 0;
  private listeners: Set<SyncListener> = new Set();
  private deviceId: string;
  private lastError: string | null = null;
  private lastSyncSuccess: string | null = null;

  constructor(adapter?: IOfflineStorageAdapter) {
    this.adapter = adapter || getOfflineStorageAdapter();
    this.deviceId = getOrCreateDeviceId();
    this.initNetworkListeners();
    void this.refreshQueueCounts().then(() => this.notifyListeners());
  }

  private initNetworkListeners(): void {
    if (typeof window === "undefined") return;

    window.addEventListener("online", () => {
      this.isOnline = true;
      this.notifyListeners();
      this.triggerSync();
    });

    window.addEventListener("offline", () => {
      this.isOnline = false;
      this.notifyListeners();
    });
  }

  public subscribe(listener: SyncListener): () => void {
    this.listeners.add(listener);
    listener(this.getStatus());
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notifyListeners(): void {
    const status = this.getStatus();
    this.listeners.forEach((l) => l(status));
  }

  public getStatus(): SyncEngineStatus {
    return {
      is_online: this.isOnline,
      is_syncing: this.isSyncing,
      pending_count: this.pendingCount,
      conflicted_count: this.conflictedCount,
      rejected_count: this.rejectedCount,
      last_successful_sync: this.lastSyncSuccess,
      last_error: this.lastError,
      device_id: this.deviceId,
    };
  }

  private async refreshQueueCounts(): Promise<void> {
    try {
      const queue = await this.adapter.getOutboxQueue();
      this.pendingCount = queue.filter((item) => item.status === "pending").length;
      this.conflictedCount = queue.filter((item) => item.status === "conflicted").length;
      this.rejectedCount = queue.filter((item) => item.status === "rejected").length;
    } catch {
      // Preserve the last known counts if storage is temporarily unavailable.
    }
  }

  /**
   * Enqueues an offline/online business operation into the Outbox
   */
  public async enqueue<T>(params: {
    entity_name: string;
    operation_type: OutboxEnvelope["operation_type"];
    payload: T;
    priority?: SyncPriority;
    dependencies?: string[];
    local_document_ref?: string | null;
  }): Promise<OutboxEnvelope<T>> {
    const id = generateUUIDv7();
    const idempotencyKey = generateIdempotencyKey(
      this.deviceId,
      params.entity_name,
      id,
      params.operation_type,
    );

    const envelope: OutboxEnvelope<T> = {
      id,
      idempotency_key: idempotencyKey,
      operation_id: id,
      entity_name: params.entity_name,
      operation_type: params.operation_type,
      payload: params.payload,
      priority: params.priority || "medium",
      dependencies: params.dependencies || [],
      origin_device_id: this.deviceId,
      client_timestamp: new Date().toISOString(),
      retry_count: 0,
      max_retries: 5,
      last_error: null,
      status: "pending",
      local_document_ref: params.local_document_ref || null,
    };

    await this.adapter.enqueueOutbox(envelope);
    await this.refreshQueueCounts();
    this.notifyListeners();

    // Trigger immediate background sync attempt if online
    if (this.isOnline) {
      this.triggerSync();
    }

    return envelope;
  }

  /**
   * Background process loop for Outbox Queue
   */
  public async triggerSync(): Promise<void> {
    if (this.isSyncing || !this.isOnline) return;

    this.isSyncing = true;
    this.notifyListeners();

    try {
      await this.refreshQueueCounts();
      const queue = await this.adapter.getOutboxQueue();
      const pendingItems = queue.filter((q) => q.status === "pending" || q.status === "rejected");

      if (pendingItems.length === 0) {
        await this.refreshQueueCounts();
        this.isSyncing = false;
        this.lastSyncSuccess = new Date().toISOString();
        this.notifyListeners();
        return;
      }

      // Sort by Priority and Client Timestamp (topological ordering)
      const priorityWeights: Record<SyncPriority, number> = { high: 3, medium: 2, low: 1 };
      pendingItems.sort((a, b) => {
        const weightDiff = priorityWeights[b.priority] - priorityWeights[a.priority];
        if (weightDiff !== 0) return weightDiff;
        return new Date(a.client_timestamp).getTime() - new Date(b.client_timestamp).getTime();
      });

      for (const item of pendingItems) {
        if (item.retry_count >= item.max_retries) {
          await this.adapter.updateOutboxStatus(item.id, "rejected", "Max retries exceeded");
          continue;
        }

        try {
          const result = await this.dispatchToServer(item);
          if (result.success) {
            await this.adapter.updateOutboxStatus(item.id, "synced", null, result.serverRef);
            // Optionally remove synced envelope after retention check
            await this.adapter.removeOutboxItem(item.id);
          } else {
            const backoffMs = Math.pow(2, item.retry_count) * 1000 + Math.random() * 500;
            await this.adapter.updateOutboxStatus(item.id, "rejected", result.error);
            await new Promise((res) => setTimeout(res, backoffMs));
          }
        } catch (err: any) {
          this.lastError = err?.message || "Network submission failed";
          await this.adapter.updateOutboxStatus(item.id, "rejected", this.lastError);
        }
      }

      this.lastSyncSuccess = new Date().toISOString();
      await this.refreshQueueCounts();
    } catch (err: any) {
      this.lastError = err?.message || "Sync loop unexpected error";
    } finally {
      await this.refreshQueueCounts();
      this.isSyncing = false;
      this.notifyListeners();
    }
  }

  /**
   * Dispatches an individual envelope to Supabase with Idempotency Key header
   */
  private async dispatchToServer(envelope: OutboxEnvelope): Promise<{
    success: boolean;
    error?: string;
    serverRef?: { serverDocNum?: string; serverVersion?: number };
  }> {
    // If operational RPC call
    if (envelope.operation_type === "RPC") {
      const { data, error } = await supabase.rpc(
        envelope.entity_name as any,
        {
          p_payload: envelope.payload,
          p_idempotency_key: envelope.idempotency_key,
        } as any,
      );

      if (error) return { success: false, error: error.message };
      return { success: true, serverRef: { serverDocNum: (data as any)?.server_document_number } };
    }

    // Direct Table Sync dispatch
    const table = supabase.from(envelope.entity_name as any);

    if (envelope.operation_type === "INSERT") {
      const { data, error } = await table.insert(envelope.payload as any).select();
      if (error) return { success: false, error: error.message };
      return { success: true };
    }

    if (envelope.operation_type === "UPDATE") {
      const { data, error } = await table
        .update(envelope.payload as any)
        .eq("id", (envelope.payload as any).id)
        .select();
      if (error) return { success: false, error: error.message };
      return { success: true };
    }

    if (envelope.operation_type === "DELETE") {
      const { error } = await table.delete().eq("id", (envelope.payload as any).id);
      if (error) return { success: false, error: error.message };
      return { success: true };
    }

    return { success: false, error: "Unsupported operation type" };
  }
}

export const globalSyncEngine = new SyncEngine();

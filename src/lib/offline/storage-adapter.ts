/**
 * Market-Hub ERP - Storage Provider Adapter Abstraction
 * Supports Web (IndexedDB/LocalStorage) and Desktop (Tauri + SQLite WAL)
 */

import { OutboxEnvelope, SyncCursor, ConflictRecord, SyncStatus } from "./types";

export interface IOfflineStorageAdapter {
  init(): Promise<void>;

  // Outbox operations
  enqueueOutbox<T>(envelope: OutboxEnvelope<T>): Promise<void>;
  getOutboxQueue(): Promise<OutboxEnvelope[]>;
  updateOutboxStatus(
    id: string,
    status: SyncStatus,
    error?: string | null,
    serverRef?: { serverDocNum?: string; serverVersion?: number },
  ): Promise<void>;
  removeOutboxItem(id: string): Promise<void>;

  // Local entity cache/store operations
  getItem<T>(tableName: string, id: string): Promise<T | null>;
  getAll<T>(tableName: string, filter?: (item: T) => boolean): Promise<T[]>;
  setItem<T>(tableName: string, id: string, data: T): Promise<void>;
  deleteItem(tableName: string, id: string): Promise<void>;

  // Cursor & Metadata
  getCursor(tableName: string): Promise<SyncCursor | null>;
  setCursor(cursor: SyncCursor): Promise<void>;

  // Transactions & Reset
  clearAll(): Promise<void>;
}

/**
 * Web / Browser Fallback Adapter using IndexedDB / Storage
 */
export class WebStorageAdapter implements IOfflineStorageAdapter {
  private dbName = "markethub_offline_db";
  private outboxKey = "markethub_outbox";
  private cursorsKey = "markethub_cursors";
  private tablesPrefix = "markethub_table_";

  async init(): Promise<void> {
    if (typeof window === "undefined") return;
    if (!localStorage.getItem(this.outboxKey)) {
      localStorage.setItem(this.outboxKey, JSON.stringify([]));
    }
    if (!localStorage.getItem(this.cursorsKey)) {
      localStorage.setItem(this.cursorsKey, JSON.stringify({}));
    }
  }

  async enqueueOutbox<T>(envelope: OutboxEnvelope<T>): Promise<void> {
    const queue = await this.getOutboxQueue();
    queue.push(envelope as OutboxEnvelope);
    localStorage.setItem(this.outboxKey, JSON.stringify(queue));
  }

  async getOutboxQueue(): Promise<OutboxEnvelope[]> {
    try {
      const raw = localStorage.getItem(this.outboxKey);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  async updateOutboxStatus(
    id: string,
    status: SyncStatus,
    error?: string | null,
    serverRef?: { serverDocNum?: string; serverVersion?: number },
  ): Promise<void> {
    const queue = await this.getOutboxQueue();
    const item = queue.find((q) => q.id === id);
    if (item) {
      item.status = status;
      if (error !== undefined) item.last_error = error;
      if (status === "rejected" || status === "conflicted") {
        item.retry_count += 1;
      }
      if (serverRef?.serverDocNum) {
        item.server_document_number = serverRef.serverDocNum;
      }
      localStorage.setItem(this.outboxKey, JSON.stringify(queue));
    }
  }

  async removeOutboxItem(id: string): Promise<void> {
    const queue = await this.getOutboxQueue();
    const updated = queue.filter((q) => q.id !== id);
    localStorage.setItem(this.outboxKey, JSON.stringify(updated));
  }

  async getItem<T>(tableName: string, id: string): Promise<T | null> {
    const items = await this.getAll<T>(tableName);
    return items.find((i: any) => i.id === id) || null;
  }

  async getAll<T>(tableName: string, filter?: (item: T) => boolean): Promise<T[]> {
    try {
      const raw = localStorage.getItem(`${this.tablesPrefix}${tableName}`);
      const items: T[] = raw ? JSON.parse(raw) : [];
      return filter ? items.filter(filter) : items;
    } catch {
      return [];
    }
  }

  async setItem<T>(tableName: string, id: string, data: T): Promise<void> {
    const items = await this.getAll<any>(tableName);
    const idx = items.findIndex((i) => i.id === id);
    if (idx >= 0) {
      items[idx] = data;
    } else {
      items.push(data);
    }
    localStorage.setItem(`${this.tablesPrefix}${tableName}`, JSON.stringify(items));
  }

  async deleteItem(tableName: string, id: string): Promise<void> {
    const items = await this.getAll<any>(tableName);
    const updated = items.filter((i) => i.id !== id);
    localStorage.setItem(`${this.tablesPrefix}${tableName}`, JSON.stringify(updated));
  }

  async getCursor(tableName: string): Promise<SyncCursor | null> {
    try {
      const cursors = JSON.parse(localStorage.getItem(this.cursorsKey) || "{}");
      return cursors[tableName] || null;
    } catch {
      return null;
    }
  }

  async setCursor(cursor: SyncCursor): Promise<void> {
    const cursors = JSON.parse(localStorage.getItem(this.cursorsKey) || "{}");
    cursors[cursor.table_name] = cursor;
    localStorage.setItem(this.cursorsKey, JSON.stringify(cursors));
  }

  async clearAll(): Promise<void> {
    localStorage.removeItem(this.outboxKey);
    localStorage.removeItem(this.cursorsKey);
  }
}

/**
 * Tauri Desktop Adapter Skeleton (Ready for Phase 3 SQLite integration)
 */
export class TauriSQLiteAdapter implements IOfflineStorageAdapter {
  private fallback = new WebStorageAdapter();

  async init(): Promise<void> {
    // When window.__TAURI__ is available, initialize SQLite connection here.
    return this.fallback.init();
  }

  async enqueueOutbox<T>(envelope: OutboxEnvelope<T>): Promise<void> {
    return this.fallback.enqueueOutbox(envelope);
  }

  async getOutboxQueue(): Promise<OutboxEnvelope[]> {
    return this.fallback.getOutboxQueue();
  }

  async updateOutboxStatus(
    id: string,
    status: SyncStatus,
    error?: string | null,
    serverRef?: { serverDocNum?: string; serverVersion?: number },
  ): Promise<void> {
    return this.fallback.updateOutboxStatus(id, status, error, serverRef);
  }

  async removeOutboxItem(id: string): Promise<void> {
    return this.fallback.removeOutboxItem(id);
  }

  async getItem<T>(tableName: string, id: string): Promise<T | null> {
    return this.fallback.getItem<T>(tableName, id);
  }

  async getAll<T>(tableName: string, filter?: (item: T) => boolean): Promise<T[]> {
    return this.fallback.getAll<T>(tableName, filter);
  }

  async setItem<T>(tableName: string, id: string, data: T): Promise<void> {
    return this.fallback.setItem<T>(tableName, id, data);
  }

  async deleteItem(tableName: string, id: string): Promise<void> {
    return this.fallback.deleteItem(tableName, id);
  }

  async getCursor(tableName: string): Promise<SyncCursor | null> {
    return this.fallback.getCursor(tableName);
  }

  async setCursor(cursor: SyncCursor): Promise<void> {
    return this.fallback.setCursor(cursor);
  }

  async clearAll(): Promise<void> {
    return this.fallback.clearAll();
  }
}

let activeAdapter: IOfflineStorageAdapter | null = null;

export function getOfflineStorageAdapter(): IOfflineStorageAdapter {
  if (!activeAdapter) {
    if (typeof window !== "undefined" && (window as any).__TAURI__) {
      activeAdapter = new TauriSQLiteAdapter();
    } else {
      activeAdapter = new WebStorageAdapter();
    }
    activeAdapter.init();
  }
  return activeAdapter;
}

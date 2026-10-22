/**
 * Market-Hub ERP - Offline-First Hybrid Architecture Type Definitions
 * Phase 0 & Phase 1 Foundation
 */

export type SyncStatus = "synced" | "pending" | "rejected" | "conflicted";

export type SyncPriority = "high" | "medium" | "low";

export type SyncOperationType = "INSERT" | "UPDATE" | "DELETE" | "RPC";

export type ConflictResolutionStrategy =
  "SERVER_AUTHORITY" | "LOCAL_AUTHORITY" | "MANUAL_REVIEW" | "APPEND_ONLY_REVERSAL";

/**
 * Immutable Sync Outbox Envelope for offline transactions
 */
export interface OutboxEnvelope<T = Record<string, any>> {
  id: string; // UUIDv7 / UUID
  idempotency_key: string; // Deterministic idempotency key
  operation_id: string;
  entity_name: string; // e.g., 'sales_invoices', 'products', 'customers'
  operation_type: SyncOperationType;
  payload: T;
  priority: SyncPriority;
  dependencies: string[]; // List of prerequisite Outbox IDs
  origin_device_id: string;
  client_timestamp: string; // ISO 8601 string
  retry_count: number;
  max_retries: number;
  last_error: string | null;
  status: SyncStatus;
  local_document_ref: string | null; // e.g. 'POS-DEV1-20260930-001'
  server_document_number?: string | null; // Populated after server confirmation
}

/**
 * Incoming Sync Inbox Record from Server
 */
export interface InboxEnvelope<T = Record<string, any>> {
  id: string;
  entity_name: string;
  server_version: number;
  payload: T;
  server_timestamp: string;
  processed_locally: boolean;
}

/**
 * Server Sync Cursor tracking per table
 */
export interface SyncCursor {
  table_name: string;
  last_synced_at: string;
  last_server_version: number;
}

/**
 * Local Device Identity & Authority Grant
 */
export interface DeviceRegistration {
  device_id: string;
  device_name: string;
  platform: "desktop_tauri" | "web_pwa" | "browser";
  assigned_warehouse_id: string | null;
  registered_at: string;
  is_active: boolean;
}

export interface OfflineAuthorityGrant {
  grant_id: string;
  device_id: string;
  user_id: string;
  role: "owner" | "manager" | "accountant" | "cashier" | "warehouse";
  allowed_warehouses: string[];
  expires_at: string; // ISO 8601 string
  signature: string; // HMAC / JWT token signature from server
}

/**
 * Conflict Detail Record for manual or automated resolution
 */
export interface ConflictRecord<T = any> {
  id: string;
  outbox_id: string;
  entity_name: string;
  local_record: T;
  server_record: T;
  conflict_reason: string;
  strategy: ConflictResolutionStrategy;
  created_at: string;
  resolved_at?: string | null;
  resolution_notes?: string | null;
}

/**
 * Generic Audit Event for Local Persistence
 */
export interface LocalAuditEvent {
  id: string;
  device_id: string;
  user_id: string;
  action: string;
  entity_name: string;
  entity_id: string;
  timestamp: string;
  details: Record<string, any>;
}

/**
 * Core Health & Sync Engine Telemetry
 */
export interface SyncEngineStatus {
  is_online: boolean;
  is_syncing: boolean;
  pending_count: number;
  conflicted_count: number;
  rejected_count: number;
  last_successful_sync: string | null;
  last_error: string | null;
  device_id: string;
}

export interface AuthSnapshot {
  user_id: string;
  email?: string;
  role?: string;
  cached_at: string;
  session_token?: string;
  user_metadata?: Record<string, any>;
}

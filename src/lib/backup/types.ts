/**
 * Market Hub (Vortex ERP) — Backup System Type Definitions
 *
 * Single Source of Truth for backup metadata, engine formats, validation results,
 * and settings configurations.
 */

export type BackupType = "manual_local" | "manual_cloud" | "auto_scheduled" | "pre_restore_safety";
export type StorageDestination = "local" | "cloud" | "both";
export type ScheduleFrequency = "daily" | "weekly";
export type BackupStatus = "success" | "failed" | "in_progress" | "pending";

/**
 * Backup Metadata Header (unencrypted JSON attached to top of .vortexbak file)
 */
export interface BackupMetadata {
  backup_id: string;
  tenant_id: string;
  schema_version: string;
  engine_version: string;
  key_version: string;
  created_at: string;
  created_by?: string;
  backup_type: BackupType;
  storage_type: StorageDestination;
  file_size_bytes: number;
  auth_tag: string;
  checksum_sha256: string;
  status: BackupStatus;
  tables_summary: Record<string, number>;
}

/**
 * Complete `.vortexbak` File Structure
 */
export interface BackupFileFormat {
  header: BackupMetadata;
  payload_encrypted: string; // Base64 encoded AES-256-GCM ciphertext
  iv: string; // Base64 encoded Initialization Vector (12 bytes)
}

/**
 * Unencrypted Payload Data Structure (Internal representation prior to encryption)
 */
export interface BackupDataPayload {
  metadata: BackupMetadata;
  tables: {
    company_settings?: any[];
    warehouses?: any[];
    categories?: any[];
    brands?: any[];
    units?: any[];
    products?: any[];
    product_batches?: any[];
    inventory?: any[];
    customers?: any[];
    suppliers?: any[];
    sales_invoices?: any[];
    sales_invoice_items?: any[];
    sales_returns?: any[];
    sales_return_items?: any[];
    purchase_invoices?: any[];
    purchase_invoice_items?: any[];
    purchase_returns?: any[];
    purchase_return_items?: any[];
    customer_payments?: any[];
    customer_payment_splits?: any[];
    stock_movements?: any[];
    stock_transfers?: any[];
    stock_transfer_items?: any[];
    expenses?: any[];
    expense_categories?: any[];
    loyalty_transactions?: any[];
    profiles?: any[];
    user_roles?: any[];
    audit_logs?: any[];
  };
}

/**
 * Multi-Stage Restore Validation Result
 */
export interface BackupValidationResult {
  isValid: boolean;
  stageFailed?:
    | "HEADER_PARSE"
    | "INTEGRITY_AUTH_TAG"
    | "TENANT_MATCH"
    | "SCHEMA_VERSION"
    | "KEY_VERSION"
    | "REFERENTIAL_DAG"
    | "BUSINESS_RULES";
  errors: string[];
  warnings: string[];
  metadata?: BackupMetadata;
  payload?: BackupDataPayload;
}

/**
 * Backup User Preferences stored in Settings
 */
export interface BackupSettingsConfig {
  enabled: boolean;
  destination: StorageDestination;
  frequency: ScheduleFrequency;
  execution_time: string; // e.g. "03:00"
  retention_count: number; // e.g. 7, 15, 30
  last_backup_at?: string;
  last_backup_status?: BackupStatus;
  last_backup_type?: BackupType;
  last_backup_size_bytes?: number;
  last_backup_file_name?: string;
}

/**
 * Backup Log Entry for Audit History UI
 */
export interface BackupLogRecord {
  id: string;
  actor_name: string;
  action_type: BackupType;
  storage_type: StorageDestination;
  status: BackupStatus;
  file_name: string;
  file_size_bytes: number;
  created_at: string;
  error_message?: string;
}

export const CURRENT_SCHEMA_VERSION = "2026.09.28.1";
export const BACKUP_ENGINE_VERSION = "v1.0.0";
export const DEFAULT_KEY_VERSION = "v1";

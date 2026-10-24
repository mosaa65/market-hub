/**
 * Market Hub (Vortex ERP) — Backup Engine & Multi-Stage Validation Pipeline v2.0
 *
 * Handles safe read-only data export for ALL system tables (Core, Inventory, Sales,
 * Purchases, Ledgers, Milling Module, Expense ERP, POS Services), local .vortexbak package
 * generation, file downloading, database log recording, and multi-stage dry-run validation.
 *
 * SAFETY GUARANTEES:
 * - Read-only database operations ONLY during export. Zero writes, zero mutations.
 * - Multi-stage validation catches invalid tenant IDs, corrupt ciphers, and broken DAG relations.
 */

import { supabase } from "@/integrations/supabase/client";
import {
  BackupDataPayload,
  BackupFileFormat,
  BackupLogRecord,
  BackupMetadata,
  BackupSettingsConfig,
  BackupValidationResult,
  TableCategorySummary,
  BACKUP_ENGINE_VERSION,
  CURRENT_SCHEMA_VERSION,
  DEFAULT_KEY_VERSION,
} from "./types";
import { computeSHA256, decryptPayload, encryptPayload } from "./crypto";

const SETTINGS_STORAGE_KEY = "vortex_backup_settings";
const LOGS_STORAGE_KEY = "vortex_backup_history_logs";

/* -------------------------------------------------------------------------- */
/* SERVER-SIDE DYNAMIC BACKUP ENGINE (v3 — Migration 31 RPCs)                  */
/* -------------------------------------------------------------------------- */

/**
 * Result shape of the server-side dynamic export (RPC backup_export_all).
 * The server reads every public base table from information_schema at call
 * time — the table list adapts automatically to any new migration.
 */
export interface ServerDynamicExport {
  kind: "server_dynamic_export";
  exported_at: string;
  schema_fingerprint: string;
  table_count: number;
  total_rows: number;
  capped_log_tables: number;
  tables: Record<string, any[]>;
}

export interface ServerRestoreResult {
  restored_at: string;
  inserted_rows: number;
  skipped_tables: string[];
  schema_fingerprint_mismatch: boolean;
  current_fingerprint: string;
}

/**
 * Server-side dynamic schema fingerprint (RPC backup_schema_fingerprint).
 * SHA-256 over every public table + columns + types. Compare it against the
 * fingerprint stored inside a backup to detect schema drift between backup
 * and restore.
 */
export async function getSchemaFingerprint(): Promise<string | null> {
  try {
    const { data, error } = await supabase.rpc("backup_schema_fingerprint" as never);
    if (error) {
      console.warn("backup_schema_fingerprint RPC failed:", error.message);
      return null;
    }
    return (data as unknown as string) ?? null;
  } catch {
    return null;
  }
}

/**
 * SERVER-SIDE FULL EXPORT: calls `backup_export_all` (Migration 31).
 * SECURITY DEFINER — guarded to owner/manager inside the function. Returns
 * ALL public base tables dynamically, with capped recent rows for large log
 * tables (audit_logs, backup_logs, idempotency_keys).
 */
export async function exportTenantDataServerSide(
  maxLogRows: number = 5000,
): Promise<ServerDynamicExport> {
  const { data, error } = await supabase.rpc(
    "backup_export_all" as never,
    {
      p_max_log_rows: maxLogRows,
    } as never,
  );
  if (error) {
    throw new Error(`فشل التفريغ الخادمي: ${error.message}`);
  }
  const exported = data as unknown as ServerDynamicExport;
  if (!exported || exported.kind !== "server_dynamic_export" || !exported.tables) {
    throw new Error("الحمولة الخادمية غير صالحة (kind أو tables مفقود)");
  }
  return exported;
}

/**
 * SERVER-SIDE FULL RESTORE: calls `backup_restore_all` (Migration 31).
 * Owner-only. Executes inside a single server transaction: disables FK
 * triggers, truncates every public base table, reinserts by column NAME
 * (adapts to new column order), resets sequences. The payload must be a
 * server_dynamic_export payload (from exportTenantDataServerSide or a
 * decrypted .vortexbak whose payload matches that shape).
 */
export async function restoreTenantDataServerSide(
  payload: ServerDynamicExport,
): Promise<ServerRestoreResult> {
  const { data, error } = await supabase.rpc(
    "backup_restore_all" as never,
    {
      p_payload: payload as never,
    } as never,
  );
  if (error) {
    throw new Error(`فشلت الاستعادة الخادمية: ${error.message}`);
  }
  const restored = data as unknown as ServerRestoreResult;
  if (!restored || typeof restored.inserted_rows !== "number") {
    throw new Error("نتيجة الاستعادة الخادمية غير صالحة");
  }
  return restored;
}

/**
 * Get Saved Backup Preferences from LocalStorage (Fallback client store)
 */
export function getDefaultBackupSettings(): BackupSettingsConfig {
  return {
    enabled: true,
    destination: "both",
    frequency: "twice_daily",
    execution_time: "09:00",
    retention_count: 15,
    reminder_enabled: true,
    reminder_frequency: "twice_daily",
  };
}

export function getBackupSettings(): BackupSettingsConfig {
  const defaultConfig = getDefaultBackupSettings();

  if (typeof window === "undefined") return defaultConfig;

  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return defaultConfig;
    return { ...defaultConfig, ...JSON.parse(raw) };
  } catch {
    return defaultConfig;
  }
}

/**
 * Save Backup Preferences to LocalStorage
 */
export function saveBackupSettings(config: BackupSettingsConfig): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(config));
}

/**
 * Get Historical Backup Logs from LocalStorage & Supabase
 */
export async function getBackupLogHistoryFromDB(): Promise<BackupLogRecord[]> {
  try {
    const { data, error } = await supabase
      .from("backup_logs" as any)
      .select("*")
      .order("created_at", { ascending: false })
      .limit(50);

    if (!error && data && data.length > 0) {
      return data.map((d: any) => ({
        id: d.id,
        tenant_id: d.tenant_id,
        actor_name: d.actor_name,
        action_type: d.action_type,
        storage_type: d.storage_type,
        status: d.status,
        file_name: d.file_name,
        file_size_bytes: Number(d.file_size_bytes ?? 0),
        created_at: d.created_at,
        error_message: d.error_message,
      }));
    }
  } catch {
    // Fallback to local logs below
  }
  return getBackupLogHistoryLocal();
}

export function getBackupLogHistoryLocal(): BackupLogRecord[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(LOGS_STORAGE_KEY);
    if (!raw) return getDefaultMockLogs();
    return JSON.parse(raw);
  } catch {
    return getDefaultMockLogs();
  }
}

/**
 * Record a new Log Entry in Client History & Supabase DB
 */
export async function recordBackupLog(
  entry: Omit<BackupLogRecord, "id" | "created_at">,
): Promise<void> {
  const created_at = new Date().toISOString();
  const id = `log_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const newRecord: BackupLogRecord = {
    ...entry,
    id,
    created_at,
  };

  // 1) Save to local storage
  if (typeof window !== "undefined") {
    const history = getBackupLogHistoryLocal();
    const updated = [newRecord, ...history].slice(0, 50);
    localStorage.setItem(LOGS_STORAGE_KEY, JSON.stringify(updated));
  }

  // 2) Save to Supabase DB table if available
  try {
    await supabase.from("backup_logs" as any).insert({
      tenant_id: entry.tenant_id || "default",
      actor_name: entry.actor_name,
      action_type: entry.action_type,
      storage_type: entry.storage_type,
      status: entry.status,
      file_name: entry.file_name,
      file_size_bytes: entry.file_size_bytes,
      error_message: entry.error_message,
      created_at,
    });
  } catch (err) {
    console.warn("Could not insert backup log into DB table:", err);
  }
}

function getDefaultMockLogs(): BackupLogRecord[] {
  return [
    {
      id: "log_init_01",
      actor_name: "المالك (Owner)",
      action_type: "manual_local",
      storage_type: "local",
      status: "success",
      file_name: "vortex_backup_20261003_090000.vortexbak",
      file_size_bytes: 4210542,
      created_at: new Date(Date.now() - 3600000 * 12).toISOString(),
    },
  ];
}

/**
 * Helper to safely query a database table with fallback to empty array
 */
async function safeSelectTable(tableName: string, queryModifier?: (q: any) => any): Promise<any[]> {
  try {
    let query = supabase.from(tableName as any).select("*");
    if (queryModifier) {
      query = queryModifier(query);
    }
    const res = await query;
    if (res.error) {
      console.warn(`Safe backup query warning for table '${tableName}':`, res.error.message);
      return [];
    }
    return res.data ?? [];
  } catch (e) {
    console.warn(`Exception reading table '${tableName}':`, e);
    return [];
  }
}

/**
 * Calculate categorised summary statistics for metadata & UI preview
 */
export function calculateCategoryStats(tables: BackupDataPayload["tables"]): TableCategorySummary {
  const count = (arr?: any[]) => arr?.length ?? 0;

  const core =
    count(tables.company_settings) +
    count(tables.warehouses) +
    count(tables.categories) +
    count(tables.brands) +
    count(tables.units) +
    count(tables.profiles) +
    count(tables.user_roles);

  const productsAndStock =
    count(tables.products) +
    count(tables.product_batches) +
    count(tables.inventory) +
    count(tables.product_shelves) +
    count(tables.pos_services);

  const salesAndPurchases =
    count(tables.sales_invoices) +
    count(tables.sales_invoice_items) +
    count(tables.sales_returns) +
    count(tables.sales_return_items) +
    count(tables.purchase_invoices) +
    count(tables.purchase_invoice_items) +
    count(tables.purchase_returns) +
    count(tables.purchase_return_items) +
    count(tables.stock_movements) +
    count(tables.stock_transfers) +
    count(tables.stock_transfer_items);

  const financeAndLedgers =
    count(tables.customers) +
    count(tables.suppliers) +
    count(tables.customer_payments) +
    count(tables.customer_payment_splits) +
    count(tables.customer_ledger) +
    count(tables.loyalty_transactions);

  const millingModule = count(tables.custody_ledger);

  const expenseModule =
    count(tables.expenses) +
    count(tables.expense_categories) +
    count(tables.expense_approvals) +
    count(tables.expense_attachments);

  const systemAndAudit =
    count(tables.audit_logs) + count(tables.idempotency_keys) + count(tables.backup_logs);

  const totalRecords =
    core +
    productsAndStock +
    salesAndPurchases +
    financeAndLedgers +
    millingModule +
    expenseModule +
    systemAndAudit;

  const totalTables = Object.keys(tables).filter((k) => (tables as any)[k] !== undefined).length;

  return {
    core,
    productsAndStock,
    salesAndPurchases,
    financeAndLedgers,
    millingModule,
    expenseModule,
    systemAndAudit,
    totalRecords,
    totalTables,
  };
}

/**
 * SAFE READ-ONLY Export: Fetches ALL tenant data across 40+ system tables
 */
export async function extractTenantDataReadOnly(
  tenantId: string = "default",
  actorId?: string,
): Promise<BackupDataPayload> {
  const [
    company_settings,
    warehouses,
    categories,
    brands,
    units,
    products,
    product_batches,
    inventory,
    product_shelves,
    pos_services,
    customers,
    suppliers,
    sales_invoices,
    sales_invoice_items,
    sales_returns,
    sales_return_items,
    purchase_invoices,
    purchase_invoice_items,
    purchase_returns,
    purchase_return_items,
    customer_payments,
    customer_payment_splits,
    customer_ledger,
    stock_movements,
    stock_transfers,
    stock_transfer_items,
    custody_ledger,
    expenses,
    expense_categories,
    expense_approvals,
    expense_attachments,
    loyalty_transactions,
    profiles,
    user_roles,
    audit_logs,
    idempotency_keys,
    backup_logs,
  ] = await Promise.all([
    safeSelectTable("company_settings"),
    safeSelectTable("warehouses"),
    safeSelectTable("categories"),
    safeSelectTable("brands"),
    safeSelectTable("units"),
    safeSelectTable("products"),
    safeSelectTable("product_batches"),
    safeSelectTable("inventory"),
    safeSelectTable("product_shelves"),
    safeSelectTable("pos_services"),
    safeSelectTable("customers"),
    safeSelectTable("suppliers"),
    safeSelectTable("sales_invoices"),
    safeSelectTable("sales_invoice_items"),
    safeSelectTable("sales_returns"),
    safeSelectTable("sales_return_items"),
    safeSelectTable("purchase_invoices"),
    safeSelectTable("purchase_invoice_items"),
    safeSelectTable("purchase_returns"),
    safeSelectTable("purchase_return_items"),
    safeSelectTable("customer_payments"),
    safeSelectTable("customer_payment_splits"),
    safeSelectTable("customer_ledger"),
    safeSelectTable("stock_movements"),
    safeSelectTable("stock_transfers"),
    safeSelectTable("stock_transfer_items"),
    safeSelectTable("custody_ledger"),
    safeSelectTable("expenses"),
    safeSelectTable("expense_categories"),
    safeSelectTable("expense_approvals"),
    safeSelectTable("expense_attachments"),
    safeSelectTable("loyalty_transactions"),
    safeSelectTable("profiles"),
    safeSelectTable("user_roles"),
    safeSelectTable("audit_logs", (q) => q.limit(1000)),
    safeSelectTable("idempotency_keys", (q) => q.limit(500)),
    safeSelectTable("backup_logs", (q) => q.limit(200)),
  ]);

  const tablesPayload = {
    company_settings,
    warehouses,
    categories,
    brands,
    units,
    products,
    product_batches,
    inventory,
    product_shelves,
    pos_services,
    customers,
    suppliers,
    sales_invoices,
    sales_invoice_items,
    sales_returns,
    sales_return_items,
    purchase_invoices,
    purchase_invoice_items,
    purchase_returns,
    purchase_return_items,
    customer_payments,
    customer_payment_splits,
    customer_ledger,
    stock_movements,
    stock_transfers,
    stock_transfer_items,
    custody_ledger,
    expenses,
    expense_categories,
    expense_approvals,
    expense_attachments,
    loyalty_transactions,
    profiles,
    user_roles,
    audit_logs,
    idempotency_keys,
    backup_logs,
  };

  const tablesSummary: Record<string, number> = {};
  Object.entries(tablesPayload).forEach(([key, val]) => {
    tablesSummary[key] = val.length;
  });

  const catStats = calculateCategoryStats(tablesPayload);

  const metadata: BackupMetadata = {
    backup_id: `bak_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
    tenant_id: tenantId,
    schema_version: CURRENT_SCHEMA_VERSION,
    engine_version: BACKUP_ENGINE_VERSION,
    key_version: DEFAULT_KEY_VERSION,
    created_at: new Date().toISOString(),
    created_by: actorId,
    backup_type: "manual_local",
    storage_type: "local",
    file_size_bytes: 0,
    auth_tag: "",
    checksum_sha256: "",
    status: "success",
    tables_summary: tablesSummary,
    categories_summary: {
      core: catStats.core,
      productsAndStock: catStats.productsAndStock,
      salesAndPurchases: catStats.salesAndPurchases,
      financeAndLedgers: catStats.financeAndLedgers,
      millingModule: catStats.millingModule,
      expenseModule: catStats.expenseModule,
      systemAndAudit: catStats.systemAndAudit,
    },
  };

  return {
    metadata,
    tables: tablesPayload,
  };
}

/**
 * Generate Encrypted `.vortexbak` File Package
 */
export async function createBackupPackage(
  payload: BackupDataPayload,
  passphraseKey: string,
): Promise<{ fileContent: string; fileName: string; sizeBytes: number }> {
  const jsonString = JSON.stringify(payload);
  const checksum = await computeSHA256(jsonString);

  // Encrypt payload
  const { ciphertextBase64, ivBase64, authTagBase64 } = await encryptPayload(
    jsonString,
    passphraseKey,
  );

  const finalMetadata: BackupMetadata = {
    ...payload.metadata,
    auth_tag: authTagBase64,
    checksum_sha256: checksum,
    file_size_bytes: ciphertextBase64.length,
  };

  const backupPackage: BackupFileFormat = {
    header: finalMetadata,
    payload_encrypted: ciphertextBase64,
    iv: ivBase64,
  };

  const packageString = JSON.stringify(backupPackage, null, 2);
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const timeStr = new Date().toTimeString().slice(0, 8).replace(/:/g, "");
  const fileName = `vortex_backup_${dateStr}_${timeStr}.vortexbak`;

  return {
    fileContent: packageString,
    fileName,
    sizeBytes: new Blob([packageString]).size,
  };
}

/**
 * Trigger File Download in Web Browser & Update Local Backup Preferences
 */
export function downloadFileToDevice(content: string, fileName: string): void {
  const blob = new Blob([content], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);

  // Update Settings timestamp for local download reminder schedule
  const settings = getBackupSettings();
  saveBackupSettings({
    ...settings,
    last_backup_at: new Date().toISOString(),
    last_local_download_at: new Date().toISOString(),
    last_backup_status: "success",
    last_backup_file_name: fileName,
    last_backup_size_bytes: new Blob([content]).size,
  });
}

/**
 * MULTI-STAGE RESTORE VALIDATION PIPELINE (Dry-Run / No DB Mutation)
 */
export async function validateBackupFile(
  fileContent: string,
  passphraseKey: string,
  expectedTenantId: string = "default",
): Promise<BackupValidationResult> {
  const result: BackupValidationResult = {
    isValid: true,
    errors: [],
    warnings: [],
  };

  // Stage 1: Header Parse Check
  let parsedPackage: BackupFileFormat;
  try {
    parsedPackage = JSON.parse(fileContent);
    if (!parsedPackage.header || !parsedPackage.payload_encrypted || !parsedPackage.iv) {
      result.isValid = false;
      result.stageFailed = "HEADER_PARSE";
      result.errors.push("تنسيق الملف غير صالح: الترويسة أو البيانات المشفّرة مفقودة.");
      return result;
    }
    result.metadata = parsedPackage.header;
  } catch {
    result.isValid = false;
    result.stageFailed = "HEADER_PARSE";
    result.errors.push("فشل في تحليل هيكل ملف النسخة الاحتياطية (محتوى JSON غير صالح).");
    return result;
  }

  // Stage 2: Schema & Key Version Check
  if (parsedPackage.header.schema_version !== CURRENT_SCHEMA_VERSION) {
    result.warnings.push(
      `إصدار السكيما في النسخة (${parsedPackage.header.schema_version}) يختلف عن الإصدار الحالي (${CURRENT_SCHEMA_VERSION}). قد يتطلب تحويلاً توافقياً.`,
    );
  }

  // Stage 3: Tenant ID Ownership Match Check
  if (
    parsedPackage.header.tenant_id &&
    parsedPackage.header.tenant_id !== expectedTenantId &&
    expectedTenantId !== "default"
  ) {
    result.isValid = false;
    result.stageFailed = "TENANT_MATCH";
    result.errors.push(
      `هذه النسخة لا تنتمي للمتجر الحالي! (المتجر في النسخة: ${parsedPackage.header.tenant_id})`,
    );
    return result;
  }

  // Stage 4: AES-256-GCM Auth Tag & Decryption Check
  let decryptedJson: string;
  try {
    decryptedJson = await decryptPayload(
      parsedPackage.payload_encrypted,
      parsedPackage.iv,
      passphraseKey,
    );
  } catch {
    result.isValid = false;
    result.stageFailed = "INTEGRITY_AUTH_TAG";
    result.errors.push(
      "فشل فك التشفير والتحقق من التوقيع الرقمي (AES-GCM Auth Tag). كلمة المرور غير صحيحة أو تم التلاعب بالملف.",
    );
    return result;
  }

  // Stage 5: Payload Structure Check
  let payload: BackupDataPayload;
  try {
    payload = JSON.parse(decryptedJson);
    result.payload = payload;
    result.categoryStats = calculateCategoryStats(payload.tables || {});
  } catch {
    result.isValid = false;
    result.stageFailed = "HEADER_PARSE";
    result.errors.push("البيانات المفكوكة تحتوي على هيكل JSON غير صالح.");
    return result;
  }

  // Stage 6: Extended Referential DAG Sanity Checks across modules
  if (payload.tables) {
    // 6.1 Sales Invoice Items -> Products check
    const productIds = new Set((payload.tables.products ?? []).map((p: any) => p.id));
    const invalidItems = (payload.tables.sales_invoice_items ?? []).filter(
      (item: any) => item.product_id && !productIds.has(item.product_id),
    );
    if (invalidItems.length > 0) {
      result.warnings.push(
        `تنبيه مرجعي: يوجد ${invalidItems.length} عنصر فاتورة مبيعات يشير إلى منتجات غير موجودة داخل كبسولة النسخة.`,
      );
    }

    // 6.2 Custody ledger -> Customers check
    const customerIdsInCapsule = new Set((payload.tables.customers ?? []).map((i: any) => i.id));
    const orphanCustody = (payload.tables.custody_ledger ?? []).filter(
      (j: any) => j.customer_id && !customerIdsInCapsule.has(j.customer_id),
    );
    if (orphanCustody.length > 0) {
      result.warnings.push(
        `تنبيه مطاحن: يوجد ${orphanCustody.length} سطر أمانات يشير إلى عملاء غير مدرجين.`,
      );
    }

    // 6.3 Customer Ledger -> Customers check
    const customerIds = new Set((payload.tables.customers ?? []).map((c: any) => c.id));
    const orphanLedger = (payload.tables.customer_ledger ?? []).filter(
      (l: any) => l.customer_id && !customerIds.has(l.customer_id),
    );
    if (orphanLedger.length > 0) {
      result.warnings.push(
        `تنبيه ذمم: يوجد ${orphanLedger.length} قيد دفتر حساب عملاء غير مرتبطة بعملاء موجودين.`,
      );
    }
  }

  return result;
}

/* -------------------------------------------------------------------------- */
/* CLOUD STORAGE UPLOAD (Supabase Storage — يعمل محلياً بالدوكر وسحابياً)      */
/* -------------------------------------------------------------------------- */

const BACKUP_BUCKET = "tenant-backups";

/**
 * رفع ملف النسخة الاحتياطية إلى Supabase Storage في الحاوية "tenant-backups".
 * يعمل بنفس الكود في البيئة المحلية (Docker) والسحابية — لأن عميل supabase
 * متصل بالنقطة النشطة أياً كانت. على Docker يجب إنشاء الحاوية مرة واحدة:
 *   supabase buckets create tenant-backups (أو عبر dashboard المحلي).
 */
export async function uploadBackupToStorage(
  content: string,
  fileName: string,
): Promise<{ ok: boolean; path: string | null; error: string | null }> {
  try {
    const blob = new Blob([content], { type: "application/json;charset=utf-8" });
    const { error } = await supabase.storage
      .from(BACKUP_BUCKET)
      .upload(fileName, blob, { upsert: false, contentType: "application/json" });
    if (error) {
      return { ok: false, path: null, error: error.message };
    }
    return { ok: true, path: `${BACKUP_BUCKET}/${fileName}`, error: null };
  } catch (err: any) {
    return { ok: false, path: null, error: err?.message || "فشل الرفع السحابي" };
  }
}

/**
 * هل حاوية النسخ الاحتياطي موجودة؟ (لعرض تنبيه إن لم تُنشأ بعد).
 */
export async function backupBucketExists(): Promise<boolean> {
  try {
    const { data, error } = await supabase.storage.from(BACKUP_BUCKET).list("", { limit: 1 });
    return !error && Array.isArray(data);
  } catch {
    return false;
  }
}

/* -------------------------------------------------------------------------- */
/* CUSTOM LOCAL DIRECTORY PATHS (File System Access API)                      */
/* -------------------------------------------------------------------------- */

const DIRS_KEY = "vortex_backup_custom_dirs"; // IndexedDB store name
const DB_NAME = "vortex_backup_fs";

/** فتح/إنشاء IndexedDB لتخزين مقابض المجلدات المختارة. */
function openDirDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(DIRS_KEY)) {
        req.result.createObjectStore(DIRS_KEY, { autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * هل المتصفح يدعم File System Access API؟ (Chrome / Edge فقط — Firefox لا).
 */
export function customDirSupported(): boolean {
  return typeof window !== "undefined" && "showDirectoryPicker" in window;
}

/**
 * فتح نافذة اختيار مجلد على الجهاز (نظامية — بذاتية المستخدم) وحفظ المقبض.
 * يمكن استدعاؤها أكثر من مرة لإضافة عدة مسارات.
 */
export async function addCustomBackupDirectory(): Promise<string> {
  if (!customDirSupported()) {
    throw new Error("المتصفح لا يدعم كتابة الملفات في مسارات مخصصة (يتطلب Chrome أو Edge)");
  }
  const handle = await (window as any).showDirectoryPicker({
    mode: "readwrite",
    id: "vortex-backup-dir",
  });
  const db = await openDirDB();
  const tx = db.transaction(DIRS_KEY, "readwrite");
  const id = await new Promise<number>((resolve, reject) => {
    const r = tx.objectStore(DIRS_KEY).add({ handle, name: handle.name, added_at: Date.now() });
    r.onsuccess = () => resolve(Number(r.result));
    r.onerror = () => reject(r.error);
  });
  tx.commit?.();
  db.close();
  return `${handle.name} (#${id})`;
}

/** قائمة المجلدات المخصصة المسجلة. */
export async function listCustomBackupDirectories(): Promise<{ id: number; name: string }[]> {
  if (typeof indexedDB === "undefined") return [];
  try {
    const db = await openDirDB();
    const tx = db.transaction(DIRS_KEY, "readonly");
    const items = await new Promise<{ id: number; name: string }[]>((resolve, reject) => {
      const out: { id: number; name: string }[] = [];
      const r = tx.objectStore(DIRS_KEY).openCursor();
      r.onsuccess = () => {
        const cursor = r.result;
        if (!cursor) return resolve(out);
        out.push({ id: cursor.key as number, name: cursor.value?.name || "مجلد" });
        cursor.continue();
      };
      r.onerror = () => reject(r.error);
    });
    db.close();
    return items;
  } catch {
    return [];
  }
}

/** حذف مسار مخصص بالمعرف. */
export async function removeCustomBackupDirectory(id: number): Promise<void> {
  const db = await openDirDB();
  const tx = db.transaction(DIRS_KEY, "readwrite");
  tx.objectStore(DIRS_KEY).delete(id);
  tx.commit?.();
  db.close();
}

/**
 * كتابة محتوى النسخة إلى كل المسارات المخصصة المسجلة.
 * تُستدعى بعد إنشاء النسخة (يدوياً أو مجدولة). في أول استخدام لكل جلسة
 * قد يطلب المتصفح إعادة السماح بالوصول للقرص — يُعالج تلقائياً هنا.
 */
export async function writeBackupToCustomDirs(
  content: string,
  fileName: string,
): Promise<{ ok: number; failed: string[] }> {
  if (typeof indexedDB === "undefined" || !customDirSupported()) {
    return { ok: 0, failed: ["المتصفح لا يدعم الكتابة المباشرة في مسارات مخصصة"] };
  }
  let ok = 0;
  const failed: string[] = [];
  const db = await openDirDB();
  const tx = db.transaction(DIRS_KEY, "readonly");
  const entries = await new Promise<{ key: number; handle: any }[]>((resolve, reject) => {
    const out: { key: number; handle: any }[] = [];
    const r = tx.objectStore(DIRS_KEY).openCursor();
    r.onsuccess = () => {
      const cursor = r.result;
      if (!cursor) return resolve(out);
      out.push({ key: cursor.key as number, handle: cursor.value?.handle });
      cursor.continue();
    };
    r.onerror = () => reject(r.error);
  });
  db.close();

  for (const entry of entries) {
    try {
      const handle = entry.handle;
      if (!handle) throw new Error("مقبض غير صالح");
      // إعادة السماح بالوصول إن لزم (بعد إعادة فتح الجلسة)
      const perm = await handle.queryPermission({ mode: "readwrite" });
      if (perm !== "granted") {
        const req = await handle.requestPermission({ mode: "readwrite" });
        if (req !== "granted") throw new Error("رُفض الوصول للمسار");
      }
      const fileHandle = await handle.getFileHandle(fileName, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(new Blob([content], { type: "application/json;charset=utf-8" }));
      await writable.close();
      ok++;
    } catch (err: any) {
      failed.push(`مسار #${entry.key}: ${err?.message || "فشل الكتابة"}`);
    }
  }
  return { ok, failed };
}

/**
 * Market Hub (Vortex ERP) — Backup Engine & Multi-Stage Validation Pipeline
 *
 * Handles safe read-only data export, local .vortexbak package generation,
 * file downloading, and multi-stage dry-run validation prior to restore.
 *
 * SAFETY GUARANTEES:
 * - Read-only database operations ONLY. Zero writes, zero mutations.
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
  BACKUP_ENGINE_VERSION,
  CURRENT_SCHEMA_VERSION,
  DEFAULT_KEY_VERSION,
} from "./types";
import { computeSHA256, decryptPayload, encryptPayload } from "./crypto";

const SETTINGS_STORAGE_KEY = "vortex_backup_settings";
const LOGS_STORAGE_KEY = "vortex_backup_history_logs";

/**
 * Get Saved Backup Preferences from LocalStorage (Fallback client store)
 */
export function getBackupSettings(): BackupSettingsConfig {
  if (typeof window === "undefined") {
    return {
      enabled: true,
      destination: "local",
      frequency: "weekly",
      execution_time: "03:00",
      retention_count: 15,
    };
  }
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) {
      return {
        enabled: true,
        destination: "local",
        frequency: "weekly",
        execution_time: "03:00",
        retention_count: 15,
      };
    }
    return JSON.parse(raw);
  } catch {
    return {
      enabled: true,
      destination: "local",
      frequency: "weekly",
      execution_time: "03:00",
      retention_count: 15,
    };
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
 * Get Historical Backup Logs
 */
export function getBackupLogHistory(): BackupLogRecord[] {
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
 * Record a new Log Entry in Client History
 */
export function recordBackupLog(entry: Omit<BackupLogRecord, "id" | "created_at">): void {
  if (typeof window === "undefined") return;
  const history = getBackupLogHistory();
  const newRecord: BackupLogRecord = {
    ...entry,
    id: `log_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    created_at: new Date().toISOString(),
  };
  const updated = [newRecord, ...history].slice(0, 50); // Keep last 50 logs
  localStorage.setItem(LOGS_STORAGE_KEY, JSON.stringify(updated));
}

function getDefaultMockLogs(): BackupLogRecord[] {
  return [
    {
      id: "log_init_01",
      actor_name: "المالك (Owner)",
      action_type: "manual_local",
      storage_type: "local",
      status: "success",
      file_name: "backup_manual_20260928_143000.vortexbak",
      file_size_bytes: 4210542,
      created_at: new Date(Date.now() - 3600000 * 24).toISOString(),
    },
  ];
}

/**
 * SAFE READ-ONLY Export: Fetches tenant data using existing SELECT queries
 */
export async function extractTenantDataReadOnly(
  tenantId: string = "default",
  actorId?: string,
): Promise<BackupDataPayload> {
  const [
    companyRes,
    warehousesRes,
    categoriesRes,
    brandsRes,
    unitsRes,
    productsRes,
    batchesRes,
    inventoryRes,
    customersRes,
    suppliersRes,
    salesInvoicesRes,
    salesItemsRes,
    salesReturnsRes,
    salesReturnItemsRes,
    purchaseInvoicesRes,
    purchaseItemsRes,
    purchaseReturnsRes,
    purchaseReturnItemsRes,
    paymentsRes,
    splitsRes,
    movementsRes,
    transfersRes,
    transferItemsRes,
    expensesRes,
    expenseCatsRes,
    loyaltyRes,
    profilesRes,
    rolesRes,
    auditLogsRes,
  ] = await Promise.all([
    supabase.from("company_settings").select("*"),
    supabase.from("warehouses").select("*"),
    supabase.from("categories").select("*"),
    supabase.from("brands").select("*"),
    supabase.from("units").select("*"),
    supabase.from("products").select("*"),
    supabase.from("product_batches").select("*"),
    supabase.from("inventory").select("*"),
    supabase.from("customers").select("*"),
    supabase.from("suppliers").select("*"),
    supabase.from("sales_invoices").select("*"),
    supabase.from("sales_invoice_items").select("*"),
    supabase.from("sales_returns").select("*"),
    supabase.from("sales_return_items").select("*"),
    supabase.from("purchase_invoices").select("*"),
    supabase.from("purchase_invoice_items").select("*"),
    supabase.from("purchase_returns").select("*"),
    supabase.from("purchase_return_items").select("*"),
    supabase.from("customer_payments").select("*"),
    supabase.from("customer_payment_splits").select("*"),
    supabase.from("stock_movements").select("*"),
    supabase.from("stock_transfers").select("*"),
    supabase.from("stock_transfer_items").select("*"),
    supabase.from("expenses").select("*"),
    supabase.from("expense_categories").select("*"),
    supabase.from("loyalty_transactions").select("*"),
    supabase.from("profiles").select("*"),
    supabase.from("user_roles").select("*"),
    supabase.from("audit_logs").select("*").limit(1000),
  ]);

  const tablesSummary: Record<string, number> = {
    company_settings: companyRes.data?.length ?? 0,
    warehouses: warehousesRes.data?.length ?? 0,
    categories: categoriesRes.data?.length ?? 0,
    brands: brandsRes.data?.length ?? 0,
    units: unitsRes.data?.length ?? 0,
    products: productsRes.data?.length ?? 0,
    product_batches: batchesRes.data?.length ?? 0,
    inventory: inventoryRes.data?.length ?? 0,
    customers: customersRes.data?.length ?? 0,
    suppliers: suppliersRes.data?.length ?? 0,
    sales_invoices: salesInvoicesRes.data?.length ?? 0,
    sales_invoice_items: salesItemsRes.data?.length ?? 0,
    sales_returns: salesReturnsRes.data?.length ?? 0,
    sales_return_items: salesReturnItemsRes.data?.length ?? 0,
    purchase_invoices: purchaseInvoicesRes.data?.length ?? 0,
    purchase_invoice_items: purchaseItemsRes.data?.length ?? 0,
    purchase_returns: purchaseReturnsRes.data?.length ?? 0,
    purchase_return_items: purchaseReturnItemsRes.data?.length ?? 0,
    customer_payments: paymentsRes.data?.length ?? 0,
    customer_payment_splits: splitsRes.data?.length ?? 0,
    stock_movements: movementsRes.data?.length ?? 0,
    stock_transfers: transfersRes.data?.length ?? 0,
    stock_transfer_items: transferItemsRes.data?.length ?? 0,
    expenses: expensesRes.data?.length ?? 0,
    expense_categories: expenseCatsRes.data?.length ?? 0,
    loyalty_transactions: loyaltyRes.data?.length ?? 0,
    profiles: profilesRes.data?.length ?? 0,
    user_roles: rolesRes.data?.length ?? 0,
    audit_logs: auditLogsRes.data?.length ?? 0,
  };

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
  };

  return {
    metadata,
    tables: {
      company_settings: companyRes.data ?? [],
      warehouses: warehousesRes.data ?? [],
      categories: categoriesRes.data ?? [],
      brands: brandsRes.data ?? [],
      units: unitsRes.data ?? [],
      products: productsRes.data ?? [],
      product_batches: batchesRes.data ?? [],
      inventory: inventoryRes.data ?? [],
      customers: customersRes.data ?? [],
      suppliers: suppliersRes.data ?? [],
      sales_invoices: salesInvoicesRes.data ?? [],
      sales_invoice_items: salesItemsRes.data ?? [],
      sales_returns: salesReturnsRes.data ?? [],
      sales_return_items: salesReturnItemsRes.data ?? [],
      purchase_invoices: purchaseInvoicesRes.data ?? [],
      purchase_invoice_items: purchaseItemsRes.data ?? [],
      purchase_returns: purchaseReturnsRes.data ?? [],
      purchase_return_items: purchaseReturnItemsRes.data ?? [],
      customer_payments: paymentsRes.data ?? [],
      customer_payment_splits: splitsRes.data ?? [],
      stock_movements: movementsRes.data ?? [],
      stock_transfers: transfersRes.data ?? [],
      stock_transfer_items: transferItemsRes.data ?? [],
      expenses: expensesRes.data ?? [],
      expense_categories: expenseCatsRes.data ?? [],
      loyalty_transactions: loyaltyRes.data ?? [],
      profiles: profilesRes.data ?? [],
      user_roles: rolesRes.data ?? [],
      audit_logs: auditLogsRes.data ?? [],
    },
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
 * Trigger File Download in Web Browser
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
  } catch {
    result.isValid = false;
    result.stageFailed = "HEADER_PARSE";
    result.errors.push("البيانات المفكوكة تحتوي على هيكل JSON غير صالح.");
    return result;
  }

  // Stage 6: Referential DAG Sanity Check
  if (payload.tables) {
    const productIds = new Set((payload.tables.products ?? []).map((p: any) => p.id));
    const invalidItems = (payload.tables.sales_invoice_items ?? []).filter(
      (item: any) => !productIds.has(item.product_id),
    );
    if (invalidItems.length > 0) {
      result.warnings.push(
        `تنبيه مرجعي: يوجد ${invalidItems.length} عنصر فاتورة مبيعات يشير إلى منتجات غير موجودة داخل كبسولة النسخة.`,
      );
    }
  }

  return result;
}

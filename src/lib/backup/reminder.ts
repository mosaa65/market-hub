/**
 * Market Hub (Vortex ERP) — Automated Local Backup Download Reminder Engine
 *
 * Manages periodic download alerts (Twice Daily / Daily / Weekly) prompting the user
 * to export and save a local encrypted snapshot (.vortexbak) directly to their device's Downloads folder.
 */

import {
  extractTenantDataReadOnly,
  createBackupPackage,
  downloadFileToDevice,
  recordBackupLog,
  getBackupSettings,
  saveBackupSettings,
} from "./engine";
import { ScheduleFrequency } from "./types";

export interface BackupReminderState {
  isDue: boolean;
  frequency: ScheduleFrequency;
  lastDownloadAt?: string;
  nextDueAt?: string;
  hoursOverdue?: number;
  messageAr: string;
  messageEn: string;
}

const TWICE_DAILY_MS = 12 * 60 * 60 * 1000; // 12 hours
const DAILY_MS = 24 * 60 * 60 * 1000; // 24 hours
const WEEKLY_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * Check if a local backup download is due based on schedule preferences
 */
export function checkBackupReminderStatus(): BackupReminderState {
  const settings = getBackupSettings();

  if (!settings.enabled || !settings.reminder_enabled) {
    return {
      isDue: false,
      frequency: settings.reminder_frequency || "twice_daily",
      messageAr: "تنبيهات النسخ التلقائي المحترفة معطلة في الإعدادات.",
      messageEn: "Local backup reminders are currently disabled.",
    };
  }

  const freq = settings.reminder_frequency || "twice_daily";
  const intervalMs =
    freq === "twice_daily" ? TWICE_DAILY_MS : freq === "daily" ? DAILY_MS : WEEKLY_MS;

  const lastDownload = settings.last_local_download_at || settings.last_backup_at;
  const now = Date.now();

  if (!lastDownload) {
    return {
      isDue: true,
      frequency: freq,
      hoursOverdue: 24,
      messageAr:
        "لم يتم إجراء نسخة احتياطية محلية مؤخراً! يوصى بتحميل نسخة لحفظ بيانات متجرك في جهازك الآن.",
      messageEn:
        "No recent local backup found! Please download a local backup snapshot to your device.",
    };
  }

  const lastTime = new Date(lastDownload).getTime();
  const elapsed = now - lastTime;

  if (elapsed >= intervalMs) {
    const hoursOverdue = Math.floor((elapsed - intervalMs) / (1000 * 60 * 60));
    const labelFreqAr =
      freq === "twice_daily" ? "مرتين يومياً" : freq === "daily" ? "يومياً" : "أسبوعياً";
    const labelFreqEn =
      freq === "twice_daily" ? "Twice Daily" : freq === "daily" ? "Daily" : "Weekly";

    return {
      isDue: true,
      frequency: freq,
      lastDownloadAt: lastDownload,
      nextDueAt: new Date(lastTime + intervalMs).toISOString(),
      hoursOverdue,
      messageAr: `حان موعد النسخة الاحتياطية المحلية المجدولة (${labelFreqAr}). انقر هنا لتحميل نسخة مباشرة لـ Downloads.`,
      messageEn: `Scheduled local backup download is due (${labelFreqEn}). Click to download directly to your device.`,
    };
  }

  const nextDue = new Date(lastTime + intervalMs).toISOString();

  return {
    isDue: false,
    frequency: freq,
    lastDownloadAt: lastDownload,
    nextDueAt: nextDue,
    messageAr: "نظام النسخ الاحتياطي المحلي محدث. تم حفظ آخر نسخة بنجاح.",
    messageEn: "Local backup snapshot is up to date.",
  };
}

/**
 * Execute Instant One-Click Local Backup Download
 */
export async function triggerInstantLocalBackupDownload(
  passphraseKey: string = "VORTEX_SECURE_BACKUP_2026",
  tenantId: string = "default",
  actorName: string = "المالك (Owner)",
): Promise<{ success: boolean; fileName?: string; sizeBytes?: number; error?: string }> {
  try {
    // 1. Extract read-only data for all 40+ system tables
    const payload = await extractTenantDataReadOnly(tenantId);

    // 2. Encrypt package with AES-256-GCM
    const pkg = await createBackupPackage(payload, passphraseKey);

    // 3. Trigger immediate browser download to Downloads folder
    downloadFileToDevice(pkg.fileContent, pkg.fileName);

    // 4. Record successful backup log
    await recordBackupLog({
      tenant_id: tenantId,
      actor_name: actorName,
      action_type: "manual_local",
      storage_type: "local",
      status: "success",
      file_name: pkg.fileName,
      file_size_bytes: pkg.sizeBytes,
    });

    // 5. Update settings state
    const settings = getBackupSettings();
    saveBackupSettings({
      ...settings,
      last_backup_at: new Date().toISOString(),
      last_local_download_at: new Date().toISOString(),
      last_backup_status: "success",
      last_backup_file_name: pkg.fileName,
      last_backup_size_bytes: pkg.sizeBytes,
    });

    return {
      success: true,
      fileName: pkg.fileName,
      sizeBytes: pkg.sizeBytes,
    };
  } catch (err: any) {
    const errorMsg = err?.message || "فشل توليد النسخة الاحتياطية المحلية.";
    await recordBackupLog({
      tenant_id: tenantId,
      actor_name: actorName,
      action_type: "manual_local",
      storage_type: "local",
      status: "failed",
      file_name: "vortex_backup_failed.vortexbak",
      file_size_bytes: 0,
      error_message: errorMsg,
    });

    return {
      success: false,
      error: errorMsg,
    };
  }
}

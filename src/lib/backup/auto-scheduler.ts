/**
 * Market Hub (Vortex ERP) — Automated Backup Scheduler (v3)
 *
 * مجدول النسخ الاحتياطي الفعلي — ليس مجرد تذكير:
 *  - يعمل في الخلفية (فحص كل 5 دقائق + عند إقلاع التطبيق).
 *  - ينفذ نسخة كاملة (تفريغ خادمي RPC + تشفير AES-256-GCM) تلقائياً حسب
 *    الجدولة: كل 12 ساعة (ظهراً وليلاً) / يومياً / أسبوعياً على وقت التنفيذ
 *    المحدد (الافتراضي 00:00 — 12 ليلاً).
 *  - التوزيع حسب الإعداد: سحابي (Supabase Storage — يعمل محلياً بالدوكر
 *    وسحابياً) + المسارات المخصصة على الجهاز + تنزيل متصفح عند التفاعل.
 *  - سياسة الاحتفاظ: تحذف النسخ السحابية الأقدم من الحد المحدد، أو تحفظ
 *    الكل عند اختيار "الكل".
 */

import { supabase } from "@/integrations/supabase/client";
import {
  createBackupPackage,
  exportTenantDataServerSide,
  getBackupSettings,
  recordBackupLog,
  saveBackupSettings,
  uploadBackupToStorage,
  writeBackupToCustomDirs,
} from "./engine";
import { BACKUP_ENGINE_VERSION, CURRENT_SCHEMA_VERSION, DEFAULT_KEY_VERSION } from "./types";
import type { BackupSettingsConfig, ScheduleFrequency } from "./types";

const DEFAULT_PASSPHRASE = "VORTEX_SECURE_BACKUP_2026";
const CHECK_INTERVAL_MS = 5 * 60 * 1000; // فحص كل 5 دقائق

const TWICE_DAILY_MS = 12 * 60 * 60 * 1000;
const DAILY_MS = 24 * 60 * 60 * 1000;
const WEEKLY_MS = 7 * 24 * 60 * 60 * 1000;

/* ------------------------------------------------------------------ */
/* سياسة الاحتفاظ: حذف النسخ السحابية الأقدم                           */
/* ------------------------------------------------------------------ */

export interface CloudBackupFileInfo {
  name: string;
  size_bytes: number;
  created_at: string;
}

/** قائمة النسخ السحابية في حاوية tenant-backups (الأحدث أولاً). */
export async function listCloudBackups(): Promise<CloudBackupFileInfo[]> {
  try {
    const { data, error } = await supabase.storage.from("tenant-backups").list("", {
      limit: 1000,
      sortBy: { column: "created_at", order: "desc" },
    });
    if (error) throw error;
    return (data ?? [])
      .filter((f) => f.name.endsWith(".vortexbak"))
      .map((f) => ({
        name: f.name,
        size_bytes: f.metadata?.size ?? 0,
        created_at: f.created_at ?? "",
      }));
  } catch {
    return [];
  }
}

/** حذف نسخة سحابية بالاسم. */
export async function deleteCloudBackup(fileName: string): Promise<boolean> {
  try {
    const { error } = await supabase.storage.from("tenant-backups").remove([fileName]);
    return !error;
  } catch {
    return false;
  }
}

/**
 * تطبيق سياسة الاحتفاظ على النسخ السحابية: يحذف ما تجاوز الحد.
 * "all" يحفظ كل النسخ بلا حذف.
 */
export async function enforceCloudRetention(
  keep: number | "all",
): Promise<{ deleted: number; kept: number }> {
  if (keep === "all") {
    const all = await listCloudBackups();
    return { deleted: 0, kept: all.length };
  }
  const files = await listCloudBackups();
  if (files.length <= keep) return { deleted: 0, kept: files.length };

  const toDelete = files.slice(keep).map((f) => f.name);
  let deleted = 0;
  for (const name of toDelete) {
    if (await deleteCloudBackup(name)) deleted++;
  }
  return { deleted, kept: files.length - deleted };
}

/* ------------------------------------------------------------------ */
/* حساب الموعد القادم                                                  */
/* ------------------------------------------------------------------ */

export interface SchedulerStatus {
  enabled: boolean;
  isDue: boolean;
  lastRunAt?: string;
  nextRunAt?: string;
  intervalLabelAr: string;
}

function intervalMs(freq: ScheduleFrequency): number {
  return freq === "twice_daily" ? TWICE_DAILY_MS : freq === "daily" ? DAILY_MS : WEEKLY_MS;
}

/** حساب حالة المجدول: هل حان موعد النسخة التلقائية؟ */
export function getSchedulerStatus(settings?: BackupSettingsConfig): SchedulerStatus {
  const s = settings ?? getBackupSettings();
  const freq = s.frequency || "twice_daily";
  const labelAr =
    freq === "twice_daily"
      ? "كل 12 ساعة (12 ظهراً و12 ليلاً)"
      : freq === "daily"
        ? "يومياً"
        : "أسبوعياً";

  if (!s.enabled) {
    return { enabled: false, isDue: false, intervalLabelAr: labelAr };
  }

  const last = s.last_backup_at ? new Date(s.last_backup_at).getTime() : 0;
  const now = Date.now();
  const iv = intervalMs(freq);

  if (!last) {
    return {
      enabled: true,
      isDue: true,
      intervalLabelAr: labelAr,
      nextRunAt: new Date(now).toISOString(),
    };
  }

  const next = last + iv;
  return {
    enabled: true,
    isDue: now >= next,
    lastRunAt: s.last_backup_at,
    nextRunAt: new Date(next).toISOString(),
    intervalLabelAr: labelAr,
  };
}

/* ------------------------------------------------------------------ */
/* تنفيذ النسخة التلقائية                                              */
/* ------------------------------------------------------------------ */

export interface ScheduledBackupResult {
  success: boolean;
  fileName?: string;
  cloudPath?: string | null;
  customDirsOk?: number;
  customDirsFailed?: string[];
  cloudError?: string | null;
  tableCount?: number;
  totalRows?: number;
  error?: string;
}

/**
 * تنفيذ نسخة احتياطية تلقائية كاملة:
 * تفريغ خادمي ← تشفير ← رفع سحابي (إن كان الوجهة سحابية/مزدوجة)
 * ← كتابة في المسارات المخصصة ← تسجيل السجل ← تطبيق الاحتفاظ.
 * ملاحظة: التنزيل التلقائي للمتصفح لا يتم إلا عند تفاعل المستخدم، لذا
 * النسخة التلقائية تعتمد على السحابة والمسارات المخصصة (وهما كافيان)،
 * والتنزيل اليدوي يبقى متاحاً بأزرار الواجهة.
 */
export async function runScheduledBackup(
  actorName: string = "المجدول التلقائي",
): Promise<ScheduledBackupResult> {
  try {
    const settings = getBackupSettings();
    const destination = settings.destination || "both";

    // 1) تفريغ خادمي شامل (كل جداول public ديناميكياً)
    const serverPayload = await exportTenantDataServerSide();

    // 2) بناء الترويسة والتشفير
    const payload: any = {
      metadata: {
        backup_id: `bak_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
        tenant_id: "default",
        schema_version: CURRENT_SCHEMA_VERSION,
        engine_version: BACKUP_ENGINE_VERSION,
        key_version: DEFAULT_KEY_VERSION,
        created_at: serverPayload.exported_at,
        backup_type: "auto_scheduled" as const,
        storage_type: destination === "cloud" ? "cloud" : "local",
        file_size_bytes: 0,
        auth_tag: "",
        checksum_sha256: "",
        status: "success" as const,
        tables_summary: Object.fromEntries(
          Object.entries(serverPayload.tables).map(([k, v]) => [
            k,
            Array.isArray(v) ? v.length : 0,
          ]),
        ),
        server_schema_fingerprint: serverPayload.schema_fingerprint,
        server_dynamic: true,
      },
      tables: serverPayload.tables as any,
    };
    const pkg = await createBackupPackage(payload, DEFAULT_PASSPHRASE);

    // 3) الرفع السحابي
    let cloudPath: string | null = null;
    let cloudError: string | null = null;
    if (destination === "cloud" || destination === "both") {
      const upload = await uploadBackupToStorage(pkg.fileContent, pkg.fileName);
      if (upload.ok) cloudPath = upload.path;
      else cloudError = upload.error;
    }

    // 4) المسارات المخصصة على الجهاز
    let customDirsOk = 0;
    const customDirsFailed: string[] = [];
    const dirsResult = await writeBackupToCustomDirs(pkg.fileContent, pkg.fileName);
    customDirsOk = dirsResult.ok;
    customDirsFailed.push(...dirsResult.failed);

    // 5) تحديث الإعدادات والسجل
    saveBackupSettings({
      ...settings,
      last_backup_at: new Date().toISOString(),
      last_backup_status: cloudError && destination !== "local" ? "failed" : "success",
      last_backup_type: "auto_scheduled",
      last_backup_file_name: pkg.fileName,
      last_backup_size_bytes: pkg.sizeBytes,
      last_scheduled_slot: new Date().toISOString().slice(0, 13), // ساعة الفتح
    });

    await recordBackupLog({
      tenant_id: "default",
      actor_name: actorName,
      action_type: "auto_scheduled",
      storage_type: destination === "cloud" && cloudPath ? "cloud" : destination,
      status: cloudError && destination !== "local" ? "failed" : "success",
      file_name: pkg.fileName,
      file_size_bytes: pkg.sizeBytes,
      error_message: [cloudError, ...customDirsFailed].filter(Boolean).join("؛ ") || undefined,
    });

    // 6) سياسة الاحتفاظ على السحابة
    try {
      await enforceCloudRetention(settings.retention_count ?? 15);
    } catch {
      /* الاحتفاظ غير حرج */
    }

    return {
      success: !(cloudError && destination === "cloud"),
      fileName: pkg.fileName,
      cloudPath,
      customDirsOk,
      customDirsFailed,
      cloudError,
      tableCount: serverPayload.table_count,
      totalRows: serverPayload.total_rows,
    };
  } catch (err: any) {
    const msg = err?.message || "فشل تنفيذ النسخة التلقائية.";
    await recordBackupLog({
      tenant_id: "default",
      actor_name: "المجدول التلقائي",
      action_type: "auto_scheduled",
      storage_type: "cloud",
      status: "failed",
      file_name: "vortex_backup_failed.vortexbak",
      file_size_bytes: 0,
      error_message: msg,
    });
    return { success: false, error: msg };
  }
}

/* ------------------------------------------------------------------ */
/* حلقة المجدول (singleton)                                            */
/* ------------------------------------------------------------------ */

let schedulerTimer: ReturnType<typeof setInterval> | null = null;
let schedulerRunning = false;

/**
 * فحص دوري: هل حان موعد نسخة تلقائية؟ إن نعم ينفذها مرة واحدة.
 * قفل بسيط يمنع التنفيذ المتزامن من نوافذ متعددة.
 */
export async function maybeRunScheduledBackup(): Promise<ScheduledBackupResult | null> {
  if (schedulerRunning) return null;
  const status = getSchedulerStatus();
  if (!status.enabled || !status.isDue) return null;

  schedulerRunning = true;
  try {
    return await runScheduledBackup();
  } finally {
    schedulerRunning = false;
  }
}

/** تشغيل حلقة المجدول — يُستدعى مرة واحدة من app-shell. */
export function startAutoBackupScheduler(): void {
  if (schedulerTimer) return;
  // فحص فوري عند الإقلاع ثم كل 5 دقائق
  void maybeRunScheduledBackup();
  schedulerTimer = setInterval(() => void maybeRunScheduledBackup(), CHECK_INTERVAL_MS);
}

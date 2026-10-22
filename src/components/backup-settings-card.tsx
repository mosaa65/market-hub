import { useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ShieldCheck,
  HardDrive,
  Cloud,
  Clock,
  Download,
  RotateCcw,
  CheckCircle2,
  AlertCircle,
  Save,
  Lock,
  Sparkles,
  RefreshCw,
  BellRing,
  Layers,
  Factory,
  Receipt,
  Users,
  Building2,
  HardDriveDownload,
  FolderOpen,
  FolderPlus,
  Trash2,
} from "lucide-react";
import {
  createBackupPackage,
  downloadFileToDevice,
  extractTenantDataReadOnly,
  exportTenantDataServerSide,
  uploadBackupToStorage,
  writeBackupToCustomDirs,
  addCustomBackupDirectory,
  removeCustomBackupDirectory,
  listCustomBackupDirectories,
  customDirSupported,
  getBackupLogHistoryFromDB,
  getBackupSettings,
  recordBackupLog,
  saveBackupSettings,
  calculateCategoryStats,
  backupBucketExists,
} from "@/lib/backup/engine";
import { checkBackupReminderStatus } from "@/lib/backup/reminder";
import {
  BackupLogRecord,
  BackupSettingsConfig,
  TableCategorySummary,
  BACKUP_ENGINE_VERSION,
  CURRENT_SCHEMA_VERSION,
  DEFAULT_KEY_VERSION,
} from "@/lib/backup/types";
import { BackupRestoreDialog } from "./backup-restore-dialog";
import { toast } from "sonner";

export function BackupSettingsCard() {
  const { lang } = useI18n();
  const isAr = lang === "ar";
  const { user, hasRole } = useAuth();
  const canManage = hasRole("owner") || hasRole("manager");

  const [settings, setSettings] = useState<BackupSettingsConfig>(getBackupSettings);
  const [logs, setLogs] = useState<BackupLogRecord[]>([]);
  const [saving, setSaving] = useState(false);
  const [creatingBackup, setCreatingBackup] = useState(false);
  const [restoreDialogOpen, setRestoreDialogOpen] = useState(false);
  const [passphrase, setPassphrase] = useState("VORTEX_SECURE_BACKUP_2026");
  const [previewStats, setPreviewStats] = useState<TableCategorySummary | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [customDirs, setCustomDirs] = useState<{ id: number; name: string }[]>([]);
  const [addingDir, setAddingDir] = useState(false);

  const refreshCustomDirs = async () => {
    setCustomDirs(await listCustomBackupDirectories());
  };

  useEffect(() => {
    getBackupLogHistoryFromDB().then((data) => setLogs(data));
    refreshCustomDirs();
  }, []);

  const handleAddCustomDir = async () => {
    setAddingDir(true);
    try {
      const name = await addCustomBackupDirectory();
      await refreshCustomDirs();
      toast.success(isAr ? `أُضيف المسار: ${name}` : `Path added: ${name}`);
    } catch (err: any) {
      toast.error(err?.message || "فشل إضافة المسار");
    } finally {
      setAddingDir(false);
    }
  };

  const handleRemoveCustomDir = async (id: number) => {
    try {
      await removeCustomBackupDirectory(id);
      await refreshCustomDirs();
      toast.success(isAr ? "حُذف المسار" : "Path removed");
    } catch {
      toast.error(isAr ? "فشل حذف المسار" : "Failed to remove path");
    }
  };

  const reminderStatus = checkBackupReminderStatus();

  useEffect(() => {
    getBackupLogHistoryFromDB().then((data) => setLogs(data));
  }, []);

  const handleFetchPreview = async () => {
    setLoadingPreview(true);
    try {
      const payload = await extractTenantDataReadOnly("default", user?.id);
      const stats = calculateCategoryStats(payload.tables);
      setPreviewStats(stats);
      toast.success(isAr ? "تم تحديث معاينة جداول النظام بنجاح" : "System tables preview updated");
    } catch {
      toast.error(isAr ? "فشل جلب إحصائيات جداول النظام" : "Failed to load table stats");
    } finally {
      setLoadingPreview(false);
    }
  };

  const handleSaveSettings = () => {
    setSaving(true);
    saveBackupSettings(settings);
    setSaving(false);
    toast.success(
      isAr ? "تم حفظ إعدادات النسخ الاحتياطي والجدولة بنجاح" : "Backup settings saved successfully",
    );
  };

  const handleCreateLocalBackup = async () => {
    if (!canManage) {
      toast.error(
        isAr ? "عذراً، حق إنشاء النسخ الاحتياطي محصور بالمالك والمدير" : "Permission denied",
      );
      return;
    }
    setCreatingBackup(true);
    try {
      // v3: التفريغ من الخادم (RPC backup_export_all) — كل جداول public ديناميكياً،
      // ثم تشفير AES-256-GCM كطبقة إضافية قبل التنزيل.
      const serverPayload = await exportTenantDataServerSide();
      const payload: any = {
        metadata: {
          backup_id: `bak_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
          tenant_id: "default",
          schema_version: CURRENT_SCHEMA_VERSION,
          engine_version: BACKUP_ENGINE_VERSION,
          key_version: DEFAULT_KEY_VERSION,
          created_at: serverPayload.exported_at,
          created_by: user?.id,
          backup_type: "manual_local" as const,
          storage_type: "local" as const,
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
      const pkg = await createBackupPackage(payload, passphrase);
      downloadFileToDevice(pkg.fileContent, pkg.fileName);

      // v3.1: التوزيع متعدد الوجهات حسب الإعداد (local / cloud / both)
      const destination = settings.destination;
      let cloudPath: string | null = null;
      let cloudFailed: string | null = null;
      let customDirsResult: { ok: number; failed: string[] } | null = null;

      if (destination === "cloud" || destination === "both") {
        const upload = await uploadBackupToStorage(pkg.fileContent, pkg.fileName);
        if (upload.ok) {
          cloudPath = upload.path;
        } else {
          cloudFailed = upload.error;
        }
      }

      // المسارات المخصصة (قرص/مجلدات اختارها المستخدم) — تُكتب لكل نسخة تلقائياً
      if (customDirSupported()) {
        customDirsResult = await writeBackupToCustomDirs(pkg.fileContent, pkg.fileName);
      }

      const effectiveStorageType =
        destination === "both" || (destination === "cloud" && cloudPath)
          ? "both"
          : destination === "cloud"
            ? "cloud"
            : "local";

      await recordBackupLog({
        tenant_id: "default",
        actor_name: user?.email || "المالك (Owner)",
        action_type: "manual_local",
        storage_type: effectiveStorageType,
        status: cloudFailed && destination !== "local" ? "failed" : "success",
        file_name: pkg.fileName,
        file_size_bytes: pkg.sizeBytes,
        error_message: cloudFailed || customDirsResult?.failed.join("؛ ") || undefined,
      });

      const updated = getBackupSettings();
      setSettings(updated);
      const updatedLogs = await getBackupLogHistoryFromDB();
      setLogs(updatedLogs);
      toast.success(
        isAr
          ? `تم التفريغ الخادمي (${serverPayload.table_count} جدول / ${serverPayload.total_rows} صف)` +
              (cloudPath
                ? ` ورفع السحابي إلى ${cloudPath}`
                : destination === "cloud" || destination === "both"
                  ? ` — فشل الرفع السحابي: ${cloudFailed}`
                  : "") +
              (customDirsResult && customDirsResult.ok > 0
                ? ` وكُتب في ${customDirsResult.ok} مسار مخصص على الجهاز`
                : "") +
              ` — النسخة المشفّرة: ${pkg.fileName}`
          : `Server-side export (${serverPayload.table_count} tables / ${serverPayload.total_rows} rows) saved as ${pkg.fileName}`,
      );
    } catch (err: any) {
      const msg = err?.message || (isAr ? "فشل إنشاء النسخة الاحتياطية" : "Backup creation failed");
      await recordBackupLog({
        tenant_id: "default",
        actor_name: user?.email || "المالك (Owner)",
        action_type: "manual_local",
        storage_type: "local",
        status: "failed",
        file_name: "vortex_backup_failed.vortexbak",
        file_size_bytes: 0,
        error_message: msg,
      });
      toast.error(msg);
    } finally {
      setCreatingBackup(false);
    }
  };

  return (
    <>
      <Card className="lg:col-span-2 border-primary/30 bg-gradient-to-br from-primary/5 via-surface to-surface shadow-md rounded-3xl">
        <CardHeader>
          <CardTitle className="text-base flex flex-wrap items-center justify-between gap-3">
            <span className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-primary" />
              {isAr
                ? "إدارة النسخ الاحتياطي وتنبيهات التحميل المحلي (Backup & Data Protection Engine v2.0)"
                : "Backup & Data Protection Engine v2.0"}
            </span>
            <div className="flex items-center gap-2">
              <span className="rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 px-3 py-0.5 text-xs font-bold">
                شامل 40+ جدولاً للنظام
              </span>
              <span className="rounded-full bg-primary/10 text-primary border border-primary/20 px-3 py-0.5 text-xs font-semibold">
                تشفير AES-256-GCM
              </span>
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Section 1: Settings Controls */}
          <div className="p-4 rounded-2xl border border-border/80 bg-surface/80 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-border/60">
              <div>
                <div className="text-sm font-semibold text-foreground flex items-center gap-2">
                  <span>
                    {isAr
                      ? "تفعيل النسخ الاحتياطي التلقائي المجدول"
                      : "Enable Scheduled Auto-Backup"}
                  </span>
                  <Badge
                    variant="outline"
                    className="text-[10px] bg-primary/10 text-primary border-primary/30"
                  >
                    جدولة أوتوماتيكية
                  </Badge>
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {isAr
                    ? "أتمتة عملية أخذ لقطات زمانية شاملة (Snapshots) لكل وحدات النظام والمطاحن والمصروفات"
                    : "Automate background snapshots for all modules"}
                </div>
              </div>
              <Switch
                checked={settings.enabled}
                onCheckedChange={(v) => setSettings({ ...settings, enabled: v })}
                disabled={!canManage}
              />
            </div>

            {/* Reminder Alert Control */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-border/60">
              <div>
                <div className="text-sm font-semibold text-foreground flex items-center gap-2">
                  <BellRing className="size-4 text-amber-500 animate-pulse" />
                  <span>
                    {isAr
                      ? "تنبيهات تذكير التنزيل المحلي للجهاز (Notification Reminder)"
                      : "Local Download Reminder"}
                  </span>
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {isAr
                    ? "إظهار إشعار دوري في مركز التنبيهات يتيح لك تحميل نسخة احتياطية بنقرة واحدة لجهازك"
                    : "Trigger a notification reminder to download a local backup directly to your device"}
                </div>
              </div>
              <Switch
                checked={settings.reminder_enabled}
                onCheckedChange={(v) => setSettings({ ...settings, reminder_enabled: v })}
                disabled={!canManage}
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 pt-1">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">
                  {isAr ? "مكان التخزين المفضل" : "Storage Destination"}
                </Label>
                <Select
                  value={settings.destination}
                  onValueChange={(v: any) => setSettings({ ...settings, destination: v })}
                  disabled={!canManage || !settings.enabled}
                >
                  <SelectTrigger className="rounded-xl text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="local">محلي فقط (تنزيل لجهازك)</SelectItem>
                    <SelectItem value="cloud">سحابي فقط (Supabase Storage)</SelectItem>
                    <SelectItem value="both">مزدوج (محلي + سحابي)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-medium">
                  {isAr ? "تكرار التنبيه والجدولة" : "Reminder Frequency"}
                </Label>
                <Select
                  value={settings.reminder_frequency || settings.frequency}
                  onValueChange={(v: any) =>
                    setSettings({ ...settings, frequency: v, reminder_frequency: v })
                  }
                  disabled={!canManage}
                >
                  <SelectTrigger className="rounded-xl text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="twice_daily">مرتين يومياً (كل 12 ساعة - موصى به)</SelectItem>
                    <SelectItem value="daily">يومياً (Daily - كل 24 ساعة)</SelectItem>
                    <SelectItem value="weekly">أسبوعياً (Weekly)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-medium">
                  {isAr ? "وقت التنفيذ المفضّل" : "Execution Time"}
                </Label>
                <Input
                  type="time"
                  value={settings.execution_time}
                  onChange={(e) => setSettings({ ...settings, execution_time: e.target.value })}
                  disabled={!canManage || !settings.enabled}
                  className="rounded-xl text-xs"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-medium">
                  {isAr ? "عدد النسخ المحتفظ بها" : "Retention Policy"}
                </Label>
                <Select
                  value={String(settings.retention_count)}
                  onValueChange={(v) => setSettings({ ...settings, retention_count: Number(v) })}
                  disabled={!canManage || !settings.enabled}
                >
                  <SelectTrigger className="rounded-xl text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="7">أحدث 7 نسخ</SelectItem>
                    <SelectItem value="15">أحدث 15 نسخة</SelectItem>
                    <SelectItem value="30">أحدث 30 نسخة</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex items-center justify-between pt-2">
              <span className="text-xs text-muted-foreground">
                {reminderStatus.isDue ? (
                  <span className="text-amber-600 dark:text-amber-400 font-semibold flex items-center gap-1">
                    <BellRing className="size-3.5" />
                    {reminderStatus.messageAr}
                  </span>
                ) : (
                  <span className="text-emerald-600 dark:text-emerald-400 font-semibold flex items-center gap-1">
                    <CheckCircle2 className="size-3.5" />
                    {reminderStatus.messageAr}
                  </span>
                )}
              </span>

              <Button
                type="button"
                onClick={handleSaveSettings}
                disabled={saving || !canManage}
                className="rounded-full px-5 gap-1.5 text-xs shadow-sm"
              >
                <Save className="h-3.5 w-3.5" />
                {isAr ? "حفظ الإعدادات والتنبيهات" : "Save Preferences"}
              </Button>
            </div>
          </div>

          {/* Section 1.5: Custom Local Backup Paths (File System Access API) */}
          {customDirSupported() ? (
            <div className="p-4 rounded-2xl border border-border/80 bg-surface/80 space-y-3">
              <div className="flex items-center justify-between">
                <div className="text-xs font-bold text-foreground flex items-center gap-2">
                  <FolderOpen className="size-4 text-emerald-500" />
                  <span>
                    {isAr
                      ? "مسارات نسخ مخصصة على الجهاز (قرص/مجلدات)"
                      : "Custom local backup paths"}
                  </span>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!canManage || addingDir}
                  onClick={handleAddCustomDir}
                  className="h-7 text-xs"
                >
                  <FolderPlus className="size-3" />
                  {isAr ? "إضافة مسار" : "Add Path"}
                </Button>
              </div>
              <div className="text-xs text-muted-foreground">
                {isAr
                  ? "كل نسخة احتياطية (يدوية أو مجدولة) ستُكتب تلقائياً في كل مسار تضيفه هنا بالإضافة إلى التنزيل والسحابة."
                  : "Every backup (manual or scheduled) will be written automatically to each added path in addition to download and cloud."}
              </div>
              {customDirs.length > 0 ? (
                <div className="space-y-1.5">
                  {customDirs.map((d) => (
                    <div
                      key={d.id}
                      className="flex items-center justify-between text-xs px-3 py-2 rounded-xl border border-border/60 bg-surface-2/40"
                    >
                      <span className="font-mono flex items-center gap-1.5">
                        <FolderOpen className="size-3 text-emerald-500" />
                        {d.name}
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={!canManage}
                        onClick={() => handleRemoveCustomDir(d.id)}
                        className="h-6 text-destructive hover:text-destructive"
                      >
                        <Trash2 className="size-3" />
                      </Button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-xs text-muted-foreground bg-surface-2/40 p-3 rounded-xl border border-dashed border-border/60">
                  {isAr
                    ? 'لم تُضف أي مسار بعد — انقر "إضافة مسار" واختر مجلداً على أي قرص.'
                    : "No custom paths yet — click 'Add Path' and pick a folder."}
                </div>
              )}
            </div>
          ) : null}

          {/* Section 2: System Tables Breakdown Inspector Preview */}
          <div className="p-4 rounded-2xl border border-border/80 bg-surface/80 space-y-3">
            <div className="flex items-center justify-between">
              <div className="text-xs font-bold text-foreground flex items-center gap-2">
                <Layers className="size-4 text-primary" />
                <span>
                  {isAr
                    ? "معاينة جداول النظام المشمولة بالنسخ الاحتياطي (System Modules Coverage)"
                    : "Tables Coverage"}
                </span>
              </div>

              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleFetchPreview}
                disabled={loadingPreview}
                className="h-7 text-xs gap-1 text-primary hover:bg-primary/10"
              >
                <RefreshCw className={`size-3 ${loadingPreview ? "animate-spin" : ""}`} />
                <span>{isAr ? "فحص الجداول وتحديث الإحصائيات" : "Scan Tables"}</span>
              </Button>
            </div>

            {previewStats ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 pt-1 text-xs">
                <div className="p-2.5 rounded-xl border border-border/60 bg-surface-2/60 space-y-1">
                  <div className="text-muted-foreground flex items-center gap-1">
                    <Building2 className="size-3 text-cyan-500" />
                    <span>إعدادات وإدارة</span>
                  </div>
                  <div className="text-base font-bold font-mono text-foreground">
                    {previewStats.core}
                  </div>
                </div>

                <div className="p-2.5 rounded-xl border border-border/60 bg-surface-2/60 space-y-1">
                  <div className="text-muted-foreground flex items-center gap-1">
                    <Layers className="size-3 text-amber-500" />
                    <span>منتجات ومخزون</span>
                  </div>
                  <div className="text-base font-bold font-mono text-foreground">
                    {previewStats.productsAndStock}
                  </div>
                </div>

                <div className="p-2.5 rounded-xl border border-border/60 bg-surface-2/60 space-y-1">
                  <div className="text-muted-foreground flex items-center gap-1">
                    <Receipt className="size-3 text-emerald-500" />
                    <span>مبيعات ومشتريات</span>
                  </div>
                  <div className="text-base font-bold font-mono text-foreground">
                    {previewStats.salesAndPurchases}
                  </div>
                </div>

                <div className="p-2.5 rounded-xl border border-border/60 bg-surface-2/60 space-y-1">
                  <div className="text-muted-foreground flex items-center gap-1">
                    <Users className="size-3 text-primary" />
                    <span>عملاء وذمم ومالية</span>
                  </div>
                  <div className="text-base font-bold font-mono text-foreground">
                    {previewStats.financeAndLedgers}
                  </div>
                </div>

                <div className="p-2.5 rounded-xl border border-border/60 bg-surface-2/60 space-y-1">
                  <div className="text-muted-foreground flex items-center gap-1">
                    <Factory className="size-3 text-amber-600" />
                    <span>وحدة المطاحن</span>
                  </div>
                  <div className="text-base font-bold font-mono text-foreground">
                    {previewStats.millingModule}
                  </div>
                </div>

                <div className="p-2.5 rounded-xl border border-border/60 bg-surface-2/60 space-y-1">
                  <div className="text-muted-foreground flex items-center gap-1">
                    <Receipt className="size-3 text-purple-500" />
                    <span>المصروفات ERP</span>
                  </div>
                  <div className="text-base font-bold font-mono text-foreground">
                    {previewStats.expenseModule}
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-xs text-muted-foreground bg-surface-2/40 p-3 rounded-xl border border-dashed border-border/60 flex items-center justify-between">
                <span>
                  انقر على "فحص الجداول" لمعاينة إحصائيات السجلات في قاعدة البيانات قبل التنزيل.
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleFetchPreview}
                  className="h-7 text-xs"
                >
                  بدء الفحص
                </Button>
              </div>
            )}
          </div>

          {/* Section 3: Last Backup Status & Quick Actions */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="md:col-span-2 p-4 rounded-2xl border border-primary/20 bg-primary/5 space-y-3 flex flex-col justify-between">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-foreground flex items-center gap-1.5">
                  <Clock className="h-4 w-4 text-primary" />
                  {isAr ? "حالة آخر نسخة احتياطية محلياً" : "Last Local Backup Snapshot Status"}
                </span>
                {settings.last_backup_status === "success" ? (
                  <Badge className="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30 gap-1 text-xs">
                    <CheckCircle2 className="h-3 w-3" />
                    {isAr ? "مكتملة وناجحة" : "Success"}
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-xs">
                    {isAr ? "لا توجد نسخة سابقة" : "No prior backup"}
                  </Badge>
                )}
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <span className="text-muted-foreground block">
                    {isAr ? "تاريخ التنزيل لجهازك:" : "Date Downloaded:"}
                  </span>
                  <span className="font-semibold text-foreground">
                    {settings.last_local_download_at || settings.last_backup_at
                      ? new Date(
                          settings.last_local_download_at || settings.last_backup_at!,
                        ).toLocaleString("ar-YE")
                      : "—"}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground block">
                    {isAr ? "حجم الملف المشفّر:" : "Package Size:"}
                  </span>
                  <span className="font-semibold text-foreground">
                    {settings.last_backup_size_bytes
                      ? `${(settings.last_backup_size_bytes / 1024 / 1024).toFixed(2)} MB`
                      : "—"}
                  </span>
                </div>
              </div>

              {settings.last_backup_file_name && (
                <div className="text-xs font-mono text-muted-foreground truncate bg-surface/60 p-2 rounded-xl border border-border/50">
                  {settings.last_backup_file_name}
                </div>
              )}
            </div>

            <div className="p-4 rounded-2xl border border-border/80 bg-surface/80 flex flex-col justify-center gap-3">
              <Button
                type="button"
                onClick={handleCreateLocalBackup}
                disabled={creatingBackup || !canManage}
                className="w-full rounded-2xl gap-2 text-xs font-bold bg-amber-600 hover:bg-amber-700 text-white shadow-sm"
              >
                {creatingBackup ? (
                  <>
                    <RefreshCw className="h-4 w-4 animate-spin" />
                    جاري الاستخراج والتشفير...
                  </>
                ) : (
                  <>
                    <HardDriveDownload className="h-4 w-4" />
                    تنزيل نسخة للملفات/Downloads
                  </>
                )}
              </Button>

              <Button
                type="button"
                variant="outline"
                onClick={() => setRestoreDialogOpen(true)}
                disabled={!canManage}
                className="w-full rounded-2xl gap-2 text-xs border-primary/40 text-primary hover:bg-primary/10"
              >
                <RotateCcw className="h-4 w-4" />
                {isAr ? "معاين والاستعادة التجريبية" : "Safe Restore Wizard"}
              </Button>
            </div>
          </div>

          {/* Section 4: Historical Audit Logs Table */}
          <div className="space-y-3 pt-2">
            <div className="text-xs font-bold text-foreground flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <Sparkles className="h-4 w-4 text-primary" />
                {isAr
                  ? "سجل حركات النسخ والاستعادة التاريخي (مخزن في السيرفر والداتا بيز)"
                  : "Backup Audit Log History"}
              </span>

              <Button
                variant="ghost"
                size="sm"
                onClick={async () => {
                  const updated = await getBackupLogHistoryFromDB();
                  setLogs(updated);
                }}
                className="h-7 text-[11px] gap-1"
              >
                <RefreshCw className="size-3" />
                <span>تحديث السجل</span>
              </Button>
            </div>

            <div className="rounded-2xl border border-border/80 overflow-hidden bg-surface shadow-xs">
              <Table>
                <TableHeader>
                  <TableRow className="bg-surface-2/60">
                    <TableHead className="text-xs">
                      {isAr ? "التاريخ والوقت" : "Date & Time"}
                    </TableHead>
                    <TableHead className="text-xs">{isAr ? "المُنفّذ" : "Actor"}</TableHead>
                    <TableHead className="text-xs">{isAr ? "نوع الحركة" : "Type"}</TableHead>
                    <TableHead className="text-xs">{isAr ? "الحجم" : "Size"}</TableHead>
                    <TableHead className="text-xs">{isAr ? "الحالة" : "Status"}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {logs.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={5}
                        className="text-center text-xs text-muted-foreground py-6"
                      >
                        {isAr ? "لا توجد حركات سابقة مسجلة" : "No recorded backup logs yet"}
                      </TableCell>
                    </TableRow>
                  ) : (
                    logs.slice(0, 5).map((log) => (
                      <TableRow key={log.id} className="text-xs">
                        <TableCell className="font-mono text-muted-foreground">
                          {new Date(log.created_at).toLocaleString("ar-YE")}
                        </TableCell>
                        <TableCell className="font-medium text-foreground">
                          {log.actor_name}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-[10px] rounded-lg">
                            {log.action_type === "manual_local"
                              ? "تنزيل محلي"
                              : log.action_type === "auto_scheduled"
                                ? "سحابي مجدول"
                                : "استعادة"}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-mono text-muted-foreground">
                          {(log.file_size_bytes / 1024 / 1024).toFixed(2)} MB
                        </TableCell>
                        <TableCell>
                          {log.status === "success" ? (
                            <span className="text-emerald-500 font-semibold flex items-center gap-1">
                              <CheckCircle2 className="h-3 w-3" /> ناجحة
                            </span>
                          ) : (
                            <span className="text-rose-500 font-semibold flex items-center gap-1">
                              <AlertCircle className="h-3 w-3" /> فشلت
                            </span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </div>
        </CardContent>
      </Card>

      <BackupRestoreDialog open={restoreDialogOpen} onClose={() => setRestoreDialogOpen(false)} />
    </>
  );
}

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
} from "lucide-react";
import {
  createBackupPackage,
  downloadFileToDevice,
  extractTenantDataReadOnly,
  getBackupLogHistory,
  getBackupSettings,
  recordBackupLog,
  saveBackupSettings,
} from "@/lib/backup/engine";
import { BackupLogRecord, BackupSettingsConfig } from "@/lib/backup/types";
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
  const [passphrase, setPassphrase] = useState("vortex-secret-passphrase");

  useEffect(() => {
    setLogs(getBackupLogHistory());
  }, []);

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
      toast.error(isAr ? "عذراً، حق إنشاء النسخ الاحتياطي محصور بالمالك والمدير" : "Permission denied");
      return;
    }
    setCreatingBackup(true);
    try {
      // 1. Read-only extraction of current tenant tables
      const payload = await extractTenantDataReadOnly("default", user?.id);

      // 2. Encrypt & Package into .vortexbak
      const { fileContent, fileName, sizeBytes } = await createBackupPackage(
        payload,
        passphrase,
      );

      // 3. Download to user's device
      downloadFileToDevice(fileContent, fileName);

      // 4. Update settings status & record log
      const updatedSettings: BackupSettingsConfig = {
        ...settings,
        last_backup_at: new Date().toISOString(),
        last_backup_status: "success",
        last_backup_type: "manual_local",
        last_backup_size_bytes: sizeBytes,
        last_backup_file_name: fileName,
      };
      setSettings(updatedSettings);
      saveBackupSettings(updatedSettings);

      recordBackupLog({
        actor_name: user?.email || (isAr ? "المالك (Owner)" : "Owner"),
        action_type: "manual_local",
        storage_type: "local",
        status: "success",
        file_name: fileName,
        file_size_bytes: sizeBytes,
      });

      setLogs(getBackupLogHistory());
      setCreatingBackup(false);
      toast.success(
        isAr
          ? `تم إنشاء وتنزيل النسخة الاحتياطية بنجاح (${(sizeBytes / 1024 / 1024).toFixed(2)} MB)`
          : "Local backup generated and downloaded successfully",
      );
    } catch {
      setCreatingBackup(false);
      toast.error(isAr ? "فشل إنشاء النسخة الاحتياطية المحلية" : "Failed to create local backup");
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
                ? "إدارة النسخ الاحتياطي وحماية البيانات (Backup & Data Protection)"
                : "Backup & Data Protection Management"}
            </span>
            <span className="rounded-full bg-primary/10 text-primary border border-primary/20 px-3 py-0.5 text-xs font-semibold">
              تشفير AES-256-GCM معتمد
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Section 1: Settings Controls */}
          <div className="p-4 rounded-2xl border border-border/80 bg-surface/80 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-border/60">
              <div>
                <div className="text-sm font-semibold text-foreground">
                  {isAr ? "تفعيل النسخ الاحتياطي التلقائي المجدول" : "Enable Scheduled Auto-Backup"}
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {isAr
                    ? "أتمتة عملية أخذ لقطات زمانية (Snapshots) دون الحاجة للتدخل اليدوي"
                    : "Automate background snapshots based on designated frequency"}
                </div>
              </div>
              <Switch
                checked={settings.enabled}
                onCheckedChange={(v) => setSettings({ ...settings, enabled: v })}
                disabled={!canManage}
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 pt-1">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">{isAr ? "مكان التخزين المفضل" : "Storage Destination"}</Label>
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
                <Label className="text-xs font-medium">{isAr ? "تكرار الجدولة" : "Frequency"}</Label>
                <Select
                  value={settings.frequency}
                  onValueChange={(v: any) => setSettings({ ...settings, frequency: v })}
                  disabled={!canManage || !settings.enabled}
                >
                  <SelectTrigger className="rounded-xl text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="daily">يومياً (Daily)</SelectItem>
                    <SelectItem value="weekly">أسبوعياً (Weekly)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-medium">{isAr ? "وقت التنفيذ المفضّل" : "Execution Time"}</Label>
                <Input
                  type="time"
                  value={settings.execution_time}
                  onChange={(e) => setSettings({ ...settings, execution_time: e.target.value })}
                  disabled={!canManage || !settings.enabled}
                  className="rounded-xl text-xs"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-medium">{isAr ? "عدد النسخ المحتفظ بها" : "Retention Policy"}</Label>
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

            <div className="flex justify-end pt-2">
              <Button
                type="button"
                onClick={handleSaveSettings}
                disabled={saving || !canManage}
                className="rounded-full px-5 gap-1.5 text-xs"
              >
                <Save className="h-3.5 w-3.5" />
                {isAr ? "حفظ إعدادات التنسيق" : "Save Preferences"}
              </Button>
            </div>
          </div>

          {/* Section 2: Last Backup Status & Quick Actions */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="md:col-span-2 p-4 rounded-2xl border border-primary/20 bg-primary/5 space-y-3 flex flex-col justify-between">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-foreground flex items-center gap-1.5">
                  <Clock className="h-4 w-4 text-primary" />
                  {isAr ? "حالة آخر نسخة احتياطية" : "Last Backup Snapshot Status"}
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
                  <span className="text-muted-foreground block">{isAr ? "تاريخ العملية:" : "Date:"}</span>
                  <span className="font-semibold text-foreground">
                    {settings.last_backup_at
                      ? new Date(settings.last_backup_at).toLocaleString("ar-SA")
                      : "—"}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground block">{isAr ? "حجم النسخة:" : "Size:"}</span>
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
                className="w-full rounded-2xl gap-2 text-xs font-semibold"
              >
                {creatingBackup ? (
                  <>
                    <RefreshCw className="h-4 w-4 animate-spin" />
                    جاري التشفير والتجهيز...
                  </>
                ) : (
                  <>
                    <Download className="h-4 w-4" />
                    تنزيل نسخة محددة يدوياً (.vortexbak)
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
                {isAr ? "استعادة نقطة زمنية سابقة" : "Safe Restore Wizard"}
              </Button>
            </div>
          </div>

          {/* Section 3: Historical Audit Logs Table */}
          <div className="space-y-3 pt-2">
            <div className="text-xs font-bold text-foreground flex items-center gap-1.5">
              <Sparkles className="h-4 w-4 text-primary" />
              {isAr ? "سجل حركات النسخ والاستعادة التاريخي" : "Backup & Restore Audit Log History"}
            </div>

            <div className="rounded-2xl border border-border/80 overflow-hidden bg-surface">
              <Table>
                <TableHeader>
                  <TableRow className="bg-surface-2/60">
                    <TableHead className="text-xs">{isAr ? "التاريخ والوقت" : "Date & Time"}</TableHead>
                    <TableHead className="text-xs">{isAr ? "المُنفّذ" : "Actor"}</TableHead>
                    <TableHead className="text-xs">{isAr ? "نوع الحركة" : "Type"}</TableHead>
                    <TableHead className="text-xs">{isAr ? "الحجم" : "Size"}</TableHead>
                    <TableHead className="text-xs">{isAr ? "الحالة" : "Status"}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {logs.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center text-xs text-muted-foreground py-6">
                        {isAr ? "لا توجد حركات سابقة مسجلة" : "No recorded backup logs yet"}
                      </TableCell>
                    </TableRow>
                  ) : (
                    logs.slice(0, 5).map((log) => (
                      <TableRow key={log.id} className="text-xs">
                        <TableCell className="font-mono text-muted-foreground">
                          {new Date(log.created_at).toLocaleString("ar-SA")}
                        </TableCell>
                        <TableCell className="font-medium text-foreground">{log.actor_name}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-[10px] rounded-lg">
                            {log.action_type === "manual_local"
                              ? "يدوي محلي"
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

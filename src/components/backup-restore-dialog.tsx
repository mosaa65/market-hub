import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import {
  ShieldAlert,
  CheckCircle2,
  AlertTriangle,
  Upload,
  Lock,
  Database,
  FileCheck,
  RefreshCw,
  Factory,
  Receipt,
  Users,
  Layers,
  Building2,
} from "lucide-react";
import {
  validateBackupFile,
  restoreTenantDataServerSide,
  exportTenantDataServerSide,
} from "@/lib/backup/engine";
import { BackupValidationResult } from "@/lib/backup/types";
import { toast } from "sonner";

interface BackupRestoreDialogProps {
  open: boolean;
  onClose: () => void;
}

export function BackupRestoreDialog({ open, onClose }: BackupRestoreDialogProps) {
  const [step, setStep] = useState<
    "upload" | "inspect" | "auth" | "complete" | "restoring" | "restoreDone"
  >("upload");
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string>("");
  const [passphrase, setPassphrase] = useState<string>("");
  const [validating, setValidating] = useState<boolean>(false);
  const [validationResult, setValidationResult] = useState<BackupValidationResult | null>(null);
  const [restoreSummary, setRestoreSummary] = useState<{
    inserted_rows: number;
    skipped_tables: string[];
    schema_fingerprint_mismatch: boolean;
  } | null>(null);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      setFileContent(text);
      setStep("auth");
    };
    reader.readAsText(file);
  };

  const handleVerify = async () => {
    if (!fileContent || !passphrase) {
      toast.error("يرجى إدخال كلمة المرور / المفتاح السري المعتمد لفك التشفير");
      return;
    }
    setValidating(true);
    try {
      const res = await validateBackupFile(fileContent, passphrase);
      setValidationResult(res);
      setValidating(false);
      if (res.isValid) {
        setStep("inspect");
        toast.success("تم التثبت من سلامة وتكامل الملف بنجاح");
      } else {
        toast.error(res.errors[0] || "فشل التحقق من صحة ملف النسخة الاحتياطية");
      }
    } catch {
      setValidating(false);
      toast.error("حدث خطأ غير متوقع أثناء فحص ملف النسخة الاحتياطية");
    }
  };

  const handleExecuteRestore = async () => {
    if (!validationResult?.payload) return;
    setStep("restoring");
    try {
      // v3: التحقق من بصمة السكيما قبل التنفيذ ثم الاستعادة الفعلية على الخادم
      // (RPC backup_restore_all — Transaction واحد، owner فقط).
      const payload = validationResult.payload as any;
      const serverPayload = payload?.server_dynamic
        ? payload // نسخة خادمية جديدة: جاهزة مباشرة
        : null; // نسخة v2 قديمة: صيغة غير مدعومة للاستعادة الخادمية
      if (!serverPayload) {
        toast.error(
          "هذه نسخة قديمة (v2) بصيغة غير متوافقة مع الاستعادة الخادمية. أنشئ نسخة جديدة من شاشة الإعدادات أولاً.",
          { duration: 8000 },
        );
        setStep("inspect");
        return;
      }
      const result = await restoreTenantDataServerSide(serverPayload);
      setRestoreSummary({
        inserted_rows: result.inserted_rows,
        skipped_tables: result.skipped_tables ?? [],
        schema_fingerprint_mismatch: result.schema_fingerprint_mismatch,
      });
      setStep("restoreDone");
      toast.success(
        `تمت الاستعادة بنجاح: ${result.inserted_rows} صف عبر الخادم داخل Transaction واحد.`,
        { duration: 8000 },
      );
    } catch (err: any) {
      toast.error(err?.message || "فشلت الاستعادة الخادمية — لم يُمسّ شيء (ROLLBACK كامل)");
      setStep("inspect");
    }
  };

  const resetAll = () => {
    setStep("upload");
    setFileContent(null);
    setFileName("");
    setPassphrase("");
    setValidationResult(null);
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={resetAll}>
      <DialogContent className="max-w-2xl rounded-3xl p-6">
        <DialogHeader>
          <DialogTitle className="text-lg font-bold flex items-center gap-2">
            <Database className="h-5 w-5 text-primary" />
            استعادة نقطة زمنية سابقة (Snapshot Restore Inspector v2.0)
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            فحص وتأكيد سلامة وتكامل جداول النسخة الاحتياطية قبل الاستعادة لحماية بيانات المتجر.
          </DialogDescription>
        </DialogHeader>

        {/* Step 1: Upload File */}
        {step === "upload" && (
          <div className="space-y-4 py-4">
            <div className="border-2 border-dashed border-primary/30 rounded-3xl p-8 text-center bg-primary/5 hover:bg-primary/10 transition-colors cursor-pointer relative">
              <input
                type="file"
                accept=".vortexbak,.json"
                onChange={handleFileUpload}
                className="absolute inset-0 opacity-0 cursor-pointer"
              />
              <Upload className="h-10 w-10 text-primary mx-auto mb-3 animate-bounce" />
              <div className="text-sm font-semibold text-foreground">
                اضغط هنا لاختيار ملف النسخة الاحتياطية (`.vortexbak`)
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                أو اسحب واسقط الملف داخل هذه المنطقة
              </div>
            </div>
          </div>
        )}

        {/* Step 2: Security Auth */}
        {step === "auth" && (
          <div className="space-y-4 py-4">
            <Alert className="border-amber-500/30 bg-amber-500/10">
              <Lock className="h-4 w-4 text-amber-500" />
              <AlertTitle className="text-sm font-semibold text-amber-600 dark:text-amber-400">
                الملف المرفق: {fileName}
              </AlertTitle>
              <AlertDescription className="text-xs text-muted-foreground mt-1">
                الملف مشفّر بواسطة AES-256-GCM. أدخل كلمة المرور المعتمدة لفك التشفير والفحص.
              </AlertDescription>
            </Alert>

            <div className="space-y-2">
              <Label className="text-xs font-semibold">كلمة المرور / المفتاح السري</Label>
              <Input
                type="password"
                placeholder="أدخل مفتاح التشفير الخاص بالنسخة..."
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
                className="rounded-2xl"
              />
            </div>

            <Button
              onClick={handleVerify}
              disabled={validating || !passphrase}
              className="w-full rounded-2xl gap-2"
            >
              {validating ? (
                <>
                  <RefreshCw className="h-4 w-4 animate-spin" />
                  جاري فك التشفير والتحقق من التوقيع الرقمي...
                </>
              ) : (
                <>
                  <FileCheck className="h-4 w-4" />
                  فحص سلامة واستحقاق الملف
                </>
              )}
            </Button>
          </div>
        )}

        {/* Step 3: Inspect Metadata & Dry Run Results */}
        {step === "inspect" && validationResult?.metadata && (
          <div className="space-y-4 py-3">
            <Alert className="border-emerald-500/40 bg-emerald-500/10">
              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
              <AlertTitle className="text-sm font-semibold text-emerald-600 dark:text-emerald-400">
                تم التثبت من صحة وملاءمة النسخة الاحتياطية
              </AlertTitle>
              <AlertDescription className="text-xs text-muted-foreground mt-0.5">
                تطابق التوقيع الرقمي (AES-GCM Auth Tag) ولم يتم رصد أي تلاعب أو تلف في البيانات.
              </AlertDescription>
            </Alert>

            <div className="grid grid-cols-2 gap-3 p-3.5 rounded-2xl border border-border bg-surface/70 text-xs">
              <div>
                <span className="text-muted-foreground">معرف النسخة:</span>
                <span className="font-mono block text-foreground truncate">
                  {validationResult.metadata.backup_id}
                </span>
              </div>
              <div>
                <span className="text-muted-foreground">معرف المتجر (Tenant):</span>
                <span className="font-mono block text-foreground">
                  {validationResult.metadata.tenant_id}
                </span>
              </div>
              <div>
                <span className="text-muted-foreground">تاريخ ووقت التصدير:</span>
                <span className="block font-medium text-foreground">
                  {new Date(validationResult.metadata.created_at).toLocaleString("ar-YE")}
                </span>
              </div>
              <div>
                <span className="text-muted-foreground">إصدار السكيما والمحرك:</span>
                <span className="block font-medium text-foreground">
                  {validationResult.metadata.schema_version} (محرك{" "}
                  {validationResult.metadata.engine_version}، مفتاح{" "}
                  {validationResult.metadata.key_version})
                </span>
              </div>
            </div>

            {/* Category Statistics Breakdown */}
            {validationResult.categoryStats && (
              <div className="p-3 rounded-2xl border border-border/80 bg-surface/80 space-y-2">
                <div className="text-xs font-bold text-foreground flex items-center justify-between">
                  <span>توزيع سجلات الجداول المكتشفة بالملف:</span>
                  <span className="text-primary font-mono">
                    {validationResult.categoryStats.totalRecords} سجل في{" "}
                    {validationResult.categoryStats.totalTables} جدولاً
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-2 text-[11px]">
                  <div className="p-1.5 rounded-lg bg-surface-2/60 border border-border/50">
                    <span className="text-muted-foreground">إعدادات أساسية: </span>
                    <span className="font-bold font-mono">
                      {validationResult.categoryStats.core}
                    </span>
                  </div>
                  <div className="p-1.5 rounded-lg bg-surface-2/60 border border-border/50">
                    <span className="text-muted-foreground">منتجات ومخزون: </span>
                    <span className="font-bold font-mono">
                      {validationResult.categoryStats.productsAndStock}
                    </span>
                  </div>
                  <div className="p-1.5 rounded-lg bg-surface-2/60 border border-border/50">
                    <span className="text-muted-foreground">مبيعات ومشتريات: </span>
                    <span className="font-bold font-mono">
                      {validationResult.categoryStats.salesAndPurchases}
                    </span>
                  </div>
                  <div className="p-1.5 rounded-lg bg-surface-2/60 border border-border/50">
                    <span className="text-muted-foreground">عملاء ومالية: </span>
                    <span className="font-bold font-mono">
                      {validationResult.categoryStats.financeAndLedgers}
                    </span>
                  </div>
                  <div className="p-1.5 rounded-lg bg-surface-2/60 border border-border/50">
                    <span className="text-amber-600 dark:text-amber-400 font-medium">
                      المطاحن والمعالجة:{" "}
                    </span>
                    <span className="font-bold font-mono">
                      {validationResult.categoryStats.millingModule}
                    </span>
                  </div>
                  <div className="p-1.5 rounded-lg bg-surface-2/60 border border-border/50">
                    <span className="text-purple-600 dark:text-purple-400 font-medium">
                      المصروفات ERP:{" "}
                    </span>
                    <span className="font-bold font-mono">
                      {validationResult.categoryStats.expenseModule}
                    </span>
                  </div>
                </div>
              </div>
            )}

            {validationResult.warnings.length > 0 && (
              <div className="p-3 rounded-2xl border border-amber-500/30 bg-amber-500/5 text-xs text-amber-600 dark:text-amber-400 space-y-1">
                <div className="font-semibold flex items-center gap-1.5">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  تنبيهات توافقية:
                </div>
                {validationResult.warnings.map((w, idx) => (
                  <div key={idx}>• {w}</div>
                ))}
              </div>
            )}

            <div className="p-3.5 rounded-2xl border border-rose-500/30 bg-rose-500/5 space-y-2">
              <div className="text-xs font-bold text-rose-600 dark:text-rose-400 flex items-center gap-1.5">
                <ShieldAlert className="h-4 w-4" />
                تحذير الأمان المتقدم:
              </div>
              <div className="text-xs text-muted-foreground leading-relaxed">
                استعادة النسخة ستقوم بأخذ لقطة سلامة مسبقة (Pre-Restore Safety Snapshot) تلقائياً،
                ثم استبدال بيانات المتجر بالحالة السابقة المعتمدة.
              </div>
            </div>
          </div>
        )}

        {/* Step 4: Restoring (in progress) */}
        {step === "restoring" && (
          <div className="space-y-4 py-8 text-center">
            <RefreshCw className="h-10 w-10 text-primary mx-auto animate-spin" />
            <div className="text-base font-bold text-foreground">
              جارٍ تنفيذ الاستعادة على الخادم…
            </div>
            <div className="text-xs text-muted-foreground max-w-md mx-auto">
              تُنفَّذ داخل Transaction واحد على قاعدة البيانات: تفريغ كامل ثم إدراج مطابق بالاسم ثم
              إعادة ضبط التسلسلات. أي فشل يعني ROLLBACK كامل دون أي مساس بالبيانات.
            </div>
          </div>
        )}

        {/* Step 5: Restore Done (real server-side result) */}
        {step === "restoreDone" && restoreSummary && (
          <div className="space-y-4 py-6 text-center">
            <CheckCircle2 className="h-12 w-12 text-emerald-500 mx-auto" />
            <div className="text-base font-bold text-foreground">تمت الاستعادة الفعلية بنجاح</div>
            <div className="text-xs text-muted-foreground max-w-md mx-auto space-y-1">
              <div>الصفوف المدرجة: {restoreSummary.inserted_rows}</div>
              {restoreSummary.skipped_tables.length > 0 && (
                <div className="text-amber-600">
                  جداول سُقطت (محذوفة من السكيما الحالية):{" "}
                  {restoreSummary.skipped_tables.join(", ")}
                </div>
              )}
              {restoreSummary.schema_fingerprint_mismatch && (
                <div className="text-amber-600">
                  تنبيه: بصمة السكيما مختلفة — حدث تغيير في الجداول/الأعمدة بين وقت النسخة ووقت
                  الاستعادة. تم التكيف بالاسم، لكن راجع البيانات الحرجة.
                </div>
              )}
            </div>
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          {step === "upload" && (
            <Button variant="outline" onClick={resetAll} className="rounded-2xl">
              إلغاء
            </Button>
          )}

          {step === "auth" && (
            <Button variant="outline" onClick={() => setStep("upload")} className="rounded-2xl">
              رجوع
            </Button>
          )}

          {step === "inspect" && (
            <>
              <Button variant="outline" onClick={resetAll} className="rounded-2xl">
                إلغاء
              </Button>
              <Button
                variant="destructive"
                onClick={handleExecuteRestore}
                className="rounded-2xl gap-1.5"
              >
                تأكيد وتنفيذ الاستعادة الفعلية (الخادم)
              </Button>
            </>
          )}

          {step === "restoreDone" && (
            <Button onClick={resetAll} className="rounded-2xl w-full">
              إغلاق النافذة
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

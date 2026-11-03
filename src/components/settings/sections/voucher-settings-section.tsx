"use client";

import * as React from "react";
import {
  BellRing,
  Volume2,
  Check,
  CheckCircle2,
  Sparkles,
  Printer,
  MessageCircle,
  Send,
  Copy,
  Receipt,
  RotateCcw,
  Sliders,
  Eye,
  FileText,
  Smartphone,
  ShieldCheck,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  useVoucherSettings,
  buildVoucherMessage,
  type VoucherTemplateId,
  type PostOperationVoucherSettings,
} from "@/lib/settings/voucher-settings-store";
import { money } from "@/lib/format";

interface VoucherSettingsSectionProps {
  canEdit?: boolean;
  lang?: string;
}

export function VoucherSettingsSection({
  canEdit = true,
  lang = "ar",
}: VoucherSettingsSectionProps) {
  const isAr = lang === "ar";
  const { settings, updateSettings, resetSettings, playChime } = useVoucherSettings();
  const [copiedPreview, setCopiedPreview] = React.useState(false);

  // Mock data for the live interactive preview
  const sampleVoucherData = {
    partyName: isAr ? "مؤسسة الأمل للتجارة والاستيراد" : "Al-Amal Trading Corp",
    operationTitle: isAr ? "فاتورة مبيعات وسند استلام" : "Sales Invoice & Receipt",
    amount: 85000,
    currency: isAr ? "ر.ي" : "YER",
    referenceNumber: "INV-94021",
    date: new Date().toLocaleDateString(isAr ? "ar-YE" : "en-US"),
    treasury: isAr ? "الصندوق الرئيسي (كاش)" : "Main Cashbox",
    remainingBalance: settings.showRemainingBalance ? 24500 : null,
    notes: isAr ? "تم الاستلام نقدًا مع خصم الترويج" : "Received in cash with promotion",
  };

  const previewText = buildVoucherMessage(
    sampleVoucherData,
    settings.defaultTemplate,
    isAr,
  );

  const handleTestSound = () => {
    playChime();
    toast.success(
      isAr ? "تم تشغيل رنين التأكيد بنجاح 🔔" : "Confirmation chime played successfully 🔔",
    );
  };

  const handleCopyPreview = () => {
    void navigator.clipboard.writeText(previewText);
    setCopiedPreview(true);
    setTimeout(() => setCopiedPreview(false), 2000);
    toast.success(isAr ? "تم نسخ نص المعاينة للحافظة" : "Preview text copied");
  };

  const handleReset = () => {
    resetSettings();
    toast.success(isAr ? "تمت استعادة الإعدادات الافتراضية" : "Settings reset to defaults");
  };

  const templateOptions: {
    id: VoucherTemplateId;
    title: string;
    description: string;
    tag: string;
  }[] = [
    {
      id: "official",
      title: isAr ? "سند رسمي متكامل (شامل التفاصيل)" : "Official Comprehensive",
      description: isAr
        ? "يتضمن اسم الطرف، نوع العملية، المبلغ، رقم السند، التاريخ، الخزينة، والرصيد المتبقي بدقة."
        : "Includes party name, operation type, amount, reference number, date, treasury, and remaining balance.",
      tag: isAr ? "مُوصى به" : "Recommended",
    },
    {
      id: "short",
      title: isAr ? "شكر موجز ورشيق" : "Short & Sweet",
      description: isAr
        ? "رسالة شكر خفيفة وسريعة تحتوي على المبلغ ورقم المرجع فقط لتفادي الإطالة."
        : "A quick, concise acknowledgment message containing only the amount and reference.",
      tag: isAr ? "سريع" : "Quick",
    },
    {
      id: "reminder",
      title: isAr ? "إشعار وتذكير بالرصيد المتبقي" : "Balance Reminder Notice",
      description: isAr
        ? "يركز على تسجيل المبلغ مع إبراز الرصيد المتبقي على حساب العميل لحثه على الالتزام."
        : "Focuses on the payment while highlighting remaining account debt.",
      tag: isAr ? "مالي" : "Financial",
    },
  ];

  return (
    <div className="space-y-6">
      {/* Introduction Banner */}
      <div className="rounded-3xl border border-primary/20 bg-gradient-to-br from-primary/10 via-card to-card p-5 sm:p-6 shadow-sm">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="grid size-12 place-items-center rounded-2xl bg-primary text-primary-foreground shadow-md shadow-primary/20">
              <Receipt className="size-6" />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-black text-foreground">
                {isAr ? "إعدادات سند ما بعد العملية والإشعارات" : "Post-Operation Voucher Settings"}
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                {isAr
                  ? "تخصيص النافذة المنبثقة التلقائية الأنيقة، صوت الرنين، القوالب الافتراضية، وخيارات المشاركة عبر واتساب والطباعة."
                  : "Customize the popup confirmation voucher, confirmation sound chime, default template, and share actions."}
              </p>
            </div>
          </div>

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleReset}
            disabled={!canEdit}
            className="rounded-xl text-xs font-semibold gap-1.5 shrink-0"
          >
            <RotateCcw className="size-3.5" />
            <span>{isAr ? "استعادة الافتراضي" : "Reset Defaults"}</span>
          </Button>
        </div>
      </div>

      {/* Grid: Audio & Behavior + Action Toggles */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {/* Card 1: Behavior & Audio Chime */}
        <Card className="rounded-2xl border-border/70 shadow-xs">
          <CardHeader className="pb-3 border-b border-border/50">
            <CardTitle className="text-sm font-bold flex items-center gap-2">
              <BellRing className="size-4 text-primary" />
              <span>{isAr ? "صوت الرنين وسلوك السند" : "Sound & Voucher Behavior"}</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 pt-4">
            {/* Sound Switch */}
            <div className="flex items-center justify-between gap-3">
              <div className="space-y-0.5">
                <span className="text-xs font-bold text-foreground block">
                  {isAr ? "تشغيل صوت الرنين الاحتفالي (Chime)" : "Enable Confirmation Chime"}
                </span>
                <span className="text-[11px] text-muted-foreground block">
                  {isAr
                    ? "نغمة تأكيد لطيفة وناعمة عند نجاح كل عملية (مبيعات، مشتريات، تحصيل)"
                    : "Pleasant harmonic chime upon completing sales, purchases, or collections"}
                </span>
              </div>
              <Switch
                checked={settings.soundEnabled}
                onCheckedChange={(val) => updateSettings({ soundEnabled: val })}
                disabled={!canEdit}
              />
            </div>

            {/* Test Sound Button */}
            {settings.soundEnabled && (
              <div className="rounded-xl bg-muted/40 border border-border/60 p-3 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-xs text-foreground font-semibold">
                  <Volume2 className="size-4 text-emerald-500" />
                  <span>{isAr ? "مستوى رنين الصوت:" : "Volume:"}</span>
                  <span className="font-mono text-[11px] text-muted-foreground">
                    {Math.round(settings.soundVolume * 100)}%
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleTestSound}
                    className="h-8 rounded-lg text-xs font-bold gap-1 text-primary border-primary/30 hover:bg-primary/10"
                  >
                    <span>{isAr ? "استمع للصوت 🔔" : "Test Sound 🔔"}</span>
                  </Button>
                </div>
              </div>
            )}

            {/* Auto-Show Voucher Switch */}
            <div className="flex items-center justify-between gap-3 pt-2 border-t border-border/40">
              <div className="space-y-0.5">
                <span className="text-xs font-bold text-foreground block">
                  {isAr ? "إظهار نافذة السند تلقائياً بعد الحفظ" : "Auto-Show Voucher Popup"}
                </span>
                <span className="text-[11px] text-muted-foreground block">
                  {isAr
                    ? "فتح النافذة الأنيقة فور حفظ الفاتورة أو السند للمراجعة والمشاركة"
                    : "Automatically pop up the elegant voucher details after saving"}
                </span>
              </div>
              <Switch
                checked={settings.autoShowVoucher}
                onCheckedChange={(val) => updateSettings({ autoShowVoucher: val })}
                disabled={!canEdit}
              />
            </div>

            {/* Auto-Print Switch */}
            <div className="flex items-center justify-between gap-3 pt-2 border-t border-border/40">
              <div className="space-y-0.5">
                <span className="text-xs font-bold text-foreground block">
                  {isAr ? "تشغيل الطباعة التلقائية فوراً" : "Auto-Print on Voucher Open"}
                </span>
                <span className="text-[11px] text-muted-foreground block">
                  {isAr
                    ? "إرسال أمر الطباعة تلقائياً عند ظهور السند دون الحاجة للنقر على زر الطباعة"
                    : "Automatically trigger print dialog when the voucher appears"}
                </span>
              </div>
              <Switch
                checked={settings.autoPrintOnSuccess}
                onCheckedChange={(val) => updateSettings({ autoPrintOnSuccess: val })}
                disabled={!canEdit}
              />
            </div>
          </CardContent>
        </Card>

        {/* Card 2: Controls & Sharing Options */}
        <Card className="rounded-2xl border-border/70 shadow-xs">
          <CardHeader className="pb-3 border-b border-border/50">
            <CardTitle className="text-sm font-bold flex items-center gap-2">
              <Sliders className="size-4 text-primary" />
              <span>{isAr ? "أزرار وبيانات السند المالي" : "Voucher Buttons & Details"}</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3.5 pt-4">
            {/* WhatsApp Button */}
            <div className="flex items-center justify-between gap-3">
              <div className="space-y-0.5">
                <span className="text-xs font-bold text-foreground flex items-center gap-1.5">
                  <MessageCircle className="size-3.5 text-emerald-500" />
                  <span>{isAr ? "زر إرسال واتساب المباشر" : "WhatsApp Direct Button"}</span>
                </span>
                <span className="text-[11px] text-muted-foreground block">
                  {isAr ? "فتح محادثة واتساب بنص السند الجاهز" : "One-click send via WhatsApp"}
                </span>
              </div>
              <Switch
                checked={settings.showWhatsAppButton}
                onCheckedChange={(val) => updateSettings({ showWhatsAppButton: val })}
                disabled={!canEdit}
              />
            </div>

            {/* SMS Button */}
            <div className="flex items-center justify-between gap-3 pt-2 border-t border-border/40">
              <div className="space-y-0.5">
                <span className="text-xs font-bold text-foreground flex items-center gap-1.5">
                  <Send className="size-3.5 text-sky-500" />
                  <span>{isAr ? "زر إرسال رسالة SMS" : "SMS Button"}</span>
                </span>
                <span className="text-[11px] text-muted-foreground block">
                  {isAr ? "إرسال نص السند كرسالة نصية عادية" : "Send notice as regular SMS"}
                </span>
              </div>
              <Switch
                checked={settings.showSmsButton}
                onCheckedChange={(val) => updateSettings({ showSmsButton: val })}
                disabled={!canEdit}
              />
            </div>

            {/* Copy Button */}
            <div className="flex items-center justify-between gap-3 pt-2 border-t border-border/40">
              <div className="space-y-0.5">
                <span className="text-xs font-bold text-foreground flex items-center gap-1.5">
                  <Copy className="size-3.5 text-primary" />
                  <span>{isAr ? "زر نسخ نص الإشعار للحافظة" : "Copy to Clipboard Button"}</span>
                </span>
                <span className="text-[11px] text-muted-foreground block">
                  {isAr ? "نسخ السند كاملاً بضغطة واحدة" : "Copy full voucher text with one click"}
                </span>
              </div>
              <Switch
                checked={settings.showCopyButton}
                onCheckedChange={(val) => updateSettings({ showCopyButton: val })}
                disabled={!canEdit}
              />
            </div>

            {/* Remaining Balance */}
            <div className="flex items-center justify-between gap-3 pt-2 border-t border-border/40">
              <div className="space-y-0.5">
                <span className="text-xs font-bold text-foreground block">
                  {isAr ? "إظهار الرصيد المتبقي على العميل/المورد" : "Show Remaining Balance"}
                </span>
                <span className="text-[11px] text-muted-foreground block">
                  {isAr
                    ? "إبراز الرصيد المتبقي بعد العملية في تفاصيل السند والرسالة"
                    : "Include remaining account balance in voucher details and text"}
                </span>
              </div>
              <Switch
                checked={settings.showRemainingBalance}
                onCheckedChange={(val) => updateSettings({ showRemainingBalance: val })}
                disabled={!canEdit}
              />
            </div>

            {/* Treasury / Account */}
            <div className="flex items-center justify-between gap-3 pt-2 border-t border-border/40">
              <div className="space-y-0.5">
                <span className="text-xs font-bold text-foreground block">
                  {isAr ? "إظهار اسم الخزينة / الحساب المالي" : "Show Treasury / Bank Account"}
                </span>
                <span className="text-[11px] text-muted-foreground block">
                  {isAr ? "عرض الصندوق أو البنك الذي تم السداد إليه" : "Display destination cashbox or bank"}
                </span>
              </div>
              <Switch
                checked={settings.showTreasuryAccount}
                onCheckedChange={(val) => updateSettings({ showTreasuryAccount: val })}
                disabled={!canEdit}
              />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Card 3: Template Selector & Live Interactive Preview */}
      <Card className="rounded-2xl border-border/70 shadow-xs">
        <CardHeader className="pb-3 border-b border-border/50">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-bold flex items-center gap-2">
              <Sparkles className="size-4 text-primary" />
              <span>{isAr ? "قوالب رسائل السند والمعاينة التفاعلية" : "Message Templates & Live Preview"}</span>
            </CardTitle>
            <span className="text-xs text-muted-foreground font-medium">
              {isAr ? "اختر القالب المفضل وسيُطبق على كافة العمليات" : "Applied across all operations"}
            </span>
          </div>
        </CardHeader>
        <CardContent className="space-y-6 pt-5">
          {/* Template Choice Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {templateOptions.map((tpl) => {
              const isSelected = settings.defaultTemplate === tpl.id;
              return (
                <div
                  key={tpl.id}
                  onClick={() => canEdit && updateSettings({ defaultTemplate: tpl.id })}
                  className={`rounded-2xl border p-4 cursor-pointer transition-all duration-200 relative flex flex-col justify-between ${
                    isSelected
                      ? "border-primary bg-primary/5 ring-2 ring-primary/20 shadow-sm"
                      : "border-border/70 bg-card hover:bg-muted/40"
                  }`}
                >
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold text-primary">
                        {tpl.tag}
                      </span>
                      {isSelected ? (
                        <div className="grid size-5 place-items-center rounded-full bg-primary text-primary-foreground">
                          <Check className="size-3 stroke-[3]" />
                        </div>
                      ) : (
                        <div className="size-5 rounded-full border border-border" />
                      )}
                    </div>
                    <h3 className="text-xs font-bold text-foreground">{tpl.title}</h3>
                    <p className="text-[11px] text-muted-foreground leading-relaxed">
                      {tpl.description}
                    </p>
                  </div>

                  <div className="pt-3 text-[10px] font-bold text-primary">
                    {isSelected
                      ? isAr
                        ? "القالب الافتراضي المعتمد ✓"
                        : "Active Template ✓"
                      : isAr
                        ? "انقر للاعتماد كافتراضي"
                        : "Click to select"}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Live Mobile/Card Preview */}
          <div className="rounded-2xl border border-border/80 bg-muted/20 p-4 sm:p-5 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs font-bold text-foreground">
                <Smartphone className="size-4 text-emerald-500" />
                <span>
                  {isAr
                    ? "معاينة حية لشكل رسالة السند (كما ستصل للعميل/المورد):"
                    : "Live Message Preview (as sent to recipient):"}
                </span>
              </div>

              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleCopyPreview}
                className="h-8 rounded-lg text-xs font-semibold gap-1.5"
              >
                {copiedPreview ? (
                  <Check className="size-3 text-emerald-500" />
                ) : (
                  <Copy className="size-3" />
                )}
                <span>
                  {copiedPreview
                    ? isAr
                      ? "تم النسخ"
                      : "Copied"
                    : isAr
                      ? "نسخ نص المعاينة"
                      : "Copy Preview"}
                </span>
              </Button>
            </div>

            {/* Simulated Chat Message Bubble */}
            <div className="max-w-md mx-auto rounded-2xl border border-border/80 bg-card p-4 shadow-sm space-y-2 text-start">
              <div className="flex items-center justify-between text-[11px] pb-2 border-b border-border/50 text-muted-foreground font-mono">
                <span className="flex items-center gap-1">
                  <ShieldCheck className="size-3.5 text-emerald-500" />
                  <span>Vortex ERP Verified Notice</span>
                </span>
                <span>{sampleVoucherData.date}</span>
              </div>
              <p
                className="text-xs leading-relaxed text-foreground whitespace-pre-wrap font-sans select-all"
                dir={isAr ? "rtl" : "ltr"}
              >
                {previewText}
              </p>
            </div>

            <p className="text-[11px] text-center text-muted-foreground">
              {isAr
                ? "💡 يتم بناء الرسالة تلقائياً وتضمين بيانات كل فاتورة أو سند وحساب الخزينة فور إتمام العملية."
                : "💡 The text is populated dynamically with invoice totals, recipient name, and treasury data upon each transaction."}
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

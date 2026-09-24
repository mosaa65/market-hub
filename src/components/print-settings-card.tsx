import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Printer, Eye, ScrollText, Sparkles, Layers, Sliders, CheckCircle2, ShieldCheck } from "lucide-react";
import { getPrintSettings, savePrintSettings, PrintSettings, InvoiceTemplateId, PaperSize } from "@/lib/templates";
import { PrintPreviewModal } from "@/components/print-preview";
import { toast } from "sonner";

interface PrintSettingsCardProps {
  canEdit?: boolean;
}

export function PrintSettingsCard({ canEdit = true }: PrintSettingsCardProps) {
  const [settings, setSettings] = useState<PrintSettings>(() => getPrintSettings());
  const [previewOpen, setPreviewOpen] = useState(false);

  useEffect(() => {
    setSettings(getPrintSettings());
  }, []);

  function handleToggle(key: keyof PrintSettings) {
    const updated = savePrintSettings({ [key]: !settings[key] });
    setSettings(updated);
    toast.success("تم تحديث إعدادات الطباعة");
  }

  function handleSelect(key: keyof PrintSettings, value: any) {
    const updated = savePrintSettings({ [key]: value });
    setSettings(updated);
    toast.success("تم التحديث بنجاح");
  }

  return (
    <>
      <Card className="lg:col-span-2 rounded-3xl border-primary/20 bg-card shadow-sm overflow-hidden">
        <CardHeader className="bg-muted/30 border-b pb-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle className="text-base font-bold flex items-center gap-2">
              <Printer className="h-5 w-5 text-primary" />
              إعدادات نظام الفواتير والطباعة الشاملة (Printing Architecture & Templates)
            </CardTitle>
            <Button
              type="button"
              variant="outline"
              onClick={() => setPreviewOpen(true)}
              className="rounded-full gap-1.5 border-primary/40 text-primary hover:bg-primary/10"
            >
              <Eye className="h-4 w-4 me-1" />
              المعاينة التفاعلية المباشرة (Live Preview)
            </Button>
          </div>
        </CardHeader>

        <CardContent className="space-y-6 pt-5">
          {/* Section 1: Default Templates Per Document Type */}
          <div>
            <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-1.5">
              <ScrollText className="h-4 w-4 text-primary" />
              1. القوالب الافتراضية لكل نوع مستند (Default Templates)
            </h4>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Customer Invoice Default Template */}
              <div className="space-y-1.5 p-3.5 rounded-2xl border bg-surface/80">
                <Label className="text-xs font-semibold">قالب فاتورة العميل الافتراضي</Label>
                <Select
                  value={settings.defaultCustomerTemplate}
                  onValueChange={(val: InvoiceTemplateId) => handleSelect("defaultCustomerTemplate", val)}
                  disabled={!canEdit}
                >
                  <SelectTrigger className="rounded-xl bg-background">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="thermal">حراري (Thermal POS 80mm)</SelectItem>
                    <SelectItem value="standard">قياسي (Standard A4)</SelectItem>
                    <SelectItem value="elegant">فاخر (Gold Luxury A4)</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground mt-1">
                  القالب الذي يتم اعتماده تلقائياً عند طباعة فواتير المبيعات للعملاء.
                </p>
              </div>

              {/* Inventory Document Default Template */}
              <div className="space-y-1.5 p-3.5 rounded-2xl border bg-surface/80">
                <Label className="text-xs font-semibold">قالب مستند حركة المخزون</Label>
                <Select
                  value={settings.defaultInventoryTemplate}
                  onValueChange={(val: InvoiceTemplateId) => handleSelect("defaultInventoryTemplate", val)}
                  disabled={!canEdit}
                >
                  <SelectTrigger className="rounded-xl bg-background">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="thermal">مخزني حراري (POS 80mm)</SelectItem>
                    <SelectItem value="standard">مخزني قياسي (A4 Stock Issue)</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground mt-1">
                  المستند الداخلي المخصص لتوثيق حركة المخزون وأمناء المخازن.
                </p>
              </div>

              {/* Paper Size Setting */}
              <div className="space-y-1.5 p-3.5 rounded-2xl border bg-surface/80">
                <Label className="text-xs font-semibold">حجم ورق الطباعة الافتراضي</Label>
                <Select
                  value={settings.paperSize}
                  onValueChange={(val: PaperSize) => handleSelect("paperSize", val)}
                  disabled={!canEdit}
                >
                  <SelectTrigger className="rounded-xl bg-background">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="80mm">طابعة حرارية (80mm POS)</SelectItem>
                    <SelectItem value="58mm">طابعة حرارية صغيرة (58mm POS)</SelectItem>
                    <SelectItem value="A4">ورق قياسي A4</SelectItem>
                    <SelectItem value="A5">ورق صغير A5</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground mt-1">
                  المقاس المعتمد لضبط هوامش الصفحة وعرض المستند.
                </p>
              </div>
            </div>
          </div>

          {/* Section 2: Multi-Document Print Job Automation */}
          <div className="pt-2 border-t">
            <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-1.5">
              <Layers className="h-4 w-4 text-primary" />
              2. الطباعة المتعددة التلقائية بعد إنهاء البيع (Multi-Document Print Jobs)
            </h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="flex items-center justify-between p-3.5 rounded-2xl border bg-surface/80">
                <div className="space-y-0.5 pe-3">
                  <div className="text-sm font-semibold">طباعة فاتورة العميل تلقائياً</div>
                  <div className="text-xs text-muted-foreground">
                    إرسال فاتورة العميل إلى المحرك فور اعتماد العملية.
                  </div>
                </div>
                <Switch
                  checked={settings.autoPrintCustomerInvoice}
                  onCheckedChange={() => handleToggle("autoPrintCustomerInvoice")}
                  disabled={!canEdit}
                />
              </div>

              <div className="flex items-center justify-between p-3.5 rounded-2xl border bg-surface/80">
                <div className="space-y-0.5 pe-3">
                  <div className="text-sm font-semibold">طباعة مستند المخزون تلقائياً</div>
                  <div className="text-xs text-muted-foreground">
                    طباعة مستند إذن الصرف المخزني الداخلي بالتوازي مع الفاتورة.
                  </div>
                </div>
                <Switch
                  checked={settings.autoPrintInventoryDocument}
                  onCheckedChange={() => handleToggle("autoPrintInventoryDocument")}
                  disabled={!canEdit}
                />
              </div>
            </div>
          </div>

          {/* Section 3: Field Visibility Toggles (إظهار/إخفاء عناصر الفاتورة) */}
          <div className="pt-2 border-t">
            <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-1.5">
              <Sliders className="h-4 w-4 text-primary" />
              3. تخصيص إظهار وإخفاء عناصر المستندات (Field Visibility Customization)
            </h4>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 text-xs">
              <ToggleOption label="شعار المنشأة" checked={settings.showLogo} onChange={() => handleToggle("showLogo")} disabled={!canEdit} />
              <ToggleOption label="بيانات المنشأة" checked={settings.showCompanyInfo} onChange={() => handleToggle("showCompanyInfo")} disabled={!canEdit} />
              <ToggleOption label="بيانات العميل" checked={settings.showCustomerInfo} onChange={() => handleToggle("showCustomerInfo")} disabled={!canEdit} />
              <ToggleOption label="رقم المستند والتاريخ" checked={settings.showDocNumberDate} onChange={() => handleToggle("showDocNumberDate")} disabled={!canEdit} />
              <ToggleOption label="بيانات الحركة والمستودع" checked={settings.showMovementInfo} onChange={() => handleToggle("showMovementInfo")} disabled={!canEdit} />
              <ToggleOption label="الضريبة والخصم" checked={settings.showFinancialDetails} onChange={() => handleToggle("showFinancialDetails")} disabled={!canEdit} />
              <ToggleOption label="طريقة الدفع والمدفوع" checked={settings.showPaymentInfo} onChange={() => handleToggle("showPaymentInfo")} disabled={!canEdit} />
              <ToggleOption label="الملاحظات والشروط" checked={settings.showNotes} onChange={() => handleToggle("showNotes")} disabled={!canEdit} />
              <ToggleOption label="خانات التوقيعات" checked={settings.showSignatures} onChange={() => handleToggle("showSignatures")} disabled={!canEdit} />
              <ToggleOption label="الهامش السفلي Footer" checked={settings.showFooter} onChange={() => handleToggle("showFooter")} disabled={!canEdit} />
              <ToggleOption label="التوقيع البرمجي (Inama Soft)" checked={settings.showBranding} onChange={() => handleToggle("showBranding")} disabled={!canEdit} />
            </div>
          </div>

          {/* Section 4: Direct Printer System Overview */}
          <div className="pt-2 border-t">
            <div className="p-4 rounded-2xl border border-emerald-500/20 bg-emerald-500/5 dark:bg-emerald-500/10 space-y-2">
              <div className="flex items-center gap-2 text-sm font-bold text-emerald-700 dark:text-emerald-400">
                <ShieldCheck className="h-4 w-4" />
                محرك الطباعة المباشر ودعم طابعات الـ Thermal و A4
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">
                يدعم النظام طباعة الفواتير بدون توقف عبر متصفح الويب (Browser Print Engine) دون الحاجة لإضافات معقدة. كما أُعدت معمارية النظام (Architecture) لتكون جاهزة للتكامل المباشر مع خدمات الطباعة المحلية مثل <b>QZ Tray</b> أو برامج الـ Desktop Wrappers للطابعات الحرارية الشبكية والمباشرة USB.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <PrintPreviewModal open={previewOpen} onOpenChange={setPreviewOpen} />
    </>
  );
}

function ToggleOption({ label, checked, onChange, disabled }: { label: string; checked?: boolean; onChange: () => void; disabled?: boolean }) {
  return (
    <div className="flex items-center justify-between p-2.5 rounded-xl border bg-surface/60 hover:bg-surface transition">
      <span className="font-medium text-foreground text-[11.5px] pe-2">{label}</span>
      <Switch checked={!!checked} onCheckedChange={onChange} disabled={disabled} className="scale-90" />
    </div>
  );
}

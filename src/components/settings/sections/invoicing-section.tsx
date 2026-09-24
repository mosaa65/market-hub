import { Receipt, ScanBarcode, Wrench, Image as ImageIcon, Printer } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { InvoiceTemplate } from "@/lib/invoice-print";

interface InvoicingSectionProps {
  form: any;
  setForm: (form: any) => void;
  enablePosServiceFee: boolean;
  setEnablePosServiceFee: (v: boolean) => void;
  printMode: "auto" | "ask" | "off";
  setPrintMode: (v: "auto" | "ask" | "off") => void;
  defaultPrintTemplate: InvoiceTemplate;
  setDefaultPrintTemplate: (v: InvoiceTemplate) => void;
  canEdit: boolean;
  lang: string;
}

export function InvoicingSection({
  form,
  setForm,
  enablePosServiceFee,
  setEnablePosServiceFee,
  printMode,
  setPrintMode,
  defaultPrintTemplate,
  setDefaultPrintTemplate,
  canEdit,
  lang,
}: InvoicingSectionProps) {
  const isAr = lang === "ar";

  return (
    <Card className="rounded-3xl border-border/80 shadow-xs">
      <CardHeader className="border-b border-border/50 pb-4">
        <CardTitle className="text-base font-bold flex items-center gap-2">
          <div className="p-2 rounded-xl bg-primary/10 text-primary">
            <Receipt className="h-5 w-5" />
          </div>
          <div>
            <div>{isAr ? "إعدادات الفواتير والسلة والعملة" : "Invoicing & POS Cart Settings"}</div>
            <div className="text-xs text-muted-foreground font-normal mt-0.5">
              {isAr
                ? "ضبط العملة الحسابية، نسبة الضريبة، الباركود، وإيقاف/تفعيل أجور الخدمة والسلة"
                : "Configure base currency, tax %, invoice numbering prefix, and POS cart toggles"}
            </div>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5 pt-5">
        {/* Currency & Financial Standards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="grid gap-1.5">
            <Label className="text-xs font-semibold">{isAr ? "العملة" : "Currency"}</Label>
            <Input
              value={form.currency ?? "USD"}
              onChange={(e) => setForm({ ...form, currency: e.target.value })}
              disabled={!canEdit}
              placeholder="YER / SAR / USD"
              className="rounded-2xl uppercase font-mono"
            />
          </div>

          <div className="grid gap-1.5">
            <Label className="text-xs font-semibold">{isAr ? "رمز العملة" : "Currency symbol"}</Label>
            <Input
              value={form.currency_symbol ?? ""}
              onChange={(e) => setForm({ ...form, currency_symbol: e.target.value })}
              disabled={!canEdit}
              placeholder="ر.ي / $"
              className="rounded-2xl"
            />
          </div>

          <div className="grid gap-1.5">
            <Label className="text-xs font-semibold">{isAr ? "نسبة الضريبة %" : "Tax rate %"}</Label>
            <Input
              type="number"
              value={String(form.tax_rate ?? 0)}
              onChange={(e) => setForm({ ...form, tax_rate: e.target.value })}
              disabled={!canEdit}
              placeholder="15"
              className="rounded-2xl font-mono"
            />
          </div>

          <div className="grid gap-1.5">
            <Label className="text-xs font-semibold">{isAr ? "بادئة الفاتورة" : "Invoice prefix"}</Label>
            <Input
              value={form.invoice_prefix ?? "INV"}
              onChange={(e) => setForm({ ...form, invoice_prefix: e.target.value })}
              disabled={!canEdit}
              placeholder="INV"
              className="rounded-2xl uppercase font-mono"
            />
          </div>
        </div>

        {/* Feature Switches */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Custom Labor Fee Switch */}
          <div className="flex items-center justify-between p-4 rounded-2xl border border-border/80 bg-surface/70">
            <div className="space-y-1 pe-3">
              <div className="text-sm font-semibold flex items-center gap-2">
                <Wrench className="h-4 w-4 text-amber-500" />
                {isAr ? "خدمة أو أجرة تركيب بسعر مخصص" : "Custom Labor / Installation Fee"}
              </div>
              <div className="text-xs text-muted-foreground leading-relaxed">
                {isAr
                  ? "إظهار زر مخصص في سلة نقطة البيع (POS) لإضافة بند خدمة سريعة أو أجور عمالة مباشرة."
                  : "Enable quick custom service or labor fee entry in POS cart without catalog lookup."}
              </div>
            </div>
            <Switch
              checked={enablePosServiceFee}
              onCheckedChange={setEnablePosServiceFee}
              disabled={!canEdit}
            />
          </div>

          {/* Barcode Scanner Mode */}
          <div className="flex items-center justify-between p-4 rounded-2xl border border-border/80 bg-surface/70">
            <div className="space-y-1 pe-3">
              <div className="text-sm font-semibold flex items-center gap-2">
                <ScanBarcode className="h-4 w-4 text-violet-500" />
                {isAr ? "تفعيل قارئ الباركود في POS" : "Barcode Scanner Mode"}
              </div>
              <div className="text-xs text-muted-foreground leading-relaxed">
                {isAr
                  ? "السماح بمسح وقراءة الباركود بالكاميرا أو القارئ اليدوي في شاشة نقطة البيع."
                  : "Allow barcode scanning at POS."}
              </div>
            </div>
            <Switch
              checked={!!form.barcode_enabled}
              onCheckedChange={(v) => setForm({ ...form, barcode_enabled: v })}
              disabled={!canEdit}
            />
          </div>
        </div>

        {/* Logo URL */}
        <div className="grid gap-1.5">
          <Label className="text-xs font-semibold flex items-center gap-1.5">
            <ImageIcon className="h-3.5 w-3.5 text-primary" />
            {isAr ? "رابط الشعار المطبوع (Logo URL)" : "Printed Logo URL"}
          </Label>
          <Input
            value={form.logo_url ?? ""}
            onChange={(e) => setForm({ ...form, logo_url: e.target.value })}
            disabled={!canEdit}
            placeholder="https://example.com/logo.png"
            className="rounded-2xl font-mono"
          />
        </div>

        {/* Post-Sale Printing Shortcut */}
        <div className="pt-3 border-t border-border/60">
          <div className="flex items-center gap-2 mb-3">
            <Printer className="h-4 w-4 text-primary" />
            <span className="text-xs font-bold text-foreground uppercase tracking-wider">
              {isAr ? "سلوك الطباعة التلقائي بعد البيع" : "Post-Sale Print Behavior"}
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Print Mode Selector */}
            <div className="grid gap-1.5">
              <label className="text-xs text-muted-foreground font-medium">
                {isAr ? "وضع الطباعة بعد حفظ الفاتورة" : "Print mode after sale"}
              </label>
              <div className="grid grid-cols-3 gap-2">
                {(
                  [
                    { val: "ask", ar: "سؤال دائمًا", en: "Always ask" },
                    { val: "auto", ar: "طباعة تلقائية", en: "Auto print" },
                    { val: "off", ar: "بدون طباعة", en: "No printing" },
                  ] as const
                ).map((opt) => (
                  <button
                    key={opt.val}
                    type="button"
                    disabled={!canEdit}
                    onClick={() => setPrintMode(opt.val)}
                    className={`h-9 rounded-xl border text-xs font-semibold transition-all ${
                      printMode === opt.val
                        ? "border-primary bg-primary/10 text-primary ring-1 ring-primary/30"
                        : "border-border/80 text-muted-foreground hover:bg-surface-2 hover:text-foreground disabled:opacity-50"
                    }`}
                  >
                    {isAr ? opt.ar : opt.en}
                  </button>
                ))}
              </div>
            </div>

            {/* Default Invoice Template */}
            {printMode !== "off" && (
              <div className="grid gap-1.5">
                <label className="text-xs text-muted-foreground font-medium">
                  {isAr ? "القالب الافتراضي السريع" : "Quick Default Template"}
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {(
                    [
                      { val: "thermal", ar: "حراري 80mm", en: "Thermal 80mm" },
                      { val: "standard", ar: "A4 عادي", en: "Standard A4" },
                      { val: "elegant", ar: "A4 فاخر", en: "Elegant A4" },
                    ] as const
                  ).map((tmpl) => (
                    <button
                      key={tmpl.val}
                      type="button"
                      disabled={!canEdit}
                      onClick={() => setDefaultPrintTemplate(tmpl.val)}
                      className={`h-9 rounded-xl border text-xs font-semibold transition-all ${
                        defaultPrintTemplate === tmpl.val
                          ? "border-primary bg-primary/10 text-primary ring-1 ring-primary/30"
                          : "border-border/80 text-muted-foreground hover:bg-surface-2 hover:text-foreground disabled:opacity-50"
                      }`}
                    >
                      {isAr ? tmpl.ar : tmpl.en}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

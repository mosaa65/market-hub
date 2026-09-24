import { SubscriptionSettingsCard } from "@/components/subscription-settings-card";
import { StatementSettingsCard } from "@/components/statements/statement-settings-card";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/page-header";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/lib/auth";
import { useCatalogModules } from "@/lib/catalog-modules";
import { CatalogModulesDialog } from "@/components/catalog-modules-dialog";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { Save, Building2, Receipt, Languages, SlidersHorizontal, Printer } from "lucide-react";
import { setCompanySettingsCache } from "@/lib/format";
import type { InvoiceTemplate } from "@/lib/invoice-print";

export const Route = createFileRoute("/_app/settings")({
  head: () => ({ meta: [{ title: "الإعدادات — فورتيكس ERP" }] }),
  component: SettingsPage,
});

function SettingsPage() {
  const { t, lang, setLang } = useI18n();
  const { hasRole } = useAuth();
  const { config } = useCatalogModules();
  const [catalogDialogOpen, setCatalogDialogOpen] = useState(false);
  const canEdit = hasRole("owner") || hasRole("manager");
  const [form, setForm] = useState<any>({
    name: "",
    legal_name: "",
    tax_number: "",
    currency: "USD",
    currency_symbol: "$",
    tax_rate: 0,
    address: "",
    phone: "",
    email: "",
    invoice_prefix: "INV",
    barcode_enabled: true,
  });
  const [exists, setExists] = useState(false);
  const [saving, setSaving] = useState(false);

  const [enablePosServiceFee, setEnablePosServiceFee] = useState<boolean>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("pos_enable_service_fee");
      return saved !== null ? saved === "true" : true;
    }
    return true;
  });

  const [printMode, setPrintMode] = useState<"auto" | "ask" | "off">(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("pos_print_mode");
      if (saved === "auto" || saved === "ask" || saved === "off") return saved;
    }
    return "ask";
  });

  const [defaultPrintTemplate, setDefaultPrintTemplate] = useState<InvoiceTemplate>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("pos_default_template");
      if (saved === "thermal" || saved === "standard" || saved === "elegant") return saved;
    }
    return "thermal";
  });

  useEffect(() => {
    supabase
      .from("company_settings")
      .select("*")
      .order("id")
      .limit(1)
      .maybeSingle()
      .then(({ data }) => {
        if (data) {
          setForm(data);
          setExists(true);
          if ((data as any).enable_pos_service_fee !== undefined) {
            setEnablePosServiceFee(Boolean((data as any).enable_pos_service_fee));
          }
          setCompanySettingsCache({
            currency: data.currency,
            currency_symbol: data.currency_symbol,
          });
        }
      });
  }, []);

  async function save() {
    setSaving(true);
    if (typeof window !== "undefined") {
      localStorage.setItem("pos_enable_service_fee", String(enablePosServiceFee));
      localStorage.setItem("pos_print_mode", printMode);
      localStorage.setItem("pos_default_template", defaultPrintTemplate);
    }
    const payload = { ...form, id: form.id ?? 1, tax_rate: Number(form.tax_rate) };
    const res = exists
      ? await supabase.from("company_settings").update(payload).eq("id", payload.id)
      : await supabase.from("company_settings").insert(payload);
    setSaving(false);
    if (res.error) return toast.error(res.error.message);
    setCompanySettingsCache({
      currency: payload.currency,
      currency_symbol: payload.currency_symbol,
    });
    toast.success(
      lang === "ar" ? "تم حفظ الإعدادات بنجاح" : t("common.saved") || t("common.success"),
    );
    setExists(true);
  }

  const profileLabel =
    config.profile === "spare_parts"
      ? lang === "ar"
        ? "قطع غيار ودراجات ومركبات"
        : "Spare Parts & Automotive"
      : config.profile === "grocery"
        ? lang === "ar"
          ? "مواد غذائية وبقالة وسوبرماركت"
          : "Grocery & Food Market"
        : config.profile === "retail"
          ? lang === "ar"
            ? "تجارة عامة وملابس وتجزئة"
            : "General Retail"
          : lang === "ar"
            ? "تخصيص يدوي مخصص"
            : "Custom Configuration";

  return (
    <>
      <PageHeader
        title={t("settings.title")}
        subtitle={
          lang === "ar"
            ? "بيانات الشركة، العملة، الضريبة، إعدادات سلة البيع، وتخصيص نشاط الفهرسة"
            : "Company profile, currency, tax, POS cart settings, and catalog customization"
        }
        actions={
          canEdit && (
            <Button onClick={save} disabled={saving} className="rounded-full gap-1.5 px-5">
              <Save className="h-4 w-4 me-1" />
              {t("common.save")}
            </Button>
          )
        }
      />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <SubscriptionSettingsCard />
        {/* Statement Customization — Phase 9 of the statements plan */}
        <StatementSettingsCard canEdit={canEdit} />
        {/* Industry & Catalog Modules Card */}
        <Card className="lg:col-span-2 border-primary/30 bg-gradient-to-r from-primary/5 via-surface to-surface">
          <CardHeader>
            <CardTitle className="text-base flex items-center justify-between">
              <span className="flex items-center gap-2">
                <SlidersHorizontal className="h-4 w-4 text-primary" />
                {lang === "ar"
                  ? "تخصيص النشاط وموديولات الفهرسة"
                  : "Industry Profile & Catalog Modules"}
              </span>
              <span className="rounded-full bg-primary/15 text-primary border border-primary/30 px-3 py-0.5 text-xs font-bold">
                {profileLabel}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3 p-3.5 rounded-2xl border border-border/80 bg-surface/80">
              <div>
                <div className="text-sm font-semibold text-foreground">
                  {lang === "ar"
                    ? "تحديد الميزات المفعلة في الفهرس والمنتجات والـ POS"
                    : "Configure active catalog modules"}
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {lang === "ar"
                    ? "يمكنك بنقرة واحدة اختيار نشاطك (بقالة ومواد غذائية، قطع غيار ومركبات، تجارة عامة) لتفعيل أو إخفاء توافق القطع، درجات الجودة، وبلدان المنشأ."
                    : "Toggle vehicle fitment, quality grades, origins, brands, and units for your industry."}
                </div>
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={() => setCatalogDialogOpen(true)}
                className="rounded-full border-primary/40 text-primary hover:bg-primary/10"
              >
                <SlidersHorizontal className="h-3.5 w-3.5 me-1.5" />
                {lang === "ar" ? "تخصيص الموديولات والنشاط" : "Customize Modules"}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* 1. Company Info */}
        <Card className="rounded-3xl border-border/80">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Building2 className="h-4 w-4 text-primary" />
              {lang === "ar" ? "معلومات المنشأة والمتجر" : "Company & Store Info"}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Field
              label={lang === "ar" ? "الاسم التجاري للمتجر" : "Trade name"}
              v={form.name}
              on={(v) => setForm({ ...form, name: v })}
              disabled={!canEdit}
            />
            <Field
              label={lang === "ar" ? "الاسم القانوني / السجل التجاري" : "Legal name"}
              v={form.legal_name ?? ""}
              on={(v) => setForm({ ...form, legal_name: v })}
              disabled={!canEdit}
            />
            <Field
              label={lang === "ar" ? "الرقم الضريبي" : "Tax number"}
              v={form.tax_number ?? ""}
              on={(v) => setForm({ ...form, tax_number: v })}
              disabled={!canEdit}
            />
            <div className="grid grid-cols-2 gap-3">
              <Field
                label={lang === "ar" ? "الهاتف" : "Phone"}
                v={form.phone ?? ""}
                on={(v) => setForm({ ...form, phone: v })}
                disabled={!canEdit}
              />
              <Field
                label={lang === "ar" ? "البريد الإلكتروني" : "Email"}
                v={form.email ?? ""}
                on={(v) => setForm({ ...form, email: v })}
                disabled={!canEdit}
              />
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs">{lang === "ar" ? "العنوان والموقع" : "Address"}</Label>
              <Textarea
                rows={2}
                value={form.address ?? ""}
                onChange={(e) => setForm({ ...form, address: e.target.value })}
                disabled={!canEdit}
                className="rounded-2xl"
              />
            </div>
          </CardContent>
        </Card>

        {/* 2. Invoicing, POS & Cart Settings */}
        <Card className="rounded-3xl border-border/80">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Receipt className="h-4 w-4 text-primary" />
              {lang === "ar"
                ? "إعدادات الفواتير والسلة ونقطة البيع (POS)"
                : "Invoicing & POS Cart Settings"}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Field
                label={lang === "ar" ? "العملة" : "Currency"}
                v={form.currency}
                on={(v) => setForm({ ...form, currency: v })}
                disabled={!canEdit}
              />
              <Field
                label={lang === "ar" ? "رمز العملة" : "Symbol"}
                v={form.currency_symbol ?? ""}
                on={(v) => setForm({ ...form, currency_symbol: v })}
                disabled={!canEdit}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field
                label={lang === "ar" ? "نسبة الضريبة %" : "Tax rate %"}
                v={String(form.tax_rate ?? 0)}
                on={(v) => setForm({ ...form, tax_rate: v })}
                type="number"
                disabled={!canEdit}
              />
              <Field
                label={lang === "ar" ? "بادئة الفاتورة" : "Invoice prefix"}
                v={form.invoice_prefix ?? "INV"}
                on={(v) => setForm({ ...form, invoice_prefix: v })}
                disabled={!canEdit}
              />
            </div>

            {/* Custom Labor / Service Fee Toggle */}
            <div className="flex items-center justify-between p-3.5 rounded-2xl border border-border/80 bg-surface/70">
              <div className="space-y-0.5 pe-3">
                <div className="text-sm font-semibold text-foreground">
                  {lang === "ar"
                    ? "خدمة أو أجرة تركيب بسعر متفق عليه"
                    : "Custom Service / Installation Fee"}
                </div>
                <div className="text-xs text-muted-foreground">
                  {lang === "ar"
                    ? "إظهار زر مخصص في سلة البيع POS لإضافة بند خدمة سريعة أو أجور عمالة/تركيب دون الحاجة لتعريف منتج مسبق."
                    : "Enable quick custom service or labor fee entry in POS cart without catalog lookup."}
                </div>
              </div>
              <Switch
                checked={enablePosServiceFee}
                onCheckedChange={setEnablePosServiceFee}
                disabled={!canEdit}
              />
            </div>

            {/* Barcode Mode Toggle */}
            <div className="flex items-center justify-between p-3.5 rounded-2xl border border-border/80 bg-surface/70">
              <div className="space-y-0.5 pe-3">
                <div className="text-sm font-semibold text-foreground">
                  {lang === "ar" ? "تفعيل الباركود في POS" : "Barcode mode"}
                </div>
                <div className="text-xs text-muted-foreground">
                  {lang === "ar"
                    ? "السماح بمسح وقراءة الباركود بالكاميرا أو القارئ اليدوي"
                    : "Allow barcode scanning at POS"}
                </div>
              </div>
              <Switch
                checked={!!form.barcode_enabled}
                onCheckedChange={(v) => setForm({ ...form, barcode_enabled: v })}
                disabled={!canEdit}
              />
            </div>

            <Field
              label={lang === "ar" ? "رابط الشعار المطبوع" : "Logo URL"}
              v={form.logo_url ?? ""}
              on={(v) => setForm({ ...form, logo_url: v })}
              disabled={!canEdit}
            />

            {/* Print Settings Section */}
            <div className="pt-1 border-t border-border/60">
              <div className="flex items-center gap-2 mb-3">
                <Printer className="h-3.5 w-3.5 text-primary" />
                <span className="text-xs font-bold text-foreground uppercase tracking-wider">
                  {lang === "ar" ? "إعدادات الطباعة" : "Print Settings"}
                </span>
              </div>

              {/* Print Mode */}
              <div className="grid gap-1.5 mb-3">
                <label className="text-xs text-muted-foreground font-medium">
                  {lang === "ar" ? "وضع الطباعة بعد البيع" : "Print mode after sale"}
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
                      {lang === "ar" ? opt.ar : opt.en}
                    </button>
                  ))}
                </div>
                <p className="text-[11px] text-muted-foreground">
                  {lang === "ar"
                    ? printMode === "ask"
                      ? "سيظهر dialog بعد كل عملية بيع لاختيار الطباعة أو التخطي"
                      : printMode === "auto"
                        ? "ستطبع الفاتورة تلقائيًا بالقالب الافتراضي فور إتمام البيع"
                        : "لن تُطبع أي فاتورة — بيع مباشر بدون طباعة"
                    : printMode === "ask"
                      ? "A dialog appears after each sale to choose print or skip"
                      : printMode === "auto"
                        ? "Invoice prints automatically using default template"
                        : "No invoice printed — direct sale without printing"}
                </p>
              </div>

              {/* Default Template (shown unless off) */}
              {printMode !== "off" && (
                <div className="grid gap-1.5">
                  <label className="text-xs text-muted-foreground font-medium">
                    {lang === "ar" ? "قالب الفاتورة الافتراضي" : "Default invoice template"}
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
                        {lang === "ar" ? tmpl.ar : tmpl.en}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Appearance & Language */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Languages className="h-4 w-4" />
              {lang === "ar" ? "المظهر واللغة" : "Appearance & Language"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between rounded-md border border-border p-3">
              <div>
                <div className="text-sm font-medium">{lang === "ar" ? "اللغة" : "Language"}</div>
                <div className="text-xs text-muted-foreground">
                  {lang === "ar"
                    ? "اختر لغة الواجهة، يتم حفظ اختيارك تلقائياً"
                    : "Choose the interface language, your choice is saved automatically"}
                </div>
              </div>
              <div className="inline-flex rounded-full border border-border bg-surface p-0.5">
                <button
                  type="button"
                  onClick={() => setLang("en")}
                  className={`h-8 rounded-full px-4 text-xs font-medium transition-colors ${
                    lang === "en"
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  English
                </button>
                <button
                  type="button"
                  onClick={() => setLang("ar")}
                  className={`h-8 rounded-full px-4 text-xs font-medium transition-colors ${
                    lang === "ar"
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  العربية
                </button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <CatalogModulesDialog open={catalogDialogOpen} onClose={() => setCatalogDialogOpen(false)} />
    </>
  );
}

function Field({
  label,
  v,
  on,
  type = "text",
  disabled,
}: {
  label: string;
  v: string;
  on: (v: string) => void;
  type?: string;
  disabled?: boolean;
}) {
  return (
    <div className="grid gap-1.5">
      <Label className="text-xs">{label}</Label>
      <Input type={type} value={v} onChange={(e) => on(e.target.value)} disabled={disabled} />
    </div>
  );
}

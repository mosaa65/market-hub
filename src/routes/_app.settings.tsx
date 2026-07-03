import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/page-header";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { Save, Building2, Receipt, Languages } from "lucide-react";

export const Route = createFileRoute("/_app/settings")({
  head: () => ({ meta: [{ title: "Settings — Vortex ERP" }] }),
  component: SettingsPage,
});

function SettingsPage() {
  const { t, lang, setLang } = useI18n();
  const { hasRole } = useAuth();
  const canEdit = hasRole("owner") || hasRole("manager");
  const [form, setForm] = useState<any>({
    name: "", legal_name: "", tax_number: "", currency: "USD", currency_symbol: "$",
    tax_rate: 0, address: "", phone: "", email: "", invoice_prefix: "INV", barcode_enabled: true,
  });
  const [exists, setExists] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    supabase.from("company_settings").select("*").order("id").limit(1).maybeSingle().then(({ data }) => {
      if (data) { setForm(data); setExists(true); }
    });
  }, []);

  async function save() {
    setSaving(true);
    const payload = { ...form, id: form.id ?? 1, tax_rate: Number(form.tax_rate) };
    const res = exists
      ? await supabase.from("company_settings").update(payload).eq("id", payload.id)
      : await supabase.from("company_settings").insert(payload);
    setSaving(false);
    if (res.error) return toast.error(res.error.message);
    toast.success(lang === "ar" ? "تم الحفظ" : "Saved");
    setExists(true);
  }

  return (
    <>
      <PageHeader
        title={t("settings.title")}
        subtitle={lang === "ar" ? "بيانات الشركة، العملة، الضريبة، والفواتير" : "Company profile, currency, tax & invoicing"}
        actions={canEdit && <Button onClick={save} disabled={saving}><Save className="h-4 w-4 me-1" />{t("common.save")}</Button>}
      />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader><CardTitle className="text-base flex items-center gap-2"><Building2 className="h-4 w-4" />{lang === "ar" ? "الشركة" : "Company"}</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <Field label={lang === "ar" ? "الاسم التجاري" : "Trade name"} v={form.name} on={(v) => setForm({ ...form, name: v })} disabled={!canEdit} />
            <Field label={lang === "ar" ? "الاسم القانوني" : "Legal name"} v={form.legal_name ?? ""} on={(v) => setForm({ ...form, legal_name: v })} disabled={!canEdit} />
            <Field label={lang === "ar" ? "الرقم الضريبي" : "Tax number"} v={form.tax_number ?? ""} on={(v) => setForm({ ...form, tax_number: v })} disabled={!canEdit} />
            <div className="grid grid-cols-2 gap-3">
              <Field label={lang === "ar" ? "الهاتف" : "Phone"} v={form.phone ?? ""} on={(v) => setForm({ ...form, phone: v })} disabled={!canEdit} />
              <Field label={lang === "ar" ? "البريد" : "Email"} v={form.email ?? ""} on={(v) => setForm({ ...form, email: v })} disabled={!canEdit} />
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs">{lang === "ar" ? "العنوان" : "Address"}</Label>
              <Textarea rows={2} value={form.address ?? ""} onChange={(e) => setForm({ ...form, address: e.target.value })} disabled={!canEdit} />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base flex items-center gap-2"><Receipt className="h-4 w-4" />{lang === "ar" ? "الفواتير والضريبة" : "Invoicing & tax"}</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label={lang === "ar" ? "العملة" : "Currency"} v={form.currency} on={(v) => setForm({ ...form, currency: v })} disabled={!canEdit} />
              <Field label={lang === "ar" ? "رمز العملة" : "Symbol"} v={form.currency_symbol ?? ""} on={(v) => setForm({ ...form, currency_symbol: v })} disabled={!canEdit} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label={lang === "ar" ? "نسبة الضريبة %" : "Tax rate %"} v={String(form.tax_rate ?? 0)} on={(v) => setForm({ ...form, tax_rate: v })} type="number" disabled={!canEdit} />
              <Field label={lang === "ar" ? "بادئة الفاتورة" : "Invoice prefix"} v={form.invoice_prefix ?? "INV"} on={(v) => setForm({ ...form, invoice_prefix: v })} disabled={!canEdit} />
            </div>
            <div className="flex items-center justify-between p-3 rounded-md border border-border">
              <div>
                <div className="text-sm font-medium">{lang === "ar" ? "تفعيل الباركود" : "Barcode mode"}</div>
                <div className="text-xs text-muted-foreground">{lang === "ar" ? "قراءة الباركود من POS" : "Allow barcode scanning at POS"}</div>
              </div>
              <Switch checked={!!form.barcode_enabled} onCheckedChange={(v) => setForm({ ...form, barcode_enabled: v })} disabled={!canEdit} />
            </div>
            <Field label={lang === "ar" ? "رابط الشعار" : "Logo URL"} v={form.logo_url ?? ""} on={(v) => setForm({ ...form, logo_url: v })} disabled={!canEdit} />
          </CardContent>
        </Card>
      </div>
    </>
  );
}

function Field({ label, v, on, type = "text", disabled }: { label: string; v: string; on: (v: string) => void; type?: string; disabled?: boolean }) {
  return (
    <div className="grid gap-1.5">
      <Label className="text-xs">{label}</Label>
      <Input type={type} value={v} onChange={(e) => on(e.target.value)} disabled={disabled} />
    </div>
  );
}

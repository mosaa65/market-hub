import { useRef, useState, type Dispatch, type SetStateAction } from "react";
import { Building2, LoaderCircle, Trash2, Upload } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface CompanySectionProps {
  form: Record<string, unknown>;
  setForm: Dispatch<SetStateAction<Record<string, unknown>>>;
  canEdit: boolean;
  lang: string;
}

export function CompanySection({ form, setForm, canEdit, lang }: CompanySectionProps) {
  const isAr = lang === "ar";
  const logoInputRef = useRef<HTMLInputElement>(null);
  const [isUploadingLogo, setIsUploadingLogo] = useState(false);
  const fieldValue = (key: string) => String(form[key] ?? "");
  const logoUrl = fieldValue("logo_url") || "/vortex-erp-wordmark.png";

  const uploadLogo = async (file?: File) => {
    if (!file) return;
    const accepted = ["image/png", "image/jpeg", "image/webp"];
    if (!accepted.includes(file.type)) {
      toast.error(isAr ? "اختر صورة PNG أو JPG أو WebP." : "Choose a PNG, JPG, or WebP image.");
      return;
    }
    if (file.size > 3 * 1024 * 1024) {
      toast.error(isAr ? "يجب ألا يتجاوز حجم الشعار 3 ميجابايت." : "Logo must be 3 MB or smaller.");
      return;
    }

    setIsUploadingLogo(true);
    const extension =
      file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
    const path = `company/logo-${Date.now()}.${extension}`;
    try {
      const { error } = await supabase.storage.from("company-logos").upload(path, file, {
        contentType: file.type,
        cacheControl: "31536000",
        upsert: false,
      });
      if (error) throw error;
      const { data } = supabase.storage.from("company-logos").getPublicUrl(path);
      setForm((current) => ({ ...current, logo_url: data.publicUrl }));
      toast.success(
        isAr
          ? "تم رفع الشعار. احفظ الملف لتطبيقه."
          : "Logo uploaded. Save the profile to apply it.",
      );
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : isAr
            ? "تعذر رفع الشعار. حاول مرة أخرى."
            : "Could not upload the logo. Try again.",
      );
    } finally {
      setIsUploadingLogo(false);
      if (logoInputRef.current) logoInputRef.current.value = "";
    }
  };

  return (
    <Card className="rounded-3xl border-border/80 shadow-xs">
      <CardHeader className="border-b border-border/50 pb-4">
        <CardTitle className="text-base font-bold flex items-center gap-2">
          <div className="p-2 rounded-xl bg-primary/10 text-primary">
            <Building2 className="h-5 w-5" />
          </div>
          <div>
            <div>{isAr ? "معلومات المنشأة والمتجر" : "Company & Store Profile"}</div>
            <div className="text-xs text-muted-foreground font-normal mt-0.5">
              {isAr
                ? "البيانات الأساسية التي تظهر في ترويسة الفواتير والتقارير والمعاملات الرسمية"
                : "Official company profile shown on invoice headers and reports"}
            </div>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5 pt-5">
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_250px]">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="company-name-ar" className="text-xs font-semibold">
                {isAr ? "اسم المنشأة بالعربية" : "Company name in Arabic"}
              </Label>
              <Input
                id="company-name-ar"
                dir="rtl"
                value={fieldValue("name_ar")}
                onChange={(e) => setForm((current) => ({ ...current, name_ar: e.target.value }))}
                disabled={!canEdit}
                placeholder={isAr ? "الاسم العربي المعتمد" : "Official Arabic name"}
                className="rounded-xl"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="company-name-en" className="text-xs font-semibold">
                {isAr ? "اسم المنشأة بالإنجليزية" : "Company name in English"}
              </Label>
              <Input
                id="company-name-en"
                dir="ltr"
                value={fieldValue("name_en")}
                onChange={(e) => setForm((current) => ({ ...current, name_en: e.target.value }))}
                disabled={!canEdit}
                placeholder="Official English name"
                className="rounded-xl"
              />
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs font-semibold">
                {isAr ? "الاسم التجاري للمتجر / المنشأة" : "Trade name"}
              </Label>
              <Input
                value={fieldValue("name")}
                onChange={(e) => setForm((current) => ({ ...current, name: e.target.value }))}
                disabled={!canEdit}
                placeholder={isAr ? "اسم المتجر أو المؤسسة" : "Store or Trade Name"}
                className="rounded-2xl"
              />
              <span className="text-[11px] text-muted-foreground">
                {isAr ? "الاسم التجاري الرئيسي الشائع المطبوع" : "Main display trade name"}
              </span>
            </div>

            <div className="grid gap-1.5">
              <Label className="text-xs font-semibold">
                {isAr ? "الاسم القانوني / السجل التجاري" : "Legal name"}
              </Label>
              <Input
                value={fieldValue("legal_name")}
                onChange={(e) => setForm((current) => ({ ...current, legal_name: e.target.value }))}
                disabled={!canEdit}
                placeholder={isAr ? "الاسم الرسمي حسب السجل" : "Official Legal Entity Name"}
                className="rounded-2xl"
              />
              <span className="text-[11px] text-muted-foreground">
                {isAr ? "الاسم المعتمد في السجلات التجارية" : "Official company register name"}
              </span>
            </div>
          </div>

          <div className="space-y-3 rounded-xl border border-border/70 bg-muted/20 p-3">
            <Label className="text-xs font-semibold">
              {isAr ? "شعار المنشأة في المستندات" : "Company logo on documents"}
            </Label>
            <div className="grid min-h-28 place-items-center rounded-lg border border-dashed border-border bg-background p-3">
              <img
                src={logoUrl}
                alt={isAr ? "معاينة شعار المنشأة" : "Company logo preview"}
                className="max-h-20 max-w-full object-contain"
                onError={(event) => {
                  event.currentTarget.src = "/vortex-erp-wordmark.png";
                }}
              />
            </div>
            <input
              ref={logoInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="sr-only"
              disabled={!canEdit || isUploadingLogo}
              onChange={(event) => void uploadLogo(event.target.files?.[0])}
            />
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="min-h-10 flex-1 rounded-lg"
                disabled={!canEdit || isUploadingLogo}
                onClick={() => logoInputRef.current?.click()}
              >
                {isUploadingLogo ? (
                  <LoaderCircle className="size-4 animate-spin" />
                ) : (
                  <Upload className="size-4" />
                )}
                {isAr ? "رفع شعار" : "Upload logo"}
              </Button>
              {Boolean(form.logo_url) && (
                <Button
                  type="button"
                  size="icon"
                  variant="outline"
                  aria-label={isAr ? "إزالة الشعار" : "Remove logo"}
                  className="size-10 rounded-lg text-muted-foreground hover:text-destructive"
                  disabled={!canEdit || isUploadingLogo}
                  onClick={() => setForm((current) => ({ ...current, logo_url: null }))}
                >
                  <Trash2 className="size-4" />
                </Button>
              )}
            </div>
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              {isAr
                ? "يظهر الشعار في وسط ترويسة مستندات A4 وA5. PNG أو JPG أو WebP، حتى 3 ميجابايت."
                : "Shown in the center of A4/A5 document headers. PNG, JPG, or WebP, up to 3 MB."}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="grid gap-1.5">
            <Label className="text-xs font-semibold">
              {isAr ? "الرقم الضريبي / Tax ID" : "Tax registration number"}
            </Label>
            <Input
              value={fieldValue("tax_number")}
              onChange={(e) => setForm((current) => ({ ...current, tax_number: e.target.value }))}
              disabled={!canEdit}
              placeholder="300000000000003"
              className="rounded-2xl font-mono"
            />
          </div>

          <div className="grid gap-1.5">
            <Label className="text-xs font-semibold">
              {isAr ? "هاتف المنشأة / للتواصل" : "Company phone number"}
            </Label>
            <Input
              value={fieldValue("phone")}
              onChange={(e) => setForm((current) => ({ ...current, phone: e.target.value }))}
              disabled={!canEdit}
              placeholder="+966 50 000 0000"
              className="rounded-2xl font-mono"
            />
          </div>

          <div className="grid gap-1.5">
            <Label className="text-xs font-semibold">
              {isAr ? "البريد الإلكتروني" : "Email address"}
            </Label>
            <Input
              type="email"
              value={fieldValue("email")}
              onChange={(e) => setForm((current) => ({ ...current, email: e.target.value }))}
              disabled={!canEdit}
              placeholder="info@company.com"
              className="rounded-2xl font-mono"
            />
          </div>
        </div>

        <div className="grid gap-1.5">
          <Label className="text-xs font-semibold">
            {isAr ? "العنوان الجغرافي والموقع" : "Address & Location"}
          </Label>
          <Textarea
            rows={3}
            value={fieldValue("address")}
            onChange={(e) => setForm((current) => ({ ...current, address: e.target.value }))}
            disabled={!canEdit}
            placeholder={
              isAr
                ? "المدينة، الشارع، المبنى، الرمز البريدي"
                : "City, Street, Building, Postal Code"
            }
            className="rounded-2xl resize-none"
          />
        </div>
      </CardContent>
    </Card>
  );
}

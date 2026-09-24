import { Building2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

interface CompanySectionProps {
  form: any;
  setForm: (form: any) => void;
  canEdit: boolean;
  lang: string;
}

export function CompanySection({ form, setForm, canEdit, lang }: CompanySectionProps) {
  const isAr = lang === "ar";

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
      <CardContent className="space-y-4 pt-5">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="grid gap-1.5">
            <Label className="text-xs font-semibold">
              {isAr ? "الاسم التجاري للمتجر / المنشأة" : "Trade name"}
            </Label>
            <Input
              value={form.name ?? ""}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
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
              value={form.legal_name ?? ""}
              onChange={(e) => setForm({ ...form, legal_name: e.target.value })}
              disabled={!canEdit}
              placeholder={isAr ? "الاسم الرسمي حسب السجل" : "Official Legal Entity Name"}
              className="rounded-2xl"
            />
            <span className="text-[11px] text-muted-foreground">
              {isAr ? "الاسم المعتمد في السجلات التجارية" : "Official company register name"}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="grid gap-1.5">
            <Label className="text-xs font-semibold">
              {isAr ? "الرقم الضريبي / Tax ID" : "Tax registration number"}
            </Label>
            <Input
              value={form.tax_number ?? ""}
              onChange={(e) => setForm({ ...form, tax_number: e.target.value })}
              disabled={!canEdit}
              placeholder="300000000000003"
              className="rounded-2xl font-mono"
            />
          </div>

          <div className="grid gap-1.5">
            <Label className="text-xs font-semibold">
              {isAr ? "رقم الهاتف / للتواصل" : "Phone number"}
            </Label>
            <Input
              value={form.phone ?? ""}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
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
              value={form.email ?? ""}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
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
            value={form.address ?? ""}
            onChange={(e) => setForm({ ...form, address: e.target.value })}
            disabled={!canEdit}
            placeholder={isAr ? "المدينة، الشارع، المبنى، الرمز البريدي" : "City, Street, Building, Postal Code"}
            className="rounded-2xl resize-none"
          />
        </div>
      </CardContent>
    </Card>
  );
}

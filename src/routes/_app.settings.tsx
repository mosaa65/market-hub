import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AlertCircle, Check, LoaderCircle } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/lib/auth";
import { SettingsLayout } from "@/components/settings/settings-layout";
import { supabase } from "@/integrations/supabase/client";
import { setCompanySettingsCache } from "@/lib/format";
import { cacheCompanyProfile, COMPANY_SUPPORT_CONTACT_LINE } from "@/lib/printing";

export const Route = createFileRoute("/_app/settings")({
  head: () => ({ meta: [{ title: "الإعدادات — فورتيكس ERP" }] }),
  component: SettingsPage,
});

function SettingsPage() {
  const { t, lang } = useI18n();
  const { hasRole } = useAuth();
  const canEdit = hasRole("owner") || hasRole("manager");
  const [form, setForm] = useState<any>({
    name: "",
    legal_name: "",
    tax_number: "",
    currency: "YER",
    currency_symbol: "ر.ي",
    tax_rate: 0,
    address: "",
    phone: "",
    email: "",
    invoice_prefix: "INV-",
    purchase_invoice_prefix: "PO-",
    invoice_number_period: "year_month",
    invoice_number_digits: 4,
    logo_url: null,
    barcode_enabled: true,
  });
  const [hasLoadedSettings, setHasLoadedSettings] = useState(false);
  const [saveState, setSaveState] = useState<"saved" | "saving" | "error">("saved");

  const [enablePosServiceFee, setEnablePosServiceFee] = useState<boolean>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("pos_enable_service_fee");
      return saved !== null ? saved === "true" : true;
    }
    return true;
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
          const catalog = ((data as any).catalog_modules as any) || {};
          if (catalog.enablePosServiceFee !== undefined) {
            setEnablePosServiceFee(Boolean(catalog.enablePosServiceFee));
          } else if ((data as any).enable_pos_service_fee !== undefined) {
            setEnablePosServiceFee(Boolean((data as any).enable_pos_service_fee));
          }
          setCompanySettingsCache({
            currency: data.currency,
          });
        }
        setHasLoadedSettings(true);
      });
  }, []);

  useEffect(() => {
    if (!hasLoadedSettings || !canEdit) return;

    const timer = window.setTimeout(async () => {
      setSaveState("saving");
      const currentCatalog = (form.catalog_modules as Record<string, any>) || {};
      const updatedCatalog = {
        ...currentCatalog,
        enablePosServiceFee,
      };
      const payload = {
        ...form,
        id: form.id ?? 1,
        tax_rate: Number(form.tax_rate),
        // أرقام المؤسسة المعتمدة ثابتة: تُفرض هنا على أي كتابة للفواتير
        // ولا يمكن تغييرها أو حذفها من الإعدادات.
        footer_contact: COMPANY_SUPPORT_CONTACT_LINE,
        catalog_modules: updatedCatalog,
      };
      try {
        if (typeof window !== "undefined") {
          localStorage.setItem("pos_enable_service_fee", String(enablePosServiceFee));
        }
        const res = form.id
          ? await supabase.from("company_settings").update(payload).eq("id", payload.id)
          : await supabase.from("company_settings").insert(payload);
        if (res.error) {
          setSaveState("error");
          return;
        }
        // Company Profile cache is updated through the central accessor only,
        // so every document (invoices, statements, reports, milling, thermal)
        // sees the new identity immediately.
        cacheCompanyProfile(payload as Record<string, unknown>);
        setCompanySettingsCache({
          currency: payload.currency,
        });
        setSaveState("saved");
      } catch {
        setSaveState("error");
      }
    }, 650);

    return () => window.clearTimeout(timer);
  }, [canEdit, enablePosServiceFee, form, hasLoadedSettings]);

  return (
    <div className="space-y-6 pb-10">
      <PageHeader
        title={t("settings.title")}
        subtitle={
          lang === "ar"
            ? "إدارة إعدادات النظام الموجودة: المنشأة، المبيعات، الطباعة، النشاط، الباقة، النسخ الاحتياطي، الأرقام، والمظهر"
            : "Manage company, sales, printing, catalog, plan, backup, numbers, and appearance settings"
        }
      />

      {canEdit && hasLoadedSettings && (
        <div
          className="fixed bottom-4 right-4 z-40 flex items-center gap-2 rounded-full border border-border/70 bg-card/95 px-3 py-2 text-[11px] font-medium text-muted-foreground shadow-lg backdrop-blur-md"
          role="status"
          aria-live="polite"
        >
          {saveState === "saving" ? (
            <LoaderCircle className="size-3.5 animate-spin text-amber-500" />
          ) : saveState === "error" ? (
            <AlertCircle className="size-3.5 text-destructive" />
          ) : (
            <Check className="size-3.5 text-emerald-500" />
          )}
          {saveState !== "saved" && (
            <span>
              {saveState === "saving"
                ? lang === "ar"
                  ? "جارٍ الحفظ"
                  : "Saving"
                : lang === "ar"
                  ? "تعذّر الحفظ"
                  : "Save failed"}
            </span>
          )}
        </div>
      )}

      <SettingsLayout
        form={form}
        setForm={setForm}
        enablePosServiceFee={enablePosServiceFee}
        setEnablePosServiceFee={setEnablePosServiceFee}
        printMode={"ask" as any}
        setPrintMode={() => {}}
        defaultPrintTemplate={undefined}
        setDefaultPrintTemplate={() => {}}
        canEdit={canEdit}
        lang={lang}
      />
    </div>
  );
}

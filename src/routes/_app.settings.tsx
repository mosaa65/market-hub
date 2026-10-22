import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { AlertCircle, RotateCcw, Save } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { ActionButton } from "@/components/ui/action-button";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/lib/auth";
import { SettingsLayout } from "@/components/settings/settings-layout";
import { supabase } from "@/integrations/supabase/client";
import { setCompanySettingsCache } from "@/lib/format";
import { cacheCompanyProfile } from "@/lib/printing";

interface SettingsSnapshot {
  form: Record<string, unknown>;
  enablePosServiceFee: boolean;
}

function cloneSnapshot(value: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

export const Route = createFileRoute("/_app/settings")({
  head: () => ({ meta: [{ title: "الإعدادات — فورتيكس ERP" }] }),
  /*
   * `?section=` selects which settings screen opens.
   *
   * Without this the route accepted the parameter and silently ignored it, so
   * every settings link in the sidebar (/settings?section=printing, …) landed on
   * the settings hub and the operator had to find the section again by hand.
   * Validating it here means a bad or unknown value degrades to the hub rather
   * than rendering nothing.
   */
  validateSearch: (search: Record<string, unknown>) => ({
    section: typeof search.section === "string" && search.section ? search.section : undefined,
  }),
  component: SettingsPage,
});

function SettingsPage() {
  const { t, lang } = useI18n();
  const { section: sectionFromUrl } = Route.useSearch();
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
  const [saveState, setSaveState] = useState<"idle" | "saving" | "error">("idle");
  const [savedSnapshot, setSavedSnapshot] = useState<SettingsSnapshot | null>(null);

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
        let nextForm: Record<string, unknown> = form;
        let nextServiceFee = enablePosServiceFee;
        if (data) {
          nextForm = data as Record<string, unknown>;
          const catalog = ((data as any).catalog_modules as any) || {};
          if (catalog.enablePosServiceFee !== undefined) {
            nextServiceFee = Boolean(catalog.enablePosServiceFee);
          } else if ((data as any).enable_pos_service_fee !== undefined) {
            nextServiceFee = Boolean((data as any).enable_pos_service_fee);
          }
          setCompanySettingsCache({
            currency: data.currency,
          });
        }
        setForm(nextForm);
        setEnablePosServiceFee(nextServiceFee);
        setSavedSnapshot({
          form: cloneSnapshot(nextForm),
          enablePosServiceFee: nextServiceFee,
        });
        setHasLoadedSettings(true);
      });
  }, []);

  const isDirty = useMemo(() => {
    if (!savedSnapshot) return false;
    return (
      JSON.stringify(form) !== JSON.stringify(savedSnapshot.form) ||
      enablePosServiceFee !== savedSnapshot.enablePosServiceFee
    );
  }, [enablePosServiceFee, form, savedSnapshot]);

  useEffect(() => {
    if (!isDirty) return;
    const preventAccidentalExit = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", preventAccidentalExit);
    return () => window.removeEventListener("beforeunload", preventAccidentalExit);
  }, [isDirty]);

  const resetChanges = () => {
    if (!savedSnapshot || saveState === "saving") return;
    setForm(cloneSnapshot(savedSnapshot.form));
    setEnablePosServiceFee(savedSnapshot.enablePosServiceFee);
    setSaveState("idle");
  };

  const saveChanges = async () => {
    if (!hasLoadedSettings || !canEdit || !isDirty) return;

    const taxRate = Number(form.tax_rate);
    if (!Number.isFinite(taxRate) || taxRate < 0 || taxRate > 100) {
      setSaveState("error");
      return;
    }

    setSaveState("saving");
    const currentCatalog = (form.catalog_modules as Record<string, unknown>) || {};
    const payload = {
      ...form,
      id: form.id ?? 1,
      tax_rate: taxRate,
      catalog_modules: { ...currentCatalog, enablePosServiceFee },
    };

    try {
      const result = form.id
        ? await supabase
            .from("company_settings")
            .update(payload)
            .eq("id", payload.id)
            .select()
            .single()
        : await supabase.from("company_settings").insert(payload).select().single();
      if (result.error) {
        setSaveState("error");
        return;
      }

      const persisted = (result.data ?? payload) as Record<string, unknown>;
      if (typeof window !== "undefined") {
        localStorage.setItem("pos_enable_service_fee", String(enablePosServiceFee));
      }
      cacheCompanyProfile(persisted);
      setCompanySettingsCache({ currency: String(persisted.currency ?? "YER") });
      setForm(persisted);
      setSavedSnapshot({
        form: cloneSnapshot(persisted),
        enablePosServiceFee,
      });
      setSaveState("idle");
    } catch {
      setSaveState("error");
    }
  };

  return (
    <div className="space-y-6 pb-10">
      {canEdit && hasLoadedSettings && isDirty && (
        <div
          className="sticky top-2 z-30 flex w-fit max-w-full items-center justify-start gap-1.5 rounded-2xl border border-border/70 bg-card/95 p-1.5 shadow-lg backdrop-blur-md"
          role="status"
          aria-live="polite"
        >
          {saveState === "error" ? (
            <span className="flex max-w-48 items-center gap-1 px-1 text-[11px] font-medium text-destructive">
              <AlertCircle className="size-3.5 shrink-0" />
              {lang === "ar" ? "تعذر الحفظ" : "Could not save"}
            </span>
          ) : null}
          <ActionButton
            size="sm"
            tone="ghost"
            icon={<RotateCcw />}
            onClick={resetChanges}
            disabled={saveState === "saving"}
          >
            {lang === "ar" ? "تراجع" : "Discard"}
          </ActionButton>
          <ActionButton
            size="sm"
            icon={<Save />}
            onClick={saveChanges}
            loading={saveState === "saving"}
          >
            {lang === "ar" ? "حفظ" : "Save"}
          </ActionButton>
        </div>
      )}

      <PageHeader
        title={t("settings.title")}
        subtitle={
          lang === "ar"
            ? "إدارة إعدادات النظام الموجودة: المنشأة، المبيعات، الطباعة، النشاط، الباقة، النسخ الاحتياطي، الأرقام، والمظهر"
            : "Manage company, sales, printing, catalog, plan, backup, numbers, and appearance settings"
        }
      />

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
        initialSectionId={sectionFromUrl}
      />
    </div>
  );
}

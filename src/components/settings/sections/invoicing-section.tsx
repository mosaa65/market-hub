import React, { useState, useMemo, useEffect, type Dispatch, type SetStateAction } from "react";
import {
  ChevronDown,
  Check,
  CircleDollarSign,
  Hash,
  Receipt,
  ScanBarcode,
  Wrench,
  Printer,
  Building2,
  ExternalLink,
  Sparkles,
  FileText,
} from "lucide-react";
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "@/components/ui/command";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { QuantityInput } from "@/components/ui/quantity-input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { getCurrencyOptions, getCurrencySymbol, type CurrencyOption } from "@/lib/currencies";
import { FlagIcon, currencyToCountryCode } from "@/components/ui/flag-icon";
import { toast } from "sonner";
import type { InvoiceTemplate } from "@/lib/invoice-print";
import { getPrintSettings, savePrintSettings, type InvoiceTemplateId } from "@/lib/templates";
import { useCatalogModules } from "@/lib/catalog-modules";
import { DocumentNumberingCard } from "./document-numbering-card";

interface InvoicingSectionProps {
  form: any;
  setForm: Dispatch<SetStateAction<any>>;
  enablePosServiceFee: boolean;
  setEnablePosServiceFee: (v: boolean) => void;
  canEdit: boolean;
  lang: string;
}

export function InvoicingSection({
  form,
  setForm,
  enablePosServiceFee,
  setEnablePosServiceFee,
  canEdit,
  lang,
}: InvoicingSectionProps) {
  const isAr = lang === "ar";
  const [activePanel, setActivePanel] = useState<
    "currency" | "numbering" | "printing" | "services"
  >("currency");
  const [printMode, setPrintModeState] = useState<"auto" | "ask" | "off">("ask");
  const [defaultPrintTemplate, setDefaultPrintTemplateState] =
    useState<InvoiceTemplateId>("thermal");
  const { config: catalogConfig, updateConfig: updateCatalogConfig } = useCatalogModules();
  const currencyOptions = useMemo(() => getCurrencyOptions(lang), [lang]);
  const currencyPreviewSymbol =
    form.currency_symbol?.trim() ||
    getCurrencySymbol(form.currency || "YER", isAr ? "ar-YE" : "en");

  useEffect(() => {
    const s = getPrintSettings();
    setPrintModeState(s.printMode);
    setDefaultPrintTemplateState(s.defaultCustomerTemplate);
  }, []);

  const handleModeChange = (mode: "auto" | "ask" | "off") => {
    setPrintModeState(mode);
    savePrintSettings({ printMode: mode });
    toast.success(isAr ? "تم تحديث سلوك الطباعة" : "Print behavior updated");
  };

  const handleTemplateChange = (templateId: InvoiceTemplateId) => {
    setDefaultPrintTemplateState(templateId);
    savePrintSettings({ defaultCustomerTemplate: templateId });
    toast.success(isAr ? "تم تحديث القالب الافتراضي" : "Default template updated");
  };

  const panels = [
    {
      id: "currency" as const,
      icon: CircleDollarSign,
      title: isAr ? "العملة والضريبة" : "Currency & tax",
      description: isAr ? "حدد العملة ونسبة الضريبة" : "Set currency and tax rate",
    },
    {
      id: "numbering" as const,
      icon: Hash,
      title: isAr ? "ترقيم المستندات" : "Document numbering",
      description: isAr ? "نظم أرقام الفواتير والمستندات" : "Organize invoice and document numbers",
    },
    {
      id: "printing" as const,
      icon: Printer,
      title: isAr ? "الشعار وطباعة الفواتير" : "Logo & printing",
      description: isAr
        ? "شعار المستندات والنموذج الافتراضي"
        : "Document logo and default template",
    },
    {
      id: "services" as const,
      icon: ScanBarcode,
      title: isAr ? "الخدمات والباركود" : "Services & barcode",
      description: isAr
        ? "فعّل الخدمات السريعة وقارئ الباركود"
        : "Enable quick services and barcode scanning",
    },
  ];

  const logoUrl = form.logo_url || "/vortex-erp-wordmark.png";

  return (
    <Card className="rounded-3xl border-border/80 shadow-xs">
      <CardHeader className="border-b border-border/50 pb-4">
        <CardTitle className="text-base font-bold flex items-center gap-2">
          <div className="p-2 rounded-xl bg-primary/10 text-primary">
            <Receipt className="h-5 w-5" />
          </div>
          <div>
            <div>{isAr ? "إعدادات الفواتير" : "Invoice settings"}</div>
            <div className="text-xs text-muted-foreground font-normal mt-0.5">
              {isAr
                ? "رتّب إعدادات العملة والترقيم والشعار والخدمات من مكان واحد"
                : "Manage currency, numbering, logo, and service options in one place"}
            </div>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5 pt-5">
        <div
          role="tablist"
          aria-label={isAr ? "أقسام إعدادات الفواتير" : "Invoice settings sections"}
          className="flex w-fit max-w-full flex-wrap items-center gap-1.5 rounded-2xl border border-border/60 bg-surface-2 p-1"
        >
          {panels.map((panel) => {
            const Icon = panel.icon;
            const active = activePanel === panel.id;
            return (
              <button
                key={panel.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setActivePanel(panel.id)}
                className={`flex min-w-0 items-center gap-2 rounded-xl px-3 py-2 text-start text-xs font-bold transition-all sm:px-4 ${
                  active
                    ? "bg-primary text-primary-foreground shadow-xs"
                    : "text-muted-foreground hover:bg-surface hover:text-foreground"
                }`}
              >
                <Icon className="size-3.5 shrink-0" />
                <span className="truncate">{panel.title}</span>
              </button>
            );
          })}
        </div>

        <div role="tabpanel" className="min-w-0">
          {activePanel === "currency" && (
            <div className="space-y-3">
              <div className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
                {isAr ? "العملة والضريبة" : "Currency & tax"}
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <CurrencyPicker
                  options={currencyOptions}
                  selectedCode={form.currency ?? "YER"}
                  language={lang}
                  disabled={!canEdit}
                  onSelect={(code) =>
                    setForm((current: any) => ({
                      ...current,
                      currency: code,
                      currency_symbol: getCurrencySymbol(code, isAr ? "ar-YE" : "en"),
                    }))
                  }
                />
                <div className="grid gap-1.5">
                  <Label htmlFor="currency-symbol" className="text-xs font-semibold">
                    {isAr ? "رمز العرض" : "Display symbol"}
                  </Label>
                  <Input
                    id="currency-symbol"
                    value={form.currency_symbol ?? currencyPreviewSymbol}
                    onChange={(event) =>
                      setForm((current: any) => ({
                        ...current,
                        currency_symbol: event.target.value,
                      }))
                    }
                    disabled={!canEdit}
                    placeholder={currencyPreviewSymbol}
                    className="rounded-2xl"
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="tax-rate" className="text-xs font-semibold">
                    {isAr ? "نسبة الضريبة %" : "Tax rate %"}
                  </Label>
                  <QuantityInput
                    id="tax-rate"
                    decimals={2}
                    min={0}
                    max={100}
                    unit="%"
                    value={form.tax_rate === "" ? null : Number(form.tax_rate ?? 0)}
                    onValueChange={(v) =>
                      setForm((current: any) => ({
                        ...current,
                        tax_rate: v == null ? "" : String(v),
                      }))
                    }
                    disabled={!canEdit}
                    placeholder="0"
                  />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                {isAr
                  ? "العملة الافتراضية للمنشآت الجديدة هي الريال اليمني. تغييرها لا يحوّل المبالغ المسجلة سابقاً."
                  : "New companies default to Yemeni Rial. Changing currency does not convert existing amounts."}
              </p>
            </div>
          )}

          {/* Central Document Numbering Engine */}
          {activePanel === "numbering" && (
            <div className="space-y-3 rounded-2xl border border-border/80 bg-surface/50 p-4">
              <DocumentNumberingCard isAr={isAr} canEdit={canEdit} />
              <p className="text-xs text-muted-foreground">
                {isAr
                  ? "التسلسل الرقمي منفصل تماماً عن شكل الرقم المعروض: لكل نوع مستند تسلسل مستقل يُخصَّص داخل قاعدة البيانات (ذرّياً) لمنع تكرار الأرقام، ولا يُعاد ترقيم المستندات القديمة عند تغيير التنسيق."
                  : "The numeric sequence is fully separate from the displayed format: each document type has its own sequence allocated atomically inside the database to prevent duplicates, and changing the format never renumbers existing documents."}
              </p>
            </div>
          )}

          {/* Document Logo & Print Preview options */}
          {activePanel === "printing" && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Logo Preview and Link to Company Profile */}
                <div className="p-4 rounded-2xl border border-border/80 bg-surface/70 space-y-3">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs font-bold text-foreground flex items-center gap-2">
                      <Building2 className="h-4 w-4 text-primary" />
                      <span>{isAr ? "شعار المنشأة في الفواتير والمستندات" : "Document logo"}</span>
                    </Label>
                    <a
                      href="/settings?section=company"
                      className="inline-flex items-center gap-1 text-[11px] font-bold text-primary hover:underline"
                    >
                      <span>{isAr ? "إدارة ملف المنشأة" : "Manage company"}</span>
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </div>
                  <div className="grid min-h-24 place-items-center rounded-xl border border-dashed border-border bg-background/80 p-3">
                    <img
                      src={logoUrl}
                      alt={isAr ? "شعار المنشأة" : "Company logo"}
                      className="max-h-16 max-w-full object-contain"
                      onError={(event) => {
                        event.currentTarget.src = "/vortex-erp-wordmark.png";
                      }}
                    />
                  </div>
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    {isAr
                      ? "يظهر الشعار في ترويسة مستندات A4 وA5 وقوالب الفواتير المعتمدة. لتغيير أو رفع شعار جديد، توجّه إلى صفحة معلومات المنشأة."
                      : "The logo appears on A4/A5 headers and invoice templates. To upload or update the logo, visit the Company Profile section."}
                  </p>
                </div>

                {/* Print Preferences */}
                <div className="p-4 rounded-2xl border border-border/80 bg-surface/70 space-y-3">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs font-bold text-foreground flex items-center gap-2">
                      <Printer className="h-4 w-4 text-primary" />
                      <span>{isAr ? "سلوك وطريقة الطباعة السريعة" : "Quick print behavior"}</span>
                    </Label>
                    <a
                      href="/settings?section=printing"
                      className="inline-flex items-center gap-1 text-[11px] font-bold text-primary hover:underline"
                    >
                      <span>{isAr ? "كل خيارات الطباعة" : "Full printing settings"}</span>
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </div>

                  <div className="space-y-1.5">
                    <span className="text-[11px] font-medium text-muted-foreground block">
                      {isAr ? "سلوك الطباعة عند إنهاء المعاملة:" : "Print behavior on checkout:"}
                    </span>
                    <div className="grid grid-cols-3 gap-1 p-1 rounded-xl bg-surface-2 border border-border/60">
                      {[
                        { id: "auto", labelAr: "تلقائي", labelEn: "Auto" },
                        { id: "ask", labelAr: "سؤال", labelEn: "Ask" },
                        { id: "off", labelAr: "إيقاف", labelEn: "Off" },
                      ].map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          disabled={!canEdit}
                          onClick={() => handleModeChange(item.id as any)}
                          className={`py-1.5 px-2 rounded-lg text-xs font-bold transition-all text-center ${
                            printMode === item.id
                              ? "bg-primary text-primary-foreground shadow-xs"
                              : "text-muted-foreground hover:text-foreground"
                          }`}
                        >
                          {isAr ? item.labelAr : item.labelEn}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <span className="text-[11px] font-medium text-muted-foreground block">
                      {isAr ? "القالب الافتراضي لفواتير العملاء:" : "Default invoice template:"}
                    </span>
                    <div className="grid grid-cols-2 gap-1.5">
                      {[
                        { id: "thermal", label: isAr ? "🧾 إيصال حراري" : "Thermal receipt" },
                        { id: "milling-clean", label: isAr ? "⭐ فاتورة مبسطة" : "Clean invoice" },
                        { id: "standard", label: isAr ? "📄 قياسي مؤسسي" : "Standard corporate" },
                        { id: "elegant", label: isAr ? "✨ تنفيذي فاخر" : "Executive luxury" },
                      ].map((tpl) => (
                        <button
                          key={tpl.id}
                          type="button"
                          disabled={!canEdit}
                          onClick={() => handleTemplateChange(tpl.id as any)}
                          className={`p-2 rounded-xl text-xs font-bold text-start border transition-all ${
                            defaultPrintTemplate === tpl.id
                              ? "bg-primary/10 border-primary text-primary shadow-xs"
                              : "bg-background border-border/70 text-muted-foreground hover:text-foreground"
                          }`}
                        >
                          {tpl.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Feature Switches */}
          {activePanel === "services" && (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
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
                  checked={catalogConfig.enableBarcode}
                  onCheckedChange={(v) => {
                    updateCatalogConfig({ enableBarcode: v });
                    setForm({ ...form, barcode_enabled: v });
                  }}
                  disabled={!canEdit}
                />
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function CurrencyPicker({
  options,
  selectedCode,
  language,
  disabled,
  onSelect,
}: {
  options: CurrencyOption[];
  selectedCode: string;
  language: string;
  disabled: boolean;
  onSelect: (code: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const isAr = language === "ar";
  const selected = options.find((currency) => currency.code === selectedCode);

  return (
    <div className="grid gap-1.5">
      <Label>{isAr ? "العملة الأساسية" : "Base currency"}</Label>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            disabled={disabled}
            className="h-10 w-full justify-between rounded-2xl px-3 font-normal"
          >
            <span className="flex min-w-0 items-center gap-2">
              <span aria-hidden="true" className="text-lg leading-none">
                {selected ? (
                  <FlagIcon
                    code={currencyToCountryCode(selected.code) || ""}
                    emoji={selected.flag}
                    size="size-5"
                  />
                ) : (
                  "🌐"
                )}
              </span>
              <span className="truncate text-start">
                <span className="font-mono font-semibold">{selectedCode}</span>
                {selected?.name && (
                  <span className="ms-2 text-muted-foreground">{selected.name}</span>
                )}
              </span>
            </span>
            <ChevronDown className="ms-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[min(360px,calc(100vw-2rem))] p-0">
          <Command dir={isAr ? "rtl" : "ltr"}>
            <CommandInput
              placeholder={isAr ? "ابحث باسم العملة أو رمزها..." : "Search by currency or code..."}
            />
            <CommandList>
              <CommandEmpty>{isAr ? "لم يتم العثور على عملة." : "No currency found."}</CommandEmpty>
              <CommandGroup heading={isAr ? "العملات" : "Currencies"}>
                {options.map((currency) => (
                  <CommandItem
                    key={currency.code}
                    value={`${currency.code} ${currency.name} ${currency.symbol} ${currency.flag}`}
                    onSelect={() => {
                      onSelect(currency.code);
                      setOpen(false);
                    }}
                    className="gap-2"
                  >
                    <span aria-hidden="true" className="text-lg leading-none">
                      <FlagIcon
                        code={currencyToCountryCode(currency.code) || ""}
                        emoji={currency.flag}
                        size="size-5"
                      />
                    </span>
                    <span className="min-w-0 flex-1 truncate">{currency.name}</span>
                    <span className="font-mono text-xs text-muted-foreground">
                      {currency.code} · {currency.symbol}
                    </span>
                    <Check
                      className={`h-4 w-4 ${currency.code === selectedCode ? "opacity-100" : "opacity-0"}`}
                    />
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}

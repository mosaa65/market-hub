import React, {
  useState,
  useRef,
  useMemo,
  useEffect,
  type Dispatch,
  type SetStateAction,
} from "react";
import { ChevronDown, Check } from "lucide-react";
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "@/components/ui/command";
import { Receipt, ScanBarcode, Wrench } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/integrations/supabase/client";
import { getCurrencyOptions, getCurrencySymbol, type CurrencyOption } from "@/lib/currencies";
import { FlagIcon, currencyToCountryCode } from "@/components/ui/flag-icon";
import { toast } from "sonner";
import type { InvoiceTemplate } from "@/lib/invoice-print";
import { getPrintSettings, savePrintSettings } from "@/lib/templates";
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
  // Post-sale printing preferences come from the same unified store used by POS
  const [printMode, setPrintModeState] = useState<"auto" | "ask" | "off">("ask");
  const [defaultPrintTemplate, setDefaultPrintTemplateState] = useState<InvoiceTemplate>("thermal");
  const [logoUploading, setLogoUploading] = useState(false);
  const logoInputRef = useRef<HTMLInputElement>(null);
  // علم الباركود له مصدر واحد فعلي (`catalog_modules.enableBarcode`) يقرأه
  // الكاشير والفاتورة. هنا نحفظ فيه مباشرة بدل تعديل نموذج الإعدادات فقط،
  // حتى ينعكس التفعيل على الواجهة والمطبوع لا على حالة الزر وحده.
  const { config: catalogConfig, updateConfig: updateCatalogConfig } = useCatalogModules();
  const currencyOptions = useMemo(() => getCurrencyOptions(lang), [lang]);
  const currencyPreviewSymbol =
    form.currency_symbol?.trim() ||
    getCurrencySymbol(form.currency || "YER", isAr ? "ar-YE" : "en");

  useEffect(() => {
    const s = getPrintSettings();
    setPrintModeState(s.printMode);
    setDefaultPrintTemplateState(s.defaultCustomerTemplate as InvoiceTemplate);
  }, []);

  const setPrintMode = (v: "auto" | "ask" | "off") => {
    setPrintModeState(v);
  };

  const setDefaultPrintTemplate = (v: InvoiceTemplate) => {
    setDefaultPrintTemplateState(v);
  };

  async function uploadCompanyLogo(file: File) {
    const allowedTypes = ["image/png", "image/jpeg", "image/webp"];
    if (!allowedTypes.includes(file.type)) {
      toast.error(
        isAr ? "اختر صورة بصيغة PNG أو JPG أو WebP." : "Choose a PNG, JPG, or WebP image.",
      );
      return;
    }
    if (file.size > 3 * 1024 * 1024) {
      toast.error(
        isAr ? "حجم الشعار يجب ألا يتجاوز 3 ميجابايت." : "The logo must be 3 MB or smaller.",
      );
      return;
    }

    setLogoUploading(true);
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
      setForm((current: any) => ({ ...current, logo_url: data.publicUrl }));
      toast.success(
        isAr
          ? "تم رفع الشعار. اضغط «حفظ» لتطبيقه على الفواتير."
          : "Logo uploaded. Save the settings to apply it to invoices.",
      );
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : isAr
            ? "تعذر رفع الشعار."
            : "Could not upload the logo.",
      );
    } finally {
      setLogoUploading(false);
    }
  }

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
                  setForm((current: any) => ({ ...current, currency_symbol: event.target.value }))
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
              <Input
                id="tax-rate"
                type="number"
                min="0"
                max="100"
                step="0.01"
                value={String(form.tax_rate ?? 0)}
                onChange={(event) =>
                  setForm((current: any) => ({ ...current, tax_rate: event.target.value }))
                }
                disabled={!canEdit}
                placeholder="0"
                className="rounded-2xl font-mono"
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            {isAr
              ? "العملة الافتراضية للمنشآت الجديدة هي الريال اليمني. تغييرها لا يحوّل المبالغ المسجلة سابقاً."
              : "New companies default to Yemeni Rial. Changing currency does not convert existing amounts."}
          </p>
        </div>

        {/* Central Document Numbering Engine — every document type, not just invoices */}
        <div className="space-y-3 rounded-2xl border border-border/80 bg-surface/50 p-4">
          <DocumentNumberingCard isAr={isAr} canEdit={canEdit} />
          <p className="text-xs text-muted-foreground">
            {isAr
              ? "التسلسل الرقمي منفصل تماماً عن شكل الرقم المعروض: لكل نوع مستند تسلسل مستقل يُخصَّص داخل قاعدة البيانات (ذرّياً) لمنع تكرار الأرقام، ولا يُعاد ترقيم المستندات القديمة عند تغيير التنسيق."
              : "The numeric sequence is fully separate from the displayed format: each document type has its own sequence allocated atomically inside the database to prevent duplicates, and changing the format never renumbers existing documents."}
          </p>
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
              checked={catalogConfig.enableBarcode}
              onCheckedChange={(v) => {
                updateCatalogConfig({ enableBarcode: v });
                setForm({ ...form, barcode_enabled: v });
              }}
              disabled={!canEdit}
            />
          </div>
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

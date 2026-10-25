import { useState, useEffect, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import {
  Printer,
  Eye,
  Sliders,
  ShieldCheck,
  Check,
  Layers,
  Settings2,
  FileText,
  Sparkles,
  ShoppingBag,
  Truck,
  RotateCcw,
  Receipt,
  Scale,
  QrCode,
  Palette,
  Undo2,
} from "lucide-react";
import {
  getPrintSettings,
  savePrintSettings,
  PrintSettings,
  InvoiceTemplateId,
  type PaperProfileId,
} from "@/lib/templates";
import {
  getUnifiedPrintSettings,
  commitPrintSettings,
  saveUnifiedPrintSettings,
  normalizePrintSettings,
  PRINT_PAPERS,
  DEFAULT_STANDARD_COLOR,
  DEFAULT_LUXURY_COLOR,
  STANDARD_COLOR_PALETTE,
  LUXURY_COLOR_PALETTE,
  deriveThemeTokens,
  type PrintBehavior,
  type PrintMethod,
  type PrintingDocumentType,
  type PrintPaperId,
  type PrintTheme,
} from "@/lib/printing";
import { LuxuryPrintPreviewModal } from "@/components/luxury-print-preview-modal";
import { sampleDocumentFor } from "@/lib/printing/samples";
import { toast } from "sonner";

interface PrintSettingsCardProps {
  canEdit?: boolean;
}

type SettingsTab = "departments" | "colors" | "engine" | "fields";

interface DepartmentConfig {
  id: PrintingDocumentType;
  titleAr: string;
  descAr: string;
  icon: typeof ShoppingBag;
  defaultMethod: "thermal" | "page";
  defaultTemplate: InvoiceTemplateId;
  defaultPaper: PrintPaperId;
}

const DEPARTMENTS: DepartmentConfig[] = [
  {
    id: "customer_invoice",
    titleAr: "قسم المبيعات ونقاط البيع (POS)",
    descAr: "الفاتورة المقدمة للعميل في شاشات المبيعات السريعة ونقاط البيع",
    icon: ShoppingBag,
    defaultMethod: "thermal",
    defaultTemplate: "thermal-milling",
    defaultPaper: "thermal-80",
  },
  {
    id: "purchase_invoice",
    titleAr: "قسم المشتريات والموردين",
    descAr: "فواتير التوريد واستلام بضائع الموردين وشاشات نقاط الشراء",
    icon: Truck,
    defaultMethod: "page",
    defaultTemplate: "milling-clean",
    defaultPaper: "a4",
  },
  {
    id: "delivery_note",
    titleAr: "قسم خدمات العملاء والتسليم",
    descAr: "إيصالات وسندات التسليم الفوري، تذاكر الحجز، وأذونات تسليم النواتج",
    icon: Scale,
    defaultMethod: "thermal",
    defaultTemplate: "thermal-milling",
    defaultPaper: "thermal-80",
  },
  {
    id: "inventory_document",
    titleAr: "قسم حركات وإذن المخازن",
    descAr: "مستندات الصرف، الاستلام المخزني، ومناقلات البضائع بين الفروع",
    icon: Layers,
    defaultMethod: "page",
    defaultTemplate: "milling-clean",
    defaultPaper: "a4",
  },
  {
    id: "sales_return",
    titleAr: "قسم المرتجعات والإشعارات",
    descAr: "إشعارات دائن ومدين لمرتجعات المبيعات والمشتريات",
    icon: RotateCcw,
    defaultMethod: "thermal",
    defaultTemplate: "thermal-milling",
    defaultPaper: "thermal-80",
  },
  {
    id: "payment_receipt",
    titleAr: "قسم السندات والقبض المالي",
    descAr: "إيصالات تحصيل النقدية، سندات الصرف والقبض، ومخالصات العملاء",
    icon: Receipt,
    defaultMethod: "page",
    defaultTemplate: "milling-clean",
    defaultPaper: "a4",
  },
];

export function PrintSettingsCard({ canEdit = true }: PrintSettingsCardProps) {
  const [activeTab, setActiveTab] = useState<SettingsTab>("departments");
  const [settings, setSettings] = useState<PrintSettings>(() => getPrintSettings());
  const [unified, setUnified] = useState(() => getUnifiedPrintSettings());

  // Modal preview state
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewDocType, setPreviewDocType] = useState<PrintingDocumentType>("customer_invoice");
  const [previewTemplateOverride, setPreviewTemplateOverride] = useState<InvoiceTemplateId | null>(
    null,
  );
  const [previewPaperOverride, setPreviewPaperOverride] = useState<PrintPaperId | null>(null);
  const [standardPaperSize, setStandardPaperSize] = useState<"a4" | "a5">("a4");
  const [luxuryPaperSize, setLuxuryPaperSize] = useState<"a4" | "a5">("a4");
  const [isSaving, setIsSaving] = useState(false);
  const [savedSnapshot, setSavedSnapshot] = useState(() => ({
    settings: getPrintSettings(),
    unified: getUnifiedPrintSettings(),
  }));
  const isDirty = useMemo(
    () =>
      JSON.stringify(settings) !== JSON.stringify(savedSnapshot.settings) ||
      JSON.stringify(unified) !== JSON.stringify(savedSnapshot.unified),
    [settings, unified, savedSnapshot],
  );

  useEffect(() => {
    const currentSettings = getPrintSettings();
    const currentUnified = getUnifiedPrintSettings();
    setSettings(currentSettings);
    setUnified(currentUnified);
    setSavedSnapshot({ settings: currentSettings, unified: currentUnified });
  }, []);

  const FIELD_TOGGLE_KEYS = [
    "showLogo",
    "showCompanyInfo",
    "showCustomerInfo",
    "showDocNumberDate",
    "showMovementInfo",
    "showFinancialDetails",
    "showPaymentInfo",
    "showNotes",
    "showFooter",
    "showBarcode",
    "showQrCode",
    "showSignatures",
  ] as const;

  function handleToggle(key: keyof PrintSettings) {
    const nextValue = !settings[key];
    setSettings((current) => ({
      ...current,
      [key]: nextValue,
      ...(key === "autoPrintCustomerInvoice" ? { printMode: nextValue ? "auto" : "ask" } : {}),
    }));
    if ((FIELD_TOGGLE_KEYS as readonly string[]).includes(key)) {
      updateUnified({ [key]: nextValue } as never);
    }
  }

  function updateUnified(patch: Partial<typeof unified>) {
    setUnified((current) => normalizePrintSettings({ ...current, ...patch }));
  }

  function saveAllSettings() {
    if (!canEdit || !isDirty) return;
    setIsSaving(true);
    try {
      const savedSettings = savePrintSettings(settings);
      const savedUnified = commitPrintSettings(unified);
      setSettings(savedSettings);
      setUnified(savedUnified);
      setSavedSnapshot({ settings: savedSettings, unified: savedUnified });
      toast.success("تم حفظ إعدادات الطباعة لهذا المستخدم والجهاز");
    } finally {
      setIsSaving(false);
    }
  }

  function handleStandardColorChange(color: string | undefined) {
    updateUnified({ standardAccentColor: color });
    setSettings((cur) => ({ ...cur, standardAccentColor: color }));
    saveUnifiedPrintSettings({ standardAccentColor: color });
    savePrintSettings({ standardAccentColor: color });
  }

  function handleLuxuryColorChange(color: string | undefined) {
    updateUnified({ luxuryAccentColor: color });
    setSettings((cur) => ({ ...cur, luxuryAccentColor: color }));
    saveUnifiedPrintSettings({ luxuryAccentColor: color });
    savePrintSettings({ luxuryAccentColor: color });
  }

  function handleDefaultInvoiceTemplateChange(templateId: InvoiceTemplateId) {
    const theme: PrintTheme =
      templateId === "elegant" ? "luxury" : templateId === "formal" ? "formal" : "standard";
    const nextOverrides = {
      ...unified.overrides,
      customer_invoice: {
        ...unified.overrides.customer_invoice,
        templateId,
        theme,
      },
    };
    updateUnified({ overrides: nextOverrides, theme });
    setSettings((cur) => ({ ...cur, defaultCustomerTemplate: templateId }));
    saveUnifiedPrintSettings({ overrides: nextOverrides, theme });
    savePrintSettings({ defaultCustomerTemplate: templateId });
    toast.success(
      templateId === "elegant"
        ? "تم تعيين القالب التنفيذي الفاخر كقالب افتراضي للفواتير"
        : templateId === "standard"
          ? "تم تعيين القالب القياسي المؤسسي كقالب افتراضي للفواتير"
          : "تم تعيين الفاتورة الرسمية المبسطة كقالب افتراضي للفواتير",
    );
  }

  // Handle department template & paper profile change
  function handleDepartmentChange(
    docType: PrintingDocumentType,
    templateId: InvoiceTemplateId,
    paperId: PrintPaperId,
  ) {
    const theme: PrintTheme =
      templateId === "elegant" ? "luxury" : templateId === "formal" ? "formal" : "standard";

    const nextOverrides = {
      ...unified.overrides,
      [docType]: {
        ...unified.overrides[docType],
        templateId,
        paperId,
        theme,
      },
    };

    updateUnified({ overrides: nextOverrides });

    // Keep legacy invoice profile values in the same unsaved component state.
    setSettings((current) =>
      docType === "customer_invoice"
        ? {
            ...current,
            defaultCustomerTemplate: templateId,
            defaultCustomerPaperProfile: paperId as PaperProfileId,
          }
        : docType === "inventory_document"
          ? {
              ...current,
              defaultInventoryTemplate: templateId,
              defaultInventoryPaperProfile: paperId as PaperProfileId,
            }
          : current,
    );
  }

  function handleDepartmentCopiesChange(docType: PrintingDocumentType, copies: number) {
    const nextOverrides = {
      ...unified.overrides,
      [docType]: {
        ...unified.overrides[docType],
        copies,
      },
    };
    updateUnified({ overrides: nextOverrides });
  }

  function handleDepartmentBarcodeToggle(
    docType: PrintingDocumentType,
    field: "showBarcode" | "showQrCode",
  ) {
    const currentVal = unified.overrides[docType]?.[field] ?? unified[field] ?? true;
    const nextOverrides = {
      ...unified.overrides,
      [docType]: {
        ...unified.overrides[docType],
        [field]: !currentVal,
      },
    };
    updateUnified({ overrides: nextOverrides });
  }

  const sampleDoc = useMemo(() => sampleDocumentFor(previewDocType), [previewDocType]);

  const previewRequest = useMemo(() => {
    const dept = DEPARTMENTS.find((d) => d.id === previewDocType);
    const override = unified.overrides[previewDocType];
    const templateId =
      previewTemplateOverride || override?.templateId || dept?.defaultTemplate || "thermal-milling";
    const paperId =
      previewPaperOverride ||
      override?.paperId ||
      dept?.defaultPaper ||
      (templateId.startsWith("thermal") ? "thermal-80" : "a4");
    const theme: PrintTheme =
      templateId === "elegant" ? "luxury" : templateId === "formal" ? "formal" : "standard";

    const accentColor =
      override?.accentColor ??
      (theme === "luxury" ? unified.luxuryAccentColor : unified.standardAccentColor) ??
      undefined;

    return {
      doc: sampleDoc,
      documentType: previewDocType,
      paperId,
      templateId,
      theme,
      settings: unified,
      rtl: true,
      accentColor,
      // حتى ينعكس تفعيل/إلغاء الباركود و QR لهذا القسم فعلياً على المعاينة.
      showBarcode: override?.showBarcode ?? unified.showBarcode ?? true,
      showQrCode: override?.showQrCode ?? unified.showQrCode ?? false,
      showSignatures: override?.showSignatures ?? unified.showSignatures ?? false,
    };
  }, [sampleDoc, previewDocType, previewTemplateOverride, previewPaperOverride, unified]);

  return (
    <>
      <Card className="lg:col-span-2 rounded-3xl border border-border/80 bg-card shadow-sm overflow-hidden">
        {/* ── Card Header ── */}
        <CardHeader className="bg-muted/30 border-b border-border/80 pb-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-2xl bg-primary/10 text-primary">
                <Printer className="h-5 w-5" />
              </div>
              <div>
                <CardTitle className="text-base font-bold">
                  إعدادات الطباعة والقوالب الموحدة
                </CardTitle>
                <p className="text-xs text-muted-foreground mt-0.5">
                  هيكلة قوالب الفواتير، مقاسات الورق لكل قسم، وتجربة المعاينة الفاخرة
                </p>
              </div>
            </div>

            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setPreviewDocType("customer_invoice");
                setPreviewOpen(true);
              }}
              className="rounded-full gap-1.5 border-primary/40 text-primary hover:bg-primary/10"
            >
              <Eye className="h-4 w-4" />
              <span>المعاينة الفاخرة المباشرة</span>
            </Button>
          </div>

          {/* ── Tabs Segmented Bar ── */}
          <div className="flex items-center gap-1.5 bg-surface-2 p-1 rounded-2xl border border-border/60 mt-4 w-fit flex-wrap">
            <button
              type="button"
              onClick={() => setActiveTab("departments")}
              className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold transition-all ${
                activeTab === "departments"
                  ? "bg-primary text-primary-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground hover:bg-surface"
              }`}
            >
              <Layers className="h-3.5 w-3.5" />
              <span>قوالب الأقسام والورق الذكي</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab("colors")}
              className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold transition-all ${
                activeTab === "colors"
                  ? "bg-primary text-primary-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground hover:bg-surface"
              }`}
            >
              <Palette className="h-3.5 w-3.5" />
              <span>ألوان وهوية القوالب</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab("engine")}
              className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold transition-all ${
                activeTab === "engine"
                  ? "bg-primary text-primary-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground hover:bg-surface"
              }`}
            >
              <Settings2 className="h-3.5 w-3.5" />
              <span>المحرك العام وسلوك الطباعة</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab("fields")}
              className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold transition-all ${
                activeTab === "fields"
                  ? "bg-primary text-primary-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground hover:bg-surface"
              }`}
            >
              <Sliders className="h-3.5 w-3.5" />
              <span>تخصيص إظهار الحقول</span>
            </button>
          </div>
        </CardHeader>

        <CardContent className="pt-6">
          {/* ═════════════════════════════════════════════════════════════════ */}
          {/* TAB 1: قوالب الأقسام والربط المنطقي بين القالب ومقاس الورق         */}
          {/* ═════════════════════════════════════════════════════════════════ */}
          {activeTab === "departments" && (
            <div className="space-y-4">
              <div className="rounded-2xl border border-border/70 bg-muted/20 p-3.5 flex flex-wrap items-center justify-between gap-2">
                <div className="space-y-0.5">
                  <div className="text-xs font-bold text-foreground">
                    الهيكلة المعيارية للطباعة (طريقة الطباعة ➔ قالب التصميم ➔ مقاس الورق)
                  </div>
                  <div className="text-[11px] text-muted-foreground leading-relaxed">
                    الطباعة الحرارية هي طريقة واحدة لها مقاسات (80 مم و 58 مم) وقوالب تصميم (الإيصال
                    الحراري الاحترافي، إيصال نقطة البيع، باركود و QR). وكذلك طباعة الصفحات تتيح
                    مقاسات (A4 و A5) وقوالب تصميم (الفاتورة الرسمية المبسطة، قياسي، فاخر، رسمي).
                  </div>
                </div>
                <div className="text-xs font-semibold px-2.5 py-1 rounded-xl bg-primary/10 text-primary border border-primary/20">
                  {DEPARTMENTS.length} أقسام مهيأة
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {DEPARTMENTS.map((dept) => {
                  const override = unified.overrides[dept.id] || {};
                  const rawTemplate = override.templateId || dept.defaultTemplate;
                  const rawPaper = override.paperId || dept.defaultPaper;

                  // Determine current print family
                  const isThermal =
                    rawTemplate.startsWith("thermal") ||
                    rawPaper === "thermal-80" ||
                    rawPaper === "thermal-58";

                  const printFamily = isThermal ? "thermal" : "page";

                  return (
                    <div
                      key={dept.id}
                      className="rounded-2xl border border-border/80 bg-surface/80 p-4 space-y-4 shadow-xs hover:border-primary/40 hover:shadow-sm transition"
                    >
                      {/* Dept Card Header */}
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div className="p-2 rounded-xl bg-primary/10 text-primary shrink-0">
                            <dept.icon className="h-4 w-4" />
                          </div>
                          <div className="min-w-0">
                            <h5 className="text-sm font-bold truncate text-foreground">
                              {dept.titleAr}
                            </h5>
                            <p className="text-[11px] text-muted-foreground truncate">
                              {dept.descAr}
                            </p>
                          </div>
                        </div>

                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 px-2 py-0.5 text-[10px] font-bold shrink-0 border border-emerald-500/20">
                          <Check className="h-3 w-3" /> نشط
                        </span>
                      </div>

                      {/* 1. Method Selector: Thermal vs Page */}
                      <div className="space-y-1.5">
                        <label className="text-xs font-semibold text-muted-foreground block">
                          طريقة ونوع الطباعة
                        </label>
                        <div className="grid grid-cols-2 gap-1.5 p-1 rounded-xl bg-surface-2 border border-border/60">
                          <button
                            type="button"
                            disabled={!canEdit}
                            onClick={() => {
                              handleDepartmentChange(dept.id, "thermal-milling", "thermal-80");
                            }}
                            className={`flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-lg text-xs font-bold transition-all ${
                              printFamily === "thermal"
                                ? "bg-primary text-primary-foreground shadow-xs"
                                : "text-muted-foreground hover:text-foreground"
                            }`}
                          >
                            <Printer className="h-3.5 w-3.5" />
                            <span>طباعة حرارية</span>
                          </button>

                          <button
                            type="button"
                            disabled={!canEdit}
                            onClick={() => {
                              handleDepartmentChange(dept.id, "milling-clean", "a4");
                            }}
                            className={`flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-lg text-xs font-bold transition-all ${
                              printFamily === "page"
                                ? "bg-primary text-primary-foreground shadow-xs"
                                : "text-muted-foreground hover:text-foreground"
                            }`}
                          >
                            <FileText className="h-3.5 w-3.5" />
                            <span>صفحات (A4 / A5)</span>
                          </button>
                        </div>
                      </div>

                      {/* 2 & 3. Linked Dropdowns: Template & Paper Size */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                        {/* Dropdown 1: قالب التصميم */}
                        <div className="space-y-1.5">
                          <label className="text-xs font-semibold text-muted-foreground flex items-center justify-between">
                            <span>قالب التصميم</span>
                            {isThermal ? (
                              <span className="text-[10px] text-amber-500 font-mono">حراري</span>
                            ) : (
                              <span className="text-[10px] text-primary font-mono">صفحة رسمية</span>
                            )}
                          </label>
                          <select
                            value={rawTemplate}
                            disabled={!canEdit}
                            onChange={(e) => {
                              const chosenTemplate = e.target.value as InvoiceTemplateId;
                              handleDepartmentChange(dept.id, chosenTemplate, rawPaper);
                            }}
                            className="h-10 w-full rounded-xl border border-input bg-background px-3 text-xs font-medium outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:opacity-60"
                          >
                            {isThermal ? (
                              <>
                                <option value="thermal-milling">
                                  ⭐ قالب الإيصال الحراري الاحترافي
                                </option>
                                <option value="thermal">🧾 قالب إيصال نقطة البيع</option>
                                <option value="thermal-qr">📱 قالب الإيصال مع باركود و QR</option>
                              </>
                            ) : (
                              <>
                                <option value="elegant">
                                  ✨ قالب تنفيذي فاخر (Executive Luxury)
                                </option>
                                <option value="standard">
                                  📄 قالب قياسي مضغوط (Compact Commercial)
                                </option>
                                <option value="milling-clean">
                                  ⭐ قالب الفاتورة الرسمية المبسطة
                                </option>
                                <option value="formal">🏛️ قالب رسمي كلاسيكي</option>
                              </>
                            )}
                          </select>
                        </div>

                        {/* Dropdown 2: مقاس الورق */}
                        <div className="space-y-1.5">
                          <label className="text-xs font-semibold text-muted-foreground flex items-center justify-between">
                            <span>مقاس الورق</span>
                            <span className="text-[10px] font-mono text-muted-foreground shrink-0">
                              {PRINT_PAPERS[rawPaper]?.widthMm}mm
                            </span>
                          </label>
                          <select
                            value={rawPaper}
                            disabled={!canEdit}
                            onChange={(e) => {
                              const nextPaper = e.target.value as PrintPaperId;
                              handleDepartmentChange(dept.id, rawTemplate, nextPaper);
                            }}
                            className="h-10 w-full rounded-xl border border-input bg-background px-3 text-xs font-medium outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:opacity-60"
                          >
                            {isThermal ? (
                              <>
                                <option value="thermal-80">
                                  80 مم (80mm) — قياسي لمعظم الطابعات
                                </option>
                                <option value="thermal-58">
                                  58 مم (58mm) — طابعات الجيب والبلوتوث
                                </option>
                              </>
                            ) : (
                              <>
                                <option value="a4">A4 (210 × 297 مم) — صفحة كاملة</option>
                                <option value="a5">A5 (148 × 210 مم) — نصف صفحة مدمجة</option>
                              </>
                            )}
                          </select>
                        </div>

                        {/* Dropdown 3: عدد النسخ التلقائية المخصصة لهذا القسم */}
                        <div className="space-y-1.5 sm:col-span-2 pt-1">
                          <label className="text-xs font-semibold text-muted-foreground flex items-center justify-between">
                            <span>عدد النسخ المطبوعة تلقائياً لهذا القسم</span>
                            <span className="text-[10px] text-primary font-mono font-bold">
                              {override.copies ?? unified.copies}{" "}
                              {(override.copies ?? unified.copies) === 1
                                ? "نسخة واحدة"
                                : (override.copies ?? unified.copies) === 2
                                  ? "نسختين"
                                  : "نسخ"}
                            </span>
                          </label>
                          <div className="flex items-center gap-1.5">
                            {[1, 2, 3, 4].map((cNum) => {
                              const activeCopies = override.copies ?? unified.copies;
                              const isSelected = activeCopies === cNum;
                              return (
                                <button
                                  key={cNum}
                                  type="button"
                                  disabled={!canEdit}
                                  onClick={() => handleDepartmentCopiesChange(dept.id, cNum)}
                                  className={`flex-1 py-1.5 px-2 rounded-xl text-xs font-bold transition-all border ${
                                    isSelected
                                      ? "bg-primary text-primary-foreground border-primary shadow-xs"
                                      : "bg-background text-muted-foreground border-border/70 hover:text-foreground hover:bg-surface-2"
                                  }`}
                                >
                                  {cNum} {cNum === 1 ? "نسخة" : "نسخ"}
                                </button>
                              );
                            })}
                          </div>
                        </div>

                        {/* Controls 4: تخصيص إظهار الباركود والـ QR لهذا القسم */}
                        <div className="space-y-1.5 sm:col-span-2 pt-1 border-t border-border/50">
                          <label className="text-xs font-semibold text-muted-foreground block">
                            تخصيص الرموز والترميز لهذا القسم
                          </label>
                          <div className="grid grid-cols-2 gap-2">
                            <div className="flex items-center justify-between p-2 rounded-xl border border-border/60 bg-background/60">
                              <span className="text-xs font-medium">طباعة الباركود</span>
                              <Switch
                                checked={override.showBarcode ?? unified.showBarcode ?? true}
                                onCheckedChange={() =>
                                  handleDepartmentBarcodeToggle(dept.id, "showBarcode")
                                }
                                disabled={!canEdit}
                              />
                            </div>
                            <div className="flex items-center justify-between p-2 rounded-xl border border-border/60 bg-background/60">
                              <span className="text-xs font-medium">رمز QR الإلكتروني</span>
                              <Switch
                                checked={override.showQrCode ?? unified.showQrCode ?? false}
                                onCheckedChange={() =>
                                  handleDepartmentBarcodeToggle(dept.id, "showQrCode")
                                }
                                disabled={!canEdit}
                              />
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Card Bottom: Summary + Live Preview Button */}
                      <div className="flex items-center justify-between border-t border-border/60 pt-3 text-xs">
                        <span className="text-[11px] text-muted-foreground flex items-center gap-1.5">
                          <span className="font-medium text-foreground">
                            {rawTemplate === "thermal-milling"
                              ? "الإيصال الحراري الاحترافي"
                              : rawTemplate === "thermal"
                                ? "إيصال نقطة البيع"
                                : rawTemplate === "thermal-qr"
                                  ? "إيصال باركود وQR"
                                  : rawTemplate === "milling-clean"
                                    ? "الفاتورة الرسمية المبسطة"
                                    : rawTemplate === "elegant"
                                      ? "تنفيذي فاخر"
                                      : rawTemplate === "formal"
                                        ? "رسمي معتمد"
                                        : "قياسي مؤسسي"}
                          </span>
                          <span>·</span>
                          <span className="font-mono text-muted-foreground">
                            {PRINT_PAPERS[rawPaper]?.nameAr}
                          </span>
                        </span>

                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setPreviewDocType(dept.id);
                            setPreviewOpen(true);
                          }}
                          className="h-8 rounded-xl gap-1.5 text-xs text-primary hover:bg-primary/10"
                        >
                          <Eye className="h-3.5 w-3.5" />
                          <span>معاينة قالب القسم</span>
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ═════════════════════════════════════════════════════════════════ */}
          {/* TAB: التحكم بألوان وهوية القوالب الحالية (قياسي مؤسسي وتنفيذي فاخر) */}
          {/* ═════════════════════════════════════════════════════════════════ */}
          {activeTab === "colors" && (
            <div className="space-y-6">
              {/* اختيار قالب وثيم الفاتورة الافتراضي */}
              <div className="rounded-2xl border border-primary/30 bg-primary/5 p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="space-y-0.5">
                    <div className="text-xs font-bold text-foreground flex items-center gap-2">
                      <Sparkles className="h-4 w-4 text-primary" />
                      <span>قالب وثيم الفواتير الافتراضي المعتمد (النموذج النشط للطباعة)</span>
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      اختر القالب والثيم الذي يُطبَّق تلقائياً على فواتير المبيعات ونقاط البيع
                      والمعاينة
                    </div>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    onClick={saveAllSettings}
                    disabled={!canEdit}
                    className="rounded-xl h-8 gap-1.5 text-xs font-bold shadow-xs"
                  >
                    <Check className="h-3.5 w-3.5" />
                    <span>حفظ واعتماد الثيم فوراً</span>
                  </Button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-1">
                  {[
                    {
                      id: "elegant" as InvoiceTemplateId,
                      title: "✨ القالب التنفيذي الفاخر",
                      sub: "ألوان كحلية وزرقاء ملكية وتصميم تنفيذي راقٍ",
                      theme: "luxury" as PrintTheme,
                    },
                    {
                      id: "standard" as InvoiceTemplateId,
                      title: "📄 القالب القياسي المؤسسي",
                      sub: "هيكل مؤسسي أنيق متزن للشركات والمؤسسات",
                      theme: "standard" as PrintTheme,
                    },
                    {
                      id: "milling-clean" as InvoiceTemplateId,
                      title: "⭐ الفاتورة الرسمية المبسطة",
                      sub: "تصميم مبسط وواضح للمطاحن ونقاط البيع",
                      theme: "standard" as PrintTheme,
                    },
                  ].map((tpl) => {
                    const currentCustomerTemplate =
                      unified.overrides.customer_invoice?.templateId ||
                      settings.defaultCustomerTemplate ||
                      "milling-clean";
                    const isSelected = currentCustomerTemplate === tpl.id;

                    return (
                      <button
                        key={tpl.id}
                        type="button"
                        disabled={!canEdit}
                        onClick={() => handleDefaultInvoiceTemplateChange(tpl.id)}
                        className={`flex flex-col text-start p-3 rounded-xl border transition-all ${
                          isSelected
                            ? "border-primary bg-primary/10 shadow-xs ring-1 ring-primary/40 font-bold"
                            : "border-border/70 bg-background hover:border-primary/40"
                        }`}
                      >
                        <div className="text-xs font-bold text-foreground flex items-center justify-between">
                          <span>{tpl.title}</span>
                          {isSelected && <Check className="h-3.5 w-3.5 text-primary" />}
                        </div>
                        <div className="text-[10px] text-muted-foreground mt-1 leading-relaxed">
                          {tpl.sub}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="rounded-2xl border border-border/70 bg-muted/20 p-3.5 flex flex-wrap items-center justify-between gap-2">
                <div className="space-y-0.5">
                  <div className="text-xs font-bold text-foreground">
                    تخصيص ألوان وهوية قوالب الفواتير (Corporate & Luxury Branding)
                  </div>
                  <div className="text-[11px] text-muted-foreground leading-relaxed">
                    تحكم باللون الأساسي المعتمد لكل من القالب القياسي والتنفيذي، مع الحفاظ على وضوح
                    النصوص وسهولة القراءة عند الطباعة على أحجام A4 و A5.
                  </div>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!canEdit}
                  onClick={() => {
                    handleStandardColorChange(undefined);
                    handleLuxuryColorChange(undefined);
                    toast.info("تمت استعادة الألوان الافتراضية للقالبين");
                  }}
                  className="rounded-xl h-8 gap-1.5 text-xs text-muted-foreground hover:text-foreground border-border/80"
                >
                  <Undo2 className="h-3.5 w-3.5" />
                  <span>استعادة الألوان الافتراضية للقالبين</span>
                </Button>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                {/* 1. القالب القياسي المؤسسي */}
                {(() => {
                  const currentColor = unified.standardAccentColor || DEFAULT_STANDARD_COLOR;
                  const tokens = deriveThemeTokens("standard", currentColor);

                  return (
                    <div className="rounded-2xl border border-border/80 bg-surface/80 p-5 space-y-4 shadow-xs flex flex-col justify-between">
                      <div className="space-y-4">
                        <div className="flex items-center justify-between gap-3 border-b border-border/60 pb-3">
                          <div className="flex items-center gap-2.5">
                            <div
                              className="w-8 h-8 rounded-xl flex items-center justify-center text-white shadow-xs"
                              style={{ backgroundColor: currentColor }}
                            >
                              <FileText className="h-4 w-4" />
                            </div>
                            <div>
                              <h4 className="text-sm font-bold text-foreground">
                                القالب القياسي المؤسسي (Standard Corporate)
                              </h4>
                              <p className="text-[11px] text-muted-foreground">
                                هوية مؤسسية متزنة للشركات والمؤسسات (A4 / A5)
                              </p>
                            </div>
                          </div>

                          <span
                            className="px-2.5 py-1 rounded-lg text-[11px] font-mono font-bold border"
                            style={{
                              color: currentColor,
                              borderColor: tokens.line,
                              backgroundColor: tokens.accentSoft,
                            }}
                          >
                            {currentColor.toUpperCase()}
                          </span>
                        </div>

                        {/* اختيار حجم الورق للمعاينة */}
                        <div className="flex items-center justify-between p-2 rounded-xl border border-border/60 bg-background/50">
                          <span className="text-xs font-semibold text-muted-foreground">
                            حجم الورق للمعاينة والطباعة:
                          </span>
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => setStandardPaperSize("a4")}
                              className={`px-3 py-1 rounded-lg text-xs font-bold transition-all ${
                                standardPaperSize === "a4"
                                  ? "bg-primary text-primary-foreground shadow-xs"
                                  : "text-muted-foreground hover:text-foreground"
                              }`}
                            >
                              A4
                            </button>
                            <button
                              type="button"
                              onClick={() => setStandardPaperSize("a5")}
                              className={`px-3 py-1 rounded-lg text-xs font-bold transition-all ${
                                standardPaperSize === "a5"
                                  ? "bg-primary text-primary-foreground shadow-xs"
                                  : "text-muted-foreground hover:text-foreground"
                              }`}
                            >
                              A5
                            </button>
                          </div>
                        </div>

                        {/* منتقي اللون المباشر */}
                        <div className="space-y-2">
                          <label className="text-xs font-semibold text-muted-foreground flex items-center justify-between">
                            <span>اختيار لون حر (منتقي ألوان فعلي)</span>
                            <span className="text-[10px] text-muted-foreground">
                              اضغط للمنتقي أو أدخل كود HEX
                            </span>
                          </label>
                          <div className="flex items-center gap-3 p-2.5 rounded-xl border border-border/70 bg-background/60">
                            <input
                              type="color"
                              disabled={!canEdit}
                              value={currentColor}
                              onChange={(e) => handleStandardColorChange(e.target.value)}
                              className="w-10 h-10 rounded-lg cursor-pointer border-0 p-0 bg-transparent shrink-0"
                            />
                            <input
                              type="text"
                              disabled={!canEdit}
                              value={currentColor}
                              onChange={(e) => {
                                const val = e.target.value;
                                if (/^#[0-9A-Fa-f]{0,6}$/.test(val)) {
                                  handleStandardColorChange(val);
                                }
                              }}
                              placeholder="#1d4ed8"
                              className="h-9 flex-1 rounded-lg border border-input bg-background px-3 font-mono text-xs uppercase"
                            />
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              disabled={!canEdit || !unified.standardAccentColor}
                              onClick={() => handleStandardColorChange(undefined)}
                              className="h-9 px-2 text-xs text-muted-foreground hover:text-foreground"
                            >
                              افتراضي
                            </Button>
                          </div>
                        </div>

                        {/* باليتة الألوان المقترحة */}
                        <div className="space-y-2">
                          <label className="text-xs font-semibold text-muted-foreground block">
                            ألوان أعمال مقترحة احترافية
                          </label>
                          <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                            {STANDARD_COLOR_PALETTE.map((p) => {
                              const isSelected =
                                currentColor.toLowerCase() === p.color.toLowerCase();
                              return (
                                <button
                                  key={p.color}
                                  type="button"
                                  disabled={!canEdit}
                                  onClick={() => handleStandardColorChange(p.color)}
                                  title={p.labelAr}
                                  className={`group flex flex-col items-center gap-1.5 p-2 rounded-xl border transition-all ${
                                    isSelected
                                      ? "ring-2 ring-primary border-primary bg-primary/5"
                                      : "border-border/60 hover:border-border bg-background/50 hover:bg-background"
                                  }`}
                                >
                                  <span
                                    className="w-6 h-6 rounded-full shadow-xs flex items-center justify-center text-white"
                                    style={{ backgroundColor: p.color }}
                                  >
                                    {isSelected && <Check className="h-3 w-3" />}
                                  </span>
                                  <span className="text-[10px] text-muted-foreground truncate max-w-full">
                                    {p.labelAr.split(" ")[0]}
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                        </div>

                        {/* شريحة معاينة مصغرة للعناصر المصممة */}
                        <div className="space-y-1.5 border-t border-border/60 pt-3">
                          <div className="flex items-center justify-between text-[11px] font-semibold text-muted-foreground">
                            <span>معاينة حية للمظهر المؤسسي</span>
                            <span className="font-mono text-primary uppercase">
                              مقاس {standardPaperSize.toUpperCase()}
                            </span>
                          </div>
                          <div className="p-3 rounded-xl border border-border/60 bg-white dark:bg-zinc-950 space-y-2">
                            <div
                              className="p-2 rounded-lg text-xs font-bold flex items-center justify-between"
                              style={{
                                backgroundColor: tokens.accentSoft,
                                color: tokens.accent,
                                border: `1px solid ${tokens.line}`,
                              }}
                            >
                              <span>ترويسة المستند القياسي · INV-2026</span>
                              <span
                                className="text-white text-[10px] px-2 py-0.5 rounded-full"
                                style={{ backgroundColor: tokens.accent }}
                              >
                                معتمد
                              </span>
                            </div>
                            <div
                              className="p-2 rounded-lg text-[11px] text-white font-bold flex items-center justify-between"
                              style={{ backgroundColor: "#1e293b" }}
                            >
                              <span>المبلغ الإجمالي المستحق (Total Due)</span>
                              <span className="text-sky-300 font-mono">12,500 ر.ي</span>
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="flex justify-end pt-3 border-t border-border/40">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setPreviewDocType("customer_invoice");
                            setPreviewTemplateOverride("standard");
                            setPreviewPaperOverride(standardPaperSize);
                            setPreviewOpen(true);
                          }}
                          className="h-8 rounded-xl gap-1.5 text-xs text-primary hover:bg-primary/10 border-primary/40"
                        >
                          <Eye className="h-3.5 w-3.5" />
                          <span>معاينة القالب القياسي ({standardPaperSize.toUpperCase()})</span>
                        </Button>
                      </div>
                    </div>
                  );
                })()}

                {/* 2. القالب التنفيذي الفاخر */}
                {(() => {
                  const currentColor = unified.luxuryAccentColor || DEFAULT_LUXURY_COLOR;
                  const tokens = deriveThemeTokens("luxury", currentColor);

                  return (
                    <div className="rounded-2xl border border-border/80 bg-surface/80 p-5 space-y-4 shadow-xs flex flex-col justify-between">
                      <div className="space-y-4">
                        <div className="flex items-center justify-between gap-3 border-b border-border/60 pb-3">
                          <div className="flex items-center gap-2.5">
                            <div
                              className="w-8 h-8 rounded-xl flex items-center justify-center text-white shadow-xs"
                              style={{ backgroundColor: currentColor }}
                            >
                              <Sparkles className="h-4 w-4" />
                            </div>
                            <div>
                              <h4 className="text-sm font-bold text-foreground">
                                القالب التنفيذي الفاخر (Executive Luxury)
                              </h4>
                              <p className="text-[11px] text-muted-foreground">
                                تصميم راقٍ بهوية كحلية وزرقاء ملكية (A4 / A5)
                              </p>
                            </div>
                          </div>

                          <span
                            className="px-2.5 py-1 rounded-lg text-[11px] font-mono font-bold border"
                            style={{
                              color: currentColor,
                              borderColor: tokens.line,
                              backgroundColor: tokens.accentSoft,
                            }}
                          >
                            {currentColor.toUpperCase()}
                          </span>
                        </div>

                        {/* اختيار حجم الورق للمعاينة */}
                        <div className="flex items-center justify-between p-2 rounded-xl border border-border/60 bg-background/50">
                          <span className="text-xs font-semibold text-muted-foreground">
                            حجم الورق للمعاينة والطباعة:
                          </span>
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => setLuxuryPaperSize("a4")}
                              className={`px-3 py-1 rounded-lg text-xs font-bold transition-all ${
                                luxuryPaperSize === "a4"
                                  ? "bg-primary text-primary-foreground shadow-xs"
                                  : "text-muted-foreground hover:text-foreground"
                              }`}
                            >
                              A4
                            </button>
                            <button
                              type="button"
                              onClick={() => setLuxuryPaperSize("a5")}
                              className={`px-3 py-1 rounded-lg text-xs font-bold transition-all ${
                                luxuryPaperSize === "a5"
                                  ? "bg-primary text-primary-foreground shadow-xs"
                                  : "text-muted-foreground hover:text-foreground"
                              }`}
                            >
                              A5
                            </button>
                          </div>
                        </div>

                        {/* منتقي اللون المباشر */}
                        <div className="space-y-2">
                          <label className="text-xs font-semibold text-muted-foreground flex items-center justify-between">
                            <span>اختيار لون حر (منتقي ألوان فعلي)</span>
                            <span className="text-[10px] text-muted-foreground">
                              اضغط للمنتقي أو أدخل كود HEX
                            </span>
                          </label>
                          <div className="flex items-center gap-3 p-2.5 rounded-xl border border-border/70 bg-background/60">
                            <input
                              type="color"
                              disabled={!canEdit}
                              value={currentColor}
                              onChange={(e) => handleLuxuryColorChange(e.target.value)}
                              className="w-10 h-10 rounded-lg cursor-pointer border-0 p-0 bg-transparent shrink-0"
                            />
                            <input
                              type="text"
                              disabled={!canEdit}
                              value={currentColor}
                              onChange={(e) => {
                                const val = e.target.value;
                                if (/^#[0-9A-Fa-f]{0,6}$/.test(val)) {
                                  handleLuxuryColorChange(val);
                                }
                              }}
                              placeholder="#0f2b5c"
                              className="h-9 flex-1 rounded-lg border border-input bg-background px-3 font-mono text-xs uppercase"
                            />
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              disabled={!canEdit || !unified.luxuryAccentColor}
                              onClick={() => handleLuxuryColorChange(undefined)}
                              className="h-9 px-2 text-xs text-muted-foreground hover:text-foreground"
                            >
                              افتراضي
                            </Button>
                          </div>
                        </div>

                        {/* باليتة الألوان الفاخرة المقترحة (كحلي وأزرق ملكي) */}
                        <div className="space-y-2">
                          <label className="text-xs font-semibold text-muted-foreground block">
                            ألوان كحلية وزرقاء ملكية مقترحة
                          </label>
                          <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                            {LUXURY_COLOR_PALETTE.map((p) => {
                              const isSelected =
                                currentColor.toLowerCase() === p.color.toLowerCase();
                              return (
                                <button
                                  key={p.color}
                                  type="button"
                                  disabled={!canEdit}
                                  onClick={() => handleLuxuryColorChange(p.color)}
                                  title={p.labelAr}
                                  className={`group flex flex-col items-center gap-1.5 p-2 rounded-xl border transition-all ${
                                    isSelected
                                      ? "ring-2 ring-primary border-primary bg-primary/5"
                                      : "border-border/60 hover:border-border bg-background/50 hover:bg-background"
                                  }`}
                                >
                                  <span
                                    className="w-6 h-6 rounded-full shadow-xs flex items-center justify-center text-white"
                                    style={{ backgroundColor: p.color }}
                                  >
                                    {isSelected && <Check className="h-3 w-3" />}
                                  </span>
                                  <span className="text-[10px] text-muted-foreground truncate max-w-full">
                                    {p.labelAr.split(" ")[0]}
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                        </div>

                        {/* شريحة معاينة مصغرة للعناصر المصممة الفاخرة */}
                        <div className="space-y-1.5 border-t border-border/60 pt-3">
                          <div className="flex items-center justify-between text-[11px] font-semibold text-muted-foreground">
                            <span>معاينة حية للمظهر التنفيذي الفاخر</span>
                            <span className="font-mono text-primary uppercase">
                              مقاس {luxuryPaperSize.toUpperCase()}
                            </span>
                          </div>
                          <div className="p-3 rounded-xl border border-border/60 bg-white dark:bg-zinc-950 space-y-2">
                            <div
                              className="p-2 rounded-lg text-xs font-bold flex items-center justify-between"
                              style={{
                                backgroundColor: tokens.accentSoft,
                                color: tokens.accent,
                                border: `1.5px solid ${tokens.line}`,
                              }}
                            >
                              <span>ترويسة المستند التنفيذي · LUX-2026</span>
                              <span
                                className="text-white text-[10px] px-2 py-0.5 rounded-full"
                                style={{ backgroundColor: tokens.accent }}
                              >
                                فاخر
                              </span>
                            </div>
                            <div
                              className="p-2 rounded-lg text-[11px] text-white font-bold flex items-center justify-between"
                              style={{ backgroundColor: tokens.accent }}
                            >
                              <span>الإجمالي النهائي البارز (Grand Total)</span>
                              <span className="font-mono font-black">45,000 ر.ي</span>
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="flex justify-end pt-3 border-t border-border/40">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setPreviewDocType("customer_invoice");
                            setPreviewTemplateOverride("elegant");
                            setPreviewPaperOverride(luxuryPaperSize);
                            setPreviewOpen(true);
                          }}
                          className="h-8 rounded-xl gap-1.5 text-xs text-primary hover:bg-primary/10 border-primary/40"
                        >
                          <Eye className="h-3.5 w-3.5" />
                          <span>معاينة القالب التنفيذي ({luxuryPaperSize.toUpperCase()})</span>
                        </Button>
                      </div>
                    </div>
                  );
                })()}
              </div>
            </div>
          )}

          {/* ═════════════════════════════════════════════════════════════════ */}
          {/* TAB 2: المحرك العام وسلوك الطباعة والأتمتة                         */}
          {/* ═════════════════════════════════════════════════════════════════ */}
          {activeTab === "engine" && (
            <div className="space-y-6">
              {/* General Behavior Card */}
              <div className="rounded-2xl border border-border/80 bg-surface/70 p-5 space-y-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="space-y-1">
                    <h4 className="text-sm font-bold text-foreground">
                      سلوك الطباعة عند إتمام العمليات (Print Behavior)
                    </h4>
                    <p className="text-xs text-muted-foreground">
                      حدد ماذا يفعل النظام فور إنهاء وحفظ الفاتورة في المبيعات، الكاشير، أو
                      المشتريات
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold">تفعيل المعاينة</span>
                    <Switch
                      checked={unified.preview}
                      onCheckedChange={(val) => updateUnified({ preview: val })}
                      disabled={!canEdit}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-2">
                  {[
                    {
                      id: "default" as PrintBehavior,
                      title: "إظهار المعاينة الفاخرة أولاً",
                      desc: "فتح شاشة المعاينة الفخمة لاختيار القالب والطباعة (موصى به)",
                    },
                    {
                      id: "direct" as PrintBehavior,
                      title: "طباعة مباشرة فورية",
                      desc: "إرسال أمر الطباعة فوراً دون شاشة معاينة (لسرعة الكاشير القصوى)",
                    },
                    {
                      id: "off" as PrintBehavior,
                      title: "تعطيل الطباعة التلقائية",
                      desc: "حفظ الفاتورة فقط والطباعة يدويًا عند الطلب",
                    },
                  ].map((b) => (
                    <button
                      key={b.id}
                      type="button"
                      disabled={!canEdit}
                      onClick={() => updateUnified({ behavior: b.id })}
                      className={`flex flex-col text-start p-3.5 rounded-2xl border transition-all ${
                        unified.behavior === b.id
                          ? "border-primary bg-primary/10 shadow-xs ring-1 ring-primary/30"
                          : "border-border/70 hover:border-primary/40 bg-background/60"
                      }`}
                    >
                      <span className="text-xs font-bold text-foreground flex items-center justify-between">
                        <span>{b.title}</span>
                        {unified.behavior === b.id && (
                          <Check className="h-3.5 w-3.5 text-primary" />
                        )}
                      </span>
                      <span className="text-[11px] text-muted-foreground mt-1 leading-relaxed">
                        {b.desc}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Print Method & Copies */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="rounded-2xl border border-border/80 bg-surface/70 p-4 space-y-3">
                  <h4 className="text-sm font-bold text-foreground">
                    طريقة الإخراج (Print Method)
                  </h4>
                  <div className="space-y-2">
                    {[
                      {
                        id: "browser" as PrintMethod,
                        title: "متصفح الويب (Browser Print)",
                        desc: "محرك المتصفح المباشر المتوافق مع كافة الطابعات دون إضافات خارجية",
                      },
                      {
                        id: "thermal" as PrintMethod,
                        title: "طابعات الإيصالات الحرارية (Thermal Engine)",
                        desc: "إرسال المقاسات المحددة بدقة 80mm/58mm مباشرة لرول الورق",
                      },
                      {
                        id: "pdf" as PrintMethod,
                        title: "تصدير رقمي (PDF)",
                        desc: "إنشاء وتحميل ملف PDF بجودة طباعة فيكتور عالية",
                      },
                    ].map((m) => (
                      <label
                        key={m.id}
                        className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition ${
                          unified.method === m.id
                            ? "border-primary bg-primary/5"
                            : "border-border/60 bg-background/50 hover:bg-background"
                        }`}
                      >
                        <input
                          type="radio"
                          name="printMethod"
                          value={m.id}
                          checked={unified.method === m.id}
                          disabled={!canEdit}
                          onChange={() => updateUnified({ method: m.id })}
                          className="mt-1 accent-primary"
                        />
                        <div>
                          <div className="text-xs font-bold text-foreground">{m.title}</div>
                          <div className="text-[11px] text-muted-foreground mt-0.5">{m.desc}</div>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>

                {/* Copies & Multi-Document Automation */}
                <div className="rounded-2xl border border-border/80 bg-surface/70 p-4 space-y-4">
                  <h4 className="text-sm font-bold text-foreground">
                    عدد النسخ والأتمتة المتزامنة
                  </h4>

                  <div className="space-y-2">
                    <label className="text-xs font-semibold text-muted-foreground block">
                      عدد النسخ الافتراضية
                    </label>
                    <div className="flex items-center gap-2">
                      {[1, 2, 3].map((n) => (
                        <Button
                          key={n}
                          type="button"
                          size="sm"
                          variant={unified.copies === n ? "default" : "outline"}
                          disabled={!canEdit}
                          onClick={() => updateUnified({ copies: n })}
                          className="flex-1 rounded-xl text-xs font-bold"
                        >
                          {n} {n === 1 ? "نسخة واحدة" : n === 2 ? "نسختين" : "3 نسخ"}
                        </Button>
                      ))}
                    </div>
                  </div>

                  <div className="border-t border-border/60 pt-3 space-y-2.5">
                    <div className="flex items-center justify-between p-2.5 rounded-xl border border-border/60 bg-background/50">
                      <div>
                        <div className="text-xs font-semibold">طباعة فاتورة العميل تلقائياً</div>
                        <div className="text-[10px] text-muted-foreground">
                          إرسال الفاتورة للطابعة فور اعتماد البيع
                        </div>
                      </div>
                      <Switch
                        checked={settings.autoPrintCustomerInvoice}
                        onCheckedChange={() => handleToggle("autoPrintCustomerInvoice")}
                        disabled={!canEdit}
                      />
                    </div>

                    <div className="flex items-center justify-between p-2.5 rounded-xl border border-border/60 bg-background/50">
                      <div>
                        <div className="text-xs font-semibold">طباعة إذن صرف المخزن بالتوازي</div>
                        <div className="text-[10px] text-muted-foreground">
                          طباعة إذن الصرف الداخلي لأمين المخزن بالتوازي مع فاتورة العميل
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
              </div>

              {/* Architecture & Hardware info banner */}
              <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-4 flex items-start gap-3">
                <div className="p-2 rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 shrink-0">
                  <ShieldCheck className="h-5 w-5" />
                </div>
                <div className="space-y-1">
                  <h5 className="text-xs font-bold text-emerald-800 dark:text-emerald-300">
                    محرك الطباعة المباشر ودعم طابعات الإيصالات ومقاسات A4 و A5
                  </h5>
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    يعتمد نظام فورتيكس على معمارية معيارية ذكية تفصل محتوى الفاتورة عن محرك العرض.
                    يدعم كافة طابعات الإيصالات الحرارية (Epson, Xprinter, Bixolon, Sunmi) وطابعات
                    الليزر والحبر المكتبي دون الحاجة لتثبيت برامج وسيطة.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* ═════════════════════════════════════════════════════════════════ */}
          {/* TAB 3: تخصيص إظهار الحقول وعناصر المستندات                          */}
          {/* ═════════════════════════════════════════════════════════════════ */}
          {activeTab === "fields" && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/70 bg-muted/20 p-3.5">
                <div>
                  <div className="text-xs font-bold text-foreground">
                    تخصيص البيانات الظاهرة في الفواتير
                  </div>
                  <div className="mt-0.5 text-[11px] text-muted-foreground">
                    تسري التغييرات على المعاينة والطباعة بعد حفظها لهذا الجهاز والمستخدم.
                  </div>
                </div>
                <Button
                  type="button"
                  size="sm"
                  onClick={saveAllSettings}
                  disabled={!canEdit || !isDirty || isSaving}
                  className="gap-1.5"
                >
                  <Check className="size-3.5" />
                  {isSaving ? "جارٍ الحفظ..." : "حفظ إعدادات الفاتورة"}
                </Button>
              </div>

              <div className="flex items-center justify-between gap-4 rounded-xl border border-border/70 bg-surface/60 p-3.5">
                <div>
                  <div className="text-xs font-semibold text-foreground">خانات التوقيع والختم</div>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    مخفية افتراضياً. عند تفعيلها تظهر في المعاينة والطباعة وملف PDF.
                  </p>
                </div>
                <Switch
                  checked={unified.showSignatures}
                  onCheckedChange={(checked) => updateUnified({ showSignatures: checked })}
                  disabled={!canEdit}
                  aria-label="إظهار خانات التوقيع والختم"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {(
                  [
                    ["showLogo", "شعار المنشأة (Company Logo)"],
                    ["showCompanyInfo", "بيانات المنشأة والعنوان ورقم الهاتف"],
                    ["showCustomerInfo", "بيانات العميل / المورد"],
                    ["showDocNumberDate", "رقم المستند وتاريخ الإصدار"],
                    ["showMovementInfo", "بيانات المستودع ونوع الحركة"],
                    ["showFinancialDetails", "تفاصيل الضريبة والخصومات"],
                    ["showPaymentInfo", "طريقة السداد والمدفوع والمتبقي"],
                    ["showNotes", "الملاحظات والشروط وسياسة الإرجاع"],
                    ["showFooter", "الهامش السفلي وتذييل الفاتورة"],
                    ["showBarcode", "رمز الباركود للمستند (Barcode)"],
                    ["showQrCode", "رمز الاستجابة السريعة (QR Code)"],
                  ] as [keyof PrintSettings, string][]
                ).map(([key, label]) => (
                  <div
                    key={key}
                    className="flex items-center justify-between p-3.5 rounded-2xl border border-border/70 bg-surface/60 hover:bg-surface transition"
                  >
                    <span className="font-medium text-foreground text-xs pe-2 leading-tight">
                      {label}
                    </span>
                    <Switch
                      checked={settings[key] as boolean}
                      onCheckedChange={() => handleToggle(key)}
                      disabled={!canEdit}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {canEdit && (
        <div className="sticky bottom-4 z-30 flex items-center justify-between gap-3 rounded-2xl border border-primary/30 bg-background/95 px-4 py-3 shadow-xl backdrop-blur">
          <span className="text-xs text-muted-foreground">
            {isDirty ? "لديك تغييرات غير محفوظة في خيارات الطباعة" : "جميع إعدادات الطباعة محفوظة"}
          </span>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={!isDirty || isSaving}
              onClick={() => {
                setSettings(savedSnapshot.settings);
                setUnified(savedSnapshot.unified);
              }}
              className="rounded-xl h-9 text-xs"
            >
              <RotateCcw className="h-3.5 w-3.5 me-1.5" />
              تراجع
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={saveAllSettings}
              disabled={!isDirty || isSaving}
              className="rounded-xl h-9 text-xs font-bold"
            >
              <Check className="h-4 w-4 me-1.5" />
              {isSaving ? "جارٍ الحفظ..." : "حفظ إعدادات الطباعة"}
            </Button>
          </div>
        </div>
      )}

      {/* ── Luxury Live Preview Modal for instant testing ── */}
      <LuxuryPrintPreviewModal
        open={previewOpen}
        onClose={() => {
          setPreviewOpen(false);
          setPreviewTemplateOverride(null);
          setPreviewPaperOverride(null);
        }}
        request={previewRequest}
        doc={sampleDoc}
        documentType={previewDocType}
        title={`معاينة تجريبية: ${
          DEPARTMENTS.find((d) => d.id === previewDocType)?.titleAr || "الفاتورة"
        }`}
      />
    </>
  );
}

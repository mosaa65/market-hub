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
  normalizePrintSettings,
  PRINT_PAPERS,
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

type SettingsTab = "departments" | "engine" | "fields";

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
    titleAr: "قسم كاونتر وخدمات المطحنة",
    descAr: "إيصالات وسندات الطحن الفوري، تذاكر الحجز، وأذونات تسليم النواتج",
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

  function handleToggle(key: keyof PrintSettings) {
    setSettings((current) => ({
      ...current,
      [key]: !current[key],
      ...(key === "autoPrintCustomerInvoice" ? { printMode: !current[key] ? "auto" : "ask" } : {}),
    }));
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
    const templateId = override?.templateId || dept?.defaultTemplate || "thermal-milling";
    const paperId =
      override?.paperId ||
      dept?.defaultPaper ||
      (templateId.startsWith("thermal") ? "thermal-80" : "a4");
    const theme: PrintTheme =
      templateId === "elegant" ? "luxury" : templateId === "formal" ? "formal" : "standard";

    return {
      doc: sampleDoc,
      documentType: previewDocType,
      paperId,
      templateId,
      theme,
      rtl: true,
    };
  }, [sampleDoc, previewDocType, unified.overrides]);

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
          <div className="flex items-center gap-1.5 bg-surface-2 p-1 rounded-2xl border border-border/60 mt-4 w-fit">
            <button
              type="button"
              onClick={() => setActiveTab("departments")}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all ${
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
              onClick={() => setActiveTab("engine")}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all ${
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
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all ${
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
                    الطباعة الحرارية هي طريقة واحدة لها مقاسات (80 مم و 58 مم) وقوالب تصميم (كاونتر
                    المطحنة الأنيق، الكاشير القياسي، باركود و QR). وكذلك طباعة الصفحات تتيح مقاسات
                    (A4 و A5) وقوالب تصميم (كاونتر المطحنة المبسط، قياسي، فاخر، رسمي).
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
                                  ⭐ قالب كاونتر المطحنة الأنيق
                                </option>
                                <option value="thermal">🧾 قالب الكاشير القياسي</option>
                                <option value="thermal-qr">📱 قالب الإيصال مع باركود و QR</option>
                              </>
                            ) : (
                              <>
                                <option value="milling-clean">
                                  ⭐ قالب الكاونتر المبسط والأنيق
                                </option>
                                <option value="standard">📄 قالب مؤسسي قياسي</option>
                                <option value="elegant">✨ قالب تنفيذي فاخر</option>
                                <option value="formal">🏛️ قالب رسمي معتمد وتواقيع</option>
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
                              {(override.copies ?? unified.copies)}{" "}
                              {(override.copies ?? unified.copies) === 1 ? "نسخة واحدة" : (override.copies ?? unified.copies) === 2 ? "نسختين" : "نسخ"}
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
                                onCheckedChange={() => handleDepartmentBarcodeToggle(dept.id, "showBarcode")}
                                disabled={!canEdit}
                              />
                            </div>
                            <div className="flex items-center justify-between p-2 rounded-xl border border-border/60 bg-background/60">
                              <span className="text-xs font-medium">رمز QR الإلكتروني</span>
                              <Switch
                                checked={override.showQrCode ?? unified.showQrCode ?? true}
                                onCheckedChange={() => handleDepartmentBarcodeToggle(dept.id, "showQrCode")}
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
                              ? "كاونتر المطحنة الأنيق"
                              : rawTemplate === "thermal"
                                ? "الكاشير القياسي"
                                : rawTemplate === "thermal-qr"
                                  ? "إيصال باركود وQR"
                                  : rawTemplate === "milling-clean"
                                    ? "الكاونتر المبسط والأنيق"
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
              <div className="rounded-2xl border border-border/70 bg-muted/20 p-3.5">
                <div className="text-xs font-bold text-foreground">
                  تخصيص البيانات الظاهرة في ترويسة وجدول الفواتير
                </div>
                <div className="text-[11px] text-muted-foreground mt-0.5">
                  حدد ما يظهر وما يُخفى في مطبوعات الفواتير والسندات لتقليل الطول أو إبراز التفاصيل
                </div>
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
                    ["showSignatures", "خانات التوقيع والاعتماد والختم"],
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
        <div className="sticky bottom-4 z-30 flex items-center justify-between gap-3 rounded-2xl border-primary/30 bg-background/95 px-4 py-3 shadow-xl backdrop-blur">
          <span className="text-xs text-muted-foreground">
            {isDirty ? "لديك تغييرات غير محفوظة في هذا المكون" : "كل تغييرات الطباعة محفوظة"}
          </span>
          <Button type="button" onClick={saveAllSettings} disabled={!isDirty || isSaving}>
            <Check className="h-4 w-4" />
            {isSaving ? "جارٍ الحفظ..." : "حفظ إعدادات الطباعة"}
          </Button>
        </div>
      )}

      {/* ── Luxury Live Preview Modal for instant testing ── */}
      <LuxuryPrintPreviewModal
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
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

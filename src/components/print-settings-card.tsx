import { useState, useEffect, lazy, Suspense, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Printer, Eye, ScrollText, Layers, Sliders, ShieldCheck, Check } from "lucide-react";
import {
  getPrintSettings,
  savePrintSettings,
  PrintSettings,
  InvoiceTemplateId,
  type PaperProfileId,
  PAPER_PROFILES,
  getTemplateMeta,
} from "@/lib/templates";
import {
  getUnifiedPrintSettings,
  saveUnifiedPrintSettings,
  PRINT_PAPERS,
  PRINT_ADAPTER_META,
  DOCUMENT_TYPES,
  normalizeTheme,
  type PrintBehavior,
  type PrintMethod,
  type PrintingDocumentType,
  type DocumentPrintOverride,
  type PrintPaperId,
  type PrintOrientation,
  type PrintTheme,
} from "@/lib/printing";
const UniversalPrintPreview = lazy(() =>
  import("@/components/universal-print-preview").then((m) => ({
    default: m.UniversalPrintPreview,
  })),
);
import { toast } from "sonner";
import { PRINTING_LABELS } from "@/lib/printing";
import { SAMPLE_CUSTOMER_INVOICE, SAMPLE_INVENTORY_DOC } from "@/lib/printing/samples";

interface PrintSettingsCardProps {
  canEdit?: boolean;
}

export function PrintSettingsCard({ canEdit = true }: PrintSettingsCardProps) {
  const L = PRINTING_LABELS.ar;
  const [settings, setSettings] = useState<PrintSettings>(() => getPrintSettings());
  const [unified, setUnified] = useState(() => getUnifiedPrintSettings());
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewDocType, setPreviewDocType] = useState<PrintingDocumentType>("customer_invoice");
  const [openOverride, setOpenOverride] = useState<string | null>(null);

  useEffect(() => {
    setSettings(getPrintSettings());
  }, []);

  function handleToggle(key: keyof PrintSettings) {
    const updated = savePrintSettings({ [key]: !settings[key] });
    setSettings(updated);
    toast.success("تم تحديث إعدادات الطباعة");
  }

  function updateUnified(patch: Parameters<typeof saveUnifiedPrintSettings>[0], silent = false) {
    const updated = saveUnifiedPrintSettings(patch);
    setUnified(updated);
    if (!silent) toast.success("تم تحديث إعدادات الطباعة الموحدة");
  }

  function updateOverride(docType: PrintingDocumentType, patch: DocumentPrintOverride) {
    const next = { ...unified.overrides, [docType]: { ...unified.overrides[docType], ...patch } };
    // Drop keys explicitly reset to "inherit" so the global default applies again.
    const cleaned = Object.fromEntries(
      Object.entries(next).filter(([, value]) => value && Object.keys(value).length > 0),
    ) as Partial<Record<PrintingDocumentType, DocumentPrintOverride>>;
    updateUnified({ overrides: cleaned }, true);
  }

  function resetOverrides() {
    updateUnified({ overrides: {} });
  }

  function saveProfile(
    documentType: "customer" | "inventory",
    templateId: InvoiceTemplateId,
    paperProfileId: PaperProfileId,
  ) {
    const updated = savePrintSettings(
      documentType === "customer"
        ? { defaultCustomerTemplate: templateId, defaultCustomerPaperProfile: paperProfileId }
        : { defaultInventoryTemplate: templateId, defaultInventoryPaperProfile: paperProfileId },
    );
    setSettings(updated);
    toast.success("تم حفظ إعداد الطباعة الافتراضي");
  }

  const adapter = PRINT_ADAPTER_META[unified.method];
  const sample = useMemo(
    () =>
      previewDocType === "inventory_document" ? SAMPLE_INVENTORY_DOC : SAMPLE_CUSTOMER_INVOICE,
    [previewDocType],
  );

  return (
    <>
      <Card className="lg:col-span-2 rounded-3xl border-primary/20 bg-card shadow-sm overflow-hidden">
        <CardHeader className="bg-muted/30 border-b pb-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle className="text-base font-bold flex items-center gap-2">
              <Printer className="h-5 w-5 text-primary" />
              الطباعة والقوالب
            </CardTitle>
            <Button
              type="button"
              variant="outline"
              onClick={() => setPreviewOpen(true)}
              className="rounded-full gap-1.5 border-primary/40 text-primary hover:bg-primary/10"
            >
              <Eye className="h-4 w-4 me-1" />
              المعاينة الموحدة
            </Button>
          </div>
        </CardHeader>

        <CardContent className="space-y-6 pt-5">
          {/* ── Global defaults ─────────────────────────────────────────── */}
          <div className="rounded-2xl border-primary/20 bg-primary/5 p-4 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h4 className="text-sm font-bold">{L.controlCenter}</h4>
                <p className="text-xs leading-5 text-muted-foreground">
                  {L.controlCenterDescription}
                </p>
              </div>
              <div className="flex items-center gap-2 text-xs font-semibold">
                <span>{L.preview}</span>
                <Switch
                  checked={unified.preview}
                  onCheckedChange={(value) => updateUnified({ preview: value })}
                  disabled={!canEdit}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              <label className="space-y-1.5 text-xs font-semibold">
                <span>{L.behavior}</span>
                <select
                  value={unified.behavior}
                  onChange={(e) => updateUnified({ behavior: e.target.value as PrintBehavior })}
                  disabled={!canEdit}
                  className="h-10 w-full rounded-lg border bg-background px-2 text-sm"
                >
                  <option value="default">{L.default}</option>
                  <option value="ask">{L.ask}</option>
                  <option value="direct">{L.direct}</option>
                  <option value="off">{L.off}</option>
                </select>
                <span className="block font-normal leading-4 text-muted-foreground">
                  {L.behaviorHint[unified.behavior]}
                </span>
              </label>

              <label className="space-y-1.5 text-xs font-semibold">
                <span>{L.method}</span>
                <select
                  value={unified.method}
                  onChange={(e) => updateUnified({ method: e.target.value as PrintMethod })}
                  disabled={!canEdit}
                  className="h-10 w-full rounded-lg border bg-background px-2 text-sm"
                >
                  <option value="browser">{PRINT_ADAPTER_META.browser.nameAr}</option>
                  <option value="thermal">{PRINT_ADAPTER_META.thermal.nameAr}</option>
                  <option value="pdf">{PRINT_ADAPTER_META.pdf.nameAr}</option>
                </select>
                <span className="block font-normal leading-4 text-muted-foreground">
                  {L.methodHint[unified.method]}
                </span>
              </label>

              <label className="space-y-1.5 text-xs font-semibold">
                <span>{L.paperLayout}</span>
                <select
                  value={unified.paperId}
                  onChange={(e) => updateUnified({ paperId: e.target.value as PrintPaperId })}
                  disabled={!canEdit}
                  className="h-10 w-full rounded-lg border bg-background px-2 text-sm"
                >
                  {Object.values(PRINT_PAPERS).map((paper) => (
                    <option key={paper.id} value={paper.id}>
                      {paper.nameAr}
                    </option>
                  ))}
                </select>
                <span className="block font-normal leading-4 text-muted-foreground">
                  {L.paperDescription}
                </span>
              </label>

              <label className="space-y-1.5 text-xs font-semibold">
                <span>{L.orientation}</span>
                <select
                  value={unified.orientation}
                  onChange={(e) =>
                    updateUnified({ orientation: e.target.value as PrintOrientation })
                  }
                  disabled={!canEdit || PRINT_PAPERS[unified.paperId].thermal}
                  className="h-10 w-full rounded-lg border bg-background px-2 text-sm disabled:opacity-60"
                >
                  <option value="portrait">{L.portrait}</option>
                  <option value="landscape">{L.landscape}</option>
                </select>
                <span className="block font-normal leading-4 text-muted-foreground">
                  {PRINT_PAPERS[unified.paperId].thermal ? L.notSupported : L.paperDescription}
                </span>
              </label>

              <label className="space-y-1.5 text-xs font-semibold">
                <span>{L.copies}</span>
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={unified.copies}
                  onChange={(e) => updateUnified({ copies: Number(e.target.value) })}
                  disabled={!canEdit || !adapter.capabilities.supportsCopies}
                  className="h-10 w-full rounded-lg border bg-background px-2 text-sm disabled:opacity-60"
                />
                <span className="block font-normal leading-4 text-muted-foreground">
                  {adapter.capabilities.supportsCopies ? L.copiesDescription : L.notSupported}
                </span>
              </label>

              <div className="space-y-1.5 text-xs font-semibold">
                <span>{L.copies}</span>
                <div className="flex flex-wrap gap-1.5">
                  {[
                    { n: 1, label: L.copiesHint.one },
                    { n: 2, label: L.copiesHint.two },
                    { n: 3, label: L.copiesHint.three },
                  ].map((option) => (
                    <Button
                      key={option.n}
                      type="button"
                      size="sm"
                      variant={unified.copies === option.n ? "default" : "outline"}
                      onClick={() => updateUnified({ copies: option.n })}
                      disabled={!canEdit || !adapter.capabilities.supportsCopies}
                    >
                      {option.label}
                    </Button>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 border-t border-primary/10 pt-3">
              <span className="text-xs font-semibold text-muted-foreground">{L.theme}:</span>
              {(["standard", "luxury", "formal"] as PrintTheme[]).map((theme) => (
                <Button
                  key={theme}
                  type="button"
                  size="sm"
                  variant={normalizeTheme(unified.theme) === theme ? "default" : "outline"}
                  onClick={() => updateUnified({ theme })}
                  disabled={!canEdit}
                >
                  {theme === "formal"
                    ? L.formalCorporate
                    : theme === "luxury"
                      ? L.luxury
                      : L.modern}
                </Button>
              ))}
              <span className="text-xs text-muted-foreground">{L.themeDescription}</span>
            </div>

            {!adapter.capabilities.supportsDirectOutput && (
              <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] leading-5 text-amber-700 dark:text-amber-400">
                {L.directThermalUnavailable}
              </p>
            )}

            {/* حالة نقل ESC/POS — بيان صريح، بلا ادّعاء دعم مباشر. */}
            <div className="rounded-xl border border-border/70 bg-surface/70 p-3 space-y-1.5 text-[11px] leading-5">
              <div className="flex items-center justify-between gap-2">
                <span className="font-bold">{L.transportTitle}</span>
                <span className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 font-semibold text-amber-700 dark:text-amber-400">
                  {L.transportEscposUnavailable}
                </span>
              </div>
              <p className="text-muted-foreground">{L.transportEscposExplanation}</p>
              <p className="text-muted-foreground">{L.transportFallbackNote}</p>
            </div>
          </div>

          {/* ── Thermal formats ─────────────────────────────────────────── */}
          <div className="rounded-2xl border bg-surface/60 p-4 space-y-3">
            <div>
              <h4 className="text-sm font-bold">{L.thermalFormats}</h4>
              <p className="mt-1 text-xs text-muted-foreground">{L.thermalFormatsDescription}</p>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4 text-xs">
              {(["thermal-58", "thermal-80"] as PrintPaperId[]).map((id) => (
                <div key={id} className="rounded-xl border bg-background/70 p-3 space-y-1">
                  <div className="font-bold">{PRINT_PAPERS[id].nameAr}</div>
                  <div className="text-muted-foreground">
                    {L.thermalMargins}: {PRINT_PAPERS[id].marginsMm.top}/
                    {PRINT_PAPERS[id].marginsMm.right}/{PRINT_PAPERS[id].marginsMm.bottom}/
                    {PRINT_PAPERS[id].marginsMm.left}
                  </div>
                  <div className="text-muted-foreground">
                    {L.thermalColumnWidths}: {PRINT_PAPERS[id].widthMm}mm
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant={unified.paperId === id ? "default" : "outline"}
                    className="w-full"
                    onClick={() => updateUnified({ paperId: id, method: "thermal" })}
                    disabled={!canEdit}
                  >
                    {unified.paperId === id ? L.standard : L.print}
                  </Button>
                </div>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground">{L.thermalDividersHint}</p>
          </div>

          {/* ── Per-document overrides ──────────────────────────────────── */}
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h4 className="text-sm font-bold">{L.overridesTitle}</h4>
                <p className="mt-1 text-xs text-muted-foreground">{L.overridesDescription}</p>
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={resetOverrides}
                disabled={!canEdit}
              >
                {L.overridesReset}
              </Button>
            </div>

            <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
              {DOCUMENT_TYPES.map((doc) => {
                const override = unified.overrides[doc.id] ?? {};
                const isOpen = openOverride === doc.id;
                const hasOverride = Object.keys(override).length > 0;
                return (
                  <div key={doc.id} className="rounded-2xl border-border/80 bg-surface/70 p-3">
                    <button
                      type="button"
                      onClick={() => setOpenOverride(isOpen ? null : doc.id)}
                      className="flex w-full items-center justify-between gap-2 text-start"
                    >
                      <span className="flex items-center gap-2">
                        <span className="text-sm font-bold">{doc.nameAr}</span>
                        {hasOverride && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
                            <Check className="h-3 w-3" /> {doc.nameEn}
                          </span>
                        )}
                      </span>
                      <span className="text-[11px] text-muted-foreground">
                        {isOpen ? "▲" : "▼"}
                      </span>
                    </button>

                    {isOpen && (
                      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 text-xs">
                        <label className="space-y-1">
                          <span className="font-semibold">{L.behavior}</span>
                          <select
                            value={override.behavior ?? ""}
                            disabled={!canEdit}
                            onChange={(e) =>
                              updateOverride(doc.id, {
                                behavior: (e.target.value || undefined) as
                                  PrintBehavior | undefined,
                              })
                            }
                            className="h-9 w-full rounded-lg border bg-background px-2"
                          >
                            <option value="">{L.overrideInherit}</option>
                            <option value="ask">{L.ask}</option>
                            <option value="direct">{L.direct}</option>
                            <option value="off">{L.off}</option>
                          </select>
                        </label>

                        <label className="space-y-1">
                          <span className="font-semibold">{L.method}</span>
                          <select
                            value={override.method ?? ""}
                            disabled={!canEdit}
                            onChange={(e) =>
                              updateOverride(doc.id, {
                                method: (e.target.value || undefined) as PrintMethod | undefined,
                              })
                            }
                            className="h-9 w-full rounded-lg border bg-background px-2"
                          >
                            <option value="">{L.overrideInherit}</option>
                            <option value="browser">{PRINT_ADAPTER_META.browser.nameAr}</option>
                            <option value="thermal">{PRINT_ADAPTER_META.thermal.nameAr}</option>
                            <option value="pdf">{PRINT_ADAPTER_META.pdf.nameAr}</option>
                          </select>
                        </label>

                        <label className="space-y-1">
                          <span className="font-semibold">{L.theme}</span>
                          <select
                            value={override.theme ?? ""}
                            disabled={!canEdit}
                            onChange={(e) =>
                              updateOverride(doc.id, {
                                theme: (e.target.value || undefined) as PrintTheme | undefined,
                              })
                            }
                            className="h-9 w-full rounded-lg border bg-background px-2"
                          >
                            <option value="">{L.overrideInherit}</option>
                            <option value="standard">{L.standard}</option>
                            <option value="luxury">{L.luxury}</option>
                            <option value="formal">{L.formalCorporate}</option>
                          </select>
                        </label>

                        <label className="space-y-1">
                          <span className="font-semibold">{L.paper}</span>
                          <select
                            value={override.paperId ?? ""}
                            disabled={!canEdit}
                            onChange={(e) =>
                              updateOverride(doc.id, {
                                paperId: (e.target.value || undefined) as PrintPaperId | undefined,
                              })
                            }
                            className="h-9 w-full rounded-lg border bg-background px-2"
                          >
                            <option value="">{L.overrideInherit}</option>
                            {Object.values(PRINT_PAPERS).map((paper) => (
                              <option key={paper.id} value={paper.id}>
                                {paper.nameAr}
                              </option>
                            ))}
                          </select>
                        </label>

                        <label className="space-y-1">
                          <span className="font-semibold">{L.orientation}</span>
                          <select
                            value={override.orientation ?? ""}
                            disabled={!canEdit}
                            onChange={(e) =>
                              updateOverride(doc.id, {
                                orientation: (e.target.value || undefined) as
                                  PrintOrientation | undefined,
                              })
                            }
                            className="h-9 w-full rounded-lg border bg-background px-2"
                          >
                            <option value="">{L.overrideInherit}</option>
                            <option value="portrait">{L.portrait}</option>
                            <option value="landscape">{L.landscape}</option>
                          </select>
                        </label>

                        <label className="space-y-1">
                          <span className="font-semibold">{L.copies}</span>
                          <input
                            type="number"
                            min={1}
                            max={20}
                            value={override.copies ?? ""}
                            disabled={!canEdit}
                            placeholder={L.overrideInherit}
                            onChange={(e) =>
                              updateOverride(doc.id, {
                                copies: e.target.value ? Number(e.target.value) : undefined,
                              })
                            }
                            className="h-9 w-full rounded-lg border bg-background px-2"
                          />
                        </label>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* ── Field visibility ────────────────────────────────────────── */}
          <div className="pt-2 border-t">
            <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-1.5">
              <Sliders className="h-4 w-4 text-primary" />
              تخصيص إظهار وإخفاء عناصر المستندات
            </h4>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 text-xs">
              {(
                [
                  ["showLogo", "شعار المنشأة"],
                  ["showCompanyInfo", "بيانات المنشأة"],
                  ["showCustomerInfo", "بيانات العميل"],
                  ["showDocNumberDate", "رقم المستند والتاريخ"],
                  ["showMovementInfo", "بيانات الحركة والمستودع"],
                  ["showFinancialDetails", "الضريبة والخصم"],
                  ["showPaymentInfo", "طريقة الدفع والمدفوع"],
                  ["showChange", "إظهار الباقي في الفواتير"],
                  ["showNotes", "الملاحظات والشروط"],
                  ["showSignatures", "خانات التوقيعات"],
                  ["showFooter", "الهامش السفلي Footer"],
                ] as [keyof PrintSettings, string][]
              ).map(([key, label]) => (
                <ToggleOption
                  key={key}
                  label={label}
                  checked={settings[key] as boolean}
                  onChange={() => handleToggle(key)}
                  disabled={!canEdit}
                />
              ))}
            </div>
          </div>

          {/* ── Legacy per-profile defaults ─────────────────────────────── */}
          <div className="space-y-3 pt-2 border-t">
            <h4 className="text-sm font-bold flex items-center gap-2">
              <ScrollText className="h-4 w-4 text-primary" />
              إعدادات القالب الافتراضي
            </h4>
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
              <PrintProfileCard
                documentType="customer_invoice"
                title="فاتورة المبيعات"
                description="الفاتورة التي يستلمها العميل"
                templateId={settings.defaultCustomerTemplate}
                paperProfileId={settings.defaultCustomerPaperProfile ?? "thermal-80"}
                canEdit={canEdit}
                onSave={(templateId, paperProfileId) =>
                  saveProfile("customer", templateId, paperProfileId)
                }
                onPreview={() => {
                  setPreviewDocType("customer_invoice");
                  setPreviewOpen(true);
                }}
              />
              <PrintProfileCard
                documentType="inventory_document"
                title="مستند حركة المخزون"
                description="مستند الصرف والاستلام والتحويل الداخلي"
                templateId={settings.defaultInventoryTemplate}
                paperProfileId={settings.defaultInventoryPaperProfile ?? "thermal-80"}
                canEdit={canEdit}
                onSave={(templateId, paperProfileId) =>
                  saveProfile("inventory", templateId, paperProfileId)
                }
                onPreview={() => {
                  setPreviewDocType("inventory_document");
                  setPreviewOpen(true);
                }}
              />
            </div>
          </div>

          {/* ── Multi-document automation ───────────────────────────────── */}
          <div className="pt-2 border-t">
            <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-1.5">
              <Layers className="h-4 w-4 text-primary" />
              الطباعة المتعددة التلقائية بعد إنهاء البيع
            </h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="flex items-center justify-between p-3.5 rounded-2xl border bg-surface/80">
                <div className="space-y-0.5 pe-3">
                  <div className="text-sm font-semibold">طباعة فاتورة العميل تلقائياً</div>
                  <div className="text-xs text-muted-foreground">
                    إرسال فاتورة العميل إلى المحرك فور اعتماد العملية.
                  </div>
                </div>
                <Switch
                  checked={settings.autoPrintCustomerInvoice}
                  onCheckedChange={() => handleToggle("autoPrintCustomerInvoice")}
                  disabled={!canEdit}
                />
              </div>

              <div className="flex items-center justify-between p-3.5 rounded-2xl border bg-surface/80">
                <div className="space-y-0.5 pe-3">
                  <div className="text-sm font-semibold">طباعة مستند المخزون تلقائياً</div>
                  <div className="text-xs text-muted-foreground">
                    طباعة مستند إذن الصرف المخزني الداخلي بالتوازي مع الفاتورة.
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

          {/* ── Adapter overview ────────────────────────────────────────── */}
          <div className="pt-2 border-t">
            <div className="p-4 rounded-2xl border border-emerald-500/20 bg-emerald-500/5 dark:bg-emerald-500/10 space-y-2">
              <div className="flex items-center gap-2 text-sm font-bold text-emerald-700 dark:text-emerald-400">
                <ShieldCheck className="h-4 w-4" />
                محرك الطباعة المباشر ودعم طابعات الـ Thermal و A4
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">
                يدعم النظام طباعة الفواتير عبر متصفح الويب (Browser Print Engine) دون الحاجة لإضافات
                معقدة. كما أُعدت معمارية النظام (Print Adapters) لتكون جاهزة للتكامل المباشر مع
                خدمات الطباعة المحلية مثل <b>QZ Tray</b> أو برامج الـ Desktop Wrappers للطابعات
                الحرارية الشبكية والمباشرة USB.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Suspense fallback={null}>
        {previewOpen && (
          <UniversalPrintPreview
            open={previewOpen}
            onOpenChange={setPreviewOpen}
            request={{
              doc: sample,
              documentType: previewDocType,
              settings: unified,
              templateId: settings.defaultCustomerTemplate,
              rtl: true,
            }}
            title={PRINTING_LABELS.ar.preview}
          />
        )}
      </Suspense>
    </>
  );
}

function ToggleOption({
  label,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  checked?: boolean;
  onChange: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center justify-between p-2.5 rounded-xl border bg-surface/60 hover:bg-surface transition">
      <span className="font-medium text-foreground text-[11.5px] pe-2">{label}</span>
      <Switch
        checked={!!checked}
        onCheckedChange={onChange}
        disabled={disabled}
        className="scale-90"
      />
    </div>
  );
}

interface PrintProfileCardProps {
  documentType: "customer_invoice" | "inventory_document";
  title: string;
  description: string;
  templateId: InvoiceTemplateId;
  paperProfileId: PaperProfileId;
  canEdit: boolean;
  onSave: (templateId: InvoiceTemplateId, paperProfileId: PaperProfileId) => void;
  onPreview: () => void;
}

function PrintProfileCard({
  documentType,
  title,
  description,
  templateId: initialTemplateId,
  paperProfileId: initialPaperProfileId,
  canEdit,
  onSave,
  onPreview,
}: PrintProfileCardProps) {
  const [templateId, setTemplateId] = useState<InvoiceTemplateId>(initialTemplateId);
  const [paperProfileId, setPaperProfileId] = useState<PaperProfileId>(initialPaperProfileId);
  const templateMeta = getTemplateMeta(templateId);
  const supportedPapers = templateMeta?.supportedPaperProfiles ?? [];
  const templates = (
    ["thermal", "standard", "elegant", "formal", "milling-master", "milling-thermal"] as InvoiceTemplateId[]
  ).filter((id) => {
    const meta = getTemplateMeta(id);
    return meta && (!meta.supportedDocTypes || meta.supportedDocTypes.includes(documentType));
  });
  const isDirty = templateId !== initialTemplateId || paperProfileId !== initialPaperProfileId;
  const selectedPaper = supportedPapers.includes(paperProfileId)
    ? paperProfileId
    : supportedPapers[0];

  function handleTemplateChange(nextTemplateId: InvoiceTemplateId) {
    setTemplateId(nextTemplateId);
    const nextPapers = getTemplateMeta(nextTemplateId)?.supportedPaperProfiles ?? [];
    if (!nextPapers.includes(paperProfileId)) {
      setPaperProfileId(nextPapers[0]);
    }
  }

  return (
    <div className="rounded-2xl border-border/80 bg-surface/70 p-4 shadow-xs transition hover:border-primary/30 hover:shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h5 className="text-sm font-bold truncate">{title}</h5>
            <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
              <Check className="h-3 w-3" /> الافتراضي
            </span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{description}</p>
        </div>
        <div className="rounded-xl bg-primary/10 p-2 text-primary shrink-0">
          <Printer className="h-4 w-4" />
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="space-y-1.5 text-xs font-semibold">
          <span className="text-muted-foreground">القالب</span>
          <select
            value={templateId}
            disabled={!canEdit}
            onChange={(event) => handleTemplateChange(event.target.value)}
            className="h-10 w-full rounded-xl border-border bg-background px-3 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:opacity-60"
          >
            {templates.map((id) => {
              const meta = getTemplateMeta(id)!;
              return (
                <option key={id} value={id}>
                  {meta.nameAr}
                </option>
              );
            })}
          </select>
        </label>
        <label className="space-y-1.5 text-xs font-semibold">
          <span className="text-muted-foreground">Paper Profile</span>
          <select
            value={selectedPaper}
            disabled={!canEdit}
            onChange={(event) => setPaperProfileId(event.target.value as PaperProfileId)}
            className="h-10 w-full rounded-xl border-border bg-background px-3 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:opacity-60"
          >
            {supportedPapers.map((id) => {
              const paper = PAPER_PROFILES[id];
              return (
                <option key={id} value={id}>
                  {paper.nameAr}
                </option>
              );
            })}
          </select>
        </label>
      </div>

      <div className="mt-3 flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-3">
        <span className="text-[11px] text-muted-foreground">
          {templateMeta?.nameAr} · {PAPER_PROFILES[selectedPaper]?.nameAr}
        </span>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onPreview}
            className="h-8 rounded-lg gap-1.5 text-xs"
          >
            <Eye className="h-3.5 w-3.5" /> معاينة
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={!canEdit || !isDirty || !selectedPaper}
            onClick={() => selectedPaper && onSave(templateId, selectedPaper)}
            className="h-8 rounded-lg gap-1.5 text-xs"
          >
            <Check className="h-3.5 w-3.5" /> حفظ
          </Button>
        </div>
      </div>
    </div>
  );
}

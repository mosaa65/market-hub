/**
 * StatementSettingsCard — بطاقة «تخصيص الكشوف» داخل الإعدادات
 *
 * تُعيد استخدام مكوّنات صفحة الإعدادات الموجودة (Card, Switch, Input, Label)
 * ونفس نمط بطاقة catalog-modules.
 *
 * ⚠️ لا تُنشئ أي Schema: الإعدادات تُحفظ في localStorage وتُزامَن داخل
 * عمود company_settings.catalog_modules الموجود (jsonb حر).
 *
 * قرار المستخدم #3: استخدام catalog_modules كحاوية — نعم.
 */

import { useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Eye,
  EyeOff,
  FileText,
  RotateCcw,
  SlidersHorizontal,
  Type,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n";
import {
  DEFAULT_FIELD_LABELS,
  resetStatementSettings,
  useStatementSettings,
} from "@/lib/statements/settings";
import { TEMPLATE_ORDER, templateLabel } from "@/lib/statements/templates";
import type { StatementTemplateId } from "@/lib/statements/types";
import { cn } from "@/lib/utils";

interface StatementSettingsCardProps {
  canEdit: boolean;
}

export function StatementSettingsCard({ canEdit }: StatementSettingsCardProps) {
  const { lang } = useI18n();
  const ar = lang === "ar";
  const { settings, update, setFieldLabel, setFieldVisible, moveField } = useStatementSettings();
  const [advancedOpen, setAdvancedOpen] = useState(false);

  function handleReset() {
    resetStatementSettings();
    toast.success(ar ? "تمت استعادة الإعدادات الافتراضية" : "Defaults restored");
  }

  return (
    <Card className="lg:col-span-2 rounded-3xl border-primary/25 bg-gradient-to-r from-primary/5 via-surface to-surface">
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base">
          <span className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-primary" />
            {ar ? "تخصيص الكشوف والتقارير الحسابية" : "Statement & Report Customization"}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={handleReset}
            disabled={!canEdit}
            className="gap-1.5 rounded-full text-xs"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            {ar ? "استعادة الافتراضي" : "Reset"}
          </Button>
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          {ar
            ? "تحكم في أسماء الحقول وإظهارها وترتيبها، واسم الكشف، وخيارات الرأس والتذييل — تُطبَّق على كل الكشوف فورًا."
            : "Control field labels, visibility and order, report titles, header and footer options — applied instantly to all statements."}
        </p>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* ── 1 · القالب الافتراضي ── */}
        <section className="space-y-2">
          <SectionTitle icon={SlidersHorizontal}>
            {ar ? "القالب الافتراضي" : "Default template"}
          </SectionTitle>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label className="text-[11px] text-muted-foreground">
                {ar ? "القالب المستخدم عند الإنشاء" : "Template used on generate"}
              </Label>
              <Select
                value={settings.defaultTemplate}
                onValueChange={(v) => update({ defaultTemplate: v as StatementTemplateId })}
                disabled={!canEdit}
              >
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TEMPLATE_ORDER.map((id) => (
                    <SelectItem key={id} value={id}>
                      {templateLabel(id, lang)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center justify-between rounded-2xl border border-border/80 bg-surface/70 px-3.5 py-2.5">
              <div className="space-y-0.5 pe-3">
                <div className="text-xs font-medium">
                  {ar ? "إظهار الفواتير المسددة كليًا" : "Include settled invoices"}
                </div>
                <div className="text-[10px] text-muted-foreground">
                  {ar ? "القيمة الافتراضية عند إنشاء كشف" : "Default when generating"}
                </div>
              </div>
              <Switch
                checked={settings.includeZeroRowsDefault}
                onCheckedChange={(v) => update({ includeZeroRowsDefault: v })}
                disabled={!canEdit}
              />
            </div>
          </div>
        </section>

        {/* ── 2 · الحقول: الاسم + الإظهار + الترتيب ── */}
        <section className="space-y-2">
          <SectionTitle icon={Type}>
            {ar ? "أسماء الحقول وإظهارها وترتيبها" : "Field labels, visibility and order"}
          </SectionTitle>

          <div className="space-y-1.5">
            {settings.fields.map((field, index) => {
              const defaultLabel = DEFAULT_FIELD_LABELS[field.key][lang];
              return (
                <div
                  key={field.key}
                  className={cn(
                    "flex flex-wrap items-center gap-2 rounded-2xl border px-3 py-2 transition-colors",
                    field.visible
                      ? "border-border/80 bg-surface/70"
                      : "border-dashed border-border/60 bg-surface-2/40 opacity-70",
                  )}
                >
                  {/* ترتيب */}
                  <div className="flex items-center gap-0.5">
                    <button
                      type="button"
                      disabled={!canEdit || index === 0}
                      onClick={() => moveField(field.key, -1)}
                      className="rounded p-1 text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground disabled:opacity-30"
                      aria-label={ar ? "تحريك لأعلى" : "Move up"}
                    >
                      <ArrowUp className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      disabled={!canEdit || index === settings.fields.length - 1}
                      onClick={() => moveField(field.key, 1)}
                      className="rounded p-1 text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground disabled:opacity-30"
                      aria-label={ar ? "تحريك لأسفل" : "Move down"}
                    >
                      <ArrowDown className="h-3.5 w-3.5" />
                    </button>
                  </div>

                  {/* المعرّف الداخلي */}
                  <code className="shrink-0 rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                    {field.key}
                  </code>

                  {/* الاسم المخصص */}
                  <Input
                    value={field.label}
                    onChange={(e) => setFieldLabel(field.key, e.target.value)}
                    placeholder={defaultLabel}
                    disabled={!canEdit || !field.visible}
                    className="h-8 min-w-[140px] flex-1 text-xs"
                  />

                  {/* الإظهار */}
                  <button
                    type="button"
                    disabled={!canEdit}
                    onClick={() => setFieldVisible(field.key, !field.visible)}
                    className={cn(
                      "flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-medium transition-colors disabled:opacity-50",
                      field.visible
                        ? "border-primary/35 bg-primary/10 text-primary"
                        : "border-border/80 text-muted-foreground hover:bg-surface-2",
                    )}
                  >
                    {field.visible ? (
                      <>
                        <Eye className="h-3 w-3" />
                        {ar ? "ظاهر" : "Visible"}
                      </>
                    ) : (
                      <>
                        <EyeOff className="h-3 w-3" />
                        {ar ? "مخفي" : "Hidden"}
                      </>
                    )}
                  </button>
                </div>
              );
            })}
          </div>

          <p className="text-[11px] text-muted-foreground">
            {ar
              ? "اترك الاسم فارغًا لاستخدام التسمية الافتراضية. الأعمدة المالية (مدين · دائن · رصيد) تُعرض دائمًا حتى لو أُخفيت — لضمان سلامة الكشف محاسبيًا."
              : "Leave a label empty to use the default. Financial columns (debit · credit · balance) always render for accounting integrity."}
          </p>
        </section>

        {/* ── 3 · اسم الكشف ── */}
        <section className="space-y-2">
          <SectionTitle icon={FileText}>{ar ? "أسماء الكشوف" : "Report titles"}</SectionTitle>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <FieldInput
              label={ar ? "كشف حساب عميل" : "Customer statement"}
              value={settings.reportTitles.customer}
              onChange={(v) => update({ reportTitles: { ...settings.reportTitles, customer: v } })}
              disabled={!canEdit}
            />
            <FieldInput
              label={ar ? "كشف حساب مورد" : "Supplier statement"}
              value={settings.reportTitles.supplier}
              onChange={(v) => update({ reportTitles: { ...settings.reportTitles, supplier: v } })}
              disabled={!canEdit}
            />
            <FieldInput
              label={ar ? "كشف الخزينة" : "Treasury statement"}
              value={settings.reportTitles.cash}
              onChange={(v) => update({ reportTitles: { ...settings.reportTitles, cash: v } })}
              disabled={!canEdit}
            />
            <FieldInput
              label={ar ? "كشف الديون" : "Debts statement"}
              value={settings.reportTitles.debts}
              onChange={(v) => update({ reportTitles: { ...settings.reportTitles, debts: v } })}
              disabled={!canEdit}
            />
            <FieldInput
              label={ar ? "كشف أعمار الديون" : "Aging statement"}
              value={settings.reportTitles.aging}
              onChange={(v) => update({ reportTitles: { ...settings.reportTitles, aging: v } })}
              disabled={!canEdit}
            />
            <FieldInput
              label={ar ? "رمز العملة (تجاوز)" : "Currency symbol (override)"}
              value={settings.currencySymbolOverride}
              onChange={(v) => update({ currencySymbolOverride: v })}
              disabled={!canEdit}
              placeholder={ar ? "يُقرأ من إعدادات المنشأة" : "From company settings"}
            />
          </div>
        </section>

        {/* ── 4 · الرأس والتذييل ── */}
        <section className="space-y-2">
          <SectionTitle icon={SlidersHorizontal}>
            {ar ? "الرأس والتذييل" : "Header & footer"}
          </SectionTitle>

          <div className="grid gap-2 sm:grid-cols-2">
            <ToggleRow
              label={ar ? "إظهار الشعار" : "Show logo"}
              hint={ar ? "شعار المنشأة أو شعار Inama Soft" : "Company or Inama Soft logo"}
              checked={settings.header.showLogo}
              onChange={(v) => update({ header: { ...settings.header, showLogo: v } })}
              disabled={!canEdit}
            />
            <ToggleRow
              label={ar ? "إظهار الاسم القانوني" : "Show legal name"}
              checked={settings.header.showLegalName}
              onChange={(v) => update({ header: { ...settings.header, showLegalName: v } })}
              disabled={!canEdit}
            />
            <ToggleRow
              label={ar ? "إظهار الرقم الضريبي" : "Show tax number"}
              checked={settings.header.showTaxNumber}
              onChange={(v) => update({ header: { ...settings.header, showTaxNumber: v } })}
              disabled={!canEdit}
            />
            <ToggleRow
              label={ar ? "إظهار العنوان" : "Show address"}
              checked={settings.header.showAddress}
              onChange={(v) => update({ header: { ...settings.header, showAddress: v } })}
              disabled={!canEdit}
            />
            <ToggleRow
              label={ar ? "إظهار الهاتف" : "Show phone"}
              checked={settings.header.showPhone}
              onChange={(v) => update({ header: { ...settings.header, showPhone: v } })}
              disabled={!canEdit}
            />
            <ToggleRow
              label={ar ? "إظهار الإجماليات" : "Show totals row"}
              checked={settings.footer.showTotals}
              onChange={(v) => update({ footer: { ...settings.footer, showTotals: v } })}
              disabled={!canEdit}
            />
            <ToggleRow
              label={ar ? "إظهار الرصيد الختامي" : "Show closing balance"}
              checked={settings.footer.showClosingBalance}
              onChange={(v) => update({ footer: { ...settings.footer, showClosingBalance: v } })}
              disabled={!canEdit}
            />
            <ToggleRow
              label={ar ? "إظهار التوقيعات" : "Show signatures"}
              hint={ar ? "المراجع · المحاسب · المدير العام" : "Auditor · Accountant · GM"}
              checked={settings.footer.showSignatures}
              onChange={(v) => update({ footer: { ...settings.footer, showSignatures: v } })}
              disabled={!canEdit}
            />
            <ToggleRow
              label={ar ? "إظهار خانة الملاحظات" : "Show notes box"}
              checked={settings.footer.showNotes}
              onChange={(v) => update({ footer: { ...settings.footer, showNotes: v } })}
              disabled={!canEdit}
            />
            <ToggleRow
              label={ar ? "إظهار هوية Inama Soft" : "Show Inama Soft branding"}
              hint={ar ? "في تذييل الكشف المطبوع" : "In the printed statement footer"}
              checked={settings.footer.showBrandFooter}
              onChange={(v) => update({ footer: { ...settings.footer, showBrandFooter: v } })}
              disabled={!canEdit}
            />
          </div>

          <button
            type="button"
            onClick={() => setAdvancedOpen((v) => !v)}
            className="text-[11px] font-medium text-primary hover:underline"
          >
            {advancedOpen
              ? ar
                ? "إخفاء النصوص المتقدمة"
                : "Hide advanced texts"
              : ar
                ? "تحرير النصوص المتقدمة"
                : "Edit advanced texts"}
          </button>

          {advancedOpen && (
            <div className="grid gap-3 pt-1 sm:grid-cols-2">
              <FieldInput
                label={ar ? "سطر إضافي في الرأس" : "Extra header line"}
                value={settings.header.customLine}
                onChange={(v) => update({ header: { ...settings.header, customLine: v } })}
                disabled={!canEdit}
                placeholder={ar ? "مثال: سجل تجاري 12345" : "e.g. CR 12345"}
              />
              <FieldInput
                label={ar ? "نص الملاحظات الافتراضي" : "Default notes text"}
                value={settings.footer.notesText}
                onChange={(v) => update({ footer: { ...settings.footer, notesText: v } })}
                disabled={!canEdit}
              />
              <div className="sm:col-span-2">
                <FieldInput
                  label={ar ? "نص التذييل" : "Footer note"}
                  value={settings.footer.footerNote}
                  onChange={(v) => update({ footer: { ...settings.footer, footerNote: v } })}
                  disabled={!canEdit}
                />
              </div>
            </div>
          )}
        </section>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------

function SectionTitle({
  children,
  icon: Icon,
}: {
  children: React.ReactNode;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
      <Icon className="h-3.5 w-3.5 text-primary" />
      {children}
    </div>
  );
}

function FieldInput({
  label,
  value,
  onChange,
  disabled,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  return (
    <div className="grid gap-1.5">
      <Label className="text-[11px] text-muted-foreground">{label}</Label>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        placeholder={placeholder}
        className="h-9 text-xs"
      />
    </div>
  );
}

function ToggleRow({
  label,
  hint,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl border border-border/80 bg-surface/70 px-3.5 py-2.5">
      <div className="min-w-0 space-y-0.5">
        <div className="text-xs font-medium">{label}</div>
        {hint && <div className="text-[10px] text-muted-foreground">{hint}</div>}
      </div>
      <Switch checked={checked} onCheckedChange={onChange} disabled={disabled} />
    </div>
  );
}

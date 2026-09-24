/**
 * /account-statement — منشئ الكشف (Statement Builder)
 *
 * ⚠️ هذه الشاشة لم تعد تحسب أي رصيد. وظيفتها الوحيدة:
 *   اختيار نوع الكشف + الجهة + الفترة + الخيارات، ثم الانتقال مباشرة
 *   إلى المستند النهائي /statements/$entityType/$entityId.
 *
 * لا شاشة معاينة وسيطة، ولا منطق محاسبي داخل هذه الصفحة (Phase 8 في الخطة).
 * كل الأرقام تأتي من Statement Engine عبر مستند الكشف النهائي.
 */

import { ModuleGuard } from "@/lib/modules";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { z } from "zod";
import {
  AlertTriangle,
  Building2,
  Calendar,
  FileText,
  Loader2,
  Search,
  Sparkles,
  UserCheck,
  Wallet,
} from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { useI18n } from "@/lib/i18n";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useStatementSettings } from "@/lib/statements/settings";
import { TEMPLATE_ORDER, templateLabel } from "@/lib/statements/templates";
import { CASH_ENTITY_ID } from "@/lib/statements/adapters/cash";
import type { StatementEntityType, StatementTemplateId } from "@/lib/statements/types";
import { cn } from "@/lib/utils";

const accountStatementSearchSchema = z.object({
  customerId: z.string().optional(),
  entityType: z.string().optional(),
  entityId: z.string().optional(),
});

export const Route = createFileRoute("/_app/account-statement")({
  validateSearch: (search: Record<string, unknown>) => accountStatementSearchSchema.parse(search),
  head: () => ({ meta: [{ title: "كشف حساب — Market Hub" }] }),
  component: () => (
    <ModuleGuard moduleId="payments">
      <StatementBuilderPage />
    </ModuleGuard>
  ),
});

interface PartyOption {
  id: string;
  name: string;
  phone?: string | null;
  balance?: number;
}

/** نطاقات جاهزة — تُبنى محليًا بلا أي استعلام */
function presetRanges() {
  const today = new Date();
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  const startOfYear = new Date(today.getFullYear(), 0, 1);
  const daysAgo = (n: number) => {
    const d = new Date(today);
    d.setDate(d.getDate() - n);
    return d;
  };
  return [
    { key: "all", labelAr: "كل الفترات", labelEn: "All periods", from: null, to: null },
    {
      key: "m30",
      labelAr: "آخر 30 يومًا",
      labelEn: "Last 30 days",
      from: iso(daysAgo(30)),
      to: iso(today),
    },
    {
      key: "m90",
      labelAr: "آخر 90 يومًا",
      labelEn: "Last 90 days",
      from: iso(daysAgo(90)),
      to: iso(today),
    },
    {
      key: "ytd",
      labelAr: "منذ بداية السنة",
      labelEn: "Year to date",
      from: iso(startOfYear),
      to: iso(today),
    },
    {
      key: "month",
      labelAr: "هذا الشهر",
      labelEn: "This month",
      from: iso(startOfMonth),
      to: iso(today),
    },
  ];
}

function StatementBuilderPage() {
  const { t, lang } = useI18n();
  const ar = lang === "ar";
  const navigate = useNavigate();
  const searchParams = Route.useSearch();
  const { settings } = useStatementSettings();

  const [entityType, setEntityType] = useState<StatementEntityType>(
    (searchParams.entityType as StatementEntityType) || "customer",
  );
  const [entityId, setEntityId] = useState<string>(searchParams.entityId ?? "");
  const [partyList, setPartyList] = useState<PartyOption[]>([]);
  const [partySearch, setPartySearch] = useState("");
  const [loadingParties, setLoadingParties] = useState(false);

  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");
  const [activePreset, setActivePreset] = useState<string>("all");
  const [includeZero, setIncludeZero] = useState<boolean>(settings.includeZeroRowsDefault);
  const [templateId, setTemplateId] = useState<StatementTemplateId>(settings.defaultTemplate);

  // جلب الجهات بحسب النوع — استعلام واحد فقط عند تبديل النوع
  useEffect(() => {
    let cancelled = false;

    async function loadParties() {
      if (entityType === "cash") {
        setPartyList([]);
        setEntityId(CASH_ENTITY_ID);
        return;
      }

      setLoadingParties(true);
      setEntityId("");
      const table = entityType === "customer" ? "customers" : "suppliers";
      const { data } = await supabase
        .from(table)
        .select("id, name, phone, balance")
        .eq("is_active", true)
        .order("name");

      if (cancelled) return;
      const list = (data ?? []) as PartyOption[];
      setPartyList(list);
      setLoadingParties(false);

      // احترام الـ deep-link القادم من شاشات العملاء/الديون/الدفعات
      const deepLink =
        entityType === "customer"
          ? (searchParams.customerId ?? searchParams.entityId)
          : searchParams.entityId;
      if (deepLink && list.some((p) => p.id === deepLink)) {
        setEntityId(deepLink);
      } else if (list.length > 0) {
        setEntityId(list[0].id);
      }
    }

    void loadParties();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityType]);

  const filteredParties = useMemo(() => {
    const q = partySearch.trim().toLowerCase();
    if (!q) return partyList;
    return partyList.filter((p) => p.name.toLowerCase().includes(q) || (p.phone ?? "").includes(q));
  }, [partyList, partySearch]);

  const selectedParty = partyList.find((p) => p.id === entityId) ?? null;
  const canGenerate =
    !loadingParties && Boolean(entityId) && (entityType === "cash" || Boolean(selectedParty));

  function applyPreset(key: string) {
    setActivePreset(key);
    const preset = presetRanges().find((p) => p.key === key);
    if (!preset) return;
    setFrom(preset.from ?? "");
    setTo(preset.to ?? "");
  }

  /**
   * الانتقال المباشر إلى مستند الكشف النهائي.
   * لا شاشة معاينة وسيطة — هذا هو جوهر Phase 8 من الخطة.
   */
  function handleGenerate() {
    if (!canGenerate) return;
    void navigate({
      to: "/statements/$entityType/$entityId",
      params: { entityType, entityId },
      search: {
        from: from || undefined,
        to: to || undefined,
        template: templateId,
        includeZero: includeZero ? "1" : undefined,
      } as never,
    });
  }

  const entityTabs: { type: StatementEntityType; label: string; icon: typeof UserCheck }[] = [
    { type: "customer", label: ar ? "حساب عميل" : "Customer", icon: UserCheck },
    { type: "supplier", label: ar ? "حساب مورد" : "Supplier", icon: Building2 },
    { type: "cash", label: ar ? "الخزينة والصندوق" : "Treasury", icon: Wallet },
  ];

  return (
    <>
      <PageHeader
        title={ar ? "إنشاء كشف حساب" : "Generate Statement"}
        subtitle={
          ar
            ? "اختر نوع الكشف والجهة والفترة، ثم انتقل مباشرة إلى مستند الكشف النهائي الجاهز للطباعة والتصدير"
            : "Pick statement type, party and period, then go straight to the final printable document"
        }
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        {/* ── نموذج الإنشاء ── */}
        <div className="panel-elevated space-y-5 p-5">
          {/* 1 · نوع الكشف */}
          <section className="space-y-2">
            <Label className="text-xs">{ar ? "1 · نوع الكشف" : "1 · Statement type"}</Label>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              {entityTabs.map((tab) => {
                const Icon = tab.icon;
                const active = entityType === tab.type;
                return (
                  <button
                    key={tab.type}
                    type="button"
                    onClick={() => setEntityType(tab.type)}
                    className={cn(
                      "flex items-center gap-2.5 rounded-2xl border px-3.5 py-3 text-start text-xs font-semibold transition-all",
                      active
                        ? "border-primary bg-primary/10 text-primary ring-1 ring-primary/30"
                        : "border-border/80 text-muted-foreground hover:bg-surface-2 hover:text-foreground",
                    )}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    <span className="leading-tight">{tab.label}</span>
                  </button>
                );
              })}
            </div>
          </section>

          {/* 2 · الجهة */}
          {entityType !== "cash" && (
            <section className="space-y-2">
              <Label className="text-xs">
                {ar ? "2 · الجهة" : "2 · Party"}
                {selectedParty?.phone && (
                  <span className="ms-2 text-[10px] font-normal text-muted-foreground">
                    {selectedParty.phone}
                  </span>
                )}
              </Label>

              <div className="flex flex-wrap items-center gap-2">
                <div className="flex h-10 min-w-[220px] flex-1 items-center gap-2 rounded-full border border-input bg-surface px-4 text-sm">
                  <Search className="h-4 w-4 text-muted-foreground" />
                  <input
                    value={partySearch}
                    onChange={(e) => setPartySearch(e.target.value)}
                    placeholder={
                      entityType === "customer"
                        ? ar
                          ? "ابحث عن عميل..."
                          : "Search customer…"
                        : ar
                          ? "ابحث عن مورد..."
                          : "Search supplier…"
                    }
                    className="flex-1 bg-transparent outline-none placeholder:text-muted-foreground"
                  />
                </div>

                <Select value={entityId} onValueChange={setEntityId}>
                  <SelectTrigger className="h-10 w-full sm:w-72">
                    <SelectValue
                      placeholder={
                        loadingParties
                          ? t("common.loading")
                          : ar
                            ? "اختر الجهة..."
                            : "Select party…"
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {filteredParties.length === 0 ? (
                      <div className="px-3 py-2 text-xs text-muted-foreground">
                        {ar ? "لا نتائج" : "No results"}
                      </div>
                    ) : (
                      filteredParties.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.name}
                          {p.phone ? ` — ${p.phone}` : ""}
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
              </div>
            </section>
          )}

          {/* 3 · الفترة */}
          <section className="space-y-2">
            <Label className="flex items-center gap-1.5 text-xs">
              <Calendar className="h-3.5 w-3.5" />
              {ar ? "3 · الفترة" : "3 · Period"}
            </Label>

            <div className="flex flex-wrap gap-1.5">
              {presetRanges().map((p) => (
                <button
                  key={p.key}
                  type="button"
                  onClick={() => applyPreset(p.key)}
                  className={cn(
                    "rounded-full border px-3 py-1.5 text-[11px] font-medium transition",
                    activePreset === p.key
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border/80 text-muted-foreground hover:bg-surface-2 hover:text-foreground",
                  )}
                >
                  {ar ? p.labelAr : p.labelEn}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-1 gap-3 pt-1 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label className="text-[11px] text-muted-foreground">
                  {ar ? "من تاريخ" : "From"}
                </Label>
                <Input
                  type="date"
                  value={from}
                  onChange={(e) => {
                    setFrom(e.target.value);
                    setActivePreset("custom");
                  }}
                  className="h-10"
                />
              </div>
              <div className="grid gap-1.5">
                <Label className="text-[11px] text-muted-foreground">
                  {ar ? "إلى تاريخ" : "To"}
                </Label>
                <Input
                  type="date"
                  value={to}
                  onChange={(e) => {
                    setTo(e.target.value);
                    setActivePreset("custom");
                  }}
                  className="h-10"
                />
              </div>
            </div>

            {from && to && from > to && (
              <div className="flex items-center gap-1.5 text-[11px] text-amber-600">
                <AlertTriangle className="h-3 w-3" />
                {ar
                  ? "تاريخ البداية بعد تاريخ النهاية — سيظهر الكشف فارغًا."
                  : "Start date is after end date — the statement will be empty."}
              </div>
            )}
          </section>

          {/* 4 · الخيارات */}
          <section className="space-y-3">
            <Label className="text-xs">{ar ? "4 · الخيارات" : "4 · Options"}</Label>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label className="text-[11px] text-muted-foreground">
                  {ar ? "القالب" : "Template"}
                </Label>
                <Select
                  value={templateId}
                  onValueChange={(v) => setTemplateId(v as StatementTemplateId)}
                >
                  <SelectTrigger className="h-10">
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

              <label className="flex cursor-pointer items-start gap-2.5 rounded-2xl border border-border/80 bg-surface/60 px-3.5 py-3">
                <Checkbox
                  checked={includeZero}
                  onCheckedChange={(v) => setIncludeZero(Boolean(v))}
                  className="mt-0.5"
                />
                <div className="space-y-0.5">
                  <div className="text-xs font-medium">
                    {ar ? "إظهار الفواتير المسددة كليًا" : "Include settled invoices"}
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                    {ar
                      ? "افتراضيًا تُخفى لأنها لا تؤثر على الرصيد"
                      : "Hidden by default as they do not affect the balance"}
                  </div>
                </div>
              </label>
            </div>
          </section>

          {/* زر الإنشاء */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/70 pt-4">
            <p className="text-[11px] text-muted-foreground">
              {ar
                ? "سيُفتح مستند الكشف النهائي مباشرة — بلا شاشة معاينة."
                : "The final statement document opens directly — no preview step."}
            </p>
            <Button
              onClick={handleGenerate}
              disabled={!canGenerate}
              size="lg"
              className="gap-2 rounded-full px-6"
            >
              {loadingParties ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <FileText className="h-4 w-4" />
              )}
              {ar ? "إنشاء الكشف" : "Generate statement"}
            </Button>
          </div>
        </div>

        {/* ── لوحة مساعدة ── */}
        <aside className="space-y-3">
          <div className="panel-elevated space-y-3 p-4">
            <div className="flex items-center gap-2 text-xs font-semibold">
              <Sparkles className="h-3.5 w-3.5 text-primary" />
              {ar ? "ما الذي سيظهر في الكشف؟" : "What will the statement contain?"}
            </div>
            <ul className="space-y-1.5 text-[11px] leading-relaxed text-muted-foreground">
              <li className="flex gap-1.5">
                <span className="text-primary">•</span>
                <span>
                  {ar
                    ? "الرصيد الافتتاحي محسوبًا من كل الحركات قبل بداية الفترة"
                    : "Opening balance from all movements before the period"}
                </span>
              </li>
              <li className="flex gap-1.5">
                <span className="text-primary">•</span>
                <span>
                  {ar
                    ? "كل حركة بجانبها مدين ودائن ورصيد تراكمي"
                    : "Every movement with debit, credit and running balance"}
                </span>
              </li>
              <li className="flex gap-1.5">
                <span className="text-primary">•</span>
                <span>
                  {ar ? "إجمالي المدين والدائن والرصيد الختامي" : "Totals and the closing balance"}
                </span>
              </li>
              <li className="flex gap-1.5">
                <span className="text-primary">•</span>
                <span>
                  {ar
                    ? "تنبيه تلقائي عند وجود فرق بين رصيد الدفتر والرصيد المخزَّن"
                    : "Automatic warning if ledger and cached balances differ"}
                </span>
              </li>
            </ul>
          </div>

          <div className="panel-elevated space-y-2 p-4">
            <div className="text-xs font-semibold">{ar ? "المصدر" : "Source"}</div>
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              {entityType === "customer"
                ? ar
                  ? "دفتر حركة العميل المحاسبي — مصدر الحقيقة لأرصدة العملاء."
                  : "The customer accounting ledger — source of truth for customer balances."
                : entityType === "supplier"
                  ? ar
                    ? "فواتير التوريد ومرتجعات المشتريات. لا يوجد دفتر موردين في النظام، لذلك تُشتقّ الحركات وتُوسَم بوضوح."
                    : "Purchase invoices and returns. No supplier ledger exists, so entries are derived and clearly tagged."
                  : ar
                    ? "تحصيلات العملاء (وارد) وسداد الموردين والمصروفات (صادر)."
                    : "Customer collections (in), supplier payments and expenses (out)."}
            </p>
          </div>

          <div className="panel-elevated space-y-2 p-4">
            <div className="text-xs font-semibold">
              {ar ? "غير مدعوم حاليًا" : "Not supported yet"}
            </div>
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              {ar
                ? "كشف حساب المندوب غير متاح لأن النظام لا يحتوي كيان مندوب (لا جدول ولا حقل مرتبط بالمبيعات)."
                : "Representative statements are unavailable — the system has no representative entity."}
            </p>
          </div>
        </aside>
      </div>
    </>
  );
}

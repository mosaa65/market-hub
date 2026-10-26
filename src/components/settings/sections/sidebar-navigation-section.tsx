import { Circle, Compass, LayoutGrid, PanelsTopLeft, SlidersHorizontal } from "lucide-react";
import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import {
  DEFAULT_SIDEBAR_PREFERENCES,
  useSidebarPreferences,
} from "@/lib/navigation/sidebar-preferences";
import { AutoSaveBadge } from "@/components/settings/auto-save-badge";
import { cn } from "@/lib/utils";

const GROUPS = [
  ["sales", "nav.view.group.sales"],
  ["customers", "nav.view.group.customers"],
  ["inventory", "nav.view.group.inventory"],
  ["procurement", "nav.view.group.procurement"],
  ["suppliers", "nav.view.group.suppliers"],
  ["milling", "nav.view.group.milling"],
  ["finance", "nav.view.group.finance"],
  ["reports", "nav.view.group.reports"],
  ["statements", "nav.view.group.statements"],
  ["admin", "nav.view.group.admin"],
  ["settings", "nav.view.group.settings"],
] as const;

const PALETTE = [
  {
    id: "emerald",
    labelAr: "أخضر زمردي",
    labelEn: "Emerald",
    swatch: "bg-emerald-500",
    text: "text-emerald-600 dark:text-emerald-400",
    soft: "bg-emerald-500/12",
  },
  {
    id: "cyan",
    labelAr: "سماوي",
    labelEn: "Cyan",
    swatch: "bg-cyan-500",
    text: "text-cyan-600 dark:text-cyan-400",
    soft: "bg-cyan-500/12",
  },
  {
    id: "amber",
    labelAr: "كهرماني",
    labelEn: "Amber",
    swatch: "bg-amber-500",
    text: "text-amber-600 dark:text-amber-400",
    soft: "bg-amber-500/12",
  },
  {
    id: "blue",
    labelAr: "أزرق",
    labelEn: "Blue",
    swatch: "bg-blue-500",
    text: "text-blue-600 dark:text-blue-400",
    soft: "bg-blue-500/12",
  },
  {
    id: "rose",
    labelAr: "وردي",
    labelEn: "Rose",
    swatch: "bg-rose-500",
    text: "text-rose-600 dark:text-rose-400",
    soft: "bg-rose-500/12",
  },
  {
    id: "teal",
    labelAr: "فيروزي",
    labelEn: "Teal",
    swatch: "bg-teal-500",
    text: "text-teal-600 dark:text-teal-400",
    soft: "bg-teal-500/12",
  },
  {
    id: "orange",
    labelAr: "برتقالي",
    labelEn: "Orange",
    swatch: "bg-orange-500",
    text: "text-orange-600 dark:text-orange-400",
    soft: "bg-orange-500/12",
  },
  {
    id: "violet",
    labelAr: "بنفسجي",
    labelEn: "Violet",
    swatch: "bg-violet-500",
    text: "text-violet-600 dark:text-violet-400",
    soft: "bg-violet-500/12",
  },
] as const;

const DEFAULT_GROUP_COLORS: Record<string, string> = {
  command_center: "blue",
  sales: "emerald",
  customers: "emerald",
  inventory: "cyan",
  procurement: "amber",
  suppliers: "amber",
  milling: "orange",
  finance: "violet",
  reports: "blue",
  statements: "teal",
  admin: "rose",
  settings: "teal",
};

interface SidebarNavigationSectionProps {
  canEdit?: boolean;
  lang?: string;
}

export function SidebarNavigationSection({ canEdit = true, lang }: SidebarNavigationSectionProps) {
  const { user } = useAuth();
  const { lang: currentLang, t } = useI18n();
  const isAr = (lang ?? currentLang) === "ar";
  const { preferences, update } = useSidebarPreferences(user?.id);
  // تفضيلات القائمة تُحفظ لحظياً عند كل نقرة — الشارة تؤكد ذلك.
  const [savePulse, setSavePulse] = useState(0);
  useEffect(() => {
    setSavePulse((n) => n + 1);
  }, [preferences]);
  const selectedColor = (key: string) =>
    preferences.customIconColors[key] ?? DEFAULT_GROUP_COLORS[key] ?? "blue";

  return (
    <div className="space-y-5">
      <Card className="rounded-3xl border-border/80 bg-card shadow-xs">
        <CardHeader className="border-b border-border/60 pb-4">
          <CardTitle className="flex items-center gap-3 text-base">
            <span className="grid size-10 place-items-center rounded-lg bg-primary/10 text-primary">
              <PanelsTopLeft className="size-5" />
            </span>
            <span>
              <span className="block">
                {isAr ? "تخصيص القائمة الجانبية" : "Sidebar customization"}
              </span>
              <span className="mt-1 block text-xs font-normal text-muted-foreground">
                {isAr
                  ? "خصص شكل الأيقونات وألوان مجموعات التنقل على هذا الجهاز — تُحفظ تلقائياً."
                  : "Customize navigation icon shapes and group colors on this device — saved automatically."}
              </span>
            </span>
            <AutoSaveBadge lang={isAr ? "ar" : "en"} trigger={savePulse} className="ms-auto" />
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6 pt-5">
          <section className="space-y-3">
            <div>
              <h3 className="text-sm font-semibold">
                {isAr ? "طريقة التنقل الافتراضية" : "Default navigation view"}
              </h3>
              <p className="text-xs text-muted-foreground">
                {isAr
                  ? "اختر كيف تظهر وحدات النظام وروابطها في القائمة."
                  : "Choose how system units and their links appear in the sidebar."}
              </p>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {(["daily", "activity", "focus", "explorer"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  disabled={!canEdit}
                  aria-pressed={preferences.mode === mode}
                  onClick={() =>
                    update({ mode, ...(mode === "explorer" ? { explorerGroup: null } : {}) })
                  }
                  className={cn(
                    "flex min-h-12 items-center gap-3 rounded-lg border px-3 text-start text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 disabled:cursor-not-allowed disabled:opacity-50",
                    preferences.mode === mode
                      ? "border-primary/50 bg-primary/8"
                      : "border-border/70 hover:bg-muted/60",
                  )}
                >
                  <Compass className="size-4 shrink-0 text-primary" />
                  <span className="flex-1">{t(`nav.view.${mode}`)}</span>
                  {preferences.mode === mode && <span className="size-2 rounded-full bg-primary" />}
                </button>
              ))}
            </div>
          </section>

          <section className="space-y-3">
            <div>
              <h3 className="text-sm font-semibold">{isAr ? "شكل الأيقونات" : "Icon shape"}</h3>
              <p className="text-xs text-muted-foreground">
                {isAr
                  ? "يطبق الشكل على أيقونات مجموعات القائمة."
                  : "Applied to navigation group icons."}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  ["rounded", isAr ? "مستديرة" : "Rounded", PanelsTopLeft],
                  ["circle", isAr ? "دائرية" : "Circular", Circle],
                ] as const
              ).map(([shape, label, Icon]) => (
                <button
                  key={shape}
                  type="button"
                  disabled={!canEdit}
                  aria-pressed={preferences.iconShape === shape}
                  onClick={() => update({ iconShape: shape })}
                  className={cn(
                    "flex min-h-12 items-center gap-3 rounded-lg border px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 disabled:cursor-not-allowed disabled:opacity-50",
                    preferences.iconShape === shape
                      ? "border-primary/50 bg-primary/8 text-foreground"
                      : "border-border/70 hover:bg-muted/60",
                  )}
                >
                  <span
                    className={cn(
                      "grid size-8 place-items-center bg-primary/12 text-primary",
                      shape === "circle" ? "rounded-full" : "rounded-lg",
                    )}
                  >
                    <Icon className="size-4" />
                  </span>
                  {label}
                </button>
              ))}
            </div>
          </section>

          <section className="space-y-3">
            <div>
              <h3 className="text-sm font-semibold">
                {isAr ? "عناصر القائمة" : "Sidebar sections"}
              </h3>
              <p className="text-xs text-muted-foreground">
                {isAr
                  ? "تحكم في اختصاراتك وسلوك فتح المجموعات."
                  : "Control shortcuts and how groups expand."}
              </p>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {(
                [
                  ["showFavorites", isAr ? "إظهار المفضلة" : "Show favorites"],
                  ["showRecent", isAr ? "إظهار آخر الصفحات" : "Show recent pages"],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  disabled={!canEdit}
                  aria-pressed={preferences[key]}
                  onClick={() => update({ [key]: !preferences[key] })}
                  className={cn(
                    "flex min-h-11 items-center justify-between gap-2 rounded-lg border px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 disabled:opacity-50",
                    preferences[key]
                      ? "border-primary/40 bg-primary/5"
                      : "border-border/70 hover:bg-muted/60",
                  )}
                >
                  <span>{label}</span>
                  <span
                    className={cn(
                      "size-2.5 rounded-full",
                      preferences[key] ? "bg-primary" : "bg-muted-foreground/30",
                    )}
                  />
                </button>
              ))}
            </div>
            <div className="space-y-2">
              <h4 className="text-xs font-semibold text-muted-foreground">
                {isAr ? "الحالة الافتراضية للأقسام" : "Default group state"}
              </h4>
              <p className="text-xs text-muted-foreground">
                {isAr
                  ? "تطبق على الأقسام التي لم تغيّر حالة فتحها يدوياً."
                  : "Applies to groups whose open state has not been changed manually."}
              </p>
              <div className="grid gap-2 sm:grid-cols-3">
                {(
                  [
                    ["active", isAr ? "القسم الحالي" : "Active group"],
                    ["all", isAr ? "كل الأقسام" : "All groups"],
                    ["none", isAr ? "مطوية" : "Collapsed"],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    disabled={!canEdit}
                    aria-pressed={preferences.defaultExpanded === value}
                    onClick={() => update({ defaultExpanded: value })}
                    className={cn(
                      "min-h-10 rounded-lg border px-2 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 disabled:opacity-50",
                      preferences.defaultExpanded === value
                        ? "border-primary/50 bg-primary/8"
                        : "border-border/70 hover:bg-muted/60",
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </section>

          <section className="space-y-3">
            <div>
              <h3 className="text-sm font-semibold">{isAr ? "ألوان الأيقونات" : "Icon colors"}</h3>
              <p className="text-xs text-muted-foreground">
                {isAr
                  ? "اختر لون السمة، ألوان النشاط الحالية، أو خصص لون كل مجموعة."
                  : "Use the theme color, activity colors, or assign a color to each group."}
              </p>
            </div>
            <div className="grid gap-2 sm:grid-cols-3">
              {(
                [
                  ["system", isAr ? "حسب السمة" : "Theme color"],
                  ["activity", isAr ? "حسب النشاط" : "By activity"],
                  ["custom", isAr ? "ألوان مخصصة" : "Custom colors"],
                ] as const
              ).map(([mode, label]) => (
                <button
                  key={mode}
                  type="button"
                  disabled={!canEdit}
                  aria-pressed={preferences.iconColorMode === mode}
                  onClick={() => update({ iconColorMode: mode })}
                  className={cn(
                    "flex min-h-11 items-center justify-between gap-2 rounded-lg border px-3 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 disabled:cursor-not-allowed disabled:opacity-50",
                    preferences.iconColorMode === mode
                      ? "border-primary/50 bg-primary/8"
                      : "border-border/70 hover:bg-muted/60",
                  )}
                >
                  <span>{label}</span>
                  {mode === "activity" ? (
                    <SlidersHorizontal className="size-4 text-teal-500" />
                  ) : (
                    <span
                      className={cn(
                        "size-4 rounded-full",
                        mode === "system"
                          ? "bg-primary"
                          : "bg-gradient-to-br from-emerald-500 via-amber-500 to-blue-500",
                      )}
                    />
                  )}
                </button>
              ))}
            </div>
          </section>

          {preferences.iconColorMode === "custom" && (
            <section className="space-y-3">
              <h3 className="text-sm font-semibold">
                {isAr ? "لون كل مجموعة" : "Color per group"}
              </h3>
              <div className="divide-y divide-border/60 rounded-lg border border-border/70">
                {GROUPS.map(([groupKey, titleKey]) => (
                  <div
                    key={groupKey}
                    className="flex min-h-12 flex-wrap items-center justify-between gap-2 px-3 py-2"
                  >
                    <span className="text-sm">{t(titleKey)}</span>
                    <div
                      className="flex items-center gap-1.5"
                      role="radiogroup"
                      aria-label={t(titleKey)}
                    >
                      {PALETTE.map((color) => (
                        <button
                          key={color.id}
                          type="button"
                          disabled={!canEdit}
                          aria-label={isAr ? color.labelAr : color.labelEn}
                          aria-pressed={selectedColor(groupKey) === color.id}
                          onClick={() =>
                            update({
                              customIconColors: {
                                ...preferences.customIconColors,
                                [groupKey]: color.id,
                              },
                            })
                          }
                          className={cn(
                            "grid size-7 place-items-center rounded-full transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50",
                            color.swatch,
                          )}
                        >
                          {selectedColor(groupKey) === color.id && (
                            <span className="size-2 rounded-full bg-white shadow" />
                          )}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          <div className="flex items-start gap-2 rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
            <LayoutGrid className="mt-0.5 size-4 shrink-0 text-primary" />
            <p>
              {isAr
                ? "هذه تفضيلات عرض شخصية، تحفظ على هذا الجهاز ولا تغير صلاحيات الوصول أو إعدادات بقية المستخدمين."
                : "These are personal display preferences stored on this device. They do not change access permissions or other users' settings."}
            </p>
          </div>
          <div className="flex justify-end border-t border-border/60 pt-4">
            <button
              type="button"
              disabled={!canEdit}
              onClick={() => update(DEFAULT_SIDEBAR_PREFERENCES)}
              className="min-h-10 rounded-lg border border-border/70 px-3 text-xs font-semibold text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 disabled:opacity-50"
            >
              {isAr ? "استعادة الإعدادات الافتراضية" : "Restore default settings"}
            </button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

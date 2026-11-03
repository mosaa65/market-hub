import { useEffect, useState } from "react";
import {
  Languages,
  Palette,
  Sun,
  Moon,
  Check,
  Sparkles,
  Plus,
  Trash2,
  RotateCcw,
  CheckCircle2,
  Eye,
  Sliders,
  ShieldAlert,
  Cloud,
  CloudCheck,
  RefreshCw,
  Laptop,
  Layers,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useI18n } from "@/lib/i18n";
import { useTheme } from "@/lib/theme";
import { MODE_VARIANTS, type ModeVariantId } from "@/lib/color-theme";
import { AutoSaveBadge } from "@/components/settings/auto-save-badge";
import { ThemeVisualTestSuite } from "@/components/theme/theme-visual-test-suite";
import { CURATED_THEMES, type AccentThemeId, type ArchivedColor } from "@/lib/color-theme";

interface AppearanceSectionProps {
  canEdit?: boolean;
}

export function AppearanceSection({ canEdit = true }: AppearanceSectionProps) {
  const { lang, setLang } = useI18n();
  const isAr = lang === "ar";
  const {
    theme,
    setTheme,
    modeVariant,
    setModeVariant,
    accentTheme,
    setAccentTheme,
    customColor,
    setCustomColor,
    colorArchive,
    addToArchive,
    removeFromArchive,
    resetArchive,
    userId,
    isCloudSynced,
    syncStatus,
    lastSyncedAt,
    forceSyncCloud,
  } = useTheme();

  const [hexInput, setHexInput] = useState(customColor);
  const [colorNameInput, setColorNameInput] = useState("");
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);
  // كل تغيير في المظهر/اللغة/اللون يُحفظ فوراً في مخزن التفضيلات —
  // الشارة تُعلم المستخدم بذلك دون زر حفظ.
  const [savePulse, setSavePulse] = useState(0);
  useEffect(() => {
    setSavePulse((n) => n + 1);
  }, [theme, lang, accentTheme, customColor]);

  const handleHexChange = (value: string) => {
    let clean = value.trim();
    if (!clean.startsWith("#") && clean.length > 0) clean = "#" + clean;
    setHexInput(clean);
    if (/^#[0-9A-Fa-f]{6}$/.test(clean)) {
      setCustomColor(clean);
      if (accentTheme === "custom") {
        // live update
      }
    }
  };

  const handleSaveToArchive = () => {
    if (!/^#[0-9A-Fa-f]{6}$/.test(hexInput)) return;
    const name = colorNameInput.trim() || undefined;
    addToArchive(hexInput, name, name);
    setColorNameInput("");
    setCopyFeedback(isAr ? "تمت الإضافة للأرشيف بنجاح" : "Added to archive");
    setTimeout(() => setCopyFeedback(null), 2500);
  };

  return (
    <div className="space-y-6">
      {/* 1. السمة العامة (فاتح / مظلم) ولغة الواجهة */}
      <Card className="rounded-3xl border-border/80 shadow-xs">
        <CardHeader className="border-b border-border/50 pb-4">
          <CardTitle className="text-base font-bold flex items-center gap-2">
            <div className="p-2 rounded-xl bg-primary/10 text-primary">
              <Sun className="h-5 w-5 dark:hidden" />
              <Moon className="h-5 w-5 hidden dark:block text-amber-400" />
            </div>
            <div>
              <div>{isAr ? "وضع العرض ولغة الواجهة" : "Display Mode & Language"}</div>
              <div className="text-xs text-muted-foreground font-normal mt-0.5">
                {isAr
                  ? "تحديد البيئة الضوئية للنظام (ليلي / نهاري) ولغة الخطوط والاتجاه — تُحفظ تلقائياً"
                  : "Choose light/dark display mode and interface language — saved automatically"}
              </div>
            </div>
            <AutoSaveBadge lang={isAr ? "ar" : "en"} trigger={savePulse} className="ms-auto" />
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-5 space-y-4">
          {/* اختيار درجة الوضع النهاري / الليلي */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-2xl border border-border/80 bg-surface/70 p-4">
            <div>
              <div className="text-sm font-semibold flex items-center gap-2">
                <span>{isAr ? "وضع العرض ودرجاته" : "Display Mode & Variants"}</span>
                <span className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary font-medium">
                  {theme === "dark"
                    ? MODE_VARIANTS[modeVariant].base === "dark"
                      ? isAr
                        ? MODE_VARIANTS[modeVariant].name_ar
                        : MODE_VARIANTS[modeVariant].name_en
                      : isAr
                        ? "ليلي فاخر"
                        : "Dark Obsidian"
                    : MODE_VARIANTS[modeVariant].base === "light"
                      ? isAr
                        ? MODE_VARIANTS[modeVariant].name_ar
                        : MODE_VARIANTS[modeVariant].name_en
                      : isAr
                        ? "نهاري رخامي"
                        : "Light Alabaster"}
                </span>
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">
                {isAr
                  ? "اختر الدرجة المناسبة: نهاري رخامي، فخم عاجي، أبيض نقي، ليلي أصلي، رمادي فحمي، أو معتم عميق."
                  : "Pick a variant: alabaster, ivory, pure white, classic dark, charcoal, or deep midnight."}
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2 shrink-0">
              {[
                {
                  variant: "default" as ModeVariantId,
                  base: "light" as const,
                  label_ar: "رخامي",
                  label_en: "Alabaster",
                  icon: Sun,
                },
                {
                  variant: "luxe" as ModeVariantId,
                  base: "light" as const,
                  label_ar: "فخم عاجي",
                  label_en: "Ivory Luxe",
                  icon: Sparkles,
                },
                {
                  variant: "pure" as ModeVariantId,
                  base: "light" as const,
                  label_ar: "أبيض نقي",
                  label_en: "Pure White",
                  icon: Sun,
                },
                {
                  variant: "sand" as ModeVariantId,
                  base: "light" as const,
                  label_ar: "رملي دافئ",
                  label_en: "Warm Sand",
                  icon: Sparkles,
                },
                {
                  variant: "mist" as ModeVariantId,
                  base: "light" as const,
                  label_ar: "رمادي ناعم",
                  label_en: "Soft Mist",
                  icon: Sun,
                },
                {
                  variant: "default" as ModeVariantId,
                  base: "dark" as const,
                  label_ar: "ليلي أصلي",
                  label_en: "Classic Dark",
                  icon: Moon,
                },
                {
                  variant: "slate" as ModeVariantId,
                  base: "dark" as const,
                  label_ar: "رمادي فحمي",
                  label_en: "Charcoal",
                  icon: Moon,
                },
                {
                  variant: "deep" as ModeVariantId,
                  base: "dark" as const,
                  label_ar: "معتم عميق",
                  label_en: "Deep Midnight",
                  icon: Moon,
                },
                {
                  variant: "navy" as ModeVariantId,
                  base: "dark" as const,
                  label_ar: "أزرق نيلي",
                  label_en: "Midnight Navy",
                  icon: Moon,
                },
                {
                  variant: "cocoa" as ModeVariantId,
                  base: "dark" as const,
                  label_ar: "قهوة دافئة",
                  label_en: "Warm Cocoa",
                  icon: Moon,
                },
              ].map((opt) => {
                const isActive = theme === opt.base && modeVariant === opt.variant;
                const Icon = opt.icon;
                return (
                  <button
                    key={`${opt.base}-${opt.variant}`}
                    type="button"
                    onClick={() => {
                      setTheme(opt.base);
                      setModeVariant(opt.variant);
                    }}
                    className={`flex flex-col items-center gap-1 rounded-xl border px-3 py-2 text-[11px] font-bold transition-all ${
                      isActive
                        ? "bg-primary text-primary-foreground border-primary shadow-xs"
                        : "border-border bg-surface text-muted-foreground hover:text-foreground hover:border-primary/40"
                    }`}
                  >
                    <Icon className="h-4 w-4" />
                    <span>{isAr ? opt.label_ar : opt.label_en}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* تبديل اللغة */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-2xl border border-border/80 bg-surface/70 p-4">
            <div>
              <div className="text-sm font-semibold flex items-center gap-2">
                <Languages className="h-4 w-4 text-primary" />
                <span>{isAr ? "لغة عرض الواجهة" : "Interface Language"}</span>
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">
                {isAr
                  ? "اختر لغة الواجهة الرئيسية للنظام، يتم ضبط الاتجاه والمحاذاة تلقائياً."
                  : "Select the primary display language. Layout direction updates automatically."}
              </div>
            </div>
            <div className="inline-flex rounded-full border border-border bg-surface p-1 shadow-xs shrink-0">
              <button
                type="button"
                onClick={() => setLang("ar")}
                className={`h-9 rounded-full px-5 text-xs font-bold transition-all ${
                  lang === "ar"
                    ? "bg-primary text-primary-foreground shadow-xs"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                العربية
              </button>
              <button
                type="button"
                onClick={() => setLang("en")}
                className={`h-9 rounded-full px-5 text-xs font-bold transition-all ${
                  lang === "en"
                    ? "bg-primary text-primary-foreground shadow-xs"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                English
              </button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* شريط حالة مزامنة تفضيلات المستخدم بين الأجهزة والسحابة */}
      <div className="rounded-2xl border border-border/80 bg-surface/80 p-4 shadow-2xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div
              className={`p-2.5 rounded-2xl ${
                userId
                  ? syncStatus === "synced"
                    ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                    : syncStatus === "syncing"
                      ? "bg-primary/10 text-primary animate-pulse"
                      : "bg-amber-500/10 text-amber-600"
                  : "bg-surface-2 text-muted-foreground"
              }`}
            >
              {userId ? (
                syncStatus === "syncing" ? (
                  <RefreshCw className="h-5 w-5 animate-spin" />
                ) : (
                  <Cloud className="h-5 w-5" />
                )
              ) : (
                <Laptop className="h-5 w-5" />
              )}
            </div>

            <div>
              <div className="text-sm font-bold text-foreground flex items-center gap-2">
                <span>
                  {userId
                    ? isAr
                      ? "المزامنة السحابية لتفضيلات المستخدم"
                      : "User Cloud Preferences Sync"
                    : isAr
                      ? "تفضيلات محلية على هذا الجهاز (الزائر)"
                      : "Local Device Preferences (Guest Mode)"}
                </span>

                {userId && (
                  <span
                    className={`inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full ${
                      syncStatus === "synced"
                        ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20"
                        : syncStatus === "syncing"
                          ? "bg-primary/10 text-primary border border-primary/20"
                          : "bg-amber-500/10 text-amber-600 border border-amber-500/20"
                    }`}
                  >
                    {syncStatus === "synced" && (isAr ? "متزامن لحظياً" : "Synced")}
                    {syncStatus === "syncing" && (isAr ? "جاري المزامنة..." : "Syncing...")}
                    {syncStatus === "error" && (isAr ? "حفظ محلي مؤقت" : "Local Cached")}
                  </span>
                )}
              </div>

              <div className="text-xs text-muted-foreground mt-0.5">
                {userId
                  ? isAr
                    ? `إعدادات الثيم، والألوان المخصصة، وأرشيف لوحات الألوان محفوظة بحسابك وتتزامن تلقائياً بين كل أجهزتك${
                        lastSyncedAt ? ` (آخر مزامنة: ${lastSyncedAt.toLocaleTimeString()})` : ""
                      }.`
                    : `Active theme, custom palettes & color archive are synced across all your devices.${
                        lastSyncedAt ? ` (Last sync: ${lastSyncedAt.toLocaleTimeString()})` : ""
                      }`
                  : isAr
                    ? "اختياراتك محفوظة محلياً في هذا المتصفح. عند تسجيل الدخول ستتم مزامنتها تلقائياً مع حسابك لتظهر على جميع أجهزتك."
                    : "Preferences stored locally on this device. Sign in to automatically sync across all your devices."}
              </div>
            </div>
          </div>

          {userId && (
            <button
              type="button"
              onClick={forceSyncCloud}
              disabled={syncStatus === "syncing"}
              className="inline-flex items-center gap-1.5 h-8 rounded-full border border-border bg-surface px-3 text-xs font-bold text-foreground hover:bg-surface-2 transition-all shadow-2xs shrink-0 disabled:opacity-50"
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${syncStatus === "syncing" ? "animate-spin" : ""}`}
              />
              <span>{isAr ? "مزامنة الآن" : "Sync Now"}</span>
            </button>
          )}
        </div>
      </div>

      {/* 2. منظومة الثيمات التنفيذية الستة (الافتراضي + 5 ألوان مدروسة بعناية) */}
      <Card className="rounded-3xl border-border/80 shadow-xs">
        <CardHeader className="border-b border-border/50 pb-4">
          <CardTitle className="text-base font-bold flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="p-2 rounded-xl bg-primary/10 text-primary">
                <Palette className="h-5 w-5" />
              </div>
              <div>
                <div>{isAr ? "ثيمات ألوان النظام التنفيذية" : "Executive System Themes"}</div>
                <div className="text-xs text-muted-foreground font-normal mt-0.5">
                  {isAr
                    ? "6 باقات لونية موحدة مدروسة نفسياً وتجارياً مع حماية كاملة لألوان الحالات التنبيهية"
                    : "6 psychologically tuned palettes that tint unified accents while safeguarding status alerts"}
                </div>
              </div>
            </div>
            <span className="hidden sm:inline-flex text-xs px-3 py-1 rounded-full border border-border/80 bg-surface text-muted-foreground">
              {isAr ? "متوافق مع معايير WCAG للتباين" : "WCAG Contrast Certified"}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {(Object.keys(CURATED_THEMES) as Array<keyof typeof CURATED_THEMES>).map((key) => {
              const def = CURATED_THEMES[key];
              const isActive = accentTheme === key;
              const swatchColor = theme === "dark" ? def.dark.primary : def.light.primary;

              return (
                <div
                  key={key}
                  onClick={() => setAccentTheme(key)}
                  className={`group relative rounded-2xl border p-4 cursor-pointer transition-all duration-200 ${
                    isActive
                      ? "border-primary bg-primary/[0.04] shadow-md ring-2 ring-primary/40"
                      : "border-border/70 bg-surface/60 hover:border-border hover:bg-surface/90 hover:shadow-xs"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div className="flex items-center gap-3">
                      {/* Swatch Circle */}
                      <div
                        className="h-9 w-9 rounded-full shadow-sm flex items-center justify-center shrink-0 transition-transform group-hover:scale-105"
                        style={{ backgroundColor: swatchColor }}
                      >
                        {isActive ? <Check className="h-4 w-4 text-white stroke-[3]" /> : null}
                      </div>

                      <div>
                        <div className="text-sm font-bold text-foreground flex items-center gap-1.5">
                          <span>{isAr ? def.name_ar : def.name_en}</span>
                          {key === "sapphire" && (
                            <span className="text-[10px] px-1.5 py-0.2 rounded-md bg-blue-500/10 text-blue-600 dark:text-blue-400 font-semibold">
                              {isAr ? "الافتراضي" : "Default"}
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] font-mono text-muted-foreground">{def.hex}</div>
                      </div>
                    </div>

                    {isActive && (
                      <span className="inline-flex items-center gap-1 text-[11px] font-bold text-primary px-2 py-0.5 rounded-full bg-primary/10">
                        <CheckCircle2 className="h-3 w-3" />
                        <span>{isAr ? "نشط" : "Active"}</span>
                      </span>
                    )}
                  </div>

                  <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2">
                    {isAr ? def.description_ar : def.description_en}
                  </p>

                  {/* Micro Visual Bar */}
                  <div className="mt-3.5 pt-3 border-t border-border/40 flex items-center justify-between text-[11px]">
                    <span className="text-muted-foreground text-[10px]">
                      {isAr ? "تناغم العناصر والأزرار" : "Harmonized elements"}
                    </span>
                    <div className="flex items-center gap-1">
                      <span
                        className="h-2 w-5 rounded-full opacity-90"
                        style={{ backgroundColor: swatchColor }}
                      />
                      <span
                        className="h-2 w-2 rounded-full opacity-60"
                        style={{ backgroundColor: swatchColor }}
                      />
                      <span
                        className="h-2 w-2 rounded-full opacity-30"
                        style={{ backgroundColor: swatchColor }}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* 3. استوديو اللون المخصص (Bespoke Color Studio) والمعاينة الحية */}
      <Card className="rounded-3xl border-border/80 shadow-xs">
        <CardHeader className="border-b border-border/50 pb-4">
          <CardTitle className="text-base font-bold flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="p-2 rounded-xl bg-primary/10 text-primary">
                <Sparkles className="h-5 w-5" />
              </div>
              <div>
                <div>
                  {isAr
                    ? "استوديو اللون المخصص والمعاينة الفورية"
                    : "Custom Color Studio & Live Preview"}
                </div>
                <div className="text-xs text-muted-foreground font-normal mt-0.5">
                  {isAr
                    ? "اختر أي كود لوني يعجبك مع توليد تلقائي للظلال، الحلقات، والتباين"
                    : "Pick any custom hex color with automatic shade derivation and contrast safety"}
                </div>
              </div>
            </div>
            {accentTheme === "custom" && (
              <span className="inline-flex items-center gap-1 text-xs font-bold text-primary px-3 py-1 rounded-full bg-primary/10 border border-primary/20">
                <CheckCircle2 className="h-3.5 w-3.5" />
                <span>{isAr ? "اللون المخصص نشط الآن" : "Custom Color Active"}</span>
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-6 space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* جهة التحكم باللون المخصص */}
            <div className="lg:col-span-6 space-y-4">
              <div className="rounded-2xl border border-border/80 bg-surface/70 p-4 space-y-4">
                <div className="text-xs font-semibold text-foreground">
                  {isAr ? "اختر الدرجة اللونية المطلوبة:" : "Choose your desired color hue:"}
                </div>

                <div className="flex items-center gap-3">
                  {/* منتقي الألوان الأصلي المدمج */}
                  <label
                    className="relative flex h-12 w-12 shrink-0 cursor-pointer items-center justify-center rounded-2xl border-2 border-border/80 shadow-sm transition-transform hover:scale-105 overflow-hidden"
                    style={{ backgroundColor: hexInput }}
                    title={isAr ? "اضغط لفتح عجلة الألوان" : "Click to open color wheel"}
                  >
                    <input
                      type="color"
                      value={hexInput.length === 7 ? hexInput : customColor}
                      onChange={(e) => {
                        const val = e.target.value.toUpperCase();
                        setHexInput(val);
                        setCustomColor(val);
                      }}
                      className="absolute inset-0 opacity-0 cursor-pointer h-full w-full"
                    />
                  </label>

                  {/* حقل إدخال HEX */}
                  <div className="flex-1 space-y-1">
                    <label className="text-[11px] font-medium text-muted-foreground">
                      {isAr ? "كود اللون (Hex Code):" : "Hex Color Code:"}
                    </label>
                    <div className="relative">
                      <input
                        type="text"
                        value={hexInput}
                        onChange={(e) => handleHexChange(e.target.value)}
                        placeholder="#2563EB"
                        maxLength={7}
                        className="w-full h-10 rounded-xl border border-border bg-surface px-3 font-mono text-sm font-semibold focus:border-primary focus:ring-2 focus:ring-primary/20 focus:outline-none uppercase"
                      />
                    </div>
                  </div>
                </div>

                {/* تسمية اختيارية لحفظه في الأرشيف */}
                <div className="space-y-1">
                  <label className="text-[11px] font-medium text-muted-foreground">
                    {isAr
                      ? "تسمية مخصصة للون (اختياري للأرشيف):"
                      : "Optional color nickname (for archive):"}
                  </label>
                  <input
                    type="text"
                    value={colorNameInput}
                    onChange={(e) => setColorNameInput(e.target.value)}
                    placeholder={
                      isAr
                        ? "مثال: أزرق مكتبي، تركواز الشركة..."
                        : "e.g., Corporate Teal, Warm Sky..."
                    }
                    className="w-full h-10 rounded-xl border border-border bg-surface px-3 text-xs focus:border-primary focus:ring-2 focus:ring-primary/20 focus:outline-none"
                  />
                </div>

                {/* أزرار الإجراء */}
                <div className="flex flex-wrap items-center gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => {
                      if (/^#[0-9A-Fa-f]{6}$/.test(hexInput)) {
                        setCustomColor(hexInput);
                        setAccentTheme("custom");
                      }
                    }}
                    className="flex-1 h-10 rounded-xl bg-primary text-primary-foreground font-bold text-xs shadow-xs hover:bg-primary/90 transition-all flex items-center justify-center gap-2"
                  >
                    <Check className="h-4 w-4" />
                    <span>{isAr ? "تطبيق كلون نشط للنظام" : "Apply as Active Theme"}</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleSaveToArchive}
                    className="h-10 px-4 rounded-xl border border-border bg-surface text-foreground font-semibold text-xs hover:border-primary/40 hover:bg-surface-2 transition-all flex items-center gap-1.5"
                    title={
                      isAr ? "حفظ اللون في الأرشيف للرجوع إليه لاحقاً" : "Save to archive for later"
                    }
                  >
                    <Plus className="h-4 w-4 text-primary" />
                    <span>{isAr ? "حفظ في الأرشيف" : "Save to Archive"}</span>
                  </button>
                </div>

                {copyFeedback && (
                  <div className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    <span>{copyFeedback}</span>
                  </div>
                )}
              </div>
            </div>

            {/* جهة المعاينة الحية الفورية للعناصر الموحدة */}
            <div className="lg:col-span-6 space-y-3">
              <div className="rounded-2xl border border-border/80 bg-surface/50 p-4 space-y-3">
                <div className="flex items-center justify-between border-b border-border/40 pb-2">
                  <span className="text-xs font-bold text-foreground flex items-center gap-1.5">
                    <Eye className="h-3.5 w-3.5 text-primary" />
                    <span>
                      {isAr ? "معاينة حية للمكونات الموحدة" : "Live Unified Component Preview"}
                    </span>
                  </span>
                  <span className="text-[10px] text-muted-foreground font-mono">
                    {accentTheme === "custom" ? customColor : CURATED_THEMES[accentTheme]?.hex}
                  </span>
                </div>

                <p className="text-[11px] text-muted-foreground">
                  {isAr
                    ? "هكذا تظهر الأزرار، وحقول الإدخال، وحلقات التركيز، والشرائح النشطة مع الثيم المختار:"
                    : "How buttons, fields, focus rings, and active tags render with your active theme:"}
                </p>

                {/* صندوق المعاينة */}
                <div className="rounded-xl border border-border/60 bg-surface-2/40 p-3.5 space-y-3">
                  {/* أزرار التجربة */}
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      className="h-8 px-3 rounded-full bg-primary text-primary-foreground text-xs font-bold shadow-xs hover:bg-primary/90"
                    >
                      {isAr ? "زر رئيسي تنفيذي" : "Primary Action"}
                    </button>

                    <span className="h-6 px-2.5 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center">
                      {isAr ? "شارة معتمدة" : "Active Badge"}
                    </span>

                    <span className="text-xs text-primary font-semibold underline underline-offset-4 cursor-pointer">
                      {isAr ? "رابط تفاعلي" : "Interactive Link"}
                    </span>
                  </div>

                  {/* حقل إدخال التجربة */}
                  <div className="space-y-1">
                    <label className="text-[10px] font-medium text-muted-foreground">
                      {isAr
                        ? "حقل إدخال مع حلقة توهج الثيم (Focus Ring):"
                        : "Input Field with Active Accent Border:"}
                    </label>
                    <input
                      type="text"
                      defaultValue={isAr ? "نص تجريبي داخل حقل النظام..." : "Sample input text..."}
                      className="w-full h-8 rounded-full border border-primary/50 bg-surface px-3 text-xs focus:ring-4 focus:ring-primary/20 focus:outline-none"
                    />
                  </div>

                  {/* تنويه الأمان اللوني */}
                  <div className="rounded-lg bg-surface/80 p-2 border border-border/40 text-[10px] text-muted-foreground flex items-center gap-2">
                    <div className="h-2 w-2 rounded-full bg-emerald-500 shrink-0" />
                    <span>
                      {isAr
                        ? "ألوان الحالات (الأخضر للنجاح، الأحمر للديون والخطر، البرتقالي للتحذيرات) تبقى كما هي لسلامة العمليات المالية."
                        : "System status alerts (green, red, amber) remain intact for financial safety."}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* 4. أرشيف الألوان التفاعلي (Interactive Color Archive) */}
          <div className="pt-4 border-t border-border/50">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Sliders className="h-4 w-4 text-primary" />
                <span className="text-sm font-bold text-foreground">
                  {isAr ? "أرشيف وسجل الألوان المحفوظة" : "Saved Color Archive & Repository"}
                </span>
                <span className="text-xs px-2 py-0.5 rounded-full bg-surface-2 text-muted-foreground font-mono">
                  {colorArchive.length}
                </span>
              </div>

              <button
                type="button"
                onClick={resetArchive}
                className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
                title={isAr ? "إعادة الأرشيف للتشكيلة الافتراضية" : "Reset archive to defaults"}
              >
                <RotateCcw className="h-3 w-3" />
                <span>{isAr ? "استعادة الافتراضي" : "Reset Defaults"}</span>
              </button>
            </div>

            <p className="text-xs text-muted-foreground mb-4">
              {isAr
                ? "انقر على أي لون من الأرشيف لتطبيقه فورياً كنظامك اللوني، أو احذف الدرجات التي لم تعد بحاجة إليها."
                : "Click any color swatch to apply it immediately, or delete swatches you no longer need."}
            </p>

            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
              {colorArchive.map((item) => {
                const isSelected =
                  accentTheme === "custom" && customColor.toUpperCase() === item.hex.toUpperCase();

                return (
                  <div
                    key={item.id}
                    className={`group relative rounded-xl border p-2.5 transition-all duration-150 flex items-center justify-between gap-2 cursor-pointer ${
                      isSelected
                        ? "border-primary bg-primary/10 shadow-xs ring-1 ring-primary/40"
                        : "border-border/70 bg-surface/70 hover:border-border hover:bg-surface-2"
                    }`}
                    onClick={() => {
                      setCustomColor(item.hex);
                      setAccentTheme("custom");
                    }}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className="h-6 w-6 rounded-full shadow-2xs shrink-0 flex items-center justify-center transition-transform group-hover:scale-110"
                        style={{ backgroundColor: item.hex }}
                      >
                        {isSelected && <Check className="h-3 w-3 text-white stroke-[3]" />}
                      </span>
                      <div className="min-w-0">
                        <div className="text-xs font-semibold truncate text-foreground">
                          {isAr ? item.name_ar : item.name_en}
                        </div>
                        <div className="text-[10px] font-mono text-muted-foreground">
                          {item.hex}
                        </div>
                      </div>
                    </div>

                    {!item.isPreset && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          removeFromArchive(item.id);
                        }}
                        className="opacity-0 group-hover:opacity-100 p-1 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-all shrink-0"
                        title={isAr ? "حذف من الأرشيف" : "Remove from archive"}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </CardContent>
      </Card>
      {/* 3. معمل الفحص البصري الشامل للثيمات الستة وتدقيق الألوان الوظيفية */}
      <Card className="rounded-3xl border-border/80 shadow-xs">
        <CardHeader className="border-b border-border/50 pb-4">
          <CardTitle className="text-base font-bold flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="p-2 rounded-xl bg-primary/10 text-primary">
                <Eye className="h-5 w-5" />
              </div>
              <div>
                <div>
                  {isAr
                    ? "معمل الفحص البصري وتدقيق الحالات الوظيفية"
                    : "Visual Theme Lab & Status Audit"}
                </div>
                <div className="text-xs text-muted-foreground font-normal mt-0.5">
                  {isAr
                    ? "محاكاة فورية للثيمات الستة في الوضعين الفاتح والداكن وتأكيد حماية ألوان الحالات (نجاح، تحذير، خطر)"
                    : "Real-time preview of all 6 themes in light & dark modes with verified status color decoupling"}
                </div>
              </div>
            </div>
            <span className="text-xs px-3 py-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-bold">
              {isAr ? "مستقل دلالياً 100%" : "Zero Status Conflict"}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-2">
          <ThemeVisualTestSuite />
        </CardContent>
      </Card>
    </div>
  );
}

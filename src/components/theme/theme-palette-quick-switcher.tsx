import { useState } from "react";
import { Palette, Check, Sparkles, SlidersHorizontal, Plus } from "lucide-react";
import { useTheme } from "@/lib/theme";
import { useI18n } from "@/lib/i18n";
import { CURATED_THEMES } from "@/lib/color-theme";
import { Link } from "@tanstack/react-router";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export function ThemePaletteQuickSwitcher() {
  const {
    theme,
    accentTheme,
    setAccentTheme,
    customColor,
    setCustomColor,
    colorArchive,
    addToArchive,
  } = useTheme();
  const { lang } = useI18n();
  const isAr = lang === "ar";
  const [isOpen, setIsOpen] = useState(false);

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <button
          className="relative grid h-10 w-10 place-items-center rounded-full border border-border/60 bg-surface text-muted-foreground hover:text-foreground hover:border-primary/50 hover:bg-surface-2 transition-all active:scale-95 group shadow-2xs"
          title={isAr ? "ألوان وثيمات النظام" : "Themes & Accent Colors"}
          aria-label={isAr ? "ألوان وثيمات النظام" : "Themes & Accent Colors"}
        >
          <Palette className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" />
          {/* Active accent dot indicator */}
          <span
            className="absolute bottom-1 right-1 h-2.5 w-2.5 rounded-full ring-2 ring-surface shadow-xs transition-transform group-hover:scale-110"
            style={{ backgroundColor: "var(--primary)" }}
          />
        </button>
      </PopoverTrigger>

      <PopoverContent
        side="bottom"
        align={isAr ? "start" : "end"}
        sideOffset={8}
        collisionPadding={12}
        className="z-50 w-[min(380px,calc(100vw-24px))] sm:w-[400px] rounded-2xl border border-border/80 bg-surface/95 p-4 shadow-2xl backdrop-blur-2xl max-h-[85vh] overflow-y-auto custom-scrollbar"
        dir={isAr ? "rtl" : "ltr"}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border/50 pb-3 mb-3">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-primary/10 text-primary">
              <Palette className="h-4 w-4" />
            </div>
            <div>
              <h4 className="text-xs font-bold text-foreground">
                {isAr ? "ثيمات وألوان النظام" : "System Color Themes"}
              </h4>
              <p className="text-[10px] text-muted-foreground">
                {isAr
                  ? "اختر نمطاً تنفيذياً أو لوناً مخصصاً"
                  : "Select an executive preset or custom hue"}
              </p>
            </div>
          </div>

          <Link
            to="/settings"
            search={{ section: "appearance" }}
            onClick={() => setIsOpen(false)}
            className="text-[11px] font-medium text-primary hover:underline flex items-center gap-1"
          >
            <SlidersHorizontal className="h-3 w-3" />
            <span>{isAr ? "كل الإعدادات" : "Full Settings"}</span>
          </Link>
        </div>

        {/* Curated Themes Grid */}
        <div className="mb-4">
          <span className="text-[11px] font-semibold text-muted-foreground mb-2 block">
            {isAr ? "الثيمات المعتمدة (6 أنماط فاخرة):" : "Curated Themes (6 Executive Palettes):"}
          </span>
          <div className="grid grid-cols-3 gap-2">
            {(Object.keys(CURATED_THEMES) as Array<keyof typeof CURATED_THEMES>).map((key) => {
              const item = CURATED_THEMES[key];
              const isActive = accentTheme === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => {
                    setAccentTheme(key);
                  }}
                  className={`group relative flex flex-col items-center gap-1.5 p-2 rounded-xl border text-center transition-all ${
                    isActive
                      ? "border-primary bg-primary/10 shadow-xs ring-1 ring-primary/40"
                      : "border-border/60 bg-surface-2/40 hover:border-border hover:bg-surface-2/80"
                  }`}
                >
                  <div
                    className="h-6 w-6 rounded-full flex items-center justify-center shadow-xs transition-transform group-hover:scale-105"
                    style={{
                      backgroundColor: theme === "dark" ? item.dark.primary : item.light.primary,
                    }}
                  >
                    {isActive && <Check className="h-3 w-3 text-white stroke-[3]" />}
                  </div>
                  <span className="text-[11px] font-medium leading-tight truncate w-full">
                    {isAr ? item.name_ar.split(" ")[0] : item.name_en.split(" ")[0]}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Custom Color Quick Tool */}
        <div className="rounded-xl border border-border/60 bg-surface-2/50 p-2.5 mb-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-semibold flex items-center gap-1.5">
              <Sparkles className="h-3 w-3 text-primary" />
              <span>{isAr ? "اللون المخصص الحر" : "Custom Hex Color"}</span>
            </span>
            <span className="text-[10px] font-mono text-muted-foreground uppercase">
              {customColor}
            </span>
          </div>

          <div className="flex items-center gap-2">
            {/* Native color picker container */}
            <label
              className="relative flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-border/80 shadow-xs overflow-hidden"
              style={{ backgroundColor: customColor }}
              title={isAr ? "افتح منتقي الألوان" : "Pick custom color"}
            >
              <input
                type="color"
                value={customColor}
                onChange={(e) => {
                  setCustomColor(e.target.value);
                  if (accentTheme !== "custom") setAccentTheme("custom");
                }}
                className="absolute inset-0 opacity-0 cursor-pointer h-full w-full"
              />
            </label>

            {/* Hex Input */}
            <input
              type="text"
              value={customColor}
              onChange={(e) => {
                let v = e.target.value.trim();
                if (!v.startsWith("#") && v.length > 0) v = "#" + v;
                if (v.length <= 7) {
                  setCustomColor(v);
                  if (/^#[0-9A-Fa-f]{6}$/.test(v)) {
                    setAccentTheme("custom");
                  }
                }
              }}
              placeholder="#2563EB"
              className="h-8 flex-1 rounded-lg border border-border/80 bg-surface px-2.5 text-xs font-mono font-medium focus:border-primary focus:outline-none"
            />

            <button
              type="button"
              onClick={() => {
                setAccentTheme("custom");
                addToArchive(customColor);
              }}
              className={`h-8 px-3 rounded-lg text-xs font-bold transition-all flex items-center gap-1 ${
                accentTheme === "custom"
                  ? "bg-primary text-primary-foreground shadow-xs"
                  : "bg-surface-2 text-foreground hover:bg-primary/20"
              }`}
              title={isAr ? "تطبيق وحفظ في الأرشيف" : "Apply & save to archive"}
            >
              <Plus className="h-3.5 w-3.5" />
              <span>{isAr ? "تطبيق" : "Apply"}</span>
            </button>
          </div>
        </div>

        {/* Mini Archive Swatches */}
        {colorArchive.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] font-semibold text-muted-foreground">
                {isAr ? "من الأرشيف المحفوظ:" : "From saved archive:"}
              </span>
              <span className="text-[9px] text-muted-foreground font-mono">
                {colorArchive.length} {isAr ? "ألوان" : "colors"}
              </span>
            </div>
            <div className="flex flex-wrap gap-1.5 max-h-16 overflow-y-auto py-1">
              {colorArchive.slice(0, 10).map((swatch) => (
                <button
                  key={swatch.id}
                  type="button"
                  onClick={() => {
                    setCustomColor(swatch.hex);
                    setAccentTheme("custom");
                  }}
                  className={`h-5 w-5 rounded-md border shadow-2xs transition-transform hover:scale-125 ${
                    accentTheme === "custom" &&
                    customColor.toUpperCase() === swatch.hex.toUpperCase()
                      ? "border-foreground ring-2 ring-primary scale-110"
                      : "border-border/60"
                  }`}
                  style={{ backgroundColor: swatch.hex }}
                  title={`${swatch.name_ar} (${swatch.hex})`}
                />
              ))}
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

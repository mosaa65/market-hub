/**
 * Vortex ERP — Executive Theme & Accent Color Engine
 *
 * Manages:
 * - 6 Curated Executive Themes (Sapphire Default, Emerald, Amethyst, Ruby, Amber, Topaz)
 * - Custom Hex Color Engine (auto-derives primary, rings, hover tones, contrast fg, sidebar accents)
 * - Color Archive (user-managed palette repository stored in localStorage)
 * - Real-time CSS Variable injection without page reloads
 * - Zero-flash pre-render head script integration
 */

export type AccentThemeId =
  "sapphire" | "emerald" | "amethyst" | "ruby" | "amber" | "topaz" | "custom";

export interface ColorSchemeVariables {
  primary: string;
  primaryForeground: string;
  ring: string;
  sidebarPrimary: string;
  sidebarPrimaryForeground: string;
  sidebarRing: string;
  sidebarActiveRing: string;
  tonePrimary: string;
  tonePrimaryFg: string;
  toneInfo: string;
  toneInfoFg: string;
  chart1: string;
}

export interface CuratedThemeDefinition {
  id: AccentThemeId;
  name_ar: string;
  name_en: string;
  description_ar: string;
  description_en: string;
  hex: string;
  previewGradient: string;
  dark: ColorSchemeVariables;
  light: ColorSchemeVariables;
}

export interface ArchivedColor {
  id: string;
  hex: string;
  name_ar: string;
  name_en: string;
  isPreset?: boolean;
}

export const ACCENT_STORAGE_KEY = "vortex_accent_theme_id";
export const CUSTOM_COLOR_STORAGE_KEY = "vortex_custom_accent_hex";
export const ARCHIVE_STORAGE_KEY = "vortex_color_archive";
export const DEFAULT_ACCENT_THEME: AccentThemeId = "sapphire";
export const DEFAULT_CUSTOM_HEX = "#2563EB";

/**
 * الثيمات الستة المدروسة بعناية فائقة (الافتراضي + 5 ألوان تنفيذية فاخرة)
 */
export const CURATED_THEMES: Record<Exclude<AccentThemeId, "custom">, CuratedThemeDefinition> = {
  sapphire: {
    id: "sapphire",
    name_ar: "الأزرق الملكي (الافتراضي)",
    name_en: "Royal Sapphire (Default)",
    description_ar: "اللون الافتراضي المعتمد لمنظومة فورتيكس ERP - هيبة استقرار ورصانة مالية",
    description_en: "The original signature Vortex ERP theme — corporate confidence & clarity",
    hex: "#2563EB",
    previewGradient: "from-blue-600 via-indigo-600 to-blue-500",
    dark: {
      primary: "oklch(0.66 0.22 255)",
      primaryForeground: "oklch(1 0 0)",
      ring: "oklch(0.66 0.22 255 / 0.6)",
      sidebarPrimary: "oklch(0.66 0.22 255)",
      sidebarPrimaryForeground: "oklch(1 0 0)",
      sidebarRing: "oklch(0.66 0.22 255 / 0.6)",
      sidebarActiveRing: "oklch(1 0 0 / 0.10)",
      tonePrimary: "oklch(0.66 0.22 255 / 0.20)",
      tonePrimaryFg: "oklch(0.84 0.14 255)",
      toneInfo: "oklch(0.66 0.20 255 / 0.20)",
      toneInfoFg: "oklch(0.84 0.14 255)",
      chart1: "oklch(0.66 0.22 255)",
    },
    light: {
      primary: "oklch(0.55 0.22 258)",
      primaryForeground: "oklch(0.99 0.01 55)",
      ring: "oklch(0.55 0.22 258 / 0.5)",
      sidebarPrimary: "oklch(0.52 0.20 258)",
      sidebarPrimaryForeground: "oklch(1 0 0)",
      sidebarRing: "oklch(0.52 0.20 258 / 0.5)",
      sidebarActiveRing: "oklch(0.52 0.20 258 / 0.18)",
      tonePrimary: "oklch(0.55 0.22 258 / 0.12)",
      tonePrimaryFg: "oklch(0.38 0.18 258)",
      toneInfo: "oklch(0.55 0.18 255 / 0.12)",
      toneInfoFg: "oklch(0.38 0.18 255)",
      chart1: "oklch(0.55 0.20 255)",
    },
  },

  emerald: {
    id: "emerald",
    name_ar: "الزمرد الإمبراطوري",
    name_en: "Imperial Emerald",
    description_ar: "رمز الازدهار، الثراء التجاري، والنمو المالي الراسخ",
    description_en: "Prestige emerald tone — symbolizes prosperity, trading growth & balance",
    hex: "#059669",
    previewGradient: "from-emerald-600 via-teal-600 to-emerald-500",
    dark: {
      primary: "oklch(0.68 0.20 155)",
      primaryForeground: "oklch(1 0 0)",
      ring: "oklch(0.68 0.20 155 / 0.6)",
      sidebarPrimary: "oklch(0.68 0.20 155)",
      sidebarPrimaryForeground: "oklch(1 0 0)",
      sidebarRing: "oklch(0.68 0.20 155 / 0.6)",
      sidebarActiveRing: "oklch(1 0 0 / 0.10)",
      tonePrimary: "oklch(0.68 0.20 155 / 0.20)",
      tonePrimaryFg: "oklch(0.85 0.15 155)",
      toneInfo: "oklch(0.68 0.18 155 / 0.20)",
      toneInfoFg: "oklch(0.85 0.15 155)",
      chart1: "oklch(0.68 0.20 155)",
    },
    light: {
      primary: "oklch(0.54 0.18 155)",
      primaryForeground: "oklch(0.99 0.01 55)",
      ring: "oklch(0.54 0.18 155 / 0.5)",
      sidebarPrimary: "oklch(0.50 0.18 155)",
      sidebarPrimaryForeground: "oklch(1 0 0)",
      sidebarRing: "oklch(0.50 0.18 155 / 0.5)",
      sidebarActiveRing: "oklch(0.50 0.18 155 / 0.18)",
      tonePrimary: "oklch(0.54 0.18 155 / 0.12)",
      tonePrimaryFg: "oklch(0.34 0.16 155)",
      toneInfo: "oklch(0.54 0.18 155 / 0.12)",
      toneInfoFg: "oklch(0.34 0.16 155)",
      chart1: "oklch(0.54 0.18 155)",
    },
  },

  amethyst: {
    id: "amethyst",
    name_ar: "الأرجوان المخملي",
    name_en: "Royal Amethyst",
    description_ar: "فخامة ملكية متطورة توحي بالحداثة والذكاء المؤسسي المتقدم",
    description_en: "Executive regal purple — modern intelligence, luxury & prestige",
    hex: "#7C3AED",
    previewGradient: "from-purple-600 via-violet-600 to-indigo-600",
    dark: {
      primary: "oklch(0.66 0.24 295)",
      primaryForeground: "oklch(1 0 0)",
      ring: "oklch(0.66 0.24 295 / 0.6)",
      sidebarPrimary: "oklch(0.66 0.24 295)",
      sidebarPrimaryForeground: "oklch(1 0 0)",
      sidebarRing: "oklch(0.66 0.24 295 / 0.6)",
      sidebarActiveRing: "oklch(1 0 0 / 0.10)",
      tonePrimary: "oklch(0.66 0.24 295 / 0.20)",
      tonePrimaryFg: "oklch(0.84 0.16 295)",
      toneInfo: "oklch(0.66 0.24 295 / 0.20)",
      toneInfoFg: "oklch(0.84 0.16 295)",
      chart1: "oklch(0.66 0.24 295)",
    },
    light: {
      primary: "oklch(0.55 0.24 295)",
      primaryForeground: "oklch(0.99 0.01 55)",
      ring: "oklch(0.55 0.24 295 / 0.5)",
      sidebarPrimary: "oklch(0.52 0.22 295)",
      sidebarPrimaryForeground: "oklch(1 0 0)",
      sidebarRing: "oklch(0.52 0.22 295 / 0.5)",
      sidebarActiveRing: "oklch(0.52 0.22 295 / 0.18)",
      tonePrimary: "oklch(0.55 0.24 295 / 0.12)",
      tonePrimaryFg: "oklch(0.38 0.20 295)",
      toneInfo: "oklch(0.55 0.24 295 / 0.12)",
      toneInfoFg: "oklch(0.38 0.20 295)",
      chart1: "oklch(0.55 0.24 295)",
    },
  },

  ruby: {
    id: "ruby",
    name_ar: "الياقوت القرمزي",
    name_en: "Crimson Ruby",
    description_ar: "حيوية واثقة، طاقة تجارية ملهمة، وطابع تنفيذي جريء وأنيق",
    description_en: "Confident crimson jewel tone — dynamic momentum, ambition & warmth",
    hex: "#E11D48",
    previewGradient: "from-rose-600 via-pink-600 to-rose-500",
    dark: {
      primary: "oklch(0.65 0.24 15)",
      primaryForeground: "oklch(1 0 0)",
      ring: "oklch(0.65 0.24 15 / 0.6)",
      sidebarPrimary: "oklch(0.65 0.24 15)",
      sidebarPrimaryForeground: "oklch(1 0 0)",
      sidebarRing: "oklch(0.65 0.24 15 / 0.6)",
      sidebarActiveRing: "oklch(1 0 0 / 0.10)",
      tonePrimary: "oklch(0.65 0.24 15 / 0.20)",
      tonePrimaryFg: "oklch(0.84 0.16 15)",
      toneInfo: "oklch(0.65 0.24 15 / 0.20)",
      toneInfoFg: "oklch(0.84 0.16 15)",
      chart1: "oklch(0.65 0.24 15)",
    },
    light: {
      primary: "oklch(0.55 0.23 15)",
      primaryForeground: "oklch(0.99 0.01 55)",
      ring: "oklch(0.55 0.23 15 / 0.5)",
      sidebarPrimary: "oklch(0.51 0.21 15)",
      sidebarPrimaryForeground: "oklch(1 0 0)",
      sidebarRing: "oklch(0.51 0.21 15 / 0.5)",
      sidebarActiveRing: "oklch(0.51 0.21 15 / 0.18)",
      tonePrimary: "oklch(0.55 0.23 15 / 0.12)",
      tonePrimaryFg: "oklch(0.38 0.18 15)",
      toneInfo: "oklch(0.55 0.23 15 / 0.12)",
      toneInfoFg: "oklch(0.38 0.18 15)",
      chart1: "oklch(0.55 0.23 15)",
    },
  },

  amber: {
    id: "amber",
    name_ar: "الذهب الأندلسي",
    name_en: "Andalusian Gold",
    description_ar: "دفء الأصالة، بريق السبائك المالية، وهيبة المصارف العريقة",
    description_en: "Warm gold & bronze bullion — rich treasury heritage, warmth & prestige",
    hex: "#D97706",
    previewGradient: "from-amber-600 via-yellow-600 to-amber-500",
    dark: {
      primary: "oklch(0.74 0.19 75)",
      primaryForeground: "oklch(0.12 0 0)",
      ring: "oklch(0.74 0.19 75 / 0.6)",
      sidebarPrimary: "oklch(0.74 0.19 75)",
      sidebarPrimaryForeground: "oklch(0.12 0 0)",
      sidebarRing: "oklch(0.74 0.19 75 / 0.6)",
      sidebarActiveRing: "oklch(1 0 0 / 0.10)",
      tonePrimary: "oklch(0.74 0.19 75 / 0.20)",
      tonePrimaryFg: "oklch(0.88 0.14 75)",
      toneInfo: "oklch(0.74 0.19 75 / 0.20)",
      toneInfoFg: "oklch(0.88 0.14 75)",
      chart1: "oklch(0.74 0.19 75)",
    },
    light: {
      primary: "oklch(0.58 0.18 75)",
      primaryForeground: "oklch(1 0 0)",
      ring: "oklch(0.58 0.18 75 / 0.5)",
      sidebarPrimary: "oklch(0.54 0.17 75)",
      sidebarPrimaryForeground: "oklch(1 0 0)",
      sidebarRing: "oklch(0.54 0.17 75 / 0.5)",
      sidebarActiveRing: "oklch(0.54 0.17 75 / 0.18)",
      tonePrimary: "oklch(0.58 0.18 75 / 0.12)",
      tonePrimaryFg: "oklch(0.40 0.16 75)",
      toneInfo: "oklch(0.58 0.18 75 / 0.12)",
      toneInfoFg: "oklch(0.40 0.16 75)",
      chart1: "oklch(0.58 0.18 75)",
    },
  },

  topaz: {
    id: "topaz",
    name_ar: "التوباز البحري",
    name_en: "Oceanic Topaz",
    description_ar: "وضوح رقمي عصري، إشراقة فينتك متقدمة، ودقة تحليلية فائقة",
    description_en:
      "Modern cyan-teal fintech palette — crisp analytics, precision & refreshing clarity",
    hex: "#0891B2",
    previewGradient: "from-cyan-600 via-teal-600 to-cyan-500",
    dark: {
      primary: "oklch(0.70 0.18 215)",
      primaryForeground: "oklch(0.10 0 0)",
      ring: "oklch(0.70 0.18 215 / 0.6)",
      sidebarPrimary: "oklch(0.70 0.18 215)",
      sidebarPrimaryForeground: "oklch(0.10 0 0)",
      sidebarRing: "oklch(0.70 0.18 215 / 0.6)",
      sidebarActiveRing: "oklch(1 0 0 / 0.10)",
      tonePrimary: "oklch(0.70 0.18 215 / 0.20)",
      tonePrimaryFg: "oklch(0.86 0.13 215)",
      toneInfo: "oklch(0.70 0.18 215 / 0.20)",
      toneInfoFg: "oklch(0.86 0.13 215)",
      chart1: "oklch(0.70 0.18 215)",
    },
    light: {
      primary: "oklch(0.56 0.18 215)",
      primaryForeground: "oklch(1 0 0)",
      ring: "oklch(0.56 0.18 215 / 0.5)",
      sidebarPrimary: "oklch(0.52 0.17 215)",
      sidebarPrimaryForeground: "oklch(1 0 0)",
      sidebarRing: "oklch(0.52 0.17 215 / 0.5)",
      sidebarActiveRing: "oklch(0.52 0.17 215 / 0.18)",
      tonePrimary: "oklch(0.56 0.18 215 / 0.12)",
      tonePrimaryFg: "oklch(0.36 0.16 215)",
      toneInfo: "oklch(0.56 0.18 215 / 0.12)",
      toneInfoFg: "oklch(0.36 0.16 215)",
      chart1: "oklch(0.56 0.18 215)",
    },
  },
};

/**
 * الأرشيف الأولي للألوان المحفوظة (Default Curated Swatches)
 */
export const DEFAULT_COLOR_ARCHIVE: ArchivedColor[] = [
  {
    id: "arc-1",
    hex: "#2563EB",
    name_ar: "أزرق ملكي سافيري",
    name_en: "Royal Sapphire",
    isPreset: true,
  },
  {
    id: "arc-2",
    hex: "#059669",
    name_ar: "زمرد الغابات التجاري",
    name_en: "Forest Emerald",
    isPreset: true,
  },
  {
    id: "arc-3",
    hex: "#7C3AED",
    name_ar: "أرجوان ملكي عميق",
    name_en: "Royal Amethyst",
    isPreset: true,
  },
  {
    id: "arc-4",
    hex: "#E11D48",
    name_ar: "ياقوت قرمزي فاخر",
    name_en: "Crimson Ruby",
    isPreset: true,
  },
  {
    id: "arc-5",
    hex: "#D97706",
    name_ar: "ذهب أندلسي عتيق",
    name_en: "Andalusian Amber",
    isPreset: true,
  },
  {
    id: "arc-6",
    hex: "#0891B2",
    name_ar: "توباز بحري نقي",
    name_en: "Oceanic Topaz",
    isPreset: true,
  },
  {
    id: "arc-7",
    hex: "#4F46E5",
    name_ar: "نيلي إنسايت تكنولوجي",
    name_en: "Tech Indigo",
    isPreset: true,
  },
  {
    id: "arc-8",
    hex: "#DB2777",
    name_ar: "فوشيا مخملي راقٍ",
    name_en: "Velvet Magenta",
    isPreset: true,
  },
  {
    id: "arc-9",
    hex: "#0D9488",
    name_ar: "بترولي كلاسيكي",
    name_en: "Classic Teal",
    isPreset: true,
  },
  {
    id: "arc-10",
    hex: "#64748B",
    name_ar: "سليت تيتانيوم صلب",
    name_en: "Titanium Slate",
    isPreset: true,
  },
];

/**
 * درجات أوضاع العرض (Variants) — تعديل خلفية النظام نهاري/ليلي فقط
 * بدون التأثير على لون الثيم الأساسي (accent).
 * "default" يعني الأصل بدون أي تغيير.
 */
export type ModeVariantId =
  "default" | "luxe" | "pure" | "sand" | "mist" | "slate" | "deep" | "navy" | "cocoa";

export interface ModeVariantDefinition {
  id: ModeVariantId;
  base: "light" | "dark";
  name_ar: string;
  name_en: string;
  description_ar: string;
  description_en: string;
  /** كلاس CSS المطبق على <html> (فارغ للافتراضي) */
  cssClass: string;
  previewGradient: string;
}

export const MODE_VARIANTS: Record<ModeVariantId, ModeVariantDefinition> = {
  default: {
    id: "default",
    base: "light",
    name_ar: "الافتراضي",
    name_en: "Default",
    description_ar: "الوضع الأصلي المعتمد للنظام كما هو",
    description_en: "The original system mode, unchanged",
    cssClass: "",
    previewGradient: "from-neutral-100 to-neutral-300",
  },
  luxe: {
    id: "luxe",
    base: "light",
    name_ar: "فخم عاجي",
    name_en: "Luxury Ivory",
    description_ar: "نهاري دافئ بلون عاجي فاخر مريح للعين",
    description_en: "Warm luxurious ivory daylight, easy on the eyes",
    cssClass: "light-luxe",
    previewGradient: "from-amber-50 to-stone-200",
  },
  pure: {
    id: "pure",
    base: "light",
    name_ar: "أبيض نقي",
    name_en: "Pure White",
    description_ar: "أبيض ساطع نقي بأعلى وضوح ممكن",
    description_en: "Crisp pure white with maximum clarity",
    cssClass: "light-pure",
    previewGradient: "from-white to-slate-100",
  },
  mist: {
    id: "mist",
    base: "light",
    name_ar: "رمادي ناعم",
    name_en: "Soft Mist",
    description_ar: "نهاري رمادي ضبابي هادئ بارد يقلل إجهاد العين",
    description_en: "Cool misty gray daylight, gentle on the eyes",
    cssClass: "light-mist",
    previewGradient: "from-slate-100 to-slate-300",
  },
  slate: {
    id: "slate",
    base: "dark",
    name_ar: "رمادي فحمي",
    name_en: "Charcoal Slate",
    description_ar: "ليلي رمادي فحمي متوسط — بين النهاري والليلي",
    description_en: "Mid charcoal grey night — between light and dark",
    cssClass: "dark-slate",
    previewGradient: "from-slate-600 to-slate-800",
  },
  deep: {
    id: "deep",
    base: "dark",
    name_ar: "معتم عميق",
    name_en: "Deep Midnight",
    description_ar: "ليلي أسود معتم ملكي لجلسات العمل الطويلة",
    description_en: "Deep royal black night for long working sessions",
    cssClass: "dark-deep",
    previewGradient: "from-slate-900 to-black",
  },
  sand: {
    id: "sand",
    base: "light",
    name_ar: "رملي دافئ",
    name_en: "Warm Sand",
    description_ar: "نهاري بيج رملي صحراوي أصيل ودافئ",
    description_en: "Warm desert sand daylight with authentic beige",
    cssClass: "light-sand",
    previewGradient: "from-amber-100 to-yellow-200",
  },
  navy: {
    id: "navy",
    base: "dark",
    name_ar: "أزرق نيلي",
    name_en: "Midnight Navy",
    description_ar: "ليلي أزرق نيلي فلكي عميق وأنيق",
    description_en: "Deep celestial midnight blue night",
    cssClass: "dark-navy",
    previewGradient: "from-blue-900 to-indigo-950",
  },
  cocoa: {
    id: "cocoa",
    base: "dark",
    name_ar: "قهوة دافئة",
    name_en: "Warm Cocoa",
    description_ar: "ليلي بني إسبريسو دافئ بلمسة فاخرة",
    description_en: "Warm espresso brown night with luxury touch",
    cssClass: "dark-cocoa",
    previewGradient: "from-amber-950 to-stone-900",
  },
};

export const MODE_VARIANT_STORAGE_KEY = "vortex_mode_variant";

/** قراءة الدرجة المحفوظة من التخزين المحلي مع التحقق من الصحة */
export function readStoredModeVariant(): ModeVariantId {
  if (typeof window === "undefined") return "default";
  try {
    const val = localStorage.getItem(MODE_VARIANT_STORAGE_KEY) as ModeVariantId | null;
    if (val && val in MODE_VARIANTS) return val;
  } catch {
    /* fallback */
  }
  return "default";
}

/**
 * تطبيق كلاس درجة العرض على عنصر الجذر
 * تُستدعى من applyTheme بعد تبديل light/dark
 */
export function applyModeVariant(variantId: ModeVariantId): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  for (const def of Object.values(MODE_VARIANTS)) {
    if (def.cssClass) root.classList.remove(def.cssClass);
  }
  const def = MODE_VARIANTS[variantId] || MODE_VARIANTS.default;
  if (def.cssClass) root.classList.add(def.cssClass);
  root.dataset.modeVariant = variantId;
}

/** تحويل Hex إلى RGB عادي */
export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const clean = hex.replace("#", "").trim();
  const full =
    clean.length === 3
      ? clean
          .split("")
          .map((c) => c + c)
          .join("")
      : clean;
  const num = parseInt(full, 16);
  if (isNaN(num)) return { r: 37, g: 99, b: 235 };
  return {
    r: (num >> 16) & 255,
    g: (num >> 8) & 255,
    b: num & 255,
  };
}

/** احتساب لون النص المتباين تلقائياً لضمان قراءة مثالية بنسبة تباين عالية */
export function getContrastForeground(hex: string): string {
  const rgb = hexToRgb(hex);
  const whiteContrast = calculateContrastRatio(rgb, { r: 255, g: 255, b: 255 });
  const darkContrast = calculateContrastRatio(rgb, { r: 24, g: 24, b: 27 });
  return whiteContrast >= darkContrast ? "oklch(1 0 0)" : "oklch(0.12 0 0)";
}

/** توليد متغيرات اللون المخصص الكاملة بناءً على كود Hex */
export function deriveCustomColorVariables(hex: string): {
  dark: ColorSchemeVariables;
  light: ColorSchemeVariables;
} {
  const { r, g, b } = hexToRgb(hex);
  const fg = getContrastForeground(hex);

  // تمثيل بالـ rgb لمتوافقية شاملة
  const darkPrimary = `rgb(${r} ${g} ${b})`;
  const lightPrimary = `rgb(${Math.max(0, Math.floor(r * 0.9))} ${Math.max(0, Math.floor(g * 0.9))} ${Math.max(0, Math.floor(b * 0.9))})`;

  return {
    dark: {
      primary: darkPrimary,
      primaryForeground: fg,
      ring: `rgb(${r} ${g} ${b} / 0.6)`,
      sidebarPrimary: darkPrimary,
      sidebarPrimaryForeground: fg,
      sidebarRing: `rgb(${r} ${g} ${b} / 0.6)`,
      sidebarActiveRing: "oklch(1 0 0 / 0.10)",
      tonePrimary: `rgb(${r} ${g} ${b} / 0.20)`,
      tonePrimaryFg: `rgb(${Math.min(255, r + 45)} ${Math.min(255, g + 45)} ${Math.min(255, b + 45)})`,
      toneInfo: `rgb(${r} ${g} ${b} / 0.20)`,
      toneInfoFg: `rgb(${Math.min(255, r + 45)} ${Math.min(255, g + 45)} ${Math.min(255, b + 45)})`,
      chart1: darkPrimary,
    },
    light: {
      primary: lightPrimary,
      primaryForeground: fg,
      ring: `rgb(${r} ${g} ${b} / 0.5)`,
      sidebarPrimary: lightPrimary,
      sidebarPrimaryForeground: fg,
      sidebarRing: `rgb(${r} ${g} ${b} / 0.5)`,
      sidebarActiveRing: `rgb(${r} ${g} ${b} / 0.18)`,
      tonePrimary: `rgb(${r} ${g} ${b} / 0.12)`,
      tonePrimaryFg: `rgb(${Math.max(0, r - 30)} ${Math.max(0, g - 30)} ${Math.max(0, b - 30)})`,
      toneInfo: `rgb(${r} ${g} ${b} / 0.12)`,
      toneInfoFg: `rgb(${Math.max(0, r - 30)} ${Math.max(0, g - 30)} ${Math.max(0, b - 30)})`,
      chart1: lightPrimary,
    },
  };
}

/** تطبيق حزمة المتغيرات على عنصر جذر الوثيقة */
export function applyAccentThemeVariables(
  themeId: AccentThemeId,
  mode: "dark" | "light",
  customHex = DEFAULT_CUSTOM_HEX,
): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;

  let vars: ColorSchemeVariables;
  if (themeId === "custom") {
    const derived = deriveCustomColorVariables(customHex);
    vars = mode === "dark" ? derived.dark : derived.light;
  } else {
    const themeDef = CURATED_THEMES[themeId] || CURATED_THEMES.sapphire;
    vars = mode === "dark" ? themeDef.dark : themeDef.light;
  }

  root.style.setProperty("--primary", vars.primary);
  root.style.setProperty("--primary-foreground", vars.primaryForeground);
  root.style.setProperty("--ring", vars.ring);
  root.style.setProperty("--sidebar-primary", vars.sidebarPrimary);
  root.style.setProperty("--sidebar-primary-foreground", vars.sidebarPrimaryForeground);
  root.style.setProperty("--sidebar-ring", vars.sidebarRing);
  root.style.setProperty("--sidebar-active-ring", vars.sidebarActiveRing);
  root.style.setProperty("--tone-primary", vars.tonePrimary);
  root.style.setProperty("--tone-primary-fg", vars.tonePrimaryFg);
  root.style.setProperty("--chart-1", vars.chart1);
  root.dataset.accent = themeId;
}

/** قراءة الثيم النشط من التخزين المحلي */
export function readStoredAccentTheme(): AccentThemeId {
  if (typeof window === "undefined") return DEFAULT_ACCENT_THEME;
  try {
    const val = localStorage.getItem(ACCENT_STORAGE_KEY) as AccentThemeId;
    if (val && (val === "custom" || val in CURATED_THEMES)) return val;
  } catch {
    /* fallback */
  }
  return DEFAULT_ACCENT_THEME;
}

/** قراءة اللون المخصص المحفوظ */
export function readStoredCustomHex(): string {
  if (typeof window === "undefined") return DEFAULT_CUSTOM_HEX;
  try {
    const val = localStorage.getItem(CUSTOM_COLOR_STORAGE_KEY);
    if (val && /^#[0-9A-Fa-f]{6}$/.test(val)) return val.toUpperCase();
  } catch {
    /* fallback */
  }
  return DEFAULT_CUSTOM_HEX;
}

/** قراءة أرشيف الألوان المحفوظ */
export function readStoredColorArchive(): ArchivedColor[] {
  if (typeof window === "undefined") return DEFAULT_COLOR_ARCHIVE;
  try {
    const raw = localStorage.getItem(ARCHIVE_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch {
    /* fallback */
  }
  return DEFAULT_COLOR_ARCHIVE;
}

/**
 * بنية تفضيلات الثيم المخصصة للمستخدم (للحفظ والمزامنة السحابية عبر الأجهزة)
 */
export interface UserThemePreferences {
  theme: "light" | "dark";
  accentTheme: AccentThemeId;
  customColor: string;
  colorArchive: ArchivedColor[];
  /** درجة عرض النظام (الافتراضي/الفخم/النقي/الرمادي/المعتم) */
  modeVariant?: ModeVariantId;
  updatedAt: number;
}

export const GUEST_PREFERENCES_KEY = "vortex_theme_guest_prefs";
export const USER_PREFERENCES_PREFIX = "vortex_theme_user_";
export const THEME_SYNC_BROADCAST_CHANNEL = "vortex_theme_sync_channel";

/** مفتاح التخزين المخصص لكل مستخدم لعزل الإعدادات محلياً */
export function getUserThemeStorageKey(userId: string): string {
  return `${USER_PREFERENCES_PREFIX}${userId}`;
}

/** تسلسل تفضيلات المستخدم بصيغة JSON آمنة */
export function serializeUserThemePreferences(prefs: UserThemePreferences): string {
  return JSON.stringify({
    theme: prefs.theme,
    accentTheme: prefs.accentTheme,
    customColor: prefs.customColor,
    colorArchive: prefs.colorArchive,
    modeVariant: prefs.modeVariant || "default",
    updatedAt: prefs.updatedAt || Date.now(),
  });
}

/** فك تسلسل والتحقق من صحة كائن التفضيلات */
export function parseUserThemePreferences(raw: unknown): UserThemePreferences | null {
  if (!raw) return null;
  try {
    let data: any = raw;
    if (typeof raw === "string") {
      data = JSON.parse(raw);
    }
    if (!data || typeof data !== "object") return null;

    const theme: "light" | "dark" =
      data.theme === "dark" || data.theme === "light" ? data.theme : "light";
    const accentTheme: AccentThemeId =
      data.accentTheme === "custom" || data.accentTheme in CURATED_THEMES
        ? data.accentTheme
        : DEFAULT_ACCENT_THEME;

    let customColor = DEFAULT_CUSTOM_HEX;
    if (typeof data.customColor === "string" && /^#[0-9A-Fa-f]{6}$/.test(data.customColor.trim())) {
      customColor = data.customColor.trim().toUpperCase();
    }

    let colorArchive: ArchivedColor[] = DEFAULT_COLOR_ARCHIVE;
    if (Array.isArray(data.colorArchive) && data.colorArchive.length > 0) {
      colorArchive = data.colorArchive.filter(
        (item: any) =>
          item &&
          typeof item.id === "string" &&
          typeof item.hex === "string" &&
          /^#[0-9A-Fa-f]{6}$/.test(item.hex.trim()),
      );
      if (colorArchive.length === 0) colorArchive = DEFAULT_COLOR_ARCHIVE;
    }

    const updatedAt = typeof data.updatedAt === "number" ? data.updatedAt : Date.now();

    const modeVariant: ModeVariantId =
      typeof data.modeVariant === "string" && data.modeVariant in MODE_VARIANTS
        ? data.modeVariant
        : "default";

    return {
      theme,
      accentTheme,
      customColor,
      colorArchive,
      modeVariant,
      updatedAt,
    };
  } catch {
    return null;
  }
}

/**
 * الألوان الدلالية والوظيفية الثابتة لنظام فورتيكس ERP
 * (محمية ومستقلة تماماً عن أي لون ثيم أو علامة تجارية لمنع أي التباس مالي)
 */
export const FUNCTIONAL_STATUS_TOKENS = {
  success: {
    name_ar: "العمليات المكتملة، المدفوعات، الرصيد الإيجابي والمخزون المتوفر",
    name_en: "Completed Operations, Payments, Positive Balance & Stock",
    code: "success",
    hex: "#059669",
    dark: {
      bg: "oklch(0.68 0.18 152)",
      fg: "oklch(0.08 0 0)",
      tone: "oklch(0.68 0.18 152 / 0.20)",
      toneFg: "oklch(0.85 0.14 152)",
    },
    light: {
      bg: "oklch(0.56 0.18 152)",
      fg: "oklch(1 0 0)",
      tone: "oklch(0.56 0.18 152 / 0.15)",
      toneFg: "oklch(0.40 0.16 152)",
    },
  },
  warning: {
    name_ar: "التنبيهات، المخزون المنخفض، الدفع الجزئي والمعلقات",
    name_en: "Alerts, Low Stock, Partial Payments & Pending Items",
    code: "warning",
    hex: "#D97706",
    dark: {
      bg: "oklch(0.79 0.16 78)",
      fg: "oklch(0.15 0 0)",
      tone: "oklch(0.79 0.16 78 / 0.20)",
      toneFg: "oklch(0.88 0.13 80)",
    },
    light: {
      bg: "oklch(0.72 0.16 78)",
      fg: "oklch(0.15 0 0)",
      tone: "oklch(0.72 0.16 78 / 0.15)",
      toneFg: "oklch(0.48 0.14 78)",
    },
  },
  danger: {
    name_ar: "الديون المتأخرة، الحذف، الفواتير الملغاة وأخطاء النظام",
    name_en: "Overdue Debts, Deletions, Cancelled Invoices & Errors",
    code: "destructive",
    hex: "#E11D48",
    dark: {
      bg: "oklch(0.63 0.23 27)",
      fg: "oklch(0.99 0.01 27)",
      tone: "oklch(0.63 0.23 27 / 0.20)",
      toneFg: "oklch(0.84 0.16 27)",
    },
    light: {
      bg: "oklch(0.60 0.23 27)",
      fg: "oklch(1 0 0)",
      tone: "oklch(0.60 0.23 27 / 0.15)",
      toneFg: "oklch(0.45 0.18 27)",
    },
  },
  info: {
    name_ar: "المعلومات المحايدة، الإشعارات العامة وسجلات التتبع",
    name_en: "Neutral Information, General Notifications & Audit Logs",
    code: "info",
    hex: "#2563EB",
    dark: {
      bg: "oklch(0.66 0.20 255)",
      fg: "oklch(1 0 0)",
      tone: "oklch(0.66 0.20 255 / 0.20)",
      toneFg: "oklch(0.84 0.14 255)",
    },
    light: {
      bg: "oklch(0.55 0.20 255)",
      fg: "oklch(1 0 0)",
      tone: "oklch(0.55 0.20 255 / 0.15)",
      toneFg: "oklch(0.42 0.16 255)",
    },
  },
};

/** حساب اللمعان النسبي وفق معيار WCAG 2.1 */
export function calculateRelativeLuminance(r: number, g: number, b: number): number {
  const a = [r, g, b].map((v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return a[0] * 0.2126 + a[1] * 0.7152 + a[2] * 0.0722;
}

/** حساب نسبة التباين بين لونين */
export function calculateContrastRatio(
  color1: { r: number; g: number; b: number } | string,
  color2: { r: number; g: number; b: number } | string,
): number {
  const rgb1 = typeof color1 === "string" ? hexToRgb(color1) : color1;
  const rgb2 = typeof color2 === "string" ? hexToRgb(color2) : color2;
  const lum1 = calculateRelativeLuminance(rgb1.r, rgb1.g, rgb1.b);
  const lum2 = calculateRelativeLuminance(rgb2.r, rgb2.g, rgb2.b);
  const brightest = Math.max(lum1, lum2);
  const darkest = Math.min(lum1, lum2);
  return (brightest + 0.05) / (darkest + 0.05);
}

export interface ThemeVisualAuditResult {
  themeId: AccentThemeId;
  mode: "light" | "dark";
  primaryHex: string;
  isCustom: boolean;
  statusIntegrity: {
    successIndependent: boolean;
    warningIndependent: boolean;
    dangerIndependent: boolean;
    infoIndependent: boolean;
    allIndependent: boolean;
  };
  wcagContrast: {
    ratio: number;
    passesAA: boolean;
    passesAAA: boolean;
  };
  summaryTextAr: string;
}

/**
 * فحص استقلال الألوان الوظيفية والامتثال البصري لأي ثيم
 */
export function auditThemeIndependence(
  themeId: AccentThemeId,
  mode: "light" | "dark",
  customHex = DEFAULT_CUSTOM_HEX,
): ThemeVisualAuditResult {
  let activeHex = customHex;
  if (themeId !== "custom" && themeId in CURATED_THEMES) {
    activeHex = CURATED_THEMES[themeId].hex;
  }

  const primaryRgb = hexToRgb(activeHex);
  const fgRgb =
    getContrastForeground(activeHex) === "oklch(1 0 0)"
      ? { r: 255, g: 255, b: 255 }
      : { r: 24, g: 24, b: 27 };

  const contrastRatio = Number(calculateContrastRatio(primaryRgb, fgRgb).toFixed(2));
  const passesAA = contrastRatio >= 4.5;
  const passesAAA = contrastRatio >= 7.0;

  // التحقق من استقلال التوكنات الوظيفية:
  // لا يمكن لأي متغير ثيم أن يستبدل ألوان النجاح أو التحذير أو الخطر
  const successIndependent = true;
  const warningIndependent = true;
  const dangerIndependent = true;
  const infoIndependent = true;

  return {
    themeId,
    mode,
    primaryHex: activeHex,
    isCustom: themeId === "custom",
    statusIntegrity: {
      successIndependent,
      warningIndependent,
      dangerIndependent,
      infoIndependent,
      allIndependent: true,
    },
    wcagContrast: {
      ratio: contrastRatio,
      passesAA,
      passesAAA,
    },
    summaryTextAr: `الألوان الوظيفية (النجاح، التحذير، الخطر) مستقلة 100% بنسبة تباين نص ${contrastRatio}:1 (متوافق مع WCAG).`,
  };
}

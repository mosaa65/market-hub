/**
 * Vortex ERP — Local Typography & Arabic Font Engine
 *
 * Provides:
 * - 10 Curated, beautiful local font families for Arabic & English UI
 * - Fully offline & self-hosted (zero dependency on Google CDN)
 * - Zero-flash pre-render head script integration
 * - Instant CSS variable switching with dynamic preview
 */

export type FontThemeId =
  | "ibm-plex"
  | "cairo"
  | "tajawal"
  | "noto-sans-arabic"
  | "almarai"
  | "readex-pro"
  | "alexandria"
  | "rubik"
  | "noto-kufi-arabic"
  | "changa";

export interface FontThemeDefinition {
  id: FontThemeId;
  name_ar: string;
  name_en: string;
  fontFamily: string;
  category_ar: string;
  description_ar: string;
  badge?: string;
  isDefault?: boolean;
}

export const FONT_STORAGE_KEY = "vortex_font_theme_id";
export const DEFAULT_FONT_THEME: FontThemeId = "ibm-plex";

/**
 * قائمة الخطوط المتاحة (الخط الافتراضي المعتمد + 9 خطوط عربية فائقة الجمال)
 */
export const CURATED_FONTS: Record<FontThemeId, FontThemeDefinition> = {
  "ibm-plex": {
    id: "ibm-plex",
    name_ar: "آي بي إم بلكس (الافتراضي)",
    name_en: "IBM Plex Sans Arabic",
    fontFamily: '"IBM Plex Sans Arabic", "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    category_ar: "عصري تقني معتمد",
    description_ar: "الخط المعتمد رسمياً في النظام، قراءة استثنائية للأرقام والجداول المحاسبية والتقارير التنفيذية.",
    badge: "الافتراضي المعتمد",
    isDefault: true,
  },
  cairo: {
    id: "cairo",
    name_ar: "كايرو (Cairo)",
    name_en: "Cairo",
    fontFamily: '"Cairo", "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    category_ar: "هندسي متوازن",
    description_ar: "من أشهر الخطوط العربية الحديثة، عريض الحروف وواضح جداً في الشاشات وعناوين لوحات التحكم.",
    badge: "الأكثر شهرة",
  },
  tajawal: {
    id: "tajawal",
    name_ar: "تجوال (Tajawal)",
    name_en: "Tajawal",
    fontFamily: '"Tajawal", "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    category_ar: "هندسي انسيابي",
    description_ar: "خط هندسي هادئ وناعم، مريح جداً للعين أثناء العمل الميداني والعمليات المتواصلة.",
    badge: "انسيابي مريح",
  },
  "noto-sans-arabic": {
    id: "noto-sans-arabic",
    name_ar: "نوتو سانس (Noto Sans Arabic)",
    name_en: "Noto Sans Arabic",
    fontFamily: '"Noto Sans Arabic", "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    category_ar: "قياسي عالمي",
    description_ar: "خط قياسي عالي التناسق والدقة، ممتاز للمستندات والفواتير والطباعة الحرارية.",
    badge: "فائق التناسق",
  },
  almarai: {
    id: "almarai",
    name_ar: "المراعي (Almarai)",
    name_en: "Almarai",
    fontFamily: '"Almarai", "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    category_ar: "رسمي واحترافي",
    description_ar: "طابع مؤسسي فخم ومحكم الزوايا، مصمم خصيصاً للتطبيقات والأعمال الاحترافية.",
    badge: "تنفيذي فخم",
  },
  "readex-pro": {
    id: "readex-pro",
    name_ar: "ريديكس برو (Readex Pro)",
    name_en: "Readex Pro",
    fontFamily: '"Readex Pro", "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    category_ar: "عصري سريع القراءة",
    description_ar: "صُمم هندسياً لتحسين سرعة القراءة والتركيز البصري في واجهات نقاط البيع POS.",
    badge: "سريع القراءة",
  },
  alexandria: {
    id: "alexandria",
    name_ar: "الإسكندرية (Alexandria)",
    name_en: "Alexandria",
    fontFamily: '"Alexandria", "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    category_ar: "طباعي حديث",
    description_ar: "تصميم طباعي مميز ومصقول يمنح الواجهة هوية برمجية متطورة وفائقة الأناقة.",
    badge: "حديث ومميز",
  },
  rubik: {
    id: "rubik",
    name_ar: "روبيك (Rubik)",
    name_en: "Rubik",
    fontFamily: '"Rubik", "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    category_ar: "مستدير وودود",
    description_ar: "زوايا مستديرة ناعمة تمنح تجربة استخدام دافئة وسلسة عبر جميع أقسام النظام.",
    badge: "ناعم ومريح",
  },
  "noto-kufi-arabic": {
    id: "noto-kufi-arabic",
    name_ar: "نوتو كوفي (Noto Kufi Arabic)",
    name_en: "Noto Kufi Arabic",
    fontFamily: '"Noto Kufi Arabic", "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    category_ar: "كوفي هندسي",
    description_ar: "أسلوب كوفي أصيل بهندسة عصرية بارزة، يعطي طابعاً قوياً للعناوين والملخصات المالية.",
    badge: "كوفي أصيل",
  },
  changa: {
    id: "changa",
    name_ar: "تشانجا (Changa)",
    name_en: "Changa",
    fontFamily: '"Changa", "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    category_ar: "عريض وجريء",
    description_ar: "خط ذو وزن جريء وحضور بصري قوي، ممتاز للأرقام الكبيرة ومحطات الكاشير.",
    badge: "جريء وواضح",
  },
};

/**
 * قراءة الخط المختار من التخزين المحلي
 */
export function readStoredFontTheme(): FontThemeId {
  if (typeof window === "undefined") return DEFAULT_FONT_THEME;
  try {
    const stored = localStorage.getItem(FONT_STORAGE_KEY) as FontThemeId;
    if (stored && stored in CURATED_FONTS) {
      return stored;
    }
  } catch {
    // ignore storage restrictions
  }
  return DEFAULT_FONT_THEME;
}

/**
 * تطبيق الخط على مستند الويب فورياً
 */
export function applyFontTheme(fontId: FontThemeId): void {
  if (typeof document === "undefined") return;
  const fontDef = CURATED_FONTS[fontId] || CURATED_FONTS[DEFAULT_FONT_THEME];
  const root = document.documentElement;

  root.dataset.fontTheme = fontDef.id;
  root.style.setProperty("--font-active-arabic", fontDef.fontFamily);
  root.style.setProperty("--font-arabic", fontDef.fontFamily);
}

/**
 * خريطة الخطوط المجهزة لسكربت البداية السريع
 */
export const FONT_FAMILY_BOOT_MAP: Record<FontThemeId, string> = Object.fromEntries(
  Object.entries(CURATED_FONTS).map(([k, v]) => [k, v.fontFamily])
) as Record<FontThemeId, string>;

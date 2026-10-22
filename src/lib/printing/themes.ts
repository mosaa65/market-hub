export type PrintTheme = "standard" | "luxury" | "formal";

export interface ThemeTokens {
  id: PrintTheme;
  accent: string;
  accentSoft: string;
  ink: string;
  muted: string;
  line: string;
  surface: string;
  radius: string;
}

/** الألوان الافتراضية المعتمدة لكل من القالب القياسي والتنفيذي */
export const DEFAULT_STANDARD_COLOR = "#1d4ed8"; // أزرق مؤسسي ملكي
export const DEFAULT_LUXURY_COLOR = "#0f2b5c"; // كحلي ملكي عميق متناسق مع هوية النظام

/** باليتة احترافية مقترحة للقالب القياسي المؤسسي */
export const STANDARD_COLOR_PALETTE: { color: string; labelAr: string; labelEn: string }[] = [
  { color: "#1d4ed8", labelAr: "أزرق ملكي كلاسيكي", labelEn: "Classic Royal Blue" },
  { color: "#0284c7", labelAr: "أزرق سماوي مؤسسي", labelEn: "Corporate Sky" },
  { color: "#0f766e", labelAr: "أخضر زمردي داكن", labelEn: "Emerald Pine" },
  { color: "#334155", labelAr: "رمادي صخري فخم", labelEn: "Slate Steel" },
  { color: "#4f46e5", labelAr: "نيلي تقني حديث", labelEn: "Indigo Tech" },
  { color: "#09090b", labelAr: "أسود فحمي وقور", labelEn: "Charcoal Obsidian" },
];

/** باليتة احترافية مقترحة للقالب التنفيذي الفاخر (كحلي وأزرق ملكي) */
export const LUXURY_COLOR_PALETTE: { color: string; labelAr: string; labelEn: string }[] = [
  { color: "#0f2b5c", labelAr: "كحلي ملكي عميق", labelEn: "Midnight Navy" },
  { color: "#1e3a8a", labelAr: "أزرق كحلي فخم", labelEn: "Royal Navy" },
  { color: "#1e40af", labelAr: "أزرق ياقوتي داكن", labelEn: "Dark Sapphire" },
  { color: "#0369a1", labelAr: "أزرق بحري تنفيذي", labelEn: "Executive Marine" },
  { color: "#0f172a", labelAr: "كحلي فحمي وقور", labelEn: "Slate Charcoal" },
  { color: "#9a6b16", labelAr: "ذهبي ملكي عتيق", labelEn: "Royal Gold" },
];

/**
 * دالة مساعدة لتوليد الألوان المشتقة (خلفية ناعمة، حدود متناسقة)
 * بناءً على اللون الرئيسي بدون مكتبات خارجية، لضمان وضوح الطباعة وتباين النصوص
 */
export function deriveThemeTokens(
  baseTheme: PrintTheme,
  customAccent?: string | null,
): ThemeTokens {
  const defaultTokens = PRINT_THEMES[baseTheme];
  if (!customAccent || !isValidHexColor(customAccent)) {
    return defaultTokens;
  }

  const hex = customAccent.trim();
  const rgb = hexToRgb(hex);

  // إذا لم نتمكن من تحليل اللون، نرجع التوكنز الافتراضية
  if (!rgb) return defaultTokens;

  // توليد خلفية ناعمة بنسبة تراكب مع الأبيض لضمان سهولة القراءة (opacity ~ 0.07 على الأبيض)
  const softR = Math.round(rgb.r * 0.08 + 255 * 0.92);
  const softG = Math.round(rgb.g * 0.08 + 255 * 0.92);
  const softB = Math.round(rgb.b * 0.08 + 255 * 0.92);
  const accentSoft = `rgb(${softR}, ${softG}, ${softB})`;

  // توليد لون خط فاصل متناسق ناعم (opacity ~ 0.22 على الأبيض)
  const lineR = Math.round(rgb.r * 0.22 + 255 * 0.78);
  const lineG = Math.round(rgb.g * 0.22 + 255 * 0.78);
  const lineB = Math.round(rgb.b * 0.22 + 255 * 0.78);
  const line = `rgb(${lineR}, ${lineG}, ${lineB})`;

  return {
    ...defaultTokens,
    accent: hex,
    accentSoft,
    line,
  };
}

export function isValidHexColor(hex: string): boolean {
  return /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/.test(hex.trim());
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  let clean = hex.replace("#", "").trim();
  if (clean.length === 3) {
    clean = clean
      .split("")
      .map((c) => c + c)
      .join("");
  }
  if (clean.length !== 6) return null;
  const num = parseInt(clean, 16);
  if (Number.isNaN(num)) return null;
  return {
    r: (num >> 16) & 255,
    g: (num >> 8) & 255,
    b: num & 255,
  };
}

export const PRINT_THEMES: Record<PrintTheme, ThemeTokens> = {
  standard: {
    id: "standard",
    accent: "#1d4ed8",
    accentSoft: "#eff6ff",
    ink: "#172033",
    muted: "#526174",
    line: "#d8e0ea",
    surface: "#f8fafc",
    radius: "6px",
  },
  luxury: {
    id: "luxury",
    accent: "#0f2b5c",
    accentSoft: "#f0f4fa",
    ink: "#0f172a",
    muted: "#475569",
    line: "#cbd5e1",
    surface: "#f8fafc",
    radius: "8px",
  },
  formal: {
    id: "formal",
    accent: "#111827",
    accentSoft: "#f3f4f6",
    ink: "#111827",
    muted: "#4b5563",
    line: "#9ca3af",
    surface: "#f9fafb",
    radius: "2px",
  },
};

export function normalizeTheme(value?: string): PrintTheme {
  if (!value) return "standard";
  const v = value.trim().toLowerCase();
  // Legacy aliases kept so stored settings never lose their look.
  if (v === "elegant" || v === "luxury" || v === "premium") return "luxury";
  if (v === "formal") return "formal";
  return "standard";
}

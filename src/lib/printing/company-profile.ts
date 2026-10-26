import { supabase } from "@/integrations/supabase/client";

export interface CompanyProfile {
  name: string;
  arabicName?: string;
  englishName?: string;
  legalName?: string;
  phone?: string;
  contacts: string[];
  address?: string;
  email?: string;
  taxNumber?: string;
  logoUrl?: string;
  currency?: string;
}

const CACHE_KEY = "company_settings_cache";
/** In-memory mirror used where localStorage does not exist (SSR, Node, tests). */
let memoryProfile: CompanyProfile | null = null;
/**
 * Fallback used when `company_settings` has no row (or fields are empty).
 * الاسم/اللغة/الأرقام هنا بيانات المنصة الافتراضية (إنما سوفت) — تظهر فقط
 * ما لم تُدخل المنشأة بياناتها، وليست بديلاً عنها.
 */
const DEFAULT_PROFILE: CompanyProfile = {
  name: "إنما سوفت",
  arabicName: "إنما سوفت",
  englishName: "Inama Soft",
  phone: "772217218",
  contacts: ["772217218", "779099272"],
  logoUrl: "/vortex-erp-wordmark.png",
};

function fromRow(row: Record<string, unknown> | null | undefined): CompanyProfile {
  const phone = String(row?.phone ?? "").trim();
  const extra = String(row?.contact_numbers ?? "")
    .split(/[,،\n]/)
    .map((v) => v.trim())
    .filter(Boolean);
  const contacts = Array.from(new Set([phone, ...extra].filter(Boolean)));
  // المنشأة بلا بيانات؟ نعرض بيانات المنصة الافتراضية بدل الحقول الفارغة.
  const effectiveContacts = contacts.length ? contacts : DEFAULT_PROFILE.contacts;
  return {
    name: String(row?.name ?? "").trim() || DEFAULT_PROFILE.name,
    arabicName: String(row?.name_ar ?? "").trim() || DEFAULT_PROFILE.arabicName,
    englishName: String(row?.name_en ?? "").trim() || DEFAULT_PROFILE.englishName,
    legalName: String(row?.legal_name ?? "").trim() || undefined,
    phone: phone || DEFAULT_PROFILE.phone,
    contacts: effectiveContacts,
    address: String(row?.address ?? "").trim() || undefined,
    email: String(row?.email ?? "").trim() || undefined,
    taxNumber: String(row?.tax_number ?? "").trim() || undefined,
    logoUrl: String(row?.logo_url ?? "").trim() || DEFAULT_PROFILE.logoUrl,
    currency: String(row?.currency_symbol ?? row?.currency ?? "").trim() || undefined,
  };
}

export function getCachedCompanyProfile(): CompanyProfile {
  if (typeof window === "undefined") {
    /*
     * No localStorage outside the browser. Server rendering, tests and the
     * report builders running in Node still need the profile, so fall back to
     * the in-memory copy written by `cacheCompanyProfile` instead of returning
     * a blank company — otherwise every footer renders empty.
     */
    return memoryProfile ? { ...DEFAULT_PROFILE, ...memoryProfile } : DEFAULT_PROFILE;
  }
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? { ...DEFAULT_PROFILE, ...fromRow(JSON.parse(raw)) } : DEFAULT_PROFILE;
  } catch {
    return DEFAULT_PROFILE;
  }
}

export function cacheCompanyProfile(row: Record<string, unknown>): CompanyProfile {
  if (typeof window === "undefined") {
    memoryProfile = fromRow(row);
    return memoryProfile;
  }
  // ندمج مع الصف المخزّن حتى لا تفقد التحديثات الجزئية بقية الحقول.
  let merged: Record<string, unknown> = row;
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    const current = raw ? JSON.parse(raw) : {};
    merged = { ...current, ...row };
  } catch {
    merged = row;
  }
  localStorage.setItem(CACHE_KEY, JSON.stringify(merged));
  return fromRow(merged);
}

/**
 * تحديث جزئي للكاش (مثل تغيير رمز العملة) دون فقدان بقية حقول الشركة.
 * هذا هو المسار الوحيد المسموح لتحديث كاش Company Profile.
 *
 * يقبل إما أسماء أعمدة قاعدة البيانات (`currency_symbol`) أو أسماء
 * `CompanyProfile` (`currency`) — يُترجم الاثنان إلى نفس المفتاح المخزّن.
 */
export function patchCompanyProfileCache(patch: Partial<CompanyProfile>): CompanyProfile {
  const rowPatch: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    // خريطة أسماء CompanyProfile → أعمدة قاعدة البيانات.
    const column =
      key === "currency"
        ? "currency_symbol"
        : key === "logoUrl"
          ? "logo_url"
          : key === "taxNumber"
            ? "tax_number"
            : key === "arabicName"
              ? "name_ar"
              : key === "englishName"
                ? "name_en"
                : key === "legalName"
                  ? "legal_name"
                  : key;
    rowPatch[column] = value;
  }
  return cacheCompanyProfile(rowPatch);
}

/** يمسح الكاش — يُستخدم عند تسجيل الخروج أو تغيير المنشأة. */
export function clearCompanyProfileCache(): void {
  if (typeof window !== "undefined") localStorage.removeItem(CACHE_KEY);
}

export async function loadCompanyProfile(): Promise<CompanyProfile> {
  const cached = getCachedCompanyProfile();
  const { data, error } = await supabase
    .from("company_settings")
    .select("*")
    .order("id")
    .limit(1)
    .maybeSingle();
  if (error || !data) return cached;
  return cacheCompanyProfile(data as Record<string, unknown>);
}

export const DEFAULT_COMPANY_PROFILE = DEFAULT_PROFILE;

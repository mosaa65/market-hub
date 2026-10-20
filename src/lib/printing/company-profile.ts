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
  footerText?: string;
  footerContact?: string;
  currency?: string;
}

const CACHE_KEY = "company_settings_cache";
/**
 * Fallback used only when `company_settings` has never been cached.
 * The app must never render a tenant name or contact number of its own.
 */
const DEFAULT_PROFILE: CompanyProfile = {
  name: "",
  contacts: [],
  logoUrl: "/vortex-erp-mark.png",
};

function fromRow(row: Record<string, unknown> | null | undefined): CompanyProfile {
  const phone = String(row?.phone ?? "").trim();
  const extra = String(row?.contact_numbers ?? "")
    .split(/[,،\n]/)
    .map((v) => v.trim())
    .filter(Boolean);
  const contacts = Array.from(new Set([phone, ...extra].filter(Boolean)));
  return {
    name: String(row?.name ?? "").trim() || DEFAULT_PROFILE.name,
    arabicName: String(row?.name_ar ?? "").trim() || undefined,
    englishName: String(row?.name_en ?? "").trim() || undefined,
    legalName: String(row?.legal_name ?? "").trim() || undefined,
    phone: phone || undefined,
    contacts,
    address: String(row?.address ?? "").trim() || undefined,
    email: String(row?.email ?? "").trim() || undefined,
    taxNumber: String(row?.tax_number ?? "").trim() || undefined,
    logoUrl: String(row?.logo_url ?? "").trim() || DEFAULT_PROFILE.logoUrl,
    currency: String(row?.currency_symbol ?? row?.currency ?? "").trim() || undefined,
  };
}

export function getCachedCompanyProfile(): CompanyProfile {
  if (typeof window === "undefined") return DEFAULT_PROFILE;
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? { ...DEFAULT_PROFILE, ...fromRow(JSON.parse(raw)) } : DEFAULT_PROFILE;
  } catch {
    return DEFAULT_PROFILE;
  }
}

export function cacheCompanyProfile(row: Record<string, unknown>): CompanyProfile {
  if (typeof window === "undefined") return fromRow(row);
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


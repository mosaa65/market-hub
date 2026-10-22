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

/**
 * القيمة الافتراضية الرسمية للمنشأة عند عدم ضبط إعدادات مخصصة
 * أو قبل تحميل قاعدة البيانات: شركة إنماء سوفت للحلول البرمجية.
 */
const DEFAULT_PROFILE: CompanyProfile = {
  name: "إنماء سوفت للحلول البرمجية",
  arabicName: "إنماء سوفت للحلول البرمجية",
  englishName: "Inma Soft for Software Solutions",
  legalName: "شركة إنماء سوفت للحلول البرمجية والتقنية",
  phone: "772217218",
  contacts: ["772217218", "784795101"],
  address: "اليمن - إب",
  email: "info@inmasoft.com",
  taxNumber: "",
  logoUrl: "/vortex-erp-wordmark.png",
  currency: "ر.ي",
};

function fromRow(row: Record<string, unknown> | null | undefined): CompanyProfile {
  if (!row || Object.keys(row).length === 0) {
    return DEFAULT_PROFILE;
  }

  const rowName = String(row?.name ?? "").trim();
  const rowNameAr = String(row?.name_ar ?? "").trim();
  const rowNameEn = String(row?.name_en ?? "").trim();
  const rowLegal = String(row?.legal_name ?? "").trim();
  const rowPhone = String(row?.phone ?? "").trim();
  const rowAddress = String(row?.address ?? "").trim();
  const rowEmail = String(row?.email ?? "").trim();
  const rowTax = String(row?.tax_number ?? "").trim();
  const rowLogo = String(row?.logo_url ?? "").trim();
  const rowCurrency = String(row?.currency_symbol ?? row?.currency ?? "").trim();

  const extra = String(row?.contact_numbers ?? "")
    .split(/[,،\n]/)
    .map((v) => v.trim())
    .filter(Boolean);
  const parsedContacts = Array.from(new Set([rowPhone, ...extra].filter(Boolean)));

  const isCustomConfigured = Boolean(
    rowName || rowNameAr || rowNameEn || rowLegal || rowPhone || rowAddress || rowEmail || rowTax,
  );

  if (!isCustomConfigured) {
    return DEFAULT_PROFILE;
  }

  return {
    name: rowName || rowNameAr || DEFAULT_PROFILE.name,
    arabicName: rowNameAr || undefined,
    englishName: rowNameEn || undefined,
    legalName: rowLegal || undefined,
    phone: rowPhone || undefined,
    contacts: parsedContacts.length > 0 ? parsedContacts : rowPhone ? [rowPhone] : [],
    address: rowAddress || undefined,
    email: rowEmail || undefined,
    taxNumber: rowTax || undefined,
    logoUrl: rowLogo || DEFAULT_PROFILE.logoUrl,
    currency: rowCurrency || DEFAULT_PROFILE.currency,
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

export function patchCompanyProfileCache(patch: Partial<CompanyProfile>): CompanyProfile {
  const rowPatch: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
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

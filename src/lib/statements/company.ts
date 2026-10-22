/**
 * Statement Company Info — ترويسة المنشأة للكشوفات.
 *
 * بيانات الشركة تأتي من Company Profile (`company_settings` عبر
 * `printing/company-profile.ts`). الثوابت هنا هي fallback فقط عند غياب
 * بيانات الشركة تمامًا — ولا تُكتب أرقام تواصل أو أسماء داخل أي مستند
 * إن وُجدت بيانات حقيقية.
 */

import { supabase } from "@/integrations/supabase/client";

/** هوية صانع النظام — بيانات دعم، تُعرض في تذييل التطبيق فقط. */
export const INAMA_SOFT_BRAND = {
  name: "انماء سوفت",
  owner: "",
  tagline: "",
  phone: "",
  website: "inma-soft.vercel.app",
  logoUrl: "/inama-soft-logo.ico",
  softwareName: "انماء سوفت",
} as const;

/** القيم الافتراضية للطباعة قبل وصول بيانات قاعدة البيانات */
export const DEFAULT_COMPANY_INFO = {
  name: "إنماء سوفت للحلول البرمجية",
  englishName: "Inma Soft for Software Solutions",
  phone: "772217218",
  address: "اليمن - إب",
  email: "info@inmasoft.com",
  currency: "YER",
  currencySymbol: "ر.ي",
};

export interface StatementCompanyInfo {
  name: string;
  legalName: string | null;
  /** الشعار المطبوع: logo_url من company_settings، وإلا شعار Inama Soft */
  logoUrl: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  taxNumber: string | null;
  currency: string;
  currencySymbol: string;
  brand: typeof INAMA_SOFT_BRAND;
}

export const STATEMENT_COMPANY: StatementCompanyInfo = {
  name: DEFAULT_COMPANY_INFO.name,
  legalName: "شركة إنماء سوفت للحلول البرمجية والتقنية",
  logoUrl: INAMA_SOFT_BRAND.logoUrl,
  address: DEFAULT_COMPANY_INFO.address,
  phone: DEFAULT_COMPANY_INFO.phone,
  email: DEFAULT_COMPANY_INFO.email,
  taxNumber: null,
  currency: DEFAULT_COMPANY_INFO.currency,
  currencySymbol: DEFAULT_COMPANY_INFO.currencySymbol,
  brand: INAMA_SOFT_BRAND,
};

interface CompanySettingsRow {
  name: string | null;
  legal_name: string | null;
  logo_url: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  tax_number: string | null;
  currency: string | null;
  currency_symbol: string | null;
}

/**
 * جلب بيانات المنشأة للطباعة.
 * ⚠️ يُمرَّر رمز العملة صريحًا إلى القالب لتجنّب مشكلة كاش localStorage
 * في نافذة الطباعة الجديدة (المخاطرة R8 في الخطة).
 */
export async function loadStatementCompany(): Promise<StatementCompanyInfo> {
  const { data } = await supabase
    .from("company_settings")
    .select(
      "name, legal_name, logo_url, address, phone, email, tax_number, currency, currency_symbol",
    )
    .order("id")
    .limit(1)
    .maybeSingle();

  const row = (data ?? null) as CompanySettingsRow | null;

  return {
    name: row?.name?.trim() || DEFAULT_COMPANY_INFO.name,
    legalName: row?.legal_name?.trim() || "شركة إنماء سوفت للحلول البرمجية والتقنية",
    logoUrl: row?.logo_url?.trim() || INAMA_SOFT_BRAND.logoUrl,
    address: row?.address?.trim() || DEFAULT_COMPANY_INFO.address,
    phone: row?.phone?.trim() || DEFAULT_COMPANY_INFO.phone,
    email: row?.email?.trim() || DEFAULT_COMPANY_INFO.email,
    taxNumber: row?.tax_number?.trim() || null,
    currency: row?.currency?.trim() || DEFAULT_COMPANY_INFO.currency,
    currencySymbol: row?.currency_symbol?.trim() || DEFAULT_COMPANY_INFO.currencySymbol,
    brand: INAMA_SOFT_BRAND,
  };
}

/** رمز العملة النهائي: تجاوز المستخدم ← قاعدة البيانات ← الافتراضي */
export function resolveCurrencySymbol(
  override: string | undefined | null,
  fallback: string,
): string {
  const custom = override?.trim();
  return custom || fallback || DEFAULT_COMPANY_INFO.currencySymbol;
}

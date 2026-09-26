/**
 * Statement Company Info — ترويسة المنشأة + هوية Inama Soft
 *
 * يُعاد استخدام كل ما هو موجود أصلًا:
 *   - company_settings: name, legal_name, logo_url, address, phone, email, tax_number
 *   - public/inama-soft-logo.ico (موجود) — مع fallback عند غياب logo_url
 *   - نفس بيانات هوية Inama Soft الموجودة في src/components/inama-soft-footer.tsx
 *
 * قرار المستخدم #6: الاكتفاء بـ .ico (لا نضيف ملف png).
 * قراءة فقط — صفر تغيير في قاعدة البيانات.
 */

import { supabase } from "@/integrations/supabase/client";

/** هوية صانع النظام — مصدرها inama-soft-footer.tsx */
export const INAMA_SOFT_BRAND = {
  name: "انماء سوفت",
  owner: "",
  tagline: "",
  phone: "+967 772 217 218",
  website: "inma-soft.vercel.app",
  logoUrl: "/inama-soft-logo.ico",
  softwareName: "انماء سوفت",
} as const;

/** القيم الافتراضية للطباعة قبل وصول بيانات قاعدة البيانات */
export const DEFAULT_COMPANY_INFO = {
  name: "انماء سوفت",
  currency: "YER",
  currencySymbol: "﷼",
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
  legalName: null,
  logoUrl: INAMA_SOFT_BRAND.logoUrl,
  address: null,
  phone: null,
  email: null,
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
    legalName: row?.legal_name?.trim() || null,
    // fallback إلى شعار Inama Soft — نفس منطق app-shell.tsx
    logoUrl: row?.logo_url?.trim() || INAMA_SOFT_BRAND.logoUrl,
    address: row?.address?.trim() || null,
    phone: row?.phone?.trim() || null,
    email: row?.email?.trim() || null,
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

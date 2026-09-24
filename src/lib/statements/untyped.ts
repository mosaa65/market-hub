/**
 * Untyped Table Reader — قراءة جداول موجودة في قاعدة البيانات وغير معرّفة
 * في `src/integrations/supabase/types.ts` المولَّد.
 *
 * ⚠️ لماذا؟
 * ملف types.ts المولَّد متأخر عن الـ migrations الموجودة في المستودع:
 * `customer_ledger` (migration 20260912140000) و
 * `company_settings.catalog_modules` (migration 20260915020000)
 * موجودان فعلًا في قاعدة البيانات لكنهما غير معرّفين في الأنواع المولَّدة.
 *
 * هذا ليس تغييرًا في قاعدة البيانات — الجداول والأعمدة موجودة أصلًا.
 * نقرأ فقط عبر واجهة غير مُقيَّدة بالأنواع إلى أن تُعاد توليد types.ts.
 *
 * نفس الأسلوب المتبع مسبقًا في المشروع:
 *   (supabase.from as any)("customer_payments")
 */

import { supabase } from "@/integrations/supabase/client";

/** جداول موجودة في قاعدة البيانات وغير معرّفة في الأنواع المولَّدة */
export const UNTYPED_TABLES = {
  /** migration 20260912140000 — دفتر حركة العميل (مصدر الحقيقة للأرصدة) */
  customerLedger: "customer_ledger",
} as const;

interface PostgrestResult<T> {
  data: T | null;
  error: { message: string } | null;
}

interface UntypedQuery<T> {
  select: (columns?: string) => UntypedQuery<T>;
  eq: (column: string, value: unknown) => UntypedQuery<T>;
  gt: (column: string, value: unknown) => UntypedQuery<T>;
  in: (column: string, values: readonly unknown[]) => UntypedQuery<T>;
  order: (column: string, options?: { ascending?: boolean }) => UntypedQuery<T>;
  limit: (count: number) => UntypedQuery<T>;
  update: (values: Record<string, unknown>) => UntypedQuery<T>;
  maybeSingle: () => Promise<PostgrestResult<T>>;
  single: () => Promise<PostgrestResult<T>>;
  then: <R = PostgrestResult<T[]>>(onfulfilled?: (value: PostgrestResult<T[]>) => R) => Promise<R>;
}

/**
 * واجهة قراءة غير مُقيَّدة بالأنواع لجداول موجودة فعلًا في قاعدة البيانات.
 * النوع العام T يُمرَّر صريحًا عند الاستخدام لإبقاء بقية الكود مُقيَّدًا.
 */
export function untypedTable<T = Record<string, unknown>>(table: string): UntypedQuery<T> {
  // تحويل عبر unknown — طبقة العزل الوحيدة، ولا يتسرّب إلى بقية الملفات
  const client = supabase as unknown as {
    from: (name: string) => UntypedQuery<T>;
  };
  return client.from(table);
}

/** اختصار لجدول دفتر العميل */
export function customerLedgerTable<T = Record<string, unknown>>(): UntypedQuery<T> {
  return untypedTable<T>(UNTYPED_TABLES.customerLedger);
}

/**
 * توثيق الجداول/الأعمدة التي تحتاج إعادة توليد types.ts.
 * لا تُستخدم في وقت التشغيل — مرجع هندسي فقط.
 */
export const STALE_TYPES_NOTES = [
  "customer_ledger (migration 20260912140000) غير معرّف في types.ts المولَّد",
  "company_settings.catalog_modules (migration 20260915020000) غير معرّف في types.ts المولَّد",
  "Views: customer_ledger_balances / customer_balance_reconciliation غير معرّفة في types.ts المولَّد",
  "الحل: قراءة/تحديث عبر واجهة غير مُقيَّدة بالأنواع — بلا أي تغيير في قاعدة البيانات",
] as const;

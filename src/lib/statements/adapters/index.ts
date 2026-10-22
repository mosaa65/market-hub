/**
 * Statement Adapter Registry
 *
 * نقطة دخول واحدة لكل طبقة القراءة. أي شاشة أو قالب يطلب كشفًا
 * يمرّ من هنا — فلا يعرف أحد خارج هذا المجلد كيف تُقرأ البيانات.
 *
 * الصفر تغيير في قاعدة البيانات: كل محمّل يقرأ من جداول موجودة فقط.
 */

import { loadCashStatement, type CashStatementData } from "./cash";
import { loadCustomerStatement, type CustomerStatementData } from "./customer";
import { loadSupplierStatement, type SupplierStatementData } from "./supplier";
import type { StatementEntityType } from "../types";

export interface LoadedStatement {
  entity: CustomerStatementData["entity"];
  entries: CustomerStatementData["entries"];
  cachedBalance: number | null;
  /** هل البيانات مُشتقّة من مستندات بدل دفتر حقيقي؟ */
  derived: boolean;
  /** هل يوجد مصدر بيانات فعلي؟ */
  hasSourceData: boolean;
  /** تفصيل إضافي خاص بكشف الخزينة */
  breakdown?: CashStatementData["breakdown"];
}

export async function loadStatementSource(
  entityType: StatementEntityType,
  entityId: string,
  lang: "ar" | "en" = "ar",
): Promise<LoadedStatement> {
  if (entityType === "customer") {
    const data: CustomerStatementData = await loadCustomerStatement(entityId, lang);
    return {
      entity: data.entity,
      entries: data.entries,
      cachedBalance: data.cachedBalance,
      derived: false,
      hasSourceData: data.hasLedgerData,
    };
  }

  if (entityType === "supplier") {
    const data: SupplierStatementData = await loadSupplierStatement(entityId, lang);
    return {
      entity: data.entity,
      entries: data.entries,
      cachedBalance: data.cachedBalance,
      derived: data.derived,
      hasSourceData: data.entries.length > 0,
    };
  }

  const data: CashStatementData = await loadCashStatement(lang);
  return {
    entity: data.entity,
    entries: data.entries,
    cachedBalance: null,
    derived: true,
    hasSourceData: data.entries.length > 0,
    breakdown: data.breakdown,
  };
}

/**
 * قائمة الجهات القابلة لإنشاء كشف لها.
 * تُبنى من جداول customers/suppliers الموجودة — بلا أي جدول جديد.
 * كشف المندوب غير مدعوم لأن كيان المندوب غير موجود في النظام.
 */
export interface StatementPartyOption {
  id: string;
  name: string;
  phone: string | null;
  balance: number;
}

export const SUPPORTED_ENTITY_TYPES: StatementEntityType[] = ["customer", "supplier", "cash"];

export const UNSUPPORTED_ENTITY_TYPES = [
  {
    type: "representative",
    reasonAr: "لا يوجد كيان مندوب في النظام (لا جدول ولا حقل مرتبط بالمبيعات)",
    reasonEn: "No representative entity exists in the schema",
  },
] as const;

export type { CashStatementData, CustomerStatementData, SupplierStatementData };

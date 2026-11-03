/**
 * payment-method-health.ts — تدقيق ربط طرق الدفع بدليل الحسابات.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * لماذا
 * ════════════════════════════════════════════════════════════════════════════
 * خطأ محاسبي صامت هو الأخطر: طريقة دفع مفعّلة، يختارها المستخدم، ثم لا تجد
 * حسابًا في الدليل فتُرحَّل الحركة على حساب احتياطي أو على لا شيء. لا رسالة
 * خطأ ولا أثر مرئي — فقط رصيد لا يُطابق.
 *
 * هذا الملف يجيب سؤالًا واحدًا لكل طريقة: **أين تُسوّى؟** ويحسب الوجهة بنفس
 * ترتيب دالة قاعدة البيانات `payment_method_ledger_account()`:
 *
 *   1. الكود الصريح في صف الكتالوج (`default_account_code`).
 *   2. وإلا يُشتقّ من عائلة الحساب (`LEDGER_KIND_ACCOUNT_CODE`).
 *   3. آجل بلا حساب تحصيل — وهذا صحيح لا خطأ.
 *
 * بلا React وبلا شبكة، فتُختبر القواعد وحدها.
 */

import { LEDGER_KIND_ACCOUNT_CODE, ledgerKindLabel, type LedgerKind } from "./payment-methods";

export interface AuditableMethod {
  id: string;
  nameAr: string;
  ledgerKind: LedgerKind | string;
  defaultAccountCode?: string | null;
  isCreditTerm?: boolean;
  requiresReference?: boolean;
  /** هل فعّلتها المنشأة لهذا القسم؟ */
  enabled?: boolean;
  /** هل فعّلها المطوّر أصلًا؟ */
  isActive?: boolean;
}

export interface AccountLookup {
  /** الأكواد الموجودة فعليًا في شجرة الحسابات. */
  codes: Set<string>;
}

export type MethodHealthStatus =
  | "ok" // لها حساب موجود
  | "account_missing" // الكود محسوب لكنه غير موجود في الشجرة
  | "no_account" // عائلة بلا كود (غير آجل)
  | "credit" // آجل — لا يحتاج حساب تحصيل
  | "disabled"; // غير مفعّلة — لا تُدقّق

export interface MethodHealth {
  method: AuditableMethod;
  status: MethodHealthStatus;
  /** كود الحساب المحسوب، أو null. */
  accountCode: string | null;
  /** سبب مقروء للمستخدم. */
  message: { ar: string; en: string };
}

/** يحسب كود الحساب بنفس أسبقية قاعدة البيانات. */
export function resolveMethodAccountCode(method: AuditableMethod): string | null {
  if (method.isCreditTerm || method.ledgerKind === "CREDIT") return null;
  const explicit = method.defaultAccountCode?.trim();
  if (explicit) return explicit;
  return LEDGER_KIND_ACCOUNT_CODE[(method.ledgerKind as LedgerKind) ?? "OTHER"] ?? null;
}

export function auditPaymentMethods(
  methods: AuditableMethod[],
  lookup: AccountLookup,
): MethodHealth[] {
  return methods.map((method) => {
    const isCredit = Boolean(method.isCreditTerm) || method.ledgerKind === "CREDIT";
    if (method.isActive === false || method.enabled === false) {
      return {
        method,
        status: "disabled" as const,
        accountCode: null,
        message: { ar: "غير مفعّلة — لا تُدقّق", en: "Disabled — not audited" },
      };
    }
    if (isCredit) {
      return {
        method,
        status: "credit" as const,
        accountCode: null,
        message: {
          ar: "آجل — تُقيَّد في ذمم العميل، لا حساب تحصيل",
          en: "Credit — posted to receivables, no collection account",
        },
      };
    }
    const code = resolveMethodAccountCode(method);
    if (!code) {
      return {
        method,
        status: "no_account" as const,
        accountCode: null,
        message: {
          ar: `عائلة «${ledgerKindLabel(method.ledgerKind, "ar")}» بلا حساب في الدليل`,
          en: `"${ledgerKindLabel(method.ledgerKind, "en")}" family has no ledger account`,
        },
      };
    }
    if (!lookup.codes.has(code)) {
      return {
        method,
        status: "account_missing" as const,
        accountCode: code,
        message: {
          ar: `الحساب ${code} غير موجود في شجرة الحسابات`,
          en: `Account ${code} is not in the chart of accounts`,
        },
      };
    }
    return {
      method,
      status: "ok" as const,
      accountCode: code,
      message: { ar: `مرتبطة بالحساب ${code}`, en: `Linked to account ${code}` },
    };
  });
}

/** الطرق التي تحتاج تدخّلًا — ما تعرضه الإعدادات في لوحة الحالة. */
export function unhealthyMethods(health: MethodHealth[]): MethodHealth[] {
  return health.filter((h) => h.status === "account_missing" || h.status === "no_account");
}

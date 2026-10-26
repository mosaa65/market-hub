/**
 * split-tenders.ts — توزيع الدفعة الواحدة على أكثر من طريقة دفع.
 *
 * لا يعتمد على React ولا على قاعدة البيانات إطلاقاً، لذلك يمكن اختباره
 * مباشرة (انظر `__tests__/split-tenders.test.ts`) واستخدامه من أي شاشة:
 * نقطة البيع، نقطة المشتريات، سندات الاستلام، وفواتير المبيعات.
 *
 * القواعد المحاسبية المحفوظة هنا:
 *  • مجموع الأجزاء يجب أن يطابق إجمالي الفاتورة (المدفوع) بالقرش.
 *  • الآجل جزء من التوزيع، لكنه لا يُسجّل كتحصيل: الجزء الآجل يذهب إلى
 *    حساب الذم 1211 عبر `remaining` لا عبر صف في `*_payment_splits`.
 *  • أي جزء لا يعطي مبلغاً موجباً يُهمل ولا يُرسل للقاعدة.
 */

/** الطرق الأربع المعتمدة (مطابقة لـ CORE_PAYMENT_METHODS في الواجهة). */
export const CORE_SPLIT_METHODS = ["cash", "credit", "bank_transfer", "mobile_money"] as const;

export type CoreSplitMethod = (typeof CORE_SPLIT_METHODS)[number];

/** القيم التي تقبلها قاعدة البيانات في `_payment_splits[].method` حالياً. */
const SPLITTABLE_TENDER_VALUES = new Set([
  "cash",
  "card",
  "bank_transfer",
  "mobile_money",
  "cheque",
]);

/**
 * الطرق التي تُسجّل تحصيلاً فعلياً (تدين حساب الصندوق/البنك/المحفظة).
 * الآجل مستبعد لأنه دين على العميل لا تحصيل نقدي.
 */
export function isSplitTender(method: string | null | undefined): boolean {
  if (!method) return false;
  return SPLITTABLE_TENDER_VALUES.has(method.trim().toLowerCase());
}

/** هل التوزيع يحتوي على أي جزء فعلي (غير آجل)؟ */
export function hasRealTender(allocations: Readonly<Record<string, number>>): boolean {
  return Object.entries(allocations).some(
    ([method, amount]) => isSplitTender(method) && Number(amount) > 0,
  );
}

export interface SplitTenderLine {
  /** القيمة القديمة التي تُخزّنها قاعدة البيانات (cash / bank_transfer / ...). */
  method: string;
  /** المبلغ مقرّباً إلى قرشين. */
  amount: number;
}

export interface BuildSplitTenderResult {
  /** الأجزاء التي تُرسل إلى قاعدة البيانات (طرق تحصيل فعلية فقط). */
  tenders: SplitTenderLine[];
  /** إجمالي المبالغ المحصّلة فعلاً (مجموع tenders). */
  paid: number;
  /** الجزء الآجل (ذم) — يُسجَّل كدين على العميل، وليس كتحصيل. */
  credit: number;
  /** مجموع كل الأجزاء بما فيها الآجل. */
  allocated: number;
  /** الفرق بين إجمالي الفاتورة والمخصص (سالب = تجاوز). */
  remaining: number;
  /** هل يتجاوز التوزيع إجمالي المستند؟ */
  overpaid: boolean;
  /** هل التوزيع مطابق لإجمالي المستند بالقرش؟ */
  balanced: boolean;
}

const round2 = (value: number) => Math.round((Number(value) || 0) * 100) / 100;

/**
 * يبني أجزاء الدفع من خريطة { طريقة: مبلغ }.
 *
 * @param allocations خريطة الطرق الأربع بمبالغها.
 * @param total إجمالي المستند (بعد الخصم والضريبة).
 */
export function buildSplitTenders(
  allocations: Readonly<Record<string, number>>,
  total: number,
): BuildSplitTenderResult {
  const tenders: SplitTenderLine[] = [];
  let credit = 0;

  for (const [method, rawAmount] of Object.entries(allocations)) {
    const amount = round2(Number(rawAmount) || 0);
    if (amount <= 0) continue;

    const normalized = method.trim().toLowerCase();
    if (normalized === "credit") {
      credit = round2(credit + amount);
      continue;
    }
    if (!isSplitTender(normalized)) continue;
    tenders.push({ method: normalized, amount });
  }

  const paid = round2(tenders.reduce((sum, line) => sum + line.amount, 0));
  const allocated = round2(paid + credit);
  const documentTotal = round2(total);
  const remaining = round2(documentTotal - allocated);

  return {
    tenders,
    paid,
    credit,
    allocated,
    remaining,
    overpaid: remaining < -0.005,
    balanced: Math.abs(remaining) < 0.005,
  };
}

/**
 * الملخص النصي الذي يُحفظ في الملاحظات ليقرأه المحاسب على الفاتورة المطبوعة.
 * يطابق الصيغة التي يتعرّف عليها `isSplitPaymentValue`.
 */
export function describeSplitTenders(
  result: BuildSplitTenderResult,
  labels: Record<string, string>,
  lang: "ar" | "en" = "ar",
): string {
  const parts = result.tenders.map(
    (line) => `${labels[line.method] ?? line.method}: ${line.amount.toFixed(2)}`,
  );
  if (result.credit > 0) {
    parts.push(`${lang === "ar" ? "آجل" : "Debt"}: ${result.credit.toFixed(2)}`);
  }
  const head = lang === "ar" ? "الدفع بأكثر من طريقة" : "Split";
  return `[${head}: ${parts.join(" | ")}]`;
}

/**
 * هل هذا المستند دفع مجزأ؟
 * `split` مخزّنة كطريقة واحدة، أو طريقة مفردة مع تفصيل في الملاحظات.
 */
export function looksLikeSplitPayment(
  method: string | null | undefined,
  note?: string | null,
): boolean {
  if (method === "split") return true;
  if (!note) return false;
  return (
    note.includes("[الدفع بأكثر من طريقة") ||
    note.includes("[دفع مجزأ:") ||
    note.includes("[Split:")
  );
}

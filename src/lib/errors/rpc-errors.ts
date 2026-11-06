/**
 * طبقة واحدة لترجمة أخطاء RPC.
 *
 * P1-4 من تقرير ما قبل التسليم: كانت كل شاشة تترجم أخطاء قاعدة البيانات
 * بطريقتها، فبعض الأخطاء يخرج بالإنجليزية مباشرة إلى الكاشير. هنا:
 *   • الرسائل المعروفة تترجم إلى عربية واضحة قابلة للتنفيذ.
 *   • غير المعروف يبقى نصه الأصلي (لا نخفي تفاصيل تشغيلية عن المسؤول).
 *   • أي خطأ في الكتابة يجب أن يمر بهذه الدالة قبل العرض.
 */

export type RpcLang = "ar" | "en";

interface Rule {
  test: RegExp;
  ar: string | ((m: RegExpMatchArray) => string);
  en: string;
}

const RULES: Rule[] = [
  {
    test: /Not authenticated/i,
    ar: "انتهت الجلسة. سجّل الدخول من جديد ثم أعد المحاولة.",
    en: "Your session has expired. Sign in again and retry.",
  },
  {
    test: /permission denied for function|Forbidden/i,
    ar: "لا تملك صلاحية تنفيذ هذه العملية.",
    en: "You are not allowed to perform this operation.",
  },
  {
    test: /You are not permitted to post sales/i,
    ar: "لا تملك صلاحية إصدار فواتير البيع.",
    en: "You are not allowed to post sales invoices.",
  },
  {
    test: /A customer is required when the sale has an unpaid amount/i,
    ar: "المبيعات الآجلة تحتاج اختيار عميل مسجّل — العميل النقدي لا يحمل ذمة.",
    en: "A deferred sale needs a registered customer; the cash customer cannot carry credit.",
  },
  {
    test: /The system cash customer cannot carry credit/i,
    ar: "لا يمكن البيع الآجل على «العميل النقدي». اختر عميلاً حقيقياً.",
    en: "The system cash customer cannot carry a balance. Pick a real customer.",
  },
  {
    test: /The system cash supplier cannot carry a payable balance/i,
    ar: "لا يمكن الشراء الآجل من «المورد النقدي». اختر مورداً حقيقياً أو سدّد كامل المبلغ.",
    en: "The system cash supplier cannot carry a payable. Pick a real supplier or pay in full.",
  },
  {
    test: /Insufficient stock for item ([0-9a-f-]+).*available ([\d.]+).*requested ([\d.]+)/i,
    ar: (m) => `المخزون غير كافٍ: المتاح ${m[2]} والمطلوب ${m[3]}.`,
    en: "Insufficient stock.",
  },
  {
    test: /Credit limit exceeded.*current balance ([\d.]+).*requested debt ([\d.]+).*limit ([\d.]+)/i,
    ar: (m) => `تجاوز سقف الدين: الرصيد ${m[1]} + المطلوب ${m[2]} أكبر من الحد ${m[3]}.`,
    en: "Credit limit exceeded.",
  },
  {
    test: /Discount cannot exceed/i,
    ar: "الخصم أكبر من قيمة الفاتورة.",
    en: "The discount exceeds the invoice value.",
  },
  {
    test: /Cart is empty|No items|At least one/i,
    ar: "لا توجد بنود في المستند.",
    en: "The document has no lines.",
  },
  {
    test: /A return must go back to the invoice warehouse/i,
    ar: "المرتجع يجب أن يعود إلى مستودع الفاتورة الأصلية نفسه.",
    en: "A return must go back to the original invoice warehouse.",
  },
  {
    test: /Return exceeds what was sold for item ([0-9a-f-]+).*sold ([\d.]+).*already returned ([\d.]+).*requested ([\d.]+)/i,
    ar: (m) =>
      `كمية المرتجع تتجاوز المبيع: المباع ${m[2]}، المرتجع سابقاً ${m[3]}، المطلوب ${m[4]}.`,
    en: "The return quantity exceeds what was sold.",
  },
  {
    test: /The return customer does not match the invoice customer/i,
    ar: "العميل المختار لا يطابق عميل الفاتورة الأصلية.",
    en: "The return customer does not match the invoice customer.",
  },
  {
    test: /A sales return must be linked to its original invoice/i,
    ar: "المرتجع يجب أن يُربط بفاتورة البيع الأصلية.",
    en: "A return must be linked to its original invoice.",
  },
  {
    test: /A return refund method cannot be credit/i,
    ar: "طريقة استرداد المرتجع لا تكون آجلة — اختر الصندوق أو البنك.",
    en: "A refund method cannot be credit.",
  },
  {
    test: /Invoice ([^ ]+) is (draft|cancelled)/i,
    ar: "الفاتورة غير مؤكدة — الترحيل يحتاج فاتورة مؤكدة.",
    en: "Only a confirmed invoice can be posted.",
  },
  {
    test: /has already been posted to the ledger/i,
    ar: "تم ترحيل هذه الفاتورة مسبقاً إلى دفتر اليومية.",
    en: "This invoice has already been posted to the ledger.",
  },
  {
    test: /Stock movements must be posted through post_stock_delta/i,
    ar: "لا يمكن تعديل المخزون من الواجهة مباشرة — استخدم شاشة التوريد أو التسوية.",
    en: "Stock can only move through the stock engine.",
  },
  {
    test: /does not hold company stock/i,
    ar: "هذا الصنف خدمة أو غير متتبع — لا يمسك مخزوناً.",
    en: "This item does not hold company stock.",
  },
  {
    test: /The system cash customer cannot be renamed|The system cash customer cannot be deactivated|The system cash customer is a protected system entity/i,
    ar: "«العميل النقدي» حساب نظامي محمي لا يمكن تعديل اسمه أو تعطيله أو حذفه.",
    en: "The system cash customer is protected.",
  },
  {
    test: /The system cash supplier cannot be renamed|The system cash supplier cannot be deactivated|The system cash supplier is a protected system entity/i,
    ar: "«المورد النقدي» حساب نظامي محمي لا يمكن تعديل اسمه أو تعطيله أو حذفه.",
    en: "The system cash supplier is protected.",
  },
  {
    test: /That name is reserved/i,
    ar: "هذا الاسم محجوز لكيان نظامي.",
    en: "That name is reserved for a system entity.",
  },
  {
    test: /User already registered/i,
    ar: "هذا البريد مسجّل مسبقاً.",
    en: "This email is already registered.",
  },
  {
    test: /JWT expired|invalid JWT/i,
    ar: "انتهت صلاحية الجلسة. سجّل الدخول من جديد.",
    en: "Your session has expired. Sign in again.",
  },
  {
    test: /Failed to fetch|NetworkError|ERR_NETWORK|Load failed/i,
    ar: "تعذر الاتصال بالخادم. تحقق من الاتصال ثم أعد المحاولة.",
    en: "Could not reach the server. Check the connection and retry.",
  },
  {
    test: /duplicate key value violates unique constraint/i,
    ar: "العنصر موجود مسبقاً (تكرار في رقم أو اسم فريد).",
    en: "A duplicate value was rejected by a unique constraint.",
  },
  {
    test: /violates foreign key constraint/i,
    ar: "السجل مرتبط بسجلات أخرى — لا يمكن تنفيذ العملية بهذه الصورة.",
    en: "The record is referenced elsewhere and cannot be changed this way.",
  },
  /* ─── قواعد أمانات الطحن (سابقاً في translateCustodyError) ─── */
  {
    test: /balance.*less than the requested|less than the requested.*balance/i,
    ar: "الكمية المطلوبة أكبر من رصيد العميل المتبقي.",
    en: "The requested amount exceeds the customer's remaining balance.",
  },
  {
    test: /must be an active RAW_MATERIAL grain|input must be a RAW_MATERIAL/i,
    ar: "صنف الاستلام يجب أن يكون حبوباً خاماً.",
    en: "The intake item must be an active RAW_MATERIAL grain.",
  },
  {
    test: /must be FINISHED_GOOD or BY_PRODUCT|outputs must be FINISHED_GOOD/i,
    ar: "صنف الناتج يجب أن يكون منتجاً نهائياً أو ناتجاً جانبياً.",
    en: "Output items must be FINISHED_GOOD or BY_PRODUCT.",
  },
  {
    test: /reason is required/i,
    ar: "سبب التعديل إلزامي.",
    en: "An adjustment reason is required.",
  },
  {
    test: /Customer, warehouse and grain item are required|Customer, warehouse and item are required/i,
    ar: "يرجى تحديد العميل والمخزن والصنف.",
    en: "Customer, warehouse and item are required.",
  },
  {
    test: /not permitted to record custody milling/i,
    ar: "لا تملك صلاحية تسجيل عمليات الطحن.",
    en: "You are not permitted to record custody milling.",
  },
  {
    test: /not permitted to (adjust|intake|deliver|transfer)/i,
    ar: "لا تملك صلاحية هذه العملية.",
    en: "You are not permitted to perform this custody operation.",
  },
  {
    test: /Grain type is not active or does not exist/i,
    ar: "نوع الحبة غير نشط أو غير موجود — أعد اختياره من القائمة.",
    en: "The selected grain type is inactive or missing.",
  },
  {
    test: /Milling must consume at least one bag/i,
    ar: "الطحن يحتاج كمية: أكيس واحد على الأقل أو وزناً موجباً من الحبوب.",
    en: "Milling must consume at least one bag or a positive weight.",
  },
  {
    test: /At least one output line is required/i,
    ar: "أضف سطر ناتج واحد على الأقل قبل الترحيل.",
    en: "At least one output line is required.",
  },
  {
    test: /Every output line needs an item/i,
    ar: "كل سطر ناتج يحتاج اختيار صنف.",
    en: "Every output line needs an item.",
  },
  {
    test: /Every output line needs bags or a positive weight/i,
    ar: "كل سطر ناتج يحتاج أكياساً أو وزناً موجباً.",
    en: "Every output line needs bags or a positive weight.",
  },
  {
    test: /Output quantities cannot be negative/i,
    ar: "كميات النواتج لا تكون سالبة.",
    en: "Output quantities cannot be negative.",
  },
];

/** يحوّل نص خطأ (من RPC أو PostgREST أو fetch) إلى رسالة قابلة للعرض. */
export function translateRpcError(error: unknown, lang: RpcLang = "ar", fallback?: string): string {
  const raw =
    typeof error === "string"
      ? error
      : error && typeof error === "object" && "message" in error
        ? String((error as { message?: unknown }).message ?? "")
        : "";

  if (!raw.trim()) {
    return (
      fallback ??
      (lang === "ar" ? "تعذر تنفيذ العملية. أعد المحاولة." : "The operation failed. Retry.")
    );
  }

  for (const rule of RULES) {
    const match = raw.match(rule.test);
    if (!match) continue;
    return typeof rule.ar === "function"
      ? lang === "ar"
        ? rule.ar(match)
        : rule.en
      : lang === "ar"
        ? rule.ar
        : rule.en;
  }

  return raw;
}

/** هل الخطأ يعني أن العملية نجحت رغم رسالة الخطأ؟ (غير مستخدم حالياً، محفوظ للعقد) */
export function isRpcErrorTranslated(message: string): boolean {
  return RULES.some((r) => (typeof r.ar === "string" ? r.ar === message : false));
}

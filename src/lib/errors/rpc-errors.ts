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
    // حالة قاعدة بيانات قبل تطبيق الترحيل 016 — نفس السبب بصياغة قديمة.
    test: /Invoice ([^ ]+) has no revenue lines/i,
    ar: (m) =>
      `الفاتورة ${m[1]} بلا أسطر إيراد: كل بنودها إما بلا صنف محتسب أو قيمتها صفر. أضف بنداً بقيمة أكبر من صفر قبل الترحيل.`,
    en: "The invoice has no revenue lines; add a line with a value above zero.",
  },
  {
    test: /بلا أسطر إيراد/,
    ar: "الفاتورة بلا أسطر إيراد: كل بنودها إما بلا صنف محتسب أو قيمتها صفر. أعد فتح الفاتورة وأضف بنداً بقيمة أكبر من صفر قبل الترحيل.",
    en: "The invoice has no revenue lines; add a line with a value above zero.",
  },
  {
    test: /Discount cannot be negative/i,
    ar: "الخصم لا يكون سالباً.",
    en: "The discount cannot be negative.",
  },
  {
    test: /Every sale line requires a positive quantity/i,
    ar: "كل بند بيع يحتاج كمية أكبر من صفر.",
    en: "Every sale line requires a positive quantity.",
  },
  {
    test: /Every service line requires a description/i,
    ar: "كل سطر خدمة يحتاج وصفاً.",
    en: "Every service line requires a description.",
  },
  {
    test: /Service line "([^"]+)" has an invalid price or tax rate/i,
    ar: (m) => `سطر الخدمة «${m[1]}» له سعر أو ضريبة غير صالحة.`,
    en: "The service line has an invalid price or tax rate.",
  },
  {
    test: /Item ([0-9a-f-]+) is not available for sale/i,
    ar: "أحد الأصناف لم يعد متاحاً للبيع — أعد اختياره من القائمة.",
    en: "An item is no longer available for sale.",
  },
  {
    test: /Item ([0-9a-f-]+) is not marked as sellable/i,
    ar: "أحد الأصناف غير معلّم للبيع — فعّله من شاشة الأصناف.",
    en: "An item is not marked as sellable.",
  },
  {
    test: /Item ([0-9a-f-]+) has invalid pricing or tax configuration/i,
    ar: "أحد الأصناف له سعر أو ضريبة غير صالحة في بياناته — صحّح بيانات الصنف.",
    en: "An item has invalid pricing or tax configuration.",
  },
  {
    test: /Unsupported (split )?payment method:? ?%?/i,
    ar: "طريقة الدفع غير مدعومة — أعد اختيارها من القائمة.",
    en: "Unsupported payment method.",
  },
  {
    test: /Split breakdown total \(([\d.]+)\) does not match paid amount \(([\d.]+)\)/i,
    ar: (m) => `مجموع أجزاء الدفع (${m[1]}) لا يطابق المبلغ المدفوع (${m[2]}).`,
    en: "The split total does not match the paid amount.",
  },
  {
    test: /Invoice ([^ ]+) split total \(([\d.]+)\) does not match paid amount \(([\d.]+)\)/i,
    ar: (m) =>
      `مجموع أجزاء الدفع للفاتورة (${m[2]}) لا يطابق المبلغ المدفوع (${m[3]}).`,
    en: "The split total does not match the paid amount.",
  },
  {
    test: /Payment method id does not match split tender/i,
    ar: "طريقة الدفع المختارة لا تطابق أحد أجزاء الدفع المجزأ.",
    en: "The payment method does not match a split tender.",
  },
  {
    test: /A payment method may only be included once in a split/i,
    ar: "لا تكرر الطريقة نفسها في الدفع المجزأ — اجمع قيمتها في جزء واحد.",
    en: "A payment method may appear only once in a split.",
  },
  {
    test: /Every payment tender component requires a positive amount/i,
    ar: "كل جزء من الدفع المجزأ يحتاج مبلغاً أكبر من صفر.",
    en: "Every split component needs a positive amount.",
  },
  {
    test: /Paid amount \(([\d.]+)\) must be between zero and the invoice total \(([\d.]+)\)/i,
    ar: (m) => `المدفوع (${m[1]}) يجب أن يكون بين صفر وإجمالي الفاتورة (${m[2]}).`,
    en: "The paid amount must be between zero and the invoice total.",
  },
  {
    test: /Warehouse is required/i,
    ar: "اختر المستودع قبل تنفيذ العملية.",
    en: "A warehouse is required.",
  },
  {
    test: /Selected (customer|warehouse|supplier) is unavailable/i,
    ar: (m) =>
      m[1] === "customer"
        ? "العميل المختار غير متاح — قد يكون متوقفاً."
        : m[1] === "supplier"
          ? "المورد المختار غير متاح — قد يكون متوقفاً."
          : "المستودع المختار غير متاح — قد يكون متوقفاً.",
    en: "The selected record is unavailable.",
  },
  {
    test: /Payment exceeds the invoice outstanding balance/i,
    ar: "المبلغ يتجاوز المتبقي على الفاتورة.",
    en: "The payment exceeds the invoice balance.",
  },
  {
    test: /Payment exceeds the customer outstanding balance \(([\d.]+)\)/i,
    ar: (m) => `المبلغ يتجاوز رصيد العميل المستحق (${m[1]}).`,
    en: "The payment exceeds the customer balance.",
  },
  {
    test: /Invoice has no outstanding balance/i,
    ar: "الفاتورة مسددة بالكامل — لا متبقي عليها.",
    en: "The invoice has no outstanding balance.",
  },
  {
    test: /Invoice does not belong to this customer/i,
    ar: "الفاتورة لا تخص هذا العميل.",
    en: "The invoice does not belong to this customer.",
  },
  {
    test: /A collection cannot be dated in the future \(([^)]+)\)/i,
    ar: (m) => `لا يمكن تأريخ التحصيل بمستقبل (${m[1]}).`,
    en: "A collection cannot be dated in the future.",
  },
  {
    test: /A collection cannot record/i,
    ar: "التحصيل لا يسجَّل آجلاً — الآجل بيع مؤجل وليس قبض مبلغ.",
    en: "A collection cannot be recorded as credit.",
  },
  {
    test: /Collection total \(([\d.]+)\) does not match the sum of its tenders \(([\d.]+)\)/i,
    ar: (m) => `إجمالي التحصيل (${m[1]}) لا يطابق مجموع أجزائه (${m[2]}).`,
    en: "The collection total does not match its tenders.",
  },
  {
    test: /Combine each original invoice line into one return line/i,
    ar: "اجمع كل بند من فاتورة الأصل في سطر مرتجع واحد.",
    en: "Combine each invoice line into one return line.",
  },
  {
    test: /Every sales return line must match an original invoice line/i,
    ar: "كل سطر مرتجع يجب أن يطابق بنداً من الفاتورة الأصلية ووحدته.",
    en: "Every return line must match an original invoice line.",
  },
  {
    test: /The return value must be greater than zero/i,
    ar: "قيمة المرتجع يجب أن تكون أكبر من صفر.",
    en: "The return value must be greater than zero.",
  },
  {
    test: /A return requires a confirmed purchase invoice/i,
    ar: "مرتجع الشراء يحتاج فاتورة شراء مؤكدة.",
    en: "A return requires a confirmed purchase invoice.",
  },
  {
    test: /Purchase return exceeds received quantity: received ([\d.]+), already returned ([\d.]+), requested ([\d.]+)/i,
    ar: (m) =>
      `كمية مرتجع الشراء تتجاوز المستلم: المستلم ${m[1]}، المرتجع سابقاً ${m[2]}، المطلوب ${m[3]}.`,
    en: "The purchase return exceeds the received quantity.",
  },
  {
    test: /Purchase return supplier and warehouse must match the original invoice/i,
    ar: "مورد ومستودع مرتجع الشراء يجب أن يطابقا فاتورة الشراء الأصلية.",
    en: "The return supplier and warehouse must match the original invoice.",
  },
  {
    test: /Original (purchase )?invoice ([^ ]+) does not exist/i,
    ar: "الفاتورة الأصلية غير موجودة — قد تكون حُذفت أو رقمها خاطئ.",
    en: "The original invoice does not exist.",
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

/**
 * Statement Engine — Shared Types
 *
 * هذه الأنواع هي العقد الوحيد بين طبقة القراءة (adapters)، طبقة الحساب (engine)،
 * وطبقة العرض (components / قوالب الطباعة).
 *
 * قيد صارم: لا نوع هنا يعتمد على تغيير في قاعدة البيانات.
 * كل الحقول مُستخرَجة من الجداول الموجودة فعليًا:
 *   customer_ledger · sales_invoices · customer_payments · sales_returns · returns
 *   purchase_invoices · purchase_returns · expenses · customers · suppliers
 */

/** أنواع الحسابات المدعومة حاليًا (قابلة للتوسّع: representative لاحقًا) */
export type StatementEntityType = "customer" | "supplier" | "cash";

/** أنواع الحركات داخل الكشف */
export type StatementEntryKind =
  | "sale" // فاتورة بيع آجل (أو توريد مورد)
  | "payment" // سداد / تحصيل
  | "return" // مرتجع
  | "adjustment" // تسوية يدوية
  | "expense" // مصروف (لكشف الصندوق)
  | "opening"; // سطر اصطناعي للرصيد الافتتاحي — لا يُخزَّن ولا يُحسب ضمن المجاميع

/** أسماء الحقول القابلة للإظهار/الإخفاء والترتيب والتسمية */
export type StatementFieldKey =
  | "index"
  | "date"
  | "reference"
  | "kind"
  | "description"
  | "debit"
  | "credit"
  | "balance"
  | "paymentMethod";

/** حالة الرصيد النهائي */
export type StatementDirection = "debit" | "credit" | "zero";

/**
 * حركة واحدة مُوحَّدة — المخرج من كل adapter.
 * كل adapter مسؤول عن تحويل مصدره إلى هذه البنية دون أي حساب أرصدة.
 */
export interface LedgerEntry {
  /** مفتاح فريد مستقر: `${source}:${id}` — يُستخدم للترتيب الحتمي ولمفاتيح React */
  id: string;
  /** وقت الحدوث بصيغة ISO */
  occurredAt: string;
  /** نوع الحركة */
  kind: Exclude<StatementEntryKind, "opening">;
  /** الجانب المدين (>= 0) */
  debit: number;
  /** الجانب الدائن (>= 0) */
  credit: number;
  /** رقم الفاتورة / السند / المرتجع */
  reference: string | null;
  /** البيان / الوصف */
  description: string | null;
  /** معرّف المستند الأصلي للربط (فاتورة/دفعة) */
  referenceId: string | null;
  /** نوع المستند الأصلي (sales_invoice / customer_payment / ...) */
  referenceType: string | null;
  /** بيانات إضافية اختيارية (طريقة الدفع، المستودع...) */
  meta?: Record<string, unknown>;
}

/** بيانات الجهة (عميل / مورد / صندوق) */
export interface StatementEntity {
  id: string;
  type: StatementEntityType;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  /** الحد الائتماني — للعملاء فقط (null للموردين) */
  creditLimit: number | null;
  /** الرصيد المخزَّن (cache) للمقارنة والتحقق */
  cachedBalance: number | null;
}

/** طلب إنشاء كشف */
export interface StatementRequest {
  entityType: StatementEntityType;
  entityId: string;
  /** من تاريخ (YYYY-MM-DD) — شامل */
  from?: string | null;
  /** إلى تاريخ (YYYY-MM-DD) — شامل */
  to?: string | null;
  /** إظهار الفواتير المسددة كليًا — افتراضي false */
  includeZeroRows?: boolean;
}

/** سطر داخل الكشف (حركة + رصيدها التراكمي) */
export interface StatementTransaction extends LedgerEntry {
  /** الرصيد التراكمي بعد هذه الحركة */
  runningBalance: number;
  /** تسلسل العرض داخل الفترة (يبدأ من 1) */
  index: number;
}

/** نتائج التحقق بين رصيد الدفتر والرصيد المخزَّن */
export interface StatementIntegrity {
  /** الرصيد المحسوب من الحركات الكاملة */
  ledgerBalance: number;
  /** الرصيد المخزَّن في customers/suppliers.balance */
  cachedBalance: number | null;
  /** الفرق = ledgerBalance - cachedBalance */
  difference: number | null;
  /** هل هناك فرق يستدعي التحذير؟ */
  hasGap: boolean;
}

/** المخرج النهائي المُطبَّع — كل قالب وكل تصدير يستهلك هذا فقط */
export interface StatementResult {
  entityType: StatementEntityType;
  entity: StatementEntity | null;
  period: {
    from: string | null;
    to: string | null;
    /** نص جاهز للطباعة مثل: «01/01/2026 — 31/03/2026» */
    label: string;
  };
  /** رصيد ما قبل بداية الفترة */
  openingBalance: number;
  /** حركات الفترة فقط (بدون صف الرصيد الافتتاحي) */
  transactions: StatementTransaction[];
  /** هل تُعرض الحركات المسددة كليًا؟ */
  includeZeroRows: boolean;
  /** مجموع الحركات المُحتسبة داخل الفترة */
  totalDebit: number;
  totalCredit: number;
  /** الرصيد الختامي = opening + totalDebit - totalCredit */
  closingBalance: number;
  direction: StatementDirection;
  /** عدد الحركات المُحتسبة في المجاميع (قبل أي pagination للعرض) */
  countedRows: number;
  integrity: StatementIntegrity;
  generatedAt: string;
}

/**
 * وصف عمود في القالب.
 * القالب لا يحسب شيئًا — يصف فقط.
 */
export interface StatementColumn {
  key: StatementFieldKey;
  /** التسمية النهائية بعد تطبيق تخصيص المستخدم */
  label: string;
  align: "start" | "center" | "end";
  /** صيغة العرض */
  format: "text" | "money" | "number";
  /** عرض تقديري في قالب الطباعة */
  width?: string;
}

export type StatementTemplateId = "detailed" | "compact" | "customer" | "supplier" | "debts";

/** حِزمة القالب الجاهزة للعرض */
export interface StatementLayout {
  templateId: StatementTemplateId;
  title: string;
  subtitle: string;
  columns: StatementColumn[];
  showOpeningRow: boolean;
  showSummaryCards: boolean;
  showSignatures: boolean;
  showTotalsRow: boolean;
  showNotes: boolean;
  showBrandFooter: boolean;
  /** أعمدة الرأس التي تُعرض في ترويسة المنشأة */
  header: {
    showLogo: boolean;
    showLegalName: boolean;
    showTaxNumber: boolean;
    showAddress: boolean;
    showPhone: boolean;
    customLine: string;
  };
  /** نص الملاحظات الافتراضي أسفل الجدول */
  notesText: string;
  /** نص سطر التذييل الافتراضي */
  footerNote: string;
}

/** نطاق تاريخ جاهز */
export interface StatementDateRange {
  from: string | null;
  to: string | null;
}

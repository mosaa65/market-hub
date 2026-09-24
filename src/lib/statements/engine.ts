/**
 * Statement Engine — الحساب النقي (Pure)
 *
 * ⚠️ قاعدة معمارية صارمة:
 *   - لا React، لا Supabase، لا I/O، لا side effects.
 *   - كل رقم في أي كشف داخل النظام يجب أن يخرج من هذه الدالة.
 *   - أي شاشة تحسب رصيدًا بنفسها تُعدّ مخالفة معمارية (Enforced in Phase 10).
 *
 * المعادلة الموحّدة:
 *   openingBalance = Σ(debit - credit)  لكل حركة قبل `from`
 *   totalDebit     = Σ debit            داخل [from, to]
 *   totalCredit    = Σ credit           داخل [from, to]
 *   runningBalance = openingBalance + Σ(debit - credit) حتى الصف الحالي
 *   closingBalance = openingBalance + totalDebit - totalCredit
 */

import type {
  LedgerEntry,
  StatementDirection,
  StatementEntity,
  StatementEntityType,
  StatementEntryKind,
  StatementIntegrity,
  StatementRequest,
  StatementResult,
  StatementTransaction,
} from "./types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** ترتيب حتمي عند تساوي الوقت: البيع ← المرتجع ← السداد ← التسوية ← المصروف */
const KIND_RANK: Record<Exclude<StatementEntryKind, "opening">, number> = {
  sale: 0,
  return: 1,
  payment: 2,
  adjustment: 3,
  expense: 4,
};

/** فرق مسموح به للتقريب (نصف سنت) */
export const EPSILON = 0.005;

/** عدد المنازل العشرية المعتمد في النظام */
export const DECIMALS = 2;

// ---------------------------------------------------------------------------
// Numeric helpers — تمنع أخطاء الفاصلة العائمة
// ---------------------------------------------------------------------------

/** تقريب آمن إلى منزلتين */
export function round2(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function toAmount(n: unknown): number {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return 0;
  return round2(v);
}

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

/** استخراج مفتاح اليوم (YYYY-MM-DD) من ISO أو date string */
export function dayKey(iso: string): string {
  if (!iso) return "";
  // نتائج Supabase تأتي بصيغة ISO كاملة أو YYYY-MM-DD
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(iso);
  if (match) return match[1];
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (x: number) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** هل اليوم يقع قبل بداية الفترة؟ */
function isBefore(key: string, from: string | null): boolean {
  if (!from) return false;
  if (!key) return false;
  return key < from;
}

/** هل اليوم يقع داخل الفترة (شامل الطرفين)؟ */
function isWithin(key: string, from: string | null, to: string | null): boolean {
  if (!key) return false;
  if (from && key < from) return false;
  if (to && key > to) return false;
  return true;
}

/**
 * ترتيب حتمي للحركات.
 * يحل مشكلة «نفس التاريخ يعطي أرصدة مختلفة بين شاشتين».
 */
export function compareEntries(a: LedgerEntry, b: LedgerEntry): number {
  const aKey = dayKey(a.occurredAt);
  const bKey = dayKey(b.occurredAt);
  if (aKey !== bKey) return aKey < bKey ? -1 : 1;

  // نفس اليوم: نُقارن بالوقت الكامل إن توفّر
  if (a.occurredAt !== b.occurredAt) {
    return a.occurredAt < b.occurredAt ? -1 : 1;
  }

  const rank = KIND_RANK[a.kind] - KIND_RANK[b.kind];
  if (rank !== 0) return rank;

  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

// ---------------------------------------------------------------------------
// Period label
// ---------------------------------------------------------------------------

function formatDay(key: string | null): string {
  if (!key) return "";
  const [y, m, d] = key.split("-");
  if (!y || !m || !d) return key;
  return `${d}/${m}/${y}`;
}

export function buildPeriodLabel(
  from: string | null,
  to: string | null,
  lang: "ar" | "en" = "ar",
): string {
  if (!from && !to) return lang === "ar" ? "كل الفترات" : "All periods";
  if (from && to) return `${formatDay(from)} — ${formatDay(to)}`;
  if (from) return lang === "ar" ? `من ${formatDay(from)}` : `From ${formatDay(from)}`;
  return lang === "ar" ? `حتى ${formatDay(to)}` : `Until ${formatDay(to)}`;
}

// ---------------------------------------------------------------------------
// Core
// ---------------------------------------------------------------------------

export interface BuildStatementOptions {
  request: StatementRequest;
  entity: StatementEntity | null;
  /** كل حركات الحساب (قبل الفلترة) — مرتبة داخليًا */
  entries: LedgerEntry[];
  /** الرصيد المخزَّن للمقارنة (customers.balance / suppliers.balance) */
  cachedBalance?: number | null;
  /** لغة تسمية الفترة */
  lang?: "ar" | "en";
  /** طابع وقت التوليد — قابل للتمرير للاختبارات الحتمية */
  generatedAt?: string;
}

/**
 * بناء الكشف. هذه هي الدالة الوحيدة المسؤولة عن كل الأرقام المالية.
 */
export function buildStatement(options: BuildStatementOptions): StatementResult {
  const { request, entity, entries, lang = "ar" } = options;
  const from = normalizeDate(request.from);
  const to = normalizeDate(request.to);
  const includeZeroRows = request.includeZeroRows === true;
  const cachedBalance =
    options.cachedBalance === undefined ? (entity?.cachedBalance ?? null) : options.cachedBalance;

  // 1) ترتيب حتمي للنسخة الكاملة
  const ordered = [...entries].filter((e) => e && e.occurredAt).sort(compareEntries);

  // 2) الرصيد الافتتاحي = صافي كل ما قبل بداية الفترة
  let openingBalance = 0;
  for (const entry of ordered) {
    if (isBefore(dayKey(entry.occurredAt), from)) {
      openingBalance += toAmount(entry.debit) - toAmount(entry.credit);
    }
  }
  openingBalance = round2(openingBalance);

  // 3) حركات الفترة + الرصيد التراكمي
  let running = openingBalance;
  let totalDebit = 0;
  let totalCredit = 0;
  let countedRows = 0;
  const transactions: StatementTransaction[] = [];

  for (const entry of ordered) {
    const key = dayKey(entry.occurredAt);
    if (!isWithin(key, from, to)) continue;

    const debit = toAmount(entry.debit);
    const credit = toAmount(entry.credit);

    // فاتورة مسددة كليًا: debit == credit > 0 → لا أثر على الرصيد
    const isSelfSettled = debit > 0 && credit > 0 && Math.abs(debit - credit) < EPSILON;
    if (!includeZeroRows && isSelfSettled) continue;

    running = round2(running + debit - credit);
    totalDebit = round2(totalDebit + debit);
    totalCredit = round2(totalCredit + credit);
    countedRows += 1;

    transactions.push({
      ...entry,
      debit,
      credit,
      runningBalance: running,
      index: countedRows,
    });
  }

  const closingBalance = round2(openingBalance + totalDebit - totalCredit);

  // 4) اتجاه الرصيد — يُترجم في طبقة العرض حسب نوع الجهة،
  //    لكن الإشارة المحاسبية محسوبة هنا مرة واحدة.
  const direction = directionOf(closingBalance);

  // 5) التحقق من الفرق مع الرصيد المخزَّن
  const ledgerBalance = round2(
    ordered.reduce((acc, e) => acc + toAmount(e.debit) - toAmount(e.credit), 0),
  );

  const integrity = buildIntegrity(ledgerBalance, cachedBalance);

  return {
    entityType: request.entityType,
    entity,
    period: { from, to, label: buildPeriodLabel(from, to, lang) },
    openingBalance,
    transactions,
    includeZeroRows,
    totalDebit,
    totalCredit,
    closingBalance,
    direction,
    countedRows,
    integrity,
    generatedAt: options.generatedAt ?? new Date().toISOString(),
  };
}

function normalizeDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const key = dayKey(value);
  return key || null;
}

function directionOf(balance: number): StatementDirection {
  if (Math.abs(balance) < EPSILON) return "zero";
  return balance > 0 ? "debit" : "credit";
}

function buildIntegrity(
  ledgerBalance: number,
  cachedBalance: number | null | undefined,
): StatementIntegrity {
  if (cachedBalance === null || cachedBalance === undefined) {
    return { ledgerBalance, cachedBalance: null, difference: null, hasGap: false };
  }
  const cached = round2(Number(cachedBalance));
  const difference = round2(ledgerBalance - cached);
  return {
    ledgerBalance,
    cachedBalance: cached,
    difference,
    hasGap: Math.abs(difference) > EPSILON,
  };
}

// ---------------------------------------------------------------------------
// Helpers مُشتقّة تُستخدم في كل الشاشات والتقارير
// ---------------------------------------------------------------------------

/**
 * الرصيد الختامي للجهة حتى تاريخ معيّن — يُستخدم في بطاقات الديون،
 * ميزان المراجعة، والميزانية العمومية، بدل استخدام العمود المخزَّن.
 */
export function balanceAsOf(entries: LedgerEntry[], asOf: string | null = null): number {
  const to = normalizeDate(asOf);
  let total = 0;
  for (const entry of entries) {
    const key = dayKey(entry.occurredAt);
    if (to && key > to) continue;
    total += toAmount(entry.debit) - toAmount(entry.credit);
  }
  return round2(total);
}

/**
 * أعمار الديون (Aging) — تخصيص FIFO للسدادات على الفواتير الأقدم.
 * لا يحتاج أي حقل `due_date` غير موجود؛ يعتمد تاريخ الفاتورة فقط.
 *
 * @param buckets حدود الأيام: [30, 60, 90] → { current, d30, d60, d90, older }
 */
export interface AgingBuckets {
  current: number;
  d30: number;
  d60: number;
  d90: number;
  older: number;
  total: number;
}

export interface AgingRow {
  invoiceId: string;
  reference: string | null;
  invoiceDate: string;
  original: number;
  settled: number;
  outstanding: number;
  ageDays: number;
  bucket: keyof Omit<AgingBuckets, "total">;
}

export interface AgingResult {
  rows: AgingRow[];
  buckets: AgingBuckets;
  /** مبالغ لم تُخصَّص لأي فاتورة (دفعات مقدمة) */
  unallocatedPayment: number;
}

export function buildAging(
  entries: LedgerEntry[],
  options: { asOf?: string | null; buckets?: [number, number, number] } = {},
): AgingResult {
  const [b1, b2, b3] = options.buckets ?? [30, 60, 90];
  const asOfKey = normalizeDate(options.asOf) ?? dayKey(new Date().toISOString());
  const asOfTime = new Date(`${asOfKey}T23:59:59`).getTime();

  const ordered = [...entries].sort(compareEntries);
  const sales = ordered.filter((e) => e.kind === "sale" && toAmount(e.debit) > 0);
  const reductions = ordered.filter(
    (e) => (e.kind === "payment" || e.kind === "return") && toAmount(e.credit) > 0,
  );

  let pool = round2(reductions.reduce((a, e) => a + toAmount(e.credit), 0));

  const rows: AgingRow[] = [];
  for (const sale of sales) {
    const original = toAmount(sale.debit);
    const settled = round2(Math.min(pool, original));
    pool = round2(pool - settled);
    const outstanding = round2(original - settled);
    if (outstanding <= EPSILON) continue;

    const ageDays = Math.max(
      0,
      Math.floor((asOfTime - new Date(sale.occurredAt).getTime()) / 86_400_000),
    );

    rows.push({
      invoiceId: sale.referenceId ?? sale.id,
      reference: sale.reference,
      invoiceDate: sale.occurredAt,
      original,
      settled,
      outstanding,
      ageDays,
      bucket: bucketOf(ageDays, b1, b2, b3),
    });
  }

  const buckets: AgingBuckets = {
    current: 0,
    d30: 0,
    d60: 0,
    d90: 0,
    older: 0,
    total: 0,
  };
  for (const row of rows) {
    buckets[row.bucket] = round2(buckets[row.bucket] + row.outstanding);
    buckets.total = round2(buckets.total + row.outstanding);
  }

  return { rows, buckets, unallocatedPayment: round2(Math.max(pool, 0)) };
}

function bucketOf(
  ageDays: number,
  b1: number,
  b2: number,
  b3: number,
): keyof Omit<AgingBuckets, "total"> {
  if (ageDays <= b1) return "current";
  if (ageDays <= b2) return "d30";
  if (ageDays <= b3) return "d60";
  if (ageDays <= b3 * 2) return "d90";
  return "older";
}

/** تجميع الحركات لكل جهة — يُستخدم في كشف الديون */
export function groupByEntity(entries: LedgerEntry[]): Map<string, LedgerEntry[]> {
  const map = new Map<string, LedgerEntry[]>();
  for (const entry of entries) {
    const key = extractEntityKey(entry);
    if (!key) continue;
    const list = map.get(key);
    if (list) list.push(entry);
    else map.set(key, [entry]);
  }
  return map;
}

function extractEntityKey(entry: LedgerEntry): string | null {
  const fromMeta = entry.meta?.entityId;
  return typeof fromMeta === "string" ? fromMeta : null;
}

/** أعلى/أدنى تاريخ داخل مجموعة حركات — لبناء كشف افتراضي بلا فلتر */
export function entriesRange(entries: LedgerEntry[]): { from: string | null; to: string | null } {
  if (entries.length === 0) return { from: null, to: null };
  const keys = entries
    .map((e) => dayKey(e.occurredAt))
    .filter(Boolean)
    .sort();
  if (keys.length === 0) return { from: null, to: null };
  return { from: keys[0], to: keys[keys.length - 1] };
}

/** تسمية نوع العملية — تُستخدم في كل الكشوف والقوالب */
export function kindLabel(
  kind: StatementEntryKind,
  entityType: StatementEntityType,
  lang: "ar" | "en",
): string {
  const ar = lang === "ar";
  if (kind === "opening") return ar ? "رصيد افتتاحي" : "Opening Balance";
  switch (kind) {
    case "sale":
      return entityType === "supplier"
        ? ar
          ? "فاتورة توريد"
          : "Supply Invoice"
        : ar
          ? "فاتورة بيع"
          : "Sales Invoice";
    case "payment":
      return entityType === "supplier"
        ? ar
          ? "سداد للمورد"
          : "Supplier Payment"
        : ar
          ? "سداد / تحصيل"
          : "Payment / Collection";
    case "return":
      return entityType === "supplier"
        ? ar
          ? "مرتجع مشتريات"
          : "Purchase Return"
        : ar
          ? "مرتجع بيع"
          : "Sales Return";
    case "adjustment":
      return ar ? "تسوية" : "Adjustment";
    case "expense":
      return ar ? "مصروف" : "Expense";
    default:
      return String(kind);
  }
}

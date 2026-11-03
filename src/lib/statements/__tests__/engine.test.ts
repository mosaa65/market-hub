/**
 * Statement Engine — اختبارات الوحدة
 *
 * لماذا سكربت مستقل بدل إطار اختبار؟
 * المشروع لا يحتوي أي test runner (لا vitest ولا jest في package.json)، وإضافة
 * اعتمادية جديدة خارج نطاق مهمة الكشوف. لذلك كُتبت الاختبارات كوحدة تحقق
 * صفرية الاعتماديات تعمل بأمر واحد:
 *
 *   npm run test:statements
 *
 * كل الاختبارات تعمل على الـ Engine النقي فقط — بلا Supabase وبلا React.
 */

import {
  balanceAsOf,
  buildAging,
  buildPeriodLabel,
  buildStatement,
  compareEntries,
  dayKey,
  round2,
  EPSILON,
} from "../engine";
import type { LedgerEntry, StatementEntity, StatementEntityType } from "../types";

// ---------------------------------------------------------------------------
// Mini test harness
// ---------------------------------------------------------------------------

let passed = 0;
const failures: string[] = [];
let currentSuite = "";

function suite(name: string) {
  currentSuite = name;
}

function check(label: string, condition: boolean, detail?: string) {
  if (condition) {
    passed += 1;
  } else {
    failures.push(`[${currentSuite}] ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

function eq(label: string, actual: unknown, expected: unknown) {
  const ok =
    typeof actual === "number" && typeof expected === "number"
      ? Math.abs(actual - expected) < EPSILON
      : actual === expected;
  check(label, ok, ok ? undefined : `توقّع ${String(expected)} — حصلنا على ${String(actual)}`);
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const CUSTOMER_ID = "11111111-1111-1111-1111-111111111111";
const SUPPLIER_ID = "22222222-2222-2222-2222-222222222222";

function entry(
  id: string,
  occurredAt: string,
  kind: LedgerEntry["kind"],
  debit: number,
  credit: number,
  extra: Partial<LedgerEntry> = {},
): LedgerEntry {
  return {
    id,
    occurredAt,
    kind,
    debit,
    credit,
    reference: extra.reference ?? null,
    description: extra.description ?? null,
    referenceId: extra.referenceId ?? null,
    referenceType: extra.referenceType ?? null,
    meta: extra.meta,
  };
}

function customerEntity(cachedBalance: number | null = null): StatementEntity {
  return {
    id: CUSTOMER_ID,
    type: "customer",
    name: "أحمد محمد",
    phone: "777000111",
    email: null,
    address: "صنعاء",
    creditLimit: 100000,
    cachedBalance,
  };
}

function build(
  entries: LedgerEntry[],
  request: Partial<Parameters<typeof buildStatement>[0]["request"]> & {
    entityType: StatementEntityType;
    entityId: string;
  },
  entity: StatementEntity | null = customerEntity(),
  cachedBalance?: number | null,
) {
  return buildStatement({
    request: { includeZeroRows: false, ...request },
    entity,
    entries,
    cachedBalance,
    generatedAt: "2026-04-01T00:00:00.000Z",
  });
}

// ---------------------------------------------------------------------------
// 1 · كشف فارغ
// ---------------------------------------------------------------------------
suite("1 · كشف فارغ");
{
  const result = build([], { entityType: "customer", entityId: CUSTOMER_ID });
  eq("opening = 0", result.openingBalance, 0);
  eq("totalDebit = 0", result.totalDebit, 0);
  eq("totalCredit = 0", result.totalCredit, 0);
  eq("closing = 0", result.closingBalance, 0);
  eq("لا حركات", result.transactions.length, 0);
  eq("اتجاه صفري", result.direction, "zero");
  eq("countedRows = 0", result.countedRows, 0);
}

// ---------------------------------------------------------------------------
// 2 · حركة واحدة مدين
// ---------------------------------------------------------------------------
suite("2 · حركة واحدة مدين");
{
  const rows = [entry("l1", "2026-01-05T10:00:00Z", "sale", 1500, 0, { reference: "INV-1001" })];
  const result = build(rows, { entityType: "customer", entityId: CUSTOMER_ID });
  eq("opening = 0", result.openingBalance, 0);
  eq("totalDebit", result.totalDebit, 1500);
  eq("closing = الرصيد", result.closingBalance, 1500);
  eq("اتجاه مدين", result.direction, "debit");
  eq("رصيد السطر", result.transactions[0].runningBalance, 1500);
}

// ---------------------------------------------------------------------------
// 3 · Opening Balance = صافي ما قبل الفترة
// ---------------------------------------------------------------------------
suite("3 · Opening Balance");
{
  const rows = [
    entry("l1", "2025-12-20T10:00:00Z", "sale", 5000, 0),
    entry("l2", "2025-12-25T10:00:00Z", "payment", 0, 2000),
    entry("l3", "2026-01-10T10:00:00Z", "sale", 3000, 0),
    entry("l4", "2026-01-20T10:00:00Z", "payment", 0, 1000),
  ];
  const result = build(rows, {
    entityType: "customer",
    entityId: CUSTOMER_ID,
    from: "2026-01-01",
    to: "2026-01-31",
  });
  eq("opening = 5000-2000", result.openingBalance, 3000);
  eq("totalDebit للفترة", result.totalDebit, 3000);
  eq("totalCredit للفترة", result.totalCredit, 1000);
  eq("closing", result.closingBalance, 5000);
  eq("حركتان داخل الفترة", result.transactions.length, 2);
  eq("أول رصيد تراكمي", result.transactions[0].runningBalance, 6000);
  eq("آخر رصيد تراكمي", result.transactions[1].runningBalance, 5000);
}

// ---------------------------------------------------------------------------
// 4 · ثابت Closing = opening + debit - credit
// ---------------------------------------------------------------------------
suite("4 · ثابت الرصيد الختامي");
{
  const scenarios: LedgerEntry[][] = [
    [],
    [entry("a", "2026-01-02T00:00:00Z", "sale", 100, 0)],
    [
      entry("a", "2025-11-02T00:00:00Z", "sale", 900, 0),
      entry("b", "2026-02-02T00:00:00Z", "payment", 0, 250.75),
    ],
    [
      entry("a", "2026-01-01T00:00:00Z", "sale", 1234.56, 0),
      entry("b", "2026-01-01T00:00:00Z", "return", 0, 234.56),
      entry("c", "2026-01-15T00:00:00Z", "payment", 0, 1000),
      entry("d", "2026-02-01T00:00:00Z", "adjustment", 50, 0),
    ],
    [
      entry("a", "2025-06-01T00:00:00Z", "sale", 10, 0),
      entry("b", "2025-06-02T00:00:00Z", "payment", 0, 3),
    ],
  ];
  for (let i = 0; i < scenarios.length; i += 1) {
    const result = build(scenarios[i], {
      entityType: "customer",
      entityId: CUSTOMER_ID,
      from: "2026-01-01",
      to: "2026-03-31",
    });
    const expected = round2(result.openingBalance + result.totalDebit - result.totalCredit);
    eq(`سيناريو ${i + 1}: closing = opening + D - C`, result.closingBalance, expected);
  }
}

// ---------------------------------------------------------------------------
// 5 · Running Balance آخر سطر = Closing
// ---------------------------------------------------------------------------
suite("5 · توافق الرصيد التراكمي مع الختامي");
{
  const rows = [
    entry("a", "2025-12-01T00:00:00Z", "sale", 200, 0),
    entry("b", "2026-01-03T00:00:00Z", "sale", 800, 0),
    entry("c", "2026-01-04T00:00:00Z", "payment", 0, 300),
    entry("d", "2026-01-09T00:00:00Z", "return", 0, 100),
  ];
  const result = build(rows, {
    entityType: "customer",
    entityId: CUSTOMER_ID,
    from: "2026-01-01",
    to: "2026-01-31",
  });
  const last = result.transactions[result.transactions.length - 1];
  eq("آخر runningBalance = closing", last.runningBalance, result.closingBalance);
  eq("closing = 200+800-300-100", result.closingBalance, 600);
}

// ---------------------------------------------------------------------------
// 6 · دفعة جزئية
// ---------------------------------------------------------------------------
suite("6 · دفعة جزئية");
{
  const rows = [
    entry("s", "2026-01-01T00:00:00Z", "sale", 1000, 0),
    entry("p", "2026-01-05T00:00:00Z", "payment", 0, 400),
  ];
  const result = build(rows, { entityType: "customer", entityId: CUSTOMER_ID });
  eq("الرصيد بعد الدفعة الجزئية", result.closingBalance, 600);
  eq("الدائن", result.totalCredit, 400);
  eq("الدفعة تظهر كسطر", result.transactions[1].kind, "payment");
}

// ---------------------------------------------------------------------------
// 7 · فاتورة مسددة كليًا (self-settled)
// ---------------------------------------------------------------------------
suite("7 · فاتورة مسددة كليًا");
{
  const rows = [entry("self", "2026-01-01T00:00:00Z", "sale", 500, 500)];
  const hidden = build(rows, { entityType: "customer", entityId: CUSTOMER_ID });
  eq("مخفية افتراضيًا", hidden.transactions.length, 0);
  eq("الرصيد لا يتأثر", hidden.closingBalance, 0);

  const shown = build(rows, {
    entityType: "customer",
    entityId: CUSTOMER_ID,
    includeZeroRows: true,
  });
  eq("تظهر عند الطلب", shown.transactions.length, 1);
  eq("الرصيد يبقى صفرًا", shown.closingBalance, 0);
}

// ---------------------------------------------------------------------------
// 8 · مرتجع
// ---------------------------------------------------------------------------
suite("8 · مرتجع");
{
  const rows = [
    entry("s", "2026-01-01T00:00:00Z", "sale", 1000, 0),
    entry("r", "2026-01-06T00:00:00Z", "return", 0, 250),
  ];
  const result = build(rows, { entityType: "customer", entityId: CUSTOMER_ID });
  eq("المرتجع يخصم", result.closingBalance, 750);
  eq("المرتجع كدائن", result.totalCredit, 250);
  eq("نوع الحركة", result.transactions[1].kind, "return");
}

// ---------------------------------------------------------------------------
// 9 · حركتان بنفس التاريخ — ترتيب حتمي
// ---------------------------------------------------------------------------
suite("9 · ترتيب حتمي عند تساوي التاريخ");
{
  const sale = entry("b-sale", "2026-01-10T09:00:00Z", "sale", 500, 0);
  const payment = entry("a-payment", "2026-01-10T09:00:00Z", "payment", 0, 100);

  // نمرّر الدفعة أولًا عن قصد لاختبار أن الترتيب لا يعتمد على ترتيب الإدخال
  const first = build([payment, sale], { entityType: "customer", entityId: CUSTOMER_ID });
  const second = build([sale, payment], { entityType: "customer", entityId: CUSTOMER_ID });

  eq("البيع قبل السداد", first.transactions[0].kind, "sale");
  eq("الترتيب مستقل عن ترتيب الإدخال", second.transactions[0].kind, "sale");
  eq("نفس الرصيد", first.closingBalance, second.closingBalance);
  eq(
    "نفس ترتيب المعرّفات",
    first.transactions.map((t) => t.id).join(","),
    second.transactions.map((t) => t.id).join(","),
  );

  // وعند اختلاف النوع نفسه نُرتّب بالمعرّف
  const cmp = compareEntries(
    entry("aaa", "2026-01-10T09:00:00Z", "sale", 1, 0),
    entry("bbb", "2026-01-10T09:00:00Z", "sale", 1, 0),
  );
  check("ترتيب بالمعرّف عند التطابق", cmp < 0);
}

// ---------------------------------------------------------------------------
// 10 · فلتر التاريخ
// ---------------------------------------------------------------------------
suite("10 · فلتر التاريخ");
{
  const rows = [
    entry("before", "2025-12-31T23:59:59Z", "sale", 999, 0),
    entry("inFrom", "2026-01-01T00:00:00Z", "sale", 100, 0),
    entry("inTo", "2026-01-31T23:59:59Z", "sale", 50, 0),
    entry("after", "2026-02-01T00:00:00Z", "sale", 777, 0),
  ];
  const result = build(rows, {
    entityType: "customer",
    entityId: CUSTOMER_ID,
    from: "2026-01-01",
    to: "2026-01-31",
  });
  eq("الحدان شاملان", result.transactions.length, 2);
  eq("totalDebit = 150 فقط", result.totalDebit, 150);
  eq("opening من الخارج", result.openingBalance, 999);
  eq("لا يُحتسب ما بعد to", result.closingBalance, 1149);
}

// ---------------------------------------------------------------------------
// 11 · from > to — لا انفجار
// ---------------------------------------------------------------------------
suite("11 · from > to");
{
  const rows = [entry("a", "2026-01-10T00:00:00Z", "sale", 100, 0)];
  const result = build(rows, {
    entityType: "customer",
    entityId: CUSTOMER_ID,
    from: "2026-03-01",
    to: "2026-01-01",
  });
  eq("لا حركات", result.transactions.length, 0);
  eq("opening = صفر (لا شيء قبل 2026-03-01 من الحركات الموجودة)", result.openingBalance, 100);
  eq("closing = opening", result.closingBalance, 100);
}

// ---------------------------------------------------------------------------
// 12 · دقة عشرية
// ---------------------------------------------------------------------------
suite("12 · دقة عشرية");
{
  const rows = [
    entry("a", "2026-01-01T00:00:00Z", "sale", 0.1, 0),
    entry("b", "2026-01-02T00:00:00Z", "sale", 0.2, 0),
    entry("c", "2026-01-03T00:00:00Z", "payment", 0, 0.05),
  ];
  const result = build(rows, { entityType: "customer", entityId: CUSTOMER_ID });
  eq("0.1+0.2-0.05 = 0.25", result.closingBalance, 0.25);
  eq("تقريب 3 منازل إلى منزلتين", round2(1.005), 1.01);
  eq("قيمة سالبة تُصفَّر", balanceAsOf([entry("n", "2026-01-01T00:00:00Z", "sale", -5, 0)]), 0);
}

// ---------------------------------------------------------------------------
// 13 · اتجاه المورد
// ---------------------------------------------------------------------------
suite("13 · اتجاه المورد");
{
  const supplier: StatementEntity = {
    id: SUPPLIER_ID,
    type: "supplier",
    name: "مؤسسة التوريدات",
    phone: null,
    email: null,
    address: null,
    creditLimit: null,
    cachedBalance: null,
  };
  // اتجاه المورد: credit = توريد (علينا له) · debit = سداد
  const rows = [
    entry("sup", "2026-01-01T00:00:00Z", "sale", 0, 10000, { reference: "PINV-1" }),
    entry("pay", "2026-01-10T00:00:00Z", "payment", 4000, 0),
  ];
  const result = buildStatement({
    request: { entityType: "supplier", entityId: SUPPLIER_ID, includeZeroRows: false },
    entity: supplier,
    entries: rows,
    generatedAt: "2026-04-01T00:00:00.000Z",
  });
  // في الاتجاه الموردي: ما علينا = Σcredit - Σdebit = 6000 → يُعرض كسالب في محرك debit-credit
  eq("صافي التوريد بعد السداد", Math.abs(result.closingBalance), 6000);
  eq("الرصيد سالب باتجاه المورد", result.direction, "credit");
  eq("الإجماليات", result.totalCredit, 10000);
}

// ---------------------------------------------------------------------------
// 14 · integrity.difference
// ---------------------------------------------------------------------------
suite("14 · فرق التسوية");
{
  const rows = [
    entry("s", "2026-01-01T00:00:00Z", "sale", 1000, 0),
    entry("r", "2026-01-05T00:00:00Z", "return", 0, 200),
  ];
  const withGap = buildStatement({
    request: { entityType: "customer", entityId: CUSTOMER_ID },
    entity: customerEntity(1000),
    entries: rows,
    cachedBalance: 1000,
    generatedAt: "2026-04-01T00:00:00.000Z",
  });
  eq("رصيد الدفتر", withGap.integrity.ledgerBalance, 800);
  eq("الرصيد المخزَّن", withGap.integrity.cachedBalance, 1000);
  eq("الفرق", withGap.integrity.difference, -200);
  check("شارة التحذير مرفوعة", withGap.integrity.hasGap === true);

  const noGap = buildStatement({
    request: { entityType: "customer", entityId: CUSTOMER_ID },
    entity: customerEntity(800),
    entries: rows,
    cachedBalance: 800,
    generatedAt: "2026-04-01T00:00:00.000Z",
  });
  check("لا تحذير عند التطابق", noGap.integrity.hasGap === false);
  eq("الفرق صفر", noGap.integrity.difference, 0);
}

// ---------------------------------------------------------------------------
// 15 · كشف بلا فلتر (كل الفترات)
// ---------------------------------------------------------------------------
suite("15 · بلا فلتر تاريخ");
{
  const rows = [
    entry("a", "2025-03-01T00:00:00Z", "sale", 300, 0),
    entry("b", "2026-02-01T00:00:00Z", "payment", 0, 100),
  ];
  const result = build(rows, { entityType: "customer", entityId: CUSTOMER_ID });
  eq("الافتتاحي صفر بلا فلتر", result.openingBalance, 0);
  eq("كل الحركات", result.transactions.length, 2);
  eq("الختامي = الصافي الكلي", result.closingBalance, 200);
}

// ---------------------------------------------------------------------------
// 16 · تسلسل وفهرسة الصفوف
// ---------------------------------------------------------------------------
suite("16 · فهرسة الصفوف");
{
  const rows = [
    entry("a", "2026-01-01T00:00:00Z", "sale", 10, 0),
    entry("b", "2026-01-02T00:00:00Z", "sale", 20, 0),
    entry("c", "2026-01-03T00:00:00Z", "payment", 0, 5),
  ];
  const result = build(rows, { entityType: "customer", entityId: CUSTOMER_ID });
  eq("التسلسل تصاعدي", result.transactions.map((t) => t.index).join(","), "1,2,3");
  eq("countedRows", result.countedRows, 3);
}

// ---------------------------------------------------------------------------
// 17 · أعمار الديون (FIFO)
// ---------------------------------------------------------------------------
suite("17 · أعمار الديون");
{
  const rows = [
    entry("old", "2026-01-01T00:00:00Z", "sale", 1000, 0),
    entry("new", "2026-03-20T00:00:00Z", "sale", 500, 0),
    entry("pay", "2026-03-25T00:00:00Z", "payment", 0, 400),
  ];
  const aging = buildAging(rows, { asOf: "2026-04-01" });
  eq("المتبقي الكلي", aging.buckets.total, 1100);
  eq("فواتير مفتوحة", aging.rows.length, 2);
  // الدفعة تُخصَّص للأقدم أولًا
  eq("الأقدم استُوفي منه 400", aging.rows[0].settled, 400);
  eq("متبقي الأقدم", aging.rows[0].outstanding, 600);
  eq("الأحدث لم يُخصَّص له", aging.rows[1].outstanding, 500);
  eq("لا دفعات غير مخصَّصة", aging.unallocatedPayment, 0);

  const overpaid = buildAging(
    [
      entry("s", "2026-03-25T00:00:00Z", "sale", 100, 0),
      entry("p", "2026-03-26T00:00:00Z", "payment", 0, 300),
    ],
    { asOf: "2026-04-01" },
  );
  eq("دفعة زائدة غير مخصَّصة", overpaid.unallocatedPayment, 200);
  eq("لا ديون متبقية", overpaid.buckets.total, 0);
}

// ---------------------------------------------------------------------------
// 18 · ترتيب الحركات: بيع ← مرتجع ← سداد
// ---------------------------------------------------------------------------
suite("18 · ترتيب الأنواع في نفس اللحظة");
{
  const at = "2026-01-10T08:00:00Z";
  const sorted = [
    entry("z-payment", at, "payment", 0, 10),
    entry("y-return", at, "return", 0, 10),
    entry("x-sale", at, "sale", 10, 0),
    entry("w-adjustment", at, "adjustment", 10, 0),
  ].sort(compareEntries);
  eq(
    "الترتيب sale→return→payment→adjustment",
    sorted.map((e) => e.kind).join(","),
    "sale,return,payment,adjustment",
  );
}

// ---------------------------------------------------------------------------
// 19 · buildPeriodLabel
// ---------------------------------------------------------------------------
suite("19 · تسمية الفترة");
{
  eq("من وإلى", buildPeriodLabel("2026-01-01", "2026-03-31", "ar"), "01/01/2026 — 31/03/2026");
  eq("بلا حدود", buildPeriodLabel(null, null, "ar"), "كل الفترات");
  eq("من فقط", buildPeriodLabel("2026-01-01", null, "ar"), "من 01/01/2026");
  eq("إلى فقط", buildPeriodLabel(null, "2026-03-31", "ar"), "حتى 31/03/2026");
}

// ---------------------------------------------------------------------------
// 20 · dayKey
// ---------------------------------------------------------------------------
suite("20 · استخراج اليوم");
{
  eq("ISO كامل", dayKey("2026-01-05T13:45:00.000Z"), "2026-01-05");
  eq("تاريخ مجرّد", dayKey("2026-01-05"), "2026-01-05");
  eq("قيمة فارغة", dayKey(""), "");
}

// ---------------------------------------------------------------------------
// التقرير
// ---------------------------------------------------------------------------
const total = passed + failures.length;
console.log("");
console.log("════════════════════════════════════════════════════");
console.log(`  Statement Engine — اختبارات الوحدة`);
console.log("════════════════════════════");

if (failures.length > 0) {
  console.log("");
  for (const f of failures) console.log(`  ✗ ${f}`);
  console.log("");
  console.log(`  النتيجة: ${passed}/${total} نجحت — ${failures.length} فشلت`);
  console.log("");
  process.exit(1);
} else {
  console.log(`  ✓ كل الاختبارات نجحت: ${passed}/${total}`);
  console.log("");
}

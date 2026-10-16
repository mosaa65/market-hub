/**
 * Vortex ERP — اختبارات القواعد الحسابية وعقود البيانات (Calculation Rules Tests)
 *
 * تغطي المهام:
 *   - REP-004: الحالات المرجعية لاحتساب المبيعات والخصومات وصافي القيمة
 *   - REP-005: الحالات المرجعية لحركة المخزون والرصيد المتسلسل بعد الحركات
 *   - REP-006: مواصفات معالجة التواريخ ونهاية اليوم والمنطقة الزمنية
 *
 * تشغيل الاختبار:
 *   npx tsx src/lib/reports/__tests__/calculation-rules.test.ts
 */

import {
  calculateNetSales,
  calculateGrossMargin,
  calculateMarginPercentage,
  calculateOutstanding,
  classifyCostBasis,
  calculateRunningInventoryMovements,
  resolveDateRangeBoundaries,
  isDateWithinRange,
  round2,
  round3,
  type RawStockMovement,
} from "../rules";

let passed = 0;
function check(name: string, condition: boolean) {
  if (!condition) {
    console.error(`  ✗ FAIL: ${name}`);
    throw new Error(`Test failed: ${name}`);
  }
  passed++;
  console.log(`  ✓ ${name}`);
}

console.log("\n════════════════════════════════════════════════════════");
console.log("  Vortex ERP — فحص القواعد الحسابية والذهبية (Phase 1)");
console.log("════════════════════════════════════════════════════════\n");

// ── 1. فحص قواعد المبيعات والخصومات وصافي القيمة (REP-004) ───────
console.log("▶ [REP-004] اختبارات حسابات المبيعات والخصومات والهوامش:");

// أ. فاتورة عادية بدون خصم ولا مرتجع
const net1 = calculateNetSales(1000, 0, 0);
check("فاتورة عادية: 1000 - 0 = 1000", net1 === 1000);

// ب. فاتورة بخصم تجاري
const net2 = calculateNetSales(1000, 150, 0);
check("فاتورة بخصم تجاري: 1000 - 150 = 850", net2 === 850);

// ج. فاتورة بخصم ومرتجع مبيعات جزئي
const net3 = calculateNetSales(1000, 100, 250);
check("فاتورة بخصم ومرتجع: 1000 - 100 - 250 = 650", net3 === 650);

// د. منع النتيجة السالبة إذا تجاوز المرتجع والخصم الإجمالي
const net4 = calculateNetSales(500, 100, 600);
check("منع صافي المبيعات السالب: لا تقل عن صفر", net4 === 0);

// هـ. احتساب هامش المساهمة ونسبة الهامش
const margin = calculateGrossMargin(850, 595);
check("هامش المساهمة: 850 - 595 = 255", margin === 255);

const marginPct = calculateMarginPercentage(850, 595);
check("نسبة هامش المساهمة: (255 / 850) * 100 = 30%", marginPct === 30);

// و. حساب المبلغ المتبقي الآجل للتحصيل
const outstanding1 = calculateOutstanding(1150, 750);
check("المتبقي للتحصيل: 1150 - 750 = 400", outstanding1 === 400);

const outstandingOverpaid = calculateOutstanding(1000, 1200);
check("المسدد بالزيادة: المتبقي صفر ولا يعود سالباً", outstandingOverpaid === 0);

// ز. تصنيف أساس التكلفة
check("طبقات تكلفة موجودة -> ACTUAL", classifyCostBasis(2, false) === "ACTUAL");
check("لا توجد طبقات ولكن تكلفة معيارية موجودة -> STANDARD", classifyCostBasis(0, true) === "STANDARD");
check("لا توجد طبقات ولا تكلفة معيارية -> REFERENCE_ONLY", classifyCostBasis(0, false) === "REFERENCE_ONLY");

// ── 2. فحص قواعد حركة المخزون والرصيد المتسلسل (REP-005) ────────
console.log("\n▶ [REP-005] اختبارات حركة المخزون والرصيد اللحظي التراكمي:");

const rawMovements: RawStockMovement[] = [
  { id: "m-3", createdAt: "2026-10-01T14:00:00Z", kind: "issue", quantity: 30 },
  { id: "m-1", createdAt: "2026-10-01T09:00:00Z", kind: "receipt", quantity: 50 },
  { id: "m-4", createdAt: "2026-10-02T10:00:00Z", kind: "return_in", quantity: 10 },
  { id: "m-2", createdAt: "2026-10-01T11:00:00Z", kind: "adjustment_in", quantity: 5 },
  { id: "m-5", createdAt: "2026-10-02T16:00:00Z", kind: "transfer_out", quantity: 15 },
];

// الرصيد الافتتاحي = 100
// 1) 09:00: وارد +50   -> الرصيد 150
// 2) 11:00: وارد +5    -> الرصيد 155
// 3) 14:00: صادر -30   -> الرصيد 125
// 4) 10:00: وارد +10   -> الرصيد 135
// 5) 16:00: صادر -15   -> الرصيد 120

const calculated = calculateRunningInventoryMovements(rawMovements, 100);

check("عدد السطور المحسوبة يطابق الحركات الأصلية", calculated.length === 5);
check("فرز حتمي: الحركة الأولى هي إدخال 09:00", calculated[0].id === "m-1");
check("الرصيد بعد الحركة 1: 100 + 50 = 150", calculated[0].runningBalance === 150);
check("الرصيد بعد الحركة 2: 150 + 5 = 155", calculated[1].runningBalance === 155);
check("الرصيد بعد الحركة 3: 155 - 30 = 125", calculated[2].runningBalance === 125);
check("الرصيد بعد الحركة 4: 125 + 10 = 135", calculated[3].runningBalance === 135);
check("الرصيد الختامي بعد الحركة 5: 135 - 15 = 120", calculated[4].runningBalance === 120);

// ح. فرز حتمي عند تطابق التاريخ تماماً بالاعتماد على id
const sameTimeMovements: RawStockMovement[] = [
  { id: "b-row", createdAt: "2026-10-01T10:00:00Z", kind: "issue", quantity: 5 },
  { id: "a-row", createdAt: "2026-10-01T10:00:00Z", kind: "receipt", quantity: 10 },
];
const sameTimeCalc = calculateRunningInventoryMovements(sameTimeMovements, 0);
check("الفرز الحتمي يعتمد المعرف عند تطابق الوقت", sameTimeCalc[0].id === "a-row");

// ── 3. فحص مواصفات التواريخ ونهاية اليوم (REP-006) ───────────────
console.log("\n▶ [REP-006] اختبارات شمولية التواريخ ونهاية اليوم الزمني:");

const boundaries = resolveDateRangeBoundaries("2026-10-01", "2026-10-31");
check("بداية اليوم تبدأ من الثانية الأولى", boundaries.startIso === "2026-10-01T00:00:00.000Z");
check("نهاية اليوم تمتد للثانية الأخيرة (23:59:59.999Z)", boundaries.endIso === "2026-10-31T23:59:59.999Z");

// اختبار وقوع الأحداث داخل اليوم الأخير
const lastSecondItem = "2026-10-31T23:59:59.000Z";
check("عملية في آخر ثانية من اليوم مشمولة بنجاح", isDateWithinRange(lastSecondItem, "2026-10-01", "2026-10-31"));

const nextDayFirstSecond = "2026-11-01T00:00:00.000Z";
check("عملية بعد منتصف الليل مستبعدة من فترة أكتوبر", !isDateWithinRange(nextDayFirstSecond, "2026-10-01", "2026-10-31"));

const startItem = "2026-10-01T00:00:00.000Z";
check("عملية في أول ثانية من اليوم مشمولة بنجاح", isDateWithinRange(startItem, "2026-10-01", "2026-10-31"));

// ── 4. فحص دقة التقريب المالي ومنع أخطاء الفاصلة العائمة ───────
console.log("\n▶ اختبارات منع الفاصلة العائمة:");
check("round2(0.1 + 0.2) = 0.30", round2(0.1 + 0.2) === 0.3);
check("round2(10.005) = 10.01", round2(10.005) === 10.01);
check("round3(1.0004) = 1.000", round3(1.0004) === 1);
check("round3(1.0006) = 1.001", round3(1.0006) === 1.001);

console.log("\n════════════════════════════════════════════════════════");
console.log(`  🎉 نجاح جميع الاختبارات: تم اجتياز ${passed} اختباراً بنجاح 100%!`);
console.log("════════════════════════════════════════════════════════\n");

/**
 * اختبارات وحدة شاملة لمنظومة الدفع المجزأ المتعدد وتوزيع المبالغ وقواعد التوازن.
 * تشغيل عبر:
 *   npx tsx src/lib/payments/__tests__/split-payment-suite.test.ts
 */
import assert from "node:assert/strict";
import type { SplitTenderLine } from "../treasury-types";

function calculateSplitTotals(total: number, lines: Array<Pick<SplitTenderLine, "amount">>) {
  const allocated = Math.round(lines.reduce((s, l) => s + (Number(l.amount) || 0), 0) * 100) / 100;
  const remaining = Math.round(Math.max(0, total - allocated) * 100) / 100;
  const isOverpaid = allocated > total;
  const isFullyBalanced = allocated === total && total > 0;
  return { allocated, remaining, isOverpaid, isFullyBalanced };
}

function validateSplitLines(lines: SplitTenderLine[]) {
  if (lines.length === 0) return { valid: false, reason: "empty" };
  for (const line of lines) {
    if (!Number.isFinite(line.amount) || line.amount <= 0) {
      return { valid: false, reason: "invalid_amount", lineId: line.id };
    }
    if (!line.method) {
      return { valid: false, reason: "missing_method", lineId: line.id };
    }
  }
  return { valid: true, reason: null };
}

// 1. الدفع المتوازن بالكامل (نقد 50,000 + بنك 30,000 + محفظة 20,000 = 100,000)
{
  const total = 100000;
  const lines: SplitTenderLine[] = [
    { id: "1", category: "CASH", method: "cash", amount: 50000 },
    { id: "2", category: "BANK", method: "bank_transfer", amount: 30000 },
    { id: "3", category: "WALLET", method: "mobile_money", amount: 20000 },
  ];
  const validation = validateSplitLines(lines);
  assert.equal(validation.valid, true, "Lines should be valid");

  const calc = calculateSplitTotals(total, lines);
  assert.equal(calc.allocated, 100000, "Allocated must equal 100,000");
  assert.equal(calc.remaining, 0, "Remaining must be 0 for full settlement");
  assert.equal(calc.isOverpaid, false, "Must not be overpaid");
  assert.equal(calc.isFullyBalanced, true, "Must be fully balanced");
}

// 2. دفع مجزأ جزئي مع بقاء رصيد ذمة (إجمالي 100,000، مدفوع 60,000، متبقي 40,000)
{
  const total = 100000;
  const lines: SplitTenderLine[] = [
    { id: "1", category: "CASH", method: "cash", amount: 40000 },
    { id: "2", category: "BANK", method: "bank_transfer", amount: 20000 },
  ];
  const calc = calculateSplitTotals(total, lines);
  assert.equal(calc.allocated, 60000, "Allocated must be 60,000");
  assert.equal(calc.remaining, 40000, "Remaining debt must be 40,000");
  assert.equal(calc.isOverpaid, false, "Must not be overpaid");
  assert.equal(calc.isFullyBalanced, false, "Must not be flagged as full settlement");
}

// 3. منع المبالغ الزائدة عن الإجمالي
{
  const total = 50000;
  const lines: SplitTenderLine[] = [
    { id: "1", category: "CASH", method: "cash", amount: 40000 },
    { id: "2", category: "BANK", method: "bank_transfer", amount: 20000 },
  ];
  const calc = calculateSplitTotals(total, lines);
  assert.equal(calc.allocated, 60000);
  assert.equal(calc.isOverpaid, true, "Must be flagged as overpaid");
}

// 4. منع المبالغ السالبة أو الصفرية
{
  const linesWithZero: SplitTenderLine[] = [
    { id: "1", category: "CASH", method: "cash", amount: 0 },
  ];
  const validationZero = validateSplitLines(linesWithZero);
  assert.equal(validationZero.valid, false, "Zero amount must be rejected");

  const linesWithNegative: SplitTenderLine[] = [
    { id: "1", category: "CASH", method: "cash", amount: -1500 },
  ];
  const validationNeg = validateSplitLines(linesWithNegative);
  assert.equal(validationNeg.valid, false, "Negative amount must be rejected");
}

// 5. التقريب الدقيق للكسور وتفادي أخطاء الفاصلة العائمة
{
  const total = 99.99;
  const lines: SplitTenderLine[] = [
    { id: "1", category: "CASH", method: "cash", amount: 33.33 },
    { id: "2", category: "BANK", method: "bank_transfer", amount: 33.33 },
    { id: "3", category: "WALLET", method: "mobile_money", amount: 33.33 },
  ];
  const calc = calculateSplitTotals(total, lines);
  assert.equal(calc.allocated, 99.99, "Floating sum must round to exact 99.99");
  assert.equal(calc.remaining, 0);
  assert.equal(calc.isFullyBalanced, true);
}

console.log("split-payment-suite: all assertions passed successfully!");

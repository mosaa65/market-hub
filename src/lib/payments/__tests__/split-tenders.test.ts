import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildSplitTenders,
  describeSplitTenders,
  hasRealTender,
  isSplitTender,
  looksLikeSplitPayment,
} from "../split-tenders";

describe("Split tender distribution", () => {
  it("يفصل الآجل عن التحصيل الفعلي", () => {
    const result = buildSplitTenders(
      { cash: 300, bank_transfer: 400, mobile_money: 0, credit: 300 },
      1000,
    );

    assert.equal(result.tenders.length, 2);
    assert.equal(result.paid, 700);
    assert.equal(result.credit, 300);
    assert.equal(result.allocated, 1000);
    assert.equal(result.remaining, 0);
    assert.equal(result.balanced, true);
    assert.equal(result.overpaid, false);
  });

  it("لا يرسل الآجل ضمن الأجزاء (لأن جدول التجزئة لا يقبل credit)", () => {
    const result = buildSplitTenders({ credit: 250 }, 250);
    assert.deepEqual(result.tenders, []);
    assert.equal(result.paid, 0);
    assert.equal(result.credit, 250);
    assert.equal(result.balanced, true);
  });

  it("يقرّب المبالغ إلى قرشين ويحذف الأصفار والسوالب", () => {
    const result = buildSplitTenders({ cash: 0.1 + 0.2, bank_transfer: -50, mobile_money: 0 }, 0.3);
    assert.deepEqual(result.tenders, [{ method: "cash", amount: 0.3 }]);
    assert.equal(result.balanced, true);
  });

  it("يكتشف التجاوز عندما يتجاوز التوزيع الإجمالي", () => {
    const result = buildSplitTenders({ cash: 400, mobile_money: 200 }, 500);
    assert.equal(result.overpaid, true);
    assert.equal(result.remaining, -100);
    assert.equal(result.balanced, false);
  });

  it("يكتشف النقص عندما لا يغطي التوزيع الإجمالي", () => {
    const result = buildSplitTenders({ cash: 200 }, 500);
    assert.equal(result.remaining, 300);
    assert.equal(result.balanced, false);
    assert.equal(result.overpaid, false);
  });

  it("يتعرّف على طرق التحصيل الحقيقية فقط", () => {
    assert.equal(isSplitTender("cash"), true);
    assert.equal(isSplitTender("bank_transfer"), true);
    assert.equal(isSplitTender("mobile_money"), true);
    assert.equal(isSplitTender("credit"), false);
    assert.equal(isSplitTender("split"), false);
    assert.equal(hasRealTender({ credit: 100 }), false);
    assert.equal(hasRealTender({ credit: 100, cash: 1 }), true);
  });

  it("يكتب ملخصاً نصياً يتعرّف عليه كشف الدفع المجزأ", () => {
    const result = buildSplitTenders({ cash: 100, credit: 50 }, 150);
    const note = describeSplitTenders(result, { cash: "نقدًا" }, "ar");
    assert.match(note, /نقدًا/);
    assert.match(note, /آجل/);
    assert.equal(looksLikeSplitPayment("split"), true);
    assert.equal(looksLikeSplitPayment("cash", note), true);
    assert.equal(looksLikeSplitPayment("cash", "ملاحظة عادية"), false);
  });
});

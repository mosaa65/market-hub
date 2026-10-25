import assert from "node:assert/strict";
import { describe, it } from "node:test";

interface SplitBreakdown {
  cash: number;
  credit: number;
  bank_transfer: number;
  mobile_money: number;
}

interface JournalLine {
  account_code: string;
  debit?: number;
  credit?: number;
  memo: string;
}

/**
 * محاكاة محرك إنشاء وتوزيع قيود الدفع المجزأ (مطابق تماماً لترحيل migration 62)
 */
function buildSplitJournalLines(params: {
  total: number;
  tax?: number;
  splits: SplitBreakdown;
  customerId: string;
  isCashCustomer?: boolean;
}): { lines: JournalLine[]; isBalanced: boolean; error?: string } {
  const { total, tax = 0, splits, isCashCustomer } = params;
  const cash = Math.max(0, splits.cash);
  const credit = Math.max(0, splits.credit);
  const bank = Math.max(0, splits.bank_transfer);
  const wallet = Math.max(0, splits.mobile_money);

  const allocated = Math.round((cash + credit + bank + wallet) * 100) / 100;
  if (Math.abs(allocated - total) > 0.005) {
    return {
      lines: [],
      isBalanced: false,
      error: `مجموع المبالغ (${allocated}) لا يطابق إجمالي الفاتورة (${total})`,
    };
  }

  if (credit > 0 && isCashCustomer) {
    return {
      lines: [],
      isBalanced: false,
      error: "لا يمكن تسجيل مبالغ آجلة على العميل النقدي",
    };
  }

  const lines: JournalLine[] = [];

  // الإيراد والضريبة (دائن)
  const revenue = Math.round((total - tax) * 100) / 100;
  lines.push({ account_code: "4111", credit: revenue, memo: "إيراد مبيعات" });
  if (tax > 0) {
    lines.push({ account_code: "2311", credit: tax, memo: "ضريبة مخرجات مستحقة" });
  }

  // أسطر التحصيل المتعدد (مدين)
  if (cash > 0) {
    lines.push({ account_code: "1101", debit: cash, memo: "تحصيل نقدي بالصندوق (دفع مجزأ)" });
  }
  if (bank > 0) {
    lines.push({ account_code: "1111", debit: bank, memo: "تحصيل عبر البنك (دفع مجزأ)" });
  }
  if (wallet > 0) {
    lines.push({ account_code: "1131", debit: wallet, memo: "تحصيل عبر المحفظة الإلكترونية (دفع مجزأ)" });
  }
  if (credit > 0) {
    lines.push({ account_code: "1211", debit: credit, memo: "ذمم عملاء (متبقي آجل)" });
  }

  const totalDebits = Math.round(lines.reduce((s, l) => s + (l.debit ?? 0), 0) * 100) / 100;
  const totalCredits = Math.round(lines.reduce((s, l) => s + (l.credit ?? 0), 0) * 100) / 100;

  return {
    lines,
    isBalanced: totalDebits === totalCredits && totalDebits === total,
  };
}

describe("Split Payments & Accounting Ledger Engine Tests", () => {
  it("يوازن القيود المحاسبية بالكامل عند الدفع نقداً + بنك + آجل", () => {
    const res = buildSplitJournalLines({
      total: 1000,
      tax: 150,
      splits: {
        cash: 300,
        bank_transfer: 400,
        mobile_money: 0,
        credit: 300,
      },
      customerId: "cust-real-uuid",
      isCashCustomer: false,
    });

    assert.equal(res.isBalanced, true);
    assert.equal(res.lines.length, 5); // revenue + tax + cash + bank + credit
    const debits = res.lines.filter((l) => l.debit).reduce((s, l) => s + (l.debit ?? 0), 0);
    const credits = res.lines.filter((l) => l.credit).reduce((s, l) => s + (l.credit ?? 0), 0);
    assert.equal(debits, 1000);
    assert.equal(credits, 1000);
  });

  it("يوازن القيود عند الدفع عبر المحفظة والبنك والنقد بالتساوي دون آجل", () => {
    const res = buildSplitJournalLines({
      total: 300,
      splits: {
        cash: 100,
        bank_transfer: 100,
        mobile_money: 100,
        credit: 0,
      },
      customerId: "cust-uuid",
      isCashCustomer: true, // مسموح للعميل النقدي لأن الآجل = 0
    });

    assert.equal(res.isBalanced, true);
    const accounts = res.lines.map((l) => l.account_code);
    assert.ok(accounts.includes("1101"), "يجب وجود حساب الصندوق 1101");
    assert.ok(accounts.includes("1111"), "يجب وجود حساب البنك 1111");
    assert.ok(accounts.includes("1131"), "يجب وجود حساب المحافظ 1131");
    assert.ok(!accounts.includes("1211"), "لا يجوز وجود سطر ذمم إذا كان الآجل صفراً");
  });

  it("يرفض تسجيل شق آجل على العميل النقدي", () => {
    const res = buildSplitJournalLines({
      total: 500,
      splits: {
        cash: 300,
        bank_transfer: 0,
        mobile_money: 0,
        credit: 200,
      },
      customerId: "cash-customer-uuid",
      isCashCustomer: true,
    });

    assert.equal(res.isBalanced, false);
    assert.match(res.error || "", /العميل النقدي/);
  });

  it("يرفض المجموع غير المتطابق مع إجمالي الفاتورة", () => {
    const res = buildSplitJournalLines({
      total: 500,
      splits: {
        cash: 200,
        bank_transfer: 200,
        mobile_money: 0,
        credit: 0,
      }, // المجموع 400 فقط، ناقص 100
      customerId: "cust-uuid",
    });

    assert.equal(res.isBalanced, false);
    assert.match(res.error || "", /لا يطابق/);
  });
});

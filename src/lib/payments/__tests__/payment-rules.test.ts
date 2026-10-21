/**
 * How to run:
 *   npx tsx src/lib/payments/__tests__/payment-rules.test.ts
 *
 * The payment rules used to be written three times: once in the POS, once in
 * the sales invoice form, once in the milling counter. This test pins the ONE
 * implementation (`resolvePayment`) so the three screens cannot drift apart
 * again — the delivery audit's P1-4 finding.
 *
 * No DOM, no React: the rules are plain arithmetic, so they are testable here
 * and identical to what the panel renders.
 */
import assert from "node:assert/strict";
import { resolvePayment, type PaymentCustomer } from "../payment-rules";

const cashCustomer: PaymentCustomer = {
  id: "cash",
  name: "عميل نقدي",
  balance: 0,
  credit_limit: 0,
  is_system: true,
};
const realCustomer: PaymentCustomer = {
  id: "c1",
  name: "أحمد",
  balance: 400,
  credit_limit: 1000,
};
const customers = [cashCustomer, realCustomer];

function resolve(input: {
  total: number;
  method: string;
  paid: string;
  customerId?: string | null;
}) {
  return resolvePayment({
    total: input.total,
    method: input.method,
    paidRaw: input.paid,
    customerId: input.customerId ?? null,
    customers,
  });
}

/* ── 1. Empty paid field means "settled in full" for anything but credit ── */
{
  const r = resolve({ total: 1000, method: "cash", paid: "" });
  assert.equal(r.paid, 1000);
  assert.equal(r.remaining, 0);
  assert.equal(r.payable, true);
}

/* ── 2. A credit term collects nothing, whatever was typed ── */
{
  const r = resolve({ total: 1000, method: "credit", paid: "1000" });
  assert.equal(r.paid, 0);
  assert.equal(r.remaining, 1000);
  assert.equal(r.isCredit, true);
}

/* ── 3. Debt needs a customer that can carry it ── */
{
  const r = resolve({ total: 1000, method: "cash", paid: "400", customerId: null });
  assert.equal(r.remaining, 600);
  assert.equal(r.debtWithoutCustomer, true);
  assert.equal(r.payable, false);
  assert.ok(r.blockingReason);
}

/* ── 4. The system cash customer must never owe (P1-6) ── */
{
  const r = resolve({ total: 1000, method: "cash", paid: "400", customerId: "cash" });
  assert.equal(r.debtOnSystemCustomer, true);
  assert.equal(r.payable, false);
  assert.equal(r.booksAsDebt, false);
}

/* ── 5. The same sale is ALLOWED on a real customer ── */
{
  const r = resolve({ total: 1000, method: "cash", paid: "400", customerId: "c1" });
  assert.equal(r.remaining, 600);
  assert.equal(r.booksAsDebt, true);
  assert.equal(r.payable, true); // 400 + 600 = 1000 <= limit 1000
  assert.equal(r.projectedBalance, 1000);
}

/* ── 6. Credit limit is checked on the PROJECTED balance ── */
{
  const r = resolve({ total: 1000, method: "credit", paid: "", customerId: "c1" });
  assert.equal(r.exceedsCreditLimit, true);
  assert.equal(r.payable, false);
  assert.equal(r.projectedBalance, 1400);
}

/* ── 7. Cash tender above the total is CHANGE, not an error ── */
{
  const r = resolve({ total: 1000, method: "cash", paid: "1500" });
  assert.equal(r.paid, 1000);
  assert.equal(r.change, 500);
  assert.equal(r.isOverpaid, false);
  assert.equal(r.remaining, 0);
  assert.equal(r.payable, true);
}

/* ── 8. Overpayment on a NON-cash method is an error ── */
{
  const r = resolve({ total: 1000, method: "card", paid: "1500" });
  assert.equal(r.isOverpaid, true);
  assert.equal(r.change, 0);
  assert.equal(r.payable, false);
}

/* ── 9. Negative or garbage input never becomes a negative payment ── */
{
  assert.equal(resolve({ total: 500, method: "cash", paid: "-200" }).paid, 0);
  assert.equal(resolve({ total: 500, method: "cash", paid: "abc" }).paid, 0);
}

/* ── 10. Transfer / wallet methods ask for a reference ── */
{
  assert.equal(resolve({ total: 100, method: "bank_transfer", paid: "" }).needsReference, true);
  assert.equal(resolve({ total: 100, method: "jawali", paid: "" }).needsReference, true);
  assert.equal(resolve({ total: 100, method: "cash", paid: "" }).needsReference, false);
}

/* ── 11. A zero total has nothing to block ── */
{
  const r = resolve({ total: 0, method: "cash", paid: "" });
  assert.equal(r.paid, 0);
  assert.equal(r.remaining, 0);
  assert.equal(r.payable, true);
}

/* ── 12. Rounding matches the ledger: two decimals, half-up on 2dp ── */
{
  const r = resolve({ total: 0.1 + 0.2, method: "cash", paid: "" });
  assert.equal(r.total, 0.3);
  assert.equal(r.paid, 0.3);
  assert.equal(r.remaining, 0);
}

/* ── 13. Snapshot-ish: the shared rule rejects nothing it should accept ── */
{
  for (const method of ["cash", "card", "bank_transfer", "kuraimi_bank", "jawali"]) {
    const r = resolve({ total: 250, method, paid: "250" });
    assert.equal(r.payable, true, `${method} fully paid must be payable`);
  }
}

console.log("payment-rules: all assertions passed");

// قبول: دفتر الأستاذ — توازن القيد، القيد المزدوج، العكس لا الحذف
import { connect } from "./db-run.mjs";

const c = await connect();
await c.connect();
let pass = 0,
  fail = 0;
const ok = (l, v, want) => {
  const good = String(v) === String(want);
  good ? pass++ : fail++;
  console.log(`${good ? "PASS" : "FAIL"}  ${l}  →  ${v}${good ? "" : `   (expected ${want})`}`);
};
const q = (s, p = []) => c.query(s, p);
const expectFail = async (label, fn, pattern) => {
  await q("savepoint sp");
  try {
    await fn();
    await q("release savepoint sp");
    console.log(`FAIL  ${label}  →  allowed`); fail++;
  } catch (e) {
    await q("rollback to savepoint sp");
    await q("release savepoint sp");
    ok(label, pattern.test(e.message), true);
  }
};

const owner = (
  await q(`select pr.id from profiles pr join user_roles r on r.user_id=pr.id where r.role='owner' limit 1`)
).rows[0].id;
const cashier = (
  await q(`select pr.id from profiles pr join user_roles r on r.user_id=pr.id where r.role='cashier' limit 1`)
).rows[0]?.id;

await q("begin");
await q(`set local role authenticated`);
await q(`set local "request.jwt.claims" = '{"role":"authenticated","sub":"${owner}"}'`);

// ── 1. الدليل موجود وشامل ──
const types = (await q(`select account_type::text t, count(*)::int n from accounts group by 1`)).rows;
ok("the chart has all five account types", types.length, 5);
ok("a Yemeni bank account is present",
  (await q(`select count(*)::int n from accounts where code='1112' and name_ar like '%مناحي%'`)).rows[0].n, 1);
ok("by-product inventory has its own account",
  (await q(`select count(*)::int n from accounts where code='1314' and name_ar like '%نخالة%'`)).rows[0].n, 1);

// ── 2. قيد متوازن يُرحَّل ──
const entry = (await q(`
  select public.create_journal_entry(
    'شراء قمح — اختبار القيد المزدوج'::text, current_date,
    'acceptance'::text, null, true,
    '[{"account_code":"1311","debit":12000},
      {"account_code":"2111","credit":12000}]'::jsonb)`)).rows[0].create_journal_entry;
ok("a balanced entry is accepted", typeof entry, "string");

const e = (await q(`select status, total_debit, total_credit from journal_entries where id=$1`, [entry])).rows[0];
ok("it posts immediately", e.status, "POSTED");
ok("debits recorded", e.total_debit, "12000.00");
ok("credits recorded", e.total_credit, "12000.00");
ok("exactly two lines", (await q(`select count(*)::int n from journal_lines where entry_id=$1`, [entry])).rows[0].n, 2);

// ── 3. ميزان المراجعة ──
const tb = (await q(`select total_debit, total_credit from trial_balance`)).rows;
const sumD = tb.reduce((s, r) => s + Number(r.total_debit), 0);
const sumC = tb.reduce((s, r) => s + Number(r.total_credit), 0);
ok("the trial balance itself balances", Math.round(sumD * 100) === Math.round(sumC * 100), true);
ok("and shows the 12000", Math.round(sumD), 12000);

// ── 4. قيد غير متوازن مرفوض ──
await expectFail("an unbalanced entry is refused at creation",
  () => q(`select public.create_journal_entry('قيد غير متوازن'::text, current_date,
             null, null, false,
             '[{"account_code":"1311","debit":100},{"account_code":"2111","credit":90}]'::jsonb)`),
  /does not balance/);

// ── 5. سطر بلا جهة مرفوض ──
// Both lines sum to 100, so the balance check passes; what must catch this is
// the line itself carrying neither side.
await expectFail("a line that is neither debit nor credit is refused",
  () => q(`select public.create_journal_entry('سطر بلا جهة'::text, current_date, null, null, false,
             '[{"account_code":"1311"},{"account_code":"2111","credit":100}]'::jsonb)`),
  /neither a debit nor a credit/);

// ── 6. حساب غير موجود مرفوض — لا تسريب في التوازن ──
await expectFail("an unknown account code is refused rather than silently dropped",
  () => q(`select public.create_journal_entry('رمز حساب خطأ'::text, current_date, null, null, false,
             '[{"account_code":"9999","debit":100},{"account_code":"2111","credit":100}]'::jsonb)`),
  /do not exist/);

// ── 7. قيد بجهة واحدة مرفوض ──
await expectFail("a one-sided entry is refused",
  () => q(`select public.create_journal_entry('سطر واحد'::text, current_date, null, null, false,
             '[{"account_code":"1311","debit":100}]'::jsonb)`),
  /at least two lines/);

// ── 8. قابلية الترحيل: مجمع الإهلاك يُرحَّل إليه مباشرة ──
await expectFail("a non-postable account is refused",
  () => q(`select public.create_journal_entry('ترحيل على حساب تحقيري'::text, current_date, null, null, false,
             '[{"account_code":"1491","debit":100},{"account_code":"5611","credit":100}]'::jsonb)`),
  /not postable/);

// ── 8b. القيد المرحَّل وحده يظهر في ميزان المراجعة ──
// The draft is injected as the table owner on purpose: as `authenticated`
// there is no INSERT policy on journal_entries, and that refusal is itself
// the behaviour under test in section 10.
await q("savepoint sp8");
await q("set local role postgres");
const tbBefore = (await q(`select coalesce(sum(total_debit),0) t from trial_balance`)).rows[0].t;
await q(`insert into journal_entries (entry_number, entry_date, memo, status, total_debit, total_credit)
         values ('DRAFT-TEST', current_date, 'مسودة يجب ألا تظهر', 'DRAFT', 500, 500)`);
const draftId = (await q(`select id from journal_entries where entry_number='DRAFT-TEST'`)).rows[0].id;
await q(`insert into journal_lines (entry_id, account_id, debit, credit)
         select $1, id, 500, 0 from accounts where code='1311'`, [draftId]);
const tbAfter = (await q(`select coalesce(sum(total_debit),0) t from trial_balance`)).rows[0].t;
ok("a DRAFT entry never reaches the trial balance", Number(tbAfter), Number(tbBefore));
await q("rollback to savepoint sp8");
await q(`set local role authenticated`);
await q(`set local "request.jwt.claims" = '{"role":"authenticated","sub":"${owner}"}'`);

// ── 9. العكس ──
const rev = (await q(`select public.reverse_journal_entry($1::uuid,'تصحيح'::text)`, [entry]))
  .rows[0].reverse_journal_entry;
ok("reversal created", typeof rev, "string");
ok("the original is marked REVERSED",
  (await q(`select status from journal_entries where id=$1`, [entry])).rows[0].status, "REVERSED");
const revLines = (await q(`select debit, credit from journal_lines where entry_id=$1 order by id`, [rev])).rows;
// the sides must be swapped, not negated
ok("the reversal swaps the sides",
  revLines.map((l) => `${Number(l.debit)}/${Number(l.credit)}`).sort().join(","), "0/12000,12000/0");

// Gross debits do NOT net to zero - a balanced pair sums to twice its amount.
// What must net to zero is each ACCOUNT's balance: the original moved
// inventory up and payables down, and the reversal must undo exactly that.
const bal = (await q(`select code, balance from trial_balance order by code`)).rows;
ok("every account nets to zero after the reversal",
  bal.map((b) => `${b.code}:${Number(b.balance)}`).join(" "), "1311:0 2111:0");

await expectFail("reversal requires a reason",
  () => q(`select public.reverse_journal_entry($1::uuid,''::text)`, [rev]), /requires a reason/);
await expectFail("a reversed entry cannot be reversed again",
  () => q(`select public.reverse_journal_entry($1::uuid,'مرة أخرى'::text)`, [entry]), /Only a posted entry/);

// ── 10. لا حذف ولا تعديل ──
await q("savepoint sp2");
try {
  await q(`delete from journal_entries where id=$1`, [rev]);
  await q("release savepoint sp2");
  const gone = (await q(`select count(*)::int n from journal_entries where id=$1`, [rev])).rows[0].n;
  ok("an entry cannot be deleted (RLS blocks the write)", gone, 1);
} catch (e) {
  await q("rollback to savepoint sp2");
  ok("an entry cannot be deleted", true, true);
}

// ── 11. صلاحيات: الكاشير لا يُنشئ قيوداً ──
if (cashier) {
  await q("savepoint sp3");
  await q(`set local role authenticated`);
  await q(`set local "request.jwt.claims" = '{"role":"authenticated","sub":"${cashier}"}'`);
  try {
    await q(`select public.create_journal_entry('محاولة كاشير'::text, current_date, null, null, false,
               '[{"account_code":"1311","debit":50},{"account_code":"2111","credit":50}]'::jsonb)`);
    console.log("FAIL  a cashier created a journal entry"); fail++;
  } catch (e) {
    await q("rollback to savepoint sp3");
    console.log("PASS  cashier cannot create a journal entry  →  blocked");
    pass++;
  }
} else { console.log("      (no cashier user to test the role limit)"); }

// ── 12. anon ──
await q("savepoint sp4");
await q("set local role anon");
await q(`set local "request.jwt.claims" = '{"role":"anon"}'`);
for (const s of ["select count(*) from journal_entries", "select count(*) from journal_lines", "select count(*) from accounts"]) {
  try { await q(s); console.log(`FAIL  anon reached ${s.split("from ")[1]}`); fail++; }
  catch (e) { console.log(`PASS  anon denied: ${s.split("from ")[1]}`); pass++; }
}
await q("rollback to savepoint sp4");

await q("rollback");
console.log(`\n${fail === 0 ? "ALL PASS" : "FAILURES"} — ${pass} passed, ${fail} failed`);
await c.end();
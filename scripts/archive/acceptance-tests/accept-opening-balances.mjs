// قبول: الأرصدة الافتتاحية الشاملة — توازن القيد، الترحيل، والعكس
import { connect } from "./db-run.mjs";

const c = await connect();
await c.connect();
let pass = 0,
  fail = 0;
const ok = (l, v, want) => {
  const good = String(v) === String(want);
  good ? pass++ : fail++;
  console.log(
    `${good ? "PASS" : "FAIL"}  ${l}  →  ${v}${good ? "" : `   (expected ${want})`}`,
  );
};
const q = (s, p = []) => c.query(s, p);
const expectFail = async (label, fn, pattern) => {
  await q("savepoint sp");
  try {
    await fn();
    await q("release savepoint sp");
    console.log(`FAIL  ${label}  →  the call was allowed`); fail++;
  } catch (e) {
    await q("rollback to savepoint sp");
    await q("release savepoint sp");
    ok(label, pattern.test(e.message), true);
  }
};

const owner = (
  await q(`select pr.id from profiles pr join user_roles r on r.user_id=pr.id where r.role='owner' limit 1`)
).rows[0].id;
const cust = (await q(`select id from customers where is_active limit 1`)).rows[0]?.id;
const supplier = (await q(`select id from suppliers where is_active limit 1`)).rows[0]?.id;
const cashier = (await q(`select user_id from user_roles where role='cashier' limit 1`)).rows[0]?.user_id;
const bankAccountCode = (await q(`select code from accounts where is_active and is_postable and code like '11%' order by code limit 1`)).rows[0]?.code;
if (!bankAccountCode) throw new Error("Acceptance setup requires a postable bank/cash account");

await q("begin");
await q(`set local role authenticated`);
await q(`set local "request.jwt.claims" = '{"role":"authenticated","sub":"${owner}"}'`);

const wheat = (
  await q(`
  insert into products (sku,name,name_ar,item_nature,item_class,inventory_policy,tracking,
                       costing_method,cost_price,unit_id)
  select 'PROBE-OB','probe ob','قمح افتتاحي','GOOD','RAW_MATERIAL','TRACKED','NONE',
         'MOVING_AVERAGE',10,unit_id from products limit 1 returning id`)
).rows[0].id;
const wh = (await q(`select id from warehouses where is_active order by is_default desc limit 1`)).rows[0].id;

// مدين: مخزون 10000 · ذمم عميل 5000 · نقدية 2000 · بنك 1000 = 18000
// دائن: التزامات 7000 + رأس مال 11000 = 18000
const makeLines = (capital) => JSON.stringify([
  { section: "STOCK", product_id: wheat, warehouse_id: wh, quantity: 1000,
    unit_cost: 10, amount: 10000, description: "قمح افتتاحي" },
  ...(cust ? [{ section: "RECEIVABLE", customer_id: cust, amount: 5000, description: "ذمم عميل افتتاحية" }] : []),
  { section: "CASH", amount: 2000, description: "نقدية الصندوق" },
  { section: "BANK", amount: 1000, ledger_account_code: bankAccountCode, description: "رصيد بنك" },
  { section: "LIABILITY", amount: 7000, description: "التزامات مستحقة" },
  ...(supplier ? [{ section: "PAYABLE", supplier_id: supplier, amount: 3000, description: "ذمم مورد افتتاحية" }] : []),
  { section: "CAPITAL", amount: capital, description: "رأس المال" },
]);
const DEBITS = 10000 + (cust ? 5000 : 0) + 2000 + 1000;   // 18000
const CAPITAL = DEBITS - 7000 - (supplier ? 3000 : 0);
const supplierBalanceBefore = supplier
  ? Number((await q(`select balance from suppliers where id=$1`, [supplier])).rows[0].balance ?? 0)
  : null;

// ── 1. قيد متوازن يُرحَّل ──
const doc = (
  await q(
    `select public.create_opening_balance('2026-01-01'::date, $1::jsonb, 'اختبار افتتاحي')`,
    [makeLines(CAPITAL)],
  )
).rows[0].create_opening_balance;
ok("draft created", typeof doc, "string");
ok("starts as DRAFT", (await q(`select status from opening_balance_documents where id=$1`, [doc])).rows[0].status, "DRAFT");
ok("selected bank account is saved on the opening line",
  (await q(`select ledger_account_code from opening_balance_lines where document_id=$1 and section='BANK'`, [doc])).rows[0].ledger_account_code,
  bankAccountCode);
await q(`select public.update_opening_balance($1::uuid,'2026-01-01'::date,$2::jsonb,'مسودة معدلة')`, [doc, makeLines(CAPITAL)]);
ok("draft notes update through the draft-only RPC",
  (await q(`select notes from opening_balance_documents where id=$1`, [doc])).rows[0].notes,
  "مسودة معدلة");
ok("editing draft preserves selected ledger account",
  (await q(`select ledger_account_code from opening_balance_lines where document_id=$1 and section='BANK'`, [doc])).rows[0].ledger_account_code,
  bankAccountCode);

// side مشتق: لا يُقبل أن يختار المستخدم جهة السطر
const sides = (await q(
  `select section, side from opening_balance_lines where document_id=$1 order by section`, [doc])).rows;
ok("STOCK is a debit", sides.find((s) => s.section === "STOCK").side, "DEBIT");
ok("CAPITAL is a credit", sides.find((s) => s.section === "CAPITAL").side, "CREDIT");

// ── 2. القيد غير المتوازن يُرفض ──
const bad = (
  await q(`select public.create_opening_balance('2026-01-01'::date, $1::jsonb, 'غير متوازن')`,
    [makeLines(CAPITAL + 500)])
).rows[0].create_opening_balance;
await expectFail("an unbalanced opening entry cannot be posted",
  () => q(`select public.post_opening_balance($1::uuid)`, [bad]), /does not balance/);
await expectFail("the rejection message is readable, not garbled",
  () => q(`select public.post_opening_balance($1::uuid)`, [bad]),
  new RegExp(`^Opening entry does not balance: debits ${DEBITS.toFixed(2)} vs credits ${(DEBITS + 500).toFixed(2)}`));

// ── 3. ملخص يوضح عدم التوازن قبل الترحيل ──
const summary = (await q(`select is_balanced, capital_required_now from opening_balance_summary where id=$1`, [bad])).rows[0];
ok("summary shows it is not balanced", summary.is_balanced, false);
// رأس مال أكبر بـ 500 من المطلوب: الفرق سالب، ومعناه أن رأس المال زائد
ok("summary shows the capital is 500 too much", summary.capital_required_now, "-500.00");

// ── 4. الترحيل الفعلي ──
await q(`select public.post_opening_balance($1::uuid)`, [doc]);
ok("document is POSTED", (await q(`select status from opening_balance_documents where id=$1`, [doc])).rows[0].status, "POSTED");
ok("opening stock is real stock, not a purchase",
  (await q(`select quantity from inventory where product_id=$1 and warehouse_id=$2
             and owner_type='COMPANY' and owner_id is null`, [wheat, wh])).rows[0].quantity, "1000.000");
ok("opening stock carries its cost", (await q(`select public.resolve_unit_cost($1::uuid,$2::uuid) v`, [wheat, wh])).rows[0].v, "10.0000");
ok("the movement is an OPENING, not a purchase",
  (await q(`select movement_kind::text k from stock_movements
             where product_id=$1 and source_type='opening_balance' limit 1`, [wheat])).rows[0].k, "OPENING");
if (cust) {
  ok("receivable reached the customer ledger",
    (await q(`select debit from customer_ledger where customer_id=$1 and entry_type='adjustment'
               and reference_type='opening_balance'`, [cust])).rows.length > 0, true);
}
if (supplier) {
  ok("opening payable is written to supplier ledger",
    (await q(`select count(*) from supplier_ledger where supplier_id=$1 and reference_type='opening_balance' and reference_id=$2`, [supplier, doc])).rows[0].count,
    "1");
  ok("opening payable updates supplier balance",
    Number((await q(`select balance from suppliers where id=$1`, [supplier])).rows[0].balance),
    supplierBalanceBefore + 3000);
}
const openingJournal = (await q(`select id from journal_entries where source_type='opening_balance' and source_id=$1`, [doc])).rows[0]?.id;
ok("opening entry creates a journal entry", typeof openingJournal, "string");

// ── 5. لا ترحيل مرتين ──
await expectFail("cannot post the same document twice",
  () => q(`select public.post_opening_balance($1::uuid)`, [doc]), /already POSTED/);

// ── 6. سطر مخزون بلا صنف مرفوض ──
await expectFail("a stock line without an item is refused",
  () => q(`select public.create_opening_balance('2026-01-01'::date,
            '[{"section":"STOCK","quantity":5,"amount":50}]'::jsonb, 'bad')`),
  /violates check constraint|opening_balance_lines_stock_shape/);

// ── 7. سطر بمبلغ صفر مرفوض ──
await expectFail("a zero-amount line is refused",
  () => q(`select public.create_opening_balance('2026-01-01'::date,
            '[{"section":"CASH","amount":0}]'::jsonb, 'bad')`),
  /must be greater than zero/);

// ── 8. قسم غير معروف مرفوض ──
await expectFail("an unknown section is refused",
  () => q(`select public.create_opening_balance('2026-01-01'::date,
            '[{"section":"MYSTERY","amount":10}]'::jsonb, 'bad')`),
  /Unknown opening section/);

// ── 9. العكس ──
const rev = (await q(`select public.reverse_opening_balance($1::uuid,$2::text)`, [doc, "خطأ في الرصيد الافتتاحي"]))
  .rows[0].reverse_opening_balance;
ok("reversal created", typeof rev, "string");
ok("original is marked REVERSED", (await q(`select status from opening_balance_documents where id=$1`, [doc])).rows[0].status, "REVERSED");
ok("stock returned to zero",
  String(Number((await q(`select coalesce(quantity,0) q from inventory where product_id=$1 and warehouse_id=$2
             and owner_type='COMPANY' and owner_id is null`, [wheat, wh])).rows[0].q)), "0");
ok("the reversal balances by construction",
  (await q(`select is_balanced from opening_balance_summary where id=$1`, [rev])).rows[0].is_balanced, true);
ok("reversal marks the original journal reversed",
  (await q(`select status from journal_entries where id=$1`, [openingJournal])).rows[0].status,
  "REVERSED");
if (supplier) {
  ok("reversal writes supplier-ledger debit",
    (await q(`select count(*) from supplier_ledger where supplier_id=$1 and reference_type='opening_balance_reversal' and reference_id=$2 and debit=3000`, [supplier, rev])).rows[0].count,
    "1");
  ok("reversal restores supplier balance",
    Number((await q(`select balance from suppliers where id=$1`, [supplier])).rows[0].balance),
    supplierBalanceBefore);
}
await expectFail("reversal requires a reason",
  () => q(`select public.reverse_opening_balance($1::uuid,''::text)`, [rev]), /requires a reason/);

if (cashier) {
  await q(`set local "request.jwt.claims" = '{"role":"authenticated","sub":"${cashier}"}'`);
  await expectFail("cashier cannot post an opening balance",
    () => q(`select public.post_opening_balance($1::uuid)`, [bad]), /Only an owner, manager or accountant/);
  await expectFail("cashier cannot edit an opening draft",
    () => q(`select public.update_opening_balance($1::uuid,'2026-01-01'::date,$2::jsonb,null)`, [bad, makeLines(CAPITAL + 500)]),
    /Only an owner, manager or accountant/);
  await expectFail("cashier cannot reverse an opening balance",
    () => q(`select public.reverse_opening_balance($1::uuid,'not allowed')`, [doc]), /Only an owner, manager or accountant/);
  await expectFail("cashier cannot call the privileged journal wrapper",
    () => q(`select public.create_journal_entry('unauthorized', current_date, null, null, true, '[]'::jsonb)`),
    /permission denied/);
  ok("cashier cannot read the chart of accounts",
    (await q(`select count(*) from accounts`)).rows[0].count,
    "0");
  ok("cashier cannot read customer ledger",
    (await q(`select count(*) from customer_ledger`)).rows[0].count,
    "0");
  ok("cashier cannot read supplier ledger rows",
    (await q(`select count(*) from supplier_ledger`)).rows[0].count,
    "0");
  ok("cashier cannot read supplier payment vouchers",
    (await q(`select count(*) from supplier_payments`)).rows[0].count,
    "0");
  if (supplier) {
    await expectFail("cashier cannot call supplier statement RPC",
      () => q(`select count(*) from public.get_supplier_statement($1::uuid)`, [supplier]),
      /Only finance roles may read supplier statements/);
  }
  await q(`set local "request.jwt.claims" = '{"role":"authenticated","sub":"${owner}"}'`);
}

// ── 10. RLS ──
await expectFail("production-grade RLS: anon cannot read opening balances", async () => {
  await q(`set local role anon`);
  await q(`set local "request.jwt.claims" = '{"role":"anon"}'`);
  await q(`select count(*) from opening_balance_documents`);
}, /.+/);

await q("rollback");
console.log(`\n${fail === 0 ? "ALL PASS" : "FAILURES"} — ${pass} passed, ${fail} failed`);
await c.end();
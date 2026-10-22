// قبول: الأرصدة الافتتاحية الشاملة — توازن القيد، الترحيل، والعكس
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
    console.log(`FAIL  ${label}  →  the call was allowed`);
    fail++;
  } catch (e) {
    await q("rollback to savepoint sp");
    await q("release savepoint sp");
    ok(label, pattern.test(e.message), true);
  }
};

const owner = (
  await q(
    `select pr.id from profiles pr join user_roles r on r.user_id=pr.id where r.role='owner' limit 1`,
  )
).rows[0].id;
const cust = (await q(`select id from customers where is_active limit 1`)).rows[0]?.id;

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
const wh = (await q(`select id from warehouses where is_active order by is_default desc limit 1`))
  .rows[0].id;

// مدين: مخزون 10000 · ذمم عميل 5000 · نقدية 2000 · بنك 1000 = 18000
// دائن: التزامات 7000 + رأس مال 11000 = 18000
const makeLines = (capital) =>
  JSON.stringify([
    {
      section: "STOCK",
      product_id: wheat,
      warehouse_id: wh,
      quantity: 1000,
      unit_cost: 10,
      amount: 10000,
      description: "قمح افتتاحي",
    },
    ...(cust
      ? [
          {
            section: "RECEIVABLE",
            customer_id: cust,
            amount: 5000,
            description: "ذمم عميل افتتاحية",
          },
        ]
      : []),
    { section: "CASH", amount: 2000, description: "نقدية الصندوق" },
    { section: "BANK", amount: 1000, description: "رصيد بنك" },
    { section: "LIABILITY", amount: 7000, description: "التزامات مستحقة" },
    { section: "CAPITAL", amount: capital, description: "رأس المال" },
  ]);
const DEBITS = 10000 + (cust ? 5000 : 0) + 2000 + 1000; // 18000
const CAPITAL = DEBITS - 7000;

// ── 1. قيد متوازن يُرحَّل ──
const doc = (
  await q(`select public.create_opening_balance('2026-01-01'::date, $1::jsonb, 'اختبار افتتاحي')`, [
    makeLines(CAPITAL),
  ])
).rows[0].create_opening_balance;
ok("draft created", typeof doc, "string");
ok(
  "starts as DRAFT",
  (await q(`select status from opening_balance_documents where id=$1`, [doc])).rows[0].status,
  "DRAFT",
);

// side مشتق: لا يُقبل أن يختار المستخدم جهة السطر
const sides = (
  await q(`select section, side from opening_balance_lines where document_id=$1 order by section`, [
    doc,
  ])
).rows;
ok("STOCK is a debit", sides.find((s) => s.section === "STOCK").side, "DEBIT");
ok("CAPITAL is a credit", sides.find((s) => s.section === "CAPITAL").side, "CREDIT");

// ── 2. القيد غير المتوازن يُرفض ──
const bad = (
  await q(`select public.create_opening_balance('2026-01-01'::date, $1::jsonb, 'غير متوازن')`, [
    makeLines(CAPITAL + 500),
  ])
).rows[0].create_opening_balance;
await expectFail(
  "an unbalanced opening entry cannot be posted",
  () => q(`select public.post_opening_balance($1::uuid)`, [bad]),
  /does not balance/,
);
await expectFail(
  "the rejection message is readable, not garbled",
  () => q(`select public.post_opening_balance($1::uuid)`, [bad]),
  /^Opening entry does not balance: debits 18000\.00 vs credits 18500\.00/,
);

// ── 3. ملخص يوضح عدم التوازن قبل الترحيل ──
const summary = (
  await q(`select is_balanced, capital_required_now from opening_balance_summary where id=$1`, [
    bad,
  ])
).rows[0];
ok("summary shows it is not balanced", summary.is_balanced, false);
// رأس مال أكبر بـ 500 من المطلوب: الفرق سالب، ومعناه أن رأس المال زائد
ok("summary shows the capital is 500 too much", summary.capital_required_now, "-500.00");

// ── 4. الترحيل الفعلي ──
await q(`select public.post_opening_balance($1::uuid)`, [doc]);
ok(
  "document is POSTED",
  (await q(`select status from opening_balance_documents where id=$1`, [doc])).rows[0].status,
  "POSTED",
);
ok(
  "opening stock is real stock, not a purchase",
  (
    await q(
      `select quantity from inventory where product_id=$1 and warehouse_id=$2
             and owner_type='COMPANY' and owner_id is null`,
      [wheat, wh],
    )
  ).rows[0].quantity,
  "1000.000",
);
ok(
  "opening stock carries its cost",
  (await q(`select public.resolve_unit_cost($1::uuid,$2::uuid) v`, [wheat, wh])).rows[0].v,
  "10.0000",
);
ok(
  "the movement is an OPENING, not a purchase",
  (
    await q(
      `select movement_kind::text k from stock_movements
             where product_id=$1 and source_type='opening_balance' limit 1`,
      [wheat],
    )
  ).rows[0].k,
  "OPENING",
);
if (cust) {
  ok(
    "receivable reached the customer ledger",
    (
      await q(
        `select debit from customer_ledger where customer_id=$1 and entry_type='adjustment'
               and reference_type='opening_balance'`,
        [cust],
      )
    ).rows.length > 0,
    true,
  );
}

// ── 5. لا ترحيل مرتين ──
await expectFail(
  "cannot post the same document twice",
  () => q(`select public.post_opening_balance($1::uuid)`, [doc]),
  /already POSTED/,
);

// ── 6. سطر مخزون بلا صنف مرفوض ──
await expectFail(
  "a stock line without an item is refused",
  () =>
    q(`select public.create_opening_balance('2026-01-01'::date,
            '[{"section":"STOCK","quantity":5,"amount":50}]'::jsonb, 'bad')`),
  /violates check constraint|opening_balance_lines_stock_shape/,
);

// ── 7. سطر بمبلغ صفر مرفوض ──
await expectFail(
  "a zero-amount line is refused",
  () =>
    q(`select public.create_opening_balance('2026-01-01'::date,
            '[{"section":"CASH","amount":0}]'::jsonb, 'bad')`),
  /must be greater than zero/,
);

// ── 8. قسم غير معروف مرفوض ──
await expectFail(
  "an unknown section is refused",
  () =>
    q(`select public.create_opening_balance('2026-01-01'::date,
            '[{"section":"MYSTERY","amount":10}]'::jsonb, 'bad')`),
  /Unknown opening section/,
);

// ── 9. العكس ──
const rev = (
  await q(`select public.reverse_opening_balance($1::uuid,$2::text)`, [
    doc,
    "خطأ في الرصيد الافتتاحي",
  ])
).rows[0].reverse_opening_balance;
ok("reversal created", typeof rev, "string");
ok(
  "original is marked REVERSED",
  (await q(`select status from opening_balance_documents where id=$1`, [doc])).rows[0].status,
  "REVERSED",
);
ok(
  "stock returned to zero",
  String(
    Number(
      (
        await q(
          `select coalesce(quantity,0) q from inventory where product_id=$1 and warehouse_id=$2
             and owner_type='COMPANY' and owner_id is null`,
          [wheat, wh],
        )
      ).rows[0].q,
    ),
  ),
  "0",
);
ok(
  "the reversal balances by construction",
  (await q(`select is_balanced from opening_balance_summary where id=$1`, [rev])).rows[0]
    .is_balanced,
  true,
);
await expectFail(
  "reversal requires a reason",
  () => q(`select public.reverse_opening_balance($1::uuid,''::text)`, [rev]),
  /requires a reason/,
);

// ── 10. RLS ──
await expectFail(
  "production-grade RLS: anon cannot read opening balances",
  async () => {
    await q(`set local role anon`);
    await q(`set local "request.jwt.claims" = '{"role":"anon"}'`);
    await q(`select count(*) from opening_balance_documents`);
  },
  /.+/,
);

await q("rollback");
console.log(`\n${fail === 0 ? "ALL PASS" : "FAILURES"} — ${pass} passed, ${fail} failed`);
await c.end();

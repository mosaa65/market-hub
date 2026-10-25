// قبول: ترحيل فاتورة المبيعات إلى الدليل — إيراد وتكلفة وذمم، مرة واحدة فقط
import { connect } from "./db-run.mjs";

const c = await connect();
await c.connect();
let pass = 0, fail = 0;
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

const owner = (await q(
  `select pr.id from profiles pr join user_roles r on r.user_id=pr.id where r.role='owner' limit 1`)).rows[0].id;
const wh = (await q(`select id from warehouses where is_active order by is_default desc limit 1`)).rows[0].id;
const cust = (await q(`select id from customers where is_active limit 1`)).rows[0].id;

// Fixtures are written as the table owner; the posting calls themselves are
// wrapped in asOwner() so they run as a real signed-in manager.
await q("begin");
await q("set local role postgres");

// ── a tracked good with a real cost, so COGS is measurable ──
const flour = (await q(`
  insert into products (sku,name,name_ar,item_nature,item_class,inventory_policy,tracking,
                        costing_method,cost_price,sale_price,unit_id)
  select 'PROBE-LEDGER','probe ledger','دقيق للاختبار المحاسبي','GOOD','FINISHED_GOOD','TRACKED',
         'NONE','MOVING_AVERAGE',0,10,unit_id from products limit 1 returning id`)).rows[0].id;
await q(`select public.apply_cost_movement(
          p_product_id=>$1::uuid, p_warehouse_id=>$2::uuid, p_signed_qty=>100::numeric,
          p_incoming_cost=>6::numeric, p_source_type=>'acceptance')`, [flour, wh]);

// Invoices cannot be INSERTed as `authenticated` - there is no table-level
// write policy, and that is the design: invoices are created through the
// sales RPC. So the fixture is seeded as service_role and the posting itself
// is exercised as an owner, which is the real sequence.
const asOwner = async (fn) => {
  await q(`set local role authenticated`);
  await q(`set local "request.jwt.claims" = '{"role":"authenticated","sub":"${owner}"}'`);
  const out = await fn();
  await q("set local role postgres");
  return out;
};

const mkInvoice = async (name, { method = "credit", paid = 0, tax = 0, qty = 40, price = 10 }) => {
  const inv = (await q(`
    insert into sales_invoices (invoice_number, customer_id, warehouse_id, status,
                                subtotal, discount, tax, total, paid, payment_method)
    values ($1,$2,$3,'unpaid',$4::numeric,0,$5::numeric,$4::numeric+$5::numeric,$6::numeric,$7::public.payment_method)
    returning id, total, paid`,
    [name, cust, wh, qty * price, tax, paid, method])).rows[0];
  await q(`insert into sales_invoice_items (invoice_id, product_id, quantity, unit_price, total, stock_effect)
             values ($1,$2,$3,$4,$5,'STOCK_ISSUE')`, [inv.id, flour, qty, price, qty * price]);
  return inv;
};

// ── 1. ذمم (على الحساب) ──
const credit = await mkInvoice("PROBE-CREDIT", { method: "credit", paid: 0, qty: 40, price: 10 });
await asOwner(() => q(`select public.post_sales_invoice($1::uuid)`, [credit.id]));
const lines = (await q(`
  select a.code, jl.debit, jl.credit from journal_lines jl
    join journal_entries je on je.id = jl.entry_id
    join accounts a on a.id = jl.account_id
   where je.source_type='sales_invoice' and je.source_id=$1 order by a.code`,
  [credit.id])).rows;
const byCode = Object.fromEntries(lines.map((l) => [l.code, Number(l.debit) - Number(l.credit)]));
ok("receivable is debited 400", byCode["1211"], 400);
ok("flour revenue credited 400", byCode["4111"], -400);
ok("cost of goods debited 240", byCode["5111"], 240);
ok("finished goods inventory credited 240", byCode["1313"], -240);
ok("no cash involved on a credit sale", byCode["1101"] ?? 0, 0);
ok("no VAT account touched when tax is zero", byCode["2311"] ?? 0, 0);

// ── 2. نقدية ──
const cash = await mkInvoice("PROBE-CASH", { method: "cash", paid: 400, qty: 40, price: 10 });
await asOwner(() => q(`select public.post_sales_invoice($1::uuid)`, [cash.id]));
const cashLines = (await q(`
  select a.code, jl.debit, jl.credit from journal_lines jl
    join journal_entries je on je.id = jl.entry_id
    join accounts a on a.id = jl.account_id
   where je.source_type='sales_invoice' and je.source_id=$1`, [cash.id])).rows;
const cashBy = Object.fromEntries(cashLines.map((l) => [l.code, Number(l.debit) - Number(l.credit)]));
ok("cash DEBITED for what was collected", cashBy["1101"], 400);
ok("and nothing left as a receivable", cashBy["1211"] ?? 0, 0);

// ── 3. جزئي: مدفوع一部分 والباقي ذمم ──
const partial = await mkInvoice("PROBE-PARTIAL", { method: "cash", paid: 150, qty: 50, price: 10 });
await asOwner(() => q(`select public.post_sales_invoice($1::uuid)`, [partial.id]));
const pLines = (await q(`
  select a.code, jl.debit, jl.credit from journal_lines jl
    join journal_entries je on je.id = jl.entry_id
    join accounts a on a.id = jl.account_id
   where je.source_type='sales_invoice' and je.source_id=$1`, [partial.id])).rows;
const pBy = Object.fromEntries(pLines.map((l) => [l.code, Number(l.debit) - Number(l.credit)]));
ok("cash debits the collected part", pBy["1101"], 150);
ok("receivable takes the rest", pBy["1211"], 350);

// ── 4. ضريبة ──
const taxed = await mkInvoice("PROBE-TAX", { method: "credit", paid: 0, tax: 20, qty: 10, price: 10 });
await asOwner(() => q(`select public.post_sales_invoice($1::uuid)`, [taxed.id]));
const tLines = (await q(`
  select a.code, jl.debit, jl.credit from journal_lines jl
    join journal_entries je on je.id = jl.entry_id
    join accounts a on a.id = jl.account_id
   where je.source_type='sales_invoice' and je.source_id=$1`, [taxed.id])).rows;
const tBy = Object.fromEntries(tLines.map((l) => [l.code, Number(l.debit) - Number(l.credit)]));
ok("VAT is credited when the invoice carries tax", tBy["2311"], -20);
ok("receivable includes the tax", tBy["1211"], 120);

// ── 5. ترحيل مزدوج ممنوع ──
await expectFail("an invoice cannot be posted twice",
  () => q(`select public.post_sales_invoice($1::uuid)`, [credit.id]), /already been posted/);

// ── 6. مسودة لا تُرحَّل أبداً ──
const draft = await mkInvoice("PROBE-DRAFT", { method: "credit" });
await q(`update sales_invoices set status='draft' where id=$1`, [draft.id]);
await expectFail("a draft invoice never posts",
  () => q(`select public.post_sales_invoice($1::uuid)`, [draft.id]), /only confirmed, paid or partial/);

// ── 7. فاتورة خدمة: إيراد بلا تكلفة ──
const svc = (await q(`select id, sale_price from products where item_nature='SERVICE' limit 1`)).rows[0];
const svcInv = (await q(`
  insert into sales_invoices (invoice_number, customer_id, warehouse_id, status,
                              subtotal, discount, tax, total, paid, payment_method)
  values ('PROBE-SERVICE',$1,$2,'confirmed',100,0,0,100,0,'credit') returning id`,
  [cust, wh])).rows[0];
await q(`insert into sales_invoice_items (invoice_id, product_id, quantity, unit_price, total, stock_effect)
           values ($1,$2,1,$3,100,'NONE')`, [svcInv.id, svc.id, svc.sale_price]);
await asOwner(() => q(`select public.post_sales_invoice($1::uuid)`, [svcInv.id]));
const sLines = (await q(`
  select a.code, jl.debit, jl.credit from journal_lines jl
    join journal_entries je on je.id = jl.entry_id
    join accounts a on a.id = jl.account_id
   where je.source_type='sales_invoice' and je.source_id=$1`, [svcInv.id])).rows;
const sBy = Object.fromEntries(sLines.map((l) => [l.code, Number(l.debit) - Number(l.credit)]));
ok("a milling service bills the service revenue account", sBy["4311"], -100);
ok("and posts no cost of goods at all", sBy["5111"] ?? 0, 0);
ok("and touches no inventory account", sBy["1313"] ?? 0, 0);

// ── 8. ميزان المراجعة متوازن بعد كل ذلك ──
const sumD = (await q(`select coalesce(sum(total_debit),0) t from trial_balance`)).rows[0].t;
const sumC = (await q(`select coalesce(sum(total_credit),0) t from trial_balance`)).rows[0].t;
ok("the trial balance still balances after four sales", Math.round(sumD), Math.round(sumC));
ok("and the sales actually moved value",
  Number((await q(`select coalesce(sum(total_debit),0) t from trial_balance where code='5111'`)).rows[0].t) > 0, true);

// ── 9. حالة كل فاتورة مرئية ──
const st = (await q(`select ledger_state, count(*)::int n from invoice_ledger_status group by 1`)).rows;
ok("posted invoices are reported as POSTED",
  st.find((s) => s.ledger_state === "POSTED").n >= 5, true);
ok("drafts are reported as NEVER_POSTS", st.find((s) => s.ledger_state === "NEVER_POSTS").n, 1);

await q("rollback");
console.log(`\n${fail === 0 ? "ALL PASS" : "FAILURES"} — ${pass} passed, ${fail} failed`);
await c.end();
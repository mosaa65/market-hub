// قبول: ترحيل فاتورة المشتريات إلى الدليل
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
  try { await fn(); await q("release savepoint sp"); console.log(`FAIL  ${label}  →  allowed`); fail++; }
  catch (e) { await q("rollback to savepoint sp"); await q("release savepoint sp"); ok(label, pattern.test(e.message), true); }
};

const owner = (await q(`select pr.id from profiles pr join user_roles r on r.user_id=pr.id where r.role='owner' limit 1`)).rows[0].id;
const wh = (await q(`select id from warehouses where is_active order by is_default desc limit 1`)).rows[0].id;
const sup = (await q(`select id from suppliers where is_active limit 1`)).rows[0]?.id;

await q("begin");
await q("set local role postgres");
const asOwner = async (fn) => {
  await q(`set local role authenticated`);
  await q(`set local "request.jwt.claims" = '{"role":"authenticated","sub":"${owner}"}'`);
  const out = await fn();
  await q("set local role postgres");
  return out;
};

const wheat = (await q(`
  insert into products (sku,name,name_ar,item_nature,item_class,inventory_policy,tracking,
                        costing_method,cost_price,unit_id)
  select 'PROBE-PW','probe pw','قمح للاختبار المحاسبي','GOOD','RAW_MATERIAL','TRACKED','NONE',
         'MOVING_AVERAGE',0,unit_id from products limit 1 returning id`)).rows[0].id;

const mkPurchase = async (name, { method = "credit", paid = 0, tax = 0, qty = 1000, cost = 12,
  effect = "STOCK_RECEIPT" } = {}) => {
  const total = qty * cost;
  const inv = (await q(`
    insert into purchase_invoices (invoice_number, supplier_id, warehouse_id, status,
                                  subtotal, discount, tax, total, paid, payment_method)
    values ($1,$2,$3,'unpaid',$4::numeric,0,$5::numeric,$4::numeric+$5::numeric,$6::numeric,
            $7::public.payment_method) returning id`,
    [name, sup, wh, total, tax, paid, method])).rows[0];
  await q(`insert into purchase_invoice_items (invoice_id, product_id, quantity, unit_cost,
                total, tax, stock_effect)
           values ($1,$2,$3,$4,$5,$6,$7::text)`,
    [inv.id, wheat, qty, cost, total, tax, effect]);
  return inv;
};

const linesOf = async (invId) => {
  const rows = (await q(`
    select a.code, jl.debit, jl.credit from journal_lines jl
      join journal_entries je on je.id = jl.entry_id
      join accounts a on a.id = jl.account_id
     where je.source_type='purchase_invoice' and je.source_id=$1 order by a.code`, [invId])).rows;
  return Object.fromEntries(rows.map((l) => [l.code, Number(l.debit) - Number(l.credit)]));
};

// ── 1. شراء آجل: مخزون مقابل ذمم مورد ──
const cr = await mkPurchase("PROBE-P-CREDIT", { method: "credit" });
await asOwner(() => q(`select public.post_purchase_invoice($1::uuid)`, [cr.id]));
const by = await linesOf(cr.id);
ok("raw grain inventory debited 12000", by["1311"], 12000);
ok("supplier payable credited 12000", by["2111"], -12000);
ok("no cash moved on a credit purchase", by["1101"] ?? 0, 0);

// ── 2. شراء نقدي ──
const cash = await mkPurchase("PROBE-P-CASH", { method: "cash", paid: 12000 });
await asOwner(() => q(`select public.post_purchase_invoice($1::uuid)`, [cash.id]));
const cashBy = await linesOf(cash.id);
ok("inventory debited", cashBy["1311"], 12000);
ok("cash credited for the supplier", cashBy["1101"], -12000);
ok("nothing left as a payable", cashBy["2111"] ?? 0, 0);

// ── 3. دفعة جزئية ──
const part = await mkPurchase("PROBE-P-PART", { method: "cash", paid: 5000 });
await asOwner(() => q(`select public.post_purchase_invoice($1::uuid)`, [part.id]));
const pBy = await linesOf(part.id);
ok("cash credited the paid part", pBy["1101"], -5000);
ok("payable carries the rest", pBy["2111"], -7000);

// ── 4. ضريبة مدخلات: أصل مسترد، لا تكلفة مخزون ──
const taxed = await mkPurchase("PROBE-P-TAX", { method: "credit", tax: 600 });
await asOwner(() => q(`select public.post_purchase_invoice($1::uuid)`, [taxed.id]));
const tBy = await linesOf(taxed.id);
ok("input VAT debited to its own asset account", tBy["1316"], 600);
ok("inventory carries the goods only, tax excluded", tBy["1311"], 12000);
ok("payable includes the tax", tBy["2111"], -12600);

// ── 5. بند غير مخزني = مصروف لا مخزون ──
const svcLine = await mkPurchase("PROBE-P-SVC", { method: "credit", effect: "NONE", qty: 1, cost: 500 });
await asOwner(() => q(`select public.post_purchase_invoice($1::uuid)`, [svcLine.id]));
const sBy = await linesOf(svcLine.id);
ok("a non-stock purchase is an expense, not inventory", sBy["5911"], 500);
ok("and never inflates the grain account", sBy["1311"] ?? 0, 0);

// ── 6. ضوابط ──
await expectFail("double posting is refused",
  () => q(`select public.post_purchase_invoice($1::uuid)`, [cr.id]), /already been posted/);

const draft = await mkPurchase("PROBE-P-DRAFT", { method: "credit" });
await q(`update purchase_invoices set status='draft' where id=$1`, [draft.id]);
await expectFail("a draft purchase never posts",
  () => q(`select public.post_purchase_invoice($1::uuid)`, [draft.id]), /only confirmed, paid or partial/);

const over = await mkPurchase("PROBE-P-OVER", { method: "cash", paid: 99000 });
await expectFail("an overpaid purchase is refused by name",
  () => q(`select public.post_purchase_invoice($1::uuid)`, [over.id]), /cannot exceed the invoice/);

// ── 7. ميزان المراجعة ──
const sumD = (await q(`select coalesce(sum(total_debit),0) t from trial_balance`)).rows[0].t;
const sumC = (await q(`select coalesce(sum(total_credit),0) t from trial_balance`)).rows[0].t;
ok("the trial balance still balances", Math.round(sumD), Math.round(sumC));
ok("inventory actually grew in the books",
  Number((await q(`select coalesce(sum(total_debit),0) t from trial_balance where code='1311'`)).rows[0].t) >= 48000, true);

// ── 8. حالة كل فاتورة مشتريات مرئية ──
const st = (await q(`select ledger_state, count(*)::int n from purchase_ledger_status group by 1`)).rows;
ok("posted purchases report POSTED", st.find((s) => s.ledger_state === "POSTED")?.n >= 4, true);
ok("drafts report NEVER_POSTS", st.find((s) => s.ledger_state === "NEVER_POSTS")?.n, 1);

await q("rollback");
console.log(`\n${fail === 0 ? "ALL PASS" : "FAILURES"} — ${pass} passed, ${fail} failed`);
await c.end();
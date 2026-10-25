// قبول: محرك التكلفة — متوسط متحرك وتكلفة معيارية
// كل السيناريوهات داخل معاملات مُلغاة، فلا يتغير أي رصيد فعلي.
import { connect } from './db-run.mjs';

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

const wh = (
  await c.query(`select id from warehouses where is_active order by is_default desc limit 1`)
).rows[0].id;

// نداء المُحرّك بأسماء معاملاته — أوضح ولاDepends على ترتيب موضعي هشّ
const move = (product, qty, cost, note) =>
  c.query(
    `select apply_cost_movement(
       p_product_id   => $1::uuid,
       p_warehouse_id => $2::uuid,
       p_signed_qty   => $3::numeric,
       p_incoming_cost=> $4::numeric,
       p_source_type  => 'acceptance_test',
       p_note         => $5::text)`,
    [product, wh, qty, cost, note],
  );

const layerOf = async (p) =>
  (
    await c.query(
      `select quantity, total_value, last_unit_cost from item_cost_layers
        where product_id=$1 and warehouse_id=$2 and owner_type='COMPANY'`,
      [p, wh],
    )
  ).rows[0];

const mkProduct = (sku, extra) =>
  c.query(
    `insert into products (sku,name,name_ar,item_nature,inventory_policy,tracking,costing_method,cost_price,unit_id ${extra ? "," + extra : ""})
     select $1,$1,$1::text,'GOOD','TRACKED','NONE','MOVING_AVERAGE',1000,unit_id ${extra ? ",1000" : ""} from products limit 1 returning id`,
    [sku],
  ).then((r) => r.rows[0].id);

// ── 1. المتوسط المتحرك ──
await c.query("begin");
const p = await mkProduct("PROBE-MA");
ok("catalogue cost is 1000", (await c.query(`select cost_price from products where id=$1`, [p])).rows[0].cost_price, "1000.00");

await move(p, 100, 1000, "receipt 1");
await move(p, 100, 1200, "receipt 2");
let l = await layerOf(p);
ok("qty after 2 receipts", l.quantity, "200.000");
ok("value = 100*1000 + 100*1200", l.total_value, "220000.00");
ok("last_unit_cost is the LAST movement cost (1200), not the average", l.last_unit_cost, "1200.0000");
ok("the running average is served by resolve_unit_cost (1100)", (await c.query(`select public.resolve_unit_cost($1,$2) v`, [p, wh])).rows[0].v, "1100.0000");

// الصرف يجب أن يخرج بمتوسط 1100 لا بآخر سعر دخل
await move(p, -50, null, "issue 50");
l = await layerOf(p);
ok("qty after partial issue", l.quantity, "150.000");
ok("value after issue at average", l.total_value, "165000.00");
ok("average unchanged by the issue", (await c.query(`select public.resolve_unit_cost($1,$2) v`, [p, wh])).rows[0].v, "1100.0000");

await move(p, -150, null, "issue the rest");
l = await layerOf(p);
ok("qty after full issue", l.quantity, "0.000");
ok("no ghost value after a full issue", l.total_value, "0.00");
await c.query("rollback");

// ── 2. التكلفة المعيارية: الميزانية بدل إضاعتها في المتوسط ──
await c.query("begin");
const p2 = await mkProduct("PROBE-STD", "standard_cost");
await c.query(`update products set standard_cost=1000 where id=$1`, [p2]);
const owner = (await c.query(`select pr.id from profiles pr join user_roles r on r.user_id=pr.id where r.role='owner' limit 1`)).rows[0].id;
await c.query(`set local role authenticated`);
await c.query(`set local "request.jwt.claims" = '{"role":"authenticated","sub":"${owner}"}'`);
await c.query(`select set_company_costing_method('STANDARD','MANUAL','probe')`);
ok("method switched to STANDARD", (await c.query(`select company_costing_method() m`)).rows[0].m, "STANDARD");

await move(p2, 100, 1000, "receipt at standard");
await move(p2, 100, 1400, "receipt ABOVE standard");
l = await layerOf(p2);
ok("balance stays at standard, not at what was paid", l.total_value, "200000.00");
ok("resolve returns the standard", (await c.query(`select public.resolve_unit_cost($1,$2) v`, [p2, wh])).rows[0].v, "1000.0000");

// إثبات أن تكلفة الفارق قابلة للقياس: ما دُفع فعلياً مقابل ما حُمِّل على الرصيد
const paid = (await c.query(
  `select round(sum(value),2) v from item_cost_transactions
    where product_id=$1 and direction='IN'`, [p2])).rows[0].v;
ok("the ledger records what was actually paid (240000)", paid, "240000.00");
ok("the balance was loaded at standard (200000)", l.total_value, "200000.00");
ok("the 40000 gap is therefore a measurable variance", String(paid - Number(l.total_value)), "40000");
// إعادة بناء الميزانية من السجل وحده: مجموع ما دُفع ناقص ما حُمِّل على الرصيد.
// aggregate_tx قبل الربط حتى لا يُكرَّر إجمالي الطبقة لكل حركة.
const rebuilt = (await c.query(`
  with agg as (
    select product_id, sum(value) v from item_cost_transactions
     where direction='IN' group by product_id
  )
  select round(agg.v - cl.total_value, 2) gap
    from agg join item_cost_layers cl on cl.product_id = agg.product_id
   where cl.owner_type='COMPANY' and cl.product_id = $1`, [p2])).rows[0].gap;
ok("variance is reconstructable from the ledger alone", rebuilt, "40000.00");
await c.query("rollback");

// ── 3. صنف بلا حركة: مرجع لا فعلي ──
await c.query("begin");
const p3 = await mkProduct("PROBE-NOMOVE");
ok("no movements -> catalogue reference", (await c.query(`select public.resolve_unit_cost($1,$2) v`, [p3, wh])).rows[0].v, "1000.00");
ok("reported as REFERENCE_ONLY", (await c.query(`select valuation_basis from item_valuation where product_id=$1`, [p3])).rows[0].valuation_basis, "REFERENCE_ONLY");
await c.query("rollback");

// ── 4. صنف بلا تكلفة في أي مكان: لا يُقيَّم بصفر كأنه مجاني ──
await c.query("begin");
const p4 = await mkProduct("PROBE-ZERO");
await c.query(`update products set cost_price=0 where id=$1`, [p4]);
await move(p4, 100, null, "no cost anywhere");
l = await layerOf(p4);
ok("lands at zero value", l.total_value, "0.00");
ok("and stays REFERENCE_ONLY rather than claiming ACTUAL zero",
   (await c.query(`select valuation_basis from item_valuation where product_id=$1`, [p4])).rows[0].valuation_basis, "REFERENCE_ONLY");
await c.query("rollback");

// ── 5. الصلاحيات ──
await c.query("begin");
// الدليل يُبنى داخل المعاملة: القاعدة بعد التنظيف بلا حركات، فالجدول قد
// يكون فارغاً بحق — التوقع القديم "count > 0" كان يعتمد على بيانات عشوائية.
await c.query(`insert into item_cost_layers (product_id,warehouse_id,quantity,total_value,owner_type)
  select id,$1,1,1,'COMPANY' from products limit 1`, [wh]);
await c.query(`set local role authenticated`);
await c.query(`set local "request.jwt.claims" = '{"role":"authenticated","sub":"${owner}"}'`);
ok("staff can read cost layers", (await c.query(`select count(*)::int n from item_cost_layers`)).rows[0].n > 0, true);
try {
  await c.query(`insert into item_cost_layers (product_id,warehouse_id,quantity,total_value) select id,$1,1,1 from products limit 1`, [wh]);
  console.log("FAIL  staff wrote a layer directly"); fail++;
} catch (e) { ok("staff cannot write a layer directly", true, true); }
await c.query("rollback");

await c.query("begin");
await c.query("set local role anon");
await c.query(`set local "request.jwt.claims" = '{"role":"anon"}'`);
// ACL closed outright: anon is refused rather than merely seeing nothing
for (const s of [`select count(*) from item_cost_layers`, `select count(*) from item_cost_transactions`, `select count(*) from item_valuation`]) {
  try { await c.query(s); console.log(`FAIL  anon reached ${s.split("from ")[1]}`); fail++; }
  catch (e) { ok(`anon denied: ${s.split("from ")[1]}`, true, true); }
}
await c.query("rollback");

console.log(`\n${fail === 0 ? "ALL PASS" : "FAILURES"} — ${pass} passed, ${fail} failed`);
await c.end();
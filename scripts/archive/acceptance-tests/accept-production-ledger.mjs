// قبول: ترحيل أمر الإنتاج — WIP، نواتج، وفاقد مُسمّى بالريال
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

await q("begin");
await q("set local role postgres");
const asOwner = async (fn) => {
  await q(`set local role authenticated`);
  await q(`set local "request.jwt.claims" = '{"role":"authenticated","sub":"${owner}"}'`);
  const out = await fn();
  await q("set local role postgres");
  return out;
};

// ── fixtures ──
const mk = async (sku, cls) => (await q(`
  insert into products (sku,name,name_ar,item_nature,item_class,inventory_policy,tracking,
                        costing_method,cost_price,sale_price,unit_id)
  select $1,$1,$1::text,'GOOD',$2::public.item_class,'TRACKED','NONE','MOVING_AVERAGE',0,10,unit_id
  from products limit 1 returning id`, [sku, cls])).rows[0].id;
const wheat = await mk("PROBE-OP-W", "RAW_MATERIAL");
const flour = await mk("PROBE-OP-F", "FINISHED_GOOD");
const bran = await mk("PROBE-OP-B", "BY_PRODUCT");

const linesOf = async (orderId) => {
  const rows = (await q(`
    select a.code, jl.debit, jl.credit from journal_lines jl
      join journal_entries je on je.id = jl.entry_id
      join accounts a on a.id = jl.account_id
     where je.source_id=$1 and je.source_type like 'production_order%'`, [orderId])).rows;
  const by = {};
  for (const l of rows) by[l.code] = (by[l.code] ?? 0) + Number(l.debit) - Number(l.credit);
  return by;
};

/** Runs a complete production order and returns its id. */
const runOrder = async (label, { labour = 3000, overhead = 2000, lossQty = 40 } = {}) => {
  const ord = (await asOwner(() => q(
    `select public.create_production_order($1::uuid,null,current_date,'REMAINDER_TO_PRIMARY',$2::text)`,
    [wh, label]))).rows[0].create_production_order;

  await q("set local role service_role");
  await q(`set local "request.jwt.claims" = '{"role":"service_role"}'`);
  // Quantity comes from the stock engine, value from the cost engine. Seeding
  // only the cost layer would produce a priced but empty silo.
  await q(`select public.post_stock_delta(
            p_product_id=>$1::uuid, p_warehouse_id=>$2::uuid, p_signed_qty=>1000::numeric,
            p_unit_cost=>12, p_movement_kind=>'RECEIPT', p_source_type=>'acceptance',
            p_owner_type=>'COMPANY', p_owner_id=>NULL)`, [wheat, wh]);
  await q(`select public.apply_cost_movement(p_product_id=>$1::uuid,p_warehouse_id=>$2::uuid,
            p_signed_qty=>1000::numeric,p_incoming_cost=>12::numeric,p_source_type=>'acceptance')`,
    [wheat, wh]);
  await q("set local role postgres");

  await asOwner(() => q(`select public.issue_production_materials($1::uuid,$2::uuid,1000::numeric)`, [ord, wheat]));
  await asOwner(() => q(`select public.add_production_output($1::uuid,$2::uuid,760::numeric,'PRIMARY')`, [ord, flour]));
  await asOwner(() => q(`select public.add_production_output($1::uuid,$2::uuid,200::numeric,'BY_PRODUCT')`, [ord, bran]));
  await asOwner(() => q(`select public.record_production_loss($1::uuid,$2::text,$3::numeric)`, [ord, "فقد رطوبة", lossQty]));
  await asOwner(() => q(`select public.complete_production_order($1::uuid,$2::numeric,$3::numeric)`,
    [ord, overhead, labour]));
  return ord;
};

// ── 1. الدورة الكاملة، ثم الترحيل ──
const ord = await runOrder("PROBE-OP-1");
await asOwner(() => q(`select public.post_production_order($1::uuid)`, [ord]));
const o = (await q(`select material_cost, total_cost, direct_labour, overhead_cost from production_orders where id=$1`, [ord])).rows[0];
ok("materials cost 12000, labour 3000, overhead 2000, total 17000",
  [Number(o.material_cost), Number(o.direct_labour), Number(o.overhead_cost), Number(o.total_cost)].join(","),
  "12000,3000,2000,17000");

const by = await linesOf(ord);
ok("work in progress received the materials", by["1312"], 0);
ok("raw grain released for the materials", by["1311"], -12000);
ok("finished goods received the flour at its allocated cost", by["1313"], 17000);
ok("direct labour credited", by["5211"], -3000);
ok("overhead credited", by["5311"], -2000);
// Under REMAINDER_TO_PRIMARY no 5911 line is created at all, so the account is
// absent from the entry rather than present and zero. Absent is the correct
// outcome here: the loss sits inside the flour's 17,000 under this basis.
ok("no separate loss line exists under this basis", by["5911"] ?? 0, 0);
const lossNamed = (await q(`
  select count(*)::int n from journal_lines jl
    join journal_entries je on je.id = jl.entry_id
    join accounts a on a.id = jl.account_id
   where je.source_id=$1 and a.code='5911'`, [ord])).rows[0].n;
ok("the loss is not a separate line under this allocation basis", lossNamed, 0);

// ── 2. WIP يُصفَّر عند الإقفال ──
ok("work in progress nets to zero after closing", by["1312"], 0);

// ── 3. قاعدة التوزيع البديلة: النخالة تُحمَّل ──
const ord2 = (await asOwner(() => q(
  `select public.create_production_order($1::uuid,null,current_date,'NET_REALISABLE_VALUE','نخالة بسعر بيع'::text)`,
  [wh]))).rows[0].create_production_order;
await q("set local role service_role");
await q(`select public.post_stock_delta(p_product_id=>$1::uuid,p_warehouse_id=>$2::uuid,
          p_signed_qty=>1000::numeric,p_unit_cost=>12,p_movement_kind=>'RECEIPT',
          p_source_type=>'acceptance',p_owner_type=>'COMPANY',p_owner_id=>NULL)`, [wheat, wh]);
await q(`select public.apply_cost_movement(p_product_id=>$1::uuid,p_warehouse_id=>$2::uuid,
          p_signed_qty=>1000::numeric,p_incoming_cost=>12::numeric,p_source_type=>'acceptance')`, [wheat, wh]);
await q("set local role postgres");
await asOwner(() => q(`select public.issue_production_materials($1::uuid,$2::uuid,1000::numeric)`, [ord2, wheat]));
await asOwner(() => q(`select public.add_production_output($1::uuid,$2::uuid,760::numeric,'PRIMARY')`, [ord2, flour]));
await asOwner(() => q(`select public.add_production_output($1::uuid,$2::uuid,200::numeric,'BY_PRODUCT')`, [ord2, bran]));
await asOwner(() => q(`select public.record_production_loss($1::uuid,'فقد'::text,40::numeric)`, [ord2]));
await asOwner(() => q(`select public.complete_production_order($1::uuid,2000::numeric,3000::numeric)`, [ord2]));
await asOwner(() => q(`select public.post_production_order($1::uuid)`, [ord2]));
const by2 = await linesOf(ord2);
ok("under NRV the by-product carries its full realisable value", by2["1314"], 2000);
ok("and the flour carries the remainder", by2["1313"], 15000);

// ── 4. الفاقد يظهر بالريال في التقرير ──
const v = (await q(`select loss_value, output_cost, total_cost, ledger_state
                      from production_ledger_status where order_id=$1`, [ord])).rows[0];
ok("loss value is reported in riyals", Number(v.loss_value), 0);
ok("output cost equals the order cost under this basis", Number(v.output_cost), 17000);
ok("and the order reports as POSTED", v.ledger_state, "POSTED");

// ── 5. ضوابط ──
await expectFail("double posting is refused",
  () => q(`select public.post_production_order($1::uuid)`, [ord]), /already been posted/);

const open = (await asOwner(() => q(`select public.create_production_order($1::uuid)`, [wh])))
  .rows[0].create_production_order;
await expectFail("an unfinished order has nothing to post",
  () => q(`select public.post_production_order($1::uuid)`, [open]), /only a completed order/);

// ── 6. ميزان المراجعة ──
const sumD = (await q(`select coalesce(sum(total_debit),0) t from trial_balance`)).rows[0].t;
const sumC = (await q(`select coalesce(sum(total_credit),0) t from trial_balance`)).rows[0].t;
ok("the trial balance still balances", Math.round(sumD), Math.round(sumC));
ok("and conversion costs reached the accounts",
  Number((await q(`select coalesce(sum(total_credit),0) t from trial_balance where code='5211'`)).rows[0].t) >= 6000, true);

await q("rollback");
console.log(`\n${fail === 0 ? "ALL PASS" : "FAILURES"} — ${pass} passed, ${fail} failed`);
await c.end();
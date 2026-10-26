// قبول: دورة إنتاج المطحنة كاملة — شراء قمح، صرف، نواتج، فاقد، تكلفة، مخزون.
// كل شيء داخل معاملة مُلغاة.
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

// الفحص السلبي داخل نقطة حفظ: بدونها تُبطل المعاملة كاملة بقول
// "current transaction is aborted" ويصبح بقية الاختبار بلا معنى.
const expectFail = async (label, sql, params, pattern) => {
  await q("savepoint sp");
  try {
    await q(sql, params);
    await q("release savepoint sp");
    console.log(`FAIL  ${label}  →  the call was allowed`); fail++;
  } catch (e) {
    await q("rollback to savepoint sp");
    await q("release savepoint sp");
    ok(label, pattern.test(e.message), true);
  }
};
const wh = (
  await q(`select id from warehouses where is_active order by is_default desc limit 1`)
).rows[0].id;
const owner = (
  await q(
    `select pr.id from profiles pr join user_roles r on r.user_id=pr.id where r.role='owner' limit 1`,
  )
).rows[0].id;

// نتنفّذ البذور كـ service_role: محرك المخزون نفسه غير ممنوح لauthenticated
// عمداً،Transit عبر دوال SECURITY DEFINER فقط. ثم ننتقل إلى مستخدم حقيقي
// لتشغيل الدورة كما تفعل الواجهة فعلاً.
await q("begin");
await q(`set local role service_role`);
await q(`set local "request.jwt.claims" = '{"role":"service_role"}'`);

// ── تجهيز: قمح 1000 كجم بتكلفة 12000 للطن (=12 كجم) ──
const wheat = (
  await q(`
  insert into products (sku,name,name_ar,item_nature,item_class,inventory_policy,tracking,
                       costing_method,cost_price,sale_price,unit_id)
  select 'PROBE-WH','probe wheat','قمح للاختبار','GOOD','RAW_MATERIAL','TRACKED','NONE',
         'MOVING_AVERAGE',12,13,unit_id from products limit 1 returning id`)
).rows[0].id;
const flour = (
  await q(`
  insert into products (sku,name,name_ar,item_nature,item_class,inventory_policy,tracking,
                       costing_method,cost_price,sale_price,unit_id)
  select 'PROBE-FL','probe flour','دقيق للاختبار','GOOD','FINISHED_GOOD','TRACKED','NONE',
         'MOVING_AVERAGE',0,16,unit_id from products limit 1 returning id`)
).rows[0].id;
const bran = (
  await q(`
  insert into products (sku,name,name_ar,item_nature,item_class,inventory_policy,tracking,
                       costing_method,cost_price,sale_price,unit_id)
  select 'PROBE-BR','probe bran','نخالة للاختبار','GOOD','BY_PRODUCT','TRACKED','NONE',
         'MOVING_AVERAGE',0,9,unit_id from products limit 1 returning id`)
).rows[0].id;

// إدخال مخزون حقيقي: الكمية عبر محرك المخزون، والتكلفة عبر محرك التكلفة
const stockIn = (product, qty, cost) =>
  q(`set local role service_role`).then(() =>
    q(`set local "request.jwt.claims" = '{"role":"service_role"}'`),
  ).then(() =>
    q(
      `select public.post_stock_delta(
         p_product_id=>$1::uuid, p_warehouse_id=>$2::uuid, p_signed_qty=>$3::numeric,
         p_unit_cost=>$4::numeric, p_movement_kind=>'RECEIPT',
         p_source_type=>'acceptance', p_note=>'شراء اختبار',
         p_owner_type=>'COMPANY', p_owner_id=>NULL)`,
      [product, wh, qty, cost],
    ),
  ).then(() =>
    q(
      `select public.apply_cost_movement(
         p_product_id=>$1::uuid, p_warehouse_id=>$2::uuid, p_signed_qty=>$3::numeric,
         p_incoming_cost=>$4::numeric, p_source_type=>'acceptance', p_note=>'شراء اختبار')`,
      [product, wh, qty, cost],
    ),
  ).then(() =>
    q(`set local role authenticated`).then(() =>
      q(`set local "request.jwt.claims" = '{"role":"authenticated","sub":"${owner}"}'`),
    ),
  );

// خزّن 1000 كجم قمح بتكلفة 12 ر.ي/كجم
await stockIn(wheat, 1000, 12);

const wheatQty = async () =>
  (
    await q(
      `select coalesce(quantity,0) q from inventory
        where product_id=$1 and warehouse_id=$2 and owner_type='COMPANY' and owner_id is null`,
      [wheat, wh],
    )
  ).rows[0].q;
ok("wheat in stock 1000 kg", await wheatQty(), "1000.000");

// ── 1. فتح أمر إنتاج (بمستخدم owner حقيقي) ──
await q(`set local role authenticated`);
await q(`set local "request.jwt.claims" = '{"role":"authenticated","sub":"${owner}"}'`);
const ord = (
  await q(
    `select public.create_production_order($1::uuid, null, current_date, 'REMAINDER_TO_PRIMARY', 'اختبار دورة كاملة')`,
    [wh],
  )
).rows[0].create_production_order;
ok("order created", typeof ord, "string");

// ── 2. صرف 1000 كجم ──
await q(`select public.issue_production_materials($1::uuid,$2::uuid,1000::numeric)`, [ord, wheat]);
ok("wheat fully consumed from the silo", await wheatQty(), "0.000");
const mat = (await q(`select actual_qty, total_cost from production_order_materials where order_id=$1`, [ord])).rows[0];
ok("material issued 1000 kg", mat.actual_qty, "1000.000");
ok("material cost 12000 YER", mat.total_cost, "12000.00");

// ── 3. منع الصرف بأكثر من الرصيد ──
const ord2 = (await q(`select public.create_production_order($1::uuid)`, [wh])).rows[0].create_production_order;
await expectFail("cannot issue more than the balance",
  `select public.issue_production_materials($1::uuid,$2::uuid,500::numeric)`, [ord2, wheat],
  /Only .* available/);
await q(`delete from production_orders where id=$1`, [ord2]);

// ── 4. منع إنتاج خدمة في مخزون ──
const svc = (await q(`
  insert into products (sku,name,name_ar,item_nature,item_class,inventory_policy,tracking,costing_method,unit_id)
  select 'PROBE-SV','probe svc','خدمة للاختبار','SERVICE','SERVICE','UNTRACKED','NONE','NONE',unit_id
  from products limit 1 returning id`)).rows[0].id;
await expectFail("a service cannot be produced into stock",
  `select public.add_production_output($1::uuid,$2::uuid,10::numeric,'PRIMARY')`, [ord, svc],
  /cannot be produced into stock/);

// ── 5. منع إكمال غير متوازن (ناتج أكبر من المدخل) ──
const ord3 = (await q(`select public.create_production_order($1::uuid)`, [wh])).rows[0].create_production_order;
await stockIn(wheat, 1000, 12);
await q(`select public.issue_production_materials($1::uuid,$2::uuid,1000::numeric)`, [ord3, wheat]);
await q(`select public.add_production_output($1::uuid,$2::uuid,900::numeric,'PRIMARY')`, [ord3, flour]);
await q(`select public.add_production_output($1::uuid,$2::uuid,200::numeric,'PRIMARY')`, [ord3, flour]);
await expectFail("output beyond input is refused",
  `select public.complete_production_order($1::uuid,0,0)`, [ord3], /exceed input|Unbalanced/i);
await q(`delete from production_orders where id=$1`, [ord3]);

// ── 6. الدورة الكاملة: 1000 قمح → 760 دقيق + 200 نخالة + 40 فاقد ──
// نقيس رصيد الدقيق قبل الاستلام وبعده، لأن اختبارات الاستAACBALance earlier
// أضافت كميات إلى نفس الموقع وحذف أمر لا يُرجع حركة المخزون.
const flourQty = async () =>
  (await q(
    `select coalesce(quantity,0) q from inventory where product_id=$1 and warehouse_id=$2
      and owner_type='COMPANY' and owner_id is null`, [flour, wh])).rows[0].q;
const flourBefore = await flourQty();
await q(`select public.add_production_output($1::uuid,$2::uuid,760::numeric,'PRIMARY')`, [ord, flour]);
await q(`select public.add_production_output($1::uuid,$2::uuid,200::numeric,'BY_PRODUCT')`, [ord, bran]);
await q(`select public.record_production_loss($1::uuid,$2::text,40::numeric,$3::text)`,
  [ord, "فقد رطوبة وتطاير دقيق", "ملاحظة اختبار"]);
await q(`select public.complete_production_order($1::uuid, 2000::numeric, 3000::numeric)`, [ord]);

const done = (await q(`select * from production_orders where id=$1`, [ord])).rows[0];
ok("order is COMPLETED", done.status, "COMPLETED");
ok("material cost 12000", done.material_cost, "12000.00");
ok("labour 3000", done.direct_labour, "3000.00");
ok("overhead 2000", done.overhead_cost, "2000.00");
ok("total production cost 17000", done.total_cost, "17000.00");
ok("actual input 1000", done.actual_input_qty, "1000.000");
ok("actual output 960", done.actual_output_qty, "960.000");
ok("yield 96%", done.actual_yield_pct, "96.000");
ok("balanced: input - output = the 40 kg logged as loss",
  String(Number(done.actual_input_qty) - Number(done.actual_output_qty)), "40");

// ── 7. توزيع التكلفة المشتركة ──
const outs = (await q(
  `select p.sku, o.output_role, o.actual_qty, o.total_cost, o.unit_cost
     from production_order_outputs o join products p on p.id=o.product_id
    where o.order_id=$1 order by o.output_role`, [ord])).rows;
const fl = outs.find((x) => x.sku === "PROBE-FL");
const br = outs.find((x) => x.sku === "PROBE-BR");
ok("flour is PRIMARY", fl.output_role, "PRIMARY");
ok("bran is BY_PRODUCT", br.output_role, "BY_PRODUCT");
// الافتراضي: الأساسي يحمل التكلفة كاملة، والجانبي بلا تكلفة
ok("bran carries no cost by default", br.total_cost, "0.00");
ok("flour absorbs the whole cost", fl.total_cost, "17000.00");
ok("flour unit cost = 17000/760", fl.unit_cost, "22.3684");

// ── 8. النواتج في المخزون ومقيَّمة بالتكلفة الحقيقية ──
ok("this order added 760 kg of flour",
  String(Number(await flourQty()) - Number(flourBefore)), "760");
ok("resolve_unit_cost returns the produced cost",
  (await q(`select public.resolve_unit_cost($1::uuid,$2::uuid) v`, [flour, wh])).rows[0].v, "22.3684");
ok("flour is now ACTUAL, not a catalogue reference",
  (await q(`select valuation_basis from item_valuation where product_id=$1`, [flour])).rows[0].valuation_basis,
  "ACTUAL");

// ── 9. الفاقد بسبب وتصديق ──
const losses = (await q(`select reason, qty, value from production_order_losses where order_id=$1`, [ord])).rows;
ok("loss recorded with a reason", losses.length, 1);
ok("loss is 40 kg", losses[0].qty, "40.000");
ok("loss valued at input cost (40 x 12)", losses[0].value, "480.00");

// ── 10. الفارق غير المفسَّر يُسجَّل ولا يُبتلع ──
const ord4 = (await q(`select public.create_production_order($1::uuid)`, [wh])).rows[0].create_production_order;
await stockIn(wheat, 500, 12);
await q(`select public.issue_production_materials($1::uuid,$2::uuid,500::numeric)`, [ord4, wheat]);
await q(`select public.add_production_output($1::uuid,$2::uuid,400::numeric,'PRIMARY')`, [ord4, flour]);
await q(`select public.complete_production_order($1::uuid,0,0)`, [ord4]);
const unexplained = (await q(
  `select reason, qty from production_order_losses where order_id=$1`, [ord4])).rows;
ok("the 100 kg shortfall is recorded, not absorbed", unexplained.length, 1);
ok("and is flagged as unexplained", /غير مفسّر/.test(unexplained[0].reason), true);
ok("shortfall is 100 kg", unexplained[0].qty, "100.000");

// ── 11. منع الصرف من أمانات العميل ──
const custody = (await q(`
  select i.product_id from inventory i
   where i.owner_type='CUSTOMER' and i.owner_id is not null limit 1`)).rows[0];
if (custody) {
  const ord5 = (await q(`select public.create_production_order($1::uuid)`, [wh])).rows[0].create_production_order;
  await expectFail("customer custody is not consumable by mill production",
    `select public.issue_production_materials($1::uuid,$2::uuid,1::numeric)`, [ord5, custody.product_id],
    /available/);
  await q(`delete from production_orders where id=$1`, [ord5]);
} else { ok("customer custody is not consumable (no custody position to test)", "skip", "skip"); }

// ── 12. لا كتابة مباشرة على جداول الإنتاج ──
// A query that matches no rows succeeds silently, so an RLS error is not the
// signal - "zero rows affected" is. This is the check that actually matters.
const tampered = (await q(
  `update production_orders set total_cost = 0 where id=$1 returning id`, [ord])).rows.length;
ok("a direct write touches zero rows (RLS filters, it does not error)", tampered, 0);

await q("rollback");
console.log(`\n${fail === 0 ? "ALL PASS" : "FAILURES"} — ${pass} passed, ${fail} failed`);
await c.end();
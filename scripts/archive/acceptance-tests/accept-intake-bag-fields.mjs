// قبول: تفاصيل الأكياس تصل فعلاً إلى سند الاستلام (لا تُهمَل بصمت)
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

const owner = (await q(`select pr.id from profiles pr join user_roles r on r.user_id=pr.id where r.role='owner' limit 1`)).rows[0].id;
const cust = (await q(`select id from customers where is_active limit 1`)).rows[0].id;
const wh = (await q(`select id from warehouses where is_active order by is_default desc limit 1`)).rows[0].id;
const grade = (await q(`select id, product_id from milling_grain_grades where is_active limit 1`)).rows[0];

// ── 1. لا يوجد حمل زائد قديم يُهمل المعاملات بصمت ──
const sigs = (await q(`select pg_get_function_identity_arguments(oid) a from pg_proc where proname='create_milling_intake'`)).rows;
ok("exactly one create_milling_intake overload remains", sigs.length, 1);
ok("and it declares the bag parameters",
  /_bag_type.*_bag_source.*_bag_condition/.test(sigs[0].a), true);
ok("the old 15-argument version is gone",
  sigs[0].a.split(",").length, 18);

await q("begin");
await q(`set local role authenticated`);
await q(`set local "request.jwt.claims" = '{"role":"authenticated","sub":"${owner}"}'`);

// ── 2. النداء بالأسماء: تفاصيل الأكياس تُحفظ فعلاً ──
const id = (await q(`
  select public.create_milling_intake(
    _store_id         => $1::uuid,
    _customer_id      => $2::uuid,
    _grain_type       => 'قمح صلب'::text,
    _grain_product_id => $3::uuid,
    _grain_grade_id   => $4::uuid,
    _bag_size_kg      => 50::numeric,
    _bag_count        => 20,
    _gross_weight_kg  => 1000::numeric,
    _tare_weight_kg   => 5::numeric,
    _moisture         => 12::numeric,
    _impurities       => 1::numeric,
    _truck_plate      => 'TEST-123',
    _driver_name      => 'سائق الاختبار',
    _silo             => 'صومعة 1',
    _notes            => 'اختبار تفاصيل الأكياس',
    _bag_type         => 'شوال خيش طبيعي 50 كجم',
    _bag_source       => 'MILL',
    _bag_condition    => 'ممزق جزئياً'::text)`, [wh, cust, grade.product_id, grade.id])).rows[0].create_milling_intake;

const r = (await q(`select bag_type, bag_source, bag_condition, intake_bag_count,
                           net_weight_kg, gross_weight_kg, tare_weight_kg
                      from milling_intake_receipts where id=$1`, [id])).rows[0];
ok("bag_type persisted", r.bag_type, "شوال خيش طبيعي 50 كجم");
ok("bag_source persisted (not silently defaulted)", r.bag_source, "MILL");
ok("bag_condition persisted", r.bag_condition, "ممزق جزئياً");
ok("net weight derived on the server", Number(r.net_weight_kg), 995);

// ── 3. النداء الموضعي القديم ما زال يعمل (التوافق الخلفي) ──
const id2 = (await q(`
  select public.create_milling_intake($1::uuid,$2::uuid,'قمح صلب'::text,$3::uuid,$4::uuid,
          50::numeric,10,500::numeric,0::numeric,11::numeric,1::numeric,
          'TEST-9','سائق','صومعة 2','بلا تفاصيل أكياس')`,
  [wh, cust, grade.product_id, grade.id])).rows[0].create_milling_intake;
const r2 = (await q(`select bag_source, bag_type from milling_intake_receipts where id=$1`, [id2])).rows[0];
ok("a positional caller still works and gets column defaults", r2.bag_source, "CUSTOMER");

// ── 4. المرجع إلزامي ──
await q("savepoint sp");
try {
  await q(`select public.create_milling_intake($1::uuid,$2::uuid,'قمح'::text,$3::uuid,null,
            50::numeric,10,500::numeric,0::numeric,11::numeric,1::numeric,'T','d','s','n')`,
    [wh, cust, grade.product_id]);
  console.log("FAIL  an intake without a grade was accepted"); fail++;
} catch (e) {
  await q("rollback to savepoint sp");
  ok("the grade is still mandatory", /grade is required/i.test(e.message), true);
}

// ── 5. الوزن الصافي لا يُقبل من المتصفح ──
await q("savepoint sp2");
try {
  await q(`select public.create_milling_intake($1::uuid,$2::uuid,'قمح'::text,$3::uuid,$4::uuid,
            50::numeric,10,0::numeric,0::numeric,11::numeric,1::numeric,'T','d','s','n')`,
    [wh, cust, grade.product_id, grade.id]);
  console.log("FAIL  a zero-weight intake was accepted"); fail++;
} catch (e) {
  await q("rollback to savepoint sp2");
  ok("a zero net weight is refused", /Net weight must be greater/i.test(e.message), true);
}

await q("rollback");
console.log(`\n${fail === 0 ? "ALL PASS" : "FAILURES"} — ${pass} passed, ${fail} failed`);
await c.end();
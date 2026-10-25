// قبول: التصنيف الخماسي + إعداد التكلفة على مستوى الشركة
// كل اختبار يعمل داخل معاملة مُلغاة، وعلى صنف مؤقت حتى لا يصطدم
// بحرّاس السياسات القائمة (products_service_cannot_be_tracked، tg_guard_item_policy_change).
import { connect } from './db-run.mjs';
const c = await connect();
await c.connect();
let pass = 0,
  fail = 0;
const ok = (l, v, want) => {
  const good = v === want;
  good ? pass++ : fail++;
  console.log(`${good ? "PASS" : "FAIL"}  ${l}  →  ${v}`);
};

// ── 1. التصنيف الفعلي في الكتالوج ──
const cls = (
  await c.query(`select item_class, count(*)::int n from products group by 1 order by 1`)
).rows;
console.table(cls);
ok(
  "bran is BY_PRODUCT",
  (await c.query(`select item_class from products where sku='FG-BRAN-40'`)).rows[0]
    .item_class,
  "BY_PRODUCT",
);
ok(
  "wheat is RAW_MATERIAL",
  (await c.query(`select item_class from products where sku='RM-WHEAT-HARD'`)).rows[0]
    .item_class,
  "RAW_MATERIAL",
);
ok(
  "milling service is SERVICE",
  (await c.query(`select item_class from products where sku='SRV-MILL-BAG50'`)).rows[0]
    .item_class,
  "SERVICE",
);
ok(
  // التعبئة نوعها PACKAGING: صنف مخزني يُشترى ويُستهلك، لا خام ولا منتج نهائي
  // (المواصفة §8). التوقع القديم RAW_MATERIAL كان حالة مرحلية خاطئة.
  "packaging is PACKAGING",
  (await c.query(`select item_class from products where sku='PKG-BAG-PP-50'`)).rows[0]
    .item_class,
  "PACKAGING",
);
// No SKU-identified item may be misclassified. The gaps view also reports
// legacy items that have no SKU at all, whose classification cannot be
// verified from data; those are expected here and counted separately, because
// asserting "zero gaps" would mean pretending they do not exist.
const gaps = (
  await c.query(`select reason from item_classification_gaps`)
).rows.map((r) => r.reason);
const unidentified = gaps.filter((r) => r.includes("بلا رمز صنف")).length;
const realMismatches = gaps.length - unidentified;
ok("no SKU-identified item is misclassified", realMismatches, 0);
if (unidentified > 0) {
  console.log(`      (${unidentified} legacy item(s) have no SKU — flagged, not guessed)`);
}

// ── 2. التتبع: صنف جديد يُشتق تصنيفه تلقائياً ──
await c.query("begin");
const ins = await c.query(`
  insert into products (sku, name, name_ar, item_nature, inventory_policy, tracking, costing_method)
  values ('PROBE-RAW','probe raw','صنف خام للاختبار','GOOD','TRACKED','BATCH','MOVING_AVERAGE')
  returning id, item_class`);
ok("new GOOD+TRACKED is classified automatically", ins.rows[0].item_class, "FINISHED_GOOD");
const probe = ins.rows[0].id;

try {
  await c.query(
    `update products set item_nature='SERVICE', inventory_policy='UNTRACKED', tracking='NONE', costing_method='NONE' where id='${probe}'`,
  );
  ok(
    "nature change drags class to SERVICE",
    (await c.query(`select item_class from products where id='${probe}'`)).rows[0]
      .item_class,
    "SERVICE",
  );
} catch (e) {
  console.log("FAIL ", e.message.slice(0, 70));
  fail++;
}

// ── 3. إعداد التكلفة على مستوى الشركة ──
ok(
  "default method is MOVING_AVERAGE",
  (await c.query(`select costing_method from company_costing_settings where id=1`))
    .rows[0].costing_method,
  "MOVING_AVERAGE",
);

await c.query("begin");
await c.query(`set local role authenticated`);
await c.query(
  `set local "request.jwt.claims" = '{"role":"authenticated","sub":"00000000-0000-0000-0000-000000000000"}'`,
);
try {
  await c.query(`select set_company_costing_method('STANDARD','CATALOGUE','probe non-staff')`);
  console.log("FAIL  non-staff allowed to switch");
  fail++;
} catch (e) {
  ok("non-staff switch rejected", /owner or manager/i.test(e.message), true);
}
await c.query("rollback");

const owner = (
  await c.query(
    `select p.id from profiles p join user_roles r on r.user_id=p.id where r.role='owner' limit 1`,
  )
).rows[0].id;
await c.query("begin");
await c.query(`set local role authenticated`);
await c.query(
  `set local "request.jwt.claims" = '{"role":"authenticated","sub":"${owner}"}'`,
);
await c.query(
  `select set_company_costing_method('STANDARD','CATALOGUE','اختبار تبديل طريقة التكلفة')`,
);
ok(
  "owner switch to STANDARD",
  (await c.query(`select costing_method from company_costing_settings where id=1`))
    .rows[0].costing_method,
  "STANDARD",
);
ok(
  "engine reads the new method",
  (await c.query(`select company_costing_method() m`)).rows[0].m,
  "STANDARD",
);
const hist = (
  await c.query(
    `select costing_method, previous_method, changed_by is not null by from costing_policy_history`,
  )
).rows;
ok("history row written", hist.length, 1);
ok("history records the previous method", hist[0].previous_method, "MOVING_AVERAGE");
ok("history attributes the change", hist[0].by, true);
try {
  await c.query(`select set_company_costing_method('WAV',null,'bad')`);
  console.log("FAIL  bad method accepted");
  fail++;
} catch (e) {
  ok("invalid method rejected", /Costing method must be/.test(e.message), true);
}
await c.query("rollback");

ok(
  "method restored after rollback",
  (await c.query(`select company_costing_method() m`)).rows[0].m,
  "MOVING_AVERAGE",
);
ok(
  "no history left behind",
  (await c.query(`select count(*)::int n from costing_policy_history`)).rows[0].n,
  0,
);

// ── 4. anon ──
await c.query("begin");
await c.query("set local role anon");
await c.query(`set local "request.jwt.claims" = '{"role":"anon"}'`);
try {
  await c.query(`select set_company_costing_method('STANDARD',null,'anon')`);
  console.log("FAIL  anon switched the method");
  fail++;
} catch (e) {
  ok("anon cannot switch the costing method", true, true);
}
await c.query("rollback");

console.log(
  `\n${fail === 0 ? "ALL PASS" : "FAILURES"} — ${pass} passed, ${fail} failed`,
);
await c.end();
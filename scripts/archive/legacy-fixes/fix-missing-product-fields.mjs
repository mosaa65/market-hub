/**
 * إصلاح المنتجات المُدخلة يدوياً والناقصة حقولها.
 *
 * الحقول الناقصة ليست تجميلاً:
 *   - بلا وحدة ⇒ لا يمكن ترحيل أي حركة مخزون على الصنف إطلاقاً.
 *   - بلا رمز (SKU) ⇒ لا يظهر في أي بحث أو تقرير بالرمز.
 *   - الاسم الإنجليزي يحمل العربي ⇒ يظهر الاسم مرتين على البطاقة.
 *
 * آمن للتكرار: لا يكتب شيئاً إن كان الحقل مملوءاً أصلاً.
 */
import { connect } from "./db-run.mjs";

const c = await connect();
await c.connect();
const q = async (sql, params = []) => (await c.query(sql, params)).rows;

console.log("🛠  استكمال بيانات المنتجات الناقصة\n");

await q("BEGIN");

// 1) الاسم الإنجليزي الذي يكرّر العربي أو يحمل حروفاً عربية
const cleared = await q(
  `update products set name = null
    where name is not null
      and (btrim(name) = btrim(coalesce(name_ar, '')) or name ~ '[\\u0600-\\u06FF]')
  returning sku, name_ar`,
);
for (const r of cleared) console.log(`   ✅ أُفرغ الاسم الإنجليزي المكرر — ${r.name_ar ?? r.sku}`);

// 2) وحدة لكل منتج نشط بلا وحدة.
//    الوحدة الافتراضية للمطحنة هي الكيلوجرام: لا منتج مخزني يُقاس بلا وحدة.
const kg = (await q(`select id, short_name from units where short_name = 'كجم' limit 1`))[0];
if (!kg) {
  console.log("   ⚠️  وحدة «كجم» غير موجودة — تخطّي ضبط الوحدات");
} else {
  const filled = await q(
    `update products set unit_id = $1
      where unit_id is null and is_active
    returning coalesce(sku, name_ar) as label, item_class::text as cls`,
    [kg.id],
  );
  for (const r of filled) console.log(`   ✅ ضُبطت الوحدة (كجم) — ${r.label} [${r.cls}]`);
}

// 3) رمز صنف لكل منتج بلا رمز.
//    الرمز يُبنى من نوع الصنف حتى يبقى مفهوماً عند القراءة في التقارير.
const noSku = await q(
  `select id, name_ar, item_class::text as cls from products
    where sku is null or btrim(sku) = '' order by created_at`,
);
for (const p of noSku) {
  const prefix =
    p.cls === "RAW_MATERIAL"
      ? "RM"
      : p.cls === "BY_PRODUCT"
        ? "BP"
        : p.cls === "SERVICE"
          ? "SRV"
          : p.cls === "NON_STOCK_ITEM"
            ? "PKG"
            : "FP";
  // لاحقة قصيرة من آخر المعرّف: فريدة بلا الاعتماد على اسم عربي.
  const suffix = p.id.replace(/-/g, "").slice(0, 5).toUpperCase();
  let candidate = `${prefix}-${suffix}`;
  let attempt = 0;
  // لو صادف الرمز صنفاً قائماً، أضف رقماً حتى يصبح حرّاً.
  while ((await q(`select 1 from products where sku = $1`, [candidate])).length) {
    attempt += 1;
    candidate = `${prefix}-${suffix}${attempt}`;
  }
  await q(`update products set sku = $1 where id = $2`, [candidate, p.id]);
  console.log(`   ✅ أُضيف رمز ${candidate} — ${p.name_ar ?? p.id}`);
}

await q("COMMIT");

// التحقق
const rest = (await q(`
  select
    (select count(*) from products where name ~ '[\\u0600-\\u06FF]')::int                  as en_arabic,
    (select count(*) from products where sku is null or btrim(sku)='')::int                as no_sku,
    (select count(*) from products where is_active and unit_id is null)::int              as no_unit,
    (select count(*) from products
      where inventory_policy='TRACKED' and sale_price > 0 and coalesce(cost_price,0)=0)::int as no_cost
`))[0];

console.log("\n── المتبقي ──");
console.log(`   اسم إنجليزي بالعربية: ${rest.en_arabic}`);
console.log(`   بلا رمز صنف        : ${rest.no_sku}`);
console.log(`   بلا وحدة قياس      : ${rest.no_unit}`);
console.log(`   بسعر بلا تكلفة      : ${rest.no_cost}`);

await c.end();
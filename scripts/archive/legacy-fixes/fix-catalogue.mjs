/**
 * إصلاحات الفهرس — تُشغَّل مرة واحدة، آمنة للتكرار.
 *
 * كل تعديل هنا سببه تناقض أكّده `scripts/audit-catalogue.mjs`، لا رأي شخصي:
 *   1. الاسم الإنجليزي يحمل النص العربي نفسه (18 صنفاً) — فيظهر مرتين.
 *   2. صنفان بلا SKU بعد حذفDiagnosis زملائهما، وبهما ارتباط بسجلات.
 *   3. أكياس التعبئة مسمّاة "تعبئة دقيق" وهي تُستعمل لكل منتجات المطحنة.
 *   4. "شوال" مترجَم Bag، وكلمة كيس تُستعمل لغير الشوال.
 *   5. خدمة قابلة للشراء — الخدمة تُباع ولا تُشترى.
 *   6. وحدة "كيس 40 كجم" غير مستخدمة.
 */
import { connect } from "./db-run.mjs";

const c = await connect();
await c.connect();

const q = async (sql, params = []) => (await c.query(sql, params)).rows;
let fixes = 0;
const done = (label, n) => {
  if (n > 0) {
    fixes += n;
    console.log(`   ✅ ${label} (${n})`);
  }
};

console.log("🛠  إصلاح الفهرس\n");

await q("BEGIN");

// ── 1. الاسم الإنجليزي الذي يكرّر العربي ──────────────────────────────────
const dupName = await q(
  `update products set name = null
    where name is not null and btrim(name) <> ''
      and name_ar is not null and btrim(name_ar) = btrim(name)`,
);
done("حُذف الاسم الإنgresqlي المكرر", dupName.length);

// ── 2. SKU للصنفين اللذين فقدا معرّفهما ──────────────────────────────────
for (const [sku, nameAr] of [
  ["RM-WHEAT-HARD", "قمح صلب مستورد (درجة أولى)"],
  ["SRV-MILL-TON", "أجرة طحن بالطن الواحد"],
]) {
  const exists = await q(`select 1 from products where sku = $1`, [sku]);
  if (exists.length) continue;
  const r = await q(`update products set sku = $1 where name_ar = $2 returning id`, [sku, nameAr]);
  done(`أُعيد رمز ${sku}`, r.length);
}

// ── 3. أسماء مستلزمات التعبئة: ليست "لدقيق" تحديداً ──────────────────────
for (const [nameAr, sku] of [
  ["كيس تعبئة 10 كجم", "PKG-BAG-10"],
  ["كيس تعبئة 25 كجم", "PKG-BAG-25"],
  ["شوال تعبئة 50 كجم", "PKG-BAG-50"],
  ["خيط خياطة وتغليق أكياس", "PKG-THREAD"],
]) {
  const r = await q(`update products set name_ar = $1 where sku = $2 returning id`, [nameAr, sku]);
  done(`سُمّي ${nameAr}`, r.length);
}

// ── 4. الوحدات: الشوال شوال، والرموز بالعربية ───────────────────────────
// short_name هو ما يُعرض كاختصار في كل الشاشات؛ كان خليطاً من رموز إنجليزية
// ("ك" لأكياس 10 و25 كجم) وأسماء كاملة ("قطعة")، فبدا غير متجانس.
const unitFixes = [
  // [الرمز القديم, name_en, name_ar, الاختصار المعروض]
  ["BAG-10", "Bag 10 kg", "كيس 10 كجم", "ك"],
  ["BAG-25", "Bag 25 kg", "كيس 25 كجم", "ك"],
  ["BAG-50", "Sack 50 kg", "شوال 50 كجم", "ش"],
  ["kg", "Kilogram", "كيلوجرام", "كجم"],
  ["t", "Metric ton", "طن متري", "طن"],
  ["قطعة", "Piece", "قطعة", "ق"],
];
for (const [old, nameEn, nameAr, symbol] of unitFixes) {
  const r = await q(
    `update units set name = $1, name_ar = $2, short_name = $3 where short_name = $4 returning id`,
    [nameEn, nameAr, symbol, old],
  );
  done(`وحدة ${symbol} (${nameAr})`, r.length);
}

// الوحدة غير المستخدمة: تُحذف فقط إن لم يشر إليها أي صنف
const orphanUnit = await q(
  `select short_name from units u
    where not exists (select 1 from products p
            where p.unit_id=u.id or p.purchase_uom_id=u.id or p.sales_uom_id=u.id)`,
);
for (const u of orphanUnit) {
  const r = await q(`delete from units where short_name = $1 returning id`, [u.short_name]);
  done(`حُذفت الوحدة غير المستخدمة ${u.short_name}`, r.length);
}

// ── 5. الخدمة تُباع ولا تُشترى ────────────────────────────────────────────
const svc = await q(
  `update products set is_purchasable = false where item_class = 'SERVICE' and is_purchasable`,
);
done("خدمات ضُبطت على غير قابلة للشراء", svc.length);

// ── 6. تصنيف بلا منتجات: يُزال لأنه لا يمثّل شيئاً في الفهرس ────────────
const emptyCats = await q(
  `select c.id, c.name_ar from categories c
    where not exists (select 1 from products p where p.category_id=c.id)`,
);
for (const cat of emptyCats) {
  const r = await q(`delete from categories where id = $1 returning id`, [cat.id]);
  done(`حُذف التصنيف الفارغ «${cat.name_ar}»`, r.length);
}

await q("COMMIT");

// ── التقرير ───────────────────────────────────────────────────────────────
console.log(`\nالإصلاحات: ${fixes}\n`);
const rest = await q(`
  select
    (select count(*) from products where name ~ '[\\u0600-\\u06FF]')::int            as en_arabic,
    (select count(*) from products where coalesce(btrim(name_ar),'') = '')::int        as no_name,
    (select count(*) from products where sku is null or btrim(sku)='')::int             as no_sku,
    (select count(*) from products where is_active and unit_id is null)::int           as no_unit,
    (select count(*) from products where item_class='SERVICE' and is_purchasable)::int as purchasable_service,
    (select count(*) from units u where not exists (
        select 1 from products p
         where p.unit_id=u.id or p.purchase_uom_id=u.id or p.sales_uom_id=u.id))::int as unused_units
`);
console.table(rest);

await c.end();
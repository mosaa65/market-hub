/**
 * تدقيق الفهرس: يرصد التناقضات بين المنتجات والوحدات والتصنيفات قبل التسليم.
 * للتشغيل:  node scripts/audit-catalogue.mjs
 */
import { connect } from "./db-run.mjs";

const c = await connect();
await c.connect();

const problems = [];
const note = (area, detail) => problems.push({ area, detail });

// 1) الاسم الإنجليزي يحمل نصاً عربياً
for (const r of (
  await c.query(
    `select sku, name, name_ar from products
      where name is not null and btrim(name) <> ''
        and name ~ '[\\u0600-\\u06FF]'`,
  )
).rows)
  note("اسم إنجليزي بالعربية", `${r.sku}: "${r.name}"`);

// 2) الاسم العربي فيه اسم إنجليزي
for (const r of (
  await c.query(
    `select sku, name_ar from products
      where name_ar is not null and btrim(name_ar) <> ''
        and name_ar !~ '[\\u0600-\\u06FF]'`,
  )
).rows)
  note("اسم عربي بلا حروف عربية", `${r.sku}: "${r.name_ar}"`);

// 3) بدون اسم
for (const r of (
  await c.query(
    `select coalesce(sku, id::text) k from products
      where coalesce(btrim(name_ar), btrim(name), '') = ''`,
  )
).rows)
  note("بلا اسم", `${r.k}`);

// 4) وحدة غير موجودة
for (const r of (
  await c.query(
    `select coalesce(sku, id::text) k from products where unit_id is null and is_active`,
  )
).rows)
  note("بلا وحدة قياس", `${r.k}`);

// 5) تصنيف غير موجود
for (const r of (
  await c.query(`select coalesce(sku, id::text) k from products where category_id is null and is_active`)
).rows)
  note("بلا تصنيف", `${r.k}`);

// 6) خدمة قابلة للشراء
for (const r of (
  await c.query(
    `select sku, item_class::text from products
      where item_class = 'SERVICE' and is_purchasable`,
  )
).rows)
  note("خدمة قابلة للشراء", `${r.sku} (${r.item_class})`);

// 7) خدمة متتبَّعة بالمخزون (المحرك يرفض رصيداً لها)
for (const r of (
  await c.query(
    `select sku from products where item_class='SERVICE' and inventory_policy <> 'UNTRACKED'`,
  )
).rows)
  note("خدمة بسياسة مخزون", `${r.sku}`);

// 8) سلعة غير قابلة للبيع ولا الشراء
for (const r of (
  await c.query(
    `select sku from products where not is_sellable and not is_purchasable`,
  )
).rows)
  note("غير قابل للبيع ولا الشراء", `${r.sku}`);

// 9) سعر بيع بدون تكلفة على صنف مخزني
for (const r of (
  await c.query(
    `select sku, sale_price, cost_price from products
      where inventory_policy='TRACKED' and sale_price > 0 and coalesce(cost_price,0)=0`,
  )
).rows)
  note("مخزني بلا تكلفة", `${r.sku} (بيع ${r.sale_price})`);

// 10) وحدات غير مستخدمة
for (const r of (
  await c.query(
    `select u.short_name, u.name_ar from units u
      where not exists (select 1 from products p
              where p.unit_id=u.id or p.purchase_uom_id=u.id or p.sales_uom_id=u.id)`,
  )
).rows)
  note("وحدة غير مستخدمة", `${r.short_name} (${r.name_ar})`);

// 11) الاسم العربي/الإنجليزي للوحدة غير متوافقين
for (const r of (
  await c.query(
    `select short_name, name, name_ar from units
      where (name_ar like '%شوال%' and name not ilike '%sack%')
         or (name_ar not like '%شوال%' and name ilike '%sack%')`,
  )
).rows)
  note("ترجمة وحدة غير متطابقة", `${r.short_name}: "${r.name}" / "${r.name_ar}"`);

// 12) تصنيفات فارغة
for (const r of (
  await c.query(
    `select c.id, c.name_ar from categories c
      where not exists (select 1 from products p where p.category_id=c.id)`,
  )
).rows)
  note("تصنيف بلا منتجات", `${r.name_ar}`);

// 13) باركود مكرر
for (const r of (
  await c.query(
    `select barcode, count(*) n from products
      where barcode is not null and btrim(barcode)<>'' group by 1 having count(*)>1`,
  )
).rows)
  note("باركود مكرر", `${r.barcode} × ${r.n}`);

// 14) SKU مكرر
for (const r of (
  await c.query(
    `select sku, count(*) n from products
      where sku is not null and btrim(sku)<>'' group by 1 having count(*)>1`,
  )
).rows)
  note("SKU مكرر", `${r.sku} × ${r.n}`);

// 15) سعر بيع بلا وحدة (المخزون بلا معنى)
for (const r of (
  await c.query(
    `select p.sku from products p left join units u on u.id=p.unit_id
      where p.inventory_policy='TRACKED' and u.id is null`,
  )
).rows)
  note("صنف مخزني بلا وحدة", `${r.sku}`);

// 16. درجات الحبوب: منتج مفقود أو درجة خدمة غير موجودة
for (const r of (
  await c.query(
    `select g.grade_code, g.grade_name_ar from milling_grain_grades g
      left join products p on p.id = g.product_id
      where g.product_id is not null and p.id is null`,
  )
).rows)
  note("درجة حبوب بلا منتج", `${r.grade_code} (${r.grade_name_ar})`);

for (const r of (
  await c.query(
    `select g.grade_code, g.default_service_sku from milling_grain_grades g
      where g.default_service_sku is not null
        and not exists (select 1 from products p where p.sku = g.default_service_sku)`,
  )
).rows)
  note("درجة تشير إلى خدمة غير موجودة", `${r.grade_code} → ${r.default_service_sku}`);

// 17. درجة حبوب مكرّرة لنفس المنتج
for (const r of (
  await c.query(
    `select product_id, count(*) n from milling_grain_grades
      where product_id is not null group by 1 having count(*)>1`,
  )
).rows)
  note("أكثر من درجة لنفس المنتج", `${r.product_id} (${r.n})`);

// 18. رصيد مخزون بلا حركة مصدره
for (const r of (
  await c.query(
    `select p.sku, i.quantity from inventory i join products p on p.id=i.product_id
      where i.quantity <> 0
        and not exists (select 1 from stock_movements m where m.product_id=i.product_id)`,
  )
).rows)
  note("رصيد بلا حركة", `${r.sku}: ${r.quantity}`);

console.log(`\nعدد الملاحظات: ${problems.length}\n`);
const byArea = {};
for (const p of problems) (byArea[p.area] ??= []).push(p.detail);
for (const [area, list] of Object.entries(byArea)) {
  console.log(`── ${area} (${list.length})`);
  for (const d of list) console.log(`   • ${d}`);
  console.log();
}

await c.end();
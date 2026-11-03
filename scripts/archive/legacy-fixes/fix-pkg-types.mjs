// إصلاح نوع العبوة لأصناف التعبئة — تحديث مع إظهار عدد الصفوف والنتيجة.
import { connect } from './db-run.mjs';

const client = await connect();
await client.connect();

const res = await client.query(`
  UPDATE products
     SET package_type_id = (
       SELECT pt.id FROM packaging_types pt
        WHERE pt.code = CASE
                WHEN products.name_ar LIKE '%شوال%' THEN 'SACK'
                WHEN products.name_ar LIKE '%كيس%'  THEN 'BAG'
                ELSE NULL
              END
        LIMIT 1
     )
   WHERE item_class = 'PACKAGING'
     AND name_ar ~ '[0-9]'
`);
console.log('rowCount:', res.rowCount);

const v = await client.query(`
  SELECT p.sku, pt.name_ar AS pkg_type, p.package_weight_kg
    FROM products p LEFT JOIN packaging_types pt ON pt.id = p.package_type_id
   WHERE p.sku LIKE 'PKG-%' ORDER BY p.sku`);
console.log(v.rows);
await client.end();

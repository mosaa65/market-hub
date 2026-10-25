// فحص تهيئة: هل استعلام الإثراء (category/brand/unit) يعمل تحت دور authenticated؟
import { connect } from "./db-run.mjs";

const c = await connect();
await c.connect();

const owner = (
  await c.query(
    `SELECT pr.id FROM profiles pr JOIN user_roles r ON r.user_id=pr.id WHERE r.role='owner' LIMIT 1`,
  )
).rows[0]?.id;

await c.query("BEGIN");
await c.query(`SET LOCAL role authenticated`);
await c.query(
  `SET LOCAL "request.jwt.claims" = '{"role":"authenticated","sub":"${owner}"}'`,
);

const sel = `SELECT p.sku,
      p.category_id,
      cat.name_ar AS category,
      u.short_name AS unit
     FROM products p
     LEFT JOIN categories cat ON cat.id = p.category_id
     LEFT JOIN units u ON u.id = p.unit_id
    WHERE p.is_active
    ORDER BY p.sku`;

const r = await c.query(sel);
console.table(r.rows);

const missing = r.rows.filter((x) => !x.category);
console.log(`بدون تصنيف: ${missing.length} من ${r.rows.length}`);
console.log(`بدون وحدة : ${r.rows.filter((x) => !x.unit).length}`);

await c.query("ROLLBACK");
await c.end();
import { connect } from './db-run.mjs';

const c = await connect();
await c.connect();
await c.query('BEGIN');
try {
  const adminUser = (await c.query(`SELECT id FROM auth.users LIMIT 1`)).rows[0]?.id;
  await c.query(`SELECT set_config('request.jwt.claim.sub', $1, true)`, [adminUser]);

  const wh = (await c.query(`SELECT id FROM public.warehouses WHERE is_active LIMIT 1`)).rows[0].id;

  // منتجا اختبار: حبوب (مصدر) + دقيق (ناتج)
  const src = await c.query(
    `INSERT INTO public.products (name,name_ar,item_class,item_nature,inventory_policy,is_active,cost_price,sale_price)
     VALUES ('CV-SRC','حبوب اختبار','RAW_MATERIAL','GOOD','TRACKED',true,100,150) RETURNING id`);
  const out = await c.query(
    `INSERT INTO public.products (name,name_ar,item_class,item_nature,inventory_policy,is_active,cost_price,sale_price)
     VALUES ('CV-OUT','دقيق اختبار','FINISHED_GOOD','GOOD','TRACKED',true,120,180) RETURNING id`);
  const srcId = src.rows[0].id;
  const outId = out.rows[0].id;

  // مخزون مصدر: 100 وحدة
  await c.query(
    `SELECT public.post_stock_delta($1,$2,100,NULL,'RECEIPT'::public.stock_movement_kind,'t',gen_random_uuid(),'t','COMPANY'::public.owner_type,NULL,'purchase'::public.movement_type)`,
    [srcId, wh]);

  // التحويل: 100 وحدة ← 90 ناتج + فاقد 10
  const r = await c.query(
    `SELECT public.convert_stock($1,$2,100,$3::jsonb,10,'اختبار V1') AS ref`,
    [wh, srcId, JSON.stringify([{ item_id: outId, qty: 90 }])]);
  console.log('CONVERT OK:', r.rows[0].ref);

  // التحقق من الأرصدة
  const bal = await c.query(
    `SELECT product_id, quantity FROM public.inventory WHERE product_id IN ($1,$2) AND warehouse_id=$3 ORDER BY product_id`,
    [srcId, outId, wh]);
  for (const row of bal.rows) console.log('  balance:', row.product_id === srcId ? 'SRC' : 'OUT', '=', row.quantity);

  // محاولة تحويل غير متوازن (يجب أن يرفض)
  try {
    await c.query(`SELECT public.convert_stock($1,$2,50,$3::jsonb,0,'refused test')`, [wh, srcId, JSON.stringify([{ item_id: outId, qty: 40 }])]);
    console.log('UNBALANCED: NOT REFUSED (BUG!)');
  } catch (e) {
    console.log('UNBALANCED REFUSED ✓:', e.message);
  }
} catch (e) {
  console.log('TEST ERROR:', e.message);
} finally {
  await c.query('ROLLBACK');
  await c.end();
}

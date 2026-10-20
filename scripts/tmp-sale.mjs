import { connect } from './db-run.mjs';

const c = await connect();
await c.connect();
await c.query('BEGIN');
try {
  await c.query(`SELECT set_config('app.verify','on',true)`);
  const wh = (await c.query(`SELECT id FROM public.warehouses WHERE is_active LIMIT 1`)).rows[0].id;
  const p = await c.query(
    `INSERT INTO public.products (name,name_ar,item_class,item_nature,inventory_policy,is_active,is_sellable,cost_price,sale_price)
     VALUES ('T','T','FINISHED_GOOD','GOOD','TRACKED',true,true,10,30) RETURNING id`,
  );
  const pid = p.rows[0].id;
  await c.query(
    `SELECT public.post_stock_delta($1,$2,10,10,'RECEIPT'::public.stock_movement_kind,'t',gen_random_uuid(),'t','COMPANY'::public.owner_type,NULL,'purchase'::public.movement_type)`,
    [pid, wh],
  );
  const r = await c.query(
    `SELECT public.create_sale($1,NULL,'cash',60,0,'t',$2::jsonb) AS id`,
    [wh, JSON.stringify([{ product_id: pid, quantity: 2, unit_price: 30, tax_rate: 0 }])],
  );
  console.log('SALE OK', r.rows[0].id);
} catch (e) {
  console.log('SALE ERROR:', e.message);
  console.log('HINT:', e.hint ?? '');
  console.log('DETAIL:', e.detail ?? '');
  console.log('CTX:', e.where ?? '');
} finally {
  await c.query('ROLLBACK');
  await c.end();
}

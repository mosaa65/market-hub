// قبول: RLS/GRANT على العمود الفقري للمخزون — كمستخدم حقيقي وكمُسجّل دخول وكمجهول
import { connect } from './db-run.mjs';
const c = await connect();
await c.connect();

const staff = (await c.query(`
 select p.id from profiles p join user_roles r on r.user_id=p.id
 where p.is_active and r.role in ('owner','manager','warehouse','accountant') limit 1`)).rows[0];

const probes = [
  'select count(*)::int n from stock_positions',
  'select count(*)::int n from inventory',
  'select count(*)::int n from stock_movements',
  'select count(*)::int n from stock_openings',
  'select count(*)::int n from milling_customer_custody',
];

async function as(role, uid) {
  await c.query('begin');
  await c.query(`set local role ${role}`);
  await c.query(`set local "request.jwt.claims" = '{"role":"${role}","sub":"${uid || '00000000-0000-0000-0000-000000000000'}"}'`);
  const out = [];
  for (const sql of probes) {
    try { const r = await c.query(sql); out.push(`${sql.split(' from ')[1]}=${r.rows[0].n}`); }
    catch (e) { out.push(`${sql.split(' from ')[1]}=DENIED`); }
  }
  await c.query('rollback');
  return out.join('  ');
}

console.log('anon            :', await as('anon'));
console.log('authenticated(0):', await as('authenticated'));
console.log('staff           :', await as('authenticated', staff.id));

// كتابة: anon يجب أن تُرفض تماماً على العمود الفقري
await c.query('begin');
await c.query('set local role anon');
await c.query(`set local "request.jwt.claims" = '{"role":"anon"}'`);
for (const sql of [
  "insert into stock_movements (product_id, warehouse_id, movement_type, quantity) select id, (select id from warehouses limit 1), 'adjustment', 1 from products limit 1",
  'update inventory set quantity = quantity + 1',
  'delete from stock_movements',
]) {
  try { await c.query(sql); console.log('anon write ALLOWED <<< GAP:', sql.slice(0, 50)); }
  catch (e) { console.log('anon write DENIED:', sql.slice(0, 50)); }
}
await c.query('rollback');
await c.end();
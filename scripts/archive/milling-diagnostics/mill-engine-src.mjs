import { connect } from './db-run.mjs';
const c = await connect();
await c.connect();
const r = await c.query(`select proname, prosrc from pg_proc where proname in ('post_stock_delta','post_opening_stock') order by 1`);
for (const row of r.rows) {
  console.log('\n########## ' + row.proname);
  console.log(row.prosrc);
}
const e = await c.query(`select e.enumlabel from pg_type t join pg_enum e on e.enumtypid=t.oid where t.typname in ('item_nature','inventory_policy','stock_movement_kind') order by t.typname, e.enumsortorder`);
console.table(e.rows);
const cols = await c.query(`select table_name, column_name, data_type from information_schema.columns where table_schema='public' and table_name in ('stock_adjustments','stock_movements') order by table_name, ordinal_position`);
console.table(cols.rows);
await c.end();
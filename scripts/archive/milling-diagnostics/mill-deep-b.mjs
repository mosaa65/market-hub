import { connect } from './db-run.mjs';

const c = await connect();
await c.connect();
const q = async (l, s) => {
  try { const r = await c.query(s); console.log(`\n=== ${l} ===`); console.table(r.rows); }
  catch (e) { console.log(`\n=== ${l} === ERR ${e.message}`); }
};

await q('all public functions', `select p.proname,
 pg_get_function_identity_arguments(p.oid) args
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' order by 1`);

await q('stock_openings cols', `select column_name, data_type, is_nullable, column_default from information_schema.columns
 where table_schema='public' and table_name='stock_openings' order by ordinal_position`);
await q('stock_opening_items cols', `select column_name, data_type from information_schema.columns
 where table_schema='public' and table_name='stock_opening_items' order by ordinal_position`);

await q('stock_adjustments cols', `select column_name, data_type from information_schema.columns
 where table_schema='public' and table_name='stock_adjustments' order by ordinal_position`);

await q('company_settings full', `select * from company_settings`);

await q('customer_ledger cols', `select column_name, data_type from information_schema.columns
 where table_schema='public' and table_name='customer_ledger' order by ordinal_position`);

await q('item_nature enum labels now', `select e.enumlabel from pg_type t join pg_enum e on e.enumtypid=t.oid
 join pg_namespace n on n.oid=t.typname::regnamespace where n.nspname='public' and t.typname='item_nature' order by e.enumsortorder`);

await c.end();
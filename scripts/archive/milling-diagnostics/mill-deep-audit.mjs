// جرد عميق للبنية المحاسبية والمخزنية القائمة قبل بناء محرك التكلفة والإنتاج
import { connect } from './db-run.mjs';

const c = await connect();
await c.connect();
const q = async (l, s) => {
  try { const r = await c.query(s); console.log(`\n=== ${l} ===`); console.table(r.rows); }
  catch (e) { console.log(`\n=== ${l} === ERR ${e.message}`); }
};

// ──Accounting spine ──
await q('journal/ledger tables', `select table_name from information_schema.tables where table_schema='public'
 and (table_name like '%journal%' or table_name like '%ledger%' or table_name like '%entry%' or table_name like '%opening%'
   or table_name like '%account%' or table_name like '%balance%') order by 1`);

await q('table sizes', `select c.relname,
 (select count(*) from pg_class x where x.relname=c.relname) as _
 from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname='public' and c.relkind='r' order by 1`);

await q('accounting functions', `select proname, pg_get_function_identity_arguments(oid) args from pg_proc
 join pg_namespace n on n.oid=pronamespace where n.nspname='public'
 and (proname like '%entry%' or proname like '%journal%' or proname like '%opening%' or proname like '%post_%')
 order by 1`);

await q('stock engine functions', `select proname, pg_get_function_identity_arguments(oid) args from pg_proc
 join pg_namespace n on n.oid=pronamespace where n.nspname='public'
 and (proname like '%stock%' or proname like '%movement%' or proname like '%position%' or proname like 'post_%')
 order by 1`);

await q('stock_posting core functions', `select proname, pg_get_function_identity_arguments(oid) args, prosrc
 from pg_proc join pg_namespace n on n.oid=pronamespace where n.nspname='public'
 and proname in ('post_stock_movement','apply_stock_movement','record_stock_movement')`);

await q('company_settings', `select column_name, data_type from information_schema.columns where table_schema='public' and table_name='company_settings' order by ordinal_position`);
await q('company_settings row', `select * from company_settings limit 1`);

await c.end();
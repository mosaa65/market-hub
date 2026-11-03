// فحص دقيق: تعدد تعريف create_milling_intake + واجهة المنتجات
import fs from 'node:fs';
import dns from 'node:dns';
import pg from 'pg';

const env = Object.fromEntries(
  fs.readFileSync('.env', 'utf8').split(/\r?\n/)
    .filter((l) => l && !l.trim().startsWith('#') && l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
);
const projectRef = fs.readFileSync('supabase/.temp/project-ref', 'utf8').trim();
const region = fs.readFileSync('supabase/.temp/pooler-url', 'utf8').match(/aws-\d+-([a-z0-9-]+)\.pooler/)[1];
const ok = await new Promise((r) => dns.lookup(env.SUPABASE_DB_HOST, (e) => r(!e)));
const base = ok
  ? { host: env.SUPABASE_DB_HOST, port: +env.SUPABASE_DB_PORT, database: env.SUPABASE_DB_NAME, user: env.SUPABASE_DB_USER }
  : { host: `aws-0-${region}.pooler.supabase.com`, port: 5432, database: 'postgres', user: `postgres.${projectRef}` };
const client = new pg.Client({ ...base, password: env.SUPABASE_DB_PASSWORD, ssl: { rejectUnauthorized: false } });
const q = async (label, sql) => {
  try { const r = await client.query(sql); console.log(`\n=== ${label} ===`); console.table(r.rows); }
  catch (e) { console.log(`\n=== ${label} === ERROR: ${e.message}`); }
};
await client.connect();

await q('intake overloads', `select oid::regprocedure sig, prorettype::regtype ret, prosrc is not null has_body
 from pg_proc where proname='create_milling_intake'`);

await q('ambiguous functions (same name >1)', `select proname, count(*) n, array_agg(oid::regprocedure::text order by oid::regprocedure::text) sigs
 from pg_proc join pg_namespace n on n.oid=pronamespace
 where n.nspname='public' group by proname having count(*)>1 order by proname`);

await q('view security definer + grants', `select table_name, is_security_barrier, (select count(*) from information_schema.views v where v.table_name=c.table_name) ok
 from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname='public' and c.relkind='v' and c.relname like 'milling%'`);

await q('milling grants', `select table_name, grantee, privilege_type from information_schema.role_table_grants
 where table_schema='public' and table_name like 'milling%' and grantee in ('anon','authenticated','service_role') order by table_name, grantee, privilege_type`);

await q('stock positions summary', `select p.sku, p.name_ar, sp.warehouse_name_ar, sp.owner_type, sp.quantity, sp.inventory_policy
 from stock_positions sp join products p on p.sku=sp.sku order by p.sku limit 30`);

await q('openings/adjustments', `select (select count(*) from stock_openings) openings, (select count(*) from stock_adjustments) adjustments, (select count(*) from stock_movements) movements`);

await q('milling intake silo field', `select column_name, data_type from information_schema.columns where table_schema='public' and table_name='milling_intake_receipts' order by ordinal_position`);

await client.end();
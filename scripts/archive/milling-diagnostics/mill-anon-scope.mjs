// نطاق تسريب anon: هل هو خاص بالمطحنة أم المشروع كله؟
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
const c = new pg.Client({ ...base, password: env.SUPABASE_DB_PASSWORD, ssl: { rejectUnauthorized: false } });
await c.connect();

const r = await c.query(`
 select table_name, (select relrowsecurity from pg_class x where x.relname = table_name) rls
 from information_schema.role_table_grants
 where table_schema='public' and grantee='anon' and privilege_type='SELECT'
 order by table_name`);
console.log('tables readable by anon:', r.rows.length);
const milling = r.rows.filter((x) => x.table_name.startsWith('milling'));
const core = ['customers', 'products', 'sales_invoices', 'stock_positions', 'expenses'];
console.log('milling tables readable by anon:', milling.map((x) => x.table_name).join(', '));
for (const t of core) {
  const row = r.rows.find((x) => x.table_name === t);
  console.log(`${t}: anon SELECT = ${!!row}, rls = ${row?.rls}`);
}
// كم جدولاً إجمالاً بلا RLS مع grant لـ anon
const total = await c.query(`select count(*)::int n from information_schema.tables where table_schema='public'`);
console.log('public tables total:', total.rows[0].n);
await c.end();
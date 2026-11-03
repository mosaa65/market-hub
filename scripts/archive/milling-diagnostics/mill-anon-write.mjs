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

const tests = [
  ["anon UPDATE existing row", "update milling_grain_grades set max_moisture = 1 where id = (select id from milling_grain_grades limit 1) returning id"],
  ["anon INSERT", "insert into milling_grain_grades (product_id, grade_code, grade_name_ar, max_moisture, max_impurities) select id, 'PROBE', 'PROBE', 1, 1 from products limit 1 returning id"],
  ["anon DELETE", "delete from milling_grain_grades where grade_code = 'PROBE' returning id"],
  ["anon INSERT into jobs", "insert into milling_jobs (job_number, store_id, customer_id, intake_receipt_id, input_weight_kg) select 'PROBE', store_id, customer_id, id, 1 from milling_intake_receipts limit 1 returning id"],
  ["anon UPDATE job_outputs", "update milling_job_outputs set produced_weight_kg = 1 where true returning id"],
];
for (const [label, sql] of tests) {
  await c.query('begin');
  await c.query('set local role anon');
  await c.query(`set local "request.jwt.claims" = '{"role":"anon"}'`);
  try {
    const r = await c.query(sql);
    console.log(`${label}: ALLOWED rows=${r.rows.length}`);
  } catch (e) {
    console.log(`${label}: DENIED ${e.message.slice(0, 70)}`);
  }
  await c.query('rollback');
}
// فحص عام: جداول بلا RLS يُكتب إليها anon
const g = await c.query(`
 select table_name from information_schema.role_table_grants
 where table_schema='public' and grantee='anon'
   and privilege_type in ('INSERT','UPDATE','DELETE')
   and table_name not in (select table_name from information_schema.views where table_schema='public')
 order by 1`);
console.log('\nanon write grants on tables:', g.rows.map((x) => x.table_name).join(', ') || '(none)');
await c.end();
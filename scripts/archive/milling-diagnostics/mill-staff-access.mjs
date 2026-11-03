// تحقق بوصول موظف حقيقي:-policy is_staff تعتمد auth.uid
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

const staff = await c.query(`
 select p.id, r.role from profiles p
 join user_roles r on r.user_id = p.id
 where p.is_active and r.role in ('owner','manager','accountant','warehouse')
 limit 3`);
console.table(staff.rows);

for (const u of staff.rows) {
  for (const sql of [
    'select count(*) n from milling_grain_grades',
    'select count(*) n from milling_grain_grades_view',
    'select count(*) n from milling_intake_receipts',
    'select count(*) n from milling_customer_custody',
  ]) {
    await c.query('begin');
    await c.query('set local role authenticated');
    await c.query(`set local "request.jwt.claims" = '{"role":"authenticated","sub":"${u.id}","email":"staff@example.test"}'`);
    try {
      const r = await c.query(sql);
      console.log(`${u.role} | ${sql} => ${r.rows[0].n}`);
    } catch (e) {
      console.log(`${u.role} | ${sql} => DENIED ${e.message.slice(0, 60)}`);
    }
    await c.query('rollback');
  }
}
await c.end();
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
const admin = new pg.Client({ ...base, password: env.SUPABASE_DB_PASSWORD, ssl: { rejectUnauthorized: false } });
await admin.connect();

const run = async (role, text) => {
  await admin.query('begin');
  await admin.query(`set local role ${role}`);
  await admin.query(`set local "request.jwt.claims" = '{"role":"${role}","sub":"00000000-0000-0000-0000-000000000000","email":"probe@example.test"}'`);
  try {
    const r = await admin.query(text);
    console.log(`${role} | ${text} => ${JSON.stringify(r.rows).slice(0, 160)}`);
  } catch (e) {
    console.log(`${role} | ${text} => DENIED ${e.message.slice(0, 70)}`);
  }
  await admin.query('rollback');
};

const targets = [
  'select count(*) n from milling_customer_custody',
  'select count(*) n from milling_revenue_report',
  'select count(*) n from milling_service_money',
  'select count(*) n from milling_intake_receipts',
  'select count(*) n from milling_jobs',
  'select count(*) n from milling_efficiency_report',
  'select count(*) n from milling_output_balances',
  'select count(*) n from milling_pricing_diagnostics',
  'select count(*) n from milling_agreements_view',
  'select count(*) n from milling_intake_health',
  'select count(*) n from milling_grain_grades',
  'select count(*) n from customers',
  'select count(*) n from sales_invoices',
  'select count(*) n from stock_positions',
];
for (const t of targets) await run('anon', t);
console.log('--- authenticated (staff-less user) ---');
for (const t of targets) await run('authenticated', t);
await admin.end();
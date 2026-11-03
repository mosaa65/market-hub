// اختبار صلاحيات فعلي بدور anon و authenticated — нет كتابة، قراءة فقط
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

const probe = async (label, sql, expect) => {
  await admin.query('begin');
  await admin.query(`set local role ${sql.role}`);
  await admin.query(`set local "request.jwt.claims" = '{"role":"${sql.role}","sub":"00000000-0000-0000-0000-000000000000","email":"probe@example.test"}'`);
  try {
    const r = await admin.query(sql.text);
    console.log(`${label}: ALLOWED rows=${r.rows.length}${expect === 'deny' ? '   <<< EXPECTED DENY — ثغرة' : ''}`);
  } catch (e) {
    console.log(`${label}: DENIED (${e.message.slice(0, 60)})`);
  }
  await admin.query('rollback');
};

const probes = [
  { role: 'anon', text: 'select count(*) c from milling_customer_custody' },
  { role: 'anon', text: 'select count(*) c from milling_service_money' },
  { role: 'anon', text: 'select count(*) c from milling_revenue_report' },
  { role: 'anon', text: 'select count(*) c from milling_efficiency_report' },
  { role: 'anon', text: 'select count(*) c from milling_intake_receipts' },
  { role: 'anon', text: 'select count(*) c from milling_jobs' },
  { role: 'anon', text: 'select count(*) c from milling_grain_grades' },
  { role: 'anon', text: "update milling_grain_grades set grade_name_ar = grade_name_ar where false returning id" },
  { role: 'anon', text: 'select count(*) c from milling_output_balances' },
  { role: 'anon', text: 'select count(*) c from milling_pricing_diagnostics' },
  { role: 'anon', text: 'select count(*) c from milling_agreements_view' },
  { role: 'anon', text: 'select count(*) c from milling_grain_grades_view' },
  { role: 'authenticated', text: 'select count(*) c from milling_customer_custody' },
  { role: 'authenticated', text: 'select count(*) c from milling_intake_receipts' },
  { role: 'authenticated', text: 'select count(*) c from milling_service_money' },
];

for (const p of probes) await probe(`${p.role}: ${p.text.slice(0, 60)}`, p);

await admin.end();
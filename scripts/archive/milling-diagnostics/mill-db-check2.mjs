// فحص تفصيلي fase ثانية — قراءة فقط
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
  try {
    const r = await client.query(sql);
    console.log(`\n=== ${label} ===`);
    console.table(r.rows);
  } catch (e) {
    console.log(`\n=== ${label} === ERROR: ${e.message}`);
  }
};

await client.connect();

for (const v of ['milling_revenue_report', 'milling_efficiency_report', 'milling_intake_health', 'milling_pricing_diagnostics', 'milling_customer_custody', 'milling_output_balances', 'milling_service_money', 'milling_agreements_view', 'milling_grain_grades_view']) {
  await q(`select * from ${v} limit 5`, `select * from ${v} limit 5`);
}

await q('production tables', `select table_name from information_schema.tables where table_schema='public'
 and (table_name like '%production%' or table_name like '%bom%' or table_name like 'stock_%' or table_name like 'item_%') order by 1`);

await q('products policy distribution', `select item_nature, inventory_policy, tracking, costing_method, count(*) from products group by 1,2,3,4 order by 5 desc`);

await q('milling products', `select sku, name_ar, item_nature, inventory_policy, tracking, cost_price, sale_price, min_stock from products where sku like any(array['RM-%','FG-%','PKG-%','SRV-%']) order by sku`);

await q('milling jobs', `select id, job_number, intake_receipt_id, agreement_id, status, input_weight_kg, milling_fee_per_bag, milling_fee_per_ton from milling_jobs order by created_at`);

await q('items table cols', `select table_name, column_name from information_schema.columns where table_schema='public' and table_name in ('items','stock_movements','stock_positions','stock_documents') order by table_name, ordinal_position`);

await q('rls policies milling', `select tablename, policyname, cmd, roles::text from pg_policies where schemaname='public' and tablename like 'milling%' order by tablename, policyname`);

await q('function security', `select p.proname, p.prosecdef, (select count(*) from pg_proc q where q.proname=p.proname) dupes from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like '%milling%' order by 1`);

await client.end();
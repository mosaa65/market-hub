// فحص حالة قاعدة البيانات لنظام المطحنة — استعلامات قراءة فقط، بلا أسرار في المخرجات.
// التشغيل: node scripts/mill-db-check.mjs
import fs from 'node:fs';
import dns from 'node:dns';
import pg from 'pg';

const env = Object.fromEntries(
  fs
    .readFileSync('.env', 'utf8')
    .split(/\r?\n/)
    .filter((l) => l && !l.trim().startsWith('#') && l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
);

// المضيف المباشر قد لا يُحلّ في بعض الشبكات — نفضّل الـ pooler عند ذلك.
const projectRef = fs.readFileSync('supabase/.temp/project-ref', 'utf8').trim();
const directResolves = await new Promise((res) => {
  dns.lookup(env.SUPABASE_DB_HOST, (e) => res(!e));
});
const usePooler = !directResolves;
const region = fs
  .readFileSync('supabase/.temp/pooler-url', 'utf8')
  .match(/aws-\d+-([a-z0-9-]+)\.pooler/)[1];
if (usePooler) console.log(`direct host unresolved → using pooler (${region})`);

const cfg = usePooler
  ? {
      host: `aws-0-${region}.pooler.supabase.com`,
      port: 5432,
      database: 'postgres',
      user: `postgres.${projectRef}`,
    }
  : {
      host: env.SUPABASE_DB_HOST,
      port: Number(env.SUPABASE_DB_PORT || 5432),
      database: env.SUPABASE_DB_NAME,
      user: env.SUPABASE_DB_USER,
    };
Object.assign(cfg, {
  password: env.SUPABASE_DB_PASSWORD,
  ssl: { rejectUnauthorized: false },
});

const client = new pg.Client(cfg);
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
console.log('connected');

await q('milling tables', `select table_name from information_schema.tables
 where table_schema='public' and (table_name like 'milling%' or table_name like 'item_%' or table_name like 'production%' or table_name like '%output%') order by 1`);

await q('milling functions', `select p.proname, pg_get_function_identity_arguments(p.oid) args
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname like '%milling%' order by 1,2`);

await q('products policy columns', `select column_name, data_type from information_schema.columns
 where table_schema='public' and table_name='products' order by ordinal_position`);

await q('products policy fields', `select id, name_ar, item_nature, ownership, inventory_policy, tracking, base_unit
 from products where item_nature is not null or inventory_policy is not null limit 30`);

await q('item policy enums', `select t.typname, e.enumlabel from pg_type t join pg_enum e on e.enumtypid=t.oid
 join pg_namespace n on n.oid=t.typnamespace where n.nspname='public' and (t.typname like '%nature%' or t.typname like '%ownership%' or t.typname like '%tracking%' or t.typname like '%policy%' or t.typname like '%output%' or t.typname like '%costing%') order by 1,2`);

await q('milling reports views', `select table_name from information_schema.views where table_schema='public' and table_name like 'milling%' order by 1`);

await q('RLS on milling tables', `select c.relname, c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname='public' and c.relname like 'milling%' order by 1`);

await q('counts', `select
 (select count(*) from milling_intake_receipts) intakes,
 (select count(*) from milling_jobs) jobs,
 (select count(*) from milling_service_agreements) agreements,
 (select count(*) from milling_grain_grades) grades,
 (select count(*) from milling_job_outputs) outputs,
 (select count(*) from products) products`);

await client.end();
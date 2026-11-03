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
const r = await c.query(`select oid::regprocedure::text sig, prosrc from pg_proc where proname='create_milling_intake' order by 1`);
for (const row of r.rows) {
  console.log('\n########## ' + row.sig);
  console.log(row.prosrc);
}
await c.end();
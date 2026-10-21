// مشغّل استعلامات SQL على قاعدة البيانات المتصلة — للقراءة والتشخيص.
// الاستخدام: node scripts/db-run.mjs "select 1"   (ملف .sql اختياري كوسيط)
import fs from 'node:fs';
import dns from 'node:dns';
import pg from 'pg';

export async function connect() {
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
  return new pg.Client({ ...base, password: env.SUPABASE_DB_PASSWORD, ssl: { rejectUnauthorized: false } });
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].split(/[\\/]/).pop());
// connect() قابل للاستيراد من سكربتات أخرى بلا تشغيل الكتلة أدناه.
if (isMain) {
  const client = await connect();
  await client.connect();
  const sql = process.argv[2]
    ? fs.existsSync(process.argv[2])
      ? fs.readFileSync(process.argv[2], 'utf8')
      : process.argv.slice(2).join(' ')
    : '';
  try {
    const r = await client.query(sql);
    console.table(r.rows);
  } catch (e) {
    console.error('ERROR:', e.message);
    process.exitCode = 1;
  }
  await client.end();
}
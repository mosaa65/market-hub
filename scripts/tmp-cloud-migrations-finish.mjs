// Incremental migration finisher: applies only migration files that are not
// yet recorded in supabase_migrations.schema_migrations (no drop, no reset),
// then verifies the final state. Idempotent — safe to re-run.
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import pg from "pg";

const { Client } = pg;
const client = new Client({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: true },
  connectionTimeoutMillis: 20000,
});
await client.connect();

const applied = await client.query("SELECT version FROM supabase_migrations.schema_migrations");
const appliedVersions = new Set(applied.rows.map((r) => r.version));

const migrationsDir = resolve("supabase", "migrations");
const files = (await readdir(migrationsDir))
  .filter((f) => /^\d+_.*\.sql$/.test(f))
  .sort();

let appliedCount = 0;
for (const file of files) {
  const version = file.match(/^(\d+)_/)[1];
  if (appliedVersions.has(version)) continue;
  const sql = await readFile(resolve(migrationsDir, file), "utf8");
  process.stdout.write(`apply ${file} ... `);
  await client.query(sql);
  await client.query(
    `INSERT INTO supabase_migrations.schema_migrations(version, name, statements)
     VALUES ($1, $2, ARRAY[$2]::text[]) ON CONFLICT (version) DO NOTHING`,
    [version, file.replace(/\.sql$/, "")],
  );
  console.log("OK");
  appliedCount++;
}

const mig = await client.query(
  "SELECT count(*)::int AS n, max(version) AS latest FROM supabase_migrations.schema_migrations",
);
const seeds = await client.query(`
  SELECT
    (SELECT count(*)::int FROM public.platform_modules) AS modules,
    (SELECT count(*)::int FROM public.platform_plans) AS plans,
    (SELECT count(*)::int FROM public.units) AS units,
    (SELECT count(*)::int FROM public.payment_methods) AS payment_methods,
    (SELECT count(*)::int FROM public.expense_categories) AS expense_categories,
    (SELECT count(*)::int FROM public.company_settings) AS company_settings,
    (SELECT count(*)::int FROM auth.users) AS users
`);
const s = seeds.rows[0];
console.log(
  `VERIFY migrations=${mig.rows[0].n}/${files.length} latest=${mig.rows[0].latest} newlyApplied=${appliedCount} | ` +
  `platform_modules=${s.modules} platform_plans=${s.plans} units=${s.units} ` +
  `payment_methods=${s.payment_methods} expense_categories=${s.expense_categories} ` +
  `company_settings=${s.company_settings} auth_users=${s.users}`,
);
await client.end();

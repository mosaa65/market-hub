// Cloud database rebuild — replicates `supabase db reset --linked` over a
// single stable session-pooler connection (the CLI path fails on this network).
//
// What it does, in order:
//   1. Drops and recreates the `public` schema (all app data + objects).
//   2. Clears supabase_migrations.schema_migrations.
//   3. Replays every migration in supabase/migrations in filename order.
//   4. Restores the standard Supabase schema grants (anon/authenticated/service_role).
//   5. Wipes auth users/sessions (fresh instance; owner signs up again).
//   6. Applies the safe system reference seeds (no demo data).
//
// Confirmation token required as argv[2] to prevent accidental runs.
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import pg from "pg";

const { Client } = pg;
const confirm = process.argv[2];
if (confirm !== "REBUILD CLOUD") {
  console.error("Usage: node scripts/tmp-cloud-rebuild.mjs 'REBUILD CLOUD'");
  process.exit(1);
}

const client = new Client({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: true },
  connectionTimeoutMillis: 20000,
});
await client.connect();

const step = async (label, sql) => {
  process.stdout.write(`→ ${label} ... `);
  await client.query(sql);
  console.log("OK");
};

// 1+2) fresh public schema + empty migration history
await step("drop schema public cascade", `DROP SCHEMA public CASCADE; CREATE SCHEMA public;`);
await step("clear migration history", `DELETE FROM supabase_migrations.schema_migrations;`);

// 3) replay migrations
const migrationsDir = resolve("supabase", "migrations");
const files = (await readdir(migrationsDir))
  .filter((f) => /^\d+_.*\.sql$/.test(f))
  .sort();
console.log(`replaying ${files.length} migrations...`);
for (const file of files) {
  const sql = await readFile(resolve(migrationsDir, file), "utf8");
  process.stdout.write(`  ${file} ... `);
  try {
    await client.query(sql);
    console.log("OK");
  } catch (err) {
    console.log("FAILED");
    console.error(`Migration ${file} failed: ${err.message}`);
    process.exit(1);
  }
  await client.query(
    `INSERT INTO supabase_migrations.schema_migrations(version, name, statements)
     VALUES ($1, $2, ARRAY[$2]::text[]) ON CONFLICT (version) DO NOTHING`,
    [file.match(/^(\d+)_/)[1], file.replace(/\.sql$/, "")],
  );
}

// 4) standard Supabase schema grants (same as platform bootstrap)
await step(
  "restore schema grants",
  `GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
   GRANT ALL ON SCHEMA public TO postgres, service_role;
   ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
   ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
   ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;`,
);

// 5) fresh auth (no users, no sessions) — owner signs up again
await step(
  "wipe auth users and sessions",
  `TRUNCATE auth.refresh_tokens, auth.sessions, auth.identities, auth.users CASCADE;`,
);

// 6) safe system seeds
const systemSeeds = [
  "01_modules.sql",
  "02_plans.sql",
  "03_chart_of_accounts.sql",
  "04_units.sql",
  "05_expense_categories.sql",
  "07_document_numbering.sql",
  "08_payment_methods.sql",
  "09_essential_partners.sql",
];
for (const name of systemSeeds) {
  const sql = await readFile(resolve("supabase", "seeds", "01_system", name), "utf8");
  process.stdout.write(`seed ${name} ... `);
  await client.query(sql);
  console.log("OK");
}

// verification
const mig = await client.query(
  "SELECT count(*)::int AS n, max(version) AS latest FROM supabase_migrations.schema_migrations",
);
const seeds = await client.query(`
  SELECT
    (SELECT count(*)::int FROM public.platform_modules) AS modules,
    (SELECT count(*)::int FROM public.plans) AS plans,
    (SELECT count(*)::int FROM public.units) AS units,
    (SELECT count(*)::int FROM public.payment_methods) AS payment_methods,
    (SELECT count(*)::int FROM public.expense_categories) AS expense_categories,
    (SELECT count(*)::int FROM public.chart_of_accounts) AS chart_of_accounts,
    (SELECT count(*)::int FROM public.company_settings) AS company_settings,
    (SELECT count(*)::int FROM auth.users) AS users
`);
const s = seeds.rows[0];
console.log(
  `VERIFY migrations=${mig.rows[0].n} latest=${mig.rows[0].latest} | ` +
  `platform_modules=${s.modules} plans=${s.plans} units=${s.units} ` +
  `payment_methods=${s.payment_methods} expense_categories=${s.expense_categories} ` +
  `chart_of_accounts=${s.chart_of_accounts} company_settings=${s.company_settings} auth_users=${s.users}`,
);
await client.end();
console.log("Cloud database rebuilt.");

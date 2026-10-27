// Finisher: runs the post-migration steps of the cloud rebuild (grants,
// auth wipe, system seeds, verification). Idempotent — safe to re-run.
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import pg from "pg";

const { Client } = pg;
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

await step(
  "restore schema grants",
  `GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
   GRANT ALL ON SCHEMA public TO postgres, service_role;
   ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
   ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
   ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;`,
);

await step("wipe auth users and sessions", `TRUNCATE auth.refresh_tokens, auth.sessions, auth.identities, auth.users CASCADE;`);

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
console.log("Cloud rebuild finished.");

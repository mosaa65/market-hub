import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import pg from "pg";

const { Client } = pg;
const projectRef = process.argv[2];
const includeDemoData = process.argv.includes("--include-demo");
const connectionString = process.env.SUPABASE_DB_URL;

if (!projectRef) {
  throw new Error("Usage: node scripts/apply-cloud-seeds.mjs <project-ref> [--include-demo]");
}

if (!connectionString) {
  throw new Error("SUPABASE_DB_URL is required for SQL seed files. Set it to this project's direct database URL; the value is never printed.");
}

const databaseUrl = new URL(connectionString);
const databaseUser = decodeURIComponent(databaseUrl.username);
const directConnection = databaseUrl.hostname === `db.${projectRef}.supabase.co` && databaseUser === "postgres";
const poolerConnection = /^aws-\d+-[a-z0-9-]+\.pooler\.supabase\.com$/.test(databaseUrl.hostname) && databaseUser === `postgres.${projectRef}`;
if (!directConnection && !poolerConnection) {
  throw new Error(`Database URL host/user does not identify linked project ${projectRef}. Use its direct host or pooler username postgres.<project-ref>.`);
}

const repoRoot = process.cwd();
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
const seeds = systemSeeds.map((name) => ({
  name,
  path: resolve(repoRoot, "supabase", "seeds", "01_system", name),
}));

if (includeDemoData) {
  seeds.push(
    {
      name: "06_platform_admins.sql",
      path: resolve(repoRoot, "supabase", "seeds", "01_system", "06_platform_admins.sql"),
    },
    {
      name: "sample-mill.sql",
      path: resolve(repoRoot, "supabase", "seeds", "03_samples", "sample-mill.sql"),
    },
  );
}

const client = new Client({
  connectionString,
  ssl: { rejectUnauthorized: true },
  connectionTimeoutMillis: 15000,
});

await client.connect();
try {
  const result = await client.query("SELECT current_database() AS database, current_user AS role");
  console.log(`Connected to the linked cloud database (${result.rows[0].database}).`);

  for (const seed of seeds) {
    const sql = await readFile(seed.path, "utf8");
    await client.query(sql);
    console.log(`Applied ${seed.name}`);
  }
} finally {
  await client.end();
}
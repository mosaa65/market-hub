import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import pg from "pg";

const { Client } = pg;
const connectionString = process.env.SUPABASE_DB_URL;

if (!connectionString || !process.env.PGPASSWORD) {
  throw new Error("The guarded self-hosted migration command must set its private database connection first.");
}

const databaseUrl = new URL(connectionString);
if (
  databaseUrl.hostname !== "127.0.0.1" ||
  databaseUrl.port !== "5433" ||
  databaseUrl.username !== "postgres" ||
  databaseUrl.pathname !== "/postgres" ||
  databaseUrl.searchParams.get("sslmode") !== "disable"
) {
  throw new Error("Refusing to seed: the database URL does not match the loopback-only self-hosted production endpoint.");
}

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

const repoRoot = process.cwd();
const client = new Client({
  connectionString,
  connectionTimeoutMillis: 15000,
  ssl: false,
});

await client.connect();
try {
  const target = await client.query("SELECT current_database() AS database, current_user AS role");
  if (target.rows[0]?.database !== "postgres" || target.rows[0]?.role !== "postgres") {
    throw new Error("Refusing to seed: connected database identity did not match the expected production database.");
  }

  const readline = createInterface({ input: stdin, output: stdout });
  try {
    const confirmation = await readline.question(
      "Type SEED SELF-HOSTED PRODUCTION to apply only system reference seeds: ",
    );
    if (confirmation !== "SEED SELF-HOSTED PRODUCTION") {
      throw new Error("Cancelled; no system seeds were applied.");
    }
  } finally {
    readline.close();
  }

  for (const name of systemSeeds) {
    const path = resolve(repoRoot, "supabase", "seeds", "01_system", name);
    const sql = await readFile(path, "utf8");
    await client.query(sql);
    console.log(`Applied production system seed: ${name}`);
  }
} finally {
  await client.end();
}

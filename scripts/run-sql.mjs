/**
 * مشغّل استعلامات SQL للتدقيق — قراءة فقط افتراضيًا.
 *
 * الاستخدام:
 *   node scripts/run-sql.mjs scripts/audit-customer-balances.readonly.sql
 *
 * الاتصال: SUPABASE_DB_URL من البيئة، وإلا من ../.env
 * الحماية: يرفض الملف إن احتوى كتابة (INSERT/UPDATE/DELETE/ALTER/DROP/TRUNCATE)
 *          إلا عند تمرير --allow-write صراحة لملف يعمل داخل معاملة واحدة.
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

function loadDbUrl() {
  if (process.env.SUPABASE_DB_URL) return process.env.SUPABASE_DB_URL;
  const env = readFileSync(resolve(root, ".env"), "utf8");
  // Check omdqecqiklnabqsjpfgh first, then any other
  const lines = env.split(/\r?\n/).filter((l) => /^\s*SUPABASE_DB_URL=/.test(l));
  const activeLine = lines.find((l) => l.includes("omdqecqiklnabqsjpfgh")) || lines[0];
  if (!activeLine) throw new Error("SUPABASE_DB_URL غير موجود في .env");
  return activeLine
    .replace(/^\s*SUPABASE_DB_URL=/, "")
    .trim()
    .replace(/^["']|["']$/g, "");
}

const file = process.argv[2];
const allowWrite = process.argv.includes("--allow-write");
if (!file) {
  console.error("الاستخدام: node scripts/run-sql.mjs <ملف.sql> [--allow-write]");
  process.exit(1);
}

const sql = readFileSync(resolve(root, file), "utf8");
const WRITE =
  /(^|[;\s)])(insert|update|delete|alter|drop|truncate|grant|revoke)\s+(into\s+)?(table\s+)?(public|pg_|auth|storage|")/i;
if (!allowWrite && WRITE.test(sql.replace(/--.*$/gm, ""))) {
  console.error("مرفوض: الملف يحتوي كتابة. شغّله مع --allow-write فقط إن كان تدقيقًا داخل معاملة.");
  process.exit(1);
}

const client = new pg.Client({
  connectionString: loadDbUrl(),
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 30000,
  keepAlive: true,
});
await client.connect();
try {
  const { rows } = await client.query(sql);
  const list = Array.isArray(rows) ? rows : [rows];
  const last = list.filter(Boolean).at(-1);
  console.log(JSON.stringify(last ?? [], null, 2));
} finally {
  await client.end();
}

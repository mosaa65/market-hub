/**
 * يقرأ توقيع الدالة الفعلي من قاعدة البيانات — لا تخمين.
 * الحاجة: PostgreSQL يقول «cannot remove parameter defaults» بلا أن يسمّي
 * المعامل، والسبب غير ظاهر من ملفات الترحيل.
 */
import pg from "pg";
import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(".env", "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
    }),
);

const pw = env.SUPABASE_DB_PASSWORD;
const client = new pg.Client({
  connectionString: `postgresql://postgres.kwzqvgdyadylwnvjghqn:${pw}@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres`,
  ssl: { rejectUnauthorized: false },
});

await client.connect();

const { rows } = await client.query(`
  SELECT p.proname,
         pg_get_function_identity_arguments(p.oid) AS args,
         pg_get_function_result(p.oid)             AS result,
         p.pronargdefaults                          AS ndefaults,
         p.proargnames                              AS argnames
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname IN ('sync_item_class_from_policy')
`);

console.log(JSON.stringify(rows, null, 1));

await client.end();

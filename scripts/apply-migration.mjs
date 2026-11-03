/**
 * تطبيق ملف ترحيل واحد عبر Supabase Management API (استعلام SQL مباشر).
 * للقراءة/التحقق فقط أثناء التطوير — لا يخزّن بيانات اعتماد.
 */
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

const KEY = env.SUPABASE_SECRET_KEY;
const BASE = env.SUPABASE_URL;
const file = process.argv[2];
const sql = readFileSync(file, "utf8");

// Supabase لا يوفّر تنفيذ SQL عبر REST؛ نستخدم دالة pg_metadatas إن وُجدت،
// وإلا نطبع التعليمات.
const res = await fetch(`${BASE}/rest/v1/rpc/exec_sql`, {
  method: "POST",
  headers: {
    apikey: KEY,
    Authorization: `Bearer ${KEY}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ sql }),
});

console.log("status:", res.status);
console.log((await res.text()).slice(0, 2000));

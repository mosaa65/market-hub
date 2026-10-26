/**
 * يفحص وجود الكائنات التي تفترضها الترحيلات — قراءة فقط.
 * الحاجة: جدول سجل الترحيلات فارغ تماماً، بينما الكائنات موجودة فعلاً.
 * فالحكم الوحيد الموثوق هو الفحص المباشر للكائن.
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

async function probe(table, select = "id") {
  const r = await fetch(`${BASE}/rest/v1/${table}?select=${select}&limit=1`, {
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
  });
  if (r.ok) return "EXISTS";
  const t = await r.text();
  if (r.status === 404 || /does not exist|Could not find the table/i.test(t)) return "MISSING";
  return `ERR ${r.status} ${t.slice(0, 80)}`;
}

async function col(table, name) {
  const r = await fetch(`${BASE}/rest/v1/${table}?select=${name}&limit=1`, {
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
  });
  if (r.ok) return "HAS";
  return "NO";
}

const lines = [];
const p = (s) => lines.push(s);

p("=== جداول ===");
for (const t of [
  "packaging_types",
  "milling_grain_grades",
  "milling_intake_receipts",
  "milling_jobs",
  "milling_job_outputs",
  "milling_delivery_notes",
  "stock_positions",
  "stock_ledger_entries",
  "stock_movements",
]) {
  p(`${t.padEnd(26)} ${await probe(t)}`);
}

p("\n=== أعمدة ===");
for (const [t, c] of [
  ["products", "item_class"],
  ["products", "package_type_id"],
  ["products", "package_weight_kg"],
  ["products", "base_uom_id"],
  ["products", "is_sellable"],
  ["milling_grain_grades", "product_id"],
  ["milling_intake_receipts", "grain_grade_ref"],
]) {
  p(`${(t + "." + c).padEnd(38)} ${await col(t, c)}`);
}

console.log(lines.join("\n"));

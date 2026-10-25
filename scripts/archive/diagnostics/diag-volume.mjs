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

async function count(table, filter = "") {
  const res = await fetch(`${BASE}/rest/v1/${table}?select=id${filter}`, {
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, Prefer: "count=exact", Range: "0-0" },
  });
  if (!res.ok) return `err ${res.status}`;
  return res.headers.get("content-range")?.split("/")[1] ?? "?";
}

const lines = [];
const p = (s) => lines.push(s);

p("=== حجم البيانات الحقيقي ===");
for (const t of [
  "products",
  "categories",
  "units",
  "inventory",
  "stock_movements",
  "stock_ledger_entries",
  "sales_invoices",
  "sales_invoice_items",
  "purchase_invoices",
  "purchase_invoice_items",
  "milling_intake_receipts",
  "milling_jobs",
  "milling_job_outputs",
  "milling_delivery_notes",
  "production_orders",
  "customers",
]) {
  p(`${t.padEnd(26)} ${await count(t)}`);
}

// منتجات مرتبطة بحركات فعلية — هؤلاء لا يُحذفون أبداً
p("\n=== المنتجات التي لها حركات ===");
const inv = await (
  await fetch(`${BASE}/rest/v1/inventory?select=product_id,quantity`, {
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
  })
).json();
const byProduct = new Map();
for (const r of inv) {
  byProduct.set(r.product_id, (byProduct.get(r.product_id) ?? 0) + Number(r.quantity || 0));
}
p(`صفوف مخزون: ${inv.length} · منتجات مميزة: ${byProduct.size}`);

const prods = await (
  await fetch(`${BASE}/rest/v1/products?select=id,sku,name_ar,unit_id`, {
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
  })
).json();
const withStock = prods.filter((x) => byProduct.has(x.id));
p(`منتجات لها رصيد مخزني: ${withStock.length}`);
for (const x of withStock) {
  p(`  ${x.sku.padEnd(16)} qty=${byProduct.get(x.id).toFixed(3).padStart(12)}  ${x.name_ar}`);
}

// أي منتج في بنود فواتير بيع؟
const items = await (
  await fetch(`${BASE}/rest/v1/sales_invoice_items?select=product_id`, {
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
  })
).json();
const soldIds = new Set(items.map((i) => i.product_id).filter(Boolean));
p(`\nمنتجات ظهرت في بنود فواتير البيع: ${soldIds.size}`);
for (const x of prods.filter((x) => soldIds.has(x.id))) p(`  ${x.sku.padEnd(16)} ${x.name_ar}`);

console.log(lines.join("\n"));
